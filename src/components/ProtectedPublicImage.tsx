import React, { useEffect, useRef, useState } from "react";
import { Loader2, ImageOff, RefreshCw } from "lucide-react";

interface DecodedEntry {
  source: ImageBitmap | HTMLImageElement;
  width: number;
  height: number;
}

const decodedBitmapCache = new Map<string, DecodedEntry>();
const inFlightFetches = new Map<string, Promise<DecodedEntry>>();

// Priority-aware client concurrency queue so the active lightbox image loads immediately
// instead of competing with 20+ simultaneous thumbnail requests.
const MAX_CONCURRENT_IMAGE_FETCHES = 4;
let activeImageFetches = 0;
const highPriorityQueue: Array<() => void> = [];
const normalPriorityQueue: Array<() => void> = [];

async function withFetchSlot<T>(
  priority: "high" | "normal",
  fn: () => Promise<T>
): Promise<T> {
  if (activeImageFetches >= MAX_CONCURRENT_IMAGE_FETCHES) {
    await new Promise<void>((resolve) => {
      if (priority === "high") {
        highPriorityQueue.push(resolve);
      } else {
        normalPriorityQueue.push(resolve);
      }
    });
  }
  activeImageFetches++;
  try {
    return await fn();
  } finally {
    activeImageFetches--;
    const next = highPriorityQueue.shift() || normalPriorityQueue.shift();
    if (next) next();
  }
}

function getBaseCacheIdentity(src: string): string {
  if (!src) return "";
  try {
    const qIndex = src.indexOf("?");
    if (qIndex === -1) return src;
    const base = src.slice(0, qIndex);
    const params = new URLSearchParams(src.slice(qIndex + 1));
    params.delete("w");
    const rest = params.toString();
    return rest ? `${base}?${rest}` : base;
  } catch {
    return src;
  }
}

function findFallbackCachedBitmap(src: string): DecodedEntry | null {
  const exact = decodedBitmapCache.get(src);
  if (exact) return exact;
  const targetBase = getBaseCacheIdentity(src);
  if (!targetBase) return null;

  let best: DecodedEntry | null = null;
  for (const [cachedUrl, entry] of decodedBitmapCache.entries()) {
    if (getBaseCacheIdentity(cachedUrl) === targetBase) {
      if (!best || entry.width * entry.height > best.width * best.height) {
        best = entry;
      }
    }
  }
  return best;
}

async function decodeBlobToEntry(blob: Blob): Promise<DecodedEntry> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(blob);
      if (bmp && bmp.width > 0 && bmp.height > 0) {
        return { source: bmp, width: bmp.width, height: bmp.height };
      }
    } catch {
      // Fall back to HTMLImageElement decoding (handles Safari/WebKit & unusual color profiles)
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.decoding = "async";
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Image decode error"));
      el.src = objectUrl;
    });
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (width <= 0 || height <= 0) {
      throw new Error("Decoded image has zero dimensions");
    }
    return { source: img, width, height };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

class ProtectedFetchHttpError extends Error {
  status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

async function fetchAndDecodeWithRetries(
  src: string,
  priority: "high" | "normal"
): Promise<DecodedEntry> {
  const isProtectedEndpoint = src.startsWith("/api/public-image");
  const maxAttempts = 3;
  let lastErr: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const entry = await withFetchSlot(priority, async () => {
        const controller =
          typeof AbortController !== "undefined" ? new AbortController() : null;
        const timeoutId = controller
          ? window.setTimeout(() => controller.abort(), 16000)
          : null;

        try {
          const response = await fetch(src, {
            credentials: "same-origin",
            headers: isProtectedEndpoint
              ? { "X-Brokr-Public-View": "1" }
              : undefined,
            cache: "no-store",
            signal: controller?.signal,
          });

          if (!response.ok) {
            throw new ProtectedFetchHttpError(response.status);
          }

          const blob = await response.blob();
          if (!blob || blob.size === 0) {
            throw new Error("Empty image response");
          }

          return await decodeBlobToEntry(blob);
        } finally {
          if (timeoutId !== null) window.clearTimeout(timeoutId);
        }
      });

      return entry;
    } catch (err) {
      lastErr = err;
      // Do not blindly retry 400/403/404; caller handles 403 token refresh
      if (
        err instanceof ProtectedFetchHttpError &&
        (err.status === 400 || err.status === 403 || err.status === 404)
      ) {
        throw err;
      }
      if (attempt < maxAttempts) {
        const delayMs = 350 * attempt;
        await new Promise((r) => window.setTimeout(r, delayMs));
      }
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error("Failed to load image");
}

async function loadProtectedBitmap(
  src: string,
  priority: "high" | "normal" = "normal"
): Promise<DecodedEntry> {
  const cached = decodedBitmapCache.get(src);
  if (cached) return cached;

  const existingPromise = inFlightFetches.get(src);
  if (existingPromise) return existingPromise;

  const fetchPromise = (async (): Promise<DecodedEntry> => {
    const entry = await fetchAndDecodeWithRetries(src, priority);

    // Evict oldest cache entries without calling .close() so mounted canvases holding a reference never crash
    if (decodedBitmapCache.size >= 140) {
      const oldest = decodedBitmapCache.keys().next().value;
      if (oldest) {
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
  priority?: "high" | "normal";
  lazy?: boolean;
  theme?: "light" | "dark";
  onAuthExpired?: () => void;
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
  priority = "normal",
  lazy = false,
  theme = "light",
  onAuthExpired,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isInView, setIsInView] = useState<boolean>(() => !lazy);
  const [retryNonce, setRetryNonce] = useState<number>(0);
  const [entry, setEntry] = useState<DecodedEntry | null>(
    () => findFallbackCachedBitmap(src)
  );
  const [loading, setLoading] = useState<boolean>(
    () => !decodedBitmapCache.has(src)
  );
  const [failed, setFailed] = useState<boolean>(false);

  // Lazy visibility detection for offscreen thumbnails (keeps main lightbox image fast)
  useEffect(() => {
    if (!lazy || isInView) return;
    const node = containerRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setIsInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [lazy, isInView]);

  useEffect(() => {
    let active = true;
    if (!src) {
      setEntry(null);
      setLoading(false);
      setFailed(true);
      return;
    }

    const exactCached = decodedBitmapCache.get(src);
    if (exactCached) {
      setEntry(exactCached);
      setLoading(false);
      setFailed(false);
      return;
    }

    // Show any already-decoded lower-resolution version of the same image immediately
    // so opening/navigating the lightbox never flashes blank while the high-res image loads.
    const progressiveFallback = findFallbackCachedBitmap(src);
    if (progressiveFallback) {
      setEntry(progressiveFallback);
    } else {
      setEntry(null);
    }

    if (!isInView) {
      setLoading(!progressiveFallback);
      setFailed(false);
      return;
    }

    setLoading(!progressiveFallback);
    setFailed(false);

    loadProtectedBitmap(src, priority)
      .then((loaded) => {
        if (!active) return;
        setEntry(loaded);
        setLoading(false);
        setFailed(false);
      })
      .catch((err) => {
        if (!active) return;
        if (err instanceof ProtectedFetchHttpError && err.status === 403) {
          onAuthExpired?.();
        }
        // Keep progressive fallback visible if we already had one; only mark failed if nothing can be shown
        if (!progressiveFallback) {
          setFailed(true);
        }
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [src, priority, isInView, retryNonce, onAuthExpired]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let rafId: number | null = null;

    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const rect = container.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) {
        return;
      }

      const cssW = Math.round(rect.width);
      const cssH = Math.round(rect.height);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const targetW = Math.max(1, Math.round(cssW * dpr));
      const targetH = Math.max(1, Math.round(cssH * dpr));

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
      const scale =
        fit === "contain"
          ? Math.min(scaleX, scaleY)
          : Math.max(scaleX, scaleY);
      const drawW = entry.width * scale;
      const drawH = entry.height * scale;
      const offsetX = (targetW - drawW) / 2;
      const offsetY = (targetH - drawH) / 2;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      try {
        ctx.drawImage(entry.source, offsetX, offsetY, drawW, drawH);
      } catch {
        // Recover if an ImageBitmap was unexpectedly invalidated by browser memory pressure
        decodedBitmapCache.delete(src);
        setEntry(null);
        setRetryNonce((n) => n + 1);
      }
    };

    const scheduleDraw = () => {
      draw();
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        draw();
      });
    };

    scheduleDraw();

    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => scheduleDraw())
        : null;
    observer?.observe(container);
    window.addEventListener("resize", scheduleDraw);

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      observer?.disconnect();
      window.removeEventListener("resize", scheduleDraw);
    };
  }, [entry, fit, locked, src]);

  const isDark = theme === "dark";

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
        <div
          className={`absolute inset-0 flex items-center justify-center pointer-events-none ${
            isDark ? "bg-black/40" : "bg-gray-100/80"
          }`}
        >
          <Loader2 size={isDark ? 24 : 18} className="text-[#BE9662] animate-spin" />
        </div>
      )}

      {failed && !loading && !locked && (
        <div
          className={`absolute inset-0 flex flex-col items-center justify-center gap-2 ${
            isDark ? "bg-neutral-900/90 text-gray-400" : "bg-gray-100 text-gray-400"
          }`}
        >
          <ImageOff size={isDark ? 24 : 20} />
          {isDark && priority === "high" && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                decodedBitmapCache.delete(src);
                setFailed(false);
                setLoading(true);
                setRetryNonce((n) => n + 1);
              }}
              className="mt-1 px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <RefreshCw size={12} />
              <span>Reîncearcă</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
