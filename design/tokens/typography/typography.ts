export const typographyTokens = {
  fonts: {
    sans: '"Lato", sans-serif',
    title: '"Lato", sans-serif',
    mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  },
  sizes: {
    xs: "11px",
    sm: "12px",
    base: "13px",
    md: "14px",
    lg: "16px",
    xl: "18px",
    "2xl": "22px",
    "3xl": "28px",
  },
  weights: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
    black: 900,
  },
  lineHeights: {
    none: "1",
    tight: "1.25",
    snug: "1.375",
    normal: "1.5",
    relaxed: "1.625",
  },
} as const;

export type TypographyTokens = typeof typographyTokens;
