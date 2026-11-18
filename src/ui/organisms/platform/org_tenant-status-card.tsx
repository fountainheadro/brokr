import React from "react";
import { Building2, Users, HardDrive, Cpu, ExternalLink } from "lucide-react";
import { AtmPlatformBadge, PlatformTenantStatus } from "../../atoms/platform/atm_platform-badge";
import { AtmProgressBar } from "../../atoms/common/atm_progress-bar";
import { designTokens } from "../../../../design/tokens";

export interface OrgTenantStatusCardProps {
  agencyName: string;
  subdomain: string;
  status: PlatformTenantStatus;
  planName: string;
  agentsCount: number;
  maxAgents: number;
  aiTokensUsed: number;
  aiTokensLimit: number;
  storageMbUsed: number;
  storageMbLimit: number;
  onManageClick?: () => void;
  className?: string;
}

export const OrgTenantStatusCard: React.FC<OrgTenantStatusCardProps> = ({
  agencyName,
  subdomain,
  status,
  planName,
  agentsCount,
  maxAgents,
  aiTokensUsed,
  aiTokensLimit,
  storageMbUsed,
  storageMbLimit,
  onManageClick,
  className = "",
}) => {
  return (
    <div
      className={`bg-white border border-gray-200 p-4 shadow-2xs hover:border-indigo-300 transition-all ${className}`}
      style={{ borderRadius: designTokens.radius.card }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4 pb-3 border-b border-gray-100">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0">
            <Building2 size={16} />
          </div>
          <div className="min-w-0">
            <h4 className="font-title text-xs font-semibold text-gray-900 truncate tracking-tight">{agencyName}</h4>
            <p className="text-[10px] text-gray-400 font-mono font-normal truncate">{subdomain}.ourcrm.com</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] font-normal text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-1 rounded">
            {planName}
          </span>
          <AtmPlatformBadge status={status} />
        </div>
      </div>

      {/* Quotas & Usage Metrics */}
      <div className="py-3 space-y-3 text-xs">
        {/* Agents */}
        <div>
          <div className="flex items-center justify-between text-[11px] mb-1 text-gray-600">
            <span className="flex items-center gap-1 font-semibold">
              <Users size={12} className="text-gray-400" />
              <span>Agenți activi</span>
            </span>
            <span className="font-mono font-normal">
              {agentsCount} / {maxAgents}
            </span>
          </div>
          <AtmProgressBar value={agentsCount} max={maxAgents} size="sm" variant="brand" />
        </div>

        {/* AI Tokens */}
        <div>
          <div className="flex items-center justify-between text-[11px] mb-1 text-gray-600">
            <span className="flex items-center gap-1 font-semibold">
              <Cpu size={12} className="text-gray-400" />
              <span>Tokeni AI lunari</span>
            </span>
            <span className="font-mono font-normal">
              {Math.round(aiTokensUsed / 1000)}k / {Math.round(aiTokensLimit / 1000)}k
            </span>
          </div>
          <AtmProgressBar
            value={aiTokensUsed}
            max={aiTokensLimit}
            size="sm"
            variant={aiTokensUsed / aiTokensLimit > 0.85 ? "danger" : "accent"}
          />
        </div>

        {/* Storage */}
        <div>
          <div className="flex items-center justify-between text-[11px] mb-1 text-gray-600">
            <span className="flex items-center gap-1 font-semibold">
              <HardDrive size={12} className="text-gray-400" />
              <span>Stocare documente</span>
            </span>
            <span className="font-mono font-normal">
              {storageMbUsed} MB / {storageMbLimit} MB
            </span>
          </div>
          <AtmProgressBar value={storageMbUsed} max={storageMbLimit} size="sm" variant="success" />
        </div>
      </div>

      {/* Footer Action */}
      {onManageClick && (
        <div className="pt-3 border-t border-gray-100 flex justify-end">
          <button
            type="button"
            onClick={onManageClick}
            className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 transition-colors cursor-pointer"
          >
            <span>Gestionează agenția</span>
            <ExternalLink size={11} />
          </button>
        </div>
      )}
    </div>
  );
};
