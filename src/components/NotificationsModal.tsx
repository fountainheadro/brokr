import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  X, 
  Bell, 
  Clock, 
  CheckCircle2, 
  CheckCheck, 
  Info, 
  Settings, 
  Inbox, 
  Compass, 
  Trash2,
  Search,
  Filter,
  ClipboardList,
  Building2
} from "lucide-react";
import { Notification, notificationsService } from "../services/notificationsService";
import { useNotifications } from "./NotificationProvider";

interface NotificationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: Notification[];
  onSelectNotification?: (notification: Notification) => void;
}

type FilterType = 'toate' | 'necitite' | 'lead' | 'viewing' | 'system';

export const NotificationsModal: React.FC<NotificationsModalProps> = ({ 
  isOpen, 
  onClose, 
  notifications,
  onSelectNotification
}) => {
  const { openSettings } = useNotifications();
  const [activeFilter, setActiveFilter] = useState<FilterType>('toate');
  const [searchQuery, setSearchQuery] = useState('');

  // Counts for filters
  const counts = useMemo(() => {
    return {
      toate: notifications.length,
      necitite: notifications.filter(n => !n.read).length,
      lead: notifications.filter(n => n.type === 'lead').length,
      viewing: notifications.filter(n => n.type === 'viewing').length,
      system: notifications.filter(n => n.type === 'system' || !n.type).length,
    };
  }, [notifications]);

  // Filtered notifications
  const filteredNotifications = useMemo(() => {
    return notifications.filter(item => {
      // Filter by tab
      if (activeFilter === 'necitite' && item.read) return false;
      if (activeFilter === 'lead' && item.type !== 'lead') return false;
      if (activeFilter === 'viewing' && item.type !== 'viewing') return false;
      if (activeFilter === 'system' && item.type !== 'system' && Boolean(item.type)) return false;

      // Filter by search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const titleMatch = item.title?.toLowerCase().includes(query);
        const msgMatch = item.message?.toLowerCase().includes(query);
        return titleMatch || msgMatch;
      }

      return true;
    });
  }, [notifications, activeFilter, searchQuery]);

  const handleMarkAsRead = (notification: Notification) => {
    if (!notification.read && notification.id) {
      notificationsService.markAsRead(notification.id);
    }
  };

  const handleMarkAllAsRead = async () => {
    await notificationsService.markAllAsRead(notifications);
  };

  const handleDelete = async (e: React.MouseEvent, notificationId?: string) => {
    e.stopPropagation();
    if (notificationId) {
      await notificationsService.deleteNotification(notificationId);
    }
  };

  const formatDate = (timestamp: any) => {
    if (!timestamp) return "";
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleString('ro-RO', { 
      day: 'numeric', 
      month: 'short', 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const getItemVisuals = (type: string) => {
    switch (type) {
      case 'cerere':
        return {
          icon: <ClipboardList size={15} className="text-amber-700" />,
          boxStyle: "bg-amber-50 text-amber-700 border border-amber-200",
          badgeStyle: "border-amber-200 bg-amber-50 text-amber-700",
          label: "Cerere"
        };
      case 'proprietate':
        return {
          icon: <Building2 size={15} className="text-[#051D35]" />,
          boxStyle: "bg-[#051D35]/10 text-[#051D35] border border-[#051D35]/20",
          badgeStyle: "border-[#051D35]/20 bg-[#051D35]/5 text-[#051D35]",
          label: "Imobil"
        };
      case 'lead':
        return {
          icon: <Inbox size={15} className="text-emerald-700" />,
          boxStyle: "bg-emerald-50 text-emerald-700 border border-emerald-200",
          badgeStyle: "border-emerald-200 bg-emerald-50 text-emerald-700",
          label: "Lead"
        };
      case 'viewing':
        return {
          icon: <Compass size={15} className="text-[#BE9662]" />,
          boxStyle: "bg-[#BE9662]/15 text-[#BE9662] border border-[#BE9662]/30",
          badgeStyle: "border-[#BE9662]/30 bg-[#BE9662]/10 text-[#051D35]",
          label: "Activitate"
        };
      case 'system':
      default:
        return {
          icon: <Info size={15} className="text-blue-700" />,
          boxStyle: "bg-blue-50 text-blue-700 border border-blue-200",
          badgeStyle: "border-blue-200 bg-blue-50 text-blue-700",
          label: "Sistem"
        };
    }
  };

  const filterTabs: { id: FilterType; label: string; count: number }[] = [
    { id: 'toate', label: 'Toate', count: counts.toate },
    { id: 'necitite', label: 'Necitite', count: counts.necitite },
    { id: 'lead', label: 'Lead-uri', count: counts.lead },
    { id: 'viewing', label: 'Activități', count: counts.viewing },
    { id: 'system', label: 'Sistem', count: counts.system },
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/40 backdrop-blur-xs z-[999]"
          />

          {/* Full-Height Drawer Menu from the Right */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 280 }}
            className="fixed inset-y-0 right-0 w-[420px] max-w-full h-full bg-white z-[1000] flex flex-col border-l border-gray-200 shadow-2xl overflow-hidden"
          >
            {/* 1. Drawer Header */}
            <div className="p-4 border-b border-gray-200 bg-white shrink-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#051D35]/5 border border-[#051D35]/15 text-[#051D35] flex items-center justify-center shrink-0">
                    <Bell size={16} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-[14px] font-bold text-gray-900 tracking-tight leading-tight">
                        Notificări
                      </h2>
                      {counts.necitite > 0 && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#BE9662]/15 text-[#051D35] border border-[#BE9662]/30">
                          {counts.necitite} noi
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-500 font-medium leading-tight mt-0.5">
                      Alerte, activități și actualizări în timp real
                    </p>
                  </div>
                </div>

                <button 
                  onClick={onClose}
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
                  title="Închide"
                >
                  <X size={18} />
                </button>
              </div>

              {/* 2. Top Filter Menu (Clienți Sub-Header Style) */}
              <div className="mt-3.5 pt-3 border-t border-gray-100">
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
                  {filterTabs.map(tab => {
                    const isActive = activeFilter === tab.id;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setActiveFilter(tab.id)}
                        className={`h-7 px-2.5 rounded-md text-xs font-semibold flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer select-none ${
                          isActive
                            ? 'bg-[#051D35] text-white shadow-xs'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                        }`}
                      >
                        <span>{tab.label}</span>
                        <span 
                          className={`text-[10px] font-mono px-1 py-0.2 rounded ${
                            isActive 
                              ? 'bg-[#BE9662] text-white' 
                              : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {tab.count}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Quick Search in notifications */}
                {notifications.length > 5 && (
                  <div className="mt-2.5 relative">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Filtrează în notificări..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full h-7 pl-7 pr-7 text-[12px] bg-gray-50/70 border border-gray-200 rounded-md focus:bg-white focus:outline-none focus:border-[#051D35] transition-colors"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 3. Notifications List Area (Scrollable with Split-Button List Item Style) */}
            <div className="flex-1 overflow-y-auto divide-y divide-gray-100 custom-scrollbar">
              {filteredNotifications.length > 0 ? (
                filteredNotifications.map((notification, idx) => {
                  const visuals = getItemVisuals(notification.type);
                  return (
                    <div
                      key={notification.id || idx}
                      onClick={() => {
                        handleMarkAsRead(notification);
                        onSelectNotification?.(notification);
                        onClose();
                      }}
                      className={`group w-full px-4 py-3 flex items-start justify-between transition-colors cursor-pointer select-none text-left relative ${
                        notification.read 
                          ? 'bg-white hover:bg-gray-50/70 opacity-75' 
                          : 'bg-[#051D35]/[0.02] hover:bg-[#051D35]/[0.05]'
                      }`}
                    >
                      {/* Unread Left Border / Indicator */}
                      {!notification.read && (
                        <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#BE9662]" />
                      )}

                      <div className="flex items-start gap-3 min-w-0 pr-3">
                        {/* Icon Box (Split Menu Style) */}
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${visuals.boxStyle}`}>
                          {visuals.icon}
                        </div>

                        {/* Title, message & timestamp */}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <h4 className={`text-xs font-semibold leading-tight truncate ${
                              notification.read ? 'text-gray-800' : 'text-gray-900 font-bold'
                            }`}>
                              {notification.title}
                            </h4>
                            {!notification.read && (
                              <span className="w-1.5 h-1.5 rounded-full bg-[#BE9662] shrink-0" />
                            )}
                          </div>

                          <p className={`text-[12px] leading-snug mt-1 ${
                            notification.read ? 'text-gray-500' : 'text-gray-700'
                          }`}>
                            {notification.message}
                          </p>

                          <div className="flex items-center gap-1.5 text-[10px] text-gray-400 mt-1.5 font-medium">
                            <Clock size={11} className="text-gray-400 shrink-0" />
                            <span>{formatDate(notification.createdAt)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Right Badge & Quick Actions */}
                      <div className="flex flex-col items-end gap-2 shrink-0 pt-0.5">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border shrink-0 ${visuals.badgeStyle}`}>
                          {visuals.label}
                        </span>

                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {!notification.read && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleMarkAsRead(notification);
                              }}
                              className="p-1 text-gray-400 hover:text-emerald-600 hover:bg-gray-100 rounded"
                              title="Marchează citită"
                            >
                              <CheckCircle2 size={13} />
                            </button>
                          )}
                          <button
                            onClick={(e) => handleDelete(e, notification.id)}
                            className="p-1 text-gray-400 hover:text-rose-600 hover:bg-gray-100 rounded"
                            title="Șterge notificarea"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
                  <div className="w-14 h-14 rounded-full bg-gray-50 border border-dashed border-gray-200 flex items-center justify-center mb-3 text-gray-300">
                    <Bell size={24} />
                  </div>
                  <p className="text-xs font-bold text-gray-800">
                    Nicio notificare găsită
                  </p>
                  <p className="text-[11px] text-gray-400 mt-1 max-w-[240px]">
                    {activeFilter === 'toate' 
                      ? 'Vei primi aici alerte despre lead-uri, activități și programări.'
                      : `Nu există notificări în categoria "${filterTabs.find(t => t.id === activeFilter)?.label}".`}
                  </p>
                </div>
              )}
            </div>

            {/* 4. Fixed Action Buttons at Base (butoanele vor fi fixate la baza) */}
            <div className="shrink-0 p-3.5 border-t border-gray-200 bg-white flex items-center gap-2.5">
              <button
                onClick={handleMarkAllAsRead}
                disabled={counts.necitite === 0}
                className={`flex-1 h-9 px-3.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer select-none ${
                  counts.necitite > 0
                    ? 'bg-[#051D35] hover:bg-[#0a2b4a] text-white shadow-xs'
                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                }`}
              >
                <CheckCheck size={14} />
                <span>Marchează citite {counts.necitite > 0 ? `(${counts.necitite})` : ''}</span>
              </button>

              <button
                onClick={() => {
                  onClose();
                  openSettings();
                }}
                className="h-9 px-3.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer select-none shrink-0"
                title="Configurare Alerte Push"
              >
                <Settings size={14} />
                <span>Setări Alerte</span>
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
