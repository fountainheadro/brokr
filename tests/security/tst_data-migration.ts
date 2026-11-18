import fs from "fs";
import os from "os";
import path from "path";

process.env.NODE_ENV = "test";
process.env.PERSISTENT_STORE_PATH = path.join(
  os.tmpdir(),
  `brokr-phase10-mig-store-${process.pid}-${Date.now()}.json`
);

import { PersistentStoreService } from "../../src/core/database/svc_persistent-store";
import { LegacyInventoryService } from "../../src/core/migration/svc_legacy-inventory";
import {
  InMemoryMigrationAdapter,
  LegacyMigrationService,
} from "../../src/core/migration/svc_legacy-migration";
import { MigrationStateRepository } from "../../src/core/migration/repo_migration-state";

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

async function runPhase10DataMigrationTests() {
  console.log("=================================================================");
  console.log("🧪 TESTE FAZA 10 (PARTEA 1): INVENTAR, MIGRARE & VALIDARE DATE");
  console.log("=================================================================");

  PersistentStoreService.clearAll();
  MigrationStateRepository.clearAll();

  // ------------------------------------------------------------------
  // TEST 1: Inventory covers all code-verified root collections
  // ------------------------------------------------------------------
  try {
    const inv = await LegacyInventoryService.buildInventory({
      includeLiveCounts: false,
      adapterCounts: { leads: 3, contacts: 2, documents: 1 },
    });
    const names = inv.items.map((i) => i.collectionName);
    const hasExpected =
      names.includes("leads") &&
      names.includes("contacts") &&
      names.includes("personal") &&
      names.includes("documents") &&
      names.includes("activities") &&
      names.includes("tours") &&
      names.includes("viewings") &&
      names.includes("counters") &&
      names.includes("notifications") &&
      names.includes("fcm_tokens");

    const leadsItem = inv.items.find((i) => i.collectionName === "leads");
    const personalItem = inv.items.find((i) => i.collectionName === "personal");

    assert(
      hasExpected &&
        leadsItem?.recordCount === 3 &&
        leadsItem.liveCountStatus === "measured_adapter" &&
        personalItem?.recordCount === null &&
        personalItem.liveCountStatus === "unavailable_without_server_credentials",
      "TEST 1: Inventarul acoperă toate cele 10 colecții root și raportează onest absența credențialelor live"
    );
  } catch (err: any) {
    assert(false, `TEST 1 Eșuat: ${err?.message}`);
  }

  // ------------------------------------------------------------------
  // TEST 2: Ownership resolution + manual review + non-destructive Dry-Run
  // ------------------------------------------------------------------
  try {
    const adapter = new InMemoryMigrationAdapter({
      leads: [
        {
          id: "lead_a1",
          propertyId: "P9001",
          tenantId: "ten_agency_a",
          title: "Apartament 2 camere Floreasca | Parc | Loc parcare",
          price: "150.000 €",
          status: "Colaborare",
          transactionType: "Vânzare",
          createdAt: "2026-02-01T10:00:00.000Z",
        },
        {
          id: "lead_b1",
          propertyId: "P9002",
          createdByEmail: "adrian@brokr.ro",
          title: "Vilă 4 camere Pipera | Curte proprie | Mobilată",
          price: "2.200 € / lună",
          status: "Prospectare",
          transactionType: "Închiriere",
          createdAt: "2026-02-02T11:00:00.000Z",
        },
        {
          id: "lead_ambig_1",
          propertyId: "P9999",
          createdByEmail: "multi@example.com",
          title: "Record ambiguu multi-tenant",
          price: "500 € / lună",
          status: "Noi",
          createdAt: "2026-02-03T12:00:00.000Z",
        },
        {
          id: "lead_unassigned_1",
          propertyId: "P9998",
          title: "Record fără proprietar explicit",
          status: "Noi",
          createdAt: "2026-02-04T12:00:00.000Z",
        },
      ],
      documents: [
        {
          id: "doc_a1",
          leadId: "lead_a1",
          title: "Contract_P9001.pdf",
          fileUrl: "/uploads/contract_a1.pdf",
          createdAt: "2026-02-01T12:00:00.000Z",
        },
      ],
      activities: [
        {
          id: "act_b1",
          leadId: "lead_b1",
          title: "Vizionare Pipera",
          date: "2026-02-05T15:00:00.000Z",
          createdAt: "2026-02-02T12:00:00.000Z",
        },
      ],
    });

    const dryRun = await LegacyMigrationService.executeMigration({
      adapter,
      mode: "dry_run",
      executedBy: "fountainheadro@gmail.com",
      collectionsToMigrate: ["leads", "documents", "activities"],
      strictOwnershipRequired: true,
      allowSingleAgencyFallback: false,
    });

    const destAlphaLeads = await adapter.listTenantDocuments("ten_agency_a", "leads", 50);
    const destBrokrLeads = await adapter.listTenantDocuments("ten_brokr_default", "leads", 50);
    const manualIds = (dryRun.manualReviewRecords || []).map((r) => r.recordId);

    assert(
      dryRun.mode === "dry_run" &&
        dryRun.summary.totalMigrated === 0 &&
        destAlphaLeads.items.length === 0 &&
        destBrokrLeads.items.length === 0 &&
        dryRun.manualReviewCount === 2 &&
        manualIds.includes("lead_ambig_1") &&
        manualIds.includes("lead_unassigned_1"),
      "TEST 2: Dry-Run nu scrie nimic și marchează corect înregistrările ambigue/neasignate pentru revizie manuală"
    );
  } catch (err: any) {
    assert(false, `TEST 2 Eșuat: ${err?.message}`);
  }

  // ------------------------------------------------------------------
  // TEST 3: Live migration, idempotency, conflict preservation & source non-destruction
  // ------------------------------------------------------------------
  try {
    const adapter = new InMemoryMigrationAdapter({
      leads: [
        {
          id: "lead_a1",
          propertyId: "P9001",
          tenantId: "ten_agency_a",
          title: "Apartament 2 camere Floreasca | Parc",
          price: "150.000 €",
          status: "Colaborare",
        },
        {
          id: "lead_conflict",
          propertyId: "P9010",
          tenantId: "ten_agency_a",
          title: "Versiune nouă sursă",
          price: "200.000 €",
          status: "Colaborare",
        },
        {
          id: "lead_ambig",
          createdByEmail: "multi@example.com",
          title: "Ambiguu",
        },
      ],
      documents: [
        {
          id: "doc_a1",
          leadId: "lead_a1",
          title: "Cadastru.pdf",
          fileUrl: "/uploads/cadastru.pdf",
        },
      ],
    });

    adapter.seedTenantDest("ten_agency_a", "leads", [
      {
        id: "lead_conflict",
        propertyId: "P9010",
        tenant_id: "ten_agency_a",
        title: "Versiune veche modificată în destinație",
        price: "185.000 €",
        status: "Ofertare",
      },
    ]);

    const sourceBefore = JSON.stringify(adapter.getSourceSnapshot("leads"));

    const live1 = await LegacyMigrationService.executeMigration({
      adapter,
      mode: "live",
      executedBy: "fountainheadro@gmail.com",
      collectionsToMigrate: ["leads", "documents"],
      strictOwnershipRequired: true,
    });

    const sourceAfter = JSON.stringify(adapter.getSourceSnapshot("leads"));
    const conflictDoc = await adapter.getTenantDocument("ten_agency_a", "leads", "lead_conflict");
    const migratedDoc = await adapter.getTenantDocument("ten_agency_a", "documents", "doc_a1");

    const live2 = await LegacyMigrationService.executeMigration({
      adapter,
      mode: "live",
      executedBy: "fountainheadro@gmail.com",
      collectionsToMigrate: ["leads", "documents"],
      strictOwnershipRequired: true,
    });

    assert(
      live1.summary.totalMigrated === 2 &&
        live1.conflictsCount === 1 &&
        live1.manualReviewCount === 1 &&
        sourceBefore === sourceAfter &&
        conflictDoc?.title === "Versiune veche modificată în destinație" &&
        migratedDoc?.tenantId === "ten_agency_a" &&
        live2.summary.totalMigrated === 0 &&
        live2.summary.totalSkippedDuplicates === 2,
      "TEST 3: Migrarea live este idempotentă, conservă sursa 100% intactă și protejează conflictele fără suprascriere"
    );
  } catch (err: any) {
    assert(false, `TEST 3 Eșuat: ${err?.message}`);
  }

  // ------------------------------------------------------------------
  // TEST 4: Interruption + Checkpoint + Resume + Exponential Backoff Retries
  // ------------------------------------------------------------------
  try {
    const adapter = new InMemoryMigrationAdapter({
      leads: [
        { id: "l1", tenantId: "ten_brokr_default", title: "Imobil 1", price: "100 €", status: "Noi" },
        { id: "l2", tenantId: "ten_brokr_default", title: "Imobil 2", price: "200 €", status: "Noi" },
        { id: "l3", tenantId: "ten_brokr_default", title: "Imobil 3", price: "300 €", status: "Noi" },
        { id: "l4", tenantId: "ten_brokr_default", title: "Imobil 4", price: "400 €", status: "Noi" },
      ],
    });

    adapter.onBeforeWrite = (_tid, _col, docId, attemptIndex) => {
      if (docId === "l3" && attemptIndex < 3) {
        const err: any = new Error("Simulated transient 503 Service Unavailable");
        err.response = { status: 503 };
        throw err;
      }
    };

    const interrupted = await LegacyMigrationService.executeMigration({
      adapter,
      mode: "live",
      executedBy: "fountainheadro@gmail.com",
      collectionsToMigrate: ["leads"],
      batchSize: 2,
      abortAfterWrites: 2,
      maxRetries: 3,
      baseRetryDelayMs: 5,
    });

    const cp = MigrationStateRepository.getCheckpoint(interrupted.id);

    const resumed = await LegacyMigrationService.executeMigration({
      adapter,
      mode: "live",
      executedBy: "fountainheadro@gmail.com",
      collectionsToMigrate: ["leads"],
      batchSize: 2,
      resumeMigrationId: interrupted.id,
      maxRetries: 3,
      baseRetryDelayMs: 5,
    });

    const destAfter = await adapter.listTenantDocuments("ten_brokr_default", "leads", 50);

    assert(
      interrupted.status === "interrupted" &&
        cp?.status === "interrupted" &&
        cp.processedDocumentKeys.length === 2 &&
        resumed.status === "completed" &&
        resumed.resumedFromCheckpoint === true &&
        resumed.summary.totalErrors === 0 &&
        destAfter.items.length === 4,
      "TEST 4: Reluarea din checkpoint + retry exponențial recuperează migrarea întreruptă fără duplicate sau pierderi"
    );
  } catch (err: any) {
    assert(false, `TEST 4 Eșuat: ${err?.message}`);
  }

  // ------------------------------------------------------------------
  // TEST 5: Independent Post-Migration Validation catches missing, mismatched, and broken refs
  // ------------------------------------------------------------------
  try {
    const adapter = new InMemoryMigrationAdapter({
      leads: [
        { id: "v_l1", propertyId: "P1", tenantId: "ten_agency_a", title: "Vila 1", price: "250.000 €", status: "Colaborare" },
        { id: "v_l2", propertyId: "P2", tenantId: "ten_agency_a", title: "Ap 2", price: "120.000 €", status: "Prospectare" },
      ],
      documents: [
        { id: "v_d1", leadId: "v_l1", title: "Act.pdf", fileUrl: "/uploads/act.pdf" },
      ],
    });

    await LegacyMigrationService.executeMigration({
      adapter,
      mode: "live",
      executedBy: "fountainheadro@gmail.com",
      collectionsToMigrate: ["leads", "documents"],
    });

    const valPass = await LegacyMigrationService.validateMigrationIntegrity({
      adapter,
      targetTenantIds: ["ten_agency_a"],
      collections: ["leads", "documents"],
    });

    const corruptedAdapter = new InMemoryMigrationAdapter({
      leads: adapter.getSourceSnapshot("leads"),
      documents: [
        ...adapter.getSourceSnapshot("documents"),
        { id: "v_d_broken", leadId: "nonexistent_lead_id", tenantId: "ten_agency_a", title: "OrphanDoc" },
      ],
    });
    corruptedAdapter.seedTenantDest("ten_agency_a", "leads", [
      { id: "v_l1", propertyId: "P1", tenant_id: "ten_agency_a", title: "Vila 1", price: "999.999 €", status: "Colaborare" },
    ]);
    corruptedAdapter.seedTenantDest("ten_agency_a", "documents", [
      { id: "v_d1", leadId: "v_l1", tenant_id: "ten_agency_a", title: "Act.pdf", fileUrl: "/uploads/act.pdf" },
      { id: "v_d_broken", leadId: "nonexistent_lead_id", tenant_id: "ten_agency_a", title: "OrphanDoc" },
    ]);

    const valFail = await LegacyMigrationService.validateMigrationIntegrity({
      adapter: corruptedAdapter,
      targetTenantIds: ["ten_agency_a"],
      collections: ["leads", "documents"],
    });

    assert(
      valPass.allPassed === true &&
        valPass.summary.totalDestinationVerified === 3 &&
        valFail.allPassed === false &&
        valFail.summary.totalMissing === 1 &&
        valFail.summary.totalMismatched === 1 &&
        valFail.summary.totalBrokenReferences === 1,
      "TEST 5: Validatorul independent confirmă integritatea completă și detectează înregistrări lipsă, neconcordanțe și referințe rupte"
    );
  } catch (err: any) {
    assert(false, `TEST 5 Eșuat: ${err?.message}`);
  }

  console.log("=================================================================");
  console.log(
    `📊 REZUMAT TESTE MIGRARE DATE (FAZA 10.1): Total: ${testsPassed + testsFailed} | Reușite: ${testsPassed} | Eșuate: ${testsFailed}`
  );
  console.log("=================================================================");

  try {
    if (fs.existsSync(process.env.PERSISTENT_STORE_PATH!)) {
      fs.unlinkSync(process.env.PERSISTENT_STORE_PATH!);
    }
  } catch {
    // Cleanup best-effort
  }

  if (testsFailed > 0) process.exit(1);
}

runPhase10DataMigrationTests().catch((err) => {
  console.error("Eroare critică în testele Fazei 10.1:", err);
  process.exit(1);
});
