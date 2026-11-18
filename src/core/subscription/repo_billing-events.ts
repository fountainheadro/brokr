import { PersistentStoreService } from "../database/svc_persistent-store";

export interface BillingEventLog {
  id: string;
  provider: string;
  eventType: string;
  tenantId?: string;
  status: "processed" | "ignored" | "failed" | "duplicate";
  details?: Record<string, any>;
  receivedAt: string;
}

export interface BillingTenantOrderingState {
  tenantId: string;
  lastEventTs: number;
  lastEventId: string;
  lastSubscriptionId?: string | null;
  updatedAt: string;
}

const COL_BILLING_EVENTS = "billing_events";
const COL_BILLING_TENANT_STATE = "billing_tenant_state";
const COL_BILLING_LOGS = "billing_event_logs";
const MAX_BILLING_LOGS = 500;

/**
 * Persistent billing event store guaranteeing:
 * 1. Atomic cross-instance idempotency on provider event IDs (`createIfAbsentAsync`).
 * 2. Out-of-order protection via persistent tenant event timestamp / ordering tracking.
 * 3. Persistent bounded billing event audit logs.
 */
export class BillingEventsRepository {
  /**
   * Atomically attempts to acquire exclusive processing rights for a webhook event ID.
   * Returns true ONLY for the first caller across concurrent requests and restarts.
   */
  public static async tryAcquireEvent(
    eventId: string,
    metadata: { provider: string; eventType: string; tenantId?: string; eventTs: number }
  ): Promise<boolean> {
    return PersistentStoreService.createIfAbsentAsync(COL_BILLING_EVENTS, eventId, {
      id: eventId,
      provider: metadata.provider,
      eventType: metadata.eventType,
      tenantId: metadata.tenantId || null,
      eventTs: metadata.eventTs,
      acquiredAt: new Date().toISOString(),
      status: "acquired",
    });
  }

  public static markEventOutcome(
    eventId: string,
    status: "processed" | "ignored" | "failed",
    details?: Record<string, any>
  ): void {
    const existing = PersistentStoreService.get<Record<string, any>>(COL_BILLING_EVENTS, eventId) || {
      id: eventId,
    };
    PersistentStoreService.set(COL_BILLING_EVENTS, eventId, {
      ...existing,
      status,
      details: details || null,
      completedAt: new Date().toISOString(),
    });
  }

  /**
   * Persistent out-of-order check + watermark advance serialized per tenantId.
   * Returns { isStale: true } if a newer event timestamp was already processed for the tenant.
   */
  public static async checkAndAdvanceTenantOrdering(
    tenantId: string,
    eventId: string,
    eventTs: number,
    subscriptionId?: string | null
  ): Promise<{ isStale: boolean; lastEventTs: number | null }> {
    return PersistentStoreService.withKeyMutex(`billing_order::${tenantId}`, async () => {
      const current =
        (await PersistentStoreService.remoteGet<BillingTenantOrderingState>(
          COL_BILLING_TENANT_STATE,
          tenantId
        )) || PersistentStoreService.get<BillingTenantOrderingState>(COL_BILLING_TENANT_STATE, tenantId);

      if (current && typeof current.lastEventTs === "number" && eventTs < current.lastEventTs) {
        return { isStale: true, lastEventTs: current.lastEventTs };
      }

      const nextState: BillingTenantOrderingState = {
        tenantId,
        lastEventTs: eventTs,
        lastEventId: eventId,
        lastSubscriptionId: subscriptionId || current?.lastSubscriptionId || null,
        updatedAt: new Date().toISOString(),
      };
      PersistentStoreService.set(COL_BILLING_TENANT_STATE, tenantId, nextState);
      return { isStale: false, lastEventTs: eventTs };
    });
  }

  public static appendLog(entry: BillingEventLog): void {
    const record = PersistentStoreService.get<{ items: BillingEventLog[] }>(
      COL_BILLING_LOGS,
      "recent"
    ) || { items: [] };

    const items = [...record.items, entry];
    if (items.length > MAX_BILLING_LOGS) {
      items.splice(0, items.length - MAX_BILLING_LOGS);
    }

    PersistentStoreService.set(COL_BILLING_LOGS, "recent", { items });
  }

  public static getLogs(): BillingEventLog[] {
    const record = PersistentStoreService.get<{ items: BillingEventLog[] }>(
      COL_BILLING_LOGS,
      "recent"
    );
    if (!record || !Array.isArray(record.items)) return [];
    return [...record.items].reverse();
  }

  public static resetAll(): void {
    PersistentStoreService.clearCollection(COL_BILLING_EVENTS);
    PersistentStoreService.clearCollection(COL_BILLING_TENANT_STATE);
    PersistentStoreService.clearCollection(COL_BILLING_LOGS);
  }
}
