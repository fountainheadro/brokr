import {
  TitleAutomationRule,
  TitleCategoryId,
  normalizeTitleAutomationRule,
} from "../core/automation/typ_title-automation";
import { hasRealNeighborhoodArea } from "./zoneResolutionUtils";

export interface TitleExtractionInput {
  transactionType?: string;
  categoria?: string;
  camere?: string | number;
  suprafataUtila?: string | number;
  suprafataConstruita?: string | number;
  etaj?: string | number;
  etajeTotal?: string | number;
  zona?: string;
  oras?: string;
  statie?: string;
  distantaStatie?: string;
  numeParc?: string;
  distantaParc?: string;
  numeAtractie?: string;
  distantaAtractie?: string;
  mobilat?: string;
  utilare?: string;
  parcare?: string | boolean;
  petFriendly?: string | boolean;
  propertyId?: string;
  rawTitle?: string;
  rawText?: string;
}

interface ParsedSegment {
  kind: "dynamic" | "filler" | "connector" | "text";
  raw: string;
  tokenKey: string;
  categoryId?: TitleCategoryId;
  tagId?: string;
  value: string;
  dropped?: boolean;
}

const KNOWN_METRO_STATIONS = [
  "Drumul Taberei",
  "Romancierilor",
  "Favorit",
  "Orizont",
  "Academia Militara",
  "Răul Doamnei",
  "Raul Doamnei",
  "Parc Drumul Taberei",
  "Tudor Vladimirescu",
  "Lujerului",
  "Gorjului",
  "Pacii",
  "Preciziei",
  "Politehnica",
  "Grozavesti",
  "Petrache Poenaru",
  "Crangasi",
  "Basarab",
  "Gara de Nord",
  "Eroilor",
  "Izvor",
  "Piata Unirii",
  "Unirii",
  "Universitate",
  "Piata Romana",
  "Romana",
  "Piata Victoriei",
  "Victoriei",
  "Aviatorilor",
  "Aurel Vlaicu",
  "Pipera",
  "Stefan cel Mare",
  "Obor",
  "Iancului",
  "Piata Muncii",
  "Muncii",
  "Dristor",
  "Mihai Bravu",
  "Timpuri Noi",
  "Tineretului",
  "Eroii Revolutiei",
  "Constantin Brancoveanu",
  "Piata Sudului",
  "Aparatorii Patriei",
  "Dimitrie Leonida",
  "Berceni",
  "Tudor Arghezi",
  "Nicolae Grigorescu",
  "Titan",
  "Costin Georgian",
  "Republica",
  "Pantelimon",
  "1 Decembrie 1918",
  "Nicolae Teclu",
  "Anghel Saligny",
  "Izvorul Rece",
  "Gara Basarab",
  "Jiului",
  "Parc Bazilescu",
  "Laminorului",
  "Straulesti",
  "1 Mai",
  "Grivita",
];

function stripDiacriticsLower(s: string): string {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function sanitizeAdCopy(value: string): string {
  return String(value || "")
    .replace(/\b0\s*%\s*comision\b/gi, "")
    .replace(/\bcomision\s*0\s*%?\b/gi, "")
    .replace(/\b0\s*(?:euro|eur|ron|lei)\s*comision\b/gi, "")
    .replace(/(?:str\.?|strada|bd\.?|bulevardul|sos\.?|soseaua|calea|aleea|splaiul?)\s+[^,|•\n]+/gi, "")
    .replace(/\b(?:nr\.?|numarul)\s*\d+[a-z]?\b/gi, "")
    .replace(/\b(?:bl\.?|bloc)\s*\d+[a-z]?\b/gi, "")
    .replace(/\b(?:sc\.?|scara)\s*\d+[a-z]?\b/gi, "")
    .replace(/\b(?:ap\.?\s*\d+|apartament(?:ul)?\s+nr\.?\s*\d+)\b/gi, "")
    .replace(/\b(?:residence|complex|ansamblul?|towers?|hills?|astorium|cosmopolis|greenfield|militari\s+residence|plaza\s+residence|rotar\s+park|cloud9|belvedere|one\s+floreasca|one\s+herastrau|upground|marmura|novum|exigent)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function cleanFloorLabel(etajRaw: string | number | undefined): { floorLabel: string; inlineTotal: string } {
  const s = String(etajRaw || "").trim();
  if (!s) return { floorLabel: "", inlineTotal: "" };

  const slashMatch = s.match(/^(?:etaj(?:ul)?\s*)?(\d+|p|parter|d|demisol|m|mansarda)\s*\/\s*(\d+)$/i);
  if (slashMatch) {
    const fl = slashMatch[1];
    const tot = slashMatch[2];
    if (/^\d+$/.test(fl)) return { floorLabel: `Etaj ${fl}`, inlineTotal: tot };
    if (/^p/i.test(fl)) return { floorLabel: "Parter", inlineTotal: tot };
    if (/^d/i.test(fl)) return { floorLabel: "Demisol", inlineTotal: tot };
    if (/^m/i.test(fl)) return { floorLabel: "Mansarda", inlineTotal: tot };
    return { floorLabel: fl, inlineTotal: tot };
  }

  const lower = stripDiacriticsLower(s);
  if (lower === "parter" || lower === "p") return { floorLabel: "Parter", inlineTotal: "" };
  if (lower === "demisol" || lower === "d") return { floorLabel: "Demisol", inlineTotal: "" };
  if (lower === "mansarda" || lower === "m") return { floorLabel: "Mansarda", inlineTotal: "" };

  const numOnly = s.match(/^(?:etaj(?:ul)?\s*)?(\d+)$/i);
  if (numOnly) return { floorLabel: `Etaj ${numOnly[1]}`, inlineTotal: "" };

  return { floorLabel: s, inlineTotal: "" };
}

function extractTotalFloors(input: TitleExtractionInput, combinedText: string, inlineTotal: string): string {
  if (input.etajeTotal !== undefined && input.etajeTotal !== null && String(input.etajeTotal).trim()) {
    return String(input.etajeTotal).replace(/[^\d]/g, "");
  }
  if (inlineTotal) return inlineTotal;

  const patterns = [
    /(?:etaj(?:ul)?\s*(?:\d+|parter|demisol)\s*(?:\/|din)\s*)(\d{1,2})\b/i,
    /\b[pP]\s*\+\s*(\d{1,2})\b/,
    /(?:regim\s*inaltime|bloc\s*cu|imobil\s*cu|cladire\s*cu)\s*(?:p\s*\+\s*)?(\d{1,2})\s*etaje\b/i,
    /\b(\d{1,2})\s*etaje\b/i,
  ];
  for (const re of patterns) {
    const m = combinedText.match(re);
    if (m && m[1]) return m[1];
  }
  return "";
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildWordBoundaryRegex(phrase: string): RegExp {
  const normalized = stripDiacriticsLower(phrase);
  const pattern = escapeRegExp(normalized).replace(/\s+/g, "[\\s\\-.,/]+");
  return new RegExp(`(?:^|[^a-z0-9])(${pattern})(?:$|[^a-z0-9])`, "gi");
}

// Sort metro stations longest first so multi-word stations ("Piata Unirii", "Parc Drumul Taberei",
// "1 Decembrie 1918") match before shorter names.
const METRO_STATION_MATCHERS = [...KNOWN_METRO_STATIONS]
  .sort((a, b) => b.length - a.length)
  .map((name) => ({
    name,
    norm: stripDiacriticsLower(name),
    regex: buildWordBoundaryRegex(name),
  }));

const METRO_EXPLICIT_STOPWORDS = new Set([
  "la",
  "in",
  "de",
  "pe",
  "cu",
  "sau",
  "si",
  "din",
  "langa",
  "aproape",
  "direct",
  "acces",
  "rapid",
  "minute",
  "min",
  "mers",
  "distanta",
  "bucuresti",
  "sector",
  "zona",
  "m1",
  "m2",
  "m3",
  "m4",
  "m5",
  "statie",
  "statia",
  "pentru",
  "este",
  "sunt",
  "catre",
  "spre",
  "doar",
  "circa",
  "aproximativ",
]);

const NON_PARK_WORDS = new Set([
  "auto",
  "industrial",
  "logistic",
  "logistica",
  "comercial",
  "rezidential",
  "foto",
  "de",
  "cu",
  "si",
  "la",
  "in",
  "din",
  "pentru",
  "care",
  "este",
  "sunt",
  "sau",
  "nou",
  "mare",
  "mic",
  "propriu",
  "privat",
]);

function extractTransitInfo(input: TitleExtractionInput, combinedText: string): { statie: string; distantaStatie: string } {
  let statie = (input.statie || "").trim();
  let distantaStatie = (input.distantaStatie || "").trim();

  const normText = combinedText;
  const textNoDia = stripDiacriticsLower(normText);

  // Only match metro stations when the original text genuinely mentions "metrou"
  // (never trigger on generic "statie STB / tramvai / autobuz" + an unrelated word like "romana" or "1 mai").
  const metroCueRegex = /\b(?:metrou(?:l)?|statia\s+de\s+metrou|statie\s+de\s+metrou)\b/gi;
  const metroOffsets: number[] = [];
  let cueMatch: RegExpExecArray | null;
  while ((cueMatch = metroCueRegex.exec(textNoDia)) !== null) {
    metroOffsets.push(cueMatch.index);
  }

  if (!statie && metroOffsets.length > 0) {
    // 1. Find the known metro station that appears closest to an actual "metrou" mention (within +/- 50 chars)
    let bestStation = "";
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestLength = 0;

    for (const matcher of METRO_STATION_MATCHERS) {
      matcher.regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = matcher.regex.exec(textNoDia)) !== null) {
        const matchPos = m.index + (m[0].length - m[1].length - (m[0].endsWith(m[1]) ? 0 : 1));
        for (const cuePos of metroOffsets) {
          const dist = Math.abs(matchPos - cuePos);
          // Station must appear within the same clause/window (<= 50 chars) and without a sentence break in between
          if (dist <= 50) {
            const between = textNoDia.slice(Math.min(matchPos, cuePos), Math.max(matchPos, cuePos));
            if (/[.\n!?]/.test(between)) continue;
            if (dist < bestDistance || (dist === bestDistance && matcher.norm.length > bestLength)) {
              bestDistance = dist;
              bestLength = matcher.norm.length;
              bestStation = matcher.name;
            }
          }
        }
      }
    }

    if (bestStation) {
      statie = bestStation;
    } else {
      // 2. Fallback: explicit "metrou <Proper Name>" immediately following "metrou", verified against stopwords
      const metrouExplicit = normText.match(
        /\bmetrou\s+([A-ZĂÂÎȘȚ][a-zăâîșțA-ZĂÂÎȘȚ0-9\-]+(?:\s+[A-ZĂÂÎȘȚ][a-zăâîșț0-9\-]+){0,2})/
      );
      if (metrouExplicit && metrouExplicit[1]) {
        const candidate = metrouExplicit[1].trim();
        const words = stripDiacriticsLower(candidate).split(/\s+/).filter(Boolean);
        const firstWord = words[0] || "";
        if (
          words.length > 0 &&
          !METRO_EXPLICIT_STOPWORDS.has(firstWord) &&
          !/^\d+$/.test(firstWord)
        ) {
          // Only accept if it matches a known station or looks like a clean station name (not generic ad copy)
          const matchedKnown = METRO_STATION_MATCHERS.find((st) =>
            stripDiacriticsLower(candidate).includes(st.norm)
          );
          if (matchedKnown) {
            statie = matchedKnown.name;
          }
        }
      }
    }
  }

  if (!distantaStatie && metroOffsets.length > 0) {
    const distMatches = [
      normText.match(/\bmetrou[^\n.,;]{0,45}?\b(?:la|la doar)?\s*(\d{1,2}\s*(?:min(?:ute)?|m))\b/i),
      normText.match(/\b(\d{1,2}\s*(?:min(?:ute)?))\s*(?:de|pana la|mers(?:\s*pe\s*jos)?\s*(?:de|la)?)\s*(?:metrou|statia\s+de\s+metrou|statie\s+de\s+metrou)\b/i),
      normText.match(/\b(\d{2,4}\s*m)\s*(?:de|la)?\s*(?:metrou|statia\s+de\s+metrou|statie\s+de\s+metrou)\b/i),
    ];
    for (const m of distMatches) {
      if (m && m[1]) {
        distantaStatie = m[1].replace(/\bmin\b/i, "minute").replace(/\s+/g, " ").trim();
        break;
      }
    }
  }

  return { statie: sanitizeAdCopy(statie), distantaStatie: sanitizeAdCopy(distantaStatie) };
}

function extractParkInfo(input: TitleExtractionInput, combinedText: string): { numeParc: string; distantaParc: string } {
  let numeParc = (input.numeParc || "").trim();
  let distantaParc = (input.distantaParc || "").trim();

  if (!numeParc) {
    const parkRe = /\bParc(?:ul)?\s+([A-ZĂÂÎȘȚ][a-zăâîșț0-9\-]+(?:\s+[A-ZĂÂÎȘȚ][a-zăâîșț0-9\-]+){0,2})/g;
    let m: RegExpExecArray | null;
    while ((m = parkRe.exec(combinedText)) !== null) {
      const candidate = m[1].trim();
      const firstWord = stripDiacriticsLower(candidate).split(/\s+/)[0] || "";
      if (firstWord && !NON_PARK_WORDS.has(firstWord)) {
        numeParc = `Parcul ${candidate}`;
        break;
      }
    }
    if (!numeParc && /\b(?:langa parc|lângă parc|langa parcul|lângă parcul|vedere la parc|vis-a-vis de parc|vizavi de parc)\b/i.test(combinedText)) {
      numeParc = "Parc";
    }
  }

  if (!distantaParc && numeParc) {
    const dm =
      combinedText.match(/\b(\d{1,2}\s*min(?:ute)?)\s*(?:de|pana la)?\s*(?:parc|parcul)\b/i) ||
      combinedText.match(/\bparc(?:ul)?[^\n.,;]{0,35}?\b(\d{1,2}\s*min(?:ute)?)\b/i);
    if (dm && dm[1]) {
      distantaParc = dm[1].replace(/\bmin\b/i, "minute").trim();
    }
  }

  return { numeParc: sanitizeAdCopy(numeParc), distantaParc: sanitizeAdCopy(distantaParc) };
}

function extractAttractionInfo(input: TitleExtractionInput, combinedText: string): { numeAtractie: string; distantaAtractie: string } {
  let numeAtractie = (input.numeAtractie || "").trim();
  let distantaAtractie = (input.distantaAtractie || "").trim();

  if (!numeAtractie) {
    const attractions = [
      "AFI Cotroceni",
      "Promenada Mall",
      "ParkLake",
      "Mega Mall",
      "Baneasa Shopping City",
      "Plaza Romania",
      "Sun Plaza",
      "Veranda Mall",
      "Centrul Vechi",
      "Piata Unirii",
      "Piata Victoriei",
      "Calea Victoriei",
    ];
    const lower = stripDiacriticsLower(combinedText);
    for (const attr of attractions) {
      const re = buildWordBoundaryRegex(attr);
      if (re.test(lower)) {
        numeAtractie = attr;
        break;
      }
    }
    if (!numeAtractie) {
      const mallMatch = combinedText.match(/\b([A-ZĂÂÎȘȚ][a-zăâîșț]+(?:\s+[A-ZĂÂÎȘȚ][a-zăâîșț]+)?\s+Mall|Mall\s+[A-ZĂÂÎȘȚ][a-zăâîșț]+)\b/);
      if (mallMatch) numeAtractie = mallMatch[1];
    }
  }

  if (!distantaAtractie && numeAtractie) {
    const escaped = escapeRegExp(numeAtractie);
    const dm =
      combinedText.match(new RegExp(`(\\d{1,2}\\s*min(?:ute)?)\\s*(?:de|pana la)?\\s*${escaped}`, "i")) ||
      combinedText.match(new RegExp(`${escaped}[^\\n.,;]{0,30}?(\\d{1,2}\\s*min(?:ute)?)`, "i"));
    if (dm && dm[1]) {
      distantaAtractie = dm[1].replace(/\bmin\b/i, "minute").trim();
    }
  }

  return { numeAtractie: sanitizeAdCopy(numeAtractie), distantaAtractie: sanitizeAdCopy(distantaAtractie) };
}

function mapPropertyTypeLabel(categoria: string | undefined, lowerText: string): string {
  const c = stripDiacriticsLower(categoria || "");
  if (c.includes("garsonier") || c.includes("studio") || /\b(?:garsonier[aă]?|studio)\b/.test(lowerText)) {
    if (c.includes("garsonier") || /\bgarsonier[aă]?\b/.test(lowerText)) return "Garsoniera";
    return "Studio";
  }
  if (c.includes("cas") || c.includes("vil")) return "Vila";
  if (c.includes("birou") || c.includes("office")) return "Spatiu birouri";
  if (c.includes("comercial") || c.includes("magazin")) return "Spatiu comercial";
  if (c.includes("industrial") || c.includes("hala") || c.includes("depozit")) return "Spatiu industrial";
  if (c.includes("teren")) return "Teren";
  return "Apartament";
}

function buildResolvedTagValues(
  rule: TitleAutomationRule,
  input: TitleExtractionInput
): Record<string, { value: string; categoryId: TitleCategoryId; tagId: string }> {
  const rawTitle = String(input.rawTitle || "");
  const rawText = String(input.rawText || "");
  const combined = `${rawTitle}\n${rawText}`.trim();
  const lower = stripDiacriticsLower(combined);

  const isRent = stripDiacriticsLower(input.transactionType || "").includes("inchir");
  const tipTranzactie = isRent ? "inchiriat" : "vanzare";

  const tipProprietate = mapPropertyTypeLabel(input.categoria, lower);

  const numCamere =
    typeof input.camere === "number"
      ? input.camere
      : parseInt(String(input.camere || "").replace(/\D/g, ""), 10);
  const camereStr =
    tipProprietate === "Garsoniera" || tipProprietate === "Studio"
      ? ""
      : Number.isFinite(numCamere) && numCamere > 0
      ? numCamere === 1
        ? "1 camera"
        : `${numCamere} camere`
      : "";

  const utilaNum = parseFloat(String(input.suprafataUtila || "").replace(",", ".").replace(/[^\d.]/g, ""));
  const suprafataUtilaStr = Number.isFinite(utilaNum) && utilaNum > 0 ? `${Math.round(utilaNum)}mp` : "";

  const constrInputNum = parseFloat(String(input.suprafataConstruita || "").replace(",", ".").replace(/[^\d.]/g, ""));
  const computedConstr =
    Number.isFinite(constrInputNum) && constrInputNum > 0
      ? Math.round(constrInputNum)
      : Number.isFinite(utilaNum) && utilaNum > 0
      ? Math.round(utilaNum * (tipProprietate === "Apartament" || tipProprietate === "Vila" || tipProprietate === "Garsoniera" || tipProprietate === "Studio" ? 1.2 : 1.1))
      : 0;
  const suprafataConstruitaStr = computedConstr > 0 ? `${computedConstr}mp` : "";

  const { floorLabel, inlineTotal } = cleanFloorLabel(input.etaj);
  const etajeTotalStr = extractTotalFloors(input, combined, inlineTotal);

  const { statie, distantaStatie } = extractTransitInfo(input, combined);
  const { numeParc, distantaParc } = extractParkInfo(input, combined);
  const distSiNumeParc = distantaParc && numeParc ? `${distantaParc} ${numeParc}` : numeParc || distantaParc;

  const { numeAtractie, distantaAtractie } = extractAttractionInfo(input, combined);
  const distSiNumeAtractie =
    distantaAtractie && numeAtractie ? `${distantaAtractie} ${numeAtractie}` : numeAtractie || distantaAtractie;

  const rawZona = String(input.zona || "").trim();
  const zonaStr = hasRealNeighborhoodArea(rawZona) ? sanitizeAdCopy(rawZona) : "";

  const mobNorm = stripDiacriticsLower(input.mobilat || "");
  let mobilareStr = "";
  if (mobNorm.includes("nemobilat") || mobNorm === "fara" || /\bnemobilat\b/.test(lower)) mobilareStr = "Nemobilat";
  else if (mobNorm.includes("partial") || /\bsemimobilat|partial\s*mobilat\b/.test(lower)) mobilareStr = "Semimobilat";
  else if (mobNorm.includes("lux") || /\bmobilat\s*lux\b/.test(lower)) mobilareStr = "Mobilat Lux";
  else if (mobNorm.includes("complet") || mobNorm.includes("mobilat") || /\bmobilat\b/.test(lower)) mobilareStr = "Mobilat";

  const utilNorm = stripDiacriticsLower(input.utilare || "");
  let utilareStr = "";
  if (utilNorm.includes("neutilat") || utilNorm === "fara" || /\bneutilat\b/.test(lower)) utilareStr = "Neutilat";
  else if (utilNorm.includes("partial") || /\bpartial\s*utilat\b/.test(lower)) utilareStr = "Partial utilat";
  else if (utilNorm.includes("complet") || utilNorm.includes("utilat") || /\butilat[aă]?\b/.test(lower)) utilareStr = "Utilat";

  let parcareStr = "";
  if (typeof input.parcare === "string" && input.parcare.trim()) {
    const pNorm = stripDiacriticsLower(input.parcare);
    if (!pNorm.includes("fara") && pNorm !== "0") {
      parcareStr = sanitizeAdCopy(input.parcare);
    }
  } else if (
    input.parcare === true ||
    /\b(?:loc\s*de\s*parcare|parcare\s*(?:inclusa|subterana|supraterana|proprie|rezervata|acoperita)?|garaj)\b/i.test(lower)
  ) {
    parcareStr = /\bgaraj\b/i.test(lower) ? "Garaj" : "Parcare";
  }

  let petStr = "";
  if (typeof input.petFriendly === "string" && input.petFriendly.trim()) {
    petStr = sanitizeAdCopy(input.petFriendly);
  } else if (input.petFriendly === true || /\b(?:pet\s*friendly|accept[aă]?\s*animale|cu\s*animale|animale\s*de\s*companie\s*acceptate)\b/i.test(lower)) {
    petStr = "Pet Friendly";
  } else if (/\b(?:fara\s*animale|nu\s*accept[aă]?\s*animale|nu\s*se\s*accepta\s*animale)\b/i.test(lower)) {
    petStr = "Fara animale";
  }

  const p1 = sanitizeAdCopy(rule.customValues?.personalizat1 || "");
  const p2 = sanitizeAdCopy(rule.customValues?.personalizat2 || "");
  const p3 = sanitizeAdCopy(rule.customValues?.personalizat3 || "");
  const propId = String(input.propertyId || "").trim();

  const map: Record<string, { value: string; categoryId: TitleCategoryId; tagId: string }> = {
    "tip tranzactie": { value: tipTranzactie, categoryId: "tranzactie", tagId: "tip_tranzactie" },
    "tip proprietate": { value: tipProprietate, categoryId: "general", tagId: "tip" },
    tip: { value: tipProprietate, categoryId: "general", tagId: "tip" },
    camere: { value: camereStr, categoryId: "general", tagId: "camere" },
    "suprafata utila": { value: suprafataUtilaStr, categoryId: "general", tagId: "utila" },
    utila: { value: suprafataUtilaStr, categoryId: "general", tagId: "utila" },
    "suprafata construita": { value: suprafataConstruitaStr, categoryId: "general", tagId: "construita" },
    construita: { value: suprafataConstruitaStr, categoryId: "general", tagId: "construita" },
    etaj: { value: floorLabel, categoryId: "general", tagId: "etaj" },
    "etaje in total": { value: etajeTotalStr, categoryId: "general", tagId: "etaje_total" },
    zona: { value: zonaStr, categoryId: "general", tagId: "zona" },
    cartier: { value: zonaStr, categoryId: "general", tagId: "zona" },
    statie: { value: statie, categoryId: "transport", tagId: "statie" },
    "distanta statie": { value: distantaStatie, categoryId: "transport", tagId: "distanta_statie" },
    "nume parc": { value: numeParc, categoryId: "relaxare", tagId: "nume_parc" },
    "distanta si nume parc": { value: distSiNumeParc, categoryId: "relaxare", tagId: "distanta_si_nume_parc" },
    "distanta parc": { value: distantaParc, categoryId: "relaxare", tagId: "distanta_parc" },
    "nume atractie": { value: numeAtractie, categoryId: "atractie", tagId: "nume_atractie" },
    "nume atrctie": { value: numeAtractie, categoryId: "atractie", tagId: "nume_atractie" },
    "distanta si nume atractie": {
      value: distSiNumeAtractie,
      categoryId: "atractie",
      tagId: "distanta_si_nume_atractie",
    },
    "distanta atractie": { value: distantaAtractie, categoryId: "atractie", tagId: "distanta_atractie" },
    mobilare: { value: mobilareStr, categoryId: "mobilare", tagId: "mobilare" },
    moblare: { value: mobilareStr, categoryId: "mobilare", tagId: "mobilare" },
    utilare: { value: utilareStr, categoryId: "utilare", tagId: "utilare" },
    parcare: { value: parcareStr, categoryId: "parcare", tagId: "parcare" },
    pet: { value: petStr, categoryId: "animal_companie", tagId: "situatie_pet" },
    "situatie animal de companie": { value: petStr, categoryId: "animal_companie", tagId: "situatie_pet" },
    "personalizat 1": { value: p1, categoryId: "personalizat_1", tagId: "personalizat_1" },
    "personalizat 2": { value: p2, categoryId: "personalizat_2", tagId: "personalizat_2" },
    "personalizat 3": { value: p3, categoryId: "personalizat_3", tagId: "personalizat_3" },
    id: { value: propId, categoryId: "identificare", tagId: "id" },
  };

  return map;
}

const FILLER_TOKENS = new Set([" ", "|", "/", "\\", ","]);

function tokenizePattern(
  pattern: string,
  tagValues: Record<string, { value: string; categoryId: TitleCategoryId; tagId: string }>
): ParsedSegment[] {
  const segments: ParsedSegment[] = [];
  const regex = /\[([^\]]+)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(pattern)) !== null) {
    if (match.index > lastIndex) {
      const literal = pattern.slice(lastIndex, match.index);
      if (literal) {
        segments.push({
          kind: literal.trim() === "" ? "filler" : "text",
          raw: literal,
          tokenKey: "",
          value: literal,
        });
      }
    }

    const inner = match[1];
    const innerNorm = stripDiacriticsLower(inner);

    if (FILLER_TOKENS.has(inner)) {
      segments.push({
        kind: "filler",
        raw: match[0],
        tokenKey: inner,
        categoryId: "fillers",
        value: inner,
      });
    } else if (tagValues[innerNorm]) {
      const resolved = tagValues[innerNorm];
      segments.push({
        kind: "dynamic",
        raw: match[0],
        tokenKey: innerNorm,
        categoryId: resolved.categoryId,
        tagId: resolved.tagId,
        value: resolved.value,
      });
    } else {
      // Connector token like [De], [la], [si], [din], [cu]
      segments.push({
        kind: "connector",
        raw: match[0],
        tokenKey: innerNorm,
        value: inner,
      });
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < pattern.length) {
    const tail = pattern.slice(lastIndex);
    if (tail) {
      segments.push({
        kind: tail.trim() === "" ? "filler" : "text",
        raw: tail,
        tokenKey: "",
        value: tail,
      });
    }
  }

  return segments;
}

function renderSegments(segments: ParsedSegment[]): string {
  // Active dynamic indexes
  const active = segments.map((seg) => {
    if (seg.kind === "dynamic") return !seg.dropped && seg.value.trim().length > 0;
    return !seg.dropped;
  });

  // Resolve connector tokens ([De], [la], [si], etc.) based on active neighbors
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.kind !== "connector") continue;

    // Look left & right for nearest non-space token before a major separator ("|")
    let hasLeftDynamic = false;
    for (let l = i - 1; l >= 0; l--) {
      if (segments[l].value === "|" || segments[l].value === ",") break;
      if (segments[l].kind === "dynamic") {
        hasLeftDynamic = active[l];
        break;
      }
    }
    let hasRightDynamic = false;
    for (let r = i + 1; r < segments.length; r++) {
      if (segments[r].value === "|" || segments[r].value === ",") break;
      if (segments[r].kind === "dynamic") {
        hasRightDynamic = active[r];
        break;
      }
    }

    const tok = seg.tokenKey;
    if (tok === "de" || tok === "la" || tok === "in" || tok === "cu") {
      // Prefix connector before a dynamic item (e.g. [De] [tip tranzactie], [statie] [la] [distanta statie])
      active[i] = hasRightDynamic;
    } else if (tok === "si" || tok === "sau" || tok === "din") {
      // Binary connector needs both sides active
      active[i] = hasLeftDynamic && hasRightDynamic;
    } else {
      active[i] = hasLeftDynamic || hasRightDynamic;
    }
  }

  // Filter active segments & clean adjacent separators ("|", "/", "\\", ",")
  const kept = segments.filter((_, idx) => active[idx]);

  // Remove separators whose immediate dynamic neighbor is missing on the required side
  const cleaned: ParsedSegment[] = [];
  for (let i = 0; i < kept.length; i++) {
    const seg = kept[i];
    const isMajorSep = seg.value === "|" || seg.value === ",";
    const isTightSep = seg.value === "/" || seg.value === "\\";

    if (isTightSep) {
      // Needs a dynamic segment both before and after within the current block (ignoring space fillers)
      let prevNonSpace: ParsedSegment | undefined;
      for (let k = cleaned.length - 1; k >= 0; k--) {
        if (cleaned[k].value.trim() !== "") {
          prevNonSpace = cleaned[k];
          break;
        }
      }
      let nextNonSpace: ParsedSegment | undefined;
      for (let k = i + 1; k < kept.length; k++) {
        if (kept[k].value.trim() !== "") {
          nextNonSpace = kept[k];
          break;
        }
      }
      if (!prevNonSpace || prevNonSpace.kind !== "dynamic" || !nextNonSpace || nextNonSpace.kind !== "dynamic") {
        continue;
      }
    }

    if (isMajorSep) {
      // Collapse duplicate or leading separators
      let lastMeaningful: ParsedSegment | undefined;
      for (let k = cleaned.length - 1; k >= 0; k--) {
        if (cleaned[k].value.trim() !== "") {
          lastMeaningful = cleaned[k];
          break;
        }
      }
      if (!lastMeaningful || lastMeaningful.value === "|" || lastMeaningful.value === ",") {
        continue;
      }
    }

    cleaned.push(seg);
  }

  // Strip trailing separators and whitespace
  while (cleaned.length > 0) {
    const tail = cleaned[cleaned.length - 1];
    if (tail.value.trim() === "" || tail.value === "|" || tail.value === "," || tail.value === "/" || tail.value === "\\") {
      cleaned.pop();
    } else {
      break;
    }
  }

  let output = cleaned.map((s) => s.value).join("");
  output = output
    .replace(/\s*\|\s*/g, " | ")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s*,\s*/g, ", ")
    .replace(/(?:\s*\|\s*){2,}/g, " | ")
    .replace(/^\s*[|,/\\]+\s*/, "")
    .replace(/\s*[|,/\\]+\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return output;
}

export function buildTitleFromAutomationRule(
  rawRule: TitleAutomationRule | null | undefined,
  input: TitleExtractionInput
): string {
  const rule = normalizeTitleAutomationRule(rawRule);
  const isRent = stripDiacriticsLower(input.transactionType || "").includes("inchir");
  const pattern = (isRent ? rule.rentPattern : rule.salePattern).trim();
  if (!pattern) return "";

  const tagValues = buildResolvedTagValues(rule, input);
  const segments = tokenizePattern(pattern, tagValues);

  let rendered = renderSegments(segments);
  if (!rendered) return "";

  const categoryPriority = new Map<TitleCategoryId, number>();
  const tagWeightMap = new Map<string, number>();

  rule.categories.forEach((cat, catIdx) => {
    categoryPriority.set(cat.id, catIdx);
    cat.tags.forEach((tag, tagIdx) => {
      tagWeightMap.set(`${cat.id}:${tag.id}`, tagIdx);
    });
  });

  // Apply priority-based trimming if output exceeds maxChars
  // Score = categoryPriority * 100 + tagWeight (lower score = higher priority; higher score = dropped first)
  if (rendered.length > rule.maxChars) {
    const activeDynamicIndexes = () =>
      segments
        .map((seg, idx) => ({ seg, idx }))
        .filter(({ seg }) => seg.kind === "dynamic" && !seg.dropped && seg.value.trim().length > 0);

    while (rendered.length > rule.maxChars) {
      const actives = activeDynamicIndexes();
      if (actives.length <= 1) break;

      actives.sort((a, b) => {
        const catA = categoryPriority.get(a.seg.categoryId || "identificare") ?? 99;
        const catB = categoryPriority.get(b.seg.categoryId || "identificare") ?? 99;
        const wA = tagWeightMap.get(`${a.seg.categoryId}:${a.seg.tagId}`) ?? 99;
        const wB = tagWeightMap.get(`${b.seg.categoryId}:${b.seg.tagId}`) ?? 99;
        const scoreA = catA * 100 + wA;
        const scoreB = catB * 100 + wB;
        if (scoreB !== scoreA) return scoreB - scoreA;
        return b.idx - a.idx;
      });

      const candidate = actives[0];
      segments[candidate.idx].dropped = true;
      const nextRendered = renderSegments(segments);
      if (!nextRendered || (nextRendered.length < rule.minChars && rendered.length <= rule.minChars)) {
        segments[candidate.idx].dropped = false;
        break;
      }
      rendered = nextRendered;
    }

    // Hard cap fallback at word/separator boundary if single remaining field still exceeds maxChars
    if (rendered.length > rule.maxChars) {
      rendered = rendered
        .slice(0, rule.maxChars)
        .replace(/\s+\S*$/, "")
        .replace(/[|,/\\\s]+$/, "")
        .trim();
    }
  }

  return sanitizeAdCopy(rendered);
}
