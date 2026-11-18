import { Router, Request, Response } from "express";
import { requireTenantContext } from "../middleware/mw_tenant-context";
import {
  CrmEntityType,
  CrmTenantStoreService,
} from "../../src/core/crm/svc_crm-tenant-store";
import { createErrorResponse, createSuccessResponse } from "../../src/core/api/api_response";

export const crmRouter = Router();

// All CRM endpoints strictly enforce authenticated, server-verified TenantContext
crmRouter.use(...requireTenantContext);

/**
 * Rejects any attempt by the client to pass a conflicting tenantId / tenant_id
 * in request body or query params. Tenant identity MUST come exclusively from server context.
 */
function assertNoTenantSpoofing(req: Request, res: Response): boolean {
  const ctx = req.tenantContext!;
  const bodyTenant =
    typeof req.body?.tenantId === "string"
      ? req.body.tenantId.trim()
      : typeof req.body?.tenant_id === "string"
      ? req.body.tenant_id.trim()
      : "";
  const queryTenant =
    typeof req.query?.tenantId === "string"
      ? req.query.tenantId.trim()
      : typeof req.query?.tenant_id === "string"
      ? req.query.tenant_id.trim()
      : "";

  if ((bodyTenant && bodyTenant !== ctx.tenantId) || (queryTenant && queryTenant !== ctx.tenantId)) {
    res
      .status(403)
      .json(
        createErrorResponse(
          "FORBIDDEN",
          "Acces interzis: tenantId nu poate fi selectat sau suprascris din client."
        )
      );
    return false;
  }
  return true;
}

/**
 * POST /api/crm/counters/next-id
 * Generates sequential entity IDs isolated per verified tenant.
 */
crmRouter.post("/counters/next-id", async (req: Request, res: Response) => {
  if (!assertNoTenantSpoofing(req, res)) return;
  try {
    const ctx = req.tenantContext!;
    const entityType = String(req.body?.type || "lead") as CrmEntityType;
    const nextId = await CrmTenantStoreService.getNextEntityId(ctx.tenantId, entityType);
    res.json(createSuccessResponse({ nextId, tenantId: ctx.tenantId }));
  } catch (err: any) {
    const status = err?.statusCode || 400;
    res
      .status(status)
      .json(createErrorResponse(err?.code || "VALIDATION_ERROR", err?.message || String(err)));
  }
});

/**
 * POST /api/crm/fcm-tokens
 * Registers an FCM push token scoped to (verified tenantId, authenticated userId).
 */
crmRouter.post("/fcm-tokens", async (req: Request, res: Response) => {
  if (!assertNoTenantSpoofing(req, res)) return;
  try {
    const ctx = req.tenantContext!;
    const token = String(req.body?.token || "").trim();
    if (!token) {
      res.status(400).json(createErrorResponse("VALIDATION_ERROR", "Lipsește token-ul FCM."));
      return;
    }

    const saved = await CrmTenantStoreService.upsertFcmToken({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      email: ctx.userEmail,
      token,
      devicePlatform: req.body?.devicePlatform,
      userAgent: req.body?.userAgent,
    });
    res.status(201).json(createSuccessResponse(saved));
  } catch (err: any) {
    const status = err?.statusCode || 500;
    res.status(status).json(createErrorResponse(err?.code || "INTERNAL_ERROR", err?.message || String(err)));
  }
});

/**
 * DELETE /api/crm/fcm-tokens/:token
 */
crmRouter.delete("/fcm-tokens/:token", async (req: Request, res: Response) => {
  if (!assertNoTenantSpoofing(req, res)) return;
  try {
    const ctx = req.tenantContext!;
    const deleted = await CrmTenantStoreService.deleteFcmToken(
      ctx.tenantId,
      ctx.userId,
      req.params.token
    );
    res.json(createSuccessResponse({ deleted }));
  } catch (err: any) {
    const status = err?.statusCode || 403;
    res.status(status).json(createErrorResponse(err?.code || "FORBIDDEN", err?.message || String(err)));
  }
});

/**
 * DELETE /api/crm/leads
 * Clears all leads strictly within the authenticated agency tenant (admin roles only).
 */
crmRouter.delete("/leads", async (req: Request, res: Response) => {
  if (!assertNoTenantSpoofing(req, res)) return;
  try {
    const ctx = req.tenantContext!;
    if (ctx.role !== "agency_owner" && ctx.role !== "agency_admin") {
      res
        .status(403)
        .json(
          createErrorResponse(
            "FORBIDDEN",
            "Doar administratorii agenției pot șterge în bloc înregistrările propriei agenții."
          )
        );
      return;
    }
    await CrmTenantStoreService.clearTenantCollection(ctx.tenantId, "leads");
    res.json(createSuccessResponse({ cleared: true, tenantId: ctx.tenantId }));
  } catch (err: any) {
    const status = err?.statusCode || 500;
    res.status(status).json(createErrorResponse(err?.code || "INTERNAL_ERROR", err?.message || String(err)));
  }
});

/**
 * GET /api/crm/:collection
 * Lists all documents in a collection strictly for req.tenantContext.tenantId.
 */
crmRouter.get("/:collection", async (req: Request, res: Response) => {
  if (!assertNoTenantSpoofing(req, res)) return;
  try {
    const ctx = req.tenantContext!;
    const col = CrmTenantStoreService.assertValidCollection(req.params.collection);
    const propertyId =
      typeof req.query.propertyId === "string" && req.query.propertyId.trim()
        ? req.query.propertyId.trim()
        : undefined;
    const scopeUser =
      col === "notifications" && req.query.onlyMine === "true"
        ? ctx.userId
        : undefined;

    const items = await CrmTenantStoreService.list(ctx.tenantId, col, {
      propertyId,
      userId: scopeUser,
    });
    res.json(createSuccessResponse(items));
  } catch (err: any) {
    const status = err?.statusCode || 400;
    res.status(status).json(createErrorResponse(err?.code || "VALIDATION_ERROR", err?.message || String(err)));
  }
});

/**
 * GET /api/crm/:collection/:id
 * Fetches a single document strictly owned by req.tenantContext.tenantId.
 */
crmRouter.get("/:collection/:id", async (req: Request, res: Response) => {
  if (!assertNoTenantSpoofing(req, res)) return;
  try {
    const ctx = req.tenantContext!;
    const col = CrmTenantStoreService.assertValidCollection(req.params.collection);
    const item = await CrmTenantStoreService.getById(ctx.tenantId, col, req.params.id);
    if (!item) {
      res.status(404).json(createErrorResponse("NOT_FOUND", "Înregistrarea solicitată nu există în agenția curentă."));
      return;
    }
    res.json(createSuccessResponse(item));
  } catch (err: any) {
    const status = err?.statusCode || 404;
    res.status(status).json(createErrorResponse(err?.code || "FORBIDDEN", err?.message || String(err)));
  }
});

/**
 * POST /api/crm/:collection
 * Creates a document strictly inside /tenants/{verifiedTenantId}/{collection}.
 */
crmRouter.post("/:collection", async (req: Request, res: Response) => {
  if (!assertNoTenantSpoofing(req, res)) return;
  try {
    const ctx = req.tenantContext!;
    const col = CrmTenantStoreService.assertValidCollection(req.params.collection);
    const payload = { ...(req.body || {}) };
    if (col === "notifications" && !payload.userId) {
      payload.userId = ctx.userId;
    }
    const created = await CrmTenantStoreService.create(ctx.tenantId, col, payload, ctx.userId);
    res.status(201).json(createSuccessResponse(created));
  } catch (err: any) {
    const status = err?.statusCode || 400;
    res.status(status).json(createErrorResponse(err?.code || "VALIDATION_ERROR", err?.message || String(err)));
  }
});

/**
 * PATCH /api/crm/:collection/:id
 * Updates a document strictly verifying tenant ownership beforehand.
 */
crmRouter.patch("/:collection/:id", async (req: Request, res: Response) => {
  if (!assertNoTenantSpoofing(req, res)) return;
  try {
    const ctx = req.tenantContext!;
    const col = CrmTenantStoreService.assertValidCollection(req.params.collection);
    const updated = await CrmTenantStoreService.update(
      ctx.tenantId,
      col,
      req.params.id,
      req.body || {}
    );
    res.json(createSuccessResponse(updated));
  } catch (err: any) {
    const status = err?.statusCode || 400;
    res.status(status).json(createErrorResponse(err?.code || "ERROR", err?.message || String(err)));
  }
});

/**
 * DELETE /api/crm/:collection/:id
 * Deletes a document strictly verifying tenant ownership beforehand.
 */
crmRouter.delete("/:collection/:id", async (req: Request, res: Response) => {
  if (!assertNoTenantSpoofing(req, res)) return;
  try {
    const ctx = req.tenantContext!;
    const col = CrmTenantStoreService.assertValidCollection(req.params.collection);
    await CrmTenantStoreService.delete(ctx.tenantId, col, req.params.id);
    res.json(createSuccessResponse({ deleted: true, id: req.params.id }));
  } catch (err: any) {
    const status = err?.statusCode || 400;
    res.status(status).json(createErrorResponse(err?.code || "ERROR", err?.message || String(err)));
  }
});
