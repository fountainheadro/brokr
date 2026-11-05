import * as cheerio from "cheerio";

async function test() {
  const url = "https://www.storia.ro/ro/oferta/penthouse-de-excepie-n-zona-jandarmeriei-prima-nchiriere-IDIVXK";
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    }
  });
  const html = await res.text();
  const $ = cheerio.load(html);

  console.log("Checking container MosaicViewScrollableContent...");
  const container = $('[data-sentry-component="MosaicViewScrollableContent"], [class*="MosaicViewScrollableContent"], .eyfe3ek0, .css-17sb5za');
  console.log("Container found count:", container.length);

  if (container.length > 0) {
    const imgs = container.find("img");
    console.log("Images inside MosaicViewScrollableContent count:", imgs.length);
    imgs.each((idx, el) => {
      const src = $(el).attr("src") || $(el).attr("data-src") || $(el).attr("srcset");
      console.log(`Img ${idx + 1}:`, src?.substring(0, 100));
    });

    const sources = container.find("source");
    console.log("Sources inside count:", sources.length);
    sources.each((idx, el) => {
      const srcset = $(el).attr("srcset");
      console.log(`Source ${idx + 1}:`, srcset?.substring(0, 100));
    });
  }

  // Also check all images on the page
  console.log("Total <img> on entire page:", $("img").length);
  const apolloImgs = [];
  $("img").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src") || $(el).attr("srcset");
    if (src && (src.includes("apollo.olxcdn.com") || src.includes("apollo"))) {
      apolloImgs.push(src);
    }
  });
  console.log("Total apollo images in DOM <img> tags:", apolloImgs.length);
}

test();
