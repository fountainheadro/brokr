import React from "react";
import { MapPin, Users, ChevronRight, Share2, ExternalLink, Building2, User } from "lucide-react";
import { Lead, getLeadRole } from "../services/leadsService";
import { Contact } from "../services/contactsService";
import { motion } from "motion/react";
import toast from "react-hot-toast";
import { getPublicShareUrl } from "../utils/shareUtils";
import { getThumbnailImageUrl } from "../utils/imageUtils";

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
    if (!lead.id) return;
    const shareUrl = getPublicShareUrl(lead.id);
    try {
      navigator.clipboard.writeText(shareUrl);
      toast.success("Linkul public al proprietății a fost copiat!");
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
            <span className="truncate">{lead.zone || "București"}</span>
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
              <User size={11} className="text-gray-500 shrink-0" />
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
                <Users size={11} className="text-gray-500 shrink-0" />
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
              <Users size={11} className="text-gray-500 shrink-0" />
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
            <div className="w-full h-full flex items-center justify-center text-gray-300 bg-gray-50">
              <Building2 size={18} className="text-gray-300" />
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
