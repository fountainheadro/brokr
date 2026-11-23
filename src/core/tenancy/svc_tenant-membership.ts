import { AppError, ForbiddenError, TenantError, NotFoundError } from "../errors/app_error";
import { TenantMembershipRecord, TenantRecord, UserRole, TenantMembershipStatus } from "./typ_tenant-context";
import { TenantResolutionService } from "./svc_tenant-resolution";
import { PersistentStoreService } from "../database/svc_persistent-store";
import { CustomClaimsService } from "../auth/svc_custom-claims";

const COL_MEMBERSHIPS = "tenant_memberships";

function getMembershipKey(tenantId: string, userId: string): string {
  return `${tenantId}::${userId}`;
}

const SEED_MEMBERSHIPS: TenantMembershipRecord[] = [
  {
    id: "mem_usr_admin_brokr",
    tenantId: "ten_brokr_default",
    userId: "usr_admin_1",
    email: "adrian@brokr.ro",
    name: "Adrian Marius",
    role: "agency_owner",
    status: "active",
    permissions: ["*"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "mem_usr_agent_brokr",
    tenantId: "ten_brokr_default",
    userId: "usr_agent_1",
    email: "agent@brokr.ro",
    name: "Alex Agent",
    role: "agent",
    status: "active",
    permissions: ["leads:read", "leads:write", "properties:read"],
    createdAt: "2026-01-10T00:00:00.000Z",
    updatedAt: "2026-01-10T00:00:00.000Z",
  },
  {
    id: "mem_usr_pilot_owner_1",
    tenantId: "ten_brokr_default",
    userId: "usr_pilot_fountainhead",
    email: "fountainheadro@gmail.com",
    name: "Pilot Owner",
    role: "agency_owner",
    status: "active",
    permissions: ["*"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "mem_usr_pilot_owner_2",
    tenantId: "ten_brokr_default",
    userId: "usr_pilot_adrianmp",
    email: "adrianmariusmp@gmail.com",
    name: "Adrian Marius",
    role: "agency_owner",
    status: "active",
    permissions: ["*"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "mem_usr_pilot_owner_3",
    tenantId: "ten_brokr_default",
    userId: "usr_pilot_adrian_cl",
    email: "adrian@cautlocuinta.ro",
    name: "Adrian",
    role: "agency_owner",
    status: "active",
    permissions: ["*"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "mem_usr_petru_buliga",
    tenantId: "ten_brokr_default",
    userId: "usr_petru_buliga",
    email: "officepimob@gmail.com",
    name: "Petru Buliga",
    role: "agency_admin",
    status: "active",
    permissions: ["*"],
    createdAt: "2026-11-23T00:00:00.000Z",
    updatedAt: "2026-11-23T00:00:00.000Z",
  },
  {
    id: "mem_usr_suspended_brokr",
    tenantId: "ten_brokr_default",
    userId: "usr_suspended_1",
    email: "suspended@brokr.ro",
    name: "Suspended User",
    role: "agent",
    status: "suspended",
    permissions: [],
    createdAt: "2026-01-15T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
  },
  {
    id: "mem_usr_alpha_owner",
    tenantId: "ten_agency_a",
    userId: "usr_alpha_owner",
    email: "owner@agency-alpha.ro",
    name: "Alpha Owner",
    role: "agency_owner",
    status: "active",
    permissions: ["*"],
    createdAt: "2026-02-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
  },
  {
    id: "mem_usr_alpha_agent",
    tenantId: "ten_agency_a",
    userId: "usr_alpha_agent",
    email: "agent@agency-alpha.ro",
    name: "Alpha Agent",
    role: "agent",
    status: "active",
    permissions: ["leads:read"],
    createdAt: "2026-02-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
  },
  {
    id: "mem_usr_beta_owner",
    tenantId: "ten_agency_b",
    userId: "usr_beta_owner",
    email: "owner@agency-beta.ro",
    name: "Beta Owner",
    role: "agency_owner",
    status: "active",
    permissions: ["*"],
    createdAt: "2026-02-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
  },
  {
    id: "mem_usr_multi_alpha",
    tenantId: "ten_agency_a",
    userId: "usr_multi_tenant",
    email: "multi@example.com",
    name: "Multi-Agency Consultant",
    role: "manager",
    status: "active",
    permissions: ["*"],
    createdAt: "2026-02-10T00:00:00.000Z",
    updatedAt: "2026-02-10T00:00:00.000Z",
  },
  {
    id: "mem_usr_multi_beta",
    tenantId: "ten_agency_b",
    userId: "usr_multi_tenant",
    email: "multi@example.com",
    name: "Multi-Agency Consultant",
    role: "agent",
    status: "active",
    permissions: ["leads:read"],
    createdAt: "2026-02-10T00:00:00.000Z",
    updatedAt: "2026-02-10T00:00:00.000Z",
  },
  {
    id: "mem_usr_suspended_agency",
    tenantId: "ten_suspended_agency",
    userId: "usr_suspended_agency_owner",
    email: "owner@suspended.ro",
    name: "Suspended Agency Owner",
    role: "agency_owner",
    status: "active",
    permissions: ["*"],
    createdAt: "2026-01-15T00:00:00.000Z",
    updatedAt: "2026-01-15T00:00:00.000Z",
  },
];

function ensureMembershipsSeeded(): Record<string, TenantMembershipRecord> {
  return PersistentStoreService.seedIfEmpty<TenantMembershipRecord>(
    COL_MEMBERSHIPS,
    SEED_MEMBERSHIPS.map((m) => ({
      id: getMembershipKey(m.tenantId, m.userId),
      value: { ...m },
    }))
  );
}

export function mapStaffRoleToTenantRole(rawRole?: string): UserRole {
  const normalized = String(rawRole || "")
    .trim()
    .toLowerCase();
  if (normalized === "agency_owner" || normalized === "owner" || normalized === "proprietar") {
    return "agency_owner";
  }
  if (normalized === "agency_admin" || normalized === "admin" || normalized === "administrator") {
    return "agency_admin";
  }
  if (normalized === "manager" || normalized === "director" || normalized === "team lead") {
    return "manager";
  }
  if (normalized === "assistant" || normalized === "asistent" || normalized === "secretariat") {
    return "assistant";
  }
  return "agent";
}

function defaultPermissionsForRole(role: UserRole): string[] {
  switch (role) {
    case "agency_owner":
    case "agency_admin":
      return ["*"];
    case "manager":
      return [
        "crm.read",
        "crm.write",
        "leads:read",
        "leads:write",
        "properties:read",
        "properties:write",
        "agency.users.view",
      ];
    case "assistant":
      return ["crm.read", "leads:read", "contacts:read", "activities:read", "activities:write"];
    case "agent":
    default:
      return ["crm.read", "crm.write", "leads:read", "leads:write", "properties:read", "properties:write"];
  }
}

function assertMembershipStatusAllowed(membership: TenantMembershipRecord): void {
  if (membership.status === "suspended") {
    throw new ForbiddenError("Contul dumneavoastră de utilizator în această agenție este suspendat.");
  }
  if (membership.status === "revoked") {
    throw new ForbiddenError("Accesul dumneavoastră în această agenție a fost revocat.");
  }
  if (membership.status === "invited") {
    throw new ForbiddenError("Invitația dumneavoastră în această agenție nu a fost încă acceptată.");
  }
  if (membership.status !== "active") {
    throw new ForbiddenError("Statusul contului dumneavoastră nu permite accesul la datele agenției.");
  }
}

const PROVISIONED_SEED_INVITES: Array<{
  tenantId: string;
  email: string;
  name: string;
  role: UserRole;
  staffDocId: string;
}> = [
  {
    tenantId: "ten_brokr_default",
    email: "officepimob@gmail.com",
    name: "Petru Buliga",
    role: "agency_admin",
    staffDocId: "stf_petru_buliga",
  },
];

export class TenantMembershipService {
  private static syncedSeedInvites = new Set<string>();

  /**
   * Idempotently ensures provisioned seed invites (and matching staff cards) exist in Cloud
   * Firestore for the given tenant when an authenticated agency admin/owner accesses it.
   */
  public static async ensureSeedInvitesSyncedAsync(tenantId: string): Promise<void> {
    if (process.env.NODE_ENV === "test") return;
    if (this.syncedSeedInvites.has(tenantId)) return;
    if (!PersistentStoreService.isRemoteFirestoreConfigured()) return;

    const entries = PROVISIONED_SEED_INVITES.filter((e) => e.tenantId === tenantId);
    if (entries.length === 0) {
      this.syncedSeedInvites.add(tenantId);
      return;
    }

    let allSynced = true;
    for (const entry of entries) {
      const normalizedEmail = entry.email.toLowerCase().trim();
      const now = new Date().toISOString();
      try {
        const existingInvite = await PersistentStoreService.remoteGetAtPath<TenantMembershipRecord>(
          `tenants/${tenantId}/invites/${normalizedEmail}`,
          { silentOnStatuses: [403] }
        );
        if (!existingInvite) {
          const inviteRecord: TenantMembershipRecord = {
            id: normalizedEmail,
            tenantId,
            userId: normalizedEmail,
            email: normalizedEmail,
            name: entry.name,
            role: entry.role,
            status: "active",
            authVersion: 1,
            permissions: defaultPermissionsForRole(entry.role),
            createdAt: now,
            updatedAt: now,
          };
          await PersistentStoreService.remoteSetAtPath(
            `tenants/${tenantId}/invites/${normalizedEmail}`,
            inviteRecord
          );
        }

        const existingStaff = await PersistentStoreService.remoteListAtPath<Record<string, any>>(
          `tenants/${tenantId}/staff`,
          200,
          5,
          { silentOnStatuses: [403] }
        );
        const alreadyInStaff = existingStaff.some(
          (s) => String(s?.email || "").toLowerCase().trim() === normalizedEmail
        );
        if (!alreadyInStaff) {
          await PersistentStoreService.remoteSetAtPath(
            `tenants/${tenantId}/staff/${entry.staffDocId}`,
            {
              id: entry.staffDocId,
              staffId: entry.staffDocId,
              personalId: entry.staffDocId,
              tenantId,
              tenant_id: tenantId,
              name: entry.name,
              role: entry.role,
              phone: "",
              email: normalizedEmail,
              status: "Activ",
              createdAt: now,
              updatedAt: now,
            }
          );
        }
      } catch {
        allSynced = false;
      }
    }

    if (allSynced) {
      this.syncedSeedInvites.add(tenantId);
    }
  }
  /**
   * Fail-closed authVersion verification against optional compact Firebase custom claims.
   * Backward-compatible: if custom claims are not minted yet, passes cleanly;
   * once custom claims carry `uVer`, `tVer`, or `tid`, any stale or cross-tenant claim is denied immediately.
   */
  public static verifyAuthVersion(
    membership: TenantMembershipRecord,
    tenant: TenantRecord,
    tokenClaims?: { tid?: string; role?: string; tst?: string; uVer?: number; tVer?: number }
  ): void {
    if (!tokenClaims) return;

    if (tokenClaims.tid && tokenClaims.tid !== tenant.id) {
      throw new AppError({
        message: "Tokenul de sesiune aparține unei alte agenții.",
        code: "AUTH_TENANT_MISMATCH",
        statusCode: 403,
      });
    }

    const minUserVersion = membership.authVersion ?? 1;
    if (typeof tokenClaims.uVer === "number" && tokenClaims.uVer < minUserVersion) {
      throw new AppError({
        message: "Permisiunile contului au fost actualizate sau revocate. Vă rugăm să reîmprospătați sesiunea.",
        code: "AUTH_REVOKED",
        statusCode: 403,
      });
    }

    const minTenantVersion = tenant.authVersion ?? 1;
    if (typeof tokenClaims.tVer === "number" && tokenClaims.tVer < minTenantVersion) {
      throw new AppError({
        message: "Sesiunea agenției a fost invalidată. Vă rugăm să vă reautentificați.",
        code: "AUTH_REVOKED",
        statusCode: 403,
      });
    }
  }

  /**
   * Authoritative async membership check scaled for thousands of users per agency:
   * 1. O(1) direct Firestore lookup at /tenants/{tenantId}/users/{userId}
   * 2. O(1) invite lookup at /tenants/{tenantId}/invites/{normalizedEmail} (or indexed email query / pilot seed)
   * 3. Auto-binds the verified Firebase UID document at /tenants/{tenantId}/users/{userId}
   *    so Firestore security rules evaluate `isTenantMember(tenantId)` with zero scans.
   */
  public static async verifyMembershipAsync(
    tenantId: string,
    userId: string,
    email?: string,
    emailVerified?: boolean
  ): Promise<TenantMembershipRecord> {
    if (!tenantId || !userId) {
      throw new ForbiddenError("Date de autentificare sau identificator de agenție lipsă.");
    }

    if (process.env.NODE_ENV === "test" && !PersistentStoreService.isRemoteFirestoreConfigured()) {
      return this.verifyMembership(tenantId, userId, email, emailVerified);
    }

    await TenantResolutionService.hydrateSingleTenantFromFirestore(tenantId);
    const tenant = TenantResolutionService.getTenantById(tenantId);
    if (!tenant) {
      throw new TenantError(`Agenția "${tenantId}" nu a fost găsită.`, "TENANT_NOT_FOUND", tenantId);
    }

    if (tenant.status === "suspended") {
      throw new TenantError(
        `Contul agenției "${tenant.name}" este suspendat. Vă rugăm să contactați suportul.`,
        "TENANT_SUSPENDED",
        tenantId
      );
    }

    if (tenant.status === "cancelled") {
      throw new TenantError(
        `Contul agenției "${tenant.name}" a fost anulat.`,
        "TENANT_SUSPENDED",
        tenantId
      );
    }

    await TenantResolutionService.ensureTenantExistsInFirestore(tenantId);

    const normalizedEmail = email ? email.toLowerCase().trim() : "";

    // Fast path: check in-memory verified cache first
    let membership = PersistentStoreService.get<TenantMembershipRecord>(
      COL_MEMBERSHIPS,
      getMembershipKey(tenantId, userId)
    );

    if (PersistentStoreService.isRemoteFirestoreConfigured()) {
      // 1. O(1) direct lookup in /tenants/{tenantId}/users/{userId}
      try {
        const remoteDoc = await PersistentStoreService.remoteGetAtPath<TenantMembershipRecord>(
          `tenants/${tenantId}/users/${userId}`,
          { silentOnStatuses: [403] }
        );
        if (remoteDoc && remoteDoc.role && remoteDoc.status) {
          membership = {
            ...remoteDoc,
            id: remoteDoc.id || userId,
            tenantId,
            userId,
            authVersion: remoteDoc.authVersion ?? 1,
          };
          PersistentStoreService.setCacheOnly(
            COL_MEMBERSHIPS,
            getMembershipKey(tenantId, userId),
            membership
          );
          assertMembershipStatusAllowed(membership);
          if (membership.role === "agency_owner" || membership.role === "agency_admin") {
            const reqAuth = PersistentStoreService.getRequestAuth();
            const syncPromise = reqAuth
              ? PersistentStoreService.runWithRequestAuth(reqAuth, () =>
                  this.ensureSeedInvitesSyncedAsync(tenantId)
                )
              : this.ensureSeedInvitesSyncedAsync(tenantId);
            void syncPromise.catch(() => {});
          }
          return membership;
        }
      } catch (err: any) {
        const statusCode = err instanceof AppError ? err.statusCode : Number(err?.response?.status || 0);
        // Fail closed in production on upstream auth/Firestore 5xx/network outages instead of serving stale cache
        if (process.env.NODE_ENV === "production" && statusCode !== 403 && statusCode !== 404) {
          throw new AppError({
            message: "Serviciul de verificare a accesului este temporar indisponibil. Vă rugăm să încercați din nou.",
            code: "AUTH_BACKEND_UNAVAILABLE",
            statusCode: 503,
          });
        }
        // Might be 403 before user doc exists; fall through to invite / seed auto-binding
      }

      // 2. If not bound to UID yet and user has verified email, look up O(1) invite or indexed email
      if (!membership && normalizedEmail && emailVerified === true && !userId.startsWith("usr_") && !userId.startsWith("mock_")) {
        let candidate: TenantMembershipRecord | null = null;

        // 2a. O(1) lookup at /tenants/{tenantId}/invites/{normalizedEmail}
        try {
          const inviteDoc = await PersistentStoreService.remoteGetAtPath<TenantMembershipRecord>(
            `tenants/${tenantId}/invites/${normalizedEmail}`,
            { silentOnStatuses: [403] }
          );
          if (inviteDoc && inviteDoc.role && inviteDoc.status) {
            candidate = inviteDoc;
          }
        } catch {
          // Invite doc missing or inaccessible
        }

        // 2b. Indexed query on /tenants/{tenantId}/users WHERE email == normalizedEmail LIMIT 1
        if (!candidate) {
          try {
            const matched = await PersistentStoreService.remoteRunQueryAtPath<TenantMembershipRecord>(
              `tenants/${tenantId}`,
              {
                from: [{ collectionId: "users" }],
                where: {
                  fieldFilter: {
                    field: { fieldPath: "email" },
                    op: "EQUAL",
                    value: { stringValue: normalizedEmail },
                  },
                },
                limit: 1,
              },
              { silentOnStatuses: [403] }
            );
            if (matched.length > 0 && matched[0].data) {
              candidate = matched[0].data;
            }
          } catch {
            // Non-member cannot list users before binding; expected for first-time agent login
          }
        }

        // 2c. Built-in pilot owners/members seed fallback
        if (!candidate) {
          const seedMatch = SEED_MEMBERSHIPS.find(
            (m) => m.tenantId === tenantId && m.email.toLowerCase().trim() === normalizedEmail
          );
          if (seedMatch) {
            candidate = { ...seedMatch };
          }
        }

        if (candidate) {
          assertMembershipStatusAllowed(candidate);
          const now = new Date().toISOString();
          const boundRecord: TenantMembershipRecord = {
            id: userId,
            tenantId,
            userId,
            email: normalizedEmail,
            name: candidate.name || normalizedEmail,
            role: candidate.role,
            status: candidate.status,
            authVersion: candidate.authVersion ?? 1,
            permissions:
              Array.isArray(candidate.permissions) && candidate.permissions.length > 0
                ? candidate.permissions
                : defaultPermissionsForRole(candidate.role),
            createdAt: candidate.createdAt || now,
            updatedAt: now,
          };

          // Auto-provision /tenants/{tenantId}/users/{uid} in Firestore so subsequent Firestore Rules
          // & client SDK onSnapshot subscriptions work seamlessly for this user.
          try {
            await PersistentStoreService.remoteSetAtPath(
              `tenants/${tenantId}/users/${userId}`,
              boundRecord
            );
          } catch {
            // If rules blocked auto-provision (e.g. non-admin pilot seed without invite doc), continue
          }

          PersistentStoreService.setCacheOnly(
            COL_MEMBERSHIPS,
            getMembershipKey(tenantId, userId),
            boundRecord
          );
          if (boundRecord.role === "agency_owner" || boundRecord.role === "agency_admin") {
            const reqAuth = PersistentStoreService.getRequestAuth();
            const syncPromise = reqAuth
              ? PersistentStoreService.runWithRequestAuth(reqAuth, () =>
                  this.ensureSeedInvitesSyncedAsync(tenantId)
                )
              : this.ensureSeedInvitesSyncedAsync(tenantId);
            void syncPromise.catch(() => {});
          }
          return boundRecord;
        }
      }
    }

    if (membership) {
      assertMembershipStatusAllowed(membership);
      return membership;
    }

    // Final fallback to seeded / cached check
    return this.verifyMembership(tenantId, userId, email, emailVerified);
  }

  public static verifyMembership(
    tenantId: string,
    userId: string,
    email?: string,
    emailVerified?: boolean
  ): TenantMembershipRecord {
    if (!tenantId || !userId) {
      throw new ForbiddenError("Date de autentificare sau identificator de agenție lipsă.");
    }

    const tenant = TenantResolutionService.getTenantById(tenantId);
    if (!tenant) {
      throw new TenantError(`Agenția "${tenantId}" nu a fost găsită.`, "TENANT_NOT_FOUND", tenantId);
    }

    if (tenant.status === "suspended") {
      throw new TenantError(
        `Contul agenției "${tenant.name}" este suspendat. Vă rugăm să contactați suportul.`,
        "TENANT_SUSPENDED",
        tenantId
      );
    }

    if (tenant.status === "cancelled") {
      throw new TenantError(
        `Contul agenției "${tenant.name}" a fost anulat.`,
        "TENANT_SUSPENDED",
        tenantId
      );
    }

    const allMemberships = ensureMembershipsSeeded();
    let membership =
      PersistentStoreService.get<TenantMembershipRecord>(
        COL_MEMBERSHIPS,
        getMembershipKey(tenantId, userId)
      ) || allMemberships[getMembershipKey(tenantId, userId)];
    if (!membership && email && emailVerified === true && !userId.startsWith("usr_") && !userId.startsWith("mock_")) {
      const normalizedEmail = email.toLowerCase().trim();
      for (const [key, candidate] of Object.entries(allMemberships)) {
        if (key.startsWith(`${tenantId}::`) && candidate.email.toLowerCase().trim() === normalizedEmail) {
          membership = candidate;
          break;
        }
      }
    }

    if (!membership) {
      throw new ForbiddenError("Utilizatorul nu are acces sau nu este membru al acestei agenții.");
    }

    assertMembershipStatusAllowed(membership);
    return membership;
  }

  public static getMembership(tenantId: string, userId: string): TenantMembershipRecord | null {
    ensureMembershipsSeeded();
    return PersistentStoreService.get<TenantMembershipRecord>(
      COL_MEMBERSHIPS,
      getMembershipKey(tenantId, userId)
    );
  }

  public static async getMembershipAsync(
    tenantId: string,
    userId: string
  ): Promise<TenantMembershipRecord | null> {
    if (PersistentStoreService.isRemoteFirestoreConfigured()) {
      const remote = await PersistentStoreService.remoteGetAtPath<TenantMembershipRecord>(
        `tenants/${tenantId}/users/${userId}`
      );
      if (remote) {
        PersistentStoreService.setCacheOnly(
          COL_MEMBERSHIPS,
          getMembershipKey(tenantId, userId),
          remote
        );
        return remote;
      }
    }
    return this.getMembership(tenantId, userId);
  }

  public static setMembership(membership: TenantMembershipRecord): void {
    ensureMembershipsSeeded();
    PersistentStoreService.setCacheOnly(
      COL_MEMBERSHIPS,
      getMembershipKey(membership.tenantId, membership.userId),
      membership
    );
    if (process.env.NODE_ENV === "test") {
      PersistentStoreService.set(
        COL_MEMBERSHIPS,
        getMembershipKey(membership.tenantId, membership.userId),
        membership
      );
    } else if (PersistentStoreService.isRemoteFirestoreConfigured()) {
      const reqAuth = PersistentStoreService.getRequestAuth();
      const writePromise = reqAuth
        ? PersistentStoreService.runWithRequestAuth(reqAuth, () =>
            PersistentStoreService.remoteSetAtPath(
              `tenants/${membership.tenantId}/users/${membership.userId}`,
              membership
            )
          )
        : PersistentStoreService.remoteSetAtPath(
            `tenants/${membership.tenantId}/users/${membership.userId}`,
            membership
          );
      void writePromise.catch(() => {});
    }
  }

  public static async setMembershipAsync(
    membership: TenantMembershipRecord
  ): Promise<TenantMembershipRecord> {
    PersistentStoreService.setCacheOnly(
      COL_MEMBERSHIPS,
      getMembershipKey(membership.tenantId, membership.userId),
      membership
    );
    if (process.env.NODE_ENV !== "test" || PersistentStoreService.isRemoteFirestoreConfigured()) {
      await PersistentStoreService.remoteSetAtPath(
        `tenants/${membership.tenantId}/users/${membership.userId}`,
        membership
      );
    } else {
      PersistentStoreService.set(
        COL_MEMBERSHIPS,
        getMembershipKey(membership.tenantId, membership.userId),
        membership
      );
    }
    return membership;
  }

  /**
   * Automatically provisions/updates an agency invite document at
   * `/tenants/{tenantId}/invites/{normalizedEmail}` whenever an Agency Admin adds or updates
   * a staff member with an email, so the agent automatically receives permanent Firestore access
   * with their exact assigned role upon sign-in.
   */
  public static async upsertInviteForStaffEmailAsync(
    tenantId: string,
    params: { email: string; name?: string; role?: string; active?: boolean }
  ): Promise<void> {
    const normalizedEmail = String(params.email || "").toLowerCase().trim();
    if (!normalizedEmail || !normalizedEmail.includes("@")) return;
    if (process.env.NODE_ENV === "test" && !PersistentStoreService.isRemoteFirestoreConfigured()) {
      return;
    }
    if (!PersistentStoreService.isRemoteFirestoreConfigured()) return;

    const now = new Date().toISOString();
    const mappedRole = mapStaffRoleToTenantRole(params.role);
    const status: TenantMembershipStatus = params.active === false ? "suspended" : "active";

    const inviteRecord: TenantMembershipRecord = {
      id: normalizedEmail,
      tenantId,
      userId: normalizedEmail,
      email: normalizedEmail,
      name: params.name || normalizedEmail,
      role: mappedRole,
      status,
      permissions: defaultPermissionsForRole(mappedRole),
      createdAt: now,
      updatedAt: now,
    };

    try {
      await PersistentStoreService.remoteSetAtPath(
        `tenants/${tenantId}/invites/${normalizedEmail}`,
        inviteRecord
      );

      // If this user has already linked a Firebase UID in /tenants/{tenantId}/users, keep it in sync
      const existingUsers = await PersistentStoreService.remoteRunQueryAtPath<TenantMembershipRecord>(
        `tenants/${tenantId}`,
        {
          from: [{ collectionId: "users" }],
          where: {
            fieldFilter: {
              field: { fieldPath: "email" },
              op: "EQUAL",
              value: { stringValue: normalizedEmail },
            },
          },
          limit: 5,
        }
      );

      for (const { docId, data } of existingUsers) {
        // Never overwrite agency_owner role via staff edit
        const effectiveRole = data.role === "agency_owner" ? "agency_owner" : mappedRole;
        const effectiveStatus = data.role === "agency_owner" ? data.status : status;
        const privilegeChanged = effectiveRole !== data.role || effectiveStatus !== data.status;
        const nextAuthVersion = privilegeChanged
          ? (data.authVersion ?? 1) + 1
          : (data.authVersion ?? 1);

        const updatedUser: TenantMembershipRecord = {
          ...data,
          id: docId,
          tenantId,
          userId: data.userId || docId,
          email: normalizedEmail,
          name: params.name || data.name || normalizedEmail,
          role: effectiveRole,
          status: effectiveStatus,
          authVersion: nextAuthVersion,
          permissions: defaultPermissionsForRole(effectiveRole),
          updatedAt: now,
        };
        await PersistentStoreService.remoteSetAtPath(
          `tenants/${tenantId}/users/${docId}`,
          updatedUser
        );
        PersistentStoreService.setCacheOnly(
          COL_MEMBERSHIPS,
          getMembershipKey(tenantId, updatedUser.userId),
          updatedUser
        );
        if (privilegeChanged) {
          const tenantRec = TenantResolutionService.getTenantById(tenantId);
          void CustomClaimsService.syncUserClaims(updatedUser.userId, {
            tenantId,
            role: updatedUser.role,
            tenantStatus: tenantRec?.status || "active",
            userAuthVersion: nextAuthVersion,
            tenantAuthVersion: tenantRec?.authVersion ?? 1,
            revokeRefreshTokens: effectiveStatus === "suspended" || effectiveStatus === "revoked",
          }).catch(() => {});
        }
      }
    } catch {
      // Non-admin staff edits cannot write invites/users (enforced by Firestore rules)
    }
  }

  public static updateMemberRole(
    actorMembership: TenantMembershipRecord,
    targetUserId: string,
    newRole: UserRole
  ): TenantMembershipRecord {
    if (actorMembership.userId === targetUserId) {
      throw new ForbiddenError("Nu vă puteți modifica propriul rol sau nivel de permisiune.");
    }

    if (actorMembership.role !== "agency_owner" && actorMembership.role !== "agency_admin") {
      throw new ForbiddenError("Doar administratorul sau proprietarul agenției pot modifica rolurile.");
    }

    const target = this.getMembership(actorMembership.tenantId, targetUserId);
    if (!target) {
      throw new NotFoundError("Membrul agenției", targetUserId);
    }

    if (target.role === "agency_owner" && actorMembership.role !== "agency_owner") {
      throw new ForbiddenError("Doar proprietarul agenției poate modifica rolul unui alt proprietar.");
    }

    const roleChanged = target.role !== newRole;
    target.role = newRole;
    target.permissions = defaultPermissionsForRole(newRole);
    target.authVersion = roleChanged ? (target.authVersion ?? 1) + 1 : (target.authVersion ?? 1);
    target.updatedAt = new Date().toISOString();
    this.setMembership(target);

    if (roleChanged) {
      const tenantRec = TenantResolutionService.getTenantById(actorMembership.tenantId);
      void CustomClaimsService.syncUserClaims(target.userId, {
        tenantId: actorMembership.tenantId,
        role: target.role,
        tenantStatus: tenantRec?.status || "active",
        userAuthVersion: target.authVersion,
        tenantAuthVersion: tenantRec?.authVersion ?? 1,
      }).catch(() => {});
    }

    return target;
  }

  public static async updateMemberRoleAsync(
    actorMembership: TenantMembershipRecord,
    targetUserId: string,
    newRole: UserRole
  ): Promise<TenantMembershipRecord> {
    if (actorMembership.userId === targetUserId) {
      throw new ForbiddenError("Nu vă puteți modifica propriul rol sau nivel de permisiune.");
    }

    if (actorMembership.role !== "agency_owner" && actorMembership.role !== "agency_admin") {
      throw new ForbiddenError("Doar administratorul sau proprietarul agenției pot modifica rolurile.");
    }

    const target = await this.getMembershipAsync(actorMembership.tenantId, targetUserId);
    if (!target) {
      throw new NotFoundError("Membrul agenției", targetUserId);
    }

    if (target.role === "agency_owner" && actorMembership.role !== "agency_owner") {
      throw new ForbiddenError("Doar proprietarul agenției poate modifica rolul unui alt proprietar.");
    }

    const roleChanged = target.role !== newRole;
    target.role = newRole;
    target.permissions = defaultPermissionsForRole(newRole);
    target.authVersion = roleChanged ? (target.authVersion ?? 1) + 1 : (target.authVersion ?? 1);
    target.updatedAt = new Date().toISOString();
    const saved = await this.setMembershipAsync(target);

    if (roleChanged) {
      const tenantRec = TenantResolutionService.getTenantById(actorMembership.tenantId);
      void CustomClaimsService.syncUserClaims(saved.userId, {
        tenantId: actorMembership.tenantId,
        role: saved.role,
        tenantStatus: tenantRec?.status || "active",
        userAuthVersion: saved.authVersion ?? 1,
        tenantAuthVersion: tenantRec?.authVersion ?? 1,
      }).catch(() => {});
    }

    return saved;
  }

  public static updateMemberStatus(
    actorMembership: TenantMembershipRecord,
    targetUserId: string,
    newStatus: TenantMembershipStatus
  ): TenantMembershipRecord {
    if (actorMembership.userId === targetUserId) {
      throw new ForbiddenError("Nu vă puteți modifica propriul status de membru.");
    }

    if (actorMembership.role !== "agency_owner" && actorMembership.role !== "agency_admin") {
      throw new ForbiddenError("Doar administratorul sau proprietarul agenției pot modifica statusul membrilor.");
    }

    const target = this.getMembership(actorMembership.tenantId, targetUserId);
    if (!target) {
      throw new NotFoundError("Membrul agenției", targetUserId);
    }

    const statusChanged = target.status !== newStatus;
    target.status = newStatus;
    target.authVersion = statusChanged ? (target.authVersion ?? 1) + 1 : (target.authVersion ?? 1);
    target.updatedAt = new Date().toISOString();
    this.setMembership(target);

    if (statusChanged) {
      const tenantRec = TenantResolutionService.getTenantById(actorMembership.tenantId);
      void CustomClaimsService.syncUserClaims(target.userId, {
        tenantId: actorMembership.tenantId,
        role: target.role,
        tenantStatus: tenantRec?.status || "active",
        userAuthVersion: target.authVersion,
        tenantAuthVersion: tenantRec?.authVersion ?? 1,
        revokeRefreshTokens: newStatus === "suspended" || newStatus === "revoked",
      }).catch(() => {});
    }

    return target;
  }

  public static async updateMemberStatusAsync(
    actorMembership: TenantMembershipRecord,
    targetUserId: string,
    newStatus: TenantMembershipStatus
  ): Promise<TenantMembershipRecord> {
    if (actorMembership.userId === targetUserId) {
      throw new ForbiddenError("Nu vă puteți modifica propriul status de membru.");
    }

    if (actorMembership.role !== "agency_owner" && actorMembership.role !== "agency_admin") {
      throw new ForbiddenError("Doar administratorul sau proprietarul agenției pot modifica statusul membrilor.");
    }

    const target = await this.getMembershipAsync(actorMembership.tenantId, targetUserId);
    if (!target) {
      throw new NotFoundError("Membrul agenției", targetUserId);
    }

    const statusChanged = target.status !== newStatus;
    target.status = newStatus;
    target.authVersion = statusChanged ? (target.authVersion ?? 1) + 1 : (target.authVersion ?? 1);
    target.updatedAt = new Date().toISOString();
    const saved = await this.setMembershipAsync(target);

    if (statusChanged) {
      const tenantRec = TenantResolutionService.getTenantById(actorMembership.tenantId);
      void CustomClaimsService.syncUserClaims(saved.userId, {
        tenantId: actorMembership.tenantId,
        role: saved.role,
        tenantStatus: tenantRec?.status || "active",
        userAuthVersion: saved.authVersion ?? 1,
        tenantAuthVersion: tenantRec?.authVersion ?? 1,
        revokeRefreshTokens: newStatus === "suspended" || newStatus === "revoked",
      }).catch(() => {});
    }

    return saved;
  }

  public static listTenantMembers(tenantId: string): TenantMembershipRecord[] {
    const all = ensureMembershipsSeeded();
    const list: TenantMembershipRecord[] = [];
    for (const [key, mem] of Object.entries(all)) {
      if (key.startsWith(`${tenantId}::`)) {
        list.push(mem);
      }
    }
    return list;
  }

  public static async listTenantMembersAsync(tenantId: string): Promise<TenantMembershipRecord[]> {
    if (process.env.NODE_ENV === "test" && !PersistentStoreService.isRemoteFirestoreConfigured()) {
      return this.listTenantMembers(tenantId);
    }

    if (PersistentStoreService.isRemoteFirestoreConfigured()) {
      try {
        const remoteUsers = await PersistentStoreService.remoteListAtPath<TenantMembershipRecord>(
          `tenants/${tenantId}/users`,
          300,
          20,
          { silentOnStatuses: [403] }
        );
        const byEmail = new Map<string, TenantMembershipRecord>();
        for (const u of remoteUsers) {
          if (u && u.userId) {
            PersistentStoreService.setCacheOnly(
              COL_MEMBERSHIPS,
              getMembershipKey(tenantId, u.userId),
              u
            );
            byEmail.set((u.email || u.userId).toLowerCase(), u);
          }
        }
        // Include any seed defaults not yet present in Firestore
        for (const seed of SEED_MEMBERSHIPS) {
          if (seed.tenantId === tenantId) {
            const key = seed.email.toLowerCase();
            if (!byEmail.has(key)) {
              byEmail.set(key, seed);
            }
          }
        }
        return Array.from(byEmail.values());
      } catch {
        // Fallback to cached list
      }
    }

    return this.listTenantMembers(tenantId);
  }
}
