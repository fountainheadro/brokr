import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw, DatabaseZap, AlertCircle, ShieldCheck } from "lucide-react";
import { CmpPlatformLayout } from "../../ui/platform/cmp_platform-layout";
import { useAuth } from "../../core/auth/ctx_auth";
import { TplPlatformTelemetryDashboard } from "../../ui/templates/platform/tpl_platform-telemetry-dashboard";
import { MolTelemetryKpiCard } from "../../ui/molecules/platform/mol_telemetry-kpi-card";
import {
  OrgWorkerHealthMatrix,
  type DeadLetterEventRow,
  type WorkerJobRunRow,
} from "../../ui/organisms/platform/org_worker-health-matrix";
import {
  OrgAgencyConsumptionTable,
  type AgencyConsumptionRow,
} from "../../ui/organisms/platform/org_agency-consumption-table";

interface TelemetryRollupBucket {
  id: string;
  bucketStartIso: string;
  apiRequests: number;
  api4xx: number;
  api5xx: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  aiRequests: number;
  aiTotalTokens: number;
  estimatedAiCostEur: number;
  outboxDeadLetter: number;
  expiresAt: string;
}

interface PerformanceApiPayload {
  dashboardEnabled: boolean;
  collectedAt: string;
  message?: string;
  summary?: {
    totalAgencies: number;
    activeAgencies: number;
    trialAgencies: number;
    suspendedAgencies: number;
    activeUsers24h: number;
    activeUsers7d: number;
    apiRequests: number;
    api4xx: number;
    api5xx: number;
    error4xxRatePct: number;
    error5xxRatePct: number;
    latencyP50Ms: number;
    latencyP95Ms: number;
    latencyAvgMs: number;
    aiRequests: number;
    aiPromptTokens: number;
    aiOutputTokens: number;
    aiTotalTokens: number;
    estimatedAiCostEur: number;
    totalStorageMb: number;
    totalStorageFiles: number;
    outboxDeadLetter: number;
    portalPublishedTotal: number;
    portalSyncErrorsTotal: number;
    provenance: string;
    provenanceLabel: string;
  };
  cloudMonitoring?: {
    configured: boolean;
    provenance: string;
    provenanceLabel: string;
    lastSyncedAt: string | null;
    note: string;
  };
  clientHeartbeat?: {
    provenance: string;
    provenanceLabel: string;
    activeListenersEstimated: number;
    clientReadsEstimated: number;
    activeTabsEstimated: number;
    reportedAgenciesCount: number;
    lastHeartbeatAt: string | null;
    note: string;
  };
  workers?: {
    provenance: string;
    provenanceLabel: string;
    outboxStats: Record<string, number>;
    deadLetterEvents: DeadLetterEventRow[];
    recentRuns: WorkerJobRunRow[];
    activeLeasesCount: number;
  };
  agencies?: AgencyConsumptionRow[];
  rollups?: {
    provenance: string;
    provenanceLabel: string;
    flushIntervalMs: number;
    retentionDays: number;
    writesToday: number;
    maxDailyWriteBudget: number;
    lastFlushedAt: string | null;
    recentBuckets: TelemetryRollupBucket[];
  };
}

function formatCompactTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

function formatTimestamp(iso?: string | null): string {
  if (!iso) return "—";
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return iso;
  return new Date(ts).toLocaleString("ro-RO", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export const PgPlatformPerformance: React.FC = () => {
  const { user } = useAuth();
  const [data, setData] = useState<PerformanceApiPayload | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isFlushing, setIsFlushing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [flushNotice, setFlushNotice] = useState<string | null>(null);
  const [replayingEventId, setReplayingEventId] = useState<string | null>(null);
  const [replayNotice, setReplayNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const loadSnapshot = useCallback(
    async (silent = false) => {
      if (!user) return;
      if (silent) setIsRefreshing(true);
      else setIsLoading(true);
      setError(null);
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/platform/performance", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json?.error?.message || `Eroare HTTP ${res.status}`);
        }
        setData(json.data);
      } catch (err: any) {
        setError(err?.message || "Nu s-au putut încărca datele de performanță.");
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [user]
  );

  useEffect(() => {
    loadSnapshot(false);
  }, [loadSnapshot]);

  const handleManualFlush = async () => {
    if (!user || isFlushing) return;
    setIsFlushing(true);
    setFlushNotice(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/platform/performance/flush", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json?.error?.message || "Eroare la salvarea rollup-ului.");
      }
      const result = json.data;
      if (result.flushed) {
        setFlushNotice(`Rollup salvat (${result.bucketId}, ${result.writtenDocs} doc. scrise).`);
      } else {
        setFlushNotice(
          result.skippedReason === "zero_delta"
            ? "Nicio activitate nouă de salvat (0 scrieri Firestore)."
            : `Rollup amânat: ${result.skippedReason || "limită buget"}.`
        );
      }
      await loadSnapshot(true);
    } catch (err: any) {
      setFlushNotice(err?.message || "Salvarea rollup-ului a eșuat.");
    } finally {
      setIsFlushing(false);
    }
  };

  const handleReplayDeadLetter = async (eventId: string) => {
    if (!user || replayingEventId) return;
    setReplayingEventId(eventId);
    setReplayNotice(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/platform/performance/outbox/${encodeURIComponent(eventId)}/replay`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json?.error?.message || "Reluarea job-ului a eșuat.");
      }
      setReplayNotice({
        type: "success",
        message: `Job-ul ${eventId} a fost repus în coadă (pending) și înregistrat în Jurnalul de Audit.`,
      });
      await loadSnapshot(true);
    } catch (err: any) {
      setReplayNotice({
        type: "error",
        message: err?.message || "Eroare la reluarea job-ului dead-letter.",
      });
    } finally {
      setReplayingEventId(null);
    }
  };

  if (isLoading) {
    return (
      <CmpPlatformLayout title="Performanță & Trafic">
        <div className="space-y-4">
          <div className="h-16 bg-white border border-slate-200 rounded-lg animate-pulse" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-28 bg-white border border-slate-200 rounded-lg animate-pulse" />
            ))}
          </div>
          <div className="h-64 bg-white border border-slate-200 rounded-lg animate-pulse" />
        </div>
      </CmpPlatformLayout>
    );
  }

  if (error) {
    return (
      <CmpPlatformLayout title="Performanță & Trafic">
        <div className="bg-white border border-rose-200 rounded-lg p-5 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertCircle size={18} className="text-rose-700 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-semibold text-rose-900">Eroare la încărcarea telemetriei</h3>
              <p className="text-xs text-rose-700 mt-1">{error}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => loadSnapshot(false)}
            className="px-3 py-1.5 rounded border border-slate-300 bg-white text-xs font-medium text-[#051D35] hover:bg-slate-50 cursor-pointer"
          >
            Reîncearcă
          </button>
        </div>
      </CmpPlatformLayout>
    );
  }

  if (!data || !data.dashboardEnabled || !data.summary || !data.workers || !data.rollups) {
    return (
      <CmpPlatformLayout title="Performanță & Trafic">
        <div className="bg-white border border-slate-200 rounded-lg p-6">
          <h2 className="font-title text-sm font-semibold text-[#051D35]">
            Tablou de Bord Dezactivat
          </h2>
          <p className="text-xs text-slate-600 mt-1.5">
            {data?.message ||
              "Setați ENABLE_PLATFORM_PERFORMANCE_DASHBOARD=true pe server pentru a activa monitorizarea pilot."}
          </p>
        </div>
      </CmpPlatformLayout>
    );
  }

  const { summary, cloudMonitoring, clientHeartbeat, workers, agencies = [], rollups } = data;
  const pendingOutbox =
    (workers.outboxStats.pending || 0) +
    (workers.outboxStats.retryable || 0) +
    (workers.outboxStats.processing || 0);

  return (
    <CmpPlatformLayout title="Performanță & Trafic">
      <TplPlatformTelemetryDashboard
        headerSlot={
          <div className="bg-white border border-slate-200 rounded-lg px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-title text-base font-semibold text-[#051D35]">
                  Monitorizare Pilot & Atribuire Consum
                </h2>
                <span className="text-xs text-slate-400">· {summary.provenanceLabel}</span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Telemetrie fără PII, agregată la 5 minute (0 scrieri Firestore în repaus) · Actualizat:{" "}
                <span className="font-mono tabular-nums text-slate-700">{formatTimestamp(data.collectedAt)}</span>
              </p>
              {flushNotice && (
                <p className="text-xs text-emerald-800 mt-1.5 font-mono">{flushNotice}</p>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={isFlushing}
                onClick={handleManualFlush}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-300 bg-white text-xs font-medium text-[#051D35] hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
              >
                <DatabaseZap size={13} />
                <span>{isFlushing ? "Se salvează..." : "Salvează Rollup"}</span>
              </button>
              <button
                type="button"
                disabled={isRefreshing}
                onClick={() => loadSnapshot(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#051D35] text-white text-xs font-medium hover:bg-[#0a2b4a] disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw size={13} className={isRefreshing ? "animate-spin" : ""} />
                <span>Reîncarcă</span>
              </button>
            </div>
          </div>
        }
        kpiStripSlot={
          <>
            <MolTelemetryKpiCard
              label="Agenții Active / Total"
              value={`${summary.activeAgencies} / ${summary.totalAgencies}`}
              subtext={`Utilizatori 24h: ${summary.activeUsers24h} · 7z: ${summary.activeUsers7d}`}
              provenanceLabel={summary.provenanceLabel}
            />
            <MolTelemetryKpiCard
              label="Cereri Core API"
              value={summary.apiRequests.toLocaleString("ro-RO")}
              subtext={`4xx: ${summary.error4xxRatePct}% · 5xx: ${summary.error5xxRatePct}%`}
              provenanceLabel={summary.provenanceLabel}
              tone={summary.api5xx > 0 ? "danger" : "default"}
            />
            <MolTelemetryKpiCard
              label="Latență API (p95)"
              value={`${summary.latencyP95Ms} ms`}
              subtext={`p50: ${summary.latencyP50Ms} ms · medie: ${summary.latencyAvgMs} ms`}
              provenanceLabel={summary.provenanceLabel}
              tone={summary.latencyP95Ms > 1000 ? "warning" : "default"}
            />
            <MolTelemetryKpiCard
              label="Consum Gemini AI"
              value={formatCompactTokens(summary.aiTotalTokens)}
              subtext={`${summary.aiRequests} cereri · ${summary.estimatedAiCostEur.toFixed(2)} €`}
              provenanceLabel={summary.provenanceLabel}
              tone="success"
            />
            <MolTelemetryKpiCard
              label="Stocare Indexată"
              value={`${summary.totalStorageMb.toFixed(2)} MB`}
              subtext={`${summary.totalStorageFiles} fișiere în storage_objects`}
              provenanceLabel={summary.provenanceLabel}
            />
            <MolTelemetryKpiCard
              label="Outbox Dead-Letter"
              value={String(summary.outboxDeadLetter)}
              subtext={`În așteptare: ${pendingOutbox} · Lease-uri: ${workers.activeLeasesCount}`}
              provenanceLabel={workers.provenanceLabel}
              tone={summary.outboxDeadLetter > 0 ? "danger" : "default"}
            />
            <MolTelemetryKpiCard
              label="Publicări Portaluri"
              value={String(summary.portalPublishedTotal)}
              subtext={`Erori sincronizare: ${summary.portalSyncErrorsTotal}`}
              provenanceLabel={summary.provenanceLabel}
              tone={summary.portalSyncErrorsTotal > 0 ? "warning" : "default"}
            />
            <MolTelemetryKpiCard
              label="Scrieri Rollup Azi"
              value={`${rollups.writesToday} / ${rollups.maxDailyWriteBudget}`}
              subtext={`Interval ${Math.round(rollups.flushIntervalMs / 60000)}m · TTL ${rollups.retentionDays}z`}
              provenanceLabel={rollups.provenanceLabel}
              tone={rollups.writesToday >= rollups.maxDailyWriteBudget ? "warning" : "default"}
            />
          </>
        }
        provenanceStripSlot={
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Client Heartbeat Estimated — strictly separated from measured server metrics */}
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-title text-xs font-semibold uppercase tracking-wider text-[#051D35]">
                  Activitate Client Browser (Eșantionat)
                </h3>
                <span className="text-[11px] font-medium text-amber-700">
                  {clientHeartbeat?.provenanceLabel || "Client Heartbeat · Estimated"}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-4 mt-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">Listeneri Est.</div>
                  <div className="text-lg font-mono tabular-nums text-[#051D35] mt-0.5">
                    {clientHeartbeat?.activeListenersEstimated ?? 0}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">Citiri Client Est.</div>
                  <div className="text-lg font-mono tabular-nums text-[#051D35] mt-0.5">
                    {(clientHeartbeat?.clientReadsEstimated ?? 0).toLocaleString("ro-RO")}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">Tab-uri Active</div>
                  <div className="text-lg font-mono tabular-nums text-[#051D35] mt-0.5">
                    {clientHeartbeat?.activeTabsEstimated ?? 0}
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-slate-500 mt-3 pt-2 border-t border-slate-100">
                {clientHeartbeat?.note}
              </p>
            </div>

            {/* Cloud Monitoring Exact + Privacy Guard */}
            <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-title text-xs font-semibold uppercase tracking-wider text-[#051D35]">
                    Cloud Monitoring & Confidențialitate
                  </h3>
                  <span className="text-[11px] font-medium text-slate-500">
                    {cloudMonitoring?.provenanceLabel || "Cloud Monitoring · Exact"}
                  </span>
                </div>
                <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                  {cloudMonitoring?.note}
                </p>
              </div>
              <div className="mt-3 pt-2 border-t border-slate-100 flex items-center gap-2 text-[11px] text-emerald-800">
                <ShieldCheck size={14} className="shrink-0 text-emerald-700" />
                <span>
                  Zero PII în rollup-uri (`/platform_telemetry_rollups` & `/platform_agency_usage_rollups` blocate strict Super Admin).
                </span>
              </div>
            </div>
          </div>
        }
        agencyTableSlot={
          <OrgAgencyConsumptionTable
            agencies={agencies}
            provenanceLabel={summary.provenanceLabel}
          />
        }
        workerHealthSlot={
          <OrgWorkerHealthMatrix
            outboxStats={workers.outboxStats}
            activeLeasesCount={workers.activeLeasesCount}
            deadLetterEvents={workers.deadLetterEvents}
            recentRuns={workers.recentRuns}
            provenanceLabel={workers.provenanceLabel}
            replayingEventId={replayingEventId}
            replayNotice={replayNotice}
            onReplayDeadLetter={handleReplayDeadLetter}
          />
        }
        rollupFooterSlot={
          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-title text-xs font-semibold uppercase tracking-wider text-[#051D35]">
                  Istoric Rollup-uri 5 Minute (Firestore TTL {rollups.retentionDays} zile)
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Ultima salvare: <span className="font-mono tabular-nums">{formatTimestamp(rollups.lastFlushedAt)}</span>
                </p>
              </div>
              <span className="text-[11px] text-slate-400">{rollups.provenanceLabel}</span>
            </div>

            {rollups.recentBuckets.length === 0 ? (
              <div className="px-5 py-6 text-xs text-slate-500">
                Nu există încă bucket-uri salvate în această sesiune. Folosiți „Salvează Rollup” sau așteptați următorul ciclu de 5 minute.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50/70 border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                      <th className="py-2 px-4">Bucket UTC</th>
                      <th className="py-2 px-3 text-right">Cereri API</th>
                      <th className="py-2 px-3 text-right">4xx / 5xx</th>
                      <th className="py-2 px-3 text-right">p50 / p95 ms</th>
                      <th className="py-2 px-3 text-right">Tokeni AI</th>
                      <th className="py-2 px-3 text-right">Cost AI</th>
                      <th className="py-2 px-4 text-right">Expiră (TTL)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rollups.recentBuckets.slice(0, 12).map((b) => (
                      <tr key={b.id} className="hover:bg-slate-50/60">
                        <td className="py-2 px-4 font-mono text-[11px] text-[#051D35]">{b.id}</td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700">{b.apiRequests}</td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-600">
                          {b.api4xx} / <span className={b.api5xx > 0 ? "text-rose-700" : ""}>{b.api5xx}</span>
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700">
                          {b.latencyP50Ms} / {b.latencyP95Ms} ms
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700">
                          {formatCompactTokens(b.aiTotalTokens)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums text-emerald-700">
                          {b.estimatedAiCostEur.toFixed(4)} €
                        </td>
                        <td className="py-2 px-4 text-right font-mono tabular-nums text-[11px] text-slate-400">
                          {b.expiresAt.slice(0, 10)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        }
      />
    </CmpPlatformLayout>
  );
};
