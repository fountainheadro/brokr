import { Router, Request, Response } from "express";
import { requireTenantContext } from "../middleware/mw_tenant-context";
import { requireRole } from "../middleware/mw_authorization";
import { AutomationConfigRepository } from "../../src/core/automation/repo_automation-config";
import { createSuccessResponse, createErrorResponse } from "../../src/core/api/api_response";

export const automationRouter = Router();

automationRouter.use(requireTenantContext);

/**
 * GET /api/tenant/automation/title-rule
 * Retrieves the agency's configured external ad title extraction & formatting rule.
 */
automationRouter.get("/title-rule", (req: Request, res: Response) => {
  try {
    const tenantContext = req.tenantContext!;
    const record = AutomationConfigRepository.getByTenantId(tenantContext.tenantId);
    res.json(createSuccessResponse(record));
  } catch (err: any) {
    res
      .status(500)
      .json(createErrorResponse("INTERNAL_ERROR", err?.message || "Eroare la încărcarea regulii de automatizare."));
  }
});

/**
 * PUT /api/tenant/automation/title-rule
 * Updates the agency's external ad title rule (agency_owner or agency_admin only).
 */
automationRouter.put(
  "/title-rule",
  requireRole(["agency_owner", "agency_admin"]),
  (req: Request, res: Response) => {
    try {
      const tenantContext = req.tenantContext!;
      const payload = req.body?.titleRule || req.body;
      const updated = AutomationConfigRepository.saveTitleRule(
        tenantContext.tenantId,
        payload,
        tenantContext.userEmail
      );
      res.json(createSuccessResponse(updated));
    } catch (err: any) {
      res
        .status(500)
        .json(createErrorResponse("INTERNAL_ERROR", err?.message || "Eroare la salvarea regulii de automatizare."));
    }
  }
);

/**
 * POST /api/tenant/automation/title-rule/reset
 * Resets the title rule to platform defaults.
 */
automationRouter.post(
  "/title-rule/reset",
  requireRole(["agency_owner", "agency_admin"]),
  (req: Request, res: Response) => {
    try {
      const tenantContext = req.tenantContext!;
      const reset = AutomationConfigRepository.resetTitleRule(
        tenantContext.tenantId,
        tenantContext.userEmail
      );
      res.json(createSuccessResponse(reset));
    } catch (err: any) {
      res
        .status(500)
        .json(createErrorResponse("INTERNAL_ERROR", err?.message || "Eroare la resetarea regulii."));
    }
  }
);
