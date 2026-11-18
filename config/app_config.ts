export const APP_CONFIG = {
  platformName: "OurCRM Real Estate SaaS",
  domain: {
    baseDomain: "ourcrm.com",
    superAdminSubdomain: "admin",
    reservedSubdomains: ["admin", "api", "app", "www", "mail", "cdn", "staging", "auth"],
  },
  plans: {
    defaultTrialDays: 14,
    currency: "EUR",
  },
  ai: {
    defaultMonthlyTokenAllowance: 250_000,
    modelPrimary: "gemini-3.1-flash-lite",
    modelComplex: "gemini-4-hydrogen",
  },
} as const;
