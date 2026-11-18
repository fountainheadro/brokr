import React, { useState, useEffect, useRef, useMemo } from "react";
import { useLocation, useNavigate, matchPath } from "react-router-dom";
import { Header } from "../components/Header";
import { Sidebar, NavSubItem, NavTransactionType } from "../components/Sidebar";
import { ContactsView } from "../components/ContactsView";
import { ContactDetailView } from "../components/ContactDetailView";
import { PersonalView } from "../components/PersonalView";
import { AddLeadModal } from "../components/AddLeadModal";
import { LeadList } from "../components/LeadList";
import { LeadCard } from "../components/LeadCard";
import { leadsService, Lead, LeadStatus, LeadRole, getLeadRole, CERERI_STATUSES, PROPRIETATI_STATUSES, isCerereLead } from "../services/leadsService";
import { entityIdService } from "../services/entityIdService";
import { contactsService, Contact } from "../services/contactsService";
import { personalService, PersonalMember } from "../services/personalService";
import { viewingsService, Viewing } from "../services/viewingsService";
import { downloadVCard } from "../lib/vcard";
import { AddContactModal } from "../components/AddContactModal";
import { AddCerereModal } from "../components/AddCerereModal";
import { AddViewingModal } from "../components/AddViewingModal";
import { AddDocumentModal } from "../components/AddDocumentModal";
import { AddActivityModal } from "../components/AddActivityModal";
import { AddTourModal } from "../components/AddTourModal";
import { PropertyQuickViewModal } from "../components/PropertyQuickViewModal";
import { PropertyDetailView } from "../components/PropertyDetailView";
import { LeadCerereDetailPage } from "../components/LeadCerereDetailPage";
import { NotificationsModal } from "../components/NotificationsModal";
import { CalendarView } from "../components/CalendarView";
import { ExtractionRulesModal } from "../components/ExtractionRulesModal";
import { notificationsService, Notification as AppNotification } from "../services/notificationsService";
import { motion, AnimatePresence, Transition } from "motion/react";
import { extractData, extractBasicData } from "../services/geminiService";
import { getApiAuthHeaders } from "../lib/apiAuth";
import { toast } from "react-hot-toast";
import { generateStandardAdTitle } from "../utils/propertyTitleGenerator";
import { automationSettingsService } from "../services/automationSettingsService";
import { getCleanDisplayImageUrl, getThumbnailImageUrl } from "../utils/imageUtils";
import { 
  DetaliiGeneraleSection, 
  CaracteristiciSection, 
  UtilitatiSection, 
  PretSection, 
  DescriereSection, 
  ImaginiSection
} from "../components/PropertyForm";
import { FormInput, FormSelect } from "../components/FormElements";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { 
  ChevronDown, 
  ChevronLeft, 
  Zap, 
  Search, 
  Hash,
  Database, 
  Copy, 
  Download, 
  Check, 
  X, 
  Loader2,
  Trash2,
  Users,
  Plus,
  Phone,
  Clock,
  Calendar,
  Info,
  Layout,
  MessageSquare,
  Filter,
  Share2,
  ExternalLink,
  Printer,
  Inbox,
  Building2,
  ClipboardList,
  SlidersHorizontal,
  Timer,
  Edit3,
  ShieldAlert,
  AlertCircle
} from "lucide-react";
import { getPublicShareUrl } from "../utils/shareUtils";
import { auth } from "../lib/firebase";
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider } from "firebase/auth";
import { useAuth } from "../core/auth/ctx_auth";
import { useTenantContext } from "../core/tenancy/ctx_tenant";
import { CATEGORIA_OPTIONS, TRANZACTIE_OPTIONS } from "../constants";

import { ViewingDetailsModal } from "../components/ViewingDetailsModal";
import { NevalidataUrlList } from "../components/NevalidataUrlList";
import { NevalidataDetailsModal } from "../components/NevalidataDetailsModal";
import { CalificataDetailsModal } from "../components/CalificataDetailsModal";
import {
  OlxLeadDrawer,
  OLX_MAX_AGE_STEPS,
  DEFAULT_OLX_MIN_AD_AGE_HOURS,
  DEFAULT_OLX_MAX_AD_AGE_HOURS,
  type OlxLeadDrawerMode,
} from "../components/OlxLeadDrawer";
import {
  OlxLeadFilters,
  DEFAULT_OLX_LEAD_FILTERS,
  countActiveOlxFilters,
  hasActiveOlxFilters,
  matchesOlxLeadFilter,
} from "../utils/olxFilterUtils";

const TABS: LeadStatus[] = [
  "Noi",
  "Pierdute",
  "Nevalidata", 
  "Calificata", 
  "Noua", 
  "Prospectare", 
  "Colaborare", 
  "Calificare", 
  "Matching", 
  "Vizionare", 
  "Ofertare", 
  "Antecontract", 
  "Contract", 
  "Activa", 
  "InNegociere", 
  "Finalizata", 
  "Arhiva", 
  "Sterse"
];

const LEADS_TABS: LeadStatus[] = ["Noi", "Pierdute"];

const CERERI_TABS: LeadStatus[] = ["Noua", "Calificare", "Matching", "Vizionare", "Ofertare", "Antecontract", "Contract"];

const PROPRIETATI_TABS: LeadStatus[] = ["Noua", "Prospectare", "Colaborare", "Vizionare", "Ofertare", "Antecontract", "Contract"];

const STATUS_LABELS: Record<string, string> = {
  "Noi": "Noi",
  "Pierdute": "Pierdute",
  "Nevalidata": "Nevalidate",
  "Calificata": "Calificate",
  "Noua": "Nouă",
  "Prospectare": "Prospectare",
  "Colaborare": "Colaborare",
  "Calificare": "Calificare",
  "Matching": "Matching",
  "Vizionare": "Vizionare",
  "Ofertare": "Ofertare",
  "Antecontract": "Antecontract",
  "Contract": "Contract",
  "Activa": "Active pe piață",
  "AreInteres": "Nouă",
  "InNegociere": "În Negociere",
  "Finalizata": "Finalizate",
  "Arhiva": "Arhivă",
  "Sterse": "Șterse"
};

const pageSlideTransition: Transition = {
  x: { type: "tween", duration: 0.28, ease: [0.22, 1, 0.36, 1] },
};

type SortOption = 'newest' | 'oldest' | 'expensive' | 'cheap';
type TransactionFilter = 'Toate' | 'Vânzare' | 'Închiriere' | 'Cumpărare';
type LeadRoleFilter = 'Toate' | 'Proprietari' | 'Cumparatori' | 'Chiriasi' | 'Proprietar' | 'Chirias' | 'Cumparator';

const parsePrice = (priceStr: string): number => {
  if (!priceStr) return 0;
  const cleaned = priceStr.replace(/[^0-9]/g, '');
  return parseInt(cleaned, 10) || 0;
};

const getTimestampMs = (val: any): number => {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  if (typeof val.toMillis === 'function') return val.toMillis();
  if (val && val.seconds !== undefined) return val.seconds * 1000 + Math.floor((val.nanoseconds || 0) / 1000000);
  if (val instanceof Date) return val.getTime();
  const dateObj = new Date(val);
  if (!isNaN(dateObj.getTime())) return dateObj.getTime();
  return 0;
};

const formatDateGroup = (timestamp: any): string => {
  if (!timestamp) return "Fără dată";
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const formatted = date.toLocaleDateString('ro-RO', { day: 'numeric', month: 'long' });
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
};

const getPriceRange = (price: number): string => {
  if (price === 0) return "Fără preț";
  if (price <= 500) return "1-500€";
  if (price <= 1000) return "501-1000€";
  if (price <= 2000) return "1001-2000€";
  return "2000+";
};

const getTextFromChildren = (children: any): string => {
  if (!children) return "";
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(getTextFromChildren).join("");
  if (typeof children === "object" && children.props && children.props.children) return getTextFromChildren(children.props.children);
  return "";
};

const TableHeaderCopyButton = ({ children, isImageTable = false }: { children: any; isImageTable?: boolean }) => {
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const handleCopyTable = (e: React.MouseEvent) => {
    e.stopPropagation();
    const table = ref.current?.closest("table");
    if (table) {
      const text = table.innerText;
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownloadAll = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const table = ref.current?.closest("table");
    if (!table) return;
    
    const images = Array.from(table.querySelectorAll("img"));
    for (let i = 0; i < images.length; i++) {
      const url = images[i].src;
      try {
        const response = await fetch(url);
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = `image-${i + 1}-${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(blobUrl);
        await new Promise(r => setTimeout(r, 200));
      } catch (err) {
        console.error("Failed to download image", url);
      }
    }
  };

  return (
    <div ref={ref} className="group/hcell relative w-full min-h-[20px] py-1">
      <div className="break-words whitespace-normal">{children}</div>
      <div className="opacity-0 group-hover/hcell:opacity-100 flex items-center gap-1 absolute right-0 top-1 z-10 transition-opacity">
        <button 
          onClick={handleCopyTable}
          className="flex items-center justify-center w-6 h-6 rounded-md bg-white border border-slate-200 text-slate-400 hover:text-[#f44336] transition-all shadow-sm active:scale-90"
        >
          {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
        </button>
        {isImageTable && (
          <button 
            onClick={handleDownloadAll}
            className="flex items-center justify-center w-6 h-6 rounded-md bg-white border border-slate-200 text-slate-400 hover:text-[#f44336] transition-all shadow-sm active:scale-90"
          >
            <Download size={12} />
          </button>
        )}
      </div>
    </div>
  );
};

const CellCopyButton = ({ text, isImage = false, url = "", isRowDownload = false, rowRef = null }: { text: string; isImage?: boolean; url?: string; isRowDownload?: boolean; rowRef?: React.RefObject<HTMLTableRowElement> | null }) => {
  const [copied, setCopied] = useState(false);
  
  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(url || text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadSingle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!url) return;
    downloadImage(url);
  };

  const handleDownloadRow = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!rowRef?.current) return;
    const images = Array.from(rowRef.current.querySelectorAll("img"));
    for (let i = 0; i < images.length; i++) {
        await downloadImage(images[i].src, `cat-image-${i + 1}-${Date.now()}.png`);
        await new Promise(r => setTimeout(r, 300));
    }
  };

  const downloadImage = async (imgUrl: string, fileName?: string) => {
    try {
      const response = await fetch(imgUrl);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = fileName || `property-image-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      window.open(imgUrl, "_blank");
    }
  };

  return (
    <div className="hidden group-hover/row:flex items-center gap-1 absolute right-1 top-1 z-20 transition-all">
      {!isRowDownload && (
        <button 
          onClick={handleCopy}
          className="flex items-center justify-center w-6 h-6 rounded-md bg-white border border-slate-200 text-slate-500 hover:text-[#f44336] transition-all shadow-sm active:scale-90"
        >
          {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
        </button>
      )}
      {isImage && !isRowDownload && (
        <button 
          onClick={handleDownloadSingle}
          className="flex items-center justify-center w-6 h-6 rounded-md bg-white border border-slate-200 text-slate-500 hover:text-[#f44336] transition-all shadow-sm active:scale-90"
        >
          <Download size={12} />
        </button>
      )}
      {isRowDownload && (
        <button 
          onClick={handleDownloadRow}
          className="flex items-center justify-center w-6 h-6 rounded-md bg-white border border-slate-200 text-slate-500 hover:text-[#f44336] transition-all shadow-sm active:scale-90"
        >
          <Download size={12} />
        </button>
      )}
    </div>
  );
};

export const Home: React.FC = () => {
  const [activeTab, setActiveTab] = useState<LeadStatus>("Noua");
  const [lastVisitedTimes, setLastVisitedTimes] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem('lastVisited_tabs');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });
  const [sortOption, setSortOption] = useState<SortOption>('newest');
  const [transactionFilter, setTransactionFilter] = useState<TransactionFilter>('Toate');
  const [leadRoleFilter, setLeadRoleFilter] = useState<LeadRoleFilter>('Toate');
  const [activeSidebarItem, setActiveSidebarItem] = useState<NavSubItem>('Proprietati');
  const location = useLocation();
  const navigate = useNavigate();
  const prevPathnameRef = useRef(location.pathname);
  const closingDetailRouteRef = useRef(false);
  const skipRouteClearRef = useRef(false);

  const handleSelectSidebarItem = (subItem: NavSubItem) => {
    if (selectedLead || location.pathname !== "/") {
      closingDetailRouteRef.current = true;
      setSelectedLead(null);
      setIsEditingDetails(false);
      setShowDeleteConfirm(false);
    }
    if (selectedContact) {
      setSelectedContact(null);
    }
    const normalized = subItem === 'Imobile' || subItem === 'Proprietăți' ? 'Proprietati' : (subItem === 'Clienți' ? 'Contacte' : subItem);
    setActiveSidebarItem(normalized);
    if (normalized === 'Lead-uri') {
      setActiveTab('Noi');
      setLeadRoleFilter('Toate');
    } else if (normalized === 'Cereri') {
      setActiveTab('Noua');
      setTransactionFilter('Toate');
    } else if (normalized === 'Proprietati') {
      setActiveTab('Noua');
      setTransactionFilter('Toate');
    }
  };

  useEffect(() => {
    if (location.state && (location.state as any).sidebarNav) {
      const { subItem } = (location.state as any).sidebarNav;
      if (subItem) {
        handleSelectSidebarItem(subItem);
      }
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  const [categoryFilter, setCategoryFilter] = useState<string>('Toate');
  const [olxDrawerMode, setOlxDrawerMode] = useState<OlxLeadDrawerMode | null>(null);
  const [olxFilters, setOlxFilters] = useState<OlxLeadFilters>(DEFAULT_OLX_LEAD_FILTERS);
  const [olxAutoScanFilters, setOlxAutoScanFilters] = useState<OlxLeadFilters>(() => {
    try {
      const saved = localStorage.getItem("brokr_olx_autoscan_filters");
      if (!saved) return DEFAULT_OLX_LEAD_FILTERS;
      const parsed = JSON.parse(saved);
      return {
        ...DEFAULT_OLX_LEAD_FILTERS,
        ...parsed,
        zones: Array.isArray(parsed?.zones) ? parsed.zones : [],
      };
    } catch {
      return DEFAULT_OLX_LEAD_FILTERS;
    }
  });
  const [olxScanIntervalMinutes, setOlxScanIntervalMinutes] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem("brokr_olx_scan_interval") || 0);
      return [0, 1, 5, 15, 30, 60].includes(saved) ? saved : 0;
    } catch {
      return 0;
    }
  });
  const [olxScanLimit, setOlxScanLimit] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem("brokr_olx_scan_limit") || 3);
      return [3, 6, 9, 12, 24, 48].includes(saved) ? saved : 3;
    } catch {
      return 3;
    }
  });
  const [olxMinAdAgeHours, setOlxMinAdAgeHours] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem("brokr_olx_min_ad_age_hours") || DEFAULT_OLX_MIN_AD_AGE_HOURS);
      return OLX_MAX_AGE_STEPS.some((s) => s.hours === saved) ? saved : DEFAULT_OLX_MIN_AD_AGE_HOURS;
    } catch {
      return DEFAULT_OLX_MIN_AD_AGE_HOURS;
    }
  });
  const [olxMaxAdAgeHours, setOlxMaxAdAgeHours] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem("brokr_olx_max_ad_age_hours") || DEFAULT_OLX_MAX_AD_AGE_HOURS);
      return OLX_MAX_AGE_STEPS.some((s) => s.hours === saved && s.hours > 0) ? saved : DEFAULT_OLX_MAX_AD_AGE_HOURS;
    } catch {
      return DEFAULT_OLX_MAX_AD_AGE_HOURS;
    }
  });
  const [isOlxAutoScanning, setIsOlxAutoScanning] = useState<boolean>(false);
  const [lastOlxScanAt, setLastOlxScanAt] = useState<number | null>(null);
  const [olxScanNotice, setOlxScanNotice] = useState<{
    type: "info" | "error";
    title: string;
    message: string;
    timestamp: number;
  } | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [personal, setPersonal] = useState<PersonalMember[]>([]);

  // Compute live counts matching the sidebar definition
  const counts = useMemo(() => {
    const isCerere = (l: Lead) => isCerereLead(l);
    const isLeadItem = (l: Lead) => !isCerere(l) && l.status !== 'Sterse' && (l.status === 'Noi' || l.status === 'Pierdute' || l.status === 'Nevalidata' || l.status === 'Calificata');
    const isPropItem = (l: Lead) => !isCerere(l) && l.status !== 'Nevalidata' && l.status !== 'Calificata' && l.status !== 'Noi' && l.status !== 'Pierdute' && l.status !== 'Sterse';

    return {
      leads: leads.filter(isLeadItem).length,
      cereri: leads.filter(isCerere).length,
      proprietati: leads.filter(isPropItem).length,
      clienti: contacts.length,
      personal: personal.length
    };
  }, [leads, contacts, personal]);

  // Specific tabs for each section: Lead-uri (Noi, Pierdute), Cereri, Imobile
  const sectionTabs = useMemo<LeadStatus[]>(() => {
    if (activeSidebarItem === 'Lead-uri') {
      return LEADS_TABS;
    }
    if (activeSidebarItem === 'Cereri') {
      return CERERI_TABS;
    }
    // Default to Proprietăți
    return PROPRIETATI_TABS;
  }, [activeSidebarItem]);

  // Section title, description and icon metadata
  const sectionHeaderInfo = useMemo(() => {
    if (activeSidebarItem === 'Lead-uri') {
      return {
        title: 'Lead-uri',
        count: counts.leads,
        description: 'Lead-uri preluate din piață (Proprietari, Chiriași, Cumpărători)',
        searchPlaceholder: 'Caută în lead-uri (nume, telefon, zonă, ID, preț)...',
        icon: <Inbox size={16} className="text-[#BE9662]" />
      };
    }
    if (activeSidebarItem === 'Cereri') {
      return {
        title: 'Cereri',
        count: counts.cereri,
        description: 'Cereri active de la clienți interesați de cumpărare sau închiriere',
        searchPlaceholder: 'Caută cereri după client, zonă, preferințe...',
        icon: <ClipboardList size={16} className="text-[#BE9662]" />
      };
    }
    return {
      title: 'Proprietati',
      count: counts.proprietati,
      description: 'Portofoliul complet de proprietati (Nouă, Prospectare, Colaborare, Vizionare, Ofertare, Antecontract, Contract)',
      searchPlaceholder: 'Caută proprietati după titlu, zonă, ID (#P...), preț...',
      icon: <Building2 size={16} className="text-[#BE9662]" />
    };
  }, [activeSidebarItem, counts]);
  const [viewings, setViewings] = useState<Viewing[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCerereModalOpen, setIsCerereModalOpen] = useState(false);
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
  const [isActivityModalOpen, setIsActivityModalOpen] = useState(false);
  const [isTourModalOpen, setIsTourModalOpen] = useState(false);
  const [activityDefaultDate, setActivityDefaultDate] = useState("");
  const [activityDefaultHour, setActivityDefaultHour] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isViewingModalOpen, setIsViewingModalOpen] = useState(false);
  const [isQuickViewOpen, setIsQuickViewOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [selectedNevalidatLead, setSelectedNevalidatLead] = useState<Lead | null>(null);
  const [selectedCalificatLead, setSelectedCalificatLead] = useState<Lead | null>(null);
  const [selectedQuickViewLead, setSelectedQuickViewLead] = useState<Lead | null>(null);
  const [selectedViewing, setSelectedViewing] = useState<Viewing | null>(null);
  const [isViewingDetailsOpen, setIsViewingDetailsOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionStatus, setExtractionStatus] = useState("");
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [editedName, setEditedName] = useState("");
  const [editedPhone, setEditedPhone] = useState("");
  const [editedPropertyId, setEditedPropertyId] = useState("");
  const [editedTitle, setEditedTitle] = useState("");
  const [editedZone, setEditedZone] = useState("");
  const [editedPrice, setEditedPrice] = useState("");
  const [editedTransactionType, setEditedTransactionType] = useState<"Vânzare" | "Închiriere">("Vânzare");
  const [editedCategoria, setEditedCategoria] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isExtractionRulesOpen, setIsExtractionRulesOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const { user, isLoading: authLoading, loginWithGoogle, logout } = useAuth();
  const { isAccessDenied, accessDeniedReason, isLoading: isTenantLoading, startPreview } = useTenantContext();
  const [loginError, setLoginError] = useState<string | null>(null);
  const [copiedDomain, setCopiedDomain] = useState<string | null>(null);

  useEffect(() => {
    if (location.search.includes('calendar=true')) {
      handleSelectSidebarItem('Calendar');
      navigate('/', { replace: true });
    }
  }, [location.search, navigate]);

  const handleCopyDomain = async (domain: string) => {
    try {
      await navigator.clipboard.writeText(domain);
      setCopiedDomain(domain);
      setTimeout(() => setCopiedDomain(null), 3000);
      toast.success("Domeniul a fost copiat în clipboard!");
    } catch (err) {
      // Fallback for when modern clipboard API is restricted/unsupported in iframes
      try {
        const tempInput = document.createElement("input");
        tempInput.value = domain;
        document.body.appendChild(tempInput);
        tempInput.select();
        document.execCommand("copy");
        document.body.removeChild(tempInput);
        setCopiedDomain(domain);
        setTimeout(() => setCopiedDomain(null), 3000);
        toast.success("Domeniul a fost copiat!");
      } catch (fallbackErr) {
        console.error("Nu s-a putut copia domeniul:", fallbackErr);
        toast.error("Vă rugăm să selectați și să copiați textul manual.");
      }
    }
  };

  const [copiedShareId, setCopiedShareId] = useState<string | null>(null);

  const handleCopyShareLink = async (id: string) => {
    const url = getPublicShareUrl(id);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedShareId(id);
      setTimeout(() => setCopiedShareId(null), 3000);
      toast.success("Linkul public fără autentificare a fost copiat!");
    } catch (err) {
      try {
        const tempInput = document.createElement("input");
        tempInput.value = url;
        document.body.appendChild(tempInput);
        tempInput.select();
        document.execCommand("copy");
        document.body.removeChild(tempInput);
        setCopiedShareId(id);
        setTimeout(() => setCopiedShareId(null), 3000);
        toast.success("Linkul public a fost copiat!");
      } catch (fallbackErr) {
        toast.error("Vă rugăm să copiați linkul manual.");
      }
    }
  };

  const lastOptimisticUpdate = useRef<{ id: string, time: number } | null>(null);

  const [activeSection, setActiveSection] = useState<string>("basicale");

  const activeSectionsList = React.useMemo(() => {
    const hasExtractionData = Boolean(selectedLead?.extractedData);
    if (hasExtractionData) {
      return [
        { id: "basicale", label: "Informații de Bază" },
        { id: "detaliigenerale", label: "Detalii Generale" },
        { id: "caracteristici", label: "Caracteristici" },
        { id: "utilitati", label: "Utilități" },
        { id: "pret", label: "Preț" },
        { id: "descriere", label: "Descriere" },
        { id: "imagini", label: "Imagini" },
        { id: "identificare", label: "Identificare" },
        { id: "contactealocate", label: "Contacte Alocate" },
        { id: "vizionaridb", label: "Vizionări" }
      ];
    } else {
      return [
        { id: "basicale", label: "Informații de Bază" },
        { id: "identificare", label: "Identificare" },
        { id: "contactealocate", label: "Contacte Alocate" },
        { id: "vizionaridb", label: "Vizionări" }
      ];
    }
  }, [selectedLead]);

  const handleDetailsScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const isDesktop = window.innerWidth >= 1024;
    
    // On desktop, Column 1 sections (identificare, contactealocate, vizionaridb) are in a sticky sidebar.
    // They are relatively static on the viewport and don't scroll past the header, so we exclude them
    // from scroll tracking to allow Column 2's scrolling cards to highlight properly.
    const scrollSections = isDesktop 
      ? activeSectionsList.filter(s => !["identificare", "contactealocate", "vizionaridb"].includes(s.id))
      : activeSectionsList;

    let closestSection = activeSection;
    let minDistance = Infinity;
    const headerOffset = 130; // 96px header + extra margin for focus threshold

    for (const sect of scrollSections) {
      const el = document.getElementById(sect.id);
      if (el) {
        const rect = el.getBoundingClientRect();
        
        // Exact overlap detection: if the section top has scrolled past the header, 
        // and its bottom hasn't cleared the header yet, it's the active view!
        if (rect.top <= headerOffset + 24 && rect.bottom > headerOffset) {
          closestSection = sect.id;
          break;
        }
        
        const distance = Math.abs(rect.top - headerOffset);
        if (distance < minDistance) {
          minDistance = distance;
          closestSection = sect.id;
        }
      }
    }

    // Auto-select the last section if scrolled fully to the bottom
    const target = e.currentTarget;
    const isAtBottom = Math.abs(target.scrollHeight - target.clientHeight - target.scrollTop) < 20;
    if (isAtBottom && scrollSections.length > 0) {
      closestSection = scrollSections[scrollSections.length - 1].id;
    }
    
    if (closestSection && closestSection !== activeSection) {
      setActiveSection(closestSection);
    }
  };

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const getCompletionState = (id: string) => {
    if (!selectedLead) return 'empty';
    const crm = selectedLead.extractedData?.crmData;
    
    switch (id) {
      case 'basicale': {
        const fields = [editedTitle, editedName, editedPhone, editedZone, editedPrice];
        const filled = fields.filter(f => f && String(f).trim() !== '').length;
        if (filled === 0) return 'empty';
        if (filled === fields.length) return 'complete';
        return 'partial';
      }
      case 'detaliigenerale': {
        const dg = crm?.detaliiGenerale;
        if (!dg) return 'empty';
        const hasOras = Boolean(dg.localizare?.oras);
        const hasZona = Array.isArray(dg.localizare?.zona) && dg.localizare.zona.length > 0;
        const hasTranzactie = Boolean(dg.tranzactie);
        const hasCategoria = Boolean(dg.categoria);
        
        const total = 4;
        const filled = [hasOras, hasZona, hasTranzactie, hasCategoria].filter(Boolean).length;
        if (filled === 0) return 'empty';
        if (filled === total) return 'complete';
        return 'partial';
      }
      case 'caracteristici': {
        const car = crm?.caracteristici;
        if (!car) return 'empty';
        const sup = car.suprafete?.utila;
        const stadiu = car.alteDetalii?.stadiuConstructie;
        const filled = [sup, stadiu].filter(f => f !== undefined && f !== null && String(f).trim() !== '').length;
        if (filled === 0) return 'empty';
        if (filled === 2) return 'complete';
        return 'partial';
      }
      case 'utilitati': {
        const ut = crm?.utilitati;
        if (!ut) return 'empty';
        const hasSomething = Object.values(ut).some((val: any) => {
          if (Array.isArray(val)) return val.length > 0;
          if (typeof val === 'object' && val !== null) return Object.values(val).some(v => v);
          return val;
        });
        return hasSomething ? 'complete' : 'empty';
      }
      case 'pret': {
        const pret = crm?.pret;
        if (!pret) return 'empty';
        const hasSomething = pret.detalii?.pret || pret.detalii?.garantie || pret.detalii?.avans;
        return hasSomething ? 'complete' : 'empty';
      }
      case 'descriere': {
        const desc = crm?.descriere;
        if (!desc) return 'empty';
        const hasSomething = desc.titlu || desc.continut;
        if (!hasSomething) return 'empty';
        if (desc.titlu && desc.continut) return 'complete';
        return 'partial';
      }
      case 'imagini': {
        const img = crm?.imagini;
        if (!img) return 'empty';
        const hasImages = Object.values(img).some((arr: any) => Array.isArray(arr) && arr.length > 0);
        return hasImages ? 'complete' : 'empty';
      }
      case 'identificare': {
        return editedPropertyId ? 'complete' : 'empty';
      }
      case 'contactealocate': {
        const count = contacts.filter(c => c.propertyId === selectedLead.id).length;
        return count > 0 ? 'complete' : 'empty';
      }
      case 'vizionaridb': {
        const count = viewings.length;
        return count > 0 ? 'complete' : 'empty';
      }
      default:
        return 'empty';
    }
  };

  const handleUpdate = React.useCallback(async (leadId: string, path: string, val: any) => {
    console.log(`[Home] handleUpdate starting for lead ${leadId}, path: ${path}`, val);
    const now = Date.now();
    lastOptimisticUpdate.current = { id: leadId, time: now };

    // Optimistic update for immediate visual feedback
    if (path.startsWith('crmData.')) {
      const updateFn = (prev: any) => {
        if (!prev) return prev;
        // Surgical shallow clone to preserve methods/Prototypes (like Timestamps)
        const next = { ...prev };
        const nextExtracted = next.extractedData ? { ...next.extractedData } : {};
        
        let current = nextExtracted;
        const parts = path.split('.');
        
        // Navigate and clone each level
        for (let i = 0; i < parts.length - 1; i++) {
          const key = parts[i];
          current[key] = current[key] ? { ...current[key] } : {};
          current = current[key];
        }
        
        // Set final value
        current[parts[parts.length - 1]] = val;
        next.extractedData = nextExtracted;

        // Sync top-level categoria if crmData.detaliiGenerale.categoria is updated
        if (path === 'crmData.detaliiGenerale.categoria') {
          next.categoria = val;
        }
        
        // Sync top-level title if crmData.descriere.titlu is updated
        if (path === 'crmData.descriere.titlu') {
          next.title = val;
        }

        return next;
      };

      setSelectedLead(prev => prev?.id === leadId ? updateFn(prev) : prev);
      setLeads(prev => prev.map(l => l.id === leadId ? updateFn(l) : l));
      console.log(`[Home] Optimistic state updated for ${path}`);
    }

    try {
      if (path === 'crmData.detaliiGenerale.categoria') {
        await leadsService.updateLeadData(leadId, { categoria: val });
      }
      if (path === 'crmData.descriere.titlu') {
        await leadsService.updateLeadData(leadId, { title: val });
      }
      await leadsService.updateNestedField(leadId, `extractedData.${path}`, val);
      console.log(`[Home] Firestore write success for ${path}`);
    } catch (e) {
      console.error('[Home] Firestore write failed:', e);
      // Optional: Rollback if needed, but usually next Firestore sync handles it
    }
  }, []);

  useEffect(() => {
    if (user) {
      void automationSettingsService.fetchTitleRule().catch(() => {});
    }
  }, [user]);

  useEffect(() => {
    if (selectedLead?.id && user) {
      const unsub = viewingsService.subscribeToPropertyViewings(selectedLead.id, (v) => {
        setViewings(v);
      });
      return () => unsub();
    } else {
      setViewings([]);
    }
  }, [selectedLead?.id, user]);

  const triggerExtraction = React.useCallback(async (lead: Lead) => {
    setIsExtracting(true);
    setExtractionStatus("Accesare URL...");
    try {
      console.log(`[Home] Fetching /api/crawl for ${lead.url}`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45000);

      let crawlRes: Response;
      try {
        const crawlHeaders = await getApiAuthHeaders({
          "Content-Type": "application/json",
          "Accept": "application/json"
        });
        const activeTitleRule = automationSettingsService.getCachedTitleRule();
        crawlRes = await fetch("/api/crawl", {
          method: "POST",
          headers: crawlHeaders,
          body: JSON.stringify({ url: lead.url, titleAutomationRule: activeTitleRule }),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeoutId);
      }
      
      const contentType = crawlRes.headers.get("content-type");
      if (!crawlRes.ok || !contentType || !contentType.includes("application/json")) {
        const text = await crawlRes.text();
        if (crawlRes.status >= 500) {
          console.error("Server error response:", text.substring(0, 500));
        } else {
          console.warn("Crawl blocked or unavailable:", crawlRes.status, text.substring(0, 200));
        }
        
        let errorMessage = "Eroare la accesarea URL-ului";
        try {
          const errorJson = JSON.parse(text);
          errorMessage = errorJson.error || errorMessage;
        } catch (e) {
          if (text.includes("<!doctype html>")) {
            errorMessage = "Eroarea serverului (Proxy timeout sau eroare de start). Reîncearcă în câteva secunde.";
          }
        }
        
        throw new Error(errorMessage);
      }

      const crawlData = await crawlRes.json();
      const { text, title, images: rawImages, crmData, zone, price, ownerName, ownerPhone, transactionType, categoria, description } = crawlData;
      console.log(`[Home] Crawler found ${rawImages?.length || 0} raw images`);
      
      setExtractionStatus("Filtrare imagini...");
      // Relaxed image filtering: Ensure all property photos from crawler are retained, only dropping confirmed microscopic tracker pixels (< 40x40)
      const filterImagesBySize = async (urls: string[]): Promise<string[]> => {
        if (!urls || urls.length === 0) return [];
        const filteredUrls: string[] = [];
        
        const checkChunk = async (chunk: string[]) => {
          const promises = chunk.map(url => {
            return new Promise<void>((resolve) => {
              const img = new Image();
              let finished = false;
              const complete = (keep: boolean) => {
                if (finished) return;
                finished = true;
                clearTimeout(timeout);
                if (keep) filteredUrls.push(url);
                resolve();
              };

              const timeout = setTimeout(() => {
                // Relaxed rule: Never drop property images on timeout
                complete(true);
              }, 3000);
              
              img.onload = () => {
                // Relaxed rule: Only discard confirmed tiny tracking pixels/icons (< 40x40)
                if (img.width > 0 && img.height > 0 && img.width < 40 && img.height < 40) {
                  complete(false);
                } else {
                  complete(true);
                }
              };
              img.onerror = () => {
                // Relaxed rule: Never drop property images on proxy or CORS error
                complete(true);
              };
              const normalizedUrl = url.startsWith("//") ? `https:${url}` : url;
              img.src = normalizedUrl.includes("/api/proxy-image")
                ? normalizedUrl
                : `/api/proxy-image?url=${encodeURIComponent(normalizedUrl)}`;
            });
          });
          await Promise.all(promises);
        };
        
        for (let i = 0; i < urls.length; i += 8) {
          await checkChunk(urls.slice(i, i + 8));
        }
        
        return filteredUrls.length > 0 ? filteredUrls : urls;
      };

      const images = await filterImagesBySize(rawImages || []);

      setExtractionStatus("Salvare date...");
      // All crawler images are put in crmData.imagini.alteSpatii so user can categorize them
      const finalCrmData = crmData || {
        detaliiGenerale: {
          stadiu: "Activ - Hot",
          tranzactie: transactionType || "Vânzare",
          categoria: categoria || "Apartament",
          proprietar: ownerName || "Nespecificat",
          contacteAditionale: ownerPhone || "Nespecificat",
          ansambluRezidential: "",
          localizare: { oras: "București", zona: [zone || "București"], strada: "", numar: "", bloc: "", scara: "", apartament: "", puncteInteres: [], imprejurimi: [] },
          memoPrivat: ""
        },
        descriere: {
          titlu: title || "Fără titlu",
          continut: description || text || "",
          disponibilitate: "Imediat",
          video: "",
          turVirtual: ""
        },
        imagini: {
          living: [],
          bucatarie: [],
          camera: [],
          baie: [],
          alteSpatii: []
        }
      };

      if (images && images.length > 0) {
        if (!finalCrmData.imagini) {
          finalCrmData.imagini = { living: [], bucatarie: [], camera: [], baie: [], alteSpatii: [] };
        }
        finalCrmData.imagini.alteSpatii = images.map((img: string) => ({ 
          original: img.startsWith("http") && !img.includes("/api/proxy-image")
            ? `/api/proxy-image?url=${encodeURIComponent(img)}`
            : img 
        }));
      }

      const extraction = {
        crmData: finalCrmData,
        automationSource: crawlData.automationSource || null,
        markdownMarketing: finalCrmData.descriere?.continut || description || "",
        summary: `${categoria || "Proprietate"} în ${zone || "București"}, ${price || "N/A"}`
      };

      const transType = (finalCrmData.detaliiGenerale?.tranzactie || transactionType || "").toLowerCase().includes("inchiriere") 
        ? "Închiriere" 
        : "Vânzare";

      const rawCover = images && images.length > 0 ? images[0] : lead.coverImage;
      const deepCoverImage = rawCover && rawCover.startsWith("http") && !rawCover.includes("/api/proxy-image")
        ? `/api/proxy-image?url=${encodeURIComponent(rawCover)}`
        : rawCover;

      const fallbackRule = automationSettingsService.getCachedTitleRule();
      const finalTitle = finalCrmData.descriere?.titlu || title || generateStandardAdTitle({
        transactionType: transType,
        categoria: categoria || lead.categoria || "Apartament",
        camere: finalCrmData.caracteristici?.detalii?.camere,
        suprafataUtila: finalCrmData.caracteristici?.suprafete?.utila,
        etaj: finalCrmData.caracteristici?.detalii?.etaj,
        zona: zone || lead.zone,
        compartimentare: finalCrmData.caracteristici?.detalii?.compartimentare,
        propertyId: lead.propertyId,
        rawTitle: title,
        rawText: description || text || "",
        titleRule: fallbackRule,
      });
      finalCrmData.descriere.titlu = finalTitle;

      let resolvedPrice = price || lead.price || "N/A";
      if (resolvedPrice !== "N/A" && (resolvedPrice.toLowerCase().includes("ron") || resolvedPrice.toLowerCase().includes("lei"))) {
        const digits = parseFloat(resolvedPrice.replace(/[^0-9.,]/g, "").replace(",", "."));
        if (!isNaN(digits) && digits > 0) {
          const inEur = Math.round(digits / 4.97);
          resolvedPrice = `${inEur.toLocaleString("ro-RO")} €${transType === "Închiriere" ? " / lună" : ""}`;
        }
      }

      const updatedFields = {
        extractedData: extraction,
        categoria: finalCrmData.detaliiGenerale?.categoria || categoria || lead.categoria || "Apartament",
        title: finalTitle,
        price: resolvedPrice,
        ownerName: ownerName || finalCrmData.detaliiGenerale?.proprietar || lead.ownerName || "Nespecificat",
        ownerPhone: ownerPhone || finalCrmData.detaliiGenerale?.contacteAditionale || lead.ownerPhone || "Nespecificat",
        transactionType: transType as "Închiriere" | "Vânzare",
        zone: zone || (finalCrmData.detaliiGenerale?.localizare?.zona?.[0] || lead.zone || "București"),
        coverImage: deepCoverImage
      };

      await leadsService.updateLeadData(lead.id!, updatedFields);
      
      // Update local leads list
      setLeads(prev => prev.map(l => l.id === lead.id ? {
        ...l,
        ...updatedFields
      } : l));
      
      // Update local selected lead to show results
      setSelectedLead(prev => prev?.id === lead.id ? { 
        ...prev, 
        ...updatedFields
      } : prev);

      // Also update selectedCalificatLead state so that the modal stays in sync
      setSelectedCalificatLead(prev => prev?.id === lead.id ? {
        ...prev,
        ...updatedFields
      } : prev);
    } catch (error: any) {
      console.warn("[Home] triggerExtraction error:", error?.message || error);
      const isAbort = error?.name === "AbortError";
      const isFetchError = error instanceof TypeError || error?.message?.includes("fetch");
      if (isAbort) {
        toast.error("Conectarea la site-ul extern a durat prea mult. Verificați link-ul și reîncercați.");
      } else if (isFetchError) {
        toast.error("Eroare de conexiune la server. Verificați link-ul și reîncercați.");
      } else {
        toast.error(error?.message || "Eroare la extracție");
      }
      setExtractionStatus("Eroare la extracție");
    } finally {
      setIsExtracting(false);
      setExtractionStatus("");
    }
  }, []);

  const leadsRef = useRef<Lead[]>([]);
  const olxAutoScanFiltersRef = useRef<OlxLeadFilters>(olxAutoScanFilters);
  const olxScanLimitRef = useRef<number>(olxScanLimit);
  const olxMinAdAgeHoursRef = useRef<number>(olxMinAdAgeHours);
  const olxMaxAdAgeHoursRef = useRef<number>(olxMaxAdAgeHours);
  const isOlxAutoScanningRef = useRef<boolean>(false);
  const seenOlxScanUrlsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    leadsRef.current = leads;
    leads.forEach((l) => {
      if (l.url) seenOlxScanUrlsRef.current.add(l.url.split("?")[0].trim().toLowerCase());
    });
  }, [leads]);

  useEffect(() => {
    olxAutoScanFiltersRef.current = olxAutoScanFilters;
    try {
      localStorage.setItem("brokr_olx_autoscan_filters", JSON.stringify(olxAutoScanFilters));
    } catch {}
  }, [olxAutoScanFilters]);

  useEffect(() => {
    try {
      localStorage.setItem("brokr_olx_scan_interval", String(olxScanIntervalMinutes));
    } catch {}
  }, [olxScanIntervalMinutes]);

  useEffect(() => {
    olxScanLimitRef.current = olxScanLimit;
    try {
      localStorage.setItem("brokr_olx_scan_limit", String(olxScanLimit));
    } catch {}
  }, [olxScanLimit]);

  useEffect(() => {
    olxMinAdAgeHoursRef.current = olxMinAdAgeHours;
    try {
      localStorage.setItem("brokr_olx_min_ad_age_hours", String(olxMinAdAgeHours));
    } catch {}
  }, [olxMinAdAgeHours]);

  useEffect(() => {
    olxMaxAdAgeHoursRef.current = olxMaxAdAgeHours;
    try {
      localStorage.setItem("brokr_olx_max_ad_age_hours", String(olxMaxAdAgeHours));
    } catch {}
  }, [olxMaxAdAgeHours]);

  const runOlxNewAdsScan = React.useCallback(async (isManual = false) => {
    if (isOlxAutoScanningRef.current) return;
    if (!auth.currentUser) return;
    isOlxAutoScanningRef.current = true;
    setIsOlxAutoScanning(true);
    try {
      const authHeaders = await getApiAuthHeaders({ "Content-Type": "application/json" });
      const existingUrls = Array.from(
        new Set([
          ...leadsRef.current.map((l) => l.url).filter(Boolean),
          ...Array.from(seenOlxScanUrlsRef.current),
        ])
      );
      const activeTitleRule = automationSettingsService.getCachedTitleRule();
      const res = await fetch("/api/crawl-olx-leads", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          filters: olxAutoScanFiltersRef.current,
          page: 1,
          existingUrls,
          limit: olxScanLimitRef.current,
          minAgeHours: olxMinAdAgeHoursRef.current,
          maxAgeHours: olxMaxAdAgeHoursRef.current,
          titleAutomationRule: activeTitleRule,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `Eroare HTTP ${res.status}`);
      }

      setLastOlxScanAt(Date.now());
      const crawledItems: any[] = Array.isArray(data?.items) ? data.items : [];
      if (crawledItems.length === 0) {
        setOlxScanIntervalMinutes(0);
        if (data?.warning) {
          setOlxScanNotice({
            type: "error",
            title: "Eroare la scanarea automată OLX.ro",
            message: String(data.warning),
            timestamp: Date.now(),
          });
          if (isManual) {
            toast.error(String(data.warning));
          }
        } else {
          const emptyMsg =
            data?.emptyReason === "all_seen"
              ? "Toate anunțurile de pe OLX.ro care corespund filtrelor autocrawler au fost deja preluate în aplicație."
              : "Nu mai există anunțuri pe OLX.ro care să corespundă filtrelor și intervalului selectat în autocrawler.";
          setOlxScanNotice({
            type: "info",
            title: "Niciun anunț nou potrivit filtrelor autocrawler",
            message: emptyMsg,
            timestamp: Date.now(),
          });
          if (isManual) {
            toast(emptyMsg);
          }
        }
        return;
      }

      const currentUser = auth.currentUser;
      const creatorName = currentUser?.displayName || (currentUser?.email ? currentUser.email.split("@")[0] : "Consilier Imobiliar");
      const creatorEmail = currentUser?.email || "";

      let addedCount = 0;
      const saveErrors: string[] = [];
      for (const item of crawledItems) {
        const cleanKey = String(item.url || "").split("?")[0].trim().toLowerCase();
        if (cleanKey && seenOlxScanUrlsRef.current.has(cleanKey)) continue;
        try {
          await leadsService.addLead({
            url: item.url,
            title: item.title,
            zone: item.zone || "București",
            price: item.price || "N/A",
            ownerName: item.ownerName || "Proprietar OLX",
            ownerPhone: item.ownerPhone || "Nespecificat",
            transactionType: item.transactionType === "Vânzare" ? "Vânzare" : "Închiriere",
            categoria: item.categoria || "Apartament",
            status: "Noi",
            leadType: item.leadType || "Proprietar",
            coverImage: item.coverImage || undefined,
            images: Array.isArray(item.images) ? item.images : [],
            notes: item.notes || "",
            extractedData: item.extractedData || undefined,
            createdByName: creatorName,
            createdByEmail: creatorEmail,
            author: creatorName,
            agent: creatorName,
          });
          if (cleanKey) seenOlxScanUrlsRef.current.add(cleanKey);
          addedCount++;
        } catch (saveErr: any) {
          console.warn("[Home] Failed saving scanned OLX lead:", saveErr);
          saveErrors.push(saveErr?.message || "Eroare la salvarea anunțului în baza de date.");
        }
      }

      if (saveErrors.length > 0 && addedCount === 0) {
        const errMsg = `Nu s-au putut salva anunțurile găsite: ${saveErrors[0]}`;
        setOlxScanIntervalMinutes(0);
        setOlxScanNotice({
          type: "error",
          title: "Eroare la salvarea lead-urilor autocrawler",
          message: errMsg,
          timestamp: Date.now(),
        });
        if (isManual) toast.error(errMsg);
      } else if (saveErrors.length > 0 && addedCount > 0) {
        const partialMsg = `${addedCount} anunțuri salvate, însă ${saveErrors.length} nu au putut fi salvate: ${saveErrors[0]}`;
        setOlxScanIntervalMinutes(0);
        setOlxScanNotice({
          type: "error",
          title: "Eroare parțială la salvarea lead-urilor",
          message: partialMsg,
          timestamp: Date.now(),
        });
        toast.success(`${addedCount} anunțuri noi adăugate în Noi`);
      } else if (addedCount > 0) {
        setOlxScanNotice(null);
        toast.success(`${addedCount} ${addedCount === 1 ? "anunț nou găsit" : "anunțuri noi găsite"} pe OLX.ro și adăugate în Noi`);
      } else {
        const emptyMsg = "Toate anunțurile găsite care corespund filtrelor autocrawler au fost deja preluate anterior.";
        setOlxScanIntervalMinutes(0);
        setOlxScanNotice({
          type: "info",
          title: "Niciun anunț nou potrivit filtrelor autocrawler",
          message: emptyMsg,
          timestamp: Date.now(),
        });
        if (isManual) {
          toast(emptyMsg);
        }
      }
    } catch (err: any) {
      const errMsg = err?.message || "Eroare necunoscută la scanarea anunțurilor de pe OLX.ro";
      setOlxScanIntervalMinutes(0);
      setOlxScanNotice({
        type: "error",
        title: "Eroare autocrawler OLX.ro",
        message: errMsg,
        timestamp: Date.now(),
      });
      if (isManual) {
        toast.error(errMsg);
      } else {
        console.warn("[Home] OLX auto-scan error:", errMsg);
      }
    } finally {
      isOlxAutoScanningRef.current = false;
      setIsOlxAutoScanning(false);
    }
  }, []);

  useEffect(() => {
    if (olxScanIntervalMinutes <= 0) return;
    const intervalMs = olxScanIntervalMinutes * 60 * 1000;
    const timerId = window.setInterval(() => {
      void runOlxNewAdsScan(false);
    }, intervalMs);
    return () => window.clearInterval(timerId);
  }, [olxScanIntervalMinutes, runOlxNewAdsScan]);

  const groupedLeads = React.useMemo(() => {
    const filtered = leads
      .filter(lead => {
        if (activeSidebarItem === 'Cereri') {
          if (!isCerereLead(lead)) return false;
          if (activeTab === 'Noua') {
            return lead.status === 'Noua' || lead.status === 'AreInteres';
          }
          return lead.status === activeTab;
        }
        if (activeSidebarItem === 'Lead-uri') {
          if (isCerereLead(lead)) return false;
          if (lead.status === 'Sterse') return false;
          if (activeTab === 'Pierdute') {
            return lead.status === 'Pierdute';
          }
          // Default tab 'Noi' (includes newly added leads and legacy unpromoted leads)
          return lead.status === 'Noi' || lead.status === 'Nevalidata' || lead.status === 'Calificata';
        }
        // Proprietăți: exclude cereri and non-property items
        if (isCerereLead(lead)) return false;
        if (lead.status === 'Nevalidata' || lead.status === 'Calificata' || lead.status === 'Sterse' || lead.status === 'Noi' || lead.status === 'Pierdute') return false;
        if (activeTab === 'Noua') {
          return lead.status === 'Noua' || lead.status === 'Activa';
        }
        return lead.status === activeTab;
      })
      .filter(lead => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase().trim();
        const titleMatch = (lead.title || "").toLowerCase().includes(q);
        const zoneMatch = (lead.zone || "").toLowerCase().includes(q);
        const priceMatch = (lead.price || "").toLowerCase().includes(q);
        const nameMatch = (lead.ownerName || "").toLowerCase().includes(q);
        const phoneMatch = (lead.ownerPhone || "").toLowerCase().includes(q);
        const idMatch = (lead.propertyId || lead.id || "").toLowerCase().includes(q);
        const catMatch = (lead.categoria || "").toLowerCase().includes(q);
        const notesMatch = (lead.notes || "").toLowerCase().includes(q);
        const urlMatch = (lead.url || "").toLowerCase().includes(q);
        return titleMatch || zoneMatch || priceMatch || nameMatch || phoneMatch || idMatch || catMatch || notesMatch || urlMatch;
      })
      .filter(lead => {
        if (activeSidebarItem === 'Lead-uri') {
          if (leadRoleFilter === 'Toate') return true;
          const r = getLeadRole(lead);
          if (leadRoleFilter === 'Proprietari' || leadRoleFilter === 'Proprietar') return r === 'Proprietar';
          if (leadRoleFilter === 'Cumparatori' || leadRoleFilter === 'Cumparator') return r === 'Cumparator';
          if (leadRoleFilter === 'Chiriasi' || leadRoleFilter === 'Chirias') return r === 'Chirias';
          return true;
        }
        if (transactionFilter === 'Toate') return true;
        const type = String(lead.transactionType || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (!type) return false;

        if (activeSidebarItem === 'Cereri') {
          if (transactionFilter === 'Cumpărare' || (transactionFilter as string) === 'Cumparare' || transactionFilter === 'Vânzare') {
            return type.includes('cump') || type.includes('vanz');
          }
          if (transactionFilter === 'Închiriere' || (transactionFilter as string) === 'Inchiriere') {
            return type.includes('inchir');
          }
        }

        // Imobile / Proprietăți
        if (transactionFilter === 'Închiriere' || (transactionFilter as string) === 'Inchiriere') {
          return type.includes('inchir');
        }
        if (transactionFilter === 'Vânzare' || (transactionFilter as string) === 'Vanzare') {
          return type.includes('vanz');
        }
        return true;
      })
      .filter(lead => {
        if (categoryFilter === 'Toate') return true;
        // Check top-level lead.categoria first, fallback to extractedData
        const leadCat = lead.categoria || lead.extractedData?.crmData?.detaliiGenerale?.categoria;
        if (!leadCat) return false;
        
        // Robust check for singular/plural mismatch
        const normalizedLead = String(leadCat || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const normalizedFilter = String(categoryFilter || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        
        if (normalizedLead === normalizedFilter) return true;
        
        // Basic singular/plural check (e.g., "spatiu comercial" vs "spatii comerciale")
        // This is a bit complex in Romanian, but let's at least handle the common patterns
        const isCommMatch = (normalizedFilter.includes("comercial") && normalizedLead.includes("comercial"));
        const isOfficeMatch = (normalizedFilter.includes("birou") && normalizedLead.includes("birou"));
        const isIndMatch = (normalizedFilter.includes("industrial") && normalizedLead.includes("industrial"));
        const isDepMatch = (normalizedFilter.includes("depozitare") && normalizedLead.includes("depozitare"));
        const isHaleMatch = (normalizedFilter.includes("hale") && normalizedLead.includes("hale"));
        const isAppMatch = (normalizedFilter.includes("apartament") && normalizedLead.includes("apartament"));
        const isHouseMatch = (normalizedFilter.includes("casa") && normalizedLead.includes("casa"));
        const isLandMatch = (normalizedFilter.includes("teren") && normalizedLead.includes("teren"));

        return isCommMatch || isOfficeMatch || isIndMatch || isDepMatch || isHaleMatch || isAppMatch || isHouseMatch || isLandMatch;
      })
      .filter(lead => {
        if (activeSidebarItem === 'Lead-uri' && hasActiveOlxFilters(olxFilters)) {
          return matchesOlxLeadFilter(lead, olxFilters);
        }
        return true;
      });

    const sorted = [...filtered].sort((a, b) => {
      if (sortOption === 'newest') {
        const timeA = a.updatedAt?.toMillis?.() || 0;
        const timeB = b.updatedAt?.toMillis?.() || 0;
        return timeB - timeA;
      }
      if (sortOption === 'oldest') {
        const timeA = a.updatedAt?.toMillis?.() || 0;
        const timeB = b.updatedAt?.toMillis?.() || 0;
        return timeA - timeB;
      }
      if (sortOption === 'expensive') {
        return parsePrice(b.price) - parsePrice(a.price);
      }
      if (sortOption === 'cheap') {
        return parsePrice(a.price) - parsePrice(b.price);
      }
      return 0;
    });

    const groups: { [key: string]: Lead[] } = {};
    
    sorted.forEach(lead => {
      let groupKey = "";
      if (sortOption === 'newest' || sortOption === 'oldest') {
        groupKey = formatDateGroup(lead.updatedAt);
      } else {
        groupKey = getPriceRange(parsePrice(lead.price));
      }

      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(lead);
    });

    return groups;
  }, [leads, activeTab, activeSidebarItem, sortOption, transactionFilter, leadRoleFilter, categoryFilter, searchQuery, olxFilters]);

  const handleLeadClick = React.useCallback((lead: Lead) => {
    closingDetailRouteRef.current = false;

    if (isCerereLead(lead)) {
      setSelectedLead(lead);
      setShowDeleteConfirm(false);
      setIsEditingDetails(false);
      if (lead.id) {
        navigate(`/cereri/${lead.id}`);
      }
      return;
    }

    const isLeadItem =
      activeSidebarItem === 'Lead-uri' ||
      lead.status === "Nevalidata" ||
      lead.status === "Noi" ||
      lead.status === "Pierdute" ||
      lead.status === "Calificata";

    if (isLeadItem) {
      setSelectedLead(lead);
      setShowDeleteConfirm(false);
      setIsEditingDetails(false);
      if (lead.id) {
        navigate(`/leads/${lead.id}`);
      }
      return;
    }

    setSelectedLead(lead);
    setShowDeleteConfirm(false);
    setEditedName(lead.ownerName || "");
    setEditedPhone(lead.ownerPhone || "");
    setEditedPropertyId(lead.propertyId || "");
    setEditedTitle(lead.title || "");
    setEditedZone(lead.zone || "");
    setEditedPrice(lead.price || "");
    setEditedTransactionType(lead.transactionType || "Vânzare");
    setEditedCategoria(lead.categoria || "");
    setIsEditingDetails(false);
    if (location.pathname !== "/") {
      skipRouteClearRef.current = true;
      navigate("/");
    }
  }, [activeSidebarItem, location.pathname, navigate]);

  useEffect(() => {
    setLastVisitedTimes(prev => {
      const updated = { ...prev, [activeTab]: Date.now() };
      localStorage.setItem('lastVisited_tabs', JSON.stringify(updated));
      return updated;
    });
  }, [activeTab, leads]);

  useEffect(() => {
    const checkAutoArchive = async () => {
      const thirtyOneDaysAgo = new Date();
      thirtyOneDaysAgo.setDate(thirtyOneDaysAgo.getDate() - 31);

      const toArchive = leads.filter(lead => {
        if (lead.status === 'Arhiva' || lead.status === 'Sterse') return false;
        
        // Ensure we have valid timestamps before checking age
        // serverTimestamp() returns null or a FieldValue proxy initially in local state
        if (!lead.createdAt && !lead.updatedAt) return false;

        // Use createdAt as requested by user. Fallback to updatedAt if missing.
        let effectiveDate: Date | null = null;
        
        if (lead.createdAt) {
          if (lead.createdAt.toDate) effectiveDate = lead.createdAt.toDate();
          else if (typeof lead.createdAt.toMillis === 'function') effectiveDate = new Date(lead.createdAt.toMillis());
          else if (lead.createdAt instanceof Date) effectiveDate = lead.createdAt;
          else if (typeof lead.createdAt === 'string' || typeof lead.createdAt === 'number') effectiveDate = new Date(lead.createdAt);
        }
        
        if (!effectiveDate && lead.updatedAt) {
          if (lead.updatedAt.toDate) effectiveDate = lead.updatedAt.toDate();
          else if (typeof lead.updatedAt.toMillis === 'function') effectiveDate = new Date(lead.updatedAt.toMillis());
          else if (lead.updatedAt instanceof Date) effectiveDate = lead.updatedAt;
          else if (typeof lead.updatedAt === 'string' || typeof lead.updatedAt === 'number') effectiveDate = new Date(lead.updatedAt);
        }

        // If date is still invalid or null, skip (it's likely a pending server timestamp)
        if (!effectiveDate || isNaN(effectiveDate.getTime())) return false;

        return effectiveDate < thirtyOneDaysAgo;
      });

      for (const lead of toArchive) {
        try {
          await leadsService.updateLeadStatus(lead.id!, 'Arhiva');
          toast.success(`Proprietatea "${lead.title}" a fost mutată automat în Arhivă după 31 de zile.`);
        } catch (e) {
          console.error("Auto-archive failed for", lead.id, e);
        }
      }
    };

    if (leads.length > 0) {
      checkAutoArchive();
    }
  }, [leads]);

  useEffect(() => {
    if (user) {
      const unsubLeads = leadsService.subscribeToLeads((updatedLeads) => {
        setLeads(updatedLeads);
      });
      const unsubContacts = contactsService.subscribeToContacts((updatedContacts) => {
        setContacts(updatedContacts);
      });
      const unsubPersonal = personalService.subscribeToPersonal((updatedPersonal) => {
        setPersonal(updatedPersonal);
      });
      const unsubNotifications = notificationsService.getNotifications((updatedNotifications) => {
        setNotifications(updatedNotifications);
      });
      return () => {
        unsubLeads();
        unsubContacts();
        unsubPersonal();
        unsubNotifications();
      };
    } else {
      setLeads([]);
      setContacts([]);
      setPersonal([]);
    }
  }, [user]);

  const selectedLeadIdRef = useRef<string | undefined>(selectedLead?.id);
  selectedLeadIdRef.current = selectedLead?.id;

  useEffect(() => {
    const leadMatch = matchPath("/leads/:id", location.pathname);
    const cerereMatch = matchPath("/cereri/:id", location.pathname);
    const targetId = leadMatch?.params?.id || cerereMatch?.params?.id;

    if (targetId) {
      if (closingDetailRouteRef.current) {
        prevPathnameRef.current = location.pathname;
        return;
      }

      if (leadMatch) {
        setActiveSidebarItem("Lead-uri");
        setActiveTab((prev) => (prev === "Noi" || prev === "Pierdute" ? prev : "Noi"));
      } else if (cerereMatch) {
        setActiveSidebarItem("Cereri");
        setActiveTab((prev) => (CERERI_TABS.includes(prev) ? prev : "Noua"));
      }

      const found = leads.find((l) => l.id === targetId);
      if (found) {
        if (selectedLeadIdRef.current !== found.id) {
          setSelectedLead(found);
          setIsEditingDetails(false);
          setShowDeleteConfirm(false);
        }
      } else if (user) {
        let cancelled = false;
        void leadsService.getLead(targetId).then((fetched) => {
          if (!cancelled && fetched && !closingDetailRouteRef.current) {
            setSelectedLead(fetched);
            setIsEditingDetails(false);
            setShowDeleteConfirm(false);
          }
        });
        return () => {
          cancelled = true;
        };
      }
    } else {
      closingDetailRouteRef.current = false;
      if (skipRouteClearRef.current) {
        skipRouteClearRef.current = false;
      } else if (
        location.pathname === "/" &&
        (prevPathnameRef.current.startsWith("/leads/") || prevPathnameRef.current.startsWith("/cereri/"))
      ) {
        setSelectedLead(null);
        setShowDeleteConfirm(false);
        setIsEditingDetails(false);
      }
    }

    prevPathnameRef.current = location.pathname;
  }, [location.pathname, leads, user]);

  useEffect(() => {
    if (selectedLead && leads.length > 0) {
      const currentLead = leads.find(l => l.id === selectedLead.id);
      if (currentLead) {
        // Skip sync if we just did an optimistic update on this lead in the last 10 seconds
        // Increased from 5s to 10s to be very safe against slow Firestore propagation
        if (lastOptimisticUpdate.current?.id === selectedLead.id && (Date.now() - lastOptimisticUpdate.current.time < 10000)) {
          // Still check if it's the SAME lead ID, if not, we should probably allow sync
          return;
        }

        // Simple comparison of stable fields to avoid Timestamp serialization mismatches
        const leadCompare = { ...currentLead, createdAt: null, updatedAt: null, lastMovedAt: null };
        const selectedCompare = { ...selectedLead, createdAt: null, updatedAt: null, lastMovedAt: null };
        
        if (JSON.stringify(leadCompare) !== JSON.stringify(selectedCompare)) {
          console.log('[Home] Syncing selectedLead from leads array (mismatch found)', { leadCompare, selectedCompare });
          setSelectedLead(currentLead);
          if (!isEditingDetails) {
            setEditedName(currentLead.ownerName || "");
            setEditedPhone(currentLead.ownerPhone || "");
            setEditedPropertyId(currentLead.propertyId || "");
            setEditedTitle(currentLead.title || "");
            setEditedZone(currentLead.zone || "");
            setEditedPrice(currentLead.price || "");
            setEditedTransactionType(currentLead.transactionType || "Vânzare");
            setEditedCategoria(currentLead.categoria || "");
          }
        }
      }
    }
  }, [leads, selectedLead?.id]);

  const handleLogin = async () => {
    try {
      setLoginError(null);
      await loginWithGoogle();
    } catch (error: any) {
      console.error("Login failed:", error);
      setLoginError(error?.message || String(error));
    }
  };

  if (authLoading || isTenantLoading) {
    return (
      <div className="min-h-screen bg-[#f9fafb] flex flex-col items-center justify-center p-6 select-none">
        <div className="flex flex-col items-center">
          <div className="w-12 h-12 rounded-lg bg-white border border-gray-200 flex items-center justify-center mb-4 shadow-2xs">
            <span className="font-title text-2xl font-semibold tracking-tight text-[#051D35]">
              b<span className="text-[#BE9662]">.</span>
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold text-gray-700 mb-1">
            <Loader2 size={15} className="animate-spin text-[#BE9662]" />
            <span>Se inițializează brokr...</span>
          </div>
          <p className="text-[11px] text-gray-400 font-medium">Sistem CRM & Extracție Date Imobiliare</p>
        </div>
      </div>
    );
  }

  if (isAccessDenied && user) {
    return (
      <div className="min-h-screen bg-[#f9fafb] flex flex-col items-center justify-center p-6 text-center select-none">
        <div className="w-full max-w-sm bg-white border border-gray-200 rounded-lg p-8 shadow-sm flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-lg bg-red-50 border border-red-200 flex items-center justify-center mb-5 text-red-600 shadow-2xs">
            <ShieldAlert size={28} />
          </div>
          <h2 className="font-title text-xl font-semibold tracking-tight text-gray-900 mb-2">
            Acces Restricționat
          </h2>
          <p className="text-xs text-gray-600 leading-relaxed mb-6 font-normal">
            {accessDeniedReason || "Nu aveți calitatea de membru activ în această agenție."}
          </p>
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={() => logout()}
            className="w-full h-10 bg-[#051D35] hover:bg-[#0a2b4a] text-white transition-colors rounded-md font-semibold text-xs flex items-center justify-center gap-2 cursor-pointer shadow-2xs"
          >
            Deconectare / Schimbă contul
          </motion.button>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#f9fafb] flex flex-col items-center justify-center p-6 text-center select-none">
        <div className="w-full max-w-sm bg-white border border-gray-200 rounded-lg p-8 shadow-sm flex flex-col items-center text-center">
          {/* Logo Badge */}
          <div className="w-14 h-14 rounded-lg bg-[#051D35]/5 border border-[#051D35]/15 flex items-center justify-center mb-5 text-[#BE9662] shadow-2xs">
            <Zap size={28} fill="currentColor" />
          </div>

          {/* Heading */}
          <div className="mb-6">
            <h1 className="font-title text-3xl font-semibold tracking-tight text-gray-900">
              brokr<span className="ml-[-1px] text-[#BE9662]">.</span>
            </h1>
            <p className="mt-2 text-xs text-gray-500 font-normal max-w-xs mx-auto leading-relaxed">
              Extracție de date imobiliare asistată de AI și gestiune de portofoliu.
            </p>
          </div>

          {/* Login Button */}
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={handleLogin}
            className="w-full h-10 bg-[#051D35] hover:bg-[#0a2b4a] text-white transition-colors rounded-md font-semibold text-xs flex items-center justify-center gap-3 shadow-2xs cursor-pointer"
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            <span>Autentificare cu Google</span>
          </motion.button>

          {/* Login Error / Configuration Assistant */}
          {loginError && (
            <div className="mt-6 p-4 bg-red-50/70 border border-red-200 rounded-lg text-left w-full text-xs text-red-800">
              {loginError.includes("auth/configuration-not-found") ? (
                <>
                  <h3 className="font-title font-semibold text-red-900 mb-2 text-xs">Eroare de configurare Firebase</h3>
                  <p className="mb-2 text-red-700 leading-relaxed text-[11px]">
                    Furnizorul <strong>Google Sign-In</strong> nu este activat în proiectul Firebase <strong>brokr-42038</strong>.
                  </p>
                  <ol className="list-decimal pl-4 space-y-1 text-red-700 text-[11px]">
                    <li>
                      Accesați:{" "}
                      <a
                        href="https://console.firebase.google.com/project/brokr-42038/authentication"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline font-semibold text-red-600 hover:text-red-950"
                      >
                        Consola Firebase Auth
                      </a>
                    </li>
                    <li>Activați furnizorul <strong>Google</strong> în tab-ul Sign-in method.</li>
                    <li>Reveniți și reîncercați autentificarea.</li>
                  </ol>
                </>
              ) : loginError.includes("auth/unauthorized-domain") ? (
                <>
                  <h3 className="font-title font-semibold text-red-900 mb-1 text-xs">Domeniu neautorizat (Unauthorized Domain)</h3>
                  <p className="mb-2 text-red-700 text-[11px] leading-relaxed">
                    Adăugați domeniul curent în lista <strong>Authorized domains</strong> din Firebase:
                  </p>
                  <div className="space-y-2 text-[11px] text-red-900 mb-2 tabular-nums">
                    <div className="flex justify-between items-center bg-white px-2 py-2 rounded-md border border-gray-200">
                      <span className="font-normal truncate">{window.location.hostname}</span>
                      <button
                        onClick={() => handleCopyDomain(window.location.hostname)}
                        className="p-1 hover:bg-gray-100 rounded text-gray-500 hover:text-gray-900"
                        title="Copiază"
                      >
                        {copiedDomain === window.location.hostname ? (
                          <Check size={13} className="text-emerald-600 font-semibold" />
                        ) : (
                          <Copy size={13} />
                        )}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <h3 className="font-title font-semibold text-red-900 mb-1 text-xs">Eroare la autentificare</h3>
                  <p className="text-red-700 text-[11px]">{loginError}</p>
                </>
              )}
            </div>
          )}

          {/* Card footer */}
          <div className="mt-6 pt-5 border-t border-gray-100 w-full flex items-center justify-between text-[11px] text-gray-400">
            <span>Securizat prin Google Identity</span>
            <span className="text-[10px] tabular-nums">v2.4</span>
          </div>
        </div>
      </div>
    );
  }

  const updateDescriptionId = (text: string, newId: string): string => {
    if (!text) return "";
    const lines = text.split("\n");
    const updatedLines = lines.map(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith("📌 ID Proprietate:")) {
        return `📌 ID Proprietate: ${newId}`;
      }
      if (trimmed.startsWith("📌 ID")) {
        return `📌 ID ${newId}`;
      }
      return line;
    });
    return updatedLines.join("\n");
  };

  const handleSaveDetails = async () => {
    if (!selectedLead?.id) return;
    try {
      let updatedExtractedData = undefined;
      if (selectedLead.extractedData) {
        updatedExtractedData = { ...selectedLead.extractedData };
        if (updatedExtractedData.crmData?.descriere) {
          updatedExtractedData.crmData.descriere = {
            ...updatedExtractedData.crmData.descriere,
            continut: updateDescriptionId(updatedExtractedData.crmData.descriere.continut || "", editedPropertyId)
          };
        }
        if (updatedExtractedData.markdownMarketing) {
          updatedExtractedData.markdownMarketing = updateDescriptionId(updatedExtractedData.markdownMarketing, editedPropertyId);
        }
      }

      const updatePayload: any = {
        ownerName: editedName,
        ownerPhone: editedPhone,
        propertyId: editedPropertyId,
        title: editedTitle,
        zone: editedZone,
        price: editedPrice,
        transactionType: editedTransactionType,
        categoria: editedCategoria,
      };

      if (updatedExtractedData) {
        updatePayload.extractedData = updatedExtractedData;
      }

      await leadsService.updateLeadData(selectedLead.id, updatePayload);

      setSelectedLead(prev => {
        if (!prev) return null;
        return { 
          ...prev, 
          ownerName: editedName, 
          ownerPhone: editedPhone,
          propertyId: editedPropertyId,
          title: editedTitle,
          zone: editedZone,
          price: editedPrice,
          transactionType: editedTransactionType,
          categoria: editedCategoria,
          ...(updatedExtractedData ? { extractedData: updatedExtractedData } : {})
        };
      });

      setLeads(prev => prev.map(l => {
        if (l.id === selectedLead.id) {
          return {
            ...l,
            ownerName: editedName, 
            ownerPhone: editedPhone,
            propertyId: editedPropertyId,
            title: editedTitle,
            zone: editedZone,
            price: editedPrice,
            transactionType: editedTransactionType,
            categoria: editedCategoria,
            ...(updatedExtractedData ? { extractedData: updatedExtractedData } : {})
          };
        }
        return l;
      }));

      setIsEditingDetails(false);
    } catch (error) {
      console.error("Failed to save lead details:", error);
    }
  };

  const handleCloseDetails = () => {
    closingDetailRouteRef.current = true;
    setShowDeleteConfirm(false);
    setIsEditingDetails(false);
    setSelectedLead(null);
    if (location.pathname !== "/") {
      navigate("/");
    }
  };

  const updateStatus = async (leadId: string, newStatus: LeadStatus) => {
    try {
      // Set optimistic guard
      lastOptimisticUpdate.current = { id: leadId, time: Date.now() };

      // Update local state first for immediate feedback
      setSelectedLead(prev => prev ? { ...prev, status: newStatus } : null);
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: newStatus } : l));
      await leadsService.updateLeadData(leadId, {
        ownerName: editedName,
        ownerPhone: editedPhone,
        propertyId: editedPropertyId,
        title: editedTitle,
        zone: editedZone,
        price: editedPrice,
        transactionType: editedTransactionType,
        status: newStatus,
        lastMovedAt: new Date()
      });
    } catch (error) {
      console.error("Failed to update status:", error);
    }
  };

  const handleDeleteLead = async () => {
    if (!selectedLead?.id) return;
    try {
      closingDetailRouteRef.current = true;
      await leadsService.deleteLead(selectedLead.id);
      setSelectedLead(null);
      setShowDeleteConfirm(false);
      if (location.pathname !== "/") {
        navigate("/");
      }
    } catch (error) {
      console.error("Failed to delete lead:", error);
      toast.error("Eroare la ștergere. Verifică permisiunile.");
    }
  };

  const handleSaveNevalidatLead = async (leadId: string, updatedData: Partial<Lead>) => {
    try {
      await leadsService.updateLeadData(leadId, updatedData);
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, ...updatedData } : l));
    } catch (e) {
      console.error("Failed to save nevalidat lead:", e);
      throw e;
    }
  };

  const handleConvertToImobil = async (leadId: string, updatedData: Partial<Lead>) => {
    try {
      const newPropId = await entityIdService.getNextId('property');
      const leadObj = leads.find(l => l.id === leadId);
      const mergedLead = { ...leadObj, ...updatedData };
      const crmData = mergedLead.extractedData?.crmData;
      const category = mergedLead.categoria || crmData?.detaliiGenerale?.categoria || "Apartament";
      const transactionType = mergedLead.transactionType || crmData?.detaliiGenerale?.tranzactie || "Vânzare";
      const zoneVal = crmData?.detaliiGenerale?.localizare?.zona || mergedLead.zone || "București";
      const zone = Array.isArray(zoneVal) ? zoneVal[0] : (zoneVal || "București");
      const price = mergedLead.price || crmData?.pret?.detalii?.pret || "";
      const specs = crmData?.caracteristici || {};
      const originalTitle = mergedLead.title || crmData?.descriere?.titlu || "";
      const originalDescription = mergedLead.extractedData?.markdownMarketing || crmData?.descriere?.continut || "";

      let formattedTitle = originalTitle;
      let formattedDescription = originalDescription;

      try {
        const aiHeaders = await getApiAuthHeaders({ "Content-Type": "application/json" });
        const aiRes = await fetch("/api/generate-ai-text", {
          method: "POST",
          headers: aiHeaders,
          body: JSON.stringify({
            category,
            transactionType,
            zone,
            price,
            specs,
            originalTitle,
            originalDescription,
            propertyId: newPropId
          })
        });
        if (aiRes.ok) {
          const aiJson = await aiRes.json();
          if (aiJson.title) formattedTitle = aiJson.title;
          if (aiJson.description) formattedDescription = aiJson.description;
        }
      } catch (err) {
        console.warn("AI formatting on convert to imobil failed:", err);
      }

      const updatedCrmData = crmData ? {
        ...crmData,
        descriere: {
          disponibilitate: crmData.descriere?.disponibilitate || "",
          video: crmData.descriere?.video || "",
          turVirtual: crmData.descriere?.turVirtual || "",
          ...(crmData.descriere || {}),
          titlu: formattedTitle,
          continut: formattedDescription
        }
      } : null;

      const finalPayload: Partial<Lead> = {
        ...updatedData,
        propertyId: newPropId,
        title: formattedTitle,
        status: "Noua" as LeadStatus,
        lastMovedAt: new Date(),
        extractedData: mergedLead.extractedData ? {
          ...mergedLead.extractedData,
          crmData: updatedCrmData,
          markdownMarketing: formattedDescription,
          summary: formattedDescription.substring(0, 300)
        } : updatedData.extractedData
      };

      await leadsService.updateLeadData(leadId, finalPayload);
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, ...finalPayload } : l));
      toast.success(`Leadul a fost concretizat în Imobilul #${newPropId} cu titlul și descrierea formatate!`);
    } catch (e) {
      console.error("Failed to convert lead to imobil:", e);
      toast.error("Eroare la crearea imobilului!");
      throw e;
    }
  };

  const handleConvertToCerere = async (leadId: string, updatedData: Partial<Lead>) => {
    try {
      const newCerereId = await entityIdService.getNextId('cerere');
      const finalPayload: Partial<Lead> = {
        ...updatedData,
        propertyId: newCerereId,
        status: "Noua" as LeadStatus,
        title: updatedData.title?.toLowerCase().startsWith('cerere') ? updatedData.title : `Cerere: ${updatedData.title || 'Proprietate'}`,
        lastMovedAt: new Date()
      };
      await leadsService.updateLeadData(leadId, finalPayload);
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, ...finalPayload } : l));
      toast.success(`Leadul a fost concretizat în Cererea #${newCerereId}!`);
    } catch (e) {
      console.error("Failed to convert lead to cerere:", e);
      toast.error("Eroare la crearea cererii!");
      throw e;
    }
  };

  const handleMarkAsLost = async (leadId: string) => {
    try {
      await leadsService.updateLeadStatus(leadId, 'Pierdute');
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: 'Pierdute' } : l));
      toast.success("Leadul a fost marcat ca Pierdut.");
    } catch (e) {
      console.error("Failed to mark lead as lost:", e);
      toast.error("Eroare la mutarea în Pierdute!");
      throw e;
    }
  };

  const handleReactivateLead = async (leadId: string) => {
    try {
      await leadsService.updateLeadStatus(leadId, 'Noi');
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: 'Noi' } : l));
      toast.success("Leadul a fost reactivat ca Nou.");
    } catch (e) {
      console.error("Failed to reactivate lead:", e);
      toast.error("Eroare la reactivarea leadului!");
      throw e;
    }
  };

  const handleMoveToCalificata = async (leadId: string, updatedData: Partial<Lead>) => {
    try {
      const finalPayload = {
        ...updatedData,
        status: "Calificata" as LeadStatus,
        lastMovedAt: new Date()
      };
      await leadsService.updateLeadData(leadId, finalPayload);
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, ...finalPayload } : l));
    } catch (e) {
      console.error("Failed to move lead to calificata:", e);
      throw e;
    }
  };

  const handleDeleteNevalidatLead = async (leadId: string) => {
    try {
      await leadsService.deleteLead(leadId);
      setLeads(prev => prev.filter(l => l.id !== leadId));
    } catch (e) {
      console.error("Failed to delete lead:", e);
      throw e;
    }
  };

  const handleActivateCalificatLead = async (leadId: string) => {
    try {
      const leadObj = leads.find(l => l.id === leadId);
      let newPropId = leadObj?.propertyId;
      if (!newPropId) {
        newPropId = await entityIdService.getNextId('property');
      }

      const crmData = leadObj?.extractedData?.crmData;
      const category = leadObj?.categoria || crmData?.detaliiGenerale?.categoria || "Apartament";
      const transactionType = leadObj?.transactionType || crmData?.detaliiGenerale?.tranzactie || "Vânzare";
      const zoneVal = crmData?.detaliiGenerale?.localizare?.zona || leadObj?.zone || "București";
      const zone = Array.isArray(zoneVal) ? zoneVal[0] : (zoneVal || "București");
      const price = leadObj?.price || crmData?.pret?.detalii?.pret || "";
      const specs = crmData?.caracteristici || {};
      const originalTitle = leadObj?.title || crmData?.descriere?.titlu || "";
      const originalDescription = leadObj?.extractedData?.markdownMarketing || crmData?.descriere?.continut || "";

      let formattedTitle = originalTitle;
      let formattedDescription = originalDescription;

      try {
        const aiHeaders = await getApiAuthHeaders({ "Content-Type": "application/json" });
        const aiRes = await fetch("/api/generate-ai-text", {
          method: "POST",
          headers: aiHeaders,
          body: JSON.stringify({
            category,
            transactionType,
            zone,
            price,
            specs,
            originalTitle,
            originalDescription,
            propertyId: newPropId
          })
        });
        if (aiRes.ok) {
          const aiJson = await aiRes.json();
          if (aiJson.title) formattedTitle = aiJson.title;
          if (aiJson.description) formattedDescription = aiJson.description;
        }
      } catch (err) {
        console.warn("AI formatting on activate qualified lead failed:", err);
      }

      const updatedCrmData = crmData ? {
        ...crmData,
        descriere: {
          disponibilitate: crmData.descriere?.disponibilitate || "",
          video: crmData.descriere?.video || "",
          turVirtual: crmData.descriere?.turVirtual || "",
          ...(crmData.descriere || {}),
          titlu: formattedTitle,
          continut: formattedDescription
        }
      } : null;

      const finalPayload: Partial<Lead> = {
        propertyId: newPropId,
        title: formattedTitle,
        status: "Noua" as LeadStatus,
        lastMovedAt: new Date(),
        extractedData: leadObj?.extractedData ? {
          ...leadObj.extractedData,
          crmData: updatedCrmData,
          markdownMarketing: formattedDescription,
          summary: formattedDescription.substring(0, 300)
        } : undefined
      };

      await leadsService.updateLeadData(leadId, finalPayload);
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, ...finalPayload } : l));
      toast.success(`Leadul calificat a fost activat ca Imobil #${newPropId}!`);
    } catch (e) {
      console.error("Failed to activate lead:", e);
      toast.error("Eroare la activarea leadului!");
      throw e;
    }
  };

  const handleDeleteCalificatLead = async (leadId: string) => {
    try {
      await leadsService.deleteLead(leadId);
      setLeads(prev => prev.filter(l => l.id !== leadId));
    } catch (e) {
      console.error("Failed to delete lead:", e);
      throw e;
    }
  };

  const handleOpenFullFormFromCalificat = () => {
    if (selectedCalificatLead) {
      const lead = selectedCalificatLead;
      setSelectedCalificatLead(null);
      setTimeout(() => {
        setSelectedLead(lead);
        setShowDeleteConfirm(false);
        setEditedName(lead.ownerName || "");
        setEditedPhone(lead.ownerPhone || "");
        setEditedPropertyId(lead.propertyId || "");
        setEditedTitle(lead.title || "");
        setEditedZone(lead.zone || "");
        setEditedPrice(lead.price || "");
        setEditedTransactionType(lead.transactionType || "Vânzare");
        setEditedCategoria(lead.categoria || "");
        setIsEditingDetails(false);
      }, 100);
    }
  };

  return (
    <div className="h-full w-full flex flex-row overflow-hidden bg-gray-50">
      <Sidebar 
        activeSubItem={activeSidebarItem}
        onSelectItem={handleSelectSidebarItem}
        leads={leads}
        contacts={contacts}
        personal={personal}
      />
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden relative">
        <Header 
          onAddClick={() => setIsModalOpen(true)} 
          onAddLeadClick={() => setIsModalOpen(true)}
          onAddCerereClick={() => setIsCerereModalOpen(true)}
          onAddContactClick={() => setIsContactModalOpen(true)}
          onAddClientClick={() => setIsContactModalOpen(true)}
          onAddPersonalClick={() => setActiveSidebarItem('Personal')}
          onAddStaffClick={() => setActiveSidebarItem('Personal')}
          onAddDocumentClick={() => setIsDocumentModalOpen(true)}
          onAddActivityClick={() => setIsActivityModalOpen(true)}
          onAddTourClick={() => setIsActivityModalOpen(true)}
          onNotificationsClick={() => setIsNotificationsOpen(true)} 
          onExtractionRulesClick={() => setIsExtractionRulesOpen(true)}
          onSelectLead={handleLeadClick}
          onSelectContact={(c) => {
            setSelectedContact(c);
            setActiveSidebarItem('Contacte');
          }}
          onSelectPersonal={(_p) => {
            setActiveSidebarItem('Personal');
          }}
          onSelectActivity={() => handleSelectSidebarItem('Calendar')}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />

        <div className="flex-1 min-h-0 relative overflow-hidden">
          {/* Layer 1: Always-mounted List View (slides left -100% when covered, pushes details right when returning) */}
          <motion.div
            initial={false}
            animate={{ x: (selectedLead || selectedContact) ? "-100%" : "0%" }}
            transition={pageSlideTransition}
            className={`absolute inset-0 w-full h-full flex flex-col bg-gray-50 overflow-hidden ${
              (selectedLead || selectedContact) ? "pointer-events-none" : ""
            }`}
          >
            {activeSidebarItem === 'Clienți' || activeSidebarItem === 'Contacte' ? (
              <ContactsView 
                contacts={contacts}
                onAddContactClick={() => setIsContactModalOpen(true)}
                onContactClick={(contact) => setSelectedContact(contact)}
                onSelectProperty={(propId) => {
                  const lead = leads.find(l => l.propertyId === propId || l.id === propId);
                  if (lead) {
                    handleLeadClick(lead);
                  }
                }}
              />
            ) : activeSidebarItem === 'Personal' ? (
              <PersonalView 
                personal={personal}
              />
            ) : activeSidebarItem === 'Calendar' ? (
              <CalendarView
                leads={leads}
                contacts={contacts}
                onAddActivityClick={(defaultDate, defaultHour) => {
                  setActivityDefaultDate(defaultDate || "");
                  setActivityDefaultHour(defaultHour || "");
                  setIsActivityModalOpen(true);
                }}
              />
            ) : (
              <>
                {/* Top Header / Action Bar (matching Clienți style) */}
                <div className="bg-white border-b border-gray-200 shrink-0 h-[42px] min-h-[42px] max-h-[42px] box-border px-6 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="flex items-center justify-center shrink-0">
                      {sectionHeaderInfo.icon}
                    </span>
                    <div className="flex items-center gap-2 min-w-0">
                      <h2 className="font-title text-[15px] font-semibold tracking-tight text-[#051D35] truncate leading-tight">
                        {sectionHeaderInfo.title}
                      </h2>
                      <span className="text-[11px] font-normal text-gray-500 bg-gray-100 px-2 py-0.5 rounded tabular-nums leading-none shrink-0">
                        {sectionHeaderInfo.count} total
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {/* In-page Quick Search */}
                    <div className="relative w-56 sm:w-64">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={sectionHeaderInfo.searchPlaceholder}
                        className="w-full h-8 pl-9 pr-7 text-xs font-normal bg-gray-50 border border-gray-200 rounded-md placeholder:text-gray-400 focus:outline-none focus:bg-white focus:border-gray-400 transition-colors font-sans"
                      />
                      {searchQuery && (
                        <button
                          type="button"
                          onClick={() => setSearchQuery("")}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer"
                          title="Șterge căutarea"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>

                    {/* Action buttons per section */}
                    {activeSidebarItem === 'Lead-uri' && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setOlxDrawerMode((prev) => (prev === "autoScan" ? null : "autoScan"))}
                          title={
                            olxScanIntervalMinutes > 0
                              ? `Scanare automată OLX.ro activă (la ${olxScanIntervalMinutes} min)`
                              : "Scanare automată OLX.ro (timer)"
                          }
                          className={`relative h-8 px-3 flex items-center gap-2 text-xs font-semibold rounded-md border transition-colors cursor-pointer shrink-0 shadow-xs ${
                            olxDrawerMode === "autoScan"
                              ? "bg-gray-100 text-[#051D35] border-gray-300"
                              : "bg-white hover:bg-gray-50 text-[#051D35] border-gray-200 hover:border-gray-300"
                          }`}
                        >
                          <Timer size={14} className={olxScanIntervalMinutes > 0 ? "text-[#BE9662]" : "text-gray-500"} />
                          <span>Auto Crawl</span>
                          {olxScanIntervalMinutes > 0 && (
                            <span className="w-2 h-2 rounded-full bg-emerald-500 border border-white shrink-0" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsModalOpen(true)}
                          className="h-8 px-3 flex items-center gap-2 text-xs font-semibold bg-[#051D35] hover:bg-[#0a2b4a] text-white rounded-md transition-colors cursor-pointer shrink-0 shadow-xs"
                        >
                          <Plus size={14} className="text-[#BE9662]" />
                          <span>Adaugă Lead</span>
                        </button>
                      </div>
                    )}

                    {(activeSidebarItem === 'Proprietati' || activeSidebarItem === 'Imobile' || activeSidebarItem === 'Proprietăți') && (
                      <button
                        type="button"
                        onClick={() => setIsModalOpen(true)}
                        className="h-8 px-3 flex items-center gap-2 text-xs font-semibold bg-[#051D35] hover:bg-[#0a2b4a] text-white rounded-md transition-colors cursor-pointer shrink-0 shadow-xs"
                      >
                        <Plus size={14} className="text-[#BE9662]" />
                        <span>Adaugă Proprietate</span>
                      </button>
                    )}

                    {activeSidebarItem === 'Cereri' && (
                      <button
                        type="button"
                        onClick={() => setIsCerereModalOpen(true)}
                        className="h-8 px-3 flex items-center gap-2 text-xs font-semibold bg-[#051D35] hover:bg-[#0a2b4a] text-white rounded-md transition-colors cursor-pointer shrink-0 shadow-xs"
                      >
                        <Plus size={14} className="text-[#BE9662]" />
                        <span>Adaugă Cerere</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Sub-header Filter Tabs / Menu (same style as Clienți) */}
                <div className="bg-transparent border-b border-gray-200 shrink-0 px-6 h-[42px] min-h-[42px] max-h-[42px] box-border flex items-center justify-between gap-4 overflow-x-auto no-scrollbar">
                  {/* Left: Filter Tabs with counts */}
                  <div className="flex items-center gap-2 shrink-0">
                    {sectionTabs.map((tab) => {
                      const tabCount = leads.filter(l => {
                        if (activeSidebarItem === 'Lead-uri') {
                          if (isCerereLead(l)) return false;
                          if (l.status === 'Sterse') return false;
                          if (tab === 'Pierdute') return l.status === 'Pierdute';
                          return l.status === 'Noi' || l.status === 'Nevalidata' || l.status === 'Calificata';
                        }
                        if (activeSidebarItem === 'Cereri') {
                          if (!isCerereLead(l)) return false;
                          if (tab === 'Noua') return l.status === 'Noua' || l.status === 'AreInteres';
                          return l.status === tab;
                        }
                        // Proprietăți
                        if (isCerereLead(l)) return false;
                        if (l.status === 'Nevalidata' || l.status === 'Calificata' || l.status === 'Sterse' || l.status === 'Noi' || l.status === 'Pierdute') return false;
                        if (tab === 'Noua') return l.status === 'Noua' || l.status === 'Activa';
                        return l.status === tab;
                      }).length;

                      const hasNew = leads.some(lead => {
                        let isMatch = false;
                        if (activeSidebarItem === 'Lead-uri') {
                          isMatch = !isCerereLead(lead) && lead.status !== 'Sterse' && (tab === 'Pierdute' ? lead.status === 'Pierdute' : (lead.status === 'Noi' || lead.status === 'Nevalidata' || lead.status === 'Calificata'));
                        } else if (activeSidebarItem === 'Cereri') {
                          isMatch = isCerereLead(lead) && (tab === 'Noua' ? lead.status === 'Noua' || lead.status === 'AreInteres' : lead.status === tab);
                        } else {
                          isMatch = !isCerereLead(lead) && lead.status !== 'Nevalidata' && lead.status !== 'Calificata' && lead.status !== 'Sterse' && lead.status !== 'Noi' && lead.status !== 'Pierdute' && (tab === 'Noua' ? lead.status === 'Noua' || lead.status === 'Activa' : lead.status === tab);
                        }
                        if (!isMatch) return false;
                        const itemTime = getTimestampMs(lead.lastMovedAt) || getTimestampMs(lead.updatedAt) || getTimestampMs(lead.createdAt);
                        return tab !== activeTab && itemTime > (lastVisitedTimes[tab] || 0);
                      });
                      const isSelected = activeTab === tab;

                      return (
                        <button
                          key={tab}
                          onClick={() => setActiveTab(tab)}
                          className={`h-7 px-3 flex items-center gap-2 text-xs rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                            isSelected
                              ? "bg-[#051D35] text-white font-semibold shadow-xs"
                              : "text-gray-600 hover:text-[#051D35] hover:bg-gray-100 font-semibold"
                          }`}
                        >
                          <span>{STATUS_LABELS[tab] || tab}</span>
                          <span className={`text-[10px] font-normal px-1 rounded tabular-nums ${
                            isSelected ? "bg-white/15 text-[#BE9662]" : "bg-gray-100 text-gray-500"
                          }`}>
                            {tabCount}
                          </span>
                          {hasNew && (
                            <span className="w-2 h-2 rounded-full bg-[#BE9662] animate-pulse ml-1" />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Right: Lead Role pills (in Lead-uri) or Transaction pills (Imobile/Cereri), Category & Sort dropdowns */}
                  <div className="flex items-center gap-2 shrink-0">
                    {activeSidebarItem === 'Lead-uri' ? (
                      <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-md">
                        {([
                          { id: 'Toate', label: 'Toate' },
                          { id: 'Proprietari', label: 'Proprietari' },
                          { id: 'Cumparatori', label: 'Cumpărători' },
                          { id: 'Chiriasi', label: 'Chiriași' }
                        ] as const).map((roleItem) => (
                          <button
                            key={roleItem.id}
                            type="button"
                            onClick={() => setLeadRoleFilter(roleItem.id)}
                            className={`h-6 px-3 text-[11px] font-semibold rounded transition-all cursor-pointer ${
                              leadRoleFilter === roleItem.id
                                ? "bg-[#051D35] text-white shadow-xs"
                                : "text-gray-600 hover:text-[#051D35] hover:bg-white/70"
                            }`}
                          >
                            {roleItem.label}
                          </button>
                        ))}
                      </div>
                    ) : activeSidebarItem === 'Cereri' ? (
                      <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-md">
                        {([
                          { id: 'Toate', label: 'Toate' },
                          { id: 'Cumpărare', label: 'Cumpărare' },
                          { id: 'Închiriere', label: 'Închiriere' }
                        ] as const).map((typeItem) => (
                          <button
                            key={typeItem.id}
                            type="button"
                            onClick={() => setTransactionFilter(typeItem.id as any)}
                            className={`h-6 px-2 text-[11px] font-semibold rounded transition-all cursor-pointer ${
                              transactionFilter === typeItem.id
                                ? "bg-[#051D35] text-white shadow-xs"
                                : "text-gray-600 hover:text-[#051D35] hover:bg-white/70"
                            }`}
                          >
                            {typeItem.label}
                          </button>
                        ))}
                      </div>
                    ) : (
                      /* Imobile (sau Proprietăți) */
                      <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-md">
                        {([
                          { id: 'Toate', label: 'Toate' },
                          { id: 'Vânzare', label: 'Vânzare' },
                          { id: 'Închiriere', label: 'Închiriere' }
                        ] as const).map((typeItem) => (
                          <button
                            key={typeItem.id}
                            type="button"
                            onClick={() => setTransactionFilter(typeItem.id as any)}
                            className={`h-6 px-2 text-[11px] font-semibold rounded transition-all cursor-pointer ${
                              transactionFilter === typeItem.id
                                ? "bg-[#051D35] text-white shadow-xs"
                                : "text-gray-600 hover:text-[#051D35] hover:bg-white/70"
                            }`}
                          >
                            {typeItem.label}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="relative">
                      <select
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                        className="h-7 bg-gray-50 border border-gray-200 rounded-md pl-3 pr-6 text-xs font-normal text-gray-700 appearance-none focus:outline-none focus:bg-white focus:border-gray-400 transition-colors cursor-pointer"
                      >
                        <option value="Toate">Toate categoriile</option>
                        {CATEGORIA_OPTIONS.map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                      <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    </div>

                    <div className="relative">
                      <select
                        value={sortOption}
                        onChange={(e) => setSortOption(e.target.value as SortOption)}
                        className="h-7 bg-gray-50 border border-gray-200 rounded-md pl-3 pr-6 text-xs font-normal text-gray-700 appearance-none focus:outline-none focus:bg-white focus:border-gray-400 transition-colors cursor-pointer"
                      >
                        <option value="newest">Cele mai noi</option>
                        <option value="oldest">Cele mai vechi</option>
                        <option value="expensive">Cele mai scumpe</option>
                        <option value="cheap">Cele mai ieftine</option>
                      </select>
                      <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    </div>

                    {activeSidebarItem === 'Lead-uri' && (
                      <button
                        type="button"
                        onClick={() => setOlxDrawerMode((prev) => (prev === "filter" ? null : "filter"))}
                        title="Filtrare anunțuri OLX.ro"
                        className={`h-7 px-2 flex items-center justify-center gap-1.5 rounded-md border text-xs transition-colors cursor-pointer shrink-0 ${
                          olxDrawerMode === "filter" || hasActiveOlxFilters(olxFilters)
                            ? "bg-[#051D35] text-white border-[#051D35]"
                            : "bg-gray-50 text-gray-600 border-gray-200 hover:text-[#051D35] hover:bg-gray-100"
                        }`}
                      >
                        <SlidersHorizontal size={13} />
                        {countActiveOlxFilters(olxFilters) > 0 && (
                          <span className="text-[10px] font-semibold px-1 rounded bg-[#BE9662] text-white tabular-nums">
                            {countActiveOlxFilters(olxFilters)}
                          </span>
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {activeSidebarItem === 'Lead-uri' && (
                  <OlxLeadDrawer
                    isOpen={olxDrawerMode !== null}
                    mode={olxDrawerMode || "filter"}
                    onClose={() => setOlxDrawerMode(null)}
                    filters={olxDrawerMode === "autoScan" ? olxAutoScanFilters : olxFilters}
                    onChange={(next) => {
                      if (olxDrawerMode === "autoScan") {
                        setOlxAutoScanFilters(next);
                      } else {
                        setOlxFilters(next);
                      }
                    }}
                    onReset={() => {
                      if (olxDrawerMode === "autoScan") {
                        setOlxAutoScanFilters(DEFAULT_OLX_LEAD_FILTERS);
                        setOlxScanIntervalMinutes(0);
                        setOlxScanLimit(3);
                        setOlxMinAdAgeHours(DEFAULT_OLX_MIN_AD_AGE_HOURS);
                        setOlxMaxAdAgeHours(DEFAULT_OLX_MAX_AD_AGE_HOURS);
                        setOlxScanNotice(null);
                      } else {
                        setOlxFilters(DEFAULT_OLX_LEAD_FILTERS);
                      }
                    }}
                    scanIntervalMinutes={olxScanIntervalMinutes}
                    onScanIntervalChange={(mins) => {
                      setOlxScanIntervalMinutes(mins);
                      if (mins > 0) {
                        void runOlxNewAdsScan(true);
                      }
                    }}
                    scanLimit={olxScanLimit}
                    onScanLimitChange={setOlxScanLimit}
                    minAdAgeHours={olxMinAdAgeHours}
                    onMinAdAgeChange={(hours) => {
                      const minIdx = OLX_MAX_AGE_STEPS.findIndex((s) => s.hours === hours);
                      const maxIdx = OLX_MAX_AGE_STEPS.findIndex((s) => s.hours === olxMaxAdAgeHours);
                      if (minIdx >= 0 && maxIdx >= 1) {
                        const clampedIdx = Math.min(minIdx, maxIdx - 1);
                        setOlxMinAdAgeHours(OLX_MAX_AGE_STEPS[clampedIdx].hours);
                      } else {
                        setOlxMinAdAgeHours(hours);
                      }
                    }}
                    maxAdAgeHours={olxMaxAdAgeHours}
                    onMaxAdAgeChange={(hours) => {
                      const maxIdx = OLX_MAX_AGE_STEPS.findIndex((s) => s.hours === hours);
                      const minIdx = OLX_MAX_AGE_STEPS.findIndex((s) => s.hours === olxMinAdAgeHours);
                      if (maxIdx >= 0 && minIdx >= 0) {
                        const clampedIdx = Math.max(maxIdx, minIdx + 1);
                        setOlxMaxAdAgeHours(OLX_MAX_AGE_STEPS[clampedIdx].hours);
                      } else {
                        setOlxMaxAdAgeHours(hours);
                      }
                    }}
                    lastScanAt={lastOlxScanAt}
                  />
                )}

            {/* Content */}
            <div className="flex-1 overflow-hidden relative">
              {activeSidebarItem !== 'Lead-uri' && activeTab === "Nevalidata" ? (
                <NevalidataUrlList 
                  groupedLeads={groupedLeads}
                  onItemClick={handleLeadClick}
                />
              ) : (
                <LeadList 
                  groupedLeads={groupedLeads} 
                  contacts={contacts}
                  onLeadClick={handleLeadClick} 
                  onContactClick={(contact) => setSelectedContact(contact)}
                  onQuickViewClick={(lead) => {
                    setSelectedQuickViewLead(lead);
                    setIsQuickViewOpen(true);
                  }}
                  quickViewLabel={activeSidebarItem === 'Lead-uri' || activeSidebarItem === 'Cereri' ? 'Vezi rapid' : 'Detalii'}
                  compactTypography={activeSidebarItem === 'Lead-uri' || activeSidebarItem === 'Cereri'}
                  header={
                    activeSidebarItem === 'Lead-uri' && olxScanNotice ? (
                      <div
                        role={olxScanNotice.type === "error" ? "alert" : "status"}
                        className={`flex items-start justify-between gap-3 px-3.5 py-2.5 rounded-lg border text-xs ${
                          olxScanNotice.type === "error"
                            ? "bg-red-50 border-red-200 text-red-900"
                            : "bg-amber-50/80 border-amber-200/90 text-[#051D35]"
                        }`}
                      >
                        <div className="flex items-start gap-2.5 min-w-0">
                          {olxScanNotice.type === "error" ? (
                            <AlertCircle size={15} className="text-red-600 shrink-0 mt-0.5" />
                          ) : (
                            <Info size={15} className="text-[#BE9662] shrink-0 mt-0.5" />
                          )}
                          <div className="min-w-0 space-y-0.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-[12px]">
                                {olxScanNotice.title}
                              </span>
                              <span
                                className={`text-[10px] font-normal tabular-nums ${
                                  olxScanNotice.type === "error" ? "text-red-600/80" : "text-gray-500"
                                }`}
                              >
                                {new Date(olxScanNotice.timestamp).toLocaleTimeString("ro-RO", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  second: "2-digit",
                                })}
                              </span>
                            </div>
                            <p
                              className={`text-[11px] font-normal leading-snug ${
                                olxScanNotice.type === "error" ? "text-red-800" : "text-gray-600"
                              }`}
                            >
                              {olxScanNotice.message}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setOlxScanNotice(null)}
                          className={`p-1 rounded transition-colors cursor-pointer shrink-0 ${
                            olxScanNotice.type === "error"
                              ? "text-red-500 hover:text-red-800 hover:bg-red-100"
                              : "text-gray-400 hover:text-[#051D35] hover:bg-amber-100/70"
                          }`}
                          title="Închide mesajul"
                          aria-label="Închide mesajul"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ) : undefined
                  }
                />
              )}
            </div>
          </>
        )}
          </motion.div>

          {/* Layer 2: Lead / Cerere / Property Detail View */}
          <AnimatePresence initial={false}>
            {selectedLead && (
              <motion.div
                key="detail-view"
                initial={{ x: "100%" }}
                animate={{ x: selectedContact ? "-100%" : "0%" }}
                exit={{ x: "100%" }}
                transition={pageSlideTransition}
                className={`absolute inset-0 w-full h-full bg-gray-50 overflow-hidden flex flex-col z-20 ${
                  selectedContact ? "pointer-events-none" : ""
                }`}
              >
                {/* Top Fixed Header Bar (Permanently fixed at top, never scrolls away) */}
                <div className="h-[42px] min-h-[42px] max-h-[42px] shrink-0 bg-white border-b border-gray-200 box-border flex items-center justify-between p-0 z-30 select-none">
                  {/* Back Button (Square, height = container height, bg = container bg, menu hover effect) */}
                  <button 
                    onClick={() => {
                      if (isEditingDetails) {
                        setIsEditingDetails(false);
                      } else {
                        handleCloseDetails();
                      }
                    }}
                    className="h-full w-[42px] aspect-square flex items-center justify-center border-r border-gray-200 bg-white hover:bg-gray-50 text-gray-500 hover:text-[#051D35] transition-colors shrink-0 cursor-pointer select-none group"
                    title={isEditingDetails ? "Înapoi la prezentare" : "Înapoi la listă"}
                  >
                <ChevronLeft size={18} className="text-gray-500 group-hover:text-gray-900 transition-colors" />
              </button>

              {/* Title & Info Center + Right Share & ID Area */}
              {(() => {
                const isLeadOrCerere =
                  isCerereLead(selectedLead) ||
                  selectedLead.status === "Noi" ||
                  selectedLead.status === "Pierdute" ||
                  selectedLead.status === "Nevalidata" ||
                  selectedLead.status === "Calificata";

                const internalId = selectedLead.propertyId || (selectedLead.id ? selectedLead.id.slice(0, 5) : "");
                const leadRole = getLeadRole(selectedLead);

                return (
                  <>
                    <div className="flex items-center gap-3 min-w-0 flex-1 px-4">
                      {(!isLeadOrCerere || isEditingDetails) && (
                        <div className="w-8 h-8 rounded-lg bg-[#051D35]/5 border border-[#051D35]/15 text-[#051D35] flex items-center justify-center shrink-0">
                          <Building2 size={16} />
                        </div>
                      )}

                      <div className="flex-1 min-w-0 flex items-center gap-2">
                        <h2 className="font-title text-[13px] font-semibold text-gray-900 truncate tracking-tight leading-tight">
                          {isEditingDetails ? `Modificare: ${selectedLead.title}` : selectedLead.title}
                        </h2>
                        {isLeadOrCerere && !isEditingDetails && (
                          <span
                            className={`text-[10px] font-normal px-2 py-0.5 rounded border tracking-wide uppercase shrink-0 leading-none ${
                              leadRole === "Proprietar"
                                ? "bg-amber-50 text-amber-800 border-amber-200"
                                : leadRole === "Chirias"
                                  ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                                  : "bg-blue-50 text-blue-800 border-blue-200"
                            }`}
                          >
                            {leadRole === "Chirias" ? "Chiriaș" : leadRole === "Cumparator" ? "Cumpărător" : "Proprietar"}
                          </span>
                        )}
                        <span className="text-[10px] font-normal px-2 py-0.5 rounded bg-gray-100 text-gray-700 border border-gray-200 shrink-0 leading-none">
                          {STATUS_LABELS[selectedLead.status] || selectedLead.status}
                        </span>
                        {isEditingDetails && (
                          <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-50 text-[#BE9662] border border-[#BE9662]/30 shrink-0 leading-none">
                            Mod editare
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center h-full shrink-0">
                      {!isEditingDetails && selectedLead.id && (
                        <div className="flex items-center px-3 h-full shrink-0">
                          <button
                            type="button"
                            onClick={() => void handleCopyShareLink(selectedLead.id!)}
                            className="h-8 w-8 rounded-md border border-gray-200 bg-white hover:bg-gray-50 hover:border-gray-300 text-gray-600 hover:text-[#051D35] flex items-center justify-center transition-colors shadow-2xs cursor-pointer"
                            title="Copiază link public de prezentare (fără date proprietar)"
                            aria-label="Distribuie"
                          >
                            {copiedShareId === selectedLead.id ? (
                              <Check size={14} className="text-emerald-600" />
                            ) : (
                              <Share2 size={14} />
                            )}
                          </button>
                        </div>
                      )}

                      {internalId && (
                        <div className="h-full px-4 flex items-center justify-center border-l border-gray-200 shrink-0 select-text">
                          <span className="text-[10px] font-normal text-[#051D35] tabular-nums leading-none">
                            #{internalId}
                          </span>
                        </div>
                      )}

                      {isEditingDetails && (
                        <div className="flex items-stretch h-full shrink-0 border-l border-gray-200">
                          <button
                            type="button"
                            onClick={() => setIsEditingDetails(false)}
                            className="h-full px-4 flex items-center gap-2 bg-white hover:bg-gray-50 text-gray-600 hover:text-gray-900 text-xs font-semibold border-r border-gray-200 transition-colors cursor-pointer"
                          >
                            <X size={14} className="text-gray-400" />
                            <span>Cancel</span>
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await handleSaveDetails();
                              toast.success("Modificările au fost salvate cu succes!");
                              setIsEditingDetails(false);
                            }}
                            className="h-full px-4 bg-[#051D35] hover:bg-[#0a2b4a] text-white text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
                            title="Salvează modificările și revino la prezentare"
                          >
                            <Check size={14} className="text-[#BE9662]" />
                            <span>Salvează</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Content view: Edit form or Presentation layout */}
            {isEditingDetails ? (
              <div className="flex-1 overflow-y-auto bg-gray-50 flex flex-col font-sans" onScroll={handleDetailsScroll}>
                {/* Sticky Jump-links bar in Edit Mode */}
                <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-md border-b border-gray-200 px-4 sm:px-6 py-3 flex items-center justify-between gap-3 shadow-xs">
                  <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
                    {[
                      { id: "basicale", label: "Informații de Bază" },
                      { id: "detaliigenerale", label: "Detalii Generale" },
                      { id: "caracteristici", label: "Caracteristici" },
                      { id: "utilitati", label: "Utilități" },
                      { id: "pret", label: "Preț" },
                      { id: "descriere", label: "Descriere" },
                      { id: "imagini", label: "Imagini" }
                    ].map(sect => (
                      <button
                        key={sect.id}
                        type="button"
                        onClick={() => {
                          const el = document.getElementById(sect.id);
                          el?.scrollIntoView({ behavior: "smooth", block: "start" });
                        }}
                        className="px-3 py-1 rounded-md text-[11px] font-semibold text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors shrink-0 uppercase tracking-wider"
                      >
                        {sect.label}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setIsEditingDetails(false)}
                      className="h-8 px-3 rounded-md border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Anulează
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await handleSaveDetails();
                        toast.success("Modificările au fost salvate cu succes!");
                        setIsEditingDetails(false);
                      }}
                      className="h-8 px-4 rounded-md bg-[#051D35] hover:bg-[#0a2b4a] text-white text-xs font-semibold flex items-center gap-2 shadow-xs transition-colors cursor-pointer"
                    >
                      <Check size={13} className="text-[#BE9662]" />
                      <span>Salvează</span>
                    </button>
                  </div>
                </div>

                {/* Edit Form Content with text fields and many checkboxes */}
                <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 w-full space-y-4">
                  <SectionCard id="basicale" title="Informații de Bază">
                    <BasicInfoSection 
                      editedTitle={editedTitle}
                      setEditedTitle={setEditedTitle}
                      editedName={editedName}
                      setEditedName={setEditedName}
                      editedPhone={editedPhone}
                      setEditedPhone={setEditedPhone}
                      editedZone={editedZone}
                      setEditedZone={setEditedZone}
                      editedPrice={editedPrice}
                      setEditedPrice={setEditedPrice}
                      editedTransactionType={editedTransactionType}
                      setEditedTransactionType={setEditedTransactionType}
                      editedCategoria={editedCategoria}
                      setEditedCategoria={setEditedCategoria}
                      url={selectedLead.url}
                      coverImage={selectedLead.coverImage}
                      handleSaveDetails={handleSaveDetails}
                      extractedData={selectedLead.extractedData}
                    />
                  </SectionCard>

                  <ExtractionViewer 
                    data={selectedLead?.extractedData}
                    leadId={selectedLead.id!}
                    propertyId={selectedLead.propertyId}
                    onUpdate={handleUpdate}
                    basicInfoProps={{}}
                    status={selectedLead.status}
                  />

                  {/* Bottom Save Bar */}
                  <div className="pt-4 pb-12 flex items-center justify-end gap-4 border-t border-gray-200">
                    <button
                      type="button"
                      onClick={() => setIsEditingDetails(false)}
                      className="h-9 px-4 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Înapoi la Prezentare
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await handleSaveDetails();
                        toast.success("Modificările au fost salvate cu succes!");
                        setIsEditingDetails(false);
                      }}
                      className="h-9 px-5 rounded-lg bg-[#051D35] hover:bg-[#0a2b4a] text-white text-xs font-semibold flex items-center gap-2 shadow-sm transition-colors cursor-pointer"
                    >
                      <Check size={14} className="text-[#BE9662]" />
                      <span>Salvează Modificările</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (isCerereLead(selectedLead) ||
              selectedLead.status === 'Noi' ||
              selectedLead.status === 'Pierdute' ||
              selectedLead.status === 'Nevalidata' ||
              selectedLead.status === 'Calificata') ? (
              <LeadCerereDetailPage
                lead={selectedLead}
                contacts={contacts.filter(c => c.propertyId === selectedLead.propertyId || c.propertyId === selectedLead.id)}
                onBack={() => {
                  void handleCloseDetails();
                }}
                onUpdateLead={(updatedData) => {
                  setSelectedLead(prev => prev ? { ...prev, ...updatedData } : null);
                  setLeads(prev => prev.map(l => l.id === selectedLead.id ? { ...l, ...updatedData } : l));
                }}
                onContactClick={(contact) => setSelectedContact(contact)}
                onAddContactClick={() => setIsContactModalOpen(true)}
                onDeleteLead={handleDeleteNevalidatLead}
                onMarkAsLost={handleMarkAsLost}
                onReactivateLead={handleReactivateLead}
              />
            ) : (
              <PropertyDetailView 
                lead={selectedLead}
                isPublicShared={false}
                contacts={contacts.filter(c => c.propertyId === selectedLead.propertyId || c.propertyId === selectedLead.id)}
                onUpdateLead={(updatedData) => {
                  setSelectedLead(prev => prev ? { ...prev, ...updatedData } : null);
                  setLeads(prev => prev.map(l => l.id === selectedLead.id ? { ...l, ...updatedData } : l));
                }}
                onOpenEditForm={() => {
                  setEditedName(selectedLead.ownerName || "");
                  setEditedPhone(selectedLead.ownerPhone || "");
                  setEditedPropertyId(selectedLead.propertyId || "");
                  setEditedTitle(selectedLead.title || "");
                  setEditedZone(selectedLead.zone || "");
                  setEditedPrice(selectedLead.price || "");
                  setEditedTransactionType(selectedLead.transactionType || "Vânzare");
                  setEditedCategoria(selectedLead.categoria || "");
                  setIsEditingDetails(true);
                }}
                onDelete={async () => {
                  if (selectedLead.status === 'Sterse') {
                    setShowDeleteConfirm(true);
                    document.getElementById('delete-section')?.scrollIntoView({ behavior: 'smooth' });
                  } else {
                    await updateStatus(selectedLead.id!, 'Sterse');
                    toast.success('Proprietate mutată în Șterse');
                  }
                }}
                onAddActivity={() => setIsActivityModalOpen(true)}
              />
            )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Layer 3: Contact Detail View */}
          <AnimatePresence initial={false}>
            {selectedContact && (
              <motion.div
                key="contact-detail"
                initial={{ x: "100%" }}
                animate={{ x: "0%" }}
                exit={{ x: "100%" }}
                transition={pageSlideTransition}
                className="absolute inset-0 w-full h-full bg-gray-50 overflow-hidden flex flex-col z-30"
              >
                <ContactDetailView
                  contact={selectedContact}
                  leads={leads}
                  contacts={contacts}
                  onBack={() => setSelectedContact(null)}
                  onContactUpdated={(updated) => setSelectedContact(updated)}
                  onSelectLead={(lead) => {
                    handleLeadClick(lead);
                    setSelectedContact(null);
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

      <NotificationsModal 
        isOpen={isNotificationsOpen} 
        onClose={() => setIsNotificationsOpen(false)} 
        notifications={notifications}
        onSelectNotification={(notification) => {
          if (notification.type === 'viewing' || notification.message?.toLowerCase().includes('vizionare programată')) {
            handleSelectSidebarItem('Calendar');
            return;
          }

          let targetLead = leads.find(l => 
            (notification.entityId && l.id === notification.entityId) ||
            (notification.propertyId && l.propertyId === notification.propertyId)
          );

          if (!targetLead) {
            const idMatch = `${notification.title} ${notification.message}`.match(/#([PRL][0-9]+)/i);
            if (idMatch && idMatch[1]) {
              const extractedId = idMatch[1].toUpperCase();
              targetLead = leads.find(l => l.propertyId?.toUpperCase() === extractedId);
            }
          }

          if (!targetLead && notification.title) {
            targetLead = leads.find(l => l.title && (notification.title.includes(l.title) || notification.message?.includes(l.title)));
          }

          if (targetLead) {
            closingDetailRouteRef.current = false;
            if (isCerereLead(targetLead)) {
              handleSelectSidebarItem('Cereri');
              if (targetLead.id) navigate(`/cereri/${targetLead.id}`);
            } else if (targetLead.status === 'Noi' || targetLead.status === 'Pierdute' || targetLead.status === 'Nevalidata' || targetLead.status === 'Calificata') {
              handleSelectSidebarItem('Lead-uri');
              if (targetLead.id) navigate(`/leads/${targetLead.id}`);
            } else {
              handleSelectSidebarItem('Proprietati');
            }
            setSelectedLead(targetLead);
            return;
          }

          if (notification.type === 'cerere' || notification.title?.toLowerCase().includes('cerere')) {
            handleSelectSidebarItem('Cereri');
          } else if (notification.type === 'lead') {
            handleSelectSidebarItem('Lead-uri');
          } else {
            handleSelectSidebarItem('Proprietati');
          }
        }}
      />

      <AddLeadModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
      <AddCerereModal 
        isOpen={isCerereModalOpen} 
        onClose={() => setIsCerereModalOpen(false)} 
        onSuccess={() => setActiveTab("Noua")}
      />
      <ExtractionRulesModal isOpen={isExtractionRulesOpen} onClose={() => setIsExtractionRulesOpen(false)} />
      <AddContactModal 
        isOpen={isContactModalOpen} 
        onClose={() => setIsContactModalOpen(false)} 
        defaultPropertyId={selectedLead?.id} 
      />
      <AddDocumentModal 
        isOpen={isDocumentModalOpen} 
        onClose={() => setIsDocumentModalOpen(false)} 
        defaultPropertyId={selectedLead?.propertyId || selectedLead?.id} 
      />
      <AddActivityModal 
        isOpen={isActivityModalOpen || isTourModalOpen} 
        onClose={() => {
          setIsActivityModalOpen(false);
          setIsTourModalOpen(false);
          setActivityDefaultDate("");
          setActivityDefaultHour("");
        }} 
        defaultPropertyId={selectedLead?.propertyId || selectedLead?.id} 
        defaultClientName={selectedLead?.ownerName !== "Nespecificat" ? selectedLead?.ownerName : ""} 
        defaultDate={activityDefaultDate}
        defaultHour={activityDefaultHour}
      />
      <AddViewingModal 
        isOpen={isViewingModalOpen} 
        onClose={() => setIsViewingModalOpen(false)} 
        propertyId={selectedLead?.id || ""} 
        contacts={contacts.filter(c => c.propertyId === selectedLead?.id)}
      />
      <ViewingDetailsModal 
        isOpen={isViewingDetailsOpen}
        onClose={() => setIsViewingDetailsOpen(false)}
        viewing={selectedViewing}
      />
      <PropertyQuickViewModal 
        isOpen={isQuickViewOpen} 
        onClose={() => setIsQuickViewOpen(false)} 
        lead={selectedQuickViewLead}
        contacts={contacts.filter(c => c.propertyId === selectedQuickViewLead?.id)}
        onContactClick={(contact) => setSelectedContact(contact)}
        onAddContactClick={() => {
          setIsQuickViewOpen(false);
          setIsContactModalOpen(true);
        }}
      />

      <NevalidataDetailsModal
        isOpen={!!selectedNevalidatLead}
        lead={selectedNevalidatLead}
        onClose={() => setSelectedNevalidatLead(null)}
        onSaveLead={handleSaveNevalidatLead}
        onMoveToCalificata={handleMoveToCalificata}
        onConvertToImobil={handleConvertToImobil}
        onConvertToCerere={handleConvertToCerere}
        onMarkAsLost={handleMarkAsLost}
        onReactivate={handleReactivateLead}
        onDeleteLead={handleDeleteNevalidatLead}
      />

      <CalificataDetailsModal
        isOpen={!!selectedCalificatLead}
        lead={selectedCalificatLead}
        onClose={() => setSelectedCalificatLead(null)}
        onActivate={handleActivateCalificatLead}
        onDeleteLead={handleDeleteCalificatLead}
        onOpenFullForm={handleOpenFullFormFromCalificat}
      />
      </div>
    </div>
  );
};

const BasicInfoSection = ({ 
  editedTitle, setEditedTitle, 
  editedName, setEditedName, 
  editedPhone, setEditedPhone, 
  editedZone, setEditedZone, 
  editedPrice, setEditedPrice, 
  editedTransactionType, setEditedTransactionType,
  editedCategoria, setEditedCategoria,
  url, coverImage, handleSaveDetails, extractedData
}: any) => (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
    {/* Column 1: Info Fields */}
    <div className="space-y-[16px]">
      <div className="flex flex-col gap-1">
        <span className="text-[12px] font-semibold text-[--color-text-placeholder] tracking-wider">Titlu Proprietate</span>
        <FormInput 
          value={editedTitle}
          onChange={setEditedTitle}
          onBlur={handleSaveDetails}
          placeholder="Introduceți titlul..."
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-[16px]">
        <div className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-[--color-text-placeholder] tracking-wider">Nume Contact</span>
          <FormInput 
            value={editedName}
            onChange={setEditedName}
            onBlur={handleSaveDetails}
            placeholder="Nume..."
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-[--color-text-placeholder] tracking-wider">Telefon</span>
          <FormInput 
            value={editedPhone}
            onChange={setEditedPhone}
            onBlur={handleSaveDetails}
            placeholder="Telefon..."
          />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-[16px]">
        <div className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-[--color-text-placeholder] tracking-wider">Zonă</span>
          <FormInput 
            value={editedZone}
            onChange={setEditedZone}
            onBlur={handleSaveDetails}
            placeholder="Zonă..."
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-[--color-text-placeholder] tracking-wider">Preț</span>
          <FormInput 
            value={editedPrice}
            onChange={setEditedPrice}
            onBlur={handleSaveDetails}
            placeholder="Preț..."
          />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-[16px]">
        <div className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-[--color-text-placeholder] tracking-wider">Tranzacție</span>
          <FormSelect 
            value={editedTransactionType}
            onChange={setEditedTransactionType}
            onBlur={handleSaveDetails}
            options={TRANZACTIE_OPTIONS}
            showEmpty={false}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-[--color-text-placeholder] tracking-wider">Categorie</span>
          <FormSelect 
            value={editedCategoria}
            onChange={setEditedCategoria}
            onBlur={handleSaveDetails}
            options={CATEGORIA_OPTIONS}
            showEmpty={false}
          />
        </div>
      </div>
      <InfoRow label="URL Sursă" value={url} isLink />

      {/* Collapsible Accordion for Original Description Text from Original URL */}
      <div className="border border-gray-200 rounded-lg overflow-hidden bg-white shadow-xs mt-4">
        <details className="group">
          <summary className="flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100 cursor-pointer text-xs font-semibold text-gray-800 transition-colors select-none">
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4 text-[#BE9662]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
              </svg>
              <span>Descriere Originală din Anunțul Sursă</span>
            </span>
            <span className="text-[10px] text-gray-500 font-normal group-open:hidden">Afișează textul original</span>
            <span className="text-[10px] text-gray-500 font-normal hidden group-open:inline">Ascunde</span>
          </summary>
          <div className="p-4 text-xs font-normal text-gray-700 bg-white border-t border-gray-200 max-h-60 overflow-y-auto whitespace-pre-wrap leading-relaxed">
            {extractedData?.originalDescription || extractedData?.text || extractedData?.crmData?.descriere?.continut || extractedData?.markdownMarketing || "Niciun text de descriere original preluat din URL-ul sursă."}
          </div>
        </details>
      </div>
    </div>

    {/* Column 2: Property Image */}
    <div>
      <div className="flex flex-col gap-1 h-full">
        <span className="text-[12px] font-semibold text-[--color-text-placeholder] tracking-wider mb-2">Imagine Principală</span>
        <div className="relative aspect-square md:aspect-auto md:flex-1 w-full bg-gray-50 rounded-[16px] overflow-hidden border border-gray-100 group/img">
          {(() => {
            const images = extractedData?.crmData?.imagini;
            const categoriaLower = editedCategoria.toLowerCase();
            const isResidential = !categoriaLower.includes('comercial') && 
                                   !categoriaLower.includes('spatiu') && 
                                   !categoriaLower.includes('depozit') && 
                                   !categoriaLower.includes('hala') && 
                                   !categoriaLower.includes('industrial') && 
                                   !categoriaLower.includes('birou');

            const rawFirstImage = (images && typeof images === 'object') ? (
              isResidential ? (
                (images?.living?.[0]) || 
                (images?.camera?.[0]) || 
                (images?.bucatarie?.[0]) || 
                (images?.baie?.[0]) || 
                (images?.alteSpatii?.[0])
              ) : (
                (images?.alteSpatii?.[0]) || 
                (images?.living?.[0]) || 
                (images?.camera?.[0]) || 
                (images?.bucatarie?.[0]) || 
                (images?.baie?.[0])
              )
            ) : null;

            const displayImage = typeof rawFirstImage === 'object' && rawFirstImage !== null
              ? rawFirstImage.original
              : (typeof rawFirstImage === 'string' ? rawFirstImage : (coverImage || null));

            return displayImage ? (
              <img 
                src={getThumbnailImageUrl(displayImage, 800)} 
                alt="Property"
                decoding="async"
                className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover/img:scale-110"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-200">
                <Database size={40} className="mb-2" />
                <span className="text-[10px] font-semibold uppercase tracking-widest">Nicio imagine</span>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  </div>
);

const InfoRow = ({ label, value, isLink }: { label: string, value: string, isLink?: boolean }) => (
  <div className="flex flex-col gap-1 py-2 border-b border-gray-100 last:border-0">
    <span className="text-[12px] font-semibold text-[#051D35]">{label}</span>
    {isLink ? (
      <a href={value} target="_blank" rel="noreferrer" className="text-[12px] text-[#BE9662] font-normal truncate hover:underline">
        Deschide URL
      </a>
    ) : (
      <span className="text-[12px] text-gray-800 font-normal">{value}</span>
    )}
  </div>
);

const SectionCard = ({ id, title, children }: { id: string, title: string, children: React.ReactNode }) => (
  <div 
    id={id} 
    className="bg-white rounded-md border border-gray-200 shadow-none overflow-hidden scroll-mt-16"
  >
    <div className="h-9 flex items-center px-4 bg-gray-50/80 border-b border-gray-200">
      <span className="font-title text-[12px] font-semibold text-[#051D35]">{title}</span>
    </div>
    <div className="p-4">{children}</div>
  </div>
);

const ExtractionViewer = ({ data, leadId, propertyId, onUpdate, basicInfoProps, status }: { data: any, leadId: string, propertyId?: string, onUpdate: (id: string, path: string, val: any) => void, basicInfoProps: any, status?: LeadStatus }) => {
  const wrapUpdate = (path: string, val: any) => {
    onUpdate(leadId, path, val);
  };

  return (
    <div className="space-y-4">
      <SectionCard id="detaliigenerale" title="Detalii Generale">
        <DetaliiGeneraleSection 
          data={data?.crmData?.detaliiGenerale} 
          onUpdate={wrapUpdate} 
          categoria={data?.crmData?.detaliiGenerale?.categoria}
        />
      </SectionCard>
      <SectionCard id="caracteristici" title="Caracteristici">
        <CaracteristiciSection 
          data={data?.crmData?.caracteristici} 
          onUpdate={wrapUpdate} 
          categoria={data?.crmData?.detaliiGenerale?.categoria}
        />
      </SectionCard>
      <SectionCard id="utilitati" title="Utilități">
        <UtilitatiSection 
          data={data?.crmData?.utilitati} 
          onUpdate={wrapUpdate} 
          categoria={data?.crmData?.detaliiGenerale?.categoria}
        />
      </SectionCard>
      <SectionCard id="pret" title="Preț">
        <PretSection 
          data={data?.crmData?.pret} 
          tranzactie={data?.crmData?.detaliiGenerale?.tranzactie} 
          onUpdate={wrapUpdate}
        />
      </SectionCard>
      <SectionCard id="descriere" title="Descriere">
        <DescriereSection data={data?.crmData?.descriere} onUpdate={wrapUpdate} fullCRMData={data?.crmData} propertyId={propertyId} />
      </SectionCard>
      <SectionCard id="imagini" title="Imagini">
        <ImaginiSection data={data?.crmData?.imagini} onUpdate={wrapUpdate} fullCRMData={data?.crmData} propertyId={propertyId} />
      </SectionCard>
    </div>
  );
};

const Accordion = ({ title, children, isOpen: isOpenProp, onToggle, defaultOpen = false }: { title: string, children: React.ReactNode, isOpen?: boolean, onToggle?: () => void, defaultOpen?: boolean }) => {
  const [isInternalOpen, setIsInternalOpen] = useState(defaultOpen);
  const isOpen = isOpenProp !== undefined ? isOpenProp : isInternalOpen;
  const toggle = onToggle || (() => setIsInternalOpen(!isInternalOpen));

  return (
    <div className="rounded-md border border-gray-200 overflow-hidden bg-white shadow-none">
      <button 
        onClick={toggle}
        className="w-full h-9 flex items-center justify-between px-3 text-left transition-colors hover:bg-gray-50"
      >
        <span className="font-title text-[12px] font-semibold text-[#051D35]">{title}</span>
        <motion.div animate={{ rotate: isOpen ? 180 : 0 }} className="text-gray-400"><ChevronDown size={14} /></motion.div>
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
            <div className="p-3 border-t border-gray-100">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const markdownComponents = {
  h1: () => null,
  h2: ({children}: any) => (
    <h2 className="font-title text-[13px] font-semibold text-gray-900 tracking-tight mt-0 mb-2 capitalize">
      {children}
    </h2>
  ),
  ul: ({children}: any) => <ul className="space-y-1 mb-3">{children}</ul>,
  li: ({children}: any) => <li className="text-gray-600 border-b border-gray-100 py-1 text-xs font-normal last:border-0">{children}</li>,
  table: ({children}: any) => {
    return (
      <div className="mb-3 rounded-md border border-gray-200 overflow-x-auto w-full group/table">
        <table className="w-full text-left border-collapse min-w-full table-auto text-xs">
          {children}
        </table>
      </div>
    );
  },
  thead: ({children}: any) => <thead className="bg-gray-50/80 border-b border-gray-200 text-gray-500 font-semibold text-xs">{children}</thead>,
  th: ({children}: any) => {
    const rawText = getTextFromChildren(children);
    const isImageTable = rawText.toLowerCase().includes("imagine");
    const isIdHeader = rawText.trim().toLowerCase().startsWith("id ") || rawText.trim().toLowerCase() === "id";
    const displayContent = isIdHeader ? "ID" : children;
    return (
      <th className="px-3 py-2 text-[11px] font-semibold text-gray-700 capitalize tracking-wide first:w-[20%] first:min-w-[120px]">
        <TableHeaderCopyButton isImageTable={isImageTable}>{displayContent}</TableHeaderCopyButton>
      </th>
    );
  },
  td: ({children, rowRef}: any) => {
    const imageUrls: string[] = [];
    const findAllImageUrls = (node: any) => {
      if (!node) return;
      if (node.type === "img" || (node.props && node.props.src)) imageUrls.push(node.props.src);
      if (Array.isArray(node)) node.forEach(findAllImageUrls);
      if (typeof node === "object" && node.props && node.props.children) findAllImageUrls(node.props.children);
    };
    
    findAllImageUrls(children);
    const isImageCell = imageUrls.length > 0;
    const textContent = getTextFromChildren(children).toLowerCase();
    const isCategoryLabel = (textContent === "living" || textContent === "bucătărie" || textContent === "dormitor" || textContent === "baie" || textContent === "alte spații");

    return (
      <td className="px-3 py-2 text-[12px] font-normal border-b border-gray-100 text-gray-600 first:font-semibold first:text-gray-900 first:w-[20%] first:min-w-[120px] relative group/row align-top">
         <div className={`break-words whitespace-normal w-full overflow-hidden flex ${isImageCell ? 'flex-row flex-wrap gap-2' : 'flex-col gap-1'}`}>
            {children}
         </div>
         {isCategoryLabel ? (
           <CellCopyButton text={getTextFromChildren(children)} isRowDownload={true} rowRef={rowRef} />
         ) : (
           <CellCopyButton 
             text={getTextFromChildren(children)} 
             isImage={isImageCell} 
             url={imageUrls.length === 1 ? imageUrls[0] : ""} 
           />
         )}
      </td>
    );
  },
  tr: ({children}: any) => {
    const rowRef = useRef<HTMLTableRowElement>(null);
    return (
      <tr ref={rowRef} className="group/row hover:bg-gray-50/50 transition-colors relative">
        {React.Children.map(children, (child: any) => {
          if (React.isValidElement(child)) return React.cloneElement(child as React.ReactElement, { rowRef } as any);
          return child;
        })}
      </tr>
    );
  },
  img: ({src, alt}: any) => src ? (
    <div className="relative group/img inline-block" style={{ width: '64px' }}>
      <img src={getThumbnailImageUrl(src, 160)} alt={alt} loading="lazy" decoding="async" className="rounded w-full h-14 object-cover border border-gray-200 shadow-none transition-all" referrerPolicy="no-referrer" />
    </div>
  ) : null,
};
