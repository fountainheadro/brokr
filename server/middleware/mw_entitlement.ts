import { Request, Response, NextFunction } from "express";
import { ModuleId, QuotaResourceType } from "../../src/core/subscription/typ_subscription";
import { QuotaService } from "../../src/core/subscription/svc_quota";
import { ModuleCatalogService } from "../../src/core/subscription/svc_module";
import { createErrorResponse } from "../../src/core/api/api_response";

/**
 * Middleware enforcing that the active tenant subscription includes the requested module.
 */
export function requireModule(moduleId: ModuleId) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const tenantContext = req.tenantContext;
    if (!tenantContext || !tenantContext.tenantId) {
      res.status(401).json(createErrorResponse("UNAUTHORIZED", "Context de agenție indisponibil pentru verificare modul."));
      return;
    }

    if (tenantContext.tenantStatus === "suspended" || tenantContext.tenantStatus === "cancelled") {
      res.status(403).json(createErrorResponse("TENANT_SUSPENDED", "Contul agenției este suspendat sau anulat."));
      return;
    }

    if (tenantContext.membershipStatus !== "active") {
      res.status(403).json(createErrorResponse("MEMBERSHIP_INACTIVE", "Accesul utilizatorului în această agenție nu este activ."));
      return;
    }

    const { modules } = QuotaService.getEffectiveQuotas(tenantContext.tenantId);
    if (!modules.includes(moduleId)) {
      const moduleDef = ModuleCatalogService.getModuleById(moduleId);
      const moduleName = moduleDef?.name || moduleId;

      res.status(403).json(
        createErrorResponse(
          "MODULE_DISABLED",
          `Modulul '${moduleName}' nu este inclus în abonamentul activ al agenției dumneavoastră.`,
          {
            moduleId,
            moduleName,
            upgradeUrl: "/agency/admin/subscription",
          }
        )
      );
      return;
    }

    next();
  };
}

/**
 * Middleware enforcing that the tenant has not exceeded their quota for a resource.
 */
export function requireQuota(resource: QuotaResourceType, requestedAmount = 1) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const tenantContext = req.tenantContext;
    if (!tenantContext || !tenantContext.tenantId) {
      res.status(401).json(createErrorResponse("UNAUTHORIZED", "Context de agenție indisponibil pentru verificare cote."));
      return;
    }

    if (tenantContext.tenantStatus === "suspended" || tenantContext.tenantStatus === "cancelled") {
      res.status(403).json(createErrorResponse("TENANT_SUSPENDED", "Contul agenției este suspendat sau anulat."));
      return;
    }

    if (tenantContext.membershipStatus !== "active") {
      res.status(403).json(createErrorResponse("MEMBERSHIP_INACTIVE", "Accesul utilizatorului în această agenție nu este activ."));
      return;
    }

    const check = QuotaService.checkQuota(tenantContext.tenantId, resource, requestedAmount);
    if (!check.allowed) {
      res.status(429).json(
        createErrorResponse(
          "QUOTA_EXCEEDED",
          check.reason || `Limita alocată pentru resursa '${resource}' a fost depășită.`,
          {
            resource,
            current: check.current,
            limit: check.limit,
            requested: requestedAmount,
            upgradeUrl: "/agency/admin/subscription",
          }
        )
      );
      return;
    }

    next();
  };
}
