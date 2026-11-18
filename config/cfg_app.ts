export const APP_CONFIG = {
  platform_name: "OurCRM Real Estate SaaS",
  domain: {
    base_domain: "ourcrm.com",
    super_admin_subdomain: "admin",
    reserved_subdomains: ["admin", "api", "app", "www", "mail", "cdn", "staging", "auth"],
  },
  plans: {
    default_trial_days: 14,
    currency: "EUR",
  },
  ai: {
    default_monthly_token_allowance: 250_000,
    model_primary: "gemini-3.1-flash-lite",
    model_complex: "gemini-2.5-flash",
  },
} as const;
