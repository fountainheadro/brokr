import { AiUsageRecord } from "../../packages/pkg_types/src";
import { logger } from "../../src/core/logger/logger";

export class AiQuotaTracker {
  // Rough token estimation: ~4 chars per token
  public static estimate_tokens(text: string): number {
    return Math.ceil((text || "").length / 4);
  }

  public static calculate_cost_eur(input_tokens: number, output_tokens: number, _model: string): number {
    // Estimated baseline rate for Gemini 3.1 Flash / Lite: ~0.10€ per 1M input, ~0.40€ per 1M output
    const input_cost = (input_tokens / 1_000_000) * 0.10;
    const output_cost = (output_tokens / 1_000_000) * 0.40;
    return Number((input_cost + output_cost).toFixed(6));
  }

  public static create_usage_record(params: {
    tenant_id: string;
    user_id: string;
    operation_type: AiUsageRecord["operation_type"];
    model: string;
    input_tokens: number;
    output_tokens: number;
  }): AiUsageRecord {
    const total_tokens = params.input_tokens + params.output_tokens;
    const estimated_cost_eur = this.calculate_cost_eur(params.input_tokens, params.output_tokens, params.model);

    logger.info(`AI Usage: ${params.operation_type} (${total_tokens} tokens, ~${estimated_cost_eur}€)`, {
      tenant_id: params.tenant_id,
      user_id: params.user_id,
      module: "ai_quota",
    });

    return {
      id: `ai_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      tenant_id: params.tenant_id,
      user_id: params.user_id,
      operation_type: params.operation_type,
      model: params.model,
      input_tokens: params.input_tokens,
      output_tokens: params.output_tokens,
      total_tokens,
      estimated_cost_eur,
      timestamp: new Date().toISOString(),
    };
  }
}
