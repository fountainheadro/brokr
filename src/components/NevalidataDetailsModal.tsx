import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  X, 
  Globe, 
  Save, 
  Trash2, 
  ArrowUpRight, 
  ClipboardCopy, 
  Phone, 
  User, 
  AlertTriangle, 
  Share2, 
  Tag, 
  MapPin, 
  Home, 
  FileText,
  Building2,
  ClipboardList,
  XCircle,
  RotateCcw,
  Plus
} from "lucide-react";
import { Lead } from "../services/leadsService";
import { CATEGORIA_OPTIONS, ORAS_OPTIONS } from "../constants";
import toast from "react-hot-toast";
import { getPublicShareUrl } from "../utils/shareUtils";

interface NevalidataDetailsModalProps {
  isOpen: boolean;
  lead: Lead | null;
  onClose: () => void;
  onMoveToCalificata?: (leadId: string, updatedData: Partial<Lead>) => Promise<void>;
  onConvertToImobil?: (leadId: string, updatedData: Partial<Lead>) => Promise<void>;
  onConvertToCerere?: (leadId: string, updatedData: Partial<Lead>) => Promise<void>;
  onMarkAsLost?: (leadId: string) => Promise<void>;
  onReactivate?: (leadId: string) => Promise<void>;
  onDeleteLead: (leadId: string) => Promise<void>;
  onSaveLead: (leadId: string, updatedData: Partial<Lead>) => Promise<void>;
}

export const NevalidataDetailsModal: React.FC<NevalidataDetailsModalProps> = ({
  isOpen,
  lead,
  onClose,
  onMoveToCalificata,
  onConvertToImobil,
  onConvertToCerere,
  onMarkAsLost,
  onReactivate,
  onDeleteLead,
  onSaveLead
}) => {
  if (!isOpen || !lead) return null;

  const [title, setTitle] = useState(lead.title || "");
  const [price, setPrice] = useState(lead.price || "");
  const [transactionType, setTransactionType] = useState<"Vânzare" | "Închiriere">(
    lead.transactionType === "Închiriere" || (lead.transactionType as string) === "Inchiriere"
      ? "Închiriere"
      : "Vânzare"
  );
  const [categoria, setCategoria] = useState(lead.categoria || "Apartament");
  const [ownerName, setOwnerName] = useState(lead.ownerName || "");
  const [ownerPhone, setOwnerPhone] = useState(lead.ownerPhone || "");
  const [notes, setNotes] = useState(lead.notes || "");
  
  // Surfaces and location FALLBACK to extractedData or top-level lead fields
  const [suprafata, setSuprafata] = useState(
    lead.extractedData?.crmData?.caracteristici?.suprafete?.utila || ""
  );
  const [oras, setOras] = useState(
    lead.extractedData?.crmData?.detaliiGenerale?.localizare?.oras || lead.zone || "Bucuresti"
  );

  const [saving, setSaving] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [copiedShare, setCopiedShare] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(lead.url);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
    toast.success("URL-ul sursă a fost copiat!");
  };

  const handleShare = async () => {
    if (!lead.id) return;
    const shareUrl = getPublicShareUrl(lead.id);
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedShare(true);
      setTimeout(() => setCopiedShare(false), 2000);
      toast.success("Linkul public al proprietății a fost copiat!");
    } catch {
      toast.success("Link: " + shareUrl);
    }
  };

  const getUpdatedLeadPayload = (): Partial<Lead> => {
    const currentExtracted: any = lead.extractedData || {
      crmData: {
        detaliiGenerale: {
          stadiu: "Active - Hot",
          tranzactie: transactionType === "Închiriere" ? "Inchiriere" : "Vanzare",
          categoria: categoria,
          localizare: {
            oras: oras,
            zona: [lead.zone || "Nespecificat"],
            strada: "",
            numar: "",
            bloc: "",
            scara: "",
            apartament: ""
          },
          proprietar: ownerName,
          memoPrivat: notes
        },
        caracteristici: {
          detalii: {
            camere: "",
            bai: ""
          },
          suprafete: {
            utila: suprafata,
            construita: suprafata ? String((parseFloat(suprafata) || 0) * 1.2) : ""
          }
        }
      }
    };

    if (currentExtracted && currentExtracted.crmData) {
      currentExtracted.crmData.detaliiGenerale.categoria = categoria;
      currentExtracted.crmData.detaliiGenerale.tranzactie = transactionType === "Închiriere" ? "Inchiriere" : "Vanzare";
      currentExtracted.crmData.detaliiGenerale.proprietar = ownerName;
      if (!currentExtracted.crmData.detaliiGenerale.localizare) {
        currentExtracted.crmData.detaliiGenerale.localizare = {
          oras: oras,
          zona: [],
          strada: "",
          numar: "",
          bloc: "",
          scara: "",
          apartament: ""
        };
      }
      currentExtracted.crmData.detaliiGenerale.localizare.oras = oras;
      
      if (!currentExtracted.crmData.caracteristici) {
        currentExtracted.crmData.caracteristici = {
          detalii: { camere: "", bai: "" },
          suprafete: { utila: "", construita: "" }
        };
      }
      if (!currentExtracted.crmData.caracteristici.suprafete) {
        currentExtracted.crmData.caracteristici.suprafete = { utila: "", construita: "" };
      }
      currentExtracted.crmData.caracteristici.suprafete.utila = suprafata;
      currentExtracted.crmData.caracteristici.suprafete.construita = suprafata ? String(Math.round((parseFloat(suprafata) || 0) * 1.2)) : "";
    }

    return {
      title,
      price,
      transactionType,
      categoria,
      ownerName,
      ownerPhone,
      notes,
      zone: oras,
      extractedData: currentExtracted
    };
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = getUpdatedLeadPayload();
      await onSaveLead(lead.id!, payload);
      toast.success("Detalii salvate cu succes!");
      onClose();
    } catch (e) {
      console.error(e);
      toast.error("Eroare la salvarea detaliilor!");
    } finally {
      setSaving(false);
    }
  };

  const handleConvertToImobil = async () => {
    setSaving(true);
    try {
      const payload = getUpdatedLeadPayload();
      if (onConvertToImobil) {
        await onConvertToImobil(lead.id!, payload);
      } else if (onMoveToCalificata) {
        await onMoveToCalificata(lead.id!, payload);
      }
      onClose();
    } catch (e) {
      console.error(e);
      toast.error("Eroare la concretizarea în imobil!");
    } finally {
      setSaving(false);
    }
  };

  const handleConvertToCerere = async () => {
    setSaving(true);
    try {
      const payload = getUpdatedLeadPayload();
      if (onConvertToCerere) {
        await onConvertToCerere(lead.id!, payload);
      }
      onClose();
    } catch (e) {
      console.error(e);
      toast.error("Eroare la concretizarea în cerere!");
    } finally {
      setSaving(false);
    }
  };

  const handleMarkAsLost = async () => {
    setSaving(true);
    try {
      if (onMarkAsLost) {
        await onMarkAsLost(lead.id!);
      } else {
        await onSaveLead(lead.id!, { status: 'Pierdute' });
      }
      toast.success("Leadul a fost marcat ca Pierdut.");
      onClose();
    } catch (e) {
      console.error(e);
      toast.error("Eroare la mutarea în Pierdute!");
    } finally {
      setSaving(false);
    }
  };

  const handleReactivate = async () => {
    setSaving(true);
    try {
      if (onReactivate) {
        await onReactivate(lead.id!);
      } else {
        await onSaveLead(lead.id!, { status: 'Noi' });
      }
      toast.success("Leadul a fost reactivat ca Nou.");
      onClose();
    } catch (e) {
      console.error(e);
      toast.error("Eroare la reactivarea leadului!");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await onDeleteLead(lead.id!);
      toast.success("Proprietatea a fost ștearsă!");
      onClose();
    } catch (e) {
      console.error(e);
      toast.error("Eroare la ștergerea proprietății!");
    }
  };

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
          className="relative bg-white rounded-xl shadow-2xl border border-gray-200 w-full max-w-lg overflow-hidden z-10 flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gray-50/50 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <div className="w-8 h-8 rounded-lg bg-[#BE9662]/10 border border-[#BE9662]/20 flex items-center justify-center text-[#BE9662] shrink-0">
                <Globe size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-gray-900 leading-tight truncate">
                  Detalii Lead {lead.propertyId ? `#${lead.propertyId}` : ""}
                </h3>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`text-[10px] font-bold tracking-wider uppercase px-1.5 py-0.2 rounded border ${
                    lead.status === 'Pierdute' 
                      ? 'bg-rose-50 text-rose-700 border-rose-200' 
                      : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  }`}>
                    STATUS: {lead.status === 'Pierdute' ? 'PIERDUT' : 'NOU'}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0 ml-3">
              {lead.id && (
                <button
                  type="button"
                  onClick={handleShare}
                  className="h-7 px-2.5 rounded-md border border-gray-200 bg-white hover:bg-amber-50/50 hover:border-[#BE9662]/40 text-gray-700 hover:text-[#051D35] text-[11px] font-semibold flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer"
                  title="Copiază link public de prezentare"
                >
                  <Share2 size={12} className="text-[#BE9662]" />
                  <span>{copiedShare ? "Copiat!" : "Distribuie"}</span>
                </button>
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

          {/* Form Content */}
          <div className="p-5 space-y-3.5 text-xs overflow-y-auto">

            {/* URL Sursă Box */}
            <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-between gap-3 text-xs">
              <div className="min-w-0 flex-1">
                <span className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                  URL Sursă
                </span>
                <a
                  href={lead.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-[#BE9662] hover:underline truncate block text-xs"
                  title={lead.url}
                >
                  {lead.url}
                </a>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={handleCopyUrl}
                  className="h-7 px-2 border border-gray-200 rounded-md bg-white hover:bg-gray-100 text-gray-700 text-[11px] font-medium flex items-center gap-1 transition-colors cursor-pointer shadow-2xs"
                  title="Copiază URL sursă"
                >
                  <ClipboardCopy size={12} />
                  <span>{copiedUrl ? "Copiat!" : "Copiază"}</span>
                </button>
                <a
                  href={lead.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-7 h-7 flex items-center justify-center border border-gray-200 rounded-md bg-white hover:bg-gray-100 text-gray-600 transition-colors shadow-2xs"
                  title="Deschide în tab nou"
                >
                  <ArrowUpRight size={13} />
                </a>
              </div>
            </div>

            {/* Section Divider */}
            <div className="pt-1">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
                Detalii Identificate (corectează dacă e cazul)
              </span>
            </div>

            {/* Titlu Proprietate */}
            <div>
              <label className="block text-gray-700 font-semibold mb-1 flex items-center gap-1.5">
                <FileText size={12} className="text-[#BE9662]" />
                <span>Titlu Proprietate *</span>
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="ex. Închiriez apartament 2 camere..."
                className="w-full h-8 px-2.5 border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] bg-white text-xs text-gray-800 placeholder:text-gray-400"
              />
            </div>

            {/* Preț & Tip Tranzacție */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-gray-700 font-semibold mb-1 flex items-center gap-1.5">
                  <Tag size={12} className="text-[#BE9662]" />
                  <span>Preț</span>
                </label>
                <input
                  type="text"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="ex. 750 EUR / lună"
                  className="w-full h-8 px-2.5 border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] bg-white text-xs text-gray-800 placeholder:text-gray-400"
                />
              </div>

              <div>
                <label className="block text-gray-700 font-semibold mb-1">
                  Tip Tranzacție
                </label>
                <div className="grid grid-cols-2 gap-1 p-0.5 bg-gray-50 border border-gray-200 rounded-md h-8">
                  {(['Vânzare', 'Închiriere'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTransactionType(t)}
                      className={`h-full text-center rounded text-[11px] font-medium transition-all cursor-pointer flex items-center justify-center ${
                        transactionType === t
                          ? "bg-[#051D35] text-white shadow-xs font-semibold"
                          : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Categorie & Suprafață */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-gray-700 font-semibold mb-1 flex items-center gap-1.5">
                  <Home size={12} className="text-[#BE9662]" />
                  <span>Categorie</span>
                </label>
                <select
                  value={categoria}
                  onChange={(e) => setCategoria(e.target.value)}
                  className="w-full h-8 px-2.5 border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] bg-white text-xs text-gray-800 cursor-pointer"
                >
                  {CATEGORIA_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-gray-700 font-semibold mb-1">
                  Suprafață Utilă (mp)
                </label>
                <input
                  type="text"
                  value={suprafata}
                  onChange={(e) => setSuprafata(e.target.value)}
                  placeholder="ex. 65"
                  className="w-full h-8 px-2.5 border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] bg-white text-xs text-gray-800 placeholder:text-gray-400"
                />
              </div>
            </div>

            {/* Oraș / Localizare */}
            <div>
              <label className="block text-gray-700 font-semibold mb-1 flex items-center gap-1.5">
                <MapPin size={12} className="text-[#BE9662]" />
                <span>Oraș / Localizare</span>
              </label>
              <select
                value={oras}
                onChange={(e) => setOras(e.target.value)}
                className="w-full h-8 px-2.5 border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] bg-white text-xs text-gray-800 cursor-pointer"
              >
                {ORAS_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>

            {/* Date Contact Proprietar */}
            <div className="pt-2 border-t border-gray-100">
              <span className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Date Contact Proprietar
              </span>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-gray-700 font-semibold mb-1 flex items-center gap-1.5">
                    <User size={12} className="text-gray-400" />
                    <span>Nume Proprietar</span>
                  </label>
                  <input
                    type="text"
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    placeholder="ex. Popescu Ion"
                    className="w-full h-8 px-2.5 border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] bg-white text-xs text-gray-800 placeholder:text-gray-400"
                  />
                </div>

                <div>
                  <label className="block text-gray-700 font-semibold mb-1 flex items-center gap-1.5">
                    <Phone size={12} className="text-gray-400" />
                    <span>Telefon Proprietar</span>
                  </label>
                  <input
                    type="tel"
                    value={ownerPhone}
                    onChange={(e) => setOwnerPhone(e.target.value)}
                    placeholder="07xxxxxxxx"
                    className="w-full h-8 px-2.5 border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] bg-white text-xs text-gray-800 placeholder:text-gray-400"
                  />
                </div>
              </div>
            </div>

            {/* Notițe / Observații */}
            <div className="pt-2 border-t border-gray-100">
              <label className="block text-gray-700 font-semibold mb-1 flex items-center gap-1.5">
                <FileText size={12} className="text-[#BE9662]" />
                <span>Observații / Detalii Interne</span>
              </label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Observații despre lead sau imobil..."
                className="w-full p-2 border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] bg-white text-xs text-gray-800 resize-none placeholder:text-gray-400"
              />
            </div>

          </div>

          {/* Footer Bar */}
          <div className="px-5 py-3.5 flex items-center justify-between border-t border-gray-100 bg-gray-50/50 shrink-0 gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              {showConfirmDelete ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-red-600 flex items-center gap-1">
                    <AlertTriangle size={13} />
                    Sigur?
                  </span>
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="h-8 px-2.5 bg-red-600 hover:bg-red-700 text-white rounded-md text-xs font-semibold transition-colors cursor-pointer"
                  >
                    Da, șterge
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowConfirmDelete(false)}
                    className="h-8 px-2 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-md text-xs font-medium transition-colors cursor-pointer"
                  >
                    Nu
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowConfirmDelete(true)}
                  className="h-8 px-2.5 text-red-600 hover:bg-red-50 border border-transparent hover:border-red-200 rounded-md transition-colors cursor-pointer text-xs font-semibold flex items-center gap-1.5"
                  title="Șterge lead"
                >
                  <Trash2 size={13} />
                  <span>Șterge</span>
                </button>
              )}

              {lead.status === 'Pierdute' ? (
                <button
                  type="button"
                  onClick={handleReactivate}
                  disabled={saving}
                  className="h-8 px-2.5 bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-800 rounded-md text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  title="Re-activează leadul ca Nou"
                >
                  <RotateCcw size={12} className="text-amber-600" />
                  <span>Reactivează ca Nou</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleMarkAsLost}
                  disabled={saving}
                  className="h-8 px-2.5 bg-white hover:bg-rose-50 border border-gray-200 hover:border-rose-200 text-gray-600 hover:text-rose-700 rounded-md text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  title="Marchează leadul ca Pierdut dacă nu se concretizează"
                >
                  <XCircle size={12} className="text-gray-400 group-hover:text-rose-600" />
                  <span>Pierdut</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5 flex-wrap justify-end">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="h-8 px-3 border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 font-medium rounded-md transition-colors shadow-2xs text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Save size={13} />
                <span>Salvează</span>
              </button>

              <button
                type="button"
                onClick={handleConvertToImobil}
                disabled={saving}
                className="h-8 px-3.5 bg-[#051D35] hover:bg-[#0a2b4a] text-white font-medium rounded-md transition-colors shadow-xs text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                title="Concretizează leadul într-un Imobil nou pe piață"
              >
                <Plus size={14} className="text-[#BE9662]" />
                <span>Adaugă Imobil</span>
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
