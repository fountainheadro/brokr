import React, { useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { 
  FlaskConical, 
  Crown, 
  Briefcase, 
  LogOut, 
  ExternalLink, 
  Building2, 
  ShieldAlert,
  Loader2,
  Check
} from "lucide-react";
import { useTenantContext } from "../../../core/tenancy/ctx_tenant";
import { UserRole } from "../../../core/tenancy/typ_tenant-context";

export const MolPreviewBanner: React.FC = () => {
  const { previewSession, switchSimulatedRole, exitPreview } = useTenantContext();
  const navigate = useNavigate();
  const location = useLocation();

  const [isSwitching, setIsSwitching] = useState<boolean>(false);
  const [isExiting, setIsExiting] = useState<boolean>(false);

  if (!previewSession) {
    return null;
  }

  const currentRole = previewSession.simulatedRole;
  const isAdministrator = currentRole === "agency_owner" || currentRole === "agency_admin";

  const handleRoleChange = async (newRole: UserRole) => {
    if (newRole === currentRole || isSwitching) return;
    try {
      setIsSwitching(true);
      await switchSimulatedRole(newRole);

      // If switched to Agent while on an Agency Admin page, navigate to CRM home
      if (newRole === "agent" && location.pathname.startsWith("/agency/admin")) {
        navigate("/");
      }
    } catch (err: any) {
      console.error("Eroare la schimbarea rolului de testare:", err);
    } finally {
      setIsSwitching(false);
    }
  };

  const handleExit = async () => {
    if (isExiting) return;
    try {
      setIsExiting(true);
      await exitPreview();
      navigate("/platform/agency-testing");
    } catch (err: any) {
      console.error("Eroare la ieșirea din testare:", err);
      navigate("/platform/dashboard");
    } finally {
      setIsExiting(false);
    }
  };

  return (
    <div className="sticky top-0 z-[9999] w-full bg-[#BE9662] text-white border-b border-[#a8824f] shadow-md select-none font-sans text-xs">
      <div className="max-w-7xl mx-auto px-4 py-2 flex flex-wrap items-center justify-between gap-4">
        {/* Left: Agency Identifier & Banner Notice */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-2 py-1 leading-none rounded bg-[#051D35] text-white font-semibold text-[11px] tracking-wide uppercase shadow-2xs">
            <FlaskConical size={13} className="text-[#BE9662]" />
            <span>MOD TESTARE</span>
          </div>

          <div className="flex items-center gap-1 text-[13px] font-semibold text-[#051D35]">
            <span>Agenție:</span>
            <span className="font-normal underline decoration-[#051D35]/30 underline-offset-2">
              {previewSession.tenantName}
            </span>
            <span className="text-[11px] font-sans text-[#051D35]/75 font-normal ml-1">
              ({previewSession.tenantId})
            </span>
          </div>
        </div>

        {/* Center: Interactive Role Switcher */}
        <div className="flex items-center gap-1 bg-[#051D35]/15 p-1 rounded-lg border border-[#051D35]/20">
          <span className="text-[11px] font-semibold text-[#051D35] px-2">Rol Simulat:</span>

          {/* Option: Administrator agenție */}
          <button
            type="button"
            onClick={() => handleRoleChange("agency_admin")}
            disabled={isSwitching}
            className={`px-3 py-1 rounded-md text-[11px] font-semibold flex items-center gap-2 transition-all cursor-pointer ${
              isAdministrator
                ? "bg-[#051D35] text-white shadow-2xs"
                : "text-[#051D35] hover:bg-[#051D35]/15"
            }`}
          >
            <Crown size={12} className={isAdministrator ? "text-[#BE9662]" : "text-[#051D35]"} />
            <span>Administrator agenție</span>
            {isAdministrator && <Check size={11} className="text-[#BE9662] ml-1" />}
          </button>

          {/* Option: Agent / Broker */}
          <button
            type="button"
            onClick={() => handleRoleChange("agent")}
            disabled={isSwitching}
            className={`px-3 py-1 rounded-md text-[11px] font-semibold flex items-center gap-2 transition-all cursor-pointer ${
              !isAdministrator
                ? "bg-[#051D35] text-white shadow-2xs"
                : "text-[#051D35] hover:bg-[#051D35]/15"
            }`}
          >
            <Briefcase size={12} className={!isAdministrator ? "text-[#BE9662]" : "text-[#051D35]"} />
            <span>Agent / Broker</span>
            {!isAdministrator && <Check size={11} className="text-[#BE9662] ml-1" />}
          </button>

          {isSwitching && <Loader2 size={13} className="animate-spin text-[#051D35] ml-1" />}
        </div>

        {/* Right: Quick Target Navigation & Exit Button */}
        <div className="flex items-center gap-2">
          {/* Quick toggle between CRM and Agency Admin */}
          {location.pathname.startsWith("/agency/admin") ? (
            <Link
              to="/"
              className="px-3 py-1 rounded bg-white/20 hover:bg-white/30 text-[#051D35] font-semibold text-[11px] flex items-center gap-1 transition-colors"
            >
              <Building2 size={12} />
              <span>Deschide CRM</span>
            </Link>
          ) : isAdministrator ? (
            <Link
              to="/agency/admin"
              className="px-3 py-1 rounded bg-white/20 hover:bg-white/30 text-[#051D35] font-semibold text-[11px] flex items-center gap-1 transition-colors"
            >
              <Building2 size={12} />
              <span>Administrare Agenție</span>
            </Link>
          ) : null}

          {/* Exit Preview Button */}
          <button
            type="button"
            onClick={handleExit}
            disabled={isExiting}
            className="px-3 py-1 bg-red-700 hover:bg-red-800 text-white rounded font-semibold text-[11px] flex items-center gap-2 transition-colors cursor-pointer shadow-2xs"
            title="Încheie sesiunea de testare și revino la Super Admin"
          >
            {isExiting ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <LogOut size={12} />
            )}
            <span>IEȘIRE DIN TESTARE</span>
          </button>
        </div>
      </div>
    </div>
  );
};
