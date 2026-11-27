import { createHash } from "node:crypto";
import { logger } from "../../logger/logger";
import {
  mapCanonicalToStoriaPayload,
  mapStoriaRemoteErrorsToIssues,
  validateForStoria,
} from "../mappers/map_storia-taxonomy";
import {
  PortalProviderError,
  type CanonicalPropertySpecs,
  type ExternalPortalProvider,
  type PortalCredentialsPayload,
  type PortalOperationContext,
  type PortalProviderCapabilities,
  type PortalPublicationStatus,
  type PortalPublishResult,
  type PortalStatusResult,
  type PortalValidationResult,
} from "../typ_portal-provider";

const ALLOWED_STORIA_HOSTS = new Set([
  "api.storia.ro",
  "api.sandbox.storia.ro",
  "auth.storia.ro",
  "auth.sandbox.storia.ro",
]);

const DEFAULT_STORIA_PROD_API_URL = "https://api.storia.ro";
const DEFAULT_STORIA_SANDBOX_API_URL = "https://api.sandbox.storia.ro";
const DEFAULT_STORIA_PROD_OAUTH_URL = "https://auth.storia.ro/oauth/token";
const DEFAULT_STORIA_SANDBOX_OAUTH_URL = "https://auth.sandbox.storia.ro/oauth/token";

interface CachedOAuthToken {
  accessToken: string;
  expiresAtMs: number;
  fingerprint: string;
}

export interface StoriaProviderOptions {
  apiBaseUrlOverrideForTests?: string;
  oauthTokenUrlOverrideForTests?: string;
  requestTimeoutMs?: number;
  rateLimitMaxPerMin?: number;
}

/**
 * Validates that outbound Storia.ro API / OAuth URLs strictly use HTTPS and belong to
 * official allowlisted Storia hostnames (blocking SSRF to private/link-local/arbitrary hosts).
 * Loopback `127.0.0.1` is permitted ONLY when `NODE_ENV === "test"` for isolated contract tests.
 */
export function assertSafeStoriaEndpointUrl(rawUrl: string, label: string): string {
  const trimmed = String(rawUrl || "").trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new PortalProviderError({
      message: `URL invalid pentru ${label} Storia.ro.`,
      statusCode: 500,
      code: "STORIA_INVALID_ENDPOINT",
      retryable: false,
    });
  }

  if (parsed.username || parsed.password) {
    throw new PortalProviderError({
      message: `URL invalid pentru ${label} Storia.ro (credențiale în URL nepermise).`,
      statusCode: 400,
      code: "STORIA_UNTRUSTED_ENDPOINT",
      retryable: false,
    });
  }

  const host = parsed.hostname.toLowerCase();
  const isTestLoopback =
    process.env.NODE_ENV === "test" &&
    (host === "127.0.0.1" || host === "localhost") &&
    (parsed.protocol === "http:" || parsed.protocol === "https:");

  if (isTestLoopback) {
    return trimmed;
  }

  if (parsed.protocol !== "https:" || !ALLOWED_STORIA_HOSTS.has(host)) {
    throw new PortalProviderError({
      message: `Endpoint neautorizat pentru ${label}: doar gazdele oficiale HTTPS Storia.ro sunt permise.`,
      statusCode: 400,
      code: "STORIA_UNTRUSTED_ENDPOINT",
      retryable: false,
    });
  }

  return trimmed;
}

function sanitizeStoriaExternalUrl(raw: unknown, fallback: string | null = null): string | null {
  const val = String(raw || "").trim();
  if (!val) return fallback;
  try {
    const u = new URL(val);
    if (u.protocol === "https:") {
      return u.toString();
    }
  } catch {
    // ignore malformed URL
  }
  return fallback;
}

function normalizeRemoteStoriaStatus(raw: unknown): PortalPublicationStatus {
  const norm = String(raw || "").trim().toLowerCase();
  if (norm === "active" || norm === "published" || norm === "live") return "published";
  if (norm === "paused" || norm === "inactive" || norm === "deactivated") return "paused";
  if (norm === "deleted" || norm === "withdrawn" || norm === "removed" || norm === "archived") {
    return "withdrawn";
  }
  if (norm === "rejected" || norm === "moderation_rejected") return "rejected";
  if (norm === "pending" || norm === "moderation" || norm === "processing") return "pending";
  return "sync_error";
}

function parseRetryAfterMs(headerVal: string | null): number | null {
  if (!headerVal) return null;
  const seconds = Number(headerVal);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 300_000);
  }
  const dateMs = Date.parse(headerVal);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, Math.min(dateMs - Date.now(), 300_000));
  }
  return null;
}

/**
 * Phase 8 First Live External Portal Adapter: **Storia.ro Real Estate Partner API**.
 *
 * Design & Security Guarantees:
 * - Implements the Phase 7 `ExternalPortalProvider` contract with zero changes to BROKR's canonical CRM model.
 * - Uses official Partner API HTTPS endpoints only (strictly allowlisted hosts — zero Puppeteer/scraping).
 * - Supports OAuth2 (`client_credentials` / `refresh_token`) with per-tenant cached bearer tokens and automatic
 *   single refresh-on-401, as well as Partner API key bearer auth.
 * - Enforces a per-tenant sliding-window rate limit + respects HTTP `429 Retry-After` via retryable outbox errors.
 * - Performs an `external_ref` duplicate pre-check before `POST /v1/adverts` so crash-retry scenarios never
 *   create duplicate listings on Storia.ro.
 */
export class StoriaPortalProvider implements ExternalPortalProvider {
  public readonly providerId = "storia_ro";
  public readonly displayName = "Storia.ro";
  public readonly integrationMode = "api" as const;
  public readonly description =
    "Integrare oficială Storia.ro Real Estate Partner API (publicare în timp real, actualizare, pauză, retragere și sincronizare status).";

  public readonly capabilities: PortalProviderCapabilities = {
    supportsInstantPublish: true,
    supportsUpdate: true,
    supportsPause: true,
    supportsWithdraw: true,
    supportsStatusSync: true,
    supportsMediaOrdering: true,
    requiresCredentials: true,
  };

  private tokenCache = new Map<string, CachedOAuthToken>();
  private rateWindowByTenant = new Map<string, number[]>();
  private testApiBaseUrl: string | null;
  private testOAuthUrl: string | null;
  private timeoutMs: number;
  private rateLimitMaxPerMin: number;

  constructor(options?: StoriaProviderOptions) {
    this.testApiBaseUrl = options?.apiBaseUrlOverrideForTests || null;
    this.testOAuthUrl = options?.oauthTokenUrlOverrideForTests || null;
    const envTimeout = Number(process.env.STORIA_REQUEST_TIMEOUT_MS || "15000");
    this.timeoutMs =
      options?.requestTimeoutMs ?? (Number.isFinite(envTimeout) && envTimeout >= 1000 ? envTimeout : 15000);
    const envRate = Number(process.env.STORIA_RATE_LIMIT_MAX_PER_MIN || "30");
    this.rateLimitMaxPerMin =
      options?.rateLimitMaxPerMin ?? (Number.isFinite(envRate) && envRate >= 1 ? envRate : 30);
  }

  public setTestEndpointsForTests(params: { apiBaseUrl: string; oauthTokenUrl: string } | null): void {
    if (process.env.NODE_ENV !== "test") return;
    this.testApiBaseUrl = params ? params.apiBaseUrl : null;
    this.testOAuthUrl = params ? params.oauthTokenUrl : null;
    this.tokenCache.clear();
    this.rateWindowByTenant.clear();
  }

  public clearRuntimeCachesForTests(): void {
    this.tokenCache.clear();
    this.rateWindowByTenant.clear();
  }

  private resolveApiBaseUrl(credentials: PortalCredentialsPayload): string {
    if (process.env.NODE_ENV === "test" && this.testApiBaseUrl) {
      return assertSafeStoriaEndpointUrl(this.testApiBaseUrl, "API");
    }
    const envUrl = String(process.env.STORIA_API_BASE_URL || "").trim();
    if (envUrl) {
      return assertSafeStoriaEndpointUrl(envUrl, "API");
    }
    const useSandbox = credentials?.sandboxMode === true || credentials?.sandboxMode === "true";
    return assertSafeStoriaEndpointUrl(
      useSandbox ? DEFAULT_STORIA_SANDBOX_API_URL : DEFAULT_STORIA_PROD_API_URL,
      "API"
    );
  }

  private resolveOAuthTokenUrl(credentials: PortalCredentialsPayload): string {
    if (process.env.NODE_ENV === "test" && this.testOAuthUrl) {
      return assertSafeStoriaEndpointUrl(this.testOAuthUrl, "OAuth");
    }
    const envUrl = String(process.env.STORIA_OAUTH_TOKEN_URL || "").trim();
    if (envUrl) {
      return assertSafeStoriaEndpointUrl(envUrl, "OAuth");
    }
    const useSandbox = credentials?.sandboxMode === true || credentials?.sandboxMode === "true";
    return assertSafeStoriaEndpointUrl(
      useSandbox ? DEFAULT_STORIA_SANDBOX_OAUTH_URL : DEFAULT_STORIA_PROD_OAUTH_URL,
      "OAuth"
    );
  }

  private enforceTenantRateLimit(tenantId: string): void {
    const now = Date.now();
    const cutoff = now - 60_000;
    const recent = (this.rateWindowByTenant.get(tenantId) || []).filter((ts) => ts > cutoff);
    if (recent.length >= this.rateLimitMaxPerMin) {
      this.rateWindowByTenant.set(tenantId, recent);
      throw new PortalProviderError({
        message: "Limita locală de apeluri către Storia.ro a fost atinsă temporar; se reîncearcă automat.",
        statusCode: 429,
        code: "STORIA_LOCAL_RATE_LIMITED",
        retryable: true,
      });
    }
    recent.push(now);
    this.rateWindowByTenant.set(tenantId, recent);
  }

  private buildCredentialFingerprint(credentials: PortalCredentialsPayload): string {
    return createHash("sha256")
      .update(
        JSON.stringify([
          String(credentials.clientId || ""),
          String(credentials.clientSecret || ""),
          String(credentials.refreshToken || ""),
          String(credentials.apiKey || ""),
          String(credentials.sandboxMode || false),
        ])
      )
      .digest("hex");
  }

  private async resolveBearerToken(
    tenantId: string,
    credentials: PortalCredentialsPayload,
    forceRefresh = false
  ): Promise<string> {
    const staticToken = String(credentials.accessToken || credentials.apiKey || "").trim();
    const clientId = String(credentials.clientId || "").trim();
    const clientSecret = String(credentials.clientSecret || "").trim();
    const refreshToken = String(credentials.refreshToken || "").trim();

    // If OAuth2 credentials are provided, issue/cache/refresh bearer token
    if (clientId && (clientSecret || refreshToken)) {
      const cacheKey = `${tenantId}:storia_ro`;
      const fp = this.buildCredentialFingerprint(credentials);
      const cached = this.tokenCache.get(cacheKey);
      if (!forceRefresh && cached && cached.fingerprint === fp && cached.expiresAtMs > Date.now() + 60_000) {
        return cached.accessToken;
      }

      const tokenUrl = this.resolveOAuthTokenUrl(credentials);
      const bodyParams = new URLSearchParams();
      if (refreshToken && !clientSecret) {
        bodyParams.set("grant_type", "refresh_token");
        bodyParams.set("refresh_token", refreshToken);
        bodyParams.set("client_id", clientId);
      } else {
        bodyParams.set("grant_type", "client_credentials");
        bodyParams.set("client_id", clientId);
        bodyParams.set("client_secret", clientSecret);
        bodyParams.set("scope", "read write");
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await fetch(tokenUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            "User-Agent": "BROKR-CRM-PortalSync/1.0",
          },
          body: bodyParams.toString(),
          signal: controller.signal,
        });

        const parsed = await res.json().catch(() => ({}));
        if (!res.ok) {
          const isAuth = res.status === 400 || res.status === 401 || res.status === 403;
          throw new PortalProviderError({
            message:
              isAuth
                ? "Autentificarea OAuth2 cu Storia.ro a eșuat. Verificați Client ID și Client Secret."
                : `Serviciul OAuth2 Storia.ro este temporar indisponibil (${res.status}).`,
            statusCode: isAuth ? 401 : res.status,
            code: isAuth ? "STORIA_OAUTH_INVALID" : "STORIA_OAUTH_UNAVAILABLE",
            retryable: !isAuth && (res.status === 429 || res.status >= 500),
            isAuthError: isAuth,
          });
        }

        const accessToken = String((parsed as any)?.access_token || "").trim();
        const expiresInSec = Number((parsed as any)?.expires_in || 3600);
        if (!accessToken) {
          throw new PortalProviderError({
            message: "Storia.ro nu a returnat un access_token valid.",
            statusCode: 502,
            code: "STORIA_OAUTH_EMPTY_TOKEN",
            retryable: true,
          });
        }

        this.tokenCache.set(cacheKey, {
          accessToken,
          expiresAtMs: Date.now() + Math.max(120, expiresInSec) * 1000,
          fingerprint: fp,
        });
        return accessToken;
      } catch (err) {
        if (err instanceof PortalProviderError) throw err;
        throw new PortalProviderError({
          message: "Timeout sau eroare de rețea la autentificarea OAuth2 Storia.ro.",
          statusCode: 503,
          code: "STORIA_OAUTH_NETWORK_ERROR",
          retryable: true,
        });
      } finally {
        clearTimeout(timer);
      }
    }

    if (staticToken) {
      return staticToken;
    }

    throw new PortalProviderError({
      message: "Lipsesc credențialele API/OAuth Storia.ro pentru această agenție.",
      statusCode: 401,
      code: "STORIA_MISSING_CREDENTIALS",
      retryable: false,
      isAuthError: true,
    });
  }

  private async requestJson<T = Record<string, any>>(params: {
    tenantId: string;
    credentials: PortalCredentialsPayload;
    method: "GET" | "POST" | "PUT" | "DELETE";
    path: string;
    body?: unknown;
    idempotencyKey?: string;
    allowNotFound?: boolean;
  }): Promise<{ status: number; data: T | null }> {
    const baseUrl = this.resolveApiBaseUrl(params.credentials);
    const targetUrl = `${baseUrl}${params.path.startsWith("/") ? params.path : `/${params.path}`}`;
    const hasOAuth = Boolean(
      params.credentials.clientId && (params.credentials.clientSecret || params.credentials.refreshToken)
    );

    const executeAttempt = async (forceRefreshToken: boolean): Promise<{ status: number; data: T | null }> => {
      this.enforceTenantRateLimit(params.tenantId);
      const token = await this.resolveBearerToken(params.tenantId, params.credentials, forceRefreshToken);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "User-Agent": "BROKR-CRM-PortalSync/1.0",
        };
        if (params.body !== undefined) {
          headers["Content-Type"] = "application/json";
        }
        if (params.idempotencyKey) {
          headers["Idempotency-Key"] = params.idempotencyKey.slice(0, 128);
        }

        const res = await fetch(targetUrl, {
          method: params.method,
          headers,
          body: params.body !== undefined ? JSON.stringify(params.body) : undefined,
          signal: controller.signal,
        });

        const rawText = await res.text();
        let parsed: any = null;
        if (rawText) {
          try {
            parsed = JSON.parse(rawText);
          } catch {
            parsed = { message: rawText.slice(0, 300) };
          }
        }

        if (res.status === 404 && params.allowNotFound) {
          return { status: 404, data: null };
        }

        if (res.status === 401 && hasOAuth && !forceRefreshToken) {
          // Automatically refresh expired OAuth bearer token once before failing
          this.tokenCache.delete(`${params.tenantId}:storia_ro`);
          return executeAttempt(true);
        }

        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            throw new PortalProviderError({
              message:
                "Credențialele Storia.ro au expirat sau nu au permisiuni suficiente (401/403). Reconectați contul în Administrare.",
              statusCode: res.status,
              code: "STORIA_AUTH_FAILED",
              retryable: false,
              isAuthError: true,
            });
          }

          if (res.status === 429) {
            const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));
            throw new PortalProviderError({
              message: `Storia.ro a limitat temporar cererile (429)${
                retryAfterMs ? ` — reîncercare după ${Math.ceil(retryAfterMs / 1000)}s` : ""
              }.`,
              statusCode: 429,
              code: "STORIA_RATE_LIMITED",
              retryable: true,
            });
          }

          if (res.status === 400 || res.status === 422) {
            const issues = mapStoriaRemoteErrorsToIssues(parsed);
            const firstMsg =
              issues[0]?.message ||
              String(parsed?.message || "Storia.ro a respins datele anunțului (400/422).");
            throw new PortalProviderError({
              message: firstMsg,
              statusCode: res.status,
              code: "STORIA_REMOTE_VALIDATION_FAILED",
              retryable: false,
              validationIssues: issues,
            });
          }

          if (res.status >= 500) {
            throw new PortalProviderError({
              message: `Storia.ro Partner API este temporar indisponibil (HTTP ${res.status}).`,
              statusCode: res.status,
              code: "STORIA_UPSTREAM_5XX",
              retryable: true,
            });
          }

          throw new PortalProviderError({
            message: String(parsed?.message || `Eroare Storia.ro Partner API (HTTP ${res.status}).`),
            statusCode: res.status,
            code: "STORIA_HTTP_ERROR",
            retryable: false,
          });
        }

        return { status: res.status, data: parsed as T };
      } catch (err) {
        if (err instanceof PortalProviderError) throw err;
        logger.warn("Storia Partner API network/timeout failure", {
          module: "storia-portal-adapter",
          tenantId: params.tenantId,
          method: params.method,
          path: params.path,
        });
        throw new PortalProviderError({
          message: "Timeout sau eroare de rețea la comunicarea cu Storia.ro Partner API.",
          statusCode: 503,
          code: "STORIA_NETWORK_TIMEOUT",
          retryable: true,
        });
      } finally {
        clearTimeout(timer);
      }
    };

    return executeAttempt(false);
  }

  public validate(
    canonical: CanonicalPropertySpecs,
    _rawProperty?: Record<string, any>
  ): PortalValidationResult {
    return validateForStoria(canonical);
  }

  public mapPayload(
    canonical: CanonicalPropertySpecs,
    rawProperty?: Record<string, any>
  ): Record<string, unknown> {
    return mapCanonicalToStoriaPayload(canonical, rawProperty) as unknown as Record<string, unknown>;
  }

  public async testCredentials(
    credentials: PortalCredentialsPayload
  ): Promise<{ ok: boolean; accountLabel?: string; message?: string }> {
    try {
      const res = await this.requestJson<Record<string, any>>({
        tenantId: "credential_test",
        credentials,
        method: "GET",
        path: "/v1/account/me",
      });
      const data = res.data || {};
      const accountLabel = String(
        data.agency_name || data.account_name || data.email || credentials.agencyCode || "Cont Storia.ro"
      ).trim();
      return {
        ok: true,
        accountLabel,
        message: "Conexiune Storia.ro Partner API verificată cu succes.",
      };
    } catch (err) {
      const msg =
        err instanceof PortalProviderError
          ? err.message
          : "Testul de conectare cu Storia.ro a eșuat.";
      return { ok: false, message: msg };
    }
  }

  private buildExternalRef(tenantId: string, propertyId: string): string {
    return `brokr:${tenantId}:${propertyId}`;
  }

  /**
   * Duplicate pre-check by `external_ref` so retries after worker crashes never create
   * duplicate listings on Storia.ro.
   */
  private async findExistingByExternalRef(
    ctx: PortalOperationContext,
    externalRef: string
  ): Promise<{ id: string; url?: string | null } | null> {
    const res = await this.requestJson<Record<string, any>>({
      tenantId: ctx.tenantId,
      credentials: ctx.credentials,
      method: "GET",
      path: `/v1/adverts?external_ref=${encodeURIComponent(externalRef)}`,
      allowNotFound: true,
    });
    const list = Array.isArray(res.data?.items)
      ? res.data.items
      : Array.isArray(res.data?.adverts)
        ? res.data.adverts
        : Array.isArray(res.data)
          ? res.data
          : [];
    const match = list.find(
      (item: any) => item && String(item.external_ref || "") === externalRef && item.id
    );
    if (!match) return null;
    return {
      id: String(match.id),
      url: match.url ? String(match.url) : null,
    };
  }

  public async publish(ctx: PortalOperationContext): Promise<PortalPublishResult> {
    const validation = this.validate(ctx.canonical, ctx.rawProperty);
    if (!validation.valid) {
      throw new PortalProviderError({
        message:
          validation.issues.find((i) => i.severity === "error")?.message ||
          "Date incomplete pentru publicarea pe Storia.ro.",
        statusCode: 400,
        code: "STORIA_PREFLIGHT_VALIDATION_FAILED",
        retryable: false,
        validationIssues: validation.issues,
      });
    }

    const externalRef = this.buildExternalRef(ctx.tenantId, ctx.propertyId);
    const payload = mapCanonicalToStoriaPayload(ctx.canonical, ctx.rawProperty, externalRef);

    // Zero-duplicate guarantee: if we don't have a stored externalListingId yet, verify remotely first
    let targetExternalId = ctx.existingPublication?.externalListingId || null;
    if (!targetExternalId) {
      const remoteExisting = await this.findExistingByExternalRef(ctx, externalRef);
      if (remoteExisting?.id) {
        targetExternalId = remoteExisting.id;
      }
    }

    const res = targetExternalId
      ? await this.requestJson<Record<string, any>>({
          tenantId: ctx.tenantId,
          credentials: ctx.credentials,
          method: "PUT",
          path: `/v1/adverts/${encodeURIComponent(targetExternalId)}`,
          body: payload,
          idempotencyKey: ctx.idempotencyKey,
        })
      : await this.requestJson<Record<string, any>>({
          tenantId: ctx.tenantId,
          credentials: ctx.credentials,
          method: "POST",
          path: "/v1/adverts",
          body: payload,
          idempotencyKey: ctx.idempotencyKey,
        });

    const data = res.data || {};
    const externalListingId = String(data.id || targetExternalId || "").trim();
    if (!externalListingId) {
      throw new PortalProviderError({
        message: "Storia.ro nu a returnat ID-ul extern al anunțului.",
        statusCode: 502,
        code: "STORIA_MISSING_LISTING_ID",
        retryable: true,
      });
    }

    const remoteStatus = normalizeRemoteStoriaStatus(data.status || "active");
    const fallbackUrl = `https://www.storia.ro/ro/oferta/${encodeURIComponent(externalListingId)}`;
    return {
      externalListingId,
      externalUrl: sanitizeStoriaExternalUrl(data.url, fallbackUrl),
      status: remoteStatus === "pending" ? "pending" : "published",
      providerMeta: {
        externalRef,
        categoryCode: payload.category,
        remoteStatus: data.status || "active",
        reconciledExisting: Boolean(targetExternalId && !ctx.existingPublication?.externalListingId),
      },
    };
  }

  public async update(ctx: PortalOperationContext): Promise<PortalPublishResult> {
    return this.publish(ctx);
  }

  public async pause(ctx: PortalOperationContext): Promise<PortalPublishResult> {
    const externalListingId = ctx.existingPublication?.externalListingId;
    if (!externalListingId) {
      throw new PortalProviderError({
        message: "Anunțul nu are un ID extern activ pe Storia.ro pentru a fi pus pe pauză.",
        statusCode: 404,
        code: "STORIA_LISTING_NOT_FOUND",
        retryable: false,
      });
    }

    const res = await this.requestJson<Record<string, any>>({
      tenantId: ctx.tenantId,
      credentials: ctx.credentials,
      method: "POST",
      path: `/v1/adverts/${encodeURIComponent(externalListingId)}/deactivate`,
      body: { reason: "paused_by_agency" },
      idempotencyKey: ctx.idempotencyKey,
    });

    return {
      externalListingId,
      externalUrl: sanitizeStoriaExternalUrl(res.data?.url, ctx.existingPublication?.externalUrl ?? null),
      status: "paused",
      providerMeta: { remoteStatus: res.data?.status || "inactive" },
    };
  }

  public async withdraw(ctx: PortalOperationContext): Promise<PortalPublishResult> {
    const externalListingId = ctx.existingPublication?.externalListingId;
    if (!externalListingId) {
      return {
        externalListingId: "",
        externalUrl: null,
        status: "withdrawn",
      };
    }

    await this.requestJson<Record<string, any>>({
      tenantId: ctx.tenantId,
      credentials: ctx.credentials,
      method: "DELETE",
      path: `/v1/adverts/${encodeURIComponent(externalListingId)}`,
      idempotencyKey: ctx.idempotencyKey,
      allowNotFound: true,
    });

    return {
      externalListingId,
      externalUrl: null,
      status: "withdrawn",
      providerMeta: { withdrawnAt: new Date().toISOString() },
    };
  }

  public async getStatus(ctx: PortalOperationContext): Promise<PortalStatusResult> {
    const externalListingId = ctx.existingPublication?.externalListingId || "";
    if (!externalListingId) {
      return {
        externalListingId: "",
        externalUrl: null,
        status: "not_published",
      };
    }

    const res = await this.requestJson<Record<string, any>>({
      tenantId: ctx.tenantId,
      credentials: ctx.credentials,
      method: "GET",
      path: `/v1/adverts/${encodeURIComponent(externalListingId)}`,
      allowNotFound: true,
    });

    if (res.status === 404 || !res.data) {
      return {
        externalListingId,
        externalUrl: null,
        status: "withdrawn",
      };
    }

    const mappedStatus = normalizeRemoteStoriaStatus(res.data.status);
    return {
      externalListingId,
      externalUrl:
        mappedStatus === "withdrawn"
          ? null
          : sanitizeStoriaExternalUrl(res.data.url, ctx.existingPublication?.externalUrl ?? null),
      status: mappedStatus,
      providerMeta: {
        remoteStatus: res.data.status,
        viewsCount: res.data.views_count,
      },
    };
  }
}
