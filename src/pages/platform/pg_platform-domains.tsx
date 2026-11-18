import React, { useEffect, useState } from "react";
import { Globe, Server, CheckCircle2, Clock, AlertCircle, Info } from "lucide-react";
import { CmpPlatformLayout } from "../../ui/platform/cmp_platform-layout";
import { useAuth } from "../../core/auth/ctx_auth";
import { VirtualizedTbody } from "../../components/VirtualizedList";

export const PgPlatformDomains: React.FC = () => {
  const { user } = useAuth();
  const [domains, setDomains] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    async function loadDomains() {
      if (!user) return;
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/platform/domains", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const json = await res.json();
          if (json.success) setDomains(json.data);
        }
      } catch (err) {
        console.error("Failed to load domains:", err);
      } finally {
        setIsLoading(false);
      }
    }

    loadDomains();
  }, [user]);

  return (
    <CmpPlatformLayout title="Domenii & Mapare Infrastructură">
      <div className="space-y-4">
        {/* Domain Independence Notice */}
        <div className="bg-amber-50/70 border border-amber-200 rounded-lg p-4 text-xs text-amber-900 flex items-start gap-3">
          <Info size={16} className="text-amber-700 shrink-0 mt-1" />
          <div className="leading-relaxed">
            <span className="font-semibold">Notă Arhitecturală privind Domeniul Rădăcină:</span> Platforma este proiectată
            decuplat de orice domeniu specific. Nu există o dependență fixă față de vreun domeniu cumpărat anterior.
            Configurația domeniului de bază se setează opțional prin variabila de mediu{" "}
            <code className="bg-white/80 px-1 py-1 rounded font-sans font-normal text-[11px]">PLATFORM_ROOT_DOMAIN</code>.
            În medii de dezvoltare și preview (Cloud Run / Localhost), rezoluția funcționează independent.
          </div>
        </div>

        {/* Domains Table */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-2xs">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 font-semibold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="py-3 px-4 font-semibold">Domeniu / Hostname</th>
                <th className="py-3 px-4 font-semibold">Tip Domeniu</th>
                <th className="py-3 px-4 font-semibold">Destinație / Agenție</th>
                <th className="py-3 px-4 font-semibold">Status Mapare</th>
              </tr>
            </thead>
            {isLoading ? (
              <tbody className="divide-y divide-gray-100 text-gray-700">
                <tr>
                  <td colSpan={4} className="py-8 text-center text-gray-400">
                    Se încarcă lista domeniilor...
                  </td>
                </tr>
              </tbody>
            ) : domains.length === 0 ? (
              <tbody className="divide-y divide-gray-100 text-gray-700">
                <tr>
                  <td colSpan={4} className="py-8 text-center text-gray-400">
                    Niciun domeniu mapat.
                  </td>
                </tr>
              </tbody>
            ) : (
              <VirtualizedTbody
                items={domains}
                colSpan={4}
                estimateRowHeight={48}
                getItemKey={(d, idx) => `${d.domain}-${idx}`}
                className="divide-y divide-gray-100 text-gray-700"
                renderRow={(d, _idx, rowRef) => (
                  <tr ref={rowRef} className="hover:bg-gray-50/50">
                    <td className="py-3 px-4 font-sans font-normal text-gray-900 flex items-center gap-2">
                      <Globe size={14} className="text-gray-400 shrink-0" />
                      <span>{d.domain}</span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-1 leading-none rounded text-[10px] font-normal bg-gray-100 text-gray-700 capitalize">
                        {d.type.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-normal text-gray-800">{d.target}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-1 leading-none rounded text-[10px] font-normal ${
                          d.status === "active" || d.status === "verified"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : d.status === "pending_configuration"
                            ? "bg-amber-50 text-amber-700 border border-amber-200"
                            : "bg-red-50 text-red-700 border border-red-200"
                        }`}
                      >
                        {d.status === "active" || d.status === "verified" ? (
                          <CheckCircle2 size={11} />
                        ) : (
                          <Clock size={11} />
                        )}
                        <span className="capitalize">{d.status.replace(/_/g, " ")}</span>
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
