import { SubscriptionPlanRecord } from "./typ_subscription";
import { PersistentStoreService } from "../database/svc_persistent-store";

const COL_PLANS = "subscription_plans";

/**
 * Built-in default plans (labeled as provisional test data).
 */
const DEFAULT_PLANS: SubscriptionPlanRecord[] = [
  {
    id: "plan_starter",
    name: "Starter (Provisional Test Plan)",
    displayName: "Starter Agency",
    description: "Ideal pentru agenții la început de drum sau brokeri independenți.",
    priceMonthly: 199,
    priceAnnual: 1990,
    currency: "RON",
    billingInterval: "month",
    status: "active",
    trialAvailable: true,
    trialDays: 14,
    includedModules: [
      "mod_leads",
      "mod_requests",
      "mod_properties",
      "mod_public_share",
      "mod_ai_extraction",
    ],
    quotas: {
      maxAgents: 3,
      maxProperties: 150,
      maxLeads: 300,
      monthlyAiTokens: 250000,
      monthlyAiRequests: 300,
      storageMb: 5120, // 5 GB
    },
    features: [
      "Până la 3 conturi de broker",
      "150 de proprietăți active în portofoliu",
      "300 de lead-uri și cereri",
      "250.000 tokeni AI lunar pentru extragere oferte",
      "Link-uri de prezentare cu branding",
      "Suport tehnic standard pe email",
    ],
    displayOrder: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "plan_professional",
    name: "Professional (Provisional Test Plan)",
    displayName: "Professional Agency",
    description: "Pentru echipe imobiliare active în plină expansiune pe piață.",
    priceMonthly: 499,
    priceAnnual: 4990,
    currency: "RON",
    billingInterval: "month",
    status: "active",
    trialAvailable: true,
    trialDays: 14,
    includedModules: [
      "mod_leads",
      "mod_requests",
      "mod_properties",
      "mod_matching",
      "mod_calendar",
      "mod_documents",
      "mod_public_share",
      "mod_ai_extraction",
    ],
    quotas: {
      maxAgents: 10,
      maxProperties: 800,
      maxLeads: 2000,
      monthlyAiTokens: 1000000,
      monthlyAiRequests: 1200,
      storageMb: 25600, // 25 GB
    },
    features: [
      "Până la 10 conturi de broker",
      "800 de proprietăți active în portofoliu",
      "2.000 de lead-uri și cereri clienți",
      "Corelare automată (Matching inteligent)",
      "Calendar integrat & gestiune vizionări",
      "Generator contracte și fișe de vizionare",
      "1.000.000 tokeni AI lunar",
      "Suport prioritar",
    ],
    displayOrder: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "plan_enterprise",
    name: "Enterprise (Provisional Test Plan)",
    displayName: "Enterprise Cloud",
    description: "Soluția completă pentru agenții mari și rețele de franciză imobiliară.",
    priceMonthly: 999,
    priceAnnual: 9990,
    currency: "RON",
    billingInterval: "month",
    status: "active",
    trialAvailable: false,
    trialDays: 0,
    includedModules: [
      "mod_leads",
      "mod_requests",
      "mod_properties",
      "mod_matching",
      "mod_calendar",
      "mod_documents",
      "mod_public_share",
      "mod_ai_extraction",
      "mod_ai_voice",
    ],
    quotas: {
      maxAgents: -1, // Nelimitat
      maxProperties: -1, // Nelimitat
      maxLeads: -1, // Nelimitat
      monthlyAiTokens: 5000000,
      monthlyAiRequests: 6000,
      storageMb: 102400, // 100 GB
    },
    features: [
      "Număr nelimitat de brokeri și manageri",
      "Portofoliu nelimitat de proprietăți",
      "Lead-uri și contacte nelimitate",
      "Toate modulele active incluse",
      "Asistent vocal & apeluri AI",
      "5.000.000 tokeni AI lunar",
      "100 GB stocare cloud dedicată",
      "Suport dedicat 24/7 & SLA garantat",
    ],
    displayOrder: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

function ensureSeeded(): Record<string, SubscriptionPlanRecord> {
  return PersistentStoreService.seedIfEmpty<SubscriptionPlanRecord>(
    COL_PLANS,
    DEFAULT_PLANS.map((p) => ({ id: p.id, value: { ...p } }))
  );
}

export class PlanRepository {
  public static list(statusFilter?: string): SubscriptionPlanRecord[] {
    const all = Object.values(ensureSeeded()).sort((a, b) => a.displayOrder - b.displayOrder);
    if (!statusFilter || statusFilter === "all") {
      return all;
    }
    return all.filter((p) => p.status === statusFilter);
  }

  public static findById(id: string): SubscriptionPlanRecord | null {
    ensureSeeded();
    return PersistentStoreService.get<SubscriptionPlanRecord>(COL_PLANS, id);
  }

  public static create(plan: SubscriptionPlanRecord): SubscriptionPlanRecord {
    ensureSeeded();
    if (PersistentStoreService.get<SubscriptionPlanRecord>(COL_PLANS, plan.id)) {
      throw new Error(`Planul cu ID-ul ${plan.id} există deja.`);
    }
    PersistentStoreService.set(COL_PLANS, plan.id, { ...plan });
    return plan;
  }

  public static update(id: string, updates: Partial<SubscriptionPlanRecord>): SubscriptionPlanRecord {
    ensureSeeded();
    const existing = PersistentStoreService.get<SubscriptionPlanRecord>(COL_PLANS, id);
    if (!existing) {
      throw new Error(`Planul cu ID-ul ${id} nu a fost găsit.`);
    }

    const updated: SubscriptionPlanRecord = {
      ...existing,
      ...updates,
      id: existing.id, // ID is immutable
      updatedAt: new Date().toISOString(),
    };

    PersistentStoreService.set(COL_PLANS, id, updated);
    return updated;
  }

  public static resetDefaults(): void {
    PersistentStoreService.clearCollection(COL_PLANS);
    for (const p of DEFAULT_PLANS) {
      PersistentStoreService.set(COL_PLANS, p.id, { ...p });
    }
  }
}
