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

export type DescriptionSectionId =
  | "pret_conditii"
  | "introducere"
  | "apartament"
  | "bloc"
  | "imprejurimi"
  | "transport"
  | "parcare";

export type DescriptionItemKind = "subsection" | "filler" | "divider" | "custom_text";

export interface DescriptionGridItem {
  id: string;
  kind: DescriptionItemKind;
  tagId?: string;
  label: string;
  customText?: string;
}

export interface DescriptionGridRow {
  id: string;
  columns: DescriptionGridItem[];
}

export interface DescriptionSectionLayout {
  sectionId: DescriptionSectionId;
  enabled: boolean;
  rows: DescriptionGridRow[];
}

export interface DescriptionPatternConfig {
  sections: DescriptionSectionLayout[];
}

export interface DescriptionAutomationRule {
  sale: DescriptionPatternConfig;
  rent: DescriptionPatternConfig;
}

export interface DescriptionSubsectionTagDef {
  id: string;
  label: string;
}

export interface DescriptionSectionDef {
  id: DescriptionSectionId;
  label: string;
  saleTags: DescriptionSubsectionTagDef[];
  rentTags: DescriptionSubsectionTagDef[];
}

export const DESCRIPTION_SECTION_DEFS: DescriptionSectionDef[] = [
  {
    id: "pret_conditii",
    label: "Preț & Condiții",
    saleTags: [
      { id: "pret", label: "preț" },
      { id: "tva", label: "tva" },
      { id: "comision", label: "comision" },
      { id: "situatie_juridica", label: "situație juridică" },
      { id: "disponibilitate", label: "disponibilitate" },
      { id: "finantare", label: "finanțare" },
    ],
    rentTags: [
      { id: "pret", label: "preț" },
      { id: "tva", label: "tva" },
      { id: "comision", label: "comision" },
      { id: "contract", label: "contract" },
      { id: "avans", label: "avans" },
      { id: "garantie", label: "garanție" },
    ],
  },
  {
    id: "introducere",
    label: "Introducere",
    saleTags: [
      { id: "titlu", label: "titlu" },
      { id: "descriere", label: "descriere" },
    ],
    rentTags: [
      { id: "titlu", label: "titlu" },
      { id: "descriere", label: "descriere" },
    ],
  },
  {
    id: "apartament",
    label: "Apartament",
    saleTags: [
      { id: "general", label: "general" },
      { id: "finisaje", label: "finisaje" },
      { id: "mobilare", label: "mobilare" },
      { id: "dotari", label: "dotări" },
    ],
    rentTags: [
      { id: "general", label: "general" },
      { id: "finisaje", label: "finisaje" },
      { id: "mobilare", label: "mobilare" },
      { id: "dotari", label: "dotări" },
    ],
  },
  {
    id: "bloc",
    label: "Bloc",
    saleTags: [
      { id: "acces", label: "acces" },
      { id: "spatii", label: "spații" },
      { id: "dotari_bloc", label: "dotări" },
      { id: "servicii", label: "servicii" },
    ],
    rentTags: [
      { id: "acces", label: "acces" },
      { id: "spatii", label: "spații" },
      { id: "dotari_bloc", label: "dotări" },
      { id: "servicii", label: "servicii" },
    ],
  },
  {
    id: "imprejurimi",
    label: "Împrejurimi",
    saleTags: [
      { id: "educatie", label: "educație" },
      { id: "comert", label: "comerț" },
      { id: "benzinarii", label: "benzinării" },
      { id: "sanatate", label: "sănătate" },
      { id: "relaxare", label: "relaxare" },
      { id: "divertisment", label: "divertisment" },
      { id: "obiective", label: "obiective" },
    ],
    rentTags: [
      { id: "educatie", label: "educație" },
      { id: "comert", label: "comerț" },
      { id: "benzinarii", label: "benzinării" },
      { id: "sanatate", label: "sănătate" },
      { id: "relaxare", label: "relaxare" },
      { id: "divertisment", label: "divertisment" },
      { id: "obiective", label: "obiective" },
    ],
  },
  {
    id: "transport",
    label: "Transport",
    saleTags: [
      { id: "metrou", label: "metrou" },
      { id: "tramvai", label: "tramvai" },
      { id: "troleibuz", label: "troleibuz" },
      { id: "autobuz", label: "autobuz" },
    ],
    rentTags: [
      { id: "metrou", label: "metrou" },
      { id: "tramvai", label: "tramvai" },
      { id: "troleibuz", label: "troleibuz" },
      { id: "autobuz", label: "autobuz" },
    ],
  },
  {
    id: "parcare",
    label: "Parcare",
    saleTags: [{ id: "parcare_info", label: "parcare" }],
    rentTags: [{ id: "parcare_info", label: "parcare" }],
  },
];

export function createEmptyDescriptionPattern(): DescriptionPatternConfig {
  return {
    sections: DESCRIPTION_SECTION_DEFS.map((def) => ({
      sectionId: def.id,
      enabled: true,
      rows: [],
    })),
  };
}

export function createPresetDescriptionPattern(target: "sale" | "rent"): DescriptionPatternConfig {
  const mkItem = (secId: string, tagId: string, label: string): DescriptionGridItem => ({
    id: `preset_${target}_${secId}_${tagId}`,
    kind: "subsection",
    tagId,
    label,
  });

  return {
    sections: [
      {
        sectionId: "pret_conditii",
        enabled: true,
        rows:
          target === "rent"
            ? [
                {
                  id: `row_${target}_pc_1`,
                  columns: [
                    mkItem("pret_conditii", "pret", "preț"),
                    mkItem("pret_conditii", "tva", "tva"),
                  ],
                },
                {
                  id: `row_${target}_pc_2`,
                  columns: [
                    mkItem("pret_conditii", "comision", "comision"),
                    mkItem("pret_conditii", "contract", "contract"),
                  ],
                },
                {
                  id: `row_${target}_pc_3`,
                  columns: [
                    mkItem("pret_conditii", "avans", "avans"),
                    mkItem("pret_conditii", "garantie", "garanție"),
                  ],
                },
              ]
            : [
                {
                  id: `row_${target}_pc_1`,
                  columns: [
                    mkItem("pret_conditii", "pret", "preț"),
                    mkItem("pret_conditii", "tva", "tva"),
                  ],
                },
                {
                  id: `row_${target}_pc_2`,
                  columns: [
                    mkItem("pret_conditii", "comision", "comision"),
                    mkItem("pret_conditii", "situatie_juridica", "situație juridică"),
                  ],
                },
                {
                  id: `row_${target}_pc_3`,
                  columns: [
                    mkItem("pret_conditii", "disponibilitate", "disponibilitate"),
                    mkItem("pret_conditii", "finantare", "finanțare"),
                  ],
                },
              ],
      },
      {
        sectionId: "introducere",
        enabled: true,
        rows: [
          { id: `row_${target}_intro_1`, columns: [mkItem("introducere", "titlu", "titlu")] },
          { id: `row_${target}_intro_2`, columns: [mkItem("introducere", "descriere", "descriere")] },
        ],
      },
      {
        sectionId: "apartament",
        enabled: true,
        rows: [
          {
            id: `row_${target}_ap_1`,
            columns: [
              mkItem("apartament", "general", "general"),
              mkItem("apartament", "finisaje", "finisaje"),
            ],
          },
          {
            id: `row_${target}_ap_2`,
            columns: [
              mkItem("apartament", "mobilare", "mobilare"),
              mkItem("apartament", "dotari", "dotări"),
            ],
          },
        ],
      },
      {
        sectionId: "bloc",
        enabled: true,
        rows: [
          {
            id: `row_${target}_bloc_1`,
            columns: [mkItem("bloc", "acces", "acces"), mkItem("bloc", "spatii", "spații")],
          },
          {
            id: `row_${target}_bloc_2`,
            columns: [mkItem("bloc", "dotari_bloc", "dotări"), mkItem("bloc", "servicii", "servicii")],
          },
        ],
      },
      {
        sectionId: "imprejurimi",
        enabled: true,
        rows: [
          {
            id: `row_${target}_imp_1`,
            columns: [
              mkItem("imprejurimi", "educatie", "educație"),
              mkItem("imprejurimi", "comert", "comerț"),
            ],
          },
          {
            id: `row_${target}_imp_2`,
            columns: [
              mkItem("imprejurimi", "benzinarii", "benzinării"),
              mkItem("imprejurimi", "sanatate", "sănătate"),
            ],
          },
          {
            id: `row_${target}_imp_3`,
            columns: [
              mkItem("imprejurimi", "relaxare", "relaxare"),
              mkItem("imprejurimi", "divertisment", "divertisment"),
            ],
          },
          {
            id: `row_${target}_imp_4`,
            columns: [mkItem("imprejurimi", "obiective", "obiective")],
          },
        ],
      },
      {
        sectionId: "transport",
        enabled: true,
        rows: [
          {
            id: `row_${target}_tr_1`,
            columns: [
              mkItem("transport", "metrou", "metrou"),
              mkItem("transport", "tramvai", "tramvai"),
            ],
          },
          {
            id: `row_${target}_tr_2`,
            columns: [
              mkItem("transport", "troleibuz", "troleibuz"),
              mkItem("transport", "autobuz", "autobuz"),
            ],
          },
        ],
      },
      {
        sectionId: "parcare",
        enabled: true,
        rows: [
          {
            id: `row_${target}_par_1`,
            columns: [mkItem("parcare", "parcare_info", "parcare")],
          },
        ],
      },
    ],
  };
}

export const DEFAULT_DESCRIPTION_AUTOMATION_RULE: DescriptionAutomationRule = {
  sale: createEmptyDescriptionPattern(),
  rent: createEmptyDescriptionPattern(),
};

function normalizeDescriptionPattern(
  rawPattern: unknown,
  target: "sale" | "rent"
): DescriptionPatternConfig {
  const input =
    rawPattern && typeof rawPattern === "object" ? (rawPattern as Record<string, any>) : {};
  const rawSections = Array.isArray(input.sections) ? input.sections : [];
  const rawById = new Map<string, any>();
  for (const sec of rawSections) {
    if (sec && typeof sec.sectionId === "string" && !rawById.has(sec.sectionId)) {
      rawById.set(sec.sectionId, sec);
    }
  }

  const sections: DescriptionSectionLayout[] = DESCRIPTION_SECTION_DEFS.map((def) => {
    const validTags = target === "rent" ? def.rentTags : def.saleTags;
    const validTagMap = new Map(validTags.map((t) => [t.id, t]));
    const rawSec = rawById.get(def.id);
    const enabled = typeof rawSec?.enabled === "boolean" ? rawSec.enabled : true;

    const seenSubsectionIds = new Set<string>();
    const rows: DescriptionGridRow[] = [];

    if (Array.isArray(rawSec?.rows)) {
      for (let rIdx = 0; rIdx < rawSec.rows.length; rIdx++) {
        const rawRow = rawSec.rows[rIdx];
        const rawCols = Array.isArray(rawRow?.columns) ? rawRow.columns : [];
        const columns: DescriptionGridItem[] = [];

        for (let cIdx = 0; cIdx < rawCols.length && columns.length < 4; cIdx++) {
          const rawItem = rawCols[cIdx];
          if (!rawItem || typeof rawItem !== "object") continue;
          const kind = rawItem.kind as DescriptionItemKind;
          if (kind === "subsection") {
            const tagId = typeof rawItem.tagId === "string" ? rawItem.tagId : "";
            const tagDef = validTagMap.get(tagId);
            if (!tagDef || seenSubsectionIds.has(tagId)) continue;
            seenSubsectionIds.add(tagId);
            columns.push({
              id: typeof rawItem.id === "string" && rawItem.id ? rawItem.id : `item_${def.id}_${tagId}`,
              kind: "subsection",
              tagId: tagDef.id,
              label: tagDef.label,
            });
          } else if (kind === "filler" || kind === "divider" || kind === "custom_text") {
            columns.push({
              id:
                typeof rawItem.id === "string" && rawItem.id
                  ? rawItem.id
                  : `item_${def.id}_${kind}_${rIdx}_${cIdx}`,
              kind,
              label:
                kind === "filler"
                  ? "spațiu"
                  : kind === "divider"
                  ? "linie"
                  : "text personalizat",
              ...(kind === "custom_text"
                ? { customText: typeof rawItem.customText === "string" ? rawItem.customText : "" }
                : {}),
            });
          }
        }

        if (columns.length > 0) {
          rows.push({
            id: typeof rawRow?.id === "string" && rawRow.id ? rawRow.id : `row_${def.id}_${rIdx}`,
            columns,
          });
        }
      }
    }

    return {
      sectionId: def.id,
      enabled,
      rows,
    };
  });

  return { sections };
}

export function normalizeDescriptionAutomationRule(raw: unknown): DescriptionAutomationRule {
  const input = raw && typeof raw === "object" ? (raw as Record<string, any>) : {};
  return {
    sale: normalizeDescriptionPattern(input.sale, "sale"),
    rent: normalizeDescriptionPattern(input.rent, "rent"),
  };
}

export interface TitleAutomationRule {
  enabled: boolean;
  minChars: number;
  maxChars: number;
  salePattern: string;
  rentPattern: string;
  customValues: TitleCustomValues;
  categories: TitleCategoryConfig[];
  descriptionLayout?: DescriptionAutomationRule;
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
      { id: "space", label: "spațiu", token: "[ ]" },
      { id: "pipe", label: "|", token: "[|]" },
      { id: "slash", label: "/", token: "[/]" },
      { id: "backslash", label: "\\", token: "[\\]" },
      { id: "comma", label: ",", token: "[,]" },
    ],
  },
  {
    id: "tranzactie",
    label: "Tranzactie",
    tags: [{ id: "tip_tranzactie", label: "tip tranzactie", token: "[tip tranzactie]" }],
  },
  {
    id: "general",
    label: "General",
    tags: [
      { id: "tip", label: "tip", token: "[tip proprietate]" },
      { id: "camere", label: "camere", token: "[camere]" },
      { id: "utila", label: "utila", token: "[suprafata utila]" },
      { id: "construita", label: "construita", token: "[suprafata construita]" },
      { id: "etaj", label: "etaj", token: "[etaj]" },
      { id: "etaje_total", label: "etaje in total", token: "[etaje in total]" },
    ],
  },
  {
    id: "transport",
    label: "Transport",
    tags: [
      { id: "statie", label: "statie", token: "[statie]" },
      { id: "distanta_statie", label: "distanta statie", token: "[distanta statie]" },
    ],
  },
  {
    id: "relaxare",
    label: "Relaxare",
    tags: [
      { id: "nume_parc", label: "nume parc", token: "[nume parc]" },
      { id: "distanta_parc", label: "distanta parc", token: "[distanta parc]" },
    ],
  },
  {
    id: "atractie",
    label: "Atractie",
    tags: [
      { id: "nume_atractie", label: "nume atractie", token: "[nume atractie]" },
      { id: "distanta_atractie", label: "distanta atractie", token: "[distanta atractie]" },
    ],
  },
  {
    id: "mobilare",
    label: "Mobilare",
    tags: [{ id: "mobilare", label: "mobilare", token: "[mobilare]" }],
  },
  {
    id: "utilare",
    label: "Utilare",
    tags: [{ id: "utilare", label: "utilare", token: "[utilare]" }],
  },
  {
    id: "parcare",
    label: "Parcare",
    tags: [{ id: "parcare", label: "parcare", token: "[parcare]" }],
  },
  {
    id: "animal_companie",
    label: "Animal companie",
    tags: [
      {
        id: "situatie_pet",
        label: "animal companie",
        token: "[pet]",
      },
    ],
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
  descriptionLayout: DEFAULT_DESCRIPTION_AUTOMATION_RULE,
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
    descriptionLayout: normalizeDescriptionAutomationRule(input.descriptionLayout),
  };
}
