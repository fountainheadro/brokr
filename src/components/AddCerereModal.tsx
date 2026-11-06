import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, ClipboardList, Loader2, Euro, Phone, User, MapPin } from "lucide-react";
import { leadsService } from "../services/leadsService";
import { notificationsService } from "../services/notificationsService";
import toast from "react-hot-toast";

interface AddCerereModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const AddCerereModal: React.FC<AddCerereModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [transactionType, setTransactionType] = useState<"Vânzare" | "Închiriere">("Vânzare");
  const [categoria, setCategoria] = useState("Apartament");
  const [zone, setZone] = useState("");
  const [budget, setBudget] = useState("");
  const [requirements, setRequirements] = useState("");
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName.trim() || !clientPhone.trim()) {
      toast.error("Numele clientului și telefonul sunt obligatorii.");
      return;
    }

    setLoading(true);
    try {
      const displayBudget = budget ? `${budget.trim()} €` : "La cerere";
      const title = `Cerere: ${categoria} ${transactionType === "Vânzare" ? "Cumpărare" : "Închiriere"} - ${zone || "București"}`;

      await leadsService.addLead({
        url: "",
        title,
        zone: zone.trim() || "București",
        price: displayBudget,
        ownerName: clientName.trim(),
        ownerPhone: clientPhone.trim(),
        transactionType,
        categoria,
        status: "Noua",
        notes: requirements.trim() ? `Cerințe cerere: ${requirements.trim()}` : ""
      });

      await notificationsService.addNotification({
        title: "Cerere Nouă Înregistrată",
        message: `${clientName} caută ${categoria} (${transactionType === "Vânzare" ? "cumpărare" : "închiriere"}) în ${zone || "București"}.`,
        type: "lead"
      });

      toast.success("Cererea a fost înregistrată cu succes!");
      setClientName("");
      setClientPhone("");
      setZone("");
      setBudget("");
      setRequirements("");
      onClose();
      if (onSuccess) onSuccess();
    } catch (err: any) {
      console.error("Eroare la salvarea cererii:", err);
      toast.error("Eroare la salvarea cererii. Încercați din nou.");
    } finally {
      setLoading(false);
    }
  };

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
                <ClipboardList size={18} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Adaugă Cerere Nouă</h3>
                <p className="text-[11px] text-gray-500">Înregistrează o cerere de căutare cumpărător sau chiriaș</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  Nume Client *
                </label>
                <div className="relative">
                  <User size={14} className="absolute left-3 top-2.5 text-gray-400" />
                  <input
                    type="text"
                    required
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="ex. Radu Popescu"
                    className="w-full pl-8 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  Telefon *
                </label>
                <div className="relative">
                  <Phone size={14} className="absolute left-3 top-2.5 text-gray-400" />
                  <input
                    type="tel"
                    required
                    value={clientPhone}
                    onChange={(e) => setClientPhone(e.target.value)}
                    placeholder="07xxxxxxxx"
                    className="w-full pl-8 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662]"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  Tip Tranzacție
                </label>
                <select
                  value={transactionType}
                  onChange={(e) => setTransactionType(e.target.value as any)}
                  className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] bg-white"
                >
                  <option value="Vânzare">Cumpărare</option>
                  <option value="Închiriere">Închiriere</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  Categorie
                </label>
                <select
                  value={categoria}
                  onChange={(e) => setCategoria(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] bg-white"
                >
                  <option value="Apartament">Apartament</option>
                  <option value="Garsonieră">Garsonieră / Studio</option>
                  <option value="Casă / Vilă">Casă / Vilă</option>
                  <option value="Spațiu Comercial">Spațiu Comercial</option>
                  <option value="Birou">Birou</option>
                  <option value="Teren">Teren</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  Zonă preferată
                </label>
                <div className="relative">
                  <MapPin size={14} className="absolute left-3 top-2.5 text-gray-400" />
                  <input
                    type="text"
                    value={zone}
                    onChange={(e) => setZone(e.target.value)}
                    placeholder="ex. Floreasca, Titan"
                    className="w-full pl-8 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  Buget Maxim (€)
                </label>
                <div className="relative">
                  <Euro size={14} className="absolute left-3 top-2.5 text-gray-400" />
                  <input
                    type="text"
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    placeholder="ex. 120000 sau 600"
                    className="w-full pl-8 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662]"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                Cerințe Specifice & Note
              </label>
              <textarea
                rows={3}
                value={requirements}
                onChange={(e) => setRequirements(e.target.value)}
                placeholder="ex. Minim 60mp, decomandat, loc parcare, bloc după 2015..."
                className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] resize-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Anulează
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 text-xs font-medium bg-[#051D35] hover:bg-[#0a2b4a] text-white rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                {loading && <Loader2 size={13} className="animate-spin" />}
                <span>Salvează Cererea</span>
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
