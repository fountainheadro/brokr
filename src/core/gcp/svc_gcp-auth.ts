import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import axios from "axios";
import { AppError } from "../errors/app_error";
import { logger } from "../logger/logger";

export interface ServiceAccountCreds {
  type?: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
  project_id?: string;
}

export interface AdcAuthorizedUserCreds {
  type: "authorized_user";
  client_id: string;
  client_secret: string;
  refresh_token: string;
  quota_project_id?: string;
}

export type GcpAuthMethod =
  | "service_account_json"
  | "adc_authorized_user"
  | "gcp_metadata_adc"
  | "none";

export interface GcpAuthMethodInfo {
  method: GcpAuthMethod;
  principalEmail: string | null;
  quotaProjectId: string | null;
}

interface CachedTokenEntry {
  token: string;
  expiresAtMs: number;
}

export class GcpAuthService {
  private static tokenCache = new Map<string, CachedTokenEntry>();
  private static testMetadataOrigin: string | null = null;
  private static testOauthTokenOrigin: string | null = null;

  public static setTestOrigins(opts: {
    metadataOrigin?: string | null;
    oauthTokenOrigin?: string | null;
  }): void {
    if ("metadataOrigin" in opts) {
      this.testMetadataOrigin = opts.metadataOrigin ? opts.metadataOrigin.replace(/\/+$/, "") : null;
    }
    if ("oauthTokenOrigin" in opts) {
      this.testOauthTokenOrigin = opts.oauthTokenOrigin
        ? opts.oauthTokenOrigin.replace(/\/+$/, "")
        : null;
    }
  }

  public static clearTokenCache(): void {
    this.tokenCache.clear();
  }

  public static isMetadataAuthEnabled(
    env: Record<string, string | undefined> = process.env
  ): boolean {
    const flag = env.USE_GCP_METADATA_AUTH?.trim().toLowerCase();
    if (flag !== "true") {
      return false;
    }
    const kService = env.K_SERVICE?.trim() || "";
    const isAiStudioSandbox = kService.startsWith("ais-");
    const allowPreviewMetadata = env.ALLOW_PREVIEW_METADATA_AUTH?.trim().toLowerCase() === "true";
    if (isAiStudioSandbox && !this.testMetadataOrigin && !allowPreviewMetadata) {
      return false;
    }
    return true;
  }

  public static getDefaultAdcCandidatePaths(
    env: Record<string, string | undefined> = process.env
  ): string[] {
    const candidates: string[] = [];
    const envCredPath = env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
    if (envCredPath) {
      candidates.push(path.resolve(envCredPath));
    }
    const cloudSdkDir = env.CLOUDSDK_CONFIG?.trim();
    if (cloudSdkDir) {
      candidates.push(path.join(cloudSdkDir, "application_default_credentials.json"));
    }
    const homeDir = env.HOME?.trim() || (env === process.env ? os.homedir() : "");
    if (homeDir) {
      candidates.push(
        path.join(homeDir, ".config", "gcloud", "application_default_credentials.json")
      );
    }
    const appData = env.APPDATA?.trim();
    if (appData) {
      candidates.push(path.join(appData, "gcloud", "application_default_credentials.json"));
    }
    return candidates;
  }

  public static getServiceAccountCreds(
    env: Record<string, string | undefined> = process.env
  ): ServiceAccountCreds | null {
    const rawJson = env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
    if (rawJson) {
      try {
        const decoded = rawJson.startsWith("{")
          ? rawJson
          : Buffer.from(rawJson, "base64").toString("utf8");
        const parsed = JSON.parse(decoded);
        if (parsed?.client_email && parsed?.private_key) {
          return parsed as ServiceAccountCreds;
        }
      } catch {
        // Ignore malformed inline JSON
      }
    }

    const credPath = env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
    if (credPath && fs.existsSync(credPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(credPath, "utf8"));
        if (parsed?.client_email && parsed?.private_key) {
          return parsed as ServiceAccountCreds;
        }
      } catch {
        // Ignore malformed file
      }
    }

    return null;
  }

  public static getAdcAuthorizedUserCreds(
    env: Record<string, string | undefined> = process.env
  ): AdcAuthorizedUserCreds | null {
    for (const candidate of this.getDefaultAdcCandidatePaths(env)) {
      try {
        if (fs.existsSync(candidate)) {
          const parsed = JSON.parse(fs.readFileSync(candidate, "utf8"));
          if (
            parsed?.type === "authorized_user" &&
            parsed?.client_id &&
            parsed?.client_secret &&
            parsed?.refresh_token
          ) {
            return parsed as AdcAuthorizedUserCreds;
          }
        }
      } catch {
        // Ignore malformed ADC file
      }
    }
    return null;
  }

  public static getAuthMethodInfo(
    env: Record<string, string | undefined> = process.env
  ): GcpAuthMethodInfo {
    const sa = this.getServiceAccountCreds(env);
    if (sa) {
      return {
        method: "service_account_json",
        principalEmail: sa.client_email,
        quotaProjectId: sa.project_id || null,
      };
    }
    const adcUser = this.getAdcAuthorizedUserCreds(env);
    if (adcUser) {
      return {
        method: "adc_authorized_user",
        principalEmail: null,
        quotaProjectId: adcUser.quota_project_id || null,
      };
    }
    if (this.isMetadataAuthEnabled(env)) {
      return {
        method: "gcp_metadata_adc",
        principalEmail: null,
        quotaProjectId: null,
      };
    }
    return {
      method: "none",
      principalEmail: null,
      quotaProjectId: null,
    };
  }

  public static isAnyServerAuthConfigured(
    env: Record<string, string | undefined> = process.env
  ): boolean {
    return (
      Boolean(this.getServiceAccountCreds(env)) ||
      Boolean(this.getAdcAuthorizedUserCreds(env)) ||
      this.isMetadataAuthEnabled(env)
    );
  }

  public static getQuotaProjectHeaders(
    env: Record<string, string | undefined> = process.env
  ): Record<string, string> {
    if (this.getServiceAccountCreds(env)) return {};
    const adcUser = this.getAdcAuthorizedUserCreds(env);
    if (adcUser?.quota_project_id) {
      return { "x-goog-user-project": adcUser.quota_project_id };
    }
    return {};
  }

  public static sanitizeGcpHttpError(
    err: unknown,
    serviceName: string,
    operation: string
  ): AppError {
    if (err instanceof AppError) {
      return err;
    }

    const anyErr = err as any;
    const status = typeof anyErr?.response?.status === "number" ? anyErr.response.status : null;
    const rawApiMsg =
      typeof anyErr?.response?.data?.error?.message === "string"
        ? anyErr.response.data.error.message
        : typeof anyErr?.response?.data?.error_description === "string"
        ? anyErr.response.data.error_description
        : "";
    const errCode = typeof anyErr?.code === "string" ? anyErr.code : null;

    if (status === 401) {
      return new AppError({
        message: `${serviceName}: autentificare invalidă sau expirată la ${operation} (HTTP 401 Unauthorized).`,
        code: "UNAUTHORIZED",
        statusCode: 401,
      });
    }

    if (status === 403) {
      return new AppError({
        message: `${serviceName}: permisiuni IAM insuficiente la ${operation} (HTTP 403 Permission Denied).`,
        code: "FORBIDDEN",
        statusCode: 403,
      });
    }

    if (status === 404) {
      return new AppError({
        message: `${serviceName}: resursa solicitată nu a fost găsită la ${operation} (HTTP 404).`,
        code: "NOT_FOUND",
        statusCode: 404,
      });
    }

    if (status === 409 || status === 412) {
      return new AppError({
        message: `${serviceName}: conflict de concurență/precondiție la ${operation} (HTTP ${status}).`,
        code: "VALIDATION_ERROR",
        statusCode: status,
      });
    }

    if (status && status >= 400 && status < 500) {
      return new AppError({
        message: `${serviceName}: cerere invalidă la ${operation} (HTTP ${status})${rawApiMsg ? ` - ${rawApiMsg}` : ""}.`,
        code: "VALIDATION_ERROR",
        statusCode: status,
      });
    }

    return new AppError({
      message: `${serviceName}: eroare de rețea sau indisponibilitate la ${operation} (${status ? `HTTP ${status}` : errCode || "network_error"}).`,
      code: "INTERNAL_ERROR",
      statusCode: 503,
    });
  }

  public static async getAccessToken(
    scope: string,
    options?: {
      metadataOrigin?: string;
      oauthTokenOrigin?: string;
      throwOnError?: boolean;
    }
  ): Promise<string | null> {
    const now = Date.now();
    const cached = this.tokenCache.get(scope);
    if (cached && cached.expiresAtMs > now + 60_000) {
      return cached.token;
    }

    const creds = this.getServiceAccountCreds();
    if (creds) {
      try {
        const iat = Math.floor(now / 1000);
        const exp = iat + 3600;
        const defaultTokenUri = creds.token_uri || "https://oauth2.googleapis.com/token";
        const tokenUri =
          options?.oauthTokenOrigin || this.testOauthTokenOrigin
            ? `${(options?.oauthTokenOrigin || this.testOauthTokenOrigin)!.replace(/\/+$/, "")}/token`
            : defaultTokenUri;

        const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString(
          "base64url"
        );
        const claim = Buffer.from(
          JSON.stringify({
            iss: creds.client_email,
            scope,
            aud: defaultTokenUri,
            iat,
            exp,
          })
        ).toString("base64url");

        const unsigned = `${header}.${claim}`;
        const signer = crypto.createSign("RSA-SHA256");
        signer.update(unsigned);
        signer.end();
        const signature = signer.sign(creds.private_key).toString("base64url");

        const params = new URLSearchParams();
        params.append("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
        params.append("assertion", `${unsigned}.${signature}`);

        const res = await axios.post<{ access_token: string; expires_in?: number }>(
          tokenUri,
          params,
          {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            timeout: 8000,
          }
        );

        if (res.data?.access_token) {
          this.tokenCache.set(scope, {
            token: res.data.access_token,
            expiresAtMs: now + (res.data.expires_in || 3600) * 1000,
          });
          return res.data.access_token;
        }
      } catch (err: unknown) {
        const safeErr = this.sanitizeGcpHttpError(err, "GCP OAuth", "service_account_token");
        logger.error("Eroare la obținerea tokenului GCP prin Service Account", safeErr, {
          module: "gcp-auth",
          action: "service_account_token",
        });
        if (options?.throwOnError) {
          throw safeErr;
        }
        return null;
      }
    }

    const adcUser = this.getAdcAuthorizedUserCreds();
    if (adcUser) {
      try {
        const tokenEndpoint =
          options?.oauthTokenOrigin || this.testOauthTokenOrigin
            ? `${(options?.oauthTokenOrigin || this.testOauthTokenOrigin)!.replace(/\/+$/, "")}/token`
            : "https://oauth2.googleapis.com/token";
        const params = new URLSearchParams();
        params.append("client_id", adcUser.client_id);
        params.append("client_secret", adcUser.client_secret);
        params.append("refresh_token", adcUser.refresh_token);
        params.append("grant_type", "refresh_token");

        const res = await axios.post<{ access_token: string; expires_in?: number }>(
          tokenEndpoint,
          params,
          {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            timeout: 8000,
          }
        );

        if (res.data?.access_token) {
          this.tokenCache.set(scope, {
            token: res.data.access_token,
            expiresAtMs: now + (res.data.expires_in || 3600) * 1000,
          });
          return res.data.access_token;
        }
      } catch (err: unknown) {
        const safeErr = this.sanitizeGcpHttpError(err, "GCP ADC Local", "refresh_token");
        logger.warn("Reîmprospătarea tokenului ADC local a eșuat", {
          module: "gcp-auth",
          action: "adc_refresh_token",
          statusCode: safeErr.statusCode,
          reason: safeErr.message,
        });
        if (options?.throwOnError && !this.isMetadataAuthEnabled()) {
          throw safeErr;
        }
      }
    }

    if (this.isMetadataAuthEnabled()) {
      const origin = (
        options?.metadataOrigin ||
        this.testMetadataOrigin ||
        "http://metadata.google.internal"
      ).replace(/\/+$/, "");
      try {
        const metaRes = await axios.get<{ access_token: string; expires_in?: number }>(
          `${origin}/computeMetadata/v1/instance/service-accounts/default/token?scopes=${encodeURIComponent(scope)}`,
          {
            headers: { "Metadata-Flavor": "Google" },
            timeout: 3000,
          }
        );
        if (metaRes.data?.access_token) {
          this.tokenCache.set(scope, {
            token: metaRes.data.access_token,
            expiresAtMs: now + (metaRes.data.expires_in || 1800) * 1000,
          });
          return metaRes.data.access_token;
        }
      } catch (err: unknown) {
        const safeErr = this.sanitizeGcpHttpError(err, "GCP Metadata Server", "default_token");
        logger.error("Eroare la obținerea tokenului din Cloud Run metadata server", safeErr, {
          module: "gcp-auth",
          action: "metadata_token",
        });
        if (options?.throwOnError) {
          throw safeErr;
        }
        return null;
      }
    }

    if (options?.throwOnError) {
      throw new AppError({
        message:
          "Credențialele Google Cloud ADC nu sunt configurate (lipsesc atât ADC/Service Account, cât și USE_GCP_METADATA_AUTH=true).",
        code: "UNAUTHORIZED",
        statusCode: 401,
      });
    }

    return null;
  }

  public static async getMetadataServiceAccountEmail(
    options?: { metadataOrigin?: string }
  ): Promise<string | null> {
    if (!this.isMetadataAuthEnabled() && !options?.metadataOrigin) {
      return null;
    }
    const origin = (
      options?.metadataOrigin ||
      this.testMetadataOrigin ||
      "http://metadata.google.internal"
    ).replace(/\/+$/, "");

    try {
      const res = await axios.get<string>(
        `${origin}/computeMetadata/v1/instance/service-accounts/default/email`,
        {
          headers: { "Metadata-Flavor": "Google" },
          timeout: 1500,
        }
      );
      if (res.status === 200 && typeof res.data === "string") {
        return res.data.trim();
      }
    } catch {
      return null;
    }
    return null;
  }
}
