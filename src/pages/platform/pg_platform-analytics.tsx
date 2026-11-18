import React, { useEffect, useState } from "react";
import { BarChart3, TrendingUp, Users, HardDrive, Cpu, Building2 } from "lucide-react";
import { CmpPlatformLayout } from "../../ui/platform/cmp_platform-layout";
import { AtmProgressBar } from "../../ui/atoms/common/atm_progress-bar";
import { useAuth } from "../../core/auth/ctx_auth";

export const PgPlatformAnalytics: React.FC = () => {
  const { user } = useAuth();
  const [metrics, setMetrics] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    async function loadAnalytics() {
      if (!user) return;
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/platform/analytics", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const json = await res.json();
          if (json.success) setMetrics(json.data);
        }
      } catch (err) {
        console.error("Failed to load platform analytics:", err);
      } finally {
        setIsLoading(false);
      }
    }

    loadAnalytics();
  }, [user]);

  return (
    <CmpPlatformLayout title="Analitice Globale Platformă">
      <div className="space-y-4">
        {/* Top Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-2xs">
            <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Creștere Agenții</span>
            <p className="text-2xl font-normal text-gray-900 mt-1 font-sans tabular-nums">{metrics?.agenciesGrowthRate || "+18%"}</p>
            <span className="text-xs text-emerald-600 font-normal flex items-center gap-1 mt-1">
              <TrendingUp size={13} />
              <span>Tendință pozitivă lună-la-lună</span>
            </span>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-2xs">
            <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Utilizatori Activi Lunari</span>
            <p className="text-2xl font-normal text-gray-900 mt-1 font-sans tabular-nums">{metrics?.monthlyActiveAgents || 42}</p>
            <span className="text-xs text-gray-500 mt-1 block">Brokeri și asistenți activi în CRM</span>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-2xs">
            <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Total Agenții Înregistrate</span>
            <p className="text-2xl font-normal text-gray-900 mt-1 font-sans tabular-nums">{metrics?.totalAgencies || 4}</p>
            <span className="text-xs text-gray-500 font-normal tabular-nums mt-1 block">
              {metrics?.activeAgencies || 0} active • {metrics?.trialAgencies || 0} în trial
            </span>
          </div>
        </div>

        {/* Utilization Gauges */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-title text-xs font-semibold text-gray-900 flex items-center gap-2">
                <HardDrive size={15} className="text-gray-500" />
                <span>Utilizare Capacitate Stocare Platformă</span>
              </h3>
              <span className="text-xs font-sans font-normal tabular-nums text-indigo-700">
                {metrics?.storageUtilizationPercent || 48}%
              </span>
            </div>
            <AtmProgressBar value={metrics?.storageUtilizationPercent || 48} max={100} size="md" variant="brand" />
            <p className="text-[11px] text-gray-500 leading-relaxed">
              Consum stocare documente și imagini optimizate pe întreg clusterul de agenții.
            </p>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-title text-xs font-semibold text-gray-900 flex items-center gap-2">
                <Cpu size={15} className="text-gray-500" />
                <span>Utilizare Cotă Tokeni AI Platformă</span>
              </h3>
              <span className="text-xs font-sans font-normal tabular-nums text-amber-700">
                {metrics?.aiTokensMonthlyUtilizationPercent || 62}%
              </span>
            </div>
            <AtmProgressBar
              value={metrics?.aiTokensMonthlyUtilizationPercent || 62}
              max={100}
              size="md"
              variant="accent"
            />
            <p className="text-[11px] text-gray-500 leading-relaxed">
              Consum global generare descrieri imobiliare și extragere date Gemini.
            </p>
          </div>
        </div>
      </div>
    </CmpPlatformLayout>
  );
};
