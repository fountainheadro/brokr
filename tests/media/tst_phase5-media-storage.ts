/**
 * Phase 5 Verification Suite: Media & Storage Optimization (Cloud Storage Without Premature CDN)
 *
 * Verifies:
 * 1. Content-hashed property photo upload + pre-generated w=400 & w=1200 WebP variants in GCS emulator
 *    with ZERO writes to ./public/uploads and 0 repeated transforms after RAM cache clear.
 * 2. Persistent OpenGraph 1200x630 baseline JPEG (< 260KB) & protected public share gallery variants
 *    survive simulated cold restarts with 0 repeated ImageMagick/Jimp transforms.
 * 3. Production local-disk write guard blocks fallback writes when NODE_ENV=production without GCS.
 * 4. Strict private vs. public access & Cache-Control separation (private, no-store + 403 vs immutable).
 * 5. Single CDN-ready URL builder (`MEDIA_CDN_BASE_URL`) + `USE_GCS_MEDIA_VARIANTS=false` rollback flag.
 * 6. Idempotent local media migration job (`job_migrate-local-media.ts`) & dry-run orphan sweep report.
 */
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import express from "express";
import axios from "axios";
import { Jimp } from "jimp";
import { PersistentStoreService } from "../../src/core/database/svc_persistent-store";
import { CloudStorageService } from "../../src/core/storage/svc_cloud-storage";
import { StorageMetadataRepository } from "../../src/core/storage/repo_storage-metadata";
import { storageRouter } from "../../server/storage/rtr_storage";
import {
  CACHE_CONTROL_PRIVATE,
  CACHE_CONTROL_PUBLIC_IMMUTABLE,
  MediaPipelineService,
} from "../../server/media/svc_media-pipeline";
import {
  applyPublicImageProtections,
  clearProtectedMemoryCacheForTests,
  getPersistedProtectedPublicImage,
} from "../../server/security/sec_public-media";
import { clearAllThumbnailCache } from "../../server/utils/img_thumbnail";
import { runLocalMediaMigrationJob } from "../../server/migration/job_migrate-local-media";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    console.log(`✅ [PASS] ${label}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

async function createTestPngBuffer(width = 640, height = 420): Promise<Buffer> {
  const img = new Jimp({ width, height, color: 0x1e3a8aff });
  // Draw simple deterministic gradient/blocks so JPEG/WebP compression is realistic
  for (let y = 0; y < height; y += 20) {
    for (let x = 0; x < width; x += 20) {
      const color = ((x + y) / 20) % 2 === 0 ? 0x3b82f6ff : 0xf8fafcff;
      img.setPixelColor(color, x, y);
    }
  }
  return img.getBuffer("image/png");
}

const VALID_PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");

async function startGcsEmulator(): Promise<{
  server: http.Server;
  host: string;
  objects: Map<string, { data: Buffer; contentType: string; cacheControl?: string }>;
}> {
  const objects = new Map<string, { data: Buffer; contentType: string; cacheControl?: string }>();
  const emuApp = express();
  emuApp.use(express.raw({ type: "*/*", limit: "25mb" }));

  emuApp.post("/upload/storage/v1/b/:bucket/o", (req, res) => {
    const name = String(req.query.name || "");
    const key = `${req.params.bucket}/${name}`;
    objects.set(key, {
      data: Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || ""),
      contentType: String(req.headers["content-type"] || "application/octet-stream"),
      cacheControl:
        typeof req.headers["cache-control"] === "string"
          ? req.headers["cache-control"]
          : undefined,
    });
    res.status(200).json({ name, bucket: req.params.bucket });
  });

  emuApp.get("/storage/v1/b/:bucket/o/:object", (req, res) => {
    const key = `${req.params.bucket}/${decodeURIComponent(req.params.object)}`;
    const found = objects.get(key);
    if (!found) {
      res.status(404).json({ error: { code: 404, message: "Not Found" } });
      return;
    }
    res.setHeader("Content-Type", found.contentType);
    if (found.cacheControl) {
      res.setHeader("Cache-Control", found.cacheControl);
    }
    res.send(found.data);
  });

  emuApp.delete("/storage/v1/b/:bucket/o/:object", (req, res) => {
    const key = `${req.params.bucket}/${decodeURIComponent(req.params.object)}`;
    objects.delete(key);
    res.status(204).end();
  });

  const server = http.createServer(emuApp);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as any).port;
  return { server, host: `http://127.0.0.1:${port}`, objects };
}

async function runPhase5Tests() {
  console.log("=================================================================");
  console.log("🧪 FAZA 5: MEDIA & STORAGE OPTIMIZATION VERIFICATION SUITE");
  console.log("=================================================================");

  const suffix = `${process.pid}_${Date.now()}`;
  process.env.PERSISTENT_STORE_PATH = path.join(os.tmpdir(), `brokr-phase5-store-${suffix}.json`);
  process.env.STORAGE_LOCAL_ROOT = path.join(os.tmpdir(), `brokr-phase5-local-${suffix}`);
  process.env.STORAGE_SIGNING_SECRET = "phase5-test-stable-signing-secret-0123456789";
  process.env.GCS_BUCKET_NAME = "brokr-phase5-test-bucket";
  delete process.env.MEDIA_CDN_BASE_URL;
  process.env.USE_GCS_MEDIA_VARIANTS = "true";

  const tempUploadsDir = path.join(os.tmpdir(), `brokr-phase5-uploads-${suffix}`);
  fs.mkdirSync(tempUploadsDir, { recursive: true });

  PersistentStoreService.clearAll();
  StorageMetadataRepository.clearAll();
  MediaPipelineService.resetTransformCountersForTests();
  MediaPipelineService.clearInMemoryMediaCachesForTests();
  clearAllThumbnailCache();
  clearProtectedMemoryCacheForTests();

  const emu = await startGcsEmulator();
  process.env.GCS_EMULATOR_HOST = emu.host;

  const app = express();
  app.use(express.json({ limit: "20mb" }));
  app.use("/api/storage", storageRouter);
  const apiServer = http.createServer(app);
  await new Promise<void>((resolve) => apiServer.listen(0, "127.0.0.1", resolve));
  const apiPort = (apiServer.address() as any).port;

  const samplePng = await createTestPngBuffer(640, 420);
  const publicUploadsPath = path.resolve("./public/uploads");
  const uploadsBefore = fs.existsSync(publicUploadsPath)
    ? new Set(fs.readdirSync(publicUploadsPath))
    : new Set<string>();

  let uploadedObjectKey = "";
  let uploadedPublicUrl = "";

  try {
    // ------------------------------------------------------------------
    // TEST 1: Content-hashed upload + WebP variants in GCS emulator, 0 local writes,
    // and 0 repeated transforms after simulated cold restart
    // ------------------------------------------------------------------
    const stored = await MediaPipelineService.storePropertyPhotoWithVariants({
      tenantId: "ten_agency_a",
      propertyId: "P5001",
      buffer: samplePng,
      mimeType: "image/png",
      ext: "png",
      originalFileName: "living-room.png",
      uploadedByUserId: "usr_p5_owner",
    });

    uploadedObjectKey = stored.metadata.objectKey;
    uploadedPublicUrl = stored.url;

    const uploadsAfter = fs.existsSync(publicUploadsPath)
      ? fs.readdirSync(publicUploadsPath).filter((f) => !uploadsBefore.has(f))
      : [];

    const hasOriginalInGcs = emu.objects.has(
      `brokr-phase5-test-bucket/${stored.metadata.objectKey}`
    );
    const w400Key = stored.variants.w400?.objectKey || "";
    const w1200Key = stored.variants.w1200?.objectKey || "";
    const hasW400InGcs = Boolean(w400Key && emu.objects.has(`brokr-phase5-test-bucket/${w400Key}`));
    const hasW1200InGcs = Boolean(
      w1200Key && emu.objects.has(`brokr-phase5-test-bucket/${w1200Key}`)
    );

    // Simulate cold container restart: wipe RAM caches and reset transform counters
    clearAllThumbnailCache();
    MediaPipelineService.clearInMemoryMediaCachesForTests();
    MediaPipelineService.resetTransformCountersForTests();

    const variantRes = await axios.get(
      `http://127.0.0.1:${apiPort}${stored.url}?w=400`,
      {
        headers: { Accept: "image/webp,image/*,*/*;q=0.8" },
        responseType: "arraybuffer",
        validateStatus: () => true,
      }
    );
    const countersAfterVariantRead = MediaPipelineService.getTransformCounters();

    assert(
      stored.metadata.backend === "gcs_emulator" &&
        CloudStorageService.isContentHashedFileName(stored.metadata.fileName) &&
        hasOriginalInGcs &&
        hasW400InGcs &&
        hasW1200InGcs &&
        uploadsAfter.length === 0 &&
        variantRes.status === 200 &&
        variantRes.headers["cache-control"] === CACHE_CONTROL_PUBLIC_IMMUTABLE &&
        variantRes.headers["x-media-variant-cache"] === "HIT" &&
        countersAfterVariantRead.propertyVariantTransforms === 0 &&
        countersAfterVariantRead.storageVariantHits === 1,
      "TEST 1: Upload property photo persistă original + variante w=400 & w=1200 în GCS cu 0 scrieri în ./public/uploads și 0 transformări după restart",
      `backend=${stored.metadata.backend} uploadsNew=${uploadsAfter.length} status=${variantRes.status} cache=${variantRes.headers["cache-control"]} hit=${variantRes.headers["x-media-variant-cache"]} transforms=${countersAfterVariantRead.propertyVariantTransforms}`
    );

    // ------------------------------------------------------------------
    // TEST 2: Persistent OG 1200x630 baseline JPEG (< 260KB) & public share gallery
    // survive cold restart with 0 repeated transforms
    // ------------------------------------------------------------------
    MediaPipelineService.resetTransformCountersForTests();
    MediaPipelineService.clearInMemoryMediaCachesForTests();
    clearProtectedMemoryCacheForTests();
    clearAllThumbnailCache();

    const ogFirst = await MediaPipelineService.getOrBuildPersistedOgImage({
      shareCode: "P5001",
      versionKey: "v100abcd",
      preferredTenantId: null,
      loadCandidateBuffers: async () => [samplePng],
    });
    const isJpeg =
      Boolean(ogFirst?.buffer) &&
      ogFirst!.buffer.length > 100 &&
      ogFirst!.buffer.length < 260_000 &&
      ogFirst!.buffer[0] === 0xff &&
      ogFirst!.buffer[1] === 0xd8 &&
      ogFirst!.buffer[2] === 0xff;

    const protectedFirst = await applyPublicImageProtections(samplePng, {
      cacheKey: stored.url,
      propertyCode: "P5001",
      viewerStamp: "TEST-VIEWER",
      maxWidth: 1200,
      preferWebp: true,
    });

    // Simulate cold restart: clear ALL in-memory caches & reset counters
    MediaPipelineService.clearInMemoryMediaCachesForTests();
    clearProtectedMemoryCacheForTests();
    clearAllThumbnailCache();
    MediaPipelineService.resetTransformCountersForTests();

    let loaderCalledAfterRestart = 0;
    const ogAfterRestart = await MediaPipelineService.getOrBuildPersistedOgImage({
      shareCode: "P5001",
      versionKey: "v100abcd",
      preferredTenantId: null,
      loadCandidateBuffers: async () => {
        loaderCalledAfterRestart++;
        return [samplePng];
      },
    });

    const ogRouteRes = await axios.get(
      `http://127.0.0.1:${apiPort}/api/storage/public-shares/P5001/${path.basename(
        ogFirst!.objectKey
      )}`,
      { responseType: "arraybuffer", validateStatus: () => true }
    );

    const protectedAfterRestart = await getPersistedProtectedPublicImage({
      cacheKey: stored.url,
      propertyCode: "P5001",
      maxWidth: 1200,
      preferWebp: true,
    });
    const countersAfterColdRestart = MediaPipelineService.getTransformCounters();

    assert(
      isJpeg &&
        ogFirst?.fromStorage === false &&
        ogAfterRestart?.fromStorage === true &&
        loaderCalledAfterRestart === 0 &&
        Buffer.compare(ogFirst!.buffer, ogAfterRestart!.buffer) === 0 &&
        ogRouteRes.status === 200 &&
        ogRouteRes.headers["cache-control"] === CACHE_CONTROL_PUBLIC_IMMUTABLE &&
        protectedFirst.buffer.length > 0 &&
        protectedAfterRestart?.fromStorage === true &&
        Buffer.compare(protectedFirst.buffer, protectedAfterRestart!.buffer) === 0 &&
        countersAfterColdRestart.ogTransforms === 0 &&
        countersAfterColdRestart.publicShareVariantTransforms === 0 &&
        countersAfterColdRestart.storageOgHits === 1 &&
        countersAfterColdRestart.storagePublicShareHits === 1,
      "TEST 2: OG JPEG (1200x630 < 260KB) și galeria publică persistă în GCS cu 0 transformări repetate după restart la rece",
      `isJpeg=${isJpeg} ogFromStorage=${ogAfterRestart?.fromStorage} loaderCalls=${loaderCalledAfterRestart} ogTransforms=${countersAfterColdRestart.ogTransforms} pubTransforms=${countersAfterColdRestart.publicShareVariantTransforms}`
    );

    // ------------------------------------------------------------------
    // TEST 3: Production local-disk write guard blocks fallback writes in production
    // ------------------------------------------------------------------
    const prevNodeEnv = process.env.NODE_ENV;
    const prevEmuHost = process.env.GCS_EMULATOR_HOST;
    const prevAllowLocal = process.env.ALLOW_LOCAL_STORAGE_IN_PRODUCTION;
    const prevSaJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const prevGac = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const prevMetaAuth = process.env.USE_GCP_METADATA_AUTH;

    let uploadBlockedStatus = 0;
    let rawBlockedStatus = 0;
    let prodLocalFallbackAllowed = true;
    try {
      process.env.NODE_ENV = "production";
      delete process.env.GCS_EMULATOR_HOST;
      delete process.env.ALLOW_LOCAL_STORAGE_IN_PRODUCTION;
      delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
      process.env.USE_GCP_METADATA_AUTH = "false";

      prodLocalFallbackAllowed = CloudStorageService.isLocalFallbackAllowed();

      try {
        await CloudStorageService.uploadObject({
          tenantId: "ten_agency_a",
          entityType: "properties",
          entityId: "P999",
          fileName: "blocked.png",
          buffer: samplePng,
          declaredMimeType: "image/png",
          visibility: "public_listing",
          uploadedByUserId: "usr_p5_owner",
          isImageOnly: true,
        });
      } catch (err: any) {
        uploadBlockedStatus = err?.statusCode || 0;
      }

      try {
        await CloudStorageService.putRawObject({
          objectKey: "public/shares/P999/og_test1234.jpg",
          buffer: samplePng,
          mimeType: "image/jpeg",
        });
      } catch (err: any) {
        rawBlockedStatus = err?.statusCode || 0;
      }
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
      if (prevEmuHost) process.env.GCS_EMULATOR_HOST = prevEmuHost;
      if (prevAllowLocal !== undefined) process.env.ALLOW_LOCAL_STORAGE_IN_PRODUCTION = prevAllowLocal;
      else delete process.env.ALLOW_LOCAL_STORAGE_IN_PRODUCTION;
      if (prevSaJson !== undefined) process.env.FIREBASE_SERVICE_ACCOUNT_JSON = prevSaJson;
      if (prevGac !== undefined) process.env.GOOGLE_APPLICATION_CREDENTIALS = prevGac;
      if (prevMetaAuth !== undefined) process.env.USE_GCP_METADATA_AUTH = prevMetaAuth;
      else delete process.env.USE_GCP_METADATA_AUTH;
    }

    assert(
      prodLocalFallbackAllowed === false &&
        uploadBlockedStatus === 503 &&
        rawBlockedStatus === 503,
      "TEST 3: În producție fără GCS configurat, fallback-ul pe disc local este blocat (503 CONFIGURATION_ERROR)",
      `allowed=${prodLocalFallbackAllowed} uploadStatus=${uploadBlockedStatus} rawStatus=${rawBlockedStatus}`
    );

    // ------------------------------------------------------------------
    // TEST 4: Private vs. Public access & Cache-Control separation
    // ------------------------------------------------------------------
    const privateDoc = await CloudStorageService.uploadObject({
      tenantId: "ten_agency_a",
      entityType: "documents",
      entityId: "D100",
      fileName: "contract-inchiriere.pdf",
      buffer: VALID_PDF,
      declaredMimeType: "application/pdf",
      visibility: "private",
      uploadedByUserId: "usr_p5_owner",
    });
    const signedPrivate = CloudStorageService.generateSignedDownloadUrl({
      tenantId: "ten_agency_a",
      objectKey: privateDoc.objectKey,
      ttlSeconds: 300,
    });

    const publicDocBypass = await axios.get(
      `http://127.0.0.1:${apiPort}/api/storage/media/${privateDoc.objectKey}`,
      { validateStatus: () => true }
    );
    const unsignedPrivateRes = await axios.get(
      `http://127.0.0.1:${apiPort}/api/storage/signed?key=${encodeURIComponent(
        privateDoc.objectKey
      )}&tenantId=ten_agency_a&exp=9999999999&sig=tampered`,
      { validateStatus: () => true }
    );
    const signedPrivateRes = await axios.get(
      `http://127.0.0.1:${apiPort}${signedPrivate.url}`,
      { responseType: "arraybuffer", validateStatus: () => true }
    );
    const publicOriginalRes = await axios.get(
      `http://127.0.0.1:${apiPort}${uploadedPublicUrl}`,
      { responseType: "arraybuffer", validateStatus: () => true }
    );

    assert(
      publicDocBypass.status === 403 &&
        unsignedPrivateRes.status === 403 &&
        signedPrivateRes.status === 200 &&
        signedPrivateRes.headers["cache-control"] === CACHE_CONTROL_PRIVATE &&
        signedPrivateRes.headers["x-content-type-options"] === "nosniff" &&
        publicOriginalRes.status === 200 &&
        publicOriginalRes.headers["cache-control"] === CACHE_CONTROL_PUBLIC_IMMUTABLE,
      "TEST 4: Separare strictă privat vs public (403 fără token + private, no-store vs public immutable pe media hash-uită)",
      `bypass=${publicDocBypass.status} unsigned=${unsignedPrivateRes.status} privCC=${signedPrivateRes.headers["cache-control"]} pubCC=${publicOriginalRes.headers["cache-control"]}`
    );

    // ------------------------------------------------------------------
    // TEST 5: Single CDN URL builder & USE_GCS_MEDIA_VARIANTS=false rollback flag
    // ------------------------------------------------------------------
    delete process.env.MEDIA_CDN_BASE_URL;
    const stageAUrl = MediaPipelineService.buildMediaUrl("/api/storage/media/test/img.webp");
    process.env.MEDIA_CDN_BASE_URL = "https://media.highline.ro/";
    const stageBUrl = MediaPipelineService.buildMediaUrl("/api/storage/media/test/img.webp");
    delete process.env.MEDIA_CDN_BASE_URL;

    process.env.USE_GCS_MEDIA_VARIANTS = "false";
    const flagDisabled = MediaPipelineService.isGcsMediaVariantsEnabled() === false;
    const rollbackUpload = await MediaPipelineService.storePropertyPhotoWithVariants({
      tenantId: "ten_agency_a",
      propertyId: "P5002",
      buffer: samplePng,
      mimeType: "image/png",
      ext: "png",
      originalFileName: "rollback-check.png",
      uploadedByUserId: "usr_p5_owner",
    });
    const oldVariantStillPreserved = Boolean(
      w400Key && emu.objects.has(`brokr-phase5-test-bucket/${w400Key}`)
    );
    process.env.USE_GCS_MEDIA_VARIANTS = "true";

    assert(
      stageAUrl === "/api/storage/media/test/img.webp" &&
        stageBUrl === "https://media.highline.ro/api/storage/media/test/img.webp" &&
        flagDisabled &&
        Object.keys(rollbackUpload.variants).length === 0 &&
        oldVariantStillPreserved,
      "TEST 5: URL builder unic suportă switch 1-env-var pentru Cloud CDN și flag-ul USE_GCS_MEDIA_VARIANTS=false revine curat fără a șterge obiectele existente"
    );

    // ------------------------------------------------------------------
    // TEST 6: Idempotent local media migration job & dry-run orphan sweep report
    // ------------------------------------------------------------------
    const migImgPath = path.join(tempUploadsDir, "legacy_p600.png");
    const migOrphanPath = path.join(tempUploadsDir, "legacy_unlinked.png");
    fs.writeFileSync(migImgPath, samplePng);
    fs.writeFileSync(migOrphanPath, samplePng);

    const migRefs = [
      {
        collectionName: "leads" as const,
        recordId: "lead_p600",
        tenantId: "ten_agency_a",
        propertyId: "P600",
        fileUrls: ["/uploads/legacy_p600.png"],
      },
    ];

    const dryRun = await runLocalMediaMigrationJob({
      mode: "dry_run",
      executedBy: "test-runner",
      uploadsDir: tempUploadsDir,
      referenceRecords: migRefs,
    });

    const liveRun1 = await runLocalMediaMigrationJob({
      mode: "live",
      executedBy: "test-runner",
      uploadsDir: tempUploadsDir,
      referenceRecords: migRefs,
    });

    const liveRun2 = await runLocalMediaMigrationJob({
      mode: "live",
      executedBy: "test-runner",
      uploadsDir: tempUploadsDir,
      referenceRecords: migRefs,
    });

    // Orphan sweep dry-run: reference only uploadedObjectKey & privateDoc, leaving P5002 & P600 as orphan candidates
    const orphanReport = MediaPipelineService.buildOrphanMediaSweepReport({
      tenantId: "ten_agency_a",
      referencedUrls: [uploadedPublicUrl, privateDoc.objectKey],
    });

    assert(
      dryRun.report.summary.migratedCount === 0 &&
        dryRun.report.summary.manualReviewCount === 1 &&
        liveRun1.report.summary.migratedCount === 1 &&
        liveRun1.report.summary.checksumVerifiedCount === 1 &&
        liveRun1.variantsGenerated === 2 &&
        liveRun2.report.summary.skippedDuplicatesCount === 1 &&
        liveRun2.variantsGenerated === 0 &&
        liveRun2.variantsReusedFromStorage === 2 &&
        fs.existsSync(migImgPath) &&
        fs.existsSync(migOrphanPath) &&
        orphanReport.dryRun === true &&
        orphanReport.referencedCount === 2 &&
        orphanReport.orphanCount >= 2 &&
        orphanReport.orphanTotalBytes > 0,
      "TEST 6: Job-ul idempotent de migrare media locală + pre-generare WebP și raportul dry-run de obiecte orfane funcționează corect",
      `live1Mig=${liveRun1.report.summary.migratedCount} live1Var=${liveRun1.variantsGenerated} live2Skip=${liveRun2.report.summary.skippedDuplicatesCount} live2Reuse=${liveRun2.variantsReusedFromStorage} orphans=${orphanReport.orphanCount}`
    );
  } finally {
    delete process.env.GCS_EMULATOR_HOST;
    await new Promise<void>((r) => apiServer.close(() => r()));
    await new Promise<void>((r) => emu.server.close(() => r()));
    try {
      if (fs.existsSync(process.env.PERSISTENT_STORE_PATH!)) {
        fs.unlinkSync(process.env.PERSISTENT_STORE_PATH!);
      }
      fs.rmSync(process.env.STORAGE_LOCAL_ROOT!, { recursive: true, force: true });
      fs.rmSync(tempUploadsDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }

  console.log("=================================================================");
  console.log(
    `📊 REZUMAT TESTE FAZA 5 (MEDIA & STORAGE): Total: ${passed + failed} | Reușite: ${passed} | Eșuate: ${failed}`
  );
  console.log("=================================================================");

  if (failed > 0) process.exit(1);
}

runPhase5Tests().catch((err) => {
  console.error("Eroare critică în testele Fazei 5:", err);
  process.exit(1);
});
