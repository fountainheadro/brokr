import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Globe, Zap, Loader2, Building2 } from "lucide-react";
import { leadsService } from "../services/leadsService";
import { notificationsService } from "../services/notificationsService";
import { auth } from "../lib/firebase";
import toast from "react-hot-toast";

interface AddLeadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AddLeadModal: React.FC<AddLeadModalProps> = ({ isOpen, onClose }) => {
  const [url, setUrl] = useState("");
  const [leadRole, setLeadRole] = useState<'Proprietar' | 'Chirias' | 'Cumparator'>('Proprietar');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setLoading(true);
    setStatus("Accesare URL...");
    try {
      // 1. Initial crawl to get text and title only
      const crawlRes = await fetch("/api/crawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      
      if (!crawlRes.ok) {
        const errorText = await crawlRes.text();
        console.error("Crawl failed:", errorText);
        throw new Error(`Crawl failed with status ${crawlRes.status}`);
      }

      const contentTypeHeader = crawlRes.headers.get("content-type");
      if (!contentTypeHeader || !contentTypeHeader.includes("application/json")) {
        const textStr = await crawlRes.text();
        console.error("Expected JSON but got:", textStr.substring(0, 100));
        throw new Error("Server returned an invalid response (HTML instead of JSON)");
      }

      const crawlData = await crawlRes.json();
      const { title, price, zone, ownerName, ownerPhone, transactionType, categoria, crmData, coverImage } = crawlData;

      // 2. Save directly using crawler-extracted data (Zero AI spend, instant & robust)
      setStatus("Salvare...");
      const currentUser = auth.currentUser;
      const creatorName = currentUser?.displayName || (currentUser?.email ? currentUser.email.split('@')[0] : "Consilier Imobiliar");
      const creatorEmail = currentUser?.email || "";

      await leadsService.addLead({
        url: url.trim(),
        title: title || "Fără titlu",
        zone: zone || "Nespecificat",
        price: price || "N/A",
        ownerName: ownerName || "Nespecificat",
        ownerPhone: ownerPhone || "Nespecificat",
        transactionType: (transactionType as any) || (leadRole === 'Chirias' ? 'Închiriere' : 'Vânzare'),
        categoria: categoria || "Apartament",
        status: "Noi",
        leadType: leadRole,
        coverImage: coverImage || null,
        images: Array.isArray(crawlData.images) && crawlData.images.length > 0 
          ? crawlData.images 
          : (coverImage ? [coverImage] : []),
        createdByName: creatorName,
        createdByEmail: creatorEmail,
        author: creatorName,
        agent: creatorName,
        extractedData: crmData ? {
          crmData: crmData,
          presentationSections: crawlData.presentationSections || null,
          markdownMarketing: crmData.descriere?.continut || "",
          summary: crawlData.presentationSections?.introducere?.summary || `${categoria || "Proprietate"} ${crmData.caracteristici?.detalii?.camere || "2"} camere în ${zone || "București"}, ${price || "N/A"}`
        } : null
      });

      await notificationsService.addNotification({
        title: 'Proprietate Nouă Adăugată',
        message: `Proprietatea din ${zone || "zonă nespecificată"} a fost extrasă și adăugată cu succes.`,
        type: 'lead'
      });

      setUrl("");
      onClose();
      toast.success("Proprietatea a fost adăugată cu succes!");
    } catch (error: any) {
      console.error(error);
      setStatus("Eroare la adăugare");
      const errMessage = error?.message || "";
      if (errMessage.includes("HTML instead of JSON")) {
        toast.error("Serviciul de scanare este momentan indisponibil. Reîncercați în câteva secunde.");
      } else {
        toast.error(`Eroare la adăugarea proprietății: ${errMessage || "Eroare necunoscută"}`);
      }
    } finally {
      setLoading(false);
      setStatus("");
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
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
                <Building2 size={18} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Adaugă Imobil Nou</h3>
                <p className="text-[11px] text-gray-500">Scanare și extragere automată date din URL</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            <div>
              <label className="block text-[11px] font-semibold text-gray-700 mb-1.5">
                Tip Oportunitate / Lead
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['Proprietar', 'Chirias', 'Cumparator'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setLeadRole(r)}
                    className={`py-1.5 px-2 text-xs font-medium rounded-lg border text-center transition-all cursor-pointer ${
                      leadRole === r
                        ? "bg-[#051D35] text-white border-[#051D35] shadow-xs"
                        : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    {r === 'Chirias' ? 'Chiriaș' : (r === 'Cumparator' ? 'Cumpărător' : 'Proprietar')}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                Link Anunț Imobiliar *
              </label>
              <div className="relative">
                <Globe size={14} className="absolute left-3 top-2.5 text-gray-400" />
                <input
                  ref={inputRef}
                  type="url"
                  required
                  placeholder="https://www.storia.ro/... sau olx.ro, imobiliare.ro"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662]"
                />
              </div>
              <p className="text-[11px] text-gray-400 mt-1.5">
                Crawlerul va extrage automat detaliile, imaginile, prețul și contactul.
              </p>
            </div>

            {loading && status && (
              <div className="flex items-center gap-2 px-3 py-2 bg-[#BE9662]/10 border border-[#BE9662]/20 rounded-lg text-xs text-[#051D35]">
                <Loader2 size={14} className="animate-spin text-[#BE9662] shrink-0" />
                <span className="font-medium">{status}</span>
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
              >
                Anulează
              </button>
              <button
                type="submit"
                disabled={loading || !url.trim()}
                className="px-4 py-2 text-xs font-medium bg-[#051D35] hover:bg-[#0a2b4a] text-white rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    <span>Se procesează...</span>
                  </>
                ) : (
                  <>
                    <Zap size={14} className="text-amber-400 fill-amber-400" />
                    <span>Scanează & Adaugă</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
