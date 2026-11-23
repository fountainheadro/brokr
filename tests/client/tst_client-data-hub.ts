import assert from "node:assert/strict";
import {
  ClientDataHub,
  buildCanonicalSliceKey,
  isClientDataHubEnabled,
  type DataHubPageResult,
  type DataHubTransport,
} from "../../src/core/crm/svc_client-data-hub";

interface MockSubscriptionHandle {
  id: number;
  scope: "tenant" | "platform";
  tenantId: string | null;
  uid: string | null;
  isPreviewMode: boolean;
  collectionName: string;
  active: boolean;
  pushData: (items: any[], fromCache?: boolean, source?: "firestore" | "api") => void;
  pushError: (err: Error) => void;
}

function createMockTransport() {
  let subCounter = 0;
  const handles: MockSubscriptionHandle[] = [];
  const pageCalls: Array<{ collectionName: string; pageSize: number; cursor: unknown }> = [];
  const pagedDataset: Record<string, any[]> = {
    leads: Array.from({ length: 120 }, (_, i) => ({
      id: `lead_${i + 1}`,
      title: `Apartament ${i + 1}`,
    })),
  };

  const transport: DataHubTransport = {
    subscribeCollection(params, handlers) {
      const id = ++subCounter;
      const handle: MockSubscriptionHandle = {
        id,
        scope: params.scope,
        tenantId: params.tenantId,
        uid: params.uid,
        isPreviewMode: params.isPreviewMode,
        collectionName: params.collectionName,
        active: true,
        pushData: (items, fromCache = false, source = "firestore") => {
          handlers.onData(items, { fromCache, source });
        },
        pushError: (err) => handlers.onError(err),
      };
      handles.push(handle);
      return () => {
        handle.active = false;
      };
    },
    async fetchPage<T>(params: {
      collectionName: string;
      pageSize: number;
      cursor?: unknown;
    }): Promise<DataHubPageResult<T>> {
      pageCalls.push({
        collectionName: params.collectionName,
        pageSize: params.pageSize,
        cursor: params.cursor,
      });
      const all = (pagedDataset[params.collectionName] || []) as T[];
      const offset = typeof params.cursor === "number" ? params.cursor : 0;
      const items = all.slice(offset, offset + params.pageSize);
      const hasMore = offset + params.pageSize < all.length;
      return {
        items,
        nextCursor: hasMore ? offset + params.pageSize : null,
        hasMore,
        fromCache: false,
      };
    },
  };

  return {
    transport,
    handles,
    pageCalls,
    activeHandles: () => handles.filter((h) => h.active),
  };
}

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

async function runTest(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`  PASS  ${name}`);
  } catch (err: any) {
    results.push({ name, passed: false, error: err?.message || String(err) });
    console.error(`  FAIL  ${name}: ${err?.message || err}`);
  }
}

async function main() {
  console.log("\n=== Phase 1 Centralized Client Data Hub Test Suite ===\n");

  await runTest("1. Ref-counted deduplication shares 1 listener across multiple subscribers with independent transforms", () => {
    const mock = createMockTransport();
    const hub = new ClientDataHub(mock.transport, { teardownGraceMs: 0, cacheMode: "indexeddb-multi-tab" });
    hub.setContext({ tenantId: "ten_alpha", uid: "usr_1", isPreviewMode: false });

    const seenA: any[][] = [];
    const seenB: any[][] = [];
    const seenC: any[][] = [];
    const seenViewings1: any[][] = [];
    const seenViewings2: any[][] = [];

    // 3 subscribers on leads with different transforms + 2 subscribers on viewings = 5 total subscribers
    const u1 = hub.subscribeCollection("leads", (items) => seenA.push(items), {
      transform: (items) => items.map((x: any) => ({ ...x, tag: "A" })),
    });
    const u2 = hub.subscribeCollection("leads", (items) => seenB.push(items), {
      transform: (items) => items.map((x: any) => ({ ...x, tag: "B" })),
    });
    const u3 = hub.subscribeCollection("leads", (items) => seenC.push(items));
    const u4 = hub.subscribeCollection("viewings", (items) => seenViewings1.push(items));
    const u5 = hub.subscribeCollection("viewings", (items) => seenViewings2.push(items));

    // Must open ONLY 2 underlying transport subscriptions (1 leads + 1 viewings), not 5!
    assert.equal(mock.activeHandles().length, 2, "Expected exactly 2 deduplicated listeners for 5 subscribers");

    const diag = hub.getDiagnostics();
    assert.equal(diag.activeSlices, 2);
    assert.equal(diag.totalSubscribers, 5);
    assert.equal(diag.deduplicatedSubscribers, 3);

    const leadsHandle = mock.handles.find((h) => h.collectionName === "leads")!;
    leadsHandle.pushData([{ id: "l1", title: "2 Camere Floreasca" }], true, "firestore");

    assert.equal(seenA.length, 1);
    assert.equal(seenA[0][0].tag, "A");
    assert.equal(seenB[0][0].tag, "B");
    assert.equal(seenC[0][0].tag, undefined);
    assert.equal(hub.getSyncSnapshot().fromCache, true);

    u1();
    u2();
    // 1 leads subscriber (u3) still mounted -> leads listener MUST stay active
    assert.equal(mock.activeHandles().length, 2);
    u3();
    // All leads subscribers unmounted -> leads listener torn down cleanly
    assert.equal(mock.activeHandles().length, 1);
    u4();
    u5();
    assert.equal(mock.activeHandles().length, 0);
  });

  await runTest("2. Warm subscriber receives cached slice immediately with zero extra network reads", () => {
    const mock = createMockTransport();
    const hub = new ClientDataHub(mock.transport, { teardownGraceMs: 0 });
    hub.setContext({ tenantId: "ten_alpha", uid: "usr_1", isPreviewMode: false });

    const u1 = hub.subscribeCollection("contacts", () => {});
    assert.equal(mock.handles.length, 1);
    mock.handles[0].pushData([{ id: "c1", firstName: "Ion" }]);

    let lateDelivered: any[] = [];
    const u2 = hub.subscribeCollection("contacts", (items) => {
      lateDelivered = items;
    });

    assert.equal(mock.handles.length, 1, "Late subscriber must reuse existing listener");
    assert.equal(lateDelivered.length, 1);
    assert.equal(lateDelivered[0].id, "c1");

    u1();
    u2();
  });

  await runTest("3. Bounded LRU detail cache hits on repeat reads, evicts oldest past cap, and invalidates on mutation", async () => {
    const mock = createMockTransport();
    const hub = new ClientDataHub(mock.transport, { maxDetailCacheEntries: 3, teardownGraceMs: 0 });
    hub.setContext({ tenantId: "ten_alpha", uid: "usr_1", isPreviewMode: false });

    let fetchCount = 0;
    const makeFetcher = (id: string) => async () => {
      fetchCount++;
      return { id, title: `Lead ${id}` };
    };

    const d1 = await hub.getDocumentById("leads", "1", makeFetcher("1"));
    const d1Hit = await hub.getDocumentById("leads", "1", makeFetcher("1"));
    assert.deepEqual(d1, d1Hit);
    assert.equal(fetchCount, 1, "Second read of same ID must hit LRU cache");

    await hub.getDocumentById("leads", "2", makeFetcher("2"));
    await hub.getDocumentById("leads", "3", makeFetcher("3"));
    // Touch "1" so "2" becomes the least-recently-used entry
    await hub.getDocumentById("leads", "1", makeFetcher("1"));
    assert.equal(fetchCount, 3);

    // Insert "4" -> must evict "2" (LRU), keeping "3", "1", "4"
    await hub.getDocumentById("leads", "4", makeFetcher("4"));
    assert.equal(hub.getSyncSnapshot().detailCacheSize, 3);

    // "1" must still be cached (no fetch)
    await hub.getDocumentById("leads", "1", makeFetcher("1"));
    assert.equal(fetchCount, 4);

    // "2" was evicted -> must re-fetch
    await hub.getDocumentById("leads", "2", makeFetcher("2"));
    assert.equal(fetchCount, 5);

    // Mutation invalidation must force re-fetch for "1"
    hub.notifyMutation("leads", "1");
    await hub.getDocumentById("leads", "1", makeFetcher("1"));
    assert.equal(fetchCount, 6);
  });

  await runTest("4. Cursor pagination fetches bounded pages sequentially until exhausted", async () => {
    const mock = createMockTransport();
    const hub = new ClientDataHub(mock.transport, { teardownGraceMs: 0 });
    hub.setContext({ tenantId: "ten_alpha", uid: "usr_1", isPreviewMode: false });

    const page1 = await hub.fetchCollectionPage("leads", { pageSize: 50 });
    assert.equal(page1.items.length, 50);
    assert.equal(page1.hasMore, true);
    assert.equal(page1.nextCursor, 50);

    const page2 = await hub.fetchCollectionPage("leads", { pageSize: 50, cursor: page1.nextCursor });
    assert.equal(page2.items.length, 50);
    assert.equal(page2.hasMore, true);
    assert.equal(page2.nextCursor, 100);

    const page3 = await hub.fetchCollectionPage("leads", { pageSize: 50, cursor: page2.nextCursor });
    assert.equal(page3.items.length, 20);
    assert.equal(page3.hasMore, false);
    assert.equal(page3.nextCursor, null);
    assert.equal(mock.pageCalls.length, 3);
  });

  await runTest("5. Tenant switch immediately detaches prior tenant listeners, clears detail cache, and fences stale snapshots", async () => {
    const mock = createMockTransport();
    const hub = new ClientDataHub(mock.transport, { teardownGraceMs: 0 });
    hub.setContext({ tenantId: "ten_agency_A", uid: "usr_1", isPreviewMode: false });

    const received: any[][] = [];
    const unsub = hub.subscribeCollection("leads", (items) => received.push(items));

    const agencyAHandle = mock.handles[0];
    assert.equal(agencyAHandle.tenantId, "ten_agency_A");
    agencyAHandle.pushData([{ id: "secret_A", tenantId: "ten_agency_A" }]);
    assert.equal(received[received.length - 1][0].id, "secret_A");

    // Populate detail cache under Agency A
    await hub.getDocumentById("leads", "secret_A", async () => ({ id: "secret_A" }));
    assert.equal(hub.getSyncSnapshot().detailCacheSize, 1);

    // Switch to Agency B -> MUST detach Agency A listener, clear LRU cache, clear subscriber view, attach Agency B
    hub.setContext({ tenantId: "ten_agency_B", uid: "usr_1", isPreviewMode: false });
    assert.equal(agencyAHandle.active, false, "Agency A listener must be immediately unsubscribed");
    assert.equal(hub.getSyncSnapshot().detailCacheSize, 0, "Detail cache must be purged on tenant switch");
    assert.deepEqual(received[received.length - 1], [], "Stale Agency A items must be cleared immediately");

    // Simulate a late/stale snapshot arriving from Agency A after switch -> MUST be dropped by epoch fence
    agencyAHandle.pushData([{ id: "stale_leak_A" }]);
    assert.deepEqual(received[received.length - 1], [], "Epoch fencing must drop stale prior-tenant data");

    // Agency B snapshot delivers cleanly
    const agencyBHandle = mock.handles[1];
    assert.equal(agencyBHandle.tenantId, "ten_agency_B");
    agencyBHandle.pushData([{ id: "lead_B" }]);
    assert.equal(received[received.length - 1][0].id, "lead_B");

    unsub();
  });

  await runTest("6. Logout / purgeAllCaches detaches every listener, clears all caches, and blocks stale in-flight detail fetches", async () => {
    const mock = createMockTransport();
    const hub = new ClientDataHub(mock.transport, { teardownGraceMs: 0 });
    hub.setContext({ tenantId: "ten_agency_A", uid: "usr_1", isPreviewMode: false });

    let latestLeads: any[] = [];
    hub.subscribeCollection("leads", (items) => {
      latestLeads = items;
    });
    hub.subscribePlatformSharedLeads(() => {});

    assert.equal(mock.activeHandles().length, 2);
    mock.handles[0].pushData([{ id: "l1" }]);
    assert.equal(latestLeads.length, 1);

    // Start an in-flight detail fetch before logout
    let resolveInFlight!: (val: any) => void;
    const inFlightPromise = hub.getDocumentById(
      "leads",
      "inflight_1",
      () =>
        new Promise((resolve) => {
          resolveInFlight = resolve;
        })
    );

    // Logout purge
    hub.purgeAllCaches();
    assert.equal(mock.activeHandles().length, 0, "All listeners must detach on purgeAllCaches");
    assert.deepEqual(latestLeads, [], "Subscribers must receive empty state on purge");
    assert.equal(hub.getSyncSnapshot().activeSlices, 0);
    assert.equal(hub.getSyncSnapshot().detailCacheSize, 0);

    // Resolve the pre-logout in-flight request -> must be fenced and NOT cached
    resolveInFlight({ id: "inflight_1", secret: true });
    const fencedResult = await inFlightPromise;
    assert.equal(fencedResult, null, "Pre-logout in-flight detail response must be discarded");
    assert.equal(hub.getSyncSnapshot().detailCacheSize, 0);
  });

  await runTest("7. Canonical slice keys isolate tenantId, uid, previewMode, and query params", () => {
    const k1 = buildCanonicalSliceKey(
      { tenantId: "ten_1", uid: "u_1", isPreviewMode: false },
      "tenant",
      "leads",
      { limit: 1000 }
    );
    const k2 = buildCanonicalSliceKey(
      { tenantId: "ten_2", uid: "u_1", isPreviewMode: false },
      "tenant",
      "leads",
      { limit: 1000 }
    );
    const k3 = buildCanonicalSliceKey(
      { tenantId: "ten_1", uid: "u_2", isPreviewMode: false },
      "tenant",
      "leads",
      { limit: 1000 }
    );
    const k4 = buildCanonicalSliceKey(
      { tenantId: "ten_1", uid: "u_1", isPreviewMode: true },
      "tenant",
      "leads",
      { limit: 1000 }
    );
    assert.notEqual(k1, k2);
    assert.notEqual(k1, k3);
    assert.notEqual(k1, k4);
  });

  await runTest("8. Error recovery banner state surfaces transport error and clears after retryFailedSlices()", () => {
    const mock = createMockTransport();
    const hub = new ClientDataHub(mock.transport, { teardownGraceMs: 0 });
    hub.setContext({ tenantId: "ten_alpha", uid: "usr_1", isPreviewMode: false });

    const unsub = hub.subscribeCollection("leads", () => {});
    mock.handles[0].pushError(new Error("Conexiune Firestore temporar indisponibilă"));
    assert.equal(hub.getSyncSnapshot().lastError, "Conexiune Firestore temporar indisponibilă");

    hub.retryFailedSlices();
    assert.equal(mock.handles[0].active, false);
    assert.equal(mock.activeHandles().length, 1);
    assert.equal(hub.getSyncSnapshot().lastError, null);

    unsub();
  });

  await runTest("9. Feature flag VITE_USE_CLIENT_DATA_HUB supports instant rollback when set to 'false'", () => {
    const prev = process.env.VITE_USE_CLIENT_DATA_HUB;
    try {
      delete process.env.VITE_USE_CLIENT_DATA_HUB;
      assert.equal(isClientDataHubEnabled(), true);

      process.env.VITE_USE_CLIENT_DATA_HUB = "false";
      assert.equal(isClientDataHubEnabled(), false);

      process.env.VITE_USE_CLIENT_DATA_HUB = "true";
      assert.equal(isClientDataHubEnabled(), true);
    } finally {
      if (prev === undefined) {
        delete process.env.VITE_USE_CLIENT_DATA_HUB;
      } else {
        process.env.VITE_USE_CLIENT_DATA_HUB = prev;
      }
    }
  });

  const failed = results.filter((r) => !r.passed);
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} tests passed.\n`);
  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
