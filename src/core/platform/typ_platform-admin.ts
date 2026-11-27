export type PlatformAdminRole = "super_admin" | "support_admin" | "compliance_officer";

export interface PlatformAdminUser {
  id: string; // e.g. "padm_1"
  userId: string; // Firebase UID
  email: string;
  name: string;
  role: PlatformAdminRole;
  isActive: boolean;
  createdAt: string;
  lastLoginAt?: string;
}

export type AuditActionType =
  | "agency_suspended"
  | "agency_reactivated"
  | "agency_note_added"
  | "platform_settings_updated"
  | "platform_automation_default_updated"
  | "platform_automation_default_reset"
  | "platform_admin_added"
  | "domain_mapping_updated"
  | "platform_plan_created"
  | "platform_plan_updated"
  | "platform_plan_status_changed"
  | "platform_module_updated"
  | "billing_webhook_processed"
  | "agency_plan_changed"
  | "agency_trial_started"
  | "agency_subscription_status_updated"
  | "agency_addon_added"
  | "agency_addon_removed"
  | "AGENCY_PREVIEW_START"
  | "AGENCY_PREVIEW_ROLE_SWITCH"
  | "AGENCY_PREVIEW_EXIT"
  | "CRM_DATA_MIGRATION_DRY_RUN"
  | "CRM_DATA_MIGRATION_EXECUTE"
  | "outbox_dead_letter_replayed"
  | "telemetry_rollup_flushed";

export interface PlatformAuditLogEntry {
  id: string;
  actorUserId?: string;
  actorEmail?: string;
  actorRole?: string;
  actorId?: string;
  action: AuditActionType;
  targetType:
    | "agency"
    | "user"
    | "domain"
    | "settings"
    | "plan"
    | "module"
    | "billing"
    | "migration"
    | "outbox"
    | "telemetry";
  targetId: string;
  targetName?: string;
  tenantId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  result?: "success" | "failure";
  timestamp: string;
}

export interface PlatformGlobalStats {
  totalAgencies: number;
  activeAgencies: number;
  trialAgencies: number;
  suspendedAgencies: number;
  cancelledAgencies: number;
  totalUsers: number;
  activeUsers: number;
  totalStorageMb: number;
  totalAiTokensUsed: number;
  totalAiRequests: number;
  estimatedAiCostEur: number;
  recentActivityCount: number;
  provenance?: string;
  provenanceLabel?: string;
}

export interface PlatformSettingsRecord {
  id: string;
  platformName: string;
  supportEmail: string;
  maintenanceMode: boolean;
  allowPublicRegistration: boolean;
  defaultTrialDurationDays: number;
  configuredRootDomain: string | null;
  adminSubdomain: string;
  enforceMfaForAdmins: boolean;
  updatedAt: string;
  updatedBy: string;
}
