import { auth } from "../lib/firebase";
import { getApiAuthHeaders } from "../lib/apiAuth";
import {
  AgencyAutomationConfigRecord,
  DEFAULT_TITLE_AUTOMATION_RULE,
  TitleAutomationRule,
  normalizeTitleAutomationRule,
} from "../core/automation/typ_title-automation";

const STORAGE_KEY_PREFIX = "brokr_title_automation_rule";

function getCacheKey(tenantId?: string): string {
  return tenantId ? `${STORAGE_KEY_PREFIX}_${tenantId}` : STORAGE_KEY_PREFIX;
}

export function getCachedTitleRule(tenantId?: string): TitleAutomationRule {
  if (typeof window !== "undefined") {
    try {
      const raw =
        window.localStorage.getItem(getCacheKey(tenantId)) ||
        window.localStorage.getItem(STORAGE_KEY_PREFIX);
      if (raw) {
        return normalizeTitleAutomationRule(JSON.parse(raw));
      }
    } catch {
      // ignore storage errors
    }
  }
  return normalizeTitleAutomationRule(DEFAULT_TITLE_AUTOMATION_RULE);
}

function setCachedTitleRule(rule: TitleAutomationRule, tenantId?: string): void {
  if (typeof window === "undefined") return;
  try {
    const serialized = JSON.stringify(rule);
    window.localStorage.setItem(STORAGE_KEY_PREFIX, serialized);
    if (tenantId) {
      window.localStorage.setItem(getCacheKey(tenantId), serialized);
    }
  } catch {
    // ignore storage errors
  }
}

export const automationSettingsService = {
  async fetchTitleRule(tenantId?: string): Promise<AgencyAutomationConfigRecord | null> {
    if (!auth.currentUser) {
      return {
        id: `auto_${tenantId || "default"}`,
        tenantId: tenantId || "ten_brokr_default",
        titleRule: getCachedTitleRule(tenantId),
        version: 1,
        updatedBy: "local",
        updatedAt: new Date().toISOString(),
      };
    }

    const headers = await getApiAuthHeaders();
    const res = await fetch("/api/tenant/automation/title-rule", { headers });
    const json = await res.json();
    if (!res.ok || !json?.success) {
      throw new Error(json?.error?.message || "Eroare la încărcarea regulii de automatizare.");
    }
    const record = json.data as AgencyAutomationConfigRecord;
    const normalizedRule = normalizeTitleAutomationRule(record.titleRule);
    setCachedTitleRule(normalizedRule, record.tenantId || tenantId);
    return {
      ...record,
      titleRule: normalizedRule,
    };
  },

  async saveTitleRule(
    rule: TitleAutomationRule,
    tenantId?: string
  ): Promise<AgencyAutomationConfigRecord> {
    const normalized = normalizeTitleAutomationRule(rule);
    setCachedTitleRule(normalized, tenantId);

    const headers = await getApiAuthHeaders({ "Content-Type": "application/json" });
    const res = await fetch("/api/tenant/automation/title-rule", {
      method: "PUT",
      headers,
      body: JSON.stringify({ titleRule: normalized }),
    });
    const json = await res.json();
    if (!res.ok || !json?.success) {
      throw new Error(json?.error?.message || "Eroare la salvarea regulii de automatizare.");
    }
    const record = json.data as AgencyAutomationConfigRecord;
    const savedRule = normalizeTitleAutomationRule(record.titleRule);
    setCachedTitleRule(savedRule, record.tenantId || tenantId);
    return {
      ...record,
      titleRule: savedRule,
    };
  },

  async resetTitleRule(tenantId?: string): Promise<AgencyAutomationConfigRecord> {
    const headers = await getApiAuthHeaders({ "Content-Type": "application/json" });
    const res = await fetch("/api/tenant/automation/title-rule/reset", {
      method: "POST",
      headers,
    });
    const json = await res.json();
    if (!res.ok || !json?.success) {
      throw new Error(json?.error?.message || "Eroare la resetarea regulii de automatizare.");
    }
    const record = json.data as AgencyAutomationConfigRecord;
    const resetRule = normalizeTitleAutomationRule(record.titleRule);
    setCachedTitleRule(resetRule, record.tenantId || tenantId);
    return {
      ...record,
      titleRule: resetRule,
    };
  },

  async fetchPlatformDefaultTitleRule(): Promise<AgencyAutomationConfigRecord> {
    const headers = await getApiAuthHeaders();
    const res = await fetch("/api/platform/automation/title-rule", { headers });
    const json = await res.json();
    if (!res.ok || !json?.success) {
      throw new Error(json?.error?.message || "Eroare la încărcarea regulii implicite a platformei.");
    }
    const record = json.data as AgencyAutomationConfigRecord;
    return {
      ...record,
      titleRule: normalizeTitleAutomationRule(record.titleRule),
    };
  },

  async savePlatformDefaultTitleRule(
    rule: TitleAutomationRule
  ): Promise<AgencyAutomationConfigRecord> {
    const normalized = normalizeTitleAutomationRule(rule);
    const headers = await getApiAuthHeaders({ "Content-Type": "application/json" });
    const res = await fetch("/api/platform/automation/title-rule", {
      method: "PUT",
      headers,
      body: JSON.stringify({ titleRule: normalized }),
    });
    const json = await res.json();
    if (!res.ok || !json?.success) {
      throw new Error(json?.error?.message || "Eroare la salvarea regulii implicite a platformei.");
    }
    const record = json.data as AgencyAutomationConfigRecord;
    return {
      ...record,
      titleRule: normalizeTitleAutomationRule(record.titleRule),
    };
  },

  async resetPlatformDefaultTitleRule(): Promise<AgencyAutomationConfigRecord> {
    const headers = await getApiAuthHeaders({ "Content-Type": "application/json" });
    const res = await fetch("/api/platform/automation/title-rule/reset", {
      method: "POST",
      headers,
    });
    const json = await res.json();
    if (!res.ok || !json?.success) {
      throw new Error(json?.error?.message || "Eroare la resetarea regulii implicite a platformei.");
    }
    const record = json.data as AgencyAutomationConfigRecord;
    return {
      ...record,
      titleRule: normalizeTitleAutomationRule(record.titleRule),
    };
  },

  getCachedTitleRule,
};
