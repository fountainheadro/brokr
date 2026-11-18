import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Bot,
  Sparkles,
  Save,
  CheckCircle2,
  AlertCircle,
  Plus,
  Trash2,
  Send,
  MessageSquare,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { useTenantContext } from "../../core/tenancy/ctx_tenant";
import { useAuth } from "../../core/auth/ctx_auth";
import { AgencyAiPreferences, AiChatMessage } from "../../core/ai/typ_ai-engine";
import { CmpAgencyAdminLayout } from "../../ui/agency/cmp_agency-admin-layout";

export const PgAgencyAdminAiConfig: React.FC = () => {
  const { tenant, tenantContext } = useTenantContext();
  const { user } = useAuth();

  const [preferences, setPreferences] = useState<AgencyAiPreferences | null>(null);
  const [newRule, setNewRule] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Live Test Chat State
  const [chatMessages, setChatMessages] = useState<Array<{ role: string; content: string }>>([
    {
      role: "assistant",
      content: "Bună! Sunt asistentul AI al agenției dumneavoastră. Cu ce vă pot ajuta astăzi?",
    },
  ]);
  const [inputMessage, setInputMessage] = useState<string>("");
  const [isSending, setIsSending] = useState<boolean>(false);

  async function fetchConfig() {
    setIsLoading(true);
    setError(null);
    try {
      const token = await user?.getIdToken();
      const previewToken = localStorage.getItem("brokr_preview_token") || "";
      const res = await fetch("/api/tenant/ai/config", {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(previewToken ? { "x-preview-token": previewToken } : {}),
        },
      });

      const json = await res.json();
      if (json.success) {
        setPreferences(json.data.preferences);
      } else {
        setError(json.error?.message || "Eroare la încărcarea configurării AI.");
      }
    } catch (err: any) {
      setError(err?.message || "Eroare de conexiune.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchConfig();
  }, [tenant, user]);

  async function handleSaveConfig(e: React.FormEvent) {
    e.preventDefault();
    if (!preferences) return;

    setIsSaving(true);
    setSaveSuccess(false);
    setError(null);
    try {
      const token = await user?.getIdToken();
      const previewToken = localStorage.getItem("brokr_preview_token") || "";
      const res = await fetch("/api/tenant/ai/config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(previewToken ? { "x-preview-token": previewToken } : {}),
        },
        body: JSON.stringify(preferences),
      });

      const json = await res.json();
      if (json.success) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      } else {
        setError(json.error?.message || "Eroare la salvarea preferințelor AI.");
      }
    } catch (err: any) {
      setError(err?.message || "Eroare de conexiune.");
    } finally {
      setIsSaving(false);
    }
  }

  function handleAddRule() {
    if (!newRule.trim() || !preferences) return;
    setPreferences({
      ...preferences,
      customAgencyRules: [...preferences.customAgencyRules, newRule.trim()],
    });
    setNewRule("");
  }

  function handleRemoveRule(index: number) {
    if (!preferences) return;
    setPreferences({
      ...preferences,
      customAgencyRules: preferences.customAgencyRules.filter((_, i) => i !== index),
    });
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!inputMessage.trim() || isSending) return;

    const userText = inputMessage.trim();
    setInputMessage("");
    setChatMessages((prev) => [...prev, { role: "user", content: userText }]);
    setIsSending(true);

    try {
      const token = await user?.getIdToken();
      const previewToken = localStorage.getItem("brokr_preview_token") || "";
      const res = await fetch("/api/tenant/ai/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(previewToken ? { "x-preview-token": previewToken } : {}),
        },
        body: JSON.stringify({ prompt: userText }),
      });

      const json = await res.json();
      if (json.success) {
        setChatMessages((prev) => [
          ...prev,
          { role: "assistant", content: json.data.response },
        ]);
      } else {
        setChatMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `⚠️ Eroare: ${json.error?.message || "Nu am putut genera răspunsul."}`,
          },
        ]);
      }
    } catch (err: any) {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: `⚠️ Eroare rețea: ${err?.message}` },
      ]);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <CmpAgencyAdminLayout title="Personalizare Asistent AI Dedicat">
      <div className="max-w-6xl w-full mx-auto space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left Column: Configuration Form */}
          <div className="lg:col-span-7 space-y-4">
            <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-2xs space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                <div>
                  <h2 className="font-title text-sm font-semibold text-gray-900 flex items-center gap-2">
                    <Sparkles size={16} className="text-[#BE9662]" />
                    <span>Setări Asistent & Reguli Operaționale Agenție</span>
                  </h2>
                  <p className="text-xs text-gray-500 mt-1">
                    Definiți identitatea, tonul și instrucțiunile specifice aplicate tuturor brokerilor din agenție.
                  </p>
                </div>

                {saveSuccess && (
                  <span className="inline-flex items-center gap-1 text-xs font-normal text-emerald-700 bg-emerald-50 px-2 py-1 rounded border border-emerald-200 animate-fade-in">
                    <CheckCircle2 size={13} />
                    <span>Salvat cu succes!</span>
                  </span>
                )}
              </div>

              {isLoading ? (
                <div className="p-8 text-center text-xs text-gray-400">Se încarcă preferințele AI...</div>
              ) : error ? (
                <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded">{error}</div>
              ) : preferences ? (
                <form onSubmit={handleSaveConfig} className="space-y-4 text-xs">
                  <div>
                    <label className="block font-semibold text-gray-700 mb-1">Nume Asistent AI</label>
                    <input
                      type="text"
                      required
                      value={preferences.assistantName}
                      onChange={(e) => setPreferences({ ...preferences, assistantName: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded text-xs font-normal focus:ring-1 focus:ring-indigo-500"
                      placeholder="Ex: brokr. AI Copilot"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block font-semibold text-gray-700 mb-1">Ton Comunicare</label>
                      <select
                        value={preferences.systemTone}
                        onChange={(e) =>
                          setPreferences({ ...preferences, systemTone: e.target.value as any })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded text-xs font-normal bg-white"
                      >
                        <option value="professional">Profesionist & Sobru</option>
                        <option value="analytical">Analitic & Axat pe Cifre</option>
                        <option value="friendly">Prietenos & Consultativ</option>
                        <option value="authoritative">Autoritar & Sigur</option>
                        <option value="concise">Concis & Direct</option>
                      </select>
                    </div>

                    <div>
                      <label className="block font-semibold text-gray-700 mb-1">Limbă Implicită</label>
                      <select
                        value={preferences.language}
                        onChange={(e) =>
                          setPreferences({ ...preferences, language: e.target.value as any })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded text-xs font-normal bg-white"
                      >
                        <option value="ro">Română (Standard)</option>
                        <option value="en">Engleză</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block font-semibold text-gray-700 mb-1">Semnătură Contact Anunțuri</label>
                    <input
                      type="text"
                      value={preferences.contactSignature || ""}
                      onChange={(e) => setPreferences({ ...preferences, contactSignature: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded text-xs font-normal"
                      placeholder="Ex: Echipa de vânzări a agenției brokr."
                    />
                  </div>

                  {/* Custom Agency Rules */}
                  <div className="pt-2">
                    <label className="block font-semibold text-gray-700 mb-1">
                      Reguli Operaționale Specifice Agenției
                    </label>
                    <p className="text-[11px] text-gray-400 mb-2">
                      Aceste reguli sunt transmise asistentului în contextul fiecărei generări (ex: focalizare zonală, puncte cheie).
                    </p>

                    <div className="space-y-2 mb-3">
                      {preferences.customAgencyRules.map((rule, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-2 bg-gray-50 border border-gray-200 rounded text-xs"
                        >
                          <span className="text-gray-800">• {rule}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveRule(idx)}
                            className="text-gray-400 hover:text-rose-600 p-1"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="flex gap-4">
                      <input
                        type="text"
                        placeholder="Adaugă o regulă (ex: Menționează întotdeauna proximitatea de parcuri)..."
                        value={newRule}
                        onChange={(e) => setNewRule(e.target.value)}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded text-xs font-normal"
                      />
                      <button
                        type="button"
                        onClick={handleAddRule}
                        className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded font-semibold text-xs inline-flex items-center gap-1"
                      >
                        <Plus size={13} />
                        <span>Adaugă</span>
                      </button>
                    </div>
                  </div>

                  {/* Submit Button */}
                  <div className="pt-4 border-t border-gray-100 flex items-center justify-between">
                    <span className="text-[10px] text-gray-400 flex items-center gap-1">
                      <ShieldCheck size={12} className="text-emerald-600" />
                      Regulile de securitate ale platformei rămân mereu obligatorii.
                    </span>

                    <button
                      type="submit"
                      disabled={isSaving}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-[#051D35] hover:bg-[#051D35]/90 text-white font-semibold rounded shadow-2xs transition-colors disabled:opacity-50"
                    >
                      <Save size={13} />
                      <span>{isSaving ? "Se salvează..." : "Salvează Preferințele"}</span>
                    </button>
                  </div>
                </form>
              ) : null}
            </div>
          </div>

          {/* Right Column: Live Simulator Chat */}
          <div className="lg:col-span-5 flex flex-col h-[560px] bg-white border border-gray-200 rounded-lg shadow-2xs overflow-hidden">
            {/* Chat Header */}
            <div className="p-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-[#051D35] text-[#BE9662] flex items-center justify-center font-semibold text-xs">
                  AI
                </div>
                <div>
                  <h3 className="font-title text-xs font-semibold text-gray-900">
                    {preferences?.assistantName || "Simulator Asistent AI"}
                  </h3>
                  <span className="text-[10px] text-gray-400 block font-sans font-normal">
                    Context: {tenant?.name} ({tenant?.id})
                  </span>
                </div>
              </div>
              <span className="px-2 py-1 leading-none rounded text-[10px] font-normal bg-emerald-50 text-emerald-700 border border-emerald-200">
                Izolat Tenant
              </span>
            </div>

            {/* Messages Area */}
            <div className="flex-1 p-4 overflow-y-auto space-y-4 text-xs">
              {chatMessages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-lg px-3 py-2 leading-relaxed font-normal ${
                      msg.role === "user"
                        ? "bg-[#051D35] text-white"
                        : "bg-gray-100 text-gray-900 border border-gray-200"
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}
              {isSending && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 text-gray-500 rounded-lg px-3 py-2 text-xs italic animate-pulse">
                    Asistentul formulează răspunsul...
                  </div>
                </div>
              )}
            </div>

            {/* Input Bar */}
            <form onSubmit={handleSendMessage} className="p-3 border-t border-gray-200 bg-gray-50 flex gap-4">
              <input
                type="text"
                placeholder="Trimite o întrebare asistentului (ex: Caută apartamente în Floreasca)..."
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded text-xs font-normal bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <button
                type="submit"
                disabled={isSending || !inputMessage.trim()}
                className="px-3 py-2 bg-[#051D35] text-white rounded font-semibold text-xs hover:bg-[#051D35]/90 disabled:opacity-40 transition-colors"
              >
                <Send size={13} />
              </button>
            </form>
          </div>
        </div>
      </div>
    </CmpAgencyAdminLayout>
  );
};
