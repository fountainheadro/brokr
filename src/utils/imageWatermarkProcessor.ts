import axios from "axios";
import { Jimp } from "jimp";
import { inpaintTelea } from "./teleaInpainting";
import path from "path";
import fs from "fs";

// 5x7 bitmap font glyphs for "brokr"
const FONT_GLYPHS: Record<string, number[][]> = {
  b: [
    [1,0,0,0],
    [1,0,0,0],
    [1,1,1,0],
    [1,0,0,1],
    [1,0,0,1],
    [1,0,0,1],
    [1,1,1,0]
  ],
  r: [
    [0,0,0,0],
    [0,0,0,0],
    [1,0,1,1],
    [1,1,0,0],
    [1,0,0,0],
    [1,0,0,0],
    [1,0,0,0]
  ],
  o: [
    [0,0,0,0],
    [0,0,0,0],
    [0,1,1,0],
    [1,0,0,1],
    [1,0,0,1],
    [1,0,0,1],
    [0,1,1,0]
  ],
  k: [
    [1,0,0,0],
    [1,0,0,0],
    [1,0,0,1],
    [1,0,1,0],
    [1,1,0,0],
    [1,0,1,0],
    [1,0,0,1]
  ]
};

/**
 * Stamps the agency watermark badge ("brokr") directly onto the image pixels
 * over the inpainted corner within the image's original dimensions.
 */
export function stampAgencyWatermark(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  cornerX: number,
  cornerY: number
): void {
  // Pill badge: 84px wide, 24px high
  const bw = 86;
  const bh = 24;
  const cr = 6;
  const startX = Math.max(12, Math.min(width - bw - 12, cornerX));
  const startY = Math.max(12, Math.min(height - bh - 12, cornerY));

  // 1. Draw rounded dark glass pill: rgba(5, 29, 53, 0.72)
  for (let dy = 0; dy < bh; dy++) {
    const y = startY + dy;
    if (y < 0 || y >= height) continue;
    for (let dx = 0; dx < bw; dx++) {
      const x = startX + dx;
      if (x < 0 || x >= width) continue;

      let inPill = true;
      if (dx < cr && dy < cr) {
        if ((cr - dx) ** 2 + (cr - dy) ** 2 > cr ** 2) inPill = false;
      } else if (dx >= bw - cr && dy < cr) {
        if ((dx - (bw - cr)) ** 2 + (cr - dy) ** 2 > cr ** 2) inPill = false;
      } else if (dx < cr && dy >= bh - cr) {
        if ((cr - dx) ** 2 + (dy - (bh - cr)) ** 2 > cr ** 2) inPill = false;
      } else if (dx >= bw - cr && dy >= bh - cr) {
        if ((dx - (bw - cr)) ** 2 + (dy - (bh - cr)) ** 2 > cr ** 2) inPill = false;
      }

      if (inPill) {
        const idx = (y * width + x) * 4;
        const a = 0.72;
        data[idx] = Math.round(data[idx] * (1 - a) + 5 * a);
        data[idx + 1] = Math.round(data[idx + 1] * (1 - a) + 29 * a);
        data[idx + 2] = Math.round(data[idx + 2] * (1 - a) + 53 * a);
      }
    }
  }

  // 2. Draw gold dot: radius 2 at (startX + 13, startY + 12)
  const dotCenterX = startX + 13;
  const dotCenterY = startY + 12;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (dx * dx + dy * dy <= 5) {
        const py = dotCenterY + dy;
        const px = dotCenterX + dx;
        if (py >= 0 && py < height && px >= 0 && px < width) {
          const idx = (py * width + px) * 4;
          data[idx] = 190;     // #BE9662 R
          data[idx + 1] = 150; // #BE9662 G
          data[idx + 2] = 98;  // #BE9662 B
        }
      }
    }
  }

  // 3. Draw text "brokr" in white starting at (startX + 24, startY + 8)
  const word = ["b", "r", "o", "k", "r"];
  let curX = startX + 24;
  const curY = startY + 8;
  const scale = 1.3;

  for (const ch of word) {
    const glyph = FONT_GLYPHS[ch];
    if (!glyph) continue;
    for (let r = 0; r < glyph.length; r++) {
      for (let c = 0; c < glyph[r].length; c++) {
        if (glyph[r][c] === 1) {
          const px = Math.round(curX + c * scale);
          const py = Math.round(curY + r * scale);
          if (px >= 0 && px < width && py >= 0 && py < height) {
            const idx = (py * width + px) * 4;
            data[idx] = 255;
            data[idx + 1] = 255;
            data[idx + 2] = 255;
          }
        }
      }
    }
    curX += Math.round(glyph[0].length * scale) + 4;
  }
}

/**
 * Downloads a property image, meticulously inpaints competitor watermarks,
 * blends matching photographic grain, applies the agency watermark badge over the inpainting area,
 * and saves it locally in uploadsDir.
 */
export async function processAndInpaintImportedImage(
  imageUrl: string,
  uploadsDir: string,
  index: number
): Promise<string> {
  // If already a local upload, no need to re-inpaint
  if (imageUrl.startsWith("/uploads/")) {
    return imageUrl;
  }

  try {
    const response = await axios.get(imageUrl, {
      responseType: "arraybuffer",
      headers: {
        "Accept": "image/jpeg,image/png,image/*;q=0.8",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36"
      },
      timeout: 15000,
      validateStatus: (status) => status < 400
    });

    const image = await Jimp.read(response.data);
    const { width, height } = image;

    if (width < 250 || height < 200) {
      // Tiny image, save as is
      const fileName = `prop_${Date.now()}_${index}.jpg`;
      const targetPath = path.join(uploadsDir, fileName);
      const buf = await image.getBuffer("image/jpeg");
      await fs.promises.writeFile(targetPath, buf);
      return `/uploads/${fileName}`;
    }

    const lower = imageUrl.toLowerCase();
    const isStoriaOlx = lower.includes("apollo.olxcdn.com") || lower.includes("storia.ro") || lower.includes("olx.ro");

    // 1. Define watermark zones based on portal geometry
    // For Storia/OLX: watermark is in bottom-left corner
    const bLeftXmin = 0;
    const bLeftXmax = Math.floor(width * 0.22);
    const bLeftYmin = Math.floor(height * 0.88);
    const bLeftYmax = height - 1;

    // For agency stamps or other portals: bottom-right
    const bRightXmin = Math.floor(width * 0.76);
    const bRightXmax = width - 1;
    const bRightYmin = Math.floor(height * 0.88);
    const bRightYmax = height - 1;

    const mask = new Uint8Array(width * height);
    let hasMask = false;

    // Inpaint bottom-left for Storia/OLX
    if (isStoriaOlx) {
      for (let y = bLeftYmin; y <= bLeftYmax; y++) {
        const row = y * width;
        for (let x = bLeftXmin; x <= bLeftXmax; x++) {
          mask[row + x] = 1;
          hasMask = true;
        }
      }
    } else {
      // For general portals, cover bottom-right
      for (let y = bRightYmin; y <= bRightYmax; y++) {
        const row = y * width;
        for (let x = bRightXmin; x <= bRightXmax; x++) {
          mask[row + x] = 1;
          hasMask = true;
        }
      }
    }

    // 2. Perform Alexandru Telea Fast Marching inpainting
    if (hasMask) {
      inpaintTelea(image.bitmap.data, mask, width, height, { radius: 3 });

      // 3. Meticulous texture synthesis: blend subtle matching sensor noise
      // into the inpainted area so there is no plastic/flat artifact
      const noiseRange = 2.0;
      for (let y = 0; y < height; y++) {
        const row = y * width;
        for (let x = 0; x < width; x++) {
          if (mask[row + x] === 1) {
            const idx = (row + x) * 4;
            const noise = (Math.random() - 0.5) * noiseRange;
            image.bitmap.data[idx] = Math.max(0, Math.min(255, Math.round(image.bitmap.data[idx] + noise)));
            image.bitmap.data[idx + 1] = Math.max(0, Math.min(255, Math.round(image.bitmap.data[idx + 1] + noise)));
            image.bitmap.data[idx + 2] = Math.max(0, Math.min(255, Math.round(image.bitmap.data[idx + 2] + noise)));
          }
        }
      }

      // 4. Stamp the agency watermark ("brokr") directly over the inpainting area
      // inside the image's original dimensions
      if (isStoriaOlx) {
        stampAgencyWatermark(image.bitmap.data, width, height, 16, height - 38);
      } else {
        stampAgencyWatermark(image.bitmap.data, width, height, width - 100, height - 38);
      }
    }

    // 5. Save the clean image to permanent local file
    const fileName = `prop_${Date.now()}_${index}.jpg`;
    const targetPath = path.join(uploadsDir, fileName);
    const cleanedBuf = await image.getBuffer("image/jpeg");
    await fs.promises.writeFile(targetPath, cleanedBuf);

    return `/uploads/${fileName}`;
  } catch (err: any) {
    console.warn(`[Import Inpainter] Fallback on ${imageUrl.substring(0, 80)}:`, err?.message || err);
    return imageUrl;
  }
}

/**
 * Batch processes an array of image URLs sequentially or in controlled concurrency (4 at a time)
 * to inpaint watermarks and save permanent local images at import time.
 */
export async function processAllImportedImages(
  urls: string[],
  uploadsDir: string
): Promise<string[]> {
  const results: string[] = new Array(urls.length);
  const CHUNK_SIZE = 4;

  for (let i = 0; i < urls.length; i += CHUNK_SIZE) {
    const chunk = urls.slice(i, i + CHUNK_SIZE);
    await Promise.all(
      chunk.map(async (url, idx) => {
        const globalIdx = i + idx;
        const res = await processAndInpaintImportedImage(url, uploadsDir, globalIdx);
        results[globalIdx] = res;
      })
    );
  }

  return results;
}
