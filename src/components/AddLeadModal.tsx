import React, { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Globe, Loader2, Building2, User, Phone, Euro, Plus, Bookmark, Code2, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { leadsService } from "../services/leadsService";
import { notificationsService } from "../services/notificationsService";
import { ZONA_OPTIONS, CATEGORIA_OPTIONS } from "../constants";
import toast from "react-hot-toast";
import { CETATENIE_OPTIONS } from "./AddCerereModal";
import {
  importPropertyFromCrawl,
  buildImportBookmarkletCode,
  CrawlBlockedError,
} from "../utils/importPropertyFromCrawl";

interface AddLeadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AddLeadModal: React.FC<AddLeadModalProps> = ({ isOpen, onClose }) => {
  const [url, setUrl] = useState("");
  const [pastedHtml, setPastedHtml] = useState("");
  const [showHtmlFallback, setShowHtmlFallback] = useState(false);
  const [wasBlocked, setWasBlocked] = useState(false);
  const [leadRole, setLeadRole] = useState<'Proprietar' | 'Chirias' | 'Cumparator'>('Proprietar');
  const [categoria, setCategoria] = useState("Apartament");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const bookmarkletRef = useRef<HTMLAnchorElement>(null);

  const bookmarkletCode = useMemo(() => {
    const origin = typeof window !== "undefined" ? window.location.origin : "https://agency.highline.ro";
    return buildImportBookmarkletCode(origin);
  }, []);

  useEffect(() => {
    if (bookmarkletRef.current) {
      bookmarkletRef.current.setAttribute("href", bookmarkletCode);
    }
  }, [bookmarkletCode, isOpen, leadRole]);

  // Seeker / Tenant form state
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [zoneList, setZoneList] = useState<string[]>([]);
  const [currentZoneInput, setCurrentZoneInput] = useState("");
  const [showZoneDropdown, setShowZoneDropdown] = useState(false);
  const [minBudget, setMinBudget] = useState("");
  const [maxBudget, setMaxBudget] = useState("");
  const [mobilare, setMobilare] = useState("");
  const [parcare, setParcare] = useState("");
  const [animal, setAnimal] = useState<"Fara" | "Caine" | "Pisica" | "Altceva">("Fara");
  const [cetatenie, setCetatenie] = useState("Romania");
  const [requirements, setRequirements] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isOpen, leadRole]);

  const transactionType = leadRole === 'Chirias' ? 'Închiriere' : 'Vânzare';

  const filteredZones = ZONA_OPTIONS.filter(z => 
    z.toLowerCase().includes(currentZoneInput.toLowerCase()) && 
    !zoneList.includes(z)
  ).slice(0, 8);

  const handleSelectZone = (selectedZone: string) => {
    if (!zoneList.includes(selectedZone)) {
      setZoneList([...zoneList, selectedZone]);
    }
    setCurrentZoneInput("");
    setShowZoneDropdown(false);
  };

  const handleRemoveZone = (zoneToRemove: string) => {
    setZoneList(zoneList.filter(z => z !== zoneToRemove));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (leadRole === 'Proprietar') {
      if (!url.trim()) return;

      setLoading(true);
      setStatus(pastedHtml.trim() ? "Procesare pagină capturată..." : "Accesare URL...");
      try {
        await importPropertyFromCrawl({
          url: url.trim(),
          html: pastedHtml.trim() || undefined,
          onStatus: setStatus,
        });

        setUrl("");
        setPastedHtml("");
        setWasBlocked(false);
        setShowHtmlFallback(false);
        onClose();
        toast.success("Proprietatea a fost adăugată cu succes!");
      } catch (error: any) {
        console.warn("[AddLeadModal] Add lead error:", error?.message || error);
        setStatus("Eroare la adăugare");
        const isAbort = error?.name === "AbortError";
        const isFetchError = error instanceof TypeError || error?.message?.includes("fetch");
        if (error instanceof CrawlBlockedError) {
          setWasBlocked(true);
          setShowHtmlFallback(true);
          toast.error("Site-ul a blocat accesul automat (403). Folosește butonul din bara de marcaje sau lipește sursa paginii mai jos.");
        } else if (isAbort) {
          toast.error("Conectarea la site-ul extern a durat prea mult. Verificați link-ul și reîncercați.");
        } else if (isFetchError) {
          toast.error("Nu s-a putut accesa link-ul extern sau conexiunea a fost întreruptă. Verificați link-ul și reîncercați.");
        } else if (error?.message?.includes("HTML instead of JSON")) {
          toast.error("Serviciul de scanare este momentan indisponibil. Reîncercați în câteva secunde.");
        } else {
          toast.error(`Eroare la adăugarea proprietății: ${error?.message || "Eroare necunoscută"}`);
        }
      } finally {
        setLoading(false);
        setStatus("");
      }
    } else {
      if (!clientName.trim() || !clientPhone.trim()) {
        toast.error("Numele clientului și telefonul sunt obligatorii.");
        return;
      }

      setLoading(true);
      try {
        const minB = minBudget ? `${minBudget.trim()}` : "";
        const maxB = maxBudget ? `${maxBudget.trim()}` : "";
        const displayBudget = minB && maxB ? `${minB} - ${maxB} €` : (maxB ? `${maxB} €` : (minB ? `min. ${minB} €` : "La cerere"));
        const zoneStr = zoneList.join(", ") || "București";
        const roleLabel = leadRole === 'Chirias' ? 'Chiriaș' : 'Cumpărător';
        const title = `${roleLabel}: ${categoria} ${transactionType === "Vânzare" ? "Cumpărare" : "Închiriere"} - ${zoneStr}`;

        let notesContent = requirements.trim();
        if (transactionType === "Închiriere") {
          notesContent += (notesContent ? " | " : "") + `Cetățenie: ${cetatenie} | Animal: ${animal}`;
        }

        await leadsService.addLead({
          url: "",
          title,
          zone: zoneStr,
          price: displayBudget,
          ownerName: clientName.trim(),
          ownerPhone: clientPhone.trim(),
          transactionType,
          categoria,
          status: "Noi",
          leadType: leadRole,
          ...(mobilare ? { mobilare } : {}),
          ...(parcare ? { parcare } : {}),
          notes: notesContent.trim() ? `Cerințe lead: ${notesContent.trim()}` : ""
        });

        await notificationsService.addNotification({
          title: leadRole === 'Chirias' ? "Chiriaș Nou Înregistrat" : "Cumpărător Nou Înregistrat",
          message: `${clientName} caută ${categoria} (${transactionType === "Vânzare" ? "cumpărare" : "închiriere"}) în ${zoneStr}.`,
          type: "lead"
        });

        toast.success("Înregistrarea a fost salvată cu succes!");
        setClientName("");
        setClientPhone("");
        setZoneList([]);
        setMinBudget("");
        setMaxBudget("");
        setMobilare("");
        setParcare("");
        setAnimal("Fara");
        setCetatenie("Romania");
        setRequirements("");
        onClose();
      } catch (err: any) {
        console.error("Eroare la salvare:", err);
        toast.error("Eroare la salvare. Încercați din nou.");
      } finally {
        setLoading(false);
      }
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

          {/* Right Drawer (matching OlxLeadDrawer / ProfileDrawer style) */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", ease: "easeInOut", duration: 0.25 }}
            className="fixed inset-y-0 right-0 w-[calc(100vw-48px)] md:w-full md:max-w-[420px] bg-white shadow-2xl z-[301] flex flex-col border-l border-gray-200"
          >
            {/* Header */}
            <div className="h-12 px-5 border-b border-gray-100 flex items-center justify-between shrink-0 bg-white">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-7 h-7 rounded-md bg-[#051D35]/5 border border-[#051D35]/15 flex items-center justify-center text-[#051D35] shrink-0">
                  <Building2 size={14} />
                </span>
                <h3 className="text-[13px] font-semibold text-[#051D35] truncate">
                  {leadRole === 'Proprietar'
                    ? 'Adaugă Imobil / Proprietar'
                    : leadRole === 'Chirias'
                      ? 'Adaugă Chiriaș Nou'
                      : 'Adaugă Cumpărător Nou'}
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors cursor-pointer"
                title="Închide meniul"
              >
                <X size={16} />
              </button>
            </div>

            {/* Form wrapping scrollable body + pinned footer */}
            <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
              {/* Scrollable Body */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs custom-scrollbar">
                {/* 3 Tabs at the top of the drawer body */}
                <div className="grid grid-cols-3 gap-1 bg-gray-100 p-1 rounded-lg">
                  {(
                    [
                      { id: 'Proprietar', label: 'Proprietate' },
                      { id: 'Chirias', label: 'Chiriaș' },
                      { id: 'Cumparator', label: 'Cumpărător' },
                    ] as const
                  ).map((tab) => {
                    const isActive = leadRole === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        disabled={loading}
                        onClick={() => setLeadRole(tab.id)}
                        className={`h-7 px-2 text-[11px] font-semibold rounded-md transition-all cursor-pointer disabled:opacity-60 ${
                          isActive
                            ? 'bg-[#051D35] text-white shadow-xs'
                            : 'text-gray-600 hover:text-[#051D35] hover:bg-white/70'
                        }`}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                <fieldset disabled={loading} className="border-0 p-0 m-0 min-w-0 space-y-4">
                  {leadRole === 'Proprietar' ? (
                    <>
                      <div>
                        <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                          Link Anunț Imobiliar *
                        </label>
                        <div className="relative">
                          <Globe size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                          <input
                            ref={inputRef}
                            type="url"
                            required
                            placeholder="https://www.storia.ro/... sau olx.ro, imobiliare.ro"
                            value={url}
                            onChange={(e) => {
                              setUrl(e.target.value);
                              if (wasBlocked) setWasBlocked(false);
                            }}
                            className="w-full h-8 pl-8 pr-3 text-xs font-normal border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662]"
                          />
                        </div>
                        <p className="text-[11px] text-gray-400 font-normal mt-2 leading-relaxed">
                          Crawlerul va extrage automat detaliile, imaginile, prețul, categoria și contactul.
                        </p>
                      </div>

                      {/* 1-Click Browser Bookmarklet + Paste HTML fallback (free, never blocked by OLX/Storia) */}
                      <div
                        className={`rounded-lg border p-3.5 space-y-2.5 transition-colors ${
                          wasBlocked
                            ? "bg-amber-50/80 border-amber-300"
                            : "bg-gray-50/90 border-gray-200"
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          {wasBlocked ? (
                            <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
                          ) : (
                            <Bookmark size={14} className="text-[#051D35] shrink-0 mt-0.5" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-semibold text-[#051D35]">
                              {wasBlocked
                                ? "Site-ul a blocat serverul (HTTP 403) — Importă direct din browser"
                                : "Import rapid 1-Click din browser (Anti-blocare OLX)"}
                            </p>
                            <p className="text-[11px] text-gray-600 leading-relaxed mt-0.5">
                              Trage butonul de mai jos în bara de marcaje Chrome (o singură dată). Apoi apasă-l direct când ești pe orice anunț OLX, Storia sau Imobiliare.ro:
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <a
                            ref={bookmarkletRef}
                            draggable
                            onClick={(e) => {
                              e.preventDefault();
                              toast("Trage acest buton în bara de marcaje (Bookmarks Bar) din Chrome, apoi apasă-l pe un anunț OLX/Storia.", {
                                icon: "📌",
                              });
                            }}
                            className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md bg-[#051D35] hover:bg-[#0a2b4a] text-white text-[11px] font-semibold cursor-grab active:cursor-grabbing shadow-2xs select-none"
                            title="Trage în bara de marcaje Chrome"
                          >
                            <Bookmark size={12} className="text-[#BE9662]" />
                            <span>Importă în CRM</span>
                          </a>
                          <span className="text-[10px] text-gray-500">
                            ← Trage în bara de marcaje (Ctrl+Shift+B)
                          </span>
                        </div>

                        <div className="pt-1 border-t border-gray-200/80">
                          <button
                            type="button"
                            onClick={() => setShowHtmlFallback((v) => !v)}
                            className="w-full flex items-center justify-between text-[11px] font-medium text-gray-600 hover:text-[#051D35] py-1 cursor-pointer"
                          >
                            <span className="flex items-center gap-1.5">
                              <Code2 size={12} />
                              <span>Sau lipește sursa paginii (Ctrl+U → Ctrl+A → Ctrl+C)</span>
                            </span>
                            {showHtmlFallback ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                          </button>

                          {showHtmlFallback && (
                            <div className="mt-1.5 space-y-1">
                              <textarea
                                rows={3}
                                value={pastedHtml}
                                onChange={(e) => setPastedHtml(e.target.value)}
                                placeholder="Deschide anunțul OLX în browser, apasă Ctrl+U, apoi Ctrl+A, Ctrl+C și lipește aici..."
                                className="w-full px-2.5 py-2 text-[11px] font-mono bg-white border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] resize-none"
                              />
                              {pastedHtml.trim().length > 0 && (
                                <p className="text-[10px] text-emerald-700 font-medium">
                                  Sursă HTML pregătită ({Math.round(pastedHtml.length / 1024)} KB) — apasă „Adaugă Proprietar”.
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {loading && status && (
                        <div className="flex items-center gap-2 px-3 py-2 bg-[#BE9662]/10 border border-[#BE9662]/20 rounded-lg text-xs text-[#051D35]">
                          <Loader2 size={14} className="animate-spin text-[#BE9662] shrink-0" />
                          <span className="font-normal">{status}</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      {/* Nume Client & Telefon */}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                            Nume Client *
                          </label>
                          <div className="relative">
                            <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                              ref={inputRef}
                              type="text"
                              required
                              value={clientName}
                              onChange={(e) => setClientName(e.target.value)}
                              placeholder="ex. Radu Popescu"
                              className="w-full h-8 pl-8 pr-3 text-xs font-normal border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662]"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                            Telefon *
                          </label>
                          <div className="relative">
                            <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                              type="tel"
                              required
                              value={clientPhone}
                              onChange={(e) => setClientPhone(e.target.value)}
                              placeholder="07xxxxxxxx"
                              className="w-full h-8 pl-8 pr-3 text-xs font-normal border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662]"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Cetatenie & Animal (Only for Închiriere / Chirias) */}
                      {transactionType === "Închiriere" && (
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                              Cetățenie
                            </label>
                            <select
                              value={cetatenie}
                              onChange={(e) => setCetatenie(e.target.value)}
                              className="w-full h-8 px-3 text-xs font-normal border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] bg-white cursor-pointer"
                            >
                              {CETATENIE_OPTIONS.map((c) => (
                                <option key={c} value={c}>{c}</option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                              Animale de companie
                            </label>
                            <select
                              value={animal}
                              onChange={(e) => setAnimal(e.target.value as any)}
                              className="w-full h-8 px-3 text-xs font-normal border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] bg-white cursor-pointer"
                            >
                              <option value="Fara">Fără</option>
                              <option value="Caine">Câine</option>
                              <option value="Pisica">Pisică</option>
                              <option value="Altceva">Altceva</option>
                            </select>
                          </div>
                        </div>
                      )}

                      {/* Buget Minim & Buget Maxim */}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                            Buget Minim (€)
                          </label>
                          <div className="relative">
                            <Euro size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                              type="text"
                              value={minBudget}
                              onChange={(e) => setMinBudget(e.target.value)}
                              placeholder="ex. 400"
                              className="w-full h-8 pl-8 pr-3 text-xs font-normal border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662]"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                            Buget Maxim (€)
                          </label>
                          <div className="relative">
                            <Euro size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                              type="text"
                              value={maxBudget}
                              onChange={(e) => setMaxBudget(e.target.value)}
                              placeholder="ex. 700"
                              className="w-full h-8 pl-8 pr-3 text-xs font-normal border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662]"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Categorie */}
                      <div>
                        <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                          Categorie
                        </label>
                        <select
                          value={categoria}
                          onChange={(e) => setCategoria(e.target.value)}
                          className="w-full h-8 px-3 text-xs font-normal border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] bg-white cursor-pointer"
                        >
                          {CATEGORIA_OPTIONS.map((cat) => (
                            <option key={cat} value={cat}>{cat}</option>
                          ))}
                        </select>
                      </div>

                      {/* Mobilare & Parcare */}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                            Mobilare
                          </label>
                          <select
                            value={mobilare}
                            onChange={(e) => setMobilare(e.target.value)}
                            className="w-full h-8 px-3 text-xs font-normal border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] bg-white cursor-pointer"
                          >
                            <option value="">Selectează...</option>
                            <option value="Fără">Fără</option>
                            <option value="Parțială">Parțială</option>
                            <option value="Completă">Completă</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                            Parcare
                          </label>
                          <select
                            value={parcare}
                            onChange={(e) => setParcare(e.target.value)}
                            className="w-full h-8 px-3 text-xs font-normal border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] bg-white cursor-pointer"
                          >
                            <option value="">Selectează...</option>
                            <option value="Fără">Fără</option>
                            <option value="1 loc">1 loc</option>
                            <option value="2 locuri">2 locuri</option>
                            <option value="3 locuri">3 locuri</option>
                            <option value="4 locuri">4 locuri</option>
                            <option value="5 locuri">5 locuri</option>
                          </select>
                        </div>
                      </div>

                      {/* Zona preferata - Auto-suggest multi selector */}
                      <div className="relative">
                        <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                          Zonă preferată (Selectează din listă)
                        </label>
                        <div className="min-h-[32px] h-auto border border-gray-200 rounded-md p-1 bg-white focus-within:border-[#BE9662] focus-within:ring-1 focus-within:ring-[#BE9662] flex flex-wrap gap-1 items-center">
                          {zoneList.map((z) => (
                            <span key={z} className="inline-flex items-center gap-1 bg-gray-100 text-gray-800 px-2 py-1 rounded text-[11px] font-normal border border-gray-200">
                              {z}
                              <button
                                type="button"
                                onClick={() => handleRemoveZone(z)}
                                className="text-gray-500 hover:text-red-600 cursor-pointer"
                              >
                                <X size={12} />
                              </button>
                            </span>
                          ))}
                          <div className="relative flex-1 min-w-[140px] flex items-center">
                            <input
                              type="text"
                              value={currentZoneInput}
                              onChange={(e) => {
                                setCurrentZoneInput(e.target.value);
                                setShowZoneDropdown(true);
                              }}
                              onFocus={() => setShowZoneDropdown(true)}
                              placeholder="Caută zonă..."
                              className="w-full h-6 px-2 text-xs font-normal border-0 focus:outline-none focus:ring-0 bg-transparent"
                            />
                          </div>
                        </div>

                        {/* Autocomplete Dropdown */}
                        {showZoneDropdown && currentZoneInput.trim().length > 0 && filteredZones.length > 0 && (
                          <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-50 max-h-40 overflow-y-auto divide-y divide-gray-50">
                            {filteredZones.map((z) => (
                              <div
                                key={z}
                                onClick={() => handleSelectZone(z)}
                                className="px-3 py-2 text-xs font-normal text-gray-800 hover:bg-gray-100 cursor-pointer"
                              >
                                {z}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                          Cerințe Specifice & Note
                        </label>
                        <textarea
                          rows={2}
                          value={requirements}
                          onChange={(e) => setRequirements(e.target.value)}
                          placeholder="ex. Minim 60mp, decomandat, loc parcare, bloc după 2015..."
                          className="w-full px-3 py-2 text-xs font-normal border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] resize-none"
                        />
                      </div>
                    </>
                  )}
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
                  disabled={loading || (leadRole === 'Proprietar' && !url.trim())}
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
                        {leadRole === 'Proprietar'
                          ? 'Adaugă Proprietar'
                          : leadRole === 'Chirias'
                            ? 'Adaugă Chiriaș'
                            : 'Adaugă Cumpărător'}
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
