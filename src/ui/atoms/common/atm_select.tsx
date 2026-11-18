import React from "react";
import { ChevronDown } from "lucide-react";
import { designTokens } from "../../../../design/tokens";

export interface AtmSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface AtmSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: AtmSelectOption[];
  error?: boolean;
  sizeVariant?: "sm" | "md";
}

export const AtmSelect = React.forwardRef<HTMLSelectElement, AtmSelectProps>(
  ({ options, error = false, sizeVariant = "md", disabled, className = "", ...props }, ref) => {
    const sizeStyles = {
      sm: "h-7 text-[11px] pl-3 pr-7",
      md: "h-9 text-xs pl-3 pr-8",
    };

    return (
      <div className="relative w-full">
        <select
          ref={ref}
          disabled={disabled}
          className={`w-full bg-white border border-gray-200 font-normal text-gray-900 appearance-none focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662]/30 transition-all cursor-pointer disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed ${
            sizeStyles[sizeVariant]
          } ${error ? "border-rose-400 focus:border-rose-500" : ""} ${className}`}
          style={{ borderRadius: designTokens.radius.standard }}
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={14}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
        />
      </div>
    );
  }
);

AtmSelect.displayName = "AtmSelect";
