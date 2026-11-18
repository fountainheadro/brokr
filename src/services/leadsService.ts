import { ExtractionResult } from './geminiService';
import { entityIdService } from './entityIdService';
import { crmApiClient } from '../core/crm/svc_crm-client';
import {
  toCanonicalLeadStatus,
  toDisplayLeadStatus,
  type CanonicalLeadStatus,
} from '../core/crm/svc_crm-normalizer';
import { automationSettingsService } from './automationSettingsService';
import { buildTitleFromAutomationRule } from '../utils/titleAutomationEngine';

export { toCanonicalLeadStatus, toDisplayLeadStatus, type CanonicalLeadStatus };

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
  if (l.status === 'Noi' || l.status === 'Pierdute' || l.status === 'Nevalidata' || l.status === 'Calificata') return false;
  if (l.title && l.title.toLowerCase().startsWith('cerere')) return true;
  if (l.status === 'AreInteres' || l.status === 'Calificare' || l.status === 'Matching') return true;
  if (l.notes && (l.notes.toLowerCase().includes('cerințe cerere') || l.notes.toLowerCase().includes('cerere:'))) return true;
  return false;
};

export const mapStatus = (status: string): LeadStatus => {
  if (status === 'Lead-uri' || status === 'Intrata' || status === 'Nevalidate' || status === 'Nevalidata') return 'Noi';
  if (status === 'Publicare') return 'Noua';
  if (status === 'Cerere') return 'Noua';
  return (toDisplayLeadStatus(status) || status) as LeadStatus;
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
  mobilare?: string;
  parcare?: string;
  sursaIncalzire?: string;
  modIncalzire?: string;
  coverImage?: string;
  images?: string[];
  notes?: string;
  extractedData?: ExtractionResult;
  createdByName?: string;
  createdByEmail?: string;
  author?: string;
  agent?: string;
  createdAt: any;
  updatedAt: any;
  lastMovedAt?: any;
}

const LEADS_COLLECTION = 'leads';

export const leadsService = {
  addLead: async (leadData: Omit<Lead, 'id' | 'createdAt' | 'updatedAt' | 'lastMovedAt'>) => {
    let propertyId = leadData.propertyId;
    if (!propertyId) {
      const isCerere = isCerereLead(leadData);
      const isProperty =
        PROPRIETATI_STATUSES.includes(leadData.status) ||
        leadData.status === 'Activa' ||
        leadData.status === 'InNegociere' ||
        leadData.status === 'Finalizata' ||
        leadData.status === 'Arhiva';

      if (isCerere) {
        propertyId = await entityIdService.getNextId('cerere');
      } else if (isProperty) {
        propertyId = await entityIdService.getNextId('property');
      } else {
        propertyId = await entityIdService.getNextId('lead');
      }
    }

    let finalTitle = leadData.title;
    let finalExtractedData = leadData.extractedData;
    const titleRule = automationSettingsService.getCachedTitleRule();
    const automationSource = (leadData.extractedData as any)?.automationSource;
    if (titleRule?.enabled && automationSource && !isCerereLead(leadData)) {
      const rebuilt = buildTitleFromAutomationRule(titleRule, {
        ...automationSource,
        propertyId,
      });
      if (rebuilt) {
        const oldTitle = finalTitle;
        finalTitle = rebuilt;
        if (finalExtractedData?.crmData?.descriere) {
          const updatedDescriere = {
            ...finalExtractedData.crmData.descriere,
            titlu: rebuilt,
          };
          if (oldTitle && typeof updatedDescriere.continut === 'string') {
            updatedDescriere.continut = updatedDescriere.continut.replace(oldTitle, rebuilt);
          }
          finalExtractedData = {
            ...finalExtractedData,
            crmData: {
              ...finalExtractedData.crmData,
              descriere: updatedDescriere,
            },
          };
        }
      }
    }

    return crmApiClient.create<Lead>(LEADS_COLLECTION, {
      ...leadData,
      title: finalTitle,
      extractedData: finalExtractedData,
      propertyId,
    });
  },

  updateLeadStatus: async (leadId: string, newStatus: LeadStatus) => {
    await crmApiClient.update<Lead>(LEADS_COLLECTION, leadId, { status: newStatus });
  },

  updateLeadData: async (leadId: string, data: Partial<Lead>) => {
    await crmApiClient.update<Lead>(LEADS_COLLECTION, leadId, data);
  },

  updateNestedField: async (leadId: string, fieldPath: string, value: any) => {
    await crmApiClient.update<Lead>(LEADS_COLLECTION, leadId, { [fieldPath]: value });
  },

  subscribeToLeads: (callback: (leads: Lead[]) => void) => {
    return crmApiClient.subscribe<Lead>(LEADS_COLLECTION, callback, {
      transform: (leads) =>
        leads.map((data) => ({
          ...data,
          status: mapStatus(data.status || ''),
        })),
    });
  },

  getLead: async (leadId: string): Promise<Lead | null> => {
    try {
      const found = await crmApiClient.getById<Lead>(LEADS_COLLECTION, leadId);
      if (!found) return null;
      return {
        ...found,
        status: mapStatus(found.status || ''),
      };
    } catch (error) {
      console.warn(`[leadsService] getLead failed for ${leadId}:`, error);
      return null;
    }
  },

  deleteLead: async (leadId: string) => {
    await crmApiClient.remove(LEADS_COLLECTION, leadId);
  },

  wipeAllLeads: async () => {
    await crmApiClient.clearLeads();
  },
};
