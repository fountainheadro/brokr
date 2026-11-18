import React, { useState } from "react";
import { Check, ChevronLeft, Loader2, Mail, Pencil, Phone, UserCheck, X } from "lucide-react";
import { PersonalMember, PersonalStatus, personalService } from "../services/personalService";
import { InlineDetailField } from "./InlineDetailField";
import toast from "react-hot-toast";

const COMMON_ROLES = [
  "Agent Imobiliar",
  "Broker Senior",
  "Broker Junior",
  "Manager Vânzări",
  "Team Leader",
  "Coordonator Tranzacții",
  "Asistent",
  "Fotograf Imobiliar",
  "Jurist",
  "Administrator",
];

const STATUS_OPTIONS: PersonalStatus[] = ["Activ", "Inactiv"];

interface PersonalDetailViewProps {
  member: PersonalMember;
  onBack: () => void;
  onMemberUpdated: (updated: PersonalMember) => void;
}

export const PersonalDetailView: React.FC<PersonalDetailViewProps> = ({
  member,
  onBack,
  onMemberUpdated,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [nameDraft, setNameDraft] = useState(member.name || "");
  const [roleDraft, setRoleDraft] = useState(member.role || "Agent Imobiliar");
  const [statusDraft, setStatusDraft] = useState<PersonalStatus>(member.status || "Activ");
  const [phoneDraft, setPhoneDraft] = useState(member.phone || "");
  const [emailDraft, setEmailDraft] = useState(member.email || "");
  const [zoneDraft, setZoneDraft] = useState(member.zone || "");
  const [notesDraft, setNotesDraft] = useState(member.notes || "");

  const startEdit = () => {
    setNameDraft(member.name || "");
    setRoleDraft(member.role || "Agent Imobiliar");
    setStatusDraft(member.status || "Activ");
    setPhoneDraft(member.phone || "");
    setEmailDraft(member.email || "");
    setZoneDraft(member.zone || "");
    setNotesDraft(member.notes || "");
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (!nameDraft.trim() || !phoneDraft.trim()) {
      toast.error("Numele și telefonul sunt obligatorii.");
      return;
    }
    if (!member.id) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    try {
      const updates: Partial<PersonalMember> = {
        name: nameDraft.trim(),
        role: roleDraft.trim() || "Agent Imobiliar",
        status: statusDraft,
        phone: phoneDraft.trim(),
        email: emailDraft.trim(),
        zone: zoneDraft.trim(),
        notes: notesDraft.trim(),
      };
      await personalService.updatePersonalMember(member.id, updates);
      onMemberUpdated({ ...member, ...updates });
      setIsEditing(false);
      toast.success("Datele membrului au fost salvate!");
    } catch (err) {
      console.error("Failed to update personal member:", err);
      toast.error("Eroare la salvarea datelor membrului.");
    } finally {
      setIsSaving(false);
    }
  };

  const roleChoices = COMMON_ROLES.includes(roleDraft)
    ? COMMON_ROLES
    : roleDraft
      ? [roleDraft, ...COMMON_ROLES]
      : COMMON_ROLES;

  return (
    <div className="w-full h-full bg-gray-50 flex flex-col overflow-hidden font-sans">
      {/* Top Sticky Header */}
      <div className="sticky top-0 bg-white border-b border-gray-200 h-[42px] min-h-[42px] max-h-[42px] box-border flex items-center justify-between p-0 z-10 shrink-0 select-none">
        <button
          type="button"
          onClick={onBack}
          className="h-full aspect-square w-[42px] flex items-center justify-center border-r border-gray-200 bg-white hover:bg-gray-50 text-gray-500 hover:text-[#051D35] transition-colors shrink-0 cursor-pointer group"
          title="Înapoi la Personal"
        >
          <ChevronLeft size={18} className="text-gray-500 group-hover:text-gray-900 transition-colors" />
        </button>

        <div className="flex-1 min-w-0 px-4 flex items-center">
          <h2 className="font-title text-[14px] font-semibold text-[#051D35] truncate tracking-tight leading-tight">
            {member.name}
          </h2>
        </div>

        {member.personalId && (
          <div className="h-full px-4 flex items-center justify-center border-l border-gray-200 shrink-0 select-text">
            <span className="text-[10px] font-normal text-[#051D35] tabular-nums leading-none">
              #{member.personalId}
            </span>
          </div>
        )}
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 custom-scrollbar">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="p-5 sm:p-6 bg-white border border-gray-200 rounded-xl shadow-2xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <UserCheck size={14} className="text-[#BE9662]" />
                <h3 className="font-title text-[12px] font-semibold text-[#051D35]">
                  Date Membru Echipă
                </h3>
              </div>

              {isEditing ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => setIsEditing(false)}
                    className="h-7 px-3 rounded-md border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 text-[11px] font-medium flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <X size={12} />
                    <span>Anulează</span>
                  </button>
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => void handleSave()}
                    className="h-7 px-3 rounded-md bg-[#051D35] hover:bg-[#0a2b4a] text-white text-[11px] font-semibold flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer shadow-2xs"
                  >
                    {isSaving ? (
                      <Loader2 size={12} className="animate-spin text-[#BE9662]" />
                    ) : (
                      <Check size={12} className="text-[#BE9662]" />
                    )}
                    <span>{isSaving ? "Se salvează..." : "Salvează"}</span>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={startEdit}
                  className="h-7 px-3 rounded-md border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 hover:text-[#051D35] text-[11px] font-semibold flex items-center gap-2 transition-colors cursor-pointer shadow-2xs"
                >
                  <Pencil size={11} className="text-[#BE9662]" />
                  <span>Modifică</span>
                </button>
              )}
            </div>

            <div className={`grid grid-cols-1 md:grid-cols-2 ${isEditing ? "gap-[16px]" : "gap-4"}`}>
              <InlineDetailField
                label="Nume și prenume"
                value={member.name || "-"}
                editValue={nameDraft}
                isEditing={isEditing}
                onChange={setNameDraft}
                placeholder="ex: Alexandru Popescu"
                valueClassName="text-[#051D35] font-normal"
                className="md:col-span-2"
              />

              <InlineDetailField
                label="Rol / Funcție"
                value={member.role || "-"}
                editValue={roleDraft}
                isEditing={isEditing}
                onChange={setRoleDraft}
                options={roleChoices}
              />

              <InlineDetailField
                label="Status"
                value={member.status || "Activ"}
                editValue={statusDraft}
                isEditing={isEditing}
                onChange={(val) => setStatusDraft(val as PersonalStatus)}
                options={STATUS_OPTIONS}
              />

              <InlineDetailField
                label="Telefon"
                type="tel"
                value={member.phone || "-"}
                editValue={phoneDraft}
                isEditing={isEditing}
                onChange={setPhoneDraft}
                placeholder="0722 000 000"
                valueClassName="text-gray-900 font-normal tabular-nums"
                viewActions={
                  member.phone ? (
                    <a
                      href={`tel:${member.phone}`}
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center justify-center w-6 h-6 rounded-md bg-white border border-gray-200 text-gray-400 hover:text-[#BE9662] hover:border-gray-300 shadow-2xs transition-colors"
                      title="Apelează"
                    >
                      <Phone size={11} />
                    </a>
                  ) : undefined
                }
              />

              <InlineDetailField
                label="Email"
                type="email"
                value={member.email || "-"}
                editValue={emailDraft}
                isEditing={isEditing}
                onChange={setEmailDraft}
                placeholder="agent@brokr.ro"
                viewActions={
                  member.email ? (
                    <a
                      href={`mailto:${member.email}`}
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center justify-center w-6 h-6 rounded-md bg-white border border-gray-200 text-gray-400 hover:text-[#BE9662] hover:border-gray-300 shadow-2xs transition-colors"
                      title="Trimite email"
                    >
                      <Mail size={11} />
                    </a>
                  ) : undefined
                }
              />

              <InlineDetailField
                label="Zonă / Cartiere atribuite"
                value={member.zone || "Toate zonele"}
                editValue={zoneDraft}
                isEditing={isEditing}
                onChange={setZoneDraft}
                placeholder="ex: Nord, Aviației, Floreasca"
                className="md:col-span-2"
              />

              <InlineDetailField
                label="Notițe interne"
                value={member.notes || ""}
                editValue={notesDraft}
                isEditing={isEditing}
                onChange={setNotesDraft}
                placeholder="Detalii adiționale, limbi vorbite, orar..."
                emptyText="Fără notițe"
                multiline
                rows={3}
                className="md:col-span-2"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
