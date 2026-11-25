import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  FirestoreQuotaExceededError,
  isFirestoreQuotaError,
  PublicPropertyCacheService,
} from "../../src/core/cache/svc_public-property-cache";
import { runViewingRemindersTick } from "../../server/background-notifications";
import { FirestoreLeaseService } from "../../src/core/jobs/svc_firestore-lease";

async function runTests() {
  console.log("=== Quota Optimization & Zero-Regression Verification ===");

  // 1. PublicPropertyCacheService: RAM hit, in-flight coalescing, instant invalidation, race guard, and 429 non-caching
  {
    PublicPropertyCacheService.clearAll();
    let fetchCount = 0;

    // 1a. Concurrent in-flight coalescing (5 simultaneous requests -> 1 Firestore lookup)
    const concurrentResults = await Promise.all(
      Array.from({ length: 5 }, () =>
        PublicPropertyCacheService.getOrFetch("L49", null, async () => {
          fetchCount += 1;
          await new Promise((r) => setTimeout(r, 25));
          return { id: "doc_l49_123", propertyId: "L49", title: "Apartament 2 camere", images: ["a.jpg"] };
        })
      )
    );
    assert.equal(fetchCount, 1, "5 concurrent requests for L49 must coalesce into 1 fetch");
    for (const r of concurrentResults) {
      assert.equal(r?.propertyId, "L49");
    }

    // 1b. Subsequent read hits RAM cache (0 extra fetches)
    const cached = await PublicPropertyCacheService.getOrFetch("l49", null, async () => {
      fetchCount += 1;
      return { id: "doc_l49_123", propertyId: "L49", title: "Should not run" };
    });
    assert.equal(fetchCount, 1, "Cached lookup must perform 0 fetches (case-insensitive code)");
    assert.equal(cached?.title, "Apartament 2 camere");

    // 1c. Instant invalidation by canonical doc ID busts the cached share code entry
    const invalidatedCount = PublicPropertyCacheService.invalidate(["doc_l49_123"], null);
    assert.ok(invalidatedCount >= 1, "Invalidating by doc ID must remove cached share code entry");

    const refreshed = await PublicPropertyCacheService.getOrFetch("L49", null, async () => {
      fetchCount += 1;
      return { id: "doc_l49_123", propertyId: "L49", title: "Apartament Updated Photos", images: ["b.jpg"] };
    });
    assert.equal(fetchCount, 2, "After invalidation, next read must fetch fresh data");
    assert.equal(refreshed?.title, "Apartament Updated Photos");

    // 1d. Race-condition guard: an in-flight read started BEFORE invalidate() must NOT repopulate stale data
    PublicPropertyCacheService.clearAll();
    let releaseSlowFetch!: () => void;
    const slowFetchStarted = new Promise<void>((r) => {
      void r;
    });
    void slowFetchStarted;

    const stalePromise = PublicPropertyCacheService.getOrFetch("L50", null, async () => {
      await new Promise<void>((resolve) => {
        releaseSlowFetch = resolve;
      });
      return { id: "doc_l50", propertyId: "L50", title: "Stale Version" };
    });

    // Invalidate while stalePromise is still in flight (simulating an agent saving edits)
    PublicPropertyCacheService.invalidate(["L50"], null);
    releaseSlowFetch();
    await stalePromise;

    let freshFetchCount = 0;
    const afterRace = await PublicPropertyCacheService.getOrFetch("L50", null, async () => {
      freshFetchCount += 1;
      return { id: "doc_l50", propertyId: "L50", title: "Fresh Version" };
    });
    assert.equal(freshFetchCount, 1, "Stale in-flight fetch must not repopulate cache after invalidation");
    assert.equal(afterRace?.title, "Fresh Version");

    // 1e. Genuine 404 null is negative-cached briefly, whereas 429 quota error is NEVER cached
    PublicPropertyCacheService.clearAll();
    let nullFetches = 0;
    const missing1 = await PublicPropertyCacheService.getOrFetch("NONEXISTENT", null, async () => {
      nullFetches += 1;
      return null;
    });
    const missing2 = await PublicPropertyCacheService.getOrFetch("NONEXISTENT", null, async () => {
      nullFetches += 1;
      return null;
    });
    assert.equal(missing1, null);
    assert.equal(missing2, null);
    assert.equal(nullFetches, 1, "Genuine 404 null should be briefly negative-cached");

    let quotaAttempts = 0;
    await assert.rejects(
      () =>
        PublicPropertyCacheService.getOrFetch("L99", null, async () => {
          quotaAttempts += 1;
          throw new FirestoreQuotaExceededError();
        }),
      (err: any) => isFirestoreQuotaError(err) && err.statusCode === 503
    );
    const recovered = await PublicPropertyCacheService.getOrFetch("L99", null, async () => {
      quotaAttempts += 1;
      return { id: "doc_l99", propertyId: "L99", title: "Recovered After Reset" };
    });
    assert.equal(quotaAttempts, 2, "429 quota errors must NEVER be negative-cached");
    assert.equal(recovered?.title, "Recovered After Reset");

    // 1f. Error classifier precision
    assert.equal(isFirestoreQuotaError({ response: { status: 429 } }), true);
    assert.equal(isFirestoreQuotaError({ code: "resource-exhausted" }), true);
    assert.equal(
      isFirestoreQuotaError({ response: { data: { error: { status: "RESOURCE_EXHAUSTED" } } } }),
      true
    );
    assert.equal(isFirestoreQuotaError({ response: { status: 404 } }), false);
    assert.equal(isFirestoreQuotaError(new Error("Network timeout")), false);
    console.log("  [PASS] PublicPropertyCacheService (coalescing, RAM hit, invalidation, race-guard, 429 non-caching)");
  }

  // 2. Background notifications idle zero-lease fast path
  {
    const originalWithLease = FirestoreLeaseService.withLease;
    let leaseCalls = 0;
    FirestoreLeaseService.withLease = (async (...args: any[]) => {
      leaseCalls += 1;
      return (originalWithLease as any).apply(FirestoreLeaseService, args);
    }) as any;

    try {
      // Idle state (0 viewings, 0 tokens): must perform 0 lease acquisitions
      const idleResult = await runViewingRemindersTick({ now: new Date() });
      assert.equal(idleResult.executed, true);
      assert.equal(idleResult.evaluatedViewings, 0);
      assert.equal(idleResult.dispatchedCount, 0);
      assert.equal(leaseCalls, 0, "Idle notification tick with 0 viewings/tokens must make 0 Firestore lease calls");
    } finally {
      FirestoreLeaseService.withLease = originalWithLease;
    }
    console.log("  [PASS] Background notifications idle tick executes 0 Firestore lease calls");
  }

  // 3. Static & regression audit across optimized modules
  {
    const root = process.cwd();

    // 3a. firebase.ts must NOT run unconditional getDocFromServer('test', 'connection')
    const firebaseSrc = fs.readFileSync(path.join(root, "src/lib/firebase.ts"), "utf8");
    assert.ok(
      !firebaseSrc.includes("getDocFromServer"),
      "src/lib/firebase.ts must not call getDocFromServer on module load"
    );

    // 3b. platformAutoCrawlService.ts must use indexed where("propertyId", ...) in getSharedLeadById & reserveDailySharedLeadIds
    const autoCrawlSrc = fs.readFileSync(path.join(root, "src/services/platformAutoCrawlService.ts"), "utf8");
    const getByIdStart = autoCrawlSrc.indexOf("async getSharedLeadById(");
    const getByIdEnd = autoCrawlSrc.indexOf("async saveSharedLeadDualWrite(", getByIdStart);
    const getByIdSection = autoCrawlSrc.slice(getByIdStart, getByIdEnd);
    assert.ok(getByIdSection.length > 50, "getSharedLeadById section must be located");
    assert.ok(
      getByIdSection.includes('where("propertyId", "==", leadId)'),
      "getSharedLeadById must use indexed single-field where('propertyId', '==', leadId)"
    );
    assert.ok(
      !getByIdSection.includes("getDocs(collection(db, SHARED_LEADS_COLLECTION))"),
      "getSharedLeadById must NOT perform unbounded full-collection getDocs"
    );

    const reserveStart = autoCrawlSrc.indexOf("async reserveDailySharedLeadIds(");
    const reserveEnd = autoCrawlSrc.indexOf("async normalizeLegacySharedLeadIds(", reserveStart);
    const reserveSection = autoCrawlSrc.slice(reserveStart, reserveEnd);
    assert.ok(reserveSection.length > 50, "reserveDailySharedLeadIds section must be located");
    assert.ok(
      !reserveSection.includes("getDocs(collection(db, SHARED_LEADS_COLLECTION))"),
      "reserveDailySharedLeadIds must NOT perform unbounded full-collection getDocs"
    );
    assert.ok(
      reserveSection.includes('where("propertyId", ">="'),
      "reserveDailySharedLeadIds must use single-field propertyId prefix range query"
    );
    assert.ok(
      autoCrawlSrc.includes("legacyIdsNormalizedAt"),
      "normalizeLegacySharedLeadIds must persist legacyIdsNormalizedAt marker to skip repeat full scans"
    );

    // 3c. ClientDataHub & CrmClient must use visibility-aware adaptive backoff
    const hubSrc = fs.readFileSync(path.join(root, "src/core/crm/svc_client-data-hub.ts"), "utf8");
    assert.ok(hubSrc.includes("document.hidden"), "ClientDataHub fallback poller must pause when tab is hidden");
    assert.ok(hubSrc.includes("emptyLegacyPersonalTenants"), "ClientDataHub must memoize empty legacy personal collections");
    assert.ok(hubSrc.includes("unavailableSummaryCollections"), "ClientDataHub must memoize unavailable summary collections");

    const crmClientSrc = fs.readFileSync(path.join(root, "src/core/crm/svc_crm-client.ts"), "utf8");
    assert.ok(crmClientSrc.includes("document.hidden"), "CrmClient legacy fallback poller must pause when tab is hidden");

    // 3d. TenantResolutionService uses 5-minute TTL
    const tenantResSrc = fs.readFileSync(path.join(root, "src/core/tenancy/svc_tenant-resolution.ts"), "utf8");
    assert.ok(tenantResSrc.includes("ttlMs = 300_000"), "TenantResolutionService must default to 5m (300_000ms) TTL");

    // 3e. CloudStorageService uses 12h public_property_media RAM cache TTL
    const storageSrc = fs.readFileSync(path.join(root, "src/core/storage/svc_cloud-storage.ts"), "utf8");
    assert.ok(
      storageSrc.includes("12 * 60 * 60 * 1000"),
      "CloudStorageService must cache public_property_media in RAM for 12 hours"
    );

    // 3f. publicShareService persists fingerprints and invalidates server cache on edits
    const pubShareSrc = fs.readFileSync(path.join(root, "src/services/publicShareService.ts"), "utf8");
    assert.ok(
      pubShareSrc.includes("brokr_public_share_fingerprints_v1"),
      "publicShareService must persist published fingerprints across page reloads"
    );
    assert.ok(
      pubShareSrc.includes("/api/crm/public-cache/invalidate"),
      "publicShareService must bust server public property cache after writing updated snapshots"
    );

    console.log("  [PASS] Static & structural audit of all quota-saving modules");
  }

  console.log("ALL QUOTA OPTIMIZATION TESTS PASSED (0 regressions detected).");
}

runTests().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
