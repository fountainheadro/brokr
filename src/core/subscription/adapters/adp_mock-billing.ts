import {
  BillingProviderAdapter,
  CheckoutSessionParams,
  CheckoutSessionResult,
  CustomerPortalParams,
  CustomerPortalResult,
  WebhookEventPayload,
} from "../typ_billing";

/**
 * Mock Billing Provider Adapter:
 * Used for development, testing, and simulation environments without charging real payment cards.
 * Clearly labeled as development simulator.
 */
export class MockBillingProvider implements BillingProviderAdapter {
  public readonly providerName = "mock" as const;

  public async createCheckoutSession(params: CheckoutSessionParams): Promise<CheckoutSessionResult> {
    const sessionId = `cs_mock_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const checkoutUrl = `${params.successUrl}?session_id=${sessionId}&provider=mock&plan_id=${params.planId}&simulated=true`;

    return {
      sessionId,
      checkoutUrl,
      provider: "mock",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  public async createCustomerPortalSession(params: CustomerPortalParams): Promise<CustomerPortalResult> {
    return {
      portalUrl: `${params.returnUrl}?portal_simulated=true&tenant=${params.tenantId}`,
    };
  }

  public verifyWebhookSignature(_payload: string | Buffer, signature: string): boolean {
    // In mock mode, accepts any signature matching "mock_sig_*" or non-empty in test
    return !!signature && signature.length > 5;
  }

  public parseWebhookEvent(payload: any): WebhookEventPayload {
    const body = typeof payload === "string" ? JSON.parse(payload) : payload;
    return {
      id: body.id || `evt_mock_${Date.now()}`,
      type: body.type || "checkout.session.completed",
      provider: "mock",
      createdAt: body.createdAt || body.created_at || new Date().toISOString(),
      data: body.data || body,
    };
  }
}
