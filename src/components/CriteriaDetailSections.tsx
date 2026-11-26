import React, { useEffect, useMemo, useState } from "react";
import {
  User,
  Home,
  Layers,
  Sparkles,
  Pencil,
  Check,
  X,
  Loader2,
  Copy,
  MessageCircle,
  Phone,
  Euro,
  FileText,
  BadgePercent,
  UserCheck,
} from "lucide-react";
import toast from "react-hot-toast";
import {
  BuildingCategoryType,
  BUILDING_CATEGORY_OPTIONS,
  CETATENIE_OPTIONS,
  ANIMALE_OPTIONS,
  PROFIL_CHIRIAS_OPTIONS,
  COPII_OPTIONS,
  TEREN_CATEGORIE_OPTIONS,
  TEREN_CLASIFICARE_OPTIONS,
  COMERCIAL_CATEGORIE_OPTIONS,
  MODALITATE_ACHIZITIE_OPTIONS,
  CONTRACT_DURATA_OPTIONS,
  AVANS_GARANTIE_OPTIONS,
  NUMAR_CAMERE_OPTIONS,
  NUMAR_BAI_OPTIONS,
  MOBILARE_UTILARE_OPTIONS,
  TIP_PARCARE_OPTIONS,
  NUMAR_LOCURI_PARCARE_OPTIONS,
  STARE_INTERIOR_OPTIONS,
  SISTEM_INCALZIRE_OPTIONS,
  METODA_INCALZIRE_OPTIONS,
  LIFT_OPTIONS,
  GRADINA_OPTIONS,
  BALCOANE_TERASE_LOGII_OPTIONS,
  UTILITATI_STANDARD_OPTIONS,
  UTILITATI_TEREN_OPTIONS,
  SERVICII_IMOBIL_OPTIONS,
  ETAJE_PESTE_PARTER_OPTIONS,
  PropertyCriteriaFormState,
  createInitialPropertyCriteriaState,
  MultiSelectDropdown,
  TagMultiSelect,
} from "./PropertyCriteriaAccordionForm";
import { ZONA_OPTIONS, COMPARTIMENTARE_OPTIONS, ETAJ_OPTIONS } from "../constants";
import { Lead, leadsService } from "../services/leadsService";
import { publishPublicShareSnapshot } from "../services/publicShareService";
import { useTenantContext } from "../core/tenancy/ctx_tenant";
import { InlineDetailField } from "./InlineDetailField";

export type CriteriaSectionKey =
  | "persoana"
  | "clientDorit"
  | "pretConditii"
  | "generale"
  | "imobil"
  | "avansate"
  | "alte";

const formatWhatsAppLink = (phone: string) => {
  const cleanPhone = phone.replace(/\D/g, "");
  const finalPhone = cleanPhone.startsWith("0") ? `40${cleanPhone.substring(1)}` : cleanPhone;
  return `https://wa.me/${finalPhone}`;
};

const normalizeBuildingType = (raw?: string | null): BuildingCategoryType => {
  const val = String(raw || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (val.includes("casa") || val.includes("vila")) return "Casa/Vila";
  if (val.includes("teren") && !val.includes("invest")) return "Teren";
  if (
    val.includes("comercial") ||
    val.includes("birou") ||
    val.includes("industrial") ||
    val.includes("hotel") ||
    val.includes("pensiune") ||
    val.includes("special") ||
    val.includes("spatiu")
  ) {
    return "Spatiu Comercial";
  }
  return "Apartament";
};

const deriveComercialSubcategory = (raw?: string | null): string => {
  const val = String(raw || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (val.includes("birou")) return "Birouri";
  if (val.includes("industrial")) return "Industrial";
  if (val.includes("hotel") || val.includes("pensiune")) return "Hotel/Pensiune";
  if (val.includes("special")) return "Proprietăți speciale";
  if (val.includes("teren")) return "Teren investiții";
  return "Comercial";
};

const mapComercialSubcategoryToCanonical = (sub: string): string => {
  if (sub === "Birouri") return "Spatiu Birou";
  if (sub === "Industrial") return "Spatiu Industrial";
  if (sub === "Hotel/Pensiune") return "Hotel/Pensiune";
  if (sub === "Proprietăți speciale") return "Proprietati Speciale";
  if (sub === "Teren investiții") return "Teren";
  return "Spatiu Comercial";
};

const parseRangePair = (raw?: unknown): [string, string] => {
  if (raw === null || raw === undefined) return ["", ""];
  const s = String(raw)
    .replace(/\b(?:mp|m2|€|eur|euro|lei|ron)\b/gi, "")
    .replace(/€/g, "")
    .trim();
  if (!s || s === "-" || s.toUpperCase() === "N/A") return ["", ""];

  const minOnly = s.match(/^min\.?\s*([\d.,]+)/i);
  if (minOnly) return [minOnly[1].trim(), ""];

  const maxOnly = s.match(/^max\.?\s*([\d.,]+)/i);
  if (maxOnly) return ["", maxOnly[1].trim()];

  const rangeMatch = s.match(/^([\d.,]+)\s*[-–]\s*([\d.,]+)/);
  if (rangeMatch) return [rangeMatch[1].trim(), rangeMatch[2].trim()];

  const singleMatch = s.match(/([\d.,]+)/);
  if (singleMatch) return [singleMatch[1].trim(), ""];

  return ["", ""];
};

const parseRoomsToOptions = (raw?: unknown): string[] => {
  if (!raw) return [];
  const s = String(raw).trim();
  if (!s || s === "-") return [];
  const parts = s
    .split(/[,;/]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    const exact = NUMAR_CAMERE_OPTIONS.find(
      (opt) => opt.toLowerCase() === part.toLowerCase()
    );
    if (exact) {
      if (!out.includes(exact)) out.push(exact);
      continue;
    }
    const lower = part.toLowerCase();
    if (lower.includes("garsonier") || lower.includes("studio") || /^1\b/.test(lower)) {
      if (!out.includes("1 cameră / Garsonieră")) out.push("1 cameră / Garsonieră");
    } else if (/^2\b/.test(lower)) {
      if (!out.includes("2 camere")) out.push("2 camere");
    } else if (/^3\b/.test(lower)) {
      if (!out.includes("3 camere")) out.push("3 camere");
    } else if (/^4\b/.test(lower)) {
      if (!out.includes("4 camere")) out.push("4 camere");
    } else {
      const m = lower.match(/(\d+)/);
      if (m) {
        const n = parseInt(m[1], 10);
        const mapped =
          n <= 1
            ? "1 cameră / Garsonieră"
            : n === 2
              ? "2 camere"
              : n === 3
                ? "3 camere"
                : n === 4
                  ? "4 camere"
                  : "5+ camere";
        if (!out.includes(mapped)) out.push(mapped);
      }
    }
  }
  return out;
};

const parseBathsToOptions = (raw?: unknown): string[] => {
  if (!raw) return [];
  const s = String(raw).trim();
  if (!s || s === "-") return [];
  const parts = s
    .split(/[,;/]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    const exact = NUMAR_BAI_OPTIONS.find(
      (opt) => opt.toLowerCase() === part.toLowerCase()
    );
    if (exact) {
      if (!out.includes(exact)) out.push(exact);
      continue;
    }
    const m = part.match(/(\d+)/);
    if (m) {
      const n = parseInt(m[1], 10);
      const mapped =
        n <= 1 ? "1 baie" : n === 2 ? "2 băi" : n === 3 ? "3 băi" : "4+ băi";
      if (!out.includes(mapped)) out.push(mapped);
    }
  }
  return out;
};

const parseFloorsToOptions = (raw?: unknown): string[] => {
  if (!raw) return [];
  const s = String(raw).trim();
  if (!s || s === "-") return [];
  const parts = s
    .split(/[,;]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    const exact = ETAJ_OPTIONS.find((opt) => opt.toLowerCase() === part.toLowerCase());
    if (exact) {
      if (!out.includes(exact)) out.push(exact);
      continue;
    }
    const lower = part.toLowerCase();
    if (lower.includes("parter")) {
      if (!out.includes("Parter")) out.push("Parter");
    } else if (lower.includes("demisol")) {
      if (!out.includes("Demisol")) out.push("Demisol");
    } else if (lower.includes("mansard")) {
      if (!out.includes("Mansarda")) out.push("Mansarda");
    } else {
      const m = part.match(/(\d+)/);
      if (m) {
        const candidate = `Etaj ${m[1]}`;
        const matched = ETAJ_OPTIONS.find((opt) => opt.toLowerCase() === candidate.toLowerCase());
        if (matched && !out.includes(matched)) out.push(matched);
      }
    }
  }
  return out;
};

const matchOptionInsensitive = (
  raw: unknown,
  allowed: readonly string[]
): string => {
  if (!raw) return "";
  const val = String(raw).trim();
  if (!val) return "";
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  const target = norm(val);
  const exact = allowed.find((opt) => norm(opt) === target);
  if (exact) return exact;
  const partial = allowed.find((opt) => target.includes(norm(opt)) || norm(opt).includes(target));
  return partial || "";
};

const normalizeUtilitatiList = (raw: unknown, isTeren: boolean): string[] => {
  const allowed = isTeren ? UTILITATI_TEREN_OPTIONS : UTILITATI_STANDARD_OPTIONS;
  const arr = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(/[,;]+/)
      : [];
  const out: string[] = [];
  for (const item of arr) {
    const s = String(item || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
    if (!s) continue;
    if (s.includes("apa") && allowed.includes("Apă") && !out.includes("Apă")) out.push("Apă");
    else if (s.includes("canal") && allowed.includes("Canalizare") && !out.includes("Canalizare"))
      out.push("Canalizare");
    else if (s.includes("gaz") && allowed.includes("Gaze") && !out.includes("Gaze"))
      out.push("Gaze");
    else if (
      (s.includes("curent") || s.includes("electr")) &&
      allowed.includes("Electricitate") &&
      !out.includes("Electricitate")
    ) {
      out.push("Electricitate");
    }
  }
  return out;
};

const formatRange = (minVal: string, maxVal: string, suffix = ""): string => {
  const a = minVal.trim();
  const b = maxVal.trim();
  if (a && b) return `${a} - ${b}${suffix}`;
  if (a) return `min. ${a}${suffix}`;
  if (b) return `max. ${b}${suffix}`;
  return "";
};

const formatSingleOrRange = (
  minVal: string,
  maxVal: string,
  isSingle: boolean,
  suffix = ""
): string => {
  if (isSingle) {
    const val = minVal.trim() || maxVal.trim();
    return val ? `${val}${suffix}` : "";
  }
  return formatRange(minVal, maxVal, suffix);
};

export function getCriteriaSectionTitles(params: {
  mode: "lead" | "cerere" | "property";
  role: "Chirias" | "Cumparator";
  buildingType: BuildingCategoryType;
}): {
  persoanaTitle: string;
  clientDoritTitle: string;
  pretConditiiTitle: string;
  generaleTitle: string;
  imobilTitle: string;
  avansateTitle: string;
  alteTitle: string;
} {
  const { mode, role, buildingType } = params;
  const persoanaTitle =
    mode === "property"
      ? "Informații Proprietar"
      : role === "Chirias"
        ? "Informații Chiriaș"
        : "Informații Cumpărător";

  const clientDoritTitle =
    role === "Chirias" ? "Informații Chiriaș" : "Informații Cumpărător";

  const imobilTitle =
    buildingType === "Apartament"
      ? "Informații Apartament"
      : buildingType === "Casa/Vila"
        ? "Informații Casă / Vilă"
        : buildingType === "Teren"
          ? "Informații Teren"
          : "Informații Spațiu Comercial";

  return {
    persoanaTitle,
    clientDoritTitle,
    pretConditiiTitle: "Preț & Condiții",
    generaleTitle: "Informații Generale",
    imobilTitle,
    avansateTitle: "Informații Avansate",
    alteTitle: "Alte Informații",
  };
}

export function derivePropertyCriteriaStateFromLead(lead: Lead): PropertyCriteriaFormState {
  const base = createInitialPropertyCriteriaState();
  const cf = lead.criteriiFormular;
  const crm = lead.extractedData?.crmData;
  const detalii = crm?.caracteristici?.detalii as any;
  const suprafete = crm?.caracteristici?.suprafete as any;
  const alteDetalii = crm?.caracteristici?.alteDetalii as any;
  const utilitatiCrm = crm?.utilitati as any;
  const dotariCrm = (crm as any)?.dotari || (crm?.utilitati as any)?.dotari || {};
  const pretDetalii = crm?.pret?.detalii as any;
  const savedPresentation = ((lead.extractedData as any)?.presentationSections || {}) as Record<
    string,
    Record<string, string>
  >;
  const isRentLead =
    lead.transactionType === "Închiriere" ||
    crm?.detaliiGenerale?.tranzactie === "Închiriere";

  const buildingType: BuildingCategoryType = normalizeBuildingType(
    cf?.buildingType ||
      lead.buildingType ||
      crm?.detaliiGenerale?.categoria ||
      lead.categoria
  );
  const isTeren = buildingType === "Teren";

  // Budget / Price
  let minBudget = String(cf?.minBudget ?? lead.minBudget ?? "").trim();
  let maxBudget = String(cf?.maxBudget ?? lead.maxBudget ?? "").trim();
  if (!minBudget && !maxBudget && lead.price) {
    const [pMin, pMax] = parseRangePair(lead.price);
    if (pMin && pMax) {
      minBudget = pMin;
      maxBudget = pMax;
    } else if (pMin) {
      maxBudget = pMin;
    } else if (pMax) {
      maxBudget = pMax;
    }
  }

  // Zones
  const crmZona: unknown = crm?.detaliiGenerale?.localizare?.zona;
  const rawZoneList: string[] =
    Array.isArray(cf?.zoneList) && cf.zoneList.length > 0
      ? cf.zoneList
      : Array.isArray(lead.zoneList) && lead.zoneList.length > 0
        ? lead.zoneList
        : Array.isArray(crmZona)
          ? crmZona.map((z) => String(z).trim()).filter(Boolean)
          : typeof crmZona === "string" && crmZona.trim()
            ? crmZona.split(",").map((z) => z.trim()).filter(Boolean)
            : lead.zone
              ? lead.zone.split(",").map((z) => z.trim()).filter(Boolean)
              : [];

  // Rooms / Baths / Floors
  const selectedRooms =
    Array.isArray(cf?.selectedRooms) && cf.selectedRooms.length > 0
      ? cf.selectedRooms
      : Array.isArray(lead.selectedRooms) && lead.selectedRooms.length > 0
        ? lead.selectedRooms
        : parseRoomsToOptions(lead.rooms || detalii?.camere);

  const selectedBaths =
    Array.isArray(cf?.selectedBaths) && cf.selectedBaths.length > 0
      ? cf.selectedBaths
      : Array.isArray(lead.selectedBaths) && lead.selectedBaths.length > 0
        ? lead.selectedBaths
        : parseBathsToOptions(lead.baths || detalii?.bai);

  const selectedFloors =
    Array.isArray(cf?.selectedFloors) && cf.selectedFloors.length > 0
      ? cf.selectedFloors
      : Array.isArray(lead.selectedFloors) && lead.selectedFloors.length > 0
        ? lead.selectedFloors
        : parseFloorsToOptions(lead.floor || detalii?.etaj);

  const totalFloors = String(
    cf?.totalFloors ??
      lead.totalFloors ??
      detalii?.totalEtaje ??
      alteDetalii?.niveluriConstructie ??
      ""
  ).trim();

  // Mobilare & Utilare
  const rawMobilare =
    cf?.mobilare ||
    lead.mobilare ||
    (Array.isArray(dotariCrm?.mobilat) ? dotariCrm.mobilat[0] : dotariCrm?.mobilat) ||
    "";
  let mobilare = matchOptionInsensitive(rawMobilare, MOBILARE_UTILARE_OPTIONS);
  if (!mobilare && rawMobilare) {
    const low = String(rawMobilare).toLowerCase();
    if (low.includes("complet") || low.includes("lux") || low.includes("modern")) mobilare = "Completă";
    else if (low.includes("partial") || low.includes("parțial")) mobilare = "Parțială";
    else if (low.includes("nemobilat") || low.includes("fara") || low.includes("fără")) mobilare = "Fără";
  }

  const rawUtilare = cf?.utilare || lead.utilare || dotariCrm?.utilare || "";
  const utilare = matchOptionInsensitive(rawUtilare, MOBILARE_UTILARE_OPTIONS);

  // Parcare
  const tipParcare = matchOptionInsensitive(
    cf?.tipParcare || lead.tipParcare || dotariCrm?.tipParcare,
    TIP_PARCARE_OPTIONS
  );
  let numarLocuriParcare = matchOptionInsensitive(
    cf?.numarLocuriParcare || lead.numarLocuriParcare || dotariCrm?.numarLocuriParcare,
    NUMAR_LOCURI_PARCARE_OPTIONS
  );
  if (!numarLocuriParcare) {
    const rawParc = lead.parcare || detalii?.parcari;
    if (rawParc !== undefined && rawParc !== null && String(rawParc).trim() !== "") {
      const m = String(rawParc).match(/(\d+)/);
      if (m) {
        const n = parseInt(m[1], 10);
        numarLocuriParcare =
          n === 0 ? "Fără" : n === 1 ? "1 loc" : `${Math.min(5, n)} locuri`;
      } else {
        numarLocuriParcare = matchOptionInsensitive(rawParc, NUMAR_LOCURI_PARCARE_OPTIONS);
      }
    }
  }

  // Ranges (Informații Avansate)
  const [fallbackAnMin, fallbackAnMax] = parseRangePair(
    lead.constructionYear || detalii?.anConstructie || alteDetalii?.anConstructie
  );
  const anConstructieMin = String(
    cf?.anConstructieMin ?? lead.anConstructieMin ?? fallbackAnMin ?? ""
  ).trim();
  const anConstructieMax = String(
    cf?.anConstructieMax ?? lead.anConstructieMax ?? fallbackAnMax ?? ""
  ).trim();

  const [fallbackUtilaMin, fallbackUtilaMax] = parseRangePair(
    suprafete?.utila ?? (lead.usefulArea ? String(lead.usefulArea) : "")
  );
  const suprafataUtilaMin = String(
    cf?.suprafataUtilaMin ?? lead.suprafataUtilaMin ?? fallbackUtilaMin ?? ""
  ).trim();
  const suprafataUtilaMax = String(
    cf?.suprafataUtilaMax ?? lead.suprafataUtilaMax ?? fallbackUtilaMax ?? ""
  ).trim();

  const [fallbackConstrMin, fallbackConstrMax] = parseRangePair(suprafete?.construita);
  const suprafataConstruitaMin = String(
    cf?.suprafataConstruitaMin ?? lead.suprafataConstruitaMin ?? fallbackConstrMin ?? ""
  ).trim();
  const suprafataConstruitaMax = String(
    cf?.suprafataConstruitaMax ?? lead.suprafataConstruitaMax ?? fallbackConstrMax ?? ""
  ).trim();

  const [fallbackCurteMin, fallbackCurteMax] = parseRangePair(suprafete?.curte);
  const suprafataCurteMin = String(
    cf?.suprafataCurteMin ?? lead.suprafataCurteMin ?? fallbackCurteMin ?? ""
  ).trim();
  const suprafataCurteMax = String(
    cf?.suprafataCurteMax ?? lead.suprafataCurteMax ?? fallbackCurteMax ?? ""
  ).trim();

  const [fallbackTerenMin, fallbackTerenMax] = parseRangePair(
    suprafete?.teren ?? (isTeren && lead.usefulArea ? String(lead.usefulArea) : "")
  );
  const suprafataTerenMin = String(
    cf?.suprafataTerenMin ?? lead.suprafataTerenMin ?? fallbackTerenMin ?? ""
  ).trim();
  const suprafataTerenMax = String(
    cf?.suprafataTerenMax ?? lead.suprafataTerenMax ?? fallbackTerenMax ?? ""
  ).trim();

  const frontStradal = String(
    cf?.frontStradal ?? lead.frontStradal ?? suprafete?.frontStradal ?? ""
  ).trim();

  // Alte Informații
  const stareInterior = matchOptionInsensitive(
    cf?.stareInterior || lead.stareInterior || alteDetalii?.stareInterior,
    STARE_INTERIOR_OPTIONS
  );

  const rawSistemIncalzire =
    cf?.sistemIncalzire ||
    lead.sursaIncalzire ||
    (Array.isArray(utilitatiCrm?.sistemIncalzire)
      ? utilitatiCrm.sistemIncalzire.join(" ")
      : utilitatiCrm?.sistemIncalzire) ||
    "";
  const sistemIncalzire = matchOptionInsensitive(rawSistemIncalzire, SISTEM_INCALZIRE_OPTIONS);

  const rawMetodaIncalzire =
    cf?.metodaIncalzire ||
    lead.modIncalzire ||
    utilitatiCrm?.metodaIncalzire ||
    (Array.isArray(utilitatiCrm?.sistemIncalzire)
      ? utilitatiCrm.sistemIncalzire.join(" ")
      : "") ||
    "";
  const metodaIncalzire = matchOptionInsensitive(rawMetodaIncalzire, METODA_INCALZIRE_OPTIONS);

  const lift = matchOptionInsensitive(
    cf?.lift || lead.lift || alteDetalii?.lift,
    LIFT_OPTIONS
  );

  const gradina = matchOptionInsensitive(
    cf?.gradina || lead.gradina || alteDetalii?.gradina,
    GRADINA_OPTIONS
  );

  const rawBalcoane =
    Array.isArray(cf?.balcoaneTeraseLogii) && cf.balcoaneTeraseLogii.length > 0
      ? cf.balcoaneTeraseLogii
      : Array.isArray(lead.balcoaneTeraseLogii) && lead.balcoaneTeraseLogii.length > 0
        ? lead.balcoaneTeraseLogii
        : detalii?.balcoane
          ? String(detalii.balcoane)
              .split(/[,;]+/)
              .map((s) => s.trim())
              .filter((s) => BALCOANE_TERASE_LOGII_OPTIONS.includes(s))
          : [];

  const utilitati =
    Array.isArray(cf?.utilitati) && cf.utilitati.length > 0
      ? cf.utilitati
      : Array.isArray(lead.utilitati) && lead.utilitati.length > 0
        ? lead.utilitati
        : normalizeUtilitatiList(utilitatiCrm?.generale, isTeren);

  const serviciiImobil =
    Array.isArray(cf?.serviciiImobil) && cf.serviciiImobil.length > 0
      ? cf.serviciiImobil
      : Array.isArray(lead.serviciiImobil) && lead.serviciiImobil.length > 0
        ? lead.serviciiImobil
        : Array.isArray(dotariCrm?.serviciiImobil)
          ? dotariCrm.serviciiImobil
          : [];

  // Acquisition options & Preț & Condiții
  const savedFinantare = String(savedPresentation?.acte?.["Finanțare"] || "").trim();
  const rawTipAchizitie =
    Array.isArray(cf?.tipAchizitieAcceptat) && cf.tipAchizitieAcceptat.length > 0
      ? cf.tipAchizitieAcceptat
      : Array.isArray(lead.tipAchizitieAcceptat) && lead.tipAchizitieAcceptat.length > 0
        ? lead.tipAchizitieAcceptat
        : (cf?.modalitateAchizitie || lead.modalitateAchizitie || savedFinantare || "")
            .split(/[,/]+/)
            .map((s) => matchOptionInsensitive(s, MODALITATE_ACHIZITIE_OPTIONS))
            .filter((v, idx, arr) => Boolean(v) && arr.indexOf(v) === idx);

  const modalitateAchizitie = matchOptionInsensitive(
    cf?.modalitateAchizitie || lead.modalitateAchizitie,
    MODALITATE_ACHIZITIE_OPTIONS
  );

  const tva = String(
    cf?.tva ??
      savedPresentation?.tranzactie?.["TVA"] ??
      pretDetalii?.tva ??
      "Scutit de TVA / conform legislației în vigoare"
  ).trim();

  const defaultComision = isRentLead ? "50%+TVA" : "0%";
  const comision = String(
    cf?.comision ??
      savedPresentation?.tranzactie?.["Comision"] ??
      pretDetalii?.comision ??
      defaultComision
  ).trim();

  const rawContract =
    cf?.contractDurata ??
    savedPresentation?.acte?.["Contract"] ??
    savedPresentation?.acte?.["Condiții contractuale"] ??
    pretDetalii?.contract ??
    "";
  const contractDurata =
    matchOptionInsensitive(rawContract, CONTRACT_DURATA_OPTIONS) ||
    String(rawContract || "12 luni").trim();

  const rawAvans =
    cf?.avans ?? savedPresentation?.acte?.["Avans"] ?? pretDetalii?.avans ?? "";
  const avans =
    matchOptionInsensitive(rawAvans, AVANS_GARANTIE_OPTIONS) ||
    (String(rawAvans).trim() ? String(rawAvans).trim() : "1 luna");

  const rawGarantie =
    cf?.garantie ?? savedPresentation?.acte?.["Garanție"] ?? pretDetalii?.garantie ?? "";
  const garantie =
    matchOptionInsensitive(rawGarantie, AVANS_GARANTIE_OPTIONS) ||
    (String(rawGarantie).trim() ? String(rawGarantie).trim() : "1 luna");

  const situatieJuridica = String(
    cf?.situatieJuridica ??
      savedPresentation?.acte?.["Situație juridică"] ??
      pretDetalii?.situatieJuridica ??
      "Fara probleme"
  ).trim();

  const disponibilitate = String(
    cf?.disponibilitate ??
      savedPresentation?.acte?.["Disponibilitate"] ??
      pretDetalii?.disponibilitate ??
      "Imediată"
  ).trim();

  const normalizeStringList = (
    rawList: unknown,
    rawLegacy: unknown,
    allowed?: readonly string[]
  ): string[] => {
    const items: string[] = [];
    const source =
      Array.isArray(rawList) && rawList.length > 0
        ? rawList
        : Array.isArray(rawLegacy)
          ? rawLegacy
          : typeof rawLegacy === "string" && rawLegacy.trim()
            ? rawLegacy.split(/[,;]+/)
            : [];
    for (const entry of source) {
      const cleaned = String(entry || "").trim();
      if (!cleaned) continue;
      const mapped = allowed ? matchOptionInsensitive(cleaned, allowed) || cleaned : cleaned;
      if (mapped && !items.includes(mapped)) items.push(mapped);
    }
    return items;
  };

  const cetatenieList = normalizeStringList(
    cf?.cetatenieList ?? lead.cetatenieList,
    cf?.cetatenie ?? lead.cetatenie,
    CETATENIE_OPTIONS
  );

  const animaleList = normalizeStringList(
    cf?.animaleList ?? lead.animaleList,
    cf?.animal ?? lead.animal,
    ANIMALE_OPTIONS
  );

  const profilList = normalizeStringList(
    cf?.profil ?? lead.profil,
    undefined,
    PROFIL_CHIRIAS_OPTIONS
  );

  const copii = matchOptionInsensitive(cf?.copii || lead.copii, COPII_OPTIONS);

  const propertyTitle =
    cf?.propertyTitle !== undefined && cf.propertyTitle.trim() !== ""
      ? cf.propertyTitle
      : crm?.descriere?.titlu || lead.title || "";

  const requirements =
    cf?.requirements !== undefined
      ? cf.requirements
      : lead.requirements !== undefined
        ? lead.requirements
        : crm?.descriere?.continut || lead.extractedData?.originalDescription || lead.notes || "";

  return {
    ...base,
    clientName: lead.ownerName && lead.ownerName !== "Nespecificat" ? lead.ownerName : "",
    clientPhone: lead.ownerPhone && lead.ownerPhone !== "Nespecificat" ? lead.ownerPhone : "",
    cetatenie: cetatenieList,
    animal: animaleList,
    profil: profilList,
    copii,
    minBudget,
    maxBudget,
    tva,
    comision,
    contractDurata,
    avans,
    garantie,
    situatieJuridica,
    disponibilitate,
    modalitateAchizitie,
    tipAchizitieAcceptat: rawTipAchizitie,
    buildingType,
    terenCategorie:
      matchOptionInsensitive(
        cf?.terenCategorie || lead.terenCategorie || alteDetalii?.tipTeren,
        TEREN_CATEGORIE_OPTIONS
      ) || "Construcții",
    terenClasificare:
      matchOptionInsensitive(
        cf?.terenClasificare || lead.terenClasificare || alteDetalii?.clasificare,
        TEREN_CLASIFICARE_OPTIONS
      ) || "Intravilan",
    comercialCategorie:
      matchOptionInsensitive(
        cf?.comercialCategorie ||
          lead.comercialCategorie ||
          alteDetalii?.tipSpatiuComercial ||
          deriveComercialSubcategory(lead.categoria),
        COMERCIAL_CATEGORIE_OPTIONS
      ) || "Comercial",
    compartimentare: matchOptionInsensitive(
      cf?.compartimentare || lead.compartimentare || detalii?.compartimentare,
      COMPARTIMENTARE_OPTIONS
    ),
    selectedRooms,
    selectedBaths,
    selectedFloors,
    totalFloors,
    casaSubsol: Boolean(cf?.casaSubsol ?? lead.casaSubsol ?? false),
    casaDemisol: Boolean(cf?.casaDemisol ?? lead.casaDemisol ?? false),
    casaEtajePesteParter: String(
      cf?.casaEtajePesteParter ?? lead.casaEtajePesteParter ?? ""
    ),
    mobilare,
    utilare,
    tipParcare,
    numarLocuriParcare,
    zoneList: rawZoneList,
    propertyTitle,
    requirements,
    anConstructieMin,
    anConstructieMax,
    suprafataUtilaMin,
    suprafataUtilaMax,
    suprafataConstruitaMin,
    suprafataConstruitaMax,
    suprafataCurteMin,
    suprafataCurteMax,
    suprafataTerenMin,
    suprafataTerenMax,
    frontStradal,
    stareInterior,
    sistemIncalzire,
    metodaIncalzire,
    lift,
    gradina,
    balcoaneTeraseLogii: rawBalcoane,
    utilitati,
    serviciiImobil,
  };
}

function buildLeadUpdatePatch(params: {
  lead: Lead;
  state: PropertyCriteriaFormState;
  role: "Chirias" | "Cumparator";
  mode: "lead" | "cerere" | "property";
}): Partial<Lead> {
  const { lead, state, role, mode } = params;
  const isProperty = mode === "property";
  const isTeren = state.buildingType === "Teren";
  const isCasaVila = state.buildingType === "Casa/Vila";
  const isComercial = state.buildingType === "Spatiu Comercial";

  const canonicalCategory = isComercial
    ? mapComercialSubcategoryToCanonical(state.comercialCategorie)
    : state.buildingType;

  const rawMinB = state.minBudget.trim();
  const rawMaxB = state.maxBudget.trim();
  const minB = isProperty ? "" : rawMinB;
  const maxB = isProperty ? rawMaxB || rawMinB : rawMaxB;
  const displayBudget = isProperty
    ? maxB
      ? `${maxB} €`
      : lead.price || "La cerere"
    : minB && maxB
      ? `${minB} - ${maxB} €`
      : maxB
        ? `${maxB} €`
        : minB
          ? `min. ${minB} €`
          : lead.price || "La cerere";

  const numericPrice = parseFloat((maxB || minB).replace(/[^\d.]/g, ""));
  const zoneStr = state.zoneList.join(", ") || lead.zone || "București";
  const roomsStr = !isTeren ? state.selectedRooms.join(", ") : "";
  const bathsStr = !isTeren ? state.selectedBaths.join(", ") : "";

  const casaFloorsParts: string[] = [];
  if (isCasaVila) {
    if (state.casaSubsol) casaFloorsParts.push("Subsol");
    if (state.casaDemisol) casaFloorsParts.push("Demisol");
    casaFloorsParts.push("Parter");
    if (state.casaEtajePesteParter) casaFloorsParts.push(`+${state.casaEtajePesteParter}E`);
  }
  const floorStr = isTeren
    ? ""
    : isCasaVila
      ? casaFloorsParts.join(", ")
      : state.selectedFloors.join(", ");

  const parcareSummary = !isTeren
    ? [state.tipParcare, state.numarLocuriParcare].filter(Boolean).join(" • ")
    : "";

  const isSaleAcquisitionApplicable = isProperty
    ? role === "Cumparator"
    : role === "Cumparator" && !isComercial;
  const effectiveTipAchizitieAcceptat =
    mode === "property" && isSaleAcquisitionApplicable
      ? [...state.tipAchizitieAcceptat]
      : [];
  const effectiveModalitateAchizitie = !isSaleAcquisitionApplicable
    ? ""
    : mode === "property"
      ? effectiveTipAchizitieAcceptat.join(", ")
      : state.modalitateAchizitie;

  const tvaValue = isProperty ? state.tva.trim() : "";
  const comisionValue = isProperty ? state.comision.trim() : "";
  const contractDurataValue =
    isProperty && role === "Chirias" ? state.contractDurata.trim() : "";
  const avansValue = isProperty && role === "Chirias" ? state.avans.trim() : "";
  const garantieValue = isProperty && role === "Chirias" ? state.garantie.trim() : "";
  const situatieJuridicaValue =
    isProperty && role === "Cumparator" ? state.situatieJuridica.trim() : "";
  const disponibilitateValue =
    isProperty && role === "Cumparator" ? state.disponibilitate.trim() : "";

  const normAnMin = isProperty
    ? state.anConstructieMin.trim() || state.anConstructieMax.trim()
    : state.anConstructieMin.trim();
  const normAnMax = isProperty ? "" : state.anConstructieMax.trim();
  const normUtilaMin = isProperty
    ? state.suprafataUtilaMin.trim() || state.suprafataUtilaMax.trim()
    : state.suprafataUtilaMin.trim();
  const normUtilaMax = isProperty ? "" : state.suprafataUtilaMax.trim();
  const normConstrMin = isProperty
    ? state.suprafataConstruitaMin.trim() || state.suprafataConstruitaMax.trim()
    : state.suprafataConstruitaMin.trim();
  const normConstrMax = isProperty ? "" : state.suprafataConstruitaMax.trim();
  const normCurteMin = isProperty
    ? state.suprafataCurteMin.trim() || state.suprafataCurteMax.trim()
    : state.suprafataCurteMin.trim();
  const normCurteMax = isProperty ? "" : state.suprafataCurteMax.trim();
  const normTerenMin = isProperty
    ? state.suprafataTerenMin.trim() || state.suprafataTerenMax.trim()
    : state.suprafataTerenMin.trim();
  const normTerenMax = isProperty ? "" : state.suprafataTerenMax.trim();

  const parsedUsefulArea = parseFloat(
    (isTeren ? normTerenMin || normTerenMax : normUtilaMin || normUtilaMax).trim()
  );

  const anConstructieValue = formatSingleOrRange(normAnMin, normAnMax, isProperty);

  const criteriiFormular = {
    buildingType: state.buildingType,
    minBudget: minB,
    maxBudget: maxB,
    tva: tvaValue,
    comision: comisionValue,
    contractDurata: contractDurataValue,
    avans: avansValue,
    garantie: garantieValue,
    situatieJuridica: situatieJuridicaValue,
    disponibilitate: disponibilitateValue,
    modalitateAchizitie: effectiveModalitateAchizitie,
    tipAchizitieAcceptat: effectiveTipAchizitieAcceptat,
    cetatenie: state.cetatenie.join(", "),
    cetatenieList: [...state.cetatenie],
    animal: state.animal.join(", "),
    animaleList: [...state.animal],
    profil: [...state.profil],
    copii: state.copii,
    terenCategorie: state.terenCategorie,
    terenClasificare: state.terenClasificare,
    comercialCategorie: state.comercialCategorie,
    compartimentare: state.compartimentare,
    selectedRooms: [...state.selectedRooms],
    selectedBaths: [...state.selectedBaths],
    selectedFloors: [...state.selectedFloors],
    totalFloors: state.totalFloors.trim(),
    casaSubsol: Boolean(state.casaSubsol),
    casaDemisol: Boolean(state.casaDemisol),
    casaParter: true,
    casaEtajePesteParter: state.casaEtajePesteParter,
    mobilare: state.mobilare,
    utilare: state.utilare,
    tipParcare: state.tipParcare,
    numarLocuriParcare: state.numarLocuriParcare,
    zoneList: [...state.zoneList],
    propertyTitle: state.propertyTitle.trim(),
    requirements: state.requirements.trim(),
    anConstructieMin: normAnMin,
    anConstructieMax: normAnMax,
    suprafataUtilaMin: normUtilaMin,
    suprafataUtilaMax: normUtilaMax,
    suprafataConstruitaMin: normConstrMin,
    suprafataConstruitaMax: normConstrMax,
    suprafataCurteMin: normCurteMin,
    suprafataCurteMax: normCurteMax,
    suprafataTerenMin: normTerenMin,
    suprafataTerenMax: normTerenMax,
    frontStradal: state.frontStradal.trim(),
    stareInterior: state.stareInterior,
    sistemIncalzire: state.sistemIncalzire,
    metodaIncalzire: state.metodaIncalzire,
    lift: state.lift,
    gradina: state.gradina,
    balcoaneTeraseLogii: [...state.balcoaneTeraseLogii],
    utilitati: [...state.utilitati],
    serviciiImobil: [...state.serviciiImobil],
  };

  const currentCrm = (lead.extractedData?.crmData || {}) as any;
  const nextTitle = isProperty
    ? state.propertyTitle.trim() || lead.title || ""
    : lead.title || "";

  const nextExtractedData = {
    ...(lead.extractedData || {}),
    crmData: {
      ...currentCrm,
      detaliiGenerale: {
        ...(currentCrm.detaliiGenerale || {}),
        categoria: canonicalCategory,
        localizare: {
          ...(currentCrm.detaliiGenerale?.localizare || {}),
          zona: state.zoneList.length > 0 ? [...state.zoneList] : [zoneStr],
        },
      },
      descriere: {
        ...(currentCrm.descriere || {}),
        ...(isProperty && nextTitle ? { titlu: nextTitle } : {}),
        continut: state.requirements.trim(),
      },
      caracteristici: {
        ...(currentCrm.caracteristici || {}),
        detalii: {
          ...(currentCrm.caracteristici?.detalii || {}),
          camere: roomsStr,
          bai: bathsStr,
          etaj: floorStr,
          totalEtaje: !isTeren && !isCasaVila ? state.totalFloors.trim() : "",
          compartimentare: !isTeren ? state.compartimentare : "",
          anConstructie: !isTeren ? anConstructieValue : "",
          balcoane: !isTeren ? state.balcoaneTeraseLogii.join(", ") : "",
        },
        suprafete: {
          ...(currentCrm.caracteristici?.suprafete || {}),
          ...(isTeren
            ? {
                teren: formatSingleOrRange(normTerenMin, normTerenMax, isProperty),
                frontStradal: state.frontStradal.trim(),
              }
            : {
                utila: formatSingleOrRange(normUtilaMin, normUtilaMax, isProperty),
                construita: formatSingleOrRange(normConstrMin, normConstrMax, isProperty),
                ...(isCasaVila
                  ? { curte: formatSingleOrRange(normCurteMin, normCurteMax, isProperty) }
                  : {}),
              }),
        },
        alteDetalii: {
          ...(currentCrm.caracteristici?.alteDetalii || {}),
          anConstructie: !isTeren ? anConstructieValue : "",
          stareInterior: !isTeren ? state.stareInterior : "",
          lift: !isTeren ? state.lift : "",
          gradina: !isTeren ? state.gradina : "",
          ...(isTeren
            ? {
                tipTeren: state.terenCategorie,
                clasificare: state.terenClasificare,
              }
            : {}),
          ...(isComercial ? { tipSpatiuComercial: state.comercialCategorie } : {}),
        },
      },
      utilitati: {
        ...(currentCrm.utilitati || {}),
        generale: [...state.utilitati],
        sistemIncalzire: state.sistemIncalzire && !isTeren ? [state.sistemIncalzire] : [],
        metodaIncalzire: state.metodaIncalzire && !isTeren ? state.metodaIncalzire : "",
      },
      dotari: {
        ...(currentCrm.dotari || {}),
        mobilat: state.mobilare && !isTeren ? [state.mobilare] : [],
        utilare: state.utilare && !isTeren ? state.utilare : "",
        parcare: parcareSummary,
        tipParcare: !isTeren ? state.tipParcare : "",
        numarLocuriParcare: !isTeren ? state.numarLocuriParcare : "",
        serviciiImobil: !isTeren ? [...state.serviciiImobil] : [],
      },
      pret: {
        ...(currentCrm.pret || {}),
        detalii: {
          ...(currentCrm.pret?.detalii || {}),
          pret: displayBudget,
          ...(tvaValue ? { tva: tvaValue } : {}),
          ...(comisionValue ? { comision: comisionValue } : {}),
          ...(contractDurataValue ? { contract: contractDurataValue } : {}),
          ...(avansValue ? { avans: avansValue } : {}),
          ...(garantieValue ? { garantie: garantieValue } : {}),
          ...(situatieJuridicaValue ? { situatieJuridica: situatieJuridicaValue } : {}),
          ...(disponibilitateValue ? { disponibilitate: disponibilitateValue } : {}),
          ...(effectiveModalitateAchizitie
            ? { modalitateAchizitie: effectiveModalitateAchizitie }
            : {}),
          ...(effectiveTipAchizitieAcceptat.length > 0
            ? { tipAchizitieAcceptat: effectiveTipAchizitieAcceptat }
            : {}),
        },
      },
    },
    ...(isProperty
      ? {
          presentationSections: {
            ...((lead.extractedData as any)?.presentationSections || {}),
            tranzactie: {
              ...((lead.extractedData as any)?.presentationSections?.tranzactie || {}),
              "Preț": displayBudget,
              ...(tvaValue ? { "TVA": tvaValue } : {}),
              ...(comisionValue ? { "Comision": comisionValue } : {}),
            },
            acte: {
              ...((lead.extractedData as any)?.presentationSections?.acte || {}),
              ...(role === "Chirias"
                ? {
                    ...(contractDurataValue
                      ? {
                          "Contract": contractDurataValue,
                          "Condiții contractuale": contractDurataValue,
                        }
                      : {}),
                    ...(avansValue ? { "Avans": avansValue } : {}),
                    ...(garantieValue ? { "Garanție": garantieValue } : {}),
                  }
                : {
                    ...(situatieJuridicaValue
                      ? { "Situație juridică": situatieJuridicaValue }
                      : {}),
                    ...(disponibilitateValue
                      ? { "Disponibilitate": disponibilitateValue }
                      : {}),
                    ...(effectiveTipAchizitieAcceptat.length > 0
                      ? { "Finanțare": effectiveTipAchizitieAcceptat.join(", ") }
                      : {}),
                  }),
            },
          },
        }
      : {}),
  };

  return {
    ...(isProperty && nextTitle ? { title: nextTitle } : {}),
    ownerName: state.clientName.trim() || "Nespecificat",
    ownerPhone: state.clientPhone.trim() || "Nespecificat",
    price: displayBudget,
    ...(Number.isFinite(numericPrice) && numericPrice > 0 ? { priceNumeric: numericPrice } : {}),
    zone: zoneStr,
    zoneList: state.zoneList.length > 0 ? [...state.zoneList] : [zoneStr],
    categoria: canonicalCategory,
    buildingType: state.buildingType,
    minBudget: minB,
    maxBudget: maxB,
    modalitateAchizitie: effectiveModalitateAchizitie,
    tipAchizitieAcceptat: effectiveTipAchizitieAcceptat,
    cetatenie: state.cetatenie.join(", "),
    cetatenieList: [...state.cetatenie],
    animal: state.animal.join(", "),
    animaleList: [...state.animal],
    profil: [...state.profil],
    copii: state.copii,
    terenCategorie: isTeren ? state.terenCategorie : "",
    terenClasificare: isTeren ? state.terenClasificare : "",
    comercialCategorie: isComercial ? state.comercialCategorie : "",
    compartimentare: !isTeren ? state.compartimentare : "",
    rooms: roomsStr,
    baths: bathsStr,
    selectedRooms: !isTeren ? [...state.selectedRooms] : [],
    selectedBaths: !isTeren ? [...state.selectedBaths] : [],
    floor: floorStr,
    selectedFloors: !isTeren && !isCasaVila ? [...state.selectedFloors] : [],
    totalFloors: !isTeren && !isCasaVila ? state.totalFloors.trim() : "",
    casaSubsol: isCasaVila ? Boolean(state.casaSubsol) : false,
    casaDemisol: isCasaVila ? Boolean(state.casaDemisol) : false,
    casaParter: isCasaVila ? true : false,
    casaEtajePesteParter: isCasaVila ? state.casaEtajePesteParter : "",
    ...(Number.isFinite(parsedUsefulArea) && parsedUsefulArea > 0
      ? { usefulArea: parsedUsefulArea }
      : {}),
    mobilare: !isTeren ? state.mobilare : "",
    utilare: !isTeren ? state.utilare : "",
    parcare: parcareSummary,
    tipParcare: !isTeren ? state.tipParcare : "",
    numarLocuriParcare: !isTeren ? state.numarLocuriParcare : "",
    sursaIncalzire: !isTeren ? state.sistemIncalzire : "",
    modIncalzire: !isTeren ? state.metodaIncalzire : "",
    requirements: state.requirements.trim(),
    anConstructieMin: !isTeren ? normAnMin : "",
    anConstructieMax: !isTeren ? normAnMax : "",
    constructionYear: !isTeren ? anConstructieValue : "",
    suprafataUtilaMin: !isTeren ? normUtilaMin : "",
    suprafataUtilaMax: !isTeren ? normUtilaMax : "",
    suprafataConstruitaMin: !isTeren ? normConstrMin : "",
    suprafataConstruitaMax: !isTeren ? normConstrMax : "",
    suprafataCurteMin: isCasaVila ? normCurteMin : "",
    suprafataCurteMax: isCasaVila ? normCurteMax : "",
    suprafataTerenMin: isTeren ? normTerenMin : "",
    suprafataTerenMax: isTeren ? normTerenMax : "",
    frontStradal: isTeren ? state.frontStradal.trim() : "",
    stareInterior: !isTeren ? state.stareInterior : "",
    lift: !isTeren ? state.lift : "",
    gradina: !isTeren ? state.gradina : "",
    balcoaneTeraseLogii: !isTeren ? [...state.balcoaneTeraseLogii] : [],
    utilitati: [...state.utilitati],
    serviciiImobil: !isTeren ? [...state.serviciiImobil] : [],
    criteriiFormular,
    extractedData: nextExtractedData as any,
  };
}

const ANIMAL_LABEL: Record<string, string> = {
  Fara: "Fără",
  Caine: "Câine",
  Pisica: "Pisică",
  Altceva: "Altceva",
};

const BUILDING_TYPE_LABEL: Record<BuildingCategoryType, string> = {
  Apartament: "Apartament",
  "Casa/Vila": "Casă / Vilă",
  Teren: "Teren",
  "Spatiu Comercial": "Spațiu Comercial",
};

const ReadOnlyTagsField: React.FC<{
  label: string;
  items: string[];
  className?: string;
}> = ({ label, items, className = "" }) => (
  <div className={`flex flex-col min-w-0 font-sans ${className}`}>
    <span className="text-[12px] leading-4 mb-1 font-semibold text-[#051D35] select-none">
      {label}
    </span>
    {items.length > 0 ? (
      <div className="min-h-9 py-1.5 flex flex-wrap gap-1.5 items-center">
        {items.map((item) => (
          <span
            key={item}
            className="inline-flex items-center px-2 py-0.5 rounded bg-gray-100 text-gray-800 border border-gray-200 text-[11px] font-normal"
          >
            {item}
          </span>
        ))}
      </div>
    ) : (
      <div className="h-9 flex items-center text-[12px] text-gray-400 font-normal">-</div>
    )}
  </div>
);

interface SectionHeaderProps {
  icon: React.ReactNode;
  title: string;
  isEditing: boolean;
  isSaving: boolean;
  onStartEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
}

const SectionHeader: React.FC<SectionHeaderProps> = ({
  icon,
  title,
  isEditing,
  isSaving,
  onStartEdit,
  onCancel,
  onSave,
}) => (
  <div className="flex items-center justify-between pb-3 border-b border-gray-100 gap-2">
    <span className="font-title text-[12px] font-semibold text-[#051D35] flex items-center gap-2 min-w-0">
      <span className="w-7 h-7 rounded-lg bg-[#051D35]/5 text-[#051D35] flex items-center justify-center shrink-0">
        {icon}
      </span>
      <span className="font-title font-semibold truncate">{title}</span>
    </span>

    {isEditing ? (
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          disabled={isSaving}
          onClick={onCancel}
          className="h-8 px-2.5 rounded-md border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 hover:text-gray-900 text-[11px] font-medium flex items-center gap-1 transition-colors disabled:opacity-50 cursor-pointer"
        >
          <X size={11} />
          <span>Anulează</span>
        </button>
        <button
          type="button"
          disabled={isSaving}
          onClick={onSave}
          className="h-8 px-3 rounded-md bg-[#051D35] hover:bg-[#0a2b4a] text-white text-[11px] font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer shadow-2xs"
        >
          {isSaving ? (
            <Loader2 size={12} className="animate-spin text-[#BE9662]" />
          ) : (
            <Check size={12} className="text-[#BE9662]" />
          )}
          <span>{isSaving ? "Se salvează..." : "Salvează"}</span>
        </button>
      </div>
    ) : (
      <button
        type="button"
        onClick={onStartEdit}
        className="h-8 px-3 rounded-md border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 hover:text-[#051D35] text-[11px] font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs shrink-0"
      >
        <Pencil size={11} className="text-[#BE9662]" />
        <span>Modifică</span>
      </button>
    )}
  </div>
);

export interface CriteriaDetailSectionsProps {
  lead: Lead;
  role: "Chirias" | "Cumparator";
  mode: "lead" | "cerere" | "property";
  onUpdateLead: (updatedData: Partial<Lead>) => void;
  onBuildingTypeDisplayChange?: (buildingType: BuildingCategoryType) => void;
}

export const CriteriaDetailSections: React.FC<CriteriaDetailSectionsProps> = ({
  lead,
  role,
  mode,
  onUpdateLead,
  onBuildingTypeDisplayChange,
}) => {
  const { tenant } = useTenantContext();

  const persistedState = useMemo(() => derivePropertyCriteriaStateFromLead(lead), [lead]);
  const [draft, setDraft] = useState<PropertyCriteriaFormState>(persistedState);
  const [editingSection, setEditingSection] = useState<CriteriaSectionKey | null>(null);
  const [savingSection, setSavingSection] = useState<CriteriaSectionKey | null>(null);
  const [copiedPhone, setCopiedPhone] = useState(false);
  const [openMultiDropdown, setOpenMultiDropdown] = useState<
    "rooms" | "baths" | "floors" | "balcoane" | "tipAchizitie" | null
  >(null);

  useEffect(() => {
    setEditingSection(null);
    setSavingSection(null);
    setOpenMultiDropdown(null);
    setDraft(derivePropertyCriteriaStateFromLead(lead));
  }, [lead.id]);

  useEffect(() => {
    if (!editingSection) {
      setDraft(persistedState);
    }
  }, [editingSection, persistedState]);

  const activeState = editingSection ? draft : persistedState;

  useEffect(() => {
    onBuildingTypeDisplayChange?.(activeState.buildingType);
  }, [activeState.buildingType, onBuildingTypeDisplayChange]);

  const isPropertyMode = mode === "property";
  const isChirias = role === "Chirias";
  const isCumparator = role === "Cumparator";
  const isApartament = activeState.buildingType === "Apartament";
  const isCasaVila = activeState.buildingType === "Casa/Vila";
  const isTeren = activeState.buildingType === "Teren";
  const isComercial = activeState.buildingType === "Spatiu Comercial";

  const titles = getCriteriaSectionTitles({
    mode,
    role,
    buildingType: activeState.buildingType,
  });

  const nameLabel = isPropertyMode ? "Nume Proprietar" : "Nume Client";
  const zoneLabel = isPropertyMode ? "Zonă" : "Zonă preferată";
  const descriptionLabel = mode === "cerere" ? "Cerințe specifice" : "Descriere";
  const descriptionPlaceholder = isPropertyMode
    ? "Descrierea proprietății..."
    : mode === "lead"
      ? "Descriere / detalii suplimentare..."
      : "ex. Minim 60mp, decomandat, loc parcare, bloc după 2015...";

  const selectClass =
    "w-full h-9 px-3 text-xs font-normal border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] bg-gray-50/90 hover:bg-gray-100/70 cursor-pointer disabled:opacity-60";
  const inputClass =
    "w-full h-9 px-3 text-xs font-normal border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] bg-gray-50/90 hover:bg-gray-100/70 disabled:opacity-60";

  const setField = <K extends keyof PropertyCriteriaFormState>(
    key: K,
    value: PropertyCriteriaFormState[K]
  ) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleBuildingTypeChange = (nextType: BuildingCategoryType) => {
    setOpenMultiDropdown(null);
    setDraft((prev) => {
      const allowedUtils =
        nextType === "Teren" ? UTILITATI_TEREN_OPTIONS : UTILITATI_STANDARD_OPTIONS;
      return {
        ...prev,
        buildingType: nextType,
        utilitati: prev.utilitati.filter((u) => allowedUtils.includes(u)),
      };
    });
  };

  const startEdit = (section: CriteriaSectionKey) => {
    setOpenMultiDropdown(null);
    setDraft(persistedState);
    setEditingSection(section);
  };

  const cancelEdit = () => {
    setOpenMultiDropdown(null);
    setDraft(persistedState);
    setEditingSection(null);
  };

  const saveSection = async (section: CriteriaSectionKey) => {
    if (!lead.id) return;
    setOpenMultiDropdown(null);
    setSavingSection(section);
    try {
      const patch = buildLeadUpdatePatch({
        lead,
        state: draft,
        role,
        mode,
      });
      const persisted = await leadsService.updateLeadData(lead.id, patch);
      const mergedPatch: Partial<Lead> = {
        ...patch,
        ...(persisted?.extractedData ? { extractedData: persisted.extractedData } : {}),
        ...(persisted?.propertyId ? { propertyId: persisted.propertyId } : {}),
        ...(persisted?.sourcePropertyId ? { sourcePropertyId: persisted.sourcePropertyId } : {}),
        ...(persisted?.isSharedLead === false ? { isSharedLead: false } : {}),
        ...(persisted?.updatedAt ? { updatedAt: persisted.updatedAt } : {}),
      };
      onUpdateLead(mergedPatch);
      await publishPublicShareSnapshot(
        { ...lead, ...mergedPatch },
        { tenantId: tenant?.id, force: true }
      );
      setEditingSection(null);
      toast.success("Modificările au fost salvate!");
    } catch (err) {
      console.error("[CriteriaDetailSections] Failed to save section:", err);
      toast.error("Eroare la salvare. Încercați din nou.");
    } finally {
      setSavingSection(null);
    }
  };

  const handleCopyPhone = async (phone: string) => {
    try {
      await navigator.clipboard.writeText(phone);
      setCopiedPhone(true);
      setTimeout(() => setCopiedPhone(false), 2000);
      toast.success("Numărul de telefon a fost copiat!");
    } catch {
      toast.error("Nu s-a putut copia numărul.");
    }
  };

  const isEditingPersoana = editingSection === "persoana";
  const isEditingClientDorit = editingSection === "clientDorit";
  const isEditingPretConditii = editingSection === "pretConditii";
  const isEditingGenerale = editingSection === "generale";
  const isEditingImobil = editingSection === "imobil";
  const isEditingAvansate = editingSection === "avansate";
  const isEditingAlte = editingSection === "alte";

  const casaFloorsSummary = useMemo(() => {
    const parts: string[] = [];
    if (activeState.casaSubsol) parts.push("Subsol");
    if (activeState.casaDemisol) parts.push("Demisol");
    parts.push("Parter");
    if (activeState.casaEtajePesteParter) {
      parts.push(
        `${activeState.casaEtajePesteParter} ${
          activeState.casaEtajePesteParter === "1" ? "etaj" : "etaje"
        } peste parter`
      );
    }
    return parts.join(", ");
  }, [activeState.casaSubsol, activeState.casaDemisol, activeState.casaEtajePesteParter]);

  return (
    <div className="space-y-4">
      {/* SECTION 1: Informații Proprietar / Chiriaș / Cumpărător */}
      <div
        id="sec-persoana"
        className="p-4 sm:p-5 bg-white border border-gray-200 rounded-xl space-y-4 shadow-2xs scroll-mt-[104px]"
      >
        <SectionHeader
          icon={<User size={14} className="text-[#BE9662]" />}
          title={titles.persoanaTitle}
          isEditing={isEditingPersoana}
          isSaving={savingSection === "persoana"}
          onStartEdit={() => startEdit("persoana")}
          onCancel={cancelEdit}
          onSave={() => void saveSection("persoana")}
        />

        <div className="space-y-4">
          {/* Row 1: Nume client/proprietar | Telefon */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InlineDetailField
              label={nameLabel}
              value={activeState.clientName || "-"}
              editValue={draft.clientName}
              isEditing={isEditingPersoana}
              onChange={(val) => setField("clientName", val)}
              placeholder="ex. Radu Popescu"
              valueClassName="font-normal text-gray-900"
            />

            <InlineDetailField
              label="Telefon"
              type="tel"
              value={activeState.clientPhone || "-"}
              editValue={draft.clientPhone}
              isEditing={isEditingPersoana}
              onChange={(val) => setField("clientPhone", val)}
              placeholder="07xxxxxxxx"
              valueClassName="font-normal text-gray-800 tabular-nums"
              viewActions={
                activeState.clientPhone ? (
                  <>
                    <a
                      href={`tel:${activeState.clientPhone.replace(/[^0-9+]/g, "")}`}
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center justify-center w-6 h-6 rounded-md bg-white border border-gray-200 text-gray-500 hover:text-[#051D35] transition-colors"
                      title="Apelează"
                    >
                      <Phone size={11} className="text-[#BE9662]" />
                    </a>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleCopyPhone(activeState.clientPhone);
                      }}
                      className="flex items-center justify-center w-6 h-6 rounded-md bg-white border border-gray-200 text-gray-400 hover:text-[#051D35] transition-colors cursor-pointer"
                      title="Copiază telefon"
                    >
                      {copiedPhone ? (
                        <Check size={11} className="text-emerald-600" />
                      ) : (
                        <Copy size={11} />
                      )}
                    </button>
                    <a
                      href={formatWhatsAppLink(activeState.clientPhone)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="h-6 px-2 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[10px] font-semibold flex items-center gap-1 border border-emerald-200 transition-colors"
                      title="WhatsApp"
                    >
                      <MessageCircle size={10} />
                      <span>WA</span>
                    </a>
                  </>
                ) : undefined
              }
            />
          </div>

          {/* Rows 2 & 3 (Lead/Cerere Chiriaș only): Cetățenie | Animale de companie, apoi Profil | Copii */}
          {!isPropertyMode && isChirias && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {isEditingPersoana ? (
                  <TagMultiSelect
                    label="Cetățenie"
                    options={CETATENIE_OPTIONS}
                    selected={draft.cetatenie}
                    onChange={(next) => setField("cetatenie", next)}
                    placeholder="Selectează..."
                    disabled={savingSection === "persoana"}
                  />
                ) : (
                  <ReadOnlyTagsField label="Cetățenie" items={activeState.cetatenie} />
                )}

                {isEditingPersoana ? (
                  <TagMultiSelect
                    label="Animale de companie"
                    options={ANIMALE_OPTIONS}
                    selected={draft.animal}
                    onChange={(next) => setField("animal", next)}
                    placeholder="Selectează..."
                    disabled={savingSection === "persoana"}
                  />
                ) : (
                  <ReadOnlyTagsField label="Animale de companie" items={activeState.animal} />
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {isEditingPersoana ? (
                  <TagMultiSelect
                    label="Profil"
                    options={PROFIL_CHIRIAS_OPTIONS}
                    selected={draft.profil}
                    onChange={(next) => setField("profil", next)}
                    placeholder="Selectează..."
                    disabled={savingSection === "persoana"}
                  />
                ) : (
                  <ReadOnlyTagsField label="Profil" items={activeState.profil} />
                )}

                <InlineDetailField
                  label="Copii"
                  value={activeState.copii || "-"}
                  editValue={draft.copii}
                  isEditing={isEditingPersoana}
                  onChange={(val) => setField("copii", val)}
                  options={COPII_OPTIONS}
                  emptyOptionLabel="Selectează..."
                  valueClassName="font-normal text-gray-800"
                />
              </div>
            </>
          )}

          {/* Row 3: Buget Minim / Maxim for lead/cerere (Preț (€) moved to Preț & Condiții for property mode) */}
          {!isPropertyMode && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {isEditingPersoana ? (
                <div>
                  <label className="block text-[12px] leading-4 mb-1 font-semibold text-[#051D35]">
                    Buget Minim (€)
                  </label>
                  <div className="relative">
                    <Euro size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      inputMode="numeric"
                      value={draft.minBudget}
                      onChange={(e) => setField("minBudget", e.target.value)}
                      placeholder={isChirias ? "ex. 400" : "ex. 80000"}
                      className="w-full h-9 pl-8 pr-3 text-xs font-normal border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] bg-gray-50/90"
                    />
                  </div>
                </div>
              ) : (
                <InlineDetailField
                  label="Buget Minim (€)"
                  value={activeState.minBudget ? `${activeState.minBudget} €` : "-"}
                  isEditing={false}
                  valueClassName="font-normal text-gray-900 tabular-nums"
                />
              )}

              {isEditingPersoana ? (
                <div>
                  <label className="block text-[12px] leading-4 mb-1 font-semibold text-[#051D35]">
                    Buget Maxim (€)
                  </label>
                  <div className="relative">
                    <Euro size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      inputMode="numeric"
                      value={draft.maxBudget}
                      onChange={(e) => setField("maxBudget", e.target.value)}
                      placeholder={isChirias ? "ex. 700" : "ex. 120000"}
                      className="w-full h-9 pl-8 pr-3 text-xs font-normal border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] bg-gray-50/90"
                    />
                  </div>
                </div>
              ) : (
                <InlineDetailField
                  label="Buget Maxim (€)"
                  value={activeState.maxBudget ? `${activeState.maxBudget} €` : "-"}
                  isEditing={false}
                  valueClassName="font-normal text-gray-900 tabular-nums"
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* SECTION 2 (Property mode only): Informații Chiriaș / Informații Cumpărător */}
      {isPropertyMode && (
        <div
          id="sec-client-dorit"
          className="p-4 sm:p-5 bg-white border border-gray-200 rounded-xl space-y-4 shadow-2xs scroll-mt-[104px]"
        >
          <SectionHeader
            icon={<UserCheck size={14} className="text-[#BE9662]" />}
            title={titles.clientDoritTitle}
            isEditing={isEditingClientDorit}
            isSaving={savingSection === "clientDorit"}
            onStartEdit={() => startEdit("clientDorit")}
            onCancel={cancelEdit}
            onSave={() => void saveSection("clientDorit")}
          />

          <div className="space-y-4">
            {isChirias ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {isEditingClientDorit ? (
                    <TagMultiSelect
                      label="Cetățenie"
                      options={CETATENIE_OPTIONS}
                      selected={draft.cetatenie}
                      onChange={(next) => setField("cetatenie", next)}
                      placeholder="Selectează..."
                      disabled={savingSection === "clientDorit"}
                    />
                  ) : (
                    <ReadOnlyTagsField label="Cetățenie" items={activeState.cetatenie} />
                  )}

                  {isEditingClientDorit ? (
                    <TagMultiSelect
                      label="Animale de companie"
                      options={ANIMALE_OPTIONS}
                      selected={draft.animal}
                      onChange={(next) => setField("animal", next)}
                      placeholder="Selectează..."
                      disabled={savingSection === "clientDorit"}
                    />
                  ) : (
                    <ReadOnlyTagsField label="Animale de companie" items={activeState.animal} />
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {isEditingClientDorit ? (
                    <TagMultiSelect
                      label="Profil"
                      options={PROFIL_CHIRIAS_OPTIONS}
                      selected={draft.profil}
                      onChange={(next) => setField("profil", next)}
                      placeholder="Selectează..."
                      disabled={savingSection === "clientDorit"}
                    />
                  ) : (
                    <ReadOnlyTagsField label="Profil" items={activeState.profil} />
                  )}

                  <InlineDetailField
                    label="Copii"
                    value={activeState.copii || "-"}
                    editValue={draft.copii}
                    isEditing={isEditingClientDorit}
                    onChange={(val) => setField("copii", val)}
                    options={COPII_OPTIONS}
                    emptyOptionLabel="Selectează..."
                    valueClassName="font-normal text-gray-800"
                  />
                </div>
              </>
            ) : isEditingClientDorit ? (
              <MultiSelectDropdown
                label="Tip achiziție acceptat"
                options={MODALITATE_ACHIZITIE_OPTIONS}
                selected={draft.tipAchizitieAcceptat}
                onChange={(next) => setField("tipAchizitieAcceptat", next)}
                isOpen={openMultiDropdown === "tipAchizitie"}
                onToggleOpen={() =>
                  setOpenMultiDropdown((prev) =>
                    prev === "tipAchizitie" ? null : "tipAchizitie"
                  )
                }
                onClose={() =>
                  setOpenMultiDropdown((prev) => (prev === "tipAchizitie" ? null : prev))
                }
                disabled={savingSection === "clientDorit"}
              />
            ) : (
              <ReadOnlyTagsField
                label="Tip achiziție acceptat"
                items={activeState.tipAchizitieAcceptat}
              />
            )}
          </div>
        </div>
      )}

      {/* SECTION 3 (Property mode only): Preț & Condiții */}
      {isPropertyMode && (
        <div
          id="sec-pret-conditii"
          className="p-4 sm:p-5 bg-white border border-gray-200 rounded-xl space-y-4 shadow-2xs scroll-mt-[104px]"
        >
          <SectionHeader
            icon={<BadgePercent size={14} className="text-[#BE9662]" />}
            title={titles.pretConditiiTitle}
            isEditing={isEditingPretConditii}
            isSaving={savingSection === "pretConditii"}
            onStartEdit={() => startEdit("pretConditii")}
            onCancel={cancelEdit}
            onSave={() => void saveSection("pretConditii")}
          />

          <div className="space-y-4">
            {/* Row 1: Preț (€) | TVA */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {isEditingPretConditii ? (
                <div>
                  <label className="block text-[12px] leading-4 mb-1 font-semibold text-[#051D35]">
                    Preț (€)
                  </label>
                  <div className="relative">
                    <Euro size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      inputMode="numeric"
                      value={draft.maxBudget || draft.minBudget}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          minBudget: "",
                          maxBudget: e.target.value,
                        }))
                      }
                      placeholder={isChirias ? "ex. 600" : "ex. 120000"}
                      className="w-full h-9 pl-8 pr-3 text-xs font-normal border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] bg-gray-50/90"
                    />
                  </div>
                </div>
              ) : (
                <InlineDetailField
                  label="Preț (€)"
                  value={
                    activeState.maxBudget || activeState.minBudget
                      ? `${activeState.maxBudget || activeState.minBudget} €`
                      : "-"
                  }
                  isEditing={false}
                  valueClassName="font-normal text-gray-900 tabular-nums"
                />
              )}

              <InlineDetailField
                label="TVA"
                value={activeState.tva || "-"}
                editValue={draft.tva}
                isEditing={isEditingPretConditii}
                onChange={(val) => setField("tva", val)}
                placeholder="Scutit de TVA / conform legislației în vigoare"
                valueClassName="font-normal text-gray-800"
              />
            </div>

            {isChirias ? (
              <>
                {/* Row 2 (Închiriere): Comision | Contract */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <InlineDetailField
                    label="Comision"
                    value={activeState.comision || "-"}
                    editValue={draft.comision}
                    isEditing={isEditingPretConditii}
                    onChange={(val) => setField("comision", val)}
                    placeholder="50%+TVA"
                    valueClassName="font-normal text-gray-800"
                  />

                  <InlineDetailField
                    label="Contract"
                    value={activeState.contractDurata || "-"}
                    editValue={draft.contractDurata}
                    isEditing={isEditingPretConditii}
                    onChange={(val) => setField("contractDurata", val)}
                    options={CONTRACT_DURATA_OPTIONS}
                    emptyOptionLabel="Selectează..."
                    valueClassName="font-normal text-gray-800"
                  />
                </div>

                {/* Row 3 (Închiriere): Avans | Garanție */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <InlineDetailField
                    label="Avans"
                    value={activeState.avans || "-"}
                    editValue={draft.avans}
                    isEditing={isEditingPretConditii}
                    onChange={(val) => setField("avans", val)}
                    options={AVANS_GARANTIE_OPTIONS}
                    emptyOptionLabel="Selectează..."
                    valueClassName="font-normal text-gray-800"
                  />

                  <InlineDetailField
                    label="Garanție"
                    value={activeState.garantie || "-"}
                    editValue={draft.garantie}
                    isEditing={isEditingPretConditii}
                    onChange={(val) => setField("garantie", val)}
                    options={AVANS_GARANTIE_OPTIONS}
                    emptyOptionLabel="Selectează..."
                    valueClassName="font-normal text-gray-800"
                  />
                </div>
              </>
            ) : (
              <>
                {/* Row 2 (Vânzare): Comision | Situație juridică */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <InlineDetailField
                    label="Comision"
                    value={activeState.comision || "-"}
                    editValue={draft.comision}
                    isEditing={isEditingPretConditii}
                    onChange={(val) => setField("comision", val)}
                    placeholder="0%"
                    valueClassName="font-normal text-gray-800"
                  />

                  <InlineDetailField
                    label="Situație juridică"
                    value={activeState.situatieJuridica || "-"}
                    editValue={draft.situatieJuridica}
                    isEditing={isEditingPretConditii}
                    onChange={(val) => setField("situatieJuridica", val)}
                    placeholder="Fara probleme"
                    valueClassName="font-normal text-gray-800"
                  />
                </div>

                {/* Row 3 (Vânzare): Disponibilitate (Tip achiziție acceptat moved to Informații Cumpărător) */}
                <InlineDetailField
                  label="Disponibilitate"
                  value={activeState.disponibilitate || "-"}
                  editValue={draft.disponibilitate}
                  isEditing={isEditingPretConditii}
                  onChange={(val) => setField("disponibilitate", val)}
                  placeholder="Imediată"
                  valueClassName="font-normal text-gray-800"
                />
              </>
            )}
          </div>
        </div>
      )}

      {/* SECTION 3 (Property mode only): Informații Generale */}
      {isPropertyMode && (
        <div
          id="sec-generale"
          className="p-4 sm:p-5 bg-white border border-gray-200 rounded-xl space-y-4 shadow-2xs scroll-mt-[104px]"
        >
          <SectionHeader
            icon={<FileText size={14} className="text-[#BE9662]" />}
            title={titles.generaleTitle}
            isEditing={isEditingGenerale}
            isSaving={savingSection === "generale"}
            onStartEdit={() => startEdit("generale")}
            onCancel={cancelEdit}
            onSave={() => void saveSection("generale")}
          />

          <div className="space-y-4">
            <InlineDetailField
              label="Titlu"
              value={activeState.propertyTitle || "-"}
              editValue={draft.propertyTitle}
              isEditing={isEditingGenerale}
              onChange={(val) => setField("propertyTitle", val)}
              placeholder="ex. Apartament 2 camere, decomandat, zonă centrală..."
              valueClassName="font-normal text-gray-900"
            />

            <InlineDetailField
              label="Descriere"
              value={activeState.requirements || "-"}
              editValue={draft.requirements}
              isEditing={isEditingGenerale}
              onChange={(val) => setField("requirements", val)}
              placeholder={descriptionPlaceholder}
              multiline
              rows={4}
              autoHeightMaxRows={12}
              valueClassName="font-normal text-gray-700"
            />
          </div>
        </div>
      )}

      {/* NEXT SECTION: Informații Apartament / Casă / Vilă / Teren / Spațiu Comercial */}
      <div
        id="sec-imobil"
        className="p-4 sm:p-5 bg-white border border-gray-200 rounded-xl space-y-4 shadow-2xs scroll-mt-[104px]"
      >
        <SectionHeader
          icon={<Home size={14} className="text-[#BE9662]" />}
          title={titles.imobilTitle}
          isEditing={isEditingImobil}
          isSaving={savingSection === "imobil"}
          onStartEdit={() => startEdit("imobil")}
          onCancel={cancelEdit}
          onSave={() => void saveSection("imobil")}
        />

        <div className="space-y-4">
          {/* Modalitate achiziție (Lead/Cerere Cumpărător only; Tip achiziție acceptat moved to Preț & Condiții for property mode) */}
          {!isPropertyMode && isCumparator && !isComercial && (
            <InlineDetailField
              label="Modalitate achiziție"
              value={activeState.modalitateAchizitie || "-"}
              editValue={draft.modalitateAchizitie}
              isEditing={isEditingImobil}
              onChange={(val) => setField("modalitateAchizitie", val)}
              options={MODALITATE_ACHIZITIE_OPTIONS}
              emptyOptionLabel="Selectează..."
              valueClassName="font-normal text-gray-800"
            />
          )}

          {/* Categorie / Compartimentare (Apartament & Casa/Vila) */}
          {(isApartament || isCasaVila) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {isEditingImobil ? (
                <div>
                  <label className="block text-[12px] leading-4 mb-1 font-semibold text-[#051D35]">
                    Categorie
                  </label>
                  <select
                    value={draft.buildingType}
                    onChange={(e) =>
                      handleBuildingTypeChange(e.target.value as BuildingCategoryType)
                    }
                    className={selectClass}
                  >
                    {BUILDING_CATEGORY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <InlineDetailField
                  label="Categorie"
                  value={BUILDING_TYPE_LABEL[activeState.buildingType]}
                  isEditing={false}
                  valueClassName="font-normal text-gray-800"
                />
              )}

              <InlineDetailField
                label="Compartimentare"
                value={activeState.compartimentare || "-"}
                editValue={draft.compartimentare}
                isEditing={isEditingImobil}
                onChange={(val) => setField("compartimentare", val)}
                options={COMPARTIMENTARE_OPTIONS}
                emptyOptionLabel="Selectează..."
                valueClassName="font-normal text-gray-800"
              />
            </div>
          )}

          {/* Tip imobil + Categorie / Clasificare (Teren) */}
          {isTeren && (
            <>
              {isEditingImobil ? (
                <div>
                  <label className="block text-[12px] leading-4 mb-1 font-semibold text-[#051D35]">
                    Tip imobil
                  </label>
                  <select
                    value={draft.buildingType}
                    onChange={(e) =>
                      handleBuildingTypeChange(e.target.value as BuildingCategoryType)
                    }
                    className={selectClass}
                  >
                    {BUILDING_CATEGORY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <InlineDetailField
                  label="Tip imobil"
                  value={BUILDING_TYPE_LABEL[activeState.buildingType]}
                  isEditing={false}
                  valueClassName="font-normal text-gray-800"
                />
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <InlineDetailField
                  label="Categorie"
                  value={activeState.terenCategorie || "-"}
                  editValue={draft.terenCategorie}
                  isEditing={isEditingImobil}
                  onChange={(val) => setField("terenCategorie", val)}
                  options={TEREN_CATEGORIE_OPTIONS}
                  valueClassName="font-normal text-gray-800"
                />

                <InlineDetailField
                  label="Clasificare"
                  value={activeState.terenClasificare || "-"}
                  editValue={draft.terenClasificare}
                  isEditing={isEditingImobil}
                  onChange={(val) => setField("terenClasificare", val)}
                  options={TEREN_CLASIFICARE_OPTIONS}
                  valueClassName="font-normal text-gray-800"
                />
              </div>
            </>
          )}

          {/* Tip imobil + Categorie / Compartimentare (Spațiu Comercial) */}
          {isComercial && (
            <>
              {isEditingImobil ? (
                <div>
                  <label className="block text-[12px] leading-4 mb-1 font-semibold text-[#051D35]">
                    Tip imobil
                  </label>
                  <select
                    value={draft.buildingType}
                    onChange={(e) =>
                      handleBuildingTypeChange(e.target.value as BuildingCategoryType)
                    }
                    className={selectClass}
                  >
                    {BUILDING_CATEGORY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <InlineDetailField
                  label="Tip imobil"
                  value={BUILDING_TYPE_LABEL[activeState.buildingType]}
                  isEditing={false}
                  valueClassName="font-normal text-gray-800"
                />
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <InlineDetailField
                  label="Categorie"
                  value={activeState.comercialCategorie || "-"}
                  editValue={draft.comercialCategorie}
                  isEditing={isEditingImobil}
                  onChange={(val) => setField("comercialCategorie", val)}
                  options={COMERCIAL_CATEGORIE_OPTIONS}
                  valueClassName="font-normal text-gray-800"
                />

                <InlineDetailField
                  label="Compartimentare"
                  value={activeState.compartimentare || "-"}
                  editValue={draft.compartimentare}
                  isEditing={isEditingImobil}
                  onChange={(val) => setField("compartimentare", val)}
                  options={COMPARTIMENTARE_OPTIONS}
                  emptyOptionLabel="Selectează..."
                  valueClassName="font-normal text-gray-800"
                />
              </div>
            </>
          )}

          {/* Non-Teren rows */}
          {!isTeren && (
            <>
              {/* Număr camere / Număr băi */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {isEditingImobil ? (
                  <MultiSelectDropdown
                    label="Număr camere"
                    options={NUMAR_CAMERE_OPTIONS}
                    selected={draft.selectedRooms}
                    onChange={(next) => setField("selectedRooms", next)}
                    isOpen={openMultiDropdown === "rooms"}
                    onToggleOpen={() =>
                      setOpenMultiDropdown((prev) => (prev === "rooms" ? null : "rooms"))
                    }
                    onClose={() =>
                      setOpenMultiDropdown((prev) => (prev === "rooms" ? null : prev))
                    }
                    disabled={savingSection === "imobil"}
                  />
                ) : (
                  <ReadOnlyTagsField label="Număr camere" items={activeState.selectedRooms} />
                )}

                {isEditingImobil ? (
                  <MultiSelectDropdown
                    label="Număr băi"
                    options={NUMAR_BAI_OPTIONS}
                    selected={draft.selectedBaths}
                    onChange={(next) => setField("selectedBaths", next)}
                    isOpen={openMultiDropdown === "baths"}
                    onToggleOpen={() =>
                      setOpenMultiDropdown((prev) => (prev === "baths" ? null : "baths"))
                    }
                    onClose={() =>
                      setOpenMultiDropdown((prev) => (prev === "baths" ? null : prev))
                    }
                    disabled={savingSection === "imobil"}
                  />
                ) : (
                  <ReadOnlyTagsField label="Număr băi" items={activeState.selectedBaths} />
                )}
              </div>

              {/* Etaje */}
              {isCasaVila ? (
                isEditingImobil ? (
                  <div className="space-y-2">
                    <label className="block text-[12px] leading-4 font-semibold text-[#051D35]">
                      Etaje
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      <label className="flex items-center gap-2 h-9 px-3 rounded-md border border-gray-200 bg-gray-50/90 text-xs text-gray-700 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={draft.casaSubsol}
                          onChange={(e) => setField("casaSubsol", e.target.checked)}
                          className="w-3.5 h-3.5 accent-[#051D35] cursor-pointer"
                        />
                        <span>Subsol</span>
                      </label>

                      <label className="flex items-center gap-2 h-9 px-3 rounded-md border border-gray-200 bg-gray-50/90 text-xs text-gray-700 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={draft.casaDemisol}
                          onChange={(e) => setField("casaDemisol", e.target.checked)}
                          className="w-3.5 h-3.5 accent-[#051D35] cursor-pointer"
                        />
                        <span>Demisol</span>
                      </label>

                      <label className="flex items-center gap-2 h-9 px-3 rounded-md border border-gray-200 bg-gray-100 text-xs text-gray-500 cursor-not-allowed select-none">
                        <input
                          type="checkbox"
                          checked
                          disabled
                          className="w-3.5 h-3.5 accent-[#051D35]"
                        />
                        <span>Parter</span>
                      </label>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-gray-600 mb-1">
                        Etaje peste parter
                      </label>
                      <select
                        value={draft.casaEtajePesteParter}
                        onChange={(e) => setField("casaEtajePesteParter", e.target.value)}
                        className={selectClass}
                      >
                        <option value="">Fără / Selectează...</option>
                        {ETAJE_PESTE_PARTER_OPTIONS.map((n) => (
                          <option key={n} value={n}>
                            {n} {n === "1" ? "etaj" : "etaje"}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ) : (
                  <InlineDetailField
                    label="Etaje"
                    value={casaFloorsSummary}
                    isEditing={false}
                    valueClassName="font-normal text-gray-800"
                  />
                )
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {isEditingImobil ? (
                    <MultiSelectDropdown
                      label={isComercial ? "Etaj" : "Etaj apartament"}
                      options={ETAJ_OPTIONS}
                      selected={draft.selectedFloors}
                      onChange={(next) => setField("selectedFloors", next)}
                      isOpen={openMultiDropdown === "floors"}
                      onToggleOpen={() =>
                        setOpenMultiDropdown((prev) => (prev === "floors" ? null : "floors"))
                      }
                      onClose={() =>
                        setOpenMultiDropdown((prev) => (prev === "floors" ? null : prev))
                      }
                      disabled={savingSection === "imobil"}
                    />
                  ) : (
                    <ReadOnlyTagsField
                      label={isComercial ? "Etaj" : "Etaj apartament"}
                      items={activeState.selectedFloors}
                    />
                  )}

                  {isEditingImobil ? (
                    <div>
                      <label className="block text-[12px] leading-4 mb-1 font-semibold text-[#051D35]">
                        {isComercial ? "Etaje total clădire" : "Etaje total bloc"}
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={60}
                        value={draft.totalFloors}
                        onChange={(e) => setField("totalFloors", e.target.value)}
                        placeholder="ex. 8"
                        className={inputClass}
                      />
                    </div>
                  ) : (
                    <InlineDetailField
                      label={isComercial ? "Etaje total clădire" : "Etaje total bloc"}
                      value={activeState.totalFloors || "-"}
                      isEditing={false}
                      valueClassName="font-normal text-gray-800 tabular-nums"
                    />
                  )}
                </div>
              )}

              {/* Mobilare / Utilare */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <InlineDetailField
                  label="Mobilare"
                  value={activeState.mobilare || "-"}
                  editValue={draft.mobilare}
                  isEditing={isEditingImobil}
                  onChange={(val) => setField("mobilare", val)}
                  options={MOBILARE_UTILARE_OPTIONS}
                  emptyOptionLabel="Selectează..."
                  valueClassName="font-normal text-gray-800"
                />

                <InlineDetailField
                  label="Utilare"
                  value={activeState.utilare || "-"}
                  editValue={draft.utilare}
                  isEditing={isEditingImobil}
                  onChange={(val) => setField("utilare", val)}
                  options={MOBILARE_UTILARE_OPTIONS}
                  emptyOptionLabel="Selectează..."
                  valueClassName="font-normal text-gray-800"
                />
              </div>

              {/* Tip parcare / Număr locuri parcare */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <InlineDetailField
                  label="Tip parcare"
                  value={activeState.tipParcare || "-"}
                  editValue={draft.tipParcare}
                  isEditing={isEditingImobil}
                  onChange={(val) => setField("tipParcare", val)}
                  options={TIP_PARCARE_OPTIONS}
                  emptyOptionLabel="Selectează..."
                  valueClassName="font-normal text-gray-800"
                />

                <InlineDetailField
                  label="Număr locuri parcare"
                  value={activeState.numarLocuriParcare || "-"}
                  editValue={draft.numarLocuriParcare}
                  isEditing={isEditingImobil}
                  onChange={(val) => setField("numarLocuriParcare", val)}
                  options={NUMAR_LOCURI_PARCARE_OPTIONS}
                  emptyOptionLabel="Selectează..."
                  valueClassName="font-normal text-gray-800"
                />
              </div>
            </>
          )}

          {/* Zonă / Zonă preferată */}
          {isEditingImobil ? (
            <TagMultiSelect
              label={zoneLabel}
              options={ZONA_OPTIONS}
              selected={draft.zoneList}
              onChange={(next) => setField("zoneList", next)}
              placeholder="Caută zonă..."
              requireQueryToOpen
              maxVisibleOptions={8}
              disabled={savingSection === "imobil"}
            />
          ) : (
            <ReadOnlyTagsField label={zoneLabel} items={activeState.zoneList} />
          )}

          {/* Descriere (lead) / Cerințe specifice (cerere) — moved to Informații Generale for property mode */}
          {!isPropertyMode && (
            <InlineDetailField
              label={descriptionLabel}
              value={activeState.requirements || "-"}
              editValue={draft.requirements}
              isEditing={isEditingImobil}
              onChange={(val) => setField("requirements", val)}
              placeholder={descriptionPlaceholder}
              multiline
              rows={3}
              autoHeightMaxRows={10}
              valueClassName="font-normal text-gray-700"
            />
          )}
        </div>
      </div>

      {/* SECTION 3: Informații Avansate */}
      <div
        id="sec-avansate"
        className="p-4 sm:p-5 bg-white border border-gray-200 rounded-xl space-y-4 shadow-2xs scroll-mt-[104px]"
      >
        <SectionHeader
          icon={<Layers size={14} className="text-[#BE9662]" />}
          title={titles.avansateTitle}
          isEditing={isEditingAvansate}
          isSaving={savingSection === "avansate"}
          onStartEdit={() => startEdit("avansate")}
          onCancel={cancelEdit}
          onSave={() => void saveSection("avansate")}
        />

        {isTeren ? (
          isPropertyMode ? (
            /* Property Teren: unite Suprafață (mp) / Front stradal (m) on one row */
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {isEditingAvansate ? (
                <div>
                  <label className="block text-[12px] leading-4 mb-1 font-semibold text-[#051D35]">
                    Suprafață (mp)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={draft.suprafataTerenMin || draft.suprafataTerenMax}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        suprafataTerenMin: e.target.value,
                        suprafataTerenMax: "",
                      }))
                    }
                    placeholder="ex. 1000"
                    className={inputClass}
                  />
                </div>
              ) : (
                <InlineDetailField
                  label="Suprafață (mp)"
                  value={
                    activeState.suprafataTerenMin || activeState.suprafataTerenMax
                      ? `${activeState.suprafataTerenMin || activeState.suprafataTerenMax} mp`
                      : "-"
                  }
                  isEditing={false}
                  valueClassName="font-normal text-gray-800 tabular-nums"
                />
              )}

              {isEditingAvansate ? (
                <div>
                  <label className="block text-[12px] leading-4 mb-1 font-semibold text-[#051D35]">
                    Front stradal (m)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={draft.frontStradal}
                    onChange={(e) => setField("frontStradal", e.target.value)}
                    placeholder="ex. 18"
                    className={inputClass}
                  />
                </div>
              ) : (
                <InlineDetailField
                  label="Front stradal (m)"
                  value={activeState.frontStradal ? `${activeState.frontStradal} m` : "-"}
                  isEditing={false}
                  valueClassName="font-normal text-gray-800 tabular-nums"
                />
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {isEditingAvansate ? (
                  <div>
                    <label className="block text-[12px] leading-4 mb-1 font-semibold text-[#051D35]">
                      Suprafață minimă (mp)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={draft.suprafataTerenMin}
                      onChange={(e) => setField("suprafataTerenMin", e.target.value)}
                      placeholder="ex. 500"
                      className={inputClass}
                    />
                  </div>
                ) : (
                  <InlineDetailField
                    label="Suprafață minimă (mp)"
                    value={activeState.suprafataTerenMin ? `${activeState.suprafataTerenMin} mp` : "-"}
                    isEditing={false}
                    valueClassName="font-normal text-gray-800 tabular-nums"
                  />
                )}

                {isEditingAvansate ? (
                  <div>
                    <label className="block text-[12px] leading-4 mb-1 font-semibold text-[#051D35]">
                      Suprafață maximă (mp)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={draft.suprafataTerenMax}
                      onChange={(e) => setField("suprafataTerenMax", e.target.value)}
                      placeholder="ex. 2000"
                      className={inputClass}
                    />
                  </div>
                ) : (
                  <InlineDetailField
                    label="Suprafață maximă (mp)"
                    value={activeState.suprafataTerenMax ? `${activeState.suprafataTerenMax} mp` : "-"}
                    isEditing={false}
                    valueClassName="font-normal text-gray-800 tabular-nums"
                  />
                )}
              </div>

              {isEditingAvansate ? (
                <div>
                  <label className="block text-[12px] leading-4 mb-1 font-semibold text-[#051D35]">
                    Front stradal (m)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={draft.frontStradal}
                    onChange={(e) => setField("frontStradal", e.target.value)}
                    placeholder="ex. 18"
                    className={inputClass}
                  />
                </div>
              ) : (
                <InlineDetailField
                  label="Front stradal (m)"
                  value={activeState.frontStradal ? `${activeState.frontStradal} m` : "-"}
                  isEditing={false}
                  valueClassName="font-normal text-gray-800 tabular-nums"
                />
              )}
            </div>
          )
        ) : isPropertyMode ? (
          <div className="space-y-4">
            {/* Property Non-Teren Row 1: Suprafață utilă / Suprafață construită */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {isEditingAvansate ? (
                <div>
                  <label className="block text-[12px] leading-4 mb-1 font-semibold text-[#051D35]">
                    Suprafață utilă (mp)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={draft.suprafataUtilaMin || draft.suprafataUtilaMax}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        suprafataUtilaMin: e.target.value,
                        suprafataUtilaMax: "",
                      }))
                    }
                    placeholder="ex. 65"
                    className={inputClass}
                  />
                </div>
              ) : (
                <InlineDetailField
                  label="Suprafață utilă (mp)"
                  value={
                    activeState.suprafataUtilaMin || activeState.suprafataUtilaMax
                      ? `${activeState.suprafataUtilaMin || activeState.suprafataUtilaMax} mp`
                      : "-"
                  }
                  isEditing={false}
                  valueClassName="font-normal text-gray-800 tabular-nums"
                />
              )}

              {isEditingAvansate ? (
                <div>
                  <label className="block text-[12px] leading-4 mb-1 font-semibold text-[#051D35]">
                    Suprafață construită (mp)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={draft.suprafataConstruitaMin || draft.suprafataConstruitaMax}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        suprafataConstruitaMin: e.target.value,
                        suprafataConstruitaMax: "",
                      }))
                    }
                    placeholder="ex. 78"
                    className={inputClass}
                  />
                </div>
              ) : (
                <InlineDetailField
                  label="Suprafață construită (mp)"
                  value={
                    activeState.suprafataConstruitaMin || activeState.suprafataConstruitaMax
                      ? `${activeState.suprafataConstruitaMin || activeState.suprafataConstruitaMax} mp`
                      : "-"
                  }
                  isEditing={false}
                  valueClassName="font-normal text-gray-800 tabular-nums"
                />
              )}
            </div>

            {/* Property Non-Teren Row 2: Casa/Vila -> Suprafață curte / Anul construcției; Others -> Anul construcției */}
            {isCasaVila ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {isEditingAvansate ? (
                  <div>
                    <label className="block text-[12px] leading-4 mb-1 font-semibold text-[#051D35]">
                      Suprafață curte (mp)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={draft.suprafataCurteMin || draft.suprafataCurteMax}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          suprafataCurteMin: e.target.value,
                          suprafataCurteMax: "",
                        }))
                      }
                      placeholder="ex. 250"
                      className={inputClass}
                    />
                  </div>
                ) : (
                  <InlineDetailField
                    label="Suprafață curte (mp)"
                    value={
                      activeState.suprafataCurteMin || activeState.suprafataCurteMax
                        ? `${activeState.suprafataCurteMin || activeState.suprafataCurteMax} mp`
                        : "-"
                    }
                    isEditing={false}
                    valueClassName="font-normal text-gray-800 tabular-nums"
                  />
                )}

                {isEditingAvansate ? (
                  <div>
                    <label className="block text-[12px] leading-4 mb-1 font-semibold text-[#051D35]">
                      Anul construcției
                    </label>
                    <input
                      type="number"
                      min={1900}
                      max={2035}
                      value={draft.anConstructieMin || draft.anConstructieMax}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          anConstructieMin: e.target.value,
                          anConstructieMax: "",
                        }))
                      }
                      placeholder="ex. 2018"
                      className={inputClass}
                    />
                  </div>
                ) : (
                  <InlineDetailField
                    label="Anul construcției"
                    value={activeState.anConstructieMin || activeState.anConstructieMax || "-"}
                    isEditing={false}
                    valueClassName="font-normal text-gray-800 tabular-nums"
                  />
                )}
              </div>
            ) : isEditingAvansate ? (
              <div>
                <label className="block text-[12px] leading-4 mb-1 font-semibold text-[#051D35]">
                  Anul construcției
                </label>
                <input
                  type="number"
                  min={1900}
                  max={2035}
                  value={draft.anConstructieMin || draft.anConstructieMax}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      anConstructieMin: e.target.value,
                      anConstructieMax: "",
                    }))
                  }
                  placeholder="ex. 2018"
                  className={inputClass}
                />
              </div>
            ) : (
              <InlineDetailField
                label="Anul construcției"
                value={activeState.anConstructieMin || activeState.anConstructieMax || "-"}
                isEditing={false}
                valueClassName="font-normal text-gray-800 tabular-nums"
              />
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Row 1: Anul construcției minim / maxim */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {isEditingAvansate ? (
                <div>
                  <label className="block text-[12px] leading-4 mb-1 font-semibold text-[#051D35]">
                    Anul construcției minim
                  </label>
                  <input
                    type="number"
                    min={1900}
                    max={2035}
                    value={draft.anConstructieMin}
                    onChange={(e) => setField("anConstructieMin", e.target.value)}
                    placeholder="ex. 2005"
                    className={inputClass}
                  />
                </div>
              ) : (
                <InlineDetailField
                  label="Anul construcției minim"
                  value={activeState.anConstructieMin || "-"}
                  isEditing={false}
                  valueClassName="font-normal text-gray-800 tabular-nums"
                />
              )}

              {isEditingAvansate ? (
                <div>
                  <label className="block text-[12px] leading-4 mb-1 font-semibold text-[#051D35]">
                    Anul construcției maxim
                  </label>
                  <input
                    type="number"
                    min={1900}
                    max={2035}
                    value={draft.anConstructieMax}
                    onChange={(e) => setField("anConstructieMax", e.target.value)}
                    placeholder="ex. 2025"
                    className={inputClass}
                  />
                </div>
              ) : (
                <InlineDetailField
                  label="Anul construcției maxim"
                  value={activeState.anConstructieMax || "-"}
                  isEditing={false}
                  valueClassName="font-normal text-gray-800 tabular-nums"
                />
              )}
            </div>

            {/* Row 2: Suprafață utilă minimă / maximă */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {isEditingAvansate ? (
                <div>
                  <label className="block text-[12px] leading-4 mb-1 font-semibold text-[#051D35]">
                    Suprafață utilă minimă (mp)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={draft.suprafataUtilaMin}
                    onChange={(e) => setField("suprafataUtilaMin", e.target.value)}
                    placeholder="ex. 50"
                    className={inputClass}
                  />
                </div>
              ) : (
                <InlineDetailField
                  label="Suprafață utilă minimă (mp)"
                  value={activeState.suprafataUtilaMin ? `${activeState.suprafataUtilaMin} mp` : "-"}
                  isEditing={false}
                  valueClassName="font-normal text-gray-800 tabular-nums"
                />
              )}

              {isEditingAvansate ? (
                <div>
                  <label className="block text-[12px] leading-4 mb-1 font-semibold text-[#051D35]">
                    Suprafață utilă maximă (mp)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={draft.suprafataUtilaMax}
                    onChange={(e) => setField("suprafataUtilaMax", e.target.value)}
                    placeholder="ex. 90"
                    className={inputClass}
                  />
                </div>
              ) : (
                <InlineDetailField
                  label="Suprafață utilă maximă (mp)"
                  value={activeState.suprafataUtilaMax ? `${activeState.suprafataUtilaMax} mp` : "-"}
                  isEditing={false}
                  valueClassName="font-normal text-gray-800 tabular-nums"
                />
              )}
            </div>

            {/* Row 3: Suprafață construită minimă / maximă */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {isEditingAvansate ? (
                <div>
                  <label className="block text-[12px] leading-4 mb-1 font-semibold text-[#051D35]">
                    Suprafață construită minimă (mp)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={draft.suprafataConstruitaMin}
                    onChange={(e) => setField("suprafataConstruitaMin", e.target.value)}
                    placeholder="ex. 60"
                    className={inputClass}
                  />
                </div>
              ) : (
                <InlineDetailField
                  label="Suprafață construită minimă (mp)"
                  value={
                    activeState.suprafataConstruitaMin
                      ? `${activeState.suprafataConstruitaMin} mp`
                      : "-"
                  }
                  isEditing={false}
                  valueClassName="font-normal text-gray-800 tabular-nums"
                />
              )}

              {isEditingAvansate ? (
                <div>
                  <label className="block text-[12px] leading-4 mb-1 font-semibold text-[#051D35]">
                    Suprafață construită maximă (mp)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={draft.suprafataConstruitaMax}
                    onChange={(e) => setField("suprafataConstruitaMax", e.target.value)}
                    placeholder="ex. 110"
                    className={inputClass}
                  />
                </div>
              ) : (
                <InlineDetailField
                  label="Suprafață construită maximă (mp)"
                  value={
                    activeState.suprafataConstruitaMax
                      ? `${activeState.suprafataConstruitaMax} mp`
                      : "-"
                  }
                  isEditing={false}
                  valueClassName="font-normal text-gray-800 tabular-nums"
                />
              )}
            </div>

            {/* Row 4 (Casa/Vila only): Suprafață curte minimă / maximă */}
            {isCasaVila && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {isEditingAvansate ? (
                  <div>
                    <label className="block text-[12px] leading-4 mb-1 font-semibold text-[#051D35]">
                      Suprafață curte minimă (mp)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={draft.suprafataCurteMin}
                      onChange={(e) => setField("suprafataCurteMin", e.target.value)}
                      placeholder="ex. 150"
                      className={inputClass}
                    />
                  </div>
                ) : (
                  <InlineDetailField
                    label="Suprafață curte minimă (mp)"
                    value={
                      activeState.suprafataCurteMin ? `${activeState.suprafataCurteMin} mp` : "-"
                    }
                    isEditing={false}
                    valueClassName="font-normal text-gray-800 tabular-nums"
                  />
                )}

                {isEditingAvansate ? (
                  <div>
                    <label className="block text-[12px] leading-4 mb-1 font-semibold text-[#051D35]">
                      Suprafață curte maximă (mp)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={draft.suprafataCurteMax}
                      onChange={(e) => setField("suprafataCurteMax", e.target.value)}
                      placeholder="ex. 500"
                      className={inputClass}
                    />
                  </div>
                ) : (
                  <InlineDetailField
                    label="Suprafață curte maximă (mp)"
                    value={
                      activeState.suprafataCurteMax ? `${activeState.suprafataCurteMax} mp` : "-"
                    }
                    isEditing={false}
                    valueClassName="font-normal text-gray-800 tabular-nums"
                  />
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* SECTION 4: Alte Informații */}
      <div
        id="sec-alte"
        className="p-4 sm:p-5 bg-white border border-gray-200 rounded-xl space-y-4 shadow-2xs scroll-mt-[104px]"
      >
        <SectionHeader
          icon={<Sparkles size={14} className="text-[#BE9662]" />}
          title={titles.alteTitle}
          isEditing={isEditingAlte}
          isSaving={savingSection === "alte"}
          onStartEdit={() => startEdit("alte")}
          onCancel={cancelEdit}
          onSave={() => void saveSection("alte")}
        />

        {isTeren ? (
          isEditingAlte ? (
            <TagMultiSelect
              label="Utilități"
              options={UTILITATI_TEREN_OPTIONS}
              selected={draft.utilitati}
              onChange={(next) => setField("utilitati", next)}
              placeholder="Selectează utilități..."
              disabled={savingSection === "alte"}
            />
          ) : (
            <ReadOnlyTagsField label="Utilități" items={activeState.utilitati} />
          )
        ) : (
          <div className="space-y-4">
            {/* Row 1: Stare interior */}
            <InlineDetailField
              label="Stare interior"
              value={activeState.stareInterior || "-"}
              editValue={draft.stareInterior}
              isEditing={isEditingAlte}
              onChange={(val) => setField("stareInterior", val)}
              options={STARE_INTERIOR_OPTIONS}
              emptyOptionLabel="Selectează..."
              valueClassName="font-normal text-gray-800"
            />

            {/* Row 2: Sistem încălzire / Metodă încălzire */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InlineDetailField
                label="Sistem încălzire"
                value={activeState.sistemIncalzire || "-"}
                editValue={draft.sistemIncalzire}
                isEditing={isEditingAlte}
                onChange={(val) => setField("sistemIncalzire", val)}
                options={SISTEM_INCALZIRE_OPTIONS}
                emptyOptionLabel="Selectează..."
                valueClassName="font-normal text-gray-800"
              />

              <InlineDetailField
                label="Metodă încălzire"
                value={activeState.metodaIncalzire || "-"}
                editValue={draft.metodaIncalzire}
                isEditing={isEditingAlte}
                onChange={(val) => setField("metodaIncalzire", val)}
                options={METODA_INCALZIRE_OPTIONS}
                emptyOptionLabel="Selectează..."
                valueClassName="font-normal text-gray-800"
              />
            </div>

            {/* Row 3: Lift */}
            <InlineDetailField
              label="Lift"
              value={activeState.lift || "-"}
              editValue={draft.lift}
              isEditing={isEditingAlte}
              onChange={(val) => setField("lift", val)}
              options={LIFT_OPTIONS}
              emptyOptionLabel="Selectează..."
              valueClassName="font-normal text-gray-800"
            />

            {/* Row 4: Grădină / Balcoane, terase, logii */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InlineDetailField
                label="Grădină"
                value={activeState.gradina || "-"}
                editValue={draft.gradina}
                isEditing={isEditingAlte}
                onChange={(val) => setField("gradina", val)}
                options={GRADINA_OPTIONS}
                emptyOptionLabel="Selectează..."
                valueClassName="font-normal text-gray-800"
              />

              {isEditingAlte ? (
                <MultiSelectDropdown
                  label="Balcoane, terase, logii"
                  options={BALCOANE_TERASE_LOGII_OPTIONS}
                  selected={draft.balcoaneTeraseLogii}
                  onChange={(next) => setField("balcoaneTeraseLogii", next)}
                  isOpen={openMultiDropdown === "balcoane"}
                  onToggleOpen={() =>
                    setOpenMultiDropdown((prev) => (prev === "balcoane" ? null : "balcoane"))
                  }
                  onClose={() =>
                    setOpenMultiDropdown((prev) => (prev === "balcoane" ? null : prev))
                  }
                  disabled={savingSection === "alte"}
                />
              ) : (
                <ReadOnlyTagsField
                  label="Balcoane, terase, logii"
                  items={activeState.balcoaneTeraseLogii}
                />
              )}
            </div>

            {/* Row 5: Utilități */}
            {isEditingAlte ? (
              <TagMultiSelect
                label="Utilități"
                options={UTILITATI_STANDARD_OPTIONS}
                selected={draft.utilitati}
                onChange={(next) => setField("utilitati", next)}
                placeholder="Selectează utilități..."
                disabled={savingSection === "alte"}
              />
            ) : (
              <ReadOnlyTagsField label="Utilități" items={activeState.utilitati} />
            )}

            {/* Row 6: Servicii imobil */}
            {isEditingAlte ? (
              <TagMultiSelect
                label="Servicii imobil"
                options={SERVICII_IMOBIL_OPTIONS}
                selected={draft.serviciiImobil}
                onChange={(next) => setField("serviciiImobil", next)}
                placeholder="Selectează servicii..."
                disabled={savingSection === "alte"}
              />
            ) : (
              <ReadOnlyTagsField label="Servicii imobil" items={activeState.serviciiImobil} />
            )}
          </div>
        )}
      </div>
    </div>
  );
};
