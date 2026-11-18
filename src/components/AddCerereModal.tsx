import React, { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, ClipboardList, Loader2, Euro, Phone, User, Plus } from "lucide-react";
import { leadsService } from "../services/leadsService";
import { notificationsService } from "../services/notificationsService";
import { ZONA_OPTIONS, CATEGORIA_OPTIONS } from "../constants";
import toast from "react-hot-toast";

interface AddCerereModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const CETATENIE_OPTIONS = [
  "Bangladesh", "Bulgaria", "Germania", "India", "Italia", "Marea Britanie", "Moldova", "Nepal", "Romania", "Serbia", "Spania", "Sri Lanka", "Turcia", "Ucraina", "Ungaria",
  "Afganistan", "Albania", "Algeria", "Andorra", "Angola", "Argentina", "Armenia", "Australia", "Austria", "Azerbaidjan", "Bahrain", "Belarus", "Belgia", "Benin", "Bolivia", "Bosnia și Herțegovina", "Botswana", "Brazilia", "Brunei", "Burkina Faso", "Burundi", "Cambodgia", "Camerun", "Canada", "Capul Verde", "Cehia", "Chile", "China", "Cipru", "Columbia", "Coreea de Sud", "Costa Rica", "Coasta de Fildeș", "Croația", "Cuba", "Danemarca", "Djibouti", "Dominica", "Ecuador", "Egipt", "El Salvador", "Elveția", "Emiratele Arabe Unite", "Eritrea", "Estonia", "Eswatini", "Etiopia", "Fiji", "Filipine", "Finlanda", "Franța", "Gabon", "Gambia", "Georgia", "Ghana", "Grecia", "Grenada", "Guatemala", "Guineea", "Guyana", "Haiti", "Honduras", "Islanda", "Indonezia", "Irak", "Iran", "Irlanda", "Israel", "Japonia", "Iordania", "Kazahstan", "Kenya", "Kârgâzstan", "Kuweit", "Laos", "Letonia", "Liban", "Liberia", "Libia", "Liechtenstein", "Lituania", "Luxemburg", "Macedonia de Nord", "Madagascar", "Malaezia", "Malawi", "Maldive", "Mali", "Malta", "Maroc", "Mauritania", "Mauritius", "Mexic", "Monaco", "Mongolia", "Muntenegru", "Mozambic", "Namibia", "Nauru", "Noua Zeelandă", "Nicaragua", "Niger", "Nigeria", "Norvegia", "Oman", "Pakistan", "Palau", "Panama", "Papua Noua Guinee", "Paraguay", "Peru", "Polonia", "Portugalia", "Qatar", "Republica Centrafricană", "Republica Democrată Congo", "Republica Congo", "Republica Dominicană", "Rwanda", "Samoa", "San Marino", "Sao Tome și Principe", "Senegal", "Seychelles", "Sierra Leone", "Singapore", "Slovacia", "Slovenia", "Somalia", "Suedia", "Suriname", "Syria", "Tadjikistan", "Tanzania", "Thailanda", "Timorul de Est", "Togo", "Tonga", "Trinidad-Tobago", "Tunisia", "Turkmenistan", "Tuvalu", "Uganda", "Uruguay", "Uzbekistan", "Vanuatu", "Vatican", "Venezuela", "Vietnam", "Yemen", "Zambia", "Zimbabwe"
];

export const AddCerereModal: React.FC<AddCerereModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [leadRole, setLeadRole] = useState<'Chirias' | 'Cumparator'>('Chirias');
  const [categoria, setCategoria] = useState("Apartament");
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
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

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
        notesContent += (notesContent ? " | " : "") + `Cetățenie: ${cetatenie} | Animale de companie: ${animal}`;
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
        ...(mobilare ? { mobilare } : {}),
        ...(parcare ? { parcare } : {}),
        notes: notesContent.trim() ? `Cerințe cerere: ${notesContent.trim()}` : ""
      });

      await notificationsService.addNotification({
        title: "Cerere Nouă Înregistrată",
        message: `${clientName} caută ${categoria} (${transactionType === "Vânzare" ? "cumpărare" : "închiriere"}) în ${zoneStr}.`,
        type: "lead"
      });

      toast.success("Cererea a fost înregistrată cu succes!");
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
          className="relative bg-white rounded-xl shadow-2xl border border-gray-200 w-full max-w-lg overflow-hidden z-10 max-h-[90vh] flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gray-50/50 shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[#BE9662]/10 border border-[#BE9662]/20 flex items-center justify-center text-[#BE9662]">
                <ClipboardList size={18} />
              </div>
              <div>
                <h3 className="font-title text-sm font-semibold text-gray-900">Adaugă Cerere Nouă</h3>
                <p className="text-[11px] text-gray-500 font-normal">Înregistrează o cerere de căutare cumpărător sau chiriaș</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-5 overflow-y-auto text-xs flex-1">
            <fieldset disabled={loading} className="border-0 p-0 m-0 min-w-0 space-y-4 flex-1 flex flex-col">
            {/* Row 1: Nume Client & Telefon */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  Nume Client *
                </label>
                <div className="relative">
                  <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
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

            {/* Row 3: Cetatenie & Animale de companie (Only for Închiriere) */}
            {transactionType === "Închiriere" && (
              <div className="grid grid-cols-2 gap-4">
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
            <div className="grid grid-cols-2 gap-4">
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

            {/* Tip & Categorie */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  Tip
                </label>
                <select
                  value={leadRole}
                  onChange={(e) => setLeadRole(e.target.value as any)}
                  className="w-full h-8 px-3 text-xs font-normal border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] bg-white cursor-pointer"
                >
                  <option value="Chirias">Chiriaș</option>
                  <option value="Cumparator">Cumpărător</option>
                </select>
              </div>

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
            </div>

            {/* Mobilare & Parcare */}
            <div className="grid grid-cols-2 gap-4">
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

            {/* Row 5: Zonă preferată */}
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

            {/* Row 6: Cerințe Specifice & Note */}
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

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-md transition-colors cursor-pointer"
              >
                Anulează
              </button>
              <button
                type="submit"
                disabled={loading}
                className="h-8 px-4 text-xs font-medium bg-[#051D35] hover:bg-[#0a2b4a] text-white rounded-md transition-colors flex items-center gap-2 disabled:opacity-50 cursor-pointer shadow-xs"
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
                      {leadRole === 'Chirias' ? 'Adaugă Chiriaș' : 'Adaugă Cumpărător'}
                    </span>
                  </>
                )}
              </button>
            </div>
            </fieldset>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
