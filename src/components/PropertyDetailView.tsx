import React, { useState, useEffect, useMemo, useRef } from "react";
import { Lead, getLeadRole, leadsService } from "../services/leadsService";
import { Contact } from "../services/contactsService";
import { notificationsService } from "../services/notificationsService";
import { 
  FileText, 
  MapPin, 
  Home, 
  Building2, 
  Building, 
  Compass, 
  Bus, 
  Car, 
  BadgePercent, 
  Phone, 
  Mail, 
  Printer, 
  Heart, 
  Camera, 
  ChevronDown, 
  ChevronUp, 
  ChevronLeft, 
  ChevronRight, 
  X, 
  ExternalLink, 
  ShieldCheck, 
  Clock, 
  Sparkles, 
  Send, 
  MessageSquare, 
  CheckCircle2, 
  Calendar, 
  Layers, 
  Share2, 
  Check, 
  Maximize2,
  User,
  Lock,
  Copy,
  Bookmark,
  Edit3,
  Plus,
  Upload,
  Image as ImageIcon,
  Trash2
} from "lucide-react";
import toast from "react-hot-toast";
import { getPublicShareUrl } from "../utils/shareUtils";
import { auth } from "../lib/firebase";

export interface PropertyDetailViewProps {
  lead: Lead;
  isPublicShared?: boolean; // When true: STRICTLY HIDES all owner details!
  contacts?: Contact[];
  onOpenEditForm?: () => void;
  showTopNavbar?: boolean;
  onDelete?: () => void;
  onAddActivity?: () => void;
}

interface NavSection {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const NAV_SECTIONS: NavSection[] = [
  { id: "tranzactie", label: "Preț", icon: BadgePercent },
  { id: "introducere", label: "Introducere", icon: FileText },
  { id: "apartament", label: "Apartament", icon: Home },
  { id: "bloc", label: "Bloc", icon: Building2 },
  { id: "imprejurimi", label: "Împrejurimi", icon: Compass },
  { id: "transport", label: "Transport", icon: Bus },
  { id: "parcare", label: "Parcare", icon: Car },
  { id: "acte", label: "Condiții", icon: ShieldCheck }
];

interface AttributeRowProps {
  label: string;
  value: React.ReactNode;
  copyValue?: string;
  isLast?: boolean;
  isEditing?: boolean;
  editValue?: string;
  onEditChange?: (val: string) => void;
  multiline?: boolean;
}

const AttributeRow: React.FC<AttributeRowProps> = ({ 
  label, 
  value, 
  copyValue,
  isEditing = false,
  editValue,
  onEditChange
}) => {
  const [copied, setCopied] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const textToCopy = copyValue || (typeof value === "string" ? value : "");

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!textToCopy) return;
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success(`Copiat: ${label}`);
  };

  return (
    <div 
      className={`group/row relative flex items-stretch border-b border-gray-100 last:border-b-0 transition-colors font-sans min-h-[36px] ${
        isFocused 
          ? "border-l-3 border-l-[#BE9662]" 
          : "border-l-3 border-l-transparent"
      }`}
    >
      {/* Left Cell: Label */}
      <div className="w-[30%] sm:w-[22%] sm:min-w-[130px] px-3.5 py-2 flex items-center shrink-0 border-r border-gray-100 select-text bg-gray-50/30">
        <span className={`text-[12px] font-sans transition-colors flex items-center gap-1.5 ${
          isFocused ? "font-bold text-[#051D35]" : "font-medium text-gray-900"
        }`}>
          {label}:
          {isFocused && (
            <span className="w-1.5 h-1.5 rounded-full bg-[#BE9662] shrink-0 animate-pulse" title="Mod focus activ" />
          )}
        </span>
      </div>

      {/* Right Cell: Value (100% of cell surface is the seamless editable input) */}
      <div 
        onClick={() => {
          if (isEditing && inputRef.current) {
            inputRef.current.focus();
          }
        }}
        className={`flex-1 relative flex items-stretch min-w-0 transition-colors ${
          isFocused 
            ? "bg-amber-50/40" 
            : isEditing 
              ? "hover:bg-amber-50/15 cursor-text" 
              : "hover:bg-gray-50/60"
        }`}
      >
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={editValue ?? (typeof value === "string" ? value : "")}
            onChange={(e) => onEditChange?.(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLElement).blur();
            }}
            className={`w-full h-full min-h-[36px] px-3.5 py-2 text-[12px] font-sans leading-normal bg-transparent border-none outline-none rounded-none focus:outline-none focus:ring-0 p-0 m-0 shadow-none cursor-text select-text transition-colors ${
              isFocused ? "text-[#051D35] font-semibold" : "text-gray-800 font-normal"
            }`}
          />
        ) : (
          <div className="w-full h-full min-h-[36px] px-3.5 py-2 text-[12px] font-sans text-gray-600 leading-normal flex items-center break-words select-text pr-10">
            {value}
          </div>
        )}

        {!isEditing && textToCopy && (
          <button
            type="button"
            onClick={handleCopy}
            className="opacity-0 group-hover/row:opacity-100 flex items-center justify-center w-6 h-6 rounded-md bg-white border border-gray-200 text-gray-400 hover:text-[#051D35] hover:border-gray-300 shadow-2xs transition-all active:scale-90 absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer z-10"
            title={`Copiază ${label}`}
          >
            {copied ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
          </button>
        )}
      </div>
    </div>
  );
};

interface SubCategoryHeaderProps {
  title: string;
  count?: string;
  actions?: React.ReactNode;
}

const SubCategoryHeader: React.FC<SubCategoryHeaderProps> = ({ title, count, actions }) => (
  <div className="min-h-9 py-1 px-3.5 bg-gray-50/80 border-b border-gray-100 flex items-center justify-between gap-2 select-none font-sans">
    <div className="flex items-center gap-2">
      <span className="w-1.5 h-1.5 rounded-full bg-[#BE9662]" />
      <span className="text-[11px] font-bold uppercase tracking-wider text-[#051D35] font-sans">
        {title}
      </span>
      {count && (
        <span className="text-[10px] font-mono text-gray-400 font-medium ml-1">
          {count}
        </span>
      )}
    </div>
    {actions && <div className="flex items-center gap-1.5">{actions}</div>}
  </div>
);

interface SectionEditButtonProps {
  isEditing: boolean;
  isDirty: boolean;
  onStartEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  disabled?: boolean;
}

const SectionEditButton: React.FC<SectionEditButtonProps> = ({
  isEditing,
  isDirty,
  onStartEdit,
  onCancel,
  onSave,
  disabled = false
}) => {
  if (disabled) return null;

  if (!isEditing) {
    return (
      <button
        type="button"
        onClick={onStartEdit}
        className="h-6 px-2.5 rounded-md text-[11px] font-medium bg-white hover:bg-gray-100 text-gray-700 hover:text-[#051D35] border border-gray-200 transition-all flex items-center gap-1 shadow-2xs cursor-pointer font-sans"
        title="Modifică datele acestei secțiuni"
      >
        <Edit3 size={11} className="text-[#BE9662]" />
        <span>Modifică</span>
      </button>
    );
  }

  if (!isDirty) {
    return (
      <button
        type="button"
        onClick={onCancel}
        className="h-6 px-2.5 rounded-md text-[11px] font-medium bg-white hover:bg-gray-100 text-gray-500 hover:text-gray-800 border border-gray-300 transition-all flex items-center gap-1 shadow-2xs cursor-pointer font-sans"
        title="Renunță la editare"
      >
        <X size={11} className="text-gray-400" />
        <span>Cancel</span>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={onCancel}
        className="h-6 px-2 rounded-md text-[11px] font-medium bg-white hover:bg-gray-100 text-gray-500 hover:text-gray-800 border border-gray-200 transition-all flex items-center gap-1 cursor-pointer font-sans"
        title="Renunță la modificări"
      >
        <X size={11} />
        <span>Cancel</span>
      </button>
      <button
        type="button"
        onClick={onSave}
        className="h-6 px-2.5 rounded-md text-[11px] font-semibold bg-[#051D35] hover:bg-[#0a2b4a] text-white border border-[#051D35] transition-all flex items-center gap-1 shadow-xs cursor-pointer font-sans"
        title="Salvează modificările secțiunii"
      >
        <Check size={11} className="text-[#BE9662]" />
        <span>Salvează</span>
      </button>
    </div>
  );
};

export const PropertyDetailView: React.FC<PropertyDetailViewProps> = ({
  lead,
  isPublicShared = false,
  contacts = [],
  onOpenEditForm,
  showTopNavbar = false,
  onDelete,
  onAddActivity
}) => {
  const [activeSection, setActiveSection] = useState<string>("introducere");
  const [isCopied, setIsCopied] = useState<boolean>(false);
  
  // Persistent favorite stored in browser localStorage
  const favoriteStorageKey = `brokr_fav_prop_${lead.propertyId || lead.id || "default"}`;
  const [isFavorite, setIsFavorite] = useState<boolean>(() => {
    try {
      return localStorage.getItem(favoriteStorageKey) === "true";
    } catch {
      return false;
    }
  });

  const [copiedOwnerPhone, setCopiedOwnerPhone] = useState<boolean>(false);
  
  // Lightbox Modal state
  const [isGalleryOpen, setIsGalleryOpen] = useState<boolean>(false);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number>(0);
  const [carouselIndex, setCarouselIndex] = useState<number>(0);

  // Accordion collapsed states (default open)
  const [collapsedCards, setCollapsedCards] = useState<Record<string, boolean>>({});

  // Agent inquiry form
  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formMessage, setFormMessage] = useState("");
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formSent, setFormSent] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const isManualScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<any>(null);

  // Pre-fill enquiry form message
  useEffect(() => {
    if (lead) {
      const pTitle = lead.extractedData?.crmData?.descriere?.titlu || lead.title || "proprietatea prezentată";
      const pId = lead.propertyId || lead.id || "";
      setFormMessage(`Bună ziua, sunt interesat de proprietatea ${pId ? `[#${pId}] ` : ""}"${pTitle}". Vă rog să mă contactați pentru detalii sau o vizionare.`);
    }
  }, [lead]);

  const getScrollContainer = (node: HTMLElement | null): HTMLElement | Window => {
    let parent = node?.parentElement;
    while (parent) {
      const style = window.getComputedStyle(parent);
      if (style.overflowY === "auto" || style.overflowY === "scroll") {
        return parent;
      }
      parent = parent.parentElement;
    }
    return window;
  };

  // Track active jump link section on scroll with early activation (before header disappears)
  useEffect(() => {
    let scrollContainer: HTMLElement | Window = window;
    let p = containerRef.current?.parentElement;
    while (p) {
      const style = window.getComputedStyle(p);
      if (style.overflowY === "auto" || style.overflowY === "scroll") {
        scrollContainer = p;
        break;
      }
      p = p.parentElement;
    }

    const stickyOffset = showTopNavbar ? 116 : 108;

    const handleScroll = () => {
      // Don't override active tab during programmatic smooth scroll
      if (isManualScrollingRef.current) return;

      // Check if user is scrolled to the absolute bottom of the container
      if (scrollContainer instanceof HTMLElement) {
        const isAtBottom = scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - 40;
        if (isAtBottom) {
          setActiveSection(NAV_SECTIONS[NAV_SECTIONS.length - 1].id);
          return;
        }
      } else {
        const isAtBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 40;
        if (isAtBottom) {
          setActiveSection(NAV_SECTIONS[NAV_SECTIONS.length - 1].id);
          return;
        }
      }

      const containerTop = scrollContainer instanceof HTMLElement 
        ? scrollContainer.getBoundingClientRect().top 
        : 0;
      
      // Trigger line: 100px below the sticky header bar so section activates early before its header is occluded
      const triggerLine = containerTop + stickyOffset + 100;

      // Find the last section whose top has reached or passed the trigger line
      let currentSectionId = NAV_SECTIONS[0].id;
      for (const sect of NAV_SECTIONS) {
        const el = document.getElementById(sect.id);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= triggerLine) {
            currentSectionId = sect.id;
          }
        }
      }

      setActiveSection(currentSectionId);
    };

    if (scrollContainer instanceof HTMLElement) {
      scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    }
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      if (scrollContainer instanceof HTMLElement) {
        scrollContainer.removeEventListener("scroll", handleScroll);
      }
      window.removeEventListener("scroll", handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [showTopNavbar]);

  const toggleCard = (cardId: string) => {
    setCollapsedCards(prev => ({
      ...prev,
      [cardId]: !prev[cardId]
    }));
  };

  const scrollToSection = (sectionId: string) => {
    const el = document.getElementById(sectionId);
    if (!el) return;

    // Immediately set active section and lock it to prevent scroll bounceback
    setActiveSection(sectionId);
    isManualScrollingRef.current = true;
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    scrollTimeoutRef.current = setTimeout(() => {
      isManualScrollingRef.current = false;
    }, 850);

    // Find the scrollable ancestor container (div or window)
    const scrollContainer = getScrollContainer(el);

    // Header offset for sticky navigation
    const stickyOffset = (showTopNavbar ? 116 : 108) + 12;

    if (scrollContainer instanceof HTMLElement) {
      const containerRect = scrollContainer.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const targetTop = scrollContainer.scrollTop + (elRect.top - containerRect.top) - stickyOffset;
      
      scrollContainer.scrollTo({
        top: Math.max(0, targetTop),
        behavior: "smooth"
      });
    } else {
      const elRect = el.getBoundingClientRect().top;
      const bodyRect = document.body.getBoundingClientRect().top;
      window.scrollTo({
        top: Math.max(0, elRect - bodyRect - stickyOffset),
        behavior: "smooth"
      });
    }
  };

  const handleNativeShare = async () => {
    const currentUrl = lead.id ? getPublicShareUrl(lead.id) : window.location.href;
    const shareData = {
      title: displayTitle,
      text: `${displayTitle} • ${formattedPrice} • brokr.`,
      url: currentUrl
    };

    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share(shareData);
        return;
      } catch (err: any) {
        if (err?.name === "AbortError") {
          return;
        }
        console.warn("navigator.share failed, fallback to copy:", err);
      }
    }

    try {
      await navigator.clipboard.writeText(currentUrl);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2500);
      toast.success("Linkul public al proprietății a fost copiat în clipboard!");
    } catch {
      toast.error("Vă rugăm să copiați linkul manual.");
    }
  };

  const handleCopyLink = async () => {
    const currentUrl = lead.id ? getPublicShareUrl(lead.id) : window.location.href;
    try {
      await navigator.clipboard.writeText(currentUrl);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2500);
      toast.success("Linkul public al proprietății a fost copiat!");
    } catch {
      toast.error("Vă rugăm să copiați linkul manual.");
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleToggleFavorite = () => {
    const next = !isFavorite;
    setIsFavorite(next);
    try {
      if (next) {
        localStorage.setItem(favoriteStorageKey, "true");
        const isMac = typeof navigator !== "undefined" && (navigator.platform?.toUpperCase().indexOf("MAC") >= 0 || navigator.userAgent?.toUpperCase().indexOf("MAC") >= 0);
        const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

        if (isMobile) {
          toast.success("Salvat în favorite! Poți salva și din meniul browserului (⋮ sau Partajare) > Adaugă la semne de carte.", {
            duration: 5000,
            icon: "⭐"
          });
        } else if (isMac) {
          toast.success("Salvat în favorite! Apasă ⌘ + D pentru a adăuga proprietatea în semnele de carte ale browserului.", {
            duration: 5000,
            icon: "⭐"
          });
        } else {
          toast.success("Salvat în favorite! Apasă Ctrl + D pentru a adăuga proprietatea în semnele de carte ale browserului.", {
            duration: 5000,
            icon: "⭐"
          });
        }
      } else {
        localStorage.removeItem(favoriteStorageKey);
        toast("Proprietatea a fost eliminată din favorite.");
      }
    } catch {
      if (next) toast.success("Salvat în favorite!");
    }
  };

  const handleInquirySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formPhone.trim()) {
      toast.error("Vă rugăm să introduceți numele și numărul de telefon.");
      return;
    }
    setFormSubmitting(true);
    try {
      const isRentTransaction = String(lead.transactionType || "").toLowerCase().includes("închir") || String(lead.transactionType || "").toLowerCase().includes("inchir");
      const assignedAgent = leadAuthor.name || "Consilier Imobiliar";
      const notesContent = `Cerere vizionare trimisă de pe fișa proprietății #${internalCode} (${displayTitle}).\nClient: ${formName.trim()}\nTelefon: ${formPhone.trim()}${formEmail.trim() ? `\nEmail: ${formEmail.trim()}` : ""}${formMessage.trim() ? `\nMesaj client: ${formMessage.trim()}` : ""}\nAgent asignat: ${assignedAgent}`;

      const cerereDoc = await leadsService.addLead({
        url: lead.id ? getPublicShareUrl(lead.id) : (lead.url || ""),
        title: `Cerere vizionare: ${displayTitle}`,
        zone: lead.zone || "București",
        price: lead.price || "N/A",
        ownerName: formName.trim(),
        ownerPhone: formPhone.trim(),
        transactionType: lead.transactionType || (isRentTransaction ? "Închiriere" : "Vânzare"),
        categoria: lead.categoria || "Apartament",
        status: "Noua",
        leadType: isRentTransaction ? "Chirias" : "Cumparator",
        agent: assignedAgent,
        author: assignedAgent,
        createdByName: assignedAgent,
        notes: notesContent
      });

      const cerereDocId = (cerereDoc as any)?.id;

      await notificationsService.addNotification({
        title: `Cerere Nouă de Vizionare (#${internalCode})`,
        message: `${formName.trim()} (${formPhone.trim()}) a solicitat o vizionare pentru #${internalCode} - ${displayTitle}. Agent: ${assignedAgent}.`,
        type: 'cerere' as any,
        entityId: cerereDocId || lead.id,
        propertyId: internalCode,
        targetType: 'cerere'
      });

      setFormSent(true);
      toast.success("Solicitarea dumneavoastră a fost trimisă cu succes! A fost creată o cerere nouă asignată agentului.", {
        duration: 5000,
        icon: "📋"
      });
    } catch (err: any) {
      console.error("[PropertyDetailView] Error submitting inquiry:", err);
      toast.error("A apărut o problemă la înregistrarea cererii. Vă rugăm să contactați direct agentul prin apel telefonic sau WhatsApp.");
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleCopyOwnerPhone = async () => {
    if (!lead.ownerPhone) return;
    try {
      await navigator.clipboard.writeText(lead.ownerPhone);
      setCopiedOwnerPhone(true);
      setTimeout(() => setCopiedOwnerPhone(false), 2000);
      toast.success("Telefonul proprietarului a fost copiat!");
    } catch {
      toast.error("Nu s-a putut copia telefonul.");
    }
  };

  // Compile full image list
  const allImages = useMemo(() => {
    const images: string[] = [];
    if (lead?.coverImage && !images.includes(lead.coverImage)) {
      images.push(lead.coverImage);
    }
    const crmImagini = lead?.extractedData?.crmData?.imagini;
    if (crmImagini) {
      const categories = ["living", "camera", "bucatarie", "baie", "alteSpatii"] as const;
      categories.forEach(cat => {
        const list = crmImagini[cat];
        if (Array.isArray(list)) {
          list.forEach(item => {
            const url = typeof item === "string" ? item : item?.original;
            if (url && typeof url === "string" && !images.includes(url)) {
              images.push(url);
            }
          });
        }
      });
    }
    return images;
  }, [lead]);

  const crmData = lead?.extractedData?.crmData;
  const isRent = lead?.transactionType === "Închiriere" || crmData?.detaliiGenerale?.tranzactie === "Închiriere";
  const displayTitle = crmData?.descriere?.titlu || lead?.title || "Proprietate Rezidențială";
  const internalCode = lead?.propertyId || (lead?.id ? `P${lead.id.slice(0, 4)}` : "P41");
  const categoria = crmData?.detaliiGenerale?.categoria || lead?.categoria || "Apartament";

  // Sync document title with property title
  useEffect(() => {
    if (displayTitle) {
      document.title = `${displayTitle} • brokr.`;
    }
  }, [displayTitle]);

  // Address card values: Oras, Sector, Zona, Strada
  const addressDetails = useMemo(() => {
    const loc = crmData?.detaliiGenerale?.localizare;
    const rawZone = Array.isArray(loc?.zona) ? loc.zona.join(", ") : (loc?.zona || lead?.zone || "");
    
    let sector = "";
    const searchString = `${rawZone} ${loc?.strada || ""} ${lead?.title || ""}`.toLowerCase();
    const sectorMatch = searchString.match(/sector\s*([1-6])/i) || searchString.match(/s([1-6])\b/i);
    if (sectorMatch) {
      sector = `Sector ${sectorMatch[1]}`;
    } else if (rawZone.toLowerCase().includes("nord") || rawZone.toLowerCase().includes("aviatiei") || rawZone.toLowerCase().includes("floreasca") || rawZone.toLowerCase().includes("baneasa")) {
      sector = "Sector 1";
    } else if (rawZone.toLowerCase().includes("teclu") || rawZone.toLowerCase().includes("titan") || rawZone.toLowerCase().includes("dristor") || rawZone.toLowerCase().includes("pallady")) {
      sector = "Sector 3";
    } else if (rawZone.toLowerCase().includes("pipera")) {
      sector = "Ilfov / Nord";
    } else {
      sector = "Sector 1 / Central";
    }

    const oras = loc?.oras || "București";
    const zona = rawZone || "Aviației / Nord";
    const strada = loc?.strada || "Str. Șoseaua Pipera / Zonă rezidențială";

    return {
      oras,
      sector,
      zona,
      strada,
      fullSummary: `${strada}, ${zona}, ${sector}, ${oras}`
    };
  }, [crmData, lead]);

  // Formatted price
  const formattedPrice = useMemo(() => {
    if (crmData?.pret?.detalii?.pret) {
      const val = crmData.pret.detalii.pret;
      const currency = crmData.pret.detalii.moneda || "€";
      return isRent ? `${val} ${currency} / lună` : `${val} ${currency}`;
    }
    if (lead?.price) {
      return lead.price.includes("€") || lead.price.includes("EUR") 
        ? lead.price 
        : `${lead.price} €${isRent ? " / lună" : ""}`;
    }
    return isRent ? "775 € / lună" : "145.000 €";
  }, [crmData, lead, isRent]);

  // Characteristics derived with intelligent fallbacks from crmData or lead text
  const rawDescText = `${crmData?.descriere?.continut || ""} ${(lead as any)?.description || ""} ${lead?.title || ""} ${lead?.notes || ""}`;

  const suprafataUtilaRaw = crmData?.caracteristici?.suprafete?.utila 
    || (lead as any)?.surface 
    || (lead as any)?.suprafata 
    || (lead as any)?.area;
  let suprafataFromText = "";
  if (!suprafataUtilaRaw) {
    const m = rawDescText.match(/(\d+)\s*(?:mp|m2|mp\b)/i);
    if (m) suprafataFromText = m[1];
  }
  const suprafataUtila = suprafataUtilaRaw 
    ? (String(suprafataUtilaRaw).includes("mp") ? String(suprafataUtilaRaw) : `${suprafataUtilaRaw} mp`) 
    : (suprafataFromText ? `${suprafataFromText} mp` : "-");

  let compFromText = "";
  const leadCompRaw = crmData?.caracteristici?.detalii?.compartimentare 
    || (lead as any)?.compartimentare 
    || (lead as any)?.partitioning;
  if (!leadCompRaw) {
    const textLower = rawDescText.toLowerCase();
    if (textLower.includes("semidecomandat")) compFromText = "Semidecomandat";
    else if (textLower.includes("decomandat")) compFromText = "Decomandat";
    else if (textLower.includes("nedecomandat")) compFromText = "Nedecomandat";
    else if (textLower.includes("circular")) compFromText = "Circular";
    else if (textLower.includes("open space") || textLower.includes("openspace")) compFromText = "Open space";
  }
  const compartimentare = leadCompRaw || compFromText || "Decomandat";

  let etajFromText = "";
  const leadEtajRaw = crmData?.caracteristici?.detalii?.etaj 
    || (lead as any)?.floor 
    || (lead as any)?.etaj;
  if (!leadEtajRaw) {
    const m = rawDescText.match(/etaj(?:ul)?\s*(\d+)(?:\s*(?:\/|din|\s)\s*(\d+))?/i) 
      || rawDescText.match(/et\.?\s*(\d+)/i)
      || rawDescText.match(/\betaj\s*(\d+)\b/i);
    if (m) etajFromText = m[2] ? `${m[1]} / ${m[2]}` : `${m[1]}`;
  }
  const etajVal = leadEtajRaw || etajFromText;
  const totalEtaje = (crmData?.caracteristici?.detalii as any)?.totalEtaje 
    || crmData?.caracteristici?.alteDetalii?.niveluriConstructie
    || (lead as any)?.totalEtaje
    || (lead as any)?.totalFloors;
  const etaj = etajVal 
    ? (totalEtaje && !String(etajVal).includes(String(totalEtaje)) ? `${etajVal} / ${totalEtaje}` : String(etajVal))
    : "-";

  let anFromText = "";
  const leadAnRaw = crmData?.caracteristici?.alteDetalii?.anConstructie 
    || (lead as any)?.year 
    || (lead as any)?.an 
    || (lead as any)?.anConstructie 
    || (lead as any)?.constructionYear;
  if (!leadAnRaw) {
    const m = rawDescText.match(/(?:anul?|construit|bloc)\s*(?:în|in)?\s*(19\d{2}|20\d{2})/i) 
      || rawDescText.match(/\b(19\d{2}|20[0-2]\d)\b/);
    if (m) anFromText = m[1];
  }
  const anConstructie = leadAnRaw || anFromText || "-";

  let camereFromText = "";
  const leadCamereRaw = crmData?.caracteristici?.detalii?.camere 
    || (lead as any)?.rooms 
    || (lead as any)?.camere 
    || (lead as any)?.bedrooms;
  if (!leadCamereRaw) {
    const m = rawDescText.match(/(\d+)\s*camere/i);
    if (m) camereFromText = m[1];
    else if (rawDescText.toLowerCase().includes("garsonieră") || rawDescText.toLowerCase().includes("studio")) camereFromText = "1";
  }
  const camere = leadCamereRaw || camereFromText || "-";

  let baiFromText = "";
  const leadBaiRaw = crmData?.caracteristici?.detalii?.bai 
    || (lead as any)?.bathrooms 
    || (lead as any)?.bai;
  if (!leadBaiRaw) {
    const m = rawDescText.match(/(\d+)\s*b[aă]i/i);
    if (m) baiFromText = m[1];
  }
  const bai = leadBaiRaw || baiFromText || "-";

  let balcoaneFromText = "";
  const leadBalcoaneRaw = crmData?.caracteristici?.suprafete?.balcoane 
    || (crmData?.caracteristici?.detalii as any)?.balcoane 
    || (lead as any)?.balconies 
    || (lead as any)?.balcoane;
  if (!leadBalcoaneRaw) {
    const m = rawDescText.match(/(\d+)\s*balco?ane?/i);
    if (m) balcoaneFromText = m[1];
  }
  const balcoaneRaw = leadBalcoaneRaw || balcoaneFromText;
  const balcoane = balcoaneRaw ? String(balcoaneRaw) : "-";

  const leadStareRaw = (crmData?.utilitati?.finisaje?.stare && crmData.utilitati.finisaje.stare.length > 0)
    ? (Array.isArray(crmData.utilitati.finisaje.stare) ? crmData.utilitati.finisaje.stare.join(", ") : String(crmData.utilitati.finisaje.stare))
    : (crmData?.caracteristici?.alteDetalii?.stadiuConstructie || (lead as any)?.stare || (lead as any)?.condition);
  const stareInterior = leadStareRaw || "Buna";

  // Bedroom and Bathroom dynamic counts for row filtering
  const rawDormitoare = crmData?.caracteristici?.detalii?.dormitoare || (lead as any)?.bedrooms || (lead as any)?.dormitoare;
  const explicitDormitoare = rawDormitoare ? parseInt(String(rawDormitoare).match(/\d+/)?.[0] || "0", 10) : 0;
  const parsedCamere = parseInt(String(camere || "").match(/\d+/)?.[0] || "0", 10);
  const bedroomCount = explicitDormitoare > 0 
    ? explicitDormitoare 
    : (parsedCamere > 1 ? parsedCamere - 1 : (parsedCamere === 1 ? 1 : 1));
  const parsedBai = parseInt(String(bai || "").match(/\d+/)?.[0] || "0", 10);
  const baiCount = Math.max(1, parsedBai || 1);

  // Default agency commission per user rules:
  // - Sale: 0%
  // - Rent: 50%+TVA
  const defaultCommission = isRent ? "50%+TVA" : "0%";

  // Guarantee and advance
  const garantie = crmData?.pret?.detalii?.garantie || (isRent ? `${crmData?.pret?.detalii?.pret || "775"} €` : "-");
  const avans = crmData?.pret?.detalii?.avans || (isRent ? "1 lună" : "15%");

  // Natural summary generated from crawler data:
  // Includes all configurare section data (suprafață utilă, compartimentare, etaj, an construcție, camere, băi, balcon, stare)
  // and area where property is found, composed in an easy to read expression strictly <= 512 characters.
  const summaryDescription = useMemo(() => {
    const saved = (lead as any)?.extractedData?.presentationSections?.introducere?.summary;
    if (saved && typeof saved === "string" && saved.trim().length > 15 && saved.trim().length <= 512) {
      return saved.trim();
    }

    const camereStr = camere && camere !== "-" ? `${camere} camere` : "";
    const suprafataStr = suprafataUtila && suprafataUtila !== "-" ? `${suprafataUtila.replace(/mp/i, "").trim()} mp utili` : "";
    const compStr = compartimentare && compartimentare !== "-" ? compartimentare.toLowerCase() : "decomandat";
    
    let etajStr = "";
    if (etaj && etaj !== "-") {
      const e = etaj.trim();
      etajStr = e.toLowerCase().startsWith("etaj") || e.toLowerCase() === "parter" || e.toLowerCase() === "demisol"
        ? `la ${e.toLowerCase()}`
        : `la etajul ${e}`;
    }

    const anStr = anConstructie && anConstructie !== "-" && anConstructie !== "după 2000"
      ? `într-un bloc din ${anConstructie}`
      : "";

    const stareStr = stareInterior && stareInterior !== "-"
      ? `în stare ${stareInterior.toLowerCase()}`
      : "în stare bună";

    const baiStr = bai && bai !== "-" && bai !== "0"
      ? (parseInt(bai) > 1 ? `${bai} băi` : "o baie")
      : "";

    let balconStr = "";
    if (balcoane && balcoane !== "-" && balcoane !== "0") {
      balconStr = parseInt(balcoane) > 1 ? `${balcoane} balcoane` : "balcon";
    }

    const zonaLoc = addressDetails.zona && addressDetails.zona !== "Nespecificat"
      ? `în zona ${addressDetails.zona}`
      : "într-o zonă accesibilă";

    const mainSpecsList = [camereStr, suprafataStr].filter(Boolean);
    const mainSpecsText = mainSpecsList.length > 0 ? mainSpecsList.join(", ") : "spațiu generos";

    let sentence1 = `Apartament cu ${mainSpecsText}, compartimentat ${compStr}${etajStr ? `, situat ${etajStr}` : ""}${anStr ? ` ${anStr}` : ""}, ${stareStr}.`;
    
    const extraFeatures = [baiStr, balconStr].filter(Boolean).join(" și ");
    let sentence2 = extraFeatures
      ? `Locuința dispune de ${extraFeatures}, fiind excelent poziționată ${zonaLoc}, aproape de transport și facilități urbane.`
      : `Locuința este excelent poziționată ${zonaLoc}, oferind confort deosebit și acces facil către toate punctele de interes.`;

    let fullSummary = `${sentence1} ${sentence2}`.trim();

    if (fullSummary.length > 512) {
      fullSummary = fullSummary.substring(0, 508).replace(/\s+[^\s]*$/, "") + "...";
    }

    return fullSummary;
  }, [
    (lead as any)?.extractedData?.presentationSections?.introducere?.summary,
    camere,
    suprafataUtila,
    compartimentare,
    etaj,
    anConstructie,
    stareInterior,
    bai,
    balcoane,
    addressDetails.zona
  ]);

  // Real author of the lead generation (the user who initialized importing the data)
  const leadAuthor = useMemo(() => {
    const l = lead as any;
    let name = l.createdByName || l.author || l.agent || l.assignedTo || "";
    let email = l.createdByEmail || "";
    let phone = l.authorPhone || l.agentPhone || "";
    let role = l.authorRole || "Consilier Imobiliar • brokr.";

    if (!name && l.createdBy) {
      const s = String(l.createdBy);
      if (s.includes("@")) {
        email = s;
        name = s.split("@")[0];
        name = name.charAt(0).toUpperCase() + name.slice(1);
      } else {
        name = s;
      }
    }

    if (!name && auth.currentUser) {
      name = auth.currentUser.displayName || (auth.currentUser.email ? auth.currentUser.email.split("@")[0] : "");
      if (name) name = name.charAt(0).toUpperCase() + name.slice(1);
      email = auth.currentUser.email || "";
      if (auth.currentUser.phoneNumber) phone = auth.currentUser.phoneNumber;
    }

    if (!name) {
      name = "Consilier brokr.";
    }

    return {
      name,
      email: email || "contact@brokr.ro",
      phone: phone || "0700 000 000",
      role,
      agency: "Agenția Imobiliară brokr."
    };
  }, [lead]);

  // Section Data with persistence fallback from Firestore (extractedData.presentationSections)
  const initialPresentationSections = useMemo<Record<string, Record<string, string>>>(() => {
    const saved = (lead as any)?.extractedData?.presentationSections || {};
    return {
      introducere: {
        summary: saved.introducere?.summary || summaryDescription
      },
      configuratie: {
        "Suprafață utilă": saved.configuratie?.["Suprafață utilă"] || suprafataUtila,
        "Compartimentare": saved.configuratie?.["Compartimentare"] || compartimentare,
        "Etaj": saved.configuratie?.["Etaj"] || etaj,
        "An construcție": saved.configuratie?.["An construcție"] || anConstructie,
        "Număr camere": saved.configuratie?.["Număr camere"] || String(camere),
        "Număr băi": saved.configuratie?.["Număr băi"] || String(bai),
        "Balcon": saved.configuratie?.["Balcon"] || String(balcoane),
        "Stare": saved.configuratie?.["Stare"] || stareInterior,
        ...(saved.configuratie || {})
      },
      finisaje: {
        "Living": saved.finisaje?.["Living"] || "vopsea lavabilă, parchet",
        "Camera 1": saved.finisaje?.["Camera 1"] || "vopsea lavabilă, parchet",
        "Camera 2": saved.finisaje?.["Camera 2"] || "vopsea lavabilă, parchet",
        "Camera 3": saved.finisaje?.["Camera 3"] || "vopsea lavabilă, parchet",
        "Camera 4": saved.finisaje?.["Camera 4"] || "vopsea lavabilă, parchet",
        "Bucătărie": saved.finisaje?.["Bucătărie"] || "vopsea lavabilă, faianță și gresie",
        "Baie 1": saved.finisaje?.["Baie 1"] || "faianță și gresie",
        "Baie 2": saved.finisaje?.["Baie 2"] || "faianță și gresie",
        "Baie 3": saved.finisaje?.["Baie 3"] || "faianță și gresie",
        "Baie 4": saved.finisaje?.["Baie 4"] || "faianță și gresie",
        "Hol": saved.finisaje?.["Hol"] || "vopsea lavabilă, parchet",
        ...(saved.finisaje || {})
      },
      mobilare: {
        "Living": saved.mobilare?.["Living"] || "canapea, măsuță cafea, comodă",
        "Camera 1": saved.mobilare?.["Camera 1"] || "pat, noptiere, dulap",
        "Camera 2": saved.mobilare?.["Camera 2"] || "pat, noptiere, dulap",
        "Camera 3": saved.mobilare?.["Camera 3"] || "pat, noptiere, dulap",
        "Camera 4": saved.mobilare?.["Camera 4"] || "pat, noptiere, dulap",
        "Bucătărie": saved.mobilare?.["Bucătărie"] || "mobilă de bucatarie premium",
        "Baie 1": saved.mobilare?.["Baie 1"] || "obiecte sanitare premium",
        "Baie 2": saved.mobilare?.["Baie 2"] || "obiecte sanitare premium",
        "Baie 3": saved.mobilare?.["Baie 3"] || "obiecte sanitare premium",
        "Baie 4": saved.mobilare?.["Baie 4"] || "obiecte sanitare premium",
        "Hol": saved.mobilare?.["Hol"] || "cuier, pantofar",
        ...(saved.mobilare || {})
      },
      dotari: {
        "Living": saved.dotari?.["Living"] || "aer condiționat, smart TV",
        "Camera 1": saved.dotari?.["Camera 1"] || "-",
        "Camera 2": saved.dotari?.["Camera 2"] || "-",
        "Camera 3": saved.dotari?.["Camera 3"] || "-",
        "Camera 4": saved.dotari?.["Camera 4"] || "-",
        "Bucătărie": saved.dotari?.["Bucătărie"] || "frigider, plită, cuptor, hotă",
        "Baie 1": saved.dotari?.["Baie 1"] || "-",
        "Baie 2": saved.dotari?.["Baie 2"] || "-",
        "Hol": saved.dotari?.["Hol"] || "interfon",
        "Altele": saved.dotari?.["Altele"] || "-",
        ...(saved.dotari || {})
      },
      bloc: {
        "Acces": saved.bloc?.["Acces"] || "Tag magnetic, interfon",
        "Spații": saved.bloc?.["Spații"] || "-",
        "Dotări": saved.bloc?.["Dotări"] || "Lift, supraveghere video",
        "Servicii": saved.bloc?.["Servicii"] || "Administrație, curățenie spații comune",
        ...(saved.bloc || {})
      },
      imprejurimi: {
        "Educație": saved.imprejurimi?.["Educație"] || "Grădinițe de stat și private, școli gimnaziale, licee în apropiere",
        "Comerț": saved.imprejurimi?.["Comerț"] || "Numeroase magazine de proximitate.",
        "Benzinării": saved.imprejurimi?.["Benzinării"] || "Multiple statii de alimentare.",
        "Sănătate": saved.imprejurimi?.["Sănătate"] || "Diverse farmacii.",
        "Relaxare": saved.imprejurimi?.["Relaxare"] || "Spatii verzi in apropiere.",
        "Divertisment": saved.imprejurimi?.["Divertisment"] || "Restaurante, baruri si cafenele in zona.",
        "Obiective": saved.imprejurimi?.["Obiective"] || "Diverse puncte de atracie din sector.",
        ...(saved.imprejurimi || {})
      },
      parcare: {
        "Parcare": saved.parcare?.["Parcare"] || "Publica in zona",
        ...(saved.parcare || {})
      },
      acte: {
        "Situație juridică": saved.acte?.["Situație juridică"] || "Fara probleme",
        "Disponibilitate": saved.acte?.["Disponibilitate"] || "Imediată",
        "Finanțare": saved.acte?.["Finanțare"] || "Credit bancar / fonduri proprii",
        "Condiții contractuale": saved.acte?.["Condiții contractuale"] || "Contract pe minimum 12 luni",
        "Avans": saved.acte?.["Avans"] || "1 lună",
        "Garanție": saved.acte?.["Garanție"] || "1 lună",
        ...(saved.acte || {})
      },
      tranzactie: {
        "Preț": saved.tranzactie?.["Preț"] || formattedPrice,
        "TVA": saved.tranzactie?.["TVA"] || "Scutit de TVA / conform legislației în vigoare",
        "Comision": saved.tranzactie?.["Comision"] || defaultCommission,
        ...(saved.tranzactie || {})
      }
    };
  }, [lead, summaryDescription, suprafataUtila, compartimentare, etaj, anConstructie, camere, bai, balcoane, stareInterior, formattedPrice, defaultCommission]);

  const [sectionData, setSectionData] = useState<Record<string, Record<string, string>>>(initialPresentationSections);
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [draftSectionData, setDraftSectionData] = useState<Record<string, Record<string, string>>>({});
  const [introFocused, setIntroFocused] = useState(false);
  const introTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Photos state and inline editing
  const [imagesList, setImagesList] = useState<string[]>(allImages);
  const [isEditingPhotos, setIsEditingPhotos] = useState<boolean>(false);
  const [isPhotosDirty, setIsPhotosDirty] = useState<boolean>(false);
  const [isDraggingOverCard, setIsDraggingOverCard] = useState<boolean>(false);
  const [draggedSlotIndex, setDraggedSlotIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const [slotPage, setSlotPage] = useState<number>(0);
  const photoFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditingPhotos) {
      setImagesList(allImages);
      setIsPhotosDirty(false);
    }
  }, [allImages, isEditingPhotos]);

  useEffect(() => {
    const page = Math.floor(carouselIndex / 4);
    if (page !== slotPage) {
      setSlotPage(page);
    }
  }, [carouselIndex]);

  const handleSavePhotos = async () => {
    if (!lead?.id) return;
    try {
      const newCover = imagesList[0] || "";
      const updates: any = {
        coverImage: newCover,
        "extractedData.crmData.imagini.living": imagesList
      };
      await leadsService.updateLeadData(lead.id, updates);
      setIsEditingPhotos(false);
      setIsPhotosDirty(false);
      toast.success("Fotografiile au fost salvate cu succes!");
    } catch (err) {
      console.error("Failed to save photos:", err);
      toast.error("Eroare la salvarea fotografiilor.");
    }
  };

  const handleCancelPhotos = () => {
    setImagesList(allImages);
    setIsEditingPhotos(false);
    setIsPhotosDirty(false);
  };

  const handleAddPhotoFiles = (files: FileList | File[]) => {
    const fileArray = Array.from(files).filter(f => f.type.startsWith("image/"));
    if (fileArray.length === 0) {
      toast.error("Vă rugăm să selectați fișiere imagine valide (JPG, PNG, WEBP).");
      return;
    }

    const newImgs: string[] = [];
    let readCount = 0;
    fileArray.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target?.result && typeof e.target.result === "string") {
          newImgs.push(e.target.result);
        }
        readCount++;
        if (readCount === fileArray.length) {
          setImagesList(prev => [...prev, ...newImgs]);
          setIsPhotosDirty(true);
          setIsEditingPhotos(true);
          toast.success(`${newImgs.length} ${newImgs.length === 1 ? "fotografie adăugată" : "fotografii adăugate"}!`);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  useEffect(() => {
    setSectionData(prev => ({
      ...initialPresentationSections,
      ...(editingSection && prev[editingSection] ? { [editingSection]: prev[editingSection] } : {})
    }));
  }, [initialPresentationSections, editingSection]);

  const handleStartEditSection = (sectionId: string) => {
    setEditingSection(sectionId);
    setDraftSectionData(prev => ({
      ...prev,
      [sectionId]: { ...(sectionData[sectionId] || {}) }
    }));
  };

  const handleCancelEditSection = (sectionId: string) => {
    setEditingSection(null);
    setDraftSectionData(prev => {
      const copy = { ...prev };
      delete copy[sectionId];
      return copy;
    });
  };

  const handleFieldChange = (sectionId: string, label: string, value: string) => {
    setDraftSectionData(prev => ({
      ...prev,
      [sectionId]: {
        ...(prev[sectionId] || sectionData[sectionId] || {}),
        [label]: value
      }
    }));
  };

  const isSectionDirty = (sectionId: string) => {
    if (editingSection !== sectionId) return false;
    const currentDraft = draftSectionData[sectionId];
    if (!currentDraft) return false;
    const original = sectionData[sectionId] || {};
    return Object.keys(currentDraft).some(k => (currentDraft[k] ?? "") !== (original[k] ?? ""));
  };

  const handleSaveSection = async (sectionId: string) => {
    const updatedSec = { ...(draftSectionData[sectionId] || sectionData[sectionId]) };
    const nextSectionData = {
      ...sectionData,
      [sectionId]: updatedSec
    };
    setSectionData(nextSectionData);
    setEditingSection(null);

    if (!lead?.id) return;
    try {
      const updates: any = {
        "extractedData.presentationSections": nextSectionData
      };

      if (sectionId === "configuratie") {
        if (updatedSec["Suprafață utilă"]) updates["extractedData.crmData.caracteristici.suprafete.utila"] = updatedSec["Suprafață utilă"];
        if (updatedSec["Compartimentare"]) updates["extractedData.crmData.caracteristici.detalii.compartimentare"] = updatedSec["Compartimentare"];
        if (updatedSec["Etaj"]) updates["extractedData.crmData.caracteristici.detalii.etaj"] = updatedSec["Etaj"];
        if (updatedSec["An construcție"]) updates["extractedData.crmData.caracteristici.alteDetalii.anConstructie"] = updatedSec["An construcție"];
        if (updatedSec["Număr camere"]) updates["extractedData.crmData.caracteristici.detalii.camere"] = updatedSec["Număr camere"];
        if (updatedSec["Număr băi"]) updates["extractedData.crmData.caracteristici.detalii.bai"] = updatedSec["Număr băi"];
        if (updatedSec["Balcon"]) updates["extractedData.crmData.caracteristici.suprafete.balcoane"] = updatedSec["Balcon"];
        if (updatedSec["Stare"]) updates["extractedData.crmData.caracteristici.alteDetalii.stadiuConstructie"] = updatedSec["Stare"];
      } else if (sectionId === "tranzactie") {
        if (updatedSec["Preț"]) {
          updates["price"] = updatedSec["Preț"];
          updates["extractedData.crmData.pret.detalii.pret"] = updatedSec["Preț"];
        }
      } else if (sectionId === "introducere") {
        if (updatedSec["summary"]) {
          updates["extractedData.crmData.descriere.continut"] = updatedSec["summary"];
        }
      }

      await leadsService.updateLeadData(lead.id, updates);
      toast.success("Modificările au fost salvate cu succes!");
    } catch (e) {
      console.error("Failed to save inline changes:", e);
      toast.error("Eroare la salvarea modificărilor.");
    }
  };

  const renderRow = (
    sectionId: string, 
    label: string, 
    fallbackVal: string, 
    isLast: boolean = false, 
    multiline: boolean = false
  ) => {
    const isSecEditing = editingSection === sectionId;
    const originalVal = sectionData[sectionId]?.[label] ?? fallbackVal;
    const currentVal = isSecEditing 
      ? (draftSectionData[sectionId]?.[label] ?? originalVal) 
      : originalVal;

    const valStr = typeof currentVal === "string" ? currentVal.trim() : (currentVal == null ? "" : String(currentVal).trim());

    // User rule: Where there is a "-", if no data has been found on the url provided for crawling, just remove that row of data in the page.
    if (!isSecEditing && (valStr === "-" || valStr === "" || valStr === "N/A" || valStr === "null")) {
      return null;
    }

    return (
      <AttributeRow
        key={label}
        label={label}
        value={valStr === "-" ? "" : currentVal}
        copyValue={typeof currentVal === "string" && currentVal !== "-" ? currentVal : ""}
        isEditing={isSecEditing}
        editValue={typeof currentVal === "string" && currentVal !== "-" ? currentVal : ""}
        onEditChange={(newVal) => handleFieldChange(sectionId, label, newVal)}
        multiline={multiline}
        isLast={isLast}
      />
    );
  };

  return (
    <div ref={containerRef} className="w-full bg-white text-gray-900 flex flex-col font-sans selection:bg-[#BE9662]/20 min-h-screen">
      
      {/* Top Navbar (only for standalone public share page) - Matches exact in-app top header dimensions */}
      {showTopNavbar && (
        <nav className="sticky top-0 z-40 bg-white border-b border-gray-200 select-none">
          <div className="w-full h-[50px] flex items-center justify-between p-0">
            <div className="flex items-center h-full">
              <a 
                href="/"
                className="h-full w-[50px] aspect-square flex items-center justify-center border-r border-gray-200 bg-white hover:bg-gray-50 text-gray-500 hover:text-[#051D35] transition-colors shrink-0 select-none group"
                title="Înapoi la pagina principală"
              >
                <ChevronLeft size={18} className="text-gray-500 group-hover:text-gray-900 transition-colors" />
              </a>
              <div className="px-4 flex items-center gap-1.5 focus:outline-none">
                <span className="font-extrabold text-base tracking-tight text-[#051D35] font-sans flex items-center">
                  brokr<span className="text-[#BE9662]">.</span>
                </span>
              </div>
            </div>

            <div className="flex items-stretch h-full shrink-0">
              <button
                type="button"
                onClick={handleToggleFavorite}
                className={`h-full w-[50px] aspect-square flex items-center justify-center border-l border-gray-200 transition-colors cursor-pointer select-none group ${
                  isFavorite 
                    ? "bg-amber-50/50 text-[#BE9662]" 
                    : "bg-white hover:bg-gray-50 text-gray-500 hover:text-gray-900"
                }`}
                title={isFavorite ? "Elimină din favorite" : "Salvează ca favorit"}
              >
                <Bookmark size={16} className={isFavorite ? "fill-[#BE9662] text-[#BE9662]" : "text-gray-500 group-hover:text-[#BE9662] transition-colors"} />
              </button>

              <button
                type="button"
                onClick={handlePrint}
                className="h-full w-[50px] aspect-square flex items-center justify-center border-l border-gray-200 bg-white hover:bg-gray-50 text-gray-500 hover:text-gray-900 transition-colors shrink-0 cursor-pointer select-none group"
                title="Tipărește oferta"
              >
                <Printer size={16} className="text-gray-500 group-hover:text-gray-900 transition-colors" />
              </button>

              <button
                type="button"
                onClick={handleNativeShare}
                className="h-full w-[50px] aspect-square flex items-center justify-center border-l border-gray-200 bg-white hover:bg-gray-50 text-gray-500 hover:text-[#051D35] transition-colors shrink-0 cursor-pointer select-none group"
                title="Distribuie proprietatea prin aplicația nativă a dispozitivului"
              >
                <Share2 size={16} className="text-gray-500 group-hover:text-[#051D35] transition-colors" />
              </button>
            </div>
          </div>
        </nav>
      )}

      {/* Horizontal Sticky Menu with Jump Links (Left) and Actions (Right) - Fixed at top-[50px] below Title Row */}
      <div className="sticky top-[50px] z-20 bg-white border-b border-gray-200 shadow-xs select-none">
        <div className="w-full h-10 flex items-stretch justify-between p-0">
          {/* Left: Jump Links (no borders between, left menu hover effect & bottom golden border for active) */}
          <div className="flex items-stretch overflow-x-auto no-scrollbar">
            {NAV_SECTIONS.map((sect) => {
              const Icon = sect.icon;
              const isActive = activeSection === sect.id;

              return (
                <button
                  key={sect.id}
                  type="button"
                  onClick={() => scrollToSection(sect.id)}
                  className={`h-full px-3.5 sm:px-4 rounded-none text-xs transition-colors flex items-center gap-1.5 cursor-pointer shrink-0 select-none border-b-4 group font-sans ${
                    isActive
                      ? "bg-gray-100 text-gray-900 font-semibold border-b-[#BE9662]"
                      : "text-gray-700 hover:bg-gray-50 hover:text-gray-900 border-b-transparent font-medium"
                  }`}
                >
                  <Icon size={14} className={isActive ? "text-[#BE9662]" : "text-gray-500 group-hover:text-gray-900 transition-colors"} />
                  <span className="uppercase text-[11px] font-semibold tracking-wider">{sect.label}</span>
                </button>
              );
            })}
          </div>

          {/* Right: Actions (no borders between, left menu hover effect, except activitate) */}
          <div className="flex items-stretch h-full shrink-0">
            {/* 1. Șterge */}
            {!isPublicShared && onDelete && (
              <button 
                type="button"
                onClick={onDelete}
                className="h-full aspect-square flex items-center justify-center bg-white hover:bg-gray-50 text-gray-500 hover:text-red-600 transition-colors shrink-0 cursor-pointer select-none group rounded-none"
                title="Mută în Șterse"
              >
                <Trash2 size={15} className="text-gray-500 group-hover:text-red-600 transition-colors" />
              </button>
            )}

            {/* 2. Printează */}
            <button
              type="button"
              onClick={handlePrint}
              className="h-full aspect-square flex items-center justify-center bg-white hover:bg-gray-50 text-gray-500 hover:text-gray-900 transition-colors shrink-0 cursor-pointer select-none group rounded-none"
              title="Tipărește oferta"
            >
              <Printer size={15} className="text-gray-500 group-hover:text-gray-900 transition-colors" />
            </button>

            {/* 3. Distribuie */}
            <button
              type="button"
              onClick={handleNativeShare}
              className="h-full aspect-square flex items-center justify-center bg-white hover:bg-gray-50 text-gray-500 hover:text-gray-900 transition-colors shrink-0 cursor-pointer select-none group rounded-none"
              title="Distribuie proprietatea prin aplicația nativă a dispozitivului"
            >
              <Share2 size={15} className="text-gray-500 group-hover:text-gray-900 transition-colors" />
            </button>

            {/* 4. Link extern */}
            {lead?.url ? (
              <a
                href={lead.url}
                target="_blank"
                rel="noopener noreferrer"
                className="h-full aspect-square flex items-center justify-center bg-white hover:bg-gray-50 text-gray-500 hover:text-gray-900 transition-colors shrink-0 select-none group rounded-none"
                title="Deschide anunțul sursă extern"
              >
                <ExternalLink size={15} className="text-gray-500 group-hover:text-gray-900 transition-colors" />
              </a>
            ) : (
              <button
                type="button"
                disabled
                className="h-full aspect-square flex items-center justify-center bg-white text-gray-300 cursor-not-allowed shrink-0 select-none rounded-none"
                title="Fără link sursă extern"
              >
                <ExternalLink size={15} className="text-gray-300" />
              </button>
            )}

            {/* 5. Activitate (PRIMARY - kept distinct per user request) */}
            {!isPublicShared && onAddActivity && (
              <button
                type="button"
                onClick={onAddActivity}
                className="h-full px-3.5 sm:px-4 flex items-center gap-1.5 bg-[#051D35] hover:bg-[#0a2b4a] text-white text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer select-none shrink-0 group rounded-none"
                title="Adaugă activitate pentru această proprietate"
              >
                <Plus size={13} className="text-[#BE9662]" />
                <span>Activitate</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Two-Column Layout (Seamless with inside padding & border divider) */}
      <main className="w-full flex-1 bg-white p-0">
        <div className="grid grid-cols-1 lg:grid-cols-12 min-h-full items-start">
          
          {/* Left Column: All Content Cards (8 cols on lg) with clean right border */}
          <div className="lg:col-span-8 p-4 sm:p-6 lg:p-7 space-y-6 border-b lg:border-b-0 lg:border-r border-gray-200">

            {/* #CARD 1: "PREȚ" (First card in Column 1 per user request) */}
            <div id="tranzactie" className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs scroll-mt-28 sm:scroll-mt-32 font-sans">
              <div className="px-6 py-4 bg-gray-50/80 border-b border-gray-200 flex items-center justify-between select-none">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#051D35]/5 text-[#051D35] flex items-center justify-center font-bold">
                    <BadgePercent size={16} />
                  </div>
                  <div>
                    <h2 className="text-xs font-bold text-gray-900 uppercase tracking-wider font-sans">
                      PREȚ
                    </h2>
                    <span className="text-[11px] text-gray-500 font-sans">
                      Preț, TVA și Comision agenție
                    </span>
                  </div>
                </div>

                <SectionEditButton
                  isEditing={editingSection === "tranzactie"}
                  isDirty={isSectionDirty("tranzactie")}
                  onStartEdit={() => handleStartEditSection("tranzactie")}
                  onCancel={() => handleCancelEditSection("tranzactie")}
                  onSave={() => handleSaveSection("tranzactie")}
                  disabled={isPublicShared}
                />
              </div>

              <div className="font-sans divide-y divide-gray-100">
                {renderRow("tranzactie", "Preț", formattedPrice)}
                {renderRow("tranzactie", "TVA", "Scutit de TVA / conform legislației în vigoare")}
                {renderRow("tranzactie", "Comision", defaultCommission, true)}
              </div>
            </div>

            {/* #CARD 2: "INTRODUCERE" */}
            <div id="introducere" className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs scroll-mt-28 sm:scroll-mt-32 font-sans">
              <div className="px-6 py-4 bg-gray-50/80 border-b border-gray-200 flex items-center justify-between select-none">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#051D35]/5 text-[#051D35] flex items-center justify-center font-bold">
                    <FileText size={16} />
                  </div>
                  <div>
                    <h2 className="text-xs font-bold text-gray-900 uppercase tracking-wider font-sans">
                      INTRODUCERE
                    </h2>
                    <span className="text-[11px] font-mono text-[#BE9662] font-semibold">
                      (Cod intern: {internalCode})
                    </span>
                  </div>
                </div>

                <SectionEditButton
                  isEditing={editingSection === "introducere"}
                  isDirty={isSectionDirty("introducere")}
                  onStartEdit={() => handleStartEditSection("introducere")}
                  onCancel={() => handleCancelEditSection("introducere")}
                  onSave={() => handleSaveSection("introducere")}
                  disabled={isPublicShared}
                />
              </div>

              <div className="p-6 font-sans">
                {editingSection === "introducere" ? (
                  <div 
                    onClick={() => introTextareaRef.current?.focus()}
                    className={`p-3.5 transition-all font-sans cursor-text ${
                      introFocused 
                        ? "bg-amber-50/40 border-l-3 border-l-[#BE9662]" 
                        : "bg-transparent border-l-3 border-l-transparent hover:bg-amber-50/15"
                    }`}
                  >
                    <textarea
                      ref={introTextareaRef}
                      rows={5}
                      value={draftSectionData["introducere"]?.["summary"] ?? (sectionData["introducere"]?.["summary"] || summaryDescription)}
                      onChange={(e) => handleFieldChange("introducere", "summary", e.target.value)}
                      onFocus={() => setIntroFocused(true)}
                      onBlur={() => setIntroFocused(false)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") (e.target as HTMLElement).blur();
                      }}
                      className={`w-full text-xs sm:text-sm font-sans leading-relaxed bg-transparent border-0 rounded-none p-0 m-0 outline-none resize-y select-text focus:outline-none transition-all ${
                        introFocused ? "text-[#051D35] font-medium" : "text-gray-700"
                      }`}
                      placeholder="Descrierea proprietății..."
                    />
                  </div>
                ) : (
                  <div className="text-xs sm:text-sm text-gray-700 leading-relaxed space-y-3 font-normal whitespace-pre-line select-text font-sans p-3.5 border-l-3 border-l-transparent">
                    {sectionData["introducere"]?.["summary"] || summaryDescription}
                  </div>
                )}
              </div>
            </div>

            {/* #CARD "APARTAMENT" */}
            <div id="apartament" className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs scroll-mt-28 sm:scroll-mt-32">
              <div className="px-6 py-4 bg-gray-50/80 border-b border-gray-200 flex items-center justify-between select-none">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#051D35]/5 text-[#051D35] flex items-center justify-center font-bold">
                    <Home size={16} />
                  </div>
                  <h2 className="text-xs font-bold text-gray-900 uppercase tracking-wider">
                    APARTAMENT
                  </h2>
                </div>
              </div>

              <div className="font-sans divide-y divide-gray-100">
                {/* -Subcategorie "Configuratie" */}
                <div>
                  <SubCategoryHeader 
                    title="Configurație" 
                    actions={
                      <SectionEditButton
                        isEditing={editingSection === "configuratie"}
                        isDirty={isSectionDirty("configuratie")}
                        onStartEdit={() => handleStartEditSection("configuratie")}
                        onCancel={() => handleCancelEditSection("configuratie")}
                        onSave={() => handleSaveSection("configuratie")}
                        disabled={isPublicShared}
                      />
                    }
                  />
                  <div className="divide-y divide-gray-100">
                    {renderRow("configuratie", "Suprafață utilă", suprafataUtila)}
                    {renderRow("configuratie", "Compartimentare", compartimentare)}
                    {renderRow("configuratie", "Etaj", etaj)}
                    {renderRow("configuratie", "An construcție", anConstructie)}
                    {renderRow("configuratie", "Număr camere", String(camere))}
                    {renderRow("configuratie", "Număr băi", String(bai))}
                    {renderRow("configuratie", "Balcon", String(balcoane))}
                    {renderRow("configuratie", "Stare", stareInterior, true)}
                  </div>
                </div>

                {/* -Subcategorie "Finisaje" */}
                <div>
                  <SubCategoryHeader 
                    title="Finisaje" 
                    actions={
                      <SectionEditButton
                        isEditing={editingSection === "finisaje"}
                        isDirty={isSectionDirty("finisaje")}
                        onStartEdit={() => handleStartEditSection("finisaje")}
                        onCancel={() => handleCancelEditSection("finisaje")}
                        onSave={() => handleSaveSection("finisaje")}
                        disabled={isPublicShared}
                      />
                    }
                  />
                  <div className="divide-y divide-gray-100">
                    {renderRow("finisaje", "Living", "vopsea lavabilă, parchet")}
                    {bedroomCount >= 1 && renderRow("finisaje", "Camera 1", "vopsea lavabilă, parchet")}
                    {bedroomCount >= 2 && renderRow("finisaje", "Camera 2", "vopsea lavabilă, parchet")}
                    {bedroomCount >= 3 && renderRow("finisaje", "Camera 3", "vopsea lavabilă, parchet")}
                    {bedroomCount >= 4 && renderRow("finisaje", "Camera 4", "vopsea lavabilă, parchet")}
                    {renderRow("finisaje", "Bucătărie", "vopsea lavabilă, faianță și gresie")}
                    {baiCount >= 1 && renderRow("finisaje", "Baie 1", "faianță și gresie")}
                    {baiCount >= 2 && renderRow("finisaje", "Baie 2", "faianță și gresie")}
                    {baiCount >= 3 && renderRow("finisaje", "Baie 3", "faianță și gresie")}
                    {baiCount >= 4 && renderRow("finisaje", "Baie 4", "faianță și gresie")}
                    {renderRow("finisaje", "Hol", "vopsea lavabilă, parchet", true)}
                  </div>
                </div>

                {/* -Subcategorie "Mobilare" */}
                <div>
                  <SubCategoryHeader 
                    title="Mobilare" 
                    actions={
                      <SectionEditButton
                        isEditing={editingSection === "mobilare"}
                        isDirty={isSectionDirty("mobilare")}
                        onStartEdit={() => handleStartEditSection("mobilare")}
                        onCancel={() => handleCancelEditSection("mobilare")}
                        onSave={() => handleSaveSection("mobilare")}
                        disabled={isPublicShared}
                      />
                    }
                  />
                  <div className="divide-y divide-gray-100">
                    {renderRow("mobilare", "Living", "canapea, măsuță cafea, comodă")}
                    {bedroomCount >= 1 && renderRow("mobilare", "Camera 1", "pat, noptiere, dulap")}
                    {bedroomCount >= 2 && renderRow("mobilare", "Camera 2", "pat, noptiere, dulap")}
                    {bedroomCount >= 3 && renderRow("mobilare", "Camera 3", "pat, noptiere, dulap")}
                    {bedroomCount >= 4 && renderRow("mobilare", "Camera 4", "pat, noptiere, dulap")}
                    {renderRow("mobilare", "Bucătărie", "mobilă de bucatarie premium")}
                    {baiCount >= 1 && renderRow("mobilare", "Baie 1", "obiecte sanitare premium")}
                    {baiCount >= 2 && renderRow("mobilare", "Baie 2", "obiecte sanitare premium")}
                    {baiCount >= 3 && renderRow("mobilare", "Baie 3", "obiecte sanitare premium")}
                    {baiCount >= 4 && renderRow("mobilare", "Baie 4", "obiecte sanitare premium")}
                    {renderRow("mobilare", "Hol", "cuier, pantofar", true)}
                  </div>
                </div>

                {/* -Subcategorie "Dotari" */}
                <div>
                  <SubCategoryHeader 
                    title="Dotări" 
                    actions={
                      <SectionEditButton
                        isEditing={editingSection === "dotari"}
                        isDirty={isSectionDirty("dotari")}
                        onStartEdit={() => handleStartEditSection("dotari")}
                        onCancel={() => handleCancelEditSection("dotari")}
                        onSave={() => handleSaveSection("dotari")}
                        disabled={isPublicShared}
                      />
                    }
                  />
                  <div className="divide-y divide-gray-100">
                    {renderRow("dotari", "Living", "aer condiționat, smart TV")}
                    {bedroomCount >= 1 && renderRow("dotari", "Camera 1", "-")}
                    {bedroomCount >= 2 && renderRow("dotari", "Camera 2", "-")}
                    {bedroomCount >= 3 && renderRow("dotari", "Camera 3", "-")}
                    {bedroomCount >= 4 && renderRow("dotari", "Camera 4", "-")}
                    {renderRow("dotari", "Bucătărie", "frigider, plită, cuptor, hotă")}
                    {baiCount >= 1 && renderRow("dotari", "Baie 1", "-")}
                    {baiCount >= 2 && renderRow("dotari", "Baie 2", "-")}
                    {renderRow("dotari", "Hol", "interfon")}
                    {renderRow("dotari", "Altele", "-", true)}
                  </div>
                </div>
              </div>
            </div>

            {/* #CARD "BLOC" */}
            <div id="bloc" className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs scroll-mt-28 sm:scroll-mt-32 font-sans">
              <div className="px-6 py-4 bg-gray-50/80 border-b border-gray-200 flex items-center justify-between select-none">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#051D35]/5 text-[#051D35] flex items-center justify-center font-bold">
                    <Building2 size={16} />
                  </div>
                  <h2 className="text-xs font-bold text-gray-900 uppercase tracking-wider font-sans">
                    BLOC
                  </h2>
                </div>

                <SectionEditButton
                  isEditing={editingSection === "bloc"}
                  isDirty={isSectionDirty("bloc")}
                  onStartEdit={() => handleStartEditSection("bloc")}
                  onCancel={() => handleCancelEditSection("bloc")}
                  onSave={() => handleSaveSection("bloc")}
                  disabled={isPublicShared}
                />
              </div>

              <div className="font-sans divide-y divide-gray-100">
                {renderRow("bloc", "Acces", "Tag magnetic, interfon")}
                {renderRow("bloc", "Spații", "-")}
                {renderRow("bloc", "Dotări", "Lift, supraveghere video")}
                {renderRow("bloc", "Servicii", "Administrație, curățenie spații comune", true)}
              </div>
            </div>

            {/* #CARD "IMPREJURIMI" */}
            <div id="imprejurimi" className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs scroll-mt-28 sm:scroll-mt-32 font-sans">
              <div className="px-6 py-4 bg-gray-50/80 border-b border-gray-200 flex items-center justify-between select-none">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#051D35]/5 text-[#051D35] flex items-center justify-center font-bold">
                    <Compass size={16} />
                  </div>
                  <h2 className="text-xs font-bold text-gray-900 uppercase tracking-wider font-sans">
                    ÎMPREJURIMI
                  </h2>
                </div>

                <SectionEditButton
                  isEditing={editingSection === "imprejurimi"}
                  isDirty={isSectionDirty("imprejurimi")}
                  onStartEdit={() => handleStartEditSection("imprejurimi")}
                  onCancel={() => handleCancelEditSection("imprejurimi")}
                  onSave={() => handleSaveSection("imprejurimi")}
                  disabled={isPublicShared}
                />
              </div>

              <div className="font-sans divide-y divide-gray-100">
                {renderRow("imprejurimi", "Educație", "Grădinițe de stat și private, școli gimnaziale, licee în apropiere")}
                {renderRow("imprejurimi", "Comerț", "Numeroase magazine de proximitate.")}
                {renderRow("imprejurimi", "Benzinării", "Multiple statii de alimentare.")}
                {renderRow("imprejurimi", "Sănătate", "Diverse farmacii.")}
                {renderRow("imprejurimi", "Relaxare", "Spatii verzi in apropiere.")}
                {renderRow("imprejurimi", "Divertisment", "Restaurante, baruri si cafenele in zona.")}
                {renderRow("imprejurimi", "Obiective", "Diverse puncte de atracie din sector.", true)}
              </div>
            </div>

            {/* #CARD "PARCARE" */}
            <div id="parcare" className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs scroll-mt-28 sm:scroll-mt-32 font-sans">
              <div className="px-6 py-4 bg-gray-50/80 border-b border-gray-200 flex items-center justify-between select-none">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#051D35]/5 text-[#051D35] flex items-center justify-center font-bold">
                    <Car size={16} />
                  </div>
                  <h2 className="text-xs font-bold text-gray-900 uppercase tracking-wider font-sans">
                    PARCARE
                  </h2>
                </div>

                <SectionEditButton
                  isEditing={editingSection === "parcare"}
                  isDirty={isSectionDirty("parcare")}
                  onStartEdit={() => handleStartEditSection("parcare")}
                  onCancel={() => handleCancelEditSection("parcare")}
                  onSave={() => handleSaveSection("parcare")}
                  disabled={isPublicShared}
                />
              </div>

              <div className="font-sans">
                {renderRow("parcare", "Parcare", "Publica in zona", true, true)}
              </div>
            </div>

            {/* #CARD "CONDIȚII" */}
            <div id="acte" className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs scroll-mt-28 sm:scroll-mt-32 font-sans">
              <div className="px-6 py-4 bg-gray-50/80 border-b border-gray-200 flex items-center justify-between select-none">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#051D35]/5 text-[#051D35] flex items-center justify-center font-bold">
                    <ShieldCheck size={16} />
                  </div>
                  <h2 className="text-xs font-bold text-gray-900 uppercase tracking-wider font-sans">
                    CONDIȚII
                  </h2>
                </div>

                <SectionEditButton
                  isEditing={editingSection === "acte"}
                  isDirty={isSectionDirty("acte")}
                  onStartEdit={() => handleStartEditSection("acte")}
                  onCancel={() => handleCancelEditSection("acte")}
                  onSave={() => handleSaveSection("acte")}
                  disabled={isPublicShared}
                />
              </div>

              <div className="font-sans divide-y divide-gray-100">
                {isRent ? (
                  <>
                    {renderRow("acte", "Condiții contractuale", "Contract pe minimum 12 luni")}
                    {renderRow("acte", "Avans", "1 lună")}
                    {renderRow("acte", "Garanție", "1 lună", true)}
                  </>
                ) : (
                  <>
                    {renderRow("acte", "Situație juridică", "Fara probleme")}
                    {renderRow("acte", "Disponibilitate", "Imediată")}
                    {renderRow("acte", "Finanțare", "Credit bancar / fonduri proprii", true)}
                  </>
                )}
              </div>
            </div>

            {/* Generous bottom spacing ensuring the last cards can scroll to the top under the jump links bar */}
            <div className="h-[60vh] min-h-[480px] pointer-events-none" aria-hidden="true" />

          </div>

          {/* Right Column: Sticky Sidebar with Owner Card first, then Property Carousel, Price, Title & Share */}
          <div className="lg:col-span-4 p-4 sm:p-6 lg:p-7 space-y-6 lg:sticky lg:top-[102px]">
            
            {/* OWNER CARD (FIRST IN RIGHT COLUMN) - STRICTLY VISIBLE ONLY INTERNALLY IN CRM (!isPublicShared) */}
            {!isPublicShared && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs font-sans">
                <div className="px-6 py-4 bg-gray-50/80 border-b border-gray-200 flex items-center justify-between select-none">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-[#051D35]/5 text-[#051D35] flex items-center justify-center font-bold">
                      <User size={16} />
                    </div>
                    <div>
                      <h2 className="text-xs font-bold text-gray-900 uppercase tracking-wider font-sans">
                        DATE PROPRIETAR
                      </h2>
                      <span className="text-[10px] text-gray-500 font-medium font-sans">
                        Privat CRM • Confidențial
                      </span>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-gray-600 bg-gray-100 px-2 py-0.5 rounded border border-gray-200">
                    <Lock size={10} className="text-gray-400" />
                    Ascuns pe share
                  </span>
                </div>

                <div className="p-5 space-y-3 text-xs font-sans">
                  <div>
                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider block mb-0.5 font-sans">
                      Nume Proprietar
                    </span>
                    <span className="font-bold text-gray-900 text-sm font-sans">
                      {lead.ownerName || "Nespecificat"}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider block mb-0.5 font-sans">
                      Telefon Direct
                    </span>
                    {lead.ownerPhone ? (
                      <div className="flex items-center gap-2">
                        <a 
                          href={`tel:${lead.ownerPhone}`}
                          className="font-mono font-bold text-[#051D35] hover:underline flex items-center gap-1 font-sans"
                        >
                          <Phone size={13} className="text-[#BE9662]" />
                          {lead.ownerPhone}
                        </a>
                        <button
                          type="button"
                          onClick={handleCopyOwnerPhone}
                          className="p-1 text-gray-400 hover:text-gray-700 rounded transition-colors cursor-pointer"
                          title="Copiază telefon proprietar"
                        >
                          {copiedOwnerPhone ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
                        </button>
                      </div>
                    ) : (
                      <span className="text-gray-400 italic font-sans">Nu este specificat</span>
                    )}
                  </div>

                  {lead.ownerPhone && (
                    <div className="pt-2 border-t border-gray-100 flex gap-2 font-sans">
                      <a
                        href={`tel:${lead.ownerPhone.replace(/[^0-9+]/g, "")}`}
                        className="flex-1 h-7 rounded bg-[#051D35] text-white font-medium text-xs flex items-center justify-center gap-1 hover:bg-[#0a2b4a] transition-colors"
                      >
                        <Phone size={11} className="text-[#BE9662]" />
                        <span>Apelează</span>
                      </a>
                      <a
                        href={`https://wa.me/4${lead.ownerPhone.replace(/[^0-9]/g, "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 h-7 rounded bg-emerald-600 text-white font-medium text-xs flex items-center justify-center gap-1 hover:bg-emerald-700 transition-colors"
                      >
                        <MessageSquare size={11} />
                        <span>WhatsApp</span>
                      </a>
                    </div>
                  )}

                  <p className="text-[10px] text-gray-400 italic pt-1 font-sans">
                    * Aceste date sunt confidențiale și sunt vizibile exclusiv consultanților agenției, nu apar pe link-ul distribuit clienților.
                  </p>
                </div>
              </div>
            )}

            {/* PROPERTY PHOTOS CARD: Standardized Card Header & Inline Drag-and-Drop / Browse */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs font-sans">
              {/* Standardized Card Header */}
              <div className="px-6 py-4 bg-gray-50/80 border-b border-gray-200 flex items-center justify-between select-none">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#051D35]/5 text-[#051D35] flex items-center justify-center font-bold">
                    <Camera size={16} />
                  </div>
                  <div>
                    <h2 className="text-xs font-bold text-gray-900 uppercase tracking-wider font-sans">
                      FOTOGRAFII IMOBIL
                    </h2>
                    <span className="text-[10px] text-gray-500 font-medium font-sans">
                      {imagesList.length} {imagesList.length === 1 ? "fotografie" : "fotografii"}
                    </span>
                  </div>
                </div>
                <SectionEditButton
                  isEditing={isEditingPhotos}
                  isDirty={isPhotosDirty}
                  onStartEdit={() => setIsEditingPhotos(true)}
                  onCancel={handleCancelPhotos}
                  onSave={handleSavePhotos}
                />
              </div>

              {/* Card Content with Drag & Drop over card area */}
              <div
                className="relative p-5 space-y-3 font-sans select-none"
                onDragEnter={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer.types.includes("Files")) setIsDraggingOverCard(true);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer.types.includes("Files")) setIsDraggingOverCard(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setIsDraggingOverCard(false);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDraggingOverCard(false);
                  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    handleAddPhotoFiles(e.dataTransfer.files);
                  }
                }}
              >
                {/* Drag and hold active overlay on content area */}
                {isDraggingOverCard && (
                  <div className="absolute inset-0 bg-[#051D35]/85 backdrop-blur-xs z-30 flex flex-col items-center justify-center text-white pointer-events-none p-4 text-center border-2 border-dashed border-[#BE9662] transition-all">
                    <div className="w-12 h-12 rounded-full bg-[#BE9662]/20 text-[#BE9662] flex items-center justify-center mb-2 animate-bounce">
                      <Upload size={24} />
                    </div>
                    <p className="text-sm font-bold tracking-wide">Plasează fotografiile aici</p>
                    <p className="text-xs text-gray-300 mt-0.5">Trage fișierele pentru a le adăuga în galerie</p>
                  </div>
                )}

                {/* Hidden file input for browsing */}
                <input
                  ref={photoFileInputRef}
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={(e) => {
                    if (e.target.files) {
                      handleAddPhotoFiles(e.target.files);
                    }
                    e.target.value = "";
                  }}
                  className="hidden"
                />

                {/* Main large photo carousel preview */}
                <div className="relative aspect-[4/3] bg-gray-100 rounded-lg group select-none overflow-hidden border border-gray-200">
                  {imagesList.length > 0 ? (
                    <>
                      <img 
                        src={imagesList[carouselIndex] || imagesList[0]} 
                        alt={`${displayTitle} - foto ${carouselIndex + 1}`}
                        onClick={() => { setSelectedPhotoIndex(carouselIndex); setIsGalleryOpen(true); }}
                        className="w-full h-full object-cover cursor-pointer group-hover:scale-102 transition-transform duration-300" 
                        referrerPolicy="no-referrer"
                      />

                      {/* Counter Badge */}
                      <div className="absolute top-3 right-3 flex items-center gap-1.5 z-10">
                        <button
                          type="button"
                          onClick={() => { setSelectedPhotoIndex(carouselIndex); setIsGalleryOpen(true); }}
                          className="h-6 px-2 rounded-md bg-black/65 hover:bg-black/85 text-white text-[11px] font-mono font-medium backdrop-blur-xs flex items-center gap-1 transition-colors cursor-pointer"
                          title="Deschide galeria completă"
                        >
                          <Camera size={11} className="text-[#BE9662]" />
                          <span>{carouselIndex + 1} / {imagesList.length}</span>
                        </button>
                      </div>

                      {/* Prev / Next Buttons */}
                      {imagesList.length > 1 && (
                        <>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCarouselIndex((prev) => (prev === 0 ? imagesList.length - 1 : prev - 1));
                            }}
                            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 hover:bg-black/75 text-white flex items-center justify-center opacity-80 sm:opacity-0 group-hover:opacity-100 transition-all cursor-pointer backdrop-blur-xs shadow-sm z-10"
                            title="Fotografia anterioară"
                          >
                            <ChevronLeft size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCarouselIndex((prev) => (prev === imagesList.length - 1 ? 0 : prev + 1));
                            }}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 hover:bg-black/75 text-white flex items-center justify-center opacity-80 sm:opacity-0 group-hover:opacity-100 transition-all cursor-pointer backdrop-blur-xs shadow-sm z-10"
                            title="Fotografia următoare"
                          >
                            <ChevronRight size={16} />
                          </button>
                        </>
                      )}
                    </>
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-gray-400 gap-1.5 p-4 text-center">
                      <Camera size={32} className="text-gray-300" />
                      <span className="text-xs">Nicio fotografie disponibilă</span>
                    </div>
                  )}
                </div>

                {/* Thumbnails Slots & Pagination */}
                <div className="space-y-2 pt-1">
                  {imagesList.length > 4 && (
                    <div className="flex items-center justify-between text-[11px] text-gray-500 font-sans px-0.5">
                      <span>Sloturi {slotPage * 4 + 1} - {Math.min((slotPage + 1) * 4, imagesList.length)} din {imagesList.length}</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={slotPage === 0}
                          onClick={() => setSlotPage(p => Math.max(0, p - 1))}
                          className="w-5 h-5 rounded flex items-center justify-center border border-gray-200 bg-white hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
                          title="Sloturile anterioare"
                        >
                          <ChevronLeft size={12} />
                        </button>
                        <span className="font-mono text-[10px] px-1">{slotPage + 1}/{Math.ceil(imagesList.length / 4)}</span>
                        <button
                          type="button"
                          disabled={(slotPage + 1) * 4 >= imagesList.length}
                          onClick={() => setSlotPage(p => (p + 1) * 4 < imagesList.length ? p + 1 : p)}
                          className="w-5 h-5 rounded flex items-center justify-center border border-gray-200 bg-white hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
                          title="Sloturile următoare"
                        >
                          <ChevronRight size={12} />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 5-slot grid: 4 photo slots + 1 fixed browse slot */}
                  <div className="grid grid-cols-5 gap-2">
                    {[0, 1, 2, 3].map((offset) => {
                      const actualIndex = slotPage * 4 + offset;
                      const imgUrl = imagesList[actualIndex];
                      if (imgUrl) {
                        const isSelected = carouselIndex === actualIndex;
                        const isDragTarget = dropTargetIndex === actualIndex;
                        return (
                          <div
                            key={actualIndex}
                            draggable={true}
                            onDragStart={(e) => {
                              e.dataTransfer.setData("text/plain", String(actualIndex));
                              setDraggedSlotIndex(actualIndex);
                            }}
                            onDragOver={(e) => {
                              e.preventDefault();
                              if (draggedSlotIndex !== null && draggedSlotIndex !== actualIndex) {
                                setDropTargetIndex(actualIndex);
                              }
                            }}
                            onDragLeave={() => {
                              if (dropTargetIndex === actualIndex) setDropTargetIndex(null);
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              const fromIdxStr = e.dataTransfer.getData("text/plain");
                              const fromIdx = fromIdxStr !== "" ? parseInt(fromIdxStr, 10) : draggedSlotIndex;
                              if (fromIdx !== null && !isNaN(fromIdx) && fromIdx !== actualIndex) {
                                setImagesList(prev => {
                                  const next = [...prev];
                                  const [moved] = next.splice(fromIdx, 1);
                                  next.splice(actualIndex, 0, moved);
                                  return next;
                                });
                                setIsPhotosDirty(true);
                                setIsEditingPhotos(true);
                                setCarouselIndex(actualIndex);
                              }
                              setDraggedSlotIndex(null);
                              setDropTargetIndex(null);
                            }}
                            onDragEnd={() => {
                              setDraggedSlotIndex(null);
                              setDropTargetIndex(null);
                            }}
                            onClick={() => setCarouselIndex(actualIndex)}
                            className={`relative aspect-square rounded-lg overflow-hidden border cursor-pointer transition-all group ${
                              isSelected 
                                ? "border-[#BE9662] ring-2 ring-[#BE9662] shadow-xs" 
                                : "border-gray-200 hover:border-gray-400"
                            } ${isDragTarget ? "scale-105 ring-2 ring-[#051D35] border-[#051D35]" : ""}`}
                            title={`Foto ${actualIndex + 1} (Trage pentru rearanjare)`}
                          >
                            <img
                              src={imgUrl}
                              alt={`Foto ${actualIndex + 1}`}
                              className="w-full h-full object-cover select-none"
                              referrerPolicy="no-referrer"
                            />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors pointer-events-none" />
                            <span className="absolute bottom-1 left-1 px-1 py-0.2 rounded bg-black/60 text-white font-mono text-[9px] pointer-events-none">
                              {actualIndex + 1}
                            </span>
                            {isEditingPhotos && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setImagesList(prev => prev.filter((_, i) => i !== actualIndex));
                                  setIsPhotosDirty(true);
                                  if (carouselIndex >= imagesList.length - 1) {
                                    setCarouselIndex(Math.max(0, imagesList.length - 2));
                                  }
                                }}
                                className="absolute top-1 right-1 w-4 h-4 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shadow-xs"
                                title="Șterge fotografia"
                              >
                                <X size={10} />
                              </button>
                            )}
                          </div>
                        );
                      }
                      return (
                        <div
                          key={`empty-${offset}`}
                          className="aspect-square rounded-lg border border-dashed border-gray-200 bg-gray-50/50 flex items-center justify-center text-gray-300"
                        >
                          <span className="text-[10px] font-mono text-gray-300">{slotPage * 4 + offset + 1}</span>
                        </div>
                      );
                    })}

                    {/* Slot 5: Fixed Browse Button */}
                    <button
                      type="button"
                      onClick={() => photoFileInputRef.current?.click()}
                      className="aspect-square rounded-lg border-2 border-dashed border-gray-300 hover:border-[#BE9662] hover:bg-amber-50/20 text-gray-400 hover:text-[#BE9662] flex items-center justify-center transition-all cursor-pointer group shadow-2xs"
                      title="Încarcă fotografii de pe dispozitiv"
                    >
                      <Plus size={20} className="group-hover:scale-125 group-hover:text-[#BE9662] transition-all duration-200" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* LINK ACCES PUBLIC - Standardized Card Header */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs font-sans">
              <div className="px-6 py-4 bg-gray-50/80 border-b border-gray-200 flex items-center justify-between select-none">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#051D35]/5 text-[#051D35] flex items-center justify-center font-bold">
                    <Share2 size={16} />
                  </div>
                  <div>
                    <h2 className="text-xs font-bold text-gray-900 uppercase tracking-wider font-sans">
                      LINK ACCES PUBLIC
                    </h2>
                    <span className="text-[10px] text-emerald-700 font-medium font-sans">
                      Fără date proprietar
                    </span>
                  </div>
                </div>
              </div>

              <div className="p-5 space-y-2 font-sans">
                <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded p-1 pl-2">
                  <span className="text-[11px] font-mono text-gray-600 truncate flex-1 select-all font-sans">
                    {getPublicShareUrl(lead.id || "")}
                  </span>
                  <button
                    type="button"
                    onClick={handleNativeShare}
                    className="h-6 px-2.5 rounded text-[11px] font-semibold bg-[#051D35] text-white hover:bg-[#0a2b4a] transition-colors shrink-0 cursor-pointer font-sans flex items-center gap-1"
                    title="Deschide aplicația nativă pentru distribuire"
                  >
                    <Share2 size={11} className="text-[#BE9662]" />
                    <span>Distribuie</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="h-6 px-2.5 rounded text-[11px] font-medium bg-white text-gray-700 hover:bg-gray-100 border border-gray-200 transition-colors shrink-0 cursor-pointer font-sans"
                    title="Copiază linkul"
                  >
                    {isCopied ? "Copiat" : "Copiază"}
                  </button>
                </div>
              </div>
            </div>

          </div>

        </div>
      </main>

      {/* Lightbox Photo Gallery Modal */}
      {isGalleryOpen && allImages.length > 0 && (
        <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex flex-col">
          <div className="h-14 px-6 flex items-center justify-between text-white border-b border-white/10 shrink-0">
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono font-bold bg-white/10 px-2.5 py-1 rounded">
                {selectedPhotoIndex + 1} / {allImages.length}
              </span>
              <span className="text-xs text-gray-300 hidden sm:inline truncate max-w-md">
                {displayTitle}
              </span>
            </div>

            <button
              type="button"
              onClick={() => setIsGalleryOpen(false)}
              className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
              title="Închide galeria (Esc)"
            >
              <X size={22} />
            </button>
          </div>

          <div className="flex-1 relative flex items-center justify-center p-4">
            <img 
              src={imagesList[selectedPhotoIndex] || imagesList[0]} 
              alt={`${displayTitle} - ${selectedPhotoIndex + 1}`}
              className="max-h-[82vh] max-w-[90vw] object-contain rounded shadow-2xl transition-all"
              referrerPolicy="no-referrer"
            />

            {imagesList.length > 1 && (
              <button
                type="button"
                onClick={() => setSelectedPhotoIndex(prev => (prev === 0 ? imagesList.length - 1 : prev - 1))}
                className="absolute left-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors backdrop-blur-sm"
                title="Fotografia anterioară"
              >
                <ChevronLeft size={24} />
              </button>
            )}

            {imagesList.length > 1 && (
              <button
                type="button"
                onClick={() => setSelectedPhotoIndex(prev => (prev === imagesList.length - 1 ? 0 : prev + 1))}
                className="absolute right-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors backdrop-blur-sm"
                title="Următoarea fotografie"
              >
                <ChevronRight size={24} />
              </button>
            )}
          </div>

          <div className="h-20 bg-black/60 border-t border-white/10 px-4 flex items-center justify-center gap-2 overflow-x-auto no-scrollbar shrink-0">
            {imagesList.map((img, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setSelectedPhotoIndex(idx)}
                className={`w-14 h-12 rounded overflow-hidden border-2 transition-all shrink-0 ${
                  selectedPhotoIndex === idx 
                    ? "border-[#BE9662] scale-105" 
                    : "border-transparent opacity-50 hover:opacity-100"
                }`}
              >
                <img src={img} alt={`thumb-${idx}`} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              </button>
            ))}
          </div>
        </div>
      )}

    </div>
  );
};
