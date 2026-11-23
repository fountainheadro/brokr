import crypto from "crypto";
import axios from "axios";
import { PersistentStoreService } from "../database/svc_persistent-store";
import { AppError } from "../errors/app_error";
import { logger } from "../logger/logger";

export const COL_WORKER_LEASES = "worker_leases";

export interface WorkerLease {
  lockKey: string;
  ownerId: string;
  fencingToken: number;
  acquiredAt: string;
  acquiredAtMs: number;
  leaseExpiresAt: string;
  leaseExpiresAtMs: number;
  updatedAt: string;
  releasedAt?: string | null;
}

export interface AcquireLeaseResult {
  acquired: boolean;
  lease?: WorkerLease;
  currentOwnerId?: string;
  currentFencingToken?: number;
  leaseExpiresAtMs?: number;
}

export class StaleFencingTokenError extends AppError {
  constructor(lockKey: string, expectedToken: number, actualToken?: number) {
    super({
      message: `Fencing token expirat sau invalid pentru lock "${lockKey}" (primit=${expectedToken}, activ=${actualToken ?? "none"}).`,
      code: "CONFLICT",
      statusCode: 409,
    });
  }
}

function sanitizeLockKey(raw: string): string {
  const cleaned = String(raw || "")
    .trim()
    .replace(/[^A-Za-z0-9_.:-]/g, "_")
    .slice(0, 120);
  if (!cleaned || cleaned === "." || cleaned === "..") {
    throw new AppError({
      message: "Cheie lock invalidă pentru worker lease.",
      code: "VALIDATION_ERROR",
      statusCode: 400,
    });
  }
  return cleaned;
}

/**
 * Phase 6 Authoritative Distributed Lease Service backed by Cloud Firestore (`/worker_leases/{lockKey}`).
 *
 * Guarantees:
 * - Strictly monotonic `fencingToken` incremented on every new acquisition.
 * - Across multiple Cloud Run instances, uses Firestore REST `:commit` preconditions
 *   (`exists: false` on first acquire, `updateTime` match on takeover) so at most ONE
 *   worker can win a contested lease.
 * - Stale workers holding an old `fencingToken` are rejected on renew, assertion, and release.
 * - Zero Redis dependency ($0/mo in Stage A).
 */
export class FirestoreLeaseService {
  private static localLockChains = new Map<string, Promise<unknown>>();

  private static async withLocalLock<T>(lockKey: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.localLockChains.get(lockKey) || Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = prev.then(() => next);
    this.localLockChains.set(lockKey, chained);

    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.localLockChains.get(lockKey) === chained) {
        this.localLockChains.delete(lockKey);
      }
    }
  }

  private static shouldUseRemoteFirestore(): boolean {
    if (process.env.NODE_ENV === "test") {
      return false;
    }
    return PersistentStoreService.isRemoteFirestoreConfigured();
  }

  private static async remoteGetLeaseWithUpdateTime(
    safeKey: string
  ): Promise<{ lease: WorkerLease; updateTime: string } | null> {
    const { projectId, databaseId } = PersistentStoreService.getFirebaseTarget();
    const token = await PersistentStoreService.getGoogleAccessToken({ throwOnError: false });
    if (!token) return null;

    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      projectId
    )}/databases/${encodeURIComponent(
      databaseId
    )}/documents/${COL_WORKER_LEASES}/${encodeURIComponent(safeKey)}`;

    try {
      const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 8000,
      });
      if (!res.data?.fields) return null;
      const decoded = PersistentStoreService.decodeDocument<WorkerLease>(res.data);
      return {
        lease: decoded,
        updateTime: String(res.data.updateTime || ""),
      };
    } catch (err: any) {
      if (err?.response?.status === 404) return null;
      throw err;
    }
  }

  private static async remoteCommitLease(
    safeKey: string,
    nextLease: WorkerLease,
    precondition: { exists: false } | { updateTime: string }
  ): Promise<boolean> {
    const { projectId, databaseId } = PersistentStoreService.getFirebaseTarget();
    const docName = `projects/${projectId}/databases/${databaseId}/documents/${COL_WORKER_LEASES}/${safeKey}`;
    try {
      await PersistentStoreService.remoteCommitWrites(
        [
          {
            update: {
              name: docName,
              fields: PersistentStoreService.encodeDocumentFields(nextLease),
            },
            currentDocument: precondition,
          },
        ],
        "worker_lease_commit",
        { silentOnStatuses: [409, 412] }
      );
      PersistentStoreService.set(COL_WORKER_LEASES, safeKey, nextLease);
      return true;
    } catch (err: any) {
      if (err?.statusCode === 409 || err?.statusCode === 412) {
        return false;
      }
      throw err;
    }
  }

  /**
   * Attempts to acquire an exclusive lease for `lockKey`.
   * If the lease is currently held by another owner and unexpired, returns `{ acquired: false }`.
   * If expired or released (or newly created), atomically increments `fencingToken` and grants the lease.
   */
  public static async acquireLease(params: {
    lockKey: string;
    ownerId?: string;
    ttlMs?: number;
    nowMs?: number;
  }): Promise<AcquireLeaseResult> {
    const safeKey = sanitizeLockKey(params.lockKey);
    const ownerId =
      params.ownerId?.trim() || `worker_${process.pid}_${crypto.randomBytes(6).toString("hex")}`;
    const ttlMs = Math.max(1000, Math.min(30 * 60 * 1000, params.ttlMs ?? 60_000));
    const nowMs = params.nowMs ?? Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const expiresAtMs = nowMs + ttlMs;
    const expiresAtIso = new Date(expiresAtMs).toISOString();

    return this.withLocalLock(safeKey, async () => {
      if (this.shouldUseRemoteFirestore()) {
        const existingRemote = await this.remoteGetLeaseWithUpdateTime(safeKey);
        if (existingRemote) {
          const cur = existingRemote.lease;
          const isActive = !cur.releasedAt && cur.leaseExpiresAtMs > nowMs;
          if (isActive && cur.ownerId !== ownerId) {
            return {
              acquired: false,
              currentOwnerId: cur.ownerId,
              currentFencingToken: cur.fencingToken,
              leaseExpiresAtMs: cur.leaseExpiresAtMs,
            };
          }
          const nextToken = Math.max(0, Number(cur.fencingToken || 0)) + 1;
          const nextLease: WorkerLease = {
            lockKey: safeKey,
            ownerId,
            fencingToken: nextToken,
            acquiredAt: nowIso,
            acquiredAtMs: nowMs,
            leaseExpiresAt: expiresAtIso,
            leaseExpiresAtMs: expiresAtMs,
            updatedAt: nowIso,
            releasedAt: null,
          };
          const won = await this.remoteCommitLease(safeKey, nextLease, {
            updateTime: existingRemote.updateTime,
          });
          if (!won) {
            return {
              acquired: false,
              currentOwnerId: cur.ownerId,
              currentFencingToken: cur.fencingToken,
              leaseExpiresAtMs: cur.leaseExpiresAtMs,
            };
          }
          return { acquired: true, lease: nextLease };
        }

        const firstLease: WorkerLease = {
          lockKey: safeKey,
          ownerId,
          fencingToken: 1,
          acquiredAt: nowIso,
          acquiredAtMs: nowMs,
          leaseExpiresAt: expiresAtIso,
          leaseExpiresAtMs: expiresAtMs,
          updatedAt: nowIso,
          releasedAt: null,
        };
        const won = await this.remoteCommitLease(safeKey, firstLease, { exists: false });
        if (!won) {
          const contender = await this.remoteGetLeaseWithUpdateTime(safeKey);
          return {
            acquired: false,
            currentOwnerId: contender?.lease.ownerId,
            currentFencingToken: contender?.lease.fencingToken,
            leaseExpiresAtMs: contender?.lease.leaseExpiresAtMs,
          };
        }
        return { acquired: true, lease: firstLease };
      }

      // Local / Test deterministic atomic path serialized by `withLocalLock`
      const current = PersistentStoreService.get<WorkerLease>(COL_WORKER_LEASES, safeKey);
      if (current && !current.releasedAt && current.leaseExpiresAtMs > nowMs && current.ownerId !== ownerId) {
        return {
          acquired: false,
          currentOwnerId: current.ownerId,
          currentFencingToken: current.fencingToken,
          leaseExpiresAtMs: current.leaseExpiresAtMs,
        };
      }

      const nextToken = Math.max(0, Number(current?.fencingToken || 0)) + 1;
      const nextLease: WorkerLease = {
        lockKey: safeKey,
        ownerId,
        fencingToken: nextToken,
        acquiredAt: nowIso,
        acquiredAtMs: nowMs,
        leaseExpiresAt: expiresAtIso,
        leaseExpiresAtMs: expiresAtMs,
        updatedAt: nowIso,
        releasedAt: null,
      };
      PersistentStoreService.set(COL_WORKER_LEASES, safeKey, nextLease);
      return { acquired: true, lease: nextLease };
    });
  }

  /**
   * Verifies that `(lockKey, ownerId, fencingToken)` is still the active, unexpired lease holder.
   * Throws `StaleFencingTokenError` (HTTP 409) if a newer worker has taken over the lease.
   */
  public static async assertValidFencingToken(params: {
    lockKey: string;
    ownerId: string;
    fencingToken: number;
    nowMs?: number;
  }): Promise<WorkerLease> {
    const safeKey = sanitizeLockKey(params.lockKey);
    const nowMs = params.nowMs ?? Date.now();

    let current: WorkerLease | null = null;
    if (this.shouldUseRemoteFirestore()) {
      const remote = await this.remoteGetLeaseWithUpdateTime(safeKey);
      current = remote?.lease || null;
    } else {
      current = PersistentStoreService.get<WorkerLease>(COL_WORKER_LEASES, safeKey);
    }

    if (
      !current ||
      current.releasedAt ||
      current.leaseExpiresAtMs <= nowMs ||
      current.ownerId !== params.ownerId ||
      current.fencingToken !== params.fencingToken
    ) {
      throw new StaleFencingTokenError(safeKey, params.fencingToken, current?.fencingToken);
    }

    return current;
  }

  /**
   * Extends an active lease TTL strictly if `ownerId` and `fencingToken` still match.
   */
  public static async renewLease(params: {
    lockKey: string;
    ownerId: string;
    fencingToken: number;
    ttlMs?: number;
    nowMs?: number;
  }): Promise<WorkerLease> {
    const safeKey = sanitizeLockKey(params.lockKey);
    const ttlMs = Math.max(1000, Math.min(30 * 60 * 1000, params.ttlMs ?? 60_000));
    const nowMs = params.nowMs ?? Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const expiresAtMs = nowMs + ttlMs;

    return this.withLocalLock(safeKey, async () => {
      if (this.shouldUseRemoteFirestore()) {
        const existing = await this.remoteGetLeaseWithUpdateTime(safeKey);
        if (
          !existing ||
          existing.lease.releasedAt ||
          existing.lease.ownerId !== params.ownerId ||
          existing.lease.fencingToken !== params.fencingToken
        ) {
          throw new StaleFencingTokenError(safeKey, params.fencingToken, existing?.lease.fencingToken);
        }
        const renewed: WorkerLease = {
          ...existing.lease,
          leaseExpiresAt: new Date(expiresAtMs).toISOString(),
          leaseExpiresAtMs: expiresAtMs,
          updatedAt: nowIso,
        };
        const ok = await this.remoteCommitLease(safeKey, renewed, {
          updateTime: existing.updateTime,
        });
        if (!ok) {
          throw new StaleFencingTokenError(safeKey, params.fencingToken);
        }
        return renewed;
      }

      const current = PersistentStoreService.get<WorkerLease>(COL_WORKER_LEASES, safeKey);
      if (
        !current ||
        current.releasedAt ||
        current.ownerId !== params.ownerId ||
        current.fencingToken !== params.fencingToken
      ) {
        throw new StaleFencingTokenError(safeKey, params.fencingToken, current?.fencingToken);
      }

      const renewed: WorkerLease = {
        ...current,
        leaseExpiresAt: new Date(expiresAtMs).toISOString(),
        leaseExpiresAtMs: expiresAtMs,
        updatedAt: nowIso,
      };
      PersistentStoreService.set(COL_WORKER_LEASES, safeKey, renewed);
      return renewed;
    });
  }

  /**
   * Releases an active lease ONLY if `ownerId` and `fencingToken` still match.
   * Stale workers return `false` without disturbing a newer lease holder.
   */
  public static async releaseLease(params: {
    lockKey: string;
    ownerId: string;
    fencingToken: number;
    nowMs?: number;
  }): Promise<boolean> {
    const safeKey = sanitizeLockKey(params.lockKey);
    const nowMs = params.nowMs ?? Date.now();
    const nowIso = new Date(nowMs).toISOString();

    return this.withLocalLock(safeKey, async () => {
      if (this.shouldUseRemoteFirestore()) {
        const existing = await this.remoteGetLeaseWithUpdateTime(safeKey);
        if (
          !existing ||
          existing.lease.ownerId !== params.ownerId ||
          existing.lease.fencingToken !== params.fencingToken
        ) {
          return false;
        }
        const released: WorkerLease = {
          ...existing.lease,
          releasedAt: nowIso,
          leaseExpiresAt: nowIso,
          leaseExpiresAtMs: nowMs,
          updatedAt: nowIso,
        };
        return this.remoteCommitLease(safeKey, released, {
          updateTime: existing.updateTime,
        });
      }

      const current = PersistentStoreService.get<WorkerLease>(COL_WORKER_LEASES, safeKey);
      if (
        !current ||
        current.ownerId !== params.ownerId ||
        current.fencingToken !== params.fencingToken
      ) {
        return false;
      }

      const released: WorkerLease = {
        ...current,
        releasedAt: nowIso,
        leaseExpiresAt: nowIso,
        leaseExpiresAtMs: nowMs,
        updatedAt: nowIso,
      };
      PersistentStoreService.set(COL_WORKER_LEASES, safeKey, released);
      return true;
    });
  }

  /**
   * Runs `fn(lease)` exclusively while holding the fenced lease, always releasing on exit.
   */
  public static async withLease<T>(
    params: { lockKey: string; ownerId?: string; ttlMs?: number },
    fn: (lease: WorkerLease) => Promise<T>
  ): Promise<{ executed: boolean; lease?: WorkerLease; result?: T; reason?: string }> {
    const attempt = await this.acquireLease(params);
    if (!attempt.acquired || !attempt.lease) {
      return {
        executed: false,
        reason: `lease_held_by_${attempt.currentOwnerId || "other_worker"}`,
      };
    }

    const lease = attempt.lease;
    try {
      const result = await fn(lease);
      return { executed: true, lease, result };
    } finally {
      await this.releaseLease({
        lockKey: lease.lockKey,
        ownerId: lease.ownerId,
        fencingToken: lease.fencingToken,
      }).catch((err) => {
        logger.warn("Eșec eliberare lease worker (va expira automat prin TTL)", {
          module: "firestore-lease",
          lockKey: lease.lockKey,
          reason: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }

  public static listLeases(): WorkerLease[] {
    const all = PersistentStoreService.getAll<WorkerLease>(COL_WORKER_LEASES);
    return Object.values(all).sort((a, b) => b.acquiredAtMs - a.acquiredAtMs);
  }

  public static clearForTests(): void {
    PersistentStoreService.clearCollection(COL_WORKER_LEASES);
  }
}
