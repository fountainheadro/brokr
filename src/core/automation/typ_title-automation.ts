export type TitleCategoryId =
  | "fillers"
  | "tranzactie"
  | "general"
  | "transport"
  | "relaxare"
  | "atractie"
  | "mobilare"
  | "utilare"
  | "parcare"
  | "animal_companie"
  | "personalizat_1"
  | "personalizat_2"
  | "personalizat_3"
  | "identificare";

export interface TitleTagItem {
  id: string;
  label: string;
  token: string;
}

export interface TitleCategoryConfig {
  id: TitleCategoryId;
  label: string;
  tags: TitleTagItem[];
  customKey?: "personalizat1" | "personalizat2" | "personalizat3";
}

export interface TitleCustomValues {
  personalizat1: string;
  personalizat2: string;
  personalizat3: string;
}

export interface TitleAutomationRule {
  enabled: boolean;
  minChars: number;
  maxChars: number;
  salePattern: string;
  rentPattern: string;
  customValues: TitleCustomValues;
  categories: TitleCategoryConfig[];
}

export interface AgencyAutomationConfigRecord {
  id: string;
  tenantId: string;
  titleRule: TitleAutomationRule;
  isCustomOverride?: boolean;
  version: number;
  updatedBy: string;
  updatedAt: string;
}

export const DEFAULT_SALE_PATTERN =
  "[De] [tip tranzactie] [|] [tip proprietate] [camere] [|] [suprafata utila] [|] [etaj][/][etaje in total] [|] [statie] [la] [distanta statie] [|] [mobilare] [si] [utilare] [|] [parcare] [|] [id]";

export const DEFAULT_RENT_PATTERN =
  "[De] [tip tranzactie] [|] [tip proprietate] [camere] [|] [suprafata utila] [|] [etaj][/][etaje in total] [|] [statie] [la] [distanta statie] [|] [mobilare] [si] [utilare] [|] [parcare] [|] [pet] [|] [id]";

export const BASE_TITLE_CATEGORIES: TitleCategoryConfig[] = [
  {
    id: "fillers",
    label: "Fillers",
    tags: [
      { id: "space", label: '" "', token: "[ ]" },
      { id: "pipe", label: '"|"', token: "[|]" },
      { id: "slash", label: '"/"', token: "[/]" },
      { id: "backslash", label: '"\\"', token: "[\\]" },
      { id: "comma", label: '","', token: "[,]" },
    ],
  },
  {
    id: "tranzactie",
    label: "Tranzactie",
    tags: [{ id: "tip_tranzactie", label: "Tip tranzactie", token: "[tip tranzactie]" }],
  },
  {
    id: "general",
    label: "General",
    tags: [
      { id: "tip", label: "Tip", token: "[tip proprietate]" },
      { id: "camere", label: "camere", token: "[camere]" },
      { id: "utila", label: "utila", token: "[suprafata utila]" },
      { id: "construita", label: "construita", token: "[suprafata construita]" },
      { id: "etaj", label: "Etaj", token: "[etaj]" },
      { id: "etaje_total", label: "Etaje in total", token: "[etaje in total]" },
    ],
  },
  {
    id: "transport",
    label: "Transport",
    tags: [
      { id: "statie", label: "Statie", token: "[statie]" },
      { id: "distanta_statie", label: "Distanta statie", token: "[distanta statie]" },
    ],
  },
  {
    id: "relaxare",
    label: "Relaxare",
    tags: [
      { id: "nume_parc", label: "Nume parc", token: "[nume parc]" },
      {
        id: "distanta_si_nume_parc",
        label: "Distanta si nume parc",
        token: "[distanta si nume parc]",
      },
      { id: "distanta_parc", label: "distanta parc", token: "[distanta parc]" },
    ],
  },
  {
    id: "atractie",
    label: "Atractie",
    tags: [
      { id: "nume_atractie", label: "Nume atrctie", token: "[nume atractie]" },
      {
        id: "distanta_si_nume_atractie",
        label: "Distanta si nume atractie",
        token: "[distanta si nume atractie]",
      },
      { id: "distanta_atractie", label: "distanta atractie", token: "[distanta atractie]" },
    ],
  },
  {
    id: "mobilare",
    label: "Mobilae",
    tags: [{ id: "mobilare", label: "Moblare", token: "[mobilare]" }],
  },
  {
    id: "utilare",
    label: "Utilare",
    tags: [{ id: "utilare", label: "Utilare", token: "[utilare]" }],
  },
  {
    id: "parcare",
    label: "Parcare",
    tags: [{ id: "parcare", label: "Parcare", token: "[parcare]" }],
  },
  {
    id: "animal_companie",
    label: "Animal de companie",
    tags: [
      {
        id: "situatie_pet",
        label: "Situatie animal de companie",
        token: "[pet]",
      },
    ],
  },
  {
    id: "personalizat_1",
    label: "Personalizat 1",
    customKey: "personalizat1",
    tags: [{ id: "personalizat_1", label: "Personalizat 1", token: "[personalizat 1]" }],
  },
  {
    id: "personalizat_2",
    label: "Personalizat 2",
    customKey: "personalizat2",
    tags: [{ id: "personalizat_2", label: "Personalizat 2", token: "[personalizat 2]" }],
  },
  {
    id: "personalizat_3",
    label: "Personalizat 3",
    customKey: "personalizat3",
    tags: [{ id: "personalizat_3", label: "Personalizat 3", token: "[personalizat 3]" }],
  },
  {
    id: "identificare",
    label: "Identificare",
    tags: [{ id: "id", label: "id", token: "[id]" }],
  },
];

export function cloneBaseCategories(): TitleCategoryConfig[] {
  return BASE_TITLE_CATEGORIES.map((cat) => ({
    ...cat,
    tags: cat.tags.map((t) => ({ ...t })),
  }));
}

export const DEFAULT_TITLE_AUTOMATION_RULE: TitleAutomationRule = {
  enabled: true,
  minChars: 50,
  maxChars: 70,
  salePattern: DEFAULT_SALE_PATTERN,
  rentPattern: DEFAULT_RENT_PATTERN,
  customValues: {
    personalizat1: "",
    personalizat2: "",
    personalizat3: "",
  },
  categories: cloneBaseCategories(),
};

export function normalizeTitleAutomationRule(raw: unknown): TitleAutomationRule {
  const input = raw && typeof raw === "object" ? (raw as Record<string, any>) : {};
  const defaults = DEFAULT_TITLE_AUTOMATION_RULE;

  const rawMin = Number(input.minChars);
  const rawMax = Number(input.maxChars);
  const minChars = Number.isFinite(rawMin) ? Math.max(10, Math.min(300, Math.round(rawMin))) : defaults.minChars;
  const maxChars = Number.isFinite(rawMax)
    ? Math.max(minChars + 5, Math.min(350, Math.round(rawMax)))
    : Math.max(minChars + 5, defaults.maxChars);

  const customRaw = input.customValues && typeof input.customValues === "object" ? input.customValues : {};
  const customValues: TitleCustomValues = {
    personalizat1: typeof customRaw.personalizat1 === "string" ? customRaw.personalizat1 : "",
    personalizat2: typeof customRaw.personalizat2 === "string" ? customRaw.personalizat2 : "",
    personalizat3: typeof customRaw.personalizat3 === "string" ? customRaw.personalizat3 : "",
  };

  // Reconcile category & tag order while preserving all canonical items
  const baseCatMap = new Map<string, TitleCategoryConfig>(
    BASE_TITLE_CATEGORIES.map((c) => [c.id, { ...c, tags: c.tags.map((t) => ({ ...t })) }])
  );
  const orderedCategories: TitleCategoryConfig[] = [];
  const seenCatIds = new Set<string>();

  if (Array.isArray(input.categories)) {
    for (const rawCat of input.categories) {
      const catId = typeof rawCat?.id === "string" ? rawCat.id : "";
      const baseCat = baseCatMap.get(catId);
      if (!baseCat || seenCatIds.has(catId)) continue;
      seenCatIds.add(catId);

      const baseTagMap = new Map<string, TitleTagItem>(baseCat.tags.map((t) => [t.id, { ...t }]));
      const orderedTags: TitleTagItem[] = [];
      const seenTagIds = new Set<string>();

      if (Array.isArray(rawCat.tags)) {
        for (const rawTag of rawCat.tags) {
          const tagId = typeof rawTag?.id === "string" ? rawTag.id : "";
          const baseTag = baseTagMap.get(tagId);
          if (!baseTag || seenTagIds.has(tagId)) continue;
          seenTagIds.add(tagId);
          orderedTags.push(baseTag);
        }
      }
      for (const baseTag of baseCat.tags) {
        if (!seenTagIds.has(baseTag.id)) {
          orderedTags.push({ ...baseTag });
        }
      }

      orderedCategories.push({
        ...baseCat,
        tags: orderedTags,
      });
    }
  }

  for (const baseCat of BASE_TITLE_CATEGORIES) {
    if (!seenCatIds.has(baseCat.id)) {
      orderedCategories.push({
        ...baseCat,
        tags: baseCat.tags.map((t) => ({ ...t })),
      });
    }
  }

  return {
    enabled: typeof input.enabled === "boolean" ? input.enabled : defaults.enabled,
    minChars,
    maxChars,
    salePattern: typeof input.salePattern === "string" ? input.salePattern : defaults.salePattern,
    rentPattern: typeof input.rentPattern === "string" ? input.rentPattern : defaults.rentPattern,
    customValues,
    categories: orderedCategories,
  };
}
