import React from "react";
import { OrgNavigationSidebar, NavGroup } from "../../organisms/common/org_navigation-sidebar";
import { OrgTopBar } from "../../organisms/common/org_top-bar";

export interface TplAgencyDashboardProps {
  agencyName: string;
  agencyLogo?: string | null;
  navGroups: NavGroup[];
  headerTitle?: string;
  breadcrumbs?: React.ReactNode;
  headerRightSlot?: React.ReactNode;
  userMenu?: React.ReactNode;
  searchValue?: string;
  onSearchChange?: (val: string) => void;
  notificationCount?: number;
  onNotificationClick?: () => void;
  children: React.ReactNode;
  className?: string;
}

export const TplAgencyDashboard: React.FC<TplAgencyDashboardProps> = ({
  agencyName,
  agencyLogo,
  navGroups,
  headerTitle,
  breadcrumbs,
  headerRightSlot,
  userMenu,
  searchValue,
  onSearchChange,
  notificationCount = 0,
  onNotificationClick,
  children,
  className = "",
}) => {
  const [isCollapsed, setIsCollapsed] = React.useState(false);

  return (
    <div className={`w-screen h-screen flex bg-gray-50 overflow-hidden font-sans ${className}`}>
      {/* Sidebar */}
      <OrgNavigationSidebar
        agencyName={agencyName}
        agencyLogo={agencyLogo}
        groups={navGroups}
        isCollapsed={isCollapsed}
        onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
      />

      {/* Main Container */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        <OrgTopBar
          title={headerTitle}
          breadcrumbs={breadcrumbs}
          searchValue={searchValue}
          onSearchChange={onSearchChange}
          notificationCount={notificationCount}
          onNotificationClick={onNotificationClick}
          rightActions={headerRightSlot}
          userMenu={userMenu}
        />

        <main className="flex-1 overflow-y-auto custom-scrollbar flex flex-col">
          {children}
        </main>
      </div>
    </div>
  );
};
