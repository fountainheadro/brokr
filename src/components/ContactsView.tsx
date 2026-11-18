import React, { useState, useMemo, useRef } from "react";
import { 
  Users, 
  Search, 
  Plus, 
  Phone, 
  Download, 
  Trash2, 
  Copy, 
  Check, 
  Building2, 
  Percent
} from "lucide-react";
import { Contact, ContactType, contactsService } from "../services/contactsService";
import { downloadVCard } from "../lib/vcard";
import { VirtualizedTbody } from "./VirtualizedList";
import toast from "react-hot-toast";

interface ContactsViewProps {
  contacts: Contact[];
  onAddContactClick: () => void;
  onSelectProperty?: (propertyId: string) => void;
  onContactClick?: (contact: Contact) => void;
}

const TYPE_LABELS: Record<ContactType, string> = {
  Buyer: "Cumpărător",
  Renter: "Chiriaș",
  Owner: "Proprietar",
  Agent: "Agent"
};

const CONTACT_FILTERS = [
  { id: "Toate", label: "Toate" },
  { id: "Proprietari", label: "Proprietari", types: ["Owner", "Proprietar"] },
  { id: "Cumparatori", label: "Cumpărători", types: ["Buyer", "Cumparator", "Cumpărător"] },
  { id: "Chiriasi", label: "Chiriași", types: ["Renter", "Chirias", "Chiriaș"] }
];

const TYPE_COLORS: Record<ContactType, string> = {
  Buyer: "bg-blue-50 text-blue-700 border-blue-200",
  Renter: "bg-[#BE9662]/10 text-[#051D35] border-[#BE9662]/30",
  Owner: "bg-emerald-50 text-emerald-700 border-emerald-200",
  Agent: "bg-amber-50 text-amber-700 border-amber-200"
};

export const ContactsView: React.FC<ContactsViewProps> = ({
  contacts,
  onAddContactClick,
  onSelectProperty,
  onContactClick
}) => {
  const [search, setSearch] = useState("");
  const [selectedType, setSelectedType] = useState<string>("Toate");
  const [copiedPhone, setCopiedPhone] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const handleCopyPhone = async (phone: string, id: string) => {
    try {
      await navigator.clipboard.writeText(phone);
      setCopiedPhone(id);
      setTimeout(() => setCopiedPhone(null), 2000);
      toast.success("Numărul de telefon a fost copiat!");
    } catch {
      toast.error("Nu s-a putut copia numărul.");
    }
  };

  const handleDelete = async (contactId: string) => {
    try {
      await contactsService.deleteContact(contactId);
      setConfirmDeleteId(null);
      toast.success("Contactul a fost șters!");
    } catch (e) {
      console.error(e);
      toast.error("Eroare la ștergerea contactului.");
    }
  };

  const filteredContacts = useMemo(() => {
    return contacts.filter((c, idx) => {
      // Type filter
      if (selectedType !== "Toate") {
        const filterDef = CONTACT_FILTERS.find(f => f.id === selectedType);
        if (filterDef && filterDef.types) {
          const cType = String(c.type || "");
          if (!filterDef.types.some(t => t.toLowerCase() === cType.toLowerCase())) {
            return false;
          }
        }
      }

      // Search filter
      const q = search.toLowerCase().trim();
      if (!q) return true;

      const formattedId = (c.contactId || `C${idx + 1}`).toLowerCase();
      const fullName = `${c.firstName || ""} ${c.lastName || ""}`.toLowerCase();
      const phoneMatch = (c.phone || "").toLowerCase().includes(q);
      const propMatch = (c.propertyId || "").toLowerCase().includes(q);
      const typeMatch = (TYPE_LABELS[c.type] || c.type || "").toLowerCase().includes(q);
      const commMatch = (c.commissionValue || "").toLowerCase().includes(q);

      return formattedId.includes(q) || fullName.includes(q) || phoneMatch || propMatch || typeMatch || commMatch;
    });
  }, [contacts, search, selectedType]);

  return (
    <div className="flex-1 flex flex-col h-full bg-gray-50 overflow-hidden">
      {/* Top Header / Action Bar */}
      <div className="bg-white border-b border-gray-200 shrink-0 h-[42px] min-h-[42px] max-h-[42px] box-border px-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <Users size={16} className="text-emerald-700 shrink-0" />
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="font-title text-[15px] font-semibold tracking-tight text-gray-900 truncate leading-tight">
              Contacte
            </h2>
            <span className="text-[11px] font-normal text-gray-500 bg-gray-100 px-2 py-0.5 rounded tabular-nums leading-none shrink-0">
              {contacts.length} total
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Quick Search */}
          <div className="relative w-56 sm:w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Caută după nume, ID (#C...), telefon..."
              className="w-full h-8 pl-9 pr-3 text-xs font-normal bg-gray-50 border border-gray-200 rounded-md placeholder:text-gray-400 focus:outline-none focus:bg-white focus:border-gray-400 transition-colors font-sans"
            />
          </div>

          {/* Add Contact Button */}
          <button
            type="button"
            onClick={onAddContactClick}
            className="h-8 px-3 flex items-center gap-2 text-xs font-medium bg-[#051D35] hover:bg-[#0a2b4a] text-white rounded-md transition-colors cursor-pointer shrink-0 shadow-xs"
          >
            <Plus size={14} className="text-[#BE9662]" />
            <span>Adaugă Contact</span>
          </button>
        </div>
      </div>

      {/* Sub-header Filter Tabs */}
      <div className="bg-transparent border-b border-gray-200 shrink-0 px-6 h-[42px] min-h-[42px] max-h-[42px] box-border flex items-center gap-2 overflow-x-auto no-scrollbar">
        {CONTACT_FILTERS.map((f) => {
          const count = f.id === "Toate" 
            ? contacts.length 
            : contacts.filter(c => {
                const cType = String(c.type || "");
                return f.types?.some(t => t.toLowerCase() === cType.toLowerCase());
              }).length;

          return (
            <button
              key={f.id}
              onClick={() => setSelectedType(f.id)}
              className={`h-7 px-3 flex items-center gap-2 text-xs rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                selectedType === f.id
                  ? "bg-[#051D35] text-white font-medium shadow-xs"
                  : "text-gray-600 hover:text-[#051D35] hover:bg-gray-100"
              }`}
            >
              <span>{f.label}</span>
              <span className={`text-[10px] px-1 rounded tabular-nums ${
                selectedType === f.id ? "bg-white/15 text-[#BE9662]" : "bg-gray-100 text-gray-500"
              }`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Table Container */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-6">
        {filteredContacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center bg-white rounded-xl border border-gray-200 p-8">
            <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-400 mb-3">
              <Users size={20} />
            </div>
            <h3 className="font-title text-sm font-semibold text-gray-900">Niciun contact găsit</h3>
            <p className="text-xs text-gray-500 mt-1 max-w-sm">
              {search 
                ? `Nu există niciun contact care să corespundă căutării "${search}".` 
                : "Nu aveți niciun contact înregistrat în această categorie."}
            </p>
            <button
              type="button"
              onClick={onAddContactClick}
              className="mt-4 h-8 px-4 flex items-center gap-2 text-xs font-medium bg-[#051D35] text-white rounded-md hover:bg-[#0a2b4a] transition-colors"
            >
              <Plus size={14} className="text-[#BE9662]" />
              <span>Adaugă primul contact</span>
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50/80 border-b border-gray-200 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="py-3 px-4 w-28">ID</th>
                  <th className="py-3 px-4">Nume și Prenume</th>
                  <th className="py-3 px-4 w-32">Tip</th>
                  <th className="py-3 px-4">Telefon</th>
                  <th className="py-3 px-4">Proprietate Asociată</th>
                  <th className="py-3 px-4">Comision</th>
                  <th className="py-3 px-4 text-right w-32">Acțiuni</th>
                </tr>
              </thead>
              <VirtualizedTbody
                items={filteredContacts}
                colSpan={7}
                scrollContainerRef={scrollContainerRef}
                estimateRowHeight={52}
                getItemKey={(contact, idx) => contact.id || `contact-${idx}`}
                className="divide-y divide-gray-100"
                renderRow={(contact, idx, rowRef) => {
                  const displayId = contact.contactId || `C${idx + 1}`;
                  const isConfirmingDelete = confirmDeleteId === contact.id;

                  return (
                    <tr
                      ref={rowRef}
                      onClick={() => onContactClick?.(contact)}
                      className={`hover:bg-gray-50/70 transition-colors group ${onContactClick ? "cursor-pointer" : ""}`}
                    >
                      {/* ID Client */}
                      <td className="py-3 px-4 font-normal text-gray-900 tabular-nums">
                        <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-1 rounded text-[11px] font-normal">
                          #{displayId}
                        </span>
                      </td>

                      {/* Name */}
                      <td className="py-3 px-4 font-normal text-gray-900">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center text-[10px] font-semibold uppercase">
                            {(contact.firstName?.[0] || "") + (contact.lastName?.[0] || "")}
                          </div>
                          <span>
                            {contact.firstName} {contact.lastName}
                          </span>
                        </div>
                      </td>

                      {/* Type Badge */}
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center px-2 py-1 rounded text-[11px] font-normal border ${TYPE_COLORS[contact.type] || "bg-gray-100 text-gray-700"}`}>
                          {TYPE_LABELS[contact.type] || contact.type}
                        </span>
                      </td>

                      {/* Phone */}
                      <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-2">
                          <a 
                            href={`tel:${contact.phone}`}
                            className="text-gray-700 hover:text-[#BE9662] hover:underline flex items-center gap-1 tabular-nums font-normal"
                          >
                            <Phone size={12} className="text-gray-400" />
                            {contact.phone}
                          </a>
                          <button
                            type="button"
                            onClick={() => handleCopyPhone(contact.phone, contact.id || displayId)}
                            className="p-1 text-gray-400 hover:text-[#051D35] rounded transition-colors"
                            title="Copiază numărul"
                          >
                            {copiedPhone === (contact.id || displayId) ? (
                              <Check size={12} className="text-[#BE9662]" />
                            ) : (
                              <Copy size={12} />
                            )}
                          </button>
                        </div>
                      </td>

                      {/* Associated Property */}
                      <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                        {contact.propertyId ? (
                          <div 
                            onClick={() => onSelectProperty?.(contact.propertyId)}
                            className="inline-flex items-center gap-2 text-[11px] font-normal text-[#BE9662] hover:text-[#967243] hover:underline cursor-pointer tabular-nums"
                          >
                            <Building2 size={12} />
                            <span>#{contact.propertyId}</span>
                          </div>
                        ) : (
                          <span className="text-gray-400 italic text-[11px]">-</span>
                        )}
                      </td>

                      {/* Commission */}
                      <td className="py-3 px-4">
                        {contact.commissionValue ? (
                          <div className="flex items-center gap-1 text-gray-800 font-normal tabular-nums">
                            <Percent size={11} className="text-gray-400" />
                            <span>{contact.commissionValue}</span>
                          </div>
                        ) : (
                          <span className="text-gray-400 italic text-[11px]">-</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          {/* vCard download */}
                          <button
                            type="button"
                            onClick={() => downloadVCard(contact, contact.propertyId)}
                            className="p-2 text-gray-400 hover:text-[#BE9662] hover:bg-gray-100 rounded-md transition-colors"
                            title="Descarcă vCard"
                          >
                            <Download size={13} />
                          </button>

                          {/* Delete Contact */}
                          {contact.id && (
                            isConfirmingDelete ? (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleDelete(contact.id!)}
                                  className="px-2 py-1 bg-red-600 text-white text-[10px] font-semibold rounded hover:bg-red-700 transition-colors"
                                >
                                  Șterge
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="px-2 py-1 bg-gray-200 text-gray-700 text-[10px] rounded hover:bg-gray-300 transition-colors"
                                >
                                  Anulează
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(contact.id!)}
                                className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                                title="Șterge clientul"
                              >
                                <Trash2 size={13} />
                              </button>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                }}
              />
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
