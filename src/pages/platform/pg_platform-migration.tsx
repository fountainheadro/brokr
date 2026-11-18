import React, { useEffect, useState } from "react";
import {
  Database,
  ShieldCheck,
  Play,
  RotateCw,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  ArrowRight,
  Loader2,
  HardDrive,
  Server,
  Lock,
  UserCheck,
  RefreshCw,
} from "lucide-react";
import { CmpPlatformLayout } from "../../ui/platform/cmp_platform-layout";
import {
  LegacyCollectionInventoryItem,
  ManualReviewRecord,
  MigrationCheckpoint,
  MigrationReport,
} from "../../core/migration/typ_migration-report";
import { useAuth } from "../../core/auth/ctx_auth";
import { VirtualizedStack, VirtualizedTbody } from "../../components/VirtualizedList";

interface InfraStatusSummary {
  checkedAt: string;
  environment: string;
  firebaseProjectId: string;
  firestoreDatabaseId: string;
  storageBucket: string;
  authMethod?: string;
  firestore: {
    configured: boolean;
    liveReachable: boolean;
    httpStatus: number | null;
    status: string;
    details: string;
  };
  cloudStorage: {
    activeBackend: string;
    liveGcsReachable: boolean;
    httpStatus: number | null;
    status: string;
    details: string;
  };
  localUploadsDirFileCount: number;
  liveExecutionReady: boolean;
  blockers: string[];
}

interface CutoverReadinessSummary {
  safeToDisableLegacyRules: boolean;
  legacyRootRulesStillRequired: boolean;
  backupVerified: boolean;
  liveGcpBackupVerified?: boolean;
  latestBackupId: string | null;
  blockers: string[];
  cutoverMode: {
    mode: "tenant_scoped" | "legacy_rollback_standby";
    updatedAt: string;
    updatedBy: string;
    reason: string;
  };
  latestValidationPassed: boolean;
  servicesInventory: Array<{
    serviceName: string;
    currentCollection: string;
    targetTenantPath: string;
    usesTenantContext: boolean;
  }>;
}

export const PgPlatformMigration: React.FC = () => {
  const { user } = useAuth();

  const [reports, setReports] = useState<MigrationReport[]>([]);
  const [latestReport, setLatestReport] = useState<MigrationReport | null>(null);
  const [targetTenantId, setTargetTenantId] = useState<string>("ten_brokr_default");
  const [isRunningDryRun, setIsRunningDryRun] = useState<boolean>(false);
  const [isExecutingLive, setIsExecutingLive] = useState<boolean>(false);
  const [isConfirmingExecute, setIsConfirmingExecute] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [infraStatus, setInfraStatus] = useState<InfraStatusSummary | null>(null);
  const [inventory, setInventory] = useState<LegacyCollectionInventoryItem[]>([]);
  const [cutoverReadiness, setCutoverReadiness] = useState<CutoverReadinessSummary | null>(null);
  const [checkpoints, setCheckpoints] = useState<MigrationCheckpoint[]>([]);
  const [pendingReviews, setPendingReviews] = useState<ManualReviewRecord[]>([]);
  const [reviewTenants, setReviewTenants] = useState<Record<string, string>>({});
  const [reviewConfirmed, setReviewConfirmed] = useState<Record<string, boolean>>({});
  const [backupType, setBackupType] = useState<"firestore_gcs_export" | "firestore_pitr">("firestore_gcs_export");
  const [backupUri, setBackupUri] = useState<string>("gs://brokr-42038-backups/manual-snapshot");
  const [backupPitrTs, setBackupPitrTs] = useState<string>("");
  const [backupNotes, setBackupNotes] = useState<string>("");
  const [backupConfirmed, setBackupConfirmed] = useState<boolean>(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const fetchAllMigrationTelemetry = async (deepProbe = false) => {
    try {
      const token = await user?.getIdToken();
      if (!token) return;
      const headers = { Authorization: `Bearer ${token}` };

      const [histRes, infraRes, invRes, cutRes, cpRes, revRes] = await Promise.all([
        fetch("/api/platform/migration/history", { headers }),
        fetch(`/api/platform/migration/infra-status${deepProbe ? "?deep=true" : ""}`, { headers }),
        fetch("/api/platform/migration/inventory", { headers }),
        fetch("/api/platform/migration/cutover-readiness", { headers }),
        fetch("/api/platform/migration/checkpoints", { headers }),
        fetch("/api/platform/migration/manual-review", { headers }),
      ]);

      if (histRes.ok) {
        const j = await histRes.json();
        if (j.success && Array.isArray(j.data)) {
          setReports(j.data);
          if (j.data.length > 0 && !latestReport) {
            setLatestReport(j.data[0]);
          }
        }
      }
      if (infraRes.ok) {
        const j = await infraRes.json();
        if (j.success) setInfraStatus(j.data);
      }
      if (invRes.ok) {
        const j = await invRes.json();
        if (j.success && Array.isArray(j.data?.items)) setInventory(j.data.items);
      }
      if (cutRes.ok) {
        const j = await cutRes.json();
        if (j.success) setCutoverReadiness(j.data);
      }
      if (cpRes.ok) {
        const j = await cpRes.json();
        if (j.success && Array.isArray(j.data)) setCheckpoints(j.data);
      }
      if (revRes.ok) {
        const j = await revRes.json();
        if (j.success && Array.isArray(j.data?.pending)) setPendingReviews(j.data.pending);
      }
    } catch (err: any) {
      console.warn("Error fetching migration telemetry:", err);
    }
  };

  useEffect(() => {
    void fetchAllMigrationTelemetry();
  }, [user]);

  const handleRunDryRun = async () => {
    try {
      setIsRunningDryRun(true);
      setError(null);
      setActionNotice(null);
      const token = await user?.getIdToken();
      const res = await fetch("/api/platform/migration/dry-run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ targetTenantId }),
      });

      const json = await res.json();
      if (json.success && json.data) {
        setLatestReport(json.data);
        await fetchAllMigrationTelemetry();
      } else {
        setError(json.error?.message || "Eroare la rularea verificării de siguranță.");
      }
    } catch (err: any) {
      setError(err?.message || "Eroare rețea la rularea verificării.");
    } finally {
      setIsRunningDryRun(false);
    }
  };

  const handleExecuteLive = async () => {
    if (!latestReport || !latestReport.summary.isSafeToMigrate) {
      setError("Trebuie să rulați mai întâi o verificare de siguranță (Dry-Run) validă!");
      return;
    }

    if (!isConfirmingExecute) {
      setIsConfirmingExecute(true);
      return;
    }

    try {
      setIsConfirmingExecute(false);
      setIsExecutingLive(true);
      setError(null);
      setActionNotice(null);
      const token = await user?.getIdToken();
      const res = await fetch("/api/platform/migration/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ targetTenantId }),
      });

      const json = await res.json();
      if (json.success && json.data) {
        setLatestReport(json.data);
        await fetchAllMigrationTelemetry();
      } else {
        setError(json.error?.message || "Eroare la executarea migrării.");
      }
    } catch (err: any) {
      setError(err?.message || "Eroare de conexiune la executare.");
    } finally {
      setIsExecutingLive(false);
    }
  };

  const handleVerifyLiveBackup = async () => {
    try {
      setError(null);
      setActionNotice(null);
      const token = await user?.getIdToken();
      const res = await fetch("/api/platform/migration/backup/verify-live", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          backupType,
          exportGcsUri: backupType === "firestore_gcs_export" ? backupUri : undefined,
          pitrTimestamp: backupType === "firestore_pitr" ? backupPitrTs : undefined,
          notes: backupNotes,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json?.error?.message || "Verificarea live GCP a backup-ului a eșuat.");
        return;
      }
      setActionNotice(
        `Backup verificat real în GCP (${json.data.evidence.verificationLevel}) cu ID ${json.data.record.backupId}.`
      );
      await fetchAllMigrationTelemetry();
    } catch (err: any) {
      setError(err?.message || "Eroare rețea la verificarea live a backup-ului.");
    }
  };

  const handleVerifyBackup = async () => {
    try {
      setError(null);
      setActionNotice(null);
      const token = await user?.getIdToken();
      const res = await fetch("/api/platform/migration/backup/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          backupType,
          exportGcsUri: backupType === "firestore_gcs_export" ? backupUri : undefined,
          pitrTimestamp: backupType === "firestore_pitr" ? backupPitrTs : undefined,
          notes: backupNotes,
          confirmedRecoverable: backupConfirmed,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json?.error?.message || "Nu s-a putut înregistra verificarea backup-ului.");
        return;
      }
      setActionNotice(`Atestare înregistrată cu ID ${json.data.backupId} (necesită verificare GCP pentru migrare live).`);
      setBackupConfirmed(false);
      await fetchAllMigrationTelemetry();
    } catch (err: any) {
      setError(err?.message || "Eroare rețea la înregistrarea backup-ului.");
    }
  };

  const handleAssignManualReview = async (rec: ManualReviewRecord) => {
    const key = `${rec.collectionName}::${rec.recordId}`;
    const chosenTenant = reviewTenants[key] || rec.candidateTenantIds?.[0] || "ten_brokr_default";
    if (!reviewConfirmed[key]) {
      setError(`Bifați confirmarea pentru atribuirea manuală a înregistrării ${rec.recordId}.`);
      return;
    }

    try {
      setError(null);
      const token = await user?.getIdToken();
      const res = await fetch("/api/platform/migration/manual-review/assign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          collectionName: rec.collectionName,
          recordId: rec.recordId,
          targetTenantId: chosenTenant,
          decision: "assigned",
          confirmed: true,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json?.error?.message || "Eroare atribuire manuală.");
        return;
      }
      setActionNotice(`Înregistrarea ${rec.recordId} a fost atribuită tenantului ${chosenTenant} în jurnalul de audit.`);
      await fetchAllMigrationTelemetry();
    } catch (err: any) {
      setError(err?.message || "Eroare atribuire manuală.");
    }
  };

  const handleToggleCutoverMode = async (mode: "tenant_scoped" | "legacy_rollback_standby") => {
    try {
      setError(null);
      const token = await user?.getIdToken();
      const res = await fetch("/api/platform/migration/cutover-mode", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ mode }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json?.error?.message || "Nu s-a putut schimba modul de cutover.");
        return;
      }
      setActionNotice(`Mod operațional actualizat: ${json.data.mode}.`);
      await fetchAllMigrationTelemetry();
    } catch (err: any) {
      setError(err?.message || "Eroare actualizare mod cutover.");
    }
  };

  return (
    <CmpPlatformLayout title="Centru Migrare Date CRM & Cutover Tenant">
      <div className="max-w-6xl mx-auto space-y-4 font-sans">
        {/* Safety Header Notice */}
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-indigo-200/80 rounded-xl p-5 shadow-2xs">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-11 h-11 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-700 flex items-center justify-center shrink-0">
                <Database size={22} />
              </div>
              <div className="space-y-1">
                <h2 className="font-title text-sm font-semibold text-gray-900 flex items-center gap-2">
                  <span>Migrare Date Interne & Cutover Multi-Tenant</span>
                  <span className="text-[10px] font-sans px-2 py-1 leading-none rounded bg-indigo-100 text-indigo-800 font-normal">
                    Faza 11 • Super Admin
                  </span>
                </h2>
                <p className="text-xs text-gray-600 leading-relaxed max-w-3xl">
                  Verifică infrastructura reală GCP/Firestore/GCS, impune existența unui backup recuperabil verificat înaintea oricărei migrări live și oferă control complet pentru rezolvarea manuală a înregistrărilor ambigue. Procesul este strict <strong className="text-gray-900 font-semibold">non-distructiv</strong>.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4 shrink-0">
              <button
                type="button"
                onClick={() => void fetchAllMigrationTelemetry(true)}
                className="px-3 py-2 bg-indigo-600 text-white rounded text-xs font-semibold hover:bg-indigo-700 flex items-center gap-2 cursor-pointer"
              >
                <ShieldCheck size={12} />
                <span>Test Izolat Scriere/Citire</span>
              </button>
              <button
                type="button"
                onClick={() => void fetchAllMigrationTelemetry(false)}
                className="px-3 py-2 bg-white border border-gray-200 rounded text-xs font-semibold text-gray-700 hover:bg-gray-50 flex items-center gap-2 cursor-pointer"
              >
                <RefreshCw size={12} />
                <span>Reîmprospătează</span>
              </button>
            </div>
          </div>
        </div>

        {/* Real Infrastructure & Backup Verification Status */}
        {infraStatus && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-2xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-gray-800 flex items-center gap-2">
                  <Server size={14} className="text-indigo-600" />
                  <span>Firestore Live</span>
                </span>
                <span
                  className={`px-2 py-1 leading-none rounded-full text-[10px] font-normal ${
                    infraStatus.firestore.status === "verified"
                      ? "bg-emerald-50 text-emerald-700"
                      : infraStatus.firestore.status === "permission_denied"
                      ? "bg-rose-50 text-rose-700"
                      : "bg-amber-50 text-amber-800"
                  }`}
                >
                  {infraStatus.firestore.status}
                </span>
              </div>
              <p className="text-[11px] font-normal text-gray-500">{infraStatus.firestore.details}</p>
              <div className="text-[10px] font-sans tabular-nums font-normal text-gray-400">
                {infraStatus.firebaseProjectId} / {infraStatus.firestoreDatabaseId} ({infraStatus.authMethod || "none"})
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-2xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-gray-800 flex items-center gap-2">
                  <HardDrive size={14} className="text-indigo-600" />
                  <span>Cloud Storage ({infraStatus.cloudStorage.activeBackend})</span>
                </span>
                <span
                  className={`px-2 py-1 leading-none rounded-full text-[10px] font-normal ${
                    infraStatus.cloudStorage.status === "verified"
                      ? "bg-emerald-50 text-emerald-700"
                      : infraStatus.cloudStorage.status === "permission_denied"
                      ? "bg-rose-50 text-rose-700"
                      : "bg-amber-50 text-amber-800"
                  }`}
                >
                  {infraStatus.cloudStorage.status}
                </span>
              </div>
              <p className="text-[11px] font-normal text-gray-500">{infraStatus.cloudStorage.details}</p>
              <div className="text-[10px] font-sans tabular-nums font-normal text-gray-400">
                Bucket: {infraStatus.storageBucket} • /uploads local: {infraStatus.localUploadsDirFileCount} fișiere
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-2xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-gray-800 flex items-center gap-2">
                  <Lock size={14} className="text-indigo-600" />
                  <span>Poartă Backup & Cutover</span>
                </span>
                <span
                  className={`px-2 py-1 leading-none rounded-full text-[10px] font-normal ${
                    cutoverReadiness?.liveGcpBackupVerified
                      ? "bg-emerald-50 text-emerald-700"
                      : cutoverReadiness?.backupVerified
                      ? "bg-amber-50 text-amber-800"
                      : "bg-rose-50 text-rose-700"
                  }`}
                >
                  {cutoverReadiness?.liveGcpBackupVerified
                    ? "LIVE GCP VERIFICAT"
                    : cutoverReadiness?.backupVerified
                    ? "DOAR ATESTAT LOCAL"
                    : "BACKUP NEVERIFICAT"}
                </span>
              </div>
              <p className="text-[11px] font-normal text-gray-500">
                Regulile legacy firestore.rules rămân {cutoverReadiness?.legacyRootRulesStillRequired ? "active (protejate)" : "dezactivate"}.
              </p>
              <div className="text-[10px] font-sans tabular-nums font-normal text-gray-400">
                Mod activ: {cutoverReadiness?.cutoverMode?.mode || "tenant_scoped"}
              </div>
            </div>
          </div>
        )}

        {/* Action Panel & Settings */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-2xs space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-gray-100">
            <div>
              <h3 className="font-title text-sm font-semibold text-gray-900">Configurare Operațiune Migrare</h3>
              <p className="text-xs text-gray-500 mt-1">
                Selectați tenantul destinație și rulați inspecția preliminară pentru confirmarea integrității relațiilor.
              </p>
            </div>

            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={handleRunDryRun}
                disabled={isRunningDryRun || isExecutingLive}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-semibold text-xs flex items-center gap-2 shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
              >
                {isRunningDryRun ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={14} />}
                <span>Rulează Verificare (Dry-Run)</span>
              </button>

              <button
                type="button"
                onClick={handleExecuteLive}
                disabled={
                  isExecutingLive ||
                  isRunningDryRun ||
                  !latestReport ||
                  latestReport.mode === "live" ||
                  !latestReport.summary.isSafeToMigrate
                }
                className="px-4 py-2 bg-[#051D35] hover:bg-[#051D35]/90 text-white rounded font-semibold text-xs flex items-center gap-2 shadow-2xs transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                title={
                  !latestReport
                    ? "Rulați mai întâi un Dry-Run!"
                    : !latestReport.summary.isSafeToMigrate
                    ? "Erori detectate la verificare"
                    : "Execută migrarea în baza de date a tenantului"
                }
              >
                {isExecutingLive ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Play size={13} className="text-[#BE9662]" />
                )}
                <span>Execută Migrarea în Tenant</span>
              </button>
            </div>
          </div>

          {isConfirmingExecute && (
            <div className="p-4 bg-amber-50 border border-amber-300 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs">
              <div className="text-amber-900">
                <strong className="font-semibold block">Confirmare migrare în tenantul inițial:</strong>
                <span>Datele originale din colecțiile root NU vor fi șterse sau modificate.</span>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsConfirmingExecute(false)}
                  className="px-3 py-2 border border-gray-300 bg-white text-gray-700 rounded font-semibold hover:bg-gray-50 cursor-pointer"
                >
                  Anulează
                </button>
                <button
                  type="button"
                  onClick={handleExecuteLive}
                  className="px-3 py-2 bg-[#051D35] text-white rounded font-semibold hover:bg-[#051D35]/90 cursor-pointer"
                >
                  Confirmă și Execută
                </button>
              </div>
            </div>
          )}

          {actionNotice && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-lg flex items-center gap-2">
              <CheckCircle2 size={15} className="shrink-0" />
              <span>{actionNotice}</span>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg flex items-center gap-2">
              <AlertCircle size={15} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Target Tenant Info + Cutover Rollback Controls */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
              <span className="text-gray-500 font-semibold block text-[11px]">Tenant Destinație Implicit</span>
              <input
                type="text"
                value={targetTenantId}
                onChange={(e) => setTargetTenantId(e.target.value)}
                className="font-sans font-normal text-gray-900 text-xs bg-white border border-gray-200 rounded px-2 py-1 mt-1 w-full"
              />
            </div>

            <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
              <span className="text-gray-500 font-semibold block text-[11px]">Garanție de Siguranță</span>
              <span className="font-normal text-emerald-700 text-sm flex items-center gap-2 mt-1">
                <CheckCircle2 size={15} />
                <span>Non-distructiv (Fără ștergeri)</span>
              </span>
              <span className="text-gray-500 text-[11px] block mt-1">Colecțiile root rămân 100% conservate</span>
            </div>

            <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-2">
              <span className="text-gray-500 font-semibold block text-[11px]">Comutator Cutover / Rollback</span>
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => void handleToggleCutoverMode("tenant_scoped")}
                  className={`px-3 py-1 rounded text-[11px] font-semibold cursor-pointer ${
                    cutoverReadiness?.cutoverMode?.mode !== "legacy_rollback_standby"
                      ? "bg-[#051D35] text-white"
                      : "bg-white border border-gray-200 text-gray-700"
                  }`}
                >
                  Tenant-Scoped
                </button>
                <button
                  type="button"
                  onClick={() => void handleToggleCutoverMode("legacy_rollback_standby")}
                  className={`px-3 py-1 rounded text-[11px] font-semibold cursor-pointer ${
                    cutoverReadiness?.cutoverMode?.mode === "legacy_rollback_standby"
                      ? "bg-amber-600 text-white"
                      : "bg-white border border-gray-200 text-gray-700"
                  }`}
                >
                  Rollback Standby
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Backup Verification Registration Card */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-2xs space-y-4 text-xs">
          <h3 className="font-title text-sm font-semibold text-gray-900">Înregistrare & Verificare Backup Recuperabil</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-[11px] font-semibold text-gray-600 mb-1">Tip Backup</label>
              <select
                value={backupType}
                onChange={(e) => setBackupType(e.target.value as any)}
                className="w-full border border-gray-200 rounded px-3 py-2 bg-white font-normal"
              >
                <option value="firestore_gcs_export">Export Firestore în Cloud Storage (gs://)</option>
                <option value="firestore_pitr">Point-In-Time Recovery (PITR Timestamp)</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-600 mb-1">
                {backupType === "firestore_gcs_export" ? "URI Export GCS" : "Timestamp PITR"}
              </label>
              {backupType === "firestore_gcs_export" ? (
                <input
                  type="text"
                  value={backupUri}
                  onChange={(e) => setBackupUri(e.target.value)}
                  className="w-full border border-gray-200 rounded px-3 py-2 font-sans font-normal"
                />
              ) : (
                <input
                  type="text"
                  placeholder="2026-11-13T12:00:00Z"
                  value={backupPitrTs}
                  onChange={(e) => setBackupPitrTs(e.target.value)}
                  className="w-full border border-gray-200 rounded px-3 py-2 font-sans font-normal"
                />
              )}
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-600 mb-1">Notițe verificare restaurare</label>
              <input
                type="text"
                value={backupNotes}
                onChange={(e) => setBackupNotes(e.target.value)}
                placeholder="ex: Export verificat înainte de migrarea live"
                className="w-full border border-gray-200 rounded px-3 py-2 font-sans font-normal"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
            <label className="flex items-center gap-2 font-semibold text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={backupConfirmed}
                onChange={(e) => setBackupConfirmed(e.target.checked)}
              />
              <span>Confirm existența backup-ului (pentru testare locală; migrarea live necesită verificare directă GCP)</span>
            </label>
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => void handleVerifyBackup()}
                className="px-3 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-800 rounded font-semibold cursor-pointer"
              >
                Înregistrează Atestare
              </button>
              <button
                type="button"
                onClick={() => void handleVerifyLiveBackup()}
                className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded font-semibold cursor-pointer"
              >
                Verifică Real în GCP (PITR / Export)
              </button>
            </div>
          </div>
        </div>

        {/* Manual Ownership Resolution Queue */}
        {pendingReviews.length > 0 && (
          <div className="bg-white border border-amber-300 rounded-xl p-6 shadow-2xs space-y-4 text-xs">
            <h3 className="font-title text-sm font-semibold text-amber-900 flex items-center gap-2">
              <UserCheck size={16} />
              <span>Coadă Revizie Manuală Proprietate ({pendingReviews.length} înregistrări)</span>
            </h3>
            <p className="text-gray-600 text-[11px]">
              Înregistrările fără apartenență sigură sunt excluse automat de la migrarea live până la atribuirea explicită de către Super Admin.
            </p>
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-[11px] font-semibold text-gray-500 uppercase">
                    <th className="py-2 px-3">Colecție / ID</th>
                    <th className="py-2 px-3">Motiv</th>
                    <th className="py-2 px-3">Tenant Țintă</th>
                    <th className="py-2 px-3">Confirmare</th>
                    <th className="py-2 px-3">Acțiune</th>
                  </tr>
                </thead>
                <VirtualizedTbody
                  items={pendingReviews}
                  colSpan={5}
                  estimateRowHeight={44}
                  getItemKey={(rec) => `${rec.collectionName}::${rec.recordId}`}
                  className="divide-y divide-gray-100"
                  renderRow={(rec, _idx, rowRef) => {
                    const key = `${rec.collectionName}::${rec.recordId}`;
                    return (
                      <tr ref={rowRef}>
                        <td className="py-2 px-3 font-sans font-normal">
                          {rec.collectionName}/{rec.recordId}
                        </td>
                        <td className="py-2 px-3 font-normal text-gray-600">{rec.reason}</td>
                        <td className="py-2 px-3">
                          <input
                            type="text"
                            value={reviewTenants[key] || rec.candidateTenantIds?.[0] || "ten_brokr_default"}
                            onChange={(e) =>
                              setReviewTenants((prev) => ({ ...prev, [key]: e.target.value }))
                            }
                            className="border border-gray-200 rounded px-2 py-1 font-sans font-normal text-[11px] w-40"
                          />
                        </td>
                        <td className="py-2 px-3">
                          <label className="flex items-center gap-2 font-semibold text-[11px] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={Boolean(reviewConfirmed[key])}
                              onChange={(e) =>
                                setReviewConfirmed((prev) => ({ ...prev, [key]: e.target.checked }))
                              }
                            />
                            <span>Confirm</span>
                          </label>
                        </td>
                        <td className="py-2 px-3">
                          <button
                            type="button"
                            onClick={() => void handleAssignManualReview(rec)}
                            className="px-3 py-1 bg-[#051D35] text-white rounded font-semibold text-[11px] cursor-pointer"
                          >
                            Atribuie
                          </button>
                        </td>
                      </tr>
                    );
                  }}
                />
              </table>
            </div>
          </div>
        )}

        {/* Latest Report Diagnostic Breakdown */}
        {latestReport && (
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-2xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div
                  className={`w-9 h-9 rounded-lg flex items-center justify-center font-normal text-xs ${
                    latestReport.mode === "live"
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : "bg-indigo-50 text-indigo-700 border border-indigo-200"
                  }`}
                >
                  {latestReport.mode === "live" ? "LIVE" : "TEST"}
                </div>
                <div>
                  <h3 className="font-title text-sm font-semibold text-gray-900 flex items-center gap-2">
                    <span>
                      Raport Migrare: {latestReport.mode === "live" ? "Executare Încheiată" : "Verificare Preliminară"}
                    </span>
                    <span className="text-[10px] font-sans tabular-nums text-gray-400 font-normal">({latestReport.id})</span>
                  </h3>
                  <div className="text-xs text-gray-500 mt-1">
                    Data: {new Date(latestReport.completedAt).toLocaleString("ro-RO")} · Operator:{" "}
                    {latestReport.executedBy}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span
                  className={`px-3 py-1 rounded-full text-xs font-normal ${
                    latestReport.summary.isSafeToMigrate
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : "bg-rose-50 text-rose-700 border border-rose-200"
                  }`}
                >
                  {latestReport.summary.isSafeToMigrate
                    ? "✓ Siguranță Validată"
                    : "⚠️ Erori Identificate"}
                </span>
              </div>
            </div>

            {/* Metric Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                <span className="text-gray-500 font-semibold block text-[11px]">Total Găsite</span>
                <span className="text-lg font-normal tabular-nums text-gray-900">{latestReport.summary.totalRecordsFound}</span>
              </div>
              <div className="p-3 bg-indigo-50/60 border border-indigo-200 rounded-lg">
                <span className="text-indigo-700 font-semibold block text-[11px]">Valide pentru Migrare</span>
                <span className="text-lg font-normal tabular-nums text-indigo-900">{latestReport.summary.totalValidRecords}</span>
              </div>
              <div className="p-3 bg-emerald-50/60 border border-emerald-200 rounded-lg">
                <span className="text-emerald-700 font-semibold block text-[11px]">Migrate în Subcolecții</span>
                <span className="text-lg font-normal tabular-nums text-emerald-900">{latestReport.summary.totalMigrated}</span>
              </div>
              <div className="p-3 bg-amber-50/60 border border-amber-200 rounded-lg">
                <span className="text-amber-700 font-semibold block text-[11px]">Duplicate Evitate</span>
                <span className="text-lg font-normal tabular-nums text-amber-900">
                  {latestReport.summary.totalSkippedDuplicates}
                </span>
              </div>
            </div>

            {/* Collection Detail Breakdown */}
            <div className="space-y-3">
              <h4 className="font-title text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Defalcare pe Colecții CRM
              </h4>

              <div className="border border-gray-200 rounded-lg overflow-hidden text-xs">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50/80 border-b border-gray-200 text-[11px] font-semibold text-gray-500 uppercase">
                      <th className="py-3 px-4">Colecție</th>
                      <th className="py-3 px-4">Găsite</th>
                      <th className="py-3 px-4">Valide</th>
                      <th className="py-3 px-4">Migrate</th>
                      <th className="py-3 px-4">Duplicate</th>
                      <th className="py-3 px-4">Erori</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {Object.values(latestReport.collections).map((col) => (
                      <tr key={col.collectionName} className="hover:bg-gray-50/50">
                        <td className="py-3 px-4 font-sans font-normal text-gray-900">{col.collectionName}</td>
                        <td className="py-3 px-4 font-normal tabular-nums text-gray-700">{col.totalFound}</td>
                        <td className="py-3 px-4 text-indigo-700 font-normal tabular-nums">{col.validRecords}</td>
                        <td className="py-3 px-4 text-emerald-700 font-normal tabular-nums">{col.migrated}</td>
                        <td className="py-3 px-4 text-amber-700 font-normal tabular-nums">{col.skippedDuplicates}</td>
                        <td className="py-3 px-4">
                          {col.failed > 0 ? (
                            <span className="text-rose-600 font-normal tabular-nums">{col.failed}</span>
                          ) : (
                            <span className="text-gray-400 font-normal tabular-nums">0</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {latestReport.warnings.length > 0 && (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg space-y-1 text-xs text-amber-800">
                <span className="font-semibold flex items-center gap-2">
                  <AlertTriangle size={14} />
                  <span>Avertizări Integritate Relațională ({latestReport.warnings.length}):</span>
                </span>
                <ul className="list-disc pl-5 space-y-1 text-[11px]">
                  {latestReport.warnings.map((w, idx) => (
                    <li key={`warn-${idx}`}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Inventory & Checkpoints Overview */}
        {inventory.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-2xs space-y-3 text-xs">
            <h3 className="font-title text-xs font-semibold text-gray-700 uppercase tracking-wider">
              Inventar Colecții Legacy & Status Refactorizare Servicii CRM
            </h3>
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-[11px] font-semibold text-gray-500 uppercase">
                    <th className="py-2 px-3">Colecție Sursă</th>
                    <th className="py-2 px-3">Destinație Tenant</th>
                    <th className="py-2 px-3">Documente Live</th>
                    <th className="py-2 px-3">Checkpoints</th>
                  </tr>
                </thead>
                <VirtualizedTbody
                  items={inventory}
                  colSpan={4}
                  estimateRowHeight={40}
                  getItemKey={(item) => item.collectionName}
                  className="divide-y divide-gray-100"
                  renderRow={(item, _idx, rowRef) => (
                    <tr ref={rowRef}>
                      <td className="py-2 px-3 font-sans font-normal text-gray-900">{item.currentLocation}</td>
                      <td className="py-2 px-3 font-sans font-normal text-gray-600">{item.expectedDestination}</td>
                      <td className="py-2 px-3">
                        {item.recordCount !== null ? (
                          <span className="font-normal tabular-nums text-gray-900">{item.recordCount}</span>
                        ) : (
                          <span className="font-normal text-amber-700">Necesită credențiale server GCP</span>
                        )}
                      </td>
                      <td className="py-2 px-3 font-normal tabular-nums text-gray-500">
                        {checkpoints.length > 0 ? `${checkpoints.length} salvate` : "0"}
                      </td>
                    </tr>
                  )}
                />
              </table>
            </div>
          </div>
        )}

        {/* Historical Runs */}
        {reports.length > 1 && (
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-2xs space-y-3">
            <h3 className="font-title text-xs font-semibold text-gray-700 uppercase tracking-wider">
              Istoric Rulări Migrare
            </h3>
            <VirtualizedStack
              items={reports}
              getItemKey={(rep) => rep.id}
              estimateItemHeight={44}
              overscanRatio={0.5}
              className="divide-y divide-gray-100 text-xs"
              renderItem={(rep, _idx, itemRef) => (
                <div
                  ref={itemRef}
                  onClick={() => setLatestReport(rep)}
                  className="py-3 flex items-center justify-between cursor-pointer hover:bg-gray-50/80 px-2 rounded transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`px-2 py-1 leading-none rounded text-[10px] font-normal ${
                        rep.mode === "live"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-indigo-100 text-indigo-800"
                      }`}
                    >
                      {rep.mode.toUpperCase()}
                    </span>
                    <span className="font-sans font-normal text-gray-900">{rep.id}</span>
                    <span className="text-gray-400 font-normal text-[11px]">
                      {new Date(rep.completedAt).toLocaleString("ro-RO")}
                    </span>
                  </div>

                  <div className="flex items-center gap-4 text-gray-500 font-normal text-[11px] tabular-nums">
                    <span>Total găsite: {rep.summary.totalRecordsFound}</span>
                    <span>Migrate: {rep.summary.totalMigrated}</span>
                    <ArrowRight size={13} className="text-gray-400" />
                  </div>
                </div>
              )}
            />
          </div>
        )}
      </div>
    </CmpPlatformLayout>
  );
};
