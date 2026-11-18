import React from "react";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { AtmSkeleton } from "../../atoms/common/atm_skeleton";
import { MolPagination } from "../../molecules/common/mol_pagination";
import { MolEmptyState } from "../../molecules/common/mol_empty-state";
import { designTokens } from "../../../../design/tokens";

export interface ColumnDef<T> {
  key: string;
  header: string;
  width?: string;
  align?: "left" | "center" | "right";
  sortable?: boolean;
  render?: (row: T, index: number) => React.ReactNode;
}

export interface OrgDataTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  keyExtractor: (item: T) => string;
  isLoading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  sortColumn?: string;
  sortDirection?: "asc" | "desc";
  onSort?: (columnKey: string) => void;
  pagination?: {
    currentPage: number;
    totalPages: number;
    totalItems?: number;
    onPageChange: (page: number) => void;
  };
  onRowClick?: (item: T) => void;
  className?: string;
}

export function OrgDataTable<T>({
  columns,
  data,
  keyExtractor,
  isLoading = false,
  emptyTitle = "Nicio înregistrare găsită",
  emptyDescription = "Nu există date de afișat conform filtrelor curente.",
  sortColumn,
  sortDirection,
  onSort,
  pagination,
  onRowClick,
  className = "",
}: OrgDataTableProps<T>) {
  return (
    <div
      className={`bg-white border border-gray-200 overflow-hidden flex flex-col ${className}`}
      style={{ borderRadius: designTokens.radius.card }}
    >
      <div className="overflow-x-auto custom-scrollbar flex-1">
        <table className="w-full text-left text-xs border-collapse">
          {/* Table Header */}
          <thead className="bg-gray-50/80 border-b border-gray-200 text-gray-500 font-semibold uppercase text-[10px] tracking-wider select-none">
            <tr>
              {columns.map((col) => {
                const isSorted = sortColumn === col.key;
                return (
                  <th
                    key={col.key}
                    style={{ width: col.width }}
                    className={`py-3 px-4 ${
                      col.align === "right"
                        ? "text-right"
                        : col.align === "center"
                        ? "text-center"
                        : "text-left"
                    } ${col.sortable ? "cursor-pointer hover:text-gray-900" : ""}`}
                    onClick={() => col.sortable && onSort?.(col.key)}
                  >
                    <div
                      className={`inline-flex items-center gap-2 ${
                        col.align === "right" ? "justify-end" : ""
                      }`}
                    >
                      <span>{col.header}</span>
                      {col.sortable && (
                        <span className="text-gray-400">
                          {isSorted ? (
                            sortDirection === "asc" ? (
                              <ArrowUp size={11} className="text-[#051D35]" />
                            ) : (
                              <ArrowDown size={11} className="text-[#051D35]" />
                            )
                          ) : (
                            <ArrowUpDown size={11} />
                          )}
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>

          {/* Table Body */}
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, idx) => (
                <tr key={`skeleton-${idx}`}>
                  {columns.map((col) => (
                    <td key={col.key} className="py-3 px-4">
                      <AtmSkeleton height={16} rounded="badge" />
                    </td>
                  ))}
                </tr>
              ))
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="py-12">
                  <MolEmptyState title={emptyTitle} description={emptyDescription} />
                </td>
              </tr>
            ) : (
              data.map((row, idx) => (
                <tr
                  key={keyExtractor(row)}
                  onClick={() => onRowClick?.(row)}
                  className={`transition-colors ${
                    onRowClick ? "cursor-pointer hover:bg-gray-50/70" : "hover:bg-gray-50/40"
                  }`}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`py-3 px-4 font-normal text-gray-800 ${
                        col.align === "right"
                          ? "text-right"
                          : col.align === "center"
                          ? "text-center"
                          : "text-left"
                      }`}
                    >
                      {col.render ? col.render(row, idx) : (row as any)[col.key]}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Bar */}
      {pagination && (
        <div className="px-4 border-t border-gray-100 bg-gray-50/40">
          <MolPagination {...pagination} />
        </div>
      )}
    </div>
  );
}
