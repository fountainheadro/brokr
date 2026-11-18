import React, { useState, useRef, useEffect } from "react";
import { Search, X } from "lucide-react";
import {
  OlxLeadFilters,
  OLX_CATEGORY_OPTIONS,
  OLX_ROOM_OPTIONS,
  OLX_COMPARTIMENTARE_OPTIONS,
  OLX_CONSTRUCTIE_OPTIONS,
  OLX_FLOOR_OPTIONS,
  normalizeRoText,
} from "../utils/olxFilterUtils";
import { ZONA_OPTIONS } from "../constants";

interface OlxLeadFilterFormProps {
  filters: OlxLeadFilters;
  onChange: (next: OlxLeadFilters) => void;
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
}) => {
  const [currentZoneInput, setCurrentZoneInput] = useState("");
  const [showZoneDropdown, setShowZoneDropdown] = useState(false);
  const zoneContainerRef = useRef<HTMLDivElement>(null);
  const zoneDropdownRef = useRef<HTMLDivElement>(null);

  const selectedZones = Array.isArray(filters.zones) ? filters.zones : [];

  const filteredZones = ZONA_OPTIONS.filter(
    (z) =>
      normalizeRoText(z).includes(normalizeRoText(currentZoneInput)) &&
      !selectedZones.includes(z)
  ).slice(0, 8);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        zoneContainerRef.current &&
        !zoneContainerRef.current.contains(event.target as Node)
      ) {
        setShowZoneDropdown(false);
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

  return (
    <div className="space-y-4">
      {/* Text de căutat */}
      <div className="space-y-1.5">
        <label className="block text-[12px] font-semibold text-[#051D35]">
          Text de căutat
        </label>
        <div className="relative">
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
          />
          <input
            type="text"
            value={filters.searchText}
            onChange={(e) => onChange({ ...filters, searchText: e.target.value })}
            placeholder="ex: metrou, Titan, mobilat..."
            className="w-full h-8 pl-8 pr-7 text-[12px] font-normal bg-gray-50 border border-gray-200 rounded-md placeholder:text-gray-400 focus:outline-none focus:bg-white focus:border-[#051D35] transition-colors"
          />
          {filters.searchText && (
            <button
              type="button"
              onClick={() => onChange({ ...filters, searchText: "" })}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Tip tranzacție */}
      <div className="space-y-1.5">
        <span className="block text-[12px] font-semibold text-[#051D35]">
          Tip tranzacție
        </span>
        <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-md h-8">
          {(
            [
              { value: "", label: "Toate" },
              { value: "Vânzare", label: "Vânzare" },
              { value: "Închiriere", label: "Închiriere" },
            ] as const
          ).map((opt) => (
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
