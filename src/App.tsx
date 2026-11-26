import React, { Component, Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import { NotificationManager } from "./components/NotificationManager";
import { NotificationProvider } from "./components/NotificationProvider";
import { AuthProvider } from "./core/auth/ctx_auth";
import { TenantProvider, useTenantContext } from "./core/tenancy/ctx_tenant";
import { MolPreviewBanner } from "./ui/molecules/platform/mol_preview-banner";
import { MolErrorRecoveryBanner } from "./ui/molecules/common/mol_error-recovery-banner";
import { useDataHubSyncState } from "./core/crm/hooks_crm-hub";
import { clientDataHub } from "./core/crm/svc_client-data-hub";

const RELOAD_GUARD_KEY = "brokr_lazy_chunk_reload_ts";

function isDynamicImportError(err: unknown): boolean {
  const msg = String((err as any)?.message || err || "");
  return (
    msg.includes("Failed to fetch dynamically imported module") ||
    msg.includes("Importing a module script failed") ||
    msg.includes("Loading chunk") ||
    msg.includes("ChunkLoadError")
  );
}

/**
 * Resilient React.lazy wrapper that retries transient dynamic import failures
 * (e.g. during dev server restarts or post-deploy chunk hash changes) before
 * performing a single guarded page refresh.
 */
function lazyWithRetry<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  retries = 3
): React.LazyExoticComponent<T> {
  return lazy(async () => {
    let lastError: unknown;
    const delays = [350, 800, 1500];

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await factory();
      } catch (err) {
        lastError = err;
        if (!isDynamicImportError(err) || attempt === retries) {
          break;
        }
        const waitMs = delays[Math.min(attempt, delays.length - 1)];
        await new Promise((resolve) => window.setTimeout(resolve, waitMs));
      }
    }

    // One-shot guarded reload when a stale module/chunk hash persists after retries
    if (typeof window !== "undefined" && isDynamicImportError(lastError)) {
      try {
        const lastReload = Number(window.sessionStorage.getItem(RELOAD_GUARD_KEY) || "0");
        const now = Date.now();
        if (!lastReload || now - lastReload > 15_000) {
          window.sessionStorage.setItem(RELOAD_GUARD_KEY, String(now));
          window.location.reload();
          return await new Promise<{ default: T }>(() => {});
        }
      } catch {
        // Ignore sessionStorage restrictions
      }
    }

    throw lastError;
  });
}

// Route-level lazy loading with automatic retry for transient chunk/module fetch errors
const Home = lazyWithRetry(() => import("./pages/Home").then((m) => ({ default: m.Home })));
const SharedProperty = lazyWithRetry(() => import("./pages/SharedProperty").then((m) => ({ default: m.SharedProperty })));
const PgDesignSystemShowcase = lazyWithRetry(() => import("./pages/pg_design-system-showcase").then((m) => ({ default: m.PgDesignSystemShowcase })));

// Platform Super Admin routes (lazy loaded)
const PgPlatformDashboard = lazyWithRetry(() => import("./pages/platform/pg_platform-dashboard").then((m) => ({ default: m.PgPlatformDashboard })));
const PgPlatformAgencies = lazyWithRetry(() => import("./pages/platform/pg_platform-agencies").then((m) => ({ default: m.PgPlatformAgencies })));
const PgPlatformAgencyDetail = lazyWithRetry(() => import("./pages/platform/pg_platform-agency-detail").then((m) => ({ default: m.PgPlatformAgencyDetail })));
const PgPlatformAgencyTesting = lazyWithRetry(() => import("./pages/platform/pg_platform-agency-testing").then((m) => ({ default: m.PgPlatformAgencyTesting })));
const PgPlatformUsers = lazyWithRetry(() => import("./pages/platform/pg_platform-users").then((m) => ({ default: m.PgPlatformUsers })));
const PgPlatformDomains = lazyWithRetry(() => import("./pages/platform/pg_platform-domains").then((m) => ({ default: m.PgPlatformDomains })));
const PgPlatformAnalytics = lazyWithRetry(() => import("./pages/platform/pg_platform-analytics").then((m) => ({ default: m.PgPlatformAnalytics })));
const PgPlatformAiUsage = lazyWithRetry(() => import("./pages/platform/pg_platform-ai-usage").then((m) => ({ default: m.PgPlatformAiUsage })));
const PgPlatformAuditLogs = lazyWithRetry(() => import("./pages/platform/pg_platform-audit-logs").then((m) => ({ default: m.PgPlatformAuditLogs })));
const PgPlatformSettings = lazyWithRetry(() => import("./pages/platform/pg_platform-settings").then((m) => ({ default: m.PgPlatformSettings })));
const PgPlatformPlans = lazyWithRetry(() => import("./pages/platform/pg_platform-plans").then((m) => ({ default: m.PgPlatformPlans })));
const PgPlatformSubscriptions = lazyWithRetry(() => import("./pages/platform/pg_platform-subscriptions").then((m) => ({ default: m.PgPlatformSubscriptions })));
const PgPlatformModules = lazyWithRetry(() => import("./pages/platform/pg_platform-modules").then((m) => ({ default: m.PgPlatformModules })));
const PgPlatformUsage = lazyWithRetry(() => import("./pages/platform/pg_platform-usage").then((m) => ({ default: m.PgPlatformUsage })));
const PgPlatformBilling = lazyWithRetry(() => import("./pages/platform/pg_platform-billing").then((m) => ({ default: m.PgPlatformBilling })));
const PgPlatformMigration = lazyWithRetry(() => import("./pages/platform/pg_platform-migration").then((m) => ({ default: m.PgPlatformMigration })));
const PgPlatformAutomatizare = lazyWithRetry(() => import("./pages/platform/pg_platform-automatizare").then((m) => ({ default: m.PgPlatformAutomatizare })));
const PgPlatformAutoCrawl = lazyWithRetry(() => import("./pages/platform/pg_platform-auto-crawl").then((m) => ({ default: m.PgPlatformAutoCrawl })));
const PgAgencyAdminBoundary = lazyWithRetry(() => import("./pages/platform/pg_agency-admin-boundary").then((m) => ({ default: m.PgAgencyAdminBoundary })));
const PgAgencyAdminPiataImobiliara = lazyWithRetry(() => import("./pages/agency/pg_agency-admin-piata-imobiliara").then((m) => ({ default: m.PgAgencyAdminPiataImobiliara })));
const PgAgencyAdminSettings = lazyWithRetry(() => import("./pages/agency/pg_agency-admin-settings").then((m) => ({ default: m.PgAgencyAdminSettings })));
const PgAgencyAdminMembers = lazyWithRetry(() => import("./pages/agency/pg_agency-admin-members").then((m) => ({ default: m.PgAgencyAdminMembers })));
const PgAgencyAdminSubscription = lazyWithRetry(() => import("./pages/agency/pg_agency-admin-subscription").then((m) => ({ default: m.PgAgencyAdminSubscription })));
const PgAgencyAdminAiConfig = lazyWithRetry(() => import("./pages/agency/pg_agency-admin-ai-config").then((m) => ({ default: m.PgAgencyAdminAiConfig })));
const PgAgencyAdminAutomatizare = lazyWithRetry(() => import("./pages/agency/pg_agency-admin-automatizare").then((m) => ({ default: m.PgAgencyAdminAutomatizare })));

interface RouteErrorBoundaryState {
  hasError: boolean;
}

class RouteErrorBoundary extends Component<{ children: React.ReactNode }, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): RouteErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error("[App] Route rendering / module load error:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-screen h-screen flex flex-col items-center justify-center bg-gray-50 p-6 text-center select-none">
          <h2 className="text-sm font-semibold text-[#051D35] mb-1.5">
            Pagina nu a putut fi încărcată
          </h2>
          <p className="text-xs text-gray-500 max-w-sm mb-4">
            A apărut o întrerupere temporară la încărcarea aplicației. Reîncărcați pagina pentru a continua.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-lg bg-[#051D35] text-white text-xs font-semibold hover:bg-[#0a2b4a] transition-colors cursor-pointer"
          >
            Reîncarcă pagina
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Loading fallback atom matching Brokr design tokens
const RouteLoadingFallback = () => (
  <div className="w-screen h-screen flex flex-col items-center justify-center bg-gray-50 select-none">
    <div className="w-8 h-8 border-3 border-[#051D35]/15 border-t-[#BE9662] rounded-full animate-spin mb-3" />
    <span className="text-xs font-semibold text-gray-500 tracking-wide font-sans">
      Se încarcă spațiul de lucru...
    </span>
  </div>
);

const HomeRouteShell = () => {
  const { isPlatformAdminHost } = useTenantContext();
  const location = useLocation();
  if (isPlatformAdminHost && location.pathname === "/") {
    return <Navigate to="/platform/dashboard" replace />;
  }
  return (
    <>
      <NotificationManager />
      <Home />
      <Outlet />
    </>
  );
};

const DataHubStatusBanner: React.FC = () => {
  const sync = useDataHubSyncState();

  if (!sync.isOnline) {
    return (
      <MolErrorRecoveryBanner
        variant="offline"
        message="Vizualizați datele salvate local în browser. Modificările vor fi reluate automat la revenirea conexiunii."
      />
    );
  }

  if (sync.lastError) {
    return (
      <MolErrorRecoveryBanner
        variant="error"
        message={sync.lastError}
        onRetry={() => clientDataHub.retryFailedSlices()}
      />
    );
  }

  return null;
};

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <TenantProvider>
          <NotificationProvider>
            <MolPreviewBanner />
            <DataHubStatusBanner />
            <RouteErrorBoundary>
              <Suspense fallback={<RouteLoadingFallback />}>
                <Routes>
                  <Route element={<HomeRouteShell />}>
                    <Route path="/" element={null} />
                    <Route path="/leads/:id" element={null} />
                    <Route path="/cereri/:id" element={null} />
                  </Route>
                  <Route path="/calendar" element={<Navigate to="/?calendar=true" replace />} />
                  <Route path="/share/:id" element={<SharedProperty />} />
                  <Route path="/p/:id" element={<SharedProperty />} />
                  <Route path="/showcase" element={<PgDesignSystemShowcase />} />
                  <Route path="/design-system" element={<PgDesignSystemShowcase />} />

                  {/* Super Admin Platform Routes */}
                  <Route path="/platform" element={<Navigate to="/platform/dashboard" replace />} />
                  <Route path="/platform/dashboard" element={<PgPlatformDashboard />} />
                  <Route path="/platform/agencies" element={<PgPlatformAgencies />} />
                  <Route path="/platform/agencies/:tenant_id" element={<PgPlatformAgencyDetail />} />
                  <Route path="/platform/agency-testing" element={<PgPlatformAgencyTesting />} />
                  <Route path="/platform/users" element={<PgPlatformUsers />} />
                  <Route path="/platform/domains" element={<PgPlatformDomains />} />
                  <Route path="/platform/analytics" element={<PgPlatformAnalytics />} />
                  <Route path="/platform/ai-usage" element={<PgPlatformAiUsage />} />
                  <Route path="/platform/audit-logs" element={<PgPlatformAuditLogs />} />
                  <Route path="/platform/settings" element={<PgPlatformSettings />} />
                  <Route path="/platform/plans" element={<PgPlatformPlans />} />
                  <Route path="/platform/subscriptions" element={<PgPlatformSubscriptions />} />
                  <Route path="/platform/modules" element={<PgPlatformModules />} />
                  <Route path="/platform/usage" element={<PgPlatformUsage />} />
                  <Route path="/platform/billing" element={<PgPlatformBilling />} />
                  <Route path="/platform/migration" element={<PgPlatformMigration />} />
                  <Route path="/platform/automatizare" element={<PgPlatformAutomatizare />} />
                  <Route path="/platform/auto-crawl" element={<PgPlatformAutoCrawl />} />

                  {/* Agency Administration Boundaries */}
                  <Route path="/agency/admin" element={<PgAgencyAdminBoundary />} />
                  <Route path="/agency/admin/piata-imobiliara" element={<PgAgencyAdminPiataImobiliara />} />
                  <Route path="/agency/admin/settings" element={<PgAgencyAdminSettings />} />
                  <Route path="/agency/admin/members" element={<PgAgencyAdminMembers />} />
                  <Route path="/agency/admin/subscription" element={<PgAgencyAdminSubscription />} />
                  <Route path="/agency/admin/ai-config" element={<PgAgencyAdminAiConfig />} />
                  <Route path="/agency/admin/automatizare" element={<PgAgencyAdminAutomatizare />} />
                </Routes>
              </Suspense>
            </RouteErrorBoundary>
          </NotificationProvider>
        </TenantProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
