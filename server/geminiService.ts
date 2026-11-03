import { GoogleGenAI, Type } from "@google/genai";
import axios from "axios";
import { PROMPT_INSTRUCTIONS } from "../src/services/promptConfig";

// Ensure Gemini is initialized with server-side environment variable
const ai = new GoogleGenAI({ 
  apiKey: process.env.GEMINI_API_KEY || "",
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build"
    }
  }
});

// Helper to convert images directly from Node backend to Generative Parts
async function fileToGenerativePart(url: string) {
  try {
    const lowerUrl = String(url || "").toLowerCase();
    const socialMediaBlocked = ["facebook.com", "linkedin.com", "twitter.com", "instagram.com", "youtube.com"];
    
    // Filter out social media and SVGs
    if (socialMediaBlocked.some(s => lowerUrl.includes(s)) || lowerUrl.endsWith(".svg") || lowerUrl.includes("svg")) {
      return null;
    }

    // Filter out obvious application assets, manifests and splash screen files
    const blocklist = [
      "splash", "manifest", "android-icon", "apple-icon", 
      "apple-touch-icon", "favicon", "site-logo", "loading", 
      "loader", "default-image", "placeholder"
    ];
    if (blocklist.some(b => lowerUrl.includes(b))) {
      return null;
    }

    // Check for obvious non-image paths like results pages, search, etc.
    const nonImageKeywords = ["/rezultate/", "/search/", "/anunt/", "/proprieti/", "/listing/"];
    if (nonImageKeywords.some(k => lowerUrl.includes(k))) {
      return null;
    }

    // Clean up redundant :443 port in HTTPS URLs
    let cleanUrl = url;
    if (cleanUrl.startsWith("https://") && cleanUrl.includes(":443/")) {
      cleanUrl = cleanUrl.replace(":443/", "/");
    }

    console.log(`[Server Gemini] Fetching image directly from backend: ${cleanUrl}`);
    const response = await axios.get(cleanUrl, {
      responseType: "arraybuffer",
      timeout: 12000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36",
        "Referer": cleanUrl
      },
      validateStatus: (status) => status === 200
    });

    const rawContentType = response.headers["content-type"];
    const contentType = Array.isArray(rawContentType) 
      ? rawContentType[0] 
      : (typeof rawContentType === "string" ? rawContentType : "image/jpeg");

    if (!contentType.startsWith("image/") || contentType.includes("svg")) {
      console.log(`[Server Gemini] Skipper non-image type: ${contentType} for ${cleanUrl}`);
      return null; // Skip this image instead of failing
    }
    
    const base64 = Buffer.from(response.data).toString("base64");
    
    return {
      inlineData: {
        data: base64,
        mimeType: contentType
      }
    };
  } catch (e: any) {
    console.warn("[Server Gemini] Image skipped during fetch:", url.substring(0, 80), e?.message || "");
    return null;
  }
}

export interface BasicLeadData {
  title: string;
  zone: string;
  price: string;
  ownerName: string;
  ownerPhone: string;
  transactionType: "Vânzare" | "Închiriere";
  categoria: string;
}

export async function serverExtractBasicData(content: string, title: string): Promise<BasicLeadData> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY environment variable is missing on server");
  }

  const prompt = `
  ESTI UN EXPERT IMOBILIAR.
  
  OBIECTIV:
  Extrage datele de bază despre proprietatea aflată în conținutul de mai jos.
  
  DATE NECESARE:
  - Titlul proprietății (atractiv și scurt) - NEVER include the street number (fără număr stradă). Always remove any mention of "0% commission", "0 ron", or "0 euro commission" (fără comision 0).
  - Zona (cartierul/localitatea)
  - Prețul (cu monedă, ex: 150000 EUR)
  - Numele proprietarului sau al persoanei de contact (Dacă în text apare "SELLER_NAME: Nume", acela este NUMELE.)
  - Numărul de telefon (toate găsite)
  - Tip tranzacție: "Vanzare" sau "Inchiriere"
  - Categoria proprietății: Alege exact una din opțiunile: "Apartament", "Casa/Vila", "Teren", "Spatiu Birou", "Spatiu Comercial", "Spatiu Industrial", "Hotel/Pensiune", "Proprietati Speciale".
  
  CONȚINUT PAGINĂ:
  Titlu Original: "${title}"
  Conținut:
  ${content.substring(0, 3500)}
  
  --- REGULI STRICTE ---
  - REGULĂ DETECȚIE TRANZACȚIE (VÂNZARE vs ÎNCHIRIERE):
    * Închirierile au de regulă prețuri sub 10.000 EUR (de obicei 200 - 3.000 EUR/lună). Dacă prețul este sub 10.000 EUR sau apar mențiuni de "/lună", "garanție", setează "Inchiriere".
    * Vânzările au prețuri de zeci sau sute de mii de euro (20.000+ EUR, ex: 50.000, 100.000 EUR). Dacă prețul este de 20.000+ EUR, setează categoric "Vanzare", chiar dacă textul menționează "randament chirie" sau "pretabil închiriere".
  - NICIODATĂ nu include în titlu sau descriere numele vreunui complex rezidențial sau complex de blocuri/clădiri (ex: "Astorium", "Hills" etc.), numărul străzii, numărul de bloc, scara sau apartamentul, ori alte detalii de adresă poștală exactă. Folosește DOAR zona sau cartierul general.
  - ELIMINĂ orice mențiune despre "comision 0%", "0 ron", "0 euro comision".
  - Folosește DOAR opțiunile care se potrivesc cel mai bine din lista de Categorii de mai sus, NU inventa opțiuni noi.
  - Generează titlul (câmpul titlu) folosind EXACT această structură: Tip imobil + număr camere/încăperi sau suprafață mp | Zonă | Pct. de interes | Pct forte imobil | Dotări | Parcare (ex: Apartament 3 camere | Unirii | Metrou 5min | Vedere Panoramică | Mobilat Modern | Loc parcare inclus).
  - IMPORTANT: Titlul TREBUIE să aibă SUB 70 de caractere. Scurtează beneficiile sau dotările dacă este necesar pentru a respecta limita.
  - DACĂ este vorba de un magazin, showroom, depozit, hală, spațiu de retail, setează automat "Spatiu Comercial".
  
  Returnează obiectul JSON conform schemei de mai jos.
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
          zone: { type: Type.STRING },
          price: { type: Type.STRING },
          ownerName: { type: Type.STRING },
          ownerPhone: { type: Type.STRING },
          transactionType: { type: Type.STRING, enum: ["Vanzare", "Inchiriere"] },
          categoria: { type: Type.STRING, enum: ["Apartament", "Casa/Vila", "Teren", "Spatiu Birou", "Spatiu Comercial", "Spatiu Industrial", "Hotel/Pensiune", "Proprietati Speciale"] }
        },
        required: ["title", "zone", "price", "ownerName", "ownerPhone", "transactionType", "categoria"]
      }
    }
  });

  const text = response.text;
  if (!text) throw new Error("No response from Gemini");
  const parsed = JSON.parse(text);

  // Post-processing price validation for transactionType
  const priceDigits = parseInt(String(parsed.price || "").replace(/[^0-9]/g, ""), 10) || 0;
  const isRon = String(parsed.price || "").toLowerCase().includes("ron") || String(parsed.price || "").toLowerCase().includes("lei");
  const priceInEur = isRon ? Math.round(priceDigits / 5) : priceDigits;

  if (priceInEur >= 20000) {
    parsed.transactionType = "Vanzare";
  } else if (priceInEur > 0 && priceInEur <= 10000 && (parsed.categoria === "Apartament" || parsed.categoria === "Casa/Vila")) {
    parsed.transactionType = "Inchiriere";
  }

  return parsed;
}

export async function serverExtractData(content: string, title: string, imageUrls: string[] = [], propertyId?: string, propertyUrl?: string) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY environment variable is missing on server");
  }

  // Limit to first 5 images to dramatically reduce token and payload consumption while preserving key room identification
  const limitedUrls = imageUrls.slice(0, 5);
  const imageParts = await Promise.all(limitedUrls.map(url => fileToGenerativePart(url)));
  const validImageParts = imageParts.filter(p => p !== null) as any[];

  console.log(`[Server Gemini] Sending ${validImageParts.length} image buffers to Gemini...`);

  const prompt = `
  ${PROMPT_INSTRUCTIONS.titles}

  --- 

  EXTRAGE TOATE datele despre proprietatea aflată în conținutul de mai jos și populează un obiect JSON structurat (crmData).
  COMPLETAREA TUTUROR CÂMPURILOR ESTE OBLIGATORIE DACĂ INFORMAȚIA EXISTĂ VIZUAL SAU ÎN TEXT.
  
  --- REGULI STRICTE TITLU ȘI DESCRIERE ---
  - TITLUL COMPLET IDENTIC: Titlul proprietății din câmpul de titlu (crmData.descriere.titlu) TREBUIE să fie ABSOLUT IDENTIC (literă cu literă, caracter cu caracter) cu titlul afișat în corpul textului de descriere (în crmData.descriere.continut și markdownMarketing, situat pe linia direct de sub 📌 ID sau 📌 ID Proprietate, după emojiul 🏡 sau 🏢).
  - ALGORITM DE TITLU IDENTIC: Folosește exact aceleași instrucțiuni de generare a titlului atât în câmpul de titlu, cât și în descrierea de bază. Structura obligatorie: Tip imobil + număr camere/încăperi sau suprafață mp | Zonă | Pct. de interes | Pct forte imobil | Dotări | Parcare (ex: Apartament 3 camere | Unirii | Metrou 5min | Vedere Panoramică | Mobilat Modern | Loc parcare inclus). Titlul trebuie să aibă SUB 70 de caractere.
  - NEGATIVE CONSTRAINT: FĂRĂ denumiri de complexe de blocuri/ansambluri rezidențiale, FĂRĂ numere de stradă, FĂRĂ adrese poștale complete, FĂRĂ număr de bloc, scară sau apartament, atât în titlu cât și în descriere! (exclus: "Astorium", "Hills", "Str. X nr. Y", "bl. Z sc. W"). Folosește exclusiv zona/cartierul general.
  - EXCLUDE any mention of "0% commission", "0 ron", or "0 euro commission" (elimină orice referință la comision 0).
  - REGULA INTRODUCERE DESCRIERE: În secțiunea de introducere descriptivă din descriere (sub titlu și înainte de primul separator ━━━━━━━━━━━━━━━━━━), include STRICT o scurtă propoziție teaser și un paragraf descriptiv al imobilului ca rezumat. ELIMINĂ COMPLET orice mențiune legată de proprietar (fără "direct de la proprietar", fără "proprietar"), FĂRĂ "comision 0%", FĂRĂ numere de stradă, bloc, scară sau apartament.
  
  - SÂNTE MANDATORII ȘABLONELE DE DESCRIERE DE MAI JOS PENTRU AMBELE CAMPU PRIVIND DESCRIEREA (crmData.descriere.continut ȘI markdownMarketing):
  
  * DACĂ Categoria este "Apartament" sau "Casa/Vila", folosește CU SFINȚENIE următorul ȘABLON STRUCTURAL (fără simboluri '#' în interiorul descrierii, cu dash prefixat direct la elemente, fără spațiu suplimentar după dash):

📌 ID ${propertyId ? propertyId.trim() : ""}
🏡 [Titlul identic cu cel din campul de titlu al proprietății]

[O singură propoziție scurtă tip teaser, de exemplu: 65 mp utili, balcon mare, parcare inclusă și mutare imediată.]
[Un scurt paragraf descriptiv al proprietății/imobilului, de exemplu: Apartament complet mobilat și utilat, situat în zona Nicolae Teclu, la aproximativ 10 minute de metrou.]

━━━━━━━━━━━━━━━━━━

⭐ AVANTAJE PRINCIPALE

-[Compartimentare, ex: -decomandat] (NOTĂ: TOATE elementele, inclusiv compartimentarea, trebuie să înceapă obligatoriu cu caracterul '-' direct, fără spații, ex: -decomandat!)
-[avantaj_1, ex: -balcon 10 mp] (NOTĂ: Toate avantajele încep direct cu caracterul "-" fără spații, ex: -balcon 10 mp, -loc parcare subteran etc.)
-[avantaj_2]

━━━━━━━━━━━━━━━━━━

🛋️ DOTĂRI

-[dotare_1, ex: centrală proprie] (NOTĂ: Toate dotările încep direct cu caracterul "-" fără spații, ex: -centrală proprie, -frigider)
-[dotare_2]

[Scurt rezumat/comentariu referitor la organizarea spațiului sau spațiile de depozitare, dacă este cazul, de exemplu: Spațiul este foarte bine organizat și oferă mult loc pentru depozitare comparativ cu majoritatea apartamentelor similare.]

━━━━━━━━━━━━━━━━━━

📍 LOCAȚIE

Acces rapid către:
-[punct_interes_1, ex: metrou Nicolae Teclu] (NOTĂ: Toate punctele încep direct cu caracterul "-" fără spații, ex: -metrou Nicolae Teclu)
-[punct_interes_2]

━━━━━━━━━━━━━━━━━━

💰 ÎNCHIRIERE (sau VÂNZARE - în funcție de tipul de tranzacție "Închiriere" / "Vânzare")

[Preț] / lună (doar dacă e Închiriere, de ex: 599€ / lună) sau [Preț] (dacă e Vânzare)
[Garanție, de ex: 1 lună garanție] (doar dacă e Închiriere și există garanție menționată, altfel o scoți complet)
Comision [Valoare comision, de exemplu: Comision 50% + TVA] (IMPORTANT: NICIODATĂ nu include "comision 0%" sau derivații, conform regulii!)
Disponibil imediat (sau disponibilitatea dedusă din text)

━━━━━━━━━━━━━━━━━━

🤝 SUPORT ÎNCHIRIERE (sau SUPORT VÂNZARE - în funcție de tipul de tranzacție "Închiriere" / "Vânzare")

-consultanță dedicată din partea agenției brokr
-asistență completă în întocmirea contractului și înregistrarea ANAF (ANAF se menționează doar pentru închirieri; pentru vânzare folosește o formulare adecvată cum ar fi asistență notarială)
-posibilitate de vizionare rapidă și flexibilă

📞 Pentru vizionare sau detalii suplimentare, contactează-ne telefonic.


  * DACĂ Categoria este "Spatiu Birou", "Spatiu Comercial" (magazine) sau "Spatiu Industrial", folosește CU SFINȚENIE următorul ȘABLON STRUCTURAL (fără simboluri '#' în interiorul descrierii, utilizând dash '-' prefixat fără spații pentru liste, și ELIMINÂND COMPLET parantezele rotunde și pătrate din textul final - alege singur varianta corectă dintre opțiuni sau completează cu date reale, NU lăsa paranteze textuale de tipul '[...]'):

📌 ID Proprietate: ${propertyId ? propertyId.trim() : ""}
🏢 [Titlul identic cu cel din campul de titlu al proprietății]

Spațiu comercial pregătit pentru activitate, situat în [Zonă / Cartier], cu acces rapid, expunere bună și configurare eficientă pentru multiple tipuri de business.

Potrivit pentru retail, showroom, office, clinică, beauty, servicii sau activități comerciale mixte.

━━━━━━━━━━━━━━━━━━

⭐ PUNCTE CHEIE

-[Suprafata_Utila] mp utili (de tip: -65 mp utili)
-[Compartimentare / Structura, de tip: -compartimentat în 3 cabinete]
-vizibilitate comercială foarte bună
-acces facil pentru clienți și aprovizionare
-trafic zonal [Nivel_Trafic, de tip: -trafic zonal intens]
-disponibil imediat
-flexibil pentru multiple activități
-poziționare strategică în zonă activă

━━━━━━━━━━━━━━━━━━

🛠️ SPAȚIUL

-[Număr încăperi] încăperi
-[Număr băi] băi
-etaj [Etaj] / [Total Etaje Clădire]
-lift: [da/nu]
-balcon / terasă: [da/nu sau detalii suprafață]
-bucătărie: [detalii]
-mobilare: [detalii]

Dotări și infrastructură:

-[climatizare, de tip: -centrală proprie sau -sistem climatizare HVAC]
-[curent trifazic - dacă există menționat în text/poze]
-[internet - dacă e menționat, altfel scoate rândul]
-[detalii securitate, de tip: -sistem alarmă și supraveghere]
-[sistem ventilație - dacă există]
-[rampă aprovizionare / lift marfă - dacă există]
-[depozitare sau acces secundar]

Spațiul permite organizare eficientă și adaptare rapidă pentru diferite tipuri de activitate.

━━━━━━━━━━━━━━━━━━

📍 LOCAȚIE & ACCES

Situat în [Zonă / Cartier], cu acces rapid către:

-transport public
-zone office & comerciale
-artere principale
-zone rezidențiale
-trafic pietonal și auto

Vad comercial: [Expunere, de tip: -vad excelent]
Trafic zonă: [Nivel_Trafic, de tip:-trafic intens]

━━━━━━━━━━━━━━━━━━

💼 POTRIVIT PENTRU

-retail / showroom
-clinică / cabinet
-beauty / wellness
-office / consultanță
-horeca
-servicii comerciale
-activități mixte

━━━━━━━━━━━━━━━━━━

💰 CONDIȚII ÎNCHIRIERE (sau CONDIȚII VÂNZARE - în funcție de tipul de tranzacție "Închiriere" / "Vânzare")

-chirie: [Preț chirie, de tip: -1200 € / lună + TVA sau -fără TVA] sau -preț: [Valoare preț vânzare]
-garanție: [Garanție chirie, de tip:-2 luni garanție, folosește doar la închirieri]
-disponibilitate: [imediată sau dată precisă]
-contract minim: [perioadă, ex: -12 luni]
-destinație acceptată: [ex: -comercial / office]

Condiții suplimentare:
[detalii perioadă grație / amenajare sau elimină dacă nu sunt menționate]

━━━━━━━━━━━━━━━━━━

🤝 SUPORT ÎNCHIRIERE (sau SUPORT VÂNZARE)

-consultanță dedicată din partea agenției brokr
-suport negociere și contractare
-analiză compatibilitate activitate
-posibilitate de vizionare rapidă și flexibilă

📞 Pentru vizionare sau detalii suplimentare, contactează-ne telefonic.


  * PENTRU ALTE CATEGORII (Terenuri, etc), ambele descrieri trebuie să respecte următorul format de secțiuni, fără simboluri '#' în interiorul textului:
  
    Descriere
    [3-4 propoziții despre proprietate și atmosferă]
    
    Detalii Principale
    • suprafață utilă: [X] mp
    • număr camere: [X]
    • etaj: [X]
    • an construcție: [X]
    
    Compartimentare
    [Detalii despre fluxul camerelor]
    
    Locație
    • Metrou [Nume] (X min)
    • [Alte puncte interes]
    
    Detalii Importante
    • [Tehnic/Dotări]
    
  --- REGULI DETECTIE VIZUALA ȘI EXTRACTION DATE (CRITICAL) ---
  Analizează textul URL-ului proprietății și fotografiile detaliat pentru a popula crmData și elementele de utilități, finisaje sau dotări.
  
  ===========================================
  A. REGULI GENERALE & TOP-LEVEL
  ===========================================
  - NO STREET NUMBER: Nu pune NICIODATĂ numărul străzii în niciun câmp de text (titlu, descriere etc.).
  - FĂRĂ COMISION 0%: Elimină absolut orice referire la "0% comision", "comision 0", "0 euro comision", "fără comision".
  - CALCULE AUTOMATE:
    * Pentru Apartament și Casa/Vila, construita = utila * 1.2
    * Pentru alte proprietăți (Spatiu Birou, Spatiu Comercial, Spatiu Industrial, Teren, Hotel/Pensiune etc.), construita = utila * 1.1
    * utilaTotala = utila + balcoane (suprafață) + terase (suprafață) dacă sunt menționate.
  - CLASA ENERGETICĂ: Setează implicit valoarea ca o linie goală ("") în loc să speculezi, dacă clasa energetică nu este explicit specificată în textul URL-ului.
  - DROPDOWN-URI ȘI SELECT-URI: Nu inventa niciodată valori noi în JSON. Dacă valoarea nu se potrivește cu opțiunile predefinite, folosește linia goală ("").

  ===========================================
  B. LOGICĂ DE DETECȚIE DIVIZATĂ PE CATEGORII (UI ACCORDIONS)
  ===========================================

  1. ACCORDION: CARACTERISTICI
     ---------------------------
     * Secțiunea: Suprafețe
       - balcoane (suprafată) & terase (suprafată): Completează-le DOAR dacă sunt direct și explicit specificate în text/URL. Dacă se găsește doar un simplu număr de balcoane (de ex. "1 balcon" sau o valoare numerică clară fără a menționa și terasă), completează exclusiv campul "balcoane", NU și cel de "terase". Completează ambele doar dacă sunt menționate distinct, separat și individualizat în text.
     * Secțiunea: Clădire
       - stadiuConstructie: Dacă nu se menționează în mod explicit alt stadiu în URL ori text, selectează implicit "Finalizata".
       - tipImobil: Prima opțiune este "Bloc".

  2. ACCORDION: UTILITĂȚI
     ---------------------------
     * Secțiunea: General
       - IMPORTANT: Opțiunea "Acces internet" și opțiunile sale derivate ("Cablu", "Fibra optica", "Wireless", "Dial-up") au fost ELIMINATE COMPLET. Nu le include și nu le selecta niciodată în JSON-ul generat.
     * Secțiunea: Sistem Încălzire
        - În utilitati > sistem incalzire, alege obligatoriu și tipul de corp/sistem de radiere a căldurii: fie "Calorifere", fie "Incalzire pardoseala" (întotdeauna cel puțin una dintre acestea trebuie să fie selectată!).
        - Bifează obligatoriu "Calorifere" dacă acestea sunt menționate în text / descriere sau dacă sunt vizibile în pozele camerelor sau dacă nu este menționat/vizibil explicit un sistem de încălzire în pardoseală.
        - Bifează "Incalzire pardoseala" dacă este menționat explicit încălzire în pardoseală în text / descriere sau dacă se confirmă prin dotări.
       - Pentru apartamente, alege obligatoriu cel puțin unul dintre sistemele principale de încălzire (Termoficare, Centrala proprie, Centrala imobil) bazat pe text sau pe imagini:
         - Centrala proprie: Bifează dacă selectezi/vezi o centrală termică murală în poze (cutia metalică pe perete de obicei plasată în bucătărie sau în baie) sau dacă este descrisă ca "centrală proprie".
         - Centrala imobil: Bifează dacă scrie explicit în text "centrală de bloc" sau "centrală de imobil".
         - Termoficare: Bifează dacă scrie explicit "termoficare" sau sistem centralizat, sau dacă vezi contoare / repartitoare pe calorifere din poze sau text.
     * Secțiunea: Climatizare
       - Aer conditionat: Bifează dacă detectezi un aparat de AC pe perete în fotografii sau dacă este declarat în text.

  3. ACCORDION: FINISAJE
     ---------------------------
     * Secțiunea: Pereți
       - Vopsea lavabila: Bifează automat dacă dintr-o scanare generală a pereților în poze ori text aceștia sunt simpli/zugrăviți într-o culoare simplă solidă.
       - Faianta: Bifează în bucătărie și băi dacă în descriere ori fotografii apar finisajele de faianță specifice băilor sau spațiului de blat din bucătărie.
     * Secțiunea: Podele & Ferestre
       - Bifează corespunzător conform dovezilor (parchet, gresie, marmură, termopane/ferestre PVC, lemn etc.).
     * Secțiunea: Ușă Intrare
       - Bifează materialul identificat (de ex. "Metal" dacă ușa de la intrare este din metal în fotografii ori text, Lemn sau PVC).
     * Secțiunea: Uși Interior
       - Bifează tipul/materialul (Lemn, Celulare etc.) identificat în text sau vizibil în poze.
     * Secțiunea: Jaluzele & Rulouri & Izolații
       - Bifează exclusiv pe bază de dovezi vizibile în imagini sau descrise textual (fără presupuneri speculative).

  4. ACCORDION: DOTĂRI
     ---------------------------
     * Secțiunea: Mobilat
       - Setează starea corectă pe baza imaginilor din camere și living: "Complet", "Partial", "Nemobilat", "Lux", "Modern".
     * Secțiunea: Bucătărie
       - Mobilata: Bifează dacă din descriere sau din poze reiese că bucătăria are piese de mobilier (dulapuri, blat de lucru, corpuri suspendate).
       - Utilata: Bifează dacă textul ori scanarea pozelor indică prezența electrocasnicelor funcționale în bucătărie (cuptor, plită, aragaz, frigider, hota sau cuptor cu microunde).
     * Secțiunea: Contorizare
       - Apometre: Bifează dacă proprietatea are alimentare declarată / vizibilă cu apă.
       - Contor gaz: Bifează dacă proprietatea este conectată la rețeaua de gaz.
       - Contor curent electric: Bifează dacă proprietatea este branșată la electricitate.
       - Contor caldura: Bifează dacă se specifică termoficare sau dacă vezi repartitoare ori contoare pe calorifere în text/imagini.
     * Secțiunea: Electrocasnice
       - Bifează precis dotările electrocasnice detectate în poze dau menționate în text (Mașină de spălat rufe, Frigider, Aragaz, Mașină de spălat vase, TV, Cafetiera, Cuptor microunde, Hota, Plita electrica).
     * Secțiunea: Priveliște
       - Panoramica: Se bifează DOAR dacă în descriere sau/și în poze se demonstrează că proprietatea oferă vizibilitate largă, deschisă pe cel puțin 3 laturi/puncte cardinale diferite.
       - Spre lac: Se bifează dacă un lac, râu sau corp de apă este menționat în descriere sau vizibil din ferestre/balcon în fotografii.
       - Spre oras: Se bifează extrem de des în mod implicit (aproape întotdeauna), deoarece apartamentele situate în orașe oferă în mod natural vedere directă către peisajul urban din ferestrele lor.
       - Spre munte / Spre mare / Spre padure: Bifează exclusiv dacă sunt menționate clar în text sau confirmate prin imagini.

  5. ACCORDION: PREȚ
     ---------------------------
     * Secțiunea: Detalii Preț
       - avans: Se determină și se completează pe baza informațiilor de la URL-ul / textul proprietății. Dacă se menționează plata unui avans exprimat în luni (ex: "1 lună avans", "avans 1 lună", "avans o lună" sau simliare), atunci valoarea de calculat și adăugat este Preț lunar chirie * Număr luni avans. Dacă se menționează direct o sumă fixă de bani (ex: "avans 400 euro"), folosește acea sumă ca atare. Să fii foarte atent la numărul de luni indicat și la moneda prețului.
       - garantie: Se determină pe baza informațiilor de garanție / depozit identificate la URL sau în text. Dacă se menționează o garanție/depozit exprimat în luni (ex: "1 lună garanție", "garanție 1 lună", "depozit 1 lună", "o lună garanție"), se calculează valoarea ca fiind Preț lunar chirie * Număr luni garanție și se introduce acest număr în JSON. Dacă se specifică o sumă directă fixă de bani de garanție/depozit (ex: "garanție 1200 euro"), folosește direct acea valoare.

  ===========================================
  C. VALORI POSIBILE PENTRU CHECKLISTS (Să respecte EXACT aceste valori în JSON):
  ===========================================
  - checkList: ["Geam la baie", "Bucatarie deschisa", "Pet friendly", "Cheia in agentie", "S +", "D +", "P +"]
  - utilitati.general: ["Curent electric", "Apa", "Canalizare", "Gaz", "Put", "Fosa septica", "Curent trifazic", "CATV", "Telefon"]
  - utilitati.sistemIncalzire: ["Termoficare", "Centrala proprie", "Centrala imobil", "Convectoare", "Soba teracota", "Centrala pe lemne", "Incalzire pardoseala", "Calorifere", "Semineu", "Pompa de caldura"]
  - utilitati.climatizare: ["Aer conditionat", "Ventiloconvectoare", "Aeroterme"]
  - utilitati.finisaje.stare: ["Finisat", "Semifinisat", "Ultrafinisat", "Buna", "Necesita renovare", "Renovat"]
  - utilitati.finisaje.izolatii: ["Exterior", "Interior", "Bloc izolat termic"]
  - utilitati.finisaje.pereti: ["Vopsea lavabila", "Var", "Faianta", "Lambriu", "Tapet", "Marmura", "Huma", "Vinarom", "Stucco veneziano"]
  - utilitati.finisaje.podele: ["Parchet", "Gresie", "Marmura", "Mocheta", "Dusumea", "Linoleum", "Nefinisat", "Pardoseala flotanta"]
  - utilitati.finisaje.ferestre: ["PVC", "Lemn", "Aluminiu", "Lemn stratificat"]
  - utilitati.finisaje.jaluzele: ["Verticale", "Orizontale"]
  - utilitati.finisaje.rulouri: ["Aluminiu", "Lemn", "PVC"]
  - utilitati.finisaje.usaIntrare: ["Metal", "Lemn", "PVC", "Pal"]
  - utilitati.finisaje.usiInterior: ["Celulare", "Lemn", "Panel", "PVC", "Sticla", "Metal"]
  - utilitati.dotari.mobilat: ["Complet", "Partial", "Nemobilat", "Lux", "Modern"]
  - utilitati.dotari.spatiiAditionale: ["Terasa", "Balcon", "Subsol", "Debara", "Boxa", "Uscatorie", "Auto", "Anexe", "Pivnita", "Curte"]
  - utilitati.dotari.bucatarie: ["Mobilata", "Partial mobilata", "Utilata", "Partial utilata", "Nemobilata", "Neutilata"]
  - utilitati.dotari.contorizare: ["Apometre", "Contor caldura", "Contor gaz", "Contor curent electric", "Contorizare separata"]
  - utilitati.dotari.electrocasnice: ["Masina de spalat rufe", "Frigider", "Aragaz", "Masina de spalat vase", "TV", "Cafetiera", "Cuptor microunde", "Hota", "Plita electrica"]
  - utilitati.dotari.imobil: ["Interfon", "Videointerfon", "Supraveghere video", "Lift", "Spatii agrement", "Sauna", "SPA", "Acoperis", "Curte", "Curte comuna", "Gradina", "Piscina interioara", "Piscina exterioara", "Uscatorie", "Receptie", "Jacuzzi", "Semineu", "Senzor de fum", "Sistem de alarma", "Telecomanda poarta acces auto"]
  - utilitati.dotari.priveliste: ["Panoramica", "Spre lac", "Spre mare", "Spre munte", "Spre oras", "Spre padure"]
  
   --- REGULI CATEGORISIRE ȘI PROCESARE IMAGINI (CRITICAL) ---
   Analizează VIZUAL fiecare imagine trimisă și s-o asociezi în categoria corectă:
   - LIVING: Canapele, TV, zonă de relaxare. (Inclusiv patul în garsonieră).
   - BUCATARIE: Blat, chiuvetă, dulapuri suspendate, electrocasnice.
   - CAMERA (DORMITOR): Doar dacă nu e garsonieră și are pat.
   - BAIE: Vas toaletă, chiuvetă baie, cadă/duș.
   - ALTE SPATII: Balcon, curte, hol, exterior, schiță.
 
   --- REGULI DEDUPLICARE VIZUALĂ ---
   - NU adăuga aceeași imagine identică de două ori în JSON, chiar dacă are URL-uri diferite.
   - Identifică duplicates vizual (aceeași scenă/unghi). Păstrează doar versiunea cu rezoluție mai mare.
 
   INSTRUCTIUNI ASOCIERE:
   - Analizează imaginile atașate în ordinea în care au fost trimise.
   - Trimite URL-ul imaginii în categoria identificată.
   - Lista de URL-uri primite este:
   ${limitedUrls.join("\n")}
   
  --- REGULI TITLU ȘI DESCRIERE (MANDATORY) ---
  - TITLUL COMPLET IDENTIC: Titlul proprietății din câmpul de titlu (crmData.descriere.titlu) TREBUIE să fie ABSOLUT IDENTIC cu titlul afișat în corpul textului de descriere (în crmData.descriere.continut și markdownMarketing, situat după emojiul 🏡 sau 🏢, de sub linia ID).
  - ALGORITM DE TITLU IDENTIC: Folosește exact aceeași structură în ambele locuri: Tip imobil + număr camere/încăperi sau suprafață mp | Zonă | Pct. de interes | Pct forte imobil | Dotări | Parcare.
  - NO COMPLEXES OR STREET/BLOCK/STAIR NUMBERS: NICIODATĂ nu include în titlu sau descriere denumiri de complexe de blocuri/ansambluri rezidențiale (ex. Astorium), numere de stradă, adrese complete, sau numere de bloc/scară/apartament.
  - ELIMINATE ANY mention of "0% commission", "0 ron", or "0 euro commission" from ALL text fields.
  - PENTRU APARTAMENTE ȘI CASE / VILE, ambele descrieri (crmData.descriere.continut și markdownMarketing) trebuie să urmeze EXACT șablonul mandatat mai sus cu 📌 ID, 🏡 titlu, ━━━━━━━━━━━━━━━━━━, ⭐ AVANTAJE PRINCIPALE, 🛋️ DOTĂRI, 📍 LOCAȚIE, 💰 ÎNCHIRIERE, 🤝 SUPORT ÎNCHIRIERE ș.a.m.d.
  - PENTRU BIROURI, SPAȚII COMERCIALE ȘI SPAȚII INDUSTRIALE, ambele descrieri (crmData.descriere.continut și markdownMarketing) trebuie să folosească EXACT noul șablon structural mandatat cu 📌 ID Proprietate, 🏢 titlu, ━━━━━━━━━━━━━━━━━━, ⭐ PUNCTE CHEIE, 🛠️ SPAȚIUL, 📍 LOCAȚIE & ACCES, 💼 POTRIVIT PENTRU, 💰 CONDIȚII ÎNCHIRIERE, 🤝 SUPORT ÎNCHIRIERE ş.a.m.d.
  - NOTĂ ABSOLUT CRITICĂ PENTRU PARANTEZE: NICIODATĂ nu păstra parantezele rotunde sau pătrate atunci când generezi textul final - parantezele arată doar că există mai multe variante posibile sau mai multe exemple, din care tu, ca AI, trebuie să o alegi pe cea mai potrivită exclusiv pe baza proprietății date, eliminând complet orice urmă de paranteză sau bracket.
  - PENTRU ALTE CATEGORII (Terenuri, Spatii depozitare secundare, etc), urmează STRUCTURA DE DESCRIERE cu (Descriere, Detalii Principale, Compartimentare, Locație, Detalii Importante, Contact).

  DATE DE ANALIZAT:
  Titlu Original: "${title}"
  Conținut:
  ${content.substring(0, 15000)}
  
  Returnează obiectul JSON conform schemei solicitate. COMPLETAREA TUTUROR CÂMPURILOR ESTE OBLIGATORIE DACĂ INFORMAȚIA EXISTĂ VIZUAL SAU ÎN TEXT.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3.8-flash",
    contents: {
      parts: [
        ...validImageParts,
        { text: prompt }
      ]
    },
    config: {
        responseMimeType: "application/json",
        responseSchema: {
            type: Type.OBJECT,
            properties: {
                crmData: {
                  type: Type.OBJECT,
                  properties: {
                    detaliiGenerale: {
                      type: Type.OBJECT,
                      properties: {
                        stadiu: { type: Type.STRING },
                        tranzactie: { type: Type.STRING },
                        categoria: { type: Type.STRING },
                        proprietar: { type: Type.STRING },
                        contacteAditionale: { type: Type.STRING },
                        ansambluRezidential: { type: Type.STRING },
                        localizare: {
                          type: Type.OBJECT,
                          properties: {
                            oras: { type: Type.STRING },
                            zona: { type: Type.ARRAY, items: { type: Type.STRING } },
                            strada: { type: Type.STRING },
                            numar: { type: Type.STRING },
                            bloc: { type: Type.STRING },
                            scara: { type: Type.STRING },
                            apartament: { type: Type.STRING },
                            puncteInteres: { type: Type.ARRAY, items: { type: Type.STRING } },
                            imprejurimi: { type: Type.ARRAY, items: { type: Type.STRING } }
                          }
                        },
                        memoPrivat: { type: Type.STRING }
                      }
                    },
                    caracteristici: {
                      type: Type.OBJECT,
                      properties: {
                        detalii: {
                          type: Type.OBJECT,
                          properties: {
                            tipCasa: { type: Type.STRING },
                            tipApartament: { type: Type.STRING },
                            compartimentare: { type: Type.STRING },
                            confort: { type: Type.STRING },
                            destinatie: { type: Type.STRING },
                            camere: { type: Type.STRING },
                            bucatarii: { type: Type.STRING },
                            dormitoare: { type: Type.STRING },
                            bai: { type: Type.STRING },
                            balcoane: { type: Type.STRING },
                            terase: { type: Type.STRING },
                            etaj: { type: Type.STRING },
                            orientare: { type: Type.STRING },
                            parcari: { type: Type.STRING },
                            garaje: { type: Type.STRING },
                            checkList: { type: Type.ARRAY, items: { type: Type.STRING } }
                          }
                        },
                        suprafete: {
                          type: Type.OBJECT,
                          properties: {
                            utila: { type: Type.STRING },
                            amprenta: { type: Type.STRING },
                            construita: { type: Type.STRING },
                            utilaTotala: { type: Type.STRING },
                            balcoane: { type: Type.STRING },
                            terase: { type: Type.STRING },
                            gradina: { type: Type.STRING },
                            teren: { type: Type.STRING },
                            terenLiber: { type: Type.STRING },
                            frontStradal: { type: Type.STRING },
                            vitrina: { type: Type.STRING },
                            numarFronturi: { type: Type.STRING },
                            numarTerase: { type: Type.STRING },
                            numarBalcoane: { type: Type.STRING }
                          }
                        },
                        alteDetalii: {
                          type: Type.OBJECT,
                          properties: {
                            stadiuConstructie: { type: Type.STRING },
                            structura: { type: Type.STRING },
                            tipImobil: { type: Type.STRING },
                            riscSeismic: { type: Type.STRING },
                            anConstructie: { type: Type.STRING },
                            anRenovare: { type: Type.STRING },
                            inaltime: { type: Type.STRING }
                          }
                        },
                        energetica: {
                          type: Type.OBJECT,
                          properties: {
                            clasa: { type: Type.STRING },
                            consumAnual: { type: Type.STRING },
                            emisiiCO2: { type: Type.STRING },
                            consumRegenerabile: { type: Type.STRING }
                          }
                        }
                      }
                    },
                    utilitati: {
                      type: Type.OBJECT,
                      properties: {
                        general: { type: Type.ARRAY, items: { type: Type.STRING } },
                        sistemIncalzire: { type: Type.ARRAY, items: { type: Type.STRING } },
                        climatizare: { type: Type.ARRAY, items: { type: Type.STRING } },
                        finisaje: {
                          type: Type.OBJECT,
                          properties: {
                            stare: { type: Type.ARRAY, items: { type: Type.STRING } },
                            izolatii: { type: Type.ARRAY, items: { type: Type.STRING } },
                            pereti: { type: Type.ARRAY, items: { type: Type.STRING } },
                            podele: { type: Type.ARRAY, items: { type: Type.STRING } },
                            ferestre: { type: Type.ARRAY, items: { type: Type.STRING } },
                            jaluzele: { type: Type.ARRAY, items: { type: Type.STRING } },
                            rulouri: { type: Type.ARRAY, items: { type: Type.STRING } },
                            usaIntrare: { type: Type.ARRAY, items: { type: Type.STRING } },
                            usiInterior: { type: Type.ARRAY, items: { type: Type.STRING } },
                            acoperis: { type: Type.ARRAY, items: { type: Type.STRING } }
                          }
                        },
                        dotari: {
                          type: Type.OBJECT,
                          properties: {
                            mobilat: { type: Type.STRING },
                            spatiiAditionale: { type: Type.ARRAY, items: { type: Type.STRING } },
                            bucatarie: { type: Type.ARRAY, items: { type: Type.STRING } },
                            contorizare: { type: Type.ARRAY, items: { type: Type.STRING } },
                            electrocasnice: { type: Type.ARRAY, items: { type: Type.STRING } },
                            imobil: { type: Type.ARRAY, items: { type: Type.STRING } },
                            diverse: { type: Type.ARRAY, items: { type: Type.STRING } },
                            servicii: { type: Type.ARRAY, items: { type: Type.STRING } },
                            amenajareStrazi: { type: Type.ARRAY, items: { type: Type.STRING } },
                            priveliste: { type: Type.ARRAY, items: { type: Type.STRING } }
                          }
                        }
                      }
                    },
                    pret: {
                      type: Type.OBJECT,
                      properties: {
                        detalii: {
                          type: Type.OBJECT,
                          properties: {
                            pret: { type: Type.STRING },
                            moneda: { type: Type.STRING },
                            pretMp: { type: Type.STRING },
                            ultimPret: { type: Type.STRING },
                            checkList: { type: Type.ARRAY, items: { type: Type.STRING } },
                            plataAcceptata: { type: Type.STRING },
                            pretGaraj: { type: Type.STRING },
                            pretParcare: { type: Type.STRING },
                            avans: { type: Type.STRING },
                            garantie: { type: Type.STRING },
                            tvaIncluded: { type: Type.BOOLEAN },
                            notePrivate: { type: Type.STRING }
                          }
                        },
                        comisioane: {
                          type: Type.OBJECT,
                          properties: {
                            comisionCumparatorProcent: { type: Type.STRING },
                            comisionCumparatorValoare: { type: Type.STRING },
                            comisionProprietarProcent: { type: Type.STRING },
                            comisionProprietarValoare: { type: Type.STRING },
                            colaborare: { type: Type.BOOLEAN }
                          }
                        },
                        contract: {
                          type: Type.OBJECT,
                          properties: {
                            type: { type: Type.STRING },
                            semnat: { type: Type.STRING },
                            nr: { type: Type.STRING },
                            dataSemnare: { type: Type.STRING },
                            dataExpirare: { type: Type.STRING }
                          }
                        }
                      }
                    },
                    descriere: {
                      type: Type.OBJECT,
                      properties: {
                        titlu: { type: Type.STRING },
                        continut: { type: Type.STRING },
                        disponibilitate: { type: Type.STRING },
                        video: { type: Type.STRING },
                        turVirtual: { type: Type.STRING }
                      }
                    },
                    imagini: {
                      type: Type.OBJECT,
                      properties: {
                        living: { 
                          type: Type.ARRAY, 
                          items: { 
                            type: Type.OBJECT,
                            properties: {
                              original: { type: Type.STRING }
                            }
                          } 
                        },
                        bucatarie: { 
                          type: Type.ARRAY, 
                          items: { 
                            type: Type.OBJECT,
                            properties: {
                              original: { type: Type.STRING }
                            }
                          } 
                        },
                        camera: { 
                          type: Type.ARRAY, 
                          items: { 
                            type: Type.OBJECT,
                            properties: {
                              original: { type: Type.STRING }
                            }
                          } 
                        },
                        baie: { 
                          type: Type.ARRAY, 
                          items: { 
                            type: Type.OBJECT,
                            properties: {
                              original: { type: Type.STRING }
                            }
                          } 
                        },
                        alteSpatii: { 
                          type: Type.ARRAY, 
                          items: { 
                            type: Type.OBJECT,
                            properties: {
                              original: { type: Type.STRING }
                            }
                          } 
                        }
                      }
                    }
                  }
                },
                markdownMarketing: { type: Type.STRING, description: "Marketing content table" },
                summary: { type: Type.STRING, description: "A brief summary in Romanian" }
            },
            required: ["crmData", "markdownMarketing", "summary"]
        }
    }
  });

  const text = response.text;
  if (!text) {
    throw new Error("No response from Gemini");
  }

  try {
    const parsed = JSON.parse(text);
    if (parsed && parsed.crmData) {
      // Validate and enforce transactionType based on price heuristics
      if (parsed.crmData.detaliiGenerale) {
        const rawP = String(parsed.crmData.pret?.detalii?.pret || "");
        const priceDigits = parseInt(rawP.replace(/[^0-9]/g, ""), 10) || 0;
        const isRon = rawP.toLowerCase().includes("ron") || rawP.toLowerCase().includes("lei");
        const priceInEur = isRon ? Math.round(priceDigits / 5) : priceDigits;
        const cat = parsed.crmData.detaliiGenerale.categoria;

        if (priceInEur >= 20000) {
          parsed.crmData.detaliiGenerale.tranzactie = "Vânzare";
        } else if (priceInEur > 0 && priceInEur <= 10000 && (cat === "Apartament" || cat === "Casa/Vila")) {
          parsed.crmData.detaliiGenerale.tranzactie = "Închiriere";
        }
      }

      if (!parsed.crmData.caracteristici) {
        parsed.crmData.caracteristici = {};
      }
      if (!parsed.crmData.caracteristici.alteDetalii) {
        parsed.crmData.caracteristici.alteDetalii = {};
      }
      // If stadiuConstructie is missing or empty, default it to "Finalizata"
      if (!parsed.crmData.caracteristici.alteDetalii.stadiuConstructie || parsed.crmData.caracteristici.alteDetalii.stadiuConstructie.trim() === "") {
        parsed.crmData.caracteristici.alteDetalii.stadiuConstructie = "Finalizata";
      }

      // Ensure that 'sistemIncalzire' is valid and contains either 'Calorifere' or 'Incalzire pardoseala'
      if (!parsed.crmData.utilitati) {
        parsed.crmData.utilitati = {};
      }
      if (!parsed.crmData.utilitati.sistemIncalzire || !Array.isArray(parsed.crmData.utilitati.sistemIncalzire)) {
        parsed.crmData.utilitati.sistemIncalzire = [];
      }

      const hasCalorifere = parsed.crmData.utilitati.sistemIncalzire.includes("Calorifere");
      const hasPardoseala = parsed.crmData.utilitati.sistemIncalzire.includes("Incalzire pardoseala");

      if (!hasCalorifere && !hasPardoseala) {
        const textToAnalyze = `${content} ${title}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        
        const mentionsPardoseala = textToAnalyze.includes("pardoseala") || 
                                   textToAnalyze.includes("incalzire pardoseala") || 
                                   textToAnalyze.includes("incalzirea in pardoseala") || 
                                   textToAnalyze.includes("incalzire-pardoseala");
                                   
        if (mentionsPardoseala) {
          parsed.crmData.utilitati.sistemIncalzire.push("Incalzire pardoseala");
        } else {
          parsed.crmData.utilitati.sistemIncalzire.push("Calorifere");
        }
      }

      // Height classification and sublevel/levels parsing rules
      if (!parsed.crmData.caracteristici.detalii) {
        parsed.crmData.caracteristici.detalii = {};
      }
      if (!parsed.crmData.caracteristici.detalii.checkList || !Array.isArray(parsed.crmData.caracteristici.detalii.checkList)) {
        parsed.crmData.caracteristici.detalii.checkList = [];
      }

       const urlLower = String(propertyUrl || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const titleLower = String(title || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const contentLower = String(content || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const fullTextToAnalyze = `${urlLower} ${titleLower} ${contentLower}`;

      // Normalize 'etaj' value to match ETAJ_OPTIONS, with fallback regex check if missing
      let extractedEtaj = parsed.crmData.caracteristici.detalii.etaj || "";
      
      if (!extractedEtaj || String(extractedEtaj).trim() === "") {
        const etajPatterns = [
          /(?:etaj|etajul|et|et\.?)\s*[:\-–]?\s*(parter|demisol|mansard[a-ăâ]?|\d+)/i,
          /\b(\d+)\s*(?:din|\/)\s*\d+\s*(?:etaj|etaje)\b/i,
          /\betaj\s*(\d+)\b/i,
          /\betajul\s*(\d+)\b/i
        ];
        for (const pattern of etajPatterns) {
          const match = fullTextToAnalyze.match(pattern);
          if (match && match[1]) {
            extractedEtaj = match[1];
            break;
          }
        }
      }

      if (!extractedEtaj || String(extractedEtaj).trim() === "") {
        if (fullTextToAnalyze.includes("parter")) {
          extractedEtaj = "Parter";
        } else if (fullTextToAnalyze.includes("demisol")) {
          extractedEtaj = "Demisol";
        } else if (fullTextToAnalyze.includes("mansarda") || fullTextToAnalyze.includes("mansardă")) {
          extractedEtaj = "Mansarda";
        }
      }

      const normalizeEtajValue = (val: string): string => {
        const str = val.trim().toLowerCase();
        if (str === "parter") return "Parter";
        if (str === "demisol") return "Demisol";
        if (str === "mansarda" || str.includes("mansard")) return "Mansarda";
        if (str.includes("ultimele 2") || str.includes("ultimele") || str.includes("ultimul")) return "Ultimele 2 etaje";
        
        const matchDigit = str.match(/\d+/);
        if (matchDigit) {
          const num = parseInt(matchDigit[0], 10);
          if (num >= 1 && num <= 24) {
            return `Etaj ${num}`;
          }
        }
        return "";
      };
      
      parsed.crmData.caracteristici.detalii.etaj = normalizeEtajValue(String(extractedEtaj));

      // Check for Subsol (S +)
      const hasSubsol = 
        fullTextToAnalyze.includes("subsol") || 
        urlLower.includes("subsol") || 
        /\b(?:s-p|s-d)\b/i.test(urlLower) || 
        /\bs\s*\+\s*[pde0-9]/i.test(fullTextToAnalyze) ||
        /\bsubsol\b/i.test(fullTextToAnalyze);

      if (hasSubsol) {
        if (!parsed.crmData.caracteristici.detalii.checkList.includes("S +")) {
          parsed.crmData.caracteristici.detalii.checkList.push("S +");
        }
      }

      // Check for Demisol (D +)
      const hasDemisol = 
        fullTextToAnalyze.includes("demisol") || 
        urlLower.includes("demisol") || 
        /\b(?:d-p|d-e)\b/i.test(urlLower) || 
        /\bd\s*\+\s*[pe0-9]/i.test(fullTextToAnalyze) ||
        /\bdemisol\b/i.test(fullTextToAnalyze);

      if (hasDemisol) {
        if (!parsed.crmData.caracteristici.detalii.checkList.includes("D +")) {
          parsed.crmData.caracteristici.detalii.checkList.push("D +");
        }
      }

      // Check for Parter (P +)
      const hasParter = 
        fullTextToAnalyze.includes("parter") || 
        urlLower.includes("parter") || 
        /\bp\s*\+\s*[e0-9]/i.test(fullTextToAnalyze) ||
        /\bparter\b/i.test(fullTextToAnalyze);

      if (hasParter) {
        if (!parsed.crmData.caracteristici.detalii.checkList.includes("P +")) {
          parsed.crmData.caracteristici.detalii.checkList.push("P +");
        }
      }

      // Extract levels (e.g., P+4, S+P+2)
      let extractedLevels: string | null = null;
      
      const regexRegimInaltime = /\b(?:regim\s+(?:de\s+)?inaltime|regimul\s+(?:de\s+)?inaltime)\s*(?:is:?\s*)?(?:[sS]\s*\+\s*)?(?:[dD]\s*\+\s*)?[pP]\s*\+\s*(\d+)\b/i;
      const regexSimplePPlus = /\b[pP]\s*\+\s*(\d+)\b/i;
      const regexEtaje = /\b(\d+)\s*(?:etaje|nivele|nivele\s+supraterane|nivele\s+de\s+birouri)\b/i;
      const regexInUrl = /(?:-p-|-p-\d+-etaje-|etaje-)(\d+)/i;

      const matchRegim = fullTextToAnalyze.match(regexRegimInaltime);
      const matchPPlus = fullTextToAnalyze.match(regexSimplePPlus);
      const matchEtaje = fullTextToAnalyze.match(regexEtaje);
      const matchInUrl = urlLower.match(regexInUrl);

      if (matchRegim && matchRegim[1]) {
        extractedLevels = matchRegim[1];
      } else if (matchInUrl && matchInUrl[1]) {
        extractedLevels = matchInUrl[1];
      } else if (matchPPlus && matchPPlus[1]) {
        extractedLevels = matchPPlus[1];
      } else if (matchEtaje && matchEtaje[1]) {
        extractedLevels = matchEtaje[1];
      }

      if (extractedLevels && /^\d+$/.test(extractedLevels.trim())) {
        parsed.crmData.caracteristici.alteDetalii.niveluriConstructie = extractedLevels.trim();
      }
    }
    return parsed;
  } catch (e) {
    console.error("Failed to parse Gemini response in server extractData:", text);
    throw new Error("Failed to parse structured data on server side");
  }
}
