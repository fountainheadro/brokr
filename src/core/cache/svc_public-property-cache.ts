/**
 * Server-side RAM cache + in-flight request coalescing for public share property lookups.
 *
 * Eliminates redundant Firestore reads across `/share/:id`, `/api/public-property/:id`,
 * and `/api/og-image/:id`, while supporting instant invalidation on any property/lead/media
 * mutation so edits always appear immediately with 0% functionality impact.
 */

export class FirestoreQuotaExceededError extends Error {
  public readonly statusCode = 503;
  public readonly code = "FIRESTORE_QUOTA_EXCEEDED";

  constructor(
    message = "Serviciul de date este temporar indisponibil (limită zilnică atinsă). Te rugăm să încerci din nou mai târziu."
  ) {
    super(message);
    this.name = "FirestoreQuotaExceededError";
  }
}

export function isFirestoreQuotaError(err: any): boolean {
  if (!err) return false;
  if (err instanceof FirestoreQuotaExceededError) return true;
  if (err?.code === "FIRESTORE_QUOTA_EXCEEDED") return true;

  const status = err?.response?.status ?? err?.status ?? err?.statusCode;
  if (status === 429) return true;

  const errStatus = String(
    err?.response?.data?.error?.status || err?.code || ""
  ).toUpperCase();
  if (errStatus.includes("RESOURCE_EXHAUSTED") || errStatus.includes("RESOURCE-EXHAUSTED")) {
    return true;
  }

  const msg = String(
    err?.response?.data?.error?.message || err?.message || ""
  ).toLowerCase();
  if (
    msg.includes("quota exceeded") ||
    msg.includes("quota limit exceeded") ||
    msg.includes("resource_exhausted") ||
    msg.includes("resource-exhausted")
  ) {
    return true;
  }

  return false;
}

interface CachedPropertyEntry {
  property: any | null;
  expiresAt: number;
  aliases: Set<string>;
  scope: string;
}

const DEFAULT_TTL_MS = 3 * 60 * 1000; // 3 minutes for found properties
const NEGATIVE_TTL_MS = 15 * 1000; // 15 seconds for genuine 404s (never caches 429/5xx errors)
const MAX_ENTRIES = 500;

function normalizeIdToken(raw: unknown): string {
  return String(raw || "").trim().toUpperCase();
}

function buildCacheKey(id: string, preferredTenantId?: string | null): string {
  const scope = preferredTenantId ? String(preferredTenantId).trim() : "global";
  return `${scope}::${normalizeIdToken(id)}`;
}

export class PublicPropertyCacheService {
  private static cache = new Map<string, CachedPropertyEntry>();
  private static pendingFetches = new Map<string, Promise<any | null>>();
  private static invalidationGeneration = 0;

  public static async getOrFetch(
    id: string,
    preferredTenantId: string | null | undefined,
    fetcher: () => Promise<any | null>,
    options?: { bypassCache?: boolean; ttlMs?: number; negativeTtlMs?: number }
  ): Promise<any | null> {
    const cleanId = String(id || "").trim();
    if (!cleanId) return null;

    const scope = preferredTenantId ? String(preferredTenantId).trim() : "global";
    const cacheKey = buildCacheKey(cleanId, preferredTenantId);
    const now = Date.now();

    if (!options?.bypassCache) {
      const hit = this.cache.get(cacheKey);
      if (hit) {
        if (now < hit.expiresAt) {
          return hit.property;
        }
        this.cache.delete(cacheKey);
      }

      const inFlight = this.pendingFetches.get(cacheKey);
      if (inFlight) {
        return inFlight;
      }
    }

    const startGeneration = this.invalidationGeneration;
    const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
    const negativeTtlMs = options?.negativeTtlMs ?? NEGATIVE_TTL_MS;

    const runPromise = (async () => {
      const property = await fetcher();

      // Only populate cache if no invalidation occurred while this lookup was in flight
      if (this.invalidationGeneration === startGeneration) {
        if (this.cache.size >= MAX_ENTRIES) {
          const oldestKey = this.cache.keys().next().value;
          if (oldestKey !== undefined) {
            this.cache.delete(oldestKey);
          }
        }

        const aliases = new Set<string>();
        const normInput = normalizeIdToken(cleanId);
        if (normInput) aliases.add(normInput);
        if (property) {
          for (const aliasField of [
            property.id,
            property.propertyId,
            property.sourcePropertyId,
            property.shareCode,
            property.sourceDocId,
          ]) {
            const norm = normalizeIdToken(aliasField);
            if (norm) aliases.add(norm);
          }
        }

        this.cache.set(cacheKey, {
          property,
          expiresAt: Date.now() + (property ? ttlMs : negativeTtlMs),
          aliases,
          scope,
        });
      }

      return property;
    })();

    if (!options?.bypassCache) {
      this.pendingFetches.set(cacheKey, runPromise);
    }

    try {
      return await runPromise;
    } finally {
      if (this.pendingFetches.get(cacheKey) === runPromise) {
        this.pendingFetches.delete(cacheKey);
      }
    }
  }

  /**
   * Immediately busts cached entries for specific property IDs / share codes (or an entire tenant / all).
   * Increments generation counter so concurrent in-flight lookups started before the mutation never repopulate stale data.
   */
  public static invalidate(
    ids?: string | string[] | null,
    tenantId?: string | null
  ): number {
    this.invalidationGeneration += 1;

    const idList = Array.isArray(ids)
      ? ids.map(normalizeIdToken).filter(Boolean)
      : typeof ids === "string" && ids.trim()
        ? [normalizeIdToken(ids)]
        : [];

    if (idList.length === 0) {
      if (tenantId) {
        let removed = 0;
        for (const [key, entry] of this.cache.entries()) {
          if (entry.scope === tenantId || entry.scope === "global") {
            this.cache.delete(key);
            removed++;
          }
        }
        return removed;
      }
      const count = this.cache.size;
      this.cache.clear();
      this.pendingFetches.clear();
      return count;
    }

    const targetSet = new Set(idList);
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      let matched = false;
      for (const target of targetSet) {
        if (entry.aliases.has(target) || key.endsWith(`::${target}`)) {
          matched = true;
          break;
        }
      }
      if (matched) {
        this.cache.delete(key);
        removed++;
      }
    }

    for (const key of Array.from(this.pendingFetches.keys())) {
      for (const target of targetSet) {
        if (key.endsWith(`::${target}`)) {
          this.pendingFetches.delete(key);
          break;
        }
      }
    }

    return removed;
  }

  public static clearAll(): void {
    this.invalidationGeneration += 1;
    this.cache.clear();
    this.pendingFetches.clear();
  }

  public static getStats(): { size: number; pendingCount: number } {
    return {
      size: this.cache.size,
      pendingCount: this.pendingFetches.size,
    };
  }
}
