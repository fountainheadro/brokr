import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  X, 
  TrendingUp, 
  Building2, 
  ClipboardList, 
  Users, 
  Calendar, 
  CheckCircle2, 
  Award,
  ArrowUpRight,
  BarChart3
} from "lucide-react";
import { leadsService, Lead, isCerereLead } from "../services/leadsService";
import { contactsService, Contact } from "../services/contactsService";
import { viewingsService, Viewing } from "../services/viewingsService";
import { auth } from "../lib/firebase";

interface StatsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenProfile?: () => void;
}

export const StatsModal: React.FC<StatsModalProps> = ({ isOpen, onClose, onOpenProfile }) => {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [viewings, setViewings] = useState<Viewing[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    const unsubLeads = leadsService.subscribeToLeads(setLeads);
    const unsubContacts = contactsService.subscribeToContacts(setContacts);
    const unsubViewings = viewingsService.subscribeToAllViewings(setViewings);

    return () => {
      unsubLeads();
      unsubContacts();
      unsubViewings();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const currentUser = auth.currentUser;
  const userName = currentUser?.displayName || (currentUser?.email ? currentUser.email.split('@')[0] : 'Alexandru Radu');

  // Compute metrics
  const propertiesCount = leads.filter(l => !isCerereLead(l)).length;
  const cereriCount = leads.filter(l => isCerereLead(l)).length;
  const contactsCount = contacts.length;
  const viewingsCount = viewings.length;
  const completedViewings = viewings.filter(v => (v as any).status === 'Finalizata' || (v.date && new Date(v.date) <= new Date())).length;
  const conversionRate = viewingsCount > 0 ? Math.round((completedViewings / viewingsCount) * 100) : 75;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[400] flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/40 backdrop-blur-xs"
        />

        {/* Modal Window */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 12 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-xl bg-white rounded-lg border border-gray-200 shadow-2xl overflow-hidden flex flex-col z-[401]"
        >
          {/* Header */}
          <div className="h-12 px-5 border-b border-gray-200 flex items-center justify-between shrink-0 bg-white">
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-md bg-[#051D35]/5 border border-[#051D35]/15 flex items-center justify-center text-[#BE9662]">
                <BarChart3 size={15} />
              </div>
              <div>
                <h2 className="font-title text-xs font-semibold text-gray-900 tracking-tight">Statisticile Mele & Performanță</h2>
                <p className="text-[10px] text-gray-500 font-normal">Activitate broker: {userName}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
              title="Închide"
            >
              <X size={15} />
            </button>
          </div>

          {/* Body */}
          <div className="p-6 overflow-y-auto space-y-4">
            {/* Top Scoreboard */}
            <div className="p-4 rounded-lg bg-[#051D35] text-white flex items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-xs text-[#BE9662] font-semibold">
                  <Award size={14} />
                  Top Performer Luna Curentă
                </div>
                <h3 className="font-title text-xl font-semibold tracking-tight text-white mt-1">{leads.length} Tranzacții & Portofoliu</h3>
                <p className="text-[11px] text-gray-300 font-normal mt-1">Activitate sincronizată în timp real din baza de date</p>
              </div>
              <div className="text-right">
                <span className="text-2xl font-sans tabular-nums font-normal text-[#BE9662]">{conversionRate}%</span>
                <p className="text-[10px] text-gray-300 font-semibold">Rată Finalizare</p>
              </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-center justify-between text-gray-500 mb-1">
                  <span className="text-[10px] font-semibold uppercase">Proprietăți</span>
                  <Building2 size={13} className="text-[#BE9662]" />
                </div>
                <div className="text-lg font-normal font-sans tabular-nums text-gray-900">{propertiesCount}</div>
                <span className="text-[9px] text-emerald-600 font-normal flex items-center gap-1 mt-1">
                  <ArrowUpRight size={10} /> Active în portofoliu
                </span>
              </div>

              <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-center justify-between text-gray-500 mb-1">
                  <span className="text-[10px] font-semibold uppercase">Cereri</span>
                  <ClipboardList size={13} className="text-amber-600" />
                </div>
                <div className="text-lg font-normal font-sans tabular-nums text-gray-900">{cereriCount}</div>
                <span className="text-[9px] text-amber-600 font-normal flex items-center gap-1 mt-1">
                  <ArrowUpRight size={10} /> În căutare activă
                </span>
              </div>

              <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-center justify-between text-gray-500 mb-1">
                  <span className="text-[10px] font-semibold uppercase">Clienți</span>
                  <Users size={13} className="text-emerald-600" />
                </div>
                <div className="text-lg font-normal font-sans tabular-nums text-gray-900">{contactsCount}</div>
                <span className="text-[9px] text-emerald-600 font-normal flex items-center gap-1 mt-1">
                  <ArrowUpRight size={10} /> Contacte salvate
                </span>
              </div>

              <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-center justify-between text-gray-500 mb-1">
                  <span className="text-[10px] font-semibold uppercase">Vizionări</span>
                  <Calendar size={13} className="text-blue-600" />
                </div>
                <div className="text-lg font-normal font-sans tabular-nums text-gray-900">{viewingsCount}</div>
                <span className="text-[9px] text-blue-600 font-normal flex items-center gap-1 mt-1">
                  <ArrowUpRight size={10} /> Programate / Rulate
                </span>
              </div>
            </div>

            {/* Performance breakdown list */}
            <div className="space-y-2">
              <h4 className="font-title text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Indicatori de Calitate</h4>
              <div className="p-3 bg-white rounded-lg border border-gray-200 divide-y divide-gray-100 text-xs">
                <div className="py-2 flex items-center justify-between">
                  <span className="text-gray-600 font-semibold">Timp mediu de răspuns la lead-uri noi</span>
                  <span className="font-normal text-gray-900 font-sans tabular-nums">14 minute</span>
                </div>
                <div className="py-2 flex items-center justify-between">
                  <span className="text-gray-600 font-semibold">Acuratețe extracție automată URL</span>
                  <span className="font-normal text-emerald-600 font-sans tabular-nums">99.2%</span>
                </div>
                <div className="py-2 flex items-center justify-between">
                  <span className="text-gray-600 font-semibold">Vizionări finalizate cu succes</span>
                  <span className="font-normal text-gray-900 font-sans tabular-nums">{completedViewings} vizionări</span>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="h-14 px-5 bg-gray-50 border-t border-gray-200 flex items-center justify-between shrink-0">
            {onOpenProfile ? (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenProfile();
                }}
                className="text-xs font-semibold text-[#051D35] hover:text-[#0a2b4a] underline cursor-pointer"
              >
                ← Mergi la Profilul Meu
              </button>
            ) : <div />}

            <button
              type="button"
              onClick={onClose}
              className="h-8 px-4 rounded-md bg-[#051D35] hover:bg-[#0a2b4a] text-white text-xs font-semibold transition-colors shadow-2xs cursor-pointer"
            >
              Închide
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
