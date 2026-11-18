import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Settings, Save, CheckCircle2, AlertTriangle, ShieldCheck, Info, Workflow, ArrowRight } from "lucide-react";
import { CmpPlatformLayout } from "../../ui/platform/cmp_platform-layout";
import { PlatformSettingsRecord } from "../../core/platform/typ_platform-admin";
import { useAuth } from "../../core/auth/ctx_auth";

export const PgPlatformSettings: React.FC = () => {
  const { user } = useAuth();
  const [settings, setSettings] = useState<PlatformSettingsRecord | null>(null);
  const [platformName, setPlatformName] = useState<string>("");
  const [supportEmail, setSupportEmail] = useState<string>("");
  const [defaultTrialDurationDays, setDefaultTrialDurationDays] = useState<number>(14);
  const [maintenanceMode, setMaintenanceMode] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

  useEffect(() => {
    async function loadSettings() {
      if (!user) return;
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/platform/settings", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const json = await res.json();
          if (json.success) {
            const s: PlatformSettingsRecord = json.data;
            setSettings(s);
            setPlatformName(s.platformName);
            setSupportEmail(s.supportEmail);
            setDefaultTrialDurationDays(s.defaultTrialDurationDays);
            setMaintenanceMode(s.maintenanceMode);
          }
        }
      } catch (err) {
        console.error("Failed to load platform settings:", err);
      }
    }

    loadSettings();
  }, [user]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setIsSaving(true);
    setSaveSuccess(false);

    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/platform/settings", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          platformName,
          supportEmail,
          defaultTrialDurationDays,
          maintenanceMode,
        }),
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setSettings(json.data);
          setSaveSuccess(true);
          setTimeout(() => setSaveSuccess(false), 3000);
        }
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err?.error?.message || "Eroare la salvarea setărilor.");
      }
    } catch (err: any) {
      alert(err?.message || "Eroare de comunicare.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <CmpPlatformLayout title="Setări Globale Platformă">
      <div className="max-w-2xl space-y-4">
        {saveSuccess && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs flex items-center gap-2">
            <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
            <span>Setările platformei au fost actualizate și salvate cu succes în jurnalul de audit.</span>
          </div>
        )}

        <form onSubmit={handleSave} className="bg-white border border-gray-200 rounded-lg p-6 shadow-2xs space-y-4 text-xs">
          <div>
            <h3 className="font-title text-xs font-semibold text-gray-900 uppercase tracking-wider mb-1">
              Parametri Generali Platformă
            </h3>
            <p className="text-[11px] text-gray-500">Configurație globală partajată pe toate agențiile.</p>
          </div>

          <div>
            <label className="block font-semibold text-gray-800 mb-1">Numele Oficial al Platformei:</label>
            <input
              type="text"
              value={platformName}
              onChange={(e) => setPlatformName(e.target.value)}
              required
              className="w-full p-2 border border-gray-200 rounded-md focus:outline-none focus:border-indigo-500 font-sans font-normal text-xs"
            />
          </div>

          <div>
            <label className="block font-semibold text-gray-800 mb-1">Email Suport Tehnic & Notificări:</label>
            <input
              type="email"
              value={supportEmail}
              onChange={(e) => setSupportEmail(e.target.value)}
              required
              className="w-full p-2 border border-gray-200 rounded-md focus:outline-none focus:border-indigo-500 font-sans font-normal text-xs"
            />
          </div>

          <div>
            <label className="block font-semibold text-gray-800 mb-1">Durată Implicită Perioadă Trial (zile):</label>
            <input
              type="number"
              min={1}
              max={90}
              value={defaultTrialDurationDays}
              onChange={(e) => setDefaultTrialDurationDays(parseInt(e.target.value) || 14)}
              required
              className="w-full p-2 border border-gray-200 rounded-md focus:outline-none focus:border-indigo-500 font-sans font-normal tabular-nums text-xs"
            />
          </div>

          {/* Maintenance Mode Toggle */}
          <div className="pt-2 border-t border-gray-100 flex items-center justify-between gap-4">
            <div>
              <span className="font-semibold text-gray-900 block">Mod Mentenanță Platformă</span>
              <span className="text-[11px] text-gray-500">
                Afișează un ecran informativ de mentenanță pentru toate agențiile.
              </span>
            </div>
            <input
              type="checkbox"
              checked={maintenanceMode}
              onChange={(e) => setMaintenanceMode(e.target.checked)}
              className="h-4 w-4 text-indigo-600 rounded border-gray-300 cursor-pointer"
            />
          </div>

          {/* Read-only infrastructure configuration info */}
          <div className="pt-4 border-t border-gray-100 space-y-2">
            <h4 className="font-title text-[11px] font-semibold text-gray-700 uppercase tracking-wider">
              Infrastructură Domenii (Configurată prin Mediu):
            </h4>
            <div className="grid grid-cols-2 gap-4 font-sans text-[11px]">
              <div className="p-3 bg-gray-50 rounded border border-gray-200">
                <span className="text-[10px] font-semibold text-gray-500 block">Domeniu Rădăcină (PLATFORM_ROOT_DOMAIN):</span>
                <span className="font-normal text-gray-800">
                  {settings?.configuredRootDomain || "Neconfigurat (opțional)"}
                </span>
              </div>
              <div className="p-3 bg-gray-50 rounded border border-gray-200">
                <span className="text-[10px] font-semibold text-gray-500 block">Subdomeniu Admin (PLATFORM_ADMIN_SUBDOMAIN):</span>
                <span className="font-normal text-gray-800">{settings?.adminSubdomain || "admin"}</span>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={isSaving}
              className="px-4 py-2 bg-[#051D35] hover:bg-[#0a2b4a] text-white rounded-md text-xs font-semibold flex items-center gap-2 cursor-pointer shadow-2xs"
            >
              <Save size={14} />
              <span>{isSaving ? "Se salvează..." : "Salvează Modificările"}</span>
            </button>
          </div>
        </form>

        <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-2xs flex items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#051D35]/5 border border-[#051D35]/15 text-[#051D35] flex items-center justify-center shrink-0">
              <Workflow size={17} />
            </div>
            <div>
              <h3 className="font-title text-xs font-semibold text-gray-900">
                Automatizare Implicită Globală (Titluri Anunțuri Externe)
              </h3>
              <p className="text-[11px] text-gray-500 mt-0.5">
                Configurați șablonul implicit de titluri (Vânzare / Închiriere) moștenit automat de agențiile fără regulă personalizată.
              </p>
            </div>
          </div>
          <Link
            to="/platform/automatizare"
            className="shrink-0 px-3.5 py-2 bg-[#051D35] hover:bg-[#0a2b4a] text-white rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <span>Configurează</span>
            <ArrowRight size={13} />
          </Link>
        </div>
      </div>
    </CmpPlatformLayout>
  );
};
