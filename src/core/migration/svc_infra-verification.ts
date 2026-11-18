import fs from "fs";
import path from "path";
import crypto from "crypto";
import axios from "axios";
import { PersistentStoreService } from "../database/svc_persistent-store";
import { CloudStorageService } from "../storage/svc_cloud-storage";
import { GcpAuthService } from "../gcp/svc_gcp-auth";
import { setVerifiedInfrastructureStatus } from "../env/svc_production-config";

export type InfraResourceStatus =
  | "configured"
  | "authenticated"
  | "permission_denied"
  | "unavailable"
  | "verified";

export interface InfraCheckResult {
  checkedAt: string;
  environment: string;
  firebaseProjectId: string;
  firestoreDatabaseId: string;
  storageBucket: string;
  authMethod: "service_account_json" | "adc_authorized_user" | "gcp_metadata_adc" | "none";
  credentials: {
    hasServiceAccountJson: boolean;
    hasGoogleAppCredsFile: boolean;
    useGcpMetadataAuth: boolean;
    metadataServerReachable: boolean;
    metadataServiceAccountEmail: string | null;
    metadataServiceAccountDomain: string | null;
    oauthTokenAcquired: boolean;
    storageTokenAcquired: boolean;
  };
  firestore: {
    configured: boolean;
    liveReachable: boolean;
    httpStatus: number | null;
    status: InfraResourceStatus;
    checks: {
      authenticated: boolean;
      read: boolean;
      writeProbe: boolean | null;
      readBackProbe: boolean | null;
      deleteProbe: boolean | null;
      probeDocumentPath: string | null;
    };
    details: string;
  };
  cloudStorage: {
    activeBackend: string;
    liveGcsReachable: boolean;
    httpStatus: number | null;
    status: InfraResourceStatus;
    checks: {
      authenticated: boolean;
      bucketAccess: boolean;
      uploadProbe: boolean | null;
      readBackChecksumVerified: boolean | null;
      deleteProbe: boolean | null;
      probeObjectKey: string | null;
    };
    details: string;
  };
  localStorePath: string;
  localUploadsDirFileCount: number;
  crmFileReferencesFound: {
    externalUrlsCount: number;
    uploadsRelativeCount: number;
    storageApiUrlsCount: number;
  };
  liveExecutionReady: boolean;
  blockers: string[];
}

export interface InfraVerifyOptions {
  runWriteProbes?: boolean;
  firestoreApiOrigin?: string;
  gcsApiOrigin?: string;
  overrideFirestoreToken?: string;
  overrideStorageToken?: string;
}

export class InfraVerificationService {
  private static getFirebaseTarget(): {
    projectId: string;
    databaseId: string;
    storageBucket: string;
  } {
    let projectId =
      process.env.FIREBASE_PROJECT_ID ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      "brokr-42038";
    let databaseId = process.env.FIRESTORE_DATABASE_ID || "(default)";
    let storageBucket = CloudStorageService.getBucketName();

    try {
      const cfgPath = path.resolve(process.cwd(), "firebase-applet-config.json");
      if (fs.existsSync(cfgPath)) {
        const parsed = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
        if (parsed?.projectId) projectId = parsed.projectId;
        if (parsed?.firestoreDatabaseId) databaseId = parsed.firestoreDatabaseId;
        if (parsed?.storageBucket) storageBucket = parsed.storageBucket;
      }
    } catch {
      // Fallback to env defaults
    }

    return { projectId, databaseId, storageBucket };
  }

  private static countLocalUploads(): number {
    const uploadsDir = path.resolve(process.cwd(), "public", "uploads");
    if (!fs.existsSync(uploadsDir)) return 0;
    try {
      const entries = fs.readdirSync(uploadsDir, { withFileTypes: true });
      return entries.filter((e) => e.isFile() && !e.name.startsWith(".")).length;
    } catch {
      return 0;
    }
  }

  private static scanLocalCrmFileReferences(): {
    externalUrlsCount: number;
    uploadsRelativeCount: number;
    storageApiUrlsCount: number;
  } {
    let externalUrlsCount = 0;
    let uploadsRelativeCount = 0;
    let storageApiUrlsCount = 0;

    try {
      const storePath = PersistentStoreService.getStoreFilePath();
      if (!fs.existsSync(storePath)) {
        return { externalUrlsCount, uploadsRelativeCount, storageApiUrlsCount };
      }
      const raw = fs.readFileSync(storePath, "utf8");
      const parsed = JSON.parse(raw);
      const cols: Record<string, Record<string, any>> = parsed?.collections || {};
      const inspectString = (val: string) => {
        if (val.startsWith("/uploads/")) uploadsRelativeCount++;
        else if (val.startsWith("/api/storage/")) storageApiUrlsCount++;
        else if (val.startsWith("https://") || val.startsWith("http://")) externalUrlsCount++;
      };

      for (const [colKey, docsMap] of Object.entries(cols)) {
        if (!colKey.endsWith("__leads") && !colKey.endsWith("__documents") && colKey !== "leads" && colKey !== "documents") {
          continue;
        }
        for (const doc of Object.values(docsMap || {})) {
          if (typeof doc?.fileUrl === "string") inspectString(doc.fileUrl);
          if (typeof doc?.url === "string") inspectString(doc.url);
          if (Array.isArray(doc?.photos)) {
            for (const p of doc.photos) {
              if (typeof p === "string") inspectString(p);
            }
          }
        }
      }
    } catch {
      // Non-fatal diagnostic scan
    }

    return { externalUrlsCount, uploadsRelativeCount, storageApiUrlsCount };
  }

  /**
   * Performs strictly non-destructive real verification of GCP/Firebase credentials,
   * Firestore access, and GCS access.
   * Respects USE_GCP_METADATA_AUTH strictly — NEVER queries metadata.google.internal when disabled.
   * When `runWriteProbes: true` is passed AND auth/read succeeds, creates and deletes ONLY
   * isolated temporary probe resources (`_infra_probes/probe_*`), never touching real CRM data.
   */
  public static async verifyInfrastructure(
    options?: InfraVerifyOptions
  ): Promise<InfraCheckResult> {
    const target = this.getFirebaseTarget();
    const hasServiceAccountJson = Boolean(GcpAuthService.getServiceAccountCreds());
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
    const hasGoogleAppCredsFile = Boolean(
      (credPath && fs.existsSync(credPath)) || GcpAuthService.getAdcAuthorizedUserCreds()
    );
    const useGcpMetadataAuth = GcpAuthService.isMetadataAuthEnabled();
    const authInfo = PersistentStoreService.getAuthMethodInfo();

    let metadataServerReachable = false;
    let metadataServiceAccountEmail: string | null = null;
    let metadataServiceAccountDomain: string | null = null;

    // NEVER contact GCP metadata server unless metadata auth is explicitly enabled
    if (useGcpMetadataAuth) {
      const email = await GcpAuthService.getMetadataServiceAccountEmail();
      if (email) {
        metadataServerReachable = true;
        metadataServiceAccountEmail = email;
        const parts = email.split("@");
        metadataServiceAccountDomain = parts[1] || "present";
      }
    }

    let oauthToken: string | null = options?.overrideFirestoreToken || null;
    if (!oauthToken) {
      try {
        oauthToken = await PersistentStoreService.getGoogleAccessToken();
      } catch {
        oauthToken = null;
      }
    }

    let storageToken: string | null = options?.overrideStorageToken || null;
    if (!storageToken) {
      try {
        storageToken = await CloudStorageService.getStorageAccessToken();
      } catch {
        storageToken = null;
      }
    }

    const configured =
      PersistentStoreService.isRemoteFirestoreConfigured() || Boolean(options?.overrideFirestoreToken);
    const blockers: string[] = [];

    // ------------------------------------------------------------
    // A. FIRESTORE REAL VERIFICATION
    // ------------------------------------------------------------
    const fsOrigin = (options?.firestoreApiOrigin || "https://firestore.googleapis.com").replace(/\/+$/, "");
    let fsStatus: InfraResourceStatus = configured ? "configured" : "unavailable";
    let fsHttpStatus: number | null = null;
    let fsLiveReachable = false;
    let fsDetails = configured
      ? "Credențialele sunt configurate, însă token-ul OAuth2 nu a putut fi achiziționat."
      : "Credențialele server-side Firestore (ADC / GOOGLE_APPLICATION_CREDENTIALS / FIREBASE_SERVICE_ACCOUNT_JSON) nu sunt configurate.";

    const fsChecks = {
      authenticated: Boolean(oauthToken),
      read: false,
      writeProbe: options?.runWriteProbes ? false : null,
      readBackProbe: options?.runWriteProbes ? false : null,
      deleteProbe: options?.runWriteProbes ? false : null,
      probeDocumentPath: null as string | null,
    };

    const fsProbeToken = oauthToken;

    if (fsProbeToken) {
      if (oauthToken) fsStatus = "authenticated";
      try {
        const aggUrl = `${fsOrigin}/v1/projects/${target.projectId}/databases/${target.databaseId}/documents:runAggregationQuery`;
        const res = await axios.post(
          aggUrl,
          {
            structuredAggregationQuery: {
              structuredQuery: { from: [{ collectionId: "leads" }] },
              aggregations: [{ alias: "total_count", count: {} }],
            },
          },
          { headers: { Authorization: `Bearer ${fsProbeToken}` }, timeout: 5000 }
        );
        fsHttpStatus = res.status;
        if (res.status >= 200 && res.status < 300) {
          fsChecks.read = true;
          fsLiveReachable = true;

          if (options?.runWriteProbes) {
            const probeId = `probe_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`;
            const probeRelPath = `_infra_probes/${probeId}`;
            const probeUrl = `${fsOrigin}/v1/projects/${target.projectId}/databases/${target.databaseId}/documents/${probeRelPath}`;
            fsChecks.probeDocumentPath = probeRelPath;

            const nonce = crypto.randomUUID();
            // 1. Write isolated probe doc
            const wRes = await axios.patch(
              probeUrl,
              {
                fields: {
                  probeId: { stringValue: probeId },
                  nonce: { stringValue: nonce },
                  createdAt: { stringValue: new Date().toISOString() },
                },
              },
              { headers: { Authorization: `Bearer ${fsProbeToken}` }, timeout: 5000 }
            );
            fsChecks.writeProbe = wRes.status >= 200 && wRes.status < 300;

            // 2. Read-back isolated probe doc
            const rRes = await axios.get(probeUrl, {
              headers: { Authorization: `Bearer ${fsProbeToken}` },
              timeout: 5000,
            });
            fsChecks.readBackProbe = rRes.data?.fields?.nonce?.stringValue === nonce;

            // 3. Delete ONLY the created probe doc
            const dRes = await axios.delete(probeUrl, {
              headers: { Authorization: `Bearer ${fsProbeToken}` },
              timeout: 5000,
            });
            fsChecks.deleteProbe = dRes.status >= 200 && dRes.status < 300;

            if (fsChecks.writeProbe && fsChecks.readBackProbe && fsChecks.deleteProbe && configured) {
              fsStatus = "verified";
              fsDetails = "Acces complet Firestore verificat live (citire, scriere probă izolată, recitire și curățare).";
            } else {
              fsStatus = oauthToken ? "authenticated" : "configured";
              fsDetails = "Proba completă de scriere/curățare Firestore nu a putut fi validată integral.";
            }
          } else {
            fsStatus = configured && fsChecks.authenticated ? "authenticated" : "configured";
            fsDetails = configured
              ? "Citire Firestore reușită (rulați cu ?deep=true pentru probă completă scriere/ștergere izolată)."
              : "Metadata GCP autentificat, dar USE_GCP_METADATA_AUTH/ADC nu este activat în configurare.";
          }
        }
      } catch (err: any) {
        fsHttpStatus = err?.response?.status ?? null;
        if (fsHttpStatus === 403 || fsHttpStatus === 401) {
          fsStatus = "permission_denied";
          fsDetails =
            "Identitatea GCP curentă a primit HTTP 403 Permission Denied pe baza de date Firestore a proiectului.";
        } else {
          fsStatus = "unavailable";
          fsDetails = `Eroare conexiune Firestore REST (${fsHttpStatus || err?.code || err?.message || "network"}).`;
        }
      }
    }

    if (!configured || !fsLiveReachable || (options?.runWriteProbes && fsStatus !== "verified")) {
      blockers.push(fsDetails);
    }

    // ------------------------------------------------------------
    // B. GOOGLE CLOUD STORAGE REAL VERIFICATION
    // ------------------------------------------------------------
    const activeBackend = options?.gcsApiOrigin
      ? "gcs"
      : CloudStorageService.getActiveBackendKind();
    const gcsOrigin = (
      options?.gcsApiOrigin ||
      CloudStorageService.getEmulatorHost() ||
      "https://storage.googleapis.com"
    ).replace(/\/+$/, "");

    let gcsLiveReachable = false;
    let gcsHttpStatus: number | null = null;
    let gcsStatus: InfraResourceStatus =
      activeBackend === "local_isolated" ? "unavailable" : "configured";
    let gcsDetails =
      activeBackend === "local_isolated"
        ? "Bucket-ul GCS folosește fallback local izolat deoarece lipsesc credențialele ADC/GCS sau GCS_EMULATOR_HOST."
        : "Bucket GCS configurat, așteaptă achiziția tokenului OAuth2.";

    const gcsChecks = {
      authenticated: Boolean(storageToken || activeBackend === "gcs_emulator"),
      bucketAccess: false,
      uploadProbe: options?.runWriteProbes ? false : null,
      readBackChecksumVerified: options?.runWriteProbes ? false : null,
      deleteProbe: options?.runWriteProbes ? false : null,
      probeObjectKey: null as string | null,
    };

    const gcsProbeToken = storageToken;

    if (gcsProbeToken) {
      if (storageToken || activeBackend === "gcs_emulator") {
        gcsStatus = "authenticated";
      }
      try {
        const bRes = await axios.get(
          `${gcsOrigin}/storage/v1/b/${encodeURIComponent(target.storageBucket)}`,
          { headers: { Authorization: `Bearer ${gcsProbeToken}` }, timeout: 5000 }
        );
        gcsHttpStatus = bRes.status;
        if (bRes.status === 200) {
          gcsChecks.bucketAccess = true;
          gcsLiveReachable = true;

          if (options?.runWriteProbes) {
            const probeObjKey = `_infra_probes/probe_${Date.now()}_${crypto.randomUUID().slice(0, 6)}.txt`;
            gcsChecks.probeObjectKey = probeObjKey;
            const probePayload = Buffer.from(`brokr-phase12-probe-${crypto.randomUUID()}`, "utf8");
            const expectedSha256 = crypto.createHash("sha256").update(probePayload).digest("hex");

            // 1. Upload isolated probe object
            const upRes = await axios.post(
              `${gcsOrigin}/upload/storage/v1/b/${encodeURIComponent(target.storageBucket)}/o?uploadType=media&name=${encodeURIComponent(probeObjKey)}`,
              probePayload,
              {
                headers: {
                  Authorization: `Bearer ${gcsProbeToken}`,
                  "Content-Type": "text/plain",
                },
                timeout: 8000,
              }
            );
            gcsChecks.uploadProbe = upRes.status >= 200 && upRes.status < 300;

            // 2. Read-back & checksum verification
            const dlRes = await axios.get<ArrayBuffer>(
              `${gcsOrigin}/storage/v1/b/${encodeURIComponent(target.storageBucket)}/o/${encodeURIComponent(probeObjKey)}?alt=media`,
              {
                headers: { Authorization: `Bearer ${gcsProbeToken}` },
                responseType: "arraybuffer",
                timeout: 8000,
              }
            );
            const actualSha256 = crypto
              .createHash("sha256")
              .update(Buffer.from(dlRes.data))
              .digest("hex");
            gcsChecks.readBackChecksumVerified = actualSha256 === expectedSha256;

            // 3. Delete ONLY the created probe object
            const delRes = await axios.delete(
              `${gcsOrigin}/storage/v1/b/${encodeURIComponent(target.storageBucket)}/o/${encodeURIComponent(probeObjKey)}`,
              {
                headers: { Authorization: `Bearer ${gcsProbeToken}` },
                timeout: 5000,
              }
            );
            gcsChecks.deleteProbe = delRes.status >= 200 && delRes.status < 300;

            if (
              gcsChecks.uploadProbe &&
              gcsChecks.readBackChecksumVerified &&
              gcsChecks.deleteProbe &&
              (storageToken || activeBackend === "gcs_emulator")
            ) {
              gcsStatus = "verified";
              gcsDetails = `Bucket GCS "${target.storageBucket}" verificat complet (upload, read-back, checksum SHA-256 și curățare probă).`;
            } else {
              gcsStatus = "authenticated";
              gcsDetails = `Bucket GCS "${target.storageBucket}" accesibil, dar proba completă de upload/checksum nu a trecut integral.`;
            }
          } else {
            gcsStatus = storageToken || activeBackend === "gcs_emulator" ? "authenticated" : "configured";
            gcsDetails = `Bucket GCS "${target.storageBucket}" accesibil read-only (rulați cu ?deep=true pentru upload/checksum/ștergere).`;
          }
        }
      } catch (err: any) {
        gcsHttpStatus = err?.response?.status ?? null;
        if (gcsHttpStatus === 403 || gcsHttpStatus === 401) {
          gcsStatus = "permission_denied";
          gcsDetails = `Accesul către bucket-ul GCS "${target.storageBucket}" a returnat HTTP 403 Permission Denied.`;
        } else {
          gcsStatus = "unavailable";
          gcsDetails = `Eroare verificare bucket GCS (${gcsHttpStatus || err?.code || err?.message || "network"}).`;
        }
      }
    }

    if (gcsStatus === "permission_denied" || gcsStatus === "unavailable") {
      blockers.push(gcsDetails);
    }

    const liveExecutionReady =
      configured &&
      fsLiveReachable &&
      (!options?.runWriteProbes || fsStatus === "verified");

    if (!options?.firestoreApiOrigin && !options?.gcsApiOrigin) {
      setVerifiedInfrastructureStatus({
        firestoreVerified: configured && fsLiveReachable,
        gcsVerified: gcsLiveReachable && (Boolean(storageToken) || activeBackend === "gcs_emulator"),
      });
    }

    return {
      checkedAt: new Date().toISOString(),
      environment: process.env.NODE_ENV || "development",
      firebaseProjectId: target.projectId,
      firestoreDatabaseId: target.databaseId,
      storageBucket: target.storageBucket,
      authMethod: authInfo.method,
      credentials: {
        hasServiceAccountJson,
        hasGoogleAppCredsFile,
        useGcpMetadataAuth,
        metadataServerReachable,
        metadataServiceAccountEmail,
        metadataServiceAccountDomain,
        oauthTokenAcquired: Boolean(oauthToken),
        storageTokenAcquired: Boolean(storageToken),
      },
      firestore: {
        configured,
        liveReachable: fsLiveReachable,
        httpStatus: fsHttpStatus,
        status: fsStatus,
        checks: fsChecks,
        details: fsDetails,
      },
      cloudStorage: {
        activeBackend,
        liveGcsReachable: gcsLiveReachable,
        httpStatus: gcsHttpStatus,
        status: gcsStatus,
        checks: gcsChecks,
        details: gcsDetails,
      },
      localStorePath: PersistentStoreService.getStoreFilePath(),
      localUploadsDirFileCount: this.countLocalUploads(),
      crmFileReferencesFound: this.scanLocalCrmFileReferences(),
      liveExecutionReady,
      blockers,
    };
  }
}
