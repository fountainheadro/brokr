import React, { useEffect, useState } from "react";
import {
  Package,
  Plus,
  CheckCircle2,
  XCircle,
  Archive,
  Edit2,
  Users,
  Home,
  FileText,
  Cpu,
  HardDrive,
  AlertCircle,
  X,
  Layers,
} from "lucide-react";
import { CmpPlatformLayout } from "../../ui/platform/cmp_platform-layout";
import { SubscriptionPlanRecord } from "../../core/subscription/typ_subscription";
import { useAuth } from "../../core/auth/ctx_auth";

export const PgPlatformPlans: React.FC = () => {
  const { user } = useAuth();
  const [plans, setPlans] = useState<SubscriptionPlanRecord[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Edit / Create Modal State
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingPlan, setEditingPlan] = useState<Partial<SubscriptionPlanRecord> | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  async function fetchPlans() {
    setIsLoading(true);
    setError(null);
    try {
      const token = await user?.getIdToken();
      const url = filter === "all" ? "/api/platform/plans" : `/api/platform/plans?status=${filter}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.success) {
        setPlans(json.data);
      } else {
        setError(json.error?.message || "Eroare la încărcarea planurilor tarifare.");
      }
    } catch (err: any) {
      setError(err?.message || "Eroare la conectarea cu serverul.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchPlans();
  }, [filter, user]);

  async function handleToggleStatus(planId: string, currentStatus: string) {
    const nextStatus = currentStatus === "active" ? "inactive" : "active";
    try {
      const token = await user?.getIdToken();
      const res = await fetch(`/api/platform/plans/${planId}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (res.ok) {
        fetchPlans();
      }
    } catch (err) {
      console.error("Eroare la comutarea stării planului:", err);
    }
  }

  async function handleSavePlan(e: React.FormEvent) {
    e.preventDefault();
    if (!editingPlan?.id || !editingPlan?.displayName) return;

    setIsSaving(true);
    try {
      const token = await user?.getIdToken();
      const isNew = !plans.some((p) => p.id === editingPlan.id);
      const url = isNew ? "/api/platform/plans" : `/api/platform/plans/${editingPlan.id}`;
      const method = isNew ? "POST" : "PUT";

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(editingPlan),
      });

      if (res.ok) {
        setIsModalOpen(false);
        setEditingPlan(null);
        fetchPlans();
      } else {
        const errJson = await res.json().catch(() => ({}));
        alert(errJson.error?.message || "Eroare la salvarea planului.");
      }
    } catch (err: any) {
      alert(err?.message || "Eroare de conexiune.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <CmpPlatformLayout title="Planuri Tarifare & Abonamente">
      <div className="space-y-4">
        {/* Header & Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 border border-gray-200 rounded-lg shadow-2xs">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-title text-base font-semibold text-gray-900">Catalog Planuri Tarifare</h2>
              <span className="px-2 py-1 leading-none rounded text-[10px] font-normal bg-amber-50 text-amber-800 border border-amber-200">
                Date de testare provizorii
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Configurarea pachetelor, a limitelor de brokeri, proprietăți, tokeni AI și a modulelor incluse.
            </p>
          </div>

          <div className="flex items-center gap-4">
            {/* Filter buttons */}
            <div className="flex items-center bg-gray-100 p-1 rounded-md text-xs font-semibold">
              {(["all", "active", "inactive"] as const).map((st) => (
                <button
                  key={st}
                  onClick={() => setFilter(st)}
                  className={`px-3 py-1 rounded transition-colors ${
                    filter === st ? "bg-white text-gray-900 shadow-2xs" : "text-gray-500 hover:text-gray-800"
                  }`}
                >
                  {st === "all" ? "Toate" : st === "active" ? "Active" : "Inactive"}
                </button>
              ))}
            </div>

            <button
              onClick={() => {
                setEditingPlan({
                  id: `plan_custom_${Date.now()}`,
                  name: "Plan Nou Personalizat",
                  displayName: "Plan Nou Personalizat",
                  description: "Descriere pachet comercial",
                  priceMonthly: 299,
                  priceAnnual: 2990,
                  currency: "RON",
                  billingInterval: "month",
                  status: "active",
                  trialAvailable: true,
                  trialDays: 14,
                  includedModules: ["mod_leads", "mod_properties", "mod_public_share"],
                  quotas: {
                    maxAgents: 5,
                    maxProperties: 250,
                    maxLeads: 500,
                    monthlyAiTokens: 500000,
                    monthlyAiRequests: 500,
                    storageMb: 10240,
                  },
                  features: ["5 Brokeri", "250 Proprietăți", "500k Tokeni AI"],
                  displayOrder: plans.length + 1,
                });
                setIsModalOpen(true);
              }}
              className="inline-flex items-center gap-2 px-3 py-2 bg-[#051D35] hover:bg-[#051D35]/90 text-white text-xs font-semibold rounded shadow-2xs transition-colors"
            >
              <Plus size={14} />
              <span>Adaugă Plan</span>
            </button>
          </div>
        </div>

        {/* Plans Grid */}
        {isLoading ? (
          <div className="p-12 text-center text-xs text-gray-400">Se încarcă catalogul de planuri...</div>
        ) : error ? (
          <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg">{error}</div>
        ) : plans.length === 0 ? (
          <div className="p-8 text-center bg-white border border-gray-200 rounded-lg text-xs text-gray-500">
            Nu s-au găsit planuri tarifare conform filtrului selectat.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {plans.map((plan) => (
              <div
                key={plan.id}
                className={`bg-white border rounded-lg p-5 flex flex-col justify-between shadow-2xs relative ${
                  plan.status === "active" ? "border-gray-200" : "border-gray-200 opacity-60 bg-gray-50/50"
                }`}
              >
                {/* Status Badge */}
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <span className="text-[10px] font-sans font-normal text-gray-400 block mb-1">
                      {plan.id}
                    </span>
                    <h3 className="font-title text-sm font-semibold text-gray-900">{plan.displayName}</h3>
                  </div>
                  <span
                    className={`px-2 py-1 leading-none rounded text-[10px] font-normal ${
                      plan.status === "active"
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : "bg-gray-100 text-gray-600 border border-gray-200"
                    }`}
                  >
                    {plan.status === "active" ? "Activ" : "Inactiv"}
                  </span>
                </div>

                <p className="text-xs text-gray-500 min-h-[32px] line-clamp-2 mb-4 leading-relaxed">
                  {plan.description}
                </p>

                {/* Price */}
                <div className="pb-4 mb-4 border-b border-gray-100">
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-normal tabular-nums text-gray-900">{plan.priceMonthly}</span>
                    <span className="text-xs font-normal text-gray-600">{plan.currency} / lună</span>
                  </div>
                  <span className="text-[11px] font-normal tabular-nums text-gray-400 block mt-1">
                    {plan.priceAnnual} {plan.currency} / an (facturare anuală)
                  </span>
                </div>

                {/* Resource Quotas Breakdown */}
                <div className="space-y-2 text-xs mb-5">
                  <div className="flex items-center justify-between text-gray-600">
                    <span className="flex items-center gap-2 font-semibold text-gray-600">
                      <Users size={13} className="text-gray-400" />
                      Brokeri / Agenți:
                    </span>
                    <span className="font-normal tabular-nums text-gray-900">
                      {plan.quotas.maxAgents === -1 ? "Nelimitați" : plan.quotas.maxAgents}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-gray-600">
                    <span className="flex items-center gap-2 font-semibold text-gray-600">
                      <Home size={13} className="text-gray-400" />
                      Proprietăți Portofoliu:
                    </span>
                    <span className="font-normal tabular-nums text-gray-900">
                      {plan.quotas.maxProperties === -1 ? "Nelimitate" : plan.quotas.maxProperties}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-gray-600">
                    <span className="flex items-center gap-2 font-semibold text-gray-600">
                      <FileText size={13} className="text-gray-400" />
                      Lead-uri & Cereri:
                    </span>
                    <span className="font-normal tabular-nums text-gray-900">
                      {plan.quotas.maxLeads === -1 ? "Nelimitate" : plan.quotas.maxLeads}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-gray-600">
                    <span className="flex items-center gap-2 font-semibold text-gray-600">
                      <Cpu size={13} className="text-gray-400" />
                      Alocare Tokeni AI:
                    </span>
                    <span className="font-normal tabular-nums text-gray-900">
                      {plan.quotas.monthlyAiTokens.toLocaleString()} / lună
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-gray-600">
                    <span className="flex items-center gap-2 font-semibold text-gray-600">
                      <HardDrive size={13} className="text-gray-400" />
                      Stocare Documente:
                    </span>
                    <span className="font-normal tabular-nums text-gray-900">
                      {plan.quotas.storageMb >= 1024
                        ? `${(plan.quotas.storageMb / 1024).toFixed(0)} GB`
                        : `${plan.quotas.storageMb} MB`}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-gray-600 pt-1">
                    <span className="flex items-center gap-2 font-semibold text-gray-600">
                      <Layers size={13} className="text-gray-400" />
                      Module Incluse:
                    </span>
                    <span className="font-normal text-indigo-600 font-sans tabular-nums text-[11px]">
                      {plan.includedModules.length} module
                    </span>
                  </div>
                </div>

                {/* Card Actions */}
                <div className="flex items-center justify-between pt-3 border-t border-gray-100 text-xs">
                  <button
                    onClick={() => {
                      setEditingPlan({ ...plan });
                      setIsModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1 font-semibold text-gray-600 hover:text-gray-900"
                  >
                    <Edit2 size={12} />
                    <span>Editează</span>
                  </button>

                  <button
                    onClick={() => handleToggleStatus(plan.id, plan.status)}
                    className={`font-semibold ${
                      plan.status === "active"
                        ? "text-rose-600 hover:text-rose-800"
                        : "text-emerald-600 hover:text-emerald-800"
                    }`}
                  >
                    {plan.status === "active" ? "Dezactivează" : "Activează"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Edit / Create Modal */}
        {isModalOpen && editingPlan && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-2xs flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between pb-3 border-b border-gray-200">
                <h3 className="font-title text-sm font-semibold text-gray-900">
                  {plans.some((p) => p.id === editingPlan.id) ? "Editare Plan Tarifar" : "Creare Plan Nou"}
                </h3>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="text-gray-400 hover:text-gray-600 p-1"
                >
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={handleSavePlan} className="space-y-4 text-xs font-sans">
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">Identificator Plan (ID)</label>
                  <input
                    type="text"
                    disabled={plans.some((p) => p.id === editingPlan.id)}
                    value={editingPlan.id || ""}
                    onChange={(e) => setEditingPlan({ ...editingPlan, id: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded font-sans font-normal text-xs focus:ring-1 focus:ring-indigo-500"
                    required
                  />
                </div>

                <div>
                  <label className="block font-semibold text-gray-700 mb-1">Denumire Publică</label>
                  <input
                    type="text"
                    value={editingPlan.displayName || ""}
                    onChange={(e) => setEditingPlan({ ...editingPlan, displayName: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-xs font-normal focus:ring-1 focus:ring-indigo-500"
                    required
                  />
                </div>

                <div>
                  <label className="block font-semibold text-gray-700 mb-1">Descriere Pachet</label>
                  <textarea
                    rows={2}
                    value={editingPlan.description || ""}
                    onChange={(e) => setEditingPlan({ ...editingPlan, description: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-xs font-normal focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block font-semibold text-gray-700 mb-1">Preț Lunar (RON)</label>
                    <input
                      type="number"
                      min={0}
                      value={editingPlan.priceMonthly ?? 0}
                      onChange={(e) => setEditingPlan({ ...editingPlan, priceMonthly: Number(e.target.value) })}
                      className="w-full px-3 py-2 border border-gray-300 rounded text-xs font-normal tabular-nums"
                      required
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-gray-700 mb-1">Preț Anual (RON)</label>
                    <input
                      type="number"
                      min={0}
                      value={editingPlan.priceAnnual ?? 0}
                      onChange={(e) => setEditingPlan({ ...editingPlan, priceAnnual: Number(e.target.value) })}
                      className="w-full px-3 py-2 border border-gray-300 rounded text-xs font-normal tabular-nums"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block font-semibold text-gray-700 mb-1">Max Brokeri (-1 nelimitat)</label>
                    <input
                      type="number"
                      value={editingPlan.quotas?.maxAgents ?? 5}
                      onChange={(e) =>
                        setEditingPlan({
                          ...editingPlan,
                          quotas: { ...editingPlan.quotas!, maxAgents: Number(e.target.value) },
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded text-xs font-normal tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-gray-700 mb-1">Max Proprietăți (-1)</label>
                    <input
                      type="number"
                      value={editingPlan.quotas?.maxProperties ?? 200}
                      onChange={(e) =>
                        setEditingPlan({
                          ...editingPlan,
                          quotas: { ...editingPlan.quotas!, maxProperties: Number(e.target.value) },
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded text-xs font-normal tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-gray-700 mb-1">Tokeni AI Lunar</label>
                    <input
                      type="number"
                      value={editingPlan.quotas?.monthlyAiTokens ?? 500000}
                      onChange={(e) =>
                        setEditingPlan({
                          ...editingPlan,
                          quotas: { ...editingPlan.quotas!, monthlyAiTokens: Number(e.target.value) },
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded text-xs font-normal tabular-nums"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-4 pt-4 border-t border-gray-200">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-3 py-2 border border-gray-300 text-gray-700 font-semibold rounded hover:bg-gray-50"
                  >
                    Anulează
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="px-4 py-2 bg-[#051D35] text-white font-semibold rounded hover:bg-[#051D35]/90 disabled:opacity-50"
                  >
                    {isSaving ? "Se salvează..." : "Salvează Plan"}
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
