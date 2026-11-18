# Platform Super Admin Architecture & Multi-Tier Separation

## 1. The Three Architectural Experiences

The platform enforces three distinct application boundaries:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        1. AGENCY CRM (Daily Use)                       │
│  - Routes: /, /calendar, /share/:id, /p/:id                            │
│  - Users: Real estate brokers, agents, assistants                      │
│  - Purpose: Property catalog, lead crawling, inquiries, visits, docs   │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│                    2. AGENCY ADMINISTRATION (Agency Owner)             │
│  - Route Boundary: /agency/admin                                       │
│  - Users: Agency owner, agency admin                                   │
│  - Purpose: Manage team members, agency branding, local preferences    │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│                   3. PLATFORM SUPER ADMIN (Platform Owner)             │
│  - Route Boundary: /platform/*                                         │
│  - Users: Platform Super Admins, Support Admins                        │
│  - Purpose: Global agencies, domains, analytics, AI usage, audit logs  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Platform Super Admin Routes & Capabilities

All Super Admin routes are mounted under `/platform/*` and protected by `CmpPlatformLayout`:

| Route | View Component | Key Capabilities |
| :--- | :--- | :--- |
| `/platform/dashboard` | `PgPlatformDashboard` | Global KPIs: Total/active agencies, users, AI consumption, storage, recent audit activity. |
| `/platform/agencies` | `PgPlatformAgencies` | Searchable & paginated agency list, status filtering, audited suspension & reactivation. |
| `/platform/agencies/:id`| `PgPlatformAgencyDetail`| Detailed view: General info, members table, lifecycle controls, administrative notes. |
| `/platform/users` | `PgPlatformUsers` | Directory of verified Platform Administrators with explicit decoupling from agency roles. |
| `/platform/domains` | `PgPlatformDomains` | Monitoring of root domain, admin subdomain, agency subdomains, and custom domains. |
| `/platform/analytics` | `PgPlatformAnalytics` | Growth rates, storage capacity utilization, AI monthly quota utilization. |
| `/platform/ai-usage` | `PgPlatformAiUsage` | AI token consumption, request counts, estimated EUR costs per agency (privacy preserved). |
| `/platform/audit-logs` | `PgPlatformAuditLogs` | Immutable log of all administrative actions (actor, action, target, metadata, result). |
| `/platform/settings` | `PgPlatformSettings` | Global platform name, support email, maintenance mode, trial duration. |
| `/agency/admin` | `PgAgencyAdminBoundary` | Dedicated boundary view establishing the Agency Administration experience. |

---

## 3. Strict Authorization & Anti-Escalation Safeguards

- **Backend Enforcement**: Super Admin endpoints under `/api/platform/*` are guarded by `mwAuthentication` and `mwPlatformAuthorization`.
- **Role Invariant**: Roles like `agency_owner` or `agency_admin` **NEVER** grant access to `/api/platform/*` (returns HTTP 403 Forbidden).
- **Audit Logging**: Privileged operations (suspending an agency, updating settings, adding notes) automatically record an immutable entry in `PlatformAuditLogRepository`.

---

## 4. Domain Independence & Configuration

- The platform is **not** hardcoded to any domain name (such as `ourcrm.com`).
- Platform domain settings are configured optionally via:
  - `PLATFORM_ROOT_DOMAIN`: Root domain (optional; unset in development).
  - `PLATFORM_ADMIN_SUBDOMAIN`: Subdomain for Super Admin (default: `admin`).
  - `PLATFORM_PUBLIC_URL`: Public web URL.
- When `PLATFORM_ROOT_DOMAIN` is unset/null, localhost and Cloud Run preview URLs (`*.run.app`) continue to resolve safely.
- Development overrides (`x-tenant-override`, `?simulate_tenant=`) are strictly blocked when `NODE_ENV === "production"`.
