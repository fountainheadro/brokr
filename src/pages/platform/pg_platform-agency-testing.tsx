import React, { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  FlaskConical,
  Search,
  Building2,
  Users,
  CreditCard,
  PlayCircle,
  Crown,
  Briefcase,
  History,
  CheckCircle2,
  ArrowRight,
  ShieldCheck,
  AlertCircle,
  Loader2,
  Globe,
  Sparkles
} from "lucide-react";
import { CmpPlatformLayout } from "../../ui/platform/cmp_platform-layout";
import { useTenantContext } from "../../core/tenancy/ctx_tenant";
import { UserRole } from "../../core/tenancy/typ_tenant-context";
import { useAuth } from "../../core/auth/ctx_auth";
import { VirtualizedStack } from "../../components/VirtualizedList";

interface AgencyTestingTarget {
  id: string;
  name: string;
  subdomain: string;
  status: string;
  planId: string;
  planDisplayName: string;
  membersCount: number;
  enabledModulesCount: number;
  branding: {
    primaryColor?: string;
    accentColor?: string;
  };
}

export const PgPlatformAgencyTesting: React.FC = () => {
  const navigate = useNavigate();
  const { startPreview } = useTenantContext();
  const { user } = useAuth();

  const [targets, setTargets] = useState<AgencyTestingTarget[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [startingTenantId, setStartingTenantId] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<UserRole>("agency_admin");
  const [selectedDestination, setSelectedDestination] = useState<"crm" | "admin">("crm");

  // Recently tested agencies stored in localStorage
  const [recentAgencies, setRecentAgencies] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("brokr_recent_test_agencies");
      return stored ? JSON.parse(stored) : ["ten_brokr_default", "ten_agency_a"];
    } catch {
      return ["ten_brokr_default", "ten_agency_a"];
    }
  });

  useEffect(() => {
    async function loadTargets() {
      if (!user) return;
      setIsLoading(true);
      setError(null);
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/platform/preview/targets", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson?.error?.message || "Eroare la încărcarea listei de agenții pentru testare.");
        }
        const json = await res.json();
        if (json.success && json.data) {
          setTargets(json.data);
        }
      } catch (err: any) {
        setError(err?.message || "Eroare de conexiune la server.");
      } finally {
        setIsLoading(false);
      }
    }

    loadTargets();
  }, [user]);

  const handleStartTest = async (agency: AgencyTestingTarget, role: UserRole, dest: "crm" | "admin") => {
    try {
      setStartingTenantId(agency.id);
      await startPreview(agency.id, role);

      // Save to recent tested agencies
      const updatedRecents = [agency.id, ...recentAgencies.filter((id) => id !== agency.id)].slice(0, 5);
      setRecentAgencies(updatedRecents);
      localStorage.setItem("brokr_recent_test_agencies", JSON.stringify(updatedRecents));

      if (dest === "admin") {
        navigate("/agency/admin");
      } else {
        navigate("/");
      }
    } catch (err: any) {
      setError(`Eroare la pornirea testării: ${err?.message || String(err)}`);
    } finally {
      setStartingTenantId(null);
    }
  };

  const filteredTargets = useMemo(() => {
    if (!searchQuery.trim()) return targets;
    const q = searchQuery.toLowerCase().trim();
    return targets.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.subdomain.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q) ||
        t.planDisplayName.toLowerCase().includes(q)
    );
  }, [targets, searchQuery]);

  const recentTargetObjects = useMemo(() => {
    return recentAgencies
      .map((id) => targets.find((t) => t.id === id))
      .filter((t): t is AgencyTestingTarget => Boolean(t));
  }, [recentAgencies, targets]);

  return (
    <CmpPlatformLayout title="Testare Agenții (Agency Preview Mode)">
      <div className="max-w-6xl mx-auto space-y-4 font-sans">
        {/* Header Notice Banner */}
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200/80 rounded-xl p-5 shadow-2xs">
          <div className="flex items-start gap-4">
            <div className="w-11 h-11 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-700 flex items-center justify-center shrink-0">
              <FlaskConical size={22} />
            </div>
            <div className="space-y-1">
              <h2 className="font-title text-sm font-semibold text-gray-900 flex items-center gap-2">
                <span>Mediu de Testare & Simulare Roluri Multi-Tenant</span>
                <span className="text-[10px] font-sans px-2 py-1 leading-none rounded bg-amber-100 text-amber-800 font-normal">
                  Faza 7 SaaS
                </span>
              </h2>
              <p className="text-xs text-gray-600 leading-relaxed max-w-3xl">
                Testați aplicația din perspectiva oricărei agenții înregistrate și comutați instantaneu între rolurile de{" "}
                <strong className="text-gray-900 font-semibold">Administrator</strong> și{" "}
                <strong className="text-gray-900 font-semibold">Agent / Broker</strong>, fără a fi nevoie să vă
                deconectați sau să modificați conturile utilizatorilor. Sesiunile de simulare sunt validate pe server și
                complet izolate.
              </p>
            </div>
          </div>
        </div>

        {/* Quick Access: Recently Tested Agencies */}
        {recentTargetObjects.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-title flex items-center gap-2 text-xs font-semibold text-gray-700 uppercase tracking-wider">
              <History size={14} className="text-[#BE9662]" />
              <span>Agenții Testate Recent (Acces Rapid)</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {recentTargetObjects.map((agency) => (
                <div
                  key={`recent-${agency.id}`}
                  className="bg-white border border-gray-200 hover:border-[#BE9662]/50 rounded-lg p-4 shadow-2xs flex items-center justify-between gap-4 transition-all"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: agency.branding?.primaryColor || "#051D35" }}
                      />
                      <span className="font-semibold text-xs text-gray-900 truncate">{agency.name}</span>
                    </div>
                    <div className="text-[10px] text-gray-500 font-sans font-normal mt-1">
                      {agency.subdomain}.ourcrm.com · {agency.planDisplayName}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleStartTest(agency, "agency_admin", "crm")}
                    disabled={startingTenantId === agency.id}
                    className="px-3 py-2 bg-[#051D35] hover:bg-[#051D35]/90 text-white rounded font-semibold text-[11px] flex items-center gap-1 shrink-0 transition-colors cursor-pointer"
                    title="Testează ca Administrator în CRM"
                  >
                    {startingTenantId === agency.id ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <PlayCircle size={12} />
                    )}
                    <span>Testează</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Main Agency Directory */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-2xs overflow-hidden">
          {/* Filter Bar */}
          <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gray-50/50">
            <div className="relative flex-1 max-w-md">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Caută agenție după nume, ID, subdomeniu sau plan..."
                className="w-full h-9 pl-9 pr-3 text-xs font-normal bg-white border border-gray-200 rounded-lg focus:outline-none focus:border-[#BE9662] transition-colors"
              />
            </div>

            <div className="text-xs text-gray-500 font-semibold">
              Total disponibile: <span className="text-gray-900 font-normal tabular-nums">{filteredTargets.length}</span> agenții
            </div>
          </div>

          {/* Table / Cards */}
          {isLoading ? (
            <div className="p-12 text-center text-xs text-gray-500 flex flex-col items-center justify-center">
              <Loader2 size={24} className="animate-spin text-[#BE9662] mb-2" />
              <span>Se încarcă catalogul de agenții...</span>
            </div>
          ) : error ? (
            <div className="p-8 text-center text-xs text-red-600 bg-red-50/50">
              <AlertCircle size={20} className="mx-auto mb-1" />
              <span>{error}</span>
            </div>
          ) : filteredTargets.length === 0 ? (
            <div className="p-12 text-center text-xs text-gray-400">
              Nicio agenție nu corespunde criteriilor de căutare.
            </div>
          ) : (
            <VirtualizedStack
              items={filteredTargets}
              getItemKey={(agency) => agency.id}
              estimateItemHeight={78}
              overscanRatio={0.5}
              className="divide-y divide-gray-100"
              renderItem={(agency, _idx, itemRef) => (
                <div
                  ref={itemRef}
                  className="p-4 hover:bg-gray-50/60 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  {/* Agency Identification */}
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-7 h-7 rounded bg-[#051D35] text-white flex items-center justify-center font-semibold text-xs shrink-0"
                        style={{ backgroundColor: agency.branding?.primaryColor || "#051D35" }}
                      >
                        {agency.name.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-title font-semibold text-xs text-gray-900 truncate">{agency.name}</h3>
                          <span
                            className={`px-2 py-1 leading-none rounded text-[10px] font-normal uppercase ${
                              agency.status === "active"
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                : agency.status === "trial"
                                ? "bg-indigo-50 text-indigo-700 border border-indigo-200"
                                : "bg-gray-100 text-gray-600 border border-gray-200"
                            }`}
                          >
                            {agency.status}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 text-[11px] text-gray-500 mt-1">
                          <span className="font-sans font-normal text-gray-600">{agency.id}</span>
                          <span>·</span>
                          <span className="flex items-center gap-1">
                            <Globe size={11} className="text-gray-400" />
                            <span className="font-sans font-normal">{agency.subdomain}.ourcrm.com</span>
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Metadata: Plan, Users, Modules */}
                  <div className="flex items-center gap-4 text-xs shrink-0">
                    <div className="text-left">
                      <span className="text-[10px] font-semibold text-gray-500 block">Plan Tarifar</span>
                      <span className="font-normal text-gray-800">{agency.planDisplayName}</span>
                    </div>

                    <div className="text-left">
                      <span className="text-[10px] font-semibold text-gray-500 block">Echipă</span>
                      <span className="font-normal tabular-nums text-gray-800">{agency.membersCount} utilizatori</span>
                    </div>

                    <div className="text-left">
                      <span className="text-[10px] font-semibold text-gray-500 block">Module Active</span>
                      <span className="font-normal tabular-nums text-gray-800">{agency.enabledModulesCount}</span>
                    </div>
                  </div>

                  {/* Actions: Test as Administrator or Agent */}
                  <div className="flex items-center gap-4 shrink-0">
                    {/* Launch into CRM as Administrator */}
                    <button
                      type="button"
                      onClick={() => handleStartTest(agency, "agency_admin", "crm")}
                      disabled={startingTenantId === agency.id}
                      className="px-3 py-2 bg-[#051D35] hover:bg-[#051D35]/90 text-white rounded font-semibold text-xs flex items-center gap-2 shadow-2xs transition-colors cursor-pointer"
                      title="Deschide CRM-ul agenției cu rol de Administrator"
                    >
                      {startingTenantId === agency.id ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Crown size={13} className="text-[#BE9662]" />
                      )}
                      <span>Testează ca Admin</span>
                    </button>

                    {/* Launch into CRM as Agent */}
                    <button
                      type="button"
                      onClick={() => handleStartTest(agency, "agent", "crm")}
                      disabled={startingTenantId === agency.id}
                      className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded font-semibold text-xs flex items-center gap-2 transition-colors cursor-pointer"
                      title="Deschide CRM-ul agenției cu rol de Agent / Broker"
                    >
                      <Briefcase size={13} className="text-gray-500" />
                      <span>Testează ca Agent</span>
                    </button>

                    {/* Direct to Agency Admin */}
                    <button
                      type="button"
                      onClick={() => handleStartTest(agency, "agency_admin", "admin")}
                      disabled={startingTenantId === agency.id}
                      className="p-2 text-gray-400 hover:text-gray-800 hover:bg-gray-100 rounded transition-colors cursor-pointer"
                      title="Deschide direct Administrarea Agenției"
                    >
                      <ArrowRight size={15} />
                    </button>
                  </div>
                </div>
              )}
            />
          )}
        </div>
      </div>
    </CmpPlatformLayout>
  );
};
