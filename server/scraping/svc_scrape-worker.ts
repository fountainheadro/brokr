import crypto from "crypto";
import { FirestoreLeaseService } from "../../src/core/jobs/svc_firestore-lease";
import { TransactionalOutboxService } from "../../src/core/jobs/svc_transactional-outbox";
import { PersistentStoreService } from "../../src/core/database/svc_persistent-store";
import { AppError } from "../../src/core/errors/app_error";
import { logger } from "../../src/core/logger/logger";

export const COL_AGENCY_AUTO_IMPORTS = "agency_auto_imports";

export interface ScrapeConcurrencyStats {
  maxConcurrentBrowsers: number;
  maxConcurrentPerTenant: number;
  activeGlobal: number;
  peakGlobal: number;
  queuedCount: number;
  activeByTenant: Record<string, number>;
  totalExecuted: number;
  totalFailed: number;
}

export interface PlatformAutoCrawlConfig {
  scanIntervalMinutes: number;
  lastScanAt?: string | null;
  sources?: Array<{ id?: string; url: string; enabled?: boolean }>;
}

export interface PlatformAutoCrawlJobResult {
  executed: boolean;
  skippedReason?: string;
  fencingToken?: number;
  scannedSources: number;
  importedCount: number;
  runId: string;
}

export interface AgencyMarketAutoImportConfig {
  tenantId: string;
  matchIntervalMinutes: number;
  lastRunAt?: string | null;
  enabled?: boolean;
}

export interface AgencyMarketAutoImportJobResult {
  executed: boolean;
  skippedReason?: string;
  fencingToken?: number;
  processedTenants: number;
  matchedCount: number;
  deduplicatedCount: number;
  runId: string;
}

interface QueuedScrapeWaiter {
  tenantId: string;
  operation: string;
  resolve: () => void;
  reject: (err: Error) => void;
  timeoutHandle?: NodeJS.Timeout;
}

function parseClampedEnvInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

/**
 * Phase 6 Logical Workload Boundary for Headless Scraping & Scheduled Portal Automation.
 *
 * Stage A runs inside the unified Cloud Run service while strictly isolating scraping
 * memory/CPU via:
 * - Global headless browser concurrency cap (`SCRAPE_MAX_CONCURRENT_BROWSERS`, default 2)
 * - Per-tenant fairness cap (`SCRAPE_MAX_CONCURRENT_PER_TENANT`, default 1) so no single
 *   agency can starve other agencies' scraping slots.
 * - Firestore fenced distributed leases for scheduled platform crawl and agency auto-import.
 *
 * Stage B can extract this exact module into a dedicated Cloud Run worker service without
 * changing any business contracts or client callers.
 */
export class ScrapeWorkerService {
  private static maxGlobalOverride: number | null = null;
  private static maxPerTenantOverride: number | null = null;

  private static activeGlobal = 0;
  private static peakGlobal = 0;
  private static activeByTenant = new Map<string, number>();
  private static waitQueue: QueuedScrapeWaiter[] = [];
  private static totalExecuted = 0;
  private static totalFailed = 0;

  public static getMaxConcurrentBrowsers(): number {
    if (this.maxGlobalOverride !== null) return this.maxGlobalOverride;
    return parseClampedEnvInt(process.env.SCRAPE_MAX_CONCURRENT_BROWSERS, 2, 1, 6);
  }

  public static getMaxConcurrentPerTenant(): number {
    if (this.maxPerTenantOverride !== null) return this.maxPerTenantOverride;
    return parseClampedEnvInt(process.env.SCRAPE_MAX_CONCURRENT_PER_TENANT, 1, 1, 4);
  }

  public static setLimitsForTests(limits: { maxGlobal?: number | null; maxPerTenant?: number | null }): void {
    if (limits.maxGlobal !== undefined) this.maxGlobalOverride = limits.maxGlobal;
    if (limits.maxPerTenant !== undefined) this.maxPerTenantOverride = limits.maxPerTenant;
  }

  public static resetForTests(): void {
    this.maxGlobalOverride = null;
    this.maxPerTenantOverride = null;
    this.activeGlobal = 0;
    this.peakGlobal = 0;
    this.activeByTenant.clear();
    for (const waiter of this.waitQueue) {
      if (waiter.timeoutHandle) clearTimeout(waiter.timeoutHandle);
    }
    this.waitQueue = [];
    this.totalExecuted = 0;
    this.totalFailed = 0;
    PersistentStoreService.clearCollection(COL_AGENCY_AUTO_IMPORTS);
  }

  public static getConcurrencyStats(): ScrapeConcurrencyStats {
    const byTenant: Record<string, number> = {};
    for (const [k, v] of this.activeByTenant.entries()) {
      if (v > 0) byTenant[k] = v;
    }
    return {
      maxConcurrentBrowsers: this.getMaxConcurrentBrowsers(),
      maxConcurrentPerTenant: this.getMaxConcurrentPerTenant(),
      activeGlobal: this.activeGlobal,
      peakGlobal: this.peakGlobal,
      queuedCount: this.waitQueue.length,
      activeByTenant: byTenant,
      totalExecuted: this.totalExecuted,
      totalFailed: this.totalFailed,
    };
  }

  private static canAcquireSlot(tenantId: string): boolean {
    const maxGlobal = this.getMaxConcurrentBrowsers();
    const maxPerTenant = this.getMaxConcurrentPerTenant();
    const tenantActive = this.activeByTenant.get(tenantId) || 0;
    return this.activeGlobal < maxGlobal && tenantActive < maxPerTenant;
  }

  private static claimSlot(tenantId: string): void {
    this.activeGlobal++;
    if (this.activeGlobal > this.peakGlobal) {
      this.peakGlobal = this.activeGlobal;
    }
    this.activeByTenant.set(tenantId, (this.activeByTenant.get(tenantId) || 0) + 1);
  }

  private static releaseSlot(tenantId: string): void {
    this.activeGlobal = Math.max(0, this.activeGlobal - 1);
    const nextTenant = Math.max(0, (this.activeByTenant.get(tenantId) || 1) - 1);
    if (nextTenant === 0) {
      this.activeByTenant.delete(tenantId);
    } else {
      this.activeByTenant.set(tenantId, nextTenant);
    }

    // Wake up the next eligible queued waiter (fair across tenants)
    for (let i = 0; i < this.waitQueue.length; i++) {
      const candidate = this.waitQueue[i];
      if (this.canAcquireSlot(candidate.tenantId)) {
        this.waitQueue.splice(i, 1);
        if (candidate.timeoutHandle) clearTimeout(candidate.timeoutHandle);
        this.claimSlot(candidate.tenantId);
        candidate.resolve();
        break;
      }
    }
  }

  /**
   * Runs a headless browser / scraping workload strictly within global and per-tenant
   * concurrency bounds, queuing overflow fairly with a bounded wait timeout.
   */
  public static async withScrapeSlot<T>(
    params: { tenantId?: string; operation: string; queueTimeoutMs?: number },
    fn: () => Promise<T>
  ): Promise<T> {
    const tenantId = String(params.tenantId || "platform").trim() || "platform";
    const queueTimeoutMs = Math.max(500, params.queueTimeoutMs ?? 45_000);

    if (this.canAcquireSlot(tenantId)) {
      this.claimSlot(tenantId);
    } else {
      await new Promise<void>((resolve, reject) => {
        const waiter: QueuedScrapeWaiter = {
          tenantId,
          operation: params.operation,
          resolve,
          reject,
        };
        waiter.timeoutHandle = setTimeout(() => {
          const idx = this.waitQueue.indexOf(waiter);
          if (idx >= 0) this.waitQueue.splice(idx, 1);
          reject(
            new AppError({
              message: `Sistemul de extragere este temporar ocupat pentru operațiunea "${params.operation}". Reîncercați în câteva secunde.`,
              code: "RATE_LIMIT_EXCEEDED",
              statusCode: 429,
            })
          );
        }, queueTimeoutMs);
        this.waitQueue.push(waiter);
      });
    }

    try {
      const result = await fn();
      this.totalExecuted++;
      return result;
    } catch (err) {
      this.totalFailed++;
      throw err;
    } finally {
      this.releaseSlot(tenantId);
    }
  }

  /**
   * Backend-owned Platform Auto-Crawl worker job.
   * Replaces browser `setInterval` automation with a fenced Firestore lease + `/job_runs` ledger.
   */
  public static async executePlatformAutoCrawlJob(options?: {
    triggeredBy?: string;
    ownerId?: string;
    force?: boolean;
    nowMs?: number;
    configOverride?: PlatformAutoCrawlConfig;
    crawlExecutor?: (config: PlatformAutoCrawlConfig) => Promise<{ scannedSources: number; importedCount: number }>;
  }): Promise<PlatformAutoCrawlJobResult> {
    const triggeredBy = options?.triggeredBy || "cloud_scheduler";
    const ownerId =
      options?.ownerId || `platform-crawl_${process.pid}_${crypto.randomBytes(4).toString("hex")}`;
    const nowMs = options?.nowMs ?? Date.now();
    const run = await TransactionalOutboxService.recordJobRunStart({
      jobName: "platform_auto_crawl",
      tenantId: "platform",
      triggeredBy,
    });

    const leaseOutcome = await FirestoreLeaseService.withLease(
      {
        lockKey: "worker:platform-auto-crawl",
        ownerId,
        ttlMs: 120_000,
      },
      async (lease) => {
        let config: PlatformAutoCrawlConfig | null = options?.configOverride || null;
        if (!config && process.env.NODE_ENV !== "test" && PersistentStoreService.isRemoteFirestoreConfigured()) {
          const remote = await PersistentStoreService.remoteGetAtPath<PlatformAutoCrawlConfig>(
            "platform_auto_crawl/default"
          );
          if (remote) config = remote;
        }
        if (!config) {
          config = { scanIntervalMinutes: 0, lastScanAt: null, sources: [] };
        }

        const intervalMinutes = Number(config.scanIntervalMinutes || 0);
        if (!options?.force) {
          if (intervalMinutes <= 0) {
            return {
              fencingToken: lease.fencingToken,
              skippedReason: "disabled_interval",
              scannedSources: 0,
              importedCount: 0,
            };
          }
          if (config.lastScanAt) {
            const lastMs = new Date(config.lastScanAt).getTime();
            if (Number.isFinite(lastMs) && nowMs - lastMs < intervalMinutes * 60 * 1000) {
              return {
                fencingToken: lease.fencingToken,
                skippedReason: "interval_not_elapsed",
                scannedSources: 0,
                importedCount: 0,
              };
            }
          }
        }

        const execution = await this.withScrapeSlot(
          { tenantId: "platform", operation: "platform_auto_crawl" },
          async () => {
            if (options?.crawlExecutor) {
              return options.crawlExecutor(config!);
            }
            const enabledSources = (config?.sources || []).filter((s) => s.enabled !== false);
            return {
              scannedSources: enabledSources.length,
              importedCount: 0,
            };
          }
        );

        return {
          fencingToken: lease.fencingToken,
          skippedReason: undefined,
          scannedSources: execution.scannedSources,
          importedCount: execution.importedCount,
        };
      }
    );

    if (!leaseOutcome.executed) {
      await TransactionalOutboxService.recordJobRunFinish(run, {
        status: "skipped_lease",
        summary: { reason: leaseOutcome.reason },
      });
      return {
        executed: false,
        skippedReason: leaseOutcome.reason,
        scannedSources: 0,
        importedCount: 0,
        runId: run.id,
      };
    }

    await TransactionalOutboxService.recordJobRunFinish(run, {
      status: "completed",
      summary: {
        fencingToken: leaseOutcome.result.fencingToken,
        skippedReason: leaseOutcome.result.skippedReason || null,
        scannedSources: leaseOutcome.result.scannedSources,
        importedCount: leaseOutcome.result.importedCount,
      },
    });

    logger.info("Platform auto-crawl worker tick finished", {
      module: "scrape-worker",
      action: "platform_auto_crawl",
      meta: {
        runId: run.id,
        scannedSources: leaseOutcome.result.scannedSources,
        importedCount: leaseOutcome.result.importedCount,
        skippedReason: leaseOutcome.result.skippedReason,
      },
    });

    return {
      executed: true,
      skippedReason: leaseOutcome.result.skippedReason,
      fencingToken: leaseOutcome.result.fencingToken,
      scannedSources: leaseOutcome.result.scannedSources,
      importedCount: leaseOutcome.result.importedCount,
      runId: run.id,
    };
  }

  /**
   * Backend-owned Agency Piața Imobiliară Auto-Import worker job.
   * Replaces both the agency admin page `setInterval` and `Home.tsx`'s 60-second loop.
   * Enforces deterministic idempotency per `(tenantId, sourceListingId)` so retries never duplicate imports.
   */
  public static async executeAgencyMarketAutoImportJob(options?: {
    tenantId?: string;
    triggeredBy?: string;
    ownerId?: string;
    force?: boolean;
    nowMs?: number;
    configsOverride?: AgencyMarketAutoImportConfig[];
    matcherExecutor?: (
      config: AgencyMarketAutoImportConfig
    ) => Promise<Array<{ sourceListingId: string; title?: string }>>;
  }): Promise<AgencyMarketAutoImportJobResult> {
    const triggeredBy = options?.triggeredBy || "cloud_scheduler";
    const scopeKey = options?.tenantId
      ? `worker:agency-market-auto-import:${options.tenantId}`
      : "worker:agency-market-auto-import";
    const ownerId =
      options?.ownerId || `agency-import_${process.pid}_${crypto.randomBytes(4).toString("hex")}`;
    const nowMs = options?.nowMs ?? Date.now();

    const run = await TransactionalOutboxService.recordJobRunStart({
      jobName: "agency_market_auto_import",
      tenantId: options?.tenantId || "platform",
      triggeredBy,
    });

    const leaseOutcome = await FirestoreLeaseService.withLease(
      {
        lockKey: scopeKey,
        ownerId,
        ttlMs: 120_000,
      },
      async (lease) => {
        const configs: AgencyMarketAutoImportConfig[] = options?.configsOverride || [];
        let processedTenants = 0;
        let matchedCount = 0;
        let deduplicatedCount = 0;

        for (const cfg of configs) {
          if (options?.tenantId && cfg.tenantId !== options.tenantId) continue;
          if (cfg.enabled === false) continue;

          const intervalMin = Number(cfg.matchIntervalMinutes || 0);
          if (!options?.force) {
            if (intervalMin <= 0) continue;
            if (cfg.lastRunAt) {
              const lastMs = new Date(cfg.lastRunAt).getTime();
              if (Number.isFinite(lastMs) && nowMs - lastMs < intervalMin * 60 * 1000) {
                continue;
              }
            }
          }

          processedTenants++;
          const matches = options?.matcherExecutor
            ? await this.withScrapeSlot(
                { tenantId: cfg.tenantId, operation: "agency_market_auto_import" },
                () => options.matcherExecutor!(cfg)
              )
            : [];

          for (const item of matches) {
            const safeSourceId = String(item.sourceListingId || "").replace(/[^A-Za-z0-9_-]/g, "_");
            if (!safeSourceId) continue;
            const idempotencyKey = `${cfg.tenantId}__${safeSourceId}`;
            const created = await PersistentStoreService.createIfAbsentAsync(
              COL_AGENCY_AUTO_IMPORTS,
              idempotencyKey,
              {
                tenantId: cfg.tenantId,
                sourceListingId: safeSourceId,
                title: item.title || "",
                importedAt: new Date(nowMs).toISOString(),
              }
            );
            if (created) {
              matchedCount++;
            } else {
              deduplicatedCount++;
            }
          }
        }

        return {
          fencingToken: lease.fencingToken,
          processedTenants,
          matchedCount,
          deduplicatedCount,
        };
      }
    );

    if (!leaseOutcome.executed) {
      await TransactionalOutboxService.recordJobRunFinish(run, {
        status: "skipped_lease",
        summary: { reason: leaseOutcome.reason },
      });
      return {
        executed: false,
        skippedReason: leaseOutcome.reason,
        processedTenants: 0,
        matchedCount: 0,
        deduplicatedCount: 0,
        runId: run.id,
      };
    }

    await TransactionalOutboxService.recordJobRunFinish(run, {
      status: "completed",
      summary: {
        fencingToken: leaseOutcome.result.fencingToken,
        processedTenants: leaseOutcome.result.processedTenants,
        matchedCount: leaseOutcome.result.matchedCount,
        deduplicatedCount: leaseOutcome.result.deduplicatedCount,
      },
    });

    return {
      executed: true,
      fencingToken: leaseOutcome.result.fencingToken,
      processedTenants: leaseOutcome.result.processedTenants,
      matchedCount: leaseOutcome.result.matchedCount,
      deduplicatedCount: leaseOutcome.result.deduplicatedCount,
      runId: run.id,
    };
  }
}
