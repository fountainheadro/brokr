import React from "react";
import { designTokens } from "../../../../design/tokens";

export type IconBoxVariant = "default" | "brand" | "accent" | "success" | "warning" | "danger";

export interface AtmIconWrapperProps {
  icon: React.ReactNode;
  variant?: IconBoxVariant;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export const AtmIconWrapper: React.FC<AtmIconWrapperProps> = ({
  icon,
  variant = "default",
  size = "md",
  className = "",
}) => {
  const variantStyles: Record<IconBoxVariant, string> = {
    default: "bg-gray-100 text-gray-600 border-gray-200",
    brand: "bg-[#051D35]/5 text-[#051D35] border-[#051D35]/15",
    accent: "bg-[#BE9662]/10 text-[#BE9662] border-[#BE9662]/30",
    success: "bg-emerald-50 text-emerald-700 border-emerald-200",
    warning: "bg-amber-50 text-amber-700 border-amber-200",
    danger: "bg-rose-50 text-rose-700 border-rose-200",
  };

  const sizeStyles = {
    sm: "w-6 h-6 text-xs",
    md: "w-8 h-8 text-sm",
    lg: "w-10 h-10 text-base",
  };

  return (
    <div
      className={`inline-flex items-center justify-center border shrink-0 select-none ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      style={{ borderRadius: designTokens.radius.standard }}
    >
      {icon}
    </div>
  );
};
