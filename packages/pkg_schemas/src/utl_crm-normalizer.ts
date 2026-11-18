import { CrmData, ExtractionResult } from "../../pkg_types/src";

export function create_empty_crm_data(): CrmData {
  return {
    general_details: {
      stage: "",
      transaction_type: "",
      category: "",
      owner: "",
      additional_contacts: "",
      residential_complex: "",
      location: {
        city: "",
        zone: [],
        street: "",
        street_number: "",
        building: "",
        staircase: "",
        apartment_number: "",
        points_of_interest: [],
        surroundings: [],
      },
      private_memo: "",
    },
    features: {
      details: {
        house_type: "",
        apartment_type: "",
        partitioning: "",
        comfort: "",
        destination: "",
        rooms: "",
        kitchens: "",
        bedrooms: "",
        bathrooms: "",
        balconies: "",
        terraces: "",
        floor: "",
        orientation: "",
        parking_spaces: "",
        garages: "",
        checklist: [],
      },
      areas: {
        usable: "",
        footprint: "",
        built: "",
        total_usable: "",
        balconies: "",
        terraces: "",
        garden: "",
        land: "",
        free_land: "",
        street_frontage: "",
        shop_window: "",
        frontages_count: "",
        terraces_count: "",
        balconies_count: "",
      },
      other_details: {
        construction_stage: "Finalizata",
        structure: "",
        building_type: "",
        seismic_risk: "",
        construction_year: "",
        renovation_year: "",
        height: "",
        construction_levels: "",
      },
      energy: {
        energy_class: "",
        annual_consumption: "",
        co2_emissions: "",
        renewable_consumption: "",
      },
    },
    utilities: {
      general: [],
      heating_system: [],
      climate_control: [],
      finishes: {
        condition: [],
        insulation: [],
        walls: [],
        floors: [],
        windows: [],
        blinds: [],
        shutters: [],
        entrance_door: [],
        interior_doors: [],
        roof: [],
        lighting: [],
      },
      amenities: {
        furnished: "",
        additional_spaces: [],
        kitchen: [],
        metering: [],
        appliances: [],
        building: [],
        misc: [],
        services: [],
        street_layout: [],
        view: [],
      },
    },
    pricing: {
      details: {
        price: "",
        currency: "EUR",
        price_per_sqm: "",
        last_price: "",
        checklist: [],
        accepted_payment: "",
        garage_price: "",
        parking_price: "",
        advance_payment: "",
        deposit: "",
        vat_included: false,
        private_notes: "",
      },
      commissions: {
        buyer_commission_percent: "",
        buyer_commission_value: "",
        owner_commission_percent: "",
        owner_commission_value: "",
        collaboration: false,
      },
      contract: {
        type: "",
        signed: "",
        number: "",
        signed_date: "",
        expiry_date: "",
      },
    },
    description: {
      title: "",
      content: "",
      availability: "",
      video_url: "",
      virtual_tour_url: "",
    },
    images: {
      living: [],
      kitchen: [],
      bedroom: [],
      bathroom: [],
      other_spaces: [],
    },
  };
}

function pick<T = any>(obj: Record<string, any> | undefined | null, ...keys: string[]): T | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k] as T;
  }
  return undefined;
}

function as_str(val: any, fallback = ""): string {
  if (val === undefined || val === null) return fallback;
  return String(val);
}

function as_str_arr(val: any): string[] {
  if (Array.isArray(val)) return val.map((v) => String(v ?? "")).filter(Boolean);
  if (typeof val === "string" && val.trim()) return [val.trim()];
  return [];
}

function as_img_arr(val: any): { original: string }[] {
  if (!Array.isArray(val)) return [];
  return val
    .map((item) => {
      if (typeof item === "string" && item.trim()) return { original: item.trim() };
      if (item && typeof item === "object" && typeof item.original === "string" && item.original.trim()) {
        return { original: item.original.trim() };
      }
      return null;
    })
    .filter((v): v is { original: string } => Boolean(v));
}

/**
 * Normalizes both legacy Romanian/camelCase CRMData and canonical US English snake_case CrmData.
 * Guarantees zero data loss for existing Firestore records.
 */
export function normalize_crm_data(raw: Record<string, any> | undefined | null): CrmData {
  const empty = create_empty_crm_data();
  if (!raw || typeof raw !== "object") return empty;

  const gd = pick<Record<string, any>>(raw, "general_details", "detaliiGenerale") || {};
  const loc = pick<Record<string, any>>(gd, "location", "localizare") || {};
  const feat = pick<Record<string, any>>(raw, "features", "caracteristici") || {};
  const det = pick<Record<string, any>>(feat, "details", "detalii") || {};
  const ar = pick<Record<string, any>>(feat, "areas", "suprafete") || {};
  const oth = pick<Record<string, any>>(feat, "other_details", "alteDetalii") || {};
  const en = pick<Record<string, any>>(feat, "energy", "energetica") || {};
  const ut = pick<Record<string, any>>(raw, "utilities", "utilitati") || {};
  const fin = pick<Record<string, any>>(ut, "finishes", "finisaje") || {};
  const am = pick<Record<string, any>>(ut, "amenities", "dotari") || {};
  const pr = pick<Record<string, any>>(raw, "pricing", "pret") || {};
  const prd = pick<Record<string, any>>(pr, "details", "detalii") || {};
  const com = pick<Record<string, any>>(pr, "commissions", "comisioane") || {};
  const ctr = pick<Record<string, any>>(pr, "contract") || {};
  const desc = pick<Record<string, any>>(raw, "description", "descriere") || {};
  const img = pick<Record<string, any>>(raw, "images", "imagini") || {};

  return {
    general_details: {
      stage: as_str(pick(gd, "stage", "stadiu")),
      transaction_type: as_str(pick(gd, "transaction_type", "tranzactie")),
      category: as_str(pick(gd, "category", "categoria")),
      owner: as_str(pick(gd, "owner", "proprietar")),
      additional_contacts: as_str(pick(gd, "additional_contacts", "contacteAditionale")),
      residential_complex: as_str(pick(gd, "residential_complex", "ansambluRezidential")),
      location: {
        city: as_str(pick(loc, "city", "oras")),
        zone: as_str_arr(pick(loc, "zone", "zona")),
        street: as_str(pick(loc, "street", "strada")),
        street_number: as_str(pick(loc, "street_number", "numar")),
        building: as_str(pick(loc, "building", "bloc")),
        staircase: as_str(pick(loc, "staircase", "scara")),
        apartment_number: as_str(pick(loc, "apartment_number", "apartament")),
        points_of_interest: as_str_arr(pick(loc, "points_of_interest", "puncteInteres")),
        surroundings: as_str_arr(pick(loc, "surroundings", "imprejurimi")),
      },
      private_memo: as_str(pick(gd, "private_memo", "memoPrivat")),
    },
    features: {
      details: {
        house_type: as_str(pick(det, "house_type", "tipCasa")),
        apartment_type: as_str(pick(det, "apartment_type", "tipApartament")),
        partitioning: as_str(pick(det, "partitioning", "compartimentare")),
        comfort: as_str(pick(det, "comfort", "confort")),
        destination: as_str(pick(det, "destination", "destinatie")),
        rooms: as_str(pick(det, "rooms", "camere")),
        kitchens: as_str(pick(det, "kitchens", "bucatarii")),
        bedrooms: as_str(pick(det, "bedrooms", "dormitoare")),
        bathrooms: as_str(pick(det, "bathrooms", "bai")),
        balconies: as_str(pick(det, "balconies", "balcoane")),
        terraces: as_str(pick(det, "terraces", "terase")),
        floor: as_str(pick(det, "floor", "etaj")),
        orientation: as_str(pick(det, "orientation", "orientare")),
        parking_spaces: as_str(pick(det, "parking_spaces", "parcari")),
        garages: as_str(pick(det, "garages", "garaje")),
        checklist: as_str_arr(pick(det, "checklist", "checkList")),
      },
      areas: {
        usable: as_str(pick(ar, "usable", "utila")),
        footprint: as_str(pick(ar, "footprint", "amprenta")),
        built: as_str(pick(ar, "built", "construita")),
        total_usable: as_str(pick(ar, "total_usable", "utilaTotala")),
        balconies: as_str(pick(ar, "balconies", "balcoane")),
        terraces: as_str(pick(ar, "terraces", "terase")),
        garden: as_str(pick(ar, "garden", "gradina")),
        land: as_str(pick(ar, "land", "teren")),
        free_land: as_str(pick(ar, "free_land", "terenLiber")),
        street_frontage: as_str(pick(ar, "street_frontage", "frontStradal")),
        shop_window: as_str(pick(ar, "shop_window", "vitrina")),
        frontages_count: as_str(pick(ar, "frontages_count", "numarFronturi")),
        terraces_count: as_str(pick(ar, "terraces_count", "numarTerase")),
        balconies_count: as_str(pick(ar, "balconies_count", "numarBalcoane")),
      },
      other_details: {
        construction_stage: as_str(pick(oth, "construction_stage", "stadiuConstructie"), "Finalizata"),
        structure: as_str(pick(oth, "structure", "structura")),
        building_type: as_str(pick(oth, "building_type", "tipImobil")),
        seismic_risk: as_str(pick(oth, "seismic_risk", "riscSeismic")),
        construction_year: as_str(pick(oth, "construction_year", "anConstructie")),
        renovation_year: as_str(pick(oth, "renovation_year", "anRenovare")),
        height: as_str(pick(oth, "height", "inaltime")),
        construction_levels: as_str(pick(oth, "construction_levels", "niveluriConstructie")),
      },
      energy: {
        energy_class: as_str(pick(en, "energy_class", "clasa")),
        annual_consumption: as_str(pick(en, "annual_consumption", "consumAnual")),
        co2_emissions: as_str(pick(en, "co2_emissions", "emisiiCO2")),
        renewable_consumption: as_str(pick(en, "renewable_consumption", "consumRegenerabile")),
      },
    },
    utilities: {
      general: as_str_arr(pick(ut, "general")),
      heating_system: as_str_arr(pick(ut, "heating_system", "sistemIncalzire")),
      climate_control: as_str_arr(pick(ut, "climate_control", "climatizare")),
      finishes: {
        condition: as_str_arr(pick(fin, "condition", "stare")),
        insulation: as_str_arr(pick(fin, "insulation", "izolatii")),
        walls: as_str_arr(pick(fin, "walls", "pereti")),
        floors: as_str_arr(pick(fin, "floors", "podele")),
        windows: as_str_arr(pick(fin, "windows", "ferestre")),
        blinds: as_str_arr(pick(fin, "blinds", "jaluzele")),
        shutters: as_str_arr(pick(fin, "shutters", "rulouri")),
        entrance_door: as_str_arr(pick(fin, "entrance_door", "usaIntrare")),
        interior_doors: as_str_arr(pick(fin, "interior_doors", "usiInterior")),
        roof: as_str_arr(pick(fin, "roof", "acoperis")),
        lighting: as_str_arr(pick(fin, "lighting", "iluminat")),
      },
      amenities: {
        furnished: as_str(pick(am, "furnished", "mobilat")),
        additional_spaces: as_str_arr(pick(am, "additional_spaces", "spatiiAditionale")),
        kitchen: as_str_arr(pick(am, "kitchen", "bucatarie")),
        metering: as_str_arr(pick(am, "metering", "contorizare")),
        appliances: as_str_arr(pick(am, "appliances", "electrocasnice")),
        building: as_str_arr(pick(am, "building", "imobil")),
        misc: as_str_arr(pick(am, "misc", "diverse")),
        services: as_str_arr(pick(am, "services", "servicii")),
        street_layout: as_str_arr(pick(am, "street_layout", "amenajareStrazi")),
        view: as_str_arr(pick(am, "view", "priveliste")),
      },
    },
    pricing: {
      details: {
        price: as_str(pick(prd, "price", "pret")),
        currency: as_str(pick(prd, "currency", "moneda"), "EUR"),
        price_per_sqm: as_str(pick(prd, "price_per_sqm", "pretMp")),
        last_price: as_str(pick(prd, "last_price", "ultimPret")),
        checklist: as_str_arr(pick(prd, "checklist", "checkList")),
        accepted_payment: as_str(pick(prd, "accepted_payment", "plataAcceptata")),
        garage_price: as_str(pick(prd, "garage_price", "pretGaraj")),
        parking_price: as_str(pick(prd, "parking_price", "pretParcare")),
        advance_payment: as_str(pick(prd, "advance_payment", "avans")),
        deposit: as_str(pick(prd, "deposit", "garantie")),
        vat_included: Boolean(pick(prd, "vat_included", "tvaIncluded")),
        private_notes: as_str(pick(prd, "private_notes", "notePrivate")),
      },
      commissions: {
        buyer_commission_percent: as_str(pick(com, "buyer_commission_percent", "comisionCumparatorProcent")),
        buyer_commission_value: as_str(pick(com, "buyer_commission_value", "comisionCumparatorValoare")),
        owner_commission_percent: as_str(pick(com, "owner_commission_percent", "comisionProprietarProcent")),
        owner_commission_value: as_str(pick(com, "owner_commission_value", "comisionProprietarValoare")),
        collaboration: Boolean(pick(com, "collaboration", "colaborare")),
      },
      contract: {
        type: as_str(pick(ctr, "type", "tip")),
        signed: as_str(pick(ctr, "signed", "semnat")),
        number: as_str(pick(ctr, "number", "nr")),
        signed_date: as_str(pick(ctr, "signed_date", "dataSemnare")),
        expiry_date: as_str(pick(ctr, "expiry_date", "dataExpirare")),
      },
    },
    description: {
      title: as_str(pick(desc, "title", "titlu")),
      content: as_str(pick(desc, "content", "continut", "descriere")),
      availability: as_str(pick(desc, "availability", "disponibilitate")),
      video_url: as_str(pick(desc, "video_url", "video")),
      virtual_tour_url: as_str(pick(desc, "virtual_tour_url", "turVirtual")),
    },
    images: {
      living: as_img_arr(pick(img, "living")),
      kitchen: as_img_arr(pick(img, "kitchen", "bucatarie")),
      bedroom: as_img_arr(pick(img, "bedroom", "camera")),
      bathroom: as_img_arr(pick(img, "bathroom", "baie")),
      other_spaces: as_img_arr(pick(img, "other_spaces", "alteSpatii")),
    },
  };
}

export function normalize_extraction_result(raw: Record<string, any> | undefined | null): ExtractionResult | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const raw_crm = pick<Record<string, any>>(raw, "crm_data", "crmData");
  return {
    crm_data: normalize_crm_data(raw_crm),
    markdown_marketing: as_str(pick(raw, "markdown_marketing", "markdownMarketing")),
    summary: as_str(pick(raw, "summary")),
    presentation_sections: pick(raw, "presentation_sections", "presentationSections") ?? null,
    original_description: pick(raw, "original_description", "originalDescription"),
    text: pick(raw, "text"),
  };
}

const LEAD_STATUS_LEGACY_MAP: Record<string, string> = {
  "Noi": "new",
  "Pierdute": "lost",
  "Nevalidata": "unvalidated",
  "Nevalidate": "unvalidated",
  "Lead-uri": "new",
  "Intrata": "new",
  "Calificata": "qualified",
  "Activa": "active",
  "InNegociere": "in_negotiation",
  "Finalizata": "completed",
  "Arhiva": "archived",
  "Sterse": "deleted",
  "AreInteres": "interested",
  "Noua": "new_listing",
  "Publicare": "new_listing",
  "Cerere": "new_listing",
  "Prospectare": "prospecting",
  "Colaborare": "collaboration",
  "Calificare": "qualifying",
  "Matching": "matching",
  "Vizionare": "viewing",
  "Ofertare": "offer",
  "Antecontract": "pre_contract",
  "Contract": "contract",
};

export function normalize_lead_status(status: any): string {
  const raw = String(status || "").trim();
  if (!raw) return "new";
  return LEAD_STATUS_LEGACY_MAP[raw] || raw;
}

/**
 * Normalizes a top-level CRM document across collections from legacy camelCase / Romanian keys
 * into canonical US English snake_case keys, preserving existing unknown metadata safely.
 */
export function normalize_crm_document(collection_name: string, doc: Record<string, any>): Record<string, any> {
  if (!doc || typeof doc !== "object") return doc;
  const out: Record<string, any> = { ...doc };

  // Common system/audit timestamps
  if (out.created_at === undefined && out.createdAt !== undefined) out.created_at = out.createdAt;
  if (out.updated_at === undefined && out.updatedAt !== undefined) out.updated_at = out.updatedAt;
  if (out.last_moved_at === undefined && out.lastMovedAt !== undefined) out.last_moved_at = out.lastMovedAt;
  if (out.created_by_uid === undefined && out.createdByUid !== undefined) out.created_by_uid = out.createdByUid;
  if (out.created_by_name === undefined && out.createdByName !== undefined) out.created_by_name = out.createdByName;
  if (out.created_by_email === undefined && out.createdByEmail !== undefined) out.created_by_email = out.createdByEmail;

  if (collection_name === "leads") {
    if (out.property_id === undefined && out.propertyId !== undefined) out.property_id = out.propertyId;
    if (out.owner_name === undefined && out.ownerName !== undefined) out.owner_name = out.ownerName;
    if (out.owner_phone === undefined && out.ownerPhone !== undefined) out.owner_phone = out.ownerPhone;
    if (out.transaction_type === undefined && out.transactionType !== undefined) out.transaction_type = out.transactionType;
    if (out.category === undefined && out.categoria !== undefined) out.category = out.categoria;
    if (out.lead_type === undefined && (out.leadType !== undefined || out.tipLead !== undefined)) {
      out.lead_type = out.leadType ?? out.tipLead;
    }
    if (out.furnishing === undefined && out.mobilare !== undefined) out.furnishing = out.mobilare;
    if (out.parking === undefined && out.parcare !== undefined) out.parking = out.parcare;
    if (out.heating_source === undefined && out.sursaIncalzire !== undefined) out.heating_source = out.sursaIncalzire;
    if (out.heating_mode === undefined && out.modIncalzire !== undefined) out.heating_mode = out.modIncalzire;
    if (out.cover_image === undefined && out.coverImage !== undefined) out.cover_image = out.coverImage;
    if (out.status) out.status = normalize_lead_status(out.status);

    const raw_ext = out.extracted_data ?? out.extractedData;
    if (raw_ext && typeof raw_ext === "object") {
      out.extracted_data = normalize_extraction_result(raw_ext);
    }
  } else if (collection_name === "contacts") {
    if (out.contact_id === undefined && out.contactId !== undefined) out.contact_id = out.contactId;
    if (out.first_name === undefined && out.firstName !== undefined) out.first_name = out.firstName;
    if (out.last_name === undefined && out.lastName !== undefined) out.last_name = out.lastName;
    if (out.property_id === undefined && out.propertyId !== undefined) out.property_id = out.propertyId;
    if (out.commission_value === undefined && out.commissionValue !== undefined) out.commission_value = out.commissionValue;
  } else if (collection_name === "staff" || collection_name === "personal") {
    if (out.staff_id === undefined && (out.staffId !== undefined || out.personalId !== undefined)) {
      out.staff_id = out.staffId ?? out.personalId;
    }
    if (out.status === "Activ") out.status = "active";
    if (out.status === "Inactiv") out.status = "inactive";
  } else if (collection_name === "documents") {
    if (out.document_id === undefined && out.documentId !== undefined) out.document_id = out.documentId;
    if (out.property_id === undefined && out.propertyId !== undefined) out.property_id = out.propertyId;
    if (out.client_id === undefined && out.clientId !== undefined) out.client_id = out.clientId;
    if (out.staff_id === undefined && out.staffId !== undefined) out.staff_id = out.staffId;
    if (out.file_url === undefined && out.fileUrl !== undefined) out.file_url = out.fileUrl;
    if (out.file_name === undefined && out.fileName !== undefined) out.file_name = out.fileName;
  } else if (collection_name === "activities" || collection_name === "tours" || collection_name === "viewings") {
    if (out.activity_id === undefined && out.activityId !== undefined) out.activity_id = out.activityId;
    if (out.tour_id === undefined && out.tourId !== undefined) out.tour_id = out.tourId;
    if (out.property_id === undefined && out.propertyId !== undefined) out.property_id = out.propertyId;
    if (out.client_id === undefined && (out.clientId !== undefined || out.contactId !== undefined)) {
      out.client_id = out.clientId ?? out.contactId;
    }
    if (out.contact_id === undefined && (out.contactId !== undefined || out.clientId !== undefined)) {
      out.contact_id = out.contactId ?? out.clientId;
    }
    if (out.client_name === undefined && (out.clientName !== undefined || out.contactName !== undefined)) {
      out.client_name = out.clientName ?? out.contactName;
    }
    if (out.contact_name === undefined && (out.contactName !== undefined || out.clientName !== undefined)) {
      out.contact_name = out.contactName ?? out.clientName;
    }
    if (out.client_phone === undefined && out.clientPhone !== undefined) out.client_phone = out.clientPhone;
    if (out.staff_id === undefined && (out.staffId !== undefined || out.agentId !== undefined)) {
      out.staff_id = out.staffId ?? out.agentId;
    }
    if (out.agent_id === undefined && (out.agentId !== undefined || out.staffId !== undefined)) {
      out.agent_id = out.agentId ?? out.staffId;
    }
    if (out.staff_name === undefined && (out.staffName !== undefined || out.agentName !== undefined)) {
      out.staff_name = out.staffName ?? out.agentName;
    }
    if (out.agent_name === undefined && (out.agentName !== undefined || out.staffName !== undefined)) {
      out.agent_name = out.agentName ?? out.staffName;
    }
    if (out.status === "Programată") out.status = "scheduled";
    if (out.status === "Realizată") out.status = "completed";
    if (out.status === "Anulată") out.status = "cancelled";
  } else if (collection_name === "notifications") {
    if (out.entity_id === undefined && out.entityId !== undefined) out.entity_id = out.entityId;
    if (out.property_id === undefined && out.propertyId !== undefined) out.property_id = out.propertyId;
    if (out.target_type === undefined && out.targetType !== undefined) {
      out.target_type = out.targetType === "cerere" ? "request" : out.targetType;
    }
    if (out.user_id === undefined && out.userId !== undefined) out.user_id = out.userId;
    if (out.type === "cerere") out.type = "request";
    if (out.type === "proprietate") out.type = "property";
  } else if (collection_name === "fcm_tokens") {
    if (out.user_id === undefined && out.userId !== undefined) out.user_id = out.userId;
    if (out.device_platform === undefined && out.devicePlatform !== undefined) out.device_platform = out.devicePlatform;
    if (out.user_agent === undefined && out.userAgent !== undefined) out.user_agent = out.userAgent;
  }

  return out;
}
