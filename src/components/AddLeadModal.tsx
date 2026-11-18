import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Globe, Loader2, Building2, User, Phone, Euro, Plus } from "lucide-react";
import { leadsService } from "../services/leadsService";
import { notificationsService } from "../services/notificationsService";
import { auth } from "../lib/firebase";
import { ZONA_OPTIONS, CATEGORIA_OPTIONS } from "../constants";
import toast from "react-hot-toast";
import { CETATENIE_OPTIONS } from "./AddCerereModal";
import { generateStandardAdTitle } from "../utils/propertyTitleGenerator";
import { automationSettingsService } from "../services/automationSettingsService";
import { getApiAuthHeaders } from "../lib/apiAuth";

interface AddLeadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AddLeadModal: React.FC<AddLeadModalProps> = ({ isOpen, onClose }) => {
  const [url, setUrl] = useState("");
  const [leadRole, setLeadRole] = useState<'Proprietar' | 'Chirias' | 'Cumparator'>('Proprietar');
  const [categoria, setCategoria] = useState("Apartament");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

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
      setStatus("Accesare URL...");
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 45000);

        let crawlRes: Response;
        try {
          const authHeaders = await getApiAuthHeaders({ "Content-Type": "application/json" });
          const activeTitleRule = automationSettingsService.getCachedTitleRule();
          crawlRes = await fetch("/api/crawl", {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({ url: url.trim(), titleAutomationRule: activeTitleRule }),
            signal: controller.signal
          });
        } finally {
          clearTimeout(timeoutId);
        }
        
        if (!crawlRes.ok) {
          const errorText = await crawlRes.text();
          let parsedMsg = "";
          try {
            parsedMsg = JSON.parse(errorText).error;
          } catch {}
          throw new Error(parsedMsg || `Crawl failed with status ${crawlRes.status}`);
        }

        const contentTypeHeader = crawlRes.headers.get("content-type");
        if (!contentTypeHeader || !contentTypeHeader.includes("application/json")) {
          const textStr = await crawlRes.text();
          console.warn("Expected JSON but got:", textStr.substring(0, 100));
          throw new Error("Server returned an invalid response (HTML instead of JSON)");
        }

        const crawlData = await crawlRes.json();
        const { title, price, zone, ownerName, ownerPhone, transactionType: crawledTrans, categoria: crawledCat, crmData, coverImage } = crawlData;

        setStatus("Salvare...");
        const currentUser = auth.currentUser;
        const creatorName = currentUser?.displayName || (currentUser?.email ? currentUser.email.split('@')[0] : "Consilier Imobiliar");
        const creatorEmail = currentUser?.email || "";

        const activeRuleForFallback = automationSettingsService.getCachedTitleRule();
        const finalTitle = title || crmData?.descriere?.titlu || generateStandardAdTitle({
          transactionType: crawledTrans,
          categoria: crawledCat || "Apartament",
          camere: crmData?.caracteristici?.detalii?.camere,
          suprafataUtila: crmData?.caracteristici?.suprafete?.utila,
          etaj: crmData?.caracteristici?.detalii?.etaj,
          zona: zone,
          compartimentare: crmData?.caracteristici?.detalii?.compartimentare,
          rawTitle: title,
          rawText: crawlData.description || crawlData.text || "",
          titleRule: activeRuleForFallback,
        });

        let resolvedPrice = price || "N/A";
        if (resolvedPrice !== "N/A" && (resolvedPrice.toLowerCase().includes("ron") || resolvedPrice.toLowerCase().includes("lei"))) {
          const digits = parseFloat(resolvedPrice.replace(/[^0-9.,]/g, "").replace(",", "."));
          if (!isNaN(digits) && digits > 0) {
            const inEur = Math.round(digits / 4.97);
            const isRentTrans = (crawledTrans || "").toLowerCase().includes("inchir");
            resolvedPrice = `${inEur.toLocaleString("ro-RO")} €${isRentTrans ? " / lună" : ""}`;
          }
        }

        const toCleanUrl = (u: string | undefined | null) => {
          if (!u || typeof u !== "string") return "";
          const normalized = u.trim().startsWith("//") ? "https:" + u.trim() : u.trim();
          if (normalized.startsWith("http") && !normalized.includes("/api/proxy-image")) {
            return `/api/proxy-image?url=${encodeURIComponent(normalized)}`;
          }
          return normalized;
        };

        const cleanCover = coverImage ? toCleanUrl(coverImage) : null;
        const rawImages = Array.isArray(crawlData.images) && crawlData.images.length > 0 
          ? crawlData.images 
          : (coverImage ? [coverImage] : []);
        const cleanImages = rawImages.map((u: string) => toCleanUrl(u)).filter(Boolean);

        if (crmData?.imagini) {
          const categories = ["living", "camera", "bucatarie", "baie", "alteSpatii"] as const;
          categories.forEach(cat => {
            if (Array.isArray(crmData.imagini[cat])) {
              crmData.imagini[cat] = crmData.imagini[cat].map((item: any) => {
                if (typeof item === "string") return toCleanUrl(item);
                if (item && item.original) return { ...item, original: toCleanUrl(item.original) };
                return item;
              });
            }
          });
        }

        await leadsService.addLead({
          url: url.trim(),
          title: finalTitle,
          zone: zone || "Nespecificat",
          price: resolvedPrice,
          ownerName: ownerName || "Nespecificat",
          ownerPhone: ownerPhone || "Nespecificat",
          transactionType: (crawledTrans as any) || 'Vânzare',
          categoria: crawledCat || "Apartament",
          status: "Noi",
          leadType: 'Proprietar',
          coverImage: cleanCover,
          images: cleanImages,
          createdByName: creatorName,
          createdByEmail: creatorEmail,
          author: creatorName,
          agent: creatorName,
          extractedData: crmData ? {
            crmData: crmData,
            presentationSections: crawlData.presentationSections || null,
            automationSource: crawlData.automationSource || null,
            markdownMarketing: crmData.descriere?.continut || "",
            summary: crawlData.presentationSections?.introducere?.summary || `${crawledCat || "Proprietate"} ${crmData.caracteristici?.detalii?.camere || "2"} camere în ${zone || "București"}, ${price || "N/A"}`,
            originalDescription: crawlData.description || crawlData.text || crmData.descriere?.continut || ""
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
        console.warn("[AddLeadModal] Add lead error:", error?.message || error);
        setStatus("Eroare la adăugare");
        const isAbort = error?.name === "AbortError";
        const isFetchError = error instanceof TypeError || error?.message?.includes("fetch");
        if (isAbort) {
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
            className="fixed inset-y-0 right-0 w-full max-w-[420px] bg-white shadow-2xl z-[301] flex flex-col border-l border-gray-200"
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
                            onChange={(e) => setUrl(e.target.value)}
                            className="w-full h-8 pl-8 pr-3 text-xs font-normal border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662]"
                          />
                        </div>
                        <p className="text-[11px] text-gray-400 font-normal mt-2 leading-relaxed">
                          Crawlerul va extrage automat detaliile, imaginile, prețul, categoria și contactul.
                        </p>
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
