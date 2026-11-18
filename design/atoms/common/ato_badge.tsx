import React from "react";
import { designTokens } from "../../tokens";

export type BadgeVariant = "default" | "success" | "warning" | "danger" | "info" | "brand";

interface AtoBadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: "sm" | "md";
  className?: string;
}

export const AtoBadge: React.FC<AtoBadgeProps> = ({
  children,
  variant = "default",
  size = "sm",
  className = "",
}) => {
  const variantStyles: Record<BadgeVariant, string> = {
    default: "bg-gray-100 text-gray-700 border-gray-200",
    brand: "bg-[#051D35]/5 text-[#051D35] border-[#051D35]/15",
    success: "bg-emerald-50 text-emerald-800 border-emerald-200",
    warning: "bg-amber-50 text-amber-800 border-amber-200",
    danger: "bg-rose-50 text-rose-800 border-rose-200",
    info: "bg-blue-50 text-blue-800 border-blue-200",
  };

  const sizeStyles = {
    sm: "text-[10px] px-2 py-1",
    md: "text-[11px] px-2 py-1",
  };

  return (
    <span
      className={`inline-flex items-center gap-1 font-semibold border rounded tracking-wide ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      style={{ borderRadius: designTokens.radius.badge }}
    >
      {children}
    </span>
  );
};
