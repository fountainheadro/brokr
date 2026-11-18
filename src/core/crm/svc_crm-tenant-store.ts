import crypto from "crypto";
import { PersistentStoreService } from "../database/svc_persistent-store";
import { TenantResolutionService } from "../tenancy/svc_tenant-resolution";
import { ForbiddenError, NotFoundError, AppError } from "../errors/app_error";
import {
  normalizeCrmDocument,
  toDisplayLeadStatus,
  toDisplayStaffStatus,
} from "./svc_crm-normalizer";

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
  if (l.propertyId && (String(l.propertyId).startsWith("P") || String(l.propertyId).startsWith("L"))) {
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

function sanitizePayloadTimestamps(data: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (v === undefined) continue;
    if (
      v &&
      typeof v === "object" &&
      (v._methodName === "serverTimestamp" || typeof v.isEqual === "function")
    ) {
      out[k] = new Date().toISOString();
    } else {
      out[k] = v;
    }
  }
  return out;
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
    if (process.env.NODE_ENV === "production") {
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

  private static async computeMaxExistingNumber(
    tenantId: string,
    type: CrmEntityType
  ): Promise<number> {
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
   * Generates an isolated sequential entity ID strictly within `/tenants/{tenantId}/counters/entities`.
   * Agency A and Agency B maintain independent P/R/L/C/S/D/A numbering sequences.
   */
  public static async getNextEntityId(tenantId: string, type: CrmEntityType): Promise<string> {
    const safeTenant = assertSafePathSegment(tenantId, "tenantId");
    const key = normalizeCounterKey(type);
    const prefix = PREFIX_MAP[type] || "X";

    const nextNum = await PersistentStoreService.withKeyMutex(
      `crm_counter::${safeTenant}`,
      async () => {
        if (this.isUsingLiveFirestore()) {
          const counterPath = this.firestoreDocPath(safeTenant, "counters", "entities");
          let counters = await PersistentStoreService.remoteGetAtPath<Record<string, any>>(
            counterPath
          );

          if (!counters || typeof counters[key] !== "number") {
            const maxExisting = await this.computeMaxExistingNumber(safeTenant, type);
            counters = {
              ...(counters || {}),
              tenantId: safeTenant,
              [key]: maxExisting,
            };
          }

          const newCount = Number(counters[key] || 0) + 1;
          const updatedCounters = {
            ...counters,
            [key]: newCount,
            tenantId: safeTenant,
            updatedAt: new Date().toISOString(),
          };
          delete (updatedCounters as any).tenant_id;
          delete (updatedCounters as any).id;
          await PersistentStoreService.remoteSetAtPath(counterPath, updatedCounters);
          return newCount;
        }

        const storeKey = this.counterStoreKey(safeTenant);
        let counters =
          PersistentStoreService.get<Record<string, any>>(storeKey, "entities") || null;

        if (!counters || typeof counters[key] !== "number") {
          const maxExisting = await this.computeMaxExistingNumber(safeTenant, type);
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

    if (key === "document") {
      return `${prefix}${nextNum < 10 ? `0${nextNum}` : `${nextNum}`}`;
    }
    return `${prefix}${nextNum}`;
  }

  private static async readRawCollection(
    safeTenant: string,
    collectionName: CrmTenantCollection
  ): Promise<Array<Record<string, any>>> {
    if (this.isUsingLiveFirestore()) {
      const docs = await PersistentStoreService.remoteListAtPath<Record<string, any>>(
        this.firestoreCollectionPath(safeTenant, collectionName)
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
    filters?: { propertyId?: string; userId?: string }
  ): Promise<Array<Record<string, any>>> {
    this.assertValidCollection(collectionName);
    const safeTenant = assertSafePathSegment(tenantId, "tenantId");

    let rawItems = await this.readRawCollection(safeTenant, collectionName);

    // Pure read-only fallback when reading canonical "staff" while legacy "personal" records still exist
    if (collectionName === "staff") {
      const legacyPersonal = await this.readRawCollection(safeTenant, "personal");
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

    items.sort((a, b) => {
      const timeA = Date.parse(String(a.updatedAt || a.createdAt || 0)) || 0;
      const timeB = Date.parse(String(b.updatedAt || b.createdAt || 0)) || 0;
      return collectionName === "activities" || collectionName === "viewings"
        ? String(a.date || "").localeCompare(String(b.date || ""))
        : timeB - timeA;
    });

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
      if (!doc.propertyId) {
        if (isCererePayload(doc)) {
          doc.propertyId = await this.getNextEntityId(safeTenant, "cerere");
        } else if (PROPRIETATI_STATUSES.has(doc.status)) {
          doc.propertyId = await this.getNextEntityId(safeTenant, "property");
        } else {
          doc.propertyId = await this.getNextEntityId(safeTenant, "lead");
        }
      }
      doc.lastMovedAt = doc.lastMovedAt || now;
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

    if (this.isUsingLiveFirestore()) {
      await PersistentStoreService.remoteSetAtPath(
        this.firestoreDocPath(safeTenant, collectionName, id),
        doc
      );
    } else {
      PersistentStoreService.set(this.storeKey(safeTenant, collectionName), id, doc);
    }

    // Dual-write mirrors for activities cleanly inside the SAME tenant
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
        await Promise.all([
          PersistentStoreService.remoteSetAtPath(
            this.firestoreDocPath(safeTenant, "tours", tourDoc.id),
            tourDoc
          ),
          PersistentStoreService.remoteSetAtPath(
            this.firestoreDocPath(safeTenant, "viewings", viewingDoc.id),
            viewingDoc
          ),
        ]);
      } else {
        PersistentStoreService.set(this.storeKey(safeTenant, "tours"), tourDoc.id, tourDoc);
        PersistentStoreService.set(this.storeKey(safeTenant, "viewings"), viewingDoc.id, viewingDoc);
      }
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
    if (collectionName === "staff" && updated.status !== undefined) {
      updated.status = toDisplayStaffStatus(updated.status);
    }

    if (
      collectionName === "leads" &&
      sanitized.status &&
      (PROPRIETATI_STATUSES.has(updated.status) || updated.status === "Activa") &&
      (!updated.propertyId || String(updated.propertyId).startsWith("L"))
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

    if (this.isUsingLiveFirestore()) {
      await PersistentStoreService.remoteSetAtPath(
        this.firestoreDocPath(safeTenant, writeCollection, targetDocId),
        updated
      );
    } else {
      PersistentStoreService.set(this.storeKey(safeTenant, writeCollection), targetDocId, updated);
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
    if (this.isUsingLiveFirestore()) {
      await PersistentStoreService.remoteDeleteAtPath(
        this.firestoreDocPath(safeTenant, collectionName, targetDocId)
      );
      if (collectionName === "staff") {
        await PersistentStoreService.remoteDeleteAtPath(
          this.firestoreDocPath(safeTenant, "personal", targetDocId)
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
      const baseDocPrefix = `projects/${projectId}/databases/${databaseId}/documents/tenants/${safeTenant}/${collectionName}`;
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
   * Resolves a property across registered tenants in tenant-scoped store ONLY for sanitized public viewing.
   */
  public static async findPublicPropertyAcrossTenants(
    id: string
  ): Promise<Record<string, any> | null> {
    const tenants = TenantResolutionService.getAllTenants();
    for (const t of tenants) {
      const found = await this.getById(t.id, "leads", id);
      if (found) {
        return found;
      }
    }
    return null;
  }
}
