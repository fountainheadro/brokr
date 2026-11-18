export const motionTokens = {
  durations: {
    fast: 0.15,
    base: 0.2,
    slow: 0.35,
    page: 0.5,
  },
  easings: {
    default: [0.4, 0, 0.2, 1],
    easeOut: [0, 0, 0.2, 1],
    easeInOut: [0.4, 0, 0.2, 1],
  },
  variants: {
    tap: {
      scale: 0.98,
    },
    pageSlide: {
      enter: (direction: number) => ({
        x: direction > 0 ? "100%" : "-100%",
        opacity: 0,
      }),
      center: {
        x: 0,
        opacity: 1,
      },
      exit: (direction: number) => ({
        x: direction > 0 ? "-100%" : "100%",
        opacity: 0,
      }),
    },
  },
} as const;

export type MotionTokens = typeof motionTokens;
