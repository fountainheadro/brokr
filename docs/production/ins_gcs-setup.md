# Google Cloud Storage Setup & Security Specification

> **Notă operațională**: Configurația din `firebase-applet-config.json` referențiază bucket-ul `brokr-42038.firebasestorage.app`, iar aplicația include stratul complet `CloudStorageService` + `/api/storage/*`. Bucket-ul live și permisiunile IAM trebuie verificate/provisionate în GCP înainte de activarea în producție (codul folosește fallback local izolat atunci când nu există credențiale GCS sau `GCS_EMULATOR_HOST`).

---

## 1. Bucket Provisioning & Region

- **Nume bucket recomandat**: `brokr-42038.firebasestorage.app` (sau bucket dedicat prin `GCS_BUCKET_NAME`)
- **Regiune recomandată**: `europe-west3` (Frankfurt) sau aceeași regiune cu instanțele Cloud Run și baza de date Firestore pentru latență minimă.
- **Control acces**:
  - Activează **Uniform Bucket-Level Access (UBLA)** (`uniformBucketLevelAccess: true`) astfel încât ACL-urile per-obiect să fie dezactivate și toate permisiunile să fie controlate exclusiv prin IAM.
  - Activează **Public Access Prevention (`enforced`)** pe bucket-ul principal pentru documente private; imaginile publice de listări sunt livrate controlat prin `/api/storage/media/...` sau proiecții dedicate.

---

## 2. IAM Least-Privilege Configuration

Contul de serviciu al aplicației backend (ex: Cloud Run runtime service account sau `FIREBASE_SERVICE_ACCOUNT_JSON`):

- `roles/storage.objectAdmin` strict pe bucket-ul aplicației (NU la nivel de proiect întreg dacă există alte bucket-uri sensibile) **SAU**:
  - `roles/storage.objectCreator` + `roles/storage.objectViewer` (dacă ștergerile sunt gestionate prin lifecycle / soft-delete).
- Dacă se generează Signed URLs V4 direct prin IAM fără cheie privată locală:
  - `roles/iam.serviceAccountTokenCreator` pe propriul service account.
- **Interzis**: Nu acorda `roles/owner`, `roles/editor` sau `allUsers` (`Storage Object Viewer` public) pe bucket-ul care conține `/tenants/*/documents/*`.

---

## 3. Tenant Folder Structure & Visibility Separation

Toate obiectele sunt izolate strict sub prefixul server-verificat al tenantului:

- `tenants/{tenantId}/properties/{propertyId}/{fileName}` — **Imagini proprietăți** (`visibility: "public_listing"` pentru anunțuri partajabile + OpenGraph).
- `tenants/{tenantId}/documents/{documentId}/{fileName}` — **Documente private agenție/clienți** (`visibility: "private"`, accesibile exclusiv prin endpoint-uri autentificate pe `TenantContext` sau linkuri semnate temporar HMAC-SHA256).
- `tenants/{tenantId}/users/{userId}/{fileName}` — **Fișiere utilizatori** (`visibility: "private"`).

---

## 4. Environment Variables (`.env.example`)

```env
GCS_BUCKET_NAME=brokr-42038.firebasestorage.app
GCS_BUCKET_LOCATION=europe-west3
STORAGE_SIGNING_SECRET=<cheie-random-64-hex>
```

---

## 5. Lifecycle, Versioning & CORS

- **Object Versioning**: Activare recomandată pe bucket pentru protecție împotriva suprascrierilor accidentale.
- **Lifecycle rules**:
  - Ștergere versiuni non-curente după 30–90 zile pentru controlul costurilor.
  - Curățare fișiere temporare / soft-deleted după perioada de retenție agreată.
- **CORS (doar dacă se va activa upload direct din browser)**:
  - Restricționat strict la domeniile platformei (`https://<tenant>.brokr.ro`, `https://admin.brokr.ro`), metode `PUT`/`GET`, `maxAgeSeconds: 3600`.
  - În arhitectura curentă, toate încărcările trec prin backend (`POST /api/upload-photo` și `POST /api/storage/documents/upload`) pentru validare magic-bytes, curățare watermark și derivarea server-side a `tenantId`.
