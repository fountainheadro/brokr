// Brokr CRM - Native PWA Background Push Notification Service Worker
// Import Google Firebase scripts inside the Background Service Worker thread
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js');

// Initialize Firebase with the explicit project configuration
firebase.initializeApp({
  projectId: "brokr-42038",
  appId: "1:114574797752:web:57e0a934e559d20dea7d4d",
  apiKey: "AIzaSyAzk6Xk0EoIVY82TrUQjVwJ1uOdv3B34wo",
  authDomain: "brokr-42038.firebaseapp.com",
  storageBucket: "brokr-42038.firebasestorage.app",
  messagingSenderId: "114574797752"
});

// Retrieve the Firebase Cloud Messaging context
const messaging = firebase.messaging();

// Handle background push messages received when the app is closed/inactive
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received native background message payload:', payload);

  // Extract visual fields from the standard nested payload structure
  const title = payload.notification?.title || payload.data?.title || 'Notificare Nouă (Brokr)';
  const body = payload.notification?.body || payload.data?.body || 'Aveți o actualizare nouă în CRM.';
  const icon = payload.notification?.icon || payload.data?.icon || '/icon-192.png';
  const tag = payload.notification?.tag || payload.data?.tag || 'brokr-crm-notification';
  const clickAction = payload.notification?.click_action || payload.data?.click_action || payload.data?.clickAction || '/';

  const notificationOptions = {
    body: body,
    icon: icon,
    badge: '/icon-192.png',
    tag: tag,
    renotify: true,
    vibrate: [100, 50, 100],
    data: {
      clickAction: clickAction
    }
  };

  return self.registration.showNotification(title, notificationOptions);
});

// Handle OS-level user clicks on background notifications.
// Closes the banner, focuses on an existing workspace tab if open, or deep-routes to the targeted URL path.
self.addEventListener('notificationclick', (event) => {
  console.log('[firebase-messaging-sw.js] Native notification Banner clicked:', event);
  event.notification.close();

  const clickAction = event.notification.data?.clickAction || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Find a client tab matches the destination host to focus
      for (let client of windowClients) {
        // Match host/port URL checks safely
        const clientUrl = new URL(client.url);
        const destinationUrl = new URL(clickAction, self.location.href);
        if (clientUrl.pathname === destinationUrl.pathname && 'focus' in client) {
          return client.focus();
        }
      }
      // Or launch a standalone tab/window routing correctly
      if (clients.openWindow) {
        return clients.openWindow(clickAction);
      }
    })
  );
});
