import { PreviewSessionService } from "../../src/core/tenancy/svc_preview-session";
import { TenantResolutionService } from "../../src/core/tenancy/svc_tenant-resolution";
import { CrmMigrationService } from "../../src/core/migration/svc_crm-migration";
import { MigrationRepository } from "../../src/core/migration/repo_migration";
import { TenantScopedRepository } from "../../src/core/database/repo_tenant-scoped";
import { UserRole } from "../../src/core/tenancy/typ_tenant-context";

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`✅ [PASS] ${message}`);
    testsPassed++;
  } else {
    console.error(`❌ [FAIL] ${message}`);
    testsFailed++;
  }
}

async function runPhase7Tests() {
  console.log("========================================================");
  console.log("🧪 RULARE TESTE PREVIEW, ROLE SWITCHING & MIGRARE (FAZA 7)");
  console.log("========================================================");

  const SUPER_ADMIN_UID = "usr_superadmin_master";
  const SUPER_ADMIN_EMAIL = "fountainheadro@gmail.com";

  // ----------------------------------------------------
  // TEST 1: Super Admin can start preview session
  // ----------------------------------------------------
  try {
    const session = PreviewSessionService.startSession({
      tenantId: "ten_agency_a",
      superAdminUid: SUPER_ADMIN_UID,
      superAdminEmail: SUPER_ADMIN_EMAIL,
      simulatedRole: "agency_admin",
    });

    assert(
      session && session.token.startsWith("prev_") && session.tenantId === "ten_agency_a",
      "TEST 1: Super Admin poate iniția o sesiune de testare pentru Agenția A"
    );
  } catch (err: any) {
    assert(false, `TEST 1 Eșuat: ${err?.message}`);
  }

  // ----------------------------------------------------
  // TEST 2: Invalid or non-existent tenant throws 404
  // ----------------------------------------------------
  try {
    let errorThrown = false;
    try {
      PreviewSessionService.startSession({
        tenantId: "ten_non_existent_agency_9999",
        superAdminUid: SUPER_ADMIN_UID,
        superAdminEmail: SUPER_ADMIN_EMAIL,
      });
    } catch (e: any) {
      errorThrown = true;
    }
    assert(errorThrown, "TEST 2: Tentativa de testare a unui tenant inexistent este respinsă cu 404");
  } catch (err: any) {
    assert(false, `TEST 2 Eșuat: ${err?.message}`);
  }

  // ----------------------------------------------------
  // TEST 3: Preview session uses the selected tenant (TenantContext isolation)
  // ----------------------------------------------------
  try {
    const sessionA = PreviewSessionService.startSession({
      tenantId: "ten_agency_a",
      superAdminUid: SUPER_ADMIN_UID,
      superAdminEmail: SUPER_ADMIN_EMAIL,
      simulatedRole: "agency_admin",
    });

    const sessionB = PreviewSessionService.startSession({
      tenantId: "ten_agency_b",
      superAdminUid: SUPER_ADMIN_UID,
      superAdminEmail: SUPER_ADMIN_EMAIL,
      simulatedRole: "agency_admin",
    });

    assert(
      sessionA.tenantId === "ten_agency_a" &&
        sessionB.tenantId === "ten_agency_b" &&
        sessionA.token !== sessionB.token,
      "TEST 3: Sesiunile de preview izolează strict contextul tenantului selectat"
    );
  } catch (err: any) {
    assert(false, `TEST 3 Eșuat: ${err?.message}`);
  }

  // ----------------------------------------------------
  // TEST 4: Single-click Role Switching recalculates backend permissions
  // ----------------------------------------------------
  try {
    const session = PreviewSessionService.startSession({
      tenantId: "ten_agency_a",
      superAdminUid: SUPER_ADMIN_UID,
      superAdminEmail: SUPER_ADMIN_EMAIL,
      simulatedRole: "agency_admin",
    });

    assert(
      session.effectivePermissions.includes("agency.admin") &&
        session.effectivePermissions.includes("*"),
      "TEST 4a: Rolul inițial de Administrator deține permisiuni administrative ('agency.admin', '*')"
    );

    // Switch to Agent / Broker
    const switched = PreviewSessionService.switchRole(session.token, "agent");

    const hasAdminPerm = switched.effectivePermissions.includes("agency.admin");
    const hasWildcard = switched.effectivePermissions.includes("*");
    const hasCrmRead = switched.effectivePermissions.includes("crm.read");

    assert(
      !hasAdminPerm && !hasWildcard && hasCrmRead && switched.simulatedRole === "agent",
      "TEST 4b: Comutarea instantanee în rolul Agent revocă drepturile de administrare pe backend"
    );
  } catch (err: any) {
    assert(false, `TEST 4 Eșuat: ${err?.message}`);
  }

  // ----------------------------------------------------
  // TEST 5: Role switching back to Administrator restores administrative permissions
  // ----------------------------------------------------
  try {
    const session = PreviewSessionService.startSession({
      tenantId: "ten_agency_a",
      superAdminUid: SUPER_ADMIN_UID,
      superAdminEmail: SUPER_ADMIN_EMAIL,
      simulatedRole: "agent",
    });

    assert(
      !session.effectivePermissions.includes("agency.admin"),
      "TEST 5a: Sesiunea pornită ca Agent nu are drepturi de administrare"
    );

    const switchedBack = PreviewSessionService.switchRole(session.token, "agency_admin");
    assert(
      switchedBack.effectivePermissions.includes("agency.admin") &&
        switchedBack.simulatedRole === "agency_admin",
      "TEST 5b: Recomutarea în rolul Administrator restaurează imediat accesul administrativ"
    );
  } catch (err: any) {
    assert(false, `TEST 5 Eșuat: ${err?.message}`);
  }

  // ----------------------------------------------------
  // TEST 6: Exiting preview destroys session and prevents reuse
  // ----------------------------------------------------
  try {
    const session = PreviewSessionService.startSession({
      tenantId: "ten_agency_a",
      superAdminUid: SUPER_ADMIN_UID,
      superAdminEmail: SUPER_ADMIN_EMAIL,
      simulatedRole: "agency_admin",
    });

    const token = session.token;
    assert(PreviewSessionService.getSession(token) !== null, "TEST 6a: Sesiunea activă este găsită în registru");

    PreviewSessionService.destroySession(token);
    assert(
      PreviewSessionService.getSession(token) === null,
      "TEST 6b: 'IEȘIRE DIN TESTARE' anulează sesiunea; tokenul devine invalid imediat"
    );
  } catch (err: any) {
    assert(false, `TEST 6 Eșuat: ${err?.message}`);
  }

  // ----------------------------------------------------
  // TEST 7: Preview mode never modifies real user database records
  // ----------------------------------------------------
  try {
    const realTenant = TenantResolutionService.getTenantById("ten_agency_a");
    const originalStatus = realTenant?.status;

    const session = PreviewSessionService.startSession({
      tenantId: "ten_agency_a",
      superAdminUid: SUPER_ADMIN_UID,
      superAdminEmail: SUPER_ADMIN_EMAIL,
      simulatedRole: "agency_admin",
    });

    PreviewSessionService.switchRole(session.token, "agent");
    PreviewSessionService.destroySession(session.token);

    const verifyTenant = TenantResolutionService.getTenantById("ten_agency_a");
    assert(
      verifyTenant?.status === originalStatus,
      "TEST 7: Simulările de testare nu alterează starea reală a bazei de date a agențiilor"
    );
  } catch (err: any) {
    assert(false, `TEST 7 Eșuat: ${err?.message}`);
  }

  // ----------------------------------------------------
  // TEST 8: CRM Data Migration: Dry-run validates without writing target documents
  // ----------------------------------------------------
  try {
    TenantScopedRepository.clearInMemoryStore();

    const dryRunReport = await CrmMigrationService.executeMigration({
      targetTenantId: "ten_brokr_default",
      mode: "dry_run",
      executedBy: SUPER_ADMIN_EMAIL,
    });

    assert(
      dryRunReport.mode === "dry_run" &&
        dryRunReport.summary.totalRecordsFound > 0 &&
        dryRunReport.summary.totalMigrated === 0 &&
        dryRunReport.summary.isSafeToMigrate === true,
      "TEST 8: Dry-Run inspectează datele, confirmă siguranța și NU scrie documente în subcolecții"
    );
  } catch (err: any) {
    assert(false, `TEST 8 Eșuat: ${err?.message}`);
  }

  // ----------------------------------------------------
  // TEST 9: CRM Data Migration: Live execution writes to tenant-scoped subcollection
  // ----------------------------------------------------
  try {
    TenantScopedRepository.clearInMemoryStore();

    const liveReport = await CrmMigrationService.executeMigration({
      targetTenantId: "ten_brokr_default",
      mode: "live",
      executedBy: SUPER_ADMIN_EMAIL,
    });

    assert(
      liveReport.mode === "live" &&
        liveReport.summary.totalMigrated > 0 &&
        liveReport.summary.totalErrors === 0,
      `TEST 9: Executarea live migrează cu succes ${liveReport.summary.totalMigrated} înregistrări în tenantul inițial`
    );
  } catch (err: any) {
    assert(false, `TEST 9 Eșuat: ${err?.message}`);
  }

  // ----------------------------------------------------
  // TEST 10: CRM Data Migration: Idempotency (re-running skips duplicates without errors)
  // ----------------------------------------------------
  try {
    // Re-run migration immediately on the same tenant
    const secondRun = await CrmMigrationService.executeMigration({
      targetTenantId: "ten_brokr_default",
      mode: "live",
      executedBy: SUPER_ADMIN_EMAIL,
    });

    assert(
      secondRun.summary.totalSkippedDuplicates > 0 &&
        secondRun.summary.totalMigrated === 0 &&
        secondRun.summary.totalErrors === 0,
      `TEST 10: Idempotență confirmată: A doua rulare detectează ${secondRun.summary.totalSkippedDuplicates} duplicate și le ignoră în siguranță`
    );
  } catch (err: any) {
    assert(false, `TEST 10 Eșuat: ${err?.message}`);
  }

  console.log("========================================================");
  console.log(`📊 REZUMAT REZULTATE TESTE FAZA 7: Total: ${testsPassed + testsFailed} | Reușite: ${testsPassed} | Eșuate: ${testsFailed}`);
  console.log("========================================================");

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runPhase7Tests().catch((e) => {
  console.error("Eroare neprevăzută în testele Fazei 7:", e);
  process.exit(1);
});
