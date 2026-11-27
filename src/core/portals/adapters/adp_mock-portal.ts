import crypto from "crypto";
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
  type PortalValidationIssue,
  type PortalValidationResult,
} from "../typ_portal-provider";

export interface MockPortalStoredListing {
  externalListingId: string;
  externalUrl: string;
  tenantId: string;
  propertyId: string;
  status: PortalPublicationStatus;
  payload: Record<string, unknown>;
  docVersion: number;
  revisionCount: number;
  updatedAt: string;
}

export type MockFaultMode =
  | "none"
  | "transient_503_once"
  | "transient_503_always"
  | "permanent_400_validation"
  | "permanent_401_auth";

/**
 * Phase 7 Mock External Portal Adapter (`mock_portal`).
 *
 * Implements the full `ExternalPortalProvider` contract in memory without making any
 * live external HTTP calls, enabling complete end-to-end validation of pre-flight rules,
 * transactional outbox retries, permanent rejections, pause/withdraw flows, and tenant isolation.
 */
export class MockPortalProvider implements ExternalPortalProvider {
  public readonly providerId = "mock_portal";
  public readonly displayName = "Portal Test (Mock)";
  public readonly integrationMode = "mock" as const;
  public readonly description =
    "Adapter de testare (fără apeluri externe reale) pentru validarea fluxului de publicare, actualizare, pauză și retragere.";

  public readonly capabilities: PortalProviderCapabilities = {
    supportsInstantPublish: true,
    supportsUpdate: true,
    supportsPause: true,
    supportsWithdraw: true,
    supportsStatusSync: true,
    supportsMediaOrdering: true,
    requiresCredentials: true,
  };

  private listings = new Map<string, MockPortalStoredListing>();
  private faultMode: MockFaultMode = "none";
  private transientFailuresRemaining = 0;

  public setFaultModeForTests(mode: MockFaultMode, transientCount = 1): void {
    this.faultMode = mode;
    this.transientFailuresRemaining = mode === "transient_503_once" ? Math.max(1, transientCount) : 0;
  }

  public resetForTests(): void {
    this.listings.clear();
    this.faultMode = "none";
    this.transientFailuresRemaining = 0;
  }

  public getStoredListingForTests(externalListingId: string): MockPortalStoredListing | null {
    return this.listings.get(externalListingId) || null;
  }

  public validate(canonical: CanonicalPropertySpecs): PortalValidationResult {
    const issues: PortalValidationIssue[] = [];

    if (!canonical.title || canonical.title.trim().length < 10) {
      issues.push({
        field: "title",
        code: "MISSING_OR_SHORT_TITLE",
        message: `Titlul proprietății trebuie să aibă minim 10 caractere pentru ${this.displayName}.`,
        severity: "error",
      });
    }

    if (!canonical.priceNumeric || canonical.priceNumeric <= 0) {
      issues.push({
        field: "priceNumeric",
        code: "MISSING_PRICE",
        message: `Lipsește prețul numeric valid pentru ${this.displayName}.`,
        severity: "error",
      });
    }

    if (canonical.category !== "land" && (!canonical.usefulAreaSqm || canonical.usefulAreaSqm <= 0)) {
      issues.push({
        field: "usefulAreaSqm",
        code: "MISSING_USEFUL_AREA",
        message: `Lipsește suprafața utilă (mp) pentru ${this.displayName}.`,
        severity: "error",
      });
    }

    if (!canonical.geo.city && !canonical.geo.zone) {
      issues.push({
        field: "geo.city",
        code: "MISSING_LOCATION",
        message: `Lipsește localitatea sau zona proprietății pentru ${this.displayName}.`,
        severity: "error",
      });
    }

    if (
      (canonical.category === "apartment" ||
        canonical.category === "studio" ||
        canonical.category === "house_villa") &&
      !canonical.constructionYear
    ) {
      issues.push({
        field: "constructionYear",
        code: "MISSING_CONSTRUCTION_YEAR",
        message: `Lipsește anul construcției pentru ${this.displayName}.`,
        severity: "error",
      });
    }

    if (!canonical.orderedMedia || canonical.orderedMedia.length === 0) {
      issues.push({
        field: "orderedMedia",
        code: "MISSING_PHOTOS",
        message: `Este necesară cel puțin o fotografie pentru publicarea pe ${this.displayName}.`,
        severity: "error",
      });
    }

    if (!canonical.description || canonical.description.length < 30) {
      issues.push({
        field: "description",
        code: "SHORT_DESCRIPTION",
        message: "Descrierea este scurtă; o descriere detaliată crește vizibilitatea anunțului.",
        severity: "warning",
      });
    }

    return {
      valid: !issues.some((i) => i.severity === "error"),
      issues,
    };
  }

  public mapPayload(canonical: CanonicalPropertySpecs): Record<string, unknown> {
    return {
      externalRef: canonical.propertyId,
      transaction: canonical.transactionType,
      category: canonical.category,
      title: canonical.title,
      description: canonical.description,
      price: {
        amount: canonical.priceNumeric,
        currency: canonical.currencyCode,
      },
      specs: {
        rooms: canonical.roomsCount,
        bedrooms: canonical.bedroomsCount,
        bathrooms: canonical.bathroomsCount,
        usefulAreaSqm: canonical.usefulAreaSqm,
        builtAreaSqm: canonical.builtAreaSqm,
        landAreaSqm: canonical.landAreaSqm,
        floor: canonical.floorNumber,
        totalFloors: canonical.totalFloors,
        constructionYear: canonical.constructionYear,
      },
      location: canonical.geo,
      media: canonical.orderedMedia.map((m) => ({
        id: m.mediaId,
        url: m.url,
        cover: m.isCover,
        order: m.sortOrder,
      })),
      docVersion: canonical.docVersion,
    };
  }

  private evaluateFaults(credentials: PortalCredentialsPayload): void {
    const apiKey = String(credentials?.apiKey || "").trim();
    if (!apiKey || apiKey === "EXPIRED_TOKEN" || this.faultMode === "permanent_401_auth") {
      throw new PortalProviderError({
        message: "Credențialele portalului au expirat sau sunt invalide (401 Unauthorized).",
        statusCode: 401,
        code: "PORTAL_AUTH_EXPIRED",
        retryable: false,
        isAuthError: true,
      });
    }

    if (this.faultMode === "permanent_400_validation" || credentials?.simulateFault === "permanent_400") {
      throw new PortalProviderError({
        message: "Portalul extern a respins anunțul: câmpul zonă nu corespunde nomenclatorului.",
        statusCode: 400,
        code: "PORTAL_REMOTE_VALIDATION_FAILED",
        retryable: false,
        validationIssues: [
          {
            field: "geo.zone",
            code: "INVALID_REMOTE_ZONE",
            message: "Zona nu a fost recunoscută în nomenclatorul portalului.",
            severity: "error",
          },
        ],
      });
    }

    if (this.faultMode === "transient_503_always" || credentials?.simulateFault === "transient_503") {
      throw new PortalProviderError({
        message: "Portalul extern este temporar indisponibil (503 Service Unavailable).",
        statusCode: 503,
        code: "PORTAL_SERVICE_UNAVAILABLE",
        retryable: true,
      });
    }

    if (this.faultMode === "transient_503_once" && this.transientFailuresRemaining > 0) {
      this.transientFailuresRemaining--;
      throw new PortalProviderError({
        message: "Timeout temporar la comunicarea cu portalul extern (503).",
        statusCode: 503,
        code: "PORTAL_TRANSIENT_TIMEOUT",
        retryable: true,
      });
    }
  }

  public async testCredentials(
    credentials: PortalCredentialsPayload
  ): Promise<{ ok: boolean; accountLabel?: string; message?: string }> {
    const apiKey = String(credentials?.apiKey || "").trim();
    if (!apiKey || apiKey.length < 4 || apiKey === "EXPIRED_TOKEN") {
      return {
        ok: false,
        message: "Cheia API de test este invalidă sau expirată (minim 4 caractere).",
      };
    }
    return {
      ok: true,
      accountLabel: String(credentials?.agencyCode || "Cont Sandbox Mock").trim(),
      message: "Conexiune sandbox verificată cu succes.",
    };
  }

  public async publish(ctx: PortalOperationContext): Promise<PortalPublishResult> {
    this.evaluateFaults(ctx.credentials);
    const validation = this.validate(ctx.canonical);
    if (!validation.valid) {
      throw new PortalProviderError({
        message: validation.issues.find((i) => i.severity === "error")?.message || "Date incomplete.",
        statusCode: 400,
        code: "PORTAL_VALIDATION_FAILED",
        retryable: false,
        validationIssues: validation.issues,
      });
    }

    const existingId = ctx.existingPublication?.externalListingId;
    const externalListingId =
      existingId ||
      `mock_${crypto
        .createHash("sha256")
        .update(`${ctx.tenantId}:${ctx.propertyId}`)
        .digest("hex")
        .slice(0, 12)}`;
    const externalUrl = `https://sandbox.mock-portal.brokr.local/anunt/${externalListingId}`;
    const prev = this.listings.get(externalListingId);
    const payload = this.mapPayload(ctx.canonical);

    this.listings.set(externalListingId, {
      externalListingId,
      externalUrl,
      tenantId: ctx.tenantId,
      propertyId: ctx.propertyId,
      status: "published",
      payload,
      docVersion: ctx.canonical.docVersion,
      revisionCount: (prev?.revisionCount || 0) + 1,
      updatedAt: new Date().toISOString(),
    });

    return {
      externalListingId,
      externalUrl,
      status: "published",
      providerMeta: {
        revisionCount: (prev?.revisionCount || 0) + 1,
        mediaCount: ctx.canonical.orderedMedia.length,
        priceNumeric: ctx.canonical.priceNumeric,
      },
    };
  }

  public async update(ctx: PortalOperationContext): Promise<PortalPublishResult> {
    return this.publish(ctx);
  }

  public async pause(ctx: PortalOperationContext): Promise<PortalPublishResult> {
    this.evaluateFaults(ctx.credentials);
    const externalListingId = ctx.existingPublication?.externalListingId;
    if (!externalListingId || !this.listings.has(externalListingId)) {
      throw new PortalProviderError({
        message: "Anunțul nu este publicat pe portal pentru a putea fi pus pe pauză.",
        statusCode: 404,
        code: "PORTAL_LISTING_NOT_FOUND",
        retryable: false,
      });
    }

    const existing = this.listings.get(externalListingId)!;
    const updated: MockPortalStoredListing = {
      ...existing,
      status: "paused",
      updatedAt: new Date().toISOString(),
    };
    this.listings.set(externalListingId, updated);

    return {
      externalListingId: updated.externalListingId,
      externalUrl: updated.externalUrl,
      status: "paused",
      providerMeta: { revisionCount: updated.revisionCount },
    };
  }

  public async withdraw(ctx: PortalOperationContext): Promise<PortalPublishResult> {
    this.evaluateFaults(ctx.credentials);
    const externalListingId = ctx.existingPublication?.externalListingId;
    if (!externalListingId || !this.listings.has(externalListingId)) {
      return {
        externalListingId: externalListingId || "",
        externalUrl: null,
        status: "withdrawn",
      };
    }

    const existing = this.listings.get(externalListingId)!;
    const updated: MockPortalStoredListing = {
      ...existing,
      status: "withdrawn",
      updatedAt: new Date().toISOString(),
    };
    this.listings.set(externalListingId, updated);

    return {
      externalListingId: updated.externalListingId,
      externalUrl: null,
      status: "withdrawn",
      providerMeta: { withdrawnAt: updated.updatedAt },
    };
  }

  public async getStatus(ctx: PortalOperationContext): Promise<PortalStatusResult> {
    this.evaluateFaults(ctx.credentials);
    const externalListingId = ctx.existingPublication?.externalListingId || "";
    const existing = externalListingId ? this.listings.get(externalListingId) : undefined;
    if (!existing) {
      return {
        externalListingId,
        externalUrl: null,
        status: "not_published",
      };
    }
    return {
      externalListingId: existing.externalListingId,
      externalUrl: existing.status === "withdrawn" ? null : existing.externalUrl,
      status: existing.status,
      providerMeta: {
        docVersion: existing.docVersion,
        revisionCount: existing.revisionCount,
      },
    };
  }
}
