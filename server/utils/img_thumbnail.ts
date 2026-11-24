import { spawn } from "child_process";
import sharp from "sharp";
import { defaultFormats, defaultPlugins } from "jimp";
import { createJimp } from "@jimp/core";
import webp from "@jimp/wasm-webp";

const Jimp = createJimp({
  formats: [...defaultFormats, webp],
  plugins: defaultPlugins,
});

// Keep sharp's internal libvips cache lean on small containers while staying blazing fast
sharp.cache({ memory: 32, files: 0, items: 64 });
sharp.concurrency(2);

const THUMBNAIL_WIDTH_BUCKETS = [160, 240, 360, 480, 640, 800, 1000, 1280, 1600] as const;

export function parseThumbnailWidth(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const num = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isFinite(num) || num <= 0) return null;
  const clamped = Math.max(100, Math.min(1600, Math.round(num)));
  for (const bucket of THUMBNAIL_WIDTH_BUCKETS) {
    if (clamped <= bucket) return bucket;
  }
  return 1600;
}

export function shouldServeWebp(acceptHeader: unknown, formatQuery?: unknown): boolean {
  const fmt = String(Array.isArray(formatQuery) ? formatQuery[0] : formatQuery || "").toLowerCase();
  if (fmt === "jpeg" || fmt === "jpg" || fmt === "png") return false;
  if (fmt === "webp") return true;
  const accept = String(Array.isArray(acceptHeader) ? acceptHeader[0] : acceptHeader || "").toLowerCase();
  return accept.includes("image/webp");
}

function runConvertBuffer(args: string[], inputBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn("convert", args, { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let totalBytes = 0;
    const maxOutBytes = 15 * 1024 * 1024;
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        proc.kill("SIGKILL");
      } catch {}
      reject(new Error("Thumbnail convert timeout"));
    }, 12000);

    proc.stdout.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxOutBytes) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          proc.kill("SIGKILL");
        } catch {}
        reject(new Error("Thumbnail output exceeded limit"));
        return;
      }
      chunks.push(chunk);
    });
    proc.stderr.on("data", (chunk: Buffer) => errChunks.push(chunk));
    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0 && chunks.length > 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(
          new Error(
            `convert exited with code ${code}: ${Buffer.concat(errChunks).toString("utf8").slice(0, 200)}`
          )
        );
      }
    });
    proc.stdin.on("error", () => {});
    proc.stdin.end(inputBuffer);
  });
}

export interface ThumbnailResult {
  data: Buffer;
  mimeType: string;
}

const thumbnailCache = new Map<string, ThumbnailResult>();
const pendingThumbnails = new Map<string, Promise<ThumbnailResult>>();
const MAX_THUMBNAIL_CACHE = 800;
const MAX_THUMBNAIL_CACHE_BYTES = 40 * 1024 * 1024; // 40 MB
let thumbnailCacheBytes = 0;

function setThumbnailCache(key: string, val: ThumbnailResult) {
  const existing = thumbnailCache.get(key);
  if (existing) {
    thumbnailCacheBytes = Math.max(0, thumbnailCacheBytes - existing.data.length);
    thumbnailCache.delete(key);
  }
  while (
    thumbnailCache.size >= MAX_THUMBNAIL_CACHE ||
    (thumbnailCacheBytes + val.data.length > MAX_THUMBNAIL_CACHE_BYTES && thumbnailCache.size > 0)
  ) {
    const oldestKey = thumbnailCache.keys().next().value;
    if (!oldestKey) break;
    const oldestVal = thumbnailCache.get(oldestKey);
    if (oldestVal) {
      thumbnailCacheBytes = Math.max(0, thumbnailCacheBytes - oldestVal.data.length);
    }
    thumbnailCache.delete(oldestKey);
  }
  thumbnailCache.set(key, val);
  thumbnailCacheBytes += val.data.length;
}

export function clearThumbnailCacheByPrefix(prefix: string): number {
  if (!prefix) return 0;
  let removed = 0;
  for (const key of Array.from(thumbnailCache.keys())) {
    if (key.startsWith(prefix)) {
      const val = thumbnailCache.get(key);
      if (val) {
        thumbnailCacheBytes = Math.max(0, thumbnailCacheBytes - val.data.length);
      }
      thumbnailCache.delete(key);
      removed++;
    }
  }
  return removed;
}

export function clearAllThumbnailCache(): number {
  const count = thumbnailCache.size;
  thumbnailCache.clear();
  thumbnailCacheBytes = 0;
  return count;
}

export async function createThumbnail(params: {
  buffer: Buffer;
  mimeType: string;
  targetWidth: number;
  preferWebp?: boolean;
  forceJpeg?: boolean;
  quality?: number;
  cacheKey?: string;
}): Promise<ThumbnailResult> {
  const {
    buffer,
    mimeType,
    targetWidth,
    preferWebp = true,
    forceJpeg = false,
    quality,
    cacheKey,
  } = params;

  if (!buffer || buffer.length === 0 || !mimeType.startsWith("image/") || mimeType.includes("svg")) {
    return { data: buffer, mimeType };
  }

  const outFormat: "jpeg" | "webp" = forceJpeg || !preferWebp ? "jpeg" : "webp";
  const outMime = outFormat === "webp" ? "image/webp" : "image/jpeg";
  const resolvedQuality = quality ?? (outFormat === "webp" ? 84 : 86);
  const fullCacheKey = cacheKey ? `${cacheKey}::w=${targetWidth}::fmt=${outFormat}::q=${resolvedQuality}` : "";

  if (fullCacheKey) {
    const cached = thumbnailCache.get(fullCacheKey);
    if (cached) return cached;

    const pending = pendingThumbnails.get(fullCacheKey);
    if (pending) return pending;
  }

  const work = (async (): Promise<ThumbnailResult> => {
    // 1. Primary path: native sharp (libvips) — ~15-50ms, strips EXIF by default, minimal RAM
    try {
      const pipeline = sharp(buffer, { failOn: "none", limitInputPixels: 40_000_000 })
        .rotate()
        .resize({
          width: targetWidth,
          withoutEnlargement: true,
          fit: "inside",
        });

      const resized =
        outFormat === "webp"
          ? await pipeline.webp({ quality: resolvedQuality, effort: 3 }).toBuffer()
          : await pipeline.jpeg({ quality: resolvedQuality, progressive: true }).toBuffer();

      if (resized && resized.length > 0) {
        const result: ThumbnailResult = { data: resized, mimeType: outMime };
        if (fullCacheKey) setThumbnailCache(fullCacheKey, result);
        return result;
      }
    } catch {
      // Fall through to ImageMagick / Jimp fallback for exotic formats
    }

    // 2. Fallback: ImageMagick convert CLI (if installed)
    try {
      const outTarget = outFormat === "webp" ? "webp:-" : "jpg:-";
      const args = [
        "-",
        "-auto-orient",
        "-resize",
        `${targetWidth}x>`,
        "-strip",
        "-quality",
        String(resolvedQuality),
      ];
      if (outFormat === "jpeg") {
        args.push("-interlace", "Plane");
      }
      args.push(outTarget);

      const resized = await runConvertBuffer(args, buffer);
      const result: ThumbnailResult = { data: resized, mimeType: outMime };
      if (fullCacheKey) setThumbnailCache(fullCacheKey, result);
      return result;
    } catch {
      // 3. Final fallback: pure-JS Jimp
      try {
        const img = await Jimp.read(buffer);
        if (img.width > targetWidth) {
          img.scaleToFit({ w: targetWidth, h: Math.round(targetWidth * 4) });
        }
        const outBuf: Buffer = await img.getBuffer("image/jpeg" as any, { quality: 86 });
        const fallbackResult: ThumbnailResult = { data: outBuf, mimeType: "image/jpeg" };
        if (fullCacheKey) setThumbnailCache(fullCacheKey, fallbackResult);
        return fallbackResult;
      } catch {
        return { data: buffer, mimeType };
      }
    }
  })();

  if (fullCacheKey) {
    pendingThumbnails.set(fullCacheKey, work);
    try {
      return await work;
    } finally {
      pendingThumbnails.delete(fullCacheKey);
    }
  }

  return work;
}
