import React, { useEffect } from "react";
import { X } from "lucide-react";

export interface OrgDrawerBaseProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  width?: "sm" | "md" | "lg";
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export const OrgDrawerBase: React.FC<OrgDrawerBaseProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  width = "md",
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

  const widthStyles = {
    sm: "md:max-w-sm",
    md: "md:max-w-md",
    lg: "md:max-w-xl",
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[1400] flex justify-end bg-black/30 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-[calc(100vw-48px)] md:w-full bg-white h-full shadow-2xl border-l border-gray-200 flex flex-col animate-in slide-in-from-right duration-250 ${widthStyles[width]} ${className}`}
      >
        {/* Drawer Header */}
        {(title || subtitle) && (
          <div className="h-12 px-5 border-b border-gray-100 flex items-center justify-between gap-4 bg-white select-none">
            <div className="min-w-0 flex-1">
              {title && (
                <h3 className="font-title text-sm font-semibold text-gray-900 truncate tracking-tight">{title}</h3>
              )}
              {subtitle && (
                <p className="text-[11px] text-gray-500 font-medium truncate">{subtitle}</p>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
              aria-label="Închide"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Drawer Body */}
        <div className="p-5 overflow-y-auto flex-1 custom-scrollbar text-xs text-gray-700">
          {children}
        </div>

        {/* Drawer Footer */}
        {footer && (
          <div className="px-5 py-3 bg-gray-50/70 border-t border-gray-100 flex items-center justify-end gap-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
