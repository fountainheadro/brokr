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
  Bookmark
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
}

interface NavSection {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const NAV_SECTIONS: NavSection[] = [
  { id: "introducere", label: "Introducere", icon: FileText },
  { id: "apartament", label: "Apartament", icon: Home },
  { id: "bloc", label: "Bloc", icon: Building2 },
  { id: "imprejurimi", label: "Împrejurimi", icon: Compass },
  { id: "transport", label: "Transport", icon: Bus },
  { id: "parcare", label: "Parcare", icon: Car },
  { id: "acte", label: "Acte & Tranzacție", icon: ShieldCheck },
  { id: "tranzactie", label: "Preț & Comision", icon: BadgePercent }
];

interface AttributeRowProps {
  label: string;
  value: React.ReactNode;
  copyValue?: string;
  isLast?: boolean;
}

const AttributeRow: React.FC<AttributeRowProps> = ({ label, value, copyValue, isLast = false }) => {
  const [copied, setCopied] = useState(false);
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
    <div className={`group/row relative flex items-start sm:items-center justify-between py-2.5 px-3.5 hover:bg-gray-50/80 transition-colors font-sans ${
      isLast ? "" : "border-b border-gray-100"
    }`}>
      <div className="flex flex-col sm:flex-row sm:items-baseline w-full gap-1 sm:gap-4 pr-8">
        <span className="text-[12px] font-medium text-gray-900 w-full sm:w-[24%] sm:min-w-[140px] shrink-0 font-sans select-text">
          {label}:
        </span>
        <span className="text-[12px] text-gray-600 leading-relaxed flex-1 font-sans select-text break-words">
          {value}
        </span>
      </div>

      {textToCopy && (
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
  );
};

const SubCategoryHeader: React.FC<{ title: string; count?: string }> = ({ title, count }) => (
  <div className="h-8 flex items-center justify-between px-3.5 bg-gray-50/70 border-y border-gray-100 select-none">
    <div className="flex items-center gap-2">
      <span className="w-1.5 h-1.5 rounded-full bg-[#BE9662]" />
      <span className="text-[11px] font-bold uppercase tracking-wider text-[#051D35] font-sans">
        {title}
      </span>
    </div>
    {count && (
      <span className="text-[10px] font-mono text-gray-400 font-medium">
        {count}
      </span>
    )}
  </div>
);

export const PropertyDetailView: React.FC<PropertyDetailViewProps> = ({
  lead,
  isPublicShared = false,
  contacts = [],
  onOpenEditForm,
  showTopNavbar = false
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

    if (navigator.share) {
      try {
        await navigator.share(shareData);
        toast.success("Partajat cu succes!");
        return;
      } catch (err: any) {
        if (err.name === "AbortError") {
          return;
        }
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

  // Characteristics derived
  const suprafataUtila = crmData?.caracteristici?.suprafete?.utila || "45";
  const compartimentare = crmData?.caracteristici?.detalii?.compartimentare || "decomandat";
  const etaj = crmData?.caracteristici?.detalii?.etaj || "2";
  const anConstructie = crmData?.caracteristici?.alteDetalii?.anConstructie || "după 2000";
  const camere = crmData?.caracteristici?.detalii?.camere || "2";
  const bai = crmData?.caracteristici?.detalii?.bai || "1";
  const balcoane = crmData?.caracteristici?.suprafete?.balcoane || crmData?.caracteristici?.detalii?.balcoane || "1 balcon închis (6 mp)";

  // Guarantee and advance
  const garantie = crmData?.pret?.detalii?.garantie || (isRent ? `${crmData?.pret?.detalii?.pret || "775"} €` : "-");
  const avans = crmData?.pret?.detalii?.avans || (isRent ? "1 lună" : "15%");

  // Natural summary generated from crawler data:
  // Strictly includes only: number of rooms, surface (mp), construction year, partitioning (decomandat/semidecomandat/etc.),
  // presented naturally and attractively without sales pitch clichés or prohibited terms.
  const summaryDescription = useMemo(() => {
    const raw = crmData?.descriere?.continut || (lead as any)?.description || lead?.notes || "";
    
    // Technical parameters strictly limited to the user's specification:
    // - număr camere
    // - suprafață (mp)
    // - anul construcției
    // - compartimentare
    const techCamere = camere ? `${camere} camere` : "camere bine proporționate";
    const techSuprafata = suprafataUtila ? `${suprafataUtila} mp utili` : "";
    const techCompartimentare = compartimentare || "decomandat";
    const techAn = (anConstructie && anConstructie !== "după 2000" && anConstructie !== "-") 
      ? `construit în anul ${anConstructie}` 
      : (anConstructie === "după 2000" ? "construcție recentă" : "");
    const zonaLoc = addressDetails.zona ? `în zona ${addressDetails.zona}` : "într-o zonă accesibilă";

    // Clean crawler narrative paragraphs if available
    let crawlerIntro = "";
    if (raw) {
      const lines = raw.split("\n");
      const introLines: string[] = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (
          line.includes("━━━━") ||
          line.includes("----") ||
          line.startsWith("⭐") ||
          line.startsWith("🛋️") ||
          line.startsWith("📍") ||
          line.startsWith("💰") ||
          line.startsWith("🤝") ||
          line.startsWith("🛠️") ||
          line.startsWith("💼") ||
          line.toUpperCase().startsWith("AVANTAJE") ||
          line.toUpperCase().startsWith("PUNCTE CHEIE") ||
          line.toUpperCase().startsWith("DOTĂRI") ||
          line.toUpperCase().startsWith("LOCAȚIE") ||
          line.toUpperCase().startsWith("CONDIȚII")
        ) {
          break;
        }

        if (
          line.startsWith("📌") ||
          line.startsWith("🏡") ||
          line.startsWith("🏢") ||
          line.toLowerCase().startsWith("titlu:") ||
          line.toLowerCase().startsWith("id:") ||
          line.toLowerCase().startsWith("cod intern:")
        ) {
          continue;
        }

        const lower = line.toLowerCase();
        if (
          lower.includes("comision 0") ||
          lower.includes("0% comision") ||
          lower.includes("0 euro comision") ||
          lower.includes("proprietar") ||
          lower.includes("strada ") ||
          lower.includes("str. ") ||
          lower.includes("nr. ") ||
          lower.includes("numar") ||
          lower.includes("bloc ") ||
          lower.includes("scara ") ||
          lower.includes("chilipir") ||
          lower.includes("ofertă unică") ||
          lower.includes("super ofertă") ||
          lower.includes("nu ratați") ||
          lower.includes("apartament de vis")
        ) {
          continue;
        }

        introLines.push(line);
      }
      crawlerIntro = introLines.join(" ").trim();
    }

    // Clean remaining regex noise
    crawlerIntro = crawlerIntro
      .replace(/(\b(?:strada|str\.|calea|bulevardul|bd\.)\s+[a-zăîșțâ\s]+)\s+(?:nr\.|numărul|numar)\s*\d+[a-z]?/gi, "")
      .replace(/(?:comision\s*0%|0%\s*comision|comision\s*zero|fără\s*comision)/gi, "")
      .replace(/(?:închiriere|vânzare)\s+direct\s+de\s+la\s+proprietar/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();

    // If crawler has a solid descriptive sentence, merge it naturally with the strict technical specs
    if (crawlerIntro && crawlerIntro.length > 30) {
      return `${crawlerIntro}\n\nProprietatea dispune de o suprafață utilă de ${techSuprafata || "suprafață optimă"}, configurare ${techCompartimentare} cu ${techCamere}${techAn ? `, într-un imobil ${techAn}` : ""}, oferind un cadru locativ aerisit și funcțional ${zonaLoc}.`;
    }

    // Default natural, appealing presentation without sales hype
    return `Proprietatea propusă este un apartament cu ${techCamere}, cu o suprafață utilă de ${techSuprafata || "spațioasă"}, compartimentat ${techCompartimentare}${techAn ? `, situat într-o clădire ${techAn}` : ""} ${zonaLoc}.\n\nSpațiul este organizat echilibrat, oferă o luminozitate naturală plăcută pe tot parcursul zilei și o atmosferă primitoare, fiind adaptat unui stil de viață confortabil cu acces facil către mijloacele de transport și facilitățile urbane.`;
  }, [crmData?.descriere?.continut, (lead as any)?.description, lead?.notes, camere, suprafataUtila, compartimentare, anConstructie, addressDetails.zona]);

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

  return (
    <div ref={containerRef} className="w-full bg-[#F8F9FA] text-gray-900 flex flex-col font-sans selection:bg-[#BE9662]/20">
      
      {/* Top Navbar (only for standalone public share page) - Matches exact in-app top header dimensions */}
      {showTopNavbar && (
        <nav className="sticky top-0 z-40 bg-white border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 h-[50px] flex items-center justify-between gap-4">
            <div className="flex items-center gap-1.5 focus:outline-none">
              <span className="font-extrabold text-base tracking-tight text-[#051D35] font-sans flex items-center">
                brokr<span className="text-[#BE9662]">.</span>
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleToggleFavorite}
                className={`h-8 px-3 rounded-md text-xs font-medium border transition-colors flex items-center gap-1.5 cursor-pointer ${
                  isFavorite 
                    ? "bg-amber-50 border-[#BE9662]/40 text-[#BE9662]" 
                    : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
                }`}
                title={isFavorite ? "Elimină din favoritele browserului" : "Salvează ca favorit în browser (Ctrl+D / Cmd+D)"}
              >
                <Bookmark size={14} className={isFavorite ? "fill-[#BE9662] text-[#BE9662]" : "text-gray-400"} />
                <span className="hidden sm:inline">{isFavorite ? "Salvat" : "Salvează favorit"}</span>
              </button>

              <button
                type="button"
                onClick={handlePrint}
                className="h-8 px-3 rounded-md text-xs font-medium bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-1.5 cursor-pointer"
                title="Tipărește oferta"
              >
                <Printer size={14} className="text-gray-400" />
                <span className="hidden sm:inline">Printează</span>
              </button>

              <button
                type="button"
                onClick={handleNativeShare}
                className="h-8 px-3.5 rounded-md text-xs font-semibold bg-[#051D35] text-white hover:bg-[#0a2b4a] transition-all flex items-center gap-1.5 shadow-xs cursor-pointer"
                title="Distribuie proprietatea prin aplicația nativă a dispozitivului"
              >
                <Share2 size={14} className="text-[#BE9662]" />
                <span>Distribuie</span>
              </button>
            </div>
          </div>
        </nav>
      )}

      {/* Hero Header Section */}
      <section className="bg-white border-b border-gray-200 pt-5 pb-5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          
          {/* Breadcrumb / Category (Clean typography without tag boxes) */}
          <div className="flex items-center gap-2 text-xs text-gray-500 mb-2 font-medium flex-wrap font-sans">
            <span className="text-[#051D35] font-semibold">Imobile</span>
            <span className="text-gray-300">/</span>
            <span className="text-gray-700 font-medium">
              {lead.transactionType || "Închiriere"}
            </span>
            <span className="text-gray-300">/</span>
            <span className="text-gray-600 font-medium">{categoria}</span>
            <span className="text-gray-300">/</span>
            <span className="font-mono text-gray-500 text-[11px]">
              Cod #{internalCode}
            </span>
          </div>

          {/* Title & Price Row */}
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div className="space-y-1.5 flex-1 min-w-0 pr-4">
              <h1 className="text-2xl sm:text-3xl font-bold font-[700] text-[#051D35] tracking-tight leading-snug font-sans break-words">
                {displayTitle}
              </h1>
              
              <div className="flex items-center gap-2 text-xs sm:text-sm text-gray-600 font-sans">
                <MapPin size={15} className="text-[#BE9662] shrink-0" />
                <span className="font-medium text-gray-700">
                  {addressDetails.fullSummary}
                </span>
              </div>
            </div>

            {/* Price block & Action buttons for in-app mode */}
            <div className="shrink-0 flex flex-col md:items-end justify-between md:justify-center border-t md:border-t-0 pt-3 md:pt-0 border-gray-100 gap-2">
              <div className="flex md:flex-col items-baseline md:items-end justify-between w-full">
                <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 md:mb-0.5 font-sans">
                  {isRent ? "Chirie lunară" : "Preț vânzare"}
                </span>
                <div className="text-2xl sm:text-3xl font-black text-[#051D35] font-mono tracking-tight">
                  {formattedPrice}
                </div>
              </div>

              {!showTopNavbar && (
                <div className="flex items-center gap-2 mt-1">
                  <button
                    type="button"
                    onClick={handleToggleFavorite}
                    className={`h-8 px-3 rounded-md text-xs font-medium border transition-colors flex items-center gap-1.5 cursor-pointer font-sans ${
                      isFavorite 
                        ? "bg-amber-50 border-[#BE9662]/40 text-[#BE9662]" 
                        : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
                    }`}
                    title={isFavorite ? "Elimină din favoritele browserului" : "Salvează ca favorit în browser (Ctrl+D / Cmd+D)"}
                  >
                    <Bookmark size={13} className={isFavorite ? "fill-[#BE9662] text-[#BE9662]" : "text-gray-400"} />
                    <span>{isFavorite ? "Salvat" : "Salvează favorit"}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handlePrint}
                    className="h-8 px-3 rounded-md text-xs font-medium bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-1.5 cursor-pointer font-sans"
                    title="Tipărește oferta"
                  >
                    <Printer size={13} className="text-gray-400" />
                    <span className="hidden sm:inline">Printează</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleNativeShare}
                    className="h-8 px-3.5 rounded-md text-xs font-semibold bg-[#051D35] text-white hover:bg-[#0a2b4a] transition-all flex items-center gap-1.5 shadow-xs cursor-pointer font-sans"
                    title="Distribuie proprietatea prin aplicația nativă a dispozitivului"
                  >
                    <Share2 size={13} className="text-[#BE9662]" />
                    <span>Distribuie</span>
                  </button>
                </div>
              )}
            </div>
          </div>

        </div>
      </section>

      {/* Photo Gallery Grid Mosaic */}
      <section className="bg-white border-b border-gray-200 py-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          {allImages.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-4 md:grid-rows-2 gap-2.5 h-[320px] sm:h-[400px] md:h-[450px] rounded-xl overflow-hidden">
              
              {/* Primary Large Image */}
              <div 
                onClick={() => { setSelectedPhotoIndex(0); setIsGalleryOpen(true); }}
                className="md:col-span-2 md:row-span-2 relative group cursor-pointer overflow-hidden bg-gray-100"
              >
                <img 
                  src={allImages[0]} 
                  alt={displayTitle} 
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out" 
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
                  <span className="text-white text-xs font-semibold flex items-center gap-1.5 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-md">
                    <Maximize2 size={13} />
                    Mărește imaginea principală
                  </span>
                </div>
              </div>

              {/* Smaller secondary images */}
              {[1, 2, 3, 4].map((idx) => {
                const img = allImages[idx];
                const isLastSlot = idx === 4 || idx === allImages.length - 1;
                const remainingCount = Math.max(0, allImages.length - 5);

                if (!img && idx > 0) {
                  return (
                    <div 
                      key={idx} 
                      className="hidden md:flex items-center justify-center bg-gray-50 border border-dashed border-gray-200 text-gray-300 text-xs"
                    >
                      <Building2 size={24} className="opacity-40" />
                    </div>
                  );
                }

                return (
                  <div 
                    key={idx}
                    onClick={() => { setSelectedPhotoIndex(idx); setIsGalleryOpen(true); }}
                    className="hidden md:block relative group cursor-pointer overflow-hidden bg-gray-100"
                  >
                    <img 
                      src={img} 
                      alt={`${displayTitle} - foto ${idx + 1}`} 
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out" 
                      referrerPolicy="no-referrer"
                    />
                    
                    {isLastSlot && remainingCount > 0 ? (
                      <div className="absolute inset-0 bg-black/65 backdrop-blur-xs flex flex-col items-center justify-center text-white text-center p-2 group-hover:bg-black/75 transition-colors">
                        <Camera size={22} className="mb-1 text-[#BE9662]" />
                        <span className="text-xs font-bold uppercase tracking-wider">
                          Vezi toate
                        </span>
                        <span className="text-base font-extrabold font-mono">
                          +{remainingCount + 1} fotografii
                        </span>
                      </div>
                    ) : (
                      <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <span className="bg-black/60 text-white p-2 rounded-full backdrop-blur-xs">
                          <Maximize2 size={14} />
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}

            </div>
          ) : (
            <div className="h-64 rounded-xl border border-dashed border-gray-300 bg-gray-50 flex flex-col items-center justify-center text-gray-400 gap-2">
              <Camera size={36} className="text-gray-300" />
              <p className="text-xs font-medium">Nu există fotografii încărcate pentru această proprietate</p>
            </div>
          )}

          {/* Quick button to view all photos on mobile */}
          {allImages.length > 0 && (
            <div className="mt-3 flex justify-between items-center md:hidden">
              <span className="text-xs text-gray-500 font-medium">
                {allImages.length} fotografii disponibile
              </span>
              <button
                type="button"
                onClick={() => { setSelectedPhotoIndex(0); setIsGalleryOpen(true); }}
                className="h-8 px-3 rounded-md bg-[#051D35] text-white text-xs font-medium flex items-center gap-1.5"
              >
                <Camera size={13} className="text-[#BE9662]" />
                <span>Vezi galeria completă</span>
              </button>
            </div>
          )}

        </div>
      </section>

      {/* Horizontal Sticky Menu with Jump Links */}
      <div className="sticky top-[50px] z-30 bg-white/95 backdrop-blur-md border-b border-gray-200 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto no-scrollbar py-2.5">
            {NAV_SECTIONS.map((sect) => {
              const Icon = sect.icon;
              const isActive = activeSection === sect.id;

              return (
                <button
                  key={sect.id}
                  type="button"
                  onClick={() => scrollToSection(sect.id)}
                  className={`shrink-0 h-8 px-3.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer ${
                    isActive
                      ? "bg-[#051D35] text-white shadow-xs"
                      : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                  }`}
                >
                  <Icon size={13} className={isActive ? "text-[#BE9662]" : "text-gray-400"} />
                  <span>{sect.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main Two-Column Layout */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 flex-1 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
                    {/* Left Column: All Content Cards (8 cols on lg) */}
          <div className="lg:col-span-8 space-y-6">

            {/* #CARD "INTRODUCERE" */}
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
              </div>

              <div className="p-6 font-sans">
                <div className="text-xs sm:text-sm text-gray-700 leading-relaxed space-y-3 font-normal whitespace-pre-line select-text font-sans">
                  {summaryDescription}
                </div>
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
                <AttributeRow
                  label="Configurație"
                  value={`Suprafață utilă ${suprafataUtila} mp, compartimentare ${compartimentare}, etaj ${etaj}, an construcție ${anConstructie}, ${camere} camere, ${bai} ${Number(bai) > 1 ? "băi" : "baie"}, balcon ${balcoane}`}
                />

                {/* -Subcategorie "Finisaje" */}
                <div>
                  <SubCategoryHeader title="Finisaje" />
                  <div className="divide-y divide-gray-100">
                    <AttributeRow label="Living" value="vopsea lavabilă, parchet" />
                    <AttributeRow label="Camera 1" value="vopsea lavabilă, parchet" />
                    <AttributeRow label="Camera 2" value="vopsea lavabilă, parchet" />
                    <AttributeRow label="Bucătărie" value="vopsea lavabilă, faianță și gresie" />
                    <AttributeRow label="Baie 1" value="faianță și gresie" />
                    <AttributeRow label="Baie 2" value="faianță și gresie" />
                    <AttributeRow label="Hol" value="vopsea lavabilă, parchet" />
                  </div>
                </div>

                {/* -Subcategorie "Mobilare" */}
                <div>
                  <SubCategoryHeader title="Mobilare" />
                  <div className="divide-y divide-gray-100">
                    <AttributeRow label="Living" value="canapea, măsuță cafea, comodă" />
                    <AttributeRow label="Camera 1" value="pat, noptiere" />
                    <AttributeRow label="Camera 2" value="pat, dulap" />
                    <AttributeRow label="Bucătărie" value="mobilată" />
                    <AttributeRow label="Baie 1" value="obiecte sanitare premium" />
                    <AttributeRow label="Baie 2" value="obiecte sanitare" />
                    <AttributeRow label="Hol" value="cuier, pantofar" />
                  </div>
                </div>

                {/* -Subcategorie "Dotari" */}
                <div>
                  <SubCategoryHeader title="Dotări" />
                  <div className="divide-y divide-gray-100">
                    <AttributeRow label="Living" value="aer condiționat, smart TV" />
                    <AttributeRow label="Camera 1" value="aer condiționat, draperii" />
                    <AttributeRow label="Camera 2" value="aer condiționat, corp iluminat LED" />
                    <AttributeRow label="Bucătărie" value="frigider încorporat, mașină de spălat vase, plită, cuptor, hotă" />
                    <AttributeRow label="Baie 1" value="cadă / duș, accesorii" />
                    <AttributeRow label="Baie 2" value="cabină duș, vas WC" />
                    <AttributeRow label="Hol" value="interfon, tablou siguranțe" />
                  </div>
                </div>

                {/* -Subcategorie "Altele" */}
                <AttributeRow
                  label="Altele"
                  value="mașină de spălat rufe cu uscător, centrală proprie, încălzire în pardoseală, vedere către curtea interioară"
                  isLast
                />
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
              </div>

              <div className="font-sans divide-y divide-gray-100">
                <AttributeRow label="Acces" value="Tag magnetic, pază 24/7, interfon" />
                <AttributeRow label="Spații" value="Curte interioară, spații verzi, loc de joacă" />
                <AttributeRow label="Dotări" value="Lift silențios, supraveghere video, generator curent" />
                <AttributeRow label="Servicii" value="Administrație dedicată, mentenanță tehnică, curățenie spații comune" isLast />
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
              </div>

              <div className="font-sans divide-y divide-gray-100">
                <AttributeRow label="Educație" value="Grădinițe de stat și private, școli gimnaziale, licee în proximitate" />
                <AttributeRow label="Comerț" value="Promenada Mall, Băneasa Shopping City, Mega Image, Carrefour, Lidl" />
                <AttributeRow label="Benzinării" value="Rompetrol, OMV, Petrom, Lukoil" />
                <AttributeRow label="Sănătate" value="Regina Maria, Medicover, clinici private, farmacii nonstop" />
                <AttributeRow label="Relaxare" value="Parcul Herăstrău (Regele Mihai I), alei de promenadă, spații verzi" />
                <AttributeRow label="Divertisment" value="Săli World Class, cinematograf multiplex, restaurante și cafenele" />
                <AttributeRow label="Obiective" value="Zona de birouri Aviației, Pipera Business District, Promenada" isLast />
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
              </div>

              <div className="font-sans divide-y divide-gray-100">
                <AttributeRow label="Tramvaie" value="Liniile 16, 36" />
                <AttributeRow label="Troleibuze" value="Liniile 76, 86" />
                <AttributeRow label="Autobuze" value="Liniile 112, 135, 301, 343" />
                <AttributeRow label="Metrou" value="Aurel Vlaicu, Pipera (8-10 minute mers pe jos)" isLast />
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
              </div>

              <div className="font-sans">
                <AttributeRow
                  label="Parcare"
                  value="Publică în zonă, loc de parcare dedicat subteran/suprateran disponibil la cerere / inclus în funcție de contract"
                  isLast
                />
              </div>
            </div>

            {/* #CARD "ACTE & TRANZACTIE" (Juridic, Disponibilitate, Finanțare) */}
            <div id="acte" className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs scroll-mt-28 sm:scroll-mt-32 font-sans">
              <div className="px-6 py-4 bg-gray-50/80 border-b border-gray-200 flex items-center justify-between select-none">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#051D35]/5 text-[#051D35] flex items-center justify-center font-bold">
                    <ShieldCheck size={16} />
                  </div>
                  <h2 className="text-xs font-bold text-gray-900 uppercase tracking-wider font-sans">
                    ACTE & TRANZACȚIE
                  </h2>
                </div>
              </div>

              <div className="font-sans divide-y divide-gray-100">
                <AttributeRow label="Situație juridică" value="Intabulat, extras CF liber de sarcini, certificat energetic clasa A" />
                <AttributeRow label="Disponibilitate" value="Imediată" />
                <AttributeRow label="Finanțare" value="Credit bancar / fonduri proprii, înregistrare ANAF" />
                <AttributeRow label="Disponibilitate" value="Contract pe minimum 12 luni, fără animale de companie (sau conform acordului părților)" isLast />
              </div>
            </div>

            {/* #CARD "ACTE & TRANZACTIE" (Preț, TVA, Comision) */}
            <div id="tranzactie" className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs scroll-mt-28 sm:scroll-mt-32 font-sans">
              <div className="px-6 py-4 bg-gray-50/80 border-b border-gray-200 flex items-center justify-between select-none">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#051D35]/5 text-[#051D35] flex items-center justify-center font-bold">
                    <BadgePercent size={16} />
                  </div>
                  <div>
                    <h2 className="text-xs font-bold text-gray-900 uppercase tracking-wider font-sans">
                      PREȚ & COMISION
                    </h2>
                    <span className="text-[11px] text-gray-500 font-sans">
                      Preț, TVA și Comision agenție
                    </span>
                  </div>
                </div>
              </div>

              <div className="font-sans divide-y divide-gray-100">
                <AttributeRow
                  label="Preț"
                  value={<span className="font-bold text-[#051D35] font-mono text-[13px]">{formattedPrice}</span>}
                  copyValue={formattedPrice}
                />
                <AttributeRow label="TVA" value="Scutit de TVA / conform legislației în vigoare" />
                <AttributeRow
                  label="Comision"
                  value={isRent ? "50% + TVA din contravaloarea primei chirii lunare" : "Comision standard agenție"}
                  isLast
                />
              </div>
            </div>

            {/* Generous bottom spacing ensuring the last cards can scroll to the top under the jump links bar */}
            <div className="h-[60vh] min-h-[480px] pointer-events-none" aria-hidden="true" />

          </div>

          {/* Right Column: Sticky Sidebar with clear margin below sticky horizontal menu */}
          <div className="lg:col-span-4 lg:sticky lg:top-[128px] space-y-5">
            
            {/* AGENT CARD - Displays the real author who initiated importing the data */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs font-sans">
              <div className="p-5 border-b border-gray-100">
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-[#051D35] to-[#BE9662] text-white flex items-center justify-center font-bold text-base shadow-sm ring-2 ring-white shrink-0">
                    {leadAuthor.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#BE9662] font-sans">
                      Consilier Imobiliar
                    </span>
                    <h3 className="text-sm font-bold text-gray-900 truncate font-sans">
                      {leadAuthor.name}
                    </h3>
                    <p className="text-[11px] text-gray-500 font-sans">
                      {leadAuthor.role}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 mt-4 font-sans">
                  <a
                    href={`tel:${leadAuthor.phone.replace(/[^0-9+]/g, "")}`}
                    className="h-8 px-2.5 rounded-lg bg-[#051D35] hover:bg-[#0a2b4a] text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Phone size={13} className="text-[#BE9662]" />
                    <span>Sună Agentul</span>
                  </a>

                  <a
                    href={`https://wa.me/4${leadAuthor.phone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(`Bună ziua, sunt interesat de proprietatea #${internalCode} - ${displayTitle}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="h-8 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <MessageSquare size={13} />
                    <span>WhatsApp</span>
                  </a>
                </div>
              </div>
            </div>

            {/* SOLICITĂ O VIZIONARE CARD - Standardized Card Header */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs font-sans">
              <div className="px-6 py-4 bg-gray-50/80 border-b border-gray-200 flex items-center justify-between select-none">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#051D35]/5 text-[#051D35] flex items-center justify-center font-bold">
                    <Calendar size={16} />
                  </div>
                  <h2 className="text-xs font-bold text-gray-900 uppercase tracking-wider font-sans">
                    SOLICITĂ O VIZIONARE
                  </h2>
                </div>
              </div>

              <div className="p-5 font-sans">
                {formSent ? (
                  <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-center space-y-2">
                    <CheckCircle2 size={24} className="text-emerald-600 mx-auto" />
                    <p className="text-xs font-bold text-emerald-900">
                      Mesajul a fost transmis cu succes!
                    </p>
                    <p className="text-[11px] text-emerald-700">
                      Agentul imobiliar te va contacta în cel mai scurt timp posibil.
                    </p>
                  </div>
                ) : (
                  <form onSubmit={handleInquirySubmit} className="space-y-3 font-sans">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1 font-sans">
                        Numele dumneavoastră *
                      </label>
                      <input 
                        type="text" 
                        required
                        value={formName}
                        onChange={(e) => setFormName(e.target.value)}
                        placeholder="ex. Radu Popescu"
                        className="w-full h-8 px-3 text-xs bg-gray-50 border border-gray-200 rounded-md focus:outline-none focus:bg-white focus:border-[#051D35] transition-colors font-sans"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1 font-sans">
                        Număr telefon *
                      </label>
                      <input 
                        type="tel" 
                        required
                        value={formPhone}
                        onChange={(e) => setFormPhone(e.target.value)}
                        placeholder="ex. 07xx xxx xxx"
                        className="w-full h-8 px-3 text-xs bg-gray-50 border border-gray-200 rounded-md focus:outline-none focus:bg-white focus:border-[#051D35] transition-colors font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1 font-sans">
                        Email (opțional)
                      </label>
                      <input 
                        type="email" 
                        value={formEmail}
                        onChange={(e) => setFormEmail(e.target.value)}
                        placeholder="nume@exemplu.ro"
                        className="w-full h-8 px-3 text-xs bg-gray-50 border border-gray-200 rounded-md focus:outline-none focus:bg-white focus:border-[#051D35] transition-colors font-sans"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1 font-sans">
                        Mesaj pentru agent
                      </label>
                      <textarea 
                        rows={3}
                        value={formMessage}
                        onChange={(e) => setFormMessage(e.target.value)}
                        className="w-full p-2.5 text-xs bg-gray-50 border border-gray-200 rounded-md focus:outline-none focus:bg-white focus:border-[#051D35] transition-colors resize-none leading-relaxed font-sans"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={formSubmitting}
                      className="w-full h-9 rounded-md bg-[#051D35] hover:bg-[#0a2b4a] text-white text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-70 font-sans"
                    >
                      <Send size={13} className="text-[#BE9662]" />
                      <span>{formSubmitting ? "Se trimite..." : "Trimite Mesaj"}</span>
                    </button>
                  </form>
                )}
              </div>
            </div>

            {/* OWNER CARD - STRICTLY VISIBLE ONLY INTERNALLY IN CRM (!isPublicShared) */}
            {!isPublicShared && (
              <div className="bg-white rounded-xl border border-amber-200 overflow-hidden shadow-xs font-sans">
                <div className="px-6 py-4 bg-amber-50/80 border-b border-amber-200 flex items-center justify-between select-none">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-900 flex items-center justify-center font-bold">
                      <User size={16} />
                    </div>
                    <div>
                      <h2 className="text-xs font-bold text-amber-950 uppercase tracking-wider font-sans">
                        DATE PROPRIETAR
                      </h2>
                      <span className="text-[10px] text-amber-700 font-medium font-sans">
                        Privat CRM • Confidențial
                      </span>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-800 bg-amber-100/70 px-2 py-0.5 rounded border border-amber-300">
                    <Lock size={10} />
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
                    onClick={handleCopyLink}
                    className="h-6 px-2.5 rounded text-[11px] font-semibold bg-[#051D35] text-white hover:bg-[#0a2b4a] transition-colors shrink-0 cursor-pointer font-sans"
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
              src={allImages[selectedPhotoIndex]} 
              alt={`${displayTitle} - ${selectedPhotoIndex + 1}`}
              className="max-h-[82vh] max-w-[90vw] object-contain rounded shadow-2xl transition-all"
              referrerPolicy="no-referrer"
            />

            {allImages.length > 1 && (
              <button
                type="button"
                onClick={() => setSelectedPhotoIndex(prev => (prev === 0 ? allImages.length - 1 : prev - 1))}
                className="absolute left-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors backdrop-blur-sm"
                title="Fotografia anterioară"
              >
                <ChevronLeft size={24} />
              </button>
            )}

            {allImages.length > 1 && (
              <button
                type="button"
                onClick={() => setSelectedPhotoIndex(prev => (prev === allImages.length - 1 ? 0 : prev + 1))}
                className="absolute right-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors backdrop-blur-sm"
                title="Următoarea fotografie"
              >
                <ChevronRight size={24} />
              </button>
            )}
          </div>

          <div className="h-20 bg-black/60 border-t border-white/10 px-4 flex items-center justify-center gap-2 overflow-x-auto no-scrollbar shrink-0">
            {allImages.map((img, idx) => (
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
