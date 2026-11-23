import { PlanRepository } from "./repo_plan";
import { SubscriptionPlanRecord } from "./typ_subscription";
import { ValidationError, NotFoundError } from "../errors/app_error";

export class PlanService {
  public static listPlans(statusFilter?: string): SubscriptionPlanRecord[] {
    return PlanRepository.list(statusFilter);
  }

  public static getPlanById(id: string): SubscriptionPlanRecord {
    const plan = PlanRepository.findById(id);
    if (!plan) {
      throw new NotFoundError("Planul de abonament", id);
    }
    return plan;
  }

  private static buildNewPlan(data: Partial<SubscriptionPlanRecord>): SubscriptionPlanRecord {
    if (!data.id || !data.displayName) {
      throw new ValidationError("ID-ul și denumirea publică a planului sunt obligatorii.");
    }

    if (data.priceMonthly === undefined || data.priceMonthly < 0) {
      throw new ValidationError("Prețul lunar trebuie să fie mai mare sau egal cu 0.");
    }

    return {
      id: data.id.trim().toLowerCase(),
      name: data.name || data.displayName,
      displayName: data.displayName.trim(),
      description: data.description || "",
      priceMonthly: data.priceMonthly,
      priceAnnual: data.priceAnnual !== undefined ? data.priceAnnual : data.priceMonthly * 10,
      currency: data.currency || "RON",
      billingInterval: data.billingInterval || "month",
      status: data.status || "active",
      trialAvailable: data.trialAvailable ?? true,
      trialDays: data.trialDays ?? 14,
      includedModules: data.includedModules || ["mod_leads", "mod_properties", "mod_public_share"],
      quotas: {
        maxAgents: data.quotas?.maxAgents ?? 5,
        maxProperties: data.quotas?.maxProperties ?? 200,
        maxLeads: data.quotas?.maxLeads ?? 500,
        monthlyAiTokens: data.quotas?.monthlyAiTokens ?? 500000,
        monthlyAiRequests: data.quotas?.monthlyAiRequests ?? 500,
        storageMb: data.quotas?.storageMb ?? 10240,
      },
      features: data.features || [],
      displayOrder: data.displayOrder ?? 99,
      metadata: data.metadata || {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  public static createPlan(data: Partial<SubscriptionPlanRecord>): SubscriptionPlanRecord {
    const newPlan = this.buildNewPlan(data);
    return PlanRepository.create(newPlan);
  }

  public static async createPlanAsync(
    data: Partial<SubscriptionPlanRecord>
  ): Promise<SubscriptionPlanRecord> {
    const newPlan = this.buildNewPlan(data);
    return PlanRepository.createAsync(newPlan);
  }

  public static updatePlan(id: string, updates: Partial<SubscriptionPlanRecord>): SubscriptionPlanRecord {
    this.getPlanById(id); // Throws NotFoundError if missing
    return PlanRepository.update(id, updates);
  }

  public static async updatePlanAsync(
    id: string,
    updates: Partial<SubscriptionPlanRecord>
  ): Promise<SubscriptionPlanRecord> {
    await PlanRepository.hydrateAsync();
    this.getPlanById(id);
    return PlanRepository.updateAsync(id, updates);
  }

  public static setPlanStatus(id: string, status: "active" | "inactive" | "archived"): SubscriptionPlanRecord {
    return this.updatePlan(id, { status });
  }

  public static async setPlanStatusAsync(
    id: string,
    status: "active" | "inactive" | "archived"
  ): Promise<SubscriptionPlanRecord> {
    return this.updatePlanAsync(id, { status });
  }
}
