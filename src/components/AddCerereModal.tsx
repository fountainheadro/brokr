import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, ClipboardList, Loader2, Plus } from "lucide-react";
import { leadsService } from "../services/leadsService";
import { notificationsService } from "../services/notificationsService";
import toast from "react-hot-toast";
import {
  CETATENIE_OPTIONS,
  NUMAR_CAMERE_OPTIONS,
  MultiSelectDropdown,
  PropertyCriteriaAccordionForm,
  createInitialPropertyCriteriaState,
  buildLeadPayloadFromCriteria,
  type PropertyCriteriaFormState,
} from "./PropertyCriteriaAccordionForm";

export { CETATENIE_OPTIONS, NUMAR_CAMERE_OPTIONS, MultiSelectDropdown };

interface AddCerereModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const AddCerereModal: React.FC<AddCerereModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [leadRole, setLeadRole] = useState<"Chirias" | "Cumparator">("Chirias");
  const [formState, setFormState] = useState<PropertyCriteriaFormState>(() =>
    createInitialPropertyCriteriaState()
  );
  const [loading, setLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isOpen, leadRole]);

  const transactionType = leadRole === "Chirias" ? "Închiriere" : "Vânzare";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formState.clientName.trim() || !formState.clientPhone.trim()) {
      toast.error("Numele clientului și telefonul sunt obligatorii.");
      return;
    }

    setLoading(true);
    try {
      const payload = buildLeadPayloadFromCriteria({
        state: formState,
        role: leadRole,
        mode: "cerere",
        status: "Noua",
      });

      await leadsService.addLead(payload);

      await notificationsService.addNotification({
        title: "Cerere Nouă Înregistrată",
        message: `${formState.clientName.trim()} caută ${payload.categoria} (${transactionType === "Vânzare" ? "cumpărare" : "închiriere"}) în ${payload.zone}.`,
        type: "lead",
      });

      toast.success("Cererea a fost înregistrată cu succes!");
      setFormState(createInitialPropertyCriteriaState());
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
      {isOpen && (
        <div className="fixed inset-0 z-[300]">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/30 backdrop-blur-xs"
          />

          {/* Right Drawer (identical to AddLeadModal) */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", ease: "easeInOut", duration: 0.25 }}
            className="fixed inset-y-0 right-0 w-[calc(100vw-48px)] md:w-full md:max-w-[460px] bg-white shadow-2xl z-[301] flex flex-col border-l border-gray-200"
          >
            {/* Header */}
            <div className="h-12 px-5 border-b border-gray-100 flex items-center justify-between shrink-0 bg-white">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-7 h-7 rounded-md bg-[#051D35]/5 border border-[#051D35]/15 flex items-center justify-center text-[#051D35] shrink-0">
                  <ClipboardList size={14} />
                </span>
                <h3 className="text-[13px] font-semibold text-[#051D35] truncate">
                  {leadRole === "Chirias"
                    ? "Adaugă Chiriaș Nou"
                    : "Adaugă Cumpărător Nou"}
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors cursor-pointer shrink-0"
                title="Închide meniul"
              >
                <X size={16} />
              </button>
            </div>

            {/* Horizontal Tabs right under the header */}
            <div className="h-10 border-b border-gray-200 bg-white flex items-stretch shrink-0 overflow-x-auto no-scrollbar">
              <div className="flex items-stretch h-full divide-x divide-gray-100 border-r border-gray-100 font-sans">
                {(
                  [
                    { id: "Chirias", label: "Chiriaș" },
                    { id: "Cumparator", label: "Cumpărător" },
                  ] as const
                ).map((tab) => {
                  const isActive = leadRole === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      disabled={loading}
                      onClick={() => setLeadRole(tab.id)}
                      className={`h-full px-4 rounded-none bg-transparent flex items-center justify-center whitespace-nowrap transition-colors cursor-pointer select-none font-sans text-[13px] border-b-4 disabled:opacity-60 ${
                        isActive
                          ? "text-gray-900 font-semibold border-b-[#BE9662]"
                          : "text-gray-600 font-medium hover:text-gray-900 border-b-transparent"
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Form wrapping scrollable body + pinned footer */}
            <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
              {/* Scrollable Body */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs custom-scrollbar">
                <fieldset disabled={loading} className="border-0 p-0 m-0 min-w-0">
                  <PropertyCriteriaAccordionForm
                    role={leadRole}
                    mode="cerere"
                    state={formState}
                    onChange={setFormState}
                    disabled={loading}
                    firstInputRef={inputRef}
                  />
                </fieldset>
              </div>

              {/* Footer pinned at base */}
              <div className="p-4 border-t border-gray-200 bg-gray-50/80 shrink-0 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={loading}
                  className="h-8 px-3 text-[12px] font-normal text-gray-600 hover:text-[#051D35] bg-white border border-gray-200 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-50 cursor-pointer"
                >
                  Anulează
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="h-8 px-4 text-[12px] font-semibold bg-[#051D35] hover:bg-[#0a2b4a] text-white rounded-md transition-colors flex items-center gap-2 disabled:opacity-50 cursor-pointer shadow-xs"
                >
                  {loading ? (
                    <>
                      <Loader2 size={13} className="animate-spin text-[#BE9662]" />
                      <span>Se procesează...</span>
                    </>
                  ) : (
                    <>
                      <Plus size={14} className="text-[#BE9662]" />
                      <span>
                        {leadRole === "Chirias" ? "Adaugă Chiriaș" : "Adaugă Cumpărător"}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
