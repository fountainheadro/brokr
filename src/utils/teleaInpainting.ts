/**
 * Alexandru Telea's Fast Marching Image Inpainting Algorithm
 * Reference: A. Telea, "An Image Inpainting Technique Based on the Fast Marching Method", 
 * Journal of Graphics Tools, 9(1):23-34, 2004.
 * 
 * Pure mathematical implementation for inpainting logos, watermarks, and overlay artifacts
 * without any external AI models or remote API spend.
 */

// States for Fast Marching Method (FMM)
const STATE_KNOWN = 0;
const STATE_BAND = 1;
const STATE_INSIDE = 2;

class MinHeap {
  private heap: number[] = [];
  private readonly dist: Float32Array;

  constructor(dist: Float32Array) {
    this.dist = dist;
  }

  get size(): number {
    return this.heap.length;
  }

  push(idx: number): void {
    this.heap.push(idx);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): number | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const bottom = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = bottom;
      this.sinkDown(0);
    }
    return top;
  }

  private bubbleUp(pos: number): void {
    while (pos > 0) {
      const parent = (pos - 1) >> 1;
      if (this.dist[this.heap[pos]] < this.dist[this.heap[parent]]) {
        const tmp = this.heap[pos];
        this.heap[pos] = this.heap[parent];
        this.heap[parent] = tmp;
        pos = parent;
      } else {
        break;
      }
    }
  }

  private sinkDown(pos: number): void {
    const len = this.heap.length;
    while (true) {
      let minIdx = pos;
      const left = (pos << 1) + 1;
      const right = left + 1;

      if (left < len && this.dist[this.heap[left]] < this.dist[this.heap[minIdx]]) {
        minIdx = left;
      }
      if (right < len && this.dist[this.heap[right]] < this.dist[this.heap[minIdx]]) {
        minIdx = right;
      }
      if (minIdx !== pos) {
        const tmp = this.heap[pos];
        this.heap[pos] = this.heap[minIdx];
        this.heap[minIdx] = tmp;
        pos = minIdx;
      } else {
        break;
      }
    }
  }
}

/**
 * Solves the 2D Eikonal equation: |grad T| = 1
 */
function solveEikonal(tx: number, ty: number): number {
  if (isFinite(tx) && isFinite(ty)) {
    if (Math.abs(tx - ty) >= 1) {
      return Math.min(tx, ty) + 1;
    }
    return (tx + ty + Math.sqrt(2 - (tx - ty) * (tx - ty))) / 2;
  }
  if (isFinite(tx)) return tx + 1;
  if (isFinite(ty)) return ty + 1;
  return Infinity;
}

export interface InpaintOptions {
  radius?: number; // Inpainting radius (typically 3 to 6 pixels)
}

/**
 * Inpaints the masked regions of an RGBA image buffer using Alexandru Telea's algorithm.
 * @param data RGBA pixel buffer (Uint8ClampedArray or Uint8Array)
 * @param mask 1 byte per pixel: 1 = inpaint, 0 = keep
 * @param width Image width
 * @param height Image height
 * @param options Configuration options
 */
export function inpaintTelea(
  data: Uint8ClampedArray | Uint8Array,
  mask: Uint8Array,
  width: number,
  height: number,
  options: InpaintOptions = {}
): void {
  const radius = Math.max(2, Math.min(8, options.radius || 4));
  const totalPixels = width * height;

  const state = new Uint8Array(totalPixels);
  const dist = new Float32Array(totalPixels);
  const heap = new MinHeap(dist);

  // Initialize states
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const idx = rowOffset + x;
      if (mask[idx] === 1) {
        state[idx] = STATE_INSIDE;
        dist[idx] = Infinity;
      } else {
        state[idx] = STATE_KNOWN;
        dist[idx] = 0;
      }
    }
  }

  // Find initial narrow band (boundary pixels)
  const dx = [-1, 1, 0, 0];
  const dy = [0, 0, -1, 1];

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const idx = rowOffset + x;
      if (state[idx] === STATE_INSIDE) {
        let isBoundary = false;
        for (let i = 0; i < 4; i++) {
          const nx = x + dx[i];
          const ny = y + dy[i];
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const nIdx = ny * width + nx;
            if (state[nIdx] === STATE_KNOWN) {
              isBoundary = true;
              break;
            }
          }
        }
        if (isBoundary) {
          state[idx] = STATE_BAND;
          dist[idx] = 1.0;
          heap.push(idx);
        }
      }
    }
  }

  // Fast Marching propagation loop
  while (heap.size > 0) {
    const pIdx = heap.pop()!;
    if (state[pIdx] === STATE_KNOWN) continue; // Already processed
    state[pIdx] = STATE_KNOWN;

    const px = pIdx % width;
    const py = Math.floor(pIdx / width);

    // Compute distance gradient normal at p: N = grad(T)
    let gx = 0;
    let gy = 0;
    if (px > 0 && px < width - 1) {
      const dLeft = dist[pIdx - 1];
      const dRight = dist[pIdx + 1];
      if (isFinite(dLeft) && isFinite(dRight)) {
        gx = (dRight - dLeft) * 0.5;
      }
    }
    if (py > 0 && py < height - 1) {
      const dUp = dist[pIdx - width];
      const dDown = dist[pIdx + width];
      if (isFinite(dUp) && isFinite(dDown)) {
        gy = (dDown - dUp) * 0.5;
      }
    }
    const gradNorm = Math.sqrt(gx * gx + gy * gy);

    // Inpaint color at p using known neighbors in radius
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let sumWeight = 0;

    const rMin = Math.max(0, py - radius);
    const rMax = Math.min(height - 1, py + radius);
    const cMin = Math.max(0, px - radius);
    const cMax = Math.min(width - 1, px + radius);

    for (let qy = rMin; qy <= rMax; qy++) {
      const qRowOffset = qy * width;
      for (let qx = cMin; qx <= cMax; qx++) {
        const qIdx = qRowOffset + qx;
        if (state[qIdx] === STATE_KNOWN && qIdx !== pIdx) {
          const deltaX = px - qx;
          const deltaY = py - qy;
          const distSq = deltaX * deltaX + deltaY * deltaY;
          if (distSq > radius * radius || distSq === 0) continue;

          const geomDist = Math.sqrt(distSq);
          // Directional factor (aligning with boundary gradient)
          let dirFactor = 1.0;
          if (gradNorm > 0.0001) {
            const cosAngle = (deltaX * gx + deltaY * gy) / (geomDist * gradNorm);
            dirFactor = Math.max(0.05, Math.abs(cosAngle));
          }

          // Level set difference
          const levFactor = 1.0 / (1.0 + Math.abs(dist[pIdx] - dist[qIdx]));
          // Geometric distance weight
          const dstFactor = 1.0 / distSq;

          const weight = dirFactor * levFactor * dstFactor;
          const qColorOffset = qIdx * 4;

          sumR += data[qColorOffset] * weight;
          sumG += data[qColorOffset + 1] * weight;
          sumB += data[qColorOffset + 2] * weight;
          sumWeight += weight;
        }
      }
    }

    if (sumWeight > 0) {
      const pColorOffset = pIdx * 4;
      data[pColorOffset] = Math.round(sumR / sumWeight);
      data[pColorOffset + 1] = Math.round(sumG / sumWeight);
      data[pColorOffset + 2] = Math.round(sumB / sumWeight);
    }

    // Update 4-connected neighbors of p
    for (let i = 0; i < 4; i++) {
      const nx = px + dx[i];
      const ny = py + dy[i];
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nIdx = ny * width + nx;
        if (state[nIdx] === STATE_INSIDE) {
          // Calculate distance for neighbor using Eikonal formula
          const tLeft = nx > 0 && state[nIdx - 1] === STATE_KNOWN ? dist[nIdx - 1] : Infinity;
          const tRight = nx < width - 1 && state[nIdx + 1] === STATE_KNOWN ? dist[nIdx + 1] : Infinity;
          const tUp = ny > 0 && state[nIdx - width] === STATE_KNOWN ? dist[nIdx - width] : Infinity;
          const tDown = ny < height - 1 && state[nIdx + width] === STATE_KNOWN ? dist[nIdx + width] : Infinity;

          const minTx = Math.min(tLeft, tRight);
          const minTy = Math.min(tUp, tDown);

          const newDist = solveEikonal(minTx, minTy);
          if (newDist < dist[nIdx]) {
            dist[nIdx] = newDist;
          }
          state[nIdx] = STATE_BAND;
          heap.push(nIdx);
        }
      }
    }
  }
}
