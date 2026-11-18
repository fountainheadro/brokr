export type MigrationMode = "dry_run" | "live";
export type MigrationStatus =
  | "pending"
  | "in_progress"
  | "interrupted"
  | "completed"
  | "failed";

export interface CollectionMigrationStats {
  collectionName: string;
  totalFound: number;
  validRecords: number;
  migrated: number;
  skippedDuplicates: number;
  skippedManualReview?: number;
  conflictsCount?: number;
  failed: number;
  errors: string[];
}

export interface LegacyCollectionInventoryItem {
  collectionName: string;
  currentLocation: string;
  expectedDestination: string;
  entityTypes: string[];
  recordCount: number | null;
  liveCountStatus: "measured_live" | "measured_adapter" | "unavailable_without_server_credentials";
  relatedEntities: string[];
  readers: string[];
  writers: string[];
  cutoverStatus: "legacy_root_active" | "dual_write_ready" | "tenant_scoped";
  notes?: string;
}

export interface OwnershipResolutionResult {
  resolved: boolean;
  tenantId: string | null;
  reason: string;
  sourceField?: string;
  requiresManualReview: boolean;
  candidateTenantIds?: string[];
  detectedEmails?: string[];
}

export interface ManualReviewRecord {
  collectionName: string;
  recordId: string;
  reason: string;
  candidateTenantIds: string[];
  detectedEmails?: string[];
  relatedIds?: Record<string, string>;
  preservedInSource: boolean;
}

export interface MigrationConflictRecord {
  collectionName: string;
  recordId: string;
  targetTenantId: string;
  destinationPath: string;
  reason: string;
  sourceChecksum: string;
  destinationChecksum: string;
}

export interface FailedMigrationItem {
  collectionName: string;
  recordId: string;
  error: string;
  attempts: number;
}

export interface MigrationCheckpoint {
  migrationId: string;
  version: string;
  mode: MigrationMode;
  targetTenantId?: string;
  executedBy: string;
  collectionsOrder: string[];
  currentCollection: string | null;
  lastProcessedBatch: number;
  lastDocumentId: string | null;
  processedDocumentKeys: string[];
  failedRecords: FailedMigrationItem[];
  processedCount: number;
  migratedCount: number;
  skippedDuplicatesCount: number;
  conflictsCount: number;
  manualReviewCount: number;
  errorCount: number;
  status: MigrationStatus;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface CollectionValidationDetail {
  collectionName: string;
  sourceCount: number;
  expectedMigratedCount: number;
  destinationCount: number;
  missingInDestination: string[];
  mismatchedRecords: Array<{
    recordId: string;
    tenantId: string;
    diffs: string[];
  }>;
  duplicateIdsInDestination: string[];
  brokenReferences: Array<{
    recordId: string;
    refField: string;
    refValue: string;
  }>;
}

export interface MigrationValidationReport {
  validationId: string;
  migrationId?: string;
  verifiedAt: string;
  targetTenantIds: string[];
  sourceBackend: "firestore_live" | "in_memory_adapter" | "sample_store";
  destinationBackend: "firestore_live" | "in_memory_adapter" | "sample_store";
  allPassed: boolean;
  collections: CollectionValidationDetail[];
  summary: {
    totalSourceRecords: number;
    totalDestinationVerified: number;
    totalMissing: number;
    totalMismatched: number;
    totalDuplicates: number;
    totalBrokenReferences: number;
  };
}

export interface MigrationReport {
  id: string;
  targetTenantId: string;
  targetTenantName: string;
  mode: MigrationMode;
  status: MigrationStatus;
  startedAt: string;
  completedAt: string;
  executedBy: string;
  collections: Record<string, CollectionMigrationStats>;
  summary: {
    totalRecordsFound: number;
    totalValidRecords: number;
    totalMigrated: number;
    totalSkippedDuplicates: number;
    totalErrors: number;
    isSafeToMigrate: boolean;
  };
  warnings: string[];
  sourceBackend?: "firestore_live" | "in_memory_adapter" | "sample_store";
  checkpointId?: string;
  resumedFromCheckpoint?: boolean;
  manualReviewCount?: number;
  manualReviewRecords?: ManualReviewRecord[];
  conflictsCount?: number;
  conflicts?: MigrationConflictRecord[];
  validationReport?: MigrationValidationReport;
}

export interface ExecuteMigrationRequest {
  targetTenantId?: string;
  mode: MigrationMode;
  collectionsToMigrate?: string[];
  batchSize?: number;
  strictOwnershipRequired?: boolean;
  allowSingleAgencyFallback?: boolean;
  resumeMigrationId?: string;
}
