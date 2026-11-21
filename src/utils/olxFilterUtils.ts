export type PropertyFilterPageContext = "Lead-uri" | "Cereri" | "Proprietati" | "autoScan";
export type LeadRoleFilterValue = "" | "Proprietari" | "Cumparatori" | "Chiriasi";

export interface OlxLeadFilters {
  searchText: string;
  leadRole?: LeadRoleFilterValue;
  transactionType: "" | "Vânzare" | "Închiriere" | "Cumpărare";
  categories: string[];
  rooms: string[];
  compartimentare: string[];
  priceMin: string;
  priceMax: string;
  surfaceMin: string;
  surfaceMax: string;
  constructie: string[];
  floors: string[];
  zones: string[];
}

export const DEFAULT_OLX_LEAD_FILTERS: OlxLeadFilters = {
  searchText: "",
  leadRole: "",
  transactionType: "",
  categories: [],
  rooms: [],
  compartimentare: [],
  priceMin: "",
  priceMax: "",
  surfaceMin: "",
  surfaceMax: "",
  constructie: [],
  floors: [],
  zones: [],
};

export const LEAD_ROLE_FILTER_OPTIONS: Array<{ value: LeadRoleFilterValue; label: string }> = [
  { value: "", label: "Toate" },
  { value: "Proprietari", label: "Proprietari" },
  { value: "Cumparatori", label: "Cumpărători" },
  { value: "Chiriasi", label: "Chiriași" },
];

export interface FilterOption {
  value: string;
  label: string;
  olxSlug?: string;
}

export const OLX_CATEGORY_OPTIONS: FilterOption[] = [
  { value: "Apartament", label: "Apartamente / Garsoniere" },
  { value: "Casa/Vila", label: "Case / Vile" },
  { value: "Spatiu Birou", label: "Spații Birou" },
  { value: "Spatiu Comercial", label: "Spații Comerciale" },
  { value: "Spatiu Industrial", label: "Spații Industriale" },
  { value: "Teren", label: "Terenuri" },
  { value: "Alte proprietati", label: "Alte proprietăți" },
];

export const OLX_ROOM_OPTIONS: FilterOption[] = [
  { value: "1", label: "1 cameră / Garsonieră", olxSlug: "1-camera" },
  { value: "2", label: "2 camere", olxSlug: "2-camere" },
  { value: "3", label: "3 camere", olxSlug: "3-camere" },
  { value: "4+", label: "4+ camere", olxSlug: "4-camere" },
];

export const OLX_COMPARTIMENTARE_OPTIONS: FilterOption[] = [
  { value: "decomandat", label: "Decomandat" },
  { value: "semidecomandat", label: "Semidecomandat" },
  { value: "nedecomandat", label: "Nedecomandat" },
  { value: "circular", label: "Circular" },
];

export const OLX_CONSTRUCTIE_OPTIONS: FilterOption[] = [
  { value: "inainte-de-1977", label: "Înainte de 1977" },
  { value: "1977-1990", label: "1977 – 1990" },
  { value: "1990-2000", label: "1990 – 2000" },
  { value: "dupa-2000", label: "După 2000" },
];

export const OLX_FLOOR_OPTIONS: FilterOption[] = [
  { value: "demisol", label: "Demisol" },
  { value: "parter", label: "Parter" },
  { value: "fl_1", label: "Etaj 1" },
  { value: "fl_2", label: "Etaj 2" },
  { value: "fl_3", label: "Etaj 3" },
  { value: "fl_4", label: "Etaj 4" },
  { value: "fl_5", label: "Etaj 5" },
  { value: "fl_6", label: "Etaj 6" },
  { value: "fl_7", label: "Etaj 7" },
  { value: "fl_8", label: "Etaj 8" },
  { value: "fl_9", label: "Etaj 9" },
  { value: "fl_10", label: "Etaj 10 și peste" },
  { value: "mansarda", label: "Mansardă" },
];

export function normalizeRoText(val: unknown): string {
  return String(val ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasActiveOlxFilters(filters: OlxLeadFilters): boolean {
  return countActiveOlxFilters(filters) > 0;
}

export function countActiveOlxFilters(filters: OlxLeadFilters): number {
  let count = 0;
  if (filters.searchText.trim()) count++;
  if (filters.leadRole) count++;
  if (filters.transactionType) count++;
  if (filters.categories.length > 0) count++;
  if (filters.rooms.length > 0) count++;
  if (filters.compartimentare.length > 0) count++;
  if (filters.priceMin.trim() || filters.priceMax.trim()) count++;
  if (filters.surfaceMin.trim() || filters.surfaceMax.trim()) count++;
  if (filters.constructie.length > 0) count++;
  if (filters.floors.length > 0) count++;
  if ((filters.zones?.length || 0) > 0) count++;
  return count;
}

export function getOlxFilterSignature(filters: OlxLeadFilters): string {
  return JSON.stringify({
    searchText: filters.searchText.trim().toLowerCase(),
    leadRole: filters.leadRole || "",
    transactionType: filters.transactionType,
    categories: [...filters.categories].sort(),
    rooms: [...filters.rooms].sort(),
    compartimentare: [...filters.compartimentare].sort(),
    priceMin: filters.priceMin.trim(),
    priceMax: filters.priceMax.trim(),
    surfaceMin: filters.surfaceMin.trim(),
    surfaceMax: filters.surfaceMax.trim(),
    constructie: [...filters.constructie].sort(),
    floors: [...filters.floors].sort(),
    zones: [...(filters.zones || [])].sort(),
  });
}

export interface ActiveFilterTag {
  id: string;
  label: string;
  remove: (prev: OlxLeadFilters) => OlxLeadFilters;
}

/**
 * Returns one removable tag per selected filter value, suitable for displaying
 * inline to the left of the Filter button in the property sub-header bar.
 */
export function getActiveFilterTags(filters: OlxLeadFilters): ActiveFilterTag[] {
  const tags: ActiveFilterTag[] = [];

  if (filters.leadRole) {
    const roleLabel =
      LEAD_ROLE_FILTER_OPTIONS.find((opt) => opt.value === filters.leadRole)?.label ||
      filters.leadRole;
    tags.push({
      id: `leadRole:${filters.leadRole}`,
      label: roleLabel,
      remove: (prev) => ({ ...prev, leadRole: "" }),
    });
  }

  if (filters.transactionType) {
    tags.push({
      id: `tx:${filters.transactionType}`,
      label: filters.transactionType,
      remove: (prev) => ({ ...prev, transactionType: "" }),
    });
  }

  for (const cat of filters.categories) {
    const opt = OLX_CATEGORY_OPTIONS.find((o) => o.value === cat);
    tags.push({
      id: `cat:${cat}`,
      label: opt?.label || cat,
      remove: (prev) => ({
        ...prev,
        categories: prev.categories.filter((v) => v !== cat),
      }),
    });
  }

  for (const room of filters.rooms) {
    const opt = OLX_ROOM_OPTIONS.find((o) => o.value === room);
    tags.push({
      id: `room:${room}`,
      label: opt?.label || `${room} camere`,
      remove: (prev) => ({
        ...prev,
        rooms: prev.rooms.filter((v) => v !== room),
      }),
    });
  }

  for (const comp of filters.compartimentare) {
    const opt = OLX_COMPARTIMENTARE_OPTIONS.find((o) => o.value === comp);
    tags.push({
      id: `comp:${comp}`,
      label: opt?.label || comp,
      remove: (prev) => ({
        ...prev,
        compartimentare: prev.compartimentare.filter((v) => v !== comp),
      }),
    });
  }

  const pMin = filters.priceMin.trim();
  const pMax = filters.priceMax.trim();
  if (pMin || pMax) {
    const label =
      pMin && pMax ? `${pMin}–${pMax} €` : pMin ? `≥ ${pMin} €` : `≤ ${pMax} €`;
    tags.push({
      id: `price:${pMin}-${pMax}`,
      label,
      remove: (prev) => ({ ...prev, priceMin: "", priceMax: "" }),
    });
  }

  const sMin = filters.surfaceMin.trim();
  const sMax = filters.surfaceMax.trim();
  if (sMin || sMax) {
    const label =
      sMin && sMax ? `${sMin}–${sMax} mp` : sMin ? `≥ ${sMin} mp` : `≤ ${sMax} mp`;
    tags.push({
      id: `surface:${sMin}-${sMax}`,
      label,
      remove: (prev) => ({ ...prev, surfaceMin: "", surfaceMax: "" }),
    });
  }

  for (const cons of filters.constructie) {
    const opt = OLX_CONSTRUCTIE_OPTIONS.find((o) => o.value === cons);
    tags.push({
      id: `cons:${cons}`,
      label: opt?.label || cons,
      remove: (prev) => ({
        ...prev,
        constructie: prev.constructie.filter((v) => v !== cons),
      }),
    });
  }

  for (const fl of filters.floors) {
    const opt = OLX_FLOOR_OPTIONS.find((o) => o.value === fl);
    tags.push({
      id: `floor:${fl}`,
      label: opt?.label || fl,
      remove: (prev) => ({
        ...prev,
        floors: prev.floors.filter((v) => v !== fl),
      }),
    });
  }

  for (const zone of filters.zones || []) {
    if (!zone) continue;
    tags.push({
      id: `zone:${zone}`,
      label: zone,
      remove: (prev) => ({
        ...prev,
        zones: (prev.zones || []).filter((v) => v !== zone),
      }),
    });
  }

  if (filters.searchText.trim()) {
    tags.push({
      id: `search:${filters.searchText.trim()}`,
      label: `"${filters.searchText.trim()}"`,
      remove: (prev) => ({ ...prev, searchText: "" }),
    });
  }

  return tags;
}

function slugifySearchQuery(text: string): string {
  const cleaned = normalizeRoText(text)
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .replace(/\s+/g, "-");
  return cleaned;
}

/**
 * Builds one or more OLX.ro listing search URLs corresponding to the selected filters.
 * Always enforces currency=EUR, search[private_business]=private, and search[order]=created_at:desc
 * so the newest/freshest private listings are fetched first.
 */
export function buildOlxSearchUrls(filters: OlxLeadFilters, page = 1): string[] {
  const txNorm = normalizeRoText(filters.transactionType);
  const isRent = txNorm.includes("inchir");
  const isSale = txNorm.includes("vanz");

  const hasApartmentSpecificFilters =
    filters.rooms.length > 0 ||
    filters.compartimentare.length > 0 ||
    filters.constructie.length > 0 ||
    filters.floors.length > 0;

  let targetCategories =
    filters.categories.length > 0
      ? [...filters.categories]
      : hasApartmentSpecificFilters
      ? ["Apartament"]
      : isRent || isSale
      ? ["Apartament", "Casa/Vila", "Spatiu Comercial"]
      : ["Apartament"];

  const pathsWithAlege: Array<{ path: string; alege?: "inchiriere" | "vanzare"; isApt?: boolean }> = [];

  for (const cat of targetCategories) {
    if (cat === "Apartament") {
      const txPaths: string[] = [];
      if (isRent) txPaths.push("imobiliare/apartamente-garsoniere-de-inchiriat");
      else if (isSale) txPaths.push("imobiliare/apartamente-garsoniere-de-vanzare");
      else {
        txPaths.push("imobiliare/apartamente-garsoniere-de-inchiriat");
        txPaths.push("imobiliare/apartamente-garsoniere-de-vanzare");
      }

      const roomSlugs =
        filters.rooms.length > 0
          ? filters.rooms
              .map((r) => OLX_ROOM_OPTIONS.find((opt) => opt.value === r)?.olxSlug)
              .filter((s): s is string => Boolean(s))
          : [];

      for (const txPath of txPaths) {
        if (roomSlugs.length > 0) {
          for (const roomSlug of roomSlugs) {
            pathsWithAlege.push({ path: `${txPath}/${roomSlug}`, isApt: true });
          }
        } else {
          pathsWithAlege.push({ path: txPath, isApt: true });
        }
      }
    } else if (cat === "Casa/Vila") {
      if (isRent) pathsWithAlege.push({ path: "imobiliare/case-de-inchiriat" });
      else if (isSale) pathsWithAlege.push({ path: "imobiliare/case-de-vanzare" });
      else {
        pathsWithAlege.push({ path: "imobiliare/case-de-inchiriat" });
        pathsWithAlege.push({ path: "imobiliare/case-de-vanzare" });
      }
    } else if (cat === "Spatiu Birou" || cat === "Spatiu Comercial") {
      pathsWithAlege.push({
        path: "imobiliare/birouri-spatii-comerciale",
        alege: isRent ? "inchiriere" : isSale ? "vanzare" : undefined,
      });
    } else if (cat === "Spatiu Industrial") {
      if (isRent) pathsWithAlege.push({ path: "imobiliare/industrial/deinchiriat" });
      else if (isSale) pathsWithAlege.push({ path: "imobiliare/industrial/devanzare" });
      else pathsWithAlege.push({ path: "imobiliare/industrial" });
    } else if (cat === "Teren") {
      pathsWithAlege.push({
        path: "imobiliare/terenuri",
        alege: isRent ? "inchiriere" : isSale ? "vanzare" : undefined,
      });
    } else if (cat === "Alte proprietati") {
      pathsWithAlege.push({
        path: "imobiliare/alte-proprietati",
        alege: isRent ? "inchiriere" : isSale ? "vanzare" : undefined,
      });
    }
  }

  // Fallback to all Bucharest real estate if empty
  if (pathsWithAlege.length === 0) {
    pathsWithAlege.push({ path: "imobiliare" });
  }

  const querySlug = slugifySearchQuery(filters.searchText);
  const priceFrom = filters.priceMin.replace(/[^\d.]/g, "").trim();
  const priceTo = filters.priceMax.replace(/[^\d.]/g, "").trim();
  const surfaceFrom = filters.surfaceMin.replace(/[^\d.]/g, "").trim();
  const surfaceTo = filters.surfaceMax.replace(/[^\d.]/g, "").trim();

  const urlSet = new Set<string>();

  for (const entry of pathsWithAlege) {
    let basePath = `https://www.olx.ro/${entry.path}/bucuresti/`;
    if (querySlug) {
      basePath += `q-${encodeURIComponent(querySlug)}/`;
    }

    const params: string[] = [];
    params.push("currency=EUR");
    params.push("search%5Border%5D=created_at:desc");
    params.push("search%5Bprivate_business%5D=private");

    if (entry.alege) {
      params.push(`search%5Bfilter_enum_alege%5D%5B0%5D=${encodeURIComponent(entry.alege)}`);
    }

    if (priceFrom) {
      params.push(`search%5Bfilter_float_price:from%5D=${encodeURIComponent(priceFrom)}`);
    }
    if (priceTo) {
      params.push(`search%5Bfilter_float_price:to%5D=${encodeURIComponent(priceTo)}`);
    }
    if (surfaceFrom) {
      params.push(`search%5Bfilter_float_m:from%5D=${encodeURIComponent(surfaceFrom)}`);
    }
    if (surfaceTo) {
      params.push(`search%5Bfilter_float_m:to%5D=${encodeURIComponent(surfaceTo)}`);
    }

    if (entry.isApt !== false) {
      filters.compartimentare.forEach((comp, idx) => {
        params.push(`search%5Bfilter_enum_compartimentare%5D%5B${idx}%5D=${encodeURIComponent(comp)}`);
      });
      filters.constructie.forEach((cons, idx) => {
        params.push(`search%5Bfilter_enum_constructie%5D%5B${idx}%5D=${encodeURIComponent(cons)}`);
      });
      filters.floors.forEach((fl, idx) => {
        params.push(`search%5Bfilter_enum_floor%5D%5B${idx}%5D=${encodeURIComponent(fl)}`);
      });
    }

    if (page > 1) {
      params.push(`page=${page}`);
    }

    urlSet.add(`${basePath}?${params.join("&")}`);
  }

  return Array.from(urlSet);
}

/**
 * Extracts normalized numeric price (in EUR) from lead string or structured CRM price.
 */
export function extractNumericPrice(lead: any): number {
  const candidates = [
    lead?.extractedData?.olxMeta?.priceEur,
    lead?.price,
    lead?.extractedData?.crmData?.pret?.detalii?.pret,
  ];
  for (const raw of candidates) {
    if (typeof raw === "number" && raw > 0) return raw;
    if (typeof raw === "string") {
      const cleaned = raw.replace(/\s/g, "").replace(/\.(?=\d{3}\b)/g, "");
      const m = cleaned.match(/(\d+(?:,\d+)?)/);
      if (m) {
        const val = parseFloat(m[1].replace(",", "."));
        if (!isNaN(val) && val > 0) {
          const lower = raw.toLowerCase();
          if (lower.includes("ron") || lower.includes("lei")) {
            return Math.round(val / 4.97);
          }
          return val;
        }
      }
    }
  }
  return 0;
}

/**
 * Extracts numeric usable surface (mp) from lead.
 */
export function extractNumericSurface(lead: any): number {
  const candidates = [
    lead?.extractedData?.olxMeta?.surface,
    lead?.extractedData?.crmData?.caracteristici?.suprafete?.utila,
    lead?.suprafataUtila,
    lead?.surface,
    lead?.suprafata,
  ];
  for (const raw of candidates) {
    if (typeof raw === "number" && raw > 0) return raw;
    if (typeof raw === "string") {
      const m = raw.replace(",", ".").match(/(\d+(?:\.\d+)?)/);
      if (m) {
        const val = parseFloat(m[1]);
        if (!isNaN(val) && val > 0) return val;
      }
    }
  }
  const textCombo = `${lead?.title || ""} ${lead?.notes || ""}`;
  const m = textCombo.match(/(\d+(?:[.,]\d+)?)\s*(?:mp|m2|m²)/i);
  if (m) {
    const val = parseFloat(m[1].replace(",", "."));
    if (!isNaN(val) && val > 0) return val;
  }
  return 0;
}

/**
 * Normalizes a lead's room count into '1', '2', '3', or '4+' (or '').
 */
export function extractNormalizedRooms(lead: any): string {
  const olxCatId = Number(lead?.extractedData?.olxMeta?.categoryId || 0);
  if (olxCatId === 1155 || olxCatId === 1163) return "1";
  if (olxCatId === 1157 || olxCatId === 1165) return "2";
  if (olxCatId === 1159 || olxCatId === 1167) return "3";
  if (olxCatId === 1161 || olxCatId === 1169) return "4+";

  const rawCandidates = [
    lead?.extractedData?.olxMeta?.rooms,
    lead?.extractedData?.crmData?.caracteristici?.detalii?.camere,
    lead?.camere,
    lead?.rooms,
  ];
  for (const raw of rawCandidates) {
    if (raw === undefined || raw === null || raw === "") continue;
    const str = normalizeRoText(raw);
    if (str.includes("garsonier") || str.includes("studio")) return "1";
    const m = str.match(/(\d+)/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n === 1) return "1";
      if (n === 2) return "2";
      if (n === 3) return "3";
      if (n >= 4) return "4+";
    }
  }

  const textCombo = normalizeRoText(`${lead?.title || ""} ${lead?.url || ""}`);
  if (textCombo.includes("garsonier") || textCombo.includes("1 camera")) return "1";
  const m = textCombo.match(/\b(\d+)\s*camere\b/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n === 1) return "1";
    if (n === 2) return "2";
    if (n === 3) return "3";
    if (n >= 4) return "4+";
  }
  return "";
}

/**
 * Normalizes a lead's compartimentare into OLX enum keys ('decomandat', 'semidecomandat', 'nedecomandat', 'circular', etc.).
 */
export function extractNormalizedCompartimentare(lead: any): string {
  const candidates = [
    lead?.extractedData?.olxMeta?.compartimentare,
    lead?.extractedData?.crmData?.caracteristici?.detalii?.compartimentare,
  ];
  for (const raw of candidates) {
    const norm = normalizeRoText(raw);
    if (!norm) continue;
    if (norm.includes("semidecomandat")) return "semidecomandat";
    if (norm.includes("nedecomandat")) return "nedecomandat";
    if (norm.includes("circular")) return "circular";
    if (norm.includes("decomandat")) return "decomandat";
    if (norm.includes("open space")) return "open-space";
  }
  const textCombo = normalizeRoText(`${lead?.title || ""} ${lead?.notes || ""}`);
  if (textCombo.includes("semidecomandat")) return "semidecomandat";
  if (textCombo.includes("nedecomandat")) return "nedecomandat";
  if (textCombo.includes("circular")) return "circular";
  if (textCombo.includes("decomandat")) return "decomandat";
  return "";
}

/**
 * Maps a raw construction year or bucket string to OLX constructie bucket(s).
 */
export function extractNormalizedConstructieBuckets(lead: any): string[] {
  const buckets = new Set<string>();
  const rawValues = [
    lead?.extractedData?.olxMeta?.constructie,
    lead?.extractedData?.crmData?.caracteristici?.alteDetalii?.anConstructie,
  ];

  for (const raw of rawValues) {
    const norm = normalizeRoText(raw);
    if (!norm) continue;
    if (norm.includes("inainte-de-1977") || norm.includes("inainte de 1977")) buckets.add("inainte-de-1977");
    if (norm.includes("1977-1990") || (norm.includes("1977") && norm.includes("1990"))) buckets.add("1977-1990");
    if (norm.includes("1990-2000") || (norm.includes("1990") && norm.includes("2000"))) buckets.add("1990-2000");
    if (norm.includes("dupa-2000") || norm.includes("dupa 2000")) buckets.add("dupa-2000");

    if (buckets.size === 0) {
      const ym = norm.match(/\b(19\d{2}|20\d{2})\b/);
      if (ym) {
        const year = parseInt(ym[1], 10);
        if (year < 1977) buckets.add("inainte-de-1977");
        else if (year >= 1977 && year < 1990) buckets.add("1977-1990");
        else if (year >= 1990 && year <= 2000) buckets.add("1990-2000");
        else if (year > 2000) buckets.add("dupa-2000");
      }
    }
  }

  return Array.from(buckets);
}

/**
 * Normalizes a lead's floor into OLX floor enum key ('demisol', 'parter', 'fl_1'..'fl_10', 'mansarda').
 */
export function extractNormalizedFloor(lead: any): string {
  const candidates = [
    lead?.extractedData?.olxMeta?.floor,
    lead?.extractedData?.crmData?.caracteristici?.detalii?.etaj,
  ];
  for (const raw of candidates) {
    const norm = normalizeRoText(raw);
    if (!norm) continue;
    if (norm.includes("demisol") || norm === "d") return "demisol";
    if (norm.includes("parter") || norm === "p") return "parter";
    if (norm.includes("mansard")) return "mansarda";
    if (/^fl_\d+$/.test(norm)) {
      const n = parseInt(norm.replace("fl_", ""), 10);
      return n >= 10 ? "fl_10" : `fl_${n}`;
    }
    const m = norm.match(/(?:etaj(?:ul)?\s*)?(\d+)/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n === 0) return "parter";
      if (n >= 10) return "fl_10";
      if (n >= 1 && n <= 9) return `fl_${n}`;
    }
  }
  return "";
}

/**
 * Normalizes a lead's category for matching against OLX_CATEGORY_OPTIONS.
 */
export function extractNormalizedCategory(lead: any): string {
  const raw = normalizeRoText(
    lead?.categoria || lead?.extractedData?.crmData?.detaliiGenerale?.categoria || ""
  );
  if (raw.includes("apartament") || raw.includes("garsonier")) return "Apartament";
  if (raw.includes("casa") || raw.includes("vila")) return "Casa/Vila";
  if (raw.includes("birou") || raw.includes("office")) return "Spatiu Birou";
  if (raw.includes("comercial") || raw.includes("magazin")) return "Spatiu Comercial";
  if (raw.includes("industrial") || raw.includes("hala") || raw.includes("depozit")) return "Spatiu Industrial";
  if (raw.includes("teren")) return "Teren";
  if (raw.includes("alte")) return "Alte proprietati";
  return lead?.categoria || "";
}

/**
 * Client & server side matching/pairing function that filters crawled OLX.ro leads
 * (or CRM leads with extracted specs) against the active OlxLeadFilters.
 */
export function matchesOlxLeadFilter(lead: any, filters: OlxLeadFilters): boolean {
  if (!hasActiveOlxFilters(filters)) return true;

  // 1. Text search
  if (filters.searchText.trim()) {
    const queryTokens = normalizeRoText(filters.searchText).split(" ").filter(Boolean);
    const haystack = normalizeRoText(
      [
        lead?.title,
        lead?.zone,
        lead?.notes,
        lead?.url,
        lead?.ownerName,
        lead?.ownerPhone,
        lead?.price,
        lead?.categoria,
        lead?.propertyId,
        lead?.id,
        lead?.extractedData?.originalDescription,
        lead?.extractedData?.crmData?.descriere?.titlu,
        lead?.extractedData?.crmData?.descriere?.continut,
      ]
        .filter(Boolean)
        .join(" ")
    );
    if (!queryTokens.every((t) => haystack.includes(t))) return false;
  }

  // 1b. Tip Lead (Proprietari / Cumpărători / Chiriași — only active on Lead-uri page)
  if (filters.leadRole) {
    const rawRole = normalizeRoText(lead?.leadType || "");
    const rawTx = normalizeRoText(lead?.transactionType || "");
    const isProprietar =
      rawRole === "proprietar" ||
      rawRole === "proprietari" ||
      (!rawRole && Boolean(lead?.url) && !lead?.isCerere);
    const isCumparator =
      rawRole === "cumparator" ||
      rawRole === "cumparatori" ||
      (!isProprietar && !rawRole && (rawTx.includes("cump") || rawTx.includes("vanz")));
    const isChirias =
      rawRole === "chirias" ||
      rawRole === "chiriasi" ||
      (!isProprietar && !isCumparator && rawTx.includes("inchir"));

    if (filters.leadRole === "Proprietari" && !isProprietar) return false;
    if (filters.leadRole === "Cumparatori" && !isCumparator) return false;
    if (filters.leadRole === "Chiriasi" && !isChirias) return false;
  }

  // 2. Tip tranzacție
  if (filters.transactionType) {
    const filterTx = normalizeRoText(filters.transactionType);
    const leadTx = normalizeRoText(
      lead?.transactionType || lead?.extractedData?.crmData?.detaliiGenerale?.tranzactie || ""
    );
    if (!leadTx) return false;
    if (filterTx.includes("inchir") && !leadTx.includes("inchir")) return false;
    if (filterTx.includes("cump") && !(leadTx.includes("cump") || leadTx.includes("vanz"))) return false;
    if (filterTx.includes("vanz") && !leadTx.includes("vanz")) return false;
  }

  // 3. Categoria imobilului (multi-select)
  if (filters.categories.length > 0) {
    const leadCat = extractNormalizedCategory(lead);
    const olxCatId = Number(lead?.extractedData?.olxMeta?.categoryId || 0);
    const matchesCat = filters.categories.some((selected) => {
      if (leadCat === selected) return true;
      // OLX combines Birou & Comercial under categoryId 710
      if (olxCatId === 710 && (selected === "Spatiu Birou" || selected === "Spatiu Comercial")) {
        return true;
      }
      return false;
    });
    if (!matchesCat) return false;
  }

  // 4. Subcategoria (camere) (multi-select)
  if (filters.rooms.length > 0) {
    const leadRooms = extractNormalizedRooms(lead);
    if (!leadRooms || !filters.rooms.includes(leadRooms)) return false;
  }

  // 5. Compartimentare (multi-select)
  if (filters.compartimentare.length > 0) {
    const leadComp = extractNormalizedCompartimentare(lead);
    if (!leadComp || !filters.compartimentare.includes(leadComp)) return false;
  }

  // 6. Pret minim / maxim (EUR)
  const priceMinNum = parseFloat(filters.priceMin);
  const priceMaxNum = parseFloat(filters.priceMax);
  if ((!isNaN(priceMinNum) && priceMinNum > 0) || (!isNaN(priceMaxNum) && priceMaxNum > 0)) {
    const leadPrice = extractNumericPrice(lead);
    if (!leadPrice) return false;
    if (!isNaN(priceMinNum) && priceMinNum > 0 && leadPrice < priceMinNum) return false;
    if (!isNaN(priceMaxNum) && priceMaxNum > 0 && leadPrice > priceMaxNum) return false;
  }

  // 7. Suprafata minima / maxima (mp)
  const surfMinNum = parseFloat(filters.surfaceMin);
  const surfMaxNum = parseFloat(filters.surfaceMax);
  if ((!isNaN(surfMinNum) && surfMinNum > 0) || (!isNaN(surfMaxNum) && surfMaxNum > 0)) {
    const leadSurface = extractNumericSurface(lead);
    if (!leadSurface) return false;
    if (!isNaN(surfMinNum) && surfMinNum > 0 && leadSurface < surfMinNum) return false;
    if (!isNaN(surfMaxNum) && surfMaxNum > 0 && leadSurface > surfMaxNum) return false;
  }

  // 8. An constructie (multi-select)
  if (filters.constructie.length > 0) {
    const leadBuckets = extractNormalizedConstructieBuckets(lead);
    if (leadBuckets.length === 0 || !filters.constructie.some((b) => leadBuckets.includes(b))) {
      return false;
    }
  }

  // 9. Etaj (multi-select)
  if (filters.floors.length > 0) {
    const leadFloor = extractNormalizedFloor(lead);
    if (!leadFloor || !filters.floors.includes(leadFloor)) return false;
  }

  // 10. Zone (multi-select)
  const selectedZones = Array.isArray(filters.zones) ? filters.zones.filter(Boolean) : [];
  if (selectedZones.length > 0) {
    const structuredZones = [
      lead?.zone,
      ...(Array.isArray(lead?.extractedData?.crmData?.detaliiGenerale?.localizare?.zona)
        ? lead.extractedData.crmData.detaliiGenerale.localizare.zona
        : []),
      lead?.extractedData?.crmData?.detaliiGenerale?.localizare?.oras,
    ]
      .filter(Boolean)
      .map((v) => normalizeRoText(v))
      .join(" ");

    const structuredNorm = structuredZones.replace(/[^a-z0-9]+/g, " ").trim();
    const fullHaystack = normalizeRoText(
      [
        structuredZones,
        lead?.extractedData?.olxMeta?.originalTitle,
        lead?.title,
        lead?.notes,
        lead?.url,
        lead?.extractedData?.originalDescription,
        lead?.extractedData?.crmData?.descriere?.titlu,
        lead?.extractedData?.crmData?.descriere?.continut,
      ]
        .filter(Boolean)
        .join(" ")
    )
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

    const matchesAnyZone = selectedZones.some((rawZone) => {
      const zoneClean = normalizeRoText(rawZone);
      if (!zoneClean) return false;
      const variants = new Set<string>();
      const baseNoParens = zoneClean.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
      if (baseNoParens) variants.add(baseNoParens.replace(/[^a-z0-9]+/g, " ").trim());
      const parenMatch = zoneClean.match(/\(([^)]+)\)/);
      if (parenMatch?.[1]) {
        variants.add(parenMatch[1].replace(/[^a-z0-9]+/g, " ").trim());
      }
      if (baseNoParens.startsWith("p-ta ") || baseNoParens.startsWith("p ta ")) {
        const rest = baseNoParens.replace(/^p[-\s]ta\s+/, "").trim();
        if (rest) {
          variants.add(`piata ${rest}`.replace(/[^a-z0-9]+/g, " ").trim());
          if (rest.length >= 4) variants.add(rest.replace(/[^a-z0-9]+/g, " ").trim());
        }
      }
      variants.add(zoneClean.replace(/[^a-z0-9]+/g, " ").trim());

      for (const variant of variants) {
        if (!variant) continue;
        const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const wordRegex = new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`);
        if (wordRegex.test(structuredNorm) || wordRegex.test(fullHaystack)) {
          return true;
        }
      }
      return false;
    });

    if (!matchesAnyZone) return false;
  }

  return true;
}
