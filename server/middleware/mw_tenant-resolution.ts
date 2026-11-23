import { Request, Response, NextFunction } from "express";
import { TenantResolutionService } from "../../src/core/tenancy/svc_tenant-resolution";
import { ResolvedTenantDomain, TenantRecord } from "../../src/core/tenancy/typ_tenant-context";
import { createErrorResponse } from "../../src/core/api/api_response";
import { AppError } from "../../src/core/errors/app_error";

declare global {
  namespace Express {
    interface Request {
      resolvedDomain?: ResolvedTenantDomain;
      resolvedTenant?: TenantRecord;
    }
  }
}

/**
 * Tenant resolution middleware:
 * Determines the tenant strictly based on the request hostname and server-side domain mapping.
 * Never trusts frontend body or query tenant_id for identity.
 */
export async function mwTenantResolution(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rawHost =
      (req.headers["x-forwarded-host"] as string) ||
      (req.headers.host as string) ||
      req.hostname ||
      "";

    // In dev / preview environments, support header-based or query-based simulation override
    const devOverride =
      (req.headers["x-tenant-override"] as string) ||
      (req.query.simulate_tenant as string) ||
      null;

    const isProd = process.env.NODE_ENV === "production";
    let resolved: ResolvedTenantDomain;
    try {
      resolved = TenantResolutionService.resolveDomain(rawHost, devOverride, isProd);
    } catch (err) {
      if (err instanceof AppError && err.code === "TENANT_NOT_FOUND") {
        // Cold-start recovery: hydrate tenants list from Firestore once and retry domain lookup
        await TenantResolutionService.hydrateFromFirestore();
        resolved = TenantResolutionService.resolveDomain(rawHost, devOverride, isProd);
      } else {
        throw err;
      }
    }

    req.resolvedDomain = resolved;

    if (resolved.type === "agency_crm") {
      if (!resolved.tenantId) {
        res
          .status(404)
          .json(createErrorResponse("TENANT_NOT_FOUND", `Nu a fost găsită o agenție pentru domeniul "${rawHost}".`));
        return;
      }

      const tenant =
        (await TenantResolutionService.hydrateSingleTenantFromFirestore(resolved.tenantId)) ||
        TenantResolutionService.getTenantById(resolved.tenantId);

      if (!tenant) {
        res
          .status(404)
          .json(createErrorResponse("TENANT_NOT_FOUND", `Agenția "${resolved.tenantId}" nu a fost găsită.`));
        return;
      }

      req.resolvedTenant = tenant;
    }

    next();
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json(createErrorResponse(error.code, error.message));
      return;
    }
    res
      .status(500)
      .json(createErrorResponse("INTERNAL_ERROR", "Eroare la rezolvarea domeniului agenției."));
  }
}
