import { colorTokens, resolveAgencyColors } from "./colors/colors";
import { typographyTokens } from "./typography/typography";
import { spacingTokens } from "./spacing/spacing";
import { radiusTokens } from "./radius/radius";
import { shadowTokens } from "./shadows/shadows";
import { motionTokens } from "./motion/motion";
import { breakpointTokens } from "./breakpoints/breakpoints";
import { zIndexTokens } from "./z_index/z_index";

export const designTokens = {
  colors: colorTokens,
  typography: typographyTokens,
  spacing: spacingTokens,
  radius: radiusTokens,
  shadows: shadowTokens,
  motion: motionTokens,
  breakpoints: breakpointTokens,
  zIndex: zIndexTokens,
} as const;

export type DesignTokens = typeof designTokens;

export * from "./colors/colors";
export * from "./typography/typography";
export * from "./spacing/spacing";
export * from "./radius/radius";
export * from "./shadows/shadows";
export * from "./motion/motion";
export * from "./breakpoints/breakpoints";
export * from "./z_index/z_index";
export { resolveAgencyColors };
