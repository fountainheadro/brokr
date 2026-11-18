import React from "react";
import { designTokens } from "../../tokens";

export type ButtonVariant = "primary" | "secondary" | "accent" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

interface AtoButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  icon?: React.ReactNode;
}

export const AtoButton: React.FC<AtoButtonProps> = ({
  children,
  variant = "primary",
  size = "md",
  isLoading = false,
  icon,
  className = "",
  disabled,
  ...props
}) => {
  const variantStyles: Record<ButtonVariant, string> = {
    primary: "bg-[#051D35] hover:bg-[#0a2b4a] text-white border-transparent",
    secondary: "bg-white hover:bg-gray-50 text-gray-700 border-gray-200 shadow-2xs",
    accent: "bg-[#BE9662] hover:bg-[#a8824f] text-white border-transparent",
    ghost: "bg-transparent hover:bg-gray-100 text-gray-600 border-transparent",
    danger: "bg-rose-600 hover:bg-rose-700 text-white border-transparent",
  };

  const sizeStyles: Record<ButtonSize, string> = {
    sm: "h-7 px-3 text-[11px] gap-1",
    md: "h-9 px-4 text-xs gap-2",
    lg: "h-11 px-5 text-sm gap-2",
  };

  return (
    <button
      {...props}
      disabled={disabled || isLoading}
      className={`inline-flex items-center justify-center font-semibold border transition-all cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      style={{ borderRadius: designTokens.radius.standard }}
    >
      {isLoading ? (
        <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
      ) : (
        icon && <span className="shrink-0">{icon}</span>
      )}
      <span>{children}</span>
    </button>
  );
};
