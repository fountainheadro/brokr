import "dotenv/config";
import express from "express";
import compression from "compression";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { spawn } from "child_process";
import axios from "axios";
import sharp from "sharp";
import { convert } from "html-to-text";
import * as cheerio from "cheerio";
import { aiCallRouter, setupWebSocket } from "./server/ai-call/router";
import { setupBackgroundNotifications, registerNotificationRoutes } from "./server/background-notifications";
import { serverExtractBasicData, serverExtractData } from "./server/geminiService";
import crypto from "crypto";
import { mwAuthentication } from "./server/middleware/mw_authentication";
import { mwPlatformAuthorization } from "./server/middleware/mw_platform-authorization";
import { requireTenantContext } from "./server/middleware/mw_tenant-context";
import { requireQuota } from "./server/middleware/mw_entitlement";
import { requireWorkerOidc } from "./server/middleware/mw_worker-oidc";
import { internalWorkersRouter, workerAdminRouter } from "./server/workers/rtr_internal-workers";
import { portalsRouter } from "./server/portals/rtr_portals";
import { PortalPublishingOrchestrator } from "./src/core/portals/svc_portal-orchestrator";
import { safeAxiosGet, safeFetchExternal, validateSafeExternalUrl, DEFAULT_MAX_EXTERNAL_BYTES } from "./server/security/sec_url-validator";
import { createRateLimiter } from "./server/middleware/mw_rate-limiter";
import { mwObservability } from "./server/middleware/mw_observability";
import { logger } from "./src/core/logger/logger";
import { sanitizePublicProperty } from "./server/security/sec_public-sanitizer";
import {
  resolvePublicDisplayTitle,
  resolvePublicDisplayDescription,
  extractOrderedPublicImageUrls,
  resolvePublicFirstImageUrl,
  formatOpenGraphDescription,
  getImageIdentityKey,
  normalizeStoredImageUrl,
} from "./src/utils/publicContentUtils";
import {
  createPublicImageToken,
  verifyPublicImageToken,
  resolveInlinePublicDataUrl,
  applyPublicImageProtections,
  getPersistedProtectedPublicImage,
} from "./server/security/sec_public-media";
import {
  CACHE_CONTROL_PUBLIC_IMMUTABLE,
  MediaPipelineService,
} from "./server/media/svc_media-pipeline";
import { DailyQuotaTracker } from "./server/monitoring/svc_daily-quota-tracker";
import {
  FirestoreQuotaExceededError,
  isFirestoreQuotaError,
  PublicPropertyCacheService,
} from "./src/core/cache/svc_public-property-cache";
import {
  invalidateEntityPublicShareCaches,
  registerPublicShareWarmer,
} from "./server/cache/svc_share-cache-invalidator";
import { detectImageMagicBytes } from "./server/security/sec_image-validator";
import { detectLogoBoxes, inpaintLogoBox } from "./server/security/sec_logo-inpainter";
import {
  createThumbnail,
  parseThumbnailWidth,
  shouldServeWebp,
  clearThumbnailCacheByPrefix,
} from "./server/utils/img_thumbnail";
import {
  extractNextAdDataFromParsed,
  extractStoriaNextDataAndPhotos,
} from "./server/utils/storiaPhotoExtractor";
import {
  isImobiliareUrl,
  extractImobiliareGalleryPhotos,
  mergeImobiliareGalleryResults,
  upgradeRemainingImobiliareThumbnails,
  extractImobiliareGalleryViaBrowser,
  getImobiliarePhotoKey,
  scoreImobiliareImageResolution,
  parseSrcsetCandidates,
  isImobiliareThumbnailUrl,
  isImobiliareNonGalleryAsset,
} from "./server/utils/imobiliarePhotoExtractor";
import {
  extractPhoneFromOlxHtml,
  extractPhoneFromVisibleText,
  extractValidRoPhone,
  revealOlxPhoneByClick,
} from "./server/utils/olxPhoneExtractor";
import { assertProductionEnvironment } from "./src/core/env/svc_production-config";
import {
  ServerLifecycleController,
  registerHealthRoutes,
  attachGracefulShutdown,
} from "./src/core/runtime/svc_server-lifecycle";
import { PersistentStoreService } from "./src/core/database/svc_persistent-store";
import { tenantRouter } from "./server/tenant/rtr_tenant";
import { aiRouter } from "./server/ai/rtr_ai";
import { platformRouter } from "./server/platform/rtr_platform";
import { previewRouter } from "./server/preview/rtr_preview";
import { migrationRouter } from "./server/migration/rtr_migration";
import { storageRouter } from "./server/storage/rtr_storage";
import { crmRouter } from "./server/crm/rtr_crm";
import { automationRouter } from "./server/automation/rtr_automation";
import { AutomationConfigRepository } from "./src/core/automation/repo_automation-config";
import { resolveAreaFromAd } from "./src/utils/zoneResolutionUtils";
import { normalizeTitleAutomationRule, TitleAutomationRule } from "./src/core/automation/typ_title-automation";
import { CrmTenantStoreService } from "./src/core/crm/svc_crm-tenant-store";
import { CloudStorageService } from "./src/core/storage/svc_cloud-storage";
import {
  TenantResolutionService,
  resolveEffectiveRootDomain,
} from "./src/core/tenancy/svc_tenant-resolution";
import { TenantMembershipService } from "./src/core/tenancy/svc_tenant-membership";
import { PreviewSessionService } from "./src/core/tenancy/svc_preview-session";
import { BillingManager } from "./src/core/subscription/svc_billing-manager";
import { QuotaService } from "./src/core/subscription/svc_quota";
import { TelemetryCollectorService } from "./src/core/telemetry/svc_telemetry-collector";


import { GoogleGenAI, Type } from "@google/genai";
import { defaultFormats, defaultPlugins } from "jimp";
import { createJimp } from "@jimp/core";
import webp from "@jimp/wasm-webp";
import { generateStandardAdTitle } from "./src/utils/propertyTitleGenerator";
import {
  buildOlxSearchUrls,
  DEFAULT_OLX_LEAD_FILTERS,
  matchesOlxLeadFilter,
  type OlxLeadFilters,
} from "./src/utils/olxFilterUtils";

// ESM/CJS compatibility for paths
const getDirname = () => {
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch (e) {
    // @ts-ignore
    return __dirname;
  }
};

const __dirname = getDirname();

// Intercept global fetch so we can load @jsquash/webp WASM files locally instead of triggering sandbox fetch errors
const originalFetch = global.fetch;
global.fetch = async function(input: any, init: any) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input && input.url ? input.url : "");
  if (url && (url.endsWith(".wasm") || url.includes(".wasm"))) {
    const fileName = path.basename(url.split("?")[0]);
    let wasmPath = "";
    if (fileName.includes("dec")) {
      wasmPath = path.resolve("./node_modules/@jsquash/webp/codec/dec", fileName);
    } else if (fileName.includes("enc")) {
      wasmPath = path.resolve("./node_modules/@jsquash/webp/codec/enc", fileName);
    }
    
    if (wasmPath && fs.existsSync(wasmPath)) {
      const buffer = fs.readFileSync(wasmPath);
      return new Response(buffer, {
        headers: { "Content-Type": "application/wasm" }
      });
    }
  }
  return originalFetch(input, init);
} as any;

const Jimp = createJimp({
  formats: [...defaultFormats, webp],
  plugins: defaultPlugins
});

const ai = new GoogleGenAI({ 
  apiKey: process.env.GEMINI_API_KEY || "",
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build"
    }
  }
});

interface CleanedImageCacheEntry {
  mimeType: string;
  data: Buffer;
  inpaintedBoxes?: number;
}
const imageCleanCache = new Map<string, CleanedImageCacheEntry>();
const pendingImageCleans = new Map<string, Promise<CleanedImageCacheEntry | null>>();

function isAggressiveWatermarkSource(urlStr: string): boolean {
  const lower = String(urlStr || "").toLowerCase();
  return (
    lower.includes("storia.ro") ||
    lower.includes("olxcdn.com") ||
    lower.includes("akamaized.net") ||
    lower.includes("roamcdn.net") ||
    lower.includes("imobiliare.ro") ||
    lower.includes("publi24") ||
    lower.includes("pstatic") ||
    lower.includes("pcdnh")
  );
}

function getImageCacheKey(cleanUrl: string, aggressive: boolean): string {
  return aggressive ? `${cleanUrl}::aggressive` : cleanUrl;
}

function evictImageCachesForUrl(cleanUrl: string): void {
  imageCleanCache.delete(cleanUrl);
  imageCleanCache.delete(`${cleanUrl}::aggressive`);
  pendingImageCleans.delete(cleanUrl);
  pendingImageCleans.delete(`${cleanUrl}::aggressive`);
  clearThumbnailCacheByPrefix(`proxy::${cleanUrl}`);
}

function addToImageCache(cacheKey: string, entry: CleanedImageCacheEntry) {
  if (imageCleanCache.size > 600) {
    const keys = Array.from(imageCleanCache.keys());
    for (let idx = 0; idx < 120; idx++) {
      imageCleanCache.delete(keys[idx]);
    }
  }
  imageCleanCache.set(cacheKey, entry);
}

async function execConvert(args: string[], inputBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn("convert", args, { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let totalBytes = 0;
    const maxOutBytes = 30 * 1024 * 1024;
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        proc.kill("SIGKILL");
      } catch {}
      reject(new Error("ImageMagick convert timeout"));
    }, 15000);

    proc.stdout.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxOutBytes) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          proc.kill("SIGKILL");
        } catch {}
        reject(new Error("ImageMagick output exceeded limit"));
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
        reject(new Error(`convert exited with code ${code}: ${Buffer.concat(errChunks).toString("utf8").slice(0, 200)}`));
      }
    });
    proc.stdin.on("error", () => {});
    proc.stdin.end(inputBuffer);
  });
}

function parseOlxPrerenderedState($: any): any | null {
  let parsed: any = null;
  $("script").each((_, el) => {
    if (parsed) return;
    const raw = $(el).html() || "";
    const marker = "window.__PRERENDERED_STATE__";
    const idx = raw.indexOf(marker);
    if (idx === -1) return;

    let cursor = raw.indexOf("=", idx + marker.length);
    if (cursor === -1) return;
    cursor++;
    while (cursor < raw.length && /\s/.test(raw[cursor])) cursor++;

    const ch = raw[cursor];
    if (ch === '"') {
      let end = cursor + 1;
      let escaped = false;
      while (end < raw.length) {
        const c = raw[end];
        if (escaped) {
          escaped = false;
        } else if (c === "\\") {
          escaped = true;
        } else if (c === '"') {
          break;
        }
        end++;
      }
      if (end < raw.length) {
        try {
          const decodedStr = JSON.parse(raw.slice(cursor, end + 1));
          parsed = typeof decodedStr === "string" ? JSON.parse(decodedStr) : decodedStr;
        } catch {}
      }
    } else if (ch === "{") {
      let depth = 0;
      let inStr = false;
      let escaped = false;
      let end = cursor;
      while (end < raw.length) {
        const c = raw[end];
        if (inStr) {
          if (escaped) escaped = false;
          else if (c === "\\") escaped = true;
          else if (c === '"') inStr = false;
        } else {
          if (c === '"') inStr = true;
          else if (c === "{") depth++;
          else if (c === "}") {
            depth--;
            if (depth === 0) break;
          }
        }
        end++;
      }
      if (depth === 0) {
        try {
          parsed = JSON.parse(raw.slice(cursor, end + 1));
        } catch {}
      }
    }
  });
  return parsed;
}

function isBotChallengePage(html: string): boolean {
  if (!html || typeof html !== "string") return false;
  if (html.length > 60_000) return false;
  const lower = html.toLowerCase();
  if (
    lower.includes("<title>just a moment") ||
    lower.includes("<title>attention required! | cloudflare") ||
    lower.includes("<title>cookie check</title>") ||
    lower.includes("cf-browser-verification") ||
    lower.includes("enable javascript and cookies to continue") ||
    lower.includes("/__cf_chl_")
  ) {
    return true;
  }
  return false;
}

async function cleanImageWatermarksDetailed(
  buffer: Buffer,
  mimeType: string,
  imageUrl: string,
  options: { aggressive?: boolean } = {}
): Promise<{ buffer: Buffer; mimeType: string; inpaintedBoxes: number }> {
  if (!mimeType.startsWith("image/") || mimeType.includes("svg")) {
    return { buffer, mimeType, inpaintedBoxes: 0 };
  }

  const aggressive = Boolean(options.aggressive);
  const inpaintPad = aggressive ? 5 : 3;

  try {
    const isWebP =
      mimeType.includes("webp") ||
      (buffer.length > 12 &&
        buffer[0] === 0x52 &&
        buffer[1] === 0x49 &&
        buffer[2] === 0x46 &&
        buffer[3] === 0x46 &&
        buffer.toString("ascii", 8, 12) === "WEBP");
    const isAvif = mimeType.includes("avif");

    // Fast native C++ libvips path via sharp: avoids spawning ImageMagick `convert` and pure-JS Jimp
    // decoding (50x faster on WebP/JPEG/PNG/AVIF), while feeding the exact `{ width, height, bitmap }`
    // raw RGBA shape expected by detectLogoBoxes() / inpaintLogoBox().
    try {
      const { data: rawRgba, info } = await sharp(buffer, {
        failOn: "none",
        limitInputPixels: 40_000_000,
      })
        .rotate()
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const width = info.width;
      const height = info.height;
      if (width < 200 || height < 200) {
        return { buffer, mimeType, inpaintedBoxes: 0 };
      }

      const sharpImage = {
        width,
        height,
        bitmap: {
          width,
          height,
          data: rawRgba,
        },
      };

      const logoBoxes = detectLogoBoxes(sharpImage, { aggressive });
      if (logoBoxes.length === 0) {
        return { buffer, mimeType, inpaintedBoxes: 0 };
      }

      let totalInpainted = 0;
      for (const box of logoBoxes) {
        console.log(
          `[Logo Inpainter] Inpainting detected logo area (${imageUrl}${aggressive ? ", aggressive" : ""}): x=${box.startX}, y=${box.startY}, w=${box.w}, h=${box.h}`
        );
        inpaintLogoBox(sharpImage, box, { pad: inpaintPad });
        totalInpainted++;
      }

      const residualBoxes = detectLogoBoxes(sharpImage, { aggressive });
      if (residualBoxes.length > 0) {
        for (const box of residualBoxes) {
          console.log(
            `[Logo Inpainter] Second-pass inpainting residual area (${imageUrl}): x=${box.startX}, y=${box.startY}, w=${box.w}, h=${box.h}`
          );
          inpaintLogoBox(sharpImage, box, { pad: inpaintPad });
          totalInpainted++;
        }
      }

      const reencode = sharp(sharpImage.bitmap.data, {
        raw: { width, height, channels: 4 },
      });
      if (isWebP) {
        const cleanedWebp = await reencode.webp({ quality: 90, effort: 3 }).toBuffer();
        return { buffer: cleanedWebp, mimeType: "image/webp", inpaintedBoxes: totalInpainted };
      }
      if (mimeType.includes("jpeg") || mimeType.includes("jpg")) {
        const cleanedJpeg = await reencode
          .flatten({ background: { r: 255, g: 255, b: 255 } })
          .jpeg({ quality: 90, mozjpeg: true })
          .toBuffer();
        return { buffer: cleanedJpeg, mimeType: "image/jpeg", inpaintedBoxes: totalInpainted };
      }
      const cleanedPng = await reencode.png({ compressionLevel: 6 }).toBuffer();
      return { buffer: cleanedPng, mimeType: "image/png", inpaintedBoxes: totalInpainted };
    } catch (sharpErr: any) {
      console.warn("[Watermark Remover] sharp decode failed, falling back to Jimp:", sharpErr?.message);
    }

    let workBuffer = buffer;
    if (isWebP || isAvif) {
      try {
        workBuffer = await execConvert(["-", "png:-"], buffer);
      } catch (convErr: any) {
        console.warn("[Watermark Remover] convert image->png error:", convErr?.message);
      }
    }

    let image: any;
    try {
      image = await Jimp.read(workBuffer);
    } catch {
      try {
        const fallbackPng = await execConvert(["-", "png:-"], buffer);
        image = await Jimp.read(fallbackPng);
      } catch (imErr: any) {
        console.warn("[Watermark Remover] Fallback conversion failed:", imErr?.message);
        return { buffer, mimeType, inpaintedBoxes: 0 };
      }
    }

    const { width, height } = image;

    // Skip tiny images
    if (width < 200 || height < 200) {
      return { buffer, mimeType, inpaintedBoxes: 0 };
    }

    // Detect overlaid logos strictly without AI; if no logo is present, return original image untouched
    const logoBoxes = detectLogoBoxes(image, { aggressive });
    if (logoBoxes.length === 0) {
      return { buffer, mimeType, inpaintedBoxes: 0 };
    }

    let totalInpainted = 0;
    for (const box of logoBoxes) {
      console.log(
        `[Logo Inpainter] Inpainting detected logo area (${imageUrl}${aggressive ? ", aggressive" : ""}): x=${box.startX}, y=${box.startY}, w=${box.w}, h=${box.h}`
      );
      inpaintLogoBox(image, box, { pad: inpaintPad });
      totalInpainted++;
    }

    // Verification pass: ensure no secondary/adjacent watermark fragment remains after first pass
    const residualBoxes = detectLogoBoxes(image, { aggressive });
    if (residualBoxes.length > 0) {
      for (const box of residualBoxes) {
        console.log(
          `[Logo Inpainter] Second-pass inpainting residual area (${imageUrl}): x=${box.startX}, y=${box.startY}, w=${box.w}, h=${box.h}`
        );
        inpaintLogoBox(image, box, { pad: inpaintPad });
        totalInpainted++;
      }
    }

    const cleanedPngBuffer = await image.getBuffer("image/png" as any);
    if (isWebP) {
      try {
        const cleanedWebp = await execConvert(["png:-", "-quality", "92", "webp:-"], cleanedPngBuffer);
        return { buffer: cleanedWebp, mimeType: "image/webp", inpaintedBoxes: totalInpainted };
      } catch {
        return { buffer: cleanedPngBuffer, mimeType: "image/png", inpaintedBoxes: totalInpainted };
      }
    }

    if (mimeType.includes("jpeg") || mimeType.includes("jpg")) {
      const cleanedJpeg = await image.getBuffer("image/jpeg" as any);
      return { buffer: cleanedJpeg, mimeType: "image/jpeg", inpaintedBoxes: totalInpainted };
    }
    return { buffer: cleanedPngBuffer, mimeType: "image/png", inpaintedBoxes: totalInpainted };
  } catch (err: any) {
    console.warn(`[Watermark Remover] Fallback serving original:`, err?.message);
    return { buffer, mimeType, inpaintedBoxes: 0 };
  }
}

async function cleanImageWatermarks(
  buffer: Buffer,
  mimeType: string,
  imageUrl: string,
  options: { aggressive?: boolean } = {}
): Promise<Buffer> {
  const result = await cleanImageWatermarksDetailed(buffer, mimeType, imageUrl, options);
  return result.buffer;
}

function normalizeCleanImageUrl(rawUrl: string): string {
  let cleanUrl = rawUrl.trim();
  if (cleanUrl.startsWith("//")) {
    cleanUrl = "https:" + cleanUrl;
  }
  if (cleanUrl.startsWith("https://") && cleanUrl.includes(":443/")) {
    cleanUrl = cleanUrl.replace(":443/", "/");
  }
  return cleanUrl;
}

const IMAGE_PROXY_SOCIAL_BLOCKED = ["facebook.com", "linkedin.com", "twitter.com", "instagram.com", "youtube.com"];
const IMAGE_PROXY_ASSET_BLOCKLIST = [
  "splash", "manifest", "android-icon", "apple-icon",
  "apple-touch-icon", "favicon", "site-logo", "loading",
  "loader", "default-image", "placeholder"
];

function getCleanImageValidationError(cleanUrl: string): string | null {
  const lowerUrl = cleanUrl.toLowerCase();
  if (IMAGE_PROXY_SOCIAL_BLOCKED.some(s => lowerUrl.includes(s))) {
    return "Social media links are not images";
  }
  if (IMAGE_PROXY_ASSET_BLOCKLIST.some(b => lowerUrl.includes(b))) {
    return "Skipped application assets / placeholders";
  }
  return null;
}

async function fetchAndCleanExternalImage(
  rawUrl: string,
  options: {
    skipClean?: boolean;
    aggressive?: boolean;
    forceRefresh?: boolean;
    maxAttempts?: number;
    timeoutMs?: number;
  } = {}
): Promise<CleanedImageCacheEntry> {
  const cleanUrl = normalizeCleanImageUrl(rawUrl);
  const skipClean = Boolean(options.skipClean);
  const effectiveAggressive = Boolean(options.aggressive || isAggressiveWatermarkSource(cleanUrl));
  const forceRefresh = Boolean(options.forceRefresh);
  const cacheKey = getImageCacheKey(cleanUrl, effectiveAggressive);

  if (forceRefresh) {
    evictImageCachesForUrl(cleanUrl);
  }

  if (!skipClean && !forceRefresh && imageCleanCache.has(cacheKey)) {
    return imageCleanCache.get(cacheKey)!;
  }

  if (!skipClean && !forceRefresh && pendingImageCleans.has(cacheKey)) {
    const shared = await pendingImageCleans.get(cacheKey)!;
    if (shared) return shared;
  }

  const runWork = async (): Promise<CleanedImageCacheEntry> => {
    await validateSafeExternalUrl(cleanUrl);
    const blockedReason = getCleanImageValidationError(cleanUrl);
    if (blockedReason) {
      const err: any = new Error(blockedReason);
      err.isPermanentClientError = true;
      throw err;
    }

    const userAgents = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"
    ];
    let referer = "https://www.google.com/";
    try {
      const urlObj = new URL(cleanUrl);
      referer = `${urlObj.protocol}//${urlObj.hostname}/`;
    } catch {}

    const maxAttempts = options.maxAttempts ?? 3;
    const timeoutMs = options.timeoutMs ?? 8000;
    let lastError: any = null;

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await safeFetchExternal(cleanUrl, {
          responseType: "arraybuffer",
          maxContentLength: DEFAULT_MAX_EXTERNAL_BYTES,
          headers: {
            "User-Agent": userAgents[i % userAgents.length],
            "Accept": "image/webp,image/apng,image/jpeg,image/png,image/*,*/*;q=0.8",
            "Referer": referer,
            "Accept-Language": "ro-RO,ro;q=0.9,en-US;q=0.8,en;q=0.7",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "Sec-Ch-Ua": '"Chromium";v="134", "Not:A-Brand";v="24", "Google Chrome";v="134"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
            "Sec-Fetch-Dest": "image",
            "Sec-Fetch-Mode": "no-cors",
            "Sec-Fetch-Site": "cross-site"
          },
          timeout: timeoutMs,
        });

        if (response.status === 403 || response.status === 429 || response.status === 502 || response.status === 503 || response.status === 504) {
          lastError = new Error(`Site returned ${response.status}`);
          if (i < maxAttempts - 1) {
            await new Promise(r => setTimeout(r, 500));
            continue;
          }
          break;
        }

        if (response.status >= 400) {
          const err: any = new Error(`Upstream HTTP Error ${response.status}`);
          err.isPermanentClientError = true;
          throw err;
        }

        const rawContentType = response.headers["content-type"];
        const contentType = Array.isArray(rawContentType)
          ? rawContentType[0]
          : (typeof rawContentType === "string" ? rawContentType : "image/jpeg");

        if (!contentType.startsWith("image/") && !contentType.includes("octet-stream")) {
          const err: any = new Error(`URL returned ${contentType}, which is not an image type.`);
          err.isPermanentClientError = true;
          throw err;
        }
        if (contentType.includes("svg")) {
          const err: any = new Error("SVG images are not supported");
          err.isPermanentClientError = true;
          throw err;
        }

        const rawBuffer = Buffer.isBuffer(response.data) ? response.data : Buffer.from(response.data);
        if (rawBuffer.length === 0 || rawBuffer.length > DEFAULT_MAX_EXTERNAL_BYTES) {
          const err: any = new Error("Invalid or oversized image payload (max 15MB)");
          err.isPermanentClientError = true;
          throw err;
        }

        const magic = detectImageMagicBytes(rawBuffer);
        if (!magic) {
          const err: any = new Error("Invalid image binary signature (magic bytes check failed)");
          err.isPermanentClientError = true;
          throw err;
        }

        let finalData = rawBuffer;
        let finalContentType = magic.mime;
        let inpaintedBoxes = 0;

        if (!skipClean) {
          const cleaned = await cleanImageWatermarksDetailed(rawBuffer, finalContentType, cleanUrl, {
            aggressive: effectiveAggressive,
          });
          finalData = cleaned.buffer;
          finalContentType = detectImageMagicBytes(finalData)?.mime || cleaned.mimeType || finalContentType;
          inpaintedBoxes = cleaned.inpaintedBoxes;
          const entry: CleanedImageCacheEntry = {
            mimeType: finalContentType,
            data: finalData,
            inpaintedBoxes,
          };
          addToImageCache(cacheKey, entry);
          if (effectiveAggressive) {
            // Also populate the default cache key so any standard proxy request immediately gets the cleaned image
            addToImageCache(cleanUrl, entry);
          }
        }

        return { mimeType: finalContentType, data: finalData, inpaintedBoxes };
      } catch (error: any) {
        if (error?.isPermanentClientError) throw error;
        const msg = String(error?.message || "");
        if (msg.includes("blocat") || msg.includes("SSRF") || msg.includes("maxContentLength")) {
          error.isPermanentClientError = true;
          throw error;
        }
        lastError = error;
      }
    }

    throw lastError || new Error("Failed to fetch image after retries");
  };

  if (skipClean || forceRefresh) {
    return runWork();
  }

  const sharedPromise = runWork()
    .catch((err) => {
      pendingImageCleans.delete(cacheKey);
      throw err;
    })
    .then((entry) => {
      pendingImageCleans.delete(cacheKey);
      return entry;
    });
  pendingImageCleans.set(cacheKey, sharedPromise);
  return sharedPromise;
}

async function preCleanCrawlImages(
  urls: string[],
  options: { aggressive?: boolean; syncBudgetMs?: number } = {}
): Promise<string[]> {
  if (!urls || urls.length === 0) return [];
  const concurrency = 8;
  const syncBudgetMs = options.syncBudgetMs ?? 35000;
  const deadline = Date.now() + syncBudgetMs;
  const keepFlags = new Array<boolean>(urls.length).fill(true);
  const processedFlags = new Array<boolean>(urls.length).fill(false);
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= urls.length) break;
      if (Date.now() > deadline) break;

      const u = urls[idx];
      if (!u || !u.startsWith("http")) {
        processedFlags[idx] = true;
        continue;
      }
      processedFlags[idx] = true;
      try {
        await fetchAndCleanExternalImage(u, {
          skipClean: false,
          aggressive: options.aggressive,
          maxAttempts: 2,
          timeoutMs: 9000,
        });
      } catch (err: any) {
        if (err?.isPermanentClientError) {
          keepFlags[idx] = false;
          console.warn(`[Crawl PreClean] Dropped invalid image ${u}: ${err?.message}`);
        } else {
          // Transient timeout/upstream glitch: keep URL so /api/proxy-image cleans it when requested
          console.warn(`[Crawl PreClean] Transient check failure for ${u}: ${err?.message}`);
        }
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, () => worker()));

  // Never silently skip remaining images (e.g., large Storia.ro galleries with 25-60 photos):
  // continue cleaning every remaining image in the background so 100% are warmed & watermark-cleaned.
  const remainingUrls = urls.filter((u, idx) => !processedFlags[idx] && keepFlags[idx] && u && u.startsWith("http"));
  if (remainingUrls.length > 0) {
    console.log(`[Crawl PreClean] Scheduling background watermark processing for ${remainingUrls.length} remaining image(s).`);
    void (async () => {
      let bgCursor = 0;
      const bgWorker = async () => {
        while (true) {
          const i = bgCursor++;
          if (i >= remainingUrls.length) break;
          const u = remainingUrls[i];
          try {
            await fetchAndCleanExternalImage(u, {
              skipClean: false,
              aggressive: options.aggressive,
              maxAttempts: 2,
              timeoutMs: 10000,
            });
          } catch {}
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, remainingUrls.length) }, () => bgWorker()));
    })();
  }

  return urls.filter((_, idx) => keepFlags[idx]);
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const lifecycle = new ServerLifecycleController("brokr-core-api");

  // Trust exactly 1 reverse proxy hop by default (Cloud Run Google Frontend) so req.ip cannot be spoofed via leftmost X-Forwarded-For
  const parsedTrustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 1);
  app.set("trust proxy", Number.isFinite(parsedTrustProxyHops) && parsedTrustProxyHops >= 0 ? parsedTrustProxyHops : 1);

  const isRunningBundledServer = import.meta.url.includes('/dist/') || (typeof process !== 'undefined' && process.argv[1] && process.argv[1].includes('/dist/'));
  const isProduction = process.env.NODE_ENV === "production" || isRunningBundledServer;

  // Validate required environment configuration (fails fast in production if critical secrets are missing)
  assertProductionEnvironment();

  // Helper to reliably construct absolute canonical public URLs for SSR and OpenGraph tags
  function getBaseUrl(req: express.Request): string {
    const forwardedProto = req.headers['x-forwarded-proto'];
    const proto = typeof forwardedProto === 'string'
      ? forwardedProto.split(',')[0].trim()
      : (req.secure ? 'https' : (req.protocol || 'https'));

    const rawHost =
      req.headers['x-forwarded-host'] ||
      req.get('host') ||
      resolveEffectiveRootDomain();
    const cleanHost = (Array.isArray(rawHost) ? rawHost[0] : rawHost).trim();

    // If running in development on localhost, keep http; otherwise force https for live domain
    const isLocal = cleanHost.includes('localhost') || cleanHost.includes('127.0.0.1');
    const finalProto = isLocal ? proto : 'https';
    return `${finalProto}://${cleanHost}`;
  }

  // Initialize Vite dev server instance early if in development mode so it is accessible to SSR routes
  let vite: any = null;
  if (!isProduction) {
    vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
  }

  // Operational observability & latency telemetry
  app.use(mwObservability);

  // HTTP gzip/deflate compression for HTML, JS, CSS, and JSON payloads (automatically skips images/WebP)
  app.use(
    compression({
      threshold: 1024,
      filter: (req, res) => {
        if (req.headers["x-no-compression"]) return false;
        return compression.filter(req, res);
      },
    })
  );

  // Global Logging Middleware (logs API endpoints and main routes, skips internal module requests)
  app.use((req, res, next) => {
    if (req.url.startsWith("/api") || (!req.url.startsWith("/@") && !req.url.startsWith("/node_modules") && !req.url.startsWith("/src/"))) {
      console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    }
    next();
  });

  // Rate limiters for high-cost / public endpoints
  const aiRouteLimiter = createRateLimiter({
    name: "ai-routes",
    windowMs: 60_000,
    maxRequests: 30,
  });
  const crawlRouteLimiter = createRateLimiter({
    name: "crawl-routes",
    windowMs: 60_000,
    maxRequests: 30,
  });
  const proxyImageLimiter = createRateLimiter({
    name: "proxy-image",
    windowMs: 60_000,
    maxRequests: 300,
  });
  const webhookLimiter = createRateLimiter({
    name: "billing-webhook",
    windowMs: 60_000,
    maxRequests: 120,
  });

  // Legacy read-only /uploads path (Phase 5: never create local upload folders in production;
  // all new uploads persist exclusively to Cloud Storage via MediaPipelineService)
  const uploadsDir = path.resolve("./public/uploads");
  if (!isProduction && !fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  // Cap global JSON/form payloads at 2mb; keep 50mb strictly scoped to media upload routes
  const standardJsonParser = express.json({
    limit: "2mb",
    verify: (req: any, _res, buf) => {
      if (req.originalUrl === "/api/billing/webhook") {
        req.rawBody = buf;
      }
    },
  });
  const mediaUploadJsonParser = express.json({ limit: "50mb" });
  app.use((req, res, next) => {
    if (req.path === "/api/upload-photo" || req.path.startsWith("/api/storage")) {
      return mediaUploadJsonParser(req, res, next);
    }
    return standardJsonParser(req, res, next);
  });
  app.use(express.urlencoded({ extended: true, limit: "2mb" }));

  // Serve uploaded images statically (with optional ?w= thumbnail resizing, disable script sniffing)
  app.use("/uploads", async (req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    const targetWidth = parseThumbnailWidth(req.query.w);
    if (targetWidth && req.method === "GET") {
      try {
        const relPath = decodeURIComponent(req.path || "").replace(/^\/+/, "");
        const resolved = path.resolve(uploadsDir, relPath);
        if (resolved.startsWith(uploadsDir + path.sep) && fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
          const rawBuf = fs.readFileSync(resolved);
          const magic = detectImageMagicBytes(rawBuf);
          if (magic?.mime?.startsWith("image/") && !magic.mime.includes("svg")) {
            const preferWebp = shouldServeWebp(req.headers.accept, req.query.format);
            const thumb = await createThumbnail({
              buffer: rawBuf,
              mimeType: magic.mime,
              targetWidth,
              preferWebp,
              cacheKey: `upload::${relPath}`,
            });
            res.setHeader("Content-Type", thumb.mimeType);
            res.setHeader("Vary", "Accept");
            res.setHeader("Cache-Control", "public, max-age=86400");
            return res.send(thumb.data);
          }
        }
      } catch {
        // Fall back to static handler
      }
    }
    next();
  }, express.static(uploadsDir));


  // Endpoint to store uploaded photos persistently via tenant-isolated CloudStorageService
  app.post("/api/upload-photo", ...requireTenantContext, requireQuota("storage_mb", 1), async (req, res) => {
    let consumedStorageMb = 0;
    const verifiedTenantId = req.tenantContext!.tenantId;
    try {
      const { dataUrl, base64, propertyId, fileName } = req.body;
      const raw = dataUrl || base64;
      if (!raw || typeof raw !== "string") {
        return res.status(400).json({ error: "Missing image data" });
      }

      // Never trust arbitrary client-supplied tenantId; reject any cross-tenant mismatch immediately
      const requestedTenantId =
        typeof req.body?.tenantId === "string" ? req.body.tenantId.trim() : "";
      if (requestedTenantId && requestedTenantId !== verifiedTenantId) {
        return res
          .status(403)
          .json({ error: "Acces interzis: nu puteți încărca imagini pentru altă agenție." });
      }

      let base64Data = raw;
      const matches = raw.match(/^data:([A-Za-z0-9-+\/]+);base64,(.+)$/);
      if (matches) {
        base64Data = matches[2];
      }

      const buffer = Buffer.from(base64Data, "base64");
      if (buffer.length === 0 || buffer.length > 15 * 1024 * 1024) {
        return res.status(400).json({ error: "Invalid image size (max 15MB)" });
      }

      const detected = detectImageMagicBytes(buffer);
      if (!detected) {
        return res.status(400).json({ error: "Unsupported or invalid image binary format" });
      }

      // Clean watermark using detailed non-AI inpainting if present
      let finalBuffer = buffer;
      try {
        finalBuffer = await cleanImageWatermarks(buffer, detected.mime, "upload");
      } catch (inpaintErr) {
        console.warn("[Server] Inpainting on uploaded photo skipped or error:", inpaintErr);
      }

      const finalDetected = detectImageMagicBytes(finalBuffer) || detected;
      const safeName =
        typeof fileName === "string" && fileName.trim()
          ? fileName.trim()
          : `prop_${Date.now()}_${crypto.randomUUID().slice(0, 12)}.${finalDetected.ext}`;
      const entityId =
        typeof propertyId === "string" && propertyId.trim()
          ? propertyId.trim()
          : "unassigned";

      const requiredMb = Math.max(1, Math.ceil(finalBuffer.length / (1024 * 1024)));
      QuotaService.consumeQuota(verifiedTenantId, "storage_mb", requiredMb);
      consumedStorageMb = requiredMb;

      const stored = await MediaPipelineService.storePropertyPhotoWithVariants({
        tenantId: verifiedTenantId,
        propertyId: entityId,
        buffer: finalBuffer,
        mimeType: finalDetected.mime,
        ext: finalDetected.ext,
        originalFileName: safeName,
        uploadedByUserId: req.authUser?.uid || req.tenantContext?.userId || "authenticated_user",
      });

      if (entityId !== "unassigned") {
        invalidateEntityPublicShareCaches([entityId], verifiedTenantId);
      }

      res.json({
        success: true,
        url: stored.url,
        storageKey: stored.metadata.objectKey,
        backend: stored.metadata.backend,
        variants: stored.variants,
        cacheControl: stored.cacheControl,
      });
    } catch (err: any) {
      if (consumedStorageMb > 0) {
        QuotaService.releaseQuota(verifiedTenantId, "storage_mb", consumedStorageMb);
      }
      console.error("[Server] /api/upload-photo error:", err);
      const status = err?.statusCode || 500;
      res.status(status).json({ error: err.message || "Failed to upload photo" });
    }
  });

  // Mount Persistent Cloud Storage Router (Phase 10)
  app.use("/api/storage", storageRouter);

  // Mount AI Call Router
  app.use("/api/ai-call", aiCallRouter);

  // Mount Multi-Tenant Router (tenancy, membership, isolation)
  app.use("/api/tenant", tenantRouter);

  // Mount Agency Automation Rules Router (external ad title rules, etc.)
  app.use("/api/tenant/automation", automationRouter);

  // Mount Server-Authoritative Tenant-Scoped CRM Router (Phase 11)
  app.use("/api/crm", crmRouter);

  // Mount Tenant AI Router (Phase 6: chat, conversations, agency config)
  app.use("/api/tenant/ai", aiRouteLimiter, aiRouter);

  // Mount Platform Super Admin Router
  app.use("/api/platform", platformRouter);

  // Mount Platform Agency Testing & Preview Router (Phase 7)
  app.use("/api/platform/preview", previewRouter);

  // Mount Platform CRM Data Migration Router (Phase 7 & 10)
  app.use("/api/platform/migration", migrationRouter);

  // Mount Billing Webhook Endpoint (verifies HMAC on rawBody; never falls back to mock in production)
  app.post("/api/billing/webhook", webhookLimiter, async (req: any, res) => {
    try {
      const stripeSig = req.headers["stripe-signature"] as string | undefined;
      const mockSig = req.headers["x-webhook-signature"] as string | undefined;
      const isProductionEnv = process.env.NODE_ENV === "production";

      if (isProductionEnv && !stripeSig) {
        return res.status(401).json({ error: "Missing stripe-signature header" });
      }

      const signature = stripeSig || mockSig || "";
      const provider = isProductionEnv || stripeSig ? "stripe" : "mock";
      const payloadForVerification = req.rawBody || JSON.stringify(req.body);

      const result = await BillingManager.processWebhook(payloadForVerification, signature, provider);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || "Webhook processing failed" });
    }
  });

  // Register notification synchronization endpoints
  registerNotificationRoutes(app);

  // Phase 4 liveness (/api/healthz), readiness (/api/readyz), and backward-compatible /api/health probes
  registerHealthRoutes(app, lifecycle);

  // Dev Daily Quota Usage monitor endpoints (strictly RAM-backed: 0 Firestore reads, 0 AI tokens)
  app.get("/api/dev/quota-usage", mwAuthentication, (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      success: true,
      data: DailyQuotaTracker.getSnapshot(),
    });
  });

  app.post("/api/dev/quota-usage", mwAuthentication, (req, res) => {
    const deltas = req.body?.clientDeltas;
    if (deltas && typeof deltas === "object") {
      DailyQuotaTracker.recordFirestoreOps({
        reads: Number(deltas.reads) || 0,
        writes: Number(deltas.writes) || 0,
        deletes: Number(deltas.deletes) || 0,
        source: "client",
      });
    }
    res.setHeader("Cache-Control", "no-store");
    res.json({
      success: true,
      data: DailyQuotaTracker.getSnapshot(),
    });
  });

  // Phase 6 OIDC-protected internal workers (Cloud Scheduler & Cloud Tasks)
  app.use("/internal/workers", internalWorkersRouter);

  // Phase 6 Super Admin & Agency Admin worker status / outbox DLQ replay routes
  app.use("/api/workers", workerAdminRouter);

  // Phase 7 External Property Portal Publishing Foundation (mock provider only; feature-flagged UI)
  PortalPublishingOrchestrator.registerOutboxHandlers();
  app.use("/api/portals", portalsRouter);

  // Internal worker OIDC verification probe (Cloud Tasks / Cloud Scheduler SA authentication)
  app.post("/api/internal/workers/ping", requireWorkerOidc(), (req, res) => {
    res.json({
      success: true,
      data: {
        worker: req.workerIdentity?.email || null,
        audience: req.workerIdentity?.audience || null,
        timestamp: new Date().toISOString(),
      },
    });
  });

  const resolveTitleAutomationRuleForReq = (req: any): TitleAutomationRule => {
    try {
      let tenantId = String(req?.tenantContext?.tenantId || req?.auth?.tenantId || "").trim();
      if (!tenantId) {
        const rawHost =
          (req.headers?.["x-forwarded-host"] as string) ||
          (req.headers?.host as string) ||
          req.hostname ||
          "";
        const devOverride =
          (req.headers?.["x-tenant-override"] as string) ||
          (req.query?.simulate_tenant as string) ||
          null;
        const resolved = TenantResolutionService.resolveDomain(
          rawHost,
          devOverride,
          process.env.NODE_ENV === "production"
        );
        if (resolved?.tenantId) tenantId = resolved.tenantId;
      }
      if (tenantId) {
        return AutomationConfigRepository.getByTenantId(tenantId).titleRule;
      }
      if (req.body?.titleAutomationRule && typeof req.body.titleAutomationRule === "object") {
        return normalizeTitleAutomationRule(req.body.titleAutomationRule);
      }
      return AutomationConfigRepository.getByTenantId("ten_brokr_default").titleRule;
    } catch {
      return AutomationConfigRepository.getByTenantId("ten_brokr_default").titleRule;
    }
  };

  // API endpoint to extract basic data using server-side Gemini
  app.post("/api/extract-basic", ...requireTenantContext, aiRouteLimiter, requireQuota("ai_requests", 1), async (req, res) => {
    let reservationId: string | null = null;
    try {
      const { content, title } = req.body;
      const cleanContent = (content || "").trim();
      const cleanTitle = (title || "").trim();
      if (!cleanContent && !cleanTitle) {
        return res.status(400).json({ error: "Content and Title parameters are required" });
      }
      const finalTitle = cleanTitle || "Proprietate imobiliară";
      const finalContent = cleanContent || finalTitle;
      const titleRule = resolveTitleAutomationRuleForReq(req);

      const tenantId = req.tenantContext!.tenantId;
      const estimatedTokens = Math.max(500, Math.min(4000, Math.ceil((finalContent.length + finalTitle.length) / 3)));
      reservationId = QuotaService.reserveAiQuota(tenantId, estimatedTokens);

      console.log(`[Server] Process /api/extract-basic for Title: ${finalTitle}`);
      let actualTokens: number | null = null;
      const result = await serverExtractBasicData(finalContent, finalTitle, titleRule, {
        tenantId,
        onUsage: (usage) => {
          if (usage.totalTokens > 0) actualTokens = usage.totalTokens;
        },
      });
      QuotaService.commitAiQuota(reservationId, actualTokens ?? estimatedTokens);
      res.json(result);
    } catch (e: any) {
      if (reservationId) QuotaService.refundAiQuota(reservationId);
      console.error("[Server] /api/extract-basic error:", e);
      res.status(e?.statusCode || 500).json({ error: e.message || "Failed to extract basic data" });
    }
  });

  // API endpoint to extract full structured data using server-side Gemini
  app.post("/api/extract-data", ...requireTenantContext, aiRouteLimiter, requireQuota("ai_requests", 1), async (req, res) => {
    let reservationId: string | null = null;
    try {
      const { content, title, imageUrls, propertyId, propertyUrl } = req.body;
      const cleanContent = (content || "").trim();
      const cleanTitle = (title || "").trim();
      if (!cleanContent && !cleanTitle) {
        return res.status(400).json({ error: "Content and Title parameters are required" });
      }
      const finalTitle = cleanTitle || "Proprietate imobiliară";
      const finalContent = cleanContent || finalTitle;
      const titleRule = resolveTitleAutomationRuleForReq(req);

      const tenantId = req.tenantContext!.tenantId;
      const estimatedTokens = Math.max(1200, Math.min(8000, Math.ceil((finalContent.length + finalTitle.length) / 2)));
      reservationId = QuotaService.reserveAiQuota(tenantId, estimatedTokens);

      console.log(`[Server] Process /api/extract-data for Property ID: ${propertyId || "GOL"}`);
      let actualTokens: number | null = null;
      const result = await serverExtractData(
        finalContent,
        finalTitle,
        imageUrls,
        propertyId,
        propertyUrl,
        titleRule,
        {
          tenantId,
          onUsage: (usage) => {
            if (usage.totalTokens > 0) actualTokens = usage.totalTokens;
          },
        }
      );
      QuotaService.commitAiQuota(reservationId, actualTokens ?? estimatedTokens);
      res.json(result);
    } catch (e: any) {
      if (reservationId) QuotaService.refundAiQuota(reservationId);
      console.error("[Server] /api/extract-data error:", e);
      res.status(e?.statusCode || 500).json({ error: e.message || "Failed to extract content data" });
    }
  });

  // API endpoint for optional on-demand AI generation of title and description
  app.post("/api/generate-ai-text", ...requireTenantContext, aiRouteLimiter, requireQuota("ai_requests", 1), async (req, res) => {
    const syncDescriptionHeadingTitle = (desc: string, finalTitle: string): string => {
      if (!desc || !finalTitle) return desc;
      return desc.replace(/^((?:📌[^\n]*\n)?(?:🏡|🏢)\s*).+$/m, `$1${finalTitle}`);
    };

    const generateLocalTemplateText = (body: any) => {
      const { category, transactionType, zone, price, specs, propertyId, forcedTitle, originalTitle, originalDescription } = body;
      const cat = category || "Apartament";
      const z = zone || "București";
      const p = price || "N/A";
      const idStr = propertyId ? String(propertyId).trim() : "";
      const camere = specs?.detalii?.camere || "2";
      const suprafata = specs?.suprafete?.utila || "";
      const etaj = specs?.detalii?.etaj || "-";
      const bai = specs?.detalii?.bai || "1";
      const compartimentare = specs?.detalii?.compartimentare || "decomandat";

      const resolvedTitle =
        (typeof forcedTitle === "string" && forcedTitle.trim()) ||
        generateStandardAdTitle({
          transactionType,
          categoria: cat,
          camere,
          suprafataUtila: suprafata,
          etaj,
          zona: z,
          compartimentare,
          propertyId: idStr,
          rawTitle: originalTitle || "",
          rawText: originalDescription || "",
        }) ||
        `${cat} ${camere} camere | ${z} | Mutare imediată`;

      const isRent = transactionType === "Închiriere";
      const transLabel = isRent ? "ÎNCHIRIERE" : "VÂNZARE";
      const isCommercial = /birou|comercial|industrial|hala|depozit/i.test(String(cat));

      if (isCommercial) {
        const description = `📌 ID Proprietate: ${idStr}
🏢 ${resolvedTitle}

Spațiu pregătit pentru activitate, situat în ${z}, cu acces rapid, expunere bună și configurare eficientă pentru multiple tipuri de business.

Potrivit pentru retail, showroom, office, clinică, beauty, servicii sau activități comerciale mixte.

━━━━━━━━━━━━━━━━━━

⭐ PUNCTE CHEIE

- ${suprafata ? `${suprafata} mp utili` : "suprafață eficientă"}
- ${compartimentare}
- vizibilitate comercială foarte bună
- acces facil pentru clienți și aprovizionare
- disponibil imediat
- flexibil pentru multiple activități

━━━━━━━━━━━━━━━━━━

🛠️ SPAȚIUL

- ${camere || "1"} încăperi
- ${bai} băi
- etaj ${etaj}

━━━━━━━━━━━━━━━━━━

📍 LOCAȚIE & ACCES

Situat în ${z}, cu acces rapid către:

- transport public
- zone office & comerciale
- artere principale

━━━━━━━━━━━━━━━━━━

💼 CONDIȚII ${transLabel}

- ${isRent ? `chirie: ${p}` : `preț: ${p}`}
${isRent ? "- garanție: 1 lună\n" : ""}- disponibilitate: imediată

━━━━━━━━━━━━━━━━━━

🤝 SUPORT ${transLabel}

- consultanță dedicată din partea agenției brokr
- suport negociere și contractare
- analiză compatibilitate activitate
- posibilitate de vizionare rapidă și flexibilă

📞 Pentru vizionare sau detalii suplimentare, contactează-ne telefonic.`;
        return { title: resolvedTitle, description };
      }

      const description = `📌 ID ${idStr}
🏡 ${resolvedTitle}

${suprafata ? `${suprafata} mp utili, ` : ""}proprietate spațioasă și luminoasă, situată în zona ${z}, oferind acces facil către toate punctele de interes din oraș.
Spațiul este ideal atât pentru locuință, cât și pentru investiție.

━━━━━━━━━━━━━━━━━━

⭐ AVANTAJE PRINCIPALE

-${compartimentare}
-amplasare excelentă în zonă liniștită
-lumină naturală generoasă pe parcursul întregii zile
-acces rapid la mijloacele de transport în comun

━━━━━━━━━━━━━━━━━━

🛋️ DOTĂRI

-centrală proprie
-finisaje moderne și calitate superioară
-spații bine organizate pentru depozitare

━━━━━━━━━━━━━━━━━━

📍 LOCAȚIE

Acces rapid către:
-mijloace de transport în comun
-magazine, supermarketuri și centre comerciale
-zone verzi și parcuri în apropiere

━━━━━━━━━━━━━━━━━━

💰 ${transLabel}

${isRent ? `${p}\n1 lună garanție\nComision 50% + TVA\nDisponibil imediat` : `${p}\nDisponibil imediat`}

━━━━━━━━━━━━━━━━━━

🤝 SUPORT ${transLabel}

-consultanță dedicată din partea agenției brokr
-asistență completă în întocmirea contractului și înregistrarea ANAF
-posibilitate de vizionare rapidă și flexibilă

📞 Pentru vizionare sau detalii suplimentare, contactează-ne telefonic.`;

      return { title: resolvedTitle, description };
    };

    let reservationId: string | null = null;
    try {
      const { category, transactionType, zone, price, specs, originalTitle, originalDescription, propertyId, forcedTitle } = req.body;
      const cleanForcedTitle = typeof forcedTitle === "string" ? forcedTitle.trim() : "";
      const tenantId = req.tenantContext!.tenantId;
      if (!process.env.GEMINI_API_KEY) {
        QuotaService.consumeQuota(tenantId, "ai_requests", 1);
        return res.json(generateLocalTemplateText(req.body));
      }
      reservationId = QuotaService.reserveAiQuota(tenantId, 1200);

      const forcedTitleInstruction = cleanForcedTitle
        ? `\n- TITLU OBLIGATORIU (din regula agenției): "${cleanForcedTitle}" — folosește EXACT acest titlu atât în câmpul 'title', cât și în antetul descrierii după emojiul 🏡 sau 🏢.`
        : "";

      const prompt = `
ESTI UN EXPERT IMOBILIAR DE TOP.
Sarcina ta este să generezi un TITLU și o DESCRIERE DE MARKETING conform regulilor stricte de mai jos.

DATE PROPRIETATE:
- Categorie: ${category || "Apartament"}
- Tip Tranzacție: ${transactionType || "Vânzare"}
- Zonă: ${zone || "Nespecificată"}
- Preț: ${price || "N/A"}
- ID Proprietate: ${propertyId ? propertyId.trim() : ""}
- Specificații tehnice: ${JSON.stringify(specs || {})}
- Titlu original: "${originalTitle || ""}"
- Descriere originală: "${(originalDescription || "").substring(0, 3000)}"${forcedTitleInstruction}

REGULI STRICTE MANDATATE:
0. EXCLUSIV DATE REALE DIN ANUNȚ: Folosește STRICT informațiile reale din datele proprietății, titlul original și descrierea originală. NICIODATĂ nu inventa, nu presupune și nu substitui cartiere/zone, stații de metrou, parcuri, puncte de interes, suprafețe, camere sau dotări care nu sunt menționate explicit în anunțul original! Dacă zona lipsește, NU adăuga un alt cartier.
1. TITLUL IDENTIC: Titlul din câmpul 'title' TREBUIE să fie ABSOLUT IDENTIC cu titlul din corpul descrierii (situat pe linia direct de sub 📌 ID, după emojiul 🏡 sau 🏢).
2. STRUCTURĂ TITLU: Tip imobil + număr camere/încăperi sau suprafață mp | Zonă | Pct. de interes | Pct forte imobil | Dotări | Parcare. Titlul TREBUIE să aibă SUB 70 de caractere (cu excepția cazului în care există un TITLU OBLIGATORIU furnizat mai sus).
3. FĂRĂ NUMĂR STRADĂ, FĂRĂ COMPLEX REZIDENȚIAL: Niciodată nu include numărul străzii, numărul blocului, scara, apartamentul sau denumiri de complexe rezidențiale (ex: Astorium, Hills, etc.) nici în titlu, nici în descriere! Folosește doar zona/cartierul general.
4. FĂRĂ COMISION 0%: Elimină complet orice referire la "0% comision", "comision 0", "fără comision".
5. ȘABLON DESCRIERE APARTAMENTE ȘI CASE / VILE:
Folosește cu sfințenie următorul șablon structural:
📌 ID ${propertyId ? propertyId.trim() : ""}
🏡 [Titlul identic cu cel din campul de titlu]

[O singură propoziție scurtă tip teaser]
[Un scurt paragraf descriptiv al imobilului]

━━━━━━━━━━━━━━━━━━

⭐ AVANTAJE PRINCIPALE

-[Compartimentare, ex: -decomandat]
-[avantaj_1]
-[avantaj_2]

━━━━━━━━━━━━━━━━━━

🛋️ DOTĂRI

-[dotare_1]
-[dotare_2]

[Scurt comentariu opțional despre organizarea spațiului]

━━━━━━━━━━━━━━━━━━

📍 LOCAȚIE

Acces rapid către:
-[punct_interes_1]
-[punct_interes_2]

━━━━━━━━━━━━━━━━━━

💰 ${transactionType === "Închiriere" ? "ÎNCHIRIERE" : "VÂNZARE"}

${transactionType === "Închiriere" ? `${price || "N/A"}\n1 lună garanție\nComision 50% + TVA\nDisponibil imediat` : `${price || "N/A"}\nDisponibil imediat`}

━━━━━━━━━━━━━━━━━━

🤝 ${transactionType === "Închiriere" ? "SUPORT ÎNCHIRIERE" : "SUPORT VÂNZARE"}

-consultanță dedicată din partea agenției brokr
-asistență completă în întocmirea contractului și înregistrarea ANAF
-posibilitate de vizionare rapidă și flexibilă

📞 Pentru vizionare sau detalii suplimentare, contactează-ne telefonic.

6. DACĂ ESTE BIROU, SPAȚIU COMERCIAL SAU INDUSTRIAL:
Folosește șablonul dedicat pentru spații comerciale (cu 📌 ID Proprietate, 🏢 Titlu, ⭐ PUNCTE CHEIE, 🛠️ SPAȚIUL, 📍 LOCAȚIE & ACCES, 💼 POTRIVIT PENTRU, 💰 CONDIȚII, 🤝 SUPORT), eliminând complet parantezele.

Returnează un JSON strict cu următoarele chei:
{
  "title": "Titlul proprietatii",
  "description": "Textul complet al descrierii conform sablonului"
}
`;

      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite",
        contents: [{ text: prompt }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              description: { type: Type.STRING }
            },
            required: ["title", "description"]
          }
        }
      });

      const text = response.text;
      DailyQuotaTracker.recordGeminiResponse({
        model: "gemini-3.1-flash-lite",
        response,
        fallbackPromptChars: prompt.length,
        fallbackOutputChars: text?.length || 0,
      });
      const textUsage = TelemetryCollectorService.recordGeminiResponseForTenant({
        tenantId: req.tenantContext!.tenantId,
        model: "gemini-3.1-flash-lite",
        response,
        fallbackPromptChars: prompt.length,
        fallbackOutputChars: text?.length || 0,
      });
      if (!text) throw new Error("Nu s-a primit niciun răspuns de la Gemini");
      const parsed = JSON.parse(text);
      const finalTitle = cleanForcedTitle || String(parsed.title || "").trim();
      const finalDescription = syncDescriptionHeadingTitle(String(parsed.description || "").trim(), finalTitle);
      if (reservationId) {
        const committedTokens =
          textUsage.totalTokens > 0
            ? textUsage.totalTokens
            : Math.max(400, Math.ceil((prompt.length + text.length) / 4));
        QuotaService.commitAiQuota(reservationId, committedTokens);
      }
      res.json({ title: finalTitle, description: finalDescription });
    } catch (e: any) {
      if (reservationId) QuotaService.refundAiQuota(reservationId);
      if (e?.statusCode === 429) {
        return res.status(429).json({ error: e.message || "Quota AI depășită." });
      }
      const errStr = e?.message || String(e || "");
      if (!errStr.includes("402") && !errStr.includes("RESOURCE_EXHAUSTED") && !errStr.includes("prepayment credits")) {
        console.warn("[Server] /api/generate-ai-text failed (using local template fallback):", errStr);
      }
      const fallback = generateLocalTemplateText(req.body);
      res.json(fallback);
    }
  });

  // Phase 9 lightweight client telemetry heartbeat (strictly capped, PII-free, tagged "Client Heartbeat · Estimated")
  const telemetryHeartbeatLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: 30,
    name: "telemetry_heartbeat",
  });
  app.post("/api/telemetry/heartbeat", ...requireTenantContext, telemetryHeartbeatLimiter, (req, res) => {
    const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId.trim() : "";
    const activeListeners = Number(req.body?.activeListeners || 0);
    const clientReadsDelta = Number(req.body?.clientReadsDelta || 0);

    if (!sessionId || sessionId.length > 64) {
      res.status(400).json({ success: false, error: "Invalid sessionId" });
      return;
    }

    TelemetryCollectorService.recordClientHeartbeat({
      tenantId: req.tenantContext!.tenantId,
      sessionId,
      activeListeners,
      clientReadsDelta,
    });
    res.status(204).end();
  });

  function resolvePublicShareTenantIdFromHost(rawHost?: string | null): string | null {
    const cleanHost = String(rawHost || "").trim();
    if (!cleanHost) return null;
    try {
      const resolved = TenantResolutionService.resolveDomain(
        cleanHost,
        null,
        process.env.NODE_ENV === "production"
      );
      if (resolved.type === "agency_crm" && resolved.tenantId && !resolved.isDevSimulation) {
        return resolved.tenantId;
      }
      return null;
    } catch {
      return null;
    }
  }

  function resolvePublicShareTenantId(req: express.Request): string | null {
    const rawHost =
      (req.headers["x-forwarded-host"] as string) ||
      req.get("host") ||
      req.hostname ||
      "";
    const devOverride =
      (req.headers["x-tenant-override"] as string) ||
      (typeof req.query?.simulate_tenant === "string" ? req.query.simulate_tenant : null) ||
      null;
    if (devOverride && process.env.NODE_ENV !== "production") {
      try {
        const simResolved = TenantResolutionService.resolveDomain(rawHost, devOverride, false);
        if (simResolved.type === "agency_crm" && simResolved.tenantId) {
          return simResolved.tenantId;
        }
      } catch {
        // ignore invalid override
      }
    }
    return resolvePublicShareTenantIdFromHost(rawHost);
  }

  function buildShareLookupCandidates(rawId: string): string[] {
    const clean = String(rawId || "").trim();
    if (!clean) return [];
    const candidates = new Set<string>([clean, clean.toUpperCase()]);
    const cerereC = clean.match(/^C(\d+)$/i);
    if (cerereC) candidates.add(`R${cerereC[1]}`);
    const cerereR = clean.match(/^R(\d+)$/i);
    if (cerereR) candidates.add(`C${cerereR[1]}`);
    return Array.from(candidates);
  }

  // Helper function to fetch public property/lead/cerere data:
  // Supports document IDs AND sequential entity codes (L123, P123, R123, C123),
  // scoping agency requests to the subdomain's tenant first and global lead requests to platform_shared_leads first.
  async function fetchPropertyById(
    id: string,
    options?: { preferredTenantId?: string | null }
  ): Promise<any> {
    const cleanId = String(id || "").trim();
    if (!cleanId) return null;

    const preferredTenantId = options?.preferredTenantId || null;
    const candidates = buildShareLookupCandidates(cleanId);
    // Only daily unprocessed codes (e.g. 2026-11-27-2) live on the global root domain first;
    // agency-processed codes (L32, P..., C...) resolve against the agency tenant first.
    const isGlobalLeadCode = /^\d{4}-\d{2}-\d{2}-\d+$/.test(cleanId);

    const parseFirestoreDoc = (docObj: any, fallbackId: string): Record<string, any> => {
      const parseValue = (fieldObj: any): any => {
        if (!fieldObj || typeof fieldObj !== 'object') return fieldObj;
        if ('stringValue' in fieldObj) return fieldObj.stringValue;
        if ('integerValue' in fieldObj) return Number(fieldObj.integerValue);
        if ('doubleValue' in fieldObj) return Number(fieldObj.doubleValue);
        if ('booleanValue' in fieldObj) return fieldObj.booleanValue;
        if ('timestampValue' in fieldObj) return fieldObj.timestampValue;
        if ('nullValue' in fieldObj) return null;
        if ('mapValue' in fieldObj) {
          const resObj: any = {};
          const fields = fieldObj.mapValue.fields || {};
          for (const k of Object.keys(fields)) {
            resObj[k] = parseValue(fields[k]);
          }
          return resObj;
        }
        if ('arrayValue' in fieldObj) {
          const values = fieldObj.arrayValue.values || [];
          return values.map((v: any) => parseValue(v));
        }
        return fieldObj;
      };
      const nameParts = String(docObj?.name || "").split("/");
      const resolvedDocId = nameParts[nameParts.length - 1] || fallbackId;
      const result: any = { id: resolvedDocId };
      const fields = docObj?.fields || {};
      for (const k of Object.keys(fields)) {
        result[k] = parseValue(fields[k]);
      }
      return result;
    };

    // 1. If accessed on an agency subdomain (or non-L code), check tenant-scoped store first
    if (preferredTenantId || !isGlobalLeadCode) {
      const tenantLocalProp = await CrmTenantStoreService.findPublicPropertyAcrossTenants(
        cleanId,
        preferredTenantId
      );
      if (tenantLocalProp) {
        return tenantLocalProp;
      }
    }

    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    let fbConfig: any = null;
    if (fs.existsSync(configPath)) {
      fbConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }

    const dbId = fbConfig?.firestoreDatabaseId || "(default)";
    const googleToken = fbConfig ? await PersistentStoreService.getGoogleAccessToken() : null;
    const requestHeaders: Record<string, string> = {};
    let authQuery = "";
    if (googleToken) {
      requestHeaders.Authorization = `Bearer ${googleToken}`;
    } else if (fbConfig?.apiKey) {
      authQuery = `?key=${fbConfig.apiKey}`;
    }

    const queryFirestoreCollectionByPropertyId = async (
      parentRelativePath: string,
      collectionId: string
    ): Promise<any | null> => {
      if (!fbConfig) return null;
      const baseDocs = `https://firestore.googleapis.com/v1/projects/${fbConfig.projectId}/databases/${dbId}/documents`;
      const parentUrl = parentRelativePath ? `${baseDocs}/${parentRelativePath}` : baseDocs;
      const queryUrl = `${parentUrl}:runQuery${authQuery}`;

      for (const candidate of candidates) {
        try {
          const queryBody = {
            structuredQuery: {
              from: [{ collectionId }],
              where: {
                fieldFilter: {
                  field: { fieldPath: "propertyId" },
                  op: "EQUAL",
                  value: { stringValue: candidate },
                },
              },
              limit: 1,
            },
          };
          const queryRes = await axios.post(queryUrl, queryBody, { headers: requestHeaders, timeout: 6000 });
          DailyQuotaTracker.recordFirestoreOps({ reads: 1, source: "server" });
          if (Array.isArray(queryRes.data) && queryRes.data[0]?.document) {
            return parseFirestoreDoc(queryRes.data[0].document, cleanId);
          }
        } catch (err) {
          if (isFirestoreQuotaError(err)) {
            throw new FirestoreQuotaExceededError();
          }
          // Continue to next candidate
        }
      }
      return null;
    };

    const getFirestoreDocDirect = async (relativeDocPath: string): Promise<any | null> => {
      if (!fbConfig) return null;
      try {
        const url = `https://firestore.googleapis.com/v1/projects/${fbConfig.projectId}/databases/${dbId}/documents/${relativeDocPath}${authQuery}`;
        const res = await axios.get(url, { headers: requestHeaders, timeout: 6000 });
        DailyQuotaTracker.recordFirestoreOps({ reads: 1, source: "server" });
        if (res.data) {
          return parseFirestoreDoc(res.data, cleanId);
        }
      } catch (err: any) {
        if (isFirestoreQuotaError(err)) {
          throw new FirestoreQuotaExceededError();
        }
        if (err?.response?.status === 404) {
          DailyQuotaTracker.recordFirestoreOps({ reads: 1, source: "server" });
        }
        // Not found or unauthorized
      }
      return null;
    };

    // 2. Check sanitized Firestore public_shares snapshots (single-doc get works even without server OAuth token)
    if (fbConfig) {
      const publicShareKeys: string[] = [];
      const addCandidateKeys = (scope: string) => {
        for (const candidate of candidates) {
          const upper = candidate.toUpperCase().replace(/[^A-Z0-9_-]/g, "");
          if (upper) publicShareKeys.push(`${scope}__${upper}`);
        }
      };

      if (preferredTenantId && !isGlobalLeadCode) {
        addCandidateKeys(preferredTenantId);
        addCandidateKeys("global");
      } else if (!isGlobalLeadCode) {
        // Non-global entity codes (Properties P..., Cereri C.../R...) belong to an agency tenant;
        // check tenant snapshots before legacy `global__` snapshots so updated gallery photos are never shadowed.
        for (const t of TenantResolutionService.getAllTenants()) {
          addCandidateKeys(t.id);
        }
        addCandidateKeys("global");
      } else {
        addCandidateKeys("global");
        if (preferredTenantId) {
          addCandidateKeys(preferredTenantId);
        } else {
          for (const t of TenantResolutionService.getAllTenants()) {
            addCandidateKeys(t.id);
          }
        }
      }

      const seenShareKeys = new Set<string>();
      let bestPubDoc: any = null;
      let bestPubMs = -1;
      for (const shareKey of publicShareKeys) {
        if (seenShareKeys.has(shareKey)) continue;
        seenShareKeys.add(shareKey);
        const pubDoc = await getFirestoreDocDirect(`public_shares/${encodeURIComponent(shareKey)}`);
        if (!pubDoc) continue;

        const pubMs = Date.parse(String(pubDoc.updatedAt || "")) || 0;
        if (preferredTenantId && shareKey.startsWith(`${preferredTenantId}__`)) {
          bestPubDoc = pubDoc;
          bestPubMs = pubMs;
          break;
        }
        if (!bestPubDoc || pubMs > bestPubMs) {
          bestPubDoc = pubDoc;
          bestPubMs = pubMs;
        }
        // For daily global unprocessed codes, `global__<CODE>` is canonical; check tenant store freshness below.
        if (isGlobalLeadCode && shareKey.startsWith("global__")) {
          break;
        }
      }

      if (bestPubDoc) {
        if (!preferredTenantId && isGlobalLeadCode) {
          const tenantLocalLead = await CrmTenantStoreService.findPublicPropertyAcrossTenants(
            cleanId,
            null
          );
          if (tenantLocalLead) {
            const localMs = Date.parse(String(tenantLocalLead.updatedAt || "")) || 0;
            if (localMs >= bestPubMs) {
              return tenantLocalLead;
            }
          }
        }
        return bestPubDoc;
      }
    }

    // 3. Global shared leads (platform_shared_leads) — checked first for L-codes & root-domain links
    if (fbConfig && (isGlobalLeadCode || !preferredTenantId)) {
      const sharedDirect = await getFirestoreDocDirect(
        `platform_shared_leads/${encodeURIComponent(cleanId)}`
      );
      const sharedLead =
        sharedDirect || (await queryFirestoreCollectionByPropertyId("", "platform_shared_leads"));
      if (sharedLead) {
        if (!preferredTenantId && isGlobalLeadCode) {
          const tenantLocalLead = await CrmTenantStoreService.findPublicPropertyAcrossTenants(
            cleanId,
            null
          );
          if (tenantLocalLead) {
            const localMs = Date.parse(String(tenantLocalLead.updatedAt || "")) || 0;
            const sharedMs = Date.parse(String(sharedLead.updatedAt || "")) || 0;
            if (localMs >= sharedMs) {
              return tenantLocalLead;
            }
          }
        }
        return sharedLead;
      }
    }

    // 4. If global lead code wasn't in platform_shared_leads, check tenant-scoped store too (agency-created leads)
    if (!preferredTenantId && isGlobalLeadCode) {
      const tenantLocalLead = await CrmTenantStoreService.findPublicPropertyAcrossTenants(cleanId, null);
      if (tenantLocalLead) {
        return tenantLocalLead;
      }
    }

    if (!fbConfig) return null;

    // 4. Check tenant-scoped Firestore subcollections (preferredTenantId first) by doc ID and propertyId
    if (googleToken) {
      const allTenants = TenantResolutionService.getAllTenants();
      const orderedTenants = preferredTenantId
        ? [
            ...allTenants.filter((t) => t.id === preferredTenantId),
            ...allTenants.filter((t) => t.id !== preferredTenantId),
          ]
        : allTenants;

      for (const tenant of orderedTenants) {
        const directTenantDoc = await getFirestoreDocDirect(
          `tenants/${encodeURIComponent(tenant.id)}/leads/${encodeURIComponent(cleanId)}`
        );
        if (directTenantDoc) return directTenantDoc;

        const codeTenantDoc = await queryFirestoreCollectionByPropertyId(
          `tenants/${encodeURIComponent(tenant.id)}`,
          "leads"
        );
        if (codeTenantDoc) return codeTenantDoc;
      }
    }

    // 5. Fallback: check platform_shared_leads even when preferredTenantId was set
    if (preferredTenantId && !isGlobalLeadCode) {
      const sharedDirect = await getFirestoreDocDirect(
        `platform_shared_leads/${encodeURIComponent(cleanId)}`
      );
      if (sharedDirect) return sharedDirect;

      const sharedByCode = await queryFirestoreCollectionByPropertyId("", "platform_shared_leads");
      if (sharedByCode) return sharedByCode;
    }

    // 6. Legacy root leads fallback (doc ID then propertyId)
    const legacyDirect = await getFirestoreDocDirect(`leads/${encodeURIComponent(cleanId)}`);
    if (legacyDirect) return legacyDirect;

    const legacyByCode = await queryFirestoreCollectionByPropertyId("", "leads");
    if (legacyByCode) return legacyByCode;

    return null;
  }

  function buildPublicPropertyPayload(
    property: any,
    id: string,
    req: express.Request,
    preferredTenantId?: string
  ) {
    const clientIp =
      String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "anon")
        .split(",")[0]
        .trim();
    const viewerSid = crypto
      .createHash("sha256")
      .update(`${clientIp}:${Date.now()}:${crypto.randomUUID()}`)
      .digest("hex")
      .slice(0, 12);
    const ipHash = crypto
      .createHash("sha256")
      .update(clientIp)
      .digest("hex")
      .slice(0, 6)
      .toUpperCase();
    const nowTime = new Date().toISOString().slice(11, 16).replace(":", "");
    const viewerStamp = `${ipHash}-${nowTime}`;
    const propCode = String(property.propertyId || id)
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, "")
      .slice(0, 32) || "BROKR";

    const publicTokenTtlMs = 24 * 60 * 60 * 1000;
    const tokenUrlBySource = new Map<string, string>();
    const orderedNormalizedSources: string[] = [];
    const tokenizeImageUrl = (rawUrl: string): string => {
      const normalizedSource = normalizeStoredImageUrl(rawUrl) || rawUrl.trim();
      const dedupKey = getImageIdentityKey(normalizedSource) || normalizedSource;
      const existing = tokenUrlBySource.get(dedupKey);
      if (existing) return existing;
      orderedNormalizedSources.push(normalizedSource);
      const token = createPublicImageToken({
        sourceUrl: normalizedSource,
        propertyId: propCode,
        viewerSid,
        viewerStamp,
        ttlMs: publicTokenTtlMs,
        deterministic: true,
      });
      const tokenized = `/api/public-image?token=${encodeURIComponent(token)}`;
      tokenUrlBySource.set(dedupKey, tokenized);
      return tokenized;
    };

    const sanitized = sanitizePublicProperty(property, { tokenizeImageUrl });
    const resolvedTenantId =
      (typeof property?.tenantId === "string" && property.tenantId.trim()) ||
      (typeof preferredTenantId === "string" && preferredTenantId.trim()) ||
      "ten_brokr_default";
    let automationDescriptionLayout: any = undefined;
    try {
      automationDescriptionLayout =
        AutomationConfigRepository.getByTenantId(resolvedTenantId).titleRule?.descriptionLayout;
    } catch {
      try {
        automationDescriptionLayout =
          AutomationConfigRepository.getByTenantId("ten_brokr_default").titleRule?.descriptionLayout;
      } catch {
        automationDescriptionLayout = undefined;
      }
    }

    const payload = {
      ...sanitized,
      ...(automationDescriptionLayout ? { automationDescriptionLayout } : {}),
      publicProtection: {
        viewerStamp,
        expiresAt: Date.now() + publicTokenTtlMs,
      },
    };
    const orderedTokenUrls = extractOrderedPublicImageUrls(sanitized);
    const prefetchUrls = orderedTokenUrls
      .slice(0, 5)
      .filter((u) => u.startsWith("/api/public-image?"))
      .map((u, idx) => {
        const w = idx === 0 ? 1280 : 640;
        const qIdx = u.indexOf("?");
        const params = new URLSearchParams(qIdx >= 0 ? u.slice(qIdx + 1) : "");
        params.set("w", String(w));
        return `/api/public-image?${params.toString()}`;
      });
    return {
      payload,
      propCode,
      mosaicSources: orderedNormalizedSources.slice(0, 5),
      prefetchUrls,
    };
  }

  const pendingRawPublicBuffers = new Map<string, Promise<Buffer | null>>();

  async function resolvePublicImageRawBuffer(rawSourceUrl: string): Promise<Buffer | null> {
    let sourceUrl = rawSourceUrl.trim().replace(/&amp;/g, "&");
    if (sourceUrl.startsWith("inline:")) {
      const resolvedDataUrl = resolveInlinePublicDataUrl(sourceUrl);
      if (!resolvedDataUrl) {
        return null;
      }
      sourceUrl = resolvedDataUrl;
    }

    // Unwrap nested proxy-image wrappers if present
    for (let depth = 0; depth < 3 && sourceUrl.includes("/api/proxy-image"); depth++) {
      try {
        const parsed = new URL(sourceUrl, "https://placeholder.local");
        const inner = parsed.searchParams.get("url");
        if (inner) {
          sourceUrl = inner.trim().replace(/&amp;/g, "&");
        } else {
          break;
        }
      } catch {
        break;
      }
    }

    if (sourceUrl.startsWith("//")) {
      sourceUrl = `https:${sourceUrl}`;
    }

    if (sourceUrl.startsWith("data:image/")) {
      const parts = sourceUrl.split(",");
      if (parts.length === 2) {
        return Buffer.from(parts[1], "base64");
      }
      return null;
    }

    const inflight = pendingRawPublicBuffers.get(sourceUrl);
    if (inflight) {
      return inflight;
    }

    const work = resolvePublicImageRawBufferUncached(sourceUrl).finally(() => {
      pendingRawPublicBuffers.delete(sourceUrl);
    });
    pendingRawPublicBuffers.set(sourceUrl, work);
    return work;
  }

  async function resolvePublicImageRawBufferUncached(sourceUrl: string): Promise<Buffer | null> {

    let localPathCandidate = sourceUrl;
    if (/^https?:\/\//i.test(sourceUrl)) {
      try {
        const parsedAbs = new URL(sourceUrl);
        if (
          parsedAbs.pathname.startsWith("/uploads/") ||
          parsedAbs.pathname.startsWith("/api/storage/media/") ||
          parsedAbs.pathname.startsWith("/api/storage/public-shares/")
        ) {
          localPathCandidate = parsedAbs.pathname;
        }
      } catch {
        // ignore parse error
      }
    }

    if (sourceUrl.startsWith("data:image/")) {
      const parts = sourceUrl.split(",");
      if (parts.length === 2) {
        return Buffer.from(parts[1], "base64");
      }
      return null;
    }

    if (localPathCandidate.startsWith("/api/storage/media/")) {
      const rawSuffix = localPathCandidate
        .replace(/^\/api\/storage\/media\//, "")
        .split("?")[0]
        .split("#")[0];
      const decodedParts = rawSuffix
        .split("/")
        .filter(Boolean)
        .map((seg) => {
          try {
            return decodeURIComponent(seg);
          } catch {
            return seg;
          }
        });
      const objectKey =
        decodedParts[0] === "tenants"
          ? decodedParts.join("/")
          : decodedParts.length === 4 && decodedParts[1] === "properties"
            ? `tenants/${decodedParts.join("/")}`
            : decodedParts.join("/");
      const { buffer } = await CloudStorageService.downloadObject({
        objectKey,
        allowPublicListing: true,
      });
      return buffer;
    }

    if (localPathCandidate.startsWith("/api/storage/public-shares/")) {
      const rawSuffix = localPathCandidate
        .replace(/^\/api\/storage\/public-shares\//, "")
        .split("?")[0]
        .split("#")[0];
      const decodedParts = rawSuffix
        .split("/")
        .filter(Boolean)
        .map((seg) => {
          try {
            return decodeURIComponent(seg);
          } catch {
            return seg;
          }
        });
      const rawKey = `public/shares/${decodedParts.join("/")}`;
      const found = await CloudStorageService.getRawObject(rawKey);
      if (found?.buffer && found.buffer.length > 0) {
        return found.buffer;
      }
      return null;
    }

    if (localPathCandidate.startsWith("/uploads/")) {
      const rawRel = localPathCandidate
        .replace(/^\/uploads\//, "")
        .split("?")[0]
        .split("#")[0];
      let decodedRel = rawRel;
      try {
        decodedRel = decodeURIComponent(rawRel);
      } catch {
        // keep raw
      }
      const relName = path.basename(decodedRel);
      const localPath = path.resolve(uploadsDir, relName);
      if (localPath.startsWith(uploadsDir + path.sep) && fs.existsSync(localPath)) {
        return fs.readFileSync(localPath);
      }
      return null;
    }

    if (/^https?:\/\//i.test(sourceUrl)) {
      const cleanUrl = normalizeCleanImageUrl(sourceUrl);
      await validateSafeExternalUrl(cleanUrl);
      const validationError = getCleanImageValidationError(cleanUrl);
      if (validationError) {
        const err: any = new Error(validationError);
        err.statusCode = 400;
        throw err;
      }
      try {
        const entry = await fetchAndCleanExternalImage(cleanUrl, { maxAttempts: 3, timeoutMs: 8000 });
        return entry.data;
      } catch (primaryErr) {
        // Fallback: plain-header fetch for CDNs that reject spoofed Referer/Sec-Fetch headers
        try {
          const plainResp = await axios.get(cleanUrl, {
            responseType: "arraybuffer",
            timeout: 7000,
            maxRedirects: 5,
            maxContentLength: 20 * 1024 * 1024,
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; BrokrMedia/1.0)",
              Accept: "image/jpeg,image/png,image/webp,image/*,*/*;q=0.8",
            },
          });
          const plainBuf = Buffer.from(plainResp.data);
          if (plainBuf.length > 0 && detectImageMagicBytes(plainBuf)) {
            return plainBuf;
          }
          throw primaryErr;
        } catch {
          throw primaryErr;
        }
      }
    }

    return null;
  }

  function warmPublicShareMosaicImages(propCode: string, sources: string[]): void {
    if (!sources || sources.length === 0) return;
    sources.slice(0, 5).forEach((sourceUrl, idx) => {
      const targetWidth = idx === 0 ? 1280 : 640;
      (async () => {
        const alreadyCached = await getPersistedProtectedPublicImage({
          cacheKey: sourceUrl,
          propertyCode: propCode || "BROKR",
          maxWidth: targetWidth,
          preferWebp: true,
        });
        if (alreadyCached) return;
        const rawBuffer = await resolvePublicImageRawBuffer(sourceUrl);
        if (!rawBuffer || rawBuffer.length === 0) return;
        await applyPublicImageProtections(rawBuffer, {
          cacheKey: sourceUrl,
          propertyCode: propCode || "BROKR",
          viewerStamp: "PUBLIC",
          maxWidth: targetWidth,
          preferWebp: true,
          skipPersistedLookup: true,
        });
      })().catch(() => {
        // Best-effort background pre-warm; never fails page render
      });
    });
  }
  registerPublicShareWarmer(warmPublicShareMosaicImages);

  // Public property endpoint for shared property links (strictly strips private owner PII & source URLs, tokenizes images)
  app.get("/api/public-property/:id", async (req, res) => {
    try {
      const { id } = req.params;
      if (!id) return res.status(400).json({ error: "Property ID required" });

      const preferredTenantId = resolvePublicShareTenantId(req);
      const bypassCache = req.query.fresh === "1";
      const property = await fetchPropertyByIdCached(id, preferredTenantId, { bypassCache });
      if (!property) {
        return res.status(404).json({ error: "Property not found" });
      }

      const { payload, propCode, mosaicSources } = buildPublicPropertyPayload(
        property,
        id,
        req,
        preferredTenantId
      );
      warmPublicShareMosaicImages(propCode, mosaicSources);

      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
      res.setHeader("X-Robots-Tag", "noindex, noimageindex, noarchive");
      res.json(payload);
    } catch (e: any) {
      if (isFirestoreQuotaError(e)) {
        return res.status(503).json({
          code: "FIRESTORE_QUOTA_EXCEEDED",
          error:
            e?.message ||
            "Serviciul de date este temporar indisponibil (limită zilnică atinsă). Te rugăm să încerci din nou mai târziu.",
        });
      }
      if (e.response && (e.response.status === 404 || e.response.status === 403)) {
        return res.status(404).json({ error: "Property not found or requires server credentials" });
      }
      console.error("[Server] /api/public-property/:id error:", e.message || e);
      res.status(500).json({ error: "Failed to fetch public property" });
    }
  });

  // Protected image endpoint strictly for public share canvas rendering (blocks direct tab opens, hotlinks, & reverse image search)
  app.get("/api/public-image", proxyImageLimiter, async (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    const secFetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
    const secFetchDest = String(req.headers["sec-fetch-dest"] || "").toLowerCase();
    const customPublicHeader = req.headers["x-brokr-public-view"];

    // Block cross-site hotlinks and direct browser address-bar / <img> opens
    if (
      customPublicHeader !== "1" ||
      secFetchSite === "cross-site" ||
      secFetchDest === "document"
    ) {
      return res.status(403).json({ error: "Acces direct interzis pentru imaginile protejate." });
    }

    const verified = verifyPublicImageToken(token);
    if (!verified.valid && "reason" in verified) {
      return res.status(verified.status).json({ error: verified.reason });
    }
    if (!("payload" in verified)) {
      return res.status(403).json({ error: "Invalid image token" });
    }

    const targetWidth = parseThumbnailWidth(req.query.w);
    const preferWebp = shouldServeWebp(req.headers.accept, req.query.format);

    // Fast path: serve from RAM, /tmp disk cache, or persistent Cloud Storage without hitting upstream CDN or running transforms
    const cachedProtected = await getPersistedProtectedPublicImage({
      cacheKey: verified.payload.u,
      propertyCode: verified.payload.p || "BROKR",
      maxWidth: targetWidth,
      preferWebp,
    });
    if (cachedProtected) {
      res.setHeader("Content-Type", cachedProtected.mimeType);
      res.setHeader("Content-Length", String(cachedProtected.buffer.length));
      res.setHeader("Vary", "Accept");
      res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
      res.setHeader("X-Robots-Tag", "noindex, noimageindex");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      res.setHeader("X-Media-Storage-Hit", cachedProtected.fromStorage ? "HIT" : "MEM");
      DailyQuotaTracker.recordMediaEgress(cachedProtected.buffer.length);
      return res.send(cachedProtected.buffer);
    }

    try {
      const rawBuffer = await resolvePublicImageRawBuffer(verified.payload.u);

      if (!rawBuffer || rawBuffer.length === 0) {
        return res.status(404).json({ error: "Image not found" });
      }

      const protectedImg = await applyPublicImageProtections(rawBuffer, {
        cacheKey: verified.payload.u,
        propertyCode: verified.payload.p || "BROKR",
        viewerStamp: verified.payload.st || "PUBLIC",
        maxWidth: targetWidth,
        preferWebp,
        skipPersistedLookup: true,
      });

      res.setHeader("Content-Type", protectedImg.mimeType);
      res.setHeader("Content-Length", String(protectedImg.buffer.length));
      res.setHeader("Vary", "Accept");
      res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
      res.setHeader("X-Robots-Tag", "noindex, noimageindex");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      DailyQuotaTracker.recordMediaEgress(protectedImg.buffer.length);
      return res.send(protectedImg.buffer);
    } catch (err: any) {
      console.warn("[Server] /api/public-image error:", err?.message || err);
      const status =
        err?.statusCode === 400 || err?.statusCode === 404 || err?.statusCode === 403
          ? err.statusCode
          : 502;
      return res.status(status).json({
        error:
          status === 404
            ? "Image not found"
            : status === 400
              ? err?.message || "Invalid image URL"
              : "Failed to serve protected public image",
      });
    }
  });

  // Helper to resolve the correct index.html file:
  // In production (or when dist/index.html is built), we MUST serve dist/index.html with bundled hashed assets.
  // Serving raw unbundled src/main.tsx in production crashes the browser with a fatal module MIME error.
  // Helper to resolve the correct index.html file:
  // Whenever dist/index.html is built, we MUST serve dist/index.html with bundled hashed assets.
  // Serving raw unbundled src/main.tsx crashes the browser with a fatal module MIME error.
  function getEffectiveIndexPath(): { path: string; isDist: boolean } {
    const distCandidates = [
      path.join(process.cwd(), 'dist', 'index.html'),
      path.join(__dirname, 'dist', 'index.html'),
      path.resolve('./dist/index.html')
    ];

    // Whenever a compiled dist/index.html exists, prefer it
    for (const distCandidate of distCandidates) {
      if (fs.existsSync(distCandidate)) {
        return { path: distCandidate, isDist: true };
      }
    }

    const rootIndexPath = path.join(process.cwd(), 'index.html');
    return { path: rootIndexPath, isDist: false };
  }

  // Unified 3-minute RAM cache + in-flight coalescing for public property lookups
  // (shared across /share/:id, /api/public-property/:id, and /api/og-image/:id,
  // and instantaneously busted on any CRM/photo edit via PublicPropertyCacheService.invalidate)
  async function fetchPropertyByIdCached(
    id: string,
    preferredTenantId?: string | null,
    options?: { bypassCache?: boolean }
  ): Promise<any> {
    return PublicPropertyCacheService.getOrFetch(
      id,
      preferredTenantId,
      () => fetchPropertyById(id, { preferredTenantId }),
      { bypassCache: options?.bypassCache }
    );
  }

  // Helper to serve default brokr OpenGraph banner with short cache so transient upstream failures recover quickly
  function serveDefaultOgBanner(res: express.Response) {
    const defaultPaths = [
      path.resolve("./public/og-default.jpg"),
      path.join(__dirname, "public", "og-default.jpg"),
      path.resolve("./dist/og-default.jpg"),
      path.join(__dirname, "og-default.jpg")
    ];
    for (const p of defaultPaths) {
      if (fs.existsSync(p)) {
        const buf = fs.readFileSync(p);
        res.setHeader("Content-Type", "image/jpeg");
        res.setHeader("Content-Length", String(buf.length));
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60");
        return res.send(buf);
      }
    }
    return res.status(404).send("Default OG banner not found");
  }

  function normalizeOgCandidateUrl(rawInput: string): string {
    let rawUrl = String(rawInput || "")
      .trim()
      .replace(/&amp;/gi, "&");
    if (!rawUrl) return "";

    // Unwrap proxy URL (including double-wrapped or absolute self-URLs)
    for (let depth = 0; depth < 2; depth++) {
      if (rawUrl.includes("/api/proxy-image")) {
        try {
          const u = new URL(rawUrl, "https://placeholder.local");
          const extracted = u.searchParams.get("url");
          if (extracted) {
            rawUrl = extracted.trim().replace(/&amp;/gi, "&");
            continue;
          }
        } catch {}
      }
      break;
    }

    if (rawUrl.startsWith("//")) {
      rawUrl = "https:" + rawUrl;
    }
    return rawUrl;
  }

  async function fetchRawOgCandidateBuffer(
    rawInput: string
  ): Promise<{ buffer: Buffer; contentType: string } | null> {
    const rawUrl = normalizeOgCandidateUrl(rawInput);
    if (!rawUrl) return null;

    // 1. Inline base64 dataUrl
    if (rawUrl.startsWith("data:image/")) {
      try {
        const commaIdx = rawUrl.indexOf(",");
        if (commaIdx !== -1) {
          const meta = rawUrl.slice(0, commaIdx);
          const payload = rawUrl.slice(commaIdx + 1);
          const buf = Buffer.from(payload, "base64");
          if (buf.length > 0) {
            const mimeMatch = meta.match(/:(.*?);/);
            return { buffer: buf, contentType: mimeMatch ? mimeMatch[1] : "image/jpeg" };
          }
        }
      } catch {}
      return null;
    }

    // 2. Cloud Storage listing media URLs (relative or absolute self-hosted URL)
    const storageMatch = rawUrl.match(/\/api\/storage\/media\/([^?#]+)/);
    if (storageMatch && storageMatch[1]) {
      try {
        const decodedParts = storageMatch[1]
          .split("/")
          .filter(Boolean)
          .map((seg) => {
            try {
              return decodeURIComponent(seg);
            } catch {
              return seg;
            }
          });
        const objectKey =
          decodedParts[0] === "tenants"
            ? decodedParts.join("/")
            : decodedParts.length === 4 && decodedParts[1] === "properties"
              ? `tenants/${decodedParts.join("/")}`
              : decodedParts.join("/");
        const { buffer, metadata } = await CloudStorageService.downloadObject({
          objectKey,
          allowPublicListing: true,
        });
        if (buffer && buffer.length > 0) {
          return { buffer, contentType: metadata.mimeType || "image/jpeg" };
        }
      } catch {
        // Fall through to external fetch if it was a remote URL
      }
    }

    // 3. Local uploads (relative or absolute URL pointing to /uploads/...)
    const uploadsMatch = rawUrl.match(/\/uploads\/([^?#]+)/);
    if (uploadsMatch && uploadsMatch[1]) {
      try {
        const relPath = decodeURIComponent(uploadsMatch[1]);
        const localPath = path.resolve(uploadsDir, relPath);
        if (localPath.startsWith(uploadsDir + path.sep) && fs.existsSync(localPath) && fs.statSync(localPath).isFile()) {
          const buf = fs.readFileSync(localPath);
          if (buf.length > 0) {
            const ct = relPath.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
            return { buffer: buf, contentType: ct };
          }
        }
      } catch {}
    }

    // 4. External HTTP/HTTPS image
    if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
      const cleanUrl = normalizeCleanImageUrl(rawUrl);

      // Instant hit if already downloaded & cleaned in imageCleanCache
      const alreadyClean = imageCleanCache.get(cleanUrl);
      if (alreadyClean?.data && alreadyClean.data.length > 0) {
        return { buffer: alreadyClean.data, contentType: alreadyClean.mimeType || "image/jpeg" };
      }

      // Fast fetch without heavy full-res watermark inpainting so chat crawlers never time out
      try {
        const entry = await fetchAndCleanExternalImage(cleanUrl, {
          skipClean: true,
          maxAttempts: 2,
          timeoutMs: 4500,
        });
        if (entry?.data && entry.data.length > 0) {
          return { buffer: entry.data, contentType: entry.mimeType || "image/jpeg" };
        }
      } catch {
        // Fallback: some CDNs block Referer / Sec-Fetch-* headers; retry once with minimal headers
        try {
          const plainRes = await safeFetchExternal(cleanUrl, {
            responseType: "arraybuffer",
            timeout: 4500,
            maxContentLength: DEFAULT_MAX_EXTERNAL_BYTES,
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
              "Accept": "image/jpeg,image/png,image/webp,image/*,*/*;q=0.8",
            },
          });
          if (plainRes.status >= 200 && plainRes.status < 300 && plainRes.data) {
            const buf = Buffer.isBuffer(plainRes.data) ? plainRes.data : Buffer.from(plainRes.data);
            const magic = detectImageMagicBytes(buf);
            if (magic && buf.length > 0) {
              return { buffer: buf, contentType: magic.mime };
            }
          }
        } catch {}
      }
    }

    return null;
  }

  async function getOrBuildOgImageBuffer(params: {
    id: string;
    preferredTenantId: string | null;
    versionKey: string;
    property?: any;
  }): Promise<{ buffer: Buffer; fromStorage: boolean; objectKey: string } | null> {
    const { id, preferredTenantId, versionKey } = params;
    try {
      return await MediaPipelineService.getOrBuildPersistedOgImage({
        shareCode: id,
        versionKey,
        preferredTenantId,
        loadCandidateBuffers: async () => {
          const property =
            params.property !== undefined
              ? params.property
              : await fetchPropertyByIdCached(id, preferredTenantId);
          const candidateUrls = extractOrderedPublicImageUrls(property);
          const buffers: Buffer[] = [];
          for (const rawUrl of candidateUrls.slice(0, 5)) {
            const fetched = await fetchRawOgCandidateBuffer(rawUrl);
            if (fetched?.buffer && fetched.buffer.length > 0) {
              buffers.push(fetched.buffer);
              // Stop after collecting the first valid candidate buffer
              break;
            }
          }
          return buffers;
        },
      });
    } catch (err: any) {
      console.warn(`[OG Image] Error building preview image for ${id}:`, err?.message);
      return null;
    }
  }

  // Dedicated OpenGraph image endpoint for WhatsApp, Facebook, LinkedIn, Telegram, iMessage, and X/Twitter
  // Supports both clean path-versioned URLs (`/api/og-image/:id/:version.jpg`) and legacy `/api/og-image/:id.jpg`
  app.get(
    [
      "/api/og-image/:id/:version.jpg",
      "/api/og-image/:id/:version",
      "/api/og-image/:id.jpg",
      "/api/og-image/:id.png",
      "/api/og-image/:id",
    ],
    async (req, res) => {
      let id = String(req.params.id || "").replace(/\.(jpg|jpeg|png|webp)$/i, "").trim();
      if (!id) {
        return serveDefaultOgBanner(res);
      }

      const rawVersion =
        (typeof req.params.version === "string" ? req.params.version : "") ||
        (typeof req.query.v === "string" ? req.query.v : "");
      const versionKey = rawVersion
        .replace(/\.(jpg|jpeg|png|webp)$/i, "")
        .replace(/[^a-zA-Z0-9_-]/g, "")
        .slice(0, 32);

      const preferredTenantId = resolvePublicShareTenantId(req);
      const result = await getOrBuildOgImageBuffer({
        id,
        preferredTenantId,
        versionKey,
      });

      if (!result || !result.buffer || result.buffer.length === 0) {
        return serveDefaultOgBanner(res);
      }

      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Content-Length", String(result.buffer.length));
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-OG-Storage-Cache", result.fromStorage ? "HIT" : "MISS");
      res.setHeader(
        "Cache-Control",
        versionKey ? CACHE_CONTROL_PUBLIC_IMMUTABLE : "public, max-age=3600, s-maxage=3600"
      );
      return res.send(result.buffer);
    }
  );

  // OpenGraph SSR route for rich link previews on WhatsApp, Facebook, LinkedIn, Telegram, iMessage, and X/Twitter
  app.get(["/share/:id", "/p/:id"], async (req, res) => {
    try {
      const { id } = req.params;
      const indexInfo = getEffectiveIndexPath();

      if (!id) {
        if (!fs.existsSync(indexInfo.path)) {
          return res.status(404).send("Not found");
        }
        return res.sendFile(indexInfo.path);
      }

      const ua = String(req.headers["user-agent"] || "").toLowerCase();
      const isLinkPreviewBot =
        /whatsapp|facebookexternalhit|facebot|telegrambot|twitterbot|linkedinbot|slackbot|discordbot|skypeuripreview|applebot|imessage|viber|pinterest|googlebot|bingbot|crawler|preview/i.test(
          ua
        );

      const preferredTenantId = resolvePublicShareTenantId(req);
      // Both browsers and link-preview bots share the unified 3-minute RAM cache + in-flight coalescing;
      // any CRM or gallery edit busts the entry immediately via PublicPropertyCacheService.invalidate.
      const property = await fetchPropertyByIdCached(id, preferredTenantId, {
        bypassCache: req.query.fresh === "1",
      });

      const title = resolvePublicDisplayTitle(property, "Proprietate Imobiliară • brokr.");
      const description = formatOpenGraphDescription(
        property,
        "Proprietate imobiliară prezentată de brokr."
      );

      // Canonical URLs with guaranteed https protocol in production
      const baseUrl = getBaseUrl(req);
      const encodedId = encodeURIComponent(id);
      const shareUrl = `${baseUrl}${req.path}`;
      const firstImageUrl = resolvePublicFirstImageUrl(property);
      const imageVersionSeed = `${firstImageUrl}|${property?.updatedAt || ""}`;
      const imageVersion = property
        ? crypto.createHash("sha256").update(imageVersionSeed).digest("hex").slice(0, 10)
        : "";

      // Pre-warm the OpenGraph thumbnail ONLY blocking for chat/social link-preview bots.
      // Human browsers receive HTML immediately (saving up to 1.8s on Time-to-First-Byte)
      // while the OG image + first 5 mosaic photos warm asynchronously in the background.
      if (property && firstImageUrl) {
        const warmPromise = getOrBuildOgImageBuffer({
          id,
          preferredTenantId,
          versionKey: imageVersion,
          property,
        }).catch(() => null);
        if (isLinkPreviewBot) {
          await Promise.race([
            warmPromise,
            new Promise<void>((resolve) => setTimeout(resolve, 1800)),
          ]);
        }
      }

      // Build sanitized public payload + start warming the first 5 mosaic WebP variants in parallel
      // while the browser downloads/executes the SPA bundle, AND inject an inline <head> prefetch
      // script so the browser fetches the hero + 4 mosaic images immediately alongside JS.
      let initialPayloadScript = "";
      if (property && !isLinkPreviewBot) {
        const { payload, propCode, mosaicSources, prefetchUrls } = buildPublicPropertyPayload(
          property,
          id,
          req,
          preferredTenantId
        );
        warmPublicShareMosaicImages(propCode, mosaicSources);
        const safeJson = JSON.stringify({ routeId: id, data: payload })
          .replace(/</g, "\\u003c")
          .replace(/>/g, "\\u003e")
          .replace(/&/g, "\\u0026")
          .replace(/\u2028/g, "\\u2028")
          .replace(/\u2029/g, "\\u2029");
        const scripts: string[] = [
          `    <script id="__BROKR_INITIAL_PUBLIC_PROPERTY__" type="application/json">${safeJson}</script>`,
        ];
        if (prefetchUrls.length > 0) {
          const safeUrlsJson = JSON.stringify(prefetchUrls)
            .replace(/</g, "\\u003c")
            .replace(/>/g, "\\u003e")
            .replace(/&/g, "\\u0026");
          scripts.push(
            `    <script>(function(){try{var u=${safeUrlsJson};var m=window.__BROKR_PREFETCHED_PUBLIC_IMAGES__=window.__BROKR_PREFETCHED_PUBLIC_IMAGES__||{};for(var i=0;i<u.length;i++){(function(s){if(m[s])return;var p=fetch(s,{credentials:"same-origin",headers:{"X-Brokr-Public-View":"1","Accept":"image/webp,image/*;q=0.8"},cache:"default"}).then(function(r){if(!r.ok)throw new Error("HTTP "+r.status);return r.blob();});p.catch(function(){delete m[s];});m[s]=p;})(u[i]);}}catch(e){}})();</script>`
          );
        }
        initialPayloadScript = scripts.join("\n");
      }

      // Clean path-versioned `.jpg` URL with zero query parameters for maximum compatibility across chat apps
      const ogImageUrl = imageVersion
        ? `${baseUrl}/api/og-image/${encodedId}/${imageVersion}.jpg`
        : `${baseUrl}/api/og-image/${encodedId}.jpg`;
      const isHttpsOgImage = ogImageUrl.startsWith("https://");

      if (!fs.existsSync(indexInfo.path)) {
        return res.status(404).send("Not found");
      }

      let html = fs.readFileSync(indexInfo.path, 'utf8');

      // In dev mode, always use Vite's transformIndexHtml on root index.html for live module loading
      if (!isProduction && vite) {
        try {
          const rootIndexPath = path.join(process.cwd(), 'index.html');
          if (fs.existsSync(rootIndexPath)) {
            html = fs.readFileSync(rootIndexPath, 'utf8');
          }
          html = await vite.transformIndexHtml(req.originalUrl, html);
        } catch (viteErr: any) {
          console.warn("[Server] vite.transformIndexHtml error:", viteErr.message);
        }
      } else if (html.includes('/src/main.tsx')) {
        // In production mode without Vite: swap raw src/main.tsx for compiled dist bundle
        const distAssetsDirs = [
          path.join(process.cwd(), 'dist', 'assets'),
          path.join(__dirname, 'assets'),
          path.join(__dirname, 'dist', 'assets')
        ];

        let jsAsset = "";
        let cssAsset = "";

        for (const assetsDir of distAssetsDirs) {
          if (fs.existsSync(assetsDir)) {
            try {
              const files = fs.readdirSync(assetsDir);
              const jsFile = files.find(f => f.startsWith('index-') && f.endsWith('.js'));
              const cssFile = files.find(f => f.startsWith('index-') && f.endsWith('.css'));
              if (jsFile) jsAsset = `/assets/${jsFile}`;
              if (cssFile) cssAsset = `/assets/${cssFile}`;
              if (jsAsset) break;
            } catch {
              // ignore
            }
          }
        }

        if (jsAsset) {
          html = html.replace(
            /<script\s+type=["']module["']\s+src=["']\/src\/main\.tsx["']\s*><\/script>/gi,
            `<script type="module" crossorigin src="${jsAsset}"></script>`
          );
          if (cssAsset && !html.includes(cssAsset)) {
            html = html.replace('</head>', `<link rel="stylesheet" crossorigin href="${cssAsset}">\n</head>`);
          }
        }
      }

      const esc = (s: string) =>
        String(s || "")
          .replace(/&/g, "&amp;")
          .replace(/"/g, "&quot;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");

      const ogTags = [
        `    <meta charset="UTF-8" />`,
        `    <title>${esc(title)}</title>`,
        `    <meta name="description" content="${esc(description)}" />`,
        `    <link rel="canonical" href="${esc(shareUrl)}" />`,
        `    <meta property="og:type" content="website" />`,
        `    <meta property="og:locale" content="ro_RO" />`,
        `    <meta property="og:site_name" content="brokr." />`,
        `    <meta property="og:url" content="${esc(shareUrl)}" />`,
        `    <meta property="og:title" content="${esc(title)}" />`,
        `    <meta property="og:description" content="${esc(description)}" />`,
        `    <meta property="og:image" content="${esc(ogImageUrl)}" />`,
        ...(isHttpsOgImage
          ? [`    <meta property="og:image:secure_url" content="${esc(ogImageUrl)}" />`]
          : []),
        `    <meta property="og:image:type" content="image/jpeg" />`,
        `    <meta property="og:image:width" content="1200" />`,
        `    <meta property="og:image:height" content="630" />`,
        `    <meta property="og:image:alt" content="${esc(title)}" />`,
        `    <meta name="twitter:card" content="summary_large_image" />`,
        `    <meta name="twitter:url" content="${esc(shareUrl)}" />`,
        `    <meta name="twitter:title" content="${esc(title)}" />`,
        `    <meta name="twitter:description" content="${esc(description)}" />`,
        `    <meta name="twitter:image" content="${esc(ogImageUrl)}" />`,
        `    <meta name="twitter:image:alt" content="${esc(title)}" />`,
        ...(initialPayloadScript ? [initialPayloadScript] : []),
      ].join("\n");

      // WhatsApp / Facebook / Twitter / LinkedIn / iMessage crawlers parse only the top of <head>.
      // Strip stale/default meta tags and inject UTF-8 + OpenGraph tags right after <head>.
      html = html.replace(/<meta\s+charset=["'][^"']+["']\s*\/?>/gi, '');
      html = html.replace(/<title>[\s\S]*?<\/title>/gi, '');
      html = html.replace(/<link\s+rel=["']canonical["'][^>]*>/gi, '');
      html = html.replace(/<meta\s+name=["']description["'][^>]*>/gi, '');
      html = html.replace(/<meta\s+property=["']og:[^"']+["'][^>]*>/gi, '');
      html = html.replace(/<meta\s+name=["']twitter:[^"']+["'][^>]*>/gi, '');

      html = html.replace(/<head[^>]*>/i, (match) => `${match}\n${ogTags}\n`);

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.send(html);
    } catch (err: any) {
      console.warn("[Server] /share/:id OpenGraph error:", err.message);
      const fallbackInfo = getEffectiveIndexPath();
      if (fs.existsSync(fallbackInfo.path)) {
        return res.sendFile(fallbackInfo.path);
      }
      res.sendFile(path.join(process.cwd(), 'index.html'));
    }
  });

  // Dedicated OLX.ro DOM extraction helpers for exact title, description, price, owner, posted date, and parameters
  function extractOlxDomTitle($: ReturnType<typeof cheerio.load>): string {
    const selectors = [
      'div[data-cy="offer_title"] h4',
      'div[data-testid="offer_title"] h4',
      '[data-cy="offer_title"] h4',
      '[data-testid="offer_title"] h4',
      'div[data-cy="offer_title"] h1',
      'div[data-testid="offer_title"] h1',
      'div[data-cy="offer_title"]',
      'div[data-testid="offer_title"]',
    ];
    for (const sel of selectors) {
      const txt = $(sel).first().text().replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
      if (txt) return txt;
    }
    return "";
  }

  function extractOlxDomDescription($: ReturnType<typeof cheerio.load>): string {
    const selectors = [
      'div[data-cy="ad_description"] div.text-background-action-primary.leading-body-base.whitespace-pre-line',
      'div[data-testid="ad_description"] div.text-background-action-primary.leading-body-base.whitespace-pre-line',
      'div[data-cy="ad_description"] div.text-background-action-primary.whitespace-pre-line',
      'div[data-testid="ad_description"] div.text-background-action-primary.whitespace-pre-line',
      '[data-cy="ad_description"] div[class*="text-background-action-primary"][class*="whitespace-pre-line"]',
      '[data-testid="ad_description"] div[class*="text-background-action-primary"][class*="whitespace-pre-line"]',
      '[data-cy="ad_description"] div[class*="whitespace-pre-line"]',
      '[data-testid="ad_description"] div[class*="whitespace-pre-line"]',
      'div.text-background-action-primary.leading-body-base.whitespace-pre-line',
      'div.text-background-action-primary.whitespace-pre-line',
      'div[class*="text-background-action-primary"][class*="whitespace-pre-line"]',
      'div[data-cy="ad_description"]',
      'div[data-testid="ad_description"]',
    ];
    for (const sel of selectors) {
      const el = $(sel).first();
      if (!el.length) continue;
      const $clone = el.clone();
      $clone.find("script, style, button").remove();
      // If falling back to the outer ad_description container, strip the "Descriere" heading wrapper
      if (sel.endsWith('[data-cy="ad_description"]') || sel.endsWith('[data-testid="ad_description"]')) {
        $clone.find("h2, h3, [data-nx-name='NexusHeading']").each((_, heading) => {
          const hTxt = $(heading).text().trim().toLowerCase();
          if (hTxt === "descriere") {
            $(heading).remove();
          }
        });
      }
      $clone.find("br").replaceWith("\n");
      const cleaned = $clone
        .text()
        .replace(/\r\n/g, "\n")
        .replace(/\u00A0/g, " ")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n[ \t]+/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      if (cleaned && cleaned.toLowerCase() !== "descriere") {
        return cleaned;
      }
    }
    return "";
  }

  function extractOlxDomPrice($: ReturnType<typeof cheerio.load>): string {
    const selectors = [
      'div[data-testid="ad-price-container"] h3',
      '[data-testid="ad-price-container"] h3',
      'div[data-testid="ad-price-container"]',
      '[data-testid="ad-price-container"]',
    ];
    for (const sel of selectors) {
      const txt = $(sel).first().text().replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
      if (txt && /\d/.test(txt)) return txt;
    }
    return "";
  }

  function extractOlxDomOwner($: ReturnType<typeof cheerio.load>): string {
    const selectors = [
      'h4[data-testid="user-profile-user-name"]',
      '[data-testid="user-profile-user-name"]',
    ];
    for (const sel of selectors) {
      const txt = $(sel).first().text().replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
      if (txt) return txt;
    }
    return "";
  }

  function parseRomanianPostedAtDate(rawText: string): string | null {
    const cleaned = String(rawText || "")
      .replace(/\u00A0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned) return null;

    const norm = cleaned
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    const now = new Date();
    const timeMatch = norm.match(/\b(\d{1,2}):(\d{2})\b/);
    const hh = timeMatch ? Math.min(23, parseInt(timeMatch[1], 10)) : 0;
    const mm = timeMatch ? Math.min(59, parseInt(timeMatch[2], 10)) : 0;

    if (/\b(azi|astazi)\b/.test(norm)) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hh, mm, 0));
      return d.toISOString();
    }
    if (/\bieri\b/.test(norm)) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, hh, mm, 0));
      return d.toISOString();
    }

    const months: Record<string, number> = {
      ianuarie: 0, ian: 0,
      februarie: 1, feb: 1,
      martie: 2, mar: 2,
      aprilie: 3, apr: 3,
      mai: 4,
      iunie: 5, iun: 5,
      iulie: 6, iul: 6,
      august: 7, aug: 7,
      septembrie: 8, sep: 8, sept: 8,
      octombrie: 9, oct: 9,
      noiembrie: 10, noi: 10, nov: 10,
      decembrie: 11, dec: 11,
    };

    const roDateMatch = norm.match(/\b(\d{1,2})\s+([a-z]+)\s+(\d{4})\b/);
    if (roDateMatch) {
      const day = parseInt(roDateMatch[1], 10);
      const monthIdx = months[roDateMatch[2]];
      const year = parseInt(roDateMatch[3], 10);
      if (monthIdx !== undefined && day >= 1 && day <= 31 && year >= 2000 && year <= 2100) {
        return new Date(Date.UTC(year, monthIdx, day, hh, mm, 0)).toISOString();
      }
    }

    const dotDateMatch = norm.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/);
    if (dotDateMatch) {
      const day = parseInt(dotDateMatch[1], 10);
      const month = parseInt(dotDateMatch[2], 10) - 1;
      const year = parseInt(dotDateMatch[3], 10);
      if (month >= 0 && month <= 11 && day >= 1 && day <= 31 && year >= 2000 && year <= 2100) {
        return new Date(Date.UTC(year, month, day, hh, mm, 0)).toISOString();
      }
    }

    return null;
  }

  function extractOlxDomPostedAt($: ReturnType<typeof cheerio.load>): {
    rawText: string;
    cleanLabel: string;
    isoDate: string | null;
  } {
    const selectors = [
      'span[data-cy="ad-posted-at"]',
      'span[data-testid="ad-posted-at"]',
      '[data-cy="ad-posted-at"]',
      '[data-testid="ad-posted-at"]',
    ];
    for (const sel of selectors) {
      const el = $(sel).first();
      if (!el.length) continue;
      const rawText = el.text().replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
      if (!rawText) continue;
      const cleanLabel = rawText.replace(/^postat\s*:?\s*/i, "").trim() || rawText;
      const isoDate = parseRomanianPostedAtDate(rawText);
      return { rawText, cleanLabel, isoDate };
    }
    return { rawText: "", cleanLabel: "", isoDate: null };
  }

  interface OlxDomParametersResult {
    hasContainer: boolean;
    isPrivateSeller: boolean;
    isAgency: boolean;
    sellerType: "Persoana fizica" | "Agentie" | "";
    suprafataUtila: string;
    anConstructie: string;
    etaj: string;
    compartimentare: string;
    camere: string;
    rawItems: string[];
  }

  function extractOlxDomParameters($: ReturnType<typeof cheerio.load>): OlxDomParametersResult {
    const result: OlxDomParametersResult = {
      hasContainer: false,
      isPrivateSeller: false,
      isAgency: false,
      sellerType: "",
      suprafataUtila: "",
      anConstructie: "",
      etaj: "",
      compartimentare: "",
      camere: "",
      rawItems: [],
    };

    const $container = $(
      'div[data-testid="ad-parameters-container"], [data-testid="ad-parameters-container"]'
    ).first();
    if (!$container.length) {
      return result;
    }

    result.hasContainer = true;
    const $items = $container.find("p");
    const elements = $items.length > 0 ? $items : $container.children();

    elements.each((_, el) => {
      const txt = $(el).text().replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
      if (!txt) return;
      result.rawItems.push(txt);

      const norm = txt
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

      if (/\bpersoana\s+fizica\b/.test(norm)) {
        result.isPrivateSeller = true;
        result.sellerType = "Persoana fizica";
      }

      const surfMatch = txt.match(/suprafa[tțţ][aă]?\s*util[aă]?\s*:\s*([\d.,]+)/i);
      if (surfMatch && !result.suprafataUtila) {
        result.suprafataUtila = surfMatch[1].replace(",", ".");
      }

      const yearMatch = txt.match(/an\s+construc[tțţ]ie\s*:\s*(.+)$/i);
      if (yearMatch && !result.anConstructie) {
        result.anConstructie = yearMatch[1].trim();
      }

      const floorMatch = txt.match(/etaj\s*:\s*(.+)$/i);
      if (floorMatch && !result.etaj) {
        const fv = floorMatch[1].trim();
        result.etaj = /^\d+$/.test(fv) ? `Etaj ${fv}` : fv;
      }

      const compMatch = txt.match(/compartimentare\s*:\s*(.+)$/i);
      if (compMatch && !result.compartimentare) {
        const cv = compMatch[1].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (cv.includes("semidecomandat")) result.compartimentare = "Semidecomandat";
        else if (cv.includes("nedecomandat")) result.compartimentare = "Nedecomandat";
        else if (cv.includes("circular")) result.compartimentare = "Circular";
        else if (cv.includes("decomandat")) result.compartimentare = "Decomandat";
      }

      const roomsMatch = txt.match(/(?:num[aă]r\s+camere|camere)\s*:\s*(.+)$/i);
      if (roomsMatch && !result.camere) {
        const rv = roomsMatch[1].toLowerCase();
        if (rv.includes("garsonier")) result.camere = "1";
        else {
          const digits = rv.match(/\d+/);
          if (digits) result.camere = digits[0];
        }
      }
    });

    if (result.rawItems.length > 0 && !result.isPrivateSeller) {
      result.isAgency = true;
      result.sellerType = "Agentie";
    }

    return result;
  }

  function parseDomPriceString(priceStr: string): { value: number; currency: "EUR" | "RON" } {
    const cleaned = String(priceStr || "").replace(/\u00A0/g, " ").trim();
    const lower = cleaned.toLowerCase();
    const currency: "EUR" | "RON" = lower.includes("ron") || lower.includes("lei") ? "RON" : "EUR";
    const m = cleaned.match(/(\d[\d\s.,]*)/);
    if (!m) return { value: 0, currency };
    const withoutDecimals = m[1].trim().replace(/[.,]\d{1,2}$/, "");
    const value = parseInt(withoutDecimals.replace(/[^0-9]/g, ""), 10) || 0;
    return { value, currency };
  }

  function cleanHtmlDescriptionPreservingLines(raw: string): string {
    return String(raw || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\r\n/g, "\n")
      .replace(/\u00A0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // Helper to extract price, phone number, owner name, title, description, posted date, and seller type from storia.ro or olx.ro HTML snippets
  function extractListingDetails(html: string, url: string = "") {
    const $ = cheerio.load(html || "");
    
    let source: "storia" | "olx" | null = null;
    if (url.includes("storia.ro") || $('[data-cy*="storia"]').length > 0 || $('[data-sentry-component]').length > 0) {
      source = "storia";
    } else if (
      url.includes("olx.ro") ||
      $('[data-cy="offer_title"], [data-testid="offer_title"], [data-testid="ad-price-container"], [data-testid="ad-parameters-container"]').length > 0 ||
      $('[data-testid*="ad"]').length > 0 ||
      $('[data-nx-name]').length > 0
    ) {
      source = "olx";
    }

    if (!source) {
      if ($('strong[data-cy="adPageHeaderPrice"], [data-sentry-element="Price"], div[data-sentry-component="MainPriceWrapper"]').length > 0) {
        source = "storia";
      } else if ($('div[data-testid="ad-price-container"], h3[data-nx-name="H3"]').length > 0) {
        source = "olx";
      }
    }

    let rawPrice: string | null = null;
    let rawPhone: string | null = null;
    let rawOwner: string | null = null;
    let rawTitle: string | null = null;
    let rawDescription: string | null = null;
    let postedAtRaw: string | null = null;
    let postedAtIso: string | null = null;
    let isPrivateSeller: boolean | null = null;
    let isAgency: boolean | null = null;
    let olxParameters: OlxDomParametersResult | null = null;

    const normalizeText = (text: string | null | undefined): string | null => {
      if (!text) return null;
      let cleaned = text.replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
      return cleaned || null;
    };

    const cleanPrice = (text: string | null | undefined): string | null => {
      if (!text) return null;
      let cleaned = text.replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
      const lower = cleaned.toLowerCase();
      const hasLuna = /\/(?:lun[aă]|luni|month)\b/i.test(cleaned);

      if (lower.includes("ron") || lower.includes("lei")) {
        const digits = parseFloat(cleaned.replace(/[^0-9.,]/g, "").replace(",", "."));
        if (!isNaN(digits) && digits > 0) {
          const eurVal = Math.round(digits / 5.0);
          cleaned = `${eurVal} €${hasLuna ? " / lună" : ""}`;
        }
      }
      return cleaned || null;
    };

    if (source === "storia") {
      const priceEl = $('strong[data-cy="adPageHeaderPrice"]').first()
        .add('[data-sentry-element="Price"]').first()
        .add('div[data-sentry-component="MainPriceWrapper"] strong').first();
      if (priceEl.length) rawPrice = priceEl.text();

      const phoneEl = $('a[data-cy="phone-number.number-button"]').first()
        .add('div[data-sentry-component="PhoneNumber"] a[href^="tel:"]').first();
      if (phoneEl.length) {
        rawPhone = phoneEl.attr("href")?.replace("tel:", "") || phoneEl.text();
      } else {
        const telHref = $('a[href^="tel:"]').first().attr("href");
        if (telHref) rawPhone = telHref.replace("tel:", "");
      }

      const ownerEl = $('p.truncate.font-bold').first()
        .add('p[class*="truncate"][class*="font-bold"]').first();
      if (ownerEl.length) rawOwner = ownerEl.text();
    } else if (source === "olx") {
      const olxPrice = extractOlxDomPrice($);
      if (olxPrice) {
        rawPrice = olxPrice;
      } else {
        const priceEl = $('h3[data-nx-name="H3"]').first();
        if (priceEl.length) rawPrice = priceEl.text();
      }

      const olxTitle = extractOlxDomTitle($);
      if (olxTitle) rawTitle = olxTitle;

      const olxDesc = extractOlxDomDescription($);
      if (olxDesc) rawDescription = olxDesc;

      const revealedOlxPhone = extractPhoneFromOlxHtml(html);
      if (revealedOlxPhone) {
        rawPhone = revealedOlxPhone;
      }

      const olxOwner = extractOlxDomOwner($);
      if (olxOwner) rawOwner = olxOwner;

      const olxPostedAt = extractOlxDomPostedAt($);
      if (olxPostedAt.rawText) {
        postedAtRaw = olxPostedAt.cleanLabel;
        postedAtIso = olxPostedAt.isoDate;
      }

      const params = extractOlxDomParameters($);
      olxParameters = params;
      if (params.hasContainer) {
        isPrivateSeller = params.isPrivateSeller;
        isAgency = params.isAgency;
      }
    }

    if (!rawPrice) {
      const fallbackPrice = $('strong[data-cy="adPageHeaderPrice"], div[data-testid="ad-price-container"] h3, [data-sentry-element="Price"]').first();
      if (fallbackPrice.length) rawPrice = fallbackPrice.text();
    }
    if (!rawPhone && source !== "olx") {
      const fallbackPhone = $('a[data-cy="phone-number.number-button"], a[data-testid="contact-phone"], a[href^="tel:"]').first();
      if (fallbackPhone.length) {
        const candidate = fallbackPhone.attr("href")?.replace("tel:", "") || fallbackPhone.text();
        rawPhone = extractValidRoPhone(candidate);
      }
    }
    if (!rawOwner) {
      const fallbackOwner = $('p.truncate.font-bold, h4[data-testid="user-profile-user-name"]').first();
      if (fallbackOwner.length) rawOwner = fallbackOwner.text();
    }

    return {
      source: source || null,
      title: normalizeText(rawTitle),
      description: rawDescription,
      price: cleanPrice(rawPrice),
      phone_number: normalizeText(rawPhone),
      owner_name: normalizeText(rawOwner),
      posted_at: postedAtRaw,
      posted_at_iso: postedAtIso,
      is_private_seller: isPrivateSeller,
      is_agency: isAgency,
      parameters: olxParameters,
    };
  }

  app.post("/api/parse-listing-html", ...requireTenantContext, crawlRouteLimiter, (req, res) => {
    try {
      const { html, url } = req.body;
      const result = extractListingDetails(html || "", url || "");
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ source: null, price: null, phone_number: null, owner_name: null });
    }
  });

  // API endpoint for crawling
  app.post("/api/crawl", ...requireTenantContext, crawlRouteLimiter, requireQuota("ai_requests", 1), async (req, res, next) => {
    const rawUrl = req.body?.url;
    let url = (typeof rawUrl === "string" ? rawUrl : "").trim();
    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = "https://" + url;
    }

    try {
      await validateSafeExternalUrl(url);
    } catch (ssrfErr: any) {
      return res.status(400).json({ error: ssrfErr?.message || "URL invalid sau blocat de politica SSRF." });
    }

    try {
      QuotaService.consumeQuota(req.tenantContext!.tenantId, "ai_requests", 1);
    } catch (quotaErr: any) {
      return res.status(quotaErr?.statusCode || 429).json({ error: quotaErr?.message || "Cota lunară a fost atinsă." });
    }

    // Fast path for CRM share links (/share/:id or /p/:id) backed by our persistent store
    try {
      const parsedShareUrl = new URL(url);
      const sharePathMatch = parsedShareUrl.pathname.match(/^\/(?:share|p)\/([A-Za-z0-9_-]+)\/?$/i);
      if (sharePathMatch?.[1]) {
        const urlTenantId = resolvePublicShareTenantIdFromHost(parsedShareUrl.hostname);
        const sharedProp = await fetchPropertyByIdCached(sharePathMatch[1], urlTenantId);
        if (sharedProp) {
          const authTenantId = req.tenantContext?.tenantId;
          const isSameTenant = !sharedProp.tenantId || !authTenantId || sharedProp.tenantId === authTenantId;
          const safeProp = isSameTenant ? sharedProp : sanitizePublicProperty(sharedProp);
          const wrapProxy = (u: string) => {
            if (!u || typeof u !== "string") return "";
            const trimmed = u.trim();
            if (trimmed.startsWith("//")) {
              return `/api/proxy-image?url=${encodeURIComponent("https:" + trimmed)}`;
            }
            if (trimmed.startsWith("http") && !trimmed.includes("/api/proxy-image")) {
              return `/api/proxy-image?url=${encodeURIComponent(trimmed)}`;
            }
            return trimmed;
          };

          const rawImgList: string[] = [];
          if (Array.isArray(safeProp.images)) {
            safeProp.images.forEach((im: any) => {
              const s = typeof im === "string" ? im : im?.original;
              if (s) rawImgList.push(s);
            });
          }
          const crmImagini = safeProp.extractedData?.crmData?.imagini;
          if (crmImagini && typeof crmImagini === "object") {
            for (const cat of ["living", "camera", "bucatarie", "baie", "alteSpatii"]) {
              if (Array.isArray(crmImagini[cat])) {
                crmImagini[cat].forEach((im: any) => {
                  const s = typeof im === "string" ? im : im?.original;
                  if (s) rawImgList.push(s);
                });
              }
            }
          }
          if (safeProp.coverImage) rawImgList.unshift(safeProp.coverImage);

          const proxiedImages = Array.from(new Set(rawImgList.map(wrapProxy).filter(Boolean))).slice(0, 50);
          const clonedCrm = safeProp.extractedData?.crmData ? JSON.parse(JSON.stringify(safeProp.extractedData.crmData)) : undefined;
          if (clonedCrm?.imagini) {
            for (const cat of ["living", "camera", "bucatarie", "baie", "alteSpatii"]) {
              if (Array.isArray(clonedCrm.imagini[cat])) {
                clonedCrm.imagini[cat] = clonedCrm.imagini[cat].map((im: any) =>
                  typeof im === "string" ? wrapProxy(im) : (im?.original ? { ...im, original: wrapProxy(im.original) } : im)
                );
              }
            }
          }

          return res.json({
            title: safeProp.title || clonedCrm?.descriere?.titlu || "Proprietate imobiliară",
            price: safeProp.price || clonedCrm?.pret?.detalii?.pret || "N/A",
            zone: safeProp.zone || clonedCrm?.detaliiGenerale?.localizare?.zona?.[0] || "București",
            oras: clonedCrm?.detaliiGenerale?.localizare?.oras || "București",
            ownerName: safeProp.ownerName || clonedCrm?.detaliiGenerale?.proprietar || "Nespecificat",
            ownerPhone: safeProp.ownerPhone || clonedCrm?.detaliiGenerale?.contacteAditionale || "Nespecificat",
            transactionType: safeProp.transactionType || clonedCrm?.detaliiGenerale?.tranzactie || "Vânzare",
            categoria: safeProp.categoria || clonedCrm?.detaliiGenerale?.categoria || "Apartament",
            description: safeProp.extractedData?.originalDescription || safeProp.extractedData?.markdownMarketing || clonedCrm?.descriere?.continut || "",
            images: proxiedImages,
            coverImage: proxiedImages[0] || (safeProp.coverImage ? wrapProxy(safeProp.coverImage) : null),
            crmData: clonedCrm || null,
            presentationSections: safeProp.extractedData?.presentationSections || null,
            text: ""
          });
        }
      }
    } catch (shareErr: any) {
      logger.warn(`Share link fast-path warning: ${shareErr?.message}`, { module: "crawler" });
    }

    const crawlHeaderProfiles: Array<Record<string, string>> = [
      {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "ro-RO,ro;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Referer": "https://www.google.ro/",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Ch-Ua": '"Chromium";v="134", "Not:A-Brand";v="24", "Google Chrome";v="134"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "cross-site",
        "Sec-Fetch-User": "?1"
      },
      {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ro-RO,ro;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "gzip, deflate, br",
        "Referer": "https://www.google.com/",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "cross-site"
      },
      {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ro-RO,ro;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "gzip, deflate, br"
      }
    ];
    const userAgents = crawlHeaderProfiles.map((profile) => profile["User-Agent"]);

    let lastError: any = null;
    let lastUpstreamStatus: number | null = null;

    const providedHtml =
      typeof req.body?.html === "string" && req.body.html.trim().length > 50
        ? req.body.html.trim()
        : "";
    const maxAttempts = providedHtml ? 1 : crawlHeaderProfiles.length;

    // Fast, resilient crawling with controlled timeouts & HTTP/2 fallback
    for (let i = 0; i < maxAttempts; i++) {
      try {
        let html = providedHtml;
        if (!html) {
          logger.info(`Fetching URL (attempt ${i + 1})`, {
            module: "crawler",
            meta: { attempt: i + 1, host: new URL(url).hostname },
          });
          const response = await safeFetchExternal(url, {
            headers: crawlHeaderProfiles[i],
            timeout: 8000,
            responseType: "text",
          });

          if (
            response.status === 403 ||
            response.status === 429 ||
            response.status === 502 ||
            response.status === 503 ||
            response.status === 504
          ) {
            lastUpstreamStatus = response.status;
            lastError = new Error(`Site returned ${response.status}`);
            logger.warn(`Target site returned ${response.status} on crawl attempt ${i + 1}`, {
              module: "crawler",
              meta: { attempt: i + 1, upstreamStatus: response.status, host: new URL(url).hostname },
            });
            if (i < crawlHeaderProfiles.length - 1) {
              await new Promise(r => setTimeout(r, 600));
              continue;
            }
            break;
          }

          if (response.status >= 400) {
            lastUpstreamStatus = response.status;
            lastError = new Error(`HTTP Error ${response.status}`);
            logger.warn(`Target site returned HTTP ${response.status} on crawl attempt ${i + 1}`, {
              module: "crawler",
              meta: { attempt: i + 1, upstreamStatus: response.status, host: new URL(url).hostname },
            });
            break;
          }

          html = typeof response.data === "string" ? response.data : String(response.data || "");
          if (isBotChallengePage(html)) {
            lastUpstreamStatus = 403;
            lastError = new Error("Site-ul extern a afișat o pagină de verificare anti-bot / Cookie check.");
            logger.warn(`Target site served bot challenge on attempt ${i + 1}`, {
              module: "crawler",
              meta: { attempt: i + 1, host: new URL(url).hostname },
            });
            if (i < crawlHeaderProfiles.length - 1) {
              await new Promise(r => setTimeout(r, 600));
              continue;
            }
            break;
          }
        }

        const $ = cheerio.load(html);

        // Structured states (Storia __NEXT_DATA__ including React Query dehydratedState, OLX __PRERENDERED_STATE__, JSON-LD)
        let nextAdData: any = null;
        $("script#__NEXT_DATA__").each((_, el) => {
          if (nextAdData) return;
          const htmlVal = $(el).html();
          if (htmlVal) {
            try {
              const parsed = JSON.parse(htmlVal);
              nextAdData = extractNextAdDataFromParsed(parsed);
            } catch {}
          }
        });

        const olxState = parseOlxPrerenderedState($);
        const olxAd: any = olxState?.ad?.ad || olxState?.ad || null;
        const olxBreadcrumbs: any[] = Array.isArray(olxState?.ad?.breadcrumbs) ? olxState.ad.breadcrumbs : [];

        const olxDomTitle = extractOlxDomTitle($);
        const olxDomOwner = extractOlxDomOwner($);
        const olxDomPostedAt = extractOlxDomPostedAt($);
        const olxDomParams = extractOlxDomParameters($);
        const isOlxPage = url.toLowerCase().includes("olx.ro") || Boolean(olxDomTitle) || olxDomParams.hasContainer;

        // OLX.ro Private Seller Rule:
        // Verify "Persoana fizica" exists inside div[data-testid="ad-parameters-container"];
        // otherwise the ad is published by an agency and must be rejected.
        if (isOlxPage) {
          const isConfirmedAgency = olxDomParams.hasContainer
            ? !olxDomParams.isPrivateSeller
            : olxAd?.business === true || olxAd?.user?.is_business === true;
          if (isConfirmedAgency) {
            res.status(422).json({
              error: 'Anunțul OLX.ro este publicat de o agenție / firmă (nu conține „Persoana fizica”). Sunt acceptate doar anunțurile de la persoane fizice.',
              code: "OLX_AGENCY_AD",
              sellerType: "Agentie",
            });
            return;
          }
        }

        const ogTitle = $('meta[property="og:title"]').attr("content") || $('meta[name="twitter:title"]').attr("content") || "";
        const ogDescription = $('meta[property="og:description"]').attr("content") || $('meta[name="description"]').attr("content") || "";
        const title = String(
          (isOlxPage ? olxDomTitle : "") ||
          nextAdData?.title ||
          olxAd?.title ||
          olxDomTitle ||
          ogTitle ||
          $("title").text() ||
          "No title found"
        ).trim();

        // Extract image URLs strictly for the target property (filtering out logos, layouts, and recommendations)
        const imageExtensions = /\.(jpeg|jpg|gif|png|webp|avif)/i;
        const socialMediaBlocked = ["facebook.com", "linkedin.com", "twitter.com", "instagram.com", "youtube.com", "pinterest.com", "tiktok.com"];
        const adKeywords = ["google-analytics", "ads.", "doubleclick", "/ads/", "/banners/"];

        // Helper to identify and reject icons, logos, badges, layouts, avatars, maps, buttons, etc.
        const isForbiddenGraphic = (urlStr: string): boolean => {
          const lower = urlStr.toLowerCase();
          // For signed RoamCDN URLs, inspect only preset + filename so random base64url HMAC tokens
          // never false-positive on short English substrings like "pin", "pdf", or "logo".
          if (lower.includes("roamcdn.net")) {
            return isImobiliareNonGalleryAsset(urlStr);
          }
          const badPatterns = [
            "logo", "avatar", "watermark-logo", "badge", "icon", "placeholder",
            "sprite", "layout", "banner", "staticmap", "google-map", "/map/", "maps.googleapis",
            "favicon", "button", "arrow", "pin", "pixel", "tracking", "analytics",
            "user", "profile", "agent", "broker", "agentie", "dezvoltator", "developer",
            "sponsor", "promovat", "blank", "default", "spinner", "loader", ".svg",
            "document", "pdf", ".gif", "recommend", "similar", "related",
            "header", "footer", "navbar", "ad-banner"
          ];
          return badPatterns.some(p => lower.includes(p));
        };

        // Helper to promote known thumbnail image URLs to full/maximum resolution
        const promoteToHighRes = (rawUrl: string): string => {
          let cleaned = rawUrl.trim().replace(/\\/g, "");
          if (cleaned.startsWith("//")) cleaned = "https:" + cleaned;

          // Legacy Imobiliare.ro (non-signed roamcdn) high-resolution promotions.
          // Signed `i.roamcdn.net` URLs are resolved & verified cleanly by `imobiliarePhotoExtractor`
          // so we never blindly rewrite signed `{preset}` segments into 403/404 URLs.
          if (cleaned.includes("imobiliare.ro") && !cleaned.toLowerCase().includes("roamcdn.net")) {
            cleaned = cleaned
              .replace(/_(?:75x75|100x100|150x150|160x120|200x150|400x300|640x480)\.jpg/gi, "_1200x900.jpg")
              .replace(/\/thumb\//gi, "/large/")
              .replace(/\/small\//gi, "/large/")
              .replace(/\/medium\//gi, "/large/");
          }

          // Publi24 promotions
          if (cleaned.includes("publi24") || cleaned.includes("pstatic") || cleaned.includes("pcdnh")) {
            cleaned = cleaned
              .replace(/\/small\//gi, "/extralarge/")
              .replace(/\/medium\//gi, "/extralarge/")
              .replace(/\/thumb\//gi, "/extralarge/")
              .replace(/\/top\//gi, "/extralarge/");
          }

          // Storia / OLX Apollo / Akamaized promotions: enforce maximum 1000x700
          if (cleaned.includes(";s=")) {
            cleaned = cleaned.replace(/;s=\d+x\d+/, ";s=1000x700");
          } else if (
            (cleaned.includes("akamaized.net") || cleaned.includes("apollo") || cleaned.includes("storia.ro") || cleaned.includes("olxcdn")) &&
            (cleaned.includes("/files/") || cleaned.includes("/image") || cleaned.includes("/photos/"))
          ) {
            cleaned = cleaned + (cleaned.includes("?") ? "&" : ";") + "s=1000x700";
          }

          // General small/medium/thumb to large
          cleaned = cleaned.replace(/\/(?:small|thumb|mini)\//gi, "/large/");

          return cleaned;
        };

        // Block known agency/owner avatars so they are never imported into property gallery
        const blockedAgencyUrls = [
          nextAdData?.owner?.imageUrl,
          nextAdData?.agency?.imageUrl,
          nextAdData?.agency?.branding?.logoUrl,
          olxAd?.user?.logo_ad_page,
          olxAd?.user?.photo,
        ].filter((x): x is string => typeof x === "string" && x.length > 0);
        const getBaseUrlPath = (u: string) => u.split(/[?;]/)[0].toLowerCase();
        const blockedAgencyPaths = new Set(blockedAgencyUrls.map(getBaseUrlPath));

        // Priority 0A: Dedicated Imobiliare.ro gallery extractor anchored strictly to
        // `<div id="detail-gallery-modal-panel-gallery" role="tabpanel" aria-labelledby="detail-gallery-modal-tab-gallery">`
        const isImobiliarePage =
          isImobiliareUrl(url) ||
          $("#detail-gallery-modal-panel-gallery").length > 0 ||
          $('[role="tabpanel"][aria-labelledby="detail-gallery-modal-tab-gallery"]').length > 0;

        let imobiliareGalleryImages: string[] = [];
        if (isImobiliarePage) {
          let imobiliareExtraction = extractImobiliareGalleryPhotos({
            $,
            html,
            pageUrl: url,
            isForbiddenGraphic,
            blockedAgencyPaths,
            getBaseUrlPath,
          });

          const needsBrowserSweep =
            imobiliareExtraction.images.length <= 1 ||
            imobiliareExtraction.remainingThumbnailsCount > 0;

          if (needsBrowserSweep && isImobiliareUrl(url)) {
            const browserExtraction = await extractImobiliareGalleryViaBrowser(url, {
              isForbiddenGraphic,
              blockedAgencyPaths,
              getBaseUrlPath,
            });
            if (browserExtraction && browserExtraction.images.length > 0) {
              imobiliareExtraction = mergeImobiliareGalleryResults(
                imobiliareExtraction,
                browserExtraction
              );
            }
          }

          if (imobiliareExtraction.remainingThumbnailsCount > 0) {
            imobiliareGalleryImages = await upgradeRemainingImobiliareThumbnails(
              imobiliareExtraction.images,
              {
                observedHighResPresets: imobiliareExtraction.observedHighResPresets,
              }
            );
          } else {
            imobiliareGalleryImages = imobiliareExtraction.images;
          }

          logger.info(
            `Imobiliare gallery extracted (${imobiliareExtraction.source}, primaryPanel=${imobiliareExtraction.primaryPanelFound}, folders=${imobiliareExtraction.authoritativeFolders.length}, count=${imobiliareGalleryImages.length}, remainingThumbs=${imobiliareGalleryImages.filter(isImobiliareThumbnailUrl).length})`,
            { module: "crawler" }
          );
        }

        // Priority 0: Dedicated Storia mosaic gallery view ([data-cy="mosaic-gallery-main-view"])
        let mosaicGalleryImages: string[] = [];
        const mosaicSelectors = [
          '[data-cy="mosaic-gallery-main-view"]',
          '[data-cy*="mosaic-gallery"]',
          '[data-sentry-component="BaseMainView"]',
          '[data-sentry-source-file*="MainView"]',
          '[data-cy*="gallery-main-view"]'
        ];
        const $mosaic = $(mosaicSelectors.join(", "));
        if (!isImobiliarePage && $mosaic.length > 0) {
          $mosaic.find("img, source, a, button, div, picture").each((_, el) => {
            const $el = $(el);
            const src = $el.attr("src");
            const dataSrc = $el.attr("data-src") || $el.attr("data-lazy") || $el.attr("data-full");
            const srcset = $el.attr("srcset") || $el.attr("data-srcset");
            const style = $el.attr("style");
            let candidates = [src, dataSrc];
            if (srcset) {
              const bestSrcset = parseSrcsetCandidates(srcset, url);
              if (bestSrcset.length > 0) {
                candidates.push(bestSrcset[0].url);
              }
            }
            if (style && style.includes("url(")) {
              const m = style.match(/url\(['"]?([^'"]+)['"]?\)/);
              if (m) candidates.push(m[1]);
            }
            candidates.forEach(raw => {
              if (!raw || typeof raw !== "string") return;
              let absUrl = raw.trim().replace(/\\/g, "");
              if (absUrl.startsWith("//")) absUrl = "https:" + absUrl;
              if (!absUrl.startsWith("http")) return;
              const promoted = promoteToHighRes(absUrl);
              if (!isForbiddenGraphic(promoted) && !blockedAgencyPaths.has(getBaseUrlPath(promoted))) {
                mosaicGalleryImages.push(promoted);
              }
            });
          });
        }

        // Priority 1: Extract ALL gallery photos from __NEXT_DATA__ (all non-empty arrays, dehydratedState, and Storia flight scripts)
        const storiaExtraction = extractStoriaNextDataAndPhotos({
          $,
          pageUrl: url,
          promoteToHighRes,
          isForbiddenGraphic,
          blockedAgencyPaths,
          getBaseUrlPath,
        });
        if (!nextAdData && storiaExtraction.nextAdData) {
          nextAdData = storiaExtraction.nextAdData;
        }
        const nextDataTargetImages: string[] = storiaExtraction.nextDataTargetImages;
        const isStoriaPage = url.toLowerCase().includes("storia.ro") || url.toLowerCase().includes("otodom.");

        // Priority 1B: OLX window.__PRERENDERED_STATE__ ad.photos
        let olxPhotos: string[] = [];
        if (Array.isArray(olxAd?.photos) && olxAd.photos.length > 0) {
          olxAd.photos.forEach((item: any) => {
            const candidate = typeof item === "string" ? item : (item?.link || item?.url || item?.large || item?.src);
            if (candidate && typeof candidate === "string") {
              const promoted = promoteToHighRes(candidate);
              if (!isForbiddenGraphic(promoted) && !blockedAgencyPaths.has(getBaseUrlPath(promoted))) {
                olxPhotos.push(promoted);
              }
            }
          });
        }

        // Collect JSON-LD metadata images (only used when structured gallery is empty, to avoid Organization logos)
        let jsonLdImages: string[] = [];
        let jsonLdData: any = null;
        $("script[type='application/ld+json']").each((_, script) => {
          try {
            const content = $(script).html();
            if (content) {
              const ld = JSON.parse(content);
              if (!jsonLdData) jsonLdData = ld;
              const items = Array.isArray(ld) ? ld : (ld["@graph"] ? ld["@graph"] : [ld]);
              items.forEach((item: any) => {
                if (item && item.image) {
                  const imgs = Array.isArray(item.image) ? item.image : [item.image];
                  imgs.forEach((img: any) => {
                    const u = typeof img === "string" ? img : (img?.url || img?.contentUrl);
                    if (u && typeof u === "string") {
                      const promoted = promoteToHighRes(u);
                      if (!isForbiddenGraphic(promoted) && !blockedAgencyPaths.has(getBaseUrlPath(promoted))) {
                        jsonLdImages.push(promoted);
                      }
                    }
                  });
                }
              });
            }
          } catch {}
        });

        const hasStructuredGallery =
          isImobiliarePage ||
          mosaicGalleryImages.length > 0 ||
          nextDataTargetImages.length > 0 ||
          olxPhotos.length > 0;

        // Priority 3: DOM Gallery elements (only scraped when structured gallery sources are empty, preventing agency avatar leaks)
        let domGalleryImages: string[] = [];
        if (!hasStructuredGallery) {
          const unrelatedSelectors = [
            "aside", "footer", "nav", "header",
            ".recommendations", ".featured-offers", ".similar-offers", ".similar-ads",
            ".others-ads", ".suggested-offers", "[data-testid=\"recommendations\"]",
            ".listing-related", ".related-ads", "#ad-recommendations", ".bottom-ads",
            ".other-offers", ".related-offers", ".promoted-offers", ".slider-similar",
            ".agent-card", ".agency-card", ".agency-logo", ".broker-logo", ".developer-logo",
            ".user-card", ".user-profile", ".breadcrumbs", ".search-results",
            "[data-cy=\"similar-ads\"]", "[data-cy=\"recommended-ads\"]",
            ".ad-carousel-similar", ".similar-listings", ".related-properties",
            ".cross-selling", ".cross-sell", ".banner", ".ad-banner", ".header-logo",
            ".site-header", ".site-footer", ".navbar", ".menu", ".sidebar", ".contact-agent-section",
            "[data-testid*=\"similar\"]", "[data-testid*=\"recommend\"]", "[data-testid*=\"promoted\"]",
            "[data-cy*=\"similar\"]", "[data-cy*=\"recommend\"]", "[data-cy*=\"ad-card\"]", "[data-cy*=\"listing\"]",
            "[data-testid*=\"ad-card\"]", "[data-testid*=\"listing\"]",
            ".cards-container", ".slider-cards",
            "[class*=\"similar\"]", "[class*=\"recommend\"]", "[class*=\"suggested\"]",
            "section:has(h2:contains(\"similare\"))", "section:has(h3:contains(\"similare\"))",
            "section:has(h2:contains(\"recomand\"))", "section:has(h3:contains(\"recomand\"))"
          ];
          unrelatedSelectors.forEach(selector => {
            $(selector).remove();
          });

          const galleryContainers = $(
            "#galerie, .galerie, [data-testid=\"gallery\"], [data-testid*=\"gallery\"], [data-testid*=\"photo\"], .gallery-slider, " +
            ".image-gallery, .swiper-wrapper, .swiper-container, .property-gallery, .offer-photos, #slider-pro, .slider-for, " +
            ".ad-gallery, [data-cy=\"ad-photos\"], [data-cy*=\"photo\"], .main-slider, #fotoGal, .foto-galerie, #photo-gallery, " +
            ".slider-galerie, #anunt-galerie"
          );

          const searchScope = galleryContainers.length > 0
            ? galleryContainers.add("article[data-cy='ad-content'], [data-cy='ad-content'], .offer-view, .ad-content, #main-content, main, article")
            : $("article, main, #main-content, .offer-view, [data-cy='ad-content'], body");

          searchScope.find("img, a, picture source, [data-src], [data-lazy], [data-full], [data-lazy-src], [data-original], [data-src-full], [data-zoom], [data-image], [data-gallery-src], [data-url]").each((_, el) => {
            const $el = $(el);
            const src = $el.attr("src");
            const dataSrc = $el.attr("data-src") || $el.attr("data-lazy") || $el.attr("data-full") || $el.attr("data-lazy-src") || $el.attr("data-original") || $el.attr("data-src-full") || $el.attr("data-zoom") || $el.attr("data-image") || $el.attr("data-gallery-src") || $el.attr("data-url");
            const href = ($el.prop("tagName") === "A") ? $el.attr("href") : null;
            const srcset = $el.attr("srcset") || $el.attr("data-srcset");

            let candidates = [dataSrc, src, href];
            if (srcset) {
              const parsedSrcset = parseSrcsetCandidates(srcset, url);
              if (parsedSrcset.length > 0) {
                candidates = [parsedSrcset[0].url, ...candidates];
              }
            }

            candidates.forEach(raw => {
              if (!raw || typeof raw !== "string") return;
              let absUrl = raw.trim().replace(/\\/g, "");
              if (absUrl.startsWith("//")) absUrl = "https:" + absUrl;
              else if (absUrl.startsWith("/") && !absUrl.startsWith("//")) {
                try {
                  const uObj = new URL(url);
                  absUrl = uObj.origin + absUrl;
                } catch {}
              }
              if (!absUrl.startsWith("http")) return;

              const promoted = promoteToHighRes(absUrl);
              if (isForbiddenGraphic(promoted) || blockedAgencyPaths.has(getBaseUrlPath(promoted))) return;
              if (socialMediaBlocked.some(s => promoted.toLowerCase().includes(s))) return;
              if (adKeywords.some(k => promoted.toLowerCase().includes(k))) return;

              const isKnownImage = imageExtensions.test(promoted) ||
                promoted.includes("/files/") || promoted.includes("/image") || promoted.includes("/photos/") || promoted.includes("roamcdn") || promoted.includes("apollo");

              if (isKnownImage) {
                domGalleryImages.push(promoted);
              }
            });
          });
        }

        // Fallback OG image if nothing found above
        const ogImages: string[] = [];
        if (!hasStructuredGallery && domGalleryImages.length === 0 && jsonLdImages.length === 0) {
          const ogImg = $('meta[property="og:image"]').attr("content") || $('meta[name="twitter:image"]').attr("content");
          if (ogImg && typeof ogImg === "string") {
            let absOg = ogImg.trim();
            if (absOg.startsWith("//")) absOg = "https:" + absOg;
            if (absOg.startsWith("http") && !isForbiddenGraphic(absOg)) {
              ogImages.push(promoteToHighRes(absOg));
            }
          }
        }

        const rawCandidates = isImobiliarePage
          ? imobiliareGalleryImages
          : hasStructuredGallery
            ? [
                ...nextDataTargetImages,
                ...mosaicGalleryImages,
                ...olxPhotos,
                ...(isStoriaPage && nextDataTargetImages.length + mosaicGalleryImages.length <= 6 ? jsonLdImages : []),
              ]
            : [...jsonLdImages, ...domGalleryImages, ...ogImages];

        // Deduplicate images and keep highest resolution version
        const deduplicateImages = (urls: string[]) => {
          const map = new Map<string, string>();

          const getCanonical = (u: string) => {
            const base = u.split(/[?;]/)[0];
            const lowerBase = base.toLowerCase();

            // 1. Imobiliare.ro / RoamCDN canonical photo identity (ignores per-variant preset & hashes)
            if (lowerBase.includes("roamcdn.net") || lowerBase.includes("imobiliare.ro")) {
              return getImobiliarePhotoKey(u);
            }

            // 2. OLX / Storia file ID or JWT token
            const olxMatch = base.match(/\/v1\/files\/([^/]+)/i);
            if (olxMatch) {
              const token = olxMatch[1];
              if (token.includes(".")) {
                const parts = token.split(".");
                try {
                  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
                  if (payload.fn) return `olx-${payload.fn}`;
                } catch {}
                return `olx-${parts[1]}`;
              }
              return `olx-${token.toLowerCase()}`;
            }

            // Use filename and immediate parent directory as canonical key so different photos have unique keys
            const segments = base.split("/").filter(Boolean);
            const filename = segments.pop() || base;
            const parentFolder = segments.pop() || "";

            // 3. Filename cleaning (strip dimensions and responsive suffixes)
            const cleanFilename = filename
              .replace(/_\d+x\d+(?=\.[a-z]+)/i, "")
              .replace(/-(?:full|small|medium|thumb|large|mini|1200w|1600w|800w|400w|600w|300w|140w|200w)/gi, "");
            return `${parentFolder}-${cleanFilename}`.toLowerCase();
          };

          const getScore = (u: string) => {
            const lower = u.toLowerCase();
            if (lower.includes("roamcdn.net") || lower.includes("imobiliare.ro")) {
              return isForbiddenGraphic(u) ? -10000 : scoreImobiliareImageResolution(u);
            }
            let score = 0;
            if (lower.includes("1200w") || lower.includes("1600w")) score += 200;
            if (lower.includes("1000x700") || lower.includes("1280x") || lower.includes("900w")) score += 100;
            if (lower.includes("/extralarge/")) score += 80;
            if (lower.includes("800x600")) score += 50;
            if (lower.includes("/large/") || lower.includes("/galerie/")) score += 40;
            if (lower.includes("/medium/")) score += 20;
            if (lower.includes("/top/")) score += 10;
            if (lower.includes("/small/") || lower.includes("/thumb/") || lower.includes("140w") || lower.includes("200w") || lower.includes("300w")) {
              score -= 200;
            }
            if (isForbiddenGraphic(u)) score -= 10000;
            return score;
          };

          urls.forEach(u => {
            if (isForbiddenGraphic(u) || blockedAgencyPaths.has(getBaseUrlPath(u))) return;
            const key = getCanonical(u);
            const existing = map.get(key);
            if (!existing || getScore(u) > getScore(existing)) {
              map.set(key, u);
            }
          });

          return Array.from(map.values()).filter(u => !isForbiddenGraphic(u));
        };

        const dedupedImages = deduplicateImages(rawCandidates).slice(0, 100);
        const uniqueImages = await preCleanCrawlImages(dedupedImages, {
          aggressive: isStoriaPage || isOlxPage || isImobiliarePage,
          syncBudgetMs: isStoriaPage || isImobiliarePage ? 45000 : 35000,
        });
        console.log(`Found ${dedupedImages.length} unique images (${uniqueImages.length} pre-checked & cleaned) for ${url}`);

        // Extract seller name explicitly if possible (OLX DOM user-profile-user-name -> Storia/OLX structured -> fallback DOM patterns)
        let sellerName = String(
          (isOlxPage ? olxDomOwner : "") ||
          nextAdData?.owner?.name ||
          nextAdData?.contactDetails?.name ||
          olxAd?.contact?.name ||
          olxAd?.user?.name ||
          olxDomOwner ||
          olxAd?.user?.company_name ||
          ""
        ).trim();

        if (!sellerName) {
          const sellerSelectors = [
            'h4[data-testid="user-profile-user-name"]',
            '[data-testid="user-profile-user-name"]',
            '[data-testid="user-profile-link"] h4',
            '[data-testid="user-info"] h4',
            'div[class*="User-profile"] h4',
            '[data-testid*="user"] h4',
            ".css-1wv6n9s",
            '[data-testid="seller-card-name"]',
            '[data-testid="agent-name"]',
            ".css-1l5shf0"
          ];
          for (const selector of sellerSelectors) {
            const found = $(selector).first().text().trim();
            if (found) {
              sellerName = found;
              break;
            }
          }
        }

        // Final deduplication check for "NameName" patterns
        if (sellerName) {
          const half = Math.floor(sellerName.length / 2);
          const firstHalf = sellerName.substring(0, half);
          const secondHalf = sellerName.substring(half);
          if (firstHalf === secondHalf && half > 1) {
            sellerName = firstHalf;
          }
        }

        // Extract Phone Number explicitly if possible (Storia/OLX structured, revealed DOM, API, and OLX click-to-reveal)
        // OLX Phone Click-to-Reveal Rule:
        // On OLX pages the seller phone sits inside:
        // <button data-cy="ad-contact-phone" data-testid="ad-contact-phone" ...><span class="n-button-text-wrapper"><span>Suna vanzatorul</span></span></button>
        // Because the phone is initially masked as "Suna vanzatorul", we must first click this button
        // so OLX replaces the initial text with the actual phone number, then copy the newly appeared text.
        const isOLX = url.toLowerCase().includes("olx.ro");
        const isOLXOrStoria = isOLX || url.toLowerCase().includes("storia.ro");
        const initialStructuredPhone = String(
          nextAdData?.contact?.phone ||
          nextAdData?.owner?.phones?.[0] ||
          olxAd?.contact?.phone ||
          olxAd?.phoneNumber ||
          ""
        ).trim();
        let sellerPhone =
          extractValidRoPhone(initialStructuredPhone) ||
          (isOLX ? extractPhoneFromOlxHtml(html) : null) ||
          "";
        const numericId: any = nextAdData?.id || olxAd?.id || null;

        if (isOLXOrStoria && numericId && !sellerPhone) {
          const baseOrigin = url.includes("storia.ro") ? "https://www.storia.ro" : "https://www.olx.ro";
          const phoneEndpoints = [
            `${baseOrigin}/api/v1/offers/${numericId}/phones/`,
            `${baseOrigin}/api/v1/offers/${numericId}/limited-phones/`,
          ];
          for (const phonesUrl of phoneEndpoints) {
            try {
              const phoneRes = await safeFetchExternal(phonesUrl, {
                headers: {
                  "User-Agent": userAgents[i % userAgents.length],
                  "Referer": url,
                  "Accept": "application/json",
                },
                timeout: 2500,
                responseType: "json",
              });
              if (phoneRes.status === 200 && phoneRes.data && typeof phoneRes.data === "object") {
                const dataVal = phoneRes.data.data;
                let candidatePhone = "";
                if (dataVal && Array.isArray(dataVal.phones) && dataVal.phones.length > 0) {
                  candidatePhone = String(dataVal.phones[0]).trim();
                } else if (phoneRes.data.value) {
                  candidatePhone = String(phoneRes.data.value).trim();
                } else if (Array.isArray(phoneRes.data) && phoneRes.data.length > 0) {
                  candidatePhone = String(phoneRes.data[0]).trim();
                }
                const validPhone = extractValidRoPhone(candidatePhone);
                if (validPhone) {
                  sellerPhone = validPhone;
                  break;
                }
              }
            } catch (err: any) {
              console.log(`Phone lookup (${phonesUrl}) warning: ${err?.message}`);
            }
          }
        }

        // If this is an OLX page and the phone is still masked ("Suna vanzatorul") or missing,
        // open the page in headless Chromium, click `button[data-cy="ad-contact-phone"]`,
        // wait for the button text to be replaced by the real phone number, and copy the new text.
        if (isOLX && !extractValidRoPhone(sellerPhone)) {
          const scrapeTenantId =
            (req as any)?.tenantContext?.tenantId ||
            (typeof req.headers?.["x-tenant-id"] === "string" ? req.headers["x-tenant-id"] : undefined);
          const revealedByClick = await revealOlxPhoneByClick(url, numericId, {
            timeoutMs: 20000,
            tenantId: scrapeTenantId,
          });
          if (revealedByClick) {
            sellerPhone = revealedByClick;
          }
        }

        // Convert HTML to clean text
        const text = convert(html, {
          wordwrap: 130,
          selectors: [
            { selector: "a", options: { ignoreHref: true } },
            { selector: "img", format: "skip" },
            { selector: "nav", format: "skip" },
            { selector: "footer", format: "skip" },
            { selector: "script", format: "skip" },
            { selector: "style", format: "skip" },
          ],
        });

        // Strict phone extraction fallback (NEVER scan raw HTML or inline <script> tags,
        // which falsely capture tracking pixel IDs like dot.wp.pl/r0776940545 or i18n examples like "0722 123 456").
        if (!extractValidRoPhone(sellerPhone)) {
          if (isOLX) {
            // For OLX.ro: only accept a strictly validated phone explicitly written by the seller
            // in the listing's own description text; otherwise leave empty -> "Nespecificat".
            const olxDescText = typeof olxAd?.description === "string"
              ? olxAd.description.replace(/<[^>]+>/g, " ")
              : "";
            const descPhone = extractPhoneFromVisibleText(olxDescText);
            sellerPhone = descPhone || "";
          } else {
            // For non-OLX sites: check explicit contact DOM elements and clean stripped visible text only.
            const phoneCandidates: string[] = [];

            $("[data-telefon], [data-phone], a[href^='tel:']").each((_, el) => {
              const $el = $(el);
              const href = $el.attr("href");
              if (href && href.startsWith("tel:")) {
                phoneCandidates.push(href.replace("tel:", "").trim());
              }
              const attrTel = $el.attr("data-telefon") || $el.attr("data-phone");
              if (attrTel) {
                phoneCandidates.push(attrTel.trim());
              }
            });

            const validFromAttrs = phoneCandidates
              .map((p) => extractValidRoPhone(p))
              .find((p): p is string => Boolean(p));

            sellerPhone = validFromAttrs || extractPhoneFromVisibleText(text) || "";
          }
        }

        // Normalize characteristics array from Storia
        const storiaChars = Array.isArray(nextAdData?.characteristics) ? nextAdData.characteristics : [];
        const getStoriaChar = (key: string) => storiaChars.find((c: any) => c?.key === key);
        const olxParams = Array.isArray(olxAd?.params) ? olxAd.params : [];
        const getOlxParam = (key: string) => olxParams.find((p: any) => p?.key === key);

        // --- Pure Crawler Extraction of Full Property Data (No AI Needed!) ---
        const urlLower = url.toLowerCase();
        const titleLower = title.toLowerCase();
        const urlTitleLower = `${urlLower} ${titleLower}`;
        const lowerCombo = (url + " " + title + " " + text).toLowerCase();

        // 1. Category extraction (Structured category -> URL + Title -> Description fallback)
        let categoria = "";
        const storiaAdCatName = String(nextAdData?.adCategory?.name || "").toUpperCase();
        if (storiaAdCatName === "FLAT") categoria = "Apartament";
        else if (storiaAdCatName === "HOUSE") categoria = "Casa/Vila";
        else if (storiaAdCatName === "TERRAIN") categoria = "Teren";
        else if (storiaAdCatName === "OFFICE") categoria = "Spatiu Birou";
        else if (storiaAdCatName === "COMMERCIAL_PROPERTY") categoria = "Spatiu Comercial";
        else if (storiaAdCatName === "HALL") categoria = "Spatiu Industrial";

        const olxBreadcrumbText = olxBreadcrumbs.map((b: any) => `${b?.label || ""} ${b?.href || ""}`).join(" ").toLowerCase();
        if (!categoria && olxBreadcrumbText) {
          if (olxBreadcrumbText.includes("apartament") || olxBreadcrumbText.includes("garsoniere")) categoria = "Apartament";
          else if (olxBreadcrumbText.includes("case") || olxBreadcrumbText.includes("vile")) categoria = "Casa/Vila";
          else if (olxBreadcrumbText.includes("teren")) categoria = "Teren";
          else if (olxBreadcrumbText.includes("birouri")) categoria = "Spatiu Birou";
          else if (olxBreadcrumbText.includes("spatii-comerciale") || olxBreadcrumbText.includes("comercial")) categoria = "Spatiu Comercial";
          else if (olxBreadcrumbText.includes("hale") || olxBreadcrumbText.includes("depozit") || olxBreadcrumbText.includes("industrial")) categoria = "Spatiu Industrial";
        }

        if (!categoria) {
          if (urlTitleLower.includes("garsonier") || urlTitleLower.includes("studio") || urlTitleLower.includes("apartament") || /\b\d+\s*camere\b/i.test(urlTitleLower)) {
            categoria = "Apartament";
          } else if (urlTitleLower.includes("casa") || urlTitleLower.includes("vila") || urlTitleLower.includes("duplex")) {
            categoria = "Casa/Vila";
          } else if (urlTitleLower.includes("teren")) {
            categoria = "Teren";
          } else if (urlTitleLower.includes("birou") || urlTitleLower.includes("office")) {
            categoria = "Spatiu Birou";
          } else if (urlTitleLower.includes("comercial") || urlTitleLower.includes("magazin") || urlTitleLower.includes("spatiu comercial")) {
            categoria = "Spatiu Comercial";
          } else if (urlTitleLower.includes("industrial") || urlTitleLower.includes("hala") || urlTitleLower.includes("depozit")) {
            categoria = "Spatiu Industrial";
          } else if (lowerCombo.includes("garsonier") || lowerCombo.includes("studio") || lowerCombo.includes("apartament")) {
            categoria = "Apartament";
          } else if (lowerCombo.includes("casa") || lowerCombo.includes("vila") || lowerCombo.includes("duplex")) {
            categoria = "Casa/Vila";
          } else if (lowerCombo.includes("teren")) {
            categoria = "Teren";
          } else {
            categoria = "Apartament";
          }
        }

        // 2. Price & Currency extraction
        let rawPriceNum = 0;
        let currency = "EUR";

        // 2a. Storia characteristics price
        const storiaPriceChar = getStoriaChar("price");
        if (storiaPriceChar?.value) {
          const parsedVal = parseFloat(String(storiaPriceChar.value).replace(/[^\d.]/g, ""));
          if (!isNaN(parsedVal) && parsedVal > 0) {
            rawPriceNum = parsedVal;
            const cSym = String(storiaPriceChar.currency || "EUR").toUpperCase();
            if (cSym.includes("RON") || cSym.includes("LEI")) currency = "RON";
          }
        }

        // 2b. OLX DOM ad-price-container h3 (preferred) -> OLX ad.price fallback
        const olxDomPrice = extractOlxDomPrice($);
        if (rawPriceNum <= 0 && olxDomPrice) {
          const parsedDomPrice = parseDomPriceString(olxDomPrice);
          if (parsedDomPrice.value > 0) {
            rawPriceNum = parsedDomPrice.value;
            currency = parsedDomPrice.currency;
          }
        }
        if (rawPriceNum <= 0 && olxAd?.price) {
          const disp = String(olxAd.price.displayValue || "");
          const regVal = Number(olxAd.price.regularPrice?.value || 0);
          const regCurr = String(olxAd.price.regularPrice?.currencyCode || olxAd.price.regularPrice?.currencySymbol || "").toUpperCase();
          if (regVal > 0) {
            rawPriceNum = regVal;
            if (regCurr.includes("RON") || regCurr.includes("LEI")) currency = "RON";
          } else if (disp) {
            const parsedDisp = parseDomPriceString(disp);
            if (parsedDisp.value > 0) {
              rawPriceNum = parsedDisp.value;
              currency = parsedDisp.currency;
            }
          }
        }

        // 2c. Generic NEXT_DATA price object (only if it has an actual numeric value)
        if (rawPriceNum <= 0) {
          const nextPriceObj = nextAdData?.price || nextAdData?.regularPrice || nextAdData?.ad?.price || nextAdData?.advert?.price;
          if (typeof nextPriceObj === "number" && nextPriceObj > 0) {
            rawPriceNum = nextPriceObj;
          } else if (nextPriceObj && (nextPriceObj.value || nextPriceObj.regularPrice?.value)) {
            const candidate = Number(nextPriceObj.value || nextPriceObj.regularPrice?.value);
            if (!isNaN(candidate) && candidate > 0) {
              rawPriceNum = candidate;
              const currSym = String(nextPriceObj.currencySymbol || nextPriceObj.regularPrice?.currencySymbol || "").toUpperCase();
              if (currSym.includes("LEI") || currSym.includes("RON")) currency = "RON";
            }
          }
        }

        // 2d. JSON-LD price
        if (rawPriceNum <= 0 && (jsonLdData?.offers?.price || jsonLdData?.price)) {
          const candidate = Number(jsonLdData.offers?.price || jsonLdData.price);
          if (!isNaN(candidate) && candidate > 0) {
            rawPriceNum = candidate;
            const curr = String(jsonLdData.offers?.priceCurrency || jsonLdData.priceCurrency || "").toUpperCase();
            if (curr.includes("LEI") || curr.includes("RON")) currency = "RON";
          }
        }

        // 2e. DOM / Text regex fallback
        if (rawPriceNum <= 0) {
          let domPriceText = "";
          const priceSelectors = [
            'strong[data-cy="adPageHeaderPrice"]',
            '[data-sentry-element="Price"]',
            '[data-testid="ad-price-container"]',
            '[data-testid="ad-price"]',
            '[data-cy="ad-price"]',
            '.price',
            '.offer-price',
            '[class*="price"]',
            '[class*="pret"]'
          ];
          for (const sel of priceSelectors) {
            const found = $(sel).first().text().trim();
            if (found && /\d/.test(found)) {
              domPriceText = found;
              break;
            }
          }

          const searchStr = domPriceText || title + " " + text;
          const priceRegex = /(?:pre[t\u021b]|chirie|\b)\s*[:\-–]?\s*(€|eur|euro|ron|lei)?\s*(\d[\d\s.,]{1,9})\s*(€|eur|euro|ron|lei)?\b/i;
          const pMatch = searchStr.match(priceRegex) || title.match(/(\d[\d\s.,]{1,9})\s*(€|eur|euro|ron|lei)?\b/i);
          if (pMatch) {
            const numStr = pMatch[2] || pMatch[1] || "";
            rawPriceNum = parseInt(numStr.replace(/[^0-9]/g, ""), 10) || 0;
            const currStr = (pMatch[1] || pMatch[3] || searchStr || "").toLowerCase();
            if (currStr.includes("ron") || currStr.includes("lei")) {
              currency = "RON";
            }
          }
        }

        // Transform price to EUR if it was in RON or Lei
        const isRon = currency === "RON" || currency === "LEI";
        const priceInEur = isRon ? Math.round(rawPriceNum / 4.97) : rawPriceNum;
        rawPriceNum = priceInEur;
        currency = "€";

        // 3. Robust Transaction Type Detection (Rent vs Sale)
        const hasPerMonth = /\b(?:pe\s*lun[aă]|\/\s*lun[aă]|\/\s*month|per\s*month|lunar[aă]?)\b/i.test(title + " " + text);
        const urlHasRent = /\b(?:de-inchiriat|inchiriere|inchirieri|inchiriat|chirie|rent)\b/i.test(urlLower);
        const urlHasSale = /\b(?:de-vanzare|vanzare|vanzari|cumparare|sale)\b/i.test(urlLower);
        const titleHasRent = /\b(?:de\s+[îi]nchiriat|spre\s+[îi]nchiriere|ofer\s+spre\s+[îi]nchiriere|[îi]nchiriez|chirie|for\s+rent)\b/i.test(titleLower);
        const titleHasSale = /\b(?:de\s+v[aâ]nzare|spre\s+v[aâ]nzare|v[aâ]nd|v[aâ]nzare|for\s+sale)\b/i.test(titleLower);

        const storiaAdCatType = String(nextAdData?.adCategory?.type || "").toUpperCase();
        const structuredCat = String(nextAdData?.category?.name || "").toLowerCase() + " " + olxBreadcrumbText;
        const structuredTarget = String(nextAdData?.target?.transaction_type || nextAdData?.target?.action || "").toLowerCase();
        const structuredIsRent = storiaAdCatType === "RENT" || structuredCat.includes("inchiri") || structuredTarget.includes("rent");
        const structuredIsSale = storiaAdCatType === "SELL" || structuredCat.includes("vanza") || structuredTarget.includes("sell") || structuredTarget.includes("sale");

        let isRent = false;

        if (priceInEur >= 20000) {
          if (urlHasRent && hasPerMonth && (categoria === "Spatiu Birou" || categoria === "Spatiu Comercial" || categoria === "Spatiu Industrial")) {
            isRent = true;
          } else {
            isRent = false;
          }
        } else if (priceInEur > 0 && priceInEur <= 10000) {
          if ((categoria === "Teren" || lowerCombo.includes("garaj") || lowerCombo.includes("parcare")) && (urlHasSale || titleHasSale || structuredIsSale)) {
            isRent = false;
          } else {
            isRent = true;
          }
        } else if (priceInEur > 10000 && priceInEur < 20000) {
          isRent = urlHasRent || titleHasRent || structuredIsRent || hasPerMonth;
        } else {
          if (urlHasRent || titleHasRent || structuredIsRent || hasPerMonth) {
            isRent = true;
          } else if (urlHasSale || titleHasSale || structuredIsSale) {
            isRent = false;
          } else {
            const rentMentions = (lowerCombo.match(/\b(?:[îi]nchiriere|chirie|garan[t\u021b]ie|depozit)\b/g) || []).length;
            const saleMentions = (lowerCombo.match(/\b(?:v[aâ]nzare|credit\s+ipotecar|noua\s+cas[aă]|cadastru)\b/g) || []).length;
            isRent = rentMentions > saleMentions;
          }
        }

        const transactionType = isRent ? "Închiriere" : "Vânzare";
        console.log(`[Crawler Transaction Detection] Price: ${priceInEur} EUR -> Type: ${transactionType} (URL Rent: ${urlHasRent}, Title Rent: ${titleHasRent})`);

        const formattedPrice = rawPriceNum > 0
          ? `${rawPriceNum.toLocaleString("ro-RO")} €${transactionType === "Închiriere" ? " / lună" : ""}`
          : "N/A";

        // 4. Original Description FIRST (strictly scoped to the ad itself — never full HTML chrome / similar ads)
        let rawDescription = "";
        const olxDomDesc = extractOlxDomDescription($);
        if (isOlxPage && olxDomDesc) {
          rawDescription = olxDomDesc;
        } else if (nextAdData?.description) {
          rawDescription = convert(nextAdData.description, { wordwrap: false });
        } else if (olxAd?.description) {
          rawDescription = cleanHtmlDescriptionPreservingLines(String(olxAd.description));
        } else if (olxDomDesc) {
          rawDescription = olxDomDesc;
        } else {
          const descSelectors = [
            'div.text-background-action-primary.whitespace-pre-line',
            'div[class*="text-background-action-primary"][class*="whitespace-pre-line"]',
            '[data-cy="ad_description"]',
            '[data-testid="description-section"]',
            '.offer-description',
            '#descriere',
            '.descriptioncontent',
            '.ad-description'
          ];
          for (const sel of descSelectors) {
            const htmlDesc = $(sel).html();
            if (htmlDesc) {
              rawDescription = convert(htmlDesc, { wordwrap: false });
              break;
            }
          }
          if (!rawDescription) {
            rawDescription = ogDescription || "";
          }
        }

        const adOnlyText = [title, rawDescription].filter(Boolean).join("\n");
        const adOnlyLower = adOnlyText.toLowerCase();

        // 5. City & Zone (strictly from structured ad metadata + original ad title/description, NEVER full-page HTML)
        let oras = "București";
        let rawStructuredZone = "";

        if (nextAdData?.location?.city?.name) oras = nextAdData.location.city.name;
        if (nextAdData?.location?.district?.name) rawStructuredZone = nextAdData.location.district.name;

        const storiaLocations = Array.isArray(nextAdData?.location?.reverseGeocoding?.locations)
          ? nextAdData.location.reverseGeocoding.locations
          : [];
        for (const loc of storiaLocations) {
          if (loc?.locationLevel === "city" && loc?.name) oras = loc.name;
          if ((loc?.locationLevel === "district" || loc?.locationLevel === "quarter" || loc?.locationLevel === "subdistrict") && loc?.name) {
            rawStructuredZone = loc.name;
          }
        }

        if (olxAd?.location?.cityName) oras = olxAd.location.cityName;
        if (olxAd?.location?.districtName) rawStructuredZone = olxAd.location.districtName;

        const verifiedNeighborhoodZone = resolveAreaFromAd({
          rawZone: rawStructuredZone,
          city: oras,
          title,
          description: rawDescription,
          url,
          fallbackToCity: false,
        });
        const zona = verifiedNeighborhoodZone || oras || "";

        // 6. Specs (Surface, Rooms, Floor, Heating, Furnished) — strictly from structured params or adOnlyText
        let suprafataUtila = "";
        let camere = "";
        let etaj = "";
        let anConstructie = "";
        let compartimentare = "";
        let sistemIncalzire: string[] = [];
        let climatizare: string[] = [];
        let mobilat = "";

        // 6a. Storia characteristics
        if (storiaChars.length > 0) {
          const chM = getStoriaChar("m");
          const chRooms = getStoriaChar("rooms_num");
          const chFloor = getStoriaChar("floor_no");
          const chYear = getStoriaChar("build_year");
          const chHeat = getStoriaChar("heating");
          if (chM?.value) suprafataUtila = String(chM.value).replace(/[^\d.,]/g, "").replace(",", ".");
          if (chRooms?.value) camere = String(chRooms.value).replace(/[^\d]/g, "");
          if (chFloor?.localizedValue || chFloor?.value) {
            const fv = String(chFloor.localizedValue || chFloor.value);
            etaj = fv.replace(/^floor_/i, "").replace(/^ground_floor$/i, "Parter");
          }
          if (chYear?.value) anConstructie = String(chYear.value).replace(/[^\d]/g, "");
          if (chHeat?.localizedValue || chHeat?.value) {
            const hv = String(chHeat.localizedValue || chHeat.value).toLowerCase();
            if (hv.includes("urban") || hv.includes("termoficare")) sistemIncalzire = ["Termoficare"];
            else if (hv.includes("bloc") || hv.includes("imobil")) sistemIncalzire = ["Centrala imobil"];
            else if (hv.includes("proprie") || hv.includes("central")) sistemIncalzire = ["Centrala proprie"];
          }
        }

        // 6b. OLX DOM parameters container (div[data-testid="ad-parameters-container"])
        if (olxDomParams.hasContainer) {
          if (!suprafataUtila && olxDomParams.suprafataUtila) suprafataUtila = olxDomParams.suprafataUtila;
          if (!anConstructie && olxDomParams.anConstructie) anConstructie = olxDomParams.anConstructie;
          if (!etaj && olxDomParams.etaj) etaj = olxDomParams.etaj;
          if (olxDomParams.compartimentare) compartimentare = olxDomParams.compartimentare;
          if (!camere && olxDomParams.camere) camere = olxDomParams.camere;
        }

        // 6c. OLX structured params fallback
        if (olxParams.length > 0) {
          const pm = getOlxParam("m");
          const pr = getOlxParam("rooms");
          const pf = getOlxParam("floor") || getOlxParam("floor_select");
          const py = getOlxParam("constructie");
          const pc = getOlxParam("compartimentare");
          const pfu = getOlxParam("furnishing");
          if (!suprafataUtila && pm?.value) suprafataUtila = String(pm.value).replace(/[^\d.,]/g, "").replace(",", ".");
          if (!camere && pr?.value) {
            const rv = String(pr.value).toLowerCase();
            if (rv.includes("garsonier")) camere = "1";
            else camere = rv.replace(/[^\d]/g, "") || camere;
          }
          if (!etaj && pf?.value) {
            const fv = String(pf.value).replace(/^etaj_/i, "").trim();
            etaj = /^\d+$/.test(fv) ? `Etaj ${fv}` : fv;
          }
          if (!anConstructie && py?.value) {
            const rawYearVal = String(py.value).trim();
            if (/1977|1990|2000/.test(rawYearVal)) {
              anConstructie = rawYearVal;
            } else {
              const ym = rawYearVal.match(/\d{4}/);
              if (ym) anConstructie = ym[0];
            }
          }
          if (pc?.value) {
            const cv = String(pc.value).toLowerCase();
            if (cv.includes("semidecomandat")) compartimentare = "Semidecomandat";
            else if (cv.includes("nedecomandat")) compartimentare = "Nedecomandat";
            else if (cv.includes("circular")) compartimentare = "Circular";
            else if (cv.includes("decomandat")) compartimentare = "Decomandat";
          }
          if (pfu?.value) {
            const fv = String(pfu.value).toLowerCase();
            if (fv.includes("nemobilat")) mobilat = "Nemobilat";
            else if (fv.includes("partial")) mobilat = "Partial";
            else if (fv.includes("mobilat")) mobilat = "Complet";
          }
        }

        if (Array.isArray(nextAdData?.parameters)) {
          for (const p of nextAdData.parameters) {
            if (!suprafataUtila && p.key === "m") suprafataUtila = String(p.value || "");
            if (!camere && p.key === "rooms_num") camere = String(p.value || "");
            if (!etaj && p.key === "floor_select") etaj = String(p.value || "");
            if (!anConstructie && p.key === "build_year") anConstructie = String(p.value || "");
            if (!mobilat && p.key === "furniture" && p.value) mobilat = String(p.value);
          }
        }

        if (!suprafataUtila) {
          const sMatch = adOnlyText.match(/(?:suprafa[t\u021b\u0163]?[a\u0103]?\s*util[a\u0103]?|s\s*util[a\u0103]?|utila)\s*[:\-–]?\s*(\d+(?:[.,]\d+)?)\s*(?:mp|m2|m\u00b2)/i);
          if (sMatch) suprafataUtila = sMatch[1].replace(",", ".");
        }
        if (!camere) {
          const cMatch = adOnlyText.match(/(?:num[a\u0103]r\s*camere|nr\.?\s*camere)\s*[:\-–]?\s*(\d+)/i) || adOnlyText.match(/\b(\d+)\s*camere\b/i);
          if (cMatch) camere = cMatch[1];
          else if (adOnlyLower.includes("garsonier") || adOnlyLower.includes("studio")) camere = "1";
        }
        if (!etaj) {
          const eMatch = adOnlyText.match(/(?:etaj|etajul)\s*[:\-–]?\s*(parter|demisol|mansarda|\d+\/\d+|\d+)/i);
          if (eMatch) etaj = eMatch[1];
        }
        if (!anConstructie) {
          const aMatch = adOnlyText.match(/(?:an\s*construc[t\u021b]ie|construit\s*[îi]n|an\s*bloc)\s*[:\-–]?\s*(\d{4})/i);
          if (aMatch) anConstructie = aMatch[1];
        }

        let balcoane = "";
        if (Array.isArray(nextAdData?.parameters)) {
          for (const p of nextAdData.parameters) {
            if (p.key === "balconies_num" || p.key === "balcony" || p.key === "balcoane") balcoane = String(p.value || "");
          }
        }
        if (!balcoane) {
          const bMatch = adOnlyText.match(/(\d+)\s*balco?ane?/i);
          if (bMatch) balcoane = bMatch[1];
        }

        const parsedUtila = parseFloat(suprafataUtila);
        const mult = (categoria === "Apartament" || categoria === "Casa/Vila") ? 1.2 : 1.1;
        const suprafataConstruita = Number.isFinite(parsedUtila) && parsedUtila > 0
          ? Math.round(parsedUtila * mult).toString()
          : "";

        if (sistemIncalzire.length === 0) {
          if (adOnlyLower.includes("centrala proprie") || adOnlyLower.includes("centrală proprie")) {
            sistemIncalzire = ["Centrala proprie"];
          } else if (adOnlyLower.includes("centrala de bloc") || adOnlyLower.includes("centrală de bloc") || adOnlyLower.includes("centrala imobil") || adOnlyLower.includes("centrală imobil")) {
            sistemIncalzire = ["Centrala imobil"];
          } else if (adOnlyLower.includes("termoficare") || adOnlyLower.includes("centralizat") || adOnlyLower.includes("radet")) {
            sistemIncalzire = ["Termoficare"];
          }
        }

        if (adOnlyLower.includes("aer conditionat") || adOnlyLower.includes("aer condiționat") || adOnlyLower.includes("climatizare")) {
          climatizare = ["Aer conditionat"];
        }

        if (!compartimentare) {
          if (adOnlyLower.includes("semidecomandat")) compartimentare = "Semidecomandat";
          else if (adOnlyLower.includes("open space") || adOnlyLower.includes("openspace")) compartimentare = "Open space";
          else if (adOnlyLower.includes("circular")) compartimentare = "Circular";
          else if (adOnlyLower.includes("nedecomandat")) compartimentare = "Nedecomandat";
          else if (adOnlyLower.includes("decomandat")) compartimentare = "Decomandat";
        }

        if (!mobilat) {
          if (adOnlyLower.includes("nemobilat")) mobilat = "Nemobilat";
          else if (adOnlyLower.includes("partial mobilat") || adOnlyLower.includes("parțial mobilat")) mobilat = "Partial";
          else if (adOnlyLower.includes("complet mobilat") || adOnlyLower.includes("mobilat complet") || adOnlyLower.includes("mobilat si utilat") || adOnlyLower.includes("mobilat și utilat")) mobilat = "Complet";
        }

        // Preserve strictly verified automationSource so Title & Description rules use ONLY
        // real information from the original ad (never full-page chrome or fabricated defaults).
        const automationSource = {
          transactionType,
          categoria,
          camere,
          suprafataUtila,
          suprafataConstruita,
          etaj,
          zona: verifiedNeighborhoodZone,
          oras,
          compartimentare,
          sistemIncalzire: Array.isArray(sistemIncalzire) ? sistemIncalzire.join(", ") : sistemIncalzire,
          mobilat,
          balcoane,
          rawTitle: title,
          rawText: rawDescription,
        };
        const originalTitle = title;
        const originalDescription = rawDescription;

        // 7. Full baseline CRM Data object - all photos start in 'alteSpatii' for manual slot moving!
        const crmData = {
          detaliiGenerale: {
            stadiu: "Activ - Hot",
            tranzactie: transactionType,
            categoria: categoria,
            proprietar: sellerName || "Nespecificat",
            contacteAditionale: sellerPhone || "Nespecificat",
            ansambluRezidential: "",
            localizare: {
              oras: oras,
              zona: verifiedNeighborhoodZone ? [verifiedNeighborhoodZone] : (zona ? [zona] : []),
              strada: "",
              numar: "",
              bloc: "",
              scara: "",
              apartament: "",
              puncteInteres: [],
              imprejurimi: []
            },
            memoPrivat: ""
          },
          caracteristici: {
            detalii: {
              tipCasa: "",
              tipApartament: categoria === "Apartament" ? "Standard" : "",
              compartimentare: compartimentare,
              confort: "1",
              destinatie: "Rezidential",
              camere: String(camere || ""),
              bucatarii: "1",
              dormitoare: camere ? String(Math.max(1, parseInt(camere, 10) - 1 || 1)) : "",
              bai: "1",
              balcoane: balcoane || "0",
              terase: "0",
              etaj: String(etaj || ""),
              orientare: "",
              parcari: "0",
              garaje: "0",
              checkList: []
            },
            suprafete: {
              utila: String(suprafataUtila || ""),
              amprenta: "",
              construita: suprafataConstruita,
              utilaTotala: String(suprafataUtila || ""),
              balcoane: "0",
              terase: "0",
              gradina: "0",
              teren: "0",
              terenLiber: "0",
              frontStradal: "",
              vitrina: "",
              numarFronturi: "",
              numarTerase: "0",
              numarBalcoane: "0"
            },
            alteDetalii: {
              stadiuConstructie: "Finalizata",
              structura: "Beton",
              tipImobil: categoria === "Casa/Vila" ? "Casa/Vila" : "Bloc",
              riscSeismic: "",
              anConstructie: String(anConstructie || ""),
              anRenovare: "",
              inaltime: ""
            },
            energetica: {
              clasa: "",
              consumAnual: "",
              emisiiCO2: "",
              consumRegenerabile: ""
            }
          },
          utilitati: {
            general: ["Curent", "Apa", "Canalizare", "Gaz"],
            sistemIncalzire: sistemIncalzire,
            climatizare: climatizare,
            finisaje: {
              stare: ["Buna"],
              izolatii: ["Exterior"],
              pereti: ["Vopsea lavabila", "Faianta"],
              podele: ["Parchet", "Gresie"],
              ferestre: ["PVC"],
              jaluzele: [],
              rulouri: [],
              usaIntrare: ["Metal"],
              usiInterior: ["Lemn"],
              acoperis: []
            },
            dotari: {
              mobilat: mobilat,
              spatiiAditionale: [],
              bucatarie: ["Mobilata", "Utilata"],
              contorizare: ["Apometre", "Contor curent electric", "Contor gaz"],
              electrocasnice: ["Frigider", "Masina de spalat rufe", "Aragaz"],
              imobil: ["Interfon"],
              diverse: [],
              servicii: [],
              amenajareStrazi: ["Asfaltate", "Iluminat stradal"],
              priveliste: ["Spre oras"]
            }
          },
          pret: {
            detalii: {
              pret: formattedPrice,
              moneda: currency,
              pretMp: "",
              ultimPret: "",
              checkList: [],
              plataAcceptata: "Cash sau Credit",
              pretGaraj: "",
              pretParcare: "",
              avans: transactionType === "Închiriere" ? "1 lună avans" : "",
              garantie: transactionType === "Închiriere" ? "1 lună garanție" : "",
              tvaIncluded: false,
              notePrivate: ""
            },
            comisioane: {
              comisionCumparatorProcent: transactionType === "Închiriere" ? "50%" : "",
              comisionCumparatorValoare: transactionType === "Închiriere" ? "50%+TVA" : "",
              comisionProprietarProcent: transactionType === "Închiriere" ? "50%" : "",
              comisionProprietarValoare: transactionType === "Închiriere" ? "50%+TVA" : "",
              colaborare: false
            },
            contract: {
              tip: "Intermediere",
              semnat: "Nu",
              nr: "",
              dataSemnare: "",
              dataExpirare: ""
            }
          },
          descriere: {
            titlu: originalTitle,
            continut: originalDescription,
            disponibilitate: "Imediat",
            video: "",
            turVirtual: ""
          },
          imagini: {
            living: [],
            bucatarie: [],
            camera: [],
            baie: [],
            alteSpatii: uniqueImages.map(img => ({ original: img }))
          }
        };

        const defaultCommission = transactionType === "Închiriere" ? "50%+TVA" : "";

        // Summary: includes all configurare section data and area, easy to read, <= 512 chars
        const summaryCamere = camere && camere !== "-" ? `${camere} camere` : "";
        const summarySuprafata = suprafataUtila ? `${suprafataUtila} mp utili` : "";
        const summaryComp = compartimentare || "decomandat";
        const summaryEtaj = etaj ? (etaj.toLowerCase().startsWith("etaj") || etaj.toLowerCase() === "parter" || etaj.toLowerCase() === "demisol" ? `la ${etaj.toLowerCase()}` : `la etajul ${etaj}`) : "";
        const summaryAn = anConstructie ? `într-un bloc din ${anConstructie}` : "";
        const summarySpecs = [summaryCamere, summarySuprafata].filter(Boolean).join(", ") || "spațiu generos";
        let summaryText = `Proprietate cu ${summarySpecs}, compartimentată ${summaryComp.toLowerCase()}${summaryEtaj ? `, situată ${summaryEtaj}` : ""}${summaryAn ? ` ${summaryAn}` : ""}, în stare bună, poziționată în zona ${zona || oras}, cu acces facil la mijloace de transport și facilități urbane.`.trim();
        if (summaryText.length > 512) {
          summaryText = summaryText.substring(0, 508).replace(/\s+[^\s]*$/, "") + "...";
        }

        const presentationSections = {
          introducere: {
            summary: summaryText
          },
          configuratie: {
            "Suprafață utilă": suprafataUtila || "-",
            "Compartimentare": compartimentare || "Decomandat",
            "Etaj": etaj || "-",
            "An construcție": anConstructie || "-",
            "Număr camere": camere ? String(camere) : "-",
            "Număr băi": "1",
            "Balcoane": balcoane || "-",
            "Stare": "Buna"
          },
          finisaje: {
            "Living": "vopsea lavabilă, parchet",
            "Camera 1": "vopsea lavabilă, parchet",
            "Camera 2": "vopsea lavabilă, parchet",
            "Camera 3": "vopsea lavabilă, parchet",
            "Camera 4": "vopsea lavabilă, parchet",
            "Bucătărie": "vopsea lavabilă, faianță și gresie",
            "Baie 1": "faianță și gresie",
            "Baie 2": "faianță și gresie",
            "Baie 3": "faianță și gresie",
            "Baie 4": "faianță și gresie",
            "Hol": "vopsea lavabilă, parchet"
          },
          mobilare: {
            "Living": "canapea, măsuță cafea, comodă",
            "Camera 1": "pat, noptiere, dulap",
            "Camera 2": "pat, noptiere, dulap",
            "Camera 3": "pat, noptiere, dulap",
            "Camera 4": "pat, noptiere, dulap",
            "Bucătărie": "mobilă de bucatarie premium",
            "Baie 1": "obiecte sanitare premium",
            "Baie 2": "obiecte sanitare premium",
            "Baie 3": "obiecte sanitare premium",
            "Baie 4": "obiecte sanitare premium",
            "Hol": "cuier, pantofar"
          },
          dotari: {
            "Living": "aer condiționat, smart TV",
            "Camera 1": "-",
            "Camera 2": "-",
            "Camera 3": "-",
            "Camera 4": "-",
            "Bucătărie": "frigider, plită, cuptor, hotă",
            "Baie 1": "-",
            "Baie 2": "-",
            "Hol": "interfon",
            "Altele": "-"
          },
          bloc: {
            "Acces": "Tag magnetic, interfon",
            "Spații": "-",
            "Dotări": "Lift, supraveghere video",
            "Servicii": "Administrație, curățenie spații comune"
          },
          imprejurimi: {
            "Educație": "Grădinițe de stat și private, școli gimnaziale, licee în apropiere",
            "Comerț": "Numeroase magazine de proximitate.",
            "Benzinării": "Multiple statii de alimentare.",
            "Sănătate": "Diverse farmacii.",
            "Relaxare": "Spatii verzi in apropiere.",
            "Divertisment": "Restaurante, baruri si cafenele in zona.",
            "Obiective": "Diverse puncte de atracie din sector."
          },
          transport: {
            "Metrou": "Stație de metrou în proximitate",
            "Tramvai": "Linii tramvai în zonă",
            "Troleibuz": "Linii troleibuz în apropiere",
            "Autobuz": "Multiple linii STB în apropiere"
          },
          parcare: {
            "Parcare": "Publica in zona"
          },
          acte: transactionType === "Închiriere" ? {
            "Condiții contractuale": "12 luni",
            "Avans": "1 luna",
            "Garanție": "1 luna"
          } : {
            "Situație juridică": "Fara probleme",
            "Disponibilitate": "Imediată",
            "Finanțare": "Credit bancar / fonduri proprii"
          },
          tranzactie: {
            "Preț": formattedPrice,
            "TVA": "Scutit de TVA / conform legislației în vigoare",
            "Comision": defaultCommission || "-"
          }
        };

        const listingDetails = extractListingDetails(html, url);
        let finalPrice = (formattedPrice && formattedPrice !== "N/A") ? formattedPrice : (listingDetails.price || "N/A");
        if (finalPrice && finalPrice !== "N/A") {
          const fpLower = finalPrice.toLowerCase();
          if (fpLower.includes("ron") || fpLower.includes("lei")) {
            const digits = parseFloat(finalPrice.replace(/[^0-9.,]/g, "").replace(",", "."));
            if (!isNaN(digits) && digits > 0) {
              const inEur = Math.round(digits / 4.97);
              const hasLuna = /\/(?:lun[aă]|luni|month)\b/i.test(finalPrice) || transactionType === "Închiriere";
              finalPrice = `${inEur.toLocaleString("ro-RO")} €${hasLuna ? " / lună" : ""}`;
            }
          }
        }
        crmData.pret.detalii.pret = finalPrice;
        crmData.pret.detalii.moneda = "€";
        presentationSections.tranzactie["Preț"] = finalPrice;
        const finalPhone =
          (sellerPhone && sellerPhone !== "Nespecificat" ? sellerPhone : null) ||
          extractValidRoPhone(listingDetails.phone_number) ||
          "Nespecificat";
        if (finalPhone !== "Nespecificat" && crmData?.detaliiGenerale) {
          crmData.detaliiGenerale.contacteAditionale = finalPhone;
        }
        const finalOwner = (sellerName && sellerName !== "Nespecificat") ? sellerName : (listingDetails.owner_name || "Nespecificat");

        const publishedAtIso =
          olxDomPostedAt.isoDate ||
          olxAd?.createdTime ||
          olxAd?.lastRefreshTime ||
          null;
        const publishedAtLabel = olxDomPostedAt.cleanLabel || "";

        res.json({
          title: originalTitle,
          originalTitle: originalTitle,
          price: finalPrice,
          zone: zona,
          oras: oras,
          ownerName: finalOwner,
          ownerPhone: finalPhone,
          transactionType: transactionType,
          categoria: categoria,
          description: originalDescription,
          publishedAt: publishedAtIso,
          publishedAtLabel: publishedAtLabel,
          sellerType: olxDomParams.sellerType || (isOlxPage ? "Persoana fizica" : ""),
          specs: {
            utila: suprafataUtila || "",
            construita: suprafataConstruita,
            camere: camere,
            etaj: etaj,
            an: anConstructie,
            compartimentare: compartimentare,
            sistemIncalzire: sistemIncalzire,
            mobilat: mobilat
          },
          images: uniqueImages.map((u: string) =>
            u.startsWith("http") && !u.includes("/api/proxy-image")
              ? `/api/proxy-image?url=${encodeURIComponent(u)}`
              : u
          ),
          coverImage: uniqueImages.length > 0
            ? (uniqueImages[0].startsWith("http") && !uniqueImages[0].includes("/api/proxy-image")
                ? `/api/proxy-image?url=${encodeURIComponent(uniqueImages[0])}`
                : uniqueImages[0])
            : null,
          crmData: crmData,
          presentationSections: presentationSections,
          automationSource: automationSource,
          text: text.substring(0, 8000)
        });
        return; // Success!
      } catch (error: any) {
        logger.warn(`Crawl attempt ${i + 1} failed: ${error?.message || "Unknown error"}`, {
          module: "crawler",
          meta: { attempt: i + 1 },
        });
        lastError = error;
      }
    }

    const upstreamMessage =
      lastUpstreamStatus === 403 || lastUpstreamStatus === 429 || lastUpstreamStatus === 503
        ? `Site-ul extern a blocat accesul automat (HTTP ${lastUpstreamStatus} — protecție anti-bot). Verificați link-ul sau reîncercați.`
        : lastUpstreamStatus && lastUpstreamStatus >= 400
        ? `Anunțul nu a putut fi accesat pe site-ul extern (HTTP ${lastUpstreamStatus}).`
        : `Nu s-a putut accesa URL-ul extern: ${lastError?.message || "Eroare de conexiune"}`;

    res.status(422).json({
      error: upstreamMessage,
      code: lastUpstreamStatus ? "UPSTREAM_ACCESS_BLOCKED" : "UPSTREAM_CONNECTION_ERROR",
      upstreamStatus: lastUpstreamStatus,
      details: lastError?.response?.data && typeof lastError.response.data === "string" ? lastError.response.data.substring(0, 500) : null
    });
  });

  // Batch discover & crawl newest listings from OLX.ro (Super Admin only)
  app.post("/api/crawl-olx-leads", mwAuthentication, mwPlatformAuthorization, crawlRouteLimiter, async (req, res) => {
    try {
      const rawFilters = req.body?.filters && typeof req.body.filters === "object" ? req.body.filters : {};
      const filters: OlxLeadFilters = {
        searchText: typeof rawFilters.searchText === "string" ? rawFilters.searchText : DEFAULT_OLX_LEAD_FILTERS.searchText,
        transactionType:
          rawFilters.transactionType === "Vânzare" || rawFilters.transactionType === "Închiriere"
            ? rawFilters.transactionType
            : "",
        categories: Array.isArray(rawFilters.categories) ? rawFilters.categories.map(String) : [],
        rooms: Array.isArray(rawFilters.rooms) ? rawFilters.rooms.map(String) : [],
        compartimentare: Array.isArray(rawFilters.compartimentare) ? rawFilters.compartimentare.map(String) : [],
        priceMin: typeof rawFilters.priceMin === "string" || typeof rawFilters.priceMin === "number" ? String(rawFilters.priceMin) : "",
        priceMax: typeof rawFilters.priceMax === "string" || typeof rawFilters.priceMax === "number" ? String(rawFilters.priceMax) : "",
        surfaceMin: typeof rawFilters.surfaceMin === "string" || typeof rawFilters.surfaceMin === "number" ? String(rawFilters.surfaceMin) : "",
        surfaceMax: typeof rawFilters.surfaceMax === "string" || typeof rawFilters.surfaceMax === "number" ? String(rawFilters.surfaceMax) : "",
        constructie: Array.isArray(rawFilters.constructie) ? rawFilters.constructie.map(String) : [],
        floors: Array.isArray(rawFilters.floors) ? rawFilters.floors.map(String) : [],
        zones: Array.isArray(rawFilters.zones) ? rawFilters.zones.map(String) : [],
      };

      const startPage = Math.max(1, Math.min(20, parseInt(String(req.body?.page || 1), 10) || 1));
      const limit = Math.max(1, Math.min(48, parseInt(String(req.body?.limit || 10), 10) || 10));
      const rawMinAgeHours = Number(req.body?.minAgeHours);
      const minAgeHours =
        Number.isFinite(rawMinAgeHours) && rawMinAgeHours > 0
          ? Math.min(8760, Math.max(0, rawMinAgeHours))
          : 0;
      const rawMaxAgeHours = Number(req.body?.maxAgeHours);
      const maxAgeHours =
        Number.isFinite(rawMaxAgeHours) && rawMaxAgeHours > 0
          ? Math.min(8760, Math.max(1, rawMaxAgeHours))
          : null;
      const nowMs = Date.now();
      const cutoffOldestMs = maxAgeHours ? nowMs - maxAgeHours * 3600 * 1000 : null;
      const cutoffNewestMs = minAgeHours > 0 ? nowMs - minAgeHours * 3600 * 1000 : null;
      const existingUrlsRaw: string[] = Array.isArray(req.body?.existingUrls) ? req.body.existingUrls.map(String) : [];

      const normalizeAdUrl = (u: string): string => {
        try {
          const parsed = new URL(u.trim());
          return `${parsed.origin}${parsed.pathname}`.toLowerCase().replace(/\/+$/, "");
        } catch {
          return String(u || "").split("?")[0].trim().toLowerCase().replace(/\/+$/, "");
        }
      };

      const extractOlxSlugId = (u: string): string => {
        const m = String(u || "").match(/-ID([A-Za-z0-9]+)\.html/i);
        return m ? m[1].toLowerCase() : "";
      };

      const seenUrlKeys = new Set<string>(existingUrlsRaw.map(normalizeAdUrl).filter(Boolean));
      const seenSlugIds = new Set<string>(existingUrlsRaw.map(extractOlxSlugId).filter(Boolean));

      const crawlHeaders = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "ro-RO,ro;q=0.9,en-US;q=0.8,en;q=0.7",
        "Cache-Control": "no-cache",
        "Referer": "https://www.olx.ro/",
      };

      const allRawAds: any[] = [];
      const upstreamErrors: string[] = [];
      let fetchedSearchUrls: string[] = [];
      let totalElementsEstimate = 0;

      const fetchSearchUrl = async (targetUrl: string) => {
        try {
          await validateSafeExternalUrl(targetUrl);
          const response = await safeFetchExternal(targetUrl, {
            headers: crawlHeaders,
            timeout: 10000,
            responseType: "text",
          });
          if (response.status >= 400) {
            upstreamErrors.push(`OLX.ro a returnat codul HTTP ${response.status}.`);
            return [];
          }
          const html = typeof response.data === "string" ? response.data : String(response.data || "");
          if (isBotChallengePage(html)) {
            upstreamErrors.push("OLX.ro a blocat temporar accesul automat (protecție anti-bot / captcha).");
            return [];
          }
          const $ = cheerio.load(html);
          const state = parseOlxPrerenderedState($);
          const listingNode = state?.listing?.listing;
          if (!state || !listingNode) {
            upstreamErrors.push("Structura paginii OLX.ro nu a putut fi citită (__PRERENDERED_STATE__ lipsă).");
            return [];
          }
          if (listingNode?.totalElements) {
            totalElementsEstimate = Math.max(totalElementsEstimate, Number(listingNode.totalElements) || 0);
          }
          const ads = Array.isArray(listingNode?.ads) ? listingNode.ads : [];
          return ads;
        } catch (err: any) {
          logger.warn(`OLX search crawl failed for ${targetUrl}: ${err?.message}`, { module: "crawler" });
          upstreamErrors.push(`Eroare de conexiune / timeout la accesarea OLX.ro: ${err?.message || "necunoscută"}`);
          return [];
        }
      };

      // Map each OLX ad into full CRM-compatible Lead shape
      const mapOlxAdToLeadCandidate = (ad: any) => {
        const adUrl = String(ad.url || "").trim();
        const rawTitle = String(ad.title || "Anunț imobiliar OLX").trim();
        const rawDesc = cleanHtmlDescriptionPreservingLines(String(ad.description || ""));
        const params: any[] = Array.isArray(ad.params) ? ad.params : [];
        const getParam = (key: string) => params.find((p) => p?.key === key);

        const catId = Number(ad?.category?.id || 0);
        let categoria = "Apartament";
        if (catId === 911 || catId === 913) categoria = "Casa/Vila";
        else if (catId === 709) categoria = "Teren";
        else if (catId === 2663 || catId === 2664 || catId === 2665) categoria = "Spatiu Industrial";
        else if (catId === 745) categoria = "Alte proprietati";
        else if (catId === 710) {
          const combo = `${rawTitle} ${rawDesc}`.toLowerCase();
          categoria = combo.includes("birou") || combo.includes("office") ? "Spatiu Birou" : "Spatiu Comercial";
        } else if (filters.categories.length === 1) {
          categoria = filters.categories[0];
        }

        // Price in EUR
        let priceNum = Number(ad?.price?.regularPrice?.value || 0);
        const currCode = String(ad?.price?.regularPrice?.currencyCode || ad?.price?.regularPrice?.currencySymbol || "EUR").toUpperCase();
        if (!priceNum && ad?.price?.displayValue) {
          priceNum = parseInt(String(ad.price.displayValue).replace(/[^0-9]/g, ""), 10) || 0;
        }
        if (priceNum > 0 && (currCode.includes("RON") || currCode.includes("LEI") || String(ad?.price?.displayValue || "").toLowerCase().includes("lei"))) {
          priceNum = Math.round(priceNum / 4.97);
        }

        // Transaction Type
        const alegeParam = getParam("alege");
        const alegeNorm = String(alegeParam?.normalizedValue || alegeParam?.value || "").toLowerCase();
        const urlLower = adUrl.toLowerCase();
        let transactionType: "Vânzare" | "Închiriere" = "Închiriere";
        if (catId === 907 || catId === 911 || catId === 1163 || catId === 1165 || catId === 1167 || catId === 1169 || catId === 2664 || alegeNorm.includes("vanz")) {
          transactionType = "Vânzare";
        } else if (catId === 909 || catId === 913 || catId === 1155 || catId === 1157 || catId === 1159 || catId === 1161 || catId === 2665 || alegeNorm.includes("inchir")) {
          transactionType = "Închiriere";
        } else if (filters.transactionType === "Vânzare" || filters.transactionType === "Cumpărare") {
          transactionType = "Vânzare";
        } else if (filters.transactionType === "Închiriere") {
          transactionType = "Închiriere";
        } else if (urlLower.includes("vanzare") || /\bv[aâ]nd\b|v[aâ]nzare/i.test(rawTitle)) {
          transactionType = "Vânzare";
        } else if (priceNum >= 20000) {
          transactionType = "Vânzare";
        }

        const formattedPrice =
          priceNum > 0
            ? `${priceNum.toLocaleString("ro-RO")} €${transactionType === "Închiriere" ? " / lună" : ""}`
            : String(ad?.price?.displayValue || "N/A");

        // Rooms
        let camere = "";
        if (catId === 1155 || catId === 1163) camere = "1";
        else if (catId === 1157 || catId === 1165) camere = "2";
        else if (catId === 1159 || catId === 1167) camere = "3";
        else if (catId === 1161 || catId === 1169) camere = "4";
        else {
          const roomMatch = `${rawTitle} ${rawDesc}`.match(/(\d+)\s*camere/i);
          if (roomMatch) camere = roomMatch[1];
          else if (/garsonier|studio/i.test(rawTitle)) camere = "1";
          else if (filters.rooms.length === 1) camere = filters.rooms[0].replace("+", "");
        }

        // Surface
        const mParam = getParam("m");
        const suprafataUtila = mParam?.normalizedValue
          ? String(mParam.normalizedValue).replace(/[^\d.,]/g, "").replace(",", ".")
          : (mParam?.value ? String(mParam.value).replace(/[^\d.,]/g, "").replace(",", ".") : "");
        const numUtila = parseFloat(suprafataUtila) || 0;
        const mult = categoria === "Apartament" || categoria === "Casa/Vila" ? 1.2 : 1.1;
        const suprafataConstruita = numUtila > 0 ? String(Math.round(numUtila * mult)) : "";

        // Compartimentare
        const compParam = getParam("compartimentare");
        let compartimentare = "";
        const compVal = String(compParam?.value || compParam?.normalizedValue || "").toLowerCase();
        if (compVal.includes("semidecomandat")) compartimentare = "Semidecomandat";
        else if (compVal.includes("nedecomandat")) compartimentare = "Nedecomandat";
        else if (compVal.includes("circular")) compartimentare = "Circular";
        else if (compVal.includes("decomandat")) compartimentare = "Decomandat";

        // An constructie
        const constParam = getParam("constructie");
        const constructieRaw = String(constParam?.value || "").trim();
        const constructieNorm = String(constParam?.normalizedValue || "").trim();

        // Floor
        const floorParam = getParam("floor") || getParam("floor_select");
        const floorNorm = String(floorParam?.normalizedValue || "").trim();
        let etaj = "";
        if (floorParam?.value) {
          const fv = String(floorParam.value).trim();
          etaj = /^\d+$/.test(fv) ? `Etaj ${fv}` : fv;
        }

        // Location — never use a Sector ("Sector 1".."Sector 6") as area; match against areas database
        const oras = String(ad?.location?.cityName || "București").trim();
        const verifiedOlxNeighborhood = resolveAreaFromAd({
          rawZone: ad?.location?.districtName,
          city: oras,
          title: rawTitle,
          description: rawDesc,
          url: adUrl,
          fallbackToCity: false,
        });
        const zona = verifiedOlxNeighborhood || oras;

        // Photos (promoted to 1000x700 and proxied)
        const rawPhotos: string[] = Array.isArray(ad?.photos)
          ? ad.photos
              .map((p: any) => (typeof p === "string" ? p : p?.link || p?.url || ""))
              .filter(Boolean)
              .map((u: string) =>
                u.includes(";s=") ? u.replace(/;s=\d+x\d+/, ";s=1000x700") : u
              )
              .slice(0, 15)
          : [];
        const proxiedImages = rawPhotos.map((u) =>
          u.startsWith("http") && !u.includes("/api/proxy-image")
            ? `/api/proxy-image?url=${encodeURIComponent(u)}`
            : u
        );

        // Extract phone from seller description ONLY if strictly boundary-delimited and non-placeholder
        const descPhone = extractPhoneFromVisibleText(rawDesc) || "";
        const ownerName = String(ad?.user?.name || "Proprietar OLX").trim() || "Proprietar OLX";

        const olxAutomationSource = {
          transactionType,
          categoria,
          camere,
          suprafataUtila: suprafataUtila || "",
          suprafataConstruita,
          etaj,
          zona: verifiedOlxNeighborhood,
          oras,
          compartimentare,
          sistemIncalzire: "",
          mobilat: "",
          balcoane: "",
          rawTitle,
          rawText: rawDesc,
        };

        const crmData = {
          detaliiGenerale: {
            stadiu: "Activ - Hot",
            tranzactie: transactionType,
            categoria,
            proprietar: ownerName,
            contacteAditionale: descPhone || "Nespecificat",
            ansambluRezidential: "",
            localizare: {
              oras,
              zona: [zona],
              strada: "",
              numar: "",
              bloc: "",
              scara: "",
              apartament: "",
              puncteInteres: [],
              imprejurimi: [],
            },
            memoPrivat: "",
          },
          caracteristici: {
            detalii: {
              tipCasa: "",
              tipApartament: categoria === "Apartament" ? "Standard" : "",
              compartimentare: compartimentare || "",
              confort: "1",
              destinatie: "Rezidential",
              camere: String(camere || ""),
              bucatarii: "1",
              dormitoare: camere ? String(Math.max(1, parseInt(camere, 10) - 1 || 1)) : "",
              bai: "1",
              balcoane: "0",
              terase: "0",
              etaj,
              orientare: "",
              parcari: "0",
              garaje: "0",
              checkList: [],
            },
            suprafete: {
              utila: suprafataUtila || "",
              amprenta: "",
              construita: suprafataConstruita,
              utilaTotala: suprafataUtila || "",
              balcoane: "0",
              terase: "0",
              gradina: "0",
              teren: "0",
              terenLiber: "0",
              frontStradal: "",
              vitrina: "",
              numarFronturi: "",
              numarTerase: "0",
              numarBalcoane: "0",
            },
            alteDetalii: {
              stadiuConstructie: "Finalizata",
              structura: "Beton",
              tipImobil: categoria === "Casa/Vila" ? "Casa/Vila" : "Bloc",
              riscSeismic: "",
              anConstructie: constructieRaw || constructieNorm || "",
              anRenovare: "",
              inaltime: "",
            },
            energetica: { clasa: "", consumAnual: "", emisiiCO2: "", consumRegenerabile: "" },
          },
          utilitati: {
            general: ["Curent", "Apa", "Canalizare", "Gaz"],
            sistemIncalzire: [],
            climatizare: [],
            finisaje: {
              stare: ["Buna"],
              izolatii: [],
              pereti: ["Vopsea lavabila"],
              podele: ["Parchet", "Gresie"],
              ferestre: ["PVC"],
              jaluzele: [],
              rulouri: [],
              usaIntrare: ["Metal"],
              usiInterior: ["Lemn"],
              acoperis: [],
            },
            dotari: {
              mobilat: "Complet",
              spatiiAditionale: [],
              bucatarie: [],
              contorizare: [],
              electrocasnice: [],
              imobil: [],
              diverse: [],
              servicii: [],
              amenajareStrazi: ["Asfaltate", "Iluminat stradal"],
              priveliste: ["Spre oras"],
            },
          },
          pret: {
            detalii: {
              pret: formattedPrice,
              moneda: "€",
              pretMp: "",
              ultimPret: "",
              checkList: [],
              plataAcceptata: "Cash sau Credit",
              pretGaraj: "",
              pretParcare: "",
              avans: transactionType === "Închiriere" ? "1 lună avans" : "",
              garantie: transactionType === "Închiriere" ? "1 lună garanție" : "",
              tvaIncluded: false,
              notePrivate: "",
            },
            comisioane: {
              comisionCumparatorProcent: transactionType === "Închiriere" ? "50%" : "",
              comisionCumparatorValoare: transactionType === "Închiriere" ? "50%+TVA" : "",
              comisionProprietarProcent: transactionType === "Închiriere" ? "50%" : "",
              comisionProprietarValoare: transactionType === "Închiriere" ? "50%+TVA" : "",
              colaborare: false,
            },
            contract: { tip: "Intermediere", semnat: "Nu", nr: "", dataSemnare: "", dataExpirare: "" },
          },
          descriere: {
            titlu: rawTitle,
            continut: rawDesc,
            disponibilitate: "Imediat",
            video: "",
            turVirtual: "",
          },
          imagini: {
            living: [],
            bucatarie: [],
            camera: [],
            baie: [],
            alteSpatii: proxiedImages.map((img) => ({ original: img })),
          },
        };

        return {
          olxAdId: ad.id,
          createdTime: ad.createdTime || ad.lastRefreshTime || null,
          url: adUrl,
          title: rawTitle,
          zone: zona,
          price: formattedPrice,
          ownerName,
          ownerPhone: descPhone || "Nespecificat",
          transactionType,
          categoria,
          leadType: "Proprietar",
          coverImage: proxiedImages[0] || undefined,
          images: proxiedImages,
          notes: rawDesc || rawTitle,
          extractedData: {
            crmData,
            originalTitle: rawTitle,
            originalDescription: rawDesc,
            markdownMarketing: rawDesc,
            automationSource: olxAutomationSource,
            olxMeta: {
              adId: ad.id,
              originalTitle: rawTitle,
              categoryId: catId,
              priceEur: priceNum,
              surface: numUtila || undefined,
              rooms: camere || undefined,
              compartimentare: compParam?.normalizedValue || compartimentare || undefined,
              constructie: constructieNorm || constructieRaw || undefined,
              floor: floorNorm || etaj || undefined,
              createdTime: ad.createdTime || null,
              lastRefreshTime: ad.lastRefreshTime || null,
            },
          },
        };
      };

      const passesAgeWindow = (ad: any) => {
        if (!cutoffOldestMs && !cutoffNewestMs) return true;
        const postedMs = Date.parse(ad?.createdTime || ad?.lastRefreshTime || "") || 0;
        if (!postedMs) return true;
        if (cutoffOldestMs && postedMs < cutoffOldestMs) return false;
        if (cutoffNewestMs && postedMs > cutoffNewestMs) return false;
        return true;
      };

      const dedupedAdsMap = new Map<string, any>();
      let currentPage = startPage;
      const hasPostFetchFilters =
        filters.zones.length > 0 || Boolean(cutoffOldestMs) || Boolean(cutoffNewestMs);
      const maxPagesToScan = hasPostFetchFilters ? 5 : 3;

      for (let pageOffset = 0; pageOffset < maxPagesToScan; pageOffset++) {
        currentPage = startPage + pageOffset;
        const pageUrls = buildOlxSearchUrls(filters, currentPage).slice(0, 6);
        let pageReturnedAnyAds = false;

        for (const sUrl of pageUrls) {
          fetchedSearchUrls.push(sUrl);
          const ads = await fetchSearchUrl(sUrl);
          if (ads.length > 0) pageReturnedAnyAds = true;
          allRawAds.push(...ads);
        }

        for (const ad of allRawAds) {
          if (!ad || !ad.url) continue;
          // Pre-filter out ads flagged as business/agency in OLX search listing state
          if (ad.business === true || ad.user?.is_business === true) continue;
          const normUrl = normalizeAdUrl(ad.url);
          const slugId = extractOlxSlugId(ad.url);
          const numericKey = ad.id ? String(ad.id) : "";
          if (seenUrlKeys.has(normUrl) || (slugId && seenSlugIds.has(slugId))) continue;
          const uniqueKey = slugId || numericKey || normUrl;
          if (!dedupedAdsMap.has(uniqueKey)) {
            dedupedAdsMap.set(uniqueKey, ad);
          }
        }

        if (!pageReturnedAnyAds) {
          break;
        }

        if (hasPostFetchFilters) {
          const matchedSoFar = Array.from(dedupedAdsMap.values()).filter(
            (ad) => passesAgeWindow(ad) && matchesOlxLeadFilter(mapOlxAdToLeadCandidate(ad), filters)
          ).length;
          if (matchedSoFar >= limit) {
            break;
          }
        } else if (dedupedAdsMap.size >= limit) {
          break;
        }
      }

      // Sort strictly by newest/fresh published first (createdTime descending, then lastRefreshTime)
      const sortedFreshAds = Array.from(dedupedAdsMap.values())
        .filter(passesAgeWindow)
        .sort((a, b) => {
          const createdA = Date.parse(a?.createdTime || a?.lastRefreshTime || "") || 0;
          const createdB = Date.parse(b?.createdTime || b?.lastRefreshTime || "") || 0;
          if (createdB !== createdA) return createdB - createdA;
          const refA = Date.parse(a?.lastRefreshTime || "") || 0;
          const refB = Date.parse(b?.lastRefreshTime || "") || 0;
          return refB - refA;
        });

      const matchedCandidates = sortedFreshAds
        .map(mapOlxAdToLeadCandidate)
        .filter((candidate) => matchesOlxLeadFilter(candidate, filters));

      // Take a slightly wider candidate pool so if some listings turn out to be agencies
      // upon inspecting div[data-testid="ad-parameters-container"] ("Persoana fizica"),
      // we can still satisfy up to `limit` verified private-owner listings.
      const candidatePool = matchedCandidates.slice(0, Math.min(matchedCandidates.length, Math.max(limit * 2, limit + 4)));

      // Enrich each candidate from its actual OLX.ro ad detail HTML page using the exact DOM rules:
      // 1. Title: div[data-cy="offer_title"] h4 / div[data-testid="offer_title"] h4
      // 2. Price: div[data-testid="ad-price-container"] h3
      // 3. Description: div[data-cy="ad_description"] div.text-background-action-primary.whitespace-pre-line
      // 4. Owner name: h4[data-testid="user-profile-user-name"]
      // 5. Published date: span[data-cy="ad-posted-at"] / span[data-testid="ad-posted-at"]
      // 6. Private seller check: div[data-testid="ad-parameters-container"] MUST contain "Persoana fizica" (otherwise drop agency ad)
      // 7. Phone enrichment (JSON endpoints + click-to-reveal fallback)
      const enrichCandidateWithDomAndPhone = async (
        item: ReturnType<typeof mapOlxAdToLeadCandidate>
      ): Promise<ReturnType<typeof mapOlxAdToLeadCandidate> | null> => {
        if (item.url && item.url.toLowerCase().includes("olx.ro")) {
          try {
            await validateSafeExternalUrl(item.url);
            const detailRes = await safeFetchExternal(item.url, {
              headers: crawlHeaders,
              timeout: 7500,
              responseType: "text",
            });
            if (detailRes.status === 200 && typeof detailRes.data === "string" && !isBotChallengePage(detailRes.data)) {
              const $detail = cheerio.load(detailRes.data);
              const detailState = parseOlxPrerenderedState($detail);
              const detailOlxAd: any = detailState?.ad?.ad || detailState?.ad || null;

              const domParams = extractOlxDomParameters($detail);
              const isConfirmedAgency = domParams.hasContainer
                ? !domParams.isPrivateSeller
                : detailOlxAd?.business === true || detailOlxAd?.user?.is_business === true;
              if (isConfirmedAgency) {
                logger.info(`Skipping OLX agency ad (missing "Persoana fizica"): ${item.url}`, { module: "crawler" });
                return null;
              }

              const domTitle = extractOlxDomTitle($detail);
              if (domTitle) {
                item.title = domTitle;
                if (item.extractedData) {
                  item.extractedData.originalTitle = domTitle;
                  if (item.extractedData.crmData?.descriere) {
                    item.extractedData.crmData.descriere.titlu = domTitle;
                  }
                  if (item.extractedData.olxMeta) {
                    item.extractedData.olxMeta.originalTitle = domTitle;
                  }
                  if (item.extractedData.automationSource) {
                    item.extractedData.automationSource.rawTitle = domTitle;
                  }
                }
              }

              const domDesc = extractOlxDomDescription($detail);
              if (domDesc) {
                item.notes = domDesc;
                if (item.extractedData) {
                  item.extractedData.originalDescription = domDesc;
                  item.extractedData.markdownMarketing = domDesc;
                  if (item.extractedData.crmData?.descriere) {
                    item.extractedData.crmData.descriere.continut = domDesc;
                  }
                  if (item.extractedData.automationSource) {
                    item.extractedData.automationSource.rawText = `${item.title}\n${domDesc}`;
                  }
                }
                if (!item.ownerPhone || item.ownerPhone === "Nespecificat") {
                  const descPhone = extractPhoneFromVisibleText(domDesc);
                  if (descPhone) {
                    item.ownerPhone = descPhone;
                    if (item.extractedData?.crmData?.detaliiGenerale) {
                      item.extractedData.crmData.detaliiGenerale.contacteAditionale = descPhone;
                    }
                  }
                }
              }

              const domPrice = extractOlxDomPrice($detail);
              if (domPrice) {
                const parsed = parseDomPriceString(domPrice);
                if (parsed.value > 0) {
                  const eurVal = parsed.currency === "RON" ? Math.round(parsed.value / 4.97) : parsed.value;
                  const formatted = `${eurVal.toLocaleString("ro-RO")} €${item.transactionType === "Închiriere" ? " / lună" : ""}`;
                  item.price = formatted;
                  if (item.extractedData?.crmData?.pret?.detalii) {
                    item.extractedData.crmData.pret.detalii.pret = formatted;
                  }
                  if (item.extractedData?.olxMeta) {
                    item.extractedData.olxMeta.priceEur = eurVal;
                  }
                }
              }

              const domOwner = extractOlxDomOwner($detail);
              if (domOwner) {
                item.ownerName = domOwner;
                if (item.extractedData?.crmData?.detaliiGenerale) {
                  item.extractedData.crmData.detaliiGenerale.proprietar = domOwner;
                }
              }

              const domPostedAt = extractOlxDomPostedAt($detail);
              if (domPostedAt.rawText || domPostedAt.isoDate) {
                if (domPostedAt.isoDate) {
                  item.createdTime = domPostedAt.isoDate;
                }
                if (item.extractedData?.olxMeta) {
                  (item.extractedData.olxMeta as any).publishedAt = domPostedAt.isoDate || item.extractedData.olxMeta.createdTime || null;
                  (item.extractedData.olxMeta as any).publishedAtLabel = domPostedAt.cleanLabel || "";
                  if (domPostedAt.isoDate) {
                    item.extractedData.olxMeta.createdTime = domPostedAt.isoDate;
                  }
                }
              }

              if (domParams.hasContainer) {
                if (item.extractedData?.olxMeta) {
                  (item.extractedData.olxMeta as any).sellerType = domParams.sellerType || "Persoana fizica";
                }
                if (domParams.suprafataUtila) {
                  const numU = parseFloat(domParams.suprafataUtila) || 0;
                  const mult = item.categoria === "Apartament" || item.categoria === "Casa/Vila" ? 1.2 : 1.1;
                  const constr = numU > 0 ? String(Math.round(numU * mult)) : "";
                  if (item.extractedData?.crmData?.caracteristici?.suprafete) {
                    item.extractedData.crmData.caracteristici.suprafete.utila = domParams.suprafataUtila;
                    item.extractedData.crmData.caracteristici.suprafete.utilaTotala = domParams.suprafataUtila;
                    if (constr) item.extractedData.crmData.caracteristici.suprafete.construita = constr;
                  }
                  if (item.extractedData?.automationSource) {
                    item.extractedData.automationSource.suprafataUtila = domParams.suprafataUtila;
                    if (constr) item.extractedData.automationSource.suprafataConstruita = constr;
                  }
                  if (item.extractedData?.olxMeta && numU > 0) {
                    item.extractedData.olxMeta.surface = numU;
                  }
                }
                if (domParams.anConstructie) {
                  if (item.extractedData?.crmData?.caracteristici?.alteDetalii) {
                    item.extractedData.crmData.caracteristici.alteDetalii.anConstructie = domParams.anConstructie;
                  }
                  if (item.extractedData?.olxMeta) {
                    item.extractedData.olxMeta.constructie = domParams.anConstructie;
                  }
                }
                if (domParams.etaj) {
                  if (item.extractedData?.crmData?.caracteristici?.detalii) {
                    item.extractedData.crmData.caracteristici.detalii.etaj = domParams.etaj;
                  }
                  if (item.extractedData?.automationSource) {
                    item.extractedData.automationSource.etaj = domParams.etaj;
                  }
                  if (item.extractedData?.olxMeta) {
                    item.extractedData.olxMeta.floor = domParams.etaj;
                  }
                }
                if (domParams.compartimentare) {
                  if (item.extractedData?.crmData?.caracteristici?.detalii) {
                    item.extractedData.crmData.caracteristici.detalii.compartimentare = domParams.compartimentare;
                  }
                  if (item.extractedData?.automationSource) {
                    item.extractedData.automationSource.compartimentare = domParams.compartimentare;
                  }
                  if (item.extractedData?.olxMeta) {
                    item.extractedData.olxMeta.compartimentare = domParams.compartimentare;
                  }
                }
                if (domParams.camere) {
                  if (item.extractedData?.crmData?.caracteristici?.detalii) {
                    item.extractedData.crmData.caracteristici.detalii.camere = domParams.camere;
                  }
                  if (item.extractedData?.automationSource) {
                    item.extractedData.automationSource.camere = domParams.camere;
                  }
                  if (item.extractedData?.olxMeta) {
                    item.extractedData.olxMeta.rooms = domParams.camere;
                  }
                }
              }

              // Re-check age window if detail DOM provided a more exact published date
              if (domPostedAt.isoDate && (cutoffOldestMs || cutoffNewestMs)) {
                const detailPostedMs = Date.parse(domPostedAt.isoDate) || 0;
                if (detailPostedMs) {
                  if (cutoffOldestMs && detailPostedMs < cutoffOldestMs) return null;
                  if (cutoffNewestMs && detailPostedMs > cutoffNewestMs) return null;
                }
              }
            }
          } catch (detailErr: any) {
            logger.warn(`OLX detail DOM fetch skipped for ${item.url}: ${detailErr?.message}`, { module: "crawler" });
          }
        }

        if (item.ownerPhone && item.ownerPhone !== "Nespecificat" && extractValidRoPhone(item.ownerPhone)) {
          return item;
        }
        if (item.olxAdId) {
          for (const ep of [
            `https://www.olx.ro/api/v1/offers/${item.olxAdId}/phones/`,
            `https://www.olx.ro/api/v1/offers/${item.olxAdId}/limited-phones/`,
          ]) {
            try {
              const pRes = await safeFetchExternal(ep, {
                headers: {
                  "User-Agent": crawlHeaders["User-Agent"],
                  "Referer": item.url,
                  "Accept": "application/json",
                },
                timeout: 1800,
                responseType: "json",
              });
              if (pRes.status === 200 && pRes.data && typeof pRes.data === "object") {
                const d = pRes.data.data;
                const found =
                  (Array.isArray(d?.phones) && d.phones[0]) ||
                  pRes.data.value ||
                  (Array.isArray(pRes.data) && pRes.data[0]);
                const validPhone = extractValidRoPhone(found);
                if (validPhone) {
                  item.ownerPhone = validPhone;
                  if (item.extractedData?.crmData?.detaliiGenerale) {
                    item.extractedData.crmData.detaliiGenerale.contacteAditionale = validPhone;
                  }
                  return item;
                }
              }
            } catch {
              // Optional fast-path lookup - continue to click-to-reveal
            }
          }
        }

        // Click-to-reveal fallback: click `button[data-cy="ad-contact-phone"]` ("Suna vanzatorul")
        // and copy the revealed phone number that replaces the initial button text.
        if (item.url && item.url.toLowerCase().includes("olx.ro")) {
          const revealedPhone = await revealOlxPhoneByClick(item.url, item.olxAdId, { timeoutMs: 20000 });
          if (revealedPhone) {
            item.ownerPhone = revealedPhone;
            if (item.extractedData?.crmData?.detaliiGenerale) {
              item.extractedData.crmData.detaliiGenerale.contacteAditionale = revealedPhone;
            }
          }
        }
        return item;
      };

      const enrichedItems: any[] = [];
      for (let i = 0; i < candidatePool.length && enrichedItems.length < limit; i += 3) {
        const chunk = candidatePool.slice(i, i + 3);
        const settled = await Promise.allSettled(chunk.map(enrichCandidateWithDomAndPhone));
        settled.forEach((r, idx) => {
          if (enrichedItems.length >= limit) return;
          const item = r.status === "fulfilled" ? r.value : chunk[idx];
          if (!item) return; // Filtered out as agency or outside age window
          const { olxAdId, createdTime, ...cleanItem } = item;
          enrichedItems.push({
            ...cleanItem,
            publishedAt: (item.extractedData?.olxMeta as any)?.publishedAt || createdTime || null,
            publishedAtLabel: (item.extractedData?.olxMeta as any)?.publishedAtLabel || "",
          });
        });
      }

      if (allRawAds.length === 0 && upstreamErrors.length > 0) {
        return res.status(502).json({
          error: upstreamErrors[0],
          upstreamErrors: Array.from(new Set(upstreamErrors)),
        });
      }

      const emptyReason =
        enrichedItems.length > 0
          ? null
          : allRawAds.length > 0 && dedupedAdsMap.size === 0
            ? "all_seen"
            : dedupedAdsMap.size > 0 && matchedCandidates.length === 0
              ? "no_filter_matches"
              : "no_olx_results";

      return res.json({
        items: enrichedItems,
        nextPage: matchedCandidates.length > limit ? currentPage : currentPage + 1,
        hasMore: matchedCandidates.length > limit || totalElementsEstimate > currentPage * 40,
        totalDiscovered: matchedCandidates.length,
        searchedUrls: fetchedSearchUrls,
        emptyReason,
        warning: enrichedItems.length === 0 && upstreamErrors.length > 0 ? upstreamErrors[0] : null,
      });
    } catch (err: any) {
      logger.error(`crawl-olx-leads error: ${err?.message || "Unknown"}`, { module: "crawler" });
      return res.status(500).json({ error: err?.message || "Eroare la preluarea anunțurilor de pe OLX.ro" });
    }
  });

  // Basic crawl for initial lead entry
  app.post("/api/crawl-basic", ...requireTenantContext, crawlRouteLimiter, requireQuota("ai_requests", 1), async (req, res, next) => {
    const { url } = req.body;
    if (!url || typeof url !== "string") return res.status(400).json({ error: "URL is required" });

    try {
      await validateSafeExternalUrl(url);
    } catch (ssrfErr: any) {
      return res.status(400).json({ error: ssrfErr?.message || "URL invalid sau blocat de politica SSRF." });
    }

    try {
      QuotaService.consumeQuota(req.tenantContext!.tenantId, "ai_requests", 1);
    } catch (quotaErr: any) {
      return res.status(quotaErr?.statusCode || 429).json({ error: quotaErr?.message || "Cota lunară a fost atinsă." });
    }

    const userAgents = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15"
    ];

    let lastError: any = null;
    let lastUpstreamStatus: number | null = null;
    for (let i = 0; i < userAgents.length; i++) {
      try {
        const response = await safeFetchExternal(url, {
          headers: {
            "User-Agent": userAgents[i % userAgents.length],
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "ro-RO,ro;q=0.9,en-US;q=0.8,en;q=0.7",
            "Referer": "https://www.google.ro/",
          },
          timeout: 8000,
          responseType: "text",
        });

        if (response.status === 403 || response.status === 429 || response.status === 502 || response.status === 503 || response.status === 504) {
          lastUpstreamStatus = response.status;
          lastError = new Error(`Site returned ${response.status}`);
          if (i < userAgents.length - 1) {
            await new Promise(r => setTimeout(r, 600));
            continue;
          }
          break;
        }

        if (response.status >= 400) {
          lastUpstreamStatus = response.status;
          lastError = new Error(`HTTP Error ${response.status}`);
          break;
        }

        const html = typeof response.data === "string" ? response.data : String(response.data || "");
        if (isBotChallengePage(html)) {
          lastUpstreamStatus = 403;
          lastError = new Error("Pagina returnată este o verificare anti-bot / Cookie check.");
          if (i < userAgents.length - 1) {
            await new Promise(r => setTimeout(r, 600));
            continue;
          }
          break;
        }
        const $ = cheerio.load(html);
        const title = extractOlxDomTitle($) || $("title").text() || "";
        const text = convert(html, {
          wordwrap: 130,
          selectors: [
            { selector: "a", options: { ignoreHref: true } },
            { selector: "img", format: "skip" },
            { selector: "nav", format: "skip" },
            { selector: "footer", format: "skip" },
            { selector: "script", format: "skip" },
            { selector: "style", format: "skip" },
          ],
        });

        res.json({ title, text: text.substring(0, 10000) });
        return;
      } catch (error: any) {
        logger.warn(`Basic crawl attempt ${i + 1} failed: ${error?.message || "Unknown error"}`, {
          module: "crawler",
          meta: { attempt: i + 1 },
        });
        lastError = error;
      }
    }

    const basicErrMessage =
      lastUpstreamStatus === 403 || lastUpstreamStatus === 429 || lastUpstreamStatus === 503
        ? `Site-ul extern a blocat accesul automat (HTTP ${lastUpstreamStatus} — protecție anti-bot).`
        : lastUpstreamStatus && lastUpstreamStatus >= 400
        ? `Pagina externă a returnat HTTP ${lastUpstreamStatus}.`
        : `Basic crawl failed: ${lastError?.message || "Unknown error"}`;

    res.status(422).json({
      error: basicErrMessage,
      code: lastUpstreamStatus ? "UPSTREAM_ACCESS_BLOCKED" : "UPSTREAM_CONNECTION_ERROR",
      upstreamStatus: lastUpstreamStatus,
    });
  });

  // API Route to proxy images for Gemini (bypasses CORS), validates magic bytes & size, and cleans watermarks
  app.get("/api/proxy-image", proxyImageLimiter, async (req, res) => {
    const { url } = req.query;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "Missing URL parameter" });
    }

    const cleanUrl = normalizeCleanImageUrl(url);

    try {
      await validateSafeExternalUrl(cleanUrl);
    } catch (ssrfErr: any) {
      return res.status(400).json({ error: ssrfErr?.message || "URL invalid sau blocat de politica SSRF." });
    }

    const validationError = getCleanImageValidationError(cleanUrl);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const userAgent = req.headers["user-agent"] || "";
    const isSocialCrawler = /WhatsApp|facebookexternalhit|Facebot|Twitterbot|TelegramBot|LinkedInBot|Applebot/i.test(userAgent);
    const wantsJpeg = isSocialCrawler || req.query.format === "jpeg";
    const skipClean = req.query.noclean === "true";
    const aggressive =
      req.query.aggressive === "1" ||
      req.query.aggressive === "true" ||
      isAggressiveWatermarkSource(cleanUrl);
    const regenToken =
      typeof req.query.regen === "string"
        ? req.query.regen.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24)
        : "";

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

    const targetWidth = parseThumbnailWidth(req.query.w);
    const preferWebp = shouldServeWebp(req.headers.accept, req.query.format);

    try {
      const entry = await fetchAndCleanExternalImage(cleanUrl, {
        skipClean,
        aggressive,
        maxAttempts: 3,
        timeoutMs: 8000,
      });
      let sendData = entry.data;
      let sendMime = entry.mimeType;

      if (targetWidth) {
        const thumb = await createThumbnail({
          buffer: sendData,
          mimeType: sendMime,
          targetWidth,
          preferWebp: !wantsJpeg && preferWebp,
          forceJpeg: wantsJpeg,
          cacheKey: `proxy::${cleanUrl}::clean=${!skipClean}::agg=${aggressive ? 1 : 0}${regenToken ? `::r=${regenToken}` : ""}`,
        });
        sendData = thumb.data;
        sendMime = thumb.mimeType;
      } else if (wantsJpeg && sendMime !== "image/jpeg") {
        try {
          sendData = await execConvert(["-", "-quality", "90", "jpg:-"], sendData);
          sendMime = "image/jpeg";
        } catch {}
      }

      if (req.query.json === "true") {
        const base64 = sendData.toString("base64");
        return res.json({ base64, contentType: sendMime });
      } else {
        res.setHeader("Content-Type", sendMime);
        res.setHeader("Vary", "Accept");
        res.setHeader("Cache-Control", targetWidth ? "public, max-age=86400" : "public, max-age=3600");
        return res.send(sendData);
      }
    } catch (error: any) {
      if (error?.isPermanentClientError) {
        return res.status(400).json({ error: error.message });
      }
      return res.status(502).json({ error: `Failed to fetch image after retries: ${error?.message}` });
    }
  });

  // Regenerate ALL property images with aggressive watermark detection + inpainting and fresh cache-busted URLs
  app.post("/api/properties/regenerate-images", ...requireTenantContext, crawlRouteLimiter, async (req, res) => {
    try {
      const rawImages = Array.isArray(req.body?.images) ? req.body.images : [];
      const rawCover = typeof req.body?.coverImage === "string" ? req.body.coverImage.trim() : "";

      const sanitizedInput = rawImages
        .filter((u: unknown): u is string => typeof u === "string" && u.trim().length > 0)
        .map((u: string) => u.trim())
        .slice(0, 100);

      if (sanitizedInput.length === 0) {
        return res.status(400).json({
          success: false,
          error: "Este necesară cel puțin o imagine pentru regenerare.",
        });
      }

      const regenVersion = String(Date.now());
      const urlMap: Record<string, string> = {};
      const results = new Array<string>(sanitizedInput.length);
      let processedCount = 0;
      let inpaintedCount = 0;
      let failedCount = 0;
      let ssrfBlockedCount = 0;

      const unwrapExternalUrl = (inputUrl: string): string | null => {
        const trimmed = inputUrl.trim();
        if (trimmed.startsWith("/api/proxy-image") || trimmed.includes("/api/proxy-image?")) {
          try {
            const parsed = new URL(trimmed, "http://localhost");
            const inner = parsed.searchParams.get("url");
            if (inner) return normalizeCleanImageUrl(inner);
          } catch {}
        }
        if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("//")) {
          return normalizeCleanImageUrl(trimmed);
        }
        return null;
      };

      const processSingleImage = async (origUrl: string): Promise<string> => {
        // 1. Inline base64 data:image/... URLs
        if (origUrl.startsWith("data:image/")) {
          const match = origUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
          if (!match) {
            failedCount++;
            return origUrl;
          }
          const declaredMime = match[1].toLowerCase();
          if (declaredMime.includes("svg")) {
            failedCount++;
            return origUrl;
          }
          const rawBuf = Buffer.from(match[2], "base64");
          if (rawBuf.length === 0 || rawBuf.length > DEFAULT_MAX_EXTERNAL_BYTES) {
            failedCount++;
            return origUrl;
          }
          const magic = detectImageMagicBytes(rawBuf);
          if (!magic) {
            failedCount++;
            return origUrl;
          }
          const cleaned = await cleanImageWatermarksDetailed(rawBuf, magic.mime, "inline-data-url", {
            aggressive: true,
          });
          processedCount++;
          if (cleaned.inpaintedBoxes > 0) {
            inpaintedCount++;
            const outMime = detectImageMagicBytes(cleaned.buffer)?.mime || cleaned.mimeType || magic.mime;
            return `data:${outMime};base64,${cleaned.buffer.toString("base64")}`;
          }
          return origUrl;
        }

        // 2. Local uploaded files under /uploads/<file> (strict path confinement)
        const uploadsMatch = origUrl.match(/^\/uploads\/([^?#]+)/);
        if (uploadsMatch) {
          try {
            const relName = decodeURIComponent(uploadsMatch[1]);
            const resolved = path.resolve(uploadsDir, relName);
            if (!resolved.startsWith(uploadsDir + path.sep) || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
              failedCount++;
              return origUrl;
            }
            const fileBuf = fs.readFileSync(resolved);
            if (fileBuf.length === 0 || fileBuf.length > DEFAULT_MAX_EXTERNAL_BYTES) {
              failedCount++;
              return origUrl;
            }
            const magic = detectImageMagicBytes(fileBuf);
            if (!magic) {
              failedCount++;
              return origUrl;
            }
            const cleaned = await cleanImageWatermarksDetailed(fileBuf, magic.mime, `/uploads/${relName}`, {
              aggressive: true,
            });
            processedCount++;
            if (cleaned.inpaintedBoxes > 0) {
              inpaintedCount++;
              fs.writeFileSync(resolved, cleaned.buffer);
            }
            clearThumbnailCacheByPrefix(`upload::${resolved}`);
            return `/uploads/${encodeURIComponent(relName)}?regen=${regenVersion}`;
          } catch {
            failedCount++;
            return origUrl;
          }
        }

        // 3. External URLs (direct or wrapped in /api/proxy-image?url=...)
        const externalUrl = unwrapExternalUrl(origUrl);
        if (externalUrl) {
          try {
            await validateSafeExternalUrl(externalUrl);
          } catch {
            ssrfBlockedCount++;
            failedCount++;
            return origUrl;
          }
          const blockedReason = getCleanImageValidationError(externalUrl);
          if (blockedReason) {
            failedCount++;
            return origUrl;
          }

          try {
            evictImageCachesForUrl(externalUrl);
            const cleanedEntry = await fetchAndCleanExternalImage(externalUrl, {
              skipClean: false,
              aggressive: true,
              forceRefresh: true,
              maxAttempts: 3,
              timeoutMs: 12000,
            });
            processedCount++;
            if ((cleanedEntry.inpaintedBoxes || 0) > 0) {
              inpaintedCount++;
            }
            return `/api/proxy-image?url=${encodeURIComponent(externalUrl)}&aggressive=1&regen=${regenVersion}`;
          } catch {
            failedCount++;
            return origUrl;
          }
        }

        // Preserve any other internal storage URLs safely
        processedCount++;
        return origUrl;
      };

      const concurrency = 6;
      let cursor = 0;
      const worker = async () => {
        while (true) {
          const idx = cursor++;
          if (idx >= sanitizedInput.length) break;
          const orig = sanitizedInput[idx];
          const next = await processSingleImage(orig);
          results[idx] = next;
          urlMap[orig] = next;
        }
      };

      await Promise.all(Array.from({ length: Math.min(concurrency, sanitizedInput.length) }, () => worker()));

      if (ssrfBlockedCount === sanitizedInput.length) {
        return res.status(400).json({
          success: false,
          error: "URL-urile imaginilor au fost blocate de politica de securitate SSRF.",
        });
      }

      let regeneratedCover = results[0] || "";
      if (rawCover) {
        if (urlMap[rawCover]) {
          regeneratedCover = urlMap[rawCover];
        } else {
          regeneratedCover = await processSingleImage(rawCover);
          urlMap[rawCover] = regeneratedCover;
        }
      }

      return res.json({
        success: true,
        data: {
          regenVersion,
          totalCount: sanitizedInput.length,
          processedCount,
          inpaintedCount,
          failedCount,
          images: results,
          coverImage: regeneratedCover,
          urlMap,
        },
      });
    } catch (err: any) {
      logger.error(`Image regeneration error: ${err?.message || err}`, { module: "media" });
      return res.status(500).json({
        success: false,
        error: "A apărut o eroare la regenerarea imaginilor.",
      });
    }
  });

  // Prevent API fall-through to Vite/static fallback
  app.all("/api/*", (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` });
  });

  // Global error handler
  app.use((err: any, req: any, res: any, next: any) => {
    console.error("Global crash handler:", err);
    const status = typeof err?.statusCode === "number" ? err.statusCode : 500;
    const code = typeof err?.code === "string" ? err.code : "INTERNAL_ERROR";
    const message = err?.message || "Internal server error";
    res.status(status).json({
      success: false,
      error: {
        code,
        message,
        timestamp: new Date().toISOString(),
      },
      details: message,
    });
  });

  // Resolve dist directory across multiple potential locations (excluding source workspace root)
  const candidateDistDirs = [
    path.join(process.cwd(), "dist"),
    path.join(__dirname, "dist"),
    path.resolve("./dist")
  ];
  let distPath = "";
  for (const dir of candidateDistDirs) {
    if (fs.existsSync(path.join(dir, "index.html")) && fs.existsSync(path.join(dir, "assets"))) {
      distPath = dir;
      break;
    }
  }

  // Always serve static compiled hashed assets with 1-year immutable Cache-Control
  if (distPath) {
    app.use(
      "/assets",
      express.static(path.join(distPath, "assets"), {
        maxAge: "1y",
        immutable: true,
        etag: true,
      })
    );
  }

  // In development, Vite handles on-the-fly compilation, module transformation, and SPA routing!
  if (!isProduction && vite) {
    app.use(vite.middlewares);
  } else if (distPath) {
    // In production, serve bundled static assets from dist (HTML stays no-cache, static files cached 1h)
    app.use(
      express.static(distPath, {
        maxAge: "1h",
        setHeaders: (res, filePath) => {
          if (filePath.endsWith(".html")) {
            res.setHeader("Cache-Control", "no-cache, must-revalidate");
          }
        },
      })
    );
    app.get("*", (req, res) => {
      res.setHeader("Cache-Control", "no-cache, must-revalidate");
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  try {
    const syncSummary = await PersistentStoreService.hydrateFromFirestore([
      "automation_configs",
      "ai_configs",
      "platform_settings",
      "platform_audit_logs",
      "tenant_memberships",
      "subscription_plans",
      "subscriptions",
      "platform_cutover_config",
      "preview_sessions",
    ]);
    if (syncSummary.hydratedDocs > 0 || syncSummary.seededRemoteDocs > 0) {
      logger.info("Sincronizare Firestore la pornire finalizată", {
        module: "server",
        action: "firestore_startup_hydration",
        ...syncSummary,
      });
    }
  } catch (err) {
    logger.warn("Sincronizarea Firestore la pornire a fost omisă", {
      module: "server",
      action: "firestore_startup_hydration",
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    lifecycle.markReady();
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // Setup WebSocket connections for AI phone call module
  setupWebSocket(server);

  // Initialize offline / background Web Push notification listener for upcoming viewings
  const stopBackgroundNotifications = setupBackgroundNotifications();

  // Start Phase 9 lightweight 5-minute Firestore telemetry rollup flusher (zero writes on idle)
  TelemetryCollectorService.startPeriodicFlusher();

  // Graceful SIGTERM/SIGINT draining for Cloud Run zero-downtime deploys and scaling
  attachGracefulShutdown({
    server,
    lifecycle,
    cleanupTasks: [
      {
        name: "telemetry-rollup-flusher",
        run: async () => {
          TelemetryCollectorService.stopPeriodicFlusher();
          await TelemetryCollectorService.flushRollups().catch(() => {});
        },
      },
      {
        name: "background-notifications",
        run: () => {
          if (typeof stopBackgroundNotifications === "function") {
            stopBackgroundNotifications();
          }
        },
      },
      ...(vite
        ? [
            {
              name: "vite-dev-server",
              run: async () => {
                await vite.close();
              },
            },
          ]
        : []),
    ],
  });
}

startServer();
