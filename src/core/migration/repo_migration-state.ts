import { PersistentStoreService } from "../database/svc_persistent-store";
import {
  ManualReviewRecord,
  MigrationCheckpoint,
  MigrationReport,
  MigrationValidationReport,
} from "./typ_migration-report";

const COL_MIGRATION_CHECKPOINTS = "migration_checkpoints";
const COL_MIGRATION_REPORTS = "migration_reports";
const COL_MIGRATION_VALIDATIONS = "migration_validation_reports";
const COL_MIGRATION_MANUAL_REVIEWS = "migration_manual_reviews";

/**
 * Persistent repository for migration execution state, checkpoints (resumability),
 * reports, manual-review queues, and post-migration integrity validations.
 * Backed by PersistentStoreService (local durable write-through + Firestore REST when configured).
 */
export class MigrationStateRepository {
  public static saveCheckpoint(checkpoint: MigrationCheckpoint): MigrationCheckpoint {
    return PersistentStoreService.set(
      COL_MIGRATION_CHECKPOINTS,
      checkpoint.migrationId,
      checkpoint
    );
  }

  public static getCheckpoint(migrationId: string): MigrationCheckpoint | null {
    return PersistentStoreService.get<MigrationCheckpoint>(
      COL_MIGRATION_CHECKPOINTS,
      migrationId
    );
  }

  public static listCheckpoints(): MigrationCheckpoint[] {
    const all = PersistentStoreService.getAll<MigrationCheckpoint>(
      COL_MIGRATION_CHECKPOINTS
    );
    return Object.values(all).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  public static getLatestIncompleteCheckpoint(): MigrationCheckpoint | null {
    return (
      this.listCheckpoints().find(
        (cp) => cp.status === "in_progress" || cp.status === "interrupted" || cp.status === "failed"
      ) || null
    );
  }

  public static saveReport(report: MigrationReport): MigrationReport {
    return PersistentStoreService.set(COL_MIGRATION_REPORTS, report.id, report);
  }

  public static getReportById(id: string): MigrationReport | null {
    return PersistentStoreService.get<MigrationReport>(COL_MIGRATION_REPORTS, id);
  }

  public static listReports(): MigrationReport[] {
    const all = PersistentStoreService.getAll<MigrationReport>(COL_MIGRATION_REPORTS);
    return Object.values(all).sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
  }

  public static saveValidationReport(
    report: MigrationValidationReport
  ): MigrationValidationReport {
    return PersistentStoreService.set(
      COL_MIGRATION_VALIDATIONS,
      report.validationId,
      report
    );
  }

  public static getValidationReport(id: string): MigrationValidationReport | null {
    return PersistentStoreService.get<MigrationValidationReport>(
      COL_MIGRATION_VALIDATIONS,
      id
    );
  }

  public static listValidationReports(): MigrationValidationReport[] {
    const all = PersistentStoreService.getAll<MigrationValidationReport>(
      COL_MIGRATION_VALIDATIONS
    );
    return Object.values(all).sort(
      (a, b) => new Date(b.verifiedAt).getTime() - new Date(a.verifiedAt).getTime()
    );
  }

  public static saveManualReviewRecords(
    migrationId: string,
    records: ManualReviewRecord[]
  ): void {
    PersistentStoreService.set(COL_MIGRATION_MANUAL_REVIEWS, migrationId, {
      migrationId,
      updatedAt: new Date().toISOString(),
      records,
    });
  }

  public static getManualReviewRecords(migrationId: string): ManualReviewRecord[] {
    const entry = PersistentStoreService.get<{ records?: ManualReviewRecord[] }>(
      COL_MIGRATION_MANUAL_REVIEWS,
      migrationId
    );
    return Array.isArray(entry?.records) ? entry!.records : [];
  }

  public static clearAll(): void {
    PersistentStoreService.clearCollection(COL_MIGRATION_CHECKPOINTS);
    PersistentStoreService.clearCollection(COL_MIGRATION_REPORTS);
    PersistentStoreService.clearCollection(COL_MIGRATION_VALIDATIONS);
    PersistentStoreService.clearCollection(COL_MIGRATION_MANUAL_REVIEWS);
  }
}
