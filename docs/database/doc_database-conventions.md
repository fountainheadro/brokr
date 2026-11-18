# Database Access & Schema Conventions

## 1. Storage Structure
Cloud Firestore stores tenant data in isolated document subcollections:
```
/tenants/{tenantId}
  ├── /users/{userId}
  ├── /staff/{staffId}
  ├── /leads/{leadId}
  ├── /properties/{propertyId}
  ├── /requests/{requestId}
  ├── /contacts/{contactId}
  ├── /activities/{activityId}
  ├── /documents/{documentId}
  └── /ai_usage/{usageId}
```

## 2. Global Collections (Super Admin)
- `/platform_plans/{planId}`: Plan definitions, pricing, module entitlements, and quota allowances.
- `/platform_audit_logs/{logId}`: Global audit log for security events and plan modifications.

## 3. Entity Conventions
Every document written through `TenantScopedRepository` enforces canonical `camelCase` metadata (with read-only fallback for legacy `snake_case` records):
- `id`: Unique identifier (string).
- `tenantId`: Immutable tenant scoping key.
- `createdAt`: Server timestamp of creation.
- `updatedAt`: Server timestamp of last edit.
- `createdBy` / `updatedBy`: User ID of the actor.
- `deletedAt`: Nullable timestamp for soft deletes.
