export const spacingTokens = {
  scale: {
    0: "0px",
    1: "4px",
    2: "8px",
    3: "12px",
    4: "16px",
    5: "20px",
    6: "24px",
    8: "32px",
    10: "40px",
    12: "48px",
    16: "64px",
    32: "128px",
  },
  layout: {
    headerHeight: "48px",
    sidebarWidth: "240px",
    sidebarCollapsedWidth: "64px",
    componentHeight: "36px",
    pageEdgePadding: "16px",
    cardPadding: "16px",
    sectionPadding: "24px",
    siblingGap: "16px",
    fieldRowGap: "16px",
  },
} as const;

export type SpacingTokens = typeof spacingTokens;
