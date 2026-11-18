import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Building2,
  Users,
  Cpu,
  HardDrive,
  ShieldAlert,
  ArrowRight,
  TrendingUp,
  CheckCircle2,
  AlertTriangle,
  Clock,
} from "lucide-react";
import { CmpPlatformLayout } from "../../ui/platform/cmp_platform-layout";
import { OrgMetricCard } from "../../ui/organisms/common/org_metric-card";
import { OrgTenantStatusCard } from "../../ui/organisms/platform/org_tenant-status-card";
import { AtmPlatformBadge } from "../../ui/atoms/platform/atm_platform-badge";
import { PlatformGlobalStats, PlatformAuditLogEntry } from "../../core/platform/typ_platform-admin";
import { useAuth } from "../../core/auth/ctx_auth";

export const PgPlatformDashboard: React.FC = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState<PlatformGlobalStats | null>(null);
  const [agencies, setAgencies] = useState<any[]>([]);
  const [recentLogs, setRecentLogs] = useState<PlatformAuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    async function loadDashboardData() {
      if (!user) return;
      try {
        const token = await user.getIdToken();
        const headers = { Authorization: `Bearer ${token}` };

        const [statsRes, agenciesRes, logsRes] = await Promise.all([
          fetch("/api/platform/dashboard/stats", { headers }),
          fetch("/api/platform/agencies", { headers }),
          fetch("/api/platform/audit-logs?limit=5", { headers }),
        ]);

        if (statsRes.ok) {
          const s = await statsRes.json();
          if (s.success) setStats(s.data);
        }
        if (agenciesRes.ok) {
          const a = await agenciesRes.json();
          if (a.success) setAgencies(a.data);
        }
        if (logsRes.ok) {
          const l = await logsRes.json();
          if (l.success) setRecentLogs(l.data);
        }
      } catch (err) {
        console.error("Failed to load dashboard data:", err);
      } finally {
        setIsLoading(false);
      }
    }

    loadDashboardData();
  }, [user]);

  const metricsSlot = stats ? (
    <>
      <OrgMetricCard
        label="Total Agenții Înregistrate"
        value={stats.totalAgencies.toString()}
        icon={<Building2 size={18} />}
        trend={{ value: `${stats.activeAgencies} active`, isPositive: true }}
      />
      <OrgMetricCard
        label="Utilizatori & Agenți Activi"
        value={stats.activeUsers.toString()}
        icon={<Users size={18} />}
        trend={{ value: `${stats.totalUsers} total conturi`, isPositive: true }}
      />
      <OrgMetricCard
        label="Tokeni AI Utilizați (Lună)"
        value={`${(stats.totalAiTokensUsed / 1000000).toFixed(2)}M`}
        icon={<Cpu size={18} />}
        trend={{ value: `~${stats.estimatedAiCostEur} € cost est.`, isPositive: true }}
      />
      <OrgMetricCard
        label="Stocare Documente"
        value={`${(stats.totalStorageMb / 1024).toFixed(1)} GB`}
        icon={<HardDrive size={18} />}
        trend={{ value: "4.85 GB alocat", isPositive: true }}
      />
    </>
  ) : null;

  return (
    <CmpPlatformLayout title="Panou de Control Platformă" metricsSlot={metricsSlot}>
      <div className="space-y-4">
        {/* Status Lifecycle Overview Banner */}
        <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-2xs">
          <h3 className="font-title text-xs font-semibold text-gray-900 uppercase tracking-wider mb-3">
            Distribuție Status Agenții
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div className="p-3 bg-emerald-50/60 border border-emerald-200 rounded-md">
              <span className="text-[11px] text-emerald-800 font-semibold">Active (Abonate)</span>
              <p className="text-xl font-normal text-emerald-950 mt-1 font-sans tabular-nums">
                {stats?.activeAgencies ?? 0}
              </p>
            </div>
            <div className="p-3 bg-amber-50/60 border border-amber-200 rounded-md">
              <span className="text-[11px] text-amber-800 font-semibold">În Perioadă Trial</span>
              <p className="text-xl font-normal text-amber-950 mt-1 font-sans tabular-nums">
                {stats?.trialAgencies ?? 0}
              </p>
            </div>
            <div className="p-3 bg-red-50/60 border border-red-200 rounded-md">
              <span className="text-[11px] text-red-800 font-semibold">Suspendate</span>
              <p className="text-xl font-normal text-red-950 mt-1 font-sans tabular-nums">
                {stats?.suspendedAgencies ?? 0}
              </p>
            </div>
            <div className="p-3 bg-gray-50 border border-gray-200 rounded-md">
              <span className="text-[11px] text-gray-600 font-semibold">Anulate</span>
              <p className="text-xl font-normal text-gray-900 mt-1 font-sans tabular-nums">
                {stats?.cancelledAgencies ?? 0}
              </p>
            </div>
          </div>
        </div>

        {/* Agencies Grid Section */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-title text-sm font-semibold text-gray-900">Agenții Înregistrate Recent</h3>
              <p className="text-xs text-gray-500">Monitorizare cote și utilizare per agenție</p>
            </div>
            <Link
              to="/platform/agencies"
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 transition-colors"
            >
              <span>Vezi toate agențiile ({agencies.length})</span>
              <ArrowRight size={13} />
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {agencies.slice(0, 3).map((agency) => (
              <OrgTenantStatusCard
                key={agency.id}
                agencyName={agency.name}
                subdomain={agency.subdomain}
                status={agency.status}
                planName={agency.planId === "plan_enterprise" ? "Enterprise" : "Professional"}
                agentsCount={agency.activeMembersCount || 1}
                maxAgents={10}
                aiTokensUsed={agency.id === "ten_brokr_default" ? 820000 : 410000}
                aiTokensLimit={2500000}
                storageMbUsed={agency.id === "ten_brokr_default" ? 2400 : 950}
                storageMbLimit={10000}
                onManageClick={() => (window.location.href = `/platform/agencies/${agency.id}`)}
              />
            ))}
          </div>
        </div>

        {/* Recent Audit Activities */}
        <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-2xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-title text-xs font-semibold text-gray-900 uppercase tracking-wider">
                Jurnal de Audit Recent
              </h3>
              <p className="text-[11px] text-gray-500">Acțiuni administrative înregistrate pe platformă</p>
            </div>
            <Link
              to="/platform/audit-logs"
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 transition-colors"
            >
              <span>Jurnal complet</span>
              <ArrowRight size={13} />
            </Link>
          </div>

          <div className="divide-y divide-gray-100">
            {recentLogs.length === 0 ? (
              <div className="py-6 text-center text-xs text-gray-400">
                Nu există activități recente înregistrate.
              </div>
            ) : (
              recentLogs.map((log) => (
                <div key={log.id} className="py-3 flex items-start justify-between gap-4 text-xs">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="p-1 rounded bg-indigo-50 text-indigo-600 mt-1">
                      <Clock size={13} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 truncate">
                        {log.action.replace(/_/g, " ").toUpperCase()}
                      </p>
                      <p className="text-[11px] text-gray-500 truncate">
                        Țintă: <span className="font-normal text-gray-700">{log.targetName || log.targetId}</span> • Realizat de:{" "}
                        <span className="font-normal text-gray-700">{log.actorEmail}</span>
                      </p>
                    </div>
                  </div>
                  <span className="text-[10px] text-gray-400 whitespace-nowrap font-sans font-normal tabular-nums">
                    {new Date(log.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </CmpPlatformLayout>
  );
};
