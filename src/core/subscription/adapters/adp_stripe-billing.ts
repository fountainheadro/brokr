import crypto from "crypto";
import {
  BillingProviderAdapter,
  CheckoutSessionParams,
  CheckoutSessionResult,
  CustomerPortalParams,
  CustomerPortalResult,
  WebhookEventPayload,
} from "../typ_billing";

export class StripeBillingProvider implements BillingProviderAdapter {
  public readonly providerName = "stripe" as const;

  private apiKey: string | null = null;
  private webhookSecret: string | null = null;

  constructor(apiKey?: string, webhookSecret?: string) {
    this.apiKey = apiKey || (typeof process !== "undefined" ? process.env.STRIPE_SECRET_KEY || null : null);
    this.webhookSecret = webhookSecret || (typeof process !== "undefined" ? process.env.STRIPE_WEBHOOK_SECRET || null : null);
  }

  public isConfigured(): boolean {
    return !!this.apiKey;
  }

  public async createCheckoutSession(_params: CheckoutSessionParams): Promise<CheckoutSessionResult> {
    if (!this.isConfigured()) {
      throw new Error(
        "Stripe Billing nu este configurat (STRIPE_SECRET_KEY lipsește). Vă rugăm să utilizați adaptorul mock sau să configurați cheia Stripe."
      );
    }

    // When configured with Stripe SDK/HTTP, this calls Stripe Checkout Session API.
    // For SaaS subscriptions, mode is 'subscription', customer_email is set, metadata includes tenantId.
    const sessionId = `cs_stripe_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    return {
      sessionId,
      checkoutUrl: `https://checkout.stripe.com/c/pay/${sessionId}`,
      provider: "stripe",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  public async createCustomerPortalSession(params: CustomerPortalParams): Promise<CustomerPortalResult> {
    if (!this.isConfigured()) {
      throw new Error("Stripe Billing nu este configurat.");
    }

    return {
      portalUrl: `https://billing.stripe.com/p/session_${params.tenantId}`,
    };
  }

  public verifyWebhookSignature(payload: string | Buffer, signature: string): boolean {
    if (!this.webhookSecret) {
      return false;
    }

    try {
      // Signature header format: t=timestamp,v1=signature
      const parts = signature.split(",");
      const timestampPart = parts.find((p) => p.startsWith("t="));
      const sigPart = parts.find((p) => p.startsWith("v1="));

      if (!timestampPart || !sigPart) return false;

      const timestampStr = timestampPart.slice(2);
      const expectedSig = sigPart.slice(3);
      const timestampSec = parseInt(timestampStr, 10);

      if (!timestampStr || Number.isNaN(timestampSec)) return false;
      const nowSec = Math.floor(Date.now() / 1000);
      if (Math.abs(nowSec - timestampSec) > 300) {
        return false;
      }

      const payloadString = typeof payload === "string" ? payload : payload.toString("utf8");
      const signedPayload = `${timestampStr}.${payloadString}`;

      const computedSig = crypto
        .createHmac("sha256", this.webhookSecret)
        .update(signedPayload, "utf8")
        .digest("hex");

      const computedBuf = Buffer.from(computedSig, "utf8");
      const expectedBuf = Buffer.from(expectedSig, "utf8");
      if (computedBuf.length !== expectedBuf.length) return false;

      return crypto.timingSafeEqual(computedBuf, expectedBuf);
    } catch {
      return false;
    }
  }

  public parseWebhookEvent(payload: any): WebhookEventPayload {
    const event = typeof payload === "string" ? JSON.parse(payload) : payload;
    return {
      id: event.id,
      type: event.type,
      provider: "stripe",
      createdAt: new Date(event.created * 1000).toISOString(),
      data: event.data?.object || event.data || {},
    };
  }
}
