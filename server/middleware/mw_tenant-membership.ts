import { Request, Response, NextFunction } from "express";
import { TenantMembershipService } from "../../src/core/tenancy/svc_tenant-membership";
import { TenantResolutionService } from "../../src/core/tenancy/svc_tenant-resolution";
import { TenantMembershipRecord } from "../../src/core/tenancy/typ_tenant-context";
import { createErrorResponse } from "../../src/core/api/api_response";
import { AppError, UnauthorizedError, ForbiddenError } from "../../src/core/errors/app_error";

declare global {
  namespace Express {
    interface Request {
      membership?: TenantMembershipRecord;
    }
  }
}

/**
 * Tenant membership middleware:
 * Verifies that the authenticated user has an active, valid membership in the resolved tenant
 * using O(1) Firestore lookup (/tenants/{tenantId}/users/{uid} -> /tenants/{tenantId}/invites/{email})
 * and auto-binds verified Firebase UIDs on first sign-in so Firestore rules match immediately.
 */
export async function mwTenantMembership(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (req.isPreviewSession && req.membership) {
    return next();
  }

  if (!req.authUser) {
    const err = new UnauthorizedError("Autentificare necesară.");
    res.status(err.statusCode).json(createErrorResponse(err.code, err.message));
    return;
  }

  if (!req.resolvedTenant) {
    const err = new ForbiddenError("Cererea nu este asociată unei agenții valide.");
    res.status(err.statusCode).json(createErrorResponse(err.code, err.message));
    return;
  }

  try {
    const membership = await TenantMembershipService.verifyMembershipAsync(
      req.resolvedTenant.id,
      req.authUser.uid,
      req.authUser.email,
      req.authUser.emailVerified
    );
    const latestTenant =
      TenantResolutionService.getTenantById(req.resolvedTenant.id) || req.resolvedTenant;
    TenantMembershipService.verifyAuthVersion(membership, latestTenant, req.authUser.claims);
    req.resolvedTenant = latestTenant;
    req.membership = membership;
    next();
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json(createErrorResponse(error.code, error.message));
      return;
    }
    res
      .status(403)
      .json(createErrorResponse("FORBIDDEN", "Acces refuzat: calitatea de membru nu a putut fi verificată."));
  }
}
