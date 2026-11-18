import React from "react";

export interface AtmDividerProps {
  label?: string;
  orientation?: "horizontal" | "vertical";
  className?: string;
}

export const AtmDivider: React.FC<AtmDividerProps> = ({
  label,
  orientation = "horizontal",
  className = "",
}) => {
  if (orientation === "vertical") {
    return <div className={`w-[1px] bg-gray-200 self-stretch ${className}`} />;
  }

  if (label) {
    return (
      <div className={`relative flex items-center my-4 ${className}`}>
        <div className="flex-grow border-t border-gray-200" />
        <span className="flex-shrink mx-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
          {label}
        </span>
        <div className="flex-grow border-t border-gray-200" />
      </div>
    );
  }

  return <div className={`border-t border-gray-200 w-full my-3 ${className}`} />;
};
