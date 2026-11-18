import { Validator, rules } from "../validation/validator";
import { UserRole, TenantMembershipStatus } from "./typ_tenant-context";

export interface UpdateMembershipRoleInput {
  targetUserId: string;
  newRole: UserRole;
}

export interface UpdateMembershipStatusInput {
  targetUserId: string;
  newStatus: TenantMembershipStatus;
}

export interface InviteTenantMemberInput {
  email: string;
  name: string;
  role: UserRole;
}

const ALLOWED_ROLES: UserRole[] = ["agency_owner", "agency_admin", "manager", "agent", "assistant"];
const ALLOWED_STATUSES: TenantMembershipStatus[] = ["invited", "active", "suspended", "revoked"];

export function updateMembershipRoleValidator() {
  return new Validator<UpdateMembershipRoleInput>()
    .addRule("targetUserId", rules.required("Identificatorul utilizatorului este obligatoriu"))
    .addRule("newRole", rules.required("Rolul nou este obligatoriu"))
    .addRule("newRole", (val: unknown) => {
      if (typeof val !== "string" || !ALLOWED_ROLES.includes(val as UserRole)) {
        return "Rol invalid. Rolurile permise sunt: " + ALLOWED_ROLES.join(", ");
      }
      return null;
    });
}

export function updateMembershipStatusValidator() {
  return new Validator<UpdateMembershipStatusInput>()
    .addRule("targetUserId", rules.required("Identificatorul utilizatorului este obligatoriu"))
    .addRule("newStatus", rules.required("Statusul nou este obligatoriu"))
    .addRule("newStatus", (val: unknown) => {
      if (typeof val !== "string" || !ALLOWED_STATUSES.includes(val as TenantMembershipStatus)) {
        return "Status invalid. Statusurile permise sunt: " + ALLOWED_STATUSES.join(", ");
      }
      return null;
    });
}

export function inviteTenantMemberValidator() {
  return new Validator<InviteTenantMemberInput>()
    .addRule("email", rules.required("Emailul este obligatoriu"))
    .addRule("email", rules.email())
    .addRule("name", rules.required("Numele este obligatoriu"))
    .addRule("role", rules.required("Rolul este obligatoriu"))
    .addRule("role", (val: unknown) => {
      if (typeof val !== "string" || !ALLOWED_ROLES.includes(val as UserRole)) {
        return "Rol invalid.";
      }
      return null;
    });
}
