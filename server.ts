import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import axios from "axios";
import { convert } from "html-to-text";
import * as cheerio from "cheerio";
import { aiCallRouter, setupWebSocket } from "./server/ai-call/router";
import { setupBackgroundNotifications, registerNotificationRoutes } from "./server/background-notifications";
import { serverExtractBasicData, serverExtractData } from "./server/geminiService";
import { GoogleGenAI, Type } from "@google/genai";
import { Jimp } from "jimp";
import { inpaintTelea } from "./src/utils/teleaInpainting";

const ai = new GoogleGenAI({ 
  apiKey: process.env.GEMINI_API_KEY || "",
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build"
    }
  }
});

interface CleanedImageCacheEntry {
  mimeType: string;
  data: Buffer;
}
const imageCleanCache = new Map<string, CleanedImageCacheEntry>();
let watermarkDisabledUntil = 0;

function addToImageCache(url: string, entry: CleanedImageCacheEntry) {
  if (imageCleanCache.size > 150) {
    const keys = Array.from(imageCleanCache.keys());
    for (let idx = 0; idx < 30; idx++) {
      imageCleanCache.delete(keys[idx]);
    }
  }
  imageCleanCache.set(url, entry);
}

async function cleanImageWatermarks(buffer: Buffer, mimeType: string, imageUrl: string): Promise<Buffer> {
  if (!mimeType.startsWith("image/") || mimeType.includes("svg")) {
    return buffer;
  }

  try {
    const image = await Jimp.read(buffer);
    const { width, height } = image;
    
    // Skip tiny images/icons
    if (width < 250 || height < 200) {
      return buffer;
    }

    const lowerUrl = imageUrl.toLowerCase();
    const isStoriaOlx = lowerUrl.includes("apollo.olxcdn.com") || lowerUrl.includes("storia.ro") || lowerUrl.includes("olx.ro");
    const isImobiliare = lowerUrl.includes("imobiliare.ro");

    // Detect watermark footprint mathematically without any AI API calls
    const targetBoxes: { xmin: number; xmax: number; ymin: number; ymax: number; label: string }[] = [];

    if (isStoriaOlx) {
      // 1. Storia/OLX watermark is standard in the BOTTOM-LEFT corner (Apollo p: "10,-10")
      targetBoxes.push({
        xmin: 0,
        xmax: Math.floor(width * 0.22),
        ymin: Math.floor(height * 0.88),
        ymax: height - 1,
        label: "Storia/OLX bottom-left logo"
      });
      // 2. Also cover bottom-right in case of agency stamp overlay
      targetBoxes.push({
        xmin: Math.floor(width * 0.74),
        xmax: width - 1,
        ymin: Math.floor(height * 0.88),
        ymax: height - 1,
        label: "Storia/OLX bottom-right stamp"
      });
    } else if (isImobiliare) {
      // Imobiliare.ro watermark: bottom-right and bottom-left
      targetBoxes.push({
        xmin: Math.floor(width * 0.74),
        xmax: width - 1,
        ymin: Math.floor(height * 0.88),
        ymax: height - 1,
        label: "Imobiliare.ro watermark bottom-right"
      });
      targetBoxes.push({
        xmin: 0,
        xmax: Math.floor(width * 0.20),
        ymin: Math.floor(height * 0.88),
        ymax: height - 1,
        label: "Imobiliare.ro watermark bottom-left"
      });
    } else {
      // General real estate platforms: cover both bottom corners
      targetBoxes.push({
        xmin: 0,
        xmax: Math.floor(width * 0.20),
        ymin: Math.floor(height * 0.88),
        ymax: height - 1,
        label: "Portal bottom-left watermark"
      });
      targetBoxes.push({
        xmin: Math.floor(width * 0.74),
        xmax: width - 1,
        ymin: Math.floor(height * 0.88),
        ymax: height - 1,
        label: "Portal bottom-right watermark"
      });
    }

    // Build mask for Telea inpainting
    const mask = new Uint8Array(width * height);
    let hasMaskPixels = false;

    for (const box of targetBoxes) {
      const bXmin = Math.max(0, Math.min(width - 1, box.xmin));
      const bXmax = Math.max(0, Math.min(width - 1, box.xmax));
      const bYmin = Math.max(0, Math.min(height - 1, box.ymin));
      const bYmax = Math.max(0, Math.min(height - 1, box.ymax));

      for (let y = bYmin; y <= bYmax; y++) {
        const row = y * width;
        for (let x = bXmin; x <= bXmax; x++) {
          mask[row + x] = 1;
          hasMaskPixels = true;
        }
      }
    }

    if (hasMaskPixels) {
      console.log(`[Telea Inpainter] Running classical inpainting on ${imageUrl.substring(0, 80)}...`);
      // Run Alexandru Telea Fast Marching inpainting algorithm directly on image bitmap buffer
      inpaintTelea(image.bitmap.data, mask, width, height, { radius: 4 });
      const outMime = mimeType === "image/png" ? "image/png" : "image/jpeg";
      const cleanedBuffer = await image.getBuffer(outMime as any);
      console.log(`[Telea Inpainter] Inpainted successfully! Dimensions: ${width}x${height}`);
      return cleanedBuffer;
    }

    return buffer;
  } catch (err: any) {
    console.warn(`[Telea Inpainter] Non-fatal inpainting error (serving original):`, err?.message || err);
    return buffer;
  }
}

// ESM/CJS compatibility for paths
const getDirname = () => {
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch (e) {
    // @ts-ignore
    return __dirname;
  }
};

const __dirname = getDirname();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Global Logging Middleware
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });

  const uploadsDir = path.resolve("./public/uploads");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  // Increase body size limit to 50mb for image uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));

  // Serve uploaded images statically
  app.use("/uploads", express.static(uploadsDir));

  // Endpoint to store uploaded photos permanently on the local filesystem as clean URLs
  app.post("/api/upload-photo", async (req, res) => {
    try {
      const { dataUrl, base64 } = req.body;
      const raw = dataUrl || base64;
      if (!raw || typeof raw !== "string") {
        return res.status(400).json({ error: "Missing image data" });
      }

      let mimeType = "image/jpeg";
      let base64Data = raw;
      const matches = raw.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (matches) {
        mimeType = matches[1];
        base64Data = matches[2];
      }

      let ext = "jpg";
      if (mimeType.includes("png")) ext = "png";
      else if (mimeType.includes("webp")) ext = "webp";
      else if (mimeType.includes("gif")) ext = "gif";
      else if (mimeType.includes("avif")) ext = "avif";

      const buffer = Buffer.from(base64Data, "base64");
      const safeName = `prop_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
      const targetPath = path.join(uploadsDir, safeName);
      await fs.promises.writeFile(targetPath, buffer);

      const publicUrl = `/uploads/${safeName}`;
      res.json({ success: true, url: publicUrl });
    } catch (err: any) {
      console.error("[Server] /api/upload-photo error:", err);
      res.status(500).json({ error: err.message || "Failed to upload photo" });
    }
  });

  // Mount AI Call Router
  app.use("/api/ai-call", aiCallRouter);

  // Register notification synchronization endpoints
  registerNotificationRoutes(app);

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // API endpoint to extract basic data using server-side Gemini
  app.post("/api/extract-basic", async (req, res) => {
    try {
      const { content, title } = req.body;
      const cleanContent = (content || "").trim();
      const cleanTitle = (title || "").trim();
      if (!cleanContent && !cleanTitle) {
        return res.status(400).json({ error: "Content and Title parameters are required" });
      }
      const finalTitle = cleanTitle || "Proprietate imobiliară";
      const finalContent = cleanContent || finalTitle;

      console.log(`[Server] Process /api/extract-basic for Title: ${finalTitle}`);
      const result = await serverExtractBasicData(finalContent, finalTitle);
      res.json(result);
    } catch (e: any) {
      console.error("[Server] /api/extract-basic error:", e);
      res.status(500).json({ error: e.message || "Failed to extract basic data" });
    }
  });

  // API endpoint to extract full structured data using server-side Gemini
  app.post("/api/extract-data", async (req, res) => {
    try {
      const { content, title, imageUrls, propertyId, propertyUrl } = req.body;
      const cleanContent = (content || "").trim();
      const cleanTitle = (title || "").trim();
      if (!cleanContent && !cleanTitle) {
        return res.status(400).json({ error: "Content and Title parameters are required" });
      }
      const finalTitle = cleanTitle || "Proprietate imobiliară";
      const finalContent = cleanContent || finalTitle;

      console.log(`[Server] Process /api/extract-data for Property ID: ${propertyId || "GOL"}`);
      const result = await serverExtractData(finalContent, finalTitle, imageUrls, propertyId, propertyUrl);
      res.json(result);
    } catch (e: any) {
      console.error("[Server] /api/extract-data error:", e);
      res.status(500).json({ error: e.message || "Failed to extract content data" });
    }
  });

  // API endpoint for optional on-demand AI generation of title and description
  app.post("/api/generate-ai-text", async (req, res) => {
    try {
      const { category, transactionType, zone, price, specs, originalTitle, originalDescription, propertyId } = req.body;
      if (!process.env.GEMINI_API_KEY) {
        return res.status(400).json({ error: "Cheia GEMINI_API_KEY nu este configurată pe server." });
      }

      const prompt = `
ESTI UN EXPERT IMOBILIAR DE TOP.
Sarcina ta este să generezi un TITLU și o DESCRIERE DE MARKETING conform regulilor stricte de mai jos.

DATE PROPRIETATE:
- Categorie: ${category || "Apartament"}
- Tip Tranzacție: ${transactionType || "Vânzare"}
- Zonă: ${zone || "București"}
- Preț: ${price || "N/A"}
- ID Proprietate: ${propertyId ? propertyId.trim() : ""}
- Specificații tehnice: ${JSON.stringify(specs || {})}
- Titlu original: "${originalTitle || ""}"
- Descriere originală: "${(originalDescription || "").substring(0, 3000)}"

REGULI STRICTE MANDATATE:
1. TITLUL IDENTIC: Titlul din câmpul 'title' TREBUIE să fie ABSOLUT IDENTIC cu titlul din corpul descrierii (situat pe linia direct de sub 📌 ID, după emojiul 🏡 sau 🏢).
2. STRUCTURĂ TITLU: Tip imobil + număr camere/încăperi sau suprafață mp | Zonă | Pct. de interes | Pct forte imobil | Dotări | Parcare. Titlul TREBUIE să aibă SUB 70 de caractere.
3. FĂRĂ NUMĂR STRADĂ, FĂRĂ COMPLEX REZIDENȚIAL: Niciodată nu include numărul străzii, numărul blocului, scara, apartamentul sau denumiri de complexe rezidențiale (ex: Astorium, Hills, etc.) nici în titlu, nici în descriere! Folosește doar zona/cartierul general.
4. FĂRĂ COMISION 0%: Elimină complet orice referire la "0% comision", "comision 0", "fără comision".
5. ȘABLON DESCRIERE APARTAMENTE ȘI CASE / VILE:
Folosește cu sfințenie următorul șablon structural:
📌 ID ${propertyId ? propertyId.trim() : ""}
🏡 [Titlul identic cu cel din campul de titlu]

[O singură propoziție scurtă tip teaser]
[Un scurt paragraf descriptiv al imobilului]

━━━━━━━━━━━━━━━━━━

⭐ AVANTAJE PRINCIPALE

-[Compartimentare, ex: -decomandat]
-[avantaj_1]
-[avantaj_2]

━━━━━━━━━━━━━━━━━━

🛋️ DOTĂRI

-[dotare_1]
-[dotare_2]

[Scurt comentariu opțional despre organizarea spațiului]

━━━━━━━━━━━━━━━━━━

📍 LOCAȚIE

Acces rapid către:
-[punct_interes_1]
-[punct_interes_2]

━━━━━━━━━━━━━━━━━━

💰 ${transactionType === "Închiriere" ? "ÎNCHIRIERE" : "VÂNZARE"}

${transactionType === "Închiriere" ? `${price || "N/A"}\n1 lună garanție\nComision 50% + TVA\nDisponibil imediat` : `${price || "N/A"}\nDisponibil imediat`}

━━━━━━━━━━━━━━━━━━

🤝 ${transactionType === "Închiriere" ? "SUPORT ÎNCHIRIERE" : "SUPORT VÂNZARE"}

-consultanță dedicată din partea agenției brokr
-asistență completă în întocmirea contractului și înregistrarea ANAF
-posibilitate de vizionare rapidă și flexibilă

📞 Pentru vizionare sau detalii suplimentare, contactează-ne telefonic.

6. DACĂ ESTE BIROU, SPAȚIU COMERCIAL SAU INDUSTRIAL:
Folosește șablonul dedicat pentru spații comerciale (cu 📌 ID Proprietate, 🏢 Titlu, ⭐ PUNCTE CHEIE, 🛠️ SPAȚIUL, 📍 LOCAȚIE & ACCES, 💼 POTRIVIT PENTRU, 💰 CONDIȚII, 🤝 SUPORT), eliminând complet parantezele.

Returnează un JSON strict cu următoarele chei:
{
  "title": "Titlul proprietatii sub 70 caractere",
  "description": "Textul complet al descrierii conform sablonului"
}
`;

      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite",
        contents: [{ text: prompt }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              description: { type: Type.STRING }
            },
            required: ["title", "description"]
          }
        }
      });

      const text = response.text;
      if (!text) throw new Error("Nu s-a primit niciun răspuns de la Gemini");
      const parsed = JSON.parse(text);
      res.json(parsed);
    } catch (e: any) {
      console.error("[Server] /api/generate-ai-text error:", e);
      const isCredits = e?.message?.includes("402") || e?.message?.includes("RESOURCE_EXHAUSTED") || e?.message?.includes("prepayment credits");
      res.status(isCredits ? 402 : 500).json({ 
        error: isCredits ? "Creditele preplătite Gemini sunt epuizate. Poți genera titlul și descrierea folosind butoanele Template clasice fără AI." : (e.message || "Eroare la generarea textului cu AI")
      });
    }
  });

  // Public property endpoint for shared property links
  app.get("/api/public-property/:id", async (req, res) => {
    try {
      const { id } = req.params;
      if (!id) return res.status(400).json({ error: "Property ID required" });

      const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
      if (!fs.existsSync(configPath)) {
        return res.status(500).json({ error: "Firebase config not found" });
      }
      const fbConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const dbId = fbConfig.firestoreDatabaseId || "(default)";
      const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${fbConfig.projectId}/databases/${dbId}/documents/leads/${encodeURIComponent(id)}?key=${fbConfig.apiKey}`;
      
      let docData: any = null;
      let docId = id;

      try {
        const response = await axios.get(firestoreUrl, { timeout: 8000 });
        if (response.data) {
          docData = response.data;
        }
      } catch (directErr: any) {
        if (directErr.response && directErr.response.status === 404) {
          // If not found by document ID, try structuredQuery by propertyId field
          try {
            const queryUrl = `https://firestore.googleapis.com/v1/projects/${fbConfig.projectId}/databases/${dbId}/documents:runQuery?key=${fbConfig.apiKey}`;
            const queryBody = {
              structuredQuery: {
                from: [{ collectionId: "leads" }],
                where: {
                  fieldFilter: {
                    field: { fieldPath: "propertyId" },
                    op: "EQUAL",
                    value: { stringValue: id }
                  }
                },
                limit: 1
              }
            };
            const queryRes = await axios.post(queryUrl, queryBody, { timeout: 8000 });
            if (Array.isArray(queryRes.data) && queryRes.data[0]?.document) {
              docData = queryRes.data[0].document;
              const nameParts = (docData.name || "").split("/");
              docId = nameParts[nameParts.length - 1] || id;
            }
          } catch (queryErr: any) {
            console.warn("[Server] propertyId fallback query failed:", queryErr.message);
          }
        } else {
          throw directErr;
        }
      }

      if (!docData) {
        return res.status(404).json({ error: "Property not found" });
      }

      // Convert Firestore document fields to clean JS object
      const parseValue = (fieldObj: any): any => {
        if (!fieldObj || typeof fieldObj !== 'object') return fieldObj;
        if ('stringValue' in fieldObj) return fieldObj.stringValue;
        if ('integerValue' in fieldObj) return Number(fieldObj.integerValue);
        if ('doubleValue' in fieldObj) return Number(fieldObj.doubleValue);
        if ('booleanValue' in fieldObj) return fieldObj.booleanValue;
        if ('timestampValue' in fieldObj) return fieldObj.timestampValue;
        if ('nullValue' in fieldObj) return null;
        if ('mapValue' in fieldObj) {
          const resObj: any = {};
          const fields = fieldObj.mapValue.fields || {};
          for (const k of Object.keys(fields)) {
            resObj[k] = parseValue(fields[k]);
          }
          return resObj;
        }
        if ('arrayValue' in fieldObj) {
          const values = fieldObj.arrayValue.values || [];
          return values.map((v: any) => parseValue(v));
        }
        return fieldObj;
      };

      const result: any = { id: docId };
      const fields = docData.fields || {};
      for (const k of Object.keys(fields)) {
        result[k] = parseValue(fields[k]);
      }

      res.json(result);
    } catch (e: any) {
      if (e.response && e.response.status === 404) {
        return res.status(404).json({ error: "Property not found" });
      }
      console.error("[Server] /api/public-property/:id error:", e.message || e);
      res.status(500).json({ error: "Failed to fetch public property" });
    }
  });

  // API endpoint for crawling
  app.post("/api/crawl", async (req, res, next) => {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    const userAgents = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/110.0",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36"
    ];

    let lastError: any = null;
    
    // Try with a few different User Agents if it fails with 503 or 403
    for (let i = 0; i < 4; i++) {
      try {
        console.log(`Fetching URL (attempt ${i+1}): ${url}`);
        const response = await axios.get(url, {
          headers: {
            "User-Agent": userAgents[i % userAgents.length],
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            "Accept-Language": "ro-RO,ro;q=0.9,en-US;q=0.8,en;q=0.7",
            "Accept-Encoding": "gzip, deflate, br",
            "Cache-Control": "max-age=0",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
            "Sec-Ch-Ua": '"Chromium";v="110", "Not A(Brand";v="24", "Google Chrome";v="110"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1"
          },
          timeout: 20000,
          validateStatus: (status) => status < 600 // Allow 5xx so we can handle them manually
        });

        if (response.status === 403 || response.status === 429 || response.status === 503) {
           console.log(`Target site returned ${response.status} on attempt ${i+1}, retrying...`);
           lastError = new Error(`Site returned ${response.status}`);
           await new Promise(r => setTimeout(r, 2000 * (i + 1))); // Exponential backoff
           continue; 
        }

        if (response.status >= 400) {
           throw new Error(`HTTP Error ${response.status}`);
        }

        const html = response.data;
      const $ = cheerio.load(html);

      // Extract some basic metadata
      const title = $("title").text() || "No title found";
      
      // Extract image URLs strictly for the target property (filtering out logos, layouts, and recommendations)
      const imageExtensions = /\.(jpeg|jpg|gif|png|webp|avif)/i;
      const socialMediaBlocked = ["facebook.com", "linkedin.com", "twitter.com", "instagram.com", "youtube.com", "pinterest.com", "tiktok.com"];
      const adKeywords = ["google-analytics", "ads.", "doubleclick", "/ads/", "/banners/"];

      // Helper to identify and reject icons, logos, badges, layouts, avatars, maps, buttons, etc.
      const isForbiddenGraphic = (urlStr: string): boolean => {
        const lower = urlStr.toLowerCase();
        const badPatterns = [
          "logo", "avatar", "watermark-logo", "badge", "icon", "placeholder", 
          "sprite", "layout", "banner", "staticmap", "google-map", "/map/", "maps.googleapis",
          "favicon", "button", "arrow", "pin", "pixel", "tracking", "analytics",
          "user", "profile", "agent", "broker", "agentie", "dezvoltator", "developer",
          "sponsor", "promovat", "blank", "default", "spinner", "loader", ".svg",
          "schita", "plan", "schiță", "document", "pdf", ".gif", "thumb_", "small_",
          "150x150", "75x75", "100x100", "160x120", "200x150", "50x50", "60x60", "32x32",
          "card_thumb", "list_thumb", "mini_thumb", "recommend", "similar", "related",
          "header", "footer", "navbar", "ad-banner"
        ];
        return badPatterns.some(p => lower.includes(p));
      };

      // Helper to promote known thumbnail image URLs to full/maximum resolution safely
      const promoteToHighRes = (rawUrl: string): string => {
        if (!rawUrl || typeof rawUrl !== "string") return "";
        let cleaned = rawUrl.trim().replace(/\\/g, "");
        if (cleaned.startsWith("//")) cleaned = "https:" + cleaned;

        // Clean redundant port :443/
        if (cleaned.includes(":443/")) {
          cleaned = cleaned.replace(":443/", "/");
        }

        // Safe Imobiliare.ro & Roamcdn resolution boost: only replace small size tokens in filename
        if (cleaned.includes("imobiliare.ro") || cleaned.includes("roamcdn")) {
          cleaned = cleaned.replace(/_(?:75x75|150x150|160x120|200x150|400x300)\.jpg/gi, "_800x600.jpg");
        }

        // Storia / OLX Apollo: if it already specifies a small resolution via ;s=, normalize to ;s=1000x700
        if (cleaned.includes(";s=")) {
          cleaned = cleaned.replace(/;s=\d+x\d+/, ";s=1000x700");
        }

        return cleaned;
      };

      // Priority 1: Check __NEXT_DATA__ for the target property's dedicated photo gallery
      let nextDataTargetImages: string[] = [];
      const nextDataScripts = $("script#__NEXT_DATA__, script:contains('__NEXT_DATA__')");
      if (nextDataScripts.length > 0) {
        try {
          const content = nextDataScripts.first().html() || "";
          if (content) {
            const data = JSON.parse(content);
            const targetAd = data?.props?.pageProps?.ad || data?.props?.pageProps?.advert || data?.props?.pageProps?.offer;
            const photoList = targetAd?.photos || targetAd?.images || targetAd?.gallery || targetAd?.media?.photos;
            if (Array.isArray(photoList) && photoList.length > 0) {
              photoList.forEach((item: any) => {
                let candidate = item?.large || item?.url || item?.medium || item?.small || item?.thumbnail || (typeof item === 'string' ? item : null);
                if (!candidate && item?.filename) {
                  candidate = `https://apollo.olxcdn.com/v1/files/${item.filename}/image;s=1000x700`;
                }
                if (candidate && typeof candidate === 'string') {
                  const promoted = promoteToHighRes(candidate);
                  if (!isForbiddenGraphic(promoted)) {
                    nextDataTargetImages.push(promoted);
                  }
                }
              });
            }
          }
        } catch (e) {}
      }

      // Priority 2: JSON-LD metadata for target property
      let jsonLdImages: string[] = [];
      if (nextDataTargetImages.length === 0) {
        $("script[type='application/ld+json']").each((_, script) => {
          try {
            const content = $(script).html();
            if (content) {
              const ld = JSON.parse(content);
              const items = Array.isArray(ld) ? ld : (ld["@graph"] ? ld["@graph"] : [ld]);
              items.forEach((item: any) => {
                if (item && item.image) {
                  const imgs = Array.isArray(item.image) ? item.image : [item.image];
                  imgs.forEach((img: any) => {
                    const u = typeof img === 'string' ? img : (img?.url || img?.contentUrl);
                    if (u && typeof u === 'string') {
                      const promoted = promoteToHighRes(u);
                      if (!isForbiddenGraphic(promoted)) {
                        jsonLdImages.push(promoted);
                      }
                    }
                  });
                }
              });
            }
          } catch (e) {}
        });
      }

      // Priority 3: DOM Gallery elements (with aggressive stripping of recommendations, ads, and similar listings)
      let domGalleryImages: string[] = [];
      if (nextDataTargetImages.length === 0 && jsonLdImages.length === 0) {
        const unrelatedSelectors = [
          "aside", "footer", "nav", "header",
          ".recommendations", ".featured-offers", ".similar-offers", ".similar-ads", 
          ".others-ads", ".suggested-offers", "[data-testid=\"recommendations\"]", 
          ".listing-related", ".related-ads", "#ad-recommendations", ".bottom-ads",
          ".other-offers", ".related-offers", ".promoted-offers", ".slider-similar",
          ".agent-card", ".agency-card", ".agency-logo", ".broker-logo", ".developer-logo",
          ".user-card", ".user-profile", ".breadcrumbs", ".search-results",
          "[data-cy=\"similar-ads\"]", "[data-cy=\"recommended-ads\"]",
          ".ad-carousel-similar", ".similar-listings", ".related-properties",
          ".cross-selling", ".cross-sell", ".banner", ".ad-banner", ".header-logo",
          ".site-header", ".site-footer", ".navbar", ".menu", ".sidebar", ".contact-agent-section",
          "[data-testid*=\"similar\"]", "[data-testid*=\"recommend\"]", "[data-testid*=\"promoted\"]",
          "[data-cy*=\"similar\"]", "[data-cy*=\"recommend\"]", "[data-cy*=\"ad-card\"]", "[data-cy*=\"listing\"]",
          "[data-testid*=\"ad-card\"]", "[data-testid*=\"listing\"]",
          ".cards-container", ".slider-cards",
          "[class*=\"similar\"]", "[class*=\"recommend\"]", "[class*=\"suggested\"]",
          "section:has(h2:contains(\"similare\"))", "section:has(h3:contains(\"similare\"))",
          "section:has(h2:contains(\"recomand\"))", "section:has(h3:contains(\"recomand\"))"
        ];
        unrelatedSelectors.forEach(selector => {
          $(selector).remove();
        });

        const galleryContainers = $(
          "#galerie, .galerie, [data-testid=\"gallery\"], [data-testid=\"swiper-image\"], .gallery-slider, " +
          ".image-gallery, .swiper-wrapper, .property-gallery, .offer-photos, #slider-pro, .slider-for, " +
          ".ad-gallery, [data-cy=\"ad-photos\"], .main-slider, #fotoGal, .foto-galerie, #photo-gallery, " +
          ".slider-galerie, #anunt-galerie"
        );

        // Never search full body to avoid grabbing thumbnails from recommendations and sidebar cards
        const searchScope = galleryContainers.length > 0 
          ? galleryContainers 
          : $("article[data-cy='ad-content'], [data-cy='ad-content'], .offer-view, .ad-content, #main-content, main, article");

        searchScope.find("img, a, picture source, [data-src], [data-lazy], [data-full], [data-lazy-src], [data-original], [data-src-full], [data-zoom], [data-image], [data-gallery-src], [data-url]").each((_, el) => {
          const $el = $(el);
          const src = $el.attr("src");
          const dataSrc = $el.attr("data-src") || $el.attr("data-lazy") || $el.attr("data-full") || $el.attr("data-lazy-src") || $el.attr("data-original") || $el.attr("data-src-full") || $el.attr("data-zoom") || $el.attr("data-image") || $el.attr("data-gallery-src") || $el.attr("data-url");
          const href = ($el.prop("tagName") === "A") ? $el.attr("href") : null;
          const srcset = $el.attr("srcset") || $el.attr("data-srcset");

          let candidates = [dataSrc, src, href];
          if (srcset) {
            const sources = srcset.split(",").map(s => s.trim().split(" ")[0]);
            candidates = [...candidates, ...sources];
          }

          candidates.forEach(raw => {
            if (!raw || typeof raw !== "string") return;
            let absUrl = raw.trim().replace(/\\/g, "");
            if (absUrl.startsWith("//")) absUrl = "https:" + absUrl;
            else if (absUrl.startsWith("/") && !absUrl.startsWith("//")) {
              try {
                const uObj = new URL(url);
                absUrl = uObj.origin + absUrl;
              } catch (e) {}
            }
            if (!absUrl.startsWith("http")) return;
            if (isForbiddenGraphic(absUrl)) return;
            if (socialMediaBlocked.some(s => absUrl.toLowerCase().includes(s))) return;
            if (adKeywords.some(k => absUrl.toLowerCase().includes(k))) return;

            const isKnownImage = imageExtensions.test(absUrl) || 
              absUrl.includes("/files/") || absUrl.includes("/image") || absUrl.includes("/photos/") || absUrl.includes("roamcdn") || absUrl.includes("apollo");

            if (isKnownImage) {
              const promoted = promoteToHighRes(absUrl);
              domGalleryImages.push(promoted);
            }
          });
        });
      }

      // Collect candidates based on priority
      const rawCandidates = nextDataTargetImages.length > 0
        ? nextDataTargetImages
        : (jsonLdImages.length > 0 ? jsonLdImages : domGalleryImages);

      // Deduplicate images and keep highest resolution version
      const deduplicateImages = (urls: string[]) => {
        const map = new Map<string, string>();

        const getCanonical = (u: string) => {
          let base = u.split(/[?;]/)[0];
          // 1. OLX / Storia file ID: /v1/files/([^/]+)/
          const olxMatch = base.match(/\/v1\/files\/([^/]+)/i);
          if (olxMatch) return `olx-file-${olxMatch[1].toLowerCase()}`;

          // 2. Roamcdn / Imobiliare UUID or 32-char hex hash
          const uuidMatch = base.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
          if (uuidMatch) return `uuid-${uuidMatch[1].toLowerCase()}`;
          const md5Match = base.match(/([a-f0-9]{32})/i);
          if (md5Match) return `md5-${md5Match[1].toLowerCase()}`;

          // 3. Filename cleaning (strip dimensions and responsive suffixes)
          const filename = base.split("/").pop() || base;
          const cleanFilename = filename
            .replace(/_\d+x\d+(?=\.[a-z]+)/i, "")
            .replace(/-(?:full|small|medium|thumb|large|mini|1200w|1600w|800w|400w|600w|300w)/gi, "");
          return cleanFilename.toLowerCase();
        };

        const getScore = (u: string) => {
          const lower = u.toLowerCase();
          let score = 0;
          if (lower.includes("2048x") || lower.includes("1920x")) score += 300;
          if (lower.includes("1200w") || lower.includes("1600w")) score += 200;
          if (lower.includes("1000x700") || lower.includes("1280x") || lower.includes("900w")) score += 100;
          if (lower.includes("800x600")) score += 50;
          if (lower.includes("/large/") || lower.includes("/galerie/")) score += 40;
          if (lower.includes("/medium/")) score += 20;
          if (lower.includes("/small/") || lower.includes("/thumb/") || lower.includes("140w")) score -= 50;
          if (isForbiddenGraphic(u)) score -= 10000;
          return score;
        };

        urls.forEach(u => {
          if (isForbiddenGraphic(u)) return;
          const key = getCanonical(u);
          const existing = map.get(key);
          if (!existing || getScore(u) > getScore(existing)) {
            map.set(key, u);
          }
        });

        return Array.from(map.values()).filter(u => !isForbiddenGraphic(u));
      };

      const uniqueImages = deduplicateImages(rawCandidates).slice(0, 50);
      console.log(`Found ${uniqueImages.length} unique images for ${url}`);

      // Extract seller name explicitly if possible (OLX/Storia patterns)
      let sellerName = "";
      
      const sellerSelectors = [
        '[data-testid="user-profile-link"] h4',
        '[data-testid="user-info"] h4',
        'div[class*="User-profile"] h4',
        '[data-testid*="user"] h4',
        ".css-1wv6n9s", // Common OLX user class
        '[data-testid="seller-card-name"]',
        '[data-testid="agent-name"]',
        ".css-1l5shf0" // Common Storia user class
      ];

      for (const selector of sellerSelectors) {
        const found = $(selector).first().text().trim();
        if (found) {
          sellerName = found;
          break;
        }
      }

      // Final deduplication check for "NameName" patterns
      if (sellerName) {
        const half = Math.floor(sellerName.length / 2);
        const firstHalf = sellerName.substring(0, half);
        const secondHalf = sellerName.substring(half);
        if (firstHalf === secondHalf && half > 1) {
          sellerName = firstHalf;
        }
      }

      // Extract Phone Number explicitly if possible (OLX/Storia patterns or Regex)
      let sellerPhone = "";
      const isOLXOrStoria = url.includes("olx.ro") || url.includes("storia.ro");
      
      let numericId: any = null;
      if (html.includes("__NEXT_DATA__")) {
        try {
          const $nextData = $("script#__NEXT_DATA__");
          if ($nextData.length) {
            const nextJson = JSON.parse($nextData.html() || "{}");
            const ad = nextJson?.props?.pageProps?.ad || nextJson?.props?.pageProps?.advert;
            if (ad && ad.id) {
              numericId = ad.id;
            }
            if (ad?.contact?.phone) {
              sellerPhone = ad.contact.phone;
            }
          }
        } catch (e) {}
      }

      if (isOLXOrStoria && numericId && !sellerPhone) {
        try {
          console.log(`Fetching dynamic contact phone number for OLX/Storia ID: ${numericId}`);
          const phonesUrl = url.includes("storia.ro")
            ? `https://www.storia.ro/api/v1/offers/${numericId}/phones/`
            : `https://www.olx.ro/api/v1/offers/${numericId}/phones/`;

          const phoneRes = await axios.get(phonesUrl, {
            headers: {
              "User-Agent": userAgents[i % userAgents.length],
              "Referer": url,
              "Accept": "application/json"
            },
            timeout: 5000
          });

          if (phoneRes.status === 200 && phoneRes.data) {
            const dataVal = phoneRes.data.data;
            if (dataVal && Array.isArray(dataVal.phones) && dataVal.phones.length > 0) {
              sellerPhone = dataVal.phones[0];
            } else if (phoneRes.data.value) {
              sellerPhone = phoneRes.data.value;
            } else if (Array.isArray(phoneRes.data) && phoneRes.data.length > 0) {
              sellerPhone = phoneRes.data[0];
            }
          }
        } catch (e: any) {
          console.log(`Fallback OLX/Storia phone lookup failed: ${e.message}`);
          try {
            const limitedPhonesUrl = url.includes("storia.ro")
              ? `https://www.storia.ro/api/v1/offers/${numericId}/limited-phones/`
              : `https://www.olx.ro/api/v1/offers/${numericId}/limited-phones/`;
            const phoneRes = await axios.get(limitedPhonesUrl, {
              headers: { "User-Agent": userAgents[i % userAgents.length], "Referer": url },
              timeout: 4000
            });
            if (phoneRes.status === 200 && phoneRes.data) {
              const dataVal = phoneRes.data.data;
              if (dataVal && Array.isArray(dataVal.phones) && dataVal.phones.length > 0) {
                sellerPhone = dataVal.phones[0];
              } else if (phoneRes.data.value) {
                sellerPhone = phoneRes.data.value;
              }
            }
          } catch (err: any) {
            console.log(`limited-phones endpoint lookup failed: ${err.message}`);
          }
        }
      }

      // Convert HTML to clean text for Gemini
      const text = convert(html, {
        wordwrap: 130,
        selectors: [
          { selector: "a", options: { ignoreHref: true } },
          { selector: "img", format: "skip" },
          { selector: "nav", format: "skip" },
          { selector: "footer", format: "skip" },
          { selector: "script", format: "skip" },
          { selector: "style", format: "skip" },
        ],
      });

      // Extract custom script details for exact specification metadata (JSON-LD or NEXT_DATA) - limited to essential data
      const scriptTexts: string[] = [];
      let jsonLdData: any = null;
      $("script[type='application/ld+json']").each((_, el) => {
        const htmlVal = $(el).html();
        if (htmlVal) {
          if (!jsonLdData) {
            try { jsonLdData = JSON.parse(htmlVal); } catch (e) {}
          }
          if (scriptTexts.join("").length < 3000) {
            scriptTexts.push(htmlVal.trim().substring(0, 1500));
          }
        }
      });

      let nextAdData: any = null;
      $("script#__NEXT_DATA__").each((_, el) => {
        const htmlVal = $(el).html();
        if (htmlVal) {
          if (!nextAdData) {
            try {
              const parsed = JSON.parse(htmlVal);
              nextAdData = parsed?.props?.pageProps?.ad || parsed?.props?.pageProps?.advert;
            } catch (e) {}
          }
          if (scriptTexts.join("").length < 3000) {
            scriptTexts.push(htmlVal.trim().substring(0, 1500));
          }
        }
      });

      // Robust phone number extraction (from HTML attributes, buttons, JSON keys or regex matches)
      if (!sellerPhone || sellerPhone.includes("...") || sellerPhone.length < 10) {
        const phoneCandidates: string[] = [];
        
        // Match specific JSON structures or dataset attributes
        const jsonPhoneKeys = [
          /"telefon"\s*:\s*"([^"]+)"/gi,
          /"phone"\s*:\s*"([^"]+)"/gi,
          /"phoneNumber"\s*:\s*"([^"]+)"/gi,
          /"contact_phone"\s*:\s*"([^"]+)"/gi,
          /\\"[tT]elefon\\"\s*:\s*\\"[^"\d]*(\d+)[^"\d]*\\"/g,
          /\\"[pP]hone\\"\s*:\s*\\"[^"\d]*(\d+)[^"\d]*\\"/g,
          /data-telefon="([^"]+)"/gi,
          /data-phone="([^"]+)"/gi,
          /tel:([^"]+)/gi
        ];

        for (const regex of jsonPhoneKeys) {
          let match;
          while ((match = regex.exec(html)) !== null) {
            const rawVal = match[1];
            const cleaned = rawVal.replace(/[^\d+]/g, "").trim();
            if ((cleaned.startsWith("07") && cleaned.length === 10) || 
                (cleaned.startsWith("407") && cleaned.length === 12) || 
                (cleaned.startsWith("+407") && cleaned.length === 13)) {
              phoneCandidates.push(cleaned);
            }
          }
        }

        // Match common elements
        $("[data-telefon], [data-phone], [data-contacts], [data-contact], .phone, .telefon, a[href^='tel:']").each((_, el) => {
          const $el = $(el);
          const tel = $el.attr("data-telefon") || $el.attr("data-phone") || $el.attr("data-contact") || $el.text();
          const href = $el.attr("href");
          if (href && href.startsWith("tel:")) {
            phoneCandidates.push(href.replace("tel:", "").trim());
          }
          if (tel) {
            phoneCandidates.push(tel.trim());
          }
        });

        // Regex lookup in raw text and HTML body
        const romanianPhoneRegex = /(?:\+40|0)\s?7\d{2}[\s.-]?\d{3}[\s.-]?\d{3}\b/g;
        const phoneMatches = (html.match(romanianPhoneRegex) || []).concat(text.match(romanianPhoneRegex) || []);
        if (phoneMatches) {
          for (const rawMatch of phoneMatches) {
            const cleaned = rawMatch.replace(/[^\d+]/g, "").trim();
            if (cleaned.startsWith("07") && cleaned.length === 10) {
              phoneCandidates.push(cleaned);
            } else if (cleaned.startsWith("407") && cleaned.length === 12) {
              phoneCandidates.push("0" + cleaned.substring(2));
            } else if (cleaned.startsWith("+407") && cleaned.length === 13) {
              phoneCandidates.push("0" + cleaned.substring(3));
            }
          }
        }

        if (phoneCandidates.length > 0) {
          const normalized = phoneCandidates.map(p => {
            const cleanStr = p.replace(/[^\d+]/g, "").trim();
            if (cleanStr.startsWith("+40")) return "0" + cleanStr.substring(3);
            if (cleanStr.startsWith("40")) return "0" + cleanStr.substring(2);
            return cleanStr;
          }).filter(p => p.startsWith("07") && p.length === 10);
          
          const uniquePhones = [...new Set(normalized)];
          if (uniquePhones.length > 0) {
            sellerPhone = uniquePhones[0];
          }
        }
      }

      // --- Pure Crawler Extraction of Full Property Data (No AI Needed!) ---
      const lowerCombo = (url + " " + title + " " + text).toLowerCase();
      const urlLower = url.toLowerCase();
      const titleLower = title.toLowerCase();

      // 1. Category extraction (needed to qualify price thresholds)
      let categoria = "Apartament";
      if (lowerCombo.includes("garsonier") || lowerCombo.includes("studio")) {
        categoria = "Apartament";
      } else if (lowerCombo.includes("casa") || lowerCombo.includes("vila") || lowerCombo.includes("duplex")) {
        categoria = "Casa/Vila";
      } else if (lowerCombo.includes("teren")) {
        categoria = "Teren";
      } else if (lowerCombo.includes("birou") || lowerCombo.includes("office")) {
        categoria = "Spatiu Birou";
      } else if (lowerCombo.includes("comercial") || lowerCombo.includes("magazin") || lowerCombo.includes("spatiu comercial")) {
        categoria = "Spatiu Comercial";
      } else if (lowerCombo.includes("industrial") || lowerCombo.includes("hala") || lowerCombo.includes("depozit")) {
        categoria = "Spatiu Industrial";
      }

      // 2. Price & Currency extraction
      let rawPriceNum = 0;
      let currency = "EUR";
      if (nextAdData?.price?.regularPrice?.value) {
        rawPriceNum = Number(nextAdData.price.regularPrice.value);
        const currSym = String(nextAdData.price.regularPrice.currencySymbol || "").toUpperCase();
        currency = currSym.includes("LEI") || currSym.includes("RON") ? "RON" : "EUR";
      } else if (jsonLdData?.offers?.price) {
        rawPriceNum = Number(jsonLdData.offers.price);
        currency = String(jsonLdData.offers.priceCurrency || "EUR").toUpperCase();
      } else {
        const priceRegex = /(?:pre[t\u021b]|chirie|\b)\s*[:\-–]?\s*(\d[\d\s.,]{1,9})\s*(€|eur|euro|ron|lei)\b/i;
        const pMatch = text.match(priceRegex) || title.match(/(\d[\d\s.,]{1,9})\s*(€|eur|euro|ron|lei)\b/i);
        if (pMatch) {
          rawPriceNum = parseInt(pMatch[1].replace(/[^0-9]/g, ""), 10) || 0;
          const currStr = pMatch[2].toLowerCase();
          currency = currStr.includes("ron") || currStr.includes("lei") ? "RON" : "EUR";
        }
      }

      // Approximate price in EUR for threshold comparisons
      const priceInEur = currency === "RON" ? Math.round(rawPriceNum / 5) : rawPriceNum;

      // 3. Robust Transaction Type Detection (Rent vs Sale)
      // Per rules: Usually rents are less than 10,000 euros, while sales are thousands of euros (20,000+).
      const hasPerMonth = /\b(?:pe\s*lun[aă]|\/\s*lun[aă]|\/\s*month|per\s*month|lunar[aă]?)\b/i.test(title + " " + text);
      const urlHasRent = /\b(?:de-inchiriat|inchiriere|inchirieri|inchiriat|chirie|rent)\b/i.test(urlLower);
      const urlHasSale = /\b(?:de-vanzare|vanzare|vanzari|cumparare|sale)\b/i.test(urlLower);
      const titleHasRent = /\b(?:de\s+[îi]nchiriat|spre\s+[îi]nchiriere|ofer\s+spre\s+[îi]nchiriere|[îi]nchiriez|chirie|for\s+rent)\b/i.test(titleLower);
      const titleHasSale = /\b(?:de\s+v[aâ]nzare|spre\s+v[aâ]nzare|v[aâ]nd|v[aâ]nzare|for\s+sale)\b/i.test(titleLower);
      
      const structuredCat = String(nextAdData?.category?.name || "").toLowerCase();
      const structuredTarget = String(nextAdData?.target?.transaction_type || nextAdData?.target?.action || "").toLowerCase();
      const structuredIsRent = structuredCat.includes("inchiri") || structuredTarget.includes("rent");
      const structuredIsSale = structuredCat.includes("vanza") || structuredTarget.includes("sell") || structuredTarget.includes("sale");

      let isRent = false;

      if (priceInEur >= 20000) {
        // High price (20,000+ EUR) is overwhelmingly a SALE (e.g. 50,000€, 120,000€, 300,000€).
        // Even if description mentions "se poate închiria" or "randament închiriere", it is a SALE.
        // Exception only for dedicated massive commercial rent with unambiguous rent URL & /lună.
        if (urlHasRent && hasPerMonth && (categoria === "Spatiu Birou" || categoria === "Spatiu Comercial" || categoria === "Spatiu Industrial")) {
          isRent = true;
        } else {
          isRent = false;
        }
      } else if (priceInEur > 0 && priceInEur <= 10000) {
        // Low price (under 10,000 EUR) is overwhelmingly a RENT (e.g. 350€, 600€, 1200€, 3000€).
        // Standard residential apartments/houses are never sold for under 10,000 EUR.
        // Only exception: explicit plot of land or small garage parking with explicit sale in URL/title.
        if ((categoria === "Teren" || lowerCombo.includes("garaj") || lowerCombo.includes("parcare")) && (urlHasSale || titleHasSale)) {
          isRent = false;
        } else {
          isRent = true;
        }
      } else if (priceInEur > 10000 && priceInEur < 20000) {
        // Intermediate band (10,000 - 20,000 EUR)
        if (urlHasRent || titleHasRent || structuredIsRent || hasPerMonth) {
          isRent = true;
        } else {
          isRent = false;
        }
      } else {
        // Price not found (0 or N/A) -> rely on URL, title and structured tags
        if (urlHasRent || titleHasRent || structuredIsRent || hasPerMonth) {
          isRent = true;
        } else if (urlHasSale || titleHasSale || structuredIsSale) {
          isRent = false;
        } else {
          const rentMentions = (lowerCombo.match(/\b(?:[îi]nchiriere|chirie|garan[t\u021b]ie|depozit)\b/g) || []).length;
          const saleMentions = (lowerCombo.match(/\b(?:v[aâ]nzare|credit\s+ipotecar|noua\s+cas[aă]|cadastru)\b/g) || []).length;
          isRent = rentMentions > saleMentions;
        }
      }

      const transactionType = isRent ? "Închiriere" : "Vânzare";
      console.log(`[Crawler Transaction Detection] Price: ${priceInEur} EUR (${currency}) -> Type: ${transactionType} (URL Rent: ${urlHasRent}, Title Rent: ${titleHasRent})`);

      const formattedPrice = rawPriceNum > 0 
        ? `${rawPriceNum.toLocaleString("ro-RO")} ${currency}${transactionType === "Închiriere" ? " / lună" : ""}` 
        : "N/A";

      // 4. City & Zone
      let oras = "București";
      let zona = "";
      if (nextAdData?.location?.city?.name) oras = nextAdData.location.city.name;
      if (nextAdData?.location?.district?.name) zona = nextAdData.location.district.name;
      
      if (!zona) {
        const secMatch = (title + " " + text).match(/Sector\s*[1-6]/i);
        if (secMatch) {
          zona = secMatch[0];
        } else {
          const commonZones = [
            "Pipera", "Floreasca", "Dorobanti", "Aviatiei", "Baneasa", "Militari", "Drumul Taberei", 
            "Titan", "Dristor", "Vitan", "Unirii", "Universitate", "Victoriei", "Tineretului", 
            "Berceni", "Pantelimon", "Colentina", "Tei", "Crangasi", "Grozavesti", "Cotroceni"
          ];
          for (const z of commonZones) {
            if (lowerCombo.includes(z.toLowerCase())) {
              zona = z;
              break;
            }
          }
        }
      }
      if (!zona) zona = oras;

      // 5. Specs (Surface, Rooms, Floor, Heating, Furnished)
      let suprafataUtila = "";
      let camere = "";
      let etaj = "";
      let anConstructie = "";
      let compartimentare = "Decomandat";
      let sistemIncalzire: string[] = ["Centrala proprie"];
      let climatizare: string[] = [];
      let mobilat = "Complet";

      if (Array.isArray(nextAdData?.parameters)) {
        for (const p of nextAdData.parameters) {
          if (p.key === "m") suprafataUtila = String(p.value || "");
          if (p.key === "rooms_num") camere = String(p.value || "");
          if (p.key === "floor_select") etaj = String(p.value || "");
          if (p.key === "build_year") anConstructie = String(p.value || "");
          if (p.key === "furniture") mobilat = String(p.value || "Complet");
        }
      }

      if (!suprafataUtila) {
        const sMatch = text.match(/(?:suprafa[t\u021b\u0163]?[a\u0103]?\s*util[a\u0103]?|s\s*util[a\u0103]?|utila)\s*[:\-–]?\s*(\d+(?:[.,]\d+)?)\s*(?:mp|m2|m\u00b2)/i);
        if (sMatch) suprafataUtila = sMatch[1].replace(",", ".");
      }
      if (!camere) {
        const cMatch = text.match(/(?:num[a\u0103]r\s*camere|camere|nr\s*camere)\s*[:\-–]?\s*(\d+)/i) || title.match(/(\d+)\s*camere/i);
        if (cMatch) camere = cMatch[1];
        else if (lowerCombo.includes("garsonier") || lowerCombo.includes("studio")) camere = "1";
        else camere = "2";
      }
      if (!etaj) {
        const eMatch = text.match(/(?:etaj|etajul)\s*[:\-–]?\s*(parter|demisol|mansarda|\d+\/\d+|\d+)/i);
        if (eMatch) etaj = eMatch[1];
        else etaj = "1";
      }
      if (!anConstructie) {
        const aMatch = text.match(/(?:an\s*construc[t\u021b]ie|construit\s*[îi]n|an\s*bloc)\s*[:\-–]?\s*(\d{4})/i);
        if (aMatch) anConstructie = aMatch[1];
      }

      let balcoane = "";
      if (Array.isArray(nextAdData?.parameters)) {
        for (const p of nextAdData.parameters) {
          if (p.key === "balconies_num" || p.key === "balcony" || p.key === "balcoane") balcoane = String(p.value || "");
        }
      }
      if (!balcoane) {
        const bMatch = text.match(/(\d+)\s*balco?ane?/i);
        if (bMatch) balcoane = bMatch[1];
      }
      const balcoaneFinal = balcoane || "1";

      const numUtila = parseFloat(suprafataUtila) || 55;
      const mult = (categoria === "Apartament" || categoria === "Casa/Vila") ? 1.2 : 1.1;
      const suprafataConstruita = Math.round(numUtila * mult).toString();

      if (lowerCombo.includes("centrala proprie") || lowerCombo.includes("centrală proprie")) {
        sistemIncalzire = ["Centrala proprie"];
      } else if (lowerCombo.includes("termoficare") || lowerCombo.includes("centralizat") || lowerCombo.includes("radet")) {
        sistemIncalzire = ["Termoficare"];
      }

      if (lowerCombo.includes("aer conditionat") || lowerCombo.includes("aer condiționat") || lowerCombo.includes("climatizare")) {
        climatizare = ["Aer conditionat"];
      }

      if (lowerCombo.includes("semidecomandat")) compartimentare = "Semidecomandat";
      else if (lowerCombo.includes("open space") || lowerCombo.includes("openspace")) compartimentare = "Open space";
      else if (lowerCombo.includes("circular")) compartimentare = "Circular";
      else if (lowerCombo.includes("nedecomandat")) compartimentare = "Nedecomandat";
      else compartimentare = "Decomandat";

      if (lowerCombo.includes("nemobilat")) mobilat = "Nemobilat";
      else if (lowerCombo.includes("partial mobilat")) mobilat = "Partial";

      // 6. Original Description
      let rawDescription = "";
      if (nextAdData?.description) {
        rawDescription = convert(nextAdData.description, { wordwrap: false });
      } else {
        const descSelectors = [
          '[data-cy="ad_description"]', 
          '[data-testid="description-section"]', 
          '.offer-description', 
          '#descriere', 
          '.descriptioncontent', 
          '.ad-description'
        ];
        for (const sel of descSelectors) {
          const htmlDesc = $(sel).html();
          if (htmlDesc) {
            rawDescription = convert(htmlDesc, { wordwrap: false });
            break;
          }
        }
        if (!rawDescription) {
          rawDescription = text.substring(0, 3000);
        }
      }

      // Clean Title
      let cleanTitle = title.replace(/\s*[-|•]\s*(OLX\.ro|Storia\.ro|Imobiliare\.ro|Publi24\.ro).*$/i, "").trim();
      if (!cleanTitle || cleanTitle === "No title found") {
        cleanTitle = `${categoria} ${camere} camere | ${zona} | ${formattedPrice}`;
      }

      // 7. Full baseline CRM Data object - all photos start in 'alteSpatii' for manual slot moving!
      const crmData = {
        detaliiGenerale: {
          stadiu: "Activ - Hot",
          tranzactie: transactionType,
          categoria: categoria,
          proprietar: sellerName || "Nespecificat",
          contacteAditionale: sellerPhone || "Nespecificat",
          ansambluRezidential: "",
          localizare: {
            oras: oras,
            zona: [zona],
            strada: "",
            numar: "",
            bloc: "",
            scara: "",
            apartament: "",
            puncteInteres: [],
            imprejurimi: []
          },
          memoPrivat: ""
        },
        caracteristici: {
          detalii: {
            tipCasa: "",
            tipApartament: categoria === "Apartament" ? "Standard" : "",
            compartimentare: compartimentare,
            confort: "1",
            destinatie: "Rezidential",
            camere: String(camere),
            bucatarii: "1",
            dormitoare: String(Math.max(1, parseInt(camere) - 1 || 1)),
            bai: "1",
            balcoane: "0",
            terase: "0",
            etaj: String(etaj),
            orientare: "",
            parcari: "0",
            garaje: "0",
            checkList: []
          },
          suprafete: {
            utila: String(suprafataUtila || numUtila),
            amprenta: "",
            construita: suprafataConstruita,
            utilaTotala: String(suprafataUtila || numUtila),
            balcoane: "0",
            terase: "0",
            gradina: "0",
            teren: "0",
            terenLiber: "0",
            frontStradal: "",
            vitrina: "",
            numarFronturi: "",
            numarTerase: "0",
            numarBalcoane: "0"
          },
          alteDetalii: {
            stadiuConstructie: "Finalizata",
            structura: "Beton",
            tipImobil: categoria === "Casa/Vila" ? "Casa/Vila" : "Bloc",
            riscSeismic: "",
            anConstructie: String(anConstructie || ""),
            anRenovare: "",
            inaltime: ""
          },
          energetica: {
            clasa: "",
            consumAnual: "",
            emisiiCO2: "",
            consumRegenerabile: ""
          }
        },
        utilitati: {
          general: ["Curent", "Apa", "Canalizare", "Gaz"],
          sistemIncalzire: sistemIncalzire,
          climatizare: climatizare,
          finisaje: {
            stare: ["Buna"],
            izolatii: ["Exterior"],
            pereti: ["Vopsea lavabila", "Faianta"],
            podele: ["Parchet", "Gresie"],
            ferestre: ["PVC"],
            jaluzele: [],
            rulouri: [],
            usaIntrare: ["Metal"],
            usiInterior: ["Lemn"],
            acoperis: []
          },
          dotari: {
            mobilat: mobilat,
            spatiiAditionale: [],
            bucatarie: ["Mobilata", "Utilata"],
            contorizare: ["Apometre", "Contor curent electric", "Contor gaz"],
            electrocasnice: ["Frigider", "Masina de spalat rufe", "Aragaz"],
            imobil: ["Interfon"],
            diverse: [],
            servicii: [],
            amenajareStrazi: ["Asfaltate", "Iluminat stradal"],
            priveliste: ["Spre oras"]
          }
        },
        pret: {
          detalii: {
            pret: formattedPrice,
            moneda: currency,
            pretMp: "",
            ultimPret: "",
            checkList: [],
            plataAcceptata: "Cash sau Credit",
            pretGaraj: "",
            pretParcare: "",
            avans: transactionType === "Închiriere" ? "1 lună avans" : "",
            garantie: transactionType === "Închiriere" ? "1 lună garanție" : "",
            tvaIncluded: false,
            notePrivate: ""
          },
          comisioane: {
            comisionCumparatorProcent: transactionType === "Închiriere" ? "50%" : "0%",
            comisionCumparatorValoare: transactionType === "Închiriere" ? "50%+TVA" : "0% (comision 0% pentru cumpărător)",
            comisionProprietarProcent: transactionType === "Închiriere" ? "50%" : "0%",
            comisionProprietarValoare: transactionType === "Închiriere" ? "50%+TVA" : "0% (comision 0% pentru cumpărător)",
            colaborare: false
          },
          contract: {
            tip: "Intermediere",
            semnat: "Nu",
            nr: "",
            dataSemnare: "",
            dataExpirare: ""
          }
        },
        descriere: {
          titlu: cleanTitle,
          continut: rawDescription,
          disponibilitate: "Imediat",
          video: "",
          turVirtual: ""
        },
        imagini: {
          living: uniqueImages.map(img => ({ original: img })),
          bucatarie: [],
          camera: [],
          baie: [],
          alteSpatii: []
        }
      };

      const defaultCommission = transactionType === "Închiriere" ? "50%+TVA" : "0%";

      // Summary: includes all configurare section data and area, easy to read, <= 512 chars
      const summaryCamere = camere && camere !== "-" ? `${camere} camere` : "";
      const summarySuprafata = suprafataUtila ? `${suprafataUtila} mp utili` : "";
      const summaryComp = compartimentare || "decomandat";
      const summaryEtaj = etaj ? (etaj.toLowerCase().startsWith("etaj") || etaj.toLowerCase() === "parter" || etaj.toLowerCase() === "demisol" ? `la ${etaj.toLowerCase()}` : `la etajul ${etaj}`) : "";
      const summaryAn = anConstructie ? `într-un bloc din ${anConstructie}` : "";
      const summarySpecs = [summaryCamere, summarySuprafata].filter(Boolean).join(", ") || "spațiu generos";
      let summaryText = `Apartament cu ${summarySpecs}, compartimentat ${summaryComp.toLowerCase()}${summaryEtaj ? `, situat ${summaryEtaj}` : ""}${summaryAn ? ` ${summaryAn}` : ""}, în stare bună. Locuința dispune de o baie și balcon, fiind poziționată în zona ${zona || oras}, cu acces facil la mijloace de transport și facilități urbane.`.trim();
      if (summaryText.length > 512) {
        summaryText = summaryText.substring(0, 508).replace(/\s+[^\s]*$/, "") + "...";
      }

      const presentationSections = {
        introducere: {
          summary: summaryText
        },
        configuratie: {
          "Suprafață utilă": suprafataUtila || "-",
          "Compartimentare": compartimentare || "Decomandat",
          "Etaj": etaj || "-",
          "An construcție": anConstructie || "-",
          "Număr camere": camere ? String(camere) : "-",
          "Număr băi": "1",
          "Balcoane": balcoaneFinal,
          "Stare": "Buna"
        },
        finisaje: {
          "Living": "vopsea lavabilă, parchet",
          "Camera 1": "vopsea lavabilă, parchet",
          "Camera 2": "vopsea lavabilă, parchet",
          "Camera 3": "vopsea lavabilă, parchet",
          "Camera 4": "vopsea lavabilă, parchet",
          "Bucătărie": "vopsea lavabilă, faianță și gresie",
          "Baie 1": "faianță și gresie",
          "Baie 2": "faianță și gresie",
          "Baie 3": "faianță și gresie",
          "Baie 4": "faianță și gresie",
          "Hol": "vopsea lavabilă, parchet"
        },
        mobilare: {
          "Living": "canapea, măsuță cafea, comodă",
          "Camera 1": "pat, noptiere, dulap",
          "Camera 2": "pat, noptiere, dulap",
          "Camera 3": "pat, noptiere, dulap",
          "Camera 4": "pat, noptiere, dulap",
          "Bucătărie": "mobilă de bucatarie premium",
          "Baie 1": "obiecte sanitare premium",
          "Baie 2": "obiecte sanitare premium",
          "Baie 3": "obiecte sanitare premium",
          "Baie 4": "obiecte sanitare premium",
          "Hol": "cuier, pantofar"
        },
        dotari: {
          "Living": "aer condiționat, smart TV",
          "Camera 1": "-",
          "Camera 2": "-",
          "Camera 3": "-",
          "Camera 4": "-",
          "Bucătărie": "frigider, plită, cuptor, hotă",
          "Baie 1": "-",
          "Baie 2": "-",
          "Hol": "interfon",
          "Altele": "-"
        },
        bloc: {
          "Acces": "Tag magnetic, interfon",
          "Spații": "-",
          "Dotări": "Lift, supraveghere video",
          "Servicii": "Administrație, curățenie spații comune"
        },
        imprejurimi: {
          "Educație": "Grădinițe de stat și private, școli gimnaziale, licee în apropiere",
          "Comerț": "Numeroase magazine de proximitate.",
          "Benzinării": "Multiple statii de alimentare.",
          "Sănătate": "Diverse farmacii.",
          "Relaxare": "Spatii verzi in apropiere.",
          "Divertisment": "Restaurante, baruri si cafenele in zona.",
          "Obiective": "Diverse puncte de atracie din sector."
        },
        transport: {
          "Metrou": "Stație de metrou în proximitate",
          "Tramvai": "Linii tramvai în zonă",
          "Troleibuz": "Linii troleibuz în apropiere",
          "Autobuz": "Multiple linii STB în apropiere"
        },
        parcare: {
          "Parcare": "Publica in zona"
        },
        acte: transactionType === "Închiriere" ? {
          "Condiții contractuale": "12 luni",
          "Avans": "1 luna",
          "Garanție": "1 luna"
        } : {
          "Situație juridică": "Fara probleme",
          "Disponibilitate": "Imediată",
          "Finanțare": "Credit bancar / fonduri proprii"
        },
        tranzactie: {
          "Preț": formattedPrice,
          "TVA": "Scutit de TVA / conform legislației în vigoare",
          "Comision": defaultCommission
        }
      };

      res.json({
        title: cleanTitle,
        price: formattedPrice,
        zone: zona,
        oras: oras,
        ownerName: sellerName,
        ownerPhone: sellerPhone,
        transactionType: transactionType,
        categoria: categoria,
        description: rawDescription,
        specs: {
          utila: suprafataUtila || numUtila,
          construita: suprafataConstruita,
          camere: camere,
          etaj: etaj,
          an: anConstructie,
          compartimentare: compartimentare,
          sistemIncalzire: sistemIncalzire,
          mobilat: mobilat
        },
        images: uniqueImages,
        coverImage: uniqueImages.length > 0 ? uniqueImages[0] : null,
        crmData: crmData,
        presentationSections: presentationSections,
        text: text.substring(0, 8000)
      });
      return; // Success!
    } catch (error: any) {
      console.error(`Attempt ${i+1} failed:`, error.message);
      lastError = error;
    }
  }

  res.status(500).json({ 
    error: `Failed to fetch URL after retries: ${lastError?.message || "Unknown error"}`,
    details: lastError?.response?.data && typeof lastError.response.data === 'string' ? lastError.response.data.substring(0, 500) : null
  });
});

  // Basic crawl for initial lead entry
  app.post("/api/crawl-basic", async (req, res, next) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "URL is required" });

    const userAgents = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36"
    ];

    let lastError: any = null;
    for (let i = 0; i < 3; i++) {
      try {
        const response = await axios.get(url, {
          headers: { 
            "User-Agent": userAgents[i % userAgents.length],
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "Accept-Language": "ro-RO,ro;q=0.9,en-US;q=0.8,en;q=0.7",
            "Connection": "keep-alive"
          },
          timeout: 10000,
          validateStatus: (status) => status < 600
        });

        if (response.status === 403 || response.status === 503) {
          lastError = new Error(`Site returned ${response.status}`);
          await new Promise(r => setTimeout(r, 1000 * (i + 1)));
          continue;
        }

        if (response.status >= 400) {
           throw new Error(`HTTP Error ${response.status}`);
        }

        const html = response.data;
        const $ = cheerio.load(html);
        const title = $("title").text() || "";
        const text = convert(html, {
          wordwrap: 130,
          selectors: [
            { selector: "a", options: { ignoreHref: true } },
            { selector: "img", format: "skip" },
            { selector: "nav", format: "skip" },
            { selector: "footer", format: "skip" },
            { selector: "script", format: "skip" },
            { selector: "style", format: "skip" },
          ],
        });

        res.json({ title, text: text.substring(0, 10000) });
        return;
      } catch (error: any) {
        lastError = error;
      }
    }

    res.status(500).json({ error: `Basic crawl failed: ${lastError?.message}` });
  });
 
  // API Route to proxy images for Gemini (bypasses CORS) and cleans watermarks
  app.get("/api/proxy-image", async (req, res) => {
    const { url } = req.query;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "Missing URL parameter" });
    }

    let cleanUrl = url.trim();
    if (cleanUrl.startsWith("https://") && cleanUrl.includes(":443/")) {
      cleanUrl = cleanUrl.replace(":443/", "/");
    }

    // Serve from cache if available (super fast!)
    if (imageCleanCache.has(cleanUrl)) {
      console.log(`[Proxy Image] Serving from cache: ${cleanUrl.substring(0, 100)}...`);
      const cached = imageCleanCache.get(cleanUrl)!;
      if (req.query.json === "true") {
        const base64 = cached.data.toString("base64");
        return res.json({ base64, contentType: cached.mimeType });
      } else {
        res.setHeader("Content-Type", cached.mimeType);
        res.setHeader("Cache-Control", "public, max-age=3600");
        return res.send(cached.data);
      }
    }

    const userAgents = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36"
    ];

    let lastError: any = null;
    for (let i = 0; i < 3; i++) {
      try {
        // Pre-check for social media blocks
        const lowerUrl = cleanUrl.toLowerCase();
        const socialMediaBlocked = ["facebook.com", "linkedin.com", "twitter.com", "instagram.com", "youtube.com"];
        if (socialMediaBlocked.some(s => lowerUrl.includes(s))) {
          return res.status(400).json({ error: "Social media links are not images" });
        }

        const blocklist = [
          "splash", "manifest", "android-icon", "apple-icon", 
          "apple-touch-icon", "favicon", "site-logo", "loading", 
          "loader", "default-image", "placeholder"
        ];
        if (blocklist.some(b => lowerUrl.includes(b))) {
          return res.status(400).json({ error: "Skipped application assets / placeholders" });
        }

        console.log(`Proxying image (attempt ${i+1}): ${cleanUrl}`);
        
        let referer = "https://www.google.com/";
        try {
          const urlObj = new URL(cleanUrl);
          referer = `${urlObj.protocol}//${urlObj.hostname}/`;
        } catch (e) {
          // Fallback
        }

        const response = await axios.get(cleanUrl, {
          responseType: "arraybuffer",
          headers: {
            "User-Agent": userAgents[i % userAgents.length],
            "Accept": "image/jpeg,image/png,image/*;q=0.8",
            "Referer": referer,
            "Accept-Language": "ro-RO,ro;q=0.9,en-US;q=0.8,en;q=0.7",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "Connection": "keep-alive",
            "Sec-Ch-Ua": '"Chromium";v="110", "Not A(Brand";v="24", "Google Chrome";v="110"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
            "Sec-Fetch-Dest": "image",
            "Sec-Fetch-Mode": "no-cors",
            "Sec-Fetch-Site": "cross-site"
          },
          timeout: 15000,
          validateStatus: (status) => status < 600
        });

        if (response.status === 403 || response.status === 503) {
          console.log(`Proxy site returned ${response.status}, retrying...`);
          lastError = new Error(`Site returned ${response.status}`);
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }

        if (response.status >= 400) {
           throw new Error(`HTTP Error ${response.status}`);
        }

        const rawContentType = response.headers["content-type"];
        const contentType = Array.isArray(rawContentType) 
          ? rawContentType[0] 
          : (typeof rawContentType === "string" ? rawContentType : "image/jpeg");
        
        console.log(`Proxy response content-type: ${contentType}`);

        // Filter out non-images (like HTML being returned from a social page redirect)
        if (!contentType.startsWith("image/")) {
           lastError = new Error(`URL returned ${contentType}, which is not an image type.`);
           continue; 
        }

        // Filter out SVGs as Gemini doesn't support them
        if (contentType.includes("svg")) {
          return res.status(400).json({ error: "Gemini does not support SVG images" });
        }

        let finalData = response.data;
        let finalContentType = contentType;
        // Inpaint portal watermarks using classical Alexandru Telea Fast Marching algorithm (non-AI, zero API cost)
        if (req.query.noclean !== "true") {
          finalData = await cleanImageWatermarks(response.data, contentType, cleanUrl);
          if (finalData !== response.data) {
            finalContentType = contentType === "image/png" ? "image/png" : "image/jpeg";
          }
          addToImageCache(cleanUrl, { mimeType: finalContentType, data: finalData });
        }

        const base64 = finalData.toString("base64");
        // Check if client wants raw binary or json
        if (req.query.json === "true") {
          res.json({ base64, contentType: finalContentType });
        } else {
          res.setHeader("Content-Type", finalContentType);
          res.setHeader("Cache-Control", "public, max-age=3600");
          res.send(finalData);
        }
        return;
      } catch (error: any) {
        lastError = error;
      }
    }

    res.status(500).json({ error: `Failed to fetch image after retries: ${lastError?.message}` });
  });

  // Prevent API fall-through to Vite/static fallback
  app.all("/api/*", (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` });
  });

  // Global error handler
  app.use((err: any, req: any, res: any, next: any) => {
    console.error("Global crash handler:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // Setup WebSocket connections for AI phone call module
  setupWebSocket(server);

  // Initialize offline / background Web Push notification listener for upcoming viewings
  setupBackgroundNotifications();
}

startServer();
