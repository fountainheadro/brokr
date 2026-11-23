/**
 * Phase 3: Security, Tenant Isolation & Authorization Hardening Verification Suite
 *
 * Verifies every Phase 3 deliverable (zero Redis coupling):
 * 1. High-cost route wiring in `server.ts` & live Express enforcement:
 *    - Unauthenticated -> 401
 *    - Cross-tenant -> 403
 *    - Suspended agency -> 403
 *    - Suspended/revoked member -> 403
 *    - Quota exceeded -> 429
 * 2. Rate limiter anti-spoofing under `app.set("trust proxy", 1)`:
 *    - Rotating spoofed leftmost `X-Forwarded-For` values cannot bypass the per-IP rate limit
 * 3. Scoped body size limits:
 *    - Global `2mb` cap rejects `> 2mb` JSON payloads on standard routes with `413`
 *    - `/api/upload-photo` & `/api/storage/*` accept `> 2mb` payloads up to `50mb`
 * 4. `CloudStorageService` signing secret persistence & fail-closed production guard:
 *    - Signed URL minted with `STORAGE_SIGNING_SECRET` verifies cleanly after simulated cold restart
 *    - Production fails closed (`503`) if `STORAGE_SIGNING_SECRET` is unset without explicit ephemeral opt-in
 * 5. `authVersion` revocation lifecycle & compact Custom Claims adapter:
 *    - Member role/status change bumps `membership.authVersion`
 *    - Tenant suspension bumps `tenant.authVersion`
 *    - Stale `uVer`, stale `tVer`, or cross-tenant `tid` claims are rejected immediately (`403 AUTH_REVOKED`)
 *    - `CustomClaimsService.buildCompactClaims()` stays `< 300 bytes` and remains a safe no-op when disabled
 * 6. Google OIDC RS256 internal worker authentication (`mw_worker-oidc.ts`):
 *    - Rejects missing header, forged signature, wrong audience, expired token, and unallowlisted SA email (`403`)
 *    - Accepts genuine RS256 signed OIDC token from allowlisted service account (`200`)
 * 7. `QuotaService` demo-seeding hygiene:
 *    - Non-test environments (`production`/`development`) start at 0 real usage (no hardcoded `INITIAL_USAGE`)
 */

import fs from "fs";
import path from "path";
import http from "http";
import crypto from "crypto";
import express from "express";
import { requireTenantContext } from "../../server/middleware/mw_tenant-context";
import { requireQuota } from "../../server/middleware/mw_entitlement";
import { createRateLimiter } from "../../server/middleware/mw_rate-limiter";
import { requireWorkerOidc, setWorkerOidcTestKeys } from "../../server/middleware/mw_worker-oidc";
import { CloudStorageService } from "../../src/core/storage/svc_cloud-storage";
import { QuotaService } from "../../src/core/subscription/svc_quota";
import { TenantMembershipService } from "../../src/core/tenancy/svc_tenant-membership";
import { TenantResolutionService } from "../../src/core/tenancy/svc_tenant-resolution";
import { CustomClaimsService, MAX_CUSTOM_CLAIMS_BYTES } from "../../src/core/auth/svc_custom-claims";

let passed = 0;
let failed = 0;

function pass(label: string) {
  console.log(`✅ [PASS] ${label}`);
  passed++;
}

function fail(label: string, reason: string) {
  console.error(`❌ [FAIL] ${label} -> ${reason}`);
  failed++;
}

function assertCheck(condition: boolean, label: string, reason: string) {
  if (condition) {
    pass(label);
  } else {
    fail(label, reason);
  }
}

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function signTestJwt(
  privateKeyPem: string,
  kid: string,
  payload: Record<string, any>
): string {
  const headerB64 = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT", kid }));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${headerB64}.${payloadB64}`);
  signer.end();
  const signature = signer.sign(privateKeyPem);
  return `${headerB64}.${payloadB64}.${base64UrlEncode(signature)}`;
}

async function sendHttp(
  baseUrl: string,
  route: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: any;
  } = {}
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${route}`, {
    method: options.method || "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body !== undefined ? (typeof options.body === "string" ? options.body : JSON.stringify(options.body)) : undefined,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

async function runTests() {
  console.log("================================================================");
  console.log("🛡️  BROKR PHASE 3 — SECURITY & AUTHORIZATION HARDENING SUITE");
  console.log("================================================================");

  QuotaService.resetDefaults();

  // --- 1. Verify server.ts static route hardening & configuration ---
  const serverSource = fs.readFileSync(path.join(process.cwd(), "server.ts"), "utf8");
  assertCheck(
    serverSource.includes('app.set("trust proxy"') && !serverSource.includes("app.set('trust proxy', true)"),
    "server.ts sets explicit bounded trust proxy hop count (not wildcard true)",
    "server.ts still uses unbounded trust proxy: true"
  );
  assertCheck(
    serverSource.includes('limit: "2mb"') &&
      serverSource.includes('req.path === "/api/upload-photo" || req.path.startsWith("/api/storage")'),
    "server.ts enforces 2mb global JSON cap and scopes 50mb strictly to upload/storage routes",
    "Missing 2mb global limit or upload-scoped 50mb parser in server.ts"
  );

  const highCostRoutes = [
    "/api/upload-photo",
    "/api/extract-basic",
    "/api/extract-data",
    "/api/generate-ai-text",
    "/api/parse-listing-html",
    "/api/crawl",
    "/api/crawl-basic",
  ];
  for (const route of highCostRoutes) {
    const escaped = route.replace(/\//g, "\\/");
    const regex = new RegExp(`app\\.post\\("${escaped}",\\s*\\.\\.\\.requireTenantContext`);
    assertCheck(
      regex.test(serverSource),
      `server.ts enforces requireTenantContext on ${route}`,
      `${route} is missing ...requireTenantContext middleware in server.ts`
    );
  }
  assertCheck(
    serverSource.includes('app.post("/api/internal/workers/ping", requireWorkerOidc()'),
    "server.ts mounts /api/internal/workers/ping behind requireWorkerOidc()",
    "Missing OIDC-protected internal worker endpoint in server.ts"
  );

  // --- Build live Express test server mirroring Phase 3 server.ts middleware stack ---
  const app = express();
  app.set("trust proxy", 1);

  const standardJson = express.json({ limit: "2mb" });
  const uploadJson = express.json({ limit: "50mb" });
  app.use((req, res, next) => {
    if (req.path === "/api/upload-photo" || req.path.startsWith("/api/storage")) {
      return uploadJson(req, res, next);
    }
    return standardJson(req, res, next);
  });

  const strictIpLimiter = createRateLimiter({
    name: "phase3-spoof-test",
    windowMs: 60_000,
    maxRequests: 3,
  });

  app.post("/api/test-rate-limit", strictIpLimiter, (req, res) => {
    res.json({ success: true, ip: req.ip });
  });

  app.post(
    "/api/extract-basic",
    ...requireTenantContext,
    requireQuota("ai_requests", 1),
    (req, res) => {
      QuotaService.consumeQuota(req.tenantContext!.tenantId, "ai_requests", 1);
      res.json({ success: true, tenantId: req.tenantContext!.tenantId });
    }
  );

  app.post(
    "/api/upload-photo",
    ...requireTenantContext,
    requireQuota("storage_mb", 1),
    (req, res) => {
      res.json({
        success: true,
        tenantId: req.tenantContext!.tenantId,
        payloadBytes: String(req.body?.dataUrl || "").length,
      });
    }
  );

  app.post(
    "/api/internal/workers/ping",
    requireWorkerOidc({
      expectedAudience: "https://brokr-worker.run.app",
      allowedEmails: ["brokr-tasks@brokr-42038.iam.gserviceaccount.com"],
    }),
    (req, res) => {
      res.json({ success: true, worker: req.workerIdentity?.email });
    }
  );

  const server = await new Promise<http.Server>((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // --- 2. High-cost route auth, tenant isolation, suspension & quota enforcement ---
    const unauth = await sendHttp(baseUrl, "/api/extract-basic", { body: { title: "Test" } });
    assertCheck(unauth.status === 401, "High-cost route rejects unauthenticated caller (401)", `Got ${unauth.status}`);

    const crossTenant = await sendHttp(baseUrl, "/api/extract-basic", {
      headers: {
        Authorization: "Bearer token_usr_alpha_owner",
        "x-tenant-override": "agency-b.highline.ro",
      },
      body: { title: "Cross-tenant attempt" },
    });
    assertCheck(
      crossTenant.status === 403,
      "High-cost route rejects cross-tenant caller (403)",
      `Got ${crossTenant.status}`
    );

    const suspendedAgency = await sendHttp(baseUrl, "/api/extract-basic", {
      headers: {
        Authorization: "Bearer token_usr_admin_1",
        "x-tenant-override": "suspended-agency.highline.ro",
      },
      body: { title: "Suspended agency attempt" },
    });
    assertCheck(
      suspendedAgency.status === 403,
      "High-cost route rejects suspended agency (403)",
      `Got ${suspendedAgency.status}`
    );

    const suspendedMember = await sendHttp(baseUrl, "/api/extract-basic", {
      headers: {
        Authorization: "Bearer token_usr_suspended_1",
      },
      body: { title: "Suspended member attempt" },
    });
    assertCheck(
      suspendedMember.status === 403,
      "High-cost route rejects suspended member (403)",
      `Got ${suspendedMember.status}`
    );

    // Exhaust ten_agency_b ai_requests quota and assert 429
    const betaEffective = QuotaService.getEffectiveQuotas("ten_agency_b");
    const betaUsage = QuotaService.getUsage("ten_agency_b");
    const remainingBetaReqs = Math.max(0, betaEffective.quotas.monthlyAiRequests - betaUsage.aiRequests);
    if (remainingBetaReqs > 0) {
      QuotaService.consumeQuota("ten_agency_b", "ai_requests", remainingBetaReqs);
    }
    const quotaExceeded = await sendHttp(baseUrl, "/api/extract-basic", {
      headers: {
        Authorization: "Bearer token_usr_beta_owner",
        "x-tenant-override": "agency-b.highline.ro",
      },
      body: { title: "Quota exhausted" },
    });
    assertCheck(
      quotaExceeded.status === 429,
      "High-cost route rejects tenant when monthlyAiRequests quota is exhausted (429)",
      `Got ${quotaExceeded.status}`
    );
    QuotaService.resetDefaults();

    // --- 3. Anti-spoofing rate limiter test under trust proxy = 1 ---
    const rlStatuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      // Attacker rotates leftmost X-Forwarded-For IP on every request, while Cloud Run GFE appends real client IP 198.51.100.42
      const res = await sendHttp(baseUrl, "/api/test-rate-limit", {
        headers: {
          "x-forwarded-for": `203.0.113.${10 + i}, 198.51.100.42`,
        },
        body: {},
      });
      rlStatuses.push(res.status);
    }
    assertCheck(
      rlStatuses[0] === 200 && rlStatuses[1] === 200 && rlStatuses[2] === 200 && rlStatuses[3] === 429,
      "Rotating spoofed leftmost X-Forwarded-For cannot bypass rate limiter under trust proxy=1 (4th req -> 429)",
      `Unexpected status sequence: ${rlStatuses.join(", ")}`
    );

    // --- 4. Scoped 2mb global vs 50mb upload JSON limits ---
    const bigPayload = "A".repeat(2_600_000); // ~2.6MB
    const overStandardLimit = await sendHttp(baseUrl, "/api/extract-basic", {
      headers: { Authorization: "Bearer token_usr_admin_1" },
      body: { title: "Oversized", content: bigPayload },
    });
    assertCheck(
      overStandardLimit.status === 413,
      "Global 2mb JSON limit rejects 2.6MB payload on /api/extract-basic with 413",
      `Expected 413, got ${overStandardLimit.status}`
    );

    const allowedUploadPayload = await sendHttp(baseUrl, "/api/upload-photo", {
      headers: { Authorization: "Bearer token_usr_admin_1" },
      body: { dataUrl: bigPayload },
    });
    assertCheck(
      allowedUploadPayload.status === 200 && allowedUploadPayload.json?.payloadBytes === 2_600_000,
      "Upload-scoped 50mb parser accepts 2.6MB payload on /api/upload-photo (200)",
      `Expected 200 with 2600000 bytes, got ${allowedUploadPayload.status}`
    );

    // --- 5. CloudStorageService persistent signing secret & fail-closed prod guard ---
    const prevStorageSecret = process.env.STORAGE_SIGNING_SECRET;
    const prevSessionSecret = process.env.SESSION_SECRET;
    const prevNodeEnv = process.env.NODE_ENV;
    const prevAllowEphemeral = process.env.ALLOW_EPHEMERAL_STORAGE_SECRET;

    try {
      process.env.STORAGE_SIGNING_SECRET = "phase3-stable-signing-secret-32chars-min";
      CloudStorageService.resetEphemeralSecretForTests();
      const signed = CloudStorageService.generateSignedDownloadUrl({
        tenantId: "ten_brokr_default",
        objectKey: "tenants/ten_brokr_default/documents/doc_1/contract.pdf",
        ttlSeconds: 300,
      });
      // Simulate a cold server restart clearing in-memory ephemeral state
      CloudStorageService.resetEphemeralSecretForTests();
      let verifiedAfterRestart = false;
      try {
        CloudStorageService.verifySignedDownloadParams({
          objectKey: "tenants/ten_brokr_default/documents/doc_1/contract.pdf",
          tenantId: "ten_brokr_default",
          exp: Math.floor(new Date(signed.expiresAt).getTime() / 1000),
          signature: signed.signature,
        });
        verifiedAfterRestart = true;
      } catch {
        verifiedAfterRestart = false;
      }
      assertCheck(
        verifiedAfterRestart && CloudStorageService.isUsingPersistentSigningSecret(),
        "CloudStorageService signed URLs survive cold server restarts when STORAGE_SIGNING_SECRET is set",
        "Signed URL failed verification after simulated restart"
      );

      // Fail-closed in production without STORAGE_SIGNING_SECRET
      delete process.env.STORAGE_SIGNING_SECRET;
      delete process.env.SESSION_SECRET;
      delete process.env.ALLOW_EPHEMERAL_STORAGE_SECRET;
      process.env.NODE_ENV = "production";
      CloudStorageService.resetEphemeralSecretForTests();

      let prodThrew503 = false;
      try {
        CloudStorageService.generateSignedDownloadUrl({
          tenantId: "ten_brokr_default",
          objectKey: "tenants/ten_brokr_default/documents/doc_1/contract.pdf",
        });
      } catch (err: any) {
        prodThrew503 = err?.statusCode === 503 && err?.code === "CONFIGURATION_ERROR";
      }
      assertCheck(
        prodThrew503,
        "CloudStorageService fails closed (503 CONFIGURATION_ERROR) in production without STORAGE_SIGNING_SECRET",
        "Expected 503 CONFIGURATION_ERROR in production without persistent signing secret"
      );
    } finally {
      if (prevStorageSecret !== undefined) process.env.STORAGE_SIGNING_SECRET = prevStorageSecret;
      else delete process.env.STORAGE_SIGNING_SECRET;
      if (prevSessionSecret !== undefined) process.env.SESSION_SECRET = prevSessionSecret;
      else delete process.env.SESSION_SECRET;
      if (prevAllowEphemeral !== undefined) process.env.ALLOW_EPHEMERAL_STORAGE_SECRET = prevAllowEphemeral;
      else delete process.env.ALLOW_EPHEMERAL_STORAGE_SECRET;
      process.env.NODE_ENV = prevNodeEnv || "test";
      CloudStorageService.resetEphemeralSecretForTests();
    }

    // --- 6. authVersion revocation lifecycle & compact Custom Claims adapter ---
    const ownerMem = TenantMembershipService.getMembership("ten_brokr_default", "usr_admin_1")!;
    const agentBefore = TenantMembershipService.getMembership("ten_brokr_default", "usr_agent_1")!;
    const initialUserVer = agentBefore.authVersion ?? 1;

    // Role change must bump authVersion
    const updatedAgent = TenantMembershipService.updateMemberRole(ownerMem, "usr_agent_1", "manager");
    assertCheck(
      (updatedAgent.authVersion ?? 1) === initialUserVer + 1,
      `Member role change bumps membership.authVersion (${initialUserVer} -> ${updatedAgent.authVersion})`,
      `Expected ${initialUserVer + 1}, got ${updatedAgent.authVersion}`
    );

    // Token with stale uVer is rejected immediately with 403 AUTH_REVOKED
    const staleUserVerRes = await sendHttp(baseUrl, "/api/extract-basic", {
      headers: {
        Authorization: `Bearer token_claims::usr_agent_1::u${initialUserVer}::t1::ten_brokr_default`,
      },
      body: { title: "Stale uVer test" },
    });
    assertCheck(
      staleUserVerRes.status === 403 && staleUserVerRes.json?.error?.code === "AUTH_REVOKED",
      "Stale user authVersion (uVer) token claim is rejected immediately (403 AUTH_REVOKED)",
      `Expected 403 AUTH_REVOKED, got ${staleUserVerRes.status} (${JSON.stringify(staleUserVerRes.json)})`
    );

    // Token with current uVer succeeds (200)
    const freshUserVerRes = await sendHttp(baseUrl, "/api/extract-basic", {
      headers: {
        Authorization: `Bearer token_claims::usr_agent_1::u${updatedAgent.authVersion}::t1::ten_brokr_default`,
      },
      body: { title: "Fresh uVer test" },
    });
    assertCheck(
      freshUserVerRes.status === 200,
      "Refreshed user authVersion (uVer) token claim is accepted (200)",
      `Expected 200, got ${freshUserVerRes.status}`
    );

    // Cross-tenant tid claim is rejected immediately (403)
    const wrongTidClaimRes = await sendHttp(baseUrl, "/api/extract-basic", {
      headers: {
        Authorization: `Bearer token_claims::usr_agent_1::u${updatedAgent.authVersion}::t1::ten_agency_b`,
      },
      body: { title: "Wrong tid claim" },
    });
    assertCheck(
      wrongTidClaimRes.status === 403 && wrongTidClaimRes.json?.error?.code === "AUTH_TENANT_MISMATCH",
      "Cross-tenant tid custom claim is rejected immediately (403 AUTH_TENANT_MISMATCH)",
      `Expected 403 AUTH_TENANT_MISMATCH, got ${wrongTidClaimRes.status}`
    );

    // Tenant suspension bumps tenant.authVersion and invalidates stale tVer tokens
    const alphaBefore = TenantResolutionService.getTenantById("ten_agency_a")!;
    const alphaInitialVer = alphaBefore.authVersion ?? 1;
    await TenantResolutionService.saveTenantAsync({ ...alphaBefore, status: "suspended" });
    const alphaSuspended = TenantResolutionService.getTenantById("ten_agency_a")!;
    assertCheck(
      (alphaSuspended.authVersion ?? 1) === alphaInitialVer + 1,
      `Tenant suspension bumps tenant.authVersion (${alphaInitialVer} -> ${alphaSuspended.authVersion})`,
      `Expected ${alphaInitialVer + 1}, got ${alphaSuspended.authVersion}`
    );

    // Reactivate alpha (bumps again) and verify stale tVer token is rejected even when active
    await TenantResolutionService.saveTenantAsync({ ...alphaSuspended, status: "active" });
    const alphaReactivated = TenantResolutionService.getTenantById("ten_agency_a")!;
    const staleTenantVerRes = await sendHttp(baseUrl, "/api/extract-basic", {
      headers: {
        Authorization: `Bearer token_claims::usr_alpha_owner::u1::t${alphaInitialVer}::ten_agency_a`,
        "x-tenant-override": "agency-a.highline.ro",
      },
      body: { title: "Stale tVer test" },
    });
    assertCheck(
      staleTenantVerRes.status === 403 && staleTenantVerRes.json?.error?.code === "AUTH_REVOKED",
      "Stale tenant authVersion (tVer) token claim is rejected immediately (403 AUTH_REVOKED)",
      `Expected 403 AUTH_REVOKED, got ${staleTenantVerRes.status}`
    );
    const freshTenantVerRes = await sendHttp(baseUrl, "/api/extract-basic", {
      headers: {
        Authorization: `Bearer token_claims::usr_alpha_owner::u1::t${alphaReactivated.authVersion}::ten_agency_a`,
        "x-tenant-override": "agency-a.highline.ro",
      },
      body: { title: "Fresh tVer test" },
    });
    assertCheck(
      freshTenantVerRes.status === 200,
      "Current tenant authVersion (tVer) token claim is accepted (200)",
      `Expected 200, got ${freshTenantVerRes.status}`
    );

    // Compact Custom Claims payload size (< 300 bytes) & safe opt-in no-op
    const builtClaims = CustomClaimsService.buildCompactClaims({
      tenantId: "ten_agency_a",
      role: "agency_admin",
      tenantStatus: "active",
      userAuthVersion: 3,
      tenantAuthVersion: 2,
    });
    const claimsBytes = Buffer.byteLength(JSON.stringify(builtClaims), "utf8");
    const prevClaimsFlag = process.env.ENABLE_FIREBASE_CUSTOM_CLAIMS;
    delete process.env.ENABLE_FIREBASE_CUSTOM_CLAIMS;
    const syncNoop = await CustomClaimsService.syncUserClaims("usr_alpha_owner", {
      tenantId: "ten_agency_a",
      role: "agency_admin",
      tenantStatus: "active",
      userAuthVersion: 3,
      tenantAuthVersion: 2,
    });
    if (prevClaimsFlag !== undefined) process.env.ENABLE_FIREBASE_CUSTOM_CLAIMS = prevClaimsFlag;
    assertCheck(
      claimsBytes < MAX_CUSTOM_CLAIMS_BYTES && syncNoop.synced === false && Boolean(syncNoop.skippedReason),
      `Compact custom claims payload is ${claimsBytes} bytes (< ${MAX_CUSTOM_CLAIMS_BYTES}B) and safely skips when ENABLE_FIREBASE_CUSTOM_CLAIMS!=true`,
      `Bytes=${claimsBytes}, syncNoop=${JSON.stringify(syncNoop)}`
    );

    // Restore agent role back to agent for clean state
    TenantMembershipService.updateMemberRole(ownerMem, "usr_agent_1", "agent");

    // --- 7. Google OIDC RS256 worker middleware verification ---
    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const { privateKey: attackerPrivateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    setWorkerOidcTestKeys({ "test-google-kid-1": publicKey });
    try {
      const nowSec = Math.floor(Date.now() / 1000);

      // Missing header -> 403
      const oidcMissing = await sendHttp(baseUrl, "/api/internal/workers/ping", { body: {} });
      assertCheck(oidcMissing.status === 403, "OIDC worker route rejects missing Authorization header (403)", `Got ${oidcMissing.status}`);

      // Forged signature -> 403
      const forgedToken = signTestJwt(attackerPrivateKey, "test-google-kid-1", {
        iss: "https://accounts.google.com",
        aud: "https://brokr-worker.run.app",
        sub: "10000001",
        email: "brokr-tasks@brokr-42038.iam.gserviceaccount.com",
        email_verified: true,
        iat: nowSec - 10,
        exp: nowSec + 300,
      });
      const oidcForged = await sendHttp(baseUrl, "/api/internal/workers/ping", {
        headers: { Authorization: `Bearer ${forgedToken}` },
        body: {},
      });
      assertCheck(oidcForged.status === 403, "OIDC worker route rejects forged RS256 signature (403)", `Got ${oidcForged.status}`);

      // Wrong audience -> 403
      const wrongAudToken = signTestJwt(privateKey, "test-google-kid-1", {
        iss: "https://accounts.google.com",
        aud: "https://evil.example.com",
        sub: "10000001",
        email: "brokr-tasks@brokr-42038.iam.gserviceaccount.com",
        email_verified: true,
        iat: nowSec - 10,
        exp: nowSec + 300,
      });
      const oidcWrongAud = await sendHttp(baseUrl, "/api/internal/workers/ping", {
        headers: { Authorization: `Bearer ${wrongAudToken}` },
        body: {},
      });
      assertCheck(oidcWrongAud.status === 403, "OIDC worker route rejects wrong audience (403)", `Got ${oidcWrongAud.status}`);

      // Expired token -> 403
      const expiredToken = signTestJwt(privateKey, "test-google-kid-1", {
        iss: "https://accounts.google.com",
        aud: "https://brokr-worker.run.app",
        sub: "10000001",
        email: "brokr-tasks@brokr-42038.iam.gserviceaccount.com",
        email_verified: true,
        iat: nowSec - 600,
        exp: nowSec - 60,
      });
      const oidcExpired = await sendHttp(baseUrl, "/api/internal/workers/ping", {
        headers: { Authorization: `Bearer ${expiredToken}` },
        body: {},
      });
      assertCheck(oidcExpired.status === 403, "OIDC worker route rejects expired token (403)", `Got ${oidcExpired.status}`);

      // Unallowlisted SA email -> 403
      const wrongEmailToken = signTestJwt(privateKey, "test-google-kid-1", {
        iss: "https://accounts.google.com",
        aud: "https://brokr-worker.run.app",
        sub: "10000002",
        email: "other-sa@other-project.iam.gserviceaccount.com",
        email_verified: true,
        iat: nowSec - 10,
        exp: nowSec + 300,
      });
      const oidcWrongEmail = await sendHttp(baseUrl, "/api/internal/workers/ping", {
        headers: { Authorization: `Bearer ${wrongEmailToken}` },
        body: {},
      });
      assertCheck(oidcWrongEmail.status === 403, "OIDC worker route rejects unallowlisted SA email (403)", `Got ${oidcWrongEmail.status}`);

      // Valid RS256 OIDC token -> 200
      const validToken = signTestJwt(privateKey, "test-google-kid-1", {
        iss: "https://accounts.google.com",
        aud: "https://brokr-worker.run.app",
        sub: "10000001",
        email: "brokr-tasks@brokr-42038.iam.gserviceaccount.com",
        email_verified: true,
        iat: nowSec - 10,
        exp: nowSec + 300,
      });
      const oidcValid = await sendHttp(baseUrl, "/api/internal/workers/ping", {
        headers: { Authorization: `Bearer ${validToken}` },
        body: {},
      });
      assertCheck(
        oidcValid.status === 200 && oidcValid.json?.worker === "brokr-tasks@brokr-42038.iam.gserviceaccount.com",
        "OIDC worker route accepts valid RS256 Google OIDC token from allowlisted SA (200)",
        `Expected 200 with worker email, got ${oidcValid.status} (${JSON.stringify(oidcValid.json)})`
      );
    } finally {
      setWorkerOidcTestKeys(null);
    }

    // --- 8. QuotaService demo seeding hygiene outside NODE_ENV=test ---
    const savedEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      QuotaService.resetDefaults();
      const prodUsage = QuotaService.getUsage("ten_brokr_default");
      assertCheck(
        prodUsage.properties === 0 && prodUsage.leads === 0 && prodUsage.aiTokens === 0 && prodUsage.aiRequests === 0 && prodUsage.storageMb === 0,
        "QuotaService starts at zero real usage outside NODE_ENV=test (no hardcoded INITIAL_USAGE demo seeds)",
        `Unexpected non-zero prod usage: ${JSON.stringify(prodUsage)}`
      );
    } finally {
      process.env.NODE_ENV = savedEnv || "test";
      QuotaService.resetDefaults();
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log("\n================================================================");
  console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
  console.log("================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Fatal error in Phase 3 hardening suite:", err);
  process.exit(1);
});
