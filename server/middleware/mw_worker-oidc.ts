import crypto from "crypto";
import axios from "axios";
import type { Request, Response, NextFunction } from "express";
import { createErrorResponse } from "../../src/core/api/api_response";
import { logger } from "../../src/core/logger/logger";

export interface VerifiedWorkerIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  issuer: string;
  audience: string;
  issuedAt: number;
  expiresAt: number;
}

declare global {
  namespace Express {
    interface Request {
      workerIdentity?: VerifiedWorkerIdentity;
    }
  }
}

const GOOGLE_OIDC_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const VALID_OIDC_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

interface JwkKey {
  kid: string;
  kty: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

let cachedJwks: Record<string, crypto.KeyObject> = {};
let cachedJwksExpiresAt = 0;
let testPublicKeyOverrides: Record<string, string | crypto.KeyObject> | null = null;

/**
 * Allows automated security tests to inject an ephemeral RSA public key by `kid`
 * without making live network calls to Google OAuth JWKS.
 */
export function setWorkerOidcTestKeys(
  keys: Record<string, string | crypto.KeyObject> | null
): void {
  testPublicKeyOverrides = keys;
}

function decodeBase64UrlJson<T = Record<string, any>>(segment: string): T | null {
  try {
    const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as T;
  } catch {
    return null;
  }
}

function decodeBase64UrlBuffer(segment: string): Buffer {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64");
}

async function getGoogleOidcKey(
  kid: string,
  forceRefresh = false
): Promise<crypto.KeyObject | null> {
  if (testPublicKeyOverrides && testPublicKeyOverrides[kid]) {
    const k = testPublicKeyOverrides[kid];
    return typeof k === "string" ? crypto.createPublicKey(k) : k;
  }

  const now = Date.now();
  if (!forceRefresh && cachedJwksExpiresAt > now && cachedJwks[kid]) {
    return cachedJwks[kid];
  }

  const res = await axios.get<{ keys?: JwkKey[] }>(GOOGLE_OIDC_JWKS_URL, {
    timeout: 5_000,
  });

  const keys = Array.isArray(res.data?.keys) ? res.data.keys : [];
  const nextMap: Record<string, crypto.KeyObject> = {};
  for (const jwk of keys) {
    if (jwk?.kid && jwk.kty === "RSA" && jwk.n && jwk.e) {
      try {
        nextMap[jwk.kid] = crypto.createPublicKey({
          key: jwk as unknown as crypto.JsonWebKey,
          format: "jwk",
        });
      } catch {
        // Ignore malformed JWK entries
      }
    }
  }

  const cacheControl = String(res.headers?.["cache-control"] || "");
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSec = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 3600;
  cachedJwks = nextMap;
  cachedJwksExpiresAt = now + Math.max(60, maxAgeSec) * 1000;

  return cachedJwks[kid] || null;
}

function resolveAllowedAudiences(explicitAudience?: string): string[] {
  const raw =
    explicitAudience ||
    process.env.WORKER_OIDC_AUDIENCE ||
    process.env.APP_URL ||
    "";
  return raw
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

function resolveAllowedEmails(explicitEmails?: string[]): string[] {
  if (explicitEmails && explicitEmails.length > 0) {
    return explicitEmails.map((e) => e.trim().toLowerCase()).filter(Boolean);
  }
  const raw = process.env.WORKER_OIDC_ALLOWED_EMAILS || "";
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export interface VerifyWorkerOidcOptions {
  expectedAudience?: string;
  allowedEmails?: string[];
}

/**
 * Verifies a Google Cloud Scheduler / Cloud Tasks RS256 OIDC ID token.
 * Fails closed on missing/malformed JWT, bad signature, wrong issuer/audience,
 * unverified email, or service account email not present in the allowlist.
 */
export async function verifyGoogleWorkerOidcToken(
  token: string,
  options?: VerifyWorkerOidcOptions
): Promise<VerifiedWorkerIdentity> {
  const clean = (token || "").trim();
  const parts = clean.split(".");
  if (parts.length !== 3) {
    throw new Error("Token OIDC malformat.");
  }

  const [headerB64, payloadB64, sigB64] = parts;
  const header = decodeBase64UrlJson<{ alg?: string; kid?: string }>(headerB64);
  const payload = decodeBase64UrlJson<Record<string, any>>(payloadB64);

  if (!header || !payload) {
    throw new Error("Header sau payload OIDC invalid.");
  }
  if (header.alg !== "RS256" || !header.kid) {
    throw new Error("Algoritm OIDC neacceptat (doar RS256) sau kid lipsă.");
  }

  if (!payload.iss || !VALID_OIDC_ISSUERS.has(String(payload.iss))) {
    throw new Error("Issuer OIDC invalid.");
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= nowSec) {
    throw new Error("Tokenul OIDC a expirat.");
  }
  if (typeof payload.iat !== "number" || payload.iat > nowSec + 300) {
    throw new Error("Tokenul OIDC are iat invalid.");
  }

  const allowedAudiences = resolveAllowedAudiences(options?.expectedAudience);
  if (allowedAudiences.length === 0) {
    throw new Error("WORKER_OIDC_AUDIENCE nu este configurat; accesul la rutele interne este blocat fail-closed.");
  }
  const tokenAud = String(payload.aud || "").trim().replace(/\/+$/, "");
  if (!tokenAud || !allowedAudiences.includes(tokenAud)) {
    throw new Error("Audience-ul tokenului OIDC nu corespunde serviciului.");
  }

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const emailVerified = payload.email_verified === true;
  if (!email || !emailVerified) {
    throw new Error("Tokenul OIDC nu conține un email verificat de Service Account.");
  }

  const allowedEmails = resolveAllowedEmails(options?.allowedEmails);
  if (allowedEmails.length === 0) {
    throw new Error("WORKER_OIDC_ALLOWED_EMAILS nu este configurat; accesul la rutele interne este blocat fail-closed.");
  }
  if (!allowedEmails.includes(email)) {
    throw new Error("Service Account-ul OIDC nu este în lista autorizată pentru worker.");
  }

  let pubKey = await getGoogleOidcKey(header.kid, false);
  if (!pubKey) {
    pubKey = await getGoogleOidcKey(header.kid, true);
  }
  if (!pubKey) {
    throw new Error("Cheia publică OIDC pentru semnătură nu a fost găsită.");
  }

  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  const isValid = verifier.verify(pubKey, decodeBase64UrlBuffer(sigB64));
  if (!isValid) {
    throw new Error("Semnătura criptografică a tokenului OIDC este invalidă.");
  }

  return {
    sub: String(payload.sub || ""),
    email,
    emailVerified,
    issuer: String(payload.iss),
    audience: tokenAud,
    issuedAt: payload.iat,
    expiresAt: payload.exp,
  };
}

/**
 * Express middleware protecting internal Cloud Tasks / Cloud Scheduler worker routes.
 * Rejects unauthenticated or unauthorized calls with HTTP 403.
 */
export function requireWorkerOidc(options?: VerifyWorkerOidcOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      logger.recordMetric("auth_failure");
      res
        .status(403)
        .json(createErrorResponse("FORBIDDEN", "Acces interzis: ruta internă necesită token Google OIDC valid."));
      return;
    }

    const token = authHeader.substring(7).trim();
    if (!token) {
      logger.recordMetric("auth_failure");
      res
        .status(403)
        .json(createErrorResponse("FORBIDDEN", "Acces interzis: token OIDC lipsă."));
      return;
    }

    try {
      const identity = await verifyGoogleWorkerOidcToken(token, options);
      req.workerIdentity = identity;
      next();
    } catch (err: any) {
      logger.recordMetric("auth_failure");
      logger.warn("Blocked unauthorized internal worker invocation", {
        module: "worker-oidc",
        action: req.path,
        meta: { reason: err?.message || "invalid_oidc" },
      });
      res
        .status(403)
        .json(createErrorResponse("FORBIDDEN", "Acces interzis: token Google OIDC invalid sau neautorizat."));
    }
  };
}
