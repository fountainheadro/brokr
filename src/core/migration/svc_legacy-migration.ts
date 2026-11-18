import fs from "fs";
import path from "path";
import crypto from "crypto";
import axios from "axios";
import { PersistentStoreService } from "../database/svc_persistent-store";
import { TenantResolutionService } from "../tenancy/svc_tenant-resolution";
import { TenantMembershipService } from "../tenancy/svc_tenant-membership";
import { PlatformAuditLogRepository } from "../platform/repo_platform-audit-log";
import { AppError } from "../errors/app_error";
import { MigrationStateRepository } from "./repo_migration-state";
import { OwnershipResolutionService } from "./svc_ownership-resolution";
import { normalizeLegacyRecordForMigration } from "../crm/svc_crm-normalizer";
import {
  CollectionMigrationStats,
  CollectionValidationDetail,
  FailedMigrationItem,
  ManualReviewRecord,
  MigrationCheckpoint,
  MigrationConflictRecord,
  MigrationMode,
  MigrationReport,
  MigrationValidationReport,
  OwnershipResolutionResult,
} from "./typ_migration-report";

export const DEFAULT_MIGRATION_COLLECTIONS = [
  "leads",
  "contacts",
  "personal",
  "documents",
  "activities",
  "tours",
  "viewings",
  "counters",
  "notifications",
] as const;

export interface RawSourceRecord {
  id: string;
  [key: string]: any;
}

export interface MigrationDataAdapter {
  readonly backendKind: "firestore_live" | "in_memory_adapter" | "sample_store";
  listSourceDocuments(
    collectionName: string,
    pageSize: number,
    pageToken?: string
  ): Promise<{ items: RawSourceRecord[]; nextPageToken?: string }>;
  getTenantDocument(
    tenantId: string,
    collectionName: string,
    docId: string
  ): Promise<RawSourceRecord | null>;
  listTenantDocuments(
    tenantId: string,
    collectionName: string,
    pageSize: number,
    pageToken?: string
  ): Promise<{ items: RawSourceRecord[]; nextPageToken?: string }>;
  writeTenantDocument(
    tenantId: string,
    collectionName: string,
    docId: string,
    data: Record<string, any>
  ): Promise<void>;
}

/**
 * Canonical JSON serialization for deterministic checksums & cross-store comparison.
 */
function canonicalizeValue(val: any): any {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) return val.toISOString();
  if (typeof val === "object" && typeof val.toDate === "function") {
    return val.toDate().toISOString();
  }
  if (
    typeof val === "object" &&
    typeof val.seconds === "number" &&
    typeof val.nanoseconds === "number" &&
    Object.keys(val).length <= 2
  ) {
    return new Date(val.seconds * 1000 + Math.floor(val.nanoseconds / 1e6)).toISOString();
  }
  if (Array.isArray(val)) {
    return val.map((item) => canonicalizeValue(item));
  }
  if (typeof val === "object") {
    const sorted: Record<string, any> = {};
    for (const key of Object.keys(val).sort()) {
      if (val[key] !== undefined) {
        sorted[key] = canonicalizeValue(val[key]);
      }
    }
    return sorted;
  }
  return val;
}

const MIGRATION_META_KEYS = new Set([
  "tenantId",
  "tenant_id",
  "migratedFrom",
  "migrated_from",
  "migratedAt",
  "migrated_at",
  "migrationId",
  "migration_id",
  "sourceChecksum",
  "source_checksum",
  "migratedBy",
  "migrated_by",
  "createdAt",
  "created_at",
  "updatedAt",
  "updated_at",
  "deletedAt",
  "deleted_at",
  "createdBy",
  "created_by",
  "updatedBy",
  "updated_by",
  "staffId",
]);

export function computeRecordChecksum(record: Record<string, any>): string {
  const clean: Record<string, any> = {};
  for (const key of Object.keys(record).sort()) {
    if (!MIGRATION_META_KEYS.has(key) && record[key] !== undefined) {
      clean[key] = canonicalizeValue(record[key]);
    }
  }
  return crypto.createHash("sha256").update(JSON.stringify(clean)).digest("hex");
}

/**
 * Retries transient async operations with bounded exponential backoff.
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: { maxRetries: number; baseDelayMs: number }
): Promise<{ result: T; attempts: number }> {
  let attempt = 0;
  let lastError: any;
  while (attempt <= options.maxRetries) {
    attempt++;
    try {
      const result = await fn();
      return { result, attempts: attempt };
    } catch (err: any) {
      lastError = err;
      const status = err?.response?.status;
      const isNonRetryable =
        status === 400 || status === 401 || status === 403 || status === 404;
      if (isNonRetryable || attempt > options.maxRetries) {
        break;
      }
      const delay = options.baseDelayMs * Math.pow(2, attempt - 1);
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw Object.assign(lastError instanceof Error ? lastError : new Error(String(lastError)), {
    attempts: attempt,
  });
}

/**
 * Isolated in-memory adapter used for dry-run samples, unit/integration tests,
 * and transient failure / crash-resume simulations without touching production Firestore.
 */
export class InMemoryMigrationAdapter implements MigrationDataAdapter {
  public readonly backendKind: "in_memory_adapter" | "sample_store";
  private readonly source = new Map<string, Map<string, RawSourceRecord>>();
  private readonly tenantDest = new Map<string, Map<string, RawSourceRecord>>();

  /** Optional write hook for testing transient errors or crashes at a given doc. */
  public onBeforeWrite?: (
    tenantId: string,
    collectionName: string,
    docId: string,
    attemptIndex: number
  ) => void | Promise<void>;
  private writeAttempts = new Map<string, number>();

  constructor(
    initialSource?: Map<string, RawSourceRecord[]> | Record<string, RawSourceRecord[]>,
    backendKind: "in_memory_adapter" | "sample_store" = "in_memory_adapter"
  ) {
    this.backendKind = backendKind;
    if (initialSource instanceof Map) {
      for (const [col, list] of initialSource.entries()) {
        this.seedSource(col, list);
      }
    } else if (initialSource) {
      for (const [col, list] of Object.entries(initialSource)) {
        this.seedSource(col, list);
      }
    }
  }

  public seedSource(collectionName: string, records: RawSourceRecord[]): void {
    const colMap = this.source.get(collectionName) || new Map<string, RawSourceRecord>();
    for (const r of records) {
      colMap.set(r.id, structuredClone(r));
    }
    this.source.set(collectionName, colMap);
  }

  public seedTenantDest(
    tenantId: string,
    collectionName: string,
    records: RawSourceRecord[]
  ): void {
    const key = `${tenantId}::${collectionName}`;
    const colMap = this.tenantDest.get(key) || new Map<string, RawSourceRecord>();
    for (const r of records) {
      colMap.set(r.id, structuredClone(r));
    }
    this.tenantDest.set(key, colMap);
  }

  public getSourceSnapshot(collectionName: string): RawSourceRecord[] {
    const colMap = this.source.get(collectionName);
    if (!colMap) return [];
    return Array.from(colMap.values()).map((r) => structuredClone(r));
  }

  public async listSourceDocuments(
    collectionName: string,
    pageSize: number,
    pageToken?: string
  ): Promise<{ items: RawSourceRecord[]; nextPageToken?: string }> {
    const all = Array.from((this.source.get(collectionName) || new Map()).values());
    const startIdx = pageToken ? Number(pageToken) : 0;
    const slice = all.slice(startIdx, startIdx + pageSize).map((r) => structuredClone(r));
    const nextIdx = startIdx + slice.length;
    return {
      items: slice,
      nextPageToken: nextIdx < all.length ? String(nextIdx) : undefined,
    };
  }

  public async getTenantDocument(
    tenantId: string,
    collectionName: string,
    docId: string
  ): Promise<RawSourceRecord | null> {
    const colMap = this.tenantDest.get(`${tenantId}::${collectionName}`);
    if (!colMap) return null;
    const doc = colMap.get(docId);
    return doc ? structuredClone(doc) : null;
  }

  public async listTenantDocuments(
    tenantId: string,
    collectionName: string,
    pageSize: number,
    pageToken?: string
  ): Promise<{ items: RawSourceRecord[]; nextPageToken?: string }> {
    const colMap = this.tenantDest.get(`${tenantId}::${collectionName}`) || new Map();
    const all = Array.from(colMap.values());
    const startIdx = pageToken ? Number(pageToken) : 0;
    const slice = all.slice(startIdx, startIdx + pageSize).map((r) => structuredClone(r));
    const nextIdx = startIdx + slice.length;
    return {
      items: slice,
      nextPageToken: nextIdx < all.length ? String(nextIdx) : undefined,
    };
  }

  public async writeTenantDocument(
    tenantId: string,
    collectionName: string,
    docId: string,
    data: Record<string, any>
  ): Promise<void> {
    const attemptKey = `${tenantId}::${collectionName}::${docId}`;
    const count = (this.writeAttempts.get(attemptKey) || 0) + 1;
    this.writeAttempts.set(attemptKey, count);

    if (this.onBeforeWrite) {
      await this.onBeforeWrite(tenantId, collectionName, docId, count);
    }

    const key = `${tenantId}::${collectionName}`;
    const colMap = this.tenantDest.get(key) || new Map<string, RawSourceRecord>();
    colMap.set(docId, { ...structuredClone(data), id: docId });
    this.tenantDest.set(key, colMap);
  }
}

/**
 * Live Firestore REST adapter reading root collections cleanly via paginated list endpoints
 * and writing strictly into /tenants/{tenantId}/{collectionName}/{docId} (NEVER deletes source docs).
 */
export class FirestoreRestMigrationAdapter implements MigrationDataAdapter {
  public readonly backendKind = "firestore_live" as const;

  private getTarget(): { projectId: string; databaseId: string } {
    let projectId =
      process.env.FIREBASE_PROJECT_ID ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      "brokr-42038";
    let databaseId = process.env.FIRESTORE_DATABASE_ID || "(default)";

    try {
      const cfgPath = path.resolve(process.cwd(), "firebase-applet-config.json");
      if (fs.existsSync(cfgPath)) {
        const parsed = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
        if (parsed?.projectId) projectId = parsed.projectId;
        if (parsed?.firestoreDatabaseId) databaseId = parsed.firestoreDatabaseId;
      }
    } catch {
      // Fallback
    }
    return { projectId, databaseId };
  }

  private async requireToken(): Promise<string> {
    const token = await PersistentStoreService.getGoogleAccessToken();
    if (!token) {
      throw new AppError({
        message:
          "Credențialele server-side Firestore (Service Account / GCP Metadata) nu sunt configurate.",
        code: "INTERNAL_ERROR",
        statusCode: 500,
      });
    }
    return token;
  }

  private toFirestoreValue(val: any): any {
    if (val === null || val === undefined) return { nullValue: null };
    if (typeof val === "boolean") return { booleanValue: val };
    if (typeof val === "number") {
      return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
    }
    if (typeof val === "string") return { stringValue: val };
    if (Array.isArray(val)) {
      return { arrayValue: { values: val.map((item) => this.toFirestoreValue(item)) } };
    }
    if (typeof val === "object") {
      const fields: Record<string, any> = {};
      for (const [k, v] of Object.entries(val)) {
        if (v !== undefined) fields[k] = this.toFirestoreValue(v);
      }
      return { mapValue: { fields } };
    }
    return { stringValue: String(val) };
  }

  private fromFirestoreValue(fieldObj: any): any {
    if (!fieldObj || typeof fieldObj !== "object") return fieldObj;
    if ("stringValue" in fieldObj) return fieldObj.stringValue;
    if ("integerValue" in fieldObj) return Number(fieldObj.integerValue);
    if ("doubleValue" in fieldObj) return Number(fieldObj.doubleValue);
    if ("booleanValue" in fieldObj) return fieldObj.booleanValue;
    if ("timestampValue" in fieldObj) return fieldObj.timestampValue;
    if ("nullValue" in fieldObj) return null;
    if ("mapValue" in fieldObj) {
      const out: Record<string, any> = {};
      const fields = fieldObj.mapValue.fields || {};
      for (const k of Object.keys(fields)) {
        out[k] = this.fromFirestoreValue(fields[k]);
      }
      return out;
    }
    if ("arrayValue" in fieldObj) {
      const values = fieldObj.arrayValue.values || [];
      return values.map((v: any) => this.fromFirestoreValue(v));
    }
    return fieldObj;
  }

  private decodeDocument(docObj: any): RawSourceRecord {
    const nameParts = String(docObj?.name || "").split("/");
    const docId = nameParts[nameParts.length - 1] || "";
    const out: RawSourceRecord = { id: docId };
    const fields = docObj?.fields || {};
    for (const k of Object.keys(fields)) {
      out[k] = this.fromFirestoreValue(fields[k]);
    }
    return out;
  }

  private encodeFields(data: Record<string, any>): Record<string, any> {
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined) fields[k] = this.toFirestoreValue(v);
    }
    return fields;
  }

  public async listSourceDocuments(
    collectionName: string,
    pageSize: number,
    pageToken?: string
  ): Promise<{ items: RawSourceRecord[]; nextPageToken?: string }> {
    const token = await this.requireToken();
    const { projectId, databaseId } = this.getTarget();
    const params = new URLSearchParams({ pageSize: String(pageSize) });
    if (pageToken) params.set("pageToken", pageToken);

    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/${encodeURIComponent(collectionName)}?${params.toString()}`;
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 12_000,
    });

    const docs = Array.isArray(res.data?.documents) ? res.data.documents : [];
    return {
      items: docs.map((d: any) => this.decodeDocument(d)),
      nextPageToken: res.data?.nextPageToken || undefined,
    };
  }

  public async getTenantDocument(
    tenantId: string,
    collectionName: string,
    docId: string
  ): Promise<RawSourceRecord | null> {
    const token = await this.requireToken();
    const { projectId, databaseId } = this.getTarget();
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/tenants/${encodeURIComponent(tenantId)}/${encodeURIComponent(collectionName)}/${encodeURIComponent(docId)}`;
    try {
      const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 8_000,
      });
      return this.decodeDocument(res.data);
    } catch (err: any) {
      if (err?.response?.status === 404) return null;
      throw err;
    }
  }

  public async listTenantDocuments(
    tenantId: string,
    collectionName: string,
    pageSize: number,
    pageToken?: string
  ): Promise<{ items: RawSourceRecord[]; nextPageToken?: string }> {
    const token = await this.requireToken();
    const { projectId, databaseId } = this.getTarget();
    const params = new URLSearchParams({ pageSize: String(pageSize) });
    if (pageToken) params.set("pageToken", pageToken);

    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/tenants/${encodeURIComponent(tenantId)}/${encodeURIComponent(collectionName)}?${params.toString()}`;
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 12_000,
    });

    const docs = Array.isArray(res.data?.documents) ? res.data.documents : [];
    return {
      items: docs.map((d: any) => this.decodeDocument(d)),
      nextPageToken: res.data?.nextPageToken || undefined,
    };
  }

  public async writeTenantDocument(
    tenantId: string,
    collectionName: string,
    docId: string,
    data: Record<string, any>
  ): Promise<void> {
    const token = await this.requireToken();
    const { projectId, databaseId } = this.getTarget();
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/tenants/${encodeURIComponent(tenantId)}/${encodeURIComponent(collectionName)}/${encodeURIComponent(docId)}`;
    await axios.patch(
      url,
      { fields: this.encodeFields(data) },
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10_000,
      }
    );
  }
}

export interface LegacyMigrationOptions {
  adapter: MigrationDataAdapter;
  targetTenantId?: string;
  mode: MigrationMode;
  executedBy: string;
  collectionsToMigrate?: string[];
  batchSize?: number;
  maxRetries?: number;
  baseRetryDelayMs?: number;
  /**
   * When true, records without explicit tenant/membership/parent ownership
   * are marked `requiresManualReview` instead of being assigned to targetTenantId.
   */
  strictOwnershipRequired?: boolean;
  /**
   * Explicit opt-in for initial single-agency CRM cutover into verified initial tenant
   * when legacy pre-SaaS records carry no explicit `tenantId`.
   */
  allowSingleAgencyFallback?: boolean;
  resumeMigrationId?: string;
  /**
   * Optional test hook: if set, aborts after writing N new records to simulate an unexpected interruption.
   */
  abortAfterWrites?: number;
}

export class LegacyMigrationService {
  /**
   * Streams all documents of a collection from the adapter using bounded pagination.
   */
  private static async fetchAllFromSource(
    adapter: MigrationDataAdapter,
    collectionName: string,
    pageSize: number
  ): Promise<RawSourceRecord[]> {
    const all: RawSourceRecord[] = [];
    let pageToken: string | undefined = undefined;
    do {
      const page = await adapter.listSourceDocuments(collectionName, pageSize, pageToken);
      all.push(...page.items);
      pageToken = page.nextPageToken;
    } while (pageToken);
    return all;
  }

  private static async fetchAllFromTenantDest(
    adapter: MigrationDataAdapter,
    tenantId: string,
    collectionName: string,
    pageSize: number
  ): Promise<RawSourceRecord[]> {
    const all: RawSourceRecord[] = [];
    let pageToken: string | undefined = undefined;
    do {
      const page = await adapter.listTenantDocuments(tenantId, collectionName, pageSize, pageToken);
      all.push(...page.items);
      pageToken = page.nextPageToken;
    } while (pageToken);
    return all;
  }

  /**
   * Builds email/uid -> distinct Set<tenantId> lookup from registered memberships.
   */
  private static buildMembershipLookup(): {
    byEmail: Map<string, Set<string>>;
    byUserId: Map<string, Set<string>>;
  } {
    const byEmail = new Map<string, Set<string>>();
    const byUserId = new Map<string, Set<string>>();

    for (const tenant of TenantResolutionService.getAllTenants()) {
      const members = TenantMembershipService.listTenantMembers(tenant.id);
      for (const m of members) {
        if (m.status === "revoked") continue;
        if (m.email) {
          const emailKey = m.email.toLowerCase().trim();
          const set = byEmail.get(emailKey) || new Set<string>();
          set.add(tenant.id);
          byEmail.set(emailKey, set);
        }
        if (m.userId) {
          const set = byUserId.get(m.userId) || new Set<string>();
          set.add(tenant.id);
          byUserId.set(m.userId, set);
        }
      }
    }

    return { byEmail, byUserId };
  }

  /**
   * Strictly resolves tenant ownership for a legacy record.
   * Never silently guesses across multiple conflicting candidates.
   */
  public static resolveRecordOwnership(
    record: RawSourceRecord,
    context: {
      collectionName?: string;
      membershipLookup: { byEmail: Map<string, Set<string>>; byUserId: Map<string, Set<string>> };
      resolvedParentOwners: Map<string, string>; // key: entityId/propertyId -> tenantId
      configuredFallbackTenantId?: string | null;
      strictOwnershipRequired?: boolean;
      allowSingleAgencyFallback?: boolean;
    }
  ): OwnershipResolutionResult {
    // 0. Verified manual ownership resolution recorded by Super Admin (source doc untouched)
    if (context.collectionName && record.id) {
      const manual = OwnershipResolutionService.getAssignment(context.collectionName, record.id);
      if (manual) {
        if (manual.decision === "held" || !manual.targetTenantId) {
          return {
            resolved: false,
            tenantId: null,
            reason: `manual_hold:${manual.reason}`,
            requiresManualReview: true,
            candidateTenantIds: [],
          };
        }
        return {
          resolved: true,
          tenantId: manual.targetTenantId,
          reason: "manual_super_admin_assignment",
          sourceField: "manual_review_override",
          requiresManualReview: false,
        };
      }
    }

    // 1. Explicit tenantId / tenant_id on record
    const explicitTenantId =
      typeof record.tenantId === "string" && record.tenantId.trim()
        ? record.tenantId.trim()
        : typeof record.tenant_id === "string" && record.tenant_id.trim()
        ? record.tenant_id.trim()
        : null;

    if (explicitTenantId) {
      const tenant = TenantResolutionService.getTenantById(explicitTenantId);
      if (!tenant) {
        return {
          resolved: false,
          tenantId: null,
          reason: `explicit_tenant_id_not_found:${explicitTenantId}`,
          sourceField: "tenantId",
          requiresManualReview: true,
          candidateTenantIds: [explicitTenantId],
        };
      }
      return {
        resolved: true,
        tenantId: tenant.id,
        reason: "explicit_tenant_id",
        sourceField: "tenantId",
        requiresManualReview: false,
      };
    }

    // 2. Gather ownership candidates from relationships + member UIDs/emails
    const candidateTenants = new Set<string>();
    const detectedEmails: string[] = [];

    const parentKeys = [record.leadId, record.propertyId, record.clientId, record.contactId]
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0);

    for (const pk of parentKeys) {
      const parentTenant = context.resolvedParentOwners.get(pk.trim());
      if (parentTenant) {
        candidateTenants.add(parentTenant);
      }
    }

    const uidCandidates = [record.userId, record.ownerUid, record.createdBy, record.agentUid]
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0);

    for (const uid of uidCandidates) {
      const tenantSet = context.membershipLookup.byUserId.get(uid.trim());
      if (tenantSet) {
        for (const tid of tenantSet) candidateTenants.add(tid);
      }
    }

    const emailCandidates = [
      record.createdByEmail,
      record.ownerEmail,
      record.agentEmail,
      record.staffEmail,
      record.agent,
      // Only treat record.email as agency ownership if record looks like staff/personal
      record.role && typeof record.email === "string" && record.email.includes("@")
        ? record.email
        : undefined,
    ].filter((v): v is string => typeof v === "string" && v.includes("@"));

    for (const em of emailCandidates) {
      const norm = em.toLowerCase().trim();
      detectedEmails.push(norm);
      const tenantSet = context.membershipLookup.byEmail.get(norm);
      if (tenantSet) {
        for (const tid of tenantSet) candidateTenants.add(tid);
      }
    }

    if (candidateTenants.size > 1) {
      return {
        resolved: false,
        tenantId: null,
        reason: "ambiguous_multi_tenant_ownership",
        requiresManualReview: true,
        candidateTenantIds: Array.from(candidateTenants),
        detectedEmails,
      };
    }

    if (candidateTenants.size === 1) {
      const [onlyTenant] = Array.from(candidateTenants);
      return {
        resolved: true,
        tenantId: onlyTenant,
        reason: "inferred_from_verified_relationship_or_membership",
        sourceField: parentKeys.length > 0 ? "parent_reference" : "membership_email_or_uid",
        requiresManualReview: false,
        detectedEmails,
      };
    }

    // 3. No explicit owner or relationship signal found
    if (
      !context.strictOwnershipRequired &&
      context.allowSingleAgencyFallback &&
      context.configuredFallbackTenantId
    ) {
      const fallbackTenant = TenantResolutionService.getTenantById(
        context.configuredFallbackTenantId
      );
      if (fallbackTenant) {
        return {
          resolved: true,
          tenantId: fallbackTenant.id,
          reason: "verified_initial_single_agency_tenant",
          sourceField: "configured_initial_tenant",
          requiresManualReview: false,
        };
      }
    }

    return {
      resolved: false,
      tenantId: null,
      reason: "unassigned_no_explicit_ownership",
      requiresManualReview: true,
      candidateTenantIds: [],
      detectedEmails,
    };
  }

  /**
   * Executes a dry-run or live migration (or resumes from a checkpoint).
   * Non-destructive: source root records are NEVER deleted or modified.
   */
  public static async executeMigration(
    options: LegacyMigrationOptions
  ): Promise<MigrationReport> {
    const adapter = options.adapter;
    const collections =
      options.collectionsToMigrate && options.collectionsToMigrate.length > 0
        ? options.collectionsToMigrate
        : [...DEFAULT_MIGRATION_COLLECTIONS];
    const batchSize = Math.min(200, Math.max(1, options.batchSize ?? 50));
    const maxRetries = Math.max(0, options.maxRetries ?? 2);
    const baseRetryDelayMs = Math.max(0, options.baseRetryDelayMs ?? 15);

    const configuredFallbackTenantId = options.targetTenantId || null;
    if (configuredFallbackTenantId) {
      const tenant = TenantResolutionService.getTenantById(configuredFallbackTenantId);
      if (!tenant) {
        throw new AppError({
          message: `Tenantul țintă "${configuredFallbackTenantId}" nu există în platformă.`,
          code: "NOT_FOUND",
          statusCode: 404,
        });
      }
    }

    let checkpoint: MigrationCheckpoint | null = null;
    let resumedFromCheckpoint = false;
    if (options.resumeMigrationId) {
      checkpoint = MigrationStateRepository.getCheckpoint(options.resumeMigrationId);
      if (!checkpoint) {
        throw new AppError({
          message: `Checkpoint-ul de migrare "${options.resumeMigrationId}" nu a fost găsit.`,
          code: "NOT_FOUND",
          statusCode: 404,
        });
      }
      resumedFromCheckpoint = true;
    }

    const migrationId = checkpoint?.migrationId || `mig_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`;
    const startedAt = checkpoint?.startedAt || new Date().toISOString();

    if (!checkpoint) {
      checkpoint = {
        migrationId,
        version: "2.0.0",
        mode: options.mode,
        targetTenantId: configuredFallbackTenantId || undefined,
        executedBy: options.executedBy,
        collectionsOrder: [...collections],
        currentCollection: collections[0] || null,
        lastProcessedBatch: 0,
        lastDocumentId: null,
        processedDocumentKeys: [],
        failedRecords: [],
        processedCount: 0,
        migratedCount: 0,
        skippedDuplicatesCount: 0,
        conflictsCount: 0,
        manualReviewCount: 0,
        errorCount: 0,
        status: "in_progress",
        startedAt,
        updatedAt: startedAt,
      };
      MigrationStateRepository.saveCheckpoint(checkpoint);
    } else {
      checkpoint.status = "in_progress";
      checkpoint.updatedAt = new Date().toISOString();
      MigrationStateRepository.saveCheckpoint(checkpoint);
    }

    const alreadyProcessed = new Set<string>(checkpoint.processedDocumentKeys);
    const membershipLookup = this.buildMembershipLookup();

    // Load all source collections upfront in bounded batches so ownership & relationship checks work across entities
    const sourceByCollection = new Map<string, RawSourceRecord[]>();
    const allSourceIdSetByCol = new Map<string, Set<string>>();
    const resolvedParentOwners = new Map<string, string>();
    const propertyCodeToTenant = new Map<string, string>();

    for (const colName of collections) {
      const docs = await this.fetchAllFromSource(adapter, colName, batchSize);
      sourceByCollection.set(colName, docs);
      const idSet = new Set<string>();
      for (const d of docs) {
        if (d.id) idSet.add(d.id);
        if (d.propertyId) idSet.add(String(d.propertyId));
      }
      allSourceIdSetByCol.set(colName, idSet);
    }

    // Pass 1: Resolve primary entities (leads, personal, contacts) so child entities (documents, activities, viewings) can inherit verified ownership cleanly
    const primaryOrder = ["leads", "contacts", "personal"];
    for (const colName of primaryOrder) {
      const docs = sourceByCollection.get(colName) || [];
      for (const rec of docs) {
        const res = this.resolveRecordOwnership(rec, {
          collectionName: colName,
          membershipLookup,
          resolvedParentOwners,
          configuredFallbackTenantId,
          strictOwnershipRequired: options.strictOwnershipRequired,
          allowSingleAgencyFallback: options.allowSingleAgencyFallback,
        });
        if (res.resolved && res.tenantId) {
          resolvedParentOwners.set(rec.id, res.tenantId);
          if (rec.propertyId) {
            resolvedParentOwners.set(String(rec.propertyId), res.tenantId);
            propertyCodeToTenant.set(String(rec.propertyId), res.tenantId);
          }
          if (rec.clientId) resolvedParentOwners.set(String(rec.clientId), res.tenantId);
        }
      }
    }

    const collectionStats: Record<string, CollectionMigrationStats> = {};
    const manualReviewRecords: ManualReviewRecord[] = [];
    const conflicts: MigrationConflictRecord[] = [];
    const warnings: string[] = [];
    const newFailedRecords: FailedMigrationItem[] = [];

    let totalRecordsFound = 0;
    let totalValidRecords = 0;
    let totalMigrated = 0;
    let totalSkippedDuplicates = 0;
    let totalErrors = 0;
    let writesInThisRun = 0;
    let aborted = false;

    const leadIdSet = allSourceIdSetByCol.get("leads") || new Set<string>();

    for (const colName of collections) {
      if (aborted) break;
      const records = sourceByCollection.get(colName) || [];
      const stats: CollectionMigrationStats = {
        collectionName: colName,
        totalFound: records.length,
        validRecords: 0,
        migrated: 0,
        skippedDuplicates: 0,
        skippedManualReview: 0,
        conflictsCount: 0,
        failed: 0,
        errors: [],
      };
      totalRecordsFound += records.length;
      checkpoint.currentCollection = colName;

      // Chunk records by batchSize and save checkpoint after each batch
      for (let i = 0; i < records.length; i += batchSize) {
        if (aborted) break;
        const batch = records.slice(i, i + batchSize);
        checkpoint.lastProcessedBatch += 1;

        for (const record of batch) {
          if (
            typeof options.abortAfterWrites === "number" &&
            writesInThisRun >= options.abortAfterWrites
          ) {
            aborted = true;
            checkpoint.status = "interrupted";
            checkpoint.updatedAt = new Date().toISOString();
            MigrationStateRepository.saveCheckpoint(checkpoint);
            break;
          }

          if (!record.id) {
            stats.failed++;
            totalErrors++;
            stats.errors.push(`Document lipsă ID în colecția ${colName}`);
            continue;
          }

          const docKey = `${colName}::${record.id}`;
          checkpoint.lastDocumentId = record.id;

          // Validate cross-entity references
          if (record.leadId && !leadIdSet.has(String(record.leadId))) {
            warnings.push(
              `Înregistrarea ${record.id} din ${colName} referențiază un leadId absent în setul sursă: ${record.leadId}`
            );
          }

          // Strict ownership resolution
          const ownership = this.resolveRecordOwnership(record, {
            collectionName: colName,
            membershipLookup,
            resolvedParentOwners,
            configuredFallbackTenantId,
            strictOwnershipRequired: options.strictOwnershipRequired,
            allowSingleAgencyFallback: options.allowSingleAgencyFallback,
          });

          if (!ownership.resolved || !ownership.tenantId || ownership.requiresManualReview) {
            stats.skippedManualReview = (stats.skippedManualReview || 0) + 1;
            manualReviewRecords.push({
              collectionName: colName,
              recordId: record.id,
              reason: ownership.reason,
              candidateTenantIds: ownership.candidateTenantIds || [],
              detectedEmails: ownership.detectedEmails,
              relatedIds: {
                ...(record.leadId ? { leadId: String(record.leadId) } : {}),
                ...(record.propertyId ? { propertyId: String(record.propertyId) } : {}),
                ...(record.clientId ? { clientId: String(record.clientId) } : {}),
              },
              preservedInSource: true,
            });
            continue;
          }

          const destTenantId = ownership.tenantId;

          // If resuming and this key already succeeded previously, count as skipped duplicate
          if (resumedFromCheckpoint && alreadyProcessed.has(docKey)) {
            stats.skippedDuplicates++;
            totalSkippedDuplicates++;
            continue;
          }

          const sourceChecksum = computeRecordChecksum(record);

          const destColName = colName === "personal" ? "staff" : colName;

          try {
            const existingDest = await adapter.getTenantDocument(
              destTenantId,
              destColName,
              record.id
            );

            if (existingDest) {
              const existingChecksum = existingDest.sourceChecksum ?? existingDest.source_checksum;
              const destChecksum =
                typeof existingChecksum === "string"
                  ? existingChecksum
                  : computeRecordChecksum(existingDest);

              if (destChecksum === sourceChecksum) {
                stats.skippedDuplicates++;
                totalSkippedDuplicates++;
                alreadyProcessed.add(docKey);
                checkpoint.processedDocumentKeys.push(docKey);
                continue;
              } else {
                // Conflict detected: preserve both without silent overwrite
                stats.conflictsCount = (stats.conflictsCount || 0) + 1;
                conflicts.push({
                  collectionName: colName,
                  recordId: record.id,
                  targetTenantId: destTenantId,
                  destinationPath: `/tenants/${destTenantId}/${destColName}/${record.id}`,
                  reason: "destination_exists_with_different_content",
                  sourceChecksum,
                  destinationChecksum: destChecksum,
                });
                warnings.push(
                  `Conflict detectat la /tenants/${destTenantId}/${destColName}/${record.id}: conținutul destinație diferă de sursă; păstrat fără suprascriere.`
                );
                continue;
              }
            }

            stats.validRecords++;
            totalValidRecords++;

            if (options.mode === "live") {
              const payload = normalizeLegacyRecordForMigration(
                record,
                destTenantId,
                colName,
                destColName,
                {
                  migrationId,
                  executedBy: options.executedBy,
                  sourceChecksum,
                }
              );

              await retryWithBackoff(
                () => adapter.writeTenantDocument(destTenantId, destColName, record.id, payload),
                { maxRetries, baseDelayMs: baseRetryDelayMs }
              );

              writesInThisRun++;
              stats.migrated++;
              totalMigrated++;
              alreadyProcessed.add(docKey);
              checkpoint.processedDocumentKeys.push(docKey);
            }
          } catch (err: any) {
            stats.failed++;
            totalErrors++;
            const msg = err?.message || String(err);
            stats.errors.push(`Eroare la migrarea ${record.id}: ${msg}`);
            newFailedRecords.push({
              collectionName: colName,
              recordId: record.id,
              error: msg,
              attempts: err?.attempts || maxRetries + 1,
            });
          }
        }

        // Persist checkpoint after every batch
        checkpoint.processedCount = totalRecordsFound;
        checkpoint.migratedCount += stats.migrated;
        checkpoint.skippedDuplicatesCount = totalSkippedDuplicates;
        checkpoint.conflictsCount = conflicts.length;
        checkpoint.manualReviewCount = manualReviewRecords.length;
        checkpoint.errorCount = totalErrors;
        checkpoint.failedRecords = newFailedRecords;
        checkpoint.updatedAt = new Date().toISOString();
        MigrationStateRepository.saveCheckpoint(checkpoint);
      }

      collectionStats[colName] = stats;
    }

    const completedAt = new Date().toISOString();
    if (!aborted) {
      checkpoint.status = totalErrors === 0 ? "completed" : "failed";
      checkpoint.completedAt = completedAt;
      checkpoint.updatedAt = completedAt;
      MigrationStateRepository.saveCheckpoint(checkpoint);
    }

    if (manualReviewRecords.length > 0) {
      MigrationStateRepository.saveManualReviewRecords(migrationId, manualReviewRecords);
    }

    const primaryTenant = configuredFallbackTenantId
      ? TenantResolutionService.getTenantById(configuredFallbackTenantId)
      : null;

    const report: MigrationReport = {
      id: migrationId,
      targetTenantId: configuredFallbackTenantId || "multi_tenant_resolved",
      targetTenantName: primaryTenant?.name || "Resolved Per-Record Tenant Ownership",
      mode: options.mode,
      status: aborted ? "interrupted" : totalErrors === 0 ? "completed" : "failed",
      startedAt,
      completedAt,
      executedBy: options.executedBy,
      collections: collectionStats,
      summary: {
        totalRecordsFound,
        totalValidRecords,
        totalMigrated: options.mode === "live" ? totalMigrated : 0,
        totalSkippedDuplicates,
        totalErrors,
        isSafeToMigrate: totalErrors === 0 && conflicts.length === 0,
      },
      warnings,
      sourceBackend: adapter.backendKind,
      checkpointId: checkpoint.migrationId,
      resumedFromCheckpoint,
      manualReviewCount: manualReviewRecords.length,
      manualReviewRecords,
      conflictsCount: conflicts.length,
      conflicts,
    };

    MigrationStateRepository.saveReport(report);

    PlatformAuditLogRepository.addLog({
      action:
        options.mode === "dry_run"
          ? ("CRM_DATA_MIGRATION_DRY_RUN" as any)
          : ("CRM_DATA_MIGRATION_EXECUTE" as any),
      actorUserId: options.executedBy,
      actorEmail: options.executedBy,
      targetType: "migration" as any,
      targetId: migrationId,
      details: {
        targetTenantId: report.targetTenantId,
        mode: options.mode,
        status: report.status,
        resumedFromCheckpoint,
        manualReviewCount: manualReviewRecords.length,
        conflictsCount: conflicts.length,
        summary: report.summary,
      },
      ipAddress: "127.0.0.1",
    });

    return report;
  }

  /**
   * Independent post-migration validation:
   * Re-reads source collections and destination tenant subcollections independently,
   * compares counts, verifies document IDs and normalized fields, detects duplicates
   * and broken cross-entity references.
   */
  public static async validateMigrationIntegrity(params: {
    adapter: MigrationDataAdapter;
    targetTenantIds: string[];
    collections?: string[];
    migrationId?: string;
    strictOwnershipRequired?: boolean;
    allowSingleAgencyFallback?: boolean;
    defaultFallbackTenantId?: string;
  }): Promise<MigrationValidationReport> {
    const adapter = params.adapter;
    const collections = params.collections || [...DEFAULT_MIGRATION_COLLECTIONS];
    const membershipLookup = this.buildMembershipLookup();

    const sourceByCol = new Map<string, RawSourceRecord[]>();
    const resolvedParentOwners = new Map<string, string>();
    for (const col of collections) {
      sourceByCol.set(col, await this.fetchAllFromSource(adapter, col, 200));
    }

    for (const col of ["leads", "contacts", "personal"]) {
      for (const rec of sourceByCol.get(col) || []) {
        const res = this.resolveRecordOwnership(rec, {
          collectionName: col,
          membershipLookup,
          resolvedParentOwners,
          configuredFallbackTenantId: params.defaultFallbackTenantId,
          strictOwnershipRequired: params.strictOwnershipRequired,
          allowSingleAgencyFallback: params.allowSingleAgencyFallback,
        });
        if (res.resolved && res.tenantId) {
          resolvedParentOwners.set(rec.id, res.tenantId);
          if (rec.propertyId) resolvedParentOwners.set(String(rec.propertyId), res.tenantId);
        }
      }
    }

    const details: CollectionValidationDetail[] = [];
    let totalSourceRecords = 0;
    let totalDestinationVerified = 0;
    let totalMissing = 0;
    let totalMismatched = 0;
    let totalDuplicates = 0;
    let totalBrokenReferences = 0;

    // Build destination leads ID index per tenant for referential integrity verification
    const destLeadIdsByTenant = new Map<string, Set<string>>();
    for (const tid of params.targetTenantIds) {
      const tenantLeads = await this.fetchAllFromTenantDest(adapter, tid, "leads", 200);
      const idSet = new Set<string>();
      for (const l of tenantLeads) {
        idSet.add(l.id);
        if (l.propertyId) idSet.add(String(l.propertyId));
      }
      destLeadIdsByTenant.set(tid, idSet);
    }

    const KEY_FIELDS_TO_CHECK = [
      "propertyId",
      "title",
      "status",
      "price",
      "transactionType",
      "categoria",
      "name",
      "phone",
      "email",
      "fileUrl",
      "url",
      "leadId",
      "clientId",
      "staffId",
      "date",
      "createdAt",
    ];

    for (const col of collections) {
      const destCol = col === "personal" ? "staff" : col;
      const sourceDocs = sourceByCol.get(col) || [];
      totalSourceRecords += sourceDocs.length;

      // Read all destination docs across targetTenantIds
      const destDocsByTenantAndId = new Map<string, RawSourceRecord>();
      const seenIdsAcrossTenants = new Map<string, number>();
      const duplicateIdsInDestination: string[] = [];
      let destinationCount = 0;

      for (const tid of params.targetTenantIds) {
        const destList = await this.fetchAllFromTenantDest(adapter, tid, destCol, 200);
        destinationCount += destList.length;
        for (const d of destList) {
          destDocsByTenantAndId.set(`${tid}::${d.id}`, d);
          const cnt = (seenIdsAcrossTenants.get(d.id) || 0) + 1;
          seenIdsAcrossTenants.set(d.id, cnt);
          if (cnt > 1) duplicateIdsInDestination.push(d.id);
        }
      }

      const missingInDestination: string[] = [];
      const mismatchedRecords: Array<{ recordId: string; tenantId: string; diffs: string[] }> = [];
      const brokenReferences: Array<{ recordId: string; refField: string; refValue: string }> = [];
      let expectedMigratedCount = 0;

      for (const src of sourceDocs) {
        const own = this.resolveRecordOwnership(src, {
          collectionName: col,
          membershipLookup,
          resolvedParentOwners,
          configuredFallbackTenantId: params.defaultFallbackTenantId,
          strictOwnershipRequired: params.strictOwnershipRequired,
          allowSingleAgencyFallback: params.allowSingleAgencyFallback,
        });

        if (!own.resolved || !own.tenantId || !params.targetTenantIds.includes(own.tenantId)) {
          continue; // Excluded/manual-review record
        }

        expectedMigratedCount++;
        const dest = destDocsByTenantAndId.get(`${own.tenantId}::${src.id}`);
        if (!dest) {
          missingInDestination.push(src.id);
          continue;
        }

        totalDestinationVerified++;

        // Field-by-field normalized comparison
        const diffs: string[] = [];
        for (const field of KEY_FIELDS_TO_CHECK) {
          if (src[field] !== undefined) {
            const sNorm = JSON.stringify(canonicalizeValue(src[field]));
            const dNorm = JSON.stringify(canonicalizeValue(dest[field]));
            if (sNorm !== dNorm) {
              diffs.push(`${field}: source=${sNorm} dest=${dNorm}`);
            }
          }
        }
        if (diffs.length > 0) {
          mismatchedRecords.push({
            recordId: src.id,
            tenantId: own.tenantId,
            diffs,
          });
        }

        // Cross-entity reference integrity check
        if (dest.leadId) {
          const leadSet = destLeadIdsByTenant.get(own.tenantId) || new Set();
          if (!leadSet.has(String(dest.leadId))) {
            brokenReferences.push({
              recordId: dest.id,
              refField: "leadId",
              refValue: String(dest.leadId),
            });
          }
        }
      }

      totalMissing += missingInDestination.length;
      totalMismatched += mismatchedRecords.length;
      totalDuplicates += duplicateIdsInDestination.length;
      totalBrokenReferences += brokenReferences.length;

      details.push({
        collectionName: col,
        sourceCount: sourceDocs.length,
        expectedMigratedCount,
        destinationCount,
        missingInDestination,
        mismatchedRecords,
        duplicateIdsInDestination,
        brokenReferences,
      });
    }

    const report: MigrationValidationReport = {
      validationId: `val_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`,
      migrationId: params.migrationId,
      verifiedAt: new Date().toISOString(),
      targetTenantIds: [...params.targetTenantIds],
      sourceBackend: adapter.backendKind,
      destinationBackend: adapter.backendKind,
      allPassed:
        totalMissing === 0 &&
        totalMismatched === 0 &&
        totalDuplicates === 0 &&
        totalBrokenReferences === 0,
      collections: details,
      summary: {
        totalSourceRecords,
        totalDestinationVerified,
        totalMissing,
        totalMismatched,
        totalDuplicates,
        totalBrokenReferences,
      },
    };

    MigrationStateRepository.saveValidationReport(report);
    return report;
  }
}
