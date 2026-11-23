export type StorageEntityType = "properties" | "documents" | "users" | "general";

export type StorageVisibility = "private" | "public_listing";

export type StorageBackendKind = "gcs" | "gcs_emulator" | "local_isolated";

export interface StorageObjectMetadata {
  objectKey: string; // e.g. "tenants/ten_brokr_default/properties/P17240/prop_123.jpg"
  tenantId: string;
  entityType: StorageEntityType;
  entityId: string;
  fileName: string;
  originalFileName?: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  visibility: StorageVisibility;
  uploadedByUserId: string;
  bucketName: string;
  backend: StorageBackendKind;
  publicUrl?: string;
  variantKeys?: string[];
  cacheControl?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface OrphanMediaItem {
  objectKey: string;
  tenantId: string;
  entityType: StorageEntityType;
  entityId: string;
  sizeBytes: number;
  visibility: StorageVisibility;
  createdAt: string;
  reason: "unreferenced_storage_object";
}

export interface OrphanMediaReport {
  generatedAt: string;
  tenantId: string | "all";
  dryRun: true;
  totalActiveObjects: number;
  referencedCount: number;
  orphanCount: number;
  orphanTotalBytes: number;
  orphans: OrphanMediaItem[];
}

export interface UploadStorageObjectInput {
  tenantId: string;
  entityType: StorageEntityType;
  entityId: string;
  fileName: string;
  buffer: Buffer;
  declaredMimeType?: string;
  visibility?: StorageVisibility;
  uploadedByUserId: string;
  isImageOnly?: boolean;
}

export interface FileMigrationItemResult {
  localFileName: string;
  localRelativeUrl: string; // e.g. "/uploads/prop_123.jpg"
  localPath: string;
  sizeBytes: number;
  sha256: string;
  status:
    | "pending"
    | "migrated"
    | "skipped_duplicate"
    | "manual_review"
    | "failed";
  resolvedTenantId?: string;
  entityType?: StorageEntityType;
  entityId?: string;
  visibility?: StorageVisibility;
  destinationObjectKey?: string;
  destinationUrl?: string;
  checksumVerified?: boolean;
  reason?: string;
  error?: string;
}

export interface FileMigrationReport {
  id: string;
  mode: "dry_run" | "live";
  status: "in_progress" | "interrupted" | "completed" | "failed";
  startedAt: string;
  completedAt: string;
  executedBy: string;
  uploadsDir: string;
  storageBackend: StorageBackendKind;
  bucketName: string;
  localFilesPreserved: boolean;
  referencesUpdated: boolean;
  summary: {
    totalFilesFound: number;
    migratedCount: number;
    skippedDuplicatesCount: number;
    manualReviewCount: number;
    failedCount: number;
    checksumVerifiedCount: number;
  };
  items: FileMigrationItemResult[];
  referenceUpdates: Array<{
    collectionName: string;
    recordId: string;
    oldUrl: string;
    newUrl: string;
    newObjectKey: string;
    updated: boolean;
  }>;
}
