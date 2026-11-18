import { UserRole } from "./typ_tenant-context";

export interface PreviewSessionRecord {
  token: string;
  tenantId: string;
  tenantName: string;
  subdomain: string;
  simulatedRole: UserRole;
  superAdminUid: string;
  superAdminEmail: string;
  effectivePermissions: string[];
  effectiveModules: string[];
  createdAt: string;
  expiresAt: string;
  lastActiveAt: string;
  environment: "development" | "staging" | "production";
}

export interface StartPreviewRequest {
  tenantId: string;
  simulatedRole?: UserRole;
  environment?: "development" | "staging" | "production";
}

export interface SwitchRoleRequest {
  previewToken: string;
  newRole: UserRole;
}

export interface PreviewStatusResponse {
  isActive: boolean;
  session?: {
    token: string;
    tenantId: string;
    tenantName: string;
    subdomain: string;
    simulatedRole: UserRole;
    superAdminEmail: string;
    effectivePermissions: string[];
    effectiveModules: string[];
    expiresAt: string;
  };
}
