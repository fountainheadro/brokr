# Strategie de Backup, Restaurare și Continuitate Operațională — `brokr.`

Acest document definește politica de backup, obiectivele de recuperare (RPO/RTO) și procedurile de restaurare pentru datele critice ale platformei multi-tenant.

---

## 1. Obiective RPO / RTO (Ținte Operaționale)

| Componentă | RPO Țintă | RTO Țintă | Mecanism Principal |
|---|---|---|---|
| **Cloud Firestore (date CRM & state SaaS)** | ≤ 1 minut (PITR) / 24h (Export) | ≤ 60 minute | Firestore Point-in-Time Recovery (PITR) + Export zilnic programat în GCS |
| **Imagini încărcate (`/uploads`)** | ≤ 24h | ≤ 30 minute | Migrație recomandată spre Google Cloud Storage (bucket versionat); backup rsync/snapshot pe volum persistent până la cutover |
| **Configurații & Secrete (`env`)** | 0 (Versionat în Secret Manager) | ≤ 15 minute | Google Cloud Secret Manager cu versionare |

---

## 2. Colecții Persistente Critice (Firestore / `PersistentStoreService`)

### 2.1 Date de Platformă & Control Multi-Tenant (`svc_persistent-store.ts`)
- `tenants/{tenantId}` — datele agențiilor, status, subdomeniu, plan
- `tenants/{tenantId}/users/{userId}` — roluri și status membri
- `tenant_memberships` — maparea persistentă `uid -> tenantId + role`
- `subscriptions` — starea abonamentelor, perioade de grație, planuri
- `billing_events` — jurnale de procesare și chei de idempotență Stripe webhook
- `billing_tenant_state` — stare monotonă anti out-of-order per tenant
- `tenant_usage` & `ai_reservations` — cote lunare AI și rezervări tokeni
- `preview_sessions` — sesiuni active de testare Super Admin
- `ai_configs`, `ai_conversations`, `ai_jobs` — configurații AI per agenție, conversații și joburi asincrone
- `platform_settings` & `platform_audit_logs` — setări globale și trasabilitate audit

### 2.2 Date CRM Operative
- Colecții tenant-scoped țintă: `tenants/{tenantId}/{leads,contacts,personal,documents,tours,activities,viewings}`
- Colecții root aflate în uz activ până la finalizarea migrării live: `leads`, `contacts`, `personal`, `counters`, `documents`, `tours`, `activities`, `viewings`, `notifications`, `fcm_tokens`

---

## 3. Configurare Backup Automat în Cloud Firestore (GCP)

Aceste setări trebuie activate direct în Google Cloud Console / `gcloud` pentru proiectul `brokr-42038` și baza `ai-studio-e7371a1e-cd74-432c-b244-a7eb8aa7f434`:

1. **Activare Point-in-Time Recovery (PITR)**:
   ```bash
   gcloud firestore databases update \
     --database="ai-studio-e7371a1e-cd74-432c-b244-a7eb8aa7f434" \
     --enable-pitr \
     --project="brokr-42038"
   ```
2. **Programare Export Zilnic într-un Bucket GCS Securizat** (`gs://brokr-42038-firestore-backups`, regiune identică cu baza de date, `Uniform bucket-level access`, retenție minimă 30 zile):
   ```bash
   gcloud firestore backups schedules create \
     --database="ai-studio-e7371a1e-cd74-432c-b244-a7eb8aa7f434" \
     --recurrence=daily \
     --retention=30d \
     --project="brokr-42038"
   ```

---

## 4. Procedură de Restaurare și Verificare Periodică

1. **Izolare**: Înainte de restaurare, opriți temporar scrierile critice (sau treceți aplicația în mod mentenanță) dacă incidentul implică corupere logică.
2. **Restaurare în bază nouă sau din snapshot PITR**:
   ```bash
   gcloud firestore databases restore \
     --source-backup="projects/brokr-42038/locations/<LOC>/backups/<BACKUP_ID>" \
     --destination-database="restore-verify-<YYYYMMDD>" \
     --project="brokr-42038"
   ```
3. **Validare post-restaurare**:
   - Verificați numărul de documente din `tenants`, `subscriptions`, `billing_events` și `leads`.
   - Verificați integritatea unei agenții pilot și rulați smoke testele din `ins_deployment-checklist.md`.
4. **Frecvență testare**: Cel puțin o dată pe trimestru într-o bază temporară de staging.
