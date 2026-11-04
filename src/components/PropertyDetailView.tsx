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
  { id: "parcare", label: "Parcare", icon: Car }
];

const COMPARTIMENTARE_OPTIONS = ["Decomandat", "Semidecomandat", "Nedecomandat", "Circular", "Open Space"];
const STARE_OPTIONS = ["Buna", "Renovat", "Necesita renovare"];
const CONDITII_CONTRACTUALE_OPTIONS = ["6 luni", "12 luni", "24 luni", "36 luni", "48 luni", "60 luni"];
const AVANS_GARANTIE_OPTIONS = ["1 luna", "2 luni", "3 luni", "4 luni", "5 luni", "6 luni"];

interface AttributeRowProps {
  label: string;
  value: React.ReactNode;
  copyValue?: string;
  isLast?: boolean;
  isEditing?: boolean;
  editValue?: string;
  onEditChange?: (val: string) => void;
  multiline?: boolean;
  options?: string[];
}

const AttributeRow: React.FC<AttributeRowProps> = ({ 
  label, 
  value, 
  copyValue,
  isEditing = false,
  editValue,
  onEditChange,
  options
}) => {
  const [copied, setCopied] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const textToCopy = copyValue || (typeof value === "string" ? value : "");

  const rawEdit = editValue ?? (typeof value === "string" ? value : "");
  let matchedValue = rawEdit;
  if (options && options.length > 0) {
    const found = options.find(opt => opt.toLowerCase() === rawEdit.toLowerCase());
    if (found) {
      matchedValue = found;
    } else {
      const partial = options.find(opt => 
        rawEdit.toLowerCase().includes(opt.toLowerCase()) || 
        opt.toLowerCase().replace(/[ăâ]/g, "a").includes(rawEdit.toLowerCase().replace(/[ăâ]/g, "a"))
      );
      matchedValue = partial || options[0];
    }
  }

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

      {/* Right Cell: Value (100% of cell surface is the seamless editable input or select dropdown) */}
      <div 
        onClick={() => {
          if (isEditing) {
            if (options && options.length > 0) {
              selectRef.current?.focus();
            } else {
              inputRef.current?.focus();
            }
          }
        }}
        className={`flex-1 relative flex items-stretch min-w-0 transition-colors ${
          isFocused 
            ? "bg-amber-50/40" 
            : isEditing 
              ? "hover:bg-amber-50/15 cursor-pointer" 
              : "hover:bg-gray-50/60"
        }`}
      >
        {isEditing ? (
          options && options.length > 0 ? (
            <div className="relative w-full h-full flex items-center">
              <select
                ref={selectRef}
                value={matchedValue}
                onChange={(e) => onEditChange?.(e.target.value)}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                className={`w-full h-full min-h-[36px] px-3.5 pr-8 py-2 text-[12px] font-sans leading-normal bg-transparent border-none outline-none rounded-none focus:outline-none focus:ring-0 p-0 m-0 shadow-none cursor-pointer appearance-none transition-colors ${
                  isFocused ? "text-[#051D35] font-semibold" : "text-gray-800 font-normal"
                }`}
              >
                {options.map((opt) => (
                  <option key={opt} value={opt} className="bg-white text-gray-900 py-1 font-sans">
                    {opt}
                  </option>
                ))}
              </select>
              <ChevronDown size={13} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
          ) : (
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
          )
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
  const navSections = useMemo<NavSection[]>(() => {
    if (isPublicShared) {
      return [{ id: "poze", label: "Poze", icon: Camera }, ...NAV_SECTIONS];
    }
    return NAV_SECTIONS;
  }, [isPublicShared]);

  const [activeSection, setActiveSection] = useState<string>(isPublicShared ? "poze" : (NAV_SECTIONS[0]?.id || "tranzactie"));
  const [isCopied, setIsCopied] = useState<boolean>(false);
  
  // Ensure default active tab is always the first in jump links on mount or property change (Poze on public shared)
  useEffect(() => {
    setActiveSection(isPublicShared ? "poze" : (navSections[0]?.id || "tranzactie"));
    if (mainScrollRef.current) {
      mainScrollRef.current.scrollTop = 0;
    }
  }, [lead?.id, isPublicShared, navSections]);
  
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
  const mainScrollRef = useRef<HTMLElement>(null);
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
    if (mainScrollRef.current) return mainScrollRef.current;
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

  // Track active jump link section on scroll
  useEffect(() => {
    const scrollContainer = mainScrollRef.current;
    if (!scrollContainer) return;

    const handleScroll = () => {
      // Don't override active tab during programmatic smooth scroll
      if (isManualScrollingRef.current) return;

      // Check if user is scrolled to the absolute bottom of the container
      const isAtBottom = scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - 40;
      if (isAtBottom) {
        setActiveSection(navSections[navSections.length - 1].id);
        return;
      }

      // If at or near the top of the container, force the first jump link tab
      if (scrollContainer.scrollTop <= 40) {
        setActiveSection(navSections[0].id);
        return;
      }

      const containerTop = scrollContainer.getBoundingClientRect().top;
      // Trigger line: 70px below the top of the visible content area
      const triggerLine = containerTop + 70;

      // Find the last section whose top has reached or passed the trigger line
      let currentSectionId = navSections[0].id;
      for (const sect of navSections) {
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

    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      scrollContainer.removeEventListener("scroll", handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [navSections]);

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

    const scrollContainer = mainScrollRef.current || getScrollContainer(el);

    if (scrollContainer instanceof HTMLElement) {
      const containerRect = scrollContainer.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const targetTop = scrollContainer.scrollTop + (elRect.top - containerRect.top) - 16;
      
      scrollContainer.scrollTo({
        top: Math.max(0, targetTop),
        behavior: "smooth"
      });
    } else {
      const elRect = el.getBoundingClientRect().top;
      const bodyRect = document.body.getBoundingClientRect().top;
      window.scrollTo({
        top: Math.max(0, elRect - bodyRect - 16),
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
    // Priority 1: If lead has explicit images array, use it directly!
    const directImages = (lead as any)?.images;
    if (Array.isArray(directImages)) {
      const sanitized = directImages
        .map((item: any) => (typeof item === "string" ? item : item?.original))
        .filter((u: any): u is string => typeof u === "string" && u.trim().length > 0);
      return [...new Set(sanitized)];
    }

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
  const balcoane = (balcoaneRaw && balcoaneRaw !== "0" && balcoaneRaw !== "-") ? String(balcoaneRaw) : "1";

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
        "Balcoane": saved.configuratie?.["Balcoane"] || saved.configuratie?.["Balcon"] || String(balcoane),
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
      transport: {
        "Metrou": saved.transport?.["Metrou"] || "Stație de metrou în proximitate",
        "Tramvai": saved.transport?.["Tramvai"] || "Linii tramvai în zonă",
        "Troleibuz": saved.transport?.["Troleibuz"] || "Linii troleibuz în apropiere",
        "Autobuz": saved.transport?.["Autobuz"] || "Multiple linii STB în apropiere",
        ...(saved.transport || {})
      },
      parcare: {
        "Parcare": saved.parcare?.["Parcare"] || "Publica in zona",
        ...(saved.parcare || {})
      },
      acte: {
        "Situație juridică": saved.acte?.["Situație juridică"] || "Fara probleme",
        "Disponibilitate": saved.acte?.["Disponibilitate"] || "Imediată",
        "Finanțare": saved.acte?.["Finanțare"] || "Credit bancar / fonduri proprii",
        "Condiții contractuale": saved.acte?.["Condiții contractuale"] || "12 luni",
        "Avans": saved.acte?.["Avans"] || "1 luna",
        "Garanție": saved.acte?.["Garanție"] || "1 luna",
        ...(saved.acte || {})
      },
      tranzactie: {
        "Preț": saved.tranzactie?.["Preț"] || formattedPrice,
        "TVA": saved.tranzactie?.["TVA"] || "Scutit de TVA / conform legislației în vigoare",
        "Comision": saved.tranzactie?.["Comision"] || defaultCommission,
        "Condiții contractuale": saved.tranzactie?.["Condiții contractuale"] || saved.acte?.["Condiții contractuale"] || "12 luni",
        "Avans": saved.tranzactie?.["Avans"] || saved.acte?.["Avans"] || "1 luna",
        "Garanție": saved.tranzactie?.["Garanție"] || saved.acte?.["Garanție"] || "1 luna",
        "Situație juridică": saved.tranzactie?.["Situație juridică"] || saved.acte?.["Situație juridică"] || "Fara probleme",
        "Disponibilitate": saved.tranzactie?.["Disponibilitate"] || saved.acte?.["Disponibilitate"] || "Imediată",
        "Finanțare": saved.tranzactie?.["Finanțare"] || saved.acte?.["Finanțare"] || "Credit bancar / fonduri proprii",
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
      const cleanImages = imagesList.filter(img => typeof img === "string" && img.trim().length > 0);
      const newCover = cleanImages[0] || "";
      const structuredImages = cleanImages.map(url => ({ original: url }));

      const updates: any = {
        coverImage: newCover,
        images: cleanImages,
        "extractedData.crmData.imagini": {
          living: structuredImages,
          camera: [],
          bucatarie: [],
          baie: [],
          alteSpatii: []
        }
      };

      await leadsService.updateLeadData(lead.id, updates);

      // Mutate local lead object in place so that useMemo(allImages) immediately updates without resurrecting deleted images
      (lead as any).images = cleanImages;
      (lead as any).coverImage = newCover;
      if (lead.extractedData?.crmData) {
        lead.extractedData.crmData.imagini = {
          living: structuredImages as any,
          camera: [],
          bucatarie: [],
          baie: [],
          alteSpatii: []
        };
      }

      setImagesList(cleanImages);
      setIsEditingPhotos(false);
      setIsPhotosDirty(false);
      toast.success("Fotografiile au fost salvate cu succes!");
    } catch (err) {
      console.error("Failed to save photos:", err);
      toast.error("Eroare la salvarea fotografiilor.");
    }
  };

  const handleDeleteCurrentPhoto = async (indexToDelete: number) => {
    if (imagesList.length === 0) return;
    const nextList = imagesList.filter((_, i) => i !== indexToDelete);
    setImagesList(nextList);
    if (selectedPhotoIndex >= nextList.length) {
      setSelectedPhotoIndex(Math.max(0, nextList.length - 1));
    }
    if (carouselIndex >= nextList.length) {
      setCarouselIndex(Math.max(0, nextList.length - 1));
    }

    if (!lead?.id) return;
    try {
      const newCover = nextList[0] || "";
      const structuredImages = nextList.map(url => ({ original: url }));
      const updates: any = {
        coverImage: newCover,
        images: nextList,
        "extractedData.crmData.imagini": {
          living: structuredImages,
          camera: [],
          bucatarie: [],
          baie: [],
          alteSpatii: []
        }
      };
      await leadsService.updateLeadData(lead.id, updates);
      (lead as any).images = nextList;
      (lead as any).coverImage = newCover;
      if (lead.extractedData?.crmData) {
        lead.extractedData.crmData.imagini = {
          living: structuredImages as any,
          camera: [],
          bucatarie: [],
          baie: [],
          alteSpatii: []
        };
      }
      toast.success("Fotografia a fost ștearsă definitiv!");
    } catch (err) {
      console.error("Failed to delete photo:", err);
      toast.error("Eroare la ștergerea fotografiei.");
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
    if (sectionId === "mobilare_dotari") {
      setDraftSectionData(prev => ({
        ...prev,
        mobilare: { ...(sectionData["mobilare"] || {}) },
        dotari: { ...(sectionData["dotari"] || {}) }
      }));
    } else {
      setDraftSectionData(prev => ({
        ...prev,
        [sectionId]: { ...(sectionData[sectionId] || {}) }
      }));
    }
  };

  const handleCancelEditSection = (sectionId: string) => {
    setEditingSection(null);
    setDraftSectionData(prev => {
      const copy = { ...prev };
      if (sectionId === "mobilare_dotari") {
        delete copy["mobilare"];
        delete copy["dotari"];
      } else {
        delete copy[sectionId];
      }
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
    if (sectionId === "mobilare_dotari") {
      const mDraft = draftSectionData["mobilare"];
      const mOrig = sectionData["mobilare"] || {};
      const mDirty = mDraft ? Object.keys(mDraft).some(k => (mDraft[k] ?? "") !== (mOrig[k] ?? "")) : false;
      const dDraft = draftSectionData["dotari"];
      const dOrig = sectionData["dotari"] || {};
      const dDirty = dDraft ? Object.keys(dDraft).some(k => (dDraft[k] ?? "") !== (dOrig[k] ?? "")) : false;
      return mDirty || dDirty;
    }
    const currentDraft = draftSectionData[sectionId];
    if (!currentDraft) return false;
    const original = sectionData[sectionId] || {};
    return Object.keys(currentDraft).some(k => (currentDraft[k] ?? "") !== (original[k] ?? ""));
  };

  const handleSaveSection = async (sectionId: string) => {
    if (sectionId === "mobilare_dotari") {
      const updatedMob = { ...(draftSectionData["mobilare"] || sectionData["mobilare"]) };
      const updatedDot = { ...(draftSectionData["dotari"] || sectionData["dotari"]) };
      const nextSectionData = {
        ...sectionData,
        mobilare: updatedMob,
        dotari: updatedDot
      };
      setSectionData(nextSectionData);
      setEditingSection(null);

      if (lead?.id) {
        try {
          const updates: any = {
            "extractedData.presentationSections": nextSectionData
          };
          await leadsService.updateLeadData(lead.id, updates);
          toast.success("Modificările au fost salvate cu succes!");
        } catch (e) {
          console.error("Failed to save inline changes:", e);
          toast.error("Eroare la salvarea modificărilor.");
        }
      }
      return;
    }

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
        if (updatedSec["Balcoane"] || updatedSec["Balcon"]) updates["extractedData.crmData.caracteristici.suprafete.balcoane"] = updatedSec["Balcoane"] || updatedSec["Balcon"];
        if (updatedSec["Stare"]) updates["extractedData.crmData.caracteristici.alteDetalii.stadiuConstructie"] = updatedSec["Stare"];
      } else if (sectionId === "tranzactie") {
        if (updatedSec["Preț"]) {
          updates["price"] = updatedSec["Preț"];
          updates["extractedData.crmData.pret.detalii.pret"] = updatedSec["Preț"];
        }
        if (updatedSec["Garanție"]) {
          updates["extractedData.crmData.pret.detalii.garantie"] = updatedSec["Garanție"];
        }
        if (updatedSec["Avans"]) {
          updates["extractedData.crmData.pret.detalii.avans"] = updatedSec["Avans"];
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
    multiline: boolean = false,
    options?: string[]
  ) => {
    const isSecEditing = editingSection === sectionId || (editingSection === "mobilare_dotari" && (sectionId === "mobilare" || sectionId === "dotari"));
    const originalVal = sectionData[sectionId]?.[label] ?? fallbackVal;
    const currentVal = isSecEditing 
      ? (draftSectionData[sectionId]?.[label] ?? originalVal) 
      : originalVal;

    const valStr = typeof currentVal === "string" ? currentVal.trim() : (currentVal == null ? "" : String(currentVal).trim());

    // User rule: Where there is a "-", if no data has been found on the url provided for crawling, just remove that row of data in the page.
    // Exception: "An construcție" and "Balcoane" must ALWAYS appear in read mode as explicitly requested.
    const isAlwaysVisibleInReadMode = label === "An construcție" || label === "Balcoane" || label === "Balcon";
    if (!isSecEditing && !isAlwaysVisibleInReadMode && (valStr === "-" || valStr === "" || valStr === "N/A" || valStr === "null")) {
      return null;
    }

    const displayValue = (valStr === "-" && !isAlwaysVisibleInReadMode) ? "" : currentVal;

    return (
      <AttributeRow
        key={label}
        label={label}
        value={displayValue}
        copyValue={typeof currentVal === "string" && currentVal !== "-" ? currentVal : ""}
        isEditing={isSecEditing}
        editValue={typeof currentVal === "string" && currentVal !== "-" ? currentVal : ""}
        onEditChange={(newVal) => handleFieldChange(sectionId, label, newVal)}
        multiline={multiline}
        isLast={isLast}
        options={options}
      />
    );
  };

  // Generated page title according to exact user specification:
  // Order: numar camere | numar bai daca sunt mai mult de 1 | metri patrati | Distanta Metrou daca este cazul | Distanta Parc daca este cazul | Mobilat sau nemobilat | Utilat daca este cazul | obiectiv din zona
  // Max 70 characters in total
  const generatedTitle = useMemo(() => {
    const parts: string[] = [];

    // 1. Numar camere (ex: "2 cam", "1 cam", "3 cam")
    const nrCamVal = sectionData["configuratie"]?.["Număr camere"] || camere;
    const nrCamMatch = String(nrCamVal || "").match(/\d+/);
    if (nrCamMatch) {
      parts.push(`${nrCamMatch[0]} cam`);
    } else if (String(nrCamVal || "").toLowerCase().includes("garsonier") || String(nrCamVal || "").toLowerCase().includes("studio")) {
      parts.push("1 cam");
    } else {
      parts.push("2 cam");
    }

    // 2. Numar bai daca sunt mai mult de 1 (daca e 1 sau mai putin, se omite complet)
    const nrBaiVal = sectionData["configuratie"]?.["Număr băi"] || bai;
    const parsedBai = parseInt(String(nrBaiVal || "").match(/\d+/)?.[0] || "0", 10);
    if (parsedBai > 1) {
      parts.push(`${parsedBai} băi`);
    }

    // 3. Metri patrati (ex: "52mp")
    const suprafataVal = sectionData["configuratie"]?.["Suprafață utilă"] || suprafataUtila;
    const mpMatch = String(suprafataVal || "").match(/\d+/);
    if (mpMatch) {
      parts.push(`${mpMatch[0]}mp`);
    }

    // 4. Distanta Metrou daca este cazul (ex: "Metrou 50 metri", "Metrou 50m", "Metrou 5 min", "Metrou Teclu")
    let metrouFragment = "";
    const metroSources = [
      sectionData["transport"]?.["Metrou"],
      rawDescText
    ].filter(Boolean).join(" ");
    
    const mDist = metroSources.match(/(?:la\s*)?(\d+)\s*(?:m|metri)\s*(?:de)?\s*metrou/i)
      || metroSources.match(/metrou\s*(?:la\s*)?(\d+)\s*(?:m|metri)/i);
    if (mDist) {
      metrouFragment = `Metrou ${mDist[1]}m`;
    } else {
      const mMin = metroSources.match(/(?:la\s*)?(\d+)\s*(?:min|minute)\s*(?:de)?\s*metrou/i)
        || metroSources.match(/metrou\s*(?:la\s*)?(\d+)\s*(?:min|minute)/i);
      if (mMin) {
        metrouFragment = `Metrou ${mMin[1]} min`;
      } else {
        const mStation = metroSources.match(/metrou\s+([A-ZĂÎÂȘȚ][a-zăîâșț0-9]+)/);
        if (mStation && !["în", "in", "apropiere", "zona", "stație", "statie"].includes(mStation[1].toLowerCase())) {
          metrouFragment = `Metrou ${mStation[1]}`;
        }
      }
    }
    if (metrouFragment) {
      parts.push(metrouFragment);
    }

    // 5. Distanta Parc daca este cazul (ex: "Parc 200m", "Parc IOR", "Parc 5 min")
    let parcFragment = "";
    const parcSources = [
      sectionData["imprejurimi"]?.["Relaxare"],
      rawDescText
    ].filter(Boolean).join(" ");

    const pDist = parcSources.match(/(?:la\s*)?(\d+)\s*(?:m|metri)\s*(?:de)?\s*parc/i)
      || parcSources.match(/parc(?:ul)?\s*(?:la\s*)?(\d+)\s*(?:m|metri)/i);
    if (pDist) {
      parcFragment = `Parc ${pDist[1]}m`;
    } else {
      const pMin = parcSources.match(/(?:la\s*)?(\d+)\s*(?:min|minute)\s*(?:de)?\s*parc/i)
        || parcSources.match(/parc(?:ul)?\s*(?:la\s*)?(\d+)\s*(?:min|minute)/i);
      if (pMin) {
        parcFragment = `Parc ${pMin[1]} min`;
      } else {
        const pName = parcSources.match(/parc(?:ul)?\s+(Her[aă]str[aă]u|IOR|Ci[sș]migiu|Tineretului|Carol|Titan|Circului|Bordei|Plumbuita|Kiseleff)/i);
        if (pName) {
          parcFragment = `Parc ${pName[1]}`;
        }
      }
    }
    if (parcFragment) {
      parts.push(parcFragment);
    }

    // 6. Mobilat sau nemobilat (ex: "Mobilat", "Nemobilat", "Mobilat parțial")
    const lowerText = rawDescText.toLowerCase();
    const crmMobilat = (crmData as any)?.dotari?.mobilat;
    let mobFragment = "Mobilat";
    if (crmMobilat === "Nemobilat" || lowerText.includes("nemobilat")) {
      mobFragment = "Nemobilat";
    } else if (crmMobilat === "Partial" || lowerText.includes("mobilat partial") || lowerText.includes("semi-mobilat")) {
      mobFragment = "Mobilat parțial";
    } else {
      mobFragment = "Mobilat";
    }
    parts.push(mobFragment);

    // 7. Utilat daca este cazul (ex: "Utilat")
    const isUtilat = lowerText.includes("utilat") 
      || (crmData as any)?.dotari?.bucatarie?.utilata 
      || (sectionData["dotari"]?.["Bucătărie"] && sectionData["dotari"]["Bucătărie"] !== "-");
    if (isUtilat) {
      parts.push("Utilat");
    }

    // 8. Obiectiv din zona (ex: "Promenada", "Mall Vitan", etc.)
    let obiectivFragment = "";
    const objSources = [
      sectionData["imprejurimi"]?.["Obiective"],
      sectionData["imprejurimi"]?.["Comerț"],
      rawDescText
    ].filter(Boolean).join(" ");
    const oMatch = objSources.match(/\b(Mall Vitan|AFI Palace|AFI Cotroceni|Promenada|Băneasa Shopping|Mega Mall|Plaza România|Sun Plaza|ParkLake|București Mall|Piața Unirii|Piața Victoriei|Universitate|Centrul Vechi|Timpuri Noi|Floreasca|Herăstrău|Aviației|Pipera)\b/i);
    if (oMatch) {
      obiectivFragment = oMatch[1];
      parts.push(obiectivFragment);
    }

    // Ensure maximum 70 characters in total
    let currentParts = [...parts];
    let candidate = currentParts.join(" | ");

    while (candidate.length > 70 && currentParts.length > 2) {
      currentParts.pop(); // drop last element
      candidate = currentParts.join(" | ");
    }

    if (candidate.length > 70) {
      candidate = candidate.substring(0, 67) + "...";
    }

    return candidate;
  }, [sectionData, camere, bai, suprafataUtila, rawDescText, crmData]);

  // Price per square meter for sales
  const pricePerSqm = useMemo(() => {
    if (isRent) return null;
    if (crmData?.pret?.detalii?.pretMp) {
      const val = crmData.pret.detalii.pretMp;
      return `${val} €/m²`;
    }
    const rawPriceStr = crmData?.pret?.detalii?.pret || lead?.price || "";
    const priceNum = parseFloat(String(rawPriceStr).replace(/[^0-9.]/g, ""));
    const rawSurfStr = sectionData["configuratie"]?.["Suprafață utilă"] || suprafataUtila || "";
    const surfNum = parseFloat(String(rawSurfStr).replace(/[^0-9.]/g, ""));

    if (priceNum && surfNum && surfNum > 0 && priceNum > 1000) {
      const ppm = priceNum / surfNum;
      const formatted = ppm.toLocaleString("ro-RO", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
      return `${formatted} €/m²`;
    }
    return null;
  }, [isRent, crmData, lead?.price, sectionData, suprafataUtila]);

  // Clean price number extracted strictly as digits/separators to prevent duplicate currencies or units
  const cleanPriceNumber = useMemo(() => {
    const rawVal = crmData?.pret?.detalii?.pret || lead?.price || "500";
    const cleaned = String(rawVal)
      .replace(/[^\d.,\s]/g, "")
      .trim();
    return cleaned || "500";
  }, [crmData?.pret?.detalii?.pret, lead?.price]);

  // Clean rent guarantees (e.g. "1 luna garantie", "2 luni garantie")
  const cleanGuaranteeText = useMemo(() => {
    if (!isRent) return null;
    const rawGarantie = sectionData["tranzactie"]?.["Garanție"]
      || sectionData["acte"]?.["Garanție"] 
      || crmData?.pret?.detalii?.garantie;
    if (rawGarantie && rawGarantie !== "-" && rawGarantie !== "") {
      const str = String(rawGarantie).trim();
      if (str.toLowerCase().includes("garan")) {
        return str;
      }
      return `${str} garantie`;
    }
    return "1 luna garantie";
  }, [isRent, sectionData, crmData]);

  // Sync document title with generated title on public shared page
  useEffect(() => {
    if (isPublicShared && generatedTitle) {
      document.title = `${generatedTitle} • brokr.`;
    } else if (displayTitle) {
      document.title = `${displayTitle} • brokr.`;
    }
  }, [isPublicShared, generatedTitle, displayTitle]);

  return (
    <div ref={containerRef} className="w-full h-full flex-1 min-h-0 bg-white text-gray-900 flex flex-col font-sans selection:bg-[#BE9662]/20 overflow-hidden">
      
      {/* Top Navbar (only for standalone public share page) - Matches exact in-app top header dimensions */}
      {showTopNavbar && (
        <nav className="h-[50px] shrink-0 bg-white border-b border-gray-200 select-none z-30">
          <div className={`w-full h-[50px] flex items-center justify-between p-0 ${isPublicShared ? "max-w-4xl mx-auto px-4 sm:px-6" : ""}`}>
            <div className="flex items-center h-full">
              {!isPublicShared && (
                <a 
                  href="/"
                  className="h-full w-[50px] aspect-square flex items-center justify-center border-r border-gray-200 bg-white hover:bg-gray-50 text-gray-500 hover:text-[#051D35] transition-colors shrink-0 select-none group"
                  title="Înapoi la pagina principală"
                >
                  <ChevronLeft size={18} className="text-gray-500 group-hover:text-gray-900 transition-colors" />
                </a>
              )}
              <div className={!isPublicShared ? "px-4 flex items-center gap-1.5 focus:outline-none" : "flex items-center gap-1.5 focus:outline-none"}>
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

      {/* Horizontal Fixed Menu with Jump Links (Left) and Actions (Right) - Matching Cereri subheader style */}
      <div className="h-10 shrink-0 bg-white border-b border-gray-200 shadow-2xs select-none z-20 px-4 sm:px-6 flex items-center justify-between gap-3 overflow-x-auto no-scrollbar">
        <div className={`w-full h-full flex items-center justify-between gap-3 shrink-0 ${isPublicShared ? "max-w-4xl mx-auto" : ""}`}>
          {/* Left: Jump Links (styled exactly like the filter tabs in Cereri) */}
          <div className="flex items-center gap-1.5 shrink-0 overflow-x-auto no-scrollbar py-0.5">
            {navSections.map((sect) => {
              const Icon = sect.icon;
              const isActive = activeSection === sect.id;

              return (
                <button
                  key={sect.id}
                  type="button"
                  onClick={() => scrollToSection(sect.id)}
                  className={`h-7 px-2.5 flex items-center gap-1.5 text-xs rounded-md transition-colors whitespace-nowrap cursor-pointer group font-sans border ${
                    isActive
                      ? "bg-[#051D35] text-white font-medium shadow-xs border-[#051D35]"
                      : "text-gray-600 hover:text-[#051D35] bg-gray-50/70 hover:bg-gray-100 border-gray-200"
                  }`}
                >
                  <Icon size={14} className={isActive ? "text-[#BE9662]" : "text-gray-500 group-hover:text-[#051D35] transition-colors"} />
                  <span>{sect.label}</span>
                </button>
              );
            })}
          </div>

          {/* Right: Actions (print and share removed per user instruction) */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* 1. Șterge */}
            {!isPublicShared && onDelete && (
              <button 
                type="button"
                onClick={onDelete}
                className="h-7 w-7 flex items-center justify-center rounded-md border border-gray-200 bg-white hover:bg-red-50 hover:border-red-200 text-gray-500 hover:text-red-600 transition-colors shrink-0 cursor-pointer shadow-2xs group"
                title="Mută în Șterse"
              >
                <Trash2 size={14} className="text-gray-500 group-hover:text-red-600 transition-colors" />
              </button>
            )}

            {/* 4. Link extern */}
            {!isPublicShared && (
              lead?.url ? (
                <a
                  href={lead.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-7 w-7 flex items-center justify-center rounded-md border border-gray-200 bg-white hover:bg-gray-50 hover:border-gray-300 text-gray-600 hover:text-[#051D35] transition-colors shrink-0 cursor-pointer shadow-2xs group"
                  title="Deschide anunțul sursă extern"
                >
                  <ExternalLink size={14} className="text-gray-500 group-hover:text-[#051D35] transition-colors" />
                </a>
              ) : (
                <button
                  type="button"
                  disabled
                  className="h-7 w-7 flex items-center justify-center rounded-md border border-gray-200 bg-gray-50 text-gray-300 cursor-not-allowed shrink-0"
                  title="Fără link sursă extern"
                >
                  <ExternalLink size={14} className="text-gray-300" />
                </button>
              )
            )}

            {/* 5. Activitate (PRIMARY) */}
            {!isPublicShared && onAddActivity && (
              <button
                type="button"
                onClick={onAddActivity}
                className="h-7 px-3 flex items-center gap-1.5 text-xs font-medium bg-[#051D35] hover:bg-[#0a2b4a] text-white rounded-md transition-colors cursor-pointer shrink-0 shadow-xs group border border-[#051D35]"
                title="Adaugă activitate pentru această proprietate"
              >
                <Plus size={13} className="text-[#BE9662]" />
                <span>Activitate</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Layout (Scrollable container below the fixed headers) */}
      <main ref={mainScrollRef} className="w-full flex-1 min-h-0 bg-white p-0 overflow-y-auto scroll-smooth">
        <div className={isPublicShared ? "w-full min-h-full flex justify-center bg-gray-50/20" : "grid grid-cols-1 lg:grid-cols-12 min-h-full items-start"}>
          
          {/* Main Content Cards Column: Centered boxed container for public shared, 8 cols with right border for internal CRM */}
          <div className={isPublicShared ? "max-w-4xl w-full p-4 sm:p-6 lg:p-8 space-y-6" : "lg:col-span-8 p-4 sm:p-6 lg:p-7 space-y-6 border-b lg:border-b-0 lg:border-r border-gray-200"}>

            {/* PUBLIC SHARED HEADER: Zona de poze (5-Photo Mosaic Grid) + Titlu generat imediat sub poze + Preț & Preț/mp sau Garanții */}
            {isPublicShared && (
              <div className="space-y-4">
                {/* 1. Zona de poze sub forma celor atașate */}
                <div id="poze" className="w-full rounded-2xl overflow-hidden border border-gray-200 bg-gray-100 shadow-xs scroll-mt-28 sm:scroll-mt-32">
                  {imagesList.length === 0 ? (
                    <div className="w-full h-64 sm:h-80 flex flex-col items-center justify-center text-gray-400 gap-2 p-6 text-center">
                      <Camera size={40} className="text-gray-300" />
                      <span className="text-xs font-medium text-gray-500">Nicio fotografie disponibilă</span>
                    </div>
                  ) : imagesList.length === 1 ? (
                    <div 
                      onClick={() => { setSelectedPhotoIndex(0); setIsGalleryOpen(true); }}
                      className="relative w-full h-[320px] sm:h-[420px] cursor-pointer group bg-gray-200"
                    >
                      <img 
                        src={imagesList[0]} 
                        alt={generatedTitle}
                        className="w-full h-full object-cover group-hover:scale-102 transition-transform duration-300" 
                        referrerPolicy="no-referrer"
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedPhotoIndex(0);
                          setIsGalleryOpen(true);
                        }}
                        className="absolute bottom-3 left-3 h-8 px-3 rounded-lg bg-white/95 hover:bg-white text-gray-800 text-xs font-semibold shadow-md backdrop-blur-xs flex items-center gap-1.5 transition-colors cursor-pointer select-none border border-gray-200/80"
                      >
                        <Camera size={13} className="text-[#BE9662]" />
                        <span>1 fotografie</span>
                      </button>
                    </div>
                  ) : imagesList.length < 5 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 sm:gap-2 h-[340px] sm:h-[400px] md:h-[440px] p-1.5 sm:p-2">
                      <div 
                        onClick={() => { setSelectedPhotoIndex(0); setIsGalleryOpen(true); }}
                        className="relative rounded-xl overflow-hidden cursor-pointer group bg-gray-200"
                      >
                        <img 
                          src={imagesList[0]} 
                          alt={generatedTitle}
                          className="w-full h-full object-cover group-hover:scale-102 transition-transform duration-300" 
                          referrerPolicy="no-referrer"
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedPhotoIndex(0);
                            setIsGalleryOpen(true);
                          }}
                          className="absolute bottom-3 left-3 h-8 px-3 rounded-lg bg-white/95 hover:bg-white text-gray-800 text-xs font-semibold shadow-md backdrop-blur-xs flex items-center gap-1.5 transition-colors cursor-pointer select-none border border-gray-200/80"
                        >
                          <Camera size={13} className="text-[#BE9662]" />
                          <span>Galerie foto ({imagesList.length})</span>
                        </button>
                      </div>
                      <div className={`grid ${imagesList.length === 2 ? "grid-rows-1" : "grid-rows-2"} gap-1.5 sm:gap-2`}>
                        {imagesList.slice(1, 3).map((img, idx) => (
                          <div 
                            key={idx}
                            onClick={() => { setSelectedPhotoIndex(idx + 1); setIsGalleryOpen(true); }}
                            className="relative rounded-xl overflow-hidden cursor-pointer group bg-gray-200"
                          >
                            <img 
                              src={img} 
                              alt={`${generatedTitle} - ${idx + 2}`}
                              className="w-full h-full object-cover group-hover:scale-103 transition-transform duration-300" 
                              referrerPolicy="no-referrer"
                            />
                            {idx === 1 && imagesList.length > 3 && (
                              <div className="absolute inset-0 bg-black/55 hover:bg-black/65 transition-colors flex items-center justify-center p-2 text-center">
                                <span className="text-white text-sm sm:text-base font-bold underline underline-offset-4 decoration-2 tracking-wide font-sans">
                                  Toate imaginile ({imagesList.length})
                                </span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    /* Standard 5-Photo Mosaic matching attached reference */
                    <div className="grid grid-cols-1 md:grid-cols-4 grid-rows-2 gap-1.5 sm:gap-2 h-[340px] sm:h-[400px] md:h-[440px] lg:h-[460px] p-1.5 sm:p-2">
                      {/* 1. Main Large Hero Photo (spans 2 cols, 2 rows) */}
                      <div 
                        onClick={() => { setSelectedPhotoIndex(0); setIsGalleryOpen(true); }}
                        className="relative md:col-span-2 md:row-span-2 rounded-xl overflow-hidden cursor-pointer group select-none bg-gray-200"
                      >
                        <img 
                          src={imagesList[0]} 
                          alt={`${generatedTitle} - imagine principală`}
                          className="w-full h-full object-cover group-hover:scale-102 transition-transform duration-300"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors pointer-events-none" />
                        
                        {/* Bottom-left badge */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedPhotoIndex(0);
                            setIsGalleryOpen(true);
                          }}
                          className="absolute bottom-3 left-3 h-8 px-3 rounded-lg bg-white/95 hover:bg-white text-gray-800 text-xs font-semibold shadow-md backdrop-blur-xs flex items-center gap-1.5 transition-colors cursor-pointer select-none border border-gray-200/80"
                        >
                          <Camera size={13} className="text-[#BE9662]" />
                          <span>Galerie foto ({imagesList.length})</span>
                        </button>
                      </div>

                      {/* 2. Top-Middle Photo */}
                      <div 
                        onClick={() => { setSelectedPhotoIndex(1); setIsGalleryOpen(true); }}
                        className="relative rounded-xl overflow-hidden cursor-pointer group select-none bg-gray-200"
                      >
                        <img 
                          src={imagesList[1]} 
                          alt={`${generatedTitle} - foto 2`}
                          className="w-full h-full object-cover group-hover:scale-103 transition-transform duration-300"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors pointer-events-none" />
                      </div>

                      {/* 3. Top-Right Photo */}
                      <div 
                        onClick={() => { setSelectedPhotoIndex(2); setIsGalleryOpen(true); }}
                        className="relative rounded-xl overflow-hidden cursor-pointer group select-none bg-gray-200"
                      >
                        <img 
                          src={imagesList[2]} 
                          alt={`${generatedTitle} - foto 3`}
                          className="w-full h-full object-cover group-hover:scale-103 transition-transform duration-300"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors pointer-events-none" />
                      </div>

                      {/* 4. Bottom-Middle Photo */}
                      <div 
                        onClick={() => { setSelectedPhotoIndex(3); setIsGalleryOpen(true); }}
                        className="relative rounded-xl overflow-hidden cursor-pointer group select-none bg-gray-200"
                      >
                        <img 
                          src={imagesList[3]} 
                          alt={`${generatedTitle} - foto 4`}
                          className="w-full h-full object-cover group-hover:scale-103 transition-transform duration-300"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors pointer-events-none" />
                      </div>

                      {/* 5. Bottom-Right Photo with "Toate imaginile (N)" overlay */}
                      <div 
                        onClick={() => { setSelectedPhotoIndex(4); setIsGalleryOpen(true); }}
                        className="relative rounded-xl overflow-hidden cursor-pointer group select-none bg-gray-200"
                      >
                        <img 
                          src={imagesList[4]} 
                          alt={`${generatedTitle} - foto 5`}
                          className="w-full h-full object-cover group-hover:scale-103 transition-transform duration-300"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute inset-0 bg-black/55 hover:bg-black/65 backdrop-blur-[1px] transition-colors flex items-center justify-center p-2 text-center">
                          <span className="text-white text-sm sm:text-base font-bold underline underline-offset-4 decoration-2 tracking-wide font-sans">
                            Toate imaginile ({imagesList.length})
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. Titlu imediat sub poze, cu subtitlu (font-size 14px, font-weight 400) și preț (font-size 18px, font-weight 700) */}
                <div className="bg-white rounded-xl border border-gray-200 p-5 sm:p-6 shadow-xs font-sans">
                  <h1 className="text-[14px] font-normal text-gray-700 tracking-tight leading-snug">
                    {generatedTitle}
                  </h1>
                  <div className="mt-2 text-[18px] font-bold text-gray-900 font-sans tracking-tight">
                    {isRent ? (
                      <span>
                        {cleanPriceNumber} eur / luna{cleanGuaranteeText ? ` (  ${cleanGuaranteeText} )` : ""}
                      </span>
                    ) : (
                      <span>
                        {cleanPriceNumber} eur{pricePerSqm ? `   ${pricePerSqm}` : ""}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* #CARD 1: "PREȚ & CONDIȚII" */}
            <div id="tranzactie" className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs scroll-mt-28 sm:scroll-mt-32 font-sans">
              <div className="px-6 py-4 bg-gray-50/80 border-b border-gray-200 flex items-center justify-between select-none">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#051D35]/5 text-[#051D35] flex items-center justify-center font-bold">
                    <BadgePercent size={16} />
                  </div>
                  <div>
                    <h2 className="text-xs font-bold text-gray-900 uppercase tracking-wider font-sans">
                      PREȚ &amp; CONDIȚII
                    </h2>
                    <span className="text-[11px] text-gray-500 font-sans">
                      Preț, comision și condiții contractuale
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

              <div className="font-sans grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-100">
                {/* Coloana 1: Preț */}
                <div className="divide-y divide-gray-100">
                  {renderRow("tranzactie", "Preț", formattedPrice)}
                  {renderRow("tranzactie", "TVA", "Scutit de TVA / conform legislației în vigoare")}
                  {renderRow("tranzactie", "Comision", defaultCommission, true)}
                </div>

                {/* Coloana 2: Condiții */}
                <div className="divide-y divide-gray-100">
                  {isRent ? (
                    <>
                      {renderRow("tranzactie", "Condiții contractuale", "12 luni", false, false, CONDITII_CONTRACTUALE_OPTIONS)}
                      {renderRow("tranzactie", "Avans", "1 luna", false, false, AVANS_GARANTIE_OPTIONS)}
                      {renderRow("tranzactie", "Garanție", "1 luna", true, false, AVANS_GARANTIE_OPTIONS)}
                    </>
                  ) : (
                    <>
                      {renderRow("tranzactie", "Situație juridică", "Fara probleme")}
                      {renderRow("tranzactie", "Disponibilitate", "Imediată")}
                      {renderRow("tranzactie", "Finanțare", "Credit bancar / fonduri proprii", true)}
                    </>
                  )}
                </div>
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
                    {renderRow("configuratie", "Compartimentare", compartimentare, false, false, COMPARTIMENTARE_OPTIONS)}
                    {renderRow("configuratie", "Etaj", etaj)}
                    {renderRow("configuratie", "An construcție", anConstructie)}
                    {renderRow("configuratie", "Număr camere", String(camere))}
                    {renderRow("configuratie", "Număr băi", String(bai))}
                    {renderRow("configuratie", "Balcoane", String(balcoane))}
                    {renderRow("configuratie", "Stare", stareInterior, true, false, STARE_OPTIONS)}
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

                {/* -Subcategorie "Mobilare & Dotări" (Comasate în același tabel) */}
                <div>
                  <SubCategoryHeader 
                    title="Mobilare & Dotări" 
                    actions={
                      <SectionEditButton
                        isEditing={editingSection === "mobilare_dotari"}
                        isDirty={isSectionDirty("mobilare_dotari")}
                        onStartEdit={() => handleStartEditSection("mobilare_dotari")}
                        onCancel={() => handleCancelEditSection("mobilare_dotari")}
                        onSave={() => handleSaveSection("mobilare_dotari")}
                        disabled={isPublicShared}
                      />
                    }
                  />
                  <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-100">
                    {/* Coloana 1: Mobilare */}
                    <div className="divide-y divide-gray-100">
                      <div className="px-5 py-2 bg-gray-50/60 text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                        Mobilare
                      </div>
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

                    {/* Coloana 2: Dotări */}
                    <div className="divide-y divide-gray-100">
                      <div className="px-5 py-2 bg-gray-50/60 text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                        Dotări
                      </div>
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

            {/* #CARD "TRANSPORT" */}
            <div id="transport" className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs scroll-mt-28 sm:scroll-mt-32 font-sans">
              <div className="px-6 py-4 bg-gray-50/80 border-b border-gray-200 flex items-center justify-between select-none">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#051D35]/5 text-[#051D35] flex items-center justify-center font-bold">
                    <Bus size={16} />
                  </div>
                  <h2 className="text-xs font-bold text-gray-900 uppercase tracking-wider font-sans">
                    TRANSPORT
                  </h2>
                </div>

                <SectionEditButton
                  isEditing={editingSection === "transport"}
                  isDirty={isSectionDirty("transport")}
                  onStartEdit={() => handleStartEditSection("transport")}
                  onCancel={() => handleCancelEditSection("transport")}
                  onSave={() => handleSaveSection("transport")}
                  disabled={isPublicShared}
                />
              </div>

              <div className="font-sans divide-y divide-gray-100">
                {renderRow("transport", "Metrou", "Stație de metrou în proximitate")}
                {renderRow("transport", "Tramvai", "Linii tramvai în zonă")}
                {renderRow("transport", "Troleibuz", "Linii troleibuz în apropiere")}
                {renderRow("transport", "Autobuz", "Multiple linii STB în apropiere", true)}
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


            {/* Generous bottom spacing ensuring the last cards can scroll to the top under the jump links bar */}
            <div className="h-[60vh] min-h-[480px] pointer-events-none" aria-hidden="true" />

          </div>

          {/* Right Column: Sticky Sidebar with Owner Card, Property Carousel & Public Share Link - STRICTLY HIDDEN on public shared page */}
          {!isPublicShared && (
            <div className="lg:col-span-4 p-4 sm:p-6 lg:p-7 space-y-6 lg:sticky lg:top-0">
              
              {/* OWNER CARD (FIRST IN RIGHT COLUMN) - STRICTLY VISIBLE ONLY INTERNALLY IN CRM */}
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

                      {/* Delete Current Photo Button in Edit Mode */}
                      {isEditingPhotos && imagesList.length > 0 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setImagesList(prev => prev.filter((_, i) => i !== carouselIndex));
                            setIsPhotosDirty(true);
                            if (carouselIndex >= imagesList.length - 1) {
                              setCarouselIndex(Math.max(0, imagesList.length - 2));
                            }
                          }}
                          className="absolute top-3 left-3 h-6 px-2.5 rounded-md bg-red-600 hover:bg-red-700 text-white text-[11px] font-medium flex items-center gap-1 shadow-md transition-colors cursor-pointer z-10"
                          title="Șterge fotografia curentă din galerie"
                        >
                          <Trash2 size={11} />
                          <span>Șterge foto</span>
                        </button>
                      )}

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
                                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center opacity-90 hover:opacity-100 hover:scale-110 transition-all cursor-pointer shadow-md z-10"
                                title="Elimină fotografia din galerie"
                              >
                                <X size={12} />
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
        )}

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

            <div className="flex items-center gap-2">
              {!isPublicShared && imagesList.length > 0 && (
                <button
                  type="button"
                  onClick={() => handleDeleteCurrentPhoto(selectedPhotoIndex)}
                  className="px-2.5 py-1 text-xs text-red-400 hover:text-white bg-red-500/10 hover:bg-red-600 rounded flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="Șterge definitiv această fotografie din galerie"
                >
                  <Trash2 size={13} />
                  <span>Șterge foto</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setIsGalleryOpen(false)}
                className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                title="Închide galeria (Esc)"
              >
                <X size={22} />
              </button>
            </div>
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
