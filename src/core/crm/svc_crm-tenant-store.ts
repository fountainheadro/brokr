import crypto from "crypto";
import { PersistentStoreService } from "../database/svc_persistent-store";
import { TenantResolutionService } from "../tenancy/svc_tenant-resolution";
import { TenantMembershipService } from "../tenancy/svc_tenant-membership";
import { ForbiddenError, NotFoundError, AppError } from "../errors/app_error";
import {
  normalizeCrmDocument,
  toDisplayLeadStatus,
  toDisplayStaffStatus,
} from "./svc_crm-normalizer";
import {
  formatDailyLeadId,
  getDailyLeadDateKey,
  getMaxDailyLeadSequenceForDate,
  isAgencyLeadId,
  isDailyLeadId,
} from "../../utils/leadIdUtils";
import {
  LEAD_SUMMARY_COLLECTION,
  projectLeadToSummary,
  type LeadSummary,
} from "./svc_lead-projection";
import { normalizeLeadToCanonicalSpecs } from "../portals/svc_canonical-normalizer";

export const CRM_TENANT_COLLECTIONS = [
  "leads",
  "contacts",
  "staff",
  "personal",
  "documents",
  "activities",
  "tours",
  "viewings",
  "notifications",
  "fcm_tokens",
] as const;

export type CrmTenantCollection = (typeof CRM_TENANT_COLLECTIONS)[number];

export type CrmEntityType =
  | "lead"
  | "daily_lead"
  | "request"
  | "cerere"
  | "property"
  | "client"
  | "contact"
  | "staff"
  | "personal"
  | "document"
  | "activity"
  | "activitate"
  | "tour"
  | "viewing";

const PREFIX_MAP: Record<string, string> = {
  lead: "L",
  request: "R",
  cerere: "R",
  property: "P",
  client: "C",
  contact: "C",
  staff: "S",
  personal: "S",
  document: "D",
  activity: "A",
  activitate: "A",
  tour: "A",
  viewing: "A",
};

const PROPRIETATI_STATUSES = new Set([
  "Noua",
  "Prospectare",
  "Colaborare",
  "Vizionare",
  "Ofertare",
  "Antecontract",
  "Contract",
  "Activa",
  "InNegociere",
  "Finalizata",
  "Arhiva",
]);

function normalizeCounterKey(type: CrmEntityType): string {
  if (type === "cerere") return "request";
  if (type === "contact") return "client";
  if (type === "personal") return "staff";
  if (type === "activitate" || type === "tour" || type === "viewing") return "activity";
  return type;
}

function isCererePayload(l: Record<string, any>): boolean {
  if (!l) return false;
  if (
    l.propertyId &&
    (String(l.propertyId).startsWith("P") ||
      String(l.propertyId).startsWith("L") ||
      isDailyLeadId(l.propertyId))
  ) {
    return false;
  }
  if (l.propertyId && String(l.propertyId).startsWith("R")) return true;
  if (l.title && String(l.title).toLowerCase().startsWith("cerere")) return true;
  if (l.status === "AreInteres" || l.status === "Calificare" || l.status === "Matching") return true;
  if (
    l.notes &&
    (String(l.notes).toLowerCase().includes("cerințe cerere") ||
      String(l.notes).toLowerCase().includes("cerere:"))
  ) {
    return true;
  }
  return false;
}

function sanitizeValueDeep(v: any): any {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === "number") {
    return Number.isFinite(v) ? v : null;
  }
  if (v instanceof Date) {
    return v.toISOString();
  }
  if (Array.isArray(v)) {
    const arr: any[] = [];
    for (const item of v) {
      const cleaned = sanitizeValueDeep(item);
      if (cleaned !== undefined) {
        arr.push(cleaned);
      }
    }
    return arr;
  }
  if (typeof v === "object") {
    if (v._methodName === "serverTimestamp" || typeof v.isEqual === "function") {
      return new Date().toISOString();
    }
    const obj: Record<string, any> = {};
    for (const [k, child] of Object.entries(v)) {
      if (child === undefined) continue;
      const cleaned = sanitizeValueDeep(child);
      if (cleaned !== undefined) {
        obj[k] = cleaned;
      }
    }
    return obj;
  }
  return v;
}

function sanitizePayloadTimestamps(data: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (v === undefined) continue;
    const cleaned = sanitizeValueDeep(v);
    if (cleaned !== undefined) {
      out[k] = cleaned;
    }
  }
  return out;
}

function getNestedValue(obj: Record<string, any> | undefined, path: string): any {
  if (!obj || typeof obj !== "object") return undefined;
  let curr: any = obj;
  for (const part of path.split(".")) {
    if (!curr || typeof curr !== "object") return undefined;
    curr = curr[part];
  }
  return curr;
}

function parseParcareCount(parcare: string): number | undefined {
  const norm = parcare.trim().toLowerCase();
  if (!norm) return undefined;
  if (norm === "fără" || norm === "fara" || norm === "0") return 0;
  const m = norm.match(/\d+/);
  return m ? parseInt(m[0], 10) : undefined;
}

/**
 * Keeps top-level lead/cerere/property fields and nested `extractedData` (`crmData`,
 * `originalTitle`, `originalDescription`, `markdownMarketing`, `presentationSections`)
 * strictly synchronized whenever an entity is created or updated so the CRM detail view
 * and external `/share/:id` pages always render identical, up-to-date data.
 */
function syncLeadDerivedFields(
  target: Record<string, any>,
  patch?: Record<string, any>,
  existingCriteria?: Record<string, any>,
  options?: { isCreate?: boolean }
): void {
  const hasPatch = Boolean(patch && Object.keys(patch).length > 0);
  const isCreate = Boolean(options?.isCreate);
  const p = patch || {};
  const hasExtractedPatch = Boolean(p.extractedData && typeof p.extractedData === "object");

  const ensureExtracted = (): Record<string, any> => {
    if (!target.extractedData || typeof target.extractedData !== "object") {
      target.extractedData = {};
    } else {
      target.extractedData = { ...target.extractedData };
    }
    return target.extractedData;
  };

  // 1. Price synchronization
  const patchedTopPrice =
    p.price !== undefined && p.price !== null ? String(p.price).trim() : null;
  const patchedCrmDotPrice =
    p["extractedData.crmData.pret.detalii.pret"] !== undefined &&
    p["extractedData.crmData.pret.detalii.pret"] !== null
      ? String(p["extractedData.crmData.pret.detalii.pret"]).trim()
      : null;
  const patchedNestedPrice = hasExtractedPatch
    ? (() => {
        const v = getNestedValue(p.extractedData, "crmData.pret.detalii.pret");
        return v !== undefined && v !== null ? String(v).trim() : null;
      })()
    : null;
  const syncedPrice =
    patchedTopPrice ||
    patchedCrmDotPrice ||
    patchedNestedPrice ||
    (!hasPatch && typeof target.price === "string" && target.price.trim()
      ? target.price.trim()
      : null);

  if (syncedPrice) {
    target.price = syncedPrice;
    if (target.extractedData && typeof target.extractedData === "object") {
      const ext = ensureExtracted();
      if (ext.crmData && typeof ext.crmData === "object") {
        ext.crmData = {
          ...ext.crmData,
          pret: {
            ...(ext.crmData.pret || {}),
            detalii: {
              ...(ext.crmData.pret?.detalii || {}),
              pret: syncedPrice,
            },
          },
        };
      }
      if (ext.presentationSections?.tranzactie && typeof ext.presentationSections.tranzactie === "object") {
        ext.presentationSections = {
          ...ext.presentationSections,
          tranzactie: {
            ...ext.presentationSections.tranzactie,
            "Preț": syncedPrice,
          },
        };
      }
    }
  }

  // 2. Title synchronization (ensures raw leads, Selectate, Cereri & Properties all update on /share/:id)
  const patchedTopTitle =
    p.title !== undefined && p.title !== null ? String(p.title).trim() : null;
  const patchedCrmDotTitle =
    p["extractedData.crmData.descriere.titlu"] !== undefined &&
    p["extractedData.crmData.descriere.titlu"] !== null
      ? String(p["extractedData.crmData.descriere.titlu"]).trim()
      : null;
  const patchedOrigTitle =
    p["extractedData.originalTitle"] !== undefined && p["extractedData.originalTitle"] !== null
      ? String(p["extractedData.originalTitle"]).trim()
      : null;
  const patchedIntroTitle =
    p["extractedData.presentationSections.introducere.titlu"] !== undefined &&
    p["extractedData.presentationSections.introducere.titlu"] !== null
      ? String(p["extractedData.presentationSections.introducere.titlu"]).trim()
      : null;
  const patchedNestedTitle = hasExtractedPatch
    ? (() => {
        const v =
          getNestedValue(p.extractedData, "crmData.descriere.titlu") ??
          getNestedValue(p.extractedData, "presentationSections.introducere.titlu") ??
          getNestedValue(p.extractedData, "originalTitle");
        return v !== undefined && v !== null ? String(v).trim() : null;
      })()
    : null;
  const patchedCriteriaTitle =
    p.criteriiFormular &&
    typeof p.criteriiFormular === "object" &&
    typeof p.criteriiFormular.propertyTitle === "string" &&
    p.criteriiFormular.propertyTitle.trim()
      ? p.criteriiFormular.propertyTitle.trim()
      : p["criteriiFormular.propertyTitle"] !== undefined &&
          p["criteriiFormular.propertyTitle"] !== null &&
          String(p["criteriiFormular.propertyTitle"]).trim()
        ? String(p["criteriiFormular.propertyTitle"]).trim()
        : null;
  const syncedTitle =
    patchedTopTitle ||
    patchedCrmDotTitle ||
    patchedIntroTitle ||
    patchedOrigTitle ||
    patchedNestedTitle ||
    patchedCriteriaTitle;

  const explicitManualTitleFalse =
    p["extractedData.titleManuallyEdited"] === false ||
    (hasExtractedPatch && p.extractedData?.titleManuallyEdited === false);
  const patchedManualTitleFlag =
    p["extractedData.titleManuallyEdited"] === true ||
    (hasExtractedPatch && p.extractedData?.titleManuallyEdited === true) ||
    (!isCreate &&
      !explicitManualTitleFalse &&
      Boolean(patchedTopTitle || patchedCrmDotTitle || patchedIntroTitle || patchedOrigTitle || patchedCriteriaTitle));

  if (syncedTitle) {
    target.title = syncedTitle;
    const ext = ensureExtracted();
    ext.originalTitle = syncedTitle;
    if (patchedManualTitleFlag) {
      ext.titleManuallyEdited = true;
    }
    if (ext.olxMeta && typeof ext.olxMeta === "object") {
      ext.olxMeta = { ...ext.olxMeta, originalTitle: syncedTitle };
    }
    if (ext.crmData && typeof ext.crmData === "object") {
      ext.crmData = {
        ...ext.crmData,
        descriere: {
          ...(ext.crmData.descriere || {}),
          titlu: syncedTitle,
        },
      };
    }
    if (ext.presentationSections && typeof ext.presentationSections === "object") {
      ext.presentationSections = {
        ...ext.presentationSections,
        introducere: {
          ...(ext.presentationSections.introducere || {}),
          titlu: syncedTitle,
        },
      };
    }
    if (target.criteriiFormular && typeof target.criteriiFormular === "object") {
      target.criteriiFormular = {
        ...target.criteriiFormular,
        propertyTitle: syncedTitle,
      };
    }
  }

  // 3. Description synchronization (explicit description edits only — never leaks internal notes)
  const patchedCrmDotDesc =
    p["extractedData.crmData.descriere.continut"] !== undefined &&
    p["extractedData.crmData.descriere.continut"] !== null
      ? String(p["extractedData.crmData.descriere.continut"])
      : null;
  const patchedOrigDotDesc =
    p["extractedData.originalDescription"] !== undefined &&
    p["extractedData.originalDescription"] !== null
      ? String(p["extractedData.originalDescription"])
      : null;
  const patchedMarkdownDotDesc =
    p["extractedData.markdownMarketing"] !== undefined &&
    p["extractedData.markdownMarketing"] !== null
      ? String(p["extractedData.markdownMarketing"])
      : null;
  const patchedIntroSummaryDot =
    p["extractedData.presentationSections.introducere.summary"] !== undefined &&
    p["extractedData.presentationSections.introducere.summary"] !== null
      ? String(p["extractedData.presentationSections.introducere.summary"])
      : null;
  const patchedNestedDesc = hasExtractedPatch
    ? (() => {
        const v =
          getNestedValue(p.extractedData, "crmData.descriere.continut") ??
          getNestedValue(p.extractedData, "presentationSections.introducere.summary") ??
          getNestedValue(p.extractedData, "originalDescription");
        return v !== undefined && v !== null ? String(v) : null;
      })()
    : null;
  const syncedDesc =
    patchedCrmDotDesc !== null
      ? patchedCrmDotDesc
      : patchedIntroSummaryDot !== null
        ? patchedIntroSummaryDot
        : patchedOrigDotDesc !== null
          ? patchedOrigDotDesc
          : patchedMarkdownDotDesc !== null
            ? patchedMarkdownDotDesc
            : patchedNestedDesc;

  const explicitManualDescFalse =
    p["extractedData.descriptionManuallyEdited"] === false ||
    (hasExtractedPatch && p.extractedData?.descriptionManuallyEdited === false);
  const patchedManualDescFlag =
    p["extractedData.descriptionManuallyEdited"] === true ||
    (hasExtractedPatch && p.extractedData?.descriptionManuallyEdited === true) ||
    (!isCreate &&
      !explicitManualDescFalse &&
      (patchedCrmDotDesc !== null ||
        patchedIntroSummaryDot !== null ||
        patchedOrigDotDesc !== null ||
        patchedMarkdownDotDesc !== null));

  if (syncedDesc !== null) {
    const ext = ensureExtracted();
    ext.originalDescription = syncedDesc;
    if (patchedManualDescFlag) {
      ext.descriptionManuallyEdited = true;
    }
    if (ext.crmData && typeof ext.crmData === "object") {
      ext.crmData = {
        ...ext.crmData,
        descriere: {
          ...(ext.crmData.descriere || {}),
          continut: syncedDesc,
        },
      };
    }
    if (typeof ext.markdownMarketing === "string" || patchedManualDescFlag) {
      ext.markdownMarketing = syncedDesc;
    }
    if (ext.presentationSections && typeof ext.presentationSections === "object") {
      ext.presentationSections = {
        ...ext.presentationSections,
        introducere: {
          ...(ext.presentationSections.introducere || {}),
          summary: syncedDesc,
        },
      };
    }
    if (target.criteriiFormular && typeof target.criteriiFormular === "object") {
      target.criteriiFormular = {
        ...target.criteriiFormular,
        requirements: syncedDesc,
      };
    }
    if (typeof target.requirements === "string" || patchedManualDescFlag) {
      target.requirements = syncedDesc;
    }
  }

  // 4. Zone, transactionType, categoria synchronization
  const patchedZone =
    p.zone !== undefined && p.zone !== null
      ? String(p.zone).trim()
      : p["extractedData.crmData.detaliiGenerale.localizare.zona"] !== undefined
        ? String(p["extractedData.crmData.detaliiGenerale.localizare.zona"]).trim()
        : null;
  if (patchedZone) {
    target.zone = patchedZone;
    if (target.extractedData?.crmData && typeof target.extractedData.crmData === "object") {
      const ext = ensureExtracted();
      ext.crmData = {
        ...ext.crmData,
        detaliiGenerale: {
          ...(ext.crmData.detaliiGenerale || {}),
          localizare: {
            ...(ext.crmData.detaliiGenerale?.localizare || {}),
            zona: patchedZone,
          },
        },
      };
    }
  }

  const patchedTx =
    p.transactionType !== undefined && p.transactionType !== null
      ? String(p.transactionType).trim()
      : null;
  if (patchedTx && target.extractedData?.crmData && typeof target.extractedData.crmData === "object") {
    const ext = ensureExtracted();
    ext.crmData = {
      ...ext.crmData,
      detaliiGenerale: {
        ...(ext.crmData.detaliiGenerale || {}),
        tranzactie: patchedTx,
      },
    };
  }

  const patchedCategoria =
    p.categoria !== undefined && p.categoria !== null ? String(p.categoria).trim() : null;
  if (patchedCategoria && target.extractedData?.crmData && typeof target.extractedData.crmData === "object") {
    const ext = ensureExtracted();
    ext.crmData = {
      ...ext.crmData,
      detaliiGenerale: {
        ...(ext.crmData.detaliiGenerale || {}),
        categoria: patchedCategoria,
      },
    };
  }

  // 5. Additional characteristics (mobilare, parcare, sursaIncalzire, modIncalzire)
  const touchedChars =
    p.mobilare !== undefined ||
    p.parcare !== undefined ||
    p.sursaIncalzire !== undefined ||
    p.modIncalzire !== undefined;
  if (touchedChars && target.extractedData && typeof target.extractedData === "object") {
    const ext = ensureExtracted();
    if (ext.crmData && typeof ext.crmData === "object") {
      const nextCrm: Record<string, any> = { ...ext.crmData };
      if (p.mobilare !== undefined) {
        const mobVal = String(p.mobilare || "").trim();
        const mappedMob =
          mobVal === "Completă"
            ? "Complet"
            : mobVal === "Parțială"
              ? "Partial"
              : mobVal === "Fără"
                ? "Nemobilat"
                : mobVal;
        nextCrm.utilitati = {
          ...(nextCrm.utilitati || {}),
          dotari: {
            ...(nextCrm.utilitati?.dotari || {}),
            mobilat: mappedMob,
          },
        };
        nextCrm.dotari = {
          ...(nextCrm.dotari || {}),
          mobilat: mobVal ? [mobVal] : [],
        };
      }
      if (p.parcare !== undefined) {
        const parcareStr = String(p.parcare || "").trim();
        const count = parseParcareCount(parcareStr);
        if (count !== undefined) {
          nextCrm.caracteristici = {
            ...(nextCrm.caracteristici || {}),
            detalii: {
              ...(nextCrm.caracteristici?.detalii || {}),
              parcari: count,
            },
          };
        }
        nextCrm.dotari = {
          ...(nextCrm.dotari || {}),
          parcare: parcareStr,
        };
      }
      if (p.sursaIncalzire !== undefined || p.modIncalzire !== undefined) {
        const nextHeating = [
          String(target.sursaIncalzire || "").trim(),
          String(target.modIncalzire || "").trim(),
        ].filter(Boolean);
        nextCrm.utilitati = {
          ...(nextCrm.utilitati || {}),
          sistemIncalzire: nextHeating,
          ...(p.modIncalzire !== undefined
            ? { metodaIncalzire: String(target.modIncalzire || "").trim() }
            : {}),
        };
      }
      ext.crmData = nextCrm;
    }

    if (ext.presentationSections && typeof ext.presentationSections === "object") {
      const nextSections: Record<string, any> = { ...ext.presentationSections };
      if (p.mobilare !== undefined && nextSections.mobilare && typeof nextSections.mobilare === "object") {
        nextSections.mobilare = {
          ...nextSections.mobilare,
          "Stadiu mobilare": String(p.mobilare || "").trim() || "-",
        };
      }
      if (p.parcare !== undefined && nextSections.parcare && typeof nextSections.parcare === "object") {
        nextSections.parcare = {
          ...nextSections.parcare,
          "Parcare": String(p.parcare || "").trim() || "-",
        };
      }
      if (
        (p.sursaIncalzire !== undefined || p.modIncalzire !== undefined) &&
        nextSections.dotari &&
        typeof nextSections.dotari === "object"
      ) {
        const heatingSummary = [
          String(target.sursaIncalzire || "").trim(),
          String(target.modIncalzire || "").trim(),
        ]
          .filter(Boolean)
          .join(", ");
        nextSections.dotari = {
          ...nextSections.dotari,
          "Încălzire": heatingSummary || "-",
        };
      }
      ext.presentationSections = nextSections;
    }
  }

  // 6. Accordion criteria synchronization & preservation across partial edits
  const patchedTopCriteria =
    p.criteriiFormular && typeof p.criteriiFormular === "object"
      ? (p.criteriiFormular as Record<string, any>)
      : null;
  const patchedNestedCriteria =
    p["extractedData.crmData.criteriiFormular"] &&
    typeof p["extractedData.crmData.criteriiFormular"] === "object"
      ? (p["extractedData.crmData.criteriiFormular"] as Record<string, any>)
      : hasExtractedPatch &&
          p.extractedData?.crmData?.criteriiFormular &&
          typeof p.extractedData.crmData.criteriiFormular === "object"
        ? (p.extractedData.crmData.criteriiFormular as Record<string, any>)
        : null;

  const baseCriteria =
    (existingCriteria && typeof existingCriteria === "object" ? existingCriteria : null) ||
    (target.criteriiFormular && typeof target.criteriiFormular === "object"
      ? (target.criteriiFormular as Record<string, any>)
      : null) ||
    (target.extractedData?.crmData?.criteriiFormular &&
    typeof target.extractedData.crmData.criteriiFormular === "object"
      ? (target.extractedData.crmData.criteriiFormular as Record<string, any>)
      : null);

  if (baseCriteria || patchedTopCriteria || patchedNestedCriteria) {
    const mergedCriteria: Record<string, any> = {
      ...(baseCriteria || {}),
      ...(patchedNestedCriteria || {}),
      ...(patchedTopCriteria || {}),
    };
    if (p.mobilare !== undefined) {
      mergedCriteria.mobilare = String(p.mobilare || "").trim();
    }
    if (p.utilare !== undefined) {
      mergedCriteria.utilare = String(p.utilare || "").trim();
    }
    if (p.sursaIncalzire !== undefined) {
      mergedCriteria.sistemIncalzire = String(p.sursaIncalzire || "").trim();
    }
    if (p.modIncalzire !== undefined) {
      mergedCriteria.metodaIncalzire = String(p.modIncalzire || "").trim();
    }
    if (p.compartimentare !== undefined) {
      mergedCriteria.compartimentare = String(p.compartimentare || "").trim();
    }
    if (syncedTitle) {
      mergedCriteria.propertyTitle = syncedTitle;
    }
    target.criteriiFormular = mergedCriteria;
    const ext = ensureExtracted();
    ext.crmData = {
      ...(ext.crmData && typeof ext.crmData === "object" ? ext.crmData : {}),
      criteriiFormular: { ...mergedCriteria },
    };
  }
}

function assertSafePathSegment(value: string, label: string): string {
  const trimmed = String(value || "").trim();
  if (
    !trimmed ||
    trimmed.includes("\0") ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed === "." ||
    trimmed === ".." ||
    trimmed.includes("..")
  ) {
    throw new AppError({
      message: `Identificator invalid pentru ${label}.`,
      code: "VALIDATION_ERROR",
      statusCode: 400,
    });
  }
  return trimmed;
}

/**
 * Server-authoritative tenant-scoped repository for ALL CRM runtime collections.
 * Storage layout:
 * - Production (`NODE_ENV === "production"`): reads and writes DIRECTLY in Firestore subcollections
 *   `/tenants/{tenantId}/{collectionName}/{docId}` and `/tenants/{tenantId}/counters/entities`.
 *   NEVER reads or writes `.data/brokr-persistent-store.json` in production, and ALWAYS awaits
 *   Firestore confirmation so 401/403/network errors fail cleanly without silent local fallback.
 * - Development / Test: uses Firestore REST when explicitly configured/mocked, or an isolated
 *   local adapter (`PersistentStoreService` under `tenants__${tenantId}__${collectionName}`) when
 *   running offline without cloud credentials.
 */
export class CrmTenantStoreService {
  private static forceFirestoreOrigin: string | null = null;

  public static setFirestoreOriginForTests(origin: string | null): void {
    this.forceFirestoreOrigin = origin ? origin.replace(/\/+$/, "") : null;
    PersistentStoreService.setTestFirestoreOrigin(origin);
  }

  public static isUsingLiveFirestore(): boolean {
    if (process.env.NODE_ENV !== "test") {
      return true;
    }
    if (this.forceFirestoreOrigin) {
      return true;
    }
    return PersistentStoreService.isRemoteFirestoreConfigured();
  }

  public static assertValidCollection(col: string): CrmTenantCollection {
    if (!CRM_TENANT_COLLECTIONS.includes(col as CrmTenantCollection)) {
      throw new AppError({
        message: `Colecția CRM "${col}" nu este suportată.`,
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    }
    return col as CrmTenantCollection;
  }

  private static firestoreCollectionPath(tenantId: string, collectionName: string): string {
    const safeTenant = assertSafePathSegment(tenantId, "tenantId");
    const safeCol = assertSafePathSegment(collectionName, "collectionName");
    return `tenants/${safeTenant}/${safeCol}`;
  }

  private static firestoreDocPath(
    tenantId: string,
    collectionName: string,
    docId: string
  ): string {
    const safeTenant = assertSafePathSegment(tenantId, "tenantId");
    const safeCol = assertSafePathSegment(collectionName, "collectionName");
    const safeDoc = assertSafePathSegment(docId, "docId");
    return `tenants/${safeTenant}/${safeCol}/${safeDoc}`;
  }

  private static storeKey(tenantId: string, collectionName: string): string {
    return `tenants__${tenantId}__${collectionName}`;
  }

  private static counterStoreKey(tenantId: string): string {
    return `tenants__${tenantId}__counters`;
  }

  /**
   * Atomically commits a canonical lead document and its slim `leads_summary` projection in a
   * single Firestore `:commit` batch (or dual local store write in offline unit tests).
   *
   * Security boundary:
   * - In production / Cloud Run (ADC / Service Account), `:commit` writes both documents
   *   atomically with zero fallback (errors propagate cleanly).
   * - In Starter Tier / Preview containers using a user-scoped Firebase ID token where
   *   `firestore.rules` strictly enforces `allow write: if false;` on `leads_summary`,
   *   a 403 on the dual-write commit degrades gracefully to writing canonical `leads/{id}` so
   *   preview agents remain operational without weakening Firestore rules.
   */
  private static async commitLeadWithSummary(
    safeTenant: string,
    canonicalDoc: Record<string, any>,
    operation: string
  ): Promise<LeadSummary> {
    // Phase 7: lazily maintain typed canonicalSpecs on canonical lead/property docs
    // without touching existing string fields or bloating slim leads_summary.
    canonicalDoc.canonicalSpecs = normalizeLeadToCanonicalSpecs(canonicalDoc);

    const summaryDoc = projectLeadToSummary(canonicalDoc, {
      tenantId: safeTenant,
      isSharedLead: false,
      docVersion: canonicalDoc.docVersion,
    });

    if (this.isUsingLiveFirestore()) {
      const { projectId, databaseId } = PersistentStoreService.getFirebaseTarget();
      const basePrefix = `projects/${projectId}/databases/${databaseId}/documents/tenants/${safeTenant}`;
      const isUserToken = PersistentStoreService.isUsingUserScopedToken();

      try {
        await PersistentStoreService.remoteCommitWrites(
          [
            {
              update: {
                name: `${basePrefix}/leads/${canonicalDoc.id}`,
                fields: PersistentStoreService.encodeDocumentFields(canonicalDoc),
              },
            },
            {
              update: {
                name: `${basePrefix}/${LEAD_SUMMARY_COLLECTION}/${canonicalDoc.id}`,
                fields: PersistentStoreService.encodeDocumentFields(summaryDoc),
              },
            },
          ],
          operation,
          isUserToken ? { silentOnStatuses: [403] } : undefined
        );
      } catch (err: any) {
        if (isUserToken && err?.statusCode === 403) {
          // Starter-tier preview user token cannot write read-only leads_summary; persist canonical doc
          await PersistentStoreService.remoteSetAtPath(
            this.firestoreDocPath(safeTenant, "leads", canonicalDoc.id),
            canonicalDoc
          );
        } else {
          throw err;
        }
      }
      return summaryDoc;
    }

    PersistentStoreService.set(this.storeKey(safeTenant, "leads"), canonicalDoc.id, canonicalDoc);
    PersistentStoreService.set(
      this.storeKey(safeTenant, LEAD_SUMMARY_COLLECTION),
      canonicalDoc.id,
      summaryDoc
    );
    return summaryDoc;
  }

  private static async deleteLeadWithSummary(
    safeTenant: string,
    targetDocId: string
  ): Promise<boolean> {
    if (this.isUsingLiveFirestore()) {
      const { projectId, databaseId } = PersistentStoreService.getFirebaseTarget();
      const basePrefix = `projects/${projectId}/databases/${databaseId}/documents/tenants/${safeTenant}`;
      const isUserToken = PersistentStoreService.isUsingUserScopedToken();
      try {
        await PersistentStoreService.remoteCommitWrites(
          [
            { delete: `${basePrefix}/leads/${targetDocId}` },
            { delete: `${basePrefix}/${LEAD_SUMMARY_COLLECTION}/${targetDocId}` },
          ],
          "delete_lead_dual_write",
          isUserToken ? { silentOnStatuses: [403] } : undefined
        );
      } catch (err: any) {
        if (isUserToken && err?.statusCode === 403) {
          await PersistentStoreService.remoteDeleteAtPath(
            this.firestoreDocPath(safeTenant, "leads", targetDocId)
          );
        } else {
          throw err;
        }
      }
      return true;
    }

    const deletedCanonical = PersistentStoreService.delete(
      this.storeKey(safeTenant, "leads"),
      targetDocId
    );
    PersistentStoreService.delete(
      this.storeKey(safeTenant, LEAD_SUMMARY_COLLECTION),
      targetDocId
    );
    return deletedCanonical;
  }

  /**
   * Read-only list of slim `leads_summary` projections for a verified tenant.
   * Never exposes heavy `extractedData` / `images[]` / `notes` / private memos.
   */
  public static async listLeadSummaries(
    tenantId: string,
    filters?: { propertyId?: string; status?: string; limit?: number }
  ): Promise<LeadSummary[]> {
    const safeTenant = assertSafePathSegment(tenantId, "tenantId");
    const effectiveLimit = Math.min(2000, Math.max(1, filters?.limit ?? 1000));
    let docs: LeadSummary[] = [];

    if (this.isUsingLiveFirestore()) {
      const maxPages = Math.max(1, Math.ceil(effectiveLimit / 300));
      const isUserScoped = PersistentStoreService.isUsingUserScopedToken();
      const raw = await PersistentStoreService.remoteListAtPath<LeadSummary>(
        this.firestoreCollectionPath(safeTenant, LEAD_SUMMARY_COLLECTION),
        Math.min(300, effectiveLimit),
        maxPages,
        isUserScoped ? { silentOnStatuses: [403] } : undefined
      );
      docs = raw.filter((d) => !d.tenantId || d.tenantId === safeTenant);
    } else {
      const allMap = PersistentStoreService.getAll<LeadSummary>(
        this.storeKey(safeTenant, LEAD_SUMMARY_COLLECTION)
      );
      docs = Object.values(allMap).filter((d) => !d.tenantId || d.tenantId === safeTenant);
    }

    if (filters?.propertyId) {
      docs = docs.filter((d) => d.propertyId === filters.propertyId);
    }
    if (filters?.status) {
      docs = docs.filter((d) => d.status === filters.status);
    }

    docs.sort((a, b) => {
      const ta = Date.parse(String(a.updatedAt || a.createdAt || 0)) || 0;
      const tb = Date.parse(String(b.updatedAt || b.createdAt || 0)) || 0;
      return tb - ta;
    });

    if (filters?.limit && docs.length > filters.limit) {
      docs = docs.slice(0, filters.limit);
    }
    return docs;
  }

  public static async getLeadSummaryById(
    tenantId: string,
    id: string
  ): Promise<LeadSummary | null> {
    const safeTenant = assertSafePathSegment(tenantId, "tenantId");
    const safeId = assertSafePathSegment(id, "id");
    if (this.isUsingLiveFirestore()) {
      return PersistentStoreService.remoteGetAtPath<LeadSummary>(
        this.firestoreDocPath(safeTenant, LEAD_SUMMARY_COLLECTION, safeId)
      );
    }
    return PersistentStoreService.get<LeadSummary>(
      this.storeKey(safeTenant, LEAD_SUMMARY_COLLECTION),
      safeId
    );
  }

  private static async computeMaxExistingNumber(
    tenantId: string,
    type: CrmEntityType,
    dateKey?: string
  ): Promise<number> {
    if (type === "daily_lead") {
      const targetDate = dateKey || getDailyLeadDateKey();
      const allLeads = await this.list(tenantId, "leads");
      return getMaxDailyLeadSequenceForDate(allLeads, targetDate);
    }

    const key = normalizeCounterKey(type);
    const prefix = PREFIX_MAP[type] || "X";
    let regex = new RegExp(`^${prefix}(\\d+)$`, "i");
    if (key === "request") regex = /^(?:R|RE)(\d+)$/i;
    if (key === "property") regex = /^(?:P|PR)(\d+)$/i;
    if (key === "client") regex = /^(?:C|CO|CL)(\d+)$/i;
    if (key === "staff") regex = /^(?:S|ST)(\d+)$/i;
    if (key === "document") regex = /^D(\d+)$/i;
    if (key === "activity") regex = /^(?:A|T)(\d+)$/i;

    let max = 0;
    const inspectDocs = (docs: Array<Record<string, any>>, fields: string[]) => {
      for (const d of docs) {
        for (const f of fields) {
          const val = d?.[f];
          if (!val) continue;
          const m = String(val).match(regex);
          if (m && m[1]) {
            const num = parseInt(m[1], 10);
            if (!isNaN(num) && num > max) max = num;
          }
        }
      }
    };

    if (key === "client") {
      inspectDocs(await this.list(tenantId, "contacts"), ["clientId", "contactId", "propertyId"]);
    } else if (key === "staff") {
      inspectDocs(await this.list(tenantId, "staff"), ["staffId", "personalId"]);
    } else if (key === "document") {
      inspectDocs(await this.list(tenantId, "documents"), ["documentId"]);
    } else if (key === "activity") {
      inspectDocs(await this.list(tenantId, "activities"), ["activityId", "tourId"]);
      inspectDocs(await this.list(tenantId, "tours"), ["activityId", "tourId"]);
    } else {
      inspectDocs(await this.list(tenantId, "leads"), ["propertyId"]);
    }

    return max;
  }

  /**
   * Generates an isolated sequential entity ID using per-entity sharded atomic counters at
   * `/tenants/{tenantId}/counters/{counterKey}` via Firestore `:commit` atomic `increment`.
   * Eliminates single-document write contention (1 write/sec Firestore limit) when many
   * concurrent agents create leads, properties, contacts, or activities simultaneously.
   * Seamlessly preserves numbering from legacy `/tenants/{tenantId}/counters/entities` docs.
   */
  public static async getNextEntityId(tenantId: string, type: CrmEntityType): Promise<string> {
    const safeTenant = assertSafePathSegment(tenantId, "tenantId");
    const isDaily = type === "daily_lead";
    const dateKey = isDaily ? getDailyLeadDateKey() : "";
    const key = isDaily ? `daily_lead_${dateKey}` : normalizeCounterKey(type);
    const prefix = PREFIX_MAP[type] || "X";

    const nextNum = await PersistentStoreService.withKeyMutex(
      `crm_counter::${safeTenant}::${key}`,
      async () => {
        if (this.isUsingLiveFirestore()) {
          const shardedPath = this.firestoreDocPath(safeTenant, "counters", key);
          const now = new Date().toISOString();

          // Atomic server-side increment on the sharded per-entity counter doc
          const incremented = await PersistentStoreService.remoteAtomicIncrement(
            shardedPath,
            "value",
            1,
            {
              tenantId: safeTenant,
              key,
              updatedAt: now,
            }
          );

          // If this is a brand-new sharded counter doc (value === 1), check legacy counter/docs once
          // so existing agencies never reset numbering during migration.
          if (incremented === 1) {
            let baseline = 0;
            try {
              const legacyCounterPath = this.firestoreDocPath(safeTenant, "counters", "entities");
              const legacyDoc = await PersistentStoreService.remoteGetAtPath<Record<string, any>>(
                legacyCounterPath
              );
              if (legacyDoc && typeof legacyDoc[key] === "number" && legacyDoc[key] > 0) {
                baseline = Math.floor(legacyDoc[key]);
              }
            } catch {
              // Legacy doc absent
            }
            if (baseline === 0) {
              try {
                baseline = await this.computeMaxExistingNumber(safeTenant, type, dateKey);
              } catch {
                baseline = 0;
              }
            }
            if (baseline > 0) {
              return await PersistentStoreService.remoteAtomicIncrement(
                shardedPath,
                "value",
                baseline,
                {
                  tenantId: safeTenant,
                  key,
                  updatedAt: new Date().toISOString(),
                }
              );
            }
          }

          return incremented;
        }

        const storeKey = this.counterStoreKey(safeTenant);
        let counters =
          PersistentStoreService.get<Record<string, any>>(storeKey, "entities") || null;

        if (!counters || typeof counters[key] !== "number") {
          const maxExisting = await this.computeMaxExistingNumber(safeTenant, type, dateKey);
          counters = {
            ...(counters || {}),
            tenantId: safeTenant,
            [key]: maxExisting,
          };
        }

        const newCount = Number(counters[key] || 0) + 1;
        counters[key] = newCount;
        counters.tenantId = safeTenant;
        delete counters.tenant_id;
        counters.updatedAt = new Date().toISOString();
        PersistentStoreService.set(storeKey, "entities", counters);
        return newCount;
      }
    );

    if (isDaily) {
      return formatDailyLeadId(dateKey, nextNum);
    }
    return `${prefix}${nextNum}`;
  }

  private static async readRawCollection(
    safeTenant: string,
    collectionName: CrmTenantCollection,
    filters?: { propertyId?: string; userId?: string; status?: string; limit?: number }
  ): Promise<Array<Record<string, any>>> {
    if (this.isUsingLiveFirestore()) {
      const effectiveLimit = Math.min(2000, Math.max(1, filters?.limit ?? 1000));
      const filterClauses: Array<Record<string, any>> = [];
      if (filters?.propertyId) {
        filterClauses.push({
          fieldFilter: {
            field: { fieldPath: "propertyId" },
            op: "EQUAL",
            value: { stringValue: filters.propertyId },
          },
        });
      }
      if (filters?.userId) {
        filterClauses.push({
          fieldFilter: {
            field: { fieldPath: "userId" },
            op: "EQUAL",
            value: { stringValue: filters.userId },
          },
        });
      }
      if (filters?.status) {
        filterClauses.push({
          fieldFilter: {
            field: { fieldPath: "status" },
            op: "EQUAL",
            value: { stringValue: filters.status },
          },
        });
      }

      // Use server-side indexed :runQuery when single equality filter is present (avoids O(N) scan
      // and uses Firestore's automatic single-field indexes without requiring custom composite indexes).
      if (filterClauses.length === 1) {
        try {
          const matched = await PersistentStoreService.remoteRunQueryAtPath<Record<string, any>>(
            `tenants/${safeTenant}`,
            {
              from: [{ collectionId: collectionName }],
              where: filterClauses[0],
              limit: effectiveLimit,
            }
          );
          return matched
            .map((m) => m.data)
            .filter((doc) => {
              const docTenant = doc.tenantId ?? doc.tenant_id;
              return !docTenant || docTenant === safeTenant;
            });
        } catch {
          // Graceful fallback to bounded collection list if test mock doesn't implement :runQuery
        }
      }

      const maxPages = Math.max(1, Math.ceil(effectiveLimit / 300));
      const isUserScopedToken =
        Boolean(PersistentStoreService.getRequestAuth()?.bearerToken) &&
        !PersistentStoreService.isMetadataAuthEnabled() &&
        PersistentStoreService.getAuthMethodInfo().method === "none";
      const docs = await PersistentStoreService.remoteListAtPath<Record<string, any>>(
        this.firestoreCollectionPath(safeTenant, collectionName),
        Math.min(300, effectiveLimit),
        maxPages,
        isUserScopedToken ? { silentOnStatuses: [403] } : undefined
      );
      return docs.filter((doc) => {
        const docTenant = doc.tenantId ?? doc.tenant_id;
        return !docTenant || docTenant === safeTenant;
      });
    }

    const allMap = PersistentStoreService.getAll<Record<string, any>>(
      this.storeKey(safeTenant, collectionName)
    );
    return Object.values(allMap).filter((doc) => {
      const docTenant = doc.tenantId ?? doc.tenant_id;
      return !docTenant || docTenant === safeTenant;
    });
  }

  public static async list(
    tenantId: string,
    collectionName: CrmTenantCollection,
    filters?: { propertyId?: string; userId?: string; status?: string; limit?: number }
  ): Promise<Array<Record<string, any>>> {
    this.assertValidCollection(collectionName);
    const safeTenant = assertSafePathSegment(tenantId, "tenantId");

    let rawItems = await this.readRawCollection(safeTenant, collectionName, filters);

    // Pure read-only fallback when reading canonical "staff" while legacy "personal" records still exist
    if (collectionName === "staff") {
      const legacyPersonal = await this.readRawCollection(safeTenant, "personal", filters);
      if (legacyPersonal.length > 0) {
        const seenIds = new Set(rawItems.map((item) => item.id));
        for (const legacyDoc of legacyPersonal) {
          if (!seenIds.has(legacyDoc.id)) {
            rawItems.push(legacyDoc);
          }
        }
      }
    }

    let items = rawItems.map((doc) => normalizeCrmDocument(doc, collectionName));

    if (filters?.propertyId) {
      items = items.filter((d) => d.propertyId === filters.propertyId);
    }
    if (filters?.userId) {
      items = items.filter((d) => d.userId === filters.userId);
    }
    if (filters?.status) {
      items = items.filter((d) => d.status === filters.status);
    }

    items.sort((a, b) => {
      const timeA = Date.parse(String(a.updatedAt || a.createdAt || 0)) || 0;
      const timeB = Date.parse(String(b.updatedAt || b.createdAt || 0)) || 0;
      return collectionName === "activities" || collectionName === "viewings"
        ? String(a.date || "").localeCompare(String(b.date || ""))
        : timeB - timeA;
    });

    if (filters?.limit && items.length > filters.limit) {
      items = items.slice(0, filters.limit);
    }

    return items;
  }

  public static async getById(
    tenantId: string,
    collectionName: CrmTenantCollection,
    id: string
  ): Promise<Record<string, any> | null> {
    this.assertValidCollection(collectionName);
    const safeTenant = assertSafePathSegment(tenantId, "tenantId");
    const safeId = assertSafePathSegment(id, "id");

    const fetchDirect = async (targetCol: CrmTenantCollection) =>
      this.isUsingLiveFirestore()
        ? await PersistentStoreService.remoteGetAtPath<Record<string, any>>(
            this.firestoreDocPath(safeTenant, targetCol, safeId)
          )
        : PersistentStoreService.get<Record<string, any>>(
            this.storeKey(safeTenant, targetCol),
            safeId
          );

    const direct =
      (await fetchDirect(collectionName)) ||
      (collectionName === "staff" ? await fetchDirect("personal") : null);

    if (direct) {
      const docTenant = direct.tenantId ?? direct.tenant_id;
      if (docTenant && docTenant !== safeTenant) {
        throw new ForbiddenError("Acces interzis: înregistrarea aparține altei agenții.");
      }
      return normalizeCrmDocument(direct, collectionName);
    }

    if (collectionName === "leads") {
      // Indexed O(1) lookup by propertyId instead of scanning all agency leads
      if (this.isUsingLiveFirestore()) {
        try {
          const matched = await PersistentStoreService.remoteRunQueryAtPath<Record<string, any>>(
            `tenants/${safeTenant}`,
            {
              from: [{ collectionId: "leads" }],
              where: {
                fieldFilter: {
                  field: { fieldPath: "propertyId" },
                  op: "EQUAL",
                  value: { stringValue: safeId },
                },
              },
              limit: 1,
            }
          );
          if (matched.length > 0 && matched[0].data) {
            const docTenant = matched[0].data.tenantId ?? matched[0].data.tenant_id;
            if (!docTenant || docTenant === safeTenant) {
              return normalizeCrmDocument(matched[0].data, "leads");
            }
          }
          return null;
        } catch {
          // Fallback to bounded list only if query fails in mock tests
        }
      }

      const all = await this.list(safeTenant, "leads");
      const found = all.find(
        (d) =>
          d.id === safeId ||
          d.propertyId === safeId ||
          d.extractedData?.propertyId === safeId
      );
      if (found) return found;
    }

    return null;
  }

  public static async create(
    tenantId: string,
    collectionName: CrmTenantCollection,
    rawData: Record<string, any>,
    actorUserId: string
  ): Promise<Record<string, any>> {
    this.assertValidCollection(collectionName);
    const safeTenant = assertSafePathSegment(tenantId, "tenantId");
    const sanitized = sanitizePayloadTimestamps(rawData);
    delete sanitized.tenantId;
    delete sanitized.tenant_id;
    delete sanitized.created_at;
    delete sanitized.updated_at;

    const now = new Date().toISOString();
    const id =
      typeof sanitized.id === "string" && sanitized.id.trim()
        ? assertSafePathSegment(sanitized.id.trim(), "id")
        : `${collectionName.slice(0, 3)}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;

    const doc: Record<string, any> = {
      ...sanitized,
      id,
      tenantId: safeTenant,
      createdByUid: actorUserId,
      createdAt: sanitized.createdAt || now,
      updatedAt: now,
    };

    if (collectionName === "leads") {
      if (typeof doc.status === "string") {
        doc.status = toDisplayLeadStatus(doc.status) || doc.status;
      }
      const isSelectedOrLost = doc.status === "ListaMea" || doc.status === "Pierdute";
      if (!doc.propertyId) {
        if (isCererePayload(doc)) {
          doc.propertyId = await this.getNextEntityId(safeTenant, "cerere");
        } else if (PROPRIETATI_STATUSES.has(doc.status)) {
          doc.propertyId = await this.getNextEntityId(safeTenant, "property");
        } else if (isSelectedOrLost) {
          doc.propertyId = await this.getNextEntityId(safeTenant, "lead");
        } else {
          doc.propertyId = await this.getNextEntityId(safeTenant, "daily_lead");
        }
      } else if (isSelectedOrLost && !isAgencyLeadId(doc.propertyId)) {
        if (!doc.sourcePropertyId) {
          doc.sourcePropertyId = doc.propertyId;
        }
        doc.propertyId = await this.getNextEntityId(safeTenant, "lead");
      }
      doc.lastMovedAt = doc.lastMovedAt || now;
      doc.docVersion = 1;
      doc.deletedAt = doc.status === "Sterse" ? now : null;
      syncLeadDerivedFields(doc, sanitized, undefined, { isCreate: true });
    } else if (collectionName === "contacts" && !doc.contactId) {
      doc.contactId = await this.getNextEntityId(safeTenant, "client");
    } else if (collectionName === "staff") {
      if (doc.status !== undefined) {
        doc.status = toDisplayStaffStatus(doc.status);
      }
      if (!doc.staffId && !doc.personalId) {
        doc.staffId = await this.getNextEntityId(safeTenant, "staff");
      } else if (!doc.staffId && doc.personalId) {
        doc.staffId = doc.personalId;
      }
    } else if (collectionName === "personal" && !doc.personalId) {
      doc.personalId = await this.getNextEntityId(safeTenant, "personal");
    } else if (collectionName === "documents" && !doc.documentId) {
      doc.documentId = await this.getNextEntityId(safeTenant, "document");
    } else if (collectionName === "activities") {
      if (!doc.activityId) {
        doc.activityId = await this.getNextEntityId(safeTenant, "activity");
      }
      doc.type = doc.type || "Vizionare";
      doc.status = doc.status || "Programată";
    }

    if (collectionName === "activities") {
      const tourDoc = {
        id: `tour_${id}`,
        tenantId: safeTenant,
        tourId: doc.activityId,
        activityId: doc.activityId,
        propertyId: doc.propertyId || "",
        clientId: doc.clientId || "",
        clientName: doc.clientName || "Client",
        clientPhone: doc.clientPhone || "",
        staffId: doc.staffId || "",
        staffName: doc.staffName || "",
        date: doc.date,
        hour: doc.hour,
        status: doc.status || "Programată",
        notes: doc.notes || "",
        createdAt: now,
        updatedAt: now,
      };

      const viewingDoc = {
        id: `view_${id}`,
        tenantId: safeTenant,
        propertyId: doc.propertyId || "",
        contactId: doc.clientId || doc.activityId,
        contactName: doc.clientName || "Client",
        agentId: doc.staffId || "",
        agentName: doc.staffName || "",
        date: doc.date,
        hour: doc.hour,
        activityId: doc.activityId,
        createdAt: now,
        updatedAt: now,
      };

      if (this.isUsingLiveFirestore()) {
        // Single atomic multi-document Firestore batch commit instead of 3 sequential RPCs
        const { projectId, databaseId } = PersistentStoreService.getFirebaseTarget();
        const basePrefix = `projects/${projectId}/databases/${databaseId}/documents/tenants/${safeTenant}`;
        await PersistentStoreService.remoteCommitWrites(
          [
            {
              update: {
                name: `${basePrefix}/activities/${id}`,
                fields: PersistentStoreService.encodeDocumentFields(doc),
              },
            },
            {
              update: {
                name: `${basePrefix}/tours/${tourDoc.id}`,
                fields: PersistentStoreService.encodeDocumentFields(tourDoc),
              },
            },
            {
              update: {
                name: `${basePrefix}/viewings/${viewingDoc.id}`,
                fields: PersistentStoreService.encodeDocumentFields(viewingDoc),
              },
            },
          ],
          "create_activity_batch"
        );
      } else {
        PersistentStoreService.set(this.storeKey(safeTenant, collectionName), id, doc);
        PersistentStoreService.set(this.storeKey(safeTenant, "tours"), tourDoc.id, tourDoc);
        PersistentStoreService.set(this.storeKey(safeTenant, "viewings"), viewingDoc.id, viewingDoc);
      }
    } else if (collectionName === "leads") {
      await this.commitLeadWithSummary(safeTenant, doc, "create_lead_dual_write");
    } else if (this.isUsingLiveFirestore()) {
      await PersistentStoreService.remoteSetAtPath(
        this.firestoreDocPath(safeTenant, collectionName, id),
        doc
      );
    } else {
      PersistentStoreService.set(this.storeKey(safeTenant, collectionName), id, doc);
    }

    // Automatically sync agency staff email into /tenants/{tenantId}/invites/{email}
    // so added agents/managers/admins immediately have permanent Firestore access on sign-in.
    if ((collectionName === "staff" || collectionName === "personal") && doc.email) {
      const isInactive =
        String(doc.status || "").toLowerCase() === "inactiv" ||
        String(doc.status || "").toLowerCase() === "inactive";
      await TenantMembershipService.upsertInviteForStaffEmailAsync(safeTenant, {
        email: String(doc.email),
        name: String(doc.name || ""),
        role: String(doc.role || "agent"),
        active: !isInactive,
      });
    }

    return normalizeCrmDocument(doc, collectionName);
  }

  public static async update(
    tenantId: string,
    collectionName: CrmTenantCollection,
    id: string,
    patch: Record<string, any>
  ): Promise<Record<string, any>> {
    this.assertValidCollection(collectionName);
    const safeTenant = assertSafePathSegment(tenantId, "tenantId");
    const safeId = assertSafePathSegment(id, "id");

    const existing = await this.getById(safeTenant, collectionName, safeId);
    if (!existing) {
      throw new NotFoundError(`Înregistrarea ${collectionName}`, safeId);
    }
    const existingTenant = existing.tenantId ?? existing.tenant_id;
    if (existingTenant && existingTenant !== safeTenant) {
      throw new ForbiddenError("Acces interzis: documentul aparține altei agenții.");
    }

    const sanitized = sanitizePayloadTimestamps(patch);
    delete sanitized.tenantId;
    delete sanitized.tenant_id;
    delete sanitized.id;
    delete sanitized.created_at;
    delete sanitized.updated_at;

    const targetDocId = existing.id || safeId;
    const now = new Date().toISOString();
    const updated: Record<string, any> = {
      ...existing,
      id: targetDocId,
      tenantId: safeTenant,
      updatedAt: now,
    };
    delete updated.tenant_id;

    const existingCriteria =
      existing.criteriiFormular && typeof existing.criteriiFormular === "object"
        ? { ...existing.criteriiFormular }
        : existing.extractedData?.crmData?.criteriiFormular &&
            typeof existing.extractedData.crmData.criteriiFormular === "object"
          ? { ...existing.extractedData.crmData.criteriiFormular }
          : undefined;

    for (const [key, val] of Object.entries(sanitized)) {
      if (key.includes(".")) {
        const parts = key.split(".");
        let curr = updated;
        for (let i = 0; i < parts.length - 1; i++) {
          const p = parts[i];
          if (!curr[p] || typeof curr[p] !== "object") {
            curr[p] = {};
          } else {
            curr[p] = { ...curr[p] };
          }
          curr = curr[p];
        }
        curr[parts[parts.length - 1]] = val;
      } else {
        updated[key] = val;
      }
    }

    if (collectionName === "leads" && typeof updated.status === "string") {
      updated.status = toDisplayLeadStatus(updated.status) || updated.status;
    }
    if (collectionName === "leads") {
      syncLeadDerivedFields(updated, sanitized, existingCriteria);
    }
    if (collectionName === "staff" && updated.status !== undefined) {
      updated.status = toDisplayStaffStatus(updated.status);
    }

    if (
      collectionName === "leads" &&
      sanitized.status &&
      (updated.status === "ListaMea" || updated.status === "Pierdute") &&
      !isAgencyLeadId(updated.propertyId)
    ) {
      if (updated.propertyId && !updated.sourcePropertyId) {
        updated.sourcePropertyId = updated.propertyId;
      }
      updated.propertyId = await this.getNextEntityId(safeTenant, "lead");
    }
    if (
      collectionName === "leads" &&
      sanitized.status &&
      (PROPRIETATI_STATUSES.has(updated.status) || updated.status === "Activa") &&
      (!updated.propertyId || isAgencyLeadId(updated.propertyId) || isDailyLeadId(updated.propertyId))
    ) {
      updated.propertyId = await this.getNextEntityId(safeTenant, "property");
    }
    if (collectionName === "leads" && sanitized.status) {
      updated.lastMovedAt = now;
    }

    let writeCollection: CrmTenantCollection = collectionName;
    if (collectionName === "staff") {
      const existsInStaff = this.isUsingLiveFirestore()
        ? await PersistentStoreService.remoteGetAtPath<Record<string, any>>(
            this.firestoreDocPath(safeTenant, "staff", targetDocId)
          )
        : PersistentStoreService.get<Record<string, any>>(
            this.storeKey(safeTenant, "staff"),
            targetDocId
          );
      if (!existsInStaff) {
        const existsInPersonal = this.isUsingLiveFirestore()
          ? await PersistentStoreService.remoteGetAtPath<Record<string, any>>(
              this.firestoreDocPath(safeTenant, "personal", targetDocId)
            )
          : PersistentStoreService.get<Record<string, any>>(
              this.storeKey(safeTenant, "personal"),
              targetDocId
            );
        if (existsInPersonal) {
          writeCollection = "personal";
        }
      }
    }

    if (collectionName === "leads") {
      const prevVersion = Number(existing.docVersion);
      updated.docVersion = Number.isFinite(prevVersion) && prevVersion >= 1 ? Math.floor(prevVersion) + 1 : 2;
      updated.deletedAt = updated.status === "Sterse" ? existing.deletedAt || now : null;
      await this.commitLeadWithSummary(safeTenant, updated, "update_lead_dual_write");
    } else if (collectionName === "activities") {
      const tourDocId = `tour_${targetDocId}`;
      const viewingDocId = `view_${targetDocId}`;
      const tourDoc = {
        id: tourDocId,
        tenantId: safeTenant,
        tourId: updated.activityId || targetDocId,
        activityId: updated.activityId || targetDocId,
        propertyId: updated.propertyId || "",
        clientId: updated.clientId || "",
        clientName: updated.clientName || "Client",
        clientPhone: updated.clientPhone || "",
        staffId: updated.staffId || "",
        staffName: updated.staffName || "",
        date: updated.date,
        hour: updated.hour,
        status: updated.status || "Programată",
        notes: updated.notes || "",
        createdAt: updated.createdAt || now,
        updatedAt: now,
      };
      const viewingDoc = {
        id: viewingDocId,
        tenantId: safeTenant,
        propertyId: updated.propertyId || "",
        contactId: updated.clientId || updated.activityId || targetDocId,
        contactName: updated.clientName || "Client",
        agentId: updated.staffId || "",
        agentName: updated.staffName || "",
        date: updated.date,
        hour: updated.hour,
        activityId: updated.activityId || targetDocId,
        createdAt: updated.createdAt || now,
        updatedAt: now,
      };

      if (this.isUsingLiveFirestore()) {
        const { projectId, databaseId } = PersistentStoreService.getFirebaseTarget();
        const basePrefix = `projects/${projectId}/databases/${databaseId}/documents/tenants/${safeTenant}`;
        await PersistentStoreService.remoteCommitWrites(
          [
            {
              update: {
                name: `${basePrefix}/activities/${targetDocId}`,
                fields: PersistentStoreService.encodeDocumentFields(updated),
              },
            },
            {
              update: {
                name: `${basePrefix}/tours/${tourDocId}`,
                fields: PersistentStoreService.encodeDocumentFields(tourDoc),
              },
            },
            {
              update: {
                name: `${basePrefix}/viewings/${viewingDocId}`,
                fields: PersistentStoreService.encodeDocumentFields(viewingDoc),
              },
            },
          ],
          "update_activity_batch"
        );
      } else {
        PersistentStoreService.set(this.storeKey(safeTenant, "activities"), targetDocId, updated);
        PersistentStoreService.set(this.storeKey(safeTenant, "tours"), tourDocId, tourDoc);
        PersistentStoreService.set(this.storeKey(safeTenant, "viewings"), viewingDocId, viewingDoc);
      }
    } else if (this.isUsingLiveFirestore()) {
      await PersistentStoreService.remoteSetAtPath(
        this.firestoreDocPath(safeTenant, writeCollection, targetDocId),
        updated
      );
      if (collectionName === "viewings" && targetDocId.startsWith("view_")) {
        const mirroredActId = targetDocId.slice("view_".length);
        const mirroredAct = await PersistentStoreService.remoteGetAtPath<Record<string, any>>(
          this.firestoreDocPath(safeTenant, "activities", mirroredActId)
        ).catch(() => null);
        if (mirroredAct) {
          const syncedAct = {
            ...mirroredAct,
            propertyId: updated.propertyId ?? mirroredAct.propertyId,
            clientId: updated.contactId ?? mirroredAct.clientId,
            clientName: updated.contactName ?? mirroredAct.clientName,
            staffId: updated.agentId ?? mirroredAct.staffId,
            staffName: updated.agentName ?? mirroredAct.staffName,
            date: updated.date ?? mirroredAct.date,
            hour: updated.hour ?? mirroredAct.hour,
            updatedAt: now,
          };
          await PersistentStoreService.remoteSetAtPath(
            this.firestoreDocPath(safeTenant, "activities", mirroredActId),
            syncedAct
          ).catch(() => {});
          await PersistentStoreService.remoteSetAtPath(
            this.firestoreDocPath(safeTenant, "tours", `tour_${mirroredActId}`),
            {
              id: `tour_${mirroredActId}`,
              tenantId: safeTenant,
              tourId: syncedAct.activityId || mirroredActId,
              activityId: syncedAct.activityId || mirroredActId,
              propertyId: syncedAct.propertyId || "",
              clientId: syncedAct.clientId || "",
              clientName: syncedAct.clientName || "Client",
              clientPhone: syncedAct.clientPhone || "",
              staffId: syncedAct.staffId || "",
              staffName: syncedAct.staffName || "",
              date: syncedAct.date,
              hour: syncedAct.hour,
              status: syncedAct.status || "Programată",
              notes: syncedAct.notes || "",
              createdAt: syncedAct.createdAt || now,
              updatedAt: now,
            }
          ).catch(() => {});
        }
      }
    } else {
      PersistentStoreService.set(this.storeKey(safeTenant, writeCollection), targetDocId, updated);
      if (collectionName === "viewings" && targetDocId.startsWith("view_")) {
        const mirroredActId = targetDocId.slice("view_".length);
        const mirroredAct = PersistentStoreService.get<Record<string, any>>(
          this.storeKey(safeTenant, "activities"),
          mirroredActId
        );
        if (mirroredAct) {
          const syncedAct: Record<string, any> = {
            ...mirroredAct,
            propertyId: updated.propertyId ?? mirroredAct.propertyId,
            clientId: updated.contactId ?? mirroredAct.clientId,
            clientName: updated.contactName ?? mirroredAct.clientName,
            staffId: updated.agentId ?? mirroredAct.staffId,
            staffName: updated.agentName ?? mirroredAct.staffName,
            date: updated.date ?? mirroredAct.date,
            hour: updated.hour ?? mirroredAct.hour,
            updatedAt: now,
          };
          PersistentStoreService.set(this.storeKey(safeTenant, "activities"), mirroredActId, syncedAct);
          PersistentStoreService.set(this.storeKey(safeTenant, "tours"), `tour_${mirroredActId}`, {
            id: `tour_${mirroredActId}`,
            tenantId: safeTenant,
            tourId: syncedAct.activityId || mirroredActId,
            activityId: syncedAct.activityId || mirroredActId,
            propertyId: syncedAct.propertyId || "",
            clientId: syncedAct.clientId || "",
            clientName: syncedAct.clientName || "Client",
            clientPhone: syncedAct.clientPhone || "",
            staffId: syncedAct.staffId || "",
            staffName: syncedAct.staffName || "",
            date: syncedAct.date,
            hour: syncedAct.hour,
            status: syncedAct.status || "Programată",
            notes: syncedAct.notes || "",
            createdAt: syncedAct.createdAt || now,
            updatedAt: now,
          });
        }
      }
    }

    if ((collectionName === "staff" || collectionName === "personal") && updated.email) {
      const isInactive =
        String(updated.status || "").toLowerCase() === "inactiv" ||
        String(updated.status || "").toLowerCase() === "inactive";
      await TenantMembershipService.upsertInviteForStaffEmailAsync(safeTenant, {
        email: String(updated.email),
        name: String(updated.name || ""),
        role: String(updated.role || "agent"),
        active: !isInactive,
      });
    }

    return normalizeCrmDocument(updated, collectionName);
  }

  public static async delete(
    tenantId: string,
    collectionName: CrmTenantCollection,
    id: string
  ): Promise<boolean> {
    this.assertValidCollection(collectionName);
    const safeTenant = assertSafePathSegment(tenantId, "tenantId");
    const safeId = assertSafePathSegment(id, "id");

    const existing = await this.getById(safeTenant, collectionName, safeId);
    if (!existing) {
      throw new NotFoundError(`Înregistrarea ${collectionName}`, safeId);
    }
    const existingTenant = existing.tenantId ?? existing.tenant_id;
    if (existingTenant && existingTenant !== safeTenant) {
      throw new ForbiddenError("Acces interzis: documentul aparține altei agenții.");
    }

    const targetDocId = existing.id || safeId;
    if (collectionName === "leads") {
      return await this.deleteLeadWithSummary(safeTenant, targetDocId);
    }
    if (collectionName === "activities") {
      const tourDocId = `tour_${targetDocId}`;
      const viewingDocId = `view_${targetDocId}`;
      if (this.isUsingLiveFirestore()) {
        const { projectId, databaseId } = PersistentStoreService.getFirebaseTarget();
        const basePrefix = `projects/${projectId}/databases/${databaseId}/documents/tenants/${safeTenant}`;
        await PersistentStoreService.remoteCommitWrites(
          [
            { delete: `${basePrefix}/activities/${targetDocId}` },
            { delete: `${basePrefix}/tours/${tourDocId}` },
            { delete: `${basePrefix}/viewings/${viewingDocId}` },
          ],
          "delete_activity_batch"
        );
        return true;
      }
      const deletedAct = PersistentStoreService.delete(this.storeKey(safeTenant, "activities"), targetDocId);
      PersistentStoreService.delete(this.storeKey(safeTenant, "tours"), tourDocId);
      PersistentStoreService.delete(this.storeKey(safeTenant, "viewings"), viewingDocId);
      return deletedAct;
    }
    if (this.isUsingLiveFirestore()) {
      await PersistentStoreService.remoteDeleteAtPath(
        this.firestoreDocPath(safeTenant, collectionName, targetDocId)
      );
      if (collectionName === "staff") {
        await PersistentStoreService.remoteDeleteAtPath(
          this.firestoreDocPath(safeTenant, "personal", targetDocId)
        ).catch(() => {});
      }
      if (collectionName === "viewings" && targetDocId.startsWith("view_")) {
        const mirroredActId = targetDocId.slice("view_".length);
        await PersistentStoreService.remoteDeleteAtPath(
          this.firestoreDocPath(safeTenant, "activities", mirroredActId)
        ).catch(() => {});
        await PersistentStoreService.remoteDeleteAtPath(
          this.firestoreDocPath(safeTenant, "tours", `tour_${mirroredActId}`)
        ).catch(() => {});
      }
      return true;
    }
    const deleted = PersistentStoreService.delete(this.storeKey(safeTenant, collectionName), targetDocId);
    if (collectionName === "staff") {
      const deletedLegacy = PersistentStoreService.delete(
        this.storeKey(safeTenant, "personal"),
        targetDocId
      );
      return deleted || deletedLegacy;
    }
    if (collectionName === "viewings" && targetDocId.startsWith("view_")) {
      const mirroredActId = targetDocId.slice("view_".length);
      PersistentStoreService.delete(this.storeKey(safeTenant, "activities"), mirroredActId);
      PersistentStoreService.delete(this.storeKey(safeTenant, "tours"), `tour_${mirroredActId}`);
    }
    return deleted;
  }

  public static async clearTenantCollection(
    tenantId: string,
    collectionName: CrmTenantCollection
  ): Promise<void> {
    this.assertValidCollection(collectionName);
    const safeTenant = assertSafePathSegment(tenantId, "tenantId");

    if (this.isUsingLiveFirestore()) {
      const existingDocs = await this.list(safeTenant, collectionName);
      if (existingDocs.length === 0) return;

      const { projectId, databaseId } = PersistentStoreService.getFirebaseTarget();
      const tenantPrefix = `projects/${projectId}/databases/${databaseId}/documents/tenants/${safeTenant}`;
      const isUserToken = PersistentStoreService.isUsingUserScopedToken();

      if (collectionName === "leads") {
        // 200 leads * 2 writes (canonical + summary) = 400 writes <= 500 Firestore batch limit
        for (let i = 0; i < existingDocs.length; i += 200) {
          const chunk = existingDocs.slice(i, i + 200).filter((d) => Boolean(d.id));
          const dualWrites = chunk.flatMap((d) => [
            { delete: `${tenantPrefix}/leads/${d.id}` },
            { delete: `${tenantPrefix}/${LEAD_SUMMARY_COLLECTION}/${d.id}` },
          ]);
          try {
            await PersistentStoreService.remoteCommitWrites(
              dualWrites,
              `clearTenantCollection(leads+leads_summary)`,
              isUserToken ? { silentOnStatuses: [403] } : undefined
            );
          } catch (err: any) {
            if (isUserToken && err?.statusCode === 403) {
              const canonicalOnly = chunk.map((d) => ({
                delete: `${tenantPrefix}/leads/${d.id}`,
              }));
              await PersistentStoreService.remoteCommitWrites(
                canonicalOnly,
                `clearTenantCollection(leads)`
              );
            } else {
              throw err;
            }
          }
        }
        return;
      }

      const baseDocPrefix = `${tenantPrefix}/${collectionName}`;
      for (let i = 0; i < existingDocs.length; i += 400) {
        const chunk = existingDocs.slice(i, i + 400);
        const writes = chunk
          .filter((d) => Boolean(d.id))
          .map((d) => ({
            delete: `${baseDocPrefix}/${d.id}`,
          }));
        await PersistentStoreService.remoteCommitWrites(
          writes,
          `clearTenantCollection(${collectionName})`
        );
      }
      return;
    }

    PersistentStoreService.clearCollection(this.storeKey(safeTenant, collectionName));
    if (collectionName === "leads") {
      PersistentStoreService.clearCollection(this.storeKey(safeTenant, LEAD_SUMMARY_COLLECTION));
    }
  }

  public static async upsertFcmToken(params: {
    tenantId: string;
    userId: string;
    email?: string;
    token: string;
    devicePlatform?: string;
    userAgent?: string;
  }): Promise<Record<string, any>> {
    const safeTenant = assertSafePathSegment(params.tenantId, "tenantId");
    const safeTokenId = assertSafePathSegment(params.token, "fcmToken");

    const record = {
      id: safeTokenId,
      token: params.token,
      userId: params.userId,
      email: params.email || "",
      tenantId: safeTenant,
      devicePlatform: params.devicePlatform || "Unknown",
      userAgent: params.userAgent || "UnknownBrowser",
      updatedAt: new Date().toISOString(),
    };

    if (this.isUsingLiveFirestore()) {
      await PersistentStoreService.remoteSetAtPath(
        this.firestoreDocPath(safeTenant, "fcm_tokens", safeTokenId),
        record
      );
    } else {
      PersistentStoreService.set(this.storeKey(safeTenant, "fcm_tokens"), safeTokenId, record);
    }
    return record;
  }

  public static async deleteFcmToken(
    tenantId: string,
    userId: string,
    token: string
  ): Promise<boolean> {
    const safeTenant = assertSafePathSegment(tenantId, "tenantId");
    const safeTokenId = assertSafePathSegment(token, "fcmToken");

    const existing = this.isUsingLiveFirestore()
      ? await PersistentStoreService.remoteGetAtPath<Record<string, any>>(
          this.firestoreDocPath(safeTenant, "fcm_tokens", safeTokenId)
        )
      : PersistentStoreService.get<Record<string, any>>(
          this.storeKey(safeTenant, "fcm_tokens"),
          safeTokenId
        );

    if (!existing) return false;
    const existingTenant = existing.tenantId ?? existing.tenant_id;
    if (existingTenant !== safeTenant || existing.userId !== userId) {
      throw new ForbiddenError("Acces interzis la ștergerea token-ului FCM.");
    }

    if (this.isUsingLiveFirestore()) {
      await PersistentStoreService.remoteDeleteAtPath(
        this.firestoreDocPath(safeTenant, "fcm_tokens", safeTokenId)
      );
      return true;
    }
    return PersistentStoreService.delete(this.storeKey(safeTenant, "fcm_tokens"), safeTokenId);
  }

  /**
   * Resolves a property/lead/cerere across registered tenants in tenant-scoped store ONLY for sanitized public viewing.
   * Supports matching by document id OR sequential entity code (e.g. L123, P123, R123, C123),
   * checking preferredTenantId first when a request arrives on an agency subdomain.
   */
  public static async findPublicPropertyAcrossTenants(
    id: string,
    preferredTenantId?: string | null
  ): Promise<Record<string, any> | null> {
    const cleanId = String(id || "").trim();
    if (!cleanId) return null;

    const candidateCodes = new Set<string>([cleanId.toUpperCase()]);
    const cerereC = cleanId.match(/^C(\d+)$/i);
    if (cerereC) candidateCodes.add(`R${cerereC[1]}`);
    const cerereR = cleanId.match(/^R(\d+)$/i);
    if (cerereR) candidateCodes.add(`C${cerereR[1]}`);

    const allTenants = TenantResolutionService.getAllTenants();
    const orderedTenants = preferredTenantId
      ? [
          ...allTenants.filter((t) => t.id === preferredTenantId),
          ...allTenants.filter((t) => t.id !== preferredTenantId),
        ]
      : allTenants;

    for (const t of orderedTenants) {
      try {
        const direct = await this.getById(t.id, "leads", cleanId);
        if (direct) {
          return direct;
        }

        for (const code of candidateCodes) {
          if (code === cleanId) continue;
          const byAltCode = await this.getById(t.id, "leads", code);
          if (byAltCode) {
            return byAltCode;
          }
        }
      } catch {
        // Skip tenants inaccessible under current credentials
      }
    }
    return null;
  }
}
