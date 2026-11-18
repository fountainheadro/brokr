import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Clock, MapPin, Phone, MessageSquare, ExternalLink, Euro, Loader2, User } from "lucide-react";
import { Viewing } from "../services/viewingsService";
import { leadsService, Lead } from "../services/leadsService";
import { contactsService, Contact } from "../services/contactsService";
import { toast } from "react-hot-toast";
import { getThumbnailImageUrl } from "../utils/imageUtils";

interface ViewingDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  viewing: Viewing | null;
}

export const ViewingDetailsModal: React.FC<ViewingDetailsModalProps> = ({ isOpen, onClose, viewing }) => {
  const [lead, setLead] = useState<Lead | null>(null);
  const [owner, setOwner] = useState<Contact | null>(null);
  const [renter, setRenter] = useState<Contact | null>(null);
  const [agent, setAgent] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      if (!viewing || !isOpen) return;
      
      setLoading(true);
      try {
        // Fetch Lead
        const leadData = await leadsService.getLead(viewing.propertyId);
        setLead(leadData);

        // Fetch Contacts
        // We use a subscription strategy or a simple fetch. Since it's a modal, a one-off fetch is cleaner.
        // But contactsService only has subscribe. Let's add a getPropertyContacts to contactsService or use getDocs here.
        // Actually, let's just use the service's existing capabilities or perform a query here.
        // I'll add getPropertyContacts to contactsService for better reuse.
        
        // For now, I'll use a direct query here if I can't wait to update the service.
        // Actually, it's better to update the service.
      } catch (err) {
        console.error("Error fetching viewing details:", err);
        toast.error("Eroare la încărcarea detaliilor vizionării.");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [viewing, isOpen]);

  // Secondary effect to fetch contacts once lead is loaded
  useEffect(() => {
    if (!lead || !viewing) return;

    // Filter contacts that are already in the database
    const unsub = contactsService.subscribeToPropertyContacts(lead.id!, (contacts) => {
      const ownerContact = contacts.find(c => c.type === 'Owner');
      const renterContact = contacts.find(c => c.id === viewing.contactId);
      const agentContact = viewing.agentId ? contacts.find(c => c.id === viewing.agentId) : null;
      
      setOwner(ownerContact || null);
      setRenter(renterContact || null);
      setAgent(agentContact || null);
    });

    return () => unsub();
  }, [lead, viewing]);

  if (!isOpen || !viewing) return null;

  const openInMaps = () => {
    const loc = lead?.extractedData?.crmData?.detaliiGenerale?.localizare;
    if (!loc) return;
    const addressParts = [loc.strada, loc.numar, loc.bloc, loc.oras]
      .filter(p => p && p !== "-")
      .join(", ");
    if (!addressParts) return;
    window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressParts)}`, '_blank');
  };

  const getWhatsAppLink = (phone: string) => {
    const cleanPhone = phone.replace(/\D/g, "");
    const finalPhone = cleanPhone.startsWith("0") ? `40${cleanPhone.substring(1)}` : cleanPhone;
    return `https://wa.me/${finalPhone}`;
  };

  // Get first image
  const images = lead?.extractedData?.crmData?.imagini;
  const categoria = String(lead?.extractedData?.crmData?.detaliiGenerale?.categoria || '').toLowerCase();
  const isResidential = !categoria.includes('comercial') && 
                         !categoria.includes('spatiu') && 
                         !categoria.includes('depozit') && 
                         !categoria.includes('hala') && 
                         !categoria.includes('industrial') && 
                         !categoria.includes('birou');

  const rawFirstImage = (images && typeof images === 'object') ? (
    isResidential ? (
      (images?.living?.[0]) || 
      (images?.camera?.[0]) || 
      (images?.bucatarie?.[0]) || 
      (images?.baie?.[0]) || 
      (images?.alteSpatii?.[0]) || 
      lead?.coverImage
    ) : (
      (images?.alteSpatii?.[0]) || 
      (images?.living?.[0]) || 
      (images?.camera?.[0]) || 
      (images?.bucatarie?.[0]) || 
      (images?.baie?.[0]) || 
      lead?.coverImage
    )
  ) : lead?.coverImage;

  const displayImage = typeof rawFirstImage === 'object' && rawFirstImage !== null
    ? rawFirstImage.original 
    : (typeof rawFirstImage === 'string' ? rawFirstImage : null);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/60 z-[400] backdrop-blur-sm"
      />
      
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        className="fixed bottom-0 left-0 right-0 max-w-2xl mx-auto bg-white rounded-t-[32px] z-[401] border-x border-t border-gray-100 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
      >
        <div className="w-12 h-1 bg-gray-100 rounded-full mx-auto my-4 shrink-0" />
        
        <div className="p-6 flex items-center justify-between bg-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[--color-accent]/10 flex items-center justify-center text-[--color-accent]">
              <Clock size={20} />
            </div>
            <div>
              <h2 className="font-title text-[18px] font-semibold text-gray-900 leading-tight">Detalii Vizionare</h2>
              <p className="text-[13px] text-gray-400 font-semibold uppercase tracking-wider">{viewing.date} • {viewing.hour}</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center bg-gray-50 rounded-full text-gray-400 hover:text-gray-900 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 pb-12">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <Loader2 size={40} className="animate-spin text-[--color-accent]" />
              <p className="text-gray-400 font-semibold text-[14px]">Se încarcă detaliile...</p>
            </div>
          ) : (
            <>
              {/* Property Card */}
              <div className="bg-gray-50/50 rounded-[16px] border border-gray-100 overflow-hidden">
                <div className="aspect-[16/9] w-full relative bg-gray-100">
                  {displayImage ? (
                    <img src={getThumbnailImageUrl(displayImage, 900)} alt="Property" decoding="async" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-300">
                      <ExternalLink size={40} />
                    </div>
                  )}
                  <div className="absolute top-4 right-4 px-3 py-2 bg-white/90 backdrop-blur shadow-sm rounded-full text-[14px] font-normal text-gray-900">
                    {lead?.price || 'Pret Nespecificat'}
                  </div>
                </div>
                <div className="p-5">
                  <h3 className="font-title text-[18px] font-semibold text-gray-900 mb-2 leading-tight">
                    {lead?.title || 'Proprietate Nespecificată'}
                  </h3>
                  {(() => {
                    const loc = lead?.extractedData?.crmData?.detaliiGenerale?.localizare;
                    const fullAddress = loc ? [loc.strada, loc.numar, loc.bloc, loc.oras].filter(p => p && p !== "-").join(", ") : null;
                    if (!fullAddress) return null;
                    return (
                      <div className="flex items-start gap-2 text-gray-500 mb-4 cursor-pointer hover:text-[--color-accent] transition-colors" onClick={openInMaps}>
                        <MapPin size={16} className="mt-1 shrink-0" />
                        <span className="text-[13px] font-normal leading-relaxed">{fullAddress}</span>
                      </div>
                    );
                  })()}
                  <button 
                    onClick={openInMaps}
                    className="w-full h-11 bg-white border border-gray-200 rounded-xl text-[13px] font-semibold text-gray-700 hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
                  >
                    <ExternalLink size={14} />
                    Deschide în Google Maps
                  </button>
                </div>
              </div>

              {/* Contacts & Commissions */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Renter/Buyer Card */}
                <div className="bg-white rounded-[16px] border border-gray-100 p-5 shadow-sm">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-full bg-[--color-brand-gold-light] flex items-center justify-center text-[--color-brand-gold]">
                      <User size={20} />
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-[--color-brand-gold] uppercase tracking-widest">Client (Chiriaș/Cumpărător)</p>
                      <h4 className="font-title text-[16px] font-semibold text-gray-900">{renter?.firstName} {renter?.lastName || viewing.contactName}</h4>
                    </div>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-3 bg-[--color-brand-gold-light]/30 rounded-xl border border-[--color-brand-gold-border]">
                      <div className="flex items-center gap-2">
                        <Euro size={16} className="text-[--color-brand-gold]" />
                        <span className="text-[12px] font-semibold text-gray-500">Comision Client</span>
                      </div>
                      <span className="text-[14px] font-normal text-gray-900">
                        {renter?.commissionValue || 
                         lead?.extractedData?.crmData?.pret?.comisioane?.comisionCumparatorValoare || 
                         (lead?.extractedData?.crmData?.pret?.comisioane?.comisionCumparatorProcent ? `${lead.extractedData.crmData.pret.comisioane.comisionCumparatorProcent}%` : 'Nespecificat')}
                      </span>
                    </div>
                    
                    <div className="flex gap-4">
                      <a 
                        href={`tel:${renter?.phone || ""}`}
                        className="flex-1 h-11 bg-gray-50 rounded-xl flex items-center justify-center gap-2 text-gray-700 hover:bg-gray-100 transition-colors"
                      >
                        <Phone size={14} />
                        <span className="text-[12px] font-semibold">Apel</span>
                      </a>
                      <a 
                        href={renter?.phone ? getWhatsAppLink(renter.phone) : "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="flex-1 h-11 bg-green-500 text-white rounded-xl flex items-center justify-center gap-2 hover:bg-green-600 transition-colors"
                      >
                        <MessageSquare size={14} />
                        <span className="text-[12px] font-semibold">WhatsApp</span>
                      </a>
                    </div>
                  </div>
                </div>

                {/* Owner Card */}
                <div className="bg-white rounded-[16px] border border-gray-100 p-5 shadow-sm">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center text-amber-500">
                      <User size={20} />
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-amber-500 uppercase tracking-widest">Proprietar</p>
                      <h4 className="font-title text-[16px] font-semibold text-gray-900">{owner ? `${owner.firstName} ${owner.lastName}` : (lead?.ownerName || 'Nespecificat')}</h4>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-3 bg-amber-50/30 rounded-xl border border-amber-50">
                      <div className="flex items-center gap-2">
                        <Euro size={16} className="text-amber-500" />
                        <span className="text-[12px] font-semibold text-gray-500">Comision Proprietar</span>
                      </div>
                      <span className="text-[14px] font-normal text-gray-900">
                        {owner?.commissionValue || 
                         lead?.extractedData?.crmData?.pret?.comisioane?.comisionProprietarValoare || 
                         (lead?.extractedData?.crmData?.pret?.comisioane?.comisionProprietarProcent ? `${lead.extractedData.crmData.pret.comisioane.comisionProprietarProcent}%` : 'Nespecificat')}
                      </span>
                    </div>

                    <div className="flex gap-4">
                      <a 
                        href={`tel:${owner?.phone || lead?.ownerPhone || ""}`}
                        className="flex-1 h-11 bg-gray-50 rounded-xl flex items-center justify-center gap-2 text-gray-700 hover:bg-gray-100 transition-colors"
                      >
                        <Phone size={14} />
                        <span className="text-[12px] font-semibold">Apel</span>
                      </a>
                      <a 
                        href={(owner?.phone || lead?.ownerPhone) ? getWhatsAppLink(owner?.phone || lead!.ownerPhone) : "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="flex-1 h-11 bg-green-500 text-white rounded-xl flex items-center justify-center gap-2 hover:bg-green-600 transition-colors"
                      >
                        <MessageSquare size={14} />
                        <span className="text-[12px] font-semibold">WhatsApp</span>
                      </a>
                    </div>
                  </div>
                </div>

                {/* Agent Card */}
                {(agent || viewing.agentName) && (
                  <div className="bg-white rounded-[16px] border border-gray-100 p-5 shadow-sm md:col-span-2">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-full bg-[#BE9662]/10 flex items-center justify-center text-[#BE9662]">
                        <User size={20} />
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold text-[#BE9662] uppercase tracking-widest">Agent Asistent (Coleg)</p>
                        <h4 className="font-title text-[16px] font-semibold text-gray-900">{agent ? `${agent.firstName} ${agent.lastName}` : viewing.agentName}</h4>
                      </div>
                    </div>

                    <div className="flex gap-4">
                      <a 
                        href={`tel:${agent?.phone || ""}`}
                        className="flex-1 h-11 bg-gray-50 rounded-xl flex items-center justify-center gap-2 text-gray-700 hover:bg-gray-100 transition-colors"
                      >
                        <Phone size={14} />
                        <span className="text-[12px] font-semibold">Apel</span>
                      </a>
                      <a 
                        href={agent?.phone ? getWhatsAppLink(agent.phone) : "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="flex-1 h-11 bg-green-500 text-white rounded-xl flex items-center justify-center gap-2 hover:bg-green-600 transition-colors"
                      >
                        <MessageSquare size={14} />
                        <span className="text-[12px] font-semibold">WhatsApp</span>
                      </a>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
