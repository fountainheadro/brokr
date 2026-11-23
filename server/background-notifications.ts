import { Express } from "express";
import axios from "axios";
import fs from "fs";
import path from "path";
import { GcpAuthService } from "../src/core/gcp/svc_gcp-auth";
import { logger } from "../src/core/logger/logger";
import { requireTenantContext } from "./middleware/mw_tenant-context";
import { CrmTenantStoreService } from "../src/core/crm/svc_crm-tenant-store";
import { PersistentStoreService } from "../src/core/database/svc_persistent-store";

export const FCM_MESSAGING_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

interface CachedViewing {
  id: string;
  tenantId: string;
  date: string;
  hour: string;
  agentId?: string;
  contactName?: string;
  syncedAt: number;
}

interface CachedToken {
  token: string;
  tenantId: string;
  userId: string;
  email?: string;
  updatedAt: number;
}

interface NotificationRuntimeMirror {
  viewings: { [partitionedKey: string]: CachedViewing };
  tokens: { [partitionedKey: string]: CachedToken };
}

// Pure in-memory scheduler mirror backed by Cloud Firestore (ZERO local file persistence).
const runtimeMirror: NotificationRuntimeMirror = {
  viewings: {},
  tokens: {},
};

interface FirebaseConfig {
  projectId: string;
  appId: string;
  apiKey: string;
  authDomain: string;
  firestoreDatabaseId: string;
  storageBucket: string;
  messagingSenderId: string;
}

function loadFirebaseConfig(): FirebaseConfig | null {
  try {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    if (fs.existsSync(configPath)) {
      const configRaw = fs.readFileSync(configPath, "utf8");
      return JSON.parse(configRaw);
    }
  } catch (err: any) {
    logger.error("Failed to load firebase-applet-config.json", err, {
      module: "background-notifications",
    });
  }
  return null;
}

export async function getFcmServiceAccessToken(): Promise<string | null> {
  return GcpAuthService.getAccessToken(FCM_MESSAGING_SCOPE);
}

async function sendFCMPushNotification(
  projectId: string,
  accessToken: string | null,
  tokens: string[],
  title: string,
  body: string,
  urlPath: string
) {
  if (!accessToken) {
    logger.info(
      `FCM dispatch skipped (SIMULATION MODE - no ADC/metadata credentials active). Targets: ${tokens.length}, route: ${urlPath}`,
      {
        module: "background-notifications",
        action: "fcm_simulation",
      }
    );
    return;
  }

  for (const deviceToken of tokens) {
    try {
      const payload = {
        message: {
          token: deviceToken,
          notification: {
            title,
            body,
          },
          data: {
            title,
            body,
            clickAction: urlPath,
          },
        },
      };

      const tokenSuffix =
        deviceToken.length > 8 ? `***${deviceToken.slice(-6)}` : "***";
      logger.info(`Dispatching FCM push to device token ${tokenSuffix}`, {
        module: "background-notifications",
        action: "fcm_send",
      });

      await axios.post(
        `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            ...GcpAuthService.getQuotaProjectHeaders(),
          },
          timeout: 10000,
        }
      );

      logger.info("FCM push delivered successfully", {
        module: "background-notifications",
        action: "fcm_send_success",
      });
    } catch (apiErr: unknown) {
      const safeErr = GcpAuthService.sanitizeGcpHttpError(
        apiErr,
        "Firebase Cloud Messaging",
        "messages:send"
      );
      logger.warn("FCM push delivery failed", {
        module: "background-notifications",
        action: "fcm_send_error",
        statusCode: safeErr.statusCode,
        reason: safeErr.message,
      });
    }
  }
}

export function registerNotificationRoutes(app: Express) {
  app.post("/api/notifications/sync-viewings", ...requireTenantContext, async (req, res) => {
    try {
      const ctx = req.tenantContext!;
      const { userId, viewings } = req.body;
      if (!userId || !Array.isArray(viewings)) {
        return res.status(400).json({ error: "Missing userId or viewings array" });
      }
      if (req.authUser!.uid !== userId) {
        return res.status(403).json({ error: "Forbidden: userId mismatch" });
      }

      logger.info(
        `Synchronizing ${viewings.length} viewings for user ${userId}`,
        { module: "background-notifications", tenantId: ctx.tenantId, userId }
      );

      for (const key of Object.keys(runtimeMirror.viewings)) {
        const cached = runtimeMirror.viewings[key];
        const cachedTenant = cached.tenantId || "ten_brokr_default";
        if (cachedTenant === ctx.tenantId && (cached.agentId === userId || cached.id === userId)) {
          delete runtimeMirror.viewings[key];
        }
      }

      const firestoreWrites: Array<Record<string, any>> = [];
      const { projectId, databaseId } = PersistentStoreService.getFirebaseTarget();
      const basePrefix = `projects/${projectId}/databases/${databaseId}/documents/tenants/${ctx.tenantId}/viewings`;
      const nowIso = new Date().toISOString();

      viewings.forEach((v: any) => {
        if (v.id && v.date && v.hour) {
          const partKey = `${ctx.tenantId}::${v.id}`;
          runtimeMirror.viewings[partKey] = {
            id: v.id,
            tenantId: ctx.tenantId,
            date: v.date,
            hour: v.hour,
            agentId: userId,
            contactName: v.contactName || "clientul",
            syncedAt: Date.now(),
          };

          const safeId = String(v.id).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
          if (safeId) {
            firestoreWrites.push({
              update: {
                name: `${basePrefix}/${safeId}`,
                fields: PersistentStoreService.encodeDocumentFields({
                  id: safeId,
                  tenantId: ctx.tenantId,
                  propertyId: String(v.propertyId || ""),
                  contactId: String(v.contactId || safeId),
                  contactName: String(v.contactName || "clientul"),
                  agentId: userId,
                  date: String(v.date),
                  hour: String(v.hour),
                  updatedAt: nowIso,
                }),
              },
            });
          }
        }
      });

      if (
        firestoreWrites.length > 0 &&
        process.env.NODE_ENV !== "test" &&
        PersistentStoreService.isRemoteFirestoreConfigured()
      ) {
        await PersistentStoreService.remoteCommitWrites(
          firestoreWrites.slice(0, 400),
          "sync_viewings_batch"
        );
      }

      return res.json({ success: true, count: viewings.length, tenantId: ctx.tenantId });
    } catch (err: any) {
      logger.error("Failed syncing viewings route", err, {
        module: "background-notifications",
      });
      return res.status(500).json({ error: err?.message || "Eroare internă" });
    }
  });

  app.post("/api/notifications/register-token", ...requireTenantContext, async (req, res) => {
    try {
      const ctx = req.tenantContext!;
      const { token, userId, email } = req.body;
      if (!token || !userId) {
        return res.status(400).json({ error: "Missing token or userId" });
      }
      if (req.authUser!.uid !== userId) {
        return res.status(403).json({ error: "Forbidden: userId mismatch" });
      }

      const tokenSuffix = String(token).length > 6 ? `***${String(token).slice(-6)}` : "***";
      logger.info(`Mapping FCM device ${tokenSuffix} for user ${userId}`, {
        module: "background-notifications",
        tenantId: ctx.tenantId,
        userId,
      });

      const partKey = `${ctx.tenantId}::${token}`;
      runtimeMirror.tokens[partKey] = {
        token,
        tenantId: ctx.tenantId,
        userId,
        email: req.authUser!.email || email,
        updatedAt: Date.now(),
      };

      // Permanently persist the FCM token in Cloud Firestore under /tenants/{tenantId}/fcm_tokens
      if (process.env.NODE_ENV !== "test" && PersistentStoreService.isRemoteFirestoreConfigured()) {
        await CrmTenantStoreService.upsertFcmToken({
          tenantId: ctx.tenantId,
          userId,
          email: req.authUser!.email || email,
          token,
        });
      }

      return res.json({ success: true, tenantId: ctx.tenantId });
    } catch (err: any) {
      logger.error("Failed registering FCM token route", err, {
        module: "background-notifications",
      });
      return res.status(500).json({ error: err?.message || "Eroare internă" });
    }
  });
}

export function getTenantPartitionedNotificationSnapshot(tenantId: string) {
  const viewings = Object.values(runtimeMirror.viewings).filter((v) => v.tenantId === tenantId);
  const tokens = Object.values(runtimeMirror.tokens).filter((t) => t.tenantId === tenantId);
  return { viewings, tokens };
}

export function setupBackgroundNotifications() {
  const config = loadFirebaseConfig();
  if (!config) {
    logger.warn("No Firebase configuration found. Background server notifications will not trigger.", {
      module: "background-notifications",
    });
    return;
  }

  const { projectId } = config;
  logger.info(`Initializing tenant-partitioned background listener for Project: ${projectId}`, {
    module: "background-notifications",
  });

  const sentNotifications = new Set<string>();

  const runCheckTick = async () => {
    try {
      const now = new Date();
      const allViewings = Object.values(runtimeMirror.viewings);
      const allTokens = Object.values(runtimeMirror.tokens);

      if (allViewings.length === 0 || allTokens.length === 0) {
        return;
      }

      if (now.getHours() === 0 && now.getMinutes() === 0) {
        sentNotifications.clear();
      }

      const fcmAccessToken = await getFcmServiceAccessToken();

      allViewings.forEach((viewing) => {
        const viewingId = viewing.id;
        const viewingTenant = viewing.tenantId || "ten_brokr_default";
        if (!viewingId || !viewing.date || !viewing.hour) return;

        const viewingDateTime = new Date(`${viewing.date}T${viewing.hour}:00`);
        if (isNaN(viewingDateTime.getTime())) return;

        const diffMs = viewingDateTime.getTime() - now.getTime();
        const diffMinutes = Math.round(diffMs / (60 * 1000));

        const targetTokens = allTokens
          .filter(
            (t) =>
              (t.tenantId || "ten_brokr_default") === viewingTenant &&
              (!viewing.agentId || t.userId === viewing.agentId)
          )
          .map((t) => t.token);

        if (targetTokens.length === 0) return;

        const thresholds = [
          { minutes: 180, label: "3 ore" },
          { minutes: 120, label: "2 ore" },
          { minutes: 60, label: "1 oră" },
        ];

        thresholds.forEach((threshold) => {
          const notificationKey = `${viewingTenant}::${viewingId}-${threshold.minutes}`;

          if (diffMinutes <= threshold.minutes && diffMinutes > threshold.minutes - 2) {
            if (!sentNotifications.has(notificationKey)) {
              void sendFCMPushNotification(
                projectId,
                fcmAccessToken,
                targetTokens,
                "Vizionare Programată (Brokr)",
                `Vizionarea cu ${viewing.contactName || "clientul"} este peste ${threshold.label}.`,
                "/calendar"
              );
              sentNotifications.add(notificationKey);
            }
          }
        });

        const nowKey = `${viewingTenant}::${viewingId}-now`;
        if (diffMinutes <= 0 && diffMinutes > -5) {
          if (!sentNotifications.has(nowKey)) {
            void sendFCMPushNotification(
              projectId,
              fcmAccessToken,
              targetTokens,
              "Vizionare Programată (Brokr)",
              `Vizionarea cu ${viewing.contactName || "clientul"} începe ACUM!`,
              "/calendar"
            );
            sentNotifications.add(nowKey);
          }
        }
      });
    } catch (err: any) {
      logger.error("Error in background notification tick loop", err, {
        module: "background-notifications",
      });
    }
  };

  void runCheckTick();
  setInterval(() => {
    void runCheckTick();
  }, 45000);
}
