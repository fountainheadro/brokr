import React, { useMemo, useRef } from "react";
import { Lead } from "../services/leadsService";
import { Globe, ArrowUpRight, Calendar } from "lucide-react";
import { VirtualizedStack } from "./VirtualizedList";

interface NevalidataUrlListProps {
  groupedLeads: { [key: string]: Lead[] };
  onItemClick: (lead: Lead) => void;
}

type NevalidataRow =
  | { type: "header"; key: string; groupTitle: string }
  | { type: "item"; key: string; lead: Lead };

export const NevalidataUrlList: React.FC<NevalidataUrlListProps> = ({ 
  groupedLeads, 
  onItemClick 
}) => {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const groups = useMemo(() => Object.keys(groupedLeads), [groupedLeads]);

  const virtualRows = useMemo<NevalidataRow[]>(() => {
    const rows: NevalidataRow[] = [];
    for (const groupTitle of groups) {
      const list = groupedLeads[groupTitle] || [];
      if (list.length === 0) continue;
      rows.push({
        type: "header",
        key: `hdr::${groupTitle}`,
        groupTitle,
      });
      list.forEach((lead, index) => {
        rows.push({
          type: "item",
          key: lead.id || `neval::${groupTitle}::${index}::${lead.title}`,
          lead,
        });
      });
    }
    return rows;
  }, [groups, groupedLeads]);

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-12">
        <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
          <Globe size={28} className="text-gray-300" />
        </div>
        <p className="text-[12px] font-semibold text-gray-400 tracking-wider">Niciun link de procesat (Nevalidate)</p>
      </div>
    );
  }

  return (
    <div ref={scrollContainerRef} className="p-5 overflow-y-auto max-h-full custom-scrollbar">
      <VirtualizedStack
        items={virtualRows}
        scrollContainerRef={scrollContainerRef}
        getItemKey={(row) => row.key}
        estimateItemHeight={(row) => (row.type === "header" ? 28 : 118)}
        gap={16}
        overscanRatio={0.5}
        renderItem={(row, _index, rowRef) => {
          if (row.type === "header") {
            return (
              <h3
                ref={rowRef}
                className="font-title text-[14px] font-semibold text-gray-500 tracking-wider px-2 pt-2 flex items-center gap-2"
              >
                <Calendar size={14} />
                {row.groupTitle}
              </h3>
            );
          }

          const { lead } = row;
          let domain = "";
          try {
            if (lead.url) {
              const urlObj = new URL(lead.url);
              domain = urlObj.hostname.replace("www.", "");
            }
          } catch {
            domain = "Link extern";
          }

          return (
            <div
              ref={rowRef}
              onClick={() => onItemClick(lead)}
              className="bg-white rounded-[16px] border border-gray-150 p-5 hover:border-gray-300 hover:shadow-sm transition-all cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-4"
            >
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-center gap-3 flex-wrap">
                  {lead.propertyId && (
                    <span className="shrink-0 px-2 py-1 rounded font-sans tabular-nums text-[11px] font-normal bg-gray-100 text-gray-800 border border-gray-200 leading-none">
                      #{lead.propertyId}
                    </span>
                  )}
                  <span className="shrink-0 px-3 py-1 rounded-full text-[10px] font-normal uppercase bg-gray-100 text-gray-600 tracking-wider flex items-center gap-1 leading-none">
                    <Globe size={11} />
                    {domain}
                  </span>
                  {lead.transactionType && (
                    <span className={`shrink-0 px-3 py-1 rounded-full text-[10px] font-normal uppercase tracking-wider leading-none ${
                      lead.transactionType === "Vânzare" || (lead.transactionType as string) === "Vanzare"
                        ? "badge-brand-navy"
                        : "badge-brand-gold"
                    }`}>
                      {lead.transactionType}
                    </span>
                  )}
                  {lead.categoria && (
                    <span className="shrink-0 px-3 py-1 rounded-full text-[10px] font-normal uppercase bg-gray-50 text-gray-500 tracking-wider leading-none">
                      {lead.categoria}
                    </span>
                  )}
                </div>

                <h4 className="font-title text-[15px] font-semibold text-gray-900 leading-tight line-clamp-1 group-hover:text-[--color-accent] transition-colors">
                  {lead.title}
                </h4>

                <p className="text-[13px] font-normal text-gray-400 truncate hover:underline hover:text-gray-600 select-all" title={lead.url}>
                  {lead.url}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-4 md:self-center shrink-0">
                <div className="text-right">
                  {lead.price && lead.price !== "N/A" && (
                    <div className="text-[16px] font-normal tabular-nums text-[--color-accent] leading-none mb-1">
                      {lead.price}
                    </div>
                  )}
                  {(lead.ownerName || lead.ownerPhone) && (
                    <div className="text-[12px] font-normal text-gray-400 flex items-center justify-end gap-1">
                      <span>{lead.ownerName || "Proprietar"}</span>
                      {lead.ownerPhone && <span className="opacity-60">• {lead.ownerPhone}</span>}
                    </div>
                  )}
                </div>

                <div className="w-10 h-10 rounded-full bg-gray-50 border border-gray-100 flex items-center justify-center text-gray-400 hover:text-[--color-accent] hover:bg-gray-100 transition-all shadow-sm">
                  <ArrowUpRight size={18} />
                </div>
              </div>
            </div>
          );
        }}
      />
    </div>
  );
};

