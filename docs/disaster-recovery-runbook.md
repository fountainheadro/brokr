# BROKR — Phase 4 Stage A Disaster Recovery, Backup & Rollback Runbook

> **Live Data Protection Guarantee**: Every procedure in this runbook is strictly additive and non-destructive toward existing agency data (`leads`, `cereri`, `contacts`, `staff`, `viewings`, `documents`, `tenants`, `platform_shared_leads`) stored in Firestore database `ai-studio-e7371a1e-cd74-432c-b244-a7eb8aa7f434`.

---

## 1. Authoritative Infrastructure Inventory (Stage A)

| Component | Identifier / Configuration | Region / Scope |
| :--- | :--- | :--- |
| **GCP / Firebase Project** | `brokr-42038` | Europe |
| **Cloud Firestore Database** | `ai-studio-e7371a1e-cd74-432c-b244-a7eb8aa7f434` | `europe-west3` |
| **App Media Bucket** | `gs://brokr-42038.firebasestorage.app` | `europe-west3` |
| **Dedicated Backup Bucket** | `gs://brokr-42038-firestore-backups` (30-day rolling retention, versioning ON, public access enforced OFF) | `EU` multi-region |
| **Cloud Run Staging Service** | `brokr-core-api-staging` | `europe-west3` |
| **Cloud Run Production Service** | `brokr-core-api-prod` | `europe-west3` |
| **Health Probes** | Liveness: `GET /api/healthz` · Readiness: `GET /api/readyz` | Unauthenticated, zero secret exposure |
| **Recovery Objectives** | **RPO ≈ 1 minute** (PITR 7-day rolling window) / **24h** (daily GCS export) · **RTO < 60 minutes** (DB restore) · **< 2 minutes** (App revision rollback) | Stage A |

---

## 2. First-Time Stage A Provisioning Checklist (Zero Data Loss)

1. **Populate Secret Manager values out-of-band** (never commit secrets into Git or Terraform `.tfvars`):
   ```bash
   # Generate a persistent 32-byte signing key once for STORAGE_SIGNING_SECRET
   openssl rand -hex 32 | gcloud secrets versions add brokr-prod-storage-signing-secret \
     --project=brokr-42038 --data-file=-

   # Add server-side Gemini API key
   printf '%s' "$GEMINI_API_KEY" | gcloud secrets versions add brokr-prod-gemini-api-key \
     --project=brokr-42038 --data-file=-
   ```

2. **Enable Point-in-Time Recovery (PITR) & Delete Protection on the existing Firestore database** (safe online operation — zero downtime, zero data modification):
   ```bash
   gcloud firestore databases update \
     --project=brokr-42038 \
     --database=ai-studio-e7371a1e-cd74-432c-b244-a7eb8aa7f434 \
     --enable-pitr \
     --delete-protection
   ```
   Verify `pointInTimeRecoveryEnablement: POINT_IN_TIME_RECOVERY_ENABLED`:
   ```bash
   gcloud firestore databases describe \
     --project=brokr-42038 \
     --database=ai-studio-e7371a1e-cd74-432c-b244-a7eb8aa7f434
   ```

3. **Enable Object Versioning on the App Media Bucket**:
   ```bash
   gcloud storage buckets update gs://brokr-42038.firebasestorage.app \
     --project=brokr-42038 \
     --versioning
   ```

4. **Apply Stage A Terraform to Staging first, then Production**:
   ```bash
   cd infra/terraform
   terraform init
   terraform validate
   terraform plan -var-file=staging.tfvars
   terraform apply -var-file=staging.tfvars
   ```
   *(Keep `manage_firestore_pitr = false` unless you first import the existing database via `terraform import 'google_firestore_database.existing_pitr[0]' 'projects/brokr-42038/databases/ai-studio-e7371a1e-cd74-432c-b244-a7eb8aa7f434'`.)*

---

## 3. Instant Application Rollback (< 2 Minutes RTO)

If a newly deployed Cloud Run revision causes elevated 5xx errors or readiness failures:

1. **List recent healthy revisions**:
   ```bash
   gcloud run revisions list \
     --project=brokr-42038 \
     --region=europe-west3 \
     --service=brokr-core-api-prod \
     --limit=5
   ```
2. **Shift 100% of live traffic back to the prior known-good revision**:
   ```bash
   gcloud run services update-traffic brokr-core-api-prod \
     --project=brokr-42038 \
     --region=europe-west3 \
     --to-revisions=<PREVIOUS_REVISION_NAME>=100
   ```
3. **Verify recovery**:
   ```bash
   PROD_URL=$(gcloud run services describe brokr-core-api-prod --project=brokr-42038 --region=europe-west3 --format='value(status.url)')
   curl -fsS "${PROD_URL}/api/healthz"
   curl -fsS "${PROD_URL}/api/readyz"
   ```
4. **If `firestore.rules` also changed**, revert the commit and redeploy rules immediately:
   ```bash
   firebase deploy --only firestore:rules --project brokr-42038
   ```

---

## 4. Database Recovery Procedures (< 60 Minutes RTO)

### Scenario A — Accidental Bulk Delete or Bad Data Mutation Within the Last 7 Days (PITR Restore)
PITR restores into a **new destination database** (never overwrites live data in-place), allowing safe verification before switching or selectively copying documents back:
```bash
gcloud firestore databases restore \
  --project=brokr-42038 \
  --source-database="projects/brokr-42038/databases/ai-studio-e7371a1e-cd74-432c-b244-a7eb8aa7f434" \
  --destination-database="brokr-pitr-recovery-$(date -u +%Y%m%d)" \
  --snapshot-time="<YYYY-MM-DDTHH:MM:00Z>"
```

### Scenario B — Restore From Automated Daily GCS Export (Up to 30 Days Retention)
1. **Locate the latest verified daily export**:
   ```bash
   gcloud storage ls gs://brokr-42038-firestore-backups/daily/
   ```
2. **Import into an isolated staging/recovery database first** (never import blindly into production):
   ```bash
   gcloud firestore databases create \
     --project=brokr-42038 \
     --database="brokr-dr-staging" \
     --location=europe-west3 \
     --type=firestore-native

   gcloud firestore import "gs://brokr-42038-firestore-backups/daily/<EXPORT_FOLDER>" \
     --project=brokr-42038 \
     --database="brokr-dr-staging"
   ```
3. **Monitor import progress**:
   ```bash
   gcloud firestore operations list \
     --project=brokr-42038 \
     --database="brokr-dr-staging"
   ```

---

## 5. Quarterly Restore Drill Protocol (Required Before Pilot Sign-Off)

Execute once per quarter and log results below:

1. Trigger an on-demand backup export (or pick last night's `daily/` export from Cloud Scheduler).
2. Create an isolated staging database (`brokr-dr-drill-YYYYMMDD`) and run `gcloud firestore import`.
3. Verify document integrity across critical collections:
   - `/tenants/ten_brokr_default` (agency settings & branding)
   - `/tenants/ten_brokr_default/leads` & `leads_summary` (active leads, properties, cereri)
   - `/tenants/ten_brokr_default/contacts`, `staff`, `viewings`, `users`, `invites`
   - `/platform_shared_leads` & `platform_shared_leads_summary`
   - `/subscription_plans`, `/subscriptions`, `/ai_configs`, `/platform_settings`
4. Point `brokr-core-api-staging` temporarily at `FIRESTORE_DATABASE_ID=brokr-dr-drill-YYYYMMDD`, confirm `/api/readyz` returns `200`, and verify leads/cereri load cleanly in the UI.
5. Delete the temporary drill database (`brokr-dr-drill-YYYYMMDD`) so zero extra storage fees accrue.
6. Record total elapsed time (Target: **< 60 minutes RTO**).

### Drill Log
| Date | Operator | Source Backup / PITR Timestamp | Verified Collections | Elapsed Time (RTO) | Result |
| :--- | :--- | :--- | :--- | :---: | :---: |
| *Pending first Staging deploy* | — | — | — | — | — |
