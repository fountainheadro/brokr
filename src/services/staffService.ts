import { entityIdService } from './entityIdService';
import { crmApiClient } from '../core/crm/svc_crm-client';

export type StaffStatus = 'Activ' | 'Inactiv';

export interface StaffMember {
  id?: string;
  staffId?: string; // S1, S2, S1026...
  personalId?: string; // Legacy alias
  name: string;
  role: string;
  phone: string;
  email?: string;
  status: StaffStatus;
  zone?: string;
  notes?: string;
  createdAt?: any;
  updatedAt?: any;
}

const STAFF_COLLECTION = 'staff';

export const staffService = {
  addStaffMember: async (data: Omit<StaffMember, 'id' | 'createdAt' | 'updatedAt'>) => {
    const staffId = data.staffId || data.personalId || (await entityIdService.getNextId('staff'));
    return crmApiClient.create<StaffMember>(STAFF_COLLECTION, {
      ...data,
      staffId,
      personalId: staffId,
    });
  },

  updateStaffMember: async (id: string, data: Partial<StaffMember>) => {
    await crmApiClient.update<StaffMember>(STAFF_COLLECTION, id, data);
  },

  deleteStaffMember: async (id: string) => {
    await crmApiClient.remove(STAFF_COLLECTION, id);
  },

  getStaffMember: async (id: string) => {
    return crmApiClient.getById<StaffMember>(STAFF_COLLECTION, id);
  },

  subscribeToStaff: (callback: (members: StaffMember[]) => void) => {
    return crmApiClient.subscribe<StaffMember>(STAFF_COLLECTION, callback);
  },
};
