import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import express from "express";

const runStamp = `${process.pid}-${Date.now()}`;
const testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), `brokr-adc-test-${runStamp}-`));
process.env.NODE_ENV = "test";
process.env.PERSISTENT_STORE_PATH = path.join(testTempDir, "local-store.json");

import { GcpAuthService } from "../../src/core/gcp/svc_gcp-auth";
import { PersistentStoreService } from "../../src/core/database/svc_persistent-store";
import { CloudStorageService } from "../../src/core/storage/svc_cloud-storage";
import { CrmTenantStoreService } from "../../src/core/crm/svc_crm-tenant-store";
import { InfraVerificationService } from "../../src/core/migration/svc_infra-verification";
import {
  clearVerifiedInfrastructureStatus,
  validateProductionEnvironment,
} from "../../src/core/env/svc_production-config";
import { getFcmServiceAccessToken } from "../../server/background-notifications";
import { redactSensitiveData } from "../../src/core/logger/logger";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`✅ [PASS] ${message}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${message}`);
    failed++;
  }
}

async function runAdcAndFirestoreTests() {
  console.log("=================================================================");
  console.log("🧪 TESTE ADC, METADATA AUTH GUARD, FIRESTORE PROD & IZOLARE TENANT");
  console.log("=================================================================");

  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    USE_GCP_METADATA_AUTH: process.env.USE_GCP_METADATA_AUTH,
    K_SERVICE: process.env.K_SERVICE,
    FIREBASE_SERVICE_ACCOUNT_JSON: process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
    GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    PERSISTENT_STORE_PATH: process.env.PERSISTENT_STORE_PATH,
    HOME: process.env.HOME,
  };

  // ------------------------------------------------------------------
  // MOCK SERVERS: Metadata, OAuth2 Refresh, Firestore REST, GCS JSON
  // ------------------------------------------------------------------
  let metadataTokenCalls = 0;
  let metadataEmailCalls = 0;
  let oauthRefreshCalls = 0;
  let simulatedFirestoreStatus: number | null = null; // null => 200 OK
  let simulatedNetworkDown = false;

  // Map key: relative doc path e.g. "tenants/ten_agency_a/leads/doc1"
  const mockFirestoreDocs = new Map<string, { name: string; fields: Record<string, any> }>();

  const mockMetaApp = express();
  mockMetaApp.get("/computeMetadata/v1/instance/service-accounts/default/email", (req, res) => {
    if (req.headers["metadata-flavor"] !== "Google") return res.status(403).end();
    metadataEmailCalls++;
    res.type("text/plain").send("brokr-crm-backend@brokr-42038.iam.gserviceaccount.com");
  });
  mockMetaApp.get("/computeMetadata/v1/instance/service-accounts/default/token", (req, res) => {
    if (req.headers["metadata-flavor"] !== "Google") return res.status(403).end();
    metadataTokenCalls++;
    res.json({
      access_token: `mock-meta-token-${metadataTokenCalls}`,
      expires_in: 1800,
      token_type: "Bearer",
    });
  });

  const mockOAuthApp = express();
  mockOAuthApp.use(express.urlencoded({ extended: true }));
  mockOAuthApp.post("/token", (req, res) => {
    oauthRefreshCalls++;
    if (req.body?.grant_type === "refresh_token" && req.body?.refresh_token === "mock-adc-refresh") {
      return res.json({
        access_token: `mock-local-adc-token-${oauthRefreshCalls}`,
        expires_in: 3600,
        token_type: "Bearer",
      });
    }
    return res.status(400).json({ error: "invalid_grant" });
  });

  const mockGcpApp = express();
  mockGcpApp.use(express.json({ limit: "2mb" }));

  // Middleware simulating 401/403/network-error on Firestore routes
  mockGcpApp.use("/v1", (req, res, next) => {
    if (simulatedNetworkDown) {
      req.socket.destroy();
      return;
    }
    if (simulatedFirestoreStatus === 401) {
      return res.status(401).json({ error: { code: 401, message: "UNAUTHENTICATED" } });
    }
    if (simulatedFirestoreStatus === 403) {
      return res.status(403).json({ error: { code: 403, message: "PERMISSION_DENIED" } });
    }
    next();
  });

  // Firestore :commit (including atomic updateTransforms increment)
  mockGcpApp.post("/v1/projects/:project/databases/:db/documents\\:commit", (req, res) => {
    const writes: any[] = Array.isArray(req.body?.writes) ? req.body.writes : [];
    const prefix = `projects/${req.params.project}/databases/${req.params.db}/documents/`;
    const writeResults: any[] = [];
    for (const w of writes) {
      if (w.delete) {
        const rel = String(w.delete).startsWith(prefix)
          ? String(w.delete).slice(prefix.length)
          : String(w.delete);
        mockFirestoreDocs.delete(rel);
        writeResults.push({});
      } else if (w.update) {
        const fullName = String(w.update.name || "");
        const rel = fullName.startsWith(prefix) ? fullName.slice(prefix.length) : fullName;
        if (w.currentDocument?.exists === false && mockFirestoreDocs.has(rel)) {
          return res.status(409).json({ error: { code: 409, message: "ALREADY_EXISTS" } });
        }
        const existing = mockFirestoreDocs.get(rel);
        const mergedFields: Record<string, any> = w.updateMask
          ? { ...(existing?.fields || {}), ...(w.update.fields || {}) }
          : { ...(w.update.fields || {}) };
        const transformResults: any[] = [];
        if (Array.isArray(w.updateTransforms)) {
          for (const tr of w.updateTransforms) {
            if (tr.fieldPath && tr.increment?.integerValue !== undefined) {
              const prev = Number(mergedFields[tr.fieldPath]?.integerValue || 0);
              const nextVal = prev + Number(tr.increment.integerValue);
              const encoded = { integerValue: String(nextVal) };
              mergedFields[tr.fieldPath] = encoded;
              transformResults.push(encoded);
            }
          }
        }
        mockFirestoreDocs.set(rel, {
          name: fullName,
          fields: mergedFields,
        });
        writeResults.push(transformResults.length > 0 ? { transformResults } : {});
      } else {
        writeResults.push({});
      }
    }
    return res.json({ writeResults });
  });

  // Firestore :runQuery (top-level or under parent doc path)
  mockGcpApp.post(/^\/v1\/projects\/([^/]+)\/databases\/([^/]+)\/documents(?:\/(.+))?:runQuery$/, (req, res) => {
    const parentRel = req.params[2]
      ? req.params[2]
          .split("/")
          .map((s: string) => decodeURIComponent(s))
          .join("/")
      : "";
    const sq = req.body?.structuredQuery || {};
    const collectionId = sq.from?.[0]?.collectionId;
    if (!collectionId) return res.json([]);
    const targetPrefix = parentRel ? `${parentRel}/${collectionId}/` : `${collectionId}/`;
    const filter = sq.where?.fieldFilter;
    const rows: any[] = [];
    for (const [k, v] of mockFirestoreDocs.entries()) {
      if (!k.startsWith(targetPrefix)) continue;
      const rest = k.slice(targetPrefix.length);
      if (rest.includes("/")) continue;
      if (filter) {
        const fieldPath = filter.field?.fieldPath;
        const expected = filter.value?.stringValue ?? filter.value?.integerValue;
        const actual = v.fields?.[fieldPath]?.stringValue ?? v.fields?.[fieldPath]?.integerValue;
        if (actual !== expected) continue;
      }
      rows.push({ document: v });
      if (sq.limit && rows.length >= sq.limit) break;
    }
    return res.json(rows);
  });

  // Firestore generic document/collection routes (supports nested paths like tenants/:t/:c/:d)
  mockGcpApp.all(/^\/v1\/projects\/([^/]+)\/databases\/([^/]+)\/documents\/(.+)$/, (req, res) => {
    const project = decodeURIComponent(req.params[0]);
    const db = decodeURIComponent(req.params[1]);
    const relPath = req.params[2]
      .split("/")
      .map((s) => decodeURIComponent(s))
      .join("/");
    const fullName = `projects/${project}/databases/${db}/documents/${relPath}`;

    if (req.method === "GET") {
      // Check if direct document exists
      const direct = mockFirestoreDocs.get(relPath);
      if (direct) {
        return res.json(direct);
      }
      // If odd number of segments (collection path e.g. tenants/ten_a/leads), return list
      const segments = relPath.split("/").filter(Boolean);
      if (segments.length % 2 === 1) {
        const prefix = `${relPath}/`;
        const documents: any[] = [];
        for (const [k, v] of mockFirestoreDocs.entries()) {
          if (k.startsWith(prefix)) {
            const rest = k.slice(prefix.length);
            if (!rest.includes("/")) {
              documents.push(v);
            }
          }
        }
        return res.json({ documents });
      }
      return res.status(404).json({ error: { code: 404, message: "NOT_FOUND" } });
    }

    if (req.method === "PATCH") {
      mockFirestoreDocs.set(relPath, {
        name: fullName,
        fields: req.body?.fields || {},
      });
      return res.json(mockFirestoreDocs.get(relPath));
    }

    if (req.method === "DELETE") {
      if (!mockFirestoreDocs.has(relPath)) {
        return res.status(404).json({ error: { code: 404, message: "NOT_FOUND" } });
      }
      mockFirestoreDocs.delete(relPath);
      return res.json({});
    }

    return res.status(405).end();
  });

  const metaServer = await new Promise<http.Server>((resolve) => {
    const s = mockMetaApp.listen(0, "127.0.0.1", () => resolve(s));
  });
  const oauthServer = await new Promise<http.Server>((resolve) => {
    const s = mockOAuthApp.listen(0, "127.0.0.1", () => resolve(s));
  });
  const gcpServer = await new Promise<http.Server>((resolve) => {
    const s = mockGcpApp.listen(0, "127.0.0.1", () => resolve(s));
  });

  const metaOrigin = `http://127.0.0.1:${(metaServer.address() as any).port}`;
  const oauthOrigin = `http://127.0.0.1:${(oauthServer.address() as any).port}`;
  const gcpOrigin = `http://127.0.0.1:${(gcpServer.address() as any).port}`;

  try {
    // Isolate HOME so real user's ~/.config/gcloud never interferes
    process.env.HOME = testTempDir;
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    clearVerifiedInfrastructureStatus();

    // ==================================================================
    // TEST 1: USE_GCP_METADATA_AUTH=false in AI Studio Preview (even with NODE_ENV=production & K_SERVICE)
    // ==================================================================
    {
      GcpAuthService.clearTokenCache();
      GcpAuthService.setTestOrigins({ metadataOrigin: metaOrigin, oauthTokenOrigin: oauthOrigin });

      process.env.NODE_ENV = "production";
      process.env.K_SERVICE = "ais-pre-zerc4s6ep5hjdudva3pb2j";
      process.env.USE_GCP_METADATA_AUTH = "false";

      const beforeMetaTokens = metadataTokenCalls;
      const beforeMetaEmails = metadataEmailCalls;

      const fsMetaEnabled = PersistentStoreService.isMetadataAuthEnabled();
      const gcsMetaEnabled = CloudStorageService.isMetadataAuthEnabled();
      const fsToken = await PersistentStoreService.getGoogleAccessToken();
      const gcsToken = await CloudStorageService.getStorageAccessToken();
      const fcmToken = await getFcmServiceAccessToken();
      const infra = await InfraVerificationService.verifyInfrastructure();

      // Also verify unset USE_GCP_METADATA_AUTH does NOT auto-activate even with NODE_ENV=production + K_SERVICE
      delete process.env.USE_GCP_METADATA_AUTH;
      process.env.K_SERVICE = "brokr-crm-prod";
      const unsetMetaEnabled = PersistentStoreService.isMetadataAuthEnabled();
      const unsetToken = await PersistentStoreService.getGoogleAccessToken();

      // Also verify AI Studio sandbox K_SERVICE="ais-*" blocks real un-overridden metadata
      GcpAuthService.setTestOrigins({ metadataOrigin: null });
      process.env.USE_GCP_METADATA_AUTH = "true";
      process.env.K_SERVICE = "ais-dev-sandbox";
      const sandboxGuardBlocked = GcpAuthService.isMetadataAuthEnabled() === false;

      assert(
        fsMetaEnabled === false &&
          gcsMetaEnabled === false &&
          unsetMetaEnabled === false &&
          sandboxGuardBlocked &&
          fsToken === null &&
          gcsToken === null &&
          fcmToken === null &&
          unsetToken === null &&
          metadataTokenCalls === beforeMetaTokens &&
          metadataEmailCalls === beforeMetaEmails &&
          infra.credentials.metadataServerReachable === false &&
          infra.credentials.oauthTokenAcquired === false &&
          infra.credentials.storageTokenAcquired === false,
        "TEST 1: USE_GCP_METADATA_AUTH=false (și lipsa activării explicite) blochează complet accesul la metadata în AI Studio Preview"
      );
    }

    // ==================================================================
    // TEST 2: USE_GCP_METADATA_AUTH=true in simulated Cloud Run + Local ADC support
    // ==================================================================
    {
      GcpAuthService.clearTokenCache();
      GcpAuthService.setTestOrigins({ metadataOrigin: metaOrigin, oauthTokenOrigin: oauthOrigin });

      process.env.NODE_ENV = "production";
      process.env.K_SERVICE = "brokr-crm-backend-prod";
      process.env.USE_GCP_METADATA_AUTH = "true";

      const cloudRunMetaEnabled = PersistentStoreService.isMetadataAuthEnabled();
      const metaBefore = metadataTokenCalls;
      const fsToken = await PersistentStoreService.getGoogleAccessToken();
      const gcsToken = await CloudStorageService.getStorageAccessToken();
      const fcmToken = await getFcmServiceAccessToken();
      const authInfoMeta = PersistentStoreService.getAuthMethodInfo();

      // Now test local ADC (authorized_user) WITHOUT metadata auth & WITHOUT SA JSON key
      GcpAuthService.clearTokenCache();
      process.env.USE_GCP_METADATA_AUTH = "false";
      const localMetaDisabled = PersistentStoreService.isMetadataAuthEnabled() === false;
      const gcloudDir = path.join(testTempDir, ".config", "gcloud");
      fs.mkdirSync(gcloudDir, { recursive: true });
      const adcFile = path.join(gcloudDir, "application_default_credentials.json");
      fs.writeFileSync(
        adcFile,
        JSON.stringify({
          type: "authorized_user",
          client_id: "local-adc-client",
          client_secret: "local-adc-secret",
          refresh_token: "mock-adc-refresh",
          quota_project_id: "brokr-42038",
        }),
        "utf8"
      );

      const authInfoLocal = PersistentStoreService.getAuthMethodInfo();
      const localAdcToken = await PersistentStoreService.getGoogleAccessToken();
      const quotaHeader = GcpAuthService.getQuotaProjectHeaders();

      // Remove local ADC file for remaining tests
      fs.unlinkSync(adcFile);
      GcpAuthService.clearTokenCache();

      assert(
        cloudRunMetaEnabled === true &&
          localMetaDisabled &&
          authInfoMeta.method === "gcp_metadata_adc" &&
          Boolean(fsToken?.startsWith("mock-meta-token-")) &&
          Boolean(gcsToken?.startsWith("mock-meta-token-")) &&
          Boolean(fcmToken?.startsWith("mock-meta-token-")) &&
          metadataTokenCalls > metaBefore &&
          authInfoLocal.method === "adc_authorized_user" &&
          Boolean(localAdcToken?.startsWith("mock-local-adc-token-")) &&
          quotaHeader["x-goog-user-project"] === "brokr-42038",
        "TEST 2: Cloud Run simulat cu USE_GCP_METADATA_AUTH=true obține tokenuri ADC și mediul local folosește ADC fără cheie JSON"
      );
    }

    // ==================================================================
    // TEST 3: Firestore 401 / 403 / Network error handling (no silent swallowing or secret leaks)
    // ==================================================================
    {
      GcpAuthService.clearTokenCache();
      GcpAuthService.setTestOrigins({ metadataOrigin: metaOrigin });
      CrmTenantStoreService.setFirestoreOriginForTests(gcpOrigin);

      process.env.NODE_ENV = "production";
      process.env.K_SERVICE = "brokr-crm-backend-prod";
      process.env.USE_GCP_METADATA_AUTH = "true";

      // 3a. HTTP 401 from Firestore
      simulatedFirestoreStatus = 401;
      let err401: any = null;
      try {
        await PersistentStoreService.remoteSet("audit_test", "doc_401", { val: 1 });
      } catch (e) {
        err401 = e;
      }

      // 3b. HTTP 403 from Firestore on remoteDelete & CrmTenantStoreService.create
      simulatedFirestoreStatus = 403;
      let err403Del: any = null;
      try {
        await PersistentStoreService.remoteDelete("audit_test", "doc_403");
      } catch (e) {
        err403Del = e;
      }

      let err403CrmCreate: any = null;
      try {
        await CrmTenantStoreService.create(
          "ten_agency_a",
          "leads",
          { id: "lead_fail_403", title: "Nu trebuie salvat" },
          "usr_alpha_owner"
        );
      } catch (e) {
        err403CrmCreate = e;
      }

      // 3c. Network error
      simulatedFirestoreStatus = null;
      simulatedNetworkDown = true;
      let errNetwork: any = null;
      try {
        await PersistentStoreService.remoteSet("audit_test", "doc_net", { val: 2 });
      } catch (e) {
        errNetwork = e;
      }
      simulatedNetworkDown = false;

      const lastErr = PersistentStoreService.getLastRemoteError();
      const leakCheck =
        String(err401?.message || "") +
        String(err403Del?.message || "") +
        String(err403CrmCreate?.message || "") +
        String(errNetwork?.message || "");

      assert(
        err401?.statusCode === 401 &&
          err403Del?.statusCode === 403 &&
          err403CrmCreate?.statusCode === 403 &&
          errNetwork?.statusCode === 503 &&
          Boolean(lastErr) &&
          !mockFirestoreDocs.has("tenants/ten_agency_a/leads/lead_fail_403") &&
          !leakCheck.includes("mock-meta-token-") &&
          !leakCheck.includes("Bearer "),
        "TEST 3: Erorile Firestore 401, 403 și de rețea sunt propagate clar, fără înghițire tăcută și fără expunere de tokenuri"
      );
    }

    // ==================================================================
    // TEST 4: No silent local persistence fallback in production
    // ==================================================================
    {
      GcpAuthService.clearTokenCache();
      process.env.NODE_ENV = "production";
      process.env.USE_GCP_METADATA_AUTH = "false";
      delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

      const prodLocalFile = path.join(testTempDir, "prod-forbidden-fallback.json");
      process.env.PERSISTENT_STORE_PATH = prodLocalFile;
      if (fs.existsSync(prodLocalFile)) fs.unlinkSync(prodLocalFile);

      let syncSetBlocked = false;
      try {
        PersistentStoreService.set("test_col", "doc_1", { secret: "x" });
      } catch (e: any) {
        syncSetBlocked = e?.statusCode === 503;
      }

      let asyncSetBlocked = false;
      try {
        await PersistentStoreService.setAsync("test_col", "doc_2", { secret: "y" });
      } catch (e: any) {
        asyncSetBlocked = e?.statusCode === 401 || e?.statusCode === 503;
      }

      let crmCreateBlocked = false;
      try {
        await CrmTenantStoreService.create(
          "ten_agency_a",
          "leads",
          { title: "Should fail without Firestore in prod" },
          "usr_alpha"
        );
      } catch (e: any) {
        crmCreateBlocked = e?.statusCode === 401 || e?.statusCode === 503;
      }

      assert(
        syncSetBlocked &&
          asyncSetBlocked &&
          crmCreateBlocked &&
          !fs.existsSync(prodLocalFile),
        "TEST 4: Producția blochează salvarea silențioasă și fallback-ul pe discul local când Firestore/ADC lipsește"
      );
    }

    // ==================================================================
    // TEST 5 & 6: Production CrmTenantStoreService direct Firestore R/W + strict 2-tenant isolation
    // ==================================================================
    {
      GcpAuthService.clearTokenCache();
      GcpAuthService.setTestOrigins({ metadataOrigin: metaOrigin });
      CrmTenantStoreService.setFirestoreOriginForTests(gcpOrigin);
      mockFirestoreDocs.clear();
      simulatedFirestoreStatus = null;

      process.env.NODE_ENV = "production";
      process.env.K_SERVICE = "brokr-crm-backend-prod";
      process.env.USE_GCP_METADATA_AUTH = "true";

      const prodStorePath = path.join(testTempDir, "must-not-be-written-in-prod.json");
      process.env.PERSISTENT_STORE_PATH = prodStorePath;
      if (fs.existsSync(prodStorePath)) fs.unlinkSync(prodStorePath);
      PersistentStoreService.clearMemoryCache();

      // Create entities for Agency A and Agency B in production Firestore mode
      const propA = await CrmTenantStoreService.create(
        "ten_agency_a",
        "leads",
        {
          id: "prop_alpha_1",
          title: "Vilă Pipera Alpha",
          status: "Colaborare",
        },
        "usr_alpha_owner"
      );

      const propB = await CrmTenantStoreService.create(
        "ten_agency_b",
        "leads",
        {
          id: "prop_beta_1",
          title: "Apartament Cluj Beta",
          status: "Colaborare",
        },
        "usr_beta_owner"
      );

      // Update inside Agency A
      const updatedA = await CrmTenantStoreService.update("ten_agency_a", "leads", "prop_alpha_1", {
        title: "Vilă Pipera Alpha Actualizată",
      });

      // Verify exact Firestore subcollection paths (including sharded per-entity counters)
      const exactPathA = mockFirestoreDocs.has("tenants/ten_agency_a/leads/prop_alpha_1");
      const exactPathB = mockFirestoreDocs.has("tenants/ten_agency_b/leads/prop_beta_1");
      const exactCounterA = mockFirestoreDocs.has("tenants/ten_agency_a/counters/property");
      const exactCounterB = mockFirestoreDocs.has("tenants/ten_agency_b/counters/property");

      // Verify strict isolation
      const listA = await CrmTenantStoreService.list("ten_agency_a", "leads");
      const listB = await CrmTenantStoreService.list("ten_agency_b", "leads");
      const crossReadBtoA = await CrmTenantStoreService.getById("ten_agency_b", "leads", "prop_alpha_1");

      let crossUpdateBlocked = false;
      try {
        await CrmTenantStoreService.update("ten_agency_b", "leads", "prop_alpha_1", {
          title: "HACKED",
        });
      } catch (e: any) {
        crossUpdateBlocked = e?.statusCode === 404 || e?.statusCode === 403;
      }

      // Inject poisoned mismatched tenant_id inside B's path and verify defense-in-depth rejection
      mockFirestoreDocs.set("tenants/ten_agency_b/leads/poisoned_doc", {
        name: "projects/brokr-42038/databases/ai-studio-e7371a1e-cd74-432c-b244-a7eb8aa7f434/documents/tenants/ten_agency_b/leads/poisoned_doc",
        fields: {
          id: { stringValue: "poisoned_doc" },
          tenant_id: { stringValue: "ten_agency_a" },
          title: { stringValue: "Poisoned" },
        },
      });
      let poisonedRejected = false;
      try {
        await CrmTenantStoreService.getById("ten_agency_b", "leads", "poisoned_doc");
      } catch (e: any) {
        poisonedRejected = e?.statusCode === 403;
      }

      // Delete propA
      await CrmTenantStoreService.delete("ten_agency_a", "leads", "prop_alpha_1");
      const afterDeleteA = await CrmTenantStoreService.getById("ten_agency_a", "leads", "prop_alpha_1");

      assert(
        exactPathA &&
          exactPathB &&
          exactCounterA &&
          exactCounterB &&
          propA.propertyId === "P1" &&
          propB.propertyId === "P1" &&
          updatedA.title === "Vilă Pipera Alpha Actualizată" &&
          listA.length === 1 &&
          listA[0].id === "prop_alpha_1" &&
          listB.length === 1 &&
          listB[0].id === "prop_beta_1" &&
          crossReadBtoA === null &&
          crossUpdateBlocked &&
          poisonedRejected &&
          afterDeleteA === null &&
          !mockFirestoreDocs.has("tenants/ten_agency_a/leads/prop_alpha_1") &&
          !fs.existsSync(prodStorePath),
        "TEST 5 & 6: CrmTenantStoreService citește/scrie direct în /tenants/{tenantId}/{col}/{docId} în producție fără .data JSON și menține izolare strictă"
      );
    }

    // ==================================================================
    // TEST 7: validateProductionEnvironment() ADC & Real Verification rules
    // ==================================================================
    {
      clearVerifiedInfrastructureStatus();

      // 7a. Metadata auth explicitly enabled, but real access NOT verified yet
      const metaUnverified = validateProductionEnvironment({
        NODE_ENV: "production",
        GEMINI_API_KEY: "test_gemini_key",
        STRIPE_SECRET_KEY: "sk_live_test",
        STRIPE_WEBHOOK_SECRET: "whsec_test",
        FIREBASE_PROJECT_ID: "brokr-42038",
        GCS_BUCKET_NAME: "brokr-42038.firebasestorage.app",
        USE_GCP_METADATA_AUTH: "true",
        K_SERVICE: "brokr-crm-prod",
      });

      // 7b. Metadata auth disabled in Preview even with K_SERVICE
      const previewDisabled = validateProductionEnvironment({
        NODE_ENV: "production",
        GEMINI_API_KEY: "test_gemini_key",
        STRIPE_SECRET_KEY: "sk_live_test",
        STRIPE_WEBHOOK_SECRET: "whsec_test",
        FIREBASE_PROJECT_ID: "brokr-42038",
        GCS_BUCKET_NAME: "brokr-42038.firebasestorage.app",
        USE_GCP_METADATA_AUTH: "false",
        K_SERVICE: "ais-pre-preview",
      });

      // 7c. Local ADC recognized without FIREBASE_SERVICE_ACCOUNT_JSON
      const tmpAdc = path.join(testTempDir, "local-adc-creds.json");
      fs.writeFileSync(
        tmpAdc,
        JSON.stringify({
          type: "authorized_user",
          client_id: "c",
          client_secret: "s",
          refresh_token: "r",
        }),
        "utf8"
      );
      const localAdcUnverified = validateProductionEnvironment({
        NODE_ENV: "production",
        GEMINI_API_KEY: "test_gemini_key",
        STRIPE_SECRET_KEY: "sk_live_test",
        STRIPE_WEBHOOK_SECRET: "whsec_test",
        FIREBASE_PROJECT_ID: "brokr-42038",
        GCS_BUCKET_NAME: "brokr-42038.firebasestorage.app",
        GOOGLE_APPLICATION_CREDENTIALS: tmpAdc,
      });

      // 7d. Only when real access IS verified does infrastructureConfigured/firestoreServerAuthConfigured become true
      const verifiedProd = validateProductionEnvironment(
        {
          NODE_ENV: "production",
          GEMINI_API_KEY: "test_gemini_key",
          STRIPE_SECRET_KEY: "sk_live_test",
          STRIPE_WEBHOOK_SECRET: "whsec_test",
          FIREBASE_PROJECT_ID: "brokr-42038",
          GCS_BUCKET_NAME: "brokr-42038.firebasestorage.app",
          USE_GCP_METADATA_AUTH: "true",
          K_SERVICE: "brokr-crm-prod",
        },
        { verifiedFirestoreAccess: true, verifiedGcsAccess: true }
      );

      assert(
        metaUnverified.valid === true &&
          metaUnverified.checks.adcMetadataEnabled === true &&
          metaUnverified.checks.gcpAuthCredentialsPresent === true &&
          metaUnverified.checks.firestoreServerAuthConfigured === false &&
          metaUnverified.checks.gcsStorageConfigured === false &&
          metaUnverified.checks.infrastructureVerified === false &&
          !metaUnverified.warnings.some((w) => w.includes("FIREBASE_SERVICE_ACCOUNT_JSON")) &&
          previewDisabled.checks.adcMetadataEnabled === false &&
          previewDisabled.checks.gcpAuthCredentialsPresent === false &&
          localAdcUnverified.valid === true &&
          localAdcUnverified.checks.localAdcConfigured === true &&
          localAdcUnverified.checks.gcpAuthCredentialsPresent === true &&
          localAdcUnverified.checks.infrastructureVerified === false &&
          verifiedProd.checks.firestoreServerAuthConfigured === true &&
          verifiedProd.checks.gcsStorageConfigured === true &&
          verifiedProd.checks.infrastructureVerified === true,
        "TEST 7: validateProductionEnvironment() recunoaște ADC (Cloud Run & local), nu cere SA JSON și nu marchează infrastructura configurată fără verificare reală"
      );
    }

    // Also verify logger redaction removes bearer & private keys cleanly
    const redactedSample = JSON.stringify(
      redactSensitiveData({
        token: "secret-abc",
        err: new Error("Authorization: Bearer eyJhbGciOiJSUzI1NiJ9.payload.sig failed"),
        keyText: "-----BEGIN PRIVATE KEY-----\nSECRET_KEY_BODY\n-----END PRIVATE KEY-----",
      })
    );
    assert(
      !redactedSample.includes("secret-abc") &&
        !redactedSample.includes("eyJhbGciOiJSUzI1NiJ9") &&
        !redactedSample.includes("SECRET_KEY_BODY") &&
        redactedSample.includes("[REDACTED]"),
      "TEST 8: Loggerul redactează automat tokenurile, headerele Bearer și cheile private"
    );
  } finally {
    CrmTenantStoreService.setFirestoreOriginForTests(null);
    GcpAuthService.setTestOrigins({ metadataOrigin: null, oauthTokenOrigin: null });
    GcpAuthService.clearTokenCache();
    clearVerifiedInfrastructureStatus();

    process.env.NODE_ENV = originalEnv.NODE_ENV;
    if (originalEnv.USE_GCP_METADATA_AUTH !== undefined) {
      process.env.USE_GCP_METADATA_AUTH = originalEnv.USE_GCP_METADATA_AUTH;
    } else delete process.env.USE_GCP_METADATA_AUTH;
    if (originalEnv.K_SERVICE !== undefined) {
      process.env.K_SERVICE = originalEnv.K_SERVICE;
    } else delete process.env.K_SERVICE;
    if (originalEnv.FIREBASE_SERVICE_ACCOUNT_JSON !== undefined) {
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON = originalEnv.FIREBASE_SERVICE_ACCOUNT_JSON;
    } else delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (originalEnv.GOOGLE_APPLICATION_CREDENTIALS !== undefined) {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = originalEnv.GOOGLE_APPLICATION_CREDENTIALS;
    } else delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (originalEnv.PERSISTENT_STORE_PATH !== undefined) {
      process.env.PERSISTENT_STORE_PATH = originalEnv.PERSISTENT_STORE_PATH;
    } else delete process.env.PERSISTENT_STORE_PATH;
    if (originalEnv.HOME !== undefined) {
      process.env.HOME = originalEnv.HOME;
    } else delete process.env.HOME;

    metaServer.close();
    oauthServer.close();
    gcpServer.close();
    try {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }

  console.log("-----------------------------------------------------------------");
  console.log(`📊 REZULTAT TESTE ADC & FIRESTORE PROD: ${passed} TRECUTE, ${failed} EȘUATE`);
  console.log("=================================================================");
  if (failed > 0) process.exit(1);
}

runAdcAndFirestoreTests().catch((err) => {
  console.error("Fatal error running ADC & Firestore prod tests:", err);
  process.exit(1);
});
