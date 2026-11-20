export const DAILY_LEAD_ID_REGEX = /^(\d{4}-\d{2}-\d{2})-(\d+)$/;
export const AGENCY_LEAD_ID_REGEX = /^L(\d+)$/i;

/**
 * Formats a calendar date as `YYYY-MM-DD` in Romania's timezone (`Europe/Bucharest`)
 * so daily auto-crawl / admin lead counters reset cleanly at midnight local time.
 */
export function getDailyLeadDateKey(dateInput?: Date | string | number | null): string {
  let dateObj: Date;
  if (dateInput instanceof Date) {
    dateObj = dateInput;
  } else if (typeof dateInput === "string" || typeof dateInput === "number") {
    const parsed = new Date(dateInput);
    dateObj = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  } else {
    dateObj = new Date();
  }

  try {
    const formatted = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Bucharest",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(dateObj);
    if (/^\d{4}-\d{2}-\d{2}$/.test(formatted)) {
      return formatted;
    }
  } catch {
    // Fall back to local date formatting if Intl timezone data is unavailable
  }

  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isDailyLeadId(value?: unknown): boolean {
  return typeof value === "string" && DAILY_LEAD_ID_REGEX.test(value.trim());
}

export function isAgencyLeadId(value?: unknown): boolean {
  return typeof value === "string" && AGENCY_LEAD_ID_REGEX.test(value.trim());
}

export function parseDailyLeadId(value?: unknown): { dateKey: string; sequence: number } | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(DAILY_LEAD_ID_REGEX);
  if (!match) return null;
  const sequence = parseInt(match[2], 10);
  if (!Number.isFinite(sequence) || sequence <= 0) return null;
  return {
    dateKey: match[1],
    sequence,
  };
}

export function formatDailyLeadId(dateKey: string, sequence: number): string {
  return `${dateKey}-${Math.max(1, Math.floor(sequence))}`;
}

export function getMaxDailyLeadSequenceForDate(
  records: Array<{ propertyId?: unknown }>,
  dateKey: string
): number {
  let maxSeq = 0;
  for (const record of records) {
    const parsed = parseDailyLeadId(record?.propertyId);
    if (parsed && parsed.dateKey === dateKey && parsed.sequence > maxSeq) {
      maxSeq = parsed.sequence;
    }
  }
  return maxSeq;
}
