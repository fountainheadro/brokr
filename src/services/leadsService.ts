import { 
  collection, 
  addDoc, 
  updateDoc, 
  doc, 
  onSnapshot, 
  query, 
  orderBy, 
  serverTimestamp, 
  getDoc,
  deleteDoc,
  getDocs,
  where
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { ExtractionResult } from './geminiService';
import { entityIdService } from './entityIdService';

export type LeadStatus = 
  | 'Noi'
  | 'Pierdute'
  | 'Nevalidata' 
  | 'Calificata' 
  | 'Activa' 
  | 'InNegociere' 
  | 'Finalizata' 
  | 'Arhiva' 
  | 'Sterse' 
  | 'AreInteres' 
  | 'Noua' 
  | 'Prospectare'
  | 'Colaborare'
  | 'Calificare' 
  | 'Matching' 
  | 'Vizionare' 
  | 'Ofertare' 
  | 'Antecontract' 
  | 'Contract';

export const LEADS_STATUSES: LeadStatus[] = [
  'Noi',
  'Pierdute'
];

export const PROPRIETATI_STATUSES: LeadStatus[] = [
  'Noua',
  'Prospectare',
  'Colaborare',
  'Vizionare',
  'Ofertare',
  'Antecontract',
  'Contract'
];

export const CERERI_STATUSES: LeadStatus[] = [
  'Noua',
  'Calificare',
  'Matching',
  'Vizionare',
  'Ofertare',
  'Antecontract',
  'Contract'
];

export const isCerereLead = (l?: { status?: string; title?: string; notes?: string; propertyId?: string } | null): boolean => {
  if (!l) return false;
  if (l.propertyId && (l.propertyId.startsWith('P') || l.propertyId.startsWith('L'))) return false;
  if (l.propertyId && l.propertyId.startsWith('R')) return true;
  if (l.title && l.title.toLowerCase().startsWith('cerere')) return true;
  if (l.status === 'AreInteres' || l.status === 'Calificare' || l.status === 'Matching') return true;
  if (l.notes && (l.notes.toLowerCase().includes('cerințe cerere') || l.notes.toLowerCase().includes('cerere:'))) return true;
  return false;
};

export const mapStatus = (status: string): LeadStatus => {
  if (status === 'Lead-uri' || status === 'Intrata' || status === 'Nevalidate' || status === 'Nevalidata') return 'Noi';
  if (status === 'Publicare') return 'Noua';
  if (status === 'Cerere') return 'Noua';
  return status as LeadStatus;
};

export type LeadRole = 'Proprietar' | 'Chirias' | 'Cumparator';

export const getLeadRole = (lead: Partial<Lead> | null | undefined): LeadRole => {
  if (!lead) return 'Proprietar';

  const explicit = (lead as any).leadType || (lead as any).role || (lead as any).clientType || (lead as any).tipLead;
  if (explicit) {
    const norm = String(explicit).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (norm.includes('proprietar') || norm === 'owner') return 'Proprietar';
    if (norm.includes('chirias') || norm === 'renter') return 'Chirias';
    if (norm.includes('cumparator') || norm === 'buyer') return 'Cumparator';
  }

  // If Cerere
  if (isCerereLead(lead)) {
    const isRent = String(lead.transactionType || '').toLowerCase().includes('inchiri');
    return isRent ? 'Chirias' : 'Cumparator';
  }

  // Check text hints in title or notes
  const textCombo = `${lead.title || ''} ${lead.notes || ''}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (textCombo.includes('chirias') || textCombo.includes('caut chirie') || textCombo.includes('caut apartament de inchiriat') || textCombo.includes('chirie client')) {
    return 'Chirias';
  }
  if (textCombo.includes('cumparator') || textCombo.includes('caut sa cumpar') || textCombo.includes('cumparare client') || textCombo.includes('buget cumparare')) {
    return 'Cumparator';
  }

  // Default for property leads (scraped ads, owners)
  return 'Proprietar';
};

export interface Lead {
  id?: string;
  propertyId?: string;
  url: string;
  title: string;
  zone: string;
  price: string;
  ownerName: string;
  ownerPhone: string;
  transactionType: "Vânzare" | "Închiriere";
  categoria: string;
  status: LeadStatus;
  leadType?: LeadRole | string;
  coverImage?: string;
  images?: string[];
  notes?: string;
  extractedData?: ExtractionResult;
  createdByName?: string;
  createdByEmail?: string;
  author?: string;
  agent?: string;
  createdAt: any; // Allow serverTimestamp
  updatedAt: any;
  lastMovedAt?: any;
}

const LEADS_COLLECTION = 'leads';

export const leadsService = {
  addLead: async (leadData: Omit<Lead, 'id' | 'createdAt' | 'updatedAt' | 'lastMovedAt'>) => {
    try {
      let propertyId = leadData.propertyId;
      if (!propertyId) {
        const isCerere = isCerereLead(leadData);
        const isProperty = PROPRIETATI_STATUSES.includes(leadData.status) || leadData.status === 'Activa' || leadData.status === 'InNegociere' || leadData.status === 'Finalizata' || leadData.status === 'Arhiva';
        
        if (isCerere) {
          propertyId = await entityIdService.getNextId('cerere');
        } else if (isProperty) {
          propertyId = await entityIdService.getNextId('property');
        } else {
          // Default for new incoming items (Nevalidata / Calificata): Lead (L1, L2, ...)
          propertyId = await entityIdService.getNextId('lead');
        }
      }

      const now = serverTimestamp();
      return await addDoc(collection(db, LEADS_COLLECTION), {
        ...leadData,
        propertyId,
        createdAt: now,
        updatedAt: now,
        lastMovedAt: now
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, LEADS_COLLECTION);
    }
  },

  updateLeadStatus: async (leadId: string, newStatus: LeadStatus) => {
    const path = `${LEADS_COLLECTION}/${leadId}`;
    try {
      const leadRef = doc(db, LEADS_COLLECTION, leadId);
      const updates: any = {
        status: newStatus,
        updatedAt: serverTimestamp(),
        lastMovedAt: serverTimestamp()
      };

      // When promoted to active Property, assign P ID if it only had an L ID or no ID
      if (PROPRIETATI_STATUSES.includes(newStatus) || newStatus === 'Activa' || newStatus === 'InNegociere' || newStatus === 'Finalizata') {
        const snap = await getDoc(leadRef);
        if (snap.exists()) {
          const currentData = snap.data();
          if (!currentData.propertyId || currentData.propertyId.startsWith('L')) {
            updates.propertyId = await entityIdService.getNextId('property');
          }
        }
      }

      return await updateDoc(leadRef, updates);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  },

  updateLeadData: async (leadId: string, data: Partial<Lead>) => {
    const path = `${LEADS_COLLECTION}/${leadId}`;
    try {
      const leadRef = doc(db, LEADS_COLLECTION, leadId);
      return await updateDoc(leadRef, {
        ...data,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  },

  updateNestedField: async (leadId: string, fieldPath: string, value: any) => {
    const path = `${LEADS_COLLECTION}/${leadId}`;
    try {
      const leadRef = doc(db, LEADS_COLLECTION, leadId);
      return await updateDoc(leadRef, {
        [fieldPath]: value,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  },

  subscribeToLeads: (callback: (leads: Lead[]) => void) => {
    const q = query(collection(db, LEADS_COLLECTION), orderBy('updatedAt', 'desc'));
    return onSnapshot(q, (snapshot) => {
      const leads = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          status: mapStatus(data.status || '')
        };
      }) as Lead[];
      callback(leads);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, LEADS_COLLECTION);
    });
  },

  getLead: async (leadId: string) => {
    try {
      const leadRef = doc(db, LEADS_COLLECTION, leadId);
      const leadSnap = await getDoc(leadRef);
      if (leadSnap.exists()) {
        const data = leadSnap.data();
        return { 
          id: leadSnap.id, 
          ...data,
          status: mapStatus(data.status || '')
        } as Lead;
      }

      // Fallback: query by propertyId if direct document ID fetch misses
      const q = query(collection(db, LEADS_COLLECTION), where("propertyId", "==", leadId));
      const querySnap = await getDocs(q);
      if (!querySnap.empty) {
        const docSnap = querySnap.docs[0];
        const data = docSnap.data();
        return {
          id: docSnap.id,
          ...data,
          status: mapStatus(data.status || '')
        } as Lead;
      }

      return null;
    } catch (error) {
      console.warn(`[leadsService] getLead failed for ${leadId}:`, error);
      return null;
    }
  },

  deleteLead: async (leadId: string) => {
    const path = `${LEADS_COLLECTION}/${leadId}`;
    try {
      const leadRef = doc(db, LEADS_COLLECTION, leadId);
      return await deleteDoc(leadRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  },

  wipeAllLeads: async () => {
    try {
      const querySnapshot = await getDocs(collection(db, LEADS_COLLECTION));
      const deletePromises = querySnapshot.docs.map(document => 
        deleteDoc(doc(db, LEADS_COLLECTION, document.id))
      );
      await Promise.all(deletePromises);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, LEADS_COLLECTION);
    }
  }
};

