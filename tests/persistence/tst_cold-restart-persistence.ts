import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { PersistentStoreService } from "../../src/core/database/svc_persistent-store";
import { TenantResolutionService } from "../../src/core/tenancy/svc_tenant-resolution";
import { ModuleCatalogService } from "../../src/core/subscription/svc_module";
import { AiInstructionService } from "../../src/core/ai/svc_ai-instruction";
import { QuotaService } from "../../src/core/subscription/svc_quota";
import { tenantRouter } from "../../server/tenant/rtr_tenant";
import { aiRouter } from "../../server/ai/rtr_ai";
import { platformRouter } from "../../server/platform/rtr_platform";
import { DEFAULT_DEV_TENANT } from "../../src/core/tenancy/typ_tenant-context";

/**
 * Minimal in-memory Firestore v1 REST mock server supporting:
 * - GET /v1/.../documents/<docPath> (single doc) and /v1/.../documents/<colPath> (collection list)
 * - PATCH /v1/.../documents/<docPath> (upsert doc)
 * - DELETE /v1/.../documents/<docPath> (delete doc)
 * - POST /v1/.../documents:runQuery (structuredQuery with collectionId + EQUAL where filter)
 */
function startMockFirestoreServer() {
  const docs = new Map<string, any>();

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString("utf8");
      const parsedUrl = new URL(req.url || "/", "http://127.0.0.1");
      const pathname = parsedUrl.pathname;

      const sendJson = (status: number, payload: any) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };

      const marker = "/documents";
      const idx = pathname.indexOf(marker);
      if (idx === -1) {
        return sendJson(404, { error: { code: 404, message: "Not found" } });
      }

      const prefix = pathname.slice(0, idx + marker.length);
      const rest = pathname.slice(idx + marker.length);

      if (req.method === "POST" && rest.endsWith(":runQuery")) {
        const parentRel = rest.slice(0, -":runQuery".length).replace(/^\/+/, "");
        const body = rawBody ? JSON.parse(rawBody) : {};
        const sq = body.structuredQuery || {};
        const colId: string = sq.from?.[0]?.collectionId || "";
        const whereField: string | undefined = sq.where?.fieldFilter?.field?.fieldPath;
        const whereVal = sq.where?.fieldFilter?.value;

        const targetPrefix = parentRel ? `${parentRel}/${colId}/` : `${colId}/`;
        const matches: any[] = [];

        for (const [docPath, docObj] of docs.entries()) {
          if (!docPath.startsWith(targetPrefix)) continue;
          const tail = docPath.slice(targetPrefix.length);
          if (tail.includes("/")) continue;

          if (whereField && whereVal) {
            const fieldVal = docObj?.fields?.[whereField];
            if (JSON.stringify(fieldVal) !== JSON.stringify(whereVal)) {
              continue;
            }
          }
          matches.push({ document: docObj });
        }

        if (matches.length === 0) {
          return sendJson(200, [{ readTime: new Date().toISOString() }]);
        }
        return sendJson(200, matches);
      }

      const relPath = rest.replace(/^\/+/, "");
      const segments = relPath.split("/").filter(Boolean);
      const isDocumentPath = segments.length % 2 === 0;

      if (req.method === "GET") {
        if (isDocumentPath) {
          const existing = docs.get(relPath);
          if (!existing) {
            return sendJson(404, { error: { code: 404, message: `Document ${relPath} not found` } });
          }
          return sendJson(200, existing);
        } else {
          const colPrefix = `${relPath}/`;
          const list: any[] = [];
          for (const [docPath, docObj] of docs.entries()) {
            if (!docPath.startsWith(colPrefix)) continue;
            const tail = docPath.slice(colPrefix.length);
            if (!tail.includes("/")) {
              list.push(docObj);
            }
          }
          return sendJson(200, { documents: list });
        }
      }

      if (req.method === "PATCH" && isDocumentPath) {
        const body = rawBody ? JSON.parse(rawBody) : {};
        const fullDoc = {
          name: `${prefix.replace(/^\/v1\//, "")}/${relPath}`,
          fields: body.fields || {},
          updateTime: new Date().toISOString(),
        };
        docs.set(relPath, fullDoc);
        return sendJson(200, fullDoc);
      }

      if (req.method === "DELETE" && isDocumentPath) {
        docs.delete(relPath);
        return sendJson(200, {});
      }

      return sendJson(400, { error: { code: 400, message: `Unsupported ${req.method} ${rest}` } });
    });
  });

  return new Promise<{ server: http.Server; origin: string; docs: Map<string, any> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ server, origin: `http://127.0.0.1:${addr.port}`, docs });
    });
  });
}

function simulateColdServerRestart() {
  PersistentStoreService.clearMemoryCache();
  TenantResolutionService.resetHydrationCache();
  // Reset in-memory tenant back to stock hardcoded default so hydration MUST come from Cloud Firestore
  TenantResolutionService.registerTenant(
    {
      ...DEFAULT_DEV_TENANT,
      branding: { ...DEFAULT_DEV_TENANT.branding },
      enabledModules: [...DEFAULT_DEV_TENANT.enabledModules],
    },
    "agency.highline.ro"
  );
  ModuleCatalogService.resetHydrationCache();
  AiInstructionService.resetHydrationCache();
}

async function main() {
  process.env.NODE_ENV = "test";
  process.env.USE_GCP_METADATA_AUTH = "false";
  process.env.ALLOW_PREVIEW_METADATA_AUTH = "false";
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

  const mockFs = await startMockFirestoreServer();
  PersistentStoreService.setTestFirestoreOrigin(mockFs.origin);
  simulateColdServerRestart();

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) return next();
    PersistentStoreService.runWithRequestAuth(
      {
        bearerToken: token,
        uid: token === "token_usr_agent_1" ? "usr_agent_1" : token === "mock_usr_super_admin" ? "usr_super_admin" : "usr_admin_1",
        email: token === "token_usr_agent_1" ? "agent@brokr.ro" : token === "mock_usr_super_admin" ? "fountainheadro@gmail.com" : "adrian@brokr.ro",
        emailVerified: true,
      },
      () => next()
    );
  });
  app.use("/api/tenant/ai", aiRouter);
  app.use("/api/tenant", tenantRouter);
  app.use("/api/platform", platformRouter);

  const apiServer = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const apiPort = (apiServer.address() as { port: number }).port;
  const apiBase = `http://127.0.0.1:${apiPort}`;

  const ownerHeaders = {
    "Content-Type": "application/json",
    Authorization: "Bearer token_usr_admin_1",
    "x-forwarded-host": "agency.highline.ro",
  };

  const agentHeaders = {
    "Content-Type": "application/json",
    Authorization: "Bearer token_usr_agent_1",
    "x-forwarded-host": "agency.highline.ro",
  };

  const superAdminHeaders = {
    "Content-Type": "application/json",
    Authorization: "Bearer mock_usr_super_admin",
    "x-forwarded-host": "admin.highline.ro",
  };

  let passed = 0;
  async function runTest(name: string, fn: () => Promise<void>) {
    await fn();
    passed++;
    console.log(`✅ [PASS] ${name}`);
  }

  try {
    console.log("================================================================");
    console.log("🧪 BROKR COLD-RESTART PERSISTENCE VERIFICATION SUITE");
    console.log("================================================================");

    // 1. Agency Settings: PUT /api/tenant/settings -> Cold Restart -> GET /api/tenant/me
    await runTest("1. Agency Settings (name, branding) persist across cold restart & block agent writes", async () => {
      const forbiddenRes = await fetch(`${apiBase}/api/tenant/settings`, {
        method: "PUT",
        headers: agentHeaders,
        body: JSON.stringify({ name: "Hacked Agency" }),
      });
      assert.equal(forbiddenRes.status, 403);

      const saveRes = await fetch(`${apiBase}/api/tenant/settings`, {
        method: "PUT",
        headers: ownerHeaders,
        body: JSON.stringify({
          name: "Highline Luxury Estates SRL",
          status: "suspended",
          planId: "plan_hacked",
          branding: {
            contactEmail: "office@highline.ro",
            contactPhone: "+40 722 999 888",
            primaryColor: "#112233",
            accentColor: "#AABBCC",
          },
        }),
      });
      assert.equal(saveRes.status, 200);
      const saveJson = await saveRes.json();
      assert.equal(saveJson.data.name, "Highline Luxury Estates SRL");
      assert.equal(saveJson.data.status, "active");
      assert.equal(saveJson.data.branding.contactEmail, "office@highline.ro");

      simulateColdServerRestart();

      const meRes = await fetch(`${apiBase}/api/tenant/me`, { headers: ownerHeaders });
      assert.equal(meRes.status, 200);
      const meJson = await meRes.json();
      assert.equal(meJson.data.tenantName, "Highline Luxury Estates SRL");
      assert.equal(meJson.data.tenant.name, "Highline Luxury Estates SRL");
      assert.equal(meJson.data.tenant.branding.contactEmail, "office@highline.ro");
      assert.equal(meJson.data.tenant.branding.contactPhone, "+40 722 999 888");
      assert.equal(meJson.data.tenant.branding.primaryColor, "#112233");
      assert.equal(meJson.data.tenant.branding.accentColor, "#AABBCC");
    });

    // 2. Agency AI Config
    await runTest("2. Agency AI Config persists across cold restart", async () => {
      const saveRes = await fetch(`${apiBase}/api/tenant/ai/config`, {
        method: "PUT",
        headers: ownerHeaders,
        body: JSON.stringify({
          systemTone: "executive",
          language: "ro",
          contactSignature: "Echipa Highline Luxury",
          customAgencyRules: ["Ton exclusivist, concis, fără clișee."],
        }),
      });
      assert.equal(saveRes.status, 200);

      simulateColdServerRestart();

      const getRes = await fetch(`${apiBase}/api/tenant/ai/config`, { headers: ownerHeaders });
      assert.equal(getRes.status, 200);
      const getJson = await getRes.json();
      assert.equal(getJson.data.preferences.systemTone, "executive");
      assert.equal(getJson.data.preferences.contactSignature, "Echipa Highline Luxury");
      assert.deepEqual(getJson.data.preferences.customAgencyRules, ["Ton exclusivist, concis, fără clișee."]);
    });

    // 3. Agency AI Instructions
    await runTest("3. Agency Custom AI Instructions persist across cold restart", async () => {
      const saveRes = await fetch(`${apiBase}/api/tenant/ai/instructions`, {
        method: "POST",
        headers: ownerHeaders,
        body: JSON.stringify({
          category: "property_description",
          name: "Stil Highline Nord",
          content: "Evidențiază mereu proximitatea față de parcul Herăstrău.",
        }),
      });
      assert.equal(saveRes.status, 200);
      const savedJson = await saveRes.json();
      assert.ok(savedJson.data.id);

      simulateColdServerRestart();

      const listRes = await fetch(`${apiBase}/api/tenant/ai/instructions`, { headers: ownerHeaders });
      assert.equal(listRes.status, 200);
      const listJson = await listRes.json();
      const found = listJson.data.find((i: any) => i.name === "Stil Highline Nord");
      assert.ok(found, "Custom AI instruction disappeared after cold restart!");
      assert.equal(found.content, "Evidențiază mereu proximitatea față de parcul Herăstrău.");
    });

    // 4. Agency AI Conversations
    await runTest("4. Agency AI Conversations persist create & delete across cold restart", async () => {
      const createRes = await fetch(`${apiBase}/api/tenant/ai/conversations`, {
        method: "POST",
        headers: ownerHeaders,
        body: JSON.stringify({ title: "Evaluare Penthouse Primăverii" }),
      });
      assert.equal(createRes.status, 201);
      const convId = (await createRes.json()).data.id;

      simulateColdServerRestart();

      const listRes = await fetch(`${apiBase}/api/tenant/ai/conversations`, { headers: ownerHeaders });
      assert.equal(listRes.status, 200);
      const listJson = await listRes.json();
      assert.ok(
        listJson.data.some((c: any) => c.id === convId && c.title === "Evaluare Penthouse Primăverii"),
        "AI Conversation disappeared after cold restart!"
      );

      const delRes = await fetch(`${apiBase}/api/tenant/ai/conversations/${convId}`, {
        method: "DELETE",
        headers: ownerHeaders,
      });
      assert.equal(delRes.status, 200);

      simulateColdServerRestart();

      const getAfterDel = await fetch(`${apiBase}/api/tenant/ai/conversations/${convId}`, {
        headers: ownerHeaders,
      });
      assert.equal(getAfterDel.status, 404);
    });

    // 5. Platform Plans
    await runTest("5. Platform Subscription Plans persist create & update across cold restart", async () => {
      const createRes = await fetch(`${apiBase}/api/platform/plans`, {
        method: "POST",
        headers: superAdminHeaders,
        body: JSON.stringify({
          id: "plan_vip_boutique",
          name: "vip_boutique",
          displayName: "VIP Boutique",
          description: "Plan personalizat VIP",
          priceMonthly: 1990,
          priceAnnual: 19900,
          currency: "RON",
          includedModules: ["mod_leads", "mod_properties", "mod_ai_extraction"],
          quotas: {
            maxAgents: 25,
            maxProperties: 1000,
            maxLeads: 5000,
            monthlyAiTokens: 3000000,
            monthlyAiRequests: 1500,
            storageMb: 25000,
          },
        }),
      });
      assert.equal(createRes.status, 201);

      const updateRes = await fetch(`${apiBase}/api/platform/plans/plan_vip_boutique`, {
        method: "PUT",
        headers: superAdminHeaders,
        body: JSON.stringify({ priceMonthly: 2250 }),
      });
      assert.equal(updateRes.status, 200);

      simulateColdServerRestart();

      const getRes = await fetch(`${apiBase}/api/platform/plans/plan_vip_boutique`, {
        headers: superAdminHeaders,
      });
      assert.equal(getRes.status, 200);
      const planJson = await getRes.json();
      assert.equal(planJson.data.displayName, "VIP Boutique");
      assert.equal(planJson.data.priceMonthly, 2250);
    });

    // 6. Platform Subscriptions & Add-ons
    await runTest("6. Platform Subscriptions & Add-ons persist across cold restart", async () => {
      const planChangeRes = await fetch(`${apiBase}/api/platform/subscriptions/ten_brokr_default/plan`, {
        method: "PATCH",
        headers: superAdminHeaders,
        body: JSON.stringify({ planId: "plan_vip_boutique", billingInterval: "year" }),
      });
      assert.equal(planChangeRes.status, 200);

      const addonRes = await fetch(`${apiBase}/api/platform/subscriptions/ten_brokr_default/addons`, {
        method: "POST",
        headers: superAdminHeaders,
        body: JSON.stringify({ addonId: "addon_storage_50gb", quantity: 1 }),
      });
      assert.equal(addonRes.status, 200);

      simulateColdServerRestart();

      const tenantSubRes = await fetch(`${apiBase}/api/tenant/subscription`, {
        headers: ownerHeaders,
      });
      assert.equal(tenantSubRes.status, 200);
      const subJson = await tenantSubRes.json();
      assert.equal(subJson.data.planId, "plan_vip_boutique");
      assert.equal(subJson.data.planDisplayName, "VIP Boutique");
      // 25000 base storageMb + 50 * 1024 addon storageMb = 76200
      assert.equal(subJson.data.effectiveQuotas.storageMb, 76200);
    });

    // 7. Platform Module Catalogue Toggles
    await runTest("7. Platform Module Catalogue toggles persist across cold restart", async () => {
      const patchRes = await fetch(`${apiBase}/api/platform/modules/mod_ai_voice`, {
        method: "PATCH",
        headers: superAdminHeaders,
        body: JSON.stringify({ isActive: false, canBePurchasedAsAddon: false }),
      });
      assert.equal(patchRes.status, 200);

      simulateColdServerRestart();

      const getRes = await fetch(`${apiBase}/api/platform/modules`, { headers: superAdminHeaders });
      assert.equal(getRes.status, 200);
      const modJson = await getRes.json();
      const target = modJson.data.modules.find((m: any) => m.id === "mod_ai_voice");
      assert.ok(target);
      assert.equal(target.isActive, false);
      assert.equal(target.canBePurchasedAsAddon, false);
    });

    // 8. Quota Usage Persistence
    await runTest("8. Tenant Quota Usage persists across cold restart", async () => {
      await PersistentStoreService.runWithRequestAuth(
        {
          bearerToken: "token_usr_admin_1",
          uid: "usr_admin_1",
          email: "adrian@brokr.ro",
          emailVerified: true,
        },
        async () => {
          await QuotaService.consumeQuotaAsync("ten_brokr_default", "leads", 7);
        }
      );

      simulateColdServerRestart();

      const tenantSubRes = await fetch(`${apiBase}/api/tenant/subscription`, {
        headers: ownerHeaders,
      });
      assert.equal(tenantSubRes.status, 200);
      const subJson = await tenantSubRes.json();
      assert.ok(
        subJson.data.currentUsage.leads >= 7,
        `Expected persisted leads usage >= 7, got ${subJson.data.currentUsage.leads}`
      );
    });

    console.log("================================================================");
    console.log(`📦 Verified Firestore REST documents persisted: ${mockFs.docs.size}`);
    assert.ok(mockFs.docs.has("tenants/ten_brokr_default"), "Missing tenants/ten_brokr_default in Firestore");
    assert.ok(mockFs.docs.has("ai_configs/ten_brokr_default"), "Missing ai_configs/ten_brokr_default in Firestore");
    assert.ok(
      mockFs.docs.has("tenants/ten_brokr_default/settings/ai_instructions"),
      "Missing tenants/ten_brokr_default/settings/ai_instructions in Firestore"
    );
    assert.ok(mockFs.docs.has("subscription_plans/plan_vip_boutique"), "Missing subscription_plans/plan_vip_boutique in Firestore");
    assert.ok(mockFs.docs.has("subscriptions/ten_brokr_default"), "Missing subscriptions/ten_brokr_default in Firestore");
    assert.ok(mockFs.docs.has("platform_settings/module_catalogue"), "Missing platform_settings/module_catalogue in Firestore");
    assert.ok(mockFs.docs.has("tenant_usage/ten_brokr_default"), "Missing tenant_usage/ten_brokr_default in Firestore");
    console.log(`🎉 COLD-RESTART PERSISTENCE SUMMARY: ${passed} passed, 0 failed`);
    console.log("================================================================");
  } finally {
    PersistentStoreService.setTestFirestoreOrigin(null);
    apiServer.close();
    mockFs.server.close();
  }
}

main().catch((err) => {
  console.error("❌ Cold-restart persistence test failed:", err);
  process.exit(1);
});
