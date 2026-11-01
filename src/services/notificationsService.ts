import { 
  collection, 
  addDoc, 
  query, 
  where, 
  onSnapshot, 
  orderBy, 
  limit, 
  updateDoc, 
  deleteDoc,
  doc, 
  serverTimestamp 
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../lib/firebase';

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

    const q = query(
      collection(db, COLLECTION_NAME),
      where('userId', '==', auth.currentUser.uid),
      orderBy('createdAt', 'desc'),
      limit(20)
    );

    return onSnapshot(q, (snapshot) => {
      const notifications = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Notification[];
      callback(notifications);
    }, (error: any) => {
      if (!auth.currentUser || error?.code === 'permission-denied') {
        console.warn('[notificationsService] Listener inactive or auth changed:', error?.message);
        return;
      }
      handleFirestoreError(error, OperationType.GET, COLLECTION_NAME);
    });
  },

  markAsRead: async (notificationId: string) => {
    const notificationRef = doc(db, COLLECTION_NAME, notificationId);
    try {
      await updateDoc(notificationRef, {
        read: true
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, COLLECTION_NAME);
    }
  },

  markAllAsRead: async (notifications: Notification[]) => {
    const unread = notifications.filter(n => !n.read && n.id);
    if (unread.length === 0) return;
    try {
      await Promise.all(
        unread.map(n => updateDoc(doc(db, COLLECTION_NAME, n.id!), { read: true }))
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, COLLECTION_NAME);
    }
  },

  deleteNotification: async (notificationId: string) => {
    const notificationRef = doc(db, COLLECTION_NAME, notificationId);
    try {
      await deleteDoc(notificationRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, COLLECTION_NAME);
    }
  },

  clearAll: async (notifications: Notification[]) => {
    const withIds = notifications.filter(n => n.id);
    if (withIds.length === 0) return;
    try {
      await Promise.all(
        withIds.map(n => deleteDoc(doc(db, COLLECTION_NAME, n.id!)))
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, COLLECTION_NAME);
    }
  },

  addNotification: async (notification: Omit<Notification, 'id' | 'createdAt' | 'read' | 'userId'>) => {
    if (!auth.currentUser) return;

    try {
      await addDoc(collection(db, COLLECTION_NAME), {
        ...notification,
        read: false,
        userId: auth.currentUser.uid,
        createdAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, COLLECTION_NAME);
    }
  }
};

