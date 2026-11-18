import { Request, Response, NextFunction } from "express";
import { UserRole } from "../../src/core/tenancy/typ_tenant-context";
import { ForbiddenError } from "../../src/core/errors/app_error";
import { createErrorResponse } from "../../src/core/api/api_response";

/**
 * Basic role-based access control middleware:
 * Enforces that the verified user holds one of the specified agency roles.
 */
export function requireRole(allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.tenantContext) {
      const err = new ForbiddenError("Contextul agenției lipsește.");
      res.status(err.statusCode).json(createErrorResponse(err.code, err.message));
      return;
    }

    if (!allowedRoles.includes(req.tenantContext.role)) {
      const err = new ForbiddenError(
        `Rolul dumneavoastră (${req.tenantContext.role}) nu are permisiunea necesară pentru această operațiune.`
      );
      res.status(err.statusCode).json(createErrorResponse(err.code, err.message));
      return;
    }

    next();
  };
}
