import fs from "fs";
import path from "path";
import { PersistentStoreService } from "../../src/core/database/svc_persistent-store";
import { StorageMetadataRepository } from "../../src/core/storage/repo_storage-metadata";

export type QuotaCategory = "ai" | "firestore" | "storage" | "network" | "runtime";

export interface DailyQuotaResource {
  id: string;
  label: string;
  shortLabel: string;
  category: QuotaCategory;
  used: number;
  limit: number;
  remaining: number;
  percent: number;
  unit: string;
  exact: boolean;
  detail?: string;
}

export interface DailyQuotaSnapshot {
  dateKeyPt: string;
  timezone: "America/Los_Angeles";
  resetAtIso: string;
  updatedAtIso: string;
  pollIntervalSec: number;
  resources: DailyQuotaResource[];
}

interface DailyQuotaState {
  dateKeyPt: string;
  aiPromptTokens: number;
  aiOutputTokens: number;
  aiTotalTokens: number;
  aiRequests: number;
  aiLastModel: string;
  aiVoiceSessions: number;
  firestoreServerReads: number;
  firestoreClientReads: number;
  firestoreServerWrites: number;
  firestoreClientWrites: number;
  firestoreServerDeletes: number;
  firestoreClientDeletes: number;
  mediaEgressBytes: number;
  imageTransforms: number;
  crawlerRequests: number;
  fcmMessages: number;
}

const PT_TIMEZONE = "America/Los_Angeles";
const CHECKPOINT_FILE = path.join(process.cwd(), ".data", "dev-daily-quota.json");

function parsePositiveEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function getPtDateKey(now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: PT_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/**
 * Computes the next midnight Pacific Time (America/Los_Angeles) UTC timestamp,
 * handling PST/PDT transitions without external timezone libraries.
 */
function getNextPtMidnightIso(now: Date = new Date()): string {
  const currentKey = getPtDateKey(now);
  // Step forward in 1-hour increments up to 26h to find the exact hour when PT date changes
  const baseMs = Math.floor(now.getTime() / 3_600_000) * 3_600_000;
  for (let h = 1; h <= 26; h++) {
    const candidate = new Date(baseMs + h * 3_600_000);
    if (getPtDateKey(candidate) !== currentKey) {
      return candidate.toISOString();
    }
  }
  return new Date(now.getTime() + 24 * 3_600_000).toISOString();
}

function createEmptyState(dateKeyPt: string): DailyQuotaState {
  return {
    dateKeyPt,
    aiPromptTokens: 0,
    aiOutputTokens: 0,
    aiTotalTokens: 0,
    aiRequests: 0,
    aiLastModel: "",
    aiVoiceSessions: 0,
    firestoreServerReads: 0,
    firestoreClientReads: 0,
    firestoreServerWrites: 0,
    firestoreClientWrites: 0,
    firestoreServerDeletes: 0,
    firestoreClientDeletes: 0,
    mediaEgressBytes: 0,
    imageTransforms: 0,
    crawlerRequests: 0,
    fcmMessages: 0,
  };
}

function roundToTwo(n: number): number {
  return Math.round(n * 100) / 100;
}

function clampNonNegInt(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.floor(v);
}

function formatCompactCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

export class DailyQuotaTracker {
  private static state: DailyQuotaState | null = null;
  private static flushTimer: ReturnType<typeof setTimeout> | null = null;
  private static clockOverride: (() => Date) | null = null;

  private static now(): Date {
    return this.clockOverride ? this.clockOverride() : new Date();
  }

  private static shouldUseDiskCheckpoint(): boolean {
    if (process.env.NODE_ENV === "test") return false;
    if (String(process.env.DISABLE_DEV_QUOTA_CHECKPOINT || "").toLowerCase() === "true") {
      return false;
    }
    return true;
  }

  private static ensureState(): DailyQuotaState {
    const todayKey = getPtDateKey(this.now());

    if (!this.state) {
      if (this.shouldUseDiskCheckpoint()) {
        try {
          if (fs.existsSync(CHECKPOINT_FILE)) {
            const raw = fs.readFileSync(CHECKPOINT_FILE, "utf8");
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object" && parsed.dateKeyPt === todayKey) {
              this.state = {
                ...createEmptyState(todayKey),
                ...parsed,
                dateKeyPt: todayKey,
              };
              return this.state;
            }
          }
        } catch {
          // Ignore corrupt/missing checkpoint file
        }
      }
      this.state = createEmptyState(todayKey);
      return this.state;
    }

    if (this.state.dateKeyPt !== todayKey) {
      this.state = createEmptyState(todayKey);
      this.scheduleFlush();
    }

    return this.state;
  }

  private static scheduleFlush(): void {
    if (!this.shouldUseDiskCheckpoint()) return;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (!this.state) return;
      try {
        const dir = path.dirname(CHECKPOINT_FILE);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(this.state), "utf8");
      } catch {
        // Non-fatal in read-only / Cloud Run containers
      }
    }, 15_000);
    if (typeof (this.flushTimer as any).unref === "function") {
      (this.flushTimer as any).unref();
    }
  }

  /**
   * Records a Gemini / AI Studio request and its prompt/output/total token consumption.
   */
  public static recordAiUsage(params: {
    model?: string;
    promptTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    requests?: number;
  }): void {
    const s = this.ensureState();
    const reqCount = params.requests !== undefined ? clampNonNegInt(params.requests) : 1;
    const prompt = clampNonNegInt(params.promptTokens);
    const output = clampNonNegInt(params.outputTokens);
    const total = Math.max(clampNonNegInt(params.totalTokens), prompt + output);

    s.aiRequests += reqCount;
    s.aiPromptTokens += prompt;
    s.aiOutputTokens += output;
    s.aiTotalTokens += total;
    if (params.model) {
      s.aiLastModel = String(params.model).slice(0, 64);
    }
    this.scheduleFlush();
  }

  /**
   * Extracts exact token counts from a @google/genai response (`response.usageMetadata`)
   * with a safe character-length fallback when SDK metadata is absent.
   */
  public static recordGeminiResponse(params: {
    model: string;
    response: any;
    fallbackPromptChars?: number;
    fallbackOutputChars?: number;
  }): void {
    const meta = params.response?.usageMetadata;
    const promptTokens =
      typeof meta?.promptTokenCount === "number" && meta.promptTokenCount >= 0
        ? meta.promptTokenCount
        : params.fallbackPromptChars
          ? Math.ceil(params.fallbackPromptChars / 4)
          : 0;
    const outputTokens =
      typeof meta?.candidatesTokenCount === "number" && meta.candidatesTokenCount >= 0
        ? meta.candidatesTokenCount
        : params.fallbackOutputChars
          ? Math.ceil(params.fallbackOutputChars / 4)
          : 0;
    const totalTokens =
      typeof meta?.totalTokenCount === "number" && meta.totalTokenCount >= 0
        ? meta.totalTokenCount
        : promptTokens + outputTokens;

    this.recordAiUsage({
      model: params.model,
      promptTokens,
      outputTokens,
      totalTokens,
      requests: 1,
    });
  }

  public static recordAiVoiceSession(count = 1): void {
    const s = this.ensureState();
    s.aiVoiceSessions += clampNonNegInt(count);
    this.scheduleFlush();
  }

  public static recordFirestoreOps(params: {
    reads?: number;
    writes?: number;
    deletes?: number;
    source?: "server" | "client";
  }): void {
    const s = this.ensureState();
    const reads = clampNonNegInt(params.reads);
    const writes = clampNonNegInt(params.writes);
    const deletes = clampNonNegInt(params.deletes);
    if (reads === 0 && writes === 0 && deletes === 0) return;

    if (params.source === "client") {
      // Cap single client delta submission to prevent runaway/spoofed counters
      s.firestoreClientReads += Math.min(reads, 10_000);
      s.firestoreClientWrites += Math.min(writes, 2_000);
      s.firestoreClientDeletes += Math.min(deletes, 2_000);
    } else {
      s.firestoreServerReads += reads;
      s.firestoreServerWrites += writes;
      s.firestoreServerDeletes += deletes;
    }
    this.scheduleFlush();
  }

  public static recordMediaEgress(bytes: number): void {
    const n = clampNonNegInt(bytes);
    if (n === 0) return;
    const s = this.ensureState();
    s.mediaEgressBytes += n;
    this.scheduleFlush();
  }

  public static recordImageTransform(count = 1): void {
    const n = clampNonNegInt(count);
    if (n === 0) return;
    const s = this.ensureState();
    s.imageTransforms += n;
    this.scheduleFlush();
  }

  public static recordCrawlerRequest(count = 1): void {
    const n = clampNonNegInt(count);
    if (n === 0) return;
    const s = this.ensureState();
    s.crawlerRequests += n;
    this.scheduleFlush();
  }

  public static recordFcmPush(count = 1): void {
    const n = clampNonNegInt(count);
    if (n === 0) return;
    const s = this.ensureState();
    s.fcmMessages += n;
    this.scheduleFlush();
  }

  private static computeStorageUsedMb(): { mb: number; fileCount: number } {
    try {
      const items = StorageMetadataRepository.listAllActive();
      let totalBytes = 0;
      for (const item of items) {
        totalBytes += Number(item?.sizeBytes || 0);
      }
      return {
        mb: roundToTwo(totalBytes / (1024 * 1024)),
        fileCount: items.length,
      };
    } catch {
      return { mb: 0, fileCount: 0 };
    }
  }

  private static buildResource(params: {
    id: string;
    label: string;
    shortLabel: string;
    category: QuotaCategory;
    used: number;
    limit: number;
    unit: string;
    exact: boolean;
    detail?: string;
  }): DailyQuotaResource {
    const safeLimit = Math.max(1, params.limit);
    const safeUsed = Math.max(0, params.used);
    const remaining = roundToTwo(Math.max(0, safeLimit - safeUsed));
    const percent = roundToTwo(Math.min(100, (safeUsed / safeLimit) * 100));
    return {
      id: params.id,
      label: params.label,
      shortLabel: params.shortLabel,
      category: params.category,
      used: roundToTwo(safeUsed),
      limit: safeLimit,
      remaining,
      percent,
      unit: params.unit,
      exact: params.exact,
      detail: params.detail,
    };
  }

  /**
   * Builds the live snapshot strictly from RAM (0 Firestore reads, 0 AI calls).
   */
  public static getSnapshot(): DailyQuotaSnapshot {
    const now = this.now();
    const s = this.ensureState();

    const aiTokensLimit = parsePositiveEnvInt("QUOTA_LIMIT_AI_TOKENS_DAILY", 1_000_000);
    const aiRequestsLimit = parsePositiveEnvInt("QUOTA_LIMIT_AI_REQUESTS_DAILY", 1_500);
    const firestoreReadsLimit = parsePositiveEnvInt("QUOTA_LIMIT_FIRESTORE_READS_DAILY", 50_000);
    const firestoreWritesLimit = parsePositiveEnvInt("QUOTA_LIMIT_FIRESTORE_WRITES_DAILY", 20_000);
    const firestoreDeletesLimit = parsePositiveEnvInt("QUOTA_LIMIT_FIRESTORE_DELETES_DAILY", 20_000);
    const mediaEgressLimitMb = parsePositiveEnvInt("QUOTA_LIMIT_MEDIA_EGRESS_MB_DAILY", 1_024);
    const storageLimitMb = parsePositiveEnvInt("QUOTA_LIMIT_STORAGE_MB", 5_120);
    const imageTransformsLimit = parsePositiveEnvInt("QUOTA_LIMIT_IMAGE_TRANSFORMS_DAILY", 2_000);
    const crawlerLimit = parsePositiveEnvInt("QUOTA_LIMIT_CRAWLER_REQUESTS_DAILY", 5_000);
    const fcmLimit = parsePositiveEnvInt("QUOTA_LIMIT_FCM_DAILY", 1_000);
    const aiVoiceLimit = parsePositiveEnvInt("QUOTA_LIMIT_AI_VOICE_DAILY", 100);
    const serverRamLimitMb = parsePositiveEnvInt("SERVER_MEMORY_LIMIT_MB", 512);

    const totalReads = s.firestoreServerReads + s.firestoreClientReads;
    const totalWrites = s.firestoreServerWrites + s.firestoreClientWrites;
    const totalDeletes = s.firestoreServerDeletes + s.firestoreClientDeletes;
    const mediaEgressMb = roundToTwo(s.mediaEgressBytes / (1024 * 1024));
    const storageInfo = this.computeStorageUsedMb();
    const mem = process.memoryUsage();
    const rssMb = roundToTwo(mem.rss / (1024 * 1024));
    const heapMb = roundToTwo(mem.heapUsed / (1024 * 1024));

    const aiTokenDetail = `In ${formatCompactCount(s.aiPromptTokens)} · Out ${formatCompactCount(
      s.aiOutputTokens
    )}${s.aiLastModel ? ` · ${s.aiLastModel}` : ""}`;

    const resources: DailyQuotaResource[] = [
      this.buildResource({
        id: "ai_studio_tokens",
        label: "AI Studio Tokens",
        shortLabel: "AI Tokens",
        category: "ai",
        used: s.aiTotalTokens,
        limit: aiTokensLimit,
        unit: "tok",
        exact: true,
        detail: aiTokenDetail,
      }),
      this.buildResource({
        id: "ai_studio_requests",
        label: "AI Studio Requests",
        shortLabel: "AI Req",
        category: "ai",
        used: s.aiRequests,
        limit: aiRequestsLimit,
        unit: "req",
        exact: true,
        detail: s.aiLastModel ? `Model: ${s.aiLastModel}` : "Gemini API daily calls",
      }),
      this.buildResource({
        id: "firestore_reads",
        label: "Firestore Reads",
        shortLabel: "FS Reads",
        category: "firestore",
        used: totalReads,
        limit: firestoreReadsLimit,
        unit: "reads",
        exact: true,
        detail: `Srv ${formatCompactCount(s.firestoreServerReads)} · Cli ${formatCompactCount(
          s.firestoreClientReads
        )}`,
      }),
      this.buildResource({
        id: "firestore_writes",
        label: "Firestore Writes",
        shortLabel: "FS Writes",
        category: "firestore",
        used: totalWrites,
        limit: firestoreWritesLimit,
        unit: "writes",
        exact: true,
        detail: `Srv ${formatCompactCount(s.firestoreServerWrites)} · Cli ${formatCompactCount(
          s.firestoreClientWrites
        )}`,
      }),
      this.buildResource({
        id: "firestore_deletes",
        label: "Firestore Deletes",
        shortLabel: "FS Del",
        category: "firestore",
        used: totalDeletes,
        limit: firestoreDeletesLimit,
        unit: "del",
        exact: true,
        detail: `Srv ${formatCompactCount(s.firestoreServerDeletes)} · Cli ${formatCompactCount(
          s.firestoreClientDeletes
        )}`,
      }),
      this.buildResource({
        id: "media_egress_mb",
        label: "Media Bandwidth",
        shortLabel: "Egress",
        category: "storage",
        used: mediaEgressMb,
        limit: mediaEgressLimitMb,
        unit: "MB",
        exact: true,
        detail: "Served public & storage media today",
      }),
      this.buildResource({
        id: "storage_used_mb",
        label: "Media Storage",
        shortLabel: "Storage",
        category: "storage",
        used: storageInfo.mb,
        limit: storageLimitMb,
        unit: "MB",
        exact: false,
        detail: `${storageInfo.fileCount} active files indexed`,
      }),
      this.buildResource({
        id: "image_transforms",
        label: "Image Transforms",
        shortLabel: "Img Ops",
        category: "storage",
        used: s.imageTransforms,
        limit: imageTransformsLimit,
        unit: "ops",
        exact: true,
        detail: "WebP variants, OG cards & watermarks",
      }),
      this.buildResource({
        id: "crawler_fetches",
        label: "External Crawlers",
        shortLabel: "Crawler",
        category: "network",
        used: s.crawlerRequests,
        limit: crawlerLimit,
        unit: "req",
        exact: true,
        detail: "OLX / Storia / Publi24 / upstream fetches",
      }),
      this.buildResource({
        id: "fcm_messages",
        label: "Push Alerts (FCM)",
        shortLabel: "FCM",
        category: "network",
        used: s.fcmMessages,
        limit: fcmLimit,
        unit: "msg",
        exact: true,
        detail: "Firebase Cloud Messaging dispatches",
      }),
      this.buildResource({
        id: "ai_voice_sessions",
        label: "AI Voice Sessions",
        shortLabel: "AI Voice",
        category: "ai",
        used: s.aiVoiceSessions,
        limit: aiVoiceLimit,
        unit: "ses",
        exact: true,
        detail: "Gemini Live VoIP sessions",
      }),
      this.buildResource({
        id: "server_ram_mb",
        label: "Server RAM (Live)",
        shortLabel: "RAM",
        category: "runtime",
        used: rssMb,
        limit: serverRamLimitMb,
        unit: "MB",
        exact: true,
        detail: `Heap ${heapMb} MB · RSS ${rssMb} MB`,
      }),
    ];

    return {
      dateKeyPt: s.dateKeyPt,
      timezone: PT_TIMEZONE,
      resetAtIso: getNextPtMidnightIso(now),
      updatedAtIso: now.toISOString(),
      pollIntervalSec: 60,
      resources,
    };
  }

  /**
   * Test helpers (never called in production).
   */
  public static __resetForTests(clock?: () => Date): void {
    this.clockOverride = clock || null;
    this.state = createEmptyState(getPtDateKey(this.now()));
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
}

// Automatically observe all server-side Firestore REST reads, writes, and deletes
PersistentStoreService.setFirestoreOpObserver((ops) => {
  DailyQuotaTracker.recordFirestoreOps({
    reads: ops.reads,
    writes: ops.writes,
    deletes: ops.deletes,
    source: "server",
  });
});

