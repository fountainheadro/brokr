# Ghid Activare Acces Producție GCP, IAM Least-Privilege & Verificare Live (Brokr SaaS)

---

## 1. Inventarul Resurselor Țintă Identificate în Configurație

- **Firebase / Google Cloud Project ID**: `brokr-42038`
- **Firestore Database ID**: `ai-studio-e7371a1e-cd74-432c-b244-a7eb8aa7f434`
- **Cloud Storage Bucket (Aplicație)**: `brokr-42038.firebasestorage.app`
- **Bucket Export Backup Recomandat**: `gs://brokr-42038-firestore-backups`
- **Identitatea observată în mediul de dezvoltare AI Studio**: `ais-sandbox@ais-europe-west2-916135f8b6254.iam.gserviceaccount.com`
  - Această identitate aparține sandbox-ului Google AI Studio și **primește corect `HTTP 403 Permission Denied`** către proiectul `brokr-42038`.
  - **Recomandare de securitate**: Pentru producție și migrarea live, utilizați un **Service Account dedicat în proiectul `brokr-42038`** (prin Application Default Credentials pe Cloud Run) și **NU** expuneți chei JSON private în cod, repository sau frontend.

---

## 2. Configurare Service Account Dedicat & Permisiuni IAM Minime (Fără Owner / Editor)

### Pasul 1 — Creare Service Account dedicat pentru backend (în Google Cloud Console)
1. Deschideți **Google Cloud Console** -> selectați proiectul **`brokr-42038`**.
2. Navigați la **IAM & Admin** → **Service Accounts** (`https://console.cloud.google.com/iam-admin/serviceaccounts?project=brokr-42038`).
3. Click **+ CREATE SERVICE ACCOUNT**:
   - **Service account name**: `brokr-crm-backend`
   - **Service account ID**: `brokr-crm-backend` (`brokr-crm-backend@brokr-42038.iam.gserviceaccount.com`)
   - Click **CREATE AND CONTINUE**.

### Pasul 2 — Permisiuni minime pentru Firestore (la nivel de proiect / bază de date)
În secțiunea **Grant this service account access to project**:
- Adăugați rolul: **`Cloud Datastore User`** (`roles/datastore.user`)
  - *Notă*: Nu acordați `roles/owner`, `roles/editor` sau `roles/firebase.admin`.
- Opțional, doar dacă rulați automat verificări de administrare PITR/export:
  - **`Cloud Datastore Viewer`** (`roles/datastore.viewer`) / **`Cloud Datastore Import Export Admin`** (`roles/datastore.importExportAdmin`) — **strict** pentru verificarea/rularea exporturilor.
- Click **CONTINUE** → **DONE**.

### Pasul 3 — Permisiuni minime pentru Cloud Storage (STRICT pe bucket, NU pe întreg proiectul)
1. Navigați la **Cloud Storage** → **Buckets** (`https://console.cloud.google.com/storage/browser?project=brokr-42038`).
2. Deschideți bucket-ul **`brokr-42038.firebasestorage.app`**.
3. Accesați tab-ul **Permissions** → click **GRANT ACCESS**.
4. În **New principals**, introduceți `brokr-crm-backend@brokr-42038.iam.gserviceaccount.com`.
5. În **Role**, selectați **`Storage Object Admin`** (`roles/storage.objectAdmin`) (permite upload, citire, verificare checksum și ștergere de obiecte exclusiv în acest bucket).
6. **SAVE**.
7. *(Opțional pentru bucket-ul de backup `brokr-42038-firestore-backups`)*: acordați **`Storage Object Viewer`** (`roles/storage.objectViewer`) pe bucket-ul de backup pentru verificarea `.overall_export_metadata`.

*(Alternativ prin Google Cloud CLI)*:
```bash
gcloud iam service-accounts create brokr-crm-backend \
  --project=brokr-42038 \
  --display-name="Brokr CRM Backend Runtime"

gcloud projects add-iam-policy-binding brokr-42038 \
  --member="serviceAccount:brokr-crm-backend@brokr-42038.iam.gserviceaccount.com" \
  --role="roles/datastore.user"

gcloud storage buckets add-iam-policy-binding "gs://brokr-42038.firebasestorage.app" \
  --member="serviceAccount:brokr-crm-backend@brokr-42038.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"
```

---

## 3. Modul de Autentificare Recomandat (Prioritate ADC)

Aplicația (`PersistentStoreService` și `CloudStorageService`) suportă automat următoarea ierarhie sigură (fără chei hardcodate):

1. **Application Default Credentials via Runtime Identity (Recomandat în Cloud Run / Producție)**:
   - Atașați `brokr-crm-backend@brokr-42038.iam.gserviceaccount.com` ca runtime service account al serviciului Cloud Run.
   - Setați `USE_GCP_METADATA_AUTH=true` (sau rularea pe Cloud Run unde `K_SERVICE` este prezent automat). Nu este necesară stocarea niciunei chei JSON private.
2. **Application Default Credentials Local (`gcloud auth application-default login`)**:
   - Pentru verificări controlate de pe o stație de administrare securizată, fără chei JSON de Service Account pe disc:
     ```bash
     gcloud auth application-default login
     ```
   - Aplicația citește automat `~/.config/gcloud/application_default_credentials.json` sau `GOOGLE_APPLICATION_CREDENTIALS`.
3. **Secret Manager / Variabilă Protejată (`FIREBASE_SERVICE_ACCOUNT_JSON`)**:
   - Exclusiv ca fallback server-side dacă rulează în afara GCP; nu se comite niciodată în Git sau în `VITE_*`.

### Variabile de Mediu Necesare (Server-Side Only)
```env
FIREBASE_PROJECT_ID=brokr-42038
FIRESTORE_DATABASE_ID=ai-studio-e7371a1e-cd74-432c-b244-a7eb8aa7f434
GCS_BUCKET_NAME=brokr-42038.firebasestorage.app
USE_GCP_METADATA_AUTH=true
```

---

## 4. Verificarea Accesului Real înainte de Migrare

1. Autentificat ca Super Admin (`fountainheadro@gmail.com`), accesați `/platform/migration` sau apelați:
   ```text
   GET /api/platform/migration/infra-status?deep=true
   ```
2. Endpoint-ul execută verificări izolate, non-distructive:
   - **Firestore**: `authenticated` → `runAggregationQuery` (citire) → scriere/recitire/ștergere exclusivă a documentului temporar `_infra_probes/probe_<ts>_<rand>` → status final **`verified`** (fără a atinge colecțiile CRM).
   - **GCS**: `authenticated` → acces bucket → upload obiect temporar `_infra_probes/probe_<ts>_<rand>.txt` → read-back & verificare SHA-256 → ștergere exclusivă a obiectului de test → status final **`verified`**.
3. Executați verificarea reală a backup-ului:
   ```text
   POST /api/platform/migration/backup/verify-live
   ```
   Aplicația verifică live existența **PITR activ** (`POINT_IN_TIME_RECOVERY_ENABLED`) pe database-ul `ai-studio-e7371a1e-cd74-432c-b244-a7eb8aa7f434` **sau** existența manifestului **`.overall_export_metadata`** în GCS.
