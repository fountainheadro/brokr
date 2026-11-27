import { Router, type Request, type Response } from "express";
import { requireTenantContext } from "../middleware/mw_tenant-context";
import { createErrorResponse, createSuccessResponse } from "../../src/core/api/api_response";
import { AppError } from "../../src/core/errors/app_error";
import { PortalCredentialsService } from "../../src/core/portals/svc_portal-credentials";
import { PortalPublishingOrchestrator } from "../../src/core/portals/svc_portal-orchestrator";
import type { PortalCredentialsPayload } from "../../src/core/portals/typ_portal-provider";

const PORTAL_ADMIN_ROLES = new Set(["agency_owner", "agency_admin", "platform_admin"]);

function isPortalAdmin(req: Request): boolean {
  const role = String(req.tenantContext?.role || "").toLowerCase();
  return PORTAL_ADMIN_ROLES.has(role);
}

function handlePortalRouteError(res: Response, err: unknown, fallbackMessage: string): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json(createErrorResponse(err.code, err.message));
    return;
  }
  const msg = err instanceof Error ? err.message : fallbackMessage;
  res.status(500).json(createErrorResponse("INTERNAL_ERROR", msg));
}

function sanitizeCredentialsInput(raw: unknown): PortalCredentialsPayload | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: PortalCredentialsPayload = {};
  const entries = Object.entries(raw as Record<string, unknown>).slice(0, 20);
  for (const [k, v] of entries) {
    if (!/^[a-zA-Z0-9_.\-]{1,64}$/.test(k)) continue;
    if (typeof v === "string") {
      out[k] = v.slice(0, 2048);
    } else if (typeof v === "number" && Number.isFinite(v)) {
      out[k] = v;
    } else if (typeof v === "boolean") {
      out[k] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Phase 7 External Property Portal Publishing API Router (`/api/portals`).
 *
 * Security boundaries:
 * - Every route requires verified Firebase Auth + active tenant membership (`requireTenantContext`).
 * - Managing agency portal connections/credentials is strictly restricted to Agency Owner / Admin.
 * - Encrypted credentials live exclusively in backend-only `/tenants/{tid}/portal_secrets` and
 *   are NEVER returned in any API response.
 * - Cross-tenant isolation is strictly enforced via `req.tenantContext.tenantId`.
 */
export const portalsRouter = Router();
portalsRouter.use(...requireTenantContext);

portalsRouter.get("/providers", async (req, res) => {
  try {
    const tenantId = req.tenantContext!.tenantId;
    const settings = await PortalPublishingOrchestrator.getTenantPortalSettings(tenantId);
    const enabledSet = new Set(settings.enabledProviders);
    const providers = PortalPublishingOrchestrator.listProviders().map((p) => ({
      ...p,
      enabledForTenant: enabledSet.has(p.providerId),
    }));
    res.setHeader("Cache-Control", "no-store");
    res.json(
      createSuccessResponse({
        uiEnabled: process.env.ENABLE_PORTAL_PUBLISHING_UI === "true",
        enabledProviders: settings.enabledProviders,
        providers,
      })
    );
  } catch (err) {
    handlePortalRouteError(res, err, "Eroare la listarea providerilor de portal.");
  }
});

portalsRouter.get("/settings", async (req, res) => {
  try {
    const tenantId = req.tenantContext!.tenantId;
    const settings = await PortalPublishingOrchestrator.getTenantPortalSettings(tenantId);
    res.setHeader("Cache-Control", "no-store");
    res.json(createSuccessResponse({ settings }));
  } catch (err) {
    handlePortalRouteError(res, err, "Eroare la citirea setărilor de integrare portal.");
  }
});

portalsRouter.put("/settings", async (req, res) => {
  if (!isPortalAdmin(req)) {
    res
      .status(403)
      .json(
        createErrorResponse(
          "FORBIDDEN",
          "Doar proprietarul sau administratorul agenției poate activa sau dezactiva portaluri externe."
        )
      );
    return;
  }

  try {
    const tenantId = req.tenantContext!.tenantId;
    const rawProviders = req.body?.enabledProviders;
    if (!Array.isArray(rawProviders)) {
      res
        .status(400)
        .json(
          createErrorResponse(
            "VALIDATION_ERROR",
            "Câmpul enabledProviders trebuie să fie o listă validă de identificatori."
          )
        );
      return;
    }

    const enabledProviders = rawProviders
      .slice(0, 20)
      .map((item) => String(item || "").trim())
      .filter(Boolean);

    const settings = await PortalPublishingOrchestrator.updateTenantPortalSettings({
      tenantId,
      enabledProviders,
      updatedBy: req.authUser?.email || req.authUser?.uid || "agency_admin",
    });

    res.setHeader("Cache-Control", "no-store");
    res.json(createSuccessResponse({ settings }));
  } catch (err) {
    handlePortalRouteError(res, err, "Eroare la salvarea setărilor de integrare portal.");
  }
});

portalsRouter.get("/connections", async (req, res) => {
  try {
    const tenantId = req.tenantContext!.tenantId;
    const connections = await PortalCredentialsService.listConnections(tenantId);
    res.setHeader("Cache-Control", "no-store");
    res.json(createSuccessResponse({ connections }));
  } catch (err) {
    handlePortalRouteError(res, err, "Eroare la listarea conexiunilor de portal.");
  }
});

portalsRouter.put("/connections/:providerId", async (req, res) => {
  if (!isPortalAdmin(req)) {
    res
      .status(403)
      .json(
        createErrorResponse(
          "FORBIDDEN",
          "Doar proprietarul sau administratorul agenției poate configura conexiunile la portaluri."
        )
      );
    return;
  }

  try {
    const tenantId = req.tenantContext!.tenantId;
    const providerId = String(req.params.providerId || "").trim();
    const provider = PortalPublishingOrchestrator.getProvider(providerId);
    const credentials = sanitizeCredentialsInput(req.body?.credentials);
    const accountLabel =
      typeof req.body?.accountLabel === "string" && req.body.accountLabel.trim()
        ? req.body.accountLabel.trim()
        : provider.displayName;

    const connection = await PortalCredentialsService.saveConnection({
      tenantId,
      providerId: provider.providerId,
      accountLabel,
      credentials,
      updatedBy: req.authUser?.email || req.authUser?.uid || "agency_admin",
    });

    res.setHeader("Cache-Control", "no-store");
    res.json(createSuccessResponse({ connection }));
  } catch (err) {
    handlePortalRouteError(res, err, "Eroare la salvarea conexiunii portalului.");
  }
});

portalsRouter.post("/connections/:providerId/test", async (req, res) => {
  if (!isPortalAdmin(req)) {
    res
      .status(403)
      .json(
        createErrorResponse(
          "FORBIDDEN",
          "Doar administratorul agenției poate testa conexiunile la portaluri."
        )
      );
    return;
  }

  try {
    const tenantId = req.tenantContext!.tenantId;
    const providerId = String(req.params.providerId || "").trim();
    const provider = PortalPublishingOrchestrator.getProvider(providerId);
    const overrideCredentials = sanitizeCredentialsInput(req.body?.credentials);
    const credentials =
      overrideCredentials ||
      (await PortalCredentialsService.loadDecryptedCredentials(tenantId, provider.providerId));

    if (!credentials || Object.keys(credentials).length === 0) {
      res
        .status(400)
        .json(
          createErrorResponse(
            "CONFIGURATION_ERROR",
            "Nu există credențiale salvate pentru acest portal."
          )
        );
      return;
    }

    const testResult = await provider.testCredentials(credentials);
    const testedAt = new Date().toISOString();
    await PortalCredentialsService.updateConnectionStatus({
      tenantId,
      providerId: provider.providerId,
      status: testResult.ok ? "connected" : "error",
      lastTestedAt: testedAt,
      lastError: testResult.ok ? null : testResult.message || "Test conexiune eșuat.",
      ...(testResult.accountLabel ? { accountLabel: testResult.accountLabel } : {}),
    });

    res.setHeader("Cache-Control", "no-store");
    res.json(createSuccessResponse({ ...testResult, testedAt }));
  } catch (err) {
    handlePortalRouteError(res, err, "Eroare la testarea conexiunii portalului.");
  }
});

portalsRouter.delete("/connections/:providerId", async (req, res) => {
  if (!isPortalAdmin(req)) {
    res
      .status(403)
      .json(
        createErrorResponse(
          "FORBIDDEN",
          "Doar administratorul agenției poate deconecta portaluri."
        )
      );
    return;
  }

  try {
    const tenantId = req.tenantContext!.tenantId;
    const providerId = String(req.params.providerId || "").trim();
    const deleted = await PortalCredentialsService.deleteConnection(tenantId, providerId);
    res.setHeader("Cache-Control", "no-store");
    res.json(createSuccessResponse({ deleted }));
  } catch (err) {
    handlePortalRouteError(res, err, "Eroare la ștergerea conexiunii portalului.");
  }
});

portalsRouter.get("/properties/:propertyId/publications", async (req, res) => {
  try {
    const tenantId = req.tenantContext!.tenantId;
    const propertyId = String(req.params.propertyId || "").trim();
    const settings = await PortalPublishingOrchestrator.getTenantPortalSettings(tenantId);
    const enabledSet = new Set(settings.enabledProviders);
    const publications = await PortalPublishingOrchestrator.listPropertyPublications(
      tenantId,
      propertyId
    );
    const existingProviderIds = new Set(publications.map((pub) => pub.providerId));
    const providers = PortalPublishingOrchestrator.listProviders()
      .filter((p) => enabledSet.has(p.providerId) || existingProviderIds.has(p.providerId))
      .map((p) => ({
        ...p,
        enabledForTenant: enabledSet.has(p.providerId),
      }));
    const validations: Record<string, unknown> = {};
    for (const p of providers) {
      const check = await PortalPublishingOrchestrator.validateProperty({
        tenantId,
        propertyId,
        providerId: p.providerId,
      });
      validations[p.providerId] = check.validation;
    }

    res.setHeader("Cache-Control", "no-store");
    res.json(
      createSuccessResponse({
        publications,
        validations,
        providers,
        enabledProviders: settings.enabledProviders,
      })
    );
  } catch (err) {
    handlePortalRouteError(res, err, "Eroare la încărcarea statusurilor de publicare.");
  }
});

portalsRouter.post("/properties/:propertyId/validate", async (req, res) => {
  try {
    const tenantId = req.tenantContext!.tenantId;
    const propertyId = String(req.params.propertyId || "").trim();
    const providerId = String(req.body?.providerId || "mock_portal").trim();

    const result = await PortalPublishingOrchestrator.validateProperty({
      tenantId,
      propertyId,
      providerId,
    });
    res.setHeader("Cache-Control", "no-store");
    res.json(createSuccessResponse(result));
  } catch (err) {
    handlePortalRouteError(res, err, "Eroare la validarea proprietății pentru portal.");
  }
});

portalsRouter.post("/properties/:propertyId/publish", async (req, res) => {
  try {
    const tenantId = req.tenantContext!.tenantId;
    const propertyId = String(req.params.propertyId || "").trim();
    const providerId = String(req.body?.providerId || "mock_portal").trim();

    const result = await PortalPublishingOrchestrator.requestPublishOrUpdate({
      tenantId,
      propertyId,
      providerId,
      requestedBy: req.authUser?.email || req.authUser?.uid || "agent",
    });

    res.setHeader("Cache-Control", "no-store");
    res.status(result.accepted ? 202 : 422).json(createSuccessResponse(result));
  } catch (err) {
    handlePortalRouteError(res, err, "Eroare la inițierea publicării pe portal.");
  }
});

portalsRouter.post("/properties/:propertyId/pause", async (req, res) => {
  try {
    const tenantId = req.tenantContext!.tenantId;
    const propertyId = String(req.params.propertyId || "").trim();
    const providerId = String(req.body?.providerId || "mock_portal").trim();

    const result = await PortalPublishingOrchestrator.requestPause({
      tenantId,
      propertyId,
      providerId,
      requestedBy: req.authUser?.email || req.authUser?.uid || "agent",
    });

    res.setHeader("Cache-Control", "no-store");
    res.status(202).json(createSuccessResponse(result));
  } catch (err) {
    handlePortalRouteError(res, err, "Eroare la punerea pe pauză a anunțului.");
  }
});

portalsRouter.post("/properties/:propertyId/withdraw", async (req, res) => {
  try {
    const tenantId = req.tenantContext!.tenantId;
    const propertyId = String(req.params.propertyId || "").trim();
    const providerId = String(req.body?.providerId || "mock_portal").trim();

    const result = await PortalPublishingOrchestrator.requestWithdraw({
      tenantId,
      propertyId,
      providerId,
      requestedBy: req.authUser?.email || req.authUser?.uid || "agent",
    });

    res.setHeader("Cache-Control", "no-store");
    res.status(202).json(createSuccessResponse(result));
  } catch (err) {
    handlePortalRouteError(res, err, "Eroare la retragerea anunțului de pe portal.");
  }
});

portalsRouter.post("/properties/:propertyId/sync-status", async (req, res) => {
  try {
    const tenantId = req.tenantContext!.tenantId;
    const propertyId = String(req.params.propertyId || "").trim();
    const providerId = String(req.body?.providerId || "mock_portal").trim();

    const publication = await PortalPublishingOrchestrator.syncStatus({
      tenantId,
      propertyId,
      providerId,
    });

    res.setHeader("Cache-Control", "no-store");
    res.json(createSuccessResponse({ publication }));
  } catch (err) {
    handlePortalRouteError(res, err, "Eroare la sincronizarea statusului portalului.");
  }
});
