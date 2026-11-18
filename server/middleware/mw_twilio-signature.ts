import crypto from "crypto";
import { Request, Response, NextFunction } from "express";
import { IncomingMessage } from "http";
import { logger } from "../../src/core/logger/logger";

const STREAM_EPHEMERAL_SECRET = crypto.randomBytes(32).toString("hex");

function getTwilioSigningSecret(): string {
  return process.env.TWILIO_AUTH_TOKEN?.trim() || STREAM_EPHEMERAL_SECRET;
}

/**
 * Computes the official Twilio X-Twilio-Signature:
 * Base64(HMAC-SHA1(authToken, fullUrl + sortedPostParams))
 */
export function computeTwilioSignature(
  fullUrl: string,
  authToken: string,
  postParams?: Record<string, unknown>
): string {
  let payload = fullUrl;
  if (postParams && typeof postParams === "object" && !Array.isArray(postParams)) {
    const keys = Object.keys(postParams).sort();
    for (const key of keys) {
      const value = postParams[key];
      if (value !== undefined && value !== null) {
        payload += key + String(value);
      }
    }
  }
  return crypto.createHmac("sha1", authToken).update(payload, "utf8").digest("base64");
}

/**
 * Constant-time verification of a Twilio HMAC-SHA1 signature.
 */
export function verifyTwilioSignature(
  fullUrl: string,
  signature: string,
  authToken: string,
  postParams?: Record<string, unknown>
): boolean {
  if (!signature || !authToken || !fullUrl) return false;
  const expected = computeTwilioSignature(fullUrl, authToken, postParams);
  const sigBuf = Buffer.from(signature.trim(), "utf8");
  const expBuf = Buffer.from(expected, "utf8");
  if (sigBuf.length !== expBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

/**
 * Reconstructs canonical external URL as seen by Twilio behind a reverse proxy.
 */
export function buildCanonicalRequestUrl(req: Request): string {
  const configuredBase = (
    process.env.PLATFORM_PUBLIC_URL ||
    process.env.APP_URL ||
    ""
  )
    .trim()
    .replace(/\/+$/, "");

  const forwardedProto = req.headers["x-forwarded-proto"];
  const proto =
    typeof forwardedProto === "string"
      ? forwardedProto.split(",")[0].trim()
      : req.secure
      ? "https"
      : req.protocol || "http";

  const rawHost = req.headers["x-forwarded-host"] || req.get("host") || "";
  const host = (Array.isArray(rawHost) ? rawHost[0] : rawHost).split(",")[0].trim();

  if (configuredBase && (!host || host.includes("localhost") || host.includes("127.0.0.1"))) {
    return `${configuredBase}${req.originalUrl}`;
  }

  if (host) {
    const effectiveProto =
      process.env.NODE_ENV === "production" && !host.includes("localhost") && !host.includes("127.0.0.1")
        ? "https"
        : proto;
    return `${effectiveProto}://${host}${req.originalUrl}`;
  }

  return `${configuredBase || "http://localhost:3000"}${req.originalUrl}`;
}

/**
 * Verifies X-Twilio-Signature header on HTTP requests (GET/POST /api/ai-call/twiml).
 * Fails closed when TWILIO_AUTH_TOKEN is configured or when NODE_ENV === "production".
 */
export function mwTwilioSignature(req: Request, res: Response, next: NextFunction): void {
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const isProd = process.env.NODE_ENV === "production";
  const forceVerify = process.env.REQUIRE_TWILIO_SIGNATURE === "true";

  if (!authToken) {
    if (isProd || forceVerify) {
      logger.recordMetric("twilio_signature_rejection");
      logger.warn("Twilio webhook rejected: TWILIO_AUTH_TOKEN missing in strict mode", {
        module: "twilio-security",
        action: "twiml_reject",
      });
      res.status(403).json({
        error: "Configurare Twilio incompletă pentru verificarea semnăturii webhook-ului.",
      });
      return;
    }
    // Uncredentialed local dev/simulation mode only
    next();
    return;
  }

  const signatureHeader = req.headers["x-twilio-signature"];
  const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  if (!signature || typeof signature !== "string") {
    logger.recordMetric("twilio_signature_rejection");
    logger.warn("Twilio webhook rejected: missing X-Twilio-Signature", {
      module: "twilio-security",
      action: "twiml_missing_signature",
    });
    res.status(403).json({ error: "Lipsă semnătură X-Twilio-Signature validă." });
    return;
  }

  const postParams =
    req.method.toUpperCase() === "POST" && req.body && typeof req.body === "object"
      ? (req.body as Record<string, unknown>)
      : undefined;

  const candidateUrls = new Set<string>([buildCanonicalRequestUrl(req)]);

  // Also include raw request host URL and configured APP_URL / PLATFORM_PUBLIC_URL explicitly
  const rawHost = req.headers["x-forwarded-host"] || req.get("host") || "";
  const hostVal = (Array.isArray(rawHost) ? rawHost[0] : rawHost).split(",")[0].trim();
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protoVal =
    typeof forwardedProto === "string"
      ? forwardedProto.split(",")[0].trim()
      : req.secure
      ? "https"
      : req.protocol || "http";
  if (hostVal) {
    candidateUrls.add(`${protoVal}://${hostVal}${req.originalUrl}`);
    candidateUrls.add(`https://${hostVal}${req.originalUrl}`);
  }

  const envBase = (process.env.PLATFORM_PUBLIC_URL || process.env.APP_URL || "").trim().replace(/\/+$/, "");
  if (envBase) {
    candidateUrls.add(`${envBase}${req.originalUrl}`);
  }

  let verified = false;
  for (const candidateUrl of candidateUrls) {
    if (verifyTwilioSignature(candidateUrl, signature, authToken, postParams)) {
      verified = true;
      break;
    }
  }

  if (!verified) {
    logger.recordMetric("twilio_signature_rejection");
    logger.warn("Twilio webhook rejected: invalid X-Twilio-Signature", {
      module: "twilio-security",
      action: "twiml_invalid_signature",
    });
    res.status(403).json({ error: "Semnătură X-Twilio-Signature invalidă." });
    return;
  }

  next();
}

/**
 * Generates a short-lived HMAC-SHA256 stream parameter token embedded into TwiML <Stream>.
 */
export function createTwilioStreamToken(callSid: string): string {
  const ts = Date.now().toString();
  const payload = `${callSid}:${ts}`;
  const sig = crypto
    .createHmac("sha256", getTwilioSigningSecret())
    .update(payload)
    .digest("hex");
  return `${ts}.${sig}`;
}

export function verifyTwilioStreamToken(callSid: string, token: string, maxAgeMs = 15 * 60 * 1000): boolean {
  if (!callSid || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [tsStr, providedHex] = parts;
  const ts = parseInt(tsStr, 10);
  if (Number.isNaN(ts) || Math.abs(Date.now() - ts) > maxAgeMs) {
    return false;
  }
  const expectedHex = crypto
    .createHmac("sha256", getTwilioSigningSecret())
    .update(`${callSid}:${tsStr}`)
    .digest("hex");

  const a = Buffer.from(providedHex, "utf8");
  const b = Buffer.from(expectedHex, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Validates X-Twilio-Signature on WebSocket upgrade for /api/ai-call/stream.
 */
export function verifyTwilioWsUpgrade(request: IncomingMessage): { ok: boolean; reason?: string } {
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const isProd = process.env.NODE_ENV === "production";
  const forceVerify = process.env.REQUIRE_TWILIO_SIGNATURE === "true";

  if (!authToken) {
    if (isProd || forceVerify) {
      return { ok: false, reason: "TWILIO_AUTH_TOKEN missing in strict mode" };
    }
    return { ok: true };
  }

  const sigRaw = request.headers["x-twilio-signature"];
  const signature = Array.isArray(sigRaw) ? sigRaw[0] : sigRaw;
  if (!signature) {
    return { ok: false, reason: "Missing X-Twilio-Signature header on WebSocket upgrade" };
  }

  const hostRaw = request.headers["x-forwarded-host"] || request.headers.host || "";
  const host = (Array.isArray(hostRaw) ? hostRaw[0] : hostRaw).split(",")[0].trim();
  const protoRaw = request.headers["x-forwarded-proto"];
  const proto =
    typeof protoRaw === "string" ? protoRaw.split(",")[0].trim() : isProd ? "https" : "http";
  const reqUrl = request.url || "/api/ai-call/stream";

  const candidateUrls: string[] = [];
  if (host) {
    candidateUrls.push(`${proto}://${host}${reqUrl}`);
    candidateUrls.push(`https://${host}${reqUrl}`);
    candidateUrls.push(`wss://${host}${reqUrl}`);
    candidateUrls.push(`ws://${host}${reqUrl}`);
  }
  const envBase = (process.env.PLATFORM_PUBLIC_URL || process.env.APP_URL || "").trim().replace(/\/+$/, "");
  if (envBase) {
    candidateUrls.push(`${envBase}${reqUrl}`);
    candidateUrls.push(`${envBase.replace(/^https:/, "wss:").replace(/^http:/, "ws:")}${reqUrl}`);
  }

  for (const url of candidateUrls) {
    if (verifyTwilioSignature(url, signature, authToken)) {
      return { ok: true };
    }
  }

  return { ok: false, reason: "Invalid X-Twilio-Signature on WebSocket upgrade" };
}
