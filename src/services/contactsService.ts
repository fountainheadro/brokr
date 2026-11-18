import { entityIdService } from './entityIdService';
import { crmApiClient } from '../core/crm/svc_crm-client';

export type ContactType = 'Owner' | 'Renter' | 'Buyer' | 'Agent';

export interface Contact {
  id?: string;
  contactId?: string; // e.g. CO1, CO2, CO1026
  firstName: string;
  lastName: string;
  type: ContactType;
  phone: string;
  propertyId: string;
  commissionValue?: string;
  createdAt: any;
  updatedAt: any;
}

const CONTACTS_COLLECTION = 'contacts';

export const contactsService = {
  addContact: async (contactData: Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>) => {
    const contactId = contactData.contactId || (await entityIdService.getNextId('client'));
    return crmApiClient.create<Contact>(CONTACTS_COLLECTION, {
      ...contactData,
      contactId,
    });
  },

  updateContact: async (contactId: string, data: Partial<Contact>) => {
    await crmApiClient.update<Contact>(CONTACTS_COLLECTION, contactId, data);
  },

  subscribeToContacts: (callback: (contacts: Contact[]) => void) => {
    return crmApiClient.subscribe<Contact>(CONTACTS_COLLECTION, callback);
  },

  subscribeToPropertyContacts: (propertyId: string, callback: (contacts: Contact[]) => void) => {
    return crmApiClient.subscribe<Contact>(CONTACTS_COLLECTION, callback, { propertyId });
  },

  getContact: async (contactId: string) => {
    return crmApiClient.getById<Contact>(CONTACTS_COLLECTION, contactId);
  },

  deleteContact: async (contactId: string) => {
    await crmApiClient.remove(CONTACTS_COLLECTION, contactId);
  },
};
