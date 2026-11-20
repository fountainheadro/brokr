import React, { useEffect, useRef, useState } from "react";
import { Loader2, ImageOff } from "lucide-react";

type FrameParity = 0 | 1;
type VisibleFrameListener = (parity: FrameParity, blanked: boolean) => void;
type BlankListener = () => void;

/**
 * Single shared global animation ticker for all <ProtectedPropertyImage /> instances.
 * - Uses ONE requestAnimationFrame loop across the entire page regardless of thumbnail count.
 * - Only notifies currently visible (IntersectionObserver-active) instances.
 * - Pauses completely (0% CPU) and blanks all canvases to #000000 on document.hidden or window blur.
 */
class SharedPovAnimationTicker {
  private visibleListeners = new Set<VisibleFrameListener>();
  private mountedBlankListeners = new Set<BlankListener>();
  private rafId: number | null = null;
  private parity: FrameParity = 0;
  private blanked = false;
  private globalEventsBound = false;

  private handleVisibilityChange = () => {
    if (typeof document === "undefined") return;
    if (document.hidden) {
      this.enterBlankState();
    } else if (typeof document.hasFocus !== "function" || document.hasFocus()) {
      this.exitBlankState();
    }
  };

  private handleWindowBlur = () => {
    this.enterBlankState();
  };

  private handleWindowFocus = () => {
    if (typeof document !== "undefined" && document.hidden) return;
    this.exitBlankState();
  };

  private bindGlobalEvents() {
    if (this.globalEventsBound || typeof window === "undefined" || typeof document === "undefined") {
      return;
    }
    this.blanked = document.hidden;
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    window.addEventListener("blur", this.handleWindowBlur);
    window.addEventListener("focus", this.handleWindowFocus);
    this.globalEventsBound = true;
  }

  private unbindGlobalEventsIfIdle() {
    if (
      !this.globalEventsBound ||
      this.mountedBlankListeners.size > 0 ||
      this.visibleListeners.size > 0 ||
      typeof window === "undefined" ||
      typeof document === "undefined"
    ) {
      return;
    }
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    window.removeEventListener("blur", this.handleWindowBlur);
    window.removeEventListener("focus", this.handleWindowFocus);
    this.globalEventsBound = false;
  }

  private enterBlankState() {
    this.blanked = true;
    this.stopLoop();
    for (const blankFn of this.mountedBlankListeners) {
      blankFn();
    }
  }

  private exitBlankState() {
    if (!this.blanked) return;
    this.blanked = false;
    for (const listener of this.visibleListeners) {
      listener(this.parity, false);
    }
    this.ensureLoopRunning();
  }

  private tick = () => {
    this.rafId = null;
    if (this.blanked || this.visibleListeners.size === 0) {
      return;
    }
    this.parity = this.parity === 0 ? 1 : 0;
    for (const listener of this.visibleListeners) {
      listener(this.parity, false);
    }
    this.rafId = window.requestAnimationFrame(this.tick);
  };

  private ensureLoopRunning() {
    if (
      this.rafId !== null ||
      this.blanked ||
      this.visibleListeners.size === 0 ||
      typeof window === "undefined"
    ) {
      return;
    }
    this.rafId = window.requestAnimationFrame(this.tick);
  }

  private stopLoop() {
    if (this.rafId !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  public registerMounted(blankFn: BlankListener): () => void {
    this.bindGlobalEvents();
    this.mountedBlankListeners.add(blankFn);
    if (this.blanked) {
      blankFn();
    }
    return () => {
      this.mountedBlankListeners.delete(blankFn);
      this.unbindGlobalEventsIfIdle();
    };
  }

  public subscribeVisible(listener: VisibleFrameListener): () => void {
    this.bindGlobalEvents();
    this.visibleListeners.add(listener);
    listener(this.parity, this.blanked);
    this.ensureLoopRunning();
    return () => {
      this.visibleListeners.delete(listener);
      if (this.visibleListeners.size === 0) {
        this.stopLoop();
      }
      this.unbindGlobalEventsIfIdle();
    };
  }

  public getState(): { parity: FrameParity; blanked: boolean } {
    return { parity: this.parity, blanked: this.blanked };
  }
}

const sharedPovTicker = new SharedPovAnimationTicker();

interface DecodedImageSource {
  source: ImageBitmap | HTMLImageElement;
  width: number;
  height: number;
}

const decodedImageCache = new Map<string, DecodedImageSource>();
const inFlightImageLoads = new Map<string, Promise<DecodedImageSource>>();

function loadHtmlImage(src: string, useCors: boolean): Promise<DecodedImageSource> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (useCors) {
      img.crossOrigin = "anonymous";
    }
    img.referrerPolicy = "no-referrer";
    img.decoding = "async";
    img.onload = () => {
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      if (width > 0 && height > 0) {
        resolve({ source: img, width, height });
      } else {
        reject(new Error("Decoded image has zero dimensions"));
      }
    };
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = src;
  });
}

async function loadImageForCanvas(src: string): Promise<DecodedImageSource> {
  const cached = decodedImageCache.get(src);
  if (cached) return cached;

  const existing = inFlightImageLoads.get(src);
  if (existing) return existing;

  const loadPromise = (async (): Promise<DecodedImageSource> => {
    let entry: DecodedImageSource;

    if (src.startsWith("/api/public-image")) {
      // Existing tokenized public-share URLs require the same-origin view header
      const response = await fetch(src, {
        credentials: "same-origin",
        headers: { "X-Brokr-Public-View": "1" },
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const blob = await response.blob();
      if (typeof createImageBitmap === "function") {
        const bmp = await createImageBitmap(blob);
        entry = { source: bmp, width: bmp.width, height: bmp.height };
      } else {
        const objectUrl = URL.createObjectURL(blob);
        try {
          entry = await loadHtmlImage(objectUrl, false);
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      }
    } else {
      // Pure client-side image loading with automatic non-CORS fallback
      const isExternalHttp =
        (src.startsWith("http://") || src.startsWith("https://")) &&
        (typeof window === "undefined" || !src.startsWith(window.location.origin));
      try {
        entry = await loadHtmlImage(src, isExternalHttp);
      } catch {
        entry = await loadHtmlImage(src, false);
      }
    }

    if (decodedImageCache.size >= 80) {
      const oldestKey = decodedImageCache.keys().next().value;
      if (oldestKey) {
        const oldestEntry = decodedImageCache.get(oldestKey);
        if (
          oldestEntry &&
          "close" in oldestEntry.source &&
          typeof oldestEntry.source.close === "function"
        ) {
          oldestEntry.source.close();
        }
        decodedImageCache.delete(oldestKey);
      }
    }
    decodedImageCache.set(src, entry);
    return entry;
  })();

  inFlightImageLoads.set(src, loadPromise);
  try {
    return await loadPromise;
  } finally {
    inFlightImageLoads.delete(src);
  }
}

interface PreBakedBuffers {
  frameA: HTMLCanvasElement;
  frameB: HTMLCanvasElement;
  width: number;
  height: number;
}

/**
 * Pre-bakes two offscreen canvases ONCE at the rendered canvas dimensions:
 * - frameA: even horizontal 2px strips of the brightness/contrast-compensated image, odd 2px strips #000000
 * - frameB: odd horizontal 2px strips of the brightness/contrast-compensated image, even 2px strips #000000
 */
function bakeInterlacedFrames(
  entry: DecodedImageSource,
  targetW: number,
  targetH: number,
  fit: "cover" | "contain",
  dpr: number
): PreBakedBuffers | null {
  if (targetW <= 0 || targetH <= 0 || entry.width <= 0 || entry.height <= 0) {
    return null;
  }

  const scaleX = targetW / entry.width;
  const scaleY = targetH / entry.height;
  const scale = fit === "contain" ? Math.min(scaleX, scaleY) : Math.max(scaleX, scaleY);
  const drawW = Math.max(1, Math.round(entry.width * scale));
  const drawH = Math.max(1, Math.round(entry.height * scale));
  const offsetX = Math.round((targetW - drawW) / 2);
  const offsetY = Math.round((targetH - drawH) / 2);

  // 1. Render brightness/contrast-compensated image ONCE onto a temporary offscreen canvas
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = targetW;
  sourceCanvas.height = targetH;
  const srcCtx = sourceCanvas.getContext("2d");
  if (!srcCtx) return null;

  srcCtx.imageSmoothingEnabled = true;
  srcCtx.imageSmoothingQuality = "high";
  srcCtx.filter = "brightness(1.3) contrast(1.08)";
  srcCtx.drawImage(entry.source, offsetX, offsetY, drawW, drawH);
  srcCtx.filter = "none";

  // 2. Bake frameA (even 2px strips) and frameB (odd 2px strips) once
  const frameA = document.createElement("canvas");
  frameA.width = targetW;
  frameA.height = targetH;
  const ctxA = frameA.getContext("2d");

  const frameB = document.createElement("canvas");
  frameB.width = targetW;
  frameB.height = targetH;
  const ctxB = frameB.getContext("2d");

  if (!ctxA || !ctxB) return null;

  // Fill solid black background (#000000) behind the image region so masked strips are pure black
  ctxA.fillStyle = "#000000";
  ctxB.fillStyle = "#000000";
  if (fit === "contain") {
    ctxA.fillRect(offsetX, offsetY, drawW, drawH);
    ctxB.fillRect(offsetX, offsetY, drawW, drawH);
  } else {
    ctxA.fillRect(0, 0, targetW, targetH);
    ctxB.fillRect(0, 0, targetW, targetH);
  }

  const stripHeight = Math.max(2, Math.round(2 * dpr));
  const startY = fit === "contain" ? Math.max(0, offsetY) : 0;
  const endY = fit === "contain" ? Math.min(targetH, offsetY + drawH) : targetH;
  const copyX = fit === "contain" ? Math.max(0, offsetX) : 0;
  const copyW = fit === "contain" ? Math.min(targetW - copyX, drawW) : targetW;

  let stripIndex = 0;
  for (let y = startY; y < endY; y += stripHeight) {
    const h = Math.min(stripHeight, endY - y);
    if (h <= 0) break;
    if (stripIndex % 2 === 0) {
      ctxA.drawImage(sourceCanvas, copyX, y, copyW, h, copyX, y, copyW, h);
    } else {
      ctxB.drawImage(sourceCanvas, copyX, y, copyW, h, copyX, y, copyW, h);
    }
    stripIndex += 1;
  }

  return { frameA, frameB, width: targetW, height: targetH };
}

export interface ProtectedPropertyImageProps {
  src: string;
  alt?: string;
  fit?: "cover" | "contain";
  className?: string;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
}

/**
 * Reusable persistence-of-vision HTML5 Canvas image renderer:
 * - Pre-bakes two interlaced 2px-strip offscreen canvases (frameA & frameB) once per image/size.
 * - Alternates frames via a single shared requestAnimationFrame ticker only while visible.
 * - Blanks to #000000 and stops ticking when document.hidden or window loses focus.
 * - Disables context menu, dragging, and long-press saving.
 */
export const ProtectedPropertyImage: React.FC<ProtectedPropertyImageProps> = ({
  src,
  alt = "Fotografie proprietate",
  fit = "cover",
  className = "",
  onClick,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const buffersRef = useRef<PreBakedBuffers | null>(null);
  const [entry, setEntry] = useState<DecodedImageSource | null>(() =>
    src ? decodedImageCache.get(src) || null : null
  );
  const [loading, setLoading] = useState<boolean>(() => Boolean(src) && !decodedImageCache.has(src));
  const [failed, setFailed] = useState<boolean>(false);

  // Load and cache image client-side
  useEffect(() => {
    let active = true;
    if (!src) {
      setEntry(null);
      setLoading(false);
      setFailed(true);
      return;
    }

    const cached = decodedImageCache.get(src);
    if (cached) {
      setEntry(cached);
      setLoading(false);
      setFailed(false);
      return;
    }

    setEntry(null);
    setLoading(true);
    setFailed(false);

    loadImageForCanvas(src)
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

  // Helper to paint current pre-baked frame or solid #000000 when blanked
  const paintCanvas = useRef((parity: FrameParity, blanked: boolean) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (blanked) {
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const buffers = buffersRef.current;
    if (!buffers) return;

    if (fit === "contain") {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(parity === 0 ? buffers.frameA : buffers.frameB, 0, 0);
  });

  // Keep fit closure fresh for paintCanvas without re-subscribing observers
  useEffect(() => {
    paintCanvas.current = (parity: FrameParity, blanked: boolean) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      if (blanked) {
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return;
      }

      const buffers = buffersRef.current;
      if (!buffers) return;

      if (fit === "contain") {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(parity === 0 ? buffers.frameA : buffers.frameB, 0, 0);
    };
  }, [fit]);

  // Pre-bake frameA & frameB ONCE whenever image loads or rendered dimensions change
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const rebuildBuffers = () => {
      const rect = container.getBoundingClientRect();
      const cssW = Math.round(rect.width);
      const cssH = Math.round(rect.height);
      if (cssW <= 0 || cssH <= 0) return;

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const targetW = Math.round(cssW * dpr);
      const targetH = Math.round(cssH * dpr);

      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      if (!entry) {
        buffersRef.current = null;
        const { blanked } = sharedPovTicker.getState();
        if (blanked) {
          paintCanvas.current(0, true);
        } else {
          const ctx = canvas.getContext("2d");
          ctx?.clearRect(0, 0, canvas.width, canvas.height);
        }
        return;
      }

      const baked = bakeInterlacedFrames(entry, targetW, targetH, fit, dpr);
      buffersRef.current = baked;

      const { parity, blanked } = sharedPovTicker.getState();
      paintCanvas.current(parity, blanked);
    };

    rebuildBuffers();

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            rebuildBuffers();
          })
        : null;
    resizeObserver?.observe(container);

    return () => {
      resizeObserver?.disconnect();
      buffersRef.current = null;
    };
  }, [entry, fit]);

  // Register blank handler for all mounted canvases + IntersectionObserver for visible-only ticker
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const unsubBlank = sharedPovTicker.registerMounted(() => {
      paintCanvas.current(0, true);
    });

    let unsubVisible: (() => void) | null = null;

    const setVisible = (visible: boolean) => {
      if (visible && !unsubVisible) {
        unsubVisible = sharedPovTicker.subscribeVisible((parity, blanked) => {
          paintCanvas.current(parity, blanked);
        });
      } else if (!visible && unsubVisible) {
        unsubVisible();
        unsubVisible = null;
      }
    };

    if (typeof IntersectionObserver !== "undefined") {
      const observer = new IntersectionObserver(
        (entries) => {
          const isVisible = entries.some((e) => e.isIntersecting);
          setVisible(isVisible);
        },
        { threshold: 0.01 }
      );
      observer.observe(container);

      return () => {
        observer.disconnect();
        setVisible(false);
        unsubBlank();
      };
    }

    // Fallback if IntersectionObserver is unavailable
    setVisible(true);
    return () => {
      setVisible(false);
      unsubBlank();
    };
  }, []);

  const blockInteraction = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={alt}
      draggable={false}
      onClick={onClick}
      onContextMenu={blockInteraction}
      onDragStart={blockInteraction}
      className={`relative w-full h-full overflow-hidden select-none [-webkit-touch-callout:none] [-webkit-user-drag:none] ${className}`}
    >
      <canvas
        ref={canvasRef}
        draggable={false}
        onContextMenu={blockInteraction}
        onDragStart={blockInteraction}
        className="absolute inset-0 w-full h-full block pointer-events-none select-none [-webkit-touch-callout:none] [-webkit-user-drag:none]"
      />

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100/80 pointer-events-none">
          <Loader2 size={18} className="text-[#BE9662] animate-spin" />
        </div>
      )}

      {failed && !loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-100 text-gray-400 pointer-events-none">
          <ImageOff size={20} />
        </div>
      )}
    </div>
  );
};
