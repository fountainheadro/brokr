import React from "react";
import { RotateCcw, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

export interface DeadLetterEventRow {
  id: string;
  eventType: string;
  tenantId: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  lastErrorKind: string | null;
  replayCount: number;
  lastReplayedBy: string | null;
  lastReplayedAt: string | null;
  updatedAt: string;
}

export interface WorkerJobRunRow {
  id: string;
  jobName: string;
  tenantId?: string | null;
  triggeredBy: string;
  status: string;
  startedAt: string;
  completedAt?: string | null;
  durationMs?: number | null;
  processedCount?: number;
  errorCount?: number;
  errorMessage?: string | null;
}

export interface OrgWorkerHealthMatrixProps {
  outboxStats: Record<string, number>;
  activeLeasesCount: number;
  deadLetterEvents: DeadLetterEventRow[];
  recentRuns: WorkerJobRunRow[];
  provenanceLabel: string;
  replayingEventId: string | null;
  replayNotice: { type: "success" | "error"; message: string } | null;
  onReplayDeadLetter: (eventId: string) => void;
}

function formatShortTime(iso?: string | null): string {
  if (!iso) return "—";
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return iso;
  return new Date(ts).toLocaleString("ro-RO", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const OrgWorkerHealthMatrix: React.FC<OrgWorkerHealthMatrixProps> = ({
  outboxStats,
  activeLeasesCount,
  deadLetterEvents,
  recentRuns,
  provenanceLabel,
  replayingEventId,
  replayNotice,
  onReplayDeadLetter,
}) => {
  const pending = outboxStats.pending || 0;
  const retryable = outboxStats.retryable || 0;
  const processing = outboxStats.processing || 0;
  const completed = outboxStats.completed || 0;
  const deadLetter = outboxStats.dead_letter || 0;

  return (
    <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-title text-sm font-semibold text-[#051D35]">
            Sănătate Workeri & Coadă Outbox
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Execuții programate, lease-uri active și reluare auditată a job-urilor eșuate (Dead-Letter Queue).
          </p>
        </div>
        <span className="text-[11px] text-slate-400">{provenanceLabel}</span>
      </div>

      {/* Flat hairline summary strip (zero nested cards) */}
      <div className="grid grid-cols-2 sm:grid-cols-6 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 border-b border-slate-200 bg-slate-50/40">
        <div className="px-4 py-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Pending</div>
          <div className="text-base font-mono tabular-nums text-[#051D35] mt-0.5">{pending}</div>
        </div>
        <div className="px-4 py-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Retryable</div>
          <div className={`text-base font-mono tabular-nums mt-0.5 ${retryable > 0 ? "text-amber-700" : "text-[#051D35]"}`}>
            {retryable}
          </div>
        </div>
        <div className="px-4 py-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Processing</div>
          <div className="text-base font-mono tabular-nums text-[#051D35] mt-0.5">{processing}</div>
        </div>
        <div className="px-4 py-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Completed</div>
          <div className="text-base font-mono tabular-nums text-emerald-700 mt-0.5">{completed}</div>
        </div>
        <div className="px-4 py-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Dead-Letter</div>
          <div className={`text-base font-mono tabular-nums mt-0.5 ${deadLetter > 0 ? "text-rose-700 font-semibold" : "text-slate-700"}`}>
            {deadLetter}
          </div>
        </div>
        <div className="px-4 py-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">Lease-uri Active</div>
          <div className="text-base font-mono tabular-nums text-[#051D35] mt-0.5">{activeLeasesCount}</div>
        </div>
      </div>

      {replayNotice && (
        <div
          className={`px-5 py-2.5 border-b text-xs flex items-center gap-2 ${
            replayNotice.type === "success"
              ? "bg-emerald-50/70 border-emerald-200 text-emerald-900"
              : "bg-rose-50/70 border-rose-200 text-rose-900"
          }`}
        >
          {replayNotice.type === "success" ? (
            <CheckCircle2 size={14} className="shrink-0 text-emerald-700" />
          ) : (
            <AlertTriangle size={14} className="shrink-0 text-rose-700" />
          )}
          <span>{replayNotice.message}</span>
        </div>
      )}

      {/* Dead-Letter Queue Section */}
      <div className="border-b border-slate-200">
        <div className="px-5 py-2.5 bg-slate-50/60 border-b border-slate-100 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
            Dead-Letter Queue (Job-uri Eșuate)
          </span>
          <span className="text-[11px] font-mono tabular-nums text-slate-500">
            {deadLetterEvents.length} înregistrări
          </span>
        </div>

        {deadLetterEvents.length === 0 ? (
          <div className="px-5 py-6 text-xs text-slate-500">
            Nu există job-uri blocate în Dead-Letter Queue.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                  <th className="py-2.5 px-4">Eveniment / ID</th>
                  <th className="py-2.5 px-4">Agenție</th>
                  <th className="py-2.5 px-4 text-right">Încercări</th>
                  <th className="py-2.5 px-4">Ultima Eroare</th>
                  <th className="py-2.5 px-4">Actualizat</th>
                  <th className="py-2.5 px-4 text-right">Acțiune</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {deadLetterEvents.map((evt) => {
                  const isReplaying = replayingEventId === evt.id;
                  return (
                    <tr key={evt.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-4">
                        <div className="font-medium text-[#051D35]">{evt.eventType}</div>
                        <div className="text-[11px] font-mono text-slate-400">{evt.id}</div>
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-slate-700">{evt.tenantId}</td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700">
                        {evt.attempts}/{evt.maxAttempts}
                      </td>
                      <td className="py-2.5 px-4 max-w-xs">
                        <div className="text-rose-700 truncate" title={evt.lastError || ""}>
                          {evt.lastError || "Eroare necunoscută"}
                        </div>
                        {evt.lastErrorKind && (
                          <div className="text-[10px] font-mono text-slate-400">
                            {evt.lastErrorKind}
                            {evt.replayCount > 0 ? ` · reluat ${evt.replayCount}×` : ""}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-[11px] text-slate-500">
                        {formatShortTime(evt.updatedAt)}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <button
                          type="button"
                          disabled={isReplaying}
                          onClick={() => onReplayDeadLetter(evt.id)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-slate-300 bg-white text-[#051D35] hover:bg-slate-50 text-[11px] font-medium disabled:opacity-50 cursor-pointer"
                        >
                          {isReplaying ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <RotateCcw size={12} />
                          )}
                          <span>Reîncearcă</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent Worker Runs */}
      <div>
        <div className="px-5 py-2.5 bg-slate-50/60 border-b border-slate-100 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
            Ultimele Execuții Workeri
          </span>
          <span className="text-[11px] font-mono tabular-nums text-slate-500">
            {recentRuns.length} rulări recente
          </span>
        </div>

        {recentRuns.length === 0 ? (
          <div className="px-5 py-6 text-xs text-slate-500">
            Nu au fost înregistrate rulări de worker în această sesiune.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                  <th className="py-2.5 px-4">Job</th>
                  <th className="py-2.5 px-4">Trigger</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4 text-right">Procesate</th>
                  <th className="py-2.5 px-4 text-right">Durată</th>
                  <th className="py-2.5 px-4">Pornit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentRuns.slice(0, 12).map((run) => (
                  <tr key={run.id} className="hover:bg-slate-50/70">
                    <td className="py-2 px-4 font-mono text-[11px] text-[#051D35]">{run.jobName}</td>
                    <td className="py-2 px-4 text-[11px] text-slate-600">{run.triggeredBy}</td>
                    <td className="py-2 px-4 text-[11px]">
                      <span
                        className={
                          run.status === "completed"
                            ? "text-emerald-700 font-medium"
                            : run.status === "failed"
                              ? "text-rose-700 font-medium"
                              : "text-amber-700 font-medium"
                        }
                      >
                        {run.status}
                      </span>
                    </td>
                    <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-700">
                      {run.processedCount ?? 0}
                    </td>
                    <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-600">
                      {run.durationMs !== null && run.durationMs !== undefined ? `${run.durationMs} ms` : "—"}
                    </td>
                    <td className="py-2 px-4 font-mono tabular-nums text-[11px] text-slate-500">
                      {formatShortTime(run.startedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
};
