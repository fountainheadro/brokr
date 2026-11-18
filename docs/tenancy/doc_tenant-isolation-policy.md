# Multi-Tenancy & Data Isolation Policy

## 1. Tenant Resolution
- Tenants are resolved from incoming request hostnames:
  - Root platform domain: Public website and marketing.
  - Admin subdomain (`admin.*`): Platform Super Admin portal.
  - `{subdomain}.*`: Agency-specific workspace.
  - `{custom_domain}`: Custom agency domain mapped to a registered `tenant_id`.

## 2. Server-Side Security
- Never trust client-supplied `tenant_id` parameters.
- User authentication tokens include Firebase Custom Claims (`tenant_id`, `role`).
- All database operations are authenticated server-side or validated via Firestore Security Rules where `isTenantMember(tenantId)` and `isTenantActive(tenantId)` hold.

## 3. Quota & Downgrade Protection
- Downgrading a subscription plan **never** deletes existing agency records.
- When an agency exceeds plan limits, creation of new records is restricted with clear UI messaging, while existing data remains read-accessible and editable.
