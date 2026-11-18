export const radiusTokens = {
  none: "0px",
  badge: "4px",
  standard: "6px",
  card: "8px",
  modal: "12px",
  container: "16px",
  pill: "9999px",
} as const;

export type RadiusTokens = typeof radiusTokens;
