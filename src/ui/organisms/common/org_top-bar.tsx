import React from "react";
import { Bell, Menu } from "lucide-react";
import { AtmButton } from "../../atoms/common/atm_button";
import { MolSearchField } from "../../molecules/common/mol_search-field";

export interface OrgTopBarProps {
  title?: string;
  breadcrumbs?: React.ReactNode;
  onMobileMenuToggle?: () => void;
  searchValue?: string;
  onSearchChange?: (val: string) => void;
  notificationCount?: number;
  onNotificationClick?: () => void;
  rightActions?: React.ReactNode;
  userMenu?: React.ReactNode;
  className?: string;
}

export const OrgTopBar: React.FC<OrgTopBarProps> = ({
  title,
  breadcrumbs,
  onMobileMenuToggle,
  searchValue,
  onSearchChange,
  notificationCount = 0,
  onNotificationClick,
  rightActions,
  userMenu,
  className = "",
}) => {
  return (
    <header
      className={`h-12 bg-white border-b border-gray-200 px-4 flex items-center justify-between gap-4 sticky top-0 z-[1100] select-none ${className}`}
    >
      {/* Left: Mobile hamburger + Title/Breadcrumb */}
      <div className="flex items-center gap-4 min-w-0 flex-1">
        {onMobileMenuToggle && (
          <button
            type="button"
            onClick={onMobileMenuToggle}
            className="md:hidden p-2 rounded text-gray-500 hover:text-gray-900 hover:bg-gray-100 cursor-pointer"
            aria-label="Deschide meniu"
          >
            <Menu size={18} />
          </button>
        )}

        {breadcrumbs ? (
          breadcrumbs
        ) : title ? (
          <h1 className="font-title text-sm font-semibold text-gray-900 truncate tracking-tight">{title}</h1>
        ) : null}
      </div>

      {/* Center: Search Field (Desktop) */}
      {onSearchChange && (
        <div className="hidden lg:block w-72 max-w-xs">
          <MolSearchField
            value={searchValue || ""}
            onChange={(e) => onSearchChange(e.target.value)}
            onClear={() => onSearchChange("")}
            placeholder="Caută în agenție..."
          />
        </div>
      )}

      {/* Right: Actions, Notifications, User */}
      <div className="flex items-center gap-4 shrink-0">
        {rightActions}

        {onNotificationClick && (
          <div className="relative">
            <AtmButton
              variant="icon"
              size="sm"
              onClick={onNotificationClick}
              aria-label="Notificări"
            >
              <Bell size={16} />
            </AtmButton>
            {notificationCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 text-white font-mono text-[9px] font-bold flex items-center justify-center ring-2 ring-white">
                {notificationCount > 9 ? "9+" : notificationCount}
              </span>
            )}
          </div>
        )}

        {userMenu}
      </div>
    </header>
  );
};
