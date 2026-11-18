import React from "react";
import { designTokens } from "../../../../design/tokens";

export interface AtmSkeletonProps {
  width?: string | number;
  height?: string | number;
  rounded?: "standard" | "badge" | "card" | "circle";
  className?: string;
}

export const AtmSkeleton: React.FC<AtmSkeletonProps> = ({
  width,
  height,
  rounded = "standard",
  className = "",
}) => {
  const roundedStyles = {
    standard: designTokens.radius.standard,
    badge: designTokens.radius.badge,
    card: designTokens.radius.card,
    circle: designTokens.radius.pill,
  };

  return (
    <div
      aria-hidden="true"
      className={`animate-pulse bg-gray-200/80 ${className}`}
      style={{
        width: typeof width === "number" ? `${width}px` : width,
        height: typeof height === "number" ? `${height}px` : height,
        borderRadius: roundedStyles[rounded],
      }}
    />
  );
};
