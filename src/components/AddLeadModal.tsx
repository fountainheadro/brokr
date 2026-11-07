import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Globe, Loader2, Building2, User, Phone, Euro, Plus } from "lucide-react";
import { leadsService } from "../services/leadsService";
import { notificationsService } from "../services/notificationsService";
import { auth } from "../lib/firebase";
import { ZONA_OPTIONS, CATEGORIA_OPTIONS } from "../constants";
import toast from "react-hot-toast";
import { CETATENIE_OPTIONS } from "./AddCerereModal";

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
        const { title, price, zone, ownerName, ownerPhone, transactionType: crawledTrans, categoria: crawledCat, crmData, coverImage } = crawlData;

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
          transactionType: (crawledTrans as any) || 'Vânzare',
          categoria: crawledCat || "Apartament",
          status: "Noi",
          leadType: 'Proprietar',
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
        const title = `Cerere: ${categoria} ${transactionType === "Vânzare" ? "Cumpărare" : "Închiriere"} - ${zoneStr}`;

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
          status: "Noua",
          leadType: leadRole,
          notes: notesContent.trim() ? `Cerințe cerere: ${notesContent.trim()}` : ""
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
          className="relative bg-white rounded-xl shadow-2xl border border-gray-200 w-full max-w-lg overflow-hidden z-10 max-h-[90vh] flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gray-50/50 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#BE9662]/10 border border-[#BE9662]/20 flex items-center justify-center text-[#BE9662]">
                <Building2 size={18} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">
                  {leadRole === 'Proprietar' ? 'Adaugă Imobil / Proprietar' : leadRole === 'Chirias' ? 'Adaugă Chiriaș Nou' : 'Adaugă Cumpărător Nou'}
                </h3>
                <p className="text-[11px] text-gray-500">
                  {leadRole === 'Proprietar' ? 'Scanare și extragere automată date din URL' : 'Înregistrează cererea clientului'}
                </p>
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
          <form onSubmit={handleSubmit} className="p-5 space-y-3.5 overflow-y-auto text-xs flex-1">
            {/* Row 1: Tip & Categorie (Categorie hidden if Proprietar) */}
            <div className={`grid ${leadRole === 'Proprietar' ? 'grid-cols-1' : 'grid-cols-2'} gap-3`}>
              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  Tip
                </label>
                <select
                  value={leadRole}
                  onChange={(e) => setLeadRole(e.target.value as any)}
                  className="w-full h-8 px-2.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] bg-white cursor-pointer font-medium"
                >
                  <option value="Proprietar">Proprietar</option>
                  <option value="Chirias">Chiriaș</option>
                  <option value="Cumparator">Cumpărător</option>
                </select>
              </div>

              {leadRole !== 'Proprietar' && (
                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                    Categorie
                  </label>
                  <select
                    value={categoria}
                    onChange={(e) => setCategoria(e.target.value)}
                    className="w-full h-8 px-2.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] bg-white cursor-pointer"
                  >
                    {CATEGORIA_OPTIONS.map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {leadRole === 'Proprietar' ? (
              <>
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
                      className="w-full h-8 pl-8 pr-3 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662]"
                    />
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1.5">
                    Crawlerul va extrage automat detaliile, imaginile, prețul, categoria și contactul.
                  </p>
                </div>

                {loading && status && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-[#BE9662]/10 border border-[#BE9662]/20 rounded-lg text-xs text-[#051D35]">
                    <Loader2 size={14} className="animate-spin text-[#BE9662] shrink-0" />
                    <span className="font-medium">{status}</span>
                  </div>
                )}
              </>
            ) : (
              <>
                {/* Row 2: Nume Client & Telefon */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                      Nume Client *
                    </label>
                    <div className="relative">
                      <User size={14} className="absolute left-3 top-2.5 text-gray-400" />
                      <input
                        ref={inputRef}
                        type="text"
                        required
                        value={clientName}
                        onChange={(e) => setClientName(e.target.value)}
                        placeholder="ex. Radu Popescu"
                        className="w-full h-8 pl-8 pr-3 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662]"
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
                        className="w-full h-8 pl-8 pr-3 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662]"
                      />
                    </div>
                  </div>
                </div>

                {/* Row 3: Cetatenie & Animal (Only for Închiriere / Chirias) */}
                {transactionType === "Închiriere" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                        Cetățenie
                      </label>
                      <select
                        value={cetatenie}
                        onChange={(e) => setCetatenie(e.target.value)}
                        className="w-full h-8 px-2.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] bg-white cursor-pointer"
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
                        className="w-full h-8 px-2.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] bg-white cursor-pointer"
                      >
                        <option value="Fara">Fără</option>
                        <option value="Caine">Câine</option>
                        <option value="Pisica">Pisică</option>
                        <option value="Altceva">Altceva</option>
                      </select>
                    </div>
                  </div>
                )}

                {/* Buget Minim & Buget Maxim (Moved above Zona preferata) */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                      Buget Minim (€)
                    </label>
                    <div className="relative">
                      <Euro size={14} className="absolute left-3 top-2.5 text-gray-400" />
                      <input
                        type="text"
                        value={minBudget}
                        onChange={(e) => setMinBudget(e.target.value)}
                        placeholder="ex. 400"
                        className="w-full h-8 pl-8 pr-3 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662]"
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
                        value={maxBudget}
                        onChange={(e) => setMaxBudget(e.target.value)}
                        placeholder="ex. 700"
                        className="w-full h-8 pl-8 pr-3 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662]"
                      />
                    </div>
                  </div>
                </div>

                {/* Zona preferata - Auto-suggest multi selector */}
                <div className="relative">
                  <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                    Zonă preferată (Selectează din listă)
                  </label>
                  <div className="min-h-[32px] h-auto border border-gray-200 rounded-md p-1 bg-white focus-within:border-[#BE9662] focus-within:ring-1 focus-within:ring-[#BE9662] flex flex-wrap gap-1 items-center">
                    {zoneList.map((z) => (
                      <span key={z} className="inline-flex items-center gap-1 bg-gray-100 text-gray-800 px-2 py-0.5 rounded text-[11px] font-medium border border-gray-200">
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
                        className="w-full h-6 px-2 text-xs border-0 focus:outline-none focus:ring-0 bg-transparent"
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
                          className="px-3 py-1.5 text-xs text-gray-800 hover:bg-gray-100 cursor-pointer"
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
                    className="w-full px-3 py-2 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] resize-none"
                  />
                </div>
              </>
            )}

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100 shrink-0">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-50 cursor-pointer"
              >
                Anulează
              </button>
              <button
                type="submit"
                disabled={loading || (leadRole === 'Proprietar' && !url.trim())}
                className="h-8 px-4 text-xs font-medium bg-[#051D35] hover:bg-[#0a2b4a] text-white rounded-md transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-xs"
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
                      {leadRole === 'Proprietar' ? 'Adaugă Proprietar' : leadRole === 'Chirias' ? 'Adaugă Chiriaș' : 'Adaugă Cumpărător'}
                    </span>
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
