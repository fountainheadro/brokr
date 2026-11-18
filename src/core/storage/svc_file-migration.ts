import fs from "fs";
import path from "path";
import crypto from "crypto";
import { CloudStorageService } from "./svc_cloud-storage";
import { StorageMetadataRepository } from "./repo_storage-metadata";
import {
  FileMigrationItemResult,
  FileMigrationReport,
  StorageEntityType,
  StorageVisibility,
} from "./typ_storage-config";
import { TenantResolutionService } from "../tenancy/svc_tenant-resolution";

export interface FileReferenceRecord {
  collectionName: "leads" | "documents" | "other";
  recordId: string;
  tenantId?: string | null;
  propertyId?: string;
  fileUrls: string[];
  updateUrlCallback?: (oldUrl: string, newUrl: string, objectKey: string) => void;
}

export interface FileMigrationOptions {
  mode: "dry_run" | "live";
  executedBy: string;
  uploadsDir?: string;
  referenceRecords?: FileReferenceRecord[];
  defaultFallbackTenantId?: string;
  allowSingleAgencyFallback?: boolean;
  updateReferences?: boolean;
  maxRetries?: number;
  baseRetryDelayMs?: number;
  /** Optional test hook to inject transient failure on specific filename */
  onBeforeUpload?: (fileName: string, attempt: number) => void | Promise<void>;
}

function getExtMimeGuess(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".pdf") return "application/pdf";
  return "application/octet-stream";
}

/**
 * Safely migrates local files under /uploads into tenant-scoped Cloud Storage folders.
 * Guarantees:
 * - Local files are ALWAYS preserved untouched (never deleted).
 * - Files without unambiguous tenant ownership are flagged for manual review (never guessed).
 * - Checksum (SHA-256) and byte length are verified via read-back after upload.
 * - Reference updates happen ONLY after verification succeeds AND when explicitly requested.
 */
export class FileMigrationService {
  public static async executeFileMigration(
    options: FileMigrationOptions
  ): Promise<FileMigrationReport> {
    const migrationId = `fmig_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`;
    const startedAt = new Date().toISOString();
    const uploadsDir = path.resolve(options.uploadsDir || "./public/uploads");
    const maxRetries = Math.max(0, options.maxRetries ?? 2);
    const baseRetryDelayMs = Math.max(0, options.baseRetryDelayMs ?? 10);

    const filesOnDisk: string[] = [];
    if (fs.existsSync(uploadsDir)) {
      const entries = fs.readdirSync(uploadsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && !entry.name.startsWith(".")) {
          filesOnDisk.push(entry.name);
        }
      }
    }

    const refs = options.referenceRecords || [];
    const refsByFileName = new Map<string, FileReferenceRecord[]>();
    for (const r of refs) {
      for (const rawUrl of r.fileUrls) {
        const cleanUrl = rawUrl.split("?")[0];
        if (cleanUrl.startsWith("/uploads/")) {
          const fname = path.basename(cleanUrl);
          const arr = refsByFileName.get(fname) || [];
          arr.push(r);
          refsByFileName.set(fname, arr);
        }
      }
    }

    const items: FileMigrationItemResult[] = [];
    const referenceUpdates: FileMigrationReport["referenceUpdates"] = [];
    const attemptCounter = new Map<string, number>();

    let migratedCount = 0;
    let skippedDuplicatesCount = 0;
    let manualReviewCount = 0;
    let failedCount = 0;
    let checksumVerifiedCount = 0;

    for (const fileName of filesOnDisk) {
      const fullPath = path.join(uploadsDir, fileName);
      const buffer = fs.readFileSync(fullPath);
      const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
      const localRelativeUrl = `/uploads/${fileName}`;

      const matchingRefs = refsByFileName.get(fileName) || [];
      const candidateTenants = new Set<string>();
      for (const m of matchingRefs) {
        if (m.tenantId && TenantResolutionService.getTenantById(m.tenantId)) {
          candidateTenants.add(m.tenantId);
        }
      }

      let resolvedTenantId: string | undefined;
      let reason: string | undefined;

      if (candidateTenants.size > 1) {
        manualReviewCount++;
        items.push({
          localFileName: fileName,
          localRelativeUrl,
          localPath: fullPath,
          sizeBytes: buffer.length,
          sha256,
          status: "manual_review",
          reason: `ambiguous_multi_tenant_references:${Array.from(candidateTenants).join(",")}`,
        });
        continue;
      } else if (candidateTenants.size === 1) {
        [resolvedTenantId] = Array.from(candidateTenants);
      } else if (
        options.allowSingleAgencyFallback &&
        options.defaultFallbackTenantId &&
        TenantResolutionService.getTenantById(options.defaultFallbackTenantId)
      ) {
        resolvedTenantId = options.defaultFallbackTenantId;
        reason = "verified_initial_single_agency_tenant";
      } else {
        manualReviewCount++;
        items.push({
          localFileName: fileName,
          localRelativeUrl,
          localPath: fullPath,
          sizeBytes: buffer.length,
          sha256,
          status: "manual_review",
          reason:
            matchingRefs.length === 0
              ? "orphan_unreferenced_local_file"
              : "missing_explicit_tenant_on_referencing_record",
        });
        continue;
      }

      const primaryRef = matchingRefs[0];
      const entityType: StorageEntityType =
        primaryRef?.collectionName === "documents" ? "documents" : "properties";
      const entityId =
        primaryRef?.propertyId || primaryRef?.recordId || "unlinked";
      const visibility: StorageVisibility =
        entityType === "documents" ? "private" : "public_listing";

      const destinationObjectKey = CloudStorageService.buildTenantObjectKey({
        tenantId: resolvedTenantId,
        entityType,
        entityId,
        fileName,
      });

      const existingMeta = StorageMetadataRepository.getByObjectKeyForTenant(
        resolvedTenantId,
        destinationObjectKey
      );

      if (
        existingMeta &&
        existingMeta.sha256 === sha256 &&
        existingMeta.sizeBytes === buffer.length
      ) {
        skippedDuplicatesCount++;
        checksumVerifiedCount++;
        items.push({
          localFileName: fileName,
          localRelativeUrl,
          localPath: fullPath,
          sizeBytes: buffer.length,
          sha256,
          status: "skipped_duplicate",
          resolvedTenantId,
          entityType,
          entityId,
          visibility,
          destinationObjectKey,
          destinationUrl:
            existingMeta.publicUrl ||
            `/api/storage/documents/download?key=${encodeURIComponent(destinationObjectKey)}`,
          checksumVerified: true,
        });
        continue;
      }

      if (options.mode === "dry_run") {
        items.push({
          localFileName: fileName,
          localRelativeUrl,
          localPath: fullPath,
          sizeBytes: buffer.length,
          sha256,
          status: "pending",
          resolvedTenantId,
          entityType,
          entityId,
          visibility,
          destinationObjectKey,
          destinationUrl:
            visibility === "public_listing"
              ? `/api/storage/media/${destinationObjectKey}`
              : `/api/storage/documents/download?key=${encodeURIComponent(destinationObjectKey)}`,
          reason,
        });
        continue;
      }

      // Live upload with bounded retry + checksum readback verification
      try {
        let uploadedMeta: any = null;
        let lastErr: any = null;
        for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
          const prev = (attemptCounter.get(fileName) || 0) + 1;
          attemptCounter.set(fileName, prev);
          try {
            if (options.onBeforeUpload) {
              await options.onBeforeUpload(fileName, attempt);
            }
            uploadedMeta = await CloudStorageService.uploadObject({
              tenantId: resolvedTenantId,
              entityType,
              entityId,
              fileName,
              buffer,
              declaredMimeType: getExtMimeGuess(fileName),
              visibility,
              uploadedByUserId: options.executedBy,
              isImageOnly: entityType === "properties",
            });
            lastErr = null;
            break;
          } catch (err: any) {
            lastErr = err;
            if (attempt <= maxRetries && baseRetryDelayMs > 0) {
              await new Promise((r) =>
                setTimeout(r, baseRetryDelayMs * Math.pow(2, attempt - 1))
              );
            }
          }
        }
        if (lastErr || !uploadedMeta) {
          throw lastErr || new Error("Upload eșuat fără detalii.");
        }

        // Read back object to verify byte count & SHA-256 checksum
        const downloaded = await CloudStorageService.downloadObject({
          objectKey: uploadedMeta.objectKey,
          tenantId: resolvedTenantId,
        });
        const destSha = crypto
          .createHash("sha256")
          .update(downloaded.buffer)
          .digest("hex");

        const checksumOk =
          destSha === sha256 && downloaded.buffer.length === buffer.length;
        if (!checksumOk) {
          throw new Error(
            `Checksum mismatch după upload pentru ${fileName}: expected=${sha256}, actual=${destSha}`
          );
        }

        migratedCount++;
        checksumVerifiedCount++;
        const destUrl =
          uploadedMeta.publicUrl ||
          `/api/storage/documents/download?key=${encodeURIComponent(
            uploadedMeta.objectKey
          )}`;

        if (options.updateReferences && matchingRefs.length > 0) {
          for (const ref of matchingRefs) {
            if (ref.updateUrlCallback) {
              ref.updateUrlCallback(localRelativeUrl, destUrl, uploadedMeta.objectKey);
            }
            referenceUpdates.push({
              collectionName: ref.collectionName,
              recordId: ref.recordId,
              oldUrl: localRelativeUrl,
              newUrl: destUrl,
              newObjectKey: uploadedMeta.objectKey,
              updated: Boolean(ref.updateUrlCallback),
            });
          }
        }

        items.push({
          localFileName: fileName,
          localRelativeUrl,
          localPath: fullPath,
          sizeBytes: buffer.length,
          sha256,
          status: "migrated",
          resolvedTenantId,
          entityType,
          entityId,
          visibility,
          destinationObjectKey: uploadedMeta.objectKey,
          destinationUrl: destUrl,
          checksumVerified: true,
        });
      } catch (err: any) {
        failedCount++;
        items.push({
          localFileName: fileName,
          localRelativeUrl,
          localPath: fullPath,
          sizeBytes: buffer.length,
          sha256,
          status: "failed",
          resolvedTenantId,
          entityType,
          entityId,
          visibility,
          destinationObjectKey,
          checksumVerified: false,
          error: err?.message || String(err),
        });
      }
    }

    const report: FileMigrationReport = {
      id: migrationId,
      mode: options.mode,
      status: failedCount === 0 ? "completed" : "failed",
      startedAt,
      completedAt: new Date().toISOString(),
      executedBy: options.executedBy,
      uploadsDir,
      storageBackend: CloudStorageService.getActiveBackendKind(),
      bucketName: CloudStorageService.getBucketName(),
      localFilesPreserved: true,
      referencesUpdated: Boolean(options.updateReferences && referenceUpdates.some((u) => u.updated)),
      summary: {
        totalFilesFound: filesOnDisk.length,
        migratedCount,
        skippedDuplicatesCount,
        manualReviewCount,
        failedCount,
        checksumVerifiedCount,
      },
      items,
      referenceUpdates,
    };

    StorageMetadataRepository.saveFileMigrationReport(report);
    return report;
  }
}
