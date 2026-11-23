import React, { useEffect, useState } from "react";
import { CmpAgencyAdminLayout } from "../../ui/agency/cmp_agency-admin-layout";
import { useTenantContext } from "../../core/tenancy/ctx_tenant";
import { useAuth } from "../../core/auth/ctx_auth";
import { Building2, Save, Palette, Mail, Phone, Check, AlertCircle, Loader2 } from "lucide-react";

export const PgAgencyAdminSettings: React.FC = () => {
  const { tenant, refreshTenant } = useTenantContext();
  const { user } = useAuth();

  const [agencyName, setAgencyName] = useState<string>(tenant?.name || "Brokr Real Estate");
  const [contactEmail, setContactEmail] = useState<string>(tenant?.branding?.contactEmail || "contact@brokr.ro");
  const [contactPhone, setContactPhone] = useState<string>(tenant?.branding?.contactPhone || "+40 700 000 000");
  const [primaryColor, setPrimaryColor] = useState<string>(tenant?.branding?.primaryColor || "#051D35");
  const [accentColor, setAccentColor] = useState<string>(tenant?.branding?.accentColor || "#BE9662");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isSaved, setIsSaved] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenant) return;
    setAgencyName(tenant.name || "Brokr Real Estate");
    setContactEmail(tenant.branding?.contactEmail || "");
    setContactPhone(tenant.branding?.contactPhone || "");
    setPrimaryColor(tenant.branding?.primaryColor || "#051D35");
    setAccentColor(tenant.branding?.accentColor || "#BE9662");
  }, [
    tenant?.id,
    tenant?.name,
    tenant?.branding?.contactEmail,
    tenant?.branding?.contactPhone,
    tenant?.branding?.primaryColor,
    tenant?.branding?.accentColor,
  ]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    setIsSaved(false);
    setIsSaving(true);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (user) {
        const token = await user.getIdToken();
        headers.Authorization = `Bearer ${token}`;
      }
      const previewToken =
        typeof window !== "undefined" ? localStorage.getItem("brokr_preview_token") : null;
      if (previewToken) {
        headers["x-preview-token"] = previewToken;
      }

      const res = await fetch("/api/tenant/settings", {
        method: "PUT",
        headers,
        body: JSON.stringify({
          name: agencyName.trim(),
          branding: {
            agencyName: agencyName.trim(),
            contactEmail: contactEmail.trim(),
            contactPhone: contactPhone.trim(),
            primaryColor,
            accentColor,
          },
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        throw new Error(json?.error?.message || "Nu s-au putut salva setările agenției în baza de date.");
      }

      await refreshTenant();
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 3500);
    } catch (err: any) {
      setSaveError(err?.message || "Eroare la salvarea setărilor agenției.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <CmpAgencyAdminLayout title="Setări Agenție & Identitate Brand">
      <div className="max-w-4xl mx-auto space-y-4">
        <form onSubmit={handleSave} className="bg-white border border-gray-200 rounded-xl p-6 shadow-2xs space-y-4">
          <div className="flex items-center justify-between pb-4 border-b border-gray-100">
            <div>
              <h2 className="font-title text-sm font-semibold text-gray-900">Informații Generale & Brand</h2>
              <p className="text-xs text-gray-500 mt-1">
                Personalizați denumirea, datele de contact și paleta vizuală a agenției dumneavoastră.
              </p>
            </div>
            {isSaved && (
              <span className="flex items-center gap-1 text-xs font-normal text-emerald-600 bg-emerald-50 px-3 py-1 rounded border border-emerald-200">
                <Check size={13} />
                <span>Modificări salvate permanent!</span>
              </span>
            )}
          </div>

          {saveError && (
            <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle size={14} className="shrink-0" />
              <span>{saveError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="space-y-2">
              <label className="font-semibold text-gray-700 block">Nume Agenție</label>
              <div className="relative">
                <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  required
                  value={agencyName}
                  onChange={(e) => setAgencyName(e.target.value)}
                  className="w-full h-9 pl-9 pr-3 bg-gray-50 border border-gray-200 rounded-lg text-xs font-normal focus:bg-white focus:outline-none focus:border-[#BE9662]"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="font-semibold text-gray-700 block">Identificator Unic (Tenant ID)</label>
              <input
                type="text"
                disabled
                value={tenant?.id || "ten_brokr_default"}
                className="w-full h-9 px-3 bg-gray-100 border border-gray-200 rounded-lg text-xs font-sans font-normal text-gray-500 cursor-not-allowed"
              />
            </div>

            <div className="space-y-2">
              <label className="font-semibold text-gray-700 block">Email Oficial Contact</label>
              <div className="relative">
                <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  className="w-full h-9 pl-9 pr-3 bg-gray-50 border border-gray-200 rounded-lg text-xs font-normal focus:bg-white focus:outline-none focus:border-[#BE9662]"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="font-semibold text-gray-700 block">Telefon Asistență / Contact</label>
              <div className="relative">
                <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  className="w-full h-9 pl-9 pr-3 bg-gray-50 border border-gray-200 rounded-lg text-xs font-normal focus:bg-white focus:outline-none focus:border-[#BE9662]"
                />
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-gray-100">
            <h3 className="font-title text-xs font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Palette size={14} className="text-[#BE9662]" />
              <span>Culori de Brand & Accente Vizuale</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                <input
                  type="color"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="w-9 h-9 rounded cursor-pointer border border-gray-300"
                />
                <div>
                  <span className="font-semibold text-gray-800 block">Culoare Primară</span>
                  <span className="font-sans font-normal text-gray-500 text-[11px]">{primaryColor}</span>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                <input
                  type="color"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  className="w-9 h-9 rounded cursor-pointer border border-gray-300"
                />
                <div>
                  <span className="font-semibold text-gray-800 block">Culoare Accent</span>
                  <span className="font-sans font-normal text-gray-500 text-[11px]">{accentColor}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-4 flex justify-end">
            <button
              type="submit"
              disabled={isSaving}
              className="px-4 py-2 bg-[#051D35] hover:bg-[#051D35]/90 disabled:opacity-60 text-white rounded font-semibold text-xs flex items-center gap-2 shadow-2xs transition-colors cursor-pointer"
            >
              {isSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              <span>{isSaving ? "Se salvează..." : "Salvează Setările"}</span>
            </button>
          </div>
        </form>
      </div>
    </CmpAgencyAdminLayout>
  );
};
