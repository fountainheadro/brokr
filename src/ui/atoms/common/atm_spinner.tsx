import React from "react";

export interface AtmSpinnerProps {
  size?: "sm" | "md" | "lg";
  variant?: "brand" | "accent" | "white" | "gray";
  className?: string;
}

export const AtmSpinner: React.FC<AtmSpinnerProps> = ({
  size = "md",
  variant = "brand",
  className = "",
}) => {
  const sizeStyles = {
    sm: "w-4 h-4 border-2",
    md: "w-5 h-5 border-2",
    lg: "w-8 h-8 border-3",
  };

  const variantStyles = {
    brand: "border-[#051D35]/20 border-t-[#051D35]",
    accent: "border-[#BE9662]/20 border-t-[#BE9662]",
    white: "border-white/30 border-t-white",
    gray: "border-gray-200 border-t-gray-600",
  };

  return (
    <div
      role="status"
      aria-label="Se încarcă"
      className={`inline-block rounded-full animate-spin ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
    />
  );
};
