import React, { useState, useEffect, useMemo } from "react";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  Plus,
  MapPin,
  MessageSquare,
  Compass,
  CalendarDays,
  CalendarRange,
  Search,
  X,
} from "lucide-react";
import {
  format,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  addDays,
  subDays,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  isSameMonth,
  isSameDay,
  eachDayOfInterval,
  parseISO,
} from "date-fns";
import { ro } from "date-fns/locale";
import { viewingsService, Viewing } from "../services/viewingsService";
import { ViewingDetailsModal } from "./ViewingDetailsModal";
import { Lead } from "../services/leadsService";
import { Contact } from "../services/contactsService";

export type CalendarViewMode = "month" | "week" | "day";

interface CalendarViewProps {
  leads?: Lead[];
  contacts?: Contact[];
  onAddActivityClick?: (defaultDate?: string, defaultHour?: string) => void;
}

export const CalendarView: React.FC<CalendarViewProps> = ({
  leads = [],
  contacts = [],
  onAddActivityClick,
}) => {
  const [viewMode, setViewMode] = useState<CalendarViewMode>("month");
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [viewings, setViewings] = useState<Viewing[]>([]);
  const [search, setSearch] = useState("");
  const [selectedViewing, setSelectedViewing] = useState<Viewing | null>(null);
  const [isViewingDetailsOpen, setIsViewingDetailsOpen] = useState(false);

  // Subscribe to all viewings / activities while mounted
  useEffect(() => {
    const unsub = viewingsService.subscribeToAllViewings((v) => {
      setViewings(v);
    });
    return () => unsub();
  }, []);

  // Navigation handlers
  const handlePrev = () => {
    if (viewMode === "month") {
      setCurrentDate((prev) => subMonths(prev, 1));
    } else if (viewMode === "week") {
      setCurrentDate((prev) => subWeeks(prev, 1));
    } else {
      setCurrentDate((prev) => subDays(prev, 1));
    }
  };

  const handleNext = () => {
    if (viewMode === "month") {
      setCurrentDate((prev) => addMonths(prev, 1));
    } else if (viewMode === "week") {
      setCurrentDate((prev) => addWeeks(prev, 1));
    } else {
      setCurrentDate((prev) => addDays(prev, 1));
    }
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  // Title for current view
  const currentPeriodLabel = useMemo(() => {
    if (viewMode === "month") {
      return format(currentDate, "MMMM yyyy", { locale: ro });
    }
    if (viewMode === "week") {
      const start = startOfWeek(currentDate, { weekStartsOn: 1 });
      const end = endOfWeek(currentDate, { weekStartsOn: 1 });
      if (isSameMonth(start, end)) {
        return `${format(start, "d")} – ${format(end, "d MMMM yyyy", { locale: ro })}`;
      }
      return `${format(start, "d MMM", { locale: ro })} – ${format(end, "d MMM yyyy", { locale: ro })}`;
    }
    return format(currentDate, "EEEE, d MMMM yyyy", { locale: ro });
  }, [viewMode, currentDate]);

  // Activity click handler
  const handleActivityClick = (viewing: Viewing, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedViewing(viewing);
    setIsViewingDetailsOpen(true);
  };

  // Helper to get lead / property info
  const getViewingMeta = (viewing: Viewing) => {
    const lead = leads.find((l) => l.id === viewing.propertyId || l.propertyId === viewing.propertyId);
    const contact = contacts.find(
      (c) => `${c.firstName || ""} ${c.lastName || ""}`.trim() === viewing.contactName?.trim()
    );
    const loc = lead?.extractedData?.crmData?.detaliiGenerale?.localizare;
    const address = loc ? `${loc.strada || ""} ${loc.numar || ""}`.trim() : lead?.zone || "";
    const propertyId = lead?.propertyId || viewing.propertyId || "";
    return { lead, contact, address, propertyId };
  };

  const filteredViewings = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return viewings;
    return viewings.filter((v) => {
      const { address, propertyId } = getViewingMeta(v);
      return (
        (v.contactName || "").toLowerCase().includes(q) ||
        (v.agentName || "").toLowerCase().includes(q) ||
        (v.hour || "").toLowerCase().includes(q) ||
        (v.date || "").toLowerCase().includes(q) ||
        address.toLowerCase().includes(q) ||
        propertyId.toLowerCase().includes(q)
      );
    });
  }, [viewings, search, leads, contacts]);

  // Render Month View
  const renderMonthView = () => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart, { weekStartsOn: 1 });
    const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });
    const days = eachDayOfInterval({ start: startDate, end: endDate });
    const rowCount = Math.max(1, Math.ceil(days.length / 7));

    const weekHeaders = ["Luni", "Marți", "Miercuri", "Joi", "Vineri", "Sâmbătă", "Duminică"];

    return (
      <div className="flex flex-col h-full min-h-0 bg-white overflow-hidden">
        {/* Days of week header */}
        <div className="grid grid-cols-7 gap-px border-b border-gray-200 bg-gray-100 shrink-0">
          {weekHeaders.map((dayName, idx) => (
            <div
              key={idx}
              className="py-2.5 bg-gray-50/95 text-center text-[11px] font-semibold text-gray-500 uppercase tracking-wider"
            >
              <span className="hidden sm:inline">{dayName}</span>
              <span className="sm:hidden">{dayName.slice(0, 2)}</span>
            </div>
          ))}
        </div>

        {/* Days grid - every row shares equal height of container */}
        <div
          className="flex-1 min-h-0 grid grid-cols-7 gap-px bg-gray-100 overflow-hidden"
          style={{ gridTemplateRows: `repeat(${rowCount}, minmax(0, 1fr))` }}
        >
          {days.map((day) => {
            const dayViewings = filteredViewings
              .filter((v) => {
                try {
                  return isSameDay(parseISO(v.date), day);
                } catch {
                  return false;
                }
              })
              .sort((a, b) => (a.hour || "").localeCompare(b.hour || ""));
            const isCurrentMonth = isSameMonth(day, monthStart);
            const isToday = isSameDay(day, new Date());

            return (
              <div
                key={day.toISOString()}
                onClick={() => {
                  setCurrentDate(day);
                  setViewMode("day");
                }}
                className={`h-full min-h-0 min-w-0 p-2 flex flex-col overflow-hidden transition-colors cursor-pointer group ${
                  isToday
                    ? "bg-[#FDF9F3] ring-1 ring-inset ring-[#BE9662]/40 hover:bg-[#FAF3E8]"
                    : !isCurrentMonth
                    ? "bg-gray-50/95 text-gray-300 hover:bg-gray-100/70"
                    : "bg-white hover:bg-gray-50/80"
                }`}
              >
                {/* Day Number Header */}
                <div className="flex items-center justify-between mb-1 shrink-0">
                  <span
                    className={`text-xs font-normal w-6 h-6 rounded-md flex items-center justify-center transition-all tabular-nums ${
                      isToday
                        ? "bg-[#051D35] text-white shadow-xs"
                        : isCurrentMonth
                        ? "text-gray-900 group-hover:text-[#051D35]"
                        : "text-gray-300"
                    }`}
                  >
                    {format(day, "d")}
                  </span>

                  {dayViewings.length > 0 && (
                    <span className="text-[10px] font-sans tabular-nums font-normal px-1.5 py-0.5 rounded bg-[#BE9662]/15 text-[#051D35] border border-[#BE9662]/30 leading-none">
                      {dayViewings.length}
                    </span>
                  )}
                </div>

                {/* Day Viewings List */}
                <div className="flex-1 min-h-0 space-y-1 overflow-y-auto no-scrollbar">
                  {dayViewings.map((viewing, vIdx) => {
                    const { address } = getViewingMeta(viewing);
                    return (
                      <div
                        key={viewing.id || vIdx}
                        onClick={(e) => handleActivityClick(viewing, e)}
                        className="px-1.5 py-1 rounded bg-gray-50 hover:bg-[#051D35]/5 border border-gray-200 hover:border-[#051D35]/30 text-left transition-colors cursor-pointer truncate"
                        title={`${viewing.hour} - ${viewing.contactName} ${address ? `(${address})` : ""}`}
                      >
                        <div className="flex items-center gap-1.5 text-[11px] font-normal text-gray-800 leading-tight truncate">
                          <span className="text-[#BE9662] font-sans tabular-nums text-[10px] shrink-0">
                            {viewing.hour}
                          </span>
                          <span className="truncate">{viewing.contactName || "Activitate"}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Render Week View
  const renderWeekView = () => {
    const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });
    const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

    return (
      <div className="flex flex-col h-full bg-white overflow-hidden">
        {/* Days Header */}
        <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50/80 shrink-0">
          {weekDays.map((day) => {
            const isToday = isSameDay(day, new Date());
            return (
              <div
                key={day.toISOString()}
                onClick={() => {
                  setCurrentDate(day);
                  setViewMode("day");
                }}
                className={`py-2.5 px-2 text-center border-r border-gray-100 last:border-r-0 cursor-pointer hover:bg-gray-100/70 transition-colors ${
                  isToday ? "bg-[#BE9662]/[0.08]" : ""
                }`}
              >
                <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                  {format(day, "EEE", { locale: ro })}
                </div>
                <div
                  className={`text-xs font-normal tabular-nums inline-flex items-center justify-center w-6 h-6 rounded-md mt-1 ${
                    isToday ? "bg-[#051D35] text-white shadow-xs" : "text-gray-900"
                  }`}
                >
                  {format(day, "d")}
                </div>
              </div>
            );
          })}
        </div>

        {/* Week Day Columns */}
        <div className="flex-1 grid grid-cols-7 divide-x divide-gray-100 overflow-y-auto custom-scrollbar">
          {weekDays.map((day) => {
            const dayViewings = filteredViewings
              .filter((v) => {
                try {
                  return isSameDay(parseISO(v.date), day);
                } catch {
                  return false;
                }
              })
              .sort((a, b) => (a.hour || "").localeCompare(b.hour || ""));

            const isToday = isSameDay(day, new Date());

            return (
              <div
                key={day.toISOString()}
                className={`p-2.5 flex flex-col gap-2 min-h-full ${
                  isToday ? "bg-[#BE9662]/[0.02]" : "bg-white"
                }`}
              >
                {dayViewings.length > 0 ? (
                  <>
                    {dayViewings.map((viewing, idx) => {
                      const { address, propertyId, contact } = getViewingMeta(viewing);
                      return (
                        <div
                          key={viewing.id || idx}
                          onClick={() => handleActivityClick(viewing)}
                          className="p-2.5 rounded-lg bg-white border border-gray-200 hover:border-[#051D35]/30 hover:shadow-xs transition-all cursor-pointer text-left group"
                        >
                          <div className="flex items-center justify-between gap-1 mb-1">
                            <span className="text-[10px] font-sans tabular-nums font-normal text-[#BE9662] flex items-center gap-1">
                              <Clock size={10} />
                              {viewing.hour}
                            </span>
                            {propertyId && (
                              <span className="text-[9px] font-sans tabular-nums font-normal px-1 rounded bg-[#051D35]/5 text-[#051D35] border border-[#051D35]/15">
                                #{propertyId}
                              </span>
                            )}
                          </div>

                          <h4 className="font-title text-[11px] font-semibold text-gray-900 leading-tight group-hover:text-[#051D35] truncate">
                            {viewing.contactName}
                          </h4>

                          {address && (
                            <p className="text-[10px] font-normal text-gray-500 truncate mt-1">
                              {address}
                            </p>
                          )}

                          <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between text-[9px] text-gray-400">
                            <span className="font-semibold text-gray-600">Activitate</span>
                            {contact?.phone && (
                              <span className="text-emerald-700 font-sans">WhatsApp</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => onAddActivityClick?.(format(day, "yyyy-MM-dd"))}
                      className="mt-1 py-1.5 px-2 rounded border border-dashed border-gray-200 hover:border-[#BE9662] hover:bg-[#BE9662]/5 text-[10px] text-gray-400 hover:text-gray-700 font-semibold flex items-center justify-center gap-1 transition-colors cursor-pointer"
                    >
                      <Plus size={11} />
                      <span>Adaugă</span>
                    </button>
                  </>
                ) : (
                  <div
                    onClick={() => onAddActivityClick?.(format(day, "yyyy-MM-dd"))}
                    className="flex-1 flex flex-col items-center justify-center p-3 rounded border border-dashed border-gray-200 hover:border-[#BE9662] hover:bg-[#BE9662]/5 transition-colors cursor-pointer text-center group"
                  >
                    <Plus size={14} className="text-gray-300 group-hover:text-[#BE9662] mb-1" />
                    <span className="text-[10px] text-gray-400 group-hover:text-gray-700 font-semibold">
                      Adaugă
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Render Day View (Half-hour slots)
  const renderDayView = () => {
    const hours: string[] = [];
    for (let h = 8; h <= 20; h++) {
      const hStr = h.toString().padStart(2, "0");
      hours.push(`${hStr}:00`);
      hours.push(`${hStr}:30`);
    }
    hours.push("21:00");

    const timeToMinutes = (t?: string): number => {
      if (!t) return -1;
      const parts = t.trim().split(":");
      const h = parseInt(parts[0], 10);
      const m = parts[1] ? parseInt(parts[1], 10) : 0;
      if (isNaN(h)) return -1;
      return h * 60 + (isNaN(m) ? 0 : m);
    };

    const dayViewings = filteredViewings.filter((v) => {
      try {
        return isSameDay(parseISO(v.date), currentDate);
      } catch {
        return false;
      }
    });

    const isToday = isSameDay(currentDate, new Date());

    return (
      <div className="flex flex-col h-full bg-white overflow-hidden">
        {/* Day Header Banner */}
        <div className="px-5 py-3 border-b border-gray-200 bg-gray-50/70 flex items-center justify-between shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-title text-sm font-semibold text-gray-900 capitalize">
                {format(currentDate, "EEEE, d MMMM yyyy", { locale: ro })}
              </h3>
              {isToday && (
                <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-[#051D35] text-white leading-none">
                  Azi
                </span>
              )}
            </div>
            <p className="text-[11px] text-gray-500 font-normal mt-1">
              {dayViewings.length === 0
                ? "Nicio activitate programată pentru această zi"
                : `${dayViewings.length} ${
                    dayViewings.length === 1 ? "activitate programată" : "activități programate"
                  }`}
            </p>
          </div>

          <button
            type="button"
            onClick={() => onAddActivityClick?.(format(currentDate, "yyyy-MM-dd"), "09:00")}
            className="h-8 px-3 rounded-md bg-[#051D35] hover:bg-[#0a2b4a] text-white text-xs font-semibold flex items-center gap-2 shadow-xs transition-colors cursor-pointer"
          >
            <Plus size={14} className="text-[#BE9662]" />
            <span>Adaugă la această dată</span>
          </button>
        </div>

        {/* Half-hourly Timeline */}
        <div className="flex-1 overflow-y-auto divide-y divide-gray-100 p-4 space-y-2 custom-scrollbar">
          {hours.map((hourSlot) => {
            const isFullHour = hourSlot.endsWith(":00");
            const slotStartMin = timeToMinutes(hourSlot);
            const slotEndMin = slotStartMin + 30;

            const matchedViewings = dayViewings.filter((v) => {
              const vMin = timeToMinutes(v.hour);
              if (vMin === -1) {
                return (v.hour || "").trim() === hourSlot;
              }
              return vMin >= slotStartMin && vMin < slotEndMin;
            });

            return (
              <div key={hourSlot} className={`flex items-start gap-4 ${isFullHour ? "pt-2" : "pt-1"}`}>
                {/* Time Label */}
                <div className="w-12 text-right shrink-0 pt-1 select-none">
                  <span
                    className={`font-sans tabular-nums text-xs ${
                      isFullHour ? "font-semibold text-gray-800" : "font-normal text-gray-400 text-[11px]"
                    }`}
                  >
                    {hourSlot}
                  </span>
                </div>

                {/* Timeline Slot Content */}
                <div className="flex-1 min-w-0">
                  {matchedViewings.length > 0 ? (
                    <div className="space-y-2">
                      {matchedViewings.map((viewing, idx) => {
                        const { address, propertyId, contact } = getViewingMeta(viewing);
                        return (
                          <div
                            key={viewing.id || idx}
                            onClick={() => handleActivityClick(viewing)}
                            className="p-3 rounded-lg border border-gray-200 bg-white hover:border-[#051D35]/30 hover:shadow-xs transition-all cursor-pointer group"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-3 min-w-0">
                                <div className="w-7 h-7 rounded-md bg-[#BE9662]/15 border border-[#BE9662]/30 text-[#BE9662] flex items-center justify-center shrink-0 mt-1">
                                  <Compass size={15} />
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <h4 className="font-title text-xs font-semibold text-gray-900 group-hover:text-[#051D35] truncate">
                                      {viewing.contactName}
                                    </h4>
                                    <span className="text-[10px] font-sans tabular-nums px-2 py-1 rounded bg-[#BE9662]/15 text-[#051D35] border border-[#BE9662]/30 font-normal leading-none">
                                      {viewing.hour}
                                    </span>
                                    {propertyId && (
                                      <span className="text-[10px] font-sans tabular-nums px-2 py-1 rounded bg-[#051D35]/5 text-[#051D35] border border-[#051D35]/15 font-normal leading-none">
                                        #{propertyId}
                                      </span>
                                    )}
                                  </div>

                                  {address && (
                                    <p className="text-[11px] text-gray-600 flex items-center gap-2 mt-1 font-normal truncate">
                                      <MapPin size={11} className="text-gray-400 shrink-0" />
                                      <span className="truncate">{address}</span>
                                    </p>
                                  )}

                                  {viewing.agentName && (
                                    <p className="text-[10px] text-gray-400 mt-1">
                                      <span className="font-semibold">Agent:</span>{" "}
                                      <span className="text-gray-700 font-normal">{viewing.agentName}</span>
                                    </p>
                                  )}
                                </div>
                              </div>

                              {contact?.phone && (
                                <a
                                  href={`https://wa.me/${contact.phone.replace(/[^0-9]/g, "")}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="h-7 px-3 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 text-[11px] font-semibold flex items-center gap-2 transition-colors shrink-0"
                                  title="Trimite mesaj WhatsApp"
                                >
                                  <MessageSquare size={12} />
                                  <span>WhatsApp</span>
                                </a>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div
                      onClick={() => onAddActivityClick?.(format(currentDate, "yyyy-MM-dd"), hourSlot)}
                      className="h-7 px-3 rounded-md border border-dashed border-gray-200 hover:border-[#051D35]/30 hover:bg-gray-50 flex items-center text-gray-400 hover:text-gray-700 text-xs font-normal cursor-pointer transition-colors group"
                    >
                      <span className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-2 text-[11px]">
                        <Plus size={11} className="text-[#BE9662]" />
                        Programează activitate la {hourSlot}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-gray-50 overflow-hidden">
      {/* Top Header / Action Bar (matching Cereri / Proprietati / Contacte / Personal) */}
      <div className="bg-white border-b border-gray-200 shrink-0 h-[42px] min-h-[42px] max-h-[42px] box-border px-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <CalendarIcon size={16} className="text-[#BE9662] shrink-0" />
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="font-title text-[15px] font-semibold tracking-tight text-[#051D35] truncate leading-tight">
              Calendar
            </h2>
            <span className="text-[11px] font-normal text-gray-500 bg-gray-100 px-2 py-0.5 rounded tabular-nums leading-none shrink-0">
              {viewings.length} total
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Quick Search */}
          <div className="relative w-56 sm:w-64">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Caută după client, ID (#P...), zonă, agent..."
              className="w-full h-8 pl-9 pr-7 text-xs font-normal bg-gray-50 border border-gray-200 rounded-md placeholder:text-gray-400 focus:outline-none focus:bg-white focus:border-gray-400 transition-colors font-sans"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer"
                title="Șterge căutarea"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Add Activity Button */}
          <button
            type="button"
            onClick={() => onAddActivityClick?.(format(currentDate, "yyyy-MM-dd"))}
            className="h-8 px-3 flex items-center gap-2 text-xs font-semibold bg-[#051D35] hover:bg-[#0a2b4a] text-white rounded-md transition-colors cursor-pointer shrink-0 shadow-xs"
          >
            <Plus size={14} className="text-[#BE9662]" />
            <span>Adaugă Activitate</span>
          </button>
        </div>
      </div>

      {/* Sub-header Filter Tabs & Date Navigation */}
      <div className="bg-transparent border-b border-gray-200 shrink-0 px-6 h-[42px] min-h-[42px] max-h-[42px] box-border flex items-center justify-between gap-4 overflow-x-auto no-scrollbar">
        {/* Left: View mode tabs */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setViewMode("month")}
            className={`h-7 px-3 flex items-center gap-2 text-xs rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              viewMode === "month"
                ? "bg-[#051D35] text-white font-semibold shadow-xs"
                : "text-gray-600 hover:text-[#051D35] hover:bg-gray-100 font-semibold"
            }`}
          >
            <CalendarDays size={13} />
            <span>Lună</span>
          </button>

          <button
            type="button"
            onClick={() => setViewMode("week")}
            className={`h-7 px-3 flex items-center gap-2 text-xs rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              viewMode === "week"
                ? "bg-[#051D35] text-white font-semibold shadow-xs"
                : "text-gray-600 hover:text-[#051D35] hover:bg-gray-100 font-semibold"
            }`}
          >
            <CalendarRange size={13} />
            <span>Săptămână</span>
          </button>

          <button
            type="button"
            onClick={() => setViewMode("day")}
            className={`h-7 px-3 flex items-center gap-2 text-xs rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              viewMode === "day"
                ? "bg-[#051D35] text-white font-semibold shadow-xs"
                : "text-gray-600 hover:text-[#051D35] hover:bg-gray-100 font-semibold"
            }`}
          >
            <Clock size={13} />
            <span>Zi</span>
          </button>
        </div>

        {/* Right: Period Navigation */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleToday}
            className="h-7 px-3 rounded-md border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold transition-colors cursor-pointer"
          >
            Azi
          </button>

          <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-md">
            <button
              type="button"
              onClick={handlePrev}
              className="h-5 w-6 flex items-center justify-center rounded text-gray-600 hover:bg-white hover:text-[#051D35] transition-colors cursor-pointer"
              title="Perioada precedentă"
            >
              <ChevronLeft size={14} />
            </button>

            <span className="text-[11px] font-semibold text-[#051D35] px-2 min-w-[140px] text-center capitalize select-none">
              {currentPeriodLabel}
            </span>

            <button
              type="button"
              onClick={handleNext}
              className="h-5 w-6 flex items-center justify-center rounded text-gray-600 hover:bg-white hover:text-[#051D35] transition-colors cursor-pointer"
              title="Perioada următoare"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Main Calendar Canvas */}
      <div className="flex-1 overflow-hidden p-6 min-h-0 flex flex-col">
        <div className="flex-1 bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden flex flex-col min-h-0">
          {viewMode === "month" && renderMonthView()}
          {viewMode === "week" && renderWeekView()}
          {viewMode === "day" && renderDayView()}
        </div>
      </div>

      {/* Activity / Viewing Details Modal */}
      <ViewingDetailsModal
        isOpen={isViewingDetailsOpen}
        onClose={() => setIsViewingDetailsOpen(false)}
        viewing={selectedViewing}
      />
    </div>
  );
};
