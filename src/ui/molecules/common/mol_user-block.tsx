import React from "react";
import { AtmAvatar } from "../../atoms/common/atm_avatar";
import { AtmStatusIndicator, StatusType } from "../../atoms/common/atm_status-indicator";

export interface MolUserBlockProps {
  name: string;
  subtitle?: string;
  avatarSrc?: string | null;
  status?: StatusType;
  compact?: boolean;
  className?: string;
  onClick?: () => void;
}

export const MolUserBlock: React.FC<MolUserBlockProps> = ({
  name,
  subtitle,
  avatarSrc,
  status,
  compact = false,
  className = "",
  onClick,
}) => {
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-3 min-w-0 ${
        onClick ? "cursor-pointer hover:opacity-90 select-none" : ""
      } ${className}`}
    >
      <div className="relative shrink-0">
        <AtmAvatar src={avatarSrc} name={name} size={compact ? "sm" : "md"} />
        {status && (
          <span className="absolute -bottom-0.5 -right-0.5 ring-2 ring-white rounded-full">
            <AtmStatusIndicator status={status} />
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <h4 className="font-title text-xs font-semibold text-gray-900 truncate leading-snug">{name}</h4>
        {subtitle && (
          <p className="text-[10px] text-gray-500 font-normal truncate leading-tight mt-1">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
};
