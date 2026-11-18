import React from "react";
import { OrgNavigationSidebar, NavGroup } from "../../organisms/common/org_navigation-sidebar";
import { OrgTopBar } from "../../organisms/common/org_top-bar";

export interface TplPlatformManagementProps {
  navGroups: NavGroup[];
  title: string;
  subtitle?: string;
  toolbarSlot?: React.ReactNode;
  contentSlot: React.ReactNode;
  userMenu?: React.ReactNode;
  className?: string;
}

export const TplPlatformManagement: React.FC<TplPlatformManagementProps> = ({
  navGroups,
  title,
  subtitle,
  toolbarSlot,
  contentSlot,
  userMenu,
  className = "",
}) => {
  return (
    <div className={`w-screen h-screen flex bg-gray-50 overflow-hidden font-sans ${className}`}>
      <OrgNavigationSidebar agencyName="OurCRM Platform" groups={navGroups} />

      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        <OrgTopBar title={title} userMenu={userMenu} />

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 custom-scrollbar">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="font-title text-base font-semibold text-gray-900 tracking-tight">{title}</h2>
              {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
            </div>
            {toolbarSlot && <div className="flex items-center gap-4">{toolbarSlot}</div>}
          </div>

          <div>{contentSlot}</div>
        </main>
      </div>
    </div>
  );
};
