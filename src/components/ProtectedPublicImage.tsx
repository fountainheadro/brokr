import React, { useEffect, useRef, useState } from "react";
import { Loader2, ImageOff } from "lucide-react";

interface DecodedEntry {
  source: ImageBitmap | HTMLImageElement;
  width: number;
  height: number;
}

const decodedBitmapCache = new Map<string, DecodedEntry>();
const inFlightFetches = new Map<string, Promise<DecodedEntry>>();

async function loadProtectedBitmap(src: string): Promise<DecodedEntry> {
  const cached = decodedBitmapCache.get(src);
  if (cached) return cached;

  const existingPromise = inFlightFetches.get(src);
  if (existingPromise) return existingPromise;

  const fetchPromise = (async (): Promise<DecodedEntry> => {
    const isProtectedEndpoint = src.startsWith("/api/public-image");
    const response = await fetch(src, {
      credentials: "same-origin",
      headers: isProtectedEndpoint ? { "X-Brokr-Public-View": "1" } : undefined,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const blob = await response.blob();

    let entry: DecodedEntry;
    if (typeof createImageBitmap === "function") {
      const bmp = await createImageBitmap(blob);
      entry = { source: bmp, width: bmp.width, height: bmp.height };
    } else {
      const objectUrl = URL.createObjectURL(blob);
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const el = new Image();
          el.onload = () => resolve(el);
          el.onerror = () => reject(new Error("Image decode error"));
          el.src = objectUrl;
        });
        entry = {
          source: img,
          width: img.naturalWidth || img.width,
          height: img.naturalHeight || img.height,
        };
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    }

    if (decodedBitmapCache.size >= 80) {
      const oldest = decodedBitmapCache.keys().next().value;
      if (oldest) {
        const oldEntry = decodedBitmapCache.get(oldest);
        if (oldEntry && "close" in oldEntry.source && typeof oldEntry.source.close === "function") {
          oldEntry.source.close();
        }
        decodedBitmapCache.delete(oldest);
      }
    }
    decodedBitmapCache.set(src, entry);
    return entry;
  })();

  inFlightFetches.set(src, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    inFlightFetches.delete(src);
  }
}

interface ProtectedPublicImageProps {
  src: string;
  alt?: string;
  fit?: "cover" | "contain";
  className?: string;
  watermarkLabel?: string;
  locked?: boolean;
}

/**
 * Renders a property photo exclusively inside a protected <canvas> (zero <img> tags in DOM),
 * preventing "Save Image As", dragging, direct image URL inspection, and native Google Lens triggers.
 */
export const ProtectedPublicImage: React.FC<ProtectedPublicImageProps> = ({
  src,
  alt = "Fotografie proprietate",
  fit = "cover",
  className = "",
  locked = false,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [entry, setEntry] = useState<DecodedEntry | null>(() => decodedBitmapCache.get(src) || null);
  const [loading, setLoading] = useState<boolean>(() => !decodedBitmapCache.has(src));
  const [failed, setFailed] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    if (!src) {
      setEntry(null);
      setLoading(false);
      setFailed(true);
      return;
    }

    const cached = decodedBitmapCache.get(src);
    if (cached) {
      setEntry(cached);
      setLoading(false);
      setFailed(false);
      return;
    }

    setLoading(true);
    setFailed(false);

    loadProtectedBitmap(src)
      .then((loaded) => {
        if (!active) return;
        setEntry(loaded);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setFailed(true);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [src]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const rect = container.getBoundingClientRect();
      const cssW = Math.max(1, Math.round(rect.width));
      const cssH = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const targetW = Math.round(cssW * dpr);
      const targetH = Math.round(cssH * dpr);

      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      ctx.clearRect(0, 0, targetW, targetH);

      if (locked || !entry || entry.width <= 0 || entry.height <= 0) {
        return;
      }

      const scaleX = targetW / entry.width;
      const scaleY = targetH / entry.height;
      const scale = fit === "contain" ? Math.min(scaleX, scaleY) : Math.max(scaleX, scaleY);
      const drawW = entry.width * scale;
      const drawH = entry.height * scale;
      const offsetX = (targetW - drawW) / 2;
      const offsetY = (targetH - drawH) / 2;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(entry.source, offsetX, offsetY, drawW, drawH);
    };

    draw();

    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => draw()) : null;
    observer?.observe(container);

    return () => {
      observer?.disconnect();
    };
  }, [entry, fit, locked]);

  return (
    <div
      ref={containerRef}
      aria-label={alt}
      className={`relative w-full h-full overflow-hidden ${className}`}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full block pointer-events-none"
      />

      {loading && !locked && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100/80 pointer-events-none">
          <Loader2 size={18} className="text-[#BE9662] animate-spin" />
        </div>
      )}

      {failed && !loading && !locked && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-100 text-gray-400 pointer-events-none">
          <ImageOff size={20} />
        </div>
      )}
    </div>
  );
};
