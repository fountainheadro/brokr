import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  CreditCard,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Layers,
  Sparkles,
  Zap,
  Users,
  Home,
  FileText,
  Cpu,
  HardDrive,
  RefreshCw,
  ExternalLink,
  ChevronRight,
} from "lucide-react";
import { useTenantContext } from "../../core/tenancy/ctx_tenant";
import { useAuth } from "../../core/auth/ctx_auth";
import { TenantEffectiveEntitlements } from "../../core/subscription/typ_subscription";
import { CmpAgencyAdminLayout } from "../../ui/agency/cmp_agency-admin-layout";

export const PgAgencyAdminSubscription: React.FC = () => {
  const { tenant, tenantContext } = useTenantContext();
  const { user } = useAuth();

  const [entitlements, setEntitlements] = useState<TenantEffectiveEntitlements | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Upgrade modal / state
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState<boolean>(false);
  const [selectedPlanToUpgrade, setSelectedPlanToUpgrade] = useState<string>("plan_professional");
  const [isCheckingOut, setIsCheckingOut] = useState<boolean>(false);

  async function fetchSubscription() {
    setIsLoading(true);
    setError(null);
    try {
      const token = await user?.getIdToken();
      const previewToken = localStorage.getItem("brokr_preview_token") || "";
      const res = await fetch("/api/tenant/subscription", {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(previewToken ? { "x-preview-token": previewToken } : {}),
        },
      });

      const json = await res.json();
      if (json.success) {
        setEntitlements(json.data);
      } else {
        setError(json.error?.message || "Eroare la încărcarea detaliilor abonamentului.");
      }
    } catch (err: any) {
      setError(err?.message || "Eroare de conexiune.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchSubscription();
  }, [tenant, user]);

  async function handleInitiateCheckout() {
    setIsCheckingOut(true);
    try {
      const token = await user?.getIdToken();
      const previewToken = localStorage.getItem("brokr_preview_token") || "";
      const res = await fetch("/api/tenant/subscription/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(previewToken ? { "x-preview-token": previewToken } : {}),
        },
        body: JSON.stringify({
          planId: selectedPlanToUpgrade,
          billingInterval: "month",
        }),
      });

      const json = await res.json();
      if (json.success && json.data?.checkoutUrl) {
        // In simulation/mock mode or Stripe mode, redirect to checkout session URL
        window.location.href = json.data.checkoutUrl;
      } else {
        setIsUpgradeModalOpen(false);
        setError(json.error?.message || "Eroare la inițierea procesului de facturare.");
      }
    } catch (err: any) {
      setIsUpgradeModalOpen(false);
      setError(err?.message || "Eroare de conexiune la checkout.");
    } finally {
      setIsCheckingOut(false);
    }
  }

  function renderProgressBar(current: number, max: number | null, unit = "") {
    if (max === null || max === -1) {
      return (
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="font-normal text-gray-900">{current.toLocaleString()} {unit}</span>
            <span className="text-gray-400 font-normal">Nelimitat</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
            <div className="bg-emerald-500 h-full rounded-full" style={{ width: "15%" }} />
          </div>
        </div>
      );
    }

    const percent = Math.min(100, Math.round((current / max) * 100));
    const isCritical = percent >= 95;
    const isWarning = percent >= 85;

    return (
      <div className="space-y-1">
        <div className="flex justify-between text-xs">
          <span className="font-normal text-gray-900">
            {current.toLocaleString()} / {max.toLocaleString()} {unit}
          </span>
          <span className={`font-normal ${isCritical ? "text-rose-600" : isWarning ? "text-amber-600" : "text-gray-500"}`}>
            {percent}%
          </span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              isCritical ? "bg-rose-500" : isWarning ? "bg-amber-500" : "bg-[#051D35]"
            }`}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <CmpAgencyAdminLayout title="Abonament & Cote Agenție">
      <div className="max-w-5xl w-full mx-auto space-y-4">
        {/* Loading / Error states */}
        {isLoading ? (
          <div className="p-16 text-center text-xs text-gray-400">Se încarcă detaliile abonamentului...</div>
        ) : error ? (
          <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg">{error}</div>
        ) : entitlements ? (
          <>
            {/* Top Warnings if any */}
            {entitlements.warnings.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-2">
                <div className="flex items-center gap-2 text-amber-900 font-semibold text-xs">
                  <AlertTriangle size={15} className="text-amber-600" />
                  <span>Atenție: Una sau mai multe cote de utilizare sunt aproape de limită</span>
                </div>
                <ul className="list-disc list-inside text-xs text-amber-800 space-y-1 pl-1">
                  {entitlements.warnings.map((w, idx) => (
                    <li key={idx}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Plan Overview Card */}
            <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-2xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-gray-100">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                      Plan Activ
                    </span>
                    <span
                      className={`px-2 py-1 leading-none rounded text-[10px] font-normal ${
                        entitlements.subscriptionStatus === "active"
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : entitlements.subscriptionStatus === "trialing"
                          ? "bg-blue-50 text-blue-700 border border-blue-200"
                          : "bg-amber-50 text-amber-700 border border-amber-200"
                      }`}
                    >
                      {entitlements.subscriptionStatus === "active" && "Activ"}
                      {entitlements.subscriptionStatus === "trialing" && `Perioadă de probă (${entitlements.daysRemainingInTrial} zile rămase)`}
                      {entitlements.subscriptionStatus === "past_due" && "Plată restantă (În perioadă de grație)"}
                      {entitlements.subscriptionStatus === "suspended" && "Suspendat"}
                    </span>
                  </div>
                  <h2 className="font-title text-xl font-semibold text-gray-900">{entitlements.planDisplayName}</h2>
                  <p className="text-xs text-gray-500 mt-1 font-normal">
                    Scadență următoare: {new Date(entitlements.currentPeriodEnd).toLocaleDateString("ro-RO")} (facturare lunară)
                  </p>
                </div>

                <div className="flex items-center gap-4">
                  <button
                    onClick={() => setIsUpgradeModalOpen(true)}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-[#051D35] hover:bg-[#051D35]/90 text-white text-xs font-semibold rounded shadow-2xs transition-colors"
                  >
                    <Sparkles size={14} className="text-[#BE9662]" />
                    <span>Schimbă sau Extinde Planul</span>
                  </button>
                </div>
              </div>

              {/* Resource Quotas Grid */}
              <div className="pt-6">
                <h3 className="font-title text-xs font-semibold text-gray-900 uppercase tracking-wider mb-4">
                  Cote și Utilizare Resurse
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Agents */}
                  <div className="p-4 bg-gray-50/70 border border-gray-200 rounded-lg space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-gray-800">
                      <Users size={14} className="text-indigo-600" />
                      <span>Conturi Brokeri / Agenți</span>
                    </div>
                    {renderProgressBar(entitlements.currentUsage.agents, entitlements.effectiveQuotas.maxAgents, "utilizatori")}
                  </div>

                  {/* Properties */}
                  <div className="p-4 bg-gray-50/70 border border-gray-200 rounded-lg space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-gray-800">
                      <Home size={14} className="text-indigo-600" />
                      <span>Proprietăți Active Portofoliu</span>
                    </div>
                    {renderProgressBar(entitlements.currentUsage.properties, entitlements.effectiveQuotas.maxProperties, "imobile")}
                  </div>

                  {/* Leads */}
                  <div className="p-4 bg-gray-50/70 border border-gray-200 rounded-lg space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-gray-800">
                      <FileText size={14} className="text-indigo-600" />
                      <span>Lead-uri & Cereri</span>
                    </div>
                    {renderProgressBar(entitlements.currentUsage.leads, entitlements.effectiveQuotas.maxLeads, "contacte")}
                  </div>

                  {/* AI Tokens */}
                  <div className="p-4 bg-gray-50/70 border border-gray-200 rounded-lg space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-gray-800">
                      <Cpu size={14} className="text-indigo-600" />
                      <span>Tokeni AI Consumați Lunar</span>
                    </div>
                    {renderProgressBar(entitlements.currentUsage.aiTokens, entitlements.effectiveQuotas.monthlyAiTokens, "tokeni")}
                  </div>

                  {/* AI Requests */}
                  <div className="p-4 bg-gray-50/70 border border-gray-200 rounded-lg space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-gray-800">
                      <Zap size={14} className="text-indigo-600" />
                      <span>Apeluri AI / Extracții</span>
                    </div>
                    {renderProgressBar(entitlements.currentUsage.aiRequests, entitlements.effectiveQuotas.monthlyAiRequests, "operațiuni")}
                  </div>

                  {/* Storage */}
                  <div className="p-4 bg-gray-50/70 border border-gray-200 rounded-lg space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-gray-800">
                      <HardDrive size={14} className="text-indigo-600" />
                      <span>Stocare Documente & Foto</span>
                    </div>
                    {renderProgressBar(entitlements.currentUsage.storageMb, entitlements.effectiveQuotas.storageMb, "MB")}
                  </div>
                </div>
              </div>
            </div>

            {/* Included Modules Grid */}
            <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-2xs space-y-4">
              <h3 className="font-title text-xs font-semibold text-gray-900 uppercase tracking-wider">
                Module Funcționale Incluse în Abonament
              </h3>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 text-xs">
                {entitlements.effectiveModules.map((m) => (
                  <div
                    key={m}
                    className="p-3 bg-emerald-50/50 border border-emerald-200 rounded-md flex items-center gap-2 text-emerald-950 font-normal"
                  >
                    <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
                    <span className="font-sans text-[11px] truncate">{m}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : null}

        {/* Upgrade Modal */}
        {isUpgradeModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-2xs flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 space-y-4">
              <h3 className="font-title text-sm font-semibold text-gray-900">Actualizare Plan Tarifar Agenție</h3>
              <p className="text-xs text-gray-500">
                Alegeți planul dorit. Veți fi redirecționat către sesiunea securizată de checkout.
              </p>

              <div className="space-y-4">
                <label className="block p-3 border rounded-lg cursor-pointer hover:border-indigo-500 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="plan"
                        value="plan_professional"
                        checked={selectedPlanToUpgrade === "plan_professional"}
                        onChange={() => setSelectedPlanToUpgrade("plan_professional")}
                      />
                      <span className="text-xs font-semibold text-gray-900">Professional Agency</span>
                    </div>
                    <span className="text-xs font-normal text-indigo-600">499 RON / lună</span>
                  </div>
                  <span className="text-[11px] text-gray-500 font-normal block ml-5 mt-1">
                    10 brokeri, 800 proprietăți, 1M tokeni AI, modul matching și documente incluse.
                  </span>
                </label>

                <label className="block p-3 border rounded-lg cursor-pointer hover:border-indigo-500 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="plan"
                        value="plan_enterprise"
                        checked={selectedPlanToUpgrade === "plan_enterprise"}
                        onChange={() => setSelectedPlanToUpgrade("plan_enterprise")}
                      />
                      <span className="text-xs font-semibold text-gray-900">Enterprise Cloud</span>
                    </div>
                    <span className="text-xs font-normal text-indigo-600">999 RON / lună</span>
                  </div>
                  <span className="text-[11px] text-gray-500 font-normal block ml-5 mt-1">
                    Brokeri nelimitați, portofoliu nelimitat, 5M tokeni AI, modul asistent vocal AI.
                  </span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-4 pt-3 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => setIsUpgradeModalOpen(false)}
                  className="px-3 py-2 border border-gray-300 text-gray-700 text-xs font-semibold rounded hover:bg-gray-50"
                >
                  Anulează
                </button>
                <button
                  type="button"
                  disabled={isCheckingOut}
                  onClick={handleInitiateCheckout}
                  className="px-4 py-2 bg-[#051D35] text-white text-xs font-semibold rounded hover:bg-[#051D35]/90 disabled:opacity-50"
                >
                  {isCheckingOut ? "Se inițiază..." : "Continuă către Checkout"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </CmpAgencyAdminLayout>
  );
};
