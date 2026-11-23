import crypto from "crypto";
import { PersistentStoreService } from "../database/svc_persistent-store";
import { AppError, NotFoundError } from "../errors/app_error";
import { logger } from "../logger/logger";

export const COL_OUTBOX_EVENTS = "outbox_events";
export const COL_JOB_RUNS = "job_runs";

export type OutboxEventStatus =
  | "pending"
  | "processing"
  | "completed"
  | "retryable"
  | "dead_letter";

export type OutboxEventType =
  | "media_cleanup"
  | "og_regenerate"
  | "viewing_reminder"
  | "agency_market_auto_import"
  | "platform_auto_crawl"
  | "portal_publish"
  | "portal_update"
  | "portal_withdraw"
  | "custom";

export interface OutboxEvent {
  id: string;
  eventType: OutboxEventType;
  tenantId: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  status: OutboxEventStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  nextAttemptAtMs: number;
  lastError?: string | null;
  lastErrorKind?: "retryable" | "permanent" | null;
  replayCount: number;
  lastReplayedBy?: string | null;
  lastReplayedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
}

export interface JobRunRecord {
  id: string;
  jobName: string;
  tenantId?: string | null;
  triggeredBy: string;
  fencingToken?: number | null;
  status: "running" | "completed" | "skipped_lease" | "failed";
  startedAt: string;
  completedAt?: string | null;
  durationMs?: number | null;
  summary?: Record<string, unknown>;
  errorMessage?: string | null;
}

export class RetryableJobError extends Error {
  public readonly retryable = true;
  constructor(message: string) {
    super(message);
    this.name = "RetryableJobError";
  }
}

export class PermanentJobError extends Error {
  public readonly retryable = false;
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}

export type OutboxEventHandler = (event: OutboxEvent) => Promise<Record<string, unknown> | void>;

function getDefaultMaxAttempts(): number {
  const parsed = Number(process.env.OUTBOX_MAX_ATTEMPTS || "4");
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 10 ? Math.round(parsed) : 4;
}

function getDefaultBaseBackoffMs(): number {
  const parsed = Number(process.env.OUTBOX_BASE_BACKOFF_MS || "15000");
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 600_000 ? Math.round(parsed) : 15_000;
}

function buildDeterministicEventId(idempotencyKey: string): string {
  const digest = crypto.createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 28);
  return `evt_${digest}`;
}

export function classifyJobError(err: unknown): { kind: "retryable" | "permanent"; message: string } {
  if (err instanceof PermanentJobError) {
    return { kind: "permanent", message: err.message };
  }
  if (err instanceof RetryableJobError) {
    return { kind: "retryable", message: err.message };
  }
  const status = Number((err as any)?.statusCode || (err as any)?.response?.status || 0);
  const msg = err instanceof Error ? err.message : String(err || "Unknown error");

  if (status === 400 || status === 401 || status === 403 || status === 404 || status === 422) {
    return { kind: "permanent", message: msg };
  }
  if (
    status === 408 ||
    status === 429 ||
    status >= 500 ||
    /timeout|timed out|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|temporarily|rate limit/i.test(msg)
  ) {
    return { kind: "retryable", message: msg };
  }
  // Default unknown errors to retryable until maxAttempts escalates them cleanly to dead_letter
  return { kind: "retryable", message: msg };
}

/**
 * Phase 6 Transactional Outbox & Job Runs Service (`/outbox_events` & `/job_runs`).
 *
 * Guarantees:
 * - Deterministic idempotency keys prevent duplicate enqueues or duplicate execution.
 * - `buildAtomicOutboxWrite()` enables atomic `:commit` dual-write alongside core CRM mutations.
 * - Clean classification into `retryable` (with exponential backoff) vs `dead_letter`, plus
 *   audited manual replay (`replayDeadLetterEvent`).
 * - Per-tenant concurrency fairness caps prevent a single agency from starving the outbox queue.
 */
export class TransactionalOutboxService {
  private static handlers = new Map<OutboxEventType, OutboxEventHandler>();

  public static registerHandler(eventType: OutboxEventType, handler: OutboxEventHandler): void {
    this.handlers.set(eventType, handler);
  }

  public static unregisterHandler(eventType: OutboxEventType): void {
    this.handlers.delete(eventType);
  }

  public static createEventRecord(params: {
    eventType: OutboxEventType;
    tenantId: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
    maxAttempts?: number;
    availableAtMs?: number;
  }): OutboxEvent {
    const cleanKey = String(params.idempotencyKey || "").trim();
    if (!cleanKey) {
      throw new AppError({
        message: "idempotencyKey este obligatoriu pentru outbox event.",
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    }
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const nextMs = params.availableAtMs ?? nowMs;
    return {
      id: buildDeterministicEventId(cleanKey),
      eventType: params.eventType,
      tenantId: String(params.tenantId || "platform").trim() || "platform",
      idempotencyKey: cleanKey,
      payload: params.payload || {},
      status: "pending",
      attempts: 0,
      maxAttempts: Math.max(1, params.maxAttempts ?? getDefaultMaxAttempts()),
      nextAttemptAt: new Date(nextMs).toISOString(),
      nextAttemptAtMs: nextMs,
      lastError: null,
      lastErrorKind: null,
      replayCount: 0,
      lastReplayedBy: null,
      lastReplayedAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      completedAt: null,
    };
  }

  /**
   * Builds a Firestore REST `:commit` write object so callers can atomically persist a
   * business document AND an outbox event inside the exact same transaction.
   */
  public static buildAtomicOutboxWrite(event: OutboxEvent): Record<string, any> {
    const { projectId, databaseId } = PersistentStoreService.getFirebaseTarget();
    return {
      update: {
        name: `projects/${projectId}/databases/${databaseId}/documents/${COL_OUTBOX_EVENTS}/${event.id}`,
        fields: PersistentStoreService.encodeDocumentFields(event),
      },
      currentDocument: { exists: false },
    };
  }

  /**
   * Idempotently enqueues an outbox event. Duplicate `idempotencyKey` submissions return
   * `{ created: false, event }` without resetting or duplicating an existing event.
   */
  public static async enqueue(params: {
    eventType: OutboxEventType;
    tenantId: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
    maxAttempts?: number;
    availableAtMs?: number;
  }): Promise<{ created: boolean; event: OutboxEvent }> {
    const event = this.createEventRecord(params);
    const created = await PersistentStoreService.createIfAbsentAsync(
      COL_OUTBOX_EVENTS,
      event.id,
      event
    );
    if (!created) {
      const existing = PersistentStoreService.get<OutboxEvent>(COL_OUTBOX_EVENTS, event.id) || event;
      return { created: false, event: existing };
    }
    return { created: true, event };
  }

  private static async persistEvent(event: OutboxEvent): Promise<void> {
    PersistentStoreService.set(COL_OUTBOX_EVENTS, event.id, event);
    if (
      process.env.NODE_ENV !== "test" &&
      PersistentStoreService.isRemoteFirestoreConfigured()
    ) {
      await PersistentStoreService.remoteSet(COL_OUTBOX_EVENTS, event.id, event).catch(() => {
        // Non-fatal in preview environments without server ADC
      });
    }
  }

  /**
   * Drains due `pending` and `retryable` outbox events with per-tenant fairness caps.
   * Guarantees completed events are never re-executed on subsequent sweeps.
   */
  public static async processDueEvents(options?: {
    limit?: number;
    maxPerTenant?: number;
    nowMs?: number;
    baseBackoffMs?: number;
  }): Promise<{
    scanned: number;
    processed: number;
    completed: number;
    retryable: number;
    deadLettered: number;
    deferredByFairness: number;
  }> {
    const limit = Math.max(1, Math.min(100, options?.limit ?? 25));
    const maxPerTenant = Math.max(1, options?.maxPerTenant ?? 2);
    const nowMs = options?.nowMs ?? Date.now();
    const baseBackoffMs = options?.baseBackoffMs ?? getDefaultBaseBackoffMs();

    const all = Object.values(PersistentStoreService.getAll<OutboxEvent>(COL_OUTBOX_EVENTS));
    const due = all
      .filter(
        (evt) =>
          (evt.status === "pending" || evt.status === "retryable") &&
          evt.nextAttemptAtMs <= nowMs
      )
      .sort((a, b) => a.nextAttemptAtMs - b.nextAttemptAtMs);

    const perTenantDispatched = new Map<string, number>();
    let processed = 0;
    let completed = 0;
    let retryable = 0;
    let deadLettered = 0;
    let deferredByFairness = 0;

    for (const evt of due) {
      if (processed >= limit) break;

      const tenantCount = perTenantDispatched.get(evt.tenantId) || 0;
      if (tenantCount >= maxPerTenant) {
        deferredByFairness++;
        continue;
      }

      const handler = this.handlers.get(evt.eventType);
      if (!handler) {
        continue;
      }

      perTenantDispatched.set(evt.tenantId, tenantCount + 1);
      processed++;

      const processingEvent: OutboxEvent = {
        ...evt,
        status: "processing",
        attempts: evt.attempts + 1,
        updatedAt: new Date(nowMs).toISOString(),
      };
      await this.persistEvent(processingEvent);

      try {
        await handler(processingEvent);
        const doneEvent: OutboxEvent = {
          ...processingEvent,
          status: "completed",
          lastError: null,
          lastErrorKind: null,
          completedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await this.persistEvent(doneEvent);
        completed++;
      } catch (err: unknown) {
        const classified = classifyJobError(err);
        const exhausted = processingEvent.attempts >= processingEvent.maxAttempts;
        const nextStatus: OutboxEventStatus =
          classified.kind === "permanent" || exhausted ? "dead_letter" : "retryable";
        const backoffMs =
          nextStatus === "retryable"
            ? baseBackoffMs * Math.pow(2, Math.max(0, processingEvent.attempts - 1))
            : 0;
        const nextAttemptMs = nowMs + backoffMs;

        const failedEvent: OutboxEvent = {
          ...processingEvent,
          status: nextStatus,
          lastError: classified.message.slice(0, 500),
          lastErrorKind: classified.kind,
          nextAttemptAt: new Date(nextAttemptMs).toISOString(),
          nextAttemptAtMs: nextAttemptMs,
          updatedAt: new Date().toISOString(),
        };
        await this.persistEvent(failedEvent);

        if (nextStatus === "dead_letter") {
          deadLettered++;
          logger.error(`Outbox event moved to dead_letter: ${evt.id}`, undefined, {
            module: "transactional-outbox",
            tenantId: evt.tenantId,
            action: evt.eventType,
            attempts: processingEvent.attempts,
            errorKind: classified.kind,
          });
        } else {
          retryable++;
        }
      }
    }

    return {
      scanned: due.length,
      processed,
      completed,
      retryable,
      deadLettered,
      deferredByFairness,
    };
  }

  /**
   * Manually replays a `dead_letter` event back into `pending` state for immediate pickup,
   * recording who initiated the replay for full operational auditability.
   */
  public static async replayDeadLetterEvent(params: {
    eventId: string;
    replayedBy: string;
    nowMs?: number;
  }): Promise<OutboxEvent> {
    const existing = PersistentStoreService.get<OutboxEvent>(COL_OUTBOX_EVENTS, params.eventId);
    if (!existing) {
      throw new NotFoundError("Eveniment outbox", params.eventId);
    }
    if (existing.status !== "dead_letter") {
      throw new AppError({
        message: `Doar evenimentele în stare dead_letter pot fi reluate manual (stare curentă: ${existing.status}).`,
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    }

    const nowMs = params.nowMs ?? Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const replayed: OutboxEvent = {
      ...existing,
      status: "pending",
      attempts: 0,
      nextAttemptAt: nowIso,
      nextAttemptAtMs: nowMs,
      lastError: null,
      lastErrorKind: null,
      replayCount: (existing.replayCount || 0) + 1,
      lastReplayedBy: params.replayedBy,
      lastReplayedAt: nowIso,
      updatedAt: nowIso,
    };
    await this.persistEvent(replayed);
    return replayed;
  }

  public static getEvent(eventId: string): OutboxEvent | null {
    return PersistentStoreService.get<OutboxEvent>(COL_OUTBOX_EVENTS, eventId);
  }

  public static listEvents(filter?: {
    status?: OutboxEventStatus;
    tenantId?: string;
    limit?: number;
  }): OutboxEvent[] {
    let items = Object.values(PersistentStoreService.getAll<OutboxEvent>(COL_OUTBOX_EVENTS));
    if (filter?.status) {
      items = items.filter((e) => e.status === filter.status);
    }
    if (filter?.tenantId) {
      items = items.filter((e) => e.tenantId === filter.tenantId);
    }
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return items.slice(0, filter?.limit ?? 100);
  }

  public static getOutboxStats(): Record<OutboxEventStatus, number> {
    const counts: Record<OutboxEventStatus, number> = {
      pending: 0,
      processing: 0,
      completed: 0,
      retryable: 0,
      dead_letter: 0,
    };
    for (const evt of Object.values(PersistentStoreService.getAll<OutboxEvent>(COL_OUTBOX_EVENTS))) {
      counts[evt.status] = (counts[evt.status] || 0) + 1;
    }
    return counts;
  }

  // --- Job Runs Audit Ledger (/job_runs) ---

  public static async recordJobRunStart(params: {
    jobName: string;
    tenantId?: string | null;
    triggeredBy: string;
    fencingToken?: number | null;
  }): Promise<JobRunRecord> {
    const nowIso = new Date().toISOString();
    const run: JobRunRecord = {
      id: `run_${Date.now()}_${crypto.randomBytes(5).toString("hex")}`,
      jobName: params.jobName,
      tenantId: params.tenantId ?? null,
      triggeredBy: params.triggeredBy,
      fencingToken: params.fencingToken ?? null,
      status: "running",
      startedAt: nowIso,
      completedAt: null,
      durationMs: null,
      summary: {},
      errorMessage: null,
    };
    PersistentStoreService.set(COL_JOB_RUNS, run.id, run);
    if (
      process.env.NODE_ENV !== "test" &&
      PersistentStoreService.isRemoteFirestoreConfigured()
    ) {
      await PersistentStoreService.remoteSet(COL_JOB_RUNS, run.id, run).catch(() => {});
    }
    return run;
  }

  public static async recordJobRunFinish(
    run: JobRunRecord,
    outcome: {
      status: "completed" | "skipped_lease" | "failed";
      summary?: Record<string, unknown>;
      errorMessage?: string | null;
    }
  ): Promise<JobRunRecord> {
    const completedAt = new Date().toISOString();
    const durationMs = Math.max(
      0,
      new Date(completedAt).getTime() - new Date(run.startedAt).getTime()
    );
    const updated: JobRunRecord = {
      ...run,
      status: outcome.status,
      completedAt,
      durationMs,
      summary: outcome.summary || {},
      errorMessage: outcome.errorMessage ? String(outcome.errorMessage).slice(0, 500) : null,
    };
    PersistentStoreService.set(COL_JOB_RUNS, updated.id, updated);
    if (
      process.env.NODE_ENV !== "test" &&
      PersistentStoreService.isRemoteFirestoreConfigured()
    ) {
      await PersistentStoreService.remoteSet(COL_JOB_RUNS, updated.id, updated).catch(() => {});
    }
    return updated;
  }

  public static listJobRuns(filter?: {
    jobName?: string;
    tenantId?: string;
    limit?: number;
  }): JobRunRecord[] {
    let items = Object.values(PersistentStoreService.getAll<JobRunRecord>(COL_JOB_RUNS));
    if (filter?.jobName) {
      items = items.filter((r) => r.jobName === filter.jobName);
    }
    if (filter?.tenantId) {
      items = items.filter((r) => r.tenantId === filter.tenantId);
    }
    items.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return items.slice(0, filter?.limit ?? 50);
  }

  public static clearForTests(): void {
    PersistentStoreService.clearCollection(COL_OUTBOX_EVENTS);
    PersistentStoreService.clearCollection(COL_JOB_RUNS);
    this.handlers.clear();
  }
}
