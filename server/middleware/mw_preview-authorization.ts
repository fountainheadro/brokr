import { Request, Response, NextFunction } from "express";
import { PreviewSessionService } from "../../src/core/tenancy/svc_preview-session";
import { TenantResolutionService } from "../../src/core/tenancy/svc_tenant-resolution";
import { createErrorResponse } from "../../src/core/api/api_response";

declare global {
  namespace Express {
    interface Request {
      isPreviewSession?: boolean;
    }
  }
}

/**
 * Middleware that checks for an active Super Admin preview session token.
 * If present and valid, attaches the simulated TenantContext and simulated role
 * to the request, allowing safe manual testing of agencies and roles without modifying database records.
 */
export async function mwPreviewInterception(req: Request, res: Response, next: NextFunction): Promise<void> {
  const previewToken = (req.headers["x-preview-token"] as string) || null;

  if (!previewToken) {
    return next();
  }

  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PREVIEW_MODE_IN_PRODUCTION !== "true") {
    res
      .status(403)
      .json(createErrorResponse("FORBIDDEN", "Modul Agency Preview este dezactivat în mediul de producție."));
    return;
  }

  const session = await PreviewSessionService.getSessionAsync(previewToken);
  if (!session) {
    res
      .status(401)
      .json(createErrorResponse("UNAUTHORIZED", "Sesiunea de testare (preview) este invalidă sau a expirat."));
    return;
  }

  if (req.authUser && session.superAdminUid !== req.authUser.uid) {
    res
      .status(403)
      .json(createErrorResponse("FORBIDDEN", "Tokenul de preview nu aparține administratorului autentificat."));
    return;
  }

  const tenant = TenantResolutionService.getTenantById(session.tenantId);
  if (!tenant) {
    res.status(404).json(createErrorResponse("NOT_FOUND", "Agenția testată nu mai există în sistem."));
    return;
  }

  // Construct simulated TenantContext
  req.tenantContext = {
    tenantId: session.tenantId,
    tenantStatus: tenant.status,
    tenantName: session.tenantName,
    tenantDomain: session.subdomain,
    userId: session.superAdminUid,
    userEmail: session.superAdminEmail,
    membershipId: `prev_mem_${session.tenantId}`,
    membershipStatus: "active",
    role: session.simulatedRole,
    permissions: session.effectivePermissions,
  };

  req.membership = {
    id: `prev_mem_${session.tenantId}`,
    tenantId: session.tenantId,
    userId: session.superAdminUid,
    email: session.superAdminEmail,
    name: "Super Admin (Mod Testare)",
    role: session.simulatedRole,
    status: "active",
    permissions: session.effectivePermissions,
    createdAt: session.createdAt,
    updatedAt: session.lastActiveAt,
  };

  req.resolvedTenant = tenant;
  req.isPreviewSession = true;

  next();
}
