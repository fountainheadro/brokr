export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  tenantId?: string;
  userId?: string;
  action?: string;
  module?: string;
  [key: string]: unknown;
}

export type OperationalMetricName =
  | "auth_failure"
  | "authz_failure"
  | "rate_limit"
  | "billing_webhook_failure"
  | "ai_job_failure"
  | "twilio_signature_rejection"
  | "ssrf_block"
  | "api_request"
  | "api_4xx"
  | "api_error";

const SECRET_KEY_RE =
  /token|secret|password|authorization|api[-_]?key|private[-_]?key|signature|credential|cookie|serviceaccount/i;

function sanitizeString(input: string): string {
  return input
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [REDACTED]")
    .replace(/\bAIza[0-9A-Za-z\-_]{20,}\b/g, "[REDACTED_GOOGLE_KEY]")
    .replace(/\bsk_(live|test)_[0-9A-Za-z]{16,}\b/g, "[REDACTED_STRIPE_KEY]")
    .replace(/\bwhsec_[0-9A-Za-z]{16,}\b/g, "[REDACTED_STRIPE_WEBHOOK]")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]");
}

export function redactSensitiveData(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[TRUNCATED]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeString(value.message),
    };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redactSensitiveData(item, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redactSensitiveData(v, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

class Logger {
  private metrics: Record<OperationalMetricName, number> = {
    auth_failure: 0,
    authz_failure: 0,
    rate_limit: 0,
    billing_webhook_failure: 0,
    ai_job_failure: 0,
    twilio_signature_rejection: 0,
    ssrf_block: 0,
    api_request: 0,
    api_4xx: 0,
    api_error: 0,
  };

  private latenciesMs: number[] = [];
  private readonly MAX_LATENCY_SAMPLES = 500;

  public recordMetric(name: OperationalMetricName, delta = 1): void {
    this.metrics[name] = (this.metrics[name] || 0) + delta;
  }

  public recordRequestLatency(durationMs: number): void {
    this.metrics.api_request += 1;
    if (this.latenciesMs.length >= this.MAX_LATENCY_SAMPLES) {
      this.latenciesMs.shift();
    }
    this.latenciesMs.push(Math.max(0, Math.round(durationMs)));
  }

  public getOperationalMetrics(): {
    counters: Record<OperationalMetricName, number>;
    latency: { samples: number; avgMs: number; p50Ms: number; p95Ms: number; maxMs: number };
    collectedAt: string;
  } {
    const sorted = [...this.latenciesMs].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((acc, v) => acc + v, 0);
    const avgMs = count > 0 ? Math.round(sum / count) : 0;
    const p50Idx = count > 0 ? Math.min(count - 1, Math.floor(count * 0.5)) : 0;
    const p50Ms = count > 0 ? sorted[p50Idx] : 0;
    const p95Idx = count > 0 ? Math.min(count - 1, Math.floor(count * 0.95)) : 0;
    const p95Ms = count > 0 ? sorted[p95Idx] : 0;
    const maxMs = count > 0 ? sorted[count - 1] : 0;

    return {
      counters: { ...this.metrics },
      latency: { samples: count, avgMs, p50Ms, p95Ms, maxMs },
      collectedAt: new Date().toISOString(),
    };
  }

  public resetMetricsForTests(): void {
    if (process.env.NODE_ENV !== "test") return;
    for (const key of Object.keys(this.metrics) as OperationalMetricName[]) {
      this.metrics[key] = 0;
    }
    this.latenciesMs = [];
  }

  private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const safeMsg = sanitizeString(message);
    if (process.env.NODE_ENV === "production") {
      return JSON.stringify({
        timestamp,
        level,
        message: safeMsg,
        ...(context ? (redactSensitiveData(context) as Record<string, unknown>) : {}),
      });
    }
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    const tenantTag = context?.tenantId ? ` [Tenant:${context.tenantId}]` : "";
    const moduleTag = context?.module ? ` [${context.module}]` : "";
    return `${prefix}${tenantTag}${moduleTag} ${safeMsg}`;
  }

  public debug(message: string, context?: LogContext) {
    if (process.env.NODE_ENV !== "production") {
      console.debug(
        this.formatMessage("debug", message, context),
        context?.meta ? redactSensitiveData(context.meta) : ""
      );
    }
  }

  public info(message: string, context?: LogContext) {
    console.log(
      this.formatMessage("info", message, context),
      process.env.NODE_ENV === "production" || !context?.meta ? "" : redactSensitiveData(context.meta)
    );
  }

  public warn(message: string, context?: LogContext) {
    console.warn(
      this.formatMessage("warn", message, context),
      process.env.NODE_ENV === "production" || !context?.meta ? "" : redactSensitiveData(context.meta)
    );
  }

  public error(message: string, error?: unknown, context?: LogContext) {
    console.error(
      this.formatMessage("error", message, context),
      error ? redactSensitiveData(error) : ""
    );
  }

  public forTenant(tenantId: string, moduleName?: string) {
    return {
      debug: (msg: string, ctx?: LogContext) => this.debug(msg, { ...ctx, tenantId, module: moduleName }),
      info: (msg: string, ctx?: LogContext) => this.info(msg, { ...ctx, tenantId, module: moduleName }),
      warn: (msg: string, ctx?: LogContext) => this.warn(msg, { ...ctx, tenantId, module: moduleName }),
      error: (msg: string, err?: unknown, ctx?: LogContext) =>
        this.error(msg, err, { ...ctx, tenantId, module: moduleName }),
    };
  }
}

export const logger = new Logger();
