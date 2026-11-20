import { doc, runTransaction } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { crmApiClient } from '../core/crm/svc_crm-client';
import { formatDailyLeadId, getDailyLeadDateKey } from '../utils/leadIdUtils';

export type EntityType =
  | 'lead'
  | 'daily_lead'
  | 'request'
  | 'cerere'
  | 'property'
  | 'client'
  | 'contact'
  | 'staff'
  | 'personal'
  | 'document'
  | 'activity'
  | 'activitate'
  | 'tour'
  | 'viewing';

const PREFIX_MAP: Record<string, string> = {
  lead: 'L',
  request: 'R',
  cerere: 'R',
  property: 'P',
  client: 'C',
  contact: 'C',
  staff: 'S',
  personal: 'S',
  document: 'D',
  activity: 'A',
  activitate: 'A',
  tour: 'A',
  viewing: 'A',
};

function normalizeCounterKey(type: EntityType): string {
  if (type === 'cerere') return 'request';
  if (type === 'contact') return 'client';
  if (type === 'personal') return 'staff';
  if (type === 'activitate' || type === 'tour' || type === 'viewing') return 'activity';
  return type;
}

const LOCAL_COUNTER_STORAGE_KEY = 'brokr_entity_id_counters';

function nextLocalSequentialNumber(key: string): number {
  try {
    const raw =
      typeof window !== 'undefined'
        ? window.localStorage.getItem(LOCAL_COUNTER_STORAGE_KEY)
        : null;
    const map: Record<string, number> = raw ? JSON.parse(raw) : {};
    const current =
      typeof map[key] === 'number' && Number.isFinite(map[key]) && map[key] >= 0
        ? Math.floor(map[key])
        : 0;
    const next = current + 1;
    map[key] = next;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LOCAL_COUNTER_STORAGE_KEY, JSON.stringify(map));
    }
    return next;
  } catch {
    return 1;
  }
}

export const entityIdService = {
  /**
   * Generates the next sequential ID starting at 1 and incrementing +1
   * (`L1`, `P1`, `R1`, `C1`, `S1`, `D1`, `A1`, ...), isolated strictly per verified agency tenant
   * via `/api/crm/counters/next-id` -> `/tenants/{tenantId}/counters/entities`.
   * For `daily_lead`, generates `YYYY-MM-DD-N` resetting to 1 each day.
   */
  getNextId: async (type: EntityType): Promise<string> => {
    const isDaily = type === 'daily_lead';
    const dateKey = isDaily ? getDailyLeadDateKey() : '';
    const prefix = PREFIX_MAP[type] || 'X';
    const key = isDaily ? `daily_lead_${dateKey}` : normalizeCounterKey(type);
    try {
      return await crmApiClient.getNextId(type);
    } catch (error) {
      console.warn(
        `[entityIdService] Falling back to Firestore sequential counter for ${type}:`,
        error
      );
      if (auth.currentUser) {
        try {
          const counterRef = doc(db, 'counters', 'entities');
          const nextNum = await runTransaction(db, async (tx) => {
            const snap = await tx.get(counterRef);
            const current =
              snap.exists() && typeof snap.data()?.[key] === 'number'
                ? Math.max(0, Math.floor(snap.data()?.[key]))
                : 0;
            const next = current + 1;
            tx.set(
              counterRef,
              {
                [key]: next,
                updatedAt: new Date().toISOString(),
              },
              { merge: true }
            );
            return next;
          });
          return isDaily ? formatDailyLeadId(dateKey, nextNum) : `${prefix}${nextNum}`;
        } catch (fsErr) {
          console.warn(
            `[entityIdService] Firestore counter fallback failed for ${type}:`,
            fsErr
          );
        }
      }
      const nextNum = nextLocalSequentialNumber(key);
      return isDaily ? formatDailyLeadId(dateKey, nextNum) : `${prefix}${nextNum}`;
    }
  },
};
