import React, { useEffect, useState } from "react";
import {
  CreditCard,
  Search,
  Filter,
  CheckCircle2,
  AlertTriangle,
  Clock,
  XCircle,
  Edit,
  PlusCircle,
  Calendar,
  Layers,
  ArrowRight,
  ShieldCheck,
  X,
} from "lucide-react";
import { CmpPlatformLayout } from "../../ui/platform/cmp_platform-layout";
import { useAuth } from "../../core/auth/ctx_auth";
import { VirtualizedTbody } from "../../components/VirtualizedList";

interface SubscriptionRow {
  id: string;
  tenantId: string;
  agencyName: string;
  subdomain: string;
  planId: string;
  planDisplayName: string;
  status: string;
  billingInterval: string;
  currency: string;
  priceMonthly: number;
  currentPeriodEnd: string;
  trialEnd: string | null;
  activeAddons: Array<{ addonId: string; quantity: number }>;
  usage: {
    agents: number;
    properties: number;
    leads: number;
    aiTokens: number;
  };
}

export const PgPlatformSubscriptions: React.FC = () => {
  const { user } = useAuth();
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([]);
  const [search, setSearch] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Administrative action modal
  const [selectedSub, setSelectedSub] = useState<SubscriptionRow | null>(null);
  const [actionType, setActionType] = useState<"change_plan" | "change_status" | "add_addon" | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string>("plan_professional");
  const [selectedStatus, setSelectedStatus] = useState<string>("active");
  const [statusReason, setStatusReason] = useState<string>("");
  const [selectedAddonId, setSelectedAddonId] = useState<string>("addon_agents_5");
  const [addonQuantity, setAddonQuantity] = useState<number>(1);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  async function fetchSubscriptions() {
    setIsLoading(true);
    setError(null);
    try {
      const token = await user?.getIdToken();
      let url = "/api/platform/subscriptions";
      if (statusFilter !== "all") {
        url += `?status=${statusFilter}`;
      }
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.success) {
        setSubscriptions(json.data);
      } else {
        setError(json.error?.message || "Eroare la încărcarea abonamentelor.");
      }
    } catch (err: any) {
      setError(err?.message || "Eroare la conectare.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchSubscriptions();
  }, [statusFilter, user]);

  const filtered = subscriptions.filter((sub) => {
    const q = search.toLowerCase();
    return (
      sub.agencyName.toLowerCase().includes(q) ||
      sub.tenantId.toLowerCase().includes(q) ||
      sub.subdomain.toLowerCase().includes(q) ||
      sub.planDisplayName.toLowerCase().includes(q)
    );
  });

  async function handleExecuteAction(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSub) return;

    setIsSubmitting(true);
    try {
      const token = await user?.getIdToken();
      let url = "";
      let method = "PATCH";
      let body: any = {};

      if (actionType === "change_plan") {
        url = `/api/platform/subscriptions/${selectedSub.tenantId}/plan`;
        body = { planId: selectedPlanId, billingInterval: "month" };
      } else if (actionType === "change_status") {
        url = `/api/platform/subscriptions/${selectedSub.tenantId}/status`;
        body = { status: selectedStatus, reason: statusReason };
      } else if (actionType === "add_addon") {
        url = `/api/platform/subscriptions/${selectedSub.tenantId}/addons`;
        method = "POST";
        body = { addonId: selectedAddonId, quantity: addonQuantity };
      }

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        setActionType(null);
        setSelectedSub(null);
        fetchSubscriptions();
      } else {
        const errJson = await res.json().catch(() => ({}));
        alert(errJson.error?.message || "Eroare la executarea acțiunii.");
      }
    } catch (err: any) {
      alert(err?.message || "Eroare de conexiune.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <CmpPlatformLayout title="Abonamente Agenții">
      <div className="space-y-4">
        {/* Controls Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 border border-gray-200 rounded-lg shadow-2xs">
          <div className="flex-1 max-w-md relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
            <input
              type="text"
              placeholder="Caută după nume agenție, tenant ID sau plan..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-md text-xs font-normal placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 font-semibold flex items-center gap-1">
              <Filter size={13} />
              Status:
            </span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-md text-xs text-gray-700 font-normal bg-white focus:outline-none"
            >
              <option value="all">Toate stările</option>
              <option value="active">Active</option>
              <option value="trialing">În perioadă de probă (Trial)</option>
              <option value="past_due">Plată restantă (Past Due)</option>
              <option value="suspended">Suspendate</option>
              <option value="cancelled">Anulate</option>
            </select>
          </div>
        </div>

        {/* Subscriptions Table */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-2xs">
          {isLoading ? (
            <div className="p-12 text-center text-xs text-gray-400">Se încarcă abonamentele agențiilor...</div>
          ) : error ? (
            <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-xs text-gray-500">Nu au fost găsite abonamente conform filtrelor.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-[11px] font-semibold text-gray-600 uppercase tracking-wider">
                    <th className="py-3 px-4 font-semibold">Agenție / Tenant</th>
                    <th className="py-3 px-4 font-semibold">Plan Curent</th>
                    <th className="py-3 px-4 font-semibold">Status Abonament</th>
                    <th className="py-3 px-4 font-semibold">Utilizare Resurse</th>
                    <th className="py-3 px-4 font-semibold">Scadență / Reînnoire</th>
                    <th className="py-3 px-4 text-right font-semibold">Acțiuni Super Admin</th>
                  </tr>
                </thead>
                <VirtualizedTbody
                  items={filtered}
                  colSpan={6}
                  estimateRowHeight={68}
                  getItemKey={(sub) => sub.id}
                  className="divide-y divide-gray-100"
                  renderRow={(sub, _idx, rowRef) => (
                    <tr ref={rowRef} className="hover:bg-gray-50/70 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-normal text-gray-900">{sub.agencyName}</div>
                        <div className="text-[11px] font-sans font-normal text-gray-400">{sub.tenantId}</div>
                      </td>

                      <td className="py-3 px-4">
                        <span className="font-normal text-gray-900 block">{sub.planDisplayName}</span>
                        <span className="text-[11px] font-normal tabular-nums text-gray-500">
                          {sub.priceMonthly} {sub.currency} / {sub.billingInterval === "year" ? "an" : "lună"}
                        </span>
                      </td>

                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-1 leading-none rounded text-[10px] font-normal ${
                            sub.status === "active"
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : sub.status === "trialing"
                              ? "bg-blue-50 text-blue-700 border border-blue-200"
                              : sub.status === "past_due"
                              ? "bg-amber-50 text-amber-700 border border-amber-200"
                              : "bg-rose-50 text-rose-700 border border-rose-200"
                          }`}
                        >
                          {sub.status === "active" && <CheckCircle2 size={11} />}
                          {sub.status === "trialing" && <Clock size={11} />}
                          {sub.status === "past_due" && <AlertTriangle size={11} />}
                          {sub.status === "suspended" && <XCircle size={11} />}
                          <span className="capitalize">{sub.status}</span>
                        </span>
                        {sub.activeAddons.length > 0 && (
                          <div className="text-[10px] text-indigo-600 font-normal tabular-nums mt-1">
                            +{sub.activeAddons.length} pachete add-on
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-4 font-sans font-normal tabular-nums text-[11px] text-gray-600 space-y-1">
                        <div>Brokeri: {sub.usage?.agents ?? 0}</div>
                        <div>Proprietăți: {sub.usage?.properties ?? 0}</div>
                        <div>Tokeni AI: {(sub.usage?.aiTokens ?? 0).toLocaleString()}</div>
                      </td>

                      <td className="py-3 px-4 text-gray-600 font-normal tabular-nums text-[11px]">
                        <div>{new Date(sub.currentPeriodEnd).toLocaleDateString("ro-RO")}</div>
                        {sub.trialEnd && sub.status === "trialing" && (
                          <span className="text-[10px] text-blue-600 font-normal block">
                            Trial până: {new Date(sub.trialEnd).toLocaleDateString("ro-RO")}
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            onClick={() => {
                              setSelectedSub(sub);
                              setSelectedPlanId(sub.planId);
                              setActionType("change_plan");
                            }}
                            className="px-2 py-1 text-[11px] font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded"
                          >
                            Schimbă Plan
                          </button>
                          <button
                            onClick={() => {
                              setSelectedSub(sub);
                              setSelectedStatus(sub.status);
                              setStatusReason("");
                              setActionType("change_status");
                            }}
                            className="px-2 py-1 text-[11px] font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded"
                          >
                            Stare
                          </button>
                          <button
                            onClick={() => {
                              setSelectedSub(sub);
                              setSelectedAddonId("addon_agents_5");
                              setAddonQuantity(1);
                              setActionType("add_addon");
                            }}
                            className="px-2 py-1 text-[11px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded"
                          >
                            + Add-on
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                />
              </table>
            </div>
          )}
        </div>

        {/* Modal for Super Admin Actions */}
        {actionType && selectedSub && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-2xs flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-gray-200">
                <h3 className="font-title text-sm font-semibold text-gray-900">
                  {actionType === "change_plan" && "Modificare Plan Abonament"}
                  {actionType === "change_status" && "Modificare Stare Abonament"}
                  {actionType === "add_addon" && "Adăugare Pachet Add-on"}
                </h3>
                <button onClick={() => setActionType(null)} className="text-gray-400 hover:text-gray-600 p-1">
                  <X size={16} />
                </button>
              </div>

              <div className="text-xs text-gray-500 bg-gray-50 p-3 rounded border border-gray-200">
                <span className="font-semibold">Agenție țintă:</span>{" "}
                <span className="font-normal text-gray-900">{selectedSub.agencyName}</span> (
                <span className="font-sans font-normal text-[11px]">{selectedSub.tenantId}</span>)
              </div>

              <form onSubmit={handleExecuteAction} className="space-y-4 text-xs">
                {actionType === "change_plan" && (
                  <div>
                    <label className="block font-semibold text-gray-700 mb-1">Alege Noul Plan Tarifar</label>
                    <select
                      value={selectedPlanId}
                      onChange={(e) => setSelectedPlanId(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded text-xs font-normal bg-white"
                    >
                      <option value="plan_starter">Starter Agency (199 RON/lună)</option>
                      <option value="plan_professional">Professional Agency (499 RON/lună)</option>
                      <option value="plan_enterprise">Enterprise Cloud (999 RON/lună)</option>
                    </select>
                    <p className="text-[11px] text-gray-400 mt-1">
                      Datele existente sunt protejate și nu vor fi șterse nici în caz de downgrade.
                    </p>
                  </div>
                )}

                {actionType === "change_status" && (
                  <div className="space-y-4">
                    <div>
                      <label className="block font-semibold text-gray-700 mb-1">Stare Abonament</label>
                      <select
                        value={selectedStatus}
                        onChange={(e) => setSelectedStatus(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded text-xs font-normal bg-white"
                      >
                        <option value="active">Active (Activ)</option>
                        <option value="past_due">Past Due (Plată Restantă - 7 zile grație)</option>
                        <option value="suspended">Suspended (Suspendat)</option>
                        <option value="cancelled">Cancelled (Anulat)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-gray-700 mb-1">Motiv Administrativ (Audit)</label>
                      <input
                        type="text"
                        required
                        placeholder="Ex: Cerere scrisă agenție / reactivare manuală..."
                        value={statusReason}
                        onChange={(e) => setStatusReason(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded text-xs font-normal"
                      />
                    </div>
                  </div>
                )}

                {actionType === "add_addon" && (
                  <div className="space-y-4">
                    <div>
                      <label className="block font-semibold text-gray-700 mb-1">Pachet Add-on</label>
                      <select
                        value={selectedAddonId}
                        onChange={(e) => setSelectedAddonId(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded text-xs font-normal bg-white"
                      >
                        <option value="addon_agents_5">+5 Brokeri / Agenți (149 RON/lună)</option>
                        <option value="addon_properties_250">+250 Proprietăți Active (199 RON/lună)</option>
                        <option value="addon_ai_tokens_500k">+500.000 Tokeni AI (99 RON/lună)</option>
                        <option value="addon_storage_50gb">+50 GB Stocare Cloud (79 RON/lună)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-gray-700 mb-1">Cantitate Pachete</label>
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={addonQuantity}
                        onChange={(e) => setAddonQuantity(Number(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded text-xs font-normal tabular-nums"
                      />
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-end gap-4 pt-3 border-t border-gray-200">
                  <button
                    type="button"
                    onClick={() => setActionType(null)}
                    className="px-3 py-2 border border-gray-300 text-gray-700 font-semibold rounded hover:bg-gray-50"
                  >
                    Anulează
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-4 py-2 bg-[#051D35] text-white font-semibold rounded hover:bg-[#051D35]/90 disabled:opacity-50"
                  >
                    {isSubmitting ? "Se execută..." : "Aplică Modificarea"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </CmpPlatformLayout>
  );
};
