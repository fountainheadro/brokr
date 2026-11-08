import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, User, Phone, Home, Loader2, Euro, UserPlus } from "lucide-react";
import { contactsService, ContactType } from "../services/contactsService";
import toast from "react-hot-toast";

interface AddContactModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultPropertyId?: string;
}

export const AddContactModal: React.FC<AddContactModalProps> = ({ isOpen, onClose, defaultPropertyId = "" }) => {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [commissionValue, setCommissionValue] = useState("");
  const [type, setType] = useState<ContactType>("Buyer");
  const [propertyId, setPropertyId] = useState(defaultPropertyId);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setPropertyId(defaultPropertyId || "");
      setCommissionValue("");
    }
  }, [isOpen, defaultPropertyId]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !phone.trim() || !propertyId.trim()) {
      toast.error("Vă rugăm să completați toate câmpurile obligatorii.");
      return;
    }

    setLoading(true);
    try {
      await contactsService.addContact({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim(),
        type,
        propertyId: propertyId.trim(),
        commissionValue: commissionValue.trim()
      });

      toast.success("Clientul a fost adăugat cu succes!");
      setFirstName("");
      setLastName("");
      setPhone("");
      setCommissionValue("");
      setPropertyId("");
      onClose();
    } catch (error: any) {
      console.error(error);
      toast.error("Eroare la adăugarea clientului.");
    } finally {
      setLoading(false);
    }
  };

  const types: ContactType[] = ["Owner", "Renter", "Buyer", "Agent"];

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
              <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600">
                <UserPlus size={18} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Adaugă Client Nou</h3>
                <p className="text-[11px] text-gray-500">Înregistrează un client nou cu ID automat (#C...)</p>
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
            {/* First Name & Last Name */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  Prenume *
                </label>
                <div className="relative">
                  <User size={14} className="absolute left-3 top-2.5 text-gray-400" />
                  <input
                    type="text"
                    required
                    placeholder="ex. Andrei"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662]"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  Nume *
                </label>
                <input
                  type="text"
                  required
                  placeholder="ex. Ionescu"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662]"
                />
              </div>
            </div>

            {/* Contact Type Selector */}
            <div>
              <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                Tip Contact
              </label>
              <div className="grid grid-cols-4 gap-1 p-1 bg-gray-50 border border-gray-200 rounded-lg">
                {types.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={`py-1.5 text-center rounded-md text-xs font-medium transition-all ${
                      type === t 
                        ? "bg-white text-gray-900 shadow-sm border border-gray-200/80 font-semibold" 
                        : "text-gray-500 hover:text-gray-900"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Phone */}
            <div>
              <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                Număr Telefon *
              </label>
              <div className="relative">
                <Phone size={14} className="absolute left-3 top-2.5 text-gray-400" />
                <input
                  type="tel"
                  required
                  placeholder="07xxxxxxxx"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662]"
                />
              </div>
            </div>

            {/* Commission & Property ID */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  Comision Estimativ
                </label>
                <div className="relative">
                  <Euro size={14} className="absolute left-3 top-2.5 text-gray-400" />
                  <input
                    type="text"
                    placeholder="ex. 2% sau 1000€"
                    value={commissionValue}
                    onChange={(e) => setCommissionValue(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  ID Proprietate *
                </label>
                <div className="relative">
                  <Home size={14} className="absolute left-3 top-2.5 text-gray-400" />
                  <input
                    type="text"
                    required
                    placeholder="ex. P17246 sau ID"
                    value={propertyId}
                    onChange={(e) => setPropertyId(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662]"
                  />
                </div>
              </div>
            </div>

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
                disabled={loading}
                className="px-4 py-2 text-xs font-medium bg-[#051D35] hover:bg-[#0a2b4a] text-white rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                {loading && <Loader2 size={13} className="animate-spin" />}
                <span>Salvează Contact</span>
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
