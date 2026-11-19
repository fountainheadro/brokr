import {
  AgencyAutomationConfigRecord,
  DEFAULT_TITLE_AUTOMATION_RULE,
  TitleAutomationRule,
  normalizeTitleAutomationRule,
} from "./typ_title-automation";
import { PersistentStoreService } from "../database/svc_persistent-store";

const COL_AUTOMATION_CONFIGS = "automation_configs";
export const PLATFORM_DEFAULT_AUTOMATION_KEY = "platform_default";

export class AutomationConfigRepository {
  public static getPlatformDefaultRecord(): AgencyAutomationConfigRecord {
    let existing = PersistentStoreService.get<AgencyAutomationConfigRecord>(
      COL_AUTOMATION_CONFIGS,
      PLATFORM_DEFAULT_AUTOMATION_KEY
    );
    if (!existing) {
      const legacy = PersistentStoreService.get<AgencyAutomationConfigRecord>(
        COL_AUTOMATION_CONFIGS,
        "__platform_default__"
      );
      if (legacy && legacy.titleRule) {
        existing = {
          ...legacy,
          tenantId: PLATFORM_DEFAULT_AUTOMATION_KEY,
        };
        PersistentStoreService.set(COL_AUTOMATION_CONFIGS, PLATFORM_DEFAULT_AUTOMATION_KEY, existing);
        PersistentStoreService.delete(COL_AUTOMATION_CONFIGS, "__platform_default__");
      }
    }
    if (existing && existing.titleRule) {
      const normalized = normalizeTitleAutomationRule(existing.titleRule);
      if (
        existing.updatedBy === "system" &&
        existing.version === 1 &&
        normalized.minChars === 25 &&
        normalized.maxChars === 130
      ) {
        const upgraded: AgencyAutomationConfigRecord = {
          ...existing,
          titleRule: {
            ...normalized,
            minChars: DEFAULT_TITLE_AUTOMATION_RULE.minChars,
            maxChars: DEFAULT_TITLE_AUTOMATION_RULE.maxChars,
          },
          isCustomOverride: false,
          updatedAt: new Date().toISOString(),
        };
        PersistentStoreService.set(COL_AUTOMATION_CONFIGS, PLATFORM_DEFAULT_AUTOMATION_KEY, upgraded);
        return upgraded;
      }
      return {
        ...existing,
        titleRule: normalized,
        isCustomOverride: false,
      };
    }

    const seeded: AgencyAutomationConfigRecord = {
      id: "auto_platform_default",
      tenantId: PLATFORM_DEFAULT_AUTOMATION_KEY,
      titleRule: normalizeTitleAutomationRule(DEFAULT_TITLE_AUTOMATION_RULE),
      isCustomOverride: false,
      version: 1,
      updatedBy: "system",
      updatedAt: new Date().toISOString(),
    };
    return PersistentStoreService.seedDocumentIfMissing(
      COL_AUTOMATION_CONFIGS,
      PLATFORM_DEFAULT_AUTOMATION_KEY,
      seeded
    );
  }

  public static savePlatformDefaultTitleRule(
    rawRule: unknown,
    updatedBy: string
  ): AgencyAutomationConfigRecord {
    const existing = this.getPlatformDefaultRecord();
    const normalized = normalizeTitleAutomationRule(rawRule);
    const updated: AgencyAutomationConfigRecord = {
      id: "auto_platform_default",
      tenantId: PLATFORM_DEFAULT_AUTOMATION_KEY,
      titleRule: normalized,
      isCustomOverride: false,
      version: (existing.version || 1) + 1,
      updatedBy: updatedBy || "super_admin",
      updatedAt: new Date().toISOString(),
    };
    PersistentStoreService.set(COL_AUTOMATION_CONFIGS, PLATFORM_DEFAULT_AUTOMATION_KEY, updated);
    return updated;
  }

  public static resetPlatformDefaultTitleRule(updatedBy: string): AgencyAutomationConfigRecord {
    return this.savePlatformDefaultTitleRule(DEFAULT_TITLE_AUTOMATION_RULE, updatedBy);
  }

  public static getByTenantId(tenantId: string): AgencyAutomationConfigRecord {
    const existing = PersistentStoreService.get<AgencyAutomationConfigRecord>(
      COL_AUTOMATION_CONFIGS,
      tenantId
    );
    // Only return tenant-specific record if this agency explicitly customized & saved its own override
    if (existing && existing.titleRule && existing.isCustomOverride === true) {
      return {
        ...existing,
        titleRule: normalizeTitleAutomationRule(existing.titleRule),
        isCustomOverride: true,
      };
    }

    // Otherwise inherit live from the Super Admin platform default
    const platformDefault = this.getPlatformDefaultRecord();
    return {
      id: `auto_${tenantId}`,
      tenantId,
      titleRule: normalizeTitleAutomationRule(platformDefault.titleRule),
      isCustomOverride: false,
      version: platformDefault.version || 1,
      updatedBy: platformDefault.updatedBy,
      updatedAt: platformDefault.updatedAt,
    };
  }

  public static saveTitleRule(
    tenantId: string,
    rawRule: unknown,
    updatedBy: string
  ): AgencyAutomationConfigRecord {
    const existing = PersistentStoreService.get<AgencyAutomationConfigRecord>(
      COL_AUTOMATION_CONFIGS,
      tenantId
    );
    const normalized = normalizeTitleAutomationRule(rawRule);
    const updated: AgencyAutomationConfigRecord = {
      id: existing?.id || `auto_${tenantId}`,
      tenantId,
      titleRule: normalized,
      isCustomOverride: true,
      version: (existing?.version || 1) + 1,
      updatedBy: updatedBy || "agency_admin",
      updatedAt: new Date().toISOString(),
    };
    PersistentStoreService.set(COL_AUTOMATION_CONFIGS, tenantId, updated);
    return updated;
  }

  public static resetTitleRule(
    tenantId: string,
    updatedBy: string
  ): AgencyAutomationConfigRecord {
    const existing = PersistentStoreService.get<AgencyAutomationConfigRecord>(
      COL_AUTOMATION_CONFIGS,
      tenantId
    );
    const platformDefault = this.getPlatformDefaultRecord();
    const cleared: AgencyAutomationConfigRecord = {
      id: existing?.id || `auto_${tenantId}`,
      tenantId,
      titleRule: normalizeTitleAutomationRule(platformDefault.titleRule),
      isCustomOverride: false,
      version: (existing?.version || 1) + 1,
      updatedBy: updatedBy || "agency_admin",
      updatedAt: new Date().toISOString(),
    };
    PersistentStoreService.set(COL_AUTOMATION_CONFIGS, tenantId, cleared);
    return cleared;
  }
}

export type { TitleAutomationRule };
