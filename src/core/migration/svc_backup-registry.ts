import crypto from "crypto";
import { PersistentStoreService } from "../database/svc_persistent-store";
import { PlatformAuditLogRepository } from "../platform/repo_platform-audit-log";
import { AppError } from "../errors/app_error";

export type BackupVerificationType =
  | "firestore_pitr"
  | "firestore_gcs_export"
  | "manual_verified_snapshot";

export type BackupVerificationLevel =
  | "live_gcp_verified"
  | "gcs_emulator_verified"
  | "operator_attested_unverified";

export interface BackupVerificationRecord {
  backupId: string;
  backupType: BackupVerificationType;
  projectId: string;
  databaseId: string;
  exportGcsUri?: string;
  pitrTimestamp?: string;
  restoreTestedAt?: string;
  verifiedAt: string;
  verifiedBy: string;
  notes: string;
  verificationLevel: BackupVerificationLevel;
  liveVerificationEvidence?: Record<string, any>;
  status: "verified" | "invalidated";
}

const COL_BACKUP_VERIFICATIONS = "migration_backup_verifications";

/**
 * Backup verification registry and mandatory pre-live-migration gate.
 * Prevents any live Firestore migration unless a recoverable backup (PITR or GCS export)
 * has been explicitly verified and recorded with audit provenance.
 */
export class BackupRegistryService {
  public static listVerifications(): BackupVerificationRecord[] {
    const all = PersistentStoreService.getAll<BackupVerificationRecord>(
      COL_BACKUP_VERIFICATIONS
    );
    return Object.values(all).sort(
      (a, b) => new Date(b.verifiedAt).getTime() - new Date(a.verifiedAt).getTime()
    );
  }

  public static getLatestVerifiedBackup(options?: {
    requireLiveGcpProof?: boolean;
  }): BackupVerificationRecord | null {
    const verified = this.listVerifications().filter((b) => b.status === "verified");
    if (options?.requireLiveGcpProof) {
      return verified.find((b) => b.verificationLevel === "live_gcp_verified") || null;
    }
    return verified[0] || null;
  }

  public static registerVerifiedBackup(params: {
    backupId?: string;
    backupType: BackupVerificationType;
    projectId?: string;
    databaseId?: string;
    exportGcsUri?: string;
    pitrTimestamp?: string;
    restoreTestedAt?: string;
    verifiedBy: string;
    notes: string;
    confirmedRecoverable: boolean;
    verificationLevel?: BackupVerificationLevel;
    liveVerificationEvidence?: Record<string, any>;
  }): BackupVerificationRecord {
    if (!params.confirmedRecoverable) {
      throw new AppError({
        message: "Confirmarea explicită a recuperabilității backup-ului este obligatorie.",
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    }

    if (params.backupType === "firestore_gcs_export" && !params.exportGcsUri?.startsWith("gs://")) {
      throw new AppError({
        message: "Pentru backup de tip GCS export este necesar un URI valid gs://...",
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    }

    if (params.backupType === "firestore_pitr" && !params.pitrTimestamp) {
      throw new AppError({
        message: "Pentru PITR este necesar timestamp-ul validat de recuperare.",
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    }

    const verificationLevel: BackupVerificationLevel =
      params.verificationLevel || "operator_attested_unverified";

    const record: BackupVerificationRecord = {
      backupId: params.backupId?.trim() || `bkp_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`,
      backupType: params.backupType,
      projectId: params.projectId || process.env.FIREBASE_PROJECT_ID || "brokr-42038",
      databaseId:
        params.databaseId ||
        process.env.FIRESTORE_DATABASE_ID ||
        "ai-studio-e7371a1e-cd74-432c-b244-a7eb8aa7f434",
      exportGcsUri: params.exportGcsUri?.trim() || undefined,
      pitrTimestamp: params.pitrTimestamp?.trim() || undefined,
      restoreTestedAt: params.restoreTestedAt?.trim() || undefined,
      verifiedAt: new Date().toISOString(),
      verifiedBy: params.verifiedBy,
      notes: (params.notes || "").trim() || "Backup verificat pentru pregătirea migrării.",
      verificationLevel,
      liveVerificationEvidence: params.liveVerificationEvidence,
      status: "verified",
    };

    PersistentStoreService.set(COL_BACKUP_VERIFICATIONS, record.backupId, record);

    PlatformAuditLogRepository.addLog({
      action: "BACKUP_VERIFICATION_RECORDED" as any,
      actorUserId: params.verifiedBy,
      actorEmail: params.verifiedBy,
      targetType: "migration" as any,
      targetId: record.backupId,
      details: {
        backupType: record.backupType,
        verificationLevel: record.verificationLevel,
        exportGcsUri: record.exportGcsUri,
        pitrTimestamp: record.pitrTimestamp,
        projectId: record.projectId,
        databaseId: record.databaseId,
      },
      ipAddress: "127.0.0.1",
    });

    return record;
  }

  public static invalidateBackup(backupId: string, actor: string): void {
    const existing = PersistentStoreService.get<BackupVerificationRecord>(
      COL_BACKUP_VERIFICATIONS,
      backupId
    );
    if (!existing) return;
    existing.status = "invalidated";
    PersistentStoreService.set(COL_BACKUP_VERIFICATIONS, backupId, existing);
    PlatformAuditLogRepository.addLog({
      action: "BACKUP_VERIFICATION_INVALIDATED" as any,
      actorUserId: actor,
      actorEmail: actor,
      targetType: "migration" as any,
      targetId: backupId,
      details: {},
      ipAddress: "127.0.0.1",
    });
  }

  /**
   * Blocks live execution unless a verified recoverable backup is recorded.
   * When `requireLiveGcpProof` is true (live Firestore runs), operator-attested records
   * without verified GCP metadata (`overall_export_metadata` or active PITR) are strictly rejected.
   */
  public static assertBackupVerifiedForLiveMigration(options?: {
    requireLiveGcpProof?: boolean;
  }): BackupVerificationRecord {
    const latest = this.getLatestVerifiedBackup(options);
    if (!latest) {
      throw new AppError({
        message: options?.requireLiveGcpProof
          ? "Migrarea live este blocată: nu există niciun backup cu dovadă verificată direct în GCP (Firestore PITR activ sau export .overall_export_metadata în GCS). Simpla bifare manuală nu este suficientă."
          : "Migrarea live este blocată: nu există niciun backup recuperabil verificat (Firestore PITR sau export GCS). Verificați și înregistrați mai întâi backup-ul.",
        code: "VALIDATION_ERROR",
        statusCode: 412,
      });
    }
    return latest;
  }

  public static clearAll(): void {
    PersistentStoreService.clearCollection(COL_BACKUP_VERIFICATIONS);
  }
}
