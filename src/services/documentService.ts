import { entityIdService } from './entityIdService';
import { crmApiClient } from '../core/crm/svc_crm-client';

export type DocumentType = 
  | 'Contract'
  | 'Act Proprietate'
  | 'Cadastru & Intabulare'
  | 'Releveu'
  | 'Certificat Energetic'
  | 'Carte Identitate'
  | 'Procură'
  | 'Acord GDPR'
  | 'Proces Verbal'
  | 'Altele';

export interface DocumentItem {
  id?: string;
  documentId?: string; // e.g. D01, D02, D1029
  title: string;
  type: DocumentType;
  propertyId?: string;
  clientId?: string;
  staffId?: string;
  fileUrl?: string;
  fileName?: string;
  notes?: string;
  createdAt?: any;
  updatedAt?: any;
}

const DOCUMENTS_COLLECTION = 'documents';

export const documentService = {
  addDocument: async (data: Omit<DocumentItem, 'id' | 'createdAt' | 'updatedAt'>) => {
    const documentId = data.documentId || (await entityIdService.getNextId('document'));
    return crmApiClient.create<DocumentItem>(DOCUMENTS_COLLECTION, {
      ...data,
      documentId,
    });
  },

  updateDocument: async (id: string, data: Partial<DocumentItem>) => {
    await crmApiClient.update<DocumentItem>(DOCUMENTS_COLLECTION, id, data);
  },

  deleteDocument: async (id: string) => {
    await crmApiClient.remove(DOCUMENTS_COLLECTION, id);
  },

  getDocument: async (id: string) => {
    return crmApiClient.getById<DocumentItem>(DOCUMENTS_COLLECTION, id);
  },

  subscribeToDocuments: (callback: (docs: DocumentItem[]) => void) => {
    return crmApiClient.subscribe<DocumentItem>(DOCUMENTS_COLLECTION, callback);
  },

  subscribeToPropertyDocuments: (propertyId: string, callback: (docs: DocumentItem[]) => void) => {
    return crmApiClient.subscribe<DocumentItem>(DOCUMENTS_COLLECTION, callback, { propertyId });
  },
};
