# Tenant Membership & Role-Based Access Control (RBAC)

## 1. Overview

Authentication through Firebase provides identity (`uid`, `email`), but does **not** grant authorization to access any agency data. Authorization is derived strictly through the **Tenant Membership** record located at:

`/tenants/{tenant_id}/users/{user_id}`

---

## 2. Membership Status Model

| Status | Meaning | Access to Agency CRM |
| :--- | :--- | :--- |
| `invited` | Member invitation created, pending initial confirmation | **Blocked (403)** |
| `active` | Active, authorized agency team member | **Granted** |
| `suspended` | Membership temporarily frozen by agency admin | **Blocked (403)** |
| `revoked` | Membership permanently terminated | **Blocked (403)** |

---

## 3. Agency Tenant Status Model

| Status | Meaning | Access Allowed |
| :--- | :--- | :--- |
| `trial` | Free or onboarding trial period | Allowed for active members |
| `active` | Active paying subscription | Allowed for active members |
| `pending` | Pending initial payment or domain activation | Suspended |
| `suspended` | Suspended due to billing failure or quota breach | **Blocked for all members (403)** |
| `cancelled` | Subscription cancelled | **Blocked for all members (403)** |

---

## 4. Supported Roles

1. `agency_owner`: Full administrative privileges over the agency, including billing, branding, modules, and member management.
2. `agency_admin`: Operational administrator. Can manage users, listings, contacts, and settings. Cannot demote or delete an `agency_owner`.
3. `manager`: Team lead or department manager. Can review and assign leads and view team performance.
4. `agent`: Real estate broker/agent. Access to leads, properties, viewing calendar, and customer communications.
5. `assistant`: Administrative support. Can schedule viewings, enter documents, and assist with property records.

---

## 5. Security Invariants & Anti-Escalation Safeguards

- **No Self-Promotion**: A user cannot modify their own `role` or `status` under any circumstances.
- **Admin Isolation**: Only an `agency_owner` or `agency_admin` can modify the role of another team member.
- **Owner Invariant**: An `agency_owner` can only be modified by another `agency_owner`.
- **Multi-Tenant Users**: A user identity may belong to multiple agencies simultaneously. When accessing Agency A via `agency-a.ourcrm.com`, only their membership in Agency A is evaluated. Access to Agency B's data remains strictly denied.
