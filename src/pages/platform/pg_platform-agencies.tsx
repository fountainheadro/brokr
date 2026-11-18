import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Building2,
  Search,
  Filter,
  Eye,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Unlock,
  ExternalLink,
} from "lucide-react";
import { CmpPlatformLayout } from "../../ui/platform/cmp_platform-layout";
import { AtmPlatformBadge, PlatformTenantStatus } from "../../ui/atoms/platform/atm_platform-badge";
import { OrgModalBase } from "../../ui/organisms/common/org_modal-base";
import { useAuth } from "../../core/auth/ctx_auth";
import { VirtualizedTbody } from "../../components/VirtualizedList";

export const PgPlatformAgencies: React.FC = () => {
  const { user } = useAuth();
  const [agencies, setAgencies] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Status mutation modal state
  const [selectedAgency, setSelectedAgency] = useState<any | null>(null);
  const [statusAction, setStatusAction] = useState<"suspend" | "activate" | null>(null);
  const [statusReason, setStatusReason] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  async function loadAgencies() {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      let url = "/api/platform/agencies?";
      if (searchQuery) url += `q=${encodeURIComponent(searchQuery)}&`;
      if (statusFilter !== "all") url += `status=${encodeURIComponent(statusFilter)}`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success) setAgencies(json.data);
      }
    } catch (err) {
      console.error("Error loading agencies:", err);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadAgencies();
  }, [user, searchQuery, statusFilter]);

  const handleUpdateStatus = async () => {
    if (!selectedAgency || !statusAction || !user) return;
    setIsSubmitting(true);
    try {
      const token = await user.getIdToken();
      const targetStatus: PlatformTenantStatus = statusAction === "suspend" ? "suspended" : "active";

      const res = await fetch(`/api/platform/agencies/${selectedAgency.id}/status`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: targetStatus,
          reason: statusReason || `Acțiune executată din panoul Super Admin de ${user.email}`,
        }),
      });

      if (res.ok) {
        await loadAgencies();
        setSelectedAgency(null);
        setStatusAction(null);
        setStatusReason("");
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err?.error?.message || "Eroare la modificarea statusului agenției.");
      }
    } catch (err: any) {
      alert(err?.message || "Eroare de comunicare.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <CmpPlatformLayout title="Gestiune Agenții Platformă">
      <div className="space-y-4">
        {/* Filters and Search Bar */}
        <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
          <div className="relative w-full sm:w-80">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Caută după nume, subdomeniu sau ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-md focus:outline-none focus:border-indigo-500 font-sans font-normal text-xs"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
            {["all", "active", "trial", "suspended"].map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer capitalize ${
                  statusFilter === st
                    ? "bg-[#051D35] text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {st === "all" ? "Toate" : st}
              </button>
            ))}
          </div>
        </div>

        {/* Agencies Table */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-2xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 font-semibold uppercase tracking-wider text-[10px] select-none">
                <tr>
                  <th className="py-3 px-4 font-semibold">Agenție</th>
                  <th className="py-3 px-4 font-semibold">Subdomeniu / Domeniu</th>
                  <th className="py-3 px-4 font-semibold">Status</th>
                  <th className="py-3 px-4 font-semibold">Plan Tarifar</th>
                  <th className="py-3 px-4 font-semibold">Utilizatori</th>
                  <th className="py-3 px-4 font-semibold">Note</th>
                  <th className="py-3 px-4 text-right font-semibold">Acțiuni</th>
                </tr>
              </thead>
              {isLoading ? (
                <tbody className="divide-y divide-gray-100 text-gray-700">
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-gray-400">
                      Se încarcă lista agențiilor...
                    </td>
                  </tr>
                </tbody>
              ) : agencies.length === 0 ? (
                <tbody className="divide-y divide-gray-100 text-gray-700">
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-gray-400">
                      Nicio agenție găsită conform filtrelor selectate.
                    </td>
                  </tr>
                </tbody>
              ) : (
                <VirtualizedTbody
                  items={agencies}
                  colSpan={7}
                  estimateRowHeight={56}
                  getItemKey={(agency) => agency.id}
                  className="divide-y divide-gray-100 text-gray-700"
                  renderRow={(agency, _idx, rowRef) => (
                    <tr ref={rowRef} className="hover:bg-gray-50/70 transition-colors">
                      <td className="py-3 px-4 font-normal text-gray-900">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded bg-[#051D35] text-white flex items-center justify-center font-semibold text-xs shrink-0">
                            {agency.name.charAt(0)}
                          </div>
                          <div>
                            <p className="truncate max-w-xs font-normal">{agency.name}</p>
                            <span className="text-[10px] text-gray-400 font-sans font-normal block">{agency.id}</span>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-4 font-sans font-normal text-[11px] text-gray-600">
                        <div>
                          <span>{agency.subdomain}.[subdomeniu]</span>
                          {agency.customDomain && (
                            <span className="block text-[10px] text-indigo-600">{agency.customDomain}</span>
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <AtmPlatformBadge status={agency.status} />
                      </td>

                      <td className="py-3 px-4">
                        <span className="inline-block px-2 py-1 leading-none rounded text-[10px] font-normal bg-gray-100 text-gray-700">
                          {agency.planId === "plan_enterprise"
                            ? "Enterprise"
                            : agency.planId === "plan_professional"
                            ? "Professional"
                            : "Starter"}
                        </span>
                      </td>

                      <td className="py-3 px-4 font-normal tabular-nums">
                        {agency.activeMembersCount || 0} activi / {agency.membersCount || 0} total
                      </td>

                      <td className="py-3 px-4 text-gray-500 font-normal tabular-nums">
                        {agency.notesCount > 0 ? (
                          <span className="text-amber-700 font-normal">{agency.notesCount} note</span>
                        ) : (
                          "—"
                        )}
                      </td>

                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            to={`/platform/agencies/${agency.id}`}
                            className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                            title="Inspectează detalii"
                          >
                            <Eye size={15} />
                          </Link>

                          {agency.status === "suspended" ? (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedAgency(agency);
                                setStatusAction("activate");
                              }}
                              className="p-2 text-emerald-600 hover:bg-emerald-50 rounded transition-colors"
                              title="Reactivează agenția"
                            >
                              <Unlock size={15} />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedAgency(agency);
                                setStatusAction("suspend");
                              }}
                              className="p-2 text-red-500 hover:bg-red-50 rounded transition-colors"
                              title="Suspendă agenția"
                            >
                              <Lock size={15} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                />
              )}
            </table>
          </div>
        </div>
      </div>

      {/* Confirmation Modal for Status Updates */}
      {selectedAgency && statusAction && (
        <OrgModalBase
          isOpen={true}
          onClose={() => {
            setSelectedAgency(null);
            setStatusAction(null);
          }}
          title={statusAction === "suspend" ? "Suspendare Agenție" : "Reactivare Agenție"}
          size="md"
          footer={
            <div className="flex items-center justify-end gap-4 w-full">
              <button
                type="button"
                onClick={() => {
                  setSelectedAgency(null);
                  setStatusAction(null);
                }}
                disabled={isSubmitting}
                className="px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
              >
                Anulează
              </button>
              <button
                type="button"
                onClick={handleUpdateStatus}
                disabled={isSubmitting}
                className={`px-3 py-2 text-xs font-semibold text-white rounded-md transition-colors ${
                  statusAction === "suspend"
                    ? "bg-red-600 hover:bg-red-700"
                    : "bg-emerald-600 hover:bg-emerald-700"
                }`}
              >
                {isSubmitting
                  ? "Se procesează..."
                  : statusAction === "suspend"
                  ? "Confirmă Suspendarea"
                  : "Confirmă Reactivarea"}
              </button>
            </div>
          }
        >
          <div className="space-y-4 text-xs">
            <p className="text-gray-600 leading-relaxed">
              Sunteți pe cale să {statusAction === "suspend" ? "suspendați" : "reactivați"} agenția{" "}
              <strong className="font-semibold text-gray-900">{selectedAgency.name}</strong> ({selectedAgency.id}).
            </p>

            {statusAction === "suspend" && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-md text-red-800 text-[11px] leading-relaxed">
                Suspendarea va bloca accesul imediat la CRM pentru toți membrii acestei agenții. Datele
                operaționale ale agenției <strong className="font-semibold">nu vor fi șterse</strong>.
              </div>
            )}

            <div>
              <label className="block font-semibold text-gray-800 mb-1">
                Motivul modificării (obligatoriu pentru jurnalul de audit):
              </label>
              <textarea
                rows={3}
                placeholder="Specificați motivul administrativ..."
                value={statusReason}
                onChange={(e) => setStatusReason(e.target.value)}
                className="w-full p-2 border border-gray-200 rounded-md focus:outline-none focus:border-indigo-500 font-sans font-normal text-xs"
              />
            </div>
          </div>
        </OrgModalBase>
      )}
    </CmpPlatformLayout>
  );
};
