/**
 * End-to-end persistence verification for all 3-accordion form fields across:
 * - Leads (Chiriaș / Cumpărător)
 * - Cereri (Chiriaș / Cumpărător)
 * - Manual Proprietăți (Închiriere / Vânzare)
 * - All 4 building types (Apartament, Casă/Vilă, Teren, Spațiu Comercial)
 * - Multiple isolated agencies (Agency A vs Agency B)
 * - Firestore REST encode/decode round-trip fidelity
 * - Survival across subsequent partial PATCH updates & cache reloads
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PersistentStoreService } from "../../src/core/database/svc_persistent-store";
import { CrmTenantStoreService } from "../../src/core/crm/svc_crm-tenant-store";
import {
  estimateUtf8Bytes,
  LEAD_SUMMARY_COLLECTION,
  MAX_SUMMARY_BYTES,
  projectLeadToSummary,
} from "../../src/core/crm/svc_lead-projection";
import {
  buildLeadPayloadFromCriteria,
  createInitialPropertyCriteriaState,
  type PropertyCriteriaFormState,
} from "../../src/components/PropertyCriteriaAccordionForm";

const tmpStore = path.join(os.tmpdir(), `brokr-accordion-persist-${process.pid}-${Date.now()}.json`);
process.env.NODE_ENV = "test";
process.env.PERSISTENT_STORE_PATH = tmpStore;

const AGENCY_A = "ten_agency_alpha";
const AGENCY_B = "ten_agency_beta";

function assertFirestoreRestRoundTrip(doc: Record<string, any>, label: string): Record<string, any> {
  const encodedFields = PersistentStoreService.encodeDocumentFields(doc);
  const rawJson = JSON.stringify(encodedFields);
  assert.ok(!rawJson.includes("undefined"), `${label}: encoded Firestore payload contains undefined`);
  assert.ok(!rawJson.includes("NaN"), `${label}: encoded Firestore payload contains NaN`);
  const decoded = PersistentStoreService.decodeDocument<Record<string, any>>({
    name: `projects/brokr-42038/databases/(default)/documents/tenants/${doc.tenantId}/leads/${doc.id}`,
    fields: encodedFields,
  });
  return decoded;
}

async function run() {
  let passed = 0;
  const check = (name: string, fn: () => void) => {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  };

  try {
    PersistentStoreService.clearAll();
    CrmTenantStoreService.setFirestoreOriginForTests(null);

    // 1. Agency A — Lead (Chiriaș + Apartament) with ALL 3 accordions populated
    const aptLeadState: PropertyCriteriaFormState = {
      ...createInitialPropertyCriteriaState(),
      clientName: "Andrei Ionescu",
      clientPhone: "0722111222",
      cetatenie: ["Romania"],
      animal: ["Pisică"],
      profil: ["Cuplu", "Angajați"],
      copii: "Fără",
      minBudget: "600",
      maxBudget: "850",
      buildingType: "Apartament",
      compartimentare: "Decomandat",
      selectedRooms: ["2 camere", "3 camere"],
      selectedBaths: ["1 baie", "2 băi"],
      selectedFloors: ["Etaj 2", "Etaj 3"],
      totalFloors: "8",
      mobilare: "Completă",
      utilare: "Completă",
      tipParcare: "Subterană",
      numarLocuriParcare: "1 loc",
      zoneList: ["Aviației", "Floreasca"],
      requirements: "Aproape de metrou, luminos",
      anConstructieMin: "2015",
      anConstructieMax: "2024",
      suprafataUtilaMin: "62",
      suprafataUtilaMax: "80",
      suprafataConstruitaMin: "74",
      suprafataConstruitaMax: "96",
      stareInterior: "Renovat",
      sistemIncalzire: "Centrală proprie",
      metodaIncalzire: "Pardoseală",
      lift: "Da",
      gradina: "Comună",
      balcoaneTeraseLogii: ["1", "2"],
      utilitati: ["Apă", "Canalizare", "Gaze"],
      serviciiImobil: ["Administrare", "Pază", "Supraveghere video"],
    };

    const aptLeadPayload = buildLeadPayloadFromCriteria({
      state: aptLeadState,
      role: "Chirias",
      mode: "lead",
      status: "Noi",
    });

    const createdAptLead = await CrmTenantStoreService.create(
      AGENCY_A,
      "leads",
      aptLeadPayload,
      "uid_agent_a"
    );

    // 2. Agency A — Cerere (Cumpărător + Casă/Vilă) with ALL 3 accordions populated
    const casaCerereState: PropertyCriteriaFormState = {
      ...createInitialPropertyCriteriaState(),
      clientName: "Elena Marinescu",
      clientPhone: "0733222333",
      minBudget: "280000",
      maxBudget: "350000",
      modalitateAchizitie: "Mixt",
      buildingType: "Casa/Vila",
      compartimentare: "Decomandat",
      selectedRooms: ["4 camere", "5+ camere"],
      selectedBaths: ["3 băi"],
      casaSubsol: true,
      casaDemisol: false,
      casaEtajePesteParter: "2",
      mobilare: "Parțială",
      utilare: "Completă",
      tipParcare: "Garaj",
      numarLocuriParcare: "2 locuri",
      zoneList: ["Pipera", "Băneasa"],
      requirements: "Curte amenajată, stradă asfaltată",
      anConstructieMin: "2018",
      anConstructieMax: "2025",
      suprafataUtilaMin: "180",
      suprafataUtilaMax: "240",
      suprafataConstruitaMin: "220",
      suprafataConstruitaMax: "290",
      suprafataCurteMin: "300",
      suprafataCurteMax: "500",
      stareInterior: "Bună",
      sistemIncalzire: "Pompă căldură",
      metodaIncalzire: "Pardoseală",
      lift: "Nu",
      gradina: "Proprie",
      balcoaneTeraseLogii: ["2", "3"],
      utilitati: ["Apă", "Canalizare", "Gaze"],
      serviciiImobil: ["Supraveghere video"],
    };

    const casaCererePayload = buildLeadPayloadFromCriteria({
      state: casaCerereState,
      role: "Cumparator",
      mode: "cerere",
      status: "Noua",
    });

    const createdCasaCerere = await CrmTenantStoreService.create(
      AGENCY_A,
      "leads",
      casaCererePayload,
      "uid_agent_a"
    );

    // 3. Agency A — Manual Proprietate (Vânzare + Teren)
    const terenPropState: PropertyCriteriaFormState = {
      ...createInitialPropertyCriteriaState(),
      clientName: "Mihai Popa",
      clientPhone: "0744333444",
      minBudget: "120000",
      maxBudget: "125000",
      tipAchizitieAcceptat: ["Cash", "Credit"],
      buildingType: "Teren",
      terenCategorie: "Construcții",
      terenClasificare: "Intravilan",
      zoneList: ["Otopeni"],
      requirements: "PUZ aprobat, drum betonat",
      suprafataTerenMin: "650",
      suprafataTerenMax: "700",
      frontStradal: "24",
      utilitati: ["Apă", "Canalizare", "Gaze", "Electricitate"],
    };

    const terenPropPayload = buildLeadPayloadFromCriteria({
      state: terenPropState,
      role: "Cumparator",
      mode: "property",
      status: "Noua",
    });

    const createdTerenProp = await CrmTenantStoreService.create(
      AGENCY_A,
      "leads",
      terenPropPayload,
      "uid_agent_a"
    );

    // 4. Agency B — Cerere (Chiriaș + Spațiu Comercial)
    const comCerereState: PropertyCriteriaFormState = {
      ...createInitialPropertyCriteriaState(),
      clientName: "SC Nova Med SRL",
      clientPhone: "0755444555",
      cetatenie: ["Germania"],
      minBudget: "2500",
      maxBudget: "4000",
      buildingType: "Spatiu Comercial",
      comercialCategorie: "Birouri",
      compartimentare: "Open space",
      selectedRooms: ["5+ camere"],
      selectedBaths: ["2 băi"],
      selectedFloors: ["Parter", "Etaj 1"],
      totalFloors: "6",
      mobilare: "Fără",
      utilare: "Parțială",
      tipParcare: "Supraterană",
      numarLocuriParcare: "4 locuri",
      zoneList: ["Victoriei", "Unirii"],
      requirements: "Vitrina stradala mare",
      anConstructieMin: "2010",
      anConstructieMax: "2024",
      suprafataUtilaMin: "150",
      suprafataUtilaMax: "220",
      suprafataConstruitaMin: "170",
      suprafataConstruitaMax: "250",
      stareInterior: "Renovat",
      sistemIncalzire: "Centrală imobil",
      metodaIncalzire: "Calorifere",
      lift: "Da",
      gradina: "Comună",
      balcoaneTeraseLogii: ["1"],
      utilitati: ["Apă", "Canalizare", "Gaze"],
      serviciiImobil: ["Administrare", "Menaj", "Pază", "Supraveghere video"],
    };

    const comCererePayload = buildLeadPayloadFromCriteria({
      state: comCerereState,
      role: "Chirias",
      mode: "cerere",
      status: "Noua",
    });

    const createdComCerereB = await CrmTenantStoreService.create(
      AGENCY_B,
      "leads",
      comCererePayload,
      "uid_agent_b"
    );

    // 5. Agency B — Manual Proprietate (Închiriere + Apartament)
    const manualAptPropState: PropertyCriteriaFormState = {
      ...createInitialPropertyCriteriaState(),
      clientName: "Cristina Dobre",
      clientPhone: "0766555666",
      cetatenie: ["Romania"],
      animal: ["Fără"],
      profil: ["Orice"],
      copii: "1",
      minBudget: "750",
      maxBudget: "750",
      buildingType: "Apartament",
      compartimentare: "Semidecomandat",
      selectedRooms: ["2 camere"],
      selectedBaths: ["1 baie"],
      selectedFloors: ["Etaj 4"],
      totalFloors: "10",
      mobilare: "Completă",
      utilare: "Completă",
      tipParcare: "Stradală",
      numarLocuriParcare: "1 loc",
      zoneList: ["Tineretului"],
      requirements: "Disponibil imediat",
      anConstructieMin: "1985",
      anConstructieMax: "1985",
      suprafataUtilaMin: "56",
      suprafataUtilaMax: "56",
      suprafataConstruitaMin: "67",
      suprafataConstruitaMax: "67",
      stareInterior: "Bună",
      sistemIncalzire: "Termoficare",
      metodaIncalzire: "Calorifere",
      lift: "Da",
      gradina: "Comună",
      balcoaneTeraseLogii: ["1"],
      utilitati: ["Apă", "Canalizare", "Gaze"],
      serviciiImobil: ["Administrare"],
    };

    const createdManualAptPropB = await CrmTenantStoreService.create(
      AGENCY_B,
      "leads",
      buildLeadPayloadFromCriteria({
        state: manualAptPropState,
        role: "Chirias",
        mode: "property",
        status: "Noua",
      }),
      "uid_agent_b"
    );

    // Simulate process restart / cold reload by clearing memory cache completely
    PersistentStoreService.clearMemoryCache();

    // Reload everything from persisted storage
    const reloadedAptLead = await CrmTenantStoreService.getById(AGENCY_A, "leads", createdAptLead.id);
    const reloadedCasaCerere = await CrmTenantStoreService.getById(AGENCY_A, "leads", createdCasaCerere.id);
    const reloadedTerenProp = await CrmTenantStoreService.getById(AGENCY_A, "leads", createdTerenProp.id);
    const reloadedComCerereB = await CrmTenantStoreService.getById(AGENCY_B, "leads", createdComCerereB.id);
    const reloadedManualAptPropB = await CrmTenantStoreService.getById(AGENCY_B, "leads", createdManualAptPropB.id);

    check("Agency A Lead (Chiriaș + Apartament): all 3 accordions persisted permanently", () => {
      assert.ok(reloadedAptLead);
      assert.equal(reloadedAptLead.tenantId, AGENCY_A);
      assert.equal(reloadedAptLead.leadType, "Chirias");
      assert.equal(reloadedAptLead.ownerName, "Andrei Ionescu");
      assert.equal(reloadedAptLead.ownerPhone, "0722111222");
      assert.equal(reloadedAptLead.cetatenie, "Romania");
      assert.deepEqual(reloadedAptLead.cetatenieList, ["Romania"]);
      assert.equal(reloadedAptLead.animal, "Pisică");
      assert.deepEqual(reloadedAptLead.animaleList, ["Pisică"]);
      assert.deepEqual(reloadedAptLead.profil, ["Cuplu", "Angajați"]);
      assert.equal(reloadedAptLead.copii, "Fără");
      assert.equal(reloadedAptLead.minBudget, "600");
      assert.equal(reloadedAptLead.maxBudget, "850");
      assert.equal(reloadedAptLead.compartimentare, "Decomandat");
      assert.deepEqual(reloadedAptLead.selectedRooms, ["2 camere", "3 camere"]);
      assert.deepEqual(reloadedAptLead.selectedBaths, ["1 baie", "2 băi"]);
      assert.deepEqual(reloadedAptLead.selectedFloors, ["Etaj 2", "Etaj 3"]);
      assert.equal(reloadedAptLead.totalFloors, "8");
      assert.equal(reloadedAptLead.mobilare, "Completă");
      assert.equal(reloadedAptLead.utilare, "Completă");
      assert.equal(reloadedAptLead.tipParcare, "Subterană");
      assert.equal(reloadedAptLead.numarLocuriParcare, "1 loc");
      assert.deepEqual(reloadedAptLead.zoneList, ["Aviației", "Floreasca"]);
      assert.equal(reloadedAptLead.requirements, "Aproape de metrou, luminos");
      assert.equal(reloadedAptLead.anConstructieMin, "2015");
      assert.equal(reloadedAptLead.anConstructieMax, "2024");
      assert.equal(reloadedAptLead.suprafataUtilaMin, "62");
      assert.equal(reloadedAptLead.suprafataUtilaMax, "80");
      assert.equal(reloadedAptLead.suprafataConstruitaMin, "74");
      assert.equal(reloadedAptLead.suprafataConstruitaMax, "96");
      assert.equal(reloadedAptLead.stareInterior, "Renovat");
      assert.equal(reloadedAptLead.sursaIncalzire, "Centrală proprie");
      assert.equal(reloadedAptLead.modIncalzire, "Pardoseală");
      assert.equal(reloadedAptLead.lift, "Da");
      assert.equal(reloadedAptLead.gradina, "Comună");
      assert.deepEqual(reloadedAptLead.balcoaneTeraseLogii, ["1", "2"]);
      assert.deepEqual(reloadedAptLead.utilitati, ["Apă", "Canalizare", "Gaze"]);
      assert.deepEqual(reloadedAptLead.serviciiImobil, ["Administrare", "Pază", "Supraveghere video"]);
      assert.deepEqual(reloadedAptLead.criteriiFormular, reloadedAptLead.extractedData.crmData.criteriiFormular);
    });

    check("Agency A Cerere (Cumpărător + Casă/Vilă): subsol/demisol/parter/+E, curte, modalitate achizitie persisted", () => {
      assert.ok(reloadedCasaCerere);
      assert.ok(String(reloadedCasaCerere.propertyId).startsWith("R"), `Expected R prefix, got ${reloadedCasaCerere.propertyId}`);
      assert.equal(reloadedCasaCerere.modalitateAchizitie, "Mixt");
      assert.equal(reloadedCasaCerere.casaSubsol, true);
      assert.equal(reloadedCasaCerere.casaDemisol, false);
      assert.equal(reloadedCasaCerere.casaParter, true);
      assert.equal(reloadedCasaCerere.casaEtajePesteParter, "2");
      assert.equal(reloadedCasaCerere.floor, "Subsol, Parter, +2E");
      assert.equal(reloadedCasaCerere.suprafataCurteMin, "300");
      assert.equal(reloadedCasaCerere.suprafataCurteMax, "500");
      assert.equal(reloadedCasaCerere.extractedData.crmData.caracteristici.suprafete.curte, "300 - 500");
      assert.equal(reloadedCasaCerere.criteriiFormular.casaSubsol, true);
      assert.equal(reloadedCasaCerere.criteriiFormular.casaParter, true);
      assert.equal(reloadedCasaCerere.criteriiFormular.casaEtajePesteParter, "2");
    });

    check("Agency A Manual Proprietate (Vânzare + Teren): categorie, clasificare, front stradal, electricitate persisted", () => {
      assert.ok(reloadedTerenProp);
      assert.ok(String(reloadedTerenProp.propertyId).startsWith("P"), `Expected P prefix, got ${reloadedTerenProp.propertyId}`);
      assert.equal(reloadedTerenProp.leadType, "Proprietar");
      assert.deepEqual(reloadedTerenProp.tipAchizitieAcceptat, ["Cash", "Credit"]);
      assert.equal(reloadedTerenProp.modalitateAchizitie, "Cash, Credit");
      assert.deepEqual(reloadedTerenProp.criteriiFormular.tipAchizitieAcceptat, ["Cash", "Credit"]);
      assert.equal(reloadedTerenProp.terenCategorie, "Construcții");
      assert.equal(reloadedTerenProp.terenClasificare, "Intravilan");
      assert.equal(reloadedTerenProp.suprafataTerenMin, "650");
      assert.equal(reloadedTerenProp.suprafataTerenMax, "700");
      assert.equal(reloadedTerenProp.frontStradal, "24");
      assert.deepEqual(reloadedTerenProp.utilitati, ["Apă", "Canalizare", "Gaze", "Electricitate"]);
      assert.equal(reloadedTerenProp.extractedData.crmData.caracteristici.suprafete.frontStradal, "24");
      assert.equal(reloadedTerenProp.extractedData.crmData.caracteristici.alteDetalii.tipTeren, "Construcții");
      assert.equal(reloadedTerenProp.extractedData.crmData.caracteristici.alteDetalii.clasificare, "Intravilan");
    });

    check("Agency B Cerere (Chiriaș + Spațiu Comercial) & Manual Proprietate (Închiriere + Apartament) persisted", () => {
      assert.ok(reloadedComCerereB);
      assert.equal(reloadedComCerereB.tenantId, AGENCY_B);
      assert.ok(String(reloadedComCerereB.propertyId).startsWith("R"));
      assert.equal(reloadedComCerereB.categoria, "Spatiu Birou");
      assert.equal(reloadedComCerereB.comercialCategorie, "Birouri");
      assert.equal(reloadedComCerereB.cetatenie, "Germania");
      assert.equal(reloadedComCerereB.totalFloors, "6");
      assert.deepEqual(reloadedComCerereB.serviciiImobil, [
        "Administrare",
        "Menaj",
        "Pază",
        "Supraveghere video",
      ]);

      assert.ok(reloadedManualAptPropB);
      assert.equal(reloadedManualAptPropB.tenantId, AGENCY_B);
      assert.ok(String(reloadedManualAptPropB.propertyId).startsWith("P"));
      assert.equal(reloadedManualAptPropB.transactionType, "Închiriere");
      assert.equal(reloadedManualAptPropB.modalitateAchizitie, undefined);
      assert.equal(reloadedManualAptPropB.tipAchizitieAcceptat, undefined);
      assert.equal(reloadedManualAptPropB.anConstructieMin, "1985");
      assert.equal(reloadedManualAptPropB.lift, "Da");
    });

    check("Strict multi-agency isolation: Agency A and Agency B never cross-read", async () => {
      // Verified synchronously via pre-fetched queries below
    });

    const crossAtoB = await CrmTenantStoreService.getById(AGENCY_A, "leads", createdComCerereB.id);
    const crossBtoA = await CrmTenantStoreService.getById(AGENCY_B, "leads", createdAptLead.id);
    const listA = await CrmTenantStoreService.list(AGENCY_A, "leads");
    const listB = await CrmTenantStoreService.list(AGENCY_B, "leads");

    check("Cross-tenant isolation verified (zero leakage between agencies)", () => {
      assert.equal(crossAtoB, null);
      assert.equal(crossBtoA, null);
      assert.equal(listA.length, 3);
      assert.equal(listB.length, 2);
      assert.ok(listA.every((d) => d.tenantId === AGENCY_A));
      assert.ok(listB.every((d) => d.tenantId === AGENCY_B));
    });

    // Firestore REST encode -> decode round-trip for ALL 5 records
    check("Firestore REST encodeDocumentFields -> decodeDocument lossless round-trip on all 5 records", () => {
      for (const doc of [
        reloadedAptLead!,
        reloadedCasaCerere!,
        reloadedTerenProp!,
        reloadedComCerereB!,
        reloadedManualAptPropB!,
      ]) {
        const roundTripped = assertFirestoreRestRoundTrip(doc, doc.id);
        assert.deepEqual(roundTripped.criteriiFormular, doc.criteriiFormular);
        assert.deepEqual(roundTripped.extractedData.crmData.criteriiFormular, doc.criteriiFormular);
        assert.deepEqual(roundTripped.utilitati, doc.utilitati);
      }
    });

    // Subsequent partial PATCH (simulating detail page edit that omits criteriiFormular inside extractedData)
    await CrmTenantStoreService.update(AGENCY_A, "leads", createdCasaCerere.id, {
      title: "Cerere actualizată vilă Pipera",
      price: "360000 €",
      mobilare: "Completă",
      extractedData: {
        crmData: {
          descriere: {
            titlu: "Cerere actualizată vilă Pipera",
            continut: "Descriere actualizată",
          },
        },
      },
    });
    PersistentStoreService.clearMemoryCache();
    const afterPatch = await CrmTenantStoreService.getById(AGENCY_A, "leads", createdCasaCerere.id);

    check("Partial PATCH never wipes criteriiFormular or top-level accordion fields", () => {
      assert.ok(afterPatch);
      assert.equal(afterPatch.title, "Cerere actualizată vilă Pipera");
      assert.equal(afterPatch.price, "360000 €");
      assert.equal(afterPatch.mobilare, "Completă");
      assert.equal(afterPatch.criteriiFormular.mobilare, "Completă");
      assert.equal(afterPatch.criteriiFormular.modalitateAchizitie, "Mixt");
      assert.equal(afterPatch.criteriiFormular.casaSubsol, true);
      assert.equal(afterPatch.criteriiFormular.suprafataCurteMin, "300");
      assert.equal(afterPatch.criteriiFormular.stareInterior, "Bună");
      assert.deepEqual(afterPatch.criteriiFormular.serviciiImobil, ["Supraveghere video"]);
      assert.deepEqual(
        afterPatch.extractedData.crmData.criteriiFormular,
        afterPatch.criteriiFormular
      );
    });

    // Slim leads_summary projection checks (size <= 2.5 KB, accurate filter fields)
    check("leads_summary dual-write projection stays <= 2.5 KB and indexes new fields accurately", () => {
      const aptSummary = projectLeadToSummary(reloadedAptLead!, { tenantId: AGENCY_A });
      assert.ok(estimateUtf8Bytes(aptSummary) <= MAX_SUMMARY_BYTES);
      assert.ok(aptSummary.constructieBuckets.includes("dupa-2000"));
      assert.equal(aptSummary.usefulArea, 62);
      assert.equal(aptSummary.compartimentare, "decomandat");

      const manualAptSummary = projectLeadToSummary(reloadedManualAptPropB!, { tenantId: AGENCY_B });
      assert.ok(estimateUtf8Bytes(manualAptSummary) <= MAX_SUMMARY_BYTES);
      assert.ok(manualAptSummary.constructieBuckets.includes("1977-1990"));
      assert.equal(manualAptSummary.usefulArea, 56);

      const terenSummary = projectLeadToSummary(reloadedTerenProp!, { tenantId: AGENCY_A });
      assert.ok(estimateUtf8Bytes(terenSummary) <= MAX_SUMMARY_BYTES);
      assert.equal(terenSummary.usefulArea, 650);
      assert.equal(terenSummary.categoria, "Teren");

      const storedSummaryA = PersistentStoreService.get(
        `tenants__${AGENCY_A}__${LEAD_SUMMARY_COLLECTION}`,
        createdAptLead.id
      );
      assert.ok(storedSummaryA, "leads_summary dual-write exists in Agency A");
    });

    console.log(`\nALL ${passed} ACCORDION PERSISTENCE CHECKS PASSED.`);
  } finally {
    try {
      if (fs.existsSync(tmpStore)) fs.unlinkSync(tmpStore);
    } catch {
      // ignore cleanup error
    }
  }
}

run().catch((err) => {
  console.error("Accordion persistence test failed:", err);
  process.exit(1);
});
