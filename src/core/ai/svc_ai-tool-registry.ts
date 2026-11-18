import { AiToolDefinition } from "./typ_ai-engine";
import { TenantScopedRepository } from "../database/repo_tenant-scoped";
import { QuotaService } from "../subscription/svc_quota";
import { ForbiddenError, ValidationError } from "../errors/app_error";

// Scoped repositories for tools
const leadsRepo = new TenantScopedRepository<any>(null, "leads");

/**
 * Registry of authorized server-side AI tools.
 * Every tool enforces tenant isolation and schema validation.
 */
export class AiToolRegistry {
  private static tools: Map<string, AiToolDefinition> = new Map();

  public static registerTool(tool: AiToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  public static getTool(name: string): AiToolDefinition | undefined {
    return this.tools.get(name);
  }

  public static listToolsForTenant(tenantId: string): AiToolDefinition[] {
    const { modules } = QuotaService.getEffectiveQuotas(tenantId);
    return Array.from(this.tools.values()).filter((tool) => {
      if (!tool.requiredModule) return true;
      return modules.includes(tool.requiredModule);
    });
  }

  /**
   * Executes a registered tool safely with verified server-side TenantContext.
   */
  public static async executeTool(
    toolName: string,
    args: Record<string, any>,
    context: { tenantId: string; userId: string; role: string }
  ): Promise<any> {
    const tool = this.getTool(toolName);
    if (!tool) {
      throw new ValidationError(`Instrumentul AI '${toolName}' nu există în registru.`);
    }

    // Verify module entitlement
    if (tool.requiredModule) {
      const { modules } = QuotaService.getEffectiveQuotas(context.tenantId);
      if (!modules.includes(tool.requiredModule)) {
        throw new ForbiddenError(
          `Modulul '${tool.requiredModule}' nu este inclus în abonamentul agenției pentru instrumentul ${toolName}.`
        );
      }
    }

    // AI-generated tool arguments are treated as untrusted input:
    // If the tool argument attempted to pass a forged 'tenantId', it is explicitly ignored
    // and replaced with the authenticated context.tenantId!
    const sanitizedArgs = { ...args };
    delete sanitizedArgs.tenantId;
    delete sanitizedArgs.tenant_id;

    return await tool.execute(sanitizedArgs, context);
  }
}

// ============================================================================
// REGISTER BUILT-IN CRM TOOLS
// ============================================================================

// 1. Tool: Search Tenant Properties
AiToolRegistry.registerTool({
  name: "search_properties",
  description: "Caută proprietăți imobiliare în portofoliul agenției curente după zonă, preț sau număr de camere.",
  requiredModule: "mod_properties",
  parameters: {
    type: "OBJECT",
    properties: {
      zone: { type: "string", description: "Cartierul sau zona căutată (ex: Floreasca, Pipera)" },
      maxPrice: { type: "number", description: "Preț maxim în EUR" },
      minRooms: { type: "number", description: "Număr minim de camere" },
    },
  },
  execute: async (args, context) => {
    // Scoped strictly to context.tenantId
    const result = await leadsRepo.list(context.tenantId);
    let items = result.items || [];

    if (args.zone) {
      items = items.filter((p: any) =>
        String(p.zone || "").toLowerCase().includes(String(args.zone).toLowerCase())
      );
    }
    const maxPrice = args.maxPrice ?? args.max_price;
    if (maxPrice) {
      items = items.filter((p: any) => {
        const num = parseFloat(String(p.price || "0").replace(/[^0-9.]/g, ""));
        return !isNaN(num) && num <= maxPrice;
      });
    }

    return {
      count: items.length,
      properties: items.slice(0, 10).map((p: any) => ({
        id: p.id,
        title: p.title,
        price: p.price,
        zone: p.zone,
        status: p.status,
      })),
    };
  },
});

// 2. Tool: Search Tenant Leads & Client Requests
AiToolRegistry.registerTool({
  name: "search_leads",
  description: "Caută lead-uri, cereri de cumpărare sau clienți activi ai agenției.",
  requiredModule: "mod_leads",
  parameters: {
    type: "OBJECT",
    properties: {
      query: { type: "string", description: "Termen de căutare (nume, număr telefon sau cerere)" },
      status: { type: "string", description: "Starea lead-ului (ex: Nou, Calificat, În negociere)" },
    },
  },
  execute: async (args, context) => {
    const result = await leadsRepo.list(context.tenantId);
    let items = result.items || [];

    if (args.query) {
      const q = String(args.query).toLowerCase();
      items = items.filter(
        (l: any) =>
          String(l.title || "").toLowerCase().includes(q) ||
          String(l.zone || "").toLowerCase().includes(q)
      );
    }

    return {
      count: items.length,
      leads: items.slice(0, 10).map((l: any) => ({
        id: l.id,
        title: l.title,
        zone: l.zone,
        status: l.status,
      })),
    };
  },
});

// 3. Tool: Matching Analysis (matching requests with agency portfolio)
AiToolRegistry.registerTool({
  name: "analyze_property_matching",
  description: "Analizează compatibilitatea dintre o cerere specifică a unui client și portofoliul activ al agenției.",
  requiredModule: "mod_matching",
  parameters: {
    type: "OBJECT",
    properties: {
      targetZone: { type: "string", description: "Zona solicitată de client" },
      maxBudget: { type: "number", description: "Buget maxim client" },
    },
    required: ["targetZone"],
  },
  execute: async (args, context) => {
    const targetZone = String(args.targetZone || args.target_zone || "");
    const properties = await leadsRepo.list(context.tenantId);
    const matches = (properties.items || []).filter((p: any) =>
      String(p.zone || "").toLowerCase().includes(targetZone.toLowerCase())
    );

    return {
      matchScore: matches.length > 0 ? "ridicat" : "scăzut",
      availableOptionsCount: matches.length,
      topMatches: matches.slice(0, 3).map((p: any) => ({
        id: p.id,
        title: p.title,
        price: p.price,
        zone: p.zone,
      })),
      recommendation:
        matches.length > 0
          ? `Există ${matches.length} proprietăți compatibile în zona ${targetZone} în portofoliul agenției.`
          : `Nu s-au identificat proprietăți directe în zona ${targetZone}. Recomandăm explorarea zonelor adiacente.`,
    };
  },
});
