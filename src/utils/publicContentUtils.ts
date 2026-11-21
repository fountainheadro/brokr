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

  if (shouldUseModifiedAdContent(lead)) {
    return crmTitle || leadTitle || originalTitle || fallbackTitle;
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
 * Collects all property/lead image URLs in exact display priority order matching the shared page:
 * 1. `coverImage` (first image shown in gallery)
 * 2. `extractedData.crmData.imagini` (`living`, `camera`, `bucatarie`, `baie`, `alteSpatii`)
 * 3. `images` array
 */
export function extractOrderedPublicImageUrls(
  lead: Record<string, any> | null | undefined
): string[] {
  if (!lead || typeof lead !== "object") return [];

  const urls: string[] = [];
  const seen = new Set<string>();
  const addUrl = (raw: unknown) => {
    const u = extractImageUrlFromItem(raw);
    if (!u || seen.has(u)) return;
    seen.add(u);
    urls.push(u);
  };

  addUrl(lead.coverImage);

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

  if (Array.isArray(lead.images)) {
    for (const item of lead.images) {
      addUrl(item);
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

