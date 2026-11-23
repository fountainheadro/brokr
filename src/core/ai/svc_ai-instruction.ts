import { VersionedInstructionRecord } from "./typ_ai-engine";
import { ValidationError, NotFoundError, ForbiddenError } from "../errors/app_error";
import { PersistentStoreService } from "../database/svc_persistent-store";

const DEFAULT_PLATFORM_INSTRUCTIONS: VersionedInstructionRecord[] = [
  {
    id: "ins_default_titles",
    tenantId: null, // Global platform template
    category: "listing_titles",
    name: "Șablon Standard Titluri Imobiliare (AGENTS.md)",
    version: 1,
    content: "Tip imobil + număr camere/mp | Zonă | Pct. de interes | Pct forte imobil | Dotări | Parcare",
    isActive: true,
    createdBy: "system",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "ins_default_desc",
    tenantId: null,
    category: "property_description",
    name: "Șablon Descriere Apartamente & Vile (AGENTS.md)",
    version: 1,
    content: "Structură pe secțiuni: AVANTAJE PRINCIPALE (-cu dash), DOTĂRI, LOCAȚIE, ÎNCHIRIERE/VÂNZARE, SUPORT AGENȚIE",
    isActive: true,
    createdBy: "system",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

const INSTRUCTION_STORE = new Map<string, VersionedInstructionRecord>();
const hydratedTenantsAt = new Map<string, number>();

function seedPlatformDefaults(): void {
  for (const ins of DEFAULT_PLATFORM_INSTRUCTIONS) {
    if (!INSTRUCTION_STORE.has(ins.id)) {
      INSTRUCTION_STORE.set(ins.id, { ...ins });
    }
  }
}
seedPlatformDefaults();

interface PersistedTenantInstructionsDoc {
  tenantId: string;
  items: VersionedInstructionRecord[];
  updatedAt: string;
}

function tenantInstructionsDocPath(tenantId: string): string {
  return `tenants/${tenantId}/settings/ai_instructions`;
}

export class AiInstructionService {
  public static resetHydrationCache(): void {
    hydratedTenantsAt.clear();
    INSTRUCTION_STORE.clear();
    seedPlatformDefaults();
  }

  public static async hydrateTenantInstructionsAsync(
    tenantId: string,
    ttlMs = 30_000
  ): Promise<void> {
    if (!tenantId || !PersistentStoreService.isRemoteFirestoreConfigured()) return;
    const lastAt = hydratedTenantsAt.get(tenantId) || 0;
    if (Date.now() - lastAt < ttlMs) return;

    try {
      const remote = await PersistentStoreService.remoteGetAtPath<PersistedTenantInstructionsDoc>(
        tenantInstructionsDocPath(tenantId),
        { silentOnStatuses: [403] }
      );
      if (remote && Array.isArray(remote.items)) {
        for (const item of remote.items) {
          if (item && item.id && item.tenantId === tenantId) {
            INSTRUCTION_STORE.set(item.id, item);
          }
        }
      }
      hydratedTenantsAt.set(tenantId, Date.now());
    } catch {
      // Non-fatal if doc does not exist yet
    }
  }

  public static listInstructions(tenantId: string): VersionedInstructionRecord[] {
    seedPlatformDefaults();
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

  public static async listInstructionsAsync(
    tenantId: string
  ): Promise<VersionedInstructionRecord[]> {
    await this.hydrateTenantInstructionsAsync(tenantId);
    return this.listInstructions(tenantId);
  }

  public static getInstructionById(id: string, tenantId: string): VersionedInstructionRecord {
    seedPlatformDefaults();
    const ins = INSTRUCTION_STORE.get(id);
    if (!ins) {
      throw new NotFoundError("Instrucțiunea AI", id);
    }

    if (ins.tenantId !== null && ins.tenantId !== tenantId) {
      throw new ForbiddenError("Acces interzis: Instrucțiunea aparține altei agenții imobiliare.");
    }

    return ins;
  }

  private static buildRecord(
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
    if (existing && existing.tenantId !== null && existing.tenantId !== data.tenantId) {
      throw new ForbiddenError("Acces interzis: Instrucțiunea aparține altei agenții imobiliare.");
    }

    const version = existing ? existing.version + 1 : 1;
    const id = data.id || `ins_${data.tenantId}_${Date.now()}`;

    return {
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
    const record = this.buildRecord(data, actorEmail);
    INSTRUCTION_STORE.set(record.id, record);
    return record;
  }

  public static async saveInstructionAsync(
    data: {
      id?: string;
      tenantId: string;
      category: VersionedInstructionRecord["category"];
      name: string;
      content: string;
    },
    actorEmail: string
  ): Promise<VersionedInstructionRecord> {
    await this.hydrateTenantInstructionsAsync(data.tenantId);
    const record = this.buildRecord(data, actorEmail);

    const tenantItems: VersionedInstructionRecord[] = [];
    for (const ins of INSTRUCTION_STORE.values()) {
      if (ins.tenantId === data.tenantId && ins.id !== record.id) {
        tenantItems.push(ins);
      }
    }
    tenantItems.push(record);

    if (process.env.NODE_ENV !== "test" || PersistentStoreService.isRemoteFirestoreConfigured()) {
      const payload: PersistedTenantInstructionsDoc = {
        tenantId: data.tenantId,
        items: tenantItems,
        updatedAt: record.updatedAt,
      };
      await PersistentStoreService.remoteSetAtPath(
        tenantInstructionsDocPath(data.tenantId),
        payload
      );
      hydratedTenantsAt.set(data.tenantId, Date.now());
    }

    INSTRUCTION_STORE.set(record.id, record);
    return record;
  }
}
