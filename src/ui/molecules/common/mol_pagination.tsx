import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AtmButton } from "../../atoms/common/atm_button";

export interface MolPaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  totalItems?: number;
  className?: string;
}

export const MolPagination: React.FC<MolPaginationProps> = ({
  currentPage,
  totalPages,
  onPageChange,
  totalItems,
  className = "",
}) => {
  if (totalPages <= 1 && !totalItems) return null;

  return (
    <div className={`flex items-center justify-between gap-4 text-xs text-gray-500 py-2 select-none ${className}`}>
      {totalItems !== undefined && (
        <span className="text-[11px] font-semibold text-gray-500">
          Total: <span className="font-normal text-gray-900">{totalItems}</span> înregistrări
        </span>
      )}

      <div className="flex items-center gap-2 ml-auto">
        <AtmButton
          variant="secondary"
          size="sm"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
          aria-label="Pagina anterioară"
        >
          <ChevronLeft size={13} />
        </AtmButton>

        <span className="text-[11px] font-semibold text-gray-700 px-2">
          {currentPage} / {Math.max(1, totalPages)}
        </span>

        <AtmButton
          variant="secondary"
          size="sm"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          aria-label="Pagina următoare"
        >
          <ChevronRight size={13} />
        </AtmButton>
      </div>
    </div>
  );
};
