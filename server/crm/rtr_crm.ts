import { Router, Request, Response } from "express";
import { requireTenantContext } from "../middleware/mw_tenant-context";
import {
  CrmEntityType,
  CrmTenantStoreService,
} from "../../src/core/crm/svc_crm-tenant-store";
import { createErrorResponse, createSuccessResponse } from "../../src/core/api/api_response";
import { backfillTenantLeadSummaries } from "../migration/job_backfill-summaries";
import { reconcileTenantLeadSummaries } from "../migration/job_reconcile-summaries";
import {
  invalidateEntityPublicShareCaches,
  schedulePublicShareImagePrewarm,
  schedulePublicSharePrewarmFromRecord,
} from "../cache/svc_share-cache-invalidator";

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
    invalidateEntityPublicShareCaches(null, ctx.tenantId);
    res.json(createSuccessResponse({ cleared: true, tenantId: ctx.tenantId }));
  } catch (err: any) {
    const status = err?.statusCode || 500;
    res.status(status).json(createErrorResponse(err?.code || "INTERNAL_ERROR", err?.message || String(err)));
  }
});

/**
 * Phase 2 Read-Only Slim Summary Endpoints:
 * `leads_summary` is strictly server-projected via atomic `:commit` dual-write.
 * Any client write attempt returns HTTP 403 FORBIDDEN.
 */
crmRouter.get("/leads_summary", async (req: Request, res: Response) => {
  if (!assertNoTenantSpoofing(req, res)) return;
  try {
    const ctx = req.tenantContext!;
    const propertyId =
      typeof req.query.propertyId === "string" && req.query.propertyId.trim()
        ? req.query.propertyId.trim()
        : undefined;
    const statusFilter =
      typeof req.query.status === "string" && req.query.status.trim()
        ? req.query.status.trim()
        : undefined;
    const rawLimit = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : NaN;
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(2000, rawLimit) : undefined;

    const summaries = await CrmTenantStoreService.listLeadSummaries(ctx.tenantId, {
      propertyId,
      status: statusFilter,
      limit,
    });
    res.json(createSuccessResponse(summaries));
  } catch (err: any) {
    const status = err?.statusCode || 500;
    res
      .status(status)
      .json(createErrorResponse(err?.code || "INTERNAL_ERROR", err?.message || String(err)));
  }
});

crmRouter.get("/leads_summary/:id", async (req: Request, res: Response) => {
  if (!assertNoTenantSpoofing(req, res)) return;
  try {
    const ctx = req.tenantContext!;
    const item = await CrmTenantStoreService.getLeadSummaryById(ctx.tenantId, req.params.id);
    if (!item) {
      res
        .status(404)
        .json(createErrorResponse("NOT_FOUND", "Sumarul solicitat nu există în agenția curentă."));
      return;
    }
    res.json(createSuccessResponse(item));
  } catch (err: any) {
    const status = err?.statusCode || 404;
    res.status(status).json(createErrorResponse(err?.code || "FORBIDDEN", err?.message || String(err)));
  }
});

crmRouter.all("/leads_summary", (_req: Request, res: Response) => {
  res
    .status(403)
    .json(
      createErrorResponse(
        "FORBIDDEN",
        "Proiecția leads_summary este exclusiv read-only și este gestionată atomic de server."
      )
    );
});

crmRouter.all("/leads_summary/:id", (_req: Request, res: Response) => {
  res
    .status(403)
    .json(
      createErrorResponse(
        "FORBIDDEN",
        "Proiecția leads_summary este exclusiv read-only și este gestionată atomic de server."
      )
    );
});

/**
 * POST /api/crm/admin/backfill-summaries
 * Idempotent Phase 2 summary projection backfill for the authenticated agency (admin roles only).
 */
crmRouter.post("/admin/backfill-summaries", async (req: Request, res: Response) => {
  if (!assertNoTenantSpoofing(req, res)) return;
  const ctx = req.tenantContext!;
  if (ctx.role !== "agency_owner" && ctx.role !== "agency_admin") {
    res
      .status(403)
      .json(createErrorResponse("FORBIDDEN", "Doar administratorii agenției pot rula backfill-ul."));
    return;
  }
  try {
    const dryRun = Boolean(req.body?.dryRun);
    const report = await backfillTenantLeadSummaries(ctx.tenantId, { dryRun });
    res.json(createSuccessResponse(report));
  } catch (err: any) {
    const status = err?.statusCode || 500;
    res
      .status(status)
      .json(createErrorResponse(err?.code || "INTERNAL_ERROR", err?.message || String(err)));
  }
});

/**
 * GET /api/crm/admin/reconcile-summaries
 * Verifies canonical vs leads_summary parity for the authenticated agency (admin roles only).
 */
crmRouter.get("/admin/reconcile-summaries", async (req: Request, res: Response) => {
  if (!assertNoTenantSpoofing(req, res)) return;
  const ctx = req.tenantContext!;
  if (ctx.role !== "agency_owner" && ctx.role !== "agency_admin") {
    res
      .status(403)
      .json(createErrorResponse("FORBIDDEN", "Doar administratorii agenției pot verifica paritatea."));
    return;
  }
  try {
    const autoRepair = req.query.repair === "true";
    const report = await reconcileTenantLeadSummaries(ctx.tenantId, { autoRepair });
    res.json(createSuccessResponse(report));
  } catch (err: any) {
    const status = err?.statusCode || 500;
    res
      .status(status)
      .json(createErrorResponse(err?.code || "INTERNAL_ERROR", err?.message || String(err)));
  }
});

/**
 * POST /api/crm/public-cache/invalidate
 * Instantly busts server-side public share RAM cache after client-side Firestore edits
 * so /share/:id always reflects newly saved title/description/gallery changes immediately.
 */
crmRouter.post("/public-cache/invalidate", async (req: Request, res: Response) => {
  if (!assertNoTenantSpoofing(req, res)) return;
  const ctx = req.tenantContext!;
  const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const ids = rawIds
    .filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0)
    .slice(0, 20);
  const result =
    ids.length > 0
      ? invalidateEntityPublicShareCaches(ids, ctx.tenantId)
      : { propertyCacheRemoved: 0, ogCacheRemoved: 0, imageCacheRemoved: 0 };

  const warmImages = Array.isArray(req.body?.warmImages) ? req.body.warmImages : [];
  const shareCode =
    typeof req.body?.shareCode === "string" && req.body.shareCode.trim()
      ? req.body.shareCode.trim()
      : ids[0] || "";
  const prewarmed =
    warmImages.length > 0 && shareCode
      ? schedulePublicShareImagePrewarm(shareCode, warmImages)
      : 0;

  res.json(
    createSuccessResponse({
      invalidated: result.propertyCacheRemoved,
      ogCacheRemoved: result.ogCacheRemoved,
      imageCacheRemoved: result.imageCacheRemoved,
      prewarmed,
    })
  );
});

/**
 * POST /api/crm/public-cache/prewarm
 * Non-blocking endpoint invoked on share-link copy or property save to pre-generate
 * the hero (w=1280) + 4 mosaic (w=640) WebP variants before the first external visitor opens /share/:id.
 */
crmRouter.post("/public-cache/prewarm", async (req: Request, res: Response) => {
  if (!assertNoTenantSpoofing(req, res)) return;
  const shareCode =
    typeof req.body?.shareCode === "string" && req.body.shareCode.trim()
      ? req.body.shareCode.trim()
      : "";
  const images = Array.isArray(req.body?.images) ? req.body.images : [];
  const prewarmed =
    shareCode && images.length > 0
      ? schedulePublicShareImagePrewarm(shareCode, images)
      : 0;
  res.json(createSuccessResponse({ prewarmed }));
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
    const statusFilter =
      typeof req.query.status === "string" && req.query.status.trim()
        ? req.query.status.trim()
        : undefined;
    const rawLimit = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : NaN;
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(2000, rawLimit) : undefined;
    const scopeUser =
      col === "notifications" && req.query.onlyMine === "true"
        ? ctx.userId
        : undefined;

    const items = await CrmTenantStoreService.list(ctx.tenantId, col, {
      propertyId,
      userId: scopeUser,
      status: statusFilter,
      limit,
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
    if (col === "leads") {
      invalidateEntityPublicShareCaches(
        [
          created?.id,
          (created as any)?.propertyId,
          (created as any)?.sourcePropertyId,
          (created as any)?.sharedLeadId,
          payload?.propertyId,
          payload?.sourcePropertyId,
          payload?.sharedLeadId,
        ].filter(Boolean),
        ctx.tenantId
      );
      schedulePublicSharePrewarmFromRecord(created as any, created?.id);
    }
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
    if (col === "leads") {
      invalidateEntityPublicShareCaches(
        [
          req.params.id,
          updated?.id,
          (updated as any)?.propertyId,
          (updated as any)?.sourcePropertyId,
          (updated as any)?.sharedLeadId,
          req.body?.propertyId,
          req.body?.sourcePropertyId,
          req.body?.sharedLeadId,
        ].filter(Boolean),
        ctx.tenantId
      );
      schedulePublicSharePrewarmFromRecord(updated as any, req.params.id);
    }
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
    const existingLead =
      col === "leads"
        ? await CrmTenantStoreService.getById(ctx.tenantId, "leads", req.params.id).catch(() => null)
        : null;
    await CrmTenantStoreService.delete(ctx.tenantId, col, req.params.id);
    if (col === "leads") {
      invalidateEntityPublicShareCaches(
        [
          req.params.id,
          existingLead?.id,
          existingLead?.propertyId,
          existingLead?.sourcePropertyId,
          existingLead?.sharedLeadId,
        ].filter(Boolean),
        ctx.tenantId
      );
    }
    res.json(createSuccessResponse({ deleted: true, id: req.params.id }));
  } catch (err: any) {
    const status = err?.statusCode || 400;
    res.status(status).json(createErrorResponse(err?.code || "ERROR", err?.message || String(err)));
  }
});
