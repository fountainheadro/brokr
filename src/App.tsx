import React, { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { NotificationManager } from "./components/NotificationManager";
import { NotificationProvider } from "./components/NotificationProvider";
import { AuthProvider } from "./core/auth/ctx_auth";
import { TenantProvider, useTenantContext } from "./core/tenancy/ctx_tenant";

// Route-level lazy loading for performance & modular architecture
const Home = lazy(() => import("./pages/Home").then((m) => ({ default: m.Home })));
const SharedProperty = lazy(() => import("./pages/SharedProperty").then((m) => ({ default: m.SharedProperty })));
const PgDesignSystemShowcase = lazy(() => import("./pages/pg_design-system-showcase").then((m) => ({ default: m.PgDesignSystemShowcase })));

import { MolPreviewBanner } from "./ui/molecules/platform/mol_preview-banner";

// Platform Super Admin routes (lazy loaded)
const PgPlatformDashboard = lazy(() => import("./pages/platform/pg_platform-dashboard").then((m) => ({ default: m.PgPlatformDashboard })));
const PgPlatformAgencies = lazy(() => import("./pages/platform/pg_platform-agencies").then((m) => ({ default: m.PgPlatformAgencies })));
const PgPlatformAgencyDetail = lazy(() => import("./pages/platform/pg_platform-agency-detail").then((m) => ({ default: m.PgPlatformAgencyDetail })));
const PgPlatformAgencyTesting = lazy(() => import("./pages/platform/pg_platform-agency-testing").then((m) => ({ default: m.PgPlatformAgencyTesting })));
const PgPlatformUsers = lazy(() => import("./pages/platform/pg_platform-users").then((m) => ({ default: m.PgPlatformUsers })));
const PgPlatformDomains = lazy(() => import("./pages/platform/pg_platform-domains").then((m) => ({ default: m.PgPlatformDomains })));
const PgPlatformAnalytics = lazy(() => import("./pages/platform/pg_platform-analytics").then((m) => ({ default: m.PgPlatformAnalytics })));
const PgPlatformAiUsage = lazy(() => import("./pages/platform/pg_platform-ai-usage").then((m) => ({ default: m.PgPlatformAiUsage })));
const PgPlatformAuditLogs = lazy(() => import("./pages/platform/pg_platform-audit-logs").then((m) => ({ default: m.PgPlatformAuditLogs })));
const PgPlatformSettings = lazy(() => import("./pages/platform/pg_platform-settings").then((m) => ({ default: m.PgPlatformSettings })));
const PgPlatformPlans = lazy(() => import("./pages/platform/pg_platform-plans").then((m) => ({ default: m.PgPlatformPlans })));
const PgPlatformSubscriptions = lazy(() => import("./pages/platform/pg_platform-subscriptions").then((m) => ({ default: m.PgPlatformSubscriptions })));
const PgPlatformModules = lazy(() => import("./pages/platform/pg_platform-modules").then((m) => ({ default: m.PgPlatformModules })));
const PgPlatformUsage = lazy(() => import("./pages/platform/pg_platform-usage").then((m) => ({ default: m.PgPlatformUsage })));
const PgPlatformBilling = lazy(() => import("./pages/platform/pg_platform-billing").then((m) => ({ default: m.PgPlatformBilling })));
const PgPlatformMigration = lazy(() => import("./pages/platform/pg_platform-migration").then((m) => ({ default: m.PgPlatformMigration })));
const PgPlatformAutomatizare = lazy(() => import("./pages/platform/pg_platform-automatizare").then((m) => ({ default: m.PgPlatformAutomatizare })));
const PgPlatformAutoCrawl = lazy(() => import("./pages/platform/pg_platform-auto-crawl").then((m) => ({ default: m.PgPlatformAutoCrawl })));
const PgAgencyAdminBoundary = lazy(() => import("./pages/platform/pg_agency-admin-boundary").then((m) => ({ default: m.PgAgencyAdminBoundary })));
const PgAgencyAdminSettings = lazy(() => import("./pages/agency/pg_agency-admin-settings").then((m) => ({ default: m.PgAgencyAdminSettings })));
const PgAgencyAdminMembers = lazy(() => import("./pages/agency/pg_agency-admin-members").then((m) => ({ default: m.PgAgencyAdminMembers })));
const PgAgencyAdminSubscription = lazy(() => import("./pages/agency/pg_agency-admin-subscription").then((m) => ({ default: m.PgAgencyAdminSubscription })));
const PgAgencyAdminAiConfig = lazy(() => import("./pages/agency/pg_agency-admin-ai-config").then((m) => ({ default: m.PgAgencyAdminAiConfig })));
const PgAgencyAdminAutomatizare = lazy(() => import("./pages/agency/pg_agency-admin-automatizare").then((m) => ({ default: m.PgAgencyAdminAutomatizare })));



// Loading fallback atom matching Brokr design tokens
const RouteLoadingFallback = () => (
  <div className="w-screen h-screen flex flex-col items-center justify-center bg-gray-50 select-none">
    <div className="w-8 h-8 border-3 border-[#051D35]/15 border-t-[#BE9662] rounded-full animate-spin mb-3" />
    <span className="text-xs font-semibold text-gray-500 tracking-wide font-sans">
      Se încarcă spațiul de lucru...
    </span>
  </div>
);

const RootRouteElement = () => {
  const { isPlatformAdminHost } = useTenantContext();
  if (isPlatformAdminHost) {
    return <Navigate to="/platform/dashboard" replace />;
  }
  return (
    <>
      <NotificationManager />
      <Home />
    </>
  );
};

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <TenantProvider>
          <NotificationProvider>
            <MolPreviewBanner />
            <Suspense fallback={<RouteLoadingFallback />}>
              <Routes>
                <Route path="/" element={<RootRouteElement />} />
                <Route
                  path="/leads/:id"
                  element={
                    <>
                      <NotificationManager />
                      <Home />
                    </>
                  }
                />
                <Route
                  path="/cereri/:id"
                  element={
                    <>
                      <NotificationManager />
                      <Home />
                    </>
                  }
                />
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
                <Route path="/agency/admin/settings" element={<PgAgencyAdminSettings />} />
                <Route path="/agency/admin/members" element={<PgAgencyAdminMembers />} />
                <Route path="/agency/admin/subscription" element={<PgAgencyAdminSubscription />} />
                <Route path="/agency/admin/ai-config" element={<PgAgencyAdminAiConfig />} />
                <Route path="/agency/admin/automatizare" element={<PgAgencyAdminAutomatizare />} />
              </Routes>
            </Suspense>
          </NotificationProvider>
        </TenantProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
