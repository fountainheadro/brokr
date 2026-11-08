import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, FileText, Building2, User, Link as LinkIcon, Loader2, Check } from "lucide-react";
import { documentService, DocumentType } from "../services/documentService";
import toast from "react-hot-toast";

interface AddDocumentModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultPropertyId?: string;
}

const DOCUMENT_TYPES: DocumentType[] = [
  "Contract",
  "Act Proprietate",
  "Cadastru & Intabulare",
  "Releveu",
  "Certificat Energetic",
  "Carte Identitate",
  "Procură",
  "Acord GDPR",
  "Proces Verbal",
  "Altele"
];

export const AddDocumentModal: React.FC<AddDocumentModalProps> = ({
  isOpen,
  onClose,
  defaultPropertyId = ""
}) => {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<DocumentType>("Contract");
  const [propertyId, setPropertyId] = useState(defaultPropertyId);
  const [clientId, setClientId] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Titlul documentului este obligatoriu.");
      return;
    }

    setLoading(true);
    try {
      const newDoc = await documentService.addDocument({
        title: title.trim(),
        type,
        propertyId: propertyId.trim() || undefined,
        clientId: clientId.trim() || undefined,
        fileUrl: fileUrl.trim() || undefined,
        notes: notes.trim() || undefined
      });

      toast.success("Documentul a fost înregistrat cu succes!");
      setTitle("");
      setType("Contract");
      setPropertyId("");
      setClientId("");
      setFileUrl("");
      setNotes("");
      onClose();
    } catch (error) {
      console.error(error);
      toast.error("Eroare la adăugarea documentului.");
    } finally {
      setLoading(false);
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
          className="relative bg-white rounded-xl shadow-2xl border border-gray-200 w-full max-w-md overflow-hidden z-10"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gray-50/50">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#BE9662]/10 border border-[#BE9662]/20 flex items-center justify-center text-[#BE9662]">
                <FileText size={18} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Adaugă Document Nou</h3>
                <p className="text-[11px] text-gray-500">Generare automată ID document (#D01, #D1029...)</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-5 space-y-3.5 text-xs">
            <div>
              <label className="block text-gray-700 font-semibold mb-1">
                Titlu document *
              </label>
              <input
                type="text"
                required
                placeholder="ex. Contract Închiriere Teclu #P12"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full h-8 px-3 border border-gray-200 rounded-md focus:outline-none focus:border-gray-400 bg-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-gray-700 font-semibold mb-1">
                  Tip document
                </label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as DocumentType)}
                  className="w-full h-8 px-2 border border-gray-200 rounded-md focus:outline-none focus:border-gray-400 bg-white cursor-pointer"
                >
                  {DOCUMENT_TYPES.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-gray-700 font-semibold mb-1">
                  ID Proprietate asociată
                </label>
                <div className="relative">
                  <Building2 size={13} className="absolute left-2.5 top-2.5 text-gray-400" />
                  <input
                    type="text"
                    placeholder="ex. P12 sau L5"
                    value={propertyId}
                    onChange={(e) => setPropertyId(e.target.value)}
                    className="w-full h-8 pl-8 pr-2 border border-gray-200 rounded-md focus:outline-none focus:border-gray-400 bg-white font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-gray-700 font-semibold mb-1">
                  ID / Nume Client
                </label>
                <div className="relative">
                  <User size={13} className="absolute left-2.5 top-2.5 text-gray-400" />
                  <input
                    type="text"
                    placeholder="ex. C4 sau Popescu"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    className="w-full h-8 pl-8 pr-2 border border-gray-200 rounded-md focus:outline-none focus:border-gray-400 bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-gray-700 font-semibold mb-1">
                  Link / URL Document
                </label>
                <div className="relative">
                  <LinkIcon size={13} className="absolute left-2.5 top-2.5 text-gray-400" />
                  <input
                    type="url"
                    placeholder="https://..."
                    value={fileUrl}
                    onChange={(e) => setFileUrl(e.target.value)}
                    className="w-full h-8 pl-8 pr-2 border border-gray-200 rounded-md focus:outline-none focus:border-gray-400 bg-white"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-gray-700 font-semibold mb-1">
                Notițe / Detalii
              </label>
              <textarea
                rows={2}
                placeholder="Observații, valabilitate, semnatari..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full p-2 border border-gray-200 rounded-md focus:outline-none focus:border-gray-400 bg-white resize-none"
              />
            </div>

            <div className="pt-2 flex items-center justify-end gap-2 border-t border-gray-100">
              <button
                type="button"
                onClick={onClose}
                className="h-8 px-3 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors cursor-pointer"
              >
                Anulează
              </button>
              <button
                type="submit"
                disabled={loading}
                className="h-8 px-4 bg-[#051D35] hover:bg-[#0a2b4a] text-white font-medium rounded-md transition-colors shadow-xs disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
              >
                {loading ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    <span>Se salvează...</span>
                  </>
                ) : (
                  <span>Creează Document (#D...)</span>
                )}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
