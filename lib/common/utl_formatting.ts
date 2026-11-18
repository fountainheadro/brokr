export function format_currency(amount: number | string | null | undefined, currency = "EUR"): string {
  if (amount === null || amount === undefined || amount === "") return "Preț la cerere";
  const num = typeof amount === "number" ? amount : parseFloat(String(amount).replace(/[^0-9.-]/g, ""));
  if (isNaN(num)) return String(amount);

  const formatted = new Intl.NumberFormat("ro-RO", {
    maximumFractionDigits: 0,
  }).format(num);

  const symbol = currency === "EUR" ? "€" : currency === "RON" ? "lei" : currency;
  return `${formatted} ${symbol}`;
}

export function format_surface(sqm: number | string | null | undefined): string {
  if (!sqm) return "-";
  const num = typeof sqm === "number" ? sqm : parseFloat(String(sqm).replace(/[^0-9.-]/g, ""));
  if (isNaN(num)) return `${sqm} mp`;
  return `${num} mp`;
}

export function format_internal_id(id: string | null | undefined, prefix = "P"): string {
  if (!id) return "";
  const clean = id.replace(/^[A-Z#]+/i, "");
  return `#${prefix}${clean}`;
}
