import React from "react";
import { AtmButton } from "../../atoms/common/atm_button";
import { designTokens } from "../../../../design/tokens";

export interface MolEmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export const MolEmptyState: React.FC<MolEmptyStateProps> = ({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  className = "",
}) => {
  return (
    <div
      className={`flex flex-col items-center justify-center p-8 text-center bg-white border border-gray-100 ${className}`}
      style={{ borderRadius: designTokens.radius.card }}
    >
      {icon && (
        <div className="w-12 h-12 rounded-xl bg-gray-50 border border-gray-200/80 text-gray-400 flex items-center justify-center mb-4 shadow-2xs">
          {icon}
        </div>
      )}
      <h3 className="font-title text-sm font-semibold text-gray-900 tracking-tight">{title}</h3>
      {description && (
        <p className="text-xs text-gray-500 max-w-sm mt-1 mb-4 leading-relaxed font-normal">
          {description}
        </p>
      )}
      {actionLabel && onAction && (
        <AtmButton variant="primary" size="md" onClick={onAction}>
          {actionLabel}
        </AtmButton>
      )}
    </div>
  );
};
