/**
 * Phase 3: Tenant Security & Isolation Test Suite
 *
 * Validates the 10 mandatory security invariants:
 * TEST 1: Authenticated user belonging to Agency A accesses Agency A -> PERMITTED
 * TEST 2: Authenticated user belonging to Agency A accesses Agency B -> DENIED (403)
 * TEST 3: Authenticated user belonging to Agency A requests a document ID belonging to Agency B -> DENIED (404/403)
 * TEST 4: Authenticated user modifies request body and supplies Agency B's tenant_id -> ISOLATION ENFORCED (scoped to Agency A)
 * TEST 5: Unauthenticated user attempts to access private CRM endpoint -> DENIED (401)
 * TEST 6: A suspended membership attempts to access its agency -> DENIED (403)
 * TEST 7: A suspended tenant is accessed through its assigned domain -> DENIED (403)
 * TEST 8: An unknown production hostname attempts to access the CRM -> DENIED (404)
 * TEST 9: A user belongs to two agencies and accesses each through its respective authorized hostname -> PERMITTED ONLY where membership is valid
 * TEST 10: A user attempts to change their own role or membership status -> DENIED (403)
 */

import { TenantResolutionService, setPlatformRootDomain } from "../../src/core/tenancy/svc_tenant-resolution";
import { TenantMembershipService } from "../../src/core/tenancy/svc_tenant-membership";
import { TenantScopedRepository, TenantScopedEntity } from "../../src/core/database/repo_tenant-scoped";
import { AppError } from "../../src/core/errors/app_error";

interface TestLead extends TenantScopedEntity {
  title: string;
  price: string;
}

// In-memory test repository
const testRepo = new TenantScopedRepository<TestLead>(null, "test_leads");

interface TestResult {
  id: string;
  name: string;
  expected: string;
  actual: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function assertTest(
  id: string,
  name: string,
  expected: string,
  fn: () => void | Promise<void>
) {
  return async () => {
    try {
      await fn();
      results.push({
        id,
        name,
        expected,
        actual: "Permis / Validat conform specificației",
        passed: true,
      });
      console.log(`✅ [PASS] ${id}: ${name}`);
    } catch (err: any) {
      results.push({
        id,
        name,
        expected,
        actual: `Eșec neașteptat: ${err?.message || String(err)}`,
        passed: false,
        error: err?.message,
      });
      console.error(`❌ [FAIL] ${id}: ${name} -> ${err?.message}`);
    }
  };
}

function assertThrows(
  id: string,
  name: string,
  expectedErrorFragment: string,
  fn: () => void | Promise<void>
) {
  return async () => {
    try {
      await fn();
      results.push({
        id,
        name,
        expected: `Eroare conținând "${expectedErrorFragment}"`,
        actual: "Operațiunea a fost permisă în mod eronat!",
        passed: false,
      });
      console.error(`❌ [FAIL] ${id}: ${name} -> Expected error but succeeded`);
    } catch (err: any) {
      const message = err?.message || String(err);
      const isExpected =
        message.toLowerCase().includes(expectedErrorFragment.toLowerCase()) ||
        err?.code?.toLowerCase().includes(expectedErrorFragment.toLowerCase()) ||
        err?.statusCode?.toString() === expectedErrorFragment;

      if (isExpected) {
        results.push({
          id,
          name,
          expected: `Respins cu eroare "${expectedErrorFragment}"`,
          actual: `Respins cu succes (${err.code || err.name}: ${message})`,
          passed: true,
        });
        console.log(`✅ [PASS] ${id}: ${name} -> Denied correctly: ${message}`);
      } else {
        results.push({
          id,
          name,
          expected: `Eroare conținând "${expectedErrorFragment}"`,
          actual: `Eroare diferită primită: ${message}`,
          passed: false,
        });
        console.error(`❌ [FAIL] ${id}: ${name} -> Wrong error: ${message}`);
      }
    }
  };
}

async function runTestSuite() {
  console.log("\n========================================================");
  console.log("🔒 RULARE SUITĂ TESTE DE SECURITATE ȘI IZOLARE MULTI-TENANT");
  console.log("========================================================\n");

  // Configure test root domain
  setPlatformRootDomain("ourcrm.com");

  TenantScopedRepository.clearInMemoryStore();

  // Seed sample documents in repository for Agency A and Agency B
  await testRepo.create(
    "ten_agency_a",
    "lead_alpha_101",
    { title: "Vila Dorobanti Alpha", price: "450000" },
    "usr_alpha_owner"
  );

  await testRepo.create(
    "ten_agency_b",
    "lead_beta_202",
    { title: "Apartament Floreasca Beta", price: "250000" },
    "usr_beta_owner"
  );

  // TEST 1: Authenticated user belonging to Agency A accesses Agency A
  await assertTest(
    "TEST 1",
    "Utilizator autentificat din Agenția A accesează datele Agenției A",
    "Acces permis",
    async () => {
      // 1. Resolve host
      const resolved = TenantResolutionService.resolveDomain("agency-a.ourcrm.com", null, true);
      if (resolved.tenantId !== "ten_agency_a") {
        throw new Error(`Domeniu rezolvat incorect: ${resolved.tenantId}`);
      }
      // 2. Verify membership
      const membership = TenantMembershipService.verifyMembership(resolved.tenantId, "usr_alpha_owner");
      if (!membership || membership.role !== "agency_owner") {
        throw new Error("Calitatea de membru a fost respinsă nejustificat.");
      }
      // 3. Query repository
      const lead = await testRepo.findById(resolved.tenantId, "lead_alpha_101");
      if (!lead || lead.title !== "Vila Dorobanti Alpha") {
        throw new Error("Documentul agenției nu a putut fi accesat.");
      }
    }
  )();

  // TEST 2: Authenticated user belonging to Agency A accesses Agency B
  await assertThrows(
    "TEST 2",
    "Utilizator autentificat din Agenția A accesează Agenția B",
    "nu are acces sau nu este membru",
    async () => {
      const resolved = TenantResolutionService.resolveDomain("agency-b.ourcrm.com", null, true);
      // Attempting to access Agency B with Agency A's user credentials
      TenantMembershipService.verifyMembership(resolved.tenantId!, "usr_alpha_agent");
    }
  )();

  // TEST 3: Authenticated user of Agency A requests document ID belonging to Agency B
  await assertTest(
    "TEST 3",
    "Utilizator al Agenției A solicită un document aparținând Agenției B",
    "Returnează null (izolare strictă, document invizibil)",
    async () => {
      // Agency A user is scoped to Agency A
      const tenantIdA = "ten_agency_a";
      // Requesting Agency B's document ID from Agency A's repository context
      const doc = await testRepo.findById(tenantIdA, "lead_beta_202");
      if (doc !== null) {
        throw new Error("Scurgere de securitate: Documentul altei agenții a fost returnat!");
      }
    }
  )();

  // TEST 4: Authenticated user modifies request body and supplies Agency B's tenant_id
  await assertTest(
    "TEST 4",
    "Utilizatorul injectează tenant_id-ul Agenției B în corpul cererii",
    "Câmpul injectat este ignorat, documentul este salvat strict sub Agenția A",
    async () => {
      const verifiedTenantId = "ten_agency_a";
      const maliciousPayload = {
        title: "Tentativă de injectare",
        price: "100000",
        tenant_id: "ten_agency_b", // Tampering attempt
      };

      // Repository create method binds to verifiedTenantId, overriding payload
      const created = await testRepo.create(
        verifiedTenantId,
        "lead_tampered_1",
        maliciousPayload as any,
        "usr_alpha_owner"
      );

      if (created.tenantId !== "ten_agency_a") {
        throw new Error(`Injectarea a reușit! Document salvat sub: ${created.tenantId}`);
      }

      // Verify that Agency B cannot see this document
      const queryInAgencyB = await testRepo.findById("ten_agency_b", "lead_tampered_1");
      if (queryInAgencyB !== null) {
        throw new Error("Documentul a poluat Agenția B!");
      }
    }
  )();

  // TEST 5: Unauthenticated user attempts to access private CRM endpoint
  await assertThrows(
    "TEST 5",
    "Utilizator neautentificat încearcă să verifice apartenența",
    "Date de autentificare sau identificator de agenție lipsă",
    () => {
      TenantMembershipService.verifyMembership("ten_agency_a", "");
    }
  )();

  // TEST 6: A suspended membership attempts to access its agency
  await assertThrows(
    "TEST 6",
    "Membru cu cont suspendat încearcă să acceseze agenția",
    "suspendat",
    () => {
      TenantMembershipService.verifyMembership("ten_brokr_default", "usr_suspended_1");
    }
  )();

  // TEST 7: A suspended tenant is accessed through its assigned domain
  await assertThrows(
    "TEST 7",
    "Agenție suspendată accesată prin domeniul propriu",
    "este suspendat",
    () => {
      const resolved = TenantResolutionService.resolveDomain("suspended-agency.ourcrm.com", null, true);
      TenantMembershipService.verifyMembership(resolved.tenantId!, "usr_suspended_agency_owner");
    }
  )();

  // TEST 8: An unknown production hostname attempts to access the CRM
  await assertThrows(
    "TEST 8",
    "Domeniu de producție necunoscut încearcă să acceseze platforma",
    "nu este recunoscut",
    () => {
      TenantResolutionService.resolveDomain("hacker-unknown-agency.com", null, true);
    }
  )();

  // TEST 9: Multi-tenant user accesses each agency through authorized hostname
  await assertTest(
    "TEST 9",
    "Utilizator multi-tenant accesează Agenția A și Agenția B prin domeniile lor",
    "Permis în ambele agenții conform calității de membru independente",
    async () => {
      const multiUserId = "usr_multi_tenant";

      // Accessing Agency A
      const resA = TenantResolutionService.resolveDomain("agency-a.ourcrm.com", null, true);
      const memA = TenantMembershipService.verifyMembership(resA.tenantId!, multiUserId);
      if (memA.role !== "manager") {
        throw new Error(`Rol incorect în Agenția A: ${memA.role}`);
      }

      // Accessing Agency B
      const resB = TenantResolutionService.resolveDomain("agency-b.ourcrm.com", null, true);
      const memB = TenantMembershipService.verifyMembership(resB.tenantId!, multiUserId);
      if (memB.role !== "agent") {
        throw new Error(`Rol incorect în Agenția B: ${memB.role}`);
      }
    }
  )();

  // TEST 10: A user attempts to change their own role or membership status
  await assertThrows(
    "TEST 10",
    "Utilizatorul încearcă să își modifice propriul rol (prevenire auto-escaladare)",
    "Nu vă puteți modifica propriul rol",
    () => {
      const actorMem = TenantMembershipService.verifyMembership("ten_agency_a", "usr_alpha_owner");
      // Actor attempting to change their own role
      TenantMembershipService.updateMemberRole(actorMem, "usr_alpha_owner", "agency_admin");
    }
  )();

  console.log("\n========================================================");
  console.log("📊 REZUMAT REZULTATE TESTE DE SECURITATE");
  console.log("========================================================");
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;
  console.log(`Total teste: ${total} | Reușite: ${passed} | Eșuate: ${failed}\n`);

  if (failed > 0) {
    console.error("❌ SUITA DE TESTE A EȘUAT!");
    process.exit(1);
  } else {
    console.log("🎉 TOATE CELE 10 TESTE DE SECURITATE ȘI IZOLARE AU TRECUT CU SUCCES!");
  }
}

runTestSuite().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
