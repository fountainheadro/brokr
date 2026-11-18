import React from "react";
import { Clock } from "lucide-react";

export interface TimelineEvent {
  id: string;
  title: string;
  description?: string;
  timestamp: string;
  author?: string;
  icon?: React.ReactNode;
  variant?: "brand" | "success" | "warning" | "danger" | "default";
}

export interface OrgTimelineProps {
  events: TimelineEvent[];
  className?: string;
}

export const OrgTimeline: React.FC<OrgTimelineProps> = ({ events, className = "" }) => {
  const variantStyles = {
    brand: "bg-[#051D35] text-white",
    success: "bg-emerald-500 text-white",
    warning: "bg-amber-500 text-white",
    danger: "bg-rose-500 text-white",
    default: "bg-gray-200 text-gray-700",
  };

  return (
    <div className={`relative pl-6 space-y-6 before:absolute before:left-3 before:top-2 before:bottom-2 before:w-[1px] before:bg-gray-200 ${className}`}>
      {events.map((event) => (
        <div key={event.id} className="relative group">
          {/* Dot */}
          <div
            className={`absolute -left-6 top-0 w-5 h-5 rounded-full flex items-center justify-center ring-4 ring-white shadow-2xs text-[10px] ${
              variantStyles[event.variant || "default"]
            }`}
          >
            {event.icon || <Clock size={10} />}
          </div>

          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-title text-xs font-semibold text-gray-900">{event.title}</span>
              <span className="text-[10px] text-gray-400 font-mono font-normal">{event.timestamp}</span>
              {event.author && (
                <span className="text-[10px] font-normal text-gray-500 bg-gray-100 px-2 py-1 rounded">
                  {event.author}
                </span>
              )}
            </div>

            {event.description && (
              <p className="text-xs text-gray-600 mt-1 leading-relaxed">{event.description}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};
