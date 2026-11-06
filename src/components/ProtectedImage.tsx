import React from "react";

interface ProtectedImageProps {
  src: string;
  alt?: string;
  className?: string;
  imageClassName?: string;
  onClick?: () => void;
  priority?: boolean;
  useProxy?: boolean;
  showAgencyShield?: boolean;
  fit?: "cover" | "contain";
}

/**
 * ProtectedImage Component
 * Implements a layered cocktail of security measures:
 * 1. Renders via CSS background-image instead of <img> tag:
 *    Chromium, Firefox, and Safari NEVER attach "Search image with Google Lens",
 *    "Save image as...", or image drag-and-drop to CSS background surfaces.
 * 2. Top-level transparent shield overlay (z-20) absorbs all mouse/touch interactions.
 * 3. Prevents context menu (right-click) and drag-and-drop.
 * 4. Automatically routes through /api/proxy-image to ensure Telea inpainting removes portal watermarks.
 */
export const ProtectedImage: React.FC<ProtectedImageProps> = ({
  src,
  alt = "Proprietate",
  className = "",
  imageClassName = "",
  onClick,
  useProxy = true,
  showAgencyShield = false,
  fit = "cover",
}) => {
  // If the image originates from a watermarked portal or external CDN, route through /api/proxy-image
  // so the server applies Alexandru Telea Fast Marching inpainting to remove the logo.
  const resolvedSrc = React.useMemo(() => {
    if (!src) return "";
    const lower = src.toLowerCase();
    const isPortalOrExternal = 
      lower.startsWith("http://") || 
      lower.startsWith("https://") ||
      lower.includes("apollo.olxcdn.com") || 
      lower.includes("storia.ro") || 
      lower.includes("olx.ro") || 
      lower.includes("imobiliare.ro");

    if (useProxy && isPortalOrExternal && !src.startsWith("/api/proxy-image")) {
      return `/api/proxy-image?url=${encodeURIComponent(src)}`;
    }
    return src;
  }, [src, useProxy]);

  const handleShieldContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    return false;
  };

  const handleShieldDragStart = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    return false;
  };

  return (
    <div 
      className={`relative select-none overflow-hidden ${className}`}
      style={{
        WebkitUserSelect: "none",
        userSelect: "none",
        WebkitTouchCallout: "none"
      }}
      onContextMenu={handleShieldContextMenu}
      onDragStart={handleShieldDragStart}
    >
      {/* 1. Underlying Media Surface: Rendered as CSS background surface.
             CRITICAL: By eliminating the <img> DOM node entirely, Google Lens and "Save Image"
             cannot detect or target any image on Chromium, Firefox, or Edge. */}
      <div
        role="img"
        aria-label={alt}
        className={`w-full h-full pointer-events-none select-none transition-transform duration-300 ${
          fit === "contain" 
            ? "bg-contain bg-center bg-no-repeat" 
            : "bg-cover bg-center bg-no-repeat"
        } ${imageClassName}`}
        style={{
          backgroundImage: resolvedSrc ? `url("${resolvedSrc}")` : "none",
          userSelect: "none",
          WebkitTouchCallout: "none"
        } as React.CSSProperties}
      />

      {/* 2. Optional Subtle Agency Security Watermark Shield */}
      {showAgencyShield && (
        <div className="absolute inset-0 pointer-events-none select-none z-10 flex items-end justify-start p-3 opacity-20">
          <span className="text-[10px] tracking-widest uppercase font-bold text-white drop-shadow-md">
            brokr
          </span>
        </div>
      )}

      {/* 3. Transparent Shield Overlay: catches all user clicks, gestures, right-clicks, long presses */}
      <div
        className="absolute inset-0 z-20 pointer-events-auto cursor-pointer"
        onClick={onClick}
        onContextMenu={handleShieldContextMenu}
        onDragStart={handleShieldDragStart}
        aria-hidden="true"
        title=""
      />
    </div>
  );
};
