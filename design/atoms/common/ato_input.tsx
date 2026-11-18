import React from "react";
import { designTokens } from "../../tokens";

interface AtoInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const AtoInput = React.forwardRef<HTMLInputElement, AtoInputProps>(
  ({ label, error, hint, leftIcon, rightIcon, className = "", id, ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);

    return (
      <div className="w-full space-y-1">
        {label && (
          <label htmlFor={inputId} className="block text-[11px] font-semibold text-gray-700">
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          {leftIcon && (
            <div className="absolute left-3 text-gray-400 pointer-events-none flex items-center justify-center">
              {leftIcon}
            </div>
          )}
          <input
            id={inputId}
            ref={ref}
            {...props}
            className={`w-full h-9 bg-white border border-gray-200 text-xs font-normal text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662]/30 transition-all ${
              leftIcon ? "pl-8" : "pl-3"
            } ${rightIcon ? "pr-8" : "pr-3"} ${
              error ? "border-rose-400 focus:border-rose-500 focus:ring-rose-200" : ""
            } ${className}`}
            style={{ borderRadius: designTokens.radius.standard }}
          />
          {rightIcon && (
            <div className="absolute right-3 text-gray-400 pointer-events-none flex items-center justify-center">
              {rightIcon}
            </div>
          )}
        </div>
        {error ? (
          <p className="text-[10px] text-rose-600 font-medium">{error}</p>
        ) : hint ? (
          <p className="text-[10px] text-gray-500">{hint}</p>
        ) : null}
      </div>
    );
  }
);

AtoInput.displayName = "AtoInput";
