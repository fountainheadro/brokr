import React, { useEffect, useState } from "react";
import { ScrollText, ShieldAlert, CheckCircle2, AlertCircle, Clock, Filter } from "lucide-react";
import { CmpPlatformLayout } from "../../ui/platform/cmp_platform-layout";
import { PlatformAuditLogEntry } from "../../core/platform/typ_platform-admin";
import { useAuth } from "../../core/auth/ctx_auth";
import { VirtualizedTbody } from "../../components/VirtualizedList";

export const PgPlatformAuditLogs: React.FC = () => {
  const { user } = useAuth();
  const [logs, setLogs] = useState<PlatformAuditLogEntry[]>([]);
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    async function loadAuditLogs() {
      if (!user) return;
      try {
        const token = await user.getIdToken();
        let url = "/api/platform/audit-logs?limit=50";
        if (actionFilter !== "all") url += `&action=${encodeURIComponent(actionFilter)}`;

        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const json = await res.json();
          if (json.success) setLogs(json.data);
        }
      } catch (err) {
        console.error("Failed to load audit logs:", err);
      } finally {
        setIsLoading(false);
      }
    }

    loadAuditLogs();
  }, [user, actionFilter]);

  return (
    <CmpPlatformLayout title="Jurnal de Audit Platformă">
      <div className="space-y-4">
        {/* Filter bar */}
        <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-2xs flex items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-2">
            <Filter size={14} className="text-gray-400" />
            <span className="font-semibold text-gray-700">Filtrează după acțiune:</span>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto">
            {["all", "agency_suspended", "agency_reactivated", "agency_note_added", "platform_settings_updated"].map(
              (act) => (
                <button
                  key={act}
                  type="button"
                  onClick={() => setActionFilter(act)}
                  className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                    actionFilter === act
                      ? "bg-[#051D35] text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {act === "all" ? "Toate Acțiunile" : act.replace(/_/g, " ")}
                </button>
              )
            )}
          </div>
        </div>

        {/* Audit Log Table */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-2xs">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 font-semibold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="py-3 px-4">Dată & Oră</th>
                <th className="py-3 px-4">Utilizator Actor</th>
                <th className="py-3 px-4">Acțiune Executată</th>
                <th className="py-3 px-4">Țintă</th>
                <th className="py-3 px-4">Detalii</th>
                <th className="py-3 px-4">Rezultat</th>
              </tr>
            </thead>
            {isLoading ? (
              <tbody className="divide-y divide-gray-100 text-gray-700 font-normal">
                <tr>
                  <td colSpan={6} className="py-8 text-center text-gray-400">
                    Se încarcă jurnalul de audit...
                  </td>
                </tr>
              </tbody>
            ) : logs.length === 0 ? (
              <tbody className="divide-y divide-gray-100 text-gray-700 font-normal">
                <tr>
                  <td colSpan={6} className="py-8 text-center text-gray-400">
                    Nicio înregistrare de audit găsită.
                  </td>
                </tr>
              </tbody>
            ) : (
              <VirtualizedTbody
                items={logs}
                colSpan={6}
                estimateRowHeight={52}
                getItemKey={(log) => log.id}
                className="divide-y divide-gray-100 text-gray-700 font-normal"
                renderRow={(log, _idx, rowRef) => (
                  <tr ref={rowRef} className="hover:bg-gray-50/50">
                    <td className="py-3 px-4 font-sans tabular-nums font-normal text-[11px] text-gray-500 whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleString()}
                    </td>
                    <td className="py-3 px-4">
                      <div>
                        <span className="font-normal text-gray-900 block">{log.actorEmail}</span>
                        <span className="text-[10px] text-gray-400 uppercase font-sans font-normal">{log.actorRole}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-1 leading-none rounded text-[10px] font-normal bg-indigo-50 border border-indigo-200 text-indigo-700 uppercase font-sans">
                        {log.action.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-normal text-gray-800">
                      {log.targetName || log.targetId}
                    </td>
                    <td className="py-3 px-4 text-gray-600 max-w-xs truncate font-normal">
                      {log.details ? JSON.stringify(log.details) : "—"}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-1 leading-none rounded text-[10px] font-normal ${
                          log.result === "success"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : "bg-red-50 text-red-700 border border-red-200"
                        }`}
                      >
                        {log.result === "success" ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
                        <span>{log.result}</span>
                      </span>
                    </td>
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
