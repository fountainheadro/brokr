import type {
  CanonicalPropertyCategory,
  CanonicalPropertySpecs,
  CanonicalTransactionType,
  PortalValidationIssue,
  PortalValidationResult,
} from "../typ_portal-provider";

export interface StoriaCategoryMapping {
  categoryCode: string;
  categoryId: number;
  transaction: "SELL" | "RENT";
}

export interface StoriaLocationPayload {
  country: "RO";
  county: string;
  city: string;
  district?: string;
  zone?: string;
  coordinates?: {
    latitude: number;
    longitude: number;
  };
}

export interface StoriaListingPayload {
  external_ref: string;
  category: string;
  category_id: number;
  transaction: "SELL" | "RENT";
  title: string;
  description: string;
  price: {
    value: number;
    currency: "EUR" | "RON" | "USD";
  };
  location: StoriaLocationPayload;
  attributes: Record<string, string | number | boolean>;
  images: Array<{
    url: string;
    order: number;
    is_cover: boolean;
  }>;
  metadata: {
    source: "brokr_crm";
    doc_version: number;
    schema_version: 1;
    hide_exact_address?: boolean;
    promotion_tier?: string;
    agent_email?: string;
  };
}

function stripDiacritics(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Official Romanian county (județ) canonical nomenclature for Storia.ro.
 */
const RO_COUNTY_CANONICAL: Record<string, string> = {
  alba: "Alba",
  arad: "Arad",
  arges: "Argeș",
  bacau: "Bacău",
  bihor: "Bihor",
  "bistrita-nasaud": "Bistrița-Năsăud",
  "bistrita nasaud": "Bistrița-Năsăud",
  botosani: "Botoșani",
  braila: "Brăila",
  brasov: "Brașov",
  bucuresti: "București",
  bucharest: "București",
  buzau: "Buzău",
  calarasi: "Călărași",
  "caras-severin": "Caraș-Severin",
  "caras severin": "Caraș-Severin",
  cluj: "Cluj",
  constanta: "Constanța",
  covasna: "Covasna",
  dambovita: "Dâmbovița",
  dolj: "Dolj",
  galati: "Galați",
  giurgiu: "Giurgiu",
  gorj: "Gorj",
  harghita: "Harghita",
  hunedoara: "Hunedoara",
  ialomita: "Ialomița",
  iasi: "Iași",
  ilfov: "Ilfov",
  maramures: "Maramureș",
  mehedinti: "Mehedinți",
  mures: "Mureș",
  neamt: "Neamț",
  olt: "Olt",
  prahova: "Prahova",
  salaj: "Sălaj",
  "satu mare": "Satu Mare",
  "satu-mare": "Satu Mare",
  sibiu: "Sibiu",
  suceava: "Suceava",
  teleorman: "Teleorman",
  timis: "Timiș",
  tulcea: "Tulcea",
  valcea: "Vâlcea",
  vaslui: "Vaslui",
  vrancea: "Vrancea",
};

const CITY_TO_COUNTY: Record<string, string> = {
  bucuresti: "București",
  bucharest: "București",
  "cluj-napoca": "Cluj",
  "cluj napoca": "Cluj",
  timisoara: "Timiș",
  iasi: "Iași",
  constanta: "Constanța",
  brasov: "Brașov",
  sibiu: "Sibiu",
  oradea: "Bihor",
  craiova: "Dolj",
  ploiesti: "Prahova",
  pitesti: "Argeș",
  arad: "Arad",
  galati: "Galați",
  bacau: "Bacău",
  "targu mures": "Mureș",
  "baia mare": "Maramureș",
  otopeni: "Ilfov",
  voluntari: "Ilfov",
  pipera: "Ilfov",
  "popesti-leordeni": "Ilfov",
  bragadiru: "Ilfov",
  chiajna: "Ilfov",
};

const STORIA_CATEGORY_MATRIX: Record<
  CanonicalPropertyCategory,
  Record<CanonicalTransactionType, StoriaCategoryMapping>
> = {
  apartment: {
    sale: { categoryCode: "apartments-for-sale", categoryId: 101, transaction: "SELL" },
    rent: { categoryCode: "apartments-for-rent", categoryId: 102, transaction: "RENT" },
  },
  studio: {
    sale: { categoryCode: "apartments-for-sale", categoryId: 101, transaction: "SELL" },
    rent: { categoryCode: "apartments-for-rent", categoryId: 102, transaction: "RENT" },
  },
  house_villa: {
    sale: { categoryCode: "houses-for-sale", categoryId: 201, transaction: "SELL" },
    rent: { categoryCode: "houses-for-rent", categoryId: 202, transaction: "RENT" },
  },
  land: {
    sale: { categoryCode: "plots-for-sale", categoryId: 301, transaction: "SELL" },
    rent: { categoryCode: "plots-for-rent", categoryId: 302, transaction: "RENT" },
  },
  commercial: {
    sale: { categoryCode: "commercial-for-sale", categoryId: 401, transaction: "SELL" },
    rent: { categoryCode: "commercial-for-rent", categoryId: 402, transaction: "RENT" },
  },
  office: {
    sale: { categoryCode: "offices-for-sale", categoryId: 501, transaction: "SELL" },
    rent: { categoryCode: "offices-for-rent", categoryId: 502, transaction: "RENT" },
  },
  industrial: {
    sale: { categoryCode: "warehouses-for-sale", categoryId: 601, transaction: "SELL" },
    rent: { categoryCode: "warehouses-for-rent", categoryId: 602, transaction: "RENT" },
  },
  other: {
    sale: { categoryCode: "commercial-for-sale", categoryId: 401, transaction: "SELL" },
    rent: { categoryCode: "commercial-for-rent", categoryId: 402, transaction: "RENT" },
  },
};

export function mapStoriaCategory(
  category: CanonicalPropertyCategory,
  transactionType: CanonicalTransactionType
): StoriaCategoryMapping {
  const row = STORIA_CATEGORY_MATRIX[category] || STORIA_CATEGORY_MATRIX.other;
  return row[transactionType] || row.sale;
}

export function mapStoriaFloor(floorNumber: number | null): string | undefined {
  if (floorNumber === null || !Number.isFinite(floorNumber)) return undefined;
  if (floorNumber < 0) return "cellar";
  if (floorNumber === 0) return "ground_floor";
  if (floorNumber >= 1 && floorNumber <= 10) return `floor_${floorNumber}`;
  return "floor_higher_10";
}

export function mapStoriaPartitioning(raw?: string): string | undefined {
  const norm = stripDiacritics(raw || "");
  if (!norm) return undefined;
  if (norm.includes("semidecomand")) return "semi_detached";
  if (norm.includes("nedecomand")) return "not_detached";
  if (norm.includes("decomand")) return "detached";
  if (norm.includes("circular")) return "circular";
  if (norm.includes("vagon")) return "wagon";
  return undefined;
}

export function mapStoriaFurnishing(raw?: string): string | undefined {
  const norm = stripDiacritics(raw || "");
  if (!norm) return undefined;
  if (norm.includes("nemobil")) return "unfurnished";
  if (norm.includes("partial")) return "partially_furnished";
  if (norm.includes("lux")) return "luxury_furnished";
  if (norm.includes("complet") || norm.includes("mobilat")) return "furnished";
  return undefined;
}

export function mapStoriaHeating(raw?: string): string | undefined {
  const norm = stripDiacritics(raw || "");
  if (!norm) return undefined;
  if (norm.includes("proprie")) return "gas_individual";
  if (norm.includes("imobil") || norm.includes("bloc")) return "building_boiler";
  if (norm.includes("termofic") || norm.includes("centralizat") || norm.includes("radet")) {
    return "urban_heating";
  }
  if (norm.includes("pompa") || norm.includes("caldura")) return "heat_pump";
  if (norm.includes("electric")) return "electric";
  if (norm.includes("soba") || norm.includes("lemne")) return "wood_stove";
  return undefined;
}

export function mapStoriaParking(raw?: string): string | undefined {
  const norm = stripDiacritics(raw || "");
  if (!norm) return undefined;
  if (norm.includes("fara") || norm === "nu") return "none";
  if (norm.includes("garaj")) return "garage";
  if (norm.includes("subteran")) return "underground";
  if (norm.includes("suprateran") || norm.includes("exterior") || norm.includes("loc")) {
    return "outdoor_assigned";
  }
  return "street";
}

export function mapStoriaEnergyClass(raw?: string): string | undefined {
  const upper = String(raw || "").trim().toUpperCase();
  if (/^(A\+|A|B|C|D|E|F|G)$/.test(upper)) {
    return upper;
  }
  return undefined;
}

export function mapStoriaLocation(canonical: CanonicalPropertySpecs): StoriaLocationPayload {
  const rawCounty = stripDiacritics(canonical.geo.county || "");
  const rawCity = stripDiacritics(canonical.geo.city || "");
  const rawZone = String(canonical.geo.zone || "").trim();

  let city = String(canonical.geo.city || "").trim();
  let county = RO_COUNTY_CANONICAL[rawCounty] || "";

  if (!county && rawCity) {
    county = CITY_TO_COUNTY[rawCity] || RO_COUNTY_CANONICAL[rawCity] || "";
  }

  let district = canonical.geo.sector ? String(canonical.geo.sector).trim() : undefined;
  const sectorMatch = `${rawZone} ${city} ${district || ""}`.match(/sector\s*([1-6])/i);
  if (sectorMatch) {
    district = `Sector ${sectorMatch[1]}`;
    if (!city) city = "București";
    if (!county) county = "București";
  }

  if (stripDiacritics(city) === "bucuresti" || stripDiacritics(city) === "bucharest") {
    city = "București";
    county = "București";
  }

  if (!city && county) {
    city = county;
  }

  const hasValidCoords =
    typeof canonical.geo.lat === "number" &&
    typeof canonical.geo.lng === "number" &&
    Number.isFinite(canonical.geo.lat) &&
    Number.isFinite(canonical.geo.lng) &&
    canonical.geo.lat >= 43.4 &&
    canonical.geo.lat <= 48.5 &&
    canonical.geo.lng >= 20.0 &&
    canonical.geo.lng <= 30.0;

  return {
    country: "RO",
    county: county || city || "",
    city: city || county || "",
    ...(district ? { district } : {}),
    ...(rawZone ? { zone: rawZone } : {}),
    ...(hasValidCoords
      ? {
          coordinates: {
            latitude: Number(canonical.geo.lat!.toFixed(6)),
            longitude: Number(canonical.geo.lng!.toFixed(6)),
          },
        }
      : {}),
  };
}

/**
 * Validates a canonical BROKR property against Storia.ro Partner API requirements,
 * returning actionable Romanian field-level messages without blocking internal CRM saves.
 */
export function validateForStoria(
  canonical: CanonicalPropertySpecs
): PortalValidationResult {
  const issues: PortalValidationIssue[] = [];

  const titleLen = (canonical.title || "").trim().length;
  if (titleLen < 15) {
    issues.push({
      field: "title",
      code: "STORIA_SHORT_TITLE",
      message: "Titlul anunțului trebuie să aibă minim 15 caractere pentru Storia.ro.",
      severity: "error",
    });
  } else if (titleLen > 150) {
    issues.push({
      field: "title",
      code: "STORIA_LONG_TITLE",
      message: "Titlul anunțului nu poate depăși 150 de caractere pentru Storia.ro.",
      severity: "error",
    });
  }

  const descLen = (canonical.description || "").trim().length;
  if (descLen < 50) {
    issues.push({
      field: "description",
      code: "STORIA_SHORT_DESCRIPTION",
      message: "Descrierea trebuie să conțină minim 50 de caractere pentru publicarea pe Storia.ro.",
      severity: "error",
    });
  }

  if (!canonical.priceNumeric || canonical.priceNumeric <= 0) {
    issues.push({
      field: "priceNumeric",
      code: "STORIA_MISSING_PRICE",
      message: "Lipsește prețul numeric valid pentru Storia.ro.",
      severity: "error",
    });
  }

  if (canonical.category === "land") {
    if (!canonical.landAreaSqm || canonical.landAreaSqm <= 0) {
      issues.push({
        field: "landAreaSqm",
        code: "STORIA_MISSING_LAND_AREA",
        message: "Lipsește suprafața terenului (mp) pentru Storia.ro.",
        severity: "error",
      });
    }
  } else if (!canonical.usefulAreaSqm || canonical.usefulAreaSqm <= 0) {
    issues.push({
      field: "usefulAreaSqm",
      code: "STORIA_MISSING_USEFUL_AREA",
      message: "Lipsește suprafața utilă (mp) pentru Storia.ro.",
      severity: "error",
    });
  }

  const isResidentialBuilding =
    canonical.category === "apartment" ||
    canonical.category === "studio" ||
    canonical.category === "house_villa";

  if (isResidentialBuilding && !canonical.roomsCount) {
    issues.push({
      field: "roomsCount",
      code: "STORIA_MISSING_ROOMS",
      message: "Lipsește numărul de camere pentru Storia.ro.",
      severity: "error",
    });
  }

  if (isResidentialBuilding && !canonical.constructionYear) {
    issues.push({
      field: "constructionYear",
      code: "STORIA_MISSING_CONSTRUCTION_YEAR",
      message: "Lipsește anul construcției pentru Storia.ro.",
      severity: "error",
    });
  }

  const loc = mapStoriaLocation(canonical);
  if (!loc.city || !loc.county) {
    issues.push({
      field: "geo.city",
      code: "STORIA_MISSING_LOCATION",
      message: "Lipsesc județul și localitatea (ex: București / Cluj-Napoca) pentru Storia.ro.",
      severity: "error",
    });
  }

  const validHttpsMedia = (canonical.orderedMedia || []).filter((m) =>
    /^https:\/\//i.test(m.url)
  );
  if (validHttpsMedia.length === 0) {
    issues.push({
      field: "orderedMedia",
      code: "STORIA_MISSING_HTTPS_PHOTOS",
      message:
        "Este necesară cel puțin o fotografie accesibilă prin HTTPS pentru publicarea pe Storia.ro.",
      severity: "error",
    });
  } else if (validHttpsMedia.length < 3) {
    issues.push({
      field: "orderedMedia",
      code: "STORIA_FEW_PHOTOS",
      message: "Recomandăm minim 3 fotografii pentru o vizibilitate optimă pe Storia.ro.",
      severity: "warning",
    });
  }

  if (!loc.coordinates) {
    issues.push({
      field: "geo.lat",
      code: "STORIA_MISSING_COORDINATES",
      message: "Lipsesc coordonatele GPS; anunțul va fi poziționat doar la nivel de zonă/localitate.",
      severity: "warning",
    });
  }

  return {
    valid: !issues.some((i) => i.severity === "error"),
    issues,
  };
}

/**
 * Maps canonical BROKR property specifications + optional namespaced `portalExtensions.storia`
 * into a deterministic Storia.ro Real Estate Partner API listing payload.
 */
export function mapCanonicalToStoriaPayload(
  canonical: CanonicalPropertySpecs,
  rawProperty?: Record<string, any>,
  externalRefOverride?: string
): StoriaListingPayload {
  const cat = mapStoriaCategory(canonical.category, canonical.transactionType);
  const loc = mapStoriaLocation(canonical);
  const ext = (rawProperty?.portalExtensions?.storia || {}) as Record<string, unknown>;

  const attributes: Record<string, string | number | boolean> = {};

  if (canonical.usefulAreaSqm) attributes.area_useful = canonical.usefulAreaSqm;
  if (canonical.builtAreaSqm) attributes.area_built = canonical.builtAreaSqm;
  if (canonical.landAreaSqm) attributes.area_terrain = canonical.landAreaSqm;
  if (canonical.roomsCount) attributes.rooms_num = canonical.roomsCount;
  if (canonical.bathroomsCount) attributes.bathrooms_num = canonical.bathroomsCount;
  if (canonical.constructionYear) attributes.build_year = canonical.constructionYear;
  if (canonical.totalFloors) attributes.building_floors_num = canonical.totalFloors;

  const floorVal = mapStoriaFloor(canonical.floorNumber);
  if (floorVal) attributes.floor_no = floorVal;

  const structureVal = mapStoriaPartitioning(canonical.partitioning);
  if (structureVal) attributes.structure = structureVal;

  const furnishingVal = mapStoriaFurnishing(canonical.furnishing);
  if (furnishingVal) attributes.furnishing = furnishingVal;

  const heatingVal = mapStoriaHeating(canonical.heating);
  if (heatingVal) attributes.heating = heatingVal;

  const parkingVal = mapStoriaParking(canonical.parking);
  if (parkingVal) attributes.parking = parkingVal;

  const energyVal = mapStoriaEnergyClass(canonical.energyClass);
  if (energyVal) attributes.energy_class = energyVal;

  if (canonical.category === "studio") {
    attributes.is_studio = true;
  }

  const images = (canonical.orderedMedia || [])
    .filter((m) => /^https:\/\//i.test(m.url))
    .slice(0, 40)
    .map((m, idx) => ({
      url: m.url,
      order: idx,
      is_cover: idx === 0 ? true : Boolean(m.isCover),
    }));

  const safeExternalRef =
    externalRefOverride || canonical.propertyId || String(rawProperty?.id || "");

  return {
    external_ref: safeExternalRef,
    category: cat.categoryCode,
    category_id: cat.categoryId,
    transaction: cat.transaction,
    title: canonical.title.trim().slice(0, 150),
    description: canonical.description.trim().slice(0, 10000),
    price: {
      value: Number(canonical.priceNumeric || 0),
      currency: canonical.currencyCode,
    },
    location: loc,
    attributes,
    images,
    metadata: {
      source: "brokr_crm",
      doc_version: canonical.docVersion,
      schema_version: 1,
      ...(typeof ext.hideExactAddress === "boolean"
        ? { hide_exact_address: ext.hideExactAddress }
        : {}),
      ...(typeof ext.promotionTier === "string" && ext.promotionTier.trim()
        ? { promotion_tier: ext.promotionTier.trim().slice(0, 64) }
        : {}),
      ...(typeof ext.agentEmail === "string" && ext.agentEmail.includes("@")
        ? { agent_email: ext.agentEmail.trim().slice(0, 160) }
        : {}),
    },
  };
}

const REMOTE_FIELD_LABEL_RO: Record<string, string> = {
  title: "Titlu",
  description: "Descriere",
  price: "Preț",
  "price.value": "Preț",
  "location.city": "Localitate",
  "location.county": "Județ",
  "location.zone": "Zonă",
  "attributes.build_year": "An construcție",
  "attributes.area_useful": "Suprafață utilă",
  "attributes.rooms_num": "Număr camere",
  images: "Fotografii",
};

/**
 * Translates Storia Partner API 400/422 validation error payloads into clear Romanian issues.
 */
export function mapStoriaRemoteErrorsToIssues(body: unknown): PortalValidationIssue[] {
  if (!body || typeof body !== "object") return [];
  const obj = body as Record<string, unknown>;
  const rawErrors = Array.isArray(obj.errors)
    ? obj.errors
    : Array.isArray(obj.validation_errors)
      ? obj.validation_errors
      : [];

  const issues: PortalValidationIssue[] = [];
  for (const item of rawErrors.slice(0, 20)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const field = String(rec.field || rec.path || "general").trim();
    const code = String(rec.code || "STORIA_REMOTE_VALIDATION").trim();
    const rawMsg = String(rec.message || rec.detail || "").trim();
    const label = REMOTE_FIELD_LABEL_RO[field] || field;
    issues.push({
      field,
      code,
      message: rawMsg
        ? `${label}: ${rawMsg}`
        : `Câmpul „${label}” a fost respins de Storia.ro.`,
      severity: "error",
    });
  }

  if (issues.length === 0 && typeof obj.message === "string" && obj.message.trim()) {
    issues.push({
      field: "general",
      code: String(obj.code || "STORIA_REMOTE_VALIDATION"),
      message: obj.message.trim().slice(0, 400),
      severity: "error",
    });
  }

  return issues;
}
