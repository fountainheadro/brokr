import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Sliders, Check, Globe, HelpCircle, Phone, Sparkles, Cpu } from "lucide-react";

interface ExtractionRulesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface RuleItem {
  id: string;
  source: string;
  badge: string;
  type: string;
  isActive: boolean;
  selector: string;
  description: string;
}

export const ExtractionRulesModal: React.FC<ExtractionRulesModalProps> = ({ isOpen, onClose }) => {
  const [activeRuleTab, setActiveRuleTab] = useState<"standard" | "custom">("standard");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [rules, setRules] = useState<RuleItem[]>([
    {
      id: "olx-phone",
      source: "OLX.ro",
      badge: "Rule #1",
      type: "Phone Button Click",
      isActive: true,
      selector: `<button data-cy="ad-contact-phone" data-testid="ad-contact-phone" class="css-1o4b4d" data-nx-name="Button" data-nx-legacy="true" type="button" data-button-variant="secondary" data-button-background="default"><span class="n-button-text-wrapper"><span>Suna vanzatorul</span></span></button>`,
      description: "Numărul de telefon este inițial mascat sub textul «Suna vanzatorul». Crawler-ul face mai întâi click pe acest buton (button[data-cy=\"ad-contact-phone\"]) pentru a înlocui textul inițial cu numărul real de telefon, așteaptă afișarea acestuia și copiază noul text apărut."
    },
    {
      id: "storia-phone",
      source: "Storia.ro",
      badge: "Rule #2",
      type: "API Call on ID",
      isActive: true,
      selector: `GET https://www.storia.ro/api/v1/offers/{id}/phones/`,
      description: "Extracts the internal numeric ID of the offer from NextJS __NEXT_DATA__ and queries the on-demand phones endpoint directly."
    },
    {
      id: "publi24-phone",
      source: "Publi24.ro",
      badge: "Rule #3",
      type: "Regex Fallback",
      isActive: true,
      selector: `/(?:\\+40|0)\\s?7\\d{2}\\s?\\d{3}\\s?\\d{3}\\b/g`,
      description: "Scanează conținutul text și script-urile adiacente pentru a identifica formate standard de telefonie mobilă românească."
    }
  ]);

  const [customRules, setCustomRules] = useState<RuleItem[]>([]);
  const [newSource, setNewSource] = useState("");
  const [newSelector, setNewSelector] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  const handleAddCustomRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSource || !newSelector) return;

    const newRule: RuleItem = {
      id: `custom-${Date.now()}`,
      source: newSource,
      badge: "Custom",
      type: "Dynamic Match",
      isActive: true,
      selector: newSelector,
      description: newDesc || "Regulă definită de utilizator pentru selectarea și extragerea numerelor de telefon sau a datelor de contact."
    };

    setCustomRules([...customRules, newRule]);
    setNewSource("");
    setNewSelector("");
    setNewDesc("");
  };

  const toggleRule = (id: string, isCustom: boolean) => {
    if (isCustom) {
      setCustomRules(customRules.map(r => r.id === id ? { ...r, isActive: !r.isActive } : r));
    } else {
      setRules(rules.map(r => r.id === id ? { ...r, isActive: !r.isActive } : r));
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[300]"
          />

          {/* Modal Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", duration: 0.35 }}
            className="fixed inset-0 m-auto max-w-2xl h-[85vh] bg-white rounded-2xl shadow-2xl z-[301] flex flex-col overflow-hidden border border-gray-100"
          >
            {/* Header */}
            <div className="p-5 flex items-center justify-between border-b border-gray-100 bg-gray-50/50 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[--color-accent]/10 flex items-center justify-center text-[--color-accent]">
                  <Sliders size={20} />
                </div>
                <div>
                  <h3 className="font-title text-[16px] font-semibold text-gray-900 leading-none">Reguli de Extragere Contacte</h3>
                  <p className="text-[11px] font-semibold text-gray-400 tracking-wider uppercase mt-1">Configurare Scraping & Crawler</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-10 h-10 flex items-center justify-center bg-white border border-gray-200 rounded-full text-gray-400 hover:text-gray-900 transition-colors shadow-sm cursor-pointer"
              >
                <X size={20} strokeWidth={2.5} />
              </button>
            </div>

            {/* Navigation Tabs */}
            <div className="px-6 py-3 border-b border-gray-100 flex gap-4 bg-white shrink-0">
              <button
                onClick={() => setActiveRuleTab("standard")}
                className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer ${
                  activeRuleTab === "standard"
                    ? "bg-gray-950 text-white shadow-sm"
                    : "bg-gray-50 text-gray-500 hover:bg-gray-100"
                }`}
              >
                <Cpu size={14} />
                Reguli de Sistem
              </button>
              <button
                onClick={() => setActiveRuleTab("custom")}
                className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer ${
                  activeRuleTab === "custom"
                    ? "bg-gray-950 text-white shadow-sm"
                    : "bg-gray-50 text-gray-500 hover:bg-gray-100"
                }`}
              >
                <Sparkles size={14} />
                Reguli Personalizate ({customRules.length})
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-4">
              <AnimatePresence mode="wait">
                {activeRuleTab === "standard" ? (
                  <motion.div
                    key="standard-tab"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-4"
                  >
                    <div className="bg-amber-50/50 border border-amber-100 p-4 rounded-xl flex items-start gap-3">
                      <HelpCircle size={18} className="text-amber-600 shrink-0 mt-1" />
                      <p className="text-xs font-normal text-amber-800 leading-relaxed">
                        Sistemul rulează regulile de mai jos automat la adăugarea unui link din platformele imobiliare. Regulile permit obținerea automată a numerelor de telefon chiar și din butoane interactive asincrone.
                      </p>
                    </div>

                    <div className="space-y-4">
                      {rules.map((rule) => (
                        <div
                          key={rule.id}
                          className={`p-5 rounded-2xl border transition-all ${
                            rule.isActive ? "bg-white border-gray-100 shadow-sm" : "bg-gray-50/50 border-gray-100 opacity-60"
                          }`}
                        >
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-3">
                              <span className="px-2 py-1 rounded-md bg-gray-100 text-[10px] font-semibold text-gray-600 tracking-wider">
                                {rule.badge}
                              </span>
                              <h4 className="font-title text-sm font-semibold text-gray-900">{rule.source}</h4>
                              <span className="text-[11px] text-gray-400 font-semibold">•</span>
                              <span className="text-[11px] text-[--color-accent] font-semibold uppercase tracking-wider">
                                {rule.type}
                              </span>
                            </div>
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => toggleRule(rule.id, false)}
                                className={`text-[10px] font-semibold px-3 py-1 rounded-full uppercase tracking-wider transition-all cursor-pointer ${
                                  rule.isActive ? "bg-emerald-50 text-emerald-600" : "bg-gray-200 text-gray-500"
                                }`}
                              >
                                {rule.isActive ? "Rule Active" : "Disabled"}
                              </button>
                            </div>
                          </div>

                          <p className="text-xs text-gray-500 font-normal leading-relaxed mb-4">
                            {rule.description}
                          </p>

                          <div className="relative bg-[#051D35] text-gray-200 font-sans text-[11px] p-4 rounded-xl border border-gray-800 overflow-x-auto max-w-full group">
                            <span className="absolute right-3 top-3 opacity-0 group-hover:opacity-100 transition-opacity bg-gray-800 text-[9px] font-semibold tracking-wider px-2 py-1 rounded cursor-pointer text-white" onClick={() => handleCopy(rule.selector, rule.id)}>
                              {copiedId === rule.id ? "COPIAT!" : "COPY RULE"}
                            </span>
                            <code className="block whitespace-pre-wrap leading-relaxed select-all">
                              {rule.selector}
                            </code>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="custom-tab"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-4"
                  >
                    {/* Add custom rule form */}
                    <form onSubmit={handleAddCustomRule} className="p-5 rounded-2xl border border-dashed border-gray-200 bg-gray-50/30 space-y-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Sparkles size={16} className="text-[--color-accent]" />
                        <h4 className="font-title text-xs font-semibold uppercase text-gray-900 tracking-wider">Adaugă Regulă Personalizată</h4>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="block text-[12px] font-semibold text-[--color-text-placeholder] tracking-wider uppercase mb-1">Platformă / Domeniu</label>
                          <input
                            type="text"
                            required
                            placeholder="ex: Imobiliare.ro, Lajumate"
                            value={newSource}
                            onChange={(e) => setNewSource(e.target.value)}
                            className="input-base w-full rounded-[8px] font-sans text-base font-normal text-[#333333] placeholder-gray-400"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="block text-[12px] font-semibold text-[--color-text-placeholder] tracking-wider uppercase mb-1">Selector CSS sau Buton Click</label>
                          <input
                            type="text"
                            required
                            placeholder="ex: button[data-cy='phone-btn']"
                            value={newSelector}
                            onChange={(e) => setNewSelector(e.target.value)}
                            className="input-base w-full rounded-[8px] font-sans text-base font-normal text-[#333333] placeholder-gray-400"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="block text-[12px] font-semibold text-[--color-text-placeholder] tracking-wider uppercase mb-1">Scurtă Descriere a Logicii</label>
                        <input
                          type="text"
                          placeholder="Cum funcționează elementul pe acest domeniu?"
                          value={newDesc}
                          onChange={(e) => setNewDesc(e.target.value)}
                          className="input-base w-full rounded-[8px] font-sans text-base font-normal text-[#333333] placeholder-gray-400"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={!newSource || !newSelector}
                        className="w-full h-10 bg-[#051D35] hover:bg-[#0a2b4a] text-white rounded-xl font-semibold text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm"
                      >
                        <Check size={14} />
                        Creează Regulă de Extragere
                      </button>
                    </form>

                    {/* Custom rules list */}
                    {customRules.length > 0 ? (
                      <div className="space-y-4">
                        {customRules.map((rule) => (
                          <div
                            key={rule.id}
                            className={`p-5 rounded-2xl border transition-all ${
                              rule.isActive ? "bg-white border-gray-100 shadow-sm" : "bg-gray-50/50 border-gray-100 opacity-60"
                            }`}
                          >
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-3">
                                <span className="px-2 py-1 rounded-md bg-[#BE9662]/10 text-[10px] font-semibold text-[#BE9662] tracking-wider">
                                  {rule.badge}
                                </span>
                                <h4 className="font-title text-sm font-semibold text-gray-900">{rule.source}</h4>
                                <span className="text-[11px] text-gray-400 font-semibold">•</span>
                                <span className="text-[11px] text-[#BE9662] font-semibold uppercase tracking-wider">
                                  {rule.type}
                                </span>
                              </div>
                              <button
                                onClick={() => toggleRule(rule.id, true)}
                                className={`text-[10px] font-semibold px-3 py-1 rounded-full uppercase tracking-wider transition-all cursor-pointer ${
                                  rule.isActive ? "bg-[#BE9662]/10 text-[#BE9662]" : "bg-gray-200 text-gray-500"
                                }`}
                              >
                                {rule.isActive ? "Activ" : "Inactiv"}
                              </button>
                            </div>

                            <p className="text-xs text-gray-500 font-normal leading-relaxed mb-4">
                              {rule.description}
                            </p>

                            <div className="relative bg-gray-950 text-gray-200 font-sans text-[11px] p-4 rounded-xl border border-gray-800 overflow-x-auto max-w-full">
                              <code className="block whitespace-pre-wrap leading-relaxed select-all">
                                {rule.selector}
                              </code>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-12 bg-white rounded-2xl border border-gray-100">
                        <Globe size={32} className="text-gray-300 mx-auto mb-3" />
                        <h5 className="font-title text-xs font-semibold text-gray-900 mb-1">Nicio regulă personalizată adăugată</h5>
                        <p className="text-[11px] text-gray-400 font-normal max-w-sm mx-auto leading-normal">
                          Puteți defini selectoare specifice de contact pentru site-uri web nișate pe care doriți să le rulați prin crawler.
                        </p>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
