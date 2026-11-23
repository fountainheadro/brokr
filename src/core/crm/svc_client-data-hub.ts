import {
  collection,
  getDocs,
  limit as firestoreLimit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { auth, db, firestoreCacheMode, type FirestoreCacheMode } from "../../lib/firebase";
import { normalizeCrmDocument } from "./svc_crm-normalizer";
import { clearAllRecentSearches } from "../../utils/recentSearchUtils";
import {
  isSlimSummaryReadsEnabled,
  LEAD_SUMMARY_COLLECTION,
  SHARED_LEADS_SUMMARY_COLLECTION,
  summaryToLeadRecord,
} from "./svc_lead-projection";

export interface DataHubContext {
  tenantId: string | null;
  uid: string | null;
  isPreviewMode: boolean;
}

export interface DataHubQueryOptions<T = Record<string, any>> {
  propertyId?: string;
  onlyMine?: boolean;
  limit?: number;
  transform?: (items: T[]) => T[];
}

export interface DataHubPageOptions {
  pageSize?: number;
  cursor?: unknown;
  propertyId?: string;
  onlyMine?: boolean;
  orderByField?: string;
  orderDirection?: "asc" | "desc";
}

export interface DataHubPageResult<T = Record<string, any>> {
  items: T[];
  nextCursor: unknown | null;
  hasMore: boolean;
  fromCache: boolean;
}

export interface DataHubSyncSnapshot {
  isOnline: boolean;
  isSyncing: boolean;
  fromCache: boolean;
  cacheMode: FirestoreCacheMode;
  activeSlices: number;
  totalSubscribers: number;
  deduplicatedSubscribers: number;
  detailCacheSize: number;
  contextEpoch: number;
  lastSyncedAt: number | null;
  lastError: string | null;
}

export interface DataHubSliceDiagnostic {
  key: string;
  scope: "tenant" | "platform";
  collectionName: string;
  refCount: number;
  itemCount: number;
  source: "firestore" | "api" | "pending";
  fromCache: boolean;
  hasError: boolean;
  lastUpdatedAt: number | null;
}

export interface DataHubDiagnostics extends DataHubSyncSnapshot {
  enabled: boolean;
  slimSummaryReadsEnabled: boolean;
  context: DataHubContext;
  slices: DataHubSliceDiagnostic[];
}

export interface DataHubTransport {
  subscribeCollection: <T>(
    params: {
      scope: "tenant" | "platform";
      tenantId: string | null;
      uid: string | null;
      isPreviewMode: boolean;
      collectionName: string;
      propertyId?: string;
      onlyMine?: boolean;
      limit: number;
    },
    handlers: {
      onData: (items: T[], meta: { fromCache: boolean; source: "firestore" | "api" }) => void;
      onError: (err: Error) => void;
    }
  ) => () => void;
  fetchPage: <T>(params: {
    scope: "tenant" | "platform";
    tenantId: string | null;
    uid: string | null;
    isPreviewMode: boolean;
    collectionName: string;
    pageSize: number;
    cursor?: unknown;
    propertyId?: string;
    onlyMine?: boolean;
    orderByField?: string;
    orderDirection?: "asc" | "desc";
  }) => Promise<DataHubPageResult<T>>;
}

interface SubscriberEntry<T = any> {
  id: number;
  callback: (items: T[]) => void;
  transform?: (items: T[]) => T[];
}

interface ActiveSlice<T = any> {
  key: string;
  scope: "tenant" | "platform";
  collectionName: string;
  propertyId?: string;
  onlyMine?: boolean;
  limit: number;
  epoch: number;
  subscribers: Map<number, SubscriberEntry<T>>;
  items: T[];
  hasInitialData: boolean;
  fromCache: boolean;
  source: "firestore" | "api" | "pending";
  lastUpdatedAt: number | null;
  lastError: string | null;
  unsubscribeTransport: (() => void) | null;
  teardownTimer: ReturnType<typeof setTimeout> | null;
}

interface DetailCacheEntry {
  value: unknown;
  cachedAt: number;
  epoch: number;
  collectionName: string;
}

export interface ClientDataHubOptions {
  maxDetailCacheEntries?: number;
  teardownGraceMs?: number;
  cacheMode?: FirestoreCacheMode;
  apiListFallback?: <T>(
    collectionName: string,
    opts?: { propertyId?: string; onlyMine?: boolean; limit?: number }
  ) => Promise<T[]>;
  hydrateRecord?: <T extends Record<string, any>>(record: T) => T;
}

const DEFAULT_MAX_DETAIL_CACHE = 50;
const DEFAULT_TEARDOWN_GRACE_MS = 2500;
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 2000;

export function isClientDataHubEnabled(): boolean {
  try {
    const viteFlag = (import.meta as any)?.env?.VITE_USE_CLIENT_DATA_HUB;
    if (viteFlag !== undefined) {
      return String(viteFlag).toLowerCase() !== "false";
    }
  } catch {
    // ignore outside Vite
  }
  if (typeof process !== "undefined" && process.env?.VITE_USE_CLIENT_DATA_HUB !== undefined) {
    return String(process.env.VITE_USE_CLIENT_DATA_HUB).toLowerCase() !== "false";
  }
  return true;
}

function defaultSortItems<T extends Record<string, any>>(items: T[], collectionName: string): T[] {
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

export function buildCanonicalQueryHash(params: {
  propertyId?: string;
  onlyMine?: boolean;
  limit: number;
}): string {
  const prop = params.propertyId ? encodeURIComponent(params.propertyId) : "";
  const mine = params.onlyMine ? "1" : "0";
  return `lim=${params.limit}|mine=${mine}|prop=${prop}`;
}

export function resolveEffectiveReadCollection(
  scope: "tenant" | "platform",
  collectionName: string
): { targetCollection: string; isSlimProjection: boolean } {
  if (isSlimSummaryReadsEnabled()) {
    if (scope === "tenant" && collectionName === "leads") {
      return { targetCollection: LEAD_SUMMARY_COLLECTION, isSlimProjection: true };
    }
    if (scope === "platform" && collectionName === "platform_shared_leads") {
      return { targetCollection: SHARED_LEADS_SUMMARY_COLLECTION, isSlimProjection: true };
    }
  }
  return { targetCollection: collectionName, isSlimProjection: false };
}

export function buildCanonicalSliceKey(
  ctx: DataHubContext,
  scope: "tenant" | "platform",
  collectionName: string,
  params: { propertyId?: string; onlyMine?: boolean; limit: number }
): string {
  const scopePrefix = scope === "platform" ? "platform:global" : `tenant:${ctx.tenantId || "none"}`;
  const uidPart = ctx.uid || "anon";
  const modePart = ctx.isPreviewMode ? "preview" : "live";
  const { targetCollection } = resolveEffectiveReadCollection(scope, collectionName);
  const queryHash = buildCanonicalQueryHash(params);
  return `${scopePrefix}::uid:${uidPart}::${modePart}::${targetCollection}::${queryHash}`;
}

export class ClientDataHub {
  private context: DataHubContext = {
    tenantId: null,
    uid: null,
    isPreviewMode: false,
  };
  private contextEpoch = 0;
  private nextSubscriberId = 1;
  private slices = new Map<string, ActiveSlice>();
  private detailCache = new Map<string, DetailCacheEntry>();
  private syncListeners = new Set<(snapshot: DataHubSyncSnapshot) => void>();
  private isOnline = typeof navigator !== "undefined" ? navigator.onLine !== false : true;
  private lastSyncedAt: number | null = null;
  private lastError: string | null = null;
  private readonly maxDetailCacheEntries: number;
  private readonly teardownGraceMs: number;
  private readonly cacheMode: FirestoreCacheMode;
  private transport: DataHubTransport;
  private apiListFallback?: ClientDataHubOptions["apiListFallback"];
  private hydrateRecord?: ClientDataHubOptions["hydrateRecord"];

  constructor(transport?: DataHubTransport, options?: ClientDataHubOptions) {
    this.maxDetailCacheEntries = options?.maxDetailCacheEntries ?? DEFAULT_MAX_DETAIL_CACHE;
    this.teardownGraceMs = options?.teardownGraceMs ?? DEFAULT_TEARDOWN_GRACE_MS;
    this.cacheMode = options?.cacheMode ?? firestoreCacheMode;
    this.apiListFallback = options?.apiListFallback;
    this.hydrateRecord = options?.hydrateRecord;
    this.transport = transport ?? this.createDefaultFirestoreTransport();

    if (typeof window !== "undefined") {
      window.addEventListener("online", this.handleNetworkOnline);
      window.addEventListener("offline", this.handleNetworkOffline);
    }
  }

  public configureRuntimeHelpers(helpers: {
    apiListFallback?: ClientDataHubOptions["apiListFallback"];
    hydrateRecord?: ClientDataHubOptions["hydrateRecord"];
  }): void {
    if (helpers.apiListFallback) this.apiListFallback = helpers.apiListFallback;
    if (helpers.hydrateRecord) this.hydrateRecord = helpers.hydrateRecord;
  }

  private handleNetworkOnline = (): void => {
    this.isOnline = true;
    this.lastError = null;
    this.emitSyncState();
  };

  private handleNetworkOffline = (): void => {
    this.isOnline = false;
    this.emitSyncState();
  };

  private createDefaultFirestoreTransport(): DataHubTransport {
    return {
      subscribeCollection: <T,>(
        params: {
          scope: "tenant" | "platform";
          tenantId: string | null;
          uid: string | null;
          isPreviewMode: boolean;
          collectionName: string;
          propertyId?: string;
          onlyMine?: boolean;
          limit: number;
        },
        handlers: {
          onData: (items: T[], meta: { fromCache: boolean; source: "firestore" | "api" }) => void;
          onError: (err: Error) => void;
        }
      ) => {
        let active = true;
        let unsubSnapshot: (() => void) | null = null;
        let fallbackTimer: ReturnType<typeof setInterval> | null = null;
        let tenantWaitTimer: ReturnType<typeof setTimeout> | null = null;
        let inFlight = false;
        let usingLiveSnapshot = false;

        const hydrate = (rec: any) => (this.hydrateRecord ? this.hydrateRecord(rec) : rec);

        const stopFallback = () => {
          if (fallbackTimer) {
            clearInterval(fallbackTimer);
            fallbackTimer = null;
          }
        };

        const clearWait = () => {
          if (tenantWaitTimer) {
            clearTimeout(tenantWaitTimer);
            tenantWaitTimer = null;
          }
        };

        const detachSnapshot = () => {
          if (unsubSnapshot) {
            try {
              unsubSnapshot();
            } catch {
              // ignore cleanup errors
            }
            unsubSnapshot = null;
          }
          usingLiveSnapshot = false;
        };

        const pullViaApi = async (overrideCollection?: string) => {
          if (!active || inFlight || !params.uid || !this.apiListFallback) return;
          if (params.scope === "platform") return;
          const apiCollection = overrideCollection || params.collectionName;
          inFlight = true;
          try {
            const items = await this.apiListFallback<T>(apiCollection, {
              propertyId: params.propertyId,
              onlyMine: params.onlyMine,
              limit: params.limit,
            });
            if (!active) return;
            const adapted =
              apiCollection === LEAD_SUMMARY_COLLECTION
                ? (items.map((item: any) => summaryToLeadRecord(item)) as unknown as T[])
                : items;
            handlers.onData(adapted, { fromCache: false, source: "api" });
          } catch (err: any) {
            if (!active) return;
            if (apiCollection === LEAD_SUMMARY_COLLECTION) {
              // Safe fallback to canonical leads API if leads_summary is unavailable
              inFlight = false;
              void pullViaApi("leads");
              return;
            }
            handlers.onError(err instanceof Error ? err : new Error(String(err || "Sync API error")));
          } finally {
            inFlight = false;
          }
        };

        const startFallbackPolling = () => {
          if (fallbackTimer || !active || params.scope === "platform") return;
          fallbackTimer = setInterval(() => {
            if (!usingLiveSnapshot && active) {
              void pullViaApi();
            }
          }, 30_000);
        };

        if (!params.uid) {
          return () => {
            active = false;
          };
        }

        if (params.scope === "platform") {
          const isSlimShared = params.collectionName === SHARED_LEADS_SUMMARY_COLLECTION;
          const attachPlatformListener = (targetCol: string, allowCanonicalFallback: boolean) => {
            try {
              const q = query(
                collection(db, targetCol),
                orderBy("createdAt", "desc"),
                firestoreLimit(params.limit)
              );
              usingLiveSnapshot = true;
              unsubSnapshot = onSnapshot(
                q,
                (snapshot) => {
                  if (!active) return;
                  const items = snapshot.docs.map((d) => {
                    const raw = d.data() as Record<string, any>;
                    const base = {
                      ...raw,
                      id: d.id,
                      isSharedLead: true,
                      status: raw.status || "Noi",
                    };
                    return hydrate(
                      targetCol === SHARED_LEADS_SUMMARY_COLLECTION
                        ? summaryToLeadRecord(base as any)
                        : base
                    ) as T;
                  });
                  handlers.onData(items, {
                    fromCache: Boolean(snapshot.metadata?.fromCache),
                    source: "firestore",
                  });
                },
                (err) => {
                  if (!active) return;
                  if (allowCanonicalFallback) {
                    console.warn(
                      `[ClientDataHub] Falling back from ${targetCol} to platform_shared_leads:`,
                      (err as any)?.code || err?.message
                    );
                    detachSnapshot();
                    attachPlatformListener("platform_shared_leads", false);
                    return;
                  }
                  handlers.onError(err instanceof Error ? err : new Error(String(err)));
                }
              );
            } catch (err: any) {
              if (allowCanonicalFallback) {
                attachPlatformListener("platform_shared_leads", false);
                return;
              }
              handlers.onError(err instanceof Error ? err : new Error(String(err)));
            }
          };

          attachPlatformListener(params.collectionName, isSlimShared);

          return () => {
            active = false;
            detachSnapshot();
          };
        }

        const canUseDirectSnapshot = Boolean(params.tenantId) && !params.isPreviewMode;
        const isSlimTenantLeads = params.collectionName === LEAD_SUMMARY_COLLECTION;

        if (canUseDirectSnapshot && params.tenantId) {
          const attachTenantListener = (targetCol: string, allowCanonicalFallback: boolean) => {
            try {
              const colRef = collection(db, "tenants", params.tenantId!, targetCol);
              const constraints: QueryConstraint[] = [];
              if (params.propertyId) {
                constraints.push(where("propertyId", "==", params.propertyId));
              } else if (targetCol === "notifications" && params.onlyMine) {
                constraints.push(where("userId", "==", params.uid));
              }
              constraints.push(firestoreLimit(params.limit));

              const q = query(colRef, ...constraints);
              usingLiveSnapshot = true;
              stopFallback();

              // For canonical "staff", perform a single best-effort client-side read of legacy
              // "personal" records so historical entries merge seamlessly without server REST calls.
              let legacyPersonalDocs: Array<Record<string, any>> = [];
              let latestPrimaryDocs: Array<Record<string, any>> = [];
              let hasPrimarySnapshot = false;
              let lastFromCache = false;

              const emitMerged = () => {
                if (!active || !hasPrimarySnapshot) return;
                const combined = [...latestPrimaryDocs];
                if (targetCol === "staff" && legacyPersonalDocs.length > 0) {
                  const seenIds = new Set(combined.map((d) => d.id));
                  for (const legacyDoc of legacyPersonalDocs) {
                    if (!seenIds.has(legacyDoc.id)) {
                      combined.push(legacyDoc);
                    }
                  }
                }
                const normalized = combined.map((raw) => {
                  if (targetCol === LEAD_SUMMARY_COLLECTION) {
                    return hydrate(summaryToLeadRecord(raw as any)) as T;
                  }
                  const norm =
                    targetCol === "users" ? raw : normalizeCrmDocument(raw, targetCol);
                  return hydrate(norm) as T;
                });
                const sorted =
                  targetCol === "users"
                    ? (normalized as unknown as T[])
                    : (defaultSortItems(normalized as any[], targetCol) as unknown as T[]);
                handlers.onData(sorted, {
                  fromCache: lastFromCache,
                  source: "firestore",
                });
              };

              if (targetCol === "staff") {
                const legacyRef = collection(db, "tenants", params.tenantId!, "personal");
                void getDocs(query(legacyRef, firestoreLimit(Math.min(500, params.limit))))
                  .then((legacySnap) => {
                    if (!active || legacySnap.empty) return;
                    legacyPersonalDocs = legacySnap.docs.map((docSnap) => ({
                      id: docSnap.id,
                      ...docSnap.data(),
                    }));
                    emitMerged();
                  })
                  .catch(() => {
                    // Ignore if legacy "personal" collection is empty or restricted
                  });
              }

              unsubSnapshot = onSnapshot(
                q,
                (snapshot) => {
                  if (!active) return;
                  latestPrimaryDocs = snapshot.docs.map((docSnap) => ({
                    id: docSnap.id,
                    ...docSnap.data(),
                  }));
                  hasPrimarySnapshot = true;
                  lastFromCache = Boolean(snapshot.metadata?.fromCache);
                  emitMerged();
                },
                (err) => {
                  if (!active) return;
                  if (allowCanonicalFallback) {
                    console.warn(
                      `[ClientDataHub] Falling back from ${targetCol} to canonical leads:`,
                      (err as any)?.code || err?.message
                    );
                    detachSnapshot();
                    attachTenantListener("leads", false);
                    return;
                  }
                  console.warn(
                    `[ClientDataHub] Falling back to API sync for ${targetCol}:`,
                    (err as any)?.code || err?.message
                  );
                  detachSnapshot();
                  void pullViaApi(targetCol);
                  startFallbackPolling();
                }
              );
            } catch {
              if (allowCanonicalFallback) {
                detachSnapshot();
                attachTenantListener("leads", false);
                return;
              }
              detachSnapshot();
              void pullViaApi(targetCol);
              startFallbackPolling();
            }
          };

          attachTenantListener(params.collectionName, isSlimTenantLeads);
        } else if (!params.tenantId && !params.isPreviewMode) {
          // Wait briefly for TenantProvider to finish resolving tenantId before hitting API
          tenantWaitTimer = setTimeout(() => {
            tenantWaitTimer = null;
            if (!active || usingLiveSnapshot) return;
            void pullViaApi();
            startFallbackPolling();
          }, 1500);
        } else {
          void pullViaApi();
          startFallbackPolling();
        }

        return () => {
          active = false;
          clearWait();
          detachSnapshot();
          stopFallback();
        };
      },

      fetchPage: async <T,>(params: {
        scope: "tenant" | "platform";
        tenantId: string | null;
        uid: string | null;
        isPreviewMode: boolean;
        collectionName: string;
        pageSize: number;
        cursor?: unknown;
        propertyId?: string;
        onlyMine?: boolean;
        orderByField?: string;
        orderDirection?: "asc" | "desc";
      }): Promise<DataHubPageResult<T>> => {
        const hydrate = (rec: any) => (this.hydrateRecord ? this.hydrateRecord(rec) : rec);
        const safePageSize = Math.min(200, Math.max(1, params.pageSize));

        if (!params.uid) {
          return { items: [], nextCursor: null, hasMore: false, fromCache: false };
        }

        const canUseDirectFirestore =
          params.scope === "platform" ||
          (Boolean(params.tenantId) && !params.isPreviewMode && params.collectionName !== "staff");

        if (canUseDirectFirestore) {
          const colRef =
            params.scope === "platform"
              ? collection(db, params.collectionName)
              : collection(db, "tenants", params.tenantId!, params.collectionName);

          const constraints: QueryConstraint[] = [];
          if (params.propertyId) {
            constraints.push(where("propertyId", "==", params.propertyId));
          } else if (params.collectionName === "notifications" && params.onlyMine) {
            constraints.push(where("userId", "==", params.uid));
          }
          if (params.orderByField) {
            constraints.push(orderBy(params.orderByField, params.orderDirection || "desc"));
          }
          if (params.cursor) {
            constraints.push(startAfter(params.cursor as QueryDocumentSnapshot<DocumentData>));
          }
          constraints.push(firestoreLimit(safePageSize + 1));

          const snap = await getDocs(query(colRef, ...constraints));
          const hasMore = snap.docs.length > safePageSize;
          const pageDocs = hasMore ? snap.docs.slice(0, safePageSize) : snap.docs;
          const items = pageDocs.map((docSnap) => {
            const raw = { id: docSnap.id, ...docSnap.data() };
            if (
              params.collectionName === LEAD_SUMMARY_COLLECTION ||
              params.collectionName === SHARED_LEADS_SUMMARY_COLLECTION
            ) {
              const base =
                params.scope === "platform"
                  ? { ...raw, isSharedLead: true, status: (raw as any).status || "Noi" }
                  : raw;
              return hydrate(summaryToLeadRecord(base as any)) as T;
            }
            const norm =
              params.scope === "platform"
                ? { ...raw, isSharedLead: true, status: (raw as any).status || "Noi" }
                : normalizeCrmDocument(raw, params.collectionName);
            return hydrate(norm) as T;
          });
          const nextCursor = hasMore && pageDocs.length > 0 ? pageDocs[pageDocs.length - 1] : null;
          return {
            items,
            nextCursor,
            hasMore,
            fromCache: Boolean(snap.metadata?.fromCache),
          };
        }

        if (this.apiListFallback) {
          const offset = typeof params.cursor === "number" && params.cursor >= 0 ? params.cursor : 0;
          const all = await this.apiListFallback<T>(params.collectionName, {
            propertyId: params.propertyId,
            onlyMine: params.onlyMine,
            limit: offset + safePageSize + 1,
          });
          const sliced = all.slice(offset, offset + safePageSize);
          const hasMore = all.length > offset + safePageSize;
          return {
            items: sliced,
            nextCursor: hasMore ? offset + safePageSize : null,
            hasMore,
            fromCache: false,
          };
        }

        return { items: [], nextCursor: null, hasMore: false, fromCache: false };
      },
    };
  }

  public getContext(): DataHubContext {
    return { ...this.context };
  }

  public setAuthUser(uid: string | null): void {
    const prevUid = this.context.uid;
    if (prevUid === uid) return;

    // If switching accounts or signing out, purge all in-memory + recent-search caches immediately
    if (prevUid !== null && prevUid !== uid) {
      clearAllRecentSearches();
    }

    this.setContext({
      tenantId: uid ? this.context.tenantId : null,
      uid,
      isPreviewMode: uid ? this.context.isPreviewMode : false,
    });
  }

  public setContext(next: Partial<DataHubContext>): void {
    const resolved: DataHubContext = {
      tenantId: next.tenantId !== undefined ? next.tenantId : this.context.tenantId,
      uid: next.uid !== undefined ? next.uid : this.context.uid,
      isPreviewMode: next.isPreviewMode !== undefined ? next.isPreviewMode : this.context.isPreviewMode,
    };

    const changed =
      resolved.tenantId !== this.context.tenantId ||
      resolved.uid !== this.context.uid ||
      resolved.isPreviewMode !== this.context.isPreviewMode;

    if (!changed) return;

    const tenantSwitched =
      this.context.tenantId !== null &&
      resolved.tenantId !== null &&
      this.context.tenantId !== resolved.tenantId;

    if (tenantSwitched || resolved.uid === null) {
      clearAllRecentSearches();
    }

    this.context = resolved;
    this.contextEpoch += 1;
    this.lastError = null;
    this.detailCache.clear();

    // Re-key and re-attach any currently mounted subscribers under the new context epoch
    const existingSlices = Array.from(this.slices.values());
    this.slices.clear();

    for (const oldSlice of existingSlices) {
      this.teardownSliceTransport(oldSlice);
      if (oldSlice.subscribers.size === 0) continue;

      // Clear stale data immediately when switching users or tenants
      if (!resolved.uid || tenantSwitched) {
        for (const sub of oldSlice.subscribers.values()) {
          try {
            sub.callback([]);
          } catch {
            // ignore consumer callback errors during context reset
          }
        }
      }

      const newKey = buildCanonicalSliceKey(this.context, oldSlice.scope, oldSlice.collectionName, {
        propertyId: oldSlice.propertyId,
        onlyMine: oldSlice.onlyMine,
        limit: oldSlice.limit,
      });

      let targetSlice = this.slices.get(newKey);
      if (!targetSlice) {
        targetSlice = {
          key: newKey,
          scope: oldSlice.scope,
          collectionName: oldSlice.collectionName,
          propertyId: oldSlice.propertyId,
          onlyMine: oldSlice.onlyMine,
          limit: oldSlice.limit,
          epoch: this.contextEpoch,
          subscribers: new Map(),
          items: [],
          hasInitialData: false,
          fromCache: false,
          source: "pending",
          lastUpdatedAt: null,
          lastError: null,
          unsubscribeTransport: null,
          teardownTimer: null,
        };
        this.slices.set(newKey, targetSlice);
      }

      for (const [subId, entry] of oldSlice.subscribers.entries()) {
        targetSlice.subscribers.set(subId, entry);
      }
    }

    if (this.context.uid) {
      for (const slice of this.slices.values()) {
        this.attachSliceTransport(slice);
      }
    }

    this.emitSyncState();
  }

  public purgeAllCaches(): void {
    this.contextEpoch += 1;
    this.detailCache.clear();
    this.lastError = null;
    clearAllRecentSearches();

    for (const slice of this.slices.values()) {
      this.teardownSliceTransport(slice);
      slice.items = [];
      slice.hasInitialData = false;
      for (const sub of slice.subscribers.values()) {
        try {
          sub.callback([]);
        } catch {
          // ignore
        }
      }
    }
    this.slices.clear();
    this.context = {
      tenantId: null,
      uid: null,
      isPreviewMode: false,
    };
    this.emitSyncState();
  }

  public subscribeCollection<T = Record<string, any>>(
    collectionName: string,
    callback: (items: T[]) => void,
    options?: DataHubQueryOptions<T>,
    scope: "tenant" | "platform" = "tenant"
  ): () => void {
    // Sync current Firebase auth UID lazily if auth initialized before setAuthUser ran
    if (!this.context.uid && auth?.currentUser?.uid) {
      this.context = { ...this.context, uid: auth.currentUser.uid };
    }

    const normalizedLimit = Math.min(MAX_LIMIT, Math.max(1, options?.limit ?? DEFAULT_LIMIT));
    const sliceKey = buildCanonicalSliceKey(this.context, scope, collectionName, {
      propertyId: options?.propertyId,
      onlyMine: options?.onlyMine,
      limit: normalizedLimit,
    });

    let slice = this.slices.get(sliceKey);
    if (!slice) {
      slice = {
        key: sliceKey,
        scope,
        collectionName,
        propertyId: options?.propertyId,
        onlyMine: options?.onlyMine,
        limit: normalizedLimit,
        epoch: this.contextEpoch,
        subscribers: new Map(),
        items: [],
        hasInitialData: false,
        fromCache: false,
        source: "pending",
        lastUpdatedAt: null,
        lastError: null,
        unsubscribeTransport: null,
        teardownTimer: null,
      };
      this.slices.set(sliceKey, slice);
    } else if (slice.teardownTimer) {
      clearTimeout(slice.teardownTimer);
      slice.teardownTimer = null;
    }

    const subId = this.nextSubscriberId++;
    const subEntry: SubscriberEntry<T> = {
      id: subId,
      callback,
      transform: options?.transform,
    };
    slice.subscribers.set(subId, subEntry);

    // Warm delivery from shared slice cache immediately (0 extra Firestore reads)
    if (slice.hasInitialData) {
      this.deliverToSubscriber(subEntry, slice.items);
    }

    if (!slice.unsubscribeTransport && this.context.uid) {
      this.attachSliceTransport(slice);
    }

    this.emitSyncState();

    return () => {
      // Subscriber may have been moved to a new key during a context switch
      for (const activeSlice of this.slices.values()) {
        if (activeSlice.subscribers.delete(subId)) {
          if (activeSlice.subscribers.size === 0) {
            this.scheduleSliceTeardown(activeSlice);
          }
          break;
        }
      }
      this.emitSyncState();
    };
  }

  public subscribePlatformSharedLeads<T = Record<string, any>>(
    callback: (items: T[]) => void,
    options?: Omit<DataHubQueryOptions<T>, "propertyId" | "onlyMine">
  ): () => void {
    return this.subscribeCollection<T>("platform_shared_leads", callback, options, "platform");
  }

  public notifyMutation(collectionName: string, docId?: string): void {
    if (docId) {
      this.invalidateDocument(collectionName, docId);
    } else {
      this.invalidateCollection(collectionName);
    }

    const { targetCollection } = resolveEffectiveReadCollection("tenant", collectionName);

    // Re-pull any API-backed slices for this collection (Firestore onSnapshot updates automatically)
    for (const slice of this.slices.values()) {
      if (
        (slice.collectionName === collectionName || slice.collectionName === targetCollection) &&
        slice.source === "api" &&
        slice.subscribers.size > 0
      ) {
        this.teardownSliceTransport(slice);
        this.attachSliceTransport(slice);
      }
    }
  }

  public async getDocumentById<T = Record<string, any>>(
    collectionName: string,
    id: string,
    fetcher: () => Promise<T | null>
  ): Promise<T | null> {
    if (!id) return null;
    const epochAtStart = this.contextEpoch;
    const cacheKey = this.buildDetailKey(collectionName, id);

    const cached = this.detailCache.get(cacheKey);
    if (cached && cached.epoch === epochAtStart) {
      // Promote LRU entry to most-recently-used position
      this.detailCache.delete(cacheKey);
      this.detailCache.set(cacheKey, cached);
      return cached.value as T;
    }

    const result = await fetcher();
    // Epoch fencing: discard stale async responses if context changed while in-flight
    if (this.contextEpoch !== epochAtStart) {
      return null;
    }

    if (result !== null && result !== undefined) {
      this.setDetailCache(cacheKey, {
        value: result,
        cachedAt: Date.now(),
        epoch: epochAtStart,
        collectionName,
      });
    }
    return result;
  }

  public invalidateDocument(collectionName: string, id: string): void {
    const cacheKey = this.buildDetailKey(collectionName, id);
    if (this.detailCache.delete(cacheKey)) {
      this.emitSyncState();
    }
  }

  public invalidateCollection(collectionName: string): void {
    let removed = false;
    for (const [key, entry] of this.detailCache.entries()) {
      if (entry.collectionName === collectionName) {
        this.detailCache.delete(key);
        removed = true;
      }
    }
    if (removed) {
      this.emitSyncState();
    }
  }

  public async fetchCollectionPage<T = Record<string, any>>(
    collectionName: string,
    options?: DataHubPageOptions,
    scope: "tenant" | "platform" = "tenant"
  ): Promise<DataHubPageResult<T>> {
    if (!this.context.uid && auth?.currentUser?.uid) {
      this.context = { ...this.context, uid: auth.currentUser.uid };
    }
    const epochAtStart = this.contextEpoch;
    const { targetCollection } = resolveEffectiveReadCollection(scope, collectionName);
    const page = await this.transport.fetchPage<T>({
      scope,
      tenantId: this.context.tenantId,
      uid: this.context.uid,
      isPreviewMode: this.context.isPreviewMode,
      collectionName: targetCollection,
      pageSize: options?.pageSize ?? 50,
      cursor: options?.cursor,
      propertyId: options?.propertyId,
      onlyMine: options?.onlyMine,
      orderByField: options?.orderByField,
      orderDirection: options?.orderDirection,
    });
    if (this.contextEpoch !== epochAtStart) {
      return { items: [], nextCursor: null, hasMore: false, fromCache: false };
    }
    return page;
  }

  public retryFailedSlices(): void {
    this.lastError = null;
    for (const slice of this.slices.values()) {
      if (slice.lastError && slice.subscribers.size > 0 && this.context.uid) {
        slice.lastError = null;
        this.teardownSliceTransport(slice);
        this.attachSliceTransport(slice);
      }
    }
    this.emitSyncState();
  }

  public subscribeSyncState(listener: (snapshot: DataHubSyncSnapshot) => void): () => void {
    this.syncListeners.add(listener);
    listener(this.getSyncSnapshot());
    return () => {
      this.syncListeners.delete(listener);
    };
  }

  public getSyncSnapshot(): DataHubSyncSnapshot {
    let totalSubscribers = 0;
    let activeSlices = 0;
    let anyFromCache = false;
    let anySyncing = false;
    let firstError: string | null = this.lastError;

    for (const slice of this.slices.values()) {
      if (slice.subscribers.size > 0) {
        activeSlices += 1;
        totalSubscribers += slice.subscribers.size;
        if (slice.fromCache) anyFromCache = true;
        if (!slice.hasInitialData && !slice.lastError && this.context.uid) anySyncing = true;
        if (!firstError && slice.lastError) firstError = slice.lastError;
      }
    }

    return {
      isOnline: this.isOnline,
      isSyncing: anySyncing,
      fromCache: anyFromCache,
      cacheMode: this.cacheMode,
      activeSlices,
      totalSubscribers,
      deduplicatedSubscribers: Math.max(0, totalSubscribers - activeSlices),
      detailCacheSize: this.detailCache.size,
      contextEpoch: this.contextEpoch,
      lastSyncedAt: this.lastSyncedAt,
      lastError: firstError,
    };
  }

  public getDiagnostics(): DataHubDiagnostics {
    const sync = this.getSyncSnapshot();
    const slices: DataHubSliceDiagnostic[] = [];
    for (const slice of this.slices.values()) {
      slices.push({
        key: slice.key,
        scope: slice.scope,
        collectionName: slice.collectionName,
        refCount: slice.subscribers.size,
        itemCount: slice.items.length,
        source: slice.source,
        fromCache: slice.fromCache,
        hasError: Boolean(slice.lastError),
        lastUpdatedAt: slice.lastUpdatedAt,
      });
    }
    return {
      ...sync,
      enabled: isClientDataHubEnabled(),
      slimSummaryReadsEnabled: isSlimSummaryReadsEnabled(),
      context: this.getContext(),
      slices,
    };
  }

  private buildDetailKey(collectionName: string, id: string): string {
    const modePart = this.context.isPreviewMode ? "preview" : "live";
    return `${this.context.tenantId || "none"}::${this.context.uid || "anon"}::${modePart}::${collectionName}::${id}`;
  }

  private setDetailCache(key: string, entry: DetailCacheEntry): void {
    if (this.detailCache.has(key)) {
      this.detailCache.delete(key);
    }
    this.detailCache.set(key, entry);
    while (this.detailCache.size > this.maxDetailCacheEntries) {
      const oldestKey = this.detailCache.keys().next().value;
      if (oldestKey === undefined) break;
      this.detailCache.delete(oldestKey);
    }
    this.emitSyncState();
  }

  private attachSliceTransport(slice: ActiveSlice, forceCanonicalFallback = false): void {
    if (slice.unsubscribeTransport || !this.context.uid) return;
    const attachedEpoch = this.contextEpoch;
    slice.epoch = attachedEpoch;

    const resolved = forceCanonicalFallback
      ? { targetCollection: slice.collectionName, isSlimProjection: false }
      : resolveEffectiveReadCollection(slice.scope, slice.collectionName);

    slice.unsubscribeTransport = this.transport.subscribeCollection(
      {
        scope: slice.scope,
        tenantId: this.context.tenantId,
        uid: this.context.uid,
        isPreviewMode: this.context.isPreviewMode,
        collectionName: resolved.targetCollection,
        propertyId: slice.propertyId,
        onlyMine: slice.onlyMine,
        limit: slice.limit,
      },
      {
        onData: (items, meta) => {
          // Fence against stale callbacks from a prior tenant/user epoch
          if (this.contextEpoch !== attachedEpoch) return;
          if (this.slices.get(slice.key) !== slice) return;

          const adaptedItems = resolved.isSlimProjection
            ? items.map((item) => summaryToLeadRecord(item as any))
            : items;

          slice.items = adaptedItems;
          slice.hasInitialData = true;
          slice.fromCache = meta.fromCache;
          slice.source = meta.source;
          slice.lastError = null;
          slice.lastUpdatedAt = Date.now();
          this.lastSyncedAt = slice.lastUpdatedAt;

          for (const sub of slice.subscribers.values()) {
            this.deliverToSubscriber(sub, adaptedItems);
          }
          this.emitSyncState();
        },
        onError: (err) => {
          if (this.contextEpoch !== attachedEpoch) return;
          if (this.slices.get(slice.key) !== slice) return;

          // Safe Phase 2 fallback: if slim summary stream fails (e.g. missing index/rules),
          // transparently detach and re-attach to the canonical collection once.
          if (resolved.isSlimProjection && !forceCanonicalFallback) {
            this.teardownSliceTransport(slice);
            this.attachSliceTransport(slice, true);
            return;
          }

          slice.lastError = err.message || "Eroare de sincronizare date.";
          this.emitSyncState();
        },
      }
    );
  }

  private scheduleSliceTeardown(slice: ActiveSlice): void {
    if (slice.teardownTimer) {
      clearTimeout(slice.teardownTimer);
      slice.teardownTimer = null;
    }

    const finalize = () => {
      slice.teardownTimer = null;
      if (slice.subscribers.size === 0) {
        this.teardownSliceTransport(slice);
        if (this.slices.get(slice.key) === slice) {
          this.slices.delete(slice.key);
        }
        this.emitSyncState();
      }
    };

    if (this.teardownGraceMs <= 0) {
      finalize();
    } else {
      slice.teardownTimer = setTimeout(finalize, this.teardownGraceMs);
    }
  }

  private teardownSliceTransport(slice: ActiveSlice): void {
    if (slice.teardownTimer) {
      clearTimeout(slice.teardownTimer);
      slice.teardownTimer = null;
    }
    if (slice.unsubscribeTransport) {
      try {
        slice.unsubscribeTransport();
      } catch {
        // ignore unsubscribe errors
      }
      slice.unsubscribeTransport = null;
    }
  }

  private deliverToSubscriber<T>(sub: SubscriberEntry<T>, items: T[]): void {
    try {
      const payload = sub.transform ? sub.transform(items) : items;
      sub.callback(payload);
    } catch (err) {
      console.warn("[ClientDataHub] Subscriber callback error:", err);
    }
  }

  private emitSyncState(): void {
    const snap = this.getSyncSnapshot();
    for (const listener of this.syncListeners) {
      try {
        listener(snap);
      } catch {
        // ignore listener errors
      }
    }
  }
}

export const clientDataHub = new ClientDataHub();

// Expose read-only diagnostics handle on window in browser for verification & monitoring
if (typeof window !== "undefined") {
  (window as any).__BROKR_DATA_HUB__ = {
    getDiagnostics: () => clientDataHub.getDiagnostics(),
    getSyncSnapshot: () => clientDataHub.getSyncSnapshot(),
  };
}
