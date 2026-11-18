import React from "react";
import { User } from "lucide-react";
import { designTokens } from "../../../../design/tokens";

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

export interface AtmAvatarProps {
  src?: string | null;
  name?: string;
  size?: AvatarSize;
  rounded?: "circle" | "standard";
  className?: string;
}

export const AtmAvatar: React.FC<AtmAvatarProps> = ({
  src,
  name,
  size = "md",
  rounded = "standard",
  className = "",
}) => {
  const [imageError, setImageError] = React.useState(false);

  const sizeStyles: Record<AvatarSize, { dimension: string; text: string; iconSize: number }> = {
    xs: { dimension: "w-5 h-5", text: "text-[9px]", iconSize: 10 },
    sm: { dimension: "w-7 h-7", text: "text-[11px]", iconSize: 13 },
    md: { dimension: "w-9 h-9", text: "text-xs", iconSize: 16 },
    lg: { dimension: "w-11 h-11", text: "text-sm", iconSize: 19 },
    xl: { dimension: "w-14 h-14", text: "text-base", iconSize: 24 },
  };

  const getInitials = (n?: string) => {
    if (!n) return "";
    const parts = n.trim().split(" ");
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const borderRadius =
    rounded === "circle" ? designTokens.radius.pill : designTokens.radius.standard;

  return (
    <div
      className={`relative inline-flex items-center justify-center bg-gray-100 text-[#051D35] border border-gray-200 overflow-hidden font-semibold select-none shrink-0 ${sizeStyles[size].dimension} ${className}`}
      style={{ borderRadius }}
    >
      {src && !imageError ? (
        <img
          src={src}
          alt={name || "Avatar"}
          onError={() => setImageError(true)}
          className="w-full h-full object-cover"
        />
      ) : name ? (
        <span className={sizeStyles[size].text}>{getInitials(name)}</span>
      ) : (
        <User size={sizeStyles[size].iconSize} className="text-gray-400" />
      )}
    </div>
  );
};
