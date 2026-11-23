import { Request, Response, NextFunction } from "express";
import { PreviewSessionService } from "../../src/core/tenancy/svc_preview-session";
import { TenantResolutionService } from "../../src/core/tenancy/svc_tenant-resolution";
import { createErrorResponse } from "../../src/core/api/api_response";
import { authenticateTokenString } from "./mw_authentication";
import { PersistentStoreService } from "../../src/core/database/svc_persistent-store";

declare global {
  namespace Express {
    interface Request {
      isPreviewSession?: boolean;
    }
  }
}

/**
 * Middleware that checks for an active Super Admin preview session token.
 * If present and valid, verifies the Super Admin's Firebase ID token first so
 * live Firestore reads/writes run under their verified credentials, then attaches
 * the simulated TenantContext and simulated role to the request.
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

  // Extract & verify Firebase Bearer token up-front so PreviewSessionService and downstream
  // Firestore calls inherit request-scoped authenticated Firestore access.
  const authHeader = req.headers.authorization;
  let requestAuth: { bearerToken: string; uid: string; email?: string; emailVerified?: boolean } | null = null;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const rawToken = authHeader.substring(7).trim();
    if (rawToken) {
      try {
        const verified = req.authUser || (await authenticateTokenString(rawToken));
        req.authUser = verified;
        req.authToken = rawToken;
        if (process.env.NODE_ENV !== "test" || rawToken.includes(".")) {
          requestAuth = {
            bearerToken: rawToken,
            uid: verified.uid,
            email: verified.email,
            emailVerified: verified.emailVerified,
          };
        }
      } catch {
        res
          .status(401)
          .json(createErrorResponse("UNAUTHORIZED", "Sesiune expirată sau token de autentificare invalid."));
        return;
      }
    }
  }

  const runPreviewPipeline = async () => {
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

    await TenantResolutionService.hydrateFromFirestore();
    const tenant = TenantResolutionService.getTenantById(session.tenantId);
    if (!tenant) {
      res.status(404).json(createErrorResponse("NOT_FOUND", "Agenția testată nu mai există în sistem."));
      return;
    }

    await TenantResolutionService.ensureTenantExistsInFirestore(tenant.id);

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
  };

  if (requestAuth) {
    PersistentStoreService.runWithRequestAuth(requestAuth, () => {
      void runPreviewPipeline().catch(next);
    });
    return;
  }

  await runPreviewPipeline();
}
