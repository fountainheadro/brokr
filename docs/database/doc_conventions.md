# Database Access & Schema Conventions

## 1. Storage Structure
Cloud Firestore stores tenant data in isolated document subcollections:
```
/tenants/{tenant_id}
  ├── /users/{user_id}
  ├── /leads/{lead_id}          (Leads L*, Properties P*, Requests R*)
  ├── /contacts/{contact_id}
  ├── /staff/{staff_id}         (Standardized from legacy "personal")
  ├── /documents/{document_id}
  ├── /activities/{activity_id}
  ├── /tours/{tour_id}
  ├── /viewings/{viewing_id}
  ├── /notifications/{notification_id}
  ├── /fcm_tokens/{token_id}
  ├── /counters/{counter_id}
  └── /ai_usage/{usage_id}
```

## 2. Global Collections (Super Admin)
- `/platform_plans/{plan_id}`: Plan definitions, pricing, module entitlements, and quota allowances.
- `/platform_audit_logs/{log_id}`: Global audit log for security events and plan modifications.

## 3. Entity & Field Casing Conventions
Every document written through `TenantScopedRepository` or `CrmTenantStoreService` uses strict **US English `snake_case`** keys:
- `id`: Unique identifier (string).
- `tenant_id`: Immutable tenant scoping key.
- `created_at`: Server timestamp / ISO string of creation.
- `updated_at`: Server timestamp / ISO string of last edit.
- `created_by` / `updated_by`: User ID of the actor.
- `deleted_at`: Nullable timestamp for soft deletes.

Legacy `camelCase` and Romanian keys from earlier records are transparently normalized on read via `normalize_crm_document` and `normalize_crm_data` so zero existing data is lost.
