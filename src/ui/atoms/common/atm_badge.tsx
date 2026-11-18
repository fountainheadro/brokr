import React from "react";
import { designTokens } from "../../../../design/tokens";

export type BadgeVariant =
  | "default"
  | "brand"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "accent";

export type BadgeSize = "sm" | "md";

export interface AtmBadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: BadgeSize;
  pill?: boolean;
  icon?: React.ReactNode;
  className?: string;
}

export const AtmBadge: React.FC<AtmBadgeProps> = ({
  children,
  variant = "default",
  size = "sm",
  pill = false,
  icon,
  className = "",
}) => {
  const variantStyles: Record<BadgeVariant, string> = {
    default: "bg-gray-100 text-gray-700 border-gray-200",
    brand: "bg-[#051D35]/5 text-[#051D35] border-[#051D35]/15",
    accent: "bg-[#BE9662]/10 text-[#BE9662] border-[#BE9662]/25",
    success: "bg-emerald-50 text-emerald-800 border-emerald-200",
    warning: "bg-amber-50 text-amber-800 border-amber-200",
    danger: "bg-rose-50 text-rose-800 border-rose-200",
    info: "bg-blue-50 text-blue-800 border-blue-200",
  };

  const sizeStyles: Record<BadgeSize, string> = {
    sm: "text-[10px] px-2 py-1 gap-1",
    md: "text-[11px] px-2 py-1 gap-2",
  };

  return (
    <span
      className={`inline-flex items-center font-semibold border tracking-wide uppercase ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      style={{
        borderRadius: pill ? designTokens.radius.pill : designTokens.radius.badge,
      }}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span>{children}</span>
    </span>
  );
};

export const AtoBadge = AtmBadge; // Backward compatibility alias
