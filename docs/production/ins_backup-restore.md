# Procedură Oficială de Backup, Verificare și Restaurare Firestore / Cloud Storage (Brokr SaaS)

## 1. Țintă Infrastructură
- **Firebase / GCP Project ID**: `brokr-42038`
- **Firestore Database ID**: `ai-studio-e7371a1e-cd74-432c-b244-a7eb8aa7f434`
- **Cloud Storage Bucket (Aplicație)**: `brokr-42038.firebasestorage.app`
- **Bucket Backup Export Dedicat (recomandat)**: `gs://brokr-42038-firestore-backups`

---

## 2. Verificare Pre-Migrare Obligatorie (Poarta de Blocare)
Nicio migrare live în Firestore (`/tenants/{tenantId}/{collection}`) NU trebuie executată fără:
1. Activarea Point-In-Time Recovery (PITR) pe baza Firestore sau finalizarea unui export complet verificat în GCS.
2. Înregistrarea explicită a dovezii de backup în platformă prin Super Admin UI (`/platform/migration`) sau `POST /api/platform/migration/backup/verify`.
3. Validarea accesului IAM al Service Account-ului backend (să NU primească HTTP 403).

---

## 3. Comenzi Oficiale GCP Backup & Export

### A. Verificare Point-In-Time Recovery (PITR)
```bash
gcloud firestore databases describe \
  --project=brokr-42038 \
  --database=ai-studio-e7371a1e-cd74-432c-b244-a7eb8aa7f434
```
Verificați câmpul `pointInTimeRecoveryEnablement: POINT_IN_TIME_RECOVERY_ENABLED`.

Dacă PITR nu este activat:
```bash
gcloud firestore databases update \
  --project=brokr-42038 \
  --database=ai-studio-e7371a1e-cd74-432c-b244-a7eb8aa7f434 \
  --enable-pitr
```

### B. Export Complet Firestore în Cloud Storage (înaintea migrării live)
```bash
EXPORT_TS=$(date -u +"%Y%m%dT%H%M%SZ")
gcloud firestore export "gs://brokr-42038-firestore-backups/pre-phase11-${EXPORT_TS}" \
  --project=brokr-42038 \
  --database=ai-studio-e7371a1e-cd74-432c-b244-a7eb8aa7f434
```

Verificați finalizarea operațiunii:
```bash
gcloud firestore operations list \
  --project=brokr-42038 \
  --database=ai-studio-e7371a1e-cd74-432c-b244-a7eb8aa7f434
```

---

## 4. Procedură de Restaurare (Rollback Date)

### Opțiunea 1 — Rollback Rapid la Nivel de Aplicație (Fără pierdere de date)
Colecțiile root legacy (`/leads`, `/contacts`, `/personal`, `/documents`, `/activities`, `/tours`, `/viewings`, `/counters`, `/notifications`, `/fcm_tokens`) sunt conservate intacte (nu sunt șterse și nici modificate în timpul migrării).
1. Din `/platform/migration`, comutați **Mod Cutover** pe `legacy_rollback_standby` (sau `POST /api/platform/migration/cutover-mode`).
2. `firestore.rules` păstrează activ accesul autentificat pe colecțiile root până la aprobarea umană finală de depreciere.

### Opțiunea 2 — Restaurare Firestore dintr-un Export GCS
**ATENȚIE**: Testați întotdeauna importul mai întâi într-un database / proiect de staging înainte de producție.
```bash
gcloud firestore import "gs://brokr-42038-firestore-backups/<ID_BACKUP>" \
  --project=brokr-42038 \
  --database=ai-studio-e7371a1e-cd74-432c-b244-a7eb8aa7f434
```

### Opțiunea 3 — Restaurare din PITR (Point-In-Time Recovery)
```bash
gcloud firestore databases restore \
  --project=brokr-42038 \
  --source-database="projects/brokr-42038/databases/ai-studio-e7371a1e-cd74-432c-b244-a7eb8aa7f434" \
  --destination-database="brokr-pitr-recovery" \
  --snapshot-time="2026-11-13T12:00:00Z"
```

---

## 5. Permisiuni IAM Necesare pentru Service Account Backend
Service Account-ul configurat în `FIREBASE_SERVICE_ACCOUNT_JSON` sau Cloud Run necesita următoarele roluri pe proiectul `brokr-42038`:
- `roles/datastore.user` (citire/scriere Firestore `/tenants/{tenantId}/*` și root legacy read-only)
- `roles/storage.objectAdmin` pe bucket-ul `brokr-42038.firebasestorage.app`
- `roles/datastore.importExportAdmin` (pentru automatizarea verificării exporturilor)
