import { ForbiddenError, TenantError, NotFoundError } from "../errors/app_error";
import { TenantMembershipRecord, UserRole, TenantMembershipStatus } from "./typ_tenant-context";
import { TenantResolutionService } from "./svc_tenant-resolution";
import { PersistentStoreService } from "../database/svc_persistent-store";

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
  const existing = PersistentStoreService.getAll<TenantMembershipRecord>(COL_MEMBERSHIPS);
  if (Object.keys(existing).length === 0) {
    for (const m of SEED_MEMBERSHIPS) {
      const k = getMembershipKey(m.tenantId, m.userId);
      PersistentStoreService.set(COL_MEMBERSHIPS, k, { ...m });
      existing[k] = { ...m };
    }
  }
  return existing;
}

export class TenantMembershipService {
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

    return membership;
  }

  public static getMembership(tenantId: string, userId: string): TenantMembershipRecord | null {
    ensureMembershipsSeeded();
    return PersistentStoreService.get<TenantMembershipRecord>(
      COL_MEMBERSHIPS,
      getMembershipKey(tenantId, userId)
    );
  }

  public static setMembership(membership: TenantMembershipRecord): void {
    ensureMembershipsSeeded();
    PersistentStoreService.set(
      COL_MEMBERSHIPS,
      getMembershipKey(membership.tenantId, membership.userId),
      membership
    );
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

    target.role = newRole;
    target.updatedAt = new Date().toISOString();
    this.setMembership(target);
    return target;
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

    target.status = newStatus;
    target.updatedAt = new Date().toISOString();
    this.setMembership(target);
    return target;
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
}
