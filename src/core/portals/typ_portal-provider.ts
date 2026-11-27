/**
 * Phase 7: External Property Portal Publishing Foundation — Provider-Independent Contracts
 *
 * Defines the canonical normalized property structure, portal connection & publication
 * lifecycle types, and the ExternalPortalProvider adapter interface so future Romanian
 * portals (Storia.ro, Imobiliare.ro, Publi24.ro) plug in cleanly without altering core CRM code.
 */

export type CanonicalCurrencyCode = "EUR" | "RON" | "USD";
export type CanonicalTransactionType = "sale" | "rent";

export type CanonicalPropertyCategory =
  | "apartment"
  | "studio"
  | "house_villa"
  | "land"
  | "commercial"
  | "office"
  | "industrial"
  | "other";

export interface CanonicalGeoLocation {
  county: string;
  city: string;
  sector?: string;
  zone?: string;
  lat?: number;
  lng?: number;
}

export interface CanonicalOrderedMedia {
  mediaId: string;
  url: string;
  isCover: boolean;
  category: string;
  sortOrder: number;
}

/**
 * Backward-compatible typed structured property specifications derived from BROKR's
 * canonical Lead/Property record without mutating any existing freeform Romanian fields.
 */
export interface CanonicalPropertySpecs {
  schemaVersion: 1;
  propertyId: string;
  docVersion: number;
  transactionType: CanonicalTransactionType;
  category: CanonicalPropertyCategory;
  title: string;
  description: string;
  priceNumeric: number | null;
  currencyCode: CanonicalCurrencyCode;
  roomsCount: number | null;
  bedroomsCount: number | null;
  bathroomsCount: number | null;
  usefulAreaSqm: number | null;
  builtAreaSqm: number | null;
  landAreaSqm: number | null;
  floorNumber: number | null;
  totalFloors: number | null;
  constructionYear: number | null;
  partitioning?: string;
  furnishing?: string;
  parking?: string;
  heating?: string;
  energyClass?: string;
  geo: CanonicalGeoLocation;
  orderedMedia: CanonicalOrderedMedia[];
  normalizedAt: string;
}

/**
 * Strictly namespaced provider-specific overrides so portal quirks never pollute canonical fields.
 * Example: `{ storia: { promotionTier: "top" }, imobiliare: { localityCode: "1234" } }`
 */
export type PortalExtensionsMap = Record<string, Record<string, unknown>>;

export type PortalIntegrationMode = "api" | "xml_feed" | "mock";

export type PortalConnectionStatus = "disconnected" | "connected" | "error" | "expired";

export type PortalPublicationStatus =
  | "not_published"
  | "ready"
  | "pending"
  | "publishing"
  | "published"
  | "update_pending"
  | "rejected"
  | "paused"
  | "withdrawal_pending"
  | "withdrawn"
  | "sync_error";

export interface PortalValidationIssue {
  field: string;
  code: string;
  message: string;
  severity: "error" | "warning";
}

export interface PortalValidationResult {
  valid: boolean;
  issues: PortalValidationIssue[];
}

export interface PortalProviderCapabilities {
  supportsInstantPublish: boolean;
  supportsUpdate: boolean;
  supportsPause: boolean;
  supportsWithdraw: boolean;
  supportsStatusSync: boolean;
  supportsMediaOrdering: boolean;
  requiresCredentials: boolean;
}

export interface PortalProviderDescriptor {
  providerId: string;
  displayName: string;
  integrationMode: PortalIntegrationMode;
  description: string;
  capabilities: PortalProviderCapabilities;
}

/**
 * Stored at `/tenants/{tenantId}/portal_connections/{providerId}`.
 * Contains operational metadata ONLY — never raw API keys, OAuth tokens, or ciphertext.
 */
export interface PortalConnectionMetadata {
  id: string;
  tenantId: string;
  providerId: string;
  accountLabel: string;
  status: PortalConnectionStatus;
  hasCredentials: boolean;
  credentialKeyVersion: number;
  lastTestedAt?: string | null;
  lastSyncedAt?: string | null;
  lastError?: string | null;
  settings?: Record<string, string | number | boolean>;
  updatedBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Stored strictly in backend-only `/tenants/{tenantId}/portal_secrets/{providerId}`
 * with Firestore Rules `allow read, write: if false;`.
 * Uses AES-256-GCM envelope encryption (DEK wrapped by Secret Manager Master KEK).
 */
export interface EncryptedPortalSecretEnvelope {
  id: string;
  tenantId: string;
  providerId: string;
  algorithm: "aes-256-gcm";
  keyVersion: number;
  aadVersion: "v1";
  wrappedDekBase64: string;
  wrappedDekIvBase64: string;
  wrappedDekTagBase64: string;
  ciphertextBase64: string;
  ivBase64: string;
  authTagBase64: string;
  updatedBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Stored at `/tenants/{tenantId}/portal_publications/{propertyId}_{providerId}`.
 * Tracks independent per-portal lifecycle state without invalidating the canonical BROKR property.
 */
export interface PortalPublicationRecord {
  id: string;
  tenantId: string;
  propertyId: string;
  providerId: string;
  externalListingId?: string | null;
  externalUrl?: string | null;
  status: PortalPublicationStatus;
  submittedVersion: number;
  syncedVersion: number;
  validationErrors: PortalValidationIssue[];
  lastSyncedAt?: string | null;
  lastAttemptAt?: string | null;
  lastError?: string | null;
  lastErrorCode?: string | null;
  retryCount: number;
  providerMeta?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type PortalCredentialsPayload = Record<string, string | number | boolean | undefined>;

export interface PortalOperationContext {
  tenantId: string;
  propertyId: string;
  canonical: CanonicalPropertySpecs;
  rawProperty: Record<string, any>;
  credentials: PortalCredentialsPayload;
  existingPublication?: PortalPublicationRecord | null;
  idempotencyKey: string;
}

export interface PortalPublishResult {
  externalListingId: string;
  externalUrl?: string | null;
  status: "published" | "paused" | "withdrawn" | "pending";
  providerMeta?: Record<string, unknown>;
}

export interface PortalStatusResult {
  externalListingId: string;
  externalUrl?: string | null;
  status: PortalPublicationStatus;
  providerMeta?: Record<string, unknown>;
}

export class PortalProviderError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly retryable: boolean;
  public readonly validationIssues: PortalValidationIssue[];
  public readonly isAuthError: boolean;

  constructor(params: {
    message: string;
    statusCode: number;
    code: string;
    retryable: boolean;
    validationIssues?: PortalValidationIssue[];
    isAuthError?: boolean;
  }) {
    super(params.message);
    this.name = "PortalProviderError";
    this.statusCode = params.statusCode;
    this.code = params.code;
    this.retryable = params.retryable;
    this.validationIssues = params.validationIssues || [];
    this.isAuthError = Boolean(params.isAuthError || params.statusCode === 401 || params.statusCode === 403);
  }
}

/**
 * Provider-Independent External Portal Adapter Interface.
 * Phase 7 ships `MockPortalProvider`; Phase 8+ adds Storia.ro, Imobiliare.ro, Publi24.ro adapters.
 */
export interface ExternalPortalProvider {
  readonly providerId: string;
  readonly displayName: string;
  readonly integrationMode: PortalIntegrationMode;
  readonly description: string;
  readonly capabilities: PortalProviderCapabilities;

  validate(
    canonical: CanonicalPropertySpecs,
    rawProperty?: Record<string, any>
  ): PortalValidationResult;

  mapPayload(
    canonical: CanonicalPropertySpecs,
    rawProperty?: Record<string, any>
  ): Record<string, unknown>;

  testCredentials(
    credentials: PortalCredentialsPayload
  ): Promise<{ ok: boolean; accountLabel?: string; message?: string }>;

  publish(ctx: PortalOperationContext): Promise<PortalPublishResult>;

  update(ctx: PortalOperationContext): Promise<PortalPublishResult>;

  pause(ctx: PortalOperationContext): Promise<PortalPublishResult>;

  withdraw(ctx: PortalOperationContext): Promise<PortalPublishResult>;

  getStatus(ctx: PortalOperationContext): Promise<PortalStatusResult>;
}
