import { TenantError } from "../errors/app_error";
import { ResolvedTenantDomain, TenantRecord, DEFAULT_DEV_TENANT } from "./typ_tenant-context";
export { DEFAULT_DEV_TENANT };
import { envConfig } from "../env/env_config";

let runtimePlatformRootDomain: string | null | undefined = undefined;
let runtimeAdminSubdomain: string | null = null;

export function setPlatformRootDomain(domain: string | null): void {
  runtimePlatformRootDomain = domain;
}

export function setPlatformAdminSubdomain(subdomain: string): void {
  runtimeAdminSubdomain = subdomain;
}

export const DEFAULT_PLATFORM_ROOT_DOMAIN = "highline.ro";

const MULTI_PART_PUBLIC_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "com.ro",
  "org.ro",
  "tm.ro",
  "nt.ro",
  "nom.ro",
  "info.ro",
  "rec.ro",
  "arts.ro",
  "firm.ro",
  "store.ro",
  "www.ro",
  "com.au",
  "net.au",
  "org.au",
  "co.nz",
  "co.za",
  "com.br",
  "com.mx",
  "co.jp",
  "co.kr",
  "co.in",
  "com.tr",
  "com.ua",
  "com.pl",
  "co.il",
]);

function isEphemeralOrLocalHost(host: string): boolean {
  if (!host) return true;
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local") ||
    host.endsWith(".run.app") ||
    host.endsWith(".web.app") ||
    host.endsWith(".firebaseapp.com") ||
    host.endsWith(".vercel.app") ||
    host.endsWith(".netlify.app")
  ) {
    return true;
  }
  // IPv4 or IPv6 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) {
    return true;
  }
  return false;
}

/**
 * Automatically extracts the registrable root (apex) domain from any real hostname.
 * Examples:
 * - "app.highline.ro" -> "highline.ro"
 * - "zenith.highline.ro" -> "highline.ro"
 * - "www.highline.ro" -> "highline.ro"
 * - "highline.ro" -> "highline.ro"
 * - "localhost:3000" / "*.run.app" -> null
 */
export function extractRootDomainFromHost(rawHost?: string | null): string | null {
  if (!rawHost) return null;
  const host = String(rawHost)
    .trim()
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .split(":")[0]
    .replace(/\.$/, "")
    .toLowerCase();

  if (!host || isEphemeralOrLocalHost(host)) return null;

  const parts = host.split(".").filter(Boolean);
  if (parts.length < 2) return null;
  if (parts.length === 2) return host;

  const lastTwo = parts.slice(-2).join(".");
  if (MULTI_PART_PUBLIC_SUFFIXES.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return lastTwo;
}

export function getPlatformRootDomain(): string | null {
  if (runtimePlatformRootDomain !== undefined) return runtimePlatformRootDomain;
  const configured =
    envConfig.platformRootDomain?.trim() ||
    (typeof process !== "undefined" ? process.env?.PLATFORM_ROOT_DOMAIN?.trim() : undefined);
  return configured || DEFAULT_PLATFORM_ROOT_DOMAIN;
}

/**
 * Resolves the effective CRM main (root) domain for link generation & routing.
 * Prefers explicit platform configuration, then automatically detects the apex domain
 * from the active request host (ignoring third-party agency custom domains and dev hosts),
 * falling back to DEFAULT_PLATFORM_ROOT_DOMAIN ("highline.ro").
 */
export function resolveEffectiveRootDomain(rawHost?: string | null): string {
  if (runtimePlatformRootDomain && runtimePlatformRootDomain.trim()) {
    return runtimePlatformRootDomain.trim().toLowerCase();
  }

  const envExplicit =
    typeof process !== "undefined" ? process.env?.PLATFORM_ROOT_DOMAIN?.trim().toLowerCase() : "";

  const normalizedHost = rawHost ? TenantResolutionService.normalizeHost(rawHost) : "";
  if (normalizedHost && !isEphemeralOrLocalHost(normalizedHost)) {
    const customTenantId = CUSTOM_DOMAINS.get(normalizedHost);
    const extracted = extractRootDomainFromHost(normalizedHost);
    // If host is a third-party agency custom domain (not matching envExplicit/default), keep platform root domain
    if (customTenantId && extracted) {
      const baseline = envExplicit || DEFAULT_PLATFORM_ROOT_DOMAIN;
      if (extracted === baseline) {
        return extracted;
      }
      if (!envExplicit) {
        return baseline;
      }
    } else if (extracted) {
      return envExplicit && extracted !== envExplicit ? envExplicit : extracted;
    }
  }

  return envExplicit || getPlatformRootDomain() || DEFAULT_PLATFORM_ROOT_DOMAIN;
}

export function getPlatformAdminSubdomain(): string {
  if (runtimeAdminSubdomain) return runtimeAdminSubdomain;
  return (
    envConfig.platformAdminSubdomain ||
    (typeof process !== "undefined" ? process.env?.PLATFORM_ADMIN_SUBDOMAIN : undefined) ||
    "admin"
  );
}

const KNOWN_TENANTS = new Map<string, TenantRecord>([
  [DEFAULT_DEV_TENANT.id, DEFAULT_DEV_TENANT],
  [
    "ten_agency_a",
    {
      id: "ten_agency_a",
      subdomain: "agency-a",
      name: "Agency Alpha",
      status: "active",
      planId: "plan_professional",
      branding: { agencyName: "Agency Alpha", primaryColor: "#1e3a8a", accentColor: "#3b82f6" },
      enabledModules: ["mod_leads", "mod_properties"],
      createdAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
    },
  ],
  [
    "ten_agency_b",
    {
      id: "ten_agency_b",
      subdomain: "agency-b",
      name: "Agency Beta",
      status: "active",
      planId: "plan_starter",
      branding: { agencyName: "Agency Beta", primaryColor: "#065f46", accentColor: "#10b981" },
      enabledModules: ["mod_leads"],
      createdAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
    },
  ],
  [
    "ten_suspended_agency",
    {
      id: "ten_suspended_agency",
      subdomain: "suspended-agency",
      name: "Suspended Agency SRL",
      status: "suspended",
      planId: "plan_starter",
      branding: { agencyName: "Suspended Agency", primaryColor: "#4b5563" },
      enabledModules: [],
      createdAt: "2026-01-15T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    },
  ],
  [
    "ten_agency_zenith",
    {
      id: "ten_agency_zenith",
      subdomain: "zenith",
      name: "Zenith Luxury Estates",
      status: "active",
      planId: "plan_scale",
      branding: { agencyName: "Zenith Luxury Estates", primaryColor: "#7c2d12", accentColor: "#f59e0b" },
      enabledModules: ["mod_leads", "mod_requests", "mod_properties", "mod_matching", "mod_ai_extraction", "mod_documents"],
      createdAt: "2026-02-10T00:00:00.000Z",
      updatedAt: "2026-02-10T00:00:00.000Z",
    },
  ],
  [
    "ten_agency_nordic",
    {
      id: "ten_agency_nordic",
      subdomain: "nordic",
      name: "Nordic Real Estate Hub",
      status: "trial",
      planId: "plan_professional",
      branding: { agencyName: "Nordic Real Estate", primaryColor: "#0f766e", accentColor: "#14b8a6" },
      enabledModules: ["mod_leads", "mod_properties", "mod_calendar"],
      createdAt: "2026-02-18T00:00:00.000Z",
      updatedAt: "2026-02-18T00:00:00.000Z",
    },
  ],
]);

const CUSTOM_DOMAINS = new Map<string, string>([
  ["agency.highline.ro", DEFAULT_DEV_TENANT.id],
  ["app.highline.ro", DEFAULT_DEV_TENANT.id],
  ["crm.brokr.ro", DEFAULT_DEV_TENANT.id],
  ["crm.agency-alpha.ro", "ten_agency_a"],
  ["crm.agency-beta.ro", "ten_agency_b"],
  ["crm.suspended-agency.ro", "ten_suspended_agency"],
  ["crm.zenith-estates.ro", "ten_agency_zenith"],
  ["crm.nordic-hub.ro", "ten_agency_nordic"],
]);

export class TenantResolutionService {
  public static normalizeHost(host: string): string {
    if (!host) return "";
    return host.split(":")[0].replace(/\.$/, "").trim().toLowerCase();
  }

  public static resolveDomain(
    rawHost: string,
    devSimulationOverride?: string | null,
    isProductionEnv = process.env.NODE_ENV === "production"
  ): ResolvedTenantDomain {
    const host = this.normalizeHost(rawHost);

    const isDevHost =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.endsWith(".run.app") ||
      host.endsWith(".local");

    if (isDevHost && !isProductionEnv) {
      if (devSimulationOverride) {
        const simHost = this.normalizeHost(devSimulationOverride);
        return {
          ...this.resolveProductionDomain(simHost),
          isDevSimulation: true,
        };
      }

      return {
        type: "agency_crm",
        tenantId: DEFAULT_DEV_TENANT.id,
        subdomain: DEFAULT_DEV_TENANT.subdomain,
        isCustomDomain: false,
        isDevSimulation: true,
      };
    }

    return this.resolveProductionDomain(host);
  }

  private static resolveProductionDomain(host: string): ResolvedTenantDomain {
    const rootDomain = getPlatformRootDomain();
    const adminSubdomain = getPlatformAdminSubdomain();

    if (rootDomain && (host === rootDomain || host === `www.${rootDomain}`)) {
      return {
        type: "public",
        subdomain: null,
        isCustomDomain: false,
      };
    }

    if (rootDomain && host === `${adminSubdomain}.${rootDomain}`) {
      return {
        type: "platform_admin",
        subdomain: adminSubdomain,
        isCustomDomain: false,
      };
    }

    if (rootDomain && host.endsWith(`.${rootDomain}`)) {
      const subdomain = host.replace(`.${rootDomain}`, "");
      const tenant = this.findTenantBySubdomain(subdomain);
      if (tenant) {
        return {
          type: "agency_crm",
          tenantId: tenant.id,
          subdomain,
          isCustomDomain: false,
        };
      }

      const customUnderRootTenantId = CUSTOM_DOMAINS.get(host);
      if (customUnderRootTenantId) {
        const customTenant = KNOWN_TENANTS.get(customUnderRootTenantId);
        if (customTenant) {
          return {
            type: "agency_crm",
            tenantId: customTenant.id,
            subdomain: customTenant.subdomain,
            customDomain: host,
            isCustomDomain: true,
          };
        }
      }

      throw new TenantError(`Domeniul de agenție "${host}" nu a fost găsit.`, "TENANT_NOT_FOUND");
    }

    const customTenantId = CUSTOM_DOMAINS.get(host);
    if (customTenantId) {
      const tenant = KNOWN_TENANTS.get(customTenantId);
      if (!tenant) {
        throw new TenantError(`Domeniul personalizat "${host}" nu este asociat unei agenții active.`, "TENANT_NOT_FOUND");
      }
      return {
        type: "agency_crm",
        tenantId: tenant.id,
        subdomain: tenant.subdomain,
        customDomain: host,
        isCustomDomain: true,
      };
    }

    const directTenant = this.findTenantBySubdomain(host);
    if (directTenant) {
      return {
        type: "agency_crm",
        tenantId: directTenant.id,
        subdomain: directTenant.subdomain,
        isCustomDomain: false,
      };
    }

    throw new TenantError(
      `Domeniul "${host}" nu este recunoscut sau configurat în platformă.`,
      "TENANT_NOT_FOUND"
    );
  }

  public static getTenantById(tenantId: string): TenantRecord | null {
    return KNOWN_TENANTS.get(tenantId) || null;
  }

  public static findTenantBySubdomain(subdomain: string): TenantRecord | null {
    const clean = subdomain.trim().toLowerCase();
    for (const tenant of KNOWN_TENANTS.values()) {
      if (tenant.subdomain.toLowerCase() === clean) {
        return tenant;
      }
    }
    if (clean === "brokr") {
      return KNOWN_TENANTS.get(DEFAULT_DEV_TENANT.id) || null;
    }
    return null;
  }

  public static registerTenant(tenant: TenantRecord, customDomain?: string): void {
    KNOWN_TENANTS.set(tenant.id, tenant);
    if (customDomain) {
      CUSTOM_DOMAINS.set(this.normalizeHost(customDomain), tenant.id);
    }
  }

  public static getAllTenants(): TenantRecord[] {
    return Array.from(KNOWN_TENANTS.values());
  }
}
