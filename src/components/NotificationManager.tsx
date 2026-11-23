import React, { useEffect } from 'react';
import { X, Bell } from 'lucide-react';
import { toast, Toaster, ToastBar } from 'react-hot-toast';
import { useNotifications } from './NotificationProvider';

/**
 * Renders the application toast host and prompts users to enable native OS push notifications.
 * Phase 6: Scheduled viewing reminders are dispatched exclusively by the backend Cloud Scheduler
 * worker (/internal/workers/viewing-reminders) via FCM push with Firestore-fenced deduplication,
 * so reminders deliver reliably even when all browser tabs are closed and never duplicate.
 */
export const NotificationManager: React.FC = () => {
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
