// Automated Real Estate CRM Versioning System
// Format: X.Y.ZZZ (e.g. 0.0.001)
// Rules:
// - Base reset version: 0.0.001
// - Third group (Z): numbered from 1 to 1000, zero-padded to 3 digits (e.g. 001, 010, 123).
// - Each distinct modification or addition in user requests adds points to group 3:
//   * Small changes: 1 - 10 points
//   * Medium changes: 10 - 100 points
//   * Large/massive changes: 100 - 1000 points
// - Second group (Y): increments by 1 point whenever third group advances by 1% (10 points out of 1000).
//   When Y reaches 100, Y resets to 0 and first group (X) increments by 1.
// - Followed by the last update date and time in parentheses: (DD.MM.YYYY, HH:mm).

export interface VersionData {
  major: number; // Grupul 1
  minor: number; // Grupul 2 (0 - 99)
  patch: number; // Grupul 3 (1 - 1000)
  aiInputsCount: number; // AI inputs count submitted in AI Studio (e.g. 146)
  lastUpdated: string; // ISO string
}

export type UpdateComplexity = 'small' | 'medium' | 'large' | number;

const STORAGE_KEY = "brokr_app_version_state_v19";
export const BASE_AI_INPUTS_COUNT = 155;

// Initial version state updated (+1 prompt to AI Studio inputs count)
const DEFAULT_VERSION: VersionData = {
  major: 0,
  minor: 15,
  patch: 155,
  aiInputsCount: BASE_AI_INPUTS_COUNT,
  lastUpdated: new Date().toISOString()
};

/**
 * Normalizes version data to ensure all mathematical rules hold:
 * - If patch exceeds 1000, it wraps around from 1 to 1000 and increments minor.
 * - If minor reaches 100, minor resets to 0 and major increments.
 */
function normalizeVersion(data: VersionData): VersionData {
  let { major, minor, patch, aiInputsCount, lastUpdated } = data;
  aiInputsCount = Math.max(BASE_AI_INPUTS_COUNT, Number(aiInputsCount) || BASE_AI_INPUTS_COUNT);

  if (patch > 1000) {
    const overflow = Math.floor((patch - 1) / 1000);
    patch = ((patch - 1) % 1000) + 1;
    minor += overflow * 100;
  }

  if (minor >= 100) {
    major += Math.floor(minor / 100);
    minor = minor % 100;
  }

  return { major, minor, patch, aiInputsCount, lastUpdated };
}

export function getCurrentVersion(): {
  major: number;
  minor: number;
  patch: number;
  aiInputsCount: number;
  versionCode: string; // "0.14.146"
  dateFormatted: string; // "02.11.2026, 15:30"
  fullDisplay: string; // "0.14.146 / 146 02.11.2026, 15:30"
} {
  let stored: VersionData = DEFAULT_VERSION;

  try {
    // Clear legacy keys if any
    const legacyKeys = [
      "brokr_app_version_state",
      "brokr_app_version_state_v2",
      "brokr_app_version_state_v3",
      "brokr_app_version_state_v9"
    ];
    legacyKeys.forEach(k => {
      if (localStorage.getItem(k)) localStorage.removeItem(k);
    });

    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      stored = normalizeVersion(JSON.parse(raw));
    } else {
      stored = DEFAULT_VERSION;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    }
  } catch {
    stored = DEFAULT_VERSION;
  }

  const d = new Date(stored.lastUpdated || Date.now());
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const dateFormatted = `${day}.${month}.${year}, ${hours}:${minutes}`;

  // Third group is zero-padded to 3 digits (e.g. 001, 146)
  const patchFormatted = String(stored.patch).padStart(3, "0");
  const versionCode = `${stored.major}.${stored.minor}.${patchFormatted}`;
  const aiInputsCount = Math.max(BASE_AI_INPUTS_COUNT, stored.aiInputsCount || BASE_AI_INPUTS_COUNT);
  const fullDisplay = `${versionCode} / ${aiInputsCount} ${dateFormatted}`;

  return {
    major: stored.major,
    minor: stored.minor,
    patch: stored.patch,
    aiInputsCount,
    versionCode,
    dateFormatted,
    fullDisplay
  };
}

/**
 * Resets version explicitly to 0.0.001
 */
export function resetVersionToInitial(): ReturnType<typeof getCurrentVersion> {
  const reset: VersionData = {
    major: 0,
    minor: 0,
    patch: 1,
    aiInputsCount: BASE_AI_INPUTS_COUNT,
    lastUpdated: new Date().toISOString()
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reset));
  } catch {}
  return getCurrentVersion();
}

/**
 * Registers an update event, calculating points by complexity or direct number:
 * - small: 1-10 points (default: 3)
 * - medium: 10-100 points (default: 25)
 * - large: 100-1000 points (default: 200)
 * - number: exact points added
 */
export function recordUpdate(complexity: UpdateComplexity = 1): ReturnType<typeof getCurrentVersion> {
  let step = 1;
  if (typeof complexity === 'number') {
    step = Math.max(1, complexity);
  } else if (complexity === 'small') {
    step = 5;
  } else if (complexity === 'medium') {
    step = 25;
  } else if (complexity === 'large') {
    step = 200;
  }

  let stored = DEFAULT_VERSION;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) stored = normalizeVersion(JSON.parse(raw));
  } catch {}

  let patch = stored.patch + step;
  let minor = stored.minor;
  let major = stored.major;
  const aiInputsCount = Math.max(BASE_AI_INPUTS_COUNT, (stored.aiInputsCount || BASE_AI_INPUTS_COUNT)) + 1;

  // Check 1% thresholds (every 10 points in patch = 1% of 1000, so minor increments by 1)
  const prevPercent = Math.floor(stored.patch / 10);
  const newPercent = Math.floor(patch / 10);
  const percentDelta = newPercent - prevPercent;
  if (percentDelta > 0) {
    minor += percentDelta;
  }

  if (patch > 1000) {
    patch = ((patch - 1) % 1000) + 1;
  }

  if (minor >= 100) {
    major += Math.floor(minor / 100);
    minor = minor % 100;
  }

  const updated: VersionData = {
    major,
    minor,
    patch,
    aiInputsCount,
    lastUpdated: new Date().toISOString()
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {}

  return getCurrentVersion();
}
