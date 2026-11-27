/**
 * Dedicated Imobiliare.ro Gallery Photo Extractor & High-Resolution Resolver.
 *
 * Handles modern Imobiliare.ro (Nuxt 3 / Vue 3 + RoamCDN) as well as legacy markup:
 * 1. Scope isolation (ZERO similar listings / agency logos / avatars / chrome):
 *    - Anchors primarily to `<div id="detail-gallery-modal-panel-gallery" role="tabpanel" aria-labelledby="detail-gallery-modal-tab-gallery">`
 *      when mounted in the DOM (preserving canonical `button.listing-thumbnail-modal` order and deduplicating
 *      blurred `aria-hidden="true"` 140w backdrops & contact-card duplicates).
 *    - Extracts the authoritative RoamCDN listing folder token (e.g. `_1I7l9EBFm4KLvpg8kDQw8QryN_d0A` from
 *      `https://i.roamcdn.net/prop/imo/{preset}/{sig}/{wm}/{listingFolder}/{photoId}.jpg`) shared exclusively
 *      by all photos of this exact listing.
 * 2. Full-resolution recovery for ALL photos (not just the cover image):
 *    - Decodes Nuxt 3 `<script type="application/json" id="__NUXT_DATA__">` (`devalue` flat-array payload),
 *      Next.js `__NEXT_DATA__`, and inline hydration scripts to obtain every signed `gallery-full-1200w-watermark` /
 *      `gallery-full-1600w-watermark` / `gallery-main-900w-watermark` URL for the listing.
 *    - Harvests all `i.roamcdn.net` URLs in the document that match the authoritative listing folder token
 *      (upgrading virtualized/unmounted modal slides to their authentic signed full-res URLs with zero leak
 *      from similar apartments, which live in completely different folder tokens).
 *    - When static HTML still lacks full-res URLs (e.g. <= 1 image or remaining 140w thumbnails because
 *      Vue virtualizes modal slides outside ±2 of the active slide), opens `#detail-gallery-modal-panel-gallery`
 *      in headless Chromium, intercepts JSON API payloads, and steps through `button.listing-thumbnail-modal` /
 *      `button[aria-label="Fotografia următoare"]` to mount and capture EVERY slide's full-resolution `<img>`.
 */

import * as cheerio from "cheerio";
import { safeFetchExternal, validateSafeExternalUrl } from "../security/sec_url-validator";
import { logger } from "../../src/core/logger/logger";
import { ScrapeWorkerService } from "../scraping/svc_scrape-worker";

export const IMOBILIARE_PRIMARY_GALLERY_SELECTORS = [
  "#detail-gallery-modal-panel-gallery",
  '[role="tabpanel"][aria-labelledby="detail-gallery-modal-tab-gallery"]',
] as const;

export const IMOBILIARE_SECONDARY_GALLERY_SELECTORS = [
  "#detail-gallery-modal",
  '[id*="detail-gallery"]',
  '[data-testid*="gallery"]',
  '[data-cy*="gallery"]',
  "#galerie",
  ".galerie",
  ".gallery-slider",
  ".offer-gallery",
  ".property-gallery",
  "#fotoGal",
  ".slider-galerie",
  "#anunt-galerie",
  '[class*="gallery-modal"]',
  '[class*="photo-gallery"]',
] as const;

const IMOBILIARE_NON_GALLERY_SECTIONS = [
  "aside",
  "footer",
  "nav",
  "header",
  '[id*="modal-panel-location"]',
  '[id*="modal-panel-transport"]',
  '[id*="modal-panel-education"]',
  '[id*="modal-panel-shopping"]',
  '[id*="modal-panel-medical"]',
  '[id*="modal-panel-restaurants"]',
  '[id*="modal-panel-banks"]',
  '[id*="modal-panel-parks"]',
  '[id*="modal-panel-parking"]',
  '[id*="modal-panel-plan"]',
  '[id*="modal-panel-video"]',
  '[id*="modal-panel-map"]',
  '[id*="modal-panel-tour"]',
  '[id*="modal-panel-street"]',
  '[data-cy="gallery-contact-card"]',
  '[data-cy="listing-chat-panel"]',
  ".recommendations",
  ".featured-offers",
  ".similar-offers",
  ".similar-ads",
  ".others-ads",
  ".suggested-offers",
  '[data-testid="recommendations"]',
  ".listing-related",
  ".related-ads",
  "#ad-recommendations",
  ".bottom-ads",
  ".other-offers",
  ".related-offers",
  ".promoted-offers",
  ".slider-similar",
  ".agent-card",
  ".agency-card",
  ".agency-logo",
  ".broker-logo",
  ".developer-logo",
  ".user-card",
  ".user-profile",
  ".breadcrumbs",
  ".search-results",
  '[data-cy="similar-ads"]',
  '[data-cy="recommended-ads"]',
  ".ad-carousel-similar",
  ".similar-listings",
  ".related-properties",
  ".cross-selling",
  ".cross-sell",
  ".banner",
  ".ad-banner",
  ".header-logo",
  ".site-header",
  ".site-footer",
  ".navbar",
  ".menu",
  ".sidebar",
  ".contact-agent-section",
  '[data-testid*="similar"]',
  '[data-testid*="recommend"]',
  '[data-testid*="promoted"]',
  '[data-cy*="similar"]',
  '[data-cy*="recommend"]',
  '[data-cy*="ad-card"]',
  '[data-testid*="ad-card"]',
  '[class*="similar"]',
  '[class*="recommend"]',
  '[class*="suggested"]',
];

const DEFAULT_ROAMCDN_HIGHRES_PRESETS = [
  "gallery-full-1600w-watermark",
  "gallery-full-1200w-watermark",
  "gallery-main-900w-watermark",
  "gallery-full-1200w",
  "gallery-full-1600w",
];

const IMAGE_ATTR_NAMES = [
  "data-full",
  "data-large",
  "data-original",
  "data-high-res",
  "data-highres",
  "data-src-full",
  "data-zoom",
  "data-zoom-image",
  "data-big",
  "data-gallery-src",
  "data-image",
  "data-photo",
  "data-lazy-src",
  "data-lazy",
  "data-src",
  "data-url",
  "src",
] as const;

const SRCSET_ATTR_NAMES = ["data-srcset", "srcset"] as const;

const JSON_ATTR_NAMES = [
  "x-data",
  "wire:snapshot",
  "data-images",
  "data-gallery",
  "data-photos",
  "data-slides",
  "data-items",
  "data-media",
] as const;

const NON_GALLERY_URL_PATTERNS = [
  "base-logo",
  "agency-logo",
  "agent-logo",
  "broker-logo",
  "developer-logo",
  "watermark-logo",
  "/logo/",
  "_logo",
  "-logo",
  "/avatar/",
  "avatar-",
  "-avatar",
  "/agent/",
  "/broker/",
  "/agency/",
  "/agentie/",
  "/dezvoltator/",
  "/developer/",
  "/badge",
  "/icon",
  "favicon",
  "sprite",
  "placeholder",
  "staticmap",
  "google-map",
  "maps.googleapis",
  "mapbox",
  "/map/",
  "/banners/",
  "ad-banner",
  "doubleclick",
  "google-analytics",
  "facebook.com",
  "instagram.com",
  "youtube.com",
  "tiktok.com",
  "pinterest.com",
  "linkedin.com",
  "twitter.com",
  "video-thumb",
  "spinner",
  "loader",
  ".svg",
  ".gif",
  ".pdf",
];

const IMAGE_EXT_REGEX = /\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i;
const UUID_STEM_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export interface SrcsetCandidate {
  url: string;
  widthHint: number;
  densityHint: number;
}

export interface ImobiliarePhotoCandidate {
  url: string;
  widthHint: number;
  densityHint: number;
  source: "primary-panel" | "secondary-gallery" | "structured-json" | "folder-harvest" | "cross-ref" | "fallback";
}

export interface ImobiliareGalleryExtractionInput {
  $: any;
  html: string;
  pageUrl: string;
  isForbiddenGraphic?: (urlStr: string) => boolean;
  blockedAgencyPaths?: Set<string>;
  getBaseUrlPath?: (u: string) => string;
  extraHighResUrls?: string[];
}

export interface ImobiliareGalleryExtractionResult {
  images: string[];
  source: "primary-panel" | "structured-json" | "folder-harvest" | "secondary-gallery" | "fallback" | "none";
  primaryPanelFound: boolean;
  remainingThumbnailsCount: number;
  observedHighResPresets: string[];
  authoritativeFolders: string[];
}

export interface ThumbnailProbeResult {
  ok: boolean;
  contentType: string;
  contentLength: number | null;
}

export type ThumbnailProbeFn = (url: string) => Promise<ThumbnailProbeResult>;

/**
 * Returns true if the URL belongs to imobiliare.ro.
 */
export function isImobiliareUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    const host = parsed.hostname.toLowerCase();
    return host === "imobiliare.ro" || host.endsWith(".imobiliare.ro");
  } catch {
    return url.toLowerCase().includes("imobiliare.ro");
  }
}

/**
 * Unescapes HTML/JSON-encoded URL strings, resolves relative URLs, and unwraps
 * Next.js / Cloudflare / IPX image resizer proxies back to the canonical source URL.
 */
export function normalizeImobiliareImageUrl(rawUrl: string, pageUrl = "https://www.imobiliare.ro"): string | null {
  if (!rawUrl || typeof rawUrl !== "string") return null;

  let cleaned = rawUrl
    .trim()
    .replace(/^['"`]+|['"`]+$/g, "")
    .replace(/\\u002F/gi, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "")
    .replace(/\\+$/g, "")
    .trim();

  if (!cleaned || cleaned.startsWith("data:") || cleaned.startsWith("blob:") || cleaned.startsWith("javascript:")) {
    return null;
  }

  if (cleaned.startsWith("//")) {
    cleaned = `https:${cleaned}`;
  } else if (cleaned.startsWith("/")) {
    try {
      const base = new URL(pageUrl);
      cleaned = `${base.origin}${cleaned}`;
    } catch {
      cleaned = `https://www.imobiliare.ro${cleaned}`;
    }
  }

  if (!/^https?:\/\//i.test(cleaned)) {
    return null;
  }

  // Unwrap Next.js image optimizer: /_next/image?url=https%3A%2F%2Fi.roamcdn.net%2F...&w=384&q=75
  if (cleaned.includes("/_next/image")) {
    try {
      const parsed = new URL(cleaned);
      const inner = parsed.searchParams.get("url");
      if (inner) {
        const unwrapped = normalizeImobiliareImageUrl(inner, pageUrl);
        if (unwrapped) return unwrapped;
      }
    } catch {
      // Keep original if parsing fails
    }
  }

  // Unwrap Cloudflare Image Resizing: /cdn-cgi/image/width=300,quality=75/https://...
  const cfMatch = cleaned.match(/\/cdn-cgi\/image\/[^/]+\/(https?:\/\/.+)$/i);
  if (cfMatch && cfMatch[1]) {
    const unwrapped = normalizeImobiliareImageUrl(cfMatch[1], pageUrl);
    if (unwrapped) return unwrapped;
  }

  // Unwrap IPX image proxy: /_ipx/w_300/https://...
  const ipxMatch = cleaned.match(/\/_ipx\/[^/]+\/(https?:\/\/.+)$/i);
  if (ipxMatch && ipxMatch[1]) {
    const unwrapped = normalizeImobiliareImageUrl(ipxMatch[1], pageUrl);
    if (unwrapped) return unwrapped;
  }

  return cleaned;
}

/**
 * Extracts the `{preset}` segment from a `roamcdn.net` property image URL:
 * `https://i.roamcdn.net/prop/imo/{preset}/{sig}/{wm}/{listingFolder}/{filename}.jpg`
 */
export function extractRoamcdnPreset(url: string): string | null {
  if (!url || typeof url !== "string") return null;
  const match = url.match(/https?:\/\/[^/]*roamcdn\.net\/prop\/[^/]+\/([^/]+)\//i);
  return match ? match[1] : null;
}

/**
 * Extracts the listing-specific folder token from a `roamcdn.net` URL:
 * e.g. from `https://i.roamcdn.net/prop/imo/gallery-full-1200w-watermark/m8wpWbvfl3tnS6SNCQrvDw/-_1q4ZkoeCS1LTEPAVg0Z1YDCyBypRqAQ/_1I7l9EBFm4KLvpg8kDQw8QryN_d0A/88411436.jpg`
 * returns `_1I7l9EBFm4KLvpg8kDQw8QryN_d0A`.
 *
 * Every photo of the same Imobiliare.ro listing shares this exact folder token across
 * all resolution variants (140w thumbnails and 1200w full-size watermarked images alike),
 * while similar/recommended apartments have completely different folder tokens.
 */
export function extractRoamcdnListingFolder(url: string): string | null {
  if (!url || typeof url !== "string") return null;
  const clean = url.split(/[?#;]/)[0];
  try {
    const parsed = new URL(clean);
    if (!parsed.hostname.toLowerCase().includes("roamcdn.net")) return null;
    const segs = parsed.pathname.split("/").filter(Boolean);
    // Standard structure: ["prop", "imo", "{preset}", "{sig}", "{wm}", "{listingFolder}", "{filename}"]
    if (segs.length >= 7 && segs[0].toLowerCase() === "prop") {
      const folder = segs[segs.length - 2];
      if (folder && folder !== "-" && !folder.startsWith("-_") && folder.length >= 6) {
        return folder;
      }
    }
  } catch {
    // ignore invalid URL
  }
  return null;
}

/**
 * Returns true if the URL is clearly a non-gallery graphic (agency logo, avatar,
 * map tile, badge, icon, social button, banner, SVG/GIF, etc.).
 *
 * IMPORTANT: For `roamcdn.net` URLs, inspects ONLY the preset and filename — NEVER
 * the random base64url HMAC signature / watermark / listing folder tokens (which can
 * randomly contain short English substrings like "pin", "pdf", or "logo").
 */
export function isImobiliareNonGalleryAsset(url: string): boolean {
  if (!url || typeof url !== "string") return true;
  const lower = url.toLowerCase();

  if (lower.includes("roamcdn.net")) {
    const preset = (extractRoamcdnPreset(url) || "").toLowerCase();
    const cleanPath = lower.split(/[?#;]/)[0];
    const filename = cleanPath.split("/").pop() || "";

    if (filename.endsWith(".svg") || filename.endsWith(".gif") || filename.endsWith(".pdf")) {
      return true;
    }

    const presetForbidden = [
      "logo",
      "avatar",
      "agent",
      "agency",
      "broker",
      "developer",
      "banner",
      "icon",
      "badge",
      "map",
      "video",
      "floorplan",
      "plan",
    ];
    if (preset && presetForbidden.some((p) => preset.includes(p))) {
      return true;
    }

    const filenameForbidden = [
      "logo",
      "avatar",
      "agent-portrait",
      "agency-brand",
      "placeholder",
      "default",
      "banner",
      "icon",
      "favicon",
    ];
    if (filenameForbidden.some((p) => filename.includes(p))) {
      return true;
    }

    return false;
  }

  for (const pat of NON_GALLERY_URL_PATTERNS) {
    if (lower.includes(pat)) return true;
  }

  return false;
}

/**
 * Checks whether a URL plausibly points to a property photo (supported image extension or known CDN).
 */
export function isPlausibleImobiliarePhotoUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  if (!/^https?:\/\//i.test(url)) return false;
  if (isImobiliareNonGalleryAsset(url)) return false;

  const lower = url.toLowerCase();
  if (lower.includes("roamcdn.net")) {
    return lower.includes("/prop/") && IMAGE_EXT_REGEX.test(lower);
  }
  if (lower.includes("imobiliare.ro")) {
    return IMAGE_EXT_REGEX.test(lower) || lower.includes("/image") || lower.includes("/photo") || lower.includes("/galerie");
  }
  return IMAGE_EXT_REGEX.test(lower);
}

/**
 * Extracts the canonical identity key for an Imobiliare.ro / RoamCDN photo.
 *
 * Handles both numeric photo IDs (e.g. `88411436.jpg` inside listing folder `_1I7l9EBFm4KLvpg8kDQw8QryN_d0A`)
 * and UUID filenames (`0ae58ab7-3a98-4c2c-acf0-c29a8a856ed2.jpg`). Ignores `{preset}`, `{sigHash}`,
 * and `{watermarkToken}` so 140w thumbnails, 900w hero photos, and 1200w full-res photos of the same
 * image ALWAYS collapse to one canonical key.
 */
export function getImobiliarePhotoKey(url: string): string {
  const cleanUrl = (url || "").split(/[?#;]/)[0];
  const lower = cleanUrl.toLowerCase();

  const segments = cleanUrl.split("/").filter(Boolean);
  const rawFilename = segments[segments.length - 1] || cleanUrl;
  const uuidInFilename = rawFilename.match(UUID_STEM_REGEX);
  if (uuidInFilename) {
    return `imo-uuid-${uuidInFilename[0].toLowerCase()}`;
  }

  const stem = rawFilename
    .replace(/\.(?:jpe?g|png|webp|avif)$/i, "")
    .replace(/[_-]\d{2,4}x\d{2,4}$/i, "")
    .replace(/[_-](?:full|large|big|medium|small|thumb|thumbnail|mini|micro|original|watermark|\d{2,4}w)+$/gi, "")
    .toLowerCase();

  if (lower.includes("roamcdn.net")) {
    const listingFolder = extractRoamcdnListingFolder(url);
    if (listingFolder) {
      return `imo-roam-${listingFolder.toLowerCase()}-${stem}`;
    }
    if (stem.length >= 10) {
      return `imo-roam-${stem}`;
    }
    const parent = (segments[segments.length - 2] || "").toLowerCase();
    return `imo-roam-${parent}-${stem}`;
  }

  if (lower.includes("imobiliare.ro")) {
    if (stem.length >= 8 && /\d/.test(stem)) {
      return `imo-file-${stem}`;
    }
    const parent = (segments[segments.length - 2] || "")
      .replace(/^(?:thumb|thumbs|small|medium|large|full|original|extralarge)$/i, "")
      .toLowerCase();
    return parent ? `imo-file-${parent}-${stem}` : `imo-file-${stem}`;
  }

  const parent = (segments[segments.length - 2] || "").toLowerCase();
  return `img-${parent}-${stem}`;
}

/**
 * Extracts explicit pixel width/max-dimension encoded inside the URL (preset, path, filename, or query).
 */
export function extractExplicitImageWidth(url: string): number {
  if (!url || typeof url !== "string") return 0;

  let maxDim = 0;

  // For roamcdn.net, extract width ONLY from the preset and filename (never random base64 hashes)
  const targetForRegex = url.toLowerCase().includes("roamcdn.net")
    ? `${extractRoamcdnPreset(url) || ""} ${url.split(/[?#;]/)[0].split("/").pop() || ""}`
    : url;

  const wMatches = targetForRegex.matchAll(/(?:^|[-_/])(\d{2,4})w(?:[-_/.?#]|$)/gi);
  for (const m of wMatches) {
    const val = Number(m[1]);
    if (Number.isFinite(val) && val >= 40 && val <= 8000 && val > maxDim) {
      maxDim = val;
    }
  }

  const dimMatches = targetForRegex.matchAll(/(?:^|[-_/=])(\d{2,4})x(\d{2,4})(?:[-_/.?&#]|$)/gi);
  for (const m of dimMatches) {
    const w = Number(m[1]);
    const h = Number(m[2]);
    const larger = Math.max(w, h);
    if (Number.isFinite(larger) && larger >= 40 && larger <= 8000 && larger > maxDim) {
      maxDim = larger;
    }
  }

  try {
    const parsed = new URL(url);
    for (const key of ["w", "width", "maxwidth", "mw"]) {
      const raw = parsed.searchParams.get(key);
      if (raw && /^\d{2,4}$/.test(raw)) {
        const val = Number(raw);
        if (val >= 40 && val <= 8000 && val > maxDim) {
          maxDim = val;
        }
      }
    }
  } catch {
    // Ignore invalid URL parse
  }

  return maxDim;
}

/**
 * Returns true if the URL clearly represents a small/pixelated thumbnail variant.
 */
export function isImobiliareThumbnailUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  const lower = url.toLowerCase();

  const explicitWidth = extractExplicitImageWidth(url);
  if (explicitWidth >= 800) {
    return false;
  }
  if (explicitWidth > 0 && explicitWidth < 600) {
    return true;
  }

  const semanticPart = lower.includes("roamcdn.net")
    ? `${(extractRoamcdnPreset(url) || "").toLowerCase()} ${lower.split(/[?#;]/)[0].split("/").pop() || ""}`
    : lower;

  if (
    /(?:gallery|listing|offer|photo)[-_](?:thumb|small|mini|micro|grid|card)/i.test(semanticPart) ||
    /\/(?:thumb|thumbs|thumbnail|thumbnails|small|mini|micro)\//i.test(semanticPart) ||
    /[_-](?:thumb|thumbnail|small|mini|micro)\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i.test(semanticPart)
  ) {
    return true;
  }

  return false;
}

/**
 * Returns true if the URL looks like a listing-card / similar-ad thumbnail preset
 * rather than a full listing gallery photo.
 */
export function isSimilarListingPreset(url: string): boolean {
  const preset = extractRoamcdnPreset(url);
  if (!preset) return false;
  const lp = preset.toLowerCase();
  return (
    lp.startsWith("listing-") ||
    lp.startsWith("offer-card") ||
    lp.startsWith("search-") ||
    lp.includes("similar") ||
    lp.includes("card-")
  );
}

/**
 * Scores an image URL by resolution quality so deduplication ALWAYS selects
 * the full-size image over small/pixelated thumbnails.
 */
export function scoreImobiliareImageResolution(
  url: string,
  srcsetWidthHint = 0,
  densityHint = 0
): number {
  if (!url || typeof url !== "string") return -10000;
  if (isImobiliareNonGalleryAsset(url)) return -10000;

  const lower = url.toLowerCase();
  const semanticPart = lower.includes("roamcdn.net")
    ? `${(extractRoamcdnPreset(url) || "").toLowerCase()} ${lower.split(/[?#;]/)[0].split("/").pop() || ""}`
    : lower;

  let score = 0;

  const urlWidth = extractExplicitImageWidth(url);
  const effectiveWidth = Math.max(urlWidth, srcsetWidthHint || 0);

  if (effectiveWidth >= 1600) score += 500;
  else if (effectiveWidth >= 1200) score += 420;
  else if (effectiveWidth >= 1000) score += 350;
  else if (effectiveWidth >= 800) score += 280;
  else if (effectiveWidth >= 600) score += 150;
  else if (effectiveWidth > 0 && effectiveWidth < 500) {
    score -= 600 - effectiveWidth;
  }

  if (effectiveWidth >= 600) {
    score += Math.min(effectiveWidth, 4000) / 100;
  }

  if (densityHint > 1) {
    score += Math.min(densityHint, 4) * 35;
  }

  if (
    semanticPart.includes("gallery-full") ||
    semanticPart.includes("/extralarge/") ||
    semanticPart.includes("/full/") ||
    semanticPart.includes("/original/")
  ) {
    score += 220;
  } else if (
    semanticPart.includes("gallery-main") ||
    semanticPart.includes("gallery-large") ||
    semanticPart.includes("gallery-big") ||
    semanticPart.includes("/large/") ||
    semanticPart.includes("/big/") ||
    semanticPart.includes("/galerie/")
  ) {
    score += 150;
  } else if (semanticPart.includes("gallery-medium") || semanticPart.includes("/medium/")) {
    score += 20;
  }

  if (
    /(?:gallery|listing|offer|photo)[-_](?:thumb|small|mini|micro)/i.test(semanticPart) ||
    /\/(?:thumb|thumbs|thumbnail|thumbnails|small|mini|micro)\//i.test(semanticPart) ||
    /[_-](?:thumb|thumbnail|small|mini|micro)\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i.test(semanticPart)
  ) {
    score -= 550;
  }

  if (isSimilarListingPreset(url)) {
    score -= 400;
  }

  if (/\.(?:jpe?g|png)(?:[?#]|$)/i.test(lower)) {
    score += 2;
  }

  return score;
}

/**
 * Parses an HTML `srcset` or `data-srcset` attribute safely, preserving width (`1200w`)
 * and pixel-density (`2x`) descriptors and handling URLs that contain commas (e.g. Cloudflare/Cloudinary).
 */
export function parseSrcsetCandidates(
  srcset: string,
  pageUrl = "https://www.imobiliare.ro"
): SrcsetCandidate[] {
  if (!srcset || typeof srcset !== "string") return [];

  const entries: string[] = [];
  let current = "";
  const trimmed = srcset.trim();

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === ",") {
      const left = current.trim();
      const right = trimmed.slice(i + 1).trimStart();
      const leftHasDescriptor = /\s+(?:\d+w|\d+(?:\.\d+)?x)$/i.test(left);
      const rightStartsWithUrl = /^(?:https?:\/\/|\/\/|\/)/i.test(right);
      const leftEndsWithUrlNoSpace = !/\s/.test(left) && rightStartsWithUrl;
      if (leftHasDescriptor || leftEndsWithUrlNoSpace) {
        if (left) entries.push(left);
        current = "";
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) entries.push(current.trim());

  const results: SrcsetCandidate[] = [];
  for (const entry of entries) {
    const parts = entry.trim().split(/\s+/);
    const rawUrl = parts[0];
    const descriptor = parts[1] || "";
    const normalized = normalizeImobiliareImageUrl(rawUrl, pageUrl);
    if (!normalized) continue;

    let widthHint = 0;
    let densityHint = 0;
    const wMatch = descriptor.match(/^(\d{2,5})w$/i);
    if (wMatch) {
      widthHint = Number(wMatch[1]);
    } else {
      const xMatch = descriptor.match(/^(\d+(?:\.\d+)?)x$/i);
      if (xMatch) {
        densityHint = Number(xMatch[1]);
      }
    }

    results.push({ url: normalized, widthHint, densityHint });
  }

  results.sort(
    (a, b) =>
      scoreImobiliareImageResolution(b.url, b.widthHint, b.densityHint) -
      scoreImobiliareImageResolution(a.url, a.widthHint, a.densityHint)
  );
  return results;
}

/**
 * Decodes a Nuxt 3 `devalue`-serialized `<script type="application/json" id="__NUXT_DATA__">`
 * flat indexed array back into a normal JS object graph (with memoization and cycle guards).
 */
export function decodeNuxtDevaluePayload(raw: unknown): unknown {
  if (!Array.isArray(raw) || raw.length === 0) return raw;

  const cache = new Map<number, unknown>();
  const visiting = new Set<number>();

  const reviveIndex = (idx: number, depth: number): unknown => {
    if (depth > 30 || idx < 0 || idx >= raw.length) return null;
    if (cache.has(idx)) return cache.get(idx);
    if (visiting.has(idx)) return null;

    visiting.add(idx);
    const val = raw[idx];
    let result: unknown = null;

    if (val === null || typeof val !== "object") {
      result = val;
    } else if (Array.isArray(val)) {
      const tag = val[0];
      if (
        typeof tag === "string" &&
        (tag === "Reactive" ||
          tag === "ShallowReactive" ||
          tag === "Ref" ||
          tag === "ShallowRef" ||
          tag === "NuxtError") &&
        typeof val[1] === "number"
      ) {
        result = reviveIndex(val[1], depth + 1);
      } else if (tag === "Set") {
        result = val
          .slice(1)
          .map((el) => (typeof el === "number" ? reviveIndex(el, depth + 1) : el));
      } else if (tag === "Map") {
        const obj: Record<string, unknown> = {};
        for (let i = 1; i + 1 < val.length; i += 2) {
          const k = typeof val[i] === "number" ? reviveIndex(val[i] as number, depth + 1) : val[i];
          const v =
            typeof val[i + 1] === "number" ? reviveIndex(val[i + 1] as number, depth + 1) : val[i + 1];
          if (typeof k === "string" || typeof k === "number") {
            obj[String(k)] = v;
          }
        }
        result = obj;
      } else if (
        tag === "Date" ||
        tag === "URL" ||
        tag === "BigInt" ||
        tag === "RegExp"
      ) {
        result = typeof val[1] === "string" ? val[1] : null;
      } else if (
        tag === "Undefined" ||
        tag === "EmptyRef" ||
        tag === "EmptyShallowRef" ||
        tag === "NaN" ||
        tag === "Infinity" ||
        tag === "-Infinity"
      ) {
        result = null;
      } else {
        const arr: unknown[] = [];
        cache.set(idx, arr);
        for (const el of val) {
          arr.push(typeof el === "number" ? reviveIndex(el, depth + 1) : el);
        }
        result = arr;
      }
    } else {
      const obj: Record<string, unknown> = {};
      cache.set(idx, obj);
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        obj[k] = typeof v === "number" ? reviveIndex(v, depth + 1) : v;
      }
      result = obj;
    }

    visiting.delete(idx);
    cache.set(idx, result);
    return result;
  };

  return reviveIndex(0, 0);
}

/**
 * Extracts all `roamcdn.net` / `imobiliare.ro` image URLs from an arbitrary raw string
 * (HTML fragment, inline script, `__NUXT_DATA__`, JSON attribute, XHR payload, etc.).
 */
export function scanRawTextForImobiliareUrls(raw: string, pageUrl = "https://www.imobiliare.ro"): string[] {
  if (!raw || raw.length < 15) return [];

  const unescaped = raw
    .replace(/\\u002F/gi, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"');

  const urls: string[] = [];
  const pattern =
    /https?:\/\/[^"'\s<>\\)`]*(?:roamcdn\.net|imobiliare\.ro)[^"'\s<>\\)`]*?(?:\.(?:jpe?g|png|webp|avif)(?:\?[^"'\s<>\\)`]*)?)/gi;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(unescaped)) !== null) {
    const normalized = normalizeImobiliareImageUrl(match[0], pageUrl);
    if (normalized && isPlausibleImobiliarePhotoUrl(normalized)) {
      urls.push(normalized);
    }
  }

  return urls;
}

/**
 * Extracts image candidates from a Cheerio container element.
 * When the container is `#detail-gallery-modal-panel-gallery`, seeds canonical gallery order
 * from `button.listing-thumbnail-modal` first (so slides stay in exact 1..N listing order
 * regardless of which slide is currently active in the circular carousel).
 */
function collectCandidatesFromContainer(
  $: any,
  $container: any,
  pageUrl: string,
  source: ImobiliarePhotoCandidate["source"],
  onCandidate: (candidate: ImobiliarePhotoCandidate) => void
): void {
  const inspectElement = ($el: any) => {
    const tag = String($el.prop("tagName") || "").toUpperCase();

    for (const attr of SRCSET_ATTR_NAMES) {
      const rawSrcset = $el.attr(attr);
      if (rawSrcset) {
        const parsed = parseSrcsetCandidates(rawSrcset, pageUrl);
        for (const item of parsed) {
          onCandidate({
            url: item.url,
            widthHint: item.widthHint,
            densityHint: item.densityHint,
            source,
          });
        }
      }
    }

    for (const attr of IMAGE_ATTR_NAMES) {
      const rawVal = $el.attr(attr);
      if (!rawVal) continue;
      const normalized = normalizeImobiliareImageUrl(rawVal, pageUrl);
      if (normalized) {
        onCandidate({ url: normalized, widthHint: 0, densityHint: 0, source });
      }
    }

    if (tag === "A") {
      const href = $el.attr("href");
      if (href) {
        const normalized = normalizeImobiliareImageUrl(href, pageUrl);
        if (normalized && isPlausibleImobiliarePhotoUrl(normalized)) {
          onCandidate({ url: normalized, widthHint: 0, densityHint: 0, source });
        }
      }
    }

    const style = $el.attr("style");
    if (style && style.includes("url(")) {
      const bgMatches = style.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi);
      for (const m of bgMatches) {
        const normalized = normalizeImobiliareImageUrl(m[1], pageUrl);
        if (normalized) {
          onCandidate({ url: normalized, widthHint: 0, densityHint: 0, source });
        }
      }
    }

    for (const attr of JSON_ATTR_NAMES) {
      const rawJson = $el.attr(attr);
      if (!rawJson) continue;
      for (const u of scanRawTextForImobiliareUrls(rawJson, pageUrl)) {
        onCandidate({ url: u, widthHint: 0, densityHint: 0, source });
      }
    }
  };

  // Seed canonical order from modal/listing thumbnail buttons first (1..N in exact listing order)
  const $thumbButtons = $container.find("button.listing-thumbnail-modal, button.listing-thumbnail");
  if ($thumbButtons.length > 0) {
    $thumbButtons.each((_: any, btn: any) => {
      const $btn = $(btn);
      // Skip the final contact-card thumbnail overlay button (repeats photo 1 with phone SVG)
      if ($btn.find("svg").length > 0 && $btn.find("span.rounded-full").length > 0) {
        return;
      }
      $btn.find("img, source").each((__: any, imgEl: any) => inspectElement($(imgEl)));
    });
  }

  $container.each((_: any, rootEl: any) => inspectElement($(rootEl)));

  const elements = $container.find(
    "picture, source, img, a, button, figure, li, div, [srcset], [data-srcset], [data-src], [data-full], [data-large], [data-original], [data-lazy], [data-zoom], [data-image], [data-gallery-src], [x-data], [wire\\:snapshot], [data-images], [data-gallery], [data-photos]"
  );
  elements.each((_: any, el: any) => {
    const $el = $(el);
    // Skip blurred decorative backdrop images when walking carousel slides
    if ($el.attr("aria-hidden") === "true" && String($el.attr("class") || "").includes("blur")) {
      return;
    }
    inspectElement($el);
  });

  $container.find("noscript").each((_: any, el: any) => {
    const innerHtml = $(el).html() || "";
    if (!innerHtml) return;
    for (const u of scanRawTextForImobiliareUrls(innerHtml, pageUrl)) {
      onCandidate({ url: u, widthHint: 0, densityHint: 0, source });
    }
  });

  if (source === "primary-panel") {
    $container.each((_: any, rootEl: any) => {
      const innerHtml = $(rootEl).html() || "";
      for (const u of scanRawTextForImobiliareUrls(innerHtml, pageUrl)) {
        onCandidate({ url: u, widthHint: 0, densityHint: 0, source });
      }
    });
  }
}

/**
 * Extracts gallery photo URLs from structured JSON payloads on Imobiliare.ro:
 * - Nuxt 3 `<script type="application/json" id="__NUXT_DATA__">` / `<script data-nuxt-data>`
 * - Next.js `<script id="__NEXT_DATA__">`
 * - Inline hydration `<script>` arrays
 * Strictly excludes similar/recommended/related/agency/floorplan blocks.
 */
function extractFromStructuredImobiliareJson(
  $: any,
  html: string,
  pageUrl: string
): string[] {
  const results: string[] = [];

  const isExcludedKey = (key: string): boolean => {
    const k = key.toLowerCase();
    return (
      k.includes("similar") ||
      k.includes("recommend") ||
      k.includes("related") ||
      k.includes("promoted") ||
      k.includes("otheroffer") ||
      k.includes("other_offer") ||
      k.includes("nearby") ||
      k.includes("agency") ||
      k.includes("agent") ||
      k.includes("broker") ||
      k.includes("developer") ||
      k.includes("owner") ||
      k.includes("logo") ||
      k.includes("avatar") ||
      k.includes("banner") ||
      k.includes("floorplan") ||
      k.includes("schita") ||
      k === "plans" ||
      k === "plan" ||
      k.includes("video")
    );
  };

  const GALLERY_ARRAY_KEYS = new Set([
    "gallery",
    "galerie",
    "images",
    "photos",
    "imagini",
    "poze",
    "pictures",
    "slides",
    "photolist",
    "photo_list",
    "galleryimages",
    "gallery_images",
    "galleryitems",
    "gallery_items",
    "propertyimages",
    "listingimages",
    "offerimages",
    "adimages",
    "fullimages",
    "largeimages",
    "media",
    "multimedia",
  ]);

  const extractUrlFromAny = (item: unknown, depth = 0): string[] => {
    if (depth > 4) return [];
    if (typeof item === "string") {
      const norm = normalizeImobiliareImageUrl(item, pageUrl);
      return norm && isPlausibleImobiliarePhotoUrl(norm) ? [norm] : [];
    }
    if (!item || typeof item !== "object") return [];
    if (Array.isArray(item)) {
      const found: string[] = [];
      for (const el of item) found.push(...extractUrlFromAny(el, depth + 1));
      return found;
    }
    const obj = item as Record<string, unknown>;
    const found: string[] = [];
    const preferredFields = [
      "full",
      "fullUrl",
      "full_url",
      "original",
      "large",
      "largeUrl",
      "large_url",
      "highRes",
      "high_res",
      "watermark",
      "big",
      "main",
      "desktop",
      "url",
      "src",
      "link",
      "image",
      "medium",
      "thumb",
      "thumbnail",
      "urls",
      "sizes",
      "variants",
    ];
    for (const f of preferredFields) {
      if (!(f in obj)) continue;
      found.push(...extractUrlFromAny(obj[f], depth + 1));
    }
    // Also inspect any remaining string properties that look like roamcdn/imobiliare image URLs
    for (const [k, val] of Object.entries(obj)) {
      if (isExcludedKey(k) || preferredFields.includes(k)) continue;
      if (typeof val === "string" && (val.includes("roamcdn.net") || val.includes("imobiliare.ro"))) {
        const norm = normalizeImobiliareImageUrl(val, pageUrl);
        if (norm && isPlausibleImobiliarePhotoUrl(norm)) found.push(norm);
      }
    }
    return found;
  };

  const visitedObjects = new WeakSet<object>();
  const walkObjectForGallery = (node: unknown, depth = 0): void => {
    if (!node || typeof node !== "object" || depth > 12) return;
    if (visitedObjects.has(node as object)) return;
    visitedObjects.add(node as object);

    if (Array.isArray(node)) {
      for (const el of node) walkObjectForGallery(el, depth + 1);
      return;
    }

    const record = node as Record<string, unknown>;
    for (const [key, val] of Object.entries(record)) {
      if (isExcludedKey(key)) continue;
      const lk = key.toLowerCase();
      if (Array.isArray(val) && val.length > 0 && GALLERY_ARRAY_KEYS.has(lk)) {
        for (const item of val) {
          for (const u of extractUrlFromAny(item)) {
            if (!isSimilarListingPreset(u)) {
              results.push(u);
            }
          }
        }
      } else if (val && typeof val === "object") {
        walkObjectForGallery(val, depth + 1);
      }
    }
  };

  // 1. Parse Nuxt 3 `<script id="__NUXT_DATA__">` and `<script data-nuxt-data>` (primary modern Imobiliare.ro format!)
  $('script#__NUXT_DATA__, script[data-nuxt-data], script[type="application/json"][id*="nuxt" i]').each(
    (_: any, el: any) => {
      const raw = $(el).html();
      if (!raw || raw.length < 20) return;
      try {
        const parsed = JSON.parse(raw);
        const decoded = Array.isArray(parsed) ? decodeNuxtDevaluePayload(parsed) : parsed;
        walkObjectForGallery(decoded);
      } catch {
        // Ignore malformed JSON
      }
    }
  );

  // 2. Parse Next.js `<script id="__NEXT_DATA__">` if present
  $("script#__NEXT_DATA__").each((_: any, el: any) => {
    const raw = $(el).html();
    if (!raw) return;
    try {
      walkObjectForGallery(JSON.parse(raw));
    } catch {
      // Ignore malformed JSON
    }
  });

  // 3. Scan inline scripts for explicit gallery/images/photos JSON arrays not inside similar/recommended blocks
  if (results.length === 0) {
    const galleryArrayRegex =
      /"(?:gallery|galerie|galleryImages|gallery_images|images|photos|imagini|poze|pictures)"\s*:\s*\[([\s\S]{20,120000}?)\]/gi;
    $("script").each((_: any, el: any) => {
      const raw = $(el).html() || "";
      if (!raw || (!raw.includes("roamcdn.net") && !raw.includes("imobiliare.ro"))) return;
      galleryArrayRegex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = galleryArrayRegex.exec(raw)) !== null) {
        const prefix = raw.slice(Math.max(0, match.index - 160), match.index).toLowerCase();
        if (
          prefix.includes("similar") ||
          prefix.includes("recommend") ||
          prefix.includes("related") ||
          prefix.includes("promoted") ||
          prefix.includes("otheroffer") ||
          prefix.includes("agency") ||
          prefix.includes("agent")
        ) {
          continue;
        }
        const urls = scanRawTextForImobiliareUrls(match[1], pageUrl).filter(
          (u) => !isSimilarListingPreset(u)
        );
        results.push(...urls);
      }
    });
  }

  // 4. Check wire:snapshot / x-data on main gallery modal wrapper if present in raw HTML
  if (results.length === 0 && html.includes("detail-gallery-modal")) {
    const $modal = $("#detail-gallery-modal, [id*='detail-gallery']");
    $modal.each((_: any, el: any) => {
      for (const attr of JSON_ATTR_NAMES) {
        const raw = $(el).attr(attr);
        if (raw) {
          results.push(
            ...scanRawTextForImobiliareUrls(raw, pageUrl).filter((u) => !isSimilarListingPreset(u))
          );
        }
      }
    });
  }

  return results;
}

/**
 * Discovers the listing's authoritative RoamCDN folder token(s) (e.g. `_1I7l9EBFm4KLvpg8kDQw8QryN_d0A`)
 * from high-trust single-listing signals: primary gallery panel, decoded Nuxt/Next gallery,
 * `og:image`, listing JSON-LD, and isolated hero gallery elements.
 */
function discoverAuthoritativeListingFolders(
  $: any,
  html: string,
  pageUrl: string,
  seedUrls: string[]
): Set<string> {
  const folders = new Set<string>();
  const addFromUrl = (raw: string | null | undefined) => {
    if (!raw || typeof raw !== "string") return;
    const norm = normalizeImobiliareImageUrl(raw, pageUrl);
    if (!norm || !isPlausibleImobiliarePhotoUrl(norm) || isSimilarListingPreset(norm)) return;
    const folder = extractRoamcdnListingFolder(norm);
    if (folder) folders.add(folder);
  };

  // 1. Seed URLs already confirmed from primary panel or decoded Nuxt/Next listing gallery
  for (const u of seedUrls) addFromUrl(u);
  if (folders.size > 0) return folders;

  // 2. og:image / twitter:image ALWAYS point to this listing's cover photo
  addFromUrl($('meta[property="og:image"]').attr("content"));
  addFromUrl($('meta[name="twitter:image"]').attr("content"));

  // 3. Listing JSON-LD (excluding Organization / Agent / Person)
  $("script[type='application/ld+json']").each((_: any, el: any) => {
    const content = $(el).html();
    if (!content) return;
    try {
      const ld = JSON.parse(content);
      const items = Array.isArray(ld) ? ld : ld["@graph"] ? ld["@graph"] : [ld];
      for (const item of items) {
        const itemType = String(item?.["@type"] || "").toLowerCase();
        if (itemType.includes("organization") || itemType.includes("agent") || itemType.includes("person")) {
          continue;
        }
        if (!item?.image) continue;
        const imgs = Array.isArray(item.image) ? item.image : [item.image];
        for (const img of imgs) {
          addFromUrl(typeof img === "string" ? img : img?.url || img?.contentUrl);
        }
      }
    } catch {
      // ignore invalid JSON-LD
    }
  });
  if (folders.size > 0) return folders;

  // 4. Isolated hero/gallery images (after removing similar/recommended/agency blocks)
  const $isolated = cheerio.load(html || "");
  for (const sel of IMOBILIARE_NON_GALLERY_SECTIONS) {
    $isolated(sel).remove();
  }
  $isolated('button.listing-thumbnail img, img[src*="roamcdn.net/prop/imo/gallery-"]').each(
    (_: any, el: any) => {
      addFromUrl($isolated(el).attr("src"));
      addFromUrl($isolated(el).attr("data-src"));
    }
  );

  return folders;
}

/**
 * Extracts ONLY the listing's own gallery photos from an Imobiliare.ro HTML document,
 * combining `#detail-gallery-modal-panel-gallery`, Nuxt 3 `__NUXT_DATA__`, and
 * authoritative listing-folder-scoped URL harvesting so EVERY photo is resolved to its
 * highest-resolution variant (`gallery-full-1200w-watermark` / `gallery-full-1600w-watermark`)
 * without leaking similar apartments or non-gallery graphics.
 */
export function extractImobiliareGalleryPhotos(
  input: ImobiliareGalleryExtractionInput
): ImobiliareGalleryExtractionResult {
  const { $, html, pageUrl, isForbiddenGraphic, blockedAgencyPaths, getBaseUrlPath, extraHighResUrls } = input;

  const isAllowed = (url: string): boolean => {
    if (!isPlausibleImobiliarePhotoUrl(url)) return false;
    // Never run generic substring `isForbiddenGraphic` against random base64url roamcdn tokens;
    // `isImobiliareNonGalleryAsset` already validates roamcdn presets & filenames cleanly.
    if (!url.toLowerCase().includes("roamcdn.net") && isForbiddenGraphic && isForbiddenGraphic(url)) {
      return false;
    }
    if (blockedAgencyPaths && getBaseUrlPath && blockedAgencyPaths.has(getBaseUrlPath(url))) {
      return false;
    }
    return true;
  };

  const candidatesByKey = new Map<string, ImobiliarePhotoCandidate[]>();
  const addCandidate = (candidate: ImobiliarePhotoCandidate, onlyExistingKeys = false): void => {
    if (!isAllowed(candidate.url)) return;
    const key = getImobiliarePhotoKey(candidate.url);
    if (onlyExistingKeys && !candidatesByKey.has(key)) return;
    const list = candidatesByKey.get(key);
    if (list) {
      list.push(candidate);
    } else {
      candidatesByKey.set(key, [candidate]);
    }
  };

  // STEP 1: Strictly target `<div id="detail-gallery-modal-panel-gallery" role="tabpanel" aria-labelledby="detail-gallery-modal-tab-gallery">`
  const $primaryPanel = $(IMOBILIARE_PRIMARY_GALLERY_SELECTORS.join(", "));
  const primaryPanelFound = $primaryPanel.length > 0;
  let source: ImobiliareGalleryExtractionResult["source"] = "none";

  if (primaryPanelFound) {
    collectCandidatesFromContainer($, $primaryPanel, pageUrl, "primary-panel", (c) =>
      addCandidate(c, false)
    );
    if (candidatesByKey.size > 0) {
      source = "primary-panel";
    }
  }

  // STEP 2: Decode Nuxt 3 `__NUXT_DATA__` / Next.js `__NEXT_DATA__` / structured listing JSON
  const structuredUrls = extractFromStructuredImobiliareJson($, html, pageUrl);
  if (candidatesByKey.size === 0 && structuredUrls.length > 0) {
    for (const u of structuredUrls) {
      addCandidate({ url: u, widthHint: 0, densityHint: 0, source: "structured-json" }, false);
    }
    if (candidatesByKey.size > 0) {
      source = "structured-json";
    }
  }

  // STEP 3: Discover the authoritative RoamCDN listing folder token(s) for THIS exact listing
  // (e.g. `_1I7l9EBFm4KLvpg8kDQw8QryN_d0A`).
  const seedUrls: string[] = [];
  for (const list of candidatesByKey.values()) {
    for (const c of list) seedUrls.push(c.url);
  }
  seedUrls.push(...structuredUrls);
  if (Array.isArray(extraHighResUrls)) {
    seedUrls.push(...extraHighResUrls);
  }
  const authoritativeFolders = discoverAuthoritativeListingFolders($, html, pageUrl, seedUrls);

  // STEP 4: Harvest ALL RoamCDN URLs in the full HTML (including `__NUXT_DATA__`, `window.__NUXT__`,
  // inline scripts, hero gallery, and any extra XHR/carousel URLs) strictly matching:
  // - If primary panel WAS found with photos: upgrade existing photo keys AND add any missing photo
  //   sharing the EXACT same authoritative listing folder token (never leaking similar listings!).
  // - If primary panel was NOT mounted yet (initial Nuxt 3 SSR HTML): harvest EVERY photo sharing
  //   the authoritative listing folder token (e.g. all 13 `gallery-full-1200w-watermark` URLs)!
  const allDocumentRoamUrls = [
    ...(Array.isArray(extraHighResUrls) ? extraHighResUrls : []),
    ...structuredUrls,
    ...scanRawTextForImobiliareUrls(html, pageUrl),
  ];

  // Also check og:image / twitter:image for key upgrades
  for (const metaRaw of [
    $('meta[property="og:image"]').attr("content"),
    $('meta[name="twitter:image"]').attr("content"),
  ]) {
    if (typeof metaRaw === "string") {
      const norm = normalizeImobiliareImageUrl(metaRaw, pageUrl);
      if (norm) allDocumentRoamUrls.push(norm);
    }
  }

  if (primaryPanelFound && candidatesByKey.size > 0) {
    // Primary panel is authoritative for WHICH photos exist in the gallery:
    // ONLY upgrade candidates whose canonical photo key already exists in `#detail-gallery-modal-panel-gallery`
    // (or add full-res variants from the same listing folder if the panel only mounted a subset of slides).
    for (const u of allDocumentRoamUrls) {
      if (isSimilarListingPreset(u)) continue;
      const key = getImobiliarePhotoKey(u);
      if (candidatesByKey.has(key)) {
        addCandidate({ url: u, widthHint: 0, densityHint: 0, source: "cross-ref" }, true);
      } else if (
        authoritativeFolders.size > 0 &&
        !isImobiliareThumbnailUrl(u) &&
        authoritativeFolders.has(extractRoamcdnListingFolder(u) || "")
      ) {
        addCandidate({ url: u, widthHint: 0, densityHint: 0, source: "folder-harvest" }, false);
      }
    }
  } else if (authoritativeFolders.size > 0) {
    // Initial SSR HTML (modal not mounted yet): harvest ALL photos sharing THIS listing's exact folder token.
    // First add any hero/thumbnail-strip order if present so gallery display order matches Imobiliare.ro.
    const $isolatedOrder = cheerio.load(html || "");
    for (const sel of IMOBILIARE_NON_GALLERY_SECTIONS) {
      $isolatedOrder(sel).remove();
    }
    $isolatedOrder("button.listing-thumbnail img, button.listing-thumbnail-modal img").each(
      (_: any, el: any) => {
        const raw = $isolatedOrder(el).attr("src") || $isolatedOrder(el).attr("data-src");
        const norm = raw ? normalizeImobiliareImageUrl(raw, pageUrl) : null;
        if (norm && authoritativeFolders.has(extractRoamcdnListingFolder(norm) || "")) {
          addCandidate({ url: norm, widthHint: 0, densityHint: 0, source: "folder-harvest" }, false);
        }
      }
    );

    for (const u of allDocumentRoamUrls) {
      if (isSimilarListingPreset(u)) continue;
      const folder = extractRoamcdnListingFolder(u);
      if (folder && authoritativeFolders.has(folder)) {
        addCandidate({ url: u, widthHint: 0, densityHint: 0, source: "folder-harvest" }, false);
      } else if (candidatesByKey.has(getImobiliarePhotoKey(u))) {
        addCandidate({ url: u, widthHint: 0, densityHint: 0, source: "cross-ref" }, true);
      }
    }

    if (source === "none" && candidatesByKey.size > 0) {
      source = "folder-harvest";
    }
  }

  // STEP 5: Secondary explicit gallery containers (for legacy non-RoamCDN / older Imobiliare pages)
  if (candidatesByKey.size === 0) {
    const $isolated = cheerio.load(html || "");
    for (const sel of IMOBILIARE_NON_GALLERY_SECTIONS) {
      $isolated(sel).remove();
    }
    const $secondary = $isolated(IMOBILIARE_SECONDARY_GALLERY_SELECTORS.join(", "));
    if ($secondary.length > 0) {
      collectCandidatesFromContainer($isolated, $secondary, pageUrl, "secondary-gallery", (c) => {
        if (!isSimilarListingPreset(c.url)) {
          addCandidate(c, false);
        }
      });
      if (candidatesByKey.size > 0) {
        source = "secondary-gallery";
        for (const u of allDocumentRoamUrls) {
          addCandidate({ url: u, widthHint: 0, densityHint: 0, source: "cross-ref" }, true);
        }
      }
    }
  }

  // STEP 6: Final safe fallback (JSON-LD listing images + og:image, skipping Organization/Agent)
  if (candidatesByKey.size === 0) {
    $("script[type='application/ld+json']").each((_: any, el: any) => {
      const content = $(el).html();
      if (!content) return;
      try {
        const ld = JSON.parse(content);
        const items = Array.isArray(ld) ? ld : ld["@graph"] ? ld["@graph"] : [ld];
        for (const item of items) {
          const itemType = String(item?.["@type"] || "").toLowerCase();
          if (itemType.includes("organization") || itemType.includes("agent") || itemType.includes("person")) {
            continue;
          }
          if (!item?.image) continue;
          const imgs = Array.isArray(item.image) ? item.image : [item.image];
          for (const img of imgs) {
            const raw = typeof img === "string" ? img : img?.url || img?.contentUrl;
            const norm = raw ? normalizeImobiliareImageUrl(raw, pageUrl) : null;
            if (norm && !isSimilarListingPreset(norm)) {
              addCandidate({ url: norm, widthHint: 0, densityHint: 0, source: "fallback" }, false);
            }
          }
        }
      } catch {
        // Ignore invalid JSON-LD
      }
    });

    if (candidatesByKey.size === 0) {
      const ogImg =
        $('meta[property="og:image"]').attr("content") ||
        $('meta[name="twitter:image"]').attr("content");
      if (typeof ogImg === "string") {
        const norm = normalizeImobiliareImageUrl(ogImg, pageUrl);
        if (norm && !isSimilarListingPreset(norm)) {
          addCandidate({ url: norm, widthHint: 0, densityHint: 0, source: "fallback" }, false);
        }
      }
    }

    if (candidatesByKey.size > 0) {
      source = "fallback";
    }
  }

  // STEP 7: Select the single highest-resolution URL for each unique photo key (preserving gallery order)
  const finalImages: string[] = [];
  const observedHighResPresets = new Set<string>();
  let remainingThumbnailsCount = 0;

  for (const [, candidates] of candidatesByKey.entries()) {
    let best = candidates[0];
    let bestScore = scoreImobiliareImageResolution(best.url, best.widthHint, best.densityHint);

    for (let i = 1; i < candidates.length; i++) {
      const c = candidates[i];
      const s = scoreImobiliareImageResolution(c.url, c.widthHint, c.densityHint);
      if (s > bestScore) {
        best = c;
        bestScore = s;
      }
    }

    finalImages.push(best.url);
    if (isImobiliareThumbnailUrl(best.url)) {
      remainingThumbnailsCount++;
    } else {
      const preset = extractRoamcdnPreset(best.url);
      if (preset && !isSimilarListingPreset(best.url)) {
        observedHighResPresets.add(preset);
      }
    }
  }

  return {
    images: finalImages,
    source,
    primaryPanelFound,
    remainingThumbnailsCount,
    observedHighResPresets: Array.from(observedHighResPresets),
    authoritativeFolders: Array.from(authoritativeFolders),
  };
}

/**
 * Merges two Imobiliare gallery extraction results (e.g., static HTML + live browser modal sweep),
 * always picking the highest-resolution variant per canonical photo key and preserving gallery order.
 */
export function mergeImobiliareGalleryResults(
  primary: ImobiliareGalleryExtractionResult,
  secondary: ImobiliareGalleryExtractionResult | null
): ImobiliareGalleryExtractionResult {
  if (!secondary || secondary.images.length === 0) return primary;
  if (primary.images.length === 0) return secondary;

  const primaryHighRes = primary.images.length - primary.remainingThumbnailsCount;
  const secondaryHighRes = secondary.images.length - secondary.remainingThumbnailsCount;

  // Use the result with more high-resolution images (or primary panel) as the base ordering
  const [base, extra] =
    secondaryHighRes > primaryHighRes || (secondary.primaryPanelFound && !primary.primaryPanelFound)
      ? [secondary, primary]
      : [primary, secondary];

  const mergedByKey = new Map<string, string>();
  const addBest = (url: string) => {
    const key = getImobiliarePhotoKey(url);
    const existing = mergedByKey.get(key);
    if (!existing || scoreImobiliareImageResolution(url) > scoreImobiliareImageResolution(existing)) {
      mergedByKey.set(key, url);
    }
  };

  for (const u of base.images) addBest(u);
  for (const u of extra.images) addBest(u);

  const images = Array.from(mergedByKey.values());
  const observedHighResPresets = new Set<string>([
    ...base.observedHighResPresets,
    ...extra.observedHighResPresets,
  ]);
  const authoritativeFolders = new Set<string>([
    ...base.authoritativeFolders,
    ...extra.authoritativeFolders,
  ]);

  let remainingThumbnailsCount = 0;
  for (const u of images) {
    if (isImobiliareThumbnailUrl(u)) remainingThumbnailsCount++;
  }

  return {
    images,
    source: base.source,
    primaryPanelFound: base.primaryPanelFound || extra.primaryPanelFound,
    remainingThumbnailsCount,
    observedHighResPresets: Array.from(observedHighResPresets),
    authoritativeFolders: Array.from(authoritativeFolders),
  };
}

/**
 * Generates candidate full-resolution URLs for a thumbnail URL (to be verified before swapping).
 */
export function buildImobiliareHighResUpgradeCandidates(
  thumbUrl: string,
  observedHighResPresets: string[] = []
): string[] {
  const candidates: string[] = [];
  const pushUnique = (u: string) => {
    if (u && u !== thumbUrl && !candidates.includes(u)) {
      candidates.push(u);
    }
  };

  // 1. RoamCDN preset replacement (note: cryptographically signed roamcdn URLs will return 400/403
  //    and be safely skipped by the probe; unsigned/legacy roamcdn URLs upgrade cleanly).
  const currentPreset = extractRoamcdnPreset(thumbUrl);
  if (currentPreset) {
    const orderedPresets = [
      ...observedHighResPresets,
      ...DEFAULT_ROAMCDN_HIGHRES_PRESETS,
    ];
    for (const preset of orderedPresets) {
      if (!preset || preset === currentPreset) continue;
      const upgraded = thumbUrl.replace(
        /(\/prop\/[^/]+\/)([^/]+)(\/)/i,
        `$1${preset}$3`
      );
      pushUnique(upgraded);
    }
  }

  // 2. Thumbor / fit-in dimensions
  if (/\/fit-in\/\d{2,4}x\d{2,4}\//i.test(thumbUrl)) {
    pushUnique(thumbUrl.replace(/\/fit-in\/\d{2,4}x\d{2,4}\//i, "/fit-in/1600x1200/"));
    pushUnique(thumbUrl.replace(/\/fit-in\/\d{2,4}x\d{2,4}\//i, "/fit-in/1200x900/"));
  }

  // 3. Legacy filename dimensions
  if (/_\d{2,4}x\d{2,4}\.(?:jpe?g|png|webp|avif)(?:[?#]|$)/i.test(thumbUrl)) {
    pushUnique(thumbUrl.replace(/_\d{2,4}x\d{2,4}(\.(?:jpe?g|png|webp|avif))/i, "_1200x900$1"));
    pushUnique(thumbUrl.replace(/_\d{2,4}x\d{2,4}(\.(?:jpe?g|png|webp|avif))/i, "_1024x768$1"));
    pushUnique(thumbUrl.replace(/_\d{2,4}x\d{2,4}(\.(?:jpe?g|png|webp|avif))/i, "_800x600$1"));
  }

  // 4. Legacy directory segments
  if (/\/(?:thumb|thumbs|thumbnail|small|mini)\//i.test(thumbUrl)) {
    pushUnique(thumbUrl.replace(/\/(?:thumb|thumbs|thumbnail|small|mini)\//i, "/full/"));
    pushUnique(thumbUrl.replace(/\/(?:thumb|thumbs|thumbnail|small|mini)\//i, "/large/"));
  }

  // 5. Query width params
  try {
    const parsed = new URL(thumbUrl);
    for (const key of ["w", "width"]) {
      const val = parsed.searchParams.get(key);
      if (val && /^\d{2,4}$/.test(val) && Number(val) < 600) {
        const u1600 = new URL(thumbUrl);
        u1600.searchParams.set(key, "1600");
        pushUnique(u1600.toString());

        const u1200 = new URL(thumbUrl);
        u1200.searchParams.set(key, "1200");
        pushUnique(u1200.toString());
      }
    }
  } catch {
    // Ignore parse error
  }

  return candidates;
}

const defaultProbeImageUrl: ThumbnailProbeFn = async (url: string): Promise<ThumbnailProbeResult> => {
  try {
    const res = await safeFetchExternal(url, {
      timeout: 4000,
      responseType: "arraybuffer",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
        Referer: "https://www.imobiliare.ro/",
        Range: "bytes=0-2047",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });

    if (res.status === 200 || res.status === 206) {
      const rawCt = res.headers["content-type"];
      const contentType = Array.isArray(rawCt) ? rawCt[0] : String(rawCt || "");
      const contentRange = String(res.headers["content-range"] || "");
      const rangeTotalMatch = contentRange.match(/\/(\d+)$/);
      const rawLen = res.headers["content-length"];
      const parsedLen = rangeTotalMatch
        ? Number(rangeTotalMatch[1])
        : rawLen
          ? Number(Array.isArray(rawLen) ? rawLen[0] : rawLen)
          : null;

      return {
        ok:
          contentType.toLowerCase().startsWith("image/") &&
          !contentType.toLowerCase().includes("svg"),
        contentType,
        contentLength: Number.isFinite(parsedLen) ? parsedLen : null,
      };
    }

    return { ok: false, contentType: "", contentLength: null };
  } catch {
    return { ok: false, contentType: "", contentLength: null };
  }
};

/**
 * Safely upgrades any remaining thumbnail URLs in an extracted Imobiliare gallery
 * by verifying candidate full-resolution URLs return HTTP 200/206 + valid image/*.
 * Never replaces a working URL with a 400/403/404 rewritten URL.
 */
export async function upgradeRemainingImobiliareThumbnails(
  images: string[],
  options: {
    observedHighResPresets?: string[];
    probeFn?: ThumbnailProbeFn;
    maxBudgetMs?: number;
    concurrency?: number;
  } = {}
): Promise<string[]> {
  if (!images || images.length === 0) return [];

  const thumbIndices: number[] = [];
  for (let i = 0; i < images.length; i++) {
    if (isImobiliareThumbnailUrl(images[i])) {
      thumbIndices.push(i);
    }
  }
  if (thumbIndices.length === 0) return images;

  const probeFn = options.probeFn || defaultProbeImageUrl;
  const maxBudgetMs = options.maxBudgetMs ?? 10000;
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 6, thumbIndices.length));
  const deadline = Date.now() + maxBudgetMs;
  const observedPresets = options.observedHighResPresets || [];

  const result = [...images];
  let cursor = 0;

  const worker = async () => {
    while (true) {
      if (Date.now() > deadline) break;
      const pos = cursor++;
      if (pos >= thumbIndices.length) break;
      const imgIdx = thumbIndices[pos];
      const originalUrl = result[imgIdx];

      const candidates = buildImobiliareHighResUpgradeCandidates(originalUrl, observedPresets);
      for (const candidate of candidates) {
        if (Date.now() > deadline) break;
        const probe = await probeFn(candidate);
        const sizeOk = probe.contentLength === null || probe.contentLength >= 10000;
        if (probe.ok && sizeOk) {
          result[imgIdx] = candidate;
          break;
        }
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return result;
}

/**
 * Headless-browser gallery extractor for Imobiliare.ro.
 * Used when static HTML did not include all full-resolution gallery URLs (e.g. <= 1 image or
 * remaining 140w thumbnails because Vue virtualizes `#detail-gallery-modal-panel-gallery` slides).
 *
 * Strategy:
 * 1. Intercepts JSON/API responses from `imobiliare.ro` to capture signed `gallery-full-*` URLs.
 * 2. Opens `#detail-gallery-modal-panel-gallery` (clicking the hero gallery image if closed).
 * 3. Sweeps through `button.listing-thumbnail-modal` (every 2nd slide + last) so Vue mounts
 *    every virtualized slide's full-resolution `<img src="...gallery-full-1200w-watermark/...">`
 *    regardless of whether the property has 3, 13, or 50 photos.
 */
export async function extractImobiliareGalleryViaBrowser(
  pageUrl: string,
  options: {
    isForbiddenGraphic?: (urlStr: string) => boolean;
    blockedAgencyPaths?: Set<string>;
    getBaseUrlPath?: (u: string) => string;
  } = {}
): Promise<ImobiliareGalleryExtractionResult | null> {
  if (process.env.NODE_ENV === "test") return null;
  if (!isImobiliareUrl(pageUrl)) return null;

  try {
    await validateSafeExternalUrl(pageUrl);
  } catch {
    return null;
  }

  try {
    return await ScrapeWorkerService.withScrapeSlot(
      {
        tenantId: "platform",
        operation: "imobiliare_gallery_extract",
      },
      async () => {
        const puppeteerModule: any = await import("puppeteer");
        const puppeteer = puppeteerModule.default || puppeteerModule;
        const browser = await puppeteer.launch({
          headless: true,
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--disable-blink-features=AutomationControlled",
            "--no-first-run",
            "--no-zygote",
          ],
        });

        let page: any = null;
        try {
          page = await browser.newPage();
          await page.setViewport({ width: 1440, height: 900 });
          await page.setUserAgent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
          );
          await page.setExtraHTTPHeaders({
            "Accept-Language": "ro-RO,ro;q=0.9,en-US;q=0.8,en;q=0.7",
          });

          const collectedFullUrls = new Set<string>();

          // 1. Intercept Imobiliare JSON / Nuxt payload responses carrying signed roamcdn gallery URLs
          page.on("response", async (resp: any) => {
            try {
              const respUrl = String(resp.url() || "");
              if (!respUrl.includes("imobiliare.ro")) return;
              const status = resp.status();
              if (status < 200 || status >= 300) return;
              const ct = String(resp.headers()?.["content-type"] || "").toLowerCase();
              if (!ct.includes("json") && !respUrl.includes("_payload")) return;
              const text = await resp.text();
              if (!text || text.length > 5_000_000 || !text.includes("roamcdn.net")) return;
              for (const u of scanRawTextForImobiliareUrls(text, pageUrl)) {
                if (!isSimilarListingPreset(u)) {
                  collectedFullUrls.add(u);
                }
              }
            } catch {
              // ignore individual response read errors
            }
          });

          await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
          await new Promise((r) => setTimeout(r, 800));

          // Dismiss cookie consent overlays if present
          await page
            .evaluate(() => {
              const cookieSelectors = [
                "#onetrust-accept-btn-handler",
                'button[id*="accept-cookies"]',
                'button[data-testid="accept-cookies"]',
              ];
              for (const sel of cookieSelectors) {
                const btn = document.querySelector(sel) as HTMLElement | null;
                if (btn && btn.offsetParent !== null) {
                  btn.click();
                  break;
                }
              }
            })
            .catch(() => {});

          // Check if `#detail-gallery-modal-panel-gallery` is already mounted; if not, click cover photo to open modal
          const hasModalPanel = async (): Promise<boolean> =>
            page
              .evaluate(() => {
                const panel =
                  document.querySelector("#detail-gallery-modal-panel-gallery") ||
                  document.querySelector('[role="tabpanel"][aria-labelledby="detail-gallery-modal-tab-gallery"]');
                return Boolean(panel && panel.querySelectorAll("img").length > 0);
              })
              .catch(() => false);

          if (!(await hasModalPanel())) {
            await page
              .evaluate(() => {
                const triggerSelectors = [
                  '[aria-controls="detail-gallery-modal-panel-gallery"]',
                  "#detail-gallery-modal-tab-gallery",
                  'img[src*="roamcdn.net/prop/imo/gallery-full"]',
                  'img[src*="roamcdn.net/prop/imo/gallery-main"]',
                  'button.listing-thumbnail',
                  '[data-cy*="gallery"] img',
                  '[data-testid*="gallery"] img',
                  '[class*="gallery"] img',
                ];
                for (const sel of triggerSelectors) {
                  const el = document.querySelector(sel) as HTMLElement | null;
                  if (el && el.offsetParent !== null) {
                    el.click();
                    break;
                  }
                }
              })
              .catch(() => {});

            await page
              .waitForSelector(
                '#detail-gallery-modal-panel-gallery img, [role="tabpanel"][aria-labelledby="detail-gallery-modal-tab-gallery"] img',
                { timeout: 5000 }
              )
              .catch(() => {});
          }

          // Helper to snapshot all visible full-res images inside `#detail-gallery-modal-panel-gallery`
          const snapshotModalImages = async (): Promise<string[]> =>
            page
              .evaluate(() => {
                const panel =
                  document.querySelector("#detail-gallery-modal-panel-gallery") ||
                  document.querySelector('[role="tabpanel"][aria-labelledby="detail-gallery-modal-tab-gallery"]');
                if (!panel) return [];
                const urls: string[] = [];
                panel.querySelectorAll("img").forEach((img) => {
                  if (img.getAttribute("aria-hidden") === "true" && img.className.includes("blur")) {
                    return;
                  }
                  const src = img.getAttribute("src") || img.getAttribute("data-src") || "";
                  if (src) urls.push(src);
                });
                return urls;
              })
              .catch(() => []);

          for (const u of await snapshotModalImages()) {
            const norm = normalizeImobiliareImageUrl(u, pageUrl);
            if (norm) collectedFullUrls.add(norm);
          }

          // Sweep virtualized Vue carousel inside `#detail-gallery-modal-panel-gallery` so ALL slides mount their full-res `<img>`
          const thumbCount: number = await page
            .evaluate(() => {
              const panel =
                document.querySelector("#detail-gallery-modal-panel-gallery") ||
                document.querySelector('[role="tabpanel"][aria-labelledby="detail-gallery-modal-tab-gallery"]');
              if (!panel) return 0;
              return panel.querySelectorAll("button.listing-thumbnail-modal, button.listing-thumbnail").length;
            })
            .catch(() => 0);

          if (thumbCount > 1) {
            // Vue mounts slides within ±2 of the active slide; clicking every 2nd thumbnail (+ last) mounts 100% of slides fast.
            const maxThumbs = Math.min(thumbCount, 60);
            const indicesToClick: number[] = [];
            for (let idx = 0; idx < maxThumbs; idx += 2) {
              indicesToClick.push(idx);
            }
            if (indicesToClick[indicesToClick.length - 1] !== maxThumbs - 1) {
              indicesToClick.push(maxThumbs - 1);
            }

            for (const idx of indicesToClick) {
              await page
                .evaluate((targetIdx: number) => {
                  const panel =
                    document.querySelector("#detail-gallery-modal-panel-gallery") ||
                    document.querySelector('[role="tabpanel"][aria-labelledby="detail-gallery-modal-tab-gallery"]');
                  if (!panel) return;
                  const btns = panel.querySelectorAll("button.listing-thumbnail-modal, button.listing-thumbnail");
                  const btn = btns[targetIdx] as HTMLElement | undefined;
                  if (btn) btn.click();
                }, idx)
                .catch(() => {});

              await new Promise((r) => setTimeout(r, 160));
              for (const u of await snapshotModalImages()) {
                const norm = normalizeImobiliareImageUrl(u, pageUrl);
                if (norm) collectedFullUrls.add(norm);
              }
            }
          } else {
            // Fallback: step using Next arrow button if thumbnail buttons aren't present
            let staleSteps = 0;
            for (let step = 0; step < 30; step++) {
              const prevCount = collectedFullUrls.size;
              const clickedNext = await page
                .evaluate(() => {
                  const panel =
                    document.querySelector("#detail-gallery-modal-panel-gallery") ||
                    document.querySelector('[role="tabpanel"][aria-labelledby="detail-gallery-modal-tab-gallery"]');
                  const btn = panel?.querySelector(
                    'button[aria-label="Fotografia următoare"], button.gallery-arrow:last-of-type'
                  ) as HTMLElement | null;
                  if (!btn) return false;
                  btn.click();
                  return true;
                })
                .catch(() => false);
              if (!clickedNext) break;
              await new Promise((r) => setTimeout(r, 180));
              for (const u of await snapshotModalImages()) {
                const norm = normalizeImobiliareImageUrl(u, pageUrl);
                if (norm) collectedFullUrls.add(norm);
              }
              if (collectedFullUrls.size === prevCount) {
                staleSteps++;
                if (staleSteps >= 2) break;
              } else {
                staleSteps = 0;
              }
            }
          }

          // Also read any in-memory window.__NUXT__ state strings containing roamcdn URLs
          const nuxtMemoryUrls: string[] = await page
            .evaluate(() => {
              try {
                const nuxt = (window as any).__NUXT__;
                if (!nuxt) return [];
                const json = JSON.stringify(nuxt);
                const matches = json.match(/https?:\/\/[^"'\\]*roamcdn\.net[^"'\\]*\.(?:jpe?g|png|webp|avif)/gi);
                return matches ? Array.from(new Set(matches)) : [];
              } catch {
                return [];
              }
            })
            .catch(() => []);
          for (const u of nuxtMemoryUrls) {
            const norm = normalizeImobiliareImageUrl(u, pageUrl);
            if (norm && !isSimilarListingPreset(norm)) collectedFullUrls.add(norm);
          }

          const liveHtml = await page.content();
          const $live = cheerio.load(liveHtml);
          const extracted = extractImobiliareGalleryPhotos({
            $: $live,
            html: liveHtml,
            pageUrl,
            isForbiddenGraphic: options.isForbiddenGraphic,
            blockedAgencyPaths: options.blockedAgencyPaths,
            getBaseUrlPath: options.getBaseUrlPath,
            extraHighResUrls: Array.from(collectedFullUrls),
          });

          if (extracted.images.length > 0) {
            return extracted;
          }
          return null;
        } finally {
          if (page) {
            await page.close().catch(() => {});
          }
          await browser.close().catch(() => {});
        }
      }
    );
  } catch (err: any) {
    logger.warn(
      `[ImobiliareBrowserGallery] Browser gallery extraction skipped/failed for ${pageUrl}: ${err?.message || "unknown"}`,
      { module: "crawler" }
    );
    return null;
  }
}
