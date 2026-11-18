import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { AtmButton } from "../../atoms/common/atm_button";
import { designTokens } from "../../../../design/tokens";

export interface MolErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  className?: string;
}

export const MolErrorState: React.FC<MolErrorStateProps> = ({
  title = "A apărut o problemă",
  message,
  onRetry,
  className = "",
}) => {
  return (
    <div
      className={`p-5 bg-rose-50/50 border border-rose-200 text-left flex items-start gap-4 ${className}`}
      style={{ borderRadius: designTokens.radius.card }}
    >
      <div className="w-8 h-8 rounded-lg bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
        <AlertTriangle size={16} />
      </div>

      <div className="flex-1 min-w-0">
        <h4 className="font-title text-xs font-semibold text-rose-900 tracking-tight">{title}</h4>
        <p className="text-[11px] text-rose-700 mt-1 leading-normal font-normal">{message}</p>

        {onRetry && (
          <div className="mt-3">
            <AtmButton
              variant="danger"
              size="sm"
              onClick={onRetry}
              leftIcon={<RefreshCw size={11} />}
            >
              Încearcă din nou
            </AtmButton>
          </div>
        )}
      </div>
    </div>
  );
};
