import React from "react";
import { designTokens } from "../../../../design/tokens";

export interface AtmProgressBarProps {
  value: number; // 0 to 100
  max?: number;
  variant?: "brand" | "accent" | "success" | "warning" | "danger";
  size?: "sm" | "md";
  className?: string;
}

export const AtmProgressBar: React.FC<AtmProgressBarProps> = ({
  value,
  max = 100,
  variant = "accent",
  size = "md",
  className = "",
}) => {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));

  const variantStyles = {
    brand: "bg-[#051D35]",
    accent: "bg-[#BE9662]",
    success: "bg-emerald-500",
    warning: "bg-amber-500",
    danger: "bg-rose-500",
  };

  const heightStyles = {
    sm: "h-2",
    md: "h-3",
  };

  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className={`w-full bg-gray-100 overflow-hidden ${heightStyles[size]} ${className}`}
      style={{ borderRadius: designTokens.radius.pill }}
    >
      <div
        className={`h-full transition-all duration-300 ${variantStyles[variant]}`}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
};
