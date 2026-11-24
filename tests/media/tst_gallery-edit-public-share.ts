import assert from "node:assert/strict";
import {
  extractOrderedPublicImageUrls,
  getImageIdentityKey,
  normalizeStoredImageUrl,
} from "../../src/utils/publicContentUtils";
import { sanitizePublicProperty } from "../../server/security/sec_public-sanitizer";
import {
  createPublicImageToken,
  verifyPublicImageToken,
  applyPublicImageProtections,
} from "../../server/security/sec_public-media";
import { MediaPipelineService } from "../../server/media/svc_media-pipeline";
import { CloudStorageService } from "../../src/core/storage/svc_cloud-storage";
import { StorageMetadataRepository } from "../../src/core/storage/repo_storage-metadata";

// Minimal valid 1x1 PNG binary
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

// Distinct second valid 1x1 PNG (different pixel color -> different content hash)
const TINY_PNG_2 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

async function main() {
  process.env.NODE_ENV = "test";
  console.log("=== Gallery Edit -> External Share Page End-to-End Verification ===");

  // 1. Upload two distinct photos via MediaPipelineService (same path as POST /api/upload-photo)
  const tenantId = "tenant_gallery_test";
  const propertyId = "P901";

  const uploaded1 = await MediaPipelineService.storePropertyPhotoWithVariants({
    tenantId,
    propertyId,
    buffer: TINY_PNG,
    mimeType: "image/png",
    ext: "png",
    originalFileName: "living_upload.png",
    uploadedByUserId: "agent_test_1",
  });

  const uploaded2 = await MediaPipelineService.storePropertyPhotoWithVariants({
    tenantId,
    propertyId,
    buffer: TINY_PNG_2,
    mimeType: "image/png",
    ext: "png",
    originalFileName: "kitchen_upload.png",
    uploadedByUserId: "agent_test_1",
  });

  assert.ok(
    uploaded1.url.startsWith(`/api/storage/media/tenants/${tenantId}/properties/${propertyId}/`),
    `Expected storage media URL, got: ${uploaded1.url}`
  );
  assert.notEqual(uploaded1.url, uploaded2.url, "Distinct uploads must have distinct content-hashed URLs");
  console.log("  [PASS] 1. Photo upload produces content-hashed /api/storage/media/... URLs");

  // 2. Simulate gallery edit: original external photos [A, B, C] -> delete B, shuffle [C, A], append uploaded1 & uploaded2
  const extA = "https://cdn.example.com/photos/room-a.jpg";
  const extBDeleted = "https://cdn.example.com/photos/room-b-deleted.jpg";
  const extC = "https://cdn.example.com/photos/room-c.jpg";

  // Simulate what PropertyDetailView / LeadCerereDetailPage have in draft (proxied external URLs + newly uploaded URLs)
  const draftAfterShuffleDeleteUpload = [
    `/api/proxy-image?url=${encodeURIComponent(extC)}&w=720`,
    uploaded2.url,
    `/api/proxy-image?url=${encodeURIComponent(extA)}`,
    uploaded1.url,
  ];

  const savedImages = draftAfterShuffleDeleteUpload.map((u) => normalizeStoredImageUrl(u));
  assert.deepEqual(
    savedImages,
    [extC, uploaded2.url, extA, uploaded1.url],
    "Stored gallery URLs should unwrap plain proxy wrappers and preserve exact shuffled order"
  );

  // Even when crmData.imagini keeps old category buckets (living: [A], camera: [C], alteSpatii: [uploaded1, uploaded2]),
  // extractOrderedPublicImageUrls MUST strictly respect savedImages order and exclude deleted extB!
  const editedLead = {
    id: "doc_p901",
    propertyId,
    title: "Apartament 3 camere Herăstrău",
    status: "Noua",
    coverImage: savedImages[0],
    images: savedImages,
    extractedData: {
      crmData: {
        imagini: {
          living: [{ original: extA }],
          camera: [{ original: extC }],
          bucatarie: [],
          baie: [],
          alteSpatii: [{ original: uploaded1.url }, { original: uploaded2.url }],
        },
      },
    },
  };

  const orderedForShare = extractOrderedPublicImageUrls(editedLead);
  assert.deepEqual(
    orderedForShare,
    [extC, uploaded2.url, extA, uploaded1.url],
    "External share image order MUST match exact user-shuffled order, NOT old crmData.imagini category order"
  );
  assert.ok(!orderedForShare.includes(extBDeleted), "Deleted photo must never appear in external share");
  console.log("  [PASS] 2. Shuffled order preserved, deleted photo excluded, uploaded photos included");

  // 3. Simulate /api/public-property/:id tokenization with deduplication across raw vs proxied URLs
  const tokenMap = new Map<string, string>();
  const tokenizeImageUrl = (rawUrl: string): string => {
    const normalizedSource = normalizeStoredImageUrl(rawUrl) || rawUrl.trim();
    const dedupKey = getImageIdentityKey(normalizedSource) || normalizedSource;
    const existing = tokenMap.get(dedupKey);
    if (existing) return existing;
    const token = createPublicImageToken({
      sourceUrl: normalizedSource,
      propertyId,
      viewerSid: "test-sid",
      viewerStamp: "TEST-0000",
      ttlMs: 60_000,
    });
    const tokenized = `/api/public-image?token=${encodeURIComponent(token)}`;
    tokenMap.set(dedupKey, tokenized);
    return tokenized;
  };

  // Intentionally mix a proxied URL in images with a raw URL in crmData.imagini to verify zero duplicate tokens
  const mixedLead = {
    ...editedLead,
    images: [
      `/api/proxy-image?url=${encodeURIComponent(extC)}`,
      uploaded2.url,
      `/api/proxy-image?url=${encodeURIComponent(extA)}`,
      uploaded1.url,
    ],
  };

  const sanitized = sanitizePublicProperty(mixedLead, { tokenizeImageUrl });
  const publicOrdered = extractOrderedPublicImageUrls(sanitized);
  assert.equal(publicOrdered.length, 4, "Mixed proxied/raw URLs must deduplicate to exactly 4 unique tokenized URLs");
  assert.equal(sanitized.coverImage, publicOrdered[0], "Cover image token must match first gallery photo");
  assert.equal(
    sanitized.extractedData?.crmData?.imagini?.camera?.[0]?.original,
    publicOrdered[0],
    "Token for crmData.imagini.camera[0] must equal token for shuffled images[0]"
  );
  console.log("  [PASS] 3. /api/public-property tokenization deduplicates cleanly with exact order");

  // 4. Verify uploaded photos resolve through /api/public-image decoding + CloudStorageService.downloadObject
  //    BOTH with warm metadata AND after cold restart (empty StorageMetadataRepository)!
  const uploaded2TokenUrl = publicOrdered[1];
  const tokenParam = new URL(uploaded2TokenUrl, "http://localhost").searchParams.get("token")!;
  const verified = verifyPublicImageToken(tokenParam);
  assert.equal(verified.valid, true, "Public image token must verify");
  if (!verified.valid) throw new Error("Unreachable");

  const resolvedObjKey = verified.payload.u
    .replace(/^\/api\/storage\/media\//, "")
    .split("?")[0]
    .split("/")
    .map((s) => decodeURIComponent(s))
    .join("/");

  // 4a. Warm metadata load
  const warmDl = await CloudStorageService.downloadObject({
    objectKey: resolvedObjKey,
    allowPublicListing: true,
  });
  assert.ok(warmDl.buffer.length > 0, "Warm download must return image bytes");

  const protectedOut = await applyPublicImageProtections(warmDl.buffer, {
    cacheKey: verified.payload.u,
    propertyCode: propertyId,
    viewerStamp: "TEST-0000",
    maxWidth: 800,
    preferWebp: false,
  });
  assert.ok(protectedOut.buffer.length > 0, "Protected public image buffer must be non-empty");
  assert.ok(protectedOut.mimeType.startsWith("image/"), "Protected output must be an image MIME type");

  // 4b. Cold container / multi-instance restart simulation (metadata cache wiped, object still in storage)
  StorageMetadataRepository.clearAll();
  const coldDl = await CloudStorageService.downloadObject({
    objectKey: resolvedObjKey,
    allowPublicListing: true,
  });
  assert.ok(coldDl.buffer.length > 0, "Cold multi-instance fallback must still load public property images");
  assert.equal(coldDl.metadata.mimeType, "image/png", "Fallback must verify magic bytes and detect PNG MIME");

  // 4b2. Cross-container / cross-domain simulation (DIFFERENT container: local disk file + RAM cache + metadata ALL missing!)
  // Must seamlessly recover the uploaded image from shared Firestore `public_property_media`.
  const fsMod = await import("node:fs");
  const pathMod = await import("node:path");
  const localObjPath = pathMod.resolve(CloudStorageService.getLocalStorageRoot(), resolvedObjKey);
  if (fsMod.existsSync(localObjPath)) {
    fsMod.unlinkSync(localObjPath);
  }
  CloudStorageService.clearPublicMediaFallbackCacheForTests();
  StorageMetadataRepository.clearAll();
  const crossContainerDl = await CloudStorageService.downloadObject({
    objectKey: resolvedObjKey,
    allowPublicListing: true,
  });
  assert.ok(
    crossContainerDl.buffer.length > 0,
    "Cross-container fallback MUST load uploaded property photo from shared Firestore even when local container disk has no file"
  );
  assert.equal(
    crossContainerDl.metadata.mimeType,
    "image/png",
    "Cross-container fallback must validate image magic bytes"
  );

  // 4c. Security check: private tenant documents MUST NEVER be accessible via allowPublicListing fallback
  let docBlocked = false;
  try {
    await CloudStorageService.downloadObject({
      objectKey: `tenants/${tenantId}/documents/doc1/secret.pdf`,
      allowPublicListing: true,
    });
  } catch {
    docBlocked = true;
  }
  assert.equal(docBlocked, true, "Private tenant documents must ALWAYS be rejected under allowPublicListing");
  console.log("  [PASS] 4. Uploaded photos serve via public image pipeline (warm + cold + cross-container Firestore fallback) & private docs stay blocked");

  // 5. Verify deleting ALL photos yields an empty gallery (never resurrects stale crmData.imagini)
  const emptiedLead = {
    ...editedLead,
    coverImage: "",
    images: [],
  };
  assert.deepEqual(
    extractOrderedPublicImageUrls(emptiedLead),
    [],
    "Deleting all photos (images: [], coverImage: '') must produce an empty external share gallery"
  );
  console.log("  [PASS] 5. Deleting all photos cleanly clears external share gallery");

  console.log("=== ALL 5 GALLERY -> EXTERNAL SHARE CHECKS PASSED ===");
}

main().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
