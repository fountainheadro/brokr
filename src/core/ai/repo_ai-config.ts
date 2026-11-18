import { AgencyAiConfigRecord, AgencyAiPreferences } from "./typ_ai-engine";
import { PersistentStoreService } from "../database/svc_persistent-store";

const COL_AI_CONFIGS = "ai_configs";

export const DEFAULT_PLATFORM_AI_PREFERENCES: AgencyAiPreferences = {
  assistantName: "Asistent Imobiliar AI",
  systemTone: "professional",
  language: "ro",
  customAgencyRules: [],
  autoExtractWatermarks: true,
  enabledCapabilities: {
    propertyExtraction: true,
    descriptionOptimization: true,
    matchingAnalysis: true,
    clientChat: true,
    crmAssistant: true,
  },
  contactSignature: "Echipa de consultanță imobiliară",
};

const SEED_CONFIGS: AgencyAiConfigRecord[] = [
  {
    id: "aiconf_ten_brokr_default",
    tenantId: "ten_brokr_default",
    preferences: {
      assistantName: "brokr. AI Copilot",
      systemTone: "analytical",
      language: "ro",
      customAgencyRules: [
        "Focalizare pe imobile premium și investiții cu randament dovedit",
        "Evidențierea facilităților de transport public și metrou în primele 2 paragrafe",
      ],
      titlePrefixEmoji: "🏡",
      autoExtractWatermarks: true,
      enabledCapabilities: {
        propertyExtraction: true,
        descriptionOptimization: true,
        matchingAnalysis: true,
        clientChat: true,
        crmAssistant: true,
      },
      contactSignature: "Consultanță dedicată din partea agenției brokr.",
    },
    version: 1,
    updatedBy: "usr_super_admin",
    updatedAt: "2026-02-01T00:00:00.000Z",
  },
  {
    id: "aiconf_ten_agency_a",
    tenantId: "ten_agency_a",
    preferences: {
      assistantName: "Alpha Realty Assistant",
      systemTone: "friendly",
      language: "ro",
      customAgencyRules: [
        "Orientare către familii și spații generoase cu terasă sau grădină",
      ],
      autoExtractWatermarks: true,
      enabledCapabilities: {
        propertyExtraction: true,
        descriptionOptimization: true,
        matchingAnalysis: true,
        clientChat: true,
        crmAssistant: true,
      },
      contactSignature: "Alpha Realty - Căminul tău ideal.",
    },
    version: 1,
    updatedBy: "usr_owner_a",
    updatedAt: "2026-02-10T00:00:00.000Z",
  },
];

function ensureConfigsSeeded(): void {
  const existing = PersistentStoreService.getAll<AgencyAiConfigRecord>(COL_AI_CONFIGS);
  if (Object.keys(existing).length === 0) {
    for (const seed of SEED_CONFIGS) {
      PersistentStoreService.set(COL_AI_CONFIGS, seed.tenantId, { ...seed });
    }
  }
}

export class AiConfigRepository {
  public static getByTenantId(tenantId: string): AgencyAiConfigRecord | null {
    ensureConfigsSeeded();
    return PersistentStoreService.get<AgencyAiConfigRecord>(COL_AI_CONFIGS, tenantId);
  }

  public static save(config: AgencyAiConfigRecord): AgencyAiConfigRecord {
    ensureConfigsSeeded();
    const copy = { ...config };
    PersistentStoreService.set(COL_AI_CONFIGS, config.tenantId, copy);
    return copy;
  }

  public static resetDefaults(): void {
    PersistentStoreService.clearCollection(COL_AI_CONFIGS);
    PersistentStoreService.set(COL_AI_CONFIGS, SEED_CONFIGS[0].tenantId, { ...SEED_CONFIGS[0] });
  }
}
