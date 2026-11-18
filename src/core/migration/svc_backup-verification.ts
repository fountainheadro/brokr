import axios from "axios";
import { PersistentStoreService } from "../database/svc_persistent-store";
import { CloudStorageService } from "../storage/svc_cloud-storage";
import { AppError } from "../errors/app_error";
import { BackupRegistryService, BackupVerificationRecord, BackupVerificationType } from "./svc_backup-registry";

export interface LiveBackupEvidence {
  checkedAt: string;
  verifiedAgainstGcp: boolean;
  verificationLevel: "live_gcp_verified" | "gcs_emulator_verified" | "operator_attested_unverified";
  pitrEnabled: boolean | null;
  earliestVersionTime?: string | null;
  exportMetadataFound: boolean | null;
  exportObjectCount: number | null;
  exportTotalBytes: number | null;
  restoreTestedAt?: string;
  restoreTargetDatabase?: string;
  blockers: string[];
}

function parseGsUri(uri: string): { bucket: string; prefix: string } | null {
  const match = uri.trim().match(/^gs:\/\/([^/]+)(?:\/(.*))?$/);
  if (!match) return null;
  return {
    bucket: match[1],
    prefix: (match[2] || "").replace(/^\/+|\/+$/g, ""),
  };
}

/**
 * Verifies real recoverability of Firestore PITR or GCS Export backups directly
 * against GCP Firestore Admin REST API and Cloud Storage JSON API.
 * Never marks a live backup as verified based solely on an operator checkbox.
 */
export class BackupVerificationService {
  public static async verifyLiveBackupEvidence(params: {
    backupType: BackupVerificationType;
    projectId?: string;
    databaseId?: string;
    exportGcsUri?: string;
    pitrTimestamp?: string;
    restoreTestedAt?: string;
    restoreTargetDatabase?: string;
    firestoreApiOrigin?: string;
    gcsApiOrigin?: string;
    overrideFirestoreToken?: string;
    overrideStorageToken?: string;
  }): Promise<LiveBackupEvidence> {
    const projectId = params.projectId || process.env.FIREBASE_PROJECT_ID || "brokr-42038";
    const databaseId =
      params.databaseId ||
      process.env.FIRESTORE_DATABASE_ID ||
      "ai-studio-e7371a1e-cd74-432c-b244-a7eb8aa7f434";
    const fsOrigin = (params.firestoreApiOrigin || "https://firestore.googleapis.com").replace(/\/+$/, "");
    const gcsOrigin = (
      params.gcsApiOrigin ||
      CloudStorageService.getEmulatorHost() ||
      "https://storage.googleapis.com"
    ).replace(/\/+$/, "");
    const isEmulator = Boolean(CloudStorageService.getEmulatorHost()) && !params.gcsApiOrigin;

    const blockers: string[] = [];
    let pitrEnabled: boolean | null = null;
    let earliestVersionTime: string | null = null;
    let exportMetadataFound: boolean | null = null;
    let exportObjectCount: number | null = null;
    let exportTotalBytes: number | null = null;

    if (params.backupType === "firestore_pitr") {
      const token = params.overrideFirestoreToken || (await PersistentStoreService.getGoogleAccessToken());
      if (!token) {
        blockers.push("Lipsesc credențialele OAuth2 Firestore pentru verificarea PITR în GCP.");
      } else {
        try {
          const dbUrl = `${fsOrigin}/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}`;
          const res = await axios.get<any>(dbUrl, {
            headers: { Authorization: `Bearer ${token}` },
            timeout: 8000,
          });
          pitrEnabled =
            res.data?.pointInTimeRecoveryEnablement === "POINT_IN_TIME_RECOVERY_ENABLED";
          earliestVersionTime = res.data?.earliestVersionTime || null;

          if (!pitrEnabled) {
            blockers.push(
              `Point-In-Time Recovery (PITR) NU este activat pe baza de date "${databaseId}" (status: ${res.data?.pointInTimeRecoveryEnablement || "UNKNOWN"}).`
            );
          } else if (params.pitrTimestamp && earliestVersionTime) {
            const reqMs = Date.parse(params.pitrTimestamp);
            const earliestMs = Date.parse(earliestVersionTime);
            if (!Number.isNaN(reqMs) && !Number.isNaN(earliestMs) && reqMs < earliestMs) {
              blockers.push(
                `Timestamp-ul PITR (${params.pitrTimestamp}) este anterior limitei minime de recuperare (${earliestVersionTime}).`
              );
            }
          }
        } catch (err: any) {
          const code = err?.response?.status || err?.code || "error";
          blockers.push(`Verificarea live a stării PITR în GCP Firestore a eșuat (${code}).`);
        }
      }
    } else if (params.backupType === "firestore_gcs_export") {
      const parsed = params.exportGcsUri ? parseGsUri(params.exportGcsUri) : null;
      if (!parsed) {
        blockers.push("URI export GCS invalid; este necesar formatul gs://<bucket>/<export-prefix>.");
      } else {
        const token = params.overrideStorageToken || (await CloudStorageService.getStorageAccessToken());
        if (!token) {
          blockers.push("Lipsesc credențialele OAuth2 GCS pentru verificarea existenței exportului în bucket.");
        } else {
          try {
            const listUrl = `${gcsOrigin}/storage/v1/b/${encodeURIComponent(parsed.bucket)}/o`;
            const listRes = await axios.get<{ items?: Array<{ name: string; size?: string }> }>(
              listUrl,
              {
                headers: { Authorization: `Bearer ${token}` },
                params: parsed.prefix ? { prefix: parsed.prefix } : undefined,
                timeout: 8000,
              }
            );
            const items = Array.isArray(listRes.data?.items) ? listRes.data.items : [];
            exportObjectCount = items.length;
            exportTotalBytes = items.reduce((acc, obj) => acc + Number(obj.size || 0), 0);
            exportMetadataFound = items.some((obj) =>
              obj.name.endsWith(".overall_export_metadata")
            );

            if (items.length === 0) {
              blockers.push(`Nu s-a găsit niciun obiect în GCS sub "${params.exportGcsUri}".`);
            } else if (!exportMetadataFound) {
              blockers.push(
                `Lipsește fișierul de manifest ".overall_export_metadata" în "${params.exportGcsUri}" — exportul pare incomplet sau nu aparține Firestore.`
              );
            }
          } catch (err: any) {
            const code = err?.response?.status || err?.code || "error";
            blockers.push(`Verificarea exportului în bucket-ul GCS "${parsed.bucket}" a eșuat (${code}).`);
          }
        }
      }
    } else {
      blockers.push(
        "Tipul de backup manual nu poate fi verificat automat împotriva GCP; folosiți PITR sau Export GCS."
      );
    }

    const verifiedAgainstGcp = blockers.length === 0;
    const verificationLevel: LiveBackupEvidence["verificationLevel"] = verifiedAgainstGcp
      ? isEmulator
        ? "gcs_emulator_verified"
        : "live_gcp_verified"
      : "operator_attested_unverified";

    return {
      checkedAt: new Date().toISOString(),
      verifiedAgainstGcp,
      verificationLevel,
      pitrEnabled,
      earliestVersionTime,
      exportMetadataFound,
      exportObjectCount,
      exportTotalBytes,
      restoreTestedAt: params.restoreTestedAt,
      restoreTargetDatabase: params.restoreTargetDatabase,
      blockers,
    };
  }

  /**
   * Probes GCP live AND registers the backup ONLY if server-side verification succeeds.
   */
  public static async verifyAndRegisterLiveBackup(params: {
    backupId?: string;
    backupType: BackupVerificationType;
    projectId?: string;
    databaseId?: string;
    exportGcsUri?: string;
    pitrTimestamp?: string;
    restoreTestedAt?: string;
    restoreTargetDatabase?: string;
    verifiedBy: string;
    notes?: string;
    firestoreApiOrigin?: string;
    gcsApiOrigin?: string;
    overrideFirestoreToken?: string;
    overrideStorageToken?: string;
  }): Promise<{ record: BackupVerificationRecord; evidence: LiveBackupEvidence }> {
    const evidence = await this.verifyLiveBackupEvidence(params);

    if (!evidence.verifiedAgainstGcp) {
      throw new AppError({
        message: `Verificarea reală a backup-ului a eșuat: ${evidence.blockers.join(" ")}`,
        code: "VALIDATION_ERROR",
        statusCode: 412,
      });
    }

    const record = BackupRegistryService.registerVerifiedBackup({
      backupId: params.backupId,
      backupType: params.backupType,
      projectId: params.projectId,
      databaseId: params.databaseId,
      exportGcsUri: params.exportGcsUri,
      pitrTimestamp: params.pitrTimestamp,
      restoreTestedAt: params.restoreTestedAt,
      verifiedBy: params.verifiedBy,
      notes:
        params.notes ||
        `Verificat automat prin API GCP (${evidence.verificationLevel}).`,
      confirmedRecoverable: true,
      verificationLevel: evidence.verificationLevel,
      liveVerificationEvidence: evidence,
    });

    return { record, evidence };
  }
}
