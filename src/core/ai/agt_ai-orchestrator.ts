import {
  AiOrchestrationRequest,
  AiOrchestrationResponse,
} from "./typ_ai-engine";
import { GeminiProvider } from "./agt_gemini-provider";
import { AiConfigService } from "./svc_ai-config";
import { AiConversationService } from "./svc_ai-conversation";
import { AiToolRegistry } from "./svc_ai-tool-registry";
import { QuotaService } from "../subscription/svc_quota";
import { AiQuotaTracker } from "../../../ai/usage/svc_quota-tracker";
import { TenantResolutionService } from "../tenancy/svc_tenant-resolution";
import { ForbiddenError, AppError } from "../errors/app_error";
import { logger } from "../logger/logger";
import { TelemetryCollectorService } from "../telemetry/svc_telemetry-collector";

const MAX_CONCURRENT_AI_PER_TENANT = 5;
const activeAiRequestsByTenant = new Map<string, number>();

export class AiOrchestrator {
  /**
   * Executes a tenant-isolated AI operation with atomic quota reservation, concurrency limit, and tool calling.
   */
  public static async execute(request: AiOrchestrationRequest): Promise<AiOrchestrationResponse> {
    const { tenantId, userId, userRole, prompt, operationType } = request;

    // 1. Validate Tenant & Module Entitlements
    if (!tenantId) {
      throw new ForbiddenError("Context de agenție (TenantContext) lipsă sau invalid.");
    }

    const activeCount = activeAiRequestsByTenant.get(tenantId) || 0;
    if (activeCount >= MAX_CONCURRENT_AI_PER_TENANT) {
      logger.recordMetric("rate_limit");
      throw new AppError({
        message: "Prea multe cereri AI simultane pentru această agenție. Vă rugăm așteptați câteva secunde.",
        code: "RATE_LIMIT_EXCEEDED",
        statusCode: 429,
      });
    }
    activeAiRequestsByTenant.set(tenantId, activeCount + 1);

    try {
      const tenant =
        (await TenantResolutionService.hydrateSingleTenantFromFirestore(tenantId)) ||
        TenantResolutionService.getTenantById(tenantId);
      if (!tenant) {
        throw new ForbiddenError(`Agenția cu ID ${tenantId} nu este înregistrată.`);
      }

      await Promise.all([
        QuotaService.hydrateTenantStateAsync(tenantId),
        AiConfigService.getTenantConfigAsync(tenantId),
      ]);

      // Check module entitlement based on operation
      const requiredModule =
        request.featureModule ||
        (operationType === "property_extraction" ? "mod_ai_extraction" : "mod_ai_extraction");
      const { modules } = QuotaService.getEffectiveQuotas(tenantId);
      if (requiredModule && !modules.includes(requiredModule)) {
        throw new ForbiddenError(
          `Modulul '${requiredModule}' nu este activ în abonamentul agenției dumneavoastră.`
        );
      }

      // 2. Token Estimation & Quota Reservation
      const estimatedTokens = Math.max(1000, GeminiProvider.estimateTokens(prompt) * 2 + 500);
      const reservationId = QuotaService.reserveAiQuota(tenantId, estimatedTokens);

      const conversation = request.conversationId
        ? await AiConversationService.getConversationAsync(tenantId, userId, request.conversationId)
        : await AiConversationService.createConversationAsync(tenantId, userId, prompt.slice(0, 40) + "...");

      // Record user message durably in Cloud Firestore
      await AiConversationService.addMessageAsync(tenantId, conversation.id, {
        role: "user",
        content: prompt,
        tokenCount: GeminiProvider.estimateTokens(prompt),
      });

      try {
        // 3. Build Tenant Composite System Prompt (Precedence: Platform > Agency > Task)
        const systemInstruction = AiConfigService.buildCompositeSystemPrompt({
          tenantId,
          agencyName: tenant.name,
        });

        // 4. Retrieve Conversation History Window
        const historyWindow = AiConversationService.getFormattedHistoryWindow(conversation, 8);

        // Check if user is asking for a tool execution (e.g. search properties, search leads)
        const toolCallsExecuted: Array<{ toolName: string; args: any; result: any }> = [];
        let toolContextText = "";

        const lowerPrompt = prompt.toLowerCase();
        if (
          lowerPrompt.includes("cauta") ||
          lowerPrompt.includes("propriet") ||
          lowerPrompt.includes("imobil") ||
          lowerPrompt.includes("lead") ||
          lowerPrompt.includes("client")
        ) {
          if (lowerPrompt.includes("lead") || lowerPrompt.includes("client")) {
            const leadToolResult = await AiToolRegistry.executeTool(
              "search_leads",
              { query: prompt },
              { tenantId, userId, role: userRole }
            );
            toolCallsExecuted.push({
              toolName: "search_leads",
              args: { query: prompt },
              result: leadToolResult,
            });
            toolContextText = `\n[DATE CRM EXTARSE PENTRU AGENȚIE]: ${JSON.stringify(leadToolResult)}`;
          } else {
            const propToolResult = await AiToolRegistry.executeTool(
              "search_properties",
              { zone: "" },
              { tenantId, userId, role: userRole }
            );
            toolCallsExecuted.push({
              toolName: "search_properties",
              args: {},
              result: propToolResult,
            });
            toolContextText = `\n[DATE CRM EXTARSE PENTRU AGENȚIE]: ${JSON.stringify(propToolResult)}`;
          }
        }

        // 5. Invoke Gemini SDK with isolation boundaries
        const fullContents = [
          ...historyWindow,
          {
            role: "user",
            parts: [{ text: `${prompt}${toolContextText}` }],
          },
        ];

        const model = request.targetModel || GeminiProvider.DEFAULT_MODEL;
        const geminiResult = await GeminiProvider.generate(fullContents, {
          model,
          systemInstruction,
          temperature: request.temperature ?? 0.3,
        });

        const responseText = geminiResult.text;

        // 6. Record Assistant Message in Conversation durably
        await AiConversationService.addMessageAsync(tenantId, conversation.id, {
          role: "assistant",
          content: responseText,
          tokenCount: geminiResult.outputTokens,
        });

        // 7. Commit Actual AI Quota Consumption durably & record Phase 9 agency telemetry
        await QuotaService.commitAiQuotaAsync(reservationId, geminiResult.totalTokens);
        TelemetryCollectorService.recordAiUsage({
          tenantId,
          model,
          promptTokens: geminiResult.inputTokens,
          outputTokens: geminiResult.outputTokens,
          totalTokens: geminiResult.totalTokens,
          requests: 1,
        });

        // 8. Create Usage Audit Record
        const costEstimate = AiQuotaTracker.calculate_cost_eur(
          geminiResult.inputTokens,
          geminiResult.outputTokens,
          model
        );

        AiQuotaTracker.create_usage_record({
          tenant_id: tenantId,
          user_id: userId,
          operation_type: "description_generation",
          model,
          input_tokens: geminiResult.inputTokens,
          output_tokens: geminiResult.outputTokens,
        });

        return {
          conversationId: conversation.id,
          response: responseText,
          toolCallsExecuted,
          tokensUsed: {
            inputTokens: geminiResult.inputTokens,
            outputTokens: geminiResult.outputTokens,
            totalTokens: geminiResult.totalTokens,
          },
          reservationId,
          costEstimateEur: costEstimate,
          model,
        };
      } catch (err: any) {
        // 9. Quota Refund on Error: Release reservation so tenant isn't penalized for failed runs
        QuotaService.refundAiQuota(reservationId);
        logger.recordMetric("ai_job_failure");
        throw err;
      }
    } finally {
      const current = activeAiRequestsByTenant.get(tenantId) || 1;
      if (current <= 1) {
        activeAiRequestsByTenant.delete(tenantId);
      } else {
        activeAiRequestsByTenant.set(tenantId, current - 1);
      }
    }
  }
}
