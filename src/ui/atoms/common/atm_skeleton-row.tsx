import React from "react";

export interface AtmSkeletonRowProps {
  columns?: number;
  rows?: number;
  variant?: "table" | "card";
  className?: string;
}

const DEFAULT_WIDTHS = ["w-1/4", "w-1/3", "w-1/5", "w-1/6", "w-2/5"];

export const AtmSkeletonRow: React.FC<AtmSkeletonRowProps> = ({
  columns = 4,
  rows = 3,
  variant = "table",
  className = "",
}) => {
  const safeRows = Math.max(1, Math.min(20, rows));
  const safeCols = Math.max(1, Math.min(8, columns));

  if (variant === "card") {
    return (
      <div className={`space-y-3 ${className}`} aria-hidden="true">
        {Array.from({ length: safeRows }).map((_, rowIdx) => (
          <div
            key={rowIdx}
            className="rounded-lg border border-gray-200/80 bg-white p-4 animate-pulse space-y-2.5"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="h-3.5 w-2/5 rounded bg-gray-200/80" />
              <div className="h-3.5 w-16 rounded bg-gray-200/70" />
            </div>
            <div className="h-3 w-3/4 rounded bg-gray-100" />
            <div className="flex items-center gap-2 pt-1">
              <div className="h-2.5 w-20 rounded bg-gray-100" />
              <div className="h-2.5 w-24 rounded bg-gray-100" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={`divide-y divide-gray-100 ${className}`} aria-hidden="true">
      {Array.from({ length: safeRows }).map((_, rowIdx) => (
        <div key={rowIdx} className="flex items-center gap-4 px-4 py-3 animate-pulse">
          {Array.from({ length: safeCols }).map((__, colIdx) => (
            <div
              key={colIdx}
              className={`h-3 rounded bg-gray-200/75 ${
                DEFAULT_WIDTHS[(rowIdx + colIdx) % DEFAULT_WIDTHS.length]
              }`}
            />
          ))}
        </div>
      ))}
    </div>
  );
};
