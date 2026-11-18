import React from "react";
import { TplAgencyDashboard, TplAgencyDashboardProps } from "./tpl_agency-dashboard";

export interface TplAgencyManagementProps extends Omit<TplAgencyDashboardProps, "children"> {
  pageTitle: string;
  pageSubtitle?: string;
  toolbarActions?: React.ReactNode;
  filterSlot?: React.ReactNode;
  content: React.ReactNode;
}

export const TplAgencyManagement: React.FC<TplAgencyManagementProps> = ({
  pageTitle,
  pageSubtitle,
  toolbarActions,
  filterSlot,
  content,
  ...dashboardProps
}) => {
  return (
    <TplAgencyDashboard {...dashboardProps} headerTitle={pageTitle}>
      <div className="p-4 sm:p-6 space-y-4 flex-1 flex flex-col">
        {/* Title & Toolbar Row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="font-title text-base font-semibold text-gray-900 tracking-tight">{pageTitle}</h2>
            {pageSubtitle && <p className="text-xs text-gray-500 mt-1">{pageSubtitle}</p>}
          </div>

          {toolbarActions && (
            <div className="flex items-center gap-4 flex-wrap">{toolbarActions}</div>
          )}
        </div>

        {/* Filters Row */}
        {filterSlot && (
          <div className="p-3 bg-white border border-gray-200 rounded-lg shadow-2xs flex items-center gap-4 flex-wrap">
            {filterSlot}
          </div>
        )}

        {/* Main Content (Table / Kanban / Grid) */}
        <div className="flex-1 min-h-0">{content}</div>
      </div>
    </TplAgencyDashboard>
  );
};
