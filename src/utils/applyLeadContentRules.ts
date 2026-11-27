import type { Lead } from "../services/leadsService";
import { automationSettingsService } from "../services/automationSettingsService";
import { buildTitleFromAutomationRule, extractTitleInputFromLead } from "./titleAutomationEngine";
import { generateStandardAdTitle } from "./propertyTitleGenerator";
import { getApiAuthHeaders } from "../lib/apiAuth";
import { findAreaInText, hasRealNeighborhoodArea } from "./zoneResolutionUtils";

export type LeadTransformTarget = "property" | "cerere" | "my_list";

export interface ApplyLeadContentRulesResult {
  formattedTitle: string;
  formattedDescription: string;
  updatedCrmData: any;
  updatedExtractedData: any;
}

function buildLocalFallbackDescription(params: {
  title: string;
  category: string;
  transactionType: string;
  zone: string;
  price: string;
  specs: any;
  propertyId?: string;
}): string {
  const { title, category, transactionType, zone, price, specs, propertyId } = params;
  const idStr = propertyId ? propertyId.trim() : "";
  const isCommercial = /birou|comercial|industrial|hala|depozit/i.test(category || "");
  const isRent = transactionType === "Închiriere";
  const transLabel = isRent ? "ÎNCHIRIERE" : "VÂNZARE";
  const suprafata = specs?.suprafete?.utila || "";
  const camere = specs?.detalii?.camere || "";
  const bai = specs?.detalii?.bai || "1";
  const etaj = specs?.detalii?.etaj || "-";
  const compartimentare = specs?.detalii?.compartimentare || "decomandat";

  if (isCommercial) {
    return `📌 ID Proprietate: ${idStr}
🏢 ${title}

Spațiu pregătit pentru activitate, situat în ${zone || "București"}, cu acces rapid, expunere bună și configurare eficientă pentru multiple tipuri de business.

Potrivit pentru retail, showroom, office, clinică, beauty, servicii sau activități comerciale mixte.

━━━━━━━━━━━━━━━━━━

⭐ PUNCTE CHEIE

- ${suprafata ? `${suprafata} mp utili` : "suprafață eficientă"}
- ${compartimentare}
- vizibilitate comercială foarte bună
- acces facil pentru clienți și aprovizionare
- disponibil imediat

━━━━━━━━━━━━━━━━━━

🛠️ SPAȚIUL

- ${camere || "1"} încăperi
- ${bai} băi
- etaj ${etaj}

━━━━━━━━━━━━━━━━━━

📍 LOCAȚIE & ACCES

Situat în ${zone || "București"}, cu acces rapid către:

- transport public
- zone office & comerciale
- artere principale

━━━━━━━━━━━━━━━━━━

💼 CONDIȚII ${transLabel}

- ${isRent ? `chirie: ${price || "N/A"}` : `preț: ${price || "N/A"}`}
${isRent ? "- garanție: 1 lună\n" : ""}- disponibilitate: imediată

━━━━━━━━━━━━━━━━━━

🤝 SUPORT ${transLabel}

- consultanță dedicată din partea agenției brokr
- suport negociere și contractare
- analiză compatibilitate activitate
- posibilitate de vizionare rapidă și flexibilă

📞 Pentru vizionare sau detalii suplimentare, contactează-ne telefonic.`;
  }

  return `📌 ID ${idStr}
🏡 ${title}

${suprafata ? `${suprafata} mp utili, ` : ""}proprietate situată în zona ${zone || "București"}, disponibilă imediat.
Spațiul este luminos, bine compartimentat și oferă acces facil către toate punctele de interes din oraș.

━━━━━━━━━━━━━━━━━━

⭐ AVANTAJE PRINCIPALE

-${compartimentare}
-poziționare excelentă în zona ${zone || "București"}
-lumină naturală generoasă și compartimentare eficientă
-acces rapid la mijloacele de transport în comun

━━━━━━━━━━━━━━━━━━

🛋️ DOTĂRI

-centrală proprie
-finisaje moderne și spații optime de depozitare

━━━━━━━━━━━━━━━━━━

📍 LOCAȚIE

Acces rapid către:
-stații de transport în comun
-magazine, supermarketuri și servicii de proximitate
-parcuri și spații verzi în zonă

━━━━━━━━━━━━━━━━━━

💰 ${transLabel}

${isRent ? `${price || "N/A"}\n1 lună garanție\nComision 50% + TVA\nDisponibil imediat` : `${price || "N/A"}\nDisponibil imediat`}

━━━━━━━━━━━━━━━━━━

🤝 SUPORT ${transLabel}

-consultanță dedicată din partea agenției brokr
-asistență completă în întocmirea contractului și înregistrarea ANAF
-posibilitate de vizionare rapidă și flexibilă

📞 Pentru vizionare sau detalii suplimentare, contactează-ne telefonic.`;
}

function syncTitleInsideDescription(description: string, title: string): string {
  if (!description || !title) return description;
  return description.replace(/^((?:📌[^\n]*\n)?(?:🏡|🏢)\s*).+$/m, `$1${title}`);
}

/**
 * Applies the agency's Title Automation Rules and Description Rules.
 * Invoked ONLY when transforming a lead into:
 * - Proprietăți (property)
 * - Cereri (cerere)
 * - Lista Mea (my_list)
 */
export async function applyLeadTitleAndDescriptionRules(params: {
  lead: Partial<Lead>;
  targetKind: LeadTransformTarget;
  propertyId?: string;
}): Promise<ApplyLeadContentRulesResult> {
  const { lead, targetKind, propertyId } = params;
  const extracted = (lead.extractedData || {}) as any;
  const crmData = extracted?.crmData || null;

  const category = lead.categoria || crmData?.detaliiGenerale?.categoria || "Apartament";
  const transactionType = lead.transactionType || crmData?.detaliiGenerale?.tranzactie || "Vânzare";
  const oras = crmData?.detaliiGenerale?.localizare?.oras || "București";
  const price = lead.price || crmData?.pret?.detalii?.pret || "";
  const specs = crmData?.caracteristici || {};
  const utilitati = crmData?.utilitati || {};

  const sourceTitle = String(
    extracted?.crawledOriginalTitle ||
      extracted?.originalTitle ||
      extracted?.olxMeta?.originalTitle ||
      lead.title ||
      crmData?.descriere?.titlu ||
      ""
  ).trim();

  const sourceDescription = String(
    extracted?.crawledOriginalDescription ||
      extracted?.originalDescription ||
      lead.notes ||
      crmData?.descriere?.continut ||
      ""
  ).trim();

  // Resolve real zone strictly from verified structured location or the original ad text —
  // never propagate a previously false-matched area that does not belong to the listing.
  const rawZoneVal = crmData?.detaliiGenerale?.localizare?.zona || lead.zone || "";
  const rawZoneStr = Array.isArray(rawZoneVal)
    ? String(rawZoneVal[0] || "").trim()
    : String(rawZoneVal || "").trim();

  const areaFromOriginalAd =
    findAreaInText(sourceTitle, { strict: true }) ||
    findAreaInText(sourceDescription, { strict: true }) ||
    "";

  // If the stored zone is a real neighborhood, keep it ONLY if either:
  // (a) the original ad has no conflicting area and the stored zone wasn't a false-positive match, or
  // (b) it matches the original ad / was explicitly entered on a manual lead (no external crawl URL).
  const isCrawledListing = Boolean(lead.url && /^https?:\/\//i.test(lead.url));
  let verifiedZone = "";
  if (areaFromOriginalAd) {
    verifiedZone = areaFromOriginalAd;
  } else if (hasRealNeighborhoodArea(rawZoneStr)) {
    if (!isCrawledListing) {
      verifiedZone = rawZoneStr;
    } else {
      // For crawled ads, verify the stored zone actually appears in the original ad text or URL slug
      // (or came from a structured OLX/Storia district field that isn't a common-word false positive).
      const rawZoneNorm = rawZoneStr
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
      const origCombinedNorm = `${sourceTitle} ${sourceDescription} ${lead.url || ""}`
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      if (rawZoneNorm && origCombinedNorm.includes(rawZoneNorm)) {
        verifiedZone = rawZoneStr;
      }
    }
  }

  const displayZone = verifiedZone || (hasRealNeighborhoodArea(rawZoneStr) && !isCrawledListing ? rawZoneStr : "");

  // Build a clean automationSource strictly from verified structured fields and the real original ad copy.
  // Never spread stale/polluted `extracted.automationSource` (which may carry old full-page HTML text or bogus stations).
  const extractedLeadInput = extractTitleInputFromLead(lead, {
    transactionType,
    categoria: category,
    zona: verifiedZone,
    oras,
    propertyId: propertyId || lead.propertyId || "",
    rawTitle: sourceTitle,
    rawText: sourceDescription || sourceTitle,
  });
  const automationSource = {
    ...extractedLeadInput,
    compartimentare: specs?.detalii?.compartimentare || lead.compartimentare || "",
    sistemIncalzire: Array.isArray(utilitati?.sistemIncalzire)
      ? utilitati.sistemIncalzire.join(", ")
      : lead.sursaIncalzire || "",
    balcoane: specs?.detalii?.balcoane || "",
  };

  let titleRule = automationSettingsService.getCachedTitleRule();
  try {
    const freshRecord = await automationSettingsService.fetchTitleRule();
    if (freshRecord?.titleRule) {
      titleRule = freshRecord.titleRule;
    }
  } catch {
    // Use cached rule if fetch fails
  }

  const ruleTitle =
    titleRule?.enabled
      ? buildTitleFromAutomationRule(titleRule, automationSource)
      : "";

  const standardFallbackTitle =
    ruleTitle ||
    generateStandardAdTitle({
      ...automationSource,
      titleRule,
    }) ||
    sourceTitle;

  let formattedTitle = standardFallbackTitle;
  let formattedDescription = buildLocalFallbackDescription({
    title: formattedTitle,
    category,
    transactionType,
    zone: displayZone || oras,
    price,
    specs,
    propertyId: propertyId || lead.propertyId || "",
  });

  try {
    const aiHeaders = await getApiAuthHeaders({ "Content-Type": "application/json" });
    const aiRes = await fetch("/api/generate-ai-text", {
      method: "POST",
      headers: aiHeaders,
      body: JSON.stringify({
        category,
        transactionType,
        zone: displayZone,
        price,
        specs,
        originalTitle: sourceTitle,
        originalDescription: sourceDescription,
        propertyId: propertyId || lead.propertyId || "",
        targetKind,
        forcedTitle: ruleTitle || undefined,
      }),
    });
    if (aiRes.ok) {
      const aiJson = await aiRes.json();
      if (ruleTitle) {
        formattedTitle = ruleTitle;
      } else if (aiJson?.title && typeof aiJson.title === "string") {
        formattedTitle = aiJson.title.trim();
      }
      if (aiJson?.description && typeof aiJson.description === "string") {
        formattedDescription = syncTitleInsideDescription(aiJson.description.trim(), formattedTitle);
      }
    }
  } catch (err) {
    console.warn(`[applyLeadTitleAndDescriptionRules] AI formatting fallback (${targetKind}):`, err);
  }

  formattedDescription = syncTitleInsideDescription(formattedDescription, formattedTitle);

  const existingCriteria =
    (lead.criteriiFormular && typeof lead.criteriiFormular === "object" ? lead.criteriiFormular : null) ||
    (crmData?.criteriiFormular && typeof crmData.criteriiFormular === "object" ? crmData.criteriiFormular : null);
  const syncedCriteria = existingCriteria
    ? {
        ...existingCriteria,
        propertyTitle: formattedTitle,
        requirements: formattedDescription,
      }
    : undefined;

  const updatedCrmData = crmData
    ? {
        ...crmData,
        ...(syncedCriteria ? { criteriiFormular: syncedCriteria } : {}),
        descriere: {
          disponibilitate: crmData.descriere?.disponibilitate || "",
          video: crmData.descriere?.video || "",
          turVirtual: crmData.descriere?.turVirtual || "",
          ...(crmData.descriere || {}),
          titlu: formattedTitle,
          continut: formattedDescription,
        },
      }
    : null;

  const updatedExtractedData = {
    ...extracted,
    ...(updatedCrmData ? { crmData: updatedCrmData } : {}),
    ...(extracted?.presentationSections
      ? {
          presentationSections: {
            ...extracted.presentationSections,
            introducere: {
              ...(extracted.presentationSections.introducere || {}),
              titlu: formattedTitle,
              summary: formattedDescription,
            },
          },
        }
      : {}),
    automationSource,
    crawledOriginalTitle: extracted?.crawledOriginalTitle || sourceTitle,
    crawledOriginalDescription: extracted?.crawledOriginalDescription || sourceDescription,
    originalTitle: sourceTitle,
    originalDescription: sourceDescription,
    markdownMarketing: formattedDescription,
    summary: formattedDescription.substring(0, 300),
  };

  return {
    formattedTitle,
    formattedDescription,
    updatedCrmData,
    updatedExtractedData,
  };
}
