# Consolidated Project Architecture, Naming & Organization Rules

## 1. Golden Rules of File & Folder Naming

To guarantee absolute consistency across all environments (Linux, macOS, Windows, git case sensitivity) and prevent import collisions:

1. **LOWERCASE ONLY (for all new/modular architecture modules, UI tiers, server modules, docs, and tests)**:
   - File names and folder names must use strictly lowercase ASCII characters (`a-z`, `0-9`).
   - Never use PascalCase in filenames (e.g. `Button.tsx` ❌ -> `atm_button.tsx` ✅).
   - Never use camelCase in filenames (e.g. `useTenant.ts` ❌ -> `use_tenant.ts` ✅).
   - Never use spaces or uppercase letters in filenames or paths.

2. **TWO SEPARATORS ONLY**:
   - **Underscore (`_`) = Hierarchy & Category Separator**
     - Used to delimit hierarchy levels, architectural prefixes, and logical categories.
     - Examples: `atm_button.tsx`, `mol_form-field.tsx`, `org_data-table.tsx`, `tpl_agency-dashboard.tsx`, `svc_tenant-resolution.ts`, `rtr_platform.ts`, `doc_naming-conventions.md`.
   - **Hyphen (`-`) = Siblings, Variants & Multi-Word Name Separator**
     - Used to separate multi-word names, sibling concepts, component variants, modifier states, or sub-specifications within the same hierarchy level.
     - Examples: `atm_input-text.tsx`, `org_tenant-status-card.tsx`, `mol_date-picker.tsx`, `tpl_auth-login.tsx`, `mw_tenant-context.ts`, `sec_public-sanitizer.ts`.

3. **Legacy CRM Cutover Boundary (Preserved Modules)**:
   - Pre-existing single-tenant CRM modules under `src/components/`, `src/services/`, `src/utils/`, `src/lib/`, and legacy root pages (`Home.tsx`, `Calendar.tsx`, `SharedProperty.tsx`) retain their original filenames to preserve live runtime imports and cutover verification inventories (`tests/security/tst_phase11-cutover-and-e2e.ts`).
   - All new features, refactored core modules, Atomic UI components, server modules, docs, and tests strictly follow the prefixed lowercase convention below.

---

## 2. Repository Directory Organization

```text
├── design/          # Design tokens (single source of truth) & markdown specs (spec_*.md only — NO React components)
├── src/
│   ├── ui/          # Executable Atomic Design components: <tier>/<scope>/<prefix>_<name>.tsx + barrel index.ts
│   ├── core/        # Multi-tenant services, repositories, auth/tenant contexts, errors, logger, env, billing
│   ├── pages/       # Route-bound pages (pg_*.tsx in agency/ and platform/, plus preserved legacy CRM pages)
│   ├── components/  # Preserved legacy CRM components (read-only boundary unless bugfix)
│   ├── services/    # Preserved CRM API/tenant-scoped client services
│   ├── utils/       # Preserved domain utilities
│   └── lib/         # Firebase SDK client, auth headers, vCard helpers
├── server/          # Modular Express routers (rtr_*), middleware (mw_*), security (sec_*), AI call & Gemini pipelines
├── ai/              # AI domain rules, tenant policy engine, and quota/cost tracker
├── lib/             # Shared static reference data (Romania zones, property taxonomy, formatting)
├── packages/        # Shared monorepo-style contracts, validation schemas, and domain types (pkg_*)
├── config/          # Platform configuration and module dependency catalog
├── tests/           # Automated security & integration test suites (tst_*.ts)
└── docs/            # Consolidated architectural, database, design, AI, tenancy, and production documentation
```

---

## 3. Complete Prefix Taxonomy

### 3.1 UI & Atomic Design (`src/ui/` & `src/pages/`)

| Tier / Role | Directory Pattern | File Prefix | Example Filename | Exported Symbol |
| :--- | :--- | :--- | :--- | :--- |
| **Atom** | `src/ui/atoms/<scope>/` | `atm_` | `atm_button.tsx` | `AtmButton` |
| **Molecule** | `src/ui/molecules/<scope>/` | `mol_` | `mol_form-field.tsx` | `MolFormField` |
| **Organism** | `src/ui/organisms/<scope>/` | `org_` | `org_data-table.tsx` | `OrgDataTable` |
| **Template** | `src/ui/templates/<scope>/` | `tpl_` | `tpl_agency-dashboard.tsx` | `TplAgencyDashboard` |
| **Scoped Layout Composite** | `src/ui/<scope>/` | `cmp_` | `cmp_platform-layout.tsx` | `CmpPlatformLayout` |
| **Page** | `src/pages/<scope>/` | `pg_` | `pg_design-system-showcase.tsx` | `PgDesignSystemShowcase` |

*Scope Folders*: `common/`, `platform/`, `agency/`.
*Note*: Inside TypeScript/React code, exported components, types, and interfaces retain standard idiomatic **PascalCase** (`export const AtmButton = ...`, `export interface AtmButtonProps`). Only disk filenames are strictly lowercase.

### 3.2 Core Domain, Backend, Security & Tests (`src/core/`, `server/`, `tests/`)

| Layer / Role | Directory Pattern | File Prefix | Example Filename |
| :--- | :--- | :--- | :--- |
| **Service** | `src/core/<domain>/` | `svc_` | `svc_tenant-resolution.ts` |
| **Repository** | `src/core/<domain>/` | `repo_` | `repo_tenant-scoped.ts` |
| **Context / Provider** | `src/core/<domain>/` | `ctx_` | `ctx_tenant.tsx` |
| **Types / Interfaces** | `src/core/<domain>/` | `typ_` | `typ_tenant-context.ts` |
| **Schema / Validator** | `src/core/<domain>/` | `sch_` | `sch_tenant-membership.ts` |
| **Adapter** | `src/core/<domain>/adapters/` | `adp_` | `adp_stripe-billing.ts` |
| **AI Agent / Provider** | `src/core/ai/` | `agt_` | `agt_ai-orchestrator.ts` |
| **Express Router** | `server/<domain>/` | `rtr_` | `rtr_platform.ts` |
| **Express Middleware** | `server/middleware/` | `mw_` | `mw_authentication.ts` |
| **Security Guard** | `server/security/` | `sec_` | `sec_public-sanitizer.ts` |
| **Test Suite** | `tests/<category>/` | `tst_` | `tst_tenant-isolation.ts` |

### 3.3 Documentation & Specifications (`docs/` & `design/`)

| Category | Directory Pattern | File Prefix | Examples |
| :--- | :--- | :--- | :--- |
| **Architecture / Design / Domain Docs** | `docs/<topic>/` | `doc_` | `doc_architecture-overview.md`, `doc_naming-conventions.md`, `doc_tenant-isolation.md`, `doc_ai-governance.md`, `doc_database-conventions.md` |
| **Production Runbooks & Checklists** | `docs/production/` | `ins_` | `ins_deployment-checklist.md`, `ins_cutover-checklist.md`, `ins_backup-recovery.md` |
| **Design Layer Specs** | `design/<tier>/` | `spec_` | `spec_atoms.md`, `spec_molecules.md`, `spec_organisms.md`, `spec_templates.md` |

---

## 4. Barrel Exports & Index Files

Every UI tier/scope directory must expose a lowercase `index.ts` barrel file:
- `src/ui/atoms/{common,agency,platform}/index.ts`
- `src/ui/molecules/{common,platform}/index.ts`
- `src/ui/organisms/{common,agency,platform}/index.ts`
- `src/ui/templates/{agency,platform}/index.ts`
- `src/ui/{agency,platform}/index.ts`
- `design/tokens/index.ts`

When exporting from barrel files, export both the canonical `Atm*` component name and any required backward-compatibility aliases:
```typescript
export { AtmButton, AtoButton } from "./atm_button";
export type { AtmButtonProps, AtoButtonProps } from "./atm_button";
```
