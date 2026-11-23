import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import express from "express";
import {
  ServerLifecycleController,
  registerHealthRoutes,
  attachGracefulShutdown,
} from "../../src/core/runtime/svc_server-lifecycle";

async function main() {
  let passed = 0;
  async function runTest(name: string, fn: () => Promise<void> | void) {
    await fn();
    passed++;
    console.log(`✅ [PASS] ${name}`);
  }

  console.log("================================================================");
  console.log("🏗️  BROKR PHASE 4 — INFRASTRUCTURE, PROBES & LIFECYCLE SUITE");
  console.log("================================================================");

  // 1. Health & readiness probe lifecycle + zero secret exposure
  await runTest("1. /api/healthz, /api/readyz, and /api/health enforce lifecycle states and leak zero secrets", async () => {
    const fakeSecretEnv: Record<string, string> = {
      NODE_ENV: "production",
      GEMINI_API_KEY: "SUPER_SECRET_GEMINI_KEY_VALUE_12345",
      STRIPE_SECRET_KEY: "sk_live_SUPER_SECRET_STRIPE_99999",
      STRIPE_WEBHOOK_SECRET: "whsec_SUPER_SECRET_WEBHOOK_88888",
      STORAGE_SIGNING_SECRET: "SUPER_SECRET_STORAGE_HMAC_77777",
      FIREBASE_PROJECT_ID: "brokr-42038",
      PLATFORM_ROOT_DOMAIN: "highline.ro",
    };

    const invalidProdEnv: Record<string, string> = {
      NODE_ENV: "production",
      ALLOW_MOCK_BILLING_IN_PRODUCTION: "false",
      // Missing GEMINI_API_KEY and Stripe secrets
    };

    let activeEnv = fakeSecretEnv;
    const lifecycle = new ServerLifecycleController("brokr-test-api");
    const app = express();
    registerHealthRoutes(app, lifecycle, () => activeEnv);

    const server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const port = (server.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}`;

    try {
      // Before markReady(): healthz=200, readyz=503 (starting)
      const h1 = await fetch(`${base}/api/healthz`);
      assert.equal(h1.status, 200);
      assert.equal((await h1.json()).status, "ok");

      const r1 = await fetch(`${base}/api/readyz`);
      assert.equal(r1.status, 503);
      assert.equal((await r1.json()).status, "starting");

      // After markReady() with valid prod config: readyz=200, health=200
      lifecycle.markReady();
      const r2 = await fetch(`${base}/api/readyz`);
      assert.equal(r2.status, 200);
      const r2Text = await r2.text();
      const r2Json = JSON.parse(r2Text);
      assert.equal(r2Json.status, "ok");
      assert.equal(r2Json.checks.ready, true);
      assert.equal(r2Json.checks.configValid, true);
      assert.equal(r2.headers.get("cache-control"), "no-store");

      // Assert zero secret leakage in public probe body
      for (const secretVal of [
        "SUPER_SECRET_GEMINI_KEY_VALUE_12345",
        "sk_live_SUPER_SECRET_STRIPE_99999",
        "whsec_SUPER_SECRET_WEBHOOK_88888",
        "SUPER_SECRET_STORAGE_HMAC_77777",
      ]) {
        assert.ok(!r2Text.includes(secretVal), `Secret value leaked in /api/readyz!`);
      }

      // Backward-compatible /api/health returns 200
      const legacyH = await fetch(`${base}/api/health`);
      assert.equal(legacyH.status, 200);
      assert.equal((await legacyH.json()).status, "ok");

      // Invalid prod config causes /api/readyz to return 503 (not_ready)
      activeEnv = invalidProdEnv;
      const r3 = await fetch(`${base}/api/readyz`);
      assert.equal(r3.status, 503);
      assert.equal((await r3.json()).status, "not_ready");

      // Draining causes BOTH /api/healthz and /api/readyz to return 503 (draining)
      activeEnv = fakeSecretEnv;
      lifecycle.markDraining("SIGTERM");
      const hDrain = await fetch(`${base}/api/healthz`);
      const rDrain = await fetch(`${base}/api/readyz`);
      assert.equal(hDrain.status, 503);
      assert.equal(rDrain.status, 503);
      assert.equal((await hDrain.json()).status, "draining");
      assert.equal((await rDrain.json()).status, "draining");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  // 2. Graceful SIGTERM shutdown drains in-flight requests and runs cleanup tasks idempotently
  await runTest("2. Graceful shutdown drains in-flight HTTP request, runs cleanup hooks, and is idempotent", async () => {
    const lifecycle = new ServerLifecycleController("brokr-drain-test");
    const app = express();
    registerHealthRoutes(app, lifecycle, () => ({ NODE_ENV: "test" }));

    let releaseSlowRequest!: () => void;
    const slowRequestStarted = new Promise<void>((resolve) => {
      app.get("/api/slow", async (_req, res) => {
        resolve();
        await new Promise<void>((done) => {
          releaseSlowRequest = done;
        });
        res.status(200).json({ completed: true });
      });
    });

    const server = await new Promise<http.Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    lifecycle.markReady();

    let cleanupCalls = 0;
    let exitCodeSeen: number | null = null;

    const controller = attachGracefulShutdown({
      server,
      lifecycle,
      timeoutMs: 3000,
      bindProcessSignals: false,
      onExit: (code) => {
        exitCodeSeen = code;
      },
      cleanupTasks: [
        {
          name: "mock-scheduler",
          run: async () => {
            cleanupCalls++;
          },
        },
      ],
    });

    const port = (server.address() as { port: number }).port;
    const slowFetchPromise = fetch(`http://127.0.0.1:${port}/api/slow`);
    await slowRequestStarted;

    // Trigger duplicate SIGTERM signals while slow request is in flight
    const p1 = controller.triggerShutdown("SIGTERM");
    const p2 = controller.triggerShutdown("SIGINT");

    assert.equal(lifecycle.isDraining(), true);
    assert.equal(lifecycle.isReady(), false);

    // Complete the in-flight request so server.close() drains cleanly
    releaseSlowRequest();
    const slowRes = await slowFetchPromise;
    assert.equal(slowRes.status, 200);
    assert.equal((await slowRes.json()).completed, true);

    const [code1, code2] = await Promise.all([p1, p2]);
    assert.equal(code1, 0);
    assert.equal(code2, 0);
    assert.equal(exitCodeSeen, 0);
    assert.equal(cleanupCalls, 1, "Cleanup task must execute exactly once even on duplicate signals");
    controller.detachSignals();
  });

  // 3. Dockerfile & .dockerignore security & Stage A compliance
  await runTest("3. Dockerfile uses multi-stage build, non-root user, healthcheck, and .dockerignore blocks secrets", () => {
    const rootDir = process.cwd();
    const dockerfile = fs.readFileSync(path.join(rootDir, "Dockerfile"), "utf8");
    const dockerignore = fs.readFileSync(path.join(rootDir, ".dockerignore"), "utf8");

    assert.match(dockerfile, /AS builder/i, "Dockerfile must use multi-stage builder");
    assert.match(dockerfile, /AS runtime/i, "Dockerfile must use multi-stage runtime");
    assert.match(dockerfile, /USER brokr/, "Dockerfile must run as non-root user");
    assert.match(dockerfile, /\/api\/healthz/, "Dockerfile HEALTHCHECK must target /api/healthz");
    assert.match(dockerfile, /PUPPETEER_EXECUTABLE_PATH=\/usr\/bin\/chromium/, "Dockerfile must pin system Chromium");
    assert.ok(!dockerfile.includes("AIza"), "Dockerfile must never embed API keys");

    assert.match(dockerignore, /^\.env$/m, ".dockerignore must exclude .env");
    assert.match(dockerignore, /^\.env\.\*$/m, ".dockerignore must exclude .env.*");
    assert.match(dockerignore, /^node_modules$/m, ".dockerignore must exclude node_modules");
    assert.match(dockerignore, /^\.data$/m, ".dockerignore must exclude .data");
  });

  // 4. Stage A Terraform IaC budget & security contract
  await runTest("4. Stage A Terraform configures single Cloud Run, least-privilege IAM, daily backups, and defers Redis/CDN", () => {
    const tfDir = path.join(process.cwd(), "infra", "terraform");
    const mainTf = fs.readFileSync(path.join(tfDir, "main.tf"), "utf8");
    const varsTf = fs.readFileSync(path.join(tfDir, "variables.tf"), "utf8");
    const versionsTf = fs.readFileSync(path.join(tfDir, "versions.tf"), "utf8");
    const outputsTf = fs.readFileSync(path.join(tfDir, "outputs.tf"), "utf8");
    const exampleTfvars = fs.readFileSync(path.join(tfDir, "terraform.tfvars.example"), "utf8");

    assert.match(versionsTf, /hashicorp\/google/);
    assert.match(mainTf, /resource "google_cloud_run_v2_service" "core_api"/);
    assert.match(mainTf, /path = "\/api\/readyz"/);
    assert.match(mainTf, /path = "\/api\/healthz"/);
    assert.match(mainTf, /resource "google_cloud_scheduler_job" "daily_firestore_export"/);
    assert.match(mainTf, /public_access_prevention\s*=\s*"enforced"/);
    assert.match(mainTf, /prevent_destroy\s*=\s*true/);
    assert.match(mainTf, /roles\/datastore\.user/);
    assert.match(mainTf, /roles\/secretmanager\.secretAccessor/);
    assert.match(mainTf, /resource "google_monitoring_alert_policy" "cloud_run_5xx"/);
    assert.match(mainTf, /resource "google_billing_budget" "stage_a_budget"/);

    // Strictly verify NO premature Stage B/C resources are provisioned in Stage A
    assert.ok(!mainTf.includes("google_redis_instance"), "Stage A must NOT provision Memorystore Redis");
    assert.ok(!mainTf.includes("google_compute_global_forwarding_rule"), "Stage A must NOT provision External LB/CDN");
    assert.ok(!mainTf.includes("roles/owner"), "Terraform must NOT assign roles/owner");
    assert.ok(!mainTf.includes("roles/editor"), "Terraform must NOT assign roles/editor");
    assert.ok(!mainTf.includes("google_secret_manager_secret_version"), "Secret values must NEVER live in Terraform state");

    assert.match(varsTf, /default\s*=\s*"brokr-42038"/);
    assert.match(varsTf, /default\s*=\s*"ai-studio-e7371a1e-cd74-432c-b244-a7eb8aa7f434"/);
    assert.match(outputsTf, /rollback_command_template/);
    assert.match(exampleTfvars, /min_instances\s*=\s*0/);
  });

  // 5. CI/CD workflow & DR runbook presence and security checks
  await runTest("5. CI/CD workflow enforces test/rules gates + WIF + manual prod gate, and DR runbook covers PITR & rollback", () => {
    const ciPath = path.join(process.cwd(), ".github", "workflows", "ci-cd.yml");
    const drPath = path.join(process.cwd(), "docs", "disaster-recovery-runbook.md");

    const ciYaml = fs.readFileSync(ciPath, "utf8");
    const drMd = fs.readFileSync(drPath, "utf8");

    assert.match(ciYaml, /npm run lint/);
    assert.match(ciYaml, /npm run build/);
    assert.match(ciYaml, /npx eslint firestore\.rules/);
    assert.match(ciYaml, /npm test/);
    assert.match(ciYaml, /workload_identity_provider/);
    assert.match(ciYaml, /environment:\s*production/);
    assert.match(ciYaml, /\/api\/healthz/);
    assert.match(ciYaml, /\/api\/readyz/);
    assert.ok(!ciYaml.includes("credentials_json"), "CI/CD must use Workload Identity Federation, not static JSON keys");

    assert.match(drMd, /ai-studio-e7371a1e-cd74-432c-b244-a7eb8aa7f434/);
    assert.match(drMd, /gcloud firestore databases update/);
    assert.match(drMd, /gcloud firestore databases restore/);
    assert.match(drMd, /gcloud run services update-traffic/);
    assert.match(drMd, /Quarterly Restore Drill/i);
  });

  // 6. server.ts wires Phase 4 probes and graceful shutdown cleanly
  await runTest("6. server.ts registers Phase 4 health routes and graceful SIGTERM shutdown", () => {
    const serverTs = fs.readFileSync(path.join(process.cwd(), "server.ts"), "utf8");
    assert.match(serverTs, /registerHealthRoutes\(app,\s*lifecycle\)/);
    assert.match(serverTs, /attachGracefulShutdown\(/);
    assert.match(serverTs, /lifecycle\.markReady\(\)/);
  });

  console.log("================================================================");
  console.log(`🎉 PHASE 4 INFRASTRUCTURE SUMMARY: ${passed} passed, 0 failed`);
  console.log("================================================================");
}

main().catch((err) => {
  console.error("❌ Phase 4 test suite failed:", err);
  process.exit(1);
});
