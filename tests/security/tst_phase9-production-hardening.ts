/**
 * Phase 9: Production Readiness, Infrastructure Hardening & Residual Security Verification Suite
 *
 * Validates:
 * 1. Firestore Rules static hardening & ESLint verification (no allow read: if true, email_verified required, server-only state locked)
 * 2. Durable persistence across simulated restarts (PersistentStoreService.clearMemoryCache()) + atomic concurrent billing idempotency + out-of-order replay rejection
 * 3. Twilio webhook HMAC-SHA1 verification, strict mode fail-closed, WebSocket upgrade & frontend session ownership auth
 * 4. Public property PII sanitization, SSRF protections, image magic-byte validation, rate limiter 429 + Retry-After, bounded pagination
 * 5. Production environment config fail-fast validation & secret/PII redaction in logger
 * 6. Strict file naming convention verification on Phase 9 artifacts
 */

import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import express from "express";
import { execSync } from "child_process";
import WebSocket from "ws";

// Isolate PersistentStoreService into a disposable temp path BEFORE touching services
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "brokr-phase9-"));
const tempStorePath = path.join(tempDir, "persistent-store.json");
process.env.PERSISTENT_STORE_PATH = tempStorePath;

import { PersistentStoreService } from "../../src/core/database/svc_persistent-store";
import { PreviewSessionService } from "../../src/core/tenancy/svc_preview-session";
import { BillingManager } from "../../src/core/subscription/svc_billing-manager";
import { BillingEventsRepository } from "../../src/core/subscription/repo_billing-events";
import { SubscriptionService } from "../../src/core/subscription/svc_subscription";
import { QuotaService } from "../../src/core/subscription/svc_quota";
import { TenantMembershipService } from "../../src/core/tenancy/svc_tenant-membership";
import { AiBackgroundJobService } from "../../src/core/ai/svc_ai-background-jobs";
import { AiConversationRepository } from "../../src/core/ai/repo_ai-conversation";
import { TenantScopedRepository } from "../../src/core/database/repo_tenant-scoped";
import {
  computeTwilioSignature,
  verifyTwilioSignature,
  mwTwilioSignature,
  createTwilioStreamToken,
  verifyTwilioStreamToken,
} from "../../server/middleware/mw_twilio-signature";
import { aiCallRouter, setupWebSocket } from "../../server/ai-call/router";
import { createSession } from "../../server/ai-call/sessionManager";
import { sanitizePublicProperty } from "../../server/security/sec_public-sanitizer";
import { validateSafeExternalUrl } from "../../server/security/sec_url-validator";
import { detectImageMagicBytes } from "../../server/security/sec_image-validator";
import { createRateLimiter, resetAllRateLimiters } from "../../server/middleware/mw_rate-limiter";
import { validateProductionEnvironment } from "../../src/core/env/svc_production-config";
import { redactSensitiveData, logger } from "../../src/core/logger/logger";

let passed = 0;
let failed = 0;

function recordPass(name: string) {
  console.log(`✅ [PASS] ${name}`);
  passed++;
}

function recordFail(name: string, reason: string) {
  console.error(`❌ [FAIL] ${name} -> ${reason}`);
  failed++;
}

async function withServer(
  setupFn: (app: express.Express, httpServer: http.Server) => void,
  fn: (baseUrl: string, wsBaseUrl: string) => Promise<void>
) {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  const server = http.createServer(app);
  setupFn(app, server);

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const wsBaseUrl = `ws://127.0.0.1:${address.port}`;
  try {
    await fn(baseUrl, wsBaseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function runPhase9Tests() {
  console.log("========================================================");
  console.log("🛡️ RULARE SUITĂ PHASE 9 — PRODUCTION HARDENING & SECURITY");
  console.log("========================================================");

  const originalNodeEnv = process.env.NODE_ENV;
  const originalTwilioToken = process.env.TWILIO_AUTH_TOKEN;
  const originalMockBillingFlag = process.env.ALLOW_MOCK_BILLING_IN_PRODUCTION;
  const originalPlatformUrl = process.env.PLATFORM_PUBLIC_URL;

  try {
    PersistentStoreService.clearAll();
    BillingEventsRepository.resetAll();

    // =========================================================================
    // 1. FIRESTORE RULES STATIC & LINTER VERIFICATION
    // =========================================================================
    try {
      const eslintOutput = execSync("npx eslint firestore.rules", { encoding: "utf8" });
      assert(eslintOutput !== undefined);
      const rulesContent = fs.readFileSync(path.resolve(process.cwd(), "firestore.rules"), "utf8");
      assert(!rulesContent.includes("allow read: if true"), "firestore.rules must NOT contain 'allow read: if true'");
      assert(rulesContent.includes("email_verified == true"), "isSignedIn() must require email_verified == true");
      for (const serverCol of [
        "preview_sessions",
        "billing_events",
        "billing_tenant_state",
        "subscriptions",
        "tenant_usage",
        "ai_reservations",
        "ai_jobs",
        "ai_conversations",
      ]) {
        assert(
          rulesContent.includes(`match /${serverCol}/`),
          `firestore.rules must explicitly lock server collection ${serverCol}`
        );
      }
      assert(
        rulesContent.includes("match /platform_admins/") && rulesContent.includes("allow write: if false"),
        "platform_admins must block client writes"
      );
      recordPass("TEST 1: Firestore rules ESLint valid (0 erori), fără allow read: if true, cu email_verified & server-only locks");
    } catch (err: any) {
      recordFail("TEST 1: Firestore rules verification", err?.message || String(err));
    }

    // =========================================================================
    // 2. PERSISTENCE ACROSS SIMULATED RESTART & ATOMIC CONCURRENT WEBHOOKS
    // =========================================================================
    try {
      process.env.NODE_ENV = "test";

      // 2a. Preview session persists across memory clear (restart)
      const prev = PreviewSessionService.startSession({
        tenantId: "ten_agency_a",
        superAdminUid: "usr_super_admin",
        superAdminEmail: "fountainheadro@gmail.com",
        simulatedRole: "agent",
      });

      // 2b. Subscription, Quota + AI reservation, Membership, AI job & conversation
      SubscriptionService.changePlan("ten_agency_a", "plan_enterprise", "month", "phase9_test");
      const usageBefore = QuotaService.getUsage("ten_agency_a").aiTokens;
      const reservationId = QuotaService.reserveAiQuota("ten_agency_a", 2500);
      TenantMembershipService.setMembership({
        id: "mem_phase9_persist",
        tenantId: "ten_agency_a",
        userId: "usr_phase9_persist",
        email: "persist.phase9@agency-alpha.ro",
        name: "Persist Member",
        role: "agent",
        status: "active",
        permissions: ["leads:read"],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      const job = AiBackgroundJobService.createJob(
        "ten_agency_a",
        "usr_super_admin",
        "bulk_property_extraction",
        4,
        { urls: ["https://example.com/1"] }
      );
      AiConversationRepository.save({
        id: "conv_phase9_persist",
        tenantId: "ten_agency_a",
        userId: "usr_super_admin",
        title: "Persist Chat",
        status: "active",
        messages: [{ id: "m1", role: "user", content: "Salut", timestamp: new Date().toISOString() }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // 2c. Concurrent billing webhook calls with identical eventId -> strictly ONE processes
      const eventId = `evt_concurrent_${Date.now()}`;
      const payloadBase = {
        id: eventId,
        type: "invoice.payment_succeeded",
        createdAt: new Date().toISOString(),
        data: { tenantId: "ten_agency_b", subscriptionId: "sub_phase9_order" },
      };

      const concurrentResults = await Promise.all(
        Array.from({ length: 6 }).map(() =>
          BillingManager.processWebhook(JSON.stringify(payloadBase), "mock_sig", "mock")
        )
      );
      const nonDuplicates = concurrentResults.filter((r) => r.handled && !r.duplicate);
      const duplicates = concurrentResults.filter((r) => r.duplicate);
      assert.strictEqual(nonDuplicates.length, 1, `Expected exactly 1 processed webhook, got ${nonDuplicates.length}`);
      assert.strictEqual(duplicates.length, 5, `Expected 5 duplicate rejections, got ${duplicates.length}`);

      // Record newer timestamp, then clear memory cache and test restart persistence + stale replay
      const newerTs = new Date(Date.now() + 60_000).toISOString();
      await BillingManager.processWebhook(
        JSON.stringify({
          id: `evt_newer_${Date.now()}`,
          type: "invoice.payment_succeeded",
          createdAt: newerTs,
          data: { tenantId: "ten_agency_b", subscriptionId: "sub_phase9_order" },
        }),
        "mock_sig",
        "mock"
      );

      // SIMULATE FULL PROCESS RESTART (drop in-memory cache!)
      PersistentStoreService.clearMemoryCache();

      const reloadedPreview = PreviewSessionService.getSession(prev.token);
      assert(reloadedPreview && reloadedPreview.tenantId === "ten_agency_a" && reloadedPreview.simulatedRole === "agent");

      const reloadedSub = SubscriptionService.getByTenantId("ten_agency_a");
      assert.strictEqual(reloadedSub.planId, "plan_enterprise");

      QuotaService.commitAiQuota(reservationId, 1800);
      const usageAfter = QuotaService.getUsage("ten_agency_a").aiTokens;
      assert.strictEqual(usageAfter, usageBefore + 1800, "AI reservation must survive restart and commit exact tokens");

      const membersAfterRestart = TenantMembershipService.listTenantMembers("ten_agency_a");
      assert(membersAfterRestart.some((m) => m.email === "persist.phase9@agency-alpha.ro"));

      const reloadedJob = AiBackgroundJobService.getJob("ten_agency_a", job.id);
      assert.strictEqual(reloadedJob.totalItems, 4);

      const reloadedConv = AiConversationRepository.findById("conv_phase9_persist");
      assert(reloadedConv && reloadedConv.title === "Persist Chat");

      // Post-restart replay of already processed webhook eventId MUST be duplicate
      const postRestartReplay = await BillingManager.processWebhook(JSON.stringify(payloadBase), "mock_sig", "mock");
      assert.strictEqual(postRestartReplay.duplicate, true, "Duplicate eventId must still be rejected after restart");

      // Post-restart older timestamp MUST be ignored as stale out-of-order
      const olderTs = new Date(Date.now() - 120_000).toISOString();
      const postRestartStale = await BillingManager.processWebhook(
        JSON.stringify({
          id: `evt_stale_${Date.now()}`,
          type: "invoice.payment_failed",
          createdAt: olderTs,
          data: { tenantId: "ten_agency_b", subscriptionId: "sub_phase9_order" },
        }),
        "mock_sig",
        "mock"
      );
      assert(postRestartStale.actionTaken?.includes("out-of-order"), "Stale webhook must be rejected after restart");

      recordPass("TEST 2: Persistență supraviețuire restart (clearMemoryCache) + idempotență concurentă 1/6 + protecție out-of-order");
    } catch (err: any) {
      recordFail("TEST 2: Persistence & billing idempotency", err?.message || String(err));
    }

    // =========================================================================
    // 3. TWILIO SIGNATURE, STRICT MODE & WEBSOCKET AUTH
    // =========================================================================
    try {
      const testSecret = "twilio_test_auth_secret_phase9";
      process.env.TWILIO_AUTH_TOKEN = testSecret;
      process.env.PLATFORM_PUBLIC_URL = "";

      // 3a. Stream token round-trip
      const streamToken = createTwilioStreamToken("CA_test_99");
      assert.strictEqual(verifyTwilioStreamToken("CA_test_99", streamToken), true);
      assert.strictEqual(verifyTwilioStreamToken("CA_other", streamToken), false);

      // 3b. Real HTTP & WS server testing /twiml, /stream and /frontend
      await withServer(
        (app, server) => {
          app.use("/api/ai-call", aiCallRouter);
          setupWebSocket(server);
        },
        async (baseUrl, wsBaseUrl) => {
          const twimlPath = "/api/ai-call/twiml";
          const fullUrl = `${baseUrl}${twimlPath}`;
          const postParams = { CallSid: "CA_ws_owner_test", From: "+40700000001" };
          const validSig = computeTwilioSignature(fullUrl, testSecret, postParams);

          assert.strictEqual(verifyTwilioSignature(fullUrl, validSig, testSecret, postParams), true);
          assert.strictEqual(verifyTwilioSignature(fullUrl, "bad_sig==", testSecret, postParams), false);

          // Missing signature -> 403
          const missingSigRes = await fetch(fullUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(postParams),
          });
          assert.strictEqual(missingSigRes.status, 403, "Missing X-Twilio-Signature must return 403");

          // Invalid signature -> 403
          const badSigRes = await fetch(fullUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Twilio-Signature": "invalidSignature==",
            },
            body: JSON.stringify(postParams),
          });
          assert.strictEqual(badSigRes.status, 403, "Invalid X-Twilio-Signature must return 403");

          // Valid signature -> 200 TwiML containing streamToken
          const validRes = await fetch(fullUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Twilio-Signature": validSig,
            },
            body: JSON.stringify(postParams),
          });
          assert.strictEqual(validRes.status, 200);
          const xml = await validRes.text();
          assert(xml.includes('name="streamToken"'), "TwiML response must embed signed streamToken");

          // Twilio WS upgrade without signature -> rejected (403 / unexpected-response)
          const wsDenied = await new Promise<boolean>((resolve) => {
            const client = new WebSocket(`${wsBaseUrl}/api/ai-call/stream`);
            client.on("unexpected-response", () => resolve(true));
            client.on("error", () => resolve(true));
            client.on("open", () => {
              client.close();
              resolve(false);
            });
          });
          assert.strictEqual(wsDenied, true, "Unsigned Twilio WS upgrade must be rejected");

          // Frontend WS auth & call session ownership enforcement
          process.env.NODE_ENV = "test";
          createSession("CA_owned_by_admin", "+40711111111", "Test prompt", "usr_admin_1");

          // Wrong user -> 4003 Forbidden
          const wrongUserCloseCode = await new Promise<number>((resolve) => {
            const ws = new WebSocket(`${wsBaseUrl}/api/ai-call/frontend`);
            ws.on("open", () => {
              ws.send(
                JSON.stringify({
                  type: "subscribe",
                  callSid: "CA_owned_by_admin",
                  authToken: "mock_usr_agent_1",
                })
              );
            });
            ws.on("close", (code) => resolve(code));
          });
          assert.strictEqual(wrongUserCloseCode, 4003, "Cross-user CallSid subscription must close with 4003");

          // Unauthenticated frame -> 4001 Unauthorized
          const unauthCloseCode = await new Promise<number>((resolve) => {
            const ws = new WebSocket(`${wsBaseUrl}/api/ai-call/frontend`);
            ws.on("open", () => {
              ws.send(JSON.stringify({ type: "subscribe", callSid: "CA_owned_by_admin" }));
            });
            ws.on("close", (code) => resolve(code));
          });
          assert.strictEqual(unauthCloseCode, 4001, "Unauthenticated frontend WS must close with 4001");

          // Owner receives sync
          const ownerSynced = await new Promise<boolean>((resolve) => {
            const ws = new WebSocket(`${wsBaseUrl}/api/ai-call/frontend`);
            ws.on("open", () => {
              ws.send(
                JSON.stringify({
                  type: "subscribe",
                  callSid: "CA_owned_by_admin",
                  authToken: "mock_usr_admin_1",
                })
              );
            });
            ws.on("message", (raw) => {
              const parsed = JSON.parse(raw.toString());
              if (parsed.type === "sync" && parsed.status === "calling") {
                ws.close();
                resolve(true);
              }
            });
          });
          assert.strictEqual(ownerSynced, true, "Authenticated owner must receive session sync");
        }
      );

      // 3c. Strict production fail-closed when TWILIO_AUTH_TOKEN missing
      delete process.env.TWILIO_AUTH_TOKEN;
      process.env.NODE_ENV = "production";
      await new Promise<void>((resolve, reject) => {
        const fakeReq: any = { headers: {}, method: "POST", body: {}, originalUrl: "/api/ai-call/twiml" };
        const fakeRes: any = {
          statusCode: 200,
          status(c: number) {
            this.statusCode = c;
            return this;
          },
          json() {
            try {
              assert.strictEqual(this.statusCode, 403);
              resolve();
            } catch (e) {
              reject(e);
            }
          },
        };
        mwTwilioSignature(fakeReq, fakeRes, () => reject(new Error("Should fail closed in production")));
      });

      recordPass("TEST 3: Twilio HMAC-SHA1 HTTP/WS verification, strict mode fail-closed & frontend WS ownership isolation");
    } catch (err: any) {
      recordFail("TEST 3: Twilio & WebSocket security", err?.message || String(err));
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      if (originalTwilioToken !== undefined) process.env.TWILIO_AUTH_TOKEN = originalTwilioToken;
      else delete process.env.TWILIO_AUTH_TOKEN;
      if (originalPlatformUrl !== undefined) process.env.PLATFORM_PUBLIC_URL = originalPlatformUrl;
      else delete process.env.PLATFORM_PUBLIC_URL;
    }

    // =========================================================================
    // 4. PUBLIC SANITIZER, SSRF, IMAGE MAGIC BYTES, RATE LIMITER & PAGINATION
    // =========================================================================
    try {
      // 4a. PII sanitization
      const sanitized = sanitizePublicProperty({
        id: "P100",
        title: "Apartament 2 camere Floreasca",
        price: "150.000 €",
        ownerName: "Ion Popescu",
        ownerPhone: "0722111222",
        proprietar: "Maria Ionescu",
        memoPrivat: "Cheia la vecin",
        comisioane: { procent: "3%" },
        extractedData: {
          ownerPhone: "0799000111",
          crmData: {
            proprietar: "Secret Owner",
            memoPrivat: "Negociabil până la 140k",
            descriere: { titlu: "Titlu Public" },
          },
        },
      });
      assert.strictEqual(sanitized.title, "Apartament 2 camere Floreasca");
      assert.strictEqual((sanitized as any).ownerName, undefined);
      assert.strictEqual((sanitized as any).ownerPhone, undefined);
      assert.strictEqual((sanitized as any).proprietar, undefined);
      assert.strictEqual((sanitized as any).memoPrivat, undefined);
      assert.strictEqual((sanitized as any).comisioane, undefined);
      assert.strictEqual((sanitized.extractedData as any).ownerPhone, undefined);
      assert.strictEqual((sanitized.extractedData as any).crmData.proprietar, undefined);
      assert.strictEqual((sanitized.extractedData as any).crmData.memoPrivat, undefined);
      assert.strictEqual((sanitized.extractedData as any).crmData.descriere.titlu, "Titlu Public");

      // 4b. SSRF internal targets
      for (const blockedUrl of [
        "http://127.0.0.1:3000/api/health",
        "http://169.254.169.254/latest/meta-data/",
        "http://[::1]:3000/secret",
      ]) {
        let threw = false;
        try {
          await validateSafeExternalUrl(blockedUrl);
        } catch {
          threw = true;
        }
        assert.strictEqual(threw, true, `Expected SSRF block for ${blockedUrl}`);
      }

      // 4c. Magic bytes verification
      const fakeHtml = Buffer.from("<html><body><script>alert(1)</script></body></html>", "utf8");
      const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
      const validJpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
      assert.strictEqual(detectImageMagicBytes(fakeHtml), null);
      assert.strictEqual(detectImageMagicBytes(validPng)?.mime, "image/png");
      assert.strictEqual(detectImageMagicBytes(validJpg)?.mime, "image/jpeg");

      // 4d. Rate limiter returns 429 + Retry-After
      resetAllRateLimiters();
      const limiter = createRateLimiter({ name: "phase9_test_limit", windowMs: 10_000, maxRequests: 2 });
      const invokeLimiter = () =>
        new Promise<{ status: number; headers: Record<string, string> }>((resolve) => {
          const headers: Record<string, string> = {};
          let status = 200;
          const req: any = { ip: "198.51.100.77", headers: {}, socket: {} };
          const res: any = {
            setHeader(k: string, v: string) {
              headers[k] = v;
            },
            status(c: number) {
              status = c;
              return this;
            },
            json() {
              resolve({ status, headers });
            },
          };
          limiter(req, res, () => resolve({ status: 200, headers }));
        });

      assert.strictEqual((await invokeLimiter()).status, 200);
      assert.strictEqual((await invokeLimiter()).status, 200);
      const blocked = await invokeLimiter();
      assert.strictEqual(blocked.status, 429);
      assert(blocked.headers["Retry-After"], "429 response must set Retry-After header");

      // 4e. Bounded pagination in TenantScopedRepository
      TenantScopedRepository.clearInMemoryStore();
      const repo = new TenantScopedRepository<any>(null, "leads");
      for (let i = 0; i < 15; i++) {
        await repo.create("ten_agency_a", `lead_${i}`, { name: `Lead ${i}` }, "usr_test");
      }
      const paged = await repo.list("ten_agency_a", { limit: 5 });
      assert.strictEqual(paged.items.length, 5);
      const hugeLimitCapped = await repo.list("ten_agency_a", { limit: 99999 });
      assert.strictEqual(hugeLimitCapped.items.length, 15);

      recordPass("TEST 4: Sanitizare PII publică, protecție SSRF, magic-bytes imagine, rate limiter 429 & paginare limitată");
    } catch (err: any) {
      recordFail("TEST 4: Sanitizer, SSRF, proxy & rate limiter", err?.message || String(err));
    }

    // =========================================================================
    // 5. PRODUCTION ENV VALIDATION & LOGGER SECRET REDACTION
    // =========================================================================
    try {
      const missingProd = validateProductionEnvironment({
        NODE_ENV: "production",
        ALLOW_MOCK_BILLING_IN_PRODUCTION: "false",
      });
      assert.strictEqual(missingProd.valid, false, "Production env missing GEMINI_API_KEY/Stripe must fail");
      assert(missingProd.checks.previewModeDisabledByDefault === true);

      const partialTwilioProd = validateProductionEnvironment({
        NODE_ENV: "production",
        GEMINI_API_KEY: "test_key_value",
        STRIPE_SECRET_KEY: "sk_live_dummy",
        STRIPE_WEBHOOK_SECRET: "whsec_dummy",
        TWILIO_ACCOUNT_SID: "AC_only_sid",
      });
      assert.strictEqual(partialTwilioProd.valid, false, "Partial Twilio config must fail production validation");

      const validProd = validateProductionEnvironment({
        NODE_ENV: "production",
        GEMINI_API_KEY: "test_key_value",
        STRIPE_SECRET_KEY: "sk_live_dummy",
        STRIPE_WEBHOOK_SECRET: "whsec_dummy",
        TWILIO_ACCOUNT_SID: "AC_ok",
        TWILIO_AUTH_TOKEN: "tok_ok",
        FIREBASE_PROJECT_ID: "brokr-42038",
      });
      assert.strictEqual(validProd.valid, true, `Expected valid prod config, errors: ${validProd.errors.join(",")}`);

      const redacted = redactSensitiveData({
        authorization: "Bearer eyJhbGciOiJSUzI1NiJ9.secret.sig",
        nested: {
          note: "Used key AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz and sk_live_1234567890abcdef123456 and whsec_1234567890abcdef123456",
          privateKey: "-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----",
        },
      }) as any;
      const serialized = JSON.stringify(redacted);
      assert(!serialized.includes("eyJhbGciOiJSUzI1NiJ9"), "Bearer token must be redacted");
      assert(!serialized.includes("AIzaSy"), "Google API key must be redacted");
      assert(!serialized.includes("sk_live_"), "Stripe secret key must be redacted");
      assert(!serialized.includes("whsec_"), "Stripe webhook secret must be redacted");
      assert(!serialized.includes("BEGIN PRIVATE KEY"), "Private key must be redacted");

      const metrics = logger.getOperationalMetrics();
      assert(typeof metrics.counters.auth_failure === "number");
      assert(typeof metrics.latency.p95Ms === "number");

      recordPass("TEST 5: Validare fail-closed environment producție, redactare secrete/PII & metrici operaționale");
    } catch (err: any) {
      recordFail("TEST 5: Production env & redaction", err?.message || String(err));
    }

    // =========================================================================
    // 6. NAMING CONVENTION COMPLIANCE FOR PHASE 9 FILES
    // =========================================================================
    try {
      const phase9Files = [
        "src/core/database/svc_persistent-store.ts",
        "src/core/subscription/repo_billing-events.ts",
        "src/core/env/svc_production-config.ts",
        "server/middleware/mw_twilio-signature.ts",
        "server/middleware/mw_rate-limiter.ts",
        "server/middleware/mw_observability.ts",
        "server/security/sec_public-sanitizer.ts",
        "server/security/sec_image-validator.ts",
        "tests/security/tst_phase9-production-hardening.ts",
        "docs/production/ins_deployment-checklist.md",
        "docs/production/ins_backup-recovery.md",
        "docs/production/ins_legacy-migration-status.md",
      ];
      for (const relPath of phase9Files) {
        const abs = path.resolve(process.cwd(), relPath);
        assert(fs.existsSync(abs), `Missing Phase 9 file: ${relPath}`);
        const base = path.basename(relPath);
        assert.strictEqual(base, base.toLowerCase(), `File name must be lowercase only: ${base}`);
        assert(!base.includes(" "), `File name must not contain spaces: ${base}`);
      }
      recordPass("TEST 6: Convenția de denumire strictă (lowercase, _ și -) respectată pentru toate fișierele Fazei 9");
    } catch (err: any) {
      recordFail("TEST 6: Naming convention", err?.message || String(err));
    }

    console.log("========================================================");
    console.log(`📊 REZULTATE PHASE 9 HARDENING: ${passed} trecute, ${failed} eșuate.`);
    console.log("========================================================");

    if (failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalTwilioToken !== undefined) process.env.TWILIO_AUTH_TOKEN = originalTwilioToken;
    else delete process.env.TWILIO_AUTH_TOKEN;
    if (originalMockBillingFlag !== undefined) process.env.ALLOW_MOCK_BILLING_IN_PRODUCTION = originalMockBillingFlag;
    else delete process.env.ALLOW_MOCK_BILLING_IN_PRODUCTION;
    if (originalPlatformUrl !== undefined) process.env.PLATFORM_PUBLIC_URL = originalPlatformUrl;
    else delete process.env.PLATFORM_PUBLIC_URL;
    delete process.env.PERSISTENT_STORE_PATH;
    PersistentStoreService.clearMemoryCache();

    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

runPhase9Tests();
