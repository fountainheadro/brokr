import { doc, setDoc } from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import {
  detectShareEntityKind,
  resolveShareCode,
  type ShareEntityKind,
} from "../utils/shareUtils";
import {
  extractOrderedPublicImageUrls,
  getImageIdentityKey,
  normalizeStoredImageUrl,
  resolvePublicDisplayDescription,
  resolvePublicDisplayTitle,
  shouldUseModifiedAdContent,
} from "../utils/publicContentUtils";
import { isSummaryLeadRecord } from "../core/crm/svc_lead-projection";
import type { Lead } from "./leadsService";

export const PUBLIC_SHARES_COLLECTION = "public_shares";

const SENSITIVE_LOCATION_KEYS = new Set([
  "strada",
  "numar",
  "bloc",
  "scara",
  "apartament",
  "adresa",
  "adresaCompleta",
  "address",
  "street",
  "streetNumber",
  "lat",
  "lng",
  "latitude",
  "longitude",
  "coordonate",
  "coordinates",
  "codPostal",
]);

function clampStr(val: unknown, maxLen: number): string | undefined {
  if (val === null || val === undefined) return undefined;
  const s = String(val).trim();
  if (!s) return undefined;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function stripUndefinedDeep<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value
      .filter((v) => v !== undefined)
      .map((v) => stripUndefinedDeep(v)) as unknown as T;
  }
  if (typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value as Record<string, any>)) {
      if (v !== undefined) {
        out[k] = stripUndefinedDeep(v);
      }
    }
    return out as T;
  }
  return value;
}

function sanitizeExtractedDataForPublicShare(
  rawExtracted: any,
  lead?: Partial<Lead> | null
): Record<string, any> | undefined {
  const hasRaw = rawExtracted && typeof rawExtracted === "object";
  const cloned: Record<string, any> = hasRaw ? JSON.parse(JSON.stringify(rawExtracted)) : {};
  delete cloned.url;
  delete cloned.sourceUrl;
  delete cloned.rawHtml;
  delete cloned.ownerPhone;
  delete cloned.ownerName;

  if (cloned.crmData && typeof cloned.crmData === "object") {
    const dg = cloned.crmData.detaliiGenerale;
    if (dg && typeof dg === "object") {
      delete dg.contacteAditionale;
      delete dg.proprietar;
      delete dg.owner;
      delete dg.telefon;
      delete dg.phone;
      delete dg.email;
      if (dg.localizare && typeof dg.localizare === "object") {
        for (const key of Object.keys(dg.localizare)) {
          if (SENSITIVE_LOCATION_KEYS.has(key)) {
            delete dg.localizare[key];
          }
        }
      }
    }
    delete cloned.crmData.contact;
    delete cloned.crmData.proprietar;
    delete cloned.crmData.owner;
  }

  // Ensure description and price are synchronized on the public snapshot for OpenGraph & shared page rendering
  // without leaking top-level `notes` or owner PII.
  if (lead) {
    const rawLead = lead as Record<string, any>;
    const topPrice = typeof rawLead.price === "string" ? rawLead.price.trim() : "";
    if (topPrice && topPrice !== "-" && topPrice.toUpperCase() !== "N/A") {
      if (cloned.crmData && typeof cloned.crmData === "object") {
        cloned.crmData.pret = {
          ...(cloned.crmData.pret && typeof cloned.crmData.pret === "object" ? cloned.crmData.pret : {}),
          detalii: {
            ...(cloned.crmData.pret?.detalii && typeof cloned.crmData.pret.detalii === "object"
              ? cloned.crmData.pret.detalii
              : {}),
            pret: topPrice,
          },
        };
      }
      if (cloned.presentationSections?.tranzactie && typeof cloned.presentationSections.tranzactie === "object") {
        cloned.presentationSections.tranzactie = {
          ...cloned.presentationSections.tranzactie,
          "Preț": topPrice,
        };
      }
    }

    const existingOrigDesc =
      typeof cloned.originalDescription === "string" ? cloned.originalDescription.trim() : "";
    if (!existingOrigDesc) {
      const fallbackOrigDesc =
        (typeof rawLead.originalDescription === "string" && rawLead.originalDescription.trim()) ||
        (typeof rawLead.description === "string" && rawLead.description.trim()) ||
        (typeof rawLead.rawDescription === "string" && rawLead.rawDescription.trim()) ||
        (!shouldUseModifiedAdContent(rawLead) && typeof rawLead.notes === "string"
          ? rawLead.notes.trim()
          : "");
      if (fallbackOrigDesc) {
        cloned.originalDescription = fallbackOrigDesc;
      }
    }
    // Keep crmData.imagini synchronized with the explicit sanitized gallery so deleted photos
    // or raw data: URLs never linger in public_shares snapshots.
    if (cloned.crmData && typeof cloned.crmData === "object" && cloned.crmData.imagini && typeof cloned.crmData.imagini === "object") {
      const categories = ["living", "camera", "bucatarie", "baie", "alteSpatii"] as const;
      const hasExplicitImages = Array.isArray(rawLead.images);
      const allowedIds = hasExplicitImages
        ? new Set(
            rawLead.images
              .map((item: unknown) => normalizeStoredImageUrl(item))
              .filter((u: string) => Boolean(u && !u.startsWith("data:") && !u.startsWith("blob:")))
              .map((u: string) => getImageIdentityKey(u))
              .filter(Boolean)
          )
        : null;

      for (const cat of categories) {
        const list = cloned.crmData.imagini[cat];
        if (!Array.isArray(list)) continue;
        cloned.crmData.imagini[cat] = list
          .map((item: any) => {
            const rawUrl = typeof item === "string" ? item : item?.original;
            const norm = normalizeStoredImageUrl(rawUrl);
            if (!norm || norm.startsWith("data:") || norm.startsWith("blob:")) return null;
            if (allowedIds !== null && !allowedIds.has(getImageIdentityKey(norm))) return null;
            return typeof item === "string" ? norm : { ...item, original: norm };
          })
          .filter(Boolean);
      }
    }
  }

  if (Object.keys(cloned).length === 0) return undefined;
  return stripUndefinedDeep(cloned);
}

function toIsoString(raw: any): string {
  if (!raw) return new Date().toISOString();
  if (typeof raw === "string") return raw.slice(0, 64);
  if (typeof raw?.toDate === "function") {
    try {
      return raw.toDate().toISOString();
    } catch {
      return new Date().toISOString();
    }
  }
  if (raw instanceof Date) return raw.toISOString();
  if (typeof raw === "number") return new Date(raw).toISOString();
  return new Date().toISOString();
}

export function buildPublicShareDocId(
  shareCode: string,
  entityKind: ShareEntityKind,
  tenantId?: string | null
): string {
  const cleanCode = String(shareCode || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "");
  if (!cleanCode) return "";

  if (entityKind === "lead") {
    return `global__${cleanCode}`.slice(0, 128);
  }

  const cleanTenant = String(tenantId || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "");
  const prefix = cleanTenant || "global";
  return `${prefix}__${cleanCode}`.slice(0, 128);
}

const publishedFingerprintCache = new Map<string, string>();

/**
 * Publishes a strictly sanitized, PII-free public share snapshot to Firestore `public_shares/{shareId}`.
 * This guarantees `/share/L32`, `/share/P12`, `/share/C12` resolve reliably on any host/server
 * without exposing owner PII or requiring server-side Firebase Admin credentials.
 */
export async function publishPublicShareSnapshot(
  lead: Partial<Lead> | null | undefined,
  options?: { tenantId?: string | null; force?: boolean }
): Promise<boolean> {
  if (!lead || !auth.currentUser) return false;
  // Never overwrite an existing full public_shares snapshot with a slim summary projection
  // that intentionally omits `images[]` and `extractedData`.
  if (isSummaryLeadRecord(lead)) return false;

  const shareCode = resolveShareCode(lead);
  if (!shareCode || !/^[a-zA-Z0-9_-]{1,64}$/.test(shareCode)) {
    return false;
  }

  const entityKind = detectShareEntityKind(lead);
  const docId = buildPublicShareDocId(shareCode, entityKind, options?.tenantId);
  if (!docId || !/^[a-zA-Z0-9_-]{1,128}$/.test(docId)) {
    return false;
  }

  const title =
    clampStr(
      resolvePublicDisplayTitle(lead, "") ||
        lead.title ||
        lead.extractedData?.crmData?.descriere?.titlu ||
        `Proprietate #${shareCode}`,
      500
    ) || `Proprietate #${shareCode}`;
  const isShareableImageUrl = (u: string): boolean =>
    Boolean(u && !u.startsWith("data:") && !u.startsWith("blob:") && u.length <= 2048);

  const sanitizedImages: string[] | undefined = Array.isArray(lead.images)
    ? Array.from(
        new Map(
          lead.images
            .map((item) => normalizeStoredImageUrl(item))
            .filter(isShareableImageUrl)
            .map((u) => [getImageIdentityKey(u) || u, u] as const)
        ).values()
      ).slice(0, 100)
    : undefined;

  const orderedPublicImages = extractOrderedPublicImageUrls(lead)
    .map((u) => normalizeStoredImageUrl(u))
    .filter(isShareableImageUrl);

  const rawCoverCandidate = normalizeStoredImageUrl(lead.coverImage);
  const effectiveCoverImage =
    sanitizedImages !== undefined
      ? sanitizedImages.length === 0
        ? ""
        : isShareableImageUrl(rawCoverCandidate) &&
            sanitizedImages.some((u) => getImageIdentityKey(u) === getImageIdentityKey(rawCoverCandidate))
          ? rawCoverCandidate
          : sanitizedImages[0] || ""
      : isShareableImageUrl(rawCoverCandidate)
        ? rawCoverCandidate
        : orderedPublicImages[0] || "";

  const resolvedDesc = resolvePublicDisplayDescription(lead, "");
  const updatedAt = toIsoString(lead.updatedAt);

  const gallerySignature =
    sanitizedImages !== undefined
      ? sanitizedImages.join(",")
      : orderedPublicImages.join(",");
  const fingerprint = `${docId}|${title}|${effectiveCoverImage}|${gallerySignature}|${resolvedDesc.length}|${lead.price || ""}|${lead.zone || ""}|${lead.status || ""}|${updatedAt}`;
  if (!options?.force && publishedFingerprintCache.get(docId) === fingerprint) {
    return true;
  }

  const payload = stripUndefinedDeep({
    shareCode: shareCode.toUpperCase(),
    entityKind,
    tenantId: entityKind === "lead" ? undefined : clampStr(options?.tenantId, 128),
    propertyId: clampStr(lead.propertyId || shareCode, 64),
    sourceDocId: clampStr(lead.id, 128),
    title,
    zone: clampStr(lead.zone, 200),
    price: clampStr(lead.price, 100),
    transactionType: clampStr(lead.transactionType, 64),
    categoria: clampStr(lead.categoria, 100),
    status: clampStr(lead.status, 64),
    leadType: clampStr(lead.leadType, 64),
    mobilare: clampStr(lead.mobilare, 200),
    parcare: clampStr(lead.parcare, 200),
    sursaIncalzire: clampStr(lead.sursaIncalzire, 200),
    modIncalzire: clampStr(lead.modIncalzire, 200),
    coverImage: effectiveCoverImage.slice(0, 2048),
    images: sanitizedImages ?? orderedPublicImages.slice(0, 100),
    extractedData: sanitizeExtractedDataForPublicShare(lead.extractedData, lead),
    author: clampStr(lead.author, 200),
    agent: clampStr(lead.agent, 200),
    isPublicSnapshot: true,
    createdAt: toIsoString(lead.createdAt),
    updatedAt,
  });

  try {
    // Write complete sanitized snapshot without `{ merge: true }` so deleted photos
    // and cleared `coverImage` values overwrite stale Firestore fields cleanly.
    await setDoc(doc(db, PUBLIC_SHARES_COLLECTION, docId), payload);
    publishedFingerprintCache.set(docId, fingerprint);
    return true;
  } catch (err) {
    console.warn(`[publicShareService] Failed to publish public share snapshot ${docId}:`, err);
    return false;
  }
}

let batchSyncInFlight = false;

/**
 * Lazily ensures loaded shared leads (like L32) have a sanitized `public_shares/global__L32`
 * snapshot published in Firestore so public links work immediately without requiring a manual click first.
 */
export async function syncPublicShareSnapshotsBatch(
  leads: Array<Partial<Lead>>,
  options?: { tenantId?: string | null; maxPerRun?: number }
): Promise<void> {
  if (!auth.currentUser || batchSyncInFlight || !Array.isArray(leads) || leads.length === 0) {
    return;
  }
  batchSyncInFlight = true;
  try {
    const maxCount = options?.maxPerRun ?? 40;
    let processed = 0;
    for (const lead of leads) {
      if (processed >= maxCount) break;
      if (isSummaryLeadRecord(lead)) continue;
      const code = resolveShareCode(lead);
      if (!code || !/^[a-zA-Z0-9_-]{1,64}$/.test(code)) continue;
      const entityKind = detectShareEntityKind(lead);
      const docId = buildPublicShareDocId(code, entityKind, options?.tenantId);
      if (!docId || publishedFingerprintCache.has(docId)) continue;
      await publishPublicShareSnapshot(lead, { tenantId: options?.tenantId });
      processed++;
    }
  } finally {
    batchSyncInFlight = false;
  }
}
