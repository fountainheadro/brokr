import React from "react";
import { ChevronLeft, ChevronRight, Building2 } from "lucide-react";
import { designTokens } from "../../../../design/tokens";

export interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  badge?: number | string;
  badgeVariant?: "brand" | "accent" | "warning";
  active?: boolean;
  onClick: () => void;
}

export interface NavGroup {
  id: string;
  title?: string;
  items: NavItem[];
}

export interface OrgNavigationSidebarProps {
  agencyName?: string;
  agencyLogo?: string | null;
  groups: NavGroup[];
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  footerContent?: React.ReactNode;
  className?: string;
}

export const OrgNavigationSidebar: React.FC<OrgNavigationSidebarProps> = ({
  agencyName = "Brokr CRM",
  agencyLogo,
  groups,
  isCollapsed = false,
  onToggleCollapse,
  footerContent,
  className = "",
}) => {
  return (
    <aside
      className={`h-full bg-white border-r border-gray-200 flex flex-col justify-between transition-all duration-200 select-none ${
        isCollapsed ? "w-[64px]" : "w-[240px]"
      } ${className}`}
    >
      {/* Top Header */}
      <div>
        <div className="h-12 border-b border-gray-200 px-4 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            {agencyLogo ? (
              <img src={agencyLogo} alt={agencyName} className="w-7 h-7 object-contain rounded" />
            ) : (
              <div
                className="w-7 h-7 rounded-md bg-[#051D35] text-white flex items-center justify-center font-semibold text-xs shrink-0"
              >
                <Building2 size={15} />
              </div>
            )}
            {!isCollapsed && (
              <span className="font-title font-semibold text-xs text-gray-900 truncate tracking-tight">
                {agencyName}
              </span>
            )}
          </div>

          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
              title={isCollapsed ? "Extinde meniu" : "Restrânge meniu"}
            >
              {isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            </button>
          )}
        </div>

        {/* Navigation Groups */}
        <div className="p-2 space-y-4 overflow-y-auto max-h-[calc(100vh-120px)] custom-scrollbar">
          {groups.map((group) => (
            <div key={group.id} className="space-y-1">
              {!isCollapsed && group.title && (
                <div className="font-title px-3 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                  {group.title}
                </div>
              )}
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={item.onClick}
                  title={isCollapsed ? item.label : undefined}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-semibold transition-all cursor-pointer ${
                    item.active
                      ? "bg-[#051D35] text-white shadow-xs"
                      : "text-gray-600 hover:bg-gray-100/70 hover:text-gray-900"
                  } ${isCollapsed ? "justify-center px-0" : ""}`}
                  style={{ borderRadius: designTokens.radius.standard }}
                >
                  <span className={`shrink-0 ${item.active ? "text-[#BE9662]" : "text-gray-500"}`}>
                    {item.icon}
                  </span>
                  {!isCollapsed && (
                    <>
                      <span className="truncate flex-1 text-left">{item.label}</span>
                      {item.badge !== undefined && (
                        <span
                          className={`text-[10px] font-mono px-2 py-1 rounded font-normal ${
                            item.active
                              ? "bg-white/20 text-white"
                              : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {item.badge}
                        </span>
                      )}
                    </>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Footer Area */}
      {footerContent && (
        <div className="p-2 border-t border-gray-100 bg-gray-50/50">{footerContent}</div>
      )}
    </aside>
  );
};
