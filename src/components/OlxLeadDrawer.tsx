import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, RotateCcw, SlidersHorizontal, Timer, Clock } from "lucide-react";
import {
  OlxLeadFilters,
  PropertyFilterPageContext,
  countActiveOlxFilters,
} from "../utils/olxFilterUtils";
import { OlxLeadFilterForm } from "./OlxLeadFilterPanel";
import type { Lead } from "../services/leadsService";

export type OlxLeadDrawerMode = "filter" | "autoScan";

export const OLX_SCAN_INTERVAL_OPTIONS = [
  { value: 0, label: "Oprit (Manual)" },
  { value: 1, label: "La fiecare 1 minut" },
  { value: 5, label: "La fiecare 5 minute" },
  { value: 15, label: "La fiecare 15 minute" },
  { value: 30, label: "La fiecare 30 minute" },
  { value: 60, label: "La fiecare 60 minute" },
] as const;

export const OLX_SCAN_COUNT_OPTIONS = [3, 6, 9, 12, 24, 48] as const;

export const OLX_MAX_AGE_STEPS = [
  { hours: 0, label: "0 ore", shortLabel: "0h" },
  { hours: 3, label: "3 ore", shortLabel: "3h" },
  { hours: 6, label: "6 ore", shortLabel: "6h" },
  { hours: 12, label: "12 ore", shortLabel: "12h" },
  { hours: 24, label: "1 zi", shortLabel: "1z" },
  { hours: 48, label: "2 zile", shortLabel: "2z" },
  { hours: 72, label: "3 zile", shortLabel: "3z" },
  { hours: 168, label: "7 zile", shortLabel: "7z" },
  { hours: 336, label: "14 zile", shortLabel: "14z" },
  { hours: 720, label: "1 lună", shortLabel: "1L" },
  { hours: 1440, label: "2 luni", shortLabel: "2L" },
  { hours: 2160, label: "3 luni", shortLabel: "3L" },
  { hours: 4320, label: "6 luni", shortLabel: "6L" },
  { hours: 8760, label: "1 an (365 zile)", shortLabel: "1A" },
] as const;

export const DEFAULT_OLX_MIN_AD_AGE_HOURS = 0;
export const DEFAULT_OLX_MAX_AD_AGE_HOURS = 8760;

interface OlxLeadDrawerProps {
  isOpen: boolean;
  mode: OlxLeadDrawerMode;
  pageContext?: PropertyFilterPageContext;
  onClose: () => void;
  filters: OlxLeadFilters;
  onChange: (next: OlxLeadFilters) => void;
  onReset: () => void;
  scanIntervalMinutes?: number;
  onScanIntervalChange?: (minutes: number) => void;
  scanLimit?: number;
  onScanLimitChange?: (limit: number) => void;
  minAdAgeHours?: number;
  onMinAdAgeChange?: (hours: number) => void;
  maxAdAgeHours?: number;
  onMaxAdAgeChange?: (hours: number) => void;
  lastScanAt?: number | null;
  searchableItems?: Lead[];
  onSelectSearchItem?: (item: Lead) => void;
}

export const OlxLeadDrawer: React.FC<OlxLeadDrawerProps> = ({
  isOpen,
  mode,
  pageContext,
  onClose,
  filters,
  onChange,
  onReset,
  scanIntervalMinutes = 0,
  onScanIntervalChange,
  scanLimit = 3,
  onScanLimitChange,
  minAdAgeHours = DEFAULT_OLX_MIN_AD_AGE_HOURS,
  onMinAdAgeChange,
  maxAdAgeHours = DEFAULT_OLX_MAX_AD_AGE_HOURS,
  onMaxAdAgeChange,
  lastScanAt = null,
  searchableItems,
  onSelectSearchItem,
}) => {
  const activeCount = countActiveOlxFilters(filters);
  const isAutoScan = mode === "autoScan";
  const resolvedContext: PropertyFilterPageContext =
    pageContext || (isAutoScan ? "autoScan" : "Lead-uri");
  const drawerTitle = isAutoScan
    ? "Scanare Automată OLX.ro"
    : resolvedContext === "Cereri"
      ? "Filtrare Cereri"
      : resolvedContext === "Proprietati"
        ? "Filtrare Proprietăți"
        : "Filtrare Lead-uri";

  const lastIdx = OLX_MAX_AGE_STEPS.length - 1;
  const rawMinIdx = OLX_MAX_AGE_STEPS.findIndex((s) => s.hours === minAdAgeHours);
  const rawMaxIdx = OLX_MAX_AGE_STEPS.findIndex((s) => s.hours === maxAdAgeHours);

  // Enforce strict invariant: 0 <= minStepIndex < maxStepIndex <= lastIdx (always at least 1 item apart)
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
      onMinAdAgeChange?.(step.hours);
    }
  };

  const handleMaxIdxChange = (nextIdx: number) => {
    const clamped = Math.min(lastIdx, Math.max(minStepIndex + 1, nextIdx));
    const step = OLX_MAX_AGE_STEPS[clamped];
    if (step) {
      onMaxAdAgeChange?.(step.hours);
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

  const hasAnythingToReset =
    activeCount > 0 ||
    (isAutoScan &&
      (scanIntervalMinutes > 0 ||
        scanLimit !== 3 ||
        minAgeStep.hours !== DEFAULT_OLX_MIN_AD_AGE_HOURS ||
        maxAgeStep.hours !== DEFAULT_OLX_MAX_AD_AGE_HOURS));

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[300]">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/30 backdrop-blur-xs"
          />

          {/* Right Drawer (matching ProfileDrawer style) */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", ease: "easeInOut", duration: 0.25 }}
            className="fixed inset-y-0 right-0 w-[calc(100vw-48px)] md:w-full md:max-w-[420px] bg-white shadow-2xl z-[301] flex flex-col border-l border-gray-200"
          >
            {/* Header */}
            <div className="h-12 px-5 border-b border-gray-100 flex items-center justify-between shrink-0 bg-white">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-7 h-7 rounded-md bg-[#051D35]/5 border border-[#051D35]/15 flex items-center justify-center text-[#051D35] shrink-0">
                  {isAutoScan ? <Timer size={14} /> : <SlidersHorizontal size={14} />}
                </span>
                <h3 className="text-[13px] font-semibold text-[#051D35] truncate">
                  {drawerTitle}
                </h3>
                {activeCount > 0 && (
                  <span className="text-[11px] font-normal px-2 py-0.5 rounded bg-[#051D35]/10 text-[#051D35] tabular-nums shrink-0">
                    {activeCount}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors cursor-pointer"
                title="Închide meniul"
              >
                <X size={16} />
              </button>
            </div>

            {/* Scrollable Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar">
              {isAutoScan && (
                <div className="p-3.5 rounded-lg border border-gray-200/90 bg-gray-50/70 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Timer size={14} className="text-[#BE9662]" />
                      <span className="text-[12px] font-semibold text-[#051D35]">
                        Timer scanare anunțuri noi
                      </span>
                    </div>
                    {scanIntervalMinutes > 0 && (
                      <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                        Activ ({scanIntervalMinutes} min)
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      value={scanIntervalMinutes}
                      onChange={(e) => onScanIntervalChange?.(Number(e.target.value))}
                      className="flex-1 min-w-0 h-8 px-2.5 text-[12px] font-normal bg-white border border-gray-200 rounded-md text-gray-800 focus:outline-none focus:border-[#051D35] transition-colors cursor-pointer"
                    >
                      {OLX_SCAN_INTERVAL_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>

                    <select
                      value={scanLimit}
                      onChange={(e) => onScanLimitChange?.(Number(e.target.value))}
                      title="Număr anunțuri preluate per interval"
                      aria-label="Număr anunțuri preluate per interval"
                      className="h-8 px-2 text-[12px] font-normal bg-white border border-gray-200 rounded-md text-gray-800 focus:outline-none focus:border-[#051D35] transition-colors cursor-pointer shrink-0 tabular-nums"
                    >
                      {OLX_SCAN_COUNT_OPTIONS.map((count) => (
                        <option key={count} value={count}>
                          {count}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Dual-Knob Ad Age Range Slider */}
                  <div className="pt-2 border-t border-gray-200/70 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[#051D35]">
                        <Clock size={12} className="text-[#BE9662]" />
                        <span>Vechime anunț (de la publicare)</span>
                      </span>
                      <span className="text-[11px] font-semibold text-[#051D35] bg-white border border-gray-200 px-2 py-0.5 rounded tabular-nums shrink-0">
                        {minAgeStep.label} – {maxAgeStep.label}
                      </span>
                    </div>

                    <div className="relative h-6 flex items-center select-none">
                      {/* Base Track */}
                      <div className="w-full h-1.5 bg-gray-200 rounded-full relative overflow-hidden">
                        {/* Selected Range Highlight */}
                        <div
                          className="absolute inset-y-0 bg-[#051D35] rounded-full transition-all duration-75"
                          style={{
                            left: `${minPct}%`,
                            width: `${Math.max(0, maxPct - minPct)}%`,
                          }}
                        />
                      </div>

                      {/* Minimum Age Knob */}
                      <input
                        id="olx-ad-age-min-slider"
                        type="range"
                        aria-label="Vechime minimă anunț"
                        min={0}
                        max={lastIdx}
                        step={1}
                        value={minStepIndex}
                        onChange={(e) => handleMinIdxChange(Number(e.target.value))}
                        className="absolute inset-0 w-full h-6 appearance-none bg-transparent pointer-events-none z-20 [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[#051D35] [&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:hover:border-[#BE9662] [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[#051D35] [&::-moz-range-thumb]:shadow-sm [&::-moz-range-thumb]:cursor-grab"
                      />

                      {/* Maximum Age Knob */}
                      <input
                        id="olx-ad-age-max-slider"
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

                  <p className="text-[11px] font-normal text-gray-500 leading-relaxed">
                    Scanează periodic pagina OLX.ro conform filtrelor și intervalului de vechime selectat, adăugând automat anunțurile noi în <strong className="font-semibold text-[#051D35]">Piața Imobiliară</strong>.
                    {lastScanAt && (
                      <span className="block mt-1 text-[10px] text-gray-400">
                        Ultima scanare: {new Date(lastScanAt).toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </span>
                    )}
                  </p>
                </div>
              )}

              <OlxLeadFilterForm
                filters={filters}
                onChange={onChange}
                pageContext={resolvedContext}
                searchableItems={searchableItems}
                onSelectSearchItem={onSelectSearchItem}
              />
            </div>

            {/* Footer pinned at base */}
            <div className="p-4 border-t border-gray-200 bg-gray-50/80 shrink-0 flex items-center justify-between gap-2">
              {hasAnythingToReset ? (
                <button
                  type="button"
                  onClick={onReset}
                  className="h-8 px-3 flex items-center gap-1.5 text-[12px] font-normal text-gray-600 hover:text-[#051D35] bg-white border border-gray-200 hover:bg-gray-100 rounded-md transition-colors cursor-pointer"
                >
                  <RotateCcw size={12} />
                  <span>Resetează</span>
                </button>
              ) : (
                <span className="text-[11px] text-gray-400">
                  {isAutoScan ? "Selectează filtrele și intervalul" : "Selectează filtrele dorite"}
                </span>
              )}

              <button
                type="button"
                onClick={onClose}
                className="h-8 px-4 text-[12px] font-semibold bg-[#051D35] hover:bg-[#0a2b4a] text-white rounded-md transition-colors cursor-pointer"
              >
                Închide
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
