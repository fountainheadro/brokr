import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import express from "express";
import axios from "axios";

const runStamp = `${process.pid}-${Date.now()}`;
process.env.NODE_ENV = "test";
process.env.PERSISTENT_STORE_PATH = path.join(os.tmpdir(), `brokr-phase11-store-${runStamp}.json`);
process.env.STORAGE_LOCAL_ROOT = path.join(os.tmpdir(), `brokr-phase11-storage-${runStamp}`);
process.env.STORAGE_SIGNING_SECRET = "phase11_test_signing_secret_0123456789abcdef";

import { PersistentStoreService } from "../../src/core/database/svc_persistent-store";
import { PlatformAuditLogRepository } from "../../src/core/platform/repo_platform-audit-log";
import { InfraVerificationService } from "../../src/core/migration/svc_infra-verification";
import { BackupRegistryService } from "../../src/core/migration/svc_backup-registry";
import { OwnershipResolutionService } from "../../src/core/migration/svc_ownership-resolution";
import {
  InMemoryMigrationAdapter,
  LegacyMigrationService,
} from "../../src/core/migration/svc_legacy-migration";
import { MigrationStateRepository } from "../../src/core/migration/repo_migration-state";
import { CrmTenantStoreService } from "../../src/core/crm/svc_crm-tenant-store";
import { CloudStorageService } from "../../src/core/storage/svc_cloud-storage";
import { StorageMetadataRepository } from "../../src/core/storage/repo_storage-metadata";
import { TenantCutoverService } from "../../src/core/tenancy/svc_tenant-cutover";
import { crmRouter } from "../../server/crm/rtr_crm";
import { migrationRouter } from "../../server/migration/rtr_migration";
import { storageRouter } from "../../server/storage/rtr_storage";
import {
  registerNotificationRoutes,
  getTenantPartitionedNotificationSnapshot,
} from "../../server/background-notifications";
import { sanitizePublicProperty } from "../../server/security/sec_public-sanitizer";

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

async function runPhase11Tests() {
  console.log("=================================================================");
  console.log("🧪 TESTE FAZA 11: LIVE MIGRATION PREP, CRM CUTOVER & E2E ISOLATION");
  console.log("=================================================================");

  PersistentStoreService.clearAll();
  BackupRegistryService.clearAll();
  OwnershipResolutionService.clearAll();
  MigrationStateRepository.clearAll();
  StorageMetadataRepository.clearAll();

  // Mount actual production routers in isolated Express test instance
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use("/api/crm", crmRouter);
  app.use("/api/platform/migration", migrationRouter);
  app.use("/api/storage", storageRouter);
  registerNotificationRoutes(app);

  // Public property projection matching server.ts behavior
  app.get("/api/public-property/:id", async (req, res) => {
    const prop = await CrmTenantStoreService.findPublicPropertyAcrossTenants(req.params.id);
    if (!prop) {
      res.status(404).json({ error: "Property not found" });
      return;
    }
    res.json(sanitizePublicProperty(prop));
  });

  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const port = (server.address() as any).port;
  const origin = `http://127.0.0.1:${port}`;

  const alphaHeaders = {
    Authorization: "Bearer token_usr_alpha_owner",
    "x-tenant-override": "agency-a",
  };
  const betaHeaders = {
    Authorization: "Bearer token_usr_beta_owner",
    "x-tenant-override": "agency-b",
  };
  const superAdminHeaders = {
    Authorization: "Bearer mock_usr_super_admin",
  };

  // ------------------------------------------------------------------
  // TEST 1: Non-destructive Infrastructure Verification checks real state truthfully
  // ------------------------------------------------------------------
  try {
    const infraRes = await axios.get(`${origin}/api/platform/migration/infra-status`, {
      headers: superAdminHeaders,
    });
    const infra = infraRes.data?.data;

    assert(
      infraRes.status === 200 &&
        infra?.firebaseProjectId === "brokr-42038" &&
        typeof infra?.firestore?.liveReachable === "boolean" &&
        typeof infra?.liveExecutionReady === "boolean" &&
        Array.isArray(infra?.blockers),
      "TEST 1: Verificarea non-distructivă a infrastructurii returnează statusul real fără date fabricate"
    );
  } catch (err: any) {
    assert(false, `TEST 1 Eșuat: ${err?.message}`);
  }

  // ------------------------------------------------------------------
  // TEST 2: Mandatory Backup Gate blocks live execution without verified backup
  // ------------------------------------------------------------------
  try {
    let blockedWithoutBackup = false;
    try {
      BackupRegistryService.assertBackupVerifiedForLiveMigration();
    } catch (err: any) {
      blockedWithoutBackup = err?.statusCode === 412;
    }

    const deniedAgency = await axios.post(
      `${origin}/api/platform/migration/backup/verify`,
      { backupType: "firestore_pitr", pitrTimestamp: new Date().toISOString(), confirmedRecoverable: true },
      { headers: alphaHeaders, validateStatus: () => true }
    );

    const missingConfirm = await axios.post(
      `${origin}/api/platform/migration/backup/verify`,
      { backupType: "firestore_pitr", pitrTimestamp: new Date().toISOString(), confirmedRecoverable: false },
      { headers: superAdminHeaders, validateStatus: () => true }
    );

    const verifiedRes = await axios.post(
      `${origin}/api/platform/migration/backup/verify`,
      {
        backupType: "firestore_gcs_export",
        exportGcsUri: "gs://brokr-42038-backups/pre-cutover-2026-04",
        notes: "Verificat în testul automat de Faza 11",
        confirmedRecoverable: true,
      },
      { headers: superAdminHeaders, validateStatus: () => true }
    );

    const verified = BackupRegistryService.assertBackupVerifiedForLiveMigration();

    assert(
      blockedWithoutBackup &&
        deniedAgency.status === 403 &&
        missingConfirm.status === 400 &&
        verifiedRes.status === 201 &&
        verified.status === "verified" &&
        verified.exportGcsUri === "gs://brokr-42038-backups/pre-cutover-2026-04",
      "TEST 2: Poarta de Backup blochează migrarea live fără backup verificat și acceptă înregistrare exclusiv de la Super Admin"
    );
  } catch (err: any) {
    assert(false, `TEST 2 Eșuat: ${err?.message}`);
  }

  // ------------------------------------------------------------------
  // TEST 3: Manual Ownership Resolution (Super Admin only, source unchanged, clean rerun)
  // ------------------------------------------------------------------
  try {
    const adapter = new InMemoryMigrationAdapter({
      leads: [
        {
          id: "lead_ambig_legacy",
          propertyId: "P8801",
          title: "Apartament legacy fără proprietar explicit",
          createdByEmail: "multi@example.com",
          status: "Colaborare",
        },
      ],
    });
    const sourceBefore = adapter.getSourceSnapshot("leads");

    const pass1 = await LegacyMigrationService.executeMigration({
      adapter,
      mode: "live",
      executedBy: "fountainheadro@gmail.com",
      collectionsToMigrate: ["leads"],
      strictOwnershipRequired: true,
      allowSingleAgencyFallback: false,
    });

    const pendingBefore = await axios.get(`${origin}/api/platform/migration/manual-review`, {
      headers: superAdminHeaders,
    });

    const assignForbidden = await axios.post(
      `${origin}/api/platform/migration/manual-review/assign`,
      {
        collectionName: "leads",
        recordId: "lead_ambig_legacy",
        targetTenantId: "ten_agency_a",
        confirmed: true,
      },
      { headers: alphaHeaders, validateStatus: () => true }
    );

    const assignOk = await axios.post(
      `${origin}/api/platform/migration/manual-review/assign`,
      {
        collectionName: "leads",
        recordId: "lead_ambig_legacy",
        targetTenantId: "ten_agency_a",
        decision: "assigned",
        reason: "Verificat manual cu istoricul agenției Alpha",
        confirmed: true,
      },
      { headers: superAdminHeaders, validateStatus: () => true }
    );

    const sourceAfterAssign = adapter.getSourceSnapshot("leads");
    const sourceMutated = JSON.stringify(sourceBefore) !== JSON.stringify(sourceAfterAssign);

    const pass2 = await LegacyMigrationService.executeMigration({
      adapter,
      mode: "live",
      executedBy: "fountainheadro@gmail.com",
      collectionsToMigrate: ["leads"],
      strictOwnershipRequired: true,
      allowSingleAgencyFallback: false,
    });

    const validation = await LegacyMigrationService.validateMigrationIntegrity({
      adapter,
      targetTenantIds: ["ten_agency_a", "ten_brokr_default"],
      collections: ["leads"],
      migrationId: pass2.id,
      allowSingleAgencyFallback: false,
    });

    const alphaCopy = await adapter.getTenantDocument("ten_agency_a", "leads", "lead_ambig_legacy");
    const auditLogsRes = await PlatformAuditLogRepository.list({
      action: "MIGRATION_MANUAL_OWNERSHIP_ASSIGNED",
    });

    assert(
      pass1.manualReviewCount === 1 &&
        pass1.summary.totalMigrated === 0 &&
        pendingBefore.data?.data?.pending?.length === 1 &&
        assignForbidden.status === 403 &&
        assignOk.status === 201 &&
        !sourceMutated &&
        pass2.manualReviewCount === 0 &&
        pass2.summary.totalMigrated === 1 &&
        Boolean(alphaCopy) &&
        validation.allPassed === true &&
        auditLogsRes.items.length >= 1,
      "TEST 3: Revizia manuală a proprietății atribuie înregistrarea fără a modifica sursa, auditează decizia și trece validarea 100%"
    );
  } catch (err: any) {
    assert(false, `TEST 3 Eșuat: ${err?.message}`);
  }

  // ------------------------------------------------------------------
  // TEST 4: Full Two-Agency CRM End-to-End & Strict Cross-Tenant Isolation
  // ------------------------------------------------------------------
  let alphaPropId = "";
  let alphaPromotedLeadId = "";
  let alphaReqId = "";
  let alphaContactId = "";
  let alphaStaffId = "";
  let alphaDocId = "";
  let alphaActivityId = "";
  let alphaNotifId = "";
  let alphaPrivateObjKey = "";

  try {
    // 4A. Sequential counters isolated per tenant
    const cPropA = await axios.post(`${origin}/api/crm/counters/next-id`, { type: "property" }, { headers: alphaHeaders });
    const cPropB = await axios.post(`${origin}/api/crm/counters/next-id`, { type: "property" }, { headers: betaHeaders });
    const cReqA = await axios.post(`${origin}/api/crm/counters/next-id`, { type: "request" }, { headers: alphaHeaders });

    // 4B. Create Property (with PII), Lead (then promote L* -> P*), Request, Contact, Staff, Doc, Activity (auto mirrors tours & viewings), Notification, FCM Token
    const propRes = await axios.post(
      `${origin}/api/crm/leads`,
      {
        propertyId: cPropA.data.data.nextId,
        title: "Apartament 2 camere Floreasca | Parc",
        price: "185.000 €",
        status: "Colaborare",
        transactionType: "Vânzare",
        ownerName: "Ion Popescu CONFIDENTIAL",
        ownerPhone: "+40722999888",
        ownerEmail: "ion.popescu@privat.ro",
        internalNotes: "Comision negociat intern 2%",
        comisioane: "2% secret",
      },
      { headers: alphaHeaders }
    );
    alphaPropId = propRes.data.data.id;

    const leadCounter = await axios.post(`${origin}/api/crm/counters/next-id`, { type: "lead" }, { headers: alphaHeaders });
    const leadRes = await axios.post(
      `${origin}/api/crm/leads`,
      {
        propertyId: leadCounter.data.data.nextId,
        title: "Lead Apartament Aviației",
        status: "Nou",
        transactionType: "Închiriere",
      },
      { headers: alphaHeaders }
    );
    alphaPromotedLeadId = leadRes.data.data.id;

    const promotedRes = await axios.patch(
      `${origin}/api/crm/leads/${alphaPromotedLeadId}`,
      { status: "Colaborare" },
      { headers: alphaHeaders }
    );

    const reqRes = await axios.post(
      `${origin}/api/crm/leads`,
      {
        propertyId: cReqA.data.data.nextId,
        title: "Cerere 3 camere Herăstrău",
        status: "AreInteres",
      },
      { headers: alphaHeaders }
    );
    alphaReqId = reqRes.data.data.id;

    const contactRes = await axios.post(
      `${origin}/api/crm/contacts`,
      { name: "Client Alpha", phone: "+40744111222", category: "Cumparator" },
      { headers: alphaHeaders }
    );
    alphaContactId = contactRes.data.data.id;

    const staffRes = await axios.post(
      `${origin}/api/crm/personal`,
      { name: "Agent Alpha 1", email: "agent.a@agency-alpha.ro", role: "Broker" },
      { headers: alphaHeaders }
    );
    alphaStaffId = staffRes.data.data.id;

    const docRes = await axios.post(
      `${origin}/api/crm/documents`,
      { title: "Contract Alpha", status: "Active", propertyId: cPropA.data.data.nextId },
      { headers: alphaHeaders }
    );
    alphaDocId = docRes.data.data.id;

    const actRes = await axios.post(
      `${origin}/api/crm/activities`,
      {
        title: "Vizionare Floreasca",
        type: "Vizionare",
        leadId: alphaPropId,
        date: "2026-06-15",
        hour: "14:00",
        status: "Programata",
      },
      { headers: alphaHeaders }
    );
    alphaActivityId = actRes.data.data.id;

    const notifRes = await axios.post(
      `${origin}/api/crm/notifications`,
      {
        title: "Reminder Vizionare",
        body: "Peste 1 oră",
        type: "viewing",
        read: false,
      },
      { headers: alphaHeaders }
    );
    alphaNotifId = notifRes.data.data.id;

    const fcmRes = await axios.post(
      `${origin}/api/crm/fcm-tokens`,
      { token: "fcm_token_alpha_device_1234567890", devicePlatform: "web" },
      { headers: alphaHeaders }
    );

    const alphaTours = await axios.get(`${origin}/api/crm/tours`, { headers: alphaHeaders });
    const alphaViewings = await axios.get(`${origin}/api/crm/viewings`, { headers: alphaHeaders });

    // Storage private upload & public property photo isolation
    const uploadPriv = await axios.post(
      `${origin}/api/storage/documents/upload`,
      {
        fileName: "contract_conf.pdf",
        documentId: alphaDocId,
        dataUrl: `data:application/pdf;base64,${VALID_PDF.toString("base64")}`,
      },
      { headers: alphaHeaders }
    );
    alphaPrivateObjKey = uploadPriv.data?.data?.metadata?.objectKey || "";

    await CloudStorageService.uploadObject({
      tenantId: "ten_agency_a",
      entityType: "properties",
      entityId: "P1",
      fileName: "living.png",
      buffer: VALID_PNG,
      visibility: "public_listing",
      uploadedByUserId: "usr_alpha_owner",
      isImageOnly: true,
    });

    const publicMediaOk = await axios.get(
      `${origin}/api/storage/media/tenants/ten_agency_a/properties/P1/living.png`,
      { validateStatus: () => true }
    );
    const privateAsMediaForbidden = await axios.get(
      `${origin}/api/storage/media/tenants/ten_agency_a/documents/${alphaDocId}/contract_conf.pdf`,
      { validateStatus: () => true }
    );

    // Sync viewings & register token into background notification cache
    await axios.post(
      `${origin}/api/notifications/sync-viewings`,
      {
        userId: "usr_alpha_owner",
        viewings: [{ id: alphaActivityId, date: "2026-06-15", hour: "14:00", contactName: "Client Alpha" }],
      },
      { headers: alphaHeaders }
    );
    await axios.post(
      `${origin}/api/notifications/register-token`,
      { userId: "usr_alpha_owner", token: "bg_push_alpha_device_12345678" },
      { headers: alphaHeaders }
    );

    assert(
      cPropA.data.data.nextId === "P1" &&
        cPropB.data.data.nextId === "P1" &&
        cReqA.data.data.nextId === "R1" &&
        String(promotedRes.data.data.propertyId).startsWith("P") &&
        Boolean(alphaReqId) &&
        Boolean(alphaContactId) &&
        Boolean(alphaStaffId) &&
        Boolean(alphaDocId) &&
        alphaTours.data.data.length === 1 &&
        alphaViewings.data.data.length === 1 &&
        Boolean(alphaNotifId) &&
        fcmRes.status === 201 &&
        publicMediaOk.status === 200 &&
        privateAsMediaForbidden.status === 403,
      "TEST 4A: Agenția Alpha parcurge întregul flux CRM (counters, P/L/R, promovare L->P, contacte, personal, documente, activități+tours/viewings, notificări, FCM, storage)"
    );
  } catch (err: any) {
    assert(false, `TEST 4A Eșuat: ${err?.message}`);
  }

  // ------------------------------------------------------------------
  // TEST 4B: Agency B isolation, Anti-Spoofing, 401/403 & Public PII Stripping
  // ------------------------------------------------------------------
  try {
    const collectionsToCheck = [
      { col: "leads", id: alphaPropId },
      { col: "contacts", id: alphaContactId },
      { col: "personal", id: alphaStaffId },
      { col: "documents", id: alphaDocId },
      { col: "activities", id: alphaActivityId },
      { col: "tours", id: alphaActivityId },
      { col: "viewings", id: alphaActivityId },
      { col: "notifications", id: alphaNotifId },
    ];

    let allBetaEmptyAndBlocked = true;
    for (const item of collectionsToCheck) {
      const listRes = await axios.get(`${origin}/api/crm/${item.col}`, { headers: betaHeaders });
      const getRes = await axios.get(`${origin}/api/crm/${item.col}/${item.id}`, {
        headers: betaHeaders,
        validateStatus: () => true,
      });
      const patchRes = await axios.patch(
        `${origin}/api/crm/${item.col}/${item.id}`,
        { hacked: true },
        { headers: betaHeaders, validateStatus: () => true }
      );
      const delRes = await axios.delete(`${origin}/api/crm/${item.col}/${item.id}`, {
        headers: betaHeaders,
        validateStatus: () => true,
      });

      if (
        !Array.isArray(listRes.data?.data) ||
        listRes.data.data.length !== 0 ||
        (getRes.status !== 404 && getRes.status !== 403) ||
        (patchRes.status !== 404 && patchRes.status !== 403) ||
        (delRes.status !== 404 && delRes.status !== 403)
      ) {
        allBetaEmptyAndBlocked = false;
      }
    }

    // Tenant spoofing via body or query
    const spoofBodyRes = await axios.post(
      `${origin}/api/crm/leads`,
      { tenantId: "ten_agency_a", title: "Spoof attempt" },
      { headers: betaHeaders, validateStatus: () => true }
    );
    const spoofQueryRes = await axios.get(`${origin}/api/crm/leads?tenantId=ten_agency_a`, {
      headers: betaHeaders,
      validateStatus: () => true,
    });

    // Unauthenticated & Outsider
    const unauthRes = await axios.get(`${origin}/api/crm/leads`, { validateStatus: () => true });
    const outsiderRes = await axios.get(`${origin}/api/crm/leads`, {
      headers: { Authorization: "Bearer mock_usr_outsider_1", "x-tenant-override": "agency-a" },
      validateStatus: () => true,
    });

    // Cross-tenant storage access blocked
    const crossDocDownload = await axios.get(
      `${origin}/api/storage/documents/download?key=${encodeURIComponent(alphaPrivateObjKey)}`,
      { headers: betaHeaders, validateStatus: () => true }
    );

    // Background notification cache isolated strictly per tenant
    const alphaBg = getTenantPartitionedNotificationSnapshot("ten_agency_a");
    const betaBg = getTenantPartitionedNotificationSnapshot("ten_agency_b");

    // Public Property Endpoint works & strips all private PII
    const pubRes = await axios.get(`${origin}/api/public-property/${alphaPropId}`);
    const pubJson = JSON.stringify(pubRes.data || {});

    assert(
      allBetaEmptyAndBlocked &&
        spoofBodyRes.status === 403 &&
        spoofQueryRes.status === 403 &&
        unauthRes.status === 401 &&
        outsiderRes.status === 403 &&
        crossDocDownload.status === 403 &&
        alphaBg.viewings.length === 1 &&
        alphaBg.tokens.length === 1 &&
        betaBg.viewings.length === 0 &&
        betaBg.tokens.length === 0 &&
        pubRes.status === 200 &&
        pubRes.data?.propertyId === "P1" &&
        !pubJson.includes("Ion Popescu CONFIDENTIAL") &&
        !pubJson.includes("+40722999888") &&
        !pubJson.includes("ion.popescu@privat.ro") &&
        !pubJson.includes("2% secret"),
      "TEST 4B: Izolare 100% între Agenția B și Agenția A pe toate cele 8 colecții CRM, storage, notificări background, anti-spoofing (403) și sanitizare PII publică"
    );
  } catch (err: any) {
    assert(false, `TEST 4B Eșuat: ${err?.message}`);
  }

  // ------------------------------------------------------------------
  // TEST 5: Cutover & Rollback Toggle + Cutover Readiness Report
  // ------------------------------------------------------------------
  try {
    const rbForbidden = await axios.post(
      `${origin}/api/platform/migration/cutover-mode`,
      { mode: "legacy_rollback_standby" },
      { headers: alphaHeaders, validateStatus: () => true }
    );

    const rbOn = await axios.post(
      `${origin}/api/platform/migration/cutover-mode`,
      { mode: "legacy_rollback_standby", reason: "Test rollback controlat Faza 11" },
      { headers: superAdminHeaders }
    );
    const rbOff = await axios.post(
      `${origin}/api/platform/migration/cutover-mode`,
      { mode: "tenant_scoped", reason: "Revenire tenant_scoped după test" },
      { headers: superAdminHeaders }
    );

    const alphaLeadsStillIntact = await axios.get(`${origin}/api/crm/leads`, { headers: alphaHeaders });
    const readinessRes = await axios.get(`${origin}/api/platform/migration/cutover-readiness`, {
      headers: superAdminHeaders,
    });
    const readiness = readinessRes.data?.data;
    const allTenServicesRefactored =
      Array.isArray(readiness?.servicesInventory) &&
      readiness.servicesInventory.length === 10 &&
      readiness.servicesInventory.every(
        (s: any) => s.usesTenantContext === true && s.requiresFrontendRefactorBeforeCutover === false
      );

    assert(
      rbForbidden.status === 403 &&
        rbOn.status === 200 &&
        rbOn.data.data.mode === "legacy_rollback_standby" &&
        rbOff.status === 200 &&
        rbOff.data.data.mode === "tenant_scoped" &&
        alphaLeadsStillIntact.data.data.length === 3 &&
        readiness?.legacyRootRulesStillRequired === true &&
        readiness?.backupVerified === true &&
        allTenServicesRefactored,
      "TEST 5: Switch-ul de rollback păstrează datele intacte, toate cele 10 servicii CRM folosesc TenantContext, iar firestore.rules legacy rămâne protejat"
    );
  } catch (err: any) {
    assert(false, `TEST 5 Eșuat: ${err?.message}`);
  }

  // ------------------------------------------------------------------
  // TEST 6: Static Grep & Naming Convention Audit (Zero Root Firestore Queries in src/services)
  // ------------------------------------------------------------------
  try {
    const servicesDir = path.resolve(process.cwd(), "src", "services");
    const serviceFiles = fs.readdirSync(servicesDir).filter((f) => f.endsWith(".ts"));
    const violatingServices: string[] = [];

    for (const file of serviceFiles) {
      const content = fs.readFileSync(path.join(servicesDir, file), "utf8");
      if (/collection\s*\(\s*db\s*,/.test(content) || /doc\s*\(\s*db\s*,/.test(content)) {
        violatingServices.push(file);
      }
    }

    const phase11Files = [
      "src/core/migration/svc_infra-verification.ts",
      "src/core/migration/svc_backup-registry.ts",
      "src/core/migration/svc_ownership-resolution.ts",
      "src/core/crm/svc_crm-tenant-store.ts",
      "src/core/crm/svc_crm-client.ts",
      "server/crm/rtr_crm.ts",
      "docs/production/ins_backup-restore.md",
      "tests/security/tst_phase11-cutover-and-e2e.ts",
    ];
    const invalidNames = phase11Files.filter((relPath) => {
      const fullPath = path.resolve(process.cwd(), relPath);
      const exists = fs.existsSync(fullPath);
      const validSyntax = /^[a-z0-9_/-]+\.(ts|tsx|md)$/.test(relPath);
      return !exists || !validSyntax;
    });

    assert(
      violatingServices.length === 0 && invalidNames.length === 0,
      `TEST 6: Audit static curat — 0 apeluri root Firestore în src/services (${serviceFiles.length} fișiere verificate) și convenția de denumire respectată`
    );
  } catch (err: any) {
    assert(false, `TEST 6 Eșuat: ${err?.message}`);
  }

  server.close();
  console.log("-----------------------------------------------------------------");
  console.log(`📊 REZULTAT TESTE FAZA 11: ${testsPassed} TRECUTE, ${testsFailed} EȘUATE`);
  console.log("=================================================================");
  if (testsFailed > 0) process.exit(1);
}

runPhase11Tests().catch((err) => {
  console.error("Fatal error running Phase 11 tests:", err);
  process.exit(1);
});
