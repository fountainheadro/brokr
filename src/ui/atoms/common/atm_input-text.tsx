import React from "react";
import { designTokens } from "../../../../design/tokens";

export type InputSize = "sm" | "md" | "lg";

export interface AtmInputTextProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  sizeVariant?: InputSize;
  error?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  onClear?: () => void;
}

export const AtmInputText = React.forwardRef<HTMLInputElement, AtmInputTextProps>(
  (
    {
      sizeVariant = "md",
      error = false,
      leftIcon,
      rightIcon,
      onClear,
      disabled,
      className = "",
      type = "text",
      ...props
    },
    ref
  ) => {
    const sizeStyles: Record<InputSize, string> = {
      sm: "h-7 text-[11px]",
      md: "h-9 text-xs",
      lg: "h-11 text-sm",
    };

    return (
      <div className="relative flex items-center w-full">
        {leftIcon && (
          <div className="absolute left-3 text-gray-400 pointer-events-none flex items-center justify-center">
            {leftIcon}
          </div>
        )}
        <input
          ref={ref}
          type={type}
          disabled={disabled}
          className={`w-full bg-white border border-gray-200 font-normal text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662]/30 transition-all disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed ${
            sizeStyles[sizeVariant]
          } ${leftIcon ? "pl-8" : "pl-3"} ${
            rightIcon || onClear ? "pr-8" : "pr-3"
          } ${error ? "border-rose-400 focus:border-rose-500 focus:ring-rose-200" : ""} ${className}`}
          style={{ borderRadius: designTokens.radius.standard }}
          {...props}
        />
        {onClear && props.value ? (
          <button
            type="button"
            onClick={onClear}
            className="absolute right-2 text-gray-400 hover:text-gray-600 p-1 rounded cursor-pointer"
            title="Șterge"
          >
            ×
          </button>
        ) : (
          rightIcon && (
            <div className="absolute right-3 text-gray-400 pointer-events-none flex items-center justify-center">
              {rightIcon}
            </div>
          )
        )}
      </div>
    );
  }
);

AtmInputText.displayName = "AtmInputText";
export const AtoInput = AtmInputText; // Backward compatibility alias
