import React, { useState, useEffect, useRef } from "react";
import { User, Phone, Euro, ChevronDown, Check, X } from "lucide-react";
import { ZONA_OPTIONS, COMPARTIMENTARE_OPTIONS, ETAJ_OPTIONS } from "../constants";
import type { Lead, LeadStatus } from "../services/leadsService";

export const CETATENIE_OPTIONS = [
  "Orice",
  "Bangladesh", "Bulgaria", "Germania", "India", "Italia", "Marea Britanie", "Moldova", "Nepal", "Romania", "Serbia", "Spania", "Sri Lanka", "Turcia", "Ucraina", "Ungaria",
  "Afganistan", "Albania", "Algeria", "Andorra", "Angola", "Argentina", "Armenia", "Australia", "Austria", "Azerbaidjan", "Bahrain", "Belarus", "Belgia", "Benin", "Bolivia", "Bosnia și Herțegovina", "Botswana", "Brazilia", "Brunei", "Burkina Faso", "Burundi", "Cambodgia", "Camerun", "Canada", "Capul Verde", "Cehia", "Chile", "China", "Cipru", "Columbia", "Coreea de Sud", "Costa Rica", "Coasta de Fildeș", "Croația", "Cuba", "Danemarca", "Djibouti", "Dominica", "Ecuador", "Egipt", "El Salvador", "Elveția", "Emiratele Arabe Unite", "Eritrea", "Estonia", "Eswatini", "Etiopia", "Fiji", "Filipine", "Finlanda", "Franța", "Gabon", "Gambia", "Georgia", "Ghana", "Grecia", "Grenada", "Guatemala", "Guineea", "Guyana", "Haiti", "Honduras", "Islanda", "Indonezia", "Irak", "Iran", "Irlanda", "Israel", "Japonia", "Iordania", "Kazahstan", "Kenya", "Kârgâzstan", "Kuweit", "Laos", "Letonia", "Liban", "Liberia", "Libia", "Liechtenstein", "Lituania", "Luxemburg", "Macedonia de Nord", "Madagascar", "Malaezia", "Malawi", "Maldive", "Mali", "Malta", "Maroc", "Mauritania", "Mauritius", "Mexic", "Monaco", "Mongolia", "Muntenegru", "Mozambic", "Namibia", "Nauru", "Noua Zeelandă", "Nicaragua", "Niger", "Nigeria", "Norvegia", "Oman", "Pakistan", "Palau", "Panama", "Papua Noua Guinee", "Paraguay", "Peru", "Polonia", "Portugalia", "Qatar", "Republica Centrafricană", "Republica Democrată Congo", "Republica Congo", "Republica Dominicană", "Rwanda", "Samoa", "San Marino", "Sao Tome și Principe", "Senegal", "Seychelles", "Sierra Leone", "Singapore", "Slovacia", "Slovenia", "Somalia", "Suedia", "Suriname", "Syria", "Tadjikistan", "Tanzania", "Thailanda", "Timorul de Est", "Togo", "Tonga", "Trinidad-Tobago", "Tunisia", "Turkmenistan", "Tuvalu", "Uganda", "Uruguay", "Uzbekistan", "Vanuatu", "Vatican", "Venezuela", "Vietnam", "Yemen", "Zambia", "Zimbabwe"
];

export const ANIMALE_OPTIONS = ["Fără", "Câine", "Pisică", "Altceva"];

export const PROFIL_CHIRIAS_OPTIONS = [
  "Orice",
  "Cuplu",
  "Familie",
  "Persoană singură",
  "Studenți",
  "Angajați",
  "Pensionari",
  "Străini",
];

export const COPII_OPTIONS = ["Fără", "1", "2", "3", "4", "5"];

export type BuildingCategoryType = "Apartament" | "Casa/Vila" | "Teren" | "Spatiu Comercial";

export const BUILDING_CATEGORY_OPTIONS: Array<{ value: BuildingCategoryType; label: string }> = [
  { value: "Apartament", label: "Apartament" },
  { value: "Casa/Vila", label: "Casă / Vilă" },
  { value: "Teren", label: "Teren" },
  { value: "Spatiu Comercial", label: "Spațiu Comercial" },
];

export const TEREN_CATEGORIE_OPTIONS = [
  "Construcții",
  "Agricol",
  "Pădure",
  "Livadă",
  "Fâneață",
  "Pășune",
  "Heleșteu",
];

export const TEREN_CLASIFICARE_OPTIONS = ["Intravilan", "Extravilan"];

export const COMERCIAL_CATEGORIE_OPTIONS = [
  "Birouri",
  "Comercial",
  "Industrial",
  "Teren investiții",
  "Hotel/Pensiune",
  "Proprietăți speciale",
];

export const MODALITATE_ACHIZITIE_OPTIONS = ["Cash", "Credit", "Mixt"];

export const NUMAR_CAMERE_OPTIONS = [
  "1 cameră / Garsonieră",
  "2 camere",
  "3 camere",
  "4 camere",
  "5+ camere",
];

export const NUMAR_BAI_OPTIONS = ["1 baie", "2 băi", "3 băi", "4+ băi"];

export const MOBILARE_UTILARE_OPTIONS = ["Fără", "Parțială", "Completă"];

export const TIP_PARCARE_OPTIONS = [
  "Fără",
  "Stradală",
  "Subterană",
  "Supraterană",
  "Garaj",
  "Curte",
];

export const NUMAR_LOCURI_PARCARE_OPTIONS = [
  "Fără",
  "1 loc",
  "2 locuri",
  "3 locuri",
  "4 locuri",
  "5 locuri",
];

export const STARE_INTERIOR_OPTIONS = ["Necesită renovare", "Renovat", "Bună"];

export const SISTEM_INCALZIRE_OPTIONS = [
  "Centrală proprie",
  "Centrală imobil",
  "Termoficare",
  "Pompă căldură",
  "Convector",
  "Panouri infraroșu",
];

export const METODA_INCALZIRE_OPTIONS = ["Calorifere", "Pardoseală"];

export const LIFT_OPTIONS = ["Da", "Nu"];

export const GRADINA_OPTIONS = ["Proprie", "Comună"];

export const BALCOANE_TERASE_LOGII_OPTIONS = ["1", "2", "3", "4", "5"];

export const UTILITATI_STANDARD_OPTIONS = ["Apă", "Canalizare", "Gaze"];
export const UTILITATI_TEREN_OPTIONS = ["Apă", "Canalizare", "Gaze", "Electricitate"];

export const SERVICII_IMOBIL_OPTIONS = [
  "Administrare",
  "Menaj",
  "Pază",
  "Supraveghere video",
];

export const ETAJE_PESTE_PARTER_OPTIONS = Array.from({ length: 10 }, (_, i) => String(i + 1));

export const CONTRACT_DURATA_OPTIONS = [
  "6 luni",
  "12 luni",
  "24 luni",
  "36 luni",
  "48 luni",
  "60 luni",
];

export const AVANS_GARANTIE_OPTIONS = [
  "1 luna",
  "2 luni",
  "3 luni",
  "4 luni",
  "5 luni",
  "6 luni",
];

export interface PropertyCriteriaFormState {
  clientName: string;
  clientPhone: string;
  cetatenie: string[];
  animal: string[];
  profil: string[];
  copii: string;
  minBudget: string;
  maxBudget: string;
  tva: string;
  comision: string;
  contractDurata: string;
  avans: string;
  garantie: string;
  situatieJuridica: string;
  disponibilitate: string;
  modalitateAchizitie: string;
  tipAchizitieAcceptat: string[];
  buildingType: BuildingCategoryType;
  terenCategorie: string;
  terenClasificare: string;
  comercialCategorie: string;
  compartimentare: string;
  selectedRooms: string[];
  selectedBaths: string[];
  selectedFloors: string[];
  totalFloors: string;
  casaSubsol: boolean;
  casaDemisol: boolean;
  casaEtajePesteParter: string;
  mobilare: string;
  utilare: string;
  tipParcare: string;
  numarLocuriParcare: string;
  zoneList: string[];
  propertyTitle: string;
  requirements: string;
  // Accordion 2 — Informații avansate
  anConstructieMin: string;
  anConstructieMax: string;
  suprafataUtilaMin: string;
  suprafataUtilaMax: string;
  suprafataConstruitaMin: string;
  suprafataConstruitaMax: string;
  suprafataCurteMin: string;
  suprafataCurteMax: string;
  suprafataTerenMin: string;
  suprafataTerenMax: string;
  frontStradal: string;
  // Accordion 3 — Alte informații
  stareInterior: string;
  sistemIncalzire: string;
  metodaIncalzire: string;
  lift: string;
  gradina: string;
  balcoaneTeraseLogii: string[];
  utilitati: string[];
  serviciiImobil: string[];
}

export function createInitialPropertyCriteriaState(): PropertyCriteriaFormState {
  return {
    clientName: "",
    clientPhone: "",
    cetatenie: [],
    animal: [],
    profil: [],
    copii: "",
    minBudget: "",
    maxBudget: "",
    tva: "",
    comision: "",
    contractDurata: "12 luni",
    avans: "1 luna",
    garantie: "1 luna",
    situatieJuridica: "Fara probleme",
    disponibilitate: "Imediată",
    modalitateAchizitie: "",
    tipAchizitieAcceptat: [],
    buildingType: "Apartament",
    terenCategorie: "Construcții",
    terenClasificare: "Intravilan",
    comercialCategorie: "Comercial",
    compartimentare: "",
    selectedRooms: [],
    selectedBaths: [],
    selectedFloors: [],
    totalFloors: "",
    casaSubsol: false,
    casaDemisol: false,
    casaEtajePesteParter: "",
    mobilare: "",
    utilare: "",
    tipParcare: "",
    numarLocuriParcare: "",
    zoneList: [],
    propertyTitle: "",
    requirements: "",
    anConstructieMin: "",
    anConstructieMax: "",
    suprafataUtilaMin: "",
    suprafataUtilaMax: "",
    suprafataConstruitaMin: "",
    suprafataConstruitaMax: "",
    suprafataCurteMin: "",
    suprafataCurteMax: "",
    suprafataTerenMin: "",
    suprafataTerenMax: "",
    frontStradal: "",
    stareInterior: "",
    sistemIncalzire: "",
    metodaIncalzire: "",
    lift: "",
    gradina: "",
    balcoaneTeraseLogii: [],
    utilitati: [],
    serviciiImobil: [],
  };
}

export interface MultiSelectDropdownProps {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  isOpen: boolean;
  onToggleOpen: () => void;
  onClose: () => void;
  disabled?: boolean;
  placeholder?: string;
}

export const MultiSelectDropdown: React.FC<MultiSelectDropdownProps> = ({
  label,
  options,
  selected,
  onChange,
  isOpen,
  onToggleOpen,
  onClose,
  disabled = false,
  placeholder = "Selectează...",
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  const toggleOption = (option: string) => {
    if (selected.includes(option)) {
      onChange(selected.filter((item) => item !== option));
    } else {
      onChange([...selected, option]);
    }
  };

  const displayText =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? selected[0]
        : `${selected.length} selectate`;

  return (
    <div ref={containerRef} className="relative">
      <label className="block text-[11px] font-semibold text-gray-700 mb-1">
        {label}
      </label>
      <button
        type="button"
        disabled={disabled}
        onClick={onToggleOpen}
        title={selected.length > 0 ? selected.join(", ") : placeholder}
        className={`w-full h-8 px-2.5 text-xs font-normal border rounded-md bg-white flex items-center justify-between gap-1.5 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
          isOpen
            ? "border-[#BE9662] ring-1 ring-[#BE9662]"
            : "border-gray-200 hover:border-gray-300"
        }`}
      >
        <span className={`truncate ${selected.length === 0 ? "text-gray-400" : "text-gray-800"}`}>
          {displayText}
        </span>
        <ChevronDown
          size={13}
          className={`text-gray-400 shrink-0 transition-transform ${isOpen ? "rotate-180 text-[#BE9662]" : ""}`}
        />
      </button>

      {isOpen && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-50 overflow-hidden">
          <div className="max-h-44 overflow-y-auto py-1 custom-scrollbar">
            {options.map((option) => {
              const isChecked = selected.includes(option);
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => toggleOption(option)}
                  className={`w-full px-2.5 py-1.5 text-left text-xs flex items-center gap-2 transition-colors cursor-pointer ${
                    isChecked
                      ? "bg-[#051D35]/5 text-[#051D35] font-medium"
                      : "text-gray-700 hover:bg-gray-50 font-normal"
                  }`}
                >
                  <span
                    className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                      isChecked
                        ? "bg-[#051D35] border-[#051D35] text-white"
                        : "border-gray-300 bg-white"
                    }`}
                  >
                    {isChecked && <Check size={10} strokeWidth={3} />}
                  </span>
                  <span className="truncate">{option}</span>
                </button>
              );
            })}
          </div>
          {selected.length > 0 && (
            <div className="border-t border-gray-100 px-2.5 py-1.5 bg-gray-50/80 flex items-center justify-between">
              <span className="text-[10px] text-gray-500 truncate">
                {selected.join(", ")}
              </span>
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-[10px] font-semibold text-[#051D35] hover:text-[#BE9662] ml-2 shrink-0 cursor-pointer"
              >
                Resetează
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export interface TagMultiSelectProps {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  requireQueryToOpen?: boolean;
  maxVisibleOptions?: number;
  disabled?: boolean;
}

export const TagMultiSelect: React.FC<TagMultiSelectProps> = ({
  label,
  options,
  selected,
  onChange,
  placeholder,
  requireQueryToOpen = false,
  maxVisibleOptions = 12,
  disabled = false,
}) => {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const remaining = options
    .filter(
      (opt) =>
        !selected.includes(opt) &&
        opt.toLowerCase().includes(query.trim().toLowerCase())
    )
    .slice(0, maxVisibleOptions);

  const shouldShowList =
    isOpen &&
    !disabled &&
    remaining.length > 0 &&
    (!requireQueryToOpen || query.trim().length > 0);

  const handleSelect = (opt: string) => {
    if (!selected.includes(opt)) {
      onChange([...selected, opt]);
    }
    setQuery("");
    if (requireQueryToOpen) {
      setIsOpen(false);
    }
  };

  const handleRemove = (opt: string) => {
    onChange(selected.filter((item) => item !== opt));
  };

  return (
    <div ref={containerRef} className="relative">
      <label className="block text-[11px] font-semibold text-gray-700 mb-1">
        {label}
      </label>
      <div
        onClick={() => {
          if (!disabled) setIsOpen(true);
        }}
        className="min-h-[32px] h-auto border border-gray-200 rounded-md p-1 bg-white focus-within:border-[#BE9662] focus-within:ring-1 focus-within:ring-[#BE9662] flex flex-wrap gap-1 items-center"
      >
        {selected.map((item) => (
          <span
            key={item}
            className="inline-flex items-center gap-1 bg-gray-100 text-gray-800 px-2 py-0.5 rounded text-[11px] font-normal border border-gray-200"
          >
            {item}
            <button
              type="button"
              disabled={disabled}
              onClick={(e) => {
                e.stopPropagation();
                handleRemove(item);
              }}
              className="text-gray-500 hover:text-red-600 cursor-pointer disabled:opacity-50"
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <div className="relative flex-1 min-w-[80px] flex items-center">
          <input
            type="text"
            disabled={disabled}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            placeholder={selected.length === 0 ? placeholder : "Adaugă..."}
            className="w-full h-6 px-2 text-xs font-normal border-0 focus:outline-none focus:ring-0 bg-transparent"
          />
        </div>
      </div>

      {shouldShowList && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-50 max-h-40 overflow-y-auto divide-y divide-gray-50">
          {remaining.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => handleSelect(opt)}
              className="w-full text-left px-3 py-2 text-xs font-normal text-gray-800 hover:bg-gray-100 cursor-pointer"
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

interface AccordionSectionProps {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

const AccordionSection: React.FC<AccordionSectionProps> = ({
  title,
  isOpen,
  onToggle,
  children,
}) => (
  <div className="border border-gray-200 rounded-lg bg-white">
    <button
      type="button"
      onClick={onToggle}
      className={`w-full h-9 px-3.5 flex items-center justify-between text-left bg-gray-50/80 hover:bg-gray-100/80 transition-colors cursor-pointer ${
        isOpen ? "rounded-t-lg border-b border-gray-200" : "rounded-lg"
      }`}
    >
      <span className="text-[12px] font-semibold text-[#051D35]">
        {title}
      </span>
      <ChevronDown
        size={14}
        className={`text-gray-500 transition-transform duration-150 ${isOpen ? "rotate-180 text-[#BE9662]" : ""}`}
      />
    </button>
    {isOpen && <div className="p-3.5 space-y-3">{children}</div>}
  </div>
);

interface PropertyCriteriaAccordionFormProps {
  role: "Chirias" | "Cumparator";
  mode?: "lead" | "cerere" | "property";
  state: PropertyCriteriaFormState;
  onChange: React.Dispatch<React.SetStateAction<PropertyCriteriaFormState>>;
  disabled?: boolean;
  firstInputRef?: React.RefObject<HTMLInputElement | null>;
}

export const PropertyCriteriaAccordionForm: React.FC<PropertyCriteriaAccordionFormProps> = ({
  role,
  mode = "lead",
  state,
  onChange,
  disabled = false,
  firstInputRef,
}) => {
  const [openAccordion, setOpenAccordion] = useState<
    "persoana" | "clientDorit" | "pretConditii" | "generale" | "imobil" | "avansate" | "alte"
  >("persoana");

  const [openMultiDropdown, setOpenMultiDropdown] = useState<
    "rooms" | "baths" | "floors" | "balcoane" | "tipAchizitie" | null
  >(null);

  const selectAccordion = (
    key: "persoana" | "clientDorit" | "pretConditii" | "generale" | "imobil" | "avansate" | "alte"
  ) => {
    setOpenAccordion(key);
  };

  const setField = <K extends keyof PropertyCriteriaFormState>(
    key: K,
    value: PropertyCriteriaFormState[K]
  ) => {
    onChange((prev) => ({ ...prev, [key]: value }));
  };

  const isChirias = role === "Chirias";
  const isCumparator = role === "Cumparator";
  const isApartament = state.buildingType === "Apartament";
  const isCasaVila = state.buildingType === "Casa/Vila";
  const isTeren = state.buildingType === "Teren";
  const isComercial = state.buildingType === "Spatiu Comercial";

  const isPropertyMode = mode === "property";
  const nameLabel = isPropertyMode ? "Nume Proprietar *" : "Nume Client *";
  const zoneLabel = isPropertyMode
    ? "Zonă (Selectează din listă)"
    : "Zonă preferată (Selectează din listă)";
  const descriptionLabel = mode === "cerere" ? "Cerințe specifice" : "Descriere";
  const descriptionPlaceholder = isPropertyMode
    ? "Descrierea proprietății..."
    : mode === "lead"
      ? "Descriere / detalii suplimentare..."
      : "ex. Minim 60mp, decomandat, loc parcare, bloc după 2015...";

  const selectClass =
    "w-full h-8 px-2.5 text-xs font-normal border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] bg-white cursor-pointer disabled:opacity-60";
  const inputClass =
    "w-full h-8 px-2.5 text-xs font-normal border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] disabled:opacity-60";

  const handleBuildingTypeChange = (nextType: BuildingCategoryType) => {
    setOpenMultiDropdown(null);
    onChange((prev) => {
      const allowedUtils =
        nextType === "Teren" ? UTILITATI_TEREN_OPTIONS : UTILITATI_STANDARD_OPTIONS;
      return {
        ...prev,
        buildingType: nextType,
        utilitati: prev.utilitati.filter((u) => allowedUtils.includes(u)),
      };
    });
  };

  const personAccordionTitle = isPropertyMode
    ? "Informații Proprietar"
    : isChirias
      ? "Informații Chiriaș"
      : "Informații Cumpărător";

  const propertyAccordionTitle = isApartament
    ? "Informații Apartament"
    : isCasaVila
      ? "Informații Casă / Vilă"
      : isTeren
        ? "Informații Teren"
        : "Informații Spațiu Comercial";

  return (
    <div className="space-y-3">
      {/* 1ST ACCORDION: Informații Proprietar / Chiriaș / Cumpărător */}
      <AccordionSection
        title={personAccordionTitle}
        isOpen={openAccordion === "persoana"}
        onToggle={() => selectAccordion("persoana")}
      >
        {/* Row 1: Nume client / Telefon */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-gray-700 mb-1">
              {nameLabel}
            </label>
            <div className="relative">
              <User size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                ref={firstInputRef}
                type="text"
                required
                value={state.clientName}
                onChange={(e) => setField("clientName", e.target.value)}
                placeholder="ex. Radu Popescu"
                className="w-full h-8 pl-8 pr-2.5 text-xs font-normal border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662]"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-gray-700 mb-1">
              Telefon *
            </label>
            <div className="relative">
              <Phone size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="tel"
                required
                value={state.clientPhone}
                onChange={(e) => setField("clientPhone", e.target.value)}
                placeholder="07xxxxxxxx"
                className="w-full h-8 pl-8 pr-2.5 text-xs font-normal border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662]"
              />
            </div>
          </div>
        </div>

        {/* Rows 2 & 3 (Lead/Cerere Chiriaș only): Cetățenie | Animale de companie, apoi Profil | Copii */}
        {!isPropertyMode && isChirias && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <TagMultiSelect
                label="Cetățenie"
                options={CETATENIE_OPTIONS}
                selected={state.cetatenie}
                onChange={(next) => setField("cetatenie", next)}
                placeholder="Selectează..."
                disabled={disabled}
              />

              <TagMultiSelect
                label="Animale de companie"
                options={ANIMALE_OPTIONS}
                selected={state.animal}
                onChange={(next) => setField("animal", next)}
                placeholder="Selectează..."
                disabled={disabled}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <TagMultiSelect
                label="Profil"
                options={PROFIL_CHIRIAS_OPTIONS}
                selected={state.profil}
                onChange={(next) => setField("profil", next)}
                placeholder="Selectează..."
                disabled={disabled}
              />

              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  Copii
                </label>
                <select
                  value={state.copii}
                  onChange={(e) => setField("copii", e.target.value)}
                  className={selectClass}
                >
                  <option value="">Selectează...</option>
                  {COPII_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            </div>
          </>
        )}

        {/* Row: Buget minim / Buget maxim for lead/cerere (Preț (€) moved to Preț & Condiții for property mode) */}
        {!isPropertyMode && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                Buget Minim (€)
              </label>
              <div className="relative">
                <Euro size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  inputMode="numeric"
                  value={state.minBudget}
                  onChange={(e) => setField("minBudget", e.target.value)}
                  placeholder={isChirias ? "ex. 400" : "ex. 80000"}
                  className="w-full h-8 pl-8 pr-2.5 text-xs font-normal border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662]"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                Buget Maxim (€)
              </label>
              <div className="relative">
                <Euro size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  inputMode="numeric"
                  value={state.maxBudget}
                  onChange={(e) => setField("maxBudget", e.target.value)}
                  placeholder={isChirias ? "ex. 700" : "ex. 120000"}
                  className="w-full h-8 pl-8 pr-2.5 text-xs font-normal border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662]"
                />
              </div>
            </div>
          </div>
        )}
      </AccordionSection>

      {/* 2ND ACCORDION (Property mode only): Informații Chiriaș / Informații Cumpărător */}
      {isPropertyMode && (
        <AccordionSection
          title={isChirias ? "Informații Chiriaș" : "Informații Cumpărător"}
          isOpen={openAccordion === "clientDorit"}
          onToggle={() => selectAccordion("clientDorit")}
        >
          {isChirias ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <TagMultiSelect
                  label="Cetățenie"
                  options={CETATENIE_OPTIONS}
                  selected={state.cetatenie}
                  onChange={(next) => setField("cetatenie", next)}
                  placeholder="Selectează..."
                  disabled={disabled}
                />

                <TagMultiSelect
                  label="Animale de companie"
                  options={ANIMALE_OPTIONS}
                  selected={state.animal}
                  onChange={(next) => setField("animal", next)}
                  placeholder="Selectează..."
                  disabled={disabled}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <TagMultiSelect
                  label="Profil"
                  options={PROFIL_CHIRIAS_OPTIONS}
                  selected={state.profil}
                  onChange={(next) => setField("profil", next)}
                  placeholder="Selectează..."
                  disabled={disabled}
                />

                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                    Copii
                  </label>
                  <select
                    value={state.copii}
                    onChange={(e) => setField("copii", e.target.value)}
                    className={selectClass}
                  >
                    <option value="">Selectează...</option>
                    {COPII_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          ) : (
            <MultiSelectDropdown
              label="Tip achiziție acceptat"
              options={MODALITATE_ACHIZITIE_OPTIONS}
              selected={state.tipAchizitieAcceptat}
              onChange={(next) => setField("tipAchizitieAcceptat", next)}
              isOpen={openMultiDropdown === "tipAchizitie"}
              onToggleOpen={() =>
                setOpenMultiDropdown((prev) =>
                  prev === "tipAchizitie" ? null : "tipAchizitie"
                )
              }
              onClose={() =>
                setOpenMultiDropdown((prev) => (prev === "tipAchizitie" ? null : prev))
              }
              disabled={disabled}
            />
          )}
        </AccordionSection>
      )}

      {/* 3RD ACCORDION (Property mode only): Preț & Condiții */}
      {isPropertyMode && (
        <AccordionSection
          title="Preț & Condiții"
          isOpen={openAccordion === "pretConditii"}
          onToggle={() => selectAccordion("pretConditii")}
        >
          {/* Row 1: Preț (€) | TVA */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                Preț (€)
              </label>
              <div className="relative">
                <Euro size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  inputMode="numeric"
                  value={state.maxBudget || state.minBudget}
                  onChange={(e) =>
                    onChange((prev) => ({
                      ...prev,
                      minBudget: "",
                      maxBudget: e.target.value,
                    }))
                  }
                  placeholder={isChirias ? "ex. 600" : "ex. 120000"}
                  className="w-full h-8 pl-8 pr-2.5 text-xs font-normal border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662]"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                TVA
              </label>
              <input
                type="text"
                value={state.tva}
                onChange={(e) => setField("tva", e.target.value)}
                placeholder="Scutit de TVA / conform legislației în vigoare"
                className={inputClass}
              />
            </div>
          </div>

          {isChirias ? (
            <>
              {/* Row 2 (Închiriere): Comision | Contract */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                    Comision
                  </label>
                  <input
                    type="text"
                    value={state.comision}
                    onChange={(e) => setField("comision", e.target.value)}
                    placeholder="50%+TVA"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                    Contract
                  </label>
                  <select
                    value={state.contractDurata}
                    onChange={(e) => setField("contractDurata", e.target.value)}
                    className={selectClass}
                  >
                    <option value="">Selectează...</option>
                    {CONTRACT_DURATA_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Row 3 (Închiriere): Avans | Garanție */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                    Avans
                  </label>
                  <select
                    value={state.avans}
                    onChange={(e) => setField("avans", e.target.value)}
                    className={selectClass}
                  >
                    <option value="">Selectează...</option>
                    {AVANS_GARANTIE_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                    Garanție
                  </label>
                  <select
                    value={state.garantie}
                    onChange={(e) => setField("garantie", e.target.value)}
                    className={selectClass}
                  >
                    <option value="">Selectează...</option>
                    {AVANS_GARANTIE_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Row 2 (Vânzare): Comision | Situație juridică */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                    Comision
                  </label>
                  <input
                    type="text"
                    value={state.comision}
                    onChange={(e) => setField("comision", e.target.value)}
                    placeholder="0%"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                    Situație juridică
                  </label>
                  <input
                    type="text"
                    value={state.situatieJuridica}
                    onChange={(e) => setField("situatieJuridica", e.target.value)}
                    placeholder="Fara probleme"
                    className={inputClass}
                  />
                </div>
              </div>

              {/* Row 3 (Vânzare): Disponibilitate (Tip achiziție acceptat moved to Informații Cumpărător) */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  Disponibilitate
                </label>
                <input
                  type="text"
                  value={state.disponibilitate}
                  onChange={(e) => setField("disponibilitate", e.target.value)}
                  placeholder="Imediată"
                  className={inputClass}
                />
              </div>
            </>
          )}
        </AccordionSection>
      )}

      {/* 3RD ACCORDION (Property mode only): Informații Generale */}
      {isPropertyMode && (
        <AccordionSection
          title="Informații Generale"
          isOpen={openAccordion === "generale"}
          onToggle={() => selectAccordion("generale")}
        >
          {/* Row 1: Titlu */}
          <div>
            <label className="block text-[11px] font-semibold text-gray-700 mb-1">
              Titlu
            </label>
            <input
              type="text"
              value={state.propertyTitle}
              onChange={(e) => setField("propertyTitle", e.target.value)}
              placeholder="ex. Apartament 2 camere, decomandat, zonă centrală..."
              className={inputClass}
            />
          </div>

          {/* Row 2: Descriere */}
          <div>
            <label className="block text-[11px] font-semibold text-gray-700 mb-1">
              Descriere
            </label>
            <textarea
              rows={3}
              value={state.requirements}
              onChange={(e) => setField("requirements", e.target.value)}
              placeholder={descriptionPlaceholder}
              className="w-full px-3 py-2 text-xs font-normal border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] resize-none"
            />
          </div>
        </AccordionSection>
      )}

      {/* NEXT ACCORDION: Informații Apartament / Casă / Vilă / Teren / Spațiu Comercial */}
      <AccordionSection
        title={propertyAccordionTitle}
        isOpen={openAccordion === "imobil"}
        onToggle={() => selectAccordion("imobil")}
      >
        {/* Row: Modalitate achiziție (Lead/Cerere Cumpărător only; Tip achiziție acceptat moved to Preț & Condiții for property mode) */}
        {!isPropertyMode && isCumparator && !isComercial && (
          <div>
            <label className="block text-[11px] font-semibold text-gray-700 mb-1">
              Modalitate achiziție
            </label>
            <select
              value={state.modalitateAchizitie}
              onChange={(e) => setField("modalitateAchizitie", e.target.value)}
              className={selectClass}
            >
              <option value="">Selectează...</option>
              {MODALITATE_ACHIZITIE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
        )}

        {/* Row: Categorie / Compartimentare (Apartament & Casa/Vila) */}
        {(isApartament || isCasaVila) && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                Categorie
              </label>
              <select
                value={state.buildingType}
                onChange={(e) => handleBuildingTypeChange(e.target.value as BuildingCategoryType)}
                className={selectClass}
              >
                {BUILDING_CATEGORY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                Compartimentare
              </label>
              <select
                value={state.compartimentare}
                onChange={(e) => setField("compartimentare", e.target.value)}
                className={selectClass}
              >
                <option value="">Selectează...</option>
                {COMPARTIMENTARE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Row: Teren — Tip proprietate switcher + Categorie teren / Clasificare */}
        {isTeren && (
          <>
            <div>
              <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                Tip imobil
              </label>
              <select
                value={state.buildingType}
                onChange={(e) => handleBuildingTypeChange(e.target.value as BuildingCategoryType)}
                className={selectClass}
              >
                {BUILDING_CATEGORY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  Categorie
                </label>
                <select
                  value={state.terenCategorie}
                  onChange={(e) => setField("terenCategorie", e.target.value)}
                  className={selectClass}
                >
                  {TEREN_CATEGORIE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  Clasificare
                </label>
                <select
                  value={state.terenClasificare}
                  onChange={(e) => setField("terenClasificare", e.target.value)}
                  className={selectClass}
                >
                  {TEREN_CLASIFICARE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            </div>
          </>
        )}

        {/* Row: Spațiu Comercial — Tip imobil switcher + Categorie / Compartimentare */}
        {isComercial && (
          <>
            <div>
              <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                Tip imobil
              </label>
              <select
                value={state.buildingType}
                onChange={(e) => handleBuildingTypeChange(e.target.value as BuildingCategoryType)}
                className={selectClass}
              >
                {BUILDING_CATEGORY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  Categorie
                </label>
                <select
                  value={state.comercialCategorie}
                  onChange={(e) => setField("comercialCategorie", e.target.value)}
                  className={selectClass}
                >
                  {COMERCIAL_CATEGORIE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  Compartimentare
                </label>
                <select
                  value={state.compartimentare}
                  onChange={(e) => setField("compartimentare", e.target.value)}
                  className={selectClass}
                >
                  <option value="">Selectează...</option>
                  {COMPARTIMENTARE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            </div>
          </>
        )}

        {/* Non-Teren fields: Număr camere/băi, Etaje, Mobilare/Utilare, Tip parcare/Locuri */}
        {!isTeren && (
          <>
            {/* Row: Număr camere / Număr băi */}
            <div className="grid grid-cols-2 gap-3">
              <MultiSelectDropdown
                label="Număr camere"
                options={NUMAR_CAMERE_OPTIONS}
                selected={state.selectedRooms}
                onChange={(next) => setField("selectedRooms", next)}
                isOpen={openMultiDropdown === "rooms"}
                onToggleOpen={() =>
                  setOpenMultiDropdown((prev) => (prev === "rooms" ? null : "rooms"))
                }
                onClose={() =>
                  setOpenMultiDropdown((prev) => (prev === "rooms" ? null : prev))
                }
                disabled={disabled}
              />

              <MultiSelectDropdown
                label="Număr băi"
                options={NUMAR_BAI_OPTIONS}
                selected={state.selectedBaths}
                onChange={(next) => setField("selectedBaths", next)}
                isOpen={openMultiDropdown === "baths"}
                onToggleOpen={() =>
                  setOpenMultiDropdown((prev) => (prev === "baths" ? null : "baths"))
                }
                onClose={() =>
                  setOpenMultiDropdown((prev) => (prev === "baths" ? null : prev))
                }
                disabled={disabled}
              />
            </div>

            {/* Row: Etaje — Apartament / Spațiu Comercial vs Casă / Vilă */}
            {isCasaVila ? (
              <div className="space-y-2 rounded-md border border-gray-200 bg-gray-50/60 p-2.5">
                <label className="block text-[11px] font-semibold text-gray-700">
                  Etaje
                </label>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <label className="inline-flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={state.casaSubsol}
                      onChange={(e) => setField("casaSubsol", e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-gray-300 accent-[#051D35] cursor-pointer"
                    />
                    <span>Subsol</span>
                  </label>

                  <label className="inline-flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={state.casaDemisol}
                      onChange={(e) => setField("casaDemisol", e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-gray-300 accent-[#051D35] cursor-pointer"
                    />
                    <span>Demisol</span>
                  </label>

                  <label className="inline-flex items-center gap-1.5 text-xs text-gray-500 cursor-not-allowed select-none">
                    <input
                      type="checkbox"
                      checked
                      disabled
                      className="w-3.5 h-3.5 rounded border-gray-300 accent-[#051D35] cursor-not-allowed opacity-70"
                    />
                    <span>Parter</span>
                  </label>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-gray-600 mb-1">
                    Etaje peste parter
                  </label>
                  <select
                    value={state.casaEtajePesteParter}
                    onChange={(e) => setField("casaEtajePesteParter", e.target.value)}
                    className={selectClass}
                  >
                    <option value="">Selectează (1-10)...</option>
                    {ETAJE_PESTE_PARTER_OPTIONS.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <MultiSelectDropdown
                  label="Etaj apartament"
                  options={ETAJ_OPTIONS}
                  selected={state.selectedFloors}
                  onChange={(next) => setField("selectedFloors", next)}
                  isOpen={openMultiDropdown === "floors"}
                  onToggleOpen={() =>
                    setOpenMultiDropdown((prev) => (prev === "floors" ? null : "floors"))
                  }
                  onClose={() =>
                    setOpenMultiDropdown((prev) => (prev === "floors" ? null : prev))
                  }
                  disabled={disabled}
                />

                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                    {isComercial ? "Etaje total clădire" : "Etaje total bloc"}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={state.totalFloors}
                    onChange={(e) => setField("totalFloors", e.target.value)}
                    placeholder="ex. 10"
                    className={inputClass}
                  />
                </div>
              </div>
            )}

            {/* Row: Mobilare / Utilare */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  Mobilare
                </label>
                <select
                  value={state.mobilare}
                  onChange={(e) => setField("mobilare", e.target.value)}
                  className={selectClass}
                >
                  <option value="">Selectează...</option>
                  {MOBILARE_UTILARE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  Utilare
                </label>
                <select
                  value={state.utilare}
                  onChange={(e) => setField("utilare", e.target.value)}
                  className={selectClass}
                >
                  <option value="">Selectează...</option>
                  {MOBILARE_UTILARE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Row: Tip parcare / Număr locuri parcare */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  Tip parcare
                </label>
                <select
                  value={state.tipParcare}
                  onChange={(e) => setField("tipParcare", e.target.value)}
                  className={selectClass}
                >
                  <option value="">Selectează...</option>
                  {TIP_PARCARE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  Număr locuri parcare
                </label>
                <select
                  value={state.numarLocuriParcare}
                  onChange={(e) => setField("numarLocuriParcare", e.target.value)}
                  className={selectClass}
                >
                  <option value="">Selectează...</option>
                  {NUMAR_LOCURI_PARCARE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            </div>
          </>
        )}

        {/* Row: Zonă preferată */}
        <TagMultiSelect
          label={zoneLabel}
          options={ZONA_OPTIONS}
          selected={state.zoneList}
          onChange={(next) => setField("zoneList", next)}
          placeholder="Caută zonă..."
          requireQueryToOpen
          maxVisibleOptions={8}
          disabled={disabled}
        />

        {/* Row: Descriere (lead) / Cerințe specifice (cerere) — moved to Informații Generale for property mode */}
        {!isPropertyMode && (
          <div>
            <label className="block text-[11px] font-semibold text-gray-700 mb-1">
              {descriptionLabel}
            </label>
            <textarea
              rows={2}
              value={state.requirements}
              onChange={(e) => setField("requirements", e.target.value)}
              placeholder={descriptionPlaceholder}
              className="w-full px-3 py-2 text-xs font-normal border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] resize-none"
            />
          </div>
        )}
      </AccordionSection>

      {/* 3RD ACCORDION: Informații Avansate */}
      <AccordionSection
        title="Informații Avansate"
        isOpen={openAccordion === "avansate"}
        onToggle={() => selectAccordion("avansate")}
      >
        {isTeren ? (
          isPropertyMode ? (
            /* Property Teren: unite Suprafață (mp) / Front stradal (m) on one row */
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  Suprafață (mp)
                </label>
                <input
                  type="number"
                  min={0}
                  value={state.suprafataTerenMin || state.suprafataTerenMax}
                  onChange={(e) =>
                    onChange((prev) => ({
                      ...prev,
                      suprafataTerenMin: e.target.value,
                      suprafataTerenMax: "",
                    }))
                  }
                  placeholder="ex. 1000"
                  className={inputClass}
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  Front stradal (m)
                </label>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={state.frontStradal}
                  onChange={(e) => setField("frontStradal", e.target.value)}
                  placeholder="ex. 18"
                  className={inputClass}
                />
              </div>
            </div>
          ) : (
            <>
              {/* Row 1: Suprafață minimă / Suprafață maximă */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                    Suprafață minimă (mp)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={state.suprafataTerenMin}
                    onChange={(e) => setField("suprafataTerenMin", e.target.value)}
                    placeholder="ex. 500"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                    Suprafață maximă (mp)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={state.suprafataTerenMax}
                    onChange={(e) => setField("suprafataTerenMax", e.target.value)}
                    placeholder="ex. 2000"
                    className={inputClass}
                  />
                </div>
              </div>

              {/* Row 2: Front stradal (m) */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  Front stradal (m)
                </label>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={state.frontStradal}
                  onChange={(e) => setField("frontStradal", e.target.value)}
                  placeholder="ex. 18"
                  className={inputClass}
                />
              </div>
            </>
          )
        ) : isPropertyMode ? (
          <>
            {/* Property Non-Teren Row 1: Suprafață utilă / Suprafață construită */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  Suprafață utilă (mp)
                </label>
                <input
                  type="number"
                  min={0}
                  value={state.suprafataUtilaMin || state.suprafataUtilaMax}
                  onChange={(e) =>
                    onChange((prev) => ({
                      ...prev,
                      suprafataUtilaMin: e.target.value,
                      suprafataUtilaMax: "",
                    }))
                  }
                  placeholder="ex. 65"
                  className={inputClass}
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  Suprafață construită (mp)
                </label>
                <input
                  type="number"
                  min={0}
                  value={state.suprafataConstruitaMin || state.suprafataConstruitaMax}
                  onChange={(e) =>
                    onChange((prev) => ({
                      ...prev,
                      suprafataConstruitaMin: e.target.value,
                      suprafataConstruitaMax: "",
                    }))
                  }
                  placeholder="ex. 78"
                  className={inputClass}
                />
              </div>
            </div>

            {/* Property Non-Teren Row 2: Casa/Vila -> Suprafață curte / Anul construcției; Others -> Anul construcției */}
            {isCasaVila ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                    Suprafață curte (mp)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={state.suprafataCurteMin || state.suprafataCurteMax}
                    onChange={(e) =>
                      onChange((prev) => ({
                        ...prev,
                        suprafataCurteMin: e.target.value,
                        suprafataCurteMax: "",
                      }))
                    }
                    placeholder="ex. 250"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                    Anul construcției
                  </label>
                  <input
                    type="number"
                    min={1900}
                    max={2035}
                    value={state.anConstructieMin || state.anConstructieMax}
                    onChange={(e) =>
                      onChange((prev) => ({
                        ...prev,
                        anConstructieMin: e.target.value,
                        anConstructieMax: "",
                      }))
                    }
                    placeholder="ex. 2018"
                    className={inputClass}
                  />
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  Anul construcției
                </label>
                <input
                  type="number"
                  min={1900}
                  max={2035}
                  value={state.anConstructieMin || state.anConstructieMax}
                  onChange={(e) =>
                    onChange((prev) => ({
                      ...prev,
                      anConstructieMin: e.target.value,
                      anConstructieMax: "",
                    }))
                  }
                  placeholder="ex. 2018"
                  className={inputClass}
                />
              </div>
            )}
          </>
        ) : (
          <>
            {/* Row 1: Anul construcției minim / Anul construcției maxim */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  Anul construcției minim
                </label>
                <input
                  type="number"
                  min={1900}
                  max={2035}
                  value={state.anConstructieMin}
                  onChange={(e) => setField("anConstructieMin", e.target.value)}
                  placeholder="ex. 2005"
                  className={inputClass}
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  Anul construcției maxim
                </label>
                <input
                  type="number"
                  min={1900}
                  max={2035}
                  value={state.anConstructieMax}
                  onChange={(e) => setField("anConstructieMax", e.target.value)}
                  placeholder="ex. 2025"
                  className={inputClass}
                />
              </div>
            </div>

            {/* Row 2: Suprafață utilă minimă / Suprafață utilă maximă */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  Suprafață utilă minimă (mp)
                </label>
                <input
                  type="number"
                  min={0}
                  value={state.suprafataUtilaMin}
                  onChange={(e) => setField("suprafataUtilaMin", e.target.value)}
                  placeholder="ex. 50"
                  className={inputClass}
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  Suprafață utilă maximă (mp)
                </label>
                <input
                  type="number"
                  min={0}
                  value={state.suprafataUtilaMax}
                  onChange={(e) => setField("suprafataUtilaMax", e.target.value)}
                  placeholder="ex. 90"
                  className={inputClass}
                />
              </div>
            </div>

            {/* Row 3: Suprafață construită minimă / Suprafață construită maximă */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  Suprafață construită minimă (mp)
                </label>
                <input
                  type="number"
                  min={0}
                  value={state.suprafataConstruitaMin}
                  onChange={(e) => setField("suprafataConstruitaMin", e.target.value)}
                  placeholder="ex. 60"
                  className={inputClass}
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  Suprafață construită maximă (mp)
                </label>
                <input
                  type="number"
                  min={0}
                  value={state.suprafataConstruitaMax}
                  onChange={(e) => setField("suprafataConstruitaMax", e.target.value)}
                  placeholder="ex. 110"
                  className={inputClass}
                />
              </div>
            </div>

            {/* Row 4 (Casa/Vila only): Suprafață curte minimă / Suprafață curte maximă */}
            {isCasaVila && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                    Suprafață curte minimă (mp)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={state.suprafataCurteMin}
                    onChange={(e) => setField("suprafataCurteMin", e.target.value)}
                    placeholder="ex. 150"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                    Suprafață curte maximă (mp)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={state.suprafataCurteMax}
                    onChange={(e) => setField("suprafataCurteMax", e.target.value)}
                    placeholder="ex. 500"
                    className={inputClass}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </AccordionSection>

      {/* 3RD ACCORDION: Alte Informații */}
      <AccordionSection
        title="Alte Informații"
        isOpen={openAccordion === "alte"}
        onToggle={() => selectAccordion("alte")}
      >
        {isTeren ? (
          <TagMultiSelect
            label="Utilități"
            options={UTILITATI_TEREN_OPTIONS}
            selected={state.utilitati}
            onChange={(next) => setField("utilitati", next)}
            placeholder="Selectează utilități..."
            disabled={disabled}
          />
        ) : (
          <>
            {/* Row 1: Stare interior */}
            <div>
              <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                Stare interior
              </label>
              <select
                value={state.stareInterior}
                onChange={(e) => setField("stareInterior", e.target.value)}
                className={selectClass}
              >
                <option value="">Selectează...</option>
                {STARE_INTERIOR_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>

            {/* Row 2: Sistem încălzire / Metodă încălzire */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  Sistem încălzire
                </label>
                <select
                  value={state.sistemIncalzire}
                  onChange={(e) => setField("sistemIncalzire", e.target.value)}
                  className={selectClass}
                >
                  <option value="">Selectează...</option>
                  {SISTEM_INCALZIRE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  Metodă încălzire
                </label>
                <select
                  value={state.metodaIncalzire}
                  onChange={(e) => setField("metodaIncalzire", e.target.value)}
                  className={selectClass}
                >
                  <option value="">Selectează...</option>
                  {METODA_INCALZIRE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Row 3: Lift (Da / Nu) */}
            <div>
              <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                Lift
              </label>
              <select
                value={state.lift}
                onChange={(e) => setField("lift", e.target.value)}
                className={selectClass}
              >
                <option value="">Selectează...</option>
                {LIFT_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>

            {/* Row 4: Grădină / Balcoane, terase, logii (1-5 multiselect) */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  Grădină
                </label>
                <select
                  value={state.gradina}
                  onChange={(e) => setField("gradina", e.target.value)}
                  className={selectClass}
                >
                  <option value="">Selectează...</option>
                  {GRADINA_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>

              <MultiSelectDropdown
                label="Balcoane, terase, logii"
                options={BALCOANE_TERASE_LOGII_OPTIONS}
                selected={state.balcoaneTeraseLogii}
                onChange={(next) => setField("balcoaneTeraseLogii", next)}
                isOpen={openMultiDropdown === "balcoane"}
                onToggleOpen={() =>
                  setOpenMultiDropdown((prev) => (prev === "balcoane" ? null : "balcoane"))
                }
                onClose={() =>
                  setOpenMultiDropdown((prev) => (prev === "balcoane" ? null : prev))
                }
                disabled={disabled}
              />
            </div>

            {/* Row 5: Utilități (tags) */}
            <TagMultiSelect
              label="Utilități"
              options={UTILITATI_STANDARD_OPTIONS}
              selected={state.utilitati}
              onChange={(next) => setField("utilitati", next)}
              placeholder="Selectează utilități..."
              disabled={disabled}
            />

            {/* Row 6: Servicii imobil (tags) */}
            <TagMultiSelect
              label="Servicii imobil"
              options={SERVICII_IMOBIL_OPTIONS}
              selected={state.serviciiImobil}
              onChange={(next) => setField("serviciiImobil", next)}
              placeholder="Selectează servicii..."
              disabled={disabled}
            />
          </>
        )}
      </AccordionSection>
    </div>
  );
};

function formatRange(minVal: string, maxVal: string, suffix = ""): string {
  const a = minVal.trim();
  const b = maxVal.trim();
  if (a && b) return `${a} - ${b}${suffix}`;
  if (a) return `min. ${a}${suffix}`;
  if (b) return `max. ${b}${suffix}`;
  return "";
}

function formatSingleOrRange(
  minVal: string,
  maxVal: string,
  isSingle: boolean,
  suffix = ""
): string {
  if (isSingle) {
    const val = minVal.trim() || maxVal.trim();
    return val ? `${val}${suffix}` : "";
  }
  return formatRange(minVal, maxVal, suffix);
}

function mapComercialSubcategoryToCanonical(sub: string): string {
  if (sub === "Birouri") return "Spatiu Birou";
  if (sub === "Industrial") return "Spatiu Industrial";
  if (sub === "Hotel/Pensiune") return "Hotel/Pensiune";
  if (sub === "Proprietăți speciale") return "Proprietati Speciale";
  if (sub === "Teren investiții") return "Teren";
  return "Spatiu Comercial";
}

export function buildLeadPayloadFromCriteria(params: {
  state: PropertyCriteriaFormState;
  role: "Chirias" | "Cumparator";
  mode: "lead" | "cerere" | "property";
  status: LeadStatus;
}): Omit<Lead, "id" | "createdAt" | "updatedAt" | "lastMovedAt"> {
  const { state, role, mode, status } = params;
  const isProperty = mode === "property";
  const transactionType: "Vânzare" | "Închiriere" =
    role === "Chirias" ? "Închiriere" : "Vânzare";

  const isTeren = state.buildingType === "Teren";
  const isCasaVila = state.buildingType === "Casa/Vila";
  const isComercial = state.buildingType === "Spatiu Comercial";

  const canonicalCategory = isComercial
    ? mapComercialSubcategoryToCanonical(state.comercialCategorie)
    : state.buildingType;

  const rawMinB = state.minBudget.trim();
  const rawMaxB = state.maxBudget.trim();
  const minB = isProperty ? "" : rawMinB;
  const maxB = isProperty ? rawMaxB || rawMinB : rawMaxB;
  const displayBudget = isProperty
    ? maxB
      ? `${maxB} €`
      : "La cerere"
    : minB && maxB
      ? `${minB} - ${maxB} €`
      : maxB
        ? `${maxB} €`
        : minB
          ? `min. ${minB} €`
          : "La cerere";

  const numericPrice = parseFloat((maxB || minB).replace(/[^\d.]/g, ""));
  const zoneStr = state.zoneList.join(", ") || "București";
  const roomsStr = !isTeren ? state.selectedRooms.join(", ") : "";
  const bathsStr = !isTeren ? state.selectedBaths.join(", ") : "";

  const casaFloorsParts: string[] = [];
  if (isCasaVila) {
    if (state.casaSubsol) casaFloorsParts.push("Subsol");
    if (state.casaDemisol) casaFloorsParts.push("Demisol");
    casaFloorsParts.push("Parter");
    if (state.casaEtajePesteParter) casaFloorsParts.push(`+${state.casaEtajePesteParter}E`);
  }
  const floorStr = isTeren
    ? ""
    : isCasaVila
      ? casaFloorsParts.join(", ")
      : state.selectedFloors.join(", ");

  const parcareSummary = !isTeren
    ? [state.tipParcare, state.numarLocuriParcare].filter(Boolean).join(" • ")
    : "";

  const roleLabel = role === "Chirias" ? "Chiriaș" : "Cumpărător";
  const categoryDisplay = isTeren
    ? `Teren ${state.terenCategorie}`.trim()
    : isComercial
      ? state.comercialCategorie || "Spațiu Comercial"
      : state.buildingType;

  const customPropertyTitle = isProperty ? state.propertyTitle.trim() : "";
  const title =
    mode === "cerere"
      ? `Cerere: ${categoryDisplay} ${transactionType === "Vânzare" ? "Cumpărare" : "Închiriere"} - ${zoneStr}`
      : mode === "property"
        ? customPropertyTitle ||
          `${categoryDisplay}${roomsStr ? ` ${roomsStr}` : ""} de ${transactionType === "Vânzare" ? "vânzare" : "închiriat"} - ${zoneStr}`
        : `${roleLabel}: ${categoryDisplay} ${transactionType === "Vânzare" ? "Cumpărare" : "Închiriere"} - ${zoneStr}`;

  const cetatenieStr = state.cetatenie.join(", ");
  const animalStr = state.animal.join(", ");
  const profilStr = state.profil.join(", ");

  const noteParts: string[] = [];
  if (state.requirements.trim()) noteParts.push(state.requirements.trim());
  if (role === "Chirias") {
    if (cetatenieStr) noteParts.push(`Cetățenie: ${cetatenieStr}`);
    if (animalStr) noteParts.push(`Animale: ${animalStr}`);
    if (profilStr) noteParts.push(`Profil: ${profilStr}`);
    if (state.copii) noteParts.push(`Copii: ${state.copii}`);
  }
  const isSaleAcquisitionApplicable = isProperty
    ? role === "Cumparator"
    : role === "Cumparator" && !isComercial;
  const effectiveTipAchizitieAcceptat =
    mode === "property" && isSaleAcquisitionApplicable
      ? [...state.tipAchizitieAcceptat]
      : [];
  const effectiveModalitateAchizitie = !isSaleAcquisitionApplicable
    ? ""
    : mode === "property"
      ? effectiveTipAchizitieAcceptat.join(", ")
      : state.modalitateAchizitie;

  const tvaValue = isProperty ? state.tva.trim() : "";
  const comisionValue = isProperty ? state.comision.trim() : "";
  const contractDurataValue =
    isProperty && role === "Chirias" ? state.contractDurata.trim() : "";
  const avansValue = isProperty && role === "Chirias" ? state.avans.trim() : "";
  const garantieValue = isProperty && role === "Chirias" ? state.garantie.trim() : "";
  const situatieJuridicaValue =
    isProperty && role === "Cumparator" ? state.situatieJuridica.trim() : "";
  const disponibilitateValue =
    isProperty && role === "Cumparator" ? state.disponibilitate.trim() : "";

  if (mode === "property" && effectiveTipAchizitieAcceptat.length > 0) {
    noteParts.push(`Tip achiziție acceptat: ${effectiveTipAchizitieAcceptat.join(", ")}`);
  } else if (mode !== "property" && effectiveModalitateAchizitie) {
    noteParts.push(`Modalitate achiziție: ${effectiveModalitateAchizitie}`);
  }
  if (isTeren) {
    if (state.terenCategorie) noteParts.push(`Categorie teren: ${state.terenCategorie}`);
    if (state.terenClasificare) noteParts.push(`Clasificare: ${state.terenClasificare}`);
    const supTeren = formatSingleOrRange(
      state.suprafataTerenMin,
      state.suprafataTerenMax,
      isProperty,
      " mp"
    );
    if (supTeren) noteParts.push(`Suprafață teren: ${supTeren}`);
    if (state.frontStradal.trim()) noteParts.push(`Front stradal: ${state.frontStradal.trim()} m`);
    if (state.utilitati.length > 0) noteParts.push(`Utilități: ${state.utilitati.join(", ")}`);
  } else {
    if (state.compartimentare) noteParts.push(`Compartimentare: ${state.compartimentare}`);
    if (roomsStr) noteParts.push(`Număr camere: ${roomsStr}`);
    if (bathsStr) noteParts.push(`Număr băi: ${bathsStr}`);
    if (floorStr) noteParts.push(`Etaje: ${floorStr}`);
    if (!isCasaVila && state.totalFloors.trim()) {
      noteParts.push(
        `${isComercial ? "Etaje total clădire" : "Etaje total bloc"}: ${state.totalFloors.trim()}`
      );
    }
    if (state.mobilare) noteParts.push(`Mobilare: ${state.mobilare}`);
    if (state.utilare) noteParts.push(`Utilare: ${state.utilare}`);
    if (parcareSummary) noteParts.push(`Parcare: ${parcareSummary}`);

    const anRange = formatSingleOrRange(state.anConstructieMin, state.anConstructieMax, isProperty);
    if (anRange) noteParts.push(`An construcție: ${anRange}`);
    const utilaRange = formatSingleOrRange(
      state.suprafataUtilaMin,
      state.suprafataUtilaMax,
      isProperty,
      " mp"
    );
    if (utilaRange) noteParts.push(`Suprafață utilă: ${utilaRange}`);
    const construitaRange = formatSingleOrRange(
      state.suprafataConstruitaMin,
      state.suprafataConstruitaMax,
      isProperty,
      " mp"
    );
    if (construitaRange) noteParts.push(`Suprafață construită: ${construitaRange}`);
    if (isCasaVila) {
      const curteRange = formatSingleOrRange(
        state.suprafataCurteMin,
        state.suprafataCurteMax,
        isProperty,
        " mp"
      );
      if (curteRange) noteParts.push(`Suprafață curte: ${curteRange}`);
    }
    if (state.stareInterior) noteParts.push(`Stare interior: ${state.stareInterior}`);
    if (state.sistemIncalzire) noteParts.push(`Sistem încălzire: ${state.sistemIncalzire}`);
    if (state.metodaIncalzire) noteParts.push(`Metodă încălzire: ${state.metodaIncalzire}`);
    if (state.lift) noteParts.push(`Lift: ${state.lift}`);
    if (state.gradina) noteParts.push(`Grădină: ${state.gradina}`);
    if (state.balcoaneTeraseLogii.length > 0) {
      noteParts.push(`Balcoane/terase/logii: ${state.balcoaneTeraseLogii.join(", ")}`);
    }
    if (state.utilitati.length > 0) noteParts.push(`Utilități: ${state.utilitati.join(", ")}`);
    if (state.serviciiImobil.length > 0) {
      noteParts.push(`Servicii imobil: ${state.serviciiImobil.join(", ")}`);
    }
  }

  const notesPrefix =
    mode === "cerere"
      ? "Cerințe cerere: "
      : mode === "property"
        ? "Detalii proprietate: "
        : "Cerințe lead: ";

  const parsedUsefulArea = parseFloat(
    (isTeren
      ? state.suprafataTerenMin || state.suprafataTerenMax
      : state.suprafataUtilaMin || state.suprafataUtilaMax
    ).trim()
  );

  const anConstructieValue = formatSingleOrRange(
    state.anConstructieMin,
    state.anConstructieMax,
    isProperty
  );

  const normAnMin = isProperty
    ? state.anConstructieMin.trim() || state.anConstructieMax.trim()
    : state.anConstructieMin.trim();
  const normAnMax = isProperty ? "" : state.anConstructieMax.trim();
  const normUtilaMin = isProperty
    ? state.suprafataUtilaMin.trim() || state.suprafataUtilaMax.trim()
    : state.suprafataUtilaMin.trim();
  const normUtilaMax = isProperty ? "" : state.suprafataUtilaMax.trim();
  const normConstrMin = isProperty
    ? state.suprafataConstruitaMin.trim() || state.suprafataConstruitaMax.trim()
    : state.suprafataConstruitaMin.trim();
  const normConstrMax = isProperty ? "" : state.suprafataConstruitaMax.trim();
  const normCurteMin = isProperty
    ? state.suprafataCurteMin.trim() || state.suprafataCurteMax.trim()
    : state.suprafataCurteMin.trim();
  const normCurteMax = isProperty ? "" : state.suprafataCurteMax.trim();
  const normTerenMin = isProperty
    ? state.suprafataTerenMin.trim() || state.suprafataTerenMax.trim()
    : state.suprafataTerenMin.trim();
  const normTerenMax = isProperty ? "" : state.suprafataTerenMax.trim();

  const criteriiFormular = {
    buildingType: state.buildingType,
    minBudget: minB,
    maxBudget: maxB,
    tva: tvaValue,
    comision: comisionValue,
    contractDurata: contractDurataValue,
    avans: avansValue,
    garantie: garantieValue,
    situatieJuridica: situatieJuridicaValue,
    disponibilitate: disponibilitateValue,
    modalitateAchizitie: effectiveModalitateAchizitie,
    tipAchizitieAcceptat: effectiveTipAchizitieAcceptat,
    cetatenie: cetatenieStr,
    cetatenieList: [...state.cetatenie],
    animal: animalStr,
    animaleList: [...state.animal],
    profil: [...state.profil],
    copii: state.copii,
    terenCategorie: state.terenCategorie,
    terenClasificare: state.terenClasificare,
    comercialCategorie: state.comercialCategorie,
    compartimentare: state.compartimentare,
    selectedRooms: [...state.selectedRooms],
    selectedBaths: [...state.selectedBaths],
    selectedFloors: [...state.selectedFloors],
    totalFloors: state.totalFloors.trim(),
    casaSubsol: Boolean(state.casaSubsol),
    casaDemisol: Boolean(state.casaDemisol),
    casaParter: true,
    casaEtajePesteParter: state.casaEtajePesteParter,
    mobilare: state.mobilare,
    utilare: state.utilare,
    tipParcare: state.tipParcare,
    numarLocuriParcare: state.numarLocuriParcare,
    zoneList: [...state.zoneList],
    propertyTitle: state.propertyTitle.trim(),
    requirements: state.requirements.trim(),
    anConstructieMin: normAnMin,
    anConstructieMax: normAnMax,
    suprafataUtilaMin: normUtilaMin,
    suprafataUtilaMax: normUtilaMax,
    suprafataConstruitaMin: normConstrMin,
    suprafataConstruitaMax: normConstrMax,
    suprafataCurteMin: normCurteMin,
    suprafataCurteMax: normCurteMax,
    suprafataTerenMin: normTerenMin,
    suprafataTerenMax: normTerenMax,
    frontStradal: state.frontStradal.trim(),
    stareInterior: state.stareInterior,
    sistemIncalzire: state.sistemIncalzire,
    metodaIncalzire: state.metodaIncalzire,
    lift: state.lift,
    gradina: state.gradina,
    balcoaneTeraseLogii: [...state.balcoaneTeraseLogii],
    utilitati: [...state.utilitati],
    serviciiImobil: [...state.serviciiImobil],
  };

  return {
    url: "",
    title,
    zone: zoneStr,
    zoneList: state.zoneList.length > 0 ? [...state.zoneList] : ["București"],
    price: displayBudget,
    ...(Number.isFinite(numericPrice) && numericPrice > 0 ? { priceNumeric: numericPrice } : {}),
    ownerName: state.clientName.trim(),
    ownerPhone: state.clientPhone.trim(),
    transactionType,
    categoria: canonicalCategory,
    buildingType: state.buildingType,
    status,
    leadType: mode === "property" ? "Proprietar" : role,
    ...(criteriiFormular.minBudget ? { minBudget: criteriiFormular.minBudget } : {}),
    ...(criteriiFormular.maxBudget ? { maxBudget: criteriiFormular.maxBudget } : {}),
    ...(effectiveModalitateAchizitie ? { modalitateAchizitie: effectiveModalitateAchizitie } : {}),
    ...(effectiveTipAchizitieAcceptat.length > 0
      ? { tipAchizitieAcceptat: effectiveTipAchizitieAcceptat }
      : {}),
    ...(cetatenieStr ? { cetatenie: cetatenieStr } : {}),
    ...(state.cetatenie.length > 0 ? { cetatenieList: [...state.cetatenie] } : {}),
    ...(animalStr ? { animal: animalStr } : {}),
    ...(state.animal.length > 0 ? { animaleList: [...state.animal] } : {}),
    ...(state.profil.length > 0 ? { profil: [...state.profil] } : {}),
    ...(state.copii ? { copii: state.copii } : {}),
    ...(isTeren && state.terenCategorie ? { terenCategorie: state.terenCategorie } : {}),
    ...(isTeren && state.terenClasificare ? { terenClasificare: state.terenClasificare } : {}),
    ...(isComercial && state.comercialCategorie
      ? { comercialCategorie: state.comercialCategorie }
      : {}),
    ...(roomsStr ? { rooms: roomsStr } : {}),
    ...(bathsStr ? { baths: bathsStr } : {}),
    ...(!isTeren && state.selectedRooms.length > 0 ? { selectedRooms: [...state.selectedRooms] } : {}),
    ...(!isTeren && state.selectedBaths.length > 0 ? { selectedBaths: [...state.selectedBaths] } : {}),
    ...(floorStr ? { floor: floorStr } : {}),
    ...(!isTeren && !isCasaVila && state.selectedFloors.length > 0
      ? { selectedFloors: [...state.selectedFloors] }
      : {}),
    ...(!isTeren && !isCasaVila && criteriiFormular.totalFloors
      ? { totalFloors: criteriiFormular.totalFloors }
      : {}),
    ...(isCasaVila
      ? {
          casaSubsol: Boolean(state.casaSubsol),
          casaDemisol: Boolean(state.casaDemisol),
          casaParter: true,
          ...(state.casaEtajePesteParter
            ? { casaEtajePesteParter: state.casaEtajePesteParter }
            : {}),
        }
      : {}),
    ...(state.compartimentare && !isTeren ? { compartimentare: state.compartimentare } : {}),
    ...(Number.isFinite(parsedUsefulArea) && parsedUsefulArea > 0
      ? { usefulArea: parsedUsefulArea }
      : {}),
    ...(state.mobilare && !isTeren ? { mobilare: state.mobilare } : {}),
    ...(state.utilare && !isTeren ? { utilare: state.utilare } : {}),
    ...(parcareSummary ? { parcare: parcareSummary } : {}),
    ...(state.tipParcare && !isTeren ? { tipParcare: state.tipParcare } : {}),
    ...(state.numarLocuriParcare && !isTeren ? { numarLocuriParcare: state.numarLocuriParcare } : {}),
    ...(state.sistemIncalzire && !isTeren ? { sursaIncalzire: state.sistemIncalzire } : {}),
    ...(state.metodaIncalzire && !isTeren ? { modIncalzire: state.metodaIncalzire } : {}),
    ...(criteriiFormular.requirements ? { requirements: criteriiFormular.requirements } : {}),
    ...(!isTeren && criteriiFormular.anConstructieMin
      ? { anConstructieMin: criteriiFormular.anConstructieMin }
      : {}),
    ...(!isTeren && criteriiFormular.anConstructieMax
      ? { anConstructieMax: criteriiFormular.anConstructieMax }
      : {}),
    ...(!isTeren && anConstructieValue ? { constructionYear: anConstructieValue } : {}),
    ...(!isTeren && criteriiFormular.suprafataUtilaMin
      ? { suprafataUtilaMin: criteriiFormular.suprafataUtilaMin }
      : {}),
    ...(!isTeren && criteriiFormular.suprafataUtilaMax
      ? { suprafataUtilaMax: criteriiFormular.suprafataUtilaMax }
      : {}),
    ...(!isTeren && criteriiFormular.suprafataConstruitaMin
      ? { suprafataConstruitaMin: criteriiFormular.suprafataConstruitaMin }
      : {}),
    ...(!isTeren && criteriiFormular.suprafataConstruitaMax
      ? { suprafataConstruitaMax: criteriiFormular.suprafataConstruitaMax }
      : {}),
    ...(isCasaVila && criteriiFormular.suprafataCurteMin
      ? { suprafataCurteMin: criteriiFormular.suprafataCurteMin }
      : {}),
    ...(isCasaVila && criteriiFormular.suprafataCurteMax
      ? { suprafataCurteMax: criteriiFormular.suprafataCurteMax }
      : {}),
    ...(isTeren && criteriiFormular.suprafataTerenMin
      ? { suprafataTerenMin: criteriiFormular.suprafataTerenMin }
      : {}),
    ...(isTeren && criteriiFormular.suprafataTerenMax
      ? { suprafataTerenMax: criteriiFormular.suprafataTerenMax }
      : {}),
    ...(isTeren && criteriiFormular.frontStradal ? { frontStradal: criteriiFormular.frontStradal } : {}),
    ...(!isTeren && state.stareInterior ? { stareInterior: state.stareInterior } : {}),
    ...(!isTeren && state.lift ? { lift: state.lift } : {}),
    ...(!isTeren && state.gradina ? { gradina: state.gradina } : {}),
    ...(!isTeren && state.balcoaneTeraseLogii.length > 0
      ? { balcoaneTeraseLogii: [...state.balcoaneTeraseLogii] }
      : {}),
    ...(state.utilitati.length > 0 ? { utilitati: [...state.utilitati] } : {}),
    ...(!isTeren && state.serviciiImobil.length > 0
      ? { serviciiImobil: [...state.serviciiImobil] }
      : {}),
    criteriiFormular,
    notes: noteParts.length > 0 ? `${notesPrefix}${noteParts.join(" | ")}` : "",
    extractedData: {
      crmData: {
        detaliiGenerale: {
          tranzactie: transactionType,
          categoria: canonicalCategory,
          localizare: {
            zona: state.zoneList.length > 0 ? [...state.zoneList] : ["București"],
          },
        },
        descriere: {
          titlu: title,
          continut: noteParts.join(" | "),
        },
        caracteristici: {
          detalii: {
            ...(roomsStr ? { camere: roomsStr } : {}),
            ...(bathsStr ? { bai: bathsStr } : {}),
            ...(floorStr ? { etaj: floorStr } : {}),
            ...(!isTeren && !isCasaVila && criteriiFormular.totalFloors
              ? { totalEtaje: criteriiFormular.totalFloors }
              : {}),
            ...(state.compartimentare && !isTeren
              ? { compartimentare: state.compartimentare }
              : {}),
            ...(!isTeren && anConstructieValue ? { anConstructie: anConstructieValue } : {}),
            ...(state.balcoaneTeraseLogii.length > 0 && !isTeren
              ? { balcoane: state.balcoaneTeraseLogii.join(", ") }
              : {}),
          },
          suprafete: {
            ...(isTeren
              ? {
                  teren: formatSingleOrRange(
                    state.suprafataTerenMin,
                    state.suprafataTerenMax,
                    isProperty
                  ),
                  frontStradal: criteriiFormular.frontStradal,
                }
              : {
                  utila: formatSingleOrRange(
                    state.suprafataUtilaMin,
                    state.suprafataUtilaMax,
                    isProperty
                  ),
                  construita: formatSingleOrRange(
                    state.suprafataConstruitaMin,
                    state.suprafataConstruitaMax,
                    isProperty
                  ),
                  ...(isCasaVila
                    ? {
                        curte: formatSingleOrRange(
                          state.suprafataCurteMin,
                          state.suprafataCurteMax,
                          isProperty
                        ),
                      }
                    : {}),
                }),
          },
          alteDetalii: {
            ...(!isTeren && anConstructieValue ? { anConstructie: anConstructieValue } : {}),
            ...(state.stareInterior && !isTeren ? { stareInterior: state.stareInterior } : {}),
            ...(state.lift && !isTeren ? { lift: state.lift } : {}),
            ...(state.gradina && !isTeren ? { gradina: state.gradina } : {}),
            ...(isTeren
              ? {
                  tipTeren: state.terenCategorie,
                  clasificare: state.terenClasificare,
                }
              : {}),
            ...(isComercial ? { tipSpatiuComercial: state.comercialCategorie } : {}),
          },
        },
        utilitati: {
          generale: [...state.utilitati],
          sistemIncalzire: state.sistemIncalzire && !isTeren ? [state.sistemIncalzire] : [],
          metodaIncalzire: state.metodaIncalzire && !isTeren ? state.metodaIncalzire : "",
        },
        dotari: {
          mobilat: state.mobilare && !isTeren ? [state.mobilare] : [],
          utilare: state.utilare && !isTeren ? state.utilare : "",
          parcare: parcareSummary,
          tipParcare: !isTeren ? state.tipParcare : "",
          numarLocuriParcare: !isTeren ? state.numarLocuriParcare : "",
          serviciiImobil: !isTeren ? [...state.serviciiImobil] : [],
        },
        pret: {
          detalii: {
            pret: displayBudget,
            ...(criteriiFormular.minBudget ? { bugetMin: criteriiFormular.minBudget } : {}),
            ...(criteriiFormular.maxBudget ? { bugetMax: criteriiFormular.maxBudget } : {}),
            ...(tvaValue ? { tva: tvaValue } : {}),
            ...(comisionValue ? { comision: comisionValue } : {}),
            ...(contractDurataValue ? { contract: contractDurataValue } : {}),
            ...(avansValue ? { avans: avansValue } : {}),
            ...(garantieValue ? { garantie: garantieValue } : {}),
            ...(situatieJuridicaValue ? { situatieJuridica: situatieJuridicaValue } : {}),
            ...(disponibilitateValue ? { disponibilitate: disponibilitateValue } : {}),
            ...(effectiveModalitateAchizitie
              ? { modalitateAchizitie: effectiveModalitateAchizitie }
              : {}),
            ...(effectiveTipAchizitieAcceptat.length > 0
              ? { tipAchizitieAcceptat: effectiveTipAchizitieAcceptat }
              : {}),
          },
        },
        criteriiFormular: { ...criteriiFormular },
      },
      ...(isProperty
        ? {
            presentationSections: {
              tranzactie: {
                "Preț": displayBudget,
                ...(tvaValue ? { "TVA": tvaValue } : {}),
                ...(comisionValue ? { "Comision": comisionValue } : {}),
              },
              acte:
                role === "Chirias"
                  ? {
                      ...(contractDurataValue
                        ? {
                            "Contract": contractDurataValue,
                            "Condiții contractuale": contractDurataValue,
                          }
                        : {}),
                      ...(avansValue ? { "Avans": avansValue } : {}),
                      ...(garantieValue ? { "Garanție": garantieValue } : {}),
                    }
                  : {
                      ...(situatieJuridicaValue
                        ? { "Situație juridică": situatieJuridicaValue }
                        : {}),
                      ...(disponibilitateValue
                        ? { "Disponibilitate": disponibilitateValue }
                        : {}),
                      ...(effectiveTipAchizitieAcceptat.length > 0
                        ? { "Finanțare": effectiveTipAchizitieAcceptat.join(", ") }
                        : {}),
                    },
            },
          }
        : {}),
    } as any,
  };
}
