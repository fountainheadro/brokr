import { PlatformSettingsRecord } from "./typ_platform-admin";
import {
  getPlatformRootDomain,
  getPlatformAdminSubdomain,
  setPlatformRootDomain,
} from "../tenancy/svc_tenant-resolution";
import { PersistentStoreService } from "../database/svc_persistent-store";

const COL_PLATFORM_SETTINGS = "platform_settings";
const SETTINGS_DOC_ID = "plt_settings_main";

const DEFAULT_SETTINGS: PlatformSettingsRecord = {
  id: SETTINGS_DOC_ID,
  platformName: "OurCRM Real Estate Cloud",
  supportEmail: "support@brokr.ro",
  maintenanceMode: false,
  allowPublicRegistration: false,
  defaultTrialDurationDays: 14,
  configuredRootDomain: getPlatformRootDomain(),
  adminSubdomain: getPlatformAdminSubdomain(),
  enforceMfaForAdmins: true,
  updatedAt: "2026-01-01T00:00:00.000Z",
  updatedBy: "usr_super_admin",
};

function getOrSeedSettings(): PlatformSettingsRecord {
  return PersistentStoreService.seedDocumentIfMissing<PlatformSettingsRecord>(
    COL_PLATFORM_SETTINGS,
    SETTINGS_DOC_ID,
    {
      ...DEFAULT_SETTINGS,
      configuredRootDomain: getPlatformRootDomain(),
      adminSubdomain: getPlatformAdminSubdomain(),
    }
  );
}

export class PlatformSettingsService {
  public static getSettings(): PlatformSettingsRecord {
    const current = getOrSeedSettings();
    return {
      ...current,
      configuredRootDomain: getPlatformRootDomain(),
      adminSubdomain: getPlatformAdminSubdomain(),
    };
  }

  public static updateSettings(
    updates: Partial<Omit<PlatformSettingsRecord, "id" | "updatedAt">>,
    actorUserId: string
  ): PlatformSettingsRecord {
    if (updates.configuredRootDomain !== undefined) {
      setPlatformRootDomain(updates.configuredRootDomain);
    }

    const current = getOrSeedSettings();
    const updated: PlatformSettingsRecord = {
      ...current,
      ...updates,
      updatedAt: new Date().toISOString(),
      updatedBy: actorUserId,
    };

    PersistentStoreService.set(COL_PLATFORM_SETTINGS, SETTINGS_DOC_ID, updated);
    return this.getSettings();
  }
}
