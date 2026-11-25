import { PublicPropertyCacheService } from "../../src/core/cache/svc_public-property-cache";
import { MediaPipelineService } from "../media/svc_media-pipeline";
import { invalidateProtectedImagesForProperty } from "../security/sec_public-media";
import {
  extractOrderedPublicImageUrls,
  getImageIdentityKey,
  normalizeStoredImageUrl,
} from "../../src/utils/publicContentUtils";

type PublicShareWarmerFn = (propCode: string, sources: string[]) => void;

let registeredPublicShareWarmer: PublicShareWarmerFn | null = null;

/**
 * Registers the server-side mosaic WebP warmer (`warmPublicShareMosaicImages` from `server.ts`)
 * without creating circular module imports.
 */
export function registerPublicShareWarmer(warmer: PublicShareWarmerFn | null): void {
  registeredPublicShareWarmer = warmer;
}

function sanitizePrewarmImageUrls(rawUrls: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const item of rawUrls) {
    if (out.length >= 5) break;
    if (typeof item !== "string") continue;
    const normalized = normalizeStoredImageUrl(item) || item.trim();
    if (!normalized) continue;
    if (normalized.startsWith("data:") || normalized.startsWith("blob:")) continue;
    // Allow strictly safe relative media routes or HTTP(S) URLs (further validated by SSRF guard on fetch)
    const isAllowed =
      normalized.startsWith("/api/storage/media/") ||
      normalized.startsWith("/uploads/") ||
      /^https?:\/\//i.test(normalized);
    if (!isAllowed) continue;

    const dedupKey = getImageIdentityKey(normalized) || normalized;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    out.push(normalized);
  }

  return out;
}

/**
 * Triggers asynchronous, non-blocking pre-warming of the first 5 public share mosaic
 * WebP variants (`w=1280` hero + `w=640` mosaic 2-5) when a property is saved or shared,
 * so even the very first external visitor gets an instant cache hit.
 */
export function schedulePublicShareImagePrewarm(
  propCode: string | null | undefined,
  rawSources: unknown[] | null | undefined
): number {
  if (!registeredPublicShareWarmer) return 0;
  if (!Array.isArray(rawSources) || rawSources.length === 0) return 0;

  const cleanCode = String(propCode || "BROKR")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 16) || "BROKR";
  const sources = sanitizePrewarmImageUrls(rawSources);
  if (sources.length === 0) return 0;

  try {
    registeredPublicShareWarmer(cleanCode, sources);
    return sources.length;
  } catch {
    return 0;
  }
}

/**
 * Extracts the share code and ordered first 5 images from a saved Lead / Property / Cerere
 * record and schedules non-blocking public share mosaic WebP pre-warming.
 */
export function schedulePublicSharePrewarmFromRecord(
  record: Record<string, any> | null | undefined,
  fallbackId?: string
): number {
  if (!record || typeof record !== "object") return 0;
  const propCode = String(
    record.propertyId || record.sourcePropertyId || record.id || fallbackId || ""
  ).trim();
  if (!propCode) return 0;

  const ordered = extractOrderedPublicImageUrls(record);
  if (ordered.length === 0) return 0;
  return schedulePublicShareImagePrewarm(propCode, ordered.slice(0, 5));
}

/**
 * Central per-entity cache invalidator for external public share pages (`/share/:id`,
 * `/api/public-property/:id`, `/api/og-image/:id`, and protected property image variants).
 *
 * Strictly erases cached data ONLY for the modified lead/cerere/property IDs (and its
 * share code aliases), leaving every other property cached and fast.
 */
export function invalidateEntityPublicShareCaches(
  ids?: string | string[] | null,
  tenantId?: string | null
): {
  propertyCacheRemoved: number;
  ogCacheRemoved: number;
  imageCacheRemoved: number;
} {
  const idList = Array.isArray(ids)
    ? Array.from(new Set(ids.map((v) => String(v || "").trim()).filter(Boolean)))
    : typeof ids === "string" && ids.trim()
      ? [ids.trim()]
      : [];

  const propertyCacheRemoved = PublicPropertyCacheService.invalidate(
    idList.length > 0 ? idList : null,
    tenantId
  );
  const ogCacheRemoved =
    idList.length > 0 ? MediaPipelineService.invalidateOgCacheForShareCodes(idList) : 0;
  const imageCacheRemoved =
    idList.length > 0 ? invalidateProtectedImagesForProperty(idList) : 0;

  return {
    propertyCacheRemoved,
    ogCacheRemoved,
    imageCacheRemoved,
  };
}
