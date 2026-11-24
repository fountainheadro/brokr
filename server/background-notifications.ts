import { Express } from "express";
import axios from "axios";
import fs from "fs";
import path from "path";
import { GcpAuthService } from "../src/core/gcp/svc_gcp-auth";
import { logger } from "../src/core/logger/logger";
import { requireTenantContext } from "./middleware/mw_tenant-context";
import { CrmTenantStoreService } from "../src/core/crm/svc_crm-tenant-store";
import { PersistentStoreService } from "../src/core/database/svc_persistent-store";
import { FirestoreLeaseService } from "../src/core/jobs/svc_firestore-lease";

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

// In-memory deduplication set used ONLY in single-process local dev without server Firestore ADC.
const localDispatchedIds = new Set<string>();

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

export const COL_NOTIFICATION_DISPATCHES = "notification_dispatches";

export interface ViewingReminderSendPayload {
  projectId: string;
  tokens: string[];
  title: string;
  body: string;
  urlPath: string;
  tenantId: string;
  viewingId: string;
  thresholdKey: string;
}

export interface ViewingReminderTickResult {
  executed: boolean;
  skippedReason?: string;
  fencingToken?: number;
  evaluatedViewings: number;
  dispatchedCount: number;
  deduplicatedCount: number;
}

export function getTenantPartitionedNotificationSnapshot(tenantId: string) {
  const viewings = Object.values(runtimeMirror.viewings).filter((v) => v.tenantId === tenantId);
  const tokens = Object.values(runtimeMirror.tokens).filter((t) => t.tenantId === tenantId);
  return { viewings, tokens };
}

export function seedNotificationMirrorForTests(params: {
  viewings?: CachedViewing[];
  tokens?: CachedToken[];
}): void {
  for (const v of params.viewings || []) {
    runtimeMirror.viewings[`${v.tenantId}::${v.id}`] = v;
  }
  for (const t of params.tokens || []) {
    runtimeMirror.tokens[`${t.tenantId}::${t.token}`] = t;
  }
}

export function clearNotificationMirrorForTests(): void {
  for (const key of Object.keys(runtimeMirror.viewings)) {
    delete runtimeMirror.viewings[key];
  }
  for (const key of Object.keys(runtimeMirror.tokens)) {
    delete runtimeMirror.tokens[key];
  }
  localDispatchedIds.clear();
  PersistentStoreService.clearCollection(COL_NOTIFICATION_DISPATCHES);
}

/**
 * Multi-instance safe viewing reminders worker tick.
 *
 * Guarantees:
 * - Coordinates across 2+ Cloud Run instances using a fenced Firestore lease (`worker:viewing-reminders`).
 * - Deduplicates every `(tenantId, viewingId, date, hour, threshold)` dispatch durably via
 *   `PersistentStoreService.createIfAbsentAsync` so zero duplicate FCM pushes are ever delivered,
 *   even when all browser tabs are closed or multiple replicas overlap.
 */
export async function runViewingRemindersTick(options?: {
  now?: Date;
  ownerId?: string;
  projectId?: string;
  bypassLease?: boolean;
  sendFn?: (payload: ViewingReminderSendPayload) => Promise<void>;
}): Promise<ViewingReminderTickResult> {
  const config = loadFirebaseConfig();
  const projectId = options?.projectId || config?.projectId || process.env.FIREBASE_PROJECT_ID || "brokr-42038";

  const executeTick = async (fencingToken?: number): Promise<ViewingReminderTickResult> => {
    const now = options?.now || new Date();
    const allViewings = Object.values(runtimeMirror.viewings);
    const allTokens = Object.values(runtimeMirror.tokens);

    if (allViewings.length === 0 || allTokens.length === 0) {
      return {
        executed: true,
        fencingToken,
        evaluatedViewings: allViewings.length,
        dispatchedCount: 0,
        deduplicatedCount: 0,
      };
    }

    const fcmAccessToken = options?.sendFn ? null : await getFcmServiceAccessToken();
    let dispatchedCount = 0;
    let deduplicatedCount = 0;

    const dispatchOnce = async (
      viewingTenant: string,
      viewing: CachedViewing,
      thresholdKey: string,
      targetTokens: string[],
      title: string,
      body: string
    ) => {
      const safeTenant = viewingTenant.replace(/[^A-Za-z0-9_-]/g, "_");
      const safeViewing = viewing.id.replace(/[^A-Za-z0-9_-]/g, "_");
      const safeDate = `${viewing.date}_${viewing.hour}`.replace(/[^A-Za-z0-9_-]/g, "_");
      const dispatchId = `${safeTenant}__${safeViewing}__${safeDate}__${thresholdKey}`;

      let claimed: boolean;
      if (process.env.NODE_ENV === "test" || PersistentStoreService.isRemoteFirestoreConfigured()) {
        claimed = await PersistentStoreService.createIfAbsentAsync(
          COL_NOTIFICATION_DISPATCHES,
          dispatchId,
          {
            tenantId: viewingTenant,
            viewingId: viewing.id,
            thresholdKey,
            sentAt: now.toISOString(),
          }
        );
      } else {
        if (localDispatchedIds.has(dispatchId)) {
          claimed = false;
        } else {
          if (localDispatchedIds.size > 5000) {
            localDispatchedIds.clear();
          }
          localDispatchedIds.add(dispatchId);
          claimed = true;
        }
      }

      if (!claimed) {
        deduplicatedCount++;
        return;
      }

      if (options?.sendFn) {
        await options.sendFn({
          projectId,
          tokens: targetTokens,
          title,
          body,
          urlPath: "/calendar",
          tenantId: viewingTenant,
          viewingId: viewing.id,
          thresholdKey,
        });
      } else {
        await sendFCMPushNotification(
          projectId,
          fcmAccessToken,
          targetTokens,
          title,
          body,
          "/calendar"
        );
      }
      dispatchedCount++;
    };

    const thresholds = [
      { minutes: 180, label: "3 ore" },
      { minutes: 120, label: "2 ore" },
      { minutes: 60, label: "1 oră" },
    ];

    for (const viewing of allViewings) {
      const viewingId = viewing.id;
      const viewingTenant = viewing.tenantId || "ten_brokr_default";
      if (!viewingId || !viewing.date || !viewing.hour) continue;

      const viewingDateTime = new Date(`${viewing.date}T${viewing.hour}:00`);
      if (isNaN(viewingDateTime.getTime())) continue;

      const diffMs = viewingDateTime.getTime() - now.getTime();
      const diffMinutes = Math.round(diffMs / (60 * 1000));

      const targetTokens = allTokens
        .filter(
          (t) =>
            (t.tenantId || "ten_brokr_default") === viewingTenant &&
            (!viewing.agentId || t.userId === viewing.agentId)
        )
        .map((t) => t.token);

      if (targetTokens.length === 0) continue;

      for (const threshold of thresholds) {
        if (diffMinutes <= threshold.minutes && diffMinutes > threshold.minutes - 2) {
          await dispatchOnce(
            viewingTenant,
            viewing,
            `${threshold.minutes}m`,
            targetTokens,
            "Vizionare Programată (Brokr)",
            `Vizionarea cu ${viewing.contactName || "clientul"} este peste ${threshold.label}.`
          );
        }
      }

      if (diffMinutes <= 0 && diffMinutes > -5) {
        await dispatchOnce(
          viewingTenant,
          viewing,
          "now",
          targetTokens,
          "Vizionare Programată (Brokr)",
          `Vizionarea cu ${viewing.contactName || "clientul"} începe ACUM!`
        );
      }
    }

    return {
      executed: true,
      fencingToken,
      evaluatedViewings: allViewings.length,
      dispatchedCount,
      deduplicatedCount,
    };
  };

  if (options?.bypassLease) {
    return executeTick(undefined);
  }

  const leaseRes = await FirestoreLeaseService.withLease(
    {
      lockKey: "worker:viewing-reminders",
      ownerId: options?.ownerId,
      ttlMs: 45_000,
    },
    (lease) => executeTick(lease.fencingToken)
  );

  if (!leaseRes.executed) {
    return {
      executed: false,
      skippedReason: leaseRes.reason,
      evaluatedViewings: 0,
      dispatchedCount: 0,
      deduplicatedCount: 0,
    };
  }

  return leaseRes.result;
}

export function setupBackgroundNotifications() {
  const config = loadFirebaseConfig();
  if (!config) {
    logger.warn("No Firebase configuration found. Background server notifications will not trigger.", {
      module: "background-notifications",
    });
    return;
  }

  // In production (Cloud Run), Cloud Scheduler triggers POST /internal/workers/viewing-reminders
  // directly with OIDC authentication so multi-instance replicas never run uncoordinated timers.
  const inProcessDisabled =
    process.env.ENABLE_IN_PROCESS_SCHEDULERS === "false" ||
    (process.env.NODE_ENV === "production" && process.env.ENABLE_IN_PROCESS_SCHEDULERS !== "true");

  if (inProcessDisabled) {
    logger.info(
      "In-process notification setInterval disabled (Cloud Scheduler owns /internal/workers/viewing-reminders).",
      {
        module: "background-notifications",
      }
    );
    return () => {};
  }

  const { projectId } = config;
  logger.info(`Initializing lease-protected local dev notification tick for Project: ${projectId}`, {
    module: "background-notifications",
  });

  const runTick = () => {
    void runViewingRemindersTick({ ownerId: `dev-in-process-${process.pid}`, projectId }).catch(
      (err) => {
        logger.error("Error in background notification tick loop", err, {
          module: "background-notifications",
        });
      }
    );
  };

  runTick();
  const intervalId = setInterval(runTick, 45000);

  return () => {
    clearInterval(intervalId);
    logger.info("Background notification scheduler stopped cleanly.", {
      module: "background-notifications",
    });
  };
}

