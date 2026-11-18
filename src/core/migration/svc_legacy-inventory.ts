import fs from "fs";
import path from "path";
import axios from "axios";
import { PersistentStoreService } from "../database/svc_persistent-store";
import { LegacyCollectionInventoryItem } from "./typ_migration-report";

interface InventoryBlueprint {
  collectionName: string;
  expectedDestination: string;
  entityTypes: string[];
  relatedEntities: string[];
  readers: string[];
  writers: string[];
  cutoverStatus: LegacyCollectionInventoryItem["cutoverStatus"];
  notes?: string;
}

/**
 * Exhaustive, code-verified inventory of all Firestore root collections used by the CRM.
 * NOTE: There are no separate "properties" or "requests" root collections;
 * both properties (P*) and client requests (R*) alongside leads (L*) are stored in /leads.
 */
export const LEGACY_COLLECTION_BLUEPRINTS: InventoryBlueprint[] = [
  {
    collectionName: "leads",
    expectedDestination: "/tenants/{tenantId}/leads",
    entityTypes: ["Lead (L*)", "Property (P*)", "Request (R*)"],
    relatedEntities: ["contacts", "documents", "activities", "tours", "viewings"],
    readers: [
      "src/services/leadsService.ts",
      "src/services/leadService.ts",
      "src/services/entityIdService.ts",
      "server.ts (fetchPropertyById / /api/public-property/:id / /api/og-image/:id)",
    ],
    writers: [
      "src/services/leadsService.ts (addLead, updateLead, deleteLead)",
      "src/services/leadService.ts (leadService, propertyService, requestService)",
    ],
    cutoverStatus: "legacy_root_active",
    notes:
      "Colecție centrală unificată; distincția Cerere (R*) vs Imobil (P*) vs Lead (L*) se face prin isCerereLead() și prefixul propertyId.",
  },
  {
    collectionName: "contacts",
    expectedDestination: "/tenants/{tenantId}/contacts",
    entityTypes: ["Contact / Client (C*)"],
    relatedEntities: ["leads (propertyId)", "documents (clientId)", "activities (clientId)", "viewings (contactId)"],
    readers: [
      "src/services/contactsService.ts",
      "src/services/clientService.ts",
      "src/services/entityIdService.ts",
    ],
    writers: [
      "src/services/contactsService.ts (addContact, updateContact, deleteContact)",
    ],
    cutoverStatus: "legacy_root_active",
  },
  {
    collectionName: "personal",
    expectedDestination: "/tenants/{tenantId}/personal",
    entityTypes: ["Staff / Agency Member Profile (S*)"],
    relatedEntities: ["documents (staffId)", "activities (staffId)"],
    readers: [
      "src/services/personalService.ts",
      "src/services/staffService.ts",
      "src/services/entityIdService.ts",
    ],
    writers: [
      "src/services/personalService.ts (addPersonal, updatePersonal, deletePersonal)",
    ],
    cutoverStatus: "legacy_root_active",
  },
  {
    collectionName: "documents",
    expectedDestination: "/tenants/{tenantId}/documents",
    entityTypes: ["Document (D*)"],
    relatedEntities: ["leads (propertyId/leadId)", "contacts (clientId)", "personal (staffId)", "uploads/GCS (fileUrl)"],
    readers: [
      "src/services/documentService.ts",
      "src/services/entityIdService.ts",
    ],
    writers: [
      "src/services/documentService.ts (addDocument, updateDocument, deleteDocument)",
    ],
    cutoverStatus: "legacy_root_active",
    notes: "Conține câmpul fileUrl care referențiază fișiere stocate sau linkuri externe.",
  },
  {
    collectionName: "activities",
    expectedDestination: "/tenants/{tenantId}/activities",
    entityTypes: ["Activity / Tour / Viewing (A*)"],
    relatedEntities: ["leads (propertyId)", "contacts (clientId)", "personal (staffId)", "tours", "viewings"],
    readers: [
      "src/services/activityService.ts",
      "src/services/tourService.ts",
      "src/services/entityIdService.ts",
    ],
    writers: [
      "src/services/activityService.ts (dual-write și către tours/viewings când type === Vizionare)",
    ],
    cutoverStatus: "legacy_root_active",
  },
  {
    collectionName: "tours",
    expectedDestination: "/tenants/{tenantId}/tours",
    entityTypes: ["Tour Mirror"],
    relatedEntities: ["activities", "leads (propertyId)", "contacts (clientId)", "personal (staffId)"],
    readers: ["src/services/entityIdService.ts"],
    writers: ["src/services/activityService.ts (mirror write on Vizionare)"],
    cutoverStatus: "legacy_root_active",
  },
  {
    collectionName: "viewings",
    expectedDestination: "/tenants/{tenantId}/viewings",
    entityTypes: ["Viewing (Calendar / Background Reminders)"],
    relatedEntities: ["leads (propertyId)", "contacts (contactId)", "activities"],
    readers: [
      "src/services/viewingsService.ts",
      "server/background-notifications.ts (REST read + /tmp/brokr-background-cache.json)",
    ],
    writers: [
      "src/services/viewingsService.ts",
      "src/services/activityService.ts (mirror write)",
      "server/background-notifications.ts (reminderSent)",
    ],
    cutoverStatus: "legacy_root_active",
    notes: "Necesită atenție specială la cutover pentru notificările background.",
  },
  {
    collectionName: "counters",
    expectedDestination: "/tenants/{tenantId}/counters",
    entityTypes: ["Sequential Entity ID Counter (entities)"],
    relatedEntities: ["leads", "contacts", "personal", "documents", "activities"],
    readers: ["src/services/entityIdService.ts (doc counters/entities)"],
    writers: ["src/services/entityIdService.ts (runTransaction increment)"],
    cutoverStatus: "legacy_root_active",
    notes: "Fiecare tenant nou va trebui să aibă propriul contor izolat /tenants/{tenantId}/counters/entities.",
  },
  {
    collectionName: "notifications",
    expectedDestination: "/tenants/{tenantId}/notifications",
    entityTypes: ["User In-App Notification"],
    relatedEntities: ["viewings", "leads"],
    readers: ["src/services/notificationsService.ts (scoped by userId)"],
    writers: ["src/services/notificationsService.ts", "server/background-notifications.ts"],
    cutoverStatus: "legacy_root_active",
  },
  {
    collectionName: "fcm_tokens",
    expectedDestination: "/fcm_tokens (sau /tenants/{tenantId}/fcm_tokens)",
    entityTypes: ["FCM Push Token Registration"],
    relatedEntities: ["users (userId, email)"],
    readers: ["server/background-notifications.ts"],
    writers: ["src/services/nativeNotificationService.ts"],
    cutoverStatus: "legacy_root_active",
    notes: "Regulile Firestore actuale restricționează strict pe resource.data.userId == request.auth.uid.",
  },
];

function getFirestoreTarget(): { projectId: string; databaseId: string } {
  let projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    "brokr-42038";
  let databaseId = process.env.FIRESTORE_DATABASE_ID || "(default)";

  try {
    const cfgPath = path.resolve(process.cwd(), "firebase-applet-config.json");
    if (fs.existsSync(cfgPath)) {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      if (parsed?.projectId) projectId = parsed.projectId;
      if (parsed?.firestoreDatabaseId) databaseId = parsed.firestoreDatabaseId;
    }
  } catch {
    // Fallback to env values
  }

  return { projectId, databaseId };
}

export class LegacyInventoryService {
  /**
   * Builds the full inventory of legacy root collections.
   * When live Firestore server credentials exist (and includeLiveCounts !== false),
   * queries Firestore `:runAggregationQuery` (COUNT) safely in read-only mode.
   * Never fabricates counts when live credentials are missing.
   */
  public static async buildInventory(options?: {
    includeLiveCounts?: boolean;
    adapterCounts?: Record<string, number>;
  }): Promise<{
    generatedAt: string;
    firebaseProjectId: string;
    firestoreDatabaseId: string;
    liveFirestoreReachable: boolean;
    items: LegacyCollectionInventoryItem[];
  }> {
    const { projectId, databaseId } = getFirestoreTarget();
    const shouldQueryLive =
      options?.includeLiveCounts !== false &&
      PersistentStoreService.isRemoteFirestoreConfigured();

    let accessToken: string | null = null;
    if (shouldQueryLive) {
      try {
        accessToken = await PersistentStoreService.getGoogleAccessToken();
      } catch {
        accessToken = null;
      }
    }

    const items: LegacyCollectionInventoryItem[] = [];

    for (const bp of LEGACY_COLLECTION_BLUEPRINTS) {
      let recordCount: number | null = null;
      let liveCountStatus: LegacyCollectionInventoryItem["liveCountStatus"] =
        "unavailable_without_server_credentials";

      if (options?.adapterCounts && bp.collectionName in options.adapterCounts) {
        recordCount = options.adapterCounts[bp.collectionName];
        liveCountStatus = "measured_adapter";
      } else if (accessToken) {
        try {
          const aggUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents:runAggregationQuery`;
          const res = await axios.post(
            aggUrl,
            {
              structuredAggregationQuery: {
                structuredQuery: {
                  from: [{ collectionId: bp.collectionName }],
                },
                aggregations: [{ alias: "total_count", count: {} }],
              },
            },
            {
              headers: { Authorization: `Bearer ${accessToken}` },
              timeout: 6000,
            }
          );

          const rows = Array.isArray(res.data) ? res.data : [];
          const countVal =
            rows[0]?.result?.aggregateFields?.total_count?.integerValue;
          if (countVal !== undefined) {
            recordCount = Number(countVal);
            liveCountStatus = "measured_live";
          }
        } catch {
          recordCount = null;
          liveCountStatus = "unavailable_without_server_credentials";
        }
      }

      items.push({
        collectionName: bp.collectionName,
        currentLocation: `/${bp.collectionName}`,
        expectedDestination: bp.expectedDestination,
        entityTypes: [...bp.entityTypes],
        recordCount,
        liveCountStatus,
        relatedEntities: [...bp.relatedEntities],
        readers: [...bp.readers],
        writers: [...bp.writers],
        cutoverStatus: bp.cutoverStatus,
        notes: bp.notes,
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      firebaseProjectId: projectId,
      firestoreDatabaseId: databaseId,
      liveFirestoreReachable: Boolean(accessToken),
      items,
    };
  }
}
