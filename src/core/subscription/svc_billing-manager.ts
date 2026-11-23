import {
  BillingProviderAdapter,
  CheckoutSessionParams,
  CheckoutSessionResult,
  CustomerPortalParams,
  CustomerPortalResult,
  WebhookProcessResult,
} from "./typ_billing";
import { MockBillingProvider } from "./adapters/adp_mock-billing";
import { StripeBillingProvider } from "./adapters/adp_stripe-billing";
import { SubscriptionService } from "./svc_subscription";
import { PlatformAuditLogRepository } from "../platform/repo_platform-audit-log";
import { BillingEventsRepository, BillingEventLog } from "./repo_billing-events";
import { logger } from "../logger/logger";

export type { BillingEventLog };

export class BillingManager {
  private static mockProvider = new MockBillingProvider();
  private static stripeProvider = new StripeBillingProvider();

  public static getActiveProvider(): BillingProviderAdapter {
    if (this.stripeProvider.isConfigured()) {
      return this.stripeProvider;
    }
    return this.mockProvider;
  }

  public static getProviderStatus(): {
    activeProvider: "mock" | "stripe" | "netopia";
    stripeConfigured: boolean;
    isDevelopmentMode: boolean;
  } {
    return {
      activeProvider: this.getActiveProvider().providerName,
      stripeConfigured: this.stripeProvider.isConfigured(),
      isDevelopmentMode: !this.stripeProvider.isConfigured(),
    };
  }

  public static async createCheckoutSession(params: CheckoutSessionParams): Promise<CheckoutSessionResult> {
    const provider = this.getActiveProvider();
    return provider.createCheckoutSession(params);
  }

  public static async createCustomerPortalSession(params: CustomerPortalParams): Promise<CustomerPortalResult> {
    const provider = this.getActiveProvider();
    return provider.createCustomerPortalSession(params);
  }

  public static getEventLogs(): BillingEventLog[] {
    return BillingEventsRepository.getLogs();
  }

  /**
   * Processes incoming webhook events atomically and idempotently across instances and restarts.
   */
  public static async processWebhook(
    rawBody: string | Buffer | any,
    signature: string,
    providerName?: "mock" | "stripe"
  ): Promise<WebhookProcessResult> {
    const provider = providerName === "stripe" ? this.stripeProvider : this.getActiveProvider();

    if (
      process.env.NODE_ENV === "production" &&
      provider.providerName === "mock" &&
      process.env.ALLOW_MOCK_BILLING_IN_PRODUCTION !== "true"
    ) {
      logger.recordMetric("billing_webhook_failure");
      throw new Error("Procesarea webhook-urilor mock este dezactivată în producție.");
    }

    // 1. Signature validation
    const isValidSignature = provider.verifyWebhookSignature(rawBody, signature);
    if (!isValidSignature && provider.providerName !== "mock") {
      logger.recordMetric("billing_webhook_failure");
      throw new Error("Semnătura webhook-ului este invalidă.");
    }

    // 2. Parse event payload
    const event = provider.parseWebhookEvent(rawBody);
    if (!event?.id || !event?.type) {
      logger.recordMetric("billing_webhook_failure");
      throw new Error("Payload-ul webhook-ului nu conține un ID sau tip de eveniment valid.");
    }

    const tenantId =
      event.data?.tenantId ||
      event.data?.metadata?.tenantId ||
      event.data?.tenant_id ||
      event.data?.metadata?.tenant_id;
    const eventTs = event.createdAt ? new Date(event.createdAt).getTime() : Date.now();
    const safeEventTs = Number.isNaN(eventTs) ? Date.now() : eventTs;

    // 3. Atomic Idempotency Lock: only ONE concurrent or post-restart caller acquires this event ID
    const acquired = await BillingEventsRepository.tryAcquireEvent(event.id, {
      provider: event.provider,
      eventType: event.type,
      tenantId,
      eventTs: safeEventTs,
    });

    if (!acquired) {
      BillingEventsRepository.appendLog({
        id: event.id,
        provider: event.provider,
        eventType: event.type,
        tenantId,
        status: "duplicate",
        receivedAt: new Date().toISOString(),
      });

      return {
        handled: true,
        duplicate: true,
        eventId: event.id,
        eventType: event.type,
        tenantId,
        actionTaken: "Eveniment ignorat (deja procesat anterior).",
      };
    }

    // 4. Persistent Out-of-Order Ordering Check per tenant
    if (tenantId) {
      const subscriptionId =
        event.data?.subscriptionId || event.data?.subscription_id || event.data?.subscription || null;
      const ordering = await BillingEventsRepository.checkAndAdvanceTenantOrdering(
        tenantId,
        event.id,
        safeEventTs,
        subscriptionId
      );

      if (ordering.isStale) {
        const staleMsg = "Eveniment mai vechi decât ultima stare procesată (ignorat pentru protecție out-of-order).";
        BillingEventsRepository.markEventOutcome(event.id, "ignored", { reason: staleMsg });
        BillingEventsRepository.appendLog({
          id: event.id,
          provider: event.provider,
          eventType: event.type,
          tenantId,
          status: "ignored",
          details: { actionTaken: staleMsg },
          receivedAt: new Date().toISOString(),
        });

        return {
          handled: true,
          duplicate: false,
          eventId: event.id,
          eventType: event.type,
          tenantId,
          actionTaken: staleMsg,
        };
      }
    }

    let actionTaken = "Eveniment recepționat și înregistrat.";

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const planId =
            event.data?.planId ||
            event.data?.metadata?.planId ||
            event.data?.plan_id ||
            event.data?.metadata?.plan_id ||
            "plan_professional";
          const interval =
            event.data?.billingInterval ||
            event.data?.metadata?.billingInterval ||
            event.data?.billing_interval ||
            event.data?.metadata?.billing_interval ||
            "month";
          if (tenantId) {
            await SubscriptionService.changePlanAsync(tenantId, planId, interval, `webhook_${event.provider}`);
            actionTaken = `Abonament activat cu succes pentru planul ${planId}.`;
          }
          break;
        }

        case "invoice.payment_succeeded": {
          if (tenantId) {
            await SubscriptionService.updateStatusAsync(tenantId, "active", "Plată recurentă confirmată.", `webhook_${event.provider}`);
            actionTaken = "Plată confirmată, abonament menținut activ.";
          }
          break;
        }

        case "invoice.payment_failed": {
          if (tenantId) {
            await SubscriptionService.updateStatusAsync(
              tenantId,
              "past_due",
              "Plata recurentă a eșuat. S-a inițiat perioada de grație de 7 zile.",
              `webhook_${event.provider}`
            );
            actionTaken = "Plată eșuată, stare trecută în past_due cu perioadă de grație.";
          }
          break;
        }

        case "customer.subscription.deleted": {
          if (tenantId) {
            await SubscriptionService.updateStatusAsync(
              tenantId,
              "cancelled",
              "Abonamentul a fost anulat la furnizorul de plăți.",
              `webhook_${event.provider}`
            );
            actionTaken = "Abonament anulat conform solicitării furnizorului.";
          }
          break;
        }

        default:
          actionTaken = `Eveniment netratat specific (${event.type}).`;
          break;
      }

      BillingEventsRepository.markEventOutcome(event.id, "processed", { actionTaken });
      BillingEventsRepository.appendLog({
        id: event.id,
        provider: event.provider,
        eventType: event.type,
        tenantId,
        status: "processed",
        details: { actionTaken },
        receivedAt: new Date().toISOString(),
      });

      await PlatformAuditLogRepository.record({
        action: "billing_webhook_processed",
        actorId: `webhook_${event.provider}`,
        actorEmail: `webhook@${event.provider}.com`,
        targetType: "agency",
        targetId: tenantId || "unknown",
        tenantId,
        details: { eventId: event.id, eventType: event.type, actionTaken },
      });

      return {
        handled: true,
        duplicate: false,
        eventId: event.id,
        eventType: event.type,
        tenantId,
        actionTaken,
      };
    } catch (err: any) {
      logger.recordMetric("billing_webhook_failure");
      BillingEventsRepository.markEventOutcome(event.id, "failed", {
        error: err?.message || String(err),
      });
      BillingEventsRepository.appendLog({
        id: event.id,
        provider: event.provider,
        eventType: event.type,
        tenantId,
        status: "failed",
        details: { error: err?.message || String(err) },
        receivedAt: new Date().toISOString(),
      });

      return {
        handled: false,
        duplicate: false,
        eventId: event.id,
        eventType: event.type,
        tenantId,
        error: err?.message || String(err),
      };
    }
  }

  public static resetDefaults(): void {
    BillingEventsRepository.resetAll();
  }
}
