import { Router } from "express";
import { requireWorkerOidc } from "../middleware/mw_worker-oidc";
import { mwAuthentication } from "../middleware/mw_authentication";
import { mwPlatformAuthorization } from "../middleware/mw_platform-authorization";
import { requireTenantContext } from "../middleware/mw_tenant-context";
import { FirestoreLeaseService } from "../../src/core/jobs/svc_firestore-lease";
import {
  TransactionalOutboxService,
  type OutboxEventStatus,
} from "../../src/core/jobs/svc_transactional-outbox";
import { ScrapeWorkerService } from "../scraping/svc_scrape-worker";
import { runViewingRemindersTick } from "../background-notifications";
import { createSuccessResponse, createErrorResponse } from "../../src/core/api/api_response";
import { AppError } from "../../src/core/errors/app_error";

/**
 * Internal worker endpoints invoked exclusively by Google Cloud Scheduler and Cloud Tasks.
 * Every route requires a cryptographically verified RS256 Google OIDC token matching
 * WORKER_OIDC_AUDIENCE and WORKER_OIDC_ALLOWED_EMAILS (fails closed with HTTP 403).
 */
export const internalWorkersRouter = Router();
internalWorkersRouter.use(requireWorkerOidc());

internalWorkersRouter.post("/viewing-reminders", async (req, res) => {
  const triggeredBy = req.workerIdentity?.email || "cloud_scheduler";
  const run = await TransactionalOutboxService.recordJobRunStart({
    jobName: "viewing_reminders",
    tenantId: "platform",
    triggeredBy,
  });

  try {
    const result = await runViewingRemindersTick({
      ownerId: `oidc:${triggeredBy}:${run.id}`,
    });
    await TransactionalOutboxService.recordJobRunFinish(run, {
      status: result.executed ? "completed" : "skipped_lease",
      summary: {
        fencingToken: result.fencingToken ?? null,
        evaluatedViewings: result.evaluatedViewings,
        dispatchedCount: result.dispatchedCount,
        deduplicatedCount: result.deduplicatedCount,
        skippedReason: result.skippedReason || null,
      },
    });
    res.json(createSuccessResponse({ runId: run.id, ...result }));
  } catch (err: any) {
    await TransactionalOutboxService.recordJobRunFinish(run, {
      status: "failed",
      errorMessage: err?.message || "Viewing reminders worker failed",
    });
    res
      .status(500)
      .json(createErrorResponse("INTERNAL_ERROR", err?.message || "Eroare worker notificări."));
  }
});

internalWorkersRouter.post("/outbox-dispatch", async (req, res) => {
  const triggeredBy = req.workerIdentity?.email || "cloud_tasks";
  const limit = Number(req.body?.limit || 25);
  const maxPerTenant = Number(req.body?.maxPerTenant || 2);

  const run = await TransactionalOutboxService.recordJobRunStart({
    jobName: "outbox_dispatch",
    tenantId: "platform",
    triggeredBy,
  });

  try {
    const leaseOutcome = await FirestoreLeaseService.withLease(
      {
        lockKey: "worker:outbox-dispatch",
        ownerId: `oidc:${triggeredBy}:${run.id}`,
        ttlMs: 55_000,
      },
      async (lease) => {
        const stats = await TransactionalOutboxService.processDueEvents({
          limit,
          maxPerTenant,
        });
        return { fencingToken: lease.fencingToken, ...stats };
      }
    );

    if (!leaseOutcome.executed) {
      await TransactionalOutboxService.recordJobRunFinish(run, {
        status: "skipped_lease",
        summary: { reason: leaseOutcome.reason },
      });
      res.json(
        createSuccessResponse({
          runId: run.id,
          executed: false,
          skippedReason: leaseOutcome.reason,
        })
      );
      return;
    }

    await TransactionalOutboxService.recordJobRunFinish(run, {
      status: "completed",
      summary: leaseOutcome.result,
    });
    res.json(
      createSuccessResponse({
        runId: run.id,
        executed: true,
        ...leaseOutcome.result,
      })
    );
  } catch (err: any) {
    await TransactionalOutboxService.recordJobRunFinish(run, {
      status: "failed",
      errorMessage: err?.message || "Outbox dispatch failed",
    });
    res
      .status(500)
      .json(createErrorResponse("INTERNAL_ERROR", err?.message || "Eroare worker outbox."));
  }
});

internalWorkersRouter.post("/platform-auto-crawl", async (req, res) => {
  try {
    const triggeredBy = req.workerIdentity?.email || "cloud_scheduler";
    const result = await ScrapeWorkerService.executePlatformAutoCrawlJob({
      triggeredBy,
      force: Boolean(req.body?.force),
    });
    res.json(createSuccessResponse(result));
  } catch (err: any) {
    res
      .status(500)
      .json(createErrorResponse("INTERNAL_ERROR", err?.message || "Eroare worker auto-crawl."));
  }
});

internalWorkersRouter.post("/agency-market-auto-import", async (req, res) => {
  try {
    const triggeredBy = req.workerIdentity?.email || "cloud_scheduler";
    const tenantId =
      typeof req.body?.tenantId === "string" && req.body.tenantId.trim()
        ? req.body.tenantId.trim()
        : undefined;
    const result = await ScrapeWorkerService.executeAgencyMarketAutoImportJob({
      tenantId,
      triggeredBy,
      force: Boolean(req.body?.force),
    });
    res.json(createSuccessResponse(result));
  } catch (err: any) {
    res
      .status(500)
      .json(
        createErrorResponse("INTERNAL_ERROR", err?.message || "Eroare worker auto-import agenție.")
      );
  }
});

/**
 * Unified Stage A automation dispatcher called by a single Cloud Scheduler job so total
 * Cloud Scheduler jobs stay strictly within GCP's 3 free jobs/month limit ($0/mo).
 */
internalWorkersRouter.post("/automation-dispatch", async (req, res) => {
  const triggeredBy = req.workerIdentity?.email || "cloud_scheduler";
  try {
    const outboxLease = await FirestoreLeaseService.withLease(
      {
        lockKey: "worker:outbox-dispatch",
        ownerId: `oidc:${triggeredBy}:dispatch`,
        ttlMs: 55_000,
      },
      async () => TransactionalOutboxService.processDueEvents({ limit: 25, maxPerTenant: 2 })
    );

    const crawl = await ScrapeWorkerService.executePlatformAutoCrawlJob({
      triggeredBy,
      force: Boolean(req.body?.forceCrawl),
    });

    const agencyImport = await ScrapeWorkerService.executeAgencyMarketAutoImportJob({
      triggeredBy,
      force: Boolean(req.body?.forceAgencyImport),
    });

    res.json(
      createSuccessResponse({
        outbox: outboxLease.executed
          ? { executed: true, ...outboxLease.result }
          : { executed: false, skippedReason: outboxLease.reason },
        platformAutoCrawl: crawl,
        agencyMarketAutoImport: agencyImport,
      })
    );
  } catch (err: any) {
    res
      .status(500)
      .json(createErrorResponse("INTERNAL_ERROR", err?.message || "Eroare automation-dispatch."));
  }
});

/**
 * Operational inspection & manual DLQ replay routes for Super Admin and Agency Admins.
 */
export const workerAdminRouter = Router();

workerAdminRouter.get("/status", mwAuthentication, mwPlatformAuthorization, (_req, res) => {
  res.json(
    createSuccessResponse({
      outboxStats: TransactionalOutboxService.getOutboxStats(),
      scrapeConcurrency: ScrapeWorkerService.getConcurrencyStats(),
      activeLeases: FirestoreLeaseService.listLeases().slice(0, 25),
      recentRuns: TransactionalOutboxService.listJobRuns({ limit: 25 }),
    })
  );
});

workerAdminRouter.get("/outbox", mwAuthentication, mwPlatformAuthorization, (req, res) => {
  const rawStatus = typeof req.query.status === "string" ? req.query.status : undefined;
  const allowedStatuses: OutboxEventStatus[] = [
    "pending",
    "processing",
    "completed",
    "retryable",
    "dead_letter",
  ];
  const status =
    rawStatus && allowedStatuses.includes(rawStatus as OutboxEventStatus)
      ? (rawStatus as OutboxEventStatus)
      : undefined;
  const tenantId = typeof req.query.tenantId === "string" ? req.query.tenantId : undefined;
  const limit = Number(req.query.limit || 50);

  res.json(
    createSuccessResponse({
      events: TransactionalOutboxService.listEvents({
        status,
        tenantId,
        limit: Number.isFinite(limit) ? Math.min(200, Math.max(1, limit)) : 50,
      }),
      stats: TransactionalOutboxService.getOutboxStats(),
    })
  );
});

workerAdminRouter.post(
  "/outbox/:eventId/replay",
  mwAuthentication,
  mwPlatformAuthorization,
  async (req, res) => {
    try {
      const eventId = String(req.params.eventId || "").trim();
      const replayedBy = req.authUser?.email || req.authUser?.uid || "super_admin";
      const event = await TransactionalOutboxService.replayDeadLetterEvent({
        eventId,
        replayedBy,
      });
      res.json(createSuccessResponse({ event }));
    } catch (err: any) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json(createErrorResponse(err.code, err.message));
        return;
      }
      res
        .status(500)
        .json(createErrorResponse("INTERNAL_ERROR", err?.message || "Eroare la reluare outbox."));
    }
  }
);

workerAdminRouter.get("/runs", mwAuthentication, mwPlatformAuthorization, (req, res) => {
  const jobName = typeof req.query.jobName === "string" ? req.query.jobName : undefined;
  const tenantId = typeof req.query.tenantId === "string" ? req.query.tenantId : undefined;
  const limit = Number(req.query.limit || 50);

  res.json(
    createSuccessResponse({
      runs: TransactionalOutboxService.listJobRuns({
        jobName,
        tenantId,
        limit: Number.isFinite(limit) ? Math.min(200, Math.max(1, limit)) : 50,
      }),
    })
  );
});

workerAdminRouter.post(
  "/agency/market-auto-import/run",
  ...requireTenantContext,
  async (req, res) => {
    const ctx = req.tenantContext!;
    const role = ctx.role;
    if (role !== "agency_owner" && role !== "agency_admin") {
      res
        .status(403)
        .json(
          createErrorResponse(
            "FORBIDDEN",
            "Doar proprietarul sau administratorul agenției poate declanșa manual auto-importul."
          )
        );
      return;
    }

    try {
      const result = await ScrapeWorkerService.executeAgencyMarketAutoImportJob({
        tenantId: ctx.tenantId,
        triggeredBy: req.authUser?.email || req.authUser?.uid || "agency_admin",
        force: true,
      });
      res.json(createSuccessResponse(result));
    } catch (err: any) {
      res
        .status(500)
        .json(createErrorResponse("INTERNAL_ERROR", err?.message || "Eroare la rulare manuală."));
    }
  }
);
