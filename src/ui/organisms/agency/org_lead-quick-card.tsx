import React from "react";
import { MapPin, Users, ChevronRight, Share2, Building2 } from "lucide-react";
import { AtmAgencyRoleBadge } from "../../atoms/agency/atm_agency-role-badge";
import { designTokens } from "../../../../design/tokens";
import { getThumbnailImageUrl } from "../../../utils/imageUtils";
import { resolveAreaFromAd } from "../../../utils/zoneResolutionUtils";

export interface OrgLeadQuickCardProps {
  id: string;
  internalId?: string;
  title: string;
  price?: string;
  role: string;
  transactionType?: string;
  rooms?: string | number;
  zone?: string;
  ownerName?: string;
  thumbnailUrl?: string | null;
  contactsCount?: number;
  onCardClick?: () => void;
  onQuickViewClick?: () => void;
  onShareClick?: () => void;
  className?: string;
}

export const OrgLeadQuickCard: React.FC<OrgLeadQuickCardProps> = ({
  internalId,
  title,
  price = "Preț la cerere",
  role,
  transactionType = "Vânzare",
  rooms,
  zone = "București",
  ownerName,
  thumbnailUrl,
  contactsCount = 0,
  onCardClick,
  onQuickViewClick,
  onShareClick,
  className = "",
}) => {
  return (
    <div
      onClick={onCardClick}
      className={`bg-white border border-gray-200 hover:border-[#BE9662]/50 hover:shadow-md transition-all cursor-pointer group flex flex-col justify-between overflow-hidden shadow-2xs h-full ${className}`}
      style={{ borderRadius: designTokens.radius.modal }}
    >
      {/* Top Meta Bar */}
      <div className="px-4 py-3 flex items-center justify-between gap-2 bg-gray-50/70 border-b border-gray-100">
        <div className="flex items-center gap-2 min-w-0">
          <AtmAgencyRoleBadge role={role} />
          {internalId && (
            <span className="text-[10px] font-mono font-normal px-2 py-1 rounded bg-[#051D35]/5 text-[#051D35] border border-[#051D35]/15 shrink-0">
              #{internalId}
            </span>
          )}
        </div>

        {onShareClick && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onShareClick();
            }}
            className="h-6 px-2 rounded-md border border-gray-200 bg-white hover:bg-amber-50/50 hover:border-[#BE9662]/40 text-gray-700 hover:text-[#051D35] text-[10px] font-semibold flex items-center gap-1 transition-all shadow-2xs shrink-0 cursor-pointer"
            title="Copiază link public"
          >
            <Share2 size={11} className="text-[#BE9662]" />
            <span>Distribuie</span>
          </button>
        )}
      </div>

      {/* Main Content Area */}
      <div className="p-4 flex-1 flex flex-col justify-between gap-4">
        <h3 className="font-title text-[13px] font-semibold text-gray-900 group-hover:text-[#051D35] transition-colors leading-snug line-clamp-2">
          {title}
        </h3>

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-2 flex-1 min-w-0">
            <div className="text-[14px] font-normal text-[#051D35] font-mono">{price}</div>

            <div className="flex items-center gap-2 text-xs text-gray-500 font-normal flex-wrap">
              <span className="text-[11px] text-gray-700 bg-gray-100 px-2 py-1 rounded font-normal">
                {transactionType}
              </span>
              {rooms && (
                <>
                  <span className="text-gray-300">·</span>
                  <span className="text-[11px] text-gray-600 font-normal">
                    {rooms} {Number(rooms) === 1 ? "cameră" : "camere"}
                  </span>
                </>
              )}
            </div>

            <div className="flex items-center gap-1 text-[11px] font-normal text-gray-500 truncate">
              <MapPin size={11} className="text-[#BE9662] shrink-0" />
              <span className="truncate">{resolveAreaFromAd({ rawZone: zone, title })}</span>
            </div>

            {ownerName && (
              <div className="text-[10px] text-gray-400 truncate">
                <span className="font-semibold text-gray-500">Proprietar:</span>{" "}
                <span className="font-normal">{ownerName}</span>
              </div>
            )}
          </div>

          {/* Thumbnail */}
          <div className="w-18 h-16 rounded-lg overflow-hidden bg-gray-100 shrink-0 border border-gray-200 flex items-center justify-center self-center shadow-2xs">
            {thumbnailUrl ? (
              <img
                src={getThumbnailImageUrl(thumbnailUrl, 160)}
                alt={title}
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 ease-out"
                referrerPolicy="no-referrer"
              />
            ) : (
              <Building2 size={18} className="text-[#BE9662]" />
            )}
          </div>
        </div>
      </div>

      {/* Footer Area */}
      {onQuickViewClick && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            onQuickViewClick();
          }}
          className="px-4 py-2 bg-gray-50/70 border-t border-gray-100 flex items-center justify-between hover:bg-gray-100/60 transition-all text-xs select-none"
        >
          <div className="flex items-center gap-2 text-[11px] font-normal text-gray-500">
            <Users size={12} className="text-gray-400" />
            <span>
              {contactsCount} {contactsCount === 1 ? "contact" : "contacte"}
            </span>
          </div>

          <div className="flex items-center gap-1 text-[11px] font-semibold text-gray-600 group-hover:text-[#051D35] transition-colors">
            <span>Vezi rapid</span>
            <ChevronRight size={13} className="text-[#BE9662]" />
          </div>
        </div>
      )}
    </div>
  );
};
