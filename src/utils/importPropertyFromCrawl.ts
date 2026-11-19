import { leadsService } from "../services/leadsService";
import { notificationsService } from "../services/notificationsService";
import { auth } from "../lib/firebase";
import { generateStandardAdTitle } from "./propertyTitleGenerator";
import { automationSettingsService } from "../services/automationSettingsService";
import { getApiAuthHeaders } from "../lib/apiAuth";

export interface ImportPropertyParams {
  url: string;
  html?: string;
  onStatus?: (status: string) => void;
}

export interface ImportPropertyResult {
  leadId: string;
  title: string;
  zone: string;
}

export class CrawlBlockedError extends Error {
  public readonly upstreamStatus?: number;
  constructor(message: string, upstreamStatus?: number) {
    super(message);
    this.name = "CrawlBlockedError";
    this.upstreamStatus = upstreamStatus;
  }
}

/**
 * Generates a CSP-safe, zero-cost bookmarklet that captures the currently viewed
 * listing's live DOM HTML (including revealed phone numbers) and sends it to the
 * CRM origin via window.open + postMessage handshake.
 */
export function buildImportBookmarkletCode(origin: string): string {
  const cleanOrigin = origin.replace(/\/+$/, "");
  const code = `(function(){var o=${JSON.stringify(cleanOrigin)};var w=window.open(o+'/?importBridge=1','_blank');if(!w){alert('Permiteti ferestrele pop-up pentru a importa anuntul in CRM.');return;}var p={type:'BROKR_IMPORT_PAYLOAD',url:location.href,html:document.documentElement.outerHTML,title:document.title};var sent=false;function send(){if(sent)return;try{w.postMessage(p,o);sent=true;}catch(e){}}function onMsg(e){if(e.origin===o&&e.data&&e.data.type==='BROKR_IMPORT_READY'){send();window.removeEventListener('message',onMsg);}}window.addEventListener('message',onMsg);setTimeout(send,1800);setTimeout(function(){window.removeEventListener('message',onMsg);},15000);})();`;
  return `javascript:${code}`;
}

export async function importPropertyFromCrawl({
  url,
  html,
  onStatus,
}: ImportPropertyParams): Promise<ImportPropertyResult> {
  const trimmedUrl = url.trim();
  const trimmedHtml = typeof html === "string" ? html.trim() : "";

  onStatus?.(trimmedHtml ? "Procesare pagină capturată..." : "Accesare URL...");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);

  let crawlRes: Response;
  try {
    const authHeaders = await getApiAuthHeaders({ "Content-Type": "application/json" });
    const activeTitleRule = automationSettingsService.getCachedTitleRule();
    crawlRes = await fetch("/api/crawl", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        url: trimmedUrl,
        ...(trimmedHtml ? { html: trimmedHtml } : {}),
        titleAutomationRule: activeTitleRule,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!crawlRes.ok) {
    const errorText = await crawlRes.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(errorText);
    } catch {}
    const parsedMsg =
      parsed?.error?.message ||
      (typeof parsed?.error === "string" ? parsed.error : "") ||
      `Crawl failed with status ${crawlRes.status}`;
    if (
      parsed?.code === "UPSTREAM_ACCESS_BLOCKED" ||
      parsed?.upstreamStatus === 403 ||
      parsed?.upstreamStatus === 429 ||
      parsedMsg.includes("403") ||
      parsedMsg.toLowerCase().includes("anti-bot")
    ) {
      throw new CrawlBlockedError(parsedMsg, parsed?.upstreamStatus || 403);
    }
    throw new Error(parsedMsg);
  }

  const contentTypeHeader = crawlRes.headers.get("content-type");
  if (!contentTypeHeader || !contentTypeHeader.includes("application/json")) {
    const textStr = await crawlRes.text();
    console.warn("Expected JSON but got:", textStr.substring(0, 100));
    throw new Error("Server returned an invalid response (HTML instead of JSON)");
  }

  const crawlData = await crawlRes.json();
  const {
    title,
    price,
    zone,
    ownerName,
    ownerPhone,
    transactionType: crawledTrans,
    categoria: crawledCat,
    crmData,
    coverImage,
  } = crawlData;

  onStatus?.("Salvare...");
  const currentUser = auth.currentUser;
  const creatorName =
    currentUser?.displayName ||
    (currentUser?.email ? currentUser.email.split("@")[0] : "Consilier Imobiliar");
  const creatorEmail = currentUser?.email || "";

  const activeRuleForFallback = automationSettingsService.getCachedTitleRule();
  const finalTitle =
    title ||
    crmData?.descriere?.titlu ||
    generateStandardAdTitle({
      transactionType: crawledTrans,
      categoria: crawledCat || "Apartament",
      camere: crmData?.caracteristici?.detalii?.camere,
      suprafataUtila: crmData?.caracteristici?.suprafete?.utila,
      etaj: crmData?.caracteristici?.detalii?.etaj,
      zona: zone,
      compartimentare: crmData?.caracteristici?.detalii?.compartimentare,
      rawTitle: title,
      rawText: crawlData.description || crawlData.text || "",
      titleRule: activeRuleForFallback,
    });

  let resolvedPrice = price || "N/A";
  if (
    resolvedPrice !== "N/A" &&
    (resolvedPrice.toLowerCase().includes("ron") || resolvedPrice.toLowerCase().includes("lei"))
  ) {
    const digits = parseFloat(resolvedPrice.replace(/[^0-9.,]/g, "").replace(",", "."));
    if (!isNaN(digits) && digits > 0) {
      const inEur = Math.round(digits / 4.97);
      const isRentTrans = (crawledTrans || "").toLowerCase().includes("inchir");
      resolvedPrice = `${inEur.toLocaleString("ro-RO")} €${isRentTrans ? " / lună" : ""}`;
    }
  }

  const toCleanUrl = (u: string | undefined | null) => {
    if (!u || typeof u !== "string") return "";
    const normalized = u.trim().startsWith("//") ? "https:" + u.trim() : u.trim();
    if (normalized.startsWith("http") && !normalized.includes("/api/proxy-image")) {
      return `/api/proxy-image?url=${encodeURIComponent(normalized)}`;
    }
    return normalized;
  };

  const cleanCover = coverImage ? toCleanUrl(coverImage) : null;
  const rawImages =
    Array.isArray(crawlData.images) && crawlData.images.length > 0
      ? crawlData.images
      : coverImage
      ? [coverImage]
      : [];
  const cleanImages = rawImages.map((u: string) => toCleanUrl(u)).filter(Boolean);

  if (crmData?.imagini) {
    const categories = ["living", "camera", "bucatarie", "baie", "alteSpatii"] as const;
    categories.forEach((cat) => {
      if (Array.isArray(crmData.imagini[cat])) {
        crmData.imagini[cat] = crmData.imagini[cat].map((item: any) => {
          if (typeof item === "string") return toCleanUrl(item);
          if (item && item.original) return { ...item, original: toCleanUrl(item.original) };
          return item;
        });
      }
    });
  }

  const createdLead = await leadsService.addLead({
    url: trimmedUrl,
    title: finalTitle,
    zone: zone || "Nespecificat",
    price: resolvedPrice,
    ownerName: ownerName || "Nespecificat",
    ownerPhone: ownerPhone || "Nespecificat",
    transactionType: (crawledTrans as any) || "Vânzare",
    categoria: crawledCat || "Apartament",
    status: "Noi",
    leadType: "Proprietar",
    coverImage: cleanCover,
    images: cleanImages,
    createdByName: creatorName,
    createdByEmail: creatorEmail,
    author: creatorName,
    agent: creatorName,
    extractedData: crmData
      ? {
          crmData: crmData,
          presentationSections: crawlData.presentationSections || null,
          automationSource: crawlData.automationSource || null,
          markdownMarketing: crmData.descriere?.continut || "",
          summary:
            crawlData.presentationSections?.introducere?.summary ||
            `${crawledCat || "Proprietate"} ${crmData.caracteristici?.detalii?.camere || "2"} camere în ${zone || "București"}, ${price || "N/A"}`,
          originalDescription:
            crawlData.description || crawlData.text || crmData.descriere?.continut || "",
        }
      : null,
  });

  await notificationsService.addNotification({
    title: "Proprietate Nouă Adăugată",
    message: `Proprietatea din ${zone || "zonă nespecificată"} a fost extrasă și adăugată cu succes.`,
    type: "lead",
  });

  return {
    leadId: createdLead?.id || "",
    title: finalTitle,
    zone: zone || "Nespecificat",
  };
}
