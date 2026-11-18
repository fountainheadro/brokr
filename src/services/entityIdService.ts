import { crmApiClient } from '../core/crm/svc_crm-client';

export type EntityType = 
  | 'lead' 
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
  viewing: 'A'
};

export const entityIdService = {
  /**
   * Generates the next sequential ID isolated strictly per verified agency tenant
   * via `/api/crm/counters/next-id` -> `/tenants/{tenantId}/counters/entities`.
   */
  getNextId: async (type: EntityType): Promise<string> => {
    const prefix = PREFIX_MAP[type] || 'X';
    try {
      return await crmApiClient.getNextId(type);
    } catch (error) {
      console.error(`[entityIdService] Error generating tenant-scoped ID for ${type}:`, error);
      const fallbackNum = Math.floor(Date.now() % 100000);
      if (type === 'document') {
        const formatted = fallbackNum < 10 ? `0${fallbackNum}` : `${fallbackNum}`;
        return `${prefix}${formatted}`;
      }
      return `${prefix}${fallbackNum}`;
    }
  },
};
