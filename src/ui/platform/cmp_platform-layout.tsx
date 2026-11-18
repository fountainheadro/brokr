import React, { useEffect, useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import {
  LayoutDashboard,
  Building2,
  Users,
  Globe,
  BarChart3,
  Cpu,
  ScrollText,
  Settings,
  ArrowLeft,
  ShieldAlert,
  Loader2,
  LogOut,
  UserCheck,
  CreditCard,
  Package,
  Boxes,
  Gauge,
  WalletCards,
  FlaskConical,
  Database,
  Workflow,
} from "lucide-react";
import { TplPlatformDashboard } from "../templates/platform/tpl_platform-dashboard";
import { NavGroup } from "../organisms/common/org_navigation-sidebar";
import { useAuth } from "../../core/auth/ctx_auth";

export interface PlatformLayoutProps {
  title?: string;
  metricsSlot?: React.ReactNode;
  children: React.ReactNode;
}

export const CmpPlatformLayout: React.FC<PlatformLayoutProps> = ({
  title = "Super Admin Platformă",
  metricsSlot,
  children,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isLoading: isAuthLoading, logout } = useAuth();

  const [isVerifying, setIsVerifying] = useState<boolean>(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function checkPlatformAccess() {
      if (isAuthLoading) return;

      if (!user) {
        if (isMounted) {
          setIsSuperAdmin(false);
          setIsVerifying(false);
        }
        return;
      }

      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/platform/dashboard/stats", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!isMounted) return;

        if (res.ok) {
          setIsSuperAdmin(true);
          setAuthError(null);
        } else {
          setIsSuperAdmin(false);
          const errData = await res.json().catch(() => ({}));
          setAuthError(
            errData?.error?.message ||
              "Acces refuzat: Acest cont nu deține privilegii de Super Admin de platformă."
          );
        }
      } catch (err: any) {
        if (!isMounted) return;
        setIsSuperAdmin(false);
        setAuthError(err?.message || "Eroare la verificarea permisiunilor de platformă.");
      } finally {
        if (isMounted) setIsVerifying(false);
      }
    }

    checkPlatformAccess();
    return () => {
      isMounted = false;
    };
  }, [user, isAuthLoading]);

  // Navigation definition for Super Admin
  const navGroups: NavGroup[] = [
    {
      id: "grp_overview",
      title: "Prezentare Generală",
      items: [
        {
          id: "dash",
          label: "Panou Control",
          onClick: () => navigate("/platform/dashboard"),
          icon: <LayoutDashboard size={16} />,
          active: location.pathname === "/platform" || location.pathname === "/platform/dashboard",
        },
        {
          id: "analytics",
          label: "Analitice Globale",
          onClick: () => navigate("/platform/analytics"),
          icon: <BarChart3 size={16} />,
          active: location.pathname === "/platform/analytics",
        },
        {
          id: "usage",
          label: "Monitorizare Cote & Resurse",
          onClick: () => navigate("/platform/usage"),
          icon: <Gauge size={16} />,
          active: location.pathname === "/platform/usage",
        },
      ],
    },
    {
      id: "grp_management",
      title: "Gestiune Platformă",
      items: [
        {
          id: "agencies",
          label: "Agenții Înregistrate",
          onClick: () => navigate("/platform/agencies"),
          icon: <Building2 size={16} />,
          active: location.pathname === "/platform/agencies" || (location.pathname.startsWith("/platform/agencies/") && !location.pathname.includes("testing")),
        },
        {
          id: "agency-testing",
          label: "Testare agenții",
          onClick: () => navigate("/platform/agency-testing"),
          icon: <FlaskConical size={16} />,
          active: location.pathname === "/platform/agency-testing",
        },
        {
          id: "subscriptions",
          label: "Abonamente Agenții",
          onClick: () => navigate("/platform/subscriptions"),
          icon: <CreditCard size={16} />,
          active: location.pathname === "/platform/subscriptions",
        },
        {
          id: "plans",
          label: "Planuri Tarifare",
          onClick: () => navigate("/platform/plans"),
          icon: <Package size={16} />,
          active: location.pathname === "/platform/plans",
        },
        {
          id: "modules",
          label: "Catalog Module & Add-on",
          onClick: () => navigate("/platform/modules"),
          icon: <Boxes size={16} />,
          active: location.pathname === "/platform/modules",
        },
        {
          id: "users",
          label: "Administratori Platformă",
          onClick: () => navigate("/platform/users"),
          icon: <Users size={16} />,
          active: location.pathname === "/platform/users",
        },
        {
          id: "domains",
          label: "Domenii & Mapare",
          onClick: () => navigate("/platform/domains"),
          icon: <Globe size={16} />,
          active: location.pathname === "/platform/domains",
        },
      ],
    },
    {
      id: "grp_infra",
      title: "Infrastructură & Date",
      items: [
        {
          id: "migration",
          label: "Migrare Date CRM",
          onClick: () => navigate("/platform/migration"),
          icon: <Database size={16} />,
          active: location.pathname === "/platform/migration",
        },
        {
          id: "billing",
          label: "Facturare & Furnizori Plăți",
          onClick: () => navigate("/platform/billing"),
          icon: <WalletCards size={16} />,
          active: location.pathname === "/platform/billing",
        },
        {
          id: "ai",
          label: "Consum Tokeni AI",
          onClick: () => navigate("/platform/ai-usage"),
          icon: <Cpu size={16} />,
          active: location.pathname === "/platform/ai-usage",
        },
        {
          id: "audit",
          label: "Jurnal Audit",
          onClick: () => navigate("/platform/audit-logs"),
          icon: <ScrollText size={16} />,
          active: location.pathname === "/platform/audit-logs",
        },
        {
          id: "automatizare",
          label: "Automatizare",
          onClick: () => navigate("/platform/automatizare"),
          icon: <Workflow size={16} />,
          active: location.pathname === "/platform/automatizare",
        },
        {
          id: "settings",
          label: "Setări Platformă",
          onClick: () => navigate("/platform/settings"),
          icon: <Settings size={16} />,
          active: location.pathname === "/platform/settings",
        },
      ],
    },
    {
      id: "grp_nav",
      title: "Navigare Aplicații",
      items: [
        {
          id: "back-crm",
          label: "Înapoi la CRM Agenție",
          onClick: () => navigate("/"),
          icon: <ArrowLeft size={16} />,
        },
      ],
    },
  ];

  // 1. Loading verification state
  if (isAuthLoading || isVerifying) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-gray-50 select-none">
        <div className="w-10 h-10 border-3 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-3" />
        <span className="text-xs font-semibold text-gray-700 font-sans">
          Verificare autorizare Super Admin...
        </span>
      </div>
    );
  }

  // 2. Unauthenticated or Non-Super-Admin Access Denied
  if (!user || !isSuperAdmin) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-[#f9fafb] p-6 select-none font-sans">
        <div className="w-full max-w-md bg-white border border-gray-200 rounded-lg p-8 shadow-sm flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-full bg-red-50 border border-red-200 flex items-center justify-center mb-5 text-red-600 shadow-2xs">
            <ShieldAlert size={28} />
          </div>

          <h2 className="font-title text-xl font-semibold tracking-tight text-gray-900 mb-2">
            Acces Restricționat: Super Admin
          </h2>

          <p className="text-xs text-gray-600 leading-relaxed mb-6">
            {authError ||
              "Pentru a accesa interfața de administrare a platformei, este necesară autentificarea cu un cont de Platform Super Admin. Rolurile de agenție nu conferă acces."}
          </p>

          <div className="w-full flex flex-col gap-2">
            <Link
              to="/"
              className="w-full h-10 bg-[#051D35] hover:bg-[#0a2b4a] text-white transition-colors rounded-md font-semibold text-xs flex items-center justify-center gap-2 cursor-pointer shadow-2xs"
            >
              <ArrowLeft size={14} />
              <span>Mergi la CRM Agenție</span>
            </Link>

            {user && (
              <button
                type="button"
                onClick={() => logout()}
                className="w-full h-9 bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors rounded-md font-semibold text-xs flex items-center justify-center gap-2 cursor-pointer"
              >
                <LogOut size={13} />
                <span>Deconectează contul curent</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // User menu block on top bar
  const userMenu = (
    <div className="flex items-center gap-2 text-xs">
      <div className="flex items-center gap-2 px-2 py-1 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-md font-medium text-[11px]">
        <UserCheck size={13} />
        <span>Super Admin</span>
      </div>
      <button
        type="button"
        onClick={() => logout()}
        className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
        title="Deconectare"
      >
        <LogOut size={15} />
      </button>
    </div>
  );

  return (
    <TplPlatformDashboard
      navGroups={navGroups}
      headerTitle={title}
      metricsSlot={metricsSlot}
      contentSlot={children}
      userMenu={userMenu}
    />
  );
};
