import React from "react";
import { designTokens } from "../../../../design/tokens";

export interface AtmSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}

export const AtmSwitch: React.FC<AtmSwitchProps> = ({
  checked,
  onChange,
  label,
  disabled = false,
  className = "",
}) => {
  return (
    <label
      className={`inline-flex items-center gap-2 cursor-pointer select-none text-xs text-gray-700 ${
        disabled ? "opacity-50 cursor-not-allowed" : ""
      } ${className}`}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center transition-colors focus:outline-none focus:ring-2 focus:ring-[#BE9662]/30 disabled:cursor-not-allowed ${
          checked ? "bg-[#051D35]" : "bg-gray-300 hover:bg-gray-400"
        }`}
        style={{ borderRadius: designTokens.radius.pill }}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform ${
            checked ? "translate-x-4.5" : "translate-x-1"
          }`}
        />
      </button>
      {label && <span className="font-medium text-gray-700">{label}</span>}
    </label>
  );
};
