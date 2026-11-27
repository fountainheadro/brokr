import { PersistentStoreService } from "../database/svc_persistent-store";
import { CrmTenantStoreService } from "../crm/svc_crm-tenant-store";
import { AppError, NotFoundError } from "../errors/app_error";
import {
  PermanentJobError,
  RetryableJobError,
  TransactionalOutboxService,
  type OutboxEvent,
} from "../jobs/svc_transactional-outbox";
import { logger } from "../logger/logger";
import { MockPortalProvider } from "./adapters/adp_mock-portal";
import { StoriaPortalProvider } from "./adapters/adp_storia-portal";
import { normalizeLeadToCanonicalSpecs } from "./svc_canonical-normalizer";
import { PortalCredentialsService } from "./svc_portal-credentials";
import {
  PortalProviderError,
  type CanonicalPropertySpecs,
  type ExternalPortalProvider,
  type PortalProviderDescriptor,
  type PortalPublicationRecord,
  type PortalPublicationStatus,
  type PortalValidationResult,
} from "./typ_portal-provider";

export const COL_PORTAL_PUBLICATIONS = "portal_publications";
export const DOC_PORTAL_INTEGRATIONS_SETTING = "portal_integrations";

export interface TenantPortalIntegrationSettings {
  id: string;
  tenantId: string;
  enabledProviders: string[];
  updatedBy?: string | null;
  updatedAt: string;
}

const SAFE_ID_RE = /^[a-zA-Z0-9_.\-]{1,128}$/;

function assertSafeId(value: string, label: string): string {
  const trimmed = String(value || "").trim();
  if (!SAFE_ID_RE.test(trimmed) || trimmed === "." || trimmed === "..") {
    throw new AppError({
      message: `Identificator invalid pentru ${label}.`,
      code: "VALIDATION_ERROR",
      statusCode: 400,
    });
  }
  return trimmed;
}

function publicationStoreKey(tenantId: string): string {
  return `tenants__${tenantId}__${COL_PORTAL_PUBLICATIONS}`;
}

function tenantSettingsStoreKey(tenantId: string): string {
  return `tenants__${tenantId}__settings`;
}

export function buildPublicationDocId(propertyId: string, providerId: string): string {
  const safeProp = assertSafeId(propertyId, "propertyId");
  const safeProv = assertSafeId(providerId, "providerId");
  return `${safeProp}_${safeProv}`;
}

/**
 * Phase 7 Provider-Independent Portal Publishing Orchestrator.
 *
 * Responsibilities:
 * - Maintains registered `ExternalPortalProvider` adapters (MockPortalProvider in Phase 7;
 *   live adapters such as Storia.ro / Imobiliare.ro plug in cleanly in Phase 8+).
 * - Pre-flight validates canonical properties against each provider without ever blocking
 *   internal BROKR CRM saves.
 * - Persists per-portal lifecycle state at `/tenants/{tenantId}/portal_publications/{propertyId}_{providerId}`.
 * - Enqueues idempotent `portal_publish`, `portal_update`, and `portal_withdraw` events into the
 *   Phase 6 `TransactionalOutboxService` and processes them with clean retryable vs permanent error handling.
 */
export class PortalPublishingOrchestrator {
  private static providers = new Map<string, ExternalPortalProvider>();
  private static defaultMockProvider = new MockPortalProvider();
  private static defaultStoriaProvider = new StoriaPortalProvider();
  private static outboxHandlersRegistered = false;

  private static ensureDefaultProviders(): void {
    if (!this.providers.has(this.defaultMockProvider.providerId)) {
      this.providers.set(this.defaultMockProvider.providerId, this.defaultMockProvider);
    }
    if (!this.providers.has(this.defaultStoriaProvider.providerId)) {
      this.providers.set(this.defaultStoriaProvider.providerId, this.defaultStoriaProvider);
    }
  }

  public static getMockProviderForTests(): MockPortalProvider {
    this.ensureDefaultProviders();
    return this.defaultMockProvider;
  }

  public static getStoriaProviderForTests(): StoriaPortalProvider {
    this.ensureDefaultProviders();
    return this.defaultStoriaProvider;
  }

  public static registerProvider(provider: ExternalPortalProvider): void {
    this.ensureDefaultProviders();
    this.providers.set(provider.providerId, provider);
  }

  public static unregisterProvider(providerId: string): void {
    if (
      providerId === this.defaultMockProvider.providerId ||
      providerId === this.defaultStoriaProvider.providerId
    ) {
      return;
    }
    this.providers.delete(providerId);
  }

  public static getProvider(providerId: string): ExternalPortalProvider {
    this.ensureDefaultProviders();
    const safeProv = assertSafeId(providerId, "providerId");
    const provider = this.providers.get(safeProv);
    if (!provider) {
      throw new NotFoundError("Provider portal extern", safeProv);
    }
    return provider;
  }

  public static listProviders(): PortalProviderDescriptor[] {
    this.ensureDefaultProviders();
    return Array.from(this.providers.values()).map((p) => ({
      providerId: p.providerId,
      displayName: p.displayName,
      integrationMode: p.integrationMode,
      description: p.description,
      capabilities: p.capabilities,
    }));
  }

  /**
   * Phase 8 Per-Agency Provider Feature Flag (`portalIntegrations.enabledProviders`).
   * Live providers (such as `storia_ro`) default to OFF per agency until explicitly enabled
   * for a pilot agency, allowing instant per-agency rollback without touching live listings.
   */
  public static async getTenantPortalSettings(
    tenantId: string
  ): Promise<TenantPortalIntegrationSettings> {
    const safeTenant = assertSafeId(tenantId, "tenantId");
    const local = PersistentStoreService.get<TenantPortalIntegrationSettings>(
      tenantSettingsStoreKey(safeTenant),
      DOC_PORTAL_INTEGRATIONS_SETTING
    );
    if (local && Array.isArray(local.enabledProviders)) {
      return local;
    }

    if (this.shouldSyncRemoteFirestore()) {
      const remote = await PersistentStoreService.remoteGetAtPath<TenantPortalIntegrationSettings>(
        `tenants/${safeTenant}/settings/${DOC_PORTAL_INTEGRATIONS_SETTING}`
      ).catch(() => null);
      if (remote && Array.isArray(remote.enabledProviders)) {
        PersistentStoreService.set(
          tenantSettingsStoreKey(safeTenant),
          DOC_PORTAL_INTEGRATIONS_SETTING,
          remote
        );
        return remote;
      }
    }

    return {
      id: DOC_PORTAL_INTEGRATIONS_SETTING,
      tenantId: safeTenant,
      enabledProviders: [this.defaultMockProvider.providerId],
      updatedBy: null,
      updatedAt: new Date(0).toISOString(),
    };
  }

  public static async updateTenantPortalSettings(params: {
    tenantId: string;
    enabledProviders: string[];
    updatedBy?: string | null;
  }): Promise<TenantPortalIntegrationSettings> {
    this.ensureDefaultProviders();
    const safeTenant = assertSafeId(params.tenantId, "tenantId");
    const uniqueValid = Array.from(
      new Set(
        (params.enabledProviders || [])
          .map((id) => String(id || "").trim())
          .filter((id) => this.providers.has(id))
      )
    );

    const record: TenantPortalIntegrationSettings = {
      id: DOC_PORTAL_INTEGRATIONS_SETTING,
      tenantId: safeTenant,
      enabledProviders: uniqueValid,
      updatedBy: params.updatedBy || null,
      updatedAt: new Date().toISOString(),
    };

    PersistentStoreService.set(
      tenantSettingsStoreKey(safeTenant),
      DOC_PORTAL_INTEGRATIONS_SETTING,
      record
    );
    if (this.shouldSyncRemoteFirestore()) {
      await PersistentStoreService.remoteSetAtPath(
        `tenants/${safeTenant}/settings/${DOC_PORTAL_INTEGRATIONS_SETTING}`,
        record
      ).catch(() => {});
    }
    return record;
  }

  public static async isProviderEnabledForTenant(
    tenantId: string,
    providerId: string
  ): Promise<boolean> {
    this.ensureDefaultProviders();
    const safeProv = assertSafeId(providerId, "providerId");
    const settings = await this.getTenantPortalSettings(tenantId);
    return settings.enabledProviders.includes(safeProv);
  }

  private static shouldSyncRemoteFirestore(): boolean {
    return (
      process.env.NODE_ENV !== "test" &&
      PersistentStoreService.isRemoteFirestoreConfigured() &&
      !PersistentStoreService.isUsingUserScopedToken()
    );
  }

  private static async savePublication(record: PortalPublicationRecord): Promise<PortalPublicationRecord> {
    PersistentStoreService.set(publicationStoreKey(record.tenantId), record.id, record);
    if (this.shouldSyncRemoteFirestore()) {
      await PersistentStoreService.remoteSetAtPath(
        `tenants/${record.tenantId}/${COL_PORTAL_PUBLICATIONS}/${record.id}`,
        record
      ).catch(() => {});
    }
    return record;
  }

  public static async getPublication(
    tenantId: string,
    propertyId: string,
    providerId: string
  ): Promise<PortalPublicationRecord | null> {
    const safeTenant = assertSafeId(tenantId, "tenantId");
    const pubId = buildPublicationDocId(propertyId, providerId);

    const local = PersistentStoreService.get<PortalPublicationRecord>(
      publicationStoreKey(safeTenant),
      pubId
    );
    if (local) return local;

    if (this.shouldSyncRemoteFirestore()) {
      const remote = await PersistentStoreService.remoteGetAtPath<PortalPublicationRecord>(
        `tenants/${safeTenant}/${COL_PORTAL_PUBLICATIONS}/${pubId}`
      ).catch(() => null);
      if (remote) {
        PersistentStoreService.set(publicationStoreKey(safeTenant), pubId, remote);
        return remote;
      }
    }
    return null;
  }

  public static async listPropertyPublications(
    tenantId: string,
    propertyId: string
  ): Promise<PortalPublicationRecord[]> {
    const safeTenant = assertSafeId(tenantId, "tenantId");
    const safeProp = assertSafeId(propertyId, "propertyId");
    const all = Object.values(
      PersistentStoreService.getAll<PortalPublicationRecord>(publicationStoreKey(safeTenant))
    );
    return all
      .filter((p) => p.propertyId === safeProp)
      .sort((a, b) => a.providerId.localeCompare(b.providerId));
  }

  public static async listTenantPublications(
    tenantId: string,
    filter?: { providerId?: string; status?: PortalPublicationStatus; limit?: number }
  ): Promise<PortalPublicationRecord[]> {
    const safeTenant = assertSafeId(tenantId, "tenantId");
    let items = Object.values(
      PersistentStoreService.getAll<PortalPublicationRecord>(publicationStoreKey(safeTenant))
    );
    if (filter?.providerId) {
      items = items.filter((p) => p.providerId === filter.providerId);
    }
    if (filter?.status) {
      items = items.filter((p) => p.status === filter.status);
    }
    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return items.slice(0, filter?.limit ?? 200);
  }

  private static async loadTenantProperty(
    tenantId: string,
    propertyId: string
  ): Promise<Record<string, any>> {
    const safeTenant = assertSafeId(tenantId, "tenantId");
    const safeProp = assertSafeId(propertyId, "propertyId");
    const doc = await CrmTenantStoreService.getById(safeTenant, "leads", safeProp);
    if (!doc) {
      throw new NotFoundError("Proprietate", safeProp);
    }
    return doc;
  }

  /**
   * Pure pre-flight validation against a target provider returning Romanian field-level issues
   * without blocking BROKR CRM saves.
   */
  public static async validateProperty(params: {
    tenantId: string;
    propertyId: string;
    providerId: string;
  }): Promise<{
    canonical: CanonicalPropertySpecs;
    validation: PortalValidationResult;
    publication: PortalPublicationRecord | null;
  }> {
    const safeTenant = assertSafeId(params.tenantId, "tenantId");
    const safeProp = assertSafeId(params.propertyId, "propertyId");
    const provider = this.getProvider(params.providerId);
    const rawProperty = await this.loadTenantProperty(safeTenant, safeProp);
    const canonical = normalizeLeadToCanonicalSpecs(rawProperty);
    const validation = provider.validate(canonical, rawProperty);
    const publication = await this.getPublication(safeTenant, safeProp, provider.providerId);
    return { canonical, validation, publication };
  }

  /**
   * Pre-flight validates and enqueues a `portal_publish` or `portal_update` outbox job.
   * If validation fails, records `rejected` + `validationErrors[]` on that portal only
   * (without invalidating the property in BROKR or other portals).
   */
  public static async requestPublishOrUpdate(params: {
    tenantId: string;
    propertyId: string;
    providerId: string;
    requestedBy?: string;
  }): Promise<{
    accepted: boolean;
    publication: PortalPublicationRecord;
    validation: PortalValidationResult;
    outboxEventId?: string;
  }> {
    const safeTenant = assertSafeId(params.tenantId, "tenantId");
    const safeProp = assertSafeId(params.propertyId, "propertyId");
    const provider = this.getProvider(params.providerId);

    const enabled = await this.isProviderEnabledForTenant(safeTenant, provider.providerId);
    if (!enabled) {
      throw new AppError({
        message: `Integrarea cu portalul ${provider.displayName} nu este activată pentru această agenție.`,
        code: "MODULE_DISABLED",
        statusCode: 403,
      });
    }

    const rawProperty = await this.loadTenantProperty(safeTenant, safeProp);
    const canonical = normalizeLeadToCanonicalSpecs(rawProperty);
    const validation = provider.validate(canonical, rawProperty);
    const existing = await this.getPublication(safeTenant, safeProp, provider.providerId);
    const now = new Date().toISOString();
    const pubId = buildPublicationDocId(safeProp, provider.providerId);

    if (!validation.valid) {
      const rejectedRecord: PortalPublicationRecord = {
        id: pubId,
        tenantId: safeTenant,
        propertyId: safeProp,
        providerId: provider.providerId,
        externalListingId: existing?.externalListingId ?? null,
        externalUrl: existing?.externalUrl ?? null,
        status: "rejected",
        submittedVersion: canonical.docVersion,
        syncedVersion: existing?.syncedVersion ?? 0,
        validationErrors: validation.issues,
        lastSyncedAt: existing?.lastSyncedAt ?? null,
        lastAttemptAt: now,
        lastError: validation.issues.find((i) => i.severity === "error")?.message || "Validare eșuată.",
        lastErrorCode: "PREFLIGHT_VALIDATION_FAILED",
        retryCount: existing?.retryCount ?? 0,
        providerMeta: existing?.providerMeta ?? {},
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      await this.savePublication(rejectedRecord);
      return { accepted: false, publication: rejectedRecord, validation };
    }

    // Ensure portal connection exists if provider requires credentials
    if (provider.capabilities.requiresCredentials) {
      const conn = await PortalCredentialsService.getConnection(safeTenant, provider.providerId);
      if (!conn || !conn.hasCredentials) {
        throw new AppError({
          message: `Portalul ${provider.displayName} nu este conectat pentru această agenție. Configurați credențialele în Administrare.`,
          code: "CONFIGURATION_ERROR",
          statusCode: 400,
        });
      }
    }

    const isUpdate = Boolean(
      existing?.externalListingId &&
        existing.status !== "withdrawn" &&
        existing.status !== "not_published"
    );
    const nextStatus: PortalPublicationStatus = isUpdate ? "update_pending" : "pending";
    const eventType = isUpdate ? "portal_update" : "portal_publish";

    const pendingRecord: PortalPublicationRecord = {
      id: pubId,
      tenantId: safeTenant,
      propertyId: safeProp,
      providerId: provider.providerId,
      externalListingId: existing?.externalListingId ?? null,
      externalUrl: existing?.externalUrl ?? null,
      status: nextStatus,
      submittedVersion: canonical.docVersion,
      syncedVersion: existing?.syncedVersion ?? 0,
      validationErrors: validation.issues.filter((i) => i.severity === "warning"),
      lastSyncedAt: existing?.lastSyncedAt ?? null,
      lastAttemptAt: now,
      lastError: null,
      lastErrorCode: null,
      retryCount: 0,
      providerMeta: existing?.providerMeta ?? {},
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    await this.savePublication(pendingRecord);

    const idempotencyKey = `${eventType}:${safeTenant}:${safeProp}:${provider.providerId}:v${canonical.docVersion}:${existing?.status || "new"}`;
    const { event } = await TransactionalOutboxService.enqueue({
      eventType,
      tenantId: safeTenant,
      idempotencyKey,
      payload: {
        action: isUpdate ? "update" : "publish",
        tenantId: safeTenant,
        propertyId: safeProp,
        providerId: provider.providerId,
        submittedVersion: canonical.docVersion,
        requestedBy: params.requestedBy || "agent",
      },
    });

    return {
      accepted: true,
      publication: pendingRecord,
      validation,
      outboxEventId: event.id,
    };
  }

  public static async requestPause(params: {
    tenantId: string;
    propertyId: string;
    providerId: string;
    requestedBy?: string;
  }): Promise<{ publication: PortalPublicationRecord; outboxEventId: string }> {
    const safeTenant = assertSafeId(params.tenantId, "tenantId");
    const safeProp = assertSafeId(params.propertyId, "propertyId");
    const provider = this.getProvider(params.providerId);
    const existing = await this.getPublication(safeTenant, safeProp, provider.providerId);

    if (!existing || !existing.externalListingId) {
      throw new AppError({
        message: "Proprietatea nu este publicată activ pe acest portal.",
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    }

    const now = new Date().toISOString();
    const updated: PortalPublicationRecord = {
      ...existing,
      status: "update_pending",
      lastAttemptAt: now,
      lastError: null,
      lastErrorCode: null,
      updatedAt: now,
    };
    await this.savePublication(updated);

    const idempotencyKey = `portal_pause:${safeTenant}:${safeProp}:${provider.providerId}:${existing.externalListingId}:${Date.now()}`;
    const { event } = await TransactionalOutboxService.enqueue({
      eventType: "portal_update",
      tenantId: safeTenant,
      idempotencyKey,
      payload: {
        action: "pause",
        tenantId: safeTenant,
        propertyId: safeProp,
        providerId: provider.providerId,
        requestedBy: params.requestedBy || "agent",
      },
    });

    return { publication: updated, outboxEventId: event.id };
  }

  public static async requestWithdraw(params: {
    tenantId: string;
    propertyId: string;
    providerId: string;
    requestedBy?: string;
  }): Promise<{ publication: PortalPublicationRecord; outboxEventId: string }> {
    const safeTenant = assertSafeId(params.tenantId, "tenantId");
    const safeProp = assertSafeId(params.propertyId, "propertyId");
    const provider = this.getProvider(params.providerId);
    const existing = await this.getPublication(safeTenant, safeProp, provider.providerId);

    if (!existing || !existing.externalListingId) {
      throw new AppError({
        message: "Proprietatea nu are o publicare externă activă de retras.",
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    }

    const now = new Date().toISOString();
    const updated: PortalPublicationRecord = {
      ...existing,
      status: "withdrawal_pending",
      lastAttemptAt: now,
      lastError: null,
      lastErrorCode: null,
      updatedAt: now,
    };
    await this.savePublication(updated);

    const idempotencyKey = `portal_withdraw:${safeTenant}:${safeProp}:${provider.providerId}:${existing.externalListingId}`;
    const { event } = await TransactionalOutboxService.enqueue({
      eventType: "portal_withdraw",
      tenantId: safeTenant,
      idempotencyKey,
      payload: {
        action: "withdraw",
        tenantId: safeTenant,
        propertyId: safeProp,
        providerId: provider.providerId,
        requestedBy: params.requestedBy || "agent",
      },
    });

    return { publication: updated, outboxEventId: event.id };
  }

  public static async syncStatus(params: {
    tenantId: string;
    propertyId: string;
    providerId: string;
  }): Promise<PortalPublicationRecord> {
    const safeTenant = assertSafeId(params.tenantId, "tenantId");
    const safeProp = assertSafeId(params.propertyId, "propertyId");
    const provider = this.getProvider(params.providerId);
    const rawProperty = await this.loadTenantProperty(safeTenant, safeProp);
    const canonical = normalizeLeadToCanonicalSpecs(rawProperty);
    const existing = await this.getPublication(safeTenant, safeProp, provider.providerId);
    const credentials =
      (await PortalCredentialsService.loadDecryptedCredentials(safeTenant, provider.providerId)) || {};

    const remoteStatus = await provider.getStatus({
      tenantId: safeTenant,
      propertyId: safeProp,
      canonical,
      rawProperty,
      credentials,
      existingPublication: existing,
      idempotencyKey: `sync:${safeTenant}:${safeProp}:${provider.providerId}`,
    });

    const now = new Date().toISOString();
    const pubId = buildPublicationDocId(safeProp, provider.providerId);
    const nextRecord: PortalPublicationRecord = {
      id: pubId,
      tenantId: safeTenant,
      propertyId: safeProp,
      providerId: provider.providerId,
      externalListingId: remoteStatus.externalListingId || existing?.externalListingId || null,
      externalUrl: remoteStatus.externalUrl ?? existing?.externalUrl ?? null,
      status: remoteStatus.status,
      submittedVersion: existing?.submittedVersion ?? canonical.docVersion,
      syncedVersion: existing?.syncedVersion ?? 0,
      validationErrors: existing?.validationErrors ?? [],
      lastSyncedAt: now,
      lastAttemptAt: now,
      lastError: null,
      lastErrorCode: null,
      retryCount: existing?.retryCount ?? 0,
      providerMeta: { ...(existing?.providerMeta || {}), ...(remoteStatus.providerMeta || {}) },
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    return this.savePublication(nextRecord);
  }

  /**
   * Executes a queued portal outbox event (`portal_publish`, `portal_update`, `portal_withdraw`).
   * Maps transient provider failures (429/503/timeout) to `RetryableJobError` and permanent
   * validation/auth failures (400/401/403/422) to `PermanentJobError` without blind retries.
   */
  public static async handleOutboxEvent(event: OutboxEvent): Promise<Record<string, unknown>> {
    const tenantId = assertSafeId(String(event.payload?.tenantId || event.tenantId), "tenantId");
    const propertyId = assertSafeId(String(event.payload?.propertyId || ""), "propertyId");
    const providerId = assertSafeId(String(event.payload?.providerId || ""), "providerId");
    const action = String(event.payload?.action || event.eventType);

    const provider = this.getProvider(providerId);
    const rawProperty = await this.loadTenantProperty(tenantId, propertyId);
    const canonical = normalizeLeadToCanonicalSpecs(rawProperty);
    const existing = await this.getPublication(tenantId, propertyId, provider.providerId);
    const pubId = buildPublicationDocId(propertyId, provider.providerId);
    const now = new Date().toISOString();

    const credentials =
      (await PortalCredentialsService.loadDecryptedCredentials(tenantId, provider.providerId)) || {};

    if (provider.capabilities.requiresCredentials && Object.keys(credentials).length === 0) {
      await this.savePublication({
        id: pubId,
        tenantId,
        propertyId,
        providerId: provider.providerId,
        externalListingId: existing?.externalListingId ?? null,
        externalUrl: existing?.externalUrl ?? null,
        status: "sync_error",
        submittedVersion: existing?.submittedVersion ?? canonical.docVersion,
        syncedVersion: existing?.syncedVersion ?? 0,
        validationErrors: existing?.validationErrors ?? [],
        lastSyncedAt: existing?.lastSyncedAt ?? null,
        lastAttemptAt: now,
        lastError: "Lipsesc credențialele criptate ale portalului.",
        lastErrorCode: "MISSING_CREDENTIALS",
        retryCount: (existing?.retryCount || 0) + 1,
        providerMeta: existing?.providerMeta ?? {},
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      });
      throw new PermanentJobError("Lipsesc credențialele criptate ale portalului.");
    }

    // Transition to `publishing` before outbound provider invocation
    if (action === "publish" || action === "update") {
      await this.savePublication({
        id: pubId,
        tenantId,
        propertyId,
        providerId: provider.providerId,
        externalListingId: existing?.externalListingId ?? null,
        externalUrl: existing?.externalUrl ?? null,
        status: "publishing",
        submittedVersion: existing?.submittedVersion ?? canonical.docVersion,
        syncedVersion: existing?.syncedVersion ?? 0,
        validationErrors: existing?.validationErrors ?? [],
        lastSyncedAt: existing?.lastSyncedAt ?? null,
        lastAttemptAt: now,
        lastError: null,
        lastErrorCode: null,
        retryCount: existing?.retryCount ?? 0,
        providerMeta: existing?.providerMeta ?? {},
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      });
    }

    const opCtx = {
      tenantId,
      propertyId,
      canonical,
      rawProperty,
      credentials,
      existingPublication: existing,
      idempotencyKey: event.idempotencyKey,
    };

    try {
      let result;
      if (event.eventType === "portal_withdraw" || action === "withdraw") {
        result = await provider.withdraw(opCtx);
      } else if (action === "pause") {
        result = await provider.pause(opCtx);
      } else if (event.eventType === "portal_update" || action === "update") {
        result = await provider.update(opCtx);
      } else {
        result = await provider.publish(opCtx);
      }

      const doneAt = new Date().toISOString();
      const nextStatus: PortalPublicationStatus = result.status;
      const syncedVersion =
        nextStatus === "published" ? canonical.docVersion : (existing?.syncedVersion ?? 0);

      const saved = await this.savePublication({
        id: pubId,
        tenantId,
        propertyId,
        providerId: provider.providerId,
        externalListingId: result.externalListingId || existing?.externalListingId || null,
        externalUrl: result.externalUrl ?? null,
        status: nextStatus,
        submittedVersion: canonical.docVersion,
        syncedVersion,
        validationErrors: [],
        lastSyncedAt: doneAt,
        lastAttemptAt: doneAt,
        lastError: null,
        lastErrorCode: null,
        retryCount: 0,
        providerMeta: result.providerMeta ?? {},
        createdAt: existing?.createdAt || doneAt,
        updatedAt: doneAt,
      });

      await PortalCredentialsService.updateConnectionStatus({
        tenantId,
        providerId: provider.providerId,
        status: "connected",
        lastSyncedAt: doneAt,
        lastError: null,
      });

      return {
        publicationId: saved.id,
        status: saved.status,
        externalListingId: saved.externalListingId,
        syncedVersion: saved.syncedVersion,
      };
    } catch (err: unknown) {
      const failAt = new Date().toISOString();
      if (err instanceof PortalProviderError) {
        const nextRetryCount = (existing?.retryCount || 0) + 1;
        if (err.isAuthError) {
          await PortalCredentialsService.updateConnectionStatus({
            tenantId,
            providerId: provider.providerId,
            status: "expired",
            lastError: err.message,
          });
        }

        const isValidationReject = !err.retryable && !err.isAuthError && (err.statusCode === 400 || err.statusCode === 422);
        const failureStatus: PortalPublicationStatus = isValidationReject ? "rejected" : "sync_error";

        await this.savePublication({
          id: pubId,
          tenantId,
          propertyId,
          providerId: provider.providerId,
          externalListingId: existing?.externalListingId ?? null,
          externalUrl: existing?.externalUrl ?? null,
          status: failureStatus,
          submittedVersion: existing?.submittedVersion ?? canonical.docVersion,
          syncedVersion: existing?.syncedVersion ?? 0,
          validationErrors: err.validationIssues.length > 0 ? err.validationIssues : (existing?.validationErrors ?? []),
          lastSyncedAt: existing?.lastSyncedAt ?? null,
          lastAttemptAt: failAt,
          lastError: err.message.slice(0, 500),
          lastErrorCode: err.code,
          retryCount: nextRetryCount,
          providerMeta: existing?.providerMeta ?? {},
          createdAt: existing?.createdAt || failAt,
          updatedAt: failAt,
        });

        if (err.retryable) {
          throw new RetryableJobError(err.message);
        }
        throw new PermanentJobError(err.message);
      }

      const msg = err instanceof Error ? err.message : String(err || "Eroare sincronizare portal");
      logger.error("Unexpected portal provider failure", err instanceof Error ? err : undefined, {
        module: "portal-orchestrator",
        tenantId,
        action: event.eventType,
        providerId,
        propertyId,
      });

      await this.savePublication({
        id: pubId,
        tenantId,
        propertyId,
        providerId: provider.providerId,
        externalListingId: existing?.externalListingId ?? null,
        externalUrl: existing?.externalUrl ?? null,
        status: "sync_error",
        submittedVersion: existing?.submittedVersion ?? canonical.docVersion,
        syncedVersion: existing?.syncedVersion ?? 0,
        validationErrors: existing?.validationErrors ?? [],
        lastSyncedAt: existing?.lastSyncedAt ?? null,
        lastAttemptAt: failAt,
        lastError: msg.slice(0, 500),
        lastErrorCode: "UNEXPECTED_ERROR",
        retryCount: (existing?.retryCount || 0) + 1,
        providerMeta: existing?.providerMeta ?? {},
        createdAt: existing?.createdAt || failAt,
        updatedAt: failAt,
      });

      throw new RetryableJobError(msg);
    }
  }

  public static registerOutboxHandlers(): void {
    this.ensureDefaultProviders();
    TransactionalOutboxService.registerHandler("portal_publish", (evt) =>
      this.handleOutboxEvent(evt)
    );
    TransactionalOutboxService.registerHandler("portal_update", (evt) =>
      this.handleOutboxEvent(evt)
    );
    TransactionalOutboxService.registerHandler("portal_withdraw", (evt) =>
      this.handleOutboxEvent(evt)
    );
    this.outboxHandlersRegistered = true;
  }

  public static areOutboxHandlersRegistered(): boolean {
    return this.outboxHandlersRegistered;
  }

  public static clearForTests(tenantIds?: string[]): void {
    this.defaultMockProvider.resetForTests();
    this.defaultStoriaProvider.setTestEndpointsForTests(null);
    this.defaultStoriaProvider.clearRuntimeCachesForTests();
    if (tenantIds && tenantIds.length > 0) {
      for (const tid of tenantIds) {
        PersistentStoreService.clearCollection(publicationStoreKey(tid));
        PersistentStoreService.delete(tenantSettingsStoreKey(tid), DOC_PORTAL_INTEGRATIONS_SETTING);
      }
      PortalCredentialsService.clearForTests(tenantIds);
    }
  }
}
