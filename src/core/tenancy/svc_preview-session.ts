import crypto from "crypto";
import { PreviewSessionRecord } from "./typ_preview-session";
import { UserRole } from "./typ_tenant-context";
import { TenantResolutionService } from "./svc_tenant-resolution";
import { QuotaService } from "../subscription/svc_quota";
import { PlatformAuditLogRepository } from "../platform/repo_platform-audit-log";
import { PersistentStoreService } from "../database/svc_persistent-store";
import { AppError } from "../errors/app_error";

const COL_PREVIEW_SESSIONS = "preview_sessions";

export class PreviewSessionService {
  private static SESSION_TTL_MS = 2 * 60 * 60 * 1000;

  private static generateToken(): string {
    const randomHex = crypto.randomBytes(32).toString("hex");
    return `prev_${Date.now()}_${randomHex}`;
  }

  public static calculatePermissions(role: UserRole): string[] {
    switch (role) {
      case "agency_owner":
      case "agency_admin":
        return [
          "*",
          "agency.admin",
          "agency.settings",
          "agency.billing",
          "agency.users.manage",
          "agency.ai.manage",
          "crm.read",
          "crm.write",
          "crm.delete",
        ];
      case "manager":
        return [
          "crm.read",
          "crm.write",
          "agency.users.view",
          "agency.analytics.view",
          "properties.manage",
          "leads.manage",
        ];
      case "agent":
      default:
        return [
          "crm.read",
          "crm.write",
          "properties.read",
          "properties.create",
          "properties.update",
          "leads.read",
          "leads.create",
          "leads.update",
          "contacts.read",
          "contacts.create",
          "activities.read",
          "activities.create",
        ];
    }
  }

  public static startSession(params: {
    tenantId: string;
    superAdminUid: string;
    superAdminEmail: string;
    simulatedRole?: UserRole;
    environment?: "development" | "staging" | "production";
  }): PreviewSessionRecord {
    const isProductionEnv =
      params.environment === "production" || process.env.NODE_ENV === "production";
    if (isProductionEnv && process.env.ALLOW_PREVIEW_MODE_IN_PRODUCTION !== "true") {
      throw new AppError({
        message: "Modul Agency Preview este dezactivat în mediul de producție.",
        code: "FORBIDDEN",
        statusCode: 403,
      });
    }

    const tenant = TenantResolutionService.getTenantById(params.tenantId);
    if (!tenant) {
      throw new AppError({
        message: `Agenția cu identificatorul "${params.tenantId}" nu a fost găsită.`,
        code: "NOT_FOUND",
        statusCode: 404,
      });
    }

    const simulatedRole: UserRole = params.simulatedRole || "agency_admin";
    const effectivePermissions = this.calculatePermissions(simulatedRole);

    let effectiveModules: string[] = [];
    try {
      const entitlements = QuotaService.getTenantEntitlements(tenant.id);
      effectiveModules = entitlements.effectiveModules;
    } catch {
      effectiveModules = tenant.enabledModules || [];
    }

    const token = this.generateToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.SESSION_TTL_MS).toISOString();

    const record: PreviewSessionRecord = {
      token,
      tenantId: tenant.id,
      tenantName: tenant.name,
      subdomain: tenant.subdomain,
      simulatedRole,
      superAdminUid: params.superAdminUid,
      superAdminEmail: params.superAdminEmail,
      effectivePermissions,
      effectiveModules,
      createdAt: now.toISOString(),
      expiresAt,
      lastActiveAt: now.toISOString(),
      environment: params.environment || "development",
    };

    PersistentStoreService.set(COL_PREVIEW_SESSIONS, token, record);

    PlatformAuditLogRepository.addLog({
      action: "AGENCY_PREVIEW_START" as any,
      actorUserId: params.superAdminUid,
      actorEmail: params.superAdminEmail,
      targetType: "agency" as any,
      targetId: tenant.id,
      details: {
        message: `Sesiune de testare pornită pentru agenția ${tenant.name} cu rolul ${simulatedRole}`,
        tenantId: tenant.id,
        simulatedRole,
        tokenPrefix: token.substring(0, 12),
      },
      ipAddress: "127.0.0.1",
    });

    return record;
  }

  public static async startSessionAsync(params: {
    tenantId: string;
    superAdminUid: string;
    superAdminEmail: string;
    simulatedRole?: UserRole;
    environment?: "development" | "staging" | "production";
  }): Promise<PreviewSessionRecord> {
    const record = this.startSession(params);
    if (process.env.NODE_ENV !== "test" && PersistentStoreService.isRemoteFirestoreConfigured()) {
      await PersistentStoreService.setAsync(COL_PREVIEW_SESSIONS, record.token, record);
    }
    return record;
  }

  public static getSession(token: string): PreviewSessionRecord | null {
    if (!token) return null;
    const session = PersistentStoreService.get<PreviewSessionRecord>(COL_PREVIEW_SESSIONS, token);
    if (!session) return null;

    if (new Date(session.expiresAt) <= new Date()) {
      PersistentStoreService.delete(COL_PREVIEW_SESSIONS, token);
      return null;
    }

    session.lastActiveAt = new Date().toISOString();
    PersistentStoreService.setCacheOnly(COL_PREVIEW_SESSIONS, token, session);
    return session;
  }

  public static async getSessionAsync(token: string): Promise<PreviewSessionRecord | null> {
    if (!token) return null;
    let session = PersistentStoreService.get<PreviewSessionRecord>(COL_PREVIEW_SESSIONS, token);
    if (!session && PersistentStoreService.isRemoteFirestoreConfigured()) {
      session = await PersistentStoreService.remoteGet<PreviewSessionRecord>(COL_PREVIEW_SESSIONS, token);
      if (session) {
        PersistentStoreService.setCacheOnly(COL_PREVIEW_SESSIONS, token, session);
      }
    }
    if (!session) return null;

    if (new Date(session.expiresAt) <= new Date()) {
      await PersistentStoreService.deleteAsync(COL_PREVIEW_SESSIONS, token).catch(() => {});
      return null;
    }

    session.lastActiveAt = new Date().toISOString();
    PersistentStoreService.setCacheOnly(COL_PREVIEW_SESSIONS, token, session);
    return session;
  }

  public static switchRole(token: string, newRole: UserRole): PreviewSessionRecord {
    const session = this.getSession(token);
    if (!session) {
      throw new AppError({
        message: "Sesiunea de testare este invalidă sau a expirat.",
        code: "UNAUTHORIZED",
        statusCode: 401,
      });
    }

    const oldRole = session.simulatedRole;
    session.simulatedRole = newRole;
    session.effectivePermissions = this.calculatePermissions(newRole);
    session.lastActiveAt = new Date().toISOString();
    PersistentStoreService.set(COL_PREVIEW_SESSIONS, token, session);

    void PlatformAuditLogRepository.addLog({
      action: "AGENCY_PREVIEW_ROLE_SWITCH" as any,
      actorUserId: session.superAdminUid,
      actorEmail: session.superAdminEmail,
      targetType: "agency" as any,
      targetId: session.tenantId,
      details: {
        message: `Schimbare rol în testare pentru agenția ${session.tenantName}: ${oldRole} -> ${newRole}`,
        tenantId: session.tenantId,
        oldRole,
        newRole,
      },
      ipAddress: "127.0.0.1",
    });

    return session;
  }

  public static async switchRoleAsync(token: string, newRole: UserRole): Promise<PreviewSessionRecord> {
    const existing = await this.getSessionAsync(token);
    if (!existing) {
      throw new AppError({
        message: "Sesiunea de testare este invalidă sau a expirat.",
        code: "UNAUTHORIZED",
        statusCode: 401,
      });
    }
    const updated = this.switchRole(token, newRole);
    if (process.env.NODE_ENV !== "test" && PersistentStoreService.isRemoteFirestoreConfigured()) {
      await PersistentStoreService.setAsync(COL_PREVIEW_SESSIONS, token, updated);
    }
    return updated;
  }

  public static destroySession(token: string): boolean {
    const session = PersistentStoreService.get<PreviewSessionRecord>(COL_PREVIEW_SESSIONS, token);
    if (session) {
      void PlatformAuditLogRepository.addLog({
        action: "AGENCY_PREVIEW_EXIT" as any,
        actorUserId: session.superAdminUid,
        actorEmail: session.superAdminEmail,
        targetType: "agency" as any,
        targetId: session.tenantId,
        details: {
          message: `Ieșire din sesiunea de testare pentru agenția ${session.tenantName}`,
          tenantId: session.tenantId,
        },
        ipAddress: "127.0.0.1",
      });
    }

    return PersistentStoreService.delete(COL_PREVIEW_SESSIONS, token);
  }

  public static async destroySessionAsync(token: string): Promise<boolean> {
    const existing = await this.getSessionAsync(token);
    if (existing) {
      await PlatformAuditLogRepository.addLog({
        action: "AGENCY_PREVIEW_EXIT" as any,
        actorUserId: existing.superAdminUid,
        actorEmail: existing.superAdminEmail,
        targetType: "agency" as any,
        targetId: existing.tenantId,
        details: {
          message: `Ieșire din sesiunea de testare pentru agenția ${existing.tenantName}`,
          tenantId: existing.tenantId,
        },
        ipAddress: "127.0.0.1",
      });
    }
    return PersistentStoreService.deleteAsync(COL_PREVIEW_SESSIONS, token);
  }

  public static purgeExpiredSessions(): number {
    const now = new Date();
    const allSessions = PersistentStoreService.getAll<PreviewSessionRecord>(COL_PREVIEW_SESSIONS);
    let purged = 0;
    for (const [token, session] of Object.entries(allSessions)) {
      if (new Date(session.expiresAt) <= now) {
        PersistentStoreService.delete(COL_PREVIEW_SESSIONS, token);
        purged++;
      }
    }
    return purged;
  }
}
