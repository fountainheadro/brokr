import React, { useEffect, useState } from "react";
import { Gauge, Search, AlertTriangle, Users, Home, FileText, Cpu, HardDrive } from "lucide-react";
import { CmpPlatformLayout } from "../../ui/platform/cmp_platform-layout";
import { useAuth } from "../../core/auth/ctx_auth";
import { VirtualizedTbody } from "../../components/VirtualizedList";

interface AgencyUsageRow {
  tenantId: string;
  agencyName: string;
  subdomain: string;
  planDisplayName: string;
  status: string;
  usage: {
    agents: number;
    properties: number;
    leads: number;
    aiTokens: number;
    aiRequests: number;
    storageMb: number;
  };
  quotas: {
    maxAgents: number;
    maxProperties: number;
    maxLeads: number;
    monthlyAiTokens: number;
    monthlyAiRequests: number;
    storageMb: number;
  };
  warnings: string[];
}

export const PgPlatformUsage: React.FC = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<AgencyUsageRow[]>([]);
  const [search, setSearch] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchUsage() {
      setIsLoading(true);
      setError(null);
      try {
        const token = await user?.getIdToken();
        const res = await fetch("/api/platform/usage", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (json.success) {
          setRows(json.data);
        } else {
          setError(json.error?.message || "Eroare la încărcarea consumului de resurse.");
        }
      } catch (err: any) {
        setError(err?.message || "Eroare de conexiune.");
      } finally {
        setIsLoading(false);
      }
    }
    fetchUsage();
  }, [user]);

  const filtered = rows.filter(
    (r) =>
      r.agencyName.toLowerCase().includes(search.toLowerCase()) ||
      r.tenantId.toLowerCase().includes(search.toLowerCase()) ||
      r.subdomain.toLowerCase().includes(search.toLowerCase())
  );

  function renderProgressBar(current: number, max: number, label: string) {
    if (max === -1) {
      return (
        <div className="text-[11px] text-gray-500">
          <span className="font-normal text-gray-900">{current}</span> (nelimitat)
        </div>
      );
    }
    const percent = Math.min(100, Math.round((current / max) * 100));
    const isHigh = percent >= 85;
    return (
      <div className="space-y-1 w-full max-w-[130px]">
        <div className="flex justify-between text-[10px]">
          <span className="font-normal text-gray-800">{current} / {max}</span>
          <span className={isHigh ? "text-amber-600 font-normal" : "text-gray-400 font-normal"}>{percent}%</span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              percent >= 100 ? "bg-rose-500" : isHigh ? "bg-amber-500" : "bg-indigo-600"
            }`}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <CmpPlatformLayout title="Monitorizare Cote & Resurse">
      <div className="space-y-4">
        {/* Header Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 border border-gray-200 rounded-lg shadow-2xs">
          <div>
            <h2 className="font-title text-base font-semibold text-gray-900">Consum Resurse și Cote per Agenție</h2>
            <p className="text-xs text-gray-500 mt-1">
              Monitorizare în timp real a conturilor de brokeri, proprietăților active, tokenilor AI și stocării utilizate.
            </p>
          </div>

          <div className="w-full sm:w-72 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
            <input
              type="text"
              placeholder="Filtrează după nume sau tenant ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-md text-xs font-normal focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>

        {/* Usage Table */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-2xs">
          {isLoading ? (
            <div className="p-12 text-center text-xs text-gray-400">Se încarcă datele de consum...</div>
          ) : error ? (
            <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-xs text-gray-500">Nu au fost găsite agenții.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-[11px] font-semibold text-gray-600 uppercase tracking-wider">
                    <th className="py-3 px-4">Agenție / Plan</th>
                    <th className="py-3 px-4">
                      <span className="flex items-center gap-1">
                        <Users size={12} /> Brokeri Activi
                      </span>
                    </th>
                    <th className="py-3 px-4">
                      <span className="flex items-center gap-1">
                        <Home size={12} /> Proprietăți
                      </span>
                    </th>
                    <th className="py-3 px-4">
                      <span className="flex items-center gap-1">
                        <FileText size={12} /> Lead-uri
                      </span>
                    </th>
                    <th className="py-3 px-4">
                      <span className="flex items-center gap-1">
                        <Cpu size={12} /> Tokeni AI Lunari
                      </span>
                    </th>
                    <th className="py-3 px-4">
                      <span className="flex items-center gap-1">
                        <HardDrive size={12} /> Stocare MB
                      </span>
                    </th>
                    <th className="py-3 px-4">Alerte Limită</th>
                  </tr>
                </thead>
                <VirtualizedTbody
                  items={filtered}
                  colSpan={7}
                  estimateRowHeight={64}
                  getItemKey={(row) => row.tenantId}
                  className="divide-y divide-gray-100"
                  renderRow={(row, _idx, rowRef) => (
                    <tr ref={rowRef} className="hover:bg-gray-50/70 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-normal text-gray-900">{row.agencyName}</div>
                        <div className="text-[11px] text-gray-400 font-sans font-normal">{row.tenantId}</div>
                        <div className="text-[11px] font-normal text-indigo-600 mt-1">{row.planDisplayName}</div>
                      </td>

                      <td className="py-3 px-4">
                        {renderProgressBar(row.usage.agents, row.quotas.maxAgents, "Brokeri")}
                      </td>

                      <td className="py-3 px-4">
                        {renderProgressBar(row.usage.properties, row.quotas.maxProperties, "Proprietăți")}
                      </td>

                      <td className="py-3 px-4">
                        {renderProgressBar(row.usage.leads, row.quotas.maxLeads, "Lead-uri")}
                      </td>

                      <td className="py-3 px-4">
                        {renderProgressBar(row.usage.aiTokens, row.quotas.monthlyAiTokens, "Tokeni AI")}
                      </td>

                      <td className="py-3 px-4">
                        {renderProgressBar(row.usage.storageMb, row.quotas.storageMb, "Stocare")}
                      </td>

                      <td className="py-3 px-4">
                        {row.warnings && row.warnings.length > 0 ? (
                          <div className="flex items-center gap-1 text-[11px] text-amber-700 bg-amber-50 px-2 py-1 rounded border border-amber-200 font-normal">
                            <AlertTriangle size={12} className="shrink-0" />
                            <span>{row.warnings.length} limită apropiată</span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-emerald-700 font-normal">În limite</span>
                        )}
                      </td>
                    </tr>
                  )}
                />
              </table>
            </div>
          )}
        </div>
      </div>
    </CmpPlatformLayout>
  );
};
