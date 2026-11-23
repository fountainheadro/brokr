import { crmApiClient } from '../core/crm/svc_crm-client';

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

export const entityIdService = {
  /**
   * Generates the next sequential ID starting at 1 and incrementing +1
   * (`L1`, `P1`, `R1`, `C1`, `S1`, `D1`, `A1`, ...), isolated strictly per verified agency tenant
   * via `/api/crm/counters/next-id` -> sharded atomic Cloud Firestore counters
   * `/tenants/{tenantId}/counters/{entityKey}`.
   * For `daily_lead`, generates `YYYY-MM-DD-N` resetting to 1 each day.
   */
  getNextId: async (type: EntityType): Promise<string> => {
    return crmApiClient.getNextId(type);
  },
};
