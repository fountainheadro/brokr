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
import { defaultFormats, defaultPlugins } from "jimp";
import { createJimp } from "@jimp/core";
import webp from "@jimp/wasm-webp";
import { generateStandardAdTitle } from "./src/utils/propertyTitleGenerator";

// Intercept global fetch so we can load @jsquash/webp WASM files locally instead of triggering sandbox fetch errors
const originalFetch = global.fetch;
global.fetch = async function(input: any, init: any) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input && input.url ? input.url : "");
  if (url && (url.endsWith(".wasm") || url.includes(".wasm"))) {
    const fileName = path.basename(url.split("?")[0]);
    let wasmPath = "";
    if (fileName.includes("dec")) {
      wasmPath = path.resolve("./node_modules/@jsquash/webp/codec/dec", fileName);
    } else if (fileName.includes("enc")) {
      wasmPath = path.resolve("./node_modules/@jsquash/webp/codec/enc", fileName);
    }
    
    if (wasmPath && fs.existsSync(wasmPath)) {
      const buffer = fs.readFileSync(wasmPath);
      return new Response(buffer, {
        headers: { "Content-Type": "application/wasm" }
      });
    }
  }
  return originalFetch(input, init);
} as any;

const Jimp = createJimp({
  formats: [...defaultFormats, webp],
  plugins: defaultPlugins
});

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
  
  // Circuit breaker: if quota/credits exhausted recently, serve original image directly
  if (Date.now() < watermarkDisabledUntil) {
    return buffer;
  }

  if (!process.env.GEMINI_API_KEY) {
    return buffer;
  }

  try {
    console.log(`[Watermark Remover] Reading image: ${imageUrl.substring(0, 100)}...`);
    const image = await Jimp.read(buffer);
    const { width, height } = image;
    
    // Skip tiny images
    if (width < 300 || height < 300) {
      return buffer;
    }
    
    console.log(`[Watermark Remover] Image dimensions: ${width}x${height}. Detecting watermarks with Gemini...`);
    
    const base64 = buffer.toString("base64");
    const prompt = "Detect all prominent watermarks, text overlays (like owner or agent phone/email/names, e.g. 'George Leotescu', 'Storia', agency logos), stamp overlays, banner labels, or company logos overlayed on this photo. For each item found, provide its exact ymin, xmin, ymax, xmax coordinates normalized from 0 to 1000.";
    
    const genResponse = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite",
      contents: [
        {
          inlineData: {
            data: base64,
            mimeType: mimeType
          }
        },
        prompt
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            watermarks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  ymin: { type: Type.INTEGER, description: "Normalized ymin from 0 to 1000" },
                  xmin: { type: Type.INTEGER, description: "Normalized xmin from 0 to 1000" },
                  ymax: { type: Type.INTEGER, description: "Normalized ymax from 0 to 1000" },
                  xmax: { type: Type.INTEGER, description: "Normalized xmax from 0 to 1000" },
                  label: { type: Type.STRING, description: "Text or type of overlay found" }
                },
                required: ["ymin", "xmin", "ymax", "xmax"]
              }
            }
          },
          required: ["watermarks"]
        }
      }
    });
    
    const resText = genResponse.text;
    if (!resText) {
      console.log(`[Watermark Remover] No response from Gemini watermark detector`);
      return buffer;
    }
    
    const parsed = JSON.parse(resText);
    const watermarks = parsed?.watermarks || [];
    console.log(`[Watermark Remover] Gemini detected ${watermarks.length} watermarks:`, JSON.stringify(watermarks));
    
    if (watermarks.length === 0) {
      console.log(`[Watermark Remover] Image is already clean.`);
      return buffer;
    }
    
    for (const box of watermarks) {
      let { ymin, xmin, ymax, xmax } = box;
      if (ymin > ymax) [ymin, ymax] = [ymax, ymin];
      if (xmin > xmax) [xmin, xmax] = [xmax, xmin];
      
      ymin = Math.max(0, Math.min(1000, ymin));
      xmin = Math.max(0, Math.min(1000, xmin));
      ymax = Math.max(0, Math.min(1000, ymax));
      xmax = Math.max(0, Math.min(1000, xmax));
      
      const startY = Math.floor((ymin / 1000) * height);
      const startX = Math.floor((xmin / 1000) * width);
      const boxHeight = Math.ceil(((ymax - ymin) / 1000) * height);
      const boxWidth = Math.ceil(((xmax - xmin) / 1000) * width);
      
      if (boxWidth > 5 && boxHeight > 5 && startX + boxWidth <= width && startY + boxHeight <= height) {
        console.log(`[Watermark Remover] Reconstructing region using inpainting: x=${startX}, y=${startY}, w=${boxWidth}, h=${boxHeight}`);
        
        // Setup border pixel cache for extremely fast lookups
        const borderLeft: number[] = [];
        const borderRight: number[] = [];
        const borderTop: number[] = [];
        const borderBottom: number[] = [];

        // Pre-fetch left border safely (at startX - 2 or clamped)
        const leftX = Math.max(0, startX - 2);
        for (let y = 0; y < boxHeight; y++) {
          borderLeft.push(image.getPixelColor(leftX, startY + y));
        }

        // Pre-fetch right border safely (at startX + boxWidth + 1 or clamped)
        const rightX = Math.min(width - 1, startX + boxWidth + 1);
        for (let y = 0; y < boxHeight; y++) {
          borderRight.push(image.getPixelColor(rightX, startY + y));
        }

        // Pre-fetch top border safely (at startY - 2 or clamped)
        const topY = Math.max(0, startY - 2);
        for (let x = 0; x < boxWidth; x++) {
          borderTop.push(image.getPixelColor(startX + x, topY));
        }

        // Pre-fetch bottom border safely (at startY + boxHeight + 1 or clamped)
        const bottomY = Math.min(height - 1, startY + boxHeight + 1);
        for (let x = 0; x < boxWidth; x++) {
          borderBottom.push(image.getPixelColor(startX + x, bottomY));
        }

        const getRGBA = (color: number) => {
          return {
            r: (color >> 24) & 0xFF,
            g: (color >> 16) & 0xFF,
            b: (color >> 8) & 0xFF,
            a: color & 0xFF
          };
        };

        // Fill the region using Inverse Distance Weighting (IDW)
        for (let y = 0; y < boxHeight; y++) {
          const globalY = startY + y;
          for (let x = 0; x < boxWidth; x++) {
            const globalX = startX + x;

            const dxLeft = x + 1;
            const dxRight = boxWidth - x;
            const dyTop = y + 1;
            const dyBottom = boxHeight - y;

            const wLeft = 1 / (dxLeft * dxLeft);
            const wRight = 1 / (dxRight * dxRight);
            const wTop = 1 / (dyTop * dyTop);
            const wBottom = 1 / (dyBottom * dyBottom);

            const sumW = wLeft + wRight + wTop + wBottom;

            if (sumW > 0) {
              const cLeft = getRGBA(borderLeft[y]);
              const cRight = getRGBA(borderRight[y]);
              const cTop = getRGBA(borderTop[x]);
              const cBottom = getRGBA(borderBottom[x]);

              let r = (cLeft.r * wLeft + cRight.r * wRight + cTop.r * wTop + cBottom.r * wBottom) / sumW;
              let g = (cLeft.g * wLeft + cRight.g * wRight + cTop.g * wTop + cBottom.g * wBottom) / sumW;
              let b = (cLeft.b * wLeft + cRight.b * wRight + cTop.b * wTop + cBottom.b * wBottom) / sumW;
              let a = (cLeft.a * wLeft + cRight.a * wRight + cTop.a * wTop + cBottom.a * wBottom) / sumW;

              // Add a very subtle amount of camera sensor noise (±1.5 range) to preserve image texture naturally
              const noiseRange = 1.5;
              const noise = (Math.random() - 0.5) * noiseRange;
              r = Math.max(0, Math.min(255, r + noise));
              g = Math.max(0, Math.min(255, g + noise));
              b = Math.max(0, Math.min(255, b + noise));

              // Convert back to 32-bit unsigned RGBA color integer
              const newColor = (((Math.round(r) & 0xFF) << 24) |
                                ((Math.round(g) & 0xFF) << 16) |
                                ((Math.round(b) & 0xFF) << 8) |
                                (Math.round(a) & 0xFF)) >>> 0;

              image.setPixelColor(newColor, globalX, globalY);
            }
          }
        }
      }
    }
    
    const cleanedBuffer = await image.getBuffer(mimeType as any);
    console.log(`[Watermark Remover] Cleaned! Original size: ${buffer.length}, Cleaned size: ${cleanedBuffer.length}`);
    return cleanedBuffer;
  } catch (err: any) {
    const rawError = typeof err?.message === "string" ? err.message : JSON.stringify(err || "");
    const isQuotaOrCredit = 
      rawError.includes("402") || 
      rawError.includes("RESOURCE_EXHAUSTED") || 
      rawError.includes("prepayment credits") || 
      rawError.includes("429") || 
      rawError.includes("Quota exceeded");

    if (isQuotaOrCredit) {
      // Pause watermark detection calls for 20 minutes to avoid repeated failed requests
      watermarkDisabledUntil = Date.now() + 20 * 60 * 1000;
      console.warn(`[Watermark Remover] Prepayment/quota limit reached. Temporarily serving original images directly.`);
    } else {
      console.warn(`[Watermark Remover] Could not clean watermark for image (serving original): ${rawError.substring(0, 120)}`);
    }
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

  // Initialize Vite dev server instance early if in development mode so it is accessible to SSR routes
  let vite: any = null;
  if (process.env.NODE_ENV !== "production") {
    vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
  }

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
    const generateLocalTemplateText = (body: any) => {
      const { category, transactionType, zone, price, specs, propertyId } = body;
      const cat = category || "Apartament";
      const z = zone || "București";
      const p = price || "N/A";
      const idStr = propertyId ? propertyId.trim() : "";
      const camere = specs?.detalii?.camere || "2";

      const title = `${cat} ${camere} camere | ${z} | Mutare imediată`;
      const transLabel = transactionType === "Închiriere" ? "ÎNCHIRIERE" : "VÂNZARE";

      const description = `📌 ID ${idStr}
🏡 ${title}

Proprietate spațioasă și luminoasă, situată în zona ${z}, oferind acces facil către toate punctele de interes din oraș.
Spațiul este ideal atât pentru locuință, cât și pentru investiție.

━━━━━━━━━━━━━━━━━━

⭐ AVANTAJE PRINCIPALE

-${specs?.detalii?.compartimentare || "decomandat"}
-amplasare excelentă în zonă liniștită
-lumină naturală generoasă pe parcursul întregii zile
-acces rapid la mijloacele de transport în comun

━━━━━━━━━━━━━━━━━━

🛋️ DOTĂRI

-centrală proprie
-finisaje moderne și calitate superioară
-spații bine organizate pentru depozitare

━━━━━━━━━━━━━━━━━━

📍 LOCAȚIE

Acces rapid către:
-mijloace de transport în comun
-magazine, supermarketuri și centre comerciale
-zone verzi și parcuri în apropiere

━━━━━━━━━━━━━━━━━━

💰 ${transLabel}

${p}${transactionType === "Închiriere" ? " / lună\n1 lună garanție\nComision 50% + TVA" : ""}
Disponibil imediat

━━━━━━━━━━━━━━━━━━

🤝 SUPORT ${transLabel}

-consultanță dedicată din partea agenției brokr
-asistență completă în întocmirea contractului și înregistrarea ANAF
-posibilitate de vizionare rapidă și flexibilă

📞 Pentru vizionare sau detalii suplimentare, contactează-ne telefonic.`;

      return { title, description };
    };

    try {
      const { category, transactionType, zone, price, specs, originalTitle, originalDescription, propertyId } = req.body;
      if (!process.env.GEMINI_API_KEY) {
        return res.json(generateLocalTemplateText(req.body));
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
      const errStr = e?.message || String(e || "");
      if (!errStr.includes("402") && !errStr.includes("RESOURCE_EXHAUSTED") && !errStr.includes("prepayment credits")) {
        console.warn("[Server] /api/generate-ai-text failed (using local template fallback):", errStr);
      }
      const fallback = generateLocalTemplateText(req.body);
      res.json(fallback);
    }
  });

  // Helper function to fetch property data from Firestore
  async function fetchPropertyById(id: string): Promise<any> {
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (!fs.existsSync(configPath)) {
      return null;
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

    if (!docData) return null;

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
    return result;
  }

  // Public property endpoint for shared property links
  app.get("/api/public-property/:id", async (req, res) => {
    try {
      const { id } = req.params;
      if (!id) return res.status(400).json({ error: "Property ID required" });

      const property = await fetchPropertyById(id);
      if (!property) {
        return res.status(404).json({ error: "Property not found" });
      }
      res.json(property);
    } catch (e: any) {
      if (e.response && e.response.status === 404) {
        return res.status(404).json({ error: "Property not found" });
      }
      console.error("[Server] /api/public-property/:id error:", e.message || e);
      res.status(500).json({ error: "Failed to fetch public property" });
    }
  });

  // Helper to resolve the correct index.html file:
  // In production (or when dist/index.html is built), we MUST serve dist/index.html with bundled hashed assets.
  // Serving raw unbundled src/main.tsx in production crashes the browser with a fatal module MIME error.
  function getEffectiveIndexPath(): { path: string; isDist: boolean } {
    const distIndexPath = path.join(process.cwd(), 'dist', 'index.html');
    const rootIndexPath = path.join(process.cwd(), 'index.html');

    if (process.env.NODE_ENV === "production" && fs.existsSync(distIndexPath)) {
      return { path: distIndexPath, isDist: true };
    }
    if (fs.existsSync(distIndexPath) && !vite) {
      return { path: distIndexPath, isDist: true };
    }
    if (fs.existsSync(rootIndexPath)) {
      return { path: rootIndexPath, isDist: false };
    }
    if (fs.existsSync(distIndexPath)) {
      return { path: distIndexPath, isDist: true };
    }
    return { path: rootIndexPath, isDist: false };
  }

  // OpenGraph SSR route for rich link previews on WhatsApp and social media
  app.get(["/share/:id", "/p/:id"], async (req, res) => {
    try {
      const { id } = req.params;
      const indexInfo = getEffectiveIndexPath();

      if (!id) {
        if (!fs.existsSync(indexInfo.path)) {
          return res.status(404).send("Not found");
        }
        return res.sendFile(indexInfo.path);
      }

      const property = await fetchPropertyById(id);

      const title = property?.extractedData?.crmData?.descriere?.titlu || property?.title || "Proprietate Imobiliară • brokr.";
      let description = property?.extractedData?.crmData?.descriere?.continut || property?.description || "Proprietate imobiliară prezentată de brokr.";
      description = description.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
      if (description.length > 200) {
        description = description.substring(0, 197) + "...";
      }

      let imageUrl = property?.coverImage || "";
      if (!imageUrl && property?.extractedData?.crmData?.imagini) {
        const crmImagini = property.extractedData.crmData.imagini;
        const categories = ["living", "camera", "bucatarie", "baie", "alteSpatii"] as const;
        for (const cat of categories) {
          const list = crmImagini[cat];
          if (Array.isArray(list) && list.length > 0) {
            const first = list[0];
            imageUrl = typeof first === "string" ? first : (first?.original || "");
            if (imageUrl) break;
          }
        }
      }
      if (!imageUrl) {
        imageUrl = `${req.protocol}://${req.get('host')}/public/og-default.jpg`;
      }

      const shareUrl = `${req.protocol}://${req.get('host')}${req.path}`;

      if (!fs.existsSync(indexInfo.path)) {
        return res.status(404).send("Not found");
      }

      let html = fs.readFileSync(indexInfo.path, 'utf8');

      // In dev mode with Vite server, pass through vite.transformIndexHtml
      if (!indexInfo.isDist && vite) {
        try {
          html = await vite.transformIndexHtml(req.originalUrl, html);
        } catch (viteErr: any) {
          console.warn("[Server] vite.transformIndexHtml error:", viteErr.message);
        }
      }

      const esc = (s: string) => String(s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

      const ogTags = `
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${esc(shareUrl)}" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:image" content="${esc(imageUrl)}" />
    <meta property="og:image:secure_url" content="${esc(imageUrl)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:site_name" content="brokr." />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(title)}" />
    <meta name="twitter:description" content="${esc(description)}" />
    <meta name="twitter:image" content="${esc(imageUrl)}" />
      `.trim();

      html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(title)}</title>`);
      html = html.replace(/<meta\s+name=["']description["'][^>]*>/gi, `<meta name="description" content="${esc(description)}" />`);
      html = html.replace(/<meta\s+property=["']og:title["'][^>]*>/gi, '');
      html = html.replace(/<meta\s+property=["']og:description["'][^>]*>/gi, '');
      html = html.replace(/<meta\s+property=["']og:image["'][^>]*>/gi, '');
      html = html.replace(/<meta\s+property=["']og:url["'][^>]*>/gi, '');
      html = html.replace(/<meta\s+name=["']twitter:card["'][^>]*>/gi, '');
      html = html.replace(/<meta\s+name=["']twitter:title["'][^>]*>/gi, '');
      html = html.replace(/<meta\s+name=["']twitter:description["'][^>]*>/gi, '');
      html = html.replace(/<meta\s+name=["']twitter:image["'][^>]*>/gi, '');

      html = html.replace('</head>', `\n${ogTags}\n</head>`);

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
    } catch (err: any) {
      console.warn("[Server] /share/:id OpenGraph error:", err.message);
      const fallbackInfo = getEffectiveIndexPath();
      if (fs.existsSync(fallbackInfo.path)) {
        return res.sendFile(fallbackInfo.path);
      }
      res.sendFile(path.join(process.cwd(), 'index.html'));
    }
  });

  // Helper to extract price, phone number, and owner name from storia.ro or olx.ro HTML snippets
  function extractListingDetails(html: string, url: string = "") {
    const $ = cheerio.load(html || "");
    
    let source: "storia" | "olx" | null = null;
    if (url.includes("storia.ro") || $('[data-cy*="storia"]').length > 0 || $('[data-sentry-component]').length > 0) {
      source = "storia";
    } else if (url.includes("olx.ro") || $('[data-testid*="ad"]').length > 0 || $('[data-nx-name]').length > 0) {
      source = "olx";
    }

    if (!source) {
      if ($('strong[data-cy="adPageHeaderPrice"], [data-sentry-element="Price"], div[data-sentry-component="MainPriceWrapper"]').length > 0) {
        source = "storia";
      } else if ($('div[data-testid="ad-price-container"], h3[data-nx-name="H3"]').length > 0) {
        source = "olx";
      }
    }

    let rawPrice: string | null = null;
    let rawPhone: string | null = null;
    let rawOwner: string | null = null;

    const normalizeText = (text: string | null | undefined): string | null => {
      if (!text) return null;
      let cleaned = text.replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
      return cleaned || null;
    };

    const cleanPrice = (text: string | null | undefined): string | null => {
      if (!text) return null;
      let cleaned = text.replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
      const lower = cleaned.toLowerCase();
      const hasLuna = /\/(?:lun[aă]|luni|month)\b/i.test(cleaned);

      if (lower.includes("ron") || lower.includes("lei")) {
        const digits = parseFloat(cleaned.replace(/[^0-9.,]/g, "").replace(",", "."));
        if (!isNaN(digits) && digits > 0) {
          const eurVal = Math.round(digits / 5.0);
          cleaned = `${eurVal} €${hasLuna ? " / lună" : ""}`;
        }
      }
      return cleaned || null;
    };

    if (source === "storia") {
      const priceEl = $('strong[data-cy="adPageHeaderPrice"]').first()
        .add('[data-sentry-element="Price"]').first()
        .add('div[data-sentry-component="MainPriceWrapper"] strong').first();
      if (priceEl.length) rawPrice = priceEl.text();

      const phoneEl = $('a[data-cy="phone-number.number-button"]').first()
        .add('div[data-sentry-component="PhoneNumber"] a[href^="tel:"]').first();
      if (phoneEl.length) {
        rawPhone = phoneEl.attr("href")?.replace("tel:", "") || phoneEl.text();
      } else {
        const telHref = $('a[href^="tel:"]').first().attr("href");
        if (telHref) rawPhone = telHref.replace("tel:", "");
      }

      const ownerEl = $('p.truncate.font-bold').first()
        .add('p[class*="truncate"][class*="font-bold"]').first();
      if (ownerEl.length) rawOwner = ownerEl.text();
    } else if (source === "olx") {
      const priceEl = $('div[data-testid="ad-price-container"] h3').first()
        .add('[data-testid="ad-price-container"]').first()
        .add('h3[data-nx-name="H3"]').first();
      if (priceEl.length) rawPrice = priceEl.text();

      const phoneEl = $('a[data-testid="contact-phone"]').first()
        .add('button[data-testid="ad-contact-phone"] a[href^="tel:"]').first()
        .add('button[data-cy="ad-contact-phone"] a').first();
      if (phoneEl.length) {
        rawPhone = phoneEl.attr("href")?.replace("tel:", "") || phoneEl.text();
      } else {
        const telHref = $('a[href^="tel:"]').first().attr("href");
        if (telHref) rawPhone = telHref.replace("tel:", "");
      }

      const ownerEl = $('h4[data-testid="user-profile-user-name"]').first()
        .add('h4[data-nx-name="H4"]').first();
      if (ownerEl.length) rawOwner = ownerEl.text();
    }

    if (!rawPrice) {
      const fallbackPrice = $('strong[data-cy="adPageHeaderPrice"], div[data-testid="ad-price-container"] h3, [data-sentry-element="Price"]').first();
      if (fallbackPrice.length) rawPrice = fallbackPrice.text();
    }
    if (!rawPhone) {
      const fallbackPhone = $('a[data-cy="phone-number.number-button"], a[data-testid="contact-phone"], a[href^="tel:"]').first();
      if (fallbackPhone.length) {
        rawPhone = fallbackPhone.attr("href")?.replace("tel:", "") || fallbackPhone.text();
      }
    }
    if (!rawOwner) {
      const fallbackOwner = $('p.truncate.font-bold, h4[data-testid="user-profile-user-name"]').first();
      if (fallbackOwner.length) rawOwner = fallbackOwner.text();
    }

    return {
      source: source || null,
      price: cleanPrice(rawPrice),
      phone_number: normalizeText(rawPhone),
      owner_name: normalizeText(rawOwner)
    };
  }

  app.post("/api/parse-listing-html", (req, res) => {
    try {
      const { html, url } = req.body;
      const result = extractListingDetails(html || "", url || "");
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ source: null, price: null, phone_number: null, owner_name: null });
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
          "document", "pdf", ".gif", "recommend", "similar", "related",
          "header", "footer", "navbar", "ad-banner"
        ];
        return badPatterns.some(p => lower.includes(p));
      };

      // Helper to promote known thumbnail image URLs to full/maximum resolution
      const promoteToHighRes = (rawUrl: string): string => {
        let cleaned = rawUrl.trim().replace(/\\/g, "");
        if (cleaned.startsWith("//")) cleaned = "https:" + cleaned;

        // Imobiliare.ro & Roamcdn high-resolution promotions
        if (cleaned.includes("imobiliare.ro") || cleaned.includes("roamcdn")) {
          cleaned = cleaned
            .replace(/_(?:75x75|100x100|150x150|160x120|200x150|400x300|640x480)\.jpg/gi, "_800x600.jpg")
            .replace(/\/thumb\//gi, "/large/")
            .replace(/\/small\//gi, "/large/")
            .replace(/\/medium\//gi, "/large/");
          if (cleaned.toLowerCase().includes("roamcdn")) {
            cleaned = cleaned.replace(/gallery-[a-zA-Z0-9]+-watermark/gi, "gallery-full-1200w-watermark");
          }
        }

        // Publi24 promotions
        if (cleaned.includes("publi24") || cleaned.includes("pstatic") || cleaned.includes("pcdnh")) {
          cleaned = cleaned
            .replace(/\/small\//gi, "/large/")
            .replace(/\/medium\//gi, "/large/")
            .replace(/\/thumb\//gi, "/large/");
        }

        // Storia / OLX Apollo / Akamaized promotions: enforce maximum 1000x700
        if (cleaned.includes(";s=")) {
          cleaned = cleaned.replace(/;s=\d+x\d+/, ";s=1000x700");
        } else if (
          (cleaned.includes("akamaized.net") || cleaned.includes("apollo") || cleaned.includes("storia.ro") || cleaned.includes("olxcdn")) &&
          (cleaned.includes("/files/") || cleaned.includes("/image") || cleaned.includes("/photos/"))
        ) {
          cleaned = cleaned + (cleaned.includes('?') ? '&' : ';') + "s=1000x700";
        }

        // General small/medium/thumb to large
        cleaned = cleaned.replace(/\/(?:small|thumb|mini)\//gi, "/large/");

        return cleaned;
      };

      // Priority 0: Dedicated Storia mosaic gallery view ([data-cy="mosaic-gallery-main-view"])
      let mosaicGalleryImages: string[] = [];
      const mosaicSelectors = [
        '[data-cy="mosaic-gallery-main-view"]',
        '[data-cy*="mosaic-gallery"]',
        '[data-sentry-component="BaseMainView"]',
        '[data-sentry-source-file*="MainView"]',
        '[data-cy*="gallery-main-view"]'
      ];
      const $mosaic = $(mosaicSelectors.join(", "));
      if ($mosaic.length > 0) {
        $mosaic.find("img, source, a, button, div, picture").each((_, el) => {
          const $el = $(el);
          const src = $el.attr("src");
          const dataSrc = $el.attr("data-src") || $el.attr("data-lazy") || $el.attr("data-full");
          const srcset = $el.attr("srcset") || $el.attr("data-srcset");
          const style = $el.attr("style");
          let candidates = [src, dataSrc];
          if (srcset) {
            candidates.push(...srcset.split(",").map(s => s.trim().split(" ")[0]));
          }
          if (style && style.includes("url(")) {
            const m = style.match(/url\(['"]?([^'"]+)['"]?\)/);
            if (m) candidates.push(m[1]);
          }
          candidates.forEach(raw => {
            if (!raw || typeof raw !== "string") return;
            let absUrl = raw.trim().replace(/\\/g, "");
            if (absUrl.startsWith("//")) absUrl = "https:" + absUrl;
            if (!absUrl.startsWith("http")) return;
            const promoted = promoteToHighRes(absUrl);
            if (!isForbiddenGraphic(promoted)) {
              mosaicGalleryImages.push(promoted);
            }
          });
        });
      }

      // Priority 1: Check __NEXT_DATA__ for the target property's dedicated photo gallery
      let nextDataTargetImages: string[] = [];
      const nextDataScripts = $("script#__NEXT_DATA__, script:contains('__NEXT_DATA__')");
      if (nextDataScripts.length > 0) {
        try {
          const content = nextDataScripts.first().html() || "";
          if (content) {
            const data = JSON.parse(content);
            const targetAd = data?.props?.pageProps?.ad || data?.props?.pageProps?.advert || data?.props?.pageProps?.offer || data?.props?.pageProps?.listing || data?.props?.pageProps?.data;
            const photoList = targetAd?.photos || targetAd?.images || targetAd?.listingImages || targetAd?.gallery || targetAd?.media?.photos || targetAd?.media?.images || data?.props?.pageProps?.gallery;
            if (Array.isArray(photoList) && photoList.length > 0) {
              photoList.forEach((item: any) => {
                let candidate = item?.large || item?.medium || item?.url || item?.thumbnail || item?.small || item?.src || (typeof item === 'string' ? item : null);
                if (!candidate && item?.filename) {
                  candidate = `https://apollo.olxcdn.com/v1/files/${item.filename}/image;s=1000x700`;
                }
                if (!candidate && item?.id && typeof item?.id === 'string' && item.id.length > 5) {
                  candidate = `https://apollo.olxcdn.com/v1/files/${item.id}/image;s=1000x700`;
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

      // Collect JSON-LD metadata images
      let jsonLdImages: string[] = [];
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

      // Priority 3: DOM Gallery elements (with aggressive stripping of recommendations, ads, and similar listings)
      let domGalleryImages: string[] = [];
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
        "#galerie, .galerie, [data-testid=\"gallery\"], [data-testid*=\"gallery\"], [data-testid*=\"photo\"], .gallery-slider, " +
        ".image-gallery, .swiper-wrapper, .swiper-container, .property-gallery, .offer-photos, #slider-pro, .slider-for, " +
        ".ad-gallery, [data-cy=\"ad-photos\"], [data-cy*=\"photo\"], .main-slider, #fotoGal, .foto-galerie, #photo-gallery, " +
        ".slider-galerie, #anunt-galerie"
      );

      // Search both dedicated gallery containers and general content to ensure no photos are missed
      const searchScope = galleryContainers.length > 0 
        ? galleryContainers.add("article[data-cy='ad-content'], [data-cy='ad-content'], .offer-view, .ad-content, #main-content, main, article")
        : $("article, main, #main-content, .offer-view, [data-cy='ad-content'], body");

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
          
          const promoted = promoteToHighRes(absUrl);
          if (isForbiddenGraphic(promoted)) return;
          if (socialMediaBlocked.some(s => promoted.toLowerCase().includes(s))) return;
          if (adKeywords.some(k => promoted.toLowerCase().includes(k))) return;

          const isKnownImage = imageExtensions.test(promoted) || 
            promoted.includes("/files/") || promoted.includes("/image") || promoted.includes("/photos/") || promoted.includes("roamcdn") || promoted.includes("apollo");

          if (isKnownImage) {
            domGalleryImages.push(promoted);
          }
        });
      });

      // Collect candidates combining all sources (mosaic, nextData, jsonLd, and domGallery)
      const rawCandidates = [
        ...mosaicGalleryImages,
        ...nextDataTargetImages,
        ...jsonLdImages,
        ...domGalleryImages
      ];

      // Deduplicate images and keep highest resolution version
      const deduplicateImages = (urls: string[]) => {
        const map = new Map<string, string>();

        const getCanonical = (u: string) => {
          let base = u.split(/[?;]/)[0];
          // 1. OLX / Storia file ID or JWT token
          const olxMatch = base.match(/\/v1\/files\/([^/]+)/i);
          if (olxMatch) {
            const token = olxMatch[1];
            if (token.includes(".")) {
              const parts = token.split(".");
              try {
                const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
                if (payload.fn) return `olx-${payload.fn}`;
              } catch (e) {}
              return `olx-${parts[1]}`;
            }
            return `olx-${token.toLowerCase()}`;
          }

          // Use filename and immediate parent directory as canonical key so different photos have unique keys
          const segments = base.split("/").filter(Boolean);
          const filename = segments.pop() || base;
          const parentFolder = segments.pop() || "";

          // 2. Filename cleaning (strip dimensions and responsive suffixes)
          const cleanFilename = filename
            .replace(/_\d+x\d+(?=\.[a-z]+)/i, "")
            .replace(/-(?:full|small|medium|thumb|large|mini|1200w|1600w|800w|400w|600w|300w)/gi, "");
          return `${parentFolder}-${cleanFilename}`.toLowerCase();
        };

        const getScore = (u: string) => {
          const lower = u.toLowerCase();
          let score = 0;
          if (lower.includes("1200w") || lower.includes("1600w")) score += 200;
          if (lower.includes("1000x700") || lower.includes("1280x") || lower.includes("900w")) score += 100;
          if (lower.includes("800x600")) score += 50;
          if (lower.includes("/large/") || lower.includes("/galerie/")) score += 40;
          if (lower.includes("/medium/")) score += 20;
          if (lower.includes("/small/") || lower.includes("/thumb/") || lower.includes("140w")) score += 5;
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
      const nextPriceObj = nextAdData?.price || nextAdData?.regularPrice || nextAdData?.ad?.price || nextAdData?.advert?.price;
      if (nextPriceObj) {
        if (typeof nextPriceObj === 'number') {
          rawPriceNum = nextPriceObj;
        } else if (nextPriceObj.value || nextPriceObj.regularPrice?.value) {
          rawPriceNum = Number(nextPriceObj.value || nextPriceObj.regularPrice?.value);
          const currSym = String(nextPriceObj.currencySymbol || nextPriceObj.regularPrice?.currencySymbol || "").toUpperCase();
          if (currSym.includes("LEI") || currSym.includes("RON")) currency = "RON";
        }
      } else if (jsonLdData?.offers?.price || jsonLdData?.price) {
        rawPriceNum = Number(jsonLdData.offers?.price || jsonLdData.price);
        const curr = String(jsonLdData.offers?.priceCurrency || jsonLdData.priceCurrency || "").toUpperCase();
        if (curr.includes("LEI") || curr.includes("RON")) currency = "RON";
      } else {
        let domPriceText = "";
        const priceSelectors = ['[data-testid="ad-price"]', '[data-cy="ad-price"]', '.price', '.offer-price', '[class*="price"]', '[class*="pret"]'];
        for (const sel of priceSelectors) {
          const found = $(sel).first().text().trim();
          if (found && /\d/.test(found)) {
            domPriceText = found;
            break;
          }
        }

        const searchStr = domPriceText || title + " " + text;
        const priceRegex = /(?:pre[t\u021b]|chirie|\b)\s*[:\-–]?\s*(€|eur|euro|ron|lei)?\s*(\d[\d\s.,]{1,9})\s*(€|eur|euro|ron|lei)?\b/i;
        const pMatch = searchStr.match(priceRegex) || title.match(/(\d[\d\s.,]{1,9})\s*(€|eur|euro|ron|lei)?\b/i);
        if (pMatch) {
          const numStr = pMatch[2] || pMatch[1] || "";
          rawPriceNum = parseInt(numStr.replace(/[^0-9]/g, ""), 10) || 0;
          const currStr = (pMatch[1] || pMatch[3] || searchStr || "").toLowerCase();
          if (currStr.includes("ron") || currStr.includes("lei")) {
            currency = "RON";
          }
        }
      }

      // Transform price to EUR if it was in RON or Lei
      const isRon = currency === "RON" || currency === "LEI";
      const priceInEur = isRon ? Math.round(rawPriceNum / 4.97) : rawPriceNum;
      // Enforce EUR currency and euro price throughout the CRM
      rawPriceNum = priceInEur;
      currency = "€";

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
      console.log(`[Crawler Transaction Detection] Price: ${priceInEur} EUR -> Type: ${transactionType} (URL Rent: ${urlHasRent}, Title Rent: ${titleHasRent})`);

      const formattedPrice = rawPriceNum > 0 
        ? `${rawPriceNum.toLocaleString("ro-RO")} €${transactionType === "Închiriere" ? " / lună" : ""}` 
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

      // Generate compliant property ad title strictly adhering to AGENTS.md rules
      const cleanTitle = generateStandardAdTitle({
        categoria,
        camere,
        suprafataUtila: suprafataUtila || numUtila,
        zona,
        oras,
        compartimentare,
        sistemIncalzire: Array.isArray(sistemIncalzire) ? sistemIncalzire.join(", ") : sistemIncalzire,
        mobilat,
        balcoane: balcoaneFinal,
        rawText: text
      });

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
          continut: `📌 ID 
🏡 ${cleanTitle}

${suprafataUtila ? `${suprafataUtila} mp utili` : "Spațiu generos"}${balcoaneFinal && parseInt(String(balcoaneFinal), 10) > 0 ? ", balcon" : ""}, mobilat și utilat, disponibil imediat.
Proprietate luminoasă și bine compartimentată, situată în zona ${zona || oras}, cu acces facil la toate facilitățile urbane.

━━━━━━━━━━━━━━━━━━

⭐ AVANTAJE PRINCIPALE

-${compartimentare || "decomandat"}
-poziționare excelentă în zonă cu infrastructură completă
-lumină naturală generoasă și compartimentare eficientă
-acces rapid la mijloacele de transport în comun

━━━━━━━━━━━━━━━━━━

🛋️ DOTĂRI

-${Array.isArray(sistemIncalzire) && sistemIncalzire.length > 0 ? sistemIncalzire[0].toLowerCase() : "centrală proprie"}
-finisaje de calitate și spații optime de depozitare
-mobilat și utilat complet

Spațiul este foarte bine organizat și oferă confort ridicat pentru locuire.

━━━━━━━━━━━━━━━━━━

📍 LOCAȚIE

Acces rapid către:
-stații de transport în comun
-magazine, supermarketuri și servicii de proximitate
-parcuri și spații verzi în zonă

━━━━━━━━━━━━━━━━━━

💰 ${transactionType === "Închiriere" ? "ÎNCHIRIERE" : "VÂNZARE"}

${transactionType === "Închiriere" ? `${formattedPrice || "N/A"}\n1 lună garanție\nComision 50% + TVA\nDisponibil imediat` : `${formattedPrice || "N/A"}\nDisponibil imediat`}

━━━━━━━━━━━━━━━━━━

🤝 ${transactionType === "Închiriere" ? "SUPORT ÎNCHIRIERE" : "SUPORT VÂNZARE"}

-consultanță dedicată din partea agenției brokr
-asistență completă în întocmirea contractului și înregistrarea ANAF
-posibilitate de vizionare rapidă și flexibilă

📞 Pentru vizionare sau detalii suplimentare, contactează-ne telefonic.`.trim(),
          disponibilitate: "Imediat",
          video: "",
          turVirtual: ""
        },
        imagini: {
          living: [],
          bucatarie: [],
          camera: [],
          baie: [],
          alteSpatii: uniqueImages.map(img => ({ original: img }))
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

      const listingDetails = extractListingDetails(html, url);
      let finalPrice = (formattedPrice && formattedPrice !== "N/A") ? formattedPrice : (listingDetails.price || "N/A");
      if (finalPrice && finalPrice !== "N/A") {
        const fpLower = finalPrice.toLowerCase();
        if (fpLower.includes("ron") || fpLower.includes("lei")) {
          const digits = parseFloat(finalPrice.replace(/[^0-9.,]/g, "").replace(",", "."));
          if (!isNaN(digits) && digits > 0) {
            const inEur = Math.round(digits / 4.97);
            const hasLuna = /\/(?:lun[aă]|luni|month)\b/i.test(finalPrice) || transactionType === "Închiriere";
            finalPrice = `${inEur.toLocaleString("ro-RO")} €${hasLuna ? " / lună" : ""}`;
          }
        }
      }
      crmData.pret.detalii.pret = finalPrice;
      crmData.pret.detalii.moneda = "€";
      presentationSections.tranzactie["Preț"] = finalPrice;
      const finalPhone = (sellerPhone && sellerPhone !== "Nespecificat") ? sellerPhone : (listingDetails.phone_number || "Nespecificat");
      const finalOwner = (sellerName && sellerName !== "Nespecificat") ? sellerName : (listingDetails.owner_name || "Nespecificat");

      res.json({
        title: cleanTitle,
        price: finalPrice,
        zone: zona,
        oras: oras,
        ownerName: finalOwner,
        ownerPhone: finalPhone,
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
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
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
        // Watermark detection with Gemini is disabled by default to eliminate budget spend on image views.
        // It runs ONLY if explicitly requested via ?clean=true
        if (req.query.clean === "true") {
          finalData = await cleanImageWatermarks(response.data, contentType, cleanUrl);
          addToImageCache(cleanUrl, { mimeType: contentType, data: finalData });
        }

        const base64 = finalData.toString("base64");
        // Check if client wants raw binary or json
        if (req.query.json === "true") {
          res.json({ base64, contentType });
        } else {
          res.setHeader("Content-Type", contentType);
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

  // Vite middleware for development or static serving for production
  if (vite) {
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
