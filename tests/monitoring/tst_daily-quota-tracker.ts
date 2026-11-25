import assert from "assert";
import { DailyQuotaTracker } from "../../server/monitoring/svc_daily-quota-tracker";

async function runTests() {
  console.log("=== Testing DailyQuotaTracker (Dev Daily Quota Monitor) ===");

  // 1. Test AI Studio token + request tracking (used / limit / remaining / percent)
  let fakeNow = new Date("2026-11-25T18:00:00.000Z"); // 10:00 AM PT
  DailyQuotaTracker.__resetForTests(() => fakeNow);

  DailyQuotaTracker.recordGeminiResponse({
    model: "gemini-4-hydrogen",
    response: {
      usageMetadata: {
        promptTokenCount: 12_500,
        candidatesTokenCount: 2_500,
        totalTokenCount: 15_000,
      },
    },
  });
  DailyQuotaTracker.recordGeminiResponse({
    model: "gemini-3.1-flash-lite",
    response: {},
    fallbackPromptChars: 4_000, // 1,000 tokens
    fallbackOutputChars: 2_000, // 500 tokens
  });

  // 2. Test Firestore server + client reads, writes, deletes
  DailyQuotaTracker.recordFirestoreOps({ reads: 120, writes: 15, deletes: 2, source: "server" });
  DailyQuotaTracker.recordFirestoreOps({ reads: 80, writes: 5, deletes: 1, source: "client" });

  // 3. Test Media Egress, Image Transforms, Crawlers, FCM, AI Voice
  DailyQuotaTracker.recordMediaEgress(5 * 1024 * 1024); // 5 MB
  DailyQuotaTracker.recordImageTransform(7);
  DailyQuotaTracker.recordCrawlerRequest(19);
  DailyQuotaTracker.recordFcmPush(4);
  DailyQuotaTracker.recordAiVoiceSession(2);

  const snap = DailyQuotaTracker.getSnapshot();
  assert.strictEqual(snap.dateKeyPt, "2026-11-25", "PT date key must match America/Los_Angeles");
  assert.strictEqual(snap.pollIntervalSec, 60, "Poll interval must be 60s (1 minute)");

  const byId = new Map(snap.resources.map((r) => [r.id, r]));

  const aiTokens = byId.get("ai_studio_tokens")!;
  assert.ok(aiTokens, "ai_studio_tokens resource must exist");
  assert.strictEqual(aiTokens.used, 16_500, "AI Studio tokens should sum exact + fallback tokens");
  assert.strictEqual(
    aiTokens.remaining,
    aiTokens.limit - 16_500,
    "AI Studio remaining tokens must equal limit - used"
  );
  assert.ok(aiTokens.detail?.includes("In 13.5k"), `Unexpected AI detail: ${aiTokens.detail}`);
  assert.ok(aiTokens.detail?.includes("Out 3.0k"), `Unexpected AI detail: ${aiTokens.detail}`);

  const aiReq = byId.get("ai_studio_requests")!;
  assert.strictEqual(aiReq.used, 2, "AI Studio requests must count both calls");

  const fsReads = byId.get("firestore_reads")!;
  assert.strictEqual(fsReads.used, 200, "Firestore reads must combine server + client");
  assert.strictEqual(fsReads.remaining, fsReads.limit - 200);

  const fsWrites = byId.get("firestore_writes")!;
  assert.strictEqual(fsWrites.used, 20, "Firestore writes must combine server + client");

  const fsDeletes = byId.get("firestore_deletes")!;
  assert.strictEqual(fsDeletes.used, 3, "Firestore deletes must combine server + client");

  const egress = byId.get("media_egress_mb")!;
  assert.strictEqual(egress.used, 5, "Media egress should report 5 MB");

  assert.strictEqual(byId.get("image_transforms")!.used, 7);
  assert.strictEqual(byId.get("crawler_fetches")!.used, 19);
  assert.strictEqual(byId.get("fcm_messages")!.used, 4);
  assert.strictEqual(byId.get("ai_voice_sessions")!.used, 2);
  assert.ok(byId.get("server_ram_mb")!.used > 0, "Server RAM must report live RSS > 0 MB");
  console.log("  [PASS] 1. All 12 daily quota resources tracked accurately with used/limit/remaining");

  // 4. Test automatic midnight Pacific Time daily rollover reset
  fakeNow = new Date("2026-11-26T08:05:00.000Z"); // 00:05 AM PT next day
  const nextDaySnap = DailyQuotaTracker.getSnapshot();
  assert.strictEqual(nextDaySnap.dateKeyPt, "2026-11-26", "Date key must advance at midnight PT");
  const nextById = new Map(nextDaySnap.resources.map((r) => [r.id, r]));
  assert.strictEqual(nextById.get("ai_studio_tokens")!.used, 0, "AI tokens must reset to 0 on new PT day");
  assert.strictEqual(nextById.get("firestore_reads")!.used, 0, "Firestore reads must reset to 0 on new PT day");
  assert.strictEqual(nextById.get("crawler_fetches")!.used, 0, "Crawler requests must reset to 0 on new PT day");
  console.log("  [PASS] 2. Midnight Pacific Time rollover resets daily counters automatically");

  console.log("=== All DailyQuotaTracker tests PASSED ===");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
