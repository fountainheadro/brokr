import crypto from "crypto";
import type {
  CanonicalCurrencyCode,
  CanonicalGeoLocation,
  CanonicalOrderedMedia,
  CanonicalPropertyCategory,
  CanonicalPropertySpecs,
  CanonicalTransactionType,
} from "./typ_portal-provider";

function normalizeDiacritics(input: string): string {
  return String(input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function parseFirstPositiveNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  const str = String(value ?? "").trim();
  if (!str) return null;
  // Handle European thousand separators like "125.000" or "125 000" or "65,5"
  const match = str.match(/(\d{1,3}(?:[.\s]\d{3})+|\d+(?:[.,]\d+)?)/);
  if (!match) return null;
  let numStr = match[1].replace(/\s+/g, "");
  if (/^\d{1,3}(?:\.\d{3})+$/.test(numStr)) {
    numStr = numStr.replace(/\./g, "");
  } else {
    numStr = numStr.replace(",", ".");
  }
  const parsed = Number(numStr);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseIntegerInRange(value: unknown, min: number, max: number): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const rounded = Math.round(value);
    return rounded >= min && rounded <= max ? rounded : null;
  }
  const str = String(value ?? "").trim();
  if (!str) return null;
  const match = str.match(/-?\d+/);
  if (!match) return null;
  const parsed = parseInt(match[0], 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

function parseCurrencyCode(priceRaw: unknown, explicitCurrency?: unknown): CanonicalCurrencyCode {
  const combined = `${String(explicitCurrency || "")} ${String(priceRaw || "")}`.toUpperCase();
  if (combined.includes("RON") || combined.includes("LEI")) return "RON";
  if (combined.includes("USD") || combined.includes("$")) return "USD";
  return "EUR";
}

function parseTransactionType(raw: unknown): CanonicalTransactionType {
  const norm = normalizeDiacritics(String(raw || ""));
  if (norm.includes("inchir") || norm === "rent" || norm.includes("chirie")) {
    return "rent";
  }
  return "sale";
}

function parseCategory(rawCategory: unknown, buildingType?: unknown, roomsCount?: number | null): CanonicalPropertyCategory {
  const combined = normalizeDiacritics(`${String(rawCategory || "")} ${String(buildingType || "")}`);
  if (combined.includes("garsonier") || combined.includes("studio")) return "studio";
  if (combined.includes("apartament")) {
    return roomsCount === 1 ? "studio" : "apartment";
  }
  if (combined.includes("casa") || combined.includes("vila") || combined.includes("duplex")) {
    return "house_villa";
  }
  if (combined.includes("teren")) return "land";
  if (combined.includes("birou") || combined.includes("office")) return "office";
  if (combined.includes("industrial") || combined.includes("hala") || combined.includes("depozit")) {
    return "industrial";
  }
  if (combined.includes("comercial") || combined.includes("magazin") || combined.includes("spatiu")) {
    return "commercial";
  }
  return "other";
}

function parseFloorNumber(rawFloor: unknown): number | null {
  if (typeof rawFloor === "number" && Number.isFinite(rawFloor)) {
    return Math.round(rawFloor);
  }
  const norm = normalizeDiacritics(String(rawFloor || ""));
  if (!norm) return null;
  if (norm.includes("demisol") || norm.includes("subsol")) return -1;
  if (norm.includes("parter")) return 0;
  // e.g. "Etaj 4 / 10" or "4/8"
  const match = norm.match(/(?:etaj\s*)?(\d+)/);
  if (!match) return null;
  const parsed = parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 80 ? parsed : null;
}

function parseTotalFloors(rawTotal: unknown, rawFloor?: unknown): number | null {
  const direct = parseIntegerInRange(rawTotal, 1, 100);
  if (direct !== null) return direct;
  const floorStr = String(rawFloor || "");
  const slashMatch = floorStr.match(/\/\s*(\d+)/);
  if (slashMatch) {
    const parsed = parseInt(slashMatch[1], 10);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 100) return parsed;
  }
  const pPlusMatch = floorStr.match(/P\s*\+\s*(\d+)/i);
  if (pPlusMatch) {
    const parsed = parseInt(pPlusMatch[1], 10);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 100) return parsed;
  }
  return null;
}

function parseGeoLocation(lead: Record<string, any>): CanonicalGeoLocation {
  const crm = lead?.extractedData?.crmData || {};
  const loc = crm?.localizare || crm?.locatie || {};
  const zoneRaw = String(
    lead?.zone ||
      (Array.isArray(lead?.zoneList) ? lead.zoneList[0] : "") ||
      loc?.zona ||
      ""
  ).trim();
  const cityRaw = String(lead?.city || loc?.oras || "").trim();
  const countyRaw = String(loc?.judet || "").trim();

  let city = cityRaw;
  let county = countyRaw;
  let sector: string | undefined = loc?.sector ? String(loc.sector).trim() : undefined;

  const sectorMatch = `${zoneRaw} ${cityRaw}`.match(/sector\s*(\d)/i);
  if (sectorMatch && !sector) {
    sector = `Sector ${sectorMatch[1]}`;
  }

  if (!city && (sector || normalizeDiacritics(countyRaw).includes("bucuresti") || normalizeDiacritics(zoneRaw).includes("bucuresti"))) {
    city = "București";
  }
  if (!county && normalizeDiacritics(city) === "bucuresti") {
    county = "București";
  }

  const latRaw = Number(loc?.lat ?? lead?.lat);
  const lngRaw = Number(loc?.lng ?? lead?.lng);

  return {
    county: county || city || "",
    city: city || county || "",
    ...(sector ? { sector } : {}),
    ...(zoneRaw ? { zone: zoneRaw } : {}),
    ...(Number.isFinite(latRaw) && latRaw !== 0 ? { lat: latRaw } : {}),
    ...(Number.isFinite(lngRaw) && lngRaw !== 0 ? { lng: lngRaw } : {}),
  };
}

function buildOrderedMedia(lead: Record<string, any>): CanonicalOrderedMedia[] {
  const seen = new Set<string>();
  const result: CanonicalOrderedMedia[] = [];
  const coverUrl = typeof lead?.coverImage === "string" ? lead.coverImage.trim() : "";

  const pushUrl = (rawUrl: unknown, category: string) => {
    const url = typeof rawUrl === "string" ? rawUrl.trim() : "";
    if (!url || seen.has(url)) return;
    if (!/^https?:\/\/|^\//i.test(url)) return;
    seen.add(url);
    const mediaId = `med_${crypto.createHash("sha256").update(url).digest("hex").slice(0, 16)}`;
    result.push({
      mediaId,
      url,
      isCover: coverUrl ? url === coverUrl : result.length === 0,
      category: category || "Alte Spații",
      sortOrder: result.length,
    });
  };

  if (coverUrl) {
    pushUrl(coverUrl, "Copertă");
  }

  const crmImages = lead?.extractedData?.crmData?.imagini;
  if (Array.isArray(crmImages)) {
    for (const img of crmImages) {
      if (typeof img === "string") {
        pushUrl(img, "Alte Spații");
      } else if (img && typeof img === "object") {
        pushUrl(img.url || img.src, String(img.category || img.categorie || "Alte Spații"));
      }
    }
  }

  if (Array.isArray(lead?.images)) {
    for (const img of lead.images) {
      if (typeof img === "string") {
        pushUrl(img, "Alte Spații");
      } else if (img && typeof img === "object") {
        pushUrl(img.url || img.src, String(img.category || "Alte Spații"));
      }
    }
  }

  if (result.length > 0 && !result.some((m) => m.isCover)) {
    result[0].isCover = true;
  }

  return result.slice(0, 60);
}

/**
 * Pure deterministic normalizer converting any BROKR `Lead` / Property document into
 * a typed, portal-ready `CanonicalPropertySpecs` block without altering legacy fields.
 */
export function normalizeLeadToCanonicalSpecs(lead: Record<string, any>): CanonicalPropertySpecs {
  const crm = lead?.extractedData?.crmData || {};
  const general = crm?.general || {};
  const carac = crm?.caracteristici || {};
  const suprafete = carac?.suprafete || {};
  const alteDetalii = carac?.alteDetalii || {};
  const pretBlock = crm?.pret || {};
  const criterii = lead?.criteriiFormular || {};

  const priceSource =
    lead?.price ??
    pretBlock?.pret ??
    criterii?.maxBudget ??
    criterii?.minBudget ??
    "";
  const priceNumeric = parseFirstPositiveNumber(priceSource);
  const currencyCode = parseCurrencyCode(priceSource, pretBlock?.moneda);

  const roomsSource =
    lead?.rooms ??
    (Array.isArray(lead?.selectedRooms) ? lead.selectedRooms[0] : undefined) ??
    (Array.isArray(criterii?.selectedRooms) ? criterii.selectedRooms[0] : undefined) ??
    carac?.camere ??
    general?.camere;
  const roomsNorm = normalizeDiacritics(String(roomsSource || ""));
  const roomsCount =
    roomsNorm.includes("garsonier") || roomsNorm.includes("studio")
      ? 1
      : parseIntegerInRange(roomsSource, 1, 50);

  const bathroomsSource =
    lead?.baths ??
    (Array.isArray(lead?.selectedBaths) ? lead.selectedBaths[0] : undefined) ??
    (Array.isArray(criterii?.selectedBaths) ? criterii.selectedBaths[0] : undefined) ??
    carac?.bai;
  const bathroomsCount = parseIntegerInRange(bathroomsSource, 1, 20);

  const bedroomsExplicit = parseIntegerInRange(carac?.dormitoare, 0, 30);
  const bedroomsCount =
    bedroomsExplicit !== null
      ? bedroomsExplicit
      : roomsCount !== null
        ? Math.max(0, roomsCount - 1)
        : null;

  const usefulAreaSqm = parseFirstPositiveNumber(
    lead?.usefulArea ??
      lead?.suprafataUtilaMin ??
      criterii?.suprafataUtilaMin ??
      suprafete?.utila ??
      suprafete?.suprafataUtila
  );
  const builtAreaSqm = parseFirstPositiveNumber(
    lead?.suprafataConstruitaMin ??
      criterii?.suprafataConstruitaMin ??
      suprafete?.construita ??
      suprafete?.suprafataConstruita
  );
  const landAreaSqm = parseFirstPositiveNumber(
    lead?.suprafataTerenMin ??
      criterii?.suprafataTerenMin ??
      suprafete?.teren ??
      suprafete?.suprafataTeren
  );

  const floorSource =
    lead?.floor ??
    (Array.isArray(lead?.selectedFloors) ? lead.selectedFloors[0] : undefined) ??
    (Array.isArray(criterii?.selectedFloors) ? criterii.selectedFloors[0] : undefined) ??
    carac?.etaj;
  const floorNumber = parseFloorNumber(floorSource);
  const totalFloors = parseTotalFloors(
    lead?.totalFloors ?? criterii?.totalFloors ?? alteDetalii?.nrEtaje,
    floorSource
  );

  const constructionYear = parseIntegerInRange(
    lead?.constructionYear ??
      lead?.anConstructieMin ??
      criterii?.anConstructieMin ??
      alteDetalii?.anConstructie,
    1850,
    2040
  );

  const category = parseCategory(
    lead?.categoria || general?.categorie,
    lead?.buildingType || criterii?.buildingType,
    roomsCount
  );
  const resolvedRoomsCount =
    roomsCount !== null ? roomsCount : category === "studio" ? 1 : null;
  const resolvedBedroomsCount =
    bedroomsCount !== null
      ? bedroomsCount
      : resolvedRoomsCount !== null
        ? Math.max(0, resolvedRoomsCount - 1)
        : null;

  const transactionType = parseTransactionType(
    lead?.transactionType || general?.tranzactie
  );

  const title = String(
    lead?.title ||
      crm?.descriere?.titlu ||
      lead?.extractedData?.originalTitle ||
      ""
  ).trim();

  const description = String(
    crm?.descriere?.continut ||
      lead?.extractedData?.markdownMarketing ||
      lead?.extractedData?.description ||
      lead?.extractedData?.summary ||
      lead?.requirements ||
      lead?.notes ||
      ""
  ).trim();

  const docVersionRaw = Number(lead?.docVersion);
  const docVersion =
    Number.isFinite(docVersionRaw) && docVersionRaw >= 1 ? Math.floor(docVersionRaw) : 1;

  return {
    schemaVersion: 1,
    propertyId: String(lead?.propertyId || lead?.id || "").trim(),
    docVersion,
    transactionType,
    category,
    title,
    description,
    priceNumeric,
    currencyCode,
    roomsCount: resolvedRoomsCount,
    bedroomsCount: resolvedBedroomsCount,
    bathroomsCount,
    usefulAreaSqm,
    builtAreaSqm,
    landAreaSqm,
    floorNumber,
    totalFloors,
    constructionYear,
    partitioning: String(lead?.compartimentare || criterii?.compartimentare || carac?.compartimentare || "").trim() || undefined,
    furnishing: String(lead?.mobilare || criterii?.mobilare || crm?.dotari?.mobilat || "").trim() || undefined,
    parking: String(lead?.parcare || lead?.tipParcare || criterii?.tipParcare || "").trim() || undefined,
    heating: String(lead?.sursaIncalzire || criterii?.sistemIncalzire || "").trim() || undefined,
    energyClass: String(crm?.performantaEnergetica?.clasaEnergetica || "").trim() || undefined,
    geo: parseGeoLocation(lead),
    orderedMedia: buildOrderedMedia(lead),
    normalizedAt: new Date().toISOString(),
  };
}
