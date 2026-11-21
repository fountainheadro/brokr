export type RecentSearchScope = "global" | "Lead-uri" | "Cereri" | "Proprietati";

export type RecentSearchEntityType =
  | "text"
  | "lead"
  | "cerere"
  | "property"
  | "contact"
  | "personal"
  | "document"
  | "activity";

export interface RecentSearchEntry {
  id: string;
  kind: RecentSearchEntityType;
  label: string;
  subtitle?: string;
  entityId?: string;
  badge?: string;
  queryText?: string;
  timestamp: number;
}

const MAX_RECENT_ITEMS = 8;
const STORAGE_PREFIX = "brokr_recent_searches_v1";

function buildStorageKey(scope: RecentSearchScope): string {
  return `${STORAGE_PREFIX}:${scope}`;
}

export function getRecentSearches(scope: RecentSearchScope): RecentSearchEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(buildStorageKey(scope));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is RecentSearchEntry =>
          item &&
          typeof item === "object" &&
          typeof item.id === "string" &&
          typeof item.kind === "string" &&
          typeof item.label === "string" &&
          item.label.trim().length > 0
      )
      .slice(0, MAX_RECENT_ITEMS);
  } catch {
    return [];
  }
}

export function saveRecentSearch(
  scope: RecentSearchScope,
  entry: Omit<RecentSearchEntry, "timestamp">
): RecentSearchEntry[] {
  const cleanLabel = entry.label.trim();
  if (!cleanLabel) return getRecentSearches(scope);

  const nextItem: RecentSearchEntry = {
    ...entry,
    label: cleanLabel,
    subtitle: entry.subtitle?.trim() || undefined,
    badge: entry.badge?.trim() || undefined,
    queryText: entry.queryText?.trim() || undefined,
    timestamp: Date.now(),
  };

  const existing = getRecentSearches(scope).filter((item) => item.id !== nextItem.id);
  const updated = [nextItem, ...existing].slice(0, MAX_RECENT_ITEMS);

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(buildStorageKey(scope), JSON.stringify(updated));
    } catch {
      // Ignore storage quota errors
    }
  }
  return updated;
}

export function saveRecentFreeTextSearch(
  scope: RecentSearchScope,
  rawQuery: string
): RecentSearchEntry[] {
  const trimmed = rawQuery.trim();
  if (trimmed.length < 2) return getRecentSearches(scope);
  const normalizedKey = trimmed.toLowerCase().replace(/\s+/g, " ");
  return saveRecentSearch(scope, {
    id: `text:${normalizedKey}`,
    kind: "text",
    label: trimmed,
    queryText: trimmed,
  });
}

export function removeRecentSearch(
  scope: RecentSearchScope,
  entryId: string
): RecentSearchEntry[] {
  const updated = getRecentSearches(scope).filter((item) => item.id !== entryId);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(buildStorageKey(scope), JSON.stringify(updated));
    } catch {
      // Ignore storage errors
    }
  }
  return updated;
}

export function clearRecentSearches(scope: RecentSearchScope): RecentSearchEntry[] {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(buildStorageKey(scope));
    } catch {
      // Ignore storage errors
    }
  }
  return [];
}
