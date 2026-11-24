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
import { platformAutoCrawlService } from './platformAutoCrawlService';
import { isAgencyLeadId, isDailyLeadId } from '../utils/leadIdUtils';

export { toCanonicalLeadStatus, toDisplayLeadStatus, type CanonicalLeadStatus };

export type LeadStatus = 
  | 'Noi'
  | 'ListaMea'
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
  'ListaMea',
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
  if (l.propertyId && (l.propertyId.startsWith('P') || l.propertyId.startsWith('L') || isDailyLeadId(l.propertyId))) return false;
  if (l.propertyId && (l.propertyId.startsWith('R') || l.propertyId.startsWith('C'))) return true;
  if (l.status === 'Noi' || l.status === 'ListaMea' || l.status === 'Pierdute' || l.status === 'Nevalidata' || l.status === 'Calificata') return false;
  if (l.title && l.title.toLowerCase().startsWith('cerere')) return true;
  if (l.status === 'AreInteres' || l.status === 'Calificare' || l.status === 'Matching') return true;
  if (l.notes && (l.notes.toLowerCase().includes('cerințe cerere') || l.notes.toLowerCase().includes('cerere:'))) return true;
  return false;
};

export const mapStatus = (status: string): LeadStatus => {
  if (status === 'Lead-uri' || status === 'Intrata' || status === 'Nevalidate' || status === 'Nevalidata' || status === 'Listate' || status === 'Lista Piata') return 'Noi';
  if (status === 'Lista Mea' || status === 'ListaMea' || status === 'Selectate') return 'ListaMea';
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
  createdByUid?: string;
  author?: string;
  agent?: string;
  agentEmail?: string;
  agentUid?: string;
  isSharedLead?: boolean;
  sharedLeadId?: string;
  sourcePropertyId?: string;
  source?: string;
  docVersion?: number;
  isSummary?: boolean;
  deletedAt?: string | null;
  priceNumeric?: number;
  usefulArea?: number;
  rooms?: string;
  compartimentare?: string;
  floor?: string;
  constructieBuckets?: string[];
  olxCategoryId?: number;
  coverThumbUrl?: string;
  publishedAt?: string;
  searchTokens?: string[];
  createdAt: any;
  updatedAt: any;
  lastMovedAt?: any;
}

const LEADS_COLLECTION = 'leads';

function getLeadTimeMs(lead: Lead): number {
  const raw = lead.updatedAt || lead.createdAt;
  if (!raw) return 0;
  if (typeof raw?.toMillis === 'function') return raw.toMillis();
  if (typeof raw === 'number') return raw;
  const parsed = Date.parse(String(raw));
  return Number.isNaN(parsed) ? 0 : parsed;
}

async function updateOrForkSharedLead(leadId: string, patch: Record<string, any>): Promise<Lead> {
  try {
    return await crmApiClient.update<Lead>(LEADS_COLLECTION, leadId, patch);
  } catch (err: any) {
    // If this is a shared platform lead not yet copied into this agency's tenant store,
    // create an agency-local copy in the current agency database so other agencies stay unaffected.
    const shared = await platformAutoCrawlService.getSharedLeadById(leadId);
    if (!shared) {
      throw err;
    }
    const { isSharedLead: _ignored, ...rest } = shared;
    const forkPayload: Record<string, any> = {
      ...rest,
      id: leadId,
      sharedLeadId: shared.id || leadId,
      isSharedLead: false,
    };

    for (const [key, val] of Object.entries(patch || {})) {
      if (key.includes(".")) {
        const parts = key.split(".");
        let curr = forkPayload;
        for (let i = 0; i < parts.length - 1; i++) {
          const p = parts[i];
          curr[p] = curr[p] && typeof curr[p] === "object" ? { ...curr[p] } : {};
          curr = curr[p];
        }
        curr[parts[parts.length - 1]] = val;
      } else {
        forkPayload[key] = val;
      }
    }

    const targetStatus = forkPayload.status;
    if (
      (targetStatus === 'ListaMea' || targetStatus === 'Pierdute') &&
      !isAgencyLeadId(forkPayload.propertyId)
    ) {
      if (shared.propertyId && !forkPayload.sourcePropertyId) {
        forkPayload.sourcePropertyId = shared.propertyId;
      }
      // Clear daily/non-agency propertyId so the agency tenant store assigns a unique agency #L123 ID.
      delete forkPayload.propertyId;
    }

    return await crmApiClient.create<Lead>(LEADS_COLLECTION, forkPayload);
  }
}

export const leadsService = {
  addLead: async (leadData: Omit<Lead, 'id' | 'createdAt' | 'updatedAt' | 'lastMovedAt'>) => {
    const isCerere = isCerereLead(leadData);
    const isProperty =
      PROPRIETATI_STATUSES.includes(leadData.status) ||
      leadData.status === 'Activa' ||
      leadData.status === 'InNegociere' ||
      leadData.status === 'Finalizata' ||
      leadData.status === 'Arhiva';

    let propertyId = leadData.propertyId;
    if (!propertyId) {
      if (isCerere) {
        propertyId = await entityIdService.getNextId('cerere');
      } else if (isProperty) {
        propertyId = await entityIdService.getNextId('property');
      } else if (leadData.status === 'ListaMea' || leadData.status === 'Pierdute') {
        propertyId = await entityIdService.getNextId('lead');
      } else {
        propertyId = await entityIdService.getNextId('daily_lead');
      }
    }

    let finalTitle = leadData.title;
    let finalExtractedData = leadData.extractedData;
    const shouldApplyTitleRule = isProperty || isCerere || leadData.status === 'ListaMea';
    const titleRule = automationSettingsService.getCachedTitleRule();
    const automationSource = (leadData.extractedData as any)?.automationSource;
    if (shouldApplyTitleRule && titleRule?.enabled && automationSource) {
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
    return await updateOrForkSharedLead(leadId, { status: newStatus });
  },

  updateLeadData: async (leadId: string, data: Partial<Lead>) => {
    return await updateOrForkSharedLead(leadId, data);
  },

  updateNestedField: async (leadId: string, fieldPath: string, value: any) => {
    return await updateOrForkSharedLead(leadId, { [fieldPath]: value });
  },

  subscribeToLeads: (callback: (leads: Lead[]) => void) => {
    return crmApiClient.subscribe<Lead>(
      LEADS_COLLECTION,
      (items) => {
        const sorted = [...items].sort((a, b) => getLeadTimeMs(b) - getLeadTimeMs(a));
        callback(sorted);
      },
      {
        transform: (leads) =>
          leads.map((data) => ({
            ...data,
            status: mapStatus(data.status || ''),
          })),
      }
    );
  },

  getLead: async (leadId: string): Promise<Lead | null> => {
    try {
      const found = await crmApiClient.getById<Lead>(LEADS_COLLECTION, leadId);
      if (found) {
        return {
          ...found,
          status: mapStatus(found.status || ''),
        };
      }
      const shared = await platformAutoCrawlService.getSharedLeadById(leadId);
      if (!shared) return null;
      return {
        ...shared,
        status: mapStatus(shared.status || 'Noi'),
      };
    } catch (error) {
      console.warn(`[leadsService] getLead failed for ${leadId}:`, error);
      return null;
    }
  },

  deleteLead: async (leadId: string) => {
    try {
      await crmApiClient.remove(LEADS_COLLECTION, leadId);
    } catch (err) {
      // If deleting a shared platform lead from an agency view, mark it deleted locally
      // for this agency only so all other agencies keep access to the global shared lead.
      const shared = await platformAutoCrawlService.getSharedLeadById(leadId);
      if (!shared) throw err;
      const { isSharedLead: _ignored, ...rest } = shared;
      await crmApiClient.create<Lead>(LEADS_COLLECTION, {
        ...rest,
        id: leadId,
        sharedLeadId: shared.id || leadId,
        status: 'Sterse',
      });
    }
  },

  wipeAllLeads: async () => {
    await crmApiClient.clearLeads();
  },
};
