import { useCallback, useEffect, useRef, useState } from "react";
import {
  clientDataHub,
  type DataHubPageOptions,
  type DataHubQueryOptions,
  type DataHubSyncSnapshot,
} from "./svc_client-data-hub";

export interface UseCrmCollectionResult<T> {
  items: T[];
  isLoading: boolean;
  fromCache: boolean;
  error: string | null;
}

export function useCrmCollection<T = Record<string, any>>(
  collectionName: string,
  options?: DataHubQueryOptions<T> & { enabled?: boolean; scope?: "tenant" | "platform" }
): UseCrmCollectionResult<T> {
  const enabled = options?.enabled !== false;
  const scope = options?.scope ?? "tenant";
  const [items, setItems] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(enabled);
  const [fromCache, setFromCache] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const transformRef = useRef(options?.transform);
  transformRef.current = options?.transform;

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    const unsub = clientDataHub.subscribeCollection<T>(
      collectionName,
      (nextItems) => {
        setItems(nextItems);
        setIsLoading(false);
        const snap = clientDataHub.getSyncSnapshot();
        setFromCache(snap.fromCache);
        setError(snap.lastError);
      },
      {
        propertyId: options?.propertyId,
        onlyMine: options?.onlyMine,
        limit: options?.limit,
        transform: transformRef.current ? (list) => transformRef.current!(list) : undefined,
      },
      scope
    );

    return () => {
      unsub();
    };
  }, [collectionName, enabled, scope, options?.propertyId, options?.onlyMine, options?.limit]);

  return { items, isLoading, fromCache, error };
}

export interface UseCrmDetailResult<T> {
  item: T | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useCrmDetail<T = Record<string, any>>(
  collectionName: string,
  id: string | null | undefined,
  fetcher: () => Promise<T | null>
): UseCrmDetailResult<T> {
  const [item, setItem] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(id));
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(
    async (bypassCache = false) => {
      if (!id) {
        setItem(null);
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      setError(null);
      try {
        if (bypassCache) {
          clientDataHub.invalidateDocument(collectionName, id);
        }
        const resolved = await clientDataHub.getDocumentById<T>(collectionName, id, () =>
          fetcherRef.current()
        );
        setItem(resolved);
      } catch (err: any) {
        setError(err?.message || "Eroare la încărcarea detaliilor.");
      } finally {
        setIsLoading(false);
      }
    },
    [collectionName, id]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const refresh = useCallback(async () => {
    await load(true);
  }, [load]);

  return { item, isLoading, error, refresh };
}

export interface UsePaginatedCrmCollectionResult<T> {
  items: T[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  fromCache: boolean;
  error: string | null;
  loadMore: () => Promise<void>;
  reset: () => Promise<void>;
}

export function usePaginatedCrmCollection<T = Record<string, any>>(
  collectionName: string,
  options?: Omit<DataHubPageOptions, "cursor"> & { enabled?: boolean; scope?: "tenant" | "platform" }
): UsePaginatedCrmCollectionResult<T> {
  const enabled = options?.enabled !== false;
  const scope = options?.scope ?? "tenant";
  const pageSize = options?.pageSize ?? 50;

  const [items, setItems] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(enabled);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [fromCache, setFromCache] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const cursorRef = useRef<unknown | null>(null);

  const loadFirstPage = useCallback(async () => {
    if (!enabled) return;
    setIsLoading(true);
    setError(null);
    cursorRef.current = null;
    try {
      const page = await clientDataHub.fetchCollectionPage<T>(
        collectionName,
        {
          pageSize,
          propertyId: options?.propertyId,
          onlyMine: options?.onlyMine,
          orderByField: options?.orderByField,
          orderDirection: options?.orderDirection,
        },
        scope
      );
      setItems(page.items);
      cursorRef.current = page.nextCursor;
      setHasMore(page.hasMore);
      setFromCache(page.fromCache);
    } catch (err: any) {
      setError(err?.message || "Eroare la încărcarea listei.");
    } finally {
      setIsLoading(false);
    }
  }, [
    collectionName,
    enabled,
    pageSize,
    scope,
    options?.propertyId,
    options?.onlyMine,
    options?.orderByField,
    options?.orderDirection,
  ]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (!hasMore || isLoadingMore || cursorRef.current === null) return;
    setIsLoadingMore(true);
    setError(null);
    try {
      const page = await clientDataHub.fetchCollectionPage<T>(
        collectionName,
        {
          pageSize,
          cursor: cursorRef.current,
          propertyId: options?.propertyId,
          onlyMine: options?.onlyMine,
          orderByField: options?.orderByField,
          orderDirection: options?.orderDirection,
        },
        scope
      );
      setItems((prev) => [...prev, ...page.items]);
      cursorRef.current = page.nextCursor;
      setHasMore(page.hasMore);
      setFromCache(page.fromCache);
    } catch (err: any) {
      setError(err?.message || "Eroare la încărcarea paginii următoare.");
    } finally {
      setIsLoadingMore(false);
    }
  }, [
    collectionName,
    hasMore,
    isLoadingMore,
    pageSize,
    scope,
    options?.propertyId,
    options?.onlyMine,
    options?.orderByField,
    options?.orderDirection,
  ]);

  return {
    items,
    isLoading,
    isLoadingMore,
    hasMore,
    fromCache,
    error,
    loadMore,
    reset: loadFirstPage,
  };
}

export function useDataHubSyncState(): DataHubSyncSnapshot {
  const [snapshot, setSnapshot] = useState<DataHubSyncSnapshot>(() =>
    clientDataHub.getSyncSnapshot()
  );

  useEffect(() => {
    return clientDataHub.subscribeSyncState((next) => {
      setSnapshot(next);
    });
  }, []);

  return snapshot;
}
