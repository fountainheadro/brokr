import React from "react";

export type StatusType = "online" | "offline" | "busy" | "away" | "active" | "inactive";

export interface AtmStatusIndicatorProps {
  status: StatusType;
  pulse?: boolean;
  className?: string;
}

export const AtmStatusIndicator: React.FC<AtmStatusIndicatorProps> = ({
  status,
  pulse = false,
  className = "",
}) => {
  const colorMap: Record<StatusType, string> = {
    online: "bg-emerald-500",
    active: "bg-emerald-500",
    busy: "bg-rose-500",
    away: "bg-amber-500",
    offline: "bg-gray-400",
    inactive: "bg-gray-400",
  };

  return (
    <span className={`relative inline-flex items-center justify-center shrink-0 ${className}`}>
      {pulse && (
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${colorMap[status]}`}
        />
      )}
      <span className={`relative inline-block h-2 w-2 rounded-full ${colorMap[status]}`} />
    </span>
  );
};
