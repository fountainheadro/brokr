import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Store,
  Timer,
  Clock,
  Play,
  RotateCcw,
  Save,
  ExternalLink,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Info,
  Copy,
  Check,
  MapPin,
  Phone,
  User,
  SlidersHorizontal,
  Globe,
  Sparkles,
} from "lucide-react";
import toast from "react-hot-toast";
import { CmpAgencyAdminLayout } from "../../ui/agency/cmp_agency-admin-layout";
import { useAuth } from "../../core/auth/ctx_auth";
import { useTenantContext } from "../../core/tenancy/ctx_tenant";
import { OlxLeadFilterForm } from "../../components/OlxLeadFilterPanel";
import {
  OLX_SCAN_INTERVAL_OPTIONS,
  OLX_SCAN_COUNT_OPTIONS,
  OLX_MAX_AGE_STEPS,
  DEFAULT_OLX_MIN_AD_AGE_HOURS,
  DEFAULT_OLX_MAX_AD_AGE_HOURS,
} from "../../components/OlxLeadDrawer";
import {
  DEFAULT_OLX_LEAD_FILTERS,
  countActiveOlxFilters,
  type OlxLeadFilters,
} from "../../utils/olxFilterUtils";
import { resolveLeadDisplayArea } from "../../utils/zoneResolutionUtils";
import { platformAutoCrawlService } from "../../services/platformAutoCrawlService";
import { leadsService, type Lead } from "../../services/leadsService";
import {
  agencyMarketService,
  DEFAULT_AGENCY_MARKET_CONFIG,
  findAgencyCopyForSharedLead,
  matchSharedLeadsForAgency,
  type AgencyMarketAutoImportConfig,
} from "../../services/agencyMarketService";
import { formatEmailToDisplayName } from "../../utils/leadAgentFilterUtils";

type FeedFilterTab = "all" | "available" | "matched" | "copied";

export const PgAgencyAdminPiataImobiliara: React.FC = () => {
  const { user } = useAuth();
  const { tenant, tenantContext } = useTenantContext();
  const tenantId = tenant?.id;

  const [config, setConfig] = useState<AgencyMarketAutoImportConfig>(() =>
    agencyMarketService.getCachedConfig(tenantId)
  );
  const [sharedLeads, setSharedLeads] = useState<Lead[]>([]);
  const [agencyLeads, setAgencyLeads] = useState<Lead[]>([]);
  const [isLoadingConfig, setIsLoadingConfig] = useState<boolean>(true);
  const [isSavingConfig, setIsSavingConfig] = useState<boolean>(false);
  const [isRunningAutoMatch, setIsRunningAutoMatch] = useState<boolean>(false);
  const [copyingIds, setCopyingIds] = useState<Record<string, boolean>>({});
  const [feedTab, setFeedTab] = useState<FeedFilterTab>("all");

  const configRef = useRef<AgencyMarketAutoImportConfig>(config);
  const sharedLeadsRef = useRef<Lead[]>(sharedLeads);
  const agencyLeadsRef = useRef<Lead[]>(agencyLeads);
  const isRunningRef = useRef<boolean>(false);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    sharedLeadsRef.current = sharedLeads;
  }, [sharedLeads]);

  useEffect(() => {
    agencyLeadsRef.current = agencyLeads;
  }, [agencyLeads]);

  const actor = useMemo(() => {
    const email = (user?.email || tenantContext?.userEmail || "").trim().toLowerCase();
    const uid = (user?.uid || tenantContext?.userId || "").trim();
    const name =
      user?.displayName?.trim() ||
      formatEmailToDisplayName(email) ||
      "Administrator Agenție";
    return { name, email, uid };
  }, [user?.displayName, user?.email, user?.uid, tenantContext?.userEmail, tenantContext?.userId]);

  // Load persisted per-agency auto-match configuration
  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!user) return;
      setIsLoadingConfig(true);
      try {
        const loaded = await agencyMarketService.loadConfig(tenantId);
        if (active) {
          setConfig(loaded);
          configRef.current = loaded;
        }
      } finally {
        if (active) setIsLoadingConfig(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [tenantId, user?.uid]);

  // Subscribe to common Super Admin repository (platform_shared_leads) and current agency's leads
  useEffect(() => {
    if (!user) return;
    const unsubShared = platformAutoCrawlService.subscribeToSharedLeads((items) => {
      setSharedLeads(items);
    });
    const unsubAgency = leadsService.subscribeToLeads((items) => {
      setAgencyLeads(items);
    });
    return () => {
      unsubShared();
      unsubAgency();
    };
  }, [user?.uid, tenantId]);

  const persistConfig = useCallback(
    async (next: AgencyMarketAutoImportConfig, showToast = false) => {
      setConfig(next);
      configRef.current = next;
      setIsSavingConfig(true);
      try {
        await agencyMarketService.saveConfig(tenantId, next);
        if (showToast) {
          toast.success("Regulile de potrivire pentru Piața Imobiliară au fost salvate.");
        }
      } catch (err: any) {
        console.warn("[PgAgencyAdminPiataImobiliara] Failed saving config:", err);
        if (showToast) {
          toast.error(err?.message || "Nu s-au putut salva filtrele.");
        }
      } finally {
        setIsSavingConfig(false);
      }
    },
    [tenantId]
  );

  const runAutoMatch = useCallback(
    async (isManual = false) => {
      if (isRunningRef.current || !user) return;
      isRunningRef.current = true;
      setIsRunningAutoMatch(true);
      try {
        const currentCfg = configRef.current;
        const result = await agencyMarketService.runAutoMatchImport({
          sharedLeads: sharedLeadsRef.current,
          agencyLeads: agencyLeadsRef.current,
          config: currentCfg,
          actor,
        });

        const nextConfig: AgencyMarketAutoImportConfig = {
          ...currentCfg,
          lastRunAt: Date.now(),
          lastNotice: result.notice,
        };
        await persistConfig(nextConfig, false);

        if (result.copiedCount > 0) {
          toast.success(
            `${result.copiedCount} ${result.copiedCount === 1 ? "anunț a fost copiat" : "anunțuri au fost copiate"} în Lead-uri → Noi.`
          );
        } else if (isManual && result.notice) {
          if (result.notice.type === "error") {
            toast.error(result.notice.message);
          } else {
            toast(result.notice.message);
          }
        }
      } catch (err: any) {
        const errMsg = err?.message || "Eroare la importul automat din Piața Imobiliară.";
        await persistConfig(
          {
            ...configRef.current,
            lastRunAt: Date.now(),
            lastNotice: {
              type: "error",
              title: "Eroare la importul automat",
              message: errMsg,
              timestamp: Date.now(),
            },
          },
          false
        );
        if (isManual) toast.error(errMsg);
      } finally {
        isRunningRef.current = false;
        setIsRunningAutoMatch(false);
      }
    },
    [actor, persistConfig, user]
  );

  // Phase 6: Scheduled periodic auto-matching is owned exclusively by the backend Cloud Scheduler
  // worker (/internal/workers/agency-market-auto-import) under a fenced Firestore lease.
  // Manual "Rulează acum" and manual copy controls remain available directly on this page.

  const handleManualCopy = async (sharedLead: Lead) => {
    const key = sharedLead.id || sharedLead.url || sharedLead.propertyId || "";
    if (!key || copyingIds[key]) return;

    const existing = findAgencyCopyForSharedLead(sharedLead, agencyLeads);
    if (existing) {
      toast(`Anunțul este deja copiat în agenție (#${existing.propertyId || existing.id}).`);
      return;
    }

    setCopyingIds((prev) => ({ ...prev, [key]: true }));
    try {
      const result = await agencyMarketService.copySharedLeadToAgencyNoi({
        sharedLead,
        actor,
        mode: "manual",
      });
      toast.success(
        `Anunțul a fost copiat în Lead-uri → Noi cu ID #${result.propertyId} (titlu și descriere formatate).`
      );
    } catch (err: any) {
      console.error("[PgAgencyAdminPiataImobiliara] Manual copy failed:", err);
      toast.error(err?.message || "Nu s-a putut copia anunțul în Lead-uri → Noi.");
    } finally {
      setCopyingIds((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  // Dual-knob Ad Age slider math (strict invariant: 0 <= minStepIndex < maxStepIndex <= lastIdx)
  const lastIdx = OLX_MAX_AGE_STEPS.length - 1;
  const rawMinIdx = OLX_MAX_AGE_STEPS.findIndex((s) => s.hours === config.minAdAgeHours);
  const rawMaxIdx = OLX_MAX_AGE_STEPS.findIndex((s) => s.hours === config.maxAdAgeHours);
  let maxStepIndex = rawMaxIdx >= 1 ? rawMaxIdx : lastIdx;
  let minStepIndex = rawMinIdx >= 0 ? rawMinIdx : 0;
  if (minStepIndex >= maxStepIndex) {
    minStepIndex = Math.max(0, maxStepIndex - 1);
    if (maxStepIndex <= minStepIndex) {
      maxStepIndex = Math.min(lastIdx, minStepIndex + 1);
    }
  }
  const minAgeStep = OLX_MAX_AGE_STEPS[minStepIndex];
  const maxAgeStep = OLX_MAX_AGE_STEPS[maxStepIndex];
  const minPct = (minStepIndex / lastIdx) * 100;
  const maxPct = (maxStepIndex / lastIdx) * 100;

  const handleMinIdxChange = (nextIdx: number) => {
    const clamped = Math.max(0, Math.min(maxStepIndex - 1, nextIdx));
    const step = OLX_MAX_AGE_STEPS[clamped];
    if (step) {
      setConfig((prev) => ({ ...prev, minAdAgeHours: step.hours }));
    }
  };

  const handleMaxIdxChange = (nextIdx: number) => {
    const clamped = Math.min(lastIdx, Math.max(minStepIndex + 1, nextIdx));
    const step = OLX_MAX_AGE_STEPS[clamped];
    if (step) {
      setConfig((prev) => ({ ...prev, maxAdAgeHours: step.hours }));
    }
  };

  const handleStepLabelClick = (idx: number) => {
    if (idx <= minStepIndex) {
      handleMinIdxChange(idx);
    } else if (idx >= maxStepIndex) {
      handleMaxIdxChange(idx);
    } else {
      const distToMin = idx - minStepIndex;
      const distToMax = maxStepIndex - idx;
      if (distToMin <= distToMax && idx <= maxStepIndex - 1) {
        handleMinIdxChange(idx);
      } else if (idx >= minStepIndex + 1) {
        handleMaxIdxChange(idx);
      }
    }
  };

  const handleIntervalChange = (minutes: number) => {
    const next: AgencyMarketAutoImportConfig = {
      ...config,
      matchIntervalMinutes: minutes,
    };
    void persistConfig(next, false);
    if (minutes > 0) {
      void runAutoMatch(true);
    }
  };

  const handleFiltersChange = (nextFilters: OlxLeadFilters) => {
    setConfig((prev) => ({ ...prev, filters: nextFilters }));
  };

  const handleReset = () => {
    const resetCfg: AgencyMarketAutoImportConfig = {
      ...DEFAULT_AGENCY_MARKET_CONFIG,
      filters: { ...DEFAULT_OLX_LEAD_FILTERS, zones: [] },
      minAdAgeHours: DEFAULT_OLX_MIN_AD_AGE_HOURS,
      maxAdAgeHours: DEFAULT_OLX_MAX_AD_AGE_HOURS,
      lastRunAt: config.lastRunAt,
      lastNotice: null,
    };
    void persistConfig(resetCfg, true);
  };

  // Precompute copy map & matched leads
  const copyBySharedKey = useMemo(() => {
    const map = new Map<string, Lead>();
    for (const shared of sharedLeads) {
      const key = shared.id || shared.url || shared.propertyId || "";
      if (!key) continue;
      const copy = findAgencyCopyForSharedLead(shared, agencyLeads);
      if (copy) {
        map.set(key, copy);
      }
    }
    return map;
  }, [sharedLeads, agencyLeads]);

  const matchedUncopiedLeads = useMemo(
    () => matchSharedLeadsForAgency(sharedLeads, agencyLeads, config),
    [sharedLeads, agencyLeads, config]
  );

  const matchedIdSet = useMemo(() => {
    const set = new Set<string>();
    for (const item of matchedUncopiedLeads) {
      const key = item.id || item.url || item.propertyId || "";
      if (key) set.add(key);
    }
    return set;
  }, [matchedUncopiedLeads]);

  const counts = useMemo(() => {
    let copied = 0;
    let available = 0;
    for (const s of sharedLeads) {
      const key = s.id || s.url || s.propertyId || "";
      if (key && copyBySharedKey.has(key)) copied++;
      else available++;
    }
    return {
      all: sharedLeads.length,
      available,
      matched: matchedUncopiedLeads.length,
      copied,
    };
  }, [sharedLeads, copyBySharedKey, matchedUncopiedLeads.length]);

  const displayedSharedLeads = useMemo(() => {
    if (feedTab === "all") return sharedLeads;
    if (feedTab === "matched") return matchedUncopiedLeads;
    return sharedLeads.filter((s) => {
      const key = s.id || s.url || s.propertyId || "";
      const isCopied = Boolean(key && copyBySharedKey.has(key));
      return feedTab === "copied" ? isCopied : !isCopied;
    });
  }, [feedTab, sharedLeads, matchedUncopiedLeads, copyBySharedKey]);

  const activeFilterCount = countActiveOlxFilters(config.filters);

  return (
    <CmpAgencyAdminLayout title="Piața Imobiliară">
      <div className="space-y-6 pb-8">
        {/* Top Summary Banner */}
        <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-2xs flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#051D35]/5 border border-[#051D35]/15 flex items-center justify-center text-[#051D35] shrink-0">
              <Store
                size={20}
                className={config.matchIntervalMinutes > 0 ? "text-[#BE9662]" : "text-[#051D35]"}
              />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-semibold text-[#051D35]">
                  Piața Imobiliară — Repositoriu Comun & Import Automat în Lead-uri → Noi
                </h2>
                {config.matchIntervalMinutes > 0 ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Auto-import activ (la {config.matchIntervalMinutes} min)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-600 bg-gray-100 border border-gray-200 px-2 py-0.5 rounded">
                    Manual / Oprit
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-1 max-w-2xl">
                Anunțurile colectate de platformă apar aici în formatul lor original. Copiază manual câte un anunț sau configurează filtre automate pentru a muta potrivirile direct în{" "}
                <strong className="text-[#051D35]">Lead-uri → Noi</strong> cu ID unic de agenție (#L...).
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <button
              type="button"
              onClick={() => void persistConfig(config, true)}
              disabled={isSavingConfig || isLoadingConfig}
              className="h-9 px-3.5 inline-flex items-center gap-1.5 text-xs font-semibold text-[#051D35] bg-white border border-gray-200 hover:bg-gray-50 rounded-md transition-colors cursor-pointer disabled:opacity-60"
            >
              {isSavingConfig ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              <span>Salvează filtrele</span>
            </button>
            <button
              type="button"
              onClick={() => void runAutoMatch(true)}
              disabled={isRunningAutoMatch || isLoadingConfig}
              className="h-9 px-4 inline-flex items-center gap-2 text-xs font-semibold text-white bg-[#051D35] hover:bg-[#0a2b4a] rounded-md transition-colors cursor-pointer shadow-2xs disabled:opacity-60"
            >
              {isRunningAutoMatch ? (
                <Loader2 size={14} className="animate-spin text-[#BE9662]" />
              ) : (
                <Play size={14} className="text-[#BE9662]" />
              )}
              <span>
                {isRunningAutoMatch
                  ? "Se copiază potrivirile..."
                  : `Importă potrivirile acum (${counts.matched})`}
              </span>
            </button>
          </div>
        </div>

        {/* Last Notice Banner */}
        {config.lastNotice && (
          <div
            role={config.lastNotice.type === "error" ? "alert" : "status"}
            className={`flex items-start justify-between gap-3 px-4 py-3 rounded-lg border text-xs ${
              config.lastNotice.type === "error"
                ? "bg-red-50 border-red-200 text-red-900"
                : config.lastNotice.type === "success"
                  ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                  : "bg-amber-50/80 border-amber-200/90 text-[#051D35]"
            }`}
          >
            <div className="flex items-start gap-2.5 min-w-0">
              {config.lastNotice.type === "error" ? (
                <AlertCircle size={16} className="text-red-600 shrink-0 mt-0.5" />
              ) : config.lastNotice.type === "success" ? (
                <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <Info size={16} className="text-[#BE9662] shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold">{config.lastNotice.title}</span>
                  <span className="text-[10px] opacity-70 tabular-nums">
                    {new Date(config.lastNotice.timestamp).toLocaleString("ro-RO")}
                  </span>
                </div>
                <p className="text-[11px] mt-0.5 opacity-90">{config.lastNotice.message}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void persistConfig({ ...config, lastNotice: null }, false)}
              className="text-[11px] font-medium underline opacity-75 hover:opacity-100 cursor-pointer shrink-0"
            >
              Ascunde
            </button>
          </div>
        )}

        {/* Two-column layout: Schedule & Match Filters (left) + Shared Market Repository Feed (right) */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Left column: Schedule + Matching Filters */}
          <div className="xl:col-span-5 space-y-5">
            {/* Schedule & Limit Card */}
            <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-2xs space-y-4">
              <div className="flex items-center justify-between gap-2 pb-3 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <Timer size={16} className="text-[#BE9662]" />
                  <h3 className="text-xs font-semibold text-[#051D35]">
                    Programare & Limită Auto-Match
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={handleReset}
                  className="h-7 px-2.5 inline-flex items-center gap-1 text-[11px] font-medium text-gray-600 hover:text-[#051D35] bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-md transition-colors cursor-pointer"
                >
                  <RotateCcw size={12} />
                  <span>Resetează</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2 space-y-1.5">
                  <label className="block text-[11px] font-semibold text-[#051D35]">
                    Interval copiere automată
                  </label>
                  <select
                    value={config.matchIntervalMinutes}
                    onChange={(e) => handleIntervalChange(Number(e.target.value))}
                    className="w-full h-9 px-2.5 text-xs bg-gray-50 border border-gray-200 rounded-md text-gray-800 focus:outline-none focus:bg-white focus:border-[#051D35] transition-colors cursor-pointer"
                  >
                    {OLX_SCAN_INTERVAL_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[11px] font-semibold text-[#051D35]">
                    Anunțuri / rulare
                  </label>
                  <select
                    value={config.matchLimit}
                    onChange={(e) =>
                      setConfig((prev) => ({ ...prev, matchLimit: Number(e.target.value) }))
                    }
                    className="w-full h-9 px-2.5 text-xs bg-gray-50 border border-gray-200 rounded-md text-gray-800 focus:outline-none focus:bg-white focus:border-[#051D35] transition-colors cursor-pointer tabular-nums"
                  >
                    {OLX_SCAN_COUNT_OPTIONS.map((count) => (
                      <option key={count} value={count}>
                        {count} anunțuri
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Dual-Knob Ad Age Range Slider */}
              <div className="pt-3 border-t border-gray-100 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[#051D35]">
                    <Clock size={12} className="text-[#BE9662]" />
                    <span>Vechime anunț (de la publicare)</span>
                  </span>
                  <span className="text-[11px] font-semibold text-[#051D35] bg-gray-50 border border-gray-200 px-2 py-0.5 rounded tabular-nums shrink-0">
                    {minAgeStep.label} – {maxAgeStep.label}
                  </span>
                </div>

                <div className="relative h-6 flex items-center select-none">
                  <div className="w-full h-1.5 bg-gray-200 rounded-full relative overflow-hidden">
                    <div
                      className="absolute inset-y-0 bg-[#051D35] rounded-full transition-all duration-75"
                      style={{
                        left: `${minPct}%`,
                        width: `${Math.max(0, maxPct - minPct)}%`,
                      }}
                    />
                  </div>
                  <input
                    id="agency-market-ad-age-min-slider"
                    type="range"
                    aria-label="Vechime minimă anunț"
                    min={0}
                    max={lastIdx}
                    step={1}
                    value={minStepIndex}
                    onChange={(e) => handleMinIdxChange(Number(e.target.value))}
                    className="absolute inset-0 w-full h-6 appearance-none bg-transparent pointer-events-none z-20 [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[#051D35] [&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:hover:border-[#BE9662] [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[#051D35] [&::-moz-range-thumb]:shadow-sm [&::-moz-range-thumb]:cursor-grab"
                  />
                  <input
                    id="agency-market-ad-age-max-slider"
                    type="range"
                    aria-label="Vechime maximă anunț"
                    min={0}
                    max={lastIdx}
                    step={1}
                    value={maxStepIndex}
                    onChange={(e) => handleMaxIdxChange(Number(e.target.value))}
                    className="absolute inset-0 w-full h-6 appearance-none bg-transparent pointer-events-none z-20 [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#051D35] [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[#BE9662] [&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:hover:scale-110 [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[#051D35] [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[#BE9662] [&::-moz-range-thumb]:shadow-sm [&::-moz-range-thumb]:cursor-grab"
                  />
                </div>

                <div className="grid grid-cols-14 gap-0 items-center">
                  {OLX_MAX_AGE_STEPS.map((step, idx) => {
                    const isEndpoint = idx === minStepIndex || idx === maxStepIndex;
                    const isInRange = idx > minStepIndex && idx < maxStepIndex;
                    return (
                      <button
                        key={step.hours}
                        type="button"
                        onClick={() => handleStepLabelClick(idx)}
                        title={step.label}
                        className={`text-[9px] text-center py-0.5 rounded transition-colors cursor-pointer tabular-nums ${
                          isEndpoint
                            ? "font-bold text-[#051D35] bg-[#BE9662]/25"
                            : isInRange
                              ? "font-medium text-[#051D35]/75"
                              : "font-normal text-gray-400 hover:text-[#051D35]"
                        }`}
                      >
                        {step.shortLabel}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Live Match Summary */}
              <div className="pt-3 border-t border-gray-100 flex items-center justify-between gap-2 text-[11px]">
                <span className="inline-flex items-center gap-1.5 text-gray-600">
                  <Sparkles size={12} className="text-[#BE9662]" />
                  <span>Potriviri disponibile acum pentru import:</span>
                </span>
                <span className="font-semibold text-[#051D35] bg-[#BE9662]/15 border border-[#BE9662]/30 px-2 py-0.5 rounded tabular-nums">
                  {counts.matched} anunțuri
                </span>
              </div>

              {config.lastRunAt && (
                <div className="pt-2 border-t border-gray-100 text-[11px] text-gray-500 flex items-center justify-between">
                  <span>Ultima rulare executată:</span>
                  <span className="font-medium text-gray-700 tabular-nums">
                    {new Date(config.lastRunAt).toLocaleString("ro-RO")}
                  </span>
                </div>
              )}
            </div>

            {/* Matching Filters Card */}
            <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-2xs space-y-4">
              <div className="flex items-center justify-between gap-2 pb-3 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal size={16} className="text-[#051D35]" />
                  <h3 className="text-xs font-semibold text-[#051D35]">
                    Filtre de Potrivire (Piața Imobiliară)
                  </h3>
                </div>
                {activeFilterCount > 0 && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-[#051D35]/10 text-[#051D35] tabular-nums">
                    {activeFilterCount} active
                  </span>
                )}
              </div>

              <OlxLeadFilterForm
                filters={config.filters}
                onChange={handleFiltersChange}
                pageContext="autoScan"
              />
            </div>
          </div>

          {/* Right column: Shared Market Repository Feed */}
          <div className="xl:col-span-7 bg-white border border-gray-200 rounded-lg shadow-2xs overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h3 className="text-xs font-semibold text-[#051D35] flex items-center gap-2">
                    <span>Repositoriu Comun — Piața Imobiliară</span>
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-[#051D35] text-white tabular-nums">
                      {counts.all}
                    </span>
                  </h3>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    Selectează manual anunțuri sau folosește filtrele din stânga pentru a le copia automat în Lead-uri → Noi.
                  </p>
                </div>
              </div>

              {/* View Filter Tabs */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {(
                  [
                    { id: "all", label: "Toate", count: counts.all },
                    { id: "available", label: "Disponibile", count: counts.available },
                    { id: "matched", label: "Potrivite filtrelor", count: counts.matched },
                    { id: "copied", label: "Copiate în Noi", count: counts.copied },
                  ] as const
                ).map((tab) => {
                  const isActive = feedTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setFeedTab(tab.id)}
                      className={`h-7 px-2.5 inline-flex items-center gap-1.5 text-[11px] rounded-md transition-colors cursor-pointer ${
                        isActive
                          ? "bg-[#051D35] text-white font-semibold"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200/70 hover:text-[#051D35] font-medium"
                      }`}
                    >
                      <span>{tab.label}</span>
                      <span
                        className={`text-[10px] px-1 rounded tabular-nums ${
                          isActive ? "bg-white/15 text-[#BE9662]" : "bg-white text-gray-500"
                        }`}
                      >
                        {tab.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {displayedSharedLeads.length === 0 ? (
              <div className="p-10 text-center flex flex-col items-center justify-center">
                <div className="w-12 h-12 rounded-full bg-gray-50 border border-gray-200 flex items-center justify-center text-gray-400 mb-3">
                  <Store size={22} />
                </div>
                <p className="text-xs font-semibold text-gray-700">
                  {sharedLeads.length === 0
                    ? "Nu există încă anunțuri în Piața Imobiliară"
                    : feedTab === "matched"
                      ? "Niciun anunț necopiat nu corespunde filtrelor curente"
                      : feedTab === "copied"
                        ? "Nu ați copiat încă niciun anunț din Piața Imobiliară"
                        : "Toate anunțurile au fost deja copiate în agenție"}
                </p>
                <p className="text-[11px] text-gray-500 mt-1 max-w-sm">
                  {sharedLeads.length === 0
                    ? "Anunțurile colectate de administratorul platformei vor apărea automat aici."
                    : "Ajustează filtrele din stânga sau schimbă tab-ul pentru a vedea celelalte anunțuri."}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100 max-h-[820px] overflow-y-auto">
                {displayedSharedLeads.map((lead) => {
                  const key = lead.id || lead.url || lead.propertyId || "";
                  const agencyCopy = key ? copyBySharedKey.get(key) : undefined;
                  const isMatched = Boolean(key && matchedIdSet.has(key));
                  const isCopying = Boolean(key && copyingIds[key]);
                  const thumb =
                    lead.coverImage ||
                    (Array.isArray(lead.images) ? lead.images[0] : undefined);
                  const createdDate =
                    lead.createdAt && typeof lead.createdAt?.toDate === "function"
                      ? lead.createdAt.toDate()
                      : lead.createdAt
                        ? new Date(lead.createdAt)
                        : null;

                  return (
                    <div
                      key={key || lead.title}
                      className="p-4 hover:bg-gray-50/70 transition-colors flex items-start gap-3.5"
                    >
                      <div className="w-20 h-16 rounded-md bg-gray-100 border border-gray-200 overflow-hidden shrink-0 flex items-center justify-center">
                        {thumb ? (
                          <img
                            src={thumb}
                            alt={lead.title}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <Globe size={18} className="text-gray-300" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {lead.propertyId && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#051D35]/10 text-[#051D35] tabular-nums">
                                  #{lead.propertyId}
                                </span>
                              )}
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-[#8A6736] border border-amber-200/70">
                                {lead.transactionType}
                              </span>
                              {lead.categoria && (
                                <span className="text-[10px] font-medium text-gray-500">
                                  {lead.categoria}
                                </span>
                              )}
                              {!agencyCopy && isMatched && activeFilterCount > 0 && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  Potrivit filtrelor
                                </span>
                              )}
                            </div>
                            <h4 className="text-xs font-semibold text-[#051D35] mt-1 line-clamp-1">
                              {lead.title}
                            </h4>
                          </div>

                          <div className="text-right shrink-0">
                            <div className="text-xs font-bold text-[#051D35] tabular-nums">
                              {lead.price}
                            </div>
                            {createdDate && !Number.isNaN(createdDate.getTime()) && (
                              <div className="text-[10px] text-gray-400 tabular-nums mt-0.5">
                                {createdDate.toLocaleString("ro-RO", {
                                  day: "2-digit",
                                  month: "2-digit",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 flex-wrap mt-2">
                          <div className="flex items-center gap-3 flex-wrap text-[11px] text-gray-500">
                            <span className="inline-flex items-center gap-1">
                              <MapPin size={11} className="text-[#BE9662]" />
                              <span className="truncate max-w-[150px]">
                                {resolveLeadDisplayArea(lead)}
                              </span>
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <User size={11} className="text-[#BE9662]" />
                              <span className="truncate max-w-[130px]">
                                {lead.ownerName || "Proprietar"}
                              </span>
                            </span>
                            <span className="inline-flex items-center gap-1 tabular-nums">
                              <Phone size={11} className="text-[#BE9662]" />
                              <span>{lead.ownerPhone || "Nespecificat"}</span>
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {lead.url && (
                              <a
                                href={lead.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Deschide anunțul original"
                                className="h-7 w-7 inline-flex items-center justify-center text-gray-400 hover:text-[#051D35] hover:bg-gray-100 border border-gray-200 rounded-md transition-colors"
                              >
                                <ExternalLink size={13} />
                              </a>
                            )}

                            {agencyCopy ? (
                              <Link
                                to={agencyCopy.id ? `/leads/${agencyCopy.id}` : "/"}
                                className="h-7 px-2.5 inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md transition-colors tabular-nums"
                                title="Deschide copia din Lead-uri → Noi"
                              >
                                <Check size={12} />
                                <span>
                                  Copiat în Noi
                                  {agencyCopy.propertyId ? ` (#${agencyCopy.propertyId})` : ""}
                                </span>
                              </Link>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void handleManualCopy(lead)}
                                disabled={isCopying}
                                className="h-7 px-2.5 inline-flex items-center gap-1.5 text-[11px] font-semibold text-white bg-[#051D35] hover:bg-[#0a2b4a] rounded-md transition-colors cursor-pointer disabled:opacity-60"
                              >
                                {isCopying ? (
                                  <>
                                    <Loader2 size={12} className="animate-spin text-[#BE9662]" />
                                    <span>Se copiază...</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy size={12} className="text-[#BE9662]" />
                                    <span>Copiază în Noi</span>
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </CmpAgencyAdminLayout>
  );
};
