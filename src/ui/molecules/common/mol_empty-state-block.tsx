import React from "react";
import { Inbox } from "lucide-react";

export interface MolEmptyStateBlockProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
  className?: string;
}

export const MolEmptyStateBlock: React.FC<MolEmptyStateBlockProps> = ({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  compact = false,
  className = "",
}) => {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 bg-white text-center font-sans ${
        compact ? "px-4 py-6" : "px-6 py-10"
      } ${className}`}
    >
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200/80 bg-gray-50 text-gray-400">
        {icon || <Inbox size={18} />}
      </div>
      <h3 className="font-title text-sm font-semibold tracking-tight text-[#051D35]">
        {title}
      </h3>
      {description && (
        <p className="mt-1 max-w-sm text-xs leading-relaxed text-gray-500">
          {description}
        </p>
      )}
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 inline-flex items-center justify-center rounded-md bg-[#051D35] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#0a2b4a] transition-colors cursor-pointer"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
};
