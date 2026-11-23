import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import express from "express";
import { PersistentStoreService } from "../../src/core/database/svc_persistent-store";
import {
  FirestoreLeaseService,
  StaleFencingTokenError,
} from "../../src/core/jobs/svc_firestore-lease";
import {
  TransactionalOutboxService,
  RetryableJobError,
  PermanentJobError,
} from "../../src/core/jobs/svc_transactional-outbox";
import { ScrapeWorkerService } from "../../server/scraping/svc_scrape-worker";
import {
  runViewingRemindersTick,
  seedNotificationMirrorForTests,
  clearNotificationMirrorForTests,
} from "../../server/background-notifications";
import {
  activeSessions,
  createSession,
  appendTranscript,
  updateSessionStatus,
  loadPersistedCallSession,
  COL_CALL_SESSIONS,
  COL_CALL_SESSION_EVENTS,
} from "../../server/ai-call/sessionManager";
import { setWorkerOidcTestKeys } from "../../server/middleware/mw_worker-oidc";
import { internalWorkersRouter } from "../../server/workers/rtr_internal-workers";

function signTestOidcJwt(params: {
  privateKey: crypto.KeyObject;
  kid: string;
  email: string;
  audience: string;
  issuer?: string;
  expiresInSec?: number;
}): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT", kid: params.kid })
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: params.issuer ?? "https://accounts.google.com",
      aud: params.audience,
      sub: "11223344556677889900",
      email: params.email,
      email_verified: true,
      iat: nowSec - 10,
      exp: nowSec + (params.expiresInSec ?? 300),
    })
  ).toString("base64url");

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();
  const sig = signer.sign(params.privateKey).toString("base64url");
  return `${header}.${payload}.${sig}`;
}

async function main() {
  let passed = 0;
  async function runTest(name: string, fn: () => Promise<void> | void) {
    await fn();
    passed++;
    console.log(`✅ [PASS] ${name}`);
  }

  console.log("================================================================");
  console.log("⚙️  BROKR PHASE 6 — WORKERS, LEASES, OUTBOX & BOUNDARIES SUITE");
  console.log("================================================================");

  // 1. Distributed Firestore Lease: 5 parallel workers, monotonic fencing tokens, stale rejection
  await runTest(
    "1. FirestoreLeaseService allows exactly 1 winner among 5 concurrent workers and rejects stale fencing tokens",
    async () => {
      FirestoreLeaseService.clearForTests();

      const nowMs = Date.now();
      const attempts = await Promise.all(
        ["worker-a", "worker-b", "worker-c", "worker-d", "worker-e"].map((ownerId) =>
          FirestoreLeaseService.acquireLease({
            lockKey: "worker:test-contention",
            ownerId,
            ttlMs: 30_000,
            nowMs,
          })
        )
      );

      const winners = attempts.filter((a) => a.acquired);
      const losers = attempts.filter((a) => !a.acquired);
      assert.equal(winners.length, 1, "Exactly 1 of 5 racing workers must win the lease");
      assert.equal(losers.length, 4, "4 racing workers must back off cleanly");
      const firstLease = winners[0].lease!;
      assert.equal(firstLease.fencingToken, 1, "Initial fencingToken must be 1");

      // Active holder can validate and renew
      await FirestoreLeaseService.assertValidFencingToken({
        lockKey: firstLease.lockKey,
        ownerId: firstLease.ownerId,
        fencingToken: 1,
        nowMs: nowMs + 5_000,
      });

      // After lease expiry, a new worker takes over and fencingToken increments monotonically (1 -> 2)
      const takeover = await FirestoreLeaseService.acquireLease({
        lockKey: firstLease.lockKey,
        ownerId: "worker-takeover",
        ttlMs: 30_000,
        nowMs: nowMs + 60_000,
      });
      assert.equal(takeover.acquired, true);
      assert.equal(takeover.lease!.fencingToken, 2, "Takeover must increment fencingToken to 2");

      // Original stale worker MUST be rejected on assert and renew, and cannot release new owner's lease
      await assert.rejects(
        () =>
          FirestoreLeaseService.assertValidFencingToken({
            lockKey: firstLease.lockKey,
            ownerId: firstLease.ownerId,
            fencingToken: 1,
            nowMs: nowMs + 61_000,
          }),
        StaleFencingTokenError
      );

      await assert.rejects(
        () =>
          FirestoreLeaseService.renewLease({
            lockKey: firstLease.lockKey,
            ownerId: firstLease.ownerId,
            fencingToken: 1,
            nowMs: nowMs + 61_000,
          }),
        StaleFencingTokenError
      );

      const staleRelease = await FirestoreLeaseService.releaseLease({
        lockKey: firstLease.lockKey,
        ownerId: firstLease.ownerId,
        fencingToken: 1,
        nowMs: nowMs + 61_000,
      });
      assert.equal(staleRelease, false, "Stale worker must NOT release newer owner's lease");

      // Active owner CAN release cleanly
      const validRelease = await FirestoreLeaseService.releaseLease({
        lockKey: firstLease.lockKey,
        ownerId: "worker-takeover",
        fencingToken: 2,
        nowMs: nowMs + 62_000,
      });
      assert.equal(validRelease, true);
    }
  );

  // 2. Transactional Outbox: idempotency replay, retryable vs dead_letter, per-tenant fairness, manual DLQ replay
  await runTest(
    "2. TransactionalOutboxService enforces idempotency, retry backoff, dead-lettering, per-tenant fairness, and manual DLQ replay",
    async () => {
      TransactionalOutboxService.clearForTests();

      // Idempotent enqueue: duplicate key returns created: false
      const first = await TransactionalOutboxService.enqueue({
        eventType: "og_regenerate",
        tenantId: "ten_agency_a",
        idempotencyKey: "og:ten_agency_a:prop_101:v1",
        payload: { propertyId: "prop_101" },
      });
      const dup = await TransactionalOutboxService.enqueue({
        eventType: "og_regenerate",
        tenantId: "ten_agency_a",
        idempotencyKey: "og:ten_agency_a:prop_101:v1",
        payload: { propertyId: "prop_101" },
      });
      assert.equal(first.created, true);
      assert.equal(dup.created, false);
      assert.equal(dup.event.id, first.event.id);

      // Atomic commit write builder produces exists:false precondition
      const commitWrite = TransactionalOutboxService.buildAtomicOutboxWrite(first.event);
      assert.deepEqual(commitWrite.currentDocument, { exists: false });
      assert.match(commitWrite.update.name, /\/documents\/outbox_events\/evt_/);

      let ogRuns = 0;
      TransactionalOutboxService.registerHandler("og_regenerate", async () => {
        ogRuns++;
      });

      // Sweep twice -> completed event MUST NOT execute a second time
      const t0 = Date.now();
      const s1 = await TransactionalOutboxService.processDueEvents({ nowMs: t0 });
      const s2 = await TransactionalOutboxService.processDueEvents({ nowMs: t0 + 1000 });
      assert.equal(s1.completed, 1);
      assert.equal(s2.processed, 0);
      assert.equal(ogRuns, 1, "Completed outbox event must execute strictly once");

      // Retryable error -> backoff -> succeeds on retry
      let flakyAttempts = 0;
      TransactionalOutboxService.registerHandler("media_cleanup", async () => {
        flakyAttempts++;
        if (flakyAttempts === 1) {
          throw new RetryableJobError("Temporary GCS 503 timeout");
        }
      });
      const flaky = await TransactionalOutboxService.enqueue({
        eventType: "media_cleanup",
        tenantId: "ten_agency_a",
        idempotencyKey: "cleanup:ten_agency_a:obj_1",
        payload: { objectKey: "obj_1" },
        maxAttempts: 3,
      });
      const r1 = await TransactionalOutboxService.processDueEvents({
        nowMs: t0 + 2000,
        baseBackoffMs: 10_000,
      });
      assert.equal(r1.retryable, 1);
      assert.equal(TransactionalOutboxService.getEvent(flaky.event.id)?.status, "retryable");

      // Before backoff elapses, not picked up
      const rEarly = await TransactionalOutboxService.processDueEvents({
        nowMs: t0 + 5_000,
        baseBackoffMs: 10_000,
      });
      assert.equal(rEarly.processed, 0);

      // After backoff elapses, picked up and completed
      const r2 = await TransactionalOutboxService.processDueEvents({
        nowMs: t0 + 20_000,
        baseBackoffMs: 10_000,
      });
      assert.equal(r2.completed, 1);
      assert.equal(TransactionalOutboxService.getEvent(flaky.event.id)?.status, "completed");

      // Permanent error -> immediate dead_letter -> audited manual replay succeeds
      let allowPortal = false;
      TransactionalOutboxService.registerHandler("portal_publish", async () => {
        if (!allowPortal) {
          throw new PermanentJobError("Invalid portal API credentials (401)");
        }
      });
      const dlqEvt = await TransactionalOutboxService.enqueue({
        eventType: "portal_publish",
        tenantId: "ten_agency_b",
        idempotencyKey: "portal:ten_agency_b:prop_99",
        payload: { propertyId: "prop_99" },
      });
      const rDlq = await TransactionalOutboxService.processDueEvents({ nowMs: t0 + 25_000 });
      assert.equal(rDlq.deadLettered, 1);
      assert.equal(TransactionalOutboxService.getEvent(dlqEvt.event.id)?.status, "dead_letter");

      // Audited manual replay by Super Admin
      allowPortal = true;
      const replayed = await TransactionalOutboxService.replayDeadLetterEvent({
        eventId: dlqEvt.event.id,
        replayedBy: "fountainheadro@gmail.com",
        nowMs: t0 + 30_000,
      });
      assert.equal(replayed.status, "pending");
      assert.equal(replayed.replayCount, 1);
      assert.equal(replayed.lastReplayedBy, "fountainheadro@gmail.com");

      const rReplay = await TransactionalOutboxService.processDueEvents({ nowMs: t0 + 31_000 });
      assert.equal(rReplay.completed, 1);
      assert.equal(TransactionalOutboxService.getEvent(dlqEvt.event.id)?.status, "completed");

      // Per-tenant fairness cap: 3 events for tenant A + 1 for tenant B with maxPerTenant=1 -> B is NOT starved
      const processedTenants: string[] = [];
      TransactionalOutboxService.registerHandler("custom", async (evt) => {
        processedTenants.push(evt.tenantId);
      });
      for (let i = 1; i <= 3; i++) {
        await TransactionalOutboxService.enqueue({
          eventType: "custom",
          tenantId: "ten_noisy",
          idempotencyKey: `fair:noisy:${i}`,
          payload: { i },
          availableAtMs: t0 + 40_000 + i,
        });
      }
      await TransactionalOutboxService.enqueue({
        eventType: "custom",
        tenantId: "ten_fair_b",
        idempotencyKey: "fair:b:1",
        payload: { i: 1 },
        availableAtMs: t0 + 40_010,
      });

      const fairSweep = await TransactionalOutboxService.processDueEvents({
        nowMs: t0 + 50_000,
        maxPerTenant: 1,
      });
      assert.equal(fairSweep.completed, 2);
      assert.equal(fairSweep.deferredByFairness, 2);
      assert.ok(processedTenants.includes("ten_noisy"));
      assert.ok(processedTenants.includes("ten_fair_b"), "Tenant B must not be starved by noisy Tenant A");
    }
  );

  // 3. OIDC-protected /internal/workers/* endpoints reject unsigned callers (403) and accept valid RS256 OIDC JWTs
  await runTest(
    "3. /internal/workers/* rejects unsigned/invalid calls with 403 and executes cleanly with valid Google OIDC JWT",
    async () => {
      FirestoreLeaseService.clearForTests();
      TransactionalOutboxService.clearForTests();

      const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
      const kid = "phase6-test-kid-1";
      const audience = "https://highline.ro";
      const workerEmail = "brokr-worker-invoker-prod@brokr-42038.iam.gserviceaccount.com";

      const prevAud = process.env.WORKER_OIDC_AUDIENCE;
      const prevEmails = process.env.WORKER_OIDC_ALLOWED_EMAILS;
      process.env.WORKER_OIDC_AUDIENCE = audience;
      process.env.WORKER_OIDC_ALLOWED_EMAILS = workerEmail;
      setWorkerOidcTestKeys({ [kid]: publicKey });

      const app = express();
      app.use(express.json());
      app.use("/internal/workers", internalWorkersRouter);

      const server = await new Promise<http.Server>((resolve) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
      });
      const port = (server.address() as { port: number }).port;
      const base = `http://127.0.0.1:${port}`;

      try {
        // Unsigned request -> 403
        const noAuth = await fetch(`${base}/internal/workers/viewing-reminders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        assert.equal(noAuth.status, 403, "Unsigned internal worker request must return 403");

        // Wrong SA email -> 403
        const wrongEmailJwt = signTestOidcJwt({
          privateKey,
          kid,
          email: "attacker@evil-project.iam.gserviceaccount.com",
          audience,
        });
        const badSaRes = await fetch(`${base}/internal/workers/outbox-dispatch`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${wrongEmailJwt}`,
          },
          body: JSON.stringify({}),
        });
        assert.equal(badSaRes.status, 403, "Unauthorized SA email must return 403");

        // Valid OIDC token -> 200 on all internal worker routes
        const validJwt = signTestOidcJwt({ privateKey, kid, email: workerEmail, audience });
        for (const route of [
          "/internal/workers/viewing-reminders",
          "/internal/workers/outbox-dispatch",
          "/internal/workers/platform-auto-crawl",
          "/internal/workers/agency-market-auto-import",
          "/internal/workers/automation-dispatch",
        ]) {
          const okRes = await fetch(`${base}${route}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${validJwt}`,
            },
            body: JSON.stringify({}),
          });
          assert.equal(okRes.status, 200, `Expected 200 for ${route}`);
          const body = await okRes.json();
          assert.equal(body.success, true, `Expected success:true for ${route}`);
        }

        const runs = TransactionalOutboxService.listJobRuns({ limit: 20 });
        assert.ok(runs.length >= 4, "Worker invocations must record audit entries in /job_runs");
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        setWorkerOidcTestKeys(null);
        if (prevAud === undefined) delete process.env.WORKER_OIDC_AUDIENCE;
        else process.env.WORKER_OIDC_AUDIENCE = prevAud;
        if (prevEmails === undefined) delete process.env.WORKER_OIDC_ALLOWED_EMAILS;
        else process.env.WORKER_OIDC_ALLOWED_EMAILS = prevEmails;
      }
    }
  );

  // 4. Multi-instance viewing reminders: 0 duplicates across 2 Cloud Run replicas with 0 open browser tabs
  await runTest(
    "4. Multi-instance viewing reminders deliver exactly 1 notification (0 duplicates across 2 replicas + repeated ticks)",
    async () => {
      FirestoreLeaseService.clearForTests();
      clearNotificationMirrorForTests();

      // Schedule a viewing exactly 60 minutes from reference `now`
      const now = new Date("2026-11-23T13:00:00");
      seedNotificationMirrorForTests({
        viewings: [
          {
            id: "view_multi_1",
            tenantId: "ten_agency_a",
            date: "2026-11-23",
            hour: "14:00",
            agentId: "uid_agent_1",
            contactName: "Ion Popescu",
            syncedAt: Date.now(),
          },
        ],
        tokens: [
          {
            token: "fcm_device_token_agent_1",
            tenantId: "ten_agency_a",
            userId: "uid_agent_1",
            updatedAt: Date.now(),
          },
        ],
      });

      const delivered: Array<{ viewingId: string; thresholdKey: string; body: string }> = [];
      const mockSend = async (payload: any) => {
        // Tiny async delay to maximize overlap between concurrent instances
        await new Promise((r) => setTimeout(r, 15));
        delivered.push({
          viewingId: payload.viewingId,
          thresholdKey: payload.thresholdKey,
          body: payload.body,
        });
      };

      // Simulate 2 Cloud Run instances triggering concurrently
      const [inst1, inst2] = await Promise.all([
        runViewingRemindersTick({ now, ownerId: "cloudrun-instance-1", sendFn: mockSend }),
        runViewingRemindersTick({ now, ownerId: "cloudrun-instance-2", sendFn: mockSend }),
      ]);

      // One executes, the other skips on lease contention
      assert.equal(
        Number(inst1.executed) + Number(inst2.executed),
        1,
        "Only 1 Cloud Run replica may hold the viewing-reminders lease concurrently"
      );

      // Even if a third tick runs 30 seconds later inside the same 2-minute window, persistent deduplication prevents duplicates
      const tick3 = await runViewingRemindersTick({
        now: new Date("2026-11-23T13:00:30"),
        ownerId: "cloudrun-instance-2",
        sendFn: mockSend,
      });
      assert.equal(tick3.executed, true);
      assert.equal(tick3.dispatchedCount, 0);
      assert.equal(tick3.deduplicatedCount, 1);

      assert.equal(delivered.length, 1, "Zero duplicate push notifications across replicas and ticks");
      assert.equal(delivered[0].thresholdKey, "60m");
      assert.match(delivered[0].body, /Ion Popescu/);
    }
  );

  // 5. Scrape workload concurrency caps + durable AI Voice transcripts across RAM restart
  await runTest(
    "5. ScrapeWorkerService enforces global max 2 browsers & per-tenant fairness cap, and AI Voice transcripts survive RAM wipe",
    async () => {
      ScrapeWorkerService.resetForTests();
      ScrapeWorkerService.setLimitsForTests({ maxGlobal: 2, maxPerTenant: 1 });

      let activeNow = 0;
      let peakObserved = 0;
      const activePerTenant = new Map<string, number>();
      let maxSameTenantObserved = 0;

      const runSlotTask = (tenantId: string, label: string) =>
        ScrapeWorkerService.withScrapeSlot({ tenantId, operation: label }, async () => {
          activeNow++;
          peakObserved = Math.max(peakObserved, activeNow);
          const tCur = (activePerTenant.get(tenantId) || 0) + 1;
          activePerTenant.set(tenantId, tCur);
          maxSameTenantObserved = Math.max(maxSameTenantObserved, tCur);

          await new Promise((r) => setTimeout(r, 25));

          activePerTenant.set(tenantId, (activePerTenant.get(tenantId) || 1) - 1);
          activeNow--;
          return label;
        });

      // Launch 6 parallel scrape tasks across 3 tenants (3 from noisy tenant A, 2 from B, 1 from C)
      const results = await Promise.all([
        runSlotTask("ten_a", "a1"),
        runSlotTask("ten_a", "a2"),
        runSlotTask("ten_a", "a3"),
        runSlotTask("ten_b", "b1"),
        runSlotTask("ten_b", "b2"),
        runSlotTask("ten_c", "c1"),
      ]);

      assert.equal(results.length, 6);
      assert.ok(peakObserved <= 2, `Global active browsers (${peakObserved}) must never exceed cap 2`);
      assert.equal(
        maxSameTenantObserved,
        1,
        `Per-tenant active browsers (${maxSameTenantObserved}) must never exceed fairness cap 1`
      );
      assert.equal(ScrapeWorkerService.getConcurrencyStats().activeGlobal, 0);

      // Agency auto-import idempotency test (second run deduplicates previously imported listing)
      const importCfg = {
        tenantId: "ten_agency_a",
        matchIntervalMinutes: 15,
        enabled: true,
      };
      const firstImport = await ScrapeWorkerService.executeAgencyMarketAutoImportJob({
        tenantId: "ten_agency_a",
        triggeredBy: "test",
        force: true,
        configsOverride: [importCfg],
        matcherExecutor: async () => [
          { sourceListingId: "olx_987654", title: "Apartament 2 camere Titan" },
        ],
      });
      const secondImport = await ScrapeWorkerService.executeAgencyMarketAutoImportJob({
        tenantId: "ten_agency_a",
        triggeredBy: "test",
        force: true,
        configsOverride: [importCfg],
        matcherExecutor: async () => [
          { sourceListingId: "olx_987654", title: "Apartament 2 camere Titan" },
        ],
      });
      assert.equal(firstImport.matchedCount, 1);
      assert.equal(secondImport.matchedCount, 0);
      assert.equal(secondImport.deduplicatedCount, 1);

      // Durable AI Voice transcript persistence across cold RAM clear
      PersistentStoreService.clearCollection(COL_CALL_SESSIONS);
      PersistentStoreService.clearCollection(COL_CALL_SESSION_EVENTS);
      activeSessions.clear();

      const sid = "CA_phase6_durable_001";
      const session = createSession(sid, "+40722111222", "Verifică disponibilitatea apartamentului", "uid_agent_1", "ten_agency_a");
      updateSessionStatus(session, "connected");
      appendTranscript(session, "system", "Conexiune stabilită.");
      appendTranscript(session, "assistant", "Bună ziua! Sun de la agenția brokr.");
      appendTranscript(session, "user", "Bună ziua, da, apartamentul este încă disponibil.");
      updateSessionStatus(session, "ended");

      // Simulate Cloud Run cold restart wiping RAM map
      activeSessions.clear();

      const reloaded = await loadPersistedCallSession(sid, "ten_agency_a");
      assert.ok(reloaded, "Persisted call session must reload cleanly after RAM wipe");
      assert.equal(reloaded!.status, "ended");
      assert.equal(reloaded!.tenantId, "ten_agency_a");
      assert.equal(reloaded!.transcript.length, 3);
      assert.deepEqual(
        reloaded!.transcript.map((t) => t.seq),
        [1, 2, 3],
        "Transcript events must preserve strict monotonic seq ordering"
      );
      assert.match(reloaded!.transcript[2].text, /încă disponibil/);
    }
  );

  // 6. Static Audit: zero browser setInterval business automation + Stage A Terraform <= 3 free scheduler jobs
  await runTest(
    "6. Zero browser setInterval business automation remains and Stage A Terraform stays within 3 free Cloud Scheduler jobs & 1 Cloud Run service",
    () => {
      const root = process.cwd();
      const retiredBrowserFiles = [
        "src/pages/platform/pg_platform-auto-crawl.tsx",
        "src/pages/agency/pg_agency-admin-piata-imobiliara.tsx",
        "src/pages/Home.tsx",
        "src/components/NotificationManager.tsx",
      ];

      for (const rel of retiredBrowserFiles) {
        const content = fs.readFileSync(path.join(root, rel), "utf8");
        assert.ok(
          !/\bsetInterval\s*\(/.test(content),
          `Browser business automation setInterval must be retired in ${rel}`
        );
      }

      const mainTf = fs.readFileSync(path.join(root, "infra/terraform/main.tf"), "utf8");
      const schedulerMatches = mainTf.match(/resource\s+"google_cloud_scheduler_job"\s+"/g) || [];
      const cloudRunMatches = mainTf.match(/resource\s+"google_cloud_run_v2_service"\s+"/g) || [];
      assert.ok(
        schedulerMatches.length >= 2 && schedulerMatches.length <= 3,
        `Stage A Terraform must stay within 3 free Cloud Scheduler jobs (found ${schedulerMatches.length})`
      );
      assert.equal(
        cloudRunMatches.length,
        1,
        `Stage A Terraform must keep 1 Cloud Run service (found ${cloudRunMatches.length})`
      );
      assert.match(mainTf, /resource\s+"google_cloud_tasks_queue"\s+"outbox"/);
      assert.match(mainTf, /ENABLE_IN_PROCESS_SCHEDULERS/);

      const rules = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");
      assert.match(rules, /match\s+\/worker_leases\/\{lockKey\}/);
      assert.match(rules, /match\s+\/outbox_events\/\{eventId\}/);
      assert.match(rules, /match\s+\/job_runs\/\{runId\}/);
      assert.match(rules, /match\s+\/call_sessions\/\{callSid\}/);
    }
  );

  console.log("================================================================");
  console.log(`🎉 PHASE 6 WORKERS & OUTBOX SUMMARY: ${passed} passed, 0 failed`);
  console.log("================================================================");
}

main().catch((err) => {
  console.error("❌ Phase 6 test suite failed:", err);
  process.exit(1);
});
