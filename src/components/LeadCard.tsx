import React from "react";
import { MapPin, Users, ChevronRight, Share2, ExternalLink, Building2, User, Phone } from "lucide-react";
import { Lead, getLeadRole } from "../services/leadsService";
import { Contact } from "../services/contactsService";
import { motion } from "motion/react";
import toast from "react-hot-toast";
import { getPublicShareUrl } from "../utils/shareUtils";
import { useTenantContext } from "../core/tenancy/ctx_tenant";
import { getThumbnailImageUrl } from "../utils/imageUtils";
import { resolveLeadDisplayArea } from "../utils/zoneResolutionUtils";

const WhatsAppBusinessIcon: React.FC<{ size?: number; className?: string }> = ({
  size = 13,
  className = "",
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    <path d="M9.75 8.5h2.6a1.75 1.75 0 0 1 0 3.5h-2.6V8.5z" />
    <path d="M9.75 12h3a1.75 1.75 0 0 1 0 3.5h-3V12z" />
  </svg>
);

const PLACEHOLDER_CARD_PHONES = new Set([
  "0722123456",
  "0712345678",
  "0700000000",
  "0722000000",
  "0700123456",
  "0722111222",
  "0733444555",
  "0700000001",
]);

function extractCleanPhoneCandidate(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  if (lower === "nespecificat" || lower === "n/a" || lower === "-") return "";
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 9) return "";
  const normalizedRo = digits.startsWith("40") && digits.length === 11 ? `0${digits.slice(2)}` : digits;
  if (PLACEHOLDER_CARD_PHONES.has(normalizedRo) || /^070{8}$/.test(normalizedRo)) return "";
  return trimmed;
}

function resolveCardPhone(lead: Lead, contacts: Contact[]): string {
  // 1. Extracted phone directly from the original ad link / lead record
  const directCandidates: unknown[] = [
    lead.ownerPhone,
    lead.extractedData?.crmData?.detaliiGenerale?.contacteAditionale,
    (lead.extractedData as any)?.ownerPhone,
  ];
  for (const cand of directCandidates) {
    const valid = extractCleanPhoneCandidate(cand);
    if (valid) return valid;
  }

  // 2. Fallback strict-boundary extraction from original seller description / notes
  const textPool = [
    lead.extractedData?.originalDescription,
    lead.extractedData?.crmData?.descriere?.continut,
    lead.notes,
  ]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join("\n");
  const phoneMatch = textPool.match(/(?<![0-9A-Za-z])(?:\+?40|0)[\s.-]*7\d{2}[\s.-]?\d{3}[\s.-]?\d{3}(?![0-9A-Za-z])/);
  if (phoneMatch) {
    const valid = extractCleanPhoneCandidate(phoneMatch[0]);
    if (valid) return valid;
  }

  // 3. Fallback to linked contact phone (for Cumpărător / Chiriaș / Owner contacts)
  for (const c of contacts) {
    const valid = extractCleanPhoneCandidate(c.phone);
    if (valid) return valid;
  }

  return "";
}

function buildTelHref(phone: string): string {
  const cleaned = phone.replace(/[^0-9+]/g, "");
  return cleaned ? `tel:${cleaned}` : "";
}

function buildWhatsAppBusinessHref(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (digits.startsWith("0") && digits.length === 10) {
    digits = `40${digits.slice(1)}`;
  } else if (digits.length === 9 && digits.startsWith("7")) {
    digits = `40${digits}`;
  }
  return `https://wa.me/${digits}`;
}

interface LeadCardProps {
  lead: Lead;
  contacts?: Contact[];
  onClick: () => void;
  onContactClick?: (contact: Contact) => void;
  onQuickViewClick?: () => void;
  quickViewLabel?: string;
  compactTypography?: boolean;
}

export const LeadCard: React.FC<LeadCardProps> = ({ 
  lead, 
  contacts = [], 
  onClick, 
  onContactClick,
  onQuickViewClick,
  quickViewLabel = "Detalii",
  compactTypography = false
}) => {
  const { tenant, platformRootDomain } = useTenantContext();
  const role = getLeadRole(lead);
  const images = lead.extractedData?.crmData?.imagini;
  const categoria = String(lead.extractedData?.crmData?.detaliiGenerale?.categoria || '').toLowerCase();
  const isResidential = !categoria.includes('comercial') && 
                         !categoria.includes('spatiu') && 
                         !categoria.includes('depozit') && 
                         !categoria.includes('hala') && 
                         !categoria.includes('industrial') && 
                         !categoria.includes('birou');

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

  const firstImage = typeof rawFirstImage === 'object' && rawFirstImage !== null
    ? rawFirstImage.original
    : (typeof rawFirstImage === 'string' ? rawFirstImage : (lead.coverImage || null));

  const externalAdUrl =
    lead.url && lead.url.trim()
      ? lead.url.trim().startsWith("http")
        ? lead.url.trim()
        : `https://${lead.url.trim()}`
      : "";

  const handleShare = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!lead.propertyId && !lead.id) return;
    const shareUrl = getPublicShareUrl(lead, {
      agencySubdomain: tenant?.subdomain,
      rootDomain: platformRootDomain,
    });
    try {
      navigator.clipboard.writeText(shareUrl);
      toast.success("Linkul public a fost copiat!");
    } catch {
      toast.success("Link: " + shareUrl);
    }
  };

  const internalId = lead.propertyId || (lead.id ? lead.id.slice(0, 5) : "");
  const isCerere =
    (lead.propertyId && lead.propertyId.startsWith("R")) ||
    (lead.title && lead.title.toLowerCase().startsWith("cerere")) ||
    lead.status === "AreInteres" ||
    lead.status === "Calificare" ||
    lead.status === "Matching";

  const propertyType =
    lead.extractedData?.crmData?.detaliiGenerale?.categoria ||
    lead.categoria ||
    "";
  const rooms =
    lead.extractedData?.crmData?.caracteristici?.detalii?.camere ||
    (lead as any)?.rooms ||
    (lead as any)?.camere;
  const surfaceRaw =
    lead.extractedData?.crmData?.caracteristici?.suprafete?.utila ||
    (lead as any)?.suprafataUtila ||
    (lead as any)?.surface ||
    (lead as any)?.suprafata ||
    (lead as any)?.area;

  const roomsLabel =
    rooms !== undefined && rooms !== null && String(rooms).trim() !== "" && String(rooms).trim() !== "-"
      ? String(rooms).toLowerCase().includes("camer")
        ? String(rooms).trim()
        : `${rooms} ${Number(rooms) === 1 ? "cameră" : "camere"}`
      : "";

  const surfaceLabel =
    surfaceRaw !== undefined && surfaceRaw !== null && String(surfaceRaw).trim() !== "" && String(surfaceRaw).trim() !== "-"
      ? String(surfaceRaw).toLowerCase().includes("mp") || String(surfaceRaw).toLowerCase().includes("m2")
        ? String(surfaceRaw).trim()
        : `${surfaceRaw} mp`
      : "";

  const specsLine = [propertyType, roomsLabel, surfaceLabel].filter(Boolean).join(", ");

  const ownerContacts = contacts.filter((c) => c.type === "Owner");
  const interestedContacts = contacts.filter((c) => c.type === "Renter" || c.type === "Buyer");

  const primaryOwnerContact = ownerContacts[0];
  const ownerDisplayName = primaryOwnerContact
    ? `${primaryOwnerContact.firstName || ""} ${primaryOwnerContact.lastName || ""}`.trim() ||
      (lead.ownerName && lead.ownerName !== "Nespecificat" ? lead.ownerName : "")
    : !isCerere && lead.ownerName && lead.ownerName !== "Nespecificat"
      ? lead.ownerName
      : "";

  const fallbackCerereClientName =
    isCerere && interestedContacts.length === 0 && !primaryOwnerContact && lead.ownerName && lead.ownerName !== "Nespecificat"
      ? lead.ownerName
      : "";

  const displayZone = resolveLeadDisplayArea(lead);
  const extractedPhone = resolveCardPhone(lead, contacts);
  const telHref = extractedPhone ? buildTelHref(extractedPhone) : "";
  const whatsappBusinessHref = extractedPhone ? buildWhatsAppBusinessHref(extractedPhone) : "";

  return (
    <motion.div
      whileHover={{ y: -1 }}
      transition={{ duration: 0.15 }}
      className="bg-white rounded-xl border border-gray-200 hover:border-[#BE9662]/50 hover:shadow-md transition-all cursor-pointer group h-full flex flex-col overflow-hidden shadow-xs"
    >
      {/* Top Meta Bar */}
      {compactTypography ? (
        <div
          onClick={onClick}
          className="px-4 py-3 bg-gray-50/70 border-b border-gray-100 flex items-center justify-between gap-2"
        >
          <span className="font-title text-[12px] font-normal text-gray-900 group-hover:text-[#051D35] transition-colors leading-snug tabular-nums truncate">
            {internalId ? `#${internalId}` : ""}
          </span>
          <span
            className={`font-title text-[12px] font-normal px-2 py-0.5 leading-snug rounded border shrink-0 ml-auto ${
              role === "Proprietar"
                ? "bg-amber-50 text-amber-800 border-amber-200"
                : role === "Chirias"
                  ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                  : "bg-blue-50 text-blue-800 border-blue-200"
            }`}
          >
            {role === "Chirias" ? "Chiriaș" : role === "Cumparator" ? "Cumpărător" : "Proprietar"}
          </span>
        </div>
      ) : (
        <div
          onClick={onClick}
          className="px-4 py-3 bg-gray-50/70 border-b border-gray-100"
        >
          <h3 className="font-title text-[14px] font-semibold text-gray-900 group-hover:text-[#051D35] transition-colors leading-snug line-clamp-2">
            {lead.title}
          </h3>
        </div>
      )}

      {/* Main Content Area */}
      <div
        onClick={onClick}
        className="p-4 flex-1 flex items-stretch justify-between gap-3 bg-white hover:bg-gray-50/30 transition-colors"
      >
        {/* Left Info Column */}
        <div className="flex-1 min-w-0 flex flex-col justify-start gap-1.5">
          {compactTypography ? (
            /* Title inside card body above price for Lead-uri & Cereri */
            <h3 className="font-title text-[12px] font-semibold text-gray-900 group-hover:text-[#051D35] transition-colors leading-snug line-clamp-2">
              {lead.title}
            </h3>
          ) : (
            /* Row 1: ID tag before Tip lead/cerere on the same row */
            <div className="flex items-center gap-1.5 flex-wrap">
              {internalId && (
                <span className="text-[11px] font-sans font-normal px-2 py-0.5 leading-none rounded bg-[#051D35]/5 text-gray-700 border border-[#051D35]/15 shrink-0">
                  #{internalId}
                </span>
              )}
              <span
                className={`text-[11px] font-semibold px-2 py-0.5 leading-none rounded border tracking-wide uppercase shrink-0 ${
                  role === "Proprietar"
                    ? "bg-amber-50 text-amber-800 border-amber-200"
                    : role === "Chirias"
                      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                      : "bg-blue-50 text-blue-800 border-blue-200"
                }`}
              >
                {role === "Chirias" ? "Chiriaș" : role === "Cumparator" ? "Cumpărător" : "Proprietar"}
              </span>
            </div>
          )}

          {/* Row 2: Price */}
          <div className={`${compactTypography ? "text-[12px] font-normal" : "text-[14px] font-semibold"} text-[#051D35] font-sans tracking-normal leading-snug`}>
            {lead.price || "Preț la cerere"}
          </div>

          {/* Row 3: Type of property, number of rooms, surface area */}
          {specsLine && (
            <div className="text-[11px] text-gray-700 font-normal leading-snug">
              {specsLine}
            </div>
          )}

          {/* Row 4: Area / Zone */}
          <div className="flex items-center gap-1 text-[11px] text-gray-700 font-normal truncate leading-snug">
            <MapPin size={11} className="text-[#BE9662] shrink-0" />
            <span className="truncate">{displayZone}</span>
          </div>

          {/* Row 5: Owner link button */}
          {ownerDisplayName && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (primaryOwnerContact && onContactClick) {
                  onContactClick(primaryOwnerContact);
                } else {
                  onClick();
                }
              }}
              className="flex items-center gap-1 text-[11px] text-gray-700 hover:text-[#051D35] hover:underline font-normal min-w-0 max-w-full text-left cursor-pointer leading-snug"
            >
              <User size={11} className="text-[#BE9662] shrink-0" />
              <span className="truncate">{ownerDisplayName}</span>
              {primaryOwnerContact?.contactId && (
                <span className="shrink-0 tabular-nums">({primaryOwnerContact.contactId})</span>
              )}
            </button>
          )}

          {/* Row 6: Interested contacts under owner */}
          {interestedContacts.map((contact, idx) => {
            const contactName =
              `${contact.firstName || ""} ${contact.lastName || ""}`.trim() ||
              contact.phone ||
              "Contact interesat";
            return (
              <button
                key={contact.id || idx}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (onContactClick) {
                    onContactClick(contact);
                  } else {
                    onClick();
                  }
                }}
                className="flex items-center gap-1 text-[11px] text-gray-700 hover:text-[#051D35] hover:underline font-normal min-w-0 max-w-full text-left cursor-pointer leading-snug"
              >
                <Users size={11} className="text-[#BE9662] shrink-0" />
                <span className="truncate">{contactName}</span>
                {contact.contactId && (
                  <span className="shrink-0 tabular-nums">({contact.contactId})</span>
                )}
              </button>
            );
          })}

          {fallbackCerereClientName && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClick();
              }}
              className="flex items-center gap-1 text-[11px] text-gray-700 hover:text-[#051D35] hover:underline font-normal min-w-0 max-w-full text-left cursor-pointer leading-snug"
            >
              <Users size={11} className="text-[#BE9662] shrink-0" />
              <span className="truncate">{fallbackCerereClientName}</span>
              {internalId && (
                <span className="shrink-0 tabular-nums">({internalId})</span>
              )}
            </button>
          )}
        </div>

        {/* Right Thumbnail: fills full available body height minus padding, max 33% width */}
        <div className="w-1/3 max-w-[33%] shrink-0 self-stretch relative rounded-lg overflow-hidden bg-gray-100 border border-gray-200 flex items-center justify-center shadow-2xs min-h-[96px]">
          {firstImage ? (
            <img
              src={getThumbnailImageUrl(firstImage, 360)}
              alt={lead.title}
              loading="lazy"
              decoding="async"
              className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 ease-out"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[#BE9662] bg-gray-50">
              <Building2 size={18} className="text-[#BE9662]" />
            </div>
          )}
        </div>
      </div>

      {/* Footer Area */}
      <div
        onClick={(e) => {
          e.stopPropagation();
          (onQuickViewClick ?? onClick)();
        }}
        className={`px-4 py-2 bg-gray-50/70 border-t border-gray-100 flex items-center justify-between hover:bg-gray-100/60 transition-all ${compactTypography ? "text-[11px]" : "text-[12px]"} select-none`}
      >
        <div
          className="flex items-center gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Contact Actions: Phone, then WhatsApp Business */}
          {telHref ? (
            <a
              href={telHref}
              className={`h-6 w-6 rounded-md flex items-center justify-center ${compactTypography ? "text-[11px]" : ""} text-gray-600 hover:text-[#051D35] hover:bg-gray-200/60 transition-colors cursor-pointer`}
              title={`Apelează ${extractedPhone}`}
              aria-label={`Apelează ${extractedPhone}`}
            >
              <Phone size={13} />
            </a>
          ) : (
            <button
              type="button"
              disabled
              className={`h-6 w-6 rounded-md flex items-center justify-center ${compactTypography ? "text-[11px]" : ""} text-gray-300 cursor-not-allowed`}
              title="Fără număr de telefon disponibil"
              aria-label="Fără număr de telefon disponibil"
            >
              <Phone size={13} />
            </button>
          )}

          {whatsappBusinessHref ? (
            <a
              href={whatsappBusinessHref}
              target="_blank"
              rel="noopener noreferrer"
              className={`h-6 w-6 rounded-md flex items-center justify-center ${compactTypography ? "text-[11px]" : ""} text-gray-600 hover:text-[#051D35] hover:bg-gray-200/60 transition-colors cursor-pointer`}
              title={`Deschide în WhatsApp Business (${extractedPhone})`}
              aria-label={`Deschide în WhatsApp Business (${extractedPhone})`}
            >
              <WhatsAppBusinessIcon size={13} />
            </a>
          ) : (
            <button
              type="button"
              disabled
              className={`h-6 w-6 rounded-md flex items-center justify-center ${compactTypography ? "text-[11px]" : ""} text-gray-300 cursor-not-allowed`}
              title="Fără număr pentru WhatsApp Business"
              aria-label="Fără număr pentru WhatsApp Business"
            >
              <WhatsAppBusinessIcon size={13} />
            </button>
          )}

          {/* Divider between contact actions and share/external link actions */}
          <span className="h-3.5 w-px bg-gray-200 mx-1 shrink-0" aria-hidden="true" />

          <button
            type="button"
            onClick={handleShare}
            className={`h-6 w-6 rounded-md flex items-center justify-center ${compactTypography ? "text-[11px]" : ""} text-gray-600 hover:text-[#051D35] hover:bg-gray-200/60 transition-colors cursor-pointer`}
            title="Distribuie"
            aria-label="Distribuie"
          >
            <Share2 size={13} />
          </button>

          {externalAdUrl ? (
            <a
              href={externalAdUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`h-6 w-6 rounded-md flex items-center justify-center ${compactTypography ? "text-[11px]" : ""} text-gray-600 hover:text-[#051D35] hover:bg-gray-200/60 transition-colors cursor-pointer`}
              title="Deschide anunțul original pe platforma externă"
              aria-label="Deschide anunțul original pe platforma externă"
            >
              <ExternalLink size={13} />
            </a>
          ) : (
            <button
              type="button"
              disabled
              className={`h-6 w-6 rounded-md flex items-center justify-center ${compactTypography ? "text-[11px]" : ""} text-gray-300 cursor-not-allowed`}
              title="Fără link sursă extern"
              aria-label="Fără link sursă extern"
            >
              <ExternalLink size={13} />
            </button>
          )}
        </div>

        <div className={`flex items-center gap-1 ${compactTypography ? "text-[11px]" : "text-[12px]"} font-semibold text-gray-600 group-hover:text-[#051D35] transition-colors`}>
          <span>{quickViewLabel}</span>
          <ChevronRight size={13} className="text-[#BE9662]" />
        </div>
      </div>
    </motion.div>
  );
};
