# Atomic Design Methodology & Hierarchy

## 1. Overview

The Multi-Tenant Real Estate CRM Platform adheres to **Atomic Design** principles adapted for modern TypeScript and React applications. UI components are categorized strictly into five hierarchical tiers, segmented across three tenancy scopes:

- **Common (`common/`)**: Generic UI primitives used universally across platform administration, agency workspaces, public pages, and auth flows.
- **Platform (`platform/`)**: Specialized UI elements exclusive to the Super Admin platform management layer (e.g., tenant lifecycle cards, global quota monitors).
- **Agency (`agency/`)**: Specialized UI elements tailored to agency workflows, CRM pipelines, property listings, and agent activities.

---

## 2. The Five Tiers of Atomic Design

```
                     ┌───────────────────┐
                     │       PAGES       │  Specific route instances (e.g., pg_design-system-showcase.tsx)
                     └─────────▲─────────┘
                               │
                     ┌─────────┴─────────┐
                     │     TEMPLATES     │  Full-page layout scaffolding & slots (tpl_*)
                     └─────────▲─────────┘
                               │
                     ┌─────────┴─────────┐
                     │     ORGANISMS     │  Self-contained composite functional units (org_*)
                     └─────────▲─────────┘
                               │
                     ┌─────────┴─────────┐
                     │     MOLECULES     │  Focused combinations of 2+ atoms (mol_*)
                     └─────────▲─────────┘
                               │
                     ┌─────────┴─────────┐
                     │       ATOMS       │  Indivisible foundational primitives (atm_*)
                     └───────────────────┘
```

### Tier 1: Atoms (`atm_*`)
- **Definition**: The fundamental building blocks of the UI that cannot be broken down further without losing their standalone meaning.
- **Examples**: Buttons, inputs, checkboxes, radios, switches, labels, badges, avatars, spinners, skeleton loaders, tooltips, dividers.
- **Rules**:
  - Atoms must NOT import other atoms (with rare exceptions like Tooltip wrapping an element or Button displaying a Spinner).
  - Atoms must never make network requests or import business models.
  - Atoms receive raw props and callbacks; they are fully controlled or uncontrolled primitives.

### Tier 2: Molecules (`mol_*`)
- **Definition**: Combinations of two or more atoms bound together to serve a specific, focused user interface responsibility.
- **Examples**: Form fields (label + input + error message), search boxes (input + search icon + clear button + shortcut badge), user blocks (avatar + name + role + status indicator), pagination bars, breadcrumbs, confirmation dialog boxes, file upload dropzones.
- **Rules**:
  - Molecules combine atoms to handle localized interactions (e.g., clear search, toggle dropdown).
  - Molecules must remain decoupled from specific backend endpoints or tenant entities.

### Tier 3: Organisms (`org_*`)
- **Definition**: Complex, self-contained sections of the interface composed of molecules, atoms, and other organisms.
- **Examples**: Navigation sidebars, top headers, data tables with pagination and search, modal base dialogs, slide-over drawers, metric stat cards, activity timelines, lead quick-cards.
- **Rules**:
  - Organisms manage composite layout and coordinate interactions across child molecules.
  - Organisms can accept structured data (e.g., array of table columns and records) but should remain agnostic of direct state store mutations where possible, utilizing callback props or context providers.

### Tier 4: Templates (`tpl_*`)
- **Definition**: Page-level scaffolding and layout structures that arrange organisms into a cohesive layout grid without hardcoding actual domain entities.
- **Examples**: `tpl_agency-dashboard`, `tpl_agency-management`, `tpl_platform-dashboard`, `tpl_platform-management`, `tpl_auth-login`.
- **Rules**:
  - Templates define slots (`sidebarSlot`, `headerSlot`, `children`, `footerSlot`).
  - Templates handle responsive screen breakpoints (mobile drawer toggling, desktop sidebar docking).
  - Templates contain zero domain business logic or direct API data fetching.

### Tier 5: Pages (`pg_*`)
- **Definition**: Concrete page instances bound to React Router routes that connect templates with real backend data, tenant context, hooks, and business logic.
- **Examples**: `pg_design-system-showcase`, property catalog, tenant management.

---

## 3. Strict Rules of Composition

1. **Downwards Dependency Only**:
   - Organisms can import Molecules, Atoms, and Tokens.
   - Molecules can import Atoms and Tokens.
   - Atoms can ONLY import Tokens.
   - Higher levels must never be imported into lower levels (e.g., an atom importing a molecule or organism is strictly forbidden).

2. **Cross-Scope Rules**:
   - `platform/` and `agency/` components may import from `common/`.
   - `common/` components MUST NEVER import from `platform/` or `agency/`.
   - `platform/` components must NEVER import from `agency/` (and vice-versa).

3. **Separation of Design and Implementation**:
   - `design/` contains pure token definitions (`design/tokens/`) and human-readable specifications (`design/atoms/spec_atoms.md`, etc.).
   - `src/ui/` contains executable, typed React components (`src/ui/atoms/`, `src/ui/molecules/`, etc.).
   - Application code must never import markdown specs; it imports tokens from `design/tokens` and components from `src/ui/`.
