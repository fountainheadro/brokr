/**
 * Phase 2 Parity Reconciliation Job: Canonical vs Slim Summary Verification
 *
 * Verifies 100% count, `docVersion`, and field checksum parity between:
 *  - `/tenants/{tenantId}/leads`  <-> `/tenants/{tenantId}/leads_summary`
 *  - `/platform_shared_leads`     <-> `/platform_shared_leads_summary`
 *
 * Optionally repairs any missing, drifted, or orphaned summary documents when `autoRepair: true`.
 *
 * CLI usage:
 *   npx tsx server/migration/job_reconcile-summaries.ts [--repair] [--tenant=<tenantId>]
 */

import { CrmTenantStoreService } from "../../src/core/crm/svc_crm-tenant-store";
import { SharedLeadStoreService } from "../../src/core/crm/svc_shared-leads-store";
import {
  computeSummaryParityChecksum,
  projectLeadToSummary,
  type LeadSummary,
} from "../../src/core/crm/svc_lead-projection";
import { TenantResolutionService } from "../../src/core/tenancy/svc_tenant-resolution";
import {
  backfillPlatformSharedLeadSummaries,
  backfillTenantLeadSummaries,
} from "./job_backfill-summaries";

export interface ReconcileSummaryReport {
  scope: "tenant" | "platform_shared";
  tenantId?: string;
  canonicalCount: number;
  summaryCount: number;
  missingIds: string[];
  orphanIds: string[];
  driftedIds: string[];
  matchedCount: number;
  parityPercent: number;
  isHealthy: boolean;
  repairedCount: number;
  checkedAt: string;
}

function evaluateParity(
  canonicalDocs: Array<Record<string, any>>,
  summaryDocs: LeadSummary[],
  opts: { tenantId?: string; isSharedLead: boolean }
): Omit<ReconcileSummaryReport, "scope" | "tenantId" | "repairedCount" | "checkedAt"> {
  const summaryById = new Map<string, LeadSummary>();
  for (const s of summaryDocs) {
    if (s?.id) summaryById.set(s.id, s);
  }

  const canonicalIds = new Set<string>();
  const missingIds: string[] = [];
  const driftedIds: string[] = [];
  let matchedCount = 0;

  for (const canonical of canonicalDocs) {
    if (!canonical?.id) continue;
    canonicalIds.add(canonical.id);

    const existing = summaryById.get(canonical.id);
    if (!existing) {
      missingIds.push(canonical.id);
      continue;
    }

    const expected = projectLeadToSummary(canonical, {
      tenantId: opts.tenantId,
      isSharedLead: opts.isSharedLead,
      docVersion: Number(canonical.docVersion) >= 1 ? Math.floor(Number(canonical.docVersion)) : 1,
    });

    if (
      Number(existing.docVersion || 0) !== expected.docVersion ||
      computeSummaryParityChecksum(existing) !== computeSummaryParityChecksum(expected)
    ) {
      driftedIds.push(canonical.id);
    } else {
      matchedCount++;
    }
  }

  const orphanIds: string[] = [];
  for (const id of summaryById.keys()) {
    if (!canonicalIds.has(id)) {
      orphanIds.push(id);
    }
  }

  const totalChecked = canonicalIds.size + orphanIds.length;
  const parityPercent =
    totalChecked === 0
      ? 100
      : Math.round((matchedCount / Math.max(canonicalIds.size, summaryById.size)) * 10000) / 100;

  const isHealthy =
    missingIds.length === 0 && orphanIds.length === 0 && driftedIds.length === 0;

  return {
    canonicalCount: canonicalIds.size,
    summaryCount: summaryById.size,
    missingIds,
    orphanIds,
    driftedIds,
    matchedCount,
    parityPercent,
    isHealthy,
  };
}

export async function reconcileTenantLeadSummaries(
  tenantId: string,
  options?: { autoRepair?: boolean }
): Promise<ReconcileSummaryReport> {
  let repairedCount = 0;

  const computeCurrent = async () => {
    const [canonical, summaries] = await Promise.all([
      CrmTenantStoreService.list(tenantId, "leads", { limit: 2000 }),
      CrmTenantStoreService.listLeadSummaries(tenantId, { limit: 2000 }).catch(
        () => [] as LeadSummary[]
      ),
    ]);
    return evaluateParity(canonical, summaries, { tenantId, isSharedLead: false });
  };

  let evaluation = await computeCurrent();
  if (!evaluation.isHealthy && options?.autoRepair) {
    const repairReport = await backfillTenantLeadSummaries(tenantId, { dryRun: false });
    repairedCount = repairReport.written + repairReport.orphansRemoved;
    evaluation = await computeCurrent();
  }

  return {
    scope: "tenant",
    tenantId,
    ...evaluation,
    repairedCount,
    checkedAt: new Date().toISOString(),
  };
}

export async function reconcilePlatformSharedLeadSummaries(options?: {
  autoRepair?: boolean;
}): Promise<ReconcileSummaryReport> {
  let repairedCount = 0;

  const computeCurrent = async () => {
    const [canonical, summaries] = await Promise.all([
      SharedLeadStoreService.listCanonical(2000),
      SharedLeadStoreService.listSummaries(2000).catch(() => [] as LeadSummary[]),
    ]);
    return evaluateParity(canonical, summaries, { isSharedLead: true });
  };

  let evaluation = await computeCurrent();
  if (!evaluation.isHealthy && options?.autoRepair) {
    const repairReport = await backfillPlatformSharedLeadSummaries({ dryRun: false });
    repairedCount = repairReport.written + repairReport.orphansRemoved;
    evaluation = await computeCurrent();
  }

  return {
    scope: "platform_shared",
    ...evaluation,
    repairedCount,
    checkedAt: new Date().toISOString(),
  };
}

export async function reconcileAllLeadSummaries(options?: {
  autoRepair?: boolean;
}): Promise<{
  tenants: ReconcileSummaryReport[];
  platformShared: ReconcileSummaryReport;
  allHealthy: boolean;
}> {
  const tenants = TenantResolutionService.getAllTenants();
  const tenantReports: ReconcileSummaryReport[] = [];
  for (const tenant of tenants) {
    tenantReports.push(await reconcileTenantLeadSummaries(tenant.id, options));
  }
  const platformShared = await reconcilePlatformSharedLeadSummaries(options);
  const allHealthy =
    platformShared.isHealthy && tenantReports.every((report) => report.isHealthy);

  return {
    tenants: tenantReports,
    platformShared,
    allHealthy,
  };
}

const isDirectExecution =
  typeof process !== "undefined" &&
  process.argv[1] &&
  process.argv[1].endsWith("job_reconcile-summaries.ts");

if (isDirectExecution) {
  const args = process.argv.slice(2);
  const autoRepair = args.includes("--repair");
  const tenantArg = args.find((a) => a.startsWith("--tenant="))?.split("=")[1];

  (async () => {
    console.log(
      `[Phase 2 Reconcile] Checking summary parity (autoRepair=${autoRepair})...`
    );
    if (tenantArg) {
      const report = await reconcileTenantLeadSummaries(tenantArg, { autoRepair });
      console.log(JSON.stringify(report, null, 2));
      if (!report.isHealthy) process.exit(1);
    } else {
      const result = await reconcileAllLeadSummaries({ autoRepair });
      console.log(JSON.stringify(result, null, 2));
      if (!result.allHealthy) process.exit(1);
    }
  })().catch((err) => {
    console.error("[Phase 2 Reconcile] Fatal error:", err);
    process.exit(1);
  });
}
