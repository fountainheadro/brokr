import React, { useState } from "react";
import { ChevronLeft, Check, Loader2, Pencil, Phone, User, X } from "lucide-react";
import { Contact, ContactType, contactsService } from "../services/contactsService";
import { Lead } from "../services/leadsService";
import { LeadCard } from "./LeadCard";
import { InlineDetailField } from "./InlineDetailField";
import toast from "react-hot-toast";

const CONTACT_TYPE_OPTIONS: { value: ContactType; label: string }[] = [
  { value: "Owner", label: "Proprietar" },
  { value: "Buyer", label: "Cumpărător" },
  { value: "Renter", label: "Chiriaș" },
  { value: "Agent", label: "Agent" },
];

const CONTACT_TYPE_LABELS: Record<string, string> = {
  Owner: "Proprietar",
  Buyer: "Cumpărător",
  Renter: "Chiriaș",
  Agent: "Agent",
};

interface ContactDetailViewProps {
  contact: Contact;
  leads: Lead[];
  contacts: Contact[];
  onBack: () => void;
  onContactUpdated: (updated: Contact) => void;
  onSelectLead: (lead: Lead) => void;
}

export const ContactDetailView: React.FC<ContactDetailViewProps> = ({
  contact,
  leads,
  contacts,
  onBack,
  onContactUpdated,
  onSelectLead,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [firstNameDraft, setFirstNameDraft] = useState(contact.firstName || "");
  const [lastNameDraft, setLastNameDraft] = useState(contact.lastName || "");
  const [phoneDraft, setPhoneDraft] = useState(contact.phone || "");
  const [typeDraft, setTypeDraft] = useState<string>(
    CONTACT_TYPE_LABELS[contact.type] || "Proprietar"
  );
  const [propertyIdDraft, setPropertyIdDraft] = useState(contact.propertyId || "");
  const [commissionDraft, setCommissionDraft] = useState(contact.commissionValue || "");

  const startEdit = () => {
    setFirstNameDraft(contact.firstName || "");
    setLastNameDraft(contact.lastName || "");
    setPhoneDraft(contact.phone || "");
    setTypeDraft(CONTACT_TYPE_LABELS[contact.type] || "Proprietar");
    setPropertyIdDraft(contact.propertyId || "");
    setCommissionDraft(contact.commissionValue || "");
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
  };

  const handleSave = async () => {
    if (!contact.id) {
      setIsEditing(false);
      return;
    }

    const mappedType =
      CONTACT_TYPE_OPTIONS.find((opt) => opt.label === typeDraft)?.value ||
      contact.type ||
      "Owner";

    setIsSaving(true);
    try {
      const updates: Partial<Contact> = {
        firstName: firstNameDraft.trim(),
        lastName: lastNameDraft.trim(),
        phone: phoneDraft.trim(),
        type: mappedType,
        propertyId: propertyIdDraft.trim(),
        commissionValue: commissionDraft.trim(),
      };
      await contactsService.updateContact(contact.id, updates);
      onContactUpdated({ ...contact, ...updates });
      setIsEditing(false);
      toast.success("Datele contactului au fost salvate!");
    } catch (err) {
      console.error("Failed to update contact:", err);
      toast.error("Eroare la salvarea contactului.");
    } finally {
      setIsSaving(false);
    }
  };

  const associatedLead = leads.find(
    (l) => l.id === contact.propertyId || (l.propertyId && l.propertyId === contact.propertyId)
  );

  return (
    <div className="w-full h-full flex flex-col bg-gray-50 overflow-hidden font-sans">
      {/* Top Sticky Header */}
      <div className="sticky top-0 bg-white border-b border-gray-200 h-[42px] min-h-[42px] max-h-[42px] box-border flex items-center justify-between p-0 z-10 shrink-0 select-none">
        <button
          type="button"
          onClick={onBack}
          className="h-full aspect-square w-[42px] flex items-center justify-center border-r border-gray-200 bg-white hover:bg-gray-50 text-gray-500 hover:text-[#051D35] transition-colors shrink-0 cursor-pointer group"
          title="Înapoi la listă"
        >
          <ChevronLeft size={18} className="text-gray-500 group-hover:text-gray-900 transition-colors" />
        </button>

        <div className="flex-1 min-w-0 px-4 flex items-center">
          <h2 className="font-title text-[14px] font-semibold text-[#051D35] truncate tracking-tight leading-tight">
            {contact.firstName} {contact.lastName}
          </h2>
        </div>

        {contact.contactId && (
          <div className="h-full px-4 flex items-center justify-center border-l border-gray-200 shrink-0 select-text">
            <span className="text-[10px] font-normal text-[#051D35] tabular-nums leading-none">
              #{contact.contactId}
            </span>
          </div>
        )}
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 custom-scrollbar">
        <div className="max-w-4xl mx-auto space-y-4">
          {/* Contact Details Card */}
          <div className="p-5 sm:p-6 bg-white border border-gray-200 rounded-xl shadow-2xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <User size={14} className="text-[#BE9662]" />
                <h3 className="font-title text-[12px] font-semibold text-[#051D35]">
                  Date Contact
                </h3>
              </div>

              {isEditing ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={cancelEdit}
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
                label="Prenume"
                value={contact.firstName || "-"}
                editValue={firstNameDraft}
                isEditing={isEditing}
                onChange={setFirstNameDraft}
                placeholder="Prenume"
                valueClassName="text-[#051D35] font-normal"
              />

              <InlineDetailField
                label="Nume"
                value={contact.lastName || "-"}
                editValue={lastNameDraft}
                isEditing={isEditing}
                onChange={setLastNameDraft}
                placeholder="Nume"
                valueClassName="text-[#051D35] font-normal"
              />

              <InlineDetailField
                label="Telefon"
                type="tel"
                value={contact.phone || "-"}
                editValue={phoneDraft}
                isEditing={isEditing}
                onChange={setPhoneDraft}
                placeholder="07xx xxx xxx"
                valueClassName="text-gray-900 font-normal tabular-nums"
                viewActions={
                  contact.phone ? (
                    <a
                      href={`tel:${contact.phone}`}
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
                label="Tip Contact"
                value={CONTACT_TYPE_LABELS[contact.type] || contact.type || "-"}
                editValue={typeDraft}
                isEditing={isEditing}
                onChange={setTypeDraft}
                options={CONTACT_TYPE_OPTIONS.map((o) => o.label)}
              />

              <InlineDetailField
                label="ID Proprietate Asociată"
                value={contact.propertyId || "-"}
                editValue={propertyIdDraft}
                isEditing={isEditing}
                onChange={setPropertyIdDraft}
                placeholder="Ex: P1001"
                valueClassName="text-gray-800 font-normal tabular-nums"
              />

              <InlineDetailField
                label="Comision"
                value={contact.commissionValue || "-"}
                editValue={commissionDraft}
                isEditing={isEditing}
                onChange={setCommissionDraft}
                placeholder="Ex: 2% / 50%"
                valueClassName="text-gray-800 font-normal tabular-nums"
              />
            </div>
          </div>

          {/* Associated Property */}
          {associatedLead && (
            <div className="space-y-4">
              <h3 className="font-title text-[12px] font-semibold text-[#051D35] px-1">
                Proprietate Asociată
              </h3>
              <LeadCard
                lead={associatedLead}
                contacts={contacts.filter(
                  (c) =>
                    c.propertyId === associatedLead.id ||
                    (associatedLead.propertyId && c.propertyId === associatedLead.propertyId)
                )}
                onClick={() => onSelectLead(associatedLead)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
