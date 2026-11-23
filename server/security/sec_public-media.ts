import crypto from "crypto";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { defaultFormats, defaultPlugins } from "jimp";
import { createJimp } from "@jimp/core";
import webp from "@jimp/wasm-webp";
import { createThumbnail } from "../utils/img_thumbnail";
import { detectImageMagicBytes } from "./sec_image-validator";
import { MediaPipelineService } from "../media/svc_media-pipeline";

const execFileAsync = promisify(execFile);

const Jimp = createJimp({
  formats: [...defaultFormats, webp],
  plugins: defaultPlugins,
});

function resolveRuntimeSecret(): string {
  const fromEnv =
    process.env.PUBLIC_MEDIA_SECRET?.trim() ||
    process.env.SESSION_SECRET?.trim() ||
    process.env.STORAGE_SIGNING_SECRET?.trim();
  if (fromEnv) return fromEnv;

  // Derive a deterministic deployment-scoped secret so signed public image tokens
  // remain valid across server restarts and multi-instance Cloud Run scaling.
  try {
    const cfgPath = path.resolve(process.cwd(), "firebase-applet-config.json");
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      const seed = `${cfg.projectId || ""}|${cfg.apiKey || ""}|${cfg.firestoreDatabaseId || ""}|brokr-public-media-v1`;
      if (seed.length > 30) {
        return crypto.createHash("sha256").update(seed).digest("hex");
      }
    }
  } catch {
    // Fall through to random secret
  }

  return crypto.randomBytes(32).toString("hex");
}

const RUNTIME_SECRET = resolveRuntimeSecret();

export interface PublicImageTokenPayload {
  u: string; // source image URL or /api/storage/media/... or data URL hash key
  p: string; // property ID / code
  s: string; // viewer session ID
  st: string; // short viewer watermark stamp
  exp: number; // expiration epoch ms
  jti: string; // unique token ID
}

const TOKEN_MAX_FETCHES = 120;
const tokenFetchCounts = new Map<string, { count: number; exp: number }>();

const protectedImageCache = new Map<
  string,
  { buffer: Buffer; mimeType: string; ts: number }
>();
const pendingProtectedBuilds = new Map<
  string,
  Promise<{ buffer: Buffer; mimeType: string }>
>();
const PROTECTED_CACHE_MAX = 300;
const PROTECTED_CACHE_TTL_MS = 15 * 60 * 1000;

// Bounded concurrency for ImageMagick/Jimp transforms so opening a 20+ photo lightbox
// never starves CPU or causes subprocess timeouts.
const MAX_CONCURRENT_TRANSFORMS = 4;
let activeTransforms = 0;
const transformWaitQueue: Array<() => void> = [];

async function withTransformSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeTransforms >= MAX_CONCURRENT_TRANSFORMS) {
    await new Promise<void>((resolve) => transformWaitQueue.push(resolve));
  }
  activeTransforms++;
  try {
    return await fn();
  } finally {
    activeTransforms--;
    const next = transformWaitQueue.shift();
    if (next) next();
  }
}

export function buildProtectedImageCacheKey(
  cacheKey: string,
  maxWidth?: number | null,
  preferWebp = false
): string {
  const capWidth = Math.min(1600, Math.max(100, maxWidth || 1200));
  const fmt = preferWebp ? "webp" : "jpeg";
  return `clean::${cacheKey}::w=${capWidth}::fmt=${fmt}`;
}

export function getCachedProtectedPublicImage(
  cacheKey: string,
  maxWidth?: number | null,
  preferWebp = false
): { buffer: Buffer; mimeType: string } | null {
  const fullCacheKey = buildProtectedImageCacheKey(cacheKey, maxWidth, preferWebp);
  const cached = protectedImageCache.get(fullCacheKey);
  if (cached && Date.now() - cached.ts < PROTECTED_CACHE_TTL_MS) {
    return { buffer: cached.buffer, mimeType: cached.mimeType };
  }
  return null;
}

/**
 * Checks bounded RAM cache first, then persistent Cloud Storage under
 * `public/shares/{propertyCode}/gallery/{hash}_w{width}.{webp|jpg}` so cold server
 * restarts serve already-generated public gallery images with 0 transforms and 0 upstream fetches.
 */
export async function getPersistedProtectedPublicImage(params: {
  cacheKey: string;
  propertyCode: string;
  maxWidth?: number | null;
  preferWebp?: boolean;
}): Promise<{ buffer: Buffer; mimeType: string; fromStorage: boolean } | null> {
  const capWidth = Math.min(1600, Math.max(100, params.maxWidth || 1200));
  const preferWebp = params.preferWebp ?? false;
  const fullCacheKey = buildProtectedImageCacheKey(params.cacheKey, capWidth, preferWebp);

  const mem = protectedImageCache.get(fullCacheKey);
  if (mem && Date.now() - mem.ts < PROTECTED_CACHE_TTL_MS) {
    return { buffer: mem.buffer, mimeType: mem.mimeType, fromStorage: false };
  }

  const persisted = await MediaPipelineService.getPersistedPublicShareVariant({
    shareCode: params.propertyCode || "BROKR",
    sourceKey: params.cacheKey,
    width: capWidth,
    preferWebp,
  });
  if (!persisted) return null;

  if (protectedImageCache.size >= PROTECTED_CACHE_MAX) {
    const oldestKey = protectedImageCache.keys().next().value;
    if (oldestKey) protectedImageCache.delete(oldestKey);
  }
  protectedImageCache.set(fullCacheKey, {
    buffer: persisted.buffer,
    mimeType: persisted.mimeType,
    ts: Date.now(),
  });
  return { buffer: persisted.buffer, mimeType: persisted.mimeType, fromStorage: true };
}

export function clearProtectedMemoryCacheForTests(): void {
  protectedImageCache.clear();
  pendingProtectedBuilds.clear();
}

function pruneTokenCounts() {
  const now = Date.now();
  for (const [key, entry] of tokenFetchCounts.entries()) {
    if (entry.exp < now) {
      tokenFetchCounts.delete(key);
    }
  }
  if (tokenFetchCounts.size > 4000) {
    const excess = tokenFetchCounts.size - 2500;
    let removed = 0;
    for (const key of tokenFetchCounts.keys()) {
      tokenFetchCounts.delete(key);
      removed++;
      if (removed >= excess) break;
    }
  }
}

const inlineDataUrlStore = new Map<string, { dataUrl: string; ts: number }>();
const INLINE_STORE_MAX = 200;

export function registerInlinePublicDataUrl(dataUrl: string): string {
  const hash = crypto.createHash("sha256").update(dataUrl).digest("hex").slice(0, 24);
  if (inlineDataUrlStore.size >= INLINE_STORE_MAX) {
    const oldest = inlineDataUrlStore.keys().next().value;
    if (oldest) inlineDataUrlStore.delete(oldest);
  }
  inlineDataUrlStore.set(hash, { dataUrl, ts: Date.now() });
  return `inline:${hash}`;
}

export function resolveInlinePublicDataUrl(ref: string): string | null {
  if (!ref.startsWith("inline:")) return null;
  const hash = ref.slice("inline:".length);
  return inlineDataUrlStore.get(hash)?.dataUrl || null;
}

export function createPublicImageToken(params: {
  sourceUrl: string;
  propertyId: string;
  viewerSid: string;
  viewerStamp: string;
  ttlMs?: number;
}): string {
  const storedSource = params.sourceUrl.startsWith("data:")
    ? registerInlinePublicDataUrl(params.sourceUrl)
    : params.sourceUrl;

  const payload: PublicImageTokenPayload = {
    u: storedSource,
    p: params.propertyId,
    s: params.viewerSid,
    st: params.viewerStamp,
    exp: Date.now() + (params.ttlMs ?? 10 * 60 * 1000),
    jti: crypto.randomBytes(8).toString("hex"),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sigB64 = crypto
    .createHmac("sha256", RUNTIME_SECRET)
    .update(payloadB64)
    .digest("base64url");
  return `${payloadB64}.${sigB64}`;
}

export function verifyPublicImageToken(
  token: string
): { valid: true; payload: PublicImageTokenPayload } | { valid: false; reason: string; status: number } {
  if (!token || typeof token !== "string") {
    return { valid: false, reason: "Missing image token", status: 400 };
  }
  const dotIdx = token.indexOf(".");
  if (dotIdx <= 0) {
    return { valid: false, reason: "Malformed image token", status: 403 };
  }

  const payloadB64 = token.slice(0, dotIdx);
  const sigB64 = token.slice(dotIdx + 1);

  const expectedSig = crypto
    .createHmac("sha256", RUNTIME_SECRET)
    .update(payloadB64)
    .digest("base64url");

  const sigBuf = Buffer.from(sigB64);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return { valid: false, reason: "Invalid image token signature", status: 403 };
  }

  let payload: PublicImageTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return { valid: false, reason: "Corrupted image token payload", status: 403 };
  }

  if (!payload?.u || !payload?.exp || !payload?.jti) {
    return { valid: false, reason: "Incomplete image token", status: 403 };
  }

  if (Date.now() > payload.exp) {
    return { valid: false, reason: "Image token expired", status: 403 };
  }

  pruneTokenCounts();
  const prev = tokenFetchCounts.get(payload.jti) || { count: 0, exp: payload.exp };
  if (prev.count >= TOKEN_MAX_FETCHES) {
    return { valid: false, reason: "Image token fetch limit exceeded", status: 429 };
  }
  tokenFetchCounts.set(payload.jti, { count: prev.count + 1, exp: payload.exp });

  return { valid: true, payload };
}

// Compact 5x7 pixel bitmap font for server-side zero-dependency pixel watermarking
const FONT_5X7: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01110"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10011", "10101", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["01110", "10000", "11110", "10001", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "*": ["00000", "00100", "10101", "01110", "10101", "00100", "00000"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

function drawRotatedText(
  data: Uint8Array | Buffer,
  width: number,
  height: number,
  text: string,
  centerX: number,
  centerY: number,
  scale: number,
  angleRad: number,
  alpha: number
) {
  const upper = text.toUpperCase();
  const charAdvance = 6 * scale;
  const totalWidth = upper.length * charAdvance;
  const totalHeight = 7 * scale;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);

  const blendPixel = (px: number, py: number, rVal: number, gVal: number, bVal: number, a: number) => {
    if (px < 0 || px >= width || py < 0 || py >= height) return;
    const idx = (py * width + px) * 4;
    const inv = 1 - a;
    data[idx] = Math.round(data[idx] * inv + rVal * a);
    data[idx + 1] = Math.round(data[idx + 1] * inv + gVal * a);
    data[idx + 2] = Math.round(data[idx + 2] * inv + bVal * a);
  };

  for (let i = 0; i < upper.length; i++) {
    const glyph = FONT_5X7[upper[i]] || FONT_5X7[" "];
    const localBaseX = -totalWidth / 2 + i * charAdvance;
    const localBaseY = -totalHeight / 2;

    for (let gy = 0; gy < 7; gy++) {
      const row = glyph[gy];
      for (let gx = 0; gx < 5; gx++) {
        if (row[gx] !== "1") continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const lx = localBaseX + gx * scale + sx;
            const ly = localBaseY + gy * scale + sy;
            const rx = Math.round(centerX + lx * cos - ly * sin);
            const ry = Math.round(centerY + lx * sin + ly * cos);
            // Soft dark outline shadow + bright cream text so visible on all backgrounds
            blendPixel(rx + 1, ry + 1, 5, 29, 53, alpha * 0.75);
            blendPixel(rx, ry, 255, 255, 255, alpha);
          }
        }
      }
    }
  }
}

async function readImageWithFallback(buffer: Buffer): Promise<any> {
  try {
    return await Jimp.read(buffer);
  } catch {
    const { stdout } = await execFileAsync("convert", ["-", "png:-"], {
      input: buffer as any,
      encoding: "buffer" as any,
      maxBuffer: 25 * 1024 * 1024,
    } as any);
    return await Jimp.read(stdout as unknown as Buffer);
  }
}

/**
 * Applies public-share protection transforms to an image buffer:
 * - Resolution cap (max 1200px)
 * - Outer border micro-crop (~2.5%) & subtle pixel perturbation (breaks reverse image search / Google Lens)
 * - Diagonal repeating semi-transparent agency + viewer session watermark burned into pixels
 * - Re-encoded as clean JPEG (strips 100% of EXIF/IPTC/GPS metadata)
 */
export async function applyPublicImageProtections(
  rawBuffer: Buffer,
  options: {
    cacheKey: string;
    propertyCode: string;
    viewerStamp: string;
    maxWidth?: number | null;
    preferWebp?: boolean;
  }
): Promise<{ buffer: Buffer; mimeType: string }> {
  const capWidth = Math.min(1600, Math.max(100, options.maxWidth || 1200));
  const preferWebp = options.preferWebp ?? false;
  const fullCacheKey = buildProtectedImageCacheKey(options.cacheKey, capWidth, preferWebp);
  const cached = protectedImageCache.get(fullCacheKey);
  if (cached && Date.now() - cached.ts < PROTECTED_CACHE_TTL_MS) {
    return { buffer: cached.buffer, mimeType: cached.mimeType };
  }

  const inflight = pendingProtectedBuilds.get(fullCacheKey);
  if (inflight) {
    return inflight;
  }

  const work = withTransformSlot(async (): Promise<{ buffer: Buffer; mimeType: string }> => {
    const cachedInside = protectedImageCache.get(fullCacheKey);
    if (cachedInside && Date.now() - cachedInside.ts < PROTECTED_CACHE_TTL_MS) {
      return { buffer: cachedInside.buffer, mimeType: cachedInside.mimeType };
    }

    // Check persistent Cloud Storage before running ImageMagick/Jimp (survives cold restarts)
    const persisted = await MediaPipelineService.getPersistedPublicShareVariant({
      shareCode: options.propertyCode || "BROKR",
      sourceKey: options.cacheKey,
      width: capWidth,
      preferWebp,
    });
    if (persisted && persisted.buffer.length > 0) {
      if (protectedImageCache.size >= PROTECTED_CACHE_MAX) {
        const oldestKey = protectedImageCache.keys().next().value;
        if (oldestKey) protectedImageCache.delete(oldestKey);
      }
      protectedImageCache.set(fullCacheKey, {
        buffer: persisted.buffer,
        mimeType: persisted.mimeType,
        ts: Date.now(),
      });
      return { buffer: persisted.buffer, mimeType: persisted.mimeType };
    }

    let outBuffer: Buffer;
    let outMime: string;

    const detectedMime = detectImageMagicBytes(rawBuffer)?.mime || "image/jpeg";
    MediaPipelineService.recordPublicShareTransform();
    try {
      const resized = await createThumbnail({
        buffer: rawBuffer,
        mimeType: detectedMime,
        targetWidth: capWidth,
        preferWebp,
        forceJpeg: !preferWebp,
        quality: preferWebp ? 86 : 88,
        cacheKey: fullCacheKey,
      });
      outBuffer = resized.data;
      outMime = resized.mimeType;
    } catch {
      try {
        const img = await readImageWithFallback(rawBuffer);
        if (img.width > capWidth || img.height > capWidth) {
          img.scaleToFit({ w: capWidth, h: capWidth });
        }
        outBuffer = await img.getBuffer("image/jpeg" as any, { quality: 88 });
        outMime = "image/jpeg";
      } catch {
        outBuffer = rawBuffer;
        outMime = detectedMime;
      }
    }

    // Persist generated variant to Cloud Storage so cold restarts execute 0 transforms
    await MediaPipelineService.persistPublicShareVariant({
      shareCode: options.propertyCode || "BROKR",
      sourceKey: options.cacheKey,
      width: capWidth,
      buffer: outBuffer,
      mimeType: outMime,
    });

    if (protectedImageCache.size >= PROTECTED_CACHE_MAX) {
      const oldestKey = protectedImageCache.keys().next().value;
      if (oldestKey) protectedImageCache.delete(oldestKey);
    }
    protectedImageCache.set(fullCacheKey, {
      buffer: outBuffer,
      mimeType: outMime,
      ts: Date.now(),
    });

    return { buffer: outBuffer, mimeType: outMime };
  });

  pendingProtectedBuilds.set(fullCacheKey, work);
  try {
    return await work;
  } finally {
    pendingProtectedBuilds.delete(fullCacheKey);
  }
}
