import { PersistentStoreService } from "../database/svc_persistent-store";
import { FileMigrationReport, StorageObjectMetadata } from "./typ_storage-config";

const COL_STORAGE_OBJECTS = "storage_objects";
const COL_FILE_MIGRATION_REPORTS = "file_migration_reports";

function encodeMetaId(objectKey: string): string {
  return Buffer.from(objectKey, "utf8").toString("base64url");
}

export class StorageMetadataRepository {
  public static saveObject(meta: StorageObjectMetadata): StorageObjectMetadata {
    return PersistentStoreService.set(
      COL_STORAGE_OBJECTS,
      encodeMetaId(meta.objectKey),
      meta
    );
  }

  public static getByObjectKey(objectKey: string): StorageObjectMetadata | null {
    const meta = PersistentStoreService.get<StorageObjectMetadata>(
      COL_STORAGE_OBJECTS,
      encodeMetaId(objectKey)
    );
    if (!meta || meta.deletedAt) return null;
    return meta;
  }

  /**
   * Strict tenant-scoped metadata lookup. Returns null if owned by another tenant or deleted.
   */
  public static getByObjectKeyForTenant(
    tenantId: string,
    objectKey: string
  ): StorageObjectMetadata | null {
    const meta = this.getByObjectKey(objectKey);
    if (!meta) return null;
    if (meta.tenantId !== tenantId) return null;
    return meta;
  }

  public static listByTenant(tenantId: string): StorageObjectMetadata[] {
    const all = PersistentStoreService.getAll<StorageObjectMetadata>(COL_STORAGE_OBJECTS);
    return Object.values(all).filter(
      (item) => item.tenantId === tenantId && !item.deletedAt
    );
  }

  public static markDeleted(tenantId: string, objectKey: string): boolean {
    const meta = this.getByObjectKeyForTenant(tenantId, objectKey);
    if (!meta) return false;
    meta.deletedAt = new Date().toISOString();
    meta.updatedAt = meta.deletedAt;
    this.saveObject(meta);
    return true;
  }

  public static saveFileMigrationReport(
    report: FileMigrationReport
  ): FileMigrationReport {
    return PersistentStoreService.set(COL_FILE_MIGRATION_REPORTS, report.id, report);
  }

  public static getFileMigrationReport(id: string): FileMigrationReport | null {
    return PersistentStoreService.get<FileMigrationReport>(
      COL_FILE_MIGRATION_REPORTS,
      id
    );
  }

  public static listFileMigrationReports(): FileMigrationReport[] {
    const all = PersistentStoreService.getAll<FileMigrationReport>(
      COL_FILE_MIGRATION_REPORTS
    );
    return Object.values(all).sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
  }

  public static clearAll(): void {
    PersistentStoreService.clearCollection(COL_STORAGE_OBJECTS);
    PersistentStoreService.clearCollection(COL_FILE_MIGRATION_REPORTS);
  }
}
