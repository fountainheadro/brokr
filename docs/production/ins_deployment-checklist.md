# Checklist de Deployment în Producție — Platforma SaaS Multi-Tenant `brokr.`

Acest document acoperă cerințele tehnice, variabilele de mediu, configurările externe obligatorii și pașii de verificare înainte și după lansarea în producție.

---

## 1. Variabile de Mediu Obligatorii (`NODE_ENV=production`)

Validarea la pornire este executată automat prin `assertProductionEnvironment()` (`src/core/env/svc_production-config.ts`). Serverul **refuză pornirea** (`fail-fast`) dacă lipsesc credențialele critice:

| Variabilă | Obligativitate | Scop |
|---|---|---|
| `NODE_ENV` | Obligatoriu (`production`) | Activează logarea JSON structurată cu redactare PII/secrete, fail-closed pe Stripe/Twilio/Preview Mode și verificarea strictă a mediului. |
| `GEMINI_API_KEY` | Obligatoriu | Cheie server-side Google Gemini API (nu se expune niciodată cu prefix `VITE_`). |
| `STRIPE_SECRET_KEY` | Obligatoriu* | Cheie API Stripe (`sk_live_...`) pentru checkout și portal billing. |
| `STRIPE_WEBHOOK_SECRET` | Obligatoriu* | Secret semnătură HMAC webhook Stripe (`whsec_...`). |
| `ALLOW_MOCK_BILLING_IN_PRODUCTION` | Recomandat `false` | Dacă rămâne `false` (implicit), plățile/webhook-urile mock sunt blocate. |
| `FIREBASE_PROJECT_ID` | Obligatoriu | ID proiect Firebase (ex. `brokr-42038`, sau citit din `firebase-applet-config.json`). |
| `FIRESTORE_DATABASE_ID` | Recomandat | ID bază Firestore (ex. `ai-studio-e7371a1e-cd74-432c-b244-a7eb8aa7f434`). |
| `FIREBASE_SERVICE_ACCOUNT_JSON` / `GOOGLE_APPLICATION_CREDENTIALS` / `USE_GCP_METADATA_AUTH=true` | Obligatoriu pentru multi-instanță și `/api/public-property/:id` | Furnizează token OAuth2 server-side pentru `PersistentStoreService` (inclusiv lock atomic `:commit` cu `exists: false`) și citirea proprietăților partajate după eliminarea `allow read: if true` pe `/leads`. |
| `PLATFORM_ROOT_DOMAIN` | Obligatoriu pentru subdomenii | Domeniul rădăcină multi-tenant (ex. `brokr.ro`). |
| `PLATFORM_ADMIN_SUBDOMAIN` | Recomandat (`admin`) | Subdomeniul consolei Super Admin (`admin.brokr.ro`). |
| `APP_URL` / `PLATFORM_PUBLIC_URL` | Obligatoriu dacă există Twilio/OG | URL-ul public HTTPS folosit la reconstrucția URL-ului canonic pentru `X-Twilio-Signature` și linkuri de partajare. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | Opțional, dar **pereche completă** | Dacă modulul AI Call este activat, `TWILIO_ACCOUNT_SID` și `TWILIO_AUTH_TOKEN` trebuie setate împreună (altfel startup-ul eșuează). |
| `ALLOW_PREVIEW_MODE_IN_PRODUCTION` | Implicit `false` | Dezactivează crearea/interceptarea sesiunilor `Agency Preview` în producție. Activați temporar doar pentru diagnoză controlată, apoi reveniți la `false`. |

\* Obligatoriu dacă `ALLOW_MOCK_BILLING_IN_PRODUCTION` nu este setat explicit `true`.

---

## 2. Configurări Externe Obligatorii (Înainte de Primul Trafic Real)

1. **Firebase / Firestore Security Rules**:
   - Rulați `npx eslint firestore.rules` și verificați 0 erori.
   - Publicați `firestore.rules` în proiectul Firebase țintă (`firebase deploy --only firestore:rules` sau prin AI Studio `deploy_firebase`).
   - Verificați că în Firebase Console -> Authentication, utilizatorii au `email_verified = true` (regula `isSignedIn()` necesită acum verificarea adresei de email).
2. **Firebase Service Account / IAM**:
   - Atașați un Service Account cu rol `Cloud Datastore User` (sau configurați `FIREBASE_SERVICE_ACCOUNT_JSON` / Workload Identity pe Cloud Run cu `USE_GCP_METADATA_AUTH=true`).
   - Fără credențiale server-side, `PersistentStoreService` scrie doar pe discul local al containerului, iar `/api/public-property/:id` nu va putea citi `/leads` după eliminarea `allow read: if true`.
3. **Stripe Live Webhooks**:
   - Configurați endpoint-ul `https://<domeniu>/api/billing/webhook` în Stripe Dashboard cu evenimentele:
     - `checkout.session.completed`
     - `invoice.payment_succeeded`
     - `invoice.payment_failed`
     - `customer.subscription.deleted`
   - Setați `STRIPE_WEBHOOK_SECRET` cu secretul `whsec_...` corespunzător.
4. **Twilio Voice & Media Streams**:
   - Configurați webhook-ul Twilio să apeleze `https://<domeniu>/api/ai-call/twiml`.
   - Setați `PLATFORM_PUBLIC_URL` exact la URL-ul extern HTTPS (terminat fără `/` la final) pentru potrivirea exactă a `X-Twilio-Signature` în spatele reverse proxy-ului.
5. **Domain / TLS / Reverse Proxy**:
   - Verificați wildcard DNS (`*.brokr.ro`) și certificatul TLS valid pentru toate subdomeniile de agenții + `admin.brokr.ro`.
   - Proxy-ul trebuie să transmită `X-Forwarded-Proto: https` și `X-Forwarded-Host`.

---

## 3. Verificări Pre-Deploy (Automated Checks)

Executați local / în CI înainte de promovare:

```bash
npx eslint firestore.rules
npm run lint
npm test
npm run build
```

Verificați explicit că bundle-ul frontend (`dist/assets/`) nu conține secrete de server (`GEMINI_API_KEY`, `STRIPE_SECRET_KEY`, `TWILIO_AUTH_TOKEN`, `FIREBASE_SERVICE_ACCOUNT_JSON`).

---

## 4. Verificări Post-Deploy (Smoke Tests)

1. `GET /api/health` -> răspunde `200 OK` cu `{ "status": "ok" }`.
2. Încercați acces neautentificat la `/api/platform/tenants` -> trebuie să returneze `401 Unauthorized`.
3. Încercați un request către `/api/proxy-image?url=http://169.254.169.254/latest/meta-data/` -> trebuie să returneze `400` (blocat SSRF).
4. Verificați `/api/public-property/<lead_id_existent>` -> returnează datele anunțului **fără** câmpuri private (`ownerName`, `ownerPhone`, `proprietar`, `memoPrivat`, `comisioane`).
5. Verificați `/api/platform/observability/metrics` (cu cont Super Admin autentic) -> returnează contoare de sănătate și latențe HTTP.
6. Testați login + creare lead + salvare setări AI cu un cont verificat și confirmați absența erorilor în loguri.
