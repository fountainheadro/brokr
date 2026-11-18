import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Search,
  Mail,
  Lock,
  Plus,
  Trash2,
  Calendar,
  Building2,
  CheckCircle2,
  AlertTriangle,
  Info,
  Clock,
  Sparkles,
  LayoutDashboard,
  Users,
  Settings,
  Layers,
  Palette,
  Type,
  Maximize2,
  Eye,
} from "lucide-react";
import { designTokens, resolveAgencyColors } from "../../design/tokens";

// Atoms
import {
  AtmButton,
  AtmBadge,
  AtmInputText,
  AtmTextarea,
  AtmLabel,
  AtmCheckbox,
  AtmRadio,
  AtmSwitch,
  AtmSelect,
  AtmAvatar,
  AtmIconWrapper,
  AtmTooltip,
  AtmDivider,
  AtmSpinner,
  AtmProgressBar,
  AtmStatusIndicator,
  AtmSkeleton,
  AtmFormError,
} from "../ui/atoms/common";
import { AtmPlatformBadge } from "../ui/atoms/platform/atm_platform-badge";
import { AtmAgencyRoleBadge } from "../ui/atoms/agency/atm_agency-role-badge";

// Molecules
import {
  MolFormField,
  MolSearchField,
  MolDropdownMenu,
  MolDatePicker,
  MolPagination,
  MolBreadcrumbs,
  MolUserBlock,
  MolEmptyState,
  MolErrorState,
  MolConfirmationDialog,
  MolFileUpload,
} from "../ui/molecules/common";

// Organisms
import {
  OrgMetricCard,
  OrgDataTable,
  OrgModalBase,
  OrgDrawerBase,
  OrgTimeline,
} from "../ui/organisms/common";
import { OrgTenantStatusCard } from "../ui/organisms/platform/org_tenant-status-card";
import { OrgLeadQuickCard } from "../ui/organisms/agency/org_lead-quick-card";

export const PgDesignSystemShowcase: React.FC = () => {
  const [activeTab, setActiveTab] = useState<string>("tokens");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  // Form states for demonstration
  const [inputText, setInputText] = useState("Exemplu text");
  const [inputSearch, setInputSearch] = useState("");
  const [inputDate, setInputDate] = useState("2026-11-15");
  const [switchVal, setSwitchVal] = useState(true);
  const [checkboxVal, setCheckboxVal] = useState(true);
  const [radioVal, setRadioVal] = useState("opt1");
  const [selectVal, setSelectVal] = useState("apartament");
  const [currentPage, setCurrentPage] = useState(1);

  // Sample Table Data for demonstration
  const sampleTableData = [
    { id: "1", agency: "Zenith Real Estate", subdomain: "zenith", plan: "Enterprise", status: "active", agents: 14 },
    { id: "2", agency: "Metropolitan Imobiliare", subdomain: "metro", plan: "Professional", status: "active", agents: 8 },
    { id: "3", agency: "Astra Prime Properties", subdomain: "astra", plan: "Starter", status: "trial", agents: 3 },
    { id: "4", agency: "Elite Housing Concept", subdomain: "elite", plan: "Professional", status: "suspended", agents: 0 },
  ];

  const sections = [
    { id: "tokens", label: "1. Design Tokens & Culori", icon: <Palette size={14} /> },
    { id: "typography", label: "2. Tipografie & Spacing", icon: <Type size={14} /> },
    { id: "buttons", label: "3. Butoane (AtmButton)", icon: <Plus size={14} /> },
    { id: "inputs", label: "4. Inputuri & Formulare", icon: <Search size={14} /> },
    { id: "selection", label: "5. Controale Selecție", icon: <CheckCircle2 size={14} /> },
    { id: "badges", label: "6. Badge-uri & Statusuri", icon: <Sparkles size={14} /> },
    { id: "molecules", label: "7. Molecule Reutilizabile", icon: <Layers size={14} /> },
    { id: "organisms", label: "8. Organisme & Date", icon: <LayoutDashboard size={14} /> },
    { id: "overlays", label: "9. Modale & Sertare", icon: <Maximize2 size={14} /> },
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans text-gray-800">
      {/* Top Navbar */}
      <header className="h-12 bg-white border-b border-gray-200 px-6 flex items-center justify-between sticky top-0 z-[1200] shadow-2xs select-none">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-xs font-semibold text-gray-600 hover:text-[#051D35] px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 transition-colors"
          >
            <ArrowLeft size={13} />
            <span>Înapoi la CRM</span>
          </Link>
          <div className="h-4 w-[1px] bg-gray-200" />
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#BE9662] animate-pulse" />
            <span className="font-title text-xs font-semibold text-gray-900 tracking-tight uppercase">
              Brokr Design System Showcase
            </span>
            <span className="text-[10px] font-sans font-normal px-2 py-1 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 leading-none">
              Phase 2 Architecture
            </span>
          </div>
        </div>

        <div className="text-xs text-gray-500 font-normal">
          Sursă unică de adevăr: <code className="text-[#051D35] font-sans">design/tokens/</code>
        </div>
      </header>

      {/* Main Container */}
      <div className="flex-1 flex max-w-7xl w-full mx-auto p-6 gap-6">
        {/* Navigation Sidebar */}
        <aside className="w-64 shrink-0 bg-white border border-gray-200 rounded-xl p-3 shadow-2xs self-start sticky top-[72px] space-y-1">
          <div className="px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
            Componente & Specificații
          </div>
          {sections.map((sect) => (
            <button
              key={sect.id}
              onClick={() => setActiveTab(sect.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg transition-all text-left cursor-pointer ${
                activeTab === sect.id
                  ? "bg-[#051D35] text-white shadow-xs"
                  : "text-gray-600 hover:bg-gray-100/70 hover:text-gray-900"
              }`}
            >
              <span className={activeTab === sect.id ? "text-[#BE9662]" : "text-gray-400"}>
                {sect.icon}
              </span>
              <span>{sect.label}</span>
            </button>
          ))}
        </aside>

        {/* Content Showcase Area */}
        <main className="flex-1 min-w-0 space-y-8">
          {/* Section 1: Design Tokens & Culori */}
          {activeTab === "tokens" && (
            <section className="bg-white border border-gray-200 rounded-xl p-6 shadow-2xs space-y-6">
              <div>
                <h2 className="font-title text-base font-semibold text-gray-900">Culori & Tokens de Bază</h2>
                <p className="text-xs text-gray-500 mt-1 font-normal">
                  Valorile unice definite în <code className="font-sans">design/tokens/colors/colors.ts</code>
                </p>
              </div>

              {/* Brand Palette */}
              <div className="space-y-2">
                <h3 className="font-title text-xs font-semibold text-gray-700 uppercase tracking-wider">Culori de Brand</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                  <div className="p-3 rounded-lg border border-gray-200 bg-[#051D35] text-white space-y-1 shadow-2xs">
                    <div className="font-semibold">brandNavy</div>
                    <div className="text-[10px] font-sans font-normal opacity-80">#051D35</div>
                  </div>
                  <div className="p-3 rounded-lg border border-gray-200 bg-[#BE9662] text-white space-y-1 shadow-2xs">
                    <div className="font-semibold">brandGold</div>
                    <div className="text-[10px] font-sans font-normal opacity-80">#BE9662</div>
                  </div>
                  <div className="p-3 rounded-lg border border-gray-200 bg-gray-50 text-gray-800 space-y-1 shadow-2xs">
                    <div className="font-semibold">bgApp</div>
                    <div className="text-[10px] font-sans font-normal text-gray-500">#f9fafb</div>
                  </div>
                  <div className="p-3 rounded-lg border border-gray-200 bg-white text-gray-800 space-y-1 shadow-2xs">
                    <div className="font-semibold">bgCard</div>
                    <div className="text-[10px] font-sans font-normal text-gray-500">#ffffff</div>
                  </div>
                </div>
              </div>

              {/* Semantic Status */}
              <div className="space-y-2">
                <h3 className="font-title text-xs font-semibold text-gray-700 uppercase tracking-wider">Stări Semantice</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                  <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 space-y-1">
                    <div className="font-semibold">success</div>
                    <div className="text-[10px] font-sans font-normal">#10b981</div>
                  </div>
                  <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 space-y-1">
                    <div className="font-semibold">warning</div>
                    <div className="text-[10px] font-sans font-normal">#f59e0b</div>
                  </div>
                  <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 text-rose-800 space-y-1">
                    <div className="font-semibold">danger / error</div>
                    <div className="text-[10px] font-sans font-normal">#ef4444</div>
                  </div>
                  <div className="p-3 rounded-lg border border-blue-200 bg-blue-50 text-blue-800 space-y-1">
                    <div className="font-semibold">info</div>
                    <div className="text-[10px] font-sans font-normal">#3b82f6</div>
                  </div>
                </div>
              </div>

              {/* Platform Super Admin Palette */}
              <div className="space-y-2">
                <h3 className="font-title text-xs font-semibold text-gray-700 uppercase tracking-wider">Platform Super Admin Theme</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
                  <div className="p-3 rounded-lg border border-slate-700 bg-slate-900 text-white space-y-1 shadow-2xs">
                    <div className="font-semibold">platform.primary</div>
                    <div className="text-[10px] font-sans font-normal opacity-80">#0f172a</div>
                  </div>
                  <div className="p-3 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-800 space-y-1 shadow-2xs">
                    <div className="font-semibold">platform.accent</div>
                    <div className="text-[10px] font-sans font-normal opacity-80">#6366f1</div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Section 2: Tipografie & Spacing */}
          {activeTab === "typography" && (
            <section className="bg-white border border-gray-200 rounded-xl p-6 shadow-2xs space-y-6">
              <div>
                <h2 className="font-title text-base font-semibold text-gray-900">Ierarhie Tipografică</h2>
                <p className="text-xs text-gray-500 mt-1 font-normal">Scară de fonturi și greutăți standardizate</p>
              </div>

              <div className="space-y-4 divide-y divide-gray-100">
                <div className="pt-2">
                  <span className="text-[10px] font-semibold text-gray-400 block mb-1">Heading 1 - Lato Semibold</span>
                  <h1 className="font-title text-3xl font-semibold text-gray-900 leading-tight tracking-tight">
                    Proprietate Exclusivă Primăverii
                  </h1>
                </div>

                <div className="pt-4">
                  <span className="text-[10px] font-semibold text-gray-400 block mb-1">Heading 2 - Lato Semibold</span>
                  <h2 className="font-title text-2xl font-semibold text-gray-900 leading-snug tracking-tight">
                    Detalii Financiare & Condiții Închiriere
                  </h2>
                </div>

                <div className="pt-4">
                  <span className="text-[10px] font-semibold text-gray-400 block mb-1">Heading 3 - Lato Semibold</span>
                  <h3 className="font-title text-base font-semibold text-gray-900 leading-normal">
                    Compartimentare și specificații tehnice
                  </h3>
                </div>

                <div className="pt-4">
                  <span className="text-[10px] font-semibold text-gray-400 block mb-1">Body Text - Lato Regular (400)</span>
                  <p className="text-[13px] font-normal text-gray-600 leading-relaxed">
                    Apartament complet mobilat și utilat, situat în zona Timpuri Noi, la aproximativ 5 minute de metrou.
                    Finisaje de înaltă calitate, centrală proprie și loc de parcare inclus.
                  </p>
                </div>

                <div className="pt-4">
                  <span className="text-[10px] font-semibold text-gray-400 block mb-1">Label - 11px Semibold</span>
                  <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                    Ultima actualizare: 15 Noiembrie 2026
                  </span>
                </div>
              </div>
            </section>
          )}

          {/* Section 3: Butoane */}
          {activeTab === "buttons" && (
            <section className="bg-white border border-gray-200 rounded-xl p-6 shadow-2xs space-y-6">
              <div>
                <h2 className="font-title text-base font-semibold text-gray-900">Butoane (AtmButton)</h2>
                <p className="text-xs text-gray-500 mt-1 font-normal">Toate variantele, dimensiunile și stările interactive</p>
              </div>

              {/* Variants */}
              <div className="space-y-3">
                <h3 className="font-title text-xs font-semibold text-gray-700 uppercase tracking-wider">Variante de Stil</h3>
                <div className="flex flex-wrap items-center gap-3">
                  <AtmButton variant="primary">Primary Navy</AtmButton>
                  <AtmButton variant="secondary">Secondary Outline</AtmButton>
                  <AtmButton variant="tertiary">Tertiary Gray</AtmButton>
                  <AtmButton variant="accent">Accent Gold</AtmButton>
                  <AtmButton variant="ghost">Ghost Plain</AtmButton>
                  <AtmButton variant="danger">Danger Red</AtmButton>
                </div>
              </div>

              {/* Sizes */}
              <div className="space-y-3">
                <h3 className="font-title text-xs font-semibold text-gray-700 uppercase tracking-wider">Dimensiuni</h3>
                <div className="flex items-center gap-3">
                  <AtmButton size="sm">Small (28px)</AtmButton>
                  <AtmButton size="md">Medium (36px - default)</AtmButton>
                  <AtmButton size="lg">Large (44px)</AtmButton>
                </div>
              </div>

              {/* States: Loading, Disabled, Icons */}
              <div className="space-y-3">
                <h3 className="font-title text-xs font-semibold text-gray-700 uppercase tracking-wider">Stări Interactive</h3>
                <div className="flex flex-wrap items-center gap-3">
                  <AtmButton variant="primary" isLoading>
                    Se salvează...
                  </AtmButton>
                  <AtmButton variant="primary" disabled>
                    Dezactivat
                  </AtmButton>
                  <AtmButton variant="secondary" leftIcon={<Plus size={14} />}>
                    Adaugă Lead
                  </AtmButton>
                  <AtmButton variant="danger" leftIcon={<Trash2 size={14} />}>
                    Șterge Imobil
                  </AtmButton>
                  <AtmButton variant="icon" aria-label="Setări">
                    <Settings size={16} />
                  </AtmButton>
                </div>
              </div>
            </section>
          )}

          {/* Section 4: Inputuri & Formulare */}
          {activeTab === "inputs" && (
            <section className="bg-white border border-gray-200 rounded-xl p-6 shadow-2xs space-y-6">
              <div>
                <h2 className="font-title text-base font-semibold text-gray-900">Inputuri Text & Câmpuri Formular</h2>
                <p className="text-xs text-gray-500 mt-1 font-normal">Câmpuri de introducere date cu validare și accesorii</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <MolFormField label="Nume Proprietar" required hint="Numele complet al contactului">
                  <AtmInputText
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="ex. Alexandru Popescu"
                  />
                </MolFormField>

                <MolFormField label="Email Contact" hint="Adresa oficială pentru notificări">
                  <AtmInputText
                    type="email"
                    leftIcon={<Mail size={14} className="text-gray-400" />}
                    placeholder="client@domeniu.ro"
                  />
                </MolFormField>

                <MolFormField label="Câmp cu Eroare de Validare" error="Numărul de telefon este invalid">
                  <AtmInputText error value="07123" />
                </MolFormField>

                <MolFormField label="Câmp Dezactivat">
                  <AtmInputText disabled value="Câmp blocat pentru editare" />
                </MolFormField>

                <div className="md:col-span-2">
                  <MolFormField label="Descriere Anunț">
                    <AtmTextarea
                      rows={3}
                      placeholder="Introdu note interne sau descrierea detaliată a imobilului..."
                    />
                  </MolFormField>
                </div>
              </div>
            </section>
          )}

          {/* Section 5: Controale Selecție */}
          {activeTab === "selection" && (
            <section className="bg-white border border-gray-200 rounded-xl p-6 shadow-2xs space-y-6">
              <div>
                <h2 className="font-title text-base font-semibold text-gray-900">Controale de Selecție</h2>
                <p className="text-xs text-gray-500 mt-1 font-normal">Checkbox, Radio, Switch și Dropdown Select</p>
              </div>

              <div className="space-y-4">
                {/* Switch */}
                <div>
                  <h3 className="font-title text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">Comutator (AtmSwitch)</h3>
                  <div className="flex items-center gap-6">
                    <AtmSwitch
                      checked={switchVal}
                      onChange={setSwitchVal}
                      label="Publicare automată pe portaluri"
                    />
                    <AtmSwitch checked={false} onChange={() => {}} disabled label="Dezactivat" />
                  </div>
                </div>

                <AtmDivider />

                {/* Checkbox */}
                <div>
                  <h3 className="font-title text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">Casete de Bifat (AtmCheckbox)</h3>
                  <div className="flex items-center gap-6">
                    <AtmCheckbox
                      checked={checkboxVal}
                      onChange={(e) => setCheckboxVal(e.target.checked)}
                      label="Centrală proprie de apartament"
                    />
                    <AtmCheckbox checked={false} disabled label="Opțiune indisponibilă" />
                  </div>
                </div>

                <AtmDivider />

                {/* Radio */}
                <div>
                  <h3 className="font-title text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">Opțiuni Radio (AtmRadio)</h3>
                  <div className="flex items-center gap-6">
                    <AtmRadio
                      name="trans-type"
                      checked={radioVal === "opt1"}
                      onChange={() => setRadioVal("opt1")}
                      label="Vânzare"
                    />
                    <AtmRadio
                      name="trans-type"
                      checked={radioVal === "opt2"}
                      onChange={() => setRadioVal("opt2")}
                      label="Închiriere"
                    />
                  </div>
                </div>

                <AtmDivider />

                {/* Select */}
                <div className="max-w-xs">
                  <MolFormField label="Categorie Imobil">
                    <AtmSelect
                      value={selectVal}
                      onChange={(e) => setSelectVal(e.target.value)}
                      options={[
                        { value: "apartament", label: "Apartamente" },
                        { value: "casa", label: "Case / Vile" },
                        { value: "comercial", label: "Spații Comerciale" },
                        { value: "teren", label: "Terenuri" },
                      ]}
                    />
                  </MolFormField>
                </div>
              </div>
            </section>
          )}

          {/* Section 6: Badges & Statusuri */}
          {activeTab === "badges" && (
            <section className="bg-white border border-gray-200 rounded-xl p-6 shadow-2xs space-y-6">
              <div>
                <h2 className="font-title text-base font-semibold text-gray-900">Badge-uri & Indicatori de Stare</h2>
                <p className="text-xs text-gray-500 mt-1 font-normal">Etichete semantice comune, de platformă și de agenție</p>
              </div>

              {/* Common Badges */}
              <div className="space-y-2">
                <h3 className="font-title text-xs font-semibold text-gray-700 uppercase tracking-wider">Badge-uri Comune (AtmBadge)</h3>
                <div className="flex flex-wrap items-center gap-2">
                  <AtmBadge variant="default">Implicit</AtmBadge>
                  <AtmBadge variant="brand">Brand Navy</AtmBadge>
                  <AtmBadge variant="accent">Accent Gold</AtmBadge>
                  <AtmBadge variant="success">Succes / Validat</AtmBadge>
                  <AtmBadge variant="warning">Avertisment</AtmBadge>
                  <AtmBadge variant="danger">Eroare / Respins</AtmBadge>
                  <AtmBadge variant="info">Informație</AtmBadge>
                  <AtmBadge variant="brand" pill>
                    Format Pill
                  </AtmBadge>
                </div>
              </div>

              {/* Platform Badges */}
              <div className="space-y-2">
                <h3 className="font-title text-xs font-semibold text-gray-700 uppercase tracking-wider">Statusuri Platformă (AtmPlatformBadge)</h3>
                <div className="flex items-center gap-2">
                  <AtmPlatformBadge status="active" />
                  <AtmPlatformBadge status="trial" />
                  <AtmPlatformBadge status="suspended" />
                  <AtmPlatformBadge status="pending_payment" />
                </div>
              </div>

              {/* Agency Roles */}
              <div className="space-y-2">
                <h3 className="font-title text-xs font-semibold text-gray-700 uppercase tracking-wider">Roluri Agenție (AtmAgencyRoleBadge)</h3>
                <div className="flex items-center gap-2">
                  <AtmAgencyRoleBadge role="Proprietar" />
                  <AtmAgencyRoleBadge role="Chiriaș" />
                  <AtmAgencyRoleBadge role="Cumpărător" />
                  <AtmAgencyRoleBadge role="Agent" />
                </div>
              </div>

              {/* Status Indicators */}
              <div className="space-y-2">
                <h3 className="font-title text-xs font-semibold text-gray-700 uppercase tracking-wider">Indicatori Punctuali (AtmStatusIndicator)</h3>
                <div className="flex items-center gap-4 text-xs text-gray-600 font-normal">
                  <span className="flex items-center gap-2">
                    <AtmStatusIndicator status="online" pulse /> Conectat (Pulse)
                  </span>
                  <span className="flex items-center gap-2">
                    <AtmStatusIndicator status="away" /> Absent
                  </span>
                  <span className="flex items-center gap-2">
                    <AtmStatusIndicator status="busy" /> Ocupat
                  </span>
                  <span className="flex items-center gap-2">
                    <AtmStatusIndicator status="offline" /> Deconectat
                  </span>
                </div>
              </div>
            </section>
          )}

          {/* Section 7: Molecule Reutilizabile */}
          {activeTab === "molecules" && (
            <section className="bg-white border border-gray-200 rounded-xl p-6 shadow-2xs space-y-6">
              <div>
                <h2 className="font-title text-base font-semibold text-gray-900">Molecule Reutilizabile</h2>
                <p className="text-xs text-gray-500 mt-1 font-normal">Combinații coerente de atomi pentru interacțiuni frecvente</p>
              </div>

              {/* Search & Breadcrumbs */}
              <div className="space-y-3">
                <h3 className="font-title text-xs font-semibold text-gray-700 uppercase tracking-wider">Căutare & Breadcrumbs</h3>
                <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                  <MolBreadcrumbs
                    items={[
                      { id: "1", label: "Panou Principal", href: "#" },
                      { id: "2", label: "Proprietăți", href: "#" },
                      { id: "3", label: "Apartamente 2 Camere" },
                    ]}
                  />
                  <div className="w-64">
                    <MolSearchField
                      value={inputSearch}
                      onChange={(e) => setInputSearch(e.target.value)}
                      onClear={() => setInputSearch("")}
                    />
                  </div>
                </div>
              </div>

              <AtmDivider />

              {/* User Block & Dropdown */}
              <div className="space-y-3">
                <h3 className="font-title text-xs font-semibold text-gray-700 uppercase tracking-wider">Bloc Utilizator & Dropdown Menu</h3>
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <MolUserBlock
                    name="Adrian Marius"
                    subtitle="Administrator Agenție"
                    status="online"
                  />
                  <MolDropdownMenu
                    trigger={
                      <AtmButton variant="secondary" size="sm">
                        Opțiuni Cont
                      </AtmButton>
                    }
                    items={[
                      { id: "prof", label: "Profil Agenție", onClick: () => {} },
                      { id: "set", label: "Setări Subdomeniu", onClick: () => {} },
                      { id: "del", label: "Deconectare", danger: true, onClick: () => {} },
                    ]}
                  />
                </div>
              </div>

              <AtmDivider />

              {/* Empty & Error States */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <MolEmptyState
                  title="Nicio proprietate în stadiul curent"
                  description="Adaugă un link de anunț sau creează o listare manuală pentru a începe."
                  actionLabel="Adaugă Proprietate"
                  onAction={() => {}}
                />

                <MolErrorState
                  title="Conexiunea cu serviciul a eșuat"
                  message="Verifică conexiunea la internet sau contactează suportul platformei dacă problema persistă."
                  onRetry={() => {}}
                />
              </div>

              <AtmDivider />

              {/* File Upload Dropzone */}
              <div>
                <h3 className="font-title text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">Încărcare Documente</h3>
                <MolFileUpload onFileSelect={() => {}} />
              </div>
            </section>
          )}

          {/* Section 8: Organisme & Date */}
          {activeTab === "organisms" && (
            <section className="space-y-6">
              {/* Metric Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <OrgMetricCard
                  label="Proprietăți Active"
                  value="148"
                  trend={{ value: "+12% luna aceasta", isPositive: true }}
                  icon={<Building2 size={16} />}
                />
                <OrgMetricCard
                  label="Lead-uri Noi"
                  value="42"
                  trend={{ value: "+5 astăzi", isPositive: true }}
                  icon={<Users size={16} />}
                />
                <OrgMetricCard
                  label="Timp Mediu Calificare"
                  value="18 min"
                  trend={{ value: "-4 min", isPositive: true }}
                  icon={<Clock size={16} />}
                />
              </div>

              {/* Lead Quick Card (Agency Scope) */}
              <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-2xs space-y-4">
                <h3 className="font-title text-xs font-semibold text-gray-700 uppercase tracking-wider">Card Lead Agenție (OrgLeadQuickCard)</h3>
                <div className="max-w-md">
                  <OrgLeadQuickCard
                    id="lead-1"
                    internalId="P1024"
                    title="Apartament 2 camere modern, decomandat | Timpuri Noi"
                    price="550 € / lună"
                    role="Proprietar"
                    transactionType="Închiriere"
                    rooms={2}
                    zone="Timpuri Noi, București"
                    ownerName="Ion Ionescu"
                    contactsCount={3}
                    onQuickViewClick={() => setIsModalOpen(true)}
                    onShareClick={() => {}}
                  />
                </div>
              </div>

              {/* Data Table */}
              <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-2xs space-y-4">
                <h3 className="font-title text-xs font-semibold text-gray-700 uppercase tracking-wider">Tabel de Date (OrgDataTable)</h3>
                <OrgDataTable
                  columns={[
                    { key: "agency", header: "Agenție Imobiliară", sortable: true },
                    { key: "subdomain", header: "Subdomeniu", render: (r) => <span className="font-sans font-normal text-gray-500">{r.subdomain}.ourcrm.com</span> },
                    { key: "plan", header: "Plan Tarifar" },
                    {
                      key: "status",
                      header: "Status",
                      render: (r) => <AtmPlatformBadge status={r.status as any} />,
                    },
                    { key: "agents", header: "Agenți", align: "right", render: (r) => <span className="font-sans tabular-nums font-normal">{r.agents}</span> },
                  ]}
                  data={sampleTableData}
                  keyExtractor={(item) => item.id}
                  pagination={{
                    currentPage: 1,
                    totalPages: 4,
                    totalItems: 18,
                    onPageChange: () => {},
                  }}
                />
              </div>

              {/* Timeline */}
              <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-2xs space-y-4">
                <h3 className="font-title text-xs font-semibold text-gray-700 uppercase tracking-wider">Jurnal Activități (OrgTimeline)</h3>
                <OrgTimeline
                  events={[
                    {
                      id: "1",
                      title: "Vizionare programată cu clientul",
                      timestamp: "Astăzi, 14:30",
                      author: "Marius A.",
                      description: "Confirmare primită prin SMS pentru apartamentul #P1024.",
                      variant: "brand",
                    },
                    {
                      id: "2",
                      title: "Extracție automată anunț finalizată",
                      timestamp: "Ieri, 18:20",
                      author: "Gemini AI",
                      description: "Date extrase cu succes din Storia, watermark eliminat prin inpainting.",
                      variant: "success",
                    },
                  ]}
                />
              </div>
            </section>
          )}

          {/* Section 9: Overlays (Modale & Sertare) */}
          {activeTab === "overlays" && (
            <section className="bg-white border border-gray-200 rounded-xl p-6 shadow-2xs space-y-6">
              <div>
                <h2 className="font-title text-base font-semibold text-gray-900">Overlays (Modale & Sertare)</h2>
                <p className="text-xs text-gray-500 mt-1 font-normal">Componente de dialog accesibile și panouri glisante</p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <AtmButton variant="primary" onClick={() => setIsModalOpen(true)}>
                  Deschide Modal de Bază (OrgModalBase)
                </AtmButton>

                <AtmButton variant="secondary" onClick={() => setIsDrawerOpen(true)}>
                  Deschide Sertar Lateral (OrgDrawerBase)
                </AtmButton>

                <AtmButton variant="danger" onClick={() => setIsConfirmOpen(true)}>
                  Deschide Dialog Confirmare
                </AtmButton>
              </div>

              {/* Modal Base Instance */}
              <OrgModalBase
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title="Exemplu Modal de Bază"
                subtitle="Componentă accesibilă din nivelul Organisms"
                footer={
                  <>
                    <AtmButton variant="secondary" size="md" onClick={() => setIsModalOpen(false)}>
                      Anulează
                    </AtmButton>
                    <AtmButton variant="primary" size="md" onClick={() => setIsModalOpen(false)}>
                      Salvează Schimbările
                    </AtmButton>
                  </>
                }
              >
                <div className="space-y-4">
                  <p className="text-xs text-gray-600 font-normal">
                    Acesta este corpul modalului bazat pe token-uri de design (<code className="font-sans">radius.modal</code>, backdrop blur, animație la deschidere).
                  </p>
                  <MolFormField label="Nume Configurație">
                    <AtmInputText defaultValue="Valoare test" />
                  </MolFormField>
                </div>
              </OrgModalBase>

              {/* Drawer Base Instance */}
              <OrgDrawerBase
                isOpen={isDrawerOpen}
                onClose={() => setIsDrawerOpen(false)}
                title="Sertar Lateral Detalii"
                subtitle="Glisează din dreapta cu animație fluidă"
                footer={
                  <AtmButton variant="primary" size="md" onClick={() => setIsDrawerOpen(false)}>
                    Închide Sertar
                  </AtmButton>
                }
              >
                <div className="space-y-3">
                  <p className="text-xs text-gray-600">
                    Sertarele sunt ideale pentru inspectarea rapidă a fișierelor, calendarului sau detaliilor extinse ale agenților.
                  </p>
                </div>
              </OrgDrawerBase>

              {/* Confirmation Dialog Modal Instance */}
              <OrgModalBase
                isOpen={isConfirmOpen}
                onClose={() => setIsConfirmOpen(false)}
                size="sm"
              >
                <MolConfirmationDialog
                  title="Ești sigur că vrei să ștergi această înregistrare?"
                  description="Această acțiune este permanentă și nu va mai putea fi recuperată."
                  isDestructive
                  confirmLabel="Șterge definitiv"
                  onConfirm={() => setIsConfirmOpen(false)}
                  onCancel={() => setIsConfirmOpen(false)}
                />
              </OrgModalBase>
            </section>
          )}
        </main>
      </div>
    </div>
  );
};
