import React, { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import { CmpAgencyAdminLayout } from "../../ui/agency/cmp_agency-admin-layout";
import { useTenantContext } from "../../core/tenancy/ctx_tenant";
import { auth } from "../../lib/firebase";
import {
  UserPlus,
  Shield,
  MoreVertical,
  RefreshCw,
  Trash2,
  Ban,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Mail,
} from "lucide-react";
import { VirtualizedTbody } from "../../components/VirtualizedList";

interface MemberItem {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: "agency_owner" | "agency_admin" | "manager" | "agent" | "assistant";
  status: "active" | "invited" | "suspended" | "revoked";
  isPendingInvite?: boolean;
  invitedByEmail?: string;
  createdAt?: string;
  updatedAt?: string;
}

const ROLE_LABELS: Record<string, string> = {
  agency_owner: "Proprietar Agenție",
  agency_admin: "Administrator Agenție",
  manager: "Manager Echipă",
  agent: "Agent / Broker",
  assistant: "Asistent Imobiliar",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Activ",
  invited: "Invitat (în așteptare)",
  suspended: "Suspendat",
  revoked: "Revocat",
};

async function buildTenantAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const currentUser = auth.currentUser;
  if (currentUser) {
    const idToken = await currentUser.getIdToken();
    headers.Authorization = `Bearer ${idToken}`;
  }
  if (typeof localStorage !== "undefined") {
    const previewToken = localStorage.getItem("brokr_preview_token");
    if (previewToken) {
      headers["x-preview-token"] = previewToken;
    }
  }
  return headers;
}

export const PgAgencyAdminMembers: React.FC = () => {
  const { tenantContext } = useTenantContext();

  const [members, setMembers] = useState<MemberItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isInviteModalOpen, setIsInviteModalOpen] = useState<boolean>(false);
  const [inviteEmail, setInviteEmail] = useState<string>("");
  const [inviteName, setInviteName] = useState<string>("");
  const [inviteRole, setInviteRole] = useState<MemberItem["role"]>("agent");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);

  const isCurrentUserOwner = tenantContext?.role === "agency_owner";
  const currentUserEmail = (tenantContext?.userEmail || auth.currentUser?.email || "").toLowerCase();
  const currentUserId = tenantContext?.userId || auth.currentUser?.uid || "";

  const fetchMembers = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const headers = await buildTenantAuthHeaders();
      const res = await fetch("/api/tenant/members?includeAll=true", { headers });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json?.error?.message || "Nu s-a putut încărca lista membrilor.");
      }
      const list: MemberItem[] = Array.isArray(json.data) ? json.data : [];
      setMembers(list);
    } catch (err: any) {
      setLoadError(err?.message || "Eroare la încărcarea echipei din baza de date.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tenantContext?.tenantId) {
      void fetchMembers();
    }
  }, [tenantContext?.tenantId, fetchMembers]);

  // Close row action dropdown on outside click
  useEffect(() => {
    if (!openMenuId) return;
    const close = () => setOpenMenuId(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [openMenuId]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return;

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const headers = await buildTenantAuthHeaders();
      const res = await fetch("/api/tenant/members/invite", {
        method: "POST",
        headers,
        body: JSON.stringify({
          email,
          name: inviteName.trim() || email.split("@")[0],
          role: inviteRole,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json?.error?.message || "Nu s-a putut salva invitația în baza de date.");
      }

      toast.success(`Invitația pentru ${email} a fost salvată în baza de date.`);
      setInviteEmail("");
      setInviteName("");
      setInviteRole("agent");
      setIsInviteModalOpen(false);
      await fetchMembers();
    } catch (err: any) {
      const msg = err?.message || "Eroare la trimiterea invitației.";
      setSubmitError(msg);
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRoleChange = async (member: MemberItem, newRole: MemberItem["role"]) => {
    setBusyRowId(member.id);
    setOpenMenuId(null);
    try {
      const headers = await buildTenantAuthHeaders();
      if (member.isPendingInvite || member.status === "invited") {
        const res = await fetch("/api/tenant/members/invite", {
          method: "POST",
          headers,
          body: JSON.stringify({
            email: member.email,
            name: member.name,
            role: newRole,
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json?.error?.message || "Nu s-a putut actualiza rolul invitației.");
        }
      } else {
        const res = await fetch(`/api/tenant/members/${encodeURIComponent(member.userId)}/role`, {
          method: "POST",
          headers,
          body: JSON.stringify({ newRole }),
        });
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json?.error?.message || "Nu s-a putut actualiza rolul membrului.");
        }
      }
      toast.success(`Rol actualizat pentru ${member.name}.`);
      await fetchMembers();
    } catch (err: any) {
      toast.error(err?.message || "Eroare la actualizarea rolului.");
    } finally {
      setBusyRowId(null);
    }
  };

  const handleToggleStatus = async (member: MemberItem) => {
    setBusyRowId(member.id);
    setOpenMenuId(null);
    const nextStatus = member.status === "suspended" ? "active" : "suspended";
    try {
      const headers = await buildTenantAuthHeaders();
      const res = await fetch(`/api/tenant/members/${encodeURIComponent(member.userId)}/status`, {
        method: "POST",
        headers,
        body: JSON.stringify({ newStatus: nextStatus }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json?.error?.message || "Nu s-a putut actualiza starea membrului.");
      }
      toast.success(
        nextStatus === "suspended"
          ? `Contul ${member.name} a fost suspendat.`
          : `Contul ${member.name} a fost reactivat.`
      );
      await fetchMembers();
    } catch (err: any) {
      toast.error(err?.message || "Eroare la modificarea stării contului.");
    } finally {
      setBusyRowId(null);
    }
  };

  const handleRevokeInvite = async (member: MemberItem) => {
    setBusyRowId(member.id);
    setOpenMenuId(null);
    try {
      const headers = await buildTenantAuthHeaders();
      const res = await fetch(`/api/tenant/members/invites/${encodeURIComponent(member.email)}`, {
        method: "DELETE",
        headers,
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json?.error?.message || "Nu s-a putut anula invitația.");
      }
      toast.success(`Invitația pentru ${member.email} a fost anulată.`);
      await fetchMembers();
    } catch (err: any) {
      toast.error(err?.message || "Eroare la anularea invitației.");
    } finally {
      setBusyRowId(null);
    }
  };

  return (
    <CmpAgencyAdminLayout title="Gestiune Echipă & Roluri Agenție">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="font-title text-sm font-semibold text-gray-900">
              Membrii Agenției ({members.length})
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              Configurați brokerii, asistenții și administratorii cu acces la spațiul de lucru al agenției.
              Membrii invitați primesc acces automat la prima autentificare cu Google.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => void fetchMembers()}
              disabled={isLoading}
              className="px-2.5 py-2 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 rounded font-medium text-xs flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              title="Reîmprospătează lista din Firestore"
            >
              <RefreshCw size={13} className={isLoading ? "animate-spin" : ""} />
              <span>Actualizează</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setSubmitError(null);
                setIsInviteModalOpen(true);
              }}
              className="px-3 py-2 bg-[#051D35] hover:bg-[#051D35]/90 text-white rounded font-semibold text-xs flex items-center gap-2 shadow-2xs transition-colors cursor-pointer"
            >
              <UserPlus size={13} />
              <span>Invită Membru Nou</span>
            </button>
          </div>
        </div>

        {loadError && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
            <AlertCircle size={14} className="shrink-0" />
            <span>{loadError}</span>
          </div>
        )}

        {/* Members Table */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-visible shadow-2xs">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-gray-50/75 border-b border-gray-100 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                <th className="py-3 px-4">Utilizator</th>
                <th className="py-3 px-4">Email</th>
                <th className="py-3 px-4">Rol Atribuit</th>
                <th className="py-3 px-4">Stare Cont</th>
                <th className="py-3 px-4 text-right">Acțiuni</th>
              </tr>
            </thead>
            {isLoading && members.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={5} className="py-10 text-center text-gray-500">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 size={14} className="animate-spin" />
                      Se încarcă membrii agenției din baza de date...
                    </span>
                  </td>
                </tr>
              </tbody>
            ) : members.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={5} className="py-10 text-center text-gray-500">
                    Nu există membri înregistrați încă. Folosiți butonul „Invită Membru Nou” pentru a adăuga echipa.
                  </td>
                </tr>
              </tbody>
            ) : (
              <VirtualizedTbody
                items={members}
                colSpan={5}
                estimateRowHeight={56}
                getItemKey={(m) => `${m.id}_${m.email}`}
                className="divide-y divide-gray-100"
                renderRow={(m, _idx, rowRef) => {
                  const isSelf =
                    m.userId === currentUserId ||
                    (Boolean(currentUserEmail) && m.email.toLowerCase() === currentUserEmail);
                  const isProtectedOwner = m.role === "agency_owner" && !isCurrentUserOwner;
                  const canManageRow = !isSelf && !isProtectedOwner;
                  const isRowBusy = busyRowId === m.id;
                  const isPending = Boolean(m.isPendingInvite) || m.status === "invited";

                  return (
                    <tr ref={rowRef} className="hover:bg-gray-50/50 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded-full bg-[#051D35]/5 border border-[#051D35]/15 flex items-center justify-center font-semibold text-xs text-[#051D35] uppercase">
                            {(m.name || m.email || "?").charAt(0)}
                          </div>
                          <div>
                            <div className="font-medium text-gray-900 flex items-center gap-1.5">
                              <span>{m.name}</span>
                              {isSelf && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                                  Tu
                                </span>
                              )}
                            </div>
                            {isPending && (
                              <div className="text-[10px] text-amber-700 flex items-center gap-1 mt-0.5">
                                <Mail size={10} />
                                <span>Acces activ automat la conectarea cu Google</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 font-sans font-normal text-[11px] text-gray-600">
                        {m.email}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-1 leading-none rounded text-[10px] font-normal ${
                            m.role === "agency_owner"
                              ? "bg-amber-50 text-amber-800 border border-amber-200"
                              : m.role === "agency_admin"
                              ? "bg-indigo-50 text-indigo-700 border border-indigo-200"
                              : m.role === "manager"
                              ? "bg-sky-50 text-sky-700 border border-sky-200"
                              : "bg-gray-100 text-gray-700 border border-gray-200"
                          }`}
                        >
                          <Shield size={10} />
                          <span>{ROLE_LABELS[m.role] || m.role.replace("_", " ")}</span>
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1.5 text-[11px] font-normal ${
                            m.status === "active"
                              ? "text-emerald-700"
                              : isPending
                              ? "text-amber-600"
                              : "text-red-600"
                          }`}
                        >
                          <span className="w-2 h-2 rounded-full bg-current" />
                          <span>{STATUS_LABELS[m.status] || m.status}</span>
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right relative">
                        {isRowBusy ? (
                          <Loader2 size={14} className="inline animate-spin text-gray-400" />
                        ) : canManageRow ? (
                          <div
                            className="inline-block relative"
                            onClick={(ev) => ev.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => setOpenMenuId(openMenuId === m.id ? null : m.id)}
                              className="p-1 text-gray-400 hover:text-gray-700 rounded hover:bg-gray-100 transition-colors cursor-pointer"
                              title="Opțiuni membru"
                            >
                              <MoreVertical size={14} />
                            </button>

                            {openMenuId === m.id && (
                              <div className="absolute right-0 mt-1 w-52 bg-white border border-gray-200 rounded-lg shadow-lg z-30 py-1 text-left">
                                <div className="px-3 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                                  Schimbă Rol
                                </div>
                                {(
                                  [
                                    ...(isCurrentUserOwner ? (["agency_owner"] as const) : []),
                                    "agency_admin",
                                    "manager",
                                    "agent",
                                    "assistant",
                                  ] as MemberItem["role"][]
                                ).map((roleOption) => (
                                  <button
                                    key={roleOption}
                                    type="button"
                                    disabled={m.role === roleOption}
                                    onClick={() => void handleRoleChange(m, roleOption)}
                                    className="w-full px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 flex items-center justify-between disabled:opacity-40 cursor-pointer"
                                  >
                                    <span>{ROLE_LABELS[roleOption]}</span>
                                    {m.role === roleOption && <CheckCircle2 size={12} className="text-emerald-600" />}
                                  </button>
                                ))}

                                <div className="my-1 border-t border-gray-100" />

                                {isPending ? (
                                  <button
                                    type="button"
                                    onClick={() => void handleRevokeInvite(m)}
                                    className="w-full px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 flex items-center gap-2 cursor-pointer"
                                  >
                                    <Trash2 size={12} />
                                    <span>Anulează Invitația</span>
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => void handleToggleStatus(m)}
                                    className={`w-full px-3 py-1.5 text-xs flex items-center gap-2 cursor-pointer ${
                                      m.status === "suspended"
                                        ? "text-emerald-700 hover:bg-emerald-50"
                                        : "text-red-600 hover:bg-red-50"
                                    }`}
                                  >
                                    {m.status === "suspended" ? (
                                      <>
                                        <CheckCircle2 size={12} />
                                        <span>Reactivează Cont</span>
                                      </>
                                    ) : (
                                      <>
                                        <Ban size={12} />
                                        <span>Suspendă Cont</span>
                                      </>
                                    )}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-[10px] text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                }}
              />
            )}
          </table>
        </div>

        {/* Invite Modal */}
        {isInviteModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl space-y-4 border border-gray-200 text-xs">
              <div>
                <h3 className="font-title text-sm font-semibold text-gray-900">
                  Invitare Membru în Echipă
                </h3>
                <p className="text-[11px] text-gray-500 mt-1">
                  Invitația este salvată imediat în Cloud Firestore. Membrul va primi automat rolul alocat la autentificarea cu acest email Google.
                </p>
              </div>

              {submitError && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[11px]">
                  <AlertCircle size={13} className="shrink-0" />
                  <span>{submitError}</span>
                </div>
              )}

              <form onSubmit={handleInvite} className="space-y-4">
                <div>
                  <label className="font-semibold text-gray-700 block mb-1">Nume Complet</label>
                  <input
                    type="text"
                    required
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    placeholder="Ex: Petru Buliga"
                    disabled={isSubmitting}
                    className="w-full h-9 px-3 bg-gray-50 border border-gray-200 rounded-lg text-xs font-normal focus:bg-white focus:outline-none focus:border-[#BE9662] disabled:opacity-60"
                  />
                </div>

                <div>
                  <label className="font-semibold text-gray-700 block mb-1">Adresă de Email (Google)</label>
                  <input
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="nume@gmail.com"
                    disabled={isSubmitting}
                    className="w-full h-9 px-3 bg-gray-50 border border-gray-200 rounded-lg text-xs font-normal focus:bg-white focus:outline-none focus:border-[#BE9662] disabled:opacity-60"
                  />
                </div>

                <div>
                  <label className="font-semibold text-gray-700 block mb-1">Rol Alocat</label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as MemberItem["role"])}
                    disabled={isSubmitting}
                    className="w-full h-9 px-3 bg-gray-50 border border-gray-200 rounded-lg text-xs font-normal focus:bg-white focus:outline-none focus:border-[#BE9662] disabled:opacity-60"
                  >
                    <option value="agent">Agent / Broker (Acces CRM)</option>
                    <option value="manager">Manager Echipă</option>
                    <option value="agency_admin">Administrator Agenție (Setări & Echipă)</option>
                    <option value="assistant">Asistent Imobiliar</option>
                    {isCurrentUserOwner && (
                      <option value="agency_owner">Proprietar Agenție (Acces Complet)</option>
                    )}
                  </select>
                </div>

                <div className="flex justify-end gap-3 pt-3">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => setIsInviteModalOpen(false)}
                    className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded font-semibold text-xs transition-colors cursor-pointer disabled:opacity-50"
                  >
                    Anulează
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-4 py-2 bg-[#051D35] hover:bg-[#051D35]/90 text-white rounded font-semibold text-xs transition-colors shadow-2xs flex items-center gap-2 cursor-pointer disabled:opacity-60"
                  >
                    {isSubmitting && <Loader2 size={13} className="animate-spin" />}
                    <span>{isSubmitting ? "Se salvează..." : "Trimite Invitația"}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </CmpAgencyAdminLayout>
  );
};
