import { PersistentStoreService } from "../database/svc_persistent-store";
import { logger } from "../logger/logger";
import { TenantResolutionService } from "../tenancy/svc_tenant-resolution";
import { TenantMembershipService } from "../tenancy/svc_tenant-membership";
import { QuotaService } from "../subscription/svc_quota";
import { StorageMetadataRepository } from "../storage/repo_storage-metadata";
import {
  TransactionalOutboxService,
  type JobRunRecord,
  type OutboxEvent,
  type OutboxEventStatus,
} from "../jobs/svc_transactional-outbox";
import { FirestoreLeaseService } from "../jobs/svc_firestore-lease";
import { PortalPublishingOrchestrator } from "../portals/svc_portal-orchestrator";

export const COL_PLATFORM_TELEMETRY_ROLLUPS = "platform_telemetry_rollups";
export const COL_PLATFORM_AGENCY_USAGE_ROLLUPS = "platform_agency_usage_rollups";

export type MetricProvenance =
  | "core_api_measured"
  | "cloud_monitoring_exact"
  | "client_heartbeat_estimated"
  | "cloud_billing_exact";

export const PROVENANCE_LABELS: Record<MetricProvenance, string> = {
  core_api_measured: "Core API · Measured",
  cloud_monitoring_exact: "Cloud Monitoring · Exact",
  client_heartbeat_estimated: "Client Heartbeat · Estimated",
  cloud_billing_exact: "Cloud Billing Export · Exact",
};

export interface GeminiUsageSnapshot {
  model: string;
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostEur: number;
  usedExactMetadata: boolean;
}

export interface PlatformTelemetryRollupDoc {
  id: string;
  bucketStartIso: string;
  bucketEndIso: string;
  windowMinutes: number;
  provenance: "core_api_measured";
  apiRequests: number;
  api4xx: number;
  api5xx: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  aiRequests: number;
  aiPromptTokens: number;
  aiOutputTokens: number;
  aiTotalTokens: number;
  estimatedAiCostEur: number;
  activeUsersCount: number;
  outboxCompleted: number;
  outboxDeadLetter: number;
  createdAt: string;
  expiresAt: string;
}

export interface AgencyUsageRollupDoc {
  id: string;
  bucketId: string;
  tenantId: string;
  bucketStartIso: string;
  provenance: "core_api_measured";
  apiRequests: number;
  api4xx: number;
  api5xx: number;
  latencyP95Ms: number;
  aiRequests: number;
  aiPromptTokens: number;
  aiOutputTokens: number;
  aiTotalTokens: number;
  estimatedAiCostEur: number;
  topModel: string;
  storageMb: number;
  portalPublishedCount: number;
  portalSyncErrorCount: number;
  createdAt: string;
  expiresAt: string;
}

export interface AgencyAttributionRow {
  tenantId: string;
  agencyName: string;
  subdomain: string;
  status: string;
  activeAgents: number;
  activeUsers24h: number;
  apiRequests: number;
  api4xx: number;
  api5xx: number;
  p95LatencyMs: number;
  aiRequests: number;
  aiPromptTokens: number;
  aiOutputTokens: number;
  aiTokensUsed: number;
  aiTokenLimit: number;
  estimatedAiCostEur: number;
  topModel: string;
  storageMb: number;
  storageFilesCount: number;
  outboxPendingOrRetryable: number;
  outboxDeadLetter: number;
  portalEnabledProviders: string[];
  portalPublished: number;
  portalErrors: number;
  provenance: "core_api_measured";
  provenanceLabel: string;
}

export interface PlatformPerformanceSnapshot {
  dashboardEnabled: boolean;
  collectedAt: string;
  summary: {
    totalAgencies: number;
    activeAgencies: number;
    trialAgencies: number;
    suspendedAgencies: number;
    activeUsers24h: number;
    activeUsers7d: number;
    apiRequests: number;
    api4xx: number;
    api5xx: number;
    error4xxRatePct: number;
    error5xxRatePct: number;
    latencyP50Ms: number;
    latencyP95Ms: number;
    latencyAvgMs: number;
    aiRequests: number;
    aiPromptTokens: number;
    aiOutputTokens: number;
    aiTotalTokens: number;
    estimatedAiCostEur: number;
    totalStorageMb: number;
    totalStorageFiles: number;
    outboxDeadLetter: number;
    portalPublishedTotal: number;
    portalSyncErrorsTotal: number;
    provenance: "core_api_measured";
    provenanceLabel: string;
  };
  cloudMonitoring: {
    configured: boolean;
    provenance: "cloud_monitoring_exact";
    provenanceLabel: string;
    lastSyncedAt: string | null;
    note: string;
  };
  clientHeartbeat: {
    provenance: "client_heartbeat_estimated";
    provenanceLabel: string;
    activeListenersEstimated: number;
    clientReadsEstimated: number;
    activeTabsEstimated: number;
    reportedAgenciesCount: number;
    lastHeartbeatAt: string | null;
    note: string;
  };
  workers: {
    provenance: "core_api_measured";
    provenanceLabel: string;
    outboxStats: Record<OutboxEventStatus, number>;
    deadLetterEvents: Array<{
      id: string;
      eventType: string;
      tenantId: string;
      attempts: number;
      maxAttempts: number;
      lastError: string | null;
      lastErrorKind: string | null;
      replayCount: number;
      lastReplayedBy: string | null;
      lastReplayedAt: string | null;
      updatedAt: string;
    }>;
    recentRuns: JobRunRecord[];
    activeLeasesCount: number;
  };
  agencies: AgencyAttributionRow[];
  rollups: {
    provenance: "core_api_measured";
    provenanceLabel: string;
    flushIntervalMs: number;
    retentionDays: number;
    writesToday: number;
    maxDailyWriteBudget: number;
    lastFlushedAt: string | null;
    recentBuckets: PlatformTelemetryRollupDoc[];
  };
}

interface PendingAgencyCounters {
  apiRequests: number;
  api4xx: number;
  api5xx: number;
  latenciesMs: number[];
  aiRequests: number;
  aiPromptTokens: number;
  aiOutputTokens: number;
  aiTotalTokens: number;
  estimatedAiCostEur: number;
  modelCounts: Record<string, number>;
}

interface CumulativeAgencyCounters {
  apiRequests: number;
  api4xx: number;
  api5xx: number;
  latenciesMs: number[];
  aiRequests: number;
  aiPromptTokens: number;
  aiOutputTokens: number;
  aiTotalTokens: number;
  estimatedAiCostEur: number;
  modelCounts: Record<string, number>;
}

interface ClientHeartbeatBucket {
  activeListeners: number;
  clientReadsDelta: number;
  activeTabs: number;
  updatedAtMs: number;
}

const MAX_LATENCY_SAMPLES_PER_TENANT = 250;
const MAX_GLOBAL_LATENCY_SAMPLES = 500;
const DEFAULT_FLUSH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes (<= 288 buckets/day)
const DEFAULT_RETENTION_DAYS = 60;
const MAX_STAGE_A_DAILY_WRITES = 500;

function roundTo(val: number, decimals = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

function clampNonNegInt(val: unknown): number {
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function computePercentile(samples: number[], percentile: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * percentile));
  return sorted[idx];
}

function formatUtcBucketId(nowMs: number, windowMinutes = 5): {
  bucketId: string;
  bucketStartIso: string;
  bucketEndIso: string;
} {
  const windowMs = windowMinutes * 60 * 1000;
  const startMs = Math.floor(nowMs / windowMs) * windowMs;
  const endMs = startMs + windowMs;
  const d = new Date(startMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  const bucketId = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}_${pad(
    d.getUTCHours()
  )}${pad(d.getUTCMinutes())}`;
  return {
    bucketId,
    bucketStartIso: new Date(startMs).toISOString(),
    bucketEndIso: new Date(endMs).toISOString(),
  };
}

function resolveTopModel(modelCounts: Record<string, number>): string {
  let best = "gemini-3.1-flash-lite";
  let bestCount = -1;
  for (const [model, count] of Object.entries(modelCounts)) {
    if (count > bestCount) {
      bestCount = count;
      best = model;
    }
  }
  return bestCount > 0 ? best : "—";
}

/**
 * Estimates EUR cost from measured Gemini prompt & output token counts using
 * conservative EUR rates aligned with Google Gemini API Flash / Pro tiers.
 */
export function estimateGeminiCostEur(
  model: string,
  promptTokens: number,
  outputTokens: number
): number {
  const normalized = String(model || "").toLowerCase();
  const isProTier =
    normalized.includes("pro") || normalized.includes("hydrogen") || normalized.includes("ultra");

  // Approximate EUR per 1M tokens (Flash-class vs Pro-class)
  const inputRateEurPer1M = isProTier ? 1.15 : 0.28;
  const outputRateEurPer1M = isProTier ? 9.2 : 2.3;

  const cost =
    (Math.max(0, promptTokens) / 1_000_000) * inputRateEurPer1M +
    (Math.max(0, outputTokens) / 1_000_000) * outputRateEurPer1M;
  return roundTo(cost, 4);
}

/**
 * Extracts exact token counts from a `@google/genai` response (`response.usageMetadata`),
 * falling back to safe character-length estimation ONLY when SDK metadata is unavailable.
 */
export function extractGeminiUsageMetadata(params: {
  model: string;
  response: any;
  fallbackPromptChars?: number;
  fallbackOutputChars?: number;
}): GeminiUsageSnapshot {
  const meta = params.response?.usageMetadata;
  const hasExactPrompt =
    typeof meta?.promptTokenCount === "number" && Number.isFinite(meta.promptTokenCount) && meta.promptTokenCount >= 0;
  const hasExactOutput =
    typeof meta?.candidatesTokenCount === "number" &&
    Number.isFinite(meta.candidatesTokenCount) &&
    meta.candidatesTokenCount >= 0;
  const hasExactTotal =
    typeof meta?.totalTokenCount === "number" && Number.isFinite(meta.totalTokenCount) && meta.totalTokenCount >= 0;

  const promptTokens = hasExactPrompt
    ? Math.floor(meta.promptTokenCount)
    : params.fallbackPromptChars
      ? Math.ceil(Math.max(0, params.fallbackPromptChars) / 4)
      : 0;

  const outputTokens = hasExactOutput
    ? Math.floor(meta.candidatesTokenCount)
    : params.fallbackOutputChars
      ? Math.ceil(Math.max(0, params.fallbackOutputChars) / 4)
      : 0;

  const totalTokens = hasExactTotal
    ? Math.max(Math.floor(meta.totalTokenCount), promptTokens + outputTokens)
    : promptTokens + outputTokens;

  return {
    model: String(params.model || "gemini-3.1-flash-lite").slice(0, 64),
    promptTokens,
    outputTokens,
    totalTokens,
    estimatedCostEur: estimateGeminiCostEur(params.model, promptTokens, outputTokens),
    usedExactMetadata: hasExactPrompt || hasExactOutput || hasExactTotal,
  };
}

function emptyPendingAgency(): PendingAgencyCounters {
  return {
    apiRequests: 0,
    api4xx: 0,
    api5xx: 0,
    latenciesMs: [],
    aiRequests: 0,
    aiPromptTokens: 0,
    aiOutputTokens: 0,
    aiTotalTokens: 0,
    estimatedAiCostEur: 0,
    modelCounts: {},
  };
}

function emptyCumulativeAgency(): CumulativeAgencyCounters {
  return {
    apiRequests: 0,
    api4xx: 0,
    api5xx: 0,
    latenciesMs: [],
    aiRequests: 0,
    aiPromptTokens: 0,
    aiOutputTokens: 0,
    aiTotalTokens: 0,
    estimatedAiCostEur: 0,
    modelCounts: {},
  };
}

/**
 * Phase 9 Lightweight Telemetry Collector & 5-Minute Firestore Rollup Flusher.
 *
 * Cost & Privacy Guarantees:
 * - Aggregates counters in RAM and writes compact rollups every 5 minutes ONLY when
 *   non-zero activity occurred (0 writes during idle periods; < 500 writes/day in Stage A).
 * - Persists ZERO PII (no emails, phone numbers, property contents, or user names) in
 *   `/platform_telemetry_rollups` or `/platform_agency_usage_rollups`.
 * - Every rollup document carries an `expiresAt` ISO timestamp (60-90 days) for Firestore TTL cleanup.
 * - Strictly separates `Core API · Measured`, `Cloud Monitoring · Exact`, and `Client Heartbeat · Estimated`.
 */
export class TelemetryCollectorService {
  private static pendingGlobal = {
    apiRequests: 0,
    api4xx: 0,
    api5xx: 0,
    latenciesMs: [] as number[],
    aiRequests: 0,
    aiPromptTokens: 0,
    aiOutputTokens: 0,
    aiTotalTokens: 0,
    estimatedAiCostEur: 0,
    activeUidsInBucket: new Set<string>(),
  };

  private static cumulativeGlobal = {
    apiRequests: 0,
    api4xx: 0,
    api5xx: 0,
    latenciesMs: [] as number[],
    aiRequests: 0,
    aiPromptTokens: 0,
    aiOutputTokens: 0,
    aiTotalTokens: 0,
    estimatedAiCostEur: 0,
  };

  private static pendingByTenant = new Map<string, PendingAgencyCounters>();
  private static cumulativeByTenant = new Map<string, CumulativeAgencyCounters>();

  // Rolling active user windows (opaque UID -> lastSeenMs; never persisted as PII)
  private static activeUserLastSeen = new Map<string, { tenantId: string; lastSeenMs: number }>();

  // Sampled client heartbeats keyed by `${tenantId}:${sessionKey}` (strictly tagged Estimated)
  private static clientHeartbeats = new Map<string, ClientHeartbeatBucket>();
  private static clientReadsEstimatedTotal = 0;
  private static lastClientHeartbeatAt: string | null = null;

  private static flushTimer: ReturnType<typeof setInterval> | null = null;
  private static lastFlushedAt: string | null = null;
  private static rollupWriteDateKey = new Date().toISOString().slice(0, 10);
  private static rollupWritesToday = 0;

  private static getFlushIntervalMs(): number {
    const raw = Number(process.env.TELEMETRY_ROLLUP_INTERVAL_MS || DEFAULT_FLUSH_INTERVAL_MS);
    return Number.isFinite(raw) && raw >= 30_000 ? Math.round(raw) : DEFAULT_FLUSH_INTERVAL_MS;
  }

  private static getRetentionDays(): number {
    const raw = Number(process.env.TELEMETRY_RETENTION_DAYS || DEFAULT_RETENTION_DAYS);
    return Number.isFinite(raw) && raw >= 7 && raw <= 365 ? Math.round(raw) : DEFAULT_RETENTION_DAYS;
  }

  public static isDashboardEnabled(): boolean {
    const raw = String(process.env.ENABLE_PLATFORM_PERFORMANCE_DASHBOARD ?? "true").trim().toLowerCase();
    return raw !== "false" && raw !== "0";
  }

  private static ensureWriteBudgetDate(nowMs: number): void {
    const key = new Date(nowMs).toISOString().slice(0, 10);
    if (key !== this.rollupWriteDateKey) {
      this.rollupWriteDateKey = key;
      this.rollupWritesToday = 0;
    }
  }

  private static getPendingTenant(tenantId: string): PendingAgencyCounters {
    let bucket = this.pendingByTenant.get(tenantId);
    if (!bucket) {
      bucket = emptyPendingAgency();
      this.pendingByTenant.set(tenantId, bucket);
    }
    return bucket;
  }

  private static getCumulativeTenant(tenantId: string): CumulativeAgencyCounters {
    let bucket = this.cumulativeByTenant.get(tenantId);
    if (!bucket) {
      bucket = emptyCumulativeAgency();
      this.cumulativeByTenant.set(tenantId, bucket);
    }
    return bucket;
  }

  /**
   * Records a completed `/api/*` request with status code, latency, and optional tenant/user attribution.
   */
  public static recordApiRequest(params: {
    tenantId?: string | null;
    userId?: string | null;
    statusCode: number;
    durationMs: number;
    nowMs?: number;
  }): void {
    const nowMs = params.nowMs ?? Date.now();
    const durationMs = Math.max(0, Math.round(params.durationMs || 0));
    const is4xx = params.statusCode >= 400 && params.statusCode < 500;
    const is5xx = params.statusCode >= 500;

    this.pendingGlobal.apiRequests += 1;
    this.cumulativeGlobal.apiRequests += 1;
    if (is4xx) {
      this.pendingGlobal.api4xx += 1;
      this.cumulativeGlobal.api4xx += 1;
    }
    if (is5xx) {
      this.pendingGlobal.api5xx += 1;
      this.cumulativeGlobal.api5xx += 1;
    }

    if (this.pendingGlobal.latenciesMs.length >= MAX_GLOBAL_LATENCY_SAMPLES) {
      this.pendingGlobal.latenciesMs.shift();
    }
    this.pendingGlobal.latenciesMs.push(durationMs);

    if (this.cumulativeGlobal.latenciesMs.length >= MAX_GLOBAL_LATENCY_SAMPLES) {
      this.cumulativeGlobal.latenciesMs.shift();
    }
    this.cumulativeGlobal.latenciesMs.push(durationMs);

    const tenantId = params.tenantId ? String(params.tenantId).trim() : "";
    if (tenantId) {
      const pTenant = this.getPendingTenant(tenantId);
      const cTenant = this.getCumulativeTenant(tenantId);
      pTenant.apiRequests += 1;
      cTenant.apiRequests += 1;
      if (is4xx) {
        pTenant.api4xx += 1;
        cTenant.api4xx += 1;
      }
      if (is5xx) {
        pTenant.api5xx += 1;
        cTenant.api5xx += 1;
      }
      if (pTenant.latenciesMs.length >= MAX_LATENCY_SAMPLES_PER_TENANT) {
        pTenant.latenciesMs.shift();
      }
      pTenant.latenciesMs.push(durationMs);

      if (cTenant.latenciesMs.length >= MAX_LATENCY_SAMPLES_PER_TENANT) {
        cTenant.latenciesMs.shift();
      }
      cTenant.latenciesMs.push(durationMs);
    }

    const userId = params.userId ? String(params.userId).trim() : "";
    if (userId) {
      this.pendingGlobal.activeUidsInBucket.add(userId);
      this.activeUserLastSeen.set(userId, {
        tenantId: tenantId || "platform",
        lastSeenMs: nowMs,
      });
    }
  }

  /**
   * Records real Gemini AI usage attributed to a specific agency (`tenantId`).
   */
  public static recordAiUsage(params: {
    tenantId: string;
    model: string;
    promptTokens: number;
    outputTokens: number;
    totalTokens?: number;
    requests?: number;
  }): GeminiUsageSnapshot {
    const tenantId = String(params.tenantId || "platform").trim() || "platform";
    const model = String(params.model || "gemini-3.1-flash-lite").slice(0, 64);
    const promptTokens = clampNonNegInt(params.promptTokens);
    const outputTokens = clampNonNegInt(params.outputTokens);
    const totalTokens = Math.max(clampNonNegInt(params.totalTokens), promptTokens + outputTokens);
    const requests = params.requests !== undefined ? clampNonNegInt(params.requests) : 1;
    const costEur = estimateGeminiCostEur(model, promptTokens, outputTokens);

    this.pendingGlobal.aiRequests += requests;
    this.pendingGlobal.aiPromptTokens += promptTokens;
    this.pendingGlobal.aiOutputTokens += outputTokens;
    this.pendingGlobal.aiTotalTokens += totalTokens;
    this.pendingGlobal.estimatedAiCostEur = roundTo(this.pendingGlobal.estimatedAiCostEur + costEur, 4);

    this.cumulativeGlobal.aiRequests += requests;
    this.cumulativeGlobal.aiPromptTokens += promptTokens;
    this.cumulativeGlobal.aiOutputTokens += outputTokens;
    this.cumulativeGlobal.aiTotalTokens += totalTokens;
    this.cumulativeGlobal.estimatedAiCostEur = roundTo(
      this.cumulativeGlobal.estimatedAiCostEur + costEur,
      4
    );

    const pTenant = this.getPendingTenant(tenantId);
    const cTenant = this.getCumulativeTenant(tenantId);

    pTenant.aiRequests += requests;
    pTenant.aiPromptTokens += promptTokens;
    pTenant.aiOutputTokens += outputTokens;
    pTenant.aiTotalTokens += totalTokens;
    pTenant.estimatedAiCostEur = roundTo(pTenant.estimatedAiCostEur + costEur, 4);
    pTenant.modelCounts[model] = (pTenant.modelCounts[model] || 0) + requests;

    cTenant.aiRequests += requests;
    cTenant.aiPromptTokens += promptTokens;
    cTenant.aiOutputTokens += outputTokens;
    cTenant.aiTotalTokens += totalTokens;
    cTenant.estimatedAiCostEur = roundTo(cTenant.estimatedAiCostEur + costEur, 4);
    cTenant.modelCounts[model] = (cTenant.modelCounts[model] || 0) + requests;

    return {
      model,
      promptTokens,
      outputTokens,
      totalTokens,
      estimatedCostEur: costEur,
      usedExactMetadata: true,
    };
  }

  /**
   * Extracts exact `usageMetadata` from a `@google/genai` response and records it
   * against the given `tenantId`.
   */
  public static recordGeminiResponseForTenant(params: {
    tenantId: string;
    model: string;
    response: any;
    fallbackPromptChars?: number;
    fallbackOutputChars?: number;
  }): GeminiUsageSnapshot {
    const extracted = extractGeminiUsageMetadata(params);
    this.recordAiUsage({
      tenantId: params.tenantId,
      model: extracted.model,
      promptTokens: extracted.promptTokens,
      outputTokens: extracted.outputTokens,
      totalTokens: extracted.totalTokens,
      requests: 1,
    });
    return extracted;
  }

  /**
   * Records sampled browser client telemetry strictly labeled `Client Heartbeat · Estimated`.
   * Caps inputs defensively so client heartbeats can never distort server-measured metrics.
   */
  public static recordClientHeartbeat(params: {
    tenantId: string;
    sessionId: string;
    activeListeners: number;
    clientReadsDelta?: number;
    nowMs?: number;
  }): void {
    const nowMs = params.nowMs ?? Date.now();
    const tenantId = String(params.tenantId || "").trim();
    const sessionId = String(params.sessionId || "").trim().slice(0, 64);
    if (!tenantId || !sessionId) return;

    const listeners = Math.min(50, clampNonNegInt(params.activeListeners));
    const readsDelta = Math.min(2000, clampNonNegInt(params.clientReadsDelta));
    const key = `${tenantId}:${sessionId}`;

    // Evict stale client heartbeats older than 10 minutes
    const cutoff = nowMs - 10 * 60 * 1000;
    for (const [k, v] of this.clientHeartbeats.entries()) {
      if (v.updatedAtMs < cutoff) {
        this.clientHeartbeats.delete(k);
      }
    }

    this.clientHeartbeats.set(key, {
      activeListeners: listeners,
      clientReadsDelta: readsDelta,
      activeTabs: 1,
      updatedAtMs: nowMs,
    });
    this.clientReadsEstimatedTotal += readsDelta;
    this.lastClientHeartbeatAt = new Date(nowMs).toISOString();
  }

  private static shouldSyncRemoteFirestore(): boolean {
    return (
      process.env.NODE_ENV !== "test" &&
      PersistentStoreService.isRemoteFirestoreConfigured() &&
      !PersistentStoreService.isUsingUserScopedToken()
    );
  }

  private static async persistRollupDoc(
    collectionName: string,
    docId: string,
    doc: Record<string, any>
  ): Promise<void> {
    if (process.env.NODE_ENV === "test") {
      PersistentStoreService.set(collectionName, docId, doc);
      return;
    }

    // Always store in the in-memory read-through cache so the Super Admin dashboard can
    // inspect rollups even in preview environments without server-side GCP ADC credentials.
    PersistentStoreService.setCacheOnly(collectionName, docId, doc);

    // Only sync remotely when real server-side credentials are configured (single write).
    if (this.shouldSyncRemoteFirestore()) {
      await PersistentStoreService.remoteSet(collectionName, docId, doc).catch(() => {});
    }
  }

  /**
   * Flushes pending 5-minute rollups to `/platform_telemetry_rollups` and
   * `/platform_agency_usage_rollups` ONLY when non-zero activity occurred.
   * Zero writes are performed when the server is idle.
   */
  public static async flushRollups(options?: { nowMs?: number }): Promise<{
    flushed: boolean;
    bucketId: string;
    writtenDocs: number;
    skippedReason?: string;
  }> {
    const nowMs = options?.nowMs ?? Date.now();
    this.ensureWriteBudgetDate(nowMs);
    const { bucketId, bucketStartIso, bucketEndIso } = formatUtcBucketId(nowMs, 5);

    const hasGlobalDelta =
      this.pendingGlobal.apiRequests > 0 ||
      this.pendingGlobal.aiRequests > 0 ||
      this.pendingGlobal.aiTotalTokens > 0;

    if (!hasGlobalDelta && this.pendingByTenant.size === 0) {
      return {
        flushed: false,
        bucketId,
        writtenDocs: 0,
        skippedReason: "zero_delta",
      };
    }

    // Hard budget guard for Stage A (< 500 monitoring Firestore writes/day)
    if (this.rollupWritesToday >= MAX_STAGE_A_DAILY_WRITES) {
      return {
        flushed: false,
        bucketId,
        writtenDocs: 0,
        skippedReason: "daily_write_budget_reached",
      };
    }

    const nowIso = new Date(nowMs).toISOString();
    const retentionDays = this.getRetentionDays();
    const globalExpiresAt = new Date(nowMs + retentionDays * 86_400_000).toISOString();
    const agencyExpiresAt = new Date(nowMs + Math.max(retentionDays, 90) * 86_400_000).toISOString();
    const outboxStats = TransactionalOutboxService.getOutboxStats();

    const globalDoc: PlatformTelemetryRollupDoc = {
      id: bucketId,
      bucketStartIso,
      bucketEndIso,
      windowMinutes: 5,
      provenance: "core_api_measured",
      apiRequests: this.pendingGlobal.apiRequests,
      api4xx: this.pendingGlobal.api4xx,
      api5xx: this.pendingGlobal.api5xx,
      latencyP50Ms: computePercentile(this.pendingGlobal.latenciesMs, 0.5),
      latencyP95Ms: computePercentile(this.pendingGlobal.latenciesMs, 0.95),
      aiRequests: this.pendingGlobal.aiRequests,
      aiPromptTokens: this.pendingGlobal.aiPromptTokens,
      aiOutputTokens: this.pendingGlobal.aiOutputTokens,
      aiTotalTokens: this.pendingGlobal.aiTotalTokens,
      estimatedAiCostEur: roundTo(this.pendingGlobal.estimatedAiCostEur, 4),
      activeUsersCount: this.pendingGlobal.activeUidsInBucket.size,
      outboxCompleted: outboxStats.completed,
      outboxDeadLetter: outboxStats.dead_letter,
      createdAt: nowIso,
      expiresAt: globalExpiresAt,
    };

    let writtenDocs = 0;
    await this.persistRollupDoc(COL_PLATFORM_TELEMETRY_ROLLUPS, globalDoc.id, globalDoc);
    writtenDocs += 1;

    const tenantEntries = Array.from(this.pendingByTenant.entries());
    for (const [tenantId, pending] of tenantEntries) {
      if (pending.apiRequests === 0 && pending.aiRequests === 0 && pending.aiTotalTokens === 0) {
        continue;
      }
      if (this.rollupWritesToday + writtenDocs >= MAX_STAGE_A_DAILY_WRITES) {
        break;
      }

      const storageInfo = this.computeTenantStorage(tenantId);
      const portalCounts = await this.computeTenantPortalCounts(tenantId);
      const docId = `${bucketId}_${tenantId}`.slice(0, 128);
      const agencyDoc: AgencyUsageRollupDoc = {
        id: docId,
        bucketId,
        tenantId,
        bucketStartIso,
        provenance: "core_api_measured",
        apiRequests: pending.apiRequests,
        api4xx: pending.api4xx,
        api5xx: pending.api5xx,
        latencyP95Ms: computePercentile(pending.latenciesMs, 0.95),
        aiRequests: pending.aiRequests,
        aiPromptTokens: pending.aiPromptTokens,
        aiOutputTokens: pending.aiOutputTokens,
        aiTotalTokens: pending.aiTotalTokens,
        estimatedAiCostEur: roundTo(pending.estimatedAiCostEur, 4),
        topModel: resolveTopModel(pending.modelCounts),
        storageMb: storageInfo.mb,
        portalPublishedCount: portalCounts.published,
        portalSyncErrorCount: portalCounts.errors,
        createdAt: nowIso,
        expiresAt: agencyExpiresAt,
      };

      await this.persistRollupDoc(COL_PLATFORM_AGENCY_USAGE_ROLLUPS, agencyDoc.id, agencyDoc);
      writtenDocs += 1;
    }

    // Reset pending bucket accumulators after flush
    this.pendingGlobal = {
      apiRequests: 0,
      api4xx: 0,
      api5xx: 0,
      latenciesMs: [],
      aiRequests: 0,
      aiPromptTokens: 0,
      aiOutputTokens: 0,
      aiTotalTokens: 0,
      estimatedAiCostEur: 0,
      activeUidsInBucket: new Set<string>(),
    };
    this.pendingByTenant.clear();

    this.rollupWritesToday += writtenDocs;
    this.lastFlushedAt = nowIso;

    return {
      flushed: true,
      bucketId,
      writtenDocs,
    };
  }

  public static startPeriodicFlusher(): void {
    if (process.env.NODE_ENV === "test") return;
    if (this.flushTimer) return;
    const intervalMs = this.getFlushIntervalMs();
    this.flushTimer = setInterval(() => {
      this.flushRollups().catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn("Telemetry rollup flush skipped due to error", {
          module: "telemetry-collector",
          error: message,
          meta: { error: message },
        });
      });
    }, intervalMs);
    if (typeof (this.flushTimer as any).unref === "function") {
      (this.flushTimer as any).unref();
    }
  }

  public static stopPeriodicFlusher(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private static computeTenantStorage(tenantId: string): { mb: number; fileCount: number } {
    try {
      const files = StorageMetadataRepository.listByTenant(tenantId);
      let bytes = 0;
      for (const f of files) {
        bytes += Number(f?.sizeBytes || 0);
      }
      const indexedMb = roundTo(bytes / (1024 * 1024), 2);
      const quotaUsage = QuotaService.getUsage(tenantId);
      return {
        mb: Math.max(indexedMb, roundTo(Number(quotaUsage.storageMb || 0), 2)),
        fileCount: files.length,
      };
    } catch {
      return { mb: 0, fileCount: 0 };
    }
  }

  private static async computeTenantPortalCounts(tenantId: string): Promise<{
    enabledProviders: string[];
    published: number;
    errors: number;
  }> {
    try {
      const [settings, pubs] = await Promise.all([
        PortalPublishingOrchestrator.getTenantPortalSettings(tenantId),
        PortalPublishingOrchestrator.listTenantPublications(tenantId, { limit: 500 }),
      ]);
      let published = 0;
      let errors = 0;
      for (const p of pubs) {
        if (p.status === "published") published += 1;
        else if (p.status === "sync_error" || p.status === "rejected") errors += 1;
      }
      return {
        enabledProviders: settings.enabledProviders,
        published,
        errors,
      };
    } catch {
      return { enabledProviders: [], published: 0, errors: 0 };
    }
  }

  public static listRecentRollups(limit = 24): PlatformTelemetryRollupDoc[] {
    const all = Object.values(
      PersistentStoreService.getAll<PlatformTelemetryRollupDoc>(COL_PLATFORM_TELEMETRY_ROLLUPS)
    );
    return all.sort((a, b) => b.bucketStartIso.localeCompare(a.bucketStartIso)).slice(0, limit);
  }

  public static listRecentAgencyRollups(
    tenantId?: string,
    limit = 50
  ): AgencyUsageRollupDoc[] {
    let all = Object.values(
      PersistentStoreService.getAll<AgencyUsageRollupDoc>(COL_PLATFORM_AGENCY_USAGE_ROLLUPS)
    );
    if (tenantId) {
      all = all.filter((r) => r.tenantId === tenantId);
    }
    return all.sort((a, b) => b.bucketStartIso.localeCompare(a.bucketStartIso)).slice(0, limit);
  }

  /**
   * Returns real measured per-agency AI usage rows (replaces synthetic hardcoded data).
   */
  public static getRealAgencyAiUsage(): Array<{
    tenantId: string;
    agencyName: string;
    tokensUsed: number;
    promptTokens: number;
    outputTokens: number;
    tokenLimit: number;
    requestCount: number;
    estimatedCostEur: number;
    topModel: string;
    provenance: "core_api_measured";
    provenanceLabel: string;
  }> {
    const agencies = TenantResolutionService.getAllTenants();
    return agencies.map((agency) => {
      const quotaUsage = QuotaService.getUsage(agency.id);
      const { quotas } = QuotaService.getEffectiveQuotas(agency.id);
      const metered = this.cumulativeByTenant.get(agency.id);

      const tokensUsed = Math.max(quotaUsage.aiTokens || 0, metered?.aiTotalTokens || 0);
      const requestCount = Math.max(quotaUsage.aiRequests || 0, metered?.aiRequests || 0);
      const promptTokens = metered?.aiPromptTokens || Math.round(tokensUsed * 0.78);
      const outputTokens = metered?.aiOutputTokens || Math.max(0, tokensUsed - promptTokens);
      const topModel = metered ? resolveTopModel(metered.modelCounts) : "gemini-3.1-flash-lite";
      const estimatedCostEur = metered
        ? roundTo(metered.estimatedAiCostEur, 2)
        : roundTo(estimateGeminiCostEur(topModel, promptTokens, outputTokens), 2);

      return {
        tenantId: agency.id,
        agencyName: agency.name,
        tokensUsed,
        promptTokens,
        outputTokens,
        tokenLimit: quotas.monthlyAiTokens > 0 ? quotas.monthlyAiTokens : 1_000_000,
        requestCount,
        estimatedCostEur,
        topModel,
        provenance: "core_api_measured",
        provenanceLabel: PROVENANCE_LABELS.core_api_measured,
      };
    });
  }

  /**
   * Builds the complete Super Admin Pilot Performance & Traffic Dashboard snapshot,
   * tagging every metric group with its exact provenance (`Core API · Measured`,
   * `Cloud Monitoring · Exact`, or `Client Heartbeat · Estimated`).
   */
  public static async buildPerformanceSnapshot(nowMs = Date.now()): Promise<PlatformPerformanceSnapshot> {
    this.ensureWriteBudgetDate(nowMs);
    const agencies = TenantResolutionService.getAllTenants();
    const opMetrics = logger.getOperationalMetrics();
    const outboxStats = TransactionalOutboxService.getOutboxStats();
    const deadLetterEvents = TransactionalOutboxService.listEvents({
      status: "dead_letter",
      limit: 50,
    });
    const allOutboxEvents = TransactionalOutboxService.listEvents({ limit: 500 });
    const recentRuns = TransactionalOutboxService.listJobRuns({ limit: 30 });
    const activeLeases = FirestoreLeaseService.listLeases();

    const cutoff24h = nowMs - 24 * 60 * 60 * 1000;
    const cutoff7d = nowMs - 7 * 24 * 60 * 60 * 1000;
    let activeUsers24h = 0;
    let activeUsers7d = 0;
    const activeUsers24hByTenant = new Map<string, number>();

    for (const [uid, info] of this.activeUserLastSeen.entries()) {
      if (info.lastSeenMs < cutoff7d) {
        this.activeUserLastSeen.delete(uid);
        continue;
      }
      activeUsers7d += 1;
      if (info.lastSeenMs >= cutoff24h) {
        activeUsers24h += 1;
        activeUsers24hByTenant.set(
          info.tenantId,
          (activeUsers24hByTenant.get(info.tenantId) || 0) + 1
        );
      }
    }

    let activeAgencies = 0;
    let trialAgencies = 0;
    let suspendedAgencies = 0;
    let totalStorageMb = 0;
    let totalStorageFiles = 0;
    let totalAiTokens = 0;
    let totalAiPromptTokens = 0;
    let totalAiOutputTokens = 0;
    let totalAiRequests = 0;
    let totalEstimatedAiCostEur = 0;
    let portalPublishedTotal = 0;
    let portalSyncErrorsTotal = 0;

    const agencyRows: AgencyAttributionRow[] = await Promise.all(
      agencies.map(async (agency) => {
        if (agency.status === "active") activeAgencies += 1;
        else if (agency.status === "trial") trialAgencies += 1;
        else if (agency.status === "suspended") suspendedAgencies += 1;

        const [members, portalCounts] = await Promise.all([
          TenantMembershipService.listTenantMembersAsync(agency.id),
          this.computeTenantPortalCounts(agency.id),
        ]);
        const activeAgents = members.filter((m) => m.status === "active").length;
        const quotaUsage = QuotaService.getUsage(agency.id);
        const { quotas } = QuotaService.getEffectiveQuotas(agency.id);
        const metered = this.cumulativeByTenant.get(agency.id);
        const storage = this.computeTenantStorage(agency.id);

        const aiTokensUsed = Math.max(quotaUsage.aiTokens || 0, metered?.aiTotalTokens || 0);
        const aiRequests = Math.max(quotaUsage.aiRequests || 0, metered?.aiRequests || 0);
        const aiPromptTokens = metered?.aiPromptTokens || Math.round(aiTokensUsed * 0.78);
        const aiOutputTokens = metered?.aiOutputTokens || Math.max(0, aiTokensUsed - aiPromptTokens);
        const topModel = metered ? resolveTopModel(metered.modelCounts) : "—";
        const estimatedAiCostEur = metered
          ? roundTo(metered.estimatedAiCostEur, 2)
          : roundTo(estimateGeminiCostEur(topModel, aiPromptTokens, aiOutputTokens), 2);

        let tenantOutboxPending = 0;
        let tenantOutboxDlq = 0;
        for (const evt of allOutboxEvents) {
          if (evt.tenantId !== agency.id) continue;
          if (evt.status === "pending" || evt.status === "retryable" || evt.status === "processing") {
            tenantOutboxPending += 1;
          } else if (evt.status === "dead_letter") {
            tenantOutboxDlq += 1;
          }
        }

        totalStorageMb = roundTo(totalStorageMb + storage.mb, 2);
        totalStorageFiles += storage.fileCount;
        totalAiTokens += aiTokensUsed;
        totalAiPromptTokens += aiPromptTokens;
        totalAiOutputTokens += aiOutputTokens;
        totalAiRequests += aiRequests;
        totalEstimatedAiCostEur = roundTo(totalEstimatedAiCostEur + estimatedAiCostEur, 2);
        portalPublishedTotal += portalCounts.published;
        portalSyncErrorsTotal += portalCounts.errors;

        return {
          tenantId: agency.id,
          agencyName: agency.name,
          subdomain: agency.subdomain,
          status: agency.status,
          activeAgents,
          activeUsers24h: activeUsers24hByTenant.get(agency.id) || 0,
          apiRequests: metered?.apiRequests || 0,
          api4xx: metered?.api4xx || 0,
          api5xx: metered?.api5xx || 0,
          p95LatencyMs: metered ? computePercentile(metered.latenciesMs, 0.95) : 0,
          aiRequests,
          aiPromptTokens,
          aiOutputTokens,
          aiTokensUsed,
          aiTokenLimit: quotas.monthlyAiTokens > 0 ? quotas.monthlyAiTokens : 1_000_000,
          estimatedAiCostEur,
          topModel,
          storageMb: storage.mb,
          storageFilesCount: storage.fileCount,
          outboxPendingOrRetryable: tenantOutboxPending,
          outboxDeadLetter: tenantOutboxDlq,
          portalEnabledProviders: portalCounts.enabledProviders,
          portalPublished: portalCounts.published,
          portalErrors: portalCounts.errors,
          provenance: "core_api_measured",
          provenanceLabel: PROVENANCE_LABELS.core_api_measured,
        };
      })
    );

    const totalApiRequests = Math.max(
      this.cumulativeGlobal.apiRequests,
      opMetrics.counters.api_request
    );
    const total4xx = Math.max(this.cumulativeGlobal.api4xx, opMetrics.counters.api_4xx);
    const total5xx = Math.max(this.cumulativeGlobal.api5xx, opMetrics.counters.api_error);

    const error4xxRatePct =
      totalApiRequests > 0 ? roundTo((total4xx / totalApiRequests) * 100, 2) : 0;
    const error5xxRatePct =
      totalApiRequests > 0 ? roundTo((total5xx / totalApiRequests) * 100, 2) : 0;

    const latencyP50Ms =
      this.cumulativeGlobal.latenciesMs.length > 0
        ? computePercentile(this.cumulativeGlobal.latenciesMs, 0.5)
        : opMetrics.latency.p50Ms;
    const latencyP95Ms =
      this.cumulativeGlobal.latenciesMs.length > 0
        ? computePercentile(this.cumulativeGlobal.latenciesMs, 0.95)
        : opMetrics.latency.p95Ms;
    const latencyAvgMs =
      this.cumulativeGlobal.latenciesMs.length > 0
        ? Math.round(
            this.cumulativeGlobal.latenciesMs.reduce((a, b) => a + b, 0) /
              this.cumulativeGlobal.latenciesMs.length
          )
        : opMetrics.latency.avgMs;

    // Aggregate active client heartbeats (< 10 min fresh)
    const heartbeatCutoff = nowMs - 10 * 60 * 1000;
    let activeListenersEstimated = 0;
    let activeTabsEstimated = 0;
    const heartbeatTenants = new Set<string>();
    for (const [k, v] of this.clientHeartbeats.entries()) {
      if (v.updatedAtMs < heartbeatCutoff) continue;
      activeListenersEstimated += v.activeListeners;
      activeTabsEstimated += v.activeTabs;
      const tid = k.split(":")[0];
      if (tid) heartbeatTenants.add(tid);
    }

    return {
      dashboardEnabled: this.isDashboardEnabled(),
      collectedAt: new Date(nowMs).toISOString(),
      summary: {
        totalAgencies: agencies.length,
        activeAgencies,
        trialAgencies,
        suspendedAgencies,
        activeUsers24h,
        activeUsers7d,
        apiRequests: totalApiRequests,
        api4xx: total4xx,
        api5xx: total5xx,
        error4xxRatePct,
        error5xxRatePct,
        latencyP50Ms,
        latencyP95Ms,
        latencyAvgMs,
        aiRequests: Math.max(totalAiRequests, this.cumulativeGlobal.aiRequests),
        aiPromptTokens: Math.max(totalAiPromptTokens, this.cumulativeGlobal.aiPromptTokens),
        aiOutputTokens: Math.max(totalAiOutputTokens, this.cumulativeGlobal.aiOutputTokens),
        aiTotalTokens: Math.max(totalAiTokens, this.cumulativeGlobal.aiTotalTokens),
        estimatedAiCostEur: Math.max(
          totalEstimatedAiCostEur,
          roundTo(this.cumulativeGlobal.estimatedAiCostEur, 2)
        ),
        totalStorageMb,
        totalStorageFiles,
        outboxDeadLetter: outboxStats.dead_letter,
        portalPublishedTotal,
        portalSyncErrorsTotal,
        provenance: "core_api_measured",
        provenanceLabel: PROVENANCE_LABELS.core_api_measured,
      },
      cloudMonitoring: {
        configured: Boolean(process.env.GCP_MONITORING_ENABLED === "true"),
        provenance: "cloud_monitoring_exact",
        provenanceLabel: PROVENANCE_LABELS.cloud_monitoring_exact,
        lastSyncedAt: null,
        note: "Stage A pilot folosește rollup-uri Core API cu cost ~0 $/lună. Conectarea Google Cloud Monitoring API este opțională în Stage B/C.",
      },
      clientHeartbeat: {
        provenance: "client_heartbeat_estimated",
        provenanceLabel: PROVENANCE_LABELS.client_heartbeat_estimated,
        activeListenersEstimated,
        clientReadsEstimated: this.clientReadsEstimatedTotal,
        activeTabsEstimated,
        reportedAgenciesCount: heartbeatTenants.size,
        lastHeartbeatAt: this.lastClientHeartbeatAt,
        note: "Estimat din heartbeat-uri de browser eșantionate — nu reprezintă totaluri facturate Firestore.",
      },
      workers: {
        provenance: "core_api_measured",
        provenanceLabel: PROVENANCE_LABELS.core_api_measured,
        outboxStats,
        deadLetterEvents: deadLetterEvents.map((e: OutboxEvent) => ({
          id: e.id,
          eventType: e.eventType,
          tenantId: e.tenantId,
          attempts: e.attempts,
          maxAttempts: e.maxAttempts,
          lastError: e.lastError ?? null,
          lastErrorKind: e.lastErrorKind ?? null,
          replayCount: e.replayCount || 0,
          lastReplayedBy: e.lastReplayedBy ?? null,
          lastReplayedAt: e.lastReplayedAt ?? null,
          updatedAt: e.updatedAt,
        })),
        recentRuns,
        activeLeasesCount: activeLeases.length,
      },
      agencies: agencyRows,
      rollups: {
        provenance: "core_api_measured",
        provenanceLabel: PROVENANCE_LABELS.core_api_measured,
        flushIntervalMs: this.getFlushIntervalMs(),
        retentionDays: this.getRetentionDays(),
        writesToday: this.rollupWritesToday,
        maxDailyWriteBudget: MAX_STAGE_A_DAILY_WRITES,
        lastFlushedAt: this.lastFlushedAt,
        recentBuckets: this.listRecentRollups(24),
      },
    };
  }

  public static clearForTests(): void {
    this.stopPeriodicFlusher();
    this.pendingGlobal = {
      apiRequests: 0,
      api4xx: 0,
      api5xx: 0,
      latenciesMs: [],
      aiRequests: 0,
      aiPromptTokens: 0,
      aiOutputTokens: 0,
      aiTotalTokens: 0,
      estimatedAiCostEur: 0,
      activeUidsInBucket: new Set<string>(),
    };
    this.cumulativeGlobal = {
      apiRequests: 0,
      api4xx: 0,
      api5xx: 0,
      latenciesMs: [],
      aiRequests: 0,
      aiPromptTokens: 0,
      aiOutputTokens: 0,
      aiTotalTokens: 0,
      estimatedAiCostEur: 0,
    };
    this.pendingByTenant.clear();
    this.cumulativeByTenant.clear();
    this.activeUserLastSeen.clear();
    this.clientHeartbeats.clear();
    this.clientReadsEstimatedTotal = 0;
    this.lastClientHeartbeatAt = null;
    this.lastFlushedAt = null;
    this.rollupWritesToday = 0;
    PersistentStoreService.clearCollection(COL_PLATFORM_TELEMETRY_ROLLUPS);
    PersistentStoreService.clearCollection(COL_PLATFORM_AGENCY_USAGE_ROLLUPS);
    logger.resetMetricsForTests();
  }
}
