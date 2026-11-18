import { entityIdService } from './entityIdService';
import { crmApiClient } from '../core/crm/svc_crm-client';

export type ActivityType = 
  | 'Vizionare' 
  | 'Întâlnire' 
  | 'Apel' 
  | 'Evaluare' 
  | 'Semnare'
  | 'Semnare Contract' 
  | 'Notă' 
  | 'Altele';

export type ActivityStatus = 'Programată' | 'Realizată' | 'Anulată';

export interface Activity {
  id?: string;
  activityId?: string; // A1, A2, A1022...
  title?: string;
  type: ActivityType;
  propertyId?: string;
  clientId?: string;
  clientName: string;
  clientPhone?: string;
  staffId?: string;
  staffName?: string;
  date: string;
  hour: string;
  status?: ActivityStatus;
  notes?: string;
  createdAt?: any;
  updatedAt?: any;
}

const ACTIVITIES_COLLECTION = 'activities';

const cleanUndefined = (obj: any): any => {
  const result: any = {};
  for (const key in obj) {
    if (obj[key] !== undefined) {
      result[key] = obj[key];
    }
  }
  return result;
};

export const activityService = {
  addActivity: async (data: Omit<Activity, 'id' | 'createdAt' | 'updatedAt'>) => {
    const activityId = data.activityId || (await entityIdService.getNextId('activity'));
    const sanitized = cleanUndefined({
      ...data,
      activityId,
      type: data.type || 'Vizionare',
      status: data.status || 'Programată',
    });

    // Server creates in /tenants/{tenantId}/activities and mirrors to tenant-scoped tours & viewings
    return crmApiClient.create<Activity>(ACTIVITIES_COLLECTION, sanitized);
  },

  updateActivity: async (activityDocId: string, data: Partial<Activity>) => {
    await crmApiClient.update<Activity>(ACTIVITIES_COLLECTION, activityDocId, data);
  },

  deleteActivity: async (activityDocId: string) => {
    await crmApiClient.remove(ACTIVITIES_COLLECTION, activityDocId);
  },

  getActivity: async (activityDocId: string) => {
    return crmApiClient.getById<Activity>(ACTIVITIES_COLLECTION, activityDocId);
  },

  subscribeToPropertyActivities: (propertyId: string, callback: (activities: Activity[]) => void) => {
    return crmApiClient.subscribe<Activity>(ACTIVITIES_COLLECTION, callback, { propertyId });
  },

  subscribeToAllActivities: (callback: (activities: Activity[]) => void) => {
    return crmApiClient.subscribe<Activity>(ACTIVITIES_COLLECTION, callback);
  },
};
