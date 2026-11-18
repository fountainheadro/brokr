import { Router, Request, Response } from "express";
import { requireTenantContext } from "../middleware/mw_tenant-context";
import { requireRole } from "../middleware/mw_authorization";
import { TenantResolutionService } from "../../src/core/tenancy/svc_tenant-resolution";
import { TenantMembershipService } from "../../src/core/tenancy/svc_tenant-membership";
import { TenantScopedRepository, TenantScopedEntity } from "../../src/core/database/repo_tenant-scoped";
import { createSuccessResponse, createErrorResponse } from "../../src/core/api/api_response";
import { updateMembershipRoleValidator, updateMembershipStatusValidator } from "../../src/core/tenancy/sch_tenant-membership";
import { AppError } from "../../src/core/errors/app_error";
import { requireModule, requireQuota } from "../middleware/mw_entitlement";
import { QuotaService } from "../../src/core/subscription/svc_quota";
import { BillingManager } from "../../src/core/subscription/svc_billing-manager";
import { PlanService } from "../../src/core/subscription/svc_plan";


export const tenantRouter = Router();

export interface SampleLeadEntity extends TenantScopedEntity {
  title: string;
  price?: string;
  zone?: string;
  status: string;
  url?: string;
}

// In-memory / Firestore repository instance for tenant leads
const leadsRepo = new TenantScopedRepository<SampleLeadEntity>(null, "leads");

/**
 * Public endpoint to resolve public tenant branding for the requesting domain.
 * Does not expose private keys or sensitive tenant information.
 */
tenantRouter.get("/resolve", (req: Request, res: Response) => {
  try {
    const rawHost =
      (req.headers["x-forwarded-host"] as string) ||
      (req.headers.host as string) ||
      req.hostname ||
      "";

    const devOverride =
      (req.headers["x-tenant-override"] as string) ||
      (req.query.simulate_tenant as string) ||
      null;

    const resolved = TenantResolutionService.resolveDomain(
      rawHost,
      devOverride,
      process.env.NODE_ENV === "production"
    );

    if (resolved.type === "agency_crm" && resolved.tenantId) {
      const tenant = TenantResolutionService.getTenantById(resolved.tenantId);
      if (tenant) {
        res.json(
          createSuccessResponse({
            tenantId: tenant.id,
            subdomain: tenant.subdomain,
            name: tenant.name,
            status: tenant.status,
            branding: tenant.branding,
            enabledModules: tenant.enabledModules,
          })
        );
        return;
      }
    }

    res.json(createSuccessResponse(resolved));
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json(createErrorResponse(error.code, error.message));
      return;
    }
    res
      .status(500)
      .json(createErrorResponse("INTERNAL_ERROR", "Eroare la rezolvarea domeniului agenției."));
  }
});

/**
 * Protected: Returns the verified TenantContext of the authenticated user.
 */
tenantRouter.get("/me", requireTenantContext, (req: Request, res: Response) => {
  res.json(createSuccessResponse(req.tenantContext!));
});

/**
 * Protected: Lists leads strictly scoped to the authenticated tenant.
 * Enforces: Tenant subscription must include the 'mod_leads' module.
 */
tenantRouter.get(
  "/leads",
  requireTenantContext,
  requireModule("mod_leads"),
  async (req: Request, res: Response) => {
    try {
      const tenantId = req.tenantContext!.tenantId;
      const result = await leadsRepo.list(tenantId);
      res.json(createSuccessResponse(result.items, { total: result.total, tenantId }));
    } catch (err: any) {
      res.status(500).json(createErrorResponse("INTERNAL_ERROR", err?.message || String(err)));
    }
  }
);

/**
 * Protected: Creates a lead strictly bound to the authenticated tenant.
 * Enforces:
 * 1. Tenant subscription must include 'mod_leads'.
 * 2. Tenant must not have exhausted their leads quota.
 * Any tenant_id passed in the body is explicitly ignored or overwritten.
 */
tenantRouter.post(
  "/leads",
  requireTenantContext,
  requireModule("mod_leads"),
  requireQuota("leads", 1),
  async (req: Request, res: Response) => {
    try {
      const tenantId = req.tenantContext!.tenantId;
      const userId = req.tenantContext!.userId;
      const { id, title, price, zone, status, url } = req.body;

      const leadId = id || `lead_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const created = await leadsRepo.create(
        tenantId,
        leadId,
        {
          title: title || "Proprietate nouă",
          price: price || "Nespecificat",
          zone: zone || "Zonă centrală",
          status: status || "Lead-uri",
          url: url || "",
        },
        userId
      );

      // Increment quota usage atomically
      QuotaService.consumeQuota(tenantId, "leads", 1);

      res.status(201).json(createSuccessResponse(created, { tenantId }));
    } catch (err: any) {
      res.status(500).json(createErrorResponse("INTERNAL_ERROR", err?.message || String(err)));
    }
  }
);

/**
 * Protected: Retrieves a single lead.
 * Enforces cross-tenant isolation: cannot retrieve a document belonging to another agency.
 */
tenantRouter.get("/leads/:id", requireTenantContext, async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantContext!.tenantId;
    const lead = await leadsRepo.findById(tenantId, req.params.id);
    if (!lead) {
      res.status(404).json(createErrorResponse("NOT_FOUND", "Lead-ul solicitat nu a fost găsit în agenție."));
      return;
    }
    res.json(createSuccessResponse(lead, { tenantId }));
  } catch (err: any) {
    res.status(500).json(createErrorResponse("INTERNAL_ERROR", err?.message || String(err)));
  }
});

/**
 * Protected: Updates role of a tenant member.
 * Enforces:
 * 1. User cannot modify their own role.
 * 2. Only agency_owner or agency_admin can modify roles.
 */
tenantRouter.post(
  "/members/:userId/role",
  requireTenantContext,
  requireRole(["agency_owner", "agency_admin"]),
  (req: Request, res: Response) => {
    try {
      const actor = req.membership!;
      const targetUserId = req.params.userId;
      const { newRole } = req.body;

      const validator = updateMembershipRoleValidator();
      const validation = validator.validate({ targetUserId, newRole });
      if (!validation.isValid) {
        res.status(400).json(createErrorResponse("VALIDATION_ERROR", "Date invalide", validation.errors));
        return;
      }

      const updated = TenantMembershipService.updateMemberRole(actor, targetUserId, newRole);
      res.json(createSuccessResponse(updated));
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json(createErrorResponse(error.code, error.message));
        return;
      }
      res.status(500).json(createErrorResponse("INTERNAL_ERROR", "Eroare la actualizarea rolului."));
    }
  }
);

/**
 * Protected: Updates status of a tenant member (e.g. suspend, revoke).
 * Enforces:
 * 1. User cannot modify their own status.
 * 2. Only agency_owner or agency_admin can modify member status.
 */
tenantRouter.post(
  "/members/:userId/status",
  requireTenantContext,
  requireRole(["agency_owner", "agency_admin"]),
  (req: Request, res: Response) => {
    try {
      const actor = req.membership!;
      const targetUserId = req.params.userId;
      const { newStatus } = req.body;

      const validator = updateMembershipStatusValidator();
      const validation = validator.validate({ targetUserId, newStatus });
      if (!validation.isValid) {
        res.status(400).json(createErrorResponse("VALIDATION_ERROR", "Date invalide", validation.errors));
        return;
      }

      const updated = TenantMembershipService.updateMemberStatus(actor, targetUserId, newStatus);
      res.json(createSuccessResponse(updated));
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json(createErrorResponse(error.code, error.message));
        return;
      }
      res.status(500).json(createErrorResponse("INTERNAL_ERROR", "Eroare la actualizarea statusului."));
    }
  }
);

/**
 * Protected: Retrieves the subscription and entitlement details strictly for the authenticated agency.
 * Cross-tenant access is architecturally impossible because tenantId is sourced from verified TenantContext.
 */
tenantRouter.get("/subscription", requireTenantContext, (req: Request, res: Response) => {
  try {
    const tenantId = req.tenantContext!.tenantId;
    const entitlements = QuotaService.getTenantEntitlements(tenantId);
    res.json(createSuccessResponse(entitlements));
  } catch (err: any) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json(createErrorResponse(err.code, err.message));
      return;
    }
    res.status(500).json(createErrorResponse("INTERNAL_ERROR", "Eroare la obținerea abonamentului agenției."));
  }
});

/**
 * Protected: Initiates a checkout session for upgrading or changing the agency subscription.
 * Restricted to agency_owner or agency_admin.
 */
tenantRouter.post(
  "/subscription/checkout",
  requireTenantContext,
  requireRole(["agency_owner", "agency_admin"]),
  async (req: Request, res: Response) => {
    try {
      const tenantContext = req.tenantContext!;
      const { planId, billingInterval = "month" } = req.body;

      if (!planId) {
        res.status(400).json(createErrorResponse("VALIDATION_ERROR", "ID-ul planului este obligatoriu."));
        return;
      }

      const plan = PlanService.getPlanById(planId);
      const amount = billingInterval === "year" ? plan.priceAnnual : plan.priceMonthly;

      const appOrigin = `${req.protocol}://${req.get("host") || "localhost:3000"}`;
      const successUrl = `${appOrigin}/agency/admin/subscription?session=success`;
      const cancelUrl = `${appOrigin}/agency/admin/subscription?session=cancelled`;

      const checkout = await BillingManager.createCheckoutSession({
        tenantId: tenantContext.tenantId,
        agencyName: tenantContext.tenantName,
        customerEmail: tenantContext.userEmail,
        planId: plan.id,
        planDisplayName: plan.displayName,
        amount,
        currency: plan.currency,
        billingInterval,
        successUrl,
        cancelUrl,
      });

      res.json(createSuccessResponse(checkout));
    } catch (err: any) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json(createErrorResponse(err.code, err.message));
        return;
      }
      res.status(500).json(createErrorResponse("INTERNAL_ERROR", err?.message || "Eroare la inițierea sesiunii de plată."));
    }
  }
);

/**
 * Protected: Generates a customer billing portal link.
 */
tenantRouter.post(
  "/subscription/portal",
  requireTenantContext,
  requireRole(["agency_owner", "agency_admin"]),
  async (req: Request, res: Response) => {
    try {
      const tenantContext = req.tenantContext!;
      const appOrigin = `${req.protocol}://${req.get("host") || "localhost:3000"}`;

      const portal = await BillingManager.createCustomerPortalSession({
        tenantId: tenantContext.tenantId,
        customerEmail: tenantContext.userEmail,
        returnUrl: `${appOrigin}/agency/admin/subscription`,
      });

      res.json(createSuccessResponse(portal));
    } catch (err: any) {
      res.status(500).json(createErrorResponse("INTERNAL_ERROR", err?.message || "Eroare la deschiderea portalului de facturare."));
    }
  }
);

