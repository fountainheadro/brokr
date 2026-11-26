/**
 * Determines whether a lead/property should display modified (CRM/AI-formatted) title & description
 * on external public shared pages, or the exact original ad title & description from the source
 * advertising platform (e.g. OLX).
 *
 * Rule:
 * - Modified title & description are used ONLY if the lead has been moved to Selectate (`ListaMea`)
 *   or transformed into a Property (or Cerere).
 * - Otherwise (raw leads in Listate/`Noi`, `Pierdute`, `Nevalidata`, `isSharedLead`), the exact
 *   original title & description from the source platform ad are used.
 */

const MODIFIED_CONTENT_STATUSES = new Set([
  "ListaMea",
  "Selectate",
  "Lista Mea",
  "Noua",
  "Prospectare",
  "Colaborare",
  "Vizionare",
  "Ofertare",
  "Antecontract",
  "Contract",
  "Activa",
  "InNegociere",
  "Finalizata",
  "Arhiva",
  "Calificare",
  "Matching",
  "AreInteres",
]);

function nonEmptyString(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

export function shouldUseModifiedAdContent(lead: Record<string, any> | null | undefined): boolean {
  if (!lead || typeof lead !== "object") return false;

  const status = nonEmptyString(lead.status);
  const propId = nonEmptyString(lead.propertyId).toUpperCase();

  // Explicitly transformed into a Property (P123) or Cerere (C123 / R123)
  if (/^(?:P|C|R)\d+$/i.test(propId)) {
    return true;
  }

  // Raw shared platform leads that have not been moved into Selectate or Property
  if (lead.isSharedLead === true && !MODIFIED_CONTENT_STATUSES.has(status)) {
    return false;
  }

  return MODIFIED_CONTENT_STATUSES.has(status);
}

export function resolvePublicDisplayTitle(
  lead: Record<string, any> | null | undefined,
  fallbackTitle = "Proprietate Rezidențială"
): string {
  if (!lead || typeof lead !== "object") return fallbackTitle;

  const ext = lead.extractedData || {};
  const crmTitle = nonEmptyString(ext?.crmData?.descriere?.titlu);
  const leadTitle = nonEmptyString(lead.title);
  const originalTitle =
    nonEmptyString(ext?.originalTitle) ||
    nonEmptyString(ext?.olxMeta?.originalTitle) ||
    nonEmptyString(lead.originalTitle);

  if (ext?.titleManuallyEdited === true) {
    return leadTitle || crmTitle || originalTitle || fallbackTitle;
  }

  if (shouldUseModifiedAdContent(lead)) {
    return leadTitle || crmTitle || originalTitle || fallbackTitle;
  }

  return originalTitle || leadTitle || crmTitle || fallbackTitle;
}

export function resolvePublicDisplayDescription(
  lead: Record<string, any> | null | undefined,
  fallbackSummary = ""
): string {
  if (!lead || typeof lead !== "object") return fallbackSummary;

  const ext = lead.extractedData || {};
  const crmDescription = nonEmptyString(ext?.crmData?.descriere?.continut);
  const marketingDescription = nonEmptyString(ext?.markdownMarketing);
  const introSummary = nonEmptyString(ext?.presentationSections?.introducere?.summary);
  const originalDescription =
    nonEmptyString(ext?.originalDescription) ||
    nonEmptyString(lead.originalDescription) ||
    nonEmptyString(lead.description);

  if (shouldUseModifiedAdContent(lead)) {
    return (
      crmDescription ||
      marketingDescription ||
      introSummary ||
      originalDescription ||
      fallbackSummary
    );
  }

  // For raw leads (Listate / Noi, Pierdute, Nevalidata, etc.), strictly prefer the exact
  // original ad description from the advertising platform (e.g. OLX), NOT the short auto-generated summary.
  return originalDescription || crmDescription || fallbackSummary;
}

function extractImageUrlFromItem(item: unknown): string {
  if (typeof item === "string") return item.trim();
  if (item && typeof item === "object") {
    const obj = item as Record<string, unknown>;
    const candidate =
      nonEmptyString(obj.original) ||
      nonEmptyString(obj.url) ||
      nonEmptyString(obj.src);
    if (candidate) return candidate;
  }
  return "";
}

/**
 * Strips display-only thumbnail parameters (`?w=...`) and unwraps plain `/api/proxy-image?url=...`
 * wrappers back to clean canonical URLs for storage, while preserving explicit regeneration
 * flags (`aggressive=1`, `regen=...`) and `/api/storage/media/...` / `/api/public-image?...` paths.
 */
export function normalizeStoredImageUrl(raw: unknown): string {
  let url = extractImageUrlFromItem(raw).replace(/&amp;/gi, "&");
  if (!url) return "";
  if (url.startsWith("data:") || url.startsWith("blob:")) return url;

  if (url.startsWith("/api/proxy-image") || url.includes("/api/proxy-image?")) {
    try {
      const parsed = new URL(url, "https://placeholder.local");
      const inner = parsed.searchParams.get("url");
      const hasRegenFlags =
        parsed.searchParams.has("aggressive") || parsed.searchParams.has("regen");
      if (inner && !hasRegenFlags) {
        url = inner.trim().replace(/&amp;/gi, "&");
      } else if (hasRegenFlags) {
        parsed.searchParams.delete("w");
        const qs = parsed.searchParams.toString();
        return qs ? `${parsed.pathname}?${qs}` : parsed.pathname;
      }
    } catch {
      // Keep original on parse failure
    }
  }

  if (url.startsWith("//")) {
    url = `https:${url}`;
  }

  // Strip display-only ?w= thumbnail param from local/storage/public image URLs
  if (
    url.startsWith("/api/storage/") ||
    url.startsWith("/uploads/") ||
    url.startsWith("/api/public-image")
  ) {
    const qIdx = url.indexOf("?");
    if (qIdx !== -1) {
      const base = url.slice(0, qIdx);
      const params = new URLSearchParams(url.slice(qIdx + 1));
      params.delete("w");
      const qs = params.toString();
      return qs ? `${base}?${qs}` : base;
    }
  }

  return url;
}

/**
 * Returns a stable canonical identity key for deduplicating and matching the same photo
 * across raw external URLs, `/api/proxy-image?url=...` wrappers, `?w=...` thumbnail variants,
 * and `/api/storage/media/...` paths.
 */
export function getImageIdentityKey(raw: unknown): string {
  let url = extractImageUrlFromItem(raw).replace(/&amp;/gi, "&");
  if (!url) return "";
  if (url.startsWith("data:") || url.startsWith("blob:")) return url;

  // Unwrap any proxy-image wrapper(s) to get the underlying source identity
  for (let depth = 0; depth < 3; depth++) {
    if (url.startsWith("/api/proxy-image") || url.includes("/api/proxy-image?")) {
      try {
        const parsed = new URL(url, "https://placeholder.local");
        const inner = parsed.searchParams.get("url");
        if (inner) {
          url = inner.trim().replace(/&amp;/gi, "&");
          continue;
        }
      } catch {
        break;
      }
    }
    break;
  }

  if (url.startsWith("//")) {
    url = `https:${url}`;
  }

  // Normalize relative or absolute /api/storage/media/... and /uploads/... paths
  if (/^https?:\/\//i.test(url)) {
    try {
      const parsed = new URL(url);
      if (
        parsed.pathname.startsWith("/api/storage/media/") ||
        parsed.pathname.startsWith("/api/storage/public-shares/") ||
        parsed.pathname.startsWith("/uploads/")
      ) {
        url = parsed.pathname;
      }
    } catch {
      // Keep as-is
    }
  }

  if (
    url.startsWith("/api/storage/media/") ||
    url.startsWith("/api/storage/public-shares/") ||
    url.startsWith("/uploads/")
  ) {
    const cleanPath = url.split("?")[0].split("#")[0];
    try {
      return decodeURIComponent(cleanPath);
    } catch {
      return cleanPath;
    }
  }

  if (url.startsWith("/api/public-image")) {
    const qIdx = url.indexOf("?");
    if (qIdx !== -1) {
      const params = new URLSearchParams(url.slice(qIdx + 1));
      const token = params.get("token");
      if (token) return `/api/public-image?token=${token}`;
    }
  }

  return url;
}

/**
 * Collects all property/lead image URLs in exact display priority order matching the shared page:
 * - When an explicit `images` array is present on the document (e.g. after gallery reorder, upload, or delete),
 *   its exact saved order takes precedence so shuffled photos and deletions are faithfully preserved.
 * - If `images` is explicitly empty (`[]`) and `coverImage` is empty (`""`), returns `[]` so deleted galleries
 *   do not resurrect stale photos from `extractedData.crmData.imagini`.
 * - For legacy records without an explicit `images` array, falls back to `coverImage` + `crmData.imagini`.
 */
export function extractOrderedPublicImageUrls(
  lead: Record<string, any> | null | undefined
): string[] {
  if (!lead || typeof lead !== "object") return [];

  const urls: string[] = [];
  const seen = new Set<string>();
  const addUrl = (raw: unknown) => {
    const u = extractImageUrlFromItem(raw);
    if (!u) return;
    const identity = getImageIdentityKey(u) || u;
    if (seen.has(identity)) return;
    seen.add(identity);
    urls.push(u);
  };

  const hasExplicitImagesArray = Array.isArray(lead.images);
  const coverUrl = extractImageUrlFromItem(lead.coverImage);

  // Explicit empty gallery (user deleted all photos)
  if (hasExplicitImagesArray && lead.images.length === 0 && !coverUrl) {
    return [];
  }

  if (hasExplicitImagesArray && lead.images.length > 0) {
    // Preserve exact user-saved gallery order first
    const imageIdentities = new Set(
      lead.images.map((item: unknown) => getImageIdentityKey(item)).filter(Boolean)
    );
    // Only prepend coverImage if it isn't already in the ordered `images` array
    if (coverUrl && !imageIdentities.has(getImageIdentityKey(coverUrl))) {
      addUrl(coverUrl);
    }
    for (const item of lead.images) {
      addUrl(item);
    }
  } else {
    addUrl(coverUrl);
  }

  const crmImagini = lead.extractedData?.crmData?.imagini;
  if (crmImagini && typeof crmImagini === "object") {
    const categories = ["living", "camera", "bucatarie", "baie", "alteSpatii"] as const;
    for (const cat of categories) {
      const list = crmImagini[cat];
      if (Array.isArray(list)) {
        for (const item of list) {
          addUrl(item);
        }
      }
    }
  }

  return urls;
}

/**
 * Resolves the exact first image URL of a property/lead for OpenGraph thumbnails.
 */
export function resolvePublicFirstImageUrl(
  lead: Record<string, any> | null | undefined
): string {
  const ordered = extractOrderedPublicImageUrls(lead);
  return ordered[0] || "";
}

/**
 * Formats the resolved property description for OpenGraph / Twitter Card meta tags:
 * - Strips redundant leading ID/title boilerplate lines from formatted CRM templates when body text follows
 * - Removes decorative divider bars (`━━━`)
 * - Normalizes whitespace and trims cleanly at a word boundary
 */
export function formatOpenGraphDescription(
  lead: Record<string, any> | null | undefined,
  fallbackSummary = "Proprietate imobiliară prezentată de brokr.",
  maxLength = 260
): string {
  const raw = resolvePublicDisplayDescription(lead, fallbackSummary);
  if (!raw) return fallbackSummary;

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^[━─═\-_*]{3,}$/.test(line));

  // If the description starts with the standard CRM header (`📌 ID ...` and `🏡 <Title>` / `🏢 <Title>`),
  // skip those duplicated header lines when descriptive content follows so og:description doesn't repeat og:title.
  let startIndex = 0;
  if (lines.length > 2 && /^📌\s*ID\b/i.test(lines[0])) {
    startIndex = 1;
    if (lines[1] && /^(?:🏡|🏢)/.test(lines[1])) {
      startIndex = 2;
    }
  } else if (lines.length > 1 && /^(?:🏡|🏢)/.test(lines[0])) {
    const title = resolvePublicDisplayTitle(lead, "").toLowerCase();
    const firstLinePlain = lines[0].replace(/^(?:🏡|🏢)\s*/, "").trim().toLowerCase();
    if (title && firstLinePlain === title) {
      startIndex = 1;
    }
  }

  const effectiveLines = lines.slice(startIndex);
  let normalized = (effectiveLines.length > 0 ? effectiveLines : lines)
    .join(" ")
    .replace(/[━─═]{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    normalized = fallbackSummary;
  }

  if (normalized.length > maxLength) {
    const sliced = normalized.slice(0, maxLength - 3);
    const lastSpace = sliced.lastIndexOf(" ");
    const cut = lastSpace > Math.floor(maxLength * 0.6) ? sliced.slice(0, lastSpace) : sliced;
    normalized = `${cut.replace(/[,;:\-–—\s]+$/, "")}...`;
  }

  return normalized;
}

