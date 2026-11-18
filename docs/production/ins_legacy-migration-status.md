# Status Real al Migrării Colecțiilor Legacy — `brokr.`

Acest document prezintă **starea tehnică exactă, verificată în cod** a tranziției dintre colecțiile Firestore root (pre-SaaS) și structura izolată multi-tenant `/tenants/{tenantId}/*`.

---

## 1. Concluzia Auditului de Cod (Faza 9)

**Colecțiile root legacy NU pot fi șterse în acest moment fără a întrerupe CRM-ul existent.**

Motivul tehnic verificat:
1. Serviciile active ale aplicației frontend (`src/services/leadsService.ts`, `contactsService.ts`, `personalService.ts`, etc.) citesc și scriu în continuare direct în colecțiile Firestore de la nivel root (`leads`, `contacts`, `personal`, `counters`, `documents`, `tours`, `activities`, `viewings`, `notifications`, `fcm_tokens`).
2. Serviciul de migrare introdus în Faza 7 (`src/core/migration/svc_crm-migration.ts`, prin metoda `CrmMigrationService`) operează în prezent exclusiv asupra datelor demonstrative / in-memory din mediul de testare/dry-run și **nu a executat o copiere live a colecțiilor reale de producție** către `/tenants/{tenantId}/*`.

---

## 2. Măsuri Aplicative de Securizare Aplicată în Faza 9 (Fără Regresie)

Pentru a elimina riscul critic identificat în Faza 8 fără a sparge fluxurile CRM existente:

1. **Eliminarea accesului public anonim (`allow read: if true`)**:
   - În `firestore.rules`, colecția `/leads/{leadId}` a fost restrânsă la `allow read: if isSignedIn();` (unde `isSignedIn()` impune acum și `request.auth.token.email_verified == true`).
2. **Protecția partajării publice (`/share/:id`) cu sanitizare PII**:
   - Endpoint-ul backend `/api/public-property/:id` (și `/api/og-image/:id`) utilizează token OAuth2 server-side (când este configurat `FIREBASE_SERVICE_ACCOUNT_JSON` / `GOOGLE_APPLICATION_CREDENTIALS` / `USE_GCP_METADATA_AUTH=true`) și trece documentul prin `sanitizePublicProperty()` (`server/security/sec_public-sanitizer.ts`), eliminând câmpurile private ale proprietarului (`ownerName`, `ownerPhone`, `proprietar`, `memoPrivat`, `comisioane` etc.).
3. **Restrângerea `/fcm_tokens/{tokenId}` la proprietar**:
   - Citirea, crearea, actualizarea și ștergerea token-urilor FCM sunt permise exclusiv pentru `userId == request.auth.uid || isPlatformAdmin()`.
4. **Blocarea accesului Client SDK la colecțiile SaaS de control**:
   - `preview_sessions`, `billing_events`, `billing_tenant_state`, `subscriptions`, `tenant_usage`, `ai_reservations`, `ai_jobs`, `ai_conversations` au `allow read, write: if false;` în `firestore.rules`.

---

## 3. Plan Fazat de Cutover Definitiv către `/tenants/{tenantId}/*`

Pentru a putea elimina complet regulile root din `firestore.rules`:

1. **Etapa 1 — Migrator Live Idempotent (Backend)**:
   - Extindeți `CrmMigrationService` să citească toate documentele reale din colecțiile root prin Firestore REST/Admin SDK, cu checkpoint-uri per colecție și atribuire obligatorie `tenantId`.
   - Rulați `dry-run` pe datele reale și verificați 100% maparea numerică + referințele între `leads`, `contacts`, `activities`, `viewings` și `documents`.
2. **Etapa 2 — Dual-Read / Cutover Servicii Frontend**:
   - Actualizați `leadsService`, `contactsService` etc. să citească/scrie sub `/tenants/{tenantId}/...` folosind `TenantContext` activ.
   - Monitorizați 7 zile absența completă a accesărilor pe colecțiile root.
3. **Etapa 3 — Decommission Reguli Root**:
   - Arhivați snapshot-ul final al colecțiilor root în GCS.
   - Înlăturați blocurile `match /leads/{leadId}`, `match /contacts/{contactId}` etc. din `firestore.rules` (lăsând exclusiv `/tenants/{tenantId}/...` și safety net-ul global `allow read, write: if false;`).
