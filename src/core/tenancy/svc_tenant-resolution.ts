import { TenantError } from "../errors/app_error";
import { ResolvedTenantDomain, TenantRecord, DEFAULT_DEV_TENANT } from "./typ_tenant-context";
export { DEFAULT_DEV_TENANT };
import { envConfig } from "../env/env_config";
import { PersistentStoreService } from "../database/svc_persistent-store";
import { GcpAuthService } from "../gcp/svc_gcp-auth";
import { PlatformAdminService } from "../platform/svc_platform-admin";

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
    const prev = KNOWN_TENANTS.get(tenant.id);
    const statusChangedToRestricted =
      prev &&
      prev.status !== tenant.status &&
      (tenant.status === "suspended" || tenant.status === "cancelled" || prev.status === "suspended" || prev.status === "cancelled");
    const nextAuthVersion =
      typeof tenant.authVersion === "number" && (!prev || tenant.authVersion > (prev.authVersion ?? 1))
        ? tenant.authVersion
        : statusChangedToRestricted
          ? (prev.authVersion ?? 1) + 1
          : (tenant.authVersion ?? prev?.authVersion ?? 1);

    const record: TenantRecord = customDomain
      ? { ...tenant, authVersion: nextAuthVersion, customDomain: this.normalizeHost(customDomain) }
      : { ...tenant, authVersion: nextAuthVersion };
    KNOWN_TENANTS.set(record.id, record);
    if (record.customDomain) {
      CUSTOM_DOMAINS.set(this.normalizeHost(record.customDomain), record.id);
    }
  }

  public static async bumpTenantAuthVersion(tenantId: string): Promise<number> {
    const existing = KNOWN_TENANTS.get(tenantId);
    if (!existing) return 1;
    const nextVersion = (existing.authVersion ?? 1) + 1;
    const updated: TenantRecord = {
      ...existing,
      authVersion: nextVersion,
      updatedAt: new Date().toISOString(),
    };
    await this.saveTenantAsync(updated, updated.customDomain);
    return nextVersion;
  }

  private static lastHydratedAt = 0;
  private static lastHydrateFailureAt = 0;
  private static singleTenantHydratedAt = new Map<string, number>();
  private static ensuredTenants = new Set<string>();

  private static canListAllTenantsInCurrentContext(): boolean {
    if (GcpAuthService.isAnyServerAuthConfigured()) {
      return true;
    }
    const reqAuth = PersistentStoreService.getRequestAuth();
    if (!reqAuth || reqAuth.emailVerified === false) {
      return false;
    }
    return PlatformAdminService.isPlatformAdmin(reqAuth.uid, reqAuth.email);
  }

  /**
   * O(1) single-tenant hydration (`/tenants/{tenantId}`) for agency-scoped requests.
   * Avoids scanning the global `/tenants` collection (which requires Platform Admin privileges).
   */
  public static async hydrateSingleTenantFromFirestore(
    tenantId: string,
    ttlMs = 60_000
  ): Promise<TenantRecord | null> {
    if (!tenantId) return null;
    if (process.env.NODE_ENV === "test") {
      return this.getTenantById(tenantId);
    }
    if (!PersistentStoreService.isRemoteFirestoreConfigured()) {
      return this.getTenantById(tenantId);
    }

    const lastAt = this.singleTenantHydratedAt.get(tenantId) || 0;
    if (Date.now() - lastAt < ttlMs) {
      return this.getTenantById(tenantId);
    }

    return PersistentStoreService.withKeyMutex(`hydrate::tenant::${tenantId}`, async () => {
      const refreshedAt = this.singleTenantHydratedAt.get(tenantId) || 0;
      if (Date.now() - refreshedAt < ttlMs) {
        return this.getTenantById(tenantId);
      }
      try {
        const remoteTenant = await PersistentStoreService.remoteGetAtPath<TenantRecord>(
          `tenants/${tenantId}`,
          { silentOnStatuses: [403] }
        );
        if (remoteTenant && remoteTenant.id) {
          KNOWN_TENANTS.set(remoteTenant.id, {
            ...remoteTenant,
            authVersion: remoteTenant.authVersion ?? 1,
          });
          if (remoteTenant.customDomain) {
            CUSTOM_DOMAINS.set(this.normalizeHost(remoteTenant.customDomain), remoteTenant.id);
          }
          this.ensuredTenants.add(remoteTenant.id);
        }
      } catch {
        // Non-member or unbootstrapped tenant; fall back to known tenant map with cooldown
      } finally {
        this.singleTenantHydratedAt.set(tenantId, Date.now());
      }
      return this.getTenantById(tenantId);
    });
  }

  /**
   * Hydrates persisted agency tenant records from Firestore `/tenants` into the in-memory
   * lookup maps so Super Admin agency creations/updates survive restarts permanently.
   * Strictly gated to Platform Admin or Server ADC contexts to prevent 403 log storms.
   */
  public static async hydrateFromFirestore(ttlMs = 30_000): Promise<TenantRecord[]> {
    if (process.env.NODE_ENV === "test") {
      return this.getAllTenants();
    }
    if (!PersistentStoreService.isRemoteFirestoreConfigured()) {
      return this.getAllTenants();
    }
    if (!this.canListAllTenantsInCurrentContext()) {
      return this.getAllTenants();
    }
    const now = Date.now();
    if (now - this.lastHydratedAt < ttlMs || now - this.lastHydrateFailureAt < ttlMs) {
      return this.getAllTenants();
    }

    return PersistentStoreService.withKeyMutex("hydrate::tenants", async () => {
      const checkNow = Date.now();
      if (checkNow - this.lastHydratedAt < ttlMs || checkNow - this.lastHydrateFailureAt < ttlMs) {
        return this.getAllTenants();
      }
      try {
        const remoteTenants = await PersistentStoreService.remoteListAtPath<TenantRecord>(
          "tenants",
          300,
          20,
          { silentOnStatuses: [403] }
        );
        for (const t of remoteTenants) {
          if (t && t.id) {
            KNOWN_TENANTS.set(t.id, {
              ...t,
              authVersion: t.authVersion ?? 1,
            });
            if (t.customDomain) {
              CUSTOM_DOMAINS.set(this.normalizeHost(t.customDomain), t.id);
            }
            this.ensuredTenants.add(t.id);
            this.singleTenantHydratedAt.set(t.id, Date.now());
          }
        }
        this.lastHydratedAt = Date.now();
      } catch {
        // Apply cooldown so transient 403/network issues do not trigger repeated request storms
        this.lastHydrateFailureAt = Date.now();
      }
      return this.getAllTenants();
    });
  }

  /**
   * Persists a tenant record permanently in Firestore `/tenants/{tenant.id}` and updates caches.
   */
  public static async saveTenantAsync(
    tenant: TenantRecord,
    customDomain?: string
  ): Promise<TenantRecord> {
    const prev = KNOWN_TENANTS.get(tenant.id);
    const statusChangedToRestricted =
      prev &&
      prev.status !== tenant.status &&
      (tenant.status === "suspended" || tenant.status === "cancelled" || prev.status === "suspended" || prev.status === "cancelled");
    const nextAuthVersion =
      typeof tenant.authVersion === "number" && (!prev || tenant.authVersion > (prev.authVersion ?? 1))
        ? tenant.authVersion
        : statusChangedToRestricted
          ? (prev.authVersion ?? 1) + 1
          : (tenant.authVersion ?? prev?.authVersion ?? 1);

    const normalized: TenantRecord = {
      ...tenant,
      authVersion: nextAuthVersion,
      ...(customDomain ? { customDomain: this.normalizeHost(customDomain) } : {}),
      updatedAt: tenant.updatedAt || new Date().toISOString(),
    };
    this.registerTenant(normalized, normalized.customDomain);
    if (process.env.NODE_ENV !== "test" || PersistentStoreService.isRemoteFirestoreConfigured()) {
      await PersistentStoreService.remoteSetAtPath(`tenants/${normalized.id}`, normalized);
      this.ensuredTenants.add(normalized.id);
      this.singleTenantHydratedAt.set(normalized.id, Date.now());
    }
    return normalized;
  }

  /**
   * Ensures `/tenants/{tenantId}` exists in Firestore so `isTenantActive(tenantId)` in
   * `firestore.rules` always evaluates cleanly for agency members and agents.
   */
  public static async ensureTenantExistsInFirestore(tenantId: string): Promise<void> {
    if (process.env.NODE_ENV === "test") return;
    if (!tenantId || this.ensuredTenants.has(tenantId)) return;
    if (!PersistentStoreService.isRemoteFirestoreConfigured()) return;

    const localTenant = KNOWN_TENANTS.get(tenantId);
    if (!localTenant) return;

    try {
      const existing = await PersistentStoreService.remoteGetAtPath<TenantRecord>(
        `tenants/${tenantId}`,
        { silentOnStatuses: [403] }
      );
      if (existing) {
        KNOWN_TENANTS.set(tenantId, existing);
        if (existing.customDomain) {
          CUSTOM_DOMAINS.set(this.normalizeHost(existing.customDomain), tenantId);
        }
        this.ensuredTenants.add(tenantId);
        this.singleTenantHydratedAt.set(tenantId, Date.now());
        return;
      }
      if (!this.canListAllTenantsInCurrentContext()) {
        return;
      }
      await PersistentStoreService.remoteSetAtPath(`tenants/${tenantId}`, localTenant);
      this.ensuredTenants.add(tenantId);
      this.singleTenantHydratedAt.set(tenantId, Date.now());
    } catch {
      // Non-admin users cannot create root tenant docs; Platform Admin or server ADC will bootstrap it
    }
  }

  public static getAllTenants(): TenantRecord[] {
    return Array.from(KNOWN_TENANTS.values());
  }
}
