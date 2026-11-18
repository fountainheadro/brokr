import React from "react";
import { AtmBadge } from "../common/atm_badge";

export type PlatformTenantStatus = "active" | "trial" | "suspended" | "pending_payment";

export interface AtmPlatformBadgeProps {
  status: PlatformTenantStatus;
  className?: string;
}

export const AtmPlatformBadge: React.FC<AtmPlatformBadgeProps> = ({ status, className = "" }) => {
  const statusConfig: Record<PlatformTenantStatus, { label: string; variant: "success" | "warning" | "danger" | "default" }> = {
    active: { label: "Activ", variant: "success" },
    trial: { label: "Trial 14z", variant: "warning" },
    suspended: { label: "Suspendat", variant: "danger" },
    pending_payment: { label: "Plată În Așteptare", variant: "default" },
  };

  const config = statusConfig[status] || { label: status, variant: "default" };

  return (
    <AtmBadge variant={config.variant} size="sm" pill className={className}>
      {config.label}
    </AtmBadge>
  );
};
