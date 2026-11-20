import React, { useEffect, useRef, useState } from "react";
import { Loader2, ImageOff } from "lucide-react";

type FrameParity = 0 | 1;
type VisibleFrameListener = (parity: FrameParity, blanked: boolean) => void;
type BlankListener = () => void;

// Precomputed sRGB <-> Linear-Light LUTs so temporal averaging (FrameA + FrameB)/2
// equals the EXACT physical emitted light of the original photo (zero gamma darkening/ghosting).
const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

const LINEAR_LUT_SIZE = 4096;
const LINEAR_TO_SRGB = new Uint8ClampedArray(LINEAR_LUT_SIZE + 1);
for (let i = 0; i <= LINEAR_LUT_SIZE; i++) {
  const l = i / LINEAR_LUT_SIZE;
  const srgb = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
  LINEAR_TO_SRGB[i] = Math.max(0, Math.min(255, Math.round(srgb * 255)));
}

function linearToSrgbByte(linear: number): number {
  if (linear <= 0) return 0;
  if (linear >= 1) return 255;
  return LINEAR_TO_SRGB[Math.round(linear * LINEAR_LUT_SIZE)];
}

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
  source: ImageBitmap | HTMLImageElement | HTMLCanvasElement;
  width: number;
  height: number;
}

const decodedImageCache = new Map<string, DecodedImageSource>();
const inFlightImageLoads = new Map<string, Promise<DecodedImageSource>>();

function loadHtmlImage(src: string, useCors: boolean): Promise<DecodedImageSource> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const isBlobOrData = src.startsWith("blob:") || src.startsWith("data:");
    if (useCors && !isBlobOrData) {
      img.crossOrigin = "anonymous";
    }
    if (!isBlobOrData) {
      img.referrerPolicy = "no-referrer";
    }
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

function snapshotImageToCanvas(img: HTMLImageElement, width: number, height: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d");
  if (ctx) {
    ctx.drawImage(img, 0, 0, width, height);
  }
  return c;
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("FileReader returned non-string"));
    };
    reader.onerror = () => reject(new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

async function decodeBlobToCanvasSource(blob: Blob): Promise<DecodedImageSource> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(blob);
      if (bmp.width > 0 && bmp.height > 0) {
        return { source: bmp, width: bmp.width, height: bmp.height };
      }
    } catch {
      // Fall back to HTMLImageElement + offscreen canvas snapshot below
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const loaded = await loadHtmlImage(objectUrl, false);
    if (loaded.source instanceof HTMLImageElement) {
      const snap = snapshotImageToCanvas(loaded.source, loaded.width, loaded.height);
      return { source: snap, width: loaded.width, height: loaded.height };
    }
    return loaded;
  } catch {
    const dataUrl = await readBlobAsDataUrl(blob);
    const loaded = await loadHtmlImage(dataUrl, false);
    if (loaded.source instanceof HTMLImageElement) {
      const snap = snapshotImageToCanvas(loaded.source, loaded.width, loaded.height);
      return { source: snap, width: loaded.width, height: loaded.height };
    }
    return loaded;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function fetchImageBlobWithRetry(
  src: string,
  headers?: Record<string, string>,
  maxAttempts = 3
): Promise<Blob> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(src, {
        credentials: "same-origin",
        headers,
        cache: "no-store",
      });
      if (response.ok) {
        const blob = await response.blob();
        if (blob.size > 0) return blob;
        lastError = new Error("Empty image response");
      } else {
        lastError = new Error(`HTTP ${response.status}`);
        // Do not retry hard 400/403/404 responses
        if (response.status === 400 || response.status === 403 || response.status === 404) {
          throw lastError;
        }
      }
    } catch (err) {
      lastError = err;
      if (err instanceof Error && /^HTTP (400|403|404)$/.test(err.message)) {
        throw err;
      }
    }
    if (attempt < maxAttempts) {
      await new Promise((r) => window.setTimeout(r, attempt === 1 ? 350 : 900));
    }
  }
  throw lastError || new Error("Image fetch failed");
}

async function loadImageForCanvas(src: string): Promise<DecodedImageSource> {
  const cached = decodedImageCache.get(src);
  if (cached) return cached;

  const existing = inFlightImageLoads.get(src);
  if (existing) return existing;

  const loadPromise = (async (): Promise<DecodedImageSource> => {
    let entry: DecodedImageSource;

    if (src.includes("/api/public-image")) {
      // Existing tokenized public-share URLs require the same-origin view header
      const blob = await fetchImageBlobWithRetry(src, {
        "X-Brokr-Public-View": "1",
        Accept: "image/webp,image/apng,image/*,*/*;q=0.8",
      });
      entry = await decodeBlobToCanvasSource(blob);
    } else {
      // Pure client-side image loading with automatic non-CORS and same-origin blob fallbacks
      const isExternalHttp =
        (src.startsWith("http://") || src.startsWith("https://")) &&
        (typeof window === "undefined" || !src.startsWith(window.location.origin));
      try {
        entry = await loadHtmlImage(src, isExternalHttp);
      } catch {
        try {
          entry = await loadHtmlImage(src, false);
        } catch (imgErr) {
          if (src.startsWith("/")) {
            const blob = await fetchImageBlobWithRetry(src, undefined, 2);
            entry = await decodeBlobToCanvasSource(blob);
          } else {
            throw imgErr;
          }
        }
      }
    }

    if (decodedImageCache.size >= 80) {
      const oldestKey = decodedImageCache.keys().next().value;
      if (oldestKey) {
        // Let GC release evicted entries safely without closing bitmaps still referenced by mounted views
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
 * Fallback 1px physical strip interlacing (used only if an external image is CORS-tainted
 * and disallows pixel buffer access). Uses 1 physical device pixel height and subtle
 * complementary blending so it stays smooth to the eye while still degrading screenshots.
 */
function bakeFallback1pxInterlacedFrames(
  sourceCanvas: HTMLCanvasElement,
  targetW: number,
  targetH: number,
  fit: "cover" | "contain",
  offsetX: number,
  offsetY: number,
  drawW: number,
  drawH: number
): PreBakedBuffers | null {
  const frameA = document.createElement("canvas");
  frameA.width = targetW;
  frameA.height = targetH;
  const ctxA = frameA.getContext("2d");

  const frameB = document.createElement("canvas");
  frameB.width = targetW;
  frameB.height = targetH;
  const ctxB = frameB.getContext("2d");
  if (!ctxA || !ctxB) return null;

  ctxA.drawImage(sourceCanvas, 0, 0);
  ctxB.drawImage(sourceCanvas, 0, 0);

  const startY = fit === "contain" ? Math.max(0, offsetY) : 0;
  const endY = fit === "contain" ? Math.min(targetH, offsetY + drawH) : targetH;
  const copyX = fit === "contain" ? Math.max(0, offsetX) : 0;
  const copyW = fit === "contain" ? Math.min(targetW - copyX, drawW) : targetW;

  // Alternate 1 physical pixel bands with complementary cool/warm iso-luminant tint overlays
  ctxA.fillStyle = "rgba(0, 48, 255, 0.22)";
  ctxB.fillStyle = "rgba(255, 220, 0, 0.22)";
  for (let y = startY; y < endY; y += 2) {
    ctxA.fillRect(copyX, y, copyW, 1);
    if (y + 1 < endY) {
      ctxB.fillRect(copyX, y + 1, copyW, 1);
    }
  }

  return { frameA, frameB, width: targetW, height: targetH };
}

/**
 * Pre-bakes two perceptually transparent complementary offscreen canvases ONCE per image/size:
 *
 * Psychophysics design (invisible to the human eye at 60Hz+, clearly disrupted in screenshots):
 * 1. Exact Linear-Light Temporal Sum: (linearFrameA + linearFrameB) / 2 === linearOriginal
 *    for every pixel via symmetric linear headroom clamping -> zero brightness loss, zero ghosting.
 * 2. Iso-Luminant S-Cone (Blue-Yellow) Chromatic Splitting:
 *    Uses the exact Rec.709 iso-luminant Blue-Yellow vector (-0.0722 R, -0.0722 G, +0.9278 B)
 *    whose luminance delta is 0.0000. Human S-cone flicker fusion is ~12-18Hz, so at 30Hz+
 *    alternation (60Hz+ displays) opposing blue/yellow frames fuse invisibly into the exact
 *    original color, while any single-frame screenshot freezes strong blue/yellow diagonal
 *    interference bands + 1px chromatic weave directly into the pixels.
 * 3. 1px Physical Pixel Checkerboard Micro-Interlace:
 *    Every 2x2 neighborhood has opposite phase (+1 / -1), keeping local spatial luminance
 *    constant across time (zero macro flicker) while degrading single-frame pixel integrity.
 */
export function bakeTransparentPovFrames(
  entry: DecodedImageSource,
  targetW: number,
  targetH: number,
  fit: "cover" | "contain"
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

  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = targetW;
  sourceCanvas.height = targetH;
  const srcCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
  if (!srcCtx) return null;

  try {
    srcCtx.imageSmoothingEnabled = true;
    srcCtx.imageSmoothingQuality = "high";
    srcCtx.drawImage(entry.source, offsetX, offsetY, drawW, drawH);
  } catch {
    return null;
  }

  let srcImageData: ImageData;
  try {
    srcImageData = srcCtx.getImageData(0, 0, targetW, targetH);
  } catch {
    return bakeFallback1pxInterlacedFrames(
      sourceCanvas,
      targetW,
      targetH,
      fit,
      offsetX,
      offsetY,
      drawW,
      drawH
    );
  }

  const src = srcImageData.data;
  const frameA = document.createElement("canvas");
  frameA.width = targetW;
  frameA.height = targetH;
  const ctxA = frameA.getContext("2d");

  const frameB = document.createElement("canvas");
  frameB.width = targetW;
  frameB.height = targetH;
  const ctxB = frameB.getContext("2d");
  if (!ctxA || !ctxB) return null;

  const imgDataA = ctxA.createImageData(targetW, targetH);
  const imgDataB = ctxB.createImageData(targetW, targetH);
  const outA = imgDataA.data;
  const outB = imgDataB.data;

  // Exact Rec.709 iso-luminant Blue-Yellow (S-cone) vector:
  // 0.2126 * (-0.0722) + 0.7152 * (-0.0722) + 0.0722 * (0.9278) = 0.0000
  const ISO_R = -0.0722;
  const ISO_G = -0.0722;
  const ISO_B = 0.9278;

  // Calibrated amplitudes:
  // - Strong iso-luminant S-cone blue-yellow swing (invisible at 60Hz+ because CFF_BY ~15Hz,
  //   vividly visible in any single-frame screenshot!)
  // - Subtle 1px physical checkerboard luminance micro-split (sub-threshold at 60Hz+ and
  //   spatially balanced across every 2x2 neighborhood -> zero visible flicker!)
  const CHROMA_BAND_AMP = 0.34;
  const CHROMA_CHECKER_AMP = 0.16;
  const LUMA_1PX_AMP = 0.055;

  // Gently compress extreme 0/1 edges by 2.5% in linear light so even pure white walls & ceilings
  // have headroom for iso-luminant blue-yellow anti-screenshot protection without clipping.
  const HEADROOM_MIN = 0.015;
  const HEADROOM_SCALE = 0.96;

  const startY = fit === "contain" ? Math.max(0, offsetY) : 0;
  const endY = fit === "contain" ? Math.min(targetH, offsetY + drawH) : targetH;
  const startX = fit === "contain" ? Math.max(0, offsetX) : 0;
  const endX = fit === "contain" ? Math.min(targetW, offsetX + drawW) : targetW;

  for (let y = startY; y < endY; y++) {
    const rowOffset = y * targetW;
    for (let x = startX; x < endX; x++) {
      const p = (rowOffset + x) << 2;
      const alpha = src[p + 3];
      if (alpha === 0) continue;

      const lr = HEADROOM_MIN + SRGB_TO_LINEAR[src[p]] * HEADROOM_SCALE;
      const lg = HEADROOM_MIN + SRGB_TO_LINEAR[src[p + 1]] * HEADROOM_SCALE;
      const lb = HEADROOM_MIN + SRGB_TO_LINEAR[src[p + 2]] * HEADROOM_SCALE;

      // 1px physical pixel checkerboard parity (+1 / -1)
      const checkerSign = ((x + y) & 1) === 0 ? 1 : -1;

      // Fine 3px diagonal anti-screenshot band phase (+1 / -1) — high enough spatial frequency
      // to prevent saccadic color breakup in live viewing while clearly visible on any screenshot
      const diagBandSign = (((x + y) >> 2) & 1) === 0 ? 1 : -1;

      // Combined chromatic delta along iso-luminant S-cone axis + tiny 1px balanced luma delta
      const chromaDrive = diagBandSign * CHROMA_BAND_AMP + checkerSign * CHROMA_CHECKER_AMP;
      const lumaDrive = checkerSign * LUMA_1PX_AMP;

      const dR = ISO_R * chromaDrive + lumaDrive;
      const dG = ISO_G * chromaDrive + lumaDrive;
      const dB = ISO_B * chromaDrive + lumaDrive;

      // Exact symmetric linear headroom clamping so (FrameA + FrameB)/2 === original pixel
      let k = 1.0;
      if (dR !== 0) {
        const adR = dR < 0 ? -dR : dR;
        const capR = (lr < 1 - lr ? lr : 1 - lr) / adR;
        if (capR < k) k = capR;
      }
      if (dG !== 0) {
        const adG = dG < 0 ? -dG : dG;
        const capG = (lg < 1 - lg ? lg : 1 - lg) / adG;
        if (capG < k) k = capG;
      }
      if (dB !== 0) {
        const adB = dB < 0 ? -dB : dB;
        const capB = (lb < 1 - lb ? lb : 1 - lb) / adB;
        if (capB < k) k = capB;
      }

      const fR = dR * k;
      const fG = dG * k;
      const fB = dB * k;

      outA[p] = linearToSrgbByte(lr + fR);
      outA[p + 1] = linearToSrgbByte(lg + fG);
      outA[p + 2] = linearToSrgbByte(lb + fB);
      outA[p + 3] = alpha;

      outB[p] = linearToSrgbByte(lr - fR);
      outB[p + 1] = linearToSrgbByte(lg - fG);
      outB[p + 2] = linearToSrgbByte(lb - fB);
      outB[p + 3] = alpha;
    }
  }

  ctxA.putImageData(imgDataA, 0, 0);
  ctxB.putImageData(imgDataB, 0, 0);

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
 * Reusable perceptually transparent HTML5 Canvas image protection component:
 * - Pre-bakes two exact linear-light complementary offscreen canvases (frameA & frameB) once per image/size.
 * - Uses iso-luminant S-cone chromatic splitting + 1px physical checkerboard micro-interlacing so live
 *   viewing looks completely transparent while single-frame screenshots capture chromatic distortion.
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
      .catch((err) => {
        if (!active) return;
        console.warn("[ProtectedPropertyImage] Failed to load image:", err);
        setFailed(true);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [src]);

  // Paint pre-baked frame or solid #000000 when blanked (single drawImage per tick)
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
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(parity === 0 ? buffers.frameA : buffers.frameB, 0, 0);
  });

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
      ctx.imageSmoothingEnabled = false;
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

      // Cap internal backing buffer neatly for fast one-time baking while staying crisp at 1px physical resolution
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      let targetW = Math.round(cssW * dpr);
      let targetH = Math.round(cssH * dpr);
      const maxDim = 1400;
      if (targetW > maxDim || targetH > maxDim) {
        const downscale = maxDim / Math.max(targetW, targetH);
        targetW = Math.max(1, Math.round(targetW * downscale));
        targetH = Math.max(1, Math.round(targetH * downscale));
      }

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

      const baked = bakeTransparentPovFrames(entry, targetW, targetH, fit);
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
