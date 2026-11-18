# Atoms Specification (Design Layer)

## 1. Overview
Atoms are the foundational building blocks of the Brokr Multi-Tenant CRM interface. They map directly to design tokens and cannot be broken down further without losing their functional purpose.

## 2. Component Specifications

### 2.1 Buttons (`atm_button`)
- **Appearance**: Solid, outline, or transparent background with sharp or semi-rounded corners (`radius.standard`: 6px).
- **Variants**:
  - `primary`: Background `brandNavy` (#051D35), hover `#0a2b4a`, white text.
  - `secondary`: Background white, border `border` (#e5e7eb), text `textMain`, hover `bgApp`.
  - `tertiary`: Border `border`, background `bgApp`, text `textSecondary`.
  - `accent`: Background `brandGold` (#BE9662), hover `#a8824f`, white text.
  - `ghost`: Transparent background, hover `bgMuted`, text `textSecondary`.
  - `danger`: Background `status.danger` (#ef4444), hover `#dc2626`, white text.
  - `icon`: Square aspect ratio (1:1), centered icon.
- **Sizes**:
  - `sm`: Height 28px, font 11px, horizontal padding 10px.
  - `md`: Height 36px, font 12px, horizontal padding 14px (standard).
  - `lg`: Height 44px, font 14px, horizontal padding 20px.
- **States**: Default, Hover, Focus (ring 2px `brandGold/40`), Disabled (opacity 50%, not-allowed), Loading (spinner replaces icon/text).

### 2.2 Text Inputs (`atm_input-text`)
- **Appearance**: White background, 1px solid `border` (#e5e7eb), 6px radius.
- **Variants**: `text`, `number`, `email`, `password`, `search`.
- **States**:
  - Default: Border #e5e7eb.
  - Focus: Border `brandGold` (#BE9662), ring 1px `brandGold/30`.
  - Error: Border `status.danger` (#ef4444), focus ring 1px `danger/30`.
  - Disabled: Background `bgDisabled` (#f3f4f6), text `textDisabled` (#9ca3af).
- **Accessories**: Optional left icon (e.g. Search, Mail), right icon / action (e.g. Eye toggle, Clear cross).

### 2.3 Status Badges (`atm_badge`)
- **Appearance**: Inline container, 4px radius (`radius.badge`), uppercase tracking 0.05em, font size 10px or 11px.
- **Variants**:
  - `default`: Neutral gray (#f3f4f6 / #374151).
  - `brand`: Navy tint (`brandNavyLight` / `brandNavy`).
  - `success`: Emerald tint (`status.successLight` / `status.success`).
  - `warning`: Amber tint (`status.warningLight` / `status.warning`).
  - `danger`: Rose tint (`status.dangerLight` / `status.danger`).
  - `info`: Blue tint (`status.infoLight` / `status.info`).

### 2.4 Selection Controls (`atm_checkbox`, `atm_radio`, `atm_switch`)
- **Checkbox**: 16x16px, 4px radius, checked background `brandNavy`, checkmark white.
- **Radio**: 16x16px circle, checked outer border `brandNavy`, inner dot `brandNavy`.
- **Switch**: 36x20px pill track, 16px sliding circle thumb, active background `brandNavy` or `brandGold`.

### 2.5 Informational & Feedback Atoms
- `atm_avatar`: Circular or rounded 6px container, initials or photo, sizes 24px, 32px, 40px, 48px.
- `atm_spinner`: Circular SVG ring with rotating arc, sizes 14px, 20px, 32px.
- `atm_skeleton`: Shimmer pulse background `#f1f5f9` with rounded corners.
- `atm_divider`: 1px solid `#e5e7eb` horizontal or vertical line with optional text label.
- `atm_tooltip`: Dark `#0f172a` tooltip with 4px radius, white text, 11px font, arrow pointer.
