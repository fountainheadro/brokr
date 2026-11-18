import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Copy } from "lucide-react";
import toast from "react-hot-toast";

export interface InlineDetailFieldProps {
  label: string;
  value: React.ReactNode;
  editValue?: string;
  isEditing: boolean;
  onChange?: (value: string) => void;
  type?: "text" | "tel" | "email";
  placeholder?: string;
  emptyText?: string;
  options?: readonly string[];
  emptyOptionLabel?: string;
  datalistId?: string;
  datalistOptions?: readonly string[];
  multiline?: boolean;
  rows?: number;
  autoHeightMaxRows?: number;
  labelSuffix?: React.ReactNode;
  viewActions?: React.ReactNode;
  copyValue?: string;
  valueClassName?: string;
  className?: string;
}

export const InlineDetailField: React.FC<InlineDetailFieldProps> = ({
  label,
  value,
  editValue,
  isEditing,
  onChange,
  type = "text",
  placeholder,
  emptyText = "-",
  options,
  emptyOptionLabel,
  datalistId,
  datalistOptions,
  multiline = false,
  rows = 3,
  autoHeightMaxRows,
  labelSuffix,
  viewActions,
  copyValue,
  valueClassName = "text-gray-900 font-normal",
  className = "",
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const rawStringVal =
    editValue !== undefined
      ? editValue
      : typeof value === "string" || typeof value === "number"
        ? String(value)
        : "";

  const autoMaxHeightPx = autoHeightMaxRows ? 16 + Math.round(autoHeightMaxRows * 18.6) : undefined;

  useEffect(() => {
    if (!multiline || !isEditing || !autoMaxHeightPx || !textareaRef.current) return;
    const el = textareaRef.current;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, autoMaxHeightPx)}px`;
  }, [multiline, isEditing, rawStringVal, autoMaxHeightPx]);

  // Resolve matching select option cleanly when options are provided
  let resolvedSelectValue = rawStringVal;
  if (options && options.length > 0) {
    if (rawStringVal === "" && emptyOptionLabel !== undefined) {
      resolvedSelectValue = "";
    } else {
      const exact = options.find((opt) => opt.toLowerCase() === rawStringVal.toLowerCase());
      if (exact) {
        resolvedSelectValue = exact;
      } else {
        const partial = options.find(
          (opt) =>
            rawStringVal.toLowerCase().includes(opt.toLowerCase()) ||
            opt
              .toLowerCase()
              .replace(/[ăâ]/g, "a")
              .includes(rawStringVal.toLowerCase().replace(/[ăâ]/g, "a"))
        );
        resolvedSelectValue = partial || (emptyOptionLabel !== undefined ? "" : options[0]);
      }
    }
  }

  const textToCopy =
    copyValue !== undefined
      ? copyValue
      : typeof value === "string" && value.trim() && value.trim() !== "-"
        ? value.trim()
        : "";

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!textToCopy) return;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      toast.success(`Copiat: ${label}`);
    } catch {
      toast.error("Nu s-a putut copia.");
    }
  };

  const activeFocus = isEditing && isFocused;

  const isEmptyDisplay =
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "") ||
    (typeof value === "string" && value.trim() === "-");

  const focusBoxClasses = activeFocus
    ? "!bg-amber-50/35 !border-[#BE9662] ring-2 ring-[#BE9662]/15 text-[#051D35]"
    : "bg-gray-50/90 hover:bg-gray-100/70 border-gray-200 text-gray-900";

  return (
    <div className={`group/field flex flex-col min-w-0 font-sans ${className}`}>
      {/* Classic Label Above */}
      <label
        onClick={() => {
          if (!isEditing) return;
          if (multiline) textareaRef.current?.focus();
          else if (options && options.length > 0) selectRef.current?.focus();
          else inputRef.current?.focus();
        }}
        className={`flex items-center gap-2 text-[12px] leading-4 mb-1 font-semibold text-[#051D35] transition-colors select-none ${
          isEditing ? "cursor-pointer" : ""
        }`}
      >
        <span className="truncate">{label}</span>
        {labelSuffix}
        {activeFocus && (
          <span
            className="w-2 h-2 rounded-full bg-[#BE9662] shrink-0 animate-pulse"
            title="Mod focus activ"
          />
        )}
      </label>

      {/* Reserved Information / Input Area Below (exact matching geometry -> 0px layout shift) */}
      {multiline ? (
        isEditing ? (
          <textarea
            ref={textareaRef}
            rows={autoHeightMaxRows ? 1 : rows}
            value={rawStringVal}
            onChange={(e) => onChange?.(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") (e.target as HTMLElement).blur();
            }}
            placeholder={placeholder}
            style={autoMaxHeightPx ? { maxHeight: `${autoMaxHeightPx}px` } : undefined}
            className={`w-full !px-3 !py-2 ${
              autoHeightMaxRows ? "!min-h-[36px] overflow-y-auto custom-scrollbar resize-none" : "!min-h-[96px] resize-y"
            } rounded-md border text-[12px] leading-[1.55] font-sans font-normal outline-none shadow-none transition-all ${focusBoxClasses} ${valueClassName}`}
          />
        ) : (
          <div
            style={autoMaxHeightPx ? { maxHeight: `${autoMaxHeightPx}px` } : undefined}
            className={`-mx-3 w-[calc(100%+1.5rem)] px-3 py-2 ${
              autoHeightMaxRows ? "min-h-[36px] h-auto overflow-y-auto custom-scrollbar" : "min-h-[96px]"
            } rounded-md border border-transparent bg-transparent text-[12px] leading-[1.55] font-normal whitespace-pre-wrap break-words select-text ${
              isEmptyDisplay ? "text-gray-400 font-normal" : valueClassName
            }`}
          >
            {isEmptyDisplay ? emptyText : value}
          </div>
        )
      ) : isEditing ? (
        options && options.length > 0 ? (
          <div className="relative w-full h-9">
            <select
              ref={selectRef}
              value={resolvedSelectValue}
              onChange={(e) => onChange?.(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              className={`w-full !h-9 !pl-3 !pr-8 !py-0 rounded-md border text-[12px] leading-5 font-sans font-normal outline-none shadow-none appearance-none cursor-pointer transition-all ${focusBoxClasses} ${valueClassName}`}
            >
              {emptyOptionLabel !== undefined && (
                <option value="" className="bg-white text-gray-500">
                  {emptyOptionLabel}
                </option>
              )}
              {options.map((opt) => (
                <option key={opt} value={opt} className="bg-white text-gray-900">
                  {opt}
                </option>
              ))}
            </select>
            <ChevronDown
              size={13}
              className={`absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none transition-colors ${
                activeFocus ? "text-[#BE9662]" : "text-gray-400"
              }`}
            />
          </div>
        ) : (
          <div className="relative w-full h-9">
            <input
              ref={inputRef}
              type={type}
              list={datalistId}
              value={rawStringVal}
              onChange={(e) => onChange?.(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Escape") {
                  (e.target as HTMLElement).blur();
                }
              }}
              placeholder={placeholder}
              className={`w-full !h-9 !px-3 !py-0 rounded-md border text-[12px] leading-5 font-sans font-normal outline-none shadow-none transition-all ${focusBoxClasses} ${valueClassName}`}
            />
            {datalistId && datalistOptions && datalistOptions.length > 0 && (
              <datalist id={datalistId}>
                {datalistOptions.map((opt) => (
                  <option key={opt} value={opt} />
                ))}
              </datalist>
            )}
          </div>
        )
      ) : (
        <div
          className={`relative -mx-3 w-[calc(100%+1.5rem)] h-9 px-3 rounded-md border border-transparent bg-transparent flex items-center justify-between gap-2 text-[12px] leading-5 font-normal min-w-0 select-text ${
            isEmptyDisplay ? "text-gray-400 font-normal" : valueClassName
          }`}
        >
          <span className="truncate min-w-0 flex-1">
            {isEmptyDisplay ? emptyText : value}
          </span>

          {(viewActions || textToCopy) && (
            <div className="flex items-center gap-1 shrink-0">
              {viewActions}
              {textToCopy && (
                <button
                  type="button"
                  onClick={handleCopy}
                  className="opacity-0 group-hover/field:opacity-100 flex items-center justify-center w-6 h-6 rounded-md bg-white border border-gray-200 text-gray-400 hover:text-[#051D35] hover:border-gray-300 shadow-2xs transition-all cursor-pointer"
                  title={`Copiază ${label}`}
                >
                  {copied ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
