import { PlatformAuditLogEntry } from "./typ_platform-admin";
import { PersistentStoreService } from "../database/svc_persistent-store";

const COL_AUDIT_LOGS = "platform_audit_logs";

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

/**
 * Scalable storage for platform-level audit logs.
 * Each entry is persisted as its own immutable document under `/platform_audit_logs/{id}`
 * to avoid Firestore's 1MB single-document limit and support bounded high-volume queries.
 */
export class PlatformAuditLogRepository {
  public static async record(
    entry: Omit<PlatformAuditLogEntry, "id" | "timestamp">
  ): Promise<PlatformAuditLogEntry> {
    const fullEntry: PlatformAuditLogEntry = {
      ...entry,
      id: `aud_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
    };

    if (process.env.NODE_ENV === "test" && !PersistentStoreService.isRemoteFirestoreConfigured()) {
      PersistentStoreService.set(COL_AUDIT_LOGS, fullEntry.id, fullEntry);
      return fullEntry;
    }

    try {
      await PersistentStoreService.setAsync(COL_AUDIT_LOGS, fullEntry.id, fullEntry);
    } catch {
      PersistentStoreService.setCacheOnly(COL_AUDIT_LOGS, fullEntry.id, fullEntry);
    }
    return fullEntry;
  }

  public static async addLog(
    entry: Omit<PlatformAuditLogEntry, "id" | "timestamp">
  ): Promise<PlatformAuditLogEntry> {
    return this.record(entry);
  }

  public static async list(options?: {
    limit?: number;
    targetType?: string;
    targetId?: string;
    action?: string;
  }): Promise<{ items: PlatformAuditLogEntry[]; total: number }> {
    const effectiveLimit = Math.min(200, Math.max(1, options?.limit ?? 50));
    let entries: PlatformAuditLogEntry[] = [];

    if (PersistentStoreService.isRemoteFirestoreConfigured() && process.env.NODE_ENV !== "test") {
      try {
        const remote = await PersistentStoreService.remoteRunQueryAtPath<PlatformAuditLogEntry>(
          "",
          {
            from: [{ collectionId: COL_AUDIT_LOGS }],
            orderBy: [{ field: { fieldPath: "timestamp" }, direction: "DESCENDING" }],
            limit: Math.max(effectiveLimit * 2, 100),
          }
        );
        entries = remote
          .map((r) => r.data)
          .filter((d) => Boolean(d && d.id && d.action && d.timestamp));
      } catch {
        const raw = await PersistentStoreService.hydrateCollectionOnce<any>(COL_AUDIT_LOGS, 10_000);
        entries = Object.values(raw).filter((d) => Boolean(d && d.id && d.action && d.timestamp));
      }
    } else {
      const cached = PersistentStoreService.getAll<any>(COL_AUDIT_LOGS);
      for (const val of Object.values(cached)) {
        if (val && Array.isArray(val.entries)) {
          entries.push(...val.entries);
        } else if (val && val.id && val.action) {
          entries.push(val);
        }
      }
    }

    if (entries.length === 0) {
      entries = [...SEED_AUDIT_LOGS];
    }

    entries.sort((a, b) => Date.parse(b.timestamp || "") - Date.parse(a.timestamp || ""));

    let filtered = entries;
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
    return { items: filtered.slice(0, effectiveLimit), total };
  }
}
