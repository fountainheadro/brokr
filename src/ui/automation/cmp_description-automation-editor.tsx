import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BadgePercent,
  Building2,
  Bus,
  Car,
  CheckCircle2,
  AlertCircle,
  Compass,
  Eraser,
  FileText,
  GripVertical,
  Home,
  LayoutGrid,
  Minus,
  Plus,
  RotateCcw,
  Save,
  Space,
  Sparkles,
  Type,
  X,
} from "lucide-react";
import {
  DESCRIPTION_SECTION_DEFS,
  DescriptionAutomationRule,
  DescriptionGridItem,
  DescriptionGridRow,
  DescriptionItemKind,
  DescriptionPatternConfig,
  DescriptionSectionId,
  DescriptionSectionLayout,
  TitleAutomationRule,
  createEmptyDescriptionPattern,
  createPresetDescriptionPattern,
  normalizeDescriptionAutomationRule,
} from "../../core/automation/typ_title-automation";

type PatternTarget = "sale" | "rent";

interface CmpDescriptionAutomationEditorProps {
  mode: "agency" | "platform_default";
  rule: TitleAutomationRule;
  onChangeRule: (next: TitleAutomationRule) => void;
  isCustomOverride?: boolean;
  isLoading: boolean;
  isSaving: boolean;
  saveSuccess: boolean;
  error: string | null;
  onSave: (e: React.FormEvent) => void;
  onReset: () => void;
}

interface DropTargetSpec {
  target: PatternTarget;
  sectionId: DescriptionSectionId;
  placement: "empty" | "new-row" | "col-slot";
  rowIdx: number;
  colIdx: number;
}

interface PendingDrag {
  source: "toolbar" | "grid";
  target: PatternTarget;
  sectionId: DescriptionSectionId;
  kind: DescriptionItemKind;
  tagId?: string;
  label: string;
  itemId?: string;
  fromRowIdx?: number;
  fromColIdx?: number;
  startX: number;
  startY: number;
  started: boolean;
}

interface ActiveDrag {
  source: "toolbar" | "grid";
  target: PatternTarget;
  sectionId: DescriptionSectionId;
  kind: DescriptionItemKind;
  tagId?: string;
  label: string;
  itemId?: string;
  fromRowIdx?: number;
  fromColIdx?: number;
  clientX: number;
  clientY: number;
  hoveredSectionKey: string | null;
  activeDrop: DropTargetSpec | null;
}

const DRAG_THRESHOLD_PX = 5;
const MAX_COLS_PER_ROW = 4;

const SECTION_ICONS: Record<
  DescriptionSectionId,
  React.ComponentType<{ size?: number; className?: string }>
> = {
  pret_conditii: BadgePercent,
  introducere: FileText,
  apartament: Home,
  bloc: Building2,
  imprejurimi: Compass,
  transport: Bus,
  parcare: Car,
};

const SECTION_ACCENT: Record<
  DescriptionSectionId,
  { chip: string; chipHover: string; iconBg: string }
> = {
  pret_conditii: {
    chip: "bg-amber-50 text-amber-900 border-amber-200",
    chipHover: "hover:bg-amber-100/80 hover:border-amber-300",
    iconBg: "bg-amber-50 text-amber-700 border-amber-200",
  },
  introducere: {
    chip: "bg-blue-50 text-blue-900 border-blue-200",
    chipHover: "hover:bg-blue-100/80 hover:border-blue-300",
    iconBg: "bg-blue-50 text-blue-700 border-blue-200",
  },
  apartament: {
    chip: "bg-emerald-50 text-emerald-900 border-emerald-200",
    chipHover: "hover:bg-emerald-100/80 hover:border-emerald-300",
    iconBg: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  bloc: {
    chip: "bg-indigo-50 text-indigo-900 border-indigo-200",
    chipHover: "hover:bg-indigo-100/80 hover:border-indigo-300",
    iconBg: "bg-indigo-50 text-indigo-700 border-indigo-200",
  },
  imprejurimi: {
    chip: "bg-lime-50 text-lime-900 border-lime-300",
    chipHover: "hover:bg-lime-100/80 hover:border-lime-400",
    iconBg: "bg-lime-50 text-lime-700 border-lime-300",
  },
  transport: {
    chip: "bg-cyan-50 text-cyan-900 border-cyan-200",
    chipHover: "hover:bg-cyan-100/80 hover:border-cyan-300",
    iconBg: "bg-cyan-50 text-cyan-700 border-cyan-200",
  },
  parcare: {
    chip: "bg-purple-50 text-purple-900 border-purple-200",
    chipHover: "hover:bg-purple-100/80 hover:border-purple-300",
    iconBg: "bg-purple-50 text-purple-700 border-purple-200",
  },
};

function makeUid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function getSectionKey(target: PatternTarget, sectionId: DescriptionSectionId): string {
  return `${target}:${sectionId}`;
}

function isSameDrop(a: DropTargetSpec | null, b: DropTargetSpec | null): boolean {
  if (!a || !b) return false;
  return (
    a.target === b.target &&
    a.sectionId === b.sectionId &&
    a.placement === b.placement &&
    a.rowIdx === b.rowIdx &&
    a.colIdx === b.colIdx
  );
}

export const CmpDescriptionAutomationEditor: React.FC<CmpDescriptionAutomationEditorProps> = ({
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
  const descriptionLayout: DescriptionAutomationRule = useMemo(
    () => normalizeDescriptionAutomationRule(rule.descriptionLayout),
    [rule.descriptionLayout]
  );

  const ruleRef = useRef(rule);
  ruleRef.current = rule;
  const descLayoutRef = useRef(descriptionLayout);
  descLayoutRef.current = descriptionLayout;

  const pendingDragRef = useRef<PendingDrag | null>(null);
  const activeDragRef = useRef<ActiveDrag | null>(null);
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);

  const updateDescriptionLayout = useCallback(
    (updater: (prev: DescriptionAutomationRule) => DescriptionAutomationRule) => {
      const currentDesc = descLayoutRef.current;
      const nextDesc = updater(currentDesc);
      onChangeRule({
        ...ruleRef.current,
        descriptionLayout: nextDesc,
      });
    },
    [onChangeRule]
  );

  const updateSection = useCallback(
    (
      target: PatternTarget,
      sectionId: DescriptionSectionId,
      updater: (sec: DescriptionSectionLayout) => DescriptionSectionLayout
    ) => {
      updateDescriptionLayout((prev) => {
        const pattern = prev[target];
        const nextSections = pattern.sections.map((sec) =>
          sec.sectionId === sectionId ? updater(sec) : sec
        );
        return {
          ...prev,
          [target]: { ...pattern, sections: nextSections },
        };
      });
    },
    [updateDescriptionLayout]
  );

  const setPattern = useCallback(
    (target: PatternTarget, nextPattern: DescriptionPatternConfig) => {
      updateDescriptionLayout((prev) => ({
        ...prev,
        [target]: nextPattern,
      }));
    },
    [updateDescriptionLayout]
  );

  const toggleSectionEnabled = useCallback(
    (target: PatternTarget, sectionId: DescriptionSectionId) => {
      updateSection(target, sectionId, (sec) => ({
        ...sec,
        enabled: !sec.enabled,
      }));
    },
    [updateSection]
  );

  const clearSection = useCallback(
    (target: PatternTarget, sectionId: DescriptionSectionId) => {
      updateSection(target, sectionId, (sec) => ({
        ...sec,
        rows: [],
      }));
    },
    [updateSection]
  );

  const removeItem = useCallback(
    (target: PatternTarget, sectionId: DescriptionSectionId, itemId: string) => {
      updateSection(target, sectionId, (sec) => {
        const nextRows = sec.rows
          .map((row) => ({
            ...row,
            columns: row.columns.filter((col) => col.id !== itemId),
          }))
          .filter((row) => row.columns.length > 0);
        return { ...sec, rows: nextRows };
      });
    },
    [updateSection]
  );

  const updateCustomText = useCallback(
    (target: PatternTarget, sectionId: DescriptionSectionId, itemId: string, nextText: string) => {
      updateSection(target, sectionId, (sec) => ({
        ...sec,
        rows: sec.rows.map((row) => ({
          ...row,
          columns: row.columns.map((col) =>
            col.id === itemId ? { ...col, customText: nextText } : col
          ),
        })),
      }));
    },
    [updateSection]
  );

  const appendToolbarItem = useCallback(
    (
      target: PatternTarget,
      sectionId: DescriptionSectionId,
      kind: DescriptionItemKind,
      label: string,
      tagId?: string
    ) => {
      updateSection(target, sectionId, (sec) => {
        if (
          kind === "subsection" &&
          tagId &&
          sec.rows.some((r) => r.columns.some((c) => c.kind === "subsection" && c.tagId === tagId))
        ) {
          return sec;
        }
        const newItem: DescriptionGridItem = {
          id: makeUid(`item_${sectionId}`),
          kind,
          label,
          ...(kind === "subsection" && tagId ? { tagId } : {}),
          ...(kind === "custom_text" ? { customText: "" } : {}),
        };

        if (sec.rows.length === 0) {
          return {
            ...sec,
            rows: [{ id: makeUid(`row_${sectionId}`), columns: [newItem] }],
          };
        }

        // Dividers and custom text get their own fresh row by default on click;
        // subsections/fillers append to the last row if it has < 2 columns, otherwise start a new row
        const lastRow = sec.rows[sec.rows.length - 1];
        const canShareLastRow =
          kind !== "divider" &&
          lastRow.columns.length < 2 &&
          !lastRow.columns.some((c) => c.kind === "divider");

        if (canShareLastRow) {
          return {
            ...sec,
            rows: sec.rows.map((row, idx) =>
              idx === sec.rows.length - 1 ? { ...row, columns: [...row.columns, newItem] } : row
            ),
          };
        }

        return {
          ...sec,
          rows: [...sec.rows, { id: makeUid(`row_${sectionId}`), columns: [newItem] }],
        };
      });
    },
    [updateSection]
  );

  const applyDrop = useCallback(
    (drag: ActiveDrag, drop: DropTargetSpec) => {
      if (drag.target !== drop.target || drag.sectionId !== drop.sectionId) return;

      updateSection(drop.target, drop.sectionId, (sec) => {
        let rows: DescriptionGridRow[] = sec.rows.map((r) => ({
          ...r,
          columns: [...r.columns],
        }));

        let itemToInsert: DescriptionGridItem | null = null;
        let adjustedRowIdx = drop.rowIdx;
        let adjustedColIdx = drop.colIdx;

        if (drag.source === "grid" && drag.itemId) {
          let foundRowIdx = -1;
          let foundColIdx = -1;
          for (let r = 0; r < rows.length; r++) {
            const cIdx = rows[r].columns.findIndex((c) => c.id === drag.itemId);
            if (cIdx !== -1) {
              foundRowIdx = r;
              foundColIdx = cIdx;
              itemToInsert = rows[r].columns[cIdx];
              break;
            }
          }
          if (!itemToInsert || foundRowIdx === -1) return sec;

          // If dropping on the exact same col-slot position, no-op
          if (
            drop.placement === "col-slot" &&
            foundRowIdx === drop.rowIdx &&
            (foundColIdx === drop.colIdx || foundColIdx + 1 === drop.colIdx)
          ) {
            return sec;
          }

          // Remove from source
          rows[foundRowIdx].columns.splice(foundColIdx, 1);
          const sourceRowBecameEmpty = rows[foundRowIdx].columns.length === 0;

          if (drop.placement === "col-slot") {
            if (foundRowIdx === drop.rowIdx && foundColIdx < drop.colIdx) {
              adjustedColIdx = Math.max(0, adjustedColIdx - 1);
            }
            if (sourceRowBecameEmpty) {
              rows.splice(foundRowIdx, 1);
              if (foundRowIdx < adjustedRowIdx) {
                adjustedRowIdx = Math.max(0, adjustedRowIdx - 1);
              }
            }
          } else if (drop.placement === "new-row") {
            if (sourceRowBecameEmpty) {
              rows.splice(foundRowIdx, 1);
              if (foundRowIdx < adjustedRowIdx) {
                adjustedRowIdx = Math.max(0, adjustedRowIdx - 1);
              }
            }
          }
        } else {
          // Toolbar item
          if (
            drag.kind === "subsection" &&
            drag.tagId &&
            rows.some((r) => r.columns.some((c) => c.kind === "subsection" && c.tagId === drag.tagId))
          ) {
            return sec;
          }
          itemToInsert = {
            id: makeUid(`item_${drop.sectionId}`),
            kind: drag.kind,
            label: drag.label,
            ...(drag.kind === "subsection" && drag.tagId ? { tagId: drag.tagId } : {}),
            ...(drag.kind === "custom_text" ? { customText: "" } : {}),
          };
        }

        if (!itemToInsert) return sec;

        if (drop.placement === "empty" || rows.length === 0) {
          return {
            ...sec,
            rows: [{ id: makeUid(`row_${drop.sectionId}`), columns: [itemToInsert] }],
          };
        }

        if (drop.placement === "new-row") {
          const insertAt = Math.max(0, Math.min(rows.length, adjustedRowIdx));
          rows.splice(insertAt, 0, {
            id: makeUid(`row_${drop.sectionId}`),
            columns: [itemToInsert],
          });
          return { ...sec, rows };
        }

        // placement === "col-slot"
        const targetRow = rows[adjustedRowIdx];
        if (!targetRow) {
          rows.push({ id: makeUid(`row_${drop.sectionId}`), columns: [itemToInsert] });
          return { ...sec, rows };
        }
        if (targetRow.columns.length >= MAX_COLS_PER_ROW) {
          return sec;
        }
        const insertColAt = Math.max(0, Math.min(targetRow.columns.length, adjustedColIdx));
        targetRow.columns.splice(insertColAt, 0, itemToInsert);
        return { ...sec, rows };
      });
    },
    [updateSection]
  );

  // Hit-test section canvas and drop spots under pointer
  const resolvePointerHit = useCallback(
    (
      clientX: number,
      clientY: number,
      target: PatternTarget,
      sectionId: DescriptionSectionId
    ): { hoveredSectionKey: string | null; activeDrop: DropTargetSpec | null } => {
      const expectedSecKey = getSectionKey(target, sectionId);
      const canvasEl = document.querySelector<HTMLElement>(
        `[data-desc-section-canvas="${expectedSecKey}"]`
      );
      if (!canvasEl) return { hoveredSectionKey: null, activeDrop: null };

      const rect = canvasEl.getBoundingClientRect();
      const pad = 18;
      const insideCanvas =
        clientX >= rect.left - pad &&
        clientX <= rect.right + pad &&
        clientY >= rect.top - pad &&
        clientY <= rect.bottom + pad;

      if (!insideCanvas) {
        return { hoveredSectionKey: null, activeDrop: null };
      }

      const dropNodes = Array.from(
        canvasEl.querySelectorAll<HTMLElement>("[data-desc-drop-placement]")
      );
      if (dropNodes.length === 0) {
        return {
          hoveredSectionKey: expectedSecKey,
          activeDrop: {
            target,
            sectionId,
            placement: "empty",
            rowIdx: 0,
            colIdx: 0,
          },
        };
      }

      // First check direct hit on a drop zone
      for (const node of dropNodes) {
        const r = node.getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
          const placement = node.dataset.descDropPlacement as DropTargetSpec["placement"];
          const rowIdx = Number(node.dataset.descDropRow ?? 0);
          const colIdx = Number(node.dataset.descDropCol ?? 0);
          return {
            hoveredSectionKey: expectedSecKey,
            activeDrop: { target, sectionId, placement, rowIdx, colIdx },
          };
        }
      }

      // Otherwise choose closest drop zone inside the section canvas so hovering anywhere in the section snaps cleanly
      let bestNode: HTMLElement | null = null;
      let bestDistSq = Number.POSITIVE_INFINITY;
      for (const node of dropNodes) {
        const r = node.getBoundingClientRect();
        const clampedX = Math.max(r.left, Math.min(clientX, r.right));
        const clampedY = Math.max(r.top, Math.min(clientY, r.bottom));
        const dx = clientX - clampedX;
        const dy = clientY - clampedY;
        const distSq = dx * dx + dy * dy;
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          bestNode = node;
        }
      }

      if (bestNode) {
        const placement = bestNode.dataset.descDropPlacement as DropTargetSpec["placement"];
        const rowIdx = Number(bestNode.dataset.descDropRow ?? 0);
        const colIdx = Number(bestNode.dataset.descDropCol ?? 0);
        return {
          hoveredSectionKey: expectedSecKey,
          activeDrop: { target, sectionId, placement, rowIdx, colIdx },
        };
      }

      return { hoveredSectionKey: expectedSecKey, activeDrop: null };
    },
    []
  );

  // Global pointer move/up listeners for smooth drag & drop
  useEffect(() => {
    const handlePointerMove = (ev: PointerEvent) => {
      const pending = pendingDragRef.current;
      if (!pending) return;

      if (!pending.started) {
        const dx = ev.clientX - pending.startX;
        const dy = ev.clientY - pending.startY;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        pending.started = true;
      }

      ev.preventDefault();
      const hit = resolvePointerHit(ev.clientX, ev.clientY, pending.target, pending.sectionId);
      const nextDrag: ActiveDrag = {
        source: pending.source,
        target: pending.target,
        sectionId: pending.sectionId,
        kind: pending.kind,
        tagId: pending.tagId,
        label: pending.label,
        itemId: pending.itemId,
        fromRowIdx: pending.fromRowIdx,
        fromColIdx: pending.fromColIdx,
        clientX: ev.clientX,
        clientY: ev.clientY,
        hoveredSectionKey: hit.hoveredSectionKey,
        activeDrop: hit.activeDrop,
      };
      activeDragRef.current = nextDrag;
      setActiveDrag(nextDrag);
    };

    const handlePointerUp = () => {
      const pending = pendingDragRef.current;
      const currentDrag = activeDragRef.current;

      pendingDragRef.current = null;
      activeDragRef.current = null;
      setActiveDrag(null);

      if (!pending) return;

      if (!pending.started) {
        // Simple click on toolbar item -> append cleanly
        if (pending.source === "toolbar") {
          appendToolbarItem(
            pending.target,
            pending.sectionId,
            pending.kind,
            pending.label,
            pending.tagId
          );
        }
        return;
      }

      if (currentDrag && currentDrag.activeDrop) {
        applyDrop(currentDrag, currentDrag.activeDrop);
      }
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [appendToolbarItem, applyDrop, resolvePointerHit]);

  const startToolbarPointerDown = (
    e: React.PointerEvent,
    target: PatternTarget,
    sectionId: DescriptionSectionId,
    kind: DescriptionItemKind,
    label: string,
    tagId?: string
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();
    pendingDragRef.current = {
      source: "toolbar",
      target,
      sectionId,
      kind,
      tagId,
      label,
      startX: e.clientX,
      startY: e.clientY,
      started: false,
    };
  };

  const startGridItemPointerDown = (
    e: React.PointerEvent,
    target: PatternTarget,
    sectionId: DescriptionSectionId,
    item: DescriptionGridItem,
    rowIdx: number,
    colIdx: number
  ) => {
    if (e.button !== 0) return;
    // Allow interacting with inputs or delete buttons without initiating drag
    const targetEl = e.target as HTMLElement | null;
    if (targetEl?.closest("input, textarea, button")) return;
    e.preventDefault();
    pendingDragRef.current = {
      source: "grid",
      target,
      sectionId,
      kind: item.kind,
      tagId: item.tagId,
      label: item.label,
      itemId: item.id,
      fromRowIdx: rowIdx,
      fromColIdx: colIdx,
      startX: e.clientX,
      startY: e.clientY,
      started: false,
    };
  };

  const renderSectionCard = (target: PatternTarget, secLayout: DescriptionSectionLayout) => {
    const def = DESCRIPTION_SECTION_DEFS.find((d) => d.id === secLayout.sectionId);
    if (!def) return null;

    const IconComp = SECTION_ICONS[def.id];
    const accent = SECTION_ACCENT[def.id];
    const secKey = getSectionKey(target, def.id);
    const availableTags = target === "rent" ? def.rentTags : def.saleTags;

    const usedSubsectionIds = new Set<string>();
    for (const row of secLayout.rows) {
      for (const col of row.columns) {
        if (col.kind === "subsection" && col.tagId) {
          usedSubsectionIds.add(col.tagId);
        }
      }
    }
    const remainingTags = availableTags.filter((t) => !usedSubsectionIds.has(t.id));

    const isDragForThisSection =
      activeDrag !== null &&
      activeDrag.target === target &&
      activeDrag.sectionId === def.id;
    const isHoveringThisSection =
      isDragForThisSection && activeDrag.hoveredSectionKey === secKey;

    const totalPlacedItems = secLayout.rows.reduce((sum, r) => sum + r.columns.length, 0);

    return (
      <div
        key={secKey}
        className={`rounded-xl border transition-colors ${
          secLayout.enabled
            ? isHoveringThisSection
              ? "border-[#BE9662] bg-white shadow-sm ring-1 ring-[#BE9662]/30"
              : "border-gray-200 bg-white"
            : "border-gray-200/80 bg-gray-50/70"
        }`}
      >
        {/* Section Header with Enable/Disable Switch */}
        <div className="px-4 py-3 flex items-center justify-between gap-3 border-b border-gray-100">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`w-7 h-7 rounded-md border flex items-center justify-center shrink-0 ${
                secLayout.enabled
                  ? accent.iconBg
                  : "bg-gray-100 text-gray-400 border-gray-200"
              }`}
            >
              <IconComp size={14} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs font-bold tracking-tight ${
                    secLayout.enabled ? "text-[#051D35]" : "text-gray-400 line-through"
                  }`}
                >
                  {def.label}
                </span>
                {secLayout.enabled && (
                  <span className="text-[10px] font-medium text-gray-400">
                    {secLayout.rows.length === 0
                      ? "1 rând × 1 coloană (gol)"
                      : `${secLayout.rows.length} ${secLayout.rows.length === 1 ? "rând" : "rânduri"} · ${totalPlacedItems} ${totalPlacedItems === 1 ? "element" : "elemente"}`}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {secLayout.enabled && totalPlacedItems > 0 && (
              <button
                type="button"
                onClick={() => clearSection(target, def.id)}
                className="text-[11px] font-medium text-gray-400 hover:text-rose-600 flex items-center gap-1 transition-colors cursor-pointer"
                title="Golește secțiunea"
              >
                <Eraser size={11} />
                <span>Golește</span>
              </button>
            )}

            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
              <span className="text-[11px] font-semibold text-gray-500">
                {secLayout.enabled ? "Activ" : "Dezactivat"}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={secLayout.enabled}
                onClick={() => toggleSectionEnabled(target, def.id)}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                  secLayout.enabled ? "bg-[#051D35]" : "bg-gray-300"
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-xs transition-transform ${
                    secLayout.enabled ? "translate-x-[18px]" : "translate-x-[3px]"
                  }`}
                />
              </button>
            </label>
          </div>
        </div>

        {/* Body */}
        {!secLayout.enabled ? (
          <div className="px-4 py-3 text-[11px] text-gray-400 italic">
            Secțiunea „{def.label}” este dezactivată — nu va fi afișată pe pagina de detalii a proprietății și nici pe pagina externă distribuită.
          </div>
        ) : (
          <div className="p-3.5 space-y-3">
            {/* Dynamic Grid Canvas */}
            <div
              data-desc-section-canvas={secKey}
              className={`rounded-lg border p-2.5 transition-all min-h-[76px] ${
                isHoveringThisSection
                  ? "border-[#BE9662] bg-[#FAF6F0]/60"
                  : "border-dashed border-gray-300 bg-gray-50/50"
              }`}
            >
              {secLayout.rows.length === 0 ? (
                /* Initial 1 Row x 1 Column Drop Spot */
                <div
                  data-desc-drop-placement="empty"
                  data-desc-drop-row={0}
                  data-desc-drop-col={0}
                  className={`w-full min-h-[56px] rounded-md border-2 border-dashed flex items-center justify-center gap-2 px-3 py-3 text-xs transition-all ${
                    isHoveringThisSection &&
                    isSameDrop(activeDrag?.activeDrop ?? null, {
                      target,
                      sectionId: def.id,
                      placement: "empty",
                      rowIdx: 0,
                      colIdx: 0,
                    })
                      ? "border-[#BE9662] bg-[#BE9662]/15 text-[#051D35] font-semibold"
                      : "border-gray-300 bg-white/80 text-gray-400"
                  }`}
                >
                  <Plus size={14} className={isHoveringThisSection ? "text-[#BE9662]" : "text-gray-400"} />
                  <span>
                    {isHoveringThisSection
                      ? `Plasează „${activeDrag?.label}” aici (rând 1, coloana 1)`
                      : "Rând 1 · Coloana 1 — trage sau apasă un element din bara de jos"}
                  </span>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {/* Top New-Row Drop Spot (appears when dragging over this section) */}
                  {isDragForThisSection && (
                    <div
                      data-desc-drop-placement="new-row"
                      data-desc-drop-row={0}
                      data-desc-drop-col={0}
                      className={`w-full rounded-md border border-dashed flex items-center justify-center gap-1.5 text-[11px] font-semibold transition-all ${
                        isSameDrop(activeDrag?.activeDrop ?? null, {
                          target,
                          sectionId: def.id,
                          placement: "new-row",
                          rowIdx: 0,
                          colIdx: 0,
                        })
                          ? "h-9 border-[#BE9662] bg-[#BE9662]/20 text-[#051D35]"
                          : isHoveringThisSection
                          ? "h-7 border-[#BE9662]/60 bg-white/90 text-[#8B6834]"
                          : "h-6 border-gray-300 bg-white/60 text-gray-400"
                      }`}
                    >
                      <Plus size={12} />
                      <span>Rând nou deasupra</span>
                    </div>
                  )}

                  {secLayout.rows.map((row, rowIdx) => {
                    const isSameSourceRow =
                      isDragForThisSection &&
                      activeDrag?.source === "grid" &&
                      activeDrag.fromRowIdx === rowIdx;
                    const canAddColumnInRow =
                      isDragForThisSection &&
                      (row.columns.length < MAX_COLS_PER_ROW || isSameSourceRow);

                    return (
                      <React.Fragment key={row.id}>
                        <div className="flex items-stretch gap-1.5">
                          {/* Row index tag */}
                          <div className="w-5 shrink-0 flex items-center justify-center text-[10px] font-bold text-gray-400 select-none">
                            R{rowIdx + 1}
                          </div>

                          {/* Row Columns + Dynamic Column Drop Spots */}
                          <div className="flex-1 flex items-stretch gap-1.5 min-w-0">
                            {canAddColumnInRow && (
                              <div
                                data-desc-drop-placement="col-slot"
                                data-desc-drop-row={rowIdx}
                                data-desc-drop-col={0}
                                className={`shrink-0 rounded-md border border-dashed flex flex-col items-center justify-center text-[10px] font-semibold transition-all px-1.5 ${
                                  isSameDrop(activeDrag?.activeDrop ?? null, {
                                    target,
                                    sectionId: def.id,
                                    placement: "col-slot",
                                    rowIdx,
                                    colIdx: 0,
                                  })
                                    ? "w-24 border-[#BE9662] bg-[#BE9662]/20 text-[#051D35]"
                                    : isHoveringThisSection
                                    ? "w-14 border-[#BE9662]/60 bg-white/90 text-[#8B6834]"
                                    : "w-10 border-gray-300 bg-white/60 text-gray-400"
                                }`}
                              >
                                <Plus size={11} />
                                <span>col</span>
                              </div>
                            )}

                            {row.columns.map((item, colIdx) => {
                              const isDraggingThisItem =
                                isDragForThisSection &&
                                activeDrag?.source === "grid" &&
                                activeDrag.itemId === item.id;

                              return (
                                <React.Fragment key={item.id}>
                                  <div
                                    onPointerDown={(e) =>
                                      startGridItemPointerDown(e, target, def.id, item, rowIdx, colIdx)
                                    }
                                    className={`flex-1 min-w-0 rounded-md border px-2.5 py-2 flex items-center justify-between gap-2 select-none transition-all cursor-grab active:cursor-grabbing ${
                                      isDraggingThisItem
                                        ? "opacity-40 border-dashed border-[#BE9662] bg-amber-50/40"
                                        : item.kind === "subsection"
                                        ? `${accent.chip} ${accent.chipHover}`
                                        : item.kind === "filler"
                                        ? "bg-slate-100/90 text-slate-600 border-dashed border-slate-300 hover:border-slate-400"
                                        : item.kind === "divider"
                                        ? "bg-stone-50 text-stone-700 border-stone-300 hover:border-stone-400"
                                        : "bg-white text-gray-800 border-gray-300 hover:border-[#051D35]/40"
                                    }`}
                                  >
                                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                      <GripVertical size={12} className="opacity-45 shrink-0" />
                                      {item.kind === "subsection" && (
                                        <span className="text-xs font-semibold truncate">
                                          {item.label}
                                        </span>
                                      )}
                                      {item.kind === "filler" && (
                                        <span className="text-[11px] font-medium italic flex items-center gap-1 truncate">
                                          <Space size={11} className="shrink-0" />
                                          spațiu
                                        </span>
                                      )}
                                      {item.kind === "divider" && (
                                        <div className="flex items-center gap-2 flex-1 min-w-0">
                                          <span className="text-[11px] font-medium text-stone-500 shrink-0">
                                            linie
                                          </span>
                                          <div className="flex-1 h-[1.5px] bg-stone-400/70 rounded-full" />
                                        </div>
                                      )}
                                      {item.kind === "custom_text" && (
                                        <input
                                          type="text"
                                          value={item.customText || ""}
                                          onChange={(e) =>
                                            updateCustomText(target, def.id, item.id, e.target.value)
                                          }
                                          placeholder="Scrie text personalizat..."
                                          className="w-full min-w-[80px] bg-transparent text-xs text-gray-800 placeholder:text-gray-400 focus:outline-none border-b border-transparent focus:border-[#BE9662] py-0.5"
                                        />
                                      )}
                                    </div>

                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        removeItem(target, def.id, item.id);
                                      }}
                                      className="p-0.5 rounded hover:bg-black/5 text-current opacity-55 hover:opacity-100 hover:text-rose-600 transition-colors cursor-pointer shrink-0"
                                      title="Elimină elementul"
                                    >
                                      <X size={12} />
                                    </button>
                                  </div>

                                  {/* Column Drop Spot after this item */}
                                  {canAddColumnInRow && (
                                    <div
                                      data-desc-drop-placement="col-slot"
                                      data-desc-drop-row={rowIdx}
                                      data-desc-drop-col={colIdx + 1}
                                      className={`shrink-0 rounded-md border border-dashed flex flex-col items-center justify-center text-[10px] font-semibold transition-all px-1.5 ${
                                        isSameDrop(activeDrag?.activeDrop ?? null, {
                                          target,
                                          sectionId: def.id,
                                          placement: "col-slot",
                                          rowIdx,
                                          colIdx: colIdx + 1,
                                        })
                                          ? "w-24 border-[#BE9662] bg-[#BE9662]/20 text-[#051D35]"
                                          : isHoveringThisSection
                                          ? "w-14 border-[#BE9662]/60 bg-white/90 text-[#8B6834]"
                                          : "w-10 border-gray-300 bg-white/60 text-gray-400"
                                      }`}
                                    >
                                      <Plus size={11} />
                                      <span>col</span>
                                    </div>
                                  )}
                                </React.Fragment>
                              );
                            })}
                          </div>
                        </div>

                        {/* New-Row Drop Spot below this row */}
                        {isDragForThisSection && (
                          <div
                            data-desc-drop-placement="new-row"
                            data-desc-drop-row={rowIdx + 1}
                            data-desc-drop-col={0}
                            className={`w-full rounded-md border border-dashed flex items-center justify-center gap-1.5 text-[11px] font-semibold transition-all ${
                              isSameDrop(activeDrag?.activeDrop ?? null, {
                                target,
                                sectionId: def.id,
                                placement: "new-row",
                                rowIdx: rowIdx + 1,
                                colIdx: 0,
                              })
                                ? "h-9 border-[#BE9662] bg-[#BE9662]/20 text-[#051D35]"
                                : isHoveringThisSection
                                ? "h-7 border-[#BE9662]/60 bg-white/90 text-[#8B6834]"
                                : "h-6 border-gray-300 bg-white/60 text-gray-400"
                            }`}
                          >
                            <Plus size={12} />
                            <span>
                              {rowIdx === secLayout.rows.length - 1
                                ? "Rând nou dedesubt"
                                : `Rând nou între R${rowIdx + 1} și R${rowIdx + 2}`}
                            </span>
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Bottom WYSIWYG Toolbar for this section */}
            <div className="rounded-lg bg-gray-50 border border-gray-200 px-2.5 py-2 flex flex-wrap items-center gap-1.5">
              {/* Reusable tools: filler, divider, custom text */}
              <button
                type="button"
                onPointerDown={(e) =>
                  startToolbarPointerDown(e, target, def.id, "filler", "spațiu")
                }
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-[11px] font-semibold transition-colors cursor-grab active:cursor-grabbing select-none"
                title="Spațiu gol (poate fi folosit de oricâte ori)"
              >
                <Space size={11} />
                <span>spațiu</span>
              </button>

              <button
                type="button"
                onPointerDown={(e) =>
                  startToolbarPointerDown(e, target, def.id, "divider", "linie")
                }
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-stone-300 bg-white hover:bg-stone-100 text-stone-700 text-[11px] font-semibold transition-colors cursor-grab active:cursor-grabbing select-none"
                title="Linie separatoare (poate fi folosită de oricâte ori)"
              >
                <Minus size={11} />
                <span>linie</span>
              </button>

              <button
                type="button"
                onPointerDown={(e) =>
                  startToolbarPointerDown(e, target, def.id, "custom_text", "text personalizat")
                }
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-gray-300 bg-white hover:bg-gray-100 text-gray-700 text-[11px] font-semibold transition-colors cursor-grab active:cursor-grabbing select-none"
                title="Text personalizat (poate fi folosit de oricâte ori)"
              >
                <Type size={11} />
                <span>text personalizat</span>
              </button>

              <span className="h-4 w-px bg-gray-300 mx-1" aria-hidden="true" />

              {/* Single-use subsection tags */}
              {remainingTags.length > 0 ? (
                remainingTags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onPointerDown={(e) =>
                      startToolbarPointerDown(e, target, def.id, "subsection", tag.label, tag.id)
                    }
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md border text-[11px] font-semibold transition-colors cursor-grab active:cursor-grabbing select-none ${accent.chip} ${accent.chipHover}`}
                    title={`Trage sau apasă pentru a adăuga subsecțiunea „${tag.label}”`}
                  >
                    <GripVertical size={10} className="opacity-50" />
                    <span>{tag.label}</span>
                  </button>
                ))
              ) : (
                <span className="text-[11px] text-gray-400 italic px-1">
                  Toate subsecțiunile au fost plasate
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderTargetBlock = (target: PatternTarget) => {
    const isSale = target === "sale";
    const pattern = descriptionLayout[target];

    return (
      <section className="bg-white border border-gray-200 rounded-xl shadow-xs overflow-hidden">
        <div className="px-5 py-3.5 bg-gray-50/80 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider ${
                isSale
                  ? "bg-[#051D35] text-white"
                  : "bg-[#BE9662] text-white"
              }`}
            >
              {isSale ? "Vânzare" : "Închiriere"}
            </span>
            <div>
              <h3 className="text-sm font-bold text-[#051D35]">
                {isSale
                  ? "Structură Descriere — Proprietăți de Vânzare"
                  : "Structură Descriere — Proprietăți de Închiriere"}
              </h3>
              <p className="text-[11px] text-gray-500">
                Activează sau dezactivează secțiunile și aranjează subsecțiunile pe rânduri și coloane.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPattern(target, createPresetDescriptionPattern(target))}
              className="h-7 px-2.5 rounded-md border border-gray-200 bg-white hover:bg-gray-100 text-[11px] font-semibold text-gray-700 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Sparkles size={12} className="text-[#BE9662]" />
              <span>Model implicit</span>
            </button>
            <button
              type="button"
              onClick={() => setPattern(target, createEmptyDescriptionPattern())}
              className="h-7 px-2.5 rounded-md border border-gray-200 bg-white hover:bg-rose-50 hover:border-rose-200 text-[11px] font-semibold text-gray-600 hover:text-rose-700 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Eraser size={12} />
              <span>Golește</span>
            </button>
          </div>
        </div>

        <div className="p-4 space-y-3.5">
          {pattern.sections.map((sec) => renderSectionCard(target, sec))}
        </div>
      </section>
    );
  };

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto py-16 flex flex-col items-center justify-center text-gray-500 gap-3">
        <div className="w-8 h-8 border-2 border-gray-200 border-t-[#051D35] rounded-full animate-spin" />
        <span className="text-xs font-medium">Se încarcă configurația de descriere...</span>
      </div>
    );
  }

  return (
    <form onSubmit={onSave} className="max-w-6xl mx-auto space-y-5 pb-12">
      {/* Intro Header */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-xs flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#051D35] text-[#D6B78D] flex items-center justify-center shrink-0">
            <LayoutGrid size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-title text-base font-bold text-[#051D35]">
                Automatizare Structură Descriere
              </h2>
              {mode === "agency" && (
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                    isCustomOverride
                      ? "bg-amber-50 text-amber-800 border-amber-200"
                      : "bg-gray-100 text-gray-600 border-gray-200"
                  }`}
                >
                  {isCustomOverride ? "Personalizat agenție" : "Implicit platformă"}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-1 max-w-2xl leading-relaxed">
              Configurează exact ce secțiuni și subsecțiuni apar pe pagina de detalii a proprietății și pe pagina externă distribuită. Fiecare secțiune începe cu un rând și o coloană; când tragi un alt element peste secțiune, apar automat zone de plasare pentru o nouă coloană pe același rând sau un rând nou.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-lg px-4 py-3 flex items-center gap-2.5 text-xs text-rose-700">
          <AlertCircle size={15} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {saveSuccess && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 flex items-center gap-2.5 text-xs text-emerald-800 font-medium">
          <CheckCircle2 size={15} className="shrink-0" />
          <span>Configurația de descriere a fost salvată și se aplică imediat pe paginile de detalii și link-urile externe.</span>
        </div>
      )}

      {/* Vânzare Block */}
      {renderTargetBlock("sale")}

      {/* Închiriere Block */}
      {renderTargetBlock("rent")}

      {/* Action Footer */}
      <div className="bg-white border border-gray-200 rounded-xl px-5 py-3.5 shadow-xs flex flex-wrap items-center justify-between gap-3 sticky bottom-3 z-20">
        <button
          type="button"
          onClick={onReset}
          disabled={isSaving}
          className="h-9 px-3.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700 inline-flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
        >
          <RotateCcw size={14} />
          <span>
            {mode === "agency" ? "Resetează la implicit platformă" : "Resetează la valorile de sistem"}
          </span>
        </button>

        <button
          type="submit"
          disabled={isSaving}
          className="h-9 px-5 rounded-lg bg-[#051D35] hover:bg-[#0a2b4a] text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors shadow-xs disabled:opacity-60 cursor-pointer"
        >
          <Save size={14} />
          <span>{isSaving ? "Se salvează..." : "Salvează configurația"}</span>
        </button>
      </div>

      {/* Floating Drag Ghost */}
      {activeDrag && (
        <div
          className="fixed pointer-events-none z-[9999] px-3 py-1.5 rounded-md border border-[#BE9662] bg-[#051D35] text-white text-xs font-semibold shadow-lg flex items-center gap-1.5"
          style={{
            left: activeDrag.clientX + 12,
            top: activeDrag.clientY + 12,
          }}
        >
          <GripVertical size={12} className="text-[#D6B78D]" />
          <span>{activeDrag.label}</span>
        </div>
      )}
    </form>
  );
};
