import React from "react";
import { ChevronRight } from "lucide-react";

export interface BreadcrumbItem {
  id: string;
  label: string;
  href?: string;
  onClick?: () => void;
  active?: boolean;
}

export interface MolBreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
}

export const MolBreadcrumbs: React.FC<MolBreadcrumbsProps> = ({ items, className = "" }) => {
  return (
    <nav aria-label="Breadcrumb" className={`flex items-center gap-2 text-xs ${className}`}>
      {items.map((item, index) => {
        const isLast = index === items.length - 1;

        return (
          <React.Fragment key={item.id}>
            {item.onClick || item.href ? (
              <button
                type="button"
                onClick={item.onClick}
                className="text-gray-500 hover:text-[#051D35] font-medium transition-colors cursor-pointer select-none"
              >
                {item.label}
              </button>
            ) : (
              <span
                className={`font-semibold truncate max-w-[200px] ${
                  isLast ? "text-gray-900" : "text-gray-500"
                }`}
              >
                {item.label}
              </span>
            )}
            {!isLast && <ChevronRight size={12} className="text-gray-300 shrink-0" />}
          </React.Fragment>
        );
      })}
    </nav>
  );
};
