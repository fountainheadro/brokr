import React, { useEffect, useMemo, useRef, useState } from "react";
import { Lead } from "../services/leadsService";
import { Contact } from "../services/contactsService";
import { LeadCard } from "./LeadCard";
import { VirtualizedStack } from "./VirtualizedList";

interface LeadListProps {
  groupedLeads: { [key: string]: Lead[] };
  contacts: Contact[];
  onLeadClick: (lead: Lead) => void;
  onContactClick: (contact: Contact) => void;
  onQuickViewClick: (lead: Lead) => void;
  quickViewLabel?: string;
  compactTypography?: boolean;
  header?: React.ReactNode;
  footer?: React.ReactNode;
}

type LeadVirtualRow =
  | { type: "header"; key: string; groupTitle: string; count: number }
  | { type: "cards"; key: string; leads: Lead[] };

function getGridColumnCount(): number {
  if (typeof window === "undefined") return 3;
  if (window.innerWidth >= 1024) return 3;
  if (window.innerWidth >= 768) return 2;
  return 1;
}

export const LeadList: React.FC<LeadListProps> = ({ 
  groupedLeads, 
  contacts, 
  onLeadClick, 
  onContactClick,
  onQuickViewClick,
  quickViewLabel,
  compactTypography = false,
  header,
  footer
}) => {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [columns, setColumns] = useState<number>(getGridColumnCount);

  useEffect(() => {
    const handleResize = () => {
      const next = getGridColumnCount();
      setColumns((prev) => (prev === next ? prev : next));
    };
    window.addEventListener("resize", handleResize, { passive: true });
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const contactsByPropertyId = useMemo(() => {
    const map = new Map<string, Contact[]>();
    for (const c of contacts) {
      if (!c.propertyId) continue;
      const list = map.get(c.propertyId);
      if (list) list.push(c);
      else map.set(c.propertyId, [c]);
    }
    return map;
  }, [contacts]);

  const groups = useMemo(() => Object.keys(groupedLeads), [groupedLeads]);

  const virtualRows = useMemo<LeadVirtualRow[]>(() => {
    const rows: LeadVirtualRow[] = [];
    for (const groupTitle of groups) {
      const list = groupedLeads[groupTitle] || [];
      if (list.length === 0) continue;
      rows.push({
        type: "header",
        key: `hdr::${groupTitle}`,
        groupTitle,
        count: list.length,
      });
      for (let i = 0; i < list.length; i += columns) {
        const chunk = list.slice(i, i + columns);
        const chunkIds = chunk.map((l, idx) => l.id || `${i + idx}-${l.title}`).join("|");
        rows.push({
          type: "cards",
          key: `row::${groupTitle}::${i}::${chunkIds}`,
          leads: chunk,
        });
      }
    }
    return rows;
  }, [groups, groupedLeads, columns]);

  if (groups.length === 0) {
    return (
      <div className="flex flex-col h-full p-4 overflow-y-auto custom-scrollbar">
        {header && <div className="mb-3 shrink-0">{header}</div>}
        <div className="flex-1 flex flex-col items-center justify-center text-center p-4">
          <div className="w-10 h-10 bg-gray-100 rounded-md flex items-center justify-center mb-3">
            <div className="w-5 h-5 border border-dashed border-gray-300 rounded" />
          </div>
          <p className="text-[12px] font-medium text-gray-500">Nicio Proprietate Găsită</p>
          {footer && <div className="mt-6 w-full flex justify-center">{footer}</div>}
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollContainerRef} className="p-4 overflow-y-auto max-h-full custom-scrollbar">
      {header && <div className="mb-3">{header}</div>}
      <VirtualizedStack
        items={virtualRows}
        scrollContainerRef={scrollContainerRef}
        getItemKey={(row) => row.key}
        estimateItemHeight={(row) => (row.type === "header" ? 28 : 230)}
        gap={14}
        overscanRatio={0.5}
        renderItem={(row, _index, rowRef) => {
          if (row.type === "header") {
            return (
              <div ref={rowRef} className="flex items-center gap-2 px-1">
                <h3 className="font-title text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                  {row.groupTitle}
                </h3>
                <span className="text-[10px] font-sans font-normal tabular-nums text-gray-400 bg-gray-100 px-2 py-1 rounded">
                  {row.count}
                </span>
              </div>
            );
          }

          return (
            <div ref={rowRef} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {row.leads.map((lead, idx) => {
                const matchedContacts =
                  (lead.id ? contactsByPropertyId.get(lead.id) : undefined) ||
                  (lead.propertyId ? contactsByPropertyId.get(lead.propertyId) : undefined) ||
                  [];
                return (
                  <div key={lead.id || `lead-${idx}-${lead.title}`} className="h-full">
                    <LeadCard
                      lead={lead}
                      contacts={matchedContacts}
                      onClick={() => onLeadClick(lead)}
                      onContactClick={onContactClick}
                      onQuickViewClick={() => onQuickViewClick(lead)}
                      quickViewLabel={quickViewLabel}
                      compactTypography={compactTypography}
                    />
                  </div>
                );
              })}
            </div>
          );
        }}
      />
      {footer && (
        <div className="pt-4 pb-4 flex justify-center">
          {footer}
        </div>
      )}
    </div>
  );
};

