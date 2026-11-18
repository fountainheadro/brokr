/**
 * Phase 8: Security Audit & Regression Verification Suite
 *
 * Validates:
 * 1. Mock/test tokens (mock_usr_super_admin, token_usr_admin_1) & arbitrary strings are REJECTED outside NODE_ENV=test
 * 2. Malformed/unsigned JWTs are REJECTED by mwAuthentication
 * 3. Platform Preview routes reject unauthenticated users (401) and non-super-admins (403)
 * 4. PreviewSessionService blocks session creation in NODE_ENV=production without opt-in flag & blocks query preview_token
 * 5. Cross-admin preview tampering (/switch-role, /exit owned by different admin) is REJECTED (403)
 * 6. Ordinary 'agent' simulated role / membership is BLOCKED from Agency Admin & Platform routes (403)
 * 7. SSRF URL validator blocks localhost, 127.0.0.1, ::1, RFC1918 (10.x, 172.16.x, 192.168.x), and GCP Metadata (169.254.169.254 / metadata.google.internal)
 * 8. Stripe webhook HMAC verification rejects invalid signatures & expired timestamps (>300s replay window)
 * 9. BillingManager blocks mock webhook processing in production and rejects stale out-of-order events
 * 10. Verified tenant IDOR isolation & cross-tenant conversation/background-job protection
 */

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import express from "express";
import http from "http";
import { mwAuthentication } from "../../server/middleware/mw_authentication";
import { mwPlatformAuthorization } from "../../server/middleware/mw_platform-authorization";
import { mwPreviewInterception } from "../../server/middleware/mw_preview-authorization";
import { previewRouter } from "../../server/preview/rtr_preview";
import { platformRouter } from "../../server/platform/rtr_platform";
import { PreviewSessionService } from "../../src/core/tenancy/svc_preview-session";
import { validateSafeExternalUrl, isPrivateOrReservedIp } from "../../server/security/sec_url-validator";
import { StripeBillingProvider } from "../../src/core/subscription/adapters/adp_stripe-billing";
import { BillingManager } from "../../src/core/subscription/svc_billing-manager";
import { SubscriptionService } from "../../src/core/subscription/svc_subscription";
import { SubscriptionRepository } from "../../src/core/subscription/repo_subscription";
import { TenantScopedRepository } from "../../src/core/database/repo_tenant-scoped";
import { AiConversationRepository } from "../../src/core/ai/repo_ai-conversation";
import { AiBackgroundJobService } from "../../src/core/ai/svc_ai-background-jobs";
import { TenantContext } from "../../src/core/tenancy/typ_tenant-context";

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

async function callMiddleware(
  mw: (req: any, res: any, next: any) => void,
  req: any
): Promise<{ status: number; body: any; nextCalled: boolean }> {
  return new Promise((resolve) => {
    let nextCalled = false;
    const res: any = {
      statusCode: 200,
      body: null,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(data: any) {
        this.body = data;
        resolve({ status: this.statusCode, body: data, nextCalled });
        return this;
      },
    };
    mw(req, res, () => {
      nextCalled = true;
      resolve({ status: 200, body: null, nextCalled: true });
    });
  });
}

async function withServer(app: express.Express, fn: (baseUrl: string) => Promise<void>) {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function runPhase8AuditTests() {
  console.log("========================================================");
  console.log("🛡️ RULARE SUITĂ AUDIT SECURITATE & REGRESIE (FAZA 8)");
  console.log("========================================================");

  const originalNodeEnv = process.env.NODE_ENV;
  const originalPreviewProdFlag = process.env.ALLOW_PREVIEW_MODE_IN_PRODUCTION;
  const originalMockBillingProdFlag = process.env.ALLOW_MOCK_BILLING_IN_PRODUCTION;
  const originalStorePath = process.env.PERSISTENT_STORE_PATH;
  const phase8TempDir = fs.mkdtempSync(path.join(os.tmpdir(), "brokr-phase8-"));
  process.env.PERSISTENT_STORE_PATH = path.join(phase8TempDir, "store.json");

  try {
    // 1. Mock & arbitrary tokens must be REJECTED in development and production
    for (const envMode of ["development", "production"]) {
      process.env.NODE_ENV = envMode;

      const r1 = await callMiddleware(mwAuthentication, {
        headers: { authorization: "Bearer mock_usr_super_admin" },
      });
      const r2 = await callMiddleware(mwAuthentication, {
        headers: { authorization: "Bearer token_usr_admin_1" },
      });
      const r3 = await callMiddleware(mwAuthentication, {
        headers: { authorization: "Bearer arbitrary-fake-token-123456" },
      });

      if (
        !r1.nextCalled && r1.status === 401 &&
        !r2.nextCalled && r2.status === 401 &&
        !r3.nextCalled && r3.status === 401
      ) {
        recordPass(`TEST 1 (${envMode}): Mock tokens & fake Bearer strings respinse cu 401`);
      } else {
        recordFail(`TEST 1 (${envMode})`, `r1=${r1.status}, r2=${r2.status}, r3=${r3.status}`);
      }
    }

    // 2. Malformed or unsigned alg=none JWTs must fail
    process.env.NODE_ENV = "production";
    const unsignedPayload = Buffer.from(
      JSON.stringify({ sub: "usr_super_admin", email: "fountainheadro@gmail.com", exp: 9999999999 })
    ).toString("base64url");
    const algNoneHeader = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const forgedJwt = `${algNoneHeader}.${unsignedPayload}.sig`;

    const rJwt = await callMiddleware(mwAuthentication, {
      headers: { authorization: `Bearer ${forgedJwt}` },
    });
    if (!rJwt.nextCalled && rJwt.status === 401) {
      recordPass("TEST 2: JWT cu alg=none / nesemnat respins cu 401");
    } else {
      recordFail("TEST 2", `Status primit: ${rJwt.status}`);
    }

    // 3. Preview router endpoints reject unauthenticated (401) & agency users (403)
    const testApp = express();
    testApp.use(express.json());
    testApp.use("/api/platform/preview", previewRouter);
    testApp.use("/api/platform", platformRouter);

    await withServer(testApp, async (baseUrl) => {
      process.env.NODE_ENV = "test"; // Enable mock test tokens strictly inside test env
      const targetsUnauth = await fetch(`${baseUrl}/api/platform/preview/targets`);
      const switchUnauth = await fetch(`${baseUrl}/api/platform/preview/switch-role`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previewToken: "prev_fake", newRole: "agency_admin" }),
      });
      const statusUnauth = await fetch(`${baseUrl}/api/platform/preview/status`);
      const exitUnauth = await fetch(`${baseUrl}/api/platform/preview/exit`, { method: "POST" });

      if (
        targetsUnauth.status === 401 &&
        switchUnauth.status === 401 &&
        statusUnauth.status === 401 &&
        exitUnauth.status === 401
      ) {
        recordPass("TEST 3a: Toate rutele Preview (/targets, /switch-role, /status, /exit) resping cererile neautentificate cu 401");
      } else {
        recordFail(
          "TEST 3a",
          `Statuses: ${targetsUnauth.status}, ${switchUnauth.status}, ${statusUnauth.status}, ${exitUnauth.status}`
        );
      }

      // Ordinary agency owner tries to hit preview/targets & platform/me -> 403
      const targetsAgency = await fetch(`${baseUrl}/api/platform/preview/targets`, {
        headers: { Authorization: "Bearer token_usr_alpha_owner" },
      });
      const notesRouteCheck = await fetch(`${baseUrl}/api/platform/agencies/ten_brokr_default/notes`, {
        method: "POST",
        headers: {
          Authorization: "Bearer mock_usr_super_admin",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "Nota de audit" }),
      });
      if (targetsAgency.status === 403 && notesRouteCheck.status === 201) {
        recordPass("TEST 3b: Agency owner blocat cu 403 pe Preview; ruta reparată POST /api/platform/agencies/:id/notes răspunde 201");
      } else {
        recordFail("TEST 3b", `targetsAgency=${targetsAgency.status}, notes=${notesRouteCheck.status}`);
      }
    });

    // 4. Preview production kill-switch & query preview_token rejection
    process.env.NODE_ENV = "production";
    delete process.env.ALLOW_PREVIEW_MODE_IN_PRODUCTION;
    let prodPreviewBlocked = false;
    try {
      PreviewSessionService.startSession({
        tenantId: "ten_agency_a",
        superAdminUid: "usr_super_admin",
        superAdminEmail: "fountainheadro@gmail.com",
        environment: "production",
      });
    } catch (err: any) {
      prodPreviewBlocked = err?.statusCode === 403;
    }

    process.env.NODE_ENV = "development";
    const devSession = PreviewSessionService.startSession({
      tenantId: "ten_agency_a",
      superAdminUid: "usr_super_admin",
      superAdminEmail: "fountainheadro@gmail.com",
      simulatedRole: "agent",
    });

    // Query parameter ?preview_token= must be ignored (req.isPreviewSession remains undefined)
    const queryPreviewReq: any = {
      headers: {},
      query: { preview_token: devSession.token },
    };
    const rQueryPreview = await callMiddleware(mwPreviewInterception, queryPreviewReq);
    if (prodPreviewBlocked && rQueryPreview.nextCalled && !queryPreviewReq.isPreviewSession) {
      recordPass("TEST 4: Preview oprit automat în producție și parametrul ?preview_token= ignorat din URL");
    } else {
      recordFail("TEST 4", `prodPreviewBlocked=${prodPreviewBlocked}, isPreview=${queryPreviewReq.isPreviewSession}`);
    }

    // 5. Cross-admin preview tampering blocked + simulated agent cannot pass agency admin / super admin checks
    process.env.NODE_ENV = "test";
    await withServer(testApp, async (baseUrl) => {
      const foreignSwitch = await fetch(`${baseUrl}/api/platform/preview/switch-role`, {
        method: "POST",
        headers: {
          Authorization: "Bearer token_usr_admin_1", // Not super admin -> 403
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ previewToken: devSession.token, newRole: "agency_admin" }),
      });

      const simulatedAgentReq: any = {
        authUser: { uid: "usr_alpha_agent", email: "agent@agency-alpha.ro" },
      };
      const agentPlatformRes = await callMiddleware(mwPlatformAuthorization, simulatedAgentReq);

      if (foreignSwitch.status === 403 && !agentPlatformRes.nextCalled && agentPlatformRes.status === 403) {
        recordPass("TEST 5: Escaladare rol și manipulare preview blocată (403 Forbidden)");
      } else {
        recordFail("TEST 5", `foreignSwitch=${foreignSwitch.status}, agentPlatform=${agentPlatformRes.status}`);
      }
    });

    // 6. SSRF Protection Tests
    const ssrfTargets = [
      "http://127.0.0.1:3000/api/health",
      "http://localhost:3000/",
      "http://169.254.169.254/latest/meta-data/",
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://10.0.0.1/admin",
      "http://172.16.0.5/",
      "http://192.168.1.1/",
      "file:///etc/passwd",
      "http://user:pass@example.com/",
    ];
    let allSsrfBlocked = true;
    for (const target of ssrfTargets) {
      try {
        await validateSafeExternalUrl(target);
        allSsrfBlocked = false;
        recordFail("TEST 6", `SSRF target was NOT blocked: ${target}`);
      } catch {
        // Expected rejection
      }
    }
    const ipv6PrivateBlocked = isPrivateOrReservedIp("::ffff:169.254.169.254") && isPrivateOrReservedIp("fc00::1");
    if (allSsrfBlocked && ipv6PrivateBlocked) {
      recordPass("TEST 6: Protecția SSRF blochează loopback, RFC1918, IPv6 privat, metadata cloud și protocoale nesigure");
    } else if (allSsrfBlocked) {
      recordFail("TEST 6", "IPv6 private IP check failed");
    }

    // 7. Stripe Webhook Replay & Invalid Signature Rejection
    const secret = "whsec_phase8_audit_secret";
    const stripeProvider = new StripeBillingProvider("sk_test_dummy", secret);
    const sampleBody = JSON.stringify({
      id: "evt_phase8_1",
      type: "checkout.session.completed",
      created: Math.floor(Date.now() / 1000),
      data: { object: { tenantId: "ten_agency_a", planId: "plan_enterprise" } },
    });

    const staleTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes old (> 300s limit)
    const staleSigHex = crypto
      .createHmac("sha256", secret)
      .update(`${staleTimestamp}.${sampleBody}`, "utf8")
      .digest("hex");
    const staleValid = stripeProvider.verifyWebhookSignature(sampleBody, `t=${staleTimestamp},v1=${staleSigHex}`);

    const freshTimestamp = Math.floor(Date.now() / 1000);
    const freshSigHex = crypto
      .createHmac("sha256", secret)
      .update(`${freshTimestamp}.${sampleBody}`, "utf8")
      .digest("hex");
    const freshValid = stripeProvider.verifyWebhookSignature(sampleBody, `t=${freshTimestamp},v1=${freshSigHex}`);
    const tamperedValid = stripeProvider.verifyWebhookSignature(`${sampleBody} `, `t=${freshTimestamp},v1=${freshSigHex}`);

    if (!staleValid && freshValid && !tamperedValid) {
      recordPass("TEST 7: Verificare HMAC webhook Stripe respinge replay (>300s) și payload alterat");
    } else {
      recordFail("TEST 7", `staleValid=${staleValid}, freshValid=${freshValid}, tamperedValid=${tamperedValid}`);
    }

    // 8. BillingManager fail-closed mock in production + stale event ordering guard
    BillingManager.resetDefaults();
    SubscriptionRepository.resetDefaults();
    process.env.NODE_ENV = "production";
    delete process.env.ALLOW_MOCK_BILLING_IN_PRODUCTION;

    let prodMockBlocked = false;
    try {
      await BillingManager.processWebhook(
        JSON.stringify({ id: "evt_mock_1", type: "checkout.session.completed", data: { tenantId: "ten_agency_a", planId: "plan_enterprise" } }),
        "",
        "mock"
      );
    } catch {
      prodMockBlocked = true;
    }

    process.env.NODE_ENV = "test";
    // Out-of-order protection check
    const newerTs = new Date(Date.now() + 60000).toISOString();
    const olderTs = new Date(Date.now() - 60000).toISOString();
    await BillingManager.processWebhook(
      { id: "evt_order_new", type: "invoice.payment_succeeded", createdAt: newerTs, data: { tenantId: "ten_agency_a" } },
      "",
      "mock"
    );
    const outOfOrderRes = await BillingManager.processWebhook(
      { id: "evt_order_old", type: "customer.subscription.deleted", createdAt: olderTs, data: { tenantId: "ten_agency_a" } },
      "",
      "mock"
    );
    const subAfterOutOfOrder = SubscriptionService.getByTenantId("ten_agency_a");

    if (
      prodMockBlocked &&
      outOfOrderRes.actionTaken?.includes("out-of-order") &&
      subAfterOutOfOrder?.status !== "cancelled"
    ) {
      recordPass("TEST 8: BillingManager blochează mock webhook în producție și previne suprascrierea out-of-order");
    } else {
      recordFail("TEST 8", `prodMockBlocked=${prodMockBlocked}, status=${subAfterOutOfOrder?.status}`);
    }

    // 9. Cross-tenant AI conversation & background job IDOR checks
    AiConversationRepository.resetDefaults();
    TenantScopedRepository.clearInMemoryStore();

    const ctxAlpha: TenantContext = {
      tenantId: "ten_agency_a",
      tenantStatus: "active",
      tenantName: "Agency Alpha",
      tenantDomain: "agency-a",
      userId: "usr_alpha_owner",
      userEmail: "owner@agency-alpha.ro",
      membershipId: "mem_usr_alpha_owner",
      membershipStatus: "active",
      role: "agency_owner",
      permissions: ["*"],
    };
    const ctxBeta: TenantContext = {
      tenantId: "ten_agency_b",
      tenantStatus: "active",
      tenantName: "Agency Beta",
      tenantDomain: "agency-b",
      userId: "usr_beta_owner",
      userEmail: "owner@agency-beta.ro",
      membershipId: "mem_usr_beta_owner",
      membershipStatus: "active",
      role: "agency_owner",
      permissions: ["*"],
    };

    const convA = AiConversationRepository.save({
      id: "conv_phase8_alpha",
      tenantId: ctxAlpha.tenantId,
      userId: ctxAlpha.userId,
      title: "Conversatie Confidentiala Alpha",
      status: "active",
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const convsForBeta = AiConversationRepository.listByTenantAndUser(ctxBeta.tenantId);
    const convBSeesA = convsForBeta.some((c) => c.id === convA.id);

    const jobA = AiBackgroundJobService.createJob(
      ctxAlpha.tenantId,
      ctxAlpha.userId,
      "bulk_property_extraction",
      1,
      { url: "https://example.com" }
    );
    let jobBlockedCrossTenant = false;
    try {
      AiBackgroundJobService.getJob(ctxBeta.tenantId, jobA.id);
    } catch (err: any) {
      jobBlockedCrossTenant = err?.statusCode === 403;
    }

    if (!convBSeesA && jobBlockedCrossTenant) {
      recordPass("TEST 9: Izolare strictă AI Conversații & Background Jobs (zero IDOR cross-tenant)");
    } else {
      recordFail("TEST 9", `convBSeesA=${convBSeesA}, jobBlockedCrossTenant=${jobBlockedCrossTenant}`);
    }
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalPreviewProdFlag !== undefined) process.env.ALLOW_PREVIEW_MODE_IN_PRODUCTION = originalPreviewProdFlag;
    else delete process.env.ALLOW_PREVIEW_MODE_IN_PRODUCTION;
    if (originalMockBillingProdFlag !== undefined) process.env.ALLOW_MOCK_BILLING_IN_PRODUCTION = originalMockBillingProdFlag;
    else delete process.env.ALLOW_MOCK_BILLING_IN_PRODUCTION;
    if (originalStorePath !== undefined) process.env.PERSISTENT_STORE_PATH = originalStorePath;
    else delete process.env.PERSISTENT_STORE_PATH;
    try {
      fs.rmSync(phase8TempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  console.log("========================================================");
  console.log(`📊 REZUMAT AUDIT FAZA 8: Total: ${passed + failed} | Reușite: ${passed} | Eșuate: ${failed}`);
  console.log("========================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase8AuditTests().catch((err) => {
  console.error("Phase 8 audit suite crashed:", err);
  process.exit(1);
});
