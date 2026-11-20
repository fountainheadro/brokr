import React, { useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { ActiveFilterTag } from "../utils/olxFilterUtils";

interface ActiveFilterTagsBarProps {
  tags: ActiveFilterTag[];
  onRemoveTag: (tag: ActiveFilterTag) => void;
  onOpenDrawer: () => void;
}

const GAP_PX = 6;
const DEFAULT_OVERFLOW_WIDTH_PX = 46;

/**
 * Displays active filter values as removable tags to the left of the Filter button,
 * matching the Filter button's height (h-7), padding (px-2.5), and text size (text-xs).
 * Dynamically measures available width via ResizeObserver and renders a "+N" overflow tag
 * once horizontal space runs out so the sub-header stays strictly single-row.
 */
export const ActiveFilterTagsBar: React.FC<ActiveFilterTagsBarProps> = ({
  tags,
  onRemoveTag,
  onOpenDrawer,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const overflowMeasureRef = useRef<HTMLSpanElement>(null);
  const [visibleCount, setVisibleCount] = useState<number>(tags.length);

  useLayoutEffect(() => {
    const computeVisible = () => {
      const container = containerRef.current;
      const measure = measureRef.current;
      if (!container || !measure) return;

      if (tags.length === 0) {
        setVisibleCount(0);
        return;
      }

      const availableWidth = container.clientWidth;
      if (availableWidth <= 0) {
        setVisibleCount(0);
        return;
      }

      const tagNodes = Array.from(measure.children) as HTMLElement[];
      const widths = tagNodes.map((node) => Math.ceil(node.getBoundingClientRect().width));

      const totalAllWidth =
        widths.reduce((sum, w) => sum + w, 0) + Math.max(0, widths.length - 1) * GAP_PX;

      if (totalAllWidth <= availableWidth) {
        setVisibleCount(tags.length);
        return;
      }

      // Space ran out — fit as many complete tags as possible while reserving room for "+N"
      const measuredOverflowWidth = overflowMeasureRef.current
        ? Math.ceil(overflowMeasureRef.current.getBoundingClientRect().width)
        : DEFAULT_OVERFLOW_WIDTH_PX;
      const overflowReserve = Math.max(DEFAULT_OVERFLOW_WIDTH_PX, measuredOverflowWidth);
      const budget = Math.max(0, availableWidth - overflowReserve - GAP_PX);
      let used = 0;
      let count = 0;
      for (let i = 0; i < widths.length; i++) {
        const nextWidth = (count > 0 ? GAP_PX : 0) + widths[i];
        if (used + nextWidth <= budget) {
          used += nextWidth;
          count++;
        } else {
          break;
        }
      }
      setVisibleCount(count);
    };

    computeVisible();

    const observer = new ResizeObserver(() => {
      computeVisible();
    });
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    return () => observer.disconnect();
  }, [tags]);

  if (tags.length === 0) {
    return null;
  }

  const visibleTags = tags.slice(0, visibleCount);
  const hiddenTags = tags.slice(visibleCount);
  const hasOverflow = hiddenTags.length > 0;

  return (
    <div
      ref={containerRef}
      className="relative flex-1 min-w-0 flex items-center justify-end gap-1.5 overflow-hidden h-7"
    >
      {/* Off-flow measurement strip to obtain exact pill widths without flicker */}
      <div
        aria-hidden="true"
        className="pointer-events-none invisible fixed -top-[9999px] left-0 flex items-center gap-1.5 whitespace-nowrap"
      >
        <div ref={measureRef} className="flex items-center gap-1.5 whitespace-nowrap">
          {tags.map((tag) => (
            <span
              key={`measure-${tag.id}`}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-xs font-medium whitespace-nowrap"
            >
              <span className="max-w-[160px] truncate">{tag.label}</span>
              <span className="w-4 h-4 inline-flex items-center justify-center shrink-0">
                <X size={12} />
              </span>
            </span>
          ))}
        </div>
        <span
          ref={overflowMeasureRef}
          className="inline-flex items-center justify-center h-7 px-2.5 rounded-md border text-xs font-semibold tabular-nums whitespace-nowrap"
        >
          +{tags.length}
        </span>
      </div>

      {/* Visible active filter tags */}
      {visibleTags.map((tag) => (
        <span
          key={tag.id}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-[#051D35]/8 border border-[#051D35]/20 text-[#051D35] text-xs font-medium whitespace-nowrap shrink-0"
          title={tag.label}
        >
          <span className="max-w-[160px] truncate">{tag.label}</span>
          <button
            type="button"
            onClick={() => onRemoveTag(tag)}
            aria-label={`Elimină filtrul ${tag.label}`}
            title={`Elimină filtrul ${tag.label}`}
            className="w-4 h-4 rounded flex items-center justify-center text-[#051D35]/70 hover:text-white hover:bg-[#051D35] transition-colors cursor-pointer shrink-0"
          >
            <X size={12} />
          </button>
        </span>
      ))}

      {/* Overflow count badge when available horizontal space runs out */}
      {hasOverflow && (
        <button
          type="button"
          onClick={onOpenDrawer}
          title={`Încă ${hiddenTags.length} ${hiddenTags.length === 1 ? "filtru activ" : "filtre active"}: ${hiddenTags.map((t) => t.label).join(", ")}`}
          aria-label={`Afișează încă ${hiddenTags.length} filtre active`}
          className="inline-flex items-center justify-center h-7 px-2.5 rounded-md bg-gray-100 hover:bg-gray-200 border border-gray-200 text-[#051D35] text-xs font-semibold tabular-nums leading-none transition-colors cursor-pointer shrink-0"
        >
          +{hiddenTags.length}
        </button>
      )}
    </div>
  );
};
