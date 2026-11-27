import React, { useEffect, useState } from "react";
import { Cpu, DollarSign, Activity, ShieldCheck, Info } from "lucide-react";
import { CmpPlatformLayout } from "../../ui/platform/cmp_platform-layout";
import { AtmProgressBar } from "../../ui/atoms/common/atm_progress-bar";
import { useAuth } from "../../core/auth/ctx_auth";
import { VirtualizedTbody } from "../../components/VirtualizedList";

export const PgPlatformAiUsage: React.FC = () => {
  const { user } = useAuth();
  const [usageList, setUsageList] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    async function loadAiUsage() {
      if (!user) return;
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/platform/ai-usage", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const json = await res.json();
          if (json.success) setUsageList(json.data);
        }
      } catch (err) {
        console.error("Failed to load AI usage:", err);
      } finally {
        setIsLoading(false);
      }
    }

    loadAiUsage();
  }, [user]);

  const totalTokens = usageList.reduce((acc, u) => acc + u.tokensUsed, 0);
  const totalCost = usageList.reduce((acc, u) => acc + u.estimatedCostEur, 0);

  return (
    <CmpPlatformLayout title="Monitorizare Consum Tokeni AI">
      <div className="space-y-4">
        {/* Privacy Guard Notice */}
        <div className="bg-emerald-50/70 border border-emerald-200 rounded-lg p-4 text-xs text-emerald-950 flex items-start gap-3">
          <ShieldCheck size={16} className="text-emerald-700 shrink-0 mt-1" />
          <div className="leading-relaxed">
            <span className="font-semibold">Confidențialitate & Izolare AI:</span> Acest panou afișează exclusiv metadate
            agregate de volum (număr tokeni, cereri, cost estimat). Conținutul anunțurilor extrase, instrucțiunile
            specifice fiecărei agenții și conversațiile private sunt izolate strict pe fiecare agenție și nu sunt
            vizibile între chiriași sau utilizatori neautorizați.
          </div>
        </div>

        {/* Global Consumption KPI */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Total Tokeni Consumați</span>
            <p className="text-2xl font-medium text-[#051D35] mt-1 font-mono tabular-nums">
              {totalTokens >= 1_000_000
                ? `${(totalTokens / 1_000_000).toFixed(2)}M`
                : totalTokens >= 1_000
                  ? `${(totalTokens / 1_000).toFixed(1)}k`
                  : totalTokens.toLocaleString("ro-RO")}
            </p>
            <span className="text-[11px] text-gray-400 mt-1 block font-normal">Core API · Measured</span>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Cost Global Estimat</span>
            <p className="text-2xl font-medium text-emerald-700 mt-1 font-mono tabular-nums">{totalCost.toFixed(2)} €</p>
            <span className="text-[11px] text-gray-400 mt-1 block font-normal">Calculat din usageMetadata · Core API · Measured</span>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Model Implicit</span>
            <p className="text-xl font-medium text-[#051D35] mt-1 font-mono">gemini-4-hydrogen</p>
            <span className="text-[11px] text-gray-400 mt-1 block font-normal">Extracție multimodală și generare marketing</span>
          </div>
        </div>

        {/* Usage Breakdown by Agency */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between gap-2">
            <h3 className="font-title text-xs font-semibold text-gray-900 uppercase tracking-wider">Consum AI per Agenție</h3>
            <span className="text-[11px] text-gray-400">Core API · Measured</span>
          </div>
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 font-semibold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="py-3 px-4">Agenție</th>
                <th className="py-3 px-4">Tokeni Consumați / Limită</th>
                <th className="py-3 px-4 text-right">Număr Cereri</th>
                <th className="py-3 px-4 text-right">Cost Estimat</th>
                <th className="py-3 px-4">Model Activ</th>
              </tr>
            </thead>
            {isLoading ? (
              <tbody className="divide-y divide-gray-100 text-gray-700 font-normal">
                <tr>
                  <td colSpan={5} className="py-8 text-center text-gray-400">
                    Se încarcă datele de consum...
                  </td>
                </tr>
              </tbody>
            ) : usageList.length === 0 ? (
              <tbody className="divide-y divide-gray-100 text-gray-700 font-normal">
                <tr>
                  <td colSpan={5} className="py-8 text-center text-gray-400">
                    Nu există înregistrări de consum AI.
                  </td>
                </tr>
              </tbody>
            ) : (
              <VirtualizedTbody
                items={usageList}
                colSpan={5}
                estimateRowHeight={52}
                getItemKey={(u) => u.tenantId}
                className="divide-y divide-gray-100 text-gray-700 font-normal"
                renderRow={(u, _idx, rowRef) => (
                  <tr ref={rowRef} className="hover:bg-gray-50/50">
                    <td className="py-3 px-4 font-normal text-gray-900">{u.agencyName}</td>
                    <td className="py-3 px-4 font-mono text-[11px]">
                      <div className="w-48 space-y-1">
                        <div className="flex justify-between text-[10px] text-gray-600 tabular-nums">
                          <span>{u.tokensUsed >= 1000 ? `${Math.round(u.tokensUsed / 1000)}k` : u.tokensUsed}</span>
                          <span>{Math.round(u.tokenLimit / 1000)}k</span>
                        </div>
                        <AtmProgressBar
                          value={u.tokensUsed}
                          max={u.tokenLimit}
                          size="sm"
                          variant={u.tokenLimit > 0 && u.tokensUsed / u.tokenLimit > 0.85 ? "danger" : "brand"}
                        />
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">{u.requestCount} cereri</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums font-normal text-emerald-800">{Number(u.estimatedCostEur || 0).toFixed(2)} €</td>
                    <td className="py-3 px-4 font-mono text-[11px] text-gray-500">{u.topModel}</td>
                  </tr>
                )}
              />
            )}
          </table>
        </div>
      </div>
    </CmpPlatformLayout>
  );
};
