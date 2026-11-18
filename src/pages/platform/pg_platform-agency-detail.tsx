import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  Building2,
  ArrowLeft,
  Users,
  ScrollText,
  Shield,
  Layers,
  Lock,
  Unlock,
  CheckCircle2,
  AlertTriangle,
  Globe,
  Plus,
} from "lucide-react";
import { CmpPlatformLayout } from "../../ui/platform/cmp_platform-layout";
import { AtmPlatformBadge } from "../../ui/atoms/platform/atm_platform-badge";
import { AtmAgencyRoleBadge } from "../../ui/atoms/agency/atm_agency-role-badge";
import { useAuth } from "../../core/auth/ctx_auth";
import { VirtualizedStack, VirtualizedTbody } from "../../components/VirtualizedList";

export const PgPlatformAgencyDetail: React.FC = () => {
  const { tenant_id } = useParams<{ tenant_id: string }>();
  const { user } = useAuth();

  const [agencyData, setAgencyData] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState<"general" | "members" | "notes">("general");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [newNoteContent, setNewNoteContent] = useState<string>("");
  const [isAddingNote, setIsAddingNote] = useState<boolean>(false);

  async function loadAgencyDetails() {
    if (!user || !tenant_id) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/platform/agencies/${tenant_id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success) setAgencyData(json.data);
      }
    } catch (err) {
      console.error("Failed to load agency details:", err);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadAgencyDetails();
  }, [user, tenant_id]);

  const handleToggleStatus = async () => {
    if (!agencyData || !user) return;
    const isCurrentlySuspended = agencyData.agency.status === "suspended";
    const targetStatus = isCurrentlySuspended ? "active" : "suspended";
    const promptMsg = isCurrentlySuspended
      ? "Motiv reactivare:"
      : "Motiv suspendare (obligatoriu):";
    const reason = window.prompt(promptMsg, "Decizie administrativă Super Admin");
    if (reason === null) return;

    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/platform/agencies/${tenant_id}/status`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: targetStatus, reason }),
      });

      if (res.ok) {
        await loadAgencyDetails();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err?.error?.message || "Eroare la modificarea statusului.");
      }
    } catch (e: any) {
      alert(e?.message || "Eroare de comunicare.");
    }
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteContent.trim() || !user) return;
    setIsAddingNote(true);

    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/platform/agencies/${tenant_id}/notes`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: newNoteContent.trim() }),
      });

      if (res.ok) {
        setNewNoteContent("");
        await loadAgencyDetails();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err?.error?.message || "Eroare la adăugarea notei.");
      }
    } catch (e: any) {
      alert(e?.message || "Eroare de comunicare.");
    } finally {
      setIsAddingNote(false);
    }
  };

  if (isLoading) {
    return (
      <CmpPlatformLayout title="Detalii Agenție">
        <div className="py-12 text-center text-xs text-gray-400">
          Se încarcă profilul agenției...
        </div>
      </CmpPlatformLayout>
    );
  }

  if (!agencyData || !agencyData.agency) {
    return (
      <CmpPlatformLayout title="Agenție Negăsită">
        <div className="bg-white p-8 rounded-lg border border-gray-200 text-center text-xs space-y-4">
          <p className="text-gray-600 font-normal">Agenția specificată nu există sau a fost eliminată.</p>
          <Link
            to="/platform/agencies"
            className="inline-flex items-center gap-2 text-indigo-600 hover:text-indigo-800 font-semibold"
          >
            <ArrowLeft size={13} />
            <span>Înapoi la lista agențiilor</span>
          </Link>
        </div>
      </CmpPlatformLayout>
    );
  }

  const agency = agencyData.agency;
  const members = agencyData.members || [];
  const notes = agencyData.notes || [];

  return (
    <CmpPlatformLayout title={`Agenție: ${agency.name}`}>
      <div className="space-y-4">
        {/* Breadcrumb Navigation */}
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Link to="/platform/agencies" className="hover:text-indigo-600 transition-colors flex items-center gap-1">
            <ArrowLeft size={13} />
            <span>Agenții</span>
          </Link>
          <span>/</span>
          <span className="font-semibold text-gray-900">{agency.name}</span>
        </div>

        {/* Agency Hero Header Card */}
        <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-2xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-[#051D35] text-white flex items-center justify-center font-semibold text-lg shadow-2xs">
              {agency.name.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-title text-base font-semibold text-gray-900">{agency.name}</h2>
                <AtmPlatformBadge status={agency.status} />
              </div>
              <p className="text-xs text-gray-500 font-sans mt-1">
                <span className="font-semibold">ID:</span> <span className="text-gray-800 font-normal">{agency.id}</span> •{" "}
                <span className="font-semibold">Subdomeniu:</span>{" "}
                <span className="text-indigo-600 font-normal">{agency.subdomain}.[subdomeniu]</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 w-full sm:w-auto">
            <button
              type="button"
              onClick={handleToggleStatus}
              className={`px-3 py-2 rounded-md font-semibold text-xs flex items-center gap-2 transition-colors cursor-pointer shadow-2xs ${
                agency.status === "suspended"
                  ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                  : "bg-red-600 hover:bg-red-700 text-white"
              }`}
            >
              {agency.status === "suspended" ? (
                <>
                  <Unlock size={13} />
                  <span>Reactivează Agenția</span>
                </>
              ) : (
                <>
                  <Lock size={13} />
                  <span>Suspendă Agenția</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-gray-200 gap-6 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab("general")}
            className={`pb-3 transition-colors cursor-pointer border-b-2 flex items-center gap-2 ${
              activeTab === "general"
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-gray-500 hover:text-gray-900"
            }`}
          >
            <Shield size={14} />
            <span>Date Generale & Configurație</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("members")}
            className={`pb-3 transition-colors cursor-pointer border-b-2 flex items-center gap-2 ${
              activeTab === "members"
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-gray-500 hover:text-gray-900"
            }`}
          >
            <Users size={14} />
            <span>Membri & Roluri ({members.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("notes")}
            className={`pb-3 transition-colors cursor-pointer border-b-2 flex items-center gap-2 ${
              activeTab === "notes"
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-gray-500 hover:text-gray-900"
            }`}
          >
            <ScrollText size={14} />
            <span>Note Administrative ({notes.length})</span>
          </button>
        </div>

        {/* Tab 1: General Info */}
        {activeTab === "general" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-2xs space-y-3 text-xs">
              <h3 className="font-title font-semibold text-gray-900 text-xs uppercase tracking-wider mb-2">
                Informații Abonament & Identitate
              </h3>

              <div className="flex justify-between py-2 border-b border-gray-100">
                <span className="font-semibold text-gray-500">Plan Tarifar:</span>
                <span className="font-normal text-gray-900 font-sans capitalize">{agency.planId.replace("plan_", "")}</span>
              </div>

              <div className="flex justify-between py-2 border-b border-gray-100">
                <span className="font-semibold text-gray-500">Email Contact:</span>
                <span className="font-normal text-gray-900">{agency.branding?.contactEmail || "Nespecificat"}</span>
              </div>

              <div className="flex justify-between py-2 border-b border-gray-100">
                <span className="font-semibold text-gray-500">Domeniu Personalizat:</span>
                <span className="font-normal text-indigo-600 font-sans">
                  {agency.customDomain ? agency.customDomain : "Neconfigurat (folosește subdomeniu)"}
                </span>
              </div>

              <div className="flex justify-between py-2">
                <span className="font-semibold text-gray-500">Dată Înregistrare:</span>
                <span className="font-sans font-normal tabular-nums text-gray-700">{new Date(agency.createdAt).toLocaleDateString()}</span>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-2xs space-y-3 text-xs">
              <h3 className="font-title font-semibold text-gray-900 text-xs uppercase tracking-wider mb-2">
                Module Active în Agenție
              </h3>
              <div className="flex flex-wrap gap-2">
                {(agency.enabledModules || []).map((mod: string) => (
                  <span
                    key={mod}
                    className="px-2 py-1 bg-indigo-50 border border-indigo-200 text-indigo-800 rounded font-sans font-normal text-[10px]"
                  >
                    {mod}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Members */}
        {activeTab === "members" && (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-2xs">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 font-semibold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-3 px-4">Utilizator</th>
                  <th className="py-3 px-4">Email</th>
                  <th className="py-3 px-4">Rol în Agenție</th>
                  <th className="py-3 px-4">Status Membru</th>
                  <th className="py-3 px-4">Membru din</th>
                </tr>
              </thead>
              {members.length === 0 ? (
                <tbody className="divide-y divide-gray-100 text-gray-700 font-normal">
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-gray-400">
                      Nu există membri înregistrați pentru această agenție.
                    </td>
                  </tr>
                </tbody>
              ) : (
                <VirtualizedTbody
                  items={members}
                  colSpan={5}
                  estimateRowHeight={44}
                  getItemKey={(m: any) => m.id}
                  className="divide-y divide-gray-100 text-gray-700 font-normal"
                  renderRow={(m: any, _idx, rowRef) => (
                    <tr ref={rowRef} className="hover:bg-gray-50/50">
                      <td className="py-3 px-4 font-normal text-gray-900">{m.name}</td>
                      <td className="py-3 px-4 text-gray-600 font-sans font-normal text-[11px]">{m.email}</td>
                      <td className="py-3 px-4">
                        <span className="font-normal text-gray-800 capitalize">{m.role.replace(/_/g, " ")}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-block px-2 py-1 leading-none rounded text-[10px] font-normal ${
                            m.status === "active"
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : "bg-red-50 text-red-700 border border-red-200"
                          }`}
                        >
                          {m.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-sans tabular-nums font-normal text-[11px] text-gray-500">
                        {new Date(m.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  )}
                />
              )}
            </table>
          </div>
        )}

        {/* Tab 3: Administrative Notes */}
        {activeTab === "notes" && (
          <div className="space-y-4">
            {/* Add note form */}
            <form onSubmit={handleAddNote} className="bg-white border border-gray-200 rounded-lg p-4 shadow-2xs">
              <label className="block text-xs font-semibold text-gray-800 mb-2">
                Adaugă Notă Administrativă (Vizibilă exclusiv pentru Super Admin):
              </label>
              <textarea
                rows={2}
                placeholder="Scrie o notă internă despre această agenție..."
                value={newNoteContent}
                onChange={(e) => setNewNoteContent(e.target.value)}
                className="w-full p-2 border border-gray-200 rounded-md focus:outline-none focus:border-indigo-500 font-sans font-normal text-xs mb-2"
              />
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={isAddingNote || !newNoteContent.trim()}
                  className="px-3 py-2 bg-[#051D35] hover:bg-[#0a2b4a] text-white rounded-md text-xs font-semibold flex items-center gap-2 disabled:opacity-50 cursor-pointer shadow-2xs"
                >
                  <Plus size={13} />
                  <span>{isAddingNote ? "Se salvează..." : "Adaugă Notă"}</span>
                </button>
              </div>
            </form>

            {/* Existing notes list */}
            {notes.length === 0 ? (
              <div className="bg-white p-6 rounded-lg border border-gray-200 text-center text-xs text-gray-400">
                Nu există note administrative pentru această agenție.
              </div>
            ) : (
              <VirtualizedStack
                items={notes}
                getItemKey={(note: any) => note.id}
                estimateItemHeight={78}
                gap={16}
                overscanRatio={0.5}
                renderItem={(note: any, _idx, itemRef) => (
                  <div ref={itemRef} className="bg-white p-4 rounded-lg border border-gray-200 shadow-2xs text-xs space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-gray-500">
                      <span className="font-semibold text-gray-800">{note.author}</span>
                      <span className="font-sans font-normal tabular-nums">{new Date(note.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="text-gray-800 font-normal leading-relaxed pt-1">{note.content}</p>
                  </div>
                )}
              />
            )}
          </div>
        )}
      </div>
    </CmpPlatformLayout>
  );
};
