import React from "react";
import { Building2 } from "lucide-react";
import { designTokens } from "../../../../design/tokens";

export interface TplAuthLoginProps {
  brandName?: string;
  brandTagline?: string;
  formContent: React.ReactNode;
  footerContent?: React.ReactNode;
  className?: string;
}

export const TplAuthLogin: React.FC<TplAuthLoginProps> = ({
  brandName = "Brokr CRM",
  brandTagline = "Platforma inteligentă multi-tenant pentru agenții imobiliare de top",
  formContent,
  footerContent,
  className = "",
}) => {
  return (
    <div className={`min-h-screen w-screen flex bg-gray-50 select-none ${className}`}>
      {/* Left Marketing Hero Banner (Desktop) */}
      <div className="hidden lg:flex lg:w-1/2 bg-[#051D35] p-12 flex-col justify-between relative overflow-hidden text-white">
        {/* Subtle Background Pattern */}
        <div className="absolute inset-0 bg-radial from-[#0a2b4a] to-transparent opacity-60 pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-96 h-96 rounded-full bg-[#BE9662]/10 blur-3xl pointer-events-none" />

        {/* Top Logo */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#BE9662] text-white flex items-center justify-center font-semibold shadow-md">
            <Building2 size={20} />
          </div>
          <span className="font-title text-base font-semibold tracking-tight">{brandName}</span>
        </div>

        {/* Hero Copy */}
        <div className="relative z-10 max-w-md space-y-4">
          <span className="text-[11px] font-semibold text-[#BE9662] uppercase tracking-[0.2em]">
            Multi-Tenant Real Estate Platform
          </span>
          <h1 className="font-title text-3xl font-semibold leading-tight tracking-tight">
            Gestionează portofoliul, clienții și agenții dintr-un singur loc.
          </h1>
          <p className="text-sm text-gray-300 leading-relaxed font-normal">
            {brandTagline}
          </p>
        </div>

        {/* Bottom Feature Badges */}
        <div className="relative z-10 flex items-center gap-4 text-xs text-gray-400">
          <span>✓ Subdomeniu dedicat</span>
          <span>✓ Extracție automată AI</span>
          <span>✓ Izolare completă a datelor</span>
        </div>
      </div>

      {/* Right Login Form Container */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 sm:p-12">
        <div
          className="w-full max-w-md bg-white border border-gray-200/80 p-8 shadow-sm space-y-6"
          style={{ borderRadius: designTokens.radius.modal }}
        >
          {/* Mobile Header */}
          <div className="lg:hidden flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-[#051D35] text-white flex items-center justify-center">
              <Building2 size={16} />
            </div>
            <span className="font-title text-sm font-semibold text-gray-900">{brandName}</span>
          </div>

          <div>{formContent}</div>

          {footerContent && (
            <div className="pt-4 border-t border-gray-100 text-center text-xs text-gray-500">
              {footerContent}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
