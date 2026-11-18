import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

function findScrollParent(el: HTMLElement | null): HTMLElement | Window {
  if (typeof window === "undefined") {
    return ({} as unknown) as Window;
  }
  let curr: HTMLElement | null = el ? el.parentElement : null;
  while (curr && curr !== document.body && curr !== document.documentElement) {
    const style = window.getComputedStyle(curr);
    const oy = style.overflowY;
    if (oy === "auto" || oy === "scroll" || oy === "overlay") {
      return curr;
    }
    curr = curr.parentElement;
  }
  return window;
}

export interface UseViewportWindowOptions<T> {
  items: readonly T[];
  getItemKey: (item: T, index: number) => string | number;
  estimateItemHeight: number | ((item: T, index: number) => number);
  gap?: number;
  /** Extra fraction of viewport height rendered beyond the bottom fold (default 0.5 = +50%) */
  overscanRatio?: number;
  scrollContainerRef?: React.RefObject<HTMLElement | null>;
}

export interface ViewportWindowResult<T> {
  listRef: React.RefObject<any>;
  startIndex: number;
  endIndex: number;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  totalHeight: number;
  visibleItems: Array<{ item: T; index: number; key: string | number }>;
  measureItemRef: (key: string | number) => (el: HTMLElement | null) => void;
}

export function useViewportWindow<T>({
  items,
  getItemKey,
  estimateItemHeight,
  gap = 0,
  overscanRatio = 0.5,
  scrollContainerRef,
}: UseViewportWindowOptions<T>): ViewportWindowResult<T> {
  const listRef = useRef<HTMLElement | null>(null);
  const measuredHeightsRef = useRef<Map<string | number, number>>(new Map());
  const observedElsRef = useRef<Map<HTMLElement, string | number>>(new Map());
  const keyToElRef = useRef<Map<string | number, HTMLElement>>(new Map());
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const [layoutMetrics, setLayoutMetrics] = useState<{
    scrollTop: number;
    viewportHeight: number;
    listTopInScroll: number;
    measureVersion: number;
  }>(() => ({
    scrollTop: 0,
    viewportHeight: typeof window !== "undefined" ? window.innerHeight : 800,
    listTopInScroll: 0,
    measureVersion: 0,
  }));

  const scheduleMeasureUpdate = useCallback(() => {
    if (rafIdRef.current !== null) return;
    rafIdRef.current = window.requestAnimationFrame(() => {
      rafIdRef.current = null;
      const listEl = listRef.current;
      const explicitContainer = scrollContainerRef?.current ?? null;
      const scrollEl = explicitContainer || findScrollParent(listEl);

      let scrollTop = 0;
      let viewportHeight = typeof window !== "undefined" ? window.innerHeight : 800;
      let listTopInScroll = 0;

      if (scrollEl instanceof Window) {
        scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
        viewportHeight = window.innerHeight || 800;
        if (listEl) {
          listTopInScroll = listEl.getBoundingClientRect().top + scrollTop;
        }
      } else if (scrollEl) {
        scrollTop = scrollEl.scrollTop;
        viewportHeight = scrollEl.clientHeight || window.innerHeight || 800;
        if (listEl) {
          const listRect = listEl.getBoundingClientRect();
          const containerRect = scrollEl.getBoundingClientRect();
          listTopInScroll = listRect.top - containerRect.top + scrollTop;
        }
      }

      setLayoutMetrics((prev) => {
        if (
          Math.abs(prev.scrollTop - scrollTop) < 1 &&
          Math.abs(prev.viewportHeight - viewportHeight) < 1 &&
          Math.abs(prev.listTopInScroll - listTopInScroll) < 1
        ) {
          return prev;
        }
        return {
          scrollTop,
          viewportHeight,
          listTopInScroll,
          measureVersion: prev.measureVersion,
        };
      });
    });
  }, [scrollContainerRef]);

  const measureRafRef = useRef<number | null>(null);

  const flushMeasureVersion = useCallback(() => {
    if (measureRafRef.current !== null) return;
    measureRafRef.current = window.requestAnimationFrame(() => {
      measureRafRef.current = null;
      setLayoutMetrics((prev) => ({
        ...prev,
        measureVersion: prev.measureVersion + 1,
      }));
    });
  }, []);

  // Setup shared ResizeObserver for dynamically sized items
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const key = observedElsRef.current.get(el);
        if (key === undefined) continue;
        const nextHeight = entry.borderBoxSize?.[0]?.blockSize ?? el.getBoundingClientRect().height;
        if (nextHeight > 0) {
          const prevHeight = measuredHeightsRef.current.get(key);
          if (prevHeight === undefined || Math.abs(prevHeight - nextHeight) >= 1) {
            measuredHeightsRef.current.set(key, nextHeight);
            changed = true;
          }
        }
      }
      if (changed) {
        flushMeasureVersion();
      }
    });
    resizeObserverRef.current = ro;

    // Observe any already-registered elements
    observedElsRef.current.forEach((_, el) => ro.observe(el));

    return () => {
      ro.disconnect();
      resizeObserverRef.current = null;
      if (measureRafRef.current !== null) {
        window.cancelAnimationFrame(measureRafRef.current);
        measureRafRef.current = null;
      }
    };
  }, [flushMeasureVersion]);

  const measureItemRef = useCallback((key: string | number) => {
    return (el: HTMLElement | null) => {
      const prevEl = keyToElRef.current.get(key);
      if (prevEl && prevEl !== el) {
        observedElsRef.current.delete(prevEl);
        resizeObserverRef.current?.unobserve(prevEl);
        keyToElRef.current.delete(key);
      }
      if (el) {
        keyToElRef.current.set(key, el);
        observedElsRef.current.set(el, key);
        resizeObserverRef.current?.observe(el);
        const h = el.getBoundingClientRect().height;
        if (h > 0) {
          const prevHeight = measuredHeightsRef.current.get(key);
          if (prevHeight === undefined || Math.abs(prevHeight - h) >= 1) {
            measuredHeightsRef.current.set(key, h);
            flushMeasureVersion();
          }
        }
      }
    };
  }, [flushMeasureVersion]);

  // Attach scroll & resize listeners to resolved scroll container
  useLayoutEffect(() => {
    const listEl = listRef.current;
    const scrollEl = scrollContainerRef?.current || findScrollParent(listEl);

    const handleScrollOrResize = () => {
      scheduleMeasureUpdate();
    };

    // Perform an initial synchronous read
    handleScrollOrResize();

    if (scrollEl instanceof Window) {
      window.addEventListener("scroll", handleScrollOrResize, { passive: true });
      window.addEventListener("resize", handleScrollOrResize, { passive: true });
      return () => {
        window.removeEventListener("scroll", handleScrollOrResize);
        window.removeEventListener("resize", handleScrollOrResize);
        if (rafIdRef.current !== null) {
          window.cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
      };
    } else if (scrollEl) {
      scrollEl.addEventListener("scroll", handleScrollOrResize, { passive: true });
      window.addEventListener("resize", handleScrollOrResize, { passive: true });
      let containerRo: ResizeObserver | null = null;
      if (typeof ResizeObserver !== "undefined") {
        containerRo = new ResizeObserver(handleScrollOrResize);
        containerRo.observe(scrollEl);
      }
      return () => {
        scrollEl.removeEventListener("scroll", handleScrollOrResize);
        window.removeEventListener("resize", handleScrollOrResize);
        containerRo?.disconnect();
        if (rafIdRef.current !== null) {
          window.cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
      };
    }
  }, [scrollContainerRef, scheduleMeasureUpdate, items.length]);

  // Clean up stale cached measurements when item set shrinks/changes
  useEffect(() => {
    const activeKeys = new Set<string | number>();
    for (let i = 0; i < items.length; i++) {
      activeKeys.add(getItemKey(items[i], i));
    }
    measuredHeightsRef.current.forEach((_, k) => {
      if (!activeKeys.has(k)) {
        measuredHeightsRef.current.delete(k);
      }
    });
    scheduleMeasureUpdate();
  }, [items, getItemKey, scheduleMeasureUpdate]);

  const computed = useMemo(() => {
    const count = items.length;
    if (count === 0) {
      return {
        startIndex: 0,
        endIndex: -1,
        topSpacerHeight: 0,
        bottomSpacerHeight: 0,
        totalHeight: 0,
        visibleItems: [] as Array<{ item: T; index: number; key: string | number }>,
      };
    }

    const keys: Array<string | number> = new Array(count);
    const tops: number[] = new Array(count);
    const bottoms: number[] = new Array(count);

    let offset = 0;
    for (let i = 0; i < count; i++) {
      const item = items[i];
      const key = getItemKey(item, i);
      keys[i] = key;
      const estimated =
        typeof estimateItemHeight === "function" ? estimateItemHeight(item, i) : estimateItemHeight;
      const height = measuredHeightsRef.current.get(key) ?? estimated;
      tops[i] = offset;
      bottoms[i] = offset + height;
      offset += height + (i < count - 1 ? gap : 0);
    }

    const totalHeight = offset;
    const relativeScrollTop = layoutMetrics.scrollTop - layoutMetrics.listTopInScroll;
    const windowStart = Math.max(0, relativeScrollTop);
    const windowEnd = Math.max(0, relativeScrollTop + layoutMetrics.viewportHeight * (1 + overscanRatio));

    // Find first item whose bottom extends into the visible viewport area
    let startIndex = 0;
    while (startIndex < count && bottoms[startIndex] <= windowStart) {
      startIndex++;
    }

    if (startIndex >= count) {
      return {
        startIndex: count,
        endIndex: count - 1,
        topSpacerHeight: totalHeight,
        bottomSpacerHeight: 0,
        totalHeight,
        visibleItems: [] as Array<{ item: T; index: number; key: string | number }>,
      };
    }

    // Find last item whose top starts before viewport + 50% beyond the fold
    let endIndex = startIndex;
    while (endIndex < count && tops[endIndex] < windowEnd) {
      endIndex++;
    }
    endIndex = endIndex - 1;

    if (endIndex < startIndex) {
      return {
        startIndex,
        endIndex,
        topSpacerHeight: tops[startIndex],
        bottomSpacerHeight: Math.max(0, totalHeight - tops[startIndex]),
        totalHeight,
        visibleItems: [] as Array<{ item: T; index: number; key: string | number }>,
      };
    }

    const topSpacerHeight = tops[startIndex];
    const bottomSpacerHeight = Math.max(0, totalHeight - bottoms[endIndex]);

    const visibleItems: Array<{ item: T; index: number; key: string | number }> = [];
    for (let i = startIndex; i <= endIndex; i++) {
      visibleItems.push({ item: items[i], index: i, key: keys[i] });
    }

    return {
      startIndex,
      endIndex,
      topSpacerHeight,
      bottomSpacerHeight,
      totalHeight,
      visibleItems,
    };
  }, [items, getItemKey, estimateItemHeight, gap, overscanRatio, layoutMetrics]);

  return {
    listRef,
    ...computed,
    measureItemRef,
  };
}

export interface VirtualizedStackProps<T> {
  items: readonly T[];
  getItemKey: (item: T, index: number) => string | number;
  estimateItemHeight: number | ((item: T, index: number) => number);
  gap?: number;
  overscanRatio?: number;
  scrollContainerRef?: React.RefObject<HTMLElement | null>;
  className?: string;
  renderItem: (
    item: T,
    index: number,
    ref: (el: HTMLElement | null) => void
  ) => React.ReactNode;
}

export function VirtualizedStack<T>({
  items,
  getItemKey,
  estimateItemHeight,
  gap = 0,
  overscanRatio = 0.5,
  scrollContainerRef,
  className = "",
  renderItem,
}: VirtualizedStackProps<T>) {
  const {
    listRef,
    topSpacerHeight,
    bottomSpacerHeight,
    visibleItems,
    measureItemRef,
  } = useViewportWindow({
    items,
    getItemKey,
    estimateItemHeight,
    gap,
    overscanRatio,
    scrollContainerRef,
  });

  return (
    <div
      ref={listRef}
      className={className}
      style={{
        paddingTop: topSpacerHeight > 0 ? `${topSpacerHeight}px` : undefined,
        paddingBottom: bottomSpacerHeight > 0 ? `${bottomSpacerHeight}px` : undefined,
        display: "flex",
        flexDirection: "column",
        gap: gap > 0 ? `${gap}px` : undefined,
      }}
    >
      {visibleItems.map(({ item, index, key }) => (
        <React.Fragment key={key}>
          {renderItem(item, index, measureItemRef(key))}
        </React.Fragment>
      ))}
    </div>
  );
}

export interface VirtualizedTbodyProps<T> {
  items: readonly T[];
  colSpan: number;
  getItemKey: (item: T, index: number) => string | number;
  estimateRowHeight?: number | ((item: T, index: number) => number);
  overscanRatio?: number;
  scrollContainerRef?: React.RefObject<HTMLElement | null>;
  className?: string;
  renderRow: (
    item: T,
    index: number,
    ref: (el: HTMLTableRowElement | null) => void
  ) => React.ReactNode;
}

export function VirtualizedTbody<T>({
  items,
  colSpan,
  getItemKey,
  estimateRowHeight = 48,
  overscanRatio = 0.5,
  scrollContainerRef,
  className = "divide-y divide-gray-100",
  renderRow,
}: VirtualizedTbodyProps<T>) {
  const {
    listRef,
    topSpacerHeight,
    bottomSpacerHeight,
    visibleItems,
    measureItemRef,
  } = useViewportWindow({
    items,
    getItemKey,
    estimateItemHeight: estimateRowHeight,
    gap: 0,
    overscanRatio,
    scrollContainerRef,
  });

  return (
    <tbody ref={listRef} className={className}>
      {topSpacerHeight > 0 && (
        <tr aria-hidden="true" className="!border-0">
          <td
            colSpan={colSpan}
            className="!p-0 !border-0"
            style={{ height: `${topSpacerHeight}px` }}
          />
        </tr>
      )}
      {visibleItems.map(({ item, index, key }) => (
        <React.Fragment key={key}>
          {renderRow(item, index, measureItemRef(key) as (el: HTMLTableRowElement | null) => void)}
        </React.Fragment>
      ))}
      {bottomSpacerHeight > 0 && (
        <tr aria-hidden="true" className="!border-0">
          <td
            colSpan={colSpan}
            className="!p-0 !border-0"
            style={{ height: `${bottomSpacerHeight}px` }}
          />
        </tr>
      )}
    </tbody>
  );
}
