import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  X, 
  Play, 
  ShieldAlert, 
  Phone, 
  User, 
  MapPin, 
  AreaChart, 
  Trash2, 
  Edit, 
  Share2, 
  AlertTriangle,
  ArrowUpRight,
  FileText,
  Globe,
  ExternalLink
} from "lucide-react";
import { Lead } from "../services/leadsService";
import toast from "react-hot-toast";
import { getPublicShareUrl } from "../utils/shareUtils";

interface CalificataDetailsModalProps {
  isOpen: boolean;
  lead: Lead | null;
  onClose: () => void;
  onActivate: (leadId: string) => Promise<void>;
  onDeleteLead: (leadId: string) => Promise<void>;
  onOpenFullForm?: () => void;
}

export const CalificataDetailsModal: React.FC<CalificataDetailsModalProps> = ({
  isOpen,
  lead,
  onClose,
  onActivate,
  onDeleteLead,
  onOpenFullForm
}) => {
  const [activating, setActivating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [copiedShare, setCopiedShare] = useState(false);

  if (!isOpen || !lead) return null;

  const handleActivate = async () => {
    setActivating(true);
    try {
      await onActivate(lead.id!);
      toast.success("Proprietatea a fost activată și publicată pe piață!");
      onClose();
    } catch (e) {
      console.error(e);
      toast.error("Eroare la activarea proprietății!");
    } finally {
      setActivating(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onDeleteLead(lead.id!);
      toast.success("Proprietatea a fost ștearsă!");
      onClose();
    } catch (e) {
      console.error(e);
      toast.error("Eroare la ștergerea proprietății!");
    } finally {
      setDeleting(false);
    }
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

  const utilSurface = lead.extractedData?.crmData?.caracteristici?.suprafete?.utila || "";

  return (
    <AnimatePresence>
      {isOpen && (
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
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-8 h-8 rounded-lg bg-[#BE9662]/10 border border-[#BE9662]/20 flex items-center justify-center text-[#BE9662] shrink-0">
                  <ShieldAlert size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-title text-sm font-semibold text-gray-900 leading-tight truncate">
                    Proprietate Calificată
                  </h3>
                  <p className="text-[10px] font-semibold text-gray-400 tracking-wider uppercase mt-1">
                    STATUS: CALIFICATE · Pregătită de activare
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 ml-3">
                {lead.id && (
                  <button
                    type="button"
                    onClick={handleShare}
                    className="h-8 px-3 rounded-md border border-gray-200 bg-white hover:bg-amber-50/50 hover:border-[#BE9662]/40 text-gray-700 hover:text-[#051D35] text-[11px] font-semibold flex items-center gap-2 transition-all shadow-2xs cursor-pointer"
                    title="Copiază link public de prezentare"
                  >
                    <Share2 size={12} className="text-[#BE9662]" />
                    <span>{copiedShare ? "Copiat!" : "Distribuie"}</span>
                  </button>
                )}

                {lead.id && (
                  <a
                    href={getPublicShareUrl(lead.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-8 h-8 flex items-center justify-center rounded-md border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 transition-colors shadow-2xs"
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
                    className="w-8 h-8 flex items-center justify-center rounded-md border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 transition-colors shadow-2xs"
                    title="Deschide anunțul sursă"
                  >
                    <ExternalLink size={13} />
                  </a>
                )}

                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
                  title="Închide"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Scrollable specs block */}
            <div className="p-5 space-y-4 text-xs overflow-y-auto">
              {/* Badges & Title */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`px-2 py-1 rounded text-[10px] font-semibold uppercase tracking-wider ${
                    lead.transactionType === "Vânzare" || (lead.transactionType as string) === "Vanzare"
                      ? "bg-[#051D35] text-white"
                      : "bg-[#BE9662]/15 text-[#051D35] border border-[#BE9662]/30"
                  }`}>
                    {lead.transactionType}
                  </span>
                  <span className="px-2 py-1 rounded text-[10px] font-semibold uppercase tracking-wider bg-gray-100 text-gray-700 border border-gray-200">
                    {lead.categoria || "Nespecificat"}
                  </span>
                  {lead.propertyId && (
                    <span className="px-2 py-1 rounded text-[10px] font-semibold bg-[#051D35]/5 text-[#051D35] border border-[#051D35]/15 tabular-nums">
                      #{lead.propertyId}
                    </span>
                  )}
                </div>

                <h2 className="font-title text-sm font-semibold text-gray-900 leading-snug">
                  {lead.title}
                </h2>

                <div className="text-base font-normal text-[#051D35] tabular-nums">
                  {lead.price}
                </div>
              </div>

              {/* Grid specs */}
              <div className="grid grid-cols-2 gap-4 pt-1">
                <div className="flex flex-col min-w-0">
                  <span className="text-[11px] font-semibold text-gray-500 mb-1">Suprafață utilă</span>
                  <span className="text-[13px] font-normal text-gray-900 truncate tabular-nums">
                    {utilSurface ? `${utilSurface} mp` : "Nespecificat"}
                  </span>
                </div>

                <div className="flex flex-col min-w-0">
                  <span className="text-[11px] font-semibold text-gray-500 mb-1">Oraș / Localitate</span>
                  <span className="text-[13px] font-normal text-gray-900 truncate">
                    {lead.zone || "Nespecificat"}
                  </span>
                </div>
              </div>

              {/* Owner Info Block */}
              <div className="pt-4 border-t border-gray-100">
                <span className="font-title block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">
                  Date Contact Proprietar
                </span>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col min-w-0">
                    <span className="text-[11px] font-semibold text-gray-500 mb-1">Nume Proprietar</span>
                    <span className="text-[13px] font-normal text-gray-900 truncate">{lead.ownerName || "Nespecificat"}</span>
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[11px] font-semibold text-gray-500 mb-1">Telefon</span>
                    <span className="text-[13px] font-normal text-gray-900 truncate tabular-nums">{lead.ownerPhone || "Nespecificat"}</span>
                  </div>
                </div>
              </div>

              {/* Observații / Notițe */}
              <div className="pt-4 border-t border-gray-100">
                <label className="block text-[11px] font-semibold text-gray-500 mb-1">
                  Observații / Detalii Interne
                </label>
                <div className="text-[13px] font-normal text-gray-700 whitespace-pre-wrap leading-relaxed min-h-[48px]">
                  {lead.notes || "Fără observații suplimentare."}
                </div>
              </div>

              {/* External Source Link */}
              {lead.url && (
                <div className="pt-1 text-center">
                  <a
                    href={lead.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-xs text-[#BE9662] font-semibold hover:underline"
                  >
                    <span>Vezi anunțul original listat</span>
                    <ArrowUpRight size={12} />
                  </a>
                </div>
              )}
            </div>

            {/* Footer controls */}
            <div className="px-5 py-4 flex items-center justify-between border-t border-gray-100 bg-gray-50/50 shrink-0">
              {showDeleteConfirm ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-red-600 flex items-center gap-1">
                    <AlertTriangle size={13} />
                    Sigur?
                  </span>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={deleting}
                    className="h-8 px-3 bg-red-600 hover:bg-red-700 text-white rounded-md text-xs font-semibold transition-colors cursor-pointer"
                  >
                    Da, șterge
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(false)}
                    className="h-8 px-3 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-md text-xs font-medium transition-colors cursor-pointer"
                  >
                    Nu
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="h-8 px-3 text-red-600 hover:bg-red-50 border border-transparent hover:border-red-200 rounded-md transition-colors cursor-pointer text-xs font-semibold flex items-center gap-2"
                  title="Șterge lead"
                >
                  <Trash2 size={13} />
                  <span>Șterge</span>
                </button>
              )}

              <div className="flex items-center gap-2">
                {onOpenFullForm && (
                  <button
                    type="button"
                    onClick={onOpenFullForm}
                    className="h-8 px-4 border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 font-medium rounded-md transition-colors shadow-2xs text-xs flex items-center gap-2 cursor-pointer"
                  >
                    <Edit size={13} />
                    <span>Editează complet</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleActivate}
                  disabled={activating}
                  className="h-8 px-4 bg-[#051D35] hover:bg-[#0a2b4a] text-white font-medium rounded-md transition-colors shadow-xs text-xs flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <Play size={12} className="fill-current text-[#BE9662]" />
                  <span>Activează pe Piață</span>
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
