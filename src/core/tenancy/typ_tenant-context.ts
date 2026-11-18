export type TenantMembershipStatus = "invited" | "active" | "suspended" | "revoked";

export type TenantStatus = "pending" | "trial" | "active" | "suspended" | "cancelled";

export type UserRole = "agency_owner" | "agency_admin" | "manager" | "agent" | "assistant";

export interface TenantBrandingInfo {
  agencyName: string;
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  contactEmail?: string;
  contactPhone?: string;
}

export interface TenantRecord {
  id: string;
  subdomain: string;
  customDomain?: string;
  name: string;
  status: TenantStatus;
  planId: string;
  branding: TenantBrandingInfo;
  enabledModules: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TenantMembershipRecord {
  id: string;
  tenantId: string;
  userId: string;
  email: string;
  name: string;
  role: UserRole;
  status: TenantMembershipStatus;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TenantContext {
  tenantId: string;
  tenantStatus: TenantStatus;
  tenantName: string;
  tenantDomain: string;
  userId: string;
  userEmail: string;
  membershipId: string;
  membershipStatus: TenantMembershipStatus;
  role: UserRole;
  permissions: string[];
}

export interface ResolvedTenantDomain {
  type: "public" | "platform_admin" | "agency_crm";
  tenantId?: string;
  subdomain: string | null;
  customDomain?: string;
  isCustomDomain: boolean;
  isDevSimulation?: boolean;
}

export const DEFAULT_DEV_TENANT: TenantRecord = {
  id: "ten_brokr_default",
  subdomain: "brokr",
  name: "Brokr Real Estate",
  status: "active",
  planId: "plan_enterprise",
  branding: {
    agencyName: "brokr.",
    primaryColor: "#051D35",
    accentColor: "#BE9662",
    contactEmail: "contact@brokr.ro",
  },
  enabledModules: [
    "mod_leads",
    "mod_requests",
    "mod_properties",
    "mod_matching",
    "mod_calendar",
    "mod_documents",
    "mod_ai_extraction",
    "mod_public_share",
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
