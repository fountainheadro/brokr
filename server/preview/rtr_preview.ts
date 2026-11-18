import { Router, Request, Response } from "express";
import { mwAuthentication } from "../middleware/mw_authentication";
import { mwPlatformAuthorization } from "../middleware/mw_platform-authorization";
import { PreviewSessionService } from "../../src/core/tenancy/svc_preview-session";
import { TenantResolutionService } from "../../src/core/tenancy/svc_tenant-resolution";
import { TenantMembershipService } from "../../src/core/tenancy/svc_tenant-membership";
import { QuotaService } from "../../src/core/subscription/svc_quota";
import { createSuccessResponse, createErrorResponse } from "../../src/core/api/api_response";
import { UserRole } from "../../src/core/tenancy/typ_tenant-context";
import { AppError } from "../../src/core/errors/app_error";

export const previewRouter = Router();

// All preview management endpoints strictly require authenticated Platform Super Admin
previewRouter.use(mwAuthentication, mwPlatformAuthorization);

/**
 * GET /api/platform/preview/targets
 * Returns all agencies available for preview along with quick access metadata.
 */
previewRouter.get("/targets", (_req: Request, res: Response) => {
  try {
    const agencies = TenantResolutionService.getAllTenants();
    const enriched = agencies.map((a) => {
      const members = TenantMembershipService.listTenantMembers(a.id);
      let planDisplayName = "Enterprise";
      try {
        const ent = QuotaService.getTenantEntitlements(a.id);
        planDisplayName = ent.planDisplayName;
      } catch {}

      return {
        id: a.id,
        name: a.name,
        subdomain: a.subdomain,
        status: a.status,
        planId: a.planId,
        planDisplayName,
        membersCount: members.length,
        enabledModulesCount: a.enabledModules?.length || 0,
        branding: a.branding,
      };
    });

    res.json(createSuccessResponse(enriched));
  } catch (err: any) {
    res.status(500).json(createErrorResponse("INTERNAL_ERROR", err?.message || String(err)));
  }
});

/**
 * POST /api/platform/preview/start
 * Starts a server-validated preview session for a target agency.
 */
previewRouter.post("/start", (req: Request, res: Response) => {
  try {
    const { tenantId, simulatedRole = "agency_admin" } = req.body;

    if (!tenantId) {
      res.status(400).json(createErrorResponse("VALIDATION_ERROR", "ID-ul agenției este obligatoriu."));
      return;
    }

    const superAdminUser = req.authUser!;
    const session = PreviewSessionService.startSession({
      tenantId,
      superAdminUid: superAdminUser.uid,
      superAdminEmail: superAdminUser.email,
      simulatedRole: simulatedRole as UserRole,
      environment: process.env.NODE_ENV === "production" ? "production" : "development",
    });

    res.json(
      createSuccessResponse({
        token: session.token,
        tenantId: session.tenantId,
        tenantName: session.tenantName,
        subdomain: session.subdomain,
        simulatedRole: session.simulatedRole,
        effectivePermissions: session.effectivePermissions,
        effectiveModules: session.effectiveModules,
        expiresAt: session.expiresAt,
      })
    );
  } catch (err: any) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json(createErrorResponse(err.code, err.message));
      return;
    }
    res.status(500).json(createErrorResponse("INTERNAL_ERROR", err?.message || String(err)));
  }
});

/**
 * POST /api/platform/preview/switch-role
 * Switches the simulated role (e.g. Administrator <-> Agent) in one click.
 * Only the Super Admin who owns the preview session can mutate it.
 */
previewRouter.post("/switch-role", (req: Request, res: Response) => {
  try {
    const { previewToken, newRole } = req.body;
    const effectiveToken = previewToken || (req.headers["x-preview-token"] as string);

    if (!effectiveToken || !newRole) {
      res
        .status(400)
        .json(createErrorResponse("VALIDATION_ERROR", "Tokenul de testare și noul rol sunt obligatorii."));
      return;
    }

    const existing = PreviewSessionService.getSession(effectiveToken);
    if (!existing) {
      res.status(401).json(createErrorResponse("UNAUTHORIZED", "Sesiunea de testare este invalidă sau a expirat."));
      return;
    }

    if (existing.superAdminUid !== req.authUser!.uid) {
      res.status(403).json(createErrorResponse("FORBIDDEN", "Nu puteți modifica sesiunea de testare a altui administrator."));
      return;
    }

    const session = PreviewSessionService.switchRole(effectiveToken, newRole as UserRole);

    res.json(
      createSuccessResponse({
        token: session.token,
        tenantId: session.tenantId,
        tenantName: session.tenantName,
        simulatedRole: session.simulatedRole,
        effectivePermissions: session.effectivePermissions,
        effectiveModules: session.effectiveModules,
        expiresAt: session.expiresAt,
      })
    );
  } catch (err: any) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json(createErrorResponse(err.code, err.message));
      return;
    }
    res.status(500).json(createErrorResponse("INTERNAL_ERROR", err?.message || String(err)));
  }
});

/**
 * GET /api/platform/preview/status
 * Validates whether a given preview session is currently active for the authenticated Super Admin.
 */
previewRouter.get("/status", (req: Request, res: Response) => {
  const token = (req.headers["x-preview-token"] as string) || null;

  if (!token) {
    res.json(createSuccessResponse({ isActive: false }));
    return;
  }

  const session = PreviewSessionService.getSession(token);
  if (!session || session.superAdminUid !== req.authUser!.uid) {
    res.json(createSuccessResponse({ isActive: false }));
    return;
  }

  res.json(
    createSuccessResponse({
      isActive: true,
      session: {
        token: session.token,
        tenantId: session.tenantId,
        tenantName: session.tenantName,
        subdomain: session.subdomain,
        simulatedRole: session.simulatedRole,
        superAdminEmail: session.superAdminEmail,
        effectivePermissions: session.effectivePermissions,
        effectiveModules: session.effectiveModules,
        expiresAt: session.expiresAt,
      },
    })
  );
});

/**
 * POST /api/platform/preview/exit
 * Terminates and deletes the preview session owned by the authenticated Super Admin.
 */
previewRouter.post("/exit", (req: Request, res: Response) => {
  const { previewToken } = req.body;
  const token = previewToken || (req.headers["x-preview-token"] as string);

  if (token) {
    const existing = PreviewSessionService.getSession(token);
    if (existing && existing.superAdminUid !== req.authUser!.uid) {
      res.status(403).json(createErrorResponse("FORBIDDEN", "Nu puteți închide sesiunea de testare a altui administrator."));
      return;
    }
    PreviewSessionService.destroySession(token);
  }

  res.json(createSuccessResponse({ exited: true }));
});
