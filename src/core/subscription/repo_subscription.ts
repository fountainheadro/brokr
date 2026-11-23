import { AgencySubscriptionRecord } from "./typ_subscription";
import { PersistentStoreService } from "../database/svc_persistent-store";

const COL_SUBSCRIPTIONS = "subscriptions";

/**
 * Built-in initial subscriptions for mock/development agencies.
 */
const INITIAL_SUBSCRIPTIONS: AgencySubscriptionRecord[] = [
  {
    id: "sub_ten_brokr_default",
    tenantId: "ten_brokr_default",
    planId: "plan_enterprise",
    status: "active",
    billingInterval: "month",
    currentPeriodStart: "2026-01-01T00:00:00.000Z",
    currentPeriodEnd: "2027-01-01T00:00:00.000Z",
    trialEnd: null,
    cancelAtPeriodEnd: false,
    cancelledAt: null,
    suspendedAt: null,
    suspendedReason: null,
    gracePeriodEnd: null,
    activeAddons: [],
    provider: "mock",
    providerSubscriptionId: "sub_mock_brokr_enterprise",
    providerCustomerId: "cus_mock_brokr",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "sub_ten_agency_a",
    tenantId: "ten_agency_a",
    planId: "plan_professional",
    status: "active",
    billingInterval: "month",
    currentPeriodStart: "2026-02-01T00:00:00.000Z",
    currentPeriodEnd: "2026-03-01T00:00:00.000Z",
    trialEnd: null,
    cancelAtPeriodEnd: false,
    cancelledAt: null,
    suspendedAt: null,
    suspendedReason: null,
    gracePeriodEnd: null,
    activeAddons: [
      {
        addonId: "addon_ai_tokens_500k",
        quantity: 1,
        activatedAt: "2026-02-05T10:00:00.000Z",
      },
    ],
    provider: "mock",
    providerSubscriptionId: "sub_mock_agency_a_pro",
    providerCustomerId: "cus_mock_agency_a",
    createdAt: "2026-02-01T00:00:00.000Z",
    updatedAt: "2026-02-05T10:00:00.000Z",
  },
  {
    id: "sub_ten_agency_b",
    tenantId: "ten_agency_b",
    planId: "plan_starter",
    status: "trialing",
    billingInterval: "month",
    currentPeriodStart: "2026-02-10T00:00:00.000Z",
    currentPeriodEnd: "2026-02-24T00:00:00.000Z",
    trialEnd: "2026-02-24T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    cancelledAt: null,
    suspendedAt: null,
    suspendedReason: null,
    gracePeriodEnd: null,
    activeAddons: [],
    provider: "mock",
    providerSubscriptionId: null,
    providerCustomerId: null,
    createdAt: "2026-02-10T00:00:00.000Z",
    updatedAt: "2026-02-10T00:00:00.000Z",
  },
  {
    id: "sub_ten_suspended",
    tenantId: "ten_suspended",
    planId: "plan_starter",
    status: "suspended",
    billingInterval: "month",
    currentPeriodStart: "2026-01-01T00:00:00.000Z",
    currentPeriodEnd: "2026-02-01T00:00:00.000Z",
    trialEnd: null,
    cancelAtPeriodEnd: false,
    cancelledAt: null,
    suspendedAt: "2026-02-02T12:00:00.000Z",
    suspendedReason: "Plată restantă și refuz debitare recurentă.",
    gracePeriodEnd: "2026-02-10T12:00:00.000Z",
    activeAddons: [],
    provider: "mock",
    providerSubscriptionId: "sub_mock_suspended",
    providerCustomerId: "cus_mock_suspended",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-02T12:00:00.000Z",
  },
];

function ensureSeeded(): Record<string, AgencySubscriptionRecord> {
  return PersistentStoreService.seedIfEmpty<AgencySubscriptionRecord>(
    COL_SUBSCRIPTIONS,
    INITIAL_SUBSCRIPTIONS.map((seed) => ({ id: seed.tenantId, value: { ...seed } }))
  );
}

export class SubscriptionRepository {
  public static list(filter?: { status?: string; planId?: string }): AgencySubscriptionRecord[] {
    let list = Object.values(ensureSeeded());
    if (filter?.status && filter.status !== "all") {
      list = list.filter((s) => s.status === filter.status);
    }
    if (filter?.planId && filter.planId !== "all") {
      list = list.filter((s) => s.planId === filter.planId);
    }
    return list;
  }

  public static findByTenantId(tenantId: string): AgencySubscriptionRecord | null {
    ensureSeeded();
    return PersistentStoreService.get<AgencySubscriptionRecord>(COL_SUBSCRIPTIONS, tenantId);
  }

  public static async findByTenantIdAsync(
    tenantId: string
  ): Promise<AgencySubscriptionRecord | null> {
    if (PersistentStoreService.isRemoteFirestoreConfigured()) {
      try {
        const remote = await PersistentStoreService.remoteGet<AgencySubscriptionRecord>(
          COL_SUBSCRIPTIONS,
          tenantId
        );
        if (remote) {
          PersistentStoreService.setCacheOnly(COL_SUBSCRIPTIONS, tenantId, remote);
          return remote;
        }
      } catch {
        // Fallback to cached/default if absent
      }
    }
    return this.findByTenantId(tenantId);
  }

  public static findById(id: string): AgencySubscriptionRecord | null {
    const all = Object.values(ensureSeeded());
    for (const sub of all) {
      if (sub.id === id) return sub;
    }
    return null;
  }

  public static save(subscription: AgencySubscriptionRecord): AgencySubscriptionRecord {
    ensureSeeded();
    const updated: AgencySubscriptionRecord = {
      ...subscription,
      updatedAt: new Date().toISOString(),
    };
    PersistentStoreService.set(COL_SUBSCRIPTIONS, subscription.tenantId, updated);
    return updated;
  }

  public static async saveAsync(
    subscription: AgencySubscriptionRecord
  ): Promise<AgencySubscriptionRecord> {
    ensureSeeded();
    const updated: AgencySubscriptionRecord = {
      ...subscription,
      updatedAt: new Date().toISOString(),
    };
    await PersistentStoreService.setAsync(COL_SUBSCRIPTIONS, subscription.tenantId, updated);
    return updated;
  }

  public static resetDefaults(): void {
    PersistentStoreService.clearCollection(COL_SUBSCRIPTIONS);
    for (const seed of INITIAL_SUBSCRIPTIONS) {
      PersistentStoreService.set(COL_SUBSCRIPTIONS, seed.tenantId, { ...seed });
    }
  }
}
