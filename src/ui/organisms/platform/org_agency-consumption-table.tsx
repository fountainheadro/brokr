import React, { useMemo, useState } from "react";
import { Search, ArrowUpDown } from "lucide-react";

export interface AgencyConsumptionRow {
  tenantId: string;
  agencyName: string;
  subdomain: string;
  status: string;
  activeAgents: number;
  activeUsers24h: number;
  apiRequests: number;
  api4xx: number;
  api5xx: number;
  p95LatencyMs: number;
  aiRequests: number;
  aiPromptTokens: number;
  aiOutputTokens: number;
  aiTokensUsed: number;
  aiTokenLimit: number;
  estimatedAiCostEur: number;
  topModel: string;
  storageMb: number;
  storageFilesCount: number;
  outboxPendingOrRetryable: number;
  outboxDeadLetter: number;
  portalEnabledProviders: string[];
  portalPublished: number;
  portalErrors: number;
  provenance: string;
  provenanceLabel: string;
}

type SortKey =
  | "agencyName"
  | "apiRequests"
  | "p95LatencyMs"
  | "aiTokensUsed"
  | "estimatedAiCostEur"
  | "storageMb"
  | "outboxDeadLetter"
  | "portalPublished";

export interface OrgAgencyConsumptionTableProps {
  agencies: AgencyConsumptionRow[];
  provenanceLabel: string;
}

function formatCompactNumber(val: number): string {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}k`;
  return String(val);
}

export const OrgAgencyConsumptionTable: React.FC<OrgAgencyConsumptionTableProps> = ({
  agencies,
  provenanceLabel,
}) => {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("aiTokensUsed");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "agencyName" ? "asc" : "desc");
    }
  };

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? agencies.filter(
          (a) =>
            a.agencyName.toLowerCase().includes(q) ||
            a.tenantId.toLowerCase().includes(q) ||
            a.subdomain.toLowerCase().includes(q)
        )
      : agencies;

    return [...filtered].sort((a, b) => {
      const mul = sortDir === "asc" ? 1 : -1;
      if (sortKey === "agencyName") {
        return a.agencyName.localeCompare(b.agencyName) * mul;
      }
      return ((a[sortKey] as number) - (b[sortKey] as number)) * mul;
    });
  }, [agencies, search, sortKey, sortDir]);

  return (
    <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-title text-sm font-semibold text-[#051D35]">
            Atribuire Consum per Agenție
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Trafic API, latență p95, consum Gemini măsurat din usageMetadata, stocare și sincronizare portaluri ·{" "}
            <span className="text-slate-400">{provenanceLabel}</span>
          </p>
        </div>

        <div className="relative w-full sm:w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Caută agenție sau tenant ID..."
            className="w-full pl-9 pr-3 py-1.5 border border-slate-200 rounded-md text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#051D35]"
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="px-5 py-10 text-center text-xs text-slate-500">
          Nu există agenții care să corespundă criteriului de căutare.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50/70 border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                <th className="py-2.5 px-4">
                  <button
                    type="button"
                    onClick={() => toggleSort("agencyName")}
                    className="inline-flex items-center gap-1 hover:text-[#051D35] cursor-pointer"
                  >
                    <span>Agenție</span>
                    <ArrowUpDown size={11} />
                  </button>
                </th>
                <th className="py-2.5 px-3 text-right">Brokeri / 24h</th>
                <th className="py-2.5 px-3 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort("apiRequests")}
                    className="inline-flex items-center gap-1 hover:text-[#051D35] cursor-pointer"
                  >
                    <span>Cereri API</span>
                    <ArrowUpDown size={11} />
                  </button>
                </th>
                <th className="py-2.5 px-3 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort("p95LatencyMs")}
                    className="inline-flex items-center gap-1 hover:text-[#051D35] cursor-pointer"
                  >
                    <span>p95 ms</span>
                    <ArrowUpDown size={11} />
                  </button>
                </th>
                <th className="py-2.5 px-3 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort("aiTokensUsed")}
                    className="inline-flex items-center gap-1 hover:text-[#051D35] cursor-pointer"
                  >
                    <span>Tokeni AI</span>
                    <ArrowUpDown size={11} />
                  </button>
                </th>
                <th className="py-2.5 px-3 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort("estimatedAiCostEur")}
                    className="inline-flex items-center gap-1 hover:text-[#051D35] cursor-pointer"
                  >
                    <span>Cost AI</span>
                    <ArrowUpDown size={11} />
                  </button>
                </th>
                <th className="py-2.5 px-3 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort("storageMb")}
                    className="inline-flex items-center gap-1 hover:text-[#051D35] cursor-pointer"
                  >
                    <span>Stocare MB</span>
                    <ArrowUpDown size={11} />
                  </button>
                </th>
                <th className="py-2.5 px-3 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort("outboxDeadLetter")}
                    className="inline-flex items-center gap-1 hover:text-[#051D35] cursor-pointer"
                  >
                    <span>Outbox DLQ</span>
                    <ArrowUpDown size={11} />
                  </button>
                </th>
                <th className="py-2.5 px-4 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort("portalPublished")}
                    className="inline-flex items-center gap-1 hover:text-[#051D35] cursor-pointer"
                  >
                    <span>Portaluri</span>
                    <ArrowUpDown size={11} />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((a) => {
                const tokenPct =
                  a.aiTokenLimit > 0 ? Math.min(100, Math.round((a.aiTokensUsed / a.aiTokenLimit) * 100)) : 0;
                return (
                  <tr key={a.tenantId} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4">
                      <div className="font-medium text-[#051D35]">{a.agencyName}</div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        {a.tenantId} · {a.status}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                      {a.activeAgents}
                      <span className="text-slate-400"> / {a.activeUsers24h}</span>
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800">
                      <div>{a.apiRequests.toLocaleString("ro-RO")}</div>
                      {(a.api4xx > 0 || a.api5xx > 0) && (
                        <div className="text-[10px] text-slate-400">
                          4xx:{a.api4xx} · <span className={a.api5xx > 0 ? "text-rose-700" : ""}>5xx:{a.api5xx}</span>
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                      {a.p95LatencyMs > 0 ? `${a.p95LatencyMs} ms` : "—"}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800">
                      <div>
                        {formatCompactNumber(a.aiTokensUsed)}
                        <span className="text-slate-400"> / {formatCompactNumber(a.aiTokenLimit)}</span>
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {a.aiRequests} req · {tokenPct}%
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-emerald-700">
                      {a.estimatedAiCostEur.toFixed(2)} €
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                      <div>{a.storageMb.toFixed(2)} MB</div>
                      <div className="text-[10px] text-slate-400">{a.storageFilesCount} fișiere</div>
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums">
                      <span className={a.outboxDeadLetter > 0 ? "text-rose-700 font-semibold" : "text-slate-600"}>
                        {a.outboxDeadLetter}
                      </span>
                      {a.outboxPendingOrRetryable > 0 && (
                        <span className="text-[10px] text-slate-400"> (+{a.outboxPendingOrRetryable})</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700">
                      <div>
                        {a.portalPublished} pub
                        {a.portalErrors > 0 ? (
                          <span className="text-rose-700"> · {a.portalErrors} err</span>
                        ) : null}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {a.portalEnabledProviders.length > 0 ? a.portalEnabledProviders.join(", ") : "inactiv"}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
