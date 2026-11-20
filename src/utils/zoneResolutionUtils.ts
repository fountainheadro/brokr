import { ILFOV_LOCALITIES, ZONA_OPTIONS } from "../constants";

const GENERIC_FREE_TEXT_EXCLUSIONS = new Set<string>([
  "est",
  "vest",
  "nord",
  "sud",
  "nord-est",
  "nord-vest",
  "sud-est",
  "sud-vest",
  "central",
  "periferie",
  "exterior est",
  "exterior nord",
  "exterior sud",
  "exterior vest",
  "dn 1",
  "dn 2",
  "altul",
]);

const PLACEHOLDER_ZONE_VALUES = new Set<string>([
  "",
  "-",
  "n/a",
  "nespecificat",
  "nespecificata",
  "bucuresti",
  "bucharest",
  "ilfov",
  "romania",
]);

export function normalizeRoZoneText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ăâ]/g, "a")
    .replace(/[î]/g, "i")
    .replace(/[șş]/g, "s")
    .replace(/[țţ]/g, "t")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Returns true if the string represents only a Bucharest sector (or Bucharest + sector),
 * e.g. "Sector 2", "Sectorul 3", "București, Sector 1", "Sect. 6".
 */
export function isSectorLabel(value: unknown): boolean {
  const norm = normalizeRoZoneText(value);
  if (!norm) return false;
  if (/^(?:(?:bucuresti|bucharest)\s*[,/\-|•]?\s*)?(?:sector(?:ul)?|sect\.?)\s*[1-6]\b(?:\s*[,/\-|•]?\s*(?:bucuresti|bucharest))?$/i.test(norm)) {
    return true;
  }
  return false;
}

/**
 * Strips any "Sector 1..6" / "Sectorul 1..6" / "Bucuresti" noise from a raw zone string.
 */
export function stripSectorAndCityNoise(value: string): string {
  return value
    .replace(/\b(?:sector(?:ul)?|sect\.?)\s*[1-6]\b/gi, "")
    .replace(/\b(?:bucure[șşs]ti|bucharest)\b/gi, "")
    .replace(/^[\s,/\-|•]+|[\s,/\-|•]+$/g, "")
    .replace(/\s*[,/\-|•]\s*[,/\-|•]\s*/g, ", ")
    .trim();
}

interface AreaMatcherEntry {
  canonical: string;
  keyword: string;
  regex: RegExp;
}

function buildAreaMatchers(): AreaMatcherEntry[] {
  const rawAliases: Array<{ canonical: string; keyword: string }> = [];
  const seenKey = new Set<string>();

  const pushAlias = (canonical: string, rawKeyword: string) => {
    const kw = normalizeRoZoneText(rawKeyword)
      .replace(/[^\w\s.-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!kw || kw.length < 3) return;
    if (GENERIC_FREE_TEXT_EXCLUSIONS.has(kw)) return;
    const dedup = `${canonical}::${kw}`;
    if (seenKey.has(dedup)) return;
    seenKey.add(dedup);
    rawAliases.push({ canonical, keyword: kw });
  };

  // All official areas from ZONA_OPTIONS
  for (const area of ZONA_OPTIONS) {
    pushAlias(area, area);

    // Expand "P-ta ..." -> "Piata ...", "Pta ..."
    if (/^P-ta\s+/i.test(area)) {
      const rest = area.replace(/^P-ta\s+/i, "");
      pushAlias(area, `Piata ${rest}`);
      pushAlias(area, `Pta ${rest}`);
      pushAlias(area, `P-ta ${rest}`);
    }

    // Expand "Bd. ..." -> "Bulevardul ...", "B-dul ...", "Bd ..."
    if (/^Bd\.\s+/i.test(area)) {
      const rest = area.replace(/^Bd\.\s+/i, "");
      pushAlias(area, `Bulevardul ${rest}`);
      pushAlias(area, `B-dul ${rest}`);
      pushAlias(area, `Bd ${rest}`);
    }

    // Expand parenthesized variants like "23 August (Catelul)"
    const parenMatch = area.match(/^(.+?)\s*\((.+?)\)$/);
    if (parenMatch) {
      pushAlias(area, parenMatch[1]);
      pushAlias(area, parenMatch[2]);
    }

    // Expand hyphenated forms with space (e.g. "Vitan-Barzesti" -> "Vitan Barzesti")
    if (area.includes("-")) {
      pushAlias(area, area.replace(/-/g, " "));
    }
  }

  // All Ilfov localities (excluding generic "1 Decembrie" collision with "1 Decembrie 1918" which is longer and checked first)
  for (const loc of ILFOV_LOCALITIES) {
    pushAlias(loc, loc);
    if (loc.includes("-")) {
      pushAlias(loc, loc.replace(/-/g, " "));
    }
  }

  // Common Romanian ad phrasing aliases that map cleanly to canonical ZONA_OPTIONS entries
  const extraCanonicalAliases: Array<[string, string]> = [
    ["Bucur Obor", "bucur-obor"],
    ["Theodor Pallady", "pallady"],
    ["Theodor Pallady", "nicolae teclu"],
    ["Theodor Pallady", "teclu"],
    ["Iancului", "piata iancului"],
    ["Iancului", "p-ta iancului"],
    ["Obor", "piata obor"],
    ["Obor", "p-ta obor"],
    ["Stefan cel Mare", "sos stefan cel mare"],
    ["Stefan cel Mare", "soseaua stefan cel mare"],
    ["Mihai Bravu", "sos mihai bravu"],
    ["Mihai Bravu", "soseaua mihai bravu"],
    ["Calea Victoriei", "victoriei calea"],
    ["Drumul Taberei", "dr taberei"],
    ["13 Septembrie", "calea 13 septembrie"],
    ["Calea Calarasilor", "calarasilor"],
    ["Nicolae Grigorescu", "grigorescu"],
    ["Eroii Revolutiei", "eroii revolutiei"],
    ["Aparatorii Patriei", "aparatorii patriei"],
    ["Alexandru Obregia", "obregia"],
    ["Camil Ressu", "ressu"],
    ["Lucretiu Patrascanu", "patrascanu"],
    ["Pache Protopopescu", "protopopescu"],
    ["P-ta Unirii", "piata unirii"],
    ["P-ta Victoriei", "piata victoriei"],
    ["P-ta Romana", "piata romana"],
    ["P-ta Universitatii", "piata universitatii"],
    ["P-ta Muncii", "piata muncii"],
    ["P-ta Alba Iulia", "piata alba iulia"],
    ["P-ta Amzei", "piata amzei"],
    ["P-ta Dorobanti", "piata dorobanti"],
    ["P-ta Gorjului", "piata gorjului"],
    ["P-ta Operei", "piata operei"],
    ["P-ta Rosetti", "piata rosetti"],
    ["Universitate", "universitatii"],
    ["Soseaua Nordului", "sos nordului"],
    ["Splaiul Unirii", "splaiul unirii"],
    ["Splaiul Independentei", "splaiul independentei"],
    ["Barbu Vacarescu", "barbu vacarescu"],
    ["Vatra Luminoasa", "vatra luminoasa"],
    ["Lacul Tei", "lacul tei"],
    ["Teiul Doamnei", "teiul doamnei"],
    ["Doamna Ghica", "doamna ghica"],
    ["Foisorul de Foc", "foisorul de foc"],
    ["Parcul Carol", "parcul carol"],
    ["Parcul Circului", "parcul circului"],
    ["Arcul de Triumf", "arcul de triumf"],
    ["Gara de Nord", "gara de nord"],
    ["Gara de Est", "gara de est"],
    ["Centrul Istoric", "centrul vechi"],
    ["Vitan Mall", "mall vitan"],
    ["Vitan Mall", "bucuresti mall"],
    ["Militari", "militari residence"],
    ["Popesti-Leordeni", "popesti leordeni"],
    ["Popesti-Leordeni", "popesti"],
  ];

  for (const [canonical, alias] of extraCanonicalAliases) {
    pushAlias(canonical, alias);
  }

  // Sort longest keyword first so specific multi-word areas ("Bucur Obor", "Iancu Nicolae",
  // "P-ta Alba Iulia", "Prelungirea Ghencea") always match before shorter substrings ("Obor", "Iancului", "Ghencea").
  rawAliases.sort((a, b) => b.keyword.length - a.keyword.length);

  return rawAliases.map((entry) => {
    const pattern = escapeRegExp(entry.keyword).replace(/\s+/g, "[\\s\\-.,/]+");
    return {
      canonical: entry.canonical,
      keyword: entry.keyword,
      regex: new RegExp(`(?:^|[^a-z0-9])${pattern}(?:$|[^a-z0-9])`, "i"),
    };
  });
}

const AREA_MATCHERS: AreaMatcherEntry[] = buildAreaMatchers();

/**
 * Searches free text (ad title, ad description, or URL slug) against the existing
 * areas database (`ZONA_OPTIONS` + `ILFOV_LOCALITIES`) and returns the best canonical area match.
 */
export function findAreaInText(text: unknown): string | null {
  const norm = normalizeRoZoneText(text);
  if (!norm) return null;

  for (const matcher of AREA_MATCHERS) {
    if (matcher.regex.test(norm)) {
      return matcher.canonical;
    }
  }
  return null;
}

function extractUrlSlugText(url: unknown): string {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    return decodeURIComponent(parsed.pathname).replace(/[-_/]+/g, " ");
  } catch {
    return raw.replace(/[-_/]+/g, " ");
  }
}

export interface ResolveAreaParams {
  rawZone?: string | string[] | null;
  city?: string | null;
  title?: string | null;
  description?: string | null;
  url?: string | null;
}

/**
 * Resolves a clean neighborhood/area name for a property or lead.
 * NEVER returns a Bucharest sector ("Sector 1".."Sector 6").
 * When the stored/external zone is a sector or generic city, searches the ad title,
 * description, and URL slug against the existing database of areas (`ZONA_OPTIONS` + `ILFOV_LOCALITIES`).
 */
export function resolveAreaFromAd(params: ResolveAreaParams): string {
  const zoneCandidates: string[] = [];
  if (Array.isArray(params.rawZone)) {
    for (const z of params.rawZone) {
      if (typeof z === "string" && z.trim()) zoneCandidates.push(z.trim());
    }
  } else if (typeof params.rawZone === "string" && params.rawZone.trim()) {
    zoneCandidates.push(params.rawZone.trim());
  }

  // 1. If a provided zone is NOT a sector and NOT a placeholder/generic city, use or canonicalize it
  for (const raw of zoneCandidates) {
    if (isSectorLabel(raw)) continue;
    const normRaw = normalizeRoZoneText(raw);
    if (PLACEHOLDER_ZONE_VALUES.has(normRaw)) continue;

    // Check if the raw value directly matches an area in the database (even if paired with "Sector 2" or "Bucuresti")
    const matchedFromRaw = findAreaInText(raw);
    if (matchedFromRaw) return matchedFromRaw;

    const stripped = stripSectorAndCityNoise(raw);
    if (stripped && !isSectorLabel(stripped) && !PLACEHOLDER_ZONE_VALUES.has(normalizeRoZoneText(stripped))) {
      return stripped;
    }
  }

  // 2. Search ad title first (highest precision), then ad description, then URL slug
  const fromTitle = findAreaInText(params.title);
  if (fromTitle) return fromTitle;

  const fromDescription = findAreaInText(params.description);
  if (fromDescription) return fromDescription;

  const fromUrl = findAreaInText(extractUrlSlugText(params.url));
  if (fromUrl) return fromUrl;

  // 3. Fallback: if city is a specific Ilfov locality or non-sector city, return it; never a sector
  const cityRaw = String(params.city || "").trim();
  if (cityRaw && !isSectorLabel(cityRaw)) {
    const matchedCity = findAreaInText(cityRaw);
    if (matchedCity) return matchedCity;
    const strippedCity = stripSectorAndCityNoise(cityRaw);
    if (strippedCity && !isSectorLabel(strippedCity)) return strippedCity;
    if (normalizeRoZoneText(cityRaw) === "bucuresti") return "București";
  }

  return "București";
}

/**
 * Resolves the display area for any Lead/Property/Cerere card object,
 * guaranteeing that a sector ("Sector 1".."Sector 6") is never displayed.
 */
export function resolveLeadDisplayArea(lead: {
  zone?: string;
  title?: string;
  notes?: string;
  url?: string;
  extractedData?: any;
}): string {
  const crmLoc = lead.extractedData?.crmData?.detaliiGenerale?.localizare;
  const crmZona = Array.isArray(crmLoc?.zona)
    ? crmLoc.zona.filter(Boolean)
    : typeof crmLoc?.zona === "string"
      ? [crmLoc.zona]
      : [];

  const rawZoneList = [
    ...(lead.zone ? [lead.zone] : []),
    ...crmZona,
  ];

  const titleCandidates = [
    lead.extractedData?.olxMeta?.originalTitle,
    lead.title,
    lead.extractedData?.crmData?.descriere?.titlu,
  ]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .join(" | ");

  const descriptionCandidates = [
    lead.extractedData?.originalDescription,
    lead.extractedData?.crmData?.descriere?.continut,
    lead.notes,
    lead.extractedData?.automationSource?.rawText,
  ]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .join("\n");

  return resolveAreaFromAd({
    rawZone: rawZoneList,
    city: crmLoc?.oras || "București",
    title: titleCandidates,
    description: descriptionCandidates,
    url: lead.url,
  });
}
