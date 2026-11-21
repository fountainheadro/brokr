import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  Search,
  X,
  Clock,
  Inbox,
  ClipboardList,
  Building2,
  CornerDownLeft,
} from "lucide-react";
import {
  OlxLeadFilters,
  PropertyFilterPageContext,
  LEAD_ROLE_FILTER_OPTIONS,
  OLX_CATEGORY_OPTIONS,
  OLX_ROOM_OPTIONS,
  OLX_COMPARTIMENTARE_OPTIONS,
  OLX_CONSTRUCTIE_OPTIONS,
  OLX_FLOOR_OPTIONS,
  normalizeRoText,
} from "../utils/olxFilterUtils";
import { ZONA_OPTIONS } from "../constants";
import type { Lead } from "../services/leadsService";
import {
  getRecentSearches,
  saveRecentSearch,
  saveRecentFreeTextSearch,
  removeRecentSearch,
  clearRecentSearches,
  type RecentSearchEntry,
  type RecentSearchScope,
  type RecentSearchEntityType,
} from "../utils/recentSearchUtils";

interface OlxLeadFilterFormProps {
  filters: OlxLeadFilters;
  onChange: (next: OlxLeadFilters) => void;
  pageContext?: PropertyFilterPageContext;
  searchableItems?: Lead[];
  onSelectSearchItem?: (item: Lead) => void;
}

const LOCAL_STATUS_LABELS: Record<string, string> = {
  ListaMea: "Noi",
  Noi: "Noi",
  Pierdute: "Pierdute",
  Noua: "Nouă",
  Activa: "Active",
  AreInteres: "Nouă",
};

function getPagePlaceholder(pageContext: PropertyFilterPageContext): string {
  if (pageContext === "Lead-uri") return "Caută lead-uri (titlu, telefon, zonă, ID, preț)...";
  if (pageContext === "Cereri") return "Caută cereri (client, zonă, ID, buget)...";
  if (pageContext === "Proprietati") return "Caută proprietăți (titlu, zonă, ID, preț)...";
  return "ex: metrou, Titan, mobilat...";
}

function getPageEntityMeta(pageContext: PropertyFilterPageContext): {
  kind: RecentSearchEntityType;
  sectionLabel: string;
  emptyTitle: string;
  accentBg: string;
  accentText: string;
  accentBorder: string;
  badgeBg: string;
} {
  if (pageContext === "Cereri") {
    return {
      kind: "cerere",
      sectionLabel: "Cereri",
      emptyTitle: "Cerere fără titlu",
      accentBg: "bg-amber-100/60",
      accentText: "text-amber-700",
      accentBorder: "border-amber-200",
      badgeBg: "bg-amber-50/70",
    };
  }
  if (pageContext === "Proprietati") {
    return {
      kind: "property",
      sectionLabel: "Proprietăți",
      emptyTitle: "Proprietate fără titlu",
      accentBg: "bg-[#BE9662]/10",
      accentText: "text-[#BE9662]",
      accentBorder: "border-[#BE9662]/25",
      badgeBg: "bg-gray-50",
    };
  }
  return {
    kind: "lead",
    sectionLabel: "Lead-uri",
    emptyTitle: "Lead fără titlu",
    accentBg: "bg-emerald-100/60",
    accentText: "text-emerald-700",
    accentBorder: "border-emerald-200",
    badgeBg: "bg-emerald-50/60",
  };
}

const MultiSelectChips: React.FC<{
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
}> = ({ label, options, selected, onToggle }) => (
  <div className="space-y-1.5">
    <div className="flex items-center justify-between gap-2">
      <span className="text-[12px] font-semibold text-[#051D35]">{label}</span>
      {selected.length > 0 && (
        <span className="text-[11px] font-normal text-[#BE9662] tabular-nums">
          {selected.length} selectate
        </span>
      )}
    </div>
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const isSelected = selected.includes(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onToggle(opt.value)}
            className={`h-7 px-2.5 text-[12px] font-normal rounded-md border transition-colors cursor-pointer ${
              isSelected
                ? "bg-[#051D35] text-white border-[#051D35] font-medium"
                : "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100 hover:border-gray-300"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  </div>
);

export const OlxLeadFilterForm: React.FC<OlxLeadFilterFormProps> = ({
  filters,
  onChange,
  pageContext = "autoScan",
  searchableItems = [],
  onSelectSearchItem,
}) => {
  const [currentZoneInput, setCurrentZoneInput] = useState("");
  const [showZoneDropdown, setShowZoneDropdown] = useState(false);
  const zoneContainerRef = useRef<HTMLDivElement>(null);
  const zoneDropdownRef = useRef<HTMLDivElement>(null);

  const isLocalSuggestEnabled =
    pageContext === "Lead-uri" ||
    pageContext === "Cereri" ||
    pageContext === "Proprietati";
  const recentScope: RecentSearchScope | null = isLocalSuggestEnabled ? pageContext : null;

  const [isSearchDropdownOpen, setIsSearchDropdownOpen] = useState(false);
  const [recentSearches, setRecentSearches] = useState<RecentSearchEntry[]>(() =>
    recentScope ? getRecentSearches(recentScope) : []
  );
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Refresh recent searches whenever scope changes
  useEffect(() => {
    if (recentScope) {
      setRecentSearches(getRecentSearches(recentScope));
    } else {
      setRecentSearches([]);
    }
  }, [recentScope]);

  const selectedZones = Array.isArray(filters.zones) ? filters.zones : [];

  const filteredZones = ZONA_OPTIONS.filter(
    (z) =>
      normalizeRoText(z).includes(normalizeRoText(currentZoneInput)) &&
      !selectedZones.includes(z)
  ).slice(0, 8);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (zoneContainerRef.current && !zoneContainerRef.current.contains(target)) {
        setShowZoneDropdown(false);
      }
      if (searchContainerRef.current && !searchContainerRef.current.contains(target)) {
        setIsSearchDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (showZoneDropdown && currentZoneInput.trim().length > 0 && filteredZones.length > 0) {
      zoneDropdownRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [showZoneDropdown, currentZoneInput, filteredZones.length]);

  const entityMeta = useMemo(() => getPageEntityMeta(pageContext), [pageContext]);

  const normalizedQuery = normalizeRoText(filters.searchText);

  const matchingRecentSearches = useMemo(() => {
    if (!isLocalSuggestEnabled) return [];
    if (!normalizedQuery) return recentSearches;
    return recentSearches.filter((entry) => {
      const hay = normalizeRoText(`${entry.label} ${entry.subtitle || ""} ${entry.badge || ""}`);
      return hay.includes(normalizedQuery);
    });
  }, [isLocalSuggestEnabled, recentSearches, normalizedQuery]);

  const suggestedItems = useMemo(() => {
    if (!isLocalSuggestEnabled || !normalizedQuery) return [];
    const tokens = normalizedQuery.split(" ").filter(Boolean);
    return searchableItems
      .filter((item) => {
        const hay = normalizeRoText(
          [
            item.title,
            item.zone,
            item.price,
            item.ownerName,
            item.ownerPhone,
            item.propertyId,
            item.id,
            item.categoria,
            item.notes,
          ]
            .filter(Boolean)
            .join(" ")
        );
        return tokens.every((t) => hay.includes(t));
      })
      .slice(0, 6);
  }, [isLocalSuggestEnabled, normalizedQuery, searchableItems]);

  const commitFreeTextSearch = (rawText: string) => {
    const trimmed = rawText.trim();
    if (recentScope && trimmed.length >= 2) {
      setRecentSearches(saveRecentFreeTextSearch(recentScope, trimmed));
    }
  };

  const handleSelectSuggestedItem = (item: Lead) => {
    if (recentScope) {
      const displayTitle = item.title?.trim() || entityMeta.emptyTitle;
      const subtitleParts =
        pageContext === "Cereri"
          ? [item.ownerName ? `Client: ${item.ownerName}` : "", item.price ? `Buget: ${item.price}` : ""]
          : [item.zone || "Zonă nespecificată", item.price || ""];
      setRecentSearches(
        saveRecentSearch(recentScope, {
          id: `${entityMeta.kind}:${item.id || item.propertyId || displayTitle}`,
          kind: entityMeta.kind,
          label: displayTitle,
          subtitle: subtitleParts.filter(Boolean).join(" • "),
          entityId: item.id,
          badge: item.propertyId ? `#${item.propertyId}` : undefined,
          queryText: displayTitle,
        })
      );
    }
    setIsSearchDropdownOpen(false);
    onSelectSearchItem?.(item);
  };

  const handleSelectRecentEntry = (entry: RecentSearchEntry) => {
    if (entry.kind === "text") {
      const nextText = entry.queryText || entry.label;
      onChange({ ...filters, searchText: nextText });
      if (recentScope) {
        setRecentSearches(saveRecentFreeTextSearch(recentScope, nextText));
      }
      setIsSearchDropdownOpen(false);
      return;
    }

    if (entry.entityId && onSelectSearchItem) {
      const found = searchableItems.find((item) => item.id === entry.entityId);
      if (found) {
        handleSelectSuggestedItem(found);
        return;
      }
    }

    // Fallback to filtering by label if item is no longer in list
    const fallbackText = entry.queryText || entry.label;
    onChange({ ...filters, searchText: fallbackText });
    setIsSearchDropdownOpen(false);
  };

  const handleRemoveRecent = (e: React.MouseEvent, entryId: string) => {
    e.stopPropagation();
    if (!recentScope) return;
    setRecentSearches(removeRecentSearch(recentScope, entryId));
  };

  const handleClearRecent = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!recentScope) return;
    setRecentSearches(clearRecentSearches(recentScope));
  };

  const renderEntityIcon = (size = 13) => {
    if (pageContext === "Cereri") return <ClipboardList size={size} />;
    if (pageContext === "Proprietati") return <Building2 size={size} />;
    return <Inbox size={size} />;
  };

  const showSearchDropdown =
    isLocalSuggestEnabled &&
    isSearchDropdownOpen &&
    (filters.searchText.trim().length > 0 || recentSearches.length > 0);

  const handleSelectZone = (selectedZone: string) => {
    if (!selectedZones.includes(selectedZone)) {
      onChange({ ...filters, zones: [...selectedZones, selectedZone] });
    }
    setCurrentZoneInput("");
    setShowZoneDropdown(false);
  };

  const handleRemoveZone = (zoneToRemove: string) => {
    onChange({
      ...filters,
      zones: selectedZones.filter((z) => z !== zoneToRemove),
    });
  };

  const toggleMulti = (
    key: "categories" | "rooms" | "compartimentare" | "constructie" | "floors",
    val: string
  ) => {
    const current = filters[key];
    const next = current.includes(val)
      ? current.filter((v) => v !== val)
      : [...current, val];
    onChange({ ...filters, [key]: next });
  };

  const transactionOptions =
    pageContext === "Cereri"
      ? ([
          { value: "", label: "Toate" },
          { value: "Cumpărare", label: "Cumpărare" },
          { value: "Închiriere", label: "Închiriere" },
        ] as const)
      : ([
          { value: "", label: "Toate" },
          { value: "Vânzare", label: "Vânzare" },
          { value: "Închiriere", label: "Închiriere" },
        ] as const);

  return (
    <div className="space-y-4">
      {/* Text de căutat (with page-scoped auto-suggest + recent searches) */}
      <div ref={searchContainerRef} className="space-y-1.5 relative">
        <label className="block text-[12px] font-semibold text-[#051D35]">
          Text de căutat
        </label>
        <div className="relative">
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
          />
          <input
            ref={searchInputRef}
            type="text"
            value={filters.searchText}
            onChange={(e) => {
              onChange({ ...filters, searchText: e.target.value });
              if (isLocalSuggestEnabled) {
                setIsSearchDropdownOpen(true);
              }
            }}
            onFocus={() => {
              if (isLocalSuggestEnabled) {
                setRecentSearches(getRecentSearches(pageContext));
                setIsSearchDropdownOpen(true);
              }
            }}
            onBlur={() => {
              if (isLocalSuggestEnabled && filters.searchText.trim().length >= 2) {
                commitFreeTextSearch(filters.searchText);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && isLocalSuggestEnabled) {
                e.preventDefault();
                commitFreeTextSearch(filters.searchText);
                setIsSearchDropdownOpen(false);
              } else if (e.key === "Escape") {
                setIsSearchDropdownOpen(false);
              }
            }}
            placeholder={getPagePlaceholder(pageContext)}
            className="w-full h-8 pl-8 pr-7 text-[12px] font-normal bg-gray-50 border border-gray-200 rounded-md placeholder:text-gray-400 focus:outline-none focus:bg-white focus:border-[#051D35] transition-colors"
          />
          {filters.searchText && (
            <button
              type="button"
              onClick={() => {
                onChange({ ...filters, searchText: "" });
                searchInputRef.current?.focus();
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer"
              title="Șterge căutarea"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Page-Scoped Auto-Suggest & Recent Searches Dropdown */}
        {showSearchDropdown && (
          <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-xl z-50 max-h-[320px] overflow-y-auto divide-y divide-gray-100">
            {/* Căutate recent */}
            {matchingRecentSearches.length > 0 && (
              <div>
                <div className="px-3 py-1.5 bg-gray-50/90 text-[10px] font-semibold uppercase tracking-wider text-gray-500 border-b border-gray-100 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Clock size={11} className="text-gray-400" />
                    Căutate recent
                  </span>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={handleClearRecent}
                    className="text-[10px] font-medium normal-case tracking-normal text-gray-400 hover:text-gray-700 cursor-pointer"
                  >
                    Șterge
                  </button>
                </div>
                <div className="divide-y divide-gray-50">
                  {matchingRecentSearches.map((entry) => (
                    <div
                      key={entry.id}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleSelectRecentEntry(entry)}
                      className="px-3 py-2 flex items-center justify-between gap-2 hover:bg-gray-50 transition-colors cursor-pointer group"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Clock size={12} className="text-gray-400 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-gray-800 truncate flex items-center gap-1.5">
                            <span className="truncate">{entry.label}</span>
                            {entry.badge && (
                              <span className="text-[10px] font-normal px-1 py-0 rounded bg-gray-100 text-gray-600 border border-gray-200 tabular-nums shrink-0">
                                {entry.badge}
                              </span>
                            )}
                          </div>
                          {entry.subtitle && (
                            <div className="text-[10px] text-gray-400 truncate mt-0.5">
                              {entry.subtitle}
                            </div>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => handleRemoveRecent(e, entry.id)}
                        className="p-1 text-gray-300 hover:text-gray-600 rounded opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shrink-0"
                        title="Elimină din căutări recente"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Page-scoped suggestions when typing */}
            {filters.searchText.trim().length > 0 && (
              <div>
                <div className={`px-3 py-1.5 ${entityMeta.badgeBg} text-[10px] font-semibold uppercase tracking-wider text-gray-600 border-b border-gray-100 flex items-center justify-between`}>
                  <span className="flex items-center gap-1.5">
                    <span className={entityMeta.accentText}>{renderEntityIcon(11)}</span>
                    {entityMeta.sectionLabel} ({suggestedItems.length})
                  </span>
                </div>

                {suggestedItems.length === 0 ? (
                  <div className="px-3 py-3 text-[11px] text-gray-500 text-center">
                    Niciun rezultat direct. Textul filtrat rămâne activ pe listă.
                  </div>
                ) : (
                  <div className="divide-y divide-gray-50">
                    {suggestedItems.map((item) => {
                      const statusDisplay = LOCAL_STATUS_LABELS[item.status] || item.status;
                      return (
                        <div
                          key={item.id || item.propertyId || item.title}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => handleSelectSuggestedItem(item)}
                          className="px-3 py-2 flex items-center justify-between gap-2 hover:bg-gray-50/90 transition-colors cursor-pointer text-left select-none"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div
                              className={`w-6 h-6 rounded-md ${entityMeta.accentBg} border ${entityMeta.accentBorder} ${entityMeta.accentText} flex items-center justify-center shrink-0`}
                            >
                              {renderEntityIcon(12)}
                            </div>
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-gray-900 truncate flex items-center gap-1.5">
                                <span className="truncate">
                                  {item.title || entityMeta.emptyTitle}
                                </span>
                                {item.propertyId && (
                                  <span className="text-[10px] font-normal tabular-nums px-1 py-0 rounded bg-gray-100 text-gray-700 border border-gray-200 shrink-0">
                                    #{item.propertyId}
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-gray-500 truncate flex items-center gap-1.5 mt-0.5">
                                <span>
                                  {pageContext === "Cereri"
                                    ? item.ownerName || "Client nespecificat"
                                    : item.zone || "Zonă nespecificată"}
                                </span>
                                {item.price && (
                                  <>
                                    <span>•</span>
                                    <span className="tabular-nums text-gray-700">{item.price}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                          <span className="text-[10px] font-normal px-1.5 py-0.5 rounded border border-gray-200 bg-gray-50 text-gray-600 shrink-0">
                            {statusDisplay}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Free text search commit action */}
                <div
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    commitFreeTextSearch(filters.searchText);
                    setIsSearchDropdownOpen(false);
                  }}
                  className="px-3 py-2 bg-gray-50/70 hover:bg-gray-100/80 transition-colors cursor-pointer flex items-center justify-between gap-2 text-[11px] text-[#051D35]"
                >
                  <span className="flex items-center gap-1.5 truncate">
                    <Search size={11} className="text-[#BE9662] shrink-0" />
                    <span className="truncate">
                      Caută text liber:{" "}
                      <strong className="font-semibold">„{filters.searchText.trim()}”</strong>
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1 text-[10px] text-gray-400 shrink-0">
                    <CornerDownLeft size={10} />
                    Enter
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tip Lead (exclusiv pentru secțiunea Lead-uri) */}
      {pageContext === "Lead-uri" && (
        <div className="space-y-1.5">
          <span className="block text-[12px] font-semibold text-[#051D35]">
            Tip lead
          </span>
          <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-md h-8">
            {LEAD_ROLE_FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                type="button"
                onClick={() => onChange({ ...filters, leadRole: opt.value })}
                className={`flex-1 h-6 text-[11px] rounded transition-all cursor-pointer truncate px-1 ${
                  (filters.leadRole || "") === opt.value
                    ? "bg-[#051D35] text-white font-semibold shadow-xs"
                    : "text-gray-600 hover:text-[#051D35] hover:bg-white/70 font-normal"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tip tranzacție */}
      <div className="space-y-1.5">
        <span className="block text-[12px] font-semibold text-[#051D35]">
          Tip tranzacție
        </span>
        <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-md h-8">
          {transactionOptions.map((opt) => (
            <button
              key={opt.label}
              type="button"
              onClick={() => onChange({ ...filters, transactionType: opt.value })}
              className={`flex-1 h-6 text-[12px] rounded transition-all cursor-pointer ${
                filters.transactionType === opt.value
                  ? "bg-[#051D35] text-white font-semibold shadow-xs"
                  : "text-gray-600 hover:text-[#051D35] hover:bg-white/70 font-normal"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Preț & Suprafață */}
      <div className="grid grid-cols-1 gap-3">
        <div className="space-y-1.5">
          <span className="block text-[12px] font-semibold text-[#051D35]">
            Preț (€)
          </span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              value={filters.priceMin}
              onChange={(e) => onChange({ ...filters, priceMin: e.target.value })}
              placeholder="Preț minim"
              className="w-1/2 h-8 px-2.5 text-[12px] font-normal bg-gray-50 border border-gray-200 rounded-md placeholder:text-gray-400 focus:outline-none focus:bg-white focus:border-[#051D35] transition-colors"
            />
            <input
              type="number"
              min="0"
              value={filters.priceMax}
              onChange={(e) => onChange({ ...filters, priceMax: e.target.value })}
              placeholder="Preț maxim"
              className="w-1/2 h-8 px-2.5 text-[12px] font-normal bg-gray-50 border border-gray-200 rounded-md placeholder:text-gray-400 focus:outline-none focus:bg-white focus:border-[#051D35] transition-colors"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <span className="block text-[12px] font-semibold text-[#051D35]">
            Suprafață utilă (mp)
          </span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              value={filters.surfaceMin}
              onChange={(e) => onChange({ ...filters, surfaceMin: e.target.value })}
              placeholder="Supr. minimă"
              className="w-1/2 h-8 px-2.5 text-[12px] font-normal bg-gray-50 border border-gray-200 rounded-md placeholder:text-gray-400 focus:outline-none focus:bg-white focus:border-[#051D35] transition-colors"
            />
            <input
              type="number"
              min="0"
              value={filters.surfaceMax}
              onChange={(e) => onChange({ ...filters, surfaceMax: e.target.value })}
              placeholder="Supr. maximă"
              className="w-1/2 h-8 px-2.5 text-[12px] font-normal bg-gray-50 border border-gray-200 rounded-md placeholder:text-gray-400 focus:outline-none focus:bg-white focus:border-[#051D35] transition-colors"
            />
          </div>
        </div>
      </div>

      <MultiSelectChips
        label="Categoria imobilului"
        options={OLX_CATEGORY_OPTIONS}
        selected={filters.categories}
        onToggle={(v) => toggleMulti("categories", v)}
      />

      <MultiSelectChips
        label="Subcategoria (camere)"
        options={OLX_ROOM_OPTIONS}
        selected={filters.rooms}
        onToggle={(v) => toggleMulti("rooms", v)}
      />

      <MultiSelectChips
        label="Compartimentare"
        options={OLX_COMPARTIMENTARE_OPTIONS}
        selected={filters.compartimentare}
        onToggle={(v) => toggleMulti("compartimentare", v)}
      />

      <MultiSelectChips
        label="An construcție"
        options={OLX_CONSTRUCTIE_OPTIONS}
        selected={filters.constructie}
        onToggle={(v) => toggleMulti("constructie", v)}
      />

      <MultiSelectChips
        label="Etaj"
        options={OLX_FLOOR_OPTIONS}
        selected={filters.floors}
        onToggle={(v) => toggleMulti("floors", v)}
      />

      {/* Zone - Auto-suggest multi selector */}
      <div ref={zoneContainerRef} className="relative space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label className="block text-[12px] font-semibold text-[#051D35]">
            Zone (Selectează din listă)
          </label>
          {selectedZones.length > 0 && (
            <span className="text-[11px] font-normal text-[#BE9662] tabular-nums">
              {selectedZones.length} selectate
            </span>
          )}
        </div>
        <div className="min-h-[32px] h-auto border border-gray-200 rounded-md p-1 bg-white focus-within:border-[#BE9662] focus-within:ring-1 focus-within:ring-[#BE9662] flex flex-wrap gap-1 items-center">
          {selectedZones.map((z) => (
            <span
              key={z}
              className="inline-flex items-center gap-1 bg-gray-100 text-gray-800 px-2 py-1 rounded text-[11px] font-normal border border-gray-200"
            >
              {z}
              <button
                type="button"
                onClick={() => handleRemoveZone(z)}
                className="text-gray-500 hover:text-red-600 cursor-pointer"
              >
                <X size={12} />
              </button>
            </span>
          ))}
          <div className="relative flex-1 min-w-[140px] flex items-center">
            <input
              type="text"
              value={currentZoneInput}
              onChange={(e) => {
                setCurrentZoneInput(e.target.value);
                setShowZoneDropdown(true);
              }}
              onFocus={() => setShowZoneDropdown(true)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setShowZoneDropdown(false);
                }
              }}
              placeholder="Caută zonă..."
              className="w-full h-6 px-2 text-xs font-normal border-0 focus:outline-none focus:ring-0 bg-transparent"
            />
          </div>
        </div>

        {/* Autocomplete Dropdown */}
        {showZoneDropdown && currentZoneInput.trim().length > 0 && filteredZones.length > 0 && (
          <div
            ref={zoneDropdownRef}
            className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-50 max-h-40 overflow-y-auto divide-y divide-gray-50"
          >
            {filteredZones.map((z) => (
              <div
                key={z}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelectZone(z)}
                className="px-3 py-2 text-xs font-normal text-gray-800 hover:bg-gray-100 cursor-pointer"
              >
                {z}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
