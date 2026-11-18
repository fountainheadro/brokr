import { BillingInterval, CurrencyCode } from "./typ_subscription";

export interface CheckoutSessionParams {
  tenantId: string;
  agencyName: string;
  customerEmail: string;
  planId: string;
  planDisplayName: string;
  amount: number;
  currency: CurrencyCode;
  billingInterval: BillingInterval;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
}

export interface CheckoutSessionResult {
  sessionId: string;
  checkoutUrl: string;
  provider: "mock" | "stripe" | "netopia";
  expiresAt: string;
}

export interface CustomerPortalParams {
  tenantId: string;
  customerEmail: string;
  providerCustomerId?: string;
  returnUrl: string;
}

export interface CustomerPortalResult {
  portalUrl: string;
}

export interface WebhookEventPayload {
  id: string; // Event ID for idempotency
  type: string; // e.g. "checkout.session.completed", "invoice.payment_succeeded", "invoice.payment_failed"
  provider: "mock" | "stripe" | "netopia";
  createdAt: string;
  data: Record<string, any>;
}

export interface WebhookProcessResult {
  handled: boolean;
  duplicate: boolean;
  eventId: string;
  eventType: string;
  tenantId?: string;
  actionTaken?: string;
  error?: string;
}

export interface BillingProviderAdapter {
  readonly providerName: "mock" | "stripe" | "netopia";
  createCheckoutSession(params: CheckoutSessionParams): Promise<CheckoutSessionResult>;
  createCustomerPortalSession(params: CustomerPortalParams): Promise<CustomerPortalResult>;
  verifyWebhookSignature(payload: string | Buffer, signature: string): boolean;
  parseWebhookEvent(payload: any): WebhookEventPayload;
}
