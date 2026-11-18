# Architecture Overview - Multi-Tenant Real-Estate SaaS CRM

## 1. High-Level Vision
This application is architected as a **modular monolith** serving multiple independent real-estate agencies from a single codebase and shared database, while ensuring complete logical and cryptographic tenant data isolation.

## 2. Core Architectural Pillars
- **A. Design System (`design/`)**: Single source of truth for design tokens (colors, typography, spacing, radius, shadows, motion) and Atomic Design component specifications.
- **B. Application Code (`src/` & `packages/`)**: Feature-driven business logic, typed database access, environment configuration, and centralized error handling.
- **C. AI Subsystem (`ai/`)**: Tenant-isolated Gemini operations, quota enforcement, prompt policies, and detailed usage/cost tracking.
- **D. Static Libraries (`lib/`)**: Reusable global reference data (geographical zones, real-estate types, standard formatting).

## 3. Layer Separation
1. **Presentation (UI)**: Atomic Design (`atoms`, `molecules`, `organisms`, `templates`, `pages`) in `src/ui/` and `src/pages/` with React 19, Motion, and Tailwind CSS.
2. **Tenancy Resolution**: Hostname and domain resolution mapping requests to tenant contexts (`public`, `platform_admin`, `agency_crm`).
3. **Application Services**: Decoupled feature services (`svc_lead`, `svc_contact`, `svc_staff`, `svc_activity`, `svc_document`, `svc_viewing`, `svc_tour`, `svc_notification`).
4. **Data Access (Repositories)**: `TenantScopedRepository` & `CrmTenantStoreService` guaranteeing all read/write operations strictly bind to `/tenants/{tenant_id}/...`.
5. **Infrastructure**: Express backend, Cloud Firestore, Cloud Storage, and official `@google/genai` SDK.
