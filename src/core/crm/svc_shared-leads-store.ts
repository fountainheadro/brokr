import { PersistentStoreService } from "../database/svc_persistent-store";
import { AppError } from "../errors/app_error";
import {
  projectLeadToSummary,
  SHARED_LEADS_SUMMARY_COLLECTION,
  type LeadSummary,
} from "./svc_lead-projection";

export const PLATFORM_SHARED_LEADS_COLLECTION = "platform_shared_leads";

function assertSafeDocId(id: string): string {
  const trimmed = String(id || "").trim();
  if (
    !trimmed ||
    trimmed.length > 128 ||
    !/^[a-zA-Z0-9_.-]+$/.test(trimmed) ||
    trimmed === "." ||
    trimmed === ".."
  ) {
    throw new AppError({
      message: "Identificator invalid pentru lead-ul global.",
      code: "VALIDATION_ERROR",
      statusCode: 400,
    });
  }
  return trimmed;
}

/**
 * Server-authoritative repository for `platform_shared_leads` + its read-only slim
 * projection `platform_shared_leads_summary`.
 * All mutations execute in a single atomic Firestore `:commit` batch so `firestore.rules`
 * can enforce `allow write: if false;` on `platform_shared_leads_summary` for browser clients.
 */
export class SharedLeadStoreService {
  private static isUsingLiveFirestore(): boolean {
    if (process.env.NODE_ENV !== "test") return true;
    return PersistentStoreService.isRemoteFirestoreConfigured();
  }

  public static async listCanonical(limit = 1000): Promise<Array<Record<string, any>>> {
    const safeLimit = Math.min(2000, Math.max(1, limit));
    if (this.isUsingLiveFirestore()) {
      const maxPages = Math.max(1, Math.ceil(safeLimit / 300));
      return PersistentStoreService.remoteListAtPath<Record<string, any>>(
        PLATFORM_SHARED_LEADS_COLLECTION,
        Math.min(300, safeLimit),
        maxPages
      );
    }
    return Object.values(
      PersistentStoreService.getAll<Record<string, any>>(PLATFORM_SHARED_LEADS_COLLECTION)
    );
  }

  public static async listSummaries(limit = 1000): Promise<LeadSummary[]> {
    const safeLimit = Math.min(2000, Math.max(1, limit));
    if (this.isUsingLiveFirestore()) {
      const maxPages = Math.max(1, Math.ceil(safeLimit / 300));
      return PersistentStoreService.remoteListAtPath<LeadSummary>(
        SHARED_LEADS_SUMMARY_COLLECTION,
        Math.min(300, safeLimit),
        maxPages
      );
    }
    return Object.values(
      PersistentStoreService.getAll<LeadSummary>(SHARED_LEADS_SUMMARY_COLLECTION)
    );
  }

  public static async upsertSharedLead(
    rawDoc: Record<string, any>
  ): Promise<{ canonical: Record<string, any>; summary: LeadSummary }> {
    const safeId = assertSafeDocId(rawDoc?.id);
    const now = new Date().toISOString();

    let existingVersion = 0;
    try {
      const existing = this.isUsingLiveFirestore()
        ? await PersistentStoreService.remoteGetAtPath<Record<string, any>>(
            `${PLATFORM_SHARED_LEADS_COLLECTION}/${safeId}`
          )
        : PersistentStoreService.get<Record<string, any>>(PLATFORM_SHARED_LEADS_COLLECTION, safeId);
      if (existing && typeof existing.docVersion === "number") {
        existingVersion = existing.docVersion;
      }
    } catch {
      existingVersion = 0;
    }

    const docVersion = existingVersion >= 1 ? Math.floor(existingVersion) + 1 : 1;
    const canonical: Record<string, any> = {
      ...rawDoc,
      id: safeId,
      isSharedLead: true,
      status: rawDoc?.status || "Noi",
      createdAt: rawDoc?.createdAt || now,
      updatedAt: now,
      docVersion,
    };

    const summary = projectLeadToSummary(canonical, {
      isSharedLead: true,
      docVersion,
    });

    if (this.isUsingLiveFirestore()) {
      const { projectId, databaseId } = PersistentStoreService.getFirebaseTarget();
      const basePrefix = `projects/${projectId}/databases/${databaseId}/documents`;
      const isUserToken = PersistentStoreService.isUsingUserScopedToken();

      try {
        await PersistentStoreService.remoteCommitWrites(
          [
            {
              update: {
                name: `${basePrefix}/${PLATFORM_SHARED_LEADS_COLLECTION}/${safeId}`,
                fields: PersistentStoreService.encodeDocumentFields(canonical),
              },
            },
            {
              update: {
                name: `${basePrefix}/${SHARED_LEADS_SUMMARY_COLLECTION}/${safeId}`,
                fields: PersistentStoreService.encodeDocumentFields(summary),
              },
            },
          ],
          "upsert_shared_lead_dual_write",
          isUserToken ? { silentOnStatuses: [403] } : undefined
        );
      } catch (err: any) {
        if (isUserToken && err?.statusCode === 403) {
          await PersistentStoreService.remoteSetAtPath(
            `${PLATFORM_SHARED_LEADS_COLLECTION}/${safeId}`,
            canonical
          );
        } else {
          throw err;
        }
      }
    } else {
      PersistentStoreService.set(PLATFORM_SHARED_LEADS_COLLECTION, safeId, canonical);
      PersistentStoreService.set(SHARED_LEADS_SUMMARY_COLLECTION, safeId, summary);
    }

    return { canonical, summary };
  }

  public static async deleteSharedLead(leadId: string): Promise<boolean> {
    const safeId = assertSafeDocId(leadId);
    if (this.isUsingLiveFirestore()) {
      const { projectId, databaseId } = PersistentStoreService.getFirebaseTarget();
      const basePrefix = `projects/${projectId}/databases/${databaseId}/documents`;
      const isUserToken = PersistentStoreService.isUsingUserScopedToken();
      try {
        await PersistentStoreService.remoteCommitWrites(
          [
            { delete: `${basePrefix}/${PLATFORM_SHARED_LEADS_COLLECTION}/${safeId}` },
            { delete: `${basePrefix}/${SHARED_LEADS_SUMMARY_COLLECTION}/${safeId}` },
          ],
          "delete_shared_lead_dual_write",
          isUserToken ? { silentOnStatuses: [403] } : undefined
        );
      } catch (err: any) {
        if (isUserToken && err?.statusCode === 403) {
          await PersistentStoreService.remoteDeleteAtPath(
            `${PLATFORM_SHARED_LEADS_COLLECTION}/${safeId}`
          );
        } else {
          throw err;
        }
      }
      return true;
    }

    const deleted = PersistentStoreService.delete(PLATFORM_SHARED_LEADS_COLLECTION, safeId);
    PersistentStoreService.delete(SHARED_LEADS_SUMMARY_COLLECTION, safeId);
    return deleted;
  }

  public static async clearAllSharedLeads(): Promise<number> {
    if (this.isUsingLiveFirestore()) {
      const docs = await this.listCanonical(2000);
      if (docs.length === 0) return 0;

      const { projectId, databaseId } = PersistentStoreService.getFirebaseTarget();
      const basePrefix = `projects/${projectId}/databases/${databaseId}/documents`;
      const isUserToken = PersistentStoreService.isUsingUserScopedToken();

      for (let i = 0; i < docs.length; i += 200) {
        const chunk = docs.slice(i, i + 200).filter((d) => Boolean(d.id));
        const writes = chunk.flatMap((d) => [
          { delete: `${basePrefix}/${PLATFORM_SHARED_LEADS_COLLECTION}/${d.id}` },
          { delete: `${basePrefix}/${SHARED_LEADS_SUMMARY_COLLECTION}/${d.id}` },
        ]);
        try {
          await PersistentStoreService.remoteCommitWrites(
            writes,
            "clear_shared_leads_dual_write",
            isUserToken ? { silentOnStatuses: [403] } : undefined
          );
        } catch (err: any) {
          if (isUserToken && err?.statusCode === 403) {
            await PersistentStoreService.remoteCommitWrites(
              chunk.map((d) => ({
                delete: `${basePrefix}/${PLATFORM_SHARED_LEADS_COLLECTION}/${d.id}`,
              })),
              "clear_shared_leads_canonical"
            );
          } else {
            throw err;
          }
        }
      }
      return docs.length;
    }

    const existing = PersistentStoreService.getAll(PLATFORM_SHARED_LEADS_COLLECTION);
    const count = Object.keys(existing).length;
    PersistentStoreService.clearCollection(PLATFORM_SHARED_LEADS_COLLECTION);
    PersistentStoreService.clearCollection(SHARED_LEADS_SUMMARY_COLLECTION);
    return count;
  }
}
