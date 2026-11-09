import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  X, 
  User, 
  Phone, 
  MapPin, 
  Tag, 
  Users, 
  Plus, 
  MessageCircle, 
  Trash2, 
  Share2, 
  Building2, 
  Check, 
  Copy, 
  ExternalLink,
  Globe
} from "lucide-react";
import { toast } from "react-hot-toast";
import { contactsService, Contact } from "../services/contactsService";
import { Lead, getLeadRole } from "../services/leadsService";
import { getPublicShareUrl } from "../utils/shareUtils";

const formatWhatsAppLink = (phone: string) => {
  const cleanPhone = phone.replace(/\D/g, "");
  const finalPhone = cleanPhone.startsWith("0") ? `40${cleanPhone.substring(1)}` : cleanPhone;
  return `https://wa.me/${finalPhone}`;
};

interface PropertyQuickViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  lead: Lead | null;
  contacts: Contact[];
  onContactClick: (contact: Contact) => void;
  onAddContactClick: () => void;
}

export const PropertyQuickViewModal: React.FC<PropertyQuickViewModalProps> = ({ 
  isOpen, 
  onClose, 
  lead, 
  contacts,
  onContactClick,
  onAddContactClick
}) => {
  const [copiedShare, setCopiedShare] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState(false);

  if (!isOpen || !lead) return null;

  const role = getLeadRole(lead);
  const renterBuyerContacts = contacts.filter(c => c.type === "Renter" || c.type === "Buyer");
  const ownerContacts = contacts.filter(c => c.type === "Owner");

  const handleShare = async () => {
    if (!lead.id) return;
    const shareUrl = getPublicShareUrl(lead.id);
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedShare(true);
      setTimeout(() => setCopiedShare(false), 2000);
      toast.success("Linkul public de prezentare a fost copiat!");
    } catch {
      toast.success("Link: " + shareUrl);
    }
  };

  const handleCopyPhone = async (phone: string) => {
    try {
      await navigator.clipboard.writeText(phone);
      setCopiedPhone(true);
      setTimeout(() => setCopiedPhone(false), 2000);
      toast.success("Numărul de telefon a fost copiat!");
    } catch {
      toast.error("Nu s-a putut copia numărul.");
    }
  };

  const internalId = lead.propertyId || (lead.id ? lead.id.slice(0, 5) : "");
  const rooms = lead.extractedData?.crmData?.caracteristici?.detalii?.camere;
  const suprafata = lead.extractedData?.crmData?.caracteristici?.suprafete?.utila;

  // Extract thumbnail
  const images = lead.extractedData?.crmData?.imagini;
  const rawFirstImage = (images && typeof images === 'object') ? (
    images?.living?.[0] || images?.camera?.[0] || images?.bucatarie?.[0] || images?.alteSpatii?.[0]
  ) : null;
  const displayImage = typeof rawFirstImage === 'object' && rawFirstImage !== null
    ? rawFirstImage.original
    : (typeof rawFirstImage === 'string' ? rawFirstImage : (lead.coverImage || null));

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[350] flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/40 backdrop-blur-[2px]"
        />

        {/* Modal Window */}
        <motion.div
          initial={{ opacity: 0, scale: 0.98, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.98, y: 10 }}
          className="relative bg-white rounded-xl shadow-2xl border border-gray-200 w-full max-w-2xl overflow-hidden z-10 flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gray-50/50 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <div className="w-8 h-8 rounded-lg bg-[#BE9662]/10 border border-[#BE9662]/20 flex items-center justify-center text-[#BE9662] shrink-0">
                <Building2 size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-semibold text-gray-900 truncate">
                    {lead.title}
                  </h3>
                  {internalId && (
                    <span className="text-[10px] font-mono font-semibold px-1.5 py-0.2 rounded bg-[#051D35]/5 text-[#051D35] border border-[#051D35]/15 shrink-0">
                      #{internalId}
                    </span>
                  )}
                  <span className={`text-[10px] font-semibold px-1.5 py-0.2 rounded border tracking-wide uppercase ${
                    role === 'Proprietar' 
                      ? 'bg-amber-50 text-amber-800 border-amber-200' 
                      : role === 'Chirias' 
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : 'bg-blue-50 text-blue-800 border-blue-200'
                  }`}>
                    {role === 'Chirias' ? 'Chiriaș' : (role === 'Cumparator' ? 'Cumpărător' : 'Proprietar')}
                  </span>
                </div>
                <p className="text-[11px] text-gray-500 truncate mt-0.5">
                  Detalii lead, proprietate și contacte interesate
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0 ml-3">
              {/* Share Button */}
              <button
                type="button"
                onClick={handleShare}
                className="h-8 px-2.5 rounded-md border border-gray-200 bg-white hover:bg-amber-50/50 hover:border-[#BE9662]/40 text-gray-700 hover:text-[#051D35] text-xs font-semibold flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer"
                title="Copiază link public de prezentare (fără date proprietar)"
              >
                {copiedShare ? <Check size={13} className="text-emerald-600" /> : <Share2 size={13} className="text-[#BE9662]" />}
                <span>{copiedShare ? "Copiat!" : "Distribuie"}</span>
              </button>

              {lead.id && (
                <a
                  href={getPublicShareUrl(lead.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-8 h-8 flex items-center justify-center rounded-md border border-gray-200 bg-white hover:bg-gray-50 text-gray-500 hover:text-gray-900 transition-colors shadow-2xs"
                  title="Deschide pagina publică a leadului"
                >
                  <Globe size={13} />
                </a>
              )}

              {lead.url && (
                <a
                  href={lead.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-8 h-8 flex items-center justify-center rounded-md border border-gray-200 bg-white hover:bg-gray-50 text-gray-500 hover:text-gray-900 transition-colors shadow-2xs"
                  title="Deschide anunțul sursă"
                >
                  <ExternalLink size={13} />
                </a>
              )}

              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
                title="Închide"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Body Content */}
          <div className="p-5 space-y-4 text-xs overflow-y-auto">

            {/* Property Overview Card */}
            <div className="p-4 bg-gray-50/50 border border-gray-200 rounded-lg space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Tag size={12} className="text-[#BE9662]" />
                  <span>Informații Imobil</span>
                </span>
                <span className="text-base font-bold text-[#051D35] font-mono">
                  {lead.price || "Preț la cerere"}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                <div className="sm:col-span-8 grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 rounded-md bg-white border border-gray-200">
                    <span className="block text-[10px] font-semibold text-gray-400 uppercase">Tranzacție</span>
                    <span className="font-semibold text-gray-800">{lead.transactionType || "Vânzare"}</span>
                  </div>

                  <div className="p-2.5 rounded-md bg-white border border-gray-200">
                    <span className="block text-[10px] font-semibold text-gray-400 uppercase">Categorie</span>
                    <span className="font-semibold text-gray-800">{lead.categoria || "Apartament"}</span>
                  </div>

                  <div className="p-2.5 rounded-md bg-white border border-gray-200">
                    <span className="block text-[10px] font-semibold text-gray-400 uppercase">Camere</span>
                    <span className="font-semibold text-gray-800">{rooms ? `${rooms} camere` : "-"}</span>
                  </div>

                  <div className="p-2.5 rounded-md bg-white border border-gray-200">
                    <span className="block text-[10px] font-semibold text-gray-400 uppercase">Suprafață utilă</span>
                    <span className="font-semibold text-gray-800">{suprafata ? `${suprafata} mp` : "-"}</span>
                  </div>

                  <div className="p-2.5 rounded-md bg-white border border-gray-200 col-span-2 flex items-center gap-1.5">
                    <MapPin size={13} className="text-[#BE9662] shrink-0" />
                    <span className="text-gray-700 font-medium truncate">{lead.zone || "București"}</span>
                  </div>
                </div>

                {/* Thumbnail */}
                <div className="sm:col-span-4">
                  <div className="w-full h-28 rounded-lg overflow-hidden bg-gray-100 border border-gray-200 flex items-center justify-center shadow-2xs">
                    {displayImage ? (
                      <img 
                        src={displayImage} 
                        alt={lead.title}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center text-gray-300">
                        <Building2 size={24} className="text-gray-300 mb-1" />
                        <span className="text-[10px] font-semibold uppercase text-gray-400">Fără imagine</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Split Sections: Proprietar & Contacte interesate */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">

              {/* Section 1: Proprietar */}
              <div className="p-4 bg-white border border-gray-200 rounded-lg space-y-3 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between pb-2 border-b border-gray-100">
                    <span className="text-[11px] font-semibold text-gray-700 flex items-center gap-1.5">
                      <User size={13} className="text-[#051D35]" />
                      <span>Proprietar</span>
                    </span>
                    <button
                      type="button"
                      onClick={onAddContactClick}
                      className="h-6 px-2 text-[11px] font-medium text-[#051D35] hover:bg-gray-100 rounded transition-colors flex items-center gap-1"
                      title="Adaugă contact"
                    >
                      <Plus size={12} className="text-[#BE9662]" />
                      <span>Adaugă</span>
                    </button>
                  </div>

                  {/* Primary Owner Box */}
                  <div className="mt-2.5 p-3 rounded-md bg-gray-50 border border-gray-200 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-gray-900 text-xs truncate">
                        {lead.ownerName || "Nespecificat"}
                      </span>
                      <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-amber-50 text-amber-800 border border-amber-200">
                        Principal
                      </span>
                    </div>

                    {lead.ownerPhone && lead.ownerPhone !== "Nespecificat" ? (
                      <div className="flex items-center justify-between pt-1.5 border-t border-gray-200/60">
                        <span className="font-mono font-bold text-gray-800 text-xs">
                          {lead.ownerPhone}
                        </span>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleCopyPhone(lead.ownerPhone)}
                            className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-white transition-colors"
                            title="Copiază telefon"
                          >
                            {copiedPhone ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                          </button>

                          <a
                            href={formatWhatsAppLink(lead.ownerPhone)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="h-5 px-1.5 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[10px] font-bold flex items-center gap-1 border border-emerald-200 transition-colors"
                            title="WhatsApp"
                          >
                            <MessageCircle size={10} />
                            <span>WA</span>
                          </a>
                        </div>
                      </div>
                    ) : (
                      <p className="text-[11px] text-gray-400 italic">Telefon nespecificat</p>
                    )}
                  </div>

                  {/* Additional Owner Contacts */}
                  {ownerContacts.length > 0 && (
                    <div className="mt-2.5 space-y-1.5">
                      <span className="text-[10px] font-semibold text-gray-400 uppercase block">
                        Alte contacte proprietar ({ownerContacts.length})
                      </span>
                      {ownerContacts.map((contact, idx) => (
                        <div
                          key={contact.id || idx}
                          onClick={() => { onContactClick(contact); onClose(); }}
                          className="flex items-center justify-between p-2 rounded bg-gray-50 hover:bg-gray-100/70 border border-gray-200 transition-colors cursor-pointer text-xs"
                        >
                          <span className="font-medium text-gray-800">{contact.firstName} {contact.lastName}</span>
                          <span className="font-mono text-gray-500 text-[11px]">{contact.phone}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Section 2: Contacte Interesate */}
              <div className="p-4 bg-white border border-gray-200 rounded-lg space-y-3 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between pb-2 border-b border-gray-100">
                    <span className="text-[11px] font-semibold text-gray-700 flex items-center gap-1.5">
                      <Users size={13} className="text-[#BE9662]" />
                      <span>Contacte Interesate ({renterBuyerContacts.length})</span>
                    </span>
                    <button
                      type="button"
                      onClick={onAddContactClick}
                      className="h-6 px-2 text-[11px] font-medium text-[#051D35] hover:bg-gray-100 rounded transition-colors flex items-center gap-1"
                      title="Adaugă client"
                    >
                      <Plus size={12} className="text-[#BE9662]" />
                      <span>Adaugă</span>
                    </button>
                  </div>

                  {renterBuyerContacts.length > 0 ? (
                    <div className="mt-2.5 space-y-1.5 max-h-48 overflow-y-auto">
                      {renterBuyerContacts.map((contact, idx) => (
                        <div
                          key={contact.id || idx}
                          onClick={() => { onContactClick(contact); onClose(); }}
                          className="flex items-center justify-between p-2.5 rounded bg-gray-50 hover:bg-gray-100/70 border border-gray-200 transition-colors cursor-pointer text-xs group"
                        >
                          <div>
                            <span className="font-semibold text-gray-900 block group-hover:text-[#051D35]">
                              {contact.firstName} {contact.lastName}
                            </span>
                            <span className={`text-[9px] font-semibold px-1.5 py-0.2 rounded mt-0.5 inline-block ${
                              contact.type === "Buyer" 
                                ? "bg-blue-50 text-blue-700 border border-blue-200" 
                                : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            }`}>
                              {contact.type === "Buyer" ? "Cumpărător" : "Chiriaș"}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-gray-600 text-[11px]">{contact.phone}</span>
                            <button
                              type="button"
                              onClick={async (e) => {
                                e.stopPropagation();
                                try {
                                  await contactsService.deleteContact(contact.id!);
                                  toast.success('Contact șters');
                                } catch {
                                  toast.error('Eroare la ștergere');
                                }
                              }}
                              className="p-1 text-gray-400 hover:text-red-600 rounded transition-colors"
                              title="Șterge contact"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-4 flex flex-col items-center justify-center py-6 text-center bg-gray-50 rounded border border-dashed border-gray-200">
                      <Users size={20} className="text-gray-300 mb-1" />
                      <p className="text-[11px] text-gray-400">Niciun contact alocat</p>
                    </div>
                  )}
                </div>
              </div>

            </div>

          </div>

          {/* Footer Bar */}
          <div className="px-5 py-3.5 flex items-center justify-between border-t border-gray-100 bg-gray-50/50 shrink-0">
            <span className="text-[11px] text-gray-400 font-mono">
              Status: <strong className="text-gray-700">{lead.status}</strong>
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="h-8 px-3 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors cursor-pointer text-xs font-medium"
              >
                Închide
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
