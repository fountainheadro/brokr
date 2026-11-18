# Tenant Domain Resolution Architecture

## 1. Overview

In the multi-tenant real estate SaaS architecture, each independent agency is partitioned and resolved strictly via the request **hostname**. Frontend clients are never trusted to provide an arbitrary `tenant_id` parameter or header for identity determination.

```
                         Incoming HTTP Request
                                  │
                                  ▼
                   Host Header Extraction & Normalization
                    - Lowercase conversion
                    - Port stripping (:3000, :8080)
                    - Trailing dot removal
                                  │
                                  ▼
                     Environment Branch Evaluation
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
        Development / Preview              Production
       (localhost, *.run.app)          (ourcrm.com, custom)
                    │                           │
          Dev Simulation Check        Production Domain Routing
         (x-tenant-override or       - ourcrm.com -> Public Web
         default dev tenant)         - admin.ourcrm.com -> Super Admin
                    │                - {subdomain}.ourcrm.com -> Agency
                    │                - crm.agency.ro -> Custom Domain
                    │                           │
                    │                  Unknown Host Check
                    │               (STRICT REJECT -> 404)
                    └─────────────┬─────────────┘
                                  ▼
                     Verified ResolvedTenantDomain
```

---

## 2. Hostname Normalization Rules

All incoming hostnames undergo deterministic sanitization via `TenantResolutionService.normalizeHost(rawHost)`:
1. Strips any port suffix (e.g. `agency-a.ourcrm.com:3000` -> `agency-a.ourcrm.com`).
2. Trims leading and trailing whitespace.
3. Strips trailing FQDN dots (e.g. `agency-a.ourcrm.com.` -> `agency-a.ourcrm.com`).
4. Converts all characters to lowercase.

---

## 3. Production Domain Mappings

| Domain Pattern | Category | Context Type | Behavior |
| :--- | :--- | :--- | :--- |
| `ourcrm.com`, `www.ourcrm.com` | Platform Root | `public` | Renders the public SaaS marketing website. |
| `admin.ourcrm.com` | Super Admin | `platform_admin` | Renders the platform management dashboard. |
| `{agency}.ourcrm.com` | Agency Subdomain | `agency_crm` | Resolves to the tenant with matching `subdomain`. |
| `crm.{agencydomain}.ro` | Custom Domain | `agency_crm` | Looks up verified custom domain mapping in registry. |
| *Unknown Host* | Unregistered Host | **REJECTED** | Immediately throws `TenantError("TENANT_NOT_FOUND")` returning HTTP 404. |

---

## 4. Development & Preview Environments

In development environments (`localhost`, `127.0.0.1`, `*.run.app`, `*.local`), a secure simulation mechanism is permitted:
- **Simulation Header**: `x-tenant-override: agency-a.ourcrm.com` or `x-tenant-override: agency-a`.
- **Query Parameter**: `?simulate_tenant=agency-a`.
- **Default Fallback**: Resolves to the default primary tenant (`ten_brokr_default`).
- **Production Guard**: In production (`NODE_ENV === "production"`), the dev simulation branch is deactivated; host resolution strictly follows registered DNS hostnames.
