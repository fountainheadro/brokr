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
  UserCheck,
  Lock,
  Copy,
  Bookmark,
  Edit3,
  Plus,
  Upload,
  Image as ImageIcon,
  Trash2,
  Globe,
  ArrowUp,
  Loader2,
  Wand2
} from "lucide-react";
import toast from "react-hot-toast";
import { getPublicShareUrl } from "../utils/shareUtils";
import {
  resolvePublicDisplayTitle,
  resolvePublicDisplayDescription,
  getImageIdentityKey,
  normalizeStoredImageUrl,
} from "../utils/publicContentUtils";
import { publishPublicShareSnapshot } from "../services/publicShareService";
import { useTenantContext } from "../core/tenancy/ctx_tenant";
import { getCleanDisplayImageUrl, getThumbnailImageUrl } from "../utils/imageUtils";
import { regeneratePropertyImages } from "../utils/regeneratePropertyImages";
import { auth } from "../lib/firebase";
import { getApiAuthHeaders } from "../lib/apiAuth";
import { ProtectedPublicImage, prefetchProtectedPublicImage } from "./ProtectedPublicImage";
import {
  CriteriaDetailSections,
  derivePropertyCriteriaStateFromLead,
  getCriteriaSectionTitles,
} from "./CriteriaDetailSections";
import type { BuildingCategoryType } from "./PropertyCriteriaAccordionForm";

export interface PropertyDetailViewProps {
  lead: Lead;
  isPublicShared?: boolean; // When true: STRICTLY HIDES all owner details!
  contacts?: Contact[];
  onOpenEditForm?: () => void;
  showTopNavbar?: boolean;
  onDelete?: () => void;
  onAddActivity?: () => void;
  onUpdateLead?: (updatedData: Partial<Lead>) => void;
  onRefreshPublicProperty?: () => void;
}

interface NavSection {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const NAV_SECTIONS: NavSection[] = [
  { id: "photos", label: "Photos", icon: Camera },
  { id: "tranzactie", label: "Preț & Condiții", icon: BadgePercent },
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
  isPublicShared?: boolean;
}

const AttributeRow: React.FC<AttributeRowProps> = ({ 
  label, 
  value, 
  copyValue,
  isEditing = false,
  editValue,
  onEditChange,
  multiline = false,
  options,
  isPublicShared = false
}) => {
  const [copied, setCopied] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const textToCopy = copyValue || (typeof value === "string" ? value : "");

  const rawEdit = editValue ?? (typeof value === "string" ? value : "");
  const displayStr = typeof value === "string" ? value : "";
  const useMultiline = multiline || rawEdit.length > 52 || displayStr.length > 52;

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

  const activeFocus = isEditing && isFocused;
  const focusBoxClasses = activeFocus
    ? "!bg-amber-50/35 !border-[#BE9662] ring-2 ring-[#BE9662]/15 text-[#051D35]"
    : "bg-gray-50/90 hover:bg-gray-100/70 border-gray-200 text-gray-900";

  return (
    <div className="group/row relative flex flex-col min-w-0 font-sans">
      {/* Classic Label Above */}
      <label
        onClick={() => {
          if (!isEditing) return;
          if (options && options.length > 0) selectRef.current?.focus();
          else if (useMultiline) textareaRef.current?.focus();
          else inputRef.current?.focus();
        }}
        className={`flex items-center gap-2 px-2 text-[12px] leading-4 ${
          isPublicShared && !isEditing ? "mb-[8px]" : "mb-1"
        } font-semibold text-[#051D35] transition-colors select-none ${
          isEditing ? "cursor-pointer" : ""
        }`}
      >
        <span className="truncate">{label}</span>
        {activeFocus && (
          <span
            className="w-2 h-2 rounded-full bg-[#BE9662] shrink-0 animate-pulse"
            title="Mod focus activ"
          />
        )}
      </label>

      {/* Reserved Information / Input Slot Below (exact matching geometry -> 0px layout shift) */}
      {isEditing ? (
        options && options.length > 0 ? (
          <div className="relative w-full h-9">
            <select
              ref={selectRef}
              value={matchedValue}
              onChange={(e) => onEditChange?.(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              className={`w-full !h-9 !pl-2 !pr-7 !py-0 rounded-md border text-[12px] leading-5 font-sans font-normal outline-none shadow-none cursor-pointer appearance-none transition-all ${focusBoxClasses}`}
            >
              {options.map((opt) => (
                <option key={opt} value={opt} className="bg-white text-gray-900 font-sans font-normal">
                  {opt}
                </option>
              ))}
            </select>
            <ChevronDown
              size={13}
              className={`absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none transition-colors ${
                activeFocus ? "text-[#BE9662]" : "text-gray-400"
              }`}
            />
          </div>
        ) : useMultiline ? (
          <textarea
            ref={textareaRef}
            rows={2}
            value={editValue ?? (typeof value === "string" ? value : "")}
            onChange={(e) => onEditChange?.(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") (e.target as HTMLElement).blur();
            }}
            className={`w-full !px-2 !py-2 !min-h-[56px] rounded-md border text-[12px] leading-5 font-sans font-normal outline-none shadow-none resize-y transition-all ${focusBoxClasses}`}
          />
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
            className={`w-full !h-9 !px-2 !py-0 rounded-md border text-[12px] leading-5 font-sans font-normal outline-none shadow-none transition-all ${focusBoxClasses}`}
          />
        )
      ) : (
        <div
          className={`relative w-full px-2 rounded-md border border-transparent bg-transparent text-[12px] font-normal text-gray-900 select-text leading-5 ${
            isPublicShared
              ? "h-auto py-0 whitespace-pre-wrap break-words pr-8"
              : useMultiline
                ? "min-h-[56px] py-2 whitespace-pre-wrap break-words pr-8"
                : "h-9 flex items-center pr-8"
          }`}
        >
          <span className={isPublicShared || useMultiline ? "block w-full" : "truncate block w-full"}>
            {value}
          </span>

          {textToCopy && (
            <button
              type="button"
              onClick={handleCopy}
              className="opacity-0 group-hover/row:opacity-100 flex items-center justify-center w-6 h-6 rounded-md bg-white border border-gray-200 text-gray-400 hover:text-[#051D35] hover:border-gray-300 shadow-2xs transition-all active:scale-90 absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer z-10"
              title={`Copiază ${label}`}
            >
              {copied ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

interface SubCategoryHeaderProps {
  title: string;
  count?: string;
  actions?: React.ReactNode;
  isPublicShared?: boolean;
}

const SubCategoryHeader: React.FC<SubCategoryHeaderProps> = ({ title, count, actions }) => (
  <div className="min-h-10 py-2 px-5 bg-gray-50/60 border-b border-gray-100 flex items-center justify-between gap-2 select-none">
    <div className="flex items-center gap-2">
      <span className="w-2 h-2 rounded-full bg-[#BE9662]" />
      <span className="font-title text-[12px] font-semibold text-[#051D35]">
        {title}
      </span>
      {count && (
        <span className="text-[10px] text-gray-400 font-normal ml-1 tabular-nums">
          {count}
        </span>
      )}
    </div>
    {actions && <div className="flex items-center gap-2">{actions}</div>}
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
        className="h-8 px-3 rounded-md text-[11px] font-medium bg-white hover:bg-gray-100 text-gray-700 hover:text-[#051D35] border border-gray-200 transition-all flex items-center gap-2 shadow-2xs cursor-pointer font-sans"
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
        className="h-8 px-3 rounded-md text-[11px] font-medium bg-white hover:bg-gray-100 text-gray-500 hover:text-gray-800 border border-gray-300 transition-all flex items-center gap-2 shadow-2xs cursor-pointer font-sans"
        title="Renunță la editare"
      >
        <X size={11} className="text-gray-400" />
        <span>Cancel</span>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onCancel}
        className="h-8 px-2 rounded-md text-[11px] font-medium bg-white hover:bg-gray-100 text-gray-500 hover:text-gray-800 border border-gray-200 transition-all flex items-center gap-1 cursor-pointer font-sans"
        title="Renunță la modificări"
      >
        <X size={11} />
        <span>Cancel</span>
      </button>
      <button
        type="button"
        onClick={onSave}
        className="h-8 px-3 rounded-md text-[11px] font-semibold bg-[#051D35] hover:bg-[#0a2b4a] text-white border border-[#051D35] transition-all flex items-center gap-2 shadow-xs cursor-pointer font-sans"
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
  onAddActivity,
  onUpdateLead,
  onRefreshPublicProperty
}) => {
  const { tenant, platformRootDomain } = useTenantContext();
  const [internalBuildingType, setInternalBuildingType] = useState<BuildingCategoryType>(
    () => derivePropertyCriteriaStateFromLead(lead).buildingType
  );
  const internalIsRent =
    lead?.transactionType === "Închiriere" ||
    lead?.extractedData?.crmData?.detaliiGenerale?.tranzactie === "Închiriere";
  const internalSectionTitles = getCriteriaSectionTitles({
    mode: "property",
    role: internalIsRent ? "Chirias" : "Cumparator",
    buildingType: internalBuildingType,
  });
  const internalNavSections: NavSection[] = useMemo(
    () => [
      { id: "sec-persoana", label: internalSectionTitles.persoanaTitle, icon: User },
      { id: "sec-client-dorit", label: internalSectionTitles.clientDoritTitle, icon: UserCheck },
      { id: "sec-pret-conditii", label: internalSectionTitles.pretConditiiTitle, icon: BadgePercent },
      { id: "sec-generale", label: internalSectionTitles.generaleTitle, icon: FileText },
      { id: "sec-imobil", label: internalSectionTitles.imobilTitle, icon: Home },
      { id: "sec-avansate", label: internalSectionTitles.avansateTitle, icon: Layers },
      { id: "sec-alte", label: internalSectionTitles.alteTitle, icon: Sparkles },
      { id: "sec-imagini", label: "Fotografii", icon: Camera },
    ],
    [
      internalSectionTitles.persoanaTitle,
      internalSectionTitles.clientDoritTitle,
      internalSectionTitles.pretConditiiTitle,
      internalSectionTitles.generaleTitle,
      internalSectionTitles.imobilTitle,
      internalSectionTitles.avansateTitle,
      internalSectionTitles.alteTitle,
    ]
  );

  const [activeSection, setActiveSection] = useState<string>(
    isPublicShared ? (NAV_SECTIONS[0]?.id || "tranzactie") : "sec-persoana"
  );
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const publicShareUrl =
    lead?.propertyId || lead?.id
      ? getPublicShareUrl(lead, {
          agencySubdomain: tenant?.subdomain,
          rootDomain: platformRootDomain,
        })
      : "";
  
  // Ensure default active tab is always the first in jump links on mount or property change
  useEffect(() => {
    setInternalBuildingType(derivePropertyCriteriaStateFromLead(lead).buildingType);
    setActiveSection(isPublicShared ? (NAV_SECTIONS[0]?.id || "tranzactie") : "sec-persoana");
    if (isPublicShared) {
      window.scrollTo(0, 0);
    } else {
      if (mainScrollRef.current) {
        mainScrollRef.current.scrollTop = 0;
      }
      if (lead?.propertyId || lead?.id) {
        void publishPublicShareSnapshot(lead, { tenantId: tenant?.id });
      }
    }
  }, [lead?.id, lead?.propertyId, isPublicShared, tenant?.id]);
  
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
  const [showBackToTop, setShowBackToTop] = useState<boolean>(false);
  
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
      const pTitle = isPublicShared
        ? resolvePublicDisplayTitle(lead, "proprietatea prezentată")
        : (lead.extractedData?.crmData?.descriere?.titlu || lead.title || "proprietatea prezentată");
      const pId = lead.propertyId || lead.id || "";
      setFormMessage(`Bună ziua, sunt interesat de proprietatea ${pId ? `[#${pId}] ` : ""}"${pTitle}". Vă rog să mă contactați pentru detalii sau o vizionare.`);
    }
  }, [lead, isPublicShared]);

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
    const handleScroll = () => {
      // Don't override active tab during programmatic smooth scroll
      if (isManualScrollingRef.current) return;

      if (isPublicShared) {
        const scrollY = window.pageYOffset || document.documentElement.scrollTop || window.scrollY || 0;
        setShowBackToTop(scrollY > 200);

        // Window scroll check for public shared view
        const isAtBottom = window.innerHeight + scrollY >= document.documentElement.scrollHeight - 60;
        if (isAtBottom) {
          setActiveSection(NAV_SECTIONS[NAV_SECTIONS.length - 1].id);
          return;
        }

        if (scrollY <= 80) {
          setActiveSection("photos");
          return;
        }

        // Trigger line: 104px below viewport top (accounting for 88px fixed headers + 16px padding)
        const triggerLine = 104;
        let currentSectionId = "photos";
        for (const sect of NAV_SECTIONS) {
          const el = document.getElementById(sect.id);
          if (el) {
            const rect = el.getBoundingClientRect();
            if (rect.top <= triggerLine + 10) {
              currentSectionId = sect.id;
            }
          }
        }

        setActiveSection(currentSectionId);
        return;
      }

      const scrollContainer = mainScrollRef.current;
      if (!scrollContainer) return;

      // Check if user is scrolled to the absolute bottom of the container
      const isAtBottom = scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - 40;
      if (isAtBottom) {
        setActiveSection(internalNavSections[internalNavSections.length - 1].id);
        return;
      }

      // If at or near the top of the container, force the first jump link tab
      if (scrollContainer.scrollTop <= 40) {
        setActiveSection(internalNavSections[0].id);
        return;
      }

      const containerTop = scrollContainer.getBoundingClientRect().top;
      // Trigger line: 70px below the top of the visible content area
      const triggerLine = containerTop + 70;

      // Find the last section whose top has reached or passed the trigger line
      let currentSectionId = internalNavSections[0].id;
      for (const sect of internalNavSections) {
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

    if (isPublicShared) {
      window.addEventListener("scroll", handleScroll, { passive: true });
      return () => {
        window.removeEventListener("scroll", handleScroll);
        if (scrollTimeoutRef.current) {
          clearTimeout(scrollTimeoutRef.current);
        }
      };
    } else {
      const scrollContainer = mainScrollRef.current;
      if (!scrollContainer) return;
      scrollContainer.addEventListener("scroll", handleScroll, { passive: true });

      return () => {
        scrollContainer.removeEventListener("scroll", handleScroll);
        if (scrollTimeoutRef.current) {
          clearTimeout(scrollTimeoutRef.current);
        }
      };
    }
  }, [isPublicShared, internalNavSections]);

  const toggleCard = (cardId: string) => {
    setCollapsedCards(prev => ({
      ...prev,
      [cardId]: !prev[cardId]
    }));
  };

  const scrollToSection = (sectionId: string) => {
    // Immediately set active section and lock it to prevent scroll bounceback
    setActiveSection(sectionId);
    isManualScrollingRef.current = true;
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    scrollTimeoutRef.current = setTimeout(() => {
      isManualScrollingRef.current = false;
    }, 850);

    if (sectionId === "photos" || (!isPublicShared && sectionId === "sec-persoana")) {
      if (isPublicShared) {
        window.scrollTo({
          top: 0,
          behavior: "smooth"
        });
      } else {
        const scrollContainer = mainScrollRef.current;
        if (scrollContainer instanceof HTMLElement) {
          scrollContainer.scrollTo({ top: 0, behavior: "smooth" });
        } else {
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      }
      return;
    }

    const el = document.getElementById(sectionId);
    if (!el) return;

    if (isPublicShared) {
      // 88px fixed header (48px navbar + 40px jump links) + 16px padding = 104px
      const topOffset = 104;
      const currentScroll = window.pageYOffset || document.documentElement.scrollTop || window.scrollY || 0;
      const targetTop = el.getBoundingClientRect().top + currentScroll - topOffset;

      window.scrollTo({
        top: Math.max(0, targetTop),
        behavior: "smooth"
      });
      return;
    }

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
    if (!isPublicShared) {
      void publishPublicShareSnapshot(lead, { tenantId: tenant?.id, force: true });
    }
    const currentUrl = publicShareUrl || window.location.href;
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
    if (!isPublicShared) {
      void publishPublicShareSnapshot(lead, { tenantId: tenant?.id, force: true });
    }
    const currentUrl = publicShareUrl || window.location.href;
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
        url: publicShareUrl || (lead.url || ""),
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

  // Base clean proxy URLs come from shared imageUtils; per-slot thumbnails append ?w=...

  // Compile full image list with clean proxy URLs, respecting explicit user-saved `lead.images` order first
  const allImages = useMemo(() => {
    const images: string[] = [];
    const seenIds = new Set<string>();
    const addClean = (raw: string | undefined | null) => {
      if (!raw || typeof raw !== "string") return;
      const trimmed = raw.trim();
      if (!trimmed) return;
      const identity = getImageIdentityKey(trimmed) || trimmed;
      if (seenIds.has(identity)) return;
      const clean = getCleanDisplayImageUrl(trimmed);
      if (clean) {
        seenIds.add(identity);
        images.push(clean);
      }
    };

    const hasExplicitImagesArray = Array.isArray((lead as any)?.images);
    const coverStr = typeof lead?.coverImage === "string" ? lead.coverImage.trim() : "";

    // Explicit empty gallery after user deleted all photos
    if (hasExplicitImagesArray && (lead as any).images.length === 0 && !coverStr) {
      return [];
    }

    if (hasExplicitImagesArray && (lead as any).images.length > 0) {
      const explicitIds = new Set(
        (lead as any).images
          .map((item: any) => {
            const url = typeof item === "string" ? item : item?.original;
            return getImageIdentityKey(url);
          })
          .filter(Boolean)
      );
      // Only prepend coverImage if it isn't already part of the explicitly ordered images array
      if (coverStr && !explicitIds.has(getImageIdentityKey(coverStr))) {
        addClean(coverStr);
      }
      (lead as any).images.forEach((item: any) => {
        const url = typeof item === "string" ? item : item?.original;
        addClean(url);
      });
    } else if (coverStr) {
      addClean(coverStr);
    }

    const crmImagini = lead?.extractedData?.crmData?.imagini;
    if (crmImagini) {
      const categories = ["living", "camera", "bucatarie", "baie", "alteSpatii"] as const;
      categories.forEach(cat => {
        const list = crmImagini[cat];
        if (Array.isArray(list)) {
          list.forEach(item => {
            const url = typeof item === "string" ? item : item?.original;
            addClean(url);
          });
        }
      });
    }
    return images;
  }, [lead]);

  const crmData = lead?.extractedData?.crmData;
  const isRent = lead?.transactionType === "Închiriere" || crmData?.detaliiGenerale?.tranzactie === "Închiriere";
  const displayTitle = isPublicShared
    ? resolvePublicDisplayTitle(lead, "Proprietate Rezidențială")
    : (crmData?.descriere?.titlu || lead?.title || "Proprietate Rezidențială");
  const internalCode = lead?.propertyId || (lead?.id ? `P${lead.id.slice(0, 4)}` : "P41");
  const exactId = lead?.propertyId || (lead?.id ? (lead.id.length > 8 ? lead.id.slice(-6).toUpperCase() : lead.id) : internalCode);
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

  // Normalized price parts: amount, symbol '€' (strictly replacing any 'EUR', 'euro'), and rent flag
  const priceParts = useMemo(() => {
    const normalizeCandidate = (val: unknown): string => {
      if (val === null || val === undefined) return "";
      const s = String(val).trim();
      if (!s || s === "-" || s.toUpperCase() === "N/A") return "";
      return s;
    };

    const topLevelPrice = normalizeCandidate(lead?.price);
    const crmPrice = normalizeCandidate(crmData?.pret?.detalii?.pret);
    const rawStr = topLevelPrice || crmPrice || (isRent ? "775" : "145.000");

    // Strip out currency words & suffixes to keep pure formatted number
    let numOnly = rawStr
      .replace(/\s*(?:EUR|eur|euro|Euro|lei|RON|ron|€|\/.*|pe\s+lun[aă])/gi, "")
      .trim();

    if (!numOnly) {
      numOnly = isRent ? "775" : "145.000";
    }

    return {
      amount: numOnly,
      symbol: "€",
      isRent: isRent,
      fullText: `${numOnly} €${isRent ? " / lună" : ""}`
    };
  }, [crmData, lead, isRent]);

  const formattedPrice = priceParts.fullText;

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

  const publicSharedDescription = useMemo(
    () => resolvePublicDisplayDescription(lead, summaryDescription),
    [lead, summaryDescription]
  );

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
        titlu: crmData?.descriere?.titlu || lead?.title || saved.introducere?.titlu || displayTitle,
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
        "Baie 3": saved.dotari?.["Baie 3"] || "-",
        "Baie 4": saved.dotari?.["Baie 4"] || "-",
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
        "Condiții contractuale": saved.acte?.["Condiții contractuale"] || saved.acte?.["Contract"] || "12 luni",
        "Contract": saved.acte?.["Contract"] || saved.acte?.["Condiții contractuale"] || "12 luni",
        "Avans": saved.acte?.["Avans"] || "1 luna",
        "Garanție": saved.acte?.["Garanție"] || "1 luna",
        ...(saved.acte || {})
      },
      tranzactie: {
        ...(saved.tranzactie || {}),
        "Preț": formattedPrice,
        "TVA": saved.tranzactie?.["TVA"] || "Scutit de TVA / conform legislației în vigoare",
        "Comision": saved.tranzactie?.["Comision"] || defaultCommission,
      }
    };
  }, [lead, crmData?.descriere?.titlu, displayTitle, summaryDescription, suprafataUtila, compartimentare, etaj, anConstructie, camere, bai, balcoane, stareInterior, formattedPrice, defaultCommission]);

  const [sectionData, setSectionData] = useState<Record<string, Record<string, string>>>(initialPresentationSections);
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [draftSectionData, setDraftSectionData] = useState<Record<string, Record<string, string>>>({});
  const [titleFocused, setTitleFocused] = useState(false);
  const [introFocused, setIntroFocused] = useState(false);
  const introTitleInputRef = useRef<HTMLInputElement>(null);
  const introTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Photos state and inline editing
  const [imagesList, setImagesList] = useState<string[]>(allImages);
  const [isEditingPhotos, setIsEditingPhotos] = useState<boolean>(false);
  const [isPhotosDirty, setIsPhotosDirty] = useState<boolean>(false);
  const [isSavingPhotos, setIsSavingPhotos] = useState<boolean>(false);
  const [isRegeneratingImages, setIsRegeneratingImages] = useState<boolean>(false);
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

  const galleryImages = isPublicShared ? allImages : imagesList;

  const openLightboxAt = (index: number) => {
    if (galleryImages.length === 0) return;
    const clamped = Math.max(0, Math.min(index, galleryImages.length - 1));
    setSelectedPhotoIndex(clamped);
    setIsGalleryOpen(true);
  };

  useEffect(() => {
    if (!isGalleryOpen || galleryImages.length === 0) return;
    const handleLightboxKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsGalleryOpen(false);
      } else if (e.key === "ArrowRight" && galleryImages.length > 1) {
        setSelectedPhotoIndex((prev) => (prev >= galleryImages.length - 1 ? 0 : prev + 1));
      } else if (e.key === "ArrowLeft" && galleryImages.length > 1) {
        setSelectedPhotoIndex((prev) => (prev <= 0 ? galleryImages.length - 1 : prev - 1));
      }
    };
    window.addEventListener("keydown", handleLightboxKeyDown);
    return () => window.removeEventListener("keydown", handleLightboxKeyDown);
  }, [isGalleryOpen, galleryImages.length]);

  useEffect(() => {
    if (selectedPhotoIndex >= galleryImages.length && galleryImages.length > 0) {
      setSelectedPhotoIndex(0);
    }
  }, [galleryImages.length, selectedPhotoIndex]);

  // Silently prefetch adjacent lightbox photos so clicking Next / Prev is instantaneous
  useEffect(() => {
    if (!isGalleryOpen || !isPublicShared || galleryImages.length <= 1) return;
    const nextIdx = selectedPhotoIndex >= galleryImages.length - 1 ? 0 : selectedPhotoIndex + 1;
    const prevIdx = selectedPhotoIndex <= 0 ? galleryImages.length - 1 : selectedPhotoIndex - 1;
    const nextUrl = galleryImages[nextIdx] ? getThumbnailImageUrl(galleryImages[nextIdx], 1280) : "";
    const prevUrl = galleryImages[prevIdx] ? getThumbnailImageUrl(galleryImages[prevIdx], 1280) : "";
    if (nextUrl) prefetchProtectedPublicImage(nextUrl, "normal");
    if (prevUrl && prevIdx !== nextIdx) prefetchProtectedPublicImage(prevUrl, "normal");
  }, [isGalleryOpen, isPublicShared, selectedPhotoIndex, galleryImages]);

  useEffect(() => {
    const page = Math.floor(carouselIndex / 4);
    if (page !== slotPage) {
      setSlotPage(page);
    }
  }, [carouselIndex]);

  const handleSavePhotos = async () => {
    if (!lead?.id || isSavingPhotos) return;
    setIsSavingPhotos(true);
    try {
      const finalStoredPhotos: string[] = [];
      const seenStoredIds = new Set<string>();

      for (let i = 0; i < imagesList.length; i++) {
        const photo = imagesList[i];
        if (!photo || typeof photo !== "string") continue;

        if (photo.startsWith("data:")) {
          const authHeaders = await getApiAuthHeaders({ "Content-Type": "application/json" });
          const res = await fetch("/api/upload-photo", {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({
              dataUrl: photo,
              propertyId: lead.propertyId || lead.id,
              fileName: `prop_${lead.propertyId || lead.id}_${Date.now()}_${i}.jpg`,
            }),
          });
          if (!res.ok) {
            const errJson = await res.json().catch(() => ({}));
            throw new Error(errJson?.error || "Eroare la încărcarea fotografiei pe server.");
          }
          const uploadData = await res.json();
          const uploadedUrl = typeof uploadData?.url === "string" ? uploadData.url.trim() : "";
          if (uploadedUrl) {
            const idKey = getImageIdentityKey(uploadedUrl) || uploadedUrl;
            if (!seenStoredIds.has(idKey)) {
              seenStoredIds.add(idKey);
              finalStoredPhotos.push(uploadedUrl);
            }
          }
        } else {
          const canonicalUrl = normalizeStoredImageUrl(photo);
          if (!canonicalUrl || canonicalUrl.startsWith("blob:")) continue;
          const idKey = getImageIdentityKey(canonicalUrl) || canonicalUrl;
          if (!seenStoredIds.has(idKey)) {
            seenStoredIds.add(idKey);
            finalStoredPhotos.push(canonicalUrl);
          }
        }
      }

      const newCover = finalStoredPhotos[0] || "";
      const retainedIdSet = new Set(
        finalStoredPhotos.map((u) => getImageIdentityKey(u) || u)
      );

      // Update all categories in crmData.imagini to reflect only retained images (normalized)
      const existingCrmImagini = lead?.extractedData?.crmData?.imagini || {
        living: [],
        camera: [],
        bucatarie: [],
        baie: [],
        alteSpatii: [],
      };

      const filterAndNormalizeCategory = (arr: unknown) => {
        if (!Array.isArray(arr)) return [];
        const out: any[] = [];
        const localSeen = new Set<string>();
        for (const item of arr) {
          const rawUrl = typeof item === "string" ? item : item?.original;
          const normUrl = normalizeStoredImageUrl(rawUrl);
          const idKey = getImageIdentityKey(normUrl) || normUrl;
          if (!normUrl || !retainedIdSet.has(idKey) || localSeen.has(idKey)) continue;
          localSeen.add(idKey);
          out.push(typeof item === "string" ? { original: normUrl } : { ...item, original: normUrl });
        }
        return out;
      };

      const updatedCrmImagini: any = {
        living: filterAndNormalizeCategory(existingCrmImagini.living),
        camera: filterAndNormalizeCategory(existingCrmImagini.camera),
        bucatarie: filterAndNormalizeCategory(existingCrmImagini.bucatarie),
        baie: filterAndNormalizeCategory(existingCrmImagini.baie),
        alteSpatii: filterAndNormalizeCategory(existingCrmImagini.alteSpatii),
      };

      // Collect all remaining images across categories
      const allFoundIds = new Set<string>();
      (["living", "camera", "bucatarie", "baie", "alteSpatii"] as const).forEach((cat) => {
        updatedCrmImagini[cat]?.forEach((item: any) => {
          const u = typeof item === "string" ? item : item?.original;
          const idKey = getImageIdentityKey(u) || u;
          if (idKey) allFoundIds.add(idKey);
        });
      });

      // Ensure any newly uploaded/added image in finalStoredPhotos is preserved in alteSpatii
      finalStoredPhotos.forEach((img) => {
        const idKey = getImageIdentityKey(img) || img;
        if (!allFoundIds.has(idKey)) {
          updatedCrmImagini.alteSpatii.push({ original: img });
          allFoundIds.add(idKey);
        }
      });

      const nextExtractedData = lead.extractedData?.crmData
        ? ({
            ...lead.extractedData,
            crmData: {
              ...(lead.extractedData.crmData as any),
              imagini: updatedCrmImagini,
            },
          } as any)
        : lead.extractedData;

      const payload: Partial<Lead> = {
        coverImage: newCover,
        images: finalStoredPhotos,
        ...(nextExtractedData ? { extractedData: nextExtractedData } : {}),
      };

      const persisted = await leadsService.updateLeadData(lead.id, payload);

      const localPatch: Partial<Lead> = {
        ...payload,
        ...(persisted?.propertyId ? { propertyId: persisted.propertyId } : {}),
        ...(persisted?.updatedAt ? { updatedAt: persisted.updatedAt } : {}),
      };

      const mergedLead: Lead = {
        ...lead,
        ...localPatch,
      };

      // Ensure any locally uploaded /api/storage/media/ photos are replicated to shared Firestore
      // so external share pages on other domains/instances load them immediately.
      const storageMediaUrls = finalStoredPhotos.filter((u) => u.includes("/api/storage/media/"));
      if (storageMediaUrls.length > 0) {
        try {
          const syncHeaders = await getApiAuthHeaders({ "Content-Type": "application/json" });
          await fetch("/api/storage/sync-public-media", {
            method: "POST",
            headers: syncHeaders,
            body: JSON.stringify({ urls: storageMediaUrls }),
          });
        } catch {
          // Non-fatal; fresh uploads already sync inside /api/upload-photo
        }
      }

      // Immediately synchronize the sanitized public share snapshot so external share links
      // reflect the exact shuffled order, deletions, and newly uploaded images right away.
      await publishPublicShareSnapshot(mergedLead, {
        tenantId: tenant?.id,
        force: true,
      });

      // Notify parent component so allImages and thumbnails update immediately
      if (onUpdateLead) {
        onUpdateLead(localPatch);
      }

      setImagesList(finalStoredPhotos.map((u) => getCleanDisplayImageUrl(u) || u));
      setIsEditingPhotos(false);
      setIsPhotosDirty(false);
      toast.success("Fotografiile au fost salvate cu succes!");
    } catch (err: any) {
      console.error("Failed to save photos:", err);
      toast.error(err?.message || "Eroare la salvarea fotografiilor.");
    } finally {
      setIsSavingPhotos(false);
    }
  };

  const handleCancelPhotos = () => {
    setImagesList(allImages);
    setIsEditingPhotos(false);
    setIsPhotosDirty(false);
  };

  const handleRegenerateImages = async () => {
    if (!lead?.id || isRegeneratingImages) return;
    if (imagesList.length === 0) {
      toast.error("Nu există fotografii disponibile pentru regenerare.");
      return;
    }
    setIsRegeneratingImages(true);
    const loadingToastId = toast.loading(
      `Se regenerează ${imagesList.length} ${imagesList.length === 1 ? "fotografie" : "fotografii"} (ascundere watermark)...`
    );
    try {
      const result = await regeneratePropertyImages({
        lead,
        currentImages: imagesList,
        tenantId: tenant?.id,
        onUpdateLead,
      });
      setImagesList(result.images);
      toast.dismiss(loadingToastId);
      if (result.inpaintedCount > 0) {
        toast.success(
          `Au fost procesate ${result.processedCount}/${result.totalCount} fotografii și curățate ${result.inpaintedCount} watermark-uri.`,
          { duration: 5000 }
        );
      } else {
        toast.success(
          `Toate cele ${result.processedCount}/${result.totalCount} fotografii au fost regenerate și reîmprospătate.`,
          { duration: 4000 }
        );
      }
    } catch (err: any) {
      toast.dismiss(loadingToastId);
      console.error("[PropertyDetailView] Failed to regenerate images:", err);
      toast.error(err?.message || "Eroare la regenerarea imaginilor.");
    } finally {
      setIsRegeneratingImages(false);
    }
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
        const trimmedTitle = (updatedSec["titlu"] || "").trim();
        if (trimmedTitle) {
          updates["title"] = trimmedTitle;
          updates["extractedData.originalTitle"] = trimmedTitle;
          updates["extractedData.crmData.descriere.titlu"] = trimmedTitle;
        }
        if (updatedSec["summary"] !== undefined) {
          updates["extractedData.crmData.descriere.continut"] = updatedSec["summary"];
          updates["extractedData.originalDescription"] = updatedSec["summary"];
          updates["extractedData.markdownMarketing"] = updatedSec["summary"];
        }
      }

      const persisted = await leadsService.updateLeadData(lead.id, updates);

      let localPatch: Partial<Lead>;
      if (sectionId === "tranzactie") {
        const nextPrice = updatedSec["Preț"] ? String(updatedSec["Preț"]).trim() : undefined;
        const patchedExtracted = (persisted?.extractedData || {
          ...(lead.extractedData || {}),
          presentationSections: nextSectionData,
          crmData: {
            ...(lead.extractedData?.crmData || {}),
            ...(nextPrice
              ? {
                  pret: {
                    ...(lead.extractedData?.crmData?.pret || {}),
                    detalii: {
                      ...(lead.extractedData?.crmData?.pret?.detalii || {}),
                      pret: nextPrice,
                    },
                  },
                }
              : {}),
          },
        }) as any;
        localPatch = {
          ...(nextPrice ? { price: nextPrice } : {}),
          extractedData: patchedExtracted,
          ...(persisted?.updatedAt ? { updatedAt: persisted.updatedAt } : {}),
        };
      } else if (sectionId === "introducere") {
        const trimmedTitle = (updatedSec["titlu"] || "").trim();
        localPatch = {
          ...(trimmedTitle ? { title: trimmedTitle } : {}),
          extractedData: (persisted?.extractedData || {
            ...(lead.extractedData || {}),
            ...(trimmedTitle ? { originalTitle: trimmedTitle } : {}),
            ...(updatedSec["summary"] !== undefined
              ? {
                  originalDescription: updatedSec["summary"],
                  markdownMarketing: updatedSec["summary"],
                }
              : {}),
            presentationSections: nextSectionData,
            crmData: {
              ...(lead.extractedData?.crmData || {}),
              descriere: {
                ...(lead.extractedData?.crmData?.descriere || {}),
                ...(trimmedTitle ? { titlu: trimmedTitle } : {}),
                ...(updatedSec["summary"] !== undefined ? { continut: updatedSec["summary"] } : {}),
              },
            },
          }) as any,
          ...(persisted?.updatedAt ? { updatedAt: persisted.updatedAt } : {}),
        };
      } else {
        localPatch = {
          extractedData: (persisted?.extractedData || {
            ...(lead.extractedData || {}),
            presentationSections: nextSectionData,
          }) as any,
          ...(persisted?.updatedAt ? { updatedAt: persisted.updatedAt } : {}),
        };
      }

      if (onUpdateLead) {
        onUpdateLead(localPatch);
      }

      await publishPublicShareSnapshot(
        { ...lead, ...localPatch, ...(persisted || {}) },
        { tenantId: tenant?.id, force: true }
      );

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
    options?: string[],
    keepEmptyRow: boolean = false
  ) => {
    const isSecEditing = editingSection === sectionId;
    const originalVal = sectionData[sectionId]?.[label] ?? fallbackVal;
    const currentVal = isSecEditing 
      ? (draftSectionData[sectionId]?.[label] ?? originalVal) 
      : originalVal;

    const valStr = typeof currentVal === "string" ? currentVal.trim() : (currentVal == null ? "" : String(currentVal).trim());
    const isEmptyVal = valStr === "-" || valStr === "" || valStr === "N/A" || valStr === "null";

    // User rule: Where there is a "-", if no data has been found on the url provided for crawling, just remove that row of data in the page (unless explicitly preserved).
    if (!isSecEditing && !keepEmptyRow && isEmptyVal) {
      return null;
    }

    return (
      <AttributeRow
        key={label}
        label={label}
        value={isEmptyVal ? <span className="text-gray-400">-</span> : currentVal}
        copyValue={!isEmptyVal && typeof currentVal === "string" ? currentVal : ""}
        isEditing={isSecEditing}
        editValue={!isEmptyVal && typeof currentVal === "string" ? currentVal : ""}
        onEditChange={(newVal) => handleFieldChange(sectionId, label, newVal)}
        multiline={multiline}
        isLast={isLast}
        options={options}
        isPublicShared={isPublicShared}
      />
    );
  };

  return (
    <div ref={containerRef} className={isPublicShared ? "w-full min-h-screen bg-transparent text-gray-900 flex flex-col font-sans" : "w-full h-full flex-1 min-h-0 bg-white text-gray-900 flex flex-col font-sans selection:bg-[#BE9662]/20 overflow-hidden"}>
      
      {/* Header Container: 100% full-width fixed bar at the top for public shared page */}
      {isPublicShared ? (
        <header className="fixed top-0 left-0 right-0 w-full z-40 bg-white select-none shadow-none">
          {/* Row 1: Logo & Actions (100% full-width bar with 1px solid border, no shadow, boxed 1280px content) */}
          {showTopNavbar && (
            <div className="w-full border-b border-gray-200 h-12 bg-white">
              <div className="w-full max-w-[1280px] mx-auto px-4 sm:px-6 xl:px-0 h-12 flex items-center justify-between">
                <div className="flex items-center h-full">
                  <a 
                    href="/"
                    className="flex items-center select-none group focus:outline-none"
                    title="Acasă - brokr"
                  >
                    <span className="font-title text-[22px] font-semibold tracking-tight text-[#051D35] leading-none flex items-center">
                      brokr<span className="text-[#BE9662]">.</span>
                    </span>
                  </a>
                </div>

                <div className="flex items-center gap-2 h-full shrink-0">
                  <button
                    type="button"
                    onClick={handleNativeShare}
                    className="h-9 w-9 rounded-lg flex items-center justify-center bg-transparent hover:bg-gray-100 text-gray-500 hover:text-[#051D35] transition-colors shrink-0 cursor-pointer select-none group"
                    title="Distribuie proprietatea prin aplicația nativă a dispozitivului"
                  >
                    <Share2 size={17} className="text-gray-500 group-hover:text-[#051D35] transition-colors" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Row 2: Jump Links toolbar (100% full-width bar with 1px solid border, NO shadow, boxed 1280px content) */}
          <div className="w-full border-b border-gray-200 h-10 bg-white">
            <div className="w-full max-w-[1280px] mx-auto px-4 sm:px-6 xl:px-0 h-10 flex items-center justify-between gap-4 overflow-x-auto no-scrollbar">
              <div className="flex items-center gap-2 shrink-0 overflow-x-auto no-scrollbar py-1">
                {NAV_SECTIONS.map((sect) => {
                  const Icon = sect.icon;
                  const isActive = activeSection === sect.id;

                  return (
                    <button
                      key={sect.id}
                      type="button"
                      onClick={() => scrollToSection(sect.id)}
                      className={`h-7 px-3 flex items-center gap-2 text-xs rounded-md transition-colors whitespace-nowrap cursor-pointer group font-sans ${
                        isActive
                          ? "bg-[#051D35] text-white font-medium shadow-xs"
                          : "text-gray-600 hover:text-[#051D35] hover:bg-gray-100"
                      }`}
                    >
                      <Icon size={14} className={isActive ? "text-[#BE9662]" : "text-gray-500 group-hover:text-[#051D35] transition-colors"} />
                      <span>{sect.id === "photos" ? "Poze" : sect.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </header>
      ) : (
        <>
          {/* Top Navbar for modal/internal view */}
          {showTopNavbar && (
            <nav className="h-12 shrink-0 bg-white border-b border-gray-200 select-none z-30">
              <div className="w-full px-4 h-12 flex items-center justify-between">
                <div className="flex items-center h-full">
                  <span className="font-title text-[22px] font-semibold tracking-tight text-[#051D35] leading-none flex items-center">
                    brokr<span className="text-[#BE9662]">.</span>
                  </span>
                </div>

                <div className="flex items-center gap-2 h-full shrink-0">
                  <button
                    type="button"
                    onClick={handlePrint}
                    className="h-9 w-9 rounded-lg flex items-center justify-center bg-transparent hover:bg-gray-100 text-gray-500 hover:text-gray-900 transition-colors shrink-0 cursor-pointer select-none group"
                    title="Tipărește oferta"
                  >
                    <Printer size={17} className="text-gray-500 group-hover:text-gray-900 transition-colors" />
                  </button>

                  <button
                    type="button"
                    onClick={handleNativeShare}
                    className="h-9 w-9 rounded-lg flex items-center justify-center bg-transparent hover:bg-gray-100 text-gray-500 hover:text-[#051D35] transition-colors shrink-0 cursor-pointer select-none group"
                    title="Distribuie proprietatea"
                  >
                    <Share2 size={17} className="text-gray-500 group-hover:text-[#051D35] transition-colors" />
                  </button>
                </div>
              </div>
            </nav>
          )}

          {/* Jump Links toolbar for modal/internal view */}
          <div className="h-10 shrink-0 bg-white border-b border-gray-200 shadow-2xs select-none z-20">
            <div className="w-full px-4 h-10 flex items-center justify-between gap-4 overflow-x-auto no-scrollbar">
              <div className="flex items-center gap-2 shrink-0 overflow-x-auto no-scrollbar py-1">
                {internalNavSections.map((sect) => {
                  const Icon = sect.icon;
                  const isActive = activeSection === sect.id;

                  return (
                    <button
                      key={sect.id}
                      type="button"
                      onClick={() => scrollToSection(sect.id)}
                      className={`h-7 px-3 flex items-center gap-2 text-xs rounded-md transition-colors whitespace-nowrap cursor-pointer group font-sans ${
                        isActive
                          ? "bg-[#051D35] text-white font-medium shadow-xs"
                          : "text-gray-600 hover:text-[#051D35] hover:bg-gray-100"
                      }`}
                    >
                      <Icon size={14} className={isActive ? "text-[#BE9662]" : "text-gray-500 group-hover:text-[#051D35] transition-colors"} />
                      <span>{sect.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {onDelete && (
                  <button 
                    type="button"
                    onClick={onDelete}
                    className="h-7 w-7 flex items-center justify-center rounded-md border border-gray-200 bg-white hover:bg-red-50 hover:border-red-200 text-gray-500 hover:text-red-600 transition-colors shrink-0 cursor-pointer shadow-2xs group"
                    title="Mută în Șterse"
                  >
                    <Trash2 size={14} className="text-gray-500 group-hover:text-red-600 transition-colors" />
                  </button>
                )}

                <button
                  type="button"
                  onClick={handlePrint}
                  className="h-7 w-7 flex items-center justify-center rounded-md border border-gray-200 bg-white hover:bg-gray-50 hover:border-gray-300 text-gray-600 hover:text-[#051D35] transition-colors shrink-0 cursor-pointer shadow-2xs group"
                  title="Tipărește oferta"
                >
                  <Printer size={14} className="text-gray-500 group-hover:text-[#051D35] transition-colors" />
                </button>

                <button
                  type="button"
                  onClick={handleNativeShare}
                  className="h-7 w-7 flex items-center justify-center rounded-md border border-gray-200 bg-white hover:bg-gray-50 hover:border-gray-300 text-gray-600 hover:text-[#051D35] transition-colors shrink-0 cursor-pointer shadow-2xs group"
                  title="Distribuie proprietatea prin aplicația nativă a dispozitivului"
                >
                  <Share2 size={14} className="text-gray-500 group-hover:text-[#051D35] transition-colors" />
                </button>

                {publicShareUrl && (
                  <a
                    href={publicShareUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="h-7 w-7 flex items-center justify-center rounded-md border border-gray-200 bg-white hover:bg-gray-50 hover:border-gray-300 text-gray-600 hover:text-[#051D35] transition-colors shrink-0 cursor-pointer shadow-2xs group"
                    title="Deschide pagina publică a leadului"
                  >
                    <Globe size={14} className="text-gray-500 group-hover:text-[#051D35] transition-colors" />
                  </a>
                )}

                {lead?.url ? (
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
                )}

                {onAddActivity && (
                  <button
                    type="button"
                    onClick={onAddActivity}
                    className="h-7 px-3 flex items-center gap-2 text-xs font-medium bg-[#051D35] hover:bg-[#0a2b4a] text-white rounded-md transition-colors cursor-pointer shrink-0 shadow-xs group"
                    title="Adaugă activitate pentru această proprietate"
                  >
                    <Plus size={13} className="text-[#BE9662]" />
                    <span>Activitate</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Main Layout (Scrollable container below the fixed headers) */}
      {!isPublicShared ? (
        <main ref={mainScrollRef} className="w-full flex-1 min-h-0 bg-gray-50 p-0 overflow-y-auto scroll-smooth custom-scrollbar">
          <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4 text-xs">
            {/* Exact 4 Accordion Sections & Fields */}
            <CriteriaDetailSections
              lead={lead}
              role={internalIsRent ? "Chirias" : "Cumparator"}
              mode="property"
              onUpdateLead={onUpdateLead || (() => {})}
              onBuildingTypeDisplayChange={setInternalBuildingType}
            />

            {/* LAST SECTION: Fotografii Imobil (kept as-is) */}
            <div id="sec-imagini" className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-2xs font-sans scroll-mt-[104px]">
              <div className="px-5 py-4 bg-gray-50/80 border-b border-gray-200 flex items-center justify-between select-none">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#051D35]/5 text-[#051D35] flex items-center justify-center font-semibold">
                    <Camera size={16} />
                  </div>
                  <div>
                    <h2 className="font-title text-[12px] font-semibold text-[#051D35]">
                      Fotografii Imobil
                    </h2>
                    <span className="text-[10px] text-gray-500 font-normal font-sans">
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
                  disabled={isSavingPhotos}
                />
              </div>

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
                {isDraggingOverCard && (
                  <div className="absolute inset-0 bg-[#051D35]/85 backdrop-blur-xs z-30 flex flex-col items-center justify-center text-white pointer-events-none p-4 text-center border-2 border-dashed border-[#BE9662] transition-all">
                    <div className="w-12 h-12 rounded-full bg-[#BE9662]/20 text-[#BE9662] flex items-center justify-center mb-2 animate-bounce">
                      <Upload size={24} />
                    </div>
                    <p className="font-title text-sm font-semibold tracking-wide">Plasează fotografiile aici</p>
                    <p className="text-xs text-gray-300 mt-1">Trage fișierele pentru a le adăuga în galerie</p>
                  </div>
                )}

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
                <div className="relative aspect-[16/10] sm:aspect-[16/9] max-h-[420px] w-full bg-gray-100 rounded-lg group select-none overflow-hidden border border-gray-200">
                  {imagesList.length > 0 ? (
                    <>
                      <img
                        src={getThumbnailImageUrl(imagesList[carouselIndex] || imagesList[0], 1000)}
                        alt={`${displayTitle} - foto ${carouselIndex + 1}`}
                        decoding="async"
                        onClick={() => { setSelectedPhotoIndex(carouselIndex); setIsGalleryOpen(true); }}
                        className="w-full h-full object-cover cursor-pointer group-hover:scale-102 transition-transform duration-300"
                        referrerPolicy="no-referrer"
                      />

                      <div className="absolute top-3 right-3 flex items-center gap-2 z-10">
                        {isEditingPhotos && imagesList.length > 0 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const idxToDelete = carouselIndex;
                              setImagesList(prev => prev.filter((_, i) => i !== idxToDelete));
                              setIsPhotosDirty(true);
                              if (carouselIndex >= imagesList.length - 1) {
                                setCarouselIndex(Math.max(0, imagesList.length - 2));
                              }
                            }}
                            className="h-7 px-3 rounded-md bg-red-600 hover:bg-red-700 text-white text-[11px] font-sans font-medium backdrop-blur-xs flex items-center gap-1 transition-colors cursor-pointer shadow-xs"
                            title="Șterge fotografia curentă"
                          >
                            <X size={11} />
                            <span>Șterge</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => { setSelectedPhotoIndex(carouselIndex); setIsGalleryOpen(true); }}
                          className="h-7 px-2 rounded-md bg-black/65 hover:bg-black/85 text-white text-[11px] font-normal backdrop-blur-xs flex items-center gap-1 transition-colors cursor-pointer tabular-nums"
                          title="Deschide galeria completă"
                        >
                          <Camera size={11} className="text-[#BE9662]" />
                          <span>{carouselIndex + 1} / {imagesList.length}</span>
                        </button>
                      </div>

                      {imagesList.length > 1 && (
                        <>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setCarouselIndex((prev) => (prev === 0 ? imagesList.length - 1 : prev - 1));
                            }}
                            className="absolute left-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 hover:bg-black/75 text-white flex items-center justify-center opacity-80 sm:opacity-0 group-hover:opacity-100 transition-all cursor-pointer backdrop-blur-xs shadow-sm z-10"
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
                            className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 hover:bg-black/75 text-white flex items-center justify-center opacity-80 sm:opacity-0 group-hover:opacity-100 transition-all cursor-pointer backdrop-blur-xs shadow-sm z-10"
                            title="Fotografia următoare"
                          >
                            <ChevronRight size={16} />
                          </button>
                        </>
                      )}
                    </>
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-gray-400 gap-2 p-4 text-center">
                      <Camera size={32} className="text-gray-300" />
                      <span className="text-xs font-normal">Nicio fotografie disponibilă</span>
                    </div>
                  )}
                </div>

                {/* Thumbnails Slots & Pagination */}
                <div className="space-y-2 pt-1">
                  {imagesList.length > 4 && (
                    <div className="flex items-center justify-between text-[11px] text-gray-500 font-sans px-1">
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
                        <span className="text-[10px] px-1 tabular-nums">{slotPage + 1}/{Math.ceil(imagesList.length / 4)}</span>
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
                              src={getThumbnailImageUrl(imgUrl, 180)}
                              alt={`Foto ${actualIndex + 1}`}
                              loading="lazy"
                              decoding="async"
                              className="w-full h-full object-cover select-none"
                              referrerPolicy="no-referrer"
                            />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors pointer-events-none" />
                            <span className="absolute bottom-1 left-1 px-1 py-0 rounded bg-black/60 text-white text-[9px] pointer-events-none tabular-nums">
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
                          <span className="text-[10px] text-gray-300 tabular-nums">{slotPage * 4 + offset + 1}</span>
                        </div>
                      );
                    })}

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

            {/* Watermark Regeneration Bar (internal CRM only) */}
            <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 shadow-2xs font-sans flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-start sm:items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#051D35]/5 text-[#051D35] flex items-center justify-center shrink-0">
                  <Wand2 size={16} className="text-[#BE9662]" />
                </div>
                <div>
                  <h3 className="font-title text-[12px] font-semibold text-[#051D35]">
                    Curățare Watermark Fotografii
                  </h3>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    Reprocesează toate cele {imagesList.length} {imagesList.length === 1 ? "fotografie" : "fotografii"} ale proprietății prin inpainting pentru a ascunde watermark-urile.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleRegenerateImages()}
                disabled={isRegeneratingImages || isEditingPhotos || imagesList.length === 0}
                className="h-9 px-4 rounded-lg bg-[#051D35] hover:bg-[#0a2b4a] text-white text-xs font-semibold transition-colors cursor-pointer flex items-center justify-center gap-2 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed shadow-2xs"
              >
                {isRegeneratingImages ? (
                  <>
                    <Loader2 size={14} className="animate-spin text-[#BE9662]" />
                    <span>Se regenerează imaginile...</span>
                  </>
                ) : (
                  <>
                    <Wand2 size={14} className="text-[#BE9662]" />
                    <span>Regenerează imagini (ascunde watermark)</span>
                  </>
                )}
              </button>
            </div>

            <div className="h-[16vh] min-h-[120px] pointer-events-none" aria-hidden="true" />
          </div>
        </main>
      ) : (
      <main ref={mainScrollRef} className={isPublicShared ? "w-full bg-transparent p-0 overflow-visible pt-[104px]" : "w-full flex-1 min-h-0 bg-white p-0 overflow-y-auto scroll-smooth"}>
        <div className={isPublicShared ? "w-full max-w-[1280px] mx-auto px-4 sm:px-6 xl:px-0 pb-10 space-y-4" : "grid grid-cols-1 lg:grid-cols-12 min-h-full items-start"}>
          
          {/* Main Column */}
          <div className={isPublicShared ? "w-full p-0 space-y-4" : "lg:col-span-8 p-4 sm:p-6 space-y-4 border-b lg:border-b-0 lg:border-r border-gray-200"}>

            {/* Mosaic Photo Gallery (no container card, no header) */}
            {allImages.length > 0 && (
              <div
                id="photos"
                className={`w-full h-[50vh] lg:h-[420px] rounded-xl overflow-hidden grid ${
                  isPublicShared ? "grid-cols-3 md:grid-cols-4" : "grid-cols-4"
                } grid-rows-1 gap-2 bg-gray-100 select-none scroll-mt-[104px]`}
              >
                {/* Col 1 (66.7% width on mobile public share, 50% on desktop) - 1st photo */}
                <div 
                  onClick={() => openLightboxAt(0)}
                  className="col-span-2 relative h-full min-h-0 overflow-hidden cursor-pointer group bg-gray-200"
                >
                  {isPublicShared ? (
                    <ProtectedPublicImage
                      src={getThumbnailImageUrl(allImages[0], 1280)}
                      alt={`${displayTitle} - foto principală`}
                      fit="cover"
                      priority="high"
                      onAuthExpired={onRefreshPublicProperty}
                      className="group-hover:scale-102 transition-transform duration-300"
                    />
                  ) : (
                    <img 
                      src={getThumbnailImageUrl(allImages[0], 1000)} 
                      alt={`${displayTitle} - foto principală`}
                      decoding="async"
                      className="w-full h-full object-cover group-hover:scale-102 transition-transform duration-300"
                      referrerPolicy="no-referrer"
                    />
                  )}
                </div>

                {/* Col 2 (33.3% width on mobile public share, 25% on desktop) - 2 equal 50% height stacked photos aligned with Col 1 bottom */}
                <div className="col-span-1 grid grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-2 h-full min-h-0">
                  <div 
                    onClick={() => openLightboxAt(1)}
                    className="relative w-full h-full min-h-0 overflow-hidden cursor-pointer group bg-gray-200"
                  >
                    {isPublicShared ? (
                      <ProtectedPublicImage
                        src={getThumbnailImageUrl(allImages[1] || allImages[0], allImages[1] ? 640 : 1280)}
                        alt={`${displayTitle} - foto 2`}
                        fit="cover"
                        onAuthExpired={onRefreshPublicProperty}
                        className="group-hover:scale-102 transition-transform duration-300"
                      />
                    ) : (
                      <img 
                        src={getThumbnailImageUrl(allImages[1] || allImages[0], 560)} 
                        alt={`${displayTitle} - foto 2`}
                        decoding="async"
                        className="w-full h-full object-cover group-hover:scale-102 transition-transform duration-300"
                        referrerPolicy="no-referrer"
                      />
                    )}
                  </div>
                  <div 
                    onClick={() => openLightboxAt(2)}
                    className="relative w-full h-full min-h-0 overflow-hidden cursor-pointer group bg-gray-200"
                  >
                    {isPublicShared ? (
                      <ProtectedPublicImage
                        src={getThumbnailImageUrl(allImages[2] || allImages[0], allImages[2] ? 640 : 1280)}
                        alt={`${displayTitle} - foto 3`}
                        fit="cover"
                        onAuthExpired={onRefreshPublicProperty}
                        className="group-hover:scale-102 transition-transform duration-300"
                      />
                    ) : (
                      <img 
                        src={getThumbnailImageUrl(allImages[2] || allImages[0], 560)} 
                        alt={`${displayTitle} - foto 3`}
                        decoding="async"
                        className="w-full h-full object-cover group-hover:scale-102 transition-transform duration-300"
                        referrerPolicy="no-referrer"
                      />
                    )}
                    {isPublicShared && (
                      <div className="flex md:hidden absolute inset-0 bg-black/55 group-hover:bg-black/65 transition-colors flex-col items-center justify-center text-center p-2 cursor-pointer z-10">
                        <span className="text-white text-xs sm:text-sm font-semibold underline underline-offset-4 decoration-2 font-sans tracking-wide leading-tight">
                          Toate imaginile ({allImages.length})
                        </span>
                        {allImages.length > 3 && (
                          <span className="text-gray-200 text-[11px] sm:text-xs mt-1 font-normal font-sans">
                            +{allImages.length - 2} imagini
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Col 3 (hidden on mobile public share; 25% width on desktop) - 2 equal 50% height stacked photos aligned with Col 1 bottom, last photo acts as open lightbox link */}
                <div
                  className={`${
                    isPublicShared ? "hidden md:grid" : "grid"
                  } col-span-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-2 h-full min-h-0`}
                >
                  <div 
                    onClick={() => openLightboxAt(3)}
                    className="relative w-full h-full min-h-0 overflow-hidden cursor-pointer group bg-gray-200"
                  >
                    {isPublicShared ? (
                      <ProtectedPublicImage
                        src={getThumbnailImageUrl(allImages[3] || allImages[0], allImages[3] ? 640 : 1280)}
                        alt={`${displayTitle} - foto 4`}
                        fit="cover"
                        onAuthExpired={onRefreshPublicProperty}
                        className="group-hover:scale-102 transition-transform duration-300"
                      />
                    ) : (
                      <img 
                        src={getThumbnailImageUrl(allImages[3] || allImages[0], 560)} 
                        alt={`${displayTitle} - foto 4`}
                        decoding="async"
                        className="w-full h-full object-cover group-hover:scale-102 transition-transform duration-300"
                        referrerPolicy="no-referrer"
                      />
                    )}
                  </div>
                  <div 
                    onClick={() => openLightboxAt(4)}
                    className="relative w-full h-full min-h-0 overflow-hidden cursor-pointer group bg-gray-200"
                  >
                    {isPublicShared ? (
                      <ProtectedPublicImage
                        src={getThumbnailImageUrl(allImages[4] || allImages[0], allImages[4] ? 640 : 1280)}
                        alt={`${displayTitle} - foto 5`}
                        fit="cover"
                        onAuthExpired={onRefreshPublicProperty}
                        className="group-hover:scale-102 transition-transform duration-300"
                      />
                    ) : (
                      <img 
                        src={getThumbnailImageUrl(allImages[4] || allImages[0], 560)} 
                        alt={`${displayTitle} - foto 5`}
                        decoding="async"
                        className="w-full h-full object-cover group-hover:scale-102 transition-transform duration-300"
                        referrerPolicy="no-referrer"
                      />
                    )}
                    {/* Dark overlay showing total count & open lightbox link */}
                    <div className="absolute inset-0 bg-black/55 group-hover:bg-black/65 transition-colors flex flex-col items-center justify-center text-center p-2 cursor-pointer z-10">
                      <span className="text-white text-sm sm:text-base md:text-lg font-semibold underline underline-offset-4 decoration-2 font-sans tracking-wide">
                        Toate imaginile ({allImages.length})
                      </span>
                      {allImages.length > 5 && (
                        <span className="text-gray-200 text-[11px] sm:text-xs mt-1 font-normal font-sans">
                          +{allImages.length - 4} imagini
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* #CARD 1: "PREȚ & CONDIȚII" */}
            <div id="tranzactie" className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs scroll-mt-[104px] font-sans">
              <div className={`p-5 bg-gray-50/80 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${isPublicShared ? "" : "select-none"}`}>
                <div className="space-y-2 min-w-0 flex-1">
                  <h1 className="font-title text-[19px] font-semibold text-[#051D35] leading-snug tracking-tight">
                    {displayTitle}
                  </h1>
                  <div className="flex items-baseline gap-2">
                    <span
                      className={
                        isPublicShared
                          ? "font-title text-[19px] font-semibold text-[#051D35] leading-snug tracking-tight tabular-nums"
                          : "text-2xl sm:text-3xl font-semibold text-[#051D35] tracking-tight tabular-nums"
                      }
                    >
                      {priceParts.amount} €
                    </span>
                    {priceParts.isRent && (
                      <span className={isPublicShared ? "text-[14px] font-normal text-gray-500" : "text-[16px] font-normal text-gray-500"}>
                        / lună
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-4 shrink-0 border-l border-gray-200 pl-5 py-1">
                  <span
                    className={
                      isPublicShared
                        ? "font-title text-[14px] font-normal text-gray-900 leading-snug tracking-tight tabular-nums"
                        : "text-sm sm:text-base font-semibold text-gray-900 tracking-tight tabular-nums"
                    }
                  >
                    ID: {exactId}
                  </span>
                  <SectionEditButton
                    isEditing={editingSection === "tranzactie"}
                    isDirty={isSectionDirty("tranzactie")}
                    onStartEdit={() => handleStartEditSection("tranzactie")}
                    onCancel={() => handleCancelEditSection("tranzactie")}
                    onSave={() => handleSaveSection("tranzactie")}
                    disabled={isPublicShared}
                  />
                </div>
              </div>

              {/* 2-column layout: clean label-above / info-below fields with zero boxes in view mode */}
              {isPublicShared ? (
                (() => {
                  const leftCells = [
                    renderRow("tranzactie", "Preț", formattedPrice),
                    renderRow("tranzactie", "TVA", "Scutit de TVA / conform legislației în vigoare"),
                    renderRow("tranzactie", "Comision", defaultCommission, true),
                  ];
                  const rightCells = isRent
                    ? [
                        renderRow("acte", "Contract", "12 luni", false, false, CONDITII_CONTRACTUALE_OPTIONS),
                        renderRow("acte", "Avans", "1 luna", false, false, AVANS_GARANTIE_OPTIONS),
                        renderRow("acte", "Garanție", "1 luna", true, false, AVANS_GARANTIE_OPTIONS),
                      ]
                    : [
                        renderRow("acte", "Situație juridică", "Fara probleme"),
                        renderRow("acte", "Disponibilitate", "Imediată"),
                        renderRow("acte", "Finanțare", "Credit bancar / fonduri proprii", true),
                      ];
                  const rowPairs = leftCells
                    .map((left, idx) => ({ left, right: rightCells[idx] ?? null }))
                    .filter((pair) => pair.left !== null || pair.right !== null);
                  const leftOrders = ["order-1 md:order-none", "order-2 md:order-none", "order-3 md:order-none"];
                  const rightOrders = ["order-4 md:order-none", "order-5 md:order-none", "order-6 md:order-none"];
                  const lastIdx = rowPairs.length - 1;

                  return (
                    <div className="grid grid-cols-1 md:grid-cols-2 font-sans">
                      {rowPairs.map((pair, idx) => (
                        <React.Fragment key={idx}>
                          <div
                            className={`${leftOrders[idx] || ""} px-5 ${
                              idx === 0 ? "pt-5" : "pt-[20px]"
                            } ${idx === lastIdx ? "pb-5 md:pb-5" : ""} md:border-r md:border-gray-100`}
                          >
                            {pair.left}
                          </div>
                          <div
                            className={`${rightOrders[idx] || ""} px-5 ${
                              idx === 0 ? "pt-5 border-t border-gray-100 md:border-t-0" : "pt-[20px]"
                            } ${idx === lastIdx ? "pb-5" : ""}`}
                          >
                            {pair.right}
                          </div>
                        </React.Fragment>
                      ))}
                    </div>
                  );
                })()
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-100 font-sans">
                  <div className={`p-5 ${editingSection === "tranzactie" ? "space-y-[16px]" : "space-y-4"}`}>
                    {isRent ? (
                      <>
                        {renderRow("acte", "Condiții contractuale", "12 luni", false, false, CONDITII_CONTRACTUALE_OPTIONS)}
                        {renderRow("acte", "Avans", "1 luna", false, false, AVANS_GARANTIE_OPTIONS)}
                        {renderRow("acte", "Garanție", "1 luna", true, false, AVANS_GARANTIE_OPTIONS)}
                      </>
                    ) : (
                      <>
                        {renderRow("acte", "Situație juridică", "Fara probleme")}
                        {renderRow("acte", "Disponibilitate", "Imediată")}
                        {renderRow("acte", "Finanțare", "Credit bancar / fonduri proprii", true)}
                      </>
                    )}
                  </div>

                  <div className={`p-5 ${editingSection === "tranzactie" ? "space-y-[16px]" : "space-y-4"}`}>
                    {renderRow("tranzactie", "Preț", formattedPrice)}
                    {renderRow("tranzactie", "TVA", "Scutit de TVA / conform legislației în vigoare")}
                    {renderRow("tranzactie", "Comision", defaultCommission, true)}
                  </div>
                </div>
              )}
            </div>

            {/* #CARD 2: "INTRODUCERE" */}
            <div id="introducere" className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs scroll-mt-[104px] font-sans">
              <div className="px-5 py-4 bg-gray-50/80 border-b border-gray-200 flex items-center justify-between select-none">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#051D35]/5 text-[#051D35] flex items-center justify-center font-semibold">
                    <FileText size={16} />
                  </div>
                  <div>
                    <h2 className="font-title text-[12px] font-semibold text-[#051D35]">
                      Introducere
                    </h2>
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

              <div className={`p-5 font-sans ${!isPublicShared ? "space-y-4" : ""}`}>
                {!isPublicShared && (
                  <div>
                    <label
                      onClick={() => {
                        if (editingSection === "introducere") introTitleInputRef.current?.focus();
                      }}
                      className={`flex items-center gap-2 px-2 text-[12px] leading-4 mb-1 font-semibold text-[#051D35] transition-colors select-none ${
                        editingSection === "introducere" ? "cursor-pointer" : ""
                      }`}
                    >
                      <span>Titlu</span>
                      {editingSection === "introducere" && titleFocused && (
                        <span
                          className="w-2 h-2 rounded-full bg-[#BE9662] shrink-0 animate-pulse"
                          title="Mod focus activ"
                        />
                      )}
                    </label>

                    {editingSection === "introducere" ? (
                      <input
                        ref={introTitleInputRef}
                        type="text"
                        value={draftSectionData["introducere"]?.["titlu"] ?? (sectionData["introducere"]?.["titlu"] || displayTitle)}
                        onChange={(e) => handleFieldChange("introducere", "titlu", e.target.value)}
                        onFocus={() => setTitleFocused(true)}
                        onBlur={() => setTitleFocused(false)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") (e.target as HTMLElement).blur();
                        }}
                        className={`w-full !h-9 !px-2 rounded-md border text-[12px] font-sans font-normal leading-5 outline-none shadow-none select-text transition-all ${
                          titleFocused
                            ? "!bg-amber-50/35 !border-[#BE9662] ring-2 ring-[#BE9662]/15 text-[#051D35]"
                            : "bg-gray-50/90 hover:bg-gray-100/70 border-gray-200 text-gray-800"
                        }`}
                        placeholder="Introdu titlul proprietății..."
                      />
                    ) : (
                      <div className="w-full px-2 py-2 rounded-md border border-transparent bg-transparent text-[12px] text-gray-800 leading-5 font-normal select-text font-sans">
                        {sectionData["introducere"]?.["titlu"] || displayTitle}
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <label
                    onClick={() => {
                      if (editingSection === "introducere") introTextareaRef.current?.focus();
                    }}
                    className={`flex items-center gap-2 px-2 text-[12px] leading-4 ${
                      isPublicShared ? "mb-[8px]" : "mb-1"
                    } font-semibold text-[#051D35] transition-colors select-none ${
                      editingSection === "introducere" ? "cursor-pointer" : ""
                    }`}
                  >
                    <span>{isPublicShared ? "Descriere proprietate" : "Descriere"}</span>
                    {editingSection === "introducere" && introFocused && (
                      <span
                        className="w-2 h-2 rounded-full bg-[#BE9662] shrink-0 animate-pulse"
                        title="Mod focus activ"
                      />
                    )}
                  </label>

                  {editingSection === "introducere" ? (
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
                      className={`w-full !px-2 !py-2 !min-h-[120px] rounded-md border text-[12px] font-sans font-normal leading-[1.6] outline-none shadow-none resize-y select-text transition-all ${
                        introFocused
                          ? "!bg-amber-50/35 !border-[#BE9662] ring-2 ring-[#BE9662]/15 text-[#051D35]"
                          : "bg-gray-50/90 hover:bg-gray-100/70 border-gray-200 text-gray-800"
                      }`}
                      placeholder="Descrierea proprietății..."
                    />
                  ) : (
                    <div
                      className={`w-full px-2 ${
                        isPublicShared ? "py-0 h-auto" : "py-2 min-h-[120px]"
                      } rounded-md border border-transparent bg-transparent text-[12px] text-gray-700 leading-[1.6] font-normal whitespace-pre-line select-text font-sans`}
                    >
                      {isPublicShared
                        ? publicSharedDescription
                        : (sectionData["introducere"]?.["summary"] || summaryDescription)}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* #CARD "APARTAMENT" */}
            <div id="apartament" className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs scroll-mt-[104px]">
              <div className="px-5 py-4 bg-gray-50/80 border-b border-gray-200 flex items-center justify-between select-none">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#051D35]/5 text-[#051D35] flex items-center justify-center font-semibold">
                    <Home size={16} />
                  </div>
                  <h2 className="font-title text-[12px] font-semibold text-[#051D35]">
                    Apartament
                  </h2>
                </div>
              </div>

              {(() => {
                const apartmentRooms = [
                  { label: "Living", finisaje: "vopsea lavabilă, parchet", mobilare: "canapea, măsuță cafea, comodă", dotari: "aer condiționat, smart TV" },
                  ...(bedroomCount >= 1 ? [{ label: "Camera 1", finisaje: "vopsea lavabilă, parchet", mobilare: "pat, noptiere, dulap", dotari: "-" }] : []),
                  ...(bedroomCount >= 2 ? [{ label: "Camera 2", finisaje: "vopsea lavabilă, parchet", mobilare: "pat, noptiere, dulap", dotari: "-" }] : []),
                  ...(bedroomCount >= 3 ? [{ label: "Camera 3", finisaje: "vopsea lavabilă, parchet", mobilare: "pat, noptiere, dulap", dotari: "-" }] : []),
                  ...(bedroomCount >= 4 ? [{ label: "Camera 4", finisaje: "vopsea lavabilă, parchet", mobilare: "pat, noptiere, dulap", dotari: "-" }] : []),
                  { label: "Bucătărie", finisaje: "vopsea lavabilă, faianță și gresie", mobilare: "mobilă de bucatarie premium", dotari: "frigider, plită, cuptor, hotă" },
                  ...(baiCount >= 1 ? [{ label: "Baie 1", finisaje: "faianță și gresie", mobilare: "obiecte sanitare premium", dotari: "-" }] : []),
                  ...(baiCount >= 2 ? [{ label: "Baie 2", finisaje: "faianță și gresie", mobilare: "obiecte sanitare premium", dotari: "-" }] : []),
                  ...(baiCount >= 3 ? [{ label: "Baie 3", finisaje: "faianță și gresie", mobilare: "obiecte sanitare premium", dotari: "-" }] : []),
                  ...(baiCount >= 4 ? [{ label: "Baie 4", finisaje: "faianță și gresie", mobilare: "obiecte sanitare premium", dotari: "-" }] : []),
                  { label: "Hol", finisaje: "vopsea lavabilă, parchet", mobilare: "cuier, pantofar", dotari: "interfon" },
                ];

                const mobileLeftOrderClasses = [
                  "order-2 md:order-none",
                  "order-3 md:order-none",
                  "order-4 md:order-none",
                  "order-5 md:order-none",
                  "order-6 md:order-none",
                  "order-7 md:order-none",
                  "order-8 md:order-none",
                  "order-9 md:order-none",
                  "order-10 md:order-none",
                  "order-11 md:order-none",
                  "order-12 md:order-none",
                ];
                const mobileRightOrderClasses = [
                  "order-[14] md:order-none",
                  "order-[15] md:order-none",
                  "order-[16] md:order-none",
                  "order-[17] md:order-none",
                  "order-[18] md:order-none",
                  "order-[19] md:order-none",
                  "order-[20] md:order-none",
                  "order-[21] md:order-none",
                  "order-[22] md:order-none",
                  "order-[23] md:order-none",
                  "order-[24] md:order-none",
                ];

                return (
                  <div className="font-sans divide-y divide-gray-200">
                    {/* 1. Configurație & Finisaje Side by Side */}
                    <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-200">
                      {/* Left: Configurație */}
                      <div className="flex flex-col">
                        <SubCategoryHeader 
                          title="Configurație" 
                          isPublicShared={isPublicShared}
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
                        <div
                          className={
                            isPublicShared
                              ? "p-5 grid grid-cols-1 [&:has(>:nth-child(6))]:md:grid-cols-2 gap-[20px] content-start flex-1"
                              : `p-5 ${editingSection === "configuratie" ? "space-y-[16px]" : "space-y-4"} flex-1`
                          }
                        >
                          {renderRow("configuratie", "Suprafață utilă", suprafataUtila)}
                          {renderRow("configuratie", "Compartimentare", compartimentare, false, false, COMPARTIMENTARE_OPTIONS)}
                          {renderRow("configuratie", "Etaj", etaj)}
                          {renderRow("configuratie", "An construcție", anConstructie)}
                          {renderRow("configuratie", "Număr camere", String(camere))}
                          {renderRow("configuratie", "Număr băi", String(bai))}
                          {renderRow("configuratie", "Balcon", String(balcoane))}
                          {renderRow("configuratie", "Stare", stareInterior, true, false, STARE_OPTIONS)}
                        </div>
                      </div>

                      {/* Right: Finisaje */}
                      <div className="flex flex-col">
                        <SubCategoryHeader 
                          title="Finisaje" 
                          isPublicShared={isPublicShared}
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
                        <div
                          className={
                            isPublicShared
                              ? "p-5 grid grid-cols-1 [&:has(>:nth-child(6))]:md:grid-cols-2 gap-[20px] content-start flex-1"
                              : `p-5 ${editingSection === "finisaje" ? "space-y-[16px]" : "space-y-4"} flex-1`
                          }
                        >
                          {apartmentRooms.map((room, idx) =>
                            renderRow("finisaje", room.label, room.finisaje, idx === apartmentRooms.length - 1, false, undefined, isPublicShared)
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 2. Mobilare & Dotări Side by Side */}
                    {isPublicShared ? (
                      <div className="grid grid-cols-1 md:grid-cols-2">
                        <div className="order-1 md:order-none md:border-r md:border-gray-200">
                          <SubCategoryHeader title="Mobilare" isPublicShared={isPublicShared} />
                        </div>
                        <div className="order-[13] md:order-none mt-5 md:mt-0 border-t border-gray-200 md:border-t-0">
                          <SubCategoryHeader title="Dotări" isPublicShared={isPublicShared} />
                        </div>
                        {apartmentRooms.map((room, idx) => {
                          const isLastRoom = idx === apartmentRooms.length - 1;
                          return (
                            <React.Fragment key={room.label}>
                              <div
                                className={`${mobileLeftOrderClasses[idx] || ""} px-5 ${
                                  idx === 0 ? "pt-5" : "pt-[20px]"
                                } ${isLastRoom ? "md:pb-5" : ""} md:border-r md:border-gray-200`}
                              >
                                {renderRow("mobilare", room.label, room.mobilare, isLastRoom, false, undefined, true)}
                              </div>
                              <div
                                className={`${mobileRightOrderClasses[idx] || ""} px-5 ${
                                  idx === 0 ? "pt-5" : "pt-[20px]"
                                } ${isLastRoom ? "pb-5" : ""}`}
                              >
                                {renderRow("dotari", room.label, room.dotari, isLastRoom, false, undefined, true)}
                              </div>
                            </React.Fragment>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-200">
                        {/* Left: Mobilare */}
                        <div className="flex flex-col">
                          <SubCategoryHeader 
                            title="Mobilare" 
                            isPublicShared={isPublicShared}
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
                          <div className={`p-5 ${editingSection === "mobilare" ? "space-y-[16px]" : "space-y-4"} flex-1`}>
                            {apartmentRooms.map((room, idx) =>
                              renderRow("mobilare", room.label, room.mobilare, idx === apartmentRooms.length - 1, false, undefined, isPublicShared)
                            )}
                          </div>
                        </div>

                        {/* Right: Dotări */}
                        <div className="flex flex-col">
                          <SubCategoryHeader 
                            title="Dotări" 
                            isPublicShared={isPublicShared}
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
                          <div className={`p-5 ${editingSection === "dotari" ? "space-y-[16px]" : "space-y-4"} flex-1`}>
                            {apartmentRooms.map((room, idx) =>
                              renderRow("dotari", room.label, room.dotari, idx === apartmentRooms.length - 1, false, undefined, isPublicShared)
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* #CARD "BLOC" */}
            <div id="bloc" className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs scroll-mt-[104px] font-sans">
              <div className="px-5 py-4 bg-gray-50/80 border-b border-gray-200 flex items-center justify-between select-none">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#051D35]/5 text-[#051D35] flex items-center justify-center font-semibold">
                    <Building2 size={16} />
                  </div>
                  <h2 className="font-title text-[12px] font-semibold text-[#051D35]">
                    Bloc
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

              <div className={`p-5 grid grid-cols-1 md:grid-cols-2 ${isPublicShared ? "gap-[20px]" : (editingSection === "bloc" ? "gap-[16px]" : "gap-4")} font-sans`}>
                {renderRow("bloc", "Acces", "Tag magnetic, interfon")}
                {renderRow("bloc", "Spații", "-")}
                {renderRow("bloc", "Dotări", "Lift, supraveghere video")}
                {renderRow("bloc", "Servicii", "Administrație, curățenie spații comune", true)}
              </div>
            </div>

            {/* #CARD "IMPREJURIMI" */}
            <div id="imprejurimi" className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs scroll-mt-[104px] font-sans">
              <div className="px-5 py-4 bg-gray-50/80 border-b border-gray-200 flex items-center justify-between select-none">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#051D35]/5 text-[#051D35] flex items-center justify-center font-semibold">
                    <Compass size={16} />
                  </div>
                  <h2 className="font-title text-[12px] font-semibold text-[#051D35]">
                    Împrejurimi
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

              <div className={`p-5 grid grid-cols-1 md:grid-cols-2 ${isPublicShared ? "gap-[20px]" : (editingSection === "imprejurimi" ? "gap-[16px]" : "gap-4")} font-sans`}>
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
            <div id="transport" className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs scroll-mt-[104px] font-sans">
              <div className="px-5 py-4 bg-gray-50/80 border-b border-gray-200 flex items-center justify-between select-none">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#051D35]/5 text-[#051D35] flex items-center justify-center font-semibold">
                    <Bus size={16} />
                  </div>
                  <h2 className="font-title text-[12px] font-semibold text-[#051D35]">
                    Transport
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

              <div className={`p-5 grid grid-cols-1 md:grid-cols-2 ${isPublicShared ? "gap-[20px]" : (editingSection === "transport" ? "gap-[16px]" : "gap-4")} font-sans`}>
                {renderRow("transport", "Metrou", "Stație de metrou în proximitate")}
                {renderRow("transport", "Tramvai", "Linii tramvai în zonă")}
                {renderRow("transport", "Troleibuz", "Linii troleibuz în apropiere")}
                {renderRow("transport", "Autobuz", "Multiple linii STB în apropiere", true)}
              </div>
            </div>

            {/* #CARD "PARCARE" */}
            <div id="parcare" className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs scroll-mt-[104px] font-sans">
              <div className="px-5 py-4 bg-gray-50/80 border-b border-gray-200 flex items-center justify-between select-none">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#051D35]/5 text-[#051D35] flex items-center justify-center font-semibold">
                    <Car size={16} />
                  </div>
                  <h2 className="font-title text-[12px] font-semibold text-[#051D35]">
                    Parcare
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

              <div className="p-5 font-sans">
                {renderRow("parcare", "Parcare", "Publica in zona", true, true)}
              </div>
            </div>

            {/* Bottom action bar for regenerating all property images with watermark inpainting (internal CRM only) */}
            {!isPublicShared && (
              <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 shadow-xs font-sans flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-start sm:items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#051D35]/5 text-[#051D35] flex items-center justify-center shrink-0">
                    <Wand2 size={16} className="text-[#BE9662]" />
                  </div>
                  <div>
                    <h3 className="font-title text-[12px] font-semibold text-[#051D35]">
                      Curățare Watermark Fotografii
                    </h3>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      Reprocesează toate cele {imagesList.length} {imagesList.length === 1 ? "fotografie" : "fotografii"} ale proprietății prin inpainting pentru a ascunde watermark-urile.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleRegenerateImages()}
                  disabled={isRegeneratingImages || isEditingPhotos || imagesList.length === 0}
                  className="h-9 px-4 rounded-lg bg-[#051D35] hover:bg-[#0a2b4a] text-white text-xs font-semibold transition-colors cursor-pointer flex items-center justify-center gap-2 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed shadow-2xs"
                >
                  {isRegeneratingImages ? (
                    <>
                      <Loader2 size={14} className="animate-spin text-[#BE9662]" />
                      <span>Se regenerează imaginile...</span>
                    </>
                  ) : (
                    <>
                      <Wand2 size={14} className="text-[#BE9662]" />
                      <span>Regenerează imagini (ascunde watermark)</span>
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Bottom spacing ensuring smooth scrolling and precise alignment for all jump links */}
            <div className={isPublicShared ? "h-[calc(100vh-104px)] pointer-events-none" : "h-[20vh] min-h-[160px] pointer-events-none"} aria-hidden="true" />

          </div>

          {/* Right Column: Sticky Sidebar with Owner Card first, then Property Carousel, Price, Title & Share - STRICTLY EXCLUDED on isPublicShared */}
          {!isPublicShared && (
            <div className="lg:col-span-4 p-4 sm:p-6 space-y-4 lg:sticky lg:top-0">
            
            {/* OWNER CARD (FIRST IN RIGHT COLUMN) - STRICTLY VISIBLE ONLY INTERNALLY IN CRM (!isPublicShared) */}
            {!isPublicShared && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs font-sans">
                <div className="px-6 py-4 bg-gray-50/80 border-b border-gray-200 flex items-center justify-between select-none">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[#051D35]/5 text-[#051D35] flex items-center justify-center font-semibold">
                      <User size={16} />
                    </div>
                    <div>
                      <h2 className="font-title text-[12px] font-semibold text-[#051D35]">
                        Date Proprietar
                      </h2>
                      <span className="text-[10px] text-gray-500 font-normal font-sans">
                        Privat CRM • Confidențial
                      </span>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-gray-600 bg-gray-100 px-2 py-1 rounded border border-gray-200">
                    <Lock size={10} className="text-gray-400" />
                    Ascuns pe share
                  </span>
                </div>

                <div className="p-5 space-y-4 text-[12px] font-sans">
                  <div>
                    <span className="text-[12px] font-semibold text-[#051D35] block mb-1 font-sans">
                      Nume Proprietar
                    </span>
                    <span className="font-normal text-gray-900 text-[12px] font-sans">
                      {lead.ownerName || "Nespecificat"}
                    </span>
                  </div>

                  <div>
                    <span className="text-[12px] font-semibold text-[#051D35] block mb-1 font-sans">
                      Telefon Direct
                    </span>
                    {lead.ownerPhone ? (
                      <div className="flex items-center gap-2">
                        <a 
                          href={`tel:${lead.ownerPhone}`}
                          className="text-[12px] font-normal text-[#051D35] hover:underline flex items-center gap-1 font-sans tabular-nums"
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
                      <span className="text-[12px] text-gray-400 font-normal italic font-sans">Nu este specificat</span>
                    )}
                  </div>

                  {lead.ownerPhone && (
                    <div className="pt-2 border-t border-gray-100 flex gap-2 font-sans">
                      <a
                        href={`tel:${lead.ownerPhone.replace(/[^0-9+]/g, "")}`}
                        className="flex-1 h-8 rounded bg-[#051D35] text-white font-medium text-xs flex items-center justify-center gap-1 hover:bg-[#0a2b4a] transition-colors"
                      >
                        <Phone size={11} className="text-[#BE9662]" />
                        <span>Apelează</span>
                      </a>
                      <a
                        href={`https://wa.me/4${lead.ownerPhone.replace(/[^0-9]/g, "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 h-8 rounded bg-emerald-600 text-white font-medium text-xs flex items-center justify-center gap-1 hover:bg-emerald-700 transition-colors"
                      >
                        <MessageSquare size={11} />
                        <span>WhatsApp</span>
                      </a>
                    </div>
                  )}

                  <p className="text-[10px] text-gray-400 font-normal italic pt-1 font-sans">
                    * Aceste date sunt confidențiale și sunt vizibile exclusiv consultanților agenției, nu apar pe link-ul distribuit clienților.
                  </p>
                </div>
              </div>
            )}

            {/* PROPERTY PHOTOS CARD: Standardized Card Header & Inline Drag-and-Drop / Browse */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs font-sans">
              {/* Standardized Card Header */}
              <div className="px-6 py-4 bg-gray-50/80 border-b border-gray-200 flex items-center justify-between select-none">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#051D35]/5 text-[#051D35] flex items-center justify-center font-semibold">
                    <Camera size={16} />
                  </div>
                  <div>
                    <h2 className="font-title text-[12px] font-semibold text-[#051D35]">
                      Fotografii Imobil
                    </h2>
                    <span className="text-[10px] text-gray-500 font-normal font-sans">
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
                  disabled={isSavingPhotos}
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
                    <p className="font-title text-sm font-semibold tracking-wide">Plasează fotografiile aici</p>
                    <p className="text-xs text-gray-300 mt-1">Trage fișierele pentru a le adăuga în galerie</p>
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
                        src={getThumbnailImageUrl(imagesList[carouselIndex] || imagesList[0], 720)} 
                        alt={`${displayTitle} - foto ${carouselIndex + 1}`}
                        decoding="async"
                        onClick={() => { setSelectedPhotoIndex(carouselIndex); setIsGalleryOpen(true); }}
                        className="w-full h-full object-cover cursor-pointer group-hover:scale-102 transition-transform duration-300" 
                        referrerPolicy="no-referrer"
                      />

                      {/* Counter Badge & Actions */}
                      <div className="absolute top-3 right-3 flex items-center gap-2 z-10">
                        {isEditingPhotos && imagesList.length > 0 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const idxToDelete = carouselIndex;
                              setImagesList(prev => prev.filter((_, i) => i !== idxToDelete));
                              setIsPhotosDirty(true);
                              if (carouselIndex >= imagesList.length - 1) {
                                setCarouselIndex(Math.max(0, imagesList.length - 2));
                              }
                            }}
                            className="h-7 px-3 rounded-md bg-red-600 hover:bg-red-700 text-white text-[11px] font-sans font-medium backdrop-blur-xs flex items-center gap-1 transition-colors cursor-pointer shadow-xs"
                            title="Șterge fotografia curentă"
                          >
                            <X size={11} />
                            <span>Șterge</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => { setSelectedPhotoIndex(carouselIndex); setIsGalleryOpen(true); }}
                          className="h-7 px-2 rounded-md bg-black/65 hover:bg-black/85 text-white text-[11px] font-normal backdrop-blur-xs flex items-center gap-1 transition-colors cursor-pointer tabular-nums"
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
                            className="absolute left-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 hover:bg-black/75 text-white flex items-center justify-center opacity-80 sm:opacity-0 group-hover:opacity-100 transition-all cursor-pointer backdrop-blur-xs shadow-sm z-10"
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
                            className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 hover:bg-black/75 text-white flex items-center justify-center opacity-80 sm:opacity-0 group-hover:opacity-100 transition-all cursor-pointer backdrop-blur-xs shadow-sm z-10"
                            title="Fotografia următoare"
                          >
                            <ChevronRight size={16} />
                          </button>
                        </>
                      )}
                    </>
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-gray-400 gap-2 p-4 text-center">
                      <Camera size={32} className="text-gray-300" />
                      <span className="text-xs font-normal">Nicio fotografie disponibilă</span>
                    </div>
                  )}
                </div>

                {/* Thumbnails Slots & Pagination */}
                <div className="space-y-2 pt-1">
                  {imagesList.length > 4 && (
                    <div className="flex items-center justify-between text-[11px] text-gray-500 font-sans px-1">
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
                        <span className="text-[10px] px-1 tabular-nums">{slotPage + 1}/{Math.ceil(imagesList.length / 4)}</span>
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
                              src={getThumbnailImageUrl(imgUrl, 180)}
                              alt={`Foto ${actualIndex + 1}`}
                              loading="lazy"
                              decoding="async"
                              className="w-full h-full object-cover select-none"
                              referrerPolicy="no-referrer"
                            />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors pointer-events-none" />
                            <span className="absolute bottom-1 left-1 px-1 py-0 rounded bg-black/60 text-white text-[9px] pointer-events-none tabular-nums">
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
                          <span className="text-[10px] text-gray-300 tabular-nums">{slotPage * 4 + offset + 1}</span>
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
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#051D35]/5 text-[#051D35] flex items-center justify-center font-semibold">
                    <Share2 size={16} />
                  </div>
                  <div>
                    <h2 className="font-title text-[12px] font-semibold text-[#051D35]">
                      Link Acces Public
                    </h2>
                    <span className="text-[10px] text-emerald-700 font-normal font-sans">
                      Fără date proprietar
                    </span>
                  </div>
                </div>
              </div>

              <div className="p-5 space-y-2 font-sans">
                <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded p-1 pl-2">
                  <span className="text-[12px] text-gray-600 font-normal truncate flex-1 select-all font-sans">
                    {publicShareUrl}
                  </span>
                  <button
                    type="button"
                    onClick={handleNativeShare}
                    className="h-7 px-3 rounded text-[11px] font-semibold bg-[#051D35] text-white hover:bg-[#0a2b4a] transition-colors shrink-0 cursor-pointer font-sans flex items-center gap-1"
                    title="Deschide aplicația nativă pentru distribuire"
                  >
                    <Share2 size={11} className="text-[#BE9662]" />
                    <span>Distribuie</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="h-7 px-3 rounded text-[11px] font-medium bg-white text-gray-700 hover:bg-gray-100 border border-gray-200 transition-colors shrink-0 cursor-pointer font-sans"
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
      )}

      {/* Back to Top Button: Square button on the right side with arrow up icon */}
      {isPublicShared && showBackToTop && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-6 right-6 z-40 w-10 h-10 rounded-md border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 hover:text-[#051D35] flex items-center justify-center shadow-xs hover:shadow-sm transition-all cursor-pointer select-none group"
          title="Înapoi sus"
          aria-label="Înapoi sus"
        >
          <ArrowUp size={18} className="text-gray-600 group-hover:text-[#051D35] transition-colors" />
        </button>
      )}

      {/* Lightbox Photo Gallery Modal */}
      {isGalleryOpen && galleryImages.length > 0 && (
        <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex flex-col">
          <div className="h-14 px-6 flex items-center justify-between text-white border-b border-white/10 shrink-0">
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold bg-white/10 px-2 py-1 rounded tabular-nums">
                {Math.min(selectedPhotoIndex, galleryImages.length - 1) + 1} / {galleryImages.length}
              </span>
              <span className="text-xs text-gray-300 hidden sm:inline truncate max-w-md">
                {displayTitle}
              </span>
            </div>

            <button
              type="button"
              onClick={() => setIsGalleryOpen(false)}
              className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
              title="Închide galeria (Esc)"
            >
              <X size={22} />
            </button>
          </div>

          <div className="flex-1 min-h-0 relative flex items-center justify-center p-4">
            {isPublicShared ? (
              <div className="w-full h-full max-w-[90vw] max-h-full">
                <ProtectedPublicImage
                  src={getThumbnailImageUrl(galleryImages[selectedPhotoIndex] || galleryImages[0], 1280)}
                  alt={`${displayTitle} - ${selectedPhotoIndex + 1}`}
                  fit="contain"
                  priority="high"
                  theme="dark"
                  onAuthExpired={onRefreshPublicProperty}
                  className="rounded shadow-2xl"
                />
              </div>
            ) : (
              <img 
                src={getThumbnailImageUrl(galleryImages[selectedPhotoIndex] || galleryImages[0], 1600)} 
                alt={`${displayTitle} - ${selectedPhotoIndex + 1}`}
                decoding="async"
                className="max-h-full max-w-[90vw] object-contain rounded shadow-2xl transition-all"
                referrerPolicy="no-referrer"
              />
            )}

            {galleryImages.length > 1 && (
              <button
                type="button"
                onClick={() => setSelectedPhotoIndex(prev => (prev <= 0 ? galleryImages.length - 1 : prev - 1))}
                className="absolute left-4 top-1/2 -translate-y-1/2 z-20 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors backdrop-blur-sm cursor-pointer"
                title="Fotografia anterioară"
              >
                <ChevronLeft size={24} />
              </button>
            )}

            {galleryImages.length > 1 && (
              <button
                type="button"
                onClick={() => setSelectedPhotoIndex(prev => (prev >= galleryImages.length - 1 ? 0 : prev + 1))}
                className="absolute right-4 top-1/2 -translate-y-1/2 z-20 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors backdrop-blur-sm cursor-pointer"
                title="Următoarea fotografie"
              >
                <ChevronRight size={24} />
              </button>
            )}
          </div>

          <div className="h-20 bg-black/60 border-t border-white/10 px-4 flex items-center justify-start sm:justify-center gap-2 overflow-x-auto no-scrollbar shrink-0">
            {galleryImages.map((img, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setSelectedPhotoIndex(idx)}
                className={`relative block w-14 h-12 rounded overflow-hidden border-2 transition-all shrink-0 cursor-pointer ${
                  selectedPhotoIndex === idx 
                    ? "border-[#BE9662] scale-105" 
                    : "border-transparent opacity-50 hover:opacity-100"
                }`}
              >
                {isPublicShared ? (
                  <ProtectedPublicImage
                    src={getThumbnailImageUrl(img, idx === 0 ? 1280 : 640)}
                    alt={`thumb-${idx}`}
                    fit="cover"
                    lazy={true}
                    theme="dark"
                    onAuthExpired={onRefreshPublicProperty}
                  />
                ) : (
                  <img src={getThumbnailImageUrl(img, 140)} alt={`thumb-${idx}`} loading="lazy" decoding="async" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}

    </div>
  );
};
