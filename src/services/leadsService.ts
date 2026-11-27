import { ExtractionResult } from './geminiService';
import { entityIdService } from './entityIdService';
import { crmApiClient, getActiveCrmTenantId } from '../core/crm/svc_crm-client';
import {
  toCanonicalLeadStatus,
  toDisplayLeadStatus,
  type CanonicalLeadStatus,
} from '../core/crm/svc_crm-normalizer';
import { automationSettingsService } from './automationSettingsService';
import { buildTitleFromAutomationRule } from '../utils/titleAutomationEngine';
import { platformAutoCrawlService } from './platformAutoCrawlService';
import { isAgencyLeadId, isDailyLeadId } from '../utils/leadIdUtils';
import { deletePublicShareSnapshot, publishPublicShareSnapshot } from './publicShareService';
import type {
  CanonicalPropertySpecs,
  PortalExtensionsMap,
} from '../core/portals/typ_portal-provider';

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
  'Noi',
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

export const isUnprocessedLead = (l?: Partial<Lead> | null): boolean => {
  if (!l || isCerereLead(l)) return false;
  if (l.status === 'Pierdute' || l.status === 'Sterse') return false;
  if (l.status === 'Noi' || l.status === 'Nevalidata' || l.status === 'Calificata') return true;
  if (l.status === 'ListaMea' && isDailyLeadId(l.propertyId)) return true;
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

export interface PropertyCriteriaData {
  buildingType: "Apartament" | "Casa/Vila" | "Teren" | "Spatiu Comercial" | string;
  minBudget: string;
  maxBudget: string;
  modalitateAchizitie: string;
  tipAchizitieAcceptat?: string[];
  tva?: string;
  comision?: string;
  contractDurata?: string;
  avans?: string;
  garantie?: string;
  situatieJuridica?: string;
  disponibilitate?: string;
  cetatenie: string;
  cetatenieList?: string[];
  animal: string;
  animaleList?: string[];
  profil?: string[];
  copii?: string;
  terenCategorie: string;
  terenClasificare: string;
  comercialCategorie: string;
  compartimentare: string;
  selectedRooms: string[];
  selectedBaths: string[];
  selectedFloors: string[];
  totalFloors: string;
  casaSubsol: boolean;
  casaDemisol: boolean;
  casaParter: boolean;
  casaEtajePesteParter: string;
  mobilare: string;
  utilare: string;
  tipParcare: string;
  numarLocuriParcare: string;
  zoneList: string[];
  propertyTitle?: string;
  requirements: string;
  anConstructieMin: string;
  anConstructieMax: string;
  suprafataUtilaMin: string;
  suprafataUtilaMax: string;
  suprafataConstruitaMin: string;
  suprafataConstruitaMax: string;
  suprafataCurteMin: string;
  suprafataCurteMax: string;
  suprafataTerenMin: string;
  suprafataTerenMax: string;
  frontStradal: string;
  stareInterior: string;
  sistemIncalzire: string;
  metodaIncalzire: string;
  lift: string;
  gradina: string;
  balcoaneTeraseLogii: string[];
  utilitati: string[];
  serviciiImobil: string[];
}

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
  buildingType?: string;
  minBudget?: string;
  maxBudget?: string;
  modalitateAchizitie?: string;
  tipAchizitieAcceptat?: string[];
  cetatenie?: string;
  cetatenieList?: string[];
  animal?: string;
  animaleList?: string[];
  profil?: string[];
  copii?: string;
  terenCategorie?: string;
  terenClasificare?: string;
  comercialCategorie?: string;
  baths?: string;
  selectedRooms?: string[];
  selectedBaths?: string[];
  selectedFloors?: string[];
  totalFloors?: string;
  casaSubsol?: boolean;
  casaDemisol?: boolean;
  casaParter?: boolean;
  casaEtajePesteParter?: string;
  mobilare?: string;
  utilare?: string;
  parcare?: string;
  tipParcare?: string;
  numarLocuriParcare?: string;
  sursaIncalzire?: string;
  modIncalzire?: string;
  zoneList?: string[];
  requirements?: string;
  anConstructieMin?: string;
  anConstructieMax?: string;
  constructionYear?: string;
  suprafataUtilaMin?: string;
  suprafataUtilaMax?: string;
  suprafataConstruitaMin?: string;
  suprafataConstruitaMax?: string;
  suprafataCurteMin?: string;
  suprafataCurteMax?: string;
  suprafataTerenMin?: string;
  suprafataTerenMax?: string;
  frontStradal?: string;
  stareInterior?: string;
  lift?: string;
  gradina?: string;
  balcoaneTeraseLogii?: string[];
  utilitati?: string[];
  serviciiImobil?: string[];
  criteriiFormular?: PropertyCriteriaData;
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
  canonicalSpecs?: CanonicalPropertySpecs;
  portalExtensions?: PortalExtensionsMap;
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

async function syncLeadPublicShareAfterSave(persisted: Lead | null | undefined): Promise<void> {
  if (!persisted) return;
  try {
    await publishPublicShareSnapshot(persisted, {
      tenantId: (persisted as any).tenantId || getActiveCrmTenantId(),
      force: true,
    });
  } catch {
    // Non-fatal: canonical Firestore write already succeeded
  }
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
    let finalCriteriiFormular = leadData.criteriiFormular;
    const shouldApplyTitleRule = isProperty || isCerere || leadData.status === 'ListaMea';
    const isManualTitle = Boolean((leadData.extractedData as any)?.titleManuallyEdited);
    const automationSource = (leadData.extractedData as any)?.automationSource;

    if (shouldApplyTitleRule && !isManualTitle && automationSource) {
      let titleRule = automationSettingsService.getCachedTitleRule();
      try {
        const fetched = await automationSettingsService.fetchTitleRule();
        if (fetched?.titleRule) {
          titleRule = fetched.titleRule;
        }
      } catch {
        // Fallback to cached rule
      }
      if (titleRule?.enabled) {
        const rebuilt = buildTitleFromAutomationRule(titleRule, {
          ...automationSource,
          propertyId,
        });
        if (rebuilt) {
          const oldTitle = finalTitle;
          finalTitle = rebuilt;
          if (finalCriteriiFormular) {
            finalCriteriiFormular = {
              ...finalCriteriiFormular,
              propertyTitle: rebuilt,
            };
          }
          if (finalExtractedData) {
            const existingDesc = finalExtractedData.crmData?.descriere;
            const nextContinut =
              oldTitle && typeof existingDesc?.continut === 'string'
                ? existingDesc.continut.replace(oldTitle, rebuilt)
                : existingDesc?.continut ?? '';
            const nextCrm = finalExtractedData.crmData
              ? {
                  ...finalExtractedData.crmData,
                  ...(finalCriteriiFormular
                    ? { criteriiFormular: { ...finalCriteriiFormular } }
                    : {}),
                  descriere: {
                    disponibilitate: existingDesc?.disponibilitate ?? '',
                    video: existingDesc?.video ?? '',
                    turVirtual: existingDesc?.turVirtual ?? '',
                    ...(existingDesc || {}),
                    titlu: rebuilt,
                    continut: nextContinut,
                  },
                }
              : finalExtractedData.crmData;
            finalExtractedData = {
              ...finalExtractedData,
              originalTitle: rebuilt,
              crmData: nextCrm,
            };
          }
        }
      }
    }

    const created = await crmApiClient.create<Lead>(LEADS_COLLECTION, {
      ...leadData,
      title: finalTitle,
      ...(finalCriteriiFormular ? { criteriiFormular: finalCriteriiFormular } : {}),
      extractedData: finalExtractedData,
      propertyId,
    });
    await syncLeadPublicShareAfterSave(created);
    return created;
  },

  updateLeadStatus: async (leadId: string, newStatus: LeadStatus) => {
    const persisted = await updateOrForkSharedLead(leadId, { status: newStatus });
    await syncLeadPublicShareAfterSave(persisted);
    return persisted;
  },

  updateLeadData: async (leadId: string, data: Partial<Lead>) => {
    const persisted = await updateOrForkSharedLead(leadId, data);
    await syncLeadPublicShareAfterSave(persisted);
    return persisted;
  },

  updateNestedField: async (leadId: string, fieldPath: string, value: any) => {
    const persisted = await updateOrForkSharedLead(leadId, { [fieldPath]: value });
    await syncLeadPublicShareAfterSave(persisted);
    return persisted;
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
    const existingBeforeDelete = await crmApiClient
      .getById<Lead>(LEADS_COLLECTION, leadId)
      .catch(() => null);
    try {
      await crmApiClient.remove(LEADS_COLLECTION, leadId);
      await deletePublicShareSnapshot(existingBeforeDelete || { id: leadId }, {
        tenantId: getActiveCrmTenantId(),
      }).catch(() => {});
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
