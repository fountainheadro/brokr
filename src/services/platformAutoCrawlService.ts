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
import { getApiAuthHeaders } from "../lib/apiAuth";
import { automationSettingsService } from "./automationSettingsService";
import { buildTitleFromAutomationRule } from "../utils/titleAutomationEngine";
import { resolveAreaFromAd } from "../utils/zoneResolutionUtils";
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

function isValidSequentialLeadId(value: unknown): boolean {
  return typeof value === "string" && /^L\d+$/i.test(value.trim());
}

function extractNumericLeadNumber(value: unknown): number {
  if (typeof value !== "string") return 0;
  const m = value.trim().match(/^L(\d+)$/i);
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function getMaxNumericSharedLeadNumber(leads: Array<{ propertyId?: string }>): number {
  let maxNum = 0;
  for (const lead of leads) {
    const n = extractNumericLeadNumber(lead.propertyId);
    if (n > maxNum) maxNum = n;
  }
  return maxNum;
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
      // Also support lookup by propertyId (e.g. /leads/L-XXXX)
      const allSnap = await getDocs(collection(db, SHARED_LEADS_COLLECTION));
      const match = allSnap.docs.find((d) => {
        const data = d.data();
        return d.id === leadId || data?.propertyId === leadId;
      });
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

  async deleteSharedLead(leadId: string): Promise<void> {
    try {
      await deleteDoc(doc(db, SHARED_LEADS_COLLECTION, leadId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `${SHARED_LEADS_COLLECTION}/${leadId}`);
    }
  },

  async clearAllSharedLeads(): Promise<number> {
    try {
      const snap = await getDocs(collection(db, SHARED_LEADS_COLLECTION));
      let deleted = 0;
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
      // Reset sequential shared-lead counter so new crawls start cleanly from L1
      await setDoc(
        doc(db, AUTO_CRAWL_CONFIG_COLLECTION, AUTO_CRAWL_COUNTERS_DOC_ID),
        {
          lead: 0,
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
   * Atomically reserves `count` sequential lead IDs (`L1`, `L2`, `L3`, ...)
   * in Firestore under `platform_auto_crawl/counters`.
   */
  async reserveSequentialLeadIds(
    count: number,
    fallbackExistingLeads: Lead[] = []
  ): Promise<string[]> {
    if (count <= 0) return [];
    const counterRef = doc(db, AUTO_CRAWL_CONFIG_COLLECTION, AUTO_CRAWL_COUNTERS_DOC_ID);

    // Inspect live collection max so counter is never behind existing L<N> docs
    let liveMax = getMaxNumericSharedLeadNumber(fallbackExistingLeads);
    try {
      const snap = await getDocs(collection(db, SHARED_LEADS_COLLECTION));
      const snapMax = getMaxNumericSharedLeadNumber(
        snap.docs.map((d) => d.data() as { propertyId?: string })
      );
      if (snapMax > liveMax) liveMax = snapMax;
    } catch {
      // fallbackExistingLeads max already computed
    }

    const startNum = await runTransaction(db, async (tx) => {
      const counterSnap = await tx.get(counterRef);
      const storedVal =
        counterSnap.exists() && typeof counterSnap.data()?.lead === "number"
          ? Math.max(0, Math.floor(counterSnap.data().lead))
          : 0;
      const base = Math.max(storedVal, liveMax);
      const nextEnd = base + count;
      tx.set(
        counterRef,
        {
          lead: nextEnd,
          updatedBy: auth.currentUser?.email || "super_admin",
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      return base + 1;
    });

    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      ids.push(`L${startNum + i}`);
    }
    return ids;
  },

  /**
   * Repairs any previously imported shared leads that received non-sequential IDs
   * (e.g., `L-L7KSG` from OLX slugs) into clean sequential `L1`, `L2`, `L3`, ...
   */
  async normalizeLegacySharedLeadIds(): Promise<number> {
    if (!auth.currentUser) return 0;
    try {
      const snap = await getDocs(collection(db, SHARED_LEADS_COLLECTION));
      if (snap.empty) return 0;

      const allDocs = snap.docs.map((d) => ({
        id: d.id,
        ref: d.ref,
        data: d.data() as Record<string, any>,
      }));

      const broken = allDocs
        .filter((entry) => !isValidSequentialLeadId(entry.data.propertyId))
        .sort((a, b) => {
          const ta = Date.parse(String(a.data.createdAt || "")) || 0;
          const tb = Date.parse(String(b.data.createdAt || "")) || 0;
          return ta - tb;
        });

      if (broken.length === 0) return 0;

      let nextNum = getMaxNumericSharedLeadNumber(
        allDocs.map((entry) => ({ propertyId: entry.data.propertyId }))
      );

      let updatedCount = 0;
      for (const entry of broken) {
        nextNum += 1;
        const newPropId = `L${nextNum}`;
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

      const counterRef = doc(db, AUTO_CRAWL_CONFIG_COLLECTION, AUTO_CRAWL_COUNTERS_DOC_ID);
      await runTransaction(db, async (tx) => {
        const counterSnap = await tx.get(counterRef);
        const storedVal =
          counterSnap.exists() && typeof counterSnap.data()?.lead === "number"
            ? Math.max(0, Math.floor(counterSnap.data().lead))
            : 0;
        if (nextNum > storedVal) {
          tx.set(
            counterRef,
            {
              lead: nextNum,
              updatedBy: auth.currentUser?.email || "super_admin",
              updatedAt: new Date().toISOString(),
            },
            { merge: true }
          );
        }
      });

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

    let titleRule = automationSettingsService.getCachedTitleRule();
    try {
      const platformRuleRecord = await automationSettingsService.fetchPlatformDefaultTitleRule();
      if (platformRuleRecord?.titleRule) {
        titleRule = platformRuleRecord.titleRule;
      }
    } catch {
      // Fallback to cached default rule
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
        titleAutomationRule: titleRule,
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

    const reservedIds = await this.reserveSequentialLeadIds(itemsToSave.length, existingLeads);

    for (let i = 0; i < itemsToSave.length; i++) {
      const { item, idx } = itemsToSave[i];
      const docId = buildSharedLeadDocId(String(item.url || ""), idx);
      const propertyId = reservedIds[i] || `L${i + 1}`;
      const nowIso = new Date().toISOString();

      let finalTitle = clampString(item.title, 500, "Anunț OLX");
      let finalExtractedData = item.extractedData || undefined;
      const automationSource = finalExtractedData?.automationSource;
      if (titleRule?.enabled && automationSource) {
        const rebuilt = buildTitleFromAutomationRule(titleRule, {
          ...automationSource,
          propertyId,
        });
        if (rebuilt) {
          const oldTitle = finalTitle;
          finalTitle = clampString(rebuilt, 500, finalTitle);
          if (finalExtractedData?.crmData?.descriere) {
            const updatedDescriere = {
              ...finalExtractedData.crmData.descriere,
              titlu: finalTitle,
            };
            if (oldTitle && typeof updatedDescriere.continut === "string") {
              updatedDescriere.continut = updatedDescriere.continut.replace(oldTitle, finalTitle);
            }
            finalExtractedData = {
              ...finalExtractedData,
              crmData: {
                ...finalExtractedData.crmData,
                descriere: updatedDescriere,
              },
            };
          }
        }
      }

      const safeImages = Array.isArray(item.images)
        ? item.images.filter((u: unknown) => typeof u === "string" && u.trim().length > 0).slice(0, 100)
        : [];

      const resolvedZone = resolveAreaFromAd({
        rawZone: item.zone,
        city: finalExtractedData?.crmData?.detaliiGenerale?.localizare?.oras || "București",
        title: finalExtractedData?.olxMeta?.originalTitle || item.title || finalTitle,
        description: finalExtractedData?.originalDescription || item.notes || "",
        url: item.url,
      });

      const docPayload = stripUndefinedDeep({
        id: docId,
        propertyId,
        url: clampString(item.url, 2048),
        title: finalTitle,
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
        notes: clampString(item.notes, 10000),
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
        await setDoc(doc(db, SHARED_LEADS_COLLECTION, docId), docPayload);
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
};
