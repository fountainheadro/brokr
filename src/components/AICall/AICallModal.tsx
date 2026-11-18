import React, { useState, useEffect, useRef } from "react";
import { 
  X, Phone, PhoneOff, Play, Send, Sparkles, User, FileText, Activity, 
  HelpCircle, CheckCircle, Flame, Heart, RefreshCw, Smile, AlertCircle
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { AICallStore, CallStoreState, TranscriptItem, LiveNotes } from "./AICallStore";

export const AICallModal: React.FC = () => {
  const [storeState, setStoreState] = useState<CallStoreState>(AICallStore.getState());
  const [phoneNumber, setPhoneNumber] = useState("");
  const [promptInstructions, setPromptInstructions] = useState(
    "Află dacă proprietatea imobiliară mai este de închiriat/vânzare, care este prețul minim negociat cu comisionul inclus și care ar fi cea mai rapidă oră de vizionare la locație."
  );

  const transcriptEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = AICallStore.subscribe((newState) => {
      setStoreState(newState);
    });
    return unsub;
  }, []);

  // Auto-scroll transcript list to bottom
  useEffect(() => {
    if (transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [storeState.transcript]);

  const { isModalOpen, activeTab, status, transcript, notes } = storeState;

  if (!isModalOpen) return null;

  const handleStartCall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneNumber) return;
    AICallStore.setTab("notes"); // Switch to notes tab to view logs live
    await AICallStore.startCall(phoneNumber, promptInstructions);
  };

  const handleEndCall = () => {
    AICallStore.endCall();
  };

  const handleResetCall = () => {
    AICallStore.reset();
  };

  const getSentimentIcon = (sentiment: string) => {
    const sem = (sentiment || "").toLowerCase();
    if (sem.includes("pozitiv") || sem.includes("buna") || sem.includes("receptiv")) {
      return <Smile className="text-emerald-500 shrink-0" size={18} />;
    }
    if (sem.includes("frustrat") || sem.includes("obiect") || sem.includes("nervos")) {
      return <AlertCircle className="text-rose-500 shrink-0" size={18} />;
    }
    return <Activity className="text-blue-500 shrink-0" size={18} />;
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[400] overflow-y-auto" id="ai-call-modal-overlay">
        {/* Backdrop overlay */}
        <div 
          className="fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
          onClick={() => AICallStore.closeModal()}
        />

        <div className="flex min-h-screen items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            transition={{ type: "spring", duration: 0.5 }}
            className="relative w-full max-w-5xl rounded-[24px] bg-white p-6 shadow-2xl border border-gray-100 flex flex-col md:min-h-[620px]"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-gray-100 pb-4 mb-5">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-orange-50 flex items-center justify-center text-[--color-accent]">
                  <Sparkles size={24} className="animate-pulse" />
                </div>
                <div>
                  <h3 className="font-title text-xl font-semibold text-gray-900 flex items-center gap-2">
                    Voce AI de test <span className="text-xs bg-orange-100 text-[--color-accent] font-normal uppercase tracking-widest px-2 py-1 rounded-full leading-none">BETA</span>
                  </h3>
                  <p className="text-xs text-gray-500 font-normal font-sans leading-none mt-1">Powered by Gemini 3.1 Live API & Twilio</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => AICallStore.closeModal()}
                  className="w-10 h-10 rounded-full bg-gray-50 hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-900 transition-colors cursor-pointer"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Modal Toggle Tabs */}
            <div className="flex border-b border-gray-100 mb-6 gap-2 bg-gray-50 p-2 rounded-2xl shrink-0">
              <button
                onClick={() => AICallStore.setTab("call")}
                className={`flex-1 py-3 text-sm font-semibold rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer ${
                  activeTab === "call"
                    ? "bg-white text-gray-950 shadow-sm"
                    : "text-gray-500 hover:text-gray-800"
                }`}
              >
                <Phone size={16} />
                1. Configurare & Formular Apel
              </button>
              <button
                onClick={() => AICallStore.setTab("notes")}
                className={`flex-1 py-3 text-sm font-semibold rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer relative ${
                  activeTab === "notes"
                    ? "bg-white text-gray-950 shadow-sm"
                    : "text-gray-500 hover:text-gray-800"
                }`}
              >
                <FileText size={16} />
                2. Monitorizare Notițe Live
                {(status === "connected" || status === "calling") && (
                  <span className="absolute top-1 right-2 inline-flex h-2 w-2 rounded-full bg-red-500 animate-ping" />
                )}
              </button>
            </div>

            {/* Modal Inner Workspace content */}
            <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-6 min-h-[460px]">
              
              {/* Left Workspace Panel: Action/Dial or Transcript Logging */}
              <div className="md:col-span-6 flex flex-col border-r border-gray-100 md:pr-6">
                
                {activeTab === "call" ? (
                  /* Call dial trigger panel */
                  <div className="flex-1 flex flex-col justify-between h-full">
                    <form onSubmit={handleStartCall} className="space-y-4">
                      <div>
                        <label className="block text-[12px] font-semibold text-[--color-text-placeholder] tracking-wider mb-2 uppercase">Numărul de Telefon</label>
                        <div className="relative">
                          <input
                            type="tel"
                            placeholder="+407xxxxxxxx"
                            value={phoneNumber}
                            onChange={(e) => setPhoneNumber(e.target.value)}
                            disabled={status === "calling" || status === "connected"}
                            className="input-base w-full pr-12 font-sans text-base font-normal text-[#333333] placeholder-gray-400"
                            required
                          />
                          <div className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400">
                            <Phone size={18} />
                          </div>
                        </div>
                        <p className="text-[11px] text-gray-400 mt-1 font-normal">Numărul va fi format folosind standardul internațional (ex. +40722123456).</p>
                      </div>

                      <div>
                        <label className="block text-[12px] font-semibold text-[--color-text-placeholder] tracking-wider mb-2 uppercase">Instrucțiuni / Scopul discuției pentru AI</label>
                        <textarea
                          rows={6}
                          placeholder="Ex: Întreabă dacă este de acord să programeze o vizionare vineri la ora 14..."
                          value={promptInstructions}
                          onChange={(e) => setPromptInstructions(e.target.value)}
                          disabled={status === "calling" || status === "connected"}
                          className="input-base w-full min-h-[140px] font-sans text-base font-normal text-[#333333] placeholder-gray-400 p-4 leading-relaxed resize-none"
                          required
                        />
                      </div>

                      {/* Quick Testing Autocomplete presets */}
                      <div>
                        <span className="block text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2">Sugestii rapide Scenarii:</span>
                        <div className="flex flex-col gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setPromptInstructions("Află dacă apartamentul proprietate personală mai este valabil de vânzare, dacă are centrală proprie, balcon închis și care este ultimul preț discutat la tranzacție.");
                            }}
                            className="text-left text-xs text-gray-500 hover:text-[--color-accent] font-normal bg-gray-50 hover:bg-orange-50/50 p-2 rounded-lg transition-colors border border-gray-100"
                          >
                            💡 Scenariu Apartament standard (Centrală / Balcon / Preț)
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPromptInstructions("Contactează proprietarul spațiului de birouri comercial. Obține costul chiriei lunar plus detalii utilități și află dacă există locuri de parcare proprii.");
                            }}
                            className="text-left text-xs text-gray-500 hover:text-[--color-accent] font-normal bg-gray-50 hover:bg-orange-50/50 p-2 rounded-lg transition-colors border border-gray-100"
                          >
                            💡 Scenariu Birou / Spațiu Comercial (Chirieri / Parcare)
                          </button>
                        </div>
                      </div>
                    </form>

                    {/* Launch call button */}
                    <div className="mt-6 pt-4 border-t border-gray-50">
                      {status === "idle" || status === "failed" || status === "ended" ? (
                        <button
                          onClick={handleStartCall}
                          disabled={!phoneNumber}
                          className="w-full bg-black text-white hover:bg-orange-600 font-semibold px-6 py-4 rounded-xl flex items-center justify-center gap-3 cursor-pointer shadow-lg active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-base"
                        >
                          <Play size={18} fill="currentColor" />
                          Lansează Apel Inteligent AI
                        </button>
                      ) : (
                        <button
                          onClick={handleEndCall}
                          className="w-full bg-red-500 text-white hover:bg-red-600 font-semibold px-6 py-4 rounded-xl flex items-center justify-center gap-3 cursor-pointer shadow-lg active:scale-95 transition-all text-base animate-pulse"
                        >
                          <PhoneOff size={18} />
                          Închide Conexiunea Manual
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  /* Audio transcript interactive visualizer list */
                  <div className="flex-1 flex flex-col justify-between h-full">
                    <div className="flex items-center justify-between mb-3 shrink-0">
                      <span className="font-title text-xs font-semibold uppercase text-gray-400 tracking-wider">Conversație Transcrisă Live</span>
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${
                          status === "connected" ? "bg-green-500 animate-ping" : status === "calling" ? "bg-amber-400 animate-pulse" : "bg-gray-400"
                        }`} />
                        <span className="text-[11px] font-normal uppercase tracking-widest text-gray-500">
                          {status === "connected" ? "Conectat" : status === "calling" ? "Se sună..." : "Apel încheiat"}
                        </span>
                      </div>
                    </div>

                    {/* Transcript flow bubble logger */}
                    <div className="flex-1 bg-gray-50 rounded-2xl p-4 overflow-y-auto max-h-[300px] min-h-[260px] space-y-3 custom-scrollbar">
                      {transcript.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-center opacity-40 py-10">
                          <Phone size={32} className="text-gray-400 mb-2 animate-bounce" />
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest leading-relaxed">
                            {status === "calling" ? "Se stabilește legătura VoIP..." : "Așteptare audio..."}
                          </p>
                        </div>
                      ) : (
                        transcript.map((item, idx) => (
                          <div
                            key={idx}
                            className={`flex flex-col ${
                              item.speaker === "assistant" 
                                ? "items-start" 
                                : item.speaker === "user" 
                                ? "items-end" 
                                : "items-center"
                            }`}
                          >
                            <span className="text-[9px] text-gray-400 uppercase font-semibold font-sans px-1">
                              {item.speaker === "assistant" ? "Asistent Brokr" : item.speaker === "user" ? "Client" : "Sistem"} &bull; {item.timestamp}
                            </span>
                            <div
                              className={`max-w-[85%] mt-1 px-4 py-3 rounded-2xl text-xs font-normal leading-relaxed ${
                                item.speaker === "assistant"
                                  ? "bg-white border border-gray-100 text-gray-900 rounded-tl-none"
                                  : item.speaker === "user"
                                  ? "bg-[#051D35] text-white rounded-tr-none"
                                  : "bg-orange-50 text-[--color-accent] text-[11px] font-normal border border-orange-100 rounded-lg text-center font-sans py-1"
                              }`}
                            >
                              {item.text}
                            </div>
                          </div>
                        ))
                      )}
                      <div ref={transcriptEndRef} />
                    </div>

                    {/* Bottom controls during transcript view */}
                    <div className="flex gap-2 mt-4 pt-4 border-t border-gray-50 shrink-0">
                      {status === "connected" || status === "calling" ? (
                        <button
                          onClick={handleEndCall}
                          className="w-full bg-red-500 text-white hover:bg-red-600 font-semibold py-3 rounded-xl flex items-center justify-center gap-2 cursor-pointer shadow-md transition-all text-sm"
                        >
                          <PhoneOff size={16} />
                          Închide Apel
                        </button>
                      ) : (
                        <div className="flex w-full gap-4">
                          <button
                            onClick={() => AICallStore.setTab("call")}
                            className="flex-1 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 font-semibold py-3 rounded-xl text-sm transition-all"
                          >
                            Apel Nou
                          </button>
                          <button
                            onClick={handleResetCall}
                            className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-600 font-semibold py-3 rounded-xl text-sm transition-all flex items-center justify-center gap-1"
                          >
                            <RefreshCw size={14} /> Resetare
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Right Workspace Panel: Live extracted structured notes data cards */}
              <div className="md:col-span-6 flex flex-col space-y-4 overflow-y-auto max-h-[500px] pr-2 custom-scrollbar">
                <div className="flex items-center justify-between shrink-0 mb-1">
                  <span className="font-title text-xs font-semibold uppercase text-gray-400 tracking-wider">Notițe Structurate CRM</span>
                  <span className="text-[10px] bg-[#BE9662]/10 text-[#BE9662] font-normal tracking-widest uppercase px-2 py-1 rounded-md leading-none">Live Sync</span>
                </div>

                {/* 1. Live Summary sentence card */}
                <div className="bg-gradient-to-br from-orange-50/10 to-[#BE9662]/10 border border-gray-100 hover:border-orange-100 p-4 rounded-2xl shadow-sm transition-all">
                  <div className="flex items-center gap-2 mb-2 text-orange-600">
                    <Sparkles size={16} className="animate-spin text-[--color-accent]" />
                    <span className="font-title text-xs font-semibold uppercase tracking-wider">Pe scurt (Copilot AI)</span>
                  </div>
                  <p className="text-[13px] text-gray-900 leading-relaxed font-normal">
                    {notes.live_summary || "Se ascultă convorbirea..."}
                  </p>
                </div>

                {/* 2. Sentiment Detector badge info card */}
                {notes.sentiment && (
                  <div className="bg-white border border-gray-100 p-3 rounded-xl flex items-center gap-3 shadow-none">
                    <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center">
                      {getSentimentIcon(notes.sentiment)}
                    </div>
                    <div>
                      <span className="block text-[10px] uppercase font-semibold tracking-wider text-gray-400">Atitudinea Clientului</span>
                      <span className="text-xs font-normal text-gray-800">{notes.sentiment}</span>
                    </div>
                  </div>
                )}

                {/* 3. Extracted key important points checklist */}
                <div className="bg-white border border-gray-100 p-4 rounded-2xl shadow-sm">
                  <span className="font-title block text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">Aspecte Agreiate</span>
                  {notes.important_points.length === 0 ? (
                    <p className="text-xs text-gray-400 italic font-normal">Niciun aspect extras momentan.</p>
                  ) : (
                    <ul className="space-y-2">
                      {notes.important_points.map((pt, i) => (
                        <li key={i} className="flex gap-3 text-xs font-normal text-gray-700 leading-normal">
                          <CheckCircle className="text-[--color-accent] shrink-0 mt-1" size={14} />
                          <span>{pt}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* 4. Extracted contact details values */}
                {Object.keys(notes.contact_details || {}).length > 0 && (
                  <div className="bg-white border border-gray-100 p-4 rounded-2xl shadow-sm space-y-2">
                    <span className="font-title block text-xs font-semibold uppercase tracking-widest text-gray-400">Date Contact Extrase</span>
                    
                    <div className="grid grid-cols-2 gap-4 mt-2">
                      {notes.contact_details.names && notes.contact_details.names.length > 0 && (
                        <div className="p-3 bg-gray-50 rounded-xl">
                          <span className="block text-[9px] uppercase font-semibold text-gray-400">Nume</span>
                          <span className="text-xs font-normal text-gray-800">{notes.contact_details.names.join(", ")}</span>
                        </div>
                      )}
                      
                      {notes.contact_details.phones && notes.contact_details.phones.length > 0 && (
                        <div className="p-3 bg-gray-50 rounded-xl">
                          <span className="block text-[9px] uppercase font-semibold text-gray-400">Telefon</span>
                          <span className="text-xs font-normal text-gray-800 font-sans tabular-nums">{notes.contact_details.phones.join(", ")}</span>
                        </div>
                      )}

                      {notes.contact_details.emails && notes.contact_details.emails.length > 0 && (
                        <div className="p-3 bg-gray-50 rounded-xl col-span-2">
                          <span className="block text-[9px] uppercase font-semibold text-gray-400">E-mail</span>
                          <span className="text-xs font-normal text-gray-800 font-sans">{notes.contact_details.emails.join(", ")}</span>
                        </div>
                      )}

                      {notes.contact_details.company_names && notes.contact_details.company_names.length > 0 && (
                        <div className="p-3 bg-gray-50 rounded-xl col-span-2">
                          <span className="block text-[9px] uppercase font-semibold text-gray-400">Companie</span>
                          <span className="text-xs font-normal text-gray-800">{notes.contact_details.company_names.join(", ")}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 5. Live follow up list with checkmark indicators */}
                <div className="bg-white border border-gray-100 p-4 rounded-2xl shadow-sm">
                  <span className="font-title block text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">Sarcini Următoare (Follow-Up)</span>
                  {notes.follow_up_actions.length === 0 ? (
                    <p className="text-xs text-gray-400 italic font-normal">Se ascultă acțiunile specifice de urmat...</p>
                  ) : (
                    <ul className="space-y-2">
                      {notes.follow_up_actions.map((act, i) => (
                        <li key={i} className="flex gap-3 text-xs font-normal text-gray-700 leading-normal">
                          <div className="w-4 h-4 rounded border border-orange-200 bg-orange-50/30 flex items-center justify-center shrink-0 mt-1">
                            <span className="text-[10px] font-normal text-[--color-accent] leading-none">✓</span>
                          </div>
                          <span>{act}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

              </div>

            </div>

          </motion.div>
        </div>
      </div>
    </AnimatePresence>
  );
};
