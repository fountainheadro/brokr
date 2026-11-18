export const PROPERTY_CATEGORIES = [
  "Apartamente",
  "Case / Vile",
  "Terenuri",
  "Spatii birouri",
  "Spatii comerciale",
  "Spatii industriale",
  "Spatii depozitare",
  "Hale",
  "Alte tipuri",
] as const;

export type PropertyCategory = typeof PROPERTY_CATEGORIES[number];

export const TRANSACTION_TYPES = ["Vânzare", "Închiriere"] as const;
export type TransactionType = typeof TRANSACTION_TYPES[number];

export const PARTITIONING_TYPES = [
  "Decomandat",
  "Semidecomandat",
  "Nedecomandat",
  "Circular",
  "Open space",
] as const;
export type PartitioningType = typeof PARTITIONING_TYPES[number];

export const HEATING_SYSTEMS = [
  "Centrala proprie",
  "Centrala imobil",
  "Termoficare",
  "Incalzire in pardoseala",
  "Alte surse",
] as const;
export type HeatingSystem = typeof HEATING_SYSTEMS[number];

export const FURNISHING_LEVELS = [
  "Complet",
  "Partial",
  "Nemobilat",
  "Lux",
  "Modern",
] as const;
export type FurnishingLevel = typeof FURNISHING_LEVELS[number];
