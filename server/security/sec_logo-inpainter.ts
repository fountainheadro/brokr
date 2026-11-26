export interface LogoBox {
  startX: number;
  startY: number;
  w: number;
  h: number;
}

export interface DetectLogoOptions {
  aggressive?: boolean;
}

type GridRow = 0 | 1 | 2;
type GridCol = 0 | 1 | 2;
type MaskPolarity = "light" | "dark";
type MaskTier = "whiteCore" | "brightOverlay" | "crisp" | "medium" | "softTranslucent";

interface RoisSpec {
  name: string;
  row: GridRow;
  col: GridCol;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  innerLeft: boolean;
  innerRight: boolean;
  innerTop: boolean;
  innerBottom: boolean;
  strictZone: boolean;
  isCenter?: boolean;
}

interface RawComponent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  fgCount: number;
  gradXSum: number;
  gradYSum: number;
  wordCount: number;
}

interface DetectedWorkBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  row: GridRow;
  col: GridCol;
  polarity: MaskPolarity;
  tier: MaskTier;
}

/**
 * Deterministic (non-AI) logo & owner-name text watermark detector.
 * Scans all 9 grid zones (4 corners, top/bottom center, middle-left/middle-right edges,
 * and center) at a normalized working resolution (~1000px long edge).
 * Evaluates multi-tier local-contrast stroke masks, groups same-line multi-word owner names
 * (e.g. "ION POPESCU") without bridging vertical background textures, supports repeated
 * 3x3 grid corroboration (including center and faint/busy-background grid slots), and
 * strictly verifies dimensions, 2D edge sharpness, stroke complexity, continuity, and halo.
 */
export function detectLogoBoxes(image: any, options?: DetectLogoOptions): LogoBox[] {
  const aggressive = Boolean(options?.aggressive);
  const origW: number = image?.width ?? image?.bitmap?.width ?? 0;
  const origH: number = image?.height ?? image?.bitmap?.height ?? 0;
  const data: Uint8Array | Buffer | undefined = image?.bitmap?.data;

  if (!data || origW < 200 || origH < 200) {
    return [];
  }

  const longEdge = Math.max(origW, origH);
  const targetLong = Math.min(1000, longEdge);
  const scale = targetLong / longEdge;
  const workW = Math.max(1, Math.round(origW * scale));
  const workH = Math.max(1, Math.round(origH * scale));

  const totalPixels = workW * workH;
  const rArr = new Uint8Array(totalPixels);
  const gArr = new Uint8Array(totalPixels);
  const bArr = new Uint8Array(totalPixels);
  const lumaArr = new Float32Array(totalPixels);

  for (let wy = 0; wy < workH; wy++) {
    const sy = Math.min(origH - 1, Math.floor((wy + 0.5) / scale));
    const rowOffset = wy * workW;
    const srcRowOffset = sy * origW;
    for (let wx = 0; wx < workW; wx++) {
      const sx = Math.min(origW - 1, Math.floor((wx + 0.5) / scale));
      const srcIdx = (srcRowOffset + sx) * 4;
      const r = data[srcIdx];
      const g = data[srcIdx + 1];
      const b = data[srcIdx + 2];
      const idx = rowOffset + wx;
      rArr[idx] = r;
      gArr[idx] = g;
      bArr[idx] = b;
      lumaArr[idx] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
  }

  // 2D summed-area tables for O(1) local neighborhood mean
  const stride = workW + 1;
  const satL = new Float64Array(stride * (workH + 1));
  const satR = new Float64Array(stride * (workH + 1));
  const satG = new Float64Array(stride * (workH + 1));
  const satB = new Float64Array(stride * (workH + 1));

  for (let y = 0; y < workH; y++) {
    let rowL = 0;
    let rowR = 0;
    let rowG = 0;
    let rowB = 0;
    const yOff = y * workW;
    const satRow = (y + 1) * stride;
    const satPrev = y * stride;
    for (let x = 0; x < workW; x++) {
      const idx = yOff + x;
      rowL += lumaArr[idx];
      rowR += rArr[idx];
      rowG += gArr[idx];
      rowB += bArr[idx];
      const sIdx = satRow + (x + 1);
      satL[sIdx] = satL[satPrev + (x + 1)] + rowL;
      satR[sIdx] = satR[satPrev + (x + 1)] + rowR;
      satG[sIdx] = satG[satPrev + (x + 1)] + rowG;
      satB[sIdx] = satB[satPrev + (x + 1)] + rowB;
    }
  }

  const boxSum = (sat: Float64Array, x0: number, y0: number, x1: number, y1: number) =>
    sat[(y1 + 1) * stride + (x1 + 1)] -
    sat[y0 * stride + (x1 + 1)] -
    sat[(y1 + 1) * stride + x0] +
    sat[y0 * stride + x0];

  const cornerW = Math.round(workW * (aggressive ? 0.40 : 0.36));
  const cornerH = Math.round(workH * (aggressive ? 0.26 : 0.23));
  const sideW = Math.round(workW * (aggressive ? 0.38 : 0.34));
  const midY0 = Math.round(workH * 0.27);
  const midY1 = Math.round(workH * 0.73);
  const centerX0 = Math.round(workW * 0.25);
  const centerX1 = Math.round(workW * 0.75);

  // Full 3x3 watermark grid: 8 perimeter ROIs + 1 center ROI (up to 9 positions)
  const perimeterRois: RoisSpec[] = [
    {
      name: "bottom-left",
      row: 2,
      col: 0,
      x0: 0,
      y0: workH - cornerH,
      x1: cornerW,
      y1: workH,
      innerLeft: false,
      innerRight: true,
      innerTop: true,
      innerBottom: false,
      strictZone: false,
    },
    {
      name: "bottom-right",
      row: 2,
      col: 2,
      x0: workW - cornerW,
      y0: workH - cornerH,
      x1: workW,
      y1: workH,
      innerLeft: true,
      innerRight: false,
      innerTop: true,
      innerBottom: false,
      strictZone: false,
    },
    {
      name: "bottom-center",
      row: 2,
      col: 1,
      x0: centerX0,
      y0: workH - Math.round(workH * 0.22),
      x1: centerX1,
      y1: workH,
      innerLeft: true,
      innerRight: true,
      innerTop: true,
      innerBottom: false,
      strictZone: false,
    },
    {
      name: "top-left",
      row: 0,
      col: 0,
      x0: 0,
      y0: 0,
      x1: cornerW,
      y1: cornerH,
      innerLeft: false,
      innerRight: true,
      innerTop: false,
      innerBottom: true,
      strictZone: false,
    },
    {
      name: "top-right",
      row: 0,
      col: 2,
      x0: workW - cornerW,
      y0: 0,
      x1: workW,
      y1: cornerH,
      innerLeft: true,
      innerRight: false,
      innerTop: false,
      innerBottom: true,
      strictZone: false,
    },
    {
      name: "top-center",
      row: 0,
      col: 1,
      x0: centerX0,
      y0: 0,
      x1: centerX1,
      y1: Math.round(workH * 0.21),
      innerLeft: true,
      innerRight: true,
      innerTop: false,
      innerBottom: true,
      strictZone: true,
    },
    {
      name: "middle-left",
      row: 1,
      col: 0,
      x0: 0,
      y0: midY0,
      x1: sideW,
      y1: midY1,
      innerLeft: false,
      innerRight: true,
      innerTop: true,
      innerBottom: true,
      strictZone: false,
    },
    {
      name: "middle-right",
      row: 1,
      col: 2,
      x0: workW - sideW,
      y0: midY0,
      x1: workW,
      y1: midY1,
      innerLeft: true,
      innerRight: false,
      innerTop: true,
      innerBottom: true,
      strictZone: false,
    },
  ];

  const centerRoi: RoisSpec = {
    name: "center",
    row: 1,
    col: 1,
    x0: centerX0,
    y0: midY0,
    x1: centerX1,
    y1: midY1,
    innerLeft: true,
    innerRight: true,
    innerTop: true,
    innerBottom: true,
    strictZone: true,
    isCenter: true,
  };

  const allRois: RoisSpec[] = [...perimeterRois, centerRoi];

  // Multi-tier stroke masks prevent bright/textured backgrounds from welding onto crisp vector logos or text
  const ultraWhiteMask = new Uint8Array(totalPixels);
  const whiteCoreMask = new Uint8Array(totalPixels);
  const brightOverlayMask = new Uint8Array(totalPixels);
  const pureBrightMask = new Uint8Array(totalPixels);
  const crispLightMask = new Uint8Array(totalPixels);
  const crispDarkMask = new Uint8Array(totalPixels);
  const medLightMask = new Uint8Array(totalPixels);
  const medDarkMask = new Uint8Array(totalPixels);
  const softTranslucentLightMask = new Uint8Array(totalPixels);
  const softTranslucentDarkMask = new Uint8Array(totalPixels);
  const computedMask = new Uint8Array(totalPixels);
  const gradXArr = new Float32Array(totalPixels);
  const gradYArr = new Float32Array(totalPixels);

  const radius = 9;
  const radiusWide = 16;
  const roiMargin = 16;

  const ensureFeaturesComputed = (x0: number, y0: number, x1: number, y1: number) => {
    const ex0 = Math.max(0, x0 - roiMargin);
    const ey0 = Math.max(0, y0 - roiMargin);
    const ex1 = Math.min(workW, x1 + roiMargin);
    const ey1 = Math.min(workH, y1 + roiMargin);

    for (let y = ey0; y < ey1; y++) {
      const ny0 = Math.max(0, y - radius);
      const ny1 = Math.min(workH - 1, y + radius);
      const wy0 = Math.max(0, y - radiusWide);
      const wy1 = Math.min(workH - 1, y + radiusWide);
      const yUp = Math.max(0, y - 1);
      const yDn = Math.min(workH - 1, y + 1);
      for (let x = ex0; x < ex1; x++) {
        const idx = y * workW + x;
        if (computedMask[idx] === 1) continue;
        computedMask[idx] = 1;

        const nx0 = Math.max(0, x - radius);
        const nx1 = Math.min(workW - 1, x + radius);
        const area = (nx1 - nx0 + 1) * (ny1 - ny0 + 1);

        const bgL = boxSum(satL, nx0, ny0, nx1, ny1) / area;
        const bgR = boxSum(satR, nx0, ny0, nx1, ny1) / area;
        const bgG = boxSum(satG, nx0, ny0, nx1, ny1) / area;
        const bgB = boxSum(satB, nx0, ny0, nx1, ny1) / area;

        const wx0 = Math.max(0, x - radiusWide);
        const wx1 = Math.min(workW - 1, x + radiusWide);
        const wideArea = (wx1 - wx0 + 1) * (wy1 - wy0 + 1);
        const bgWideL = boxSum(satL, wx0, wy0, wx1, wy1) / wideArea;

        const xLt = Math.max(0, x - 1);
        const xRt = Math.min(workW - 1, x + 1);
        const gx = Math.abs(lumaArr[y * workW + xRt] - lumaArr[y * workW + xLt]);
        const gy = Math.abs(lumaArr[yDn * workW + x] - lumaArr[yUp * workW + x]);
        gradXArr[idx] = gx;
        gradYArr[idx] = gy;
        const grad = gx + gy;

        const luma = lumaArr[idx];
        const lumaDiff = luma - bgL;
        const wideLumaDiff = luma - bgWideL;
        const colorDiff =
          Math.abs(rArr[idx] - bgR) +
          Math.abs(gArr[idx] - bgG) +
          Math.abs(bArr[idx] - bgB);

        if (luma >= 244 && lumaDiff >= 38 && grad >= 20) {
          ultraWhiteMask[idx] = 1;
        }
        if (luma >= 232 && lumaDiff >= 24 && (grad >= 14 || lumaDiff >= 36)) {
          whiteCoreMask[idx] = 1;
        }
        if (luma >= 241 && wideLumaDiff >= 11 && (grad >= 8 || wideLumaDiff >= 16)) {
          brightOverlayMask[idx] = 1;
        }
        if (luma >= 185 && lumaDiff >= 20 && (grad >= 12 || lumaDiff >= 30)) {
          pureBrightMask[idx] = 1;
        }
        if (lumaDiff >= 32 && (grad >= 14 || lumaDiff >= 42)) {
          crispLightMask[idx] = 1;
        }
        if (lumaDiff >= 18 && (grad >= 10 || lumaDiff >= 27)) {
          medLightMask[idx] = 1;
        }
        if ((-lumaDiff >= 32 && (grad >= 14 || -lumaDiff >= 42)) || (colorDiff >= 75 && grad >= 14)) {
          crispDarkMask[idx] = 1;
        }
        if ((-lumaDiff >= 22 && (grad >= 12 || -lumaDiff >= 34)) || (colorDiff >= 64 && grad >= 14)) {
          medDarkMask[idx] = 1;
        }
        if (luma >= 115 && wideLumaDiff >= 8.5 && (grad >= 5.5 || wideLumaDiff >= 13)) {
          softTranslucentLightMask[idx] = 1;
        }
        if (luma <= 215 && -wideLumaDiff >= 10 && (grad >= 5.5 || -wideLumaDiff >= 15)) {
          softTranslucentDarkMask[idx] = 1;
        }
      }
    }
  };

  for (const roi of allRois) {
    ensureFeaturesComputed(roi.x0, roi.y0, roi.x1, roi.y1);
  }

  const minLogoW = Math.max(aggressive ? 28 : 34, Math.round(workW * (aggressive ? 0.032 : 0.040)));
  const maxLogoW = Math.min(aggressive ? 440 : 400, Math.round(workW * (aggressive ? 0.44 : 0.40)));
  const minLogoH = aggressive ? 8 : 9;
  const maxLogoH = Math.min(aggressive ? 110 : 90, Math.round(workH * (aggressive ? 0.17 : 0.14)));
  const maxLogoArea = workW * workH * (aggressive ? 0.045 : 0.035);

  const workBoxes: DetectedWorkBox[] = [];
  const softGridCandidates: DetectedWorkBox[] = [];

  const addOrMergeIntoList = (list: DetectedWorkBox[], candidate: DetectedWorkBox) => {
    const h = candidate.maxY - candidate.minY + 1;
    const existingIdx = list.findIndex((b) => {
      const overlaps = !(
        candidate.maxX + 4 < b.minX ||
        candidate.minX - 4 > b.maxX ||
        candidate.maxY + 4 < b.minY ||
        candidate.minY - 4 > b.maxY
      );
      if (overlaps) return true;
      const vertOverlap = Math.min(candidate.maxY, b.maxY) - Math.max(candidate.minY, b.minY);
      const sameLine = vertOverlap >= Math.min(h, b.maxY - b.minY + 1) * 0.5;
      const horizGap = Math.max(0, Math.max(candidate.minX - b.maxX, b.minX - candidate.maxX));
      return sameLine && horizGap <= 18;
    });

    if (existingIdx !== -1) {
      const b = list[existingIdx];
      const mergedMinX = Math.min(b.minX, candidate.minX);
      const mergedMinY = Math.min(b.minY, candidate.minY);
      const mergedMaxX = Math.max(b.maxX, candidate.maxX);
      const mergedMaxY = Math.max(b.maxY, candidate.maxY);
      if (mergedMaxX - mergedMinX + 1 <= maxLogoW && mergedMaxY - mergedMinY + 1 <= maxLogoH) {
        b.minX = mergedMinX;
        b.minY = mergedMinY;
        b.maxX = mergedMaxX;
        b.maxY = mergedMaxY;
      }
    } else {
      list.push(candidate);
    }
  };

  interface ScanOptions {
    targetList: DetectedWorkBox[];
    polarity: MaskPolarity;
    relaxedForGrid?: {
      expectedW: number;
      expectedH: number;
    };
    verticalText?: boolean;
  }

  const scanRoiWithMask = (
    roi: RoisSpec,
    fgMask: Uint8Array,
    tier: MaskTier,
    scanOpts: ScanOptions
  ) => {
    const ex0 = Math.max(0, roi.x0 - roiMargin);
    const ey0 = Math.max(0, roi.y0 - roiMargin);
    const ex1 = Math.min(workW, roi.x1 + roiMargin);
    const ey1 = Math.min(workH, roi.y1 + roiMargin);
    const rw = ex1 - ex0;
    const rh = ey1 - ey0;
    if (rw <= 0 || rh <= 0) return;

    const isVertical = Boolean(scanOpts.verticalText);
    const dil = new Uint8Array(rw * rh);
    const padSpan = tier === "whiteCore" || tier === "brightOverlay" || tier === "softTranslucent" ? 3 : 2;

    if (isVertical) {
      // Vertical-only glyph grouping for 90-degree rotated edge owner-name texts
      for (let ly = 0; ly < rh; ly++) {
        const gy = ey0 + ly;
        for (let lx = 0; lx < rw; lx++) {
          if (fgMask[gy * workW + ex0 + lx] === 1) {
            const yA = Math.max(0, ly - padSpan);
            const yB = Math.min(rh - 1, ly + padSpan);
            for (let yy = yA; yy <= yB; yy++) {
              dil[yy * rw + lx] = 1;
            }
          }
        }
      }
    } else {
      // Horizontal-only glyph grouping joins side-by-side characters/icons without vertical bridges
      for (let ly = 0; ly < rh; ly++) {
        const gy = ey0 + ly;
        for (let lx = 0; lx < rw; lx++) {
          if (fgMask[gy * workW + ex0 + lx] === 1) {
            const xA = Math.max(0, lx - padSpan);
            const xB = Math.min(rw - 1, lx + padSpan);
            const off = ly * rw;
            for (let xx = xA; xx <= xB; xx++) {
              dil[off + xx] = 1;
            }
          }
        }
      }
    }

    const visited = new Uint8Array(rw * rh);
    const queueX = new Int32Array(rw * rh);
    const queueY = new Int32Array(rw * rh);

    const atomicComponents: RawComponent[] = [];

    for (let ly = 0; ly < rh; ly++) {
      for (let lx = 0; lx < rw; lx++) {
        const startLocal = ly * rw + lx;
        if (dil[startLocal] === 0 || visited[startLocal] === 1) continue;

        let head = 0;
        let tail = 0;
        queueX[tail] = lx;
        queueY[tail] = ly;
        tail++;
        visited[startLocal] = 1;

        let minX = workW;
        let minY = workH;
        let maxX = -1;
        let maxY = -1;
        let fgCount = 0;
        let gradXSum = 0;
        let gradYSum = 0;

        while (head < tail) {
          const cx = queueX[head];
          const cy = queueY[head];
          head++;

          const gx = ex0 + cx;
          const gy = ey0 + cy;
          const gIdx = gy * workW + gx;
          if (fgMask[gIdx] === 1) {
            fgCount++;
            gradXSum += gradXArr[gIdx];
            gradYSum += gradYArr[gIdx];
            if (gx < minX) minX = gx;
            if (gx > maxX) maxX = gx;
            if (gy < minY) minY = gy;
            if (gy > maxY) maxY = gy;
          }

          for (let dy = -1; dy <= 1; dy++) {
            const ny = cy + dy;
            if (ny < 0 || ny >= rh) continue;
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = cx + dx;
              if (nx < 0 || nx >= rw) continue;
              const nLocal = ny * rw + nx;
              if (dil[nLocal] === 1 && visited[nLocal] === 0) {
                visited[nLocal] = 1;
                queueX[tail] = nx;
                queueY[tail] = ny;
                tail++;
              }
            }
          }
        }

        if (fgCount < 10 || maxX < minX || maxY < minY) continue;

        // Reject structures extending beyond the ROI interior edges (walls, radiators, furniture)
        if (roi.innerTop && minY <= ey0 + 2) continue;
        if (roi.innerBottom && maxY >= ey1 - 3) continue;
        if (roi.innerLeft && minX <= ex0 + 2) continue;
        if (roi.innerRight && maxX >= ex1 - 3) continue;

        const w = maxX - minX + 1;
        const h = maxY - minY + 1;
        if (isVertical) {
          if (w > maxLogoH || h > maxLogoW || w < 5 || h < 5) continue;
        } else {
          if (w > maxLogoW || h > maxLogoH || w < 4 || h < 5) continue;
        }

        atomicComponents.push({
          minX,
          minY,
          maxX,
          maxY,
          fgCount,
          gradXSum,
          gradYSum,
          wordCount: 1,
        });
      }
    }

    if (atomicComponents.length === 0) return;

    // Group adjacent words on the same baseline (e.g., "ION POPESCU", "MARIA IONESCU") before full validation
    const candidates: RawComponent[] = [];
    if (isVertical) {
      atomicComponents.sort((a, b) => a.minY - b.minY || a.minX - b.minX);
      for (const comp of atomicComponents) {
        const ch = comp.maxY - comp.minY + 1;
        const cw = comp.maxX - comp.minX + 1;
        const matchIdx = candidates.findIndex((g) => {
          const gw = g.maxX - g.minX + 1;
          const horizOverlap = Math.min(comp.maxX, g.maxX) - Math.max(comp.minX, g.minX) + 1;
          if (horizOverlap < Math.min(cw, gw) * 0.45) return false;
          const gap = comp.minY - g.maxY;
          const maxGap = Math.max(10, Math.min(24, Math.round(Math.max(cw, gw) * 1.15)));
          if (gap < -4 || gap > maxGap) return false;
          if (gap > 5 && Math.min(cw, gw) < Math.max(cw, gw) * 0.48) return false;
          const nextH = Math.max(g.maxY, comp.maxY) - Math.min(g.minY, comp.minY) + 1;
          const nextW = Math.max(g.maxX, comp.maxX) - Math.min(g.minX, comp.minX) + 1;
          return nextH <= maxLogoW && nextW <= maxLogoH && ch >= 5;
        });

        if (matchIdx !== -1) {
          const g = candidates[matchIdx];
          g.minX = Math.min(g.minX, comp.minX);
          g.minY = Math.min(g.minY, comp.minY);
          g.maxX = Math.max(g.maxX, comp.maxX);
          g.maxY = Math.max(g.maxY, comp.maxY);
          g.fgCount += comp.fgCount;
          g.gradXSum += comp.gradXSum;
          g.gradYSum += comp.gradYSum;
          g.wordCount += 1;
        } else {
          candidates.push({ ...comp });
        }
      }
    } else {
      atomicComponents.sort((a, b) => a.minX - b.minX || a.minY - b.minY);
      for (const comp of atomicComponents) {
        const ch = comp.maxY - comp.minY + 1;
        const matchIdx = candidates.findIndex((g) => {
          const gh = g.maxY - g.minY + 1;
          const vertOverlap = Math.min(comp.maxY, g.maxY) - Math.max(comp.minY, g.minY) + 1;
          if (vertOverlap < Math.min(ch, gh) * 0.45) return false;
          const gap = comp.minX - g.maxX;
          const maxGap = Math.max(11, Math.min(26, Math.round(Math.max(ch, gh) * 1.15)));
          if (gap < -4 || gap > maxGap) return false;
          if (gap > 5 && Math.min(ch, gh) < Math.max(ch, gh) * 0.48) return false;
          const nextW = Math.max(g.maxX, comp.maxX) - Math.min(g.minX, comp.minX) + 1;
          const nextH = Math.max(g.maxY, comp.maxY) - Math.min(g.minY, comp.minY) + 1;
          return nextW <= maxLogoW && nextH <= maxLogoH;
        });

        if (matchIdx !== -1) {
          const g = candidates[matchIdx];
          g.minX = Math.min(g.minX, comp.minX);
          g.minY = Math.min(g.minY, comp.minY);
          g.maxX = Math.max(g.maxX, comp.maxX);
          g.maxY = Math.max(g.maxY, comp.maxY);
          g.fgCount += comp.fgCount;
          g.gradXSum += comp.gradXSum;
          g.gradYSum += comp.gradYSum;
          g.wordCount += 1;
        } else {
          candidates.push({ ...comp });
        }
      }
    }

    const gridMatch = scanOpts.relaxedForGrid;

    for (const cand of candidates) {
      const { minX, minY, maxX, maxY, fgCount, gradXSum, gradYSum, wordCount } = cand;
      const w = maxX - minX + 1;
      const h = maxY - minY + 1;
      const area = w * h;

      const primarySpan = isVertical ? h : w;
      const thicknessSpan = isVertical ? w : h;

      const baseMinFg = tier === "softTranslucent" ? 60 : aggressive ? 70 : 90;
      const scaledMinFg = gridMatch
        ? Math.max(24, Math.min(55, Math.round(thicknessSpan * 3.2)))
        : Math.max(aggressive ? 36 : 44, Math.min(baseMinFg, Math.round(thicknessSpan * 4.5)));
      if (fgCount < scaledMinFg) continue;

      const centerX = (minX + maxX) * 0.5;
      const centerY = (minY + maxY) * 0.5;
      if (centerX < roi.x0 || centerX >= roi.x1 || centerY < roi.y0 || centerY >= roi.y1) continue;

      if (gridMatch) {
        if (
          w < Math.max(20, gridMatch.expectedW * 0.48) ||
          w > Math.min(maxLogoW, gridMatch.expectedW * 1.65) ||
          h < Math.max(6, gridMatch.expectedH * 0.48) ||
          h > Math.min(maxLogoH, gridMatch.expectedH * 1.65)
        ) {
          continue;
        }
      } else {
        if (
          primarySpan < minLogoW ||
          primarySpan > maxLogoW ||
          thicknessSpan < minLogoH ||
          thicknessSpan > maxLogoH
        ) {
          continue;
        }
      }
      if (area > maxLogoArea) continue;

      const aspect = primarySpan / thicknessSpan;
      const minAspect = isVertical ? 1.55 : gridMatch ? 1.10 : aggressive ? 1.15 : 1.35;
      const maxAspect = aggressive || gridMatch ? 15.0 : 13.5;
      if (aspect < minAspect || aspect > maxAspect) continue;

      // Watermarks have visual breathing margin; reject tall scene edges flush against frame boundary
      const touchesOuterFrameEdge = minX <= 1 || maxX >= workW - 2 || minY <= 1 || maxY >= workH - 2;
      if (touchesOuterFrameEdge && thicknessSpan > 42) continue;

      // Enforce outer margin/corner/middle-edge band placement unless scanning corroborated/strict center
      if (!roi.isCenter && !gridMatch) {
        const nearBottomEdge = maxY >= workH - Math.round(workH * (aggressive ? 0.21 : 0.16));
        const nearTopEdge =
          minY <= Math.round(workH * (aggressive ? 0.18 : 0.14)) &&
          (roi.strictZone
            ? minY <= Math.round(workH * (aggressive ? 0.15 : 0.12))
            : minX <= Math.round(workW * (aggressive ? 0.20 : 0.16)) ||
              maxX >= workW - Math.round(workW * (aggressive ? 0.20 : 0.16)));
        const nearSideEdge =
          minX <= Math.round(workW * (aggressive ? 0.16 : 0.13)) ||
          maxX >= workW - Math.round(workW * (aggressive ? 0.16 : 0.13));
        if (!nearBottomEdge && !nearTopEdge && !nearSideEdge) continue;
      }

      const fillRatio = fgCount / area;
      const baseMinFill =
        tier === "whiteCore"
          ? 0.11
          : tier === "softTranslucent"
          ? 0.15
          : tier === "brightOverlay"
          ? 0.19
          : 0.20;
      const minFill = wordCount >= 2 ? baseMinFill * 0.78 : gridMatch ? baseMinFill * 0.75 : baseMinFill;
      if (fillRatio < minFill || fillRatio > 0.78) continue;

      const meanGrad = (gradXSum + gradYSum) / fgCount;
      const reqGrad = gridMatch
        ? 7.5
        : roi.isCenter
        ? tier === "softTranslucent"
          ? 12
          : aggressive
          ? 34
          : 44
        : roi.strictZone
        ? tier === "softTranslucent"
          ? 11
          : tier === "brightOverlay"
          ? aggressive
            ? 12
            : 15
          : aggressive
          ? 32
          : 42
        : tier === "softTranslucent"
        ? 9.5
        : tier === "brightOverlay"
        ? aggressive
          ? 11
          : 14
        : tier === "whiteCore"
        ? aggressive
          ? 30
          : 38
        : tier === "crisp"
        ? aggressive
          ? 24
          : 30
        : aggressive
        ? 38
        : 48;
      if (meanGrad < reqGrad) continue;

      const minAx = Math.min(gradXSum, gradYSum);
      const maxAx = Math.max(gradXSum, gradYSum);
      const minAxRatio = gridMatch
        ? 0.22
        : roi.isCenter
        ? 0.32
        : isVertical
        ? 0.30
        : tier === "brightOverlay"
        ? 0.36
        : tier === "softTranslucent"
        ? 0.28
        : 0.25;
      if (maxAx > 0 && minAx / maxAx < minAxRatio) continue;

      // Measure stroke transitions along the reading axis & glyph clusters
      let totalLineTransitions = 0;
      let maxLineTransitions = 0;
      let activeLines = 0;
      let multiLines = 0;
      const axisHasFg = new Uint8Array(primarySpan);

      if (isVertical) {
        for (let gx = minX; gx <= maxX; gx++) {
          let colTransitions = 0;
          let prev = 0;
          let colFg = 0;
          for (let gy = minY; gy <= maxY; gy++) {
            const cur = fgMask[gy * workW + gx];
            if (cur === 1) {
              colFg++;
              axisHasFg[gy - minY] = 1;
              if (prev === 0) colTransitions++;
            }
            prev = cur;
          }
          if (colFg > 0) {
            activeLines++;
            totalLineTransitions += colTransitions;
            if (colTransitions > maxLineTransitions) maxLineTransitions = colTransitions;
            if (colTransitions >= 3) multiLines++;
          }
        }
      } else {
        for (let gy = minY; gy <= maxY; gy++) {
          let rowTransitions = 0;
          let prev = 0;
          let rowFg = 0;
          const rowOff = gy * workW;
          for (let gx = minX; gx <= maxX; gx++) {
            const cur = fgMask[rowOff + gx];
            if (cur === 1) {
              rowFg++;
              axisHasFg[gx - minX] = 1;
              if (prev === 0) rowTransitions++;
            }
            prev = cur;
          }
          if (rowFg > 0) {
            activeLines++;
            totalLineTransitions += rowTransitions;
            if (rowTransitions > maxLineTransitions) maxLineTransitions = rowTransitions;
            if (rowTransitions >= 3) multiLines++;
          }
        }
      }

      let glyphClusters = 0;
      let prevCluster = 0;
      for (let i = 0; i < primarySpan; i++) {
        if (axisHasFg[i] === 1 && prevCluster === 0) glyphClusters++;
        prevCluster = axisHasFg[i];
      }

      const avgTransitionsPerLine = activeLines > 0 ? totalLineTransitions / activeLines : 0;
      const multiLineRatio = activeLines > 0 ? multiLines / activeLines : 0;

      const reqMaxT = gridMatch
        ? 3
        : roi.isCenter
        ? 6
        : roi.strictZone
        ? tier === "softTranslucent"
          ? 5
          : 5
        : tier === "softTranslucent"
        ? 4
        : tier === "brightOverlay"
        ? aggressive
          ? 5
          : 6
        : aggressive
        ? 4
        : 5;

      const reqAvgT = gridMatch
        ? 1.9
        : roi.isCenter
        ? 3.4
        : roi.strictZone
        ? tier === "softTranslucent"
          ? 2.8
          : 3.1
        : tier === "softTranslucent"
        ? 2.3
        : tier === "brightOverlay"
        ? aggressive
          ? 2.9
          : 3.6
        : aggressive
        ? 2.4
        : 2.8;

      const reqMrr = gridMatch
        ? 0.38
        : roi.isCenter
        ? 0.64
        : roi.strictZone
        ? tier === "softTranslucent"
          ? 0.55
          : 0.62
        : tier === "whiteCore"
        ? 0.44
        : tier === "softTranslucent"
        ? 0.44
        : tier === "brightOverlay"
        ? aggressive
          ? 0.50
          : 0.60
        : aggressive
        ? 0.50
        : 0.58;

      if (
        maxLineTransitions < reqMaxT ||
        avgTransitionsPerLine < reqAvgT ||
        multiLineRatio < reqMrr
      ) {
        continue;
      }

      const reqClusters = gridMatch ? 3 : roi.isCenter ? 5 : isVertical ? 4 : aggressive ? 3 : 4;
      if (aspect > 1.7 && glyphClusters < reqClusters) continue;

      let haloTotal = 0;
      let haloFg = 0;
      const hx0 = Math.max(ex0, minX - 7);
      const hx1 = Math.min(ex1 - 1, maxX + 7);
      const hy0 = Math.max(ey0, minY - 7);
      const hy1 = Math.min(ey1 - 1, maxY + 7);

      for (let gy = hy0; gy <= hy1; gy++) {
        const inInnerY = gy >= minY - 2 && gy <= maxY + 2;
        const rowOff = gy * workW;
        for (let gx = hx0; gx <= hx1; gx++) {
          const inInnerX = gx >= minX - 2 && gx <= maxX + 2;
          if (inInnerX && inInnerY) continue;
          haloTotal++;
          if (fgMask[rowOff + gx] === 1) haloFg++;
        }
      }

      const maxHalo = gridMatch
        ? 0.14
        : roi.isCenter
        ? 0.025
        : roi.strictZone || tier === "brightOverlay"
        ? 0.05
        : tier === "softTranslucent"
        ? 0.06
        : tier === "medium"
        ? 0.04
        : 0.08;
      if (haloTotal > 20 && haloFg / haloTotal > maxHalo) continue;

      addOrMergeIntoList(scanOpts.targetList, {
        minX,
        minY,
        maxX,
        maxY,
        row: roi.row,
        col: roi.col,
        polarity: scanOpts.polarity,
        tier,
      });
    }
  };

  // Pass 1: Scan all 8 perimeter ROIs (4 corners + top/bottom center + middle-left/middle-right)
  for (const roi of perimeterRois) {
    scanRoiWithMask(roi, whiteCoreMask, "whiteCore", { targetList: workBoxes, polarity: "light" });
    scanRoiWithMask(roi, ultraWhiteMask, "whiteCore", { targetList: workBoxes, polarity: "light" });
    scanRoiWithMask(roi, brightOverlayMask, "brightOverlay", { targetList: workBoxes, polarity: "light" });
    scanRoiWithMask(roi, pureBrightMask, "crisp", { targetList: workBoxes, polarity: "light" });
    scanRoiWithMask(roi, crispLightMask, "crisp", { targetList: workBoxes, polarity: "light" });
    scanRoiWithMask(roi, crispDarkMask, "crisp", { targetList: workBoxes, polarity: "dark" });

    if (!roi.strictZone) {
      scanRoiWithMask(roi, medLightMask, "medium", { targetList: workBoxes, polarity: "light" });
      scanRoiWithMask(roi, medDarkMask, "medium", { targetList: workBoxes, polarity: "dark" });
    }

    // Translucent owner-name texts: directly accepted in aggressive mode; collected for grid corroboration otherwise
    const softTarget = aggressive ? workBoxes : softGridCandidates;
    scanRoiWithMask(roi, softTranslucentLightMask, "softTranslucent", {
      targetList: softTarget,
      polarity: "light",
    });
    scanRoiWithMask(roi, softTranslucentDarkMask, "softTranslucent", {
      targetList: softTarget,
      polarity: "dark",
    });
  }

  // Pass 1b: Also check 90-degree vertical owner-name texts hugging the left/right vertical mid-edges
  const verticalSideW = Math.round(workW * 0.14);
  const verticalEdgeRois: RoisSpec[] = [
    {
      name: "middle-left-vertical",
      row: 1,
      col: 0,
      x0: 0,
      y0: Math.round(workH * 0.18),
      x1: verticalSideW,
      y1: Math.round(workH * 0.82),
      innerLeft: false,
      innerRight: true,
      innerTop: true,
      innerBottom: true,
      strictZone: false,
    },
    {
      name: "middle-right-vertical",
      row: 1,
      col: 2,
      x0: workW - verticalSideW,
      y0: Math.round(workH * 0.18),
      x1: workW,
      y1: Math.round(workH * 0.82),
      innerLeft: true,
      innerRight: false,
      innerTop: true,
      innerBottom: true,
      strictZone: false,
    },
  ];
  for (const vRoi of verticalEdgeRois) {
    ensureFeaturesComputed(vRoi.x0, vRoi.y0, vRoi.x1, vRoi.y1);
    scanRoiWithMask(vRoi, whiteCoreMask, "whiteCore", {
      targetList: workBoxes,
      polarity: "light",
      verticalText: true,
    });
    scanRoiWithMask(vRoi, crispLightMask, "crisp", {
      targetList: workBoxes,
      polarity: "light",
      verticalText: true,
    });
    scanRoiWithMask(vRoi, crispDarkMask, "crisp", {
      targetList: workBoxes,
      polarity: "dark",
      verticalText: true,
    });
    const softTarget = aggressive ? workBoxes : softGridCandidates;
    scanRoiWithMask(vRoi, softTranslucentLightMask, "softTranslucent", {
      targetList: softTarget,
      polarity: "light",
      verticalText: true,
    });
    scanRoiWithMask(vRoi, softTranslucentDarkMask, "softTranslucent", {
      targetList: softTarget,
      polarity: "dark",
      verticalText: true,
    });
  }

  // Pass 2: Repeated 3x3 grid watermark corroboration (up to 9 owner-name texts)
  // Cluster perimeter detections (and soft candidates when non-aggressive) by compatible size & polarity
  const gridPool: DetectedWorkBox[] = [...workBoxes, ...softGridCandidates];
  const clusters: DetectedWorkBox[][] = [];

  for (const box of gridPool) {
    const bw = box.maxX - box.minX + 1;
    const bh = box.maxY - box.minY + 1;
    let placed = false;

    for (const cluster of clusters) {
      const ref = cluster[0];
      if (ref.polarity !== box.polarity) continue;
      const rw = ref.maxX - ref.minX + 1;
      const rh = ref.maxY - ref.minY + 1;
      const wRatio = Math.max(bw, rw) / Math.max(1, Math.min(bw, rw));
      const hRatio = Math.max(bh, rh) / Math.max(1, Math.min(bh, rh));
      if (wRatio <= 1.55 && (hRatio <= 1.55 || Math.abs(bh - rh) <= 5)) {
        // Avoid duplicating the exact same box in the same slot
        const sameSlotOverlap = cluster.some(
          (c) =>
            c.row === box.row &&
            c.col === box.col &&
            !(box.maxX + 6 < c.minX || box.minX - 6 > c.maxX || box.maxY + 6 < c.minY || box.minY - 6 > c.maxY)
        );
        if (!sameSlotOverlap) {
          cluster.push(box);
        }
        placed = true;
        break;
      }
    }

    if (!placed) {
      clusters.push([box]);
    }
  }

  const confirmedGridClusters = clusters.filter((cluster) => {
    const distinctSlots = new Set(cluster.map((b) => `${b.row},${b.col}`));
    return distinctSlots.size >= 2;
  });

  // Promote any softGridCandidates that belong to a confirmed repeated watermark grid
  for (const cluster of confirmedGridClusters) {
    for (const item of cluster) {
      addOrMergeIntoList(workBoxes, item);
    }
  }

  // Pass 3: For each confirmed repeated-text grid, scan the center (9th slot) & any missed grid slots
  const median = (vals: number[]): number => {
    const sorted = [...vals].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) * 0.5;
  };

  for (const cluster of confirmedGridClusters) {
    const expectedW = median(cluster.map((b) => b.maxX - b.minX + 1));
    const expectedH = median(cluster.map((b) => b.maxY - b.minY + 1));
    const polarity = cluster[0].polarity;
    const isVerticalCluster = expectedH > expectedW * 1.4;

    // Estimate 3x3 row Y-centers and column X-centers from detected stamps (with symmetric fallbacks)
    const rowYs: Array<number[]> = [[], [], []];
    const colXs: Array<number[]> = [[], [], []];
    for (const b of cluster) {
      rowYs[b.row].push((b.minY + b.maxY) * 0.5);
      colXs[b.col].push((b.minX + b.maxX) * 0.5);
    }

    const rowCenter: [number, number, number] = [
      rowYs[0].length > 0 ? median(rowYs[0]) : rowYs[2].length > 0 ? Math.max(expectedH, workH - median(rowYs[2])) : Math.round(workH * 0.08),
      rowYs[1].length > 0
        ? median(rowYs[1])
        : rowYs[0].length > 0 && rowYs[2].length > 0
        ? (median(rowYs[0]) + median(rowYs[2])) * 0.5
        : workH * 0.5,
      rowYs[2].length > 0 ? median(rowYs[2]) : rowYs[0].length > 0 ? Math.min(workH - expectedH, workH - median(rowYs[0])) : Math.round(workH * 0.92),
    ];

    const colCenter: [number, number, number] = [
      colXs[0].length > 0 ? median(colXs[0]) : colXs[2].length > 0 ? Math.max(expectedW * 0.6, workW - median(colXs[2])) : Math.round(workW * 0.14),
      colXs[1].length > 0
        ? median(colXs[1])
        : colXs[0].length > 0 && colXs[2].length > 0
        ? (median(colXs[0]) + median(colXs[2])) * 0.5
        : workW * 0.5,
      colXs[2].length > 0 ? median(colXs[2]) : colXs[0].length > 0 ? Math.min(workW - expectedW * 0.6, workW - median(colXs[0])) : Math.round(workW * 0.86),
    ];

    const halfWinW = Math.max(Math.round(expectedW * 0.95), Math.round(workW * 0.13));
    const halfWinH = Math.max(Math.round(expectedH * 1.9), Math.round(workH * 0.08));

    const masksForPolarity: Array<{ mask: Uint8Array; tier: MaskTier }> =
      polarity === "light"
        ? [
            { mask: whiteCoreMask, tier: "whiteCore" },
            { mask: brightOverlayMask, tier: "brightOverlay" },
            { mask: pureBrightMask, tier: "crisp" },
            { mask: crispLightMask, tier: "crisp" },
            { mask: medLightMask, tier: "medium" },
            { mask: softTranslucentLightMask, tier: "softTranslucent" },
          ]
        : [
            { mask: crispDarkMask, tier: "crisp" },
            { mask: medDarkMask, tier: "medium" },
            { mask: softTranslucentDarkMask, tier: "softTranslucent" },
          ];

    for (let r = 0 as GridRow; r <= 2; r = (r + 1) as GridRow) {
      for (let c = 0 as GridCol; c <= 2; c = (c + 1) as GridCol) {
        // Skip slots that already have a detected box near this grid cell
        const targetCx = colCenter[c];
        const targetCy = rowCenter[r];
        const alreadyCovered = workBoxes.some((b) => {
          const bcx = (b.minX + b.maxX) * 0.5;
          const bcy = (b.minY + b.maxY) * 0.5;
          return (
            Math.abs(bcx - targetCx) <= halfWinW * 0.9 &&
            Math.abs(bcy - targetCy) <= halfWinH * 0.9
          );
        });
        if (alreadyCovered) continue;

        const sx0 = Math.max(0, Math.round(targetCx - halfWinW));
        const sy0 = Math.max(0, Math.round(targetCy - halfWinH));
        const sx1 = Math.min(workW, Math.round(targetCx + halfWinW));
        const sy1 = Math.min(workH, Math.round(targetCy + halfWinH));
        if (sx1 - sx0 < 24 || sy1 - sy0 < 12) continue;

        ensureFeaturesComputed(sx0, sy0, sx1, sy1);

        const slotRoi: RoisSpec = {
          name: `grid-slot-${r}-${c}`,
          row: r,
          col: c,
          x0: sx0,
          y0: sy0,
          x1: sx1,
          y1: sy1,
          innerLeft: sx0 > 0,
          innerRight: sx1 < workW,
          innerTop: sy0 > 0,
          innerBottom: sy1 < workH,
          strictZone: false,
          isCenter: r === 1 && c === 1,
        };

        for (const { mask, tier } of masksForPolarity) {
          scanRoiWithMask(slotRoi, mask, tier, {
            targetList: workBoxes,
            polarity,
            relaxedForGrid: { expectedW, expectedH },
            verticalText: isVerticalCluster,
          });
        }
      }
    }
  }

  // Pass 4: Standalone strict scan of the center ROI (catches single centered text watermarks without false positives)
  scanRoiWithMask(centerRoi, whiteCoreMask, "whiteCore", { targetList: workBoxes, polarity: "light" });
  scanRoiWithMask(centerRoi, ultraWhiteMask, "whiteCore", { targetList: workBoxes, polarity: "light" });
  scanRoiWithMask(centerRoi, crispLightMask, "crisp", { targetList: workBoxes, polarity: "light" });
  scanRoiWithMask(centerRoi, crispDarkMask, "crisp", { targetList: workBoxes, polarity: "dark" });
  if (aggressive) {
    scanRoiWithMask(centerRoi, softTranslucentLightMask, "softTranslucent", {
      targetList: workBoxes,
      polarity: "light",
    });
    scanRoiWithMask(centerRoi, softTranslucentDarkMask, "softTranslucent", {
      targetList: workBoxes,
      polarity: "dark",
    });
  }

  return workBoxes.map((b) => {
    const startX = Math.max(0, Math.floor(b.minX / scale));
    const startY = Math.max(0, Math.floor(b.minY / scale));
    const endX = Math.min(origW, Math.ceil((b.maxX + 1) / scale));
    const endY = Math.min(origH, Math.ceil((b.maxY + 1) / scale));
    return {
      startX,
      startY,
      w: Math.max(1, endX - startX),
      h: Math.max(1, endY - startY),
    };
  });
}

/**
 * Applies clean local perimeter-interpolated inpainting + smooth local blur
 * strictly inside the detected small logo/text box (+3px..+5px tight margin).
 * Zero pixels outside that small region are modified.
 */
export function inpaintLogoBox(image: any, box: LogoBox, options?: { pad?: number }): void {
  const width: number = image?.width ?? image?.bitmap?.width ?? 0;
  const height: number = image?.height ?? image?.bitmap?.height ?? 0;
  const data: Uint8Array | Buffer | undefined = image?.bitmap?.data;
  if (!data || width <= 0 || height <= 0) return;

  const pad = Math.max(2, Math.min(8, Math.round(options?.pad ?? 3)));
  const startX = Math.max(0, box.startX - pad);
  const startY = Math.max(0, box.startY - pad);
  const endX = Math.min(width, box.startX + box.w + pad);
  const endY = Math.min(height, box.startY + box.h + pad);
  const actualW = endX - startX;
  const actualH = endY - startY;

  if (actualW <= 2 || actualH <= 2) return;

  const origR = new Uint8Array(actualW * actualH);
  const origG = new Uint8Array(actualW * actualH);
  const origB = new Uint8Array(actualW * actualH);
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const idx = (y * width + x) * 4;
      const localIdx = (y - startY) * actualW + (x - startX);
      origR[localIdx] = data[idx];
      origG[localIdx] = data[idx + 1];
      origB[localIdx] = data[idx + 2];
    }
  }

  const samplePixel = (x: number, y: number) => {
    const cx = Math.max(0, Math.min(width - 1, x));
    const cy = Math.max(0, Math.min(height - 1, y));
    const idx = (cy * width + cx) * 4;
    return { r: data[idx], g: data[idx + 1], b: data[idx + 2] };
  };

  const topBorder = Array.from({ length: actualW }, (_, dx) => {
    const p1 = samplePixel(startX + dx, startY - 1);
    const p2 = samplePixel(startX + dx, startY - 2);
    return { r: (p1.r + p2.r) * 0.5, g: (p1.g + p2.g) * 0.5, b: (p1.b + p2.b) * 0.5 };
  });

  const bottomBorder = Array.from({ length: actualW }, (_, dx) => {
    const p1 = samplePixel(startX + dx, endY);
    const p2 = samplePixel(startX + dx, endY + 1);
    return { r: (p1.r + p2.r) * 0.5, g: (p1.g + p2.g) * 0.5, b: (p1.b + p2.b) * 0.5 };
  });

  const leftBorder = Array.from({ length: actualH }, (_, dy) => {
    const p1 = samplePixel(startX - 1, startY + dy);
    const p2 = samplePixel(startX - 2, startY + dy);
    return { r: (p1.r + p2.r) * 0.5, g: (p1.g + p2.g) * 0.5, b: (p1.b + p2.b) * 0.5 };
  });

  const rightBorder = Array.from({ length: actualH }, (_, dy) => {
    const p1 = samplePixel(endX, startY + dy);
    const p2 = samplePixel(endX + 1, startY + dy);
    return { r: (p1.r + p2.r) * 0.5, g: (p1.g + p2.g) * 0.5, b: (p1.b + p2.b) * 0.5 };
  });

  const topMult = startY <= 2 ? 0.05 : 1.0;
  const botMult = endY >= height - 2 ? 0.05 : 1.0;
  const leftMult = startX <= 2 ? 0.05 : 1.0;
  const rightMult = endX >= width - 2 ? 0.05 : 1.0;

  const workR = new Float32Array(actualW * actualH);
  const workG = new Float32Array(actualW * actualH);
  const workB = new Float32Array(actualW * actualH);

  for (let dy = 0; dy < actualH; dy++) {
    const lC = leftBorder[dy];
    const rC = rightBorder[dy];
    const dTop = dy + 1;
    const dBot = actualH - dy;

    for (let dx = 0; dx < actualW; dx++) {
      const tC = topBorder[dx];
      const bC = bottomBorder[dx];
      const dLeft = dx + 1;
      const dRight = actualW - dx;

      const wTop = topMult / Math.pow(dTop, 1.5);
      const wBot = botMult / Math.pow(dBot, 1.5);
      const wLeft = leftMult / Math.pow(dLeft, 1.5);
      const wRight = rightMult / Math.pow(dRight, 1.5);
      const sumW = wTop + wBot + wLeft + wRight;

      const localIdx = dy * actualW + dx;
      workR[localIdx] = (tC.r * wTop + bC.r * wBot + lC.r * wLeft + rC.r * wRight) / sumW;
      workG[localIdx] = (tC.g * wTop + bC.g * wBot + lC.g * wLeft + rC.g * wRight) / sumW;
      workB[localIdx] = (tC.b * wTop + bC.b * wBot + lC.b * wLeft + rC.b * wRight) / sumW;
    }
  }

  const blurR = new Float32Array(actualW * actualH);
  const blurG = new Float32Array(actualW * actualH);
  const blurB = new Float32Array(actualW * actualH);

  for (let pass = 0; pass < 2; pass++) {
    for (let dy = 0; dy < actualH; dy++) {
      for (let dx = 0; dx < actualW; dx++) {
        let sr = 0;
        let sg = 0;
        let sb = 0;
        let cnt = 0;
        for (let ky = -2; ky <= 2; ky++) {
          const yy = Math.max(0, Math.min(actualH - 1, dy + ky));
          for (let kx = -2; kx <= 2; kx++) {
            const xx = Math.max(0, Math.min(actualW - 1, dx + kx));
            const kIdx = yy * actualW + xx;
            sr += workR[kIdx];
            sg += workG[kIdx];
            sb += workB[kIdx];
            cnt++;
          }
        }
        const localIdx = dy * actualW + dx;
        blurR[localIdx] = sr / cnt;
        blurG[localIdx] = sg / cnt;
        blurB[localIdx] = sb / cnt;
      }
    }
    workR.set(blurR);
    workG.set(blurG);
    workB.set(blurB);
  }

  const feather = 3;
  for (let dy = 0; dy < actualH; dy++) {
    const gy = startY + dy;
    const distT = startY > 2 ? dy : 999;
    const distB = endY < height - 2 ? actualH - 1 - dy : 999;
    for (let dx = 0; dx < actualW; dx++) {
      const gx = startX + dx;
      const distL = startX > 2 ? dx : 999;
      const distR = endX < width - 2 ? actualW - 1 - dx : 999;

      const minDist = Math.min(distT, distB, distL, distR);
      const alpha = minDist < feather ? (minDist + 1) / (feather + 1) : 1.0;

      const localIdx = dy * actualW + dx;
      const outR = Math.max(0, Math.min(255, Math.round(origR[localIdx] * (1 - alpha) + workR[localIdx] * alpha)));
      const outG = Math.max(0, Math.min(255, Math.round(origG[localIdx] * (1 - alpha) + workG[localIdx] * alpha)));
      const outB = Math.max(0, Math.min(255, Math.round(origB[localIdx] * (1 - alpha) + workB[localIdx] * alpha)));

      const dstIdx = (gy * width + gx) * 4;
      data[dstIdx] = outR;
      data[dstIdx + 1] = outG;
      data[dstIdx + 2] = outB;
      data[dstIdx + 3] = 255;
    }
  }
}
