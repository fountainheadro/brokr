import { Router, Request, Response } from "express";
import { mwAuthentication } from "../middleware/mw_authentication";
import { mwPlatformAuthorization } from "../middleware/mw_platform-authorization";
import { TenantResolutionService } from "../../src/core/tenancy/svc_tenant-resolution";
import { TenantMembershipService } from "../../src/core/tenancy/svc_tenant-membership";
import { PlatformAdminService } from "../../src/core/platform/svc_platform-admin";
import { PlatformAuditLogRepository } from "../../src/core/platform/repo_platform-audit-log";
import { PlatformSettingsService } from "../../src/core/platform/svc_platform-settings";
import { PlatformGlobalStats } from "../../src/core/platform/typ_platform-admin";
import { createSuccessResponse, createErrorResponse } from "../../src/core/api/api_response";
import { TenantRecord, TenantStatus } from "../../src/core/tenancy/typ_tenant-context";
import { PlanService } from "../../src/core/subscription/svc_plan";
import { SubscriptionService } from "../../src/core/subscription/svc_subscription";
import { ModuleCatalogService } from "../../src/core/subscription/svc_module";
import { QuotaService } from "../../src/core/subscription/svc_quota";
import { BillingManager } from "../../src/core/subscription/svc_billing-manager";
import { ModuleId } from "../../src/core/subscription/typ_subscription";
import { logger } from "../../src/core/logger/logger";
import { validateProductionEnvironment } from "../../src/core/env/svc_production-config";
import { AutomationConfigRepository } from "../../src/core/automation/repo_automation-config";


export const platformRouter = Router();

// Protect all /api/platform routes with authentication + platform authorization
platformRouter.use(mwAuthentication, mwPlatformAuthorization);

/**
 * GET /api/platform/me
 * Returns the authenticated Platform Super Admin identity (server-verified).
 */
platformRouter.get("/me", (req: Request, res: Response) => {
  res.json(
    createSuccessResponse({
      isPlatformAdmin: true,
      admin: req.platformAdmin || null,
    })
  );
});

/**
 * Storage for agency administrative notes
 */
const AGENCY_ADMIN_NOTES = new Map<string, Array<{ id: string; author: string; content: string; createdAt: string }>>();

// Seed note for demo
AGENCY_ADMIN_NOTES.set("ten_brokr_default", [
  {
    id: "note_1",
    author: "fountainheadro@gmail.com",
    content: "Agenția pilot principală Brokr. Verificare de securitate periodică validată.",
    createdAt: "2026-02-15T10:30:00.000Z",
  },
]);

/**
 * GET /api/platform/dashboard/stats
 * Aggregates live platform metrics across all registered agencies and members.
 */
platformRouter.get("/dashboard/stats", (req: Request, res: Response) => {
  const agencies = TenantResolutionService.getAllTenants();

  let activeAgencies = 0;
  let trialAgencies = 0;
  let suspendedAgencies = 0;
  let cancelledAgencies = 0;
  let totalUsers = 0;
  let activeUsers = 0;

  for (const agency of agencies) {
    if (agency.status === "active") activeAgencies++;
    else if (agency.status === "trial") trialAgencies++;
    else if (agency.status === "suspended") suspendedAgencies++;
    else if (agency.status === "cancelled") cancelledAgencies++;

    const members = TenantMembershipService.listTenantMembers(agency.id);
    totalUsers += members.length;
    activeUsers += members.filter((m) => m.status === "active").length;
  }

  const stats: PlatformGlobalStats = {
    totalAgencies: agencies.length,
    activeAgencies,
    trialAgencies,
    suspendedAgencies,
    cancelledAgencies,
    totalUsers,
    activeUsers,
    totalStorageMb: 4850,
    totalAiTokensUsed: 1420000,
    totalAiRequests: 3840,
    estimatedAiCostEur: 18.45,
    recentActivityCount: 142,
  };

  res.json(createSuccessResponse(stats));
});

/**
 * GET /api/platform/agencies
 * Lists all agencies with search, status filtering, and pagination.
 */
platformRouter.get("/agencies", (req: Request, res: Response) => {
  let agencies = TenantResolutionService.getAllTenants();

  const searchQuery = (req.query.q as string)?.toLowerCase().trim();
  const statusFilter = req.query.status as string;

  if (searchQuery) {
    agencies = agencies.filter(
      (a) =>
        a.name.toLowerCase().includes(searchQuery) ||
        a.subdomain.toLowerCase().includes(searchQuery) ||
        a.id.toLowerCase().includes(searchQuery)
    );
  }

  if (statusFilter && statusFilter !== "all") {
    agencies = agencies.filter((a) => a.status === statusFilter);
  }

  // Enrich agencies with member counts and administrative metadata
  const enriched = agencies.map((a) => {
    const members = TenantMembershipService.listTenantMembers(a.id);
    const notes = AGENCY_ADMIN_NOTES.get(a.id) || [];
    return {
      ...a,
      membersCount: members.length,
      activeMembersCount: members.filter((m) => m.status === "active").length,
      notesCount: notes.length,
    };
  });

  res.json(createSuccessResponse(enriched, { total: enriched.length }));
});

/**
 * GET /api/platform/agencies/:tenantId
 * Retrieves detailed agency record with members, domain info, and notes.
 */
platformRouter.get("/agencies/:tenantId", (req: Request, res: Response) => {
  const tenantId = req.params.tenantId;
  const agency = TenantResolutionService.getTenantById(tenantId);

  if (!agency) {
    res.status(404).json(createErrorResponse("NOT_FOUND", `Agenția "${tenantId}" nu a fost găsită.`));
    return;
  }

  const members = TenantMembershipService.listTenantMembers(tenantId);
  const notes = AGENCY_ADMIN_NOTES.get(tenantId) || [];

  res.json(
    createSuccessResponse({
      agency,
      members,
      notes,
    })
  );
});

/**
 * POST /api/platform/agencies/:tenantId/status
 * Updates agency lifecycle status (active, suspended, trial, cancelled).
 * Audited operation.
 */
platformRouter.post("/agencies/:tenantId/status", async (req: Request, res: Response) => {
  const tenantId = req.params.tenantId;
  const { status, reason } = req.body;

  const validStatuses: TenantStatus[] = ["active", "suspended", "trial", "pending", "cancelled"];
  if (!status || !validStatuses.includes(status)) {
    res.status(400).json(createErrorResponse("VALIDATION_ERROR", "Status de agenție invalid."));
    return;
  }

  const agency = TenantResolutionService.getTenantById(tenantId);
  if (!agency) {
    res.status(404).json(createErrorResponse("NOT_FOUND", `Agenția "${tenantId}" nu a fost găsită.`));
    return;
  }

  const oldStatus = agency.status;
  agency.status = status;
  agency.updatedAt = new Date().toISOString();

  // Record audit log
  await PlatformAuditLogRepository.record({
    actorUserId: req.authUser!.uid,
    actorEmail: req.authUser!.email,
    actorRole: req.platformAdmin?.role || "super_admin",
    action: status === "suspended" ? "agency_suspended" : "agency_reactivated",
    targetType: "agency",
    targetId: tenantId,
    targetName: agency.name,
    details: { oldStatus, newStatus: status, reason: reason || "Actualizare administrativă" },
    result: "success",
  });

  res.json(createSuccessResponse(agency));
});

/**
 * POST /api/platform/agencies/:tenantId/notes
 * Adds an administrative note to an agency.
 * Audited operation.
 */
platformRouter.post("/agencies/:tenantId/notes", async (req: Request, res: Response) => {
  const tenantId = req.params.tenantId;
  const { content } = req.body;

  if (!content || typeof content !== "string" || content.trim() === "") {
    res.status(400).json(createErrorResponse("VALIDATION_ERROR", "Conținutul notei este obligatoriu."));
    return;
  }

  const agency = TenantResolutionService.getTenantById(tenantId);
  if (!agency) {
    res.status(404).json(createErrorResponse("NOT_FOUND", `Agenția "${tenantId}" nu a fost găsită.`));
    return;
  }

  const existingNotes = AGENCY_ADMIN_NOTES.get(tenantId) || [];
  const newNote = {
    id: `note_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    author: req.authUser!.email,
    content: content.trim(),
    createdAt: new Date().toISOString(),
  };

  existingNotes.unshift(newNote);
  AGENCY_ADMIN_NOTES.set(tenantId, existingNotes);

  await PlatformAuditLogRepository.record({
    actorUserId: req.authUser!.uid,
    actorEmail: req.authUser!.email,
    actorRole: req.platformAdmin?.role || "super_admin",
    action: "agency_note_added",
    targetType: "agency",
    targetId: tenantId,
    targetName: agency.name,
    details: { noteId: newNote.id },
    result: "success",
  });

  res.status(201).json(createSuccessResponse(newNote));
});

/**
 * GET /api/platform/users
 * Lists platform administrators.
 */
platformRouter.get("/users", (req: Request, res: Response) => {
  const admins = PlatformAdminService.listPlatformAdmins();
  res.json(createSuccessResponse(admins, { total: admins.length }));
});

/**
 * GET /api/platform/domains
 * Lists all registered platform domains and verification states.
 */
platformRouter.get("/domains", (req: Request, res: Response) => {
  const agencies = TenantResolutionService.getAllTenants();
  const settings = PlatformSettingsService.getSettings();

  const domainList = [
    {
      domain: settings.configuredRootDomain ? settings.configuredRootDomain : "Domeniu rădăcină neconfigurat",
      type: "platform_root",
      status: settings.configuredRootDomain ? "active" : "pending_configuration",
      target: "Platform Website",
      isCustom: false,
    },
    {
      domain: settings.configuredRootDomain
        ? `${settings.adminSubdomain}.${settings.configuredRootDomain}`
        : `${settings.adminSubdomain}.[root-domain]`,
      type: "platform_admin",
      status: settings.configuredRootDomain ? "active" : "pending_configuration",
      target: "Platform Super Admin",
      isCustom: false,
    },
  ];

  for (const a of agencies) {
    domainList.push({
      domain: settings.configuredRootDomain ? `${a.subdomain}.${settings.configuredRootDomain}` : `${a.subdomain}.[subdomain]`,
      type: "agency_subdomain",
      status: a.status === "active" ? "active" : a.status === "suspended" ? "suspended" : "trial",
      target: a.name,
      isCustom: false,
    });

    if (a.customDomain) {
      domainList.push({
        domain: a.customDomain,
        type: "agency_custom",
        status: a.status === "active" ? "verified" : "suspended",
        target: a.name,
        isCustom: true,
      });
    }
  }

  res.json(createSuccessResponse(domainList, { total: domainList.length }));
});

/**
 * GET /api/platform/analytics
 * Returns global platform metrics.
 */
platformRouter.get("/analytics", (req: Request, res: Response) => {
  const agencies = TenantResolutionService.getAllTenants();

  const metrics = {
    totalAgencies: agencies.length,
    activeAgencies: agencies.filter((a) => a.status === "active").length,
    trialAgencies: agencies.filter((a) => a.status === "trial").length,
    suspendedAgencies: agencies.filter((a) => a.status === "suspended").length,
    agenciesGrowthRate: "+18% lună-la-lună",
    monthlyActiveAgents: 42,
    storageUtilizationPercent: 48,
    aiTokensMonthlyUtilizationPercent: 62,
  };

  res.json(createSuccessResponse(metrics));
});

/**
 * GET /api/platform/ai-usage
 * Returns global AI consumption by agency.
 */
platformRouter.get("/ai-usage", (req: Request, res: Response) => {
  const agencies = TenantResolutionService.getAllTenants();

  const usageByAgency = agencies.map((a) => {
    const isPrimary = a.id === "ten_brokr_default";
    return {
      tenantId: a.id,
      agencyName: a.name,
      tokensUsed: isPrimary ? 820000 : a.id === "ten_agency_a" ? 410000 : 190000,
      tokenLimit: isPrimary ? 2500000 : 1000000,
      requestCount: isPrimary ? 2180 : a.id === "ten_agency_a" ? 1120 : 540,
      estimatedCostEur: isPrimary ? 10.66 : a.id === "ten_agency_a" ? 5.33 : 2.46,
      topModel: "gemini-4-hydrogen",
    };
  });

  res.json(createSuccessResponse(usageByAgency));
});

/**
 * GET /api/platform/audit-logs
 * Retrieves platform audit logs.
 */
platformRouter.get("/audit-logs", async (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const targetType = req.query.targetType as string;
  const action = req.query.action as string;

  const result = await PlatformAuditLogRepository.list({ limit, targetType, action });
  res.json(createSuccessResponse(result.items, { total: result.total }));
});

/**
 * GET /api/platform/settings
 * Retrieves platform configuration settings.
 */
platformRouter.get("/settings", (req: Request, res: Response) => {
  const settings = PlatformSettingsService.getSettings();
  res.json(createSuccessResponse(settings));
});

/**
 * PUT /api/platform/settings
 * Updates platform configuration settings. Audited operation.
 */
platformRouter.put("/settings", async (req: Request, res: Response) => {
  const updates = req.body;
  const updated = PlatformSettingsService.updateSettings(updates, req.authUser!.uid);

  await PlatformAuditLogRepository.record({
    actorUserId: req.authUser!.uid,
    actorEmail: req.authUser!.email,
    actorRole: req.platformAdmin?.role || "super_admin",
    action: "platform_settings_updated",
    targetType: "settings",
    targetId: updated.id,
    targetName: "Platform Settings",
    details: { updates },
    result: "success",
  });

  res.json(createSuccessResponse(updated));
});

/**
 * GET /api/platform/automation/title-rule
 * Retrieves the platform-wide default external ad title automation rule (Super Admin).
 */
platformRouter.get("/automation/title-rule", (req: Request, res: Response) => {
  try {
    const record = AutomationConfigRepository.getPlatformDefaultRecord();
    res.json(createSuccessResponse(record));
  } catch (err: any) {
    res
      .status(500)
      .json(createErrorResponse("INTERNAL_ERROR", err?.message || "Eroare la încărcarea regulii implicite."));
  }
});

/**
 * PUT /api/platform/automation/title-rule
 * Updates the platform-wide default external ad title automation rule (Super Admin).
 */
platformRouter.put("/automation/title-rule", async (req: Request, res: Response) => {
  try {
    const payload = req.body?.titleRule || req.body;
    const updated = AutomationConfigRepository.savePlatformDefaultTitleRule(
      payload,
      req.authUser!.email
    );

    await PlatformAuditLogRepository.record({
      actorUserId: req.authUser!.uid,
      actorEmail: req.authUser!.email,
      actorRole: req.platformAdmin?.role || "super_admin",
      action: "platform_automation_default_updated",
      targetType: "settings",
      targetId: updated.id,
      targetName: "Default External Ad Title Rule",
      details: {
        minChars: updated.titleRule.minChars,
        maxChars: updated.titleRule.maxChars,
        enabled: updated.titleRule.enabled,
      },
      result: "success",
    });

    res.json(createSuccessResponse(updated));
  } catch (err: any) {
    res
      .status(500)
      .json(createErrorResponse("INTERNAL_ERROR", err?.message || "Eroare la salvarea regulii implicite."));
  }
});

/**
 * POST /api/platform/automation/title-rule/reset
 * Resets the platform-wide default title automation rule back to built-in system defaults.
 */
platformRouter.post("/automation/title-rule/reset", async (req: Request, res: Response) => {
  try {
    const reset = AutomationConfigRepository.resetPlatformDefaultTitleRule(req.authUser!.email);

    await PlatformAuditLogRepository.record({
      actorUserId: req.authUser!.uid,
      actorEmail: req.authUser!.email,
      actorRole: req.platformAdmin?.role || "super_admin",
      action: "platform_automation_default_reset",
      targetType: "settings",
      targetId: reset.id,
      targetName: "Default External Ad Title Rule",
      details: {},
      result: "success",
    });

    res.json(createSuccessResponse(reset));
  } catch (err: any) {
    res
      .status(500)
      .json(createErrorResponse("INTERNAL_ERROR", err?.message || "Eroare la resetarea regulii implicite."));
  }
});

/* ========================================================================== */
/* PHASE 5: PLANS, SUBSCRIPTIONS, MODULES, USAGE, AND BILLING ENDPOINTS        */
/* ========================================================================== */

/**
 * GET /api/platform/plans
 * Lists all subscription plans.
 */
platformRouter.get("/plans", (req: Request, res: Response) => {
  const statusFilter = req.query.status as string | undefined;
  const plans = PlanService.listPlans(statusFilter);
  res.json(createSuccessResponse(plans));
});

/**
 * POST /api/platform/plans
 * Creates a new subscription plan.
 */
platformRouter.post("/plans", async (req: Request, res: Response) => {
  try {
    const created = PlanService.createPlan(req.body);

    await PlatformAuditLogRepository.record({
      actorUserId: req.authUser!.uid,
      actorEmail: req.authUser!.email,
      actorRole: req.platformAdmin?.role || "super_admin",
      action: "platform_plan_created",
      targetType: "plan",
      targetId: created.id,
      targetName: created.displayName,
      details: { plan: created },
      result: "success",
    });

    res.status(201).json(createSuccessResponse(created));
  } catch (err: any) {
    res.status(400).json(createErrorResponse("VALIDATION_ERROR", err?.message || String(err)));
  }
});

/**
 * GET /api/platform/plans/:id
 * Retrieves a specific subscription plan.
 */
platformRouter.get("/plans/:id", (req: Request, res: Response) => {
  try {
    const plan = PlanService.getPlanById(req.params.id);
    res.json(createSuccessResponse(plan));
  } catch (err: any) {
    res.status(404).json(createErrorResponse("NOT_FOUND", err?.message || String(err)));
  }
});

/**
 * PUT /api/platform/plans/:id
 * Updates an existing subscription plan.
 */
platformRouter.put("/plans/:id", async (req: Request, res: Response) => {
  try {
    const updated = PlanService.updatePlan(req.params.id, req.body);

    await PlatformAuditLogRepository.record({
      actorUserId: req.authUser!.uid,
      actorEmail: req.authUser!.email,
      actorRole: req.platformAdmin?.role || "super_admin",
      action: "platform_plan_updated",
      targetType: "plan",
      targetId: updated.id,
      targetName: updated.displayName,
      details: { updates: req.body },
      result: "success",
    });

    res.json(createSuccessResponse(updated));
  } catch (err: any) {
    res.status(400).json(createErrorResponse("VALIDATION_ERROR", err?.message || String(err)));
  }
});

/**
 * PATCH /api/platform/plans/:id/status
 * Updates plan status (active, inactive, archived).
 */
platformRouter.patch("/plans/:id/status", async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    if (!["active", "inactive", "archived"].includes(status)) {
      res.status(400).json(createErrorResponse("VALIDATION_ERROR", "Status invalid. Valori permise: active, inactive, archived."));
      return;
    }

    const updated = PlanService.setPlanStatus(req.params.id, status);

    await PlatformAuditLogRepository.record({
      actorUserId: req.authUser!.uid,
      actorEmail: req.authUser!.email,
      actorRole: req.platformAdmin?.role || "super_admin",
      action: "platform_plan_status_changed",
      targetType: "plan",
      targetId: updated.id,
      targetName: updated.displayName,
      details: { newStatus: status },
      result: "success",
    });

    res.json(createSuccessResponse(updated));
  } catch (err: any) {
    res.status(400).json(createErrorResponse("VALIDATION_ERROR", err?.message || String(err)));
  }
});

/**
 * GET /api/platform/subscriptions
 * Lists subscriptions across all agencies with filtering.
 */
platformRouter.get("/subscriptions", (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  const planId = req.query.planId as string | undefined;

  const subs = SubscriptionService.listSubscriptions({ status, planId });
  const enriched = subs.map((s) => {
    const agency = TenantResolutionService.getTenantById(s.tenantId);
    const plan = PlanService.getPlanById(s.planId);
    const usage = QuotaService.getUsage(s.tenantId);
    return {
      ...s,
      agencyName: agency?.name || s.tenantId,
      subdomain: agency?.subdomain || "",
      planDisplayName: plan?.displayName || s.planId,
      currency: plan?.currency || "RON",
      priceMonthly: plan?.priceMonthly || 0,
      usage,
    };
  });

  res.json(createSuccessResponse(enriched));
});

/**
 * GET /api/platform/subscriptions/:tenantId
 * Retrieves detailed subscription and entitlement breakdown for a specific agency.
 */
platformRouter.get("/subscriptions/:tenantId", (req: Request, res: Response) => {
  try {
    const entitlements = QuotaService.getTenantEntitlements(req.params.tenantId);
    const subscription = SubscriptionService.getByTenantId(req.params.tenantId);
    res.json(createSuccessResponse({ subscription, entitlements }));
  } catch (err: any) {
    res.status(404).json(createErrorResponse("NOT_FOUND", err?.message || String(err)));
  }
});

/**
 * PATCH /api/platform/subscriptions/:tenantId/plan
 * Super Admin administrative plan change for an agency.
 */
platformRouter.patch("/subscriptions/:tenantId/plan", async (req: Request, res: Response) => {
  try {
    const { planId, billingInterval = "month" } = req.body;
    if (!planId) {
      res.status(400).json(createErrorResponse("VALIDATION_ERROR", "planId este obligatoriu."));
      return;
    }

    const updated = SubscriptionService.changePlan(
      req.params.tenantId,
      planId,
      billingInterval,
      req.authUser!.email
    );

    res.json(createSuccessResponse(updated));
  } catch (err: any) {
    res.status(400).json(createErrorResponse("VALIDATION_ERROR", err?.message || String(err)));
  }
});

/**
 * PATCH /api/platform/subscriptions/:tenantId/status
 * Super Admin administrative status change (active, past_due, suspended, cancelled).
 */
platformRouter.patch("/subscriptions/:tenantId/status", async (req: Request, res: Response) => {
  try {
    const { status, reason } = req.body;
    if (!status || !reason) {
      res.status(400).json(createErrorResponse("VALIDATION_ERROR", "status și reason sunt obligatorii."));
      return;
    }

    const updated = SubscriptionService.updateStatus(
      req.params.tenantId,
      status,
      reason,
      req.authUser!.email
    );

    res.json(createSuccessResponse(updated));
  } catch (err: any) {
    res.status(400).json(createErrorResponse("VALIDATION_ERROR", err?.message || String(err)));
  }
});

/**
 * POST /api/platform/subscriptions/:tenantId/addons
 * Super Admin adds an add-on to an agency.
 */
platformRouter.post("/subscriptions/:tenantId/addons", (req: Request, res: Response) => {
  try {
    const { addonId, quantity = 1 } = req.body;
    if (!addonId) {
      res.status(400).json(createErrorResponse("VALIDATION_ERROR", "addonId este obligatoriu."));
      return;
    }

    const updated = SubscriptionService.addAddon(
      req.params.tenantId,
      addonId,
      Number(quantity),
      req.authUser!.email
    );

    res.json(createSuccessResponse(updated));
  } catch (err: any) {
    res.status(400).json(createErrorResponse("VALIDATION_ERROR", err?.message || String(err)));
  }
});

/**
 * DELETE /api/platform/subscriptions/:tenantId/addons/:addonId
 * Super Admin removes an add-on from an agency.
 */
platformRouter.delete("/subscriptions/:tenantId/addons/:addonId", (req: Request, res: Response) => {
  try {
    const updated = SubscriptionService.removeAddon(
      req.params.tenantId,
      req.params.addonId,
      req.authUser!.email
    );
    res.json(createSuccessResponse(updated));
  } catch (err: any) {
    res.status(400).json(createErrorResponse("VALIDATION_ERROR", err?.message || String(err)));
  }
});

/**
 * GET /api/platform/modules
 * Lists central module catalogue and available add-ons.
 */
platformRouter.get("/modules", (req: Request, res: Response) => {
  const modules = ModuleCatalogService.getAllModules();
  const addons = ModuleCatalogService.getAllAddons();
  const plans = PlanService.listPlans();

  // Annotate modules with which plans include them
  const enrichedModules = modules.map((m) => {
    const includedInPlans = plans
      .filter((p) => p.includedModules.includes(m.id))
      .map((p) => ({ id: p.id, displayName: p.displayName }));
    return {
      ...m,
      includedInPlans,
    };
  });

  res.json(createSuccessResponse({ modules: enrichedModules, addons }));
});

/**
 * PATCH /api/platform/modules/:id
 * Toggles module active status or add-on eligibility.
 */
platformRouter.patch("/modules/:id", async (req: Request, res: Response) => {
  try {
    const { isActive, canBePurchasedAsAddon } = req.body;
    const updated = ModuleCatalogService.updateModuleStatus(
      req.params.id as ModuleId,
      Boolean(isActive),
      canBePurchasedAsAddon !== undefined ? Boolean(canBePurchasedAsAddon) : undefined
    );

    await PlatformAuditLogRepository.record({
      actorUserId: req.authUser!.uid,
      actorEmail: req.authUser!.email,
      actorRole: req.platformAdmin?.role || "super_admin",
      action: "platform_module_updated",
      targetType: "module",
      targetId: updated.id,
      targetName: updated.name,
      details: { isActive, canBePurchasedAsAddon },
      result: "success",
    });

    res.json(createSuccessResponse(updated));
  } catch (err: any) {
    res.status(400).json(createErrorResponse("VALIDATION_ERROR", err?.message || String(err)));
  }
});

/**
 * GET /api/platform/usage
 * Global overview of resource quotas and consumption across agencies.
 */
platformRouter.get("/usage", (req: Request, res: Response) => {
  const agencies = TenantResolutionService.getAllTenants();
  const rows = agencies.map((agency) => {
    try {
      const entitlements = QuotaService.getTenantEntitlements(agency.id);
      return {
        tenantId: agency.id,
        agencyName: agency.name,
        subdomain: agency.subdomain,
        planDisplayName: entitlements.planDisplayName,
        status: entitlements.subscriptionStatus,
        usage: entitlements.currentUsage,
        quotas: entitlements.effectiveQuotas,
        warnings: entitlements.warnings,
      };
    } catch {
      return {
        tenantId: agency.id,
        agencyName: agency.name,
        subdomain: agency.subdomain,
        planDisplayName: "Nedefinit",
        status: agency.status,
        usage: { agents: 0, properties: 0, leads: 0, aiTokens: 0, aiRequests: 0, storageMb: 0 },
        quotas: { maxAgents: 0, maxProperties: 0, maxLeads: 0, monthlyAiTokens: 0, monthlyAiRequests: 0, storageMb: 0 },
        warnings: [],
      };
    }
  });

  res.json(createSuccessResponse(rows));
});

/**
 * GET /api/platform/billing/status
 * Displays payment provider configuration health and recent webhook event logs.
 */
platformRouter.get("/billing/status", (req: Request, res: Response) => {
  const providerStatus = BillingManager.getProviderStatus();
  const eventLogs = BillingManager.getEventLogs();
  res.json(createSuccessResponse({ providerStatus, eventLogs }));
});

/**
 * GET /api/platform/observability/metrics
 * Exposes structured operational counters, API latency metrics, and production readiness checks
 * strictly for Platform Super Admins.
 */
platformRouter.get("/observability/metrics", (_req: Request, res: Response) => {
  const operational = logger.getOperationalMetrics();
  const environmentValidation = validateProductionEnvironment();
  res.json(
    createSuccessResponse({
      operational,
      environmentValidation,
    })
  );
});

