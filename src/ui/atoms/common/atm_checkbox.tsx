import React from "react";
import { Check } from "lucide-react";
import { designTokens } from "../../../../design/tokens";

export interface AtmCheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
}

export const AtmCheckbox = React.forwardRef<HTMLInputElement, AtmCheckboxProps>(
  ({ label, checked, onChange, disabled, className = "", id, ...props }, ref) => {
    const inputId = id || (label ? `chk-${label.toLowerCase().replace(/\s+/g, "-")}` : undefined);

    return (
      <label
        htmlFor={inputId}
        className={`inline-flex items-center gap-2 cursor-pointer select-none text-xs text-gray-700 ${
          disabled ? "opacity-50 cursor-not-allowed" : ""
        } ${className}`}
      >
        <div className="relative flex items-center justify-center">
          <input
            id={inputId}
            ref={ref}
            type="checkbox"
            checked={checked}
            onChange={onChange}
            disabled={disabled}
            className="peer sr-only"
            {...props}
          />
          <div
            className={`w-4 h-4 border border-gray-300 peer-focus:ring-2 peer-focus:ring-[#BE9662]/30 transition-all flex items-center justify-center ${
              checked ? "bg-[#051D35] border-[#051D35] text-white" : "bg-white hover:border-gray-400"
            }`}
            style={{ borderRadius: designTokens.radius.badge }}
          >
            {checked && <Check size={11} strokeWidth={3} />}
          </div>
        </div>
        {label && <span className="font-medium text-gray-700">{label}</span>}
      </label>
    );
  }
);

AtmCheckbox.displayName = "AtmCheckbox";
