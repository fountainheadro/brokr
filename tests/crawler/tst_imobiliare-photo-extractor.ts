import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import {
  isImobiliareUrl,
  getImobiliarePhotoKey,
  extractRoamcdnListingFolder,
  scoreImobiliareImageResolution,
  isImobiliareThumbnailUrl,
  isImobiliareNonGalleryAsset,
  parseSrcsetCandidates,
  normalizeImobiliareImageUrl,
  decodeNuxtDevaluePayload,
  extractImobiliareGalleryPhotos,
  mergeImobiliareGalleryResults,
  upgradeRemainingImobiliareThumbnails,
  type ThumbnailProbeFn,
} from "../../server/utils/imobiliarePhotoExtractor";

const URL_PAGE =
  "https://www.imobiliare.ro/oferta/apartament-de-inchiriat-sector-1-aviatiei-2-camere-2-21700175";

async function runTests() {
  // 1. URL detection, proxy unwrapping, & RoamCDN listing folder extraction
  {
    assert.equal(isImobiliareUrl(URL_PAGE), true);
    assert.equal(isImobiliareUrl("https://imobiliare.ro/inchirieri-apartamente/cluj-napoca"), true);
    assert.equal(isImobiliareUrl("https://www.storia.ro/ro/oferta/test"), false);

    const realFull =
      "https://i.roamcdn.net/prop/imo/gallery-full-1200w-watermark/m8wpWbvfl3tnS6SNCQrvDw/-_1q4ZkoeCS1LTEPAVg0Z1YDCyBypRqAQ/_1I7l9EBFm4KLvpg8kDQw8QryN_d0A/88411436.jpg";
    const realThumb =
      "https://i.roamcdn.net/prop/imo/gallery-thumb-140w/kaXgceic2NVthK9bEN9uew/-/_1I7l9EBFm4KLvpg8kDQw8QryN_d0A/88411436.jpg";

    assert.equal(extractRoamcdnListingFolder(realFull), "_1I7l9EBFm4KLvpg8kDQw8QryN_d0A");
    assert.equal(extractRoamcdnListingFolder(realThumb), "_1I7l9EBFm4KLvpg8kDQw8QryN_d0A");
    assert.equal(getImobiliarePhotoKey(realFull), getImobiliarePhotoKey(realThumb));

    const nextWrapped =
      "https://www.imobiliare.ro/_next/image?url=https%3A%2F%2Fi.roamcdn.net%2Fprop%2Fimo%2Fgallery-full-1200w-watermark%2Fm8wpWbvfl3tnS6SNCQrvDw%2F-_1q4ZkoeCS1LTEPAVg0Z1YDCyBypRqAQ%2F_1I7l9EBFm4KLvpg8kDQw8QryN_d0A%2F88411436.jpg&w=384&q=75";
    assert.equal(normalizeImobiliareImageUrl(nextWrapped, URL_PAGE), realFull);
  }

  // 2. Base64url signature tokens containing "pin"/"pdf"/"logo" must NEVER false-positive reject valid roamcdn photos
  {
    const trickySigPhoto =
      "https://i.roamcdn.net/prop/imo/gallery-full-1200w-watermark/abcPinPdfLogoUser12345/-_1q4ZkoeCS1LTEPAVg0Z1YDCyBypRqAQ/_1I7l9EBFm4KLvpg8kDQw8QryN_d0A/88411436.jpg";
    const agencyLogo =
      "https://i.roamcdn.net/prop/imo/base-logo/abc12345/-/_1I7l9EBFm4KLvpg8kDQw8QryN_d0A/agency.png";
    const ownerAvatar = "https://www.imobiliare.ro/api/v1/avatar/stefan-paraschiv";

    assert.equal(isImobiliareNonGalleryAsset(trickySigPhoto), false);
    assert.equal(isImobiliareNonGalleryAsset(agencyLogo), true);
    assert.equal(isImobiliareNonGalleryAsset(ownerAvatar), true);
  }

  // 3. Resolution scoring & srcset parsing
  {
    const full1200 =
      "https://i.roamcdn.net/prop/imo/gallery-full-1200w-watermark/m8wpWbvfl3tnS6SNCQrvDw/-_1q4ZkoeCS1LTEPAVg0Z1YDCyBypRqAQ/_1I7l9EBFm4KLvpg8kDQw8QryN_d0A/88411436.jpg";
    const main900 =
      "https://i.roamcdn.net/prop/imo/gallery-main-900w-watermark/abc12345/-/_1I7l9EBFm4KLvpg8kDQw8QryN_d0A/88411436.jpg";
    const thumb140 =
      "https://i.roamcdn.net/prop/imo/gallery-thumb-140w/kaXgceic2NVthK9bEN9uew/-/_1I7l9EBFm4KLvpg8kDQw8QryN_d0A/88411436.jpg";

    assert.ok(scoreImobiliareImageResolution(full1200) > scoreImobiliareImageResolution(main900));
    assert.ok(scoreImobiliareImageResolution(main900) > 0);
    assert.ok(scoreImobiliareImageResolution(thumb140) < 0);
    assert.equal(isImobiliareThumbnailUrl(thumb140), true);
    assert.equal(isImobiliareThumbnailUrl(full1200), false);

    const parsed = parseSrcsetCandidates(`${thumb140} 140w, ${full1200} 1200w`, URL_PAGE);
    assert.equal(parsed[0].url, full1200);
    assert.equal(parsed[0].widthHint, 1200);
  }

  // 4. REAL attached Imobiliare.ro gallery modal HTML fixture:
  //    - Must extract all 13 unique photos in exact 1..13 order (dropping the 14th contact-card duplicate of photo 1
  //      and dropping the sidebar avatar `stefan-paraschiv`)
  //    - Must select `gallery-full-1200w-watermark` (not `gallery-thumb-140w` blur backdrop) for all mounted slides
  //    - Must discover the authoritative folder `_1I7l9EBFm4KLvpg8kDQw8QryN_d0A`
  {
    const fixturePath = path.resolve(
      process.cwd(),
      "public/assets/aistudio/Paste_November_27__2026_-_3_48PM_776272cf"
    );
    if (fs.existsSync(fixturePath)) {
      const realModalHtml = fs.readFileSync(fixturePath, "utf8");
      const $ = cheerio.load(realModalHtml);
      const res = extractImobiliareGalleryPhotos({ $, html: realModalHtml, pageUrl: URL_PAGE });

      assert.equal(res.primaryPanelFound, true);
      assert.equal(res.source, "primary-panel");
      assert.equal(res.images.length, 13, `Expected 13 unique gallery photos, got ${res.images.length}`);
      assert.deepEqual(res.authoritativeFolders, ["_1I7l9EBFm4KLvpg8kDQw8QryN_d0A"]);
      // First 4 mounted slides must ALL be `gallery-full-1200w-watermark` in exact canonical order 1..4
      assert.ok(res.images[0].includes("gallery-full-1200w-watermark") && res.images[0].endsWith("/88411436.jpg"));
      assert.ok(res.images[1].includes("gallery-full-1200w-watermark") && res.images[1].endsWith("/88411428.jpg"));
      assert.ok(res.images[2].includes("gallery-full-1200w-watermark") && res.images[2].endsWith("/88411416.jpg"));
      assert.ok(res.images[3].includes("gallery-full-1200w-watermark") && res.images[3].endsWith("/88411418.jpg"));
      // 13th photo must be 88411460.jpg, and avatar must never appear
      assert.ok(res.images[12].endsWith("/88411460.jpg"));
      assert.ok(!res.images.some((u) => u.includes("avatar") || u.includes("stefan-paraschiv")));
      // Remaining 9 virtualized slides are flagged as thumbnails so browser sweep triggers automatically!
      assert.equal(res.remainingThumbnailsCount, 9);
    }
  }

  // 5. Nuxt 3 SSR HTML (WITHOUT `#detail-gallery-modal-panel-gallery` mounted yet!):
  //    Simulates direct URL crawl of Imobiliare.ro where `<script id="__NUXT_DATA__">` holds all 13
  //    signed `gallery-full-1200w-watermark` URLs alongside similar apartments and agency logo.
  //    Previously returned ONLY 1 image (og:image); now must return ALL 13 full-res photos and ZERO leaks!
  {
    const photoIds = [
      "88411436", "88411428", "88411416", "88411418", "88411420",
      "88411424", "88411432", "88411440", "88411444", "88411448",
      "88411452", "88411458", "88411460",
    ];
    // Construct realistic Nuxt 3 `devalue` flat indexed payload
    const nuxtArray: unknown[] = [
      ["ShallowReactive", 1],
      { data: 2 },
      { offerDetail: 3 },
      { id: 4, media: 5, similarOffers: 6, agency: 7 },
      21700175,
      { gallery: 8 },
      [9],
      { logo: 10 },
      [] as number[], // index 8: gallery item indices
      { images: 11 }, // index 9: similar offer
      "https://i.roamcdn.net/prop/imo/base-logo/agSig12345678901234567/-/agFolder1234567890123456/agency.png", // index 10
      [12], // index 11: similar offer images
      "https://i.roamcdn.net/prop/imo/gallery-full-1200w-watermark/simSig1234567890123456/-_wmSimilar/_OTHER_APARTMENT_FOLDER_999999/99999991.jpg", // index 12
    ];

    const galleryItemIndices: number[] = [];
    for (let i = 0; i < photoIds.length; i++) {
      const id = photoIds[i];
      const thumbIdx = nuxtArray.length;
      nuxtArray.push(
        `https://i.roamcdn.net/prop/imo/gallery-thumb-140w/thSig${i}abcdefghijklmno/-/_1I7l9EBFm4KLvpg8kDQw8QryN_d0A/${id}.jpg`
      );
      const fullIdx = nuxtArray.length;
      nuxtArray.push(
        `https://i.roamcdn.net/prop/imo/gallery-full-1200w-watermark/flSig${i}abcdefghijklmno/-_1q4ZkoeCS1LTEPAVg0Z1YDCyBypRqAQ/_1I7l9EBFm4KLvpg8kDQw8QryN_d0A/${id}.jpg`
      );
      const objIdx = nuxtArray.length;
      nuxtArray.push({ thumb: thumbIdx, full: fullIdx });
      galleryItemIndices.push(objIdx);
    }
    nuxtArray[8] = galleryItemIndices;

    // Verify decoder itself
    const decoded = decodeNuxtDevaluePayload(nuxtArray) as any;
    assert.equal(decoded?.data?.offerDetail?.media?.gallery?.length, 13);

    const ssrHtml = `
      <!doctype html>
      <html>
        <head>
          <meta property="og:image" content="https://i.roamcdn.net/prop/imo/gallery-full-1200w-watermark/flSig0abcdefghijklmno/-_1q4ZkoeCS1LTEPAVg0Z1YDCyBypRqAQ/_1I7l9EBFm4KLvpg8kDQw8QryN_d0A/88411436.jpg" />
        </head>
        <body>
          <main>
            <img src="https://i.roamcdn.net/prop/imo/gallery-main-900w-watermark/heroSig123456789012345/-/_1I7l9EBFm4KLvpg8kDQw8QryN_d0A/88411436.jpg" />
            <section class="similar">
              <img src="https://i.roamcdn.net/prop/imo/gallery-full-1200w-watermark/simSig2222222222222222/-_wmSimilar/_SECOND_SIMILAR_FOLDER_8888888/77777771.jpg" />
            </section>
          </main>
          <script type="application/json" id="__NUXT_DATA__">${JSON.stringify(nuxtArray)}</script>
        </body>
      </html>
    `;

    const $ = cheerio.load(ssrHtml);
    const res = extractImobiliareGalleryPhotos({ $, html: ssrHtml, pageUrl: URL_PAGE });

    assert.equal(res.images.length, 13, `Expected all 13 full-res photos from Nuxt SSR, got ${res.images.length}`);
    assert.equal(res.remainingThumbnailsCount, 0);
    for (let i = 0; i < photoIds.length; i++) {
      assert.ok(
        res.images[i].includes("gallery-full-1200w-watermark") && res.images[i].endsWith(`/${photoIds[i]}.jpg`),
        `Photo #${i + 1} should be full-res ${photoIds[i]}.jpg, got ${res.images[i]}`
      );
    }
    assert.ok(!res.images.some((u) => u.includes("99999991") || u.includes("77777771") || u.includes("base-logo")));
  }

  // 6. Folder-scoped full-HTML harvest works even when Nuxt uses an unknown/obfuscated key name!
  {
    const unknownKeyHtml = `
      <!doctype html>
      <html>
        <head>
          <meta property="og:image" content="https://i.roamcdn.net/prop/imo/gallery-full-1200w-watermark/covSig1234567890123456/-_wm1/_MY_LISTING_FOLDER_ABC1234567/10001.jpg" />
        </head>
        <body>
          <script type="application/json" id="__NUXT_DATA__">
            [
              ["ShallowReactive", 1],
              {"unusualPayloadKey": 2},
              [3, 4, 5, 6],
              "https://i.roamcdn.net/prop/imo/gallery-full-1200w-watermark/sig1abcdefghijklmnopqr/-_wm1/_MY_LISTING_FOLDER_ABC1234567/10001.jpg",
              "https://i.roamcdn.net/prop/imo/gallery-full-1200w-watermark/sig2abcdefghijklmnopqr/-_wm1/_MY_LISTING_FOLDER_ABC1234567/10002.jpg",
              "https://i.roamcdn.net/prop/imo/gallery-full-1200w-watermark/sig3abcdefghijklmnopqr/-_wm1/_MY_LISTING_FOLDER_ABC1234567/10003.jpg",
              "https://i.roamcdn.net/prop/imo/gallery-full-1200w-watermark/sig4abcdefghijklmnopqr/-_wm1/_DIFFERENT_APT_FOLDER_XYZ9999/20001.jpg"
            ]
          </script>
        </body>
      </html>
    `;

    const $ = cheerio.load(unknownKeyHtml);
    const res = extractImobiliareGalleryPhotos({ $, html: unknownKeyHtml, pageUrl: URL_PAGE });

    assert.equal(res.source, "folder-harvest");
    assert.equal(res.images.length, 3);
    assert.equal(res.remainingThumbnailsCount, 0);
    assert.ok(res.images.every((u) => u.includes("_MY_LISTING_FOLDER_ABC1234567") && u.includes("gallery-full-1200w-watermark")));
    assert.ok(!res.images.some((u) => u.includes("20001.jpg")));
  }

  // 7. Merging partial modal extraction (4 full + 9 thumbs) with browser carousel sweep (all 13 full)
  {
    const staticPartial = {
      images: [
        "https://i.roamcdn.net/prop/imo/gallery-full-1200w-watermark/f1/-_w/_1I7l9EBFm4KLvpg8kDQw8QryN_d0A/88411436.jpg",
        "https://i.roamcdn.net/prop/imo/gallery-thumb-140w/t2/-/_1I7l9EBFm4KLvpg8kDQw8QryN_d0A/88411428.jpg",
        "https://i.roamcdn.net/prop/imo/gallery-thumb-140w/t3/-/_1I7l9EBFm4KLvpg8kDQw8QryN_d0A/88411416.jpg",
      ],
      source: "primary-panel" as const,
      primaryPanelFound: true,
      remainingThumbnailsCount: 2,
      observedHighResPresets: ["gallery-full-1200w-watermark"],
      authoritativeFolders: ["_1I7l9EBFm4KLvpg8kDQw8QryN_d0A"],
    };

    const browserSweep = {
      images: [
        "https://i.roamcdn.net/prop/imo/gallery-full-1200w-watermark/f1/-_w/_1I7l9EBFm4KLvpg8kDQw8QryN_d0A/88411436.jpg",
        "https://i.roamcdn.net/prop/imo/gallery-full-1200w-watermark/f2/-_w/_1I7l9EBFm4KLvpg8kDQw8QryN_d0A/88411428.jpg",
        "https://i.roamcdn.net/prop/imo/gallery-full-1200w-watermark/f3/-_w/_1I7l9EBFm4KLvpg8kDQw8QryN_d0A/88411416.jpg",
      ],
      source: "primary-panel" as const,
      primaryPanelFound: true,
      remainingThumbnailsCount: 0,
      observedHighResPresets: ["gallery-full-1200w-watermark"],
      authoritativeFolders: ["_1I7l9EBFm4KLvpg8kDQw8QryN_d0A"],
    };

    const merged = mergeImobiliareGalleryResults(staticPartial, browserSweep);
    assert.equal(merged.images.length, 3);
    assert.equal(merged.remainingThumbnailsCount, 0);
    assert.ok(merged.images.every((u) => u.includes("gallery-full-1200w-watermark")));
  }

  // 8. Safe verified thumbnail upgrade helper (never breaks signed URLs that return 400/403)
  {
    const cover =
      "https://i.roamcdn.net/prop/imo/gallery-full-1200w-watermark/c1/-_w/_1I7l9EBFm4KLvpg8kDQw8QryN_d0A/88411436.jpg";
    const strictlySignedThumb =
      "https://i.roamcdn.net/prop/imo/gallery-thumb-140w/sig1/-/_1I7l9EBFm4KLvpg8kDQw8QryN_d0A/88411420.jpg";
    const legacyThumb = "https://media.imobiliare.ro/poze/12345/apartament_200x150.jpg";

    const mockProbe: ThumbnailProbeFn = async (candidateUrl) => {
      if (candidateUrl.includes("apartament_1200x900.jpg")) {
        return { ok: true, contentType: "image/jpeg", contentLength: 210000 };
      }
      return { ok: false, contentType: "", contentLength: null };
    };

    const upgraded = await upgradeRemainingImobiliareThumbnails(
      [cover, strictlySignedThumb, legacyThumb],
      {
        observedHighResPresets: ["gallery-full-1200w-watermark"],
        probeFn: mockProbe,
      }
    );

    assert.equal(upgraded[0], cover);
    assert.equal(upgraded[1], strictlySignedThumb);
    assert.equal(upgraded[2], "https://media.imobiliare.ro/poze/12345/apartament_1200x900.jpg");
  }

  console.log("ALL IMOBILIARE PHOTO EXTRACTOR TESTS PASSED (8/8)");
}

runTests().catch((err) => {
  console.error("IMOBILIARE PHOTO EXTRACTOR TEST FAILED:", err);
  process.exit(1);
});
