import React from "react";
import { designTokens } from "../../../../design/tokens";

export interface AtmTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export const AtmTextarea = React.forwardRef<HTMLTextAreaElement, AtmTextareaProps>(
  ({ error = false, disabled, className = "", rows = 3, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        rows={rows}
        disabled={disabled}
        className={`w-full bg-white border border-gray-200 text-xs font-normal text-gray-900 placeholder:text-gray-400 p-3 focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662]/30 transition-all disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed ${
          error ? "border-rose-400 focus:border-rose-500 focus:ring-rose-200" : ""
        } ${className}`}
        style={{ borderRadius: designTokens.radius.standard }}
        {...props}
      />
    );
  }
);

AtmTextarea.displayName = "AtmTextarea";
