import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  FileMigrationOptions,
  FileMigrationService,
} from "../../src/core/storage/svc_file-migration";
import { FileMigrationReport } from "../../src/core/storage/typ_storage-config";
import { CloudStorageService } from "../../src/core/storage/svc_cloud-storage";
import { StorageMetadataRepository } from "../../src/core/storage/repo_storage-metadata";
import {
  MediaPipelineService,
  PROPERTY_VARIANT_WIDTHS,
} from "../media/svc_media-pipeline";

export interface LocalMediaMigrationJobOptions extends FileMigrationOptions {
  /** Also pre-generate persistent w=400 and w=1200 WebP variants for migrated property images (default: true). */
  pregenerateWebpVariants?: boolean;
}

export interface LocalMediaMigrationJobResult {
  report: FileMigrationReport;
  variantsGenerated: number;
  variantsReusedFromStorage: number;
}

/**
 * One-time idempotent migration job that moves existing local files from `./public/uploads`
 * into Cloud Storage (preserving local files untouched), verifies SHA-256 checksums,
 * and pre-generates persistent `w=400` and `w=1200` WebP variants for migrated property photos.
 */
export async function runLocalMediaMigrationJob(
  options: LocalMediaMigrationJobOptions
): Promise<LocalMediaMigrationJobResult> {
  const report = await FileMigrationService.executeFileMigration(options);
  let variantsGenerated = 0;
  let variantsReusedFromStorage = 0;

  const shouldGenerateVariants =
    options.mode === "live" &&
    options.pregenerateWebpVariants !== false &&
    MediaPipelineService.isGcsMediaVariantsEnabled();

  if (shouldGenerateVariants) {
    for (const item of report.items) {
      if (
        (item.status !== "migrated" && item.status !== "skipped_duplicate") ||
        item.entityType !== "properties" ||
        !item.destinationObjectKey ||
        !item.resolvedTenantId
      ) {
        continue;
      }

      const meta = StorageMetadataRepository.getByObjectKeyForTenant(
        item.resolvedTenantId,
        item.destinationObjectKey
      );
      if (!meta || !meta.mimeType.startsWith("image/") || meta.mimeType.includes("svg")) {
        continue;
      }

      if (!fs.existsSync(item.localPath)) continue;
      const originalBuffer = fs.readFileSync(item.localPath);
      const variantKeys = new Set<string>(meta.variantKeys || []);

      for (const width of PROPERTY_VARIANT_WIDTHS) {
        try {
          const result = await MediaPipelineService.getOrCreatePropertyVariant({
            objectKey: meta.objectKey,
            metadata: meta,
            originalBuffer,
            targetWidth: width,
            preferWebp: true,
          });
          if (result.fromStorage) {
            variantsReusedFromStorage++;
          } else {
            variantsGenerated++;
          }
          if (result.variantKey) {
            variantKeys.add(result.variantKey);
          }
        } catch {
          // Best-effort variant pre-generation
        }
      }

      if (variantKeys.size > 0) {
        StorageMetadataRepository.saveObject({
          ...meta,
          variantKeys: Array.from(variantKeys),
          updatedAt: new Date().toISOString(),
        });
      }
    }
  }

  return {
    report,
    variantsGenerated,
    variantsReusedFromStorage,
  };
}

function parseCliArgs(argv: string[]): {
  mode: "dry_run" | "live";
  uploadsDir: string;
  defaultFallbackTenantId?: string;
  allowSingleAgencyFallback: boolean;
  executedBy: string;
} {
  const isLive = argv.includes("--live");
  const uploadsFlag = argv.find((a) => a.startsWith("--uploads-dir="));
  const tenantFlag = argv.find((a) => a.startsWith("--tenant="));
  const actorFlag = argv.find((a) => a.startsWith("--actor="));

  const defaultFallbackTenantId = tenantFlag
    ? tenantFlag.slice("--tenant=".length).trim()
    : undefined;

  return {
    mode: isLive ? "live" : "dry_run",
    uploadsDir: uploadsFlag
      ? path.resolve(uploadsFlag.slice("--uploads-dir=".length).trim())
      : path.resolve("./public/uploads"),
    defaultFallbackTenantId,
    allowSingleAgencyFallback: Boolean(defaultFallbackTenantId),
    executedBy: actorFlag
      ? actorFlag.slice("--actor=".length).trim()
      : "cli:migrate-local-media",
  };
}

const isDirectCliExecution = (() => {
  try {
    const currentFile = fileURLToPath(import.meta.url);
    return process.argv[1] && path.resolve(process.argv[1]) === path.resolve(currentFile);
  } catch {
    return false;
  }
})();

if (isDirectCliExecution) {
  const cli = parseCliArgs(process.argv.slice(2));
  console.log(
    `[Phase 5 Media Migration] Starting mode=${cli.mode} uploadsDir=${cli.uploadsDir} backend=${CloudStorageService.getActiveBackendKind()} bucket=${CloudStorageService.getBucketName()}`
  );
  runLocalMediaMigrationJob({
    mode: cli.mode,
    uploadsDir: cli.uploadsDir,
    defaultFallbackTenantId: cli.defaultFallbackTenantId,
    allowSingleAgencyFallback: cli.allowSingleAgencyFallback,
    executedBy: cli.executedBy,
    pregenerateWebpVariants: true,
  })
    .then((res) => {
      console.log(
        JSON.stringify(
          {
            migrationId: res.report.id,
            mode: res.report.mode,
            status: res.report.status,
            storageBackend: res.report.storageBackend,
            bucketName: res.report.bucketName,
            localFilesPreserved: res.report.localFilesPreserved,
            summary: res.report.summary,
            variantsGenerated: res.variantsGenerated,
            variantsReusedFromStorage: res.variantsReusedFromStorage,
          },
          null,
          2
        )
      );
      if (res.report.status !== "completed") {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error("[Phase 5 Media Migration] Failed:", err?.message || err);
      process.exit(1);
    });
}
