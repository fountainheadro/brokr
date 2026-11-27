import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { useAuth } from "../auth/ctx_auth";
import { TenantRecord, TenantMembershipRecord, TenantContext, UserRole, DEFAULT_DEV_TENANT } from "./typ_tenant-context";
import { DEFAULT_PLATFORM_ROOT_DOMAIN, extractRootDomainFromHost } from "./svc_tenant-resolution";
import { setShareDomainContext } from "../../utils/shareUtils";
import { setActiveCrmTenantContext } from "../crm/svc_crm-client";
import { clientDataHub } from "../crm/svc_client-data-hub";

export interface ActivePreviewInfo {
  token: string;
  tenantId: string;
  tenantName: string;
  subdomain: string;
  simulatedRole: UserRole;
  effectivePermissions: string[];
  effectiveModules: string[];
  superAdminEmail: string;
  expiresAt: string;
}

export interface TenantContextState {
  tenant: TenantRecord | null;
  membership: TenantMembershipRecord | null;
  tenantContext: TenantContext | null;
  isLoading: boolean;
  isAccessDenied: boolean;
  accessDeniedReason: string | null;
  isPlatformAdminHost: boolean;
  platformRootDomain: string;
  previewSession: ActivePreviewInfo | null;
  refreshTenant: () => Promise<void>;
  startPreview: (tenantId: string, simulatedRole?: UserRole) => Promise<ActivePreviewInfo>;
  switchSimulatedRole: (newRole: UserRole) => Promise<void>;
  exitPreview: () => Promise<void>;
}

const TenantReactContext = createContext<TenantContextState | undefined>(undefined);

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoading: isAuthLoading } = useAuth();
  const [tenant, setTenant] = useState<TenantRecord | null>(null);
  const [membership, _setMembership] = useState<TenantMembershipRecord | null>(null);
  const [tenantContext, setTenantContext] = useState<TenantContext | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isAccessDenied, setIsAccessDenied] = useState<boolean>(false);
  const [accessDeniedReason, setAccessDeniedReason] = useState<string | null>(null);
  const [isPlatformAdminHost, setIsPlatformAdminHost] = useState<boolean>(() =>
    typeof window !== "undefined" && window.location.hostname.toLowerCase().startsWith("admin.")
  );
  const [platformRootDomain, setPlatformRootDomain] = useState<string>(() => {
    if (typeof window !== "undefined" && window.location?.hostname) {
      return extractRootDomainFromHost(window.location.hostname) || DEFAULT_PLATFORM_ROOT_DOMAIN;
    }
    return DEFAULT_PLATFORM_ROOT_DOMAIN;
  });
  const [previewSession, setPreviewSession] = useState<ActivePreviewInfo | null>(null);

  const resolveTenant = useCallback(async () => {
    setIsLoading(true);
    setIsAccessDenied(false);
    setAccessDeniedReason(null);

    const storedPreviewToken = localStorage.getItem("brokr_preview_token");

    if (storedPreviewToken && user) {
      try {
        const authToken = await user.getIdToken();
        const previewStatusRes = await fetch("/api/platform/preview/status", {
          headers: {
            Authorization: `Bearer ${authToken}`,
            "x-preview-token": storedPreviewToken,
          },
        });

        if (previewStatusRes.ok) {
          const previewJson = await previewStatusRes.json();
          if (previewJson.success && previewJson.data?.isActive && previewJson.data.session) {
            const s = previewJson.data.session;
            const previewInfo: ActivePreviewInfo = {
              token: s.token,
              tenantId: s.tenantId,
              tenantName: s.tenantName,
              subdomain: s.subdomain,
              simulatedRole: s.simulatedRole,
              effectivePermissions: s.effectivePermissions || ["*"],
              effectiveModules: s.effectiveModules || [],
              superAdminEmail: s.superAdminEmail,
              expiresAt: s.expiresAt,
            };

            setPreviewSession(previewInfo);
            if (typeof previewJson.data?.platformRootDomain === "string" && previewJson.data.platformRootDomain.trim()) {
              setPlatformRootDomain(previewJson.data.platformRootDomain.trim().toLowerCase());
            }

            const simTenant: TenantRecord = {
              id: s.tenantId,
              subdomain: s.subdomain,
              name: s.tenantName,
              status: "active",
              planId: "plan_enterprise",
              branding: {
                agencyName: s.tenantName,
                primaryColor: "#051D35",
                accentColor: "#BE9662",
                contactEmail: `contact@${s.subdomain}.ro`,
              },
              enabledModules: s.effectiveModules || DEFAULT_DEV_TENANT.enabledModules,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            setTenant(simTenant);

            const simContext: TenantContext = {
              tenantId: s.tenantId,
              tenantStatus: "active",
              tenantName: s.tenantName,
              tenantDomain: s.subdomain,
              userId: user?.uid || "usr_superadmin_sim",
              userEmail: user?.email || s.superAdminEmail || "superadmin@ourcrm.com",
              membershipId: `prev_mem_${s.tenantId}`,
              membershipStatus: "active",
              role: s.simulatedRole,
              permissions: s.effectivePermissions || ["*"],
            };
            setTenantContext(simContext);
            setIsLoading(false);
            return;
          }
        }
      } catch (err) {
        console.warn("[TenantProvider] Error restoring preview session:", err);
      }

      localStorage.removeItem("brokr_preview_token");
      setPreviewSession(null);
    }

    try {
      const res = await fetch("/api/tenant/resolve");
      if (!res.ok) {
        if (res.status === 404) {
          setIsAccessDenied(true);
          setAccessDeniedReason("Domeniul accesat nu este asociat unei agenții valide.");
          setIsLoading(false);
          return;
        }
      }

      const json = await res.json();
      let resolvedPlatformAdmin = false;
      if (json.success && json.data) {
        const resolvedData = json.data;
        if (typeof resolvedData.platformRootDomain === "string" && resolvedData.platformRootDomain.trim()) {
          setPlatformRootDomain(resolvedData.platformRootDomain.trim().toLowerCase());
        }
        if (resolvedData.type === "platform_admin") {
          resolvedPlatformAdmin = true;
          setIsPlatformAdminHost(true);
          setTenant(null);
          setTenantContext(null);
        } else if (resolvedData.tenantId) {
          setIsPlatformAdminHost(false);
          const loadedTenant: TenantRecord = {
            id: resolvedData.tenantId,
            subdomain: resolvedData.subdomain || "default",
            name: resolvedData.name || "Agenție Imobiliară",
            status: resolvedData.status || "active",
            planId: "plan_enterprise",
            branding: resolvedData.branding || DEFAULT_DEV_TENANT.branding,
            enabledModules: resolvedData.enabledModules || DEFAULT_DEV_TENANT.enabledModules,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          setTenant(loadedTenant);

          if (loadedTenant.status === "suspended") {
            setIsAccessDenied(true);
            setAccessDeniedReason("Contul acestei agenții este suspendat. Vă rugăm să contactați administratorul.");
            setIsLoading(false);
            return;
          }
        } else {
          setIsPlatformAdminHost(false);
          setTenant(DEFAULT_DEV_TENANT);
        }
      } else {
        setIsPlatformAdminHost(false);
        setTenant(DEFAULT_DEV_TENANT);
      }

      if (user && !resolvedPlatformAdmin) {
        try {
          const token = await user.getIdToken();
          const meRes = await fetch("/api/tenant/me", {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });

          if (!meRes.ok) {
            const errData = await meRes.json().catch(() => ({}));
            if (meRes.status === 403 || meRes.status === 401) {
              setIsAccessDenied(true);
              setAccessDeniedReason(
                errData?.error?.message || "Nu aveți permisiunea de a accesa această agenție."
              );
            }
          } else {
            const meJson = await meRes.json();
            if (meJson.success && meJson.data) {
              const { tenant: hydratedTenant, ...verifiedContext } = meJson.data;
              setTenantContext(verifiedContext);
              if (hydratedTenant && typeof hydratedTenant === "object" && hydratedTenant.id) {
                setTenant(hydratedTenant);
              }
            }
          }
        } catch (authErr) {
          console.warn("[TenantProvider] Error verifying membership with backend:", authErr);
        }
      }
    } catch (e: any) {
      console.warn("[TenantProvider] Tenant resolution fallback to default:", e);
      setTenant(DEFAULT_DEV_TENANT);
    } finally {
      setIsLoading(false);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("brokr:tenant-changed"));
      }
    }
  }, [user]);

  const startPreview = useCallback(
    async (tenantId: string, simulatedRole: UserRole = "agency_admin"): Promise<ActivePreviewInfo> => {
      let authToken = "";
      if (user) {
        authToken = await user.getIdToken();
      }

      const res = await fetch("/api/platform/preview/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ tenantId, simulatedRole }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || "Nu s-a putut porni sesiunea de testare a agenției.");
      }

      const json = await res.json();
      const s = json.data;
      localStorage.setItem("brokr_preview_token", s.token);

      const previewInfo: ActivePreviewInfo = {
        token: s.token,
        tenantId: s.tenantId,
        tenantName: s.tenantName,
        subdomain: s.subdomain,
        simulatedRole: s.simulatedRole,
        effectivePermissions: s.effectivePermissions,
        effectiveModules: s.effectiveModules,
        superAdminEmail: user?.email || "superadmin@ourcrm.com",
        expiresAt: s.expiresAt,
      };

      setPreviewSession(previewInfo);
      if (typeof s?.platformRootDomain === "string" && s.platformRootDomain.trim()) {
        setPlatformRootDomain(s.platformRootDomain.trim().toLowerCase());
      }
      await resolveTenant();
      return previewInfo;
    },
    [user, resolveTenant]
  );

  const switchSimulatedRole = useCallback(
    async (newRole: UserRole) => {
      const storedToken = localStorage.getItem("brokr_preview_token");
      if (!storedToken) return;

      const authToken = user ? await user.getIdToken() : "";
      const res = await fetch("/api/platform/preview/switch-role", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ previewToken: storedToken, newRole }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || "Eroare la schimbarea rolului simulat.");
      }

      const json = await res.json();
      const s = json.data;

      if (previewSession) {
        setPreviewSession({
          ...previewSession,
          simulatedRole: s.simulatedRole,
          effectivePermissions: s.effectivePermissions,
          effectiveModules: s.effectiveModules,
        });
      }

      if (tenantContext) {
        setTenantContext({
          ...tenantContext,
          role: s.simulatedRole,
          permissions: s.effectivePermissions,
        });
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("brokr:tenant-changed"));
      }
    },
    [previewSession, tenantContext, user]
  );

  const exitPreview = useCallback(async () => {
    const storedToken = localStorage.getItem("brokr_preview_token");
    if (storedToken) {
      try {
        const authToken = user ? await user.getIdToken() : "";
        await fetch("/api/platform/preview/exit", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({ previewToken: storedToken }),
        });
      } catch (err) {
        console.warn("[TenantProvider] Error calling preview exit:", err);
      }
      localStorage.removeItem("brokr_preview_token");
    }

    setPreviewSession(null);
    await resolveTenant();
  }, [user, resolveTenant]);

  useEffect(() => {
    if (!isAuthLoading) {
      resolveTenant();
    }
  }, [isAuthLoading, resolveTenant]);

  useEffect(() => {
    setShareDomainContext({
      rootDomain: platformRootDomain,
      agencySubdomain: previewSession?.subdomain || tenant?.subdomain || null,
    });
  }, [platformRootDomain, tenant?.subdomain, previewSession?.subdomain]);

  useEffect(() => {
    setActiveCrmTenantContext(
      tenantContext?.tenantId || null,
      Boolean(previewSession)
    );
  }, [tenantContext?.tenantId, previewSession, user?.uid]);

  // Lightweight live listener on the authenticated user's single membership doc
  // (/tenants/{tid}/users/{uid}) to propagate revocations, suspensions, or authVersion bumps immediately.
  const lastObservedAuthVersionRef = useRef<number | null>(null);
  useEffect(() => {
    const activeTenantId = tenantContext?.tenantId;
    if (!user?.uid || !activeTenantId || previewSession || isPlatformAdminHost) {
      lastObservedAuthVersionRef.current = null;
      return;
    }

    lastObservedAuthVersionRef.current = tenantContext?.userAuthVersion ?? 1;
    const memberDocRef = doc(db, "tenants", activeTenantId, "users", user.uid);
    const unsub = onSnapshot(
      memberDocRef,
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data() as Partial<TenantMembershipRecord>;
        const nextStatus = data.status;
        if (nextStatus === "suspended" || nextStatus === "revoked") {
          clientDataHub.purgeAllCaches();
          setTenantContext(null);
          setIsAccessDenied(true);
          setAccessDeniedReason(
            nextStatus === "revoked"
              ? "Accesul dumneavoastră în această agenție a fost revocat."
              : "Contul dumneavoastră de utilizator în această agenție a fost suspendat."
          );
          return;
        }

        const nextAuthVersion = typeof data.authVersion === "number" ? data.authVersion : 1;
        const roleChanged = Boolean(data.role && tenantContext?.role && data.role !== tenantContext.role);
        if (
          (lastObservedAuthVersionRef.current !== null && nextAuthVersion > lastObservedAuthVersionRef.current) ||
          roleChanged
        ) {
          lastObservedAuthVersionRef.current = nextAuthVersion;
          void user
            .getIdToken(true)
            .catch(() => {})
            .finally(() => {
              void resolveTenant();
            });
        }
      },
      () => {
        // Ignore transient permission errors before membership doc is provisioned
      }
    );

    return () => {
      unsub();
    };
  }, [user, tenantContext?.tenantId, tenantContext?.role, tenantContext?.userAuthVersion, previewSession, isPlatformAdminHost, resolveTenant]);

  const value = useMemo<TenantContextState>(
    () => ({
      tenant,
      membership,
      tenantContext,
      isLoading: isLoading || isAuthLoading,
      isAccessDenied,
      accessDeniedReason,
      isPlatformAdminHost,
      platformRootDomain,
      previewSession,
      refreshTenant: resolveTenant,
      startPreview,
      switchSimulatedRole,
      exitPreview,
    }),
    [
      tenant,
      membership,
      tenantContext,
      isLoading,
      isAuthLoading,
      isAccessDenied,
      accessDeniedReason,
      isPlatformAdminHost,
      platformRootDomain,
      previewSession,
      resolveTenant,
      startPreview,
      switchSimulatedRole,
      exitPreview,
    ]
  );

  return <TenantReactContext.Provider value={value}>{children}</TenantReactContext.Provider>;
}

/**
 * Lightweight, zero-network TenantContext provider strictly for external public share routes
 * (`/share/:id` and `/p/:id`). Avoids mounting Firebase Auth, `/api/tenant/resolve`, or
 * Firestore membership listeners so SSR-hydrated properties and prefetched images paint immediately.
 */
export function PublicShareTenantProvider({ children }: { children: React.ReactNode }) {
  const value = useMemo<TenantContextState>(() => {
    const detectedRoot =
      typeof window !== "undefined" && window.location?.hostname
        ? extractRootDomainFromHost(window.location.hostname) || DEFAULT_PLATFORM_ROOT_DOMAIN
        : DEFAULT_PLATFORM_ROOT_DOMAIN;

    return {
      tenant: null,
      membership: null,
      tenantContext: null,
      isLoading: false,
      isAccessDenied: false,
      accessDeniedReason: null,
      isPlatformAdminHost: false,
      platformRootDomain: detectedRoot,
      previewSession: null,
      refreshTenant: async () => {},
      startPreview: async () => {
        throw new Error("Preview unavailable on public share pages.");
      },
      switchSimulatedRole: async () => {},
      exitPreview: async () => {},
    };
  }, []);

  return <TenantReactContext.Provider value={value}>{children}</TenantReactContext.Provider>;
}

export function useTenantContext(): TenantContextState {
  const ctx = useContext(TenantReactContext);
  if (!ctx) {
    throw new Error("useTenantContext trebuie utilizat în interiorul unui TenantProvider.");
  }
  return ctx;
}
