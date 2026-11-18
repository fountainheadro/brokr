# Component Development Guidelines

## 1. Component Architecture & Principles

When authoring UI components for the Multi-Tenant Real Estate CRM Platform, adhere to these technical and architectural principles:

1. **Strict TypeScript Typing**:
   - Every component must declare an explicit `Props` interface exported alongside the component.
   - Extend native HTML attributes where appropriate (e.g. `interface AtmButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>`).
   - Disallow `any`; use typed unions for variants and sizes.

2. **Controlled vs Uncontrolled Inputs**:
   - Provide standard `value` and `onChange` signatures for form controls.
   - Support `defaultValue` for uncontrolled usage where necessary.

3. **Styling & Token Consumption**:
   - Use Tailwind CSS classes for layout and styling.
   - Color palettes, spacing scales, and border radii must map to design tokens in `design/tokens/`.
   - Never use arbitrary pixel styles (`style={{ width: 147 }}`) unless calculating dynamic geometric coordinates (e.g., in canvas/inpainting).
   - Use `clsx` or string interpolation with standard conditional operators (`clsx(baseClasses, variantClasses[variant], className)`).

4. **Accessibility (a11y) Standards**:
   - Interactive elements must be keyboard navigatable (`Tab`, `Shift+Tab`, `Enter`, `Space`, `Escape`).
   - Modals and Drawers must lock body scroll, trap focus, and close on `Escape` or backdrop click.
   - Use semantic HTML tags (`<button>`, `<input>`, `<dialog>`, `<nav>`, `<aside>`, `<header>`).
   - Always supply `aria-label`, `aria-expanded`, `aria-haspopup`, and `role` attributes where visuals lack textual representation (e.g., icon-only buttons).
   - Form inputs must link to labels via `id` / `htmlFor` and error captions via `aria-describedby`.

5. **Tenant & Brand Theming**:
   - Agency branding colors are resolved via `resolveAgencyColors(branding)` in `design/tokens/colors/colors.ts`.
   - Components should support primary/brand styling that reacts cleanly to agency brand customizations.

---

## 2. Step-by-Step Guide: Creating a New Component

Follow these sequential steps when adding any new component to the codebase:

### Step 1: Determine Atomic Tier and Scope
- Is it indivisible? -> **Atom** (`src/ui/atoms/<scope>/atm_<name>.tsx`)
- Is it a combination of atoms? -> **Molecule** (`src/ui/molecules/<scope>/mol_<name>.tsx`)
- Is it a complex composite block? -> **Organism** (`src/ui/organisms/<scope>/org_<name>.tsx`)
- Is it a layout scaffold? -> **Template** (`src/ui/templates/<scope>/tpl_<name>.tsx`)

Choose the appropriate scope: `common/`, `platform/`, or `agency/`.

### Step 2: Create the Component File
Ensure the filename is lowercase with `_` for hierarchy and `-` for variants (e.g. `atm_tag-input.tsx`).

```tsx
import React, { forwardRef } from 'react';

export type TagVariant = 'default' | 'brand';

export interface AtmTagInputProps extends React.HTMLAttributes<HTMLDivElement> {
  tags: string[];
  onAddTag?: (tag: string) => void;
  onRemoveTag?: (index: number) => void;
  variant?: TagVariant;
  disabled?: boolean;
}

export const AtmTagInput = forwardRef<HTMLDivElement, AtmTagInputProps>(
  ({ tags, onAddTag, onRemoveTag, variant = 'default', disabled = false, className = '', ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`flex flex-wrap items-center gap-1.5 p-2 rounded-md border border-neutral-300 dark:border-neutral-700 ${className}`}
        {...props}
      >
        {/* Render tags and input */}
      </div>
    );
  }
);

AtmTagInput.displayName = 'AtmTagInput';
```

### Step 3: Register in the Scope's Barrel File
Export the component and its prop types in `src/ui/<tier>/<scope>/index.ts`.

### Step 4: Add to Showcase Page
Mount an interactive preview of the new component in `src/pages/pg_design-system-showcase.tsx` so developers and stakeholders can inspect all variants and states.

### Step 5: Verify Compilation & Linting
Run `compile_applet` and `lint_applet` to ensure zero type errors or broken references.
