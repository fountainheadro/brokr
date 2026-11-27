import React, { useEffect, useState } from "react";
import { CmpAgencyAdminLayout } from "../../ui/agency/cmp_agency-admin-layout";
import { useTenantContext } from "../../core/tenancy/ctx_tenant";
import { useAuth } from "../../core/auth/ctx_auth";
import {
  DEFAULT_TITLE_AUTOMATION_RULE,
  TitleAutomationRule,
  normalizeTitleAutomationRule,
} from "../../core/automation/typ_title-automation";
import { automationSettingsService } from "../../services/automationSettingsService";
import { CmpTitleAutomationEditor } from "../../ui/automation/cmp_title-automation-editor";
import { CmpDescriptionAutomationEditor } from "../../ui/automation/cmp_description-automation-editor";
import { FileText, Type } from "lucide-react";
import toast from "react-hot-toast";

export const PgAgencyAdminAutomatizare: React.FC = () => {
  const { tenant } = useTenantContext();
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState<"titlu" | "descriere">("titlu");
  const [rule, setRule] = useState<TitleAutomationRule>(() =>
    normalizeTitleAutomationRule(DEFAULT_TITLE_AUTOMATION_RULE)
  );
  const [isCustomOverride, setIsCustomOverride] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const record = await automationSettingsService.fetchTitleRule(tenant?.id);
        if (active && record?.titleRule) {
          setRule(normalizeTitleAutomationRule(record.titleRule));
          setIsCustomOverride(Boolean(record.isCustomOverride));
        }
      } catch (err: any) {
        if (active) {
          setRule(automationSettingsService.getCachedTitleRule(tenant?.id));
          setError(err?.message || "Nu s-a putut încărca configurația de automatizare.");
        }
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [tenant?.id, user?.uid]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveSuccess(false);
    setError(null);
    try {
      const saved = await automationSettingsService.saveTitleRule(rule, tenant?.id);
      setRule(saved.titleRule);
      setIsCustomOverride(true);
      setSaveSuccess(true);
      toast.success("Regula agenției a fost salvată!");
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      const msg = err?.message || "Eroare la salvarea regulii.";
      setError(msg);
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const reset = await automationSettingsService.resetTitleRule(tenant?.id);
      setRule(reset.titleRule);
      setIsCustomOverride(false);
      toast.success("Regula agenției a fost resetată la configurația implicită a platformei.");
    } catch (err: any) {
      toast.error(err?.message || "Nu s-a putut reseta regula.");
    } finally {
      setIsSaving(false);
    }
  };

  const tabsBar = (
    <div className="bg-white border-b border-gray-200 shrink-0 px-6 h-[42px] min-h-[42px] max-h-[42px] box-border flex items-center gap-1.5 overflow-hidden">
      <button
        type="button"
        onClick={() => setActiveTab("titlu")}
        className={`h-7 px-3 flex items-center gap-2 text-xs rounded-md transition-colors whitespace-nowrap cursor-pointer shrink-0 font-semibold ${
          activeTab === "titlu"
            ? "bg-[#051D35] text-white shadow-xs"
            : "text-gray-600 hover:text-[#051D35] hover:bg-gray-100"
        }`}
      >
        <Type size={13} />
        <span>Titlu</span>
      </button>
      <button
        type="button"
        onClick={() => setActiveTab("descriere")}
        className={`h-7 px-3 flex items-center gap-2 text-xs rounded-md transition-colors whitespace-nowrap cursor-pointer shrink-0 font-semibold ${
          activeTab === "descriere"
            ? "bg-[#051D35] text-white shadow-xs"
            : "text-gray-600 hover:text-[#051D35] hover:bg-gray-100"
        }`}
      >
        <FileText size={13} />
        <span>Descriere</span>
      </button>
    </div>
  );

  return (
    <CmpAgencyAdminLayout title="Automatizare" subHeader={tabsBar}>
      {activeTab === "titlu" ? (
        <CmpTitleAutomationEditor
          mode="agency"
          rule={rule}
          onChangeRule={setRule}
          isCustomOverride={isCustomOverride}
          isLoading={isLoading}
          isSaving={isSaving}
          saveSuccess={saveSuccess}
          error={error}
          onSave={handleSave}
          onReset={handleReset}
        />
      ) : (
        <CmpDescriptionAutomationEditor
          mode="agency"
          rule={rule}
          onChangeRule={setRule}
          isCustomOverride={isCustomOverride}
          isLoading={isLoading}
          isSaving={isSaving}
          saveSuccess={saveSuccess}
          error={error}
          onSave={handleSave}
          onReset={handleReset}
        />
      )}
    </CmpAgencyAdminLayout>
  );
};
