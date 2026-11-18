import React, { useEffect, useState } from "react";
import { Boxes, CheckCircle2, XCircle, Tag, Layers, Plus, ShieldCheck, Check, AlertCircle } from "lucide-react";
import { CmpPlatformLayout } from "../../ui/platform/cmp_platform-layout";
import { useAuth } from "../../core/auth/ctx_auth";

interface ModuleRow {
  id: string;
  name: string;
  description: string;
  category: string;
  isActive: boolean;
  canBePurchasedAsAddon: boolean;
  dependencies?: string[];
  includedInPlans: Array<{ id: string; displayName: string }>;
}

interface AddonRow {
  id: string;
  name: string;
  description: string;
  priceMonthly: number;
  currency: string;
  isActive: boolean;
  quotaGrant: Record<string, any>;
}

export const PgPlatformModules: React.FC = () => {
  const { user } = useAuth();
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [addons, setAddons] = useState<AddonRow[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchModules() {
    setIsLoading(true);
    setError(null);
    try {
      const token = await user?.getIdToken();
      const res = await fetch("/api/platform/modules", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.success) {
        setModules(json.data.modules);
        setAddons(json.data.addons);
      } else {
        setError(json.error?.message || "Eroare la încărcarea modulelor.");
      }
    } catch (err: any) {
      setError(err?.message || "Eroare de conexiune.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchModules();
  }, [user]);

  async function handleToggleModule(id: string, currentActive: boolean) {
    try {
      const token = await user?.getIdToken();
      const res = await fetch(`/api/platform/modules/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ isActive: !currentActive }),
      });
      if (res.ok) {
        fetchModules();
      }
    } catch (err) {
      console.error("Eroare la comutarea modulului:", err);
    }
  }

  return (
    <CmpPlatformLayout title="Catalog Module & Add-on">
      <div className="space-y-6">
        {/* Modules Section */}
        <div className="space-y-4">
          <div className="bg-white p-5 border border-gray-200 rounded-lg shadow-2xs">
            <h2 className="font-title text-base font-semibold text-gray-900">Catalog Module Funcționale CRM</h2>
            <p className="text-xs text-gray-500 mt-1">
              Activează sau restricționează disponibilitatea modulelor la nivel de platformă și verifică planurile tarifare în care sunt incluse.
            </p>
          </div>

          {isLoading ? (
            <div className="p-12 text-center text-xs text-gray-400">Se încarcă catalogul...</div>
          ) : error ? (
            <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded">{error}</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {modules.map((m) => (
                <div
                  key={m.id}
                  className={`bg-white border rounded-lg p-4 flex flex-col justify-between shadow-2xs ${
                    m.isActive ? "border-gray-200" : "border-gray-200 bg-gray-50/50 opacity-60"
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between mb-2">
                      <span className="font-sans text-[10px] text-gray-400 font-normal">{m.id}</span>
                      <span
                        className={`px-2 py-1 leading-none rounded text-[10px] font-normal ${
                          m.isActive
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {m.isActive ? "Disponibil" : "Dezactivat"}
                      </span>
                    </div>

                    <h3 className="font-title text-sm font-semibold text-gray-900 mb-1">{m.name}</h3>
                    <p className="text-xs text-gray-500 leading-relaxed mb-3">{m.description}</p>
                  </div>

                  <div className="space-y-2 pt-3 border-t border-gray-100 text-xs">
                    {/* Dependencies */}
                    {m.dependencies && m.dependencies.length > 0 && (
                      <div className="text-[11px] text-gray-500">
                        <span className="font-semibold text-gray-700">Necesită:</span>{" "}
                        <span className="font-sans font-normal text-gray-600">{m.dependencies.join(", ")}</span>
                      </div>
                    )}

                    {/* Included in Plans */}
                    <div className="text-[11px]">
                      <span className="font-semibold text-gray-700 block mb-1">Inclus în planurile:</span>
                      <div className="flex flex-wrap gap-2">
                        {m.includedInPlans.length > 0 ? (
                          m.includedInPlans.map((p) => (
                            <span
                              key={p.id}
                              className="px-2 py-1 leading-none rounded text-[10px] font-normal bg-indigo-50 border border-indigo-200 text-indigo-700"
                            >
                              {p.displayName}
                            </span>
                          ))
                        ) : (
                          <span className="text-gray-400 italic">Doar ca add-on separat</span>
                        )}
                      </div>
                    </div>

                    {/* Action Button */}
                    <div className="pt-2 flex items-center justify-between">
                      <span className="text-[10px] text-gray-400">
                        {m.canBePurchasedAsAddon ? "Eligibil ca add-on" : "Inclus exclusiv în plan"}
                      </span>
                      <button
                        onClick={() => handleToggleModule(m.id, m.isActive)}
                        className={`text-xs font-semibold ${
                          m.isActive ? "text-rose-600 hover:text-rose-800" : "text-emerald-600 hover:text-emerald-800"
                        }`}
                      >
                        {m.isActive ? "Dezactivează" : "Activează"}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Addons Section */}
        <div className="space-y-4">
          <div className="bg-white p-5 border border-gray-200 rounded-lg shadow-2xs">
            <h2 className="font-title text-base font-semibold text-gray-900">Pachete Add-on Disponibile pentru Agenții</h2>
            <p className="text-xs text-gray-500 mt-1">
              Extensii de resurse (brokeri suplimentari, proprietăți, tokeni AI, stocare cloud) ce pot fi achiziționate independent de planul de bază.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {addons.map((a) => (
              <div key={a.id} className="bg-white border border-gray-200 rounded-lg p-4 shadow-2xs flex flex-col justify-between">
                <div>
                  <span className="font-sans text-[10px] text-gray-400 font-normal block mb-1">{a.id}</span>
                  <h4 className="font-title text-sm font-semibold text-gray-900 mb-1">{a.name}</h4>
                  <p className="text-xs text-gray-500 mb-3">{a.description}</p>
                </div>

                <div className="pt-3 border-t border-gray-100 flex items-center justify-between">
                  <span className="text-sm font-normal tabular-nums text-gray-900">
                    {a.priceMonthly} {a.currency} <span className="text-xs font-normal text-gray-500">/ lună</span>
                  </span>
                  <span className="px-2 py-1 leading-none rounded text-[10px] font-normal bg-emerald-50 text-emerald-700 border border-emerald-200">
                    Disponibil
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </CmpPlatformLayout>
  );
};
