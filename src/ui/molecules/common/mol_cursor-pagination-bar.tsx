import React from "react";
import { ChevronDown, Loader2 } from "lucide-react";

export interface MolCursorPaginationBarProps {
  loadedCount: number;
  hasMore: boolean;
  isLoadingMore?: boolean;
  onLoadMore: () => void;
  itemLabel?: string;
  loadMoreLabel?: string;
  endLabel?: string;
  className?: string;
}

export const MolCursorPaginationBar: React.FC<MolCursorPaginationBarProps> = ({
  loadedCount,
  hasMore,
  isLoadingMore = false,
  onLoadMore,
  itemLabel = "elemente încărcate",
  loadMoreLabel = "Încarcă mai multe",
  endLabel = "Toate înregistrările au fost încărcate",
  className = "",
}) => {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 border-t border-gray-200/80 bg-gray-50/60 px-4 py-2.5 text-xs font-sans ${className}`}
    >
      <span className="text-[11px] font-medium text-gray-500 tabular-nums">
        {loadedCount} {itemLabel}
      </span>

      {hasMore ? (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={isLoadingMore}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#051D35] hover:bg-gray-50 hover:border-gray-300 disabled:opacity-60 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          {isLoadingMore ? (
            <>
              <Loader2 size={13} className="animate-spin text-[#BE9662]" />
              <span>Se încarcă...</span>
            </>
          ) : (
            <>
              <span>{loadMoreLabel}</span>
              <ChevronDown size={13} className="text-gray-400" />
            </>
          )}
        </button>
      ) : (
        <span className="text-[11px] text-gray-400">{endLabel}</span>
      )}
    </div>
  );
};
