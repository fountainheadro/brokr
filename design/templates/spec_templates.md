# Templates & Pages Specification (Design Layer)

## 1. Templates Overview
Templates arrange organisms into concrete page-level wireframes and layout structures. They define page layout grid, sidebar placement, header behavior, and content scrolling areas without embedding actual domain data.

### 1.1 Agency CRM Workspace Template (`tpl_agency-dashboard`)
- Desktop: Left 240px fixed sidebar + right fluid area (top 50px header + scrollable page content).
- Tablet/Mobile: Top 50px header with mobile drawer toggle + full width scrollable content.

### 1.2 Platform Super Admin Template (`tpl_platform-dashboard`)
- Uses dark slate/indigo platform theme accents.
- Fixed platform header with multi-agency switcher + left navigation + analytics grid layout.

### 1.3 Authentication Template (`tpl_auth-login`)
- Split-screen layout on desktop (left: marketing brand hero with gold gradients; right: centered clean login form).
- Single column stacked layout on mobile.

## 2. Pages Overview
Pages are concrete instances of templates populated with real data, route bindings, and lifecycle hooks. In our architecture, application pages live under `src/pages/`, while `design/pages/` provides visual design blueprints.
