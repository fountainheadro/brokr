import React, { useState } from "react";
import { CmpAgencyAdminLayout } from "../../ui/agency/cmp_agency-admin-layout";
import { useTenantContext } from "../../core/tenancy/ctx_tenant";
import { Users, UserPlus, Shield, Mail, CheckCircle2, ShieldCheck, MoreVertical } from "lucide-react";
import { VirtualizedTbody } from "../../components/VirtualizedList";

interface MemberItem {
  id: string;
  name: string;
  email: string;
  role: string;
  status: "active" | "invited" | "suspended";
}

export const PgAgencyAdminMembers: React.FC = () => {
  const { tenant, tenantContext } = useTenantContext();

  const [members, setMembers] = useState<MemberItem[]>([
    {
      id: "mem_1",
      name: "Alexandru Radu",
      email: "alexandru.radu@brokr.ro",
      role: "agency_owner",
      status: "active",
    },
    {
      id: "mem_2",
      name: "Elena Popa",
      email: "elena.popa@brokr.ro",
      role: "agency_admin",
      status: "active",
    },
    {
      id: "mem_3",
      name: "Mihai Ionescu",
      email: "mihai.ionescu@brokr.ro",
      role: "agent",
      status: "active",
    },
    {
      id: "mem_4",
      name: "Andreea Stan",
      email: "andreea.stan@brokr.ro",
      role: "agent",
      status: "active",
    },
  ]);

  const [isInviteModalOpen, setIsInviteModalOpen] = useState<boolean>(false);
  const [inviteEmail, setInviteEmail] = useState<string>("");
  const [inviteName, setInviteName] = useState<string>("");
  const [inviteRole, setInviteRole] = useState<string>("agent");

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    const newMember: MemberItem = {
      id: `mem_${Date.now()}`,
      name: inviteName || inviteEmail.split("@")[0],
      email: inviteEmail,
      role: inviteRole,
      status: "invited",
    };

    setMembers([...members, newMember]);
    setInviteEmail("");
    setInviteName("");
    setIsInviteModalOpen(false);
  };

  return (
    <CmpAgencyAdminLayout title="Gestiune Echipă & Roluri Agenție">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="font-title text-sm font-semibold text-gray-900">Membrii Agenției ({members.length})</h2>
            <p className="text-xs text-gray-500 mt-1">
              Configurați brokerii, asistenții și administratorii cu acces la spațiul de lucru al agenției.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setIsInviteModalOpen(true)}
            className="px-3 py-2 bg-[#051D35] hover:bg-[#051D35]/90 text-white rounded font-semibold text-xs flex items-center gap-2 shadow-2xs transition-colors cursor-pointer self-start sm:self-auto"
          >
            <UserPlus size={13} />
            <span>Invită Membru Nou</span>
          </button>
        </div>

        {/* Members Table */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-2xs">
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
            <VirtualizedTbody
              items={members}
              colSpan={5}
              estimateRowHeight={52}
              getItemKey={(m) => m.id}
              className="divide-y divide-gray-100"
              renderRow={(m, _idx, rowRef) => (
                <tr ref={rowRef} className="hover:bg-gray-50/50 transition-colors">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full bg-[#051D35]/5 border border-[#051D35]/15 flex items-center justify-center font-semibold text-xs text-[#051D35]">
                        {m.name.charAt(0)}
                      </div>
                      <span className="font-normal text-gray-900">{m.name}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 font-sans font-normal text-[11px] text-gray-600">{m.email}</td>
                  <td className="py-3 px-4">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-1 leading-none rounded text-[10px] font-normal ${
                        m.role === "agency_owner"
                          ? "bg-amber-50 text-amber-800 border border-amber-200"
                          : m.role === "agency_admin"
                          ? "bg-indigo-50 text-indigo-700 border border-indigo-200"
                          : "bg-gray-100 text-gray-700 border border-gray-200"
                      }`}
                    >
                      <Shield size={10} />
                      <span className="capitalize">{m.role.replace("_", " ")}</span>
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`inline-flex items-center gap-1 text-[11px] font-normal ${
                        m.status === "active"
                          ? "text-emerald-700"
                          : m.status === "invited"
                          ? "text-amber-600"
                          : "text-red-600"
                      }`}
                    >
                      <span className="w-2 h-2 rounded-full bg-current" />
                      <span className="capitalize">{m.status}</span>
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      type="button"
                      className="p-1 text-gray-400 hover:text-gray-700 rounded hover:bg-gray-100 transition-colors"
                      title="Opțiuni membru"
                    >
                      <MoreVertical size={14} />
                    </button>
                  </td>
                </tr>
              )}
            />
          </table>
        </div>

        {/* Invite Modal */}
        {isInviteModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl space-y-4 border border-gray-200 text-xs">
              <h3 className="font-title text-sm font-semibold text-gray-900">Invitare Membru în Echipă</h3>
              <form onSubmit={handleInvite} className="space-y-4">
                <div>
                  <label className="font-semibold text-gray-700 block mb-1">Nume Complet</label>
                  <input
                    type="text"
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    placeholder="Ex: Dan Marinescu"
                    className="w-full h-9 px-3 bg-gray-50 border border-gray-200 rounded-lg text-xs font-normal focus:bg-white focus:outline-none focus:border-[#BE9662]"
                  />
                </div>

                <div>
                  <label className="font-semibold text-gray-700 block mb-1">Adresă de Email</label>
                  <input
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="nume@agentie.ro"
                    className="w-full h-9 px-3 bg-gray-50 border border-gray-200 rounded-lg text-xs font-normal focus:bg-white focus:outline-none focus:border-[#BE9662]"
                  />
                </div>

                <div>
                  <label className="font-semibold text-gray-700 block mb-1">Rol Alocat</label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    className="w-full h-9 px-3 bg-gray-50 border border-gray-200 rounded-lg text-xs font-normal focus:bg-white focus:outline-none focus:border-[#BE9662]"
                  >
                    <option value="agent">Agent / Broker (Acces CRM)</option>
                    <option value="agency_admin">Administrator Agenție (Setări & Cote)</option>
                    <option value="assistant">Asistent Imobiliar</option>
                  </select>
                </div>

                <div className="flex justify-end gap-4 pt-3">
                  <button
                    type="button"
                    onClick={() => setIsInviteModalOpen(false)}
                    className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded font-semibold text-xs transition-colors"
                  >
                    Anulează
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-[#051D35] hover:bg-[#051D35]/90 text-white rounded font-semibold text-xs transition-colors shadow-2xs"
                  >
                    Trimite Invitația
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
