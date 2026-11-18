import { VersionedInstructionRecord } from "./typ_ai-engine";
import { ValidationError, NotFoundError, ForbiddenError } from "../errors/app_error";

const INSTRUCTION_STORE = new Map<string, VersionedInstructionRecord>();

// Seed default platform instructions
INSTRUCTION_STORE.set("ins_default_titles", {
  id: "ins_default_titles",
  tenantId: null, // Global platform template
  category: "listing_titles",
  name: "Șablon Standard Titluri Imobiliare (AGENTS.md)",
  version: 1,
  content: "Tip imobil + număr camere/mp | Zonă | Pct. de interes | Pct forte imobil | Dotări | Parcare",
  isActive: true,
  createdBy: "system",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

INSTRUCTION_STORE.set("ins_default_desc", {
  id: "ins_default_desc",
  tenantId: null,
  category: "property_description",
  name: "Șablon Descriere Apartamente & Vile (AGENTS.md)",
  version: 1,
  content: "Structură pe secțiuni: AVANTAJE PRINCIPALE (-cu dash), DOTĂRI, LOCAȚIE, ÎNCHIRIERE/VÂNZARE, SUPORT AGENȚIE",
  isActive: true,
  createdBy: "system",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

export class AiInstructionService {
  public static listInstructions(tenantId: string): VersionedInstructionRecord[] {
    const list: VersionedInstructionRecord[] = [];
    for (const ins of INSTRUCTION_STORE.values()) {
      // Return platform defaults (tenantId === null) OR agency-specific instructions (ins.tenantId === tenantId)
      if (ins.tenantId === null || ins.tenantId === tenantId) {
        if (ins.isActive) {
          list.push({ ...ins });
        }
      }
    }
    return list;
  }

  public static getInstructionById(id: string, tenantId: string): VersionedInstructionRecord {
    const ins = INSTRUCTION_STORE.get(id);
    if (!ins) {
      throw new NotFoundError("Instrucțiunea AI", id);
    }

    if (ins.tenantId !== null && ins.tenantId !== tenantId) {
      throw new ForbiddenError("Acces interzis: Instrucțiunea aparține altei agenții imobiliare.");
    }

    return ins;
  }

  public static saveInstruction(
    data: {
      id?: string;
      tenantId: string;
      category: VersionedInstructionRecord["category"];
      name: string;
      content: string;
    },
    actorEmail: string
  ): VersionedInstructionRecord {
    if (!data.name || !data.content) {
      throw new ValidationError("Numele și conținutul instrucțiunii sunt obligatorii.");
    }

    // Safety checks against prompt injection
    const lower = data.content.toLowerCase();
    if (lower.includes("ignore platform security") || lower.includes("bypass tenant isolation")) {
      throw new ValidationError("Conținutul instrucțiunii conține comenzi nepermise de securitate.");
    }

    const existing = data.id ? INSTRUCTION_STORE.get(data.id) : null;
    const version = existing ? existing.version + 1 : 1;
    const id = data.id || `ins_${data.tenantId}_${Date.now()}`;

    const record: VersionedInstructionRecord = {
      id,
      tenantId: data.tenantId,
      category: data.category,
      name: data.name,
      version,
      content: data.content,
      isActive: true,
      createdBy: existing ? existing.createdBy : actorEmail,
      updatedAt: new Date().toISOString(),
    };

    INSTRUCTION_STORE.set(id, record);
    return record;
  }
}
