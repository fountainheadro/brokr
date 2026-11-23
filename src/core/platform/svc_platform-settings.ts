import { PlatformSettingsRecord } from "./typ_platform-admin";
import {
  getPlatformRootDomain,
  getPlatformAdminSubdomain,
  setPlatformRootDomain,
  setPlatformAdminSubdomain,
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
      configuredRootDomain: current.configuredRootDomain ?? getPlatformRootDomain(),
      adminSubdomain: current.adminSubdomain || getPlatformAdminSubdomain(),
    };
  }

  public static async getSettingsAsync(): Promise<PlatformSettingsRecord> {
    if (process.env.NODE_ENV !== "test" && PersistentStoreService.isRemoteFirestoreConfigured()) {
      try {
        const remote = await PersistentStoreService.remoteGet<PlatformSettingsRecord>(
          COL_PLATFORM_SETTINGS,
          SETTINGS_DOC_ID
        );
        if (remote) {
          PersistentStoreService.setCacheOnly(COL_PLATFORM_SETTINGS, SETTINGS_DOC_ID, remote);
          if (remote.configuredRootDomain !== undefined) {
            setPlatformRootDomain(remote.configuredRootDomain);
          }
          if (remote.adminSubdomain) {
            setPlatformAdminSubdomain(remote.adminSubdomain);
          }
          return remote;
        }
      } catch {
        // Fallback to cached default if absent
      }
    }
    return this.getSettings();
  }

  public static updateSettings(
    updates: Partial<Omit<PlatformSettingsRecord, "id" | "updatedAt">>,
    actorUserId: string
  ): PlatformSettingsRecord {
    if (updates.configuredRootDomain !== undefined) {
      setPlatformRootDomain(updates.configuredRootDomain);
    }
    if (updates.adminSubdomain) {
      setPlatformAdminSubdomain(updates.adminSubdomain);
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

  public static async updateSettingsAsync(
    updates: Partial<Omit<PlatformSettingsRecord, "id" | "updatedAt">>,
    actorUserId: string
  ): Promise<PlatformSettingsRecord> {
    if (updates.configuredRootDomain !== undefined) {
      setPlatformRootDomain(updates.configuredRootDomain);
    }
    if (updates.adminSubdomain) {
      setPlatformAdminSubdomain(updates.adminSubdomain);
    }

    const current = await this.getSettingsAsync();
    const updated: PlatformSettingsRecord = {
      ...current,
      ...updates,
      id: SETTINGS_DOC_ID,
      updatedAt: new Date().toISOString(),
      updatedBy: actorUserId,
    };

    await PersistentStoreService.setAsync(COL_PLATFORM_SETTINGS, SETTINGS_DOC_ID, updated);
    return updated;
  }
}
