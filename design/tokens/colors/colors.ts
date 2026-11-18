export const colorTokens = {
  // Brand Primary & Accent (Default Brokr Theme)
  brandNavy: "#051D35",
  brandNavyHover: "#0a2b4a",
  brandNavyLight: "rgba(5, 29, 53, 0.06)",
  brandNavyBorder: "rgba(5, 29, 53, 0.15)",

  brandGold: "#BE9662",
  brandGoldHover: "#a8824f",
  brandGoldLight: "rgba(190, 150, 98, 0.12)",
  brandGoldBorder: "rgba(190, 150, 98, 0.28)",

  // Neutral Text
  textMain: "#051D35",
  textSecondary: "#4b5563",
  textMuted: "#6b7280",
  textPlaceholder: "#9ca3af",
  textDisabled: "#9ca3af",
  textInverse: "#ffffff",

  // Background Surfaces (Light Theme)
  bgApp: "#f9fafb",
  bgCard: "#ffffff",
  bgHeader: "#ffffff",
  bgSidebar: "#ffffff",
  bgMuted: "#f3f4f6",
  bgDisabled: "#f3f4f6",
  surfaceElevated: "#ffffff",

  // Borders
  border: "#e5e7eb",
  borderHover: "#d1d5db",
  borderDisabled: "#e5e7eb",

  // Semantic Status (Common)
  status: {
    success: "#10b981",
    successHover: "#059669",
    successLight: "rgba(16, 185, 129, 0.10)",
    successBorder: "rgba(16, 185, 129, 0.25)",

    warning: "#f59e0b",
    warningHover: "#d97706",
    warningLight: "rgba(245, 158, 11, 0.10)",
    warningBorder: "rgba(245, 158, 11, 0.25)",

    danger: "#ef4444",
    dangerHover: "#dc2626",
    dangerLight: "rgba(239, 68, 68, 0.10)",
    dangerBorder: "rgba(239, 68, 68, 0.25)",

    info: "#3b82f6",
    infoHover: "#2563eb",
    infoLight: "rgba(59, 130, 246, 0.10)",
    infoBorder: "rgba(59, 130, 246, 0.25)",
  },

  // Dark Theme Alternative Palette (Centralized definition)
  dark: {
    bgApp: "#0f172a",
    bgCard: "#1e293b",
    bgHeader: "#1e293b",
    bgSidebar: "#0f172a",
    bgMuted: "#334155",
    bgDisabled: "#1e293b",
    surfaceElevated: "#334155",
    textMain: "#f8fafc",
    textSecondary: "#cbd5e1",
    textMuted: "#94a3b8",
    textPlaceholder: "#64748b",
    border: "#334155",
    borderHover: "#475569",
  },

  // Platform Administration Theme (Super Admin - Authoritative Slate & Indigo)
  platform: {
    primary: "#0f172a",
    primaryHover: "#1e293b",
    accent: "#6366f1",
    accentHover: "#4f46e5",
    accentLight: "rgba(99, 102, 241, 0.12)",
    accentBorder: "rgba(99, 102, 241, 0.3)",
    badgeBg: "#eef2ff",
    badgeText: "#4338ca",
  },
} as const;

export type ColorTokens = typeof colorTokens;

/**
 * Resolves agency-specific branding colors while keeping tokens as single source of truth.
 * Applies defaults if agency values are missing.
 */
export function resolveAgencyColors(branding?: {
  primaryColor?: string;
  accentColor?: string;
}) {
  const primary = branding?.primaryColor || colorTokens.brandNavy;
  const accent = branding?.accentColor || colorTokens.brandGold;

  return {
    primary,
    accent,
    primaryHover: branding?.primaryColor ? `${branding.primaryColor}ee` : colorTokens.brandNavyHover,
    accentHover: branding?.accentColor ? `${branding.accentColor}ee` : colorTokens.brandGoldHover,
    primaryLight: branding?.primaryColor ? `${branding.primaryColor}14` : colorTokens.brandNavyLight,
    accentLight: branding?.accentColor ? `${branding.accentColor}18` : colorTokens.brandGoldLight,
  };
}
