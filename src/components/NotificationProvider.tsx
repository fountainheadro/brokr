import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { 
  Bell, BellOff, Settings, Check, RefreshCw, Sparkles, AlertTriangle, 
  Info, Shield, Copy, Play, X, Sliders, CheckSquare, Square, Volume2, VolumeX 
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { onMessage } from 'firebase/messaging';
import { getFCM, auth } from '../lib/firebase';
import { nativeNotificationService, NotificationPreferences } from '../services/nativeNotificationService';
import { notificationsService, Notification } from '../services/notificationsService';
import { viewingsService } from '../services/viewingsService';

// Context definition for notifications controller
interface NotificationContextType {
  preferences: NotificationPreferences;
  permission: NotificationPermission;
  fcmToken: string | null;
  registrationError: string | null;
  unreadCount: number;
  notificationsList: Notification[];
  isSettingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  togglePreference: (category: keyof NotificationPreferences) => void;
  requestSystemPermission: () => Promise<void>;
  triggerTestPush: (category: 'leads' | 'viewings' | 'system') => void;
  markRead: (id: string) => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [preferences, setPreferences] = useState<NotificationPreferences>(nativeNotificationService.getPreferences());
  const [permission, setPermission] = useState<NotificationPermission>(nativeNotificationService.getNotificationPermission());
  const [fcmToken, setFcmToken] = useState<string | null>(null);
  const [registrationError, setRegistrationError] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [notificationsList, setNotificationsList] = useState<Notification[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [inAppToasts, setInAppToasts] = useState<Array<{ id: string; title: string; body: string }>>([]);

  const openSettings = () => setIsSettingsOpen(true);
  const closeSettings = () => setIsSettingsOpen(false);

  // Toggle categories permissions
  const togglePreference = (category: keyof NotificationPreferences) => {
    const nextPrefs = { ...preferences, [category]: !preferences[category] };
    setPreferences(nextPrefs);
    nativeNotificationService.savePreferences(nextPrefs);
  };

  // Mark in-app list as read
  const markRead = async (id: string) => {
    await notificationsService.markAsRead(id);
  };

  // Sync notification lists and calculate unread counts for native badges
  useEffect(() => {
    let unsubNotifications: (() => void) | null = null;

    const unsubAuth = auth.onAuthStateChanged((user) => {
      if (unsubNotifications) {
        unsubNotifications();
        unsubNotifications = null;
      }

      if (user) {
        unsubNotifications = notificationsService.getNotifications((list) => {
          setNotificationsList(list);
          const unread = list.filter(n => !n.read).length;
          setUnreadCount(unread);

          // Native operating system icon dock badge synchronization
          if ('setAppBadge' in navigator) {
            if (unread > 0) {
              navigator.setAppBadge(unread).catch(e => console.warn('[PWA Badge] Failed to set badge:', e));
            } else {
              navigator.clearAppBadge().catch(e => console.warn('[PWA Badge] Failed to clear badge:', e));
            }
          }
        });
      } else {
        setNotificationsList([]);
        setUnreadCount(0);
      }
    });

    return () => {
      unsubAuth();
      if (unsubNotifications) {
        unsubNotifications();
      }
    };
  }, []);

  // Register automated synchronization to back-end cache for offline push execution
  useEffect(() => {
    let unsubViewings: (() => void) | null = null;

    const unsubAuth = auth.onAuthStateChanged((user) => {
      if (user) {
        unsubViewings = viewingsService.subscribeToAllViewings((vList) => {
          const syncPayload = {
            userId: user.uid,
            viewings: vList.map(v => ({
              id: v.id,
              date: v.date,
              hour: v.hour,
              agentId: v.agentId || user.uid,
              contactName: v.contactName || 'clientul'
            }))
          };

          user.getIdToken().then((idToken) => {
            const pToken = localStorage.getItem('brokr_preview_token');
            return fetch('/api/notifications/sync-viewings', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${idToken}`,
                ...(pToken ? { 'x-preview-token': pToken } : {}),
              },
              body: JSON.stringify(syncPayload)
            });
          })
          .then(res => res.json())
          .then(data => {
            console.log('[PWA Sync] Sync of upcoming viewings completed:', data);
          })
          .catch(err => {
            console.warn('[PWA Sync] Failed to synchronize viewings to local cache server:', err);
          });
        });
      } else {
        if (unsubViewings) {
          unsubViewings();
          unsubViewings = null;
        }
      }
    });

    return () => {
      unsubAuth();
      if (unsubViewings) unsubViewings();
    };
  }, []);

  // Safe service worker registration and FCM initialization
  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      console.warn('[PWA Notification] Service Workers are not supported by the client browser.');
      return;
    }

    const registerSWAndFCM = async () => {
      try {
        console.log('[PWA Notification] Registering Service Worker...');
        const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
          scope: '/'
        });
        console.log('[PWA Notification] SW registered successfully with scope:', registration.scope);

        // Fetch permissions and tokens
        const perm = nativeNotificationService.getNotificationPermission();
        setPermission(perm);

        if (perm === 'granted') {
          await initializeFCM();
        }
      } catch (err: any) {
        console.error('[PWA Notification] SW Registration error:', err);
        setRegistrationError(err.message || String(err));
      }
    };

    registerSWAndFCM();
  }, []);

  // Fetch the FCM device registration token
  const initializeFCM = async () => {
    try {
      setRegistrationError(null);
      const token = await nativeNotificationService.registerFCMToken();
      if (token) {
        setFcmToken(token);

        // Sync token to server-side cache
        if (auth.currentUser) {
          auth.currentUser.getIdToken().then((idToken) => {
            const pToken = localStorage.getItem('brokr_preview_token');
            return fetch('/api/notifications/register-token', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${idToken}`,
                ...(pToken ? { 'x-preview-token': pToken } : {}),
              },
              body: JSON.stringify({
                token: token,
                userId: auth.currentUser!.uid,
                email: auth.currentUser!.email || ''
              })
            });
          }).catch(err => console.warn('[PWA Notification] Failed to register token with server cache:', err));
        }
        
        // Listen to Foreground Push streams
        const messaging = await getFCM();
        if (messaging) {
          onMessage(messaging, (payload) => {
            console.log('[NotificationProvider] Captured foreground push payload:', payload);
            handleInboundNotification(
              payload.notification?.title || payload.data?.title || 'Alertă',
              payload.notification?.body || payload.data?.body || '',
              payload.data?.clickAction || '/'
            );
          });
        }
      }
    } catch (err: any) {
      console.error('[NotificationProvider] Failed to activate FCM stream:', err);
      setRegistrationError(err.message || 'Eroare la obținerea tokenului de trimitere.');
    }
  };

  // Register automatic token synchronization upon user availability
  useEffect(() => {
    if (!fcmToken) return;

    const unsubAuth = auth.onAuthStateChanged((user) => {
      if (user) {
        user.getIdToken().then((idToken) => {
          const pToken = localStorage.getItem('brokr_preview_token');
          return fetch('/api/notifications/register-token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${idToken}`,
              ...(pToken ? { 'x-preview-token': pToken } : {}),
            },
            body: JSON.stringify({
              token: fcmToken,
              userId: user.uid,
              email: user.email || ''
            })
          });
        }).catch(err => console.warn('[PWA Notification] Failed to register token with server cache:', err));
      }
    });

    return () => unsubAuth();
  }, [fcmToken]);

  // Handle active inbound notification trigger (determines visible state vs hidden native alerts)
  const handleInboundNotification = useCallback((title: string, body: string, urlPath: string = '/') => {
    const isFocused = document.visibilityState === 'visible';
    const prefs = nativeNotificationService.getPreferences();

    if (prefs.muteAll) return;

    if (isFocused) {
      // If client tab is focused/visible, show in-app premium slide-in alert
      const toastId = Math.random().toString(36).substr(2, 9);
      setInAppToasts((prev) => [...prev, { id: toastId, title, body }]);
      
      // Auto dismiss after 5 seconds
      setTimeout(() => {
        setInAppToasts((prev) => prev.filter(t => t.id !== toastId));
      }, 5000);
    }

    // Always attempt to trigger the physical native OS notification as requested by user
    nativeNotificationService.showNativeOSNotification(title, body, urlPath);
  }, []);

  // Trigger permission flows dynamically
  const requestSystemPermission = async () => {
    const response = await nativeNotificationService.requestPermission();
    setPermission(response);
    if (response === 'granted') {
      await initializeFCM();
    }
  };

  // Simulate a delay native operating-system push alert
  const triggerTestPush = (category: 'leads' | 'viewings' | 'system') => {
    let title = '';
    let body = '';
    let link = '/';

    if (category === 'leads') {
      title = 'Nou Lead Imobiliar';
      body = 'Clientul Andrei Popa dorește programarea unei vizionări pentru Apartamentul 3 Camere.';
      link = '/';
    } else if (category === 'viewings') {
      title = 'Vizionare Confirmată';
      body = 'A fost adăugat un nou eveniment în calendar: Apartament Titan - Ora 17:30.';
      link = '/calendar';
    } else {
      title = 'Mentenanță Bază Date';
      body = 'Procesul administrativ de sincronizare date CRM s-a finalizat cu succes!';
      link = '/';
    }

    if (permission !== 'granted') {
      // Use local in-app trigger if permission blocked to demonstrate capability
      const toastId = Math.random().toString(36).substr(2, 9);
      setInAppToasts((prev) => [...prev, { id: toastId, title: `[Simulare In-App] ${title}`, body }]);
      setTimeout(() => {
        setInAppToasts((prev) => prev.filter(t => t.id !== toastId));
      }, 5000);
    } else {
      // Standard native delayed alarm simulator
      nativeNotificationService.simulateNotification(title, body, category, 3, link);
    }
  };

  return (
    <NotificationContext.Provider
      value={{
        preferences,
        permission,
        fcmToken,
        registrationError,
        unreadCount,
        notificationsList,
        isSettingsOpen,
        openSettings,
        closeSettings,
        togglePreference,
        requestSystemPermission,
        triggerTestPush,
        markRead
      }}
    >
      {children}

      {/* 1. Slide-in In-App Notifications Queue and Banner Layout */}
      <div className="fixed bottom-5 right-5 z-[500] pointer-events-none flex flex-col gap-4 max-w-sm w-full font-sans">
        <AnimatePresence>
          {inAppToasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
              className="pointer-events-auto bg-white border border-gray-200 text-gray-900 p-4 rounded-lg shadow-xl flex items-start gap-3 relative overflow-hidden"
            >
              <div className="w-8 h-8 shrink-0 rounded-lg bg-[#051D35]/5 border border-[#051D35]/15 flex items-center justify-center text-[#BE9662] mt-1">
                <Sparkles size={16} />
              </div>
              <div className="flex-1 min-w-0 pr-4">
                <h4 className="font-title text-[10px] font-semibold uppercase tracking-wider text-[#BE9662]">Notificare Nouă</h4>
                <p className="text-xs font-semibold text-gray-900 mt-1 leading-snug">{toast.title}</p>
                <p className="text-[11px] text-gray-500 mt-1 font-normal leading-relaxed">{toast.body}</p>
              </div>
              <button
                onClick={() => setInAppToasts((prev) => prev.filter(t => t.id !== toast.id))}
                className="w-6 h-6 rounded-md hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-900 cursor-pointer transition-colors"
              >
                <X size={13} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* 2. Notification Preferences and Diagnostics Configuration Side-Drawer Panel */}
      <AnimatePresence>
        {isSettingsOpen && (
          <div className="fixed inset-0 z-[490] overflow-y-auto" id="notification-preferences-overlay">
            {/* Backdrop overlay */}
            <div 
              className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
              onClick={closeSettings}
            />

            <div className="flex min-h-screen items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 15 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 15 }}
                className="relative w-full max-w-lg rounded-lg bg-white p-5 shadow-2xl border border-gray-200 flex flex-col font-sans text-gray-900"
              >
                {/* Header configuration */}
                <div className="flex items-center justify-between pb-4 border-b border-gray-100 mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[#051D35]/5 border border-[#051D35]/15 text-[#051D35] flex items-center justify-center">
                      <Bell size={16} className="text-[#BE9662]" />
                    </div>
                    <div>
                      <h3 className="font-title text-sm font-semibold text-gray-900">Setări Alerte Push</h3>
                      <p className="text-[11px] text-gray-500 font-normal leading-none mt-1">Notificări native la nivel de sistem operativ (PWA)</p>
                    </div>
                  </div>
                  <button 
                    onClick={closeSettings}
                    className="w-7 h-7 rounded-md bg-white hover:bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-400 hover:text-gray-900 transition-colors cursor-pointer"
                  >
                    <X size={15} />
                  </button>
                </div>

                {/* Main panel body */}
                <div className="space-y-4">
                  {/* Status checklist section */}
                  <div className="p-3 bg-gray-50 rounded-md space-y-2 border border-gray-200">
                    <span className="block text-[10px] font-semibold uppercase text-gray-400 tracking-wider">Stare Conexiune Sistem</span>
                    
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-gray-600 flex items-center gap-1">Autentificare OS:</span>
                      {permission === 'granted' ? (
                        <span className="font-normal text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md flex items-center gap-1 leading-none">
                          <Check size={12} strokeWidth={3} /> Permis
                        </span>
                      ) : permission === 'denied' ? (
                        <span className="font-normal text-rose-600 bg-rose-50 px-2 py-1 rounded-md flex items-center gap-1 leading-none">
                          Refuzat / Blocant
                        </span>
                      ) : (
                        <button
                          onClick={requestSystemPermission}
                          className="px-3 py-1 font-semibold text-[--color-brand-navy] bg-[--color-brand-gold-light] hover:bg-[--color-brand-gold-border] rounded-lg cursor-pointer transition-colors"
                        >
                          Solicită Permisiune
                        </button>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-xs border-t border-gray-200/50 pt-2">
                      <span className="font-semibold text-gray-600 flex items-center gap-1">Sincronizare Push FCM:</span>
                      {fcmToken ? (
                        <span className="font-normal text-[--color-brand-navy] bg-[--color-brand-gold-light] border border-[--color-brand-gold-border] px-2 py-1 rounded-md flex items-center gap-1 leading-none">
                          <Check size={12} strokeWidth={3} /> Sincronizat
                        </span>
                      ) : registrationError ? (
                        <span className="font-normal text-amber-600 bg-amber-50 px-3 py-1 rounded-md max-w-[200px] truncate leading-none text-[10px]" title={registrationError}>
                          Eroare SW
                        </span>
                      ) : (
                        <span className="text-gray-400 font-normal italic">În curs de înregistrare...</span>
                      )}
                    </div>
                  </div>

                  {/* Browser warnings/limitations warnings */}
                  {permission === 'denied' && (
                    <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl flex gap-3 text-xs text-rose-800 leading-relaxed">
                      <AlertTriangle size={18} className="shrink-0 text-rose-500" />
                      <div>
                        Ar trebui să resetați permisiunea de Notificări în bara de adrese a browserului (click pe iconița de lacăt / setări) pentru a primi native push alerts.
                      </div>
                    </div>
                  )}

                  {/* VAPID/Iframe status warning */}
                  {!fcmToken && !registrationError && (
                    <div className="p-3 bg-[--color-brand-gold-light]/30 border border-[--color-brand-gold-border] rounded-xl flex gap-2 text-[11px] text-gray-700 leading-normal">
                      <Info size={16} className="shrink-0 text-[--color-brand-gold] mt-1" />
                      <div>
                        Notă: În interiorul iframe-urilor sandbox test-studio sau în modurile private, Service Workers pot fi blocați de securitatea browserului. Utilizați **Simulatorul Native** de mai jos pentru teste de validare.
                      </div>
                    </div>
                  )}

                  {/* Category toggles section */}
                  <div className="space-y-4">
                    <span className="block text-[10px] font-semibold uppercase text-gray-400 tracking-wider">Categorii Alerte Active</span>
                    
                    {/* Category: Leads */}
                    <div className={`flex items-center justify-between p-4 border rounded-2xl transition-all ${
                      preferences.leads ? 'border-orange-150 bg-orange-50/10' : 'border-gray-100 bg-white'
                    }`}>
                      <div>
                        <span className="block text-xs font-semibold text-gray-900 leading-snug">Oportunități Agenție (New Leads)</span>
                        <span className="block text-[10px] text-gray-400 mt-1 font-normal">Notificare în timp real când un nou client solicită informații la un anunț public</span>
                      </div>
                      <button
                        onClick={() => togglePreference('leads')}
                        className={`w-12 h-6 rounded-full p-1 transition-colors duration-200 cursor-pointer flex items-center ${
                          preferences.leads ? 'bg-[--color-accent] justify-end' : 'bg-gray-200 justify-start'
                        }`}
                      >
                        <motion.div layout className="w-4 h-4 rounded-full bg-white shadow" />
                      </button>
                    </div>

                    {/* Category: Calendar */}
                    <div className={`flex items-center justify-between p-4 border rounded-2xl transition-all ${
                      preferences.viewings ? 'border-orange-150 bg-orange-50/10' : 'border-gray-100 bg-white'
                    }`}>
                      <div>
                        <span className="block text-xs font-semibold text-gray-900 leading-snug">Vizionări Imobiliare (Calendar)</span>
                        <span className="block text-[10px] text-gray-400 mt-1 font-normal">Alerte referitoare la mutări, reprogramări sau vizite noi de calendar imobiliar</span>
                      </div>
                      <button
                        onClick={() => togglePreference('viewings')}
                        className={`w-12 h-6 rounded-full p-1 transition-colors duration-200 cursor-pointer flex items-center ${
                          preferences.viewings ? 'bg-[--color-accent] justify-end' : 'bg-gray-200 justify-start'
                        }`}
                      >
                        <motion.div layout className="w-4 h-4 rounded-full bg-white shadow" />
                      </button>
                    </div>

                    {/* Category: System */}
                    <div className={`flex items-center justify-between p-4 border rounded-2xl transition-all ${
                      preferences.system ? 'border-orange-150 bg-orange-50/10' : 'border-gray-100 bg-white'
                    }`}>
                      <div>
                        <span className="block text-xs font-semibold text-gray-900 leading-snug">Notificări Sistem & Raportări</span>
                        <span className="block text-[10px] text-gray-400 mt-1 font-normal">Finisări de extracție AI, diagnostic server sau notificări administrative</span>
                      </div>
                      <button
                        onClick={() => togglePreference('system')}
                        className={`w-12 h-6 rounded-full p-1 transition-colors duration-200 cursor-pointer flex items-center ${
                          preferences.system ? 'bg-[--color-accent] justify-end' : 'bg-gray-200 justify-start'
                        }`}
                      >
                        <motion.div layout className="w-4 h-4 rounded-full bg-white shadow" />
                      </button>
                    </div>

                    {/* Mute everything option */}
                    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl mt-1">
                      <div className="flex items-center gap-2 text-xs font-semibold text-gray-700">
                        {preferences.muteAll ? <VolumeX size={16} className="text-rose-500" /> : <Volume2 size={16} className="text-emerald-500" />}
                        <span>Dezactivează Sunete și Toast (Mute)</span>
                      </div>
                      <button
                        onClick={() => togglePreference('muteAll')}
                        className={`w-10 h-5 rounded-full p-1 transition-colors duration-200 cursor-pointer flex items-center ${
                          preferences.muteAll ? 'bg-rose-500 justify-end' : 'bg-gray-200 justify-start'
                        }`}
                      >
                        <motion.div layout className="w-3 h-3 rounded-full bg-white shadow" />
                      </button>
                    </div>
                  </div>

                  {/* FCM Token Copy details panel */}
                  {fcmToken && (
                    <div className="p-3 bg-gray-50 border border-gray-100 rounded-xl space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold uppercase text-gray-400 tracking-wider">Identificator Unic Dispozitiv Push (FCM Token)</span>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(fcmToken);
                            alert('Token copiat în clipboard!');
                          }}
                          className="text-[10px] text-[--color-accent] hover:underline font-semibold flex items-center gap-1 cursor-pointer"
                        >
                          <Copy size={11} /> Copiază
                        </button>
                      </div>
                      <div className="text-[10px] font-sans tabular-nums font-normal text-gray-500 break-all select-all leading-normal bg-white p-2 rounded-lg max-h-16 overflow-y-auto">
                        {fcmToken}
                      </div>
                    </div>
                  )}

                  {/* DELIGHTFUL ADDITION: Simulator sandbox Diagnostic Control block */}
                  <div className="pt-4 border-t border-gray-100 mt-6">
                    <div className="p-4 bg-orange-50/30 border border-orange-100 rounded-2xl">
                      <div className="flex items-center gap-2 mb-2">
                        <Sparkles size={14} className="text-[--color-accent]" />
                        <span className="text-xs font-semibold uppercase tracking-wider text-orange-700">Banc de Test Diagnostic Push</span>
                      </div>
                      <p className="text-[11px] text-gray-500 font-normal leading-normal">
                        Simulează alerte native OS în fundal. Apăsați pe buton, apoi minimizați rapid browserul sau schimbați tabul pentru a valida integrarea cu centrul de notificări al sistemului de operare:
                      </p>

                      <div className="grid grid-cols-3 gap-4 mt-3">
                        <button
                          onClick={() => triggerTestPush('leads')}
                          className="bg-white hover:bg-orange-50 border border-orange-100 hover:border-orange-200 text-orange-700 py-2 px-2 rounded-xl text-[10px] font-semibold flex flex-col items-center justify-center gap-1 cursor-pointer shadow-sm active:scale-95 transition-all"
                        >
                          <CheckSquare size={14} />
                          Alerte Intrări
                        </button>
                        <button
                          onClick={() => triggerTestPush('viewings')}
                          className="bg-white hover:bg-orange-50 border border-orange-100 hover:border-orange-200 text-orange-700 py-2 px-2 rounded-xl text-[10px] font-semibold flex flex-col items-center justify-center gap-1 cursor-pointer shadow-sm active:scale-95 transition-all"
                        >
                          <Play size={14} />
                          Alerte Vizionări
                        </button>
                        <button
                          onClick={() => triggerTestPush('system')}
                          className="bg-white hover:bg-orange-50 border border-orange-100 hover:border-orange-200 text-orange-700 py-2 px-2 rounded-xl text-[10px] font-semibold flex flex-col items-center justify-center gap-1 cursor-pointer shadow-sm active:scale-95 transition-all"
                        >
                          <Info size={14} />
                          Alerte Sistem
                        </button>
                      </div>
                    </div>
                  </div>

                </div>

                {/* Footer buttons */}
                <div className="mt-6 pt-4 border-t border-gray-100 flex justify-end">
                  <button
                    onClick={closeSettings}
                    className="px-5 py-3 bg-[#051D35] border border-[#051D35] hover:bg-[#0a2b4a] text-white text-xs font-semibold uppercase tracking-wider rounded-xl cursor-pointer shadow transition-all"
                  >
                    Salvez Setările
                  </button>
                </div>

              </motion.div>
            </div>
          </div>
        )}
      </AnimatePresence>
    </NotificationContext.Provider>
  );
};
