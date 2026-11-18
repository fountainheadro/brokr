import { ModuleId } from "../../../packages/pkg_types/src";

export type { ModuleId };

export type BillingInterval = "month" | "year";

export type CurrencyCode = "RON" | "EUR" | "USD";

export type PlanStatus = "active" | "inactive" | "archived";

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "suspended"
  | "cancelled"
  | "expired"
  | "incomplete";

export interface PlanQuotas {
  maxAgents: number; // -1 = unlimited
  maxProperties: number; // -1 = unlimited
  maxLeads: number; // -1 = unlimited
  monthlyAiTokens: number;
  monthlyAiRequests: number;
  storageMb: number;
}

export interface SubscriptionPlanRecord {
  id: string; // e.g. "plan_starter", "plan_professional", "plan_enterprise"
  name: string;
  displayName: string;
  description: string;
  priceMonthly: number; // in configured currency (e.g. RON)
  priceAnnual: number;
  currency: CurrencyCode;
  billingInterval: BillingInterval;
  status: PlanStatus;
  trialAvailable: boolean;
  trialDays: number;
  includedModules: ModuleId[];
  quotas: PlanQuotas;
  features: string[];
  displayOrder: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ModuleDefinition {
  id: ModuleId;
  name: string;
  description: string;
  category: "core" | "sales" | "marketing" | "ai" | "integration";
  isActive: boolean;
  canBePurchasedAsAddon: boolean;
  dependencies?: ModuleId[];
  defaultQuotaGrant?: Partial<PlanQuotas>;
}

export interface AddonDefinition {
  id: string; // e.g. "addon_extra_agents_5", "addon_ai_tokens_500k"
  name: string;
  description: string;
  priceMonthly: number;
  currency: CurrencyCode;
  isActive: boolean;
  quotaGrant: Partial<PlanQuotas>;
  includedModules?: ModuleId[];
}

export interface ActiveAddonRecord {
  addonId: string;
  quantity: number;
  activatedAt: string;
}

export interface AgencySubscriptionRecord {
  id: string; // e.g. "sub_ten_brokr_01"
  tenantId: string;
  planId: string;
  status: SubscriptionStatus;
  billingInterval: BillingInterval;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialEnd: string | null;
  cancelAtPeriodEnd: boolean;
  cancelledAt: string | null;
  suspendedAt: string | null;
  suspendedReason: string | null;
  gracePeriodEnd: string | null;
  activeAddons: ActiveAddonRecord[];
  customQuotas?: Partial<PlanQuotas>;
  customModules?: ModuleId[];
  provider: "mock" | "stripe" | "netopia";
  providerSubscriptionId: string | null;
  providerCustomerId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TenantEffectiveEntitlements {
  tenantId: string;
  subscriptionId: string;
  planId: string;
  planDisplayName: string;
  subscriptionStatus: SubscriptionStatus;
  isInGracePeriod: boolean;
  isTrial: boolean;
  daysRemainingInTrial?: number;
  billingInterval: BillingInterval;
  currentPeriodEnd: string;
  effectiveModules: ModuleId[];
  effectiveQuotas: PlanQuotas;
  currentUsage: {
    agents: number;
    properties: number;
    leads: number;
    aiTokens: number;
    aiRequests: number;
    storageMb: number;
  };
  remainingQuotas: {
    agents: number | null; // null = unlimited
    properties: number | null;
    leads: number | null;
    aiTokens: number | null;
    aiRequests: number | null;
    storageMb: number | null;
  };
  warnings: string[];
}

export type QuotaResourceType =
  | "agents"
  | "properties"
  | "leads"
  | "ai_tokens"
  | "ai_requests"
  | "storage_mb";

export interface QuotaCheckResult {
  allowed: boolean;
  resource: QuotaResourceType;
  requested: number;
  current: number;
  limit: number; // -1 = unlimited
  remaining: number;
  reason?: string;
  actionRequired?: "upgrade_plan" | "purchase_addon" | "clean_data";
}
