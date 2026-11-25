import assert from "node:assert/strict";
import { CrmTenantStoreService } from "../../src/core/crm/svc_crm-tenant-store";
import { PublicPropertyCacheService } from "../../src/core/cache/svc_public-property-cache";
import { MediaPipelineService } from "../../server/media/svc_media-pipeline";
import { invalidateEntityPublicShareCaches } from "../../server/cache/svc_share-cache-invalidator";
import { sanitizePublicProperty } from "../../server/security/sec_public-sanitizer";
import {
  resolvePublicDisplayDescription,
  resolvePublicDisplayTitle,
} from "../../src/utils/publicContentUtils";
import { ClientDataHub, type DataHubTransport } from "../../src/core/crm/svc_client-data-hub";

process.env.NODE_ENV = "test";
CrmTenantStoreService.setFirestoreOriginForTests(null);

const TENANT_ID = "ten_test_persistence_sync";
const ACTOR_UID = "uid_agent_persist_1";

async function run() {
  console.log("=== Testing Full CRM Persistence & Single-Entity Public Share Cache Erasure ===");

  // ---------------------------------------------------------------------------
  // 1. Lead, Cerere & Property Edits Persist Permanently & Reflect on /share/:id
  // ---------------------------------------------------------------------------
  const rawLead = await CrmTenantStoreService.create(
    TENANT_ID,
    "leads",
    {
      title: "Titlu Original OLX",
      price: "110.000 €",
      zone: "Titan",
      transactionType: "Vânzare",
      categoria: "Apartament",
      status: "Noi",
      ownerName: "Ion Popescu Privat",
      ownerPhone: "0722111222",
      url: "https://www.olx.ro/d/oferta/test-123.html",
      extractedData: {
        originalTitle: "Titlu Original OLX",
        originalDescription: "Descriere veche din OLX",
        olxMeta: { originalTitle: "Titlu Original OLX" },
        crmData: {
          detaliiGenerale: {
            tranzactie: "Vânzare",
            categoria: "Apartament",
            localizare: { zona: "Titan", strada: "Str. Privata 10" },
          },
          descriere: {
            titlu: "Titlu Original OLX",
            continut: "Descriere veche din OLX",
          },
          pret: { detalii: { pret: "110.000 €" } },
        },
        presentationSections: {
          introducere: { titlu: "Titlu Original OLX", summary: "Descriere veche din OLX" },
          tranzactie: { "Preț": "110.000 €" },
          mobilare: { "Stadiu mobilare": "-" },
          parcare: { "Parcare": "-" },
          dotari: { "Încălzire": "-" },
        },
      },
    },
    ACTOR_UID
  );

  const editedLead = await CrmTenantStoreService.update(TENANT_ID, "leads", rawLead.id, {
    title: "Apartament 3 camere renovat Pipera",
    price: "145.000 €",
    zone: "Pipera",
    transactionType: "Închiriere",
    categoria: "Garsonieră",
    mobilare: "Completă",
    parcare: "2 locuri",
    sursaIncalzire: "Centrală proprie",
    modIncalzire: "În pardoseală",
    "extractedData.crmData.descriere.continut": "Descriere nouă actualizată de agent pentru client.",
  });

  const reloadedLead = await CrmTenantStoreService.getById(TENANT_ID, "leads", rawLead.id);
  assert.ok(reloadedLead, "Updated lead must persist and reload");
  assert.equal(reloadedLead!.title, "Apartament 3 camere renovat Pipera");
  assert.equal(reloadedLead!.price, "145.000 €");
  assert.equal(reloadedLead!.zone, "Pipera");
  assert.equal(reloadedLead!.extractedData.originalTitle, "Apartament 3 camere renovat Pipera");
  assert.equal(reloadedLead!.extractedData.olxMeta.originalTitle, "Apartament 3 camere renovat Pipera");
  assert.equal(reloadedLead!.extractedData.crmData.descriere.titlu, "Apartament 3 camere renovat Pipera");
  assert.equal(reloadedLead!.extractedData.presentationSections.introducere.titlu, "Apartament 3 camere renovat Pipera");
  assert.equal(reloadedLead!.extractedData.originalDescription, "Descriere nouă actualizată de agent pentru client.");
  assert.equal(reloadedLead!.extractedData.crmData.descriere.continut, "Descriere nouă actualizată de agent pentru client.");
  assert.equal(reloadedLead!.extractedData.presentationSections.introducere.summary, "Descriere nouă actualizată de agent pentru client.");
  assert.equal(reloadedLead!.extractedData.crmData.detaliiGenerale.localizare.zona, "Pipera");
  assert.equal(reloadedLead!.extractedData.crmData.pret.detalii.pret, "145.000 €");
  assert.equal(reloadedLead!.extractedData.presentationSections.tranzactie["Preț"], "145.000 €");
  assert.equal(reloadedLead!.extractedData.crmData.utilitati.dotari.mobilat, "Complet");
  assert.equal(reloadedLead!.extractedData.crmData.caracteristici.detalii.parcari, 2);
  assert.deepEqual(reloadedLead!.extractedData.crmData.utilitati.sistemIncalzire, [
    "Centrală proprie",
    "În pardoseală",
  ]);

  // Verify slim summary projection also updated atomically
  const reloadedSummary = await CrmTenantStoreService.getLeadSummaryById(TENANT_ID, rawLead.id);
  assert.ok(reloadedSummary, "Slim leads_summary must stay synchronized");
  assert.equal(reloadedSummary!.title, "Apartament 3 camere renovat Pipera");
  assert.equal(reloadedSummary!.price, "145.000 €");
  assert.equal(reloadedSummary!.zone, "Pipera");

  // Verify public share sanitizer & display resolvers show the fresh edits and zero PII
  const sanitized = sanitizePublicProperty(reloadedLead!);
  assert.equal(resolvePublicDisplayTitle(sanitized), "Apartament 3 camere renovat Pipera");
  assert.equal(
    resolvePublicDisplayDescription(sanitized),
    "Descriere nouă actualizată de agent pentru client."
  );
  assert.equal((sanitized as any).ownerPhone, undefined, "Public share must never leak ownerPhone");
  assert.equal((sanitized as any).ownerName, undefined, "Public share must never leak ownerName");
  assert.equal(
    sanitized.extractedData?.crmData?.detaliiGenerale?.localizare?.strada,
    undefined,
    "Public share must strip exact street address"
  );
  assert.equal(
    sanitized.extractedData?.crmData?.detaliiGenerale?.localizare?.zona,
    "Pipera",
    "Public share must expose updated zone"
  );
  console.log("[PASS] 1. Lead/Cerere/Property edits persist & immediately reflect in public share payload");

  // ---------------------------------------------------------------------------
  // 2. Single-Entity Server Cache Erasure (Leaves Unrelated Entities Cached)
  // ---------------------------------------------------------------------------
  PublicPropertyCacheService.invalidate(null);
  const codeA = editedLead.propertyId || "P101";
  const codeB = "P999";
  let fetchCountA = 0;
  let fetchCountB = 0;
  await PublicPropertyCacheService.getOrFetch(codeA, TENANT_ID, async () => {
    fetchCountA++;
    return reloadedLead!;
  });
  await PublicPropertyCacheService.getOrFetch(codeB, TENANT_ID, async () => {
    fetchCountB++;
    return { id: "lead_999", propertyId: codeB, title: "Neafectat" };
  });
  assert.equal(fetchCountA, 1);
  assert.equal(fetchCountB, 1);

  // Exercise real MediaPipelineService.getOrBuildPersistedOgImage for both codeA and codeB
  const tinyPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2m8AAAAASUVORK5CYII=",
    "base64"
  );
  await MediaPipelineService.getOrBuildPersistedOgImage({
    shareCode: codeA,
    versionKey: "v1_test",
    preferredTenantId: TENANT_ID,
    loadCandidateBuffers: async () => [tinyPng],
  });
  await MediaPipelineService.getOrBuildPersistedOgImage({
    shareCode: codeB,
    versionKey: "v1_test",
    preferredTenantId: TENANT_ID,
    loadCandidateBuffers: async () => [tinyPng],
  });

  const bustResult = invalidateEntityPublicShareCaches([codeA, rawLead.id], TENANT_ID);
  assert.ok(bustResult.propertyCacheRemoved >= 1, "Target property cache entry must be erased");
  assert.equal(bustResult.ogCacheRemoved, 1, "Target OG cache entry must be erased");

  // Re-fetching codeA must MISS cache (calls fetcher), while codeB must HIT warm cache (0 extra fetcher calls)
  await PublicPropertyCacheService.getOrFetch(codeA, TENANT_ID, async () => {
    fetchCountA++;
    return { ...reloadedLead!, title: "Reîncărcat Proaspăt" };
  });
  const warmB = await PublicPropertyCacheService.getOrFetch(codeB, TENANT_ID, async () => {
    fetchCountB++;
    return { id: "lead_999", propertyId: codeB, title: "Nu Ar Trebuie Reîncărcat" };
  });
  assert.equal(fetchCountA, 2, "Modified entity must be evicted and freshly fetched");
  assert.equal(fetchCountB, 1, "Unrelated entity P999 must stay warm in PublicPropertyCacheService");
  assert.equal(warmB?.title, "Neafectat");

  // Verify codeA OG cache is already gone (0 removed on second call) while codeB OG cache is still warm (1 removed)
  assert.equal(
    MediaPipelineService.invalidateOgCacheForShareCodes([codeA]),
    0,
    "Modified entity OG cache must already be erased"
  );
  assert.equal(
    MediaPipelineService.invalidateOgCacheForShareCodes([codeB]),
    1,
    "Unrelated entity P999 OG cache must have remained warm until explicitly invalidated"
  );
  console.log("[PASS] 2. Single-entity server cache invalidation erases ONLY modified entity");

  // ---------------------------------------------------------------------------
  // 3. Calendar (activities <-> tours <-> viewings) Create / Update / Delete Mirroring
  // ---------------------------------------------------------------------------
  const createdActivity = await CrmTenantStoreService.create(
    TENANT_ID,
    "activities",
    {
      propertyId: codeA,
      clientId: "cli_1",
      clientName: "Andrei Client",
      clientPhone: "0744000111",
      staffId: "stf_1",
      staffName: "Maria Agent",
      date: "2026-12-01",
      hour: "10:00",
      status: "Programată",
      notes: "Vizionare inițială",
    },
    ACTOR_UID
  );

  const initialViewing = await CrmTenantStoreService.getById(TENANT_ID, "viewings", `view_${createdActivity.id}`);
  const initialTour = await CrmTenantStoreService.getById(TENANT_ID, "tours", `tour_${createdActivity.id}`);
  assert.ok(initialViewing && initialTour, "Creating activity must create mirrored viewing and tour");
  assert.equal(initialViewing!.hour, "10:00");

  await CrmTenantStoreService.update(TENANT_ID, "activities", createdActivity.id, {
    date: "2026-12-05",
    hour: "15:30",
    clientName: "Andrei Client Actualizat",
    status: "Finalizată",
  });

  const updatedViewing = await CrmTenantStoreService.getById(TENANT_ID, "viewings", `view_${createdActivity.id}`);
  const updatedTour = await CrmTenantStoreService.getById(TENANT_ID, "tours", `tour_${createdActivity.id}`);
  assert.equal(updatedViewing!.date, "2026-12-05");
  assert.equal(updatedViewing!.hour, "15:30");
  assert.equal(updatedViewing!.contactName, "Andrei Client Actualizat");
  assert.equal(updatedTour!.date, "2026-12-05");
  assert.equal(updatedTour!.hour, "15:30");
  assert.equal(updatedTour!.status, "Finalizată");

  // Update via viewings collection mirrors back to activities & tours
  await CrmTenantStoreService.update(TENANT_ID, "viewings", `view_${createdActivity.id}`, {
    hour: "17:00",
  });
  const mirroredAct = await CrmTenantStoreService.getById(TENANT_ID, "activities", createdActivity.id);
  const mirroredTour = await CrmTenantStoreService.getById(TENANT_ID, "tours", `tour_${createdActivity.id}`);
  assert.equal(mirroredAct!.hour, "17:00");
  assert.equal(mirroredTour!.hour, "17:00");

  // Delete activity deletes all 3 mirrored docs
  await CrmTenantStoreService.delete(TENANT_ID, "activities", createdActivity.id);
  assert.equal(await CrmTenantStoreService.getById(TENANT_ID, "activities", createdActivity.id), null);
  assert.equal(await CrmTenantStoreService.getById(TENANT_ID, "viewings", `view_${createdActivity.id}`), null);
  assert.equal(await CrmTenantStoreService.getById(TENANT_ID, "tours", `tour_${createdActivity.id}`), null);
  console.log("[PASS] 3. Calendar activities/tours/viewings create, update, and delete persist atomically");

  // ---------------------------------------------------------------------------
  // 4. Contacts & Staff Persistence + ClientDataHub Single-Entity Cache Erasure
  // ---------------------------------------------------------------------------
  const contact = await CrmTenantStoreService.create(
    TENANT_ID,
    "contacts",
    { firstName: "Elena", lastName: "Ionescu", phone: "0733123456", type: "Buyer" },
    ACTOR_UID
  );
  await CrmTenantStoreService.update(TENANT_ID, "contacts", contact.id, {
    lastName: "Ionescu-Pop",
    commissionValue: "2%",
  });
  const reloadedContact = await CrmTenantStoreService.getById(TENANT_ID, "contacts", contact.id);
  assert.equal(reloadedContact!.lastName, "Ionescu-Pop");
  assert.equal(reloadedContact!.commissionValue, "2%");

  const staff = await CrmTenantStoreService.create(
    TENANT_ID,
    "staff",
    { name: "Radu Broker", role: "Agent Imobiliar", phone: "0755999888", status: "Activ" },
    ACTOR_UID
  );
  await CrmTenantStoreService.update(TENANT_ID, "staff", staff.id, {
    role: "Broker Senior",
    zone: "Nord, Pipera",
  });
  const reloadedStaff = await CrmTenantStoreService.getById(TENANT_ID, "staff", staff.id);
  assert.equal(reloadedStaff!.role, "Broker Senior");
  assert.equal(reloadedStaff!.zone, "Nord, Pipera");

  // Test ClientDataHub single-entity cache invalidation + immediate slice patching
  let sliceEmit: ((items: any[], meta: { fromCache: boolean; source: "firestore" | "api" }) => void) | null = null;
  const mockTransport: DataHubTransport = {
    subscribeCollection: (_params, handlers) => {
      sliceEmit = handlers.onData;
      return () => {};
    },
    fetchPage: async () => ({ items: [], nextCursor: null, hasMore: false, fromCache: false }),
  };

  const hub = new ClientDataHub(mockTransport);
  hub.setContext({ tenantId: TENANT_ID, uid: ACTOR_UID, isPreviewMode: false });

  let latestSliceItems: any[] = [];
  const unsub = hub.subscribeCollection("leads", (items) => {
    latestSliceItems = items;
  });

  const lead1Initial = { id: "lead_1", propertyId: "P1", title: "Vechi 1", updatedAt: "2026-11-24T10:00:00.000Z" };
  const lead2Initial = { id: "lead_2", propertyId: "P2", title: "Vechi 2", updatedAt: "2026-11-24T09:00:00.000Z" };
  sliceEmit!([lead1Initial, lead2Initial], { fromCache: false, source: "firestore" });

  // Warm detailCache for both lead_1 (under alias P1 too) and lead_2
  let fetchesP1 = 0;
  let fetchesP2 = 0;
  await hub.getDocumentById("leads", "P1", async () => {
    fetchesP1++;
    return lead1Initial;
  });
  await hub.getDocumentById("leads", "P2", async () => {
    fetchesP2++;
    return lead2Initial;
  });
  assert.equal(fetchesP1, 1);
  assert.equal(fetchesP2, 1);

  // Mutate lead_1 via doc id only — must erase alias P1 too, leave P2 cached, and patch live slice!
  const lead1Updated = { id: "lead_1", propertyId: "P1", title: "Nou 1 Actualizat", updatedAt: "2026-11-24T11:00:00.000Z" };
  hub.notifyMutation("leads", "lead_1", { updatedDoc: lead1Updated, extraIds: ["P1"] });

  assert.equal(latestSliceItems.find((i) => i.id === "lead_1")?.title, "Nou 1 Actualizat");
  assert.equal(latestSliceItems.find((i) => i.id === "lead_2")?.title, "Vechi 2");

  const refetchedP1 = await hub.getDocumentById("leads", "P1", async () => {
    fetchesP1++;
    return lead1Updated;
  });
  const cachedP2 = await hub.getDocumentById("leads", "P2", async () => {
    fetchesP2++;
    return { ...lead2Initial, title: "Should Not Refetch" };
  });
  assert.equal(fetchesP1, 2, "Modified entity alias P1 must be evicted and refetched");
  assert.equal(refetchedP1?.title, "Nou 1 Actualizat");
  assert.equal(fetchesP2, 1, "Unrelated entity P2 must remain cached");
  assert.equal(cachedP2?.title, "Vechi 2");

  // Deleting lead_1 removes it immediately from active slice without touching lead_2
  hub.notifyMutation("leads", "lead_1", { deleted: true });
  assert.equal(latestSliceItems.length, 1);
  assert.equal(latestSliceItems[0].id, "lead_2");
  unsub();

  console.log("[PASS] 4. Contacts/Staff persist & ClientDataHub erases ONLY modified entity cache + patches slice");
  console.log("=== ALL PERSISTENCE & CACHE SYNC TESTS PASSED ===");
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
