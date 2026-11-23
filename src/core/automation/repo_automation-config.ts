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
    if (existing && existing.titleRule) {
      return {
        ...existing,
        titleRule: normalizeTitleAutomationRule(existing.titleRule),
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

  public static async getPlatformDefaultRecordAsync(): Promise<AgencyAutomationConfigRecord> {
    if (process.env.NODE_ENV !== "test" && PersistentStoreService.isRemoteFirestoreConfigured()) {
      try {
        const remote = await PersistentStoreService.remoteGet<AgencyAutomationConfigRecord>(
          COL_AUTOMATION_CONFIGS,
          PLATFORM_DEFAULT_AUTOMATION_KEY
        );
        if (remote && remote.titleRule) {
          const normalized: AgencyAutomationConfigRecord = {
            ...remote,
            titleRule: normalizeTitleAutomationRule(remote.titleRule),
            isCustomOverride: false,
          };
          PersistentStoreService.setCacheOnly(
            COL_AUTOMATION_CONFIGS,
            PLATFORM_DEFAULT_AUTOMATION_KEY,
            normalized
          );
          return normalized;
        }
      } catch {
        // Fallback to default seed
      }
    }
    return this.getPlatformDefaultRecord();
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

  public static async savePlatformDefaultTitleRuleAsync(
    rawRule: unknown,
    updatedBy: string
  ): Promise<AgencyAutomationConfigRecord> {
    const existing = await this.getPlatformDefaultRecordAsync();
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
    await PersistentStoreService.setAsync(
      COL_AUTOMATION_CONFIGS,
      PLATFORM_DEFAULT_AUTOMATION_KEY,
      updated
    );
    return updated;
  }

  public static resetPlatformDefaultTitleRule(updatedBy: string): AgencyAutomationConfigRecord {
    return this.savePlatformDefaultTitleRule(DEFAULT_TITLE_AUTOMATION_RULE, updatedBy);
  }

  public static async resetPlatformDefaultTitleRuleAsync(
    updatedBy: string
  ): Promise<AgencyAutomationConfigRecord> {
    return this.savePlatformDefaultTitleRuleAsync(DEFAULT_TITLE_AUTOMATION_RULE, updatedBy);
  }

  public static getByTenantId(tenantId: string): AgencyAutomationConfigRecord {
    const existing = PersistentStoreService.get<AgencyAutomationConfigRecord>(
      COL_AUTOMATION_CONFIGS,
      tenantId
    );
    if (existing && existing.titleRule && existing.isCustomOverride === true) {
      return {
        ...existing,
        titleRule: normalizeTitleAutomationRule(existing.titleRule),
        isCustomOverride: true,
      };
    }

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

  public static async getByTenantIdAsync(tenantId: string): Promise<AgencyAutomationConfigRecord> {
    if (process.env.NODE_ENV !== "test" && PersistentStoreService.isRemoteFirestoreConfigured()) {
      try {
        const remote = await PersistentStoreService.remoteGet<AgencyAutomationConfigRecord>(
          COL_AUTOMATION_CONFIGS,
          tenantId
        );
        if (remote && remote.titleRule) {
          PersistentStoreService.setCacheOnly(COL_AUTOMATION_CONFIGS, tenantId, remote);
          if (remote.isCustomOverride === true) {
            return {
              ...remote,
              titleRule: normalizeTitleAutomationRule(remote.titleRule),
              isCustomOverride: true,
            };
          }
        }
      } catch {
        // Ignore if not yet created
      }
      const platformDefault = await this.getPlatformDefaultRecordAsync();
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
    return this.getByTenantId(tenantId);
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

  public static async saveTitleRuleAsync(
    tenantId: string,
    rawRule: unknown,
    updatedBy: string
  ): Promise<AgencyAutomationConfigRecord> {
    const existing = await this.getByTenantIdAsync(tenantId);
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
    await PersistentStoreService.setAsync(COL_AUTOMATION_CONFIGS, tenantId, updated);
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

  public static async resetTitleRuleAsync(
    tenantId: string,
    updatedBy: string
  ): Promise<AgencyAutomationConfigRecord> {
    const existing = await this.getByTenantIdAsync(tenantId);
    const platformDefault = await this.getPlatformDefaultRecordAsync();
    const cleared: AgencyAutomationConfigRecord = {
      id: existing?.id || `auto_${tenantId}`,
      tenantId,
      titleRule: normalizeTitleAutomationRule(platformDefault.titleRule),
      isCustomOverride: false,
      version: (existing?.version || 1) + 1,
      updatedBy: updatedBy || "agency_admin",
      updatedAt: new Date().toISOString(),
    };
    await PersistentStoreService.setAsync(COL_AUTOMATION_CONFIGS, tenantId, cleared);
    return cleared;
  }
}

export type { TitleAutomationRule };
