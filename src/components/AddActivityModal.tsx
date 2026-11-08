import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  X, 
  Calendar as CalendarIcon, 
  Building2, 
  User, 
  Phone, 
  Clock, 
  Loader2, 
  Tag
} from "lucide-react";
import { activityService, ActivityType } from "../services/activityService";
import toast from "react-hot-toast";

interface AddActivityModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultPropertyId?: string;
  defaultClientId?: string;
  defaultClientName?: string;
  defaultClientPhone?: string;
  defaultDate?: string;
  defaultHour?: string;
}

const ACTIVITY_TYPES: ActivityType[] = [
  "Vizionare",
  "Întâlnire",
  "Apel",
  "Evaluare",
  "Semnare",
  "Notă",
  "Altele"
];

export const AddActivityModal: React.FC<AddActivityModalProps> = ({
  isOpen,
  onClose,
  defaultPropertyId = "",
  defaultClientId = "",
  defaultClientName = "",
  defaultClientPhone = "",
  defaultDate = "",
  defaultHour = ""
}) => {
  const [type, setType] = useState<ActivityType>("Vizionare");
  const [propertyId, setPropertyId] = useState(defaultPropertyId);
  const [clientName, setClientName] = useState(defaultClientName);
  const [clientPhone, setClientPhone] = useState(defaultClientPhone);
  const [staffName, setStaffName] = useState("");
  const [date, setDate] = useState(() => defaultDate || new Date().toISOString().split("T")[0]);
  const [hour, setHour] = useState(() => defaultHour || "14:00");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (defaultDate) setDate(defaultDate);
      if (defaultHour) setHour(defaultHour);
      if (defaultPropertyId) setPropertyId(defaultPropertyId);
      if (defaultClientName) setClientName(defaultClientName);
      if (defaultClientPhone) setClientPhone(defaultClientPhone);
    }
  }, [isOpen, defaultDate, defaultHour, defaultPropertyId, defaultClientName, defaultClientPhone]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName.trim()) {
      toast.error("Numele clientului este obligatoriu.");
      return;
    }

    if (!date || !hour) {
      toast.error("Data și ora sunt obligatorii.");
      return;
    }

    setIsSubmitting(true);
    try {
      await activityService.addActivity({
        type,
        propertyId: propertyId.trim() || undefined,
        clientId: defaultClientId || undefined,
        clientName: clientName.trim(),
        clientPhone: clientPhone.trim() || undefined,
        staffName: staffName.trim() || undefined,
        date,
        hour,
        notes: notes.trim() || undefined,
        status: "Programată"
      });

      toast.success("Activitatea a fost înregistrată cu succes!");
      setPropertyId("");
      setClientName("");
      setClientPhone("");
      setStaffName("");
      setNotes("");
      onClose();
    } catch (error) {
      console.error(error);
      toast.error("Eroare la adăugarea activității.");
    } finally {
      setIsSubmitting(false);
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
                <CalendarIcon size={18} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Adaugă Activitate Nouă</h3>
                <p className="text-[11px] text-gray-500">Generare automată ID activitate (#A1, #A1022...)</p>
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
            {/* Tip Activitate */}
            <div>
              <label className="block text-gray-700 font-semibold mb-1 flex items-center gap-1.5">
                <Tag size={12} className="text-[#BE9662]" />
                <span>Tip Activitate</span>
              </label>
              <div className="grid grid-cols-4 gap-1 p-1 bg-gray-50 border border-gray-200 rounded-lg">
                {ACTIVITY_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={`py-1 text-center rounded-md text-[11px] font-medium transition-all cursor-pointer ${
                      type === t
                        ? "bg-[#051D35] text-white shadow-xs font-semibold"
                        : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Client Name & Phone */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-gray-700 font-semibold mb-1">
                  Nume Client *
                </label>
                <div className="relative">
                  <User size={13} className="absolute left-2.5 top-2.5 text-gray-400" />
                  <input
                    type="text"
                    required
                    placeholder="ex. Maria Ionescu"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    className="w-full h-8 pl-8 pr-2 border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-gray-700 font-semibold mb-1">
                  Telefon Client
                </label>
                <div className="relative">
                  <Phone size={13} className="absolute left-2.5 top-2.5 text-gray-400" />
                  <input
                    type="tel"
                    placeholder="07xxxxxxxx"
                    value={clientPhone}
                    onChange={(e) => setClientPhone(e.target.value)}
                    className="w-full h-8 pl-8 pr-2 border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] bg-white"
                  />
                </div>
              </div>
            </div>

            {/* Property ID & Staff Name */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-gray-700 font-semibold mb-1">
                  ID Proprietate (opțional)
                </label>
                <div className="relative">
                  <Building2 size={13} className="absolute left-2.5 top-2.5 text-gray-400" />
                  <input
                    type="text"
                    placeholder="ex. P17246 sau ID"
                    value={propertyId}
                    onChange={(e) => setPropertyId(e.target.value)}
                    className="w-full h-8 pl-8 pr-2 border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-gray-700 font-semibold mb-1">
                  Agent / Responsabil
                </label>
                <input
                  type="text"
                  placeholder="ex. Dan Popa"
                  value={staffName}
                  onChange={(e) => setStaffName(e.target.value)}
                  className="w-full h-8 px-2.5 border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] bg-white"
                />
              </div>
            </div>

            {/* Date & Hour */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-gray-700 font-semibold mb-1">
                  Data *
                </label>
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full h-8 px-2.5 border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] bg-white"
                />
              </div>

              <div>
                <label className="block text-gray-700 font-semibold mb-1">
                  Ora *
                </label>
                <div className="relative">
                  <Clock size={13} className="absolute left-2.5 top-2.5 text-gray-400" />
                  <input
                    type="time"
                    required
                    value={hour}
                    onChange={(e) => setHour(e.target.value)}
                    className="w-full h-8 pl-8 pr-2 border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] bg-white"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-gray-700 font-semibold mb-1">
                Observații / Detalii
              </label>
              <textarea
                rows={2}
                placeholder="Detalii activitate, instrucțiuni de acces..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full p-2 border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] bg-white resize-none"
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
                disabled={isSubmitting}
                className="h-8 px-4 bg-[#051D35] hover:bg-[#0a2b4a] text-white font-medium rounded-md transition-colors shadow-xs disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    <span>Se salvează...</span>
                  </>
                ) : (
                  <span>Creează Activitate (#A...)</span>
                )}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
