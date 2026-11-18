import crypto from "crypto";
import fs from "fs";
import path from "path";
import axios from "axios";
import { Request, Response, NextFunction } from "express";
import { UnauthorizedError } from "../../src/core/errors/app_error";
import { createErrorResponse } from "../../src/core/api/api_response";
import { logger } from "../../src/core/logger/logger";

export interface AuthenticatedUser {
  uid: string;
  email: string;
  name?: string;
  emailVerified?: boolean;
}

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthenticatedUser;
    }
  }
}

/**
 * Known mock user tokens strictly restricted to automated tests (NODE_ENV === "test").
 */
const TEST_TOKEN_MAP = new Map<string, AuthenticatedUser>([
  ["token_usr_admin_1", { uid: "usr_admin_1", email: "adrian@brokr.ro", name: "Adrian Marius", emailVerified: true }],
  ["token_usr_agent_1", { uid: "usr_agent_1", email: "agent@brokr.ro", name: "Alex Agent", emailVerified: true }],
  ["token_usr_suspended_1", { uid: "usr_suspended_1", email: "suspended@brokr.ro", name: "Suspended User", emailVerified: true }],
  ["token_usr_alpha_owner", { uid: "usr_alpha_owner", email: "owner@agency-alpha.ro", name: "Alpha Owner", emailVerified: true }],
  ["token_usr_alpha_agent", { uid: "usr_alpha_agent", email: "agent@agency-alpha.ro", name: "Alpha Agent", emailVerified: true }],
  ["token_usr_beta_owner", { uid: "usr_beta_owner", email: "owner@agency-beta.ro", name: "Beta Owner", emailVerified: true }],
  ["token_usr_multi_tenant", { uid: "usr_multi_tenant", email: "multi@example.com", name: "Multi-Agency Consultant", emailVerified: true }],
]);

const FIREBASE_CERTS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

let cachedFirebaseProjectId: string | null = null;
let cachedCerts: Record<string, string> = {};
let cachedCertsExpiresAt = 0;

function getFirebaseProjectId(): string {
  if (cachedFirebaseProjectId) return cachedFirebaseProjectId;

  try {
    const configPath = path.resolve(process.cwd(), "firebase-applet-config.json");
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (raw?.projectId && typeof raw.projectId === "string") {
        cachedFirebaseProjectId = raw.projectId;
        return cachedFirebaseProjectId;
      }
    }
  } catch {
    // Fallback to env vars
  }

  cachedFirebaseProjectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.VITE_FIREBASE_PROJECT_ID ||
    "brokr-42038";
  return cachedFirebaseProjectId;
}

function decodeBase64UrlJson<T = any>(segment: string): T | null {
  try {
    const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
    const jsonStr = Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(jsonStr) as T;
  } catch {
    return null;
  }
}

function decodeBase64UrlBuffer(segment: string): Buffer {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64");
}

async function getFirebasePublicCerts(forceRefresh = false): Promise<Record<string, string>> {
  const now = Date.now();
  if (!forceRefresh && cachedCertsExpiresAt > now && Object.keys(cachedCerts).length > 0) {
    return cachedCerts;
  }

  const res = await axios.get<Record<string, string>>(FIREBASE_CERTS_URL, {
    timeout: 5000,
  });

  if (!res.data || typeof res.data !== "object") {
    throw new Error("Nu s-au putut obține certificatele publice Firebase.");
  }

  const cacheControl = String(res.headers?.["cache-control"] || "");
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSec = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 3600;

  cachedCerts = res.data;
  cachedCertsExpiresAt = now + Math.max(60, maxAgeSec) * 1000;
  return cachedCerts;
}

export async function verifyFirebaseIdToken(idToken: string): Promise<AuthenticatedUser> {
  const parts = idToken.split(".");
  if (parts.length !== 3) {
    throw new Error("Token JWT malformat.");
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const header = decodeBase64UrlJson<{ alg?: string; kid?: string; typ?: string }>(headerB64);
  const payload = decodeBase64UrlJson<Record<string, any>>(payloadB64);

  if (!header || !payload) {
    throw new Error("Header sau payload JWT invalid.");
  }

  if (header.alg !== "RS256" || !header.kid) {
    throw new Error("Algoritm de semnare neacceptat sau lipsă kid.");
  }

  const projectId = getFirebaseProjectId();
  const expectedIssuer = `https://securetoken.google.com/${projectId}`;
  const nowSec = Math.floor(Date.now() / 1000);

  if (payload.aud !== projectId) {
    throw new Error("Audience-ul tokenului nu corespunde proiectului.");
  }
  if (payload.iss !== expectedIssuer) {
    throw new Error("Issuer-ul tokenului Firebase este invalid.");
  }
  if (!payload.sub || typeof payload.sub !== "string" || payload.sub.length > 128) {
    throw new Error("Identificatorul sub (UID) lipsește sau este invalid.");
  }
  if (typeof payload.exp !== "number" || payload.exp <= nowSec) {
    throw new Error("Tokenul de sesiune Firebase a expirat.");
  }
  if (typeof payload.iat !== "number" || payload.iat > nowSec + 300) {
    throw new Error("Tokenul are o dată iat invalidă.");
  }
  if (typeof payload.auth_time === "number" && payload.auth_time > nowSec + 300) {
    throw new Error("Tokenul are o dată auth_time invalidă.");
  }

  let certs = await getFirebasePublicCerts(false);
  let pemCert = certs[header.kid];
  if (!pemCert) {
    certs = await getFirebasePublicCerts(true);
    pemCert = certs[header.kid];
  }

  if (!pemCert) {
    throw new Error("Certificatul public pentru semnătura Firebase nu a fost găsit.");
  }

  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();

  const signatureBuf = decodeBase64UrlBuffer(signatureB64);
  const isSignatureValid = verifier.verify(pemCert, signatureBuf);
  if (!isSignatureValid) {
    throw new Error("Semnătura criptografică a tokenului Firebase este invalidă.");
  }

  return {
    uid: payload.sub,
    email: typeof payload.email === "string" ? payload.email : "",
    name: typeof payload.name === "string" ? payload.name : typeof payload.email === "string" ? payload.email : payload.sub,
    emailVerified: Boolean(payload.email_verified),
  };
}

/**
 * Shared token verifier (RS256 Firebase ID tokens in production/dev;
 * test tokens strictly restricted to NODE_ENV === "test").
 */
export async function authenticateTokenString(token: string): Promise<AuthenticatedUser> {
  const clean = (token || "").trim();
  if (!clean) {
    throw new UnauthorizedError("Token de acces invalid sau gol.");
  }

  if (process.env.NODE_ENV === "test") {
    if (TEST_TOKEN_MAP.has(clean)) {
      return TEST_TOKEN_MAP.get(clean)!;
    }

    if (clean.startsWith("mock_usr_")) {
      const uid = clean.replace("mock_", "");
      return {
        uid,
        email: `${uid}@example.com`,
        name: `User ${uid}`,
        emailVerified: true,
      };
    }
  }

  return verifyFirebaseIdToken(clean);
}

/**
 * Authentication middleware:
 * Extracts and verifies Firebase ID Bearer token (RS256).
 * Mock/test tokens are strictly restricted to NODE_ENV === "test".
 */
export function mwAuthentication(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    logger.recordMetric("auth_failure");
    const err = new UnauthorizedError("Autentificare necesară. Token-ul de autorizare Bearer lipsește.");
    res.status(err.statusCode).json(createErrorResponse(err.code, err.message));
    return;
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    logger.recordMetric("auth_failure");
    const err = new UnauthorizedError("Token de acces invalid sau gol.");
    res.status(err.statusCode).json(createErrorResponse(err.code, err.message));
    return;
  }

  authenticateTokenString(token)
    .then((verifiedUser) => {
      req.authUser = verifiedUser;
      next();
    })
    .catch(() => {
      logger.recordMetric("auth_failure");
      const err = new UnauthorizedError("Sesiune expirată sau token de autentificare invalid.");
      res.status(err.statusCode).json(createErrorResponse(err.code, err.message));
    });
}
