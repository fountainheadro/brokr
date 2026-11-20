import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Timer,
  Clock,
  Play,
  RotateCcw,
  Save,
  Trash2,
  ExternalLink,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Info,
  Radar,
  Globe,
  MapPin,
  Phone,
  User,
} from "lucide-react";
import toast from "react-hot-toast";
import { CmpPlatformLayout } from "../../ui/platform/cmp_platform-layout";
import { useAuth } from "../../core/auth/ctx_auth";
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
import {
  platformAutoCrawlService,
  DEFAULT_PLATFORM_AUTO_CRAWL_CONFIG,
  type PlatformAutoCrawlConfig,
} from "../../services/platformAutoCrawlService";
import type { Lead } from "../../services/leadsService";

export const PgPlatformAutoCrawl: React.FC = () => {
  const { user } = useAuth();
  const [config, setConfig] = useState<PlatformAutoCrawlConfig>(() =>
    platformAutoCrawlService.getCachedConfig()
  );
  const [sharedLeads, setSharedLeads] = useState<Lead[]>([]);
  const [isLoadingConfig, setIsLoadingConfig] = useState<boolean>(true);
  const [isSavingConfig, setIsSavingConfig] = useState<boolean>(false);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [isClearingAll, setIsClearingAll] = useState<boolean>(false);
  const [confirmClearAll, setConfirmClearAll] = useState<boolean>(false);

  const configRef = useRef<PlatformAutoCrawlConfig>(config);
  const sharedLeadsRef = useRef<Lead[]>(sharedLeads);
  const isScanningRef = useRef<boolean>(false);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    sharedLeadsRef.current = sharedLeads;
  }, [sharedLeads]);

  // Load persisted global auto-crawl configuration
  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!user) return;
      setIsLoadingConfig(true);
      try {
        const loaded = await platformAutoCrawlService.loadConfig();
        if (active) setConfig(loaded);
      } finally {
        if (active) setIsLoadingConfig(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [user?.uid]);

  // Subscribe to global shared leads in real time & repair any legacy non-sequential IDs (e.g. L-XXXXX -> L1, L2...)
  useEffect(() => {
    if (!user) return;
    void platformAutoCrawlService.normalizeLegacySharedLeadIds().catch(() => {});
    const unsub = platformAutoCrawlService.subscribeToSharedLeads((items) => {
      setSharedLeads(items);
    });
    return () => unsub();
  }, [user?.uid]);

  const persistConfig = useCallback(async (next: PlatformAutoCrawlConfig, showToast = false) => {
    setConfig(next);
    configRef.current = next;
    setIsSavingConfig(true);
    try {
      await platformAutoCrawlService.saveConfig(next);
      if (showToast) {
        toast.success("Configurarea Auto Crawl a fost salvată.");
      }
    } catch (err: any) {
      console.warn("[PgPlatformAutoCrawl] Failed saving config:", err);
      if (showToast) {
        toast.error(err?.message || "Nu s-a putut salva configurarea Auto Crawl.");
      }
    } finally {
      setIsSavingConfig(false);
    }
  }, []);

  const runScan = useCallback(
    async (isManual = false) => {
      if (isScanningRef.current || !user) return;
      isScanningRef.current = true;
      setIsScanning(true);
      try {
        const currentCfg = configRef.current;
        const result = await platformAutoCrawlService.runAutoCrawlScan(
          currentCfg,
          sharedLeadsRef.current
        );

        const nextInterval =
          result.addedCount === 0 && (result.warning || result.saveErrors.length > 0 || result.notice?.type === "info")
            ? 0
            : currentCfg.scanIntervalMinutes;

        const nextConfig: PlatformAutoCrawlConfig = {
          ...currentCfg,
          scanIntervalMinutes: nextInterval,
          lastScanAt: Date.now(),
          lastScanNotice: result.notice,
        };
        await persistConfig(nextConfig, false);

        if (result.addedCount > 0) {
          toast.success(
            `${result.addedCount} ${result.addedCount === 1 ? "anunț nou importat" : "anunțuri noi importate"} și distribuite către toate agențiile.`
          );
        } else if (isManual && result.notice) {
          if (result.notice.type === "error") {
            toast.error(result.notice.message);
          } else {
            toast(result.notice.message);
          }
        }
      } catch (err: any) {
        const errMsg = err?.message || "Eroare necunoscută la scanarea anunțurilor de pe OLX.ro";
        const nextConfig: PlatformAutoCrawlConfig = {
          ...configRef.current,
          scanIntervalMinutes: 0,
          lastScanNotice: {
            type: "error",
            title: "Eroare autocrawler OLX.ro",
            message: errMsg,
            timestamp: Date.now(),
          },
        };
        await persistConfig(nextConfig, false);
        if (isManual) toast.error(errMsg);
      } finally {
        isScanningRef.current = false;
        setIsScanning(false);
      }
    },
    [persistConfig, user]
  );

  // Automatic periodic scan timer while Super Admin Auto Crawl is active
  useEffect(() => {
    if (config.scanIntervalMinutes <= 0 || !user) return;
    const intervalMs = config.scanIntervalMinutes * 60 * 1000;
    const timerId = window.setInterval(() => {
      void runScan(false);
    }, intervalMs);
    return () => window.clearInterval(timerId);
  }, [config.scanIntervalMinutes, runScan, user]);

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
    const next: PlatformAutoCrawlConfig = {
      ...config,
      scanIntervalMinutes: minutes,
    };
    void persistConfig(next, false);
    if (minutes > 0) {
      void runScan(true);
    }
  };

  const handleFiltersChange = (nextFilters: OlxLeadFilters) => {
    setConfig((prev) => ({ ...prev, filters: nextFilters }));
  };

  const handleReset = () => {
    const resetCfg: PlatformAutoCrawlConfig = {
      ...DEFAULT_PLATFORM_AUTO_CRAWL_CONFIG,
      filters: { ...DEFAULT_OLX_LEAD_FILTERS, zones: [] },
      minAdAgeHours: DEFAULT_OLX_MIN_AD_AGE_HOURS,
      maxAdAgeHours: DEFAULT_OLX_MAX_AD_AGE_HOURS,
      lastScanAt: config.lastScanAt,
      lastScanNotice: null,
    };
    void persistConfig(resetCfg, true);
  };

  const handleDeleteLead = async (leadId: string) => {
    try {
      await platformAutoCrawlService.deleteSharedLead(leadId);
      toast.success("Lead-ul a fost șters din fluxul global.");
    } catch (err: any) {
      toast.error(err?.message || "Eroare la ștergerea lead-ului.");
    }
  };

  const handleClearAllShared = async () => {
    setIsClearingAll(true);
    try {
      const removed = await platformAutoCrawlService.clearAllSharedLeads();
      setConfirmClearAll(false);
      toast.success(`${removed} lead-uri globale au fost eliminate.`);
    } catch (err: any) {
      toast.error(err?.message || "Nu s-au putut șterge lead-urile globale.");
    } finally {
      setIsClearingAll(false);
    }
  };

  const activeFilterCount = countActiveOlxFilters(config.filters);

  return (
    <CmpPlatformLayout title="Auto Crawl OLX.ro (Global)">
      <div className="space-y-6 pb-8">
        {/* Top Summary Banner */}
        <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-2xs flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#051D35]/5 border border-[#051D35]/15 flex items-center justify-center text-[#051D35] shrink-0">
              <Radar size={20} className={config.scanIntervalMinutes > 0 ? "text-[#BE9662]" : "text-[#051D35]"} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-semibold text-[#051D35]">
                  Auto Crawl Global — Distribuire automată către toate agențiile
                </h2>
                {config.scanIntervalMinutes > 0 ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Activ (la {config.scanIntervalMinutes} min)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-600 bg-gray-100 border border-gray-200 px-2 py-0.5 rounded">
                    Manual / Oprit
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-1 max-w-2xl">
                Toate anunțurile preluate aici sunt salvate o singură dată la nivel de platformă și apar automat, complet și identic în secțiunea <strong className="text-[#051D35]">Lead-uri → Listate</strong> pentru fiecare agenție.
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
              onClick={() => void runScan(true)}
              disabled={isScanning || isLoadingConfig}
              className="h-9 px-4 inline-flex items-center gap-2 text-xs font-semibold text-white bg-[#051D35] hover:bg-[#0a2b4a] rounded-md transition-colors cursor-pointer shadow-2xs disabled:opacity-60"
            >
              {isScanning ? <Loader2 size={14} className="animate-spin text-[#BE9662]" /> : <Play size={14} className="text-[#BE9662]" />}
              <span>{isScanning ? "Se scanează OLX.ro..." : "Scanează acum"}</span>
            </button>
          </div>
        </div>

        {/* Last Scan Notice */}
        {config.lastScanNotice && (
          <div
            role={config.lastScanNotice.type === "error" ? "alert" : "status"}
            className={`flex items-start justify-between gap-3 px-4 py-3 rounded-lg border text-xs ${
              config.lastScanNotice.type === "error"
                ? "bg-red-50 border-red-200 text-red-900"
                : config.lastScanNotice.type === "success"
                  ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                  : "bg-amber-50/80 border-amber-200/90 text-[#051D35]"
            }`}
          >
            <div className="flex items-start gap-2.5 min-w-0">
              {config.lastScanNotice.type === "error" ? (
                <AlertCircle size={16} className="text-red-600 shrink-0 mt-0.5" />
              ) : config.lastScanNotice.type === "success" ? (
                <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <Info size={16} className="text-[#BE9662] shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold">{config.lastScanNotice.title}</span>
                  <span className="text-[10px] opacity-70 tabular-nums">
                    {new Date(config.lastScanNotice.timestamp).toLocaleString("ro-RO")}
                  </span>
                </div>
                <p className="text-[11px] mt-0.5 opacity-90">{config.lastScanNotice.message}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void persistConfig({ ...config, lastScanNotice: null }, false)}
              className="text-[11px] font-medium underline opacity-75 hover:opacity-100 cursor-pointer shrink-0"
            >
              Ascunde
            </button>
          </div>
        )}

        {/* Two-column layout: Schedule & Filters (left) + Imported Global Leads Feed (right) */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Left column: Schedule + OLX Filters */}
          <div className="xl:col-span-5 space-y-5">
            {/* Schedule & Age Card */}
            <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-2xs space-y-4">
              <div className="flex items-center justify-between gap-2 pb-3 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <Timer size={16} className="text-[#BE9662]" />
                  <h3 className="text-xs font-semibold text-[#051D35]">
                    Programare & Limită Scanare
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
                    Interval scanare automată
                  </label>
                  <select
                    value={config.scanIntervalMinutes}
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
                    value={config.scanLimit}
                    onChange={(e) =>
                      setConfig((prev) => ({ ...prev, scanLimit: Number(e.target.value) }))
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
                    id="platform-olx-ad-age-min-slider"
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
                    id="platform-olx-ad-age-max-slider"
                    type="range"
                    aria-label="Vechime maximă anunț"
                    min={0}
                    max={lastIdx}
                    step={1}
                    value={maxStepIndex}
                    onChange={(e) => handleMaxIdxChange(Number(e.target.value))}
                    className="absolute inset-0 w-full h-6 appearance-none bg-transparent pointer-events-none z-20 [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[#051D35] [&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:hover:scale-110 [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[#051D35] [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[#BE9662] [&::-moz-range-thumb]:shadow-sm [&::-moz-range-thumb]:cursor-grab"
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

              {config.lastScanAt && (
                <div className="pt-2 border-t border-gray-100 text-[11px] text-gray-500 flex items-center justify-between">
                  <span>Ultima scanare executată:</span>
                  <span className="font-medium text-gray-700 tabular-nums">
                    {new Date(config.lastScanAt).toLocaleString("ro-RO")}
                  </span>
                </div>
              )}
            </div>

            {/* OLX Filters Card */}
            <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-2xs space-y-4">
              <div className="flex items-center justify-between gap-2 pb-3 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <Globe size={16} className="text-[#051D35]" />
                  <h3 className="text-xs font-semibold text-[#051D35]">
                    Filtre de Extragere OLX.ro
                  </h3>
                </div>
                {activeFilterCount > 0 && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-[#051D35]/10 text-[#051D35] tabular-nums">
                    {activeFilterCount} active
                  </span>
                )}
              </div>

              <OlxLeadFilterForm filters={config.filters} onChange={handleFiltersChange} />
            </div>
          </div>

          {/* Right column: Shared Leads Feed visible to all agencies */}
          <div className="xl:col-span-7 bg-white border border-gray-200 rounded-lg shadow-2xs overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h3 className="text-xs font-semibold text-[#051D35] flex items-center gap-2">
                  <span>Lead-uri Globale Importate</span>
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-[#051D35] text-white tabular-nums">
                    {sharedLeads.length}
                  </span>
                </h3>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Toate agențiile primesc automat exact aceste înregistrări în secțiunea Lead-uri.
                </p>
              </div>

              {sharedLeads.length > 0 && (
                <div className="flex items-center gap-2">
                  {confirmClearAll ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setConfirmClearAll(false)}
                        disabled={isClearingAll}
                        className="h-7 px-2.5 text-[11px] font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md cursor-pointer"
                      >
                        Anulează
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleClearAllShared()}
                        disabled={isClearingAll}
                        className="h-7 px-3 inline-flex items-center gap-1 text-[11px] font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md cursor-pointer disabled:opacity-60"
                      >
                        {isClearingAll ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        <span>Confirmă ștergerea tuturor</span>
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmClearAll(true)}
                      className="h-7 px-2.5 inline-flex items-center gap-1.5 text-[11px] font-medium text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-md transition-colors cursor-pointer"
                    >
                      <Trash2 size={12} />
                      <span>Golește lista</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {sharedLeads.length === 0 ? (
              <div className="p-10 text-center flex flex-col items-center justify-center">
                <div className="w-12 h-12 rounded-full bg-gray-50 border border-gray-200 flex items-center justify-center text-gray-400 mb-3">
                  <Radar size={22} />
                </div>
                <p className="text-xs font-semibold text-gray-700">
                  Nu există încă lead-uri importate prin Auto Crawl
                </p>
                <p className="text-[11px] text-gray-500 mt-1 max-w-sm">
                  Configurează filtrele din stânga și apasă <strong>Scanează acum</strong> sau activează un interval automat. Anunțurile vor apărea imediat în secțiunea Lead-uri a fiecărei agenții.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100 max-h-[820px] overflow-y-auto">
                {sharedLeads.map((lead) => {
                  const thumb = lead.coverImage || (Array.isArray(lead.images) ? lead.images[0] : undefined);
                  const createdDate =
                    lead.createdAt && typeof lead.createdAt?.toDate === "function"
                      ? lead.createdAt.toDate()
                      : lead.createdAt
                        ? new Date(lead.createdAt)
                        : null;

                  return (
                    <div
                      key={lead.id}
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
                            <div className="flex items-center gap-2 flex-wrap">
                              {lead.propertyId && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#051D35]/10 text-[#051D35] tabular-nums">
                                  {lead.propertyId}
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

                        <div className="flex items-center gap-3 flex-wrap mt-2 text-[11px] text-gray-500">
                          <span className="inline-flex items-center gap-1">
                            <MapPin size={11} className="text-[#BE9662]" />
                            <span className="truncate max-w-[160px]">{resolveLeadDisplayArea(lead)}</span>
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <User size={11} className="text-[#BE9662]" />
                            <span className="truncate max-w-[140px]">{lead.ownerName || "Proprietar"}</span>
                          </span>
                          <span className="inline-flex items-center gap-1 tabular-nums">
                            <Phone size={11} className="text-[#BE9662]" />
                            <span>{lead.ownerPhone || "Nespecificat"}</span>
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {lead.url && (
                          <a
                            href={lead.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Deschide anunțul original OLX.ro"
                            className="p-1.5 text-gray-400 hover:text-[#051D35] hover:bg-gray-100 rounded-md transition-colors"
                          >
                            <ExternalLink size={14} />
                          </a>
                        )}
                        {lead.id && (
                          <button
                            type="button"
                            onClick={() => void handleDeleteLead(lead.id!)}
                            title="Șterge din lista globală"
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors cursor-pointer"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </CmpPlatformLayout>
  );
};
