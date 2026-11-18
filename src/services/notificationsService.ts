import { auth } from '../lib/firebase';
import { crmApiClient } from '../core/crm/svc_crm-client';

export interface Notification {
  id?: string;
  title: string;
  message: string;
  type: 'lead' | 'viewing' | 'system' | 'cerere' | 'proprietate';
  entityId?: string;
  propertyId?: string;
  targetType?: 'lead' | 'property' | 'cerere' | 'viewing' | 'contact';
  url?: string;
  createdAt: any;
  read: boolean;
  userId: string;
}

const COLLECTION_NAME = 'notifications';

export const notificationsService = {
  getNotifications: (callback: (notifications: Notification[]) => void) => {
    if (!auth.currentUser) return () => {};
    return crmApiClient.subscribe<Notification>(COLLECTION_NAME, callback, {
      onlyMine: true,
      transform: (items) => items.slice(0, 20),
    });
  },

  markAsRead: async (notificationId: string) => {
    await crmApiClient.update<Notification>(COLLECTION_NAME, notificationId, { read: true });
  },

  markAllAsRead: async (notifications: Notification[]) => {
    const unread = notifications.filter((n) => !n.read && n.id);
    if (unread.length === 0) return;
    await Promise.all(
      unread.map((n) =>
        crmApiClient.update<Notification>(COLLECTION_NAME, n.id!, { read: true })
      )
    );
  },

  deleteNotification: async (notificationId: string) => {
    await crmApiClient.remove(COLLECTION_NAME, notificationId);
  },

  clearAll: async (notifications: Notification[]) => {
    const withIds = notifications.filter((n) => n.id);
    if (withIds.length === 0) return;
    await Promise.all(withIds.map((n) => crmApiClient.remove(COLLECTION_NAME, n.id!)));
  },

  addNotification: async (
    notification: Omit<Notification, 'id' | 'createdAt' | 'read' | 'userId'>
  ) => {
    if (!auth.currentUser) return;
    await crmApiClient.create<Notification>(COLLECTION_NAME, {
      ...notification,
      read: false,
      userId: auth.currentUser.uid,
    });
  },
};
