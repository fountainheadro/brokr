import { Request, Response, NextFunction } from "express";
import { TenantMembershipService } from "../../src/core/tenancy/svc_tenant-membership";
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
 * Verifies that the authenticated user has an active, valid membership in the resolved tenant.
 * Rejects suspended users, users accessing another tenant's agency, and suspended tenants.
 */
export function mwTenantMembership(req: Request, res: Response, next: NextFunction): void {
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
    const membership = TenantMembershipService.verifyMembership(
      req.resolvedTenant.id,
      req.authUser.uid,
      req.authUser.email,
      req.authUser.emailVerified
    );
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
