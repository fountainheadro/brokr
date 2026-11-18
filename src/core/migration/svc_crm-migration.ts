import {
  MigrationReport,
  MigrationMode,
  CollectionMigrationStats,
} from "./typ_migration-report";
import { MigrationRepository } from "./repo_migration";
import { TenantResolutionService } from "../tenancy/svc_tenant-resolution";
import { PlatformAuditLogRepository } from "../platform/repo_platform-audit-log";
import { TenantScopedRepository } from "../database/repo_tenant-scoped";
import { AppError } from "../errors/app_error";
import { PersistentStoreService } from "../database/svc_persistent-store";
import {
  FirestoreRestMigrationAdapter,
  LegacyMigrationService,
} from "./svc_legacy-migration";

/**
 * Service orchestrating CRM data migration into the initial agency tenant.
 * Delegates live Firestore migration to LegacyMigrationService when remote Firestore credentials exist
 * (or when explicitly requested), while preserving TenantScopedRepository sample migration for Phase 7 UI/tests.
 */
export class CrmMigrationService {
  // Collections participating in the CRM migration
  public static readonly TARGET_COLLECTIONS = [
    "leads",
    "contacts",
    "personal",
    "documents",
    "activities",
    "tours",
    "viewings",
    "notifications",
  ];

  // Sample root records cache used ONLY in sample/dev dry-run when live Firestore server credentials are absent
  private static rootSampleData = new Map<string, Array<{ id: string; [key: string]: any }>>([
    [
      "leads",
      [
        {
          id: "lead_init_1",
          propertyId: "P17240",
          title: "Apartament 2 camere Nicolae Teclu | Metrou | Finisat modern | Parcare inclusă",
          price: "550 € / lună",
          zone: "Nicolae Teclu",
          status: "Colaborare",
          transactionType: "Închiriere",
          categoria: "Apartamente",
          ownerName: "Ion Popescu",
          ownerPhone: "+40 722 111 222",
          createdAt: "2026-01-10T10:00:00.000Z",
        },
        {
          id: "lead_init_2",
          propertyId: "P17241",
          title: "Garsonieră modernă Timpuri Noi | Proximitate Metrou | Mobilată complet",
          price: "420 € / lună",
          zone: "Timpuri Noi",
          status: "Prospectare",
          transactionType: "Închiriere",
          categoria: "Apartamente",
          ownerName: "Maria Georgescu",
          ownerPhone: "+40 733 444 555",
          createdAt: "2026-01-12T14:30:00.000Z",
        },
        {
          id: "lead_init_3",
          propertyId: "R1004",
          title: "Cerere: Cumpărare 3 camere Pipera / Aviatiei buget 180.000€",
          price: "180.000 €",
          zone: "Pipera",
          status: "Matching",
          transactionType: "Vânzare",
          categoria: "Apartamente",
          notes: "Client interesat de etaje intermediare, loc parcare subteran.",
          createdAt: "2026-01-15T09:15:00.000Z",
        },
      ],
    ],
    [
      "contacts",
      [
        {
          id: "cnt_init_1",
          name: "Ion Popescu",
          phone: "+40 722 111 222",
          email: "ion.popescu@gmail.com",
          role: "Proprietar",
          notes: "Proprietar apartament Nicolae Teclu",
          createdAt: "2026-01-10T10:05:00.000Z",
        },
        {
          id: "cnt_init_2",
          name: "Andrei Vasile",
          phone: "+40 744 999 888",
          email: "andrei.vasile@client.ro",
          role: "Cumparator",
          notes: "Client căutare 3 camere Pipera",
          createdAt: "2026-01-15T09:20:00.000Z",
        },
      ],
    ],
    [
      "personal",
      [
        {
          id: "pers_init_1",
          name: "Alexandru Radu",
          email: "alexandru.radu@brokr.ro",
          phone: "+40 711 000 111",
          role: "Broker Principal",
          active: true,
          createdAt: "2026-01-01T08:00:00.000Z",
        },
      ],
    ],
    [
      "documents",
      [
        {
          id: "doc_init_1",
          leadId: "lead_init_1",
          title: "Schita_Cadastrala_P17240.pdf",
          url: "https://storage.googleapis.com/brokr-docs/schita_1.pdf",
          size: 1420500,
          mimeType: "application/pdf",
          createdAt: "2026-01-10T11:00:00.000Z",
        },
      ],
    ],
    [
      "activities",
      [
        {
          id: "act_init_1",
          leadId: "lead_init_1",
          title: "Vizionare cu client potențial",
          type: "Vizionare",
          date: "2026-01-18T16:00:00.000Z",
          completed: true,
          createdAt: "2026-01-16T12:00:00.000Z",
        },
      ],
    ],
    ["tours", []],
    ["viewings", []],
    ["notifications", []],
  ]);

  /**
   * Runs the migration in either 'dry_run' or 'live' mode.
   * When live Firestore server credentials exist (and useLiveFirestore !== false), runs LegacyMigrationService
   * against Firestore REST API. Otherwise safely inspects/migrates in-memory TenantScopedRepository data.
   */
  public static async executeMigration(params: {
    targetTenantId?: string;
    mode: MigrationMode;
    executedBy: string;
    collectionsToMigrate?: string[];
    useLiveFirestore?: boolean;
    strictOwnershipRequired?: boolean;
    allowSingleAgencyFallback?: boolean;
  }): Promise<MigrationReport> {
    const targetTenantId = params.targetTenantId || "ten_brokr_default";
    const tenant = TenantResolutionService.getTenantById(targetTenantId);

    if (!tenant) {
      throw new AppError({
        message: `Tenantul țintă "${targetTenantId}" nu există în platformă.`,
        code: "NOT_FOUND",
        statusCode: 404,
      });
    }

    const shouldUseLiveFirestore =
      params.useLiveFirestore !== false &&
      process.env.NODE_ENV !== "test" &&
      PersistentStoreService.isRemoteFirestoreConfigured();

    if (shouldUseLiveFirestore) {
      return LegacyMigrationService.executeMigration({
        adapter: new FirestoreRestMigrationAdapter(),
        targetTenantId,
        mode: params.mode,
        executedBy: params.executedBy,
        collectionsToMigrate: params.collectionsToMigrate || this.TARGET_COLLECTIONS,
        strictOwnershipRequired: params.strictOwnershipRequired ?? true,
        allowSingleAgencyFallback: params.allowSingleAgencyFallback ?? false,
      });
    }

    const collections = params.collectionsToMigrate || this.TARGET_COLLECTIONS;
    const migrationId = `mig_${Date.now()}`;
    const startedAt = new Date().toISOString();

    const collectionStats: Record<string, CollectionMigrationStats> = {};
    let totalRecordsFound = 0;
    let totalValidRecords = 0;
    let totalMigrated = 0;
    let totalSkippedDuplicates = 0;
    let totalErrors = 0;
    const warnings: string[] = [];

    // Process each collection
    for (const colName of collections) {
      const records = this.rootSampleData.get(colName) || [];
      const stats: CollectionMigrationStats = {
        collectionName: colName,
        totalFound: records.length,
        validRecords: 0,
        migrated: 0,
        skippedDuplicates: 0,
        failed: 0,
        errors: [],
      };

      totalRecordsFound += records.length;

      // Scoped repository representing target tenant storage: /tenants/{tenantId}/{destColName}
      const destColName = colName === "personal" ? "staff" : colName;
      const tenantRepo = new TenantScopedRepository(null, destColName);

      for (const record of records) {
        try {
          if (!record.id) {
            stats.failed++;
            stats.errors.push(`Document lipsă ID în colecția ${colName}`);
            continue;
          }

          if (record.leadId) {
            const leads = this.rootSampleData.get("leads") || [];
            const referencedLead = leads.find((l) => l.id === record.leadId);
            if (!referencedLead) {
              warnings.push(
                `Înregistrarea ${record.id} din ${colName} referențiază un leadId inexistent: ${record.leadId}`
              );
            }
          }

          const existing = await tenantRepo.findById(targetTenantId, record.id);
          if (existing) {
            stats.skippedDuplicates++;
            totalSkippedDuplicates++;
            continue;
          }

          stats.validRecords++;
          totalValidRecords++;

          if (params.mode === "live") {
            await tenantRepo.create(
              targetTenantId,
              record.id,
              {
                ...record,
                tenantId: targetTenantId,
                migratedFrom: `/${colName}/${record.id}`,
                migratedAt: new Date().toISOString(),
                migrationId,
              },
              params.executedBy
            );
            stats.migrated++;
            totalMigrated++;
          }
        } catch (err: any) {
          stats.failed++;
          totalErrors++;
          stats.errors.push(`Eroare la migrarea ${record.id}: ${err?.message || String(err)}`);
        }
      }

      collectionStats[colName] = stats;
    }

    const completedAt = new Date().toISOString();
    const isSafeToMigrate = totalErrors === 0;

    const report: MigrationReport = {
      id: migrationId,
      targetTenantId,
      targetTenantName: tenant.name,
      mode: params.mode,
      status: totalErrors === 0 ? "completed" : "failed",
      startedAt,
      completedAt,
      executedBy: params.executedBy,
      collections: collectionStats,
      summary: {
        totalRecordsFound,
        totalValidRecords,
        totalMigrated: params.mode === "live" ? totalMigrated : 0,
        totalSkippedDuplicates,
        totalErrors,
        isSafeToMigrate,
      },
      warnings,
      sourceBackend: "sample_store",
    };

    MigrationRepository.saveReport(report);

    PlatformAuditLogRepository.addLog({
      action:
        params.mode === "dry_run"
          ? ("CRM_DATA_MIGRATION_DRY_RUN" as any)
          : ("CRM_DATA_MIGRATION_EXECUTE" as any),
      actorUserId: params.executedBy,
      actorEmail: params.executedBy,
      targetType: "migration" as any,
      targetId: migrationId,
      details: {
        targetTenantId,
        mode: params.mode,
        summary: report.summary,
      },
      ipAddress: "127.0.0.1",
    });

    return report;
  }
}
