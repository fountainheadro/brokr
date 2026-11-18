import { Request, Response, NextFunction } from "express";
import { TenantContext } from "../../src/core/tenancy/typ_tenant-context";
import { mwAuthentication } from "./mw_authentication";
import { mwTenantResolution } from "./mw_tenant-resolution";
import { mwTenantMembership } from "./mw_tenant-membership";
import { createErrorResponse } from "../../src/core/api/api_response";

declare global {
  namespace Express {
    interface Request {
      tenantContext?: TenantContext;
    }
  }
}

/**
 * Tenant context constructor middleware:
 * Assembles a trusted, verified TenantContext object on the request.
 */
export function mwTenantContext(req: Request, res: Response, next: NextFunction): void {
  if (req.isPreviewSession && req.tenantContext) {
    return next();
  }

  if (!req.resolvedTenant || !req.authUser || !req.membership) {
    res
      .status(403)
      .json(createErrorResponse("FORBIDDEN", "Contextul de securitate al agenției nu a putut fi construit."));
    return;
  }

  req.tenantContext = {
    tenantId: req.resolvedTenant.id,
    tenantStatus: req.resolvedTenant.status,
    tenantName: req.resolvedTenant.name,
    tenantDomain: req.resolvedTenant.subdomain,
    userId: req.authUser.uid,
    userEmail: req.authUser.email,
    membershipId: req.membership.id,
    membershipStatus: req.membership.status,
    role: req.membership.role,
    permissions: req.membership.permissions,
  };

  next();
}

/**
 * Unified middleware pipeline for tenant-protected endpoints:
 * 1. Authenticates Firebase user
 * 2. Resolves hostname to tenant
 * 3. Verifies active membership in tenant
 * 4. Constructs trusted TenantContext
 */
import { mwPreviewInterception } from "./mw_preview-authorization";

export const requireTenantContext = [
  mwPreviewInterception,
  mwAuthentication,
  mwTenantResolution,
  mwTenantMembership,
  mwTenantContext,
];
