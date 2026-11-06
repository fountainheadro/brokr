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
}

/**
 * ProtectedImage Component
 * Implements a cocktail of security measures against downloading and Google Lens:
 * 1. Underlying <img> has pointer-events: none, draggable=false, and touch-callout: none.
 * 2. Top-level transparent shield overlay (z-20) absorbs all mouse/touch interactions.
 * 3. Prevents context menu (right-click) and drag-and-drop entirely.
 * 4. Suppresses Google Lens detection on Chromium browsers.
 * 5. Optional automatic routing through /api/proxy-image to ensure Telea inpainting of portal watermarks.
 */
export const ProtectedImage: React.FC<ProtectedImageProps> = ({
  src,
  alt = "Proprietate",
  className = "",
  imageClassName = "",
  onClick,
  useProxy = true,
  showAgencyShield = false,
}) => {
  // If the image originates from a watermarked portal (Storia, OLX, Imobiliare), route through /api/proxy-image to serve Telea-inpainted clean image
  const resolvedSrc = React.useMemo(() => {
    if (!src) return "";
    const lower = src.toLowerCase();
    const isPortal = 
      lower.includes("apollo.olxcdn.com") || 
      lower.includes("storia.ro") || 
      lower.includes("olx.ro") || 
      lower.includes("imobiliare.ro");

    if (useProxy && isPortal && !src.startsWith("/api/proxy-image")) {
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
      {/* 1. Underlying Image: pointer-events-none ensures Google Lens / Browser never targets this node */}
      <img
        src={resolvedSrc}
        alt={alt}
        className={`w-full h-full object-cover pointer-events-none select-none transition-transform duration-300 ${imageClassName}`}
        draggable={false}
        referrerPolicy="no-referrer"
        loading="lazy"
        style={{
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
