/**
 * Pure, read-only CRM entity & status normalizer.
 * - Normalizes legacy snake_case metadata (tenant_id, created_at, updated_at, deleted_at)
 *   to canonical camelCase (tenantId, createdAt, updatedAt, deletedAt) in memory.
 * - Normalizes legacy personalId -> staffId without performing lazy DB writes on read.
 * - Provides bidirectional canonical English <-> Romanian status mapping for leads, properties, requests, and staff.
 */

export type CanonicalLeadStatus =
  | "new_lead"
  | "my_list"
  | "lost"
  | "unvalidated"
  | "qualified"
  | "active"
  | "negotiation"
  | "completed"
  | "archived"
  | "deleted"
  | "interested"
  | "new"
  | "prospecting"
  | "collaboration"
  | "qualification"
  | "matching"
  | "viewing"
  | "offering"
  | "pre_contract"
  | "contract";

const ROMANIAN_TO_CANONICAL_STATUS: Record<string, CanonicalLeadStatus> = {
  Noi: "new_lead",
  ListaMea: "my_list",
  Pierdute: "lost",
  Nevalidata: "unvalidated",
  Calificata: "qualified",
  Activa: "active",
  InNegociere: "negotiation",
  Finalizata: "completed",
  Arhiva: "archived",
  Sterse: "deleted",
  AreInteres: "interested",
  Noua: "new",
  Prospectare: "prospecting",
  Colaborare: "collaboration",
  Calificare: "qualification",
  Matching: "matching",
  Vizionare: "viewing",
  Ofertare: "offering",
  Antecontract: "pre_contract",
  Contract: "contract",
};

const CANONICAL_TO_DISPLAY_STATUS: Record<CanonicalLeadStatus, string> = {
  new_lead: "Noi",
  my_list: "ListaMea",
  lost: "Pierdute",
  unvalidated: "Nevalidata",
  qualified: "Calificata",
  active: "Activa",
  negotiation: "InNegociere",
  completed: "Finalizata",
  archived: "Arhiva",
  deleted: "Sterse",
  interested: "AreInteres",
  new: "Noua",
  prospecting: "Prospectare",
  collaboration: "Colaborare",
  qualification: "Calificare",
  matching: "Matching",
  viewing: "Vizionare",
  offering: "Ofertare",
  pre_contract: "Antecontract",
  contract: "Contract",
};

const CANONICAL_STATUS_SET = new Set<string>(Object.values(ROMANIAN_TO_CANONICAL_STATUS));

export function toCanonicalLeadStatus(status?: string | null): CanonicalLeadStatus | undefined {
  if (!status || typeof status !== "string") return undefined;
  const trimmed = status.trim();
  if (!trimmed) return undefined;
  if (trimmed in ROMANIAN_TO_CANONICAL_STATUS) {
    return ROMANIAN_TO_CANONICAL_STATUS[trimmed];
  }
  const lower = trimmed.toLowerCase();
  if (lower === "lista mea" || lower === "listamea") {
    return "my_list";
  }
  if (CANONICAL_STATUS_SET.has(lower)) {
    return lower as CanonicalLeadStatus;
  }
  return undefined;
}

export function toDisplayLeadStatus(status?: string | null): string | undefined {
  if (!status || typeof status !== "string") return undefined;
  const trimmed = status.trim();
  if (!trimmed) return undefined;
  if (trimmed in ROMANIAN_TO_CANONICAL_STATUS) {
    return trimmed;
  }
  const lower = trimmed.toLowerCase();
  if (lower === "lista mea" || lower === "listamea") {
    return "ListaMea";
  }
  const canonicalKey = lower as CanonicalLeadStatus;
  if (canonicalKey in CANONICAL_TO_DISPLAY_STATUS) {
    return CANONICAL_TO_DISPLAY_STATUS[canonicalKey];
  }
  return trimmed;
}

export function toCanonicalStaffStatus(status?: string | null): "active" | "inactive" {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "inactiv" || normalized === "inactive") {
    return "inactive";
  }
  return "active";
}

export function toDisplayStaffStatus(status?: string | null): "Activ" | "Inactiv" {
  return toCanonicalStaffStatus(status) === "inactive" ? "Inactiv" : "Activ";
}

/**
 * Pure in-memory document normalizer.
 * Converts legacy snake_case metadata keys to camelCase and enriches staff/lead records
 * without mutating the database on read.
 */
export function normalizeCrmDocument<T extends Record<string, any>>(
  doc: T,
  collectionName?: string
): T {
  if (!doc || typeof doc !== "object") return doc;

  const out: Record<string, any> = { ...doc };

  if (out.tenantId === undefined && out.tenant_id !== undefined) {
    out.tenantId = out.tenant_id;
  }
  if (out.createdAt === undefined && out.created_at !== undefined) {
    out.createdAt = out.created_at;
  }
  if (out.updatedAt === undefined && out.updated_at !== undefined) {
    out.updatedAt = out.updated_at;
  }
  if (out.deletedAt === undefined && out.deleted_at !== undefined) {
    out.deletedAt = out.deleted_at;
  }
  if (out.createdBy === undefined && out.created_by !== undefined) {
    out.createdBy = out.created_by;
  }
  if (out.updatedBy === undefined && out.updated_by !== undefined) {
    out.updatedBy = out.updated_by;
  }

  if (collectionName === "staff" || collectionName === "personal") {
    const resolvedStaffId = out.staffId || out.personalId;
    if (resolvedStaffId) {
      out.staffId = resolvedStaffId;
      if (!out.personalId) out.personalId = resolvedStaffId;
    }
    if (out.status !== undefined) {
      out.canonicalStatus = toCanonicalStaffStatus(out.status);
      out.status = toDisplayStaffStatus(out.status);
    }
  }

  if (collectionName === "leads" && typeof out.status === "string" && out.status.trim()) {
    const canonical = toCanonicalLeadStatus(out.status);
    if (canonical) {
      out.canonicalStatus = canonical;
      out.status = toDisplayLeadStatus(out.status) || out.status;
    }
  }

  return out as T;
}

/**
 * Normalizes a legacy document into canonical camelCase fields for one-time batch migrations.
 */
export function normalizeLegacyRecordForMigration(
  record: Record<string, any>,
  targetTenantId: string,
  sourceCollection: string,
  targetCollection: string,
  migrationMeta: {
    migrationId: string;
    executedBy: string;
    sourceChecksum: string;
    migratedAt?: string;
  }
): Record<string, any> {
  const cloned = structuredClone(record);
  const migratedAt = migrationMeta.migratedAt || new Date().toISOString();

  if (cloned.createdAt === undefined && cloned.created_at !== undefined) {
    cloned.createdAt = cloned.created_at;
  }
  if (cloned.updatedAt === undefined && cloned.updated_at !== undefined) {
    cloned.updatedAt = cloned.updated_at;
  }
  if (cloned.deletedAt === undefined && cloned.deleted_at !== undefined) {
    cloned.deletedAt = cloned.deleted_at;
  }
  if (cloned.createdBy === undefined && cloned.created_by !== undefined) {
    cloned.createdBy = cloned.created_by;
  }
  if (cloned.updatedBy === undefined && cloned.updated_by !== undefined) {
    cloned.updatedBy = cloned.updated_by;
  }

  delete cloned.tenant_id;
  delete cloned.created_at;
  delete cloned.updated_at;
  delete cloned.deleted_at;
  delete cloned.created_by;
  delete cloned.updated_by;

  if (targetCollection === "staff") {
    const resolvedStaffId = cloned.staffId || cloned.personalId;
    if (resolvedStaffId) {
      cloned.staffId = resolvedStaffId;
    }
  }

  return {
    ...cloned,
    id: record.id,
    tenantId: targetTenantId,
    migratedFrom: `/${sourceCollection}/${record.id}`,
    migratedAt,
    migrationId: migrationMeta.migrationId,
    migratedBy: migrationMeta.executedBy,
    sourceChecksum: migrationMeta.sourceChecksum,
  };
}
