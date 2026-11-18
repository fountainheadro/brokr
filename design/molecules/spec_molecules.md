# Molecules Specification (Design Layer)

## 1. Overview
Molecules combine two or more atoms to form cohesive, single-purpose UI controls. They remain reusable across different business domains without containing workflow business logic.

## 2. Component Specifications

### 2.1 Form Field (`mol_form-field`)
- Combines: `atm_label`, input control (`atm_input-text`, `atm_textarea`, or `atm_select`), and optional `atm_form-error`.
- Vertical layout with 4px gap between label and control, 4px gap between control and error/hint text.
- Supports required indicator asterisk (*).

### 2.2 Search Field (`mol_search-field`)
- Combines: `atm_input-text`, Search icon, Clear button, and optional shortcut key badge (e.g. `⌘K`).
- Responsive: Expands to full container width or fixed width (e.g. 240px) on desktop headers.

### 2.3 Dropdown Menu (`mol_dropdown-menu`)
- Combines: Trigger button/anchor, floating container with shadow `md`, menu items with hover background `#f9fafb`, dividers, and check/chevron icons.
- Keyboard accessible: Esc to dismiss, Arrow keys for focus traversal.

### 2.4 Pagination (`mol_pagination`)
- Combines: Previous/Next icon buttons, numbered page buttons, and count indicator (e.g. "Pagina 1 din 14").
- Compact mode for mobile, expanded mode for desktop tables.

### 2.5 Empty & Error States (`mol_empty-state`, `mol_error-state`)
- `mol_empty-state`: Centered container with 48x48px muted icon, 14px bold title, 12px secondary text, and primary action button.
- `mol_error-state`: Banner or card with rose border, alert icon, description, and "Încearcă din nou" retry button.

### 2.6 Confirmation Dialog Content (`mol_confirmation-dialog`)
- Combines: Warning/Danger icon badge, confirmation heading, explanatory body text, Cancel secondary button, and Confirm/Delete primary button.
