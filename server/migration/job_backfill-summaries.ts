/**
 * Phase 2 Idempotent Backfill Job: Canonical Leads -> Slim Summary Projections
 *
 * Populates:
 *  - `/tenants/{tenantId}/leads`        -> `/tenants/{tenantId}/leads_summary`
 *  - `/platform_shared_leads`           -> `/platform_shared_leads_summary`
 *
 * Properties:
 *  - 100% Idempotent: compares `docVersion` + `computeSummaryParityChecksum` before writing;
 *    re-running immediately performs 0 redundant writes.
 *  - Bounded atomic `:commit` batches (<= 200 docs per batch).
 *  - Cleans up orphaned summary documents whose canonical lead was deleted.
 *  - Computes exact UTF-8 byte telemetry (avg, max, estimated 50-lead page size).
 *
 * CLI usage:
 *   npx tsx server/migration/job_backfill-summaries.ts [--dry-run] [--tenant=<tenantId>]
 */

import { PersistentStoreService } from "../../src/core/database/svc_persistent-store";
import { CrmTenantStoreService } from "../../src/core/crm/svc_crm-tenant-store";
import {
  PLATFORM_SHARED_LEADS_COLLECTION,
  SharedLeadStoreService,
} from "../../src/core/crm/svc_shared-leads-store";
import {
  computeSummaryParityChecksum,
  estimateUtf8Bytes,
  LEAD_SUMMARY_COLLECTION,
  projectLeadToSummary,
  SHARED_LEADS_SUMMARY_COLLECTION,
  type LeadSummary,
} from "../../src/core/crm/svc_lead-projection";
import { TenantResolutionService } from "../../src/core/tenancy/svc_tenant-resolution";

export interface BackfillSummaryReport {
  scope: "tenant" | "platform_shared";
  tenantId?: string;
  dryRun: boolean;
  totalCanonical: number;
  written: number;
  skipped: number;
  orphansRemoved: number;
  avgSummaryBytes: number;
  maxSummaryBytes: number;
  estimated50LeadPageBytes: number;
  durationMs: number;
}

export interface BackfillOptions {
  dryRun?: boolean;
  chunkSize?: number;
}

async function commitSummaryBatch(
  collectionPath: string,
  toUpsert: LeadSummary[],
  orphanIds: string[],
  localStoreKey: string,
  chunkSize: number,
  useLiveFirestore: boolean
): Promise<void> {
  if (!useLiveFirestore) {
    for (const summary of toUpsert) {
      PersistentStoreService.set(localStoreKey, summary.id, summary);
    }
    for (const orphanId of orphanIds) {
      PersistentStoreService.delete(localStoreKey, orphanId);
    }
    return;
  }

  const { projectId, databaseId } = PersistentStoreService.getFirebaseTarget();
  const basePrefix = `projects/${projectId}/databases/${databaseId}/documents/${collectionPath}`;

  const writes: Array<Record<string, any>> = [
    ...toUpsert.map((summary) => ({
      update: {
        name: `${basePrefix}/${summary.id}`,
        fields: PersistentStoreService.encodeDocumentFields(summary),
      },
    })),
    ...orphanIds.map((id) => ({
      delete: `${basePrefix}/${id}`,
    })),
  ];

  const safeChunk = Math.min(400, Math.max(1, chunkSize));
  for (let i = 0; i < writes.length; i += safeChunk) {
    await PersistentStoreService.remoteCommitWrites(
      writes.slice(i, i + safeChunk),
      `backfill_summaries(${collectionPath})`
    );
  }
}

export async function backfillTenantLeadSummaries(
  tenantId: string,
  options?: BackfillOptions
): Promise<BackfillSummaryReport> {
  const startedAt = Date.now();
  const dryRun = Boolean(options?.dryRun);
  const chunkSize = options?.chunkSize ?? 200;
  const useLive = CrmTenantStoreService.isUsingLiveFirestore();

  const [canonicalLeads, existingSummaries] = await Promise.all([
    CrmTenantStoreService.list(tenantId, "leads", { limit: 2000 }),
    CrmTenantStoreService.listLeadSummaries(tenantId, { limit: 2000 }).catch(() => [] as LeadSummary[]),
  ]);

  const existingById = new Map<string, LeadSummary>();
  for (const s of existingSummaries) {
    if (s?.id) existingById.set(s.id, s);
  }

  const canonicalIds = new Set<string>();
  const toUpsert: LeadSummary[] = [];
  let skipped = 0;
  let totalBytes = 0;
  let maxSummaryBytes = 0;

  for (const canonical of canonicalLeads) {
    if (!canonical?.id) continue;
    canonicalIds.add(canonical.id);

    const projected = projectLeadToSummary(canonical, {
      tenantId,
      isSharedLead: false,
      docVersion: Number(canonical.docVersion) >= 1 ? Math.floor(Number(canonical.docVersion)) : 1,
    });
    const bytes = estimateUtf8Bytes(projected);
    totalBytes += bytes;
    if (bytes > maxSummaryBytes) maxSummaryBytes = bytes;

    const existing = existingById.get(canonical.id);
    if (
      existing &&
      Number(existing.docVersion || 0) === projected.docVersion &&
      computeSummaryParityChecksum(existing) === computeSummaryParityChecksum(projected)
    ) {
      skipped++;
    } else {
      toUpsert.push(projected);
    }
  }

  const orphanIds: string[] = [];
  for (const id of existingById.keys()) {
    if (!canonicalIds.has(id)) {
      orphanIds.push(id);
    }
  }

  if (!dryRun && (toUpsert.length > 0 || orphanIds.length > 0)) {
    await commitSummaryBatch(
      `tenants/${tenantId}/${LEAD_SUMMARY_COLLECTION}`,
      toUpsert,
      orphanIds,
      `tenants__${tenantId}__${LEAD_SUMMARY_COLLECTION}`,
      chunkSize,
      useLive
    );
  }

  const avgSummaryBytes =
    canonicalLeads.length > 0 ? Math.round(totalBytes / canonicalLeads.length) : 0;

  return {
    scope: "tenant",
    tenantId,
    dryRun,
    totalCanonical: canonicalLeads.length,
    written: toUpsert.length,
    skipped,
    orphansRemoved: orphanIds.length,
    avgSummaryBytes,
    maxSummaryBytes,
    estimated50LeadPageBytes: avgSummaryBytes * 50,
    durationMs: Date.now() - startedAt,
  };
}

export async function backfillPlatformSharedLeadSummaries(
  options?: BackfillOptions
): Promise<BackfillSummaryReport> {
  const startedAt = Date.now();
  const dryRun = Boolean(options?.dryRun);
  const chunkSize = options?.chunkSize ?? 200;
  const useLive =
    process.env.NODE_ENV !== "test" || PersistentStoreService.isRemoteFirestoreConfigured();

  const [canonicalShared, existingSummaries] = await Promise.all([
    SharedLeadStoreService.listCanonical(2000),
    SharedLeadStoreService.listSummaries(2000).catch(() => [] as LeadSummary[]),
  ]);

  const existingById = new Map<string, LeadSummary>();
  for (const s of existingSummaries) {
    if (s?.id) existingById.set(s.id, s);
  }

  const canonicalIds = new Set<string>();
  const toUpsert: LeadSummary[] = [];
  let skipped = 0;
  let totalBytes = 0;
  let maxSummaryBytes = 0;

  for (const canonical of canonicalShared) {
    if (!canonical?.id) continue;
    canonicalIds.add(canonical.id);

    const projected = projectLeadToSummary(canonical, {
      isSharedLead: true,
      docVersion: Number(canonical.docVersion) >= 1 ? Math.floor(Number(canonical.docVersion)) : 1,
    });
    const bytes = estimateUtf8Bytes(projected);
    totalBytes += bytes;
    if (bytes > maxSummaryBytes) maxSummaryBytes = bytes;

    const existing = existingById.get(canonical.id);
    if (
      existing &&
      Number(existing.docVersion || 0) === projected.docVersion &&
      computeSummaryParityChecksum(existing) === computeSummaryParityChecksum(projected)
    ) {
      skipped++;
    } else {
      toUpsert.push(projected);
    }
  }

  const orphanIds: string[] = [];
  for (const id of existingById.keys()) {
    if (!canonicalIds.has(id)) {
      orphanIds.push(id);
    }
  }

  if (!dryRun && (toUpsert.length > 0 || orphanIds.length > 0)) {
    await commitSummaryBatch(
      SHARED_LEADS_SUMMARY_COLLECTION,
      toUpsert,
      orphanIds,
      SHARED_LEADS_SUMMARY_COLLECTION,
      chunkSize,
      useLive
    );
  }

  const avgSummaryBytes =
    canonicalShared.length > 0 ? Math.round(totalBytes / canonicalShared.length) : 0;

  return {
    scope: "platform_shared",
    dryRun,
    totalCanonical: canonicalShared.length,
    written: toUpsert.length,
    skipped,
    orphansRemoved: orphanIds.length,
    avgSummaryBytes,
    maxSummaryBytes,
    estimated50LeadPageBytes: avgSummaryBytes * 50,
    durationMs: Date.now() - startedAt,
  };
}

export async function backfillAllLeadSummaries(
  options?: BackfillOptions
): Promise<{
  tenants: BackfillSummaryReport[];
  platformShared: BackfillSummaryReport;
}> {
  const tenants = TenantResolutionService.getAllTenants();
  const tenantReports: BackfillSummaryReport[] = [];
  for (const tenant of tenants) {
    tenantReports.push(await backfillTenantLeadSummaries(tenant.id, options));
  }
  const platformShared = await backfillPlatformSharedLeadSummaries(options);
  return { tenants: tenantReports, platformShared };
}

// Allow direct CLI invocation: `npx tsx server/migration/job_backfill-summaries.ts --dry-run`
const isDirectExecution =
  typeof process !== "undefined" &&
  process.argv[1] &&
  process.argv[1].endsWith("job_backfill-summaries.ts");

if (isDirectExecution) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const tenantArg = args.find((a) => a.startsWith("--tenant="))?.split("=")[1];

  (async () => {
    console.log(
      `[Phase 2 Backfill] Starting summary backfill (${dryRun ? "DRY RUN" : "LIVE WRITE"})...`
    );
    if (tenantArg) {
      const report = await backfillTenantLeadSummaries(tenantArg, { dryRun });
      console.log(JSON.stringify(report, null, 2));
    } else {
      const result = await backfillAllLeadSummaries({ dryRun });
      console.log(JSON.stringify(result, null, 2));
    }
    console.log(
      `[Phase 2 Backfill] Completed (${PLATFORM_SHARED_LEADS_COLLECTION} + tenant leads).`
    );
  })().catch((err) => {
    console.error("[Phase 2 Backfill] Fatal error:", err);
    process.exit(1);
  });
}
