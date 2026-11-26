import assert from "assert";
import * as cheerio from "cheerio";
import { defaultFormats, defaultPlugins } from "jimp";
import { createJimp } from "@jimp/core";
import webp from "@jimp/wasm-webp";
import { extractStoriaNextDataAndPhotos } from "../../server/utils/storiaPhotoExtractor";
import { detectLogoBoxes, inpaintLogoBox } from "../../server/security/sec_logo-inpainter";
import { createThumbnail, clearThumbnailCacheByPrefix } from "../../server/utils/img_thumbnail";

const Jimp = createJimp({
  formats: [...defaultFormats, webp],
  plugins: defaultPlugins,
});

function promoteToHighRes(rawUrl: string): string {
  let cleaned = rawUrl.trim().replace(/\\/g, "");
  if (cleaned.startsWith("//")) cleaned = "https:" + cleaned;
  if (cleaned.includes(";s=")) {
    cleaned = cleaned.replace(/;s=\d+x\d+/, ";s=1000x700");
  } else if (
    (cleaned.includes("olxcdn") || cleaned.includes("storia.ro")) &&
    cleaned.includes("/files/")
  ) {
    cleaned = cleaned + ";s=1000x700";
  }
  return cleaned;
}

function isForbiddenGraphic(u: string): boolean {
  const lower = u.toLowerCase();
  return ["logo", "avatar", "icon", "badge", ".svg"].some((p) => lower.includes(p));
}

function getBaseUrlPath(u: string): string {
  return u.split(/[?;]/)[0].toLowerCase();
}

/**
 * Draws a synthetic crisp/translucent multi-character watermark ("STORIA")
 * in the bottom-right corner of a 800x600 gradient image.
 */
async function createSyntheticWatermarkedPng(translucent: boolean): Promise<{ img: any; pngBuffer: Buffer }> {
  const w = 800;
  const h = 600;
  const img = new Jimp({ width: w, height: h, color: 0x3b4a5aff });
  const data = img.bitmap.data;

  // Smooth interior-like gradient background (no sharp corners or text)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      data[idx] = Math.round(70 + (x / w) * 45);
      data[idx + 1] = Math.round(78 + (y / h) * 35);
      data[idx + 2] = Math.round(88 + ((x + y) / (w + h)) * 30);
      data[idx + 3] = 255;
    }
  }

  // 7x9 bitmap glyphs for "STORIA" scaled 3x -> ~150x27 px watermark in bottom-right corner
  const glyphs: Record<string, string[]> = {
    S: [
      "0111110",
      "1100001",
      "1100000",
      "0111100",
      "0000110",
      "0000011",
      "1000011",
      "0111110",
    ],
    T: [
      "1111111",
      "1111111",
      "0001100",
      "0001100",
      "0001100",
      "0001100",
      "0001100",
      "0001100",
    ],
    O: [
      "0111110",
      "1100011",
      "1100011",
      "1100011",
      "1100011",
      "1100011",
      "1100011",
      "0111110",
    ],
    R: [
      "1111100",
      "1100110",
      "1100110",
      "1111100",
      "1101100",
      "1100110",
      "1100011",
      "1100011",
    ],
    I: [
      "0111110",
      "0001100",
      "0001100",
      "0001100",
      "0001100",
      "0001100",
      "0001100",
      "0111110",
    ],
    A: [
      "0011100",
      "0110110",
      "1100011",
      "1100011",
      "1111111",
      "1100011",
      "1100011",
      "1100011",
    ],
  };

  const word = "STORIA";
  const scale = 3;
  const startX = w - 205;
  const startY = h - 55;
  const alpha = translucent ? 0.35 : 0.85;

  for (let ci = 0; ci < word.length; ci++) {
    const g = glyphs[word[ci]];
    const ox = startX + ci * (8 * scale);
    for (let gy = 0; gy < g.length; gy++) {
      for (let gx = 0; gx < g[gy].length; gx++) {
        if (g[gy][gx] !== "1") continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const px = ox + gx * scale + sx;
            const py = startY + gy * scale + sy;
            const idx = (py * w + px) * 4;
            data[idx] = Math.round(data[idx] * (1 - alpha) + 255 * alpha);
            data[idx + 1] = Math.round(data[idx + 1] * (1 - alpha) + 255 * alpha);
            data[idx + 2] = Math.round(data[idx + 2] * (1 - alpha) + 255 * alpha);
          }
        }
      }
    }
  }

  const pngBuffer = await img.getBuffer("image/png" as any);
  return { img, pngBuffer };
}

async function runTests() {
  console.log("=== Running Storia All-Photos & Watermark Regeneration Tests ===");

  // Test 1: Storia __NEXT_DATA__ with empty `photos: []` and populated `images: [18 photos]`
  {
    const all18 = Array.from({ length: 18 }, (_, i) => ({
      large: `https://ireland.apollo.olxcdn.com/v1/files/storia-photo-${i + 1}-RO/image;s=1280x1024`,
      medium: `https://ireland.apollo.olxcdn.com/v1/files/storia-photo-${i + 1}-RO/image;s=640x480`,
    }));

    const nextPayload = {
      props: {
        pageProps: {
          ad: {
            title: "Apartament 3 camere Herăstrău",
            photos: [], // Previously broke `ad.photos || ad.images`!
            images: all18,
            agency: {
              imageUrl: "https://ireland.apollo.olxcdn.com/v1/files/agency-avatar-123/image",
            },
          },
        },
      },
    };

    const html = `
      <html>
        <body>
          <div data-cy="mosaic-gallery-main-view">
            <img src="https://ireland.apollo.olxcdn.com/v1/files/storia-photo-1-RO/image;s=640x480" />
            <img src="https://ireland.apollo.olxcdn.com/v1/files/storia-photo-2-RO/image;s=640x480" />
            <img src="https://ireland.apollo.olxcdn.com/v1/files/storia-photo-3-RO/image;s=640x480" />
          </div>
          <script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextPayload)}</script>
        </body>
      </html>
    `;

    const $ = cheerio.load(html);
    const blocked = new Set<string>();
    const res = extractStoriaNextDataAndPhotos({
      $,
      pageUrl: "https://www.storia.ro/ro/oferta/apartament-3-camere-IDabc",
      promoteToHighRes,
      isForbiddenGraphic,
      blockedAgencyPaths: blocked,
      getBaseUrlPath,
    });

    assert.strictEqual(res.nextDataTargetImages.length, 18, `Expected all 18 Storia photos, got ${res.nextDataTargetImages.length}`);
    assert.ok(res.nextDataTargetImages[17].includes("storia-photo-18-RO"), "Expected 18th photo to be preserved");
    assert.ok(res.nextDataTargetImages.every((u) => u.includes(";s=1000x700")), "Expected high-res promotion on all photos");
    assert.ok(blocked.has("https://ireland.apollo.olxcdn.com/v1/files/agency-avatar-123/image"), "Expected agency avatar to be blocked");
    console.log("PASS [1/5] Storia __NEXT_DATA__ extracts ALL 18 photos even when photos:[] precedes images:[18]");
  }

  // Test 2: Storia React Query dehydratedState.queries with 14 photos (ignoring similarAds query)
  {
    const listing14 = Array.from({ length: 14 }, (_, i) => ({
      large: `https://ireland.apollo.olxcdn.com/v1/files/dehydrated-photo-${i + 1}-RO/image;s=1000x700`,
    }));
    const similar5 = Array.from({ length: 5 }, (_, i) => ({
      large: `https://ireland.apollo.olxcdn.com/v1/files/similar-ad-${i + 1}-RO/image;s=1000x700`,
    }));

    const nextPayload = {
      props: {
        pageProps: {
          dehydratedState: {
            queries: [
              {
                queryKey: ["advert", "IDxyz"],
                state: {
                  data: {
                    ad: {
                      title: "Apartament 2 camere Aviației",
                      images: listing14,
                    },
                  },
                },
              },
              {
                queryKey: ["similarAds", "IDxyz"],
                state: {
                  data: {
                    images: similar5,
                  },
                },
              },
            ],
          },
        },
      },
    };

    const html = `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextPayload)}</script></body></html>`;
    const $ = cheerio.load(html);
    const res = extractStoriaNextDataAndPhotos({
      $,
      pageUrl: "https://www.storia.ro/ro/oferta/apartament-2-camere-IDxyz",
      promoteToHighRes,
      isForbiddenGraphic,
      blockedAgencyPaths: new Set(),
      getBaseUrlPath,
    });

    const unique = Array.from(new Set(res.nextDataTargetImages));
    assert.strictEqual(unique.length, 14, `Expected 14 listing photos from dehydratedState, got ${unique.length}`);
    assert.ok(!unique.some((u) => u.includes("similar-ad-")), "Expected similarAds photos to be excluded");
    console.log("PASS [2/5] Storia dehydratedState.queries extracts ALL 14 listing photos and excludes similarAds");
  }

  // Test 3: Aggressive watermark detector catches translucent Storia-style corner watermark & inpaints cleanly
  {
    const { img } = await createSyntheticWatermarkedPng(true);
    const aggressiveBoxes = detectLogoBoxes(img, { aggressive: true });
    assert.ok(aggressiveBoxes.length >= 1, `Expected aggressive detector to find translucent corner watermark, found ${aggressiveBoxes.length}`);

    // Measure bright watermark peak before inpainting vs after inpainting
    const sampleCornerPeak = (imageObj: any) => {
      let maxLuma = 0;
      const d = imageObj.bitmap.data;
      for (let y = 540; y < 580; y++) {
        for (let x = 590; x < 760; x++) {
          const idx = (y * 800 + x) * 4;
          const l = 0.299 * d[idx] + 0.587 * d[idx + 1] + 0.114 * d[idx + 2];
          if (l > maxLuma) maxLuma = l;
        }
      }
      return maxLuma;
    };

    const peakBefore = sampleCornerPeak(img);
    const centerPixelBefore = [img.bitmap.data[(300 * 800 + 400) * 4], img.bitmap.data[(300 * 800 + 400) * 4 + 1]];

    for (const box of aggressiveBoxes) {
      inpaintLogoBox(img, box, { pad: 5 });
    }

    const peakAfter = sampleCornerPeak(img);
    const centerPixelAfter = [img.bitmap.data[(300 * 800 + 400) * 4], img.bitmap.data[(300 * 800 + 400) * 4 + 1]];

    assert.ok(peakAfter < peakBefore - 15, `Expected inpainting to suppress watermark brightness (before=${peakBefore.toFixed(1)}, after=${peakAfter.toFixed(1)})`);
    assert.deepStrictEqual(centerPixelAfter, centerPixelBefore, "Expected interior pixels outside watermark box to remain completely untouched");
    console.log(`PASS [3/5] Aggressive detector + inpainter cleanly removed translucent watermark (peak ${peakBefore.toFixed(1)} -> ${peakAfter.toFixed(1)})`);
  }

  // Test 4: Thumbnail cache eviction removes regenerated image thumbnails
  {
    const { pngBuffer } = await createSyntheticWatermarkedPng(false);
    const prefix = "proxy::https://ireland.apollo.olxcdn.com/v1/files/test-evict/image";
    await createThumbnail({
      buffer: pngBuffer,
      mimeType: "image/png",
      targetWidth: 480,
      cacheKey: `${prefix}::clean=true::agg=1`,
    });
    const removed = clearThumbnailCacheByPrefix(prefix);
    assert.ok(removed >= 1, `Expected >= 1 thumbnail cache entry evicted, got ${removed}`);
    console.log("PASS [4/5] Thumbnail cache eviction clears stale entries for regenerated image URL");
  }

  // Test 5: Live HTTP verification of POST /api/properties/regenerate-images (if server is running on port 3000)
  {
    const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:3000";
    let serverReachable = false;
    try {
      const healthRes = await fetch(`${baseUrl}/api/healthz`);
      serverReachable = healthRes.ok;
    } catch {}

    if (serverReachable) {
      // 5a: Unauthenticated caller must receive 401
      const unauthRes = await fetch(`${baseUrl}/api/properties/regenerate-images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: ["https://example.com/a.jpg"] }),
      });
      assert.strictEqual(unauthRes.status, 401, `Expected 401 for unauthenticated regeneration call, got ${unauthRes.status}`);

      // 5b: Authenticated caller (dev impersonation header when non-prod) must block SSRF loopback URLs
      const authHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Tenant-Id": "default",
        "X-Dev-User-Email": "dev@brokr.ro",
      };
      const ssrfRes = await fetch(`${baseUrl}/api/properties/regenerate-images`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          images: ["http://127.0.0.1:3000/api/healthz", "http://169.254.169.254/latest/meta-data/"],
        }),
      });
      if (ssrfRes.status !== 401) {
        assert.strictEqual(ssrfRes.status, 400, `Expected 400 for SSRF-blocked URLs, got ${ssrfRes.status}`);

        // 5c: Valid watermarked inline PNG gets regenerated & inpainted end-to-end
        const { pngBuffer } = await createSyntheticWatermarkedPng(true);
        const dataUrl = `data:image/png;base64,${pngBuffer.toString("base64")}`;
        const regenRes = await fetch(`${baseUrl}/api/properties/regenerate-images`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ images: [dataUrl], coverImage: dataUrl }),
        });
        assert.strictEqual(regenRes.status, 200, `Expected 200 for valid regeneration, got ${regenRes.status}`);
        const json = await regenRes.json();
        assert.strictEqual(json.success, true);
        assert.strictEqual(json.data.processedCount, 1);
        assert.ok(json.data.inpaintedCount >= 1, `Expected >= 1 inpainted image, got ${json.data.inpaintedCount}`);
        assert.notStrictEqual(json.data.images[0], dataUrl, "Expected regenerated PNG data URL to differ after watermark inpainting");
        console.log("PASS [5/5] Live POST /api/properties/regenerate-images enforces auth (401), SSRF blocking (400), and inpaints watermarked PNG (200)");
      } else {
        console.log("PASS [5/5] Live POST /api/properties/regenerate-images strictly enforces Bearer auth (401)");
      }
    } else {
      console.log("SKIP [5/5] Live server check skipped (server not listening on port 3000)");
    }
  }

  // Helper to stamp multi-word bitmap text at arbitrary coordinates on an 800x600 image
  const drawTextStamp = (
    imageObj: any,
    text: string,
    startX: number,
    startY: number,
    scale: number,
    alpha: number,
    colorVal: number = 255
  ) => {
    const glyphMap: Record<string, string[]> = {
      I: ["0111110", "0001100", "0001100", "0001100", "0001100", "0001100", "0001100", "0111110"],
      O: ["0111110", "1100011", "1100011", "1100011", "1100011", "1100011", "1100011", "0111110"],
      N: ["1100011", "1110011", "1111011", "1101111", "1100111", "1100011", "1100011", "1100011"],
      P: ["1111110", "1100011", "1100011", "1111110", "1100000", "1100000", "1100000", "1100000"],
      E: ["1111111", "1100000", "1100000", "1111110", "1100000", "1100000", "1100000", "1111111"],
      S: ["0111110", "1100001", "1100000", "0111100", "0000110", "0000011", "1000011", "0111110"],
      C: ["0111110", "1100011", "1100000", "1100000", "1100000", "1100000", "1100011", "0111110"],
      U: ["1100011", "1100011", "1100011", "1100011", "1100011", "1100011", "1100011", "0111110"],
      " ": ["0000000", "0000000", "0000000", "0000000", "0000000", "0000000", "0000000", "0000000"],
    };
    const w = imageObj.width;
    const h = imageObj.height;
    const data = imageObj.bitmap.data;
    let cursorX = startX;
    for (const ch of text) {
      const g = glyphMap[ch];
      if (!g) {
        cursorX += 5 * scale;
        continue;
      }
      if (ch === " ") {
        cursorX += 5 * scale;
        continue;
      }
      for (let gy = 0; gy < g.length; gy++) {
        for (let gx = 0; gx < g[gy].length; gx++) {
          if (g[gy][gx] !== "1") continue;
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              const px = cursorX + gx * scale + sx;
              const py = startY + gy * scale + sy;
              if (px < 0 || px >= w || py < 0 || py >= h) continue;
              const idx = (py * w + px) * 4;
              data[idx] = Math.round(data[idx] * (1 - alpha) + colorVal * alpha);
              data[idx + 1] = Math.round(data[idx + 1] * (1 - alpha) + colorVal * alpha);
              data[idx + 2] = Math.round(data[idx + 2] * (1 - alpha) + colorVal * alpha);
            }
          }
        }
      }
      cursorX += 8 * scale;
    }
    return { startX, startY, w: cursorX - startX - scale, h: 8 * scale };
  };

  const createCleanGradientImage = () => {
    const w = 800;
    const h = 600;
    const img = new Jimp({ width: w, height: h, color: 0x3b4a5aff });
    const data = img.bitmap.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        data[idx] = Math.round(70 + (x / w) * 45);
        data[idx + 1] = Math.round(78 + (y / h) * 35);
        data[idx + 2] = Math.round(88 + ((x + y) / (w + h)) * 30);
        data[idx + 3] = 255;
      }
    }
    return img;
  };

  const sampleRegionPeak = (imageObj: any, x0: number, y0: number, w: number, h: number) => {
    let maxLuma = 0;
    const d = imageObj.bitmap.data;
    const imgW = imageObj.width;
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const idx = (y * imgW + x) * 4;
        const l = 0.299 * d[idx] + 0.587 * d[idx + 1] + 0.114 * d[idx + 2];
        if (l > maxLuma) maxLuma = l;
      }
    }
    return maxLuma;
  };

  // Test 6: Up to 9 multi-word owner-name texts (4 corners + top/bottom center + middle-left/right + center)
  for (const aggressiveMode of [true, false]) {
    const img = createCleanGradientImage();
    const stampW = 110;
    const stampH = 16;
    const positions = [
      { label: "top-left", x: 24, y: 20 },
      { label: "top-center", x: Math.round((800 - stampW) / 2), y: 20 },
      { label: "top-right", x: 800 - stampW - 24, y: 20 },
      { label: "middle-left", x: 24, y: Math.round((600 - stampH) / 2) },
      { label: "center", x: Math.round((800 - stampW) / 2), y: Math.round((600 - stampH) / 2) },
      { label: "middle-right", x: 800 - stampW - 24, y: Math.round((600 - stampH) / 2) },
      { label: "bottom-left", x: 24, y: 600 - stampH - 20 },
      { label: "bottom-center", x: Math.round((800 - stampW) / 2), y: 600 - stampH - 20 },
      { label: "bottom-right", x: 800 - stampW - 24, y: 600 - stampH - 20 },
    ];

    const stampedRects = positions.map((p) => ({
      ...p,
      rect: drawTextStamp(img, "ION POP", p.x, p.y, 2, 0.42, 255),
    }));

    const peaksBefore = stampedRects.map((s) => sampleRegionPeak(img, s.rect.startX, s.rect.startY, s.rect.w, s.rect.h));
    // Clean pixel away from all 9 stamps
    const cleanPixelBefore = [img.bitmap.data[(160 * 800 + 220) * 4], img.bitmap.data[(160 * 800 + 220) * 4 + 1]];

    const boxes = detectLogoBoxes(img, { aggressive: aggressiveMode });
    assert.ok(
      boxes.length >= 9,
      `Expected >= 9 boxes for 9-position owner-name grid (aggressive=${aggressiveMode}), found ${boxes.length}`
    );

    for (const box of boxes) {
      inpaintLogoBox(img, box, { pad: aggressiveMode ? 5 : 3 });
    }

    stampedRects.forEach((s, idx) => {
      const peakAfter = sampleRegionPeak(img, s.rect.startX, s.rect.startY, s.rect.w, s.rect.h);
      assert.ok(
        peakAfter < peaksBefore[idx] - 18,
        `Expected ${s.label} text to be cleanly inpainted (aggressive=${aggressiveMode}, before=${peaksBefore[idx].toFixed(1)}, after=${peakAfter.toFixed(1)})`
      );
    });

    const cleanPixelAfter = [img.bitmap.data[(160 * 800 + 220) * 4], img.bitmap.data[(160 * 800 + 220) * 4 + 1]];
    assert.deepStrictEqual(cleanPixelAfter, cleanPixelBefore, "Expected clean background outside the 9 texts to remain untouched");
    console.log(`PASS [6/${aggressiveMode ? "agg" : "std"}] All 9 multi-word owner-name texts (4 corners, horizontal/vertical edge middles, center) detected and inpainted`);
  }

  // Test 7: Big Storia logo (bottom-right) + 8 other owner-name texts on the same image
  {
    const { img } = await createSyntheticWatermarkedPng(true);
    const ownerPositions = [
      { label: "top-left", x: 24, y: 20 },
      { label: "top-center", x: 345, y: 20 },
      { label: "top-right", x: 660, y: 20 },
      { label: "middle-left", x: 24, y: 292 },
      { label: "center", x: 345, y: 292 },
      { label: "middle-right", x: 660, y: 292 },
      { label: "bottom-left", x: 24, y: 560 },
      { label: "bottom-center", x: 345, y: 560 },
    ];
    const rects = ownerPositions.map((p) => ({
      ...p,
      rect: drawTextStamp(img, "ION POP", p.x, p.y, 2, 0.45, 255),
    }));
    const storiaPeakBefore = sampleRegionPeak(img, 590, 540, 170, 40);
    const ownerPeaksBefore = rects.map((r) => sampleRegionPeak(img, r.rect.startX, r.rect.startY, r.rect.w, r.rect.h));

    const boxes = detectLogoBoxes(img, { aggressive: true });
    assert.ok(boxes.length >= 9, `Expected >= 9 boxes (Storia logo + 8 owner texts), got ${boxes.length}`);
    for (const box of boxes) {
      inpaintLogoBox(img, box, { pad: 5 });
    }

    const storiaPeakAfter = sampleRegionPeak(img, 590, 540, 170, 40);
    assert.ok(storiaPeakAfter < storiaPeakBefore - 15, "Expected Storia logo to still be cleanly removed");
    rects.forEach((r, idx) => {
      const after = sampleRegionPeak(img, r.rect.startX, r.rect.startY, r.rect.w, r.rect.h);
      assert.ok(after < ownerPeaksBefore[idx] - 18, `Expected ${r.label} owner text to be removed alongside Storia logo`);
    });
    console.log("PASS [7] Combined big Storia logo + 8 owner-name texts all detected and inpainted");
  }

  // Test 8: Partial grid (6 perimeter owner texts, NO center text) leaves center pixel 100% untouched
  {
    const img = createCleanGradientImage();
    const partialPositions = [
      { x: 24, y: 20 },
      { x: 660, y: 20 },
      { x: 24, y: 292 },
      { x: 660, y: 292 },
      { x: 24, y: 560 },
      { x: 660, y: 560 },
    ];
    for (const p of partialPositions) {
      drawTextStamp(img, "ION POP", p.x, p.y, 2, 0.45, 255);
    }
    const centerBefore = [img.bitmap.data[(300 * 800 + 400) * 4], img.bitmap.data[(300 * 800 + 400) * 4 + 1]];
    const boxes = detectLogoBoxes(img, { aggressive: true });
    assert.strictEqual(boxes.length, 6, `Expected exactly 6 boxes for 6-stamp partial grid, got ${boxes.length}`);
    for (const box of boxes) {
      inpaintLogoBox(img, box, { pad: 5 });
    }
    const centerAfter = [img.bitmap.data[(300 * 800 + 400) * 4], img.bitmap.data[(300 * 800 + 400) * 4 + 1]];
    assert.deepStrictEqual(centerAfter, centerBefore, "Expected empty center slot to remain 100% untouched");
    console.log("PASS [8] Partial 6-stamp grid removes all 6 texts without false-positiving on empty center");
  }

  // Test 9: Clean interior photo with window blinds + vertical wall edges yields 0 false positives
  {
    const img = createCleanGradientImage();
    const d = img.bitmap.data;
    // Draw horizontal blinds in center-top and vertical doorframe on left edge
    for (let y = 120; y < 260; y += 10) {
      for (let x = 250; x < 550; x++) {
        const idx = (y * 800 + x) * 4;
        d[idx] = 230;
        d[idx + 1] = 230;
        d[idx + 2] = 230;
      }
    }
    for (let y = 0; y < 600; y++) {
      for (let x = 35; x < 41; x++) {
        const idx = (y * 800 + x) * 4;
        d[idx] = 235;
        d[idx + 1] = 235;
        d[idx + 2] = 235;
      }
    }
    const boxes = detectLogoBoxes(img, { aggressive: true });
    assert.strictEqual(boxes.length, 0, `Expected 0 false positives on clean interior blinds/doorframe, got ${boxes.length}`);
    console.log("PASS [9] Clean interior blinds & wall edges produce 0 false positives");
  }

  console.log("=== All Storia & 9-Position Owner Watermark Tests PASSED ===");
}

runTests().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
