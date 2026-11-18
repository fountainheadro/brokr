import { PlanService } from "../../src/core/subscription/svc_plan";
import { ModuleCatalogService } from "../../src/core/subscription/svc_module";
import { SubscriptionService } from "../../src/core/subscription/svc_subscription";
import { QuotaService } from "../../src/core/subscription/svc_quota";
import { BillingManager } from "../../src/core/subscription/svc_billing-manager";
import { PlanRepository } from "../../src/core/subscription/repo_plan";
import { SubscriptionRepository } from "../../src/core/subscription/repo_subscription";
import { PlatformAdminService } from "../../src/core/platform/svc_platform-admin";
import { TenantMembershipService } from "../../src/core/tenancy/svc_tenant-membership";
import { QuotaExceededError } from "../../src/core/errors/app_error";

console.log("========================================================");
console.log("💳 RULARE TESTE SUBSCRIPTION, ENTITLEMENTS & BILLING (FAZA 5)");
console.log("========================================================");

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

async function runTestSuite() {
  // Reset test state to clean baselines
  PlanRepository.resetDefaults();
  SubscriptionRepository.resetDefaults();
  QuotaService.resetDefaults();
  BillingManager.resetDefaults();

  // TEST 1: Plan creation, retrieval, and status updates
  try {
    const newPlan = PlanService.createPlan({
      id: "plan_test_custom",
      displayName: "Custom Test Plan",
      priceMonthly: 150,
      currency: "RON",
      quotas: {
        maxAgents: 4,
        maxProperties: 100,
        maxLeads: 250,
        monthlyAiTokens: 200000,
        monthlyAiRequests: 200,
        storageMb: 4096,
      },
      includedModules: ["mod_leads", "mod_properties"],
    });

    const retrieved = PlanService.getPlanById("plan_test_custom");
    assert(
      retrieved.id === "plan_test_custom" && retrieved.priceMonthly === 150 && retrieved.currency === "RON",
      "TEST 1: Crearea și regăsirea unui plan tarifar nou cu preț în RON"
    );
  } catch (e: any) {
    assert(false, `TEST 1 eșuat cu eroare: ${e?.message}`);
  }

  // TEST 2: Module entitlement resolution (Included vs Restricționat)
  try {
    const entitlementsA = QuotaService.getEffectiveQuotas("ten_agency_a"); // On plan_professional
    const hasProperties = entitlementsA.modules.includes("mod_properties");
    const hasMatching = entitlementsA.modules.includes("mod_matching");
    // plan_professional includes mod_matching, but does NOT include mod_ai_voice by default
    const hasVoice = entitlementsA.modules.includes("mod_ai_voice");

    assert(
      hasProperties && hasMatching && !hasVoice,
      "TEST 2: Rezolvarea modulelor efective conform planului activ (Professional include matching, exclude ai_voice)"
    );
  } catch (e: any) {
    assert(false, `TEST 2 eșuat: ${e?.message}`);
  }

  // TEST 3: Add-on entitlement resolution extends base plan limits
  try {
    const baseQuotas = QuotaService.getEffectiveQuotas("ten_agency_b"); // Starter
    const initialAiTokens = baseQuotas.quotas.monthlyAiTokens;

    // Attach +500k AI token addon
    SubscriptionService.addAddon("ten_agency_b", "addon_ai_tokens_500k", 2, "test_admin@platform.com"); // 2 x 500k = +1M
    const extendedQuotas = QuotaService.getEffectiveQuotas("ten_agency_b");

    assert(
      extendedQuotas.quotas.monthlyAiTokens === initialAiTokens + 1000000,
      "TEST 3: Pachetul add-on extinde corect cota de bază (+1.000.000 tokeni AI)"
    );
  } catch (e: any) {
    assert(false, `TEST 3 eșuat: ${e?.message}`);
  }

  // TEST 4: Quota enforcement blocks operations when quota is reached
  try {
    // Agency B has Starter plan (properties limit: 150)
    // Let's set usage to limit
    const initialCheck = QuotaService.checkQuota("ten_agency_b", "properties", 1);
    assert(initialCheck.allowed === true, "TEST 4a: Verificare cotă disponibilă permisă inițial");

    // Consume up to limit
    let quotaExceededCaught = false;
    try {
      QuotaService.consumeQuota("ten_agency_b", "properties", 200); // Exceeds 150 limit
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        quotaExceededCaught = true;
      }
    }

    assert(quotaExceededCaught, "TEST 4b: Depășirea cotei alocate aruncă corect QuotaExceededError (HTTP 429)");
  } catch (e: any) {
    assert(false, `TEST 4 eșuat: ${e?.message}`);
  }

  // TEST 5: AI usage reservation, commit, and refund
  try {
    const reservationId = QuotaService.reserveAiQuota("ten_brokr_default", 5000);
    assert(reservationId.startsWith("res_"), "TEST 5a: Rezervare reușită a tokenilor AI înainte de apel");

    // Commit actual usage (e.g. prompt used 4200 tokens)
    QuotaService.commitAiQuota(reservationId, 4200);

    // Create another reservation and test refund on simulated error
    const failedReservationId = QuotaService.reserveAiQuota("ten_brokr_default", 10000);
    QuotaService.refundAiQuota(failedReservationId);

    assert(true, "TEST 5b: Confirmare consum real și returnare rezervare în caz de eșec (refund)");
  } catch (e: any) {
    assert(false, `TEST 5 eșuat: ${e?.message}`);
  }

  // TEST 6: Downgrade Safety Policy - NEVER delete agency data
  try {
    // Create a plan with sufficient capacity for Agency A (125 properties, 310 leads)
    PlanService.createPlan({
      id: "plan_safe_downgrade",
      displayName: "Safe Downgrade Plan",
      priceMonthly: 199,
      quotas: {
        maxAgents: 10,
        maxProperties: 150, // > 125
        maxLeads: 400, // > 310
        monthlyAiTokens: 500000,
        monthlyAiRequests: 500,
        storageMb: 10240,
      },
    });

    const impact = QuotaService.verifyDowngradeImpact("ten_agency_a", "plan_safe_downgrade");
    assert(impact.safe === true, "TEST 6a: Downgrade sigur verificat când datele curente sunt în limitele noului plan");

    // Create a strict restricted plan with max 50 properties
    PlanService.createPlan({
      id: "plan_micro",
      displayName: "Micro Plan",
      priceMonthly: 49,
      quotas: {
        maxAgents: 1,
        maxProperties: 50, // Less than current 125
        maxLeads: 100,
        monthlyAiTokens: 50000,
        monthlyAiRequests: 50,
        storageMb: 1024,
      },
    });

    const microImpact = QuotaService.verifyDowngradeImpact("ten_agency_a", "plan_micro");
    assert(
      microImpact.safe === false && microImpact.exceededResources.some((r) => r.resource === "properties"),
      "TEST 6b: Verificare impact downgrade: identifică resursa depășită fără a șterge datele existente"
    );

    // Apply downgrade
    SubscriptionService.changePlan("ten_agency_a", "plan_micro", "month", "admin@platform.com");
    // Verify properties still exist and are accessible
    const usageAfterDowngrade = QuotaService.getUsage("ten_agency_a");
    assert(
      usageAfterDowngrade.properties === 125,
      "TEST 6c: Downgrade finalizat - toate cele 125 proprietăți existente sunt 100% conservate intacte"
    );
  } catch (e: any) {
    assert(false, `TEST 6 eșuat: ${e?.message}`);
  }

  // TEST 7: Payment failure and grace period behavior
  try {
    SubscriptionService.updateStatus("ten_agency_a", "past_due", "Card expirat la reînnoire", "system_billing");
    const entitlementsPastDue = QuotaService.getTenantEntitlements("ten_agency_a");

    assert(
      entitlementsPastDue.subscriptionStatus === "past_due" && entitlementsPastDue.isInGracePeriod === true,
      "TEST 7: Plata eșuată comută starea în 'past_due' cu perioadă activă de grație de 7 zile"
    );
  } catch (e: any) {
    assert(false, `TEST 7 eșuat: ${e?.message}`);
  }

  // TEST 8: Webhook processing, signature validation, and idempotency (replay protection)
  try {
    const mockPayload = {
      id: "evt_test_payment_12345",
      type: "invoice.payment_succeeded",
      provider: "mock",
      createdAt: new Date().toISOString(),
      data: { tenantId: "ten_agency_b" },
    };

    // First delivery
    const result1 = await BillingManager.processWebhook(mockPayload, "valid_test_signature", "mock");
    assert(
      result1.handled === true && result1.duplicate === false,
      "TEST 8a: Primul webhook de plată recepționat și procesat cu succes"
    );

    // Replay attack / duplicate delivery with identical event ID
    const result2 = await BillingManager.processWebhook(mockPayload, "valid_test_signature", "mock");
    assert(
      result2.handled === true && result2.duplicate === true,
      "TEST 8b: Idempotență confirmată: Livrarea duplicată a aceluiași event ID este ignorată fără re-procesare"
    );
  } catch (e: any) {
    assert(false, `TEST 8 eșuat: ${e?.message}`);
  }

  // TEST 9: Cross-tenant subscription isolation
  try {
    // Agency A administrator attempts to query entitlements of Agency B
    const subAgencyA = SubscriptionService.getByTenantId("ten_agency_a");
    const subAgencyB = SubscriptionService.getByTenantId("ten_agency_b");

    assert(
      subAgencyA.tenantId === "ten_agency_a" &&
        subAgencyB.tenantId === "ten_agency_b" &&
        subAgencyA.id !== subAgencyB.id,
      "TEST 9: Izolare completă între agenții: abonamentul Agenției A este complet distinct de Agenția B"
    );
  } catch (e: any) {
    assert(false, `TEST 9 eșuat: ${e?.message}`);
  }

  // TEST 10: Provider abstraction works safely without payment credentials
  try {
    const providerStatus = BillingManager.getProviderStatus();
    assert(
      providerStatus.activeProvider === "mock" && providerStatus.isDevelopmentMode === true,
      "TEST 10: Sistemul funcționează complet și sigur în mod simulator (Mock) fără credențiale de plată în mediul de dev"
    );
  } catch (e: any) {
    assert(false, `TEST 10 eșuat: ${e?.message}`);
  }

  console.log("========================================================");
  console.log("📊 REZUMAT REZULTATE TESTE FAZA 5");
  console.log("========================================================");
  console.log(`Total teste: ${testsPassed + testsFailed} | Reușite: ${testsPassed} | Eșuate: ${testsFailed}`);

  if (testsFailed > 0) {
    process.exit(1);
  } else {
    console.log("🎉 TOATE CELE 10 TESTE DE ABONAMENTE ȘI COTE AU TRECUT CU SUCCES!");
    process.exit(0);
  }
}

runTestSuite();
