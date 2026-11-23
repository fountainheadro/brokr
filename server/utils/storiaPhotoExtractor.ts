/**
 * Comprehensive Storia.ro / Next.js gallery extractor.
 *
 * Root cause addressed:
 * 1. Storia.ro's __NEXT_DATA__ frequently includes `photos: []` alongside a populated
 *    `images: [...]` array (or stores the listing under React Query `dehydratedState.queries`).
 *    Using `ad.photos || ad.images` short-circuited on the truthy empty array `[]`,
 *    leaving only the 3–5 preview thumbnails rendered in the DOM mosaic gallery.
 * 2. Newer Storia pages can also nest gallery arrays inside `props.pageProps.dehydratedState`
 *    or Next.js App Router flight payloads (`self.__next_f.push(...)`).
 */

export interface StoriaPhotoExtractionInput {
  $: any;
  pageUrl: string;
  promoteToHighRes: (rawUrl: string) => string;
  isForbiddenGraphic: (urlStr: string) => boolean;
  blockedAgencyPaths: Set<string>;
  getBaseUrlPath: (u: string) => string;
}

export interface StoriaPhotoExtractionResult {
  nextAdData: any;
  nextDataTargetImages: string[];
  extraBlockedAgencyUrls: string[];
}

function isObjectRecord(val: unknown): val is Record<string, any> {
  return Boolean(val) && typeof val === "object" && !Array.isArray(val);
}

function scoreAdCandidate(obj: any): number {
  if (!isObjectRecord(obj)) return 0;
  let score = 0;
  const arrayFields = [
    obj.images,
    obj.photos,
    obj.listingImages,
    obj.gallery,
    obj.media?.images,
    obj.media?.photos,
  ];
  for (const arr of arrayFields) {
    if (Array.isArray(arr) && arr.length > 0) {
      score += 50 + Math.min(arr.length, 40);
    }
  }
  if (typeof obj.title === "string" && obj.title.length > 3) score += 20;
  if (typeof obj.description === "string" && obj.description.length > 10) score += 15;
  if (obj.characteristics || obj.target || obj.location) score += 15;
  if (obj.owner || obj.agency || obj.contactDetails) score += 10;
  return score;
}

export function extractNextAdDataFromParsed(parsed: any): any | null {
  if (!isObjectRecord(parsed)) return null;
  const pageProps = parsed?.props?.pageProps;
  if (!isObjectRecord(pageProps)) return null;

  const directCandidates = [
    pageProps.ad,
    pageProps.advert,
    pageProps.offer,
    pageProps.listing,
    pageProps.data?.ad,
    pageProps.data?.advert,
    pageProps.data,
    pageProps.initialProps?.ad,
    pageProps.initialState?.ad,
  ].filter(isObjectRecord);

  // Inspect React Query hydrated cache (used by modern Storia.ro / Otodom Next.js pages)
  const queries = pageProps.dehydratedState?.queries;
  if (Array.isArray(queries)) {
    for (const q of queries) {
      const qData = q?.state?.data;
      if (!isObjectRecord(qData)) continue;
      directCandidates.push(qData);
      if (isObjectRecord(qData.ad)) directCandidates.push(qData.ad);
      if (isObjectRecord(qData.advert)) directCandidates.push(qData.advert);
      if (isObjectRecord(qData.listing)) directCandidates.push(qData.listing);
      if (isObjectRecord(qData.offer)) directCandidates.push(qData.offer);
    }
  }

  let best: any = null;
  let bestScore = -1;
  for (const candidate of directCandidates) {
    const score = scoreAdCandidate(candidate);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best || directCandidates[0] || null;
}

function extractUrlFromPhotoItem(item: any): string | null {
  if (typeof item === "string") {
    return item.trim() || null;
  }
  if (!isObjectRecord(item)) return null;

  const direct =
    item.large ||
    item.original ||
    item.full ||
    item.medium ||
    item.url ||
    item.src ||
    item.link ||
    item.image ||
    item.small ||
    item.thumbnail ||
    (isObjectRecord(item.urls) ? item.urls.large || item.urls.original || item.urls.medium || item.urls.small : null);

  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }

  if (typeof item.filename === "string" && item.filename.trim().length > 3) {
    return `https://apollo.olxcdn.com/v1/files/${item.filename.trim()}/image;s=1000x700`;
  }

  if (typeof item.id === "string" && item.id.trim().length > 5 && !item.id.includes(" ")) {
    return `https://apollo.olxcdn.com/v1/files/${item.id.trim()}/image;s=1000x700`;
  }

  return null;
}

function collectPhotoArraysFromObject(obj: any): any[][] {
  if (!isObjectRecord(obj)) return [];
  const rawArrays = [
    obj.images,
    obj.photos,
    obj.listingImages,
    obj.gallery,
    obj.allImages,
    obj.media?.images,
    obj.media?.photos,
    obj.media?.gallery,
  ];
  return rawArrays.filter((arr): arr is any[] => Array.isArray(arr) && arr.length > 0);
}

/**
 * Extracts Storia / Next.js ad metadata AND ALL gallery photos from `__NEXT_DATA__`
 * (including `dehydratedState.queries`) and Next.js flight scripts without short-circuiting
 * on empty `photos: []` arrays.
 */
export function extractStoriaNextDataAndPhotos(
  input: StoriaPhotoExtractionInput
): StoriaPhotoExtractionResult {
  const { $, pageUrl, promoteToHighRes, isForbiddenGraphic, blockedAgencyPaths, getBaseUrlPath } = input;
  const isStoriaPage = pageUrl.toLowerCase().includes("storia.ro") || pageUrl.toLowerCase().includes("otodom.");

  let nextAdData: any = null;
  let parsedNextData: any = null;

  $("script#__NEXT_DATA__").each((_: any, el: any) => {
    if (parsedNextData) return;
    const htmlVal = $(el).html();
    if (!htmlVal) return;
    try {
      parsedNextData = JSON.parse(htmlVal);
      nextAdData = extractNextAdDataFromParsed(parsedNextData);
    } catch {}
  });

  const extraBlockedAgencyUrls: string[] = [];
  if (nextAdData) {
    const agencyCandidates = [
      nextAdData?.owner?.imageUrl,
      nextAdData?.agency?.imageUrl,
      nextAdData?.agency?.branding?.logoUrl,
      nextAdData?.agency?.logoUrl,
      nextAdData?.contactDetails?.imageUrl,
    ];
    for (const u of agencyCandidates) {
      if (typeof u === "string" && u.trim()) {
        extraBlockedAgencyUrls.push(u.trim());
        blockedAgencyPaths.add(getBaseUrlPath(u.trim()));
      }
    }
  }

  const nextDataTargetImages: string[] = [];
  const pushPhotoUrl = (rawCandidate: string | null) => {
    if (!rawCandidate || typeof rawCandidate !== "string") return;
    let candidate = rawCandidate.trim().replace(/\\u002F/gi, "/").replace(/\\/g, "");
    if (candidate.startsWith("//")) candidate = "https:" + candidate;
    if (!candidate.startsWith("http")) return;
    const promoted = promoteToHighRes(candidate);
    if (!isForbiddenGraphic(promoted) && !blockedAgencyPaths.has(getBaseUrlPath(promoted))) {
      nextDataTargetImages.push(promoted);
    }
  };

  // 1. Collect from ALL non-empty photo arrays on nextAdData (never short-circuit on `photos: []`)
  if (nextAdData) {
    const arrays = collectPhotoArraysFromObject(nextAdData);
    for (const arr of arrays) {
      for (const item of arr) {
        pushPhotoUrl(extractUrlFromPhotoItem(item));
      }
    }
  }

  // 2. Also inspect pageProps-level photo arrays and dehydratedState queries (skipping recommendations/similarAds)
  if (parsedNextData?.props?.pageProps) {
    const pageProps = parsedNextData.props.pageProps;
    for (const arr of collectPhotoArraysFromObject(pageProps)) {
      for (const item of arr) {
        pushPhotoUrl(extractUrlFromPhotoItem(item));
      }
    }

    const queries = pageProps.dehydratedState?.queries;
    if (Array.isArray(queries)) {
      for (const q of queries) {
        const keyStr = JSON.stringify(q?.queryKey || "").toLowerCase();
        if (keyStr.includes("similar") || keyStr.includes("recommend") || keyStr.includes("promoted") || keyStr.includes("related")) {
          continue;
        }
        const qData = q?.state?.data;
        if (!isObjectRecord(qData)) continue;
        const subObjects = [qData, qData.ad, qData.advert, qData.listing, qData.offer].filter(isObjectRecord);
        for (const sub of subObjects) {
          for (const arr of collectPhotoArraysFromObject(sub)) {
            for (const item of arr) {
              pushPhotoUrl(extractUrlFromPhotoItem(item));
            }
          }
        }
      }
    }
  }

  // 3. Fallback for Next.js App Router RSC flight scripts on Storia.ro if __NEXT_DATA__ yielded <= 5 images
  if (isStoriaPage && nextDataTargetImages.length <= 5) {
    const imageArrayPattern = /"(?:images|photos)"\s*:\s*\[(\{[\s\S]*?\})\]/g;
    const olxCdnPattern = /https?:\\?\/\\?\/[^"'\s\\]*?(?:apollo\.olxcdn\.com|ireland\.apollo\.olxcdn\.com|frankfurt\.apollo\.olxcdn\.com|akamaized\.net)[^"'\s\\]*?\/v1\/files\/[^"'\s\\]+/gi;

    $("script").each((_: any, el: any) => {
      const raw = $(el).html() || "";
      if (!raw || raw.length < 40) return;
      if (!raw.includes("olxcdn.com") && !raw.includes("akamaized.net")) return;
      // Avoid scanning scripts that look exclusively like recommendation widgets
      const lowerRaw = raw.toLowerCase();
      if (lowerRaw.includes("similarads") && !lowerRaw.includes("ad_id") && !lowerRaw.includes("advert")) {
        return;
      }

      // First try targeted `"images":[...]` / `"photos":[...]` slices from the main listing object
      let arrayMatch: RegExpExecArray | null;
      imageArrayPattern.lastIndex = 0;
      while ((arrayMatch = imageArrayPattern.exec(raw)) !== null) {
        const prefix = raw.slice(Math.max(0, arrayMatch.index - 120), arrayMatch.index).toLowerCase();
        if (prefix.includes("similar") || prefix.includes("recommend") || prefix.includes("related") || prefix.includes("agency")) {
          continue;
        }
        const chunk = arrayMatch[1];
        const urlsInChunk = chunk.match(olxCdnPattern) || [];
        for (const matchedUrl of urlsInChunk) {
          pushPhotoUrl(matchedUrl);
        }
      }
    });
  }

  return {
    nextAdData,
    nextDataTargetImages,
    extraBlockedAgencyUrls,
  };
}
