import type { Lead } from "../services/leadsService";
import type { PersonalMember } from "../services/personalService";

export interface AgencyMemberSummary {
  id?: string;
  userId?: string;
  name?: string;
  email?: string;
  role?: string;
  status?: string;
}

export interface CurrentAgentIdentity {
  uid: string;
  name: string;
  email: string;
}

export interface LeadAgentOption {
  id: string;
  label: string;
  isCurrentAgent?: boolean;
  uids: string[];
  emails: string[];
  normalizedNames: string[];
}

const SYSTEM_AGENT_NAMES = new Set([
  "auto crawl platform",
  "auto crawl",
  "autocrawl",
  "nespecificat",
  "n/a",
  "-",
  "consilier brokr.",
  "consilier brokr",
  "consilier imobiliar",
  "system",
]);

export function normalizeAgentName(value?: string | null): string {
  if (!value || typeof value !== "string") return "";
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function normalizeAgentEmail(value?: string | null): string {
  if (!value || typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

export function isSystemAgentName(value?: string | null): boolean {
  const norm = normalizeAgentName(value);
  if (!norm) return true;
  return SYSTEM_AGENT_NAMES.has(norm);
}

export function cleanAgentDisplayName(value?: string | null): string {
  if (!value || typeof value !== "string") return "";
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed || isSystemAgentName(trimmed)) return "";
  return trimmed;
}

export function formatEmailToDisplayName(email?: string | null): string {
  const norm = normalizeAgentEmail(email);
  if (!norm) return "";
  const local = norm.split("@")[0] || "";
  if (!local) return "";
  return local
    .replace(/[._-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function addUnique(target: string[], value?: string | null): void {
  if (!value) return;
  if (!target.includes(value)) {
    target.push(value);
  }
}

export function resolveCurrentAgentIdentity(params: {
  user?: { uid?: string | null; email?: string | null; displayName?: string | null } | null;
  tenantContext?: { userId?: string; userEmail?: string } | null;
  agencyMembers?: AgencyMemberSummary[];
  personal?: PersonalMember[];
}): CurrentAgentIdentity {
  const { user, tenantContext, agencyMembers = [], personal = [] } = params;
  const uid = String(user?.uid || tenantContext?.userId || "").trim();
  const email = normalizeAgentEmail(user?.email || tenantContext?.userEmail);
  const authDisplayName = cleanAgentDisplayName(user?.displayName);
  const authNormName = normalizeAgentName(authDisplayName);

  const personalMatch = personal.find((m) => {
    const mEmail = normalizeAgentEmail(m.email);
    if (email && mEmail && mEmail === email) return true;
    const mNorm = normalizeAgentName(m.name);
    if (authNormName && mNorm && mNorm === authNormName) return true;
    return false;
  });

  const memberMatch = agencyMembers.find((m) => {
    const mEmail = normalizeAgentEmail(m.email);
    if (email && mEmail && mEmail === email) return true;
    if (uid && m.userId && m.userId === uid) return true;
    if (tenantContext?.userId && m.userId && m.userId === tenantContext.userId) return true;
    return false;
  });

  const name =
    cleanAgentDisplayName(personalMatch?.name) ||
    authDisplayName ||
    cleanAgentDisplayName(memberMatch?.name) ||
    formatEmailToDisplayName(email) ||
    "Agent curent";

  return {
    uid,
    name,
    email,
  };
}

/**
 * Checks whether a lead already has a real (non-system) agency agent assigned.
 */
export function hasRealLeadAgent(lead?: Partial<Lead> | null): boolean {
  if (!lead) return false;
  if (lead.isSharedLead) return false;

  const email = normalizeAgentEmail(lead.agentEmail || lead.createdByEmail);
  if (email) return true;

  const names = [
    lead.agent,
    lead.createdByName,
    lead.author,
    (lead as any).assignedTo,
  ];
  return names.some((n) => Boolean(cleanAgentDisplayName(n)));
}

/**
 * Builds the agent filter dropdown options for Lead-uri:
 * 1. "Toate"
 * 2. Current logged-in agent name (ALWAYS 2nd)
 * 3..N. Remaining agency agents sorted alphabetically (Romanian locale)
 */
export function buildLeadAgentFilterOptions(params: {
  user?: { uid?: string | null; email?: string | null; displayName?: string | null } | null;
  tenantContext?: { userId?: string; userEmail?: string } | null;
  agencyMembers?: AgencyMemberSummary[];
  personal?: PersonalMember[];
  leads?: Lead[];
}): LeadAgentOption[] {
  const { user, tenantContext, agencyMembers = [], personal = [], leads = [] } = params;

  const currentIdentity = resolveCurrentAgentIdentity({
    user,
    tenantContext,
    agencyMembers,
    personal,
  });

  const currentUids: string[] = [];
  const currentEmails: string[] = [];
  const currentNormalizedNames: string[] = [];

  addUnique(currentUids, currentIdentity.uid);
  addUnique(currentUids, user?.uid ? String(user.uid).trim() : "");
  addUnique(currentUids, tenantContext?.userId ? String(tenantContext.userId).trim() : "");

  addUnique(currentEmails, currentIdentity.email);
  addUnique(currentEmails, normalizeAgentEmail(user?.email));
  addUnique(currentEmails, normalizeAgentEmail(tenantContext?.userEmail));

  addUnique(currentNormalizedNames, normalizeAgentName(currentIdentity.name));
  addUnique(currentNormalizedNames, normalizeAgentName(user?.displayName));
  if (currentIdentity.email) {
    addUnique(currentNormalizedNames, normalizeAgentName(formatEmailToDisplayName(currentIdentity.email)));
  }

  const currentOption: LeadAgentOption = {
    id: currentIdentity.email
      ? `agent:${currentIdentity.email}`
      : currentIdentity.uid
        ? `agent:uid:${currentIdentity.uid}`
        : `agent:name:${normalizeAgentName(currentIdentity.name) || "current"}`,
    label: currentIdentity.name,
    isCurrentAgent: true,
    uids: currentUids,
    emails: currentEmails,
    normalizedNames: currentNormalizedNames,
  };

  const others: LeadAgentOption[] = [];

  const matchesOption = (
    opt: LeadAgentOption,
    candidate: { uid?: string; email?: string; normName?: string }
  ): boolean => {
    if (candidate.email && opt.emails.includes(candidate.email)) return true;
    if (candidate.uid && opt.uids.includes(candidate.uid)) return true;
    if (candidate.normName && opt.normalizedNames.includes(candidate.normName)) return true;
    return false;
  };

  const mergeIntoOption = (
    opt: LeadAgentOption,
    candidate: { uid?: string; email?: string; displayName?: string; normName?: string }
  ) => {
    addUnique(opt.uids, candidate.uid);
    addUnique(opt.emails, candidate.email);
    addUnique(opt.normalizedNames, candidate.normName);
    if (candidate.email) {
      addUnique(opt.normalizedNames, normalizeAgentName(formatEmailToDisplayName(candidate.email)));
    }
    if (
      !opt.isCurrentAgent &&
      candidate.displayName &&
      (!opt.label || opt.label.includes("@") || candidate.displayName.length > opt.label.length)
    ) {
      opt.label = candidate.displayName;
    }
  };

  const upsertAgent = (raw: { name?: string | null; email?: string | null; uid?: string | null }) => {
    const email = normalizeAgentEmail(raw.email);
    const uid = String(raw.uid || "").trim();
    const displayName = cleanAgentDisplayName(raw.name) || formatEmailToDisplayName(email);
    const normName = normalizeAgentName(displayName);

    if (!displayName && !email) return;

    const candidate = { uid, email, displayName, normName };

    // If this matches the current agent, absorb identifiers into currentOption (keep it strictly in 2nd place)
    if (matchesOption(currentOption, candidate)) {
      mergeIntoOption(currentOption, candidate);
      return;
    }

    const existing = others.find((opt) => matchesOption(opt, candidate));
    if (existing) {
      mergeIntoOption(existing, candidate);
      return;
    }

    const newOption: LeadAgentOption = {
      id: email
        ? `agent:${email}`
        : uid
          ? `agent:uid:${uid}`
          : `agent:name:${normName}`,
      label: displayName || email,
      isCurrentAgent: false,
      uids: [],
      emails: [],
      normalizedNames: [],
    };
    mergeIntoOption(newOption, candidate);
    others.push(newOption);
  };

  // 1. Agency staff / personal directory
  for (const member of personal) {
    upsertAgent({
      name: member.name,
      email: member.email,
    });
  }

  // 2. Active authenticated tenant members
  for (const member of agencyMembers) {
    if (member.status && member.status !== "active") continue;
    upsertAgent({
      name: member.name,
      email: member.email,
      uid: member.userId,
    });
  }

  // 3. Agents attributed on existing Noi (ListaMea / agency Noi) or Pierdute agency leads
  for (const lead of leads) {
    if (lead.status !== "ListaMea" && lead.status !== "Pierdute" && lead.status !== "Noi") continue;
    if (lead.isSharedLead) continue;
    const rawName =
      cleanAgentDisplayName(lead.agent) ||
      cleanAgentDisplayName(lead.createdByName) ||
      cleanAgentDisplayName(lead.author) ||
      cleanAgentDisplayName((lead as any).assignedTo);
    const rawEmail = normalizeAgentEmail(lead.agentEmail || lead.createdByEmail);
    const rawUid = String(lead.agentUid || lead.createdByUid || "").trim();
    if (rawName || rawEmail) {
      upsertAgent({
        name: rawName,
        email: rawEmail,
        uid: rawUid,
      });
    }
  }

  others.sort((a, b) => a.label.localeCompare(b.label, "ro", { sensitivity: "base" }));

  return [
    {
      id: "all",
      label: "Toate",
      uids: [],
      emails: [],
      normalizedNames: [],
    },
    currentOption,
    ...others,
  ];
}

/**
 * Returns true if the given lead belongs to the selected agent filter option.
 * Always returns true when selectedOption is "all" ("Toate").
 */
export function matchesLeadAgentFilter(
  lead: Lead,
  selectedOption?: LeadAgentOption | null
): boolean {
  if (!selectedOption || selectedOption.id === "all") {
    return true;
  }

  const leadAgentUid = String(lead.agentUid || "").trim();
  const leadCreatedByUid = String(lead.createdByUid || (lead as any).ownerUid || "").trim();
  const leadEmail = normalizeAgentEmail(lead.agentEmail || lead.createdByEmail);

  const leadNormalizedNames = [
    lead.agent,
    lead.createdByName,
    lead.author,
    (lead as any).assignedTo,
  ]
    .map((n) => cleanAgentDisplayName(n))
    .filter(Boolean)
    .map((n) => normalizeAgentName(n));

  if (leadEmail && selectedOption.emails.includes(leadEmail)) {
    return true;
  }

  if (leadNormalizedNames.some((n) => selectedOption.normalizedNames.includes(n))) {
    return true;
  }

  if (leadAgentUid && selectedOption.uids.includes(leadAgentUid)) {
    return true;
  }

  // Fallback to createdByUid ONLY when no conflicting explicit email or agent name is set
  if (
    leadCreatedByUid &&
    selectedOption.uids.includes(leadCreatedByUid) &&
    !leadEmail &&
    leadNormalizedNames.length === 0
  ) {
    return true;
  }

  return false;
}
