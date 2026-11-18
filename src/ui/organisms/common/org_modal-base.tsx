import React, { useEffect } from "react";
import { X } from "lucide-react";
import { designTokens } from "../../../../design/tokens";

export type ModalSize = "sm" | "md" | "lg" | "xl" | "full";

export interface OrgModalBaseProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  size?: ModalSize;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export const OrgModalBase: React.FC<OrgModalBaseProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  size = "md",
  children,
  footer,
  className = "",
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) onClose();
    };
    if (isOpen) {
      document.body.style.overflow = "hidden";
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.body.style.overflow = "unset";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sizeStyles: Record<ModalSize, string> = {
    sm: "max-w-md",
    md: "max-w-lg",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
    full: "max-w-[95vw] h-[90vh]",
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[1400] flex items-center justify-center p-4 bg-black/45 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full bg-white shadow-2xl border border-gray-200 overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200 ${sizeStyles[size]} ${className}`}
        style={{ borderRadius: designTokens.radius.modal }}
      >
        {/* Modal Header */}
        {(title || subtitle) && (
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-4 bg-white select-none">
            <div className="min-w-0 flex-1">
              {title && (
                <h3 className="font-title text-sm font-semibold text-gray-900 truncate tracking-tight">{title}</h3>
              )}
              {subtitle && (
                <p className="text-[11px] text-gray-500 font-medium truncate mt-0.5">{subtitle}</p>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
              aria-label="Închide"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto flex-1 custom-scrollbar text-xs text-gray-700">
          {children}
        </div>

        {/* Modal Footer */}
        {footer && (
          <div className="px-5 py-3 bg-gray-50/70 border-t border-gray-100 flex items-center justify-end gap-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
