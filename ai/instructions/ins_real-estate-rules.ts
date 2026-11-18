export const AI_REAL_ESTATE_RULES = {
  forbidden_terms: [
    "0% comision",
    "comision 0",
    "0 euro comision",
    "fara comision",
  ],
  title_generation_rules: [
    "Fara numere de strada, blocuri, scari sau apartamente",
    "Fara denumiri de complexe rezidentiale private in titlu",
    "Titlul din campul dedicat trebuie sa fie strict identic cu cel din descrierea generata",
    "Format: Tip imobil + camere/mp | Zona | Punct de interes | Punct forte | Dotari | Parcare",
  ],
  surface_calculation_rules: {
    residential_multiplier: 1.2, // Built area = usable * 1.2 for Apartments and Houses
    commercial_multiplier: 1.1,  // Built area = usable * 1.1 for Offices/Commercial
  },
} as const;
