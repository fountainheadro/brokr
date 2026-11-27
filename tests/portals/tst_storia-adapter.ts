import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { CrmTenantStoreService } from "../../src/core/crm/svc_crm-tenant-store";
import { TransactionalOutboxService } from "../../src/core/jobs/svc_transactional-outbox";
import {
  assertSafeStoriaEndpointUrl,
  StoriaPortalProvider,
} from "../../src/core/portals/adapters/adp_storia-portal";
import {
  mapCanonicalToStoriaPayload,
  mapStoriaCategory,
  mapStoriaFloor,
  mapStoriaLocation,
  validateForStoria,
} from "../../src/core/portals/mappers/map_storia-taxonomy";
import { normalizeLeadToCanonicalSpecs } from "../../src/core/portals/svc_canonical-normalizer";
import { PortalCredentialsService } from "../../src/core/portals/svc_portal-credentials";
import { PortalPublishingOrchestrator } from "../../src/core/portals/svc_portal-orchestrator";
import { portalsRouter } from "../../server/portals/rtr_portals";

const TENANT_ALPHA = "ten_agency_a";
const TENANT_BETA = "ten_agency_b";

interface MockStoriaAdvert {
  id: string;
  external_ref: string;
  status: string;
  url: string;
  payload: Record<string, any>;
  revisions: number;
  views_count: number;
}

interface MockStoriaServerState {
  adverts: Map<string, MockStoriaAdvert>;
  oauthTokenCalls: number;
  activeTokens: Set<string>;
  nextTokenSeq: number;
  nextAdvertSeq: number;
  injectFault:
    | "none"
    | "rate_limit_429_once"
    | "upstream_503_once"
    | "remote_400_validation"
    | "force_401_once"
    | "force_401_always";
}

async function startMockStoriaHttpServer(): Promise<{
  baseUrl: string;
  oauthTokenUrl: string;
  state: MockStoriaServerState;
  close: () => Promise<void>;
}> {
  const state: MockStoriaServerState = {
    adverts: new Map(),
    oauthTokenCalls: 0,
    activeTokens: new Set(),
    nextTokenSeq: 1,
    nextAdvertSeq: 1000,
    injectFault: "none",
  };

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // OAuth2 Token Endpoint
  app.post("/oauth/token", (req, res) => {
    state.oauthTokenCalls++;
    const { grant_type, client_id, client_secret } = req.body || {};
    if (
      grant_type === "client_credentials" &&
      client_id === "storia_pilot_client" &&
      client_secret === "storia_pilot_secret_ok"
    ) {
      const token = `storia_tok_${state.nextTokenSeq++}`;
      state.activeTokens.add(token);
      res.json({
        access_token: token,
        token_type: "Bearer",
        expires_in: 3600,
      });
      return;
    }
    res.status(401).json({ error: "invalid_client", message: "Invalid Storia OAuth credentials" });
  });

  // Bearer Auth + Fault Middleware for /v1/*
  app.use("/v1", (req, res, next) => {
    const auth = String(req.headers.authorization || "");
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

    if (state.injectFault === "force_401_always") {
      res.status(401).json({ message: "Token revoked" });
      return;
    }
    if (state.injectFault === "force_401_once") {
      state.injectFault = "none";
      state.activeTokens.delete(token);
      res.status(401).json({ message: "Token expired" });
      return;
    }
    if (!token || (!state.activeTokens.has(token) && token !== "static_partner_api_key_valid")) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    if (state.injectFault === "rate_limit_429_once") {
      state.injectFault = "none";
      res.setHeader("Retry-After", "2");
      res.status(429).json({ message: "Rate limit exceeded" });
      return;
    }
    if (state.injectFault === "upstream_503_once") {
      state.injectFault = "none";
      res.status(503).json({ message: "Service temporarily unavailable" });
      return;
    }
    next();
  });

  app.get("/v1/account/me", (_req, res) => {
    res.json({
      agency_name: "Agency Alpha Imobiliare (Storia Partner)",
      email: "owner@agency-alpha.ro",
      status: "active",
    });
  });

  app.get("/v1/adverts", (req, res) => {
    const ref = String(req.query.external_ref || "");
    const items = Array.from(state.adverts.values()).filter(
      (ad) => !ref || ad.external_ref === ref
    );
    res.json({ items });
  });

  app.post("/v1/adverts", (req, res) => {
    if (state.injectFault === "remote_400_validation") {
      state.injectFault = "none";
      res.status(422).json({
        code: "VALIDATION_ERROR",
        errors: [
          {
            field: "location.zone",
            code: "INVALID_DISTRICT",
            message: "Zona selectată nu există în nomenclatorul Storia.ro.",
          },
        ],
      });
      return;
    }

    const body = req.body || {};
    const id = `sto_${state.nextAdvertSeq++}`;
    const advert: MockStoriaAdvert = {
      id,
      external_ref: String(body.external_ref || ""),
      status: "active",
      url: `https://www.storia.ro/ro/oferta/${id}`,
      payload: body,
      revisions: 1,
      views_count: 12,
    };
    state.adverts.set(id, advert);
    res.status(201).json(advert);
  });

  app.put("/v1/adverts/:id", (req, res) => {
    const existing = state.adverts.get(req.params.id);
    if (!existing) {
      res.status(404).json({ message: "Advert not found" });
      return;
    }
    existing.payload = req.body || {};
    existing.status = "active";
    existing.revisions += 1;
    res.json(existing);
  });

  app.post("/v1/adverts/:id/deactivate", (req, res) => {
    const existing = state.adverts.get(req.params.id);
    if (!existing) {
      res.status(404).json({ message: "Advert not found" });
      return;
    }
    existing.status = "inactive";
    res.json(existing);
  });

  app.delete("/v1/adverts/:id", (req, res) => {
    const existing = state.adverts.get(req.params.id);
    if (!existing) {
      res.status(404).json({ message: "Advert not found" });
      return;
    }
    existing.status = "deleted";
    res.status(204).end();
  });

  app.get("/v1/adverts/:id", (req, res) => {
    const existing = state.adverts.get(req.params.id);
    if (!existing) {
      res.status(404).json({ message: "Advert not found" });
      return;
    }
    res.json(existing);
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    baseUrl,
    oauthTokenUrl: `${baseUrl}/oauth/token`,
    state,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function buildPilotApartment(overrides: Record<string, any> = {}) {
  return {
    title: "Apartament 3 camere decomandat, Floreasca, parcare subterană inclusă",
    zone: "Floreasca, Sector 2",
    price: "210.000 €",
    transactionType: "Vânzare" as const,
    categoria: "Apartamente",
    buildingType: "Apartament",
    status: "Noua",
    ownerName: "Maria Ionescu",
    ownerPhone: "0744112233",
    rooms: "3 camere",
    baths: "2 băi",
    floor: "Etaj 4",
    totalFloors: "10",
    usefulArea: 84,
    constructionYear: "2021",
    compartimentare: "Decomandat",
    mobilare: "Mobilat complet",
    parcare: "Subteran",
    sursaIncalzire: "Centrală proprie",
    coverImage: "https://cdn.brokr.ro/floreasca-cover.webp",
    images: [
      "https://cdn.brokr.ro/floreasca-cover.webp",
      "https://cdn.brokr.ro/floreasca-living.webp",
      "https://cdn.brokr.ro/floreasca-bedroom.webp",
    ],
    portalExtensions: {
      storia: {
        promotionTier: "top_promo",
        hideExactAddress: true,
        agentEmail: "agent@agency-alpha.ro",
      },
    },
    extractedData: {
      description:
        "Apartament modern cu 3 camere decomandat în Floreasca, finisaje premium, centrală proprie, bucătărie complet mobilată și utilată, loc de parcare subteran inclus.",
      crmData: {
        localizare: {
          oras: "București",
          judet: "București",
          sector: "Sector 2",
          zona: "Floreasca",
          lat: 44.4642,
          lng: 26.0991,
        },
        caracteristici: {
          suprafete: { utila: 84, construita: 100.8 },
          alteDetalii: { anConstructie: 2021 },
        },
        performantaEnergetica: { clasaEnergetica: "A" },
      },
    },
    ...overrides,
  };
}

async function httpJson(
  baseUrl: string,
  method: string,
  route: string,
  headers: Record<string, string>,
  body?: unknown
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
}

async function main() {
  let passed = 0;
  async function runTest(name: string, fn: () => Promise<void> | void) {
    await fn();
    passed++;
    console.log(`✅ [PASS] ${name}`);
  }

  console.log("================================================================");
  console.log("🏠 BROKR PHASE 8 — STORIA.RO LIVE PORTAL ADAPTER TEST SUITE");
  console.log("================================================================");

  process.env.PORTAL_CREDENTIALS_MASTER_KEY =
    "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
  process.env.PORTAL_CREDENTIALS_KEY_VERSION = "1";

  const mockStoria = await startMockStoriaHttpServer();

  try {
    PortalPublishingOrchestrator.clearForTests([TENANT_ALPHA, TENANT_BETA]);
    TransactionalOutboxService.clearForTests();
    PortalPublishingOrchestrator.registerOutboxHandlers();

    const storiaProvider = PortalPublishingOrchestrator.getStoriaProviderForTests();
    storiaProvider.setTestEndpointsForTests({
      apiBaseUrl: mockStoria.baseUrl,
      oauthTokenUrl: mockStoria.oauthTokenUrl,
    });

    // 1. Taxonomy, Location, Floor & Payload Mapping + Romanian Pre-Flight Validation
    await runTest(
      "1. Storia taxonomy mapper maps Romanian categories, counties, sectors, attributes, extensions, and validates in Romanian",
      async () => {
        assert.equal(mapStoriaCategory("apartment", "sale").categoryCode, "apartments-for-sale");
        assert.equal(mapStoriaCategory("house_villa", "rent").categoryCode, "houses-for-rent");
        assert.equal(mapStoriaCategory("land", "sale").categoryCode, "plots-for-sale");
        assert.equal(mapStoriaCategory("office", "rent").categoryCode, "offices-for-rent");
        assert.equal(mapStoriaFloor(-1), "cellar");
        assert.equal(mapStoriaFloor(0), "ground_floor");
        assert.equal(mapStoriaFloor(4), "floor_4");
        assert.equal(mapStoriaFloor(14), "floor_higher_10");

        const raw = buildPilotApartment({ id: "prop_map_1", propertyId: "P8001", docVersion: 2 });
        const canonical = normalizeLeadToCanonicalSpecs(raw);
        const validation = validateForStoria(canonical);
        assert.equal(validation.valid, true, "Complete pilot apartment must pass Storia pre-flight validation");

        const loc = mapStoriaLocation(canonical);
        assert.equal(loc.country, "RO");
        assert.equal(loc.county, "București");
        assert.equal(loc.city, "București");
        assert.equal(loc.district, "Sector 2");
        assert.equal(loc.coordinates?.latitude, 44.4642);

        const payload = mapCanonicalToStoriaPayload(canonical, raw);
        assert.equal(payload.category, "apartments-for-sale");
        assert.equal(payload.transaction, "SELL");
        assert.equal(payload.price.value, 210000);
        assert.equal(payload.attributes.area_useful, 84);
        assert.equal(payload.attributes.rooms_num, 3);
        assert.equal(payload.attributes.build_year, 2021);
        assert.equal(payload.attributes.floor_no, "floor_4");
        assert.equal(payload.attributes.structure, "detached");
        assert.equal(payload.attributes.furnishing, "furnished");
        assert.equal(payload.attributes.heating, "gas_individual");
        assert.equal(payload.attributes.parking, "underground");
        assert.equal(payload.attributes.energy_class, "A");
        assert.equal(payload.metadata.promotion_tier, "top_promo");
        assert.equal(payload.metadata.hide_exact_address, true);
        assert.equal(payload.images.length, 3);

        // Invalid property returns clear Romanian field-level errors
        const invalidCanonical = normalizeLeadToCanonicalSpecs({
          id: "prop_bad",
          title: "Scurt",
          price: "",
          categoria: "Apartamente",
          images: ["http://insecure.example.com/photo.jpg"],
        });
        const badValidation = validateForStoria(invalidCanonical);
        assert.equal(badValidation.valid, false);
        assert.ok(badValidation.issues.some((i) => i.code === "STORIA_SHORT_TITLE"));
        assert.ok(badValidation.issues.some((i) => i.code === "STORIA_MISSING_PRICE"));
        assert.ok(badValidation.issues.some((i) => i.code === "STORIA_MISSING_CONSTRUCTION_YEAR"));
        assert.ok(badValidation.issues.some((i) => i.code === "STORIA_MISSING_HTTPS_PHOTOS"));
      }
    );

    // 2. SSRF Endpoint Allowlist Protection
    await runTest(
      "2. assertSafeStoriaEndpointUrl strictly allows official HTTPS Storia hosts and blocks untrusted/metadata/private URLs",
      async () => {
        assert.equal(
          assertSafeStoriaEndpointUrl("https://api.storia.ro/", "API"),
          "https://api.storia.ro"
        );
        assert.equal(
          assertSafeStoriaEndpointUrl("https://api.sandbox.storia.ro", "API"),
          "https://api.sandbox.storia.ro"
        );

        const blockedUrls = [
          "http://api.storia.ro",
          "https://evil.example.com",
          "http://169.254.169.254/latest/meta-data/",
          "https://10.0.0.5/v1/adverts",
          "ftp://api.storia.ro",
        ];
        for (const bad of blockedUrls) {
          assert.throws(
            () => assertSafeStoriaEndpointUrl(bad, "API"),
            /STORIA_UNTRUSTED_ENDPOINT|Endpoint neautorizat/
          );
        }
      }
    );

    // 3. OAuth2 Client Credentials Issuance, Caching & Automatic Refresh on 401
    await runTest(
      "3. StoriaPortalProvider issues & caches OAuth2 tokens and automatically refreshes once on expired 401",
      async () => {
        storiaProvider.clearRuntimeCachesForTests();
        mockStoria.state.oauthTokenCalls = 0;

        const creds = {
          clientId: "storia_pilot_client",
          clientSecret: "storia_pilot_secret_ok",
        };

        // First call issues OAuth token
        const t1 = await storiaProvider.testCredentials(creds);
        assert.equal(t1.ok, true);
        assert.ok(t1.accountLabel?.includes("Agency Alpha"));
        assert.equal(mockStoria.state.oauthTokenCalls, 1);

        // Second call reuses cached OAuth token (0 extra token calls)
        const t2 = await storiaProvider.testCredentials(creds);
        assert.equal(t2.ok, true);
        assert.equal(mockStoria.state.oauthTokenCalls, 1);

        // Simulate remote token expiry (401 once) -> adapter refreshes OAuth token & succeeds transparently
        mockStoria.state.injectFault = "force_401_once";
        const t3 = await storiaProvider.testCredentials(creds);
        assert.equal(t3.ok, true);
        assert.equal(mockStoria.state.oauthTokenCalls, 2, "Adapter must refresh expired OAuth token automatically");
      }
    );

    // 4. Per-Agency Feature Flag Gating, Full Pilot Lifecycle & Instant Rollback
    await runTest(
      "4. Per-agency enabledProviders gates Storia.ro until pilot opt-in, runs full E2E publish->update->pause->withdraw, and supports instant rollback",
      async () => {
        TransactionalOutboxService.clearForTests();
        PortalPublishingOrchestrator.registerOutboxHandlers();

        await PortalCredentialsService.saveConnection({
          tenantId: TENANT_ALPHA,
          providerId: "storia_ro",
          accountLabel: "Agency Alpha Storia",
          credentials: {
            clientId: "storia_pilot_client",
            clientSecret: "storia_pilot_secret_ok",
          },
          updatedBy: "owner@agency-alpha.ro",
        });

        const prop = await CrmTenantStoreService.create(
          TENANT_ALPHA,
          "leads",
          buildPilotApartment(),
          "usr_alpha_owner"
        );

        // 4a. Before pilot opt-in, publishing to storia_ro is strictly blocked (403 MODULE_DISABLED)
        await assert.rejects(
          () =>
            PortalPublishingOrchestrator.requestPublishOrUpdate({
              tenantId: TENANT_ALPHA,
              propertyId: prop.id,
              providerId: "storia_ro",
            }),
          /nu este activată pentru această agenție/
        );

        // 4b. Enable storia_ro strictly for Pilot Agency Alpha
        await PortalPublishingOrchestrator.updateTenantPortalSettings({
          tenantId: TENANT_ALPHA,
          enabledProviders: ["mock_portal", "storia_ro"],
          updatedBy: "owner@agency-alpha.ro",
        });

        // Step A: Publish
        const pubReq = await PortalPublishingOrchestrator.requestPublishOrUpdate({
          tenantId: TENANT_ALPHA,
          propertyId: prop.id,
          providerId: "storia_ro",
          requestedBy: "owner@agency-alpha.ro",
        });
        assert.equal(pubReq.accepted, true);
        assert.equal(pubReq.publication.status, "pending");

        const b1 = await TransactionalOutboxService.processDueEvents({ limit: 10 });
        assert.equal(b1.completed, 1);

        const afterPub = await PortalPublishingOrchestrator.getPublication(
          TENANT_ALPHA,
          prop.id,
          "storia_ro"
        );
        assert.equal(afterPub?.status, "published");
        assert.ok(afterPub?.externalListingId?.startsWith("sto_"));
        assert.equal(afterPub?.syncedVersion, 1);

        // Step B: Update price & add photo -> PUT on existing Storia listing (no duplicate)
        await CrmTenantStoreService.update(TENANT_ALPHA, "leads", prop.id, {
          price: "219.000 €",
          images: [
            "https://cdn.brokr.ro/floreasca-cover.webp",
            "https://cdn.brokr.ro/floreasca-living.webp",
            "https://cdn.brokr.ro/floreasca-bedroom.webp",
            "https://cdn.brokr.ro/floreasca-terrace.webp",
          ],
        });

        await PortalPublishingOrchestrator.requestPublishOrUpdate({
          tenantId: TENANT_ALPHA,
          propertyId: prop.id,
          providerId: "storia_ro",
        });
        const b2 = await TransactionalOutboxService.processDueEvents({ limit: 10 });
        assert.equal(b2.completed, 1);

        const afterUpd = await PortalPublishingOrchestrator.getPublication(
          TENANT_ALPHA,
          prop.id,
          "storia_ro"
        );
        assert.equal(afterUpd?.status, "published");
        assert.equal(afterUpd?.syncedVersion, 2);
        const remoteAd = mockStoria.state.adverts.get(afterUpd!.externalListingId!);
        assert.equal(remoteAd?.revisions, 2);
        assert.equal(remoteAd?.payload?.price?.value, 219000);
        assert.equal(remoteAd?.payload?.images?.length, 4);

        // Step C: Pause -> POST /v1/adverts/:id/deactivate
        await PortalPublishingOrchestrator.requestPause({
          tenantId: TENANT_ALPHA,
          propertyId: prop.id,
          providerId: "storia_ro",
        });
        await TransactionalOutboxService.processDueEvents({ limit: 10 });
        const afterPause = await PortalPublishingOrchestrator.getPublication(
          TENANT_ALPHA,
          prop.id,
          "storia_ro"
        );
        assert.equal(afterPause?.status, "paused");
        assert.equal(mockStoria.state.adverts.get(afterPause!.externalListingId!)?.status, "inactive");

        // Step D: Sync status from Storia API
        const synced = await PortalPublishingOrchestrator.syncStatus({
          tenantId: TENANT_ALPHA,
          propertyId: prop.id,
          providerId: "storia_ro",
        });
        assert.equal(synced.status, "paused");

        // Step E: Withdraw -> DELETE /v1/adverts/:id
        await PortalPublishingOrchestrator.requestWithdraw({
          tenantId: TENANT_ALPHA,
          propertyId: prop.id,
          providerId: "storia_ro",
        });
        await TransactionalOutboxService.processDueEvents({ limit: 10 });
        const afterWithdraw = await PortalPublishingOrchestrator.getPublication(
          TENANT_ALPHA,
          prop.id,
          "storia_ro"
        );
        assert.equal(afterWithdraw?.status, "withdrawn");
        assert.equal(mockStoria.state.adverts.get(afterWithdraw!.externalListingId!)?.status, "deleted");

        // Step F: Instant Rollback disables storia_ro for Agency Alpha without touching remote ads
        await PortalPublishingOrchestrator.updateTenantPortalSettings({
          tenantId: TENANT_ALPHA,
          enabledProviders: ["mock_portal"],
          updatedBy: "owner@agency-alpha.ro",
        });
        await assert.rejects(
          () =>
            PortalPublishingOrchestrator.requestPublishOrUpdate({
              tenantId: TENANT_ALPHA,
              propertyId: prop.id,
              providerId: "storia_ro",
            }),
          /nu este activată/
        );
      }
    );

    // 5. Crash-Recovery Zero-Duplicate Pre-Check (external_ref lookup)
    await runTest(
      "5. Zero-duplicate pre-check reconciles existing Storia advert by external_ref after simulated crash retry",
      async () => {
        TransactionalOutboxService.clearForTests();
        PortalPublishingOrchestrator.registerOutboxHandlers();
        mockStoria.state.adverts.clear();

        await PortalPublishingOrchestrator.updateTenantPortalSettings({
          tenantId: TENANT_ALPHA,
          enabledProviders: ["mock_portal", "storia_ro"],
          updatedBy: "owner@agency-alpha.ro",
        });

        const prop = await CrmTenantStoreService.create(
          TENANT_ALPHA,
          "leads",
          buildPilotApartment(),
          "usr_alpha_owner"
        );

        // Simulate prior worker crash: Storia already has an advert for `brokr:ten_agency_a:${prop.id}`
        // while BROKR has NO saved externalListingId yet!
        const ref = `brokr:${TENANT_ALPHA}:${prop.id}`;
        mockStoria.state.adverts.set("sto_preexisting_99", {
          id: "sto_preexisting_99",
          external_ref: ref,
          status: "active",
          url: "https://www.storia.ro/ro/oferta/sto_preexisting_99",
          payload: { external_ref: ref },
          revisions: 1,
          views_count: 5,
        });

        await PortalPublishingOrchestrator.requestPublishOrUpdate({
          tenantId: TENANT_ALPHA,
          propertyId: prop.id,
          providerId: "storia_ro",
        });
        const res = await TransactionalOutboxService.processDueEvents({ limit: 10 });
        assert.equal(res.completed, 1);

        const pub = await PortalPublishingOrchestrator.getPublication(
          TENANT_ALPHA,
          prop.id,
          "storia_ro"
        );
        assert.equal(pub?.externalListingId, "sto_preexisting_99", "Must reconcile existing Storia ID");
        assert.equal(mockStoria.state.adverts.size, 1, "Zero duplicate adverts may be created on Storia");
        assert.equal(mockStoria.state.adverts.get("sto_preexisting_99")?.revisions, 2);
      }
    );

    // 6. Rate-Limit 429 & 503 Retries vs. Permanent 422 Validation & 401 Auth DLQ
    await runTest(
      "6. Handles Storia 429 rate-limit & 503 retries cleanly and dead-letters permanent 422 validation & 401 auth errors",
      async () => {
        TransactionalOutboxService.clearForTests();
        PortalPublishingOrchestrator.registerOutboxHandlers();

        // 6a: 429 Retry-After -> retries and succeeds
        const p429 = await CrmTenantStoreService.create(
          TENANT_ALPHA,
          "leads",
          buildPilotApartment(),
          "usr_alpha_owner"
        );
        mockStoria.state.injectFault = "rate_limit_429_once";
        await PortalPublishingOrchestrator.requestPublishOrUpdate({
          tenantId: TENANT_ALPHA,
          propertyId: p429.id,
          providerId: "storia_ro",
        });
        const pass1 = await TransactionalOutboxService.processDueEvents({ limit: 10 });
        assert.equal(pass1.retryable, 1, "429 Too Many Requests must be retryable");
        assert.equal(pass1.deadLettered, 0);

        const pass2 = await TransactionalOutboxService.processDueEvents({
          limit: 10,
          nowMs: Date.now() + 120_000,
        });
        assert.equal(pass2.completed, 1, "Retry after 429 must succeed");

        // 6b: 422 remote validation -> immediate rejected + Romanian field issues + dead_letter
        const p422 = await CrmTenantStoreService.create(
          TENANT_ALPHA,
          "leads",
          buildPilotApartment(),
          "usr_alpha_owner"
        );
        mockStoria.state.injectFault = "remote_400_validation";
        await PortalPublishingOrchestrator.requestPublishOrUpdate({
          tenantId: TENANT_ALPHA,
          propertyId: p422.id,
          providerId: "storia_ro",
        });
        const pass422 = await TransactionalOutboxService.processDueEvents({ limit: 10 });
        assert.equal(pass422.deadLettered, 1);
        assert.equal(pass422.retryable, 0);

        const pub422 = await PortalPublishingOrchestrator.getPublication(
          TENANT_ALPHA,
          p422.id,
          "storia_ro"
        );
        assert.equal(pub422?.status, "rejected");
        assert.ok(
          pub422?.validationErrors.some((e) => e.message.includes("Zonă")),
          "Must translate Storia remote field error to Romanian"
        );

        // 6c: Permanent 401 -> marks connection expired + sync_error + dead_letter
        const p401 = await CrmTenantStoreService.create(
          TENANT_ALPHA,
          "leads",
          buildPilotApartment(),
          "usr_alpha_owner"
        );
        mockStoria.state.injectFault = "force_401_always";
        await PortalPublishingOrchestrator.requestPublishOrUpdate({
          tenantId: TENANT_ALPHA,
          propertyId: p401.id,
          providerId: "storia_ro",
        });
        const pass401 = await TransactionalOutboxService.processDueEvents({ limit: 10 });
        assert.equal(pass401.deadLettered, 1);
        const conn = await PortalCredentialsService.getConnection(TENANT_ALPHA, "storia_ro");
        assert.equal(conn?.status, "expired");
        mockStoria.state.injectFault = "none";
      }
    );

    // 7. Express /api/portals/settings & /api/portals/providers Multi-Tenant Rollout Isolation
    await runTest(
      "7. Express /api/portals/settings enforces Agency Admin RBAC and keeps Storia enablement strictly isolated per agency",
      async () => {
        const app = express();
        app.use(express.json());
        app.use("/api/portals", portalsRouter);

        const server = http.createServer(app);
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const addr = server.address() as { port: number };
        const baseUrl = `http://127.0.0.1:${addr.port}`;

        try {
          const alphaOwnerHeaders = {
            Authorization: "Bearer token_usr_alpha_owner",
            "x-tenant-override": "agency-a",
          };
          const alphaAgentHeaders = {
            Authorization: "Bearer token_usr_alpha_agent",
            "x-tenant-override": "agency-a",
          };
          const betaOwnerHeaders = {
            Authorization: "Bearer token_usr_beta_owner",
            "x-tenant-override": "agency-b",
          };

          // Regular agent cannot toggle enabledProviders (403)
          const agentPut = await httpJson(
            baseUrl,
            "PUT",
            "/api/portals/settings",
            alphaAgentHeaders,
            { enabledProviders: ["mock_portal", "storia_ro"] }
          );
          assert.equal(agentPut.status, 403);

          // Agency Alpha owner enables storia_ro (200)
          const alphaPut = await httpJson(
            baseUrl,
            "PUT",
            "/api/portals/settings",
            alphaOwnerHeaders,
            { enabledProviders: ["mock_portal", "storia_ro"] }
          );
          assert.equal(alphaPut.status, 200);
          assert.deepEqual(alphaPut.body?.data?.settings?.enabledProviders, [
            "mock_portal",
            "storia_ro",
          ]);

          // Agency Alpha sees storia_ro enabledForTenant: true
          const alphaProviders = await httpJson(
            baseUrl,
            "GET",
            "/api/portals/providers",
            alphaOwnerHeaders
          );
          assert.equal(alphaProviders.status, 200);
          const alphaStoria = alphaProviders.body?.data?.providers?.find(
            (p: any) => p.providerId === "storia_ro"
          );
          assert.equal(alphaStoria?.enabledForTenant, true);

          // Agency Beta still has storia_ro enabledForTenant: false (pilot isolation)
          const betaProviders = await httpJson(
            baseUrl,
            "GET",
            "/api/portals/providers",
            betaOwnerHeaders
          );
          assert.equal(betaProviders.status, 200);
          const betaStoria = betaProviders.body?.data?.providers?.find(
            (p: any) => p.providerId === "storia_ro"
          );
          assert.equal(betaStoria?.enabledForTenant, false);

          // Agency Alpha owner can test live Storia OAuth credentials via HTTP API without leaking secrets
          const testConn = await httpJson(
            baseUrl,
            "POST",
            "/api/portals/connections/storia_ro/test",
            alphaOwnerHeaders,
            {}
          );
          assert.equal(testConn.status, 200);
          assert.equal(testConn.body?.data?.ok, true);
          assert.equal(JSON.stringify(testConn.body).includes("storia_pilot_secret_ok"), false);
        } finally {
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      }
    );

    // 8. Local Sliding-Window Per-Tenant Rate Limiter Verification
    await runTest(
      "8. Local per-tenant rate limiter protects Storia partner quota without cross-tenant interference",
      async () => {
        const tightProvider = new StoriaPortalProvider({
          apiBaseUrlOverrideForTests: mockStoria.baseUrl,
          oauthTokenUrlOverrideForTests: mockStoria.oauthTokenUrl,
          rateLimitMaxPerMin: 2,
        });
        const creds = { apiKey: "static_partner_api_key_valid" };
        // Two calls succeed under limit=2
        const r1 = await tightProvider.testCredentials(creds);
        const r2 = await tightProvider.testCredentials(creds);
        assert.equal(r1.ok, true);
        assert.equal(r2.ok, true);
        // Third call within 60s trips local rate limit cleanly (returns ok: false with Romanian message)
        const r3 = await tightProvider.testCredentials(creds);
        assert.equal(r3.ok, false);
        assert.ok(r3.message?.includes("Limita locală"));
      }
    );

    console.log("================================================================");
    console.log(`🎉 ALL ${passed} PHASE 8 STORIA.RO ADAPTER TESTS PASSED!`);
    console.log("================================================================");
  } finally {
    await mockStoria.close();
  }
}

main().catch((err) => {
  console.error("❌ Phase 8 Storia Adapter Test Suite failed:", err);
  process.exit(1);
});
