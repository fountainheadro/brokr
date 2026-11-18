import { ModuleId } from "../packages/pkg_types/src";

export interface ModuleDefinition {
  id: ModuleId;
  name: string;
  description: string;
  required_dependencies: ModuleId[];
}

export const MODULE_CATALOG: Record<ModuleId, ModuleDefinition> = {
  mod_leads: {
    id: "mod_leads",
    name: "Lead-uri Imobiliare",
    description: "Preluare și calificare oportunități din piață",
    required_dependencies: [],
  },
  mod_requests: {
    id: "mod_requests",
    name: "Cereri Clienți",
    description: "Gestiune cereri active cumpărători și chiriași",
    required_dependencies: [],
  },
  mod_properties: {
    id: "mod_properties",
    name: "Portofoliu Proprietăți",
    description: "Listări imobile, caracteristici, galerie foto și share public",
    required_dependencies: [],
  },
  mod_matching: {
    id: "mod_matching",
    name: "Potrivire Automată",
    description: "Corelare automată între cererile clienților și proprietățile din portofoliu",
    required_dependencies: ["mod_requests", "mod_properties"],
  },
  mod_calendar: {
    id: "mod_calendar",
    name: "Agendă & Vizionări",
    description: "Programare vizionări, tururi și activități ale echipei",
    required_dependencies: ["mod_properties"],
  },
  mod_documents: {
    id: "mod_documents",
    name: "Seif Documente",
    description: "Stocare securizată contracte, acte de proprietate și schițe",
    required_dependencies: ["mod_properties"],
  },
  mod_ai_extraction: {
    id: "mod_ai_extraction",
    name: "Extracție & Ingestionare AI",
    description: "Preluare automată anunțuri prin URL și deparazitare watermark",
    required_dependencies: ["mod_properties"],
  },
  mod_ai_voice: {
    id: "mod_ai_voice",
    name: "Apeluri Vocale AI (Twilio + Gemini)",
    description: "Asistent telefonic vocal pentru calificare automată",
    required_dependencies: ["mod_leads", "mod_ai_extraction"],
  },
  mod_public_share: {
    id: "mod_public_share",
    name: "Prezentări Publice & OpenGraph",
    description: "Linkuri personalizate de prezentare pentru clienți și WhatsApp",
    required_dependencies: ["mod_properties"],
  },
};

export class ModuleDependencyEngine {
  public static validate_entitlement(
    target_module: ModuleId,
    active_modules: ModuleId[]
  ): { is_allowed: boolean; missing_dependencies: ModuleId[] } {
    if (!active_modules.includes(target_module)) {
      return { is_allowed: false, missing_dependencies: [] };
    }

    const definition = MODULE_CATALOG[target_module];
    const missing_dependencies = definition.required_dependencies.filter(
      (dep) => !active_modules.includes(dep)
    );

    return {
      is_allowed: missing_dependencies.length === 0,
      missing_dependencies,
    };
  }
}
