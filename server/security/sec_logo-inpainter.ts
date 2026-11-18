export interface LogoBox {
  startX: number;
  startY: number;
  w: number;
  h: number;
}

interface RoisSpec {
  name: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  innerLeft: boolean;
  innerRight: boolean;
  innerTop: boolean;
  innerBottom: boolean;
  strictZone: boolean;
}

/**
 * Deterministic (non-AI) logo / watermark detector.
 * Scans outer margin/corner ROIs at a normalized working resolution (~1000px long edge),
 * evaluates multi-tier local-contrast stroke masks (separating crisp white watermarks,
 * translucent light marks, and dark/colored logos so background textures like brick/grass/tiles
 * do not bridge into letters), groups horizontally with tight dilation (dx=2, dy=0),
 * and strictly verifies dimensions, 2D edge sharpness, stroke complexity, continuity, and halo.
 */
export function detectLogoBoxes(image: any): LogoBox[] {
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

  const cornerW = Math.round(workW * 0.36);
  const cornerH = Math.round(workH * 0.23);
  const rois: RoisSpec[] = [
    {
      name: "bottom-left",
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
      x0: Math.round(workW * 0.28),
      y0: workH - Math.round(workH * 0.21),
      x1: Math.round(workW * 0.72),
      y1: workH,
      innerLeft: true,
      innerRight: true,
      innerTop: true,
      innerBottom: false,
      strictZone: false,
    },
    {
      name: "top-left",
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
      x0: Math.round(workW * 0.28),
      y0: 0,
      x1: Math.round(workW * 0.72),
      y1: Math.round(workH * 0.20),
      innerLeft: true,
      innerRight: true,
      innerTop: false,
      innerBottom: true,
      strictZone: true,
    },
  ];

  // Multi-tier stroke masks prevent bright/textured backgrounds from welding onto crisp vector logos
  const ultraWhiteMask = new Uint8Array(totalPixels);
  const whiteCoreMask = new Uint8Array(totalPixels);
  const brightOverlayMask = new Uint8Array(totalPixels);
  const pureBrightMask = new Uint8Array(totalPixels);
  const crispLightMask = new Uint8Array(totalPixels);
  const crispDarkMask = new Uint8Array(totalPixels);
  const medLightMask = new Uint8Array(totalPixels);
  const medDarkMask = new Uint8Array(totalPixels);
  const computedMask = new Uint8Array(totalPixels);
  const gradXArr = new Float32Array(totalPixels);
  const gradYArr = new Float32Array(totalPixels);

  const radius = 9;
  const radiusWide = 16;
  const roiMargin = 16;

  for (const roi of rois) {
    const ex0 = Math.max(0, roi.x0 - roiMargin);
    const ey0 = Math.max(0, roi.y0 - roiMargin);
    const ex1 = Math.min(workW, roi.x1 + roiMargin);
    const ey1 = Math.min(workH, roi.y1 + roiMargin);

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
      }
    }
  }

  const minLogoW = Math.max(44, Math.round(workW * 0.06));
  const maxLogoW = Math.min(380, Math.round(workW * 0.38));
  const minLogoH = 12;
  const maxLogoH = Math.min(90, Math.round(workH * 0.14));
  const maxLogoArea = workW * workH * 0.035;

  const workBoxes: Array<{ minX: number; minY: number; maxX: number; maxY: number }> = [];

  const scanRoiWithMask = (
    roi: RoisSpec,
    fgMask: Uint8Array,
    tier: "whiteCore" | "brightOverlay" | "crisp" | "medium"
  ) => {
    const ex0 = Math.max(0, roi.x0 - roiMargin);
    const ey0 = Math.max(0, roi.y0 - roiMargin);
    const ex1 = Math.min(workW, roi.x1 + roiMargin);
    const ey1 = Math.min(workH, roi.y1 + roiMargin);
    const rw = ex1 - ex0;
    const rh = ey1 - ey0;
    if (rw <= 0 || rh <= 0) return;

    // Horizontal-only glyph grouping joins side-by-side characters/icons without vertical bridges
    const dil = new Uint8Array(rw * rh);
    const dxPad = tier === "whiteCore" || tier === "brightOverlay" ? 3 : 2;
    for (let ly = 0; ly < rh; ly++) {
      const gy = ey0 + ly;
      for (let lx = 0; lx < rw; lx++) {
        if (fgMask[gy * workW + ex0 + lx] === 1) {
          const xA = Math.max(0, lx - dxPad);
          const xB = Math.min(rw - 1, lx + dxPad);
          const off = ly * rw;
          for (let xx = xA; xx <= xB; xx++) {
            dil[off + xx] = 1;
          }
        }
      }
    }

    const visited = new Uint8Array(rw * rh);
    const queueX = new Int32Array(rw * rh);
    const queueY = new Int32Array(rw * rh);

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

        if (fgCount < 95 || maxX < minX || maxY < minY) continue;

        // Reject structures extending beyond the ROI interior edges (walls, radiators, furniture)
        if (roi.innerTop && minY <= ey0 + 2) continue;
        if (roi.innerBottom && maxY >= ey1 - 3) continue;
        if (roi.innerLeft && minX <= ex0 + 2) continue;
        if (roi.innerRight && maxX >= ex1 - 3) continue;

        const centerX = (minX + maxX) * 0.5;
        const centerY = (minY + maxY) * 0.5;
        if (centerX < roi.x0 || centerX >= roi.x1 || centerY < roi.y0 || centerY >= roi.y1) continue;

        const w = maxX - minX + 1;
        const h = maxY - minY + 1;
        const area = w * h;

        if (w < minLogoW || w > maxLogoW || h < minLogoH || h > maxLogoH) continue;
        if (area > maxLogoArea) continue;
        const aspect = w / h;
        if (aspect < 1.35 || aspect > 12.0) continue;

        // Watermarks have visual breathing margin; reject tall dark/scene edges flush against frame boundary
        const touchesOuterFrameEdge = minX <= 1 || maxX >= workW - 2 || minY <= 1 || maxY >= workH - 2;
        if (touchesOuterFrameEdge && h > 42) continue;

        // Enforce outer margin/corner band placement so interior ceiling fixtures/blinds/railings never false-positive
        const nearBottomEdge = maxY >= workH - Math.round(workH * 0.14);
        const nearTopCorner =
          minY <= Math.round(workH * 0.12) &&
          (roi.strictZone
            ? minY <= Math.round(workH * 0.09)
            : minX <= Math.round(workW * 0.14) || maxX >= workW - Math.round(workW * 0.14));
        const nearSideEdge = minX <= Math.round(workW * 0.08) || maxX >= workW - Math.round(workW * 0.08);
        if (!nearBottomEdge && !nearTopCorner && !nearSideEdge) continue;

        const fillRatio = fgCount / area;
        const minFill = tier === "whiteCore" ? 0.11 : tier === "brightOverlay" ? 0.24 : 0.21;
        if (fillRatio < minFill || fillRatio > 0.78) continue;

        const meanGrad = (gradXSum + gradYSum) / fgCount;
        const reqGrad = roi.strictZone
          ? 46
          : tier === "brightOverlay"
          ? 14
          : tier === "whiteCore"
          ? 40
          : tier === "crisp"
          ? 32
          : 52;
        if (meanGrad < reqGrad) continue;
        const minAx = Math.min(gradXSum, gradYSum);
        const maxAx = Math.max(gradXSum, gradYSum);
        const minAxRatio = tier === "brightOverlay" ? 0.45 : 0.26;
        if (maxAx > 0 && minAx / maxAx < minAxRatio) continue;

        let totalRowTransitions = 0;
        let maxRowTransitions = 0;
        let activeRows = 0;
        let multiRows = 0;
        const colHasFg = new Uint8Array(w);

        for (let gy = minY; gy <= maxY; gy++) {
          let rowTransitions = 0;
          let prev = 0;
          let rowFg = 0;
          const rowOff = gy * workW;
          for (let gx = minX; gx <= maxX; gx++) {
            const cur = fgMask[rowOff + gx];
            if (cur === 1) {
              rowFg++;
              colHasFg[gx - minX] = 1;
              if (prev === 0) rowTransitions++;
            }
            prev = cur;
          }
          if (rowFg > 0) {
            activeRows++;
            totalRowTransitions += rowTransitions;
            if (rowTransitions > maxRowTransitions) maxRowTransitions = rowTransitions;
            if (rowTransitions >= 3) multiRows++;
          }
        }

        let colClusters = 0;
        let prevCol = 0;
        for (let i = 0; i < w; i++) {
          if (colHasFg[i] === 1 && prevCol === 0) colClusters++;
          prevCol = colHasFg[i];
        }

        const avgTransitionsPerRow = activeRows > 0 ? totalRowTransitions / activeRows : 0;
        const multiRowRatio = activeRows > 0 ? multiRows / activeRows : 0;
        const reqMaxT = roi.strictZone || tier === "brightOverlay" ? 6 : 5;
        const reqAvgT = roi.strictZone ? 3.4 : tier === "brightOverlay" ? 3.8 : 2.8;
        const reqMrr = roi.strictZone ? 0.70 : tier === "whiteCore" ? 0.44 : tier === "brightOverlay" ? 0.62 : 0.60;

        if (maxRowTransitions < reqMaxT || avgTransitionsPerRow < reqAvgT || multiRowRatio < reqMrr) continue;
        if (aspect > 1.7 && colClusters < 4) continue;

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

        const maxHalo = roi.strictZone || tier === "brightOverlay" ? 0.05 : tier === "medium" ? 0.04 : 0.08;
        if (haloTotal > 20 && haloFg / haloTotal > maxHalo) continue;

        // If a tight overlapping or horizontally adjacent same-baseline box exists (e.g. icon + wordmark), merge them
        const existingIdx = workBoxes.findIndex((b) => {
          const overlaps = !(maxX + 4 < b.minX || minX - 4 > b.maxX || maxY + 4 < b.minY || minY - 4 > b.maxY);
          if (overlaps) return true;
          const vertOverlap = Math.min(maxY, b.maxY) - Math.max(minY, b.minY);
          const sameLine = vertOverlap >= Math.min(h, b.maxY - b.minY + 1) * 0.5;
          const horizGap = Math.max(0, Math.max(minX - b.maxX, b.minX - maxX));
          return sameLine && horizGap <= 18;
        });

        if (existingIdx !== -1) {
          const b = workBoxes[existingIdx];
          const mergedMinX = Math.min(b.minX, minX);
          const mergedMinY = Math.min(b.minY, minY);
          const mergedMaxX = Math.max(b.maxX, maxX);
          const mergedMaxY = Math.max(b.maxY, maxY);
          if (mergedMaxX - mergedMinX + 1 <= maxLogoW && mergedMaxY - mergedMinY + 1 <= maxLogoH) {
            b.minX = mergedMinX;
            b.minY = mergedMinY;
            b.maxX = mergedMaxX;
            b.maxY = mergedMaxY;
          }
        } else {
          workBoxes.push({ minX, minY, maxX, maxY });
        }
      }
    }
  };

  for (const roi of rois) {
    scanRoiWithMask(roi, whiteCoreMask, "whiteCore");
    scanRoiWithMask(roi, ultraWhiteMask, "whiteCore");
    if (!roi.strictZone) {
      scanRoiWithMask(roi, brightOverlayMask, "brightOverlay");
    }
    scanRoiWithMask(roi, pureBrightMask, "crisp");
    scanRoiWithMask(roi, crispLightMask, "crisp");
    scanRoiWithMask(roi, crispDarkMask, "crisp");
    if (!roi.strictZone) {
      scanRoiWithMask(roi, medLightMask, "medium");
      scanRoiWithMask(roi, medDarkMask, "medium");
    }
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
 * strictly inside the detected small logo box (+3px tight margin).
 * Zero pixels outside that small region are modified.
 */
export function inpaintLogoBox(image: any, box: LogoBox): void {
  const width: number = image?.width ?? image?.bitmap?.width ?? 0;
  const height: number = image?.height ?? image?.bitmap?.height ?? 0;
  const data: Uint8Array | Buffer | undefined = image?.bitmap?.data;
  if (!data || width <= 0 || height <= 0) return;

  const pad = 3;
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
