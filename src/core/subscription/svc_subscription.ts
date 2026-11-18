import {
  AgencySubscriptionRecord,
  SubscriptionStatus,
  BillingInterval,
} from "./typ_subscription";
import { SubscriptionRepository } from "./repo_subscription";
import { PlanService } from "./svc_plan";
import { ModuleCatalogService } from "./svc_module";
import { QuotaService } from "./svc_quota";
import { PlatformAuditLogRepository } from "../platform/repo_platform-audit-log";
import { NotFoundError } from "../errors/app_error";

export class SubscriptionService {
  public static getByTenantId(tenantId: string): AgencySubscriptionRecord {
    const sub = SubscriptionRepository.findByTenantId(tenantId);
    if (!sub) {
      throw new NotFoundError("Abonamentul agenției", tenantId);
    }
    return sub;
  }

  public static listSubscriptions(filter?: { status?: string; planId?: string }): AgencySubscriptionRecord[] {
    return SubscriptionRepository.list(filter);
  }

  /**
   * Assigns or updates a subscription plan for an agency.
   */
  public static changePlan(
    tenantId: string,
    newPlanId: string,
    billingInterval: BillingInterval,
    actorEmail: string
  ): AgencySubscriptionRecord {
    const newPlan = PlanService.getPlanById(newPlanId);
    const existing = SubscriptionRepository.findByTenantId(tenantId);

    // Verify downgrade impact (preserves data, flags warnings if current usage exceeds new limits)
    const downgradeCheck = QuotaService.verifyDowngradeImpact(tenantId, newPlanId);

    const now = new Date();
    const currentPeriodStart = now.toISOString();
    const periodEnd = new Date(now);
    if (billingInterval === "year") {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    }

    const updated: AgencySubscriptionRecord = {
      id: existing ? existing.id : `sub_${tenantId}_${Date.now()}`,
      tenantId,
      planId: newPlan.id,
      status: "active",
      billingInterval,
      currentPeriodStart,
      currentPeriodEnd: periodEnd.toISOString(),
      trialEnd: null,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
      suspendedAt: null,
      suspendedReason: null,
      gracePeriodEnd: null,
      activeAddons: existing?.activeAddons || [],
      provider: existing?.provider || "mock",
      providerSubscriptionId: existing?.providerSubscriptionId || `sub_mock_${Date.now()}`,
      providerCustomerId: existing?.providerCustomerId || `cus_mock_${tenantId}`,
      createdAt: existing ? existing.createdAt : currentPeriodStart,
      updatedAt: currentPeriodStart,
    };

    const saved = SubscriptionRepository.save(updated);

    // Record audit log
    PlatformAuditLogRepository.record({
      action: "agency_plan_changed",
      actorId: actorEmail,
      actorEmail,
      targetType: "agency",
      targetId: tenantId,
      tenantId,
      details: {
        previousPlanId: existing?.planId,
        newPlanId: newPlan.id,
        billingInterval,
        downgradeImpact: downgradeCheck.exceededResources,
      },
    });

    return saved;
  }

  /**
   * Starts a new trial subscription for an agency.
   */
  public static startTrial(
    tenantId: string,
    planId: string,
    actorEmail: string,
    trialDays = 14
  ): AgencySubscriptionRecord {
    const plan = PlanService.getPlanById(planId);
    const now = new Date();
    const trialEnd = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);

    const newSub: AgencySubscriptionRecord = {
      id: `sub_${tenantId}_trial_${Date.now()}`,
      tenantId,
      planId: plan.id,
      status: "trialing",
      billingInterval: "month",
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: trialEnd.toISOString(),
      trialEnd: trialEnd.toISOString(),
      cancelAtPeriodEnd: false,
      cancelledAt: null,
      suspendedAt: null,
      suspendedReason: null,
      gracePeriodEnd: null,
      activeAddons: [],
      provider: "mock",
      providerSubscriptionId: null,
      providerCustomerId: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    const saved = SubscriptionRepository.save(newSub);

    PlatformAuditLogRepository.record({
      action: "agency_trial_started",
      actorId: actorEmail,
      actorEmail,
      targetType: "agency",
      targetId: tenantId,
      tenantId,
      details: { planId, trialDays, trialEnd: trialEnd.toISOString() },
    });

    return saved;
  }

  /**
   * Updates subscription lifecycle status (e.g. active, past_due, suspended, cancelled).
   */
  public static updateStatus(
    tenantId: string,
    newStatus: SubscriptionStatus,
    reason: string,
    actorEmail: string
  ): AgencySubscriptionRecord {
    const sub = this.getByTenantId(tenantId);
    const prevStatus = sub.status;
    const now = new Date().toISOString();

    sub.status = newStatus;
    if (newStatus === "suspended") {
      sub.suspendedAt = now;
      sub.suspendedReason = reason;
    } else if (newStatus === "active") {
      sub.suspendedAt = null;
      sub.suspendedReason = null;
      sub.gracePeriodEnd = null;
    } else if (newStatus === "past_due") {
      // 7-day grace period
      const grace = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      sub.gracePeriodEnd = grace.toISOString();
    } else if (newStatus === "cancelled") {
      sub.cancelledAt = now;
    }

    const saved = SubscriptionRepository.save(sub);

    PlatformAuditLogRepository.record({
      action: "agency_subscription_status_updated",
      actorId: actorEmail,
      actorEmail,
      targetType: "agency",
      targetId: tenantId,
      tenantId,
      details: { previousStatus: prevStatus, newStatus, reason },
    });

    return saved;
  }

  /**
   * Attaches an add-on package to an agency subscription.
   */
  public static addAddon(
    tenantId: string,
    addonId: string,
    quantity = 1,
    actorEmail: string
  ): AgencySubscriptionRecord {
    const addon = ModuleCatalogService.getAddonById(addonId);
    if (!addon) {
      throw new NotFoundError("Pachetul add-on", addonId);
    }

    const sub = this.getByTenantId(tenantId);
    const existingIndex = sub.activeAddons.findIndex((a) => a.addonId === addonId);

    if (existingIndex >= 0) {
      sub.activeAddons[existingIndex].quantity += quantity;
    } else {
      sub.activeAddons.push({
        addonId,
        quantity,
        activatedAt: new Date().toISOString(),
      });
    }

    const saved = SubscriptionRepository.save(sub);

    PlatformAuditLogRepository.record({
      action: "agency_addon_added",
      actorId: actorEmail,
      actorEmail,
      targetType: "agency",
      targetId: tenantId,
      tenantId,
      details: { addonId, quantity, addonName: addon.name },
    });

    return saved;
  }

  /**
   * Removes an add-on package from an agency subscription.
   */
  public static removeAddon(tenantId: string, addonId: string, actorEmail: string): AgencySubscriptionRecord {
    const sub = this.getByTenantId(tenantId);
    sub.activeAddons = sub.activeAddons.filter((a) => a.addonId !== addonId);

    const saved = SubscriptionRepository.save(sub);

    PlatformAuditLogRepository.record({
      action: "agency_addon_removed",
      actorId: actorEmail,
      actorEmail,
      targetType: "agency",
      targetId: tenantId,
      tenantId,
      details: { addonId },
    });

    return saved;
  }
}
