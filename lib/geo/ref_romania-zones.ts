export interface RomanianZone {
  county: string;
  city: string;
  sectors_or_neighborhoods: string[];
}

export const ROMANIA_REGIONS: RomanianZone[] = [
  {
    county: "București",
    city: "București",
    sectors_or_neighborhoods: [
      "Sector 1", "Sector 2", "Sector 3", "Sector 4", "Sector 5", "Sector 6",
      "Aviatorilor", "Aviației", "Băneasa", "Dorobanți", "Floreasca", "Herăstrău", "Pipera", "Primăverii",
      "Colentina", "Iancului", "Moșilor", "Obor", "Pantelimon", "Ștefan cel Mare", "Tei",
      "Dristor", "Titan", "Vitan", "Timpuri Noi", "Muncii", "Nicolae Teclu", "Pallady",
      "Berceni", "Olteniței", "Tineretului", "Brâncoveanu", "Apărătorii Patriei",
      "Cotroceni", "Rahova", "13 Septembrie", "Panduri",
      "Drumul Taberei", "Militari", "Crângași", "Giulești", "Politehnica"
    ],
  },
  {
    county: "Ilfov",
    city: "Zona Metropolitană",
    sectors_or_neighborhoods: [
      "Otopeni", "Voluntari", "Chiajna", "Popești-Leordeni", "Bragadiru",
      "Corbeanca", "Snagov", "Tunari", "Măgurele", "Pantelimon Ilfov"
    ],
  },
  {
    county: "Cluj",
    city: "Cluj-Napoca",
    sectors_or_neighborhoods: [
      "Centru", "Gheorgheni", "Mărăști", "Mănăștur", "Zorilor", "Grigorescu", "Bună Ziua", "Europa", "Sopor"
    ],
  },
  {
    county: "Timiș",
    city: "Timișoara",
    sectors_or_neighborhoods: [
      "Centru", "Circumvalațiunii", "Iosefin", "Elisabetin", "Girocului", "Soarelui", "Aradului", "Lipovei"
    ],
  },
  {
    county: "Iași",
    city: "Iași",
    sectors_or_neighborhoods: [
      "Centru", "Copou", "Păcurari", "Tătărași", "Alexandru cel Bun", "Nicolina", "Bucium"
    ],
  },
  {
    county: "Brașov",
    city: "Brașov",
    sectors_or_neighborhoods: [
      "Centrul Istoric", "Centrul Civic", "Astra", "Tractorul", "Bartolomeu", "Noua", "Răcădău"
    ],
  },
  {
    county: "Constanța",
    city: "Constanța",
    sectors_or_neighborhoods: [
      "Centru", "Faleză Nord", "Mamaia", "Tomis Nord", "Tomis Plus", "Km 4-5", "Inel II"
    ],
  },
];
