import React from "react";
import { WifiOff, RefreshCw, AlertTriangle, HardDrive } from "lucide-react";

export type SyncStateVariant = "online" | "offline" | "cached" | "syncing" | "error";

export interface AtmSyncStateLabelProps {
  state: SyncStateVariant;
  label?: string;
  className?: string;
}

export const AtmSyncStateLabel: React.FC<AtmSyncStateLabelProps> = ({
  state,
  label,
  className = "",
}) => {
  if (state === "online" && !label) {
    return null;
  }

  const config: Record<
    SyncStateVariant,
    { text: string; tone: string; icon: React.ReactNode }
  > = {
    online: {
      text: label || "Sincronizat",
      tone: "text-emerald-700 bg-emerald-50 border-emerald-200/80",
      icon: <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />,
    },
    offline: {
      text: label || "Mod offline (doar citire din cache local)",
      tone: "text-amber-800 bg-amber-50 border-amber-200",
      icon: <WifiOff size={12} className="text-amber-600 shrink-0" />,
    },
    cached: {
      text: label || "Date locale salvate",
      tone: "text-slate-700 bg-slate-50 border-slate-200",
      icon: <HardDrive size={12} className="text-slate-500 shrink-0" />,
    },
    syncing: {
      text: label || "Se sincronizează...",
      tone: "text-[#051D35] bg-slate-50 border-slate-200",
      icon: <RefreshCw size={12} className="text-[#BE9662] animate-spin shrink-0" />,
    },
    error: {
      text: label || "Sincronizare întreruptă",
      tone: "text-rose-700 bg-rose-50 border-rose-200",
      icon: <AlertTriangle size={12} className="text-rose-600 shrink-0" />,
    },
  };

  const active = config[state];

  return (
    <span
      role="status"
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium leading-none font-sans ${active.tone} ${className}`}
    >
      {active.icon}
      <span>{active.text}</span>
    </span>
  );
};
