import React from "react";
import { designTokens } from "../../../../design/tokens";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "tertiary"
  | "accent"
  | "ghost"
  | "danger"
  | "icon";

export type ButtonSize = "sm" | "md" | "lg";

export interface AtmButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const AtmButton = React.forwardRef<HTMLButtonElement, AtmButtonProps>(
  (
    {
      children,
      variant = "primary",
      size = "md",
      isLoading = false,
      leftIcon,
      rightIcon,
      className = "",
      disabled,
      ...props
    },
    ref
  ) => {
    const variantStyles: Record<ButtonVariant, string> = {
      primary: "bg-[#051D35] hover:bg-[#0a2b4a] text-white border-transparent focus:ring-[#051D35]/30",
      secondary: "bg-white hover:bg-gray-50 text-gray-700 border-gray-200 shadow-2xs focus:ring-gray-200",
      tertiary: "bg-gray-50 hover:bg-gray-100 text-gray-700 border-gray-200 focus:ring-gray-200",
      accent: "bg-[#BE9662] hover:bg-[#a8824f] text-white border-transparent focus:ring-[#BE9662]/30",
      ghost: "bg-transparent hover:bg-gray-100 text-gray-600 border-transparent focus:ring-gray-200",
      danger: "bg-rose-600 hover:bg-rose-700 text-white border-transparent focus:ring-rose-200",
      icon: "bg-transparent hover:bg-gray-100 text-gray-500 hover:text-gray-900 border-transparent p-0 aspect-square justify-center",
    };

    const sizeStyles: Record<ButtonSize, string> = {
      sm: variant === "icon" ? "h-7 w-7 text-xs" : "h-7 px-3 text-[11px] gap-2",
      md: variant === "icon" ? "h-9 w-9 text-sm" : "h-9 px-4 text-xs gap-2",
      lg: variant === "icon" ? "h-11 w-11 text-base" : "h-11 px-5 text-sm gap-2",
    };

    return (
      <button
        ref={ref}
        {...props}
        disabled={disabled || isLoading}
        className={`inline-flex items-center justify-center font-semibold border transition-all cursor-pointer select-none focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
        style={{ borderRadius: designTokens.radius.standard }}
      >
        {isLoading ? (
          <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
        ) : (
          leftIcon && <span className="shrink-0">{leftIcon}</span>
        )}
        {children && <span>{children}</span>}
        {!isLoading && rightIcon && <span className="shrink-0">{rightIcon}</span>}
      </button>
    );
  }
);

AtmButton.displayName = "AtmButton";
export const AtoButton = AtmButton; // Backward compatibility alias
