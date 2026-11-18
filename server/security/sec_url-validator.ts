import dns from "dns/promises";
import net from "net";
import http2 from "node:http2";
import zlib from "node:zlib";
import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import { logger } from "../../src/core/logger/logger";

export const DEFAULT_MAX_EXTERNAL_BYTES = 15 * 1024 * 1024; // 15 MB

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
  "metadata",
  "169.254.169.254",
  "0.0.0.0",
  "::1",
  "::",
]);

/**
 * Checks whether an IPv4 or IPv6 address belongs to loopback, link-local,
 * private (RFC1918/ULA), CGNAT, or reserved ranges that must never be reached via SSRF.
 */
export function isPrivateOrReservedIp(rawIp: string): boolean {
  let ip = rawIp.trim().toLowerCase();
  if (ip.startsWith("::ffff:")) {
    ip = ip.slice(7);
  }

  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map((n) => parseInt(n, 10));
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
      return true;
    }
    const [a, b] = parts;
    if (a === 0) return true;
    if (a === 10) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true;
    return false;
  }

  if (net.isIPv6(ip)) {
    const zoneIdx = ip.indexOf("%");
    if (zoneIdx !== -1) ip = ip.slice(0, zoneIdx);

    if (ip === "::" || ip === "::1") return true;
    if (ip.startsWith("fc") || ip.startsWith("fd")) return true;
    if (/^fe[89ab][0-9a-f]/i.test(ip)) return true;
    if (ip.startsWith("ff")) return true;
    return false;
  }

  return true;
}

/**
 * Validates that an external URL is safe to fetch server-side (prevents SSRF).
 * Only http/https public destinations are permitted.
 */
export async function validateSafeExternalUrl(rawUrl: string): Promise<URL> {
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new Error("URL-ul este obligatoriu.");
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error("Formatul URL-ului este invalid.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    logger.recordMetric("ssrf_block");
    throw new Error("Sunt permise doar protocoalele HTTP și HTTPS.");
  }

  if (parsed.username || parsed.password) {
    logger.recordMetric("ssrf_block");
    throw new Error("URL-urile cu credențiale încorporate nu sunt permise.");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !hostname ||
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".localhost")
  ) {
    logger.recordMetric("ssrf_block");
    throw new Error("Accesul către adrese interne sau metadata este blocat.");
  }

  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      logger.recordMetric("ssrf_block");
      throw new Error("Accesul către adrese IP private sau interne este blocat.");
    }
    return parsed;
  }

  let addresses: Array<{ address: string; family: number }> = [];
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new Error("Domeniul țintă nu a putut fi rezolvat DNS.");
  }

  if (!addresses || addresses.length === 0) {
    throw new Error("Domeniul țintă nu are înregistrări DNS valide.");
  }

  for (const entry of addresses) {
    if (isPrivateOrReservedIp(entry.address)) {
      logger.recordMetric("ssrf_block");
      throw new Error("Accesul către adrese IP interne sau de rețea privată este blocat.");
    }
  }

  return parsed;
}

/**
 * Performs an HTTP GET request via axios while enforcing validateSafeExternalUrl
 * on both the initial target and every redirect hop (max 4 hops),
 * and enforcing a strict default payload limit (15 MB).
 */
export async function safeAxiosGet<T = any>(
  rawUrl: string,
  config: AxiosRequestConfig = {},
  maxHops = 4
): Promise<AxiosResponse<T>> {
  let currentUrl = (await validateSafeExternalUrl(rawUrl)).toString();
  const maxBytes = config.maxContentLength ?? DEFAULT_MAX_EXTERNAL_BYTES;

  for (let hop = 0; hop <= maxHops; hop++) {
    const response = await axios.get<T>(currentUrl, {
      ...config,
      maxContentLength: maxBytes,
      maxBodyLength: config.maxBodyLength ?? maxBytes,
      maxRedirects: 0,
      validateStatus: (status) => {
        if (status >= 300 && status < 400) return true;
        return config.validateStatus ? config.validateStatus(status) : status < 400;
      },
    });

    if (response.status >= 300 && response.status < 400 && response.headers?.location) {
      const nextRaw = new URL(String(response.headers.location), currentUrl).toString();
      currentUrl = (await validateSafeExternalUrl(nextRaw)).toString();
      continue;
    }

    return response;
  }

  throw new Error("Prea multe redirecționări HTTP.");
}

export interface SafeHttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  data: any;
  finalUrl: string;
}

/**
 * Performs an HTTP/2 GET request (falling back to safeAxiosGet for plain http://),
 * strictly validating the initial URL and every redirect hop via validateSafeExternalUrl,
 * and enforcing DEFAULT_MAX_EXTERNAL_BYTES payload limits.
 */
export async function safeHttp2Get(
  rawUrl: string,
  options: {
    headers?: Record<string, string>;
    timeout?: number;
    responseType?: "text" | "arraybuffer" | "json";
    maxContentLength?: number;
  } = {},
  maxHops = 5
): Promise<SafeHttpResponse> {
  let currentUrl = (await validateSafeExternalUrl(rawUrl)).toString();
  const maxBytes = options.maxContentLength ?? DEFAULT_MAX_EXTERNAL_BYTES;
  const timeoutMs = options.timeout ?? 8000;

  for (let hop = 0; hop <= maxHops; hop++) {
    const parsed = new URL(currentUrl);
    if (parsed.protocol !== "https:") {
      const ax = await safeAxiosGet(currentUrl, {
        headers: options.headers,
        timeout: timeoutMs,
        responseType: options.responseType === "arraybuffer" ? "arraybuffer" : "text",
        maxContentLength: maxBytes,
        validateStatus: (s) => s < 600,
      });
      return {
        status: ax.status,
        headers: ax.headers as any,
        data: options.responseType === "json" && typeof ax.data === "string" ? JSON.parse(ax.data) : ax.data,
        finalUrl: currentUrl,
      };
    }

    const reqHeaders: Record<string, string> = {
      ":method": "GET",
      ":path": `${parsed.pathname || "/"}${parsed.search || ""}`,
      ":scheme": "https",
      ":authority": parsed.host,
    };

    if (options.headers) {
      for (const [k, v] of Object.entries(options.headers)) {
        const lower = k.toLowerCase();
        // Skip HTTP/1.1 connection-specific headers prohibited in HTTP/2
        if (
          lower === "connection" ||
          lower === "keep-alive" ||
          lower === "proxy-connection" ||
          lower === "transfer-encoding" ||
          lower === "upgrade" ||
          lower === "host"
        ) {
          continue;
        }
        reqHeaders[lower] = v;
      }
    }

    const res = await new Promise<{
      status: number;
      headers: Record<string, string | string[] | undefined>;
      body: Buffer;
    }>((resolve, reject) => {
      let settled = false;
      const client = http2.connect(parsed.origin);
      const finishErr = (err: any) => {
        if (settled) return;
        settled = true;
        try {
          client.close();
        } catch {}
        reject(err);
      };

      client.on("error", finishErr);

      const req = client.request(reqHeaders);
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      let status = 0;
      let headers: Record<string, string | string[] | undefined> = {};

      req.on("response", (h) => {
        status = Number(h[":status"] || 0);
        const normalized: Record<string, string | string[] | undefined> = {};
        for (const [hk, hv] of Object.entries(h)) {
          if (!hk.startsWith(":")) {
            normalized[hk.toLowerCase()] = hv;
          }
        }
        headers = normalized;
      });

      req.on("data", (chunk: Buffer) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += buf.length;
        if (totalBytes > maxBytes) {
          try {
            req.close(http2.constants.NGHTTP2_CANCEL);
          } catch {}
          finishErr(new Error("maxContentLength exceeded"));
          return;
        }
        chunks.push(buf);
      });

      req.on("end", () => {
        if (settled) return;
        settled = true;
        try {
          client.close();
        } catch {}
        let rawBuf = Buffer.concat(chunks);
        const ce = String(headers["content-encoding"] || "").toLowerCase();
        try {
          if (ce.includes("br")) rawBuf = zlib.brotliDecompressSync(rawBuf);
          else if (ce.includes("gzip")) rawBuf = zlib.gunzipSync(rawBuf);
          else if (ce.includes("deflate")) rawBuf = zlib.inflateSync(rawBuf);
        } catch {
          // Return raw buffer if decompression fails
        }
        resolve({ status, headers, body: rawBuf });
      });

      req.on("error", finishErr);
      req.setTimeout(timeoutMs, () => {
        try {
          req.close(http2.constants.NGHTTP2_CANCEL);
        } catch {}
        finishErr(new Error(`HTTP/2 request timeout after ${timeoutMs}ms`));
      });
      req.end();
    });

    const loc = res.headers.location;
    if (res.status >= 300 && res.status < 400 && loc) {
      const locStr = Array.isArray(loc) ? loc[0] : String(loc);
      const nextRaw = new URL(locStr, currentUrl).toString();
      currentUrl = (await validateSafeExternalUrl(nextRaw)).toString();
      continue;
    }

    let data: any = res.body;
    if (options.responseType !== "arraybuffer") {
      const text = res.body.toString("utf8");
      if (options.responseType === "json") {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      } else {
        data = text;
      }
    }

    return {
      status: res.status,
      headers: res.headers,
      data,
      finalUrl: currentUrl,
    };
  }

  throw new Error("Prea multe redirecționări HTTP.");
}

/**
 * Fetches an external URL using HTTP/2 for domains known to require ALPN HTTP/2
 * (or automatically falls back to HTTP/2 when HTTP/1.1 receives 403/429/503).
 */
export async function safeFetchExternal(
  rawUrl: string,
  options: {
    headers?: Record<string, string>;
    timeout?: number;
    responseType?: "text" | "arraybuffer" | "json";
    maxContentLength?: number;
  } = {}
): Promise<SafeHttpResponse> {
  const parsed = await validateSafeExternalUrl(rawUrl);
  const hostLower = parsed.hostname.toLowerCase();
  const preferH2 =
    parsed.protocol === "https:" &&
    (hostLower.includes("olx.ro") || hostLower.includes("storia.ro") || hostLower.includes("olxcdn.com"));

  if (preferH2) {
    try {
      const h2Res = await safeHttp2Get(parsed.toString(), options);
      if (h2Res.status > 0 && h2Res.status !== 403 && h2Res.status !== 429 && h2Res.status !== 503) {
        return h2Res;
      }
      // Fall through to HTTP/1.1 attempt if H2 got blocked or status unexpected
      if (h2Res.status === 403 || h2Res.status === 429 || h2Res.status === 503) {
        const axFallback = await safeAxiosGet(parsed.toString(), {
          headers: options.headers,
          timeout: options.timeout ?? 8000,
          responseType: options.responseType === "arraybuffer" ? "arraybuffer" : "text",
          maxContentLength: options.maxContentLength ?? DEFAULT_MAX_EXTERNAL_BYTES,
          validateStatus: (s) => s < 600,
        }).catch(() => null);
        if (axFallback && axFallback.status < 400) {
          let axData = axFallback.data;
          if (options.responseType === "json" && typeof axData === "string") {
            try {
              axData = JSON.parse(axData);
            } catch {}
          }
          return {
            status: axFallback.status,
            headers: axFallback.headers as any,
            data: axData,
            finalUrl: parsed.toString(),
          };
        }
        return h2Res;
      }
    } catch {
      // Fallback to safeAxiosGet
    }
  }

  const axRes = await safeAxiosGet(parsed.toString(), {
    headers: options.headers,
    timeout: options.timeout ?? 8000,
    responseType: options.responseType === "arraybuffer" ? "arraybuffer" : "text",
    maxContentLength: options.maxContentLength ?? DEFAULT_MAX_EXTERNAL_BYTES,
    validateStatus: (s) => s < 600,
  });

  if ((axRes.status === 403 || axRes.status === 429 || axRes.status === 503) && parsed.protocol === "https:") {
    try {
      const h2Res = await safeHttp2Get(parsed.toString(), options);
      if (h2Res.status > 0 && h2Res.status < 400) {
        return h2Res;
      }
    } catch {
      // Keep original HTTP/1.1 response
    }
  }

  let outData = axRes.data;
  if (options.responseType === "json" && typeof outData === "string") {
    try {
      outData = JSON.parse(outData);
    } catch {}
  }

  return {
    status: axRes.status,
    headers: axRes.headers as any,
    data: outData,
    finalUrl: parsed.toString(),
  };
}

