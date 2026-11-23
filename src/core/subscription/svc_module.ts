import { ModuleDefinition, AddonDefinition, ModuleId } from "./typ_subscription";
import { PersistentStoreService } from "../database/svc_persistent-store";

const COL_PLATFORM_SETTINGS = "platform_settings";
const MODULE_CATALOG_DOC_ID = "module_catalogue";

interface PersistedModuleCatalogDoc {
  id: string;
  modules: Record<string, { isActive: boolean; canBePurchasedAsAddon: boolean }>;
  updatedAt: string;
}

/**
 * Built-in catalogue of application modules matching the existing CRM functionality.
 */
const MODULE_CATALOGUE = new Map<ModuleId, ModuleDefinition>([
  [
    "mod_leads",
    {
      id: "mod_leads",
      name: "Gestiune Lead-uri",
      description: "Captare, triere și calificare contacte, lead-uri noi și prospecte imobiliare.",
      category: "sales",
      isActive: true,
      canBePurchasedAsAddon: false,
    },
  ],
  [
    "mod_requests",
    {
      id: "mod_requests",
      name: "Cereri Cumpărători / Chiriași",
      description: "Gestiune cereri active clienți, bugete, preferințe de zone și alerte.",
      category: "sales",
      isActive: true,
      canBePurchasedAsAddon: false,
    },
  ],
  [
    "mod_properties",
    {
      id: "mod_properties",
      name: "Portofoliu Proprietăți",
      description: "Catalog complet apartamente, case, terenuri și spații comerciale cu galerii foto.",
      category: "core",
      isActive: true,
      canBePurchasedAsAddon: false,
    },
  ],
  [
    "mod_matching",
    {
      id: "mod_matching",
      name: "Corelare Automată (Matching)",
      description: "Algoritm inteligent de corelare bidirecțională între cererile clienților și proprietățile din portofoliu.",
      category: "sales",
      isActive: true,
      canBePurchasedAsAddon: true,
      dependencies: ["mod_leads", "mod_properties"],
    },
  ],
  [
    "mod_calendar",
    {
      id: "mod_calendar",
      name: "Calendar & Vizionări",
      description: "Planificare întâlniri, vizionări imobile, sincronizare orare și remindere agenți.",
      category: "core",
      isActive: true,
      canBePurchasedAsAddon: true,
    },
  ],
  [
    "mod_documents",
    {
      id: "mod_documents",
      name: "Documente & Contracte",
      description: "Generare fișe de vizionare, contracte de intermediere, acorduri GDPR și arhivă securizată.",
      category: "core",
      isActive: true,
      canBePurchasedAsAddon: true,
    },
  ],
  [
    "mod_public_share",
    {
      id: "mod_public_share",
      name: "Prezentare & Link-uri Publice",
      description: "Generare link-uri publice de prezentare pentru clienți (WhatsApp/SMS) cu OpenGraph și branding propriu.",
      category: "marketing",
      isActive: true,
      canBePurchasedAsAddon: false,
      dependencies: ["mod_properties"],
    },
  ],
  [
    "mod_ai_extraction",
    {
      id: "mod_ai_extraction",
      name: "Extragere Date Imobiliare cu AI",
      description: "Extracție automată caracteristici proprietăți, detalii tehnice și clasificare camere din link-uri externe via Gemini.",
      category: "ai",
      isActive: true,
      canBePurchasedAsAddon: true,
    },
  ],
  [
    "mod_ai_voice",
    {
      id: "mod_ai_voice",
      name: "Asistent Vocal & Apeluri AI",
      description: "Preluare apeluri telefonice, calificare automată a lead-urilor și notificare brokeri în timp real.",
      category: "ai",
      isActive: true,
      canBePurchasedAsAddon: true,
      dependencies: ["mod_leads"],
    },
  ],
]);

/**
 * Built-in catalogue of resource add-ons that agencies can purchase to extend quotas.
 */
const ADDON_CATALOGUE = new Map<string, AddonDefinition>([
  [
    "addon_agents_5",
    {
      id: "addon_agents_5",
      name: "Pachet +5 Brokeri / Agenți",
      description: "Mărește limita maximă de utilizatori cu 5 conturi active pentru agenți.",
      priceMonthly: 149,
      currency: "RON",
      isActive: true,
      quotaGrant: {
        maxAgents: 5,
      },
    },
  ],
  [
    "addon_properties_250",
    {
      id: "addon_properties_250",
      name: "Pachet +250 Proprietăți Active",
      description: "Extinde portofoliul de proprietăți gestionate cu 250 de oferte suplimentare.",
      priceMonthly: 199,
      currency: "RON",
      isActive: true,
      quotaGrant: {
        maxProperties: 250,
      },
    },
  ],
  [
    "addon_ai_tokens_500k",
    {
      id: "addon_ai_tokens_500k",
      name: "Pachet +500.000 Tokeni AI",
      description: "Alocare lunară adițională pentru extragerea de oferte, descrieri marketing și asistență AI.",
      priceMonthly: 99,
      currency: "RON",
      isActive: true,
      quotaGrant: {
        monthlyAiTokens: 500000,
        monthlyAiRequests: 500,
      },
    },
  ],
  [
    "addon_storage_50gb",
    {
      id: "addon_storage_50gb",
      name: "Pachet Stocare +50 GB",
      description: "Spațiu suplimentar în cloud pentru fotografii HD, schițe cadastrale și documente arhivate.",
      priceMonthly: 79,
      currency: "RON",
      isActive: true,
      quotaGrant: {
        storageMb: 50 * 1024,
      },
    },
  ],
]);

const DEFAULT_MODULES: ModuleDefinition[] = Array.from(MODULE_CATALOGUE.values()).map((m) => ({
  ...m,
}));
let lastModulesHydratedAt = 0;

export class ModuleCatalogService {
  public static resetHydrationCache(): void {
    lastModulesHydratedAt = 0;
    MODULE_CATALOGUE.clear();
    for (const m of DEFAULT_MODULES) {
      MODULE_CATALOGUE.set(m.id, { ...m });
    }
  }

  public static async hydrateFromFirestore(ttlMs = 30_000): Promise<void> {
    if (!PersistentStoreService.isRemoteFirestoreConfigured()) return;
    if (Date.now() - lastModulesHydratedAt < ttlMs) return;

    try {
      const remote = await PersistentStoreService.remoteGet<PersistedModuleCatalogDoc>(
        COL_PLATFORM_SETTINGS,
        MODULE_CATALOG_DOC_ID
      );
      if (remote && remote.modules && typeof remote.modules === "object") {
        for (const [id, override] of Object.entries(remote.modules)) {
          const existing = MODULE_CATALOGUE.get(id as ModuleId);
          if (existing && override && typeof override === "object") {
            MODULE_CATALOGUE.set(id as ModuleId, {
              ...existing,
              isActive: typeof override.isActive === "boolean" ? override.isActive : existing.isActive,
              canBePurchasedAsAddon:
                typeof override.canBePurchasedAsAddon === "boolean"
                  ? override.canBePurchasedAsAddon
                  : existing.canBePurchasedAsAddon,
            });
          }
        }
      }
      lastModulesHydratedAt = Date.now();
    } catch {
      // Non-fatal if doc does not exist yet
    }
  }

  public static getAllModules(): ModuleDefinition[] {
    return Array.from(MODULE_CATALOGUE.values());
  }

  public static getModuleById(id: ModuleId): ModuleDefinition | undefined {
    return MODULE_CATALOGUE.get(id);
  }

  public static getAllAddons(): AddonDefinition[] {
    return Array.from(ADDON_CATALOGUE.values());
  }

  public static getAddonById(id: string): AddonDefinition | undefined {
    return ADDON_CATALOGUE.get(id);
  }

  public static updateModuleStatus(
    id: ModuleId,
    isActive: boolean,
    canBePurchasedAsAddon?: boolean
  ): ModuleDefinition {
    const existing = MODULE_CATALOGUE.get(id);
    if (!existing) {
      throw new Error(`Modulul ${id} nu a fost găsit în catalog.`);
    }

    const updated: ModuleDefinition = {
      ...existing,
      isActive,
      canBePurchasedAsAddon:
        canBePurchasedAsAddon !== undefined
          ? canBePurchasedAsAddon
          : existing.canBePurchasedAsAddon,
    };

    MODULE_CATALOGUE.set(id, updated);
    return updated;
  }

  public static async updateModuleStatusAsync(
    id: ModuleId,
    isActive: boolean,
    canBePurchasedAsAddon?: boolean
  ): Promise<ModuleDefinition> {
    await this.hydrateFromFirestore();
    const updated = this.updateModuleStatus(id, isActive, canBePurchasedAsAddon);

    const snapshot: Record<string, { isActive: boolean; canBePurchasedAsAddon: boolean }> = {};
    for (const mod of MODULE_CATALOGUE.values()) {
      snapshot[mod.id] = {
        isActive: mod.isActive,
        canBePurchasedAsAddon: mod.canBePurchasedAsAddon,
      };
    }

    if (process.env.NODE_ENV !== "test" || PersistentStoreService.isRemoteFirestoreConfigured()) {
      await PersistentStoreService.setAsync<PersistedModuleCatalogDoc>(
        COL_PLATFORM_SETTINGS,
        MODULE_CATALOG_DOC_ID,
        {
          id: MODULE_CATALOG_DOC_ID,
          modules: snapshot,
          updatedAt: new Date().toISOString(),
        }
      );
      lastModulesHydratedAt = Date.now();
    }

    return updated;
  }
}
