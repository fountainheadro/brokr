/**
 * Phase 0: Firestore Security Rules Baseline & Invariant Verification Suite
 *
 * Validates:
 * 1. Official `@firebase/eslint-plugin-security-rules` passes with 0 errors and 0 warnings
 * 2. `firebase.json` & `firestore.indexes.json` schema integrity
 * 3. Default-deny catch-all rule (`match /{document=**} { allow read, write: if false; }`)
 * 4. Zero wildcard tenant subcollection matchers (`match /{col}/{docId}`)
 * 5. Email verification enforcement (`request.auth.token.email_verified == true`)
 * 6. Strict tenant isolation guards (`hasMatchingTenantId`, `preservesTenantId`, `isActiveTenantMember`)
 *    on every agency-scoped collection
 * 7. Self-privilege escalation blocks on `/tenants/{tenantId}/users/{userId}`
 * 8. Immutable append-only enforcement on audit and billing ledgers
 * 9. Security-rule lookup-cost audit (`exists()` / `get()` count inside tenant helper functions)
 * 10. Optional live Firebase Firestore Emulator assertions when `FIRESTORE_EMULATOR_HOST` is active
 *     (e.g. CI via `firebase emulators:exec --only firestore "npm run test:rules"`)
 */

import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

const ROOT = process.cwd();
const RULES_PATH = path.join(ROOT, "firestore.rules");
const FIREBASE_JSON_PATH = path.join(ROOT, "firebase.json");
const INDEXES_JSON_PATH = path.join(ROOT, "firestore.indexes.json");

let passed = 0;
let failed = 0;

function pass(label: string) {
  console.log(`✅ [PASS] ${label}`);
  passed++;
}

function fail(label: string, reason: string) {
  console.error(`❌ [FAIL] ${label} -> ${reason}`);
  failed++;
}

function assertCheck(condition: boolean, label: string, failureReason: string) {
  if (condition) {
    pass(label);
  } else {
    fail(label, failureReason);
  }
}

function extractFunctionBody(source: string, fnName: string): string {
  const startRegex = new RegExp(`function\\s+${fnName}\\s*\\([^)]*\\)\\s*\\{`);
  const match = startRegex.exec(source);
  if (!match) return "";
  let depth = 0;
  let i = match.index + match[0].length - 1;
  const bodyStart = i;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) {
        return source.slice(bodyStart, i + 1);
      }
    }
  }
  return "";
}

function extractMatchBlock(source: string, matchPattern: string): string {
  const idx = source.indexOf(matchPattern);
  if (idx === -1) return "";
  const braceStart = source.indexOf("{", idx + matchPattern.length);
  if (braceStart === -1) return "";
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) {
        return source.slice(idx, i + 1);
      }
    }
  }
  return "";
}

async function runLiveEmulatorChecks(emulatorHost: string) {
  console.log(`\n🔌 Running live Firestore Emulator checks against ${emulatorHost}...`);
  const projectId = "brokr-42038";
  const dbId = "ai-studio-e7371a1e-cd74-432c-b244-a7eb8aa7f434";
  const baseUrl = `http://${emulatorHost}/v1/projects/${projectId}/databases/${dbId}/documents`;

  // 1. Unauthenticated read to a tenant lead MUST return 403
  const unauthRes = await fetch(`${baseUrl}/tenants/demo-agency/leads/lead-1`);
  assertCheck(
    unauthRes.status === 403,
    "Emulator: unauthenticated read of tenant lead is denied (403)",
    `Expected HTTP 403, received ${unauthRes.status}`
  );

  // 2. Unauthenticated list of public_shares MUST return 403 (enumeration blocked)
  const listPublicSharesRes = await fetch(`${baseUrl}/public_shares`);
  assertCheck(
    listPublicSharesRes.status === 403,
    "Emulator: unauthenticated list on public_shares is denied (403)",
    `Expected HTTP 403, received ${listPublicSharesRes.status}`
  );

  // 3. Unauthenticated write to platform_admins MUST return 403
  const writeAdminRes = await fetch(`${baseUrl}/platform_admins/attacker`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { email: { stringValue: "attacker@example.com" } } }),
  });
  assertCheck(
    writeAdminRes.status === 403,
    "Emulator: unauthenticated write to platform_admins is denied (403)",
    `Expected HTTP 403, received ${writeAdminRes.status}`
  );

  // 4. Client write to Phase 2 leads_summary MUST return 403 (read-only projection)
  const writeSummaryRes = await fetch(`${baseUrl}/tenants/demo-agency/leads_summary/lead-1`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { title: { stringValue: "tampered" } } }),
  });
  assertCheck(
    writeSummaryRes.status === 403,
    "Emulator: client write to /tenants/{tenantId}/leads_summary is denied (403)",
    `Expected HTTP 403, received ${writeSummaryRes.status}`
  );

  // 5. Client write to Phase 2 platform_shared_leads_summary MUST return 403 (read-only projection)
  const writeSharedSummaryRes = await fetch(`${baseUrl}/platform_shared_leads_summary/shared-1`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { title: { stringValue: "tampered" } } }),
  });
  assertCheck(
    writeSharedSummaryRes.status === 403,
    "Emulator: client write to /platform_shared_leads_summary is denied (403)",
    `Expected HTTP 403, received ${writeSharedSummaryRes.status}`
  );
}

async function main() {
  console.log("================================================================");
  console.log("🛡️  BROKR PHASE 0 — FIRESTORE SECURITY RULES BASELINE SUITE");
  console.log("================================================================");

  // 1. Verify required Phase 0 Firebase files exist and parse cleanly
  assertCheck(fs.existsSync(RULES_PATH), "firestore.rules exists", "Missing firestore.rules");
  assertCheck(fs.existsSync(FIREBASE_JSON_PATH), "firebase.json exists", "Missing firebase.json");
  assertCheck(fs.existsSync(INDEXES_JSON_PATH), "firestore.indexes.json exists", "Missing firestore.indexes.json");

  const rulesSource = fs.readFileSync(RULES_PATH, "utf8");

  try {
    const firebaseJson = JSON.parse(fs.readFileSync(FIREBASE_JSON_PATH, "utf8"));
    assertCheck(
      firebaseJson?.firestore?.rules === "firestore.rules" &&
        firebaseJson?.firestore?.indexes === "firestore.indexes.json" &&
        typeof firebaseJson?.firestore?.database === "string",
      "firebase.json binds firestore.rules, firestore.indexes.json, and named database",
      "Invalid firestore configuration in firebase.json"
    );
  } catch (err: any) {
    fail("firebase.json valid JSON", err.message);
  }

  try {
    const indexesJson = JSON.parse(fs.readFileSync(INDEXES_JSON_PATH, "utf8"));
    const indexes = Array.isArray(indexesJson?.indexes) ? indexesJson.indexes : [];
    const allValid = indexes.every(
      (idx: any) =>
        typeof idx.collectionGroup === "string" &&
        (idx.queryScope === "COLLECTION" || idx.queryScope === "COLLECTION_GROUP") &&
        Array.isArray(idx.fields) &&
        idx.fields.length >= 2 &&
        idx.fields.every(
          (f: any) =>
            typeof f.fieldPath === "string" &&
            (f.order === "ASCENDING" || f.order === "DESCENDING" || f.arrayConfig === "CONTAINS")
        )
    );
    assertCheck(
      indexes.length >= 10 && allValid && Array.isArray(indexesJson?.fieldOverrides),
      `firestore.indexes.json defines ${indexes.length} valid composite indexes`,
      "Malformed composite index entries in firestore.indexes.json"
    );
  } catch (err: any) {
    fail("firestore.indexes.json valid JSON", err.message);
  }

  // 2. Run @firebase/eslint-plugin-security-rules via ESLint CLI
  try {
    const eslintOut = execFileSync("npx", ["eslint", "firestore.rules", "--format", "json"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const parsed = JSON.parse(eslintOut);
    const errorCount = parsed.reduce((acc: number, r: any) => acc + (r.errorCount || 0), 0);
    const warningCount = parsed.reduce((acc: number, r: any) => acc + (r.warningCount || 0), 0);
    assertCheck(
      errorCount === 0 && warningCount === 0,
      `@firebase/eslint-plugin-security-rules passed (${errorCount} errors, ${warningCount} warnings)`,
      `ESLint reported ${errorCount} errors and ${warningCount} warnings`
    );
  } catch (err: any) {
    fail("@firebase/eslint-plugin-security-rules check", err?.stdout || err?.message || "ESLint execution failed");
  }

  // 3. Structural & Security Policy Invariants on firestore.rules
  assertCheck(
    /rules_version\s*=\s*'2'/.test(rulesSource),
    "Rules version is v2",
    "Expected rules_version = '2'"
  );

  assertCheck(
    /match\s+\/\{document=\*\*\}\s*\{\s*allow\s+read,\s*write:\s*if\s+false;\s*\}/.test(rulesSource),
    "Global default-deny rule (`match /{document=**} { allow read, write: if false; }`) is enforced",
    "Global default-deny rule missing"
  );

  // Ensure no wildcard tenant subcollection matchers exist inside /tenants/{tenantId}
  const tenantsBlock = extractMatchBlock(rulesSource, "match /tenants/{tenantId}");
  const hasWildcardSubcollection = /match\s+\/\{[a-zA-Z0-9_]+\}\/\{[a-zA-Z0-9_]+\}/.test(tenantsBlock);
  assertCheck(
    !hasWildcardSubcollection,
    "Zero wildcard subcollection matchers inside /tenants/{tenantId}",
    "Found unsafe wildcard subcollection matcher inside /tenants/{tenantId}"
  );

  // Email verification required in isSignedIn()
  const isSignedInBody = extractFunctionBody(rulesSource, "isSignedIn");
  assertCheck(
    isSignedInBody.includes("request.auth != null") &&
      isSignedInBody.includes("request.auth.token.email_verified == true"),
    "isSignedIn() requires authenticated + verified email token",
    "isSignedIn() does not strictly enforce email_verified == true"
  );

  // Every core tenant collection enforces tenant membership + tenantId binding
  const requiredTenantCollections = [
    "leads",
    "contacts",
    "staff",
    "personal",
    "documents",
    "activities",
    "tours",
    "viewings",
    "notifications",
    "fcm_tokens",
    "counters",
  ];
  for (const col of requiredTenantCollections) {
    const colRegex = new RegExp(`match\\s+\\/${col}\\/\\{[a-zA-Z0-9_]+\\}`);
    const match = colRegex.exec(tenantsBlock);
    if (!match) {
      fail(`Tenant collection /tenants/{tenantId}/${col} rule present`, `Missing match block for ${col}`);
      continue;
    }
    const colBlock = extractMatchBlock(tenantsBlock, match[0]);
    const hasMemberGuard = colBlock.includes("isActiveTenantMember(tenantId)");
    const hasCreateTenantMatch = colBlock.includes("hasMatchingTenantId(tenantId)");
    const hasUpdateTenantPreserve =
      colBlock.includes("preservesTenantId(tenantId)") ||
      (col === "counters" && colBlock.includes("hasMatchingTenantId(tenantId)"));
    assertCheck(
      hasMemberGuard && hasCreateTenantMatch && hasUpdateTenantPreserve,
      `Tenant collection /${col} enforces isActiveTenantMember + tenantId integrity`,
      `Missing member/tenantId guard in /${col}`
    );
  }

  // Self-privilege escalation prevention on /users/{userId}
  const usersBlock = extractMatchBlock(tenantsBlock, "match /users/{userId}");
  assertCheck(
    usersBlock.includes("request.auth.uid != userId") &&
      usersBlock.includes("isSelfBindingFromActiveInvite(tenantId, userId)"),
    "/tenants/{tenantId}/users/{userId} blocks self-role escalation and binds invitees strictly to invite role",
    "Missing self-update block or invite-role binding on /users/{userId}"
  );

  // Public shares cannot be enumerated (allow list: if false)
  const publicSharesBlock = extractMatchBlock(rulesSource, "match /public_shares/{shareId}");
  assertCheck(
    /allow\s+list:\s*if\s+false;/.test(publicSharesBlock),
    "/public_shares/{shareId} blocks collection enumeration (`allow list: if false`)",
    "public_shares allows listing"
  );

  // Immutable append-only audit & billing ledgers
  const auditBlock = extractMatchBlock(rulesSource, "match /platform_audit_logs/{logId}");
  const billingBlock = extractMatchBlock(rulesSource, "match /billing_events/{eventId}");
  assertCheck(
    /allow\s+update,\s*delete:\s*if\s+false;/.test(auditBlock) &&
      /allow\s+update,\s*delete:\s*if\s+false;/.test(billingBlock),
    "platform_audit_logs and billing_events are strictly append-only (no update/delete)",
    "Audit or billing ledger permits mutation/deletion"
  );

  // Platform admins collection is read-only from clients
  const platformAdminsBlock = extractMatchBlock(rulesSource, "match /platform_admins/{adminUid}");
  assertCheck(
    /allow\s+write:\s*if\s+false;/.test(platformAdminsBlock),
    "/platform_admins/{adminUid} forbids all client writes",
    "platform_admins allows client writes"
  );

  // Phase 2 Slim Lead Summary projections: tenant-isolated reads, strictly server-only writes
  const leadsSummaryBlock = extractMatchBlock(tenantsBlock, "match /leads_summary/{leadId}");
  assertCheck(
    leadsSummaryBlock.includes("isActiveTenantMember(tenantId)") &&
      /allow\s+write:\s*if\s+false;/.test(leadsSummaryBlock),
    "/tenants/{tenantId}/leads_summary/{leadId} enforces active tenant membership on read and blocks all client writes",
    "leads_summary rule missing tenant read guard or allow write: if false"
  );

  const sharedLeadsSummaryBlock = extractMatchBlock(rulesSource, "match /platform_shared_leads_summary/{leadId}");
  assertCheck(
    sharedLeadsSummaryBlock.includes("isSignedIn()") &&
      /allow\s+write:\s*if\s+false;/.test(sharedLeadsSummaryBlock),
    "/platform_shared_leads_summary/{leadId} requires verified sign-in on read and blocks all client writes",
    "platform_shared_leads_summary rule missing sign-in guard or allow write: if false"
  );

  // 4. Lookup-Cost Audit Baseline (informational + baseline capture for Phase 3 optimization)
  const isTenantMemberBody = extractFunctionBody(rulesSource, "isTenantMember");
  const isTenantActiveBody = extractFunctionBody(rulesSource, "isTenantActive");
  const getTenantMembershipBody = extractFunctionBody(rulesSource, "getTenantMembership");
  const isSelfBindingBody = extractFunctionBody(rulesSource, "isSelfBindingFromActiveInvite");

  const countOps = (body: string) => ({
    existsCalls: (body.match(/\bexists\(/g) || []).length,
    getCalls: (body.match(/\bget\(/g) || []).length,
  });

  const memberOps = countOps(isTenantMemberBody);
  const activeOps = countOps(isTenantActiveBody);
  const membershipOps = countOps(getTenantMembershipBody);
  const inviteOps = countOps(isSelfBindingBody);
  const totalRuleCallsInActiveCheck =
    memberOps.existsCalls +
    memberOps.getCalls +
    activeOps.existsCalls +
    activeOps.getCalls +
    membershipOps.existsCalls +
    membershipOps.getCalls;

  console.log("\n📊 Phase 0 Rules Lookup-Cost Baseline (Target for Phase 3 Reduction):");
  console.log(
    `   • isActiveTenantMember(tenantId): ${totalRuleCallsInActiveCheck} rule lookup calls ` +
      `(isTenantMember=${memberOps.existsCalls} exists, isTenantActive=${activeOps.existsCalls} exists + ${activeOps.getCalls} get, getTenantMembership=${membershipOps.getCalls} get) across 2 distinct documents`
  );
  console.log(
    `   • isSelfBindingFromActiveInvite(): ${inviteOps.existsCalls} exists + ${inviteOps.getCalls} get (+ isTenantActive)`
  );

  // 5. Optional Live Firestore Emulator checks
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    await runLiveEmulatorChecks(process.env.FIRESTORE_EMULATOR_HOST);
  } else {
    console.log(
      "\nℹ️  FIRESTORE_EMULATOR_HOST not set (Java JRE unavailable in this sandbox). " +
        "Live emulator checks will execute automatically in CI via: " +
        '`firebase emulators:exec --only firestore "npm run test:rules"`'
    );
  }

  console.log("\n================================================================");
  console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
  console.log("================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error in rules baseline suite:", err);
  process.exit(1);
});
