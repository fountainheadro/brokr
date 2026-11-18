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
import toast from "react-hot-toast";

export const PgPlatformAutomatizare: React.FC = () => {
  const { user } = useAuth();

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

  return (
    <CmpPlatformLayout title="Automatizare Implicită Platformă">
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
    </CmpPlatformLayout>
  );
};
