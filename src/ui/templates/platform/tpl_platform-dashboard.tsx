import React from "react";
import { OrgNavigationSidebar, NavGroup } from "../../organisms/common/org_navigation-sidebar";
import { OrgTopBar } from "../../organisms/common/org_top-bar";

export interface TplPlatformDashboardProps {
  navGroups: NavGroup[];
  headerTitle?: string;
  subHeader?: React.ReactNode;
  metricsSlot?: React.ReactNode;
  contentSlot: React.ReactNode;
  userMenu?: React.ReactNode;
  searchValue?: string;
  onSearchChange?: (val: string) => void;
  className?: string;
}

export const TplPlatformDashboard: React.FC<TplPlatformDashboardProps> = ({
  navGroups,
  headerTitle = "Platform Super Admin",
  subHeader,
  metricsSlot,
  contentSlot,
  userMenu,
  searchValue,
  onSearchChange,
  className = "",
}) => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = React.useState(false);

  return (
    <div className={`w-screen h-screen flex bg-gray-50 overflow-hidden font-sans ${className}`}>
      {/* Sidebar */}
      <OrgNavigationSidebar
        agencyName="OurCRM Platform"
        groups={navGroups}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        <OrgTopBar
          title={headerTitle}
          searchValue={searchValue}
          onSearchChange={onSearchChange}
          userMenu={userMenu}
        />
        {subHeader}

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 custom-scrollbar">
          {metricsSlot && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {metricsSlot}
            </div>
          )}

          <div>{contentSlot}</div>
        </main>
      </div>
    </div>
  );
};
