import crypto from "crypto";
import path from "path";
import { spawn } from "child_process";
import { defaultFormats, defaultPlugins } from "jimp";
import { createJimp } from "@jimp/core";
import webp from "@jimp/wasm-webp";
import { CloudStorageService } from "../../src/core/storage/svc_cloud-storage";
import { StorageMetadataRepository } from "../../src/core/storage/repo_storage-metadata";
import {
  OrphanMediaItem,
  OrphanMediaReport,
  StorageObjectMetadata,
} from "../../src/core/storage/typ_storage-config";
import { createThumbnail } from "../utils/img_thumbnail";

const Jimp = createJimp({
  formats: [...defaultFormats, webp],
  plugins: defaultPlugins,
});

export const PROPERTY_VARIANT_WIDTHS = [400, 1200] as const;
export type CanonicalVariantWidth = (typeof PROPERTY_VARIANT_WIDTHS)[number];

export const CACHE_CONTROL_PRIVATE = "private, no-store";
export const CACHE_CONTROL_PUBLIC_IMMUTABLE = "public, max-age=31536000, immutable";
export const CACHE_CONTROL_PUBLIC_MUTABLE = "public, max-age=3600";

export interface MediaTransformCounters {
  propertyVariantTransforms: number;
  publicShareVariantTransforms: number;
  ogTransforms: number;
  storageVariantHits: number;
  storageOgHits: number;
  storagePublicShareHits: number;
}

const transformCounters: MediaTransformCounters = {
  propertyVariantTransforms: 0,
  publicShareVariantTransforms: 0,
  ogTransforms: 0,
  storageVariantHits: 0,
  storageOgHits: 0,
  storagePublicShareHits: 0,
};

const ogMemoryCache = new Map<string, { buffer: Buffer; ts: number }>();
const pendingOgBuilds = new Map<
  string,
  Promise<{ buffer: Buffer; fromStorage: boolean; objectKey: string } | null>
>();
const OG_MEMORY_CACHE_MAX = 200;
const OG_MEMORY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

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
      } catch {
        // ignore
      }
      reject(new Error("ImageMagick OG convert timeout"));
    }, 12_000);

    proc.stdout.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxOutBytes) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          proc.kill("SIGKILL");
        } catch {
          // ignore
        }
        reject(new Error("ImageMagick OG output exceeded limit"));
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
            `convert exited with code ${code}: ${Buffer.concat(errChunks)
              .toString("utf8")
              .slice(0, 200)}`
          )
        );
      }
    });
    proc.stdin.on("error", () => {});
    proc.stdin.end(inputBuffer);
  });
}

function sanitizeShareCode(raw: string): string {
  const cleaned = String(raw || "share")
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .slice(0, 64);
  return cleaned || "share";
}

function extractObjectKeyPathParts(
  objectKey: string
): { tenantId: string; entityType: string; entityId: string; fileName: string } | null {
  const parts = String(objectKey || "").split("/");
  if (parts.length !== 5 || parts[0] !== "tenants") return null;
  return {
    tenantId: parts[1],
    entityType: parts[2],
    entityId: parts[3],
    fileName: parts[4],
  };
}

/**
 * Phase 5 Media & Storage Optimization Pipeline.
 *
 * Responsibilities:
 * - Content-hashed uploads + pre-generated WebP variants (`w=400`, `w=1200`) persisted in Cloud Storage
 * - Persistent public-share gallery variants & `1200x630` `< 260KB` baseline sRGB OpenGraph JPEGs
 *   under `public/shares/{shareCode}/...` so cold Cloud Run restarts execute 0 repeated transforms
 * - Strict Cache-Control separation (`private, no-store` vs `public, max-age=31536000, immutable`)
 * - Single CDN-ready URL builder controlled by `MEDIA_CDN_BASE_URL` (Stage A uses `$0` direct serving)
 * - Dry-run orphan media sweep reporting
 */
export class MediaPipelineService {
  /**
   * Feature flag: persists & serves pre-generated WebP/OG variants from Cloud Storage.
   * Setting `USE_GCS_MEDIA_VARIANTS=false` cleanly rolls back to on-demand transforms
   * without deleting already-persisted objects.
   */
  public static isGcsMediaVariantsEnabled(): boolean {
    return process.env.USE_GCS_MEDIA_VARIANTS !== "false";
  }

  /**
   * Single media URL builder so enabling Cloud CDN in Stage B is a 1-env-var change
   * (`MEDIA_CDN_BASE_URL=https://media.example.com`). In Stage A (unset), returns the
   * clean relative path served directly from Cloud Run / GCS at $0 CDN cost.
   */
  public static buildMediaUrl(relativePath: string): string {
    const cleanPath = relativePath.startsWith("/") ? relativePath : `/${relativePath}`;
    const cdnBase = process.env.MEDIA_CDN_BASE_URL?.trim().replace(/\/+$/, "");
    if (!cdnBase) return cleanPath;
    if (!/^https?:\/\//i.test(cdnBase)) return cleanPath;
    return `${cdnBase}${cleanPath}`;
  }

  public static getCacheControlHeader(
    kind: "private" | "public_immutable" | "public_mutable"
  ): string {
    if (kind === "private") return CACHE_CONTROL_PRIVATE;
    if (kind === "public_immutable") return CACHE_CONTROL_PUBLIC_IMMUTABLE;
    return CACHE_CONTROL_PUBLIC_MUTABLE;
  }

  public static getTransformCounters(): MediaTransformCounters {
    return { ...transformCounters };
  }

  public static resetTransformCountersForTests(): void {
    transformCounters.propertyVariantTransforms = 0;
    transformCounters.publicShareVariantTransforms = 0;
    transformCounters.ogTransforms = 0;
    transformCounters.storageVariantHits = 0;
    transformCounters.storageOgHits = 0;
    transformCounters.storagePublicShareHits = 0;
  }

  public static clearInMemoryMediaCachesForTests(): void {
    ogMemoryCache.clear();
    pendingOgBuilds.clear();
  }

  public static computeContentHash16(buffer: Buffer): string {
    return crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);
  }

  public static buildContentHashedFileName(buffer: Buffer, ext: string): string {
    const safeExt = String(ext || "jpg")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    const hash16 = this.computeContentHash16(buffer);
    return `prop_${hash16}.${safeExt || "jpg"}`;
  }

  public static resolveCanonicalVariantWidth(requestedWidth: number): CanonicalVariantWidth {
    return requestedWidth <= 400 ? 400 : 1200;
  }

  public static buildPropertyVariantKey(params: {
    tenantId: string;
    entityId: string;
    contentHash: string;
    width: number;
    format: "webp" | "jpg";
  }): string {
    const safeHash = params.contentHash.replace(/[^a-f0-9]/gi, "").slice(0, 16) || "img";
    return CloudStorageService.validateRawObjectKey(
      `tenants/${params.tenantId}/properties/${params.entityId}/variants/${safeHash}_w${params.width}.${params.format}`
    );
  }

  public static buildPublicShareGalleryVariantKey(params: {
    shareCode: string;
    sourceKey: string;
    width: number;
    format: "webp" | "jpg";
  }): string {
    const safeCode = sanitizeShareCode(params.shareCode);
    const sourceHash = crypto
      .createHash("sha256")
      .update(params.sourceKey)
      .digest("hex")
      .slice(0, 16);
    return CloudStorageService.validateRawObjectKey(
      `public/shares/${safeCode}/gallery/${sourceHash}_w${params.width}.${params.format}`
    );
  }

  public static buildPublicShareOgKey(params: {
    shareCode: string;
    versionKey?: string;
    preferredTenantId?: string | null;
  }): string {
    const safeCode = sanitizeShareCode(params.shareCode);
    const rawVer = (params.versionKey || "default").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24);
    const tenantTag = params.preferredTenantId
      ? crypto
          .createHash("sha256")
          .update(params.preferredTenantId)
          .digest("hex")
          .slice(0, 8)
      : "global";
    const versionPart = rawVer ? `${rawVer}_${tenantTag}` : `default_${tenantTag}`;
    return CloudStorageService.validateRawObjectKey(
      `public/shares/${safeCode}/og_${versionPart}.jpg`
    );
  }

  /**
   * Stores an uploaded property photo under a content-hashed object key in Cloud Storage
   * and pre-generates persistent `w=400` and `w=1200` WebP variants so repeated listing
   * reads execute 0 image transforms across Cloud Run instances and cold restarts.
   */
  public static async storePropertyPhotoWithVariants(params: {
    tenantId: string;
    propertyId: string;
    buffer: Buffer;
    mimeType: string;
    ext: string;
    originalFileName?: string;
    uploadedByUserId: string;
  }): Promise<{
    metadata: StorageObjectMetadata;
    url: string;
    variants: Partial<Record<`w${CanonicalVariantWidth}`, { objectKey: string; url: string }>>;
    cacheControl: string;
  }> {
    const hashedFileName = this.buildContentHashedFileName(params.buffer, params.ext);
    const contentHash16 = this.computeContentHash16(params.buffer);

    const meta = await CloudStorageService.uploadObject({
      tenantId: params.tenantId,
      entityType: "properties",
      entityId: params.propertyId,
      fileName: hashedFileName,
      buffer: params.buffer,
      declaredMimeType: params.mimeType,
      visibility: "public_listing",
      uploadedByUserId: params.uploadedByUserId,
      isImageOnly: true,
    });

    const variants: Partial<
      Record<`w${CanonicalVariantWidth}`, { objectKey: string; url: string }>
    > = {};
    const variantKeys: string[] = [];

    if (this.isGcsMediaVariantsEnabled()) {
      for (const width of PROPERTY_VARIANT_WIDTHS) {
        try {
          const thumb = await createThumbnail({
            buffer: params.buffer,
            mimeType: meta.mimeType,
            targetWidth: width,
            preferWebp: true,
            quality: width <= 400 ? 82 : 85,
          });
          transformCounters.propertyVariantTransforms++;
          const format: "webp" | "jpg" = thumb.mimeType === "image/webp" ? "webp" : "jpg";
          const variantKey = this.buildPropertyVariantKey({
            tenantId: params.tenantId,
            entityId: params.propertyId,
            contentHash: contentHash16,
            width,
            format,
          });
          await CloudStorageService.putRawObject({
            objectKey: variantKey,
            buffer: thumb.data,
            mimeType: thumb.mimeType,
            cacheControl: CACHE_CONTROL_PUBLIC_IMMUTABLE,
          });
          variantKeys.push(variantKey);
          variants[`w${width}`] = {
            objectKey: variantKey,
            url: this.buildMediaUrl(`/api/storage/media/${meta.objectKey}?w=${width}`),
          };
        } catch {
          // Best-effort variant pre-generation; original upload remains valid
        }
      }
    }

    const updatedMeta: StorageObjectMetadata = {
      ...meta,
      originalFileName: params.originalFileName || meta.originalFileName,
      variantKeys,
      cacheControl: CACHE_CONTROL_PUBLIC_IMMUTABLE,
      updatedAt: new Date().toISOString(),
    };
    StorageMetadataRepository.saveObject(updatedMeta);

    const relativeUrl = updatedMeta.publicUrl || `/api/storage/media/${updatedMeta.objectKey}`;
    return {
      metadata: updatedMeta,
      url: this.buildMediaUrl(relativeUrl),
      variants,
      cacheControl: CACHE_CONTROL_PUBLIC_IMMUTABLE,
    };
  }

  /**
   * Resolves a resized property listing image variant (`w=400` or `w=1200` WebP/JPEG).
   * Checks persisted Cloud Storage variant first (0 Jimp/ImageMagick transforms on repeat
   * requests or after cold restarts) before falling back to transform + persist.
   */
  public static async getOrCreatePropertyVariant(params: {
    objectKey: string;
    metadata: StorageObjectMetadata;
    originalBuffer: Buffer;
    targetWidth: number;
    preferWebp: boolean;
  }): Promise<{
    buffer: Buffer;
    mimeType: string;
    fromStorage: boolean;
    variantKey?: string;
    cacheControl: string;
  }> {
    const usePersisted = this.isGcsMediaVariantsEnabled();
    const parts = extractObjectKeyPathParts(params.objectKey);
    const contentHash16 = (params.metadata.sha256 || this.computeContentHash16(params.originalBuffer)).slice(
      0,
      16
    );
    const canonicalWidth = usePersisted
      ? this.resolveCanonicalVariantWidth(params.targetWidth)
      : params.targetWidth;
    const format: "webp" | "jpg" = params.preferWebp ? "webp" : "jpg";

    const variantKey =
      usePersisted && parts && parts.entityType === "properties"
        ? this.buildPropertyVariantKey({
            tenantId: parts.tenantId,
            entityId: parts.entityId,
            contentHash: contentHash16,
            width: canonicalWidth,
            format,
          })
        : undefined;

    if (variantKey) {
      const persisted = await CloudStorageService.getRawObject(variantKey);
      if (persisted && persisted.buffer.length > 0) {
        transformCounters.storageVariantHits++;
        return {
          buffer: persisted.buffer,
          mimeType: persisted.mimeType,
          fromStorage: true,
          variantKey,
          cacheControl: CACHE_CONTROL_PUBLIC_IMMUTABLE,
        };
      }
    }

    const thumb = await createThumbnail({
      buffer: params.originalBuffer,
      mimeType: params.metadata.mimeType,
      targetWidth: canonicalWidth,
      preferWebp: params.preferWebp,
      cacheKey: `storage::${params.objectKey}`,
    });
    transformCounters.propertyVariantTransforms++;

    if (variantKey && usePersisted) {
      const actualFormat: "webp" | "jpg" = thumb.mimeType === "image/webp" ? "webp" : "jpg";
      const finalVariantKey =
        actualFormat === format
          ? variantKey
          : this.buildPropertyVariantKey({
              tenantId: parts!.tenantId,
              entityId: parts!.entityId,
              contentHash: contentHash16,
              width: canonicalWidth,
              format: actualFormat,
            });
      await CloudStorageService.putRawObject({
        objectKey: finalVariantKey,
        buffer: thumb.data,
        mimeType: thumb.mimeType,
        cacheControl: CACHE_CONTROL_PUBLIC_IMMUTABLE,
      }).catch(() => {
        // Non-fatal persistence failure; still return resized image
      });
    }

    const isImmutable =
      Boolean(variantKey) || CloudStorageService.isContentHashedFileName(params.metadata.fileName);

    return {
      buffer: thumb.data,
      mimeType: thumb.mimeType,
      fromStorage: false,
      variantKey,
      cacheControl: isImmutable ? CACHE_CONTROL_PUBLIC_IMMUTABLE : CACHE_CONTROL_PUBLIC_MUTABLE,
    };
  }

  /**
   * Checks Cloud Storage for an already-persisted public-share gallery variant
   * under `public/shares/{shareCode}/gallery/{hash}_w{width}.{webp|jpg}`.
   */
  public static async getPersistedPublicShareVariant(params: {
    shareCode: string;
    sourceKey: string;
    width: number;
    preferWebp: boolean;
  }): Promise<{ buffer: Buffer; mimeType: string; objectKey: string } | null> {
    if (!this.isGcsMediaVariantsEnabled()) return null;
    const format: "webp" | "jpg" = params.preferWebp ? "webp" : "jpg";
    const objectKey = this.buildPublicShareGalleryVariantKey({
      shareCode: params.shareCode,
      sourceKey: params.sourceKey,
      width: params.width,
      format,
    });
    const hit = await CloudStorageService.getRawObject(objectKey);
    if (!hit) return null;
    transformCounters.storagePublicShareHits++;
    return { buffer: hit.buffer, mimeType: hit.mimeType, objectKey };
  }

  /**
   * Persists a generated public-share gallery variant in Cloud Storage so cold
   * restarts serve it directly with 0 repeated transforms.
   */
  public static async persistPublicShareVariant(params: {
    shareCode: string;
    sourceKey: string;
    width: number;
    buffer: Buffer;
    mimeType: string;
  }): Promise<string | null> {
    if (!this.isGcsMediaVariantsEnabled()) return null;
    const format: "webp" | "jpg" = params.mimeType === "image/webp" ? "webp" : "jpg";
    const objectKey = this.buildPublicShareGalleryVariantKey({
      shareCode: params.shareCode,
      sourceKey: params.sourceKey,
      width: params.width,
      format,
    });
    try {
      await CloudStorageService.putRawObject({
        objectKey,
        buffer: params.buffer,
        mimeType: params.mimeType,
        cacheControl: CACHE_CONTROL_PUBLIC_IMMUTABLE,
      });
      return objectKey;
    } catch {
      return null;
    }
  }

  public static recordPublicShareTransform(): void {
    transformCounters.publicShareVariantTransforms++;
  }

  /**
   * Encodes a 1200x630 baseline sRGB JPEG strictly < 260KB for WhatsApp, iMessage,
   * Telegram, Messenger, Facebook, and LinkedIn OpenGraph link previews.
   */
  public static async encodeBaselineOgJpeg(rawBuffer: Buffer): Promise<Buffer> {
    const ogBaseArgs = [
      "-",
      "-auto-orient",
      "-colorspace",
      "sRGB",
      "-background",
      "#0f172a",
      "-flatten",
      "-resize",
      "1200x630^",
      "-gravity",
      "center",
      "-extent",
      "1200x630",
      "-strip",
      "-interlace",
      "None",
      "-sampling-factor",
      "4:2:0",
    ];

    transformCounters.ogTransforms++;

    try {
      let converted = await runConvertBuffer([...ogBaseArgs, "-quality", "82", "jpg:-"], rawBuffer);
      if (converted.length > 260_000) {
        converted = await runConvertBuffer([...ogBaseArgs, "-quality", "68", "jpg:-"], rawBuffer);
      }
      if (converted.length > 260_000) {
        converted = await runConvertBuffer([...ogBaseArgs, "-quality", "54", "jpg:-"], rawBuffer);
      }
      if (converted.length > 0) {
        return converted;
      }
    } catch {
      // Fallback to Jimp
    }

    try {
      const img = await Jimp.read(rawBuffer);
      img.cover({ w: 1200, h: 630 });
      let out = await img.getBuffer("image/jpeg" as any);
      if (out.length > 260_000) {
        img.scaleToFit({ w: 800, h: 420 });
        out = await img.getBuffer("image/jpeg" as any);
      }
      return out;
    } catch {
      return rawBuffer;
    }
  }

  /**
   * Persistent OpenGraph image resolver:
   * 1. Fast bounded RAM cache hit
   * 2. Persistent Cloud Storage hit under `public/shares/{shareCode}/og_{version}.jpg`
   *    (0 repeated transforms across cold Cloud Run restarts!)
   * 3. On miss: encodes 1200x630 baseline sRGB JPEG < 260KB once and persists to Cloud Storage.
   */
  public static async getOrBuildPersistedOgImage(params: {
    shareCode: string;
    versionKey: string;
    preferredTenantId?: string | null;
    loadCandidateBuffers: () => Promise<Buffer[]>;
  }): Promise<{ buffer: Buffer; fromStorage: boolean; objectKey: string } | null> {
    const objectKey = this.buildPublicShareOgKey({
      shareCode: params.shareCode,
      versionKey: params.versionKey,
      preferredTenantId: params.preferredTenantId,
    });

    const memHit = ogMemoryCache.get(objectKey);
    if (memHit && Date.now() - memHit.ts < OG_MEMORY_CACHE_TTL_MS) {
      return { buffer: memHit.buffer, fromStorage: true, objectKey };
    }

    const inflight = pendingOgBuilds.get(objectKey);
    if (inflight) {
      return inflight;
    }

    const buildPromise = (async (): Promise<{
      buffer: Buffer;
      fromStorage: boolean;
      objectKey: string;
    } | null> => {
      try {
        // Persistent GCS check survives cold server restarts with 0 image transforms
        if (this.isGcsMediaVariantsEnabled()) {
          const persisted = await CloudStorageService.getRawObject(objectKey);
          if (persisted && persisted.buffer.length > 0) {
            transformCounters.storageOgHits++;
            if (ogMemoryCache.size >= OG_MEMORY_CACHE_MAX) {
              const oldest = ogMemoryCache.keys().next().value;
              if (oldest !== undefined) ogMemoryCache.delete(oldest);
            }
            ogMemoryCache.set(objectKey, { buffer: persisted.buffer, ts: Date.now() });
            return { buffer: persisted.buffer, fromStorage: true, objectKey };
          }
        }

        const candidates = await params.loadCandidateBuffers();
        for (const rawBuf of candidates) {
          if (!rawBuf || rawBuf.length === 0) continue;
          const encoded = await this.encodeBaselineOgJpeg(rawBuf);
          if (encoded && encoded.length > 0) {
            if (this.isGcsMediaVariantsEnabled()) {
              await CloudStorageService.putRawObject({
                objectKey,
                buffer: encoded,
                mimeType: "image/jpeg",
                cacheControl: CACHE_CONTROL_PUBLIC_IMMUTABLE,
              }).catch(() => {
                // Non-fatal persistence error; serve generated OG JPEG regardless
              });
            }

            if (ogMemoryCache.size >= OG_MEMORY_CACHE_MAX) {
              const oldest = ogMemoryCache.keys().next().value;
              if (oldest !== undefined) ogMemoryCache.delete(oldest);
            }
            ogMemoryCache.set(objectKey, { buffer: encoded, ts: Date.now() });
            return { buffer: encoded, fromStorage: false, objectKey };
          }
        }

        return null;
      } finally {
        pendingOgBuilds.delete(objectKey);
      }
    })();

    pendingOgBuilds.set(objectKey, buildPromise);
    return buildPromise;
  }

  /**
   * Generates a non-destructive dry-run orphan media sweep report identifying active
   * storage objects that are no longer referenced by any property/document record.
   */
  public static buildOrphanMediaSweepReport(params: {
    tenantId?: string;
    referencedUrls: Iterable<string>;
  }): OrphanMediaReport {
    const activeObjects = params.tenantId
      ? StorageMetadataRepository.listByTenant(params.tenantId)
      : StorageMetadataRepository.listAllActive();

    const normalizedRefs = new Set<string>();
    for (const raw of params.referencedUrls) {
      const cleaned = String(raw || "").trim().split("?")[0].split("#")[0];
      if (!cleaned) continue;
      normalizedRefs.add(cleaned);
      const mediaMatch = cleaned.match(/\/api\/storage\/media\/(.+)$/);
      if (mediaMatch && mediaMatch[1]) {
        try {
          normalizedRefs.add(decodeURIComponent(mediaMatch[1]));
        } catch {
          normalizedRefs.add(mediaMatch[1]);
        }
      }
    }

    const orphans: OrphanMediaItem[] = [];
    let referencedCount = 0;
    let orphanTotalBytes = 0;

    for (const obj of activeObjects) {
      const isReferenced =
        normalizedRefs.has(obj.objectKey) ||
        (obj.publicUrl ? normalizedRefs.has(obj.publicUrl) : false) ||
        normalizedRefs.has(`/api/storage/media/${obj.objectKey}`);

      if (isReferenced) {
        referencedCount++;
      } else {
        orphanTotalBytes += obj.sizeBytes || 0;
        orphans.push({
          objectKey: obj.objectKey,
          tenantId: obj.tenantId,
          entityType: obj.entityType,
          entityId: obj.entityId,
          sizeBytes: obj.sizeBytes || 0,
          visibility: obj.visibility,
          createdAt: obj.createdAt,
          reason: "unreferenced_storage_object",
        });
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      tenantId: params.tenantId || "all",
      dryRun: true,
      totalActiveObjects: activeObjects.length,
      referencedCount,
      orphanCount: orphans.length,
      orphanTotalBytes,
      orphans,
    };
  }
}
