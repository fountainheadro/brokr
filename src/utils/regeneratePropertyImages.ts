import { Lead, leadsService } from "../services/leadsService";
import { publishPublicShareSnapshot } from "../services/publicShareService";
import { getApiAuthHeaders } from "../lib/apiAuth";
import { getCleanDisplayImageUrl } from "./imageUtils";

export interface RegeneratePropertyImagesResult {
  regenVersion: string;
  totalCount: number;
  processedCount: number;
  inpaintedCount: number;
  failedCount: number;
  images: string[];
  coverImage: string;
}

const CRM_IMAGE_CATEGORIES = ["living", "camera", "bucatarie", "baie", "alteSpatii"] as const;

function stripDisplayWidthParam(urlStr: string): string {
  if (!urlStr || typeof urlStr !== "string") return "";
  const trimmed = urlStr.trim();
  if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("blob:")) return trimmed;
  const qIndex = trimmed.indexOf("?");
  if (qIndex === -1) return trimmed;
  const base = trimmed.slice(0, qIndex);
  const params = new URLSearchParams(trimmed.slice(qIndex + 1));
  params.delete("w");
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * Calls POST /api/properties/regenerate-images to re-process ALL images of a property
 * with aggressive watermark detection + inpainting, persists updated URLs to Firestore,
 * refreshes the public share snapshot, and notifies the parent component immediately.
 */
export async function regeneratePropertyImages(params: {
  lead: Lead;
  currentImages: string[];
  tenantId?: string;
  onUpdateLead?: (updatedData: Partial<Lead>) => void;
}): Promise<RegeneratePropertyImagesResult> {
  const { lead, currentImages, tenantId, onUpdateLead } = params;
  if (!lead?.id) {
    throw new Error("ID-ul proprietății lipsește.");
  }

  const normalizedList = Array.from(
    new Set(
      currentImages
        .map((u) => stripDisplayWidthParam(u))
        .filter((u) => typeof u === "string" && u.length > 0)
    )
  );

  if (normalizedList.length === 0) {
    throw new Error("Nu există fotografii disponibile pentru regenerare.");
  }

  const normalizedCover = lead.coverImage ? stripDisplayWidthParam(getCleanDisplayImageUrl(lead.coverImage) || lead.coverImage) : normalizedList[0];

  const headers = await getApiAuthHeaders({ "Content-Type": "application/json" });
  const response = await fetch("/api/properties/regenerate-images", {
    method: "POST",
    headers,
    body: JSON.stringify({
      propertyId: lead.id,
      images: normalizedList,
      coverImage: normalizedCover,
    }),
  });

  if (!response.ok) {
    const errPayload = await response.json().catch(() => ({}));
    const msg =
      errPayload?.error?.message ||
      (typeof errPayload?.error === "string" ? errPayload.error : "") ||
      `Regenerarea imaginilor a eșuat (HTTP ${response.status}).`;
    throw new Error(msg);
  }

  const payload = await response.json();
  const data = payload?.data || payload;
  const regeneratedImages: string[] = Array.isArray(data?.images) && data.images.length > 0
    ? data.images
    : normalizedList;
  const regeneratedCover: string =
    typeof data?.coverImage === "string" && data.coverImage.trim()
      ? data.coverImage.trim()
      : regeneratedImages[0] || "";
  const urlMap: Record<string, string> = data?.urlMap && typeof data.urlMap === "object" ? data.urlMap : {};

  const mapUrl = (raw: string): string => {
    if (!raw || typeof raw !== "string") return raw;
    const cleaned = stripDisplayWidthParam(getCleanDisplayImageUrl(raw) || raw);
    return urlMap[raw] || urlMap[cleaned] || cleaned;
  };

  // Remap all categories in extractedData.crmData.imagini so every gallery view reflects regenerated URLs
  const existingCrmImagini = lead.extractedData?.crmData?.imagini;
  let updatedCrmImagini: any = undefined;
  if (existingCrmImagini && typeof existingCrmImagini === "object") {
    updatedCrmImagini = { ...existingCrmImagini };
    const seenInCategories = new Set<string>();
    for (const cat of CRM_IMAGE_CATEGORIES) {
      if (Array.isArray(existingCrmImagini[cat])) {
        updatedCrmImagini[cat] = existingCrmImagini[cat].map((item: any) => {
          if (typeof item === "string") {
            const mapped = mapUrl(item);
            if (mapped) seenInCategories.add(mapped);
            return mapped;
          }
          if (item && typeof item === "object" && typeof item.original === "string") {
            const mapped = mapUrl(item.original);
            if (mapped) seenInCategories.add(mapped);
            return { ...item, original: mapped };
          }
          return item;
        });
      } else {
        updatedCrmImagini[cat] = [];
      }
    }

    // Ensure every regenerated image exists in at least one category
    for (const img of regeneratedImages) {
      if (!seenInCategories.has(img)) {
        updatedCrmImagini.alteSpatii = [...(updatedCrmImagini.alteSpatii || []), { original: img }];
        seenInCategories.add(img);
      }
    }
  }

  const firestoreUpdates: Record<string, any> = {
    coverImage: regeneratedCover,
    images: regeneratedImages,
  };
  if (updatedCrmImagini) {
    firestoreUpdates["extractedData.crmData.imagini"] = updatedCrmImagini;
  }

  await leadsService.updateLeadData(lead.id, firestoreUpdates);

  const nextExtractedData = updatedCrmImagini
    ? {
        ...lead.extractedData,
        crmData: {
          ...(lead.extractedData?.crmData as any),
          imagini: updatedCrmImagini,
        },
      }
    : lead.extractedData;

  const partialLeadUpdate: Partial<Lead> = {
    coverImage: regeneratedCover,
    images: regeneratedImages,
    ...(nextExtractedData ? { extractedData: nextExtractedData as any } : {}),
  };

  onUpdateLead?.(partialLeadUpdate);

  // Refresh public share snapshot so shared links immediately display the regenerated watermark-free images
  try {
    await publishPublicShareSnapshot(
      {
        ...lead,
        ...partialLeadUpdate,
      },
      { tenantId, force: true }
    );
  } catch {
    // Non-blocking: Firestore property record is already updated
  }

  return {
    regenVersion: String(data?.regenVersion || Date.now()),
    totalCount: Number(data?.totalCount ?? regeneratedImages.length),
    processedCount: Number(data?.processedCount ?? regeneratedImages.length),
    inpaintedCount: Number(data?.inpaintedCount ?? 0),
    failedCount: Number(data?.failedCount ?? 0),
    images: regeneratedImages,
    coverImage: regeneratedCover,
  };
}
