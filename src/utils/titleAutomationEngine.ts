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

function isGenericBoilerplateValue(val: string): boolean {
  const norm = stripDiacriticsLower(val);
  if (!norm || norm === "-" || norm === "nespecificat" || norm === "n/a") return true;
  if (norm.includes("statie de metrou in proximitate")) return true;
  if (norm.includes("linii tramvai in zona")) return true;
  if (norm.includes("linii troleibuz in apropiere")) return true;
  if (norm.includes("multiple linii stb in apropiere")) return true;
  if (norm.includes("spatii verzi in apropiere")) return true;
  if (norm.includes("diverse puncte de atrac")) return true;
  if (norm.includes("publica in zona")) return true;
  return false;
}

function cleanUserEnteredValue(val: unknown): string {
  const s = String(val ?? "").trim();
  if (!s || isGenericBoilerplateValue(s)) return "";
  return s;
}

function extractInlineDistanceFromValue(rawVal: string): { text: string; distance: string } {
  const cleaned = cleanUserEnteredValue(rawVal);
  if (!cleaned) return { text: "", distance: "" };
  const distRe = /\b(\d{1,3}\s*(?:min(?:ute)?|m))\b/i;
  const m = cleaned.match(distRe);
  if (!m) return { text: cleaned, distance: "" };
  const distance = m[1].replace(/\bmin\b/i, "minute").replace(/\s+/g, " ").trim();
  const remainder = cleaned
    .replace(distRe, "")
    .replace(/\b(?:la|de|mers|pe\s*jos|distanta|aprox\.?)\b/gi, "")
    .replace(/[,;\-–—()]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return { text: remainder || cleaned, distance };
}

function mapPropertyTypeLabel(categoria: string | undefined, lowerText: string): string {
  const c = stripDiacriticsLower(categoria || "");
  if (c.includes("garsonier") || (!c && /\bgarsonier[aă]?\b/.test(lowerText))) return "Garsoniera";
  if (c.includes("studio") || (!c && /\bstudio\b/.test(lowerText))) return "Studio";
  if (c.includes("cas") || c.includes("vil") || (!c && /\b(?:casa|vila)\b/.test(lowerText))) return "Vila";
  if (c.includes("birou") || c.includes("office") || (!c && /\bspatiu\s*(?:de\s*)?birouri\b/.test(lowerText))) {
    return "Spatiu birouri";
  }
  if (
    c.includes("comercial") ||
    c.includes("magazin") ||
    (!c && /\bspatiu\s*comercial\b/.test(lowerText))
  ) {
    return "Spatiu comercial";
  }
  if (
    c.includes("industrial") ||
    c.includes("hala") ||
    c.includes("depozit") ||
    (!c && /\b(?:spatiu\s*industrial|hala)\b/.test(lowerText))
  ) {
    return "Spatiu industrial";
  }
  if (c.includes("teren") || (!c && /\bteren\b/.test(lowerText))) return "Teren";
  if (c.includes("apartament") || (!c && /\bapartament\b/.test(lowerText))) return "Apartament";
  return "";
}

interface ResolvedTagEntry {
  value: string;
  categoryId: TitleCategoryId;
  tagId: string;
  missingLabel: string;
}

function buildResolvedTagValues(
  rule: TitleAutomationRule,
  input: TitleExtractionInput
): Record<string, ResolvedTagEntry> {
  const rawTitle = String(input.rawTitle || "");
  const rawText = String(input.rawText || "");
  const combined = `${rawTitle}\n${rawText}`.trim();
  const lower = stripDiacriticsLower(combined);

  const txNorm = stripDiacriticsLower(input.transactionType || "");
  let tipTranzactie = "";
  if (txNorm.includes("inchir") || (!txNorm && /\b(?:inchirier|de\s+inchiriat|chirie)\b/.test(lower))) {
    tipTranzactie = "inchiriat";
  } else if (txNorm.includes("vanz") || (!txNorm && /\b(?:vanzare|de\s+vanzare)\b/.test(lower))) {
    tipTranzactie = "vanzare";
  }

  const tipProprietate = mapPropertyTypeLabel(input.categoria, lower);

  let numCamere =
    typeof input.camere === "number"
      ? input.camere
      : parseInt(String(input.camere || "").replace(/\D/g, ""), 10);
  if (!Number.isFinite(numCamere) || numCamere <= 0) {
    const camMatch = combined.match(/\b(\d{1,2})\s*cam(?:ere|er[aă])?\b/i);
    if (camMatch && camMatch[1]) {
      numCamere = parseInt(camMatch[1], 10);
    } else if (tipProprietate === "Garsoniera" || tipProprietate === "Studio") {
      numCamere = 1;
    }
  }
  const camereStr =
    Number.isFinite(numCamere) && numCamere > 0
      ? numCamere === 1
        ? "1 camera"
        : `${numCamere} camere`
      : "";

  let utilaNum = parseFloat(String(input.suprafataUtila || "").replace(",", ".").replace(/[^\d.]/g, ""));
  if (!Number.isFinite(utilaNum) || utilaNum <= 0) {
    const mpMatch = combined.match(/\b(\d{2,4}(?:[.,]\d{1,2})?)\s*(?:mp|m2|m²)(?:\s*util[iă]?)?\b/i);
    if (mpMatch && mpMatch[1]) {
      utilaNum = parseFloat(mpMatch[1].replace(",", "."));
    }
  }
  const suprafataUtilaStr = Number.isFinite(utilaNum) && utilaNum > 0 ? `${Math.round(utilaNum)}mp` : "";

  let constrInputNum = parseFloat(
    String(input.suprafataConstruita || "").replace(",", ".").replace(/[^\d.]/g, "")
  );
  if (!Number.isFinite(constrInputNum) || constrInputNum <= 0) {
    const constrMatch = combined.match(
      /\bsuprafat[aă]\s+construit[aă]\D{0,10}(\d{2,4}(?:[.,]\d{1,2})?)\b/i
    );
    if (constrMatch && constrMatch[1]) {
      constrInputNum = parseFloat(constrMatch[1].replace(",", "."));
    }
  }
  const computedConstr =
    Number.isFinite(constrInputNum) && constrInputNum > 0
      ? Math.round(constrInputNum)
      : Number.isFinite(utilaNum) && utilaNum > 0
      ? Math.round(
          utilaNum *
            (tipProprietate === "Apartament" ||
            tipProprietate === "Vila" ||
            tipProprietate === "Garsoniera" ||
            tipProprietate === "Studio"
              ? 1.2
              : 1.1)
        )
      : 0;
  const suprafataConstruitaStr = computedConstr > 0 ? `${computedConstr}mp` : "";

  let floorInput = input.etaj;
  if (!String(floorInput ?? "").trim()) {
    const etajSlash = combined.match(/\betaj(?:ul)?\s*(\d{1,2}|parter|demisol|mansard[aă])\s*\/\s*(\d{1,2})\b/i);
    const etajSimple = combined.match(/\betaj(?:ul)?\s*(\d{1,2}|parter|demisol|mansard[aă])\b/i);
    if (etajSlash) {
      floorInput = `${etajSlash[1]}/${etajSlash[2]}`;
    } else if (etajSimple) {
      floorInput = etajSimple[1];
    } else if (/\bparter\b/i.test(combined)) {
      floorInput = "Parter";
    } else if (/\bmansard[aă]\b/i.test(combined)) {
      floorInput = "Mansarda";
    } else if (/\bdemisol\b/i.test(combined)) {
      floorInput = "Demisol";
    }
  }
  const { floorLabel, inlineTotal } = cleanFloorLabel(floorInput);
  const etajeTotalStr = extractTotalFloors(input, combined, inlineTotal);

  const inlineStation = extractInlineDistanceFromValue(input.statie || "");
  const cleanTransitInput: TitleExtractionInput = {
    ...input,
    statie: inlineStation.text,
    distantaStatie: cleanUserEnteredValue(input.distantaStatie) || inlineStation.distance,
  };
  const { statie, distantaStatie } = extractTransitInfo(cleanTransitInput, combined);

  const inlinePark = extractInlineDistanceFromValue(input.numeParc || "");
  const cleanParkInput: TitleExtractionInput = {
    ...input,
    numeParc: inlinePark.text,
    distantaParc: cleanUserEnteredValue(input.distantaParc) || inlinePark.distance,
  };
  const { numeParc, distantaParc } = extractParkInfo(cleanParkInput, combined);
  const distSiNumeParc = distantaParc && numeParc ? `${distantaParc} ${numeParc}` : numeParc || distantaParc;

  const inlineAttraction = extractInlineDistanceFromValue(input.numeAtractie || "");
  const cleanAttrInput: TitleExtractionInput = {
    ...input,
    numeAtractie: inlineAttraction.text,
    distantaAtractie: cleanUserEnteredValue(input.distantaAtractie) || inlineAttraction.distance,
  };
  const { numeAtractie, distantaAtractie } = extractAttractionInfo(cleanAttrInput, combined);
  const distSiNumeAtractie =
    distantaAtractie && numeAtractie ? `${distantaAtractie} ${numeAtractie}` : numeAtractie || distantaAtractie;

  const rawZona = String(input.zona || "").trim();
  const zonaStr = hasRealNeighborhoodArea(rawZona) ? sanitizeAdCopy(rawZona) : "";

  const mobNorm = stripDiacriticsLower(input.mobilat || "");
  let mobilareStr = "";
  if (mobNorm.includes("nemobilat") || mobNorm === "fara" || (!mobNorm && /\bnemobilat\b/.test(lower))) {
    mobilareStr = "Nemobilat";
  } else if (
    mobNorm.includes("partial") ||
    mobNorm.includes("semi") ||
    (!mobNorm && /\b(?:semimobilat|partial\s*mobilat)\b/.test(lower))
  ) {
    mobilareStr = "Semimobilat";
  } else if (mobNorm.includes("lux") || (!mobNorm && /\bmobilat\s*lux\b/.test(lower))) {
    mobilareStr = "Mobilat Lux";
  } else if (
    mobNorm.includes("complet") ||
    mobNorm.includes("mobilat") ||
    mobNorm.includes("modern") ||
    (!mobNorm && /\bmobilat\b/.test(lower))
  ) {
    mobilareStr = "Mobilat";
  }

  const utilNorm = stripDiacriticsLower(input.utilare || "");
  let utilareStr = "";
  if (utilNorm.includes("neutilat") || utilNorm === "fara" || (!utilNorm && /\bneutilat\b/.test(lower))) {
    utilareStr = "Neutilat";
  } else if (
    utilNorm.includes("partial") ||
    utilNorm.includes("semi") ||
    (!utilNorm && /\bpartial\s*utilat\b/.test(lower))
  ) {
    utilareStr = "Partial utilat";
  } else if (
    utilNorm.includes("complet") ||
    utilNorm.includes("utilat") ||
    (!utilNorm && /\butilat[aă]?\b/.test(lower))
  ) {
    utilareStr = "Utilat";
  }

  let parcareStr = "";
  if (typeof input.parcare === "string" && cleanUserEnteredValue(input.parcare)) {
    const pNorm = stripDiacriticsLower(input.parcare);
    if (!pNorm.includes("fara") && pNorm !== "0" && pNorm !== "nu") {
      parcareStr = sanitizeAdCopy(input.parcare);
    }
  } else if (
    input.parcare === true ||
    /\b(?:loc\s*de\s*parcare|parcare\s*(?:inclusa|subterana|supraterana|proprie|rezervata|acoperita)?|garaj)\b/i.test(
      lower
    )
  ) {
    parcareStr = /\bgaraj\b/i.test(lower) ? "Garaj" : "Parcare";
  }

  let petStr = "";
  if (typeof input.petFriendly === "string" && cleanUserEnteredValue(input.petFriendly)) {
    petStr = sanitizeAdCopy(input.petFriendly);
  } else if (
    input.petFriendly === true ||
    /\b(?:pet\s*friendly|accept[aă]?\s*animale|cu\s*animale|animale\s*de\s*companie\s*acceptate)\b/i.test(
      lower
    )
  ) {
    petStr = "Pet Friendly";
  } else if (
    /\b(?:fara\s*animale|nu\s*accept[aă]?\s*animale|nu\s*se\s*accepta\s*animale)\b/i.test(lower)
  ) {
    petStr = "Fara animale";
  }

  const p1 = sanitizeAdCopy(rule.customValues?.personalizat1 || "");
  const p2 = sanitizeAdCopy(rule.customValues?.personalizat2 || "");
  const p3 = sanitizeAdCopy(rule.customValues?.personalizat3 || "");
  const propId = String(input.propertyId || "").trim();

  const map: Record<string, ResolvedTagEntry> = {
    "tip tranzactie": {
      value: tipTranzactie,
      categoryId: "tranzactie",
      tagId: "tip_tranzactie",
      missingLabel: "tip tranzactie",
    },
    "tip proprietate": {
      value: tipProprietate,
      categoryId: "general",
      tagId: "tip",
      missingLabel: "tip",
    },
    tip: { value: tipProprietate, categoryId: "general", tagId: "tip", missingLabel: "tip" },
    camere: { value: camereStr, categoryId: "general", tagId: "camere", missingLabel: "camere" },
    "suprafata utila": {
      value: suprafataUtilaStr,
      categoryId: "general",
      tagId: "utila",
      missingLabel: "utila",
    },
    utila: { value: suprafataUtilaStr, categoryId: "general", tagId: "utila", missingLabel: "utila" },
    "suprafata construita": {
      value: suprafataConstruitaStr,
      categoryId: "general",
      tagId: "construita",
      missingLabel: "construita",
    },
    construita: {
      value: suprafataConstruitaStr,
      categoryId: "general",
      tagId: "construita",
      missingLabel: "construita",
    },
    etaj: { value: floorLabel, categoryId: "general", tagId: "etaj", missingLabel: "etaj" },
    "etaje in total": {
      value: etajeTotalStr,
      categoryId: "general",
      tagId: "etaje_total",
      missingLabel: "etaje in total",
    },
    zona: { value: zonaStr, categoryId: "general", tagId: "zona", missingLabel: "zona" },
    cartier: { value: zonaStr, categoryId: "general", tagId: "zona", missingLabel: "zona" },
    statie: { value: statie, categoryId: "transport", tagId: "statie", missingLabel: "statie" },
    "distanta statie": {
      value: distantaStatie,
      categoryId: "transport",
      tagId: "distanta_statie",
      missingLabel: "distanta statie",
    },
    "nume parc": {
      value: numeParc,
      categoryId: "relaxare",
      tagId: "nume_parc",
      missingLabel: "nume parc",
    },
    "distanta si nume parc": {
      value: distSiNumeParc,
      categoryId: "relaxare",
      tagId: "distanta_si_nume_parc",
      missingLabel: "nume parc",
    },
    "distanta parc": {
      value: distantaParc,
      categoryId: "relaxare",
      tagId: "distanta_parc",
      missingLabel: "distanta parc",
    },
    "nume atractie": {
      value: numeAtractie,
      categoryId: "atractie",
      tagId: "nume_atractie",
      missingLabel: "nume atractie",
    },
    "nume atrctie": {
      value: numeAtractie,
      categoryId: "atractie",
      tagId: "nume_atractie",
      missingLabel: "nume atractie",
    },
    "distanta si nume atractie": {
      value: distSiNumeAtractie,
      categoryId: "atractie",
      tagId: "distanta_si_nume_atractie",
      missingLabel: "nume atractie",
    },
    "distanta atractie": {
      value: distantaAtractie,
      categoryId: "atractie",
      tagId: "distanta_atractie",
      missingLabel: "distanta atractie",
    },
    mobilare: {
      value: mobilareStr,
      categoryId: "mobilare",
      tagId: "mobilare",
      missingLabel: "mobilare",
    },
    moblare: {
      value: mobilareStr,
      categoryId: "mobilare",
      tagId: "mobilare",
      missingLabel: "mobilare",
    },
    utilare: { value: utilareStr, categoryId: "utilare", tagId: "utilare", missingLabel: "utilare" },
    parcare: { value: parcareStr, categoryId: "parcare", tagId: "parcare", missingLabel: "parcare" },
    pet: {
      value: petStr,
      categoryId: "animal_companie",
      tagId: "situatie_pet",
      missingLabel: "animal companie",
    },
    "animal companie": {
      value: petStr,
      categoryId: "animal_companie",
      tagId: "situatie_pet",
      missingLabel: "animal companie",
    },
    "situatie animal de companie": {
      value: petStr,
      categoryId: "animal_companie",
      tagId: "situatie_pet",
      missingLabel: "animal companie",
    },
    "personalizat 1": {
      value: p1,
      categoryId: "personalizat_1",
      tagId: "personalizat_1",
      missingLabel: "personalizat 1",
    },
    "personalizat 2": {
      value: p2,
      categoryId: "personalizat_2",
      tagId: "personalizat_2",
      missingLabel: "personalizat 2",
    },
    "personalizat 3": {
      value: p3,
      categoryId: "personalizat_3",
      tagId: "personalizat_3",
      missingLabel: "personalizat 3",
    },
    id: { value: propId, categoryId: "identificare", tagId: "id", missingLabel: "id" },
  };

  return map;
}

const FILLER_TOKENS = new Set([" ", "|", "/", "\\", ","]);

function tokenizePattern(
  pattern: string,
  tagValues: Record<string, ResolvedTagEntry>
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
      const realValue = resolved.value.trim();
      segments.push({
        kind: "dynamic",
        raw: match[0],
        tokenKey: innerNorm,
        categoryId: resolved.categoryId,
        tagId: resolved.tagId,
        // If real data is missing, render explicit `<nume tag>` placeholder
        value: realValue.length > 0 ? realValue : `<${resolved.missingLabel}>`,
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
  const active = segments.map((seg) => {
    if (seg.kind === "dynamic") return !seg.dropped && seg.value.trim().length > 0;
    return !seg.dropped;
  });

  // Resolve connector tokens ([De], [la], [si], etc.) based on active neighbors
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.kind !== "connector") continue;

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
      active[i] = hasRightDynamic;
    } else if (tok === "si" || tok === "sau" || tok === "din") {
      active[i] = hasLeftDynamic && hasRightDynamic;
    } else {
      active[i] = hasLeftDynamic || hasRightDynamic;
    }
  }

  const kept = segments.filter((_, idx) => active[idx]);

  const cleaned: ParsedSegment[] = [];
  for (let i = 0; i < kept.length; i++) {
    const seg = kept[i];
    const isMajorSep = seg.value === "|" || seg.value === ",";
    const isTightSep = seg.value === "/" || seg.value === "\\";

    if (isTightSep) {
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

  while (cleaned.length > 0) {
    const tail = cleaned[cleaned.length - 1];
    if (
      tail.value.trim() === "" ||
      tail.value === "|" ||
      tail.value === "," ||
      tail.value === "/" ||
      tail.value === "\\"
    ) {
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

export function hasMissingTitleTagPlaceholder(title: string | undefined | null): boolean {
  if (!title) return false;
  return /<[a-z0-9ăâîșț\s]+>/i.test(title);
}

export function extractTitleInputFromLead(
  lead: any,
  overrides?: Partial<TitleExtractionInput>
): TitleExtractionInput {
  const extracted = (lead?.extractedData || {}) as any;
  const crmData = extracted?.crmData || {};
  const specs = crmData?.caracteristici || {};
  const utilitati = crmData?.utilitati || {};
  const dotari = crmData?.dotari || utilitati?.dotari || {};
  const pres = extracted?.presentationSections || {};
  const savedSource = extracted?.automationSource || {};

  const transactionType =
    overrides?.transactionType ??
    lead?.transactionType ??
    crmData?.detaliiGenerale?.tranzactie ??
    savedSource?.transactionType ??
    "";

  const categoria =
    overrides?.categoria ??
    lead?.categoria ??
    lead?.buildingType ??
    crmData?.detaliiGenerale?.categoria ??
    savedSource?.categoria ??
    "";

  const camere =
    overrides?.camere ??
    lead?.rooms ??
    specs?.detalii?.camere ??
    (Array.isArray(lead?.selectedRooms) ? lead.selectedRooms[0] : "") ??
    savedSource?.camere ??
    "";

  const suprafataUtila =
    overrides?.suprafataUtila ??
    specs?.suprafete?.utila ??
    (lead?.usefulArea ? String(lead.usefulArea) : "") ??
    savedSource?.suprafataUtila ??
    "";

  const suprafataConstruita =
    overrides?.suprafataConstruita ??
    specs?.suprafete?.construita ??
    savedSource?.suprafataConstruita ??
    "";

  const etaj =
    overrides?.etaj ??
    lead?.floor ??
    specs?.detalii?.etaj ??
    (Array.isArray(lead?.selectedFloors) ? lead.selectedFloors[0] : "") ??
    savedSource?.etaj ??
    "";

  const etajeTotal =
    overrides?.etajeTotal ??
    lead?.totalFloors ??
    specs?.detalii?.totalEtaje ??
    specs?.alteDetalii?.niveluriConstructie ??
    savedSource?.etajeTotal ??
    "";

  const rawZoneVal = crmData?.detaliiGenerale?.localizare?.zona ?? lead?.zone ?? savedSource?.zona ?? "";
  const zona =
    overrides?.zona ??
    (Array.isArray(rawZoneVal) ? String(rawZoneVal[0] || "") : String(rawZoneVal || ""));

  const oras =
    overrides?.oras ??
    crmData?.detaliiGenerale?.localizare?.oras ??
    savedSource?.oras ??
    "București";

  const presMetrou = cleanUserEnteredValue(pres?.transport?.["Metrou"]);
  const statie = overrides?.statie ?? (presMetrou || cleanUserEnteredValue(savedSource?.statie));
  const distantaStatie =
    overrides?.distantaStatie ?? cleanUserEnteredValue(savedSource?.distantaStatie);

  const presRelaxare = cleanUserEnteredValue(pres?.imprejurimi?.["Relaxare"]);
  const numeParc = overrides?.numeParc ?? (presRelaxare || cleanUserEnteredValue(savedSource?.numeParc));
  const distantaParc =
    overrides?.distantaParc ?? cleanUserEnteredValue(savedSource?.distantaParc);

  const presObiective = cleanUserEnteredValue(pres?.imprejurimi?.["Obiective"]);
  const numeAtractie =
    overrides?.numeAtractie ?? (presObiective || cleanUserEnteredValue(savedSource?.numeAtractie));
  const distantaAtractie =
    overrides?.distantaAtractie ?? cleanUserEnteredValue(savedSource?.distantaAtractie);

  const mobilatRaw =
    lead?.mobilare ||
    (Array.isArray(dotari?.mobilat) ? dotari.mobilat[0] : dotari?.mobilat) ||
    savedSource?.mobilat ||
    "";
  const mobilat = overrides?.mobilat ?? String(mobilatRaw || "");

  const utilare =
    overrides?.utilare ??
    lead?.utilare ??
    dotari?.utilare ??
    savedSource?.utilare ??
    "";

  const presParcare = cleanUserEnteredValue(pres?.parcare?.["Parcare"]);
  const parcare =
    overrides?.parcare ??
    (cleanUserEnteredValue(lead?.tipParcare) ||
      cleanUserEnteredValue(lead?.parcare) ||
      cleanUserEnteredValue(dotari?.tipParcare) ||
      cleanUserEnteredValue(dotari?.parcare) ||
      presParcare ||
      cleanUserEnteredValue(savedSource?.parcare) ||
      "");

  const petRaw =
    lead?.animal ||
    (Array.isArray(lead?.animaleList) && lead.animaleList.length > 0
      ? lead.animaleList.join(", ")
      : "") ||
    (Array.isArray(lead?.criteriiFormular?.animal) && lead.criteriiFormular.animal.length > 0
      ? lead.criteriiFormular.animal.join(", ")
      : "") ||
    savedSource?.petFriendly ||
    "";
  const petFriendly = overrides?.petFriendly ?? String(petRaw || "");

  const propertyId = overrides?.propertyId ?? lead?.propertyId ?? savedSource?.propertyId ?? "";

  const rawTitle =
    overrides?.rawTitle ??
    extracted?.crawledOriginalTitle ??
    extracted?.olxMeta?.originalTitle ??
    savedSource?.rawTitle ??
    "";

  const rawText =
    overrides?.rawText ??
    extracted?.crawledOriginalDescription ??
    extracted?.originalDescription ??
    savedSource?.rawText ??
    lead?.notes ??
    "";

  return {
    transactionType,
    categoria,
    camere,
    suprafataUtila,
    suprafataConstruita,
    etaj,
    etajeTotal,
    zona,
    oras,
    statie,
    distantaStatie,
    numeParc,
    distantaParc,
    numeAtractie,
    distantaAtractie,
    mobilat,
    utilare,
    parcare,
    petFriendly,
    propertyId,
    rawTitle,
    rawText,
  };
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

  // Every inserted tag in the pattern is rendered (real data or `<nume tag>` when missing).
  const rendered = renderSegments(segments);
  if (!rendered) return "";

  return sanitizeAdCopy(rendered);
}
