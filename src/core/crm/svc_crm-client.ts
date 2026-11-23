import {
  collection,
  limit as firestoreLimit,
  onSnapshot,
  query,
  QueryConstraint,
  where,
} from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import { normalizeCrmDocument } from "./svc_crm-normalizer";
import {
  clientDataHub,
  isClientDataHubEnabled,
  type DataHubPageOptions,
  type DataHubPageResult,
} from "./svc_client-data-hub";

const TS_KEYS = new Set(["createdAt", "updatedAt", "lastMovedAt", "deletedAt", "created_at", "updated_at"]);

let activeCrmTenantId: string | null = null;
let activeCrmPreviewMode = false;

/**
 * Publishes the verified active tenantId (and whether Super Admin preview mode is active)
 * so real-time Cloud Firestore `onSnapshot` listeners attach directly to `/tenants/{tenantId}/{col}`
 * via the ref-counted Centralized Client Data Hub with zero 4-second polling storms.
 */
export function setActiveCrmTenantContext(tenantId: string | null, isPreviewMode = false): void {
  const changed = activeCrmTenantId !== tenantId || activeCrmPreviewMode !== isPreviewMode;
  activeCrmTenantId = tenantId;
  activeCrmPreviewMode = isPreviewMode;
  clientDataHub.setContext({
    tenantId,
    uid: auth.currentUser?.uid || null,
    isPreviewMode,
  });
  if (changed && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("brokr:crm-tenant-context-ready", { detail: { tenantId, isPreviewMode } }));
  }
}

/**
 * Hydrates ISO string / number / Firestore-like timestamp values into objects
 * compatible with Date, .toDate(), .toMillis(), and JSON serialization.
 */
export function hydrateTimestampValue(val: any): any {
  if (val === null || val === undefined) return val;
  if (typeof val === "object" && typeof val.toDate === "function" && typeof val.toMillis === "function") {
    return val;
  }

  let ms: number | null = null;
  if (typeof val === "string") {
    const parsed = Date.parse(val);
    if (!Number.isNaN(parsed)) ms = parsed;
  } else if (typeof val === "number") {
    ms = val;
  } else if (typeof val === "object" && typeof val.seconds === "number") {
    ms = val.seconds * 1000 + Math.floor((val.nanoseconds || 0) / 1e6);
  }

  if (ms === null || Number.isNaN(ms)) return val;
  const dateObj = new Date(ms);
  const iso = dateObj.toISOString();

  return {
    seconds: Math.floor(ms / 1000),
    nanoseconds: (ms % 1000) * 1e6,
    toDate: () => new Date(ms!),
    toMillis: () => ms!,
    toISOString: () => iso,
    toJSON: () => iso,
    toString: () => iso,
    valueOf: () => ms!,
  };
}

export function hydrateEntityTimestamps<T extends Record<string, any>>(record: T): T {
  if (!record || typeof record !== "object") return record;
  const copy: Record<string, any> = { ...record };
  for (const key of TS_KEYS) {
    if (copy[key] !== undefined && copy[key] !== null) {
      copy[key] = hydrateTimestampValue(copy[key]);
    }
  }
  return copy as T;
}

const CRM_UPDATE_EVENT = "brokr:crm-collection-updated";

export function emitCrmCollectionUpdated(collectionName: string): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CRM_UPDATE_EVENT, { detail: { collectionName } }));
  }
}

async function buildAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const currentUser = auth.currentUser;
  if (currentUser) {
    const idToken = await currentUser.getIdToken();
    headers.Authorization = `Bearer ${idToken}`;
  }
  if (typeof localStorage !== "undefined") {
    const previewToken = localStorage.getItem("brokr_preview_token");
    if (previewToken) {
      headers["x-preview-token"] = previewToken;
    }
  }
  return headers;
}

function sortCrmItems<T extends Record<string, any>>(items: T[], collectionName: string): T[] {
  return [...items].sort((a, b) => {
    if (collectionName === "activities" || collectionName === "viewings") {
      return String(a.date || "").localeCompare(String(b.date || ""));
    }
    const getMs = (v: any) => {
      if (!v) return 0;
      if (typeof v.toMillis === "function") return v.toMillis();
      if (typeof v === "number") return v;
      const parsed = Date.parse(String(v));
      return Number.isNaN(parsed) ? 0 : parsed;
    };
    return getMs(b.updatedAt || b.createdAt) - getMs(a.updatedAt || a.createdAt);
  });
}

export const crmApiClient = {
  async list<T = Record<string, any>>(
    collectionName: string,
    queryOpts?: { propertyId?: string; onlyMine?: boolean; limit?: number }
  ): Promise<T[]> {
    if (collectionName === "users") {
      const headers = await buildAuthHeaders();
      const res = await fetch("/api/tenant/members", { headers });
      if (res.status === 401 || res.status === 403) return [];
      const json = await res.json();
      if (!res.ok || !json.success) return [];
      return Array.isArray(json.data) ? (json.data as T[]) : [];
    }

    const params = new URLSearchParams();
    if (queryOpts?.propertyId) params.set("propertyId", queryOpts.propertyId);
    if (queryOpts?.onlyMine) params.set("onlyMine", "true");
    if (queryOpts?.limit) params.set("limit", String(queryOpts.limit));
    const qs = params.toString();
    const url = `/api/crm/${encodeURIComponent(collectionName)}${qs ? `?${qs}` : ""}`;

    const headers = await buildAuthHeaders();
    const res = await fetch(url, { headers });
    if (res.status === 401 || res.status === 403) {
      return [];
    }
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json?.error?.message || `Eroare citire ${collectionName}`);
    }
    return (Array.isArray(json.data) ? json.data : []).map((item: any) =>
      hydrateEntityTimestamps(item)
    );
  },

  async listPage<T = Record<string, any>>(
    collectionName: string,
    pageOpts?: DataHubPageOptions
  ): Promise<DataHubPageResult<T>> {
    return clientDataHub.fetchCollectionPage<T>(collectionName, pageOpts, "tenant");
  },

  async getById<T = Record<string, any>>(collectionName: string, id: string): Promise<T | null> {
    if (!auth.currentUser) return null;
    const fetchDirect = async (): Promise<T | null> => {
      const headers = await buildAuthHeaders();
      const res = await fetch(
        `/api/crm/${encodeURIComponent(collectionName)}/${encodeURIComponent(id)}`,
        { headers }
      );
      if (res.status === 404 || res.status === 401 || res.status === 403) {
        return null;
      }
      const json = await res.json();
      if (!res.ok || !json.success) return null;
      return hydrateEntityTimestamps(json.data) as T;
    };

    if (isClientDataHubEnabled()) {
      return clientDataHub.getDocumentById<T>(collectionName, id, fetchDirect);
    }
    return fetchDirect();
  },

  async create<T = Record<string, any>>(
    collectionName: string,
    payload: Record<string, any>
  ): Promise<T & { id: string }> {
    const headers = await buildAuthHeaders();
    const res = await fetch(`/api/crm/${encodeURIComponent(collectionName)}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json?.error?.message || `Eroare creare în ${collectionName}`);
    }
    emitCrmCollectionUpdated(collectionName);
    clientDataHub.notifyMutation(collectionName, json.data?.id);
    if (collectionName === "activities") {
      emitCrmCollectionUpdated("tours");
      emitCrmCollectionUpdated("viewings");
      clientDataHub.notifyMutation("viewings");
    } else if (collectionName === "staff") {
      emitCrmCollectionUpdated("personal");
      clientDataHub.notifyMutation("personal");
    } else if (collectionName === "personal") {
      emitCrmCollectionUpdated("staff");
      clientDataHub.notifyMutation("staff");
    }
    return hydrateEntityTimestamps(json.data) as T & { id: string };
  },

  async update<T = Record<string, any>>(
    collectionName: string,
    id: string,
    patch: Record<string, any>
  ): Promise<T> {
    const headers = await buildAuthHeaders();
    const res = await fetch(
      `/api/crm/${encodeURIComponent(collectionName)}/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify(patch),
      }
    );
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json?.error?.message || `Eroare actualizare în ${collectionName}`);
    }
    emitCrmCollectionUpdated(collectionName);
    clientDataHub.notifyMutation(collectionName, id);
    if (collectionName === "staff") {
      emitCrmCollectionUpdated("personal");
      clientDataHub.notifyMutation("personal", id);
    }
    if (collectionName === "personal") {
      emitCrmCollectionUpdated("staff");
      clientDataHub.notifyMutation("staff", id);
    }
    return hydrateEntityTimestamps(json.data) as T;
  },

  async remove(collectionName: string, id: string): Promise<void> {
    const headers = await buildAuthHeaders();
    const res = await fetch(
      `/api/crm/${encodeURIComponent(collectionName)}/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        headers,
      }
    );
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json?.error?.message || `Eroare ștergere în ${collectionName}`);
    }
    emitCrmCollectionUpdated(collectionName);
    clientDataHub.notifyMutation(collectionName, id);
    if (collectionName === "staff") {
      emitCrmCollectionUpdated("personal");
      clientDataHub.notifyMutation("personal", id);
    }
    if (collectionName === "personal") {
      emitCrmCollectionUpdated("staff");
      clientDataHub.notifyMutation("staff", id);
    }
  },

  async clearLeads(): Promise<void> {
    const headers = await buildAuthHeaders();
    const res = await fetch(`/api/crm/leads`, {
      method: "DELETE",
      headers,
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json?.error?.message || "Eroare ștergere lead-uri");
    }
    emitCrmCollectionUpdated("leads");
    clientDataHub.notifyMutation("leads");
  },

  async getNextId(type: string): Promise<string> {
    const headers = await buildAuthHeaders();
    const res = await fetch(`/api/crm/counters/next-id`, {
      method: "POST",
      headers,
      body: JSON.stringify({ type }),
    });
    const json = await res.json();
    if (!res.ok || !json.success || !json.data?.nextId) {
      throw new Error(json?.error?.message || `Eroare generare ID ${type}`);
    }
    return json.data.nextId;
  },

  async upsertFcmToken(payload: Record<string, any>): Promise<void> {
    const headers = await buildAuthHeaders();
    if (!headers.Authorization) {
      return;
    }

    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`/api/crm/fcm-tokens`, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });
        if (res.ok || res.status === 401 || res.status === 403) {
          return;
        }
        lastErr = new Error(`HTTP ${res.status} while registering FCM token`);
      } catch (err) {
        lastErr = err;
      }
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
    }

    if (lastErr) {
      throw lastErr;
    }
  },

  async deleteFcmToken(token: string): Promise<void> {
    const headers = await buildAuthHeaders();
    if (!headers.Authorization) {
      return;
    }
    await fetch(`/api/crm/fcm-tokens/${encodeURIComponent(token)}`, {
      method: "DELETE",
      headers,
    });
  },

  /**
   * High-scale real-time subscription:
   * - Attaches a live Cloud Firestore `onSnapshot` push listener directly on
   *   `/tenants/{tenantId}/{collectionName}` with indexed `where` + bounded `limit`,
   *   eliminating periodic polling storms for agencies with hundreds/thousands of agents.
   * - Falls back cleanly to `/api/crm/...` fetch (on mutation events + 30s gentle sync)
   *   only while tenant membership is bootstrapping or in Super Admin preview mode.
   */
  subscribe<T = Record<string, any>>(
    collectionName: string,
    callback: (items: T[]) => void,
    options?: { propertyId?: string; onlyMine?: boolean; limit?: number; transform?: (items: T[]) => T[] }
  ): () => void {
    if (isClientDataHubEnabled()) {
      return clientDataHub.subscribeCollection<T>(collectionName, callback, options, "tenant");
    }

    let active = true;
    let inFlight = false;
    let unsubFirestore: (() => void) | null = null;
    let fallbackTimer: ReturnType<typeof setInterval> | null = null;
    let tenantWaitTimer: ReturnType<typeof setTimeout> | null = null;
    let usingLiveSnapshot = false;

    const deliver = (items: T[]) => {
      if (!active) return;
      callback(options?.transform ? options.transform(items) : items);
    };

    const clearTenantWaitTimer = () => {
      if (tenantWaitTimer) {
        clearTimeout(tenantWaitTimer);
        tenantWaitTimer = null;
      }
    };

    const pullViaApi = async () => {
      if (!active || inFlight || !auth.currentUser) return;
      inFlight = true;
      try {
        const items = await crmApiClient.list<T>(collectionName, {
          propertyId: options?.propertyId,
          onlyMine: options?.onlyMine,
          limit: options?.limit,
        });
        deliver(items);
      } catch (err) {
        console.warn(`[crmApiClient] Sync error for ${collectionName}:`, err);
      } finally {
        inFlight = false;
      }
    };

    const stopFallbackPolling = () => {
      if (fallbackTimer) {
        clearInterval(fallbackTimer);
        fallbackTimer = null;
      }
    };

    const startFallbackPolling = () => {
      if (fallbackTimer || !active) return;
      // Gentle 30s fallback ONLY when live onSnapshot isn't active (e.g. preview mode)
      fallbackTimer = setInterval(() => {
        if (!usingLiveSnapshot) {
          void pullViaApi();
        }
      }, 30_000);
    };

    const detachFirestore = () => {
      if (unsubFirestore) {
        try {
          unsubFirestore();
        } catch {
          // ignore cleanup errors
        }
        unsubFirestore = null;
      }
      usingLiveSnapshot = false;
    };

    const attachSubscription = () => {
      if (!active) return;
      detachFirestore();
      clearTenantWaitTimer();

      const currentUser = auth.currentUser;
      if (!currentUser) {
        stopFallbackPolling();
        return;
      }

      const tenantId = activeCrmTenantId;
      const canUseDirectSnapshot = Boolean(tenantId) && !activeCrmPreviewMode;

      if (canUseDirectSnapshot && tenantId) {
        try {
          const colRef = collection(db, "tenants", tenantId, collectionName);
          const constraints: QueryConstraint[] = [];
          if (options?.propertyId) {
            constraints.push(where("propertyId", "==", options.propertyId));
          } else if (collectionName === "notifications" && options?.onlyMine) {
            constraints.push(where("userId", "==", currentUser.uid));
          }
          constraints.push(firestoreLimit(Math.min(2000, Math.max(1, options?.limit ?? 1000))));

          const q = query(colRef, ...constraints);
          usingLiveSnapshot = true;
          stopFallbackPolling();

          unsubFirestore = onSnapshot(
            q,
            (snapshot) => {
              if (!active) return;
              const normalized = snapshot.docs.map((docSnap) => {
                const raw = { id: docSnap.id, ...docSnap.data() };
                const norm = normalizeCrmDocument(raw, collectionName);
                return hydrateEntityTimestamps(norm) as T;
              });
              deliver(sortCrmItems(normalized as any[], collectionName) as unknown as T[]);
            },
            (err) => {
              // If rules deny direct client snapshot before membership doc binds, fall back gracefully to API
              console.warn(`[crmApiClient] Falling back to API sync for ${collectionName}:`, err?.code || err?.message);
              detachFirestore();
              void pullViaApi();
              startFallbackPolling();
            }
          );
          return;
        } catch {
          detachFirestore();
        }
      }

      // While TenantContext is still resolving on initial page load, wait briefly for
      // `brokr:crm-tenant-context-ready` before falling back to API polling so we avoid
      // premature parallel /api/crm/* bursts before tenant membership finishes bootstrapping.
      if (!tenantId && !activeCrmPreviewMode) {
        tenantWaitTimer = setTimeout(() => {
          tenantWaitTimer = null;
          if (!active || usingLiveSnapshot) return;
          void pullViaApi();
          startFallbackPolling();
        }, 1500);
        return;
      }

      // Preview mode or staff legacy merge fallback
      void pullViaApi();
      startFallbackPolling();
    };

    const unsubAuth = auth.onAuthStateChanged((u) => {
      if (!active) return;
      if (u) {
        attachSubscription();
      } else {
        clearTenantWaitTimer();
        detachFirestore();
        stopFallbackPolling();
      }
    });

    const onLocalUpdate = (ev: Event) => {
      const detail = (ev as CustomEvent)?.detail;
      if (!usingLiveSnapshot && (!detail?.collectionName || detail.collectionName === collectionName)) {
        void pullViaApi();
      }
    };

    const onTenantChange = () => {
      attachSubscription();
    };

    if (typeof window !== "undefined") {
      window.addEventListener(CRM_UPDATE_EVENT, onLocalUpdate);
      window.addEventListener("brokr:tenant-changed", onTenantChange);
      window.addEventListener("brokr:crm-tenant-context-ready", onTenantChange);
    }

    if (auth.currentUser) {
      attachSubscription();
    }

    return () => {
      active = false;
      clearTenantWaitTimer();
      detachFirestore();
      stopFallbackPolling();
      unsubAuth();
      if (typeof window !== "undefined") {
        window.removeEventListener(CRM_UPDATE_EVENT, onLocalUpdate);
        window.removeEventListener("brokr:tenant-changed", onTenantChange);
        window.removeEventListener("brokr:crm-tenant-context-ready", onTenantChange);
      }
    };
  },
};

clientDataHub.configureRuntimeHelpers({
  apiListFallback: (collectionName, opts) => crmApiClient.list(collectionName, opts),
  hydrateRecord: hydrateEntityTimestamps,
});
