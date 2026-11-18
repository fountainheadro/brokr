/**
 * ============================================================================
 * BROKR. DESIGN SYSTEM & THEME - SINGLE SOURCE OF TRUTH
 * ============================================================================
 * 
 * Modifică oricare valoare din acest fișier pentru a schimba instantaneu
 * culorile, fonturile, rotunjirile și stilul întregii aplicații,
 * fără hardcoding în componente individuale!
 */

import { designTokens } from "../design/tokens";

export const THEME = {
  colors: designTokens.colors,
  fonts: designTokens.typography.fonts,
  radii: {
    standard: designTokens.radius.standard,
    badge: designTokens.radius.badge,
    modal: designTokens.radius.modal,
    card: designTokens.radius.card,
    pill: designTokens.radius.pill,
  },
  spacing: {
    edge: designTokens.spacing.layout.pageEdgePadding,
    headerHeight: designTokens.spacing.layout.headerHeight,
    componentHeight: designTokens.spacing.layout.componentHeight,
    cardPadding: designTokens.spacing.layout.cardPadding,
    sectionPadding: designTokens.spacing.layout.sectionPadding,
    siblingGap: designTokens.spacing.layout.siblingGap,
    fieldRowGap: designTokens.spacing.layout.fieldRowGap,
  },
} as const;

/**
 * Backward compatibility exports
 */
export const COLORS = {
  primary: THEME.colors.brandNavy,
  accent: THEME.colors.brandGold,
  accentLight: THEME.colors.brandGoldLight,
  textSecondary: THEME.colors.textSecondary,
};

export const ANIMATION_VARIANTS = {
  pageTransition: {
    initial: (direction: number) => ({
      x: direction > 0 ? '100%' : '-100%',
      zIndex: 1
    } as const),
    animate: {
      x: 0,
      zIndex: 2,
      transition: {
        x: { type: "tween", ease: "easeInOut", duration: 0.5 } as const
      }
    },
    exit: (direction: number) => ({
      x: direction > 0 ? '-100%' : '100%',
      zIndex: 0,
      transition: {
        x: { type: "tween", ease: "easeInOut", duration: 0.5 } as const
      }
    } as const)
  } as const,
  tapEffect: {
    scale: 0.98
  }
} as const;

/**
 * Injects CSS variables onto the root document so that all components,
 * modals, and Tailwind classes inherit them reactively and centrally.
 */
export const applyTheme = () => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  // Primary & Brand Navy
  root.style.setProperty('--color-brand-navy', THEME.colors.brandNavy);
  root.style.setProperty('--color-brand-navy-hover', THEME.colors.brandNavyHover);
  root.style.setProperty('--color-brand-navy-light', THEME.colors.brandNavyLight);
  root.style.setProperty('--color-brand-navy-border', THEME.colors.brandNavyBorder);
  root.style.setProperty('--color-primary', THEME.colors.brandNavy);

  // Accent & Brand Gold
  root.style.setProperty('--color-brand-gold', THEME.colors.brandGold);
  root.style.setProperty('--color-brand-gold-hover', THEME.colors.brandGoldHover);
  root.style.setProperty('--color-brand-gold-light', THEME.colors.brandGoldLight);
  root.style.setProperty('--color-brand-gold-border', THEME.colors.brandGoldBorder);
  root.style.setProperty('--color-accent', THEME.colors.brandGold);
  root.style.setProperty('--color-accent-light', THEME.colors.brandGoldLight);

  // Text
  root.style.setProperty('--color-text-main', THEME.colors.textMain);
  root.style.setProperty('--color-text-secondary', THEME.colors.textSecondary);
  root.style.setProperty('--color-text-placeholder', THEME.colors.textPlaceholder);

  // Backgrounds & Borders
  root.style.setProperty('--color-bg-app', THEME.colors.bgApp);
  root.style.setProperty('--color-bg-card', THEME.colors.bgCard);
  root.style.setProperty('--color-border', THEME.colors.border);
  root.style.setProperty('--color-border-hover', THEME.colors.borderHover);

  // Fonts
  root.style.setProperty('--font-sans', THEME.fonts.sans);
  root.style.setProperty('--font-title', THEME.fonts.title);
  root.style.setProperty('--font-mono', THEME.fonts.mono);

  // Spacing (4px multiples & 16px canonical gap)
  root.style.setProperty('--spacing-edge', THEME.spacing.edge);
  root.style.setProperty('--spacing-gap', THEME.spacing.siblingGap);
  root.style.setProperty('--spacing-card', THEME.spacing.cardPadding);
};
