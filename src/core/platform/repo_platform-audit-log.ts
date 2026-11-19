import { PlatformAuditLogEntry } from "./typ_platform-admin";
import { PersistentStoreService } from "../database/svc_persistent-store";

const COL_AUDIT_LOGS = "platform_audit_logs";
const AUDIT_DOC_ID = "log_stream";
const MAX_AUDIT_LOGS = 2000;

/**
 * Storage for platform-level audit logs.
 * Audit logs record all administrative mutations and are protected against alteration.
 */
const SEED_AUDIT_LOGS: PlatformAuditLogEntry[] = [
  {
    id: "aud_101",
    actorUserId: "usr_super_admin",
    actorEmail: "fountainheadro@gmail.com",
    actorRole: "super_admin",
    action: "agency_note_added",
    targetType: "agency",
    targetId: "ten_brokr_default",
    targetName: "Brokr Real Estate",
    details: { note: "Verificare periodică de securitate finalizată cu succes." },
    result: "success",
    timestamp: "2026-02-15T10:30:00.000Z",
  },
  {
    id: "aud_102",
    actorUserId: "usr_super_admin",
    actorEmail: "fountainheadro@gmail.com",
    actorRole: "super_admin",
    action: "agency_suspended",
    targetType: "agency",
    targetId: "ten_suspended_agency",
    targetName: "Suspended Agency SRL",
    details: { reason: "Suspendare administrativă pentru neplată abonament." },
    result: "success",
    timestamp: "2026-03-01T14:15:00.000Z",
  },
];

function getAuditEntries(): PlatformAuditLogEntry[] {
  const doc = PersistentStoreService.seedDocumentIfMissing<{ entries: PlatformAuditLogEntry[] }>(
    COL_AUDIT_LOGS,
    AUDIT_DOC_ID,
    { entries: [...SEED_AUDIT_LOGS] }
  );
  return Array.isArray(doc?.entries) ? doc.entries : [...SEED_AUDIT_LOGS];
}

export class PlatformAuditLogRepository {
  /**
   * Records a new audit log entry.
   */
  public static async record(
    entry: Omit<PlatformAuditLogEntry, "id" | "timestamp">
  ): Promise<PlatformAuditLogEntry> {
    const fullEntry: PlatformAuditLogEntry = {
      ...entry,
      id: `aud_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
    };

    const current = getAuditEntries();
    const updated = [fullEntry, ...current].slice(0, MAX_AUDIT_LOGS);
    PersistentStoreService.set(COL_AUDIT_LOGS, AUDIT_DOC_ID, { entries: updated });
    return fullEntry;
  }

  /**
   * Alias for record.
   */
  public static async addLog(
    entry: Omit<PlatformAuditLogEntry, "id" | "timestamp">
  ): Promise<PlatformAuditLogEntry> {
    return this.record(entry);
  }

  /**
   * Lists audit logs with optional filtering and pagination.
   */
  public static async list(options?: {
    limit?: number;
    targetType?: string;
    targetId?: string;
    action?: string;
  }): Promise<{ items: PlatformAuditLogEntry[]; total: number }> {
    let filtered = [...getAuditEntries()];

    if (options?.targetType) {
      filtered = filtered.filter((e) => e.targetType === options.targetType);
    }
    if (options?.targetId) {
      filtered = filtered.filter((e) => e.targetId === options.targetId);
    }
    if (options?.action) {
      filtered = filtered.filter((e) => e.action === options.action);
    }

    const total = filtered.length;
    if (options?.limit) {
      filtered = filtered.slice(0, options.limit);
    }

    return { items: filtered, total };
  }
}
