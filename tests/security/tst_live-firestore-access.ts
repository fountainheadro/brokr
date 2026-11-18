import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import crypto from "crypto";
import express from "express";

const runStamp = `${process.pid}-${Date.now()}`;
process.env.NODE_ENV = "test";
process.env.PERSISTENT_STORE_PATH = path.join(os.tmpdir(), `brokr-phase12-store-${runStamp}.json`);

import { PersistentStoreService } from "../../src/core/database/svc_persistent-store";
import { InfraVerificationService } from "../../src/core/migration/svc_infra-verification";
import { BackupRegistryService } from "../../src/core/migration/svc_backup-registry";
import { BackupVerificationService } from "../../src/core/migration/svc_backup-verification";

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

async function runPhase12Tests() {
  console.log("=================================================================");
  console.log("🧪 TESTE FAZA 12: VERIFICARE ACCES INFRASTRUCTURĂ, ADC & BACKUP");
  console.log("=================================================================");

  PersistentStoreService.clearAll();
  BackupRegistryService.clearAll();

  // ------------------------------------------------------------------
  // TEST 1: Real non-mocked runtime probe behaves honestly (never fakes verified)
  // ------------------------------------------------------------------
  try {
    const liveProbe = await InfraVerificationService.verifyInfrastructure({ runWriteProbes: true });
    const expectedStatuses = new Set([
      "configured",
      "authenticated",
      "permission_denied",
      "unavailable",
      "verified",
    ]);

    assert(
      liveProbe.firebaseProjectId === "brokr-42038" &&
        liveProbe.firestoreDatabaseId === "ai-studio-e7371a1e-cd74-432c-b244-a7eb8aa7f434" &&
        liveProbe.storageBucket === "brokr-42038.firebasestorage.app" &&
        expectedStatuses.has(liveProbe.firestore.status) &&
        expectedStatuses.has(liveProbe.cloudStorage.status) &&
        // Without configured credentials in test environment, liveExecutionReady MUST be false
        liveProbe.liveExecutionReady === false,
      "TEST 1: Sonda live reală (fără mock) raportează cinstit starea reală și blochează liveExecutionReady fără acces verificat"
    );
  } catch (err: any) {
    assert(false, `TEST 1 Eșuat: ${err?.message}`);
  }

  // ------------------------------------------------------------------
  // TEST 2 & 3: Protocol-level isolated Firestore & GCS round-trip probes + Backup proof
  // ------------------------------------------------------------------
  const firestoreDocs = new Map<string, any>([
    ["leads/real_crm_lead_1", { fields: { title: { stringValue: "P1 Real CRM Untouched" } } }],
  ]);
  const gcsObjects = new Map<string, Buffer>([
    [
      "exports/2026-11/exports.overall_export_metadata",
      Buffer.from("OVERALL_EXPORT_METADATA_OK", "utf8"),
    ],
  ]);

  let simulate403 = true;
  let pitrEnabledState = false;

  const gcpProtoApp = express();
  gcpProtoApp.use(express.json());
  gcpProtoApp.use(express.raw({ type: "text/plain", limit: "2mb" }));

  // Firestore Database metadata (PITR status)
  gcpProtoApp.get("/v1/projects/:project/databases/:db", (req, res) => {
    if (simulate403) return res.status(403).json({ error: { message: "PERMISSION_DENIED" } });
    res.json({
      name: `projects/${req.params.project}/databases/${req.params.db}`,
      pointInTimeRecoveryEnablement: pitrEnabledState
        ? "POINT_IN_TIME_RECOVERY_ENABLED"
        : "POINT_IN_TIME_RECOVERY_DISABLED",
      earliestVersionTime: "2026-11-12T00:00:00.000Z",
    });
  });

  // Firestore read-only COUNT aggregation
  gcpProtoApp.post("/v1/projects/:project/databases/:db/documents\\:runAggregationQuery", (req, res) => {
    if (simulate403) return res.status(403).json({ error: { message: "PERMISSION_DENIED" } });
    res.json([{ result: { aggregateFields: { total_count: { integerValue: "1" } } } }]);
  });

  // Firestore isolated probe doc CRUD (strictly _infra_probes/*)
  gcpProtoApp.patch("/v1/projects/:project/databases/:db/documents/_infra_probes/:id", (req, res) => {
    if (simulate403) return res.status(403).json({ error: { message: "PERMISSION_DENIED" } });
    firestoreDocs.set(`_infra_probes/${req.params.id}`, req.body);
    res.json(req.body);
  });
  gcpProtoApp.get("/v1/projects/:project/databases/:db/documents/_infra_probes/:id", (req, res) => {
    const doc = firestoreDocs.get(`_infra_probes/${req.params.id}`);
    if (!doc) return res.status(404).json({ error: "NOT_FOUND" });
    res.json(doc);
  });
  gcpProtoApp.delete("/v1/projects/:project/databases/:db/documents/_infra_probes/:id", (req, res) => {
    firestoreDocs.delete(`_infra_probes/${req.params.id}`);
    res.json({});
  });

  // GCS bucket info & list
  gcpProtoApp.get("/storage/v1/b/:bucket", (_req, res) => {
    if (simulate403) return res.status(403).json({ error: { message: "PERMISSION_DENIED" } });
    res.json({ name: _req.params.bucket });
  });
  gcpProtoApp.get("/storage/v1/b/:bucket/o", (req, res) => {
    if (simulate403) return res.status(403).json({ error: { message: "PERMISSION_DENIED" } });
    const prefix = String(req.query.prefix || "");
    const items = Array.from(gcsObjects.entries())
      .filter(([name]) => !prefix || name.startsWith(prefix))
      .map(([name, buf]) => ({ name, size: String(buf.length) }));
    res.json({ items });
  });
  gcpProtoApp.post("/upload/storage/v1/b/:bucket/o", (req, res) => {
    if (simulate403) return res.status(403).json({ error: { message: "PERMISSION_DENIED" } });
    const name = String(req.query.name || "");
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body || ""), "utf8");
    gcsObjects.set(name, buf);
    res.json({ name, size: String(buf.length) });
  });
  gcpProtoApp.get("/storage/v1/b/:bucket/o/:obj", (req, res) => {
    const buf = gcsObjects.get(req.params.obj);
    if (!buf) return res.status(404).json({ error: "NOT_FOUND" });
    res.send(buf);
  });
  gcpProtoApp.delete("/storage/v1/b/:bucket/o/:obj", (req, res) => {
    gcsObjects.delete(req.params.obj);
    res.status(204).end();
  });

  const protoServer = await new Promise<http.Server>((resolve) => {
    const s = gcpProtoApp.listen(0, "127.0.0.1", () => resolve(s));
  });
  const protoOrigin = `http://127.0.0.1:${(protoServer.address() as any).port}`;

  try {
    // 2A. Permission Denied 403 detection
    simulate403 = true;
    const deniedCheck = await InfraVerificationService.verifyInfrastructure({
      runWriteProbes: true,
      firestoreApiOrigin: protoOrigin,
      gcsApiOrigin: protoOrigin,
      overrideFirestoreToken: "test-token",
      overrideStorageToken: "test-token",
    });

    // 2B. Verified round-trip check (write + read-back + SHA-256 + probe cleanup, CRM untouched)
    simulate403 = false;
    const verifiedCheck = await InfraVerificationService.verifyInfrastructure({
      runWriteProbes: true,
      firestoreApiOrigin: protoOrigin,
      gcsApiOrigin: protoOrigin,
      overrideFirestoreToken: "test-token",
      overrideStorageToken: "test-token",
    });

    const probeLeftoversFs = Array.from(firestoreDocs.keys()).filter((k) => k.startsWith("_infra_probes/"));
    const probeLeftoversGcs = Array.from(gcsObjects.keys()).filter((k) => k.startsWith("_infra_probes/"));
    const crmDocUntouched =
      firestoreDocs.get("leads/real_crm_lead_1")?.fields?.title?.stringValue === "P1 Real CRM Untouched";

    assert(
      deniedCheck.firestore.status === "permission_denied" &&
        deniedCheck.cloudStorage.status === "permission_denied" &&
        deniedCheck.liveExecutionReady === false &&
        verifiedCheck.firestore.status === "verified" &&
        verifiedCheck.firestore.checks.writeProbe === true &&
        verifiedCheck.firestore.checks.readBackProbe === true &&
        verifiedCheck.firestore.checks.deleteProbe === true &&
        verifiedCheck.cloudStorage.status === "verified" &&
        verifiedCheck.cloudStorage.checks.uploadProbe === true &&
        verifiedCheck.cloudStorage.checks.readBackChecksumVerified === true &&
        verifiedCheck.cloudStorage.checks.deleteProbe === true &&
        verifiedCheck.liveExecutionReady === true &&
        probeLeftoversFs.length === 0 &&
        probeLeftoversGcs.length === 0 &&
        crmDocUntouched,
      "TEST 2: Probele izolate diferențiază permission_denied vs verified, verifică checksum SHA-256, șterg exclusiv proba și lasă CRM-ul neatins"
    );
  } catch (err: any) {
    assert(false, `TEST 2 Eșuat: ${err?.message}`);
  }

  // ------------------------------------------------------------------
  // TEST 3: Backup Verification rejects checkbox-only attestation for live Firestore
  //         and accepts genuine GCP PITR / overall_export_metadata verification
  // ------------------------------------------------------------------
  try {
    BackupRegistryService.registerVerifiedBackup({
      backupType: "firestore_gcs_export",
      exportGcsUri: "gs://brokr-42038-backups/manual-unverified",
      verifiedBy: "fountainheadro@gmail.com",
      notes: "Doar bifă manuală",
      confirmedRecoverable: true,
    });

    let blockedOperatorAttestation = false;
    try {
      BackupRegistryService.assertBackupVerifiedForLiveMigration({ requireLiveGcpProof: true });
    } catch (e: any) {
      blockedOperatorAttestation = e?.statusCode === 412;
    }

    // PITR disabled should be rejected with 412
    pitrEnabledState = false;
    let rejectedDisabledPitr = false;
    try {
      await BackupVerificationService.verifyAndRegisterLiveBackup({
        backupType: "firestore_pitr",
        pitrTimestamp: "2026-11-13T12:00:00Z",
        verifiedBy: "fountainheadro@gmail.com",
        firestoreApiOrigin: protoOrigin,
        overrideFirestoreToken: "test-token",
      });
    } catch (e: any) {
      rejectedDisabledPitr = e?.statusCode === 412;
    }

    // Missing export metadata should be rejected with 412
    let rejectedMissingExport = false;
    try {
      await BackupVerificationService.verifyAndRegisterLiveBackup({
        backupType: "firestore_gcs_export",
        exportGcsUri: "gs://brokr-42038-backups/nonexistent-prefix",
        verifiedBy: "fountainheadro@gmail.com",
        gcsApiOrigin: protoOrigin,
        overrideStorageToken: "test-token",
      });
    } catch (e: any) {
      rejectedMissingExport = e?.statusCode === 412;
    }

    // Valid export WITH .overall_export_metadata succeeds and unlocks requireLiveGcpProof
    const validExportRes = await BackupVerificationService.verifyAndRegisterLiveBackup({
      backupType: "firestore_gcs_export",
      exportGcsUri: "gs://brokr-42038-backups/exports/2026-11",
      restoreTestedAt: "2026-11-13T10:00:00Z",
      restoreTargetDatabase: "brokr-staging-restore",
      verifiedBy: "fountainheadro@gmail.com",
      gcsApiOrigin: protoOrigin,
      overrideStorageToken: "test-token",
    });

    const unlockedGate = BackupRegistryService.assertBackupVerifiedForLiveMigration({
      requireLiveGcpProof: true,
    });

    assert(
      blockedOperatorAttestation &&
        rejectedDisabledPitr &&
        rejectedMissingExport &&
        validExportRes.record.verificationLevel === "live_gcp_verified" &&
        validExportRes.evidence.exportMetadataFound === true &&
        unlockedGate.backupId === validExportRes.record.backupId,
      "TEST 3: Poarta de Backup respinge simpla bifare manuală/PITR dezactivat/export lipsă și acceptă exclusiv dovada reală GCP"
    );
  } catch (err: any) {
    assert(false, `TEST 3 Eșuat: ${err?.message}`);
  } finally {
    protoServer.close();
  }

  // ------------------------------------------------------------------
  // TEST 4: Security & Naming Audit (Zero hardcoded SA secrets, ADC detection, rules active)
  // ------------------------------------------------------------------
  try {
    const tmpAdcPath = path.join(os.tmpdir(), `brokr-adc-test-${runStamp}.json`);
    fs.writeFileSync(
      tmpAdcPath,
      JSON.stringify({
        type: "authorized_user",
        client_id: "test-client",
        client_secret: "test-secret",
        refresh_token: "test-refresh",
      }),
      "utf8"
    );
    const prevCredEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    process.env.GOOGLE_APPLICATION_CREDENTIALS = tmpAdcPath;
    const adcInfo = PersistentStoreService.getAuthMethodInfo();
    if (prevCredEnv) process.env.GOOGLE_APPLICATION_CREDENTIALS = prevCredEnv;
    else delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    fs.unlinkSync(tmpAdcPath);

    // Ensure no frontend file embeds server-side SA env vars or private_key patterns
    const frontendScanDirs = ["src/pages", "src/components", "src/services"];
    let leakedSecretInFrontend = false;
    for (const dir of frontendScanDirs) {
      const fullDir = path.resolve(process.cwd(), dir);
      if (!fs.existsSync(fullDir)) continue;
      const walk = (d: string) => {
        for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, ent.name);
          if (ent.isDirectory()) walk(p);
          else if (ent.isFile() && /\.(ts|tsx)$/.test(ent.name)) {
            const txt = fs.readFileSync(p, "utf8");
            if (txt.includes("FIREBASE_SERVICE_ACCOUNT_JSON") || txt.includes("BEGIN PRIVATE KEY")) {
              leakedSecretInFrontend = true;
            }
          }
        }
      };
      walk(fullDir);
    }

    const phase12Files = [
      "src/core/migration/svc_backup-verification.ts",
      "docs/production/ins_iam-enablement.md",
      "tests/security/tst_live-firestore-access.ts",
    ];
    const namingValid = phase12Files.every(
      (f) => fs.existsSync(path.resolve(process.cwd(), f)) && /^[a-z0-9_/-]+\.(ts|tsx|md)$/.test(f)
    );

    const rulesText = fs.readFileSync(path.resolve(process.cwd(), "firestore.rules"), "utf8");
    const legacyRulesStillActive =
      rulesText.includes("match /leads/{leadId}") && rulesText.includes("match /tenants/{tenantId}");

    assert(
      adcInfo.method === "adc_authorized_user" &&
        !leakedSecretInFrontend &&
        namingValid &&
        legacyRulesStillActive,
      "TEST 4: ADC detectat curat, 0 secrete în frontend, convenție de denumire respectată și reguli legacy active"
    );
  } catch (err: any) {
    assert(false, `TEST 4 Eșuat: ${err?.message}`);
  }

  console.log("-----------------------------------------------------------------");
  console.log(`📊 REZULTAT TESTE FAZA 12: ${testsPassed} TRECUTE, ${testsFailed} EȘUATE`);
  console.log("=================================================================");
  if (testsFailed > 0) process.exit(1);
}

runPhase12Tests().catch((err) => {
  console.error("Fatal error running Phase 12 tests:", err);
  process.exit(1);
});
