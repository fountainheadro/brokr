import { Validator, rules } from "../../../src/core/validation/validator";

export interface CreateTenantInput {
  agency_name: string;
  subdomain: string;
  owner_email: string;
  owner_name: string;
  plan_id: string;
}

export function create_tenant_validator() {
  return new Validator<CreateTenantInput>()
    .addRule("agency_name", rules.required("Numele agenției este obligatoriu"))
    .addRule("subdomain", rules.required("Subdomeniul este obligatoriu"))
    .addRule("subdomain", rules.subdomain())
    .addRule("owner_email", rules.required("Emailul administratorului este obligatoriu"))
    .addRule("owner_email", rules.email())
    .addRule("owner_name", rules.required("Numele administratorului este obligatoriu"))
    .addRule("plan_id", rules.required("Planul tarifar este obligatoriu"));
}

export const createTenantValidator = create_tenant_validator;

export * from "./utl_crm-normalizer";
