import crypto from "crypto";
import { PersistentStoreService } from "../database/svc_persistent-store";
import { AppError, ForbiddenError } from "../errors/app_error";
import type {
  EncryptedPortalSecretEnvelope,
  PortalConnectionMetadata,
  PortalConnectionStatus,
  PortalCredentialsPayload,
} from "./typ_portal-provider";

export const COL_PORTAL_CONNECTIONS = "portal_connections";
export const COL_PORTAL_SECRETS = "portal_secrets";

const SAFE_SEGMENT_RE = /^[a-zA-Z0-9_.\-]{1,128}$/;

function assertSafeSegment(value: string, label: string): string {
  const trimmed = String(value || "").trim();
  if (!SAFE_SEGMENT_RE.test(trimmed) || trimmed === "." || trimmed === "..") {
    throw new AppError({
      message: `Identificator invalid pentru ${label}.`,
      code: "VALIDATION_ERROR",
      statusCode: 400,
    });
  }
  return trimmed;
}

function buildAad(tenantId: string, providerId: string): Buffer {
  return Buffer.from(`${tenantId}:${providerId}:v1`, "utf8");
}

function connectionStoreKey(tenantId: string): string {
  return `tenants__${tenantId}__${COL_PORTAL_CONNECTIONS}`;
}

function secretStoreKey(tenantId: string): string {
  return `tenants__${tenantId}__${COL_PORTAL_SECRETS}`;
}

/**
 * Phase 7 Multi-Tenant Portal Credentials Vault & Connection Registry.
 *
 * Security design:
 * - Uses AES-256-GCM envelope encryption: each save generates a fresh 32-byte random DEK
 *   that encrypts the credentials JSON, then wraps the DEK using the master KEK from
 *   `process.env.PORTAL_CREDENTIALS_MASTER_KEY` (stored in Google Cloud Secret Manager).
 * - Both encryption layers bind AAD = `${tenantId}:${providerId}:v1`, so ciphertext
 *   copied across tenants or providers fails cryptographic authentication immediately.
 * - Encrypted envelopes reside strictly in backend-only `/tenants/{tid}/portal_secrets/{providerId}`
 *   (`firestore.rules: allow read, write: if false;`), never returned to browsers or logged.
 * - Connection metadata (`/tenants/{tid}/portal_connections/{providerId}`) stores zero secrets.
 */
export class PortalCredentialsService {
  private static ephemeralDevKek: Buffer | null = null;

  private static resolveMasterKek(): { key: Buffer; version: number } {
    const rawEnv = String(process.env.PORTAL_CREDENTIALS_MASTER_KEY || "").trim();
    const versionParsed = Number(process.env.PORTAL_CREDENTIALS_KEY_VERSION || "1");
    const version = Number.isFinite(versionParsed) && versionParsed >= 1 ? Math.floor(versionParsed) : 1;

    if (rawEnv) {
      // Accept 64-char hex, 32-byte base64, or derive deterministic 32-byte SHA-256 key from high-entropy passphrase
      if (/^[0-9a-fA-F]{64}$/.test(rawEnv)) {
        return { key: Buffer.from(rawEnv, "hex"), version };
      }
      const b64 = Buffer.from(rawEnv, "base64");
      if (b64.length === 32) {
        return { key: b64, version };
      }
      if (rawEnv.length >= 16) {
        return { key: crypto.createHash("sha256").update(rawEnv).digest(), version };
      }
      throw new AppError({
        message: "PORTAL_CREDENTIALS_MASTER_KEY trebuie să aibă minim 16 caractere.",
        code: "CONFIGURATION_ERROR",
        statusCode: 500,
      });
    }

    if (process.env.NODE_ENV === "production") {
      throw new AppError({
        message:
          "PORTAL_CREDENTIALS_MASTER_KEY lipsește din mediul de producție. Configurați cheia master în Secret Manager.",
        code: "CONFIGURATION_ERROR",
        statusCode: 500,
      });
    }

    // Ephemeral in-memory KEK exclusively for local dev & automated tests (never written to disk)
    if (!this.ephemeralDevKek) {
      this.ephemeralDevKek = crypto.randomBytes(32);
    }
    return { key: this.ephemeralDevKek, version };
  }

  public static encryptCredentials(params: {
    tenantId: string;
    providerId: string;
    credentials: PortalCredentialsPayload;
    updatedBy?: string | null;
  }): EncryptedPortalSecretEnvelope {
    const safeTenant = assertSafeSegment(params.tenantId, "tenantId");
    const safeProvider = assertSafeSegment(params.providerId, "providerId");
    const { key: masterKek, version } = this.resolveMasterKek();
    const aad = buildAad(safeTenant, safeProvider);

    // 1. Encrypt credentials payload with fresh random 256-bit DEK
    const dek = crypto.randomBytes(32);
    const dataIv = crypto.randomBytes(12);
    const dataCipher = crypto.createCipheriv("aes-256-gcm", dek, dataIv);
    dataCipher.setAAD(aad);
    const plaintext = Buffer.from(JSON.stringify(params.credentials || {}), "utf8");
    const ciphertext = Buffer.concat([dataCipher.update(plaintext), dataCipher.final()]);
    const authTag = dataCipher.getAuthTag();

    // 2. Wrap DEK with Master KEK + tenant/provider AAD
    const dekIv = crypto.randomBytes(12);
    const dekCipher = crypto.createCipheriv("aes-256-gcm", masterKek, dekIv);
    dekCipher.setAAD(aad);
    const wrappedDek = Buffer.concat([dekCipher.update(dek), dekCipher.final()]);
    const wrappedDekTag = dekCipher.getAuthTag();

    const now = new Date().toISOString();
    return {
      id: safeProvider,
      tenantId: safeTenant,
      providerId: safeProvider,
      algorithm: "aes-256-gcm",
      keyVersion: version,
      aadVersion: "v1",
      wrappedDekBase64: wrappedDek.toString("base64"),
      wrappedDekIvBase64: dekIv.toString("base64"),
      wrappedDekTagBase64: wrappedDekTag.toString("base64"),
      ciphertextBase64: ciphertext.toString("base64"),
      ivBase64: dataIv.toString("base64"),
      authTagBase64: authTag.toString("base64"),
      updatedBy: params.updatedBy || null,
      createdAt: now,
      updatedAt: now,
    };
  }

  public static decryptCredentials(params: {
    tenantId: string;
    providerId: string;
    envelope: EncryptedPortalSecretEnvelope;
  }): PortalCredentialsPayload {
    const safeTenant = assertSafeSegment(params.tenantId, "tenantId");
    const safeProvider = assertSafeSegment(params.providerId, "providerId");

    if (
      params.envelope.tenantId !== safeTenant ||
      params.envelope.providerId !== safeProvider
    ) {
      throw new ForbiddenError(
        "Acces refuzat: credențialele criptate aparțin altei agenții sau altui portal."
      );
    }

    const { key: masterKek } = this.resolveMasterKek();
    const aad = buildAad(safeTenant, safeProvider);

    try {
      // 1. Unwrap DEK using Master KEK + AAD
      const dekDecipher = crypto.createDecipheriv(
        "aes-256-gcm",
        masterKek,
        Buffer.from(params.envelope.wrappedDekIvBase64, "base64")
      );
      dekDecipher.setAAD(aad);
      dekDecipher.setAuthTag(Buffer.from(params.envelope.wrappedDekTagBase64, "base64"));
      const dek = Buffer.concat([
        dekDecipher.update(Buffer.from(params.envelope.wrappedDekBase64, "base64")),
        dekDecipher.final(),
      ]);

      // 2. Decrypt payload using unwrapped DEK + AAD
      const dataDecipher = crypto.createDecipheriv(
        "aes-256-gcm",
        dek,
        Buffer.from(params.envelope.ivBase64, "base64")
      );
      dataDecipher.setAAD(aad);
      dataDecipher.setAuthTag(Buffer.from(params.envelope.authTagBase64, "base64"));
      const plaintext = Buffer.concat([
        dataDecipher.update(Buffer.from(params.envelope.ciphertextBase64, "base64")),
        dataDecipher.final(),
      ]);

      const parsed = JSON.parse(plaintext.toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
      }
      return parsed as PortalCredentialsPayload;
    } catch {
      throw new ForbiddenError(
        "Decriptarea credențialelor portalului a eșuat (cheie invalidă sau date modificate)."
      );
    }
  }

  private static shouldSyncRemoteFirestore(): boolean {
    return (
      process.env.NODE_ENV !== "test" &&
      PersistentStoreService.isRemoteFirestoreConfigured() &&
      !PersistentStoreService.isUsingUserScopedToken()
    );
  }

  public static async saveConnection(params: {
    tenantId: string;
    providerId: string;
    accountLabel: string;
    credentials?: PortalCredentialsPayload;
    status?: PortalConnectionStatus;
    settings?: Record<string, string | number | boolean>;
    updatedBy?: string | null;
  }): Promise<PortalConnectionMetadata> {
    const safeTenant = assertSafeSegment(params.tenantId, "tenantId");
    const safeProvider = assertSafeSegment(params.providerId, "providerId");
    const existing = await this.getConnection(safeTenant, safeProvider);
    const now = new Date().toISOString();

    let keyVersion = existing?.credentialKeyVersion || 1;
    let hasCredentials = existing?.hasCredentials || false;

    if (params.credentials && Object.keys(params.credentials).length > 0) {
      const envelope = this.encryptCredentials({
        tenantId: safeTenant,
        providerId: safeProvider,
        credentials: params.credentials,
        updatedBy: params.updatedBy,
      });
      keyVersion = envelope.keyVersion;
      hasCredentials = true;

      PersistentStoreService.set(secretStoreKey(safeTenant), safeProvider, envelope);
      if (this.shouldSyncRemoteFirestore()) {
        await PersistentStoreService.remoteSetAtPath(
          `tenants/${safeTenant}/${COL_PORTAL_SECRETS}/${safeProvider}`,
          envelope
        ).catch(() => {});
      }
    }

    const metadata: PortalConnectionMetadata = {
      id: safeProvider,
      tenantId: safeTenant,
      providerId: safeProvider,
      accountLabel: String(params.accountLabel || existing?.accountLabel || safeProvider).trim().slice(0, 160),
      status: params.status || (hasCredentials ? "connected" : "disconnected"),
      hasCredentials,
      credentialKeyVersion: keyVersion,
      lastTestedAt: existing?.lastTestedAt ?? null,
      lastSyncedAt: existing?.lastSyncedAt ?? null,
      lastError: params.status === "connected" ? null : (existing?.lastError ?? null),
      settings: params.settings ?? existing?.settings ?? {},
      updatedBy: params.updatedBy || existing?.updatedBy || null,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    PersistentStoreService.set(connectionStoreKey(safeTenant), safeProvider, metadata);
    if (this.shouldSyncRemoteFirestore()) {
      await PersistentStoreService.remoteSetAtPath(
        `tenants/${safeTenant}/${COL_PORTAL_CONNECTIONS}/${safeProvider}`,
        metadata
      ).catch(() => {});
    }

    return metadata;
  }

  public static async updateConnectionStatus(params: {
    tenantId: string;
    providerId: string;
    status: PortalConnectionStatus;
    lastError?: string | null;
    lastTestedAt?: string | null;
    lastSyncedAt?: string | null;
    accountLabel?: string;
  }): Promise<PortalConnectionMetadata | null> {
    const safeTenant = assertSafeSegment(params.tenantId, "tenantId");
    const safeProvider = assertSafeSegment(params.providerId, "providerId");
    const existing = await this.getConnection(safeTenant, safeProvider);
    if (!existing) return null;

    const updated: PortalConnectionMetadata = {
      ...existing,
      status: params.status,
      accountLabel: params.accountLabel ? params.accountLabel.trim().slice(0, 160) : existing.accountLabel,
      lastError: params.lastError !== undefined ? params.lastError : existing.lastError,
      lastTestedAt: params.lastTestedAt !== undefined ? params.lastTestedAt : existing.lastTestedAt,
      lastSyncedAt: params.lastSyncedAt !== undefined ? params.lastSyncedAt : existing.lastSyncedAt,
      updatedAt: new Date().toISOString(),
    };

    PersistentStoreService.set(connectionStoreKey(safeTenant), safeProvider, updated);
    if (this.shouldSyncRemoteFirestore()) {
      await PersistentStoreService.remoteSetAtPath(
        `tenants/${safeTenant}/${COL_PORTAL_CONNECTIONS}/${safeProvider}`,
        updated
      ).catch(() => {});
    }
    return updated;
  }

  public static async getConnection(
    tenantId: string,
    providerId: string
  ): Promise<PortalConnectionMetadata | null> {
    const safeTenant = assertSafeSegment(tenantId, "tenantId");
    const safeProvider = assertSafeSegment(providerId, "providerId");

    const local = PersistentStoreService.get<PortalConnectionMetadata>(
      connectionStoreKey(safeTenant),
      safeProvider
    );
    if (local) return local;

    if (this.shouldSyncRemoteFirestore()) {
      const remote = await PersistentStoreService.remoteGetAtPath<PortalConnectionMetadata>(
        `tenants/${safeTenant}/${COL_PORTAL_CONNECTIONS}/${safeProvider}`
      ).catch(() => null);
      if (remote) {
        PersistentStoreService.set(connectionStoreKey(safeTenant), safeProvider, remote);
        return remote;
      }
    }
    return null;
  }

  public static async listConnections(tenantId: string): Promise<PortalConnectionMetadata[]> {
    const safeTenant = assertSafeSegment(tenantId, "tenantId");
    const localMap = PersistentStoreService.getAll<PortalConnectionMetadata>(
      connectionStoreKey(safeTenant)
    );
    return Object.values(localMap).sort((a, b) => a.providerId.localeCompare(b.providerId));
  }

  public static async loadDecryptedCredentials(
    tenantId: string,
    providerId: string
  ): Promise<PortalCredentialsPayload | null> {
    const safeTenant = assertSafeSegment(tenantId, "tenantId");
    const safeProvider = assertSafeSegment(providerId, "providerId");

    let envelope = PersistentStoreService.get<EncryptedPortalSecretEnvelope>(
      secretStoreKey(safeTenant),
      safeProvider
    );

    if (!envelope && this.shouldSyncRemoteFirestore()) {
      envelope = await PersistentStoreService.remoteGetAtPath<EncryptedPortalSecretEnvelope>(
        `tenants/${safeTenant}/${COL_PORTAL_SECRETS}/${safeProvider}`
      ).catch(() => null);
      if (envelope) {
        PersistentStoreService.set(secretStoreKey(safeTenant), safeProvider, envelope);
      }
    }

    if (!envelope) return null;
    return this.decryptCredentials({
      tenantId: safeTenant,
      providerId: safeProvider,
      envelope,
    });
  }

  public static async getEncryptedEnvelopeForAudit(
    tenantId: string,
    providerId: string
  ): Promise<EncryptedPortalSecretEnvelope | null> {
    const safeTenant = assertSafeSegment(tenantId, "tenantId");
    const safeProvider = assertSafeSegment(providerId, "providerId");
    return PersistentStoreService.get<EncryptedPortalSecretEnvelope>(
      secretStoreKey(safeTenant),
      safeProvider
    );
  }

  public static async deleteConnection(tenantId: string, providerId: string): Promise<boolean> {
    const safeTenant = assertSafeSegment(tenantId, "tenantId");
    const safeProvider = assertSafeSegment(providerId, "providerId");

    const deletedConn = PersistentStoreService.delete(connectionStoreKey(safeTenant), safeProvider);
    PersistentStoreService.delete(secretStoreKey(safeTenant), safeProvider);

    if (this.shouldSyncRemoteFirestore()) {
      await PersistentStoreService.remoteDeleteAtPath(
        `tenants/${safeTenant}/${COL_PORTAL_CONNECTIONS}/${safeProvider}`
      ).catch(() => {});
      await PersistentStoreService.remoteDeleteAtPath(
        `tenants/${safeTenant}/${COL_PORTAL_SECRETS}/${safeProvider}`
      ).catch(() => {});
    }

    return deletedConn;
  }

  public static clearForTests(tenantIds?: string[]): void {
    if (tenantIds && tenantIds.length > 0) {
      for (const tid of tenantIds) {
        PersistentStoreService.clearCollection(connectionStoreKey(tid));
        PersistentStoreService.clearCollection(secretStoreKey(tid));
      }
    }
  }
}
