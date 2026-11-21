import React from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import {
  Store,
  Building,
  Settings,
  Users,
  CreditCard,
  Bot,
  Workflow,
  ArrowLeft,
  ShieldCheck,
  Building2,
  ExternalLink
} from "lucide-react";
import { useTenantContext } from "../../core/tenancy/ctx_tenant";
import { OrgNavigationSidebar, NavGroup } from "../organisms/common/org_navigation-sidebar";

export interface AgencyAdminLayoutProps {
  title?: string;
  children: React.ReactNode;
}

export const CmpAgencyAdminLayout: React.FC<AgencyAdminLayoutProps> = ({
  title = "Administrare Agenție",
  children,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { tenant, tenantContext } = useTenantContext();

  const isAgent = tenantContext?.role === "agent";

  // Navigation definition for Agency Administration
  const navGroups: NavGroup[] = [
    {
      id: "grp_admin_core",
      title: "Administrare Agenție",
      items: [
        {
          id: "piata-imobiliara",
          label: "Piața Imobiliară",
          onClick: () => navigate("/agency/admin/piata-imobiliara"),
          icon: <Store size={16} />,
          active: location.pathname === "/agency/admin/piata-imobiliara",
        },
        {
          id: "overview",
          label: "Panou General",
          onClick: () => navigate("/agency/admin"),
          icon: <Building size={16} />,
          active: location.pathname === "/agency/admin",
        },
        {
          id: "settings",
          label: "Setări Agenție & Brand",
          onClick: () => navigate("/agency/admin/settings"),
          icon: <Settings size={16} />,
          active: location.pathname === "/agency/admin/settings",
        },
        {
          id: "members",
          label: "Echipă & Roluri",
          onClick: () => navigate("/agency/admin/members"),
          icon: <Users size={16} />,
          active: location.pathname === "/agency/admin/members",
        },
        {
          id: "subscription",
          label: "Abonament & Cote",
          onClick: () => navigate("/agency/admin/subscription"),
          icon: <CreditCard size={16} />,
          active: location.pathname === "/agency/admin/subscription",
        },
        {
          id: "ai-config",
          label: "Asistent AI Dedicat",
          onClick: () => navigate("/agency/admin/ai-config"),
          icon: <Bot size={16} />,
          active: location.pathname === "/agency/admin/ai-config",
        },
        {
          id: "automatizare",
          label: "Automatizare",
          onClick: () => navigate("/agency/admin/automatizare"),
          icon: <Workflow size={16} />,
          active: location.pathname === "/agency/admin/automatizare",
        },
      ],
    },
    {
      id: "grp_crm_return",
      title: "Navigare Spațiu de Lucru",
      items: [
        {
          id: "to-crm",
          label: "Mergi la CRM Agenție",
          onClick: () => navigate("/"),
          icon: <ArrowLeft size={16} />,
        },
      ],
    },
  ];

  // If role is Agent and somehow lands on admin page, show access denied
  if (isAgent) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6 font-sans">
        <div className="max-w-md w-full bg-white border border-gray-200 rounded-xl p-6 text-center space-y-4 shadow-sm">
          <div className="w-12 h-12 rounded-full bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center mx-auto">
            <ShieldCheck size={24} />
          </div>
          <h2 className="font-title text-base font-semibold text-gray-900">Acces Restricționat: Administrator</h2>
          <p className="text-xs text-gray-500 leading-relaxed">
            Rolul curent (<strong className="font-semibold text-gray-800">Agent / Broker</strong>) nu deține permisiuni
            pentru administrarea setărilor, abonamentului sau echipei acestei agenții.
          </p>
          <button
            type="button"
            onClick={() => navigate("/")}
            className="w-full h-9 bg-[#051D35] hover:bg-[#051D35]/90 text-white rounded font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <ArrowLeft size={14} />
            <span>Înapoi la CRM</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-50 font-sans">
      {/* Agency Admin Left Sidebar */}
      <OrgNavigationSidebar
        agencyName={tenant?.name || "Administrare Agenție"}
        agencyLogo={tenant?.branding?.logoUrl}
        groups={navGroups}
      />

      {/* Main Content Viewport */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Header */}
        <header className="h-12 shrink-0 bg-white border-b border-gray-200 px-6 flex items-center justify-between z-10">
          <div className="flex items-center gap-4">
            <Link
              to="/"
              className="text-xs font-semibold text-gray-500 hover:text-gray-900 flex items-center gap-2 transition-colors"
            >
              <ArrowLeft size={14} />
              <span>Înapoi la CRM</span>
            </Link>
            <span className="text-gray-200">|</span>
            <span className="font-title text-xs font-semibold text-gray-900">{title}</span>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1 rounded bg-indigo-50 border border-indigo-200 text-indigo-700 text-[11px] font-normal">
              <ShieldCheck size={13} />
              <span><strong className="font-semibold">Rol:</strong> {tenantContext?.role || "agency_owner"}</span>
            </div>
          </div>
        </header>

        {/* Scrollable Main Area */}
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
};
