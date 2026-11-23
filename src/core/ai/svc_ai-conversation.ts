import { AiConversationRecord, AiChatMessage } from "./typ_ai-engine";
import { AiConversationRepository } from "./repo_ai-conversation";
import { ForbiddenError, NotFoundError } from "../errors/app_error";

export class AiConversationService {
  public static createConversation(
    tenantId: string,
    userId: string,
    title = "Conversație nouă"
  ): AiConversationRecord {
    const id = `conv_${tenantId}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();

    const newConv: AiConversationRecord = {
      id,
      tenantId,
      userId,
      title,
      status: "active",
      messages: [],
      createdAt: now,
      updatedAt: now,
    };

    return AiConversationRepository.save(newConv);
  }

  public static async createConversationAsync(
    tenantId: string,
    userId: string,
    title = "Conversație nouă"
  ): Promise<AiConversationRecord> {
    const id = `conv_${tenantId}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();

    const newConv: AiConversationRecord = {
      id,
      tenantId,
      userId,
      title,
      status: "active",
      messages: [],
      createdAt: now,
      updatedAt: now,
    };

    return AiConversationRepository.saveAsync(newConv);
  }

  public static getConversation(
    tenantId: string,
    userId: string,
    conversationId: string,
    allowAdminAccess = false
  ): AiConversationRecord {
    const conv = AiConversationRepository.findById(conversationId);
    if (!conv || conv.status === "deleted") {
      throw new NotFoundError("Conversația AI", conversationId);
    }

    // STRICT TENANT ISOLATION: Cross-tenant access is unconditionally blocked
    if (conv.tenantId !== tenantId) {
      throw new ForbiddenError("Acces interzis: Conversația aparține altei agenții imobiliare.");
    }

    // USER ISOLATION: Unless explicit admin access is permitted, only owner can view
    if (conv.userId !== userId && !allowAdminAccess) {
      throw new ForbiddenError("Acces interzis: Conversația aparține altui utilizator din agenție.");
    }

    return conv;
  }

  public static async getConversationAsync(
    tenantId: string,
    userId: string,
    conversationId: string,
    allowAdminAccess = false
  ): Promise<AiConversationRecord> {
    const conv = await AiConversationRepository.findByIdAsync(conversationId);
    if (!conv || conv.status === "deleted") {
      throw new NotFoundError("Conversația AI", conversationId);
    }

    if (conv.tenantId !== tenantId) {
      throw new ForbiddenError("Acces interzis: Conversația aparține altei agenții imobiliare.");
    }

    if (conv.userId !== userId && !allowAdminAccess) {
      throw new ForbiddenError("Acces interzis: Conversația aparține altui utilizator din agenție.");
    }

    return conv;
  }

  public static listConversations(tenantId: string, userId: string): AiConversationRecord[] {
    return AiConversationRepository.listByTenantAndUser(tenantId, userId);
  }

  public static async listConversationsAsync(
    tenantId: string,
    userId: string
  ): Promise<AiConversationRecord[]> {
    return AiConversationRepository.listByTenantAndUserAsync(tenantId, userId);
  }

  public static addMessage(
    tenantId: string,
    conversationId: string,
    message: Omit<AiChatMessage, "id" | "timestamp">
  ): AiChatMessage {
    const conv = AiConversationRepository.findById(conversationId);
    if (!conv || conv.status === "deleted") {
      throw new NotFoundError("Conversația AI", conversationId);
    }

    if (conv.tenantId !== tenantId) {
      throw new ForbiddenError("Tentativă de adăugare mesaj într-o conversație a altei agenții.");
    }

    const newMessage: AiChatMessage = {
      ...message,
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
    };

    conv.messages.push(newMessage);
    AiConversationRepository.save(conv);

    return newMessage;
  }

  public static async addMessageAsync(
    tenantId: string,
    conversationId: string,
    message: Omit<AiChatMessage, "id" | "timestamp">
  ): Promise<AiChatMessage> {
    const conv = await AiConversationRepository.findByIdAsync(conversationId);
    if (!conv || conv.status === "deleted") {
      throw new NotFoundError("Conversația AI", conversationId);
    }

    if (conv.tenantId !== tenantId) {
      throw new ForbiddenError("Tentativă de adăugare mesaj într-o conversație a altei agenții.");
    }

    const newMessage: AiChatMessage = {
      ...message,
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
    };

    const updatedConv: AiConversationRecord = {
      ...conv,
      messages: [...(conv.messages || []), newMessage],
    };
    await AiConversationRepository.saveAsync(updatedConv);

    return newMessage;
  }

  public static deleteConversation(tenantId: string, userId: string, conversationId: string): void {
    const conv = this.getConversation(tenantId, userId, conversationId, true);
    AiConversationRepository.delete(conv.id);
  }

  public static async deleteConversationAsync(
    tenantId: string,
    userId: string,
    conversationId: string
  ): Promise<void> {
    const conv = await this.getConversationAsync(tenantId, userId, conversationId, true);
    await AiConversationRepository.deleteAsync(conv.id);
  }

  /**
   * Formats a rolling window of recent messages for Gemini prompt context.
   */
  public static getFormattedHistoryWindow(conv: AiConversationRecord, maxMessages = 10): any[] {
    const slice = conv.messages.slice(-maxMessages);
    return slice.map((m) => {
      if (m.role === "user") {
        return { role: "user", parts: [{ text: m.content }] };
      }
      return { role: "model", parts: [{ text: m.content }] };
    });
  }
}
