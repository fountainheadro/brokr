import React, { useEffect, useState } from "react";
import { WalletCards, ShieldCheck, CheckCircle2, AlertCircle, RefreshCw, Clock, ArrowUpRight } from "lucide-react";
import { CmpPlatformLayout } from "../../ui/platform/cmp_platform-layout";
import { useAuth } from "../../core/auth/ctx_auth";
import { VirtualizedTbody } from "../../components/VirtualizedList";

interface BillingStatusResponse {
  providerStatus: {
    activeProvider: "mock" | "stripe" | "netopia";
    stripeConfigured: boolean;
    isDevelopmentMode: boolean;
  };
  eventLogs: Array<{
    id: string;
    provider: string;
    eventType: string;
    tenantId?: string;
    status: string;
    details?: Record<string, any>;
    receivedAt: string;
  }>;
}

export const PgPlatformBilling: React.FC = () => {
  const { user } = useAuth();
  const [data, setData] = useState<BillingStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchBillingStatus() {
    setIsLoading(true);
    setError(null);
    try {
      const token = await user?.getIdToken();
      const res = await fetch("/api/platform/billing/status", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      } else {
        setError(json.error?.message || "Eroare la încărcarea stării de facturare.");
      }
    } catch (err: any) {
      setError(err?.message || "Eroare de conexiune.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchBillingStatus();
  }, [user]);

  return (
    <CmpPlatformLayout title="Facturare & Furnizori de Plată">
      <div className="space-y-4">
        {/* Top Info Banner */}
        <div className="bg-white p-5 border border-gray-200 rounded-lg shadow-2xs space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-title text-base font-semibold text-gray-900">Arhitectură Furnizori de Plată (SaaS Billing)</h2>
            <button
              onClick={fetchBillingStatus}
              className="inline-flex items-center gap-2 px-3 py-1 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded transition-colors"
            >
              <RefreshCw size={12} />
              <span>Actualizează</span>
            </button>
          </div>
          <p className="text-xs text-gray-500 leading-relaxed">
            Sistemul utilizează un model decuplat de tip Provider Adapter. Plățile recurente pentru abonamentele agențiilor
            sunt gestionate prin checkout extern și webhook-uri securizate cu verificare a semnăturii HMAC și protecție la re-procesare (idempotency).
          </p>
        </div>

        {/* Provider Status Cards */}
        {data && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Active Provider Card */}
            <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-2xs space-y-3">
              <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block">
                Furnizor Activ În Sistem
              </span>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-title text-lg font-semibold text-gray-900 capitalize">
                    {data.providerStatus.activeProvider === "mock"
                      ? "Simulator Plăți (Mock Billing Adapter)"
                      : "Stripe Billing (Producție)"}
                  </h3>
                  <span className="text-xs text-gray-500 font-normal">
                    {data.providerStatus.isDevelopmentMode
                      ? "Mediu de simulare sigur (nu se efectuează tranzacții bancare reale)"
                      : "Tranzacționare activă securizată"}
                  </span>
                </div>
                <span
                  className={`px-3 py-1 rounded text-xs font-normal ${
                    data.providerStatus.isDevelopmentMode
                      ? "bg-amber-50 text-amber-800 border border-amber-200"
                      : "bg-emerald-50 text-emerald-800 border border-emerald-200"
                  }`}
                >
                  {data.providerStatus.isDevelopmentMode ? "Mock / Dev" : "Producție"}
                </span>
              </div>
            </div>

            {/* Provider Readiness Card */}
            <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-2xs space-y-3">
              <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block">
                Stare Conectori & Secrete
              </span>
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-gray-600">Adaptor Stripe Billing:</span>
                  <span
                    className={`font-normal flex items-center gap-1 ${
                      data.providerStatus.stripeConfigured ? "text-emerald-700" : "text-gray-400"
                    }`}
                  >
                    {data.providerStatus.stripeConfigured ? (
                      <>
                        <CheckCircle2 size={13} /> Configurat (STRIPE_SECRET_KEY activ)
                      </>
                    ) : (
                      "Neconfigurat (implicit Mock)"
                    )}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-gray-600">Endpoint Webhook:</span>
                  <span className="font-sans font-normal text-[11px] text-gray-800 bg-gray-100 px-2 py-1 leading-none rounded">
                    POST /api/billing/webhook
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-gray-600">Idempotență & Replay Protection:</span>
                  <span className="text-emerald-700 font-normal flex items-center gap-1">
                    <CheckCircle2 size={13} /> Activă (filtrare evenimente duplicate)
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Webhook Events History */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-2xs space-y-3">
          <div className="p-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-title text-sm font-semibold text-gray-900">Jurnal Evenimente Facturare & Webhook-uri</h3>
            <span className="text-xs text-gray-400 font-sans font-normal tabular-nums">
              <span className="font-semibold">Total recepționate:</span> {data?.eventLogs?.length ?? 0}
            </span>
          </div>

          {isLoading ? (
            <div className="p-12 text-center text-xs text-gray-400">Se încarcă istoricul...</div>
          ) : error ? (
            <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 text-xs">{error}</div>
          ) : !data || data.eventLogs.length === 0 ? (
            <div className="p-8 text-center text-xs text-gray-400">
              Nu s-au înregistrat încă evenimente de facturare sau webhook-uri primite.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-[11px] font-semibold text-gray-600 uppercase tracking-wider">
                    <th className="py-3 px-4">ID Eveniment</th>
                    <th className="py-3 px-4">Tip Eveniment</th>
                    <th className="py-3 px-4">Furnizor</th>
                    <th className="py-3 px-4">Agenție / Tenant</th>
                    <th className="py-3 px-4">Stare Procesare</th>
                    <th className="py-3 px-4">Data & Ora</th>
                  </tr>
                </thead>
                <VirtualizedTbody
                  items={data.eventLogs}
                  colSpan={6}
                  estimateRowHeight={44}
                  getItemKey={(evt, idx) => `${evt.id}_${idx}`}
                  className="divide-y divide-gray-100 font-sans font-normal"
                  renderRow={(evt, _idx, rowRef) => (
                    <tr ref={rowRef} className="hover:bg-gray-50/70">
                      <td className="py-3 px-4 font-sans text-[11px] text-gray-600">{evt.id}</td>
                      <td className="py-3 px-4 font-normal text-gray-900">{evt.eventType}</td>
                      <td className="py-3 px-4 uppercase font-normal text-[10px] text-gray-500">
                        {evt.provider}
                      </td>
                      <td className="py-3 px-4 font-sans text-[11px] text-gray-700">
                        {evt.tenantId || "—"}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-1 leading-none rounded text-[10px] font-normal ${
                            evt.status === "processed"
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : evt.status === "duplicate"
                              ? "bg-amber-50 text-amber-700 border border-amber-200"
                              : "bg-rose-50 text-rose-700 border border-rose-200"
                          }`}
                        >
                          {evt.status === "processed" && "Procesat cu succes"}
                          {evt.status === "duplicate" && "Duplicat (Ignorat)"}
                          {evt.status === "failed" && "Eșuat"}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-gray-400 text-[11px] tabular-nums">
                        {new Date(evt.receivedAt).toLocaleString("ro-RO")}
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
