import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db, handleFirestoreError, OperationType } from "../lib/firebase";
import { crmApiClient } from "../core/crm/svc_crm-client";
import {
  DEFAULT_OLX_LEAD_FILTERS,
  matchesOlxLeadFilter,
  type OlxLeadFilters,
} from "../utils/olxFilterUtils";
import {
  DEFAULT_OLX_MIN_AD_AGE_HOURS,
  DEFAULT_OLX_MAX_AD_AGE_HOURS,
  OLX_MAX_AGE_STEPS,
} from "../components/OlxLeadDrawer";
import {
  normalizeCrawlUrl,
  extractOlxSlugId,
} from "./platformAutoCrawlService";
import { entityIdService } from "./entityIdService";
import { applyLeadTitleAndDescriptionRules } from "../utils/applyLeadContentRules";
import { isDailyLeadId } from "../utils/leadIdUtils";
import type { Lead, LeadStatus } from "./leadsService";

export interface AgencyMarketNotice {
  type: "info" | "error" | "success";
  title: string;
  message: string;
  timestamp: number;
}

export interface AgencyMarketAutoImportConfig {
  filters: OlxLeadFilters;
  matchIntervalMinutes: number;
  matchLimit: number;
  minAdAgeHours: number;
  maxAdAgeHours: number;
  lastRunAt: number | null;
  lastNotice: AgencyMarketNotice | null;
  updatedBy?: string;
  updatedAt?: string;
}

export const DEFAULT_AGENCY_MARKET_CONFIG: AgencyMarketAutoImportConfig = {
  filters: { ...DEFAULT_OLX_LEAD_FILTERS, zones: [] },
  matchIntervalMinutes: 0,
  matchLimit: 6,
  minAdAgeHours: DEFAULT_OLX_MIN_AD_AGE_HOURS,
  maxAdAgeHours: DEFAULT_OLX_MAX_AD_AGE_HOURS,
  lastRunAt: null,
  lastNotice: null,
};

const LOCAL_CACHE_PREFIX = "brokr_agency_market_auto_import";
const MARKET_CONFIG_SUBCOLLECTION = "settings";
const MARKET_CONFIG_DOC_ID = "market_auto_import";

function getCacheKey(tenantId?: string): string {
  return tenantId ? `${LOCAL_CACHE_PREFIX}_${tenantId}` : LOCAL_CACHE_PREFIX;
}

function stripUndefinedDeep<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value
      .filter((v) => v !== undefined)
      .map((v) => stripUndefinedDeep(v)) as unknown as T;
  }
  if (typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value as Record<string, any>)) {
      if (v !== undefined) {
        out[k] = stripUndefinedDeep(v);
      }
    }
    return out as T;
  }
  return value;
}

function normalizeAgencyMarketConfig(
  raw: Partial<AgencyMarketAutoImportConfig> | null | undefined
): AgencyMarketAutoImportConfig {
  const filtersRaw = raw?.filters || DEFAULT_OLX_LEAD_FILTERS;
  const interval = Number(raw?.matchIntervalMinutes ?? 0);
  const limit = Number(raw?.matchLimit ?? 6);
  const minAge = Number(raw?.minAdAgeHours ?? DEFAULT_OLX_MIN_AD_AGE_HOURS);
  const maxAge = Number(raw?.maxAdAgeHours ?? DEFAULT_OLX_MAX_AD_AGE_HOURS);

  return {
    filters: {
      ...DEFAULT_OLX_LEAD_FILTERS,
      ...filtersRaw,
      categories: Array.isArray(filtersRaw.categories) ? filtersRaw.categories : [],
      rooms: Array.isArray(filtersRaw.rooms) ? filtersRaw.rooms : [],
      compartimentare: Array.isArray(filtersRaw.compartimentare) ? filtersRaw.compartimentare : [],
      constructie: Array.isArray(filtersRaw.constructie) ? filtersRaw.constructie : [],
      floors: Array.isArray(filtersRaw.floors) ? filtersRaw.floors : [],
      zones: Array.isArray(filtersRaw.zones) ? filtersRaw.zones : [],
    },
    matchIntervalMinutes: [0, 1, 5, 15, 30, 60].includes(interval) ? interval : 0,
    matchLimit: [3, 6, 9, 12, 24, 48].includes(limit) ? limit : 6,
    minAdAgeHours: OLX_MAX_AGE_STEPS.some((s) => s.hours === minAge)
      ? minAge
      : DEFAULT_OLX_MIN_AD_AGE_HOURS,
    maxAdAgeHours: OLX_MAX_AGE_STEPS.some((s) => s.hours === maxAge && s.hours > 0)
      ? maxAge
      : DEFAULT_OLX_MAX_AD_AGE_HOURS,
    lastRunAt: typeof raw?.lastRunAt === "number" ? raw.lastRunAt : null,
    lastNotice: raw?.lastNotice || null,
    updatedBy: raw?.updatedBy,
    updatedAt: raw?.updatedAt,
  };
}

function extractLeadPublishedMs(lead: Lead): number {
  const candidates: any[] = [
    (lead.extractedData as any)?.olxMeta?.publishedAt,
    (lead.extractedData as any)?.olxMeta?.createdTime,
    lead.createdAt,
    lead.updatedAt,
  ];
  for (const val of candidates) {
    if (!val) continue;
    if (typeof val === "number" && Number.isFinite(val)) return val;
    if (typeof val?.toMillis === "function") return val.toMillis();
    if (typeof val?.toDate === "function") return val.toDate().getTime();
    const parsed = Date.parse(String(val));
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

export function matchesAdAgeRange(
  lead: Lead,
  minAdAgeHours: number,
  maxAdAgeHours: number
): boolean {
  const hasMin = minAdAgeHours > DEFAULT_OLX_MIN_AD_AGE_HOURS;
  const hasMax = maxAdAgeHours < DEFAULT_OLX_MAX_AD_AGE_HOURS;
  if (!hasMin && !hasMax) return true;

  const tsMs = extractLeadPublishedMs(lead);
  if (!tsMs) return true;

  const ageHours = Math.max(0, (Date.now() - tsMs) / (1000 * 60 * 60));
  if (hasMin && ageHours < minAdAgeHours) return false;
  if (hasMax && ageHours > maxAdAgeHours) return false;
  return true;
}

export function findAgencyCopyForSharedLead(
  sharedLead: Lead,
  agencyLeads: Lead[]
): Lead | undefined {
  const sid = sharedLead.id || "";
  const sPropId = sharedLead.propertyId || "";
  const sNormUrl = sharedLead.url ? normalizeCrawlUrl(sharedLead.url) : "";
  const sSlug = sharedLead.url ? extractOlxSlugId(sharedLead.url) : "";

  return agencyLeads.find((l) => {
    if (l.isSharedLead) return false;
    if (sid && (l.id === sid || l.sharedLeadId === sid)) return true;
    if (sPropId && l.sourcePropertyId && l.sourcePropertyId === sPropId) return true;
    if (l.url) {
      if (sNormUrl && normalizeCrawlUrl(l.url) === sNormUrl) return true;
      if (sSlug && extractOlxSlugId(l.url) === sSlug) return true;
    }
    return false;
  });
}

export function matchSharedLeadsForAgency(
  sharedLeads: Lead[],
  agencyLeads: Lead[],
  config: AgencyMarketAutoImportConfig
): Lead[] {
  return sharedLeads.filter((lead) => {
    if (findAgencyCopyForSharedLead(lead, agencyLeads)) return false;
    if (!matchesOlxLeadFilter(lead, config.filters)) return false;
    if (!matchesAdAgeRange(lead, config.minAdAgeHours, config.maxAdAgeHours)) return false;
    return true;
  });
}

export interface AgencyMarketActor {
  name: string;
  email: string;
  uid: string;
}

export interface CopySharedLeadResult {
  lead: Lead;
  propertyId: string;
}

export interface AutoMatchRunResult {
  copiedCount: number;
  totalMatched: number;
  errors: string[];
  notice: AgencyMarketNotice;
}

export const agencyMarketService = {
  getCachedConfig(tenantId?: string): AgencyMarketAutoImportConfig {
    if (typeof window === "undefined") return DEFAULT_AGENCY_MARKET_CONFIG;
    try {
      const raw = window.localStorage.getItem(getCacheKey(tenantId));
      if (!raw) return DEFAULT_AGENCY_MARKET_CONFIG;
      return normalizeAgencyMarketConfig(JSON.parse(raw));
    } catch {
      return DEFAULT_AGENCY_MARKET_CONFIG;
    }
  },

  async loadConfig(tenantId?: string): Promise<AgencyMarketAutoImportConfig> {
    if (!tenantId || !auth.currentUser) {
      return this.getCachedConfig(tenantId);
    }
    try {
      const ref = doc(db, "tenants", tenantId, MARKET_CONFIG_SUBCOLLECTION, MARKET_CONFIG_DOC_ID);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const normalized = normalizeAgencyMarketConfig(
          snap.data() as Partial<AgencyMarketAutoImportConfig>
        );
        try {
          window.localStorage.setItem(getCacheKey(tenantId), JSON.stringify(normalized));
        } catch {}
        return normalized;
      }
      return this.getCachedConfig(tenantId);
    } catch (err) {
      console.warn("[agencyMarketService] loadConfig fallback to cache:", err);
      return this.getCachedConfig(tenantId);
    }
  },

  async saveConfig(
    tenantId: string | undefined,
    config: AgencyMarketAutoImportConfig
  ): Promise<AgencyMarketAutoImportConfig> {
    const normalized = normalizeAgencyMarketConfig(config);
    const payload = stripUndefinedDeep({
      ...normalized,
      updatedBy: auth.currentUser?.email || "agency_admin",
      updatedAt: new Date().toISOString(),
    });

    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(getCacheKey(tenantId), JSON.stringify(payload));
      } catch {}
    }

    if (!tenantId || !auth.currentUser) {
      return payload;
    }

    try {
      const ref = doc(db, "tenants", tenantId, MARKET_CONFIG_SUBCOLLECTION, MARKET_CONFIG_DOC_ID);
      await setDoc(ref, payload, { merge: true });
      return payload;
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.WRITE,
        `tenants/${tenantId}/${MARKET_CONFIG_SUBCOLLECTION}/${MARKET_CONFIG_DOC_ID}`
      );
      return payload;
    }
  },

  async copySharedLeadToAgencyNoi({
    sharedLead,
    actor,
    mode = "manual",
  }: {
    sharedLead: Lead;
    actor: AgencyMarketActor;
    mode?: "manual" | "auto";
  }): Promise<CopySharedLeadResult> {
    const agencyLeadId = await entityIdService.getNextId("lead");
    const sourcePropertyId =
      isDailyLeadId(sharedLead.propertyId) || sharedLead.propertyId
        ? sharedLead.propertyId
        : undefined;

    const { formattedTitle, formattedDescription, updatedExtractedData } =
      await applyLeadTitleAndDescriptionRules({
        lead: sharedLead,
        targetKind: "my_list",
        propertyId: agencyLeadId,
      });

    const { isSharedLead: _ignored, id: sharedId, ...rest } = sharedLead;
    const nowIso = new Date().toISOString();
    const agentName = actor.name || "Administrator Agenție";

    const payload: Record<string, any> = stripUndefinedDeep({
      ...rest,
      ...(sharedId ? { id: sharedId, sharedLeadId: sharedId } : {}),
      propertyId: agencyLeadId,
      ...(sourcePropertyId ? { sourcePropertyId } : {}),
      isSharedLead: false,
      status: "ListaMea" as LeadStatus,
      title: formattedTitle,
      notes: formattedDescription,
      extractedData: updatedExtractedData,
      source: mode === "auto" ? "agency_market_auto_import" : "agency_market_manual_copy",
      agent: agentName,
      agentEmail: actor.email || "",
      agentUid: actor.uid || "",
      createdByName: agentName,
      createdByEmail: actor.email || "",
      author: agentName,
      lastMovedAt: nowIso,
    });

    const created = await crmApiClient.create<Lead>("leads", payload);
    const resolvedId = created?.propertyId || agencyLeadId;
    return {
      lead: { ...created, propertyId: resolvedId },
      propertyId: resolvedId,
    };
  },

  async runAutoMatchImport({
    sharedLeads,
    agencyLeads,
    config,
    actor,
  }: {
    sharedLeads: Lead[];
    agencyLeads: Lead[];
    config: AgencyMarketAutoImportConfig;
    actor: AgencyMarketActor;
  }): Promise<AutoMatchRunResult> {
    const matched = matchSharedLeadsForAgency(sharedLeads, agencyLeads, config);
    if (matched.length === 0) {
      return {
        copiedCount: 0,
        totalMatched: 0,
        errors: [],
        notice: {
          type: "info",
          title: "Niciun anunț nou potrivit filtrelor agenției",
          message:
            "Nu există în acest moment anunțuri necopiate în Piața Imobiliară care să corespundă criteriilor selectate.",
          timestamp: Date.now(),
        },
      };
    }

    const batch = matched.slice(0, Math.max(1, config.matchLimit || 6));
    let copiedCount = 0;
    const errors: string[] = [];

    for (const candidate of batch) {
      try {
        await this.copySharedLeadToAgencyNoi({
          sharedLead: candidate,
          actor,
          mode: "auto",
        });
        copiedCount++;
      } catch (err: any) {
        console.warn("[agencyMarketService] Failed copying matched lead:", err);
        errors.push(err?.message || "Eroare la copierea anunțului în Lead-uri → Noi.");
      }
    }

    let notice: AgencyMarketNotice;
    if (copiedCount > 0 && errors.length === 0) {
      notice = {
        type: "success",
        title: "Import automat din Piața Imobiliară finalizat",
        message: `${copiedCount} ${copiedCount === 1 ? "anunț potrivit a fost copiat" : "anunțuri potrivite au fost copiate"} automat în Lead-uri → Noi (cu ID unic de agenție și titlu/descriere formatate).`,
        timestamp: Date.now(),
      };
    } else if (copiedCount > 0 && errors.length > 0) {
      notice = {
        type: "error",
        title: "Import parțial finalizat",
        message: `${copiedCount} anunțuri au fost copiate în Noi, dar ${errors.length} au eșuat: ${errors[0]}`,
        timestamp: Date.now(),
      };
    } else {
      notice = {
        type: "error",
        title: "Eroare la copierea anunțurilor",
        message: errors[0] || "Nu s-au putut copia anunțurile potrivite în Lead-uri → Noi.",
        timestamp: Date.now(),
      };
    }

    return {
      copiedCount,
      totalMatched: matched.length,
      errors,
      notice,
    };
  },
};
