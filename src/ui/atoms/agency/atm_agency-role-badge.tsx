import React from "react";
import { AtmBadge } from "../common/atm_badge";

export type AgencyRoleType = "Proprietar" | "Chirias" | "Cumparator" | "Agent" | "Manager";

export interface AtmAgencyRoleBadgeProps {
  role: AgencyRoleType | string;
  className?: string;
}

export const AtmAgencyRoleBadge: React.FC<AtmAgencyRoleBadgeProps> = ({ role, className = "" }) => {
  const normalized = String(role || "").toLowerCase();

  let variant: "brand" | "success" | "info" | "warning" | "default" = "default";
  let label = role;

  if (normalized.includes("proprietar") || normalized.includes("owner")) {
    variant = "brand";
    label = "Proprietar";
  } else if (normalized.includes("chiri") || normalized.includes("renter")) {
    variant = "success";
    label = "Chiriaș";
  } else if (normalized.includes("cump") || normalized.includes("buyer")) {
    variant = "info";
    label = "Cumpărător";
  } else if (normalized.includes("agent") || normalized.includes("broker")) {
    variant = "warning";
    label = "Agent";
  }

  return (
    <AtmBadge variant={variant} size="sm" className={className}>
      {label}
    </AtmBadge>
  );
};
