import {
  extractNormalizedCategory,
  extractNormalizedCompartimentare,
  extractNormalizedConstructieBuckets,
  extractNormalizedFloor,
  extractNormalizedRooms,
  extractNumericPrice,
  extractNumericSurface,
  normalizeRoText,
} from "../../utils/olxFilterUtils";
import { toDisplayLeadStatus } from "./svc_crm-normalizer";
import { isDailyLeadId } from "../../utils/leadIdUtils";

export const LEAD_SUMMARY_COLLECTION = "leads_summary";
export const SHARED_LEADS_SUMMARY_COLLECTION = "platform_shared_leads_summary";
export const MAX_SUMMARY_BYTES = 2560; // 2.5 KB hard cap (50 leads <= 125 KB)
export const MAX_SEARCH_TOKENS = 30;

export const PRIVATE_SUMMARY_EXCLUDED_FIELDS = [
  "images",
  "extractedData",
  "notes",
  "memoPrivat",
  "notePrivate",
  "rawHtml",
  "description",
  "originalDescription",
  "markdownMarketing",
] as const;

export type LeadSummaryEntityKind = "lead" | "property" | "cerere";

export interface LeadSummary {
  id: string;
  tenantId?: string;
  propertyId: string;
  sourcePropertyId?: string;
  sharedLeadId?: string;
  url: string;
  title: string;
  zone: string;
  city: string;
  price: string;
  priceNumeric: number;
  currency: "EUR" | "RON";
  transactionType: "Vânzare" | "Închiriere";
  categoria: string;
  status: string;
  leadType: string;
  entityKind: LeadSummaryEntityKind;
  rooms: string;
  usefulArea: number;
  compartimentare: string;
  floor: string;
  constructieBuckets: string[];
  olxCategoryId?: number;
  coverThumbUrl: string;
  ownerName: string;
  ownerPhone: string;
  agent: string;
  agentUid: string;
  author: string;
  source: string;
  isSharedLead: boolean;
  publishedAt: string;
  createdAt: string;
  updatedAt: string;
  lastMovedAt: string;
  deletedAt: string | null;
  docVersion: number;
  searchTokens: string[];
  isSummary: true;
}

let slimSummaryReadsOverrideForTests: boolean | null = null;

export function setSlimSummaryReadsOverrideForTests(enabled: boolean | null): void {
  slimSummaryReadsOverrideForTests = enabled;
}

/**
 * Feature flag controlling Phase 2 read cutover to slim summary collections
 * (`leads_summary` and `platform_shared_leads_summary`).
 * Defaults to `false` for safe expand-and-contract deployment:
 * dual-write is always active; setting `VITE_USE_SLIM_SUMMARY_READS=true` (or
 * `USE_SLIM_SUMMARY_READS=true` server-side) activates slim list reads with
 * instant zero-deploy rollback.
 */
export function isSlimSummaryReadsEnabled(): boolean {
  if (slimSummaryReadsOverrideForTests !== null) {
    return slimSummaryReadsOverrideForTests;
  }
  try {
    const viteFlag = (import.meta as any)?.env?.VITE_USE_SLIM_SUMMARY_READS;
    if (viteFlag !== undefined && viteFlag !== "") {
      return String(viteFlag).toLowerCase() === "true";
    }
  } catch {
    // ignore outside Vite
  }
  if (typeof process !== "undefined" && process.env) {
    const envFlag =
      process.env.VITE_USE_SLIM_SUMMARY_READS ?? process.env.USE_SLIM_SUMMARY_READS;
    if (envFlag !== undefined && envFlag !== "") {
      return String(envFlag).toLowerCase() === "true";
    }
  }
  return false;
}

function clampString(val: unknown, maxLen: number, fallback = ""): string {
  if (val === null || val === undefined) return fallback;
  const s = String(val).replace(/\s+/g, " ").trim();
  if (!s) return fallback;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function toIsoStringSafe(raw: unknown, fallback = ""): string {
  if (raw === null || raw === undefined || raw === "") return fallback;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return fallback;
    const ms = Date.parse(trimmed);
    return Number.isNaN(ms) ? trimmed.slice(0, 64) : new Date(ms).toISOString();
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return new Date(raw).toISOString();
  }
  if (typeof raw === "object") {
    const obj = raw as Record<string, any>;
    if (typeof obj.toDate === "function") {
      try {
        return obj.toDate().toISOString();
      } catch {
        return fallback;
      }
    }
    if (typeof obj.toMillis === "function") {
      try {
        return new Date(obj.toMillis()).toISOString();
      } catch {
        return fallback;
      }
    }
    if (typeof obj.seconds === "number") {
      const ms = obj.seconds * 1000 + Math.floor((obj.nanoseconds || 0) / 1e6);
      return new Date(ms).toISOString();
    }
  }
  return fallback;
}

function resolveCoverThumbUrl(canonical: Record<string, any>): string {
  const direct =
    typeof canonical.coverThumbUrl === "string" && canonical.coverThumbUrl.trim()
      ? canonical.coverThumbUrl.trim()
      : typeof canonical.coverImage === "string" && canonical.coverImage.trim()
      ? canonical.coverImage.trim()
      : "";
  if (direct) return direct.slice(0, 512);

  if (Array.isArray(canonical.images) && canonical.images.length > 0) {
    const first = canonical.images[0];
    if (typeof first === "string" && first.trim()) return first.trim().slice(0, 512);
    if (first && typeof first === "object" && typeof first.original === "string") {
      return first.original.trim().slice(0, 512);
    }
  }

  const crmImgs = canonical.extractedData?.crmData?.imagini;
  if (crmImgs && typeof crmImgs === "object") {
    const groups = ["living", "camera", "bucatarie", "baie", "alteSpatii"];
    for (const g of groups) {
      const arr = crmImgs[g];
      if (Array.isArray(arr) && arr.length > 0) {
        const first = arr[0];
        if (typeof first === "string" && first.trim()) return first.trim().slice(0, 512);
        if (first && typeof first === "object" && typeof first.original === "string") {
          return first.original.trim().slice(0, 512);
        }
      }
    }
  }

  return "";
}

function detectEntityKind(canonical: Record<string, any>, status: string): LeadSummaryEntityKind {
  const propId = String(canonical.propertyId || "").trim().toUpperCase();
  if (propId.startsWith("R") || propId.startsWith("C")) return "cerere";
  if (propId.startsWith("P")) return "property";
  if (propId.startsWith("L") || isDailyLeadId(propId)) return "lead";

  if (
    status === "AreInteres" ||
    status === "Calificare" ||
    status === "Matching" ||
    String(canonical.title || "").toLowerCase().startsWith("cerere")
  ) {
    return "cerere";
  }

  if (
    status === "Noi" ||
    status === "ListaMea" ||
    status === "Pierdute" ||
    status === "Nevalidata" ||
    status === "Calificata" ||
    canonical.isSharedLead === true
  ) {
    return "lead";
  }

  return "property";
}

function buildSearchTokens(parts: Array<unknown>, maxTokens = MAX_SEARCH_TOKENS): string[] {
  const tokenSet = new Set<string>();
  for (const part of parts) {
    if (part === null || part === undefined) continue;
    const norm = normalizeRoText(part);
    if (!norm) continue;
    const words = norm.split(/[^a-z0-9]+/).filter(Boolean);
    for (const w of words) {
      if (w.length < 2) continue;
      tokenSet.add(w.slice(0, 24));
      if (tokenSet.size >= maxTokens) {
        return Array.from(tokenSet);
      }
    }
  }
  return Array.from(tokenSet);
}

export function estimateUtf8Bytes(value: unknown): number {
  const json = JSON.stringify(value);
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(json).length;
  }
  // Pure fallback UTF-8 byte counter
  let bytes = 0;
  for (let i = 0; i < json.length; i++) {
    const code = json.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * Pure, deterministic projection builder from a canonical `leads` or `platform_shared_leads`
 * document to a slim, list/filter/card-ready `LeadSummary` guaranteed to be <= 2.5 KB.
 * Strictly strips heavy and private fields (`images`, `extractedData`, `notes`, `memoPrivat`, `notePrivate`).
 */
export function projectLeadToSummary(
  canonical: Record<string, any>,
  opts?: {
    tenantId?: string;
    isSharedLead?: boolean;
    docVersion?: number;
  }
): LeadSummary {
  const id = clampString(canonical?.id, 128);
  const rawTenantId = opts?.tenantId ?? canonical?.tenantId ?? canonical?.tenant_id;
  const tenantId = rawTenantId ? clampString(rawTenantId, 128) : undefined;
  const isSharedLead = Boolean(opts?.isSharedLead ?? canonical?.isSharedLead ?? false);

  const normalizedStatus =
    toDisplayLeadStatus(String(canonical?.status || (isSharedLead ? "Noi" : "Noua"))) ||
    clampString(canonical?.status, 48, isSharedLead ? "Noi" : "Noua");

  const rawPrice = clampString(
    canonical?.price || canonical?.extractedData?.crmData?.pret?.detalii?.pret,
    48,
    "N/A"
  );
  const priceNumeric = extractNumericPrice(canonical);
  const lowerPrice = rawPrice.toLowerCase();
  const currency: "EUR" | "RON" =
    lowerPrice.includes("ron") || lowerPrice.includes("lei") ? "RON" : "EUR";

  const rawTx = normalizeRoText(
    canonical?.transactionType ||
      canonical?.extractedData?.crmData?.detaliiGenerale?.tranzactie ||
      ""
  );
  const transactionType: "Vânzare" | "Închiriere" =
    rawTx.includes("vanz") ? "Vânzare" : "Închiriere";

  const title = clampString(
    canonical?.title || canonical?.extractedData?.crmData?.descriere?.titlu,
    180,
    "Proprietate"
  );
  const zone = clampString(
    canonical?.zone ||
      (Array.isArray(canonical?.extractedData?.crmData?.detaliiGenerale?.localizare?.zona)
        ? canonical.extractedData.crmData.detaliiGenerale.localizare.zona[0]
        : ""),
    100,
    ""
  );
  const city = clampString(
    canonical?.city ||
      canonical?.extractedData?.crmData?.detaliiGenerale?.localizare?.oras ||
      "București",
    64,
    "București"
  );

  const categoria = clampString(
    extractNormalizedCategory(canonical) || canonical?.categoria,
    64,
    "Apartament"
  );
  const propertyId = clampString(canonical?.propertyId, 64, "");
  const sourcePropertyId = canonical?.sourcePropertyId
    ? clampString(canonical.sourcePropertyId, 64)
    : undefined;
  const sharedLeadId = canonical?.sharedLeadId
    ? clampString(canonical.sharedLeadId, 128)
    : undefined;

  const rooms = clampString(extractNormalizedRooms(canonical), 16, "");
  const usefulArea = Math.round(extractNumericSurface(canonical) * 100) / 100;
  const compartimentare = clampString(extractNormalizedCompartimentare(canonical), 32, "");
  const floor = clampString(extractNormalizedFloor(canonical), 24, "");
  const constructieBuckets = extractNormalizedConstructieBuckets(canonical).slice(0, 4);
  const rawOlxCat = Number(
    canonical?.olxCategoryId ?? canonical?.extractedData?.olxMeta?.categoryId ?? 0
  );
  const olxCategoryId = Number.isFinite(rawOlxCat) && rawOlxCat > 0 ? Math.floor(rawOlxCat) : undefined;

  const entityKind = detectEntityKind(canonical || {}, normalizedStatus);
  const nowFallback = "1970-01-01T00:00:00.000Z";
  const createdAt = toIsoStringSafe(canonical?.createdAt, nowFallback);
  const updatedAt = toIsoStringSafe(canonical?.updatedAt, createdAt);
  const lastMovedAt = toIsoStringSafe(canonical?.lastMovedAt, updatedAt);
  const publishedAt = toIsoStringSafe(
    canonical?.publishedAt ||
      canonical?.extractedData?.olxMeta?.publishedAt ||
      canonical?.extractedData?.olxMeta?.createdTime,
    createdAt
  );

  const deletedAt =
    normalizedStatus === "Sterse"
      ? toIsoStringSafe(canonical?.deletedAt, updatedAt)
      : null;

  const rawVersion = Number(opts?.docVersion ?? canonical?.docVersion ?? 1);
  const docVersion =
    Number.isFinite(rawVersion) && rawVersion >= 1 ? Math.floor(rawVersion) : 1;

  const ownerName = clampString(canonical?.ownerName, 80, "");
  const ownerPhone = clampString(canonical?.ownerPhone, 32, "");
  const agent = clampString(canonical?.agent || canonical?.author || canonical?.createdByName, 80, "");
  const agentUid = clampString(canonical?.agentUid || canonical?.createdByUid, 128, "");
  const author = clampString(canonical?.author || canonical?.createdByName || agent, 80, "");
  const source = clampString(canonical?.source, 64, "");
  const url = clampString(canonical?.url, 512, "");
  const coverThumbUrl = resolveCoverThumbUrl(canonical || {});

  const rawSearchParts: Array<unknown> = [
    propertyId,
    sourcePropertyId,
    title,
    zone,
    city,
    categoria,
    transactionType,
    ownerName,
    ownerPhone,
    agent,
    rooms ? `${rooms} camere` : "",
    compartimentare,
    ...(Array.isArray(canonical?.extractedData?.crmData?.detaliiGenerale?.localizare?.zona)
      ? canonical.extractedData.crmData.detaliiGenerale.localizare.zona
      : []),
  ];

  const searchTokens = buildSearchTokens(rawSearchParts, MAX_SEARCH_TOKENS);

  const summary: LeadSummary = {
    id,
    ...(tenantId && !isSharedLead ? { tenantId } : {}),
    propertyId,
    ...(sourcePropertyId ? { sourcePropertyId } : {}),
    ...(sharedLeadId ? { sharedLeadId } : {}),
    url,
    title,
    zone,
    city,
    price: rawPrice,
    priceNumeric,
    currency,
    transactionType,
    categoria,
    status: normalizedStatus,
    leadType: clampString(canonical?.leadType, 32, entityKind === "cerere" ? "" : "Proprietar"),
    entityKind,
    rooms,
    usefulArea,
    compartimentare,
    floor,
    constructieBuckets,
    ...(olxCategoryId ? { olxCategoryId } : {}),
    coverThumbUrl,
    ownerName,
    ownerPhone,
    agent,
    agentUid,
    author,
    source,
    isSharedLead,
    publishedAt,
    createdAt,
    updatedAt,
    lastMovedAt,
    deletedAt,
    docVersion,
    searchTokens,
    isSummary: true,
  };

  // Enforce strict <= 2.5 KB UTF-8 ceiling deterministically
  if (estimateUtf8Bytes(summary) > MAX_SUMMARY_BYTES) {
    summary.url = summary.url.slice(0, 240);
    summary.coverThumbUrl = summary.coverThumbUrl.slice(0, 240);
    summary.title = summary.title.slice(0, 120);
    while (summary.searchTokens.length > 0 && estimateUtf8Bytes(summary) > MAX_SUMMARY_BYTES) {
      summary.searchTokens.pop();
    }
  }

  return summary;
}

/**
 * Adapts a `LeadSummary` document into a `Lead`-compatible list/card object for UI consumers
 * (`LeadCard`, `LeadList`, `olxFilterUtils`, `agencyMarketService`) while marking `isSummary: true`
 * so detail views know to lazily hydrate the full canonical document on open.
 */
export function summaryToLeadRecord<T extends Record<string, any> = Record<string, any>>(
  summary: LeadSummary & Record<string, any>
): T {
  const coverImage = summary.coverThumbUrl || summary.coverImage || undefined;
  return {
    ...summary,
    coverImage,
    camere: summary.rooms || undefined,
    suprafataUtila: summary.usefulArea || undefined,
    isSummary: true,
  } as unknown as T;
}

/**
 * Returns true if the given lead object is a slim summary projection that has not yet been
 * hydrated with the full canonical document (`extractedData` / `images` / `notes`).
 */
export function isSummaryLeadRecord(lead: unknown): boolean {
  if (!lead || typeof lead !== "object") return false;
  const rec = lead as Record<string, any>;
  if (rec.isSummary === true && !rec.extractedData) {
    return true;
  }
  return false;
}

/**
 * Pure, deterministic checksum across all critical summary fields for parity reconciliation
 * between canonical `leads` and `leads_summary` (and `platform_shared_leads` vs summary).
 */
export function computeSummaryParityChecksum(summary: LeadSummary): string {
  const canonicalPayload = JSON.stringify([
    summary.id || "",
    summary.tenantId || "",
    summary.propertyId || "",
    summary.title || "",
    summary.zone || "",
    summary.city || "",
    summary.price || "",
    summary.priceNumeric || 0,
    summary.transactionType || "",
    summary.categoria || "",
    summary.status || "",
    summary.entityKind || "",
    summary.rooms || "",
    summary.usefulArea || 0,
    summary.compartimentare || "",
    summary.floor || "",
    [...(summary.constructieBuckets || [])].sort(),
    summary.coverThumbUrl || "",
    summary.ownerName || "",
    summary.ownerPhone || "",
    summary.agent || "",
    summary.deletedAt || null,
    summary.docVersion || 1,
  ]);

  // Dual 32-bit FNV-1a for collision-resistant deterministic 16-char hex digest (browser & Node safe)
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < canonicalPayload.length; i++) {
    const ch = canonicalPayload.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch + ((i & 0xff) << 1);
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  const p1 = (h1 >>> 0).toString(16).padStart(8, "0");
  const p2 = (h2 >>> 0).toString(16).padStart(8, "0");
  return `${p1}${p2}`;
}
