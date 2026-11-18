import { MigrationStateRepository } from "../migration/repo_migration-state";
import { BackupRegistryService } from "../migration/svc_backup-registry";
import { StorageMetadataRepository } from "../storage/repo_storage-metadata";
import { PersistentStoreService } from "../database/svc_persistent-store";
import { PlatformAuditLogRepository } from "../platform/repo_platform-audit-log";

export type CrmCutoverMode = "tenant_scoped" | "legacy_rollback_standby";

export interface CutoverServiceMapping {
  serviceName: string;
  filePath: string;
  currentCollection: string;
  targetTenantPath: string;
  usesTenantContext: boolean;
  requiresFrontendRefactorBeforeCutover: boolean;
  notes: string;
}

const COL_CUTOVER_CONFIG = "platform_cutover_config";
const CUTOVER_DOC_ID = "crm_cutover_mode";

export const CRM_SERVICE_CUTOVER_MAP: CutoverServiceMapping[] = [
  {
    serviceName: "svc_lead (leads / properties / requests)",
    filePath: "src/services/svc_lead.ts",
    currentCollection: "/api/crm/leads",
    targetTenantPath: "/tenants/{tenantId}/leads",
    usesTenantContext: true,
    requiresFrontendRefactorBeforeCutover: false,
    notes: "Refactored to server-authoritative TenantContext via /api/crm/leads.",
  },
  {
    serviceName: "svc_contact (contacts / clients)",
    filePath: "src/services/svc_contact.ts",
    currentCollection: "/api/crm/contacts",
    targetTenantPath: "/tenants/{tenantId}/contacts",
    usesTenantContext: true,
    requiresFrontendRefactorBeforeCutover: false,
    notes: "Refactored to server-authoritative TenantContext via /api/crm/contacts.",
  },
  {
    serviceName: "svc_staff (staff / legacy personal alias)",
    filePath: "src/services/svc_staff.ts",
    currentCollection: "/api/crm/staff",
    targetTenantPath: "/tenants/{tenantId}/staff",
    usesTenantContext: true,
    requiresFrontendRefactorBeforeCutover: false,
    notes: "Refactored to server-authoritative TenantContext via /api/crm/staff (with legacy personal dual-read).",
  },
  {
    serviceName: "svc_document",
    filePath: "src/services/svc_document.ts",
    currentCollection: "/api/crm/documents (+ /api/storage/documents)",
    targetTenantPath: "/tenants/{tenantId}/documents",
    usesTenantContext: true,
    requiresFrontendRefactorBeforeCutover: false,
    notes: "Refactored to server-authoritative TenantContext via /api/crm/documents.",
  },
  {
    serviceName: "svc_activity (+ svc_tour)",
    filePath: "src/services/svc_activity.ts",
    currentCollection: "/api/crm/activities (+ tenant-scoped tours & viewings)",
    targetTenantPath: "/tenants/{tenantId}/activities",
    usesTenantContext: true,
    requiresFrontendRefactorBeforeCutover: false,
    notes: "Refactored to TenantContext with tenant-isolated tours/viewings mirror writes.",
  },
  {
    serviceName: "svc_viewing",
    filePath: "src/services/svc_viewing.ts",
    currentCollection: "/api/crm/viewings",
    targetTenantPath: "/tenants/{tenantId}/viewings",
    usesTenantContext: true,
    requiresFrontendRefactorBeforeCutover: false,
    notes: "Refactored to /api/crm/viewings; background sync strictly partitioned by tenantId.",
  },
  {
    serviceName: "svc_entity-id",
    filePath: "src/services/svc_entity-id.ts",
    currentCollection: "/api/crm/counters/next-id",
    targetTenantPath: "/tenants/{tenantId}/counters/entities",
    usesTenantContext: true,
    requiresFrontendRefactorBeforeCutover: false,
    notes: "Sequential IDs P/R/L/C/S/D/A generated atomically per tenantId.",
  },
  {
    serviceName: "svc_notification",
    filePath: "src/services/svc_notification.ts",
    currentCollection: "/api/crm/notifications",
    targetTenantPath: "/tenants/{tenantId}/notifications",
    usesTenantContext: true,
    requiresFrontendRefactorBeforeCutover: false,
    notes: "Scoped by verified tenantId and authenticated userId.",
  },
  {
    serviceName: "svc_native-notification",
    filePath: "src/services/svc_native-notification.ts",
    currentCollection: "/api/crm/fcm-tokens (+ tenantId partitioned)",
    targetTenantPath: "/tenants/{tenantId}/fcm_tokens",
    usesTenantContext: true,
    requiresFrontendRefactorBeforeCutover: false,
    notes: "FCM tokens registered strictly per (tenantId, userId).",
  },
  {
    serviceName: "Public Property & OG Image Server Endpoints",
    filePath: "server.ts (fetchPropertyById)",
    currentCollection: "CrmTenantStore + tenant subcollections (+ controlled legacy fallback)",
    targetTenantPath: "/tenants/{tenantId}/leads (sanitized public projection)",
    usesTenantContext: true,
    requiresFrontendRefactorBeforeCutover: false,
    notes: "Checks tenant-scoped store first and strips all private owner PII before response.",
  },
];

export interface CutoverModeState {
  mode: CrmCutoverMode;
  updatedAt: string;
  updatedBy: string;
  reason: string;
}

export class TenantCutoverService {
  public static getCutoverModeState(): CutoverModeState {
    const saved = PersistentStoreService.get<CutoverModeState>(
      COL_CUTOVER_CONFIG,
      CUTOVER_DOC_ID
    );
    if (saved) return saved;
    return {
      mode: "tenant_scoped",
      updatedAt: new Date(0).toISOString(),
      updatedBy: "system_default",
      reason: "Mod implicit tenant-scoped după refactorizarea Fazei 11 (datele root legacy conservate intact).",
    };
  }

  public static setCutoverMode(params: {
    mode: CrmCutoverMode;
    actor: string;
    reason?: string;
  }): CutoverModeState {
    const state: CutoverModeState = {
      mode: params.mode,
      updatedAt: new Date().toISOString(),
      updatedBy: params.actor,
      reason:
        (params.reason || "").trim() ||
        (params.mode === "legacy_rollback_standby"
          ? "Rollback controlat activat — rutele publice acceptă fallback pe colecțiile root conservate."
          : "Comutat în mod operațional tenant-scoped."),
    };
    PersistentStoreService.set(COL_CUTOVER_CONFIG, CUTOVER_DOC_ID, state);
    PlatformAuditLogRepository.addLog({
      action: "CRM_CUTOVER_MODE_CHANGED" as any,
      actorUserId: params.actor,
      actorEmail: params.actor,
      targetType: "migration" as any,
      targetId: CUTOVER_DOC_ID,
      details: { ...state },
      ipAddress: "127.0.0.1",
    });
    return state;
  }

  public static getCutoverReadinessReport() {
    const reports = MigrationStateRepository.listReports();
    const validations = MigrationStateRepository.listValidationReports();
    const fileReports = StorageMetadataRepository.listFileMigrationReports();
    const latestBackup = BackupRegistryService.getLatestVerifiedBackup();
    const latestLiveGcpBackup = BackupRegistryService.getLatestVerifiedBackup({
      requireLiveGcpProof: true,
    });
    const cutoverMode = this.getCutoverModeState();

    const latestLiveMigration =
      reports.find((r) => r.mode === "live" && r.status === "completed") || null;
    const latestValidation = validations[0] || null;
    const latestFileMigration =
      fileReports.find((r) => r.mode === "live" && r.status === "completed") || null;

    const pendingFrontendRefactorCount = CRM_SERVICE_CUTOVER_MAP.filter(
      (s) => s.requiresFrontendRefactorBeforeCutover && !s.usesTenantContext
    ).length;

    const blockers: string[] = [];
    if (!latestLiveGcpBackup) {
      blockers.push(
        latestBackup
          ? "Backup-ul înregistrat este doar atestat manual; lipsește dovada verificată direct în GCP (PITR / .overall_export_metadata)."
          : "Nu există un backup Firestore verificat în GCP (PITR / export GCS). Migrarea live este blocată."
      );
    }

    if (!latestLiveMigration) {
      blockers.push("Nu există nicio migrare live Firestore finalizată cu succes.");
    } else if (latestLiveMigration.sourceBackend !== "firestore_live") {
      blockers.push(
        `Ultima migrare live s-a rulat pe backend "${latestLiveMigration.sourceBackend}", nu pe Firestore live.`
      );
    }

    if (!latestValidation || !latestValidation.allPassed) {
      blockers.push("Nu există un raport de validare post-migrare 100% trecut.");
    }

    if (pendingFrontendRefactorCount > 0) {
      blockers.push(
        `${pendingFrontendRefactorCount} servicii CRM încă citesc/scriu din colecțiile root în firestore.rules.`
      );
    }

    return {
      generatedAt: new Date().toISOString(),
      safeToDisableLegacyRules: blockers.length === 0 && PersistentStoreService.isRemoteFirestoreConfigured(),
      legacyRootRulesStillRequired: true,
      cutoverMode,
      backupVerified: Boolean(latestBackup),
      liveGcpBackupVerified: Boolean(latestLiveGcpBackup),
      latestBackupId: latestBackup?.backupId || null,
      blockers,
      latestLiveMigrationId: latestLiveMigration?.id || null,
      latestValidationId: latestValidation?.validationId || null,
      latestValidationPassed: latestValidation?.allPassed || false,
      latestFileMigrationId: latestFileMigration?.id || null,
      servicesInventory: CRM_SERVICE_CUTOVER_MAP,
    };
  }
}
