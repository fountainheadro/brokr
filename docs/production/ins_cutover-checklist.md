# Production Cutover Checklist — Legacy Root Collections & File Storage

> **Status curent**: Pregătire și validare completate în Faza 10. **Cutover-ul final în producție NU a fost executat încă.** Regulile legacy din `firestore.rules` și fișierele locale `/uploads` sunt păstrate intacte până la parcurgerea completă a tuturor pașilor de mai jos.

---

## 1. Pre-Migration Backup & Snapshot

- [ ] Exportă un backup complet Firestore al tuturor colecțiilor root (`/leads`, `/contacts`, `/personal`, `/documents`, `/activities`, `/tours`, `/viewings`, `/counters`, `/notifications`, `/fcm_tokens`) în Cloud Storage înainte de orice migrare live (`gcloud firestore export gs://<backup-bucket>/pre-cutover-<YYYYMMDD>`).
- [ ] Arhivează snapshot-ul directorului `/uploads` (dacă există fișiere pe instanțele de producție curente).
- [ ] Verifică starea variabilelor obligatorii din `.env.example`: `FIREBASE_SERVICE_ACCOUNT_JSON` / `GOOGLE_APPLICATION_CREDENTIALS`, `GCS_BUCKET_NAME`, `STORAGE_SIGNING_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `GEMINI_API_KEY`.

---

## 2. Dry-Run Validation & Manual Ownership Review

- [ ] Rulează inventarul live prin `GET /api/platform/migration/inventory` și verifică numărul real de documente din fiecare colecție root.
- [ ] Rulează migrarea în modul `dry_run` (`POST /api/platform/migration/dry-run`) cu verificarea strictă a proprietății (`strictOwnershipRequired: true`).
- [ ] Inspectează toate înregistrările marcate `requiresManualReview` (documente fără `tenantId`, cu referințe lipsă sau aparținând unor utilizatori multi-agenție).
- [ ] Rezolvă manual sau confirmă explicit apartenența inițială (`ten_brokr_default` pentru datele pre-SaaS ale agenției inițiale Brokr) înainte de executarea live.
- [ ] Rulează `POST /api/platform/migration/files/dry-run` pentru a valida planul de migrare a fișierelor locale în bucket-ul GCS.

---

## 3. Live Migration & Post-Migration Verification

- [ ] Rulează migrarea datelor în mod `live` (`POST /api/platform/migration/execute`), cu checkpoint-uri persistente salvate după fiecare batch în `migration_checkpoints`.
- [ ] Dacă procesul este întrerupt, reia exclusiv prin `POST /api/platform/migration/resume/:id` (nu re-rula manual fără verificare).
- [ ] Rulează validarea independentă post-migrare (`POST /api/platform/migration/validate`) și confirmă `allPassed: true` (`totalMissing === 0`, `totalMismatched === 0`, `totalDuplicates === 0`, `totalBrokenReferences === 0`, zero conflicte nerezolvate).
- [ ] Rulează migrarea fișierelor (`POST /api/platform/migration/files/execute`) și confirmă verificarea SHA-256 + dimensiune pe fiecare obiect încărcat.
- [ ] Verifică funcționarea `/api/public-property/:id`, `/api/og-image/:id`, `/api/storage/media/...` și descărcările private semnate pe mediul de staging/producție.

---

## 4. Safe Cutover to Tenant-Scoped Collections

- [ ] Refactorizează serviciile frontend (`leadsService`, `contactsService`, `personalService`, `documentService`, `activityService`, `viewingsService`, `entityIdService`, `notificationsService`) pentru a folosi `/tenants/{tenantId}/{collection}` în locul colecțiilor root.
- [ ] Actualizează `server.ts` (`fetchPropertyById`) și `server/background-notifications.ts` să citească proiecțiile și subcolecțiile tenant-scoped.
- [ ] Verifică `GET /api/platform/migration/cutover-readiness` până când `safeToDisableLegacyRules === true` și lista `blockers` este complet goală.
- [ ] Implementează o perioadă de monitorizare post-cutover (citire din tenant subcollections cu fallback/audit pe erori 404/permission-denied) înainte de a elimina accesul la colecțiile root din `firestore.rules`.

---

## 5. Rollback Plan & Legacy Rule Removal Gate

### Plan de Rollback
1. **Dacă apar erori în serviciile tenant-scoped după cutover-ul frontend**:
   - Datele originale din colecțiile root și fișierele locale NU au fost șterse niciodată în timpul migrării.
   - Comută aplicația înapoi pe versiunea anterioară a serviciilor frontend/backend și verifică activitatea pe colecțiile root (care au rămas intacte).
   - Compară eventualele scrieri noi realizate în `/tenants/{tenantId}/...` în timpul ferestrei de cutover înainte de reconciliere.

### Condiții obligatorii înainte de dezactivarea regulilor legacy în `firestore.rules`
1. `allPassed === true` în raportul final de validare post-migrare pe Firestore live.
2. Zero servicii CRM active pe frontend sau backend mai citesc/scriu în colecțiile root (`/leads`, `/contacts`, `/personal`, `/documents`, `/activities`, `/tours`, `/viewings`, `/counters`, `/notifications`).
3. Toate linkurile publice `/api/public-property/:id`, `/api/og-image/:id` și cron-ul `background-notifications` funcționează exclusiv pe structura tenant-scoped.
4. Abia apoi se blochează colecțiile root în `firestore.rules` (`allow read, write: if false;`), păstrând un snapshot de arhivă al datelor vechi conform politicii de retenție.
