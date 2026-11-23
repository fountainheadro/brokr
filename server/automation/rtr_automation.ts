import { Router, Request, Response } from "express";
import { requireTenantContext } from "../middleware/mw_tenant-context";
import { requireRole } from "../middleware/mw_authorization";
import { AutomationConfigRepository } from "../../src/core/automation/repo_automation-config";
import { createSuccessResponse, createErrorResponse } from "../../src/core/api/api_response";

export const automationRouter = Router();

automationRouter.use(requireTenantContext);

/**
 * GET /api/tenant/automation/title-rule
 * Retrieves the agency's configured external ad title extraction & formatting rule directly from Firestore.
 */
automationRouter.get("/title-rule", async (req: Request, res: Response) => {
  try {
    const tenantContext = req.tenantContext!;
    const record = await AutomationConfigRepository.getByTenantIdAsync(tenantContext.tenantId);
    res.json(createSuccessResponse(record));
  } catch (err: any) {
    res
      .status(500)
      .json(createErrorResponse("INTERNAL_ERROR", err?.message || "Eroare la încărcarea regulii de automatizare."));
  }
});

/**
 * PUT /api/tenant/automation/title-rule
 * Updates the agency's external ad title rule permanently in Firestore (agency_owner or agency_admin only).
 */
automationRouter.put(
  "/title-rule",
  requireRole(["agency_owner", "agency_admin"]),
  async (req: Request, res: Response) => {
    try {
      const tenantContext = req.tenantContext!;
      const payload = req.body?.titleRule || req.body;
      const updated = await AutomationConfigRepository.saveTitleRuleAsync(
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
 * Resets the title rule to platform defaults permanently in Firestore.
 */
automationRouter.post(
  "/title-rule/reset",
  requireRole(["agency_owner", "agency_admin"]),
  async (req: Request, res: Response) => {
    try {
      const tenantContext = req.tenantContext!;
      const reset = await AutomationConfigRepository.resetTitleRuleAsync(
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
