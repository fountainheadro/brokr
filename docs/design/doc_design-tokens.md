# Design Tokens Architecture

## 1. Principle: Single Source of Truth
All visual parameters (colors, typography scales, spacing units, border radii, shadow elevations, transition durations, responsive breakpoints, and z-index layers) reside strictly under `design/tokens/` using `snake_case` keys.

Application runtime stylesheets (`src/theme.ts`) and CSS custom properties (`src/index.css`) dynamically reflect these tokens without duplication.

## 2. Token Categories & Organization
- **Colors (`colors/colors.ts`)**: Brand identity (`brand_navy`, `brand_gold`), surfaces (`bg_app`, `bg_card`), text hierarchy (`text_main`, `text_secondary`), semantic `status.*`, dark mode (`dark.*`), and Super Admin Platform theme (`platform.*`).
- **Typography (`typography/typography.ts`)**:
  - Titles (`--font-title`): **Neue Montreal** (`font-semibold` for all page, section, and card titles).
  - Body, Labels, Inputs & Code (`--font-sans`, `--font-mono`): **Roboto** (`font-semibold` labels, `font-normal` values).
- **Spacing (`spacing/spacing.ts`)**: Strict `4px`-multiple scale (`0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 128px`), layout dimensions (`header_height`: 48px, `sidebar_width`: 240px, `page_edge_padding`: 16px, `sibling_gap`: 16px, `field_row_gap`: 16px).
- **Radius (`radius/radius.ts`)**: Badge (4px), Standard (6px), Card (8px), Modal (12px), Container (16px), Pill (9999px).
- **Shadows (`shadows/shadows.ts`)**: `2xs`, `xs`, `sm`, `md`, `lg`.
- **Motion (`motion/motion.ts`)**: Durations (`fast`, `base`, `slow`, `page`), easing curves, and variants.
- **Breakpoints (`breakpoints/breakpoints.ts`)**: `sm` (640px), `md` (768px), `lg` (1024px), `xl` (1280px), `2xl` (1536px).
- **Z-Index (`z_index/z_index.ts`)**: Dropdown (1000), Sticky (1100), Modal (1400), Toast (1600), Tooltip (1700).

## 3. Multi-Tenant Agency Branding
Tenants can override their visual identity (`primary_color`, `accent_color`, `logo_url`) through `resolve_agency_colors(branding)`.
