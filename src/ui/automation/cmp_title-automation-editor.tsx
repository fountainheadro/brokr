import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Workflow,
  Save,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  GripVertical,
  Info,
  Eraser,
  X,
} from "lucide-react";
import {
  BASE_TITLE_CATEGORIES,
  DEFAULT_RENT_PATTERN,
  DEFAULT_SALE_PATTERN,
  TitleAutomationRule,
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
  tagId?: string;
}

interface ToolbarTagItem {
  id: string;
  label: string;
  token: string;
  categoryId: TitleCategoryId;
  isFiller: boolean;
}

interface ActiveDragState {
  kind: "pattern-chip" | "toolbar-tag";
  patternTarget: PatternTarget;
  fromIdx: number;
  overIdx: number;
  dropInsertIdx: number | null;
  token?: string;
  tagId?: string;
  isFiller?: boolean;
  label: string;
  categoryKey: ChipCategoryKey;
  clientX: number;
  clientY: number;
}

interface PendingPointerDrag {
  kind: "pattern-chip" | "toolbar-tag";
  patternTarget: PatternTarget;
  fromIdx: number;
  token?: string;
  tagId?: string;
  isFiller?: boolean;
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

const KNOWN_TOKEN_META: Record<
  string,
  { label: string; categoryId: TitleCategoryId; tagId: string }
> = (() => {
  const map: Record<string, { label: string; categoryId: TitleCategoryId; tagId: string }> = {
    " ": { label: "spațiu", categoryId: "fillers", tagId: "space" },
    "|": { label: "|", categoryId: "fillers", tagId: "pipe" },
    "/": { label: "/", categoryId: "fillers", tagId: "slash" },
    "\\": { label: "\\", categoryId: "fillers", tagId: "backslash" },
    ",": { label: ",", categoryId: "fillers", tagId: "comma" },
    tip: { label: "tip", categoryId: "general", tagId: "tip" },
    utila: { label: "utila", categoryId: "general", tagId: "utila" },
    construita: { label: "construita", categoryId: "general", tagId: "construita" },
    "nume atrctie": { label: "nume atractie", categoryId: "atractie", tagId: "nume_atractie" },
    moblare: { label: "mobilare", categoryId: "mobilare", tagId: "mobilare" },
    mobilare: { label: "mobilare", categoryId: "mobilare", tagId: "mobilare" },
    pet: { label: "animal companie", categoryId: "animal_companie", tagId: "situatie_pet" },
    "animal companie": {
      label: "animal companie",
      categoryId: "animal_companie",
      tagId: "situatie_pet",
    },
    "situatie animal de companie": {
      label: "animal companie",
      categoryId: "animal_companie",
      tagId: "situatie_pet",
    },
  };

  for (const cat of BASE_TITLE_CATEGORIES) {
    for (const tag of cat.tags) {
      if (cat.id === "fillers") continue;
      const inner = tag.token.slice(1, -1);
      map[normalizeTokenKey(inner)] = {
        label: tag.label.toLowerCase(),
        categoryId: cat.id,
        tagId: tag.id,
      };
    }
  }
  return map;
})();

function getFillerChipMeta(inner: string): { label: string; tagId: string } | null {
  if (inner === " ") return { label: "spațiu", tagId: "space" };
  if (inner === "|") return { label: "|", tagId: "pipe" };
  if (inner === "/") return { label: "/", tagId: "slash" };
  if (inner === "\\") return { label: "\\", tagId: "backslash" };
  if (inner === ",") return { label: ",", tagId: "comma" };
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
    const fillerMeta = getFillerChipMeta(inner);
    if (fillerMeta !== null) {
      chips.push({
        uid: `chip_${idx++}_${inner}`,
        rawToken: `[${inner}]`,
        label: fillerMeta.label,
        categoryId: "fillers",
        tagId: fillerMeta.tagId,
      });
    } else {
      const meta = KNOWN_TOKEN_META[normalizeTokenKey(inner)];
      if (meta) {
        chips.push({
          uid: `chip_${idx++}_${inner}`,
          rawToken: match[0],
          label: meta.label,
          categoryId: meta.categoryId,
          tagId: meta.tagId,
        });
      } else {
        chips.push({
          uid: `chip_${idx++}_${inner}`,
          rawToken: match[0],
          label: inner.toLowerCase(),
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
  if (token === "[ ]") return "spațiu";
  if (token === "[|]") return "|";
  if (token === "[/]") return "/";
  if (token === "[\\]") return "\\";
  if (token === "[,]") return ",";
  return tagLabel.toLowerCase();
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
  const saleChips = useMemo(() => parsePatternToChips(rule.salePattern), [rule.salePattern]);
  const rentChips = useMemo(() => parsePatternToChips(rule.rentPattern), [rule.rentPattern]);

  const [activeTarget, setActiveTarget] = useState<PatternTarget>("sale");
  const [saleCustomInput, setSaleCustomInput] = useState("");
  const [rentCustomInput, setRentCustomInput] = useState("");
  const [dragState, setDragState] = useState<ActiveDragState | null>(null);
  const [cursorPos, setCursorPos] = useState<Record<PatternTarget, number>>({
    sale: saleChips.length,
    rent: rentChips.length,
  });

  const cursorPosRef = useRef<Record<PatternTarget, number>>({
    sale: saleChips.length,
    rent: rentChips.length,
  });
  const prevLoadingRef = useRef(isLoading);

  const saleInputRef = useRef<HTMLInputElement>(null);
  const rentInputRef = useRef<HTMLInputElement>(null);

  const pendingDragRef = useRef<PendingPointerDrag | null>(null);
  const activeDragRef = useRef<ActiveDragState | null>(null);
  const suppressNextClickRef = useRef(false);

  const patternBoxRefs = useRef<Record<PatternTarget, HTMLDivElement | null>>({
    sale: null,
    rent: null,
  });
  const patternChipRefs = useRef<Record<PatternTarget, Array<HTMLDivElement | null>>>({
    sale: [],
    rent: [],
  });

  const setCursorPosFor = useCallback((target: PatternTarget, nextPos: number) => {
    const safePos = Math.max(0, nextPos);
    cursorPosRef.current = { ...cursorPosRef.current, [target]: safePos };
    setCursorPos((prev) => (prev[target] === safePos ? prev : { ...prev, [target]: safePos }));
  }, []);

  const focusTargetInput = useCallback((target: PatternTarget) => {
    window.requestAnimationFrame(() => {
      const el = target === "sale" ? saleInputRef.current : rentInputRef.current;
      el?.focus();
    });
  }, []);

  // Sync cursor to end of patterns when initial load finishes
  useEffect(() => {
    if (prevLoadingRef.current && !isLoading) {
      const next = { sale: saleChips.length, rent: rentChips.length };
      cursorPosRef.current = next;
      setCursorPos(next);
    }
    prevLoadingRef.current = isLoading;
  }, [isLoading, saleChips.length, rentChips.length]);

  // Keep cursor clamped if pattern shrinks externally
  useEffect(() => {
    setCursorPos((prev) => {
      const clampedSale = Math.min(prev.sale, saleChips.length);
      const clampedRent = Math.min(prev.rent, rentChips.length);
      if (clampedSale === prev.sale && clampedRent === prev.rent) return prev;
      const next = { sale: clampedSale, rent: clampedRent };
      cursorPosRef.current = next;
      return next;
    });
  }, [saleChips.length, rentChips.length]);

  const { fillerToolbarTags, infoToolbarTags } = useMemo(() => {
    const fillers: ToolbarTagItem[] = [];
    const info: ToolbarTagItem[] = [];
    const seenInfoIds = new Set<string>();

    const categoriesSource =
      Array.isArray(rule.categories) && rule.categories.length > 0
        ? rule.categories
        : BASE_TITLE_CATEGORIES;

    for (const cat of categoriesSource) {
      if (
        cat.id === "personalizat_1" ||
        cat.id === "personalizat_2" ||
        cat.id === "personalizat_3"
      ) {
        continue;
      }
      for (const tag of cat.tags) {
        if (tag.id === "distanta_si_nume_parc" || tag.id === "distanta_si_nume_atractie") {
          continue;
        }
        const displayLabel = getCategoryTagDisplayLabel(tag.label, tag.token);
        if (cat.id === "fillers") {
          fillers.push({
            id: tag.id,
            label: displayLabel,
            token: tag.token,
            categoryId: cat.id,
            isFiller: true,
          });
        } else if (!seenInfoIds.has(tag.id)) {
          seenInfoIds.add(tag.id);
          info.push({
            id: tag.id,
            label: displayLabel,
            token: tag.token,
            categoryId: cat.id,
            isFiller: false,
          });
        }
      }
    }

    return { fillerToolbarTags: fillers, infoToolbarTags: info };
  }, [rule.categories]);

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
        return target === "sale"
          ? { ...prev, salePattern: serialized }
          : { ...prev, rentPattern: serialized };
      });
    },
    [onChangeRule]
  );

  const insertTokenAt = useCallback(
    (
      target: PatternTarget,
      token: string,
      categoryId: ChipCategoryKey,
      label: string,
      insertIdx: number,
      tagId?: string
    ) => {
      onChangeRule((prev) => {
        const currentPattern = target === "sale" ? prev.salePattern : prev.rentPattern;
        const chips = parsePatternToChips(currentPattern);

        // Non-filler tags can only be used once per pattern
        if (categoryId !== "fillers" && categoryId !== "connector") {
          const normTok = normalizeTokenKey(token.slice(1, -1));
          const alreadyExists = chips.some((c) => {
            if (tagId && c.tagId === tagId) return true;
            return normalizeTokenKey(c.rawToken.slice(1, -1)) === normTok;
          });
          if (alreadyExists) return prev;
        }

        const clamped = Math.max(0, Math.min(insertIdx, chips.length));
        const nextChips = [...chips];
        nextChips.splice(clamped, 0, {
          uid: `new_${Date.now()}_${clamped}`,
          rawToken: token,
          label,
          categoryId,
          tagId,
        });
        const serialized = serializeChipsToPattern(nextChips);
        return target === "sale"
          ? { ...prev, salePattern: serialized }
          : { ...prev, rentPattern: serialized };
      });

      const safeInsert = Math.max(0, insertIdx);
      setCursorPosFor(target, safeInsert + 1);
      setActiveTarget(target);
      focusTargetInput(target);
    },
    [focusTargetInput, onChangeRule, setCursorPosFor]
  );

  const removePatternChipAt = useCallback(
    (target: PatternTarget, idx: number) => {
      onChangeRule((prev) => {
        const currentPattern = target === "sale" ? prev.salePattern : prev.rentPattern;
        const chips = parsePatternToChips(currentPattern);
        if (idx < 0 || idx >= chips.length) return prev;
        const next = chips.filter((_, i) => i !== idx);
        const serialized = serializeChipsToPattern(next);
        return target === "sale"
          ? { ...prev, salePattern: serialized }
          : { ...prev, rentPattern: serialized };
      });

      const prevCursor = cursorPosRef.current[target];
      if (idx < prevCursor) {
        setCursorPosFor(target, prevCursor - 1);
      }
    },
    [onChangeRule, setCursorPosFor]
  );

  const commitCustomWord = useCallback(
    (target: PatternTarget, rawText: string) => {
      const trimmed = rawText.replace(/[\[\]]/g, "").trim();
      if (!trimmed) return;

      const targetCursor = Math.max(0, cursorPosRef.current[target]);
      onChangeRule((prev) => {
        const currentPattern = target === "sale" ? prev.salePattern : prev.rentPattern;
        const chips = parsePatternToChips(currentPattern);
        const clamped = Math.max(0, Math.min(targetCursor, chips.length));
        const nextChips = [...chips];
        nextChips.splice(clamped, 0, {
          uid: `word_${Date.now()}_${clamped}`,
          rawToken: `[${trimmed}]`,
          label: trimmed.toLowerCase(),
          categoryId: "connector",
        });
        const serialized = serializeChipsToPattern(nextChips);
        return target === "sale"
          ? { ...prev, salePattern: serialized }
          : { ...prev, rentPattern: serialized };
      });

      setCursorPosFor(target, targetCursor + 1);

      if (target === "sale") setSaleCustomInput("");
      else setRentCustomInput("");
    },
    [onChangeRule, setCursorPosFor]
  );

  const computeClosestIndex = (
    elements: Array<HTMLElement | null>,
    clientX: number,
    clientY: number,
    fallbackIdx: number
  ): number => {
    let bestIdx = fallbackIdx;
    let bestScore = Infinity;

    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
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

    return bestIdx;
  };

  const computeInsertionIndex = (
    elements: Array<HTMLElement | null>,
    clientX: number,
    clientY: number
  ): number => {
    const items: Array<{ idx: number; rect: DOMRect }> = [];
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      if (!el) continue;
      items.push({ idx: i, rect: el.getBoundingClientRect() });
    }
    if (items.length === 0) return 0;

    // Group elements into visual rows by vertical overlap
    const rows: Array<{ top: number; bottom: number; items: Array<{ idx: number; rect: DOMRect }> }> =
      [];
    for (const item of items) {
      const cy = (item.rect.top + item.rect.bottom) / 2;
      let targetRow = rows.find((r) => cy >= r.top - 8 && cy <= r.bottom + 8);
      if (!targetRow) {
        targetRow = { top: item.rect.top, bottom: item.rect.bottom, items: [] };
        rows.push(targetRow);
      } else {
        targetRow.top = Math.min(targetRow.top, item.rect.top);
        targetRow.bottom = Math.max(targetRow.bottom, item.rect.bottom);
      }
      targetRow.items.push(item);
    }

    if (clientY < rows[0].top - 8) return 0;
    const lastRow = rows[rows.length - 1];
    if (clientY > lastRow.bottom + 8) return items.length;

    let closestRow = rows[0];
    let bestRowDist = Infinity;
    for (const row of rows) {
      const dist =
        clientY >= row.top && clientY <= row.bottom
          ? 0
          : Math.min(Math.abs(clientY - row.top), Math.abs(clientY - row.bottom));
      if (dist < bestRowDist) {
        bestRowDist = dist;
        closestRow = row;
      }
    }

    const sortedRowItems = [...closestRow.items].sort((a, b) => a.rect.left - b.rect.left);
    for (const item of sortedRowItems) {
      const midX = (item.rect.left + item.rect.right) / 2;
      if (clientX < midX) {
        return item.idx;
      }
    }

    return sortedRowItems[sortedRowItems.length - 1].idx + 1;
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
      let dropInsertIdx: number | null = null;

      if (pending.kind === "pattern-chip") {
        const chipEls = patternChipRefs.current[pending.patternTarget] || [];
        overIdx = computeClosestIndex(chipEls, e.clientX, e.clientY, pending.fromIdx);
      } else if (pending.kind === "toolbar-tag") {
        const boxEl = patternBoxRefs.current[pending.patternTarget];
        if (boxEl) {
          const rect = boxEl.getBoundingClientRect();
          const insideBox =
            e.clientX >= rect.left - 18 &&
            e.clientX <= rect.right + 18 &&
            e.clientY >= rect.top - 22 &&
            e.clientY <= rect.bottom + 14;
          if (insideBox) {
            const chipEls = patternChipRefs.current[pending.patternTarget] || [];
            dropInsertIdx = computeInsertionIndex(chipEls, e.clientX, e.clientY);
          }
        }
      }

      const nextState: ActiveDragState = {
        kind: pending.kind,
        patternTarget: pending.patternTarget,
        fromIdx: pending.fromIdx,
        overIdx,
        dropInsertIdx,
        token: pending.token,
        tagId: pending.tagId,
        isFiller: pending.isFiller,
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

      if (active) {
        if (active.kind === "pattern-chip" && active.fromIdx !== active.overIdx) {
          movePatternChip(active.patternTarget, active.fromIdx, active.overIdx);
        } else if (
          active.kind === "toolbar-tag" &&
          active.dropInsertIdx !== null &&
          active.token
        ) {
          insertTokenAt(
            active.patternTarget,
            active.token,
            active.categoryKey,
            active.label,
            active.dropInsertIdx,
            active.tagId
          );
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
  }, [insertTokenAt, movePatternChip]);

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

  const renderWysiwygTitleEditor = (
    target: PatternTarget,
    heading: string,
    previewLabel: string,
    defaultPattern: string,
    chips: ParsedPatternChip[],
    customInput: string,
    setCustomInput: React.Dispatch<React.SetStateAction<string>>,
    inputRef: React.RefObject<HTMLInputElement | null>,
    preview: string
  ) => {
    const isActive = activeTarget === target;
    const clampedCursor = Math.max(0, Math.min(cursorPos[target], chips.length));
    const isToolbarHoveringBox =
      dragState?.kind === "toolbar-tag" &&
      dragState.patternTarget === target &&
      dragState.dropInsertIdx !== null;
    const toolbarDropIdx = isToolbarHoveringBox ? dragState.dropInsertIdx : null;

    patternChipRefs.current[target] = [];

    // Compute which non-filler tags are already used in this pattern
    const usedTagIds = new Set<string>();
    const usedNormTokens = new Set<string>();
    for (const chip of chips) {
      if (chip.categoryId === "fillers" || chip.categoryId === "connector") continue;
      if (chip.tagId) usedTagIds.add(chip.tagId);
      usedNormTokens.add(normalizeTokenKey(chip.rawToken.slice(1, -1)));
    }

    const remainingInfoTags = infoToolbarTags.filter((tag) => {
      if (usedTagIds.has(tag.id)) return false;
      const normTok = normalizeTokenKey(tag.token.slice(1, -1));
      if (usedNormTokens.has(normTok)) return false;
      return true;
    });

    const renderCursorInput = () => {
      const isAtEnd = clampedCursor === chips.length;
      const showCompact = !isAtEnd && customInput === "";
      const dynamicWidth =
        !isAtEnd && customInput !== ""
          ? `${Math.max(28, customInput.length * 7.5 + 16)}px`
          : undefined;

      return (
        <input
          key="pattern-cursor-input"
          ref={inputRef}
          type="text"
          value={customInput}
          style={dynamicWidth ? { width: dynamicWidth } : undefined}
          onFocus={() => setActiveTarget(target)}
          onChange={(e) => setCustomInput(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            const el = e.currentTarget;
            if (e.key === "Enter" || e.key === ",") {
              if (customInput.trim()) {
                e.preventDefault();
                commitCustomWord(target, customInput);
              }
            } else if (e.key === "Backspace" && customInput === "" && clampedCursor > 0) {
              e.preventDefault();
              removePatternChipAt(target, clampedCursor - 1);
              focusTargetInput(target);
            } else if (e.key === "Delete" && customInput === "" && clampedCursor < chips.length) {
              e.preventDefault();
              removePatternChipAt(target, clampedCursor);
              focusTargetInput(target);
            } else if (
              e.key === "ArrowLeft" &&
              el.selectionStart === 0 &&
              el.selectionEnd === 0 &&
              clampedCursor > 0
            ) {
              e.preventDefault();
              setCursorPosFor(target, clampedCursor - 1);
              focusTargetInput(target);
            } else if (
              e.key === "ArrowRight" &&
              el.selectionStart === customInput.length &&
              el.selectionEnd === customInput.length &&
              clampedCursor < chips.length
            ) {
              e.preventDefault();
              setCursorPosFor(target, clampedCursor + 1);
              focusTargetInput(target);
            }
          }}
          onBlur={() => {
            if (customInput.trim()) {
              commitCustomWord(target, customInput);
            }
          }}
          placeholder={
            chips.length === 0
              ? "Click sau trage tag-urile din bara de jos, ori scrie un cuvânt + Enter..."
              : isAtEnd
              ? "cuvânt legătură + Enter..."
              : ""
          }
          className={`${
            chips.length === 0
              ? "flex-1 min-w-[200px] px-1.5"
              : isAtEnd
              ? "flex-1 min-w-[120px] px-1.5"
              : showCompact
              ? `w-2.5 min-w-[10px] px-0 ${
                  isActive ? "border-l-2 border-[#BE9662]" : "border-l-2 border-transparent"
                }`
              : "px-1"
          } h-7 text-xs text-gray-800 placeholder:text-gray-400 border-0 focus:outline-none focus:ring-0 bg-transparent`}
        />
      );
    };

    const renderDropBar = (slot: number) => (
      <span
        key={`drop-bar-${slot}`}
        className="inline-block w-0.5 h-6 bg-[#BE9662] rounded-full shrink-0"
      />
    );

    const nodes: React.ReactNode[] = [];
    for (let slot = 0; slot <= chips.length; slot++) {
      if (toolbarDropIdx === slot) {
        nodes.push(renderDropBar(slot));
      }
      if (clampedCursor === slot) {
        nodes.push(renderCursorInput());
      }
      if (slot < chips.length) {
        const chip = chips[slot];
        const theme = CATEGORY_THEME[chip.categoryId] || CATEGORY_THEME.connector;
        const isBeingDragged =
          dragState?.kind === "pattern-chip" &&
          dragState.patternTarget === target &&
          dragState.fromIdx === slot;
        const isDropTarget =
          dragState?.kind === "pattern-chip" &&
          dragState.patternTarget === target &&
          dragState.overIdx === slot &&
          dragState.fromIdx !== slot;

        nodes.push(
          <div
            key={chip.uid}
            ref={(el) => {
              patternChipRefs.current[target][slot] = el;
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              startPointerDrag(e, {
                kind: "pattern-chip",
                fromIdx: slot,
                patternTarget: target,
                label: chip.label,
                categoryKey: chip.categoryId,
              });
            }}
            onClick={(e) => {
              e.stopPropagation();
              if (suppressNextClickRef.current) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const nextIdx = e.clientX < rect.left + rect.width / 2 ? slot : slot + 1;
              setActiveTarget(target);
              setCursorPosFor(target, nextIdx);
              focusTargetInput(target);
            }}
            title="Click pentru a poziționa cursorul · Trage pentru reordonare · × pentru ștergere"
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
                removePatternChipAt(target, slot);
              }}
              title="Elimină tag"
              className={`ml-0.5 rounded-sm p-0.5 transition-colors cursor-pointer ${theme.removeBtn}`}
            >
              <X size={12} />
            </button>
          </div>
        );
      }
    }

    return (
      <div
        className={`p-3.5 rounded-xl border transition-colors ${
          isActive || isToolbarHoveringBox
            ? "border-[#BE9662] bg-amber-50/20"
            : "border-gray-200 bg-gray-50/40"
        }`}
      >
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-xs font-semibold text-gray-900">{heading}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onChangeRule((prev) =>
                  target === "sale"
                    ? { ...prev, salePattern: defaultPattern }
                    : { ...prev, rentPattern: defaultPattern }
                );
                setCursorPosFor(target, parsePatternToChips(defaultPattern).length);
              }}
              className="text-[11px] font-medium text-gray-500 hover:text-gray-800 cursor-pointer"
            >
              Model exemplu
            </button>
            <button
              type="button"
              onClick={() => {
                onChangeRule((prev) =>
                  target === "sale"
                    ? { ...prev, salePattern: "" }
                    : { ...prev, rentPattern: "" }
                );
                setCursorPosFor(target, 0);
              }}
              className="text-[11px] font-medium text-gray-400 hover:text-rose-600 flex items-center gap-1 cursor-pointer"
            >
              <Eraser size={11} />
              <span>Golește</span>
            </button>
          </div>
        </div>

        {/* Unified WYSIWYG Editor Box: Canvas on top, Toolbar at bottom */}
        <div
          className={`rounded-lg border overflow-hidden bg-white transition-colors ${
            isToolbarHoveringBox
              ? "border-[#BE9662] ring-2 ring-[#BE9662]/40"
              : isActive
              ? "border-[#BE9662] ring-1 ring-[#BE9662]"
              : "border-gray-300 hover:border-gray-400"
          }`}
        >
          {/* Title Creation Area */}
          <div
            ref={(el) => {
              patternBoxRefs.current[target] = el;
            }}
            onClick={(e) => {
              setActiveTarget(target);
              const chipEls = patternChipRefs.current[target] || [];
              const nextIdx = computeInsertionIndex(chipEls, e.clientX, e.clientY);
              setCursorPosFor(target, nextIdx);
              focusTargetInput(target);
            }}
            className="min-h-[54px] h-auto p-2.5 bg-white flex flex-wrap gap-1.5 items-center cursor-text"
          >
            {nodes}
          </div>

          {/* WYSIWYG Bottom Toolbar */}
          <div className="border-t border-gray-200 bg-gray-50/90 px-2.5 py-2 flex flex-wrap items-center gap-1.5">
            {/* Reusable Fillers */}
            {fillerToolbarTags.map((tag) => {
              const theme = CATEGORY_THEME.fillers;
              return (
                <button
                  key={`filler_${target}_${tag.id}`}
                  type="button"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    startPointerDrag(e, {
                      kind: "toolbar-tag",
                      patternTarget: target,
                      fromIdx: -1,
                      token: tag.token,
                      tagId: tag.id,
                      isFiller: true,
                      label: tag.label,
                      categoryKey: tag.categoryId,
                    });
                  }}
                  onClick={() => {
                    if (suppressNextClickRef.current) return;
                    insertTokenAt(
                      target,
                      tag.token,
                      tag.categoryId,
                      tag.label,
                      cursorPosRef.current[target],
                      tag.id
                    );
                  }}
                  title="Click pentru a insera la cursor sau trage în zona titlului (poate fi folosit ori de câte ori)"
                  className={`inline-flex items-center px-2 py-1 rounded-md border text-[11px] font-medium select-none touch-none transition-all cursor-pointer ${theme.chip} ${theme.chipHover}`}
                >
                  <span>{tag.label}</span>
                </button>
              );
            })}

            <div className="w-px h-5 bg-gray-300 mx-0.5 shrink-0" />

            {/* Single-Use Info Tags */}
            {remainingInfoTags.length > 0 ? (
              remainingInfoTags.map((tag) => {
                const theme = CATEGORY_THEME[tag.categoryId] || CATEGORY_THEME.connector;
                const isBeingDragged =
                  dragState?.kind === "toolbar-tag" &&
                  dragState.patternTarget === target &&
                  dragState.tagId === tag.id;

                return (
                  <button
                    key={`tag_${target}_${tag.id}`}
                    type="button"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      startPointerDrag(e, {
                        kind: "toolbar-tag",
                        patternTarget: target,
                        fromIdx: -1,
                        token: tag.token,
                        tagId: tag.id,
                        isFiller: false,
                        label: tag.label,
                        categoryKey: tag.categoryId,
                      });
                    }}
                    onClick={() => {
                      if (suppressNextClickRef.current) return;
                      insertTokenAt(
                        target,
                        tag.token,
                        tag.categoryId,
                        tag.label,
                        cursorPosRef.current[target],
                        tag.id
                      );
                    }}
                    title="Click pentru a insera la cursor sau trage în zona titlului (utilizare unică)"
                    className={`inline-flex items-center px-2 py-1 rounded-md border text-[11px] font-medium select-none touch-none transition-all cursor-pointer ${
                      theme.chip
                    } ${theme.chipHover} ${isBeingDragged ? "opacity-25 scale-95" : ""}`}
                  >
                    <span>{tag.label}</span>
                  </button>
                );
              })
            ) : (
              <span className="text-[11px] text-gray-400 italic px-1">
                toate tag-urile au fost adăugate
              </span>
            )}
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] bg-white border border-gray-200 rounded-lg px-3 py-2">
          <div className="min-w-0">
            <span className="font-semibold text-gray-500 mr-1.5">{previewLabel}</span>
            <span className="font-semibold text-[#051D35] break-words">
              {preview || "(Titlu gol — adăugați tag-uri din bara de instrumente)"}
            </span>
          </div>
          <span
            className={`shrink-0 font-mono text-[10px] px-1.5 py-0.5 rounded ${
              preview.length > rule.maxChars || preview.length < rule.minChars
                ? "bg-amber-50 text-amber-700 border border-amber-200"
                : "bg-emerald-50 text-emerald-700 border border-emerald-200"
            }`}
          >
            {preview.length} / {rule.maxChars} car.
          </span>
        </div>
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
                  Controlează numărul minim și maxim de caractere pentru titlul generat automat pe baza șablonului configurat mai jos.
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

          {/* Sale & Rent WYSIWYG Pattern Builders */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-2xs space-y-4">
            <div className="pb-3 border-b border-gray-100">
              <h2 className="font-title text-xs font-semibold text-gray-900">
                Șabloane construcție titlu (Vânzare & Închiriere)
              </h2>
              <p className="text-[11px] text-gray-500 mt-0.5">
                Poziționați cursorul în zona titlului și dați click pe tag-urile din bara de jos sau trageți-le direct în poziția dorită. Separatorii pot fi folosiți nelimitat, iar celelalte tag-uri o singură dată. Puteți tasta cuvinte de legătură (ex: <em className="text-gray-700">De</em>, <em className="text-gray-700">la</em>, <em className="text-gray-700">si</em>) urmate de <kbd className="px-1 py-0.5 bg-gray-100 border border-gray-200 rounded text-[10px]">Enter</kbd>.
              </p>
            </div>

            {renderWysiwygTitleEditor(
              "sale",
              "Format titlu — Proprietăți de Vânzare",
              "Previzualizare Vânzare:",
              DEFAULT_SALE_PATTERN,
              saleChips,
              saleCustomInput,
              setSaleCustomInput,
              saleInputRef,
              salePreview
            )}

            {renderWysiwygTitleEditor(
              "rent",
              "Format titlu — Proprietăți de Închiriere",
              "Previzualizare Închiriere:",
              DEFAULT_RENT_PATTERN,
              rentChips,
              rentCustomInput,
              setRentCustomInput,
              rentInputRef,
              rentPreview
            )}
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
