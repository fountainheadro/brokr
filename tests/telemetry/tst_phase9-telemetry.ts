/**
 * Phase 9: Super Admin Pilot Monitoring, Agency Usage Attribution & Rollup Flusher Test Suite
 *
 * Verifies:
 * 1. Exact Gemini `usageMetadata` extraction, EUR cost estimation, and real per-tenant AI attribution.
 * 2. 5-minute Firestore rollup flusher skips idle periods (0 writes), persists compact PII-free rollups with TTL `expiresAt`.
 * 3. Stage A hard write budget guard (< 500 Firestore writes/day).
 * 4. Explicit provenance separation (`Core API · Measured`, `Cloud Monitoring · Exact`, `Client Heartbeat · Estimated`) & defensive heartbeat capping.
 * 5. Zero hardcoded synthetic demo numbers in `/api/platform/dashboard/stats` and `/api/platform/ai-usage` + real storage & portal stats.
 * 6. Dead-lettered job visibility and audited manual replay via `POST /api/platform/performance/outbox/:eventId/replay`.
 * 7. Strict Super Admin RBAC (401 unauth, 403 agent/owner, 200 Super Admin) & `ENABLE_PLATFORM_PERFORMANCE_DASHBOARD` feature flag gating.
 * 8. Firestore security rules lock `/platform_telemetry_rollups` & `/platform_agency_usage_rollups` to `isPlatformAdmin()` read / `write: if false`, and `JetBrains Mono` typography token is active.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import http from "node:http";
import { platformRouter } from "../../server/platform/rtr_platform";
import { mwObservability } from "../../server/middleware/mw_observability";
import {
  COL_PLATFORM_AGENCY_USAGE_ROLLUPS,
  COL_PLATFORM_TELEMETRY_ROLLUPS,
  PROVENANCE_LABELS,
  TelemetryCollectorService,
  estimateGeminiCostEur,
  extractGeminiUsageMetadata,
} from "../../src/core/telemetry/svc_telemetry-collector";
import { PersistentStoreService } from "../../src/core/database/svc_persistent-store";
import { QuotaService } from "../../src/core/subscription/svc_quota";
import { StorageMetadataRepository } from "../../src/core/storage/repo_storage-metadata";
import { TransactionalOutboxService } from "../../src/core/jobs/svc_transactional-outbox";
import { PlatformAuditLogRepository } from "../../src/core/platform/repo_platform-audit-log";
import { PlatformAdminService } from "../../src/core/platform/svc_platform-admin";
import { logger } from "../../src/core/logger/logger";
import { typographyTokens } from "../../design/tokens/typography/typography";

interface TestResult {
  id: string;
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

async function runTest(id: string, name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    results.push({ id, name, passed: true });
    console.log(`✅ [PASS] ${id}: ${name}`);
  } catch (err: any) {
    const msg = err?.message || String(err);
    results.push({ id, name, passed: false, error: msg });
    console.error(`❌ [FAIL] ${id}: ${name} -> ${msg}`);
  }
}

async function createTestHttpServer(): Promise<{ server: http.Server; baseUrl: string }> {
  const app = express();
  app.use(express.json());
  app.use(mwObservability);

  // Inject test Super Admin token mapping via header when using x-test-superadmin
  app.use("/api/platform", (req, _res, next) => {
    if (req.headers["x-test-superadmin"] === "true") {
      req.headers.authorization = "Bearer test_superadmin_token";
      req.authToken = "test_superadmin_token";
      req.authUser = {
        uid: "usr_super_admin",
        email: "fountainheadro@gmail.com",
        name: "Platform Super Admin",
        emailVerified: true,
      };
    }
    next();
  });
  app.use("/api/platform", platformRouter);

  const server = await new Promise<http.Server>((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
  });
  const addr = server.address() as { port: number };
  return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
}

async function main() {
  console.log("\n=============================================================");
  console.log("📊 RULARE TESTE FAZA 9 — TELEMETRIE PILOT & ATRIBUIRE AGENȚII");
  console.log("=============================================================\n");

  TelemetryCollectorService.clearForTests();
  logger.resetMetricsForTests();
  QuotaService.resetDefaults();
  PersistentStoreService.clearCollection("outbox_events");
  PersistentStoreService.clearCollection("job_runs");
  PersistentStoreService.clearCollection("storage_objects");
  PersistentStoreService.clearCollection("platform_audit_logs");

  // Ensure bootstrap super admin is recognized
  assert.equal(
    PlatformAdminService.isPlatformAdmin("usr_super_admin", "fountainheadro@gmail.com"),
    true
  );

  // TEST 1: Exact Gemini usageMetadata extraction & EUR cost estimation
  await runTest(
    "TEST 1",
    "Extragere exactă Gemini usageMetadata, calcul cost EUR și atribuire pe agenție",
    () => {
      const mockGeminiResponse = {
        usageMetadata: {
          promptTokenCount: 12000,
          candidatesTokenCount: 3000,
          totalTokenCount: 15000,
        },
      };

      const extracted = extractGeminiUsageMetadata({
        model: "gemini-4-hydrogen",
        response: mockGeminiResponse,
      });

      assert.equal(extracted.usedExactMetadata, true);
      assert.equal(extracted.promptTokens, 12000);
      assert.equal(extracted.outputTokens, 3000);
      assert.equal(extracted.totalTokens, 15000);
      assert.ok(extracted.estimatedCostEur > 0, "Estimated EUR cost must be > 0");

      const flashCost = estimateGeminiCostEur("gemini-3.1-flash-lite", 100_000, 20_000);
      const proCost = estimateGeminiCostEur("gemini-4-hydrogen", 100_000, 20_000);
      assert.ok(proCost > flashCost, "Pro/Hydrogen tier cost must exceed Flash-lite tier cost");

      TelemetryCollectorService.recordGeminiResponseForTenant({
        tenantId: "ten_agency_a",
        model: "gemini-4-hydrogen",
        response: mockGeminiResponse,
      });

      const realUsage = TelemetryCollectorService.getRealAgencyAiUsage();
      const rowA = realUsage.find((r) => r.tenantId === "ten_agency_a");
      assert.ok(rowA, "ten_agency_a must appear in real AI usage");
      assert.equal(rowA.provenance, "core_api_measured");
      assert.equal(rowA.provenanceLabel, PROVENANCE_LABELS.core_api_measured);
      assert.equal(rowA.topModel, "gemini-4-hydrogen");
      assert.ok(rowA.promptTokens >= 12000);
      assert.ok(rowA.outputTokens >= 3000);
    }
  );

  // TEST 2: 5-minute rollup flusher skips idle (0 writes) and writes compact PII-free docs with TTL
  await runTest(
    "TEST 2",
    "Rollup flusher: 0 scrieri în repaus, documente compacte fără PII cu expiresAt TTL la activitate",
    async () => {
      TelemetryCollectorService.clearForTests();

      const idleFlush = await TelemetryCollectorService.flushRollups();
      assert.equal(idleFlush.flushed, false);
      assert.equal(idleFlush.writtenDocs, 0);
      assert.equal(idleFlush.skippedReason, "zero_delta");

      TelemetryCollectorService.recordApiRequest({
        tenantId: "ten_brokr_default",
        userId: "usr_agent_1",
        statusCode: 200,
        durationMs: 118,
      });
      TelemetryCollectorService.recordApiRequest({
        tenantId: "ten_brokr_default",
        userId: "usr_agent_1",
        statusCode: 404,
        durationMs: 42,
      });
      TelemetryCollectorService.recordAiUsage({
        tenantId: "ten_brokr_default",
        model: "gemini-3.1-flash-lite",
        promptTokens: 4500,
        outputTokens: 1200,
        totalTokens: 5700,
      });

      const activeFlush = await TelemetryCollectorService.flushRollups();
      assert.equal(activeFlush.flushed, true);
      assert.equal(activeFlush.writtenDocs, 2); // 1 global + 1 agency rollup

      const globalDocs = Object.values(
        PersistentStoreService.getAll<any>(COL_PLATFORM_TELEMETRY_ROLLUPS)
      );
      const agencyDocs = Object.values(
        PersistentStoreService.getAll<any>(COL_PLATFORM_AGENCY_USAGE_ROLLUPS)
      );
      assert.equal(globalDocs.length, 1);
      assert.equal(agencyDocs.length, 1);

      const gDoc = globalDocs[0];
      const aDoc = agencyDocs[0];
      assert.equal(gDoc.apiRequests, 2);
      assert.equal(gDoc.api4xx, 1);
      assert.equal(gDoc.aiTotalTokens, 5700);
      assert.ok(Date.parse(gDoc.expiresAt) > Date.now() + 50 * 86_400_000, "Global rollup must have >=60d TTL");
      assert.ok(Date.parse(aDoc.expiresAt) > Date.now() + 80 * 86_400_000, "Agency rollup must have >=90d TTL");

      // Strict PII-free verification
      const serialized = JSON.stringify({ gDoc, aDoc }).toLowerCase();
      for (const forbidden of ["email", "phone", "telefon", "adresa", "ownername", "usr_agent_1"]) {
        assert.ok(!serialized.includes(forbidden), `Rollup document leaked forbidden PII token: ${forbidden}`);
      }

      // Immediately flushing again must skip with zero_delta
      const secondIdleFlush = await TelemetryCollectorService.flushRollups();
      assert.equal(secondIdleFlush.flushed, false);
      assert.equal(secondIdleFlush.writtenDocs, 0);
      assert.equal(secondIdleFlush.skippedReason, "zero_delta");
    }
  );

  // TEST 3: Stage A daily write budget guard (< 500 Firestore writes/day)
  await runTest(
    "TEST 3",
    "Protecție buget zilnic Stage A (< 500 scrieri Firestore/zi)",
    async () => {
      const snapshot = await TelemetryCollectorService.buildPerformanceSnapshot();
      assert.equal(snapshot.rollups.maxDailyWriteBudget, 500);
      assert.equal(snapshot.rollups.writesToday, 2);
      assert.ok(
        snapshot.rollups.writesToday < snapshot.rollups.maxDailyWriteBudget,
        "Daily writes must stay strictly below 500 in Stage A"
      );
    }
  );

  // TEST 4: Explicit provenance tags & defensive client heartbeat capping
  await runTest(
    "TEST 4",
    "Etichete explicite de proveniență și limitare defensivă Client Heartbeat Estimated",
    async () => {
      TelemetryCollectorService.recordClientHeartbeat({
        tenantId: "ten_brokr_default",
        sessionId: "sess_browser_1",
        activeListeners: 9999, // must be clamped to 50
        clientReadsDelta: 999999, // must be clamped to 2000
      });

      const snapshot = await TelemetryCollectorService.buildPerformanceSnapshot();
      assert.equal(snapshot.summary.provenanceLabel, "Core API · Measured");
      assert.equal(snapshot.cloudMonitoring.provenanceLabel, "Cloud Monitoring · Exact");
      assert.equal(snapshot.clientHeartbeat.provenanceLabel, "Client Heartbeat · Estimated");
      assert.equal(snapshot.clientHeartbeat.activeListenersEstimated, 50);
      assert.equal(snapshot.clientHeartbeat.clientReadsEstimated, 2000);
      assert.equal(snapshot.clientHeartbeat.activeTabsEstimated, 1);
    }
  );

  // TEST 5: Real measured stats on /api/platform/dashboard/stats & /api/platform/ai-usage (zero hardcoded demo numbers)
  const { server, baseUrl } = await createTestHttpServer();
  try {
    await runTest(
      "TEST 5",
      "Eliminare cifre sintetice din /dashboard/stats și /ai-usage + atribuire stocare reală",
      async () => {
        // Seed real storage object for ten_agency_b (5 MB)
        const nowIso = new Date().toISOString();
        StorageMetadataRepository.saveObject({
          objectKey: "tenants/ten_agency_b/properties/p1/living.webp",
          tenantId: "ten_agency_b",
          entityType: "properties",
          entityId: "p1",
          fileName: "living.webp",
          originalFileName: "living.webp",
          mimeType: "image/webp",
          sizeBytes: 5 * 1024 * 1024,
          sha256: "test_sha256_phase9_1",
          visibility: "public_listing",
          uploadedByUserId: "usr_beta_owner",
          bucketName: "test-bucket",
          backend: "local_isolated",
          createdAt: nowIso,
          updatedAt: nowIso,
        });

        const [statsRes, aiRes] = await Promise.all([
          fetch(`${baseUrl}/api/platform/dashboard/stats`, {
            headers: { "x-test-superadmin": "true" },
          }),
          fetch(`${baseUrl}/api/platform/ai-usage`, {
            headers: { "x-test-superadmin": "true" },
          }),
        ]);

        assert.equal(statsRes.status, 200);
        assert.equal(aiRes.status, 200);

        const statsJson: any = await statsRes.json();
        const aiJson: any = await aiRes.json();

        assert.equal(statsJson.success, true);
        assert.equal(statsJson.data.provenanceLabel, "Core API · Measured");
        // Verify old hardcoded demo numbers are gone
        assert.notEqual(statsJson.data.totalStorageMb, 4850);
        assert.notEqual(statsJson.data.totalAiTokensUsed, 1420000);
        assert.notEqual(statsJson.data.totalAiRequests, 3840);
        assert.notEqual(statsJson.data.estimatedAiCostEur, 18.45);

        assert.equal(aiJson.success, true);
        const primaryRow = aiJson.data.find((r: any) => r.tenantId === "ten_brokr_default");
        assert.ok(primaryRow, "Primary agency row expected");
        assert.notEqual(primaryRow.tokensUsed, 820000, "Hardcoded 820000 demo tokens must be removed");
        assert.equal(primaryRow.provenanceLabel, "Core API · Measured");
      }
    );

    // TEST 6: Dead-lettered job visibility & audited manual replay
    await runTest(
      "TEST 6",
      "Vizibilitate Dead-Letter Queue și reluare manuală auditată via /performance/outbox/:eventId/replay",
      async () => {
        const { event: evt } = await TransactionalOutboxService.enqueue({
          eventType: "portal_publish",
          tenantId: "ten_brokr_default",
          idempotencyKey: "phase9_dlq_test_key_1",
          payload: { propertyId: "P900", providerId: "storia" },
          maxAttempts: 1,
        });

        // Move event to dead_letter via a single failed attempt
        TransactionalOutboxService.registerHandler("portal_publish", async () => {
          throw new Error("Simulated upstream 503 for Phase 9 DLQ test");
        });
        try {
          const drain = await TransactionalOutboxService.processDueEvents({
            limit: 10,
          });
          assert.ok(drain.deadLettered >= 1, "Enqueued outbox event must transition to dead_letter");
        } finally {
          TransactionalOutboxService.unregisterHandler("portal_publish");
        }

        const perfBeforeRes = await fetch(`${baseUrl}/api/platform/performance`, {
          headers: { "x-test-superadmin": "true" },
        });
        assert.equal(perfBeforeRes.status, 200);
        const perfBefore: any = await perfBeforeRes.json();
        const dlqEntry = perfBefore.data.workers.deadLetterEvents.find((e: any) => e.id === evt.id);
        assert.ok(dlqEntry, "Dead-lettered event must be visible in /api/platform/performance");

        // Trigger audited Super Admin replay
        const replayRes = await fetch(
          `${baseUrl}/api/platform/performance/outbox/${encodeURIComponent(evt.id)}/replay`,
          {
            method: "POST",
            headers: { "x-test-superadmin": "true" },
          }
        );
        assert.equal(replayRes.status, 200);
        const replayJson: any = await replayRes.json();
        assert.equal(replayJson.success, true);
        assert.equal(replayJson.data.status, "pending");
        assert.equal(replayJson.data.replayCount, 1);

        // Confirm immutable PlatformAuditLogRepository entry was recorded
        const auditResult = await PlatformAuditLogRepository.list({
          action: "outbox_dead_letter_replayed",
          limit: 10,
        });
        const auditEntry = auditResult.items.find((i) => i.targetId === evt.id);
        assert.ok(auditEntry, "Audited DLQ replay must be logged in PlatformAuditLogRepository");
        assert.equal(auditEntry.actorEmail, "fountainheadro@gmail.com");
      }
    );

    // TEST 7: Strict Super Admin RBAC & feature flag gating
    await runTest(
      "TEST 7",
      "RBAC strict Super Admin (401/403/200) și feature flag ENABLE_PLATFORM_PERFORMANCE_DASHBOARD",
      async () => {
        const unauthRes = await fetch(`${baseUrl}/api/platform/performance`);
        assert.equal(unauthRes.status, 401, "Unauthenticated request must return 401");

        const agentRes = await fetch(`${baseUrl}/api/platform/performance`, {
          headers: { Authorization: "Bearer token_usr_agent_1" },
        });
        assert.equal(agentRes.status, 403, "Agency agent must be denied with 403");

        const ownerRes = await fetch(`${baseUrl}/api/platform/performance`, {
          headers: { Authorization: "Bearer token_usr_alpha_owner" },
        });
        assert.equal(ownerRes.status, 403, "Agency owner must be denied with 403");

        const adminRes = await fetch(`${baseUrl}/api/platform/performance`, {
          headers: { "x-test-superadmin": "true" },
        });
        assert.equal(adminRes.status, 200, "Super Admin must receive 200");

        // Verify feature flag disable behavior
        const prevFlag = process.env.ENABLE_PLATFORM_PERFORMANCE_DASHBOARD;
        process.env.ENABLE_PLATFORM_PERFORMANCE_DASHBOARD = "false";
        try {
          const disabledRes = await fetch(`${baseUrl}/api/platform/performance`, {
            headers: { "x-test-superadmin": "true" },
          });
          assert.equal(disabledRes.status, 200);
          const disabledJson: any = await disabledRes.json();
          assert.equal(disabledJson.data.dashboardEnabled, false);
        } finally {
          if (prevFlag === undefined) delete process.env.ENABLE_PLATFORM_PERFORMANCE_DASHBOARD;
          else process.env.ENABLE_PLATFORM_PERFORMANCE_DASHBOARD = prevFlag;
        }
      }
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  // TEST 8: Firestore security rules & JetBrains Mono typography verification
  await runTest(
    "TEST 8",
    "Reguli Firestore stricte pentru rollup-uri și token tipografic JetBrains Mono",
    () => {
      const rulesText = fs.readFileSync(path.resolve(process.cwd(), "firestore.rules"), "utf8");
      assert.ok(
        /match\s+\/platform_telemetry_rollups\/\{rollupId\}\s*\{[\s\S]*?allow get, list:\s*if isPlatformAdmin\(\);[\s\S]*?allow write:\s*if false;/m.test(
          rulesText
        ),
        "firestore.rules must lock /platform_telemetry_rollups to isPlatformAdmin() read & write: if false"
      );
      assert.ok(
        /match\s+\/platform_agency_usage_rollups\/\{rollupId\}\s*\{[\s\S]*?allow get, list:\s*if isPlatformAdmin\(\);[\s\S]*?allow write:\s*if false;/m.test(
          rulesText
        ),
        "firestore.rules must lock /platform_agency_usage_rollups to isPlatformAdmin() read & write: if false"
      );
      assert.ok(
        typographyTokens.fonts.mono.includes("JetBrains Mono"),
        "typographyTokens.fonts.mono must use JetBrains Mono"
      );
    }
  );

  // TEST 9: Background flushRollups in non-test mode without server ADC never throws 503
  await runTest(
    "TEST 9",
    "Rollup flusher în mod development fără server ADC salvează în cache fără eroare 503",
    async () => {
      const prevEnv = process.env.NODE_ENV;
      try {
        TelemetryCollectorService.clearForTests();
        process.env.NODE_ENV = "development";
        TelemetryCollectorService.recordApiRequest({
          tenantId: "ten_brokr_default",
          userId: "usr_agent_bg",
          statusCode: 200,
          durationMs: 75,
        });
        const flushRes = await TelemetryCollectorService.flushRollups();
        assert.equal(flushRes.flushed, true);
        assert.equal(flushRes.writtenDocs, 2);

        const secondFlush = await TelemetryCollectorService.flushRollups();
        assert.equal(secondFlush.flushed, false);
        assert.equal(secondFlush.skippedReason, "zero_delta");
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
    }
  );

  const failed = results.filter((r) => !r.passed);
  console.log(`\nRezultat final Faza 9: ${results.length - failed.length}/${results.length} teste trecute.`);
  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Eroare fatală în suita de teste Faza 9:", err);
  process.exit(1);
});
