import React, { useEffect, useState } from "react";
import { CmpPlatformLayout } from "../../ui/platform/cmp_platform-layout";
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

export const PgPlatformAutomatizare: React.FC = () => {
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState<"titlu" | "descriere">("titlu");
  const [rule, setRule] = useState<TitleAutomationRule>(() =>
    normalizeTitleAutomationRule(DEFAULT_TITLE_AUTOMATION_RULE)
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!user) return;
      setIsLoading(true);
      setError(null);
      try {
        const record = await automationSettingsService.fetchPlatformDefaultTitleRule();
        if (active && record?.titleRule) {
          setRule(normalizeTitleAutomationRule(record.titleRule));
        }
      } catch (err: any) {
        if (active) {
          setError(err?.message || "Nu s-a putut încărca regula implicită a platformei.");
        }
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [user?.uid]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveSuccess(false);
    setError(null);
    try {
      const saved = await automationSettingsService.savePlatformDefaultTitleRule(rule);
      setRule(saved.titleRule);
      setSaveSuccess(true);
      toast.success("Regula implicită globală a fost salvată!");
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      const msg = err?.message || "Eroare la salvarea regulii implicite.";
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
      const reset = await automationSettingsService.resetPlatformDefaultTitleRule();
      setRule(reset.titleRule);
      toast.success("Regula implicită globală a fost resetată la valorile de sistem.");
    } catch (err: any) {
      toast.error(err?.message || "Nu s-a putut reseta regula implicită.");
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
    <CmpPlatformLayout title="Automatizare Implicită Platformă" subHeader={tabsBar}>
      {activeTab === "titlu" ? (
        <CmpTitleAutomationEditor
          mode="platform_default"
          rule={rule}
          onChangeRule={setRule}
          isLoading={isLoading}
          isSaving={isSaving}
          saveSuccess={saveSuccess}
          error={error}
          onSave={handleSave}
          onReset={handleReset}
        />
      ) : (
        <CmpDescriptionAutomationEditor
          mode="platform_default"
          rule={rule}
          onChangeRule={setRule}
          isLoading={isLoading}
          isSaving={isSaving}
          saveSuccess={saveSuccess}
          error={error}
          onSave={handleSave}
          onReset={handleReset}
        />
      )}
    </CmpPlatformLayout>
  );
};
