/**
 * Phase 2 Verification Suite: Slim Lead Summary Projections, Atomic Dual-Write,
 * Idempotent Backfill, Parity Reconciliation, ClientDataHub Cutover & API Read-Only Enforcement.
 */

import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import assert from "node:assert/strict";
import express from "express";

const runStamp = `${process.pid}-${Date.now()}`;
const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), `brokr-phase2-test-${runStamp}-`));
process.env.NODE_ENV = "test";
process.env.PERSISTENT_STORE_PATH = path.join(testTempDir, "local-store.json");

import {
  computeSummaryParityChecksum,
  estimateUtf8Bytes,
  isSlimSummaryReadsEnabled,
  isSummaryLeadRecord,
  LEAD_SUMMARY_COLLECTION,
  MAX_SEARCH_TOKENS,
  MAX_SUMMARY_BYTES,
  PRIVATE_SUMMARY_EXCLUDED_FIELDS,
  projectLeadToSummary,
  setSlimSummaryReadsOverrideForTests,
  SHARED_LEADS_SUMMARY_COLLECTION,
  summaryToLeadRecord,
} from "../../src/core/crm/svc_lead-projection";
import { DEFAULT_OLX_LEAD_FILTERS, matchesOlxLeadFilter } from "../../src/utils/olxFilterUtils";
import { CrmTenantStoreService } from "../../src/core/crm/svc_crm-tenant-store";
import {
  PLATFORM_SHARED_LEADS_COLLECTION,
  SharedLeadStoreService,
} from "../../src/core/crm/svc_shared-leads-store";
import { PersistentStoreService } from "../../src/core/database/svc_persistent-store";
import { GcpAuthService } from "../../src/core/gcp/svc_gcp-auth";
import {
  backfillPlatformSharedLeadSummaries,
  backfillTenantLeadSummaries,
} from "../../server/migration/job_backfill-summaries";
import {
  reconcilePlatformSharedLeadSummaries,
  reconcileTenantLeadSummaries,
} from "../../server/migration/job_reconcile-summaries";
import {
  ClientDataHub,
  type DataHubPageResult,
  type DataHubTransport,
} from "../../src/core/crm/svc_client-data-hub";
import { crmRouter } from "../../server/crm/rtr_crm";

let passed = 0;
let failed = 0;

async function runTest(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`✅ [PASS] ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`❌ [FAIL] ${name} -> ${err?.message || err}`);
    failed++;
  }
}

function buildHeavyCanonicalLead(idx: number, overrides: Record<string, any> = {}): Record<string, any> {
  const hugeImages = Array.from({ length: 45 }, (_, i) => ({
    original: `https://cdn.example.com/properties/${idx}/highres-photo-${i}-${"x".repeat(40)}.jpg`,
    category: i % 2 === 0 ? "living" : "dormitor",
  }));

  return {
    id: `lead_heavy_${idx}`,
    tenantId: "ten_phase2_alpha",
    propertyId: `P${17000 + idx}`,
    url: `https://www.olx.ro/d/oferta/apartament-3-camere-floreasca-${idx}-IDabc${idx}.html`,
    title: `Apartament 3 camere decomandat Floreasca Parc Verdi etaj 3/8 parcare subterana #${idx}`,
    zone: "Floreasca",
    city: "București",
    price: "185.000 €",
    transactionType: "Vânzare",
    categoria: "Apartamente",
    status: "Activa",
    leadType: "Proprietar",
    ownerName: "Andrei Ionescu",
    ownerPhone: "0722111222",
    agent: "Maria Popescu",
    agentUid: "usr_agent_maria",
    author: "Maria Popescu",
    source: "olx",
    notes: "NOTĂ PRIVATĂ AGENT: Proprietarul acceptă 175.000 EUR cash imediat. " + "secret ".repeat(200),
    memoPrivat: "Comision 2% negociabil exclusiv cu directorul.",
    notePrivate: "Nu divulga codul de interfon 1234#.",
    images: hugeImages,
    extractedData: {
      markdownMarketing: "# Descriere completă\n" + "Descriere foarte lungă de marketing imobiliar. ".repeat(500),
      olxMeta: {
        categoryId: 907,
        publishedAt: "2026-11-20T10:15:00.000Z",
      },
      crmData: {
        detaliiGenerale: {
          tranzactie: "Vânzare",
          localizare: {
            oras: "București",
            zona: ["Floreasca", "Barbu Vacarescu", "Parcul Verdi"],
          },
        },
        caracteristici: {
          detalii: {
            camere: "3 camere",
            compartimentare: "Decomandat",
            etaj: "3",
          },
          alteDetalii: {
            anConstructie: "2021",
          },
          suprafete: {
            utila: "78 mp",
            construita: "93.6 mp",
          },
        },
        pret: {
          detalii: {
            pret: "185000",
          },
        },
        imagini: {
          living: [hugeImages[0]],
        },
      },
    },
    createdAt: "2026-11-20T10:00:00.000Z",
    updatedAt: "2026-11-21T12:00:00.000Z",
    lastMovedAt: "2026-11-21T12:00:00.000Z",
    docVersion: 1,
    ...overrides,
  };
}

async function main() {
  console.log("================================================================");
  console.log("🚀 BROKR PHASE 2 — SLIM PROJECTIONS & ATOMIC DUAL-WRITE SUITE");
  console.log("================================================================\n");

  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    USE_GCP_METADATA_AUTH: process.env.USE_GCP_METADATA_AUTH,
    K_SERVICE: process.env.K_SERVICE,
    VITE_USE_SLIM_SUMMARY_READS: process.env.VITE_USE_SLIM_SUMMARY_READS,
    USE_SLIM_SUMMARY_READS: process.env.USE_SLIM_SUMMARY_READS,
  };

  try {
    // ----------------------------------------------------------------
    // TEST 1: Pure Projection Determinism, Private Field Stripping & <= 2.5 KB Cap
    // ----------------------------------------------------------------
    await runTest(
      "1. projectLeadToSummary strips heavy/private fields, caps searchTokens <= 30, and enforces <= 2.5 KB/doc (<= 125 KB/50 leads)",
      () => {
        const canonical = buildHeavyCanonicalLead(1);
        const canonicalBytes = estimateUtf8Bytes(canonical);

        const summaryA = projectLeadToSummary(canonical, { tenantId: "ten_phase2_alpha", docVersion: 1 });
        const summaryB = projectLeadToSummary(canonical, { tenantId: "ten_phase2_alpha", docVersion: 1 });

        // Deterministic output & checksum
        assert.deepEqual(summaryA, summaryB, "Projection must be strictly deterministic");
        assert.equal(
          computeSummaryParityChecksum(summaryA),
          computeSummaryParityChecksum(summaryB),
          "Checksum must be deterministic"
        );

        // Excluded heavy & private fields must NEVER appear
        for (const forbiddenKey of PRIVATE_SUMMARY_EXCLUDED_FIELDS) {
          assert.equal(
            forbiddenKey in (summaryA as Record<string, any>),
            false,
            `Summary must exclude private/heavy field "${forbiddenKey}"`
          );
        }

        assert.equal(summaryA.isSummary, true);
        assert.equal(summaryA.docVersion, 1);
        assert.equal(summaryA.priceNumeric, 185000);
        assert.equal(summaryA.usefulArea, 78);
        assert.equal(summaryA.rooms, "3");
        assert.equal(summaryA.compartimentare, "decomandat");
        assert.equal(summaryA.floor, "fl_3");
        assert.ok(summaryA.constructieBuckets.includes("dupa-2000"));
        assert.equal(summaryA.olxCategoryId, 907);
        assert.ok(summaryA.coverThumbUrl.startsWith("https://cdn.example.com/"));
        assert.ok(
          summaryA.searchTokens.length > 0 && summaryA.searchTokens.length <= MAX_SEARCH_TOKENS,
          `Expected 1..${MAX_SEARCH_TOKENS} searchTokens, got ${summaryA.searchTokens.length}`
        );

        // Adversarial oversized input test
        const adversarial = buildHeavyCanonicalLead(999, {
          title: "Apartament " + "SuperLuxUltraPanoramic ".repeat(50),
          url: "https://www.olx.ro/d/oferta/" + "a".repeat(2000),
          coverImage: "https://cdn.example.com/" + "b".repeat(2000),
          zone: "Zona " + "BucurestiSector1 ".repeat(30),
        });
        const adversarialSummary = projectLeadToSummary(adversarial, { tenantId: "ten_phase2_alpha" });
        const advBytes = estimateUtf8Bytes(adversarialSummary);
        assert.ok(
          advBytes <= MAX_SUMMARY_BYTES,
          `Adversarial summary exceeded cap: ${advBytes} > ${MAX_SUMMARY_BYTES}`
        );

        // 50-lead page benchmark
        let page50Bytes = 0;
        let maxDocBytes = 0;
        for (let i = 0; i < 50; i++) {
          const s = projectLeadToSummary(buildHeavyCanonicalLead(i), { tenantId: "ten_phase2_alpha" });
          const b = estimateUtf8Bytes(s);
          page50Bytes += b;
          if (b > maxDocBytes) maxDocBytes = b;
          assert.ok(b <= MAX_SUMMARY_BYTES, `Lead #${i} summary exceeded 2.5 KB: ${b} bytes`);
        }

        const reductionPct = Math.round((1 - (page50Bytes / 50) / canonicalBytes) * 1000) / 10;
        assert.ok(
          page50Bytes <= MAX_SUMMARY_BYTES * 50,
          `50-lead page exceeded 125 KB: ${page50Bytes} bytes`
        );
        console.log(
          `   📊 Benchmark: Canonical=${(canonicalBytes / 1024).toFixed(1)} KB/doc vs Slim=${(
            page50Bytes /
            50 /
            1024
          ).toFixed(2)} KB/doc (max=${(maxDocBytes / 1024).toFixed(2)} KB, 50-doc page=${(
            page50Bytes / 1024
          ).toFixed(1)} KB, -${reductionPct}% payload)`
        );
      }
    );

    // ----------------------------------------------------------------
    // TEST 2: olxFilterUtils Parity Between Canonical Leads and Slim Summaries
    // ----------------------------------------------------------------
    await runTest(
      "2. olxFilterUtils produces identical filter match results on slim summaries vs full canonical leads",
      () => {
        const canonical = buildHeavyCanonicalLead(7);
        const slimLead = summaryToLeadRecord(
          projectLeadToSummary(canonical, { tenantId: "ten_phase2_alpha", docVersion: 1 })
        );

        assert.equal(isSummaryLeadRecord(slimLead), true, "Adapted summary must be flagged isSummary");
        assert.equal(isSummaryLeadRecord(canonical), false, "Canonical lead must NOT be flagged isSummary");

        const filterScenarios = [
          {
            ...DEFAULT_OLX_LEAD_FILTERS,
            categories: ["Apartament"],
            transactionType: "Vânzare" as const,
            priceMin: "150000",
            priceMax: "200000",
            surfaceMin: "70",
            surfaceMax: "90",
            rooms: ["3"],
            compartimentare: ["decomandat"],
            constructie: ["dupa-2000"],
            floors: ["fl_3"],
            zones: ["Floreasca"],
            searchText: "parcare",
          },
          {
            ...DEFAULT_OLX_LEAD_FILTERS,
            categories: ["Apartament"],
            transactionType: "Vânzare" as const,
            priceMin: "250000", // should NOT match
          },
          {
            ...DEFAULT_OLX_LEAD_FILTERS,
            categories: ["Apartament"],
            transactionType: "Închiriere" as const, // should NOT match
          },
          {
            ...DEFAULT_OLX_LEAD_FILTERS,
            rooms: ["2"], // should NOT match
          },
          {
            ...DEFAULT_OLX_LEAD_FILTERS,
            zones: ["Barbu Vacarescu"], // secondary zone captured in searchTokens
          },
          {
            ...DEFAULT_OLX_LEAD_FILTERS,
            searchText: "P17007",
          },
        ];

        for (const filter of filterScenarios) {
          const canonicalMatch = matchesOlxLeadFilter(canonical, filter);
          const slimMatch = matchesOlxLeadFilter(slimLead, filter);
          assert.equal(
            slimMatch,
            canonicalMatch,
            `Filter parity mismatch for ${JSON.stringify(filter)}: canonical=${canonicalMatch}, slim=${slimMatch}`
          );
        }
      }
    );

    // ----------------------------------------------------------------
    // TEST 3: Local Store + Mock Firestore HTTP `:commit` Atomic Dual-Write
    // ----------------------------------------------------------------
    await runTest(
      "3. CrmTenantStoreService & SharedLeadStoreService perform atomic single-:commit dual-write on create/update/soft-delete/delete/clear",
      async () => {
        // 3a. Local test store dual-write
        const tenantId = "ten_phase2_local";
        await CrmTenantStoreService.clearTenantCollection(tenantId, "leads");

        const created = await CrmTenantStoreService.create(
          tenantId,
          "leads",
          buildHeavyCanonicalLead(10, { id: "local_lead_10", tenantId }),
          "usr_owner_1"
        );
        assert.equal(created.docVersion, 1);

        const localSummary1 = await CrmTenantStoreService.getLeadSummaryById(tenantId, "local_lead_10");
        assert.ok(localSummary1, "Summary must be written automatically on create");
        assert.equal(localSummary1!.docVersion, 1);
        assert.equal(localSummary1!.priceNumeric, 185000);
        assert.equal("extractedData" in (localSummary1 as any), false);

        // Update price & title -> docVersion must advance to 2 in both docs
        const updated = await CrmTenantStoreService.update(tenantId, "leads", "local_lead_10", {
          price: "199.000 €",
          title: "Apartament 3 camere Floreasca renovat 2026",
        });
        assert.equal(updated.docVersion, 2);

        const localSummary2 = await CrmTenantStoreService.getLeadSummaryById(tenantId, "local_lead_10");
        assert.equal(localSummary2!.docVersion, 2);
        assert.equal(localSummary2!.priceNumeric, 199000);
        assert.equal(localSummary2!.deletedAt, null);

        // Soft-delete status="Sterse" -> deletedAt populated in both docs
        const softDeleted = await CrmTenantStoreService.update(tenantId, "leads", "local_lead_10", {
          status: "Sterse",
        });
        assert.equal(softDeleted.docVersion, 3);
        assert.ok(typeof softDeleted.deletedAt === "string" && softDeleted.deletedAt.length > 0);

        const localSummary3 = await CrmTenantStoreService.getLeadSummaryById(tenantId, "local_lead_10");
        assert.equal(localSummary3!.status, "Sterse");
        assert.equal(localSummary3!.docVersion, 3);
        assert.ok(localSummary3!.deletedAt, "Summary must record deletedAt on soft-delete");

        // Hard delete removes both canonical & summary
        await CrmTenantStoreService.delete(tenantId, "leads", "local_lead_10");
        assert.equal(await CrmTenantStoreService.getLeadSummaryById(tenantId, "local_lead_10"), null);

        // 3b. Real HTTP `:commit` atomic batch verification against local mock Firestore REST server
        const commitBatches: Array<{ writes: any[] }> = [];
        const mockDocs = new Map<string, { name: string; fields: Record<string, any> }>();

        const mockMetaApp = express();
        mockMetaApp.get("/computeMetadata/v1/instance/service-accounts/default/token", (_req, res) => {
          res.json({ access_token: "mock-phase2-adc-token", expires_in: 1800, token_type: "Bearer" });
        });
        mockMetaApp.get("/computeMetadata/v1/instance/service-accounts/default/email", (_req, res) => {
          res.type("text/plain").send("brokr-phase2@brokr-42038.iam.gserviceaccount.com");
        });

        const mockFsApp = express();
        mockFsApp.use(express.json({ limit: "4mb" }));
        mockFsApp.post("/v1/projects/:project/databases/:db/documents\\:commit", (req, res) => {
          const writes: any[] = Array.isArray(req.body?.writes) ? req.body.writes : [];
          commitBatches.push({ writes });
          const prefix = `projects/${req.params.project}/databases/${req.params.db}/documents/`;
          for (const w of writes) {
            if (w.update?.name) {
              const rel = String(w.update.name).slice(prefix.length);
              mockDocs.set(rel, { name: w.update.name, fields: w.update.fields || {} });
            } else if (w.delete) {
              const rel = String(w.delete).slice(prefix.length);
              mockDocs.delete(rel);
            }
          }
          res.json({ writeResults: writes.map(() => ({ updateTime: new Date().toISOString() })) });
        });
        mockFsApp.all(/^\/v1\/projects\/([^/]+)\/databases\/([^/]+)\/documents\/(.+)$/, (req, res) => {
          const project = decodeURIComponent(req.params[0]);
          const db = decodeURIComponent(req.params[1]);
          const relPath = req.params[2].split("/").map(decodeURIComponent).join("/");
          const fullName = `projects/${project}/databases/${db}/documents/${relPath}`;

          if (req.method === "GET") {
            const direct = mockDocs.get(relPath);
            if (direct) return res.json(direct);
            const segs = relPath.split("/").filter(Boolean);
            if (segs.length % 2 === 1) {
              const pfx = `${relPath}/`;
              const documents: any[] = [];
              for (const [k, v] of mockDocs.entries()) {
                if (k.startsWith(pfx) && !k.slice(pfx.length).includes("/")) {
                  documents.push(v);
                }
              }
              return res.json({ documents });
            }
            return res.status(404).json({ error: { code: 404, message: "NOT_FOUND" } });
          }
          if (req.method === "PATCH") {
            mockDocs.set(relPath, { name: fullName, fields: req.body?.fields || {} });
            return res.json(mockDocs.get(relPath));
          }
          if (req.method === "DELETE") {
            mockDocs.delete(relPath);
            return res.json({});
          }
          return res.status(405).end();
        });

        const metaSrv = await new Promise<http.Server>((r) => {
          const s = mockMetaApp.listen(0, "127.0.0.1", () => r(s));
        });
        const fsSrv = await new Promise<http.Server>((r) => {
          const s = mockFsApp.listen(0, "127.0.0.1", () => r(s));
        });

        const metaOrigin = `http://127.0.0.1:${(metaSrv.address() as any).port}`;
        const fsOrigin = `http://127.0.0.1:${(fsSrv.address() as any).port}`;

        try {
          GcpAuthService.clearTokenCache();
          GcpAuthService.setTestOrigins({ metadataOrigin: metaOrigin });
          CrmTenantStoreService.setFirestoreOriginForTests(fsOrigin);
          process.env.NODE_ENV = "production";
          process.env.K_SERVICE = "brokr-crm-backend-prod";
          process.env.USE_GCP_METADATA_AUTH = "true";

          // Tenant lead atomic create
          commitBatches.length = 0;
          await CrmTenantStoreService.create(
            "ten_atomic",
            "leads",
            buildHeavyCanonicalLead(42, { id: "atomic_42", tenantId: "ten_atomic" }),
            "usr_1"
          );
          assert.equal(commitBatches.length, 1, "Create must execute in a single atomic :commit");
          assert.equal(commitBatches[0].writes.length, 2, "Atomic :commit must contain canonical + summary writes");
          assert.ok(mockDocs.has("tenants/ten_atomic/leads/atomic_42"));
          assert.ok(mockDocs.has(`tenants/ten_atomic/${LEAD_SUMMARY_COLLECTION}/atomic_42`));
          const summaryFields = mockDocs.get(`tenants/ten_atomic/${LEAD_SUMMARY_COLLECTION}/atomic_42`)!.fields;
          assert.equal("extractedData" in summaryFields, false, "Summary write must strip extractedData");
          assert.equal("images" in summaryFields, false, "Summary write must strip images");
          assert.equal("notes" in summaryFields, false, "Summary write must strip notes");

          // Tenant lead atomic update
          commitBatches.length = 0;
          await CrmTenantStoreService.update("ten_atomic", "leads", "atomic_42", { price: "210.000 €" });
          assert.equal(commitBatches.length, 1, "Update must execute in a single atomic :commit");
          assert.equal(commitBatches[0].writes.length, 2);

          // Tenant lead atomic delete
          commitBatches.length = 0;
          await CrmTenantStoreService.delete("ten_atomic", "leads", "atomic_42");
          assert.equal(commitBatches.length, 1, "Delete must execute in a single atomic :commit");
          assert.equal(commitBatches[0].writes.length, 2);
          assert.equal(mockDocs.has("tenants/ten_atomic/leads/atomic_42"), false);
          assert.equal(mockDocs.has(`tenants/ten_atomic/${LEAD_SUMMARY_COLLECTION}/atomic_42`), false);

          // Platform shared lead atomic dual-write
          commitBatches.length = 0;
          await SharedLeadStoreService.upsertSharedLead(
            buildHeavyCanonicalLead(88, { id: "shared_88", isSharedLead: true })
          );
          assert.equal(commitBatches.length, 1, "Shared lead upsert must execute in a single atomic :commit");
          assert.equal(commitBatches[0].writes.length, 2);
          assert.ok(mockDocs.has(`${PLATFORM_SHARED_LEADS_COLLECTION}/shared_88`));
          assert.ok(mockDocs.has(`${SHARED_LEADS_SUMMARY_COLLECTION}/shared_88`));

          // Platform shared lead atomic delete
          commitBatches.length = 0;
          await SharedLeadStoreService.deleteSharedLead("shared_88");
          assert.equal(commitBatches.length, 1, "Shared lead delete must execute in a single atomic :commit");
          assert.equal(commitBatches[0].writes.length, 2);
          assert.equal(mockDocs.has(`${PLATFORM_SHARED_LEADS_COLLECTION}/shared_88`), false);
          assert.equal(mockDocs.has(`${SHARED_LEADS_SUMMARY_COLLECTION}/shared_88`), false);
        } finally {
          CrmTenantStoreService.setFirestoreOriginForTests(null);
          GcpAuthService.setTestOrigins({ metadataOrigin: null });
          GcpAuthService.clearTokenCache();
          process.env.NODE_ENV = "test";
          process.env.K_SERVICE = originalEnv.K_SERVICE;
          process.env.USE_GCP_METADATA_AUTH = originalEnv.USE_GCP_METADATA_AUTH;
          await new Promise<void>((r) => metaSrv.close(() => r()));
          await new Promise<void>((r) => fsSrv.close(() => r()));
        }
      }
    );

    // ----------------------------------------------------------------
    // TEST 4: Idempotent Backfill & Parity Reconciliation + Auto-Repair
    // ----------------------------------------------------------------
    await runTest(
      "4. Backfill job is idempotent (0 writes on 2nd run) & Reconcile job detects + auto-repairs missing/drifted/orphan summaries",
      async () => {
        const tenantId = "ten_phase2_backfill";
        const canonicalCol = `tenants__${tenantId}__leads`;
        const summaryCol = `tenants__${tenantId}__${LEAD_SUMMARY_COLLECTION}`;

        PersistentStoreService.clearCollection(canonicalCol);
        PersistentStoreService.clearCollection(summaryCol);

        // Seed 5 canonical tenant leads WITHOUT summaries (simulating pre-Phase-2 legacy data)
        for (let i = 1; i <= 5; i++) {
          PersistentStoreService.set(
            canonicalCol,
            `legacy_${i}`,
            buildHeavyCanonicalLead(i, { id: `legacy_${i}`, tenantId })
          );
        }

        // 1st backfill run -> writes 5, skips 0
        const run1 = await backfillTenantLeadSummaries(tenantId);
        assert.equal(run1.totalCanonical, 5);
        assert.equal(run1.written, 5);
        assert.equal(run1.skipped, 0);
        assert.ok(run1.maxSummaryBytes <= MAX_SUMMARY_BYTES);

        // 2nd backfill run -> strictly idempotent: writes 0, skips 5
        const run2 = await backfillTenantLeadSummaries(tenantId);
        assert.equal(run2.written, 0, "Second backfill run must perform 0 redundant writes");
        assert.equal(run2.skipped, 5);

        // Inject 3 anomalies: missing (legacy_1), drifted (legacy_2), orphan (ghost_999)
        PersistentStoreService.delete(summaryCol, "legacy_1");
        const drifted = PersistentStoreService.get<any>(summaryCol, "legacy_2")!;
        PersistentStoreService.set(summaryCol, "legacy_2", { ...drifted, priceNumeric: 1, title: "CORRUPT" });
        PersistentStoreService.set(summaryCol, "ghost_999", {
          ...drifted,
          id: "ghost_999",
          title: "Orphan Ghost",
        });

        const unhealthy = await reconcileTenantLeadSummaries(tenantId, { autoRepair: false });
        assert.equal(unhealthy.isHealthy, false);
        assert.deepEqual(unhealthy.missingIds, ["legacy_1"]);
        assert.deepEqual(unhealthy.driftedIds, ["legacy_2"]);
        assert.deepEqual(unhealthy.orphanIds, ["ghost_999"]);

        // Auto-repair must restore 100% parity
        const repaired = await reconcileTenantLeadSummaries(tenantId, { autoRepair: true });
        assert.equal(repaired.isHealthy, true);
        assert.equal(repaired.parityPercent, 100);
        assert.equal(repaired.canonicalCount, 5);
        assert.equal(repaired.summaryCount, 5);
        assert.equal(repaired.repairedCount, 3); // 1 missing + 1 drifted + 1 orphan

        // Same verification for platform_shared_leads <-> platform_shared_leads_summary
        PersistentStoreService.clearCollection(PLATFORM_SHARED_LEADS_COLLECTION);
        PersistentStoreService.clearCollection(SHARED_LEADS_SUMMARY_COLLECTION);
        for (let i = 1; i <= 3; i++) {
          PersistentStoreService.set(
            PLATFORM_SHARED_LEADS_COLLECTION,
            `shared_legacy_${i}`,
            buildHeavyCanonicalLead(100 + i, { id: `shared_legacy_${i}`, isSharedLead: true })
          );
        }

        const sharedRun1 = await backfillPlatformSharedLeadSummaries();
        assert.equal(sharedRun1.written, 3);
        const sharedRun2 = await backfillPlatformSharedLeadSummaries();
        assert.equal(sharedRun2.written, 0);
        assert.equal(sharedRun2.skipped, 3);

        PersistentStoreService.delete(SHARED_LEADS_SUMMARY_COLLECTION, "shared_legacy_1");
        const sharedRepaired = await reconcilePlatformSharedLeadSummaries({ autoRepair: true });
        assert.equal(sharedRepaired.isHealthy, true);
        assert.equal(sharedRepaired.parityPercent, 100);
        assert.equal(sharedRepaired.repairedCount, 1);
      }
    );

    // ----------------------------------------------------------------
    // TEST 5: ClientDataHub Feature Flag Routing + Safe Canonical Fallback + Detail LRU
    // ----------------------------------------------------------------
    await runTest(
      "5. ClientDataHub defaults to canonical reads, switches to leads_summary when flag ON, falls back safely on error, and hydrates canonical detail",
      async () => {
        // Default must be false
        delete process.env.VITE_USE_SLIM_SUMMARY_READS;
        delete process.env.USE_SLIM_SUMMARY_READS;
        setSlimSummaryReadsOverrideForTests(null);
        assert.equal(isSlimSummaryReadsEnabled(), false, "Slim summary reads must default to false");

        const openedCollections: string[] = [];
        const handles: Array<{
          collectionName: string;
          pushData: (items: any[]) => void;
          pushError: (err: Error) => void;
        }> = [];

        const mockTransport: DataHubTransport = {
          subscribeCollection(params, handlers) {
            openedCollections.push(params.collectionName);
            const h = {
              collectionName: params.collectionName,
              pushData: (items: any[]) => handlers.onData(items, { fromCache: false, source: "firestore" }),
              pushError: (err: Error) => handlers.onError(err),
            };
            handles.push(h);
            return () => {};
          },
          async fetchPage<T>(params: {
            collectionName: string;
            pageSize: number;
            cursor?: unknown;
          }): Promise<DataHubPageResult<T>> {
            openedCollections.push(`page:${params.collectionName}`);
            return { items: [], nextCursor: null, hasMore: false, fromCache: false };
          },
        };

        try {
          // Flag OFF -> reads canonical "leads" and "platform_shared_leads"
          setSlimSummaryReadsOverrideForTests(false);
          const hubOff = new ClientDataHub(mockTransport, { teardownGraceMs: 0 });
          hubOff.setContext({ tenantId: "ten_hub", uid: "usr_1", isPreviewMode: false });
          const uOff1 = hubOff.subscribeCollection("leads", () => {});
          const uOff2 = hubOff.subscribePlatformSharedLeads(() => {});
          assert.deepEqual(openedCollections, ["leads", "platform_shared_leads"]);
          assert.equal(hubOff.getDiagnostics().slimSummaryReadsEnabled, false);
          uOff1();
          uOff2();

          // Flag ON -> reads "leads_summary" and "platform_shared_leads_summary"
          openedCollections.length = 0;
          handles.length = 0;
          setSlimSummaryReadsOverrideForTests(true);

          const hubOn = new ClientDataHub(mockTransport, { teardownGraceMs: 0 });
          hubOn.setContext({ tenantId: "ten_hub", uid: "usr_1", isPreviewMode: false });
          let deliveredLeads: any[] = [];
          const uOn1 = hubOn.subscribeCollection("leads", (items) => {
            deliveredLeads = items;
          });
          const uOn2 = hubOn.subscribePlatformSharedLeads(() => {});

          assert.deepEqual(openedCollections, [LEAD_SUMMARY_COLLECTION, SHARED_LEADS_SUMMARY_COLLECTION]);
          assert.equal(hubOn.getDiagnostics().slimSummaryReadsEnabled, true);

          const summaryDoc = projectLeadToSummary(buildHeavyCanonicalLead(5), { tenantId: "ten_hub" });
          handles[0].pushData([summaryDoc]);
          assert.equal(deliveredLeads.length, 1);
          assert.equal(deliveredLeads[0].isSummary, true);
          assert.equal(deliveredLeads[0].coverImage, summaryDoc.coverThumbUrl);

          // Lazy canonical full-doc hydration via getDocumentById LRU cache
          let fullFetchCount = 0;
          const fullCanonical = buildHeavyCanonicalLead(5, { tenantId: "ten_hub" });
          const hydrated1 = await hubOn.getDocumentById("leads", summaryDoc.id, async () => {
            fullFetchCount++;
            return fullCanonical;
          });
          const hydrated2 = await hubOn.getDocumentById("leads", summaryDoc.id, async () => {
            fullFetchCount++;
            return fullCanonical;
          });
          assert.equal(fullFetchCount, 1, "Second detail read must hit LRU cache");
          assert.ok(hydrated1?.extractedData, "Hydrated detail doc must contain full extractedData");
          assert.deepEqual(hydrated1, hydrated2);

          // Safe fallback: if summary subscription fails (e.g. missing index/permissions), automatically falls back to canonical "leads"
          handles[0].pushError(new Error("FAILED_PRECONDITION: missing index"));
          assert.ok(
            openedCollections.includes("leads"),
            "ClientDataHub must automatically fall back to canonical 'leads' on summary transport error"
          );

          uOn1();
          uOn2();
        } finally {
          setSlimSummaryReadsOverrideForTests(null);
        }
      }
    );

    // ----------------------------------------------------------------
    // TEST 6: Express CRM Router Enforces Read-Only on `/api/crm/leads_summary`
    // ----------------------------------------------------------------
    await runTest(
      "6. Express crmRouter serves GET /api/crm/leads_summary and rejects POST/PATCH/DELETE with HTTP 403",
      async () => {
        const tenantId = "ten_agency_a";
        await CrmTenantStoreService.clearTenantCollection(tenantId, "leads");
        await CrmTenantStoreService.create(
          tenantId,
          "leads",
          buildHeavyCanonicalLead(77, { id: "api_lead_77", tenantId }),
          "usr_alpha_owner"
        );

        const app = express();
        app.use(express.json());
        app.use("/api/crm", crmRouter);

        const srv = await new Promise<http.Server>((r) => {
          const s = app.listen(0, "127.0.0.1", () => r(s));
        });
        const baseUrl = `http://127.0.0.1:${(srv.address() as any).port}`;
        const authHeaders = {
          Authorization: "Bearer token_usr_alpha_owner",
          "x-forwarded-host": "agency-a.highline.ro",
          "Content-Type": "application/json",
        };

        try {
          const getRes = await fetch(`${baseUrl}/api/crm/leads_summary`, {
            headers: authHeaders,
          });
          assert.equal(getRes.status, 200, `Expected 200 on GET /leads_summary, got ${getRes.status}`);
          const getJson = (await getRes.json()) as any;
          assert.equal(getJson.success, true);
          assert.equal(getJson.data.length, 1);
          assert.equal(getJson.data[0].id, "api_lead_77");
          assert.equal(getJson.data[0].isSummary, true);
          assert.equal("extractedData" in getJson.data[0], false);

          const postRes = await fetch(`${baseUrl}/api/crm/leads_summary`, {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({ title: "Tampered" }),
          });
          assert.equal(postRes.status, 403, `Expected 403 on POST /leads_summary, got ${postRes.status}`);

          const patchRes = await fetch(`${baseUrl}/api/crm/leads_summary/api_lead_77`, {
            method: "PATCH",
            headers: authHeaders,
            body: JSON.stringify({ title: "Tampered" }),
          });
          assert.equal(patchRes.status, 403, `Expected 403 on PATCH /leads_summary/:id, got ${patchRes.status}`);

          const delRes = await fetch(`${baseUrl}/api/crm/leads_summary/api_lead_77`, {
            method: "DELETE",
            headers: authHeaders,
          });
          assert.equal(delRes.status, 403, `Expected 403 on DELETE /leads_summary/:id, got ${delRes.status}`);
        } finally {
          await new Promise<void>((r) => srv.close(() => r()));
        }
      }
    );
  } finally {
    process.env.NODE_ENV = originalEnv.NODE_ENV;
    process.env.USE_GCP_METADATA_AUTH = originalEnv.USE_GCP_METADATA_AUTH;
    process.env.K_SERVICE = originalEnv.K_SERVICE;
    if (originalEnv.VITE_USE_SLIM_SUMMARY_READS === undefined) {
      delete process.env.VITE_USE_SLIM_SUMMARY_READS;
    } else {
      process.env.VITE_USE_SLIM_SUMMARY_READS = originalEnv.VITE_USE_SLIM_SUMMARY_READS;
    }
    if (originalEnv.USE_SLIM_SUMMARY_READS === undefined) {
      delete process.env.USE_SLIM_SUMMARY_READS;
    } else {
      process.env.USE_SLIM_SUMMARY_READS = originalEnv.USE_SLIM_SUMMARY_READS;
    }
    try {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup error
    }
  }

  console.log("\n================================================================");
  console.log(`PHASE 2 SUMMARY: ${passed} passed, ${failed} failed`);
  console.log("================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error in Phase 2 test suite:", err);
  process.exit(1);
});
