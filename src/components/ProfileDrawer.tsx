import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  X, 
  User, 
  BarChart3, 
  LogOut, 
  ChevronRight, 
  Building2, 
  ShieldCheck,
  CheckCircle2,
  Sparkles
} from "lucide-react";
import { auth } from "../lib/firebase";
import { useNavigate } from "react-router-dom";
import { useTenantContext } from "../core/tenancy/ctx_tenant";
import { getApiAuthHeaders } from "../lib/apiAuth";

interface ProfileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenProfile: () => void;
  onOpenStats: () => void;
}

export const ProfileDrawer: React.FC<ProfileDrawerProps> = ({
  isOpen,
  onClose,
  onOpenProfile,
  onOpenStats,
}) => {
  const navigate = useNavigate();
  const currentUser = auth.currentUser;
  const { tenantContext } = useTenantContext();
  const [isPlatformSuperAdmin, setIsPlatformSuperAdmin] = useState(false);

  const isAgencyAdmin =
    tenantContext?.role === "agency_owner" || tenantContext?.role === "agency_admin";

  useEffect(() => {
    let active = true;
    async function verifySuperAdmin() {
      if (!isOpen || !currentUser) {
        if (active) setIsPlatformSuperAdmin(false);
        return;
      }
      try {
        const headers = await getApiAuthHeaders();
        const res = await fetch("/api/platform/me", { headers });
        if (active) {
          setIsPlatformSuperAdmin(res.ok);
        }
      } catch {
        if (active) setIsPlatformSuperAdmin(false);
      }
    }
    verifySuperAdmin();
    return () => {
      active = false;
    };
  }, [isOpen, currentUser]);

  if (!isOpen) return null;

  const userName = currentUser?.displayName || (currentUser?.email ? currentUser.email.split('@')[0] : 'Alexandru Radu');
  const userEmail = currentUser?.email || 'alexandru.radu@brokr.ro';
  const userPhoto = currentUser?.photoURL;
  const userRole = 'Broker Principal';

  const handleLogout = async () => {
    try {
      await auth.signOut();
      onClose();
    } catch (err) {
      console.error("Eroare la deconectare:", err);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[300]">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/30 backdrop-blur-xs"
        />

        {/* Right Drawer */}
        <motion.div
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ type: "tween", ease: "easeInOut", duration: 0.25 }}
          className="fixed inset-y-0 right-0 w-[calc(100vw-48px)] md:w-full md:max-w-[360px] bg-white shadow-2xl z-[301] flex flex-col border-l border-gray-200"
        >
          {/* Header */}
          <div className="h-12 px-5 border-b border-gray-100 flex items-center justify-end shrink-0 bg-white">
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors cursor-pointer"
              title="Închide meniul"
            >
              <X size={16} />
            </button>
          </div>

          {/* User Badge / Card */}
          <div className="p-5 border-b border-gray-100 bg-gray-50/50">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-[#051D35]/5 border border-[#051D35]/15 flex items-center justify-center overflow-hidden shrink-0 shadow-2xs">
                {userPhoto ? (
                  <img src={userPhoto} alt={userName} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-base font-semibold text-[#051D35]">
                    {userName.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h4 className="font-title text-xs font-semibold text-gray-900 truncate">{userName}</h4>
                  <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" title="Online" />
                </div>
                <p className="text-[11px] text-gray-500 truncate mt-1">{userEmail}</p>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-[9px] font-semibold text-[#051D35] bg-[#BE9662]/15 px-2 py-1 rounded border border-[#BE9662]/30">
                    {userRole}
                  </span>
                  <span className="text-[9px] text-gray-400">Agenția brokr</span>
                </div>
              </div>
            </div>
          </div>

          {/* Menu Items List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 px-2 pt-1">
              Navigare Profil
            </div>

            {/* 1. Profile */}
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenProfile();
              }}
              className="w-full text-left p-3 rounded-lg border border-gray-200/80 hover:border-[#BE9662]/50 hover:bg-[#BE9662]/5 transition-all flex items-center justify-between group cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-md bg-[#051D35]/5 border border-[#051D35]/15 flex items-center justify-center text-[#BE9662] group-hover:bg-[#BE9662] group-hover:text-white transition-colors">
                  <User size={16} />
                </div>
                <div>
                  <div className="text-xs font-semibold text-gray-900 group-hover:text-[#051D35]">
                    Profilul Meu
                  </div>
                  <div className="text-[10px] text-gray-500 mt-1">
                    Date cont, rol și informații broker
                  </div>
                </div>
              </div>
              <ChevronRight size={15} className="text-gray-400 group-hover:text-[#051D35] group-hover:translate-x-1 transition-all" />
            </button>

            {/* 2. My Stats */}
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenStats();
              }}
              className="w-full text-left p-3 rounded-lg border border-gray-200/80 hover:border-[#BE9662]/50 hover:bg-[#BE9662]/5 transition-all flex items-center justify-between group cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-md bg-[#051D35]/5 border border-[#051D35]/15 flex items-center justify-center text-[#BE9662] group-hover:bg-[#BE9662] group-hover:text-white transition-colors">
                  <BarChart3 size={16} />
                </div>
                <div>
                  <div className="text-xs font-semibold text-gray-900 group-hover:text-[#051D35]">
                    Statisticile Mele
                  </div>
                  <div className="text-[10px] text-gray-500 mt-1">
                    Portofoliu, vizionări & rate de conversie
                  </div>
                </div>
              </div>
              <ChevronRight size={15} className="text-gray-400 group-hover:text-[#051D35] group-hover:translate-x-1 transition-all" />
            </button>

            {/* Administrare Agenție (Visible to Agency Admins/Owners & Preview) */}
            {isAgencyAdmin && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  navigate("/agency/admin");
                }}
                className="w-full text-left p-3 rounded-lg border border-indigo-200/80 hover:border-indigo-400 hover:bg-indigo-50/50 transition-all flex items-center justify-between group cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-md bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-700 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                    <Building2 size={16} />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-900 group-hover:text-indigo-950">
                      Administrare Agenție
                    </div>
                    <div className="text-[10px] text-gray-500 mt-1">
                      Setări agenție, echipă, cote & asistent AI
                    </div>
                  </div>
                </div>
                <ChevronRight size={15} className="text-gray-400 group-hover:text-indigo-600 group-hover:translate-x-1 transition-all" />
              </button>
            )}

            {/* Platform Super Admin (Visible to Super Admins & Preview) */}
            {isPlatformSuperAdmin && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  navigate("/platform/dashboard");
                }}
                className="w-full text-left p-3 rounded-lg border border-gray-200/80 hover:border-[#BE9662]/50 hover:bg-[#BE9662]/5 transition-all flex items-center justify-between group cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-md bg-[#051D35]/5 border border-[#051D35]/15 flex items-center justify-center text-[#BE9662] group-hover:bg-[#BE9662] group-hover:text-white transition-colors">
                    <ShieldCheck size={16} />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-900 group-hover:text-[#051D35]">
                      Super Admin Platformă
                    </div>
                    <div className="text-[10px] text-gray-500 mt-1">
                      Panou global, agenții, planuri & testare
                    </div>
                  </div>
                </div>
                <ChevronRight size={15} className="text-gray-400 group-hover:text-[#051D35] group-hover:translate-x-1 transition-all" />
              </button>
            )}

            {/* 3. Log out */}
            <button
              type="button"
              onClick={handleLogout}
              className="w-full text-left p-3 rounded-lg border border-red-100 hover:border-red-300 hover:bg-red-50/70 transition-all flex items-center justify-between group cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-md bg-red-50 border border-red-100 flex items-center justify-center text-red-600 group-hover:bg-red-600 group-hover:text-white transition-colors">
                  <LogOut size={16} />
                </div>
                <div>
                  <div className="text-xs font-semibold text-red-600">
                    Deconectare (Log out)
                  </div>
                  <div className="text-[10px] text-red-400 mt-1">
                    Încheie sesiunea curentă în siguranță
                  </div>
                </div>
              </div>
              <ChevronRight size={15} className="text-red-400 group-hover:text-red-600 group-hover:translate-x-1 transition-all" />
            </button>
          </div>

          {/* Footer pinned at base */}
          <div className="p-4 border-t border-gray-200 bg-gray-50/80 shrink-0 flex items-center justify-between text-[11px] text-gray-500">
            <span className="font-medium">brokr. CRM Imobiliar</span>
            <span className="font-sans text-[10px] text-gray-400">v2.4.0</span>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
