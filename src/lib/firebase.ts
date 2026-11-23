import { getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
  terminate,
  clearIndexedDbPersistence,
  doc,
  getDocFromServer,
  type Firestore,
} from 'firebase/firestore';
import { getMessaging, isSupported as isMessagingSupported } from 'firebase/messaging';
import firebaseConfig from '../../firebase-applet-config.json';

export type FirestoreCacheMode = 'indexeddb-multi-tab' | 'memory-fallback' | 'server';

const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);

let resolvedCacheMode: FirestoreCacheMode = 'server';

export const db: Firestore = (() => {
  if (typeof window !== 'undefined') {
    try {
      const instance = initializeFirestore(
        app,
        {
          localCache: persistentLocalCache({
            tabManager: persistentMultipleTabManager(),
          }),
          experimentalAutoDetectLongPolling: true,
        },
        firebaseConfig.firestoreDatabaseId
      );
      resolvedCacheMode = 'indexeddb-multi-tab';
      return instance;
    } catch {
      try {
        const fallbackInstance = initializeFirestore(
          app,
          {
            localCache: memoryLocalCache(),
            experimentalAutoDetectLongPolling: true,
          },
          firebaseConfig.firestoreDatabaseId
        );
        resolvedCacheMode = 'memory-fallback';
        return fallbackInstance;
      } catch {
        resolvedCacheMode = 'memory-fallback';
        return getFirestore(app, firebaseConfig.firestoreDatabaseId);
      }
    }
  }
  resolvedCacheMode = 'server';
  return getFirestore(app, firebaseConfig.firestoreDatabaseId); /* CRITICAL: The app will break without this line */
})();

export const firestoreCacheMode: FirestoreCacheMode = resolvedCacheMode;

/**
 * Terminates the local Firestore client and purges IndexedDB offline persistence
 * on explicit user sign-out so no prior account or agency records remain on disk.
 * Returns true if the local instance was terminated (caller should reload to mint a fresh runtime).
 */
export async function clearLocalFirestorePersistenceOnSignOut(): Promise<boolean> {
  if (typeof window === 'undefined' || resolvedCacheMode !== 'indexeddb-multi-tab') {
    return false;
  }
  try {
    await terminate(db);
    await clearIndexedDbPersistence(db);
    return true;
  } catch (err) {
    console.warn('[Firebase] Could not purge IndexedDB persistence on sign-out:', err);
    return false;
  }
}

export const auth = getAuth(app);

// Safe async Messaging getter to deal with sandbox iFrame missing APIs
export const getFCM = async () => {
  try {
    const supported = await isMessagingSupported();
    if (!supported) {
      console.warn('[Firebase] Fire Cloud Messaging is NOT supported in this browser context (e.g. sandboxed iframe).');
      return null;
    }
    return getMessaging(app);
  } catch (err) {
    console.error('[Firebase] Failed to check for messaging support:', err);
    return null;
  }
};

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Validate connection
async function testConnection() {
  if (typeof window === 'undefined') return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
testConnection();
