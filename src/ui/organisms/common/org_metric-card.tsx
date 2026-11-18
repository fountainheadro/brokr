import React from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { designTokens } from "../../../../design/tokens";

export interface OrgMetricCardProps {
  label: string;
  value: string | number;
  trend?: {
    value: string;
    isPositive: boolean;
  };
  icon?: React.ReactNode;
  subtitle?: string;
  className?: string;
}

export const OrgMetricCard: React.FC<OrgMetricCardProps> = ({
  label,
  value,
  trend,
  icon,
  subtitle,
  className = "",
}) => {
  return (
    <div
      className={`bg-white border border-gray-200 p-4 shadow-2xs flex flex-col justify-between transition-all hover:border-gray-300 ${className}`}
      style={{ borderRadius: designTokens.radius.card }}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider truncate">
          {label}
        </span>
        {icon && (
          <div className="w-8 h-8 rounded-lg bg-gray-50 border border-gray-100 text-[#051D35] flex items-center justify-center shrink-0">
            {icon}
          </div>
        )}
      </div>

      <div>
        <div className="text-xl font-normal text-gray-900 font-mono tracking-tight">{value}</div>

        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {trend && (
            <span
              className={`inline-flex items-center gap-1 text-[10px] font-normal px-2 py-1 rounded border ${
                trend.isPositive
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-rose-50 text-rose-700 border-rose-200"
              }`}
            >
              {trend.isPositive ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
              {trend.value}
            </span>
          )}
          {subtitle && (
            <span className="text-[10px] text-gray-400 font-medium truncate">{subtitle}</span>
          )}
        </div>
      </div>
    </div>
  );
};
