import axios from "axios";
import { GcpAuthService } from "../gcp/svc_gcp-auth";
import { logger } from "../logger/logger";
import type { TenantStatus, UserRole } from "../tenancy/typ_tenant-context";

/**
 * Compact Firebase Auth Custom Claims payload (< 300 bytes JSON).
 * Used in Stage B once Identity Toolkit Admin IAM permissions are active on Blaze Cloud Run.
 *
 * Fields:
 * - `tid`: Active tenantId
 * - `role`: Verified agency RBAC role
 * - `tst`: Compact tenant status ("active" | "trial" | "suspended" | "cancelled")
 * - `uVer`: Numeric user authVersion (compared against `/tenants/{tid}/users/{uid}.authVersion`)
 * - `tVer`: Numeric tenant authVersion (compared against `/tenants/{tid}.authVersion`)
 */
export interface CompactTenantCustomClaims {
  tid: string;
  role: UserRole;
  tst: TenantStatus;
  uVer: number;
  tVer: number;
}

export const MAX_CUSTOM_CLAIMS_BYTES = 300;
const IDENTITY_TOOLKIT_SCOPE = "https://www.googleapis.com/auth/identitytoolkit";
const DEFAULT_IDENTITY_TOOLKIT_ORIGIN = "https://identitytoolkit.googleapis.com";

export interface CustomClaimsSyncResult {
  synced: boolean;
  skippedReason?: string;
  claims: CompactTenantCustomClaims;
  byteLength: number;
}

export class CustomClaimsService {
  private static identityToolkitOriginOverride: string | null = null;

  public static setTestOrigin(origin: string | null): void {
    this.identityToolkitOriginOverride = origin ? origin.replace(/\/+$/, "") : null;
  }

  /**
   * Custom claims minting requires server-side Identity Toolkit Admin IAM permissions
   * (Blaze Cloud Run / Service Account). Opt-in via `ENABLE_FIREBASE_CUSTOM_CLAIMS=true`
   * so Starter Tier Preview environments run cleanly on O(1) Firestore verification without 403 noise.
   */
  public static isEnabled(env: Record<string, string | undefined> = process.env): boolean {
    return String(env.ENABLE_FIREBASE_CUSTOM_CLAIMS || "").trim().toLowerCase() === "true";
  }

  /**
   * Builds and validates a compact (< 300 bytes) custom claims object.
   */
  public static buildCompactClaims(input: {
    tenantId: string;
    role: UserRole;
    tenantStatus: TenantStatus;
    userAuthVersion?: number;
    tenantAuthVersion?: number;
  }): CompactTenantCustomClaims {
    const uVer =
      typeof input.userAuthVersion === "number" && Number.isFinite(input.userAuthVersion) && input.userAuthVersion >= 1
        ? Math.floor(input.userAuthVersion)
        : 1;
    const tVer =
      typeof input.tenantAuthVersion === "number" && Number.isFinite(input.tenantAuthVersion) && input.tenantAuthVersion >= 1
        ? Math.floor(input.tenantAuthVersion)
        : 1;

    const claims: CompactTenantCustomClaims = {
      tid: String(input.tenantId || "").trim().slice(0, 96),
      role: input.role,
      tst: input.tenantStatus,
      uVer,
      tVer,
    };

    const bytes = Buffer.byteLength(JSON.stringify(claims), "utf8");
    if (bytes > MAX_CUSTOM_CLAIMS_BYTES) {
      throw new Error(
        `Compact custom claims payload exceeded ${MAX_CUSTOM_CLAIMS_BYTES} bytes (${bytes} bytes).`
      );
    }

    return claims;
  }

  /**
   * Synchronizes custom claims to Firebase Auth via Identity Toolkit REST API (`accounts:update`)
   * when `ENABLE_FIREBASE_CUSTOM_CLAIMS=true` and server ADC/SA credentials are available.
   * Safe no-op in Stage A / Starter Tier environments.
   */
  public static async syncUserClaims(
    uid: string,
    input: {
      tenantId: string;
      role: UserRole;
      tenantStatus: TenantStatus;
      userAuthVersion?: number;
      tenantAuthVersion?: number;
      revokeRefreshTokens?: boolean;
    }
  ): Promise<CustomClaimsSyncResult> {
    const claims = this.buildCompactClaims(input);
    const byteLength = Buffer.byteLength(JSON.stringify(claims), "utf8");

    if (!this.isEnabled()) {
      return {
        synced: false,
        skippedReason: "ENABLE_FIREBASE_CUSTOM_CLAIMS is disabled (Stage A Firestore O(1) mode)",
        claims,
        byteLength,
      };
    }

    if (!GcpAuthService.isAnyServerAuthConfigured()) {
      return {
        synced: false,
        skippedReason: "Server ADC / Service Account credentials unavailable for Identity Toolkit",
        claims,
        byteLength,
      };
    }

    const token = await GcpAuthService.getAccessToken(IDENTITY_TOOLKIT_SCOPE);
    if (!token) {
      return {
        synced: false,
        skippedReason: "Failed to obtain Google OAuth access token for Identity Toolkit",
        claims,
        byteLength,
      };
    }

    const projectId =
      process.env.FIREBASE_PROJECT_ID?.trim() ||
      process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
      "brokr-42038";
    const origin = this.identityToolkitOriginOverride || DEFAULT_IDENTITY_TOOLKIT_ORIGIN;
    const url = `${origin}/v1/projects/${encodeURIComponent(projectId)}/accounts:update`;

    const body: Record<string, any> = {
      localId: uid,
      customAttributes: JSON.stringify(claims),
    };

    if (input.revokeRefreshTokens) {
      // Identity Toolkit `validSince` revokes all refresh tokens issued prior to now (in epoch seconds)
      body.validSince = String(Math.floor(Date.now() / 1000));
    }

    try {
      await axios.post(url, body, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...GcpAuthService.getQuotaProjectHeaders(),
        },
        timeout: 8_000,
      });
      return { synced: true, claims, byteLength };
    } catch (err: any) {
      const safeErr = GcpAuthService.sanitizeGcpHttpError(err, "IdentityToolkit", "syncUserClaims");
      logger.warn("Custom claims sync skipped/failed (falling back to live Firestore membership check)", {
        module: "custom-claims",
        tenantId: input.tenantId,
        userId: uid,
        statusCode: safeErr.statusCode,
      });
      return {
        synced: false,
        skippedReason: safeErr.message,
        claims,
        byteLength,
      };
    }
  }
}
