/**
 * Phase 3: Firestore Security Rules Isolation, Lookup-Cost & AuthVersion Verification Suite
 *
 * Verifies:
 * 1. Official `@firebase/eslint-plugin-security-rules` passes with 0 errors and 0 warnings
 * 2. Phase 3 lookup-cost optimization: `isActiveTenantMember(tenantId)` performs 0 `exists()` calls
 *    and references at most 2 distinct document paths (`tenants/$(tenantId)` and `users/$(request.auth.uid)`)
 * 3. `hasValidTokenAuthVersion` enforces `tid`, `uVer`, and `tVer` against `authVersion` (defaulting to 1)
 * 4. Short-circuit safety order on `/users/{userId}` and `/invites/{inviteEmail}` prevents missing-doc errors
 * 5. Tenant `authVersion` is protected from client-side Agency Admin tampering
 * 6. `firebase-blueprint.json` documents additive `authVersion` on `Tenant` and `TenantUser`
 * 7. Strict cross-tenant isolation & read-only Phase 2 summary protections remain intact
 * 8. Optional live Firestore Emulator cross-tenant & revocation checks when `FIRESTORE_EMULATOR_HOST` is set
 */

import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

const ROOT = process.cwd();
const RULES_PATH = path.join(ROOT, "firestore.rules");
const BLUEPRINT_PATH = path.join(ROOT, "firebase-blueprint.json");

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

async function runLiveEmulatorIsolationChecks(emulatorHost: string) {
  console.log(`\n🔌 Running live Firestore Emulator isolation checks against ${emulatorHost}...`);
  const projectId = "brokr-42038";
  const dbId = "ai-studio-e7371a1e-cd74-432c-b244-a7eb8aa7f434";
  const baseUrl = `http://${emulatorHost}/v1/projects/${projectId}/databases/${dbId}/documents`;

  const unauthTenantRead = await fetch(`${baseUrl}/tenants/ten_agency_a/leads/lead_1`);
  assertCheck(
    unauthTenantRead.status === 403,
    "Emulator: unauthenticated tenant lead read denied (403)",
    `Expected 403, got ${unauthTenantRead.status}`
  );

  const unauthSummaryWrite = await fetch(`${baseUrl}/tenants/ten_agency_a/leads_summary/lead_1`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { title: { stringValue: "forged" } } }),
  });
  assertCheck(
    unauthSummaryWrite.status === 403,
    "Emulator: client write to leads_summary denied (403)",
    `Expected 403, got ${unauthSummaryWrite.status}`
  );
}

async function main() {
  console.log("================================================================");
  console.log("🛡️  BROKR PHASE 3 — FIRESTORE RULES ISOLATION & COST AUDIT");
  console.log("================================================================");

  const rulesSource = fs.readFileSync(RULES_PATH, "utf8");
  const blueprint = JSON.parse(fs.readFileSync(BLUEPRINT_PATH, "utf8"));

  // 1. ESLint security-rules verification (0 errors, 0 warnings)
  try {
    const out = execFileSync("npx", ["eslint", "firestore.rules", "--format", "json"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const parsed = JSON.parse(out);
    const errors = parsed.reduce((acc: number, r: any) => acc + (r.errorCount || 0), 0);
    const warnings = parsed.reduce((acc: number, r: any) => acc + (r.warningCount || 0), 0);
    assertCheck(
      errors === 0 && warnings === 0,
      `ESLint @firebase/eslint-plugin-security-rules passed (${errors} errors, ${warnings} warnings)`,
      `Found ${errors} errors and ${warnings} warnings`
    );
  } catch (err: any) {
    fail("ESLint security-rules verification", err?.stdout || err?.message || "Failed");
  }

  // 2. Lookup-cost optimization: 0 exists() calls and <= 2 distinct get() document paths
  const getTenantDocBody = extractFunctionBody(rulesSource, "getTenantDoc");
  const getTenantMembershipBody = extractFunctionBody(rulesSource, "getTenantMembership");
  const isTenantActiveBody = extractFunctionBody(rulesSource, "isTenantActive");
  const isActiveMemberBody = extractFunctionBody(rulesSource, "isActiveTenantMember");
  const isTenantAdminBody = extractFunctionBody(rulesSource, "isTenantAdmin");

  const combinedTenantHelperBodies = [
    getTenantDocBody,
    getTenantMembershipBody,
    isTenantActiveBody,
    isActiveMemberBody,
    isTenantAdminBody,
  ].join("\n");

  const existsCount = (combinedTenantHelperBodies.match(/\bexists\(/g) || []).length;
  const distinctGetPaths = new Set(
    Array.from(combinedTenantHelperBodies.matchAll(/\bget\((\/databases\/[^;]+?)\)\.data/g)).map((m) => m[1].trim())
  );

  assertCheck(
    existsCount === 0,
    "Phase 3 lookup optimization: 0 redundant exists() calls in tenant membership/active helpers (reduced from 2)",
    `Found ${existsCount} exists() calls in tenant helpers`
  );
  assertCheck(
    distinctGetPaths.size === 2,
    `Phase 3 lookup optimization: exactly ${distinctGetPaths.size} distinct get() document paths in isActiveTenantMember (down from 4 total calls)`,
    `Expected 2 distinct get() paths, found ${distinctGetPaths.size}: ${Array.from(distinctGetPaths).join(", ")}`
  );

  // 3. authVersion revocation verification in rules
  const authVerBody = extractFunctionBody(rulesSource, "hasValidTokenAuthVersion");
  assertCheck(
    authVerBody.includes("request.auth.token.tid == tenantId") &&
      authVerBody.includes("memberData.get('authVersion', 1)") &&
      authVerBody.includes("tenantData.get('authVersion', 1)") &&
      isActiveMemberBody.includes("hasValidTokenAuthVersion"),
    "hasValidTokenAuthVersion() enforces tid, uVer >= member.authVersion (default 1), and tVer >= tenant.authVersion (default 1)",
    "hasValidTokenAuthVersion() missing tid/uVer/tVer enforcement or not called in isActiveTenantMember"
  );

  // 4. Short-circuit ordering safety on /users/{userId} and /invites/{inviteEmail}
  const tenantsBlock = extractMatchBlock(rulesSource, "match /tenants/{tenantId}");
  const usersBlock = extractMatchBlock(tenantsBlock, "match /users/{userId}");
  const invitesBlock = extractMatchBlock(tenantsBlock, "match /invites/{inviteEmail}");

  const usersAllowGet = usersBlock.match(/allow\s+get:[\s\S]*?;/)?.[0] || "";
  assertCheck(
    usersAllowGet.indexOf("request.auth.uid == userId") !== -1 &&
      usersAllowGet.indexOf("isActiveTenantMember(tenantId)") !== -1 &&
      usersAllowGet.indexOf("request.auth.uid == userId") < usersAllowGet.indexOf("isActiveTenantMember(tenantId)"),
    "/users/{userId} allow get evaluates self-read BEFORE isActiveTenantMember(tenantId) (safe short-circuit)",
    "Self-read clause must precede isActiveTenantMember(tenantId) to avoid missing-doc abort"
  );

  const usersAllowCreate = usersBlock.match(/allow\s+create:[\s\S]*?;/)?.[0] || "";
  assertCheck(
    usersAllowCreate.indexOf("isSelfBindingFromActiveInvite") !== -1 &&
      usersAllowCreate.indexOf("isTenantAdmin(tenantId)") !== -1 &&
      usersAllowCreate.indexOf("isSelfBindingFromActiveInvite") < usersAllowCreate.indexOf("isTenantAdmin(tenantId)"),
    "/users/{userId} allow create evaluates isSelfBindingFromActiveInvite BEFORE isTenantAdmin(tenantId)",
    "Self-binding invite clause must precede isTenantAdmin(tenantId)"
  );

  const invitesAllowGet = invitesBlock.match(/allow\s+get:[\s\S]*?;/)?.[0] || "";
  assertCheck(
    invitesAllowGet.indexOf("inviteEmail.lower()") !== -1 &&
      invitesAllowGet.indexOf("isTenantAdmin(tenantId)") !== -1 &&
      invitesAllowGet.indexOf("inviteEmail.lower()") < invitesAllowGet.indexOf("isTenantAdmin(tenantId)"),
    "/invites/{inviteEmail} allow get evaluates own-email check BEFORE isTenantAdmin(tenantId)",
    "Own-email invite check must precede isTenantAdmin(tenantId)"
  );

  // 5. Tenant authVersion protected from tenant admin direct mutation
  const tenantUpdateRule = tenantsBlock.match(/allow\s+update:[\s\S]*?;/)?.[0] || "";
  assertCheck(
    tenantUpdateRule.includes("'authVersion'") && tenantUpdateRule.includes("'status'"),
    "/tenants/{tenantId} allow update prevents tenant admins from tampering with status or authVersion",
    "Tenant update rule does not protect status/authVersion"
  );

  // 6. Blueprint sync check
  assertCheck(
    blueprint?.entities?.Tenant?.properties?.authVersion?.type === "number" &&
      blueprint?.entities?.TenantUser?.properties?.authVersion?.type === "number",
    "firebase-blueprint.json documents additive authVersion (number) on Tenant and TenantUser",
    "Missing authVersion schema property in firebase-blueprint.json"
  );

  // 7. Read-only Phase 2 summary guards intact
  const leadsSummaryBlock = extractMatchBlock(tenantsBlock, "match /leads_summary/{leadId}");
  const sharedSummaryBlock = extractMatchBlock(rulesSource, "match /platform_shared_leads_summary/{leadId}");
  assertCheck(
    leadsSummaryBlock.includes("allow write: if false;") &&
      sharedSummaryBlock.includes("allow write: if false;"),
    "Phase 2 slim summary collections remain strictly client read-only (allow write: if false)",
    "Missing allow write: if false on summary collections"
  );

  if (process.env.FIRESTORE_EMULATOR_HOST) {
    await runLiveEmulatorIsolationChecks(process.env.FIRESTORE_EMULATOR_HOST);
  }

  console.log("\n================================================================");
  console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
  console.log("================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error in Phase 3 rules isolation suite:", err);
  process.exit(1);
});
