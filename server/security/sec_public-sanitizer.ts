const PRIVATE_TOP_LEVEL_KEYS = new Set([
  "ownerName",
  "ownerPhone",
  "ownerEmail",
  "proprietar",
  "numeProprietar",
  "telefonProprietar",
  "contacteAditionale",
  "memoPrivat",
  "notePrivate",
  "internalNotes",
  "comisioane",
  "commissionValue",
  "createdBy",
  "updatedBy",
  "ownerUid",
  "agentNotes",
  "url",
  "sourceUrl",
  "notes",
  "rawText",
  "rawDescription",
  "originalText",
  "scrapedHtml",
]);

const PRIVATE_LOCATION_KEYS = new Set([
  "strada",
  "numar",
  "nr",
  "bloc",
  "scara",
  "apartament",
  "ap",
  "ansamblu",
  "complex",
  "adresa",
  "coordonate",
  "lat",
  "lng",
]);

export interface SanitizePublicOptions {
  tokenizeImageUrl?: (rawUrl: string) => string;
}

/**
 * Strips private owner PII, source URLs, exact street/building identifiers, internal memos,
 * and agent-only fields from a lead/property document before returning it from
 * unauthenticated public share endpoints (/api/public-property/:id).
 */
export function sanitizePublicProperty<T extends Record<string, any>>(
  raw: T,
  options?: SanitizePublicOptions
): Partial<T> {
  if (!raw || typeof raw !== "object") return {};

  const tokenize = options?.tokenizeImageUrl;

  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (PRIVATE_TOP_LEVEL_KEYS.has(key)) {
      continue;
    }
    cleaned[key] = value;
  }

  if (tokenize) {
    if (typeof cleaned.coverImage === "string" && cleaned.coverImage.trim()) {
      cleaned.coverImage = tokenize(cleaned.coverImage.trim());
    }
    if (Array.isArray(cleaned.images)) {
      cleaned.images = cleaned.images
        .map((img) => {
          if (typeof img === "string" && img.trim()) return tokenize(img.trim());
          if (img && typeof img === "object" && typeof img.original === "string" && img.original.trim()) {
            return { ...img, original: tokenize(img.original.trim()) };
          }
          return img;
        })
        .filter(Boolean);
    }
  }

  if (cleaned.extractedData && typeof cleaned.extractedData === "object") {
    const extCopy: Record<string, any> = {};
    for (const [k, v] of Object.entries(cleaned.extractedData)) {
      if (PRIVATE_TOP_LEVEL_KEYS.has(k)) continue;
      extCopy[k] = v;
    }

    if (extCopy.crmData && typeof extCopy.crmData === "object") {
      const crmCopy: Record<string, any> = {};
      for (const [k, v] of Object.entries(extCopy.crmData)) {
        if (PRIVATE_TOP_LEVEL_KEYS.has(k)) continue;
        crmCopy[k] = v;
      }

      if (crmCopy.detaliiGenerale && typeof crmCopy.detaliiGenerale === "object") {
        const dgCopy = { ...crmCopy.detaliiGenerale };
        if (dgCopy.localizare && typeof dgCopy.localizare === "object") {
          const locCopy: Record<string, any> = {};
          for (const [lk, lv] of Object.entries(dgCopy.localizare)) {
            if (PRIVATE_LOCATION_KEYS.has(lk)) continue;
            locCopy[lk] = lv;
          }
          dgCopy.localizare = locCopy;
        }
        crmCopy.detaliiGenerale = dgCopy;
      }

      if (tokenize && crmCopy.imagini && typeof crmCopy.imagini === "object") {
        const imgCopy: Record<string, any> = {};
        for (const [cat, list] of Object.entries(crmCopy.imagini)) {
          if (Array.isArray(list)) {
            imgCopy[cat] = list.map((item: any) => {
              if (typeof item === "string" && item.trim()) return tokenize(item.trim());
              if (item && typeof item === "object" && typeof item.original === "string" && item.original.trim()) {
                return { ...item, original: tokenize(item.original.trim()) };
              }
              return item;
            });
          } else {
            imgCopy[cat] = list;
          }
        }
        crmCopy.imagini = imgCopy;
      }

      extCopy.crmData = crmCopy;
    }

    cleaned.extractedData = extCopy;
  }

  return cleaned as Partial<T>;
}
