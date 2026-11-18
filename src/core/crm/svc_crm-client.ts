import { auth } from "../../lib/firebase";

const TS_KEYS = new Set(["createdAt", "updatedAt", "lastMovedAt", "deletedAt", "created_at", "updated_at"]);

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

export const crmApiClient = {
  async list<T = Record<string, any>>(
    collectionName: string,
    query?: { propertyId?: string; onlyMine?: boolean }
  ): Promise<T[]> {
    const params = new URLSearchParams();
    if (query?.propertyId) params.set("propertyId", query.propertyId);
    if (query?.onlyMine) params.set("onlyMine", "true");
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

  async getById<T = Record<string, any>>(collectionName: string, id: string): Promise<T | null> {
    if (!auth.currentUser) return null;
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
    if (collectionName === "activities") {
      emitCrmCollectionUpdated("tours");
      emitCrmCollectionUpdated("viewings");
    } else if (collectionName === "staff") {
      emitCrmCollectionUpdated("personal");
    } else if (collectionName === "personal") {
      emitCrmCollectionUpdated("staff");
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
    if (collectionName === "staff") emitCrmCollectionUpdated("personal");
    if (collectionName === "personal") emitCrmCollectionUpdated("staff");
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
    if (collectionName === "staff") emitCrmCollectionUpdated("personal");
    if (collectionName === "personal") emitCrmCollectionUpdated("staff");
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
    await fetch(`/api/crm/fcm-tokens`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  },

  async deleteFcmToken(token: string): Promise<void> {
    const headers = await buildAuthHeaders();
    await fetch(`/api/crm/fcm-tokens/${encodeURIComponent(token)}`, {
      method: "DELETE",
      headers,
    });
  },

  /**
   * Provides reactive subscribe semantics matching Firestore onSnapshot:
   * - Fetches immediately when authenticated
   * - Re-fetches immediately on local CRM mutations & tenant preview changes
   * - Polls gently (every 4s) for multi-user remote updates
   */
  subscribe<T = Record<string, any>>(
    collectionName: string,
    callback: (items: T[]) => void,
    options?: { propertyId?: string; onlyMine?: boolean; transform?: (items: T[]) => T[] }
  ): () => void {
    let active = true;
    let inFlight = false;

    const pull = async () => {
      if (!active || inFlight || !auth.currentUser) return;
      inFlight = true;
      try {
        const items = await crmApiClient.list<T>(collectionName, {
          propertyId: options?.propertyId,
          onlyMine: options?.onlyMine,
        });
        if (active) {
          callback(options?.transform ? options.transform(items) : items);
        }
      } catch (err) {
        console.warn(`[crmApiClient] Poll error for ${collectionName}:`, err);
      } finally {
        inFlight = false;
      }
    };

    const unsubAuth = auth.onAuthStateChanged((u) => {
      if (u && active) void pull();
    });

    const onLocalUpdate = (ev: Event) => {
      const detail = (ev as CustomEvent)?.detail;
      if (!detail?.collectionName || detail.collectionName === collectionName) {
        void pull();
      }
    };

    const onTenantChange = () => {
      void pull();
    };

    if (typeof window !== "undefined") {
      window.addEventListener(CRM_UPDATE_EVENT, onLocalUpdate);
      window.addEventListener("brokr:tenant-changed", onTenantChange);
    }

    if (auth.currentUser) {
      void pull();
    }

    const timer = setInterval(() => {
      void pull();
    }, 4000);

    return () => {
      active = false;
      clearInterval(timer);
      unsubAuth();
      if (typeof window !== "undefined") {
        window.removeEventListener(CRM_UPDATE_EVENT, onLocalUpdate);
        window.removeEventListener("brokr:tenant-changed", onTenantChange);
      }
    };
  },
};
