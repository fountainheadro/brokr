import {
  DEFAULT_PLATFORM_ROOT_DOMAIN,
  extractRootDomainFromHost,
} from "../core/tenancy/svc_tenant-resolution";
import { DEFAULT_DEV_TENANT } from "../core/tenancy/typ_tenant-context";
import { isAgencyLeadId, isDailyLeadId } from "./leadIdUtils";

export type ShareEntityKind = "lead" | "property" | "cerere";

export interface ShareTargetInput {
  id?: string | null;
  propertyId?: string | null;
  sourcePropertyId?: string | null;
  status?: string | null;
  title?: string | null;
  notes?: string | null;
  isSharedLead?: boolean | null;
}

export interface ShareUrlOptions {
  entityKind?: ShareEntityKind;
  rootDomain?: string | null;
  agencySubdomain?: string | null;
}

interface ShareDomainContextState {
  rootDomain: string | null;
  agencySubdomain: string | null;
}

const RESERVED_NON_AGENCY_SUBDOMAINS = new Set(["www", "app", "admin", "api", "cdn", "static"]);

const LEAD_ONLY_STATUSES = new Set([
  "Noi",
  "ListaMea",
  "Pierdute",
  "Nevalidata",
  "Calificata",
  "Lead-uri",
  "Intrata",
  "Sterse",
]);

const UNPROCESSED_LEAD_STATUSES = new Set([
  "Noi",
  "Lead-uri",
  "Intrata",
]);

const PROCESSED_AGENCY_LEAD_STATUSES = new Set([
  "ListaMea",
  "Pierdute",
  "Nevalidata",
  "Calificata",
  "Sterse",
]);

const PROPERTY_STATUSES = new Set([
  "Noua",
  "Prospectare",
  "Colaborare",
  "Vizionare",
  "Ofertare",
  "Antecontract",
  "Contract",
  "Activa",
  "InNegociere",
  "Finalizata",
  "Arhiva",
]);

const shareDomainContext: ShareDomainContextState = {
  rootDomain: null,
  agencySubdomain: null,
};

function sanitizeDomainPart(value?: string | null): string | null {
  if (!value) return null;
  const cleaned = String(value)
    .trim()
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .split(":")[0]
    .replace(/\.$/, "")
    .toLowerCase();
  return cleaned || null;
}

function sanitizeSubdomain(value?: string | null): string | null {
  if (!value) return null;
  const cleaned = String(value)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, "")
    .split(".")[0]
    .replace(/[^a-z0-9-]/g, "");
  if (!cleaned || RESERVED_NON_AGENCY_SUBDOMAINS.has(cleaned)) return null;
  return cleaned;
}

/**
 * Synchronized by TenantProvider whenever the active agency or platform root domain resolves/changes
 * (including Super Admin agency preview switching).
 */
export function setShareDomainContext(ctx: {
  rootDomain?: string | null;
  agencySubdomain?: string | null;
}): void {
  if (ctx.rootDomain !== undefined) {
    shareDomainContext.rootDomain = sanitizeDomainPart(ctx.rootDomain);
  }
  if (ctx.agencySubdomain !== undefined) {
    shareDomainContext.agencySubdomain = sanitizeSubdomain(ctx.agencySubdomain);
  }
}

/**
 * Automatically reads the main CRM root domain (e.g. "highline.ro") without hardcoding "app.highline.ro".
 * Priority:
 * 1. Explicit override passed by caller
 * 2. Live platformRootDomain resolved by backend / TenantProvider (reflects Platform Settings & active host)
 * 3. Registrable apex domain auto-extracted from window.location.hostname (e.g. "app.highline.ro" -> "highline.ro")
 * 4. Default platform root domain ("highline.ro")
 */
export function getMainCrmDomain(overrideRootDomain?: string | null): string {
  const explicit = sanitizeDomainPart(overrideRootDomain);
  if (explicit) {
    return extractRootDomainFromHost(explicit) || explicit;
  }

  if (shareDomainContext.rootDomain) {
    return extractRootDomainFromHost(shareDomainContext.rootDomain) || shareDomainContext.rootDomain;
  }

  if (typeof window !== "undefined" && window.location?.hostname) {
    const detected = extractRootDomainFromHost(window.location.hostname);
    if (detected) return detected;
  }

  return DEFAULT_PLATFORM_ROOT_DOMAIN;
}

/**
 * Resolves the active agency subdomain (e.g. "agency-a", "zenith", "agency") dynamically.
 */
export function getCurrentAgencySubdomain(
  overrideSubdomain?: string | null,
  rootDomain?: string | null
): string {
  const explicit = sanitizeSubdomain(overrideSubdomain);
  if (explicit) return explicit;

  if (shareDomainContext.agencySubdomain) {
    return shareDomainContext.agencySubdomain;
  }

  if (typeof window !== "undefined" && window.location?.hostname) {
    const host = window.location.hostname.toLowerCase();
    const resolvedRoot = getMainCrmDomain(rootDomain);
    if (resolvedRoot && host.endsWith(`.${resolvedRoot}`)) {
      const sub = sanitizeSubdomain(host.slice(0, -(resolvedRoot.length + 1)));
      if (sub) return sub;
    }
  }

  return sanitizeSubdomain(DEFAULT_DEV_TENANT.subdomain) || "agency";
}

function isCerereShareTarget(target: ShareTargetInput): boolean {
  const code = String(target.propertyId || "").trim().toUpperCase();
  if (code.startsWith("P") || code.startsWith("L") || isDailyLeadId(code)) return false;
  if (code.startsWith("R") || code.startsWith("C")) return true;

  const status = String(target.status || "");
  if (status === "Noi" || status === "ListaMea" || status === "Pierdute" || status === "Nevalidata" || status === "Calificata") {
    return false;
  }
  if (status === "AreInteres" || status === "Calificare" || status === "Matching") {
    return true;
  }
  if (target.title && String(target.title).toLowerCase().startsWith("cerere")) {
    return true;
  }
  if (
    target.notes &&
    (String(target.notes).toLowerCase().includes("cerințe cerere") ||
      String(target.notes).toLowerCase().includes("cerere:"))
  ) {
    return true;
  }
  return false;
}

/**
 * Classifies a share target into its canonical entity kind ("lead" | "property" | "cerere").
 */
export function detectShareEntityKind(
  target: string | ShareTargetInput | null | undefined,
  explicitKind?: ShareEntityKind
): ShareEntityKind {
  if (explicitKind) return explicitKind;

  if (typeof target === "string") {
    const upper = target.trim().toUpperCase();
    if (/^L\d+$/i.test(upper) || isDailyLeadId(upper)) return "lead";
    if (/^(?:C|R)\d+$/i.test(upper)) return "cerere";
    if (/^P\d+$/i.test(upper)) return "property";
    return "property";
  }

  if (!target) return "property";

  if (isCerereShareTarget(target)) {
    return "cerere";
  }

  const code = String(target.propertyId || "").trim().toUpperCase();
  const status = String(target.status || "");

  if (code.startsWith("P")) {
    return "property";
  }

  if (target.isSharedLead && (!status || LEAD_ONLY_STATUSES.has(status))) {
    return "lead";
  }

  if (LEAD_ONLY_STATUSES.has(status)) {
    return "lead";
  }

  if (PROPERTY_STATUSES.has(status)) {
    return "property";
  }

  if (code.startsWith("L") || isDailyLeadId(code)) {
    return "lead";
  }

  return "property";
}

/**
 * Determines whether a share target belongs to the global unprocessed ("Neprocesate") pool
 * (served at `https://<rootDomain>/share/2026-11-27-2` and stored under `global__<CODE>`)
 * vs an agency-processed lead/property/cerere
 * (served at `https://<agencySubdomain>.<rootDomain>/share/L32` and stored under `<tenantId>__<CODE>`).
 */
export function isUnprocessedPublicLead(
  target: string | ShareTargetInput | null | undefined,
  explicitKind?: ShareEntityKind
): boolean {
  if (explicitKind === "property" || explicitKind === "cerere") {
    return false;
  }

  if (typeof target === "string") {
    const trimmed = target.trim();
    if (!trimmed) return false;
    if (isDailyLeadId(trimmed)) return true;
    if (isAgencyLeadId(trimmed)) return false;
    if (/^(?:P|C|R)\d+$/i.test(trimmed)) return false;
    return explicitKind === "lead";
  }

  if (!target) return false;

  if (isCerereShareTarget(target)) {
    return false;
  }

  const code = String(target.propertyId || "").trim().toUpperCase();
  const status = String(target.status || "").trim();

  if (code.startsWith("P") || PROPERTY_STATUSES.has(status)) {
    return false;
  }

  // Agency-assigned L-codes (e.g. L32) and agency-processed statuses ALWAYS live on the agency subdomain
  if (isAgencyLeadId(code)) {
    return false;
  }

  if (PROCESSED_AGENCY_LEAD_STATUSES.has(status)) {
    return false;
  }

  // Freshly imported daily codes (e.g. 2026-11-27-2) always live on the root domain while unprocessed
  if (isDailyLeadId(code)) {
    return true;
  }

  if (target.isSharedLead === true && (!status || UNPROCESSED_LEAD_STATUSES.has(status))) {
    return true;
  }

  if (UNPROCESSED_LEAD_STATUSES.has(status) && target.isSharedLead !== false) {
    return true;
  }

  return false;
}

/**
 * Extracts the public share code used after `/share/`:
 * prefers the clean sequential entity code (e.g. `2026-11-27-2`, `L32`, `P123`, `C123` / `R123`)
 * instead of internal/Firestore document IDs.
 */
export function resolveShareCode(
  target: string | ShareTargetInput | null | undefined
): string {
  if (!target) return "";
  if (typeof target === "string") return target.trim();

  const entityCode = String(target.propertyId || "").trim();
  if (entityCode) {
    return entityCode;
  }

  return String(target.id || "").trim();
}

/**
 * Builds the canonical external public share URL:
 * - Unprocessed / Neprocesate Leads: `https://<mainDomain>/share/2026-11-27-2`
 * - Agency-processed Leads (`L32`), Cereri (`C123`) & Proprietăți (`P123`):
 *   `https://<agencySubdomain>.<mainDomain>/share/<codeId>`
 *   (e.g. `https://agency.highline.ro/share/L32`)
 */
export function getPublicShareUrl(
  target: string | ShareTargetInput | null | undefined,
  options?: ShareUrlOptions
): string {
  const code = resolveShareCode(target);
  const encodedCode = code ? encodeURIComponent(code) : "";
  const rootDomain = getMainCrmDomain(options?.rootDomain);

  if (isUnprocessedPublicLead(target, options?.entityKind)) {
    return `https://${rootDomain}/share/${encodedCode}`;
  }

  const agencySubdomain = getCurrentAgencySubdomain(options?.agencySubdomain, rootDomain);
  return `https://${agencySubdomain}.${rootDomain}/share/${encodedCode}`;
}
