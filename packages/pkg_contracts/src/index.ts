import { Tenant, SubscriptionPlan, AiUsageRecord } from "../../pkg_types/src";
import { ApiResponse } from "../../../src/core/api/api_response";

export interface TenantApiContract {
  get_tenant_by_subdomain(subdomain: string): Promise<ApiResponse<Tenant>>;
  get_tenant_details(tenant_id: string): Promise<ApiResponse<Tenant>>;
  update_tenant_branding(tenant_id: string, branding: Partial<Tenant["branding"]>): Promise<ApiResponse<Tenant>>;
}

export interface SuperAdminApiContract {
  list_all_tenants(): Promise<ApiResponse<Tenant[]>>;
  create_tenant(input: unknown): Promise<ApiResponse<Tenant>>;
  update_tenant_status(tenant_id: string, status: Tenant["status"]): Promise<ApiResponse<void>>;
  list_plans(): Promise<ApiResponse<SubscriptionPlan[]>>;
  update_plan(plan_id: string, data: Partial<SubscriptionPlan>): Promise<ApiResponse<SubscriptionPlan>>;
}

export interface AiApiContract {
  extract_property_data(url: string, tenant_id: string): Promise<ApiResponse<unknown>>;
  generate_marketing_text(property_data: unknown, tenant_id: string): Promise<ApiResponse<{ title: string; content: string }>>;
  get_tenant_ai_usage(tenant_id: string): Promise<ApiResponse<AiUsageRecord[]>>;
}
