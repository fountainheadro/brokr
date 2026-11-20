/**
 * OLX.ro Phone Number Click-to-Reveal Extractor (Strict Provenance)
 *
 * OLX Extraction Instructions (Masked Seller Phone Button):
 * ---------------------------------------------------------
 * On OLX.ro listing pages, the seller phone number is initially masked inside:
 *
 *   <button
 *     data-cy="ad-contact-phone"
 *     data-testid="ad-contact-phone"
 *     class="css-1o4b4d"
 *     data-nx-name="Button"
 *     data-nx-legacy="true"
 *     type="button"
 *     data-button-variant="secondary"
 *     data-button-background="default"
 *   >
 *     <span class="n-button-text-wrapper"><span>Suna vanzatorul</span></span>
 *   </button>
 *
 * IMPORTANT DOM DETAIL ON OLX.RO:
 * OLX renders TWO `button[data-cy="ad-contact-phone"]` nodes in the DOM:
 * - The first node (e.g. `css-m3p8hn`) is hidden (`offsetParent === null`, 0x0 rect)
 *   and remains "Suna vanzatorul" permanently.
 * - The second node (e.g. `css-1o4b4d`) is the VISIBLE button that triggers
 *   `/api/v1/offers/{id}/limited-phones/` and replaces "Suna vanzatorul" with
 *   the actual phone number (e.g. "072 678 6020") and renders `a[data-testid="contact-phone"]`.
 *
 * Strict Provenance Rules:
 * 1. Dismiss cookie consent overlays (`#onetrust-accept-btn-handler`) and wait for
 *    the overlay to clear before clicking so clicks are never swallowed.
 * 2. Recover gracefully if OLX triggers a client-side navigation mid-hydration.
 * 3. Query ALL `button[data-cy="ad-contact-phone"]` / `button[data-testid="ad-contact-phone"]`
 *    (and secondary `button[data-testid="show-phone"]`) elements and click the VISIBLE one.
 * 4. Accept ONLY phone numbers with strict provenance:
 *    - Intercepted XHR `/api/v1/offers/{expectedOfferId}/(limited-)?phones/` (scoped to offer ID), OR
 *    - Live text replacement on OLX's seller contact elements (`button[data-cy="ad-contact-phone"]`,
 *      `button[data-testid="ad-contact-phone"]`, `a[data-testid="contact-phone"]`, `a[data-cy="ad-contact-phone"]`).
 * 5. NEVER guess from raw HTML/scripts, NEVER scan arbitrary page `tel:` links, and
 *    NEVER return masked labels ("Suna vanzatorul", "Arata", "xxx") or placeholder numbers
 *    ("0722 123 456", "0700 000 000"). Return `null` so callers store "Nespecificat".
 */

import * as cheerio from "cheerio";
import { safeFetchExternal, validateSafeExternalUrl } from "../security/sec_url-validator";
import { logger } from "../../src/core/logger/logger";

export const OLX_PHONE_BUTTON_SELECTORS = [
  'button[data-cy="ad-contact-phone"]',
  'button[data-testid="ad-contact-phone"]',
  'button[data-testid="show-phone"]',
  'a[data-testid="contact-phone"]',
  'a[data-cy="ad-contact-phone"]',
] as const;

export const OLX_COOKIE_ACCEPT_SELECTORS = [
  "#onetrust-accept-btn-handler",
  'button[data-testid="accept-cookies"]',
  'button[id*="accept-cookies"]',
] as const;

const MASKED_PHONE_LABEL_REGEX =
  /suna\s*vanzator|arata\s*numar|afiseaza\s*numar|vezi\s*numar|arata\b|show\s*phone|call\s*seller|contact\s*seller|x{2,}|\*{2,}|\.\.\./i;

// Known placeholder/example phone numbers embedded in OLX UI/i18n templates or forms
const PLACEHOLDER_PHONE_DIGITS = new Set([
  "0722123456",
  "0712345678",
  "0700000000",
  "0722000000",
  "0700123456",
  "0722111222",
  "0733444555",
  "0700000001",
]);

const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";

function stripDiacritics(input: string): string {
  return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Returns true if the normalized digits match a known dummy/placeholder number
 * (e.g. OLX's i18n example "0722 123 456" or "0700 000 000").
 */
export function isPlaceholderPhoneDigits(digits: string): boolean {
  const clean = digits.replace(/\D/g, "");
  if (!clean) return true;
  if (PLACEHOLDER_PHONE_DIGITS.has(clean)) return true;
  // Reject 0700000000 / 0711111111-like all-zero tail patterns
  if (/^070{8}$/.test(clean) || /^0{9,}$/.test(clean)) return true;
  return false;
}

/**
 * Returns true if the text is empty, still shows OLX's masked label
 * (e.g. "Suna vanzatorul" / "Sună vânzătorul" / "Arata" / "xxx"), or does not contain enough digits.
 */
export function isMaskedOlxPhoneText(raw: string | null | undefined): boolean {
  if (!raw || typeof raw !== "string") return true;
  const trimmed = raw.trim();
  if (!trimmed) return true;
  const normalized = stripDiacritics(trimmed).toLowerCase();
  if (MASKED_PHONE_LABEL_REGEX.test(normalized)) return true;
  const digits = trimmed.replace(/\D/g, "");
  return digits.length < 9;
}

/**
 * Validates and normalizes a revealed Romanian / international phone candidate.
 * Enforces strict non-alphanumeric boundaries (rejecting tracking IDs like "r0776940545"),
 * handles OLX's spacing formats ("072 678 6020", "0726 786 020", "+40 726 786 020"),
 * and rejects masked labels and placeholder/example numbers ("0722 123 456").
 */
export function extractValidRoPhone(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const str = String(raw)
    .replace(/^tel:/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!str || isMaskedOlxPhoneText(str)) return null;

  // Match Romanian phone with strict non-alphanumeric boundaries so tracking URLs
  // (e.g. "dot.wp.pl/r0776940545/getuid") or long numeric IDs never match.
  const roMatch = str.match(/(?<![0-9A-Za-z])(?:\+40|0040|40|0)[\s.-]*[237](?:[\s.-]*\d){8}(?![0-9])/);
  if (roMatch) {
    const compact = roMatch[0].replace(/[^\d+]/g, "");
    let normalized = "";
    if (compact.startsWith("+40") && compact.length === 12) {
      normalized = `0${compact.slice(3)}`;
    } else if (compact.startsWith("0040") && compact.length === 13) {
      normalized = `0${compact.slice(4)}`;
    } else if (compact.startsWith("40") && compact.length === 11) {
      normalized = `0${compact.slice(2)}`;
    } else if (compact.startsWith("0") && compact.length === 10) {
      normalized = compact;
    }
    if (normalized && !isPlaceholderPhoneDigits(normalized)) {
      return normalized;
    }
    return null;
  }

  // Fallback for explicitly revealed international numbers (must consist almost purely of phone characters)
  if (!/^[\d+\s().-]{9,20}$/.test(str)) {
    return null;
  }
  const cleaned = str.replace(/[^\d+]/g, "");
  const digitsOnly = cleaned.replace(/\D/g, "");
  if (digitsOnly.length >= 9 && digitsOnly.length <= 13) {
    if (!cleaned.startsWith("+") && !cleaned.startsWith("0") && !cleaned.startsWith("40")) {
      return null;
    }
    let normalized = cleaned;
    if (cleaned.startsWith("40") && digitsOnly.length === 11) {
      normalized = `0${digitsOnly.slice(2)}`;
    } else if (cleaned.startsWith("+40") && digitsOnly.length === 11) {
      normalized = `0${digitsOnly.slice(2)}`;
    }
    if (!isPlaceholderPhoneDigits(normalized)) {
      return normalized;
    }
  }

  return null;
}

/**
 * Extracts a genuine Romanian mobile/landline phone explicitly written inside
 * clean visible seller description text (NEVER raw HTML or inline scripts).
 * Enforces strict boundaries and rejects placeholder/dummy numbers.
 */
export function extractPhoneFromVisibleText(visibleText: string | null | undefined): string | null {
  if (!visibleText || typeof visibleText !== "string") return null;
  const regex = /(?<![0-9A-Za-z])(?:\+40|0040|0)[\s.-]*7\d{2}[\s.-]?\d{3}[\s.-]?\d{3}(?![0-9A-Za-z])/g;
  const matches = visibleText.match(regex);
  if (!matches) return null;
  for (const m of matches) {
    const valid = extractValidRoPhone(m);
    if (valid) return valid;
  }
  return null;
}

/**
 * Extracts a revealed phone number from OLX HTML, strictly inspecting ONLY OLX's dedicated
 * seller contact elements (`a[data-testid="contact-phone"]`, `a[data-cy="ad-contact-phone"]`,
 * `button[data-cy="ad-contact-phone"]`, `button[data-testid="ad-contact-phone"]`,
 * `button[data-testid="show-phone"]`).
 * NEVER scans arbitrary page `tel:` links or raw scripts.
 * Returns null if buttons still display masked text like "Suna vanzatorul".
 */
export function extractPhoneFromOlxHtml(html: string): string | null {
  if (!html || typeof html !== "string") return null;
  const $ = cheerio.load(html);

  const candidates: string[] = [];

  $('a[data-testid="contact-phone"], a[data-cy="ad-contact-phone"]').each((_, el) => {
    const $a = $(el);
    const href = $a.attr("href");
    if (href) candidates.push(href);
    const txt = $a.text().trim();
    if (txt) candidates.push(txt);
  });

  const buttonSelectors = [
    'button[data-cy="ad-contact-phone"]',
    'button[data-testid="ad-contact-phone"]',
    'button[data-testid="show-phone"]',
  ];

  for (const sel of buttonSelectors) {
    $(sel).each((_, el) => {
      const $btn = $(el);
      const nestedTel = $btn.find('a[href^="tel:"]').first().attr("href");
      if (nestedTel) candidates.push(nestedTel);
      const wrapperSpanText = $btn.find(".n-button-text-wrapper span").text().trim();
      if (wrapperSpanText) candidates.push(wrapperSpanText);
      const wrapperText = $btn.find(".n-button-text-wrapper").text().trim();
      if (wrapperText) candidates.push(wrapperText);
      const directText = $btn.text().trim();
      if (directText) candidates.push(directText);
    });
  }

  for (const candidate of candidates) {
    const valid = extractValidRoPhone(candidate);
    if (valid) return valid;
  }

  return null;
}

function extractPhoneFromOlxApiPayload(payload: any): string | null {
  if (!payload || typeof payload !== "object") return null;
  const candidates: unknown[] = [];
  if (Array.isArray(payload?.data?.phones)) {
    candidates.push(...payload.data.phones);
  }
  if (typeof payload?.data?.phone === "string") {
    candidates.push(payload.data.phone);
  }
  if (payload?.value) {
    candidates.push(payload.value);
  }
  if (Array.isArray(payload)) {
    candidates.push(...payload);
  }
  for (const item of candidates) {
    const valid = extractValidRoPhone(item);
    if (valid) return valid;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Shared Headless Chromium Pool (lazy-loaded, bounded concurrency, idle close)
// ---------------------------------------------------------------------------

let sharedBrowserPromise: Promise<any> | null = null;
let sharedBrowserInstance: any | null = null;
let activePageCount = 0;
let idleCloseTimer: ReturnType<typeof setTimeout> | null = null;
const MAX_CONCURRENT_PAGES = 3;
const BROWSER_IDLE_TIMEOUT_MS = 60_000;
const pageWaitQueue: Array<() => void> = [];

function clearIdleCloseTimer() {
  if (idleCloseTimer) {
    clearTimeout(idleCloseTimer);
    idleCloseTimer = null;
  }
}

function scheduleIdleClose() {
  clearIdleCloseTimer();
  if (activePageCount > 0 || !sharedBrowserInstance) return;
  idleCloseTimer = setTimeout(() => {
    void closeOlxPhoneBrowser();
  }, BROWSER_IDLE_TIMEOUT_MS);
  if (typeof idleCloseTimer.unref === "function") {
    idleCloseTimer.unref();
  }
}

async function acquirePageSlot(): Promise<void> {
  if (activePageCount < MAX_CONCURRENT_PAGES) {
    activePageCount += 1;
    clearIdleCloseTimer();
    return;
  }
  await new Promise<void>((resolve) => {
    pageWaitQueue.push(() => {
      activePageCount += 1;
      clearIdleCloseTimer();
      resolve();
    });
  });
}

function releasePageSlot(): void {
  activePageCount = Math.max(0, activePageCount - 1);
  const next = pageWaitQueue.shift();
  if (next) {
    next();
  } else {
    scheduleIdleClose();
  }
}

async function getSharedBrowser(): Promise<any | null> {
  if (sharedBrowserInstance && sharedBrowserInstance.connected) {
    return sharedBrowserInstance;
  }
  if (sharedBrowserPromise) {
    return sharedBrowserPromise;
  }

  sharedBrowserPromise = (async () => {
    try {
      const puppeteerMod: any = await import("puppeteer");
      const puppeteer = puppeteerMod.default || puppeteerMod;
      const browser = await puppeteer.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--disable-blink-features=AutomationControlled",
          "--no-first-run",
          "--no-zygote",
        ],
      });
      sharedBrowserInstance = browser;
      browser.on("disconnected", () => {
        if (sharedBrowserInstance === browser) {
          sharedBrowserInstance = null;
          sharedBrowserPromise = null;
        }
      });
      return browser;
    } catch (err: any) {
      logger.warn(`OLX Puppeteer browser unavailable, will use HTTP fallback: ${err?.message || err}`, {
        module: "olx-phone-extractor",
      });
      sharedBrowserInstance = null;
      return null;
    } finally {
      sharedBrowserPromise = null;
    }
  })();

  return sharedBrowserPromise;
}

export async function closeOlxPhoneBrowser(): Promise<void> {
  clearIdleCloseTimer();
  const browser = sharedBrowserInstance;
  sharedBrowserInstance = null;
  sharedBrowserPromise = null;
  if (browser) {
    try {
      await browser.close();
    } catch {
      // ignore close errors
    }
  }
}

function isNavigationContextError(err: unknown): boolean {
  const msg = String((err as any)?.message || err || "");
  return (
    msg.includes("Execution context was destroyed") ||
    msg.includes("Cannot find context with specified id") ||
    msg.includes("Target closed") ||
    msg.includes("Frame was detached")
  );
}

/**
 * Core browser interaction: navigates a Puppeteer page to an OLX ad URL,
 * dismisses cookie consent overlays (and waits for them to disappear),
 * handles mid-hydration navigations gracefully, locates the VISIBLE
 * `button[data-cy="ad-contact-phone"]` / `button[data-testid="ad-contact-phone"]`
 * (skipping OLX's hidden mobile duplicate), clicks it to unmask "Suna vanzatorul",
 * waits for the new phone text to appear (or the offer-scoped `/limited-phones/`
 * / `/phones/` XHR response), and returns ONLY a strictly verified seller number.
 */
export async function clickAndCopyOlxPhoneFromPage(
  page: any,
  targetUrl: string,
  options?: { timeoutMs?: number; expectedOfferId?: string | number | null }
): Promise<string | null> {
  const timeoutMs = options?.timeoutMs ?? 20_000;
  const expectedOfferId = options?.expectedOfferId ? String(options.expectedOfferId).trim() : "";
  let interceptedPhone: string | null = null;

  await page.setUserAgent(DESKTOP_USER_AGENT);
  await page.setExtraHTTPHeaders({
    "Accept-Language": "ro-RO,ro;q=0.9,en-US;q=0.8,en;q=0.7",
  });
  await page.setViewport({ width: 1440, height: 1000 });

  // Prevent basic headless detection that can block OLX's /limited-phones/ endpoint
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  // Skip heavy media/fonts while keeping scripts, XHR/fetch, and stylesheets intact so visibility & React click work
  await page.setRequestInterception(true);
  page.on("request", (req: any) => {
    const resourceType = req.resourceType();
    if (resourceType === "image" || resourceType === "media" || resourceType === "font") {
      req.abort().catch(() => {});
    } else {
      req.continue().catch(() => {});
    }
  });

  // Intercept OLX's phone reveal XHR strictly scoped to the current offer ID (when known)
  page.on("response", async (res: any) => {
    if (interceptedPhone) return;
    try {
      const resUrl = String(res.url() || "");
      const match = resUrl.match(/\/api\/v1\/offers\/(\d+)\/(?:limited-)?phones/i);
      if (!match || res.status() !== 200) return;
      if (expectedOfferId && match[1] !== expectedOfferId) return;
      const json = await res.json().catch(() => null);
      const parsed = extractPhoneFromOlxApiPayload(json);
      if (parsed) {
        interceptedPhone = parsed;
      }
    } catch {
      // ignore non-JSON responses
    }
  });

  await page.goto(targetUrl, {
    waitUntil: "domcontentloaded",
    timeout: timeoutMs,
  });

  const combinedSelector = OLX_PHONE_BUTTON_SELECTORS.join(", ");

  // Dismiss cookie consent overlays and wait until the blocking overlay is gone
  const dismissCookieOverlay = async (): Promise<void> => {
    for (const cookieSel of OLX_COOKIE_ACCEPT_SELECTORS) {
      try {
        const cookieBtns = await page.$$(cookieSel);
        for (const cookieBtn of cookieBtns) {
          const isVisible = await page.evaluate((el: Element) => {
            const rect = el.getBoundingClientRect();
            return (el as HTMLElement).offsetParent !== null && rect.width > 0 && rect.height > 0;
          }, cookieBtn);
          if (isVisible) {
            await cookieBtn.click().catch(() => {});
            await page
              .waitForFunction(
                (sel: string) => {
                  const el = document.querySelector(sel);
                  if (!el) return true;
                  const rect = el.getBoundingClientRect();
                  return (el as HTMLElement).offsetParent === null || rect.width === 0 || rect.height === 0;
                },
                { timeout: 2000 },
                cookieSel
              )
              .catch(() => {});
            await new Promise((r) => setTimeout(r, 250));
            return;
          }
        }
      } catch {
        // ignore cookie banner errors
      }
    }
  };

  // Reads phone candidates strictly from OLX seller contact elements (NEVER arbitrary global tel: links)
  const readSellerPhoneCandidates = async (): Promise<string[]> => {
    return page.evaluate((selectors: readonly string[]) => {
      const results: string[] = [];

      // Highest priority: OLX's dedicated seller contact-phone anchor rendered upon reveal
      const sellerTelLinks = Array.from(
        document.querySelectorAll('a[data-testid="contact-phone"], a[data-cy="ad-contact-phone"]')
      );
      for (const link of sellerTelLinks) {
        const href = link.getAttribute("href");
        if (href) results.push(href.trim());
        const txt = (link.textContent || "").trim();
        if (txt) results.push(txt);
      }

      // Inspect ALL matching seller contact buttons, prioritizing visible buttons over hidden responsive duplicates
      const visibleTexts: string[] = [];
      const hiddenTexts: string[] = [];
      for (const sel of selectors) {
        const nodes = Array.from(document.querySelectorAll(sel));
        for (const el of nodes) {
          const rect = el.getBoundingClientRect();
          const isVisible = (el as HTMLElement).offsetParent !== null && rect.width > 0 && rect.height > 0;
          const bucket = isVisible ? visibleTexts : hiddenTexts;

          const nestedTel = el.querySelector('a[href^="tel:"]')?.getAttribute("href");
          if (nestedTel) bucket.push(nestedTel.trim());
          const spanText =
            el.querySelector(".n-button-text-wrapper span")?.textContent ||
            el.querySelector(".n-button-text-wrapper")?.textContent ||
            el.textContent ||
            "";
          if (spanText.trim()) bucket.push(spanText.trim());
        }
      }

      return [...results, ...visibleTexts, ...hiddenTexts];
    }, OLX_PHONE_BUTTON_SELECTORS);
  };

  const findValidPhoneInDom = async (): Promise<string | null> => {
    try {
      const candidates = await readSellerPhoneCandidates();
      for (const c of candidates) {
        const valid = extractValidRoPhone(c);
        if (valid) return valid;
      }
    } catch (err) {
      if (isNavigationContextError(err)) return null;
      throw err;
    }
    return null;
  };

  const clickVisiblePhoneButton = async (preferredSelectors: readonly string[]): Promise<boolean> => {
    for (const sel of preferredSelectors) {
      let handles: any[] = [];
      try {
        handles = await page.$$(sel);
      } catch (err) {
        if (isNavigationContextError(err)) return false;
        throw err;
      }
      for (const handle of handles) {
        try {
          const btnMeta = await page.evaluate((el: Element) => {
            const rect = el.getBoundingClientRect();
            const isDisabled = (el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true";
            return {
              visible: (el as HTMLElement).offsetParent !== null && rect.width > 0 && rect.height > 0,
              disabled: isDisabled,
            };
          }, handle);
          if (!btnMeta.visible || btnMeta.disabled) continue;

          await page.evaluate((el: Element) => {
            el.scrollIntoView({ behavior: "instant", block: "center" });
          }, handle);
          await new Promise((r) => setTimeout(r, 150));
          await handle.click({ delay: 35 });
          return true;
        } catch (err) {
          if (isNavigationContextError(err)) return false;
          try {
            await page.evaluate((el: Element) => {
              (el as HTMLElement).click();
            }, handle);
            return true;
          } catch {
            // try next visible handle
          }
        }
      }
    }
    return false;
  };

  const primarySelectors = [
    'button[data-cy="ad-contact-phone"]',
    'button[data-testid="ad-contact-phone"]',
    'button[data-testid="show-phone"]',
  ] as const;

  // Navigation-resilient interaction attempt loop (recovers if OLX redirects/re-hydrates once after load)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.waitForFunction(
        (sel: string) => {
          const els = Array.from(document.querySelectorAll(sel));
          return els.some((el) => {
            const rect = el.getBoundingClientRect();
            return (el as HTMLElement).offsetParent !== null && rect.width > 0 && rect.height > 0;
          });
        },
        { timeout: Math.min(8000, timeoutMs) },
        combinedSelector
      );

      // Brief hydration settle so React click handlers are bound
      await new Promise((r) => setTimeout(r, 450));
      await dismissCookieOverlay();

      if (interceptedPhone) return interceptedPhone;
      const alreadyVisible = await findValidPhoneInDom();
      if (alreadyVisible) return alreadyVisible;

      const clicked = await clickVisiblePhoneButton(primarySelectors);
      if (!clicked) {
        if (interceptedPhone) return interceptedPhone;
        const domCheck = await findValidPhoneInDom();
        if (domCheck) return domCheck;
        continue;
      }

      const maxWaitMs = 6000;
      const pollIntervalMs = 200;
      const startedAt = Date.now();
      let retryCount = 0;

      while (Date.now() - startedAt < maxWaitMs) {
        if (interceptedPhone) return interceptedPhone;
        const revealed = await findValidPhoneInDom();
        if (revealed) return revealed;

        const elapsed = Date.now() - startedAt;
        if (retryCount === 0 && elapsed >= 1800) {
          retryCount = 1;
          await dismissCookieOverlay();
          await clickVisiblePhoneButton(primarySelectors);
        } else if (retryCount === 1 && elapsed >= 3800) {
          retryCount = 2;
          await clickVisiblePhoneButton(['button[data-testid="show-phone"]', ...primarySelectors]);
        }

        await new Promise((r) => setTimeout(r, pollIntervalMs));
      }

      if (interceptedPhone) return interceptedPhone;
      const finalDomPhone = await findValidPhoneInDom();
      if (finalDomPhone) return finalDomPhone;

      const finalHtml = await page.content().catch(() => "");
      return extractPhoneFromOlxHtml(finalHtml);
    } catch (err) {
      if (interceptedPhone) return interceptedPhone;
      if (attempt === 0 && isNavigationContextError(err)) {
        // Wait briefly for the triggered navigation/re-hydration to settle and retry cleanly
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      // Button not present / timed out / blocked — do not guess
      break;
    }
  }

  if (interceptedPhone) return interceptedPhone;
  const fallbackHtml = await page.content().catch(() => "");
  return extractPhoneFromOlxHtml(fallbackHtml);
}

/**
 * Fallback when headless Chromium is unavailable or blocked:
 * Visits the OLX page with HTTP/2 to acquire session cookies, checks OLX seller contact
 * elements in HTML, and replays OLX's phone-reveal endpoints with session cookies + Referer/Origin headers.
 * Never guesses from raw HTML/scripts.
 */
async function revealOlxPhoneViaSessionFallback(
  adUrl: string,
  olxAdId?: string | number | null
): Promise<string | null> {
  try {
    const pageRes = await safeFetchExternal(adUrl, {
      headers: {
        "User-Agent": DESKTOP_USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ro-RO,ro;q=0.9,en-US;q=0.8",
        Referer: "https://www.olx.ro/",
      },
      timeout: 6000,
      responseType: "text",
    });

    const pageHtml = typeof pageRes.data === "string" ? pageRes.data : "";
    const fromHtml = extractPhoneFromOlxHtml(pageHtml);
    if (fromHtml) return fromHtml;

    const rawSetCookie = pageRes.headers?.["set-cookie"];
    const cookieHeader = Array.isArray(rawSetCookie)
      ? rawSetCookie.map((c) => String(c).split(";")[0]).join("; ")
      : typeof rawSetCookie === "string"
        ? rawSetCookie.split(";")[0]
        : "";

    let resolvedId = olxAdId ? String(olxAdId).trim() : "";
    if (!resolvedId && pageHtml) {
      const idMatch =
        pageHtml.match(/"ad_id"\s*:\s*(\d+)/) ||
        pageHtml.match(/"id"\s*:\s*(\d{7,12})/);
      if (idMatch?.[1]) resolvedId = idMatch[1];
    }

    if (!resolvedId) return null;

    const endpoints = [
      `https://www.olx.ro/api/v1/offers/${resolvedId}/limited-phones/`,
      `https://www.olx.ro/api/v1/offers/${resolvedId}/phones/`,
    ];

    for (const ep of endpoints) {
      try {
        const res = await safeFetchExternal(ep, {
          headers: {
            "User-Agent": DESKTOP_USER_AGENT,
            Accept: "application/json, text/plain, */*",
            "Accept-Language": "ro-RO,ro;q=0.9",
            Origin: "https://www.olx.ro",
            Referer: adUrl,
            "X-Requested-With": "XMLHttpRequest",
            ...(cookieHeader ? { Cookie: cookieHeader } : {}),
          },
          timeout: 3000,
          responseType: "json",
        });
        if (res.status === 200) {
          const parsed = extractPhoneFromOlxApiPayload(res.data);
          if (parsed) return parsed;
        }
      } catch {
        // continue to next endpoint
      }
    }
  } catch {
    // non-fatal fallback
  }
  return null;
}

/**
 * Public entry point: reveals the seller's phone number on an OLX.ro listing page by
 * opening the page in headless Chromium, clicking the visible `button[data-cy="ad-contact-phone"]`
 * (which replaces "Suna vanzatorul" with the actual number), and copying the newly
 * appeared phone text. Returns `null` if OLX withholds or blocks the number.
 */
export async function revealOlxPhoneByClick(
  adUrl: string,
  olxAdId?: string | number | null,
  options?: { timeoutMs?: number }
): Promise<string | null> {
  if (!adUrl || typeof adUrl !== "string") return null;

  let parsedUrl: URL;
  try {
    parsedUrl = await validateSafeExternalUrl(adUrl);
  } catch {
    return null;
  }

  const hostLower = parsedUrl.hostname.toLowerCase();
  if (hostLower !== "olx.ro" && !hostLower.endsWith(".olx.ro")) {
    return null;
  }

  // Primary strategy: Real headless browser click on the visible `button[data-cy="ad-contact-phone"]`
  await acquirePageSlot();
  let page: any = null;
  try {
    const browser = await getSharedBrowser();
    if (browser) {
      page = await browser.newPage();
      const clickedPhone = await clickAndCopyOlxPhoneFromPage(page, parsedUrl.toString(), {
        timeoutMs: options?.timeoutMs ?? 20_000,
        expectedOfferId: olxAdId,
      });
      if (clickedPhone) {
        return clickedPhone;
      }
    }
  } catch (err: any) {
    logger.warn(`OLX phone click reveal warning for ${adUrl}: ${err?.message || err}`, {
      module: "olx-phone-extractor",
    });
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {
        // ignore close errors
      }
    }
    releasePageSlot();
  }

  // Secondary strategy: Session-cookie page fetch + offer-ID phone API replay
  return revealOlxPhoneViaSessionFallback(parsedUrl.toString(), olxAdId);
}
