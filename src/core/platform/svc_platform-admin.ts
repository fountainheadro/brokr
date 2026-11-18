import { PlatformAdminUser } from "./typ_platform-admin";

/**
 * Built-in and registered platform administrators.
 * Platform administrators possess global platform rights across all agencies.
 */
const PLATFORM_ADMIN_REGISTRY = new Map<string, PlatformAdminUser>();

// Trusted bootstrap platform admin emails
const BOOTSTRAP_SUPER_ADMIN_EMAILS = new Set<string>([
  "fountainheadro@gmail.com",
  "adrianmariusmp@gmail.com",
  "adrian@cautlocuinta.ro",
  "superadmin@brokr.ro",
]);

// Seed initial platform administrators
const SEED_PLATFORM_ADMINS: PlatformAdminUser[] = [
  {
    id: "padm_1",
    userId: "usr_super_admin",
    email: "fountainheadro@gmail.com",
    name: "Platform Super Admin",
    role: "super_admin",
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastLoginAt: new Date().toISOString(),
  },
  {
    id: "padm_2",
    userId: "usr_adrian_mp",
    email: "adrianmariusmp@gmail.com",
    name: "Adrian Marius",
    role: "super_admin",
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastLoginAt: new Date().toISOString(),
  },
  {
    id: "padm_3",
    userId: "usr_support_1",
    email: "support@brokr.ro",
    name: "Platform Support Officer",
    role: "support_admin",
    isActive: true,
    createdAt: "2026-02-01T00:00:00.000Z",
  },
];

for (const admin of SEED_PLATFORM_ADMINS) {
  PLATFORM_ADMIN_REGISTRY.set(admin.userId, admin);
  PLATFORM_ADMIN_REGISTRY.set(admin.email.toLowerCase(), admin);
}

export class PlatformAdminService {
  /**
   * Verifies if a given user UID or email holds platform administrator privileges.
   * Agency roles (agency_owner, agency_admin, agent) NEVER grant platform privileges.
   */
  public static isPlatformAdmin(userId: string, email?: string): boolean {
    if (!userId && !email) return false;

    // 1. Direct registry lookup by user UID
    if (userId && PLATFORM_ADMIN_REGISTRY.has(userId)) {
      const admin = PLATFORM_ADMIN_REGISTRY.get(userId);
      return Boolean(admin && admin.isActive);
    }

    // 2. Direct registry lookup by email
    if (email) {
      const normalizedEmail = email.toLowerCase().trim();
      if (BOOTSTRAP_SUPER_ADMIN_EMAILS.has(normalizedEmail)) {
        return true;
      }
      if (PLATFORM_ADMIN_REGISTRY.has(normalizedEmail)) {
        const admin = PLATFORM_ADMIN_REGISTRY.get(normalizedEmail);
        return Boolean(admin && admin.isActive);
      }
    }

    return false;
  }

  /**
   * Retrieves platform administrator details.
   */
  public static getPlatformAdmin(userId: string, email?: string): PlatformAdminUser | null {
    if (userId && PLATFORM_ADMIN_REGISTRY.has(userId)) {
      return PLATFORM_ADMIN_REGISTRY.get(userId) || null;
    }
    if (email && PLATFORM_ADMIN_REGISTRY.has(email.toLowerCase())) {
      return PLATFORM_ADMIN_REGISTRY.get(email.toLowerCase()) || null;
    }
    if (email && BOOTSTRAP_SUPER_ADMIN_EMAILS.has(email.toLowerCase())) {
      return {
        id: `padm_${userId || "auto"}`,
        userId: userId || "usr_bootstrap",
        email: email.toLowerCase(),
        name: "Platform Administrator",
        role: "super_admin",
        isActive: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      };
    }
    return null;
  }

  /**
   * Lists all registered platform administrators.
   */
  public static listPlatformAdmins(): PlatformAdminUser[] {
    const unique = new Map<string, PlatformAdminUser>();
    for (const admin of PLATFORM_ADMIN_REGISTRY.values()) {
      unique.set(admin.id, admin);
    }
    return Array.from(unique.values());
  }

  /**
   * Registers a new platform administrator.
   */
  public static registerPlatformAdmin(admin: PlatformAdminUser): void {
    PLATFORM_ADMIN_REGISTRY.set(admin.userId, admin);
    PLATFORM_ADMIN_REGISTRY.set(admin.email.toLowerCase(), admin);
  }
}
