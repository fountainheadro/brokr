export type TenantStatus = "active" | "suspended" | "trial" | "pending_payment" | "cancelled";

export type ModuleId =
  | "mod_leads"
  | "mod_requests"
  | "mod_properties"
  | "mod_matching"
  | "mod_calendar"
  | "mod_documents"
  | "mod_ai_extraction"
  | "mod_ai_voice"
  | "mod_public_share";

export interface TenantBranding {
  agency_name: string;
  logo_url?: string;
  primary_color?: string;
  accent_color?: string;
  contact_email?: string;
  contact_phone?: string;
}

export interface TenantSubscriptionQuotas {
  max_agents: number;
  max_listings: number;
  monthly_ai_token_allowance: number;
  used_ai_tokens_current_month: number;
  storage_mb_limit: number;
}

export interface Tenant {
  id: string; // e.g. "ten_zenith_8832"
  subdomain: string; // e.g. "zenith"
  custom_domain?: string;
  status: TenantStatus;
  plan_id: string;
  branding: TenantBranding;
  enabled_modules: ModuleId[];
  quotas: TenantSubscriptionQuotas;
  created_at: string;
  updated_at: string;
}

export type UserRole = "agency_owner" | "agency_admin" | "manager" | "agent" | "assistant";

export interface TenantUser {
  id: string;
  tenant_id: string;
  email: string;
  name: string;
  role: UserRole;
  is_active: boolean;
  phone?: string;
  permissions?: string[];
  created_at: string;
  updated_at: string;
}

export interface SubscriptionPlan {
  id: string;
  name: string; // e.g. "Starter", "Professional", "Enterprise"
  price_monthly: number; // EUR
  currency: string;
  max_agents: number;
  max_listings: number;
  ai_token_allowance: number;
  storage_mb: number;
  included_modules: ModuleId[];
  is_active: boolean;
}

export interface AiUsageRecord {
  id: string;
  tenant_id: string;
  user_id: string;
  operation_type: "listing_extraction" | "description_generation" | "voice_stream" | "watermark_detection";
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_cost_eur: number;
  timestamp: string;
}

export interface CrmImageItem {
  original: string;
}

export interface CrmData {
  general_details: {
    stage: string;
    transaction_type: string;
    category: string;
    owner: string;
    additional_contacts: string;
    residential_complex: string;
    location: {
      city: string;
      zone: string[];
      street: string;
      street_number: string;
      building: string;
      staircase: string;
      apartment_number: string;
      points_of_interest: string[];
      surroundings: string[];
    };
    private_memo: string;
  };
  features: {
    details: {
      house_type: string;
      apartment_type: string;
      partitioning: string;
      comfort: string;
      destination: string;
      rooms: string;
      kitchens: string;
      bedrooms: string;
      bathrooms: string;
      balconies: string;
      terraces: string;
      floor: string;
      orientation: string;
      parking_spaces: string;
      garages: string;
      checklist: string[];
    };
    areas: {
      usable: string;
      footprint: string;
      built: string;
      total_usable: string;
      balconies: string;
      terraces: string;
      garden: string;
      land: string;
      free_land: string;
      street_frontage: string;
      shop_window: string;
      frontages_count: string;
      terraces_count: string;
      balconies_count: string;
    };
    other_details: {
      construction_stage: string;
      structure: string;
      building_type: string;
      seismic_risk: string;
      construction_year: string;
      renovation_year: string;
      height: string;
      construction_levels?: string;
    };
    energy: {
      energy_class: string;
      annual_consumption: string;
      co2_emissions: string;
      renewable_consumption: string;
    };
  };
  utilities: {
    general: string[];
    heating_system: string[];
    climate_control: string[];
    finishes: {
      condition: string[];
      insulation: string[];
      walls: string[];
      floors: string[];
      windows: string[];
      blinds: string[];
      shutters: string[];
      entrance_door: string[];
      interior_doors: string[];
      roof: string[];
      lighting?: string[];
    };
    amenities: {
      furnished: string;
      additional_spaces: string[];
      kitchen: string[];
      metering: string[];
      appliances: string[];
      building: string[];
      misc: string[];
      services: string[];
      street_layout: string[];
      view: string[];
    };
  };
  pricing: {
    details: {
      price: string;
      currency: string;
      price_per_sqm: string;
      last_price: string;
      checklist: string[];
      accepted_payment: string;
      garage_price: string;
      parking_price: string;
      advance_payment: string;
      deposit: string;
      vat_included: boolean;
      private_notes: string;
    };
    commissions: {
      buyer_commission_percent: string;
      buyer_commission_value: string;
      owner_commission_percent: string;
      owner_commission_value: string;
      collaboration: boolean;
    };
    contract: {
      type: string;
      signed: string;
      number: string;
      signed_date: string;
      expiry_date: string;
    };
  };
  description: {
    title: string;
    content: string;
    availability: string;
    video_url: string;
    virtual_tour_url: string;
  };
  images: {
    living: CrmImageItem[];
    kitchen: CrmImageItem[];
    bedroom: CrmImageItem[];
    bathroom: CrmImageItem[];
    other_spaces: CrmImageItem[];
  };
}

export interface ExtractionResult {
  crm_data: CrmData;
  markdown_marketing: string;
  summary: string;
  presentation_sections?: Record<string, Record<string, string>> | null;
  original_description?: string;
  text?: string;
}
