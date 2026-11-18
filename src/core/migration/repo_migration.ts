import { MigrationReport } from "./typ_migration-report";
import { MigrationStateRepository } from "./repo_migration-state";

/**
 * Repository for CRM migration reports.
 * Persists via MigrationStateRepository (PersistentStoreService) so history survives restarts.
 */
export class MigrationRepository {
  public static saveReport(report: MigrationReport): void {
    MigrationStateRepository.saveReport(report);
  }

  public static getReportById(id: string): MigrationReport | null {
    return MigrationStateRepository.getReportById(id);
  }

  public static listReports(): MigrationReport[] {
    return MigrationStateRepository.listReports();
  }

  public static getLatestReport(): MigrationReport | null {
    const list = this.listReports();
    return list.length > 0 ? list[0] : null;
  }
}
