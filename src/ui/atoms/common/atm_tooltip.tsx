import React, { useState } from "react";
import { designTokens } from "../../../../design/tokens";

export interface AtmTooltipProps {
  content: string;
  children: React.ReactNode;
  position?: "top" | "bottom" | "left" | "right";
  className?: string;
}

export const AtmTooltip: React.FC<AtmTooltipProps> = ({
  content,
  children,
  position = "top",
  className = "",
}) => {
  const [visible, setVisible] = useState(false);

  const positionStyles = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  };

  return (
    <div
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {visible && content && (
        <div
          role="tooltip"
          className={`absolute z-[1700] whitespace-nowrap bg-[#0f172a] text-white text-[11px] font-medium px-2 py-1 shadow-md pointer-events-none transition-opacity ${positionStyles[position]}`}
          style={{ borderRadius: designTokens.radius.badge }}
        >
          {content}
        </div>
      )}
    </div>
  );
};
