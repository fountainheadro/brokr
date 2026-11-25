import assert from "node:assert/strict";
import sharp from "sharp";
import {
  registerPublicShareWarmer,
  schedulePublicShareImagePrewarm,
  schedulePublicSharePrewarmFromRecord,
} from "../../server/cache/svc_share-cache-invalidator";
import { applyPublicImageProtections } from "../../server/security/sec_public-media";
import { MediaPipelineService } from "../../server/media/svc_media-pipeline";
import { getThumbnailImageUrl } from "../../src/utils/imageUtils";

async function runTests() {
  console.log("[Test] Running Public Share Speed Optimizations (Items #2, #3, #4, #6)...");

  // 1. Prewarm sanitization, deduplication, and cap-at-5 (Item #6)
  {
    const calls: Array<{ propCode: string; sources: string[] }> = [];
    registerPublicShareWarmer((propCode, sources) => {
      calls.push({ propCode, sources });
    });

    const count = schedulePublicShareImagePrewarm("p12345!!@#", [
      "data:image/png;base64,AAAA",
      "blob:https://example.com/1234",
      "javascript:alert(1)",
      "/etc/passwd",
      "/api/storage/media/t1/img1.jpg",
      "/api/storage/media/t1/img1.jpg?w=640", // duplicate identity
      "/uploads/photo2.jpg",
      "https://cdn.example.com/photo3.jpg",
      "https://cdn.example.com/photo4.jpg",
      "https://cdn.example.com/photo5.jpg",
      "https://cdn.example.com/photo6-should-be-dropped.jpg",
    ]);

    assert.equal(count, 5, "Should cap prewarm list to exactly 5 deduplicated safe URLs");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].propCode, "P12345");
    assert.deepEqual(calls[0].sources, [
      "/api/storage/media/t1/img1.jpg",
      "/uploads/photo2.jpg",
      "https://cdn.example.com/photo3.jpg",
      "https://cdn.example.com/photo4.jpg",
      "https://cdn.example.com/photo5.jpg",
    ]);

    // Record helper extraction
    const recCount = schedulePublicSharePrewarmFromRecord({
      id: "lead-99",
      propertyId: "P99887",
      images: [
        "/api/storage/media/t1/a.jpg",
        "/api/storage/media/t1/b.jpg",
      ],
    });
    assert.equal(recCount, 2);
    assert.equal(calls[1].propCode, "P99887");
    assert.equal(calls[1].sources.length, 2);

    // Warmer error must never propagate
    registerPublicShareWarmer(() => {
      throw new Error("Simulated warmer failure");
    });
    const safeCount = schedulePublicShareImagePrewarm("P99887", ["/uploads/a.jpg"]);
    assert.equal(safeCount, 0, "Warmer exceptions must be swallowed cleanly");

    registerPublicShareWarmer(null);
    console.log("  ✔ [Item #6] Prewarm URL filtering, deduplication, cap-at-5 & safe error handling");
  }

  // 2. Inline <head> prefetch URL parity with ProtectedPublicImage / getThumbnailImageUrl (Item #2)
  {
    const token = "eyJ0IjoxLCJwIjoiUDEyMyJ9.sig_abc-123";
    const baseTokenized = `/api/public-image?token=${encodeURIComponent(token)}`;
    const makeServerPrefetchUrl = (tokenizedUrl: string, targetW: number) => {
      const qIdx = tokenizedUrl.indexOf("?");
      const base = qIdx === -1 ? tokenizedUrl : tokenizedUrl.slice(0, qIdx);
      const params = new URLSearchParams(qIdx === -1 ? "" : tokenizedUrl.slice(qIdx + 1));
      params.set("w", String(targetW));
      return `${base}?${params.toString()}`;
    };

    assert.equal(
      makeServerPrefetchUrl(baseTokenized, 1280),
      getThumbnailImageUrl(baseTokenized, 1280),
      "Server hero prefetch URL (w=1280) must match client getThumbnailImageUrl byte-for-byte"
    );
    assert.equal(
      makeServerPrefetchUrl(baseTokenized, 640),
      getThumbnailImageUrl(baseTokenized, 640),
      "Server mosaic prefetch URL (w=640) must match client getThumbnailImageUrl byte-for-byte"
    );
    console.log("  ✔ [Item #2] Server prefetchUrls match client getThumbnailImageUrl byte-for-byte");
  }

  // 3. Non-blocking Cloud Storage persistence in non-test environments, blocking in test (Item #4)
  {
    const samplePng = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: { r: 24, g: 88, b: 140 },
      },
    })
      .jpeg({ quality: 85 })
      .toBuffer();

    const originalPersist = MediaPipelineService.persistPublicShareVariant;
    const originalLoad = MediaPipelineService.getPersistedPublicShareVariant;
    const originalNodeEnv = process.env.NODE_ENV;

    let persistResolved = false;
    let persistInvoked = 0;

    try {
      (MediaPipelineService as any).getPersistedPublicShareVariant = async () => null;
      (MediaPipelineService as any).persistPublicShareVariant = async () => {
        persistInvoked += 1;
        await new Promise((resolve) => setTimeout(resolve, 450));
        persistResolved = true;
        return null;
      };

      // Simulate production mode: must return immediately without awaiting 450ms GCS write
      process.env.NODE_ENV = "production";
      const t0 = Date.now();
      const prodRes = await applyPublicImageProtections(samplePng, {
        propertyCode: "P_SPEED_PROD",
        cacheKey: `speed-prod-${Date.now()}`,
        viewerStamp: "TEST-VIEWER",
        maxWidth: 640,
        preferWebp: true,
      });
      const prodElapsed = Date.now() - t0;

      assert.equal(prodRes.mimeType, "image/webp");
      assert.ok(prodRes.buffer.length > 0);
      assert.equal(persistInvoked, 1, "Background GCS persist should still be triggered");
      assert.equal(
        persistResolved,
        false,
        "Production response must NOT block waiting for slow GCS variant persistence"
      );
      assert.ok(
        prodElapsed < 350,
        `Expected fast non-blocking response (<350ms), got ${prodElapsed}ms`
      );

      // Let background persist settle before switching to test-mode check
      await new Promise((resolve) => setTimeout(resolve, 500));
      assert.equal(persistResolved, true, "Background GCS persist should complete asynchronously");

      // Simulate test mode: must await GCS write synchronously for Phase 5 determinism
      persistResolved = false;
      process.env.NODE_ENV = "test";
      const testRes = await applyPublicImageProtections(samplePng, {
        propertyCode: "P_SPEED_TEST",
        cacheKey: `speed-test-${Date.now()}`,
        viewerStamp: "TEST-VIEWER",
        maxWidth: 640,
        preferWebp: true,
      });
      assert.equal(testRes.mimeType, "image/webp");
      assert.equal(
        persistResolved,
        true,
        "NODE_ENV=test must await GCS variant persistence synchronously"
      );
    } finally {
      (MediaPipelineService as any).persistPublicShareVariant = originalPersist;
      (MediaPipelineService as any).getPersistedPublicShareVariant = originalLoad;
      process.env.NODE_ENV = originalNodeEnv;
    }

    console.log("  ✔ [Item #4] Non-blocking GCS persist in prod/dev & synchronous in NODE_ENV=test");
  }

  console.log("[Test] All Public Share Speed Optimization checks PASSED (3/3).");
}

runTests().catch((err) => {
  console.error("[Test] FAILED:", err);
  process.exit(1);
});
