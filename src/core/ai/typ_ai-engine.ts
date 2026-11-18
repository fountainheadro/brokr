import { ModuleId } from "../subscription/typ_subscription";

export type AiToneType = "professional" | "analytical" | "friendly" | "authoritative" | "concise";

export type AiLanguageType = "ro" | "en";

export interface AgencyAiPreferences {
  assistantName: string; // e.g. "Brokr AI Copilot", "Zenith Assistant"
  systemTone: AiToneType;
  language: AiLanguageType;
  customAgencyRules: string[]; // e.g. ["Nu promovam proprietati fara comision", "Focalizare pe zona de Nord"]
  titlePrefixEmoji?: string;
  autoExtractWatermarks: boolean;
  enabledCapabilities: {
    propertyExtraction: boolean;
    descriptionOptimization: boolean;
    matchingAnalysis: boolean;
    clientChat: boolean;
    crmAssistant: boolean;
  };
  contactSignature?: string;
}

export interface AgencyAiConfigRecord {
  id: string; // e.g. "aiconf_ten_brokr_default"
  tenantId: string;
  preferences: AgencyAiPreferences;
  version: number;
  updatedBy: string;
  updatedAt: string;
}

export interface AiChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    args: Record<string, any>;
  }>;
  tokenCount?: number;
  timestamp: string;
}

export interface AiConversationRecord {
  id: string; // e.g. "conv_ten_123_456"
  tenantId: string;
  userId: string;
  title: string;
  status: "active" | "archived" | "deleted";
  messages: AiChatMessage[];
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface AiToolDefinition {
  name: string;
  description: string;
  requiredModule?: ModuleId;
  requiredPermission?: string;
  parameters: {
    type: "OBJECT";
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
  execute: (args: Record<string, any>, context: { tenantId: string; userId: string; role: string }) => Promise<any>;
}

export interface AiOrchestrationRequest {
  tenantId: string;
  userId: string;
  userRole: string;
  conversationId?: string;
  prompt: string;
  operationType: "chat" | "property_extraction" | "description_generation" | "matching_analysis";
  featureModule?: ModuleId;
  contextData?: Record<string, any>;
  targetModel?: string;
  temperature?: number;
}

export interface AiOrchestrationResponse {
  conversationId: string;
  response: string;
  toolCallsExecuted: Array<{ toolName: string; args: any; result: any }>;
  tokensUsed: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  reservationId?: string;
  costEstimateEur: number;
  model: string;
}

export interface VersionedInstructionRecord {
  id: string;
  tenantId: string | null; // null = platform default
  category: "listing_titles" | "property_description" | "matching" | "client_qualification" | "security_rules";
  name: string;
  version: number;
  content: string;
  isActive: boolean;
  createdBy: string;
  updatedAt: string;
}
