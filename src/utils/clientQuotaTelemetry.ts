/**
 * Lightweight browser-side telemetry accumulator for Firestore Client SDK operations.
 * Kept strictly in RAM and flushed inside the 1-minute `/api/dev/quota-usage` request
 * (zero extra network calls, zero Firestore reads).
 */

export interface ClientFirestoreDeltas {
  reads: number;
  writes: number;
  deletes: number;
}

const pending: ClientFirestoreDeltas = {
  reads: 0,
  writes: 0,
  deletes: 0,
};

export function recordClientFirestoreOps(ops: Partial<ClientFirestoreDeltas>): void {
  if (typeof ops.reads === "number" && Number.isFinite(ops.reads) && ops.reads > 0) {
    pending.reads += Math.floor(ops.reads);
  }
  if (typeof ops.writes === "number" && Number.isFinite(ops.writes) && ops.writes > 0) {
    pending.writes += Math.floor(ops.writes);
  }
  if (typeof ops.deletes === "number" && Number.isFinite(ops.deletes) && ops.deletes > 0) {
    pending.deletes += Math.floor(ops.deletes);
  }
}

export function drainClientFirestoreDeltas(): ClientFirestoreDeltas {
  const snapshot: ClientFirestoreDeltas = {
    reads: pending.reads,
    writes: pending.writes,
    deletes: pending.deletes,
  };
  pending.reads = 0;
  pending.writes = 0;
  pending.deletes = 0;
  return snapshot;
}

export function restoreClientFirestoreDeltas(deltas: ClientFirestoreDeltas): void {
  pending.reads += Math.max(0, Math.floor(deltas.reads || 0));
  pending.writes += Math.max(0, Math.floor(deltas.writes || 0));
  pending.deletes += Math.max(0, Math.floor(deltas.deletes || 0));
}
