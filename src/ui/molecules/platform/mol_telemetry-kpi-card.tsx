import React from "react";

export interface TelemetryKpiCardProps {
  label: string;
  value: string;
  subtext?: string;
  provenanceLabel: string;
  tone?: "default" | "success" | "warning" | "danger";
}

const VALUE_TONE_CLASSES: Record<NonNullable<TelemetryKpiCardProps["tone"]>, string> = {
  default: "text-[#051D35]",
  success: "text-emerald-700",
  warning: "text-amber-700",
  danger: "text-rose-700",
};

/**
 * Single-elevation telemetry KPI card with JetBrains Mono tabular numerals
 * and an unboxed provenance metadata footer (`Core API · Measured`, etc.).
 */
export const MolTelemetryKpiCard: React.FC<TelemetryKpiCardProps> = ({
  label,
  value,
  subtext,
  provenanceLabel,
  tone = "default",
}) => {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col justify-between min-h-[112px]">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
          {label}
        </span>
      </div>

      <div className="mt-2">
        <p className={`text-2xl font-medium font-mono tabular-nums tracking-tight ${VALUE_TONE_CLASSES[tone]}`}>
          {value}
        </p>
        {subtext && (
          <p className="text-xs text-slate-500 mt-1 font-mono tabular-nums truncate" title={subtext}>
            {subtext}
          </p>
        )}
      </div>

      <div className="mt-3 pt-2 border-t border-slate-100 text-[11px] text-slate-400 font-normal">
        {provenanceLabel}
      </div>
    </div>
  );
};
