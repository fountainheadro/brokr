function appendQueryParam(urlStr: string, key: string, value: string): string {
  const [baseAndQuery, hash = ""] = urlStr.split("#");
  const qIndex = baseAndQuery.indexOf("?");
  const base = qIndex === -1 ? baseAndQuery : baseAndQuery.slice(0, qIndex);
  const query = qIndex === -1 ? "" : baseAndQuery.slice(qIndex + 1);
  const params = new URLSearchParams(query);
  params.set(key, value);
  const next = `${base}?${params.toString()}`;
  return hash ? `${next}#${hash}` : next;
}

export function getCleanDisplayImageUrl(
  url: string | undefined | null,
  width?: number
): string {
  if (!url || typeof url !== "string") return "";
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("data:") || trimmed.startsWith("blob:")) return trimmed;

  const targetW =
    typeof width === "number" && Number.isFinite(width) && width > 0
      ? Math.max(100, Math.min(1600, Math.round(width)))
      : null;

  if (
    trimmed.startsWith("/api/proxy-image") ||
    trimmed.includes("/api/proxy-image?url=") ||
    trimmed.startsWith("/api/public-image") ||
    trimmed.startsWith("/api/storage/media/") ||
    trimmed.startsWith("/uploads/")
  ) {
    return targetW ? appendQueryParam(trimmed, "w", String(targetW)) : trimmed;
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const proxied = `/api/proxy-image?url=${encodeURIComponent(trimmed)}`;
    return targetW ? `${proxied}&w=${targetW}` : proxied;
  }

  return trimmed;
}

export function getThumbnailImageUrl(
  url: string | undefined | null,
  width: number
): string {
  return getCleanDisplayImageUrl(url, width);
}
