import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import express from "express";
import { CrmTenantStoreService } from "../../src/core/crm/svc_crm-tenant-store";
import { LEAD_SUMMARY_COLLECTION } from "../../src/core/crm/svc_lead-projection";
import { PersistentStoreService } from "../../src/core/database/svc_persistent-store";
import { TransactionalOutboxService } from "../../src/core/jobs/svc_transactional-outbox";
import { normalizeLeadToCanonicalSpecs } from "../../src/core/portals/svc_canonical-normalizer";
import { PortalCredentialsService } from "../../src/core/portals/svc_portal-credentials";
import { PortalPublishingOrchestrator } from "../../src/core/portals/svc_portal-orchestrator";
import { portalsRouter } from "../../server/portals/rtr_portals";

const TENANT_ALPHA = "ten_agency_a";
const TENANT_BETA = "ten_agency_b";

function buildCompletePropertyPayload(overrides: Record<string, any> = {}) {
  return {
    title: "Apartament 3 camere decomandat, zona Floreasca, parcare inclusă",
    zone: "Floreasca",
    price: "185.000 €",
    transactionType: "Vânzare" as const,
    categoria: "Apartamente",
    buildingType: "Apartament",
    status: "Noua",
    ownerName: "Ion Popescu",
    ownerPhone: "0722123456",
    rooms: "3 camere",
    baths: "2 băi",
    floor: "Etaj 3",
    totalFloors: "8",
    usefulArea: 78,
    constructionYear: "2019",
    compartimentare: "Decomandat",
    mobilare: "Mobilat complet",
    parcare: "1 loc subteran",
    sursaIncalzire: "Centrală proprie",
    coverImage: "https://cdn.example.com/prop-1-cover.webp",
    images: [
      "https://cdn.example.com/prop-1-cover.webp",
      "https://cdn.example.com/prop-1-living.webp",
      "https://cdn.example.com/prop-1-kitchen.webp",
      "https://cdn.example.com/prop-1-living.webp", // duplicate should be deduplicated
    ],
    extractedData: {
      description:
        "Apartament luminos cu 3 camere, renovat recent, vedere deschisă, bucătărie complet utilată și loc de parcare subteran inclus.",
      crmData: {
        locatie: {
          oras: "București",
          judet: "București",
          zona: "Floreasca",
          lat: 44.4631,
          lng: 26.0987,
        },
        caracteristici: {
          suprafete: {
            suprafataUtila: 78,
            suprafataConstruita: 93.6,
            balcoane: 1,
          },
          alteDetalii: {
            anConstructie: 2019,
            compartimentare: "Decomandat",
          },
        },
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
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

async function main() {
  let passed = 0;
  async function runTest(name: string, fn: () => Promise<void> | void) {
    await fn();
    passed++;
    console.log(`✅ [PASS] ${name}`);
  }

  console.log("================================================================");
  console.log("🌐 BROKR PHASE 7 — EXTERNAL PORTAL PUBLISHING FOUNDATION SUITE");
  console.log("================================================================");

  // Set deterministic test master key (32-byte hex) for AES-256-GCM envelope encryption
  process.env.PORTAL_CREDENTIALS_MASTER_KEY =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  process.env.PORTAL_CREDENTIALS_KEY_VERSION = "1";

  // Clean state
  PortalPublishingOrchestrator.clearForTests([TENANT_ALPHA, TENANT_BETA]);
  TransactionalOutboxService.clearForTests();
  PortalPublishingOrchestrator.registerOutboxHandlers();

  // 1. Canonical Property Specs normalizer accuracy & backward compatibility
  await runTest(
    "1. normalizeLeadToCanonicalSpecs parses Romanian prices, areas, rooms, geo, and deduplicated ordered media",
    async () => {
      const sample = buildCompletePropertyPayload({ id: "prop_norm_1", propertyId: "P1001", docVersion: 3 });
      const canonical = normalizeLeadToCanonicalSpecs(sample);

      assert.equal(canonical.schemaVersion, 1);
      assert.equal(canonical.propertyId, "P1001");
      assert.equal(canonical.transactionType, "sale");
      assert.equal(canonical.category, "apartment");
      assert.equal(canonical.priceNumeric, 185000);
      assert.equal(canonical.currencyCode, "EUR");
      assert.equal(canonical.roomsCount, 3);
      assert.equal(canonical.bathroomsCount, 2);
      assert.equal(canonical.floorNumber, 3);
      assert.equal(canonical.totalFloors, 8);
      assert.equal(canonical.usefulAreaSqm, 78);
      assert.equal(canonical.builtAreaSqm, 93.6);
      assert.equal(canonical.constructionYear, 2019);
      assert.equal(canonical.geo.city, "București");
      assert.equal(canonical.geo.zone, "Floreasca");
      assert.equal(canonical.geo.lat, 44.4631);
      assert.equal(canonical.docVersion, 3);

      // Deduplicates identical image URLs and puts cover first
      assert.equal(canonical.orderedMedia.length, 3);
      assert.equal(canonical.orderedMedia[0].isCover, true);
      assert.equal(canonical.orderedMedia[0].url, "https://cdn.example.com/prop-1-cover.webp");
      assert.equal(canonical.orderedMedia[0].sortOrder, 0);
      assert.equal(canonical.orderedMedia[1].sortOrder, 1);

      // Rental & Parter & RON parsing check
      const rentalCanonical = normalizeLeadToCanonicalSpecs({
        id: "prop_norm_2",
        title: "Garsonieră parter Drumul Taberei",
        price: "2.400 RON",
        transactionType: "Închiriere",
        categoria: "Garsonieră",
        floor: "Parter",
        usefulArea: 36,
      });
      assert.equal(rentalCanonical.transactionType, "rent");
      assert.equal(rentalCanonical.category, "studio");
      assert.equal(rentalCanonical.priceNumeric, 2400);
      assert.equal(rentalCanonical.currencyCode, "RON");
      assert.equal(rentalCanonical.floorNumber, 0);
      assert.equal(rentalCanonical.roomsCount, 1);
    }
  );

  // 2. CrmTenantStoreService lazy canonicalSpecs on create & update while keeping leads_summary slim
  await runTest(
    "2. CrmTenantStoreService lazily populates canonicalSpecs on create/update without bloating leads_summary",
    async () => {
      const created = await CrmTenantStoreService.create(
        TENANT_ALPHA,
        "leads",
        buildCompletePropertyPayload(),
        "usr_alpha_owner"
      );

      assert.ok(created.canonicalSpecs, "canonicalSpecs must be lazily attached on create");
      assert.equal(created.canonicalSpecs.priceNumeric, 185000);
      assert.equal(created.canonicalSpecs.docVersion, 1);
      // Existing legacy string fields stay 100% intact
      assert.equal(created.price, "185.000 €");
      assert.equal(created.rooms, "3 camere");

      const summary = PersistentStoreService.get<Record<string, any>>(
        `tenants__${TENANT_ALPHA}__${LEAD_SUMMARY_COLLECTION}`,
        created.id
      );
      assert.ok(summary, "leads_summary projection must exist");
      assert.equal(
        summary.canonicalSpecs,
        undefined,
        "leads_summary must remain slim and exclude canonicalSpecs"
      );

      // Updating price & photos updates canonicalSpecs and increments docVersion
      const updated = await CrmTenantStoreService.update(TENANT_ALPHA, "leads", created.id, {
        price: "179.000 €",
      });
      assert.equal(updated.docVersion, 2);
      assert.equal(updated.canonicalSpecs.priceNumeric, 179000);
      assert.equal(updated.canonicalSpecs.docVersion, 2);
    }
  );

  // 3. AES-256-GCM Envelope Encryption & Cryptographic Tenant/Provider Isolation
  await runTest(
    "3. PortalCredentialsService enforces AES-256-GCM envelope encryption, rejects tampering and cross-tenant AAD misuse, and never leaks secrets",
    async () => {
      const secretApiKey = "sk_live_mock_super_secret_token_98765";
      const meta = await PortalCredentialsService.saveConnection({
        tenantId: TENANT_ALPHA,
        providerId: "mock_portal",
        accountLabel: "Agenția Alpha Sandbox",
        credentials: { apiKey: secretApiKey, agencyCode: "ALPHA-01" },
        updatedBy: "owner@agency-alpha.ro",
      });

      assert.equal(meta.hasCredentials, true);
      assert.equal(meta.status, "connected");
      assert.equal(JSON.stringify(meta).includes(secretApiKey), false, "Metadata must never contain raw secret");

      const envelope = await PortalCredentialsService.getEncryptedEnvelopeForAudit(
        TENANT_ALPHA,
        "mock_portal"
      );
      assert.ok(envelope, "Encrypted secret envelope must be persisted separately");
      assert.equal(envelope.algorithm, "aes-256-gcm");
      assert.equal(
        JSON.stringify(envelope).includes(secretApiKey),
        false,
        "Envelope on disk/Firestore must never contain plaintext secret"
      );

      // Valid decryption succeeds
      const decrypted = await PortalCredentialsService.loadDecryptedCredentials(
        TENANT_ALPHA,
        "mock_portal"
      );
      assert.equal(decrypted?.apiKey, secretApiKey);
      assert.equal(decrypted?.agencyCode, "ALPHA-01");

      // Cross-tenant decryption MUST fail cryptographically (and guard check)
      assert.throws(() => {
        PortalCredentialsService.decryptCredentials({
          tenantId: TENANT_BETA,
          providerId: "mock_portal",
          envelope: { ...envelope, tenantId: TENANT_BETA },
        });
      }, /Decriptarea credențialelor portalului a eșuat|Acces refuzat/);

      // Cross-provider decryption MUST fail AAD verification
      assert.throws(() => {
        PortalCredentialsService.decryptCredentials({
          tenantId: TENANT_ALPHA,
          providerId: "other_portal",
          envelope: { ...envelope, providerId: "other_portal" },
        });
      }, /Decriptarea credențialelor portalului a eșuat|Acces refuzat/);

      // Ciphertext tampering MUST fail auth tag check
      const tamperedCipher = Buffer.from(envelope.ciphertextBase64, "base64");
      tamperedCipher[0] ^= 0xff;
      assert.throws(() => {
        PortalCredentialsService.decryptCredentials({
          tenantId: TENANT_ALPHA,
          providerId: "mock_portal",
          envelope: { ...envelope, ciphertextBase64: tamperedCipher.toString("base64") },
        });
      }, /Decriptarea credențialelor portalului a eșuat/);
    }
  );

  // 4. Pre-flight validation failure returns Romanian issues & never blocks CRM save
  await runTest(
    "4. Pre-flight validation blocks incomplete listings on the target portal with Romanian messages without blocking BROKR CRM saves",
    async () => {
      // Property missing constructionYear and photos saves cleanly in BROKR CRM
      const incomplete = await CrmTenantStoreService.create(
        TENANT_ALPHA,
        "leads",
        buildCompletePropertyPayload({
          title: "Apartament 2 camere central",
          constructionYear: "",
          coverImage: "",
          images: [],
          extractedData: { crmData: { locatie: { oras: "București", zona: "Unirii" } } },
        }),
        "usr_alpha_owner"
      );
      assert.ok(incomplete.id, "BROKR CRM save must always succeed even if incomplete for external portal");

      const attempt = await PortalPublishingOrchestrator.requestPublishOrUpdate({
        tenantId: TENANT_ALPHA,
        propertyId: incomplete.id,
        providerId: "mock_portal",
        requestedBy: "owner@agency-alpha.ro",
      });

      assert.equal(attempt.accepted, false);
      assert.equal(attempt.publication.status, "rejected");
      assert.ok(
        attempt.validation.issues.some((i) => i.code === "MISSING_CONSTRUCTION_YEAR"),
        "Must report missing construction year"
      );
      assert.ok(
        attempt.validation.issues.some((i) => i.code === "MISSING_PHOTOS"),
        "Must report missing photos"
      );
      assert.ok(
        attempt.validation.issues.every((i) => i.message.length > 10),
        "Validation issues must provide actionable Romanian messages"
      );
    }
  );

  // 5. Full E2E lifecycle: publish -> outbox -> update price/photos -> pause -> withdraw
  await runTest(
    "5. Full MockPortalProvider + TransactionalOutbox lifecycle (publish -> update -> pause -> withdraw)",
    async () => {
      const mockProvider = PortalPublishingOrchestrator.getMockProviderForTests();
      mockProvider.resetForTests();
      TransactionalOutboxService.clearForTests();
      PortalPublishingOrchestrator.registerOutboxHandlers();

      const prop = await CrmTenantStoreService.create(
        TENANT_ALPHA,
        "leads",
        buildCompletePropertyPayload(),
        "usr_alpha_owner"
      );

      // Step A: Publish
      const pubReq = await PortalPublishingOrchestrator.requestPublishOrUpdate({
        tenantId: TENANT_ALPHA,
        propertyId: prop.id,
        providerId: "mock_portal",
        requestedBy: "owner@agency-alpha.ro",
      });
      assert.equal(pubReq.accepted, true);
      assert.equal(pubReq.publication.status, "pending");
      assert.ok(pubReq.outboxEventId);

      const batch1 = await TransactionalOutboxService.processDueEvents({ limit: 10 });
      assert.equal(batch1.completed, 1);

      const afterPublish = await PortalPublishingOrchestrator.getPublication(
        TENANT_ALPHA,
        prop.id,
        "mock_portal"
      );
      assert.ok(afterPublish);
      assert.equal(afterPublish.status, "published");
      assert.ok(afterPublish.externalListingId?.startsWith("mock_"));
      assert.ok(afterPublish.externalUrl?.includes(afterPublish.externalListingId!));
      assert.equal(afterPublish.syncedVersion, 1);
      assert.equal(afterPublish.submittedVersion, 1);

      // Step B: Update price & add a photo -> enqueue portal_update -> syncedVersion increments to 2
      await CrmTenantStoreService.update(TENANT_ALPHA, "leads", prop.id, {
        price: "192.500 €",
        images: [
          "https://cdn.example.com/prop-1-cover.webp",
          "https://cdn.example.com/prop-1-living.webp",
          "https://cdn.example.com/prop-1-kitchen.webp",
          "https://cdn.example.com/prop-1-terrace.webp",
        ],
      });

      const updReq = await PortalPublishingOrchestrator.requestPublishOrUpdate({
        tenantId: TENANT_ALPHA,
        propertyId: prop.id,
        providerId: "mock_portal",
        requestedBy: "owner@agency-alpha.ro",
      });
      assert.equal(updReq.accepted, true);
      assert.equal(updReq.publication.status, "update_pending");

      const batch2 = await TransactionalOutboxService.processDueEvents({ limit: 10 });
      assert.equal(batch2.completed, 1);

      const afterUpdate = await PortalPublishingOrchestrator.getPublication(
        TENANT_ALPHA,
        prop.id,
        "mock_portal"
      );
      assert.equal(afterUpdate?.status, "published");
      assert.equal(afterUpdate?.syncedVersion, 2);
      const mockListing = mockProvider.getStoredListingForTests(afterUpdate!.externalListingId!);
      assert.equal((mockListing?.payload as any)?.price?.amount, 192500);
      assert.equal((mockListing?.payload as any)?.media?.length, 4);
      assert.equal(mockListing?.revisionCount, 2);

      // Step C: Pause
      await PortalPublishingOrchestrator.requestPause({
        tenantId: TENANT_ALPHA,
        propertyId: prop.id,
        providerId: "mock_portal",
        requestedBy: "owner@agency-alpha.ro",
      });
      await TransactionalOutboxService.processDueEvents({ limit: 10 });
      const afterPause = await PortalPublishingOrchestrator.getPublication(
        TENANT_ALPHA,
        prop.id,
        "mock_portal"
      );
      assert.equal(afterPause?.status, "paused");

      // Step D: Withdraw
      await PortalPublishingOrchestrator.requestWithdraw({
        tenantId: TENANT_ALPHA,
        propertyId: prop.id,
        providerId: "mock_portal",
        requestedBy: "owner@agency-alpha.ro",
      });
      await TransactionalOutboxService.processDueEvents({ limit: 10 });
      const afterWithdraw = await PortalPublishingOrchestrator.getPublication(
        TENANT_ALPHA,
        prop.id,
        "mock_portal"
      );
      assert.equal(afterWithdraw?.status, "withdrawn");
      assert.equal(afterWithdraw?.externalUrl, null);
    }
  );

  // 6. Retry semantics: transient 503 retries and recovers; permanent 400 & 401 go straight to DLQ
  await runTest(
    "6. Outbox retries transient 503 errors with backoff and moves permanent 400/401 failures straight to dead_letter",
    async () => {
      const mockProvider = PortalPublishingOrchestrator.getMockProviderForTests();
      mockProvider.resetForTests();
      TransactionalOutboxService.clearForTests();
      PortalPublishingOrchestrator.registerOutboxHandlers();

      // 6a: Transient 503 once -> retries and succeeds
      const propTransient = await CrmTenantStoreService.create(
        TENANT_ALPHA,
        "leads",
        buildCompletePropertyPayload(),
        "usr_alpha_owner"
      );
      mockProvider.setFaultModeForTests("transient_503_once", 1);

      const reqTransient = await PortalPublishingOrchestrator.requestPublishOrUpdate({
        tenantId: TENANT_ALPHA,
        propertyId: propTransient.id,
        providerId: "mock_portal",
      });
      assert.equal(reqTransient.accepted, true);

      const firstPass = await TransactionalOutboxService.processDueEvents({ limit: 10 });
      assert.equal(firstPass.retryable, 1, "Transient 503 must be scheduled for retry");
      assert.equal(firstPass.deadLettered, 0);

      // Advance clock past backoff window so retry runs
      const retryPass = await TransactionalOutboxService.processDueEvents({
        limit: 10,
        nowMs: Date.now() + 120_000,
      });
      assert.equal(retryPass.completed, 1, "Retry attempt must succeed after transient fault clears");

      const pubTransient = await PortalPublishingOrchestrator.getPublication(
        TENANT_ALPHA,
        propTransient.id,
        "mock_portal"
      );
      assert.equal(pubTransient?.status, "published");

      // 6b: Permanent 400 remote validation -> immediate rejected + dead_letter (zero blind retries)
      const propPerm400 = await CrmTenantStoreService.create(
        TENANT_ALPHA,
        "leads",
        buildCompletePropertyPayload(),
        "usr_alpha_owner"
      );
      mockProvider.setFaultModeForTests("permanent_400_validation");

      await PortalPublishingOrchestrator.requestPublishOrUpdate({
        tenantId: TENANT_ALPHA,
        propertyId: propPerm400.id,
        providerId: "mock_portal",
      });
      const pass400 = await TransactionalOutboxService.processDueEvents({ limit: 10 });
      assert.equal(pass400.deadLettered, 1, "Permanent 400 must dead-letter immediately without blind retries");
      assert.equal(pass400.retryable, 0);

      const pub400 = await PortalPublishingOrchestrator.getPublication(
        TENANT_ALPHA,
        propPerm400.id,
        "mock_portal"
      );
      assert.equal(pub400?.status, "rejected");
      assert.equal(pub400?.lastErrorCode, "PORTAL_REMOTE_VALIDATION_FAILED");

      // 6c: Permanent 401 auth expiry -> sync_error + connection marked expired + dead_letter
      const propPerm401 = await CrmTenantStoreService.create(
        TENANT_ALPHA,
        "leads",
        buildCompletePropertyPayload(),
        "usr_alpha_owner"
      );
      mockProvider.setFaultModeForTests("permanent_401_auth");

      await PortalPublishingOrchestrator.requestPublishOrUpdate({
        tenantId: TENANT_ALPHA,
        propertyId: propPerm401.id,
        providerId: "mock_portal",
      });
      const pass401 = await TransactionalOutboxService.processDueEvents({ limit: 10 });
      assert.equal(pass401.deadLettered, 1, "Permanent 401 must dead-letter immediately");

      const pub401 = await PortalPublishingOrchestrator.getPublication(
        TENANT_ALPHA,
        propPerm401.id,
        "mock_portal"
      );
      assert.equal(pub401?.status, "sync_error");
      const connAfter401 = await PortalCredentialsService.getConnection(TENANT_ALPHA, "mock_portal");
      assert.equal(connAfter401?.status, "expired", "401 auth error must mark agency connection as expired");

      mockProvider.resetForTests();
    }
  );

  // 7. Express /api/portals HTTP integration: RBAC & strict cross-tenant isolation
  await runTest(
    "7. Express /api/portals enforces Agency Admin RBAC on credentials, hides secrets, and blocks cross-tenant access",
    async () => {
      const app = express();
      app.use(express.json());
      app.use("/api/portals", portalsRouter);

      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const addr = server.address() as { port: number };
      const baseUrl = `http://127.0.0.1:${addr.port}`;

      try {
        // Seed a property inside Agency Alpha
        const alphaProp = await CrmTenantStoreService.create(
          TENANT_ALPHA,
          "leads",
          buildCompletePropertyPayload(),
          "usr_alpha_owner"
        );

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

        // 7a. Unauthenticated request rejected (401)
        const unauth = await httpJson(baseUrl, "GET", "/api/portals/providers", {});
        assert.equal(unauth.status, 401);

        // 7b. Regular agent cannot modify agency portal credentials (403)
        const agentPut = await httpJson(
          baseUrl,
          "PUT",
          "/api/portals/connections/mock_portal",
          alphaAgentHeaders,
          { accountLabel: "Sneaky Agent", credentials: { apiKey: "secret_12345" } }
        );
        assert.equal(agentPut.status, 403);

        // 7c. Agency Owner saves credentials (200) and response never leaks secrets
        const rawSecret = "sk_alpha_top_secret_xyz";
        const ownerPut = await httpJson(
          baseUrl,
          "PUT",
          "/api/portals/connections/mock_portal",
          alphaOwnerHeaders,
          { accountLabel: "Alpha Official Portal", credentials: { apiKey: rawSecret } }
        );
        assert.equal(ownerPut.status, 200);
        assert.equal(ownerPut.body?.data?.connection?.hasCredentials, true);
        assert.equal(JSON.stringify(ownerPut.body).includes(rawSecret), false);
        assert.equal(JSON.stringify(ownerPut.body).includes("ciphertextBase64"), false);

        // 7d. Agency Owner tests credentials (200)
        const ownerTest = await httpJson(
          baseUrl,
          "POST",
          "/api/portals/connections/mock_portal/test",
          alphaOwnerHeaders,
          {}
        );
        assert.equal(ownerTest.status, 200);
        assert.equal(ownerTest.body?.data?.ok, true);

        // 7e. Cross-tenant isolation: Agency Beta Owner CANNOT access Agency Alpha's property publications or publish it
        const betaReadAlphaProp = await httpJson(
          baseUrl,
          "GET",
          `/api/portals/properties/${alphaProp.id}/publications`,
          betaOwnerHeaders
        );
        assert.equal(betaReadAlphaProp.status, 404, "Agency Beta must not see Agency Alpha's property");

        const betaPublishAlphaProp = await httpJson(
          baseUrl,
          "POST",
          `/api/portals/properties/${alphaProp.id}/publish`,
          betaOwnerHeaders,
          { providerId: "mock_portal" }
        );
        assert.equal(betaPublishAlphaProp.status, 404, "Agency Beta must not publish Agency Alpha's property");

        // 7f. Agency Beta Owner CANNOT spoof x-tenant-override=agency-a (403)
        const betaSpoofAlpha = await httpJson(
          baseUrl,
          "GET",
          "/api/portals/connections",
          {
            Authorization: "Bearer token_usr_beta_owner",
            "x-tenant-override": "agency-a",
          }
        );
        assert.equal(betaSpoofAlpha.status, 403, "Cross-tenant override spoofing must be blocked with 403");

        // 7g. Agency Beta sees zero Alpha connections
        const betaConns = await httpJson(baseUrl, "GET", "/api/portals/connections", betaOwnerHeaders);
        assert.equal(betaConns.status, 200);
        assert.equal(betaConns.body?.data?.connections?.length, 0);

        // 7h. Agency Alpha agent CAN inspect & trigger publish on Alpha's own property (202)
        const alphaAgentPublish = await httpJson(
          baseUrl,
          "POST",
          `/api/portals/properties/${alphaProp.id}/publish`,
          alphaAgentHeaders,
          { providerId: "mock_portal" }
        );
        assert.equal(alphaAgentPublish.status, 202);
        assert.equal(alphaAgentPublish.body?.data?.accepted, true);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  );

  // 8. Firestore Rules, Blueprint, Indexes & Feature Flag Production Safety checks
  await runTest(
    "8. Firestore rules lock portal_secrets (allow read, write: if false) & blueprint/indexes/flags are configured safely",
    async () => {
      const rulesSrc = fs.readFileSync(path.resolve(process.cwd(), "firestore.rules"), "utf8");
      assert.match(
        rulesSrc,
        /match \/portal_secrets\/\{providerId\}\s*\{\s*allow read, write: if false;\s*\}/,
        "firestore.rules must completely deny client read/write on portal_secrets"
      );
      assert.match(
        rulesSrc,
        /match \/portal_connections\/\{providerId\}[\s\S]*?allow write: if false;/,
        "firestore.rules must deny client writes on portal_connections"
      );
      assert.match(
        rulesSrc,
        /match \/portal_publications\/\{publicationId\}[\s\S]*?allow write: if false;/,
        "firestore.rules must deny client writes on portal_publications"
      );

      const blueprint = JSON.parse(
        fs.readFileSync(path.resolve(process.cwd(), "firebase-blueprint.json"), "utf8")
      );
      assert.ok(blueprint.entities.PortalConnection);
      assert.ok(blueprint.entities.PortalSecret);
      assert.ok(blueprint.entities.PortalPublication);
      assert.ok(blueprint.firestore["tenants/{tenantId}/portal_connections/{providerId}"]);
      assert.ok(blueprint.firestore["tenants/{tenantId}/portal_secrets/{providerId}"]);
      assert.ok(blueprint.firestore["tenants/{tenantId}/portal_publications/{publicationId}"]);

      const indexes = JSON.parse(
        fs.readFileSync(path.resolve(process.cwd(), "firestore.indexes.json"), "utf8")
      );
      const portalIndexes = (indexes.indexes || []).filter(
        (idx: any) => idx.collectionGroup === "portal_publications"
      );
      assert.equal(portalIndexes.length, 2, "Expected 2 composite indexes for portal_publications");

      const envExample = fs.readFileSync(path.resolve(process.cwd(), ".env.example"), "utf8");
      assert.ok(envExample.includes("PORTAL_CREDENTIALS_MASTER_KEY="));
      assert.ok(envExample.includes("VITE_ENABLE_PORTAL_PUBLISHING_UI=false"));
    }
  );

  console.log("================================================================");
  console.log(`🎉 ALL ${passed} PHASE 7 PORTAL FOUNDATION TESTS PASSED!`);
  console.log("================================================================");
}

main().catch((err) => {
  console.error("❌ Phase 7 Portal Foundation Test Suite failed:", err);
  process.exit(1);
});
