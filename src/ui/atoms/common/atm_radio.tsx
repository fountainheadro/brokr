import React from "react";

export interface AtmRadioProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
}

export const AtmRadio = React.forwardRef<HTMLInputElement, AtmRadioProps>(
  ({ label, checked, onChange, disabled, className = "", id, ...props }, ref) => {
    const inputId = id || (label ? `rad-${label.toLowerCase().replace(/\s+/g, "-")}` : undefined);

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
            type="radio"
            checked={checked}
            onChange={onChange}
            disabled={disabled}
            className="peer sr-only"
            {...props}
          />
          <div
            className={`w-4 h-4 rounded-full border border-gray-300 peer-focus:ring-2 peer-focus:ring-[#BE9662]/30 transition-all flex items-center justify-center ${
              checked ? "border-[#051D35] bg-white" : "bg-white hover:border-gray-400"
            }`}
          >
            {checked && <div className="w-2 h-2 rounded-full bg-[#051D35]" />}
          </div>
        </div>
        {label && <span className="font-medium text-gray-700">{label}</span>}
      </label>
    );
  }
);

AtmRadio.displayName = "AtmRadio";
