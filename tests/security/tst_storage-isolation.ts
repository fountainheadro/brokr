import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import express from "express";
import axios from "axios";

const runStamp = `${process.pid}-${Date.now()}`;
process.env.NODE_ENV = "test";
process.env.PERSISTENT_STORE_PATH = path.join(os.tmpdir(), `brokr-phase10-stor-${runStamp}.json`);
process.env.STORAGE_LOCAL_ROOT = path.join(os.tmpdir(), `brokr-phase10-objs-${runStamp}`);
process.env.STORAGE_SIGNING_SECRET = "phase10_test_signing_secret_0123456789abcdef";

import { PersistentStoreService } from "../../src/core/database/svc_persistent-store";
import { CloudStorageService } from "../../src/core/storage/svc_cloud-storage";
import { StorageMetadataRepository } from "../../src/core/storage/repo_storage-metadata";
import { FileMigrationService } from "../../src/core/storage/svc_file-migration";
import { TenantCutoverService } from "../../src/core/tenancy/svc_tenant-cutover";
import { storageRouter } from "../../server/storage/rtr_storage";

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`✅ [PASS] ${message}`);
    testsPassed++;
  } else {
    console.error(`❌ [FAIL] ${message}`);
    testsFailed++;
  }
}

const VALID_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
  "hex"
);
const VALID_PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n", "utf8");
const FAKE_HTML_DISGUISED = Buffer.from("<!doctype html><html><script>alert(1)</script></html>", "utf8");

async function runPhase10StorageTests() {
  console.log("=================================================================");
  console.log("🧪 TESTE FAZA 10 (PARTEA 2): CLOUD STORAGE & IZOLARE TENANT");
  console.log("=================================================================");

  PersistentStoreService.clearAll();
  StorageMetadataRepository.clearAll();

  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use("/api/storage", storageRouter);

  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}/api/storage`;

  const tempUploadsDir = path.join(os.tmpdir(), `brokr-phase10-uploads-${runStamp}`);
  fs.mkdirSync(tempUploadsDir, { recursive: true });

  // ------------------------------------------------------------------
  // TEST 1: File payload & path traversal validation
  // ------------------------------------------------------------------
  try {
    let rejectedDisguisedHtml = false;
    try {
      CloudStorageService.validateFilePayload({
        buffer: FAKE_HTML_DISGUISED,
        fileName: "innocent.png",
        isImageOnly: false,
      });
    } catch {
      rejectedDisguisedHtml = true;
    }

    let rejectedTraversal = false;
    try {
      CloudStorageService.buildTenantObjectKey({
        tenantId: "ten_agency_a",
        entityType: "documents",
        entityId: "../ten_agency_b",
        fileName: "secret.pdf",
      });
    } catch {
      rejectedTraversal = true;
    }

    let rejectedForbiddenExt = false;
    try {
      CloudStorageService.buildTenantObjectKey({
        tenantId: "ten_agency_a",
        entityType: "documents",
        entityId: "D1",
        fileName: "payload.html",
      });
    } catch {
      rejectedForbiddenExt = true;
    }

    assert(
      rejectedDisguisedHtml && rejectedTraversal && rejectedForbiddenExt,
      "TEST 1: Magic-bytes respinge HTML mascat ca imagine, extensii periculoase (.html) și path traversal ('..')"
    );
  } catch (err: any) {
    assert(false, `TEST 1 Eșuat: ${err?.message}`);
  }

  // ------------------------------------------------------------------
  // TEST 2: HTTP Endpoint isolation (401 unauthenticated, 403 cross-tenant & spoofed tenantId)
  // ------------------------------------------------------------------
  try {
    const uploadRes = await axios.post(
      `${baseUrl}/documents/upload`,
      {
        fileName: "contract_alpha.pdf",
        documentId: "D101",
        dataUrl: `data:application/pdf;base64,${VALID_PDF.toString("base64")}`,
      },
      {
        headers: {
          Authorization: "Bearer token_usr_alpha_owner",
          "x-tenant-override": "agency-a",
        },
        validateStatus: () => true,
      }
    );

    const objectKey = uploadRes.data?.data?.metadata?.objectKey;
    const signedUrlPath = uploadRes.data?.data?.signedUrl;

    const spoofRes = await axios.post(
      `${baseUrl}/documents/upload`,
      {
        tenantId: "ten_agency_b",
        fileName: "spoof.pdf",
        dataUrl: `data:application/pdf;base64,${VALID_PDF.toString("base64")}`,
      },
      {
        headers: {
          Authorization: "Bearer token_usr_alpha_owner",
          "x-tenant-override": "agency-a",
        },
        validateStatus: () => true,
      }
    );

    const unauthDl = await axios.get(
      `${baseUrl}/documents/download?key=${encodeURIComponent(objectKey)}`,
      { validateStatus: () => true }
    );

    const crossTenantDl = await axios.get(
      `${baseUrl}/documents/download?key=${encodeURIComponent(objectKey)}`,
      {
        headers: {
          Authorization: "Bearer token_usr_beta_owner",
          "x-tenant-override": "agency-b",
        },
        validateStatus: () => true,
      }
    );

    const crossTenantDel = await axios.delete(
      `${baseUrl}/documents?key=${encodeURIComponent(objectKey)}`,
      {
        headers: {
          Authorization: "Bearer token_usr_beta_owner",
          "x-tenant-override": "agency-b",
        },
        validateStatus: () => true,
      }
    );

    const authDl = await axios.get(
      `${baseUrl}/documents/download?key=${encodeURIComponent(objectKey)}`,
      {
        headers: {
          Authorization: "Bearer token_usr_alpha_owner",
          "x-tenant-override": "agency-a",
        },
        responseType: "arraybuffer",
        validateStatus: () => true,
      }
    );

    const signedRes = await axios.get(`http://127.0.0.1:${port}${signedUrlPath}`, {
      responseType: "arraybuffer",
      validateStatus: () => true,
    });
    const tamperedSigRes = await axios.get(
      `http://127.0.0.1:${port}${signedUrlPath.slice(0, -4)}0000`,
      { validateStatus: () => true }
    );

    const privateViaMedia = await axios.get(`${baseUrl}/media/${objectKey}`, {
      validateStatus: () => true,
    });

    assert(
      uploadRes.status === 201 &&
        objectKey === "tenants/ten_agency_a/documents/D101/contract_alpha.pdf" &&
        spoofRes.status === 403 &&
        unauthDl.status === 401 &&
        crossTenantDl.status === 403 &&
        crossTenantDel.status === 403 &&
        authDl.status === 200 &&
        Buffer.from(authDl.data).equals(VALID_PDF) &&
        signedRes.status === 200 &&
        tamperedSigRes.status === 403 &&
        privateViaMedia.status === 403,
      "TEST 2: Izolare strictă HTTP per tenant (401 neautentificat, 403 cross-tenant/spoofing, signed URL valid & anti-tamper)"
    );
  } catch (err: any) {
    assert(false, `TEST 2 Eșuat: ${err?.message}`);
  }

  // ------------------------------------------------------------------
  // TEST 3: Public listing photo visibility & GCS JSON Emulator upload/download/delete
  // ------------------------------------------------------------------
  let emulatorServer: http.Server | null = null;
  try {
    const emulatorStore = new Map<string, { body: Buffer; contentType: string }>();
    const emuApp = express();
    emuApp.post("/upload/storage/v1/b/:bucket/o", express.raw({ type: "*/*", limit: "10mb" }), (req, res) => {
      const name = String(req.query.name || "");
      emulatorStore.set(`${req.params.bucket}/${name}`, {
        body: Buffer.from(req.body),
        contentType: String(req.headers["content-type"] || "application/octet-stream"),
      });
      res.status(200).json({ name, bucket: req.params.bucket, size: String(req.body.length) });
    });
    emuApp.get("/storage/v1/b/:bucket/o/:objectKey", (req, res) => {
      const item = emulatorStore.get(`${req.params.bucket}/${req.params.objectKey}`);
      if (!item) return res.status(404).end();
      res.setHeader("Content-Type", item.contentType);
      res.send(item.body);
    });
    emuApp.delete("/storage/v1/b/:bucket/o/:objectKey", (req, res) => {
      emulatorStore.delete(`${req.params.bucket}/${req.params.objectKey}`);
      res.status(204).end();
    });

    emulatorServer = await new Promise<http.Server>((resolve) => {
      const s = emuApp.listen(0, "127.0.0.1", () => resolve(s));
    });
    const emuPort = (emulatorServer.address() as any).port;
    process.env.GCS_EMULATOR_HOST = `http://127.0.0.1:${emuPort}`;

    const meta = await CloudStorageService.uploadObject({
      tenantId: "ten_agency_a",
      entityType: "properties",
      entityId: "P5500",
      fileName: "living.png",
      buffer: VALID_PNG,
      declaredMimeType: "image/png",
      visibility: "public_listing",
      uploadedByUserId: "usr_alpha_owner",
      isImageOnly: true,
    });

    const publicMediaRes = await axios.get(`http://127.0.0.1:${port}${meta.publicUrl}`, {
      responseType: "arraybuffer",
      validateStatus: () => true,
    });

    await CloudStorageService.deleteObject({
      tenantId: "ten_agency_a",
      objectKey: meta.objectKey,
    });

    const afterDeleteRes = await axios.get(`http://127.0.0.1:${port}${meta.publicUrl}`, {
      validateStatus: () => true,
    });

    assert(
      meta.backend === "gcs_emulator" &&
        meta.objectKey === "tenants/ten_agency_a/properties/P5500/living.png" &&
        publicMediaRes.status === 200 &&
        publicMediaRes.headers["x-content-type-options"] === "nosniff" &&
        Buffer.from(publicMediaRes.data).equals(VALID_PNG) &&
        afterDeleteRes.status === 404,
      "TEST 3: Protocol GCS JSON (emulator) funcționează complet (upload public listing + livrare /media + ștergere)"
    );
  } catch (err: any) {
    assert(false, `TEST 3 Eșuat: ${err?.message}`);
  } finally {
    delete process.env.GCS_EMULATOR_HOST;
    if (emulatorServer) {
      await new Promise<void>((r) => emulatorServer!.close(() => r()));
    }
  }

  // ------------------------------------------------------------------
  // TEST 4: Local /uploads File Migration with SHA-256 verification, retries & preservation
  // ------------------------------------------------------------------
  try {
    const imgPath = path.join(tempUploadsDir, "prop_test_1.png");
    const docPath = path.join(tempUploadsDir, "doc_test_1.pdf");
    const orphanPath = path.join(tempUploadsDir, "orphan_unknown.png");
    fs.writeFileSync(imgPath, VALID_PNG);
    fs.writeFileSync(docPath, VALID_PDF);
    fs.writeFileSync(orphanPath, VALID_PNG);

    let updatedLeadUrl = "";
    const refs = [
      {
        collectionName: "leads" as const,
        recordId: "lead_x1",
        tenantId: "ten_agency_a",
        propertyId: "P777",
        fileUrls: ["/uploads/prop_test_1.png"],
        updateUrlCallback: (_oldUrl: string, newUrl: string) => {
          updatedLeadUrl = newUrl;
        },
      },
      {
        collectionName: "documents" as const,
        recordId: "doc_y1",
        tenantId: "ten_agency_b",
        propertyId: "D888",
        fileUrls: ["/uploads/doc_test_1.pdf"],
      },
    ];

    const dry = await FileMigrationService.executeFileMigration({
      mode: "dry_run",
      executedBy: "fountainheadro@gmail.com",
      uploadsDir: tempUploadsDir,
      referenceRecords: refs,
    });

    const live1 = await FileMigrationService.executeFileMigration({
      mode: "live",
      executedBy: "fountainheadro@gmail.com",
      uploadsDir: tempUploadsDir,
      referenceRecords: refs,
      updateReferences: true,
      maxRetries: 2,
      baseRetryDelayMs: 5,
      onBeforeUpload: (fname, attempt) => {
        if (fname === "doc_test_1.pdf" && attempt === 1) {
          throw new Error("Transient storage timeout");
        }
      },
    });

    const live2 = await FileMigrationService.executeFileMigration({
      mode: "live",
      executedBy: "fountainheadro@gmail.com",
      uploadsDir: tempUploadsDir,
      referenceRecords: refs,
    });

    const allLocalStillExist =
      fs.existsSync(imgPath) && fs.existsSync(docPath) && fs.existsSync(orphanPath);

    assert(
      dry.summary.totalFilesFound === 3 &&
        dry.summary.migratedCount === 0 &&
        dry.summary.manualReviewCount === 1 &&
        live1.summary.migratedCount === 2 &&
        live1.summary.checksumVerifiedCount === 2 &&
        live1.summary.manualReviewCount === 1 &&
        live1.summary.failedCount === 0 &&
        live1.referencesUpdated === true &&
        updatedLeadUrl.includes("/api/storage/media/tenants/ten_agency_a/properties/P777/prop_test_1.png") &&
        live2.summary.skippedDuplicatesCount === 2 &&
        allLocalStillExist,
      "TEST 4: Migrarea fișierelor verifică SHA-256, reîncearcă la erori tranzitorii, evită duplicatele și păstrează fișierele locale intacte"
    );
  } catch (err: any) {
    assert(false, `TEST 4 Eșuat: ${err?.message}`);
  }

  // ------------------------------------------------------------------
  // TEST 5: Cutover readiness guard & strict naming convention audit
  // ------------------------------------------------------------------
  try {
    const cutover = TenantCutoverService.getCutoverReadinessReport();

    const phase10Artifacts = [
      "src/core/migration/typ_migration-report.ts",
      "src/core/migration/repo_migration-state.ts",
      "src/core/migration/svc_legacy-inventory.ts",
      "src/core/migration/svc_legacy-migration.ts",
      "src/core/storage/typ_storage-config.ts",
      "src/core/storage/repo_storage-metadata.ts",
      "src/core/storage/svc_cloud-storage.ts",
      "src/core/storage/svc_file-migration.ts",
      "src/core/tenancy/svc_tenant-cutover.ts",
      "server/storage/rtr_storage.ts",
      "docs/production/ins_cutover-checklist.md",
      "docs/production/ins_gcs-setup.md",
      "tests/security/tst_data-migration.ts",
      "tests/security/tst_storage-isolation.ts",
    ];
    const validNameRegex = /^[a-z0-9._-]+$/;
    const namingViolations = phase10Artifacts.filter((relPath) => {
      const segments = relPath.split("/");
      return segments.some((seg) => !validNameRegex.test(seg));
    });

    assert(
      cutover.safeToDisableLegacyRules === false &&
        cutover.legacyRootRulesStillRequired === true &&
        cutover.blockers.length > 0 &&
        namingViolations.length === 0,
      "TEST 5: Cutover gate previne dezactivarea prematură a regulilor legacy și toate fișierele Fazei 10 respectă strict convenția lowercase (_ și -)"
    );
  } catch (err: any) {
    assert(false, `TEST 5 Eșuat: ${err?.message}`);
  }

  await new Promise<void>((resolve) => server.close(() => resolve()));

  try {
    if (fs.existsSync(process.env.PERSISTENT_STORE_PATH!)) {
      fs.unlinkSync(process.env.PERSISTENT_STORE_PATH!);
    }
    fs.rmSync(process.env.STORAGE_LOCAL_ROOT!, { recursive: true, force: true });
    fs.rmSync(tempUploadsDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }

  console.log("=================================================================");
  console.log(
    `📊 REZUMAT TESTE CLOUD STORAGE (FAZA 10.2): Total: ${testsPassed + testsFailed} | Reușite: ${testsPassed} | Eșuate: ${testsFailed}`
  );
  console.log("=================================================================");

  if (testsFailed > 0) process.exit(1);
}

runPhase10StorageTests().catch((err) => {
  console.error("Eroare critică în testele Fazei 10.2:", err);
  process.exit(1);
});
