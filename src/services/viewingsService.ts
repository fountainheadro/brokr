import { crmApiClient } from '../core/crm/svc_crm-client';

export interface Viewing {
  id?: string;
  propertyId: string;
  contactId: string;
  contactName: string;
  agentId?: string;
  agentName?: string;
  date: string;
  hour: string;
  createdAt: any;
  updatedAt: any;
}

const VIEWINGS_COLLECTION = 'viewings';

const cleanUndefined = (obj: any): any => {
  const result: any = {};
  for (const key in obj) {
    if (obj[key] !== undefined) {
      result[key] = obj[key];
    }
  }
  return result;
};

export const viewingsService = {
  addViewing: async (viewingData: Omit<Viewing, 'id' | 'createdAt' | 'updatedAt'>) => {
    const sanitized = cleanUndefined(viewingData);
    return crmApiClient.create<Viewing>(VIEWINGS_COLLECTION, sanitized);
  },

  subscribeToPropertyViewings: (propertyId: string, callback: (viewings: Viewing[]) => void) => {
    return crmApiClient.subscribe<Viewing>(VIEWINGS_COLLECTION, callback, { propertyId });
  },

  subscribeToAllViewings: (callback: (viewings: Viewing[]) => void) => {
    return crmApiClient.subscribe<Viewing>(VIEWINGS_COLLECTION, callback);
  },

  updateViewing: async (viewingId: string, data: Partial<Viewing>) => {
    const sanitized = cleanUndefined(data);
    return crmApiClient.update<Viewing>(VIEWINGS_COLLECTION, viewingId, sanitized);
  },

  deleteViewing: async (viewingId: string) => {
    await crmApiClient.remove(VIEWINGS_COLLECTION, viewingId);
  },
};
