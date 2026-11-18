import { PersistentStoreService } from "../database/svc_persistent-store";
import { TenantResolutionService } from "../tenancy/svc_tenant-resolution";
import { PlatformAuditLogRepository } from "../platform/repo_platform-audit-log";
import { AppError } from "../errors/app_error";
import { MigrationStateRepository } from "./repo_migration-state";
import { ManualReviewRecord } from "./typ_migration-report";

export interface ManualOwnershipAssignment {
  key: string; // `${collectionName}::${recordId}`
  collectionName: string;
  recordId: string;
  targetTenantId: string;
  targetTenantName: string;
  decision: "assigned" | "held";
  reason: string;
  assignedBy: string;
  assignedAt: string;
  migrationId?: string;
}

const COL_OWNERSHIP_ASSIGNMENTS = "migration_ownership_assignments";

/**
 * Super-Admin-only workflow for resolving ambiguous or unowned legacy CRM records.
 * Source records in Firestore root collections are NEVER mutated; decisions are stored
 * as audited overrides applied cleanly during subsequent migration & validation passes.
 */
export class OwnershipResolutionService {
  public static listAssignments(): ManualOwnershipAssignment[] {
    const all = PersistentStoreService.getAll<ManualOwnershipAssignment>(
      COL_OWNERSHIP_ASSIGNMENTS
    );
    return Object.values(all).sort(
      (a, b) => new Date(b.assignedAt).getTime() - new Date(a.assignedAt).getTime()
    );
  }

  public static getAssignment(
    collectionName: string,
    recordId: string
  ): ManualOwnershipAssignment | null {
    return PersistentStoreService.get<ManualOwnershipAssignment>(
      COL_OWNERSHIP_ASSIGNMENTS,
      `${collectionName}::${recordId}`
    );
  }

  public static getPendingManualReviews(): {
    migrationId: string | null;
    pending: ManualReviewRecord[];
    resolved: ManualOwnershipAssignment[];
  } {
    const reports = MigrationStateRepository.listReports();
    const assignments = this.listAssignments();
    const assignmentMap = new Map<string, ManualOwnershipAssignment>();
    for (const a of assignments) {
      assignmentMap.set(a.key, a);
    }

    const latestWithReview =
      reports.find((r) => (r.manualReviewCount || 0) > 0) || reports[0] || null;

    if (!latestWithReview) {
      return { migrationId: null, pending: [], resolved: assignments };
    }

    const rawRecords =
      latestWithReview.manualReviewRecords ||
      MigrationStateRepository.getManualReviewRecords(latestWithReview.id);

    const pending = rawRecords.filter(
      (rec) => !assignmentMap.has(`${rec.collectionName}::${rec.recordId}`)
    );

    return {
      migrationId: latestWithReview.id,
      pending,
      resolved: assignments,
    };
  }

  public static assignManualOwnership(params: {
    collectionName: string;
    recordId: string;
    targetTenantId: string;
    decision?: "assigned" | "held";
    reason?: string;
    assignedBy: string;
    confirmed: boolean;
    migrationId?: string;
  }): ManualOwnershipAssignment {
    if (!params.confirmed) {
      throw new AppError({
        message: "Atribuirea manuală a proprietății necesită confirmare explicită.",
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    }

    if (!params.collectionName?.trim() || !params.recordId?.trim()) {
      throw new AppError({
        message: "collectionName și recordId sunt obligatorii.",
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    }

    const decision = params.decision || "assigned";
    let targetTenantName = "Held / Unassigned";

    if (decision === "assigned") {
      const tenant = TenantResolutionService.getTenantById(params.targetTenantId);
      if (!tenant) {
        throw new AppError({
          message: `Tenantul selectat "${params.targetTenantId}" nu există.`,
          code: "NOT_FOUND",
          statusCode: 404,
        });
      }
      targetTenantName = tenant.name;
    }

    const key = `${params.collectionName.trim()}::${params.recordId.trim()}`;
    const entry: ManualOwnershipAssignment = {
      key,
      collectionName: params.collectionName.trim(),
      recordId: params.recordId.trim(),
      targetTenantId: decision === "assigned" ? params.targetTenantId : "",
      targetTenantName,
      decision,
      reason:
        (params.reason || "").trim() ||
        (decision === "assigned"
          ? "Atribuire manuală verificată de Super Admin"
          : "Reținut pentru verificare suplimentară"),
      assignedBy: params.assignedBy,
      assignedAt: new Date().toISOString(),
      migrationId: params.migrationId,
    };

    PersistentStoreService.set(COL_OWNERSHIP_ASSIGNMENTS, key, entry);

    PlatformAuditLogRepository.addLog({
      action: "MIGRATION_MANUAL_OWNERSHIP_ASSIGNED" as any,
      actorUserId: params.assignedBy,
      actorEmail: params.assignedBy,
      targetType: "migration" as any,
      targetId: key,
      details: {
        collectionName: entry.collectionName,
        recordId: entry.recordId,
        targetTenantId: entry.targetTenantId,
        decision: entry.decision,
        reason: entry.reason,
        sourceMutated: false,
      },
      ipAddress: "127.0.0.1",
    });

    return entry;
  }

  public static clearAll(): void {
    PersistentStoreService.clearCollection(COL_OWNERSHIP_ASSIGNMENTS);
  }
}
