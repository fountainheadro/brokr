export interface CRMData {
  detaliiGenerale: {
    stadiu: string;
    tranzactie: string;
    categoria: string;
    proprietar: string;
    contacteAditionale: string;
    ansambluRezidential: string;
    localizare: {
      oras: string;
      zona: string[];
      strada: string;
      numar: string;
      bloc: string;
      scara: string;
      apartament: string;
      puncteInteres: string[];
      imprejurimi: string[];
    };
    memoPrivat: string;
  };
  caracteristici: {
    detalii: {
      tipCasa: string;
      tipApartament: string;
      compartimentare: string;
      confort: string;
      destinatie: string;
      camere: string;
      bucatarii: string;
      dormitoare: string;
      bai: string;
      balcoane: string;
      terase: string;
      etaj: string;
      orientare: string;
      parcari: string;
      garaje: string;
      checkList: string[];
    };
    suprafete: {
      utila: string;
      amprenta: string;
      construita: string;
      utilaTotala: string;
      balcoane: string;
      terase: string;
      gradina: string;
      teren: string;
      terenLiber: string;
      frontStradal: string;
      vitrina: string;
      numarFronturi: string;
      numarTerase: string;
      numarBalcoane: string;
    };
    alteDetalii: {
      stadiuConstructie: string;
      structura: string;
      tipImobil: string;
      riscSeismic: string;
      anConstructie: string;
      anRenovare: string;
      inaltime: string;
      niveluriConstructie?: string;
    };
    energetica: {
      clasa: string;
      consumAnual: string;
      emisiiCO2: string;
      consumRegenerabile: string;
    };
  };
  utilitati: {
    general: string[];
    sistemIncalzire: string[];
    climatizare: string[];
    finisaje: {
      stare: string[];
      izolatii: string[];
      pereti: string[];
      podele: string[];
      ferestre: string[];
      jaluzele: string[];
      rulouri: string[];
      usaIntrare: string[];
      usiInterior: string[];
      acoperis: string[];
      iluminat?: string[];
    };
    dotari: {
      mobilat: string;
      spatiiAditionale: string[];
      bucatarie: string[];
      contorizare: string[];
      electrocasnice: string[];
      imobil: string[];
      diverse: string[];
      servicii: string[];
      amenajareStrazi: string[];
      priveliste: string[];
    };
  };
  pret: {
    detalii: {
      pret: string;
      moneda: string;
      pretMp: string;
      ultimPret: string;
      checkList: string[];
      plataAcceptata: string;
      pretGaraj: string;
      pretParcare: string;
      avans: string;
      garantie: string;
      tvaIncluded: boolean;
      notePrivate: string;
    };
    comisioane: {
      comisionCumparatorProcent: string;
      comisionCumparatorValoare: string;
      comisionProprietarProcent: string;
      comisionProprietarValoare: string;
      colaborare: boolean;
    };
    contract: {
      tip: string;
      semnat: string;
      nr: string;
      dataSemnare: string;
      dataExpirare: string;
    };
  };
  descriere: {
    titlu: string;
    continut: string;
    disponibilitate: string;
    video: string;
    turVirtual: string;
  };
  imagini: {
    living: { original: string }[];
    bucatarie: { original: string }[];
    camera: { original: string }[];
    baie: { original: string }[];
    alteSpatii: { original: string }[];
  };
}

export interface ExtractionResult {
  crmData: CRMData;
  markdownMarketing: string;
  summary: string;
  presentationSections?: Record<string, Record<string, string>> | null;
  originalDescription?: string;
  text?: string;
}

export interface BasicLeadData {
  title: string;
  zone: string;
  price: string;
  ownerName: string;
  ownerPhone: string;
  transactionType: "Vânzare" | "Închiriere";
  categoria: string;
}

// Securely proxy the basic parsing request to our backend API route
export async function extractBasicData(content: string, title: string): Promise<BasicLeadData> {
  const response = await fetch("/api/extract-basic", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ content, title })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Eroare la extragerea datelor primare de la server");
  }

  return response.json();
}

// Securely proxy the full parsing request to our backend API route
export async function extractData(
  content: string,
  title: string,
  imageUrls: string[] = [],
  propertyId?: string,
  propertyUrl?: string
): Promise<ExtractionResult> {
  const response = await fetch("/api/extract-data", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ content, title, imageUrls, propertyId, propertyUrl })
  });

  return response.json();
}

export interface AITextParams {
  category: string;
  transactionType: string;
  zone: string;
  price: string;
  specs?: any;
  originalTitle?: string;
  originalDescription?: string;
  propertyId?: string;
}

export interface AITextResult {
  title: string;
  description: string;
}

export async function generateAIText(params: AITextParams): Promise<AITextResult> {
  const response = await fetch("/api/generate-ai-text", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(params)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Eroare la generarea textului cu AI");
  }

  return response.json();
}

