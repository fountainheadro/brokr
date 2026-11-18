import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Workflow,
  Save,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  GripVertical,
  Plus,
  Sparkles,
  Info,
  Eraser,
  X,
} from "lucide-react";
import {
  BASE_TITLE_CATEGORIES,
  DEFAULT_RENT_PATTERN,
  DEFAULT_SALE_PATTERN,
  TitleAutomationRule,
  TitleCategoryConfig,
  TitleCategoryId,
} from "../../core/automation/typ_title-automation";
import { buildTitleFromAutomationRule } from "../../utils/titleAutomationEngine";

type PatternTarget = "sale" | "rent";
type ChipCategoryKey = TitleCategoryId | "connector";

interface ParsedPatternChip {
  uid: string;
  rawToken: string;
  label: string;
  categoryId: ChipCategoryKey;
}

interface ActiveDragState {
  kind: "category-row" | "category-tag" | "pattern-chip";
  fromIdx: number;
  overIdx: number;
  categoryId?: TitleCategoryId;
  patternTarget?: PatternTarget;
  label: string;
  categoryKey: ChipCategoryKey;
  clientX: number;
  clientY: number;
}

interface PendingPointerDrag {
  kind: "category-row" | "category-tag" | "pattern-chip";
  fromIdx: number;
  categoryId?: TitleCategoryId;
  patternTarget?: PatternTarget;
  label: string;
  categoryKey: ChipCategoryKey;
  startX: number;
  startY: number;
  started: boolean;
}

const DRAG_THRESHOLD_PX = 5;

const CATEGORY_THEME: Record<
  ChipCategoryKey,
  { chip: string; chipHover: string; removeBtn: string; dot: string }
> = {
  fillers: {
    chip: "bg-slate-100 text-slate-800 border-slate-300",
    chipHover: "hover:bg-slate-200/80 hover:border-slate-400",
    removeBtn: "text-slate-500 hover:text-rose-600",
    dot: "bg-slate-500",
  },
  tranzactie: {
    chip: "bg-blue-50 text-blue-800 border-blue-200",
    chipHover: "hover:bg-blue-100/80 hover:border-blue-300",
    removeBtn: "text-blue-500 hover:text-rose-600",
    dot: "bg-blue-500",
  },
  general: {
    chip: "bg-emerald-50 text-emerald-800 border-emerald-200",
    chipHover: "hover:bg-emerald-100/80 hover:border-emerald-300",
    removeBtn: "text-emerald-600 hover:text-rose-600",
    dot: "bg-emerald-500",
  },
  transport: {
    chip: "bg-cyan-50 text-cyan-800 border-cyan-200",
    chipHover: "hover:bg-cyan-100/80 hover:border-cyan-300",
    removeBtn: "text-cyan-600 hover:text-rose-600",
    dot: "bg-cyan-500",
  },
  relaxare: {
    chip: "bg-lime-50 text-lime-800 border-lime-300",
    chipHover: "hover:bg-lime-100/80 hover:border-lime-400",
    removeBtn: "text-lime-700 hover:text-rose-600",
    dot: "bg-lime-500",
  },
  atractie: {
    chip: "bg-purple-50 text-purple-800 border-purple-200",
    chipHover: "hover:bg-purple-100/80 hover:border-purple-300",
    removeBtn: "text-purple-500 hover:text-rose-600",
    dot: "bg-purple-500",
  },
  mobilare: {
    chip: "bg-amber-50 text-amber-800 border-amber-200",
    chipHover: "hover:bg-amber-100/80 hover:border-amber-300",
    removeBtn: "text-amber-600 hover:text-rose-600",
    dot: "bg-amber-500",
  },
  utilare: {
    chip: "bg-orange-50 text-orange-800 border-orange-200",
    chipHover: "hover:bg-orange-100/80 hover:border-orange-300",
    removeBtn: "text-orange-600 hover:text-rose-600",
    dot: "bg-orange-500",
  },
  parcare: {
    chip: "bg-indigo-50 text-indigo-800 border-indigo-200",
    chipHover: "hover:bg-indigo-100/80 hover:border-indigo-300",
    removeBtn: "text-indigo-500 hover:text-rose-600",
    dot: "bg-indigo-500",
  },
  animal_companie: {
    chip: "bg-pink-50 text-pink-800 border-pink-200",
    chipHover: "hover:bg-pink-100/80 hover:border-pink-300",
    removeBtn: "text-pink-500 hover:text-rose-600",
    dot: "bg-pink-500",
  },
  personalizat_1: {
    chip: "bg-teal-50 text-teal-800 border-teal-200",
    chipHover: "hover:bg-teal-100/80 hover:border-teal-300",
    removeBtn: "text-teal-600 hover:text-rose-600",
    dot: "bg-teal-500",
  },
  personalizat_2: {
    chip: "bg-fuchsia-50 text-fuchsia-800 border-fuchsia-200",
    chipHover: "hover:bg-fuchsia-100/80 hover:border-fuchsia-300",
    removeBtn: "text-fuchsia-500 hover:text-rose-600",
    dot: "bg-fuchsia-500",
  },
  personalizat_3: {
    chip: "bg-violet-50 text-violet-800 border-violet-200",
    chipHover: "hover:bg-violet-100/80 hover:border-violet-300",
    removeBtn: "text-violet-500 hover:text-rose-600",
    dot: "bg-violet-500",
  },
  identificare: {
    chip: "bg-rose-50 text-rose-800 border-rose-200",
    chipHover: "hover:bg-rose-100/80 hover:border-rose-300",
    removeBtn: "text-rose-500 hover:text-rose-700",
    dot: "bg-rose-500",
  },
  connector: {
    chip: "bg-stone-100 text-stone-700 border-stone-300",
    chipHover: "hover:bg-stone-200/80 hover:border-stone-400",
    removeBtn: "text-stone-500 hover:text-rose-600",
    dot: "bg-stone-500",
  },
};

function normalizeTokenKey(s: string): string {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

const KNOWN_TOKEN_META: Record<string, { label: string; categoryId: TitleCategoryId }> = (() => {
  const map: Record<string, { label: string; categoryId: TitleCategoryId }> = {
    " ": { label: "Spațiu", categoryId: "fillers" },
    "|": { label: "|", categoryId: "fillers" },
    "/": { label: "/", categoryId: "fillers" },
    "\\": { label: "\\", categoryId: "fillers" },
    ",": { label: ",", categoryId: "fillers" },
    moblare: { label: "Moblare", categoryId: "mobilare" },
    mobilare: { label: "Mobilare", categoryId: "mobilare" },
    "situatie animal de companie": {
      label: "Situatie animal de companie",
      categoryId: "animal_companie",
    },
  };

  for (const cat of BASE_TITLE_CATEGORIES) {
    for (const tag of cat.tags) {
      const inner = tag.token.slice(1, -1);
      if (cat.id === "fillers") continue;
      map[normalizeTokenKey(inner)] = {
        label: tag.label,
        categoryId: cat.id,
      };
    }
  }
  return map;
})();

function getFillerChipLabel(inner: string): string | null {
  if (inner === " ") return "Spațiu";
  if (inner === "|" || inner === "/" || inner === "\\" || inner === ",") return inner;
  return null;
}

function parsePatternToChips(pattern: string): ParsedPatternChip[] {
  const chips: ParsedPatternChip[] = [];
  const regex = /\[([^\]]+)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = regex.exec(pattern)) !== null) {
    if (match.index > lastIndex) {
      const literal = pattern.slice(lastIndex, match.index).trim();
      if (literal) {
        for (const word of literal.split(/\s+/).filter(Boolean)) {
          chips.push({
            uid: `chip_${idx++}_${word}`,
            rawToken: `[${word}]`,
            label: word,
            categoryId: "connector",
          });
        }
      }
    }

    const inner = match[1];
    const fillerLabel = getFillerChipLabel(inner);
    if (fillerLabel !== null) {
      chips.push({
        uid: `chip_${idx++}_${inner}`,
        rawToken: `[${inner}]`,
        label: fillerLabel,
        categoryId: "fillers",
      });
    } else {
      const meta = KNOWN_TOKEN_META[normalizeTokenKey(inner)];
      if (meta) {
        chips.push({
          uid: `chip_${idx++}_${inner}`,
          rawToken: match[0],
          label: meta.label,
          categoryId: meta.categoryId,
        });
      } else {
        chips.push({
          uid: `chip_${idx++}_${inner}`,
          rawToken: match[0],
          label: inner,
          categoryId: "connector",
        });
      }
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < pattern.length) {
    const tail = pattern.slice(lastIndex).trim();
    if (tail) {
      for (const word of tail.split(/\s+/).filter(Boolean)) {
        chips.push({
          uid: `chip_${idx++}_${word}`,
          rawToken: `[${word}]`,
          label: word,
          categoryId: "connector",
        });
      }
    }
  }

  return chips;
}

function serializeChipsToPattern(chips: ParsedPatternChip[]): string {
  let result = "";
  for (let i = 0; i < chips.length; i++) {
    const tok = chips[i].rawToken;
    const prevTok = i > 0 ? chips[i - 1].rawToken : "";
    const isTight = tok === "[/]" || tok === "[\\]";
    const prevIsTight = prevTok === "[/]" || prevTok === "[\\]";
    const isSpaceTok = tok === "[ ]";
    const prevIsSpaceTok = prevTok === "[ ]";

    if (i === 0 || isTight || prevIsTight || isSpaceTok || prevIsSpaceTok) {
      result += tok;
    } else {
      result += ` ${tok}`;
    }
  }
  return result;
}

function getCategoryTagDisplayLabel(tagLabel: string, token: string): string {
  if (token === "[ ]") return "Spațiu";
  if (token === "[|]") return "|";
  if (token === "[/]") return "/";
  if (token === "[\\]") return "\\";
  if (token === "[,]") return ",";
  return tagLabel;
}

const SAMPLE_RENT_AD = {
  transactionType: "Închiriere",
  categoria: "Apartament",
  camere: 2,
  suprafataUtila: 56,
  etaj: "Etaj 3",
  etajeTotal: 8,
  zona: "Drumul Taberei",
  statie: "Drumul Taberei",
  distantaStatie: "3 minute",
  numeParc: "Parcul Drumul Taberei",
  distantaParc: "5 minute",
  numeAtractie: "Plaza Romania",
  distantaAtractie: "7 minute",
  mobilat: "Complet",
  utilare: "Utilat",
  parcare: "Parcare",
  petFriendly: "Pet Friendly",
  propertyId: "P21",
};

const SAMPLE_SALE_AD = {
  transactionType: "Vânzare",
  categoria: "Apartament",
  camere: 2,
  suprafataUtila: 56,
  etaj: "Etaj 3",
  etajeTotal: 8,
  zona: "Drumul Taberei",
  statie: "Drumul Taberei",
  distantaStatie: "3 minute",
  numeParc: "Parcul Drumul Taberei",
  distantaParc: "5 minute",
  numeAtractie: "Plaza Romania",
  distantaAtractie: "7 minute",
  mobilat: "Complet",
  utilare: "Utilat",
  parcare: "Parcare",
  petFriendly: "",
  propertyId: "P21",
};

export interface TitleAutomationEditorProps {
  mode: "agency" | "platform_default";
  rule: TitleAutomationRule;
  onChangeRule: React.Dispatch<React.SetStateAction<TitleAutomationRule>>;
  isCustomOverride?: boolean;
  isLoading: boolean;
  isSaving: boolean;
  saveSuccess: boolean;
  error: string | null;
  onSave: (e: React.FormEvent) => void;
  onReset: () => void;
}

export const CmpTitleAutomationEditor: React.FC<TitleAutomationEditorProps> = ({
  mode,
  rule,
  onChangeRule,
  isCustomOverride,
  isLoading,
  isSaving,
  saveSuccess,
  error,
  onSave,
  onReset,
}) => {
  const [activeTarget, setActiveTarget] = useState<PatternTarget>("sale");
  const [saleCustomInput, setSaleCustomInput] = useState("");
  const [rentCustomInput, setRentCustomInput] = useState("");
  const [dragState, setDragState] = useState<ActiveDragState | null>(null);

  const saleInputRef = useRef<HTMLInputElement>(null);
  const rentInputRef = useRef<HTMLInputElement>(null);

  const pendingDragRef = useRef<PendingPointerDrag | null>(null);
  const activeDragRef = useRef<ActiveDragState | null>(null);
  const suppressNextClickRef = useRef(false);

  const categoryRowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const categoryTagRefs = useRef<Record<string, Array<HTMLButtonElement | null>>>({});
  const patternChipRefs = useRef<Record<PatternTarget, Array<HTMLDivElement | null>>>({
    sale: [],
    rent: [],
  });

  const saleChips = useMemo(() => parsePatternToChips(rule.salePattern), [rule.salePattern]);
  const rentChips = useMemo(() => parsePatternToChips(rule.rentPattern), [rule.rentPattern]);

  const moveCategory = useCallback(
    (fromIdx: number, toIdx: number) => {
      if (fromIdx === toIdx) return;
      onChangeRule((prev) => {
        if (toIdx < 0 || toIdx >= prev.categories.length || fromIdx < 0 || fromIdx >= prev.categories.length) {
          return prev;
        }
        const next = [...prev.categories];
        const [moved] = next.splice(fromIdx, 1);
        next.splice(toIdx, 0, moved);
        return { ...prev, categories: next };
      });
    },
    [onChangeRule]
  );

  const moveTagWithinCategory = useCallback(
    (categoryId: TitleCategoryId, fromIdx: number, toIdx: number) => {
      if (fromIdx === toIdx) return;
      onChangeRule((prev) => {
        const nextCats = prev.categories.map((cat) => {
          if (cat.id !== categoryId) return cat;
          if (toIdx < 0 || toIdx >= cat.tags.length || fromIdx < 0 || fromIdx >= cat.tags.length) return cat;
          const nextTags = [...cat.tags];
          const [moved] = nextTags.splice(fromIdx, 1);
          nextTags.splice(toIdx, 0, moved);
          return { ...cat, tags: nextTags };
        });
        return { ...prev, categories: nextCats };
      });
    },
    [onChangeRule]
  );

  const movePatternChip = useCallback(
    (target: PatternTarget, fromIdx: number, toIdx: number) => {
      if (fromIdx === toIdx) return;
      onChangeRule((prev) => {
        const currentPattern = target === "sale" ? prev.salePattern : prev.rentPattern;
        const chips = parsePatternToChips(currentPattern);
        if (fromIdx < 0 || fromIdx >= chips.length || toIdx < 0 || toIdx >= chips.length) {
          return prev;
        }
        const next = [...chips];
        const [moved] = next.splice(fromIdx, 1);
        next.splice(toIdx, 0, moved);
        const serialized = serializeChipsToPattern(next);
        return target === "sale" ? { ...prev, salePattern: serialized } : { ...prev, rentPattern: serialized };
      });
    },
    [onChangeRule]
  );

  const insertTokenIntoActivePattern = (token: string, categoryId: ChipCategoryKey, label: string) => {
    const isSale = activeTarget === "sale";
    onChangeRule((prev) => {
      const currentPattern = isSale ? prev.salePattern : prev.rentPattern;
      const chips = parsePatternToChips(currentPattern);
      const nextChips: ParsedPatternChip[] = [
        ...chips,
        {
          uid: `new_${Date.now()}_${chips.length}`,
          rawToken: token,
          label,
          categoryId,
        },
      ];
      const serialized = serializeChipsToPattern(nextChips);
      return isSale ? { ...prev, salePattern: serialized } : { ...prev, rentPattern: serialized };
    });
  };

  const removePatternChipAt = (target: PatternTarget, idx: number) => {
    onChangeRule((prev) => {
      const currentPattern = target === "sale" ? prev.salePattern : prev.rentPattern;
      const chips = parsePatternToChips(currentPattern);
      if (idx < 0 || idx >= chips.length) return prev;
      const next = chips.filter((_, i) => i !== idx);
      const serialized = serializeChipsToPattern(next);
      return target === "sale" ? { ...prev, salePattern: serialized } : { ...prev, rentPattern: serialized };
    });
  };

  const commitCustomWord = (target: PatternTarget, rawText: string) => {
    const trimmed = rawText.replace(/[\[\]]/g, "").trim();
    if (!trimmed) return;
    onChangeRule((prev) => {
      const currentPattern = target === "sale" ? prev.salePattern : prev.rentPattern;
      const chips = parsePatternToChips(currentPattern);
      const nextChips: ParsedPatternChip[] = [
        ...chips,
        {
          uid: `word_${Date.now()}_${chips.length}`,
          rawToken: `[${trimmed}]`,
          label: trimmed,
          categoryId: "connector",
        },
      ];
      const serialized = serializeChipsToPattern(nextChips);
      return target === "sale" ? { ...prev, salePattern: serialized } : { ...prev, rentPattern: serialized };
    });
    if (target === "sale") setSaleCustomInput("");
    else setRentCustomInput("");
  };

  const computeClosestIndex = (
    elements: Array<HTMLElement | null>,
    clientX: number,
    clientY: number,
    axis: "vertical" | "grid",
    fallbackIdx: number
  ): number => {
    let bestIdx = fallbackIdx;
    let bestScore = Infinity;

    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      if (!el) continue;
      const rect = el.getBoundingClientRect();

      if (axis === "vertical") {
        const cy = (rect.top + rect.bottom) / 2;
        const dist = Math.abs(clientY - cy);
        if (dist < bestScore) {
          bestScore = dist;
          bestIdx = i;
        }
      } else {
        // Multi-line flex-wrap aware distance: strongly prefer same row (y inside rect), then horizontal proximity
        const cx = (rect.left + rect.right) / 2;
        const cy = (rect.top + rect.bottom) / 2;
        const withinY = clientY >= rect.top - 6 && clientY <= rect.bottom + 6;
        const yPenalty = withinY ? 0 : Math.abs(clientY - cy) * 10;
        const score = yPenalty + Math.abs(clientX - cx);
        if (score < bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
    }

    return bestIdx;
  };

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      const pending = pendingDragRef.current;
      if (!pending) return;

      const dx = e.clientX - pending.startX;
      const dy = e.clientY - pending.startY;
      if (!pending.started) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        pending.started = true;
        suppressNextClickRef.current = true;
      }

      let overIdx = pending.fromIdx;
      if (pending.kind === "category-row") {
        overIdx = computeClosestIndex(
          categoryRowRefs.current,
          e.clientX,
          e.clientY,
          "vertical",
          pending.fromIdx
        );
      } else if (pending.kind === "category-tag" && pending.categoryId) {
        const tagEls = categoryTagRefs.current[pending.categoryId] || [];
        overIdx = computeClosestIndex(tagEls, e.clientX, e.clientY, "grid", pending.fromIdx);
      } else if (pending.kind === "pattern-chip" && pending.patternTarget) {
        const chipEls = patternChipRefs.current[pending.patternTarget] || [];
        overIdx = computeClosestIndex(chipEls, e.clientX, e.clientY, "grid", pending.fromIdx);
      }

      const nextState: ActiveDragState = {
        kind: pending.kind,
        fromIdx: pending.fromIdx,
        overIdx,
        categoryId: pending.categoryId,
        patternTarget: pending.patternTarget,
        label: pending.label,
        categoryKey: pending.categoryKey,
        clientX: e.clientX,
        clientY: e.clientY,
      };
      activeDragRef.current = nextState;
      setDragState(nextState);
    };

    const finishDrag = () => {
      const active = activeDragRef.current;
      const pending = pendingDragRef.current;
      pendingDragRef.current = null;
      activeDragRef.current = null;
      setDragState(null);

      if (active && active.fromIdx !== active.overIdx) {
        if (active.kind === "category-row") {
          moveCategory(active.fromIdx, active.overIdx);
        } else if (active.kind === "category-tag" && active.categoryId) {
          moveTagWithinCategory(active.categoryId, active.fromIdx, active.overIdx);
        } else if (active.kind === "pattern-chip" && active.patternTarget) {
          movePatternChip(active.patternTarget, active.fromIdx, active.overIdx);
        }
      }

      if (pending?.started) {
        window.setTimeout(() => {
          suppressNextClickRef.current = false;
        }, 60);
      }
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
    };
  }, [moveCategory, movePatternChip, moveTagWithinCategory]);

  const startPointerDrag = (
    e: React.PointerEvent,
    config: Omit<PendingPointerDrag, "startX" | "startY" | "started">
  ) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const targetEl = e.target as HTMLElement | null;
    if (targetEl?.closest('[data-no-drag="true"], input, textarea')) return;

    pendingDragRef.current = {
      ...config,
      startX: e.clientX,
      startY: e.clientY,
      started: false,
    };
  };

  const salePreview = buildTitleFromAutomationRule(rule, SAMPLE_SALE_AD);
  const rentPreview = buildTitleFromAutomationRule(rule, SAMPLE_RENT_AD);

  const renderPatternChipBox = (
    target: PatternTarget,
    chips: ParsedPatternChip[],
    customInput: string,
    setCustomInput: React.Dispatch<React.SetStateAction<string>>,
    inputRef: React.RefObject<HTMLInputElement | null>
  ) => {
    const isActive = activeTarget === target;
    patternChipRefs.current[target] = [];

    return (
      <div
        onClick={() => {
          setActiveTarget(target);
          inputRef.current?.focus();
        }}
        className={`min-h-[46px] h-auto border rounded-lg p-2 bg-white flex flex-wrap gap-1.5 items-center cursor-text transition-colors ${
          isActive
            ? "border-[#BE9662] ring-1 ring-[#BE9662]"
            : "border-gray-300 hover:border-gray-400"
        }`}
      >
        {chips.map((chip, idx) => {
          const theme = CATEGORY_THEME[chip.categoryId] || CATEGORY_THEME.connector;
          const isBeingDragged =
            dragState?.kind === "pattern-chip" &&
            dragState.patternTarget === target &&
            dragState.fromIdx === idx;
          const isDropTarget =
            dragState?.kind === "pattern-chip" &&
            dragState.patternTarget === target &&
            dragState.overIdx === idx &&
            dragState.fromIdx !== idx;

          return (
            <div
              key={chip.uid}
              ref={(el) => {
                patternChipRefs.current[target][idx] = el;
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                startPointerDrag(e, {
                  kind: "pattern-chip",
                  fromIdx: idx,
                  patternTarget: target,
                  label: chip.label,
                  categoryKey: chip.categoryId,
                });
              }}
              title="Trage pentru a reordona sau apasă × pentru a șterge"
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border select-none touch-pan-y transition-all cursor-grab active:cursor-grabbing ${
                theme.chip
              } ${isBeingDragged ? "opacity-35 scale-95" : ""} ${
                isDropTarget ? "ring-2 ring-[#051D35] ring-offset-1" : ""
              }`}
            >
              <GripVertical size={10} className="opacity-45 shrink-0" />
              <span>{chip.label}</span>
              <button
                type="button"
                data-no-drag="true"
                onClick={(e) => {
                  e.stopPropagation();
                  removePatternChipAt(target, idx);
                }}
                title="Elimină tag"
                className={`ml-0.5 rounded-sm p-0.5 transition-colors cursor-pointer ${theme.removeBtn}`}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}

        <input
          ref={inputRef}
          type="text"
          value={customInput}
          onFocus={() => setActiveTarget(target)}
          onChange={(e) => setCustomInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commitCustomWord(target, customInput);
            } else if (e.key === "Backspace" && customInput === "" && chips.length > 0) {
              e.preventDefault();
              removePatternChipAt(target, chips.length - 1);
            }
          }}
          onBlur={() => {
            if (customInput.trim()) {
              commitCustomWord(target, customInput);
            }
          }}
          placeholder={
            chips.length === 0
              ? "Click pe tag-urile de mai jos sau scrie un cuvânt (ex: De) + Enter..."
              : "Cuvânt legătură + Enter..."
          }
          className="flex-1 min-w-[165px] h-7 px-1.5 text-xs text-gray-800 placeholder:text-gray-400 border-0 focus:outline-none focus:ring-0 bg-transparent"
        />
      </div>
    );
  };

  const renderCategoryTags = (cat: TitleCategoryConfig) => {
    const theme = CATEGORY_THEME[cat.id] || CATEGORY_THEME.connector;
    categoryTagRefs.current[cat.id] = [];

    return (
      <div className="flex flex-wrap items-center gap-2">
        {cat.tags.map((tag, tagIdx) => {
          const displayLabel = getCategoryTagDisplayLabel(tag.label, tag.token);
          const isBeingDragged =
            dragState?.kind === "category-tag" &&
            dragState.categoryId === cat.id &&
            dragState.fromIdx === tagIdx;
          const isDropTarget =
            dragState?.kind === "category-tag" &&
            dragState.categoryId === cat.id &&
            dragState.overIdx === tagIdx &&
            dragState.fromIdx !== tagIdx;

          return (
            <button
              key={tag.id}
              ref={(el) => {
                categoryTagRefs.current[cat.id][tagIdx] = el;
              }}
              type="button"
              onPointerDown={(e) => {
                e.stopPropagation();
                if (cat.tags.length > 1) {
                  startPointerDrag(e, {
                    kind: "category-tag",
                    fromIdx: tagIdx,
                    categoryId: cat.id,
                    label: displayLabel,
                    categoryKey: cat.id,
                  });
                }
              }}
              onClick={() => {
                if (suppressNextClickRef.current) return;
                insertTokenIntoActivePattern(tag.token, cat.id, displayLabel);
              }}
              title={
                cat.tags.length > 1
                  ? `Click pentru a insera în ${
                      activeTarget === "sale" ? "Vânzare" : "Închiriere"
                    } · Trage stânga/dreapta pentru reordonare`
                  : `Click pentru a insera în ${activeTarget === "sale" ? "Vânzare" : "Închiriere"}`
              }
              className={`group inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium select-none touch-pan-y transition-all cursor-pointer ${
                theme.chip
              } ${theme.chipHover} ${isBeingDragged ? "opacity-35 scale-95" : ""} ${
                isDropTarget ? "ring-2 ring-[#051D35] ring-offset-1" : ""
              }`}
            >
              {cat.tags.length > 1 && (
                <GripVertical
                  size={12}
                  className="opacity-45 group-hover:opacity-80 cursor-grab shrink-0"
                />
              )}
              <span>{displayLabel}</span>
              <Plus size={12} className="opacity-55 group-hover:opacity-100 shrink-0" />
            </button>
          );
        })}

        {cat.customKey && (
          <input
            type="text"
            value={rule.customValues[cat.customKey] || ""}
            onChange={(e) => {
              const val = e.target.value;
              const key = cat.customKey!;
              onChangeRule((prev) => ({
                ...prev,
                customValues: {
                  ...prev.customValues,
                  [key]: val,
                },
              }));
            }}
            placeholder={`Text manual pentru ${cat.label}...`}
            className="h-8 min-w-[210px] flex-1 max-w-xs px-2.5 bg-white border border-gray-300 rounded-lg text-xs text-gray-800 placeholder:text-gray-400 focus:outline-none focus:border-[#BE9662]"
          />
        )}
      </div>
    );
  };

  return (
    <div className={`max-w-6xl mx-auto space-y-4 ${dragState ? "select-none" : ""}`}>
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#051D35] text-[#BE9662] flex items-center justify-center shrink-0">
            <Workflow size={20} />
          </div>
          <div>
            <h1 className="font-title text-sm font-semibold text-gray-900">
              {mode === "platform_default"
                ? "1. Regula implicită globală — Extragere și construire titluri anunțuri externe (Lead-uri)"
                : "1. Regula de extragere și construire a titlurilor pentru anunțurile externe (Lead-uri)"}
            </h1>
            <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
              {mode === "platform_default" ? (
                <>
                  Această configurație este setată la nivel de{" "}
                  <strong className="font-semibold text-gray-700">Super Admin</strong> și reprezintă regula implicită moștenită automat de toate agențiile care nu au definit încă o regulă proprie.
                </>
              ) : (
                <>
                  Definiți șablonul titlurilor pentru proprietățile de{" "}
                  <strong className="font-semibold text-gray-700">Vânzare</strong> și{" "}
                  <strong className="font-semibold text-gray-700">Închiriere</strong> importate din platformele externe în secțiunea Lead-uri pentru această agenție.
                </>
              )}
            </p>
            {mode === "agency" && (
              <span
                className={`inline-flex items-center gap-1.5 mt-2 px-2.5 py-0.5 rounded text-[11px] font-medium border ${
                  isCustomOverride
                    ? "bg-amber-50 border-amber-200 text-amber-800"
                    : "bg-slate-50 border-slate-200 text-slate-700"
                }`}
              >
                <Info size={11} />
                <span>
                  {isCustomOverride
                    ? "Configurație personalizată a agenției (suprascrie implicitul platformei)"
                    : "Moștenește regula implicită a platformei (Super Admin)"}
                </span>
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <label className="inline-flex items-center gap-2 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs font-semibold text-gray-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={rule.enabled}
              onChange={(e) => onChangeRule((prev) => ({ ...prev, enabled: e.target.checked }))}
              className="w-3.5 h-3.5 accent-[#051D35] rounded cursor-pointer"
            />
            <span>Regulă activă</span>
          </label>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2 text-xs text-rose-700">
          <AlertCircle size={15} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {isLoading ? (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-xs text-gray-500">
          Se încarcă setările de automatizare...
        </div>
      ) : (
        <form onSubmit={onSave} className="space-y-4">
          {/* Min & Max Characters Setting */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-2xs space-y-3">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-gray-100 pb-3">
              <div>
                <h2 className="font-title text-xs font-semibold text-gray-900">
                  Limite de caractere pentru titlul generat
                </h2>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Controlează numărul minim și maxim de caractere. Când există mai multe informații disponibile, AI-ul și motorul de formatare selectează doar primele elemente prioritare (de sus în jos pe categorii și de la stânga la dreapta în categorie) care încap în limita maximă.
                </p>
              </div>

              {saveSuccess && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded shrink-0">
                  <CheckCircle2 size={13} />
                  <span>Salvat!</span>
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
              <div className="space-y-1">
                <label className="block text-[11px] font-semibold text-gray-700">
                  Număr minim de caractere
                </label>
                <input
                  type="number"
                  min={10}
                  max={250}
                  value={rule.minChars}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10) || 10;
                    onChangeRule((prev) => ({
                      ...prev,
                      minChars: val,
                      maxChars: Math.max(prev.maxChars, val + 5),
                    }));
                  }}
                  className="w-full h-9 px-3 bg-gray-50 border border-gray-200 rounded-lg text-xs font-semibold text-gray-900 focus:bg-white focus:outline-none focus:border-[#BE9662]"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-[11px] font-semibold text-gray-700">
                  Număr maxim de caractere
                </label>
                <input
                  type="number"
                  min={20}
                  max={350}
                  value={rule.maxChars}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10) || 20;
                    onChangeRule((prev) => ({
                      ...prev,
                      maxChars: Math.max(val, prev.minChars + 5),
                    }));
                  }}
                  className="w-full h-9 px-3 bg-gray-50 border border-gray-200 rounded-lg text-xs font-semibold text-gray-900 focus:bg-white focus:outline-none focus:border-[#BE9662]"
                />
              </div>
            </div>
          </div>

          {/* Sale & Rent Pattern Tag Builders */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-2xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-gray-100">
              <div>
                <h2 className="font-title text-xs font-semibold text-gray-900">
                  Șabloane construcție titlu (Vânzare & Închiriere)
                </h2>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Selectați câmpul dorit și dați click pe tag-urile de mai jos pentru a le insera. Puteți trage tag-urile pentru a le schimba ordinea, apăsa <strong className="text-gray-700">×</strong> pentru eliminare sau tasta cuvinte scurte de legătură (ex: <em className="text-gray-700">De</em>, <em className="text-gray-700">la</em>, <em className="text-gray-700">si</em>) urmate de <kbd className="px-1 py-0.5 bg-gray-100 border border-gray-200 rounded text-[10px]">Enter</kbd>.
                </p>
              </div>

              <div className="flex items-center gap-1.5 bg-gray-100 p-1 rounded-lg shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setActiveTarget("sale");
                    saleInputRef.current?.focus();
                  }}
                  className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                    activeTarget === "sale"
                      ? "bg-[#051D35] text-white shadow-2xs"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  Țintă tag-uri: Vânzare
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTarget("rent");
                    rentInputRef.current?.focus();
                  }}
                  className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                    activeTarget === "rent"
                      ? "bg-[#051D35] text-white shadow-2xs"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  Țintă tag-uri: Închiriere
                </button>
              </div>
            </div>

            {/* Sale Pattern */}
            <div
              className={`p-3.5 rounded-xl border transition-colors ${
                activeTarget === "sale"
                  ? "border-[#BE9662] bg-amber-50/25"
                  : "border-gray-200 bg-gray-50/40"
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-900">
                    Format titlu — Proprietăți de Vânzare
                  </span>
                  {activeTarget === "sale" && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-[#051D35] text-[#BE9662]">
                      Activ pentru inserare tag-uri
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onChangeRule((prev) => ({ ...prev, salePattern: DEFAULT_SALE_PATTERN }))}
                    className="text-[11px] font-medium text-gray-500 hover:text-gray-800 cursor-pointer"
                  >
                    Model exemplu
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangeRule((prev) => ({ ...prev, salePattern: "" }))}
                    className="text-[11px] font-medium text-gray-400 hover:text-rose-600 flex items-center gap-1 cursor-pointer"
                  >
                    <Eraser size={11} />
                    <span>Golește</span>
                  </button>
                </div>
              </div>

              {renderPatternChipBox("sale", saleChips, saleCustomInput, setSaleCustomInput, saleInputRef)}

              <div className="mt-2 flex items-center justify-between gap-2 text-[11px] bg-white border border-gray-200 rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <span className="font-semibold text-gray-500 mr-1.5">Previzualizare Vânzare:</span>
                  <span className="font-semibold text-[#051D35] break-words">
                    {salePreview || "(Titlu gol — adăugați tag-uri mai jos)"}
                  </span>
                </div>
                <span
                  className={`shrink-0 font-mono text-[10px] px-1.5 py-0.5 rounded ${
                    salePreview.length > rule.maxChars || salePreview.length < rule.minChars
                      ? "bg-amber-50 text-amber-700 border border-amber-200"
                      : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  }`}
                >
                  {salePreview.length} / {rule.maxChars} car.
                </span>
              </div>
            </div>

            {/* Rent Pattern */}
            <div
              className={`p-3.5 rounded-xl border transition-colors ${
                activeTarget === "rent"
                  ? "border-[#BE9662] bg-amber-50/25"
                  : "border-gray-200 bg-gray-50/40"
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-900">
                    Format titlu — Proprietăți de Închiriere
                  </span>
                  {activeTarget === "rent" && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-[#051D35] text-[#BE9662]">
                      Activ pentru inserare tag-uri
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onChangeRule((prev) => ({ ...prev, rentPattern: DEFAULT_RENT_PATTERN }))}
                    className="text-[11px] font-medium text-gray-500 hover:text-gray-800 cursor-pointer"
                  >
                    Model exemplu
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangeRule((prev) => ({ ...prev, rentPattern: "" }))}
                    className="text-[11px] font-medium text-gray-400 hover:text-rose-600 flex items-center gap-1 cursor-pointer"
                  >
                    <Eraser size={11} />
                    <span>Golește</span>
                  </button>
                </div>
              </div>

              {renderPatternChipBox("rent", rentChips, rentCustomInput, setRentCustomInput, rentInputRef)}

              <div className="mt-2 flex items-center justify-between gap-2 text-[11px] bg-white border border-gray-200 rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <span className="font-semibold text-gray-500 mr-1.5">Previzualizare Închiriere:</span>
                  <span className="font-semibold text-[#051D35] break-words">
                    {rentPreview || "(Titlu gol — adăugați tag-uri mai jos)"}
                  </span>
                </div>
                <span
                  className={`shrink-0 font-mono text-[10px] px-1.5 py-0.5 rounded ${
                    rentPreview.length > rule.maxChars || rentPreview.length < rule.minChars
                      ? "bg-amber-50 text-amber-700 border border-amber-200"
                      : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  }`}
                >
                  {rentPreview.length} / {rule.maxChars} car.
                </span>
              </div>
            </div>
          </div>

          {/* Categories & Tags */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-2xs space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-gray-100">
              <div>
                <h2 className="font-title text-xs font-semibold text-gray-900 flex items-center gap-1.5">
                  <Sparkles size={14} className="text-[#BE9662]" />
                  <span>Tag-uri de informații disponibile & Ordine priorități</span>
                </h2>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Dați click pe un tag pentru a-l adăuga în șablonul activ. Trageți cu mouse-ul sau degetul pentru a reordona:
                  <strong className="text-gray-700"> categoria de sus = prioritate maximă</strong>, iar{" "}
                  <strong className="text-gray-700">tag-ul cel mai din stânga = greutate maximă</strong>.
                </p>
              </div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-50 border border-slate-200 text-[11px] text-slate-600 shrink-0">
                <Info size={12} className="text-[#051D35]" />
                <span>
                  Inserare în: <strong>{activeTarget === "sale" ? "Vânzare" : "Închiriere"}</strong>
                </span>
              </div>
            </div>

            <div className="space-y-2">
              {rule.categories.map((cat, catIdx) => {
                const isDragged = dragState?.kind === "category-row" && dragState.fromIdx === catIdx;
                const isDragOver =
                  dragState?.kind === "category-row" &&
                  dragState.overIdx === catIdx &&
                  dragState.fromIdx !== catIdx;
                const catTheme = CATEGORY_THEME[cat.id] || CATEGORY_THEME.connector;

                return (
                  <div
                    key={cat.id}
                    ref={(el) => {
                      categoryRowRefs.current[catIdx] = el;
                    }}
                    className={`flex flex-col lg:flex-row lg:items-center gap-3 p-3 rounded-xl border transition-all ${
                      isDragged
                        ? "opacity-45 border-[#BE9662] bg-amber-50/40"
                        : isDragOver
                        ? "border-[#051D35] ring-2 ring-[#051D35]/20 bg-slate-50"
                        : "border-gray-200 bg-white hover:border-gray-300"
                    }`}
                  >
                    <div
                      onPointerDown={(e) =>
                        startPointerDrag(e, {
                          kind: "category-row",
                          fromIdx: catIdx,
                          label: cat.label,
                          categoryKey: cat.id,
                        })
                      }
                      title="Trage pentru a reordona prioritatea categoriei"
                      className="flex items-center gap-2 lg:w-56 shrink-0 cursor-grab active:cursor-grabbing touch-none select-none py-0.5"
                    >
                      <span className="text-gray-400 hover:text-gray-700 p-0.5">
                        <GripVertical size={15} />
                      </span>
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${catTheme.dot}`} />
                      <span className="text-xs font-semibold text-gray-900 truncate flex-1">
                        {cat.label}
                      </span>
                    </div>

                    <div className="hidden lg:block w-px h-7 bg-gray-200 shrink-0" />

                    <div className="flex-1 min-w-0">{renderCategoryTags(cat)}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Save & Reset Actions */}
          <div className="flex items-center justify-between gap-3 pt-2">
            <button
              type="button"
              onClick={onReset}
              disabled={isSaving}
              className="px-3.5 py-2 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 rounded-lg font-semibold text-xs flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RotateCcw size={13} />
              <span>
                {mode === "agency"
                  ? "Resetează la implicitul platformei"
                  : "Resetează la implicitul de sistem"}
              </span>
            </button>

            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2 bg-[#051D35] hover:bg-[#051D35]/90 text-white rounded-lg font-semibold text-xs flex items-center gap-2 shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
            >
              <Save size={14} />
              <span>
                {isSaving
                  ? "Se salvează..."
                  : mode === "platform_default"
                  ? "Salvează Regula Implicită Globală"
                  : "Salvează Regula Agenției"}
              </span>
            </button>
          </div>
        </form>
      )}

      {/* Floating cross-browser drag preview */}
      {dragState && (
        <div
          style={{
            left: dragState.clientX + 12,
            top: dragState.clientY + 12,
          }}
          className={`fixed pointer-events-none z-[120] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold shadow-lg opacity-95 ${
            (CATEGORY_THEME[dragState.categoryKey] || CATEGORY_THEME.connector).chip
          }`}
        >
          <GripVertical size={12} className="opacity-60" />
          <span>{dragState.label}</span>
        </div>
      )}
    </div>
  );
};
