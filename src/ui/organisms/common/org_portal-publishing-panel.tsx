import React, { useCallback, useEffect, useState } from "react";
import { ExternalLink, Globe, PauseCircle, RefreshCw, Send, Trash2 } from "lucide-react";
import { getApiAuthHeaders } from "../../../lib/apiAuth";
import type {
  PortalProviderDescriptor,
  PortalPublicationRecord,
  PortalValidationResult,
} from "../../../core/portals/typ_portal-provider";
import { MolPortalStatusBadge } from "../../molecules/common/mol_portal-status-badge";
import { MolPortalValidationChecklist } from "../../molecules/common/mol_portal-validation-checklist";

export function isPortalPublishingUiEnabled(): boolean {
  try {
    return (import.meta as any)?.env?.VITE_ENABLE_PORTAL_PUBLISHING_UI === "true";
  } catch {
    return false;
  }
}

export interface OrgPortalPublishingPanelProps {
  propertyId: string;
  forceEnable?: boolean;
  className?: string;
}

/**
 * Phase 7 Feature-Flagged External Portal Publishing Organism.
 *
 * Remains hidden in Production unless `VITE_ENABLE_PORTAL_PUBLISHING_UI=true` (or `forceEnable`
 * in Staging/QA) so existing property forms and agent workflows remain 100% unaffected.
 */
export const OrgPortalPublishingPanel: React.FC<OrgPortalPublishingPanelProps> = ({
  propertyId,
  forceEnable = false,
  className = "",
}) => {
  const enabled = forceEnable || isPortalPublishingUiEnabled();
  const [loading, setLoading] = useState(false);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<PortalProviderDescriptor[]>([]);
  const [publications, setPublications] = useState<PortalPublicationRecord[]>([]);
  const [validations, setValidations] = useState<Record<string, PortalValidationResult>>({});

  const loadState = useCallback(async () => {
    if (!enabled || !propertyId) return;
    setLoading(true);
    setError(null);
    try {
      const headers = await getApiAuthHeaders();
      const res = await fetch(
        `/api/portals/properties/${encodeURIComponent(propertyId)}/publications`,
        { headers }
      );
      const json = await res.json();
      if (!res.ok || !json?.success) {
        throw new Error(json?.error?.message || "Nu s-au putut încărca portalurile.");
      }
      setProviders(json.data.providers || []);
      setPublications(json.data.publications || []);
      setValidations(json.data.validations || {});
    } catch (err: any) {
      setError(err?.message || "Eroare la încărcarea statusului portalurilor.");
    } finally {
      setLoading(false);
    }
  }, [enabled, propertyId]);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  if (!enabled) {
    return null;
  }

  const runAction = async (
    providerId: string,
    action: "publish" | "pause" | "withdraw" | "sync-status"
  ) => {
    setBusyProvider(providerId);
    setError(null);
    try {
      const headers = await getApiAuthHeaders({ "Content-Type": "application/json" });
      const res = await fetch(
        `/api/portals/properties/${encodeURIComponent(propertyId)}/${action}`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ providerId }),
        }
      );
      const json = await res.json();
      if (!res.ok && res.status !== 422) {
        throw new Error(json?.error?.message || "Acțiunea pe portal a eșuat.");
      }
      await loadState();
    } catch (err: any) {
      setError(err?.message || "Eroare la executarea acțiunii pe portal.");
    } finally {
      setBusyProvider(null);
    }
  };

  return (
    <section
      className={`rounded-xl border border-gray-200 bg-white overflow-hidden font-sans ${className}`}
    >
      <div className="px-5 py-3.5 bg-gray-50/80 border-b border-gray-200 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#051D35]/5 text-[#051D35] flex items-center justify-center">
            <Globe size={16} />
          </div>
          <div>
            <h3 className="font-title text-[12px] font-semibold text-[#051D35]">
              Publicare Portaluri Externe
            </h3>
            <p className="text-[11px] text-gray-500">
              Validare pre-publicare și sincronizare independentă per portal
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void loadState()}
          disabled={loading}
          className="h-8 px-2.5 rounded-md border border-gray-200 bg-white hover:bg-gray-50 text-xs text-gray-700 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          <span>Reîmprospătează</span>
        </button>
      </div>

      <div className="p-5 space-y-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        {providers.length === 0 && !loading ? (
          <p className="text-xs text-gray-500">
            Nu există provideri de portal înregistrați.
          </p>
        ) : (
          providers.map((provider) => {
            const pub = publications.find((p) => p.providerId === provider.providerId) || null;
            const validation = validations[provider.providerId];
            const status = pub?.status || (validation?.valid ? "ready" : "not_published");
            const isBusy = busyProvider === provider.providerId;
            const issues =
              pub?.validationErrors && pub.validationErrors.length > 0
                ? pub.validationErrors
                : validation?.issues || [];

            return (
              <div
                key={provider.providerId}
                className="rounded-lg border border-gray-200 p-4 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-[#051D35]">
                        {provider.displayName}
                      </span>
                      <MolPortalStatusBadge
                        status={status}
                        syncedVersion={pub?.syncedVersion}
                        submittedVersion={pub?.submittedVersion}
                      />
                    </div>
                    <p className="text-[11px] text-gray-500">
                      {provider.integrationMode.toUpperCase()}
                      {pub?.externalListingId ? ` · ID extern: ${pub.externalListingId}` : ""}
                      {pub?.lastSyncedAt
                        ? ` · Sincronizat: ${new Date(pub.lastSyncedAt).toLocaleString("ro-RO")}`
                        : ""}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {pub?.externalUrl && /^https?:\/\//i.test(pub.externalUrl) && (
                      <a
                        href={pub.externalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="h-7 px-2.5 rounded-md border border-gray-200 bg-white hover:bg-gray-50 text-[11px] text-[#051D35] inline-flex items-center gap-1"
                      >
                        <ExternalLink size={12} />
                        <span>Anunț</span>
                      </a>
                    )}

                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void runAction(provider.providerId, "publish")}
                      className="h-7 px-2.5 rounded-md bg-[#051D35] hover:bg-[#0a2b4a] text-white text-[11px] font-medium inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <Send size={12} />
                      <span>{pub?.externalListingId ? "Actualizează" : "Publică"}</span>
                    </button>

                    {pub?.externalListingId && status === "published" && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void runAction(provider.providerId, "pause")}
                        className="h-7 px-2.5 rounded-md border border-gray-200 bg-white hover:bg-gray-50 text-[11px] text-gray-700 inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        <PauseCircle size={12} />
                        <span>Pauză</span>
                      </button>
                    )}

                    {pub?.externalListingId && status !== "withdrawn" && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void runAction(provider.providerId, "withdraw")}
                        className="h-7 px-2.5 rounded-md border border-red-200 bg-white hover:bg-red-50 text-[11px] text-red-700 inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        <Trash2 size={12} />
                        <span>Retrage</span>
                      </button>
                    )}
                  </div>
                </div>

                {pub?.lastError && (
                  <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-md px-2.5 py-1.5">
                    {pub.lastError}
                  </p>
                )}

                <MolPortalValidationChecklist
                  issues={issues}
                  providerName={provider.displayName}
                  compact
                />
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};
