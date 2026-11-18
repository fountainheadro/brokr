import { Router, Request, Response } from "express";
import { mwAuthentication } from "../middleware/mw_authentication";
import { mwPlatformAuthorization } from "../middleware/mw_platform-authorization";
import { CrmMigrationService } from "../../src/core/migration/svc_crm-migration";
import { MigrationRepository } from "../../src/core/migration/repo_migration";
import { MigrationStateRepository } from "../../src/core/migration/repo_migration-state";
import { LegacyInventoryService } from "../../src/core/migration/svc_legacy-inventory";
import { InfraVerificationService } from "../../src/core/migration/svc_infra-verification";
import { BackupRegistryService } from "../../src/core/migration/svc_backup-registry";
import { BackupVerificationService } from "../../src/core/migration/svc_backup-verification";
import { OwnershipResolutionService } from "../../src/core/migration/svc_ownership-resolution";
import {
  FirestoreRestMigrationAdapter,
  LegacyMigrationService,
} from "../../src/core/migration/svc_legacy-migration";
import { FileMigrationService } from "../../src/core/storage/svc_file-migration";
import { StorageMetadataRepository } from "../../src/core/storage/repo_storage-metadata";
import { TenantCutoverService, CrmCutoverMode } from "../../src/core/tenancy/svc_tenant-cutover";
import { PersistentStoreService } from "../../src/core/database/svc_persistent-store";
import { createSuccessResponse, createErrorResponse } from "../../src/core/api/api_response";

export const migrationRouter = Router();

// Protect all migration routes with Super Admin authorization
migrationRouter.use(mwAuthentication, mwPlatformAuthorization);

/**
 * GET /api/platform/migration/infra-status
 * Non-destructive real infrastructure & GCP/Firebase credential verification.
 */
migrationRouter.get("/infra-status", async (req: Request, res: Response) => {
  try {
    const runWriteProbes = req.query.deep === "true" || req.query.deep === "1";
    const status = await InfraVerificationService.verifyInfrastructure({ runWriteProbes });
    res.json(createSuccessResponse(status));
  } catch (err: any) {
    res.status(500).json(createErrorResponse("INTERNAL_ERROR", err?.message || String(err)));
  }
});

/**
 * GET /api/platform/migration/backup-status
 * Lists verified backups and checks whether the live migration backup gate is satisfied.
 */
migrationRouter.get("/backup-status", (_req: Request, res: Response) => {
  const latestVerified = BackupRegistryService.getLatestVerifiedBackup();
  const latestLiveGcpVerified = BackupRegistryService.getLatestVerifiedBackup({
    requireLiveGcpProof: true,
  });
  res.json(
    createSuccessResponse({
      backupVerified: Boolean(latestVerified),
      liveGcpBackupVerified: Boolean(latestLiveGcpVerified),
      latestVerified,
      latestLiveGcpVerified,
      history: BackupRegistryService.listVerifications(),
    })
  );
});

/**
 * POST /api/platform/migration/backup/verify-live
 * Verifies real Firestore PITR enablement or real GCS .overall_export_metadata directly against GCP APIs.
 * Never marks a backup live_gcp_verified from checkbox self-attestation alone.
 */
migrationRouter.post("/backup/verify-live", async (req: Request, res: Response) => {
  try {
    const actorEmail = req.authUser?.email || "superadmin@ourcrm.com";
    const {
      backupId,
      backupType,
      exportGcsUri,
      pitrTimestamp,
      restoreTestedAt,
      restoreTargetDatabase,
      notes,
    } = req.body || {};

    const result = await BackupVerificationService.verifyAndRegisterLiveBackup({
      backupId,
      backupType: backupType || "firestore_gcs_export",
      exportGcsUri,
      pitrTimestamp,
      restoreTestedAt,
      restoreTargetDatabase,
      verifiedBy: actorEmail,
      notes,
    });

    res.status(201).json(createSuccessResponse(result));
  } catch (err: any) {
    const status = err?.statusCode || 412;
    res
      .status(status)
      .json(createErrorResponse(err?.code || "VALIDATION_ERROR", err?.message || String(err)));
  }
});

/**
 * POST /api/platform/migration/backup/verify
 * Records an operator-attested backup (non-live adapters) unless GCP proof is supplied.
 */
migrationRouter.post("/backup/verify", (req: Request, res: Response) => {
  try {
    const actorEmail = req.authUser?.email || "superadmin@ourcrm.com";
    const {
      backupId,
      backupType,
      exportGcsUri,
      pitrTimestamp,
      restoreTestedAt,
      notes,
      confirmedRecoverable,
    } = req.body || {};

    const record = BackupRegistryService.registerVerifiedBackup({
      backupId,
      backupType: backupType || "firestore_gcs_export",
      exportGcsUri,
      pitrTimestamp,
      restoreTestedAt,
      verifiedBy: actorEmail,
      notes: notes || "",
      confirmedRecoverable: Boolean(confirmedRecoverable),
      verificationLevel: "operator_attested_unverified",
    });

    res.status(201).json(createSuccessResponse(record));
  } catch (err: any) {
    const status = err?.statusCode || 400;
    res
      .status(status)
      .json(createErrorResponse(err?.code || "VALIDATION_ERROR", err?.message || String(err)));
  }
});

/**
 * GET /api/platform/migration/manual-review
 * Returns unresolved/ambiguous ownership records awaiting explicit Super Admin resolution.
 */
migrationRouter.get("/manual-review", (_req: Request, res: Response) => {
  const queue = OwnershipResolutionService.getPendingManualReviews();
  res.json(createSuccessResponse(queue));
});

/**
 * POST /api/platform/migration/manual-review/assign
 * Manually assigns or holds an unresolved record without mutating source Firestore docs.
 */
migrationRouter.post("/manual-review/assign", (req: Request, res: Response) => {
  try {
    const actorEmail = req.authUser?.email || "superadmin@ourcrm.com";
    const {
      collectionName,
      recordId,
      targetTenantId,
      decision,
      reason,
      confirmed,
      migrationId,
    } = req.body || {};

    const entry = OwnershipResolutionService.assignManualOwnership({
      collectionName,
      recordId,
      targetTenantId,
      decision,
      reason,
      assignedBy: actorEmail,
      confirmed: Boolean(confirmed),
      migrationId,
    });

    res.status(201).json(createSuccessResponse(entry));
  } catch (err: any) {
    const status = err?.statusCode || 400;
    res
      .status(status)
      .json(createErrorResponse(err?.code || "VALIDATION_ERROR", err?.message || String(err)));
  }
});

/**
 * GET /api/platform/migration/cutover-mode
 */
migrationRouter.get("/cutover-mode", (_req: Request, res: Response) => {
  res.json(createSuccessResponse(TenantCutoverService.getCutoverModeState()));
});

/**
 * POST /api/platform/migration/cutover-mode
 * Switches cutover state safely (e.g., to legacy_rollback_standby without losing data).
 */
migrationRouter.post("/cutover-mode", (req: Request, res: Response) => {
  const actorEmail = req.authUser?.email || "superadmin@ourcrm.com";
  const mode = req.body?.mode as CrmCutoverMode;
  if (mode !== "tenant_scoped" && mode !== "legacy_rollback_standby") {
    res
      .status(400)
      .json(
        createErrorResponse(
          "VALIDATION_ERROR",
          "Mod invalid. Valorile permise sunt: tenant_scoped sau legacy_rollback_standby."
        )
      );
    return;
  }

  const state = TenantCutoverService.setCutoverMode({
    mode,
    actor: actorEmail,
    reason: req.body?.reason,
  });
  res.json(createSuccessResponse(state));
});

/**
 * GET /api/platform/migration/inventory
 * Returns the code-verified inventory of all legacy root collections (+ live counts if credentials exist).
 */
migrationRouter.get("/inventory", async (_req: Request, res: Response) => {
  try {
    const inventory = await LegacyInventoryService.buildInventory();
    res.json(createSuccessResponse(inventory));
  } catch (err: any) {
    res.status(500).json(createErrorResponse("INTERNAL_ERROR", err?.message || String(err)));
  }
});

/**
 * GET /api/platform/migration/cutover-readiness
 * Returns read-only cutover readiness checks and blockers before legacy rules may be disabled.
 */
migrationRouter.get("/cutover-readiness", (_req: Request, res: Response) => {
  const report = TenantCutoverService.getCutoverReadinessReport();
  res.json(createSuccessResponse(report));
});

/**
 * POST /api/platform/migration/dry-run
 */
migrationRouter.post("/dry-run", async (req: Request, res: Response) => {
  try {
    const {
      targetTenantId,
      collectionsToMigrate,
      useLiveFirestore,
      strictOwnershipRequired,
      allowSingleAgencyFallback,
    } = req.body || {};
    const actorEmail = req.authUser?.email || "superadmin@ourcrm.com";

    const report = await CrmMigrationService.executeMigration({
      targetTenantId,
      mode: "dry_run",
      executedBy: actorEmail,
      collectionsToMigrate,
      useLiveFirestore,
      strictOwnershipRequired,
      allowSingleAgencyFallback,
    });

    res.json(createSuccessResponse(report));
  } catch (err: any) {
    const status = err?.statusCode || 500;
    res.status(status).json(createErrorResponse(err?.code || "INTERNAL_ERROR", err?.message || String(err)));
  }
});

/**
 * POST /api/platform/migration/execute
 * Executes live, idempotent, non-destructive migration into the target tenant.
 * Strictly blocked if running against live Firestore without a verified recoverable backup.
 */
migrationRouter.post("/execute", async (req: Request, res: Response) => {
  try {
    const {
      targetTenantId,
      collectionsToMigrate,
      useLiveFirestore,
      strictOwnershipRequired,
      allowSingleAgencyFallback,
    } = req.body || {};
    const actorEmail = req.authUser?.email || "superadmin@ourcrm.com";

    const isTargetingLiveFirestore =
      useLiveFirestore !== false && PersistentStoreService.isRemoteFirestoreConfigured();

    if (isTargetingLiveFirestore) {
      BackupRegistryService.assertBackupVerifiedForLiveMigration({
        requireLiveGcpProof: true,
      });
    }

    const report = await CrmMigrationService.executeMigration({
      targetTenantId,
      mode: "live",
      executedBy: actorEmail,
      collectionsToMigrate,
      useLiveFirestore,
      strictOwnershipRequired,
      allowSingleAgencyFallback,
    });

    res.json(createSuccessResponse(report));
  } catch (err: any) {
    const status = err?.statusCode || 500;
    res.status(status).json(createErrorResponse(err?.code || "INTERNAL_ERROR", err?.message || String(err)));
  }
});

/**
 * POST /api/platform/migration/resume/:id
 */
migrationRouter.post("/resume/:id", async (req: Request, res: Response) => {
  try {
    const checkpoint = MigrationStateRepository.getCheckpoint(req.params.id);
    if (!checkpoint) {
      res.status(404).json(createErrorResponse("NOT_FOUND", "Checkpoint-ul de migrare nu a fost găsit."));
      return;
    }
    if (!PersistentStoreService.isRemoteFirestoreConfigured()) {
      res.status(400).json(
        createErrorResponse(
          "VALIDATION_ERROR",
          "Reluarea migrării live necesită credențiale server-side Firestore configurate."
        )
      );
      return;
    }

    if (checkpoint.mode === "live") {
      BackupRegistryService.assertBackupVerifiedForLiveMigration({
        requireLiveGcpProof: true,
      });
    }

    const actorEmail = req.authUser?.email || checkpoint.executedBy;
    const report = await LegacyMigrationService.executeMigration({
      adapter: new FirestoreRestMigrationAdapter(),
      targetTenantId: checkpoint.targetTenantId,
      mode: checkpoint.mode,
      executedBy: actorEmail,
      collectionsToMigrate: checkpoint.collectionsOrder,
      resumeMigrationId: checkpoint.migrationId,
    });

    res.json(createSuccessResponse(report));
  } catch (err: any) {
    const status = err?.statusCode || 500;
    res.status(status).json(createErrorResponse(err?.code || "INTERNAL_ERROR", err?.message || String(err)));
  }
});

/**
 * POST /api/platform/migration/validate
 */
migrationRouter.post("/validate", async (req: Request, res: Response) => {
  try {
    if (!PersistentStoreService.isRemoteFirestoreConfigured()) {
      res.status(400).json(
        createErrorResponse(
          "VALIDATION_ERROR",
          "Validarea live necesită credențiale server-side Firestore configurate."
        )
      );
      return;
    }

    const targetTenantIds =
      Array.isArray(req.body?.targetTenantIds) && req.body.targetTenantIds.length > 0
        ? req.body.targetTenantIds
        : [req.body?.targetTenantId || "ten_brokr_default"];

    const report = await LegacyMigrationService.validateMigrationIntegrity({
      adapter: new FirestoreRestMigrationAdapter(),
      targetTenantIds,
      collections: req.body?.collectionsToMigrate,
      migrationId: req.body?.migrationId,
      defaultFallbackTenantId: targetTenantIds[0],
      allowSingleAgencyFallback: Boolean(req.body?.allowSingleAgencyFallback),
    });

    res.json(createSuccessResponse(report));
  } catch (err: any) {
    const status = err?.statusCode || 500;
    res.status(status).json(createErrorResponse(err?.code || "INTERNAL_ERROR", err?.message || String(err)));
  }
});

/**
 * GET /api/platform/migration/checkpoints
 */
migrationRouter.get("/checkpoints", (_req: Request, res: Response) => {
  res.json(createSuccessResponse(MigrationStateRepository.listCheckpoints()));
});

/**
 * POST /api/platform/migration/files/dry-run
 */
migrationRouter.post("/files/dry-run", async (req: Request, res: Response) => {
  try {
    const actorEmail = req.authUser?.email || "superadmin@ourcrm.com";
    const report = await FileMigrationService.executeFileMigration({
      mode: "dry_run",
      executedBy: actorEmail,
      defaultFallbackTenantId: req.body?.targetTenantId,
      allowSingleAgencyFallback: Boolean(req.body?.allowSingleAgencyFallback),
    });
    res.json(createSuccessResponse(report));
  } catch (err: any) {
    res.status(500).json(createErrorResponse("INTERNAL_ERROR", err?.message || String(err)));
  }
});

/**
 * POST /api/platform/migration/files/execute
 */
migrationRouter.post("/files/execute", async (req: Request, res: Response) => {
  try {
    const actorEmail = req.authUser?.email || "superadmin@ourcrm.com";
    const report = await FileMigrationService.executeFileMigration({
      mode: "live",
      executedBy: actorEmail,
      defaultFallbackTenantId: req.body?.targetTenantId,
      allowSingleAgencyFallback: Boolean(req.body?.allowSingleAgencyFallback),
      updateReferences: Boolean(req.body?.updateReferences),
    });
    res.json(createSuccessResponse(report));
  } catch (err: any) {
    res.status(500).json(createErrorResponse("INTERNAL_ERROR", err?.message || String(err)));
  }
});

/**
 * GET /api/platform/migration/files/history
 */
migrationRouter.get("/files/history", (_req: Request, res: Response) => {
  res.json(createSuccessResponse(StorageMetadataRepository.listFileMigrationReports()));
});

/**
 * GET /api/platform/migration/history
 */
migrationRouter.get("/history", (_req: Request, res: Response) => {
  const reports = MigrationRepository.listReports();
  res.json(createSuccessResponse(reports));
});

/**
 * GET /api/platform/migration/history/:id
 */
migrationRouter.get("/history/:id", (req: Request, res: Response) => {
  const report = MigrationRepository.getReportById(req.params.id);
  if (!report) {
    res.status(404).json(createErrorResponse("NOT_FOUND", "Raportul de migrare nu a fost găsit."));
    return;
  }
  res.json(createSuccessResponse(report));
});
