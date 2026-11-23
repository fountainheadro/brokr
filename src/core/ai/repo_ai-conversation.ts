import { AiConversationRecord } from "./typ_ai-engine";
import { PersistentStoreService } from "../database/svc_persistent-store";

const COL_AI_CONVERSATIONS = "ai_conversations";

const SEED_CONVERSATION: AiConversationRecord = {
  id: "conv_brokr_01",
  tenantId: "ten_brokr_default",
  userId: "usr_agent_brokr",
  title: "Optimizare titluri apartamente Pipera",
  status: "active",
  messages: [
    {
      id: "msg_1",
      role: "user",
      content: "Ajută-mă cu o formulare optimă pentru un apartament de 3 camere în Pipera.",
      timestamp: "2026-02-15T11:00:00.000Z",
    },
    {
      id: "msg_2",
      role: "assistant",
      content: "Sigur! Conform regulilor agenției brokr, am formulat titlul și unghiul de vânzare fără a menționa numărul de bloc sau comision 0%.",
      timestamp: "2026-02-15T11:00:05.000Z",
    },
  ],
  createdAt: "2026-02-15T11:00:00.000Z",
  updatedAt: "2026-02-15T11:00:05.000Z",
};

function ensureSeeded(): Record<string, AiConversationRecord> {
  return PersistentStoreService.seedIfEmpty<AiConversationRecord>(COL_AI_CONVERSATIONS, [
    { id: SEED_CONVERSATION.id, value: { ...SEED_CONVERSATION } },
  ]);
}

export class AiConversationRepository {
  public static findById(id: string): AiConversationRecord | null {
    ensureSeeded();
    return PersistentStoreService.get<AiConversationRecord>(COL_AI_CONVERSATIONS, id);
  }

  public static async findByIdAsync(id: string): Promise<AiConversationRecord | null> {
    if (PersistentStoreService.isRemoteFirestoreConfigured()) {
      try {
        const remote = await PersistentStoreService.remoteGet<AiConversationRecord>(
          COL_AI_CONVERSATIONS,
          id
        );
        if (remote) {
          PersistentStoreService.setCacheOnly(COL_AI_CONVERSATIONS, id, remote);
          return remote;
        }
      } catch {
        // Not found remotely
      }
    }
    return this.findById(id);
  }

  public static listByTenantAndUser(tenantId: string, userId?: string): AiConversationRecord[] {
    const all = ensureSeeded();
    const list: AiConversationRecord[] = [];
    for (const conv of Object.values(all)) {
      if (conv.tenantId === tenantId && conv.status !== "deleted") {
        if (!userId || conv.userId === userId) {
          list.push({ ...conv });
        }
      }
    }
    return list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  public static async listByTenantAndUserAsync(
    tenantId: string,
    userId?: string
  ): Promise<AiConversationRecord[]> {
    if (PersistentStoreService.isRemoteFirestoreConfigured()) {
      try {
        const remoteDocs = await PersistentStoreService.remoteRunQueryAtPath<AiConversationRecord>(
          "",
          {
            from: [{ collectionId: COL_AI_CONVERSATIONS }],
            where: {
              fieldFilter: {
                field: { fieldPath: "tenantId" },
                op: "EQUAL",
                value: { stringValue: tenantId },
              },
            },
            limit: 100,
          }
        );
        const list: AiConversationRecord[] = [];
        for (const entry of remoteDocs) {
          const conv = entry?.data;
          if (conv && conv.id) {
            PersistentStoreService.setCacheOnly(COL_AI_CONVERSATIONS, conv.id, conv);
            if (conv.tenantId === tenantId && conv.status !== "deleted") {
              if (!userId || conv.userId === userId) {
                list.push({ ...conv });
              }
            }
          }
        }
        return list.sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
      } catch {
        // Fallback to local cache on query error
      }
    }
    return this.listByTenantAndUser(tenantId, userId);
  }

  public static save(conv: AiConversationRecord): AiConversationRecord {
    ensureSeeded();
    const updated: AiConversationRecord = {
      ...conv,
      updatedAt: new Date().toISOString(),
    };
    PersistentStoreService.set(COL_AI_CONVERSATIONS, conv.id, updated);
    return updated;
  }

  public static async saveAsync(conv: AiConversationRecord): Promise<AiConversationRecord> {
    ensureSeeded();
    const updated: AiConversationRecord = {
      ...conv,
      updatedAt: new Date().toISOString(),
    };
    await PersistentStoreService.setAsync(COL_AI_CONVERSATIONS, conv.id, updated);
    return updated;
  }

  public static delete(id: string): void {
    const conv = this.findById(id);
    if (conv) {
      conv.status = "deleted";
      PersistentStoreService.set(COL_AI_CONVERSATIONS, id, conv);
    }
  }

  public static async deleteAsync(id: string): Promise<void> {
    const conv = await this.findByIdAsync(id);
    if (conv) {
      const deletedConv: AiConversationRecord = {
        ...conv,
        status: "deleted",
        updatedAt: new Date().toISOString(),
      };
      await PersistentStoreService.setAsync(COL_AI_CONVERSATIONS, id, deletedConv);
    }
  }

  public static resetDefaults(): void {
    PersistentStoreService.clearCollection(COL_AI_CONVERSATIONS);
  }
}
