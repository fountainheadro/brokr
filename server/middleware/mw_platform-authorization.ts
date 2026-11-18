import { Request, Response, NextFunction } from "express";
import { PlatformAdminService } from "../../src/core/platform/svc_platform-admin";
import { PlatformAdminUser } from "../../src/core/platform/typ_platform-admin";
import { ForbiddenError, UnauthorizedError } from "../../src/core/errors/app_error";
import { createErrorResponse } from "../../src/core/api/api_response";
import { logger } from "../../src/core/logger/logger";

declare global {
  namespace Express {
    interface Request {
      platformAdmin?: PlatformAdminUser;
    }
  }
}

/**
 * Super Admin platform authorization middleware:
 * Enforces that the authenticated user possesses verified platform administrator privileges.
 *
 * CRITICAL INVARIANT:
 * Agency roles (agency_owner, agency_admin, agent, etc.) NEVER grant access to platform endpoints.
 */
export function mwPlatformAuthorization(req: Request, res: Response, next: NextFunction): void {
  if (!req.authUser) {
    const err = new UnauthorizedError("Autentificare necesară pentru accesul în panoul de administrare a platformei.");
    res.status(err.statusCode).json(createErrorResponse(err.code, err.message));
    return;
  }

  // Only allow verified email fallback when not running uid-based test subjects
  const effectiveEmail =
    req.authUser.emailVerified === false ? undefined : req.authUser.email;

  const isSuperAdmin = PlatformAdminService.isPlatformAdmin(req.authUser.uid, effectiveEmail);

  if (!isSuperAdmin) {
    logger.recordMetric("authz_failure");
    const err = new ForbiddenError(
      "Acces refuzat: Acest punct final necesită permisiuni exclusive de Administrator de Platformă (Super Admin). Rolurile de agenție nu conferă acces."
    );
    res.status(err.statusCode).json(createErrorResponse(err.code, err.message));
    return;
  }

  const admin = PlatformAdminService.getPlatformAdmin(req.authUser.uid, effectiveEmail);
  if (admin) {
    req.platformAdmin = admin;
  }

  next();
}
