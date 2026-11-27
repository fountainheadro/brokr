import React from "react";
import { AlertCircle, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { PortalValidationIssue } from "../../../core/portals/typ_portal-provider";

export interface MolPortalValidationChecklistProps {
  issues: PortalValidationIssue[];
  providerName?: string;
  compact?: boolean;
  className?: string;
}

export const MolPortalValidationChecklist: React.FC<MolPortalValidationChecklistProps> = ({
  issues,
  providerName,
  compact = false,
  className = "",
}) => {
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  if (errors.length === 0 && warnings.length === 0) {
    return (
      <div
        className={`flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-800 ${className}`}
      >
        <CheckCircle2 size={14} className="shrink-0 text-emerald-600" />
        <span>
          Proprietatea îndeplinește toate cerințele obligatorii
          {providerName ? ` pentru ${providerName}` : ""}.
        </span>
      </div>
    );
  }

  return (
    <div className={`space-y-1.5 ${className}`}>
      {errors.map((issue) => (
        <div
          key={`${issue.field}:${issue.code}`}
          className={`flex items-start gap-2 rounded-lg border border-red-200 bg-red-50/70 ${
            compact ? "px-2.5 py-1.5" : "px-3 py-2"
          } text-xs text-red-800`}
        >
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-600" />
          <div className="min-w-0">
            <p className="font-medium leading-snug">{issue.message}</p>
            {!compact && (
              <p className="mt-0.5 font-mono text-[10px] text-red-700/80">
                {issue.field} · {issue.code}
              </p>
            )}
          </div>
        </div>
      ))}

      {warnings.map((issue) => (
        <div
          key={`${issue.field}:${issue.code}`}
          className={`flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/70 ${
            compact ? "px-2.5 py-1.5" : "px-3 py-2"
          } text-xs text-amber-800`}
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" />
          <div className="min-w-0">
            <p className="leading-snug">{issue.message}</p>
          </div>
        </div>
      ))}
    </div>
  );
};
