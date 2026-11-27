import React from "react";

export interface PlatformTelemetryDashboardTemplateProps {
  headerSlot: React.ReactNode;
  kpiStripSlot: React.ReactNode;
  provenanceStripSlot: React.ReactNode;
  workerHealthSlot: React.ReactNode;
  agencyTableSlot: React.ReactNode;
  rollupFooterSlot: React.ReactNode;
}

/**
 * Atomic Design Template for the Phase 9 Super Admin Pilot Performance & Traffic Dashboard.
 * Pure structural layout shell with clear visual cadence and single-elevation borders.
 */
export const TplPlatformTelemetryDashboard: React.FC<PlatformTelemetryDashboardTemplateProps> = ({
  headerSlot,
  kpiStripSlot,
  provenanceStripSlot,
  workerHealthSlot,
  agencyTableSlot,
  rollupFooterSlot,
}) => {
  return (
    <div className="space-y-5">
      {headerSlot}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">{kpiStripSlot}</div>
      {provenanceStripSlot}
      {agencyTableSlot}
      {workerHealthSlot}
      {rollupFooterSlot}
    </div>
  );
};
