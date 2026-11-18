import { QuotaExceededError, ForbiddenError } from "../../src/core/errors/app_error";

export interface TenantAiContext {
  tenant_id: string;
  user_id: string;
  agency_name: string;
  custom_instructions?: string;
  monthly_quota: number;
  consumed_quota: number;
}

export class AiPolicyEngine {
  public static assert_can_invoke(context: TenantAiContext, estimated_tokens = 1000): void {
    if (!context.tenant_id) {
      throw new ForbiddenError("Operațiunea AI necesită un context de agenție valid.");
    }

    if (context.consumed_quota + estimated_tokens > context.monthly_quota) {
      throw new QuotaExceededError(
        `Limita lunară de utilizare AI pentru agenția ${context.agency_name} a fost atinsă.`,
        {
          current: context.consumed_quota,
          max: context.monthly_quota,
          metric: "tokens",
        },
        context.tenant_id
      );
    }
  }

  public static sanitize_input(input: string): string {
    if (!input) return "";
    // Strip excessive length to prevent token abuse
    return input.substring(0, 50000);
  }
}
