import { leadsService } from "../services/leadsService";
import { notificationsService } from "../services/notificationsService";
import { auth } from "../lib/firebase";
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
 * listing's live DOM HTML and sends it to the CRM origin via window.open + postMessage handshake.
 *
 * OLX Phone Extraction Rule:
 * On OLX.ro pages the phone number is initially masked inside:
 * `<button data-cy="ad-contact-phone" data-testid="ad-contact-phone" ...><span class="n-button-text-wrapper"><span>Suna vanzatorul</span></span></button>`.
 * Before capturing the DOM HTML, the bookmarklet locates this button, clicks it if still masked,
 * waits until the initial "Suna vanzatorul" text is replaced with the actual phone number,
 * copies the newly revealed text, and then sends the updated HTML payload to the CRM.
 */
export function buildImportBookmarkletCode(origin: string): string {
  const cleanOrigin = origin.replace(/\/+$/, "");
  const code = `(function(){var o=${JSON.stringify(cleanOrigin)};var w=window.open(o+'/?importBridge=1','_blank');if(!w){alert('Permiteti ferestrele pop-up pentru a importa anuntul in CRM.');return;}var sent=false,ready=false,revealed=false;var sel='button[data-cy="ad-contact-phone"],button[data-testid="ad-contact-phone"],button[data-testid="show-phone"]';var bad={'0722123456':1,'0712345678':1,'0700000000':1,'0722000000':1,'0700123456':1};function isVis(el){if(!el)return false;var r=el.getBoundingClientRect();return el.offsetParent!==null&&r.width>0&&r.height>0;}function getVisibleBtn(){var list=document.querySelectorAll(sel);for(var i=0;i<list.length;i++){if(isVis(list[i]))return list[i];}return list[0]||null;}function isPhone(t){if(!t)return false;var n=t.normalize('NFD').replace(/[\\u0300-\\u036f]/g,'');if(/suna\\s*vanzator|arata\\s*numar|arata\\b|xxx/i.test(n))return false;var d=t.replace(/\\D/g,'');if(d.length<9)return false;var ro=d.indexOf('40')===0&&d.length===11?'0'+d.slice(2):d;return !bad[ro];}function readPhone(){var links=document.querySelectorAll('a[data-testid="contact-phone"],a[data-cy="ad-contact-phone"]');for(var i=0;i<links.length;i++){var h=(links[i].getAttribute('href')||'').replace(/^tel:/i,'').trim();if(isPhone(h))return h;var lt=(links[i].textContent||'').trim();if(isPhone(lt))return lt;}var btns=document.querySelectorAll(sel);for(var j=0;j<btns.length;j++){var b=btns[j];var s=b.querySelector('.n-button-text-wrapper span')||b.querySelector('.n-button-text-wrapper')||b;var txt=(s.textContent||'').trim();if(isPhone(txt))return txt;}return '';}function sendNow(){if(sent)return;var ph=readPhone();var p={type:'BROKR_IMPORT_PAYLOAD',url:location.href,html:document.documentElement.outerHTML,title:document.title,revealedPhone:ph};try{w.postMessage(p,o);sent=true;}catch(e){}}function trySend(){if(ready&&revealed)sendNow();}function onMsg(e){if(e.origin===o&&e.data&&e.data.type==='BROKR_IMPORT_READY'){ready=true;trySend();if(sent)window.removeEventListener('message',onMsg);}}window.addEventListener('message',onMsg);var btn=getVisibleBtn();if(btn&&!readPhone()){try{btn.scrollIntoView({block:'center'});btn.click();}catch(e){}var t0=Date.now();var iv=setInterval(function(){if(readPhone()||Date.now()-t0>=4000){clearInterval(iv);revealed=true;trySend();}},200);}else{revealed=true;}setTimeout(function(){revealed=true;sendNow();},4500);setTimeout(function(){window.removeEventListener('message',onMsg);},15000);})();`;
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
  const timeoutId = setTimeout(() => controller.abort(), 90000);

  let crawlRes: Response;
  try {
    const authHeaders = await getApiAuthHeaders({ "Content-Type": "application/json" });
    crawlRes = await fetch("/api/crawl", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        url: trimmedUrl,
        ...(trimmedHtml ? { html: trimmedHtml } : {}),
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

  const originalTitle = String(
    crawlData.originalTitle || title || crmData?.descriere?.titlu || ""
  ).trim();
  const finalTitle = originalTitle || "Anunț imobiliar";

  const originalDescription = String(
    crawlData.description || crmData?.descriere?.continut || ""
  ).trim();

  if (crmData?.descriere) {
    crmData.descriere.titlu = finalTitle;
    crmData.descriere.continut = originalDescription;
  }

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
    notes: originalDescription,
    createdByName: creatorName,
    createdByEmail: creatorEmail,
    author: creatorName,
    agent: creatorName,
    extractedData: crmData
      ? {
          crmData: crmData,
          presentationSections: crawlData.presentationSections || null,
          automationSource: crawlData.automationSource || null,
          originalTitle: finalTitle,
          markdownMarketing: originalDescription,
          summary:
            crawlData.presentationSections?.introducere?.summary ||
            [
              crawledCat || "Proprietate",
              crmData.caracteristici?.detalii?.camere
                ? `${crmData.caracteristici.detalii.camere} camere`
                : "",
              zone ? `în ${zone}` : "",
              price && price !== "N/A" ? price : "",
            ]
              .filter(Boolean)
              .join(", "),
          originalDescription: originalDescription,
          ...(crawlData.publishedAt || crawlData.publishedAtLabel || crawlData.sellerType
            ? {
                olxMeta: {
                  originalTitle: finalTitle,
                  publishedAt: crawlData.publishedAt || null,
                  publishedAtLabel: crawlData.publishedAtLabel || "",
                  sellerType: crawlData.sellerType || "",
                },
              }
            : {}),
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
