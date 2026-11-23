# BROKR Phase 0 — Baseline Measurement, Guardrails & Verification Report

**Generated:** 2026-11-22  
**Status:** Phase 0 Complete (Zero production code or live GCP resources modified)  
**Firebase Project:** `brokr-42038`  
**Firestore Named Database:** `ai-studio-e7371a1e-cd74-432c-b244-a7eb8aa7f434`  
**Cloud Storage Bucket:** `brokr-42038.firebasestorage.app`

---

## 1. Phase 0 Deliverables Created

| Artifact | Purpose | Status |
| :--- | :--- | :--- |
| `/firebase.json` | Binds `firestore.rules`, `firestore.indexes.json`, named database ID, and local emulator ports (`firestore: 8080`, `auth: 9099`, `ui: 4000`) | Created & validated |
| `/firestore.indexes.json` | Versioned manifest of 11 composite indexes for calendar, notifications, planned `leads_summary` / `platform_shared_leads_summary` projections (Phase 2), and `outbox_events` (Phase 6) | Created & validated |
| `/tests/rules/tst_firestore-rules-baseline.ts` | Automated Firestore Rules baseline suite (`npm run test:rules`): runs `@firebase/eslint-plugin-security-rules`, verifies 25 security/isolation invariants, audits lookup calls, and hooks into live Firestore Emulator when `FIRESTORE_EMULATOR_HOST` is set | Created & passing (25/25) |
| `/tests/baseline/run_phase0-baseline.ts` | Reproducible architecture, subscription fanout, payload byte-size, route security, and local API latency benchmark (`npm run baseline:phase0`) | Created & verified |
| `/docs/phase0-baseline-report.md` | This evidence-backed baseline report | Created |
| `/package.json` | Added `test:rules` and `baseline:phase0` npm scripts | Updated |

**Production Code Integrity Confirmation:** Zero modifications were made to `server.ts`, `src/**`, `firestore.rules`, or live GCP infrastructure during Phase 0.

---

## 2. Verified Codebase & Runtime Baseline Measurements

All figures below were measured directly by executing `npm run baseline:phase0` and `npm run test:rules` against the live repository.

### 2.1 SDK, Cache & Transport Configuration
- **`firebase-admin` SDK:** **Not installed** (backend uses RS256 Google X.509 JWKS verification in `server/middleware/mw_authentication.ts` + Firestore REST v1 in `src/core/database/svc_persistent-store.ts`).
- **Firestore Client Cache (`src/lib/firebase.ts`):** **Memory-only (`DISABLED`)** with `experimentalForceLongPolling: true`. No `persistentLocalCache` / `persistentMultipleTabManager` IndexedDB persistence enabled yet (**Target: Phase 1**).
- **Express `trust proxy` (`server.ts:582`):** `true` (permissive — trusts arbitrary client-supplied proxy hops; **Target: tighten to `1` in Phase 3**).
- **Global JSON Body Limit (`server.ts:658`):** `express.json({ limit: "50mb" })` applied globally (**Target: tighten to `1mb` default with scoped upload limit in Phase 3**).
- **Ephemeral Local Uploads (`server.ts:651`):** `./public/uploads` still initialized locally (**Target: migrate to GCS signed uploads in Phase 4**).

### 2.2 Client Real-Time Subscription & Polling Fanout
- **Total `subscribeTo*` call sites in `src/`:** `27` (plus `2` direct `onSnapshot` calls).
- **Per-component breakdown:**
  - `src/components/Header.tsx`: `5` (`leads`, `contacts`, `staff/personal`, `documents`, `activities`)
  - `src/pages/Home.tsx`: `5` (`leads`, `contacts`, `staff/personal`, `platform_shared_leads`, `viewings`)
  - `src/pages/Calendar.tsx`: `4`
  - `src/components/StatsModal.tsx`: `3`
  - `src/pages/agency/pg_agency-admin-piata-imobiliara.tsx`: `2`
  - `src/services/tourService.ts`: `2`
  - `src/components/CalendarView.tsx`: `1`
  - `src/components/NotificationManager.tsx`: `1`
  - `src/components/NotificationProvider.tsx`: `1`
  - `src/components/ViewingDetailsModal.tsx`: `1`
  - `src/pages/platform/pg_platform-auto-crawl.tsx`: `1`
  - `src/services/platformAutoCrawlService.ts`: `1`
- **Concurrent Home Tab Fanout (Measured):** Opening the Home workspace mounts `Header` + `Home` + `NotificationManager` + `NotificationProvider` = **~11–12 overlapping subscriptions per open browser tab** (**Target: Phase 1 reduces to 1 shared subscription per active resource per browser origin**).
- **Client `setInterval()` timers:** `7` total, including browser-driven automation/polling in:
  - `src/pages/Home.tsx:1471`
  - `src/pages/agency/pg_agency-admin-piata-imobiliara.tsx:217`
  - `src/pages/platform/pg_platform-auto-crawl.tsx:187`
  - `src/components/NotificationManager.tsx:88`
  - `src/core/crm/svc_crm-client.ts:324` (fallback polling timer)
- **Server `setInterval()` timers:** `2` total (`server/background-notifications.ts:385`, `server/ai-call/router.ts:146`) (**Target: move background notification sweep & scheduled automation to Cloud Scheduler + Cloud Tasks in Phase 6**).

### 2.3 Document Payload Size & Firestore Enterprise 4 KiB Read-Unit Benchmark
Measured on realistic BROKR `Lead` JSON payloads matching `src/services/leadsService.ts` (`CRMData` + Romanian marketing copy + image URLs) vs. planned Phase 2 `LeadSummary` projections:

| Photo Count | Full `Lead` Doc Size | Enterprise 4 KiB Read Units / Doc | Slim `LeadSummary` Size | Slim Enterprise RU / Doc | 50-Item List Full Payload | 50-Item List Slim Payload | Payload Reduction |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 10 images | `6,847 B` | `2 RU` | `675 B` | `1 RU` | `334.3 KB` | `33.0 KB` | **-90.1%** |
| 25 images | `9,485 B` | `3 RU` | `675 B` | `1 RU` | `463.1 KB` | `33.0 KB` | **-92.9%** |
| 50 images | `13,885 B` | `4 RU` | `675 B` | `1 RU` | `678.0 KB` | `33.0 KB` | **-95.1%** |

### 2.4 Firestore Security Rules Lookup-Cost Baseline (`firestore.rules`)
- **`isActiveTenantMember(tenantId)`:** `4` lookup calls in rule logic (`isTenantMember`: 1 `exists()`, `isTenantActive`: 1 `exists()` + 1 `get()`, `getTenantMembership`: 1 `get()`) spanning `2` distinct documents (`/tenants/{tid}` and `/tenants/{tid}/users/{uid}`).
- **`isSelfBindingFromActiveInvite()`:** `1` `exists()` + `2` `get()` calls (+ `isTenantActive`).
- **Phase 3 Target:** Eliminate redundant `exists()` checks before `get()` and introduce custom-claims fast-path with server-authoritative revocation check to reduce per-request rule lookup overhead.

### 2.5 Backend Route Tenancy & Quota Audit (`server.ts`)
- **Total `/api/*` routes in `server.ts`:** `22`
- **Expensive routes currently guarded by `mwAuthentication` ONLY (missing `requireTenantContext` + `QuotaService` metering — Target: Phase 3):**
  1. `POST /api/upload-photo` (`server.ts:704`)
  2. `POST /api/extract-basic` (`server.ts:928`)
  3. `POST /api/extract-data` (`server.ts:950`)
  4. `POST /api/generate-ai-text` (`server.ts:972`)
  5. `POST /api/parse-listing-html` (`server.ts:2746`)
  6. `POST /api/crawl` (`server.ts:2757`)
  7. `POST /api/crawl-basic` (`server.ts:5096`)

### 2.6 Local Dev Server Health Latency Probe (`http://127.0.0.1:3000/api/health`)
- **Samples:** `25` consecutive local requests
- **p50:** `3.20 ms`
- **p95:** `5.12 ms`
- **max:** `67.38 ms` (first warm-up request)

---

## 3. Automated Verification Test Results (Phase 0 Gate)

| Suite | Command | Result |
| :--- | :--- | :--- |
| Firestore Rules Baseline & ESLint Security Rules | `npm run test:rules` | **25 passed, 0 failed** (0 ESLint errors/warnings) |
| Multi-Tenant Isolation | `npm run test:security` | **10 passed, 0 failed** |
| Super Admin & Platform Authorization | `npm run test:platform` | **10 passed, 0 failed** |
| ADC, Metadata Guard & Production Firestore | `npm run test:adc` | **7 passed, 0 failed** |

> **Environment Note on Firestore Emulator:** The sandbox container has the Firebase CLI (`/usr/local/bin/firebase`) installed, but does **not** include a Java JRE (`java`), which is required to boot the local Firestore Emulator binary. `npm run test:rules` therefore runs the full deterministic policy + `@firebase/eslint-plugin-security-rules` suite locally and automatically executes live Emulator HTTP assertions whenever `FIRESTORE_EMULATOR_HOST` is present (e.g., in GitHub Actions CI via `firebase emulators:exec --only firestore "npm run test:rules"`).

---

## 4. Verified GCP Console Baseline (Confirmed by Operator on 2026-11-22)

1. **Firestore Database Edition & Region:**
   - **Database ID:** `ai-studio-e7371a1e-cd74-432c-b244-a7eb8aa7f434`
   - **Edition:** **Enterprise (`Firestore Native`)** — billed by **4 KiB Read Units** (`billable_read_units`, `billable_realtime_read_units`) and **1 KiB Write Units** (`billable_write_units`).
   - **Architectural Impact:** Confirmed! Because the database is Enterprise edition, **Phase 2 Slim Summary Projections** will directly reduce billed Firestore read units by **2×–4× per document** (from `2–4 RU` down to `1 RU`) in addition to cutting payload bandwidth by **90%–95%**.
   - **Region:** **`europe-west3` (Frankfurt)** — all future Cloud Run services, GCS buckets, Cloud Tasks queues, and optional Stage B Redis must be co-located in **`europe-west3`** for lowest latency and zero cross-region egress.
   - **PITR / Delete Protection:** Currently **Disabled** (scheduled to enable in Phase 10 Production Hardening & DR).
2. **7-Day Live Traffic & Cost Baseline (Nov 16–22, 2026):**
   - `billable_read_units`: low dev bursts, peak ~`1.8 RU/s` (Nov 19), typical `0–0.45 RU/s` (Nov 20–22).
   - `billable_realtime_read_units`: peak ~`0.28 RU/s` (Nov 21), mostly near `0 RU/s`.
   - `billable_write_units`: peak ~`1.1 WU/s` (Nov 21), typical `0–0.3 WU/s`.
   - `Managed Delete Units`: `0`.
   - **Current Monthly Spend:** **`$0.00`** — project is currently on the **free AI Studio shared-quota tier** (no pay-as-you-go Cloud Billing account linked yet).
3. **GCP Billing Budget Alerts ($25 / $50 / $100):**
   - **Status:** Deferred until pay-as-you-go billing is enabled (the "Create budget" button is only available after linking a Cloud Billing account on Blaze/Pay-as-you-go).
   - **Action Trigger:** Link a Cloud Billing account and immediately create `$25 / $50 / $100` budget alerts before lifting shared quota limits for pilot/production launch (Phase 8/10).

---

## 5. Phase 0 Acceptance Criteria Sign-Off

- [x] `firebase.json` and `firestore.indexes.json` created and schema-validated.
- [x] Automated Firestore Security Rules baseline suite (`npm run test:rules`) created and passing (25/25).
- [x] Reproducible Phase 0 baseline measurement script (`npm run baseline:phase0`) executed with real measurements recorded above.
- [x] Existing security & multi-tenant regression suites (`test:security`, `test:platform`, `test:adc`) passing with zero regressions.
- [x] Zero production source files (`server.ts`, `src/**`, `firestore.rules`) modified.
- [x] Operator verified GCP Console Firestore edition (**Enterprise**, `europe-west3`), 7-day usage baseline, and current free shared-quota billing state (`$0`).
- [ ] **Awaiting explicit user approval to begin Phase 1 (Centralized Client Data Hub, IndexedDB Persistence & Atomic Data Primitives).**
