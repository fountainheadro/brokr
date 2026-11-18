import React from "react";
import { AlertCircle } from "lucide-react";
import { AtmButton } from "../../atoms/common/atm_button";

export interface MolConfirmationDialogProps {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  className?: string;
}

export const MolConfirmationDialog: React.FC<MolConfirmationDialogProps> = ({
  title,
  description,
  confirmLabel = "Confirmă",
  cancelLabel = "Anulează",
  isDestructive = false,
  isLoading = false,
  onConfirm,
  onCancel,
  className = "",
}) => {
  return (
    <div className={`space-y-4 ${className}`}>
      <div className="flex items-start gap-4">
        <div
          className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
            isDestructive ? "bg-rose-100 text-rose-600" : "bg-amber-100 text-amber-700"
          }`}
        >
          <AlertCircle size={18} />
        </div>
        <div>
          <h3 className="font-title text-sm font-semibold text-gray-900 leading-snug">{title}</h3>
          <p className="text-xs text-gray-500 mt-1 leading-relaxed">{description}</p>
        </div>
      </div>

      <div className="flex items-center justify-end gap-4 pt-2 border-t border-gray-100">
        <AtmButton variant="secondary" size="md" onClick={onCancel} disabled={isLoading}>
          {cancelLabel}
        </AtmButton>
        <AtmButton
          variant={isDestructive ? "danger" : "primary"}
          size="md"
          isLoading={isLoading}
          onClick={onConfirm}
        >
          {confirmLabel}
        </AtmButton>
      </div>
    </div>
  );
};
