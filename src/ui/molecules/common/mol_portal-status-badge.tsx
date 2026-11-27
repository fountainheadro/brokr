import React from "react";
import type { PortalPublicationStatus } from "../../../core/portals/typ_portal-provider";

const STATUS_META: Record<
  PortalPublicationStatus,
  { label: string; className: string }
> = {
  not_published: {
    label: "Nepublicat",
    className: "border-gray-200 bg-gray-50 text-gray-600",
  },
  ready: {
    label: "Pregătit",
    className: "border-sky-200 bg-sky-50 text-sky-800",
  },
  pending: {
    label: "În coadă",
    className: "border-amber-200 bg-amber-50 text-amber-800",
  },
  publishing: {
    label: "Se publică",
    className: "border-indigo-200 bg-indigo-50 text-indigo-800",
  },
  published: {
    label: "Publicat",
    className: "border-emerald-200 bg-emerald-50 text-emerald-800",
  },
  update_pending: {
    label: "Actualizare în coadă",
    className: "border-amber-200 bg-amber-50 text-amber-800",
  },
  rejected: {
    label: "Respins",
    className: "border-red-200 bg-red-50 text-red-700",
  },
  paused: {
    label: "Pauză",
    className: "border-slate-200 bg-slate-100 text-slate-700",
  },
  withdrawal_pending: {
    label: "Retragere în coadă",
    className: "border-amber-200 bg-amber-50 text-amber-800",
  },
  withdrawn: {
    label: "Retras",
    className: "border-gray-200 bg-gray-100 text-gray-600",
  },
  sync_error: {
    label: "Eroare sincronizare",
    className: "border-red-200 bg-red-50 text-red-700",
  },
};

export interface MolPortalStatusBadgeProps {
  status: PortalPublicationStatus;
  syncedVersion?: number;
  submittedVersion?: number;
  className?: string;
}

export const MolPortalStatusBadge: React.FC<MolPortalStatusBadgeProps> = ({
  status,
  syncedVersion,
  submittedVersion,
  className = "",
}) => {
  const meta = STATUS_META[status] || STATUS_META.not_published;
  const showVersionDrift =
    status === "published" &&
    typeof syncedVersion === "number" &&
    typeof submittedVersion === "number" &&
    submittedVersion > syncedVersion;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium leading-4 ${meta.className} ${className}`}
    >
      <span>{meta.label}</span>
      {showVersionDrift && (
        <span className="font-mono text-[10px] tabular-nums opacity-80">
          v{syncedVersion}→v{submittedVersion}
        </span>
      )}
    </span>
  );
};
