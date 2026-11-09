import axios from "axios";

async function run() {
  const url = "https://www.storia.ro/ro/oferta/apartament-3-camere-de-nchiriat-sector-2-metrou-obor-3-minute-IDIVde";
  try {
    const res = await axios.post("http://localhost:3000/api/crawl", { url });
    console.log("CRAWL RESULT STATUS:", res.status);
    console.log("TITLE:", res.data.title);
    console.log("PRICE:", res.data.price);
    console.log("IMAGES COUNT:", res.data.images?.length);
    console.log("FIRST 3 IMAGES:", res.data.images?.slice(0, 3));
    console.log("CRM DATA IMAGES ALTESPATII COUNT:", res.data.crmData?.imagini?.alteSpatii?.length);
  } catch (err: any) {
    if (err.response) {
      console.log("CRAWL ERROR STATUS:", err.response.status, err.response.data);
    } else {
      console.log("CRAWL ERROR:", err.message);
    }
  }
}

run();
