import React from "react";
import { AlertTriangle, RefreshCw, WifiOff } from "lucide-react";

export interface MolErrorRecoveryBannerProps {
  variant?: "offline" | "error";
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export const MolErrorRecoveryBanner: React.FC<MolErrorRecoveryBannerProps> = ({
  variant = "error",
  title,
  message,
  onRetry,
  retryLabel = "Reîncearcă",
  className = "",
}) => {
  const isOffline = variant === "offline";
  const resolvedTitle =
    title || (isOffline ? "Conexiune întreruptă — mod offline" : "Sincronizare întreruptă");

  return (
    <div
      role="alert"
      className={`flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2 text-xs font-sans ${
        isOffline
          ? "border-amber-200 bg-amber-50 text-amber-950"
          : "border-rose-200 bg-rose-50 text-rose-950"
      } ${className}`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        {isOffline ? (
          <WifiOff size={14} className="shrink-0 text-amber-700" />
        ) : (
          <AlertTriangle size={14} className="shrink-0 text-rose-600" />
        )}
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0">
          <span className="font-semibold">{resolvedTitle}:</span>
          <span className={isOffline ? "text-amber-800" : "text-rose-800"}>{message}</span>
        </div>
      </div>

      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer shrink-0 ${
            isOffline
              ? "border-amber-300 bg-white text-amber-900 hover:bg-amber-100/60"
              : "border-rose-300 bg-white text-rose-800 hover:bg-rose-100/60"
          }`}
        >
          <RefreshCw size={11} />
          <span>{retryLabel}</span>
        </button>
      )}
    </div>
  );
};
