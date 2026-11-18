import React, { useEffect, useState } from "react";
import { Users, ShieldCheck, Info } from "lucide-react";
import { CmpPlatformLayout } from "../../ui/platform/cmp_platform-layout";
import { useAuth } from "../../core/auth/ctx_auth";
import { PlatformAdminUser } from "../../core/platform/typ_platform-admin";
import { VirtualizedTbody } from "../../components/VirtualizedList";

export const PgPlatformUsers: React.FC = () => {
  const { user } = useAuth();
  const [admins, setAdmins] = useState<PlatformAdminUser[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    async function loadPlatformUsers() {
      if (!user) return;
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/platform/users", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const json = await res.json();
          if (json.success) setAdmins(json.data);
        }
      } catch (err) {
        console.error("Failed to load platform admins:", err);
      } finally {
        setIsLoading(false);
      }
    }

    loadPlatformUsers();
  }, [user]);

  return (
    <CmpPlatformLayout title="Administratori Platformă">
      <div className="space-y-4">
        {/* Role Separation Notice */}
        <div className="bg-indigo-50/70 border border-indigo-200 rounded-lg p-4 text-xs text-indigo-900 flex items-start gap-3">
          <Info size={16} className="text-indigo-600 shrink-0 mt-1" />
          <div className="leading-relaxed">
            <span className="font-semibold">Separare Arhitecturală a Rolurilor:</span> Această pagină gestionează exclusiv{" "}
            <strong className="font-semibold">Administratorii de Platformă (Super Admin)</strong> care au autoritate globală pe infrastructură.
            Utilizatorii, brokerii și agenții independenți ai agențiilor imobiliare sunt izolați și gestionați în cadrul
            fiecărei agenții (vezi secțiunea <em>Agenții Înregistrate</em>). Rolurile de agenție nu au acces la nivel de platformă.
          </div>
        </div>

        {/* Admins Table */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-2xs">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 font-semibold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="py-3 px-4 font-semibold">Administrator</th>
                <th className="py-3 px-4 font-semibold">Email</th>
                <th className="py-3 px-4 font-semibold">Rol Platformă</th>
                <th className="py-3 px-4 font-semibold">Status</th>
                <th className="py-3 px-4 font-semibold">Creat la</th>
              </tr>
            </thead>
            {isLoading ? (
              <tbody className="divide-y divide-gray-100 text-gray-700">
                <tr>
                  <td colSpan={5} className="py-8 text-center text-gray-400">
                    Se încarcă lista administratorilor...
                  </td>
                </tr>
              </tbody>
            ) : admins.length === 0 ? (
              <tbody className="divide-y divide-gray-100 text-gray-700">
                <tr>
                  <td colSpan={5} className="py-8 text-center text-gray-400">
                    Niciun administrator găsit.
                  </td>
                </tr>
              </tbody>
            ) : (
              <VirtualizedTbody
                items={admins}
                colSpan={5}
                estimateRowHeight={52}
                getItemKey={(adm) => adm.id}
                className="divide-y divide-gray-100 text-gray-700"
                renderRow={(adm, _idx, rowRef) => (
                  <tr ref={rowRef} className="hover:bg-gray-50/50">
                    <td className="py-3 px-4 font-normal text-gray-900">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded bg-indigo-100 text-indigo-800 flex items-center justify-center font-semibold text-xs shrink-0">
                          <ShieldCheck size={14} />
                        </div>
                        <span>{adm.name}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 font-sans font-normal text-[11px] text-gray-600">{adm.email}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-1 leading-none rounded text-[10px] font-normal bg-indigo-50 border border-indigo-200 text-indigo-700 uppercase font-sans">
                        {adm.role.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-1 leading-none rounded text-[10px] font-normal ${
                          adm.isActive
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : "bg-red-50 text-red-700 border border-red-200"
                        }`}
                      >
                        {adm.isActive ? "Activ" : "Inactiv"}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-sans font-normal tabular-nums text-[11px] text-gray-500">
                      {new Date(adm.createdAt).toLocaleDateString()}
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
