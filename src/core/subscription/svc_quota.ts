import {
  PlanQuotas,
  QuotaResourceType,
  QuotaCheckResult,
  TenantEffectiveEntitlements,
  ModuleId,
} from "./typ_subscription";
import { SubscriptionRepository } from "./repo_subscription";
import { PlanService } from "./svc_plan";
import { ModuleCatalogService } from "./svc_module";
import { TenantMembershipService } from "../tenancy/svc_tenant-membership";
import { QuotaExceededError, NotFoundError } from "../errors/app_error";
import { PersistentStoreService } from "../database/svc_persistent-store";

export interface AiQuotaReservation {
  id: string;
  tenantId: string;
  estimatedTokens: number;
  status: "reserved" | "committed" | "refunded";
  createdAt: string;
  expiresAt: string;
}

interface TenantUsageState {
  properties: number;
  leads: number;
  aiTokens: number;
  aiRequests: number;
  storageMb: number;
}

const COL_TENANT_USAGE = "tenant_usage";
const COL_AI_RESERVATIONS = "ai_reservations";

const INITIAL_USAGE: Record<string, TenantUsageState> = {
  ten_brokr_default: {
    properties: 42,
    leads: 118,
    aiTokens: 84200,
    aiRequests: 48,
    storageMb: 1420,
  },
  ten_agency_a: {
    properties: 125,
    leads: 310,
    aiTokens: 620000,
    aiRequests: 412,
    storageMb: 8500,
  },
  ten_agency_b: {
    properties: 12,
    leads: 28,
    aiTokens: 18500,
    aiRequests: 14,
    storageMb: 340,
  },
};

function ensureUsageSeeded(): void {
  PersistentStoreService.seedIfEmpty<TenantUsageState>(
    COL_TENANT_USAGE,
    Object.entries(INITIAL_USAGE).map(([tenantId, state]) => ({
      id: tenantId,
      value: { ...state },
    }))
  );
}

function getUsageValue(
  usage: TenantUsageState & { agents: number },
  resource: QuotaResourceType
): number {
  switch (resource) {
    case "agents":
      return usage.agents;
    case "properties":
      return usage.properties;
    case "leads":
      return usage.leads;
    case "ai_tokens":
      return usage.aiTokens;
    case "ai_requests":
      return usage.aiRequests;
    case "storage_mb":
      return usage.storageMb;
  }
}

function addUsageValue(usage: TenantUsageState, resource: Exclude<QuotaResourceType, "agents">, delta: number): void {
  switch (resource) {
    case "properties":
      usage.properties = Math.max(0, usage.properties + delta);
      break;
    case "leads":
      usage.leads = Math.max(0, usage.leads + delta);
      break;
    case "ai_tokens":
      usage.aiTokens = Math.max(0, usage.aiTokens + delta);
      break;
    case "ai_requests":
      usage.aiRequests = Math.max(0, usage.aiRequests + delta);
      break;
    case "storage_mb":
      usage.storageMb = Math.max(0, usage.storageMb + delta);
      break;
  }
}

export class QuotaService {
  /**
   * Returns current raw usage for a tenant.
   */
  public static getUsage(tenantId: string): TenantUsageState & { agents: number } {
    ensureUsageSeeded();
    let usage = PersistentStoreService.get<TenantUsageState>(COL_TENANT_USAGE, tenantId);
    if (!usage) {
      usage = {
        properties: 0,
        leads: 0,
        aiTokens: 0,
        aiRequests: 0,
        storageMb: 0,
      };
      PersistentStoreService.set(COL_TENANT_USAGE, tenantId, usage);
    }

    // Agents count is always live from TenantMembershipService
    const members = TenantMembershipService.listTenantMembers(tenantId);
    const activeAgents = members.filter((m) => m.status === "active").length;

    return {
      ...usage,
      agents: activeAgents,
    };
  }

  /**
   * Computes effective quotas for a tenant (Plan base + Add-ons + Custom).
   */
  public static getEffectiveQuotas(tenantId: string): { quotas: PlanQuotas; modules: ModuleId[] } {
    const subscription = SubscriptionRepository.findByTenantId(tenantId);
    const plan = PlanService.getPlanById(subscription?.planId || "plan_starter");

    const effectiveQuotas: PlanQuotas = { ...plan.quotas };
    const effectiveModules = new Set<ModuleId>(plan.includedModules);

    // Apply active add-ons
    if (subscription?.activeAddons) {
      for (const activeAddon of subscription.activeAddons) {
        const addon = ModuleCatalogService.getAddonById(activeAddon.addonId);
        if (addon && addon.isActive) {
          const qty = activeAddon.quantity || 1;
          if (addon.quotaGrant.maxAgents !== undefined && effectiveQuotas.maxAgents !== -1) {
            effectiveQuotas.maxAgents += addon.quotaGrant.maxAgents * qty;
          }
          if (addon.quotaGrant.maxProperties !== undefined && effectiveQuotas.maxProperties !== -1) {
            effectiveQuotas.maxProperties += addon.quotaGrant.maxProperties * qty;
          }
          if (addon.quotaGrant.maxLeads !== undefined && effectiveQuotas.maxLeads !== -1) {
            effectiveQuotas.maxLeads += addon.quotaGrant.maxLeads * qty;
          }
          if (addon.quotaGrant.monthlyAiTokens !== undefined) {
            effectiveQuotas.monthlyAiTokens += addon.quotaGrant.monthlyAiTokens * qty;
          }
          if (addon.quotaGrant.monthlyAiRequests !== undefined) {
            effectiveQuotas.monthlyAiRequests += addon.quotaGrant.monthlyAiRequests * qty;
          }
          if (addon.quotaGrant.storageMb !== undefined) {
            effectiveQuotas.storageMb += addon.quotaGrant.storageMb * qty;
          }
          if (addon.includedModules) {
            addon.includedModules.forEach((m) => effectiveModules.add(m));
          }
        }
      }
    }

    // Apply custom tenant overrides if any
    if (subscription?.customQuotas) {
      Object.assign(effectiveQuotas, subscription.customQuotas);
    }
    if (subscription?.customModules) {
      subscription.customModules.forEach((m) => effectiveModules.add(m));
    }

    return {
      quotas: effectiveQuotas,
      modules: Array.from(effectiveModules),
    };
  }

  /**
   * Retrieves complete tenant entitlements and usage snapshot.
   */
  public static getTenantEntitlements(tenantId: string): TenantEffectiveEntitlements {
    const subscription = SubscriptionRepository.findByTenantId(tenantId);
    if (!subscription) {
      throw new NotFoundError("Abonamentul agenției", tenantId);
    }

    const plan = PlanService.getPlanById(subscription.planId);
    const { quotas, modules } = this.getEffectiveQuotas(tenantId);
    const usage = this.getUsage(tenantId);

    const calcRemaining = (limit: number, current: number): number | null => {
      if (limit === -1) return null; // Unlimited
      return Math.max(0, limit - current);
    };

    const warnings: string[] = [];

    // Warn if > 85% of any limited quota
    if (quotas.maxAgents !== -1 && usage.agents / quotas.maxAgents >= 0.85) {
      warnings.push(`Ați atins ${usage.agents} din ${quotas.maxAgents} conturi de broker permise.`);
    }
    if (quotas.maxProperties !== -1 && usage.properties / quotas.maxProperties >= 0.85) {
      warnings.push(`Portofoliul este aproape de limită (${usage.properties}/${quotas.maxProperties} imobile).`);
    }
    if (quotas.monthlyAiTokens > 0 && usage.aiTokens / quotas.monthlyAiTokens >= 0.85) {
      warnings.push(`Ați consumat peste 85% din tokenii AI lunari (${usage.aiTokens.toLocaleString()}/${quotas.monthlyAiTokens.toLocaleString()}).`);
    }

    const isTrial = subscription.status === "trialing";
    let daysRemainingInTrial: number | undefined;
    if (isTrial && subscription.trialEnd) {
      const msLeft = new Date(subscription.trialEnd).getTime() - Date.now();
      daysRemainingInTrial = Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));
    }

    const isInGracePeriod =
      subscription.status === "past_due" &&
      !!subscription.gracePeriodEnd &&
      new Date(subscription.gracePeriodEnd).getTime() > Date.now();

    return {
      tenantId,
      subscriptionId: subscription.id,
      planId: plan.id,
      planDisplayName: plan.displayName,
      subscriptionStatus: subscription.status,
      isInGracePeriod,
      isTrial,
      daysRemainingInTrial,
      billingInterval: subscription.billingInterval,
      currentPeriodEnd: subscription.currentPeriodEnd,
      effectiveModules: modules,
      effectiveQuotas: quotas,
      currentUsage: usage,
      remainingQuotas: {
        agents: calcRemaining(quotas.maxAgents, usage.agents),
        properties: calcRemaining(quotas.maxProperties, usage.properties),
        leads: calcRemaining(quotas.maxLeads, usage.leads),
        aiTokens: calcRemaining(quotas.monthlyAiTokens, usage.aiTokens),
        aiRequests: calcRemaining(quotas.monthlyAiRequests, usage.aiRequests),
        storageMb: calcRemaining(quotas.storageMb, usage.storageMb),
      },
      warnings,
    };
  }

  /**
   * Verifies if an agency has sufficient quota for a requested operation.
   */
  public static checkQuota(tenantId: string, resource: QuotaResourceType, requestedAmount = 1): QuotaCheckResult {
    const entitlements = this.getTenantEntitlements(tenantId);
    const usage = getUsageValue(entitlements.currentUsage, resource);

    let limit = -1;
    switch (resource) {
      case "agents":
        limit = entitlements.effectiveQuotas.maxAgents;
        break;
      case "properties":
        limit = entitlements.effectiveQuotas.maxProperties;
        break;
      case "leads":
        limit = entitlements.effectiveQuotas.maxLeads;
        break;
      case "ai_tokens":
        limit = entitlements.effectiveQuotas.monthlyAiTokens;
        break;
      case "ai_requests":
        limit = entitlements.effectiveQuotas.monthlyAiRequests;
        break;
      case "storage_mb":
        limit = entitlements.effectiveQuotas.storageMb;
        break;
    }

    if (limit === -1) {
      return {
        allowed: true,
        resource,
        requested: requestedAmount,
        current: usage,
        limit: -1,
        remaining: Infinity,
      };
    }

    const remaining = Math.max(0, limit - usage);
    const allowed = usage + requestedAmount <= limit;

    return {
      allowed,
      resource,
      requested: requestedAmount,
      current: usage,
      limit,
      remaining,
      reason: allowed
        ? undefined
        : `Limita de ${resource} (${limit}) a fost atinsă. Utilizare curentă: ${usage}, solicitat: ${requestedAmount}.`,
      actionRequired: allowed ? undefined : "upgrade_plan",
    };
  }

  /**
   * Consumes quota atomically. Throws QuotaExceededError if limit is reached.
   */
  public static consumeQuota(tenantId: string, resource: QuotaResourceType, amount = 1): void {
    const check = this.checkQuota(tenantId, resource, amount);
    if (!check.allowed) {
      throw new QuotaExceededError(
        check.reason || `Limita resursei ${resource} a fost depășită.`,
        { current: check.current, max: check.limit, metric: resource },
        tenantId
      );
    }

    if (resource !== "agents") {
      const usage = this.getUsage(tenantId);
      const { agents: _agents, ...persisted } = usage;
      addUsageValue(persisted, resource, amount);
      PersistentStoreService.set(COL_TENANT_USAGE, tenantId, persisted);
    }
  }

  /**
   * Decrements or frees a quota count (e.g. when a property is deleted).
   */
  public static releaseQuota(tenantId: string, resource: QuotaResourceType, amount = 1): void {
    if (resource === "agents") return; // Agents handled by membership

    const usage = this.getUsage(tenantId);
    const { agents: _agents, ...persisted } = usage;
    addUsageValue(persisted, resource, -amount);
    PersistentStoreService.set(COL_TENANT_USAGE, tenantId, persisted);
  }

  /**
   * AI Usage: Reserves tokens prior to calling Gemini SDK.
   */
  public static reserveAiQuota(tenantId: string, estimatedTokens: number): string {
    const check = this.checkQuota(tenantId, "ai_tokens", estimatedTokens);
    if (!check.allowed) {
      throw new QuotaExceededError(
        `Alocarea lunară de tokeni AI este insuficientă pentru această operațiune (estimat: ${estimatedTokens.toLocaleString()} tokeni).`,
        { current: check.current, max: check.limit, metric: "ai_tokens" },
        tenantId
      );
    }

    const reservationId = `res_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min TTL

    PersistentStoreService.set(COL_AI_RESERVATIONS, reservationId, {
      id: reservationId,
      tenantId,
      estimatedTokens,
      status: "reserved",
      createdAt: new Date().toISOString(),
      expiresAt,
    } satisfies AiQuotaReservation);

    return reservationId;
  }

  /**
   * AI Usage: Commits actual tokens used after operation succeeds.
   */
  public static commitAiQuota(reservationId: string, actualTokens: number): void {
    const reservation = PersistentStoreService.get<AiQuotaReservation>(
      COL_AI_RESERVATIONS,
      reservationId
    );
    if (!reservation) {
      return;
    }

    if (reservation.status !== "reserved") {
      return; // Already committed or refunded
    }

    reservation.status = "committed";
    PersistentStoreService.set(COL_AI_RESERVATIONS, reservationId, reservation);

    // Consume the actual tokens used
    const usage = this.getUsage(reservation.tenantId);
    usage.aiTokens += actualTokens;
    usage.aiRequests += 1;
    const { agents: _agents, ...persisted } = usage;
    PersistentStoreService.set(COL_TENANT_USAGE, reservation.tenantId, persisted);
  }

  /**
   * AI Usage: Refunds reservation if AI generation fails or is aborted.
   */
  public static refundAiQuota(reservationId: string): void {
    const reservation = PersistentStoreService.get<AiQuotaReservation>(
      COL_AI_RESERVATIONS,
      reservationId
    );
    if (!reservation) return;

    if (reservation.status === "reserved") {
      reservation.status = "refunded";
      PersistentStoreService.set(COL_AI_RESERVATIONS, reservationId, reservation);
    }
  }

  /**
   * Downgrade Safety Policy:
   * When an agency downgrades plan, existing data is NEVER deleted.
   * If usage > new limit, further creations are blocked until upgraded or cleaned up.
   */
  public static verifyDowngradeImpact(
    tenantId: string,
    newPlanId: string
  ): { safe: boolean; exceededResources: Array<{ resource: QuotaResourceType; current: number; newLimit: number }> } {
    const newPlan = PlanService.getPlanById(newPlanId);
    const usage = this.getUsage(tenantId);
    const exceeded: Array<{ resource: QuotaResourceType; current: number; newLimit: number }> = [];

    if (newPlan.quotas.maxAgents !== -1 && usage.agents > newPlan.quotas.maxAgents) {
      exceeded.push({ resource: "agents", current: usage.agents, newLimit: newPlan.quotas.maxAgents });
    }
    if (newPlan.quotas.maxProperties !== -1 && usage.properties > newPlan.quotas.maxProperties) {
      exceeded.push({ resource: "properties", current: usage.properties, newLimit: newPlan.quotas.maxProperties });
    }
    if (newPlan.quotas.maxLeads !== -1 && usage.leads > newPlan.quotas.maxLeads) {
      exceeded.push({ resource: "leads", current: usage.leads, newLimit: newPlan.quotas.maxLeads });
    }

    return {
      safe: exceeded.length === 0,
      exceededResources: exceeded,
    };
  }

  public static resetDefaults(): void {
    PersistentStoreService.clearCollection(COL_TENANT_USAGE);
    PersistentStoreService.clearCollection(COL_AI_RESERVATIONS);
    for (const [tenantId, state] of Object.entries(INITIAL_USAGE)) {
      PersistentStoreService.set(COL_TENANT_USAGE, tenantId, { ...state });
    }
  }
}
