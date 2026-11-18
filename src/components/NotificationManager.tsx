import React, { useEffect, useRef } from 'react';
import { X, Bell } from 'lucide-react';
import { toast, Toaster, ToastBar } from 'react-hot-toast';
import { viewingsService, Viewing } from '../services/viewingsService';
import { parseISO, differenceInMinutes, isAfter } from 'date-fns';
import { nativeNotificationService } from '../services/nativeNotificationService';
import { auth } from '../lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { useNotifications } from './NotificationProvider';

export const NotificationManager: React.FC = () => {
  const sentNotifications = useRef<Set<string>>(new Set());
  const viewingsRef = useRef<Viewing[]>([]);
  const isInitialLoad = useRef(true);
  const { permission, requestSystemPermission } = useNotifications();

  // Prompt the user to grant native system alerts if permission is set to 'default'
  useEffect(() => {
    if (permission === 'default') {
      const timer = setTimeout(() => {
        toast((t) => (
          <div className="flex flex-col gap-3 font-sans min-w-[280px]">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-[#051D35]/5 border border-[#051D35]/15 text-[#051D35] flex items-center justify-center shrink-0 mt-1">
                <Bell size={15} className="text-[#BE9662]" />
              </div>
              <div className="min-w-0">
                <p className="font-title text-xs font-semibold text-gray-900 leading-tight">Activați Notificările Native</p>
                <p className="text-[11px] text-gray-500 font-normal mt-1 leading-normal">
                  Rămâneți la curent cu vizionările și activitățile programate chiar și când nu sunteți în aplicație.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-1 pt-2 border-t border-gray-100">
              <button
                onClick={() => toast.dismiss(t.id)}
                className="h-7 px-3 text-xs font-semibold text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors border border-gray-200 cursor-pointer"
              >
                Nu acum
              </button>
              <button
                onClick={async () => {
                  toast.dismiss(t.id);
                  try {
                    await requestSystemPermission();
                  } catch (err) {
                    console.error('[NotificationManager] Request permission failed:', err);
                  }
                }}
                className="h-7 px-3 text-xs font-semibold text-white bg-[#051D35] hover:bg-[#0a2b4a] rounded-md transition-colors shadow-xs cursor-pointer"
              >
                Permite Alerte
              </button>
            </div>
          </div>
        ), {
          duration: 15000,
          id: 'prompt-system-notifications'
        });
      }, 3500);

      return () => clearTimeout(timer);
    }
  }, [permission, requestSystemPermission]);

  useEffect(() => {
    let unsubFirestore: (() => void) | null = null;

    // Subscribe only when authenticated
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (user) {
        if (!unsubFirestore) {
          unsubFirestore = viewingsService.subscribeToAllViewings((v) => {
            viewingsRef.current = v;
          });
        }
      } else {
        if (unsubFirestore) {
          unsubFirestore();
          unsubFirestore = null;
        }
        viewingsRef.current = [];
        isInitialLoad.current = true;
      }
    });

    // Check interval
    const interval = setInterval(() => {
      // If not authenticated or viewings not loaded yet, skip check
      if (viewingsRef.current.length === 0) return;

      const now = new Date();
      
      // Clear very old sent notifications from the set to save memory
      if (now.getHours() === 0 && now.getMinutes() === 0) {
          sentNotifications.current.clear();
      }

      viewingsRef.current.forEach(viewing => {
        const viewingDateTime = parseISO(`${viewing.date}T${viewing.hour}:00`);
        
        // Skip if viewing was more than 30 minutes ago
        if (differenceInMinutes(now, viewingDateTime) > 30) return;

        const diffMinutes = differenceInMinutes(viewingDateTime, now);

        const thresholds = [
          { minutes: 180, label: '3 ore' },
          { minutes: 120, label: '2 ore' },
          { minutes: 60, label: '1 oră' }
        ];

        thresholds.forEach(threshold => {
          const notificationKey = `${viewing.id}-${threshold.minutes}`;
          
          // Trigger if we are at or slightly below the threshold (within 2 minutes of it)
          if (diffMinutes <= threshold.minutes && diffMinutes > threshold.minutes - 2) {
            if (isInitialLoad.current) {
               // On first run, mark as "already triggered" so we don't alert for existing past-threshold states
               sentNotifications.current.add(notificationKey);
            } else if (!sentNotifications.current.has(notificationKey)) {
              sendNotification(viewing, threshold.label);
              sentNotifications.current.add(notificationKey);
            }
          }
        });

        // Special check for "Acum" (0 minutes or very slightly in the past but we just noticed it)
        const nowKey = `${viewing.id}-now`;
        if (diffMinutes <= 0 && diffMinutes > -5) {
          if (isInitialLoad.current) {
            sentNotifications.current.add(nowKey);
          } else if (!sentNotifications.current.has(nowKey)) {
            sendNotification(viewing, 'acum');
            sentNotifications.current.add(nowKey);
          }
        }
      });

      // After first loop, we allow notifications
      if (isInitialLoad.current && viewingsRef.current.length > 0) {
        isInitialLoad.current = false;
      }
    }, 10000); // Check every 10 seconds for better responsiveness

    return () => {
      unsubAuth();
      if (unsubFirestore) {
        unsubFirestore();
      }
      clearInterval(interval);
    };
  }, []);

  const sendNotification = (viewing: Viewing, timeLabel: string) => {
    // Check preferences first before alerting
    const prefs = nativeNotificationService.getPreferences();
    if (!prefs.viewings) {
      console.log('[NotificationManager] System viewings alerts are disabled by user preferences.');
      return;
    }

    const title = 'Vizionare Programată (Brokr)';
    const body = `Vizionarea cu ${viewing.contactName} este peste ${timeLabel}.`;
    
    // Fallback/In-app visual alert
    if (timeLabel === 'acum') {
        toast.success(`Vizionarea cu ${viewing.contactName} începe ACUM!`, {
            duration: 10000,
            icon: '⏰'
        });
    } else {
        toast(`Vizionare peste ${timeLabel}: ${viewing.contactName}`, {
            duration: 10000,
            icon: '📅'
        });
    }

    // Centered Native system notification API
    nativeNotificationService.showNativeOSNotification(title, body, '/calendar');
  };

  return (
    <Toaster 
      position="bottom-right" 
      toastOptions={{
        className: 'font-sans',
        style: {
          padding: '10px 14px',
          borderRadius: '8px',
          fontSize: '12px',
          fontWeight: '600',
          boxShadow: '0 4px 16px -2px rgba(5, 29, 53, 0.12), 0 2px 6px -1px rgba(5, 29, 53, 0.08)',
          border: '1px solid #e5e7eb',
          maxWidth: '420px',
          background: '#ffffff',
          color: '#051D35',
        },
        duration: 4000,
        success: {
          style: {
            border: '1px solid rgba(16, 185, 129, 0.3)',
            background: '#ffffff',
            color: '#051D35',
          },
          iconTheme: {
            primary: '#10b981',
            secondary: '#ffffff',
          },
        },
        error: {
          style: {
            border: '1px solid rgba(239, 68, 68, 0.3)',
            background: '#ffffff',
            color: '#051D35',
          },
          iconTheme: {
            primary: '#ef4444',
            secondary: '#ffffff',
          },
        },
      }}
    >
      {(t) => (
        <ToastBar toast={t}>
          {({ icon, message }) => (
            <div className="flex items-center gap-3 w-full">
              {icon}
              <div className="flex-1 text-xs font-normal text-gray-800 leading-snug">{message}</div>
              {t.type !== 'loading' && (
                <button 
                  onClick={() => toast.dismiss(t.id)}
                  className="w-6 h-6 rounded-md hover:bg-gray-100 flex items-center justify-center transition-colors text-gray-400 hover:text-gray-900 shrink-0 cursor-pointer"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          )}
        </ToastBar>
      )}
    </Toaster>
  );
};
