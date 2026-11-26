/**
 * Utility for generating compliant property advertisement titles adhering strictly
 * to the project AGENTS.md rules:
 * 
 * 1. Structura: Tip imobil + număr camere/încăperi sau suprafață mp | Zonă | Pct. de interes | Pct forte imobil | Dotări | Parcare
 * 2. SUB 70 DE CARACTERE.
 * 3. FĂRĂ Numere de Stradă, Blocuri, Scări, Apartamente sau Complexe Rezidențiale (ex. fără Astorium, Hills, Greenfield etc.).
 * 4. FĂRĂ "0% comision", "comision 0", etc.
 */

import { TitleAutomationRule } from "../core/automation/typ_title-automation";
import { buildTitleFromAutomationRule } from "./titleAutomationEngine";

export interface PropertyTitleParams {
  transactionType?: string;
  categoria?: string;
  camere?: string | number;
  suprafataUtila?: string | number;
  suprafataConstruita?: string | number;
  etaj?: string | number;
  etajeTotal?: string | number;
  zona?: string;
  oras?: string;
  compartimentare?: string;
  sistemIncalzire?: string;
  mobilat?: string;
  utilare?: string;
  balcoane?: string | number;
  hasParcare?: boolean;
  parcare?: string | boolean;
  petFriendly?: string | boolean;
  propertyId?: string;
  rawTitle?: string;
  rawText?: string;
  titleRule?: TitleAutomationRule | null;
}

export function generateStandardAdTitle(params: PropertyTitleParams): string {
  if (params.titleRule && params.titleRule.enabled) {
    const automated = buildTitleFromAutomationRule(params.titleRule, {
      transactionType: params.transactionType,
      categoria: params.categoria,
      camere: params.camere,
      suprafataUtila: params.suprafataUtila,
      suprafataConstruita: params.suprafataConstruita,
      etaj: params.etaj,
      etajeTotal: params.etajeTotal,
      zona: params.zona,
      oras: params.oras,
      mobilat: params.mobilat,
      utilare: params.utilare,
      parcare: params.parcare ?? params.hasParcare,
      petFriendly: params.petFriendly,
      propertyId: params.propertyId,
      rawTitle: params.rawTitle,
      rawText: params.rawText,
    });
    if (automated && automated.trim().length > 0) {
      return automated;
    }
  }

  const {
    categoria = "Apartament",
    camere,
    suprafataUtila,
    zona = "București",
    oras = "București",
    compartimentare,
    sistemIncalzire,
    mobilat,
    balcoane,
    hasParcare,
    rawText = ""
  } = params;

  const textLower = rawText.toLowerCase();

  // 1. Tip imobil + număr camere sau suprafață mp
  let typePart = "";
  const catLower = (categoria || "").toLowerCase();
  const numCamere = typeof camere === "number" 
    ? camere 
    : parseInt(String(camere || "").replace(/\D/g, ""), 10);
  const numSuprafata = typeof suprafataUtila === "number" 
    ? suprafataUtila 
    : parseInt(String(suprafataUtila || "").replace(/\D/g, ""), 10);

  if (catLower.includes("garsonier") || catLower.includes("studio")) {
    typePart = "Studio";
  } else if (catLower.includes("cas") || catLower.includes("vil")) {
    typePart = numCamere && numCamere > 1 
      ? `Vilă ${numCamere} camere` 
      : (numSuprafata ? `Vilă ${numSuprafata} mp` : "Casă individuală");
  } else if (catLower.includes("comercial") || catLower.includes("magazin")) {
    typePart = numSuprafata ? `Spațiu comercial ${numSuprafata} mp` : "Spațiu comercial";
  } else if (catLower.includes("birou") || catLower.includes("office")) {
    typePart = numSuprafata ? `Birou ${numSuprafata} mp` : "Spațiu birouri";
  } else if (catLower.includes("industrial") || catLower.includes("hala") || catLower.includes("depozit")) {
    typePart = numSuprafata ? `Spațiu industrial ${numSuprafata} mp` : "Spațiu industrial";
  } else {
    // Apartament standard
    typePart = numCamere && numCamere >= 1 
      ? `Apartament ${numCamere} camere` 
      : (numSuprafata ? `Apartament ${numSuprafata} mp` : "Apartament");
  }

  // 2. Zonă (STRICT: NO street numbers, blocks, complex names, full postal addresses; never fabricate a zone)
  const rawZoneCandidate =
    zona && zona !== "-" && zona !== "Nespecificat" && zona !== "București" && zona !== "Bucuresti"
      ? zona
      : "";
  let cleanZone = rawZoneCandidate.trim();
  cleanZone = cleanZone
    .replace(/(?:str\.?|strada|bd\.?|bulevardul|sos\.?|soseaua|calea|aleea|splaiul?)\s+[^,|•\n]+/gi, "")
    .replace(/(?:nr\.?|numarul)\s*\d+[a-z]?/gi, "")
    .replace(/(?:bl\.?|bloc)\s*\d+[a-z]?/gi, "")
    .replace(/(?:sc\.?|scara)\s*\d+[a-z]?/gi, "")
    .replace(/(?:ap\.?|apartament)\s*\d+/gi, "")
    .replace(/(?:residence|complex|ansamblul?|towers?|park|hills?|astorium|cosmopolis|greenfield|militari\s+residence|plaza\s+residence|rotar\s+park|cloud9|belvedere|one\s+floreasca|one\s+herastrau|upground|marmura|novum|exigent)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/^[,.\s-]+|[,.\s-]+$/g, "");

  if (!cleanZone || cleanZone.length < 2) {
    cleanZone = oras && oras !== "-" && oras !== "Nespecificat" ? oras.trim() : "";
  }

  // 3. Pct de interes (Metrou, Metrou 10min, Lângă parc, Aproape de mall) — strict word boundaries
  let pctInteres = "";
  const metroMinMatch = textLower.match(/\bmetrou\s+(?:la\s+)?(\d{1,2})\s*min/i);
  if (metroMinMatch) {
    pctInteres = `Metrou ${metroMinMatch[1]}min`;
  } else if (/\bmetrou\b/.test(textLower)) {
    pctInteres = "Metrou";
  } else if (/\bparcul\b|\bl[aâ]ng[aă]\s+parc\b|\bvedere\s+la\s+parc\b/.test(textLower)) {
    pctInteres = "Lângă parc";
  } else if (/\bmall\b|\bpromenada\b|\bafi\s+(?:cotroceni|palace|mall)\b|\bparklake\b|\bsun\s+plaza\b/.test(textLower)) {
    pctInteres = "Aproape de mall";
  }

  // 4. Pct forte imobil (Compartimentare, Balcon, Terasă, Renovat, etc.)
  let pctForte = "";
  if (compartimentare && compartimentare !== "-" && !compartimentare.toLowerCase().includes("nespecificat")) {
    pctForte = compartimentare.trim();
  } else if (textLower.includes("semidecomandat")) {
    pctForte = "Semidecomandat";
  } else if (textLower.includes("decomandat")) {
    pctForte = "Decomandat";
  } else if (textLower.includes("open space")) {
    pctForte = "Open space";
  } else if (balcoane && parseInt(String(balcoane), 10) > 0) {
    pctForte = "Balcon";
  } else if (textLower.includes("terasa") || textLower.includes("terasă")) {
    pctForte = "Terasă";
  } else if (textLower.includes("renovat")) {
    pctForte = "Renovat";
  } else if (textLower.includes("prima inchiriere") || textLower.includes("prima închiriere")) {
    pctForte = "Prima închiriere";
  }

  // 5. Dotări (Centrală proprie, Aer condiționat, Mobilat & utilat)
  let dotari = "";
  if (sistemIncalzire?.toLowerCase().includes("proprie") || textLower.includes("centrala proprie") || textLower.includes("centrală proprie")) {
    dotari = "Centrală proprie";
  } else if (textLower.includes("aer conditionat") || textLower.includes("aer condiționat") || textLower.includes("climatizare")) {
    dotari = "Aer condiționat";
  } else if (mobilat?.toLowerCase().includes("complet") || textLower.includes("mobilat si utilat") || textLower.includes("mobilat și utilat")) {
    dotari = "Mobilat & utilat";
  }

  // 6. Parcare
  let parcare = "";
  if (hasParcare || textLower.includes("loc de parcare") || textLower.includes("parcare inclusa") || textLower.includes("parcare inclusă") || textLower.includes("garaj")) {
    parcare = "Parcare";
  }

  // Combine according to required structure:
  // Tip imobil + număr camere/încăperi sau suprafață mp | Zonă | Pct. de interes | Pct forte imobil | Dotări | Parcare
  const rawParts = [typePart, cleanZone, pctInteres, pctForte, dotari, parcare]
    .map(p => p.trim())
    .filter(p => p.length > 0 && !p.toLowerCase().includes("comision"));

  // Keep unique items
  const uniqueParts: string[] = [];
  rawParts.forEach(p => {
    if (!uniqueParts.some(u => u.toLowerCase() === p.toLowerCase())) {
      uniqueParts.push(p);
    }
  });

  // Strict constraint: Title MUST BE UNDER 70 CHARACTERS
  while (uniqueParts.length > 2 && uniqueParts.join(" | ").length > 68) {
    uniqueParts.pop();
  }

  let finalTitle = uniqueParts.join(" | ");
  if (finalTitle.length > 68) {
    finalTitle = finalTitle.substring(0, 68).replace(/\s*\|?\s*$/, "");
  }

  return finalTitle;
}
