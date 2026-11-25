import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  where,
  limit,
  writeBatch,
  runTransaction,
} from "firebase/firestore";
import { auth, db, handleFirestoreError, OperationType } from "../lib/firebase";
import {
  DEFAULT_OLX_LEAD_FILTERS,
  type OlxLeadFilters,
} from "../utils/olxFilterUtils";
import {
  DEFAULT_OLX_MIN_AD_AGE_HOURS,
  DEFAULT_OLX_MAX_AD_AGE_HOURS,
  OLX_MAX_AGE_STEPS,
} from "../components/OlxLeadDrawer";
import { hydrateEntityTimestamps } from "../core/crm/svc_crm-client";
import { clientDataHub, isClientDataHubEnabled } from "../core/crm/svc_client-data-hub";
import { getApiAuthHeaders } from "../lib/apiAuth";
import { resolveAreaFromAd } from "../utils/zoneResolutionUtils";
import { syncPublicShareSnapshotsBatch } from "./publicShareService";
import {
  formatDailyLeadId,
  getDailyLeadDateKey,
  getMaxDailyLeadSequenceForDate,
  isDailyLeadId,
} from "../utils/leadIdUtils";
import { CrawlBlockedError } from "../utils/importPropertyFromCrawl";
import type { Lead } from "./leadsService";

export const SHARED_LEADS_COLLECTION = "platform_shared_leads";
export const AUTO_CRAWL_CONFIG_COLLECTION = "platform_auto_crawl";
export const AUTO_CRAWL_CONFIG_DOC_ID = "global_config";
export const AUTO_CRAWL_COUNTERS_DOC_ID = "counters";

export interface AutoCrawlScanNotice {
  type: "info" | "error" | "success";
  title: string;
  message: string;
  timestamp: number;
}

export interface PlatformAutoCrawlConfig {
  filters: OlxLeadFilters;
  scanIntervalMinutes: number;
  scanLimit: number;
  minAdAgeHours: number;
  maxAdAgeHours: number;
  lastScanAt: number | null;
  lastScanNotice: AutoCrawlScanNotice | null;
  updatedBy?: string;
  updatedAt?: string;
}

export const DEFAULT_PLATFORM_AUTO_CRAWL_CONFIG: PlatformAutoCrawlConfig = {
  filters: { ...DEFAULT_OLX_LEAD_FILTERS, zones: [] },
  scanIntervalMinutes: 0,
  scanLimit: 6,
  minAdAgeHours: DEFAULT_OLX_MIN_AD_AGE_HOURS,
  maxAdAgeHours: DEFAULT_OLX_MAX_AD_AGE_HOURS,
  lastScanAt: null,
  lastScanNotice: null,
};

const LOCAL_CONFIG_CACHE_KEY = "brokr_platform_autocrawl_config";
let legacyIdsNormalizedThisSession = false;
const syncedDailyLeadMaxByDate = new Map<string, number>();

function stripUndefinedDeep<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value
      .filter((v) => v !== undefined)
      .map((v) => stripUndefinedDeep(v)) as unknown as T;
  }
  if (typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value as Record<string, any>)) {
      if (v !== undefined) {
        out[k] = stripUndefinedDeep(v);
      }
    }
    return out as T;
  }
  return value;
}

function clampString(val: unknown, maxLen: number, fallback = ""): string {
  const s = typeof val === "string" ? val.trim() : val != null ? String(val).trim() : "";
  const chosen = s || fallback;
  return chosen.length > maxLen ? chosen.slice(0, maxLen) : chosen;
}

export function normalizeCrawlUrl(url: string): string {
  try {
    const parsed = new URL(url.trim());
    return `${parsed.origin}${parsed.pathname}`.toLowerCase().replace(/\/+$/, "");
  } catch {
    return String(url || "").split("?")[0].trim().toLowerCase().replace(/\/+$/, "");
  }
}

export function extractOlxSlugId(url: string): string {
  const match = String(url || "").match(/-ID([A-Za-z0-9]+)\.html/i);
  return match ? match[1].toLowerCase() : "";
}

function normalizeConfig(raw: Partial<PlatformAutoCrawlConfig> | null | undefined): PlatformAutoCrawlConfig {
  const filtersRaw = raw?.filters || DEFAULT_OLX_LEAD_FILTERS;
  const interval = Number(raw?.scanIntervalMinutes ?? 0);
  const limit = Number(raw?.scanLimit ?? 6);
  const minAge = Number(raw?.minAdAgeHours ?? DEFAULT_OLX_MIN_AD_AGE_HOURS);
  const maxAge = Number(raw?.maxAdAgeHours ?? DEFAULT_OLX_MAX_AD_AGE_HOURS);

  return {
    filters: {
      ...DEFAULT_OLX_LEAD_FILTERS,
      ...filtersRaw,
      categories: Array.isArray(filtersRaw.categories) ? filtersRaw.categories : [],
      rooms: Array.isArray(filtersRaw.rooms) ? filtersRaw.rooms : [],
      compartimentare: Array.isArray(filtersRaw.compartimentare) ? filtersRaw.compartimentare : [],
      constructie: Array.isArray(filtersRaw.constructie) ? filtersRaw.constructie : [],
      floors: Array.isArray(filtersRaw.floors) ? filtersRaw.floors : [],
      zones: Array.isArray(filtersRaw.zones) ? filtersRaw.zones : [],
    },
    scanIntervalMinutes: [0, 1, 5, 15, 30, 60].includes(interval) ? interval : 0,
    scanLimit: [3, 6, 9, 12, 24, 48].includes(limit) ? limit : 6,
    minAdAgeHours: OLX_MAX_AGE_STEPS.some((s) => s.hours === minAge)
      ? minAge
      : DEFAULT_OLX_MIN_AD_AGE_HOURS,
    maxAdAgeHours: OLX_MAX_AGE_STEPS.some((s) => s.hours === maxAge && s.hours > 0)
      ? maxAge
      : DEFAULT_OLX_MAX_AD_AGE_HOURS,
    lastScanAt: typeof raw?.lastScanAt === "number" ? raw.lastScanAt : null,
    lastScanNotice: raw?.lastScanNotice || null,
    updatedBy: raw?.updatedBy,
    updatedAt: raw?.updatedAt,
  };
}

function buildSharedLeadDocId(url: string, index: number): string {
  const slugId = extractOlxSlugId(url);
  if (slugId) {
    return `shl_olx_${slugId}`;
  }
  let hash = 0;
  const norm = normalizeCrawlUrl(url);
  for (let i = 0; i < norm.length; i++) {
    hash = (hash * 31 + norm.charCodeAt(i)) >>> 0;
  }
  return `shl_${Date.now()}_${hash.toString(36)}_${index}`;
}

function toProxiedImageUrl(u: string | undefined | null): string {
  if (!u || typeof u !== "string") return "";
  const normalized = u.trim().startsWith("//") ? "https:" + u.trim() : u.trim();
  if (normalized.startsWith("http") && !normalized.includes("/api/proxy-image")) {
    return `/api/proxy-image?url=${encodeURIComponent(normalized)}`;
  }
  return normalized;
}

function extractDateKeyFromLeadRecord(data: Record<string, any>): string {
  const raw = data?.createdAt || data?.updatedAt;
  if (raw && typeof raw?.toDate === "function") {
    try {
      return getDailyLeadDateKey(raw.toDate());
    } catch {
      return getDailyLeadDateKey();
    }
  }
  if (typeof raw === "string" || typeof raw === "number") {
    return getDailyLeadDateKey(raw);
  }
  return getDailyLeadDateKey();
}

function replaceEmbeddedPropertyId(
  payload: Record<string, any>,
  oldPropertyId: string,
  newPropertyId: string
): Record<string, any> {
  if (!oldPropertyId || oldPropertyId === newPropertyId) return payload;
  const next: Record<string, any> = { ...payload };
  if (typeof next.title === "string" && next.title.includes(oldPropertyId)) {
    next.title = next.title.split(oldPropertyId).join(newPropertyId);
  }
  if (next.extractedData && typeof next.extractedData === "object") {
    const ed = { ...next.extractedData };
    if (ed.propertyId === oldPropertyId) {
      ed.propertyId = newPropertyId;
    }
    if (ed.crmData?.descriere && typeof ed.crmData.descriere === "object") {
      const desc = { ...ed.crmData.descriere };
      if (typeof desc.titlu === "string" && desc.titlu.includes(oldPropertyId)) {
        desc.titlu = desc.titlu.split(oldPropertyId).join(newPropertyId);
      }
      if (typeof desc.continut === "string" && desc.continut.includes(oldPropertyId)) {
        desc.continut = desc.continut.split(oldPropertyId).join(newPropertyId);
      }
      ed.crmData = { ...ed.crmData, descriere: desc };
    }
    if (typeof ed.markdownMarketing === "string" && ed.markdownMarketing.includes(oldPropertyId)) {
      ed.markdownMarketing = ed.markdownMarketing.split(oldPropertyId).join(newPropertyId);
    }
    next.extractedData = ed;
  }
  return next;
}

export interface AutoCrawlRunResult {
  addedCount: number;
  skippedCount: number;
  saveErrors: string[];
  notice: AutoCrawlScanNotice | null;
  warning?: string;
}

export interface ManualSingleUrlImportResult {
  lead: Lead;
  propertyId: string;
  title: string;
  zone: string;
  notice: AutoCrawlScanNotice;
}

export const platformAutoCrawlService = {
  getCachedConfig(): PlatformAutoCrawlConfig {
    try {
      const raw = localStorage.getItem(LOCAL_CONFIG_CACHE_KEY);
      if (!raw) return DEFAULT_PLATFORM_AUTO_CRAWL_CONFIG;
      return normalizeConfig(JSON.parse(raw));
    } catch {
      return DEFAULT_PLATFORM_AUTO_CRAWL_CONFIG;
    }
  },

  async loadConfig(): Promise<PlatformAutoCrawlConfig> {
    try {
      const ref = doc(db, AUTO_CRAWL_CONFIG_COLLECTION, AUTO_CRAWL_CONFIG_DOC_ID);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const normalized = normalizeConfig(snap.data() as Partial<PlatformAutoCrawlConfig>);
        try {
          localStorage.setItem(LOCAL_CONFIG_CACHE_KEY, JSON.stringify(normalized));
        } catch {}
        return normalized;
      }
      return this.getCachedConfig();
    } catch (err) {
      console.warn("[platformAutoCrawlService] loadConfig fallback to cache:", err);
      return this.getCachedConfig();
    }
  },

  async saveConfig(config: PlatformAutoCrawlConfig): Promise<PlatformAutoCrawlConfig> {
    const normalized = normalizeConfig(config);
    const payload = stripUndefinedDeep({
      ...normalized,
      updatedBy: auth.currentUser?.email || "super_admin",
      updatedAt: new Date().toISOString(),
    });
    try {
      localStorage.setItem(LOCAL_CONFIG_CACHE_KEY, JSON.stringify(payload));
    } catch {}
    try {
      const ref = doc(db, AUTO_CRAWL_CONFIG_COLLECTION, AUTO_CRAWL_CONFIG_DOC_ID);
      await setDoc(ref, payload, { merge: true });
      return payload;
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.WRITE,
        `${AUTO_CRAWL_CONFIG_COLLECTION}/${AUTO_CRAWL_CONFIG_DOC_ID}`
      );
      return payload;
    }
  },

  subscribeToSharedLeads(callback: (leads: Lead[]) => void): () => void {
    if (isClientDataHubEnabled()) {
      return clientDataHub.subscribePlatformSharedLeads<Lead>((items) => {
        callback(items);
        // Only batch-sync public_shares for full canonical docs (never slim summaries)
        const canonicalItems = items.filter((item) => !(item as any)?.isSummary);
        if (canonicalItems.length > 0) {
          void syncPublicShareSnapshotsBatch(canonicalItems);
        }
      });
    }

    let unsubSnapshot: (() => void) | null = null;
    let active = true;

    const attach = () => {
      if (!active || !auth.currentUser) return;
      if (unsubSnapshot) {
        unsubSnapshot();
        unsubSnapshot = null;
      }
      const q = query(
        collection(db, SHARED_LEADS_COLLECTION),
        orderBy("createdAt", "desc")
      );
      unsubSnapshot = onSnapshot(
        q,
        (snapshot) => {
          if (!active) return;
          const items: Lead[] = snapshot.docs.map((d) => {
            const raw = d.data() as Record<string, any>;
            return hydrateEntityTimestamps({
              ...raw,
              id: d.id,
              isSharedLead: true,
              status: raw.status || "Noi",
            }) as Lead;
          });
          callback(items);
          void syncPublicShareSnapshotsBatch(items);
        },
        (err) => {
          console.warn("[platformAutoCrawlService] Shared leads listener error:", err);
          callback([]);
        }
      );
    };

    const unsubAuth = auth.onAuthStateChanged((u) => {
      if (u) {
        attach();
      } else {
        if (unsubSnapshot) {
          unsubSnapshot();
          unsubSnapshot = null;
        }
        if (active) callback([]);
      }
    });

    if (auth.currentUser) {
      attach();
    }

    return () => {
      active = false;
      if (unsubSnapshot) unsubSnapshot();
      unsubAuth();
    };
  },

  async getSharedLeadById(leadId: string): Promise<Lead | null> {
    if (!auth.currentUser || !leadId) return null;
    try {
      const ref = doc(db, SHARED_LEADS_COLLECTION, leadId);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        return hydrateEntityTimestamps({
          ...(snap.data() as Record<string, any>),
          id: snap.id,
          isSharedLead: true,
        }) as Lead;
      }
      // Indexed single-field lookup by propertyId (e.g. /leads/L49 or /leads/2026-11-24-1)
      // — 1 read instead of scanning the entire platform_shared_leads collection.
      const byCodeSnap = await getDocs(
        query(
          collection(db, SHARED_LEADS_COLLECTION),
          where("propertyId", "==", leadId),
          limit(1)
        )
      );
      const match = byCodeSnap.docs[0];
      if (!match) return null;
      return hydrateEntityTimestamps({
        ...(match.data() as Record<string, any>),
        id: match.id,
        isSharedLead: true,
      }) as Lead;
    } catch (err) {
      console.warn(`[platformAutoCrawlService] getSharedLeadById failed for ${leadId}:`, err);
      return null;
    }
  },

  async saveSharedLeadDualWrite(docId: string, docPayload: Record<string, any>): Promise<void> {
    try {
      const headers = await getApiAuthHeaders({ "Content-Type": "application/json" });
      const res = await fetch("/api/platform/shared-leads", {
        method: "POST",
        headers,
        body: JSON.stringify({ ...docPayload, id: docId }),
      });
      if (res.ok) return;
    } catch {
      // Fallback to direct canonical Firestore write below if server route unavailable
    }
    await setDoc(doc(db, SHARED_LEADS_COLLECTION, docId), docPayload);
  },

  async deleteSharedLead(leadId: string): Promise<void> {
    try {
      const headers = await getApiAuthHeaders();
      const res = await fetch(`/api/platform/shared-leads/${encodeURIComponent(leadId)}`, {
        method: "DELETE",
        headers,
      });
      if (res.ok) return;
    } catch {
      // Fallback to direct canonical delete below
    }
    try {
      await deleteDoc(doc(db, SHARED_LEADS_COLLECTION, leadId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `${SHARED_LEADS_COLLECTION}/${leadId}`);
    }
  },

  async clearAllSharedLeads(): Promise<number> {
    try {
      let deleted = 0;
      let clearedViaApi = false;
      try {
        const headers = await getApiAuthHeaders();
        const res = await fetch("/api/platform/shared-leads", {
          method: "DELETE",
          headers,
        });
        if (res.ok) {
          const json = await res.json().catch(() => ({}));
          deleted = Number(json?.data?.deletedCount || 0);
          clearedViaApi = true;
        }
      } catch {
        clearedViaApi = false;
      }

      if (!clearedViaApi) {
        const snap = await getDocs(collection(db, SHARED_LEADS_COLLECTION));
        if (!snap.empty) {
          const docs = snap.docs;
          for (let i = 0; i < docs.length; i += 400) {
            const batch = writeBatch(db);
            for (const d of docs.slice(i, i + 400)) {
              batch.delete(d.ref);
              deleted++;
            }
            await batch.commit();
          }
        }
      }
      // Reset daily shared-lead counters so new crawls start cleanly from YYYY-MM-DD-1
      await setDoc(
        doc(db, AUTO_CRAWL_CONFIG_COLLECTION, AUTO_CRAWL_COUNTERS_DOC_ID),
        {
          lead: 0,
          dailyCounters: {},
          lastDailyDate: "",
          lastDailyCount: 0,
          updatedBy: auth.currentUser?.email || "super_admin",
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      return deleted;
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, SHARED_LEADS_COLLECTION);
      return 0;
    }
  },

  /**
   * Atomically reserves `count` daily incremental lead IDs (`YYYY-MM-DD-1`, `YYYY-MM-DD-2`, ...)
   * in Firestore under `platform_auto_crawl/counters`, resetting cleanly to `1` each day.
   */
  async reserveDailySharedLeadIds(
    count: number,
    fallbackExistingLeads: Lead[] = [],
    explicitDateKey?: string
  ): Promise<string[]> {
    if (count <= 0) return [];
    const dateKey = explicitDateKey || getDailyLeadDateKey();
    const counterRef = doc(db, AUTO_CRAWL_CONFIG_COLLECTION, AUTO_CRAWL_COUNTERS_DOC_ID);

    // Inspect today's leads ONLY via single-field prefix range query (never full-collection scan),
    // and reuse in-session synced max for today once checked.
    let liveMax = Math.max(
      getMaxDailyLeadSequenceForDate(fallbackExistingLeads, dateKey),
      syncedDailyLeadMaxByDate.get(dateKey) || 0
    );
    if (!syncedDailyLeadMaxByDate.has(dateKey) && fallbackExistingLeads.length === 0) {
      try {
        const prefix = `${dateKey}-`;
        const todaySnap = await getDocs(
          query(
            collection(db, SHARED_LEADS_COLLECTION),
            where("propertyId", ">=", prefix),
            where("propertyId", "<=", `${prefix}\uf8ff`),
            orderBy("propertyId", "desc"),
            limit(50)
          )
        );
        const snapMax = getMaxDailyLeadSequenceForDate(
          todaySnap.docs.map((d) => d.data() as { propertyId?: string }),
          dateKey
        );
        if (snapMax > liveMax) liveMax = snapMax;
      } catch {
        // fallbackExistingLeads max + atomic counter document already protect uniqueness
      }
    }

    const startNum = await runTransaction(db, async (tx) => {
      const counterSnap = await tx.get(counterRef);
      const counterData = counterSnap.exists() ? (counterSnap.data() as Record<string, any>) : {};
      const existingDailyCounters: Record<string, number> =
        counterData?.dailyCounters && typeof counterData.dailyCounters === "object"
          ? { ...counterData.dailyCounters }
          : {};
      const storedVal =
        typeof existingDailyCounters[dateKey] === "number" &&
        Number.isFinite(existingDailyCounters[dateKey])
          ? Math.max(0, Math.floor(existingDailyCounters[dateKey]))
          : 0;
      const base = Math.max(storedVal, liveMax);
      const nextEnd = base + count;
      existingDailyCounters[dateKey] = nextEnd;

      tx.set(
        counterRef,
        {
          dailyCounters: existingDailyCounters,
          lastDailyDate: dateKey,
          lastDailyCount: nextEnd,
          updatedBy: auth.currentUser?.email || "super_admin",
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      return base + 1;
    });

    syncedDailyLeadMaxByDate.set(dateKey, startNum + count - 1);

    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      ids.push(formatDailyLeadId(dateKey, startNum + i));
    }
    return ids;
  },

  /**
   * Repairs any previously imported shared leads that do not use the daily `YYYY-MM-DD-N` format
   * (e.g., legacy `L1` or `L-L7KSG` slugs) into clean daily incremental IDs grouped by creation day.
   * Memoized via session flag + `platform_auto_crawl/counters.legacyIdsNormalizedAt` so once clean,
   * repeated page opens & auto-crawl scans incur 0–1 reads instead of scanning the entire collection.
   */
  async normalizeLegacySharedLeadIds(options?: { force?: boolean }): Promise<number> {
    if (!auth.currentUser) return 0;
    const force = Boolean(options?.force);
    if (!force && legacyIdsNormalizedThisSession) {
      return 0;
    }
    try {
      const counterRef = doc(db, AUTO_CRAWL_CONFIG_COLLECTION, AUTO_CRAWL_COUNTERS_DOC_ID);
      if (!force) {
        try {
          const counterSnap = await getDoc(counterRef);
          if (counterSnap.exists() && counterSnap.data()?.legacyIdsNormalizedAt) {
            legacyIdsNormalizedThisSession = true;
            return 0;
          }
        } catch {
          // Proceed to check below if counter doc read fails
        }
      }

      const snap = await getDocs(collection(db, SHARED_LEADS_COLLECTION));
      if (snap.empty) {
        legacyIdsNormalizedThisSession = true;
        return 0;
      }

      const allDocs = snap.docs.map((d) => ({
        id: d.id,
        ref: d.ref,
        data: d.data() as Record<string, any>,
      }));

      const broken = allDocs
        .filter((entry) => !isDailyLeadId(entry.data.propertyId))
        .sort((a, b) => {
          const ta = Date.parse(String(a.data.createdAt || "")) || 0;
          const tb = Date.parse(String(b.data.createdAt || "")) || 0;
          return ta - tb;
        });

      if (broken.length === 0) {
        legacyIdsNormalizedThisSession = true;
        void setDoc(
          counterRef,
          { legacyIdsNormalizedAt: new Date().toISOString() },
          { merge: true }
        ).catch(() => {});
        return 0;
      }

      const maxByDate = new Map<string, number>();
      const allPropertyRecords = allDocs.map((entry) => ({ propertyId: entry.data.propertyId }));

      let updatedCount = 0;
      for (const entry of broken) {
        const dateKey = extractDateKeyFromLeadRecord(entry.data);
        if (!maxByDate.has(dateKey)) {
          maxByDate.set(dateKey, getMaxDailyLeadSequenceForDate(allPropertyRecords, dateKey));
        }
        const nextSeq = (maxByDate.get(dateKey) || 0) + 1;
        maxByDate.set(dateKey, nextSeq);

        const newPropId = formatDailyLeadId(dateKey, nextSeq);
        const oldPropId = typeof entry.data.propertyId === "string" ? entry.data.propertyId : "";
        const updatedDoc = replaceEmbeddedPropertyId(
          {
            ...entry.data,
            propertyId: newPropId,
            updatedAt: new Date().toISOString(),
          },
          oldPropId,
          newPropId
        );
        await setDoc(entry.ref, stripUndefinedDeep(updatedDoc));
        updatedCount += 1;
      }

      if (maxByDate.size > 0) {
        const counterRef = doc(db, AUTO_CRAWL_CONFIG_COLLECTION, AUTO_CRAWL_COUNTERS_DOC_ID);
        await runTransaction(db, async (tx) => {
          const counterSnap = await tx.get(counterRef);
          const counterData = counterSnap.exists() ? (counterSnap.data() as Record<string, any>) : {};
          const existingDailyCounters: Record<string, number> =
            counterData?.dailyCounters && typeof counterData.dailyCounters === "object"
              ? { ...counterData.dailyCounters }
              : {};
          let changed = false;
          for (const [dateKey, maxSeq] of maxByDate.entries()) {
            const storedVal =
              typeof existingDailyCounters[dateKey] === "number"
                ? Math.max(0, Math.floor(existingDailyCounters[dateKey]))
                : 0;
            if (maxSeq > storedVal) {
              existingDailyCounters[dateKey] = maxSeq;
              changed = true;
            }
          }
          if (changed) {
            tx.set(
              counterRef,
              {
                dailyCounters: existingDailyCounters,
                updatedBy: auth.currentUser?.email || "super_admin",
                updatedAt: new Date().toISOString(),
              },
              { merge: true }
            );
          }
        });
      }

      legacyIdsNormalizedThisSession = true;
      void setDoc(
        counterRef,
        { legacyIdsNormalizedAt: new Date().toISOString() },
        { merge: true }
      ).catch(() => {});

      return updatedCount;
    } catch (err) {
      console.warn("[platformAutoCrawlService] normalizeLegacySharedLeadIds skipped:", err);
      return 0;
    }
  },

  async runAutoCrawlScan(
    config: PlatformAutoCrawlConfig,
    existingLeads: Lead[]
  ): Promise<AutoCrawlRunResult> {
    if (!auth.currentUser) {
      throw new Error("Autentificarea Super Admin este necesară pentru a rula Auto Crawl.");
    }

    const authHeaders = await getApiAuthHeaders({ "Content-Type": "application/json" });
    const seenUrls = new Set<string>();
    const seenSlugIds = new Set<string>();
    const existingUrls: string[] = [];

    for (const lead of existingLeads) {
      if (lead.url) {
        existingUrls.push(lead.url);
        const norm = normalizeCrawlUrl(lead.url);
        if (norm) seenUrls.add(norm);
        const slug = extractOlxSlugId(lead.url);
        if (slug) seenSlugIds.add(slug);
      }
    }

    const res = await fetch("/api/crawl-olx-leads", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        filters: config.filters,
        page: 1,
        existingUrls,
        limit: config.scanLimit,
        minAgeHours: config.minAdAgeHours,
        maxAgeHours: config.maxAdAgeHours,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg =
        data?.error?.message ||
        (typeof data?.error === "string" ? data.error : null) ||
        `Eroare HTTP ${res.status}`;
      throw new Error(msg);
    }

    const crawledItems: any[] = Array.isArray(data?.items) ? data.items : [];
    if (crawledItems.length === 0) {
      if (data?.warning) {
        return {
          addedCount: 0,
          skippedCount: 0,
          saveErrors: [],
          warning: String(data.warning),
          notice: {
            type: "error",
            title: "Eroare la scanarea automată OLX.ro",
            message: String(data.warning),
            timestamp: Date.now(),
          },
        };
      }
      const emptyMsg =
        data?.emptyReason === "all_seen"
          ? "Toate anunțurile de pe OLX.ro care corespund filtrelor autocrawler au fost deja preluate."
          : "Nu mai există anunțuri pe OLX.ro care să corespundă filtrelor și intervalului selectat în autocrawler.";
      return {
        addedCount: 0,
        skippedCount: 0,
        saveErrors: [],
        notice: {
          type: "info",
          title: "Niciun anunț nou potrivit filtrelor autocrawler",
          message: emptyMsg,
          timestamp: Date.now(),
        },
      };
    }

    await this.normalizeLegacySharedLeadIds().catch(() => 0);

    const creatorName =
      auth.currentUser.displayName ||
      (auth.currentUser.email ? auth.currentUser.email.split("@")[0] : "Auto Crawl Platform");
    const creatorEmail = auth.currentUser.email || "";

    let addedCount = 0;
    let skippedCount = 0;
    const saveErrors: string[] = [];

    const itemsToSave: Array<{ item: any; idx: number; normUrl: string; slugId: string }> = [];
    for (let idx = 0; idx < crawledItems.length; idx++) {
      const item = crawledItems[idx];
      const normUrl = normalizeCrawlUrl(String(item.url || ""));
      const slugId = extractOlxSlugId(String(item.url || ""));
      if ((normUrl && seenUrls.has(normUrl)) || (slugId && seenSlugIds.has(slugId))) {
        skippedCount++;
        continue;
      }
      if (normUrl) seenUrls.add(normUrl);
      if (slugId) seenSlugIds.add(slugId);
      itemsToSave.push({ item, idx, normUrl, slugId });
    }

    const todayDateKey = getDailyLeadDateKey();
    const reservedIds = await this.reserveDailySharedLeadIds(
      itemsToSave.length,
      existingLeads,
      todayDateKey
    );

    for (let i = 0; i < itemsToSave.length; i++) {
      const { item, idx } = itemsToSave[i];
      const docId = buildSharedLeadDocId(String(item.url || ""), idx);
      const propertyId = reservedIds[i] || formatDailyLeadId(todayDateKey, i + 1);
      const nowIso = new Date().toISOString();

      const originalTitle = clampString(
        item.extractedData?.olxMeta?.originalTitle || item.extractedData?.originalTitle || item.title,
        500,
        "Anunț OLX"
      );
      const originalDescription = clampString(
        item.extractedData?.originalDescription || item.notes || "",
        10000,
        ""
      );

      let finalExtractedData = item.extractedData || undefined;
      if (finalExtractedData) {
        finalExtractedData = {
          ...finalExtractedData,
          originalTitle,
          originalDescription,
          markdownMarketing: originalDescription,
          ...(finalExtractedData.olxMeta || item.publishedAt || item.publishedAtLabel
            ? {
                olxMeta: {
                  ...(finalExtractedData.olxMeta || {}),
                  originalTitle,
                  publishedAt:
                    item.publishedAt ||
                    finalExtractedData.olxMeta?.publishedAt ||
                    finalExtractedData.olxMeta?.createdTime ||
                    null,
                  publishedAtLabel:
                    item.publishedAtLabel ||
                    finalExtractedData.olxMeta?.publishedAtLabel ||
                    "",
                },
              }
            : {}),
          ...(finalExtractedData.crmData?.descriere
            ? {
                crmData: {
                  ...finalExtractedData.crmData,
                  descriere: {
                    ...finalExtractedData.crmData.descriere,
                    titlu: originalTitle,
                    continut: originalDescription,
                  },
                },
              }
            : {}),
        };
      }

      const safeImages = Array.isArray(item.images)
        ? item.images.filter((u: unknown) => typeof u === "string" && u.trim().length > 0).slice(0, 100)
        : [];

      const resolvedZone = resolveAreaFromAd({
        rawZone: item.zone,
        city: finalExtractedData?.crmData?.detaliiGenerale?.localizare?.oras || "București",
        title: originalTitle,
        description: originalDescription,
        url: item.url,
      });

      const docPayload = stripUndefinedDeep({
        id: docId,
        propertyId,
        url: clampString(item.url, 2048),
        title: originalTitle,
        zone: clampString(resolvedZone, 200, "București"),
        price: clampString(item.price, 100, "N/A"),
        ownerName: clampString(item.ownerName, 200, "Proprietar OLX"),
        ownerPhone: clampString(item.ownerPhone, 100, "Nespecificat"),
        transactionType: item.transactionType === "Vânzare" ? "Vânzare" : "Închiriere",
        categoria: clampString(item.categoria, 100, "Apartament"),
        status: "Noi",
        leadType: clampString(item.leadType, 64, "Proprietar"),
        coverImage: item.coverImage ? clampString(item.coverImage, 2048) : safeImages[0] || undefined,
        images: safeImages,
        notes: originalDescription,
        extractedData: finalExtractedData,
        isSharedLead: true,
        source: "platform_auto_crawl",
        createdByName: clampString(creatorName, 200, "Auto Crawl Platform"),
        createdByEmail: clampString(creatorEmail, 200),
        author: clampString(creatorName, 200, "Auto Crawl Platform"),
        agent: "Platform Auto Crawl",
        createdAt: nowIso,
        updatedAt: nowIso,
        lastMovedAt: nowIso,
      });

      try {
        await this.saveSharedLeadDualWrite(docId, docPayload);
        addedCount++;
      } catch (saveErr: any) {
        console.warn("[platformAutoCrawlService] Failed saving shared OLX lead:", saveErr);
        saveErrors.push(saveErr?.message || "Eroare la salvarea anunțului în Firestore.");
      }
    }

    let notice: AutoCrawlScanNotice | null = null;
    if (saveErrors.length > 0 && addedCount === 0) {
      notice = {
        type: "error",
        title: "Eroare la salvarea lead-urilor autocrawler",
        message: `Nu s-au putut salva anunțurile găsite: ${saveErrors[0]}`,
        timestamp: Date.now(),
      };
    } else if (saveErrors.length > 0 && addedCount > 0) {
      notice = {
        type: "error",
        title: "Eroare parțială la salvarea lead-urilor",
        message: `${addedCount} anunțuri salvate și distribuite către agenții, însă ${saveErrors.length} au eșuat: ${saveErrors[0]}`,
        timestamp: Date.now(),
      };
    } else if (addedCount > 0) {
      notice = {
        type: "success",
        title: "Scanare finalizată cu succes",
        message: `${addedCount} ${addedCount === 1 ? "anunț nou a fost importat" : "anunțuri noi au fost importate"} și distribuite automat către toate agențiile.`,
        timestamp: Date.now(),
      };
    } else {
      notice = {
        type: "info",
        title: "Niciun anunț nou potrivit filtrelor autocrawler",
        message: "Toate anunțurile găsite care corespund filtrelor autocrawler au fost deja preluate anterior.",
        timestamp: Date.now(),
      };
    }

    return { addedCount, skippedCount, saveErrors, notice };
  },

  async importSingleUrlAsSharedLead({
    url,
    html,
    existingLeads = [],
  }: {
    url: string;
    html?: string;
    existingLeads?: Lead[];
  }): Promise<ManualSingleUrlImportResult> {
    if (!auth.currentUser) {
      throw new Error("Autentificarea Super Admin este necesară pentru a importa un anunț.");
    }

    let normalizedInputUrl = String(url || "").trim();
    if (!normalizedInputUrl) {
      throw new Error("Introdu un URL valid al anunțului.");
    }
    if (!/^https?:\/\//i.test(normalizedInputUrl)) {
      normalizedInputUrl = `https://${normalizedInputUrl}`;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(normalizedInputUrl);
    } catch {
      throw new Error("URL-ul introdus nu este valid. Verifică formatul (ex: https://www.olx.ro/d/oferta/...).");
    }
    if (
      (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") ||
      !parsedUrl.hostname.includes(".")
    ) {
      throw new Error("URL-ul introdus trebuie să fie o adresă web validă (http:// sau https://).");
    }

    const normUrl = normalizeCrawlUrl(normalizedInputUrl);
    const slugId = extractOlxSlugId(normalizedInputUrl);

    const duplicateInMemory = existingLeads.find((lead) => {
      if (!lead.url) return false;
      const existingNorm = normalizeCrawlUrl(lead.url);
      if (normUrl && existingNorm && existingNorm === normUrl) return true;
      const existingSlug = extractOlxSlugId(lead.url);
      if (slugId && existingSlug && existingSlug === slugId) return true;
      return false;
    });
    if (duplicateInMemory) {
      const refLabel = duplicateInMemory.propertyId ? ` (#${duplicateInMemory.propertyId})` : "";
      throw new Error(`Acest anunț a fost deja importat în lista globală${refLabel}.`);
    }

    const docId = buildSharedLeadDocId(normalizedInputUrl, 0);
    try {
      const existingSnap = await getDoc(doc(db, SHARED_LEADS_COLLECTION, docId));
      if (existingSnap.exists()) {
        const existingData = existingSnap.data() as Record<string, any>;
        const refLabel = existingData?.propertyId ? ` (#${existingData.propertyId})` : "";
        throw new Error(`Acest anunț a fost deja importat în lista globală${refLabel}.`);
      }
    } catch (dupErr: any) {
      if (dupErr instanceof Error && dupErr.message.includes("a fost deja importat")) {
        throw dupErr;
      }
    }

    const trimmedHtml = typeof html === "string" ? html.trim() : "";
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);

    let crawlRes: Response;
    try {
      const authHeaders = await getApiAuthHeaders({ "Content-Type": "application/json" });
      crawlRes = await fetch("/api/crawl", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          url: normalizedInputUrl,
          ...(trimmedHtml ? { html: trimmedHtml } : {}),
        }),
        signal: controller.signal,
      });
    } catch (fetchErr: any) {
      if (fetchErr?.name === "AbortError") {
        throw new Error("Timpul de așteptare a expirat la accesarea URL-ului. Încearcă din nou.");
      }
      throw fetchErr;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!crawlRes.ok) {
      const errorText = await crawlRes.text();
      let parsed: any = null;
      try {
        parsed = JSON.parse(errorText);
      } catch {}
      const parsedMsg =
        parsed?.error?.message ||
        (typeof parsed?.error === "string" ? parsed.error : "") ||
        `Extragerea a eșuat (HTTP ${crawlRes.status})`;
      if (
        parsed?.code === "UPSTREAM_ACCESS_BLOCKED" ||
        parsed?.upstreamStatus === 403 ||
        parsed?.upstreamStatus === 429 ||
        parsedMsg.includes("403") ||
        parsedMsg.toLowerCase().includes("anti-bot")
      ) {
        throw new CrawlBlockedError(parsedMsg, parsed?.upstreamStatus || 403);
      }
      throw new Error(parsedMsg);
    }

    const contentTypeHeader = crawlRes.headers.get("content-type");
    if (!contentTypeHeader || !contentTypeHeader.includes("application/json")) {
      throw new Error("Serverul a returnat un răspuns invalid la extragerea URL-ului.");
    }

    const crawlData = await crawlRes.json();
    const {
      title,
      price,
      zone,
      ownerName,
      ownerPhone,
      transactionType: crawledTrans,
      categoria: crawledCat,
      crmData,
      coverImage,
    } = crawlData;

    const originalTitle = clampString(
      crawlData.originalTitle || title || crmData?.descriere?.titlu,
      500,
      "Anunț imobiliar"
    );
    const originalDescription = clampString(
      crawlData.description || crmData?.descriere?.continut || crawlData.text || "",
      10000,
      ""
    );

    if (crmData?.descriere) {
      crmData.descriere.titlu = originalTitle;
      crmData.descriere.continut = originalDescription;
    }

    let resolvedPrice = typeof price === "string" && price.trim() ? price.trim() : "N/A";
    if (
      resolvedPrice !== "N/A" &&
      (resolvedPrice.toLowerCase().includes("ron") || resolvedPrice.toLowerCase().includes("lei"))
    ) {
      const digits = parseFloat(resolvedPrice.replace(/[^0-9.,]/g, "").replace(",", "."));
      if (!Number.isNaN(digits) && digits > 0) {
        const inEur = Math.round(digits / 4.97);
        const isRentTrans = String(crawledTrans || "").toLowerCase().includes("inchir");
        resolvedPrice = `${inEur.toLocaleString("ro-RO")} €${isRentTrans ? " / lună" : ""}`;
      }
    }

    const cleanCover = coverImage ? toProxiedImageUrl(coverImage) : undefined;
    const rawImages =
      Array.isArray(crawlData.images) && crawlData.images.length > 0
        ? crawlData.images
        : coverImage
          ? [coverImage]
          : [];
    const safeImages = rawImages
      .map((u: string) => toProxiedImageUrl(u))
      .filter((u: string) => typeof u === "string" && u.trim().length > 0)
      .slice(0, 100);

    if (crmData?.imagini) {
      const categories = ["living", "camera", "bucatarie", "baie", "alteSpatii"] as const;
      categories.forEach((cat) => {
        if (Array.isArray(crmData.imagini[cat])) {
          crmData.imagini[cat] = crmData.imagini[cat].map((item: any) => {
            if (typeof item === "string") return toProxiedImageUrl(item);
            if (item && item.original) return { ...item, original: toProxiedImageUrl(item.original) };
            return item;
          });
        }
      });
    }

    const resolvedZone = resolveAreaFromAd({
      rawZone: zone,
      city: crmData?.detaliiGenerale?.localizare?.oras || "București",
      title: originalTitle,
      description: originalDescription,
      url: normalizedInputUrl,
    });

    await this.normalizeLegacySharedLeadIds().catch(() => 0);

    const todayDateKey = getDailyLeadDateKey();
    const reservedIds = await this.reserveDailySharedLeadIds(1, existingLeads, todayDateKey);
    const propertyId = reservedIds[0] || formatDailyLeadId(todayDateKey, 1);

    const nowIso = new Date().toISOString();
    const creatorName =
      auth.currentUser.displayName ||
      (auth.currentUser.email ? auth.currentUser.email.split("@")[0] : "Super Admin");
    const creatorEmail = auth.currentUser.email || "";

    const finalExtractedData = crmData
      ? {
          crmData,
          presentationSections: crawlData.presentationSections || null,
          automationSource: crawlData.automationSource || null,
          originalTitle,
          markdownMarketing: originalDescription,
          summary:
            crawlData.presentationSections?.introducere?.summary ||
            `${crawledCat || "Proprietate"} ${crmData.caracteristici?.detalii?.camere || "2"} camere în ${resolvedZone || "București"}, ${resolvedPrice}`,
          originalDescription,
          ...(crawlData.publishedAt || crawlData.publishedAtLabel || crawlData.sellerType
            ? {
                olxMeta: {
                  originalTitle,
                  publishedAt: crawlData.publishedAt || null,
                  publishedAtLabel: crawlData.publishedAtLabel || "",
                  sellerType: crawlData.sellerType || "",
                },
              }
            : {}),
        }
      : undefined;

    const normalizedTransactionType =
      String(crawledTrans || "").toLowerCase().includes("vanz") ||
      String(crawledTrans || "").toLowerCase().includes("vânz")
        ? "Vânzare"
        : "Închiriere";

    const docPayload = stripUndefinedDeep({
      id: docId,
      propertyId,
      url: clampString(normalizedInputUrl, 2048),
      title: originalTitle,
      zone: clampString(resolvedZone, 200, "București"),
      price: clampString(resolvedPrice, 100, "N/A"),
      ownerName: clampString(ownerName, 200, "Proprietar"),
      ownerPhone: clampString(ownerPhone, 100, "Nespecificat"),
      transactionType: normalizedTransactionType,
      categoria: clampString(crawledCat, 100, "Apartament"),
      status: "Noi",
      leadType: "Proprietar",
      coverImage: cleanCover || safeImages[0] || undefined,
      images: safeImages,
      notes: originalDescription,
      extractedData: finalExtractedData,
      isSharedLead: true,
      source: "platform_manual_crawl",
      createdByName: clampString(creatorName, 200, "Super Admin"),
      createdByEmail: clampString(creatorEmail, 200),
      author: clampString(creatorName, 200, "Super Admin"),
      agent: "Platform Manual Crawl",
      createdAt: nowIso,
      updatedAt: nowIso,
      lastMovedAt: nowIso,
    });

    await this.saveSharedLeadDualWrite(docId, docPayload);

    const notice: AutoCrawlScanNotice = {
      type: "success",
      title: `URL importat manual (#${propertyId})`,
      message: `„${originalTitle}” (${clampString(resolvedZone, 200, "București")}) a fost adăugat și distribuit automat către toate agențiile.`,
      timestamp: Date.now(),
    };

    return {
      lead: docPayload as Lead,
      propertyId,
      title: originalTitle,
      zone: clampString(resolvedZone, 200, "București"),
      notice,
    };
  },
};
