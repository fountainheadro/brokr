# Organisms Specification (Design Layer)

## 1. Overview
Organisms are distinct, complex UI sections composed of groups of molecules and atoms. They form complete functional regions such as navigation headers, sidebars, data tables, modal dialogs, and metric overviews.

## 2. Component Specifications

### 2.1 Navigation Sidebar (`org_navigation-sidebar`)
- **Structure**:
  - Header: Agency or Platform logo + tenant name.
  - Body: Scrollable navigation groups (e.g. CRM, Agendă, Management) with active pill indicators and counters.
  - Footer: Collapse toggle button and compact user profile avatar block.
- **Responsive**: 240px expanded on desktop, collapses to 64px or converts to slide-out drawer on tablet/mobile.

### 2.2 Top Bar (`org_top-bar`)
- **Structure**:
  - Left: Mobile hamburger menu toggle + page title or breadcrumb navigation.
  - Center: Global search field with `⌘K` trigger.
  - Right: Agency status pill, notification bell icon with unread badge, and user dropdown menu.
- **Height**: Fixed 50px (`spacing.layout.headerHeight`), sticky z-index 1100.

### 2.3 Data Table (`org_data-table`)
- **Structure**:
  - Header: Column titles with sorting indicator arrows.
  - Rows: Alternating hover state, zebra option, selection checkboxes, cell formatting.
  - Loading: Animated skeleton rows.
  - Footer: Integrated `mol_pagination`.

### 2.4 Modal Dialog Layout (`org_modal-base`)
- **Structure**: Fixed backdrop (rgba(0,0,0,0.5) with blur), centered dialog card (max-w-md to max-w-4xl), header with title and close button, scrollable body, and sticky footer action buttons.
- **Animation**: Fade + scale (0.95 to 1.0) with ease-out.

### 2.5 Slide-Out Drawer (`org_drawer-base`)
- **Structure**: Slide-in panel from right viewport edge, 400px to 600px width, sticky header, scrollable body, sticky actions footer.
- **Animation**: Slide from x: 100% to x: 0% with 0.3s ease-out.
