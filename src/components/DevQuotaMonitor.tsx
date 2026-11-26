import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../lib/firebase";
import {
  drainClientFirestoreDeltas,
  restoreClientFirestoreDeltas,
} from "../utils/clientQuotaTelemetry";

export interface DailyQuotaResourceItem {
  id: string;
  label: string;
  shortLabel: string;
  category: "ai" | "firestore" | "storage" | "network" | "runtime";
  used: number;
  limit: number;
  remaining: number;
  percent: number;
  unit: string;
  exact: boolean;
  detail?: string;
}

export interface DailyQuotaSnapshotResponse {
  dateKeyPt: string;
  timezone: string;
  resetAtIso: string;
  updatedAtIso: string;
  pollIntervalSec: number;
  resources: DailyQuotaResourceItem[];
}

interface DevQuotaMonitorProps {
  isCollapsed: boolean;
  onExpandSidebar?: () => void;
}

const POLL_INTERVAL_MS = 60_000; // 1 minute

function formatQuotaValue(value: number, unit: string): string {
  if (!Number.isFinite(value)) return "0";
  if (unit === "MB") {
    if (value >= 1024) return `${(value / 1024).toFixed(1)} GB`;
    if (value >= 100) return `${Math.round(value)} MB`;
    return `${value.toFixed(value % 1 === 0 ? 0 : 1)} MB`;
  }
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2).replace(/\.00$/, "")}M`;
  if (value >= 10_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2).replace(/\.00$/, "")}k`;
  return String(Math.round(value));
}

function getBarColorClass(percent: number): string {
  if (percent >= 90) return "bg-rose-500";
  if (percent >= 70) return "bg-amber-500";
  return "bg-emerald-500";
}

function getPercentTextClass(percent: number): string {
  if (percent >= 90) return "text-rose-600";
  if (percent >= 70) return "text-amber-600";
  return "text-[#051D35]";
}

function formatTimeHHMM(iso?: string): string {
  if (!iso) return "--:--";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

export const DevQuotaMonitor: React.FC<DevQuotaMonitorProps> = ({
  isCollapsed,
  onExpandSidebar,
}) => {
  const [snapshot, setSnapshot] = useState<DailyQuotaSnapshotResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [panelOpen, setPanelOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem("brokr_dev_quota_open") !== "false";
    } catch {
      return true;
    }
  });
  const lastFetchedAtRef = useRef<number>(0);
  const inFlightRef = useRef<boolean>(false);

  const togglePanel = () => {
    setPanelOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("brokr_dev_quota_open", String(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  const fetchQuota = useCallback(async (force = false) => {
    if (inFlightRef.current) return;
    if (!force && typeof document !== "undefined" && document.hidden) return;
    const user = auth.currentUser;
    if (!user) return;

    inFlightRef.current = true;
    setLoading(true);
    const deltas = drainClientFirestoreDeltas();

    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/dev/quota-usage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ clientDeltas: deltas }),
      });

      if (!res.ok) {
        restoreClientFirestoreDeltas(deltas);
        return;
      }

      const json = await res.json();
      if (json?.success && json?.data && Array.isArray(json.data.resources)) {
        setSnapshot(json.data as DailyQuotaSnapshotResponse);
        lastFetchedAtRef.current = Date.now();
      } else {
        restoreClientFirestoreDeltas(deltas);
      }
    } catch {
      restoreClientFirestoreDeltas(deltas);
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  // Fetch on auth availability + refresh every 1 minute (60,000 ms)
  useEffect(() => {
    let mounted = true;
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (mounted && user) {
        void fetchQuota(true);
      }
    });

    if (auth.currentUser) {
      void fetchQuota(true);
    }

    const timer = window.setInterval(() => {
      void fetchQuota(false);
    }, POLL_INTERVAL_MS);

    const handleVisibility = () => {
      if (!document.hidden && Date.now() - lastFetchedAtRef.current >= POLL_INTERVAL_MS - 5_000) {
        void fetchQuota(false);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      mounted = false;
      unsubAuth();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchQuota]);


  const peakResource = useMemo(() => {
    if (!snapshot || snapshot.resources.length === 0) return null;
    return snapshot.resources.reduce((max, cur) => (cur.percent > max.percent ? cur : max));
  }, [snapshot]);

  const summaryTooltip = useMemo(() => {
    if (!snapshot) return "Dev Daily Quota (se încarcă...)";
    const ai = snapshot.resources.find((r) => r.id === "ai_studio_tokens");
    const reads = snapshot.resources.find((r) => r.id === "firestore_reads");
    const lines = [
      `Dev Daily Quota (${snapshot.dateKeyPt} PT · 1m refresh)`,
      ai
        ? `AI Tokens: ${formatQuotaValue(ai.used, ai.unit)} / ${formatQuotaValue(ai.limit, ai.unit)} (${formatQuotaValue(ai.remaining, ai.unit)} left)`
        : null,
      reads
        ? `Firestore Reads: ${formatQuotaValue(reads.used, reads.unit)} / ${formatQuotaValue(reads.limit, reads.unit)} (${formatQuotaValue(reads.remaining, reads.unit)} left)`
        : null,
      peakResource ? `Peak: ${peakResource.label} (${peakResource.percent.toFixed(1)}%)` : null,
    ].filter(Boolean);
    return lines.join("\n");
  }, [snapshot, peakResource]);

  if (isCollapsed) {
    const peakPct = peakResource ? peakResource.percent : 0;
    return (
      <div className="shrink-0 border-t border-gray-200 bg-gray-50/70 select-none">
        <button
          type="button"
          onClick={() => onExpandSidebar?.()}
          title={summaryTooltip}
          className="w-full h-[46px] px-1 flex flex-col items-center justify-center gap-1 hover:bg-gray-100 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-1 text-[#051D35]">
            <Activity size={13} className={peakPct >= 90 ? "text-rose-600" : peakPct >= 70 ? "text-amber-600" : "text-[#BE9662]"} />
            <span className={`text-[10px] font-semibold tabular-nums ${getPercentTextClass(peakPct)}`}>
              {Math.round(peakPct)}%
            </span>
          </div>
          <div className="w-8 h-1 rounded-full bg-gray-200 overflow-hidden">
            <div
              className={`h-full rounded-full ${getBarColorClass(peakPct)}`}
              style={{ width: `${Math.max(peakPct > 0 ? 8 : 0, Math.min(100, peakPct))}%` }}
            />
          </div>
        </button>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t border-gray-200 bg-[#F9FAFB] select-none font-sans">
      {/* Compact Header */}
      <div className="px-3 py-2 flex items-center justify-between gap-1 border-b border-gray-200/80 bg-white/80">
        <button
          type="button"
          onClick={togglePanel}
          className="flex items-center gap-1.5 min-w-0 text-left cursor-pointer group"
          title="Dev Daily Quota Monitor (actualizare automată la 1 min · 0 Firestore reads)"
        >
          <Activity size={12} className="text-[#BE9662] shrink-0" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#051D35] truncate">
            Dev Quota
          </span>
          <span className="text-[9px] font-medium text-gray-400 tabular-nums shrink-0">
            {snapshot ? formatTimeHHMM(snapshot.updatedAtIso) : "1m"}
          </span>
        </button>

        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={() => void fetchQuota(true)}
            className="p-1 rounded text-gray-400 hover:text-[#051D35] hover:bg-gray-100 cursor-pointer"
            title="Reîmprospătează acum (actualizare automată la 60s)"
            aria-label="Reîmprospătează consumul zilnic"
          >
            <RefreshCw size={10} className={loading ? "text-[#BE9662]" : ""} />
          </button>
          <button
            type="button"
            onClick={togglePanel}
            className="p-1 rounded text-gray-400 hover:text-[#051D35] hover:bg-gray-100 cursor-pointer"
            title={panelOpen ? "Restrânge lista" : "Extinde lista"}
            aria-label={panelOpen ? "Restrânge lista" : "Extinde lista"}
          >
            {panelOpen ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          </button>
        </div>
      </div>

      {/* Scrollable Resource Quota List */}
      {panelOpen && (
        <div className="max-h-[172px] overflow-y-auto px-3 py-2 space-y-2.5 [scrollbar-width:thin]">
          {!snapshot ? (
            <div className="py-3 text-center text-[10px] text-gray-400">
              Se încarcă cotele zilnice...
            </div>
          ) : (
            snapshot.resources.map((res) => {
              const barWidth = res.used > 0 ? Math.max(2, Math.min(100, res.percent)) : 0;
              const usedStr = formatQuotaValue(res.used, res.unit);
              const limitStr = formatQuotaValue(res.limit, res.unit);
              const leftStr = formatQuotaValue(res.remaining, res.unit);
              const unitSuffix = res.unit === "MB" ? "" : ` ${res.unit}`;
              const tooltipLines = [
                `${res.label} (${res.percent.toFixed(1)}%)`,
                `Used: ${res.used.toLocaleString()} / ${res.limit.toLocaleString()} ${res.unit}`,
                `Left: ${res.remaining.toLocaleString()} ${res.unit}`,
                res.detail ? res.detail : null,
                `Reset: 00:00 PT (${snapshot.dateKeyPt})`,
              ]
                .filter(Boolean)
                .join("\n");

              return (
                <div key={res.id} title={tooltipLines} className="group">
                  <div className="flex items-center justify-between gap-1.5 mb-0.5">
                    <span className="text-[10.5px] font-medium text-gray-700 truncate">
                      {res.label}
                    </span>
                    <span
                      className={`text-[10px] font-semibold tabular-nums shrink-0 ${getPercentTextClass(
                        res.percent
                      )}`}
                    >
                      {res.percent < 1 && res.used > 0
                        ? "<1%"
                        : `${Math.round(res.percent)}%`}
                    </span>
                  </div>

                  {/* Bar from 0 to limit */}
                  <div className="h-1.5 w-full rounded-full bg-gray-200 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${getBarColorClass(
                        res.percent
                      )}`}
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>

                  {/* Used / Limit + Left */}
                  <div className="mt-0.5 flex items-center justify-between gap-1 text-[9.5px] text-gray-500 tabular-nums leading-tight">
                    <span className="truncate">
                      {usedStr} / {limitStr}
                      {unitSuffix}
                    </span>
                    <span className="text-gray-400 shrink-0">
                      {leftStr} left
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
