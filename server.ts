import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { spawn } from "child_process";
import axios from "axios";
import { convert } from "html-to-text";
import * as cheerio from "cheerio";
import { aiCallRouter, setupWebSocket } from "./server/ai-call/router";
import { setupBackgroundNotifications, registerNotificationRoutes } from "./server/background-notifications";
import { serverExtractBasicData, serverExtractData } from "./server/geminiService";
import crypto from "crypto";
import { mwAuthentication } from "./server/middleware/mw_authentication";
import { safeAxiosGet, safeFetchExternal, validateSafeExternalUrl, DEFAULT_MAX_EXTERNAL_BYTES } from "./server/security/sec_url-validator";
import { createRateLimiter } from "./server/middleware/mw_rate-limiter";
import { mwObservability } from "./server/middleware/mw_observability";
import { logger } from "./src/core/logger/logger";
import { sanitizePublicProperty } from "./server/security/sec_public-sanitizer";
import {
  createPublicImageToken,
  verifyPublicImageToken,
  resolveInlinePublicDataUrl,
  applyPublicImageProtections,
} from "./server/security/sec_public-media";
import { detectImageMagicBytes } from "./server/security/sec_image-validator";
import { detectLogoBoxes, inpaintLogoBox } from "./server/security/sec_logo-inpainter";
import {
  createThumbnail,
  parseThumbnailWidth,
  shouldServeWebp,
} from "./server/utils/img_thumbnail";
import { assertProductionEnvironment } from "./src/core/env/svc_production-config";
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
import { normalizeTitleAutomationRule, TitleAutomationRule } from "./src/core/automation/typ_title-automation";
import { CrmTenantStoreService } from "./src/core/crm/svc_crm-tenant-store";
import { CloudStorageService } from "./src/core/storage/svc_cloud-storage";
import { TenantResolutionService } from "./src/core/tenancy/svc_tenant-resolution";
import { TenantMembershipService } from "./src/core/tenancy/svc_tenant-membership";
import { PreviewSessionService } from "./src/core/tenancy/svc_preview-session";
import { BillingManager } from "./src/core/subscription/svc_billing-manager";


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
}
const imageCleanCache = new Map<string, CleanedImageCacheEntry>();
const pendingImageCleans = new Map<string, Promise<CleanedImageCacheEntry | null>>();

function addToImageCache(url: string, entry: CleanedImageCacheEntry) {
  if (imageCleanCache.size > 500) {
    const keys = Array.from(imageCleanCache.keys());
    for (let idx = 0; idx < 100; idx++) {
      imageCleanCache.delete(keys[idx]);
    }
  }
  imageCleanCache.set(url, entry);
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

async function cleanImageWatermarks(buffer: Buffer, mimeType: string, imageUrl: string): Promise<Buffer> {
  if (!mimeType.startsWith("image/") || mimeType.includes("svg")) {
    return buffer;
  }

  try {
    const isWebP = mimeType.includes("webp") || 
      (buffer.length > 12 && buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 && buffer.toString("ascii", 8, 12) === "WEBP");
    const isAvif = mimeType.includes("avif");

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
    } catch (jimpReadErr: any) {
      // If Jimp fails on raw buffer, convert to standard PNG via ImageMagick
      try {
        const fallbackPng = await execConvert(["-", "png:-"], buffer);
        image = await Jimp.read(fallbackPng);
      } catch (imErr: any) {
        console.warn("[Watermark Remover] Fallback conversion failed:", imErr?.message);
        return buffer;
      }
    }

    const { width, height } = image;

    // Skip tiny images
    if (width < 200 || height < 200) {
      return buffer;
    }

    // Detect overlaid logos strictly without AI; if no logo is present, return original image untouched
    const logoBoxes = detectLogoBoxes(image);
    if (logoBoxes.length === 0) {
      return buffer;
    }

    for (const box of logoBoxes) {
      console.log(`[Logo Inpainter] Inpainting detected logo area (${imageUrl}): x=${box.startX}, y=${box.startY}, w=${box.w}, h=${box.h}`);
      inpaintLogoBox(image, box);
    }

    // Verification pass: ensure no secondary/adjacent watermark fragment remains after first pass
    const residualBoxes = detectLogoBoxes(image);
    if (residualBoxes.length > 0) {
      for (const box of residualBoxes) {
        console.log(`[Logo Inpainter] Second-pass inpainting residual area (${imageUrl}): x=${box.startX}, y=${box.startY}, w=${box.w}, h=${box.h}`);
        inpaintLogoBox(image, box);
      }
    }

    const cleanedPngBuffer = await image.getBuffer("image/png" as any);
    if (isWebP) {
      try {
        const cleanedWebp = await execConvert(["png:-", "-quality", "92", "webp:-"], cleanedPngBuffer);
        return cleanedWebp;
      } catch (convErr: any) {
        return cleanedPngBuffer;
      }
    }

    if (mimeType.includes("jpeg") || mimeType.includes("jpg")) {
      return await image.getBuffer("image/jpeg" as any);
    }
    return cleanedPngBuffer;
  } catch (err: any) {
    console.warn(`[Watermark Remover] Fallback serving original:`, err?.message);
    return buffer;
  }
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
  options: { skipClean?: boolean; maxAttempts?: number; timeoutMs?: number } = {}
): Promise<CleanedImageCacheEntry> {
  const cleanUrl = normalizeCleanImageUrl(rawUrl);
  const skipClean = Boolean(options.skipClean);

  if (!skipClean && imageCleanCache.has(cleanUrl)) {
    return imageCleanCache.get(cleanUrl)!;
  }

  if (!skipClean && pendingImageCleans.has(cleanUrl)) {
    const shared = await pendingImageCleans.get(cleanUrl)!;
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

        if (!skipClean) {
          finalData = await cleanImageWatermarks(rawBuffer, finalContentType, cleanUrl);
          finalContentType = detectImageMagicBytes(finalData)?.mime || finalContentType;
          addToImageCache(cleanUrl, { mimeType: finalContentType, data: finalData });
        }

        return { mimeType: finalContentType, data: finalData };
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

  if (skipClean) {
    return runWork();
  }

  const sharedPromise = runWork()
    .catch((err) => {
      pendingImageCleans.delete(cleanUrl);
      throw err;
    })
    .then((entry) => {
      pendingImageCleans.delete(cleanUrl);
      return entry;
    });
  pendingImageCleans.set(cleanUrl, sharedPromise);
  return sharedPromise;
}

async function preCleanCrawlImages(urls: string[]): Promise<string[]> {
  if (!urls || urls.length === 0) return [];
  const concurrency = 6;
  const deadline = Date.now() + 20000;
  const keepFlags = new Array<boolean>(urls.length).fill(true);
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= urls.length) break;
      if (Date.now() > deadline) continue;

      const u = urls[idx];
      if (!u || !u.startsWith("http")) continue;
      try {
        await fetchAndCleanExternalImage(u, { skipClean: false, maxAttempts: 2, timeoutMs: 8000 });
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
  return urls.filter((_, idx) => keepFlags[idx]);
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Trust reverse proxy (Cloud Run, Cloudflare, Nginx) so req.protocol, req.secure, and client IPs are accurate
  app.set('trust proxy', true);

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

    const rawHost = req.headers['x-forwarded-host'] || req.get('host') || 'app.highline.ro';
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

  const uploadsDir = path.resolve("./public/uploads");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  // Increase body size limit to 50mb for image uploads while preserving rawBody for webhook HMAC verification
  app.use(
    express.json({
      limit: "50mb",
      verify: (req: any, _res, buf) => {
        if (req.originalUrl === "/api/billing/webhook") {
          req.rawBody = buf;
        }
      },
    })
  );
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

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
  app.post("/api/upload-photo", mwAuthentication, async (req, res) => {
    try {
      const { dataUrl, base64, propertyId, fileName } = req.body;
      const raw = dataUrl || base64;
      if (!raw || typeof raw !== "string") {
        return res.status(400).json({ error: "Missing image data" });
      }

      // Resolve tenantId strictly on the server (never trust arbitrary client-supplied tenantId)
      const requestedTenantId =
        typeof req.body?.tenantId === "string" ? req.body.tenantId.trim() : "";
      let verifiedTenantId: string | null = null;

      const previewHeader = req.headers["x-preview-session"] as string | undefined;
      if (previewHeader) {
        const previewSession = PreviewSessionService.getSession(previewHeader);
        if (previewSession) {
          verifiedTenantId = previewSession.tenantId;
        }
      }

      if (!verifiedTenantId) {
        const rawHost = String(req.headers["x-forwarded-host"] || req.headers.host || "");
        const devOverride = (req.headers["x-tenant-override"] ||
          req.headers["x-tenant-domain"] ||
          req.query.simulate_tenant ||
          req.query.tenantDomain) as string | undefined;
        try {
          const resolved = TenantResolutionService.resolveDomain(rawHost, devOverride);
          if (resolved.tenantId && req.authUser) {
            TenantMembershipService.verifyMembership(
              resolved.tenantId,
              req.authUser.uid,
              req.authUser.email,
              req.authUser.emailVerified
            );
            verifiedTenantId = resolved.tenantId;
          }
        } catch {
          // Check single-membership fallback ONLY if user belongs to exactly one active tenant
          if (req.authUser) {
            const matchingTenants: string[] = [];
            for (const tenant of TenantResolutionService.getAllTenants()) {
              try {
                TenantMembershipService.verifyMembership(
                  tenant.id,
                  req.authUser.uid,
                  req.authUser.email,
                  req.authUser.emailVerified
                );
                matchingTenants.push(tenant.id);
              } catch {
                // Not a member
              }
            }
            if (matchingTenants.length === 1) {
              verifiedTenantId = matchingTenants[0];
            }
          }
        }
      }

      if (!verifiedTenantId) {
        return res
          .status(403)
          .json({ error: "Nu s-a putut verifica apartenența la o agenție activă pentru upload." });
      }

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

      const meta = await CloudStorageService.uploadObject({
        tenantId: verifiedTenantId,
        entityType: "properties",
        entityId,
        fileName: safeName,
        buffer: finalBuffer,
        declaredMimeType: finalDetected.mime,
        visibility: "public_listing",
        uploadedByUserId: req.authUser?.uid || "authenticated_user",
        isImageOnly: true,
      });

      const publicUrl = meta.publicUrl || `/api/storage/media/${meta.objectKey}`;
      res.json({
        success: true,
        url: publicUrl,
        storageKey: meta.objectKey,
        backend: meta.backend,
      });
    } catch (err: any) {
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

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
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
  app.post("/api/extract-basic", mwAuthentication, aiRouteLimiter, async (req, res) => {
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

      console.log(`[Server] Process /api/extract-basic for Title: ${finalTitle}`);
      const result = await serverExtractBasicData(finalContent, finalTitle, titleRule);
      res.json(result);
    } catch (e: any) {
      console.error("[Server] /api/extract-basic error:", e);
      res.status(500).json({ error: e.message || "Failed to extract basic data" });
    }
  });

  // API endpoint to extract full structured data using server-side Gemini
  app.post("/api/extract-data", mwAuthentication, aiRouteLimiter, async (req, res) => {
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

      console.log(`[Server] Process /api/extract-data for Property ID: ${propertyId || "GOL"}`);
      const result = await serverExtractData(finalContent, finalTitle, imageUrls, propertyId, propertyUrl, titleRule);
      res.json(result);
    } catch (e: any) {
      console.error("[Server] /api/extract-data error:", e);
      res.status(500).json({ error: e.message || "Failed to extract content data" });
    }
  });

  // API endpoint for optional on-demand AI generation of title and description
  app.post("/api/generate-ai-text", mwAuthentication, async (req, res) => {
    const generateLocalTemplateText = (body: any) => {
      const { category, transactionType, zone, price, specs, propertyId } = body;
      const cat = category || "Apartament";
      const z = zone || "București";
      const p = price || "N/A";
      const idStr = propertyId ? propertyId.trim() : "";
      const camere = specs?.detalii?.camere || "2";

      const title = `${cat} ${camere} camere | ${z} | Mutare imediată`;
      const transLabel = transactionType === "Închiriere" ? "ÎNCHIRIERE" : "VÂNZARE";

      const description = `📌 ID ${idStr}
🏡 ${title}

Proprietate spațioasă și luminoasă, situată în zona ${z}, oferind acces facil către toate punctele de interes din oraș.
Spațiul este ideal atât pentru locuință, cât și pentru investiție.

━━━━━━━━━━━━━━━━━━

⭐ AVANTAJE PRINCIPALE

-${specs?.detalii?.compartimentare || "decomandat"}
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

${p}${transactionType === "Închiriere" ? " / lună\n1 lună garanție\nComision 50% + TVA" : ""}
Disponibil imediat

━━━━━━━━━━━━━━━━━━

🤝 SUPORT ${transLabel}

-consultanță dedicată din partea agenției brokr
-asistență completă în întocmirea contractului și înregistrarea ANAF
-posibilitate de vizionare rapidă și flexibilă

📞 Pentru vizionare sau detalii suplimentare, contactează-ne telefonic.`;

      return { title, description };
    };

    try {
      const { category, transactionType, zone, price, specs, originalTitle, originalDescription, propertyId } = req.body;
      if (!process.env.GEMINI_API_KEY) {
        return res.json(generateLocalTemplateText(req.body));
      }

      const prompt = `
ESTI UN EXPERT IMOBILIAR DE TOP.
Sarcina ta este să generezi un TITLU și o DESCRIERE DE MARKETING conform regulilor stricte de mai jos.

DATE PROPRIETATE:
- Categorie: ${category || "Apartament"}
- Tip Tranzacție: ${transactionType || "Vânzare"}
- Zonă: ${zone || "București"}
- Preț: ${price || "N/A"}
- ID Proprietate: ${propertyId ? propertyId.trim() : ""}
- Specificații tehnice: ${JSON.stringify(specs || {})}
- Titlu original: "${originalTitle || ""}"
- Descriere originală: "${(originalDescription || "").substring(0, 3000)}"

REGULI STRICTE MANDATATE:
1. TITLUL IDENTIC: Titlul din câmpul 'title' TREBUIE să fie ABSOLUT IDENTIC cu titlul din corpul descrierii (situat pe linia direct de sub 📌 ID, după emojiul 🏡 sau 🏢).
2. STRUCTURĂ TITLU: Tip imobil + număr camere/încăperi sau suprafață mp | Zonă | Pct. de interes | Pct forte imobil | Dotări | Parcare. Titlul TREBUIE să aibă SUB 70 de caractere.
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
  "title": "Titlul proprietatii sub 70 caractere",
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
      if (!text) throw new Error("Nu s-a primit niciun răspuns de la Gemini");
      const parsed = JSON.parse(text);
      res.json(parsed);
    } catch (e: any) {
      const errStr = e?.message || String(e || "");
      if (!errStr.includes("402") && !errStr.includes("RESOURCE_EXHAUSTED") && !errStr.includes("prepayment credits")) {
        console.warn("[Server] /api/generate-ai-text failed (using local template fallback):", errStr);
      }
      const fallback = generateLocalTemplateText(req.body);
      res.json(fallback);
    }
  });

  // Helper function to fetch public property data: checks tenant-scoped store first, then tenant Firestore subcollections, then legacy root fallback
  async function fetchPropertyById(id: string): Promise<any> {
    const tenantLocalProp = await CrmTenantStoreService.findPublicPropertyAcrossTenants(id);
    if (tenantLocalProp) {
      return tenantLocalProp;
    }

    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (!fs.existsSync(configPath)) {
      return null;
    }
    const fbConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const dbId = fbConfig.firestoreDatabaseId || "(default)";

    const googleToken = await PersistentStoreService.getGoogleAccessToken();
    const requestHeaders: Record<string, string> = {};
    let authQuery = "";
    if (googleToken) {
      requestHeaders.Authorization = `Bearer ${googleToken}`;
    } else if (fbConfig.apiKey) {
      authQuery = `?key=${fbConfig.apiKey}`;
    }

    let docData: any = null;
    let docId = id;

    // 1. Check tenant-scoped Firestore subcollections first when server OAuth token is present
    if (googleToken) {
      for (const tenant of TenantResolutionService.getAllTenants()) {
        try {
          const tenantDocUrl = `https://firestore.googleapis.com/v1/projects/${fbConfig.projectId}/databases/${dbId}/documents/tenants/${encodeURIComponent(tenant.id)}/leads/${encodeURIComponent(id)}`;
          const tRes = await axios.get(tenantDocUrl, { headers: requestHeaders, timeout: 6000 });
          if (tRes.data) {
            docData = tRes.data;
            break;
          }
        } catch {
          // Continue searching next tenant or propertyId query
        }
      }
    }

    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${fbConfig.projectId}/databases/${dbId}/documents/leads/${encodeURIComponent(id)}${authQuery}`;

    if (!docData) {
      try {
        const response = await axios.get(firestoreUrl, { headers: requestHeaders, timeout: 8000 });
        if (response.data) {
          docData = response.data;
        }
      } catch (directErr: any) {
        if (directErr.response && directErr.response.status === 404) {
          try {
            const queryUrl = `https://firestore.googleapis.com/v1/projects/${fbConfig.projectId}/databases/${dbId}/documents:runQuery${authQuery}`;
            const queryBody = {
              structuredQuery: {
                from: [{ collectionId: "leads" }],
                where: {
                  fieldFilter: {
                    field: { fieldPath: "propertyId" },
                    op: "EQUAL",
                    value: { stringValue: id }
                  }
                },
                limit: 1
              }
            };
            const queryRes = await axios.post(queryUrl, queryBody, { headers: requestHeaders, timeout: 8000 });
            if (Array.isArray(queryRes.data) && queryRes.data[0]?.document) {
              docData = queryRes.data[0].document;
              const nameParts = (docData.name || "").split("/");
              docId = nameParts[nameParts.length - 1] || id;
            }
          } catch (queryErr: any) {
            console.warn("[Server] propertyId fallback query failed:", queryErr.message);
          }
        } else {
          throw directErr;
        }
      }
    }

    if (!docData) return null;

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

    const result: any = { id: docId };
    const fields = docData.fields || {};
    for (const k of Object.keys(fields)) {
      result[k] = parseValue(fields[k]);
    }
    return result;
  }

  // Public property endpoint for shared property links (strictly strips private owner PII & source URLs, tokenizes images)
  app.get("/api/public-property/:id", async (req, res) => {
    try {
      const { id } = req.params;
      if (!id) return res.status(400).json({ error: "Property ID required" });

      const property = await fetchPropertyById(id);
      if (!property) {
        return res.status(404).json({ error: "Property not found" });
      }

      const clientIp =
        String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "anon")
          .split(",")[0]
          .trim();
      const viewerSid = crypto.createHash("sha256").update(`${clientIp}:${Date.now()}:${crypto.randomUUID()}`).digest("hex").slice(0, 12);
      const ipHash = crypto.createHash("sha256").update(clientIp).digest("hex").slice(0, 6).toUpperCase();
      const nowTime = new Date().toISOString().slice(11, 16).replace(":", "");
      const viewerStamp = `${ipHash}-${nowTime}`;
      const propCode = String(property.propertyId || id).slice(0, 10).toUpperCase();

      const tokenizeImageUrl = (rawUrl: string): string => {
        const token = createPublicImageToken({
          sourceUrl: rawUrl,
          propertyId: propCode,
          viewerSid,
          viewerStamp,
          ttlMs: 15 * 60 * 1000,
        });
        return `/api/public-image?token=${encodeURIComponent(token)}`;
      };

      const sanitized = sanitizePublicProperty(property, { tokenizeImageUrl });
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
      res.setHeader("X-Robots-Tag", "noindex, noimageindex, noarchive");
      res.json({
        ...sanitized,
        publicProtection: {
          viewerStamp,
          expiresAt: Date.now() + 15 * 60 * 1000,
        },
      });
    } catch (e: any) {
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

    let sourceUrl = verified.payload.u;
    if (sourceUrl.startsWith("inline:")) {
      const resolvedDataUrl = resolveInlinePublicDataUrl(sourceUrl);
      if (!resolvedDataUrl) {
        return res.status(404).json({ error: "Protected inline image expired" });
      }
      sourceUrl = resolvedDataUrl;
    }

    // Unwrap proxy-image wrapper if present
    if (sourceUrl.includes("/api/proxy-image")) {
      try {
        const parsed = new URL(sourceUrl, "https://placeholder.local");
        const inner = parsed.searchParams.get("url");
        if (inner) sourceUrl = inner;
      } catch {
        // ignore parse error
      }
    }

    try {
      let rawBuffer: Buffer | null = null;

      if (sourceUrl.startsWith("data:image/")) {
        const parts = sourceUrl.split(",");
        if (parts.length === 2) {
          rawBuffer = Buffer.from(parts[1], "base64");
        }
      } else if (sourceUrl.startsWith("/api/storage/media/")) {
        const objectKey = sourceUrl.replace(/^\/api\/storage\/media\//, "").split("?")[0];
        const { buffer } = await CloudStorageService.downloadObject({
          objectKey,
          allowPublicListing: true,
        });
        rawBuffer = buffer;
      } else if (sourceUrl.startsWith("/uploads/")) {
        const relName = path.basename(sourceUrl.split("?")[0]);
        const localPath = path.join(uploadsDir, relName);
        if (fs.existsSync(localPath)) {
          rawBuffer = fs.readFileSync(localPath);
        }
      } else if (/^https?:\/\//i.test(sourceUrl)) {
        const cleanUrl = normalizeCleanImageUrl(sourceUrl);
        await validateSafeExternalUrl(cleanUrl);
        const validationError = getCleanImageValidationError(cleanUrl);
        if (validationError) {
          return res.status(400).json({ error: validationError });
        }
        const entry = await fetchAndCleanExternalImage(cleanUrl, { maxAttempts: 3, timeoutMs: 8000 });
        rawBuffer = entry.data;
      }

      if (!rawBuffer || rawBuffer.length === 0) {
        return res.status(404).json({ error: "Image not found" });
      }

      const targetWidth = parseThumbnailWidth(req.query.w);
      const preferWebp = shouldServeWebp(req.headers.accept, req.query.format);
      const protectedImg = await applyPublicImageProtections(rawBuffer, {
        cacheKey: verified.payload.u,
        propertyCode: verified.payload.p || "BROKR",
        viewerStamp: verified.payload.st || "PUBLIC",
        maxWidth: targetWidth,
        preferWebp,
      });

      res.setHeader("Content-Type", protectedImg.mimeType);
      res.setHeader("Vary", "Accept");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("X-Robots-Tag", "noindex, noimageindex");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      return res.send(protectedImg.buffer);
    } catch (err: any) {
      console.warn("[Server] /api/public-image error:", err?.message || err);
      return res.status(502).json({ error: "Failed to serve protected public image" });
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

  // In-memory cache for OpenGraph preview thumbnails (optimized JPEG, < 300KB)
  const ogImageMemoryCache = new Map<string, { buffer: Buffer; mimeType: string; timestamp: number }>();

  // Helper to serve default brokr OpenGraph banner
  function serveDefaultOgBanner(res: express.Response) {
    const defaultPaths = [
      path.resolve("./public/og-default.jpg"),
      path.join(__dirname, "public", "og-default.jpg"),
      path.resolve("./dist/og-default.jpg"),
      path.join(__dirname, "og-default.jpg")
    ];
    for (const p of defaultPaths) {
      if (fs.existsSync(p)) {
        res.setHeader("Content-Type", "image/jpeg");
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.sendFile(p);
      }
    }
    return res.status(404).send("Default OG banner not found");
  }

  // Dedicated OpenGraph image endpoint for WhatsApp, Facebook, iMessage, and Twitter
  // Generates or serves cached standard 1200x630 JPEG images with 100% crawler compatibility
  app.get(["/api/og-image/:id", "/api/og-image/:id.jpg", "/api/og-image/:id.png"], async (req, res) => {
    let { id } = req.params;
    if (id) {
      id = id.replace(/\.(jpg|jpeg|png|webp)$/i, "");
    }

    if (!id) {
      return serveDefaultOgBanner(res);
    }

    // 1. Serve from in-memory cache if available (instant < 5ms response for crawlers)
    const cached = ogImageMemoryCache.get(id);
    if (cached && (Date.now() - cached.timestamp < 1000 * 60 * 60 * 24)) {
      res.setHeader("Content-Type", cached.mimeType);
      res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400, immutable");
      return res.send(cached.buffer);
    }

    try {
      const property = await fetchPropertyById(id);
      
      // Collect candidate image URLs in priority order
      const candidateUrls: string[] = [];
      if (property?.coverImage) candidateUrls.push(property.coverImage);
      if (Array.isArray(property?.images)) {
        property.images.forEach((img: any) => {
          if (typeof img === "string" && img) candidateUrls.push(img);
        });
      }
      if (property?.extractedData?.crmData?.imagini) {
        const crmImagini = property.extractedData.crmData.imagini;
        const categories = ["living", "camera", "bucatarie", "baie", "alteSpatii"] as const;
        for (const cat of categories) {
          const list = crmImagini[cat];
          if (Array.isArray(list)) {
            for (const item of list) {
              const u = typeof item === "string" ? item : (item?.original || "");
              if (u) candidateUrls.push(u);
            }
          }
        }
      }

      let rawBuffer: Buffer | null = null;
      let contentType = "image/jpeg";
      let chosenUrl = "";

      for (let rawUrl of candidateUrls) {
        if (!rawUrl || typeof rawUrl !== "string") continue;
        
        // Unwrap proxy URL if present
        if (rawUrl.includes("/api/proxy-image")) {
          try {
            const u = new URL(rawUrl, "https://placeholder.local");
            const extracted = u.searchParams.get("url");
            if (extracted) rawUrl = extracted;
          } catch (e) {}
        }

        // Handle base64 dataUrl
        if (rawUrl.startsWith("data:image/")) {
          try {
            const parts = rawUrl.split(",");
            if (parts.length === 2) {
              rawBuffer = Buffer.from(parts[1], "base64");
              const mimeMatch = parts[0].match(/:(.*?);/);
              contentType = mimeMatch ? mimeMatch[1] : "image/jpeg";
              chosenUrl = rawUrl;
              break;
            }
          } catch (e) {}
        }

        // Handle migrated cloud storage listing media URLs
        if (rawUrl.startsWith("/api/storage/media/")) {
          try {
            const objectKey = rawUrl.replace(/^\/api\/storage\/media\//, "").split("?")[0];
            const { buffer, metadata } = await CloudStorageService.downloadObject({
              objectKey,
              allowPublicListing: true,
            });
            rawBuffer = buffer;
            contentType = metadata.mimeType || "image/jpeg";
            chosenUrl = rawUrl;
            break;
          } catch {
            // Continue to next candidate URL
          }
        }

        // Handle local uploads (prevent path traversal outside uploadsDir)
        if (rawUrl.startsWith("/uploads/")) {
          const localPath = path.resolve("./public" + rawUrl);
          if (localPath.startsWith(uploadsDir + path.sep) && fs.existsSync(localPath)) {
            rawBuffer = fs.readFileSync(localPath);
            contentType = rawUrl.endsWith(".png") ? "image/png" : "image/jpeg";
            chosenUrl = rawUrl;
            break;
          }
        }

        // Handle external HTTP/HTTPS images with SSRF guard
        if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
          try {
            const response = await safeFetchExternal(rawUrl, {
              responseType: "arraybuffer",
              timeout: 4500,
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
                "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
              }
            });
            if (response.status === 200 && response.data) {
              rawBuffer = Buffer.isBuffer(response.data) ? response.data : Buffer.from(response.data);
              const rawCt = response.headers["content-type"];
              contentType = Array.isArray(rawCt) ? String(rawCt[0]) : (typeof rawCt === "string" ? rawCt : "image/jpeg");
              chosenUrl = rawUrl;
              break;
            }
          } catch (fetchErr) {
            // Continue to next candidate URL
          }
        }
      }

      if (!rawBuffer) {
        return serveDefaultOgBanner(res);
      }

      let processedBuffer = rawBuffer;
      try {
        // Clean watermark using detailed non-AI inpainting if present
        processedBuffer = await cleanImageWatermarks(rawBuffer, contentType, chosenUrl);
        let jimpBuffer = processedBuffer;
        const isWebP = jimpBuffer.length > 12 && jimpBuffer[0] === 0x52 && jimpBuffer[1] === 0x49 && jimpBuffer[2] === 0x46 && jimpBuffer[3] === 0x46 && jimpBuffer.toString("ascii", 8, 12) === "WEBP";
        if (isWebP) {
          try {
            jimpBuffer = await execConvert(["-", "png:-"], processedBuffer);
          } catch (e) {}
        }
        const img = await Jimp.read(jimpBuffer);
        
        // Scale to fit landscape dimensions (strict WhatsApp < 300KB thumbnail requirement)
        if (img.width > 750 || img.height > 470) {
          img.scaleToFit({ w: 750, h: 470 });
        }
        processedBuffer = await img.getBuffer("image/jpeg" as any);
        if (processedBuffer.length > 295000) {
          img.scaleToFit({ w: 640, h: 400 });
          processedBuffer = await img.getBuffer("image/jpeg" as any);
        }
      } catch (procErr: any) {
        console.warn(`[OG Image] Jimp optimization warning:`, procErr?.message);
        try {
          const fallbackImg = await Jimp.read(rawBuffer);
          fallbackImg.scaleToFit({ w: 640, h: 400 });
          processedBuffer = await fallbackImg.getBuffer("image/jpeg" as any);
        } catch (e) {
          processedBuffer = rawBuffer;
        }
      }

      if (ogImageMemoryCache.size >= 100) {
        const oldestKey = ogImageMemoryCache.keys().next().value;
        if (oldestKey !== undefined) ogImageMemoryCache.delete(oldestKey);
      }
      ogImageMemoryCache.set(id, { buffer: processedBuffer, mimeType: "image/jpeg", timestamp: Date.now() });
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Content-Length", String(processedBuffer.length));
      res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400, immutable");
      return res.send(processedBuffer);
    } catch (err: any) {
      console.warn(`[OG Image] Error generating preview image for property ${id}:`, err?.message);
      return serveDefaultOgBanner(res);
    }
  });

  // OpenGraph SSR route for rich link previews on WhatsApp, Facebook, iMessage, and Twitter
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

      const property = await fetchPropertyById(id);

      const title = property?.extractedData?.crmData?.descriere?.titlu || property?.title || "Proprietate Imobiliară • brokr.";
      let description = property?.extractedData?.crmData?.descriere?.continut || property?.description || "Proprietate imobiliară prezentată de brokr.";
      description = description.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
      if (description.length > 200) {
        description = description.substring(0, 197) + "...";
      }

      // Canonical URLs with guaranteed https protocol in production
      const baseUrl = getBaseUrl(req);
      const shareUrl = `${baseUrl}${req.path}`;
      const ogImageUrl = `${baseUrl}/api/og-image/${id}.jpg`;

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
            } catch (err) {
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

      const esc = (s: string) => String(s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

      const ogTags = `
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${esc(shareUrl)}" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:image" content="${esc(ogImageUrl)}" />
    <meta property="og:image:secure_url" content="${esc(ogImageUrl)}" />
    <meta property="og:image:type" content="image/jpeg" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${esc(title)}" />
    <meta property="og:site_name" content="brokr." />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(title)}" />
    <meta name="twitter:description" content="${esc(description)}" />
    <meta name="twitter:image" content="${esc(ogImageUrl)}" />
      `.trim();

      // WhatsApp / Facebook / Twitter crawlers parse only the first ~10KB-50KB of HTML.
      // Insert the OpenGraph tags right after <head> so crawlers immediately find them.
      html = html.replace(/<title>[\s\S]*?<\/title>/gi, '');
      html = html.replace(/<meta\s+name=["']description["'][^>]*>/gi, '');
      html = html.replace(/<meta\s+property=["']og:[^"']+["'][^>]*>/gi, '');
      html = html.replace(/<meta\s+name=["']twitter:[^"']+["'][^>]*>/gi, '');

      html = html.replace(/<head[^>]*>/i, (match) => `${match}\n${ogTags}\n`);

      res.setHeader("Content-Type", "text/html; charset=utf-8");
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

  // Helper to extract price, phone number, and owner name from storia.ro or olx.ro HTML snippets
  function extractListingDetails(html: string, url: string = "") {
    const $ = cheerio.load(html || "");
    
    let source: "storia" | "olx" | null = null;
    if (url.includes("storia.ro") || $('[data-cy*="storia"]').length > 0 || $('[data-sentry-component]').length > 0) {
      source = "storia";
    } else if (url.includes("olx.ro") || $('[data-testid*="ad"]').length > 0 || $('[data-nx-name]').length > 0) {
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
      const priceEl = $('div[data-testid="ad-price-container"] h3').first()
        .add('[data-testid="ad-price-container"]').first()
        .add('h3[data-nx-name="H3"]').first();
      if (priceEl.length) rawPrice = priceEl.text();

      const phoneEl = $('a[data-testid="contact-phone"]').first()
        .add('button[data-testid="ad-contact-phone"] a[href^="tel:"]').first()
        .add('button[data-cy="ad-contact-phone"] a').first();
      if (phoneEl.length) {
        rawPhone = phoneEl.attr("href")?.replace("tel:", "") || phoneEl.text();
      } else {
        const telHref = $('a[href^="tel:"]').first().attr("href");
        if (telHref) rawPhone = telHref.replace("tel:", "");
      }

      const ownerEl = $('h4[data-testid="user-profile-user-name"]').first()
        .add('h4[data-nx-name="H4"]').first();
      if (ownerEl.length) rawOwner = ownerEl.text();
    }

    if (!rawPrice) {
      const fallbackPrice = $('strong[data-cy="adPageHeaderPrice"], div[data-testid="ad-price-container"] h3, [data-sentry-element="Price"]').first();
      if (fallbackPrice.length) rawPrice = fallbackPrice.text();
    }
    if (!rawPhone) {
      const fallbackPhone = $('a[data-cy="phone-number.number-button"], a[data-testid="contact-phone"], a[href^="tel:"]').first();
      if (fallbackPhone.length) {
        rawPhone = fallbackPhone.attr("href")?.replace("tel:", "") || fallbackPhone.text();
      }
    }
    if (!rawOwner) {
      const fallbackOwner = $('p.truncate.font-bold, h4[data-testid="user-profile-user-name"]').first();
      if (fallbackOwner.length) rawOwner = fallbackOwner.text();
    }

    return {
      source: source || null,
      price: cleanPrice(rawPrice),
      phone_number: normalizeText(rawPhone),
      owner_name: normalizeText(rawOwner)
    };
  }

  app.post("/api/parse-listing-html", mwAuthentication, (req, res) => {
    try {
      const { html, url } = req.body;
      const result = extractListingDetails(html || "", url || "");
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ source: null, price: null, phone_number: null, owner_name: null });
    }
  });

  // API endpoint for crawling
  app.post("/api/crawl", mwAuthentication, crawlRouteLimiter, async (req, res, next) => {
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

    // Fast path for CRM share links (/share/:id or /p/:id) backed by our persistent store
    try {
      const sharePathMatch = new URL(url).pathname.match(/^\/(?:share|p)\/([A-Za-z0-9_-]+)\/?$/i);
      if (sharePathMatch?.[1]) {
        const sharedProp = await fetchPropertyById(sharePathMatch[1]);
        if (sharedProp) {
          const authTenantId = (req as any).auth?.tenantId;
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

    // Fast, resilient crawling with controlled timeouts & HTTP/2 fallback
    for (let i = 0; i < crawlHeaderProfiles.length; i++) {
      try {
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

        const html = typeof response.data === "string" ? response.data : String(response.data || "");
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

        const $ = cheerio.load(html);

        // Structured states (Storia __NEXT_DATA__, OLX __PRERENDERED_STATE__, JSON-LD)
        let nextAdData: any = null;
        $("script#__NEXT_DATA__").each((_, el) => {
          if (nextAdData) return;
          const htmlVal = $(el).html();
          if (htmlVal) {
            try {
              const parsed = JSON.parse(htmlVal);
              nextAdData = parsed?.props?.pageProps?.ad || parsed?.props?.pageProps?.advert || parsed?.props?.pageProps?.offer || parsed?.props?.pageProps?.listing || parsed?.props?.pageProps?.data || null;
            } catch {}
          }
        });

        const olxState = parseOlxPrerenderedState($);
        const olxAd: any = olxState?.ad?.ad || olxState?.ad || null;
        const olxBreadcrumbs: any[] = Array.isArray(olxState?.ad?.breadcrumbs) ? olxState.ad.breadcrumbs : [];

        const ogTitle = $('meta[property="og:title"]').attr("content") || $('meta[name="twitter:title"]').attr("content") || "";
        const ogDescription = $('meta[property="og:description"]').attr("content") || $('meta[name="description"]').attr("content") || "";
        const title = String(nextAdData?.title || olxAd?.title || ogTitle || $("title").text() || "No title found").trim();

        // Extract image URLs strictly for the target property (filtering out logos, layouts, and recommendations)
        const imageExtensions = /\.(jpeg|jpg|gif|png|webp|avif)/i;
        const socialMediaBlocked = ["facebook.com", "linkedin.com", "twitter.com", "instagram.com", "youtube.com", "pinterest.com", "tiktok.com"];
        const adKeywords = ["google-analytics", "ads.", "doubleclick", "/ads/", "/banners/"];

        // Helper to identify and reject icons, logos, badges, layouts, avatars, maps, buttons, etc.
        const isForbiddenGraphic = (urlStr: string): boolean => {
          const lower = urlStr.toLowerCase();
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

          // Imobiliare.ro & Roamcdn high-resolution promotions
          if (cleaned.includes("imobiliare.ro") || cleaned.includes("roamcdn")) {
            cleaned = cleaned
              .replace(/_(?:75x75|100x100|150x150|160x120|200x150|400x300|640x480)\.jpg/gi, "_800x600.jpg")
              .replace(/\/thumb\//gi, "/large/")
              .replace(/\/small\//gi, "/large/")
              .replace(/\/medium\//gi, "/large/");
            if (cleaned.toLowerCase().includes("roamcdn")) {
              cleaned = cleaned.replace(/gallery-[a-zA-Z0-9]+-watermark/gi, "gallery-full-1200w-watermark");
            }
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
        if ($mosaic.length > 0) {
          $mosaic.find("img, source, a, button, div, picture").each((_, el) => {
            const $el = $(el);
            const src = $el.attr("src");
            const dataSrc = $el.attr("data-src") || $el.attr("data-lazy") || $el.attr("data-full");
            const srcset = $el.attr("srcset") || $el.attr("data-srcset");
            const style = $el.attr("style");
            let candidates = [src, dataSrc];
            if (srcset) {
              candidates.push(...srcset.split(",").map(s => s.trim().split(" ")[0]));
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

        // Priority 1: Check __NEXT_DATA__ for the target property's dedicated photo gallery
        let nextDataTargetImages: string[] = [];
        const nextPhotoList = nextAdData?.photos || nextAdData?.images || nextAdData?.listingImages || nextAdData?.gallery || nextAdData?.media?.photos || nextAdData?.media?.images;
        if (Array.isArray(nextPhotoList) && nextPhotoList.length > 0) {
          nextPhotoList.forEach((item: any) => {
            let candidate = item?.large || item?.medium || item?.url || item?.thumbnail || item?.small || item?.src || (typeof item === "string" ? item : null);
            if (!candidate && item?.filename) {
              candidate = `https://apollo.olxcdn.com/v1/files/${item.filename}/image;s=1000x700`;
            }
            if (!candidate && item?.id && typeof item?.id === "string" && item.id.length > 5) {
              candidate = `https://apollo.olxcdn.com/v1/files/${item.id}/image;s=1000x700`;
            }
            if (candidate && typeof candidate === "string") {
              const promoted = promoteToHighRes(candidate);
              if (!isForbiddenGraphic(promoted) && !blockedAgencyPaths.has(getBaseUrlPath(promoted))) {
                nextDataTargetImages.push(promoted);
              }
            }
          });
        }

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
          mosaicGalleryImages.length > 0 || nextDataTargetImages.length > 0 || olxPhotos.length > 0;

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
              const sources = srcset.split(",").map(s => s.trim().split(" ")[0]);
              candidates = [...candidates, ...sources];
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

        const rawCandidates = hasStructuredGallery
          ? [...mosaicGalleryImages, ...nextDataTargetImages, ...olxPhotos]
          : [...jsonLdImages, ...domGalleryImages, ...ogImages];

        // Deduplicate images and keep highest resolution version
        const deduplicateImages = (urls: string[]) => {
          const map = new Map<string, string>();

          const getCanonical = (u: string) => {
            const base = u.split(/[?;]/)[0];
            // 1. OLX / Storia file ID or JWT token
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

            // 2. Filename cleaning (strip dimensions and responsive suffixes)
            const cleanFilename = filename
              .replace(/_\d+x\d+(?=\.[a-z]+)/i, "")
              .replace(/-(?:full|small|medium|thumb|large|mini|1200w|1600w|800w|400w|600w|300w)/gi, "");
            return `${parentFolder}-${cleanFilename}`.toLowerCase();
          };

          const getScore = (u: string) => {
            const lower = u.toLowerCase();
            let score = 0;
            if (lower.includes("1200w") || lower.includes("1600w")) score += 200;
            if (lower.includes("1000x700") || lower.includes("1280x") || lower.includes("900w")) score += 100;
            if (lower.includes("/extralarge/")) score += 80;
            if (lower.includes("800x600")) score += 50;
            if (lower.includes("/large/") || lower.includes("/galerie/")) score += 40;
            if (lower.includes("/medium/")) score += 20;
            if (lower.includes("/top/")) score += 10;
            if (lower.includes("/small/") || lower.includes("/thumb/") || lower.includes("140w")) score += 5;
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

        const dedupedImages = deduplicateImages(rawCandidates).slice(0, 50);
        const uniqueImages = await preCleanCrawlImages(dedupedImages);
        console.log(`Found ${dedupedImages.length} unique images (${uniqueImages.length} pre-checked & cleaned) for ${url}`);

        // Extract seller name explicitly if possible (Storia, OLX, DOM patterns)
        let sellerName = String(
          nextAdData?.owner?.name ||
          nextAdData?.contactDetails?.name ||
          olxAd?.contact?.name ||
          olxAd?.user?.name ||
          olxAd?.user?.company_name ||
          ""
        ).trim();

        if (!sellerName) {
          const sellerSelectors = [
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

        // Extract Phone Number explicitly if possible (Storia/OLX structured & API via HTTP/2)
        let sellerPhone = String(
          nextAdData?.contact?.phone ||
          nextAdData?.owner?.phones?.[0] ||
          olxAd?.contact?.phone ||
          olxAd?.phoneNumber ||
          ""
        ).trim();
        const isOLXOrStoria = url.includes("olx.ro") || url.includes("storia.ro");
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
                if (dataVal && Array.isArray(dataVal.phones) && dataVal.phones.length > 0) {
                  sellerPhone = String(dataVal.phones[0]).trim();
                } else if (phoneRes.data.value) {
                  sellerPhone = String(phoneRes.data.value).trim();
                } else if (Array.isArray(phoneRes.data) && phoneRes.data.length > 0) {
                  sellerPhone = String(phoneRes.data[0]).trim();
                }
                if (sellerPhone) break;
              }
            } catch (err: any) {
              console.log(`Phone lookup (${phonesUrl}) warning: ${err?.message}`);
            }
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

        // Robust phone number extraction fallback (from HTML attributes, JSON keys or regex matches)
        if (!sellerPhone || sellerPhone.includes("...") || sellerPhone.replace(/\D/g, "").length < 9) {
          const phoneCandidates: string[] = [];

          const jsonPhoneKeys = [
            /"telefon"\s*:\s*"([^"]+)"/gi,
            /"phone"\s*:\s*"([^"]+)"/gi,
            /"phoneNumber"\s*:\s*"([^"]+)"/gi,
            /"contact_phone"\s*:\s*"([^"]+)"/gi,
            /\\"[tT]elefon\\"\s*:\s*\\"[^"\d]*(\d+)[^"\d]*\\"/g,
            /\\"[pP]hone\\"\s*:\s*\\"[^"\d]*(\d+)[^"\d]*\\"/g,
            /data-telefon="([^"]+)"/gi,
            /data-phone="([^"]+)"/gi,
            /tel:([^"]+)/gi
          ];

          for (const regex of jsonPhoneKeys) {
            let match;
            while ((match = regex.exec(html)) !== null) {
              const rawVal = match[1];
              const cleaned = rawVal.replace(/[^\d+]/g, "").trim();
              if ((cleaned.startsWith("07") && cleaned.length === 10) ||
                  (cleaned.startsWith("407") && cleaned.length === 12) ||
                  (cleaned.startsWith("+407") && cleaned.length === 13)) {
                phoneCandidates.push(cleaned);
              }
            }
          }

          $("[data-telefon], [data-phone], [data-contacts], [data-contact], .phone, .telefon, a[href^='tel:']").each((_, el) => {
            const $el = $(el);
            const tel = $el.attr("data-telefon") || $el.attr("data-phone") || $el.attr("data-contact") || $el.text();
            const href = $el.attr("href");
            if (href && href.startsWith("tel:")) {
              phoneCandidates.push(href.replace("tel:", "").trim());
            }
            if (tel) {
              phoneCandidates.push(tel.trim());
            }
          });

          const romanianPhoneRegex = /(?:\+40|0)\s?7\d{2}[\s.-]?\d{3}[\s.-]?\d{3}\b/g;
          const phoneMatches: string[] = [...(html.match(romanianPhoneRegex) || []), ...(text.match(romanianPhoneRegex) || [])];
          if (phoneMatches) {
            for (const rawMatch of phoneMatches) {
              const cleaned = rawMatch.replace(/[^\d+]/g, "").trim();
              if (cleaned.startsWith("07") && cleaned.length === 10) {
                phoneCandidates.push(cleaned);
              } else if (cleaned.startsWith("407") && cleaned.length === 12) {
                phoneCandidates.push("0" + cleaned.substring(2));
              } else if (cleaned.startsWith("+407") && cleaned.length === 13) {
                phoneCandidates.push("0" + cleaned.substring(3));
              }
            }
          }

          if (phoneCandidates.length > 0) {
            const normalized = phoneCandidates.map(p => {
              const cleanStr = p.replace(/[^\d+]/g, "").trim();
              if (cleanStr.startsWith("+40")) return "0" + cleanStr.substring(3);
              if (cleanStr.startsWith("40")) return "0" + cleanStr.substring(2);
              return cleanStr;
            }).filter(p => p.startsWith("07") && p.length === 10);

            const uniquePhones = [...new Set(normalized)];
            if (uniquePhones.length > 0) {
              sellerPhone = uniquePhones[0];
            }
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

        // 2b. OLX ad.price (handles regularPrice + displayValue cleanly)
        if (rawPriceNum <= 0 && olxAd?.price) {
          const disp = String(olxAd.price.displayValue || "");
          const regVal = Number(olxAd.price.regularPrice?.value || 0);
          const regCurr = String(olxAd.price.regularPrice?.currencyCode || olxAd.price.regularPrice?.currencySymbol || "").toUpperCase();
          if (regVal > 0) {
            rawPriceNum = regVal;
            if (regCurr.includes("RON") || regCurr.includes("LEI")) currency = "RON";
          } else if (disp) {
            const dispDigits = parseInt(disp.replace(/[^0-9]/g, ""), 10) || 0;
            if (dispDigits > 0) {
              rawPriceNum = dispDigits;
              if (disp.toLowerCase().includes("lei") || disp.toLowerCase().includes("ron")) currency = "RON";
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

        // 4. City & Zone
        let oras = "București";
        let zona = "";

        if (nextAdData?.location?.city?.name) oras = nextAdData.location.city.name;
        if (nextAdData?.location?.district?.name) zona = nextAdData.location.district.name;

        const storiaLocations = Array.isArray(nextAdData?.location?.reverseGeocoding?.locations)
          ? nextAdData.location.reverseGeocoding.locations
          : [];
        for (const loc of storiaLocations) {
          if (loc?.locationLevel === "city" && loc?.name) oras = loc.name;
          if ((loc?.locationLevel === "district" || loc?.locationLevel === "quarter" || loc?.locationLevel === "subdistrict") && loc?.name) {
            zona = loc.name;
          }
        }

        if (olxAd?.location?.cityName) oras = olxAd.location.cityName;
        if (olxAd?.location?.districtName) zona = olxAd.location.districtName;

        if (!zona) {
          const secMatch = (title + " " + text).match(/Sector(?:ul)?\s*[1-6]/i);
          if (secMatch) {
            zona = secMatch[0];
          } else {
            const commonZones = [
              "Pipera", "Floreasca", "Dorobanti", "Aviatiei", "Baneasa", "Militari", "Drumul Taberei",
              "Titan", "Dristor", "Vitan", "Unirii", "Universitate", "Victoriei", "Tineretului",
              "Berceni", "Pantelimon", "Colentina", "Tei", "Crangasi", "Grozavesti", "Cotroceni",
              "Lujerului", "Gorjului", "Politehnica", "Obor", "Iancului", "Stefan cel Mare"
            ];
            for (const z of commonZones) {
              if (lowerCombo.includes(z.toLowerCase())) {
                zona = z;
                break;
              }
            }
          }
        }
        if (!zona) zona = oras;

        // 5. Specs (Surface, Rooms, Floor, Heating, Furnished)
        let suprafataUtila = "";
        let camere = "";
        let etaj = "";
        let anConstructie = "";
        let compartimentare = "Decomandat";
        let sistemIncalzire: string[] = ["Centrala proprie"];
        let climatizare: string[] = [];
        let mobilat = "Complet";

        // 5a. Storia characteristics
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

        // 5b. OLX params
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
            if (p.key === "furniture") mobilat = String(p.value || "Complet");
          }
        }

        if (!suprafataUtila) {
          const sMatch = text.match(/(?:suprafa[t\u021b\u0163]?[a\u0103]?\s*util[a\u0103]?|s\s*util[a\u0103]?|utila)\s*[:\-–]?\s*(\d+(?:[.,]\d+)?)\s*(?:mp|m2|m\u00b2)/i);
          if (sMatch) suprafataUtila = sMatch[1].replace(",", ".");
        }
        if (!camere) {
          const cMatch = text.match(/(?:num[a\u0103]r\s*camere|camere|nr\s*camere)\s*[:\-–]?\s*(\d+)/i) || title.match(/(\d+)\s*camere/i);
          if (cMatch) camere = cMatch[1];
          else if (lowerCombo.includes("garsonier") || lowerCombo.includes("studio")) camere = "1";
          else camere = "2";
        }
        if (!etaj) {
          const eMatch = text.match(/(?:etaj|etajul)\s*[:\-–]?\s*(parter|demisol|mansarda|\d+\/\d+|\d+)/i);
          if (eMatch) etaj = eMatch[1];
          else etaj = "1";
        }
        if (!anConstructie) {
          const aMatch = text.match(/(?:an\s*construc[t\u021b]ie|construit\s*[îi]n|an\s*bloc)\s*[:\-–]?\s*(\d{4})/i);
          if (aMatch) anConstructie = aMatch[1];
        }

        let balcoane = "";
        if (Array.isArray(nextAdData?.parameters)) {
          for (const p of nextAdData.parameters) {
            if (p.key === "balconies_num" || p.key === "balcony" || p.key === "balcoane") balcoane = String(p.value || "");
          }
        }
        if (!balcoane) {
          const bMatch = text.match(/(\d+)\s*balco?ane?/i);
          if (bMatch) balcoane = bMatch[1];
        }
        const balcoaneFinal = balcoane || "1";

        const numUtila = parseFloat(suprafataUtila) || 55;
        const mult = (categoria === "Apartament" || categoria === "Casa/Vila") ? 1.2 : 1.1;
        const suprafataConstruita = Math.round(numUtila * mult).toString();

        if (lowerCombo.includes("centrala proprie") || lowerCombo.includes("centrală proprie")) {
          sistemIncalzire = ["Centrala proprie"];
        } else if (lowerCombo.includes("termoficare") || lowerCombo.includes("centralizat") || lowerCombo.includes("radet")) {
          sistemIncalzire = ["Termoficare"];
        }

        if (lowerCombo.includes("aer conditionat") || lowerCombo.includes("aer condiționat") || lowerCombo.includes("climatizare")) {
          climatizare = ["Aer conditionat"];
        }

        if (lowerCombo.includes("semidecomandat")) compartimentare = "Semidecomandat";
        else if (lowerCombo.includes("open space") || lowerCombo.includes("openspace")) compartimentare = "Open space";
        else if (lowerCombo.includes("circular")) compartimentare = "Circular";
        else if (lowerCombo.includes("nedecomandat")) compartimentare = "Nedecomandat";

        if (lowerCombo.includes("nemobilat")) mobilat = "Nemobilat";
        else if (lowerCombo.includes("partial mobilat")) mobilat = "Partial";

        // 6. Original Description
        let rawDescription = "";
        if (nextAdData?.description) {
          rawDescription = convert(nextAdData.description, { wordwrap: false });
        } else if (olxAd?.description) {
          rawDescription = String(olxAd.description).trim();
        } else {
          const descSelectors = [
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
            rawDescription = ogDescription || text.substring(0, 3000);
          }
        }

        const crawlTitleRule = resolveTitleAutomationRuleForReq(req);

        // Generate compliant property ad title using tenant automation rule (or AGENTS.md fallback)
        const automationSource = {
          transactionType,
          categoria,
          camere,
          suprafataUtila: suprafataUtila || numUtila,
          suprafataConstruita,
          etaj,
          zona,
          oras,
          compartimentare,
          sistemIncalzire: Array.isArray(sistemIncalzire) ? sistemIncalzire.join(", ") : sistemIncalzire,
          mobilat,
          balcoane: balcoaneFinal,
          rawTitle: title,
          rawText: rawDescription || text,
        };
        const cleanTitle = generateStandardAdTitle({
          ...automationSource,
          titleRule: crawlTitleRule,
        });

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
              zona: [zona],
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
              camere: String(camere),
              bucatarii: "1",
              dormitoare: String(Math.max(1, parseInt(camere) - 1 || 1)),
              bai: "1",
              balcoane: "0",
              terase: "0",
              etaj: String(etaj),
              orientare: "",
              parcari: "0",
              garaje: "0",
              checkList: []
            },
            suprafete: {
              utila: String(suprafataUtila || numUtila),
              amprenta: "",
              construita: suprafataConstruita,
              utilaTotala: String(suprafataUtila || numUtila),
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
            titlu: cleanTitle,
            continut: `📌 ID 
🏡 ${cleanTitle}

${suprafataUtila ? `${suprafataUtila} mp utili` : "Spațiu generos"}${balcoaneFinal && parseInt(String(balcoaneFinal), 10) > 0 ? ", balcon" : ""}, mobilat și utilat, disponibil imediat.
Proprietate luminoasă și bine compartimentată, situată în zona ${zona || oras}, cu acces facil la toate facilitățile urbane.

━━━━━━━━━━━━━━━━━━

⭐ AVANTAJE PRINCIPALE

-${compartimentare || "decomandat"}
-poziționare excelentă în zonă cu infrastructură completă
-lumină naturală generoasă și compartimentare eficientă
-acces rapid la mijloacele de transport în comun

━━━━━━━━━━━━━━━━━━

🛋️ DOTĂRI

-${Array.isArray(sistemIncalzire) && sistemIncalzire.length > 0 ? sistemIncalzire[0].toLowerCase() : "centrală proprie"}
-finisaje de calitate și spații optime de depozitare
-mobilat și utilat complet

Spațiul este foarte bine organizat și oferă confort ridicat pentru locuire.

━━━━━━━━━━━━━━━━━━

📍 LOCAȚIE

Acces rapid către:
-stații de transport în comun
-magazine, supermarketuri și servicii de proximitate
-parcuri și spații verzi în zonă

━━━━━━━━━━━━━━━━━━

💰 ${transactionType === "Închiriere" ? "ÎNCHIRIERE" : "VÂNZARE"}

${transactionType === "Închiriere" ? `${formattedPrice || "N/A"}\n1 lună garanție\nComision 50% + TVA\nDisponibil imediat` : `${formattedPrice || "N/A"}\nDisponibil imediat`}

━━━━━━━━━━━━━━━━━━

🤝 ${transactionType === "Închiriere" ? "SUPORT ÎNCHIRIERE" : "SUPORT VÂNZARE"}

-consultanță dedicată din partea agenției brokr
-asistență completă în întocmirea contractului și înregistrarea ANAF
-posibilitate de vizionare rapidă și flexibilă

📞 Pentru vizionare sau detalii suplimentare, contactează-ne telefonic.`.trim(),
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
            "Balcoane": balcoaneFinal,
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
        const finalPhone = (sellerPhone && sellerPhone !== "Nespecificat") ? sellerPhone : (listingDetails.phone_number || "Nespecificat");
        const finalOwner = (sellerName && sellerName !== "Nespecificat") ? sellerName : (listingDetails.owner_name || "Nespecificat");

        res.json({
          title: cleanTitle,
          price: finalPrice,
          zone: zona,
          oras: oras,
          ownerName: finalOwner,
          ownerPhone: finalPhone,
          transactionType: transactionType,
          categoria: categoria,
          description: rawDescription,
          specs: {
            utila: suprafataUtila || numUtila,
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

  // Batch discover & crawl newest listings from OLX.ro matching Lead-uri filter parameters
  app.post("/api/crawl-olx-leads", mwAuthentication, crawlRouteLimiter, async (req, res) => {
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
        const rawDesc = String(ad.description || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
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
        } else if (filters.transactionType) {
          transactionType = filters.transactionType;
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

        // Location
        const oras = String(ad?.location?.cityName || "București").trim();
        const zona = String(ad?.location?.districtName || ad?.location?.cityName || "București").trim();

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

        // Extract phone from description fallback if present
        const phoneMatch = rawDesc.match(/(?:\+40|0)\s?7\d{2}[\s.-]?\d{3}[\s.-]?\d{3}/);
        const descPhone = phoneMatch ? phoneMatch[0].replace(/[^\d+]/g, "") : "";
        const ownerName = String(ad?.user?.name || "Proprietar OLX").trim() || "Proprietar OLX";

        const olxTitleRule = resolveTitleAutomationRuleForReq(req);
        const olxAutomationSource = {
          transactionType,
          categoria,
          camere,
          suprafataUtila: suprafataUtila || "",
          suprafataConstruita,
          etaj,
          zona,
          oras,
          compartimentare,
          sistemIncalzire: "",
          mobilat: "",
          balcoane: "",
          rawTitle,
          rawText: `${rawTitle}\n${rawDesc}`,
        };

        const cleanTitle = generateStandardAdTitle({
          ...olxAutomationSource,
          titleRule: olxTitleRule,
        }) || rawTitle;

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
            titlu: cleanTitle,
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
          title: cleanTitle,
          zone: zona,
          price: formattedPrice,
          ownerName,
          ownerPhone: descPhone || "Nespecificat",
          transactionType,
          categoria,
          leadType: "Proprietar",
          coverImage: proxiedImages[0] || undefined,
          images: proxiedImages,
          notes: rawDesc ? rawDesc.substring(0, 1200) : rawTitle,
          extractedData: {
            crmData,
            originalDescription: rawDesc,
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

      const selectedBatch = matchedCandidates.slice(0, limit);

      // Enrich phone numbers quickly in small parallel chunks (non-blocking if OLX hides phone)
      const enrichPhone = async (item: ReturnType<typeof mapOlxAdToLeadCandidate>) => {
        if (item.ownerPhone && item.ownerPhone !== "Nespecificat") return item;
        if (!item.olxAdId) return item;
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
              if (found) {
                const phoneStr = String(found).trim();
                item.ownerPhone = phoneStr;
                if (item.extractedData?.crmData?.detaliiGenerale) {
                  item.extractedData.crmData.detaliiGenerale.contacteAditionale = phoneStr;
                }
                break;
              }
            }
          } catch {
            // Optional enrichment - fail silently
          }
        }
        return item;
      };

      const enrichedItems: any[] = [];
      for (let i = 0; i < selectedBatch.length; i += 8) {
        const chunk = selectedBatch.slice(i, i + 8);
        const settled = await Promise.allSettled(chunk.map(enrichPhone));
        settled.forEach((r, idx) => {
          const item = r.status === "fulfilled" ? r.value : chunk[idx];
          const { olxAdId, createdTime, ...cleanItem } = item;
          enrichedItems.push(cleanItem);
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
  app.post("/api/crawl-basic", mwAuthentication, crawlRouteLimiter, async (req, res, next) => {
    const { url } = req.body;
    if (!url || typeof url !== "string") return res.status(400).json({ error: "URL is required" });

    try {
      await validateSafeExternalUrl(url);
    } catch (ssrfErr: any) {
      return res.status(400).json({ error: ssrfErr?.message || "URL invalid sau blocat de politica SSRF." });
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
        const title = $("title").text() || "";
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

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

    const targetWidth = parseThumbnailWidth(req.query.w);
    const preferWebp = shouldServeWebp(req.headers.accept, req.query.format);

    try {
      const entry = await fetchAndCleanExternalImage(cleanUrl, { skipClean, maxAttempts: 3, timeoutMs: 8000 });
      let sendData = entry.data;
      let sendMime = entry.mimeType;

      if (targetWidth) {
        const thumb = await createThumbnail({
          buffer: sendData,
          mimeType: sendMime,
          targetWidth,
          preferWebp: !wantsJpeg && preferWebp,
          forceJpeg: wantsJpeg,
          cacheKey: `proxy::${cleanUrl}::clean=${!skipClean}`,
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

  // Prevent API fall-through to Vite/static fallback
  app.all("/api/*", (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` });
  });

  // Global error handler
  app.use((err: any, req: any, res: any, next: any) => {
    console.error("Global crash handler:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
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

  // Always serve static compiled assets from dist/assets if available (so /assets/... never 404s or returns HTML)
  if (distPath) {
    app.use("/assets", express.static(path.join(distPath, "assets")));
  }

  // In development, Vite handles on-the-fly compilation, module transformation, and SPA routing!
  if (!isProduction && vite) {
    app.use(vite.middlewares);
  } else if (distPath) {
    // In production, serve bundled static assets from dist
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
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
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // Setup WebSocket connections for AI phone call module
  setupWebSocket(server);

  // Initialize offline / background Web Push notification listener for upcoming viewings
  setupBackgroundNotifications();
}

startServer();
