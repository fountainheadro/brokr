import React, { useState } from 'react';
import { CRMData, generateAIText } from '../services/geminiService';
import { toast } from 'react-hot-toast';
import { 
  FormLabel, 
  FormInput, 
  FormSelect, 
  FormCheckbox, 
  FormRadio,
  FormRadioBar, 
  FormGrid, 
  FormInputWithCounter,
  SectionHeader,
  FormDivider,
  ImageCard,
  PromoCard,
  EditableMultiSelect
} from './FormElements';
import { Download, FileText, Search, Zap, Sparkles, Loader2, ArrowRightLeft } from 'lucide-react';
import { getCleanDisplayImageUrl } from '../utils/imageUtils';

import { 
  STADIU_OPTIONS, 
  TRANZACTIE_OPTIONS, 
  CATEGORIA_OPTIONS, 
  ORAS_OPTIONS, 
  IMPREJURIMI_OPTIONS,
  TIP_APARTAMENT_OPTIONS,
  COMPARTIMENTARE_OPTIONS,
  CONFORT_OPTIONS,
  DESTINATIE_OPTIONS,
  ETAJ_OPTIONS,
  ORIENTARE_OPTIONS,
  STADIU_CONSTRUCTIE_OPTIONS,
  TIP_IMOBIL_OPTIONS,
  STRUCTURA_OPTIONS,
  RISC_SEISMIC_OPTIONS,
  CLASA_ENERGETICA_OPTIONS,
  ZONA_OPTIONS,
  TIP_SPATIU_COMERCIAL_OPTIONS
} from '../constants';
import { APIProvider, Map, AdvancedMarker, Pin, useMap, useMapsLibrary } from '@vis.gl/react-google-maps';

const API_KEY = process.env.GOOGLE_MAPS_PLATFORM_KEY || "";
const hasValidKey = Boolean(API_KEY) && API_KEY !== 'YOUR_API_KEY';

const DEFAULT_CENTER = {
  lat: 44.4268,
  lng: 26.1025
};

const EMPTY_ARRAY: string[] = [];

const normalizeForMatch = (val: any) => {
  return String(val || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove diacritics
    .replace(/[^a-z0-9]/g, ""); // Remove non-alphanumeric
};

const isChecked = (list: any[] | undefined, label: string) => {
  if (!list || !Array.isArray(list)) return false;
  const normalizedLabel = normalizeForMatch(label);
  const result = list.some(item => normalizeForMatch(String(item)) === normalizedLabel);
  console.log(`[PropertyForm] isChecked: label="${label}", result=${result}`, list);
  return result;
};

const toggleInList = (list: any[] | undefined, label: string, checked: boolean) => {
  const currentList = Array.isArray(list) ? list : [];
  const normalizedLabel = normalizeForMatch(label);
  console.log(`[PropertyForm] toggleInList: label="${label}", checked=${checked}`, currentList);
  
  if (checked) {
    const exists = currentList.some(item => normalizeForMatch(String(item)) === normalizedLabel);
    const result = exists ? currentList : [...currentList, label];
    console.log(`[PropertyForm] toggleInList result (checked=true):`, result);
    return result;
  } else {
    const result = currentList.filter(item => normalizeForMatch(String(item)) !== normalizedLabel);
    console.log(`[PropertyForm] toggleInList result (checked=false):`, result);
    return result;
  }
};

const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371e3; // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // in meters
};

const CATEGORY_MAPPING = [
  {
    id: 1,
    name: "Landmarks & Monuments",
    match: (tags: any) => tags.historic === 'monument' || tags.historic === 'memorial' || tags.tourism === 'artwork',
  },
  {
    id: 2,
    name: "Tourist Attractions",
    match: (tags: any) => tags.tourism === 'attraction' || tags.tourism === 'viewpoint' || tags.tourism === 'theme_park',
  },
  {
    id: 3,
    name: "Historic Sites",
    match: (tags: any) => tags.historic && !['monument', 'memorial'].includes(tags.historic),
  },
  {
    id: 4,
    name: "Museums",
    match: (tags: any) => tags.tourism === 'museum' || tags.amenity === 'arts_centre' || tags.tourism === 'gallery',
  },
  {
    id: 5,
    name: "Parks & Gardens",
    match: (tags: any) => tags.leisure === 'park' || tags.leisure === 'garden' || tags.landuse === 'forest',
  },
  {
    id: 6,
    name: "Airports",
    match: (tags: any) => tags.aeroway === 'aerodrome' || tags.aeroway === 'terminal',
  },
  {
    id: 7,
    name: "Major Train Stations",
    match: (tags: any) => tags.railway === 'station',
  },
  {
    id: 8,
    name: "Universities",
    match: (tags: any) => tags.amenity === 'university' || tags.amenity === 'college',
  },
  {
    id: 9,
    name: "Government Buildings",
    match: (tags: any) => tags.office === 'government' || tags.amenity === 'townhall' || tags.amenity === 'courthouse' || tags.amenity === 'embassy',
  },
  {
    id: 10,
    name: "Religious Sites",
    match: (tags: any) => tags.amenity === 'place_of_worship',
  },
  {
    id: 11,
    name: "Stadiums & Arenas",
    match: (tags: any) => tags.leisure === 'stadium' || tags.building === 'stadium' || tags.leisure === 'sports_centre',
  },
  {
    id: 12,
    name: "Shopping Malls & Markets",
    match: (tags: any) => tags.shop === 'mall' || tags.shop === 'supermarket' || tags.amenity === 'marketplace',
  },
  {
    id: 13,
    name: "Convention Centers",
    match: (tags: any) => tags.amenity === 'conference_centre' || tags.amenity === 'exhibition_centre',
  },
  {
    id: 14,
    name: "Hotels",
    match: (tags: any) => tags.tourism === 'hotel' || tags.tourism === 'guest_house' || tags.tourism === 'hostel',
  },
  {
    id: 15,
    name: "Restaurants",
    match: (tags: any) => tags.amenity === 'restaurant' || tags.amenity === 'cafe' || tags.amenity === 'food_court',
  }
];

const buildOverpassQuery = (lat: number, lng: number) => {
  return `[out:json][timeout:15];(
    nwr(around:2000,${lat},${lng})["historic"~"monument|memorial|castle|ruins|archaeological_site|tomb|fort"];
    nwr(around:2000,${lat},${lng})["tourism"~"artwork|attraction|viewpoint|theme_park|museum|hotel|guest_house|hostel"];
    nwr(around:2000,${lat},${lng})["amenity"~"arts_centre|university|college|townhall|courthouse|embassy|place_of_worship|stadium|marketplace|conference_centre|exhibition_centre|restaurant|cafe|food_court"];
    nwr(around:2000,${lat},${lng})["leisure"~"park|garden|stadium"];
    nwr(around:2000,${lat},${lng})["aeroway"~"aerodrome|terminal"];
    nwr(around:2000,${lat},${lng})["railway"="station"];
    nwr(around:2000,${lat},${lng})["shop"~"mall|supermarket"];
    nwr(around:2000,${lat},${lng})["office"="government"];
  );out center;`;
};

const processOSMResults = (elements: any[], centerLat: number, centerLng: number) => {
  const allPOIs: { name: string; distance: number }[] = [];
  const seenNames = new Set<string>();

  elements.forEach((elem: any) => {
    const tags = elem.tags || {};
    const name = tags.name || tags.official_name;
    if (!name) return;

    const normName = name.trim();
    if (seenNames.has(normName.toLowerCase())) return;

    const lat = elem.lat || elem.center?.lat;
    const lon = elem.lon || elem.center?.lon;
    if (lat === undefined || lon === undefined) return;

    const dist = calculateDistance(centerLat, centerLng, lat, lon);
    if (dist > 2000) return;

    for (const cat of CATEGORY_MAPPING) {
      if (cat.match(tags)) {
        allPOIs.push({
          name: normName,
          distance: dist
        });
        seenNames.add(normName.toLowerCase());
        break;
      }
    }
  });

  // Sort by distance ascending
  allPOIs.sort((a, b) => a.distance - b.distance);

  // Take the top 5 closest unique POIs and map to their names only
  const finalPOIs = allPOIs.slice(0, 5).map(item => item.name);

  return finalPOIs;
};

const MapController = ({ 
  strada, 
  numar, 
  oras, 
  onLocationFound,
  onUpdate
}: { 
  strada?: string, 
  numar?: string, 
  oras?: string, 
  onLocationFound: (pos: { lat: number, lng: number }) => void,
  onUpdate?: (path: string, val: any) => void
}) => {
  const map = useMap();

  // Keep track of the last reverse geocoded values to avoid forward geocoding loops
  const lastReverseGeocodedRef = React.useRef<{ strada: string, numar: string } | null>(null);

  // Keep track of last map center to avoid reverse geocoding when camera moves from forward geocoding
  const lastCenterRef = React.useRef<{ lat: number, lng: number } | null>(null);

  // Keep track of last coordinates for points of interest generation to prevent redundant queries
  const lastFetchedPOICoordsRef = React.useRef<{ lat: number, lng: number } | null>(null);

  // Center coordinate state to trigger points of interest lookup safely
  const [centerForPOI, setCenterForPOI] = React.useState<{ lat: number, lng: number } | null>(null);

  // Forward Geocoding: address inputs change -> move the map
  React.useEffect(() => {
    if (!map) return;

    const normStrada = (strada || "").trim();
    const normNumar = (numar || "").trim();

    if (!normStrada) return;

    // Direct check: IF input matches our last reverse geocoded values, ignore movement to prevent loop
    if (
      lastReverseGeocodedRef.current &&
      lastReverseGeocodedRef.current.strada === normStrada &&
      lastReverseGeocodedRef.current.numar === normNumar
    ) {
      return;
    }

    const queryParts = [normStrada];
    if (normNumar) {
      queryParts.push(normNumar);
    }
    if (oras && oras.trim() !== '') {
      queryParts.push(oras.trim());
    } else {
      queryParts.push("Bucuresti");
    }
    queryParts.push("Romania");

    const fullAddress = queryParts.join(", ");

    const delayDebounceFn = setTimeout(() => {
      const tryGoogleGeocoding = (addressStr: string): Promise<{ lat: number, lng: number } | null> => {
        return new Promise((resolve) => {
          // Bypassing Google Geocoding to prevent "Geocoding Service: This API is not activated" errors
          resolve(null);
        });
      };

      const tryNominatimGeocoding = async (addressStr: string) => {
        try {
          const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addressStr)}`;
          const res = await fetch(url, {
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'brokr-CRM-Real-Estate-Extract'
            }
          });
          if (!res.ok) return null;
          const data = await res.json();
          if (data && data[0]) {
            const lat = parseFloat(data[0].lat);
            const lng = parseFloat(data[0].lon);
            if (!isNaN(lat) && !isNaN(lng)) {
              return { lat, lng };
            }
          }
        } catch (err) {
          console.error("Nominatim geocoding error:", err);
        }
        return null;
      };

      const runGeocoding = async () => {
        console.log(`Starting geocoding process for: "${fullAddress}"`);
        
        // 1. Try Google geocoding with full address (with street number)
        let pos = await tryGoogleGeocoding(fullAddress);

        // 2. Fall back to street name only (if house number cannot be found in Google Maps)
        if (!pos && normNumar) {
          const fallbackParts = [normStrada];
          if (oras && oras.trim() !== '') {
            fallbackParts.push(oras.trim());
          } else {
            fallbackParts.push("Bucuresti");
          }
          fallbackParts.push("Romania");
          const fallbackAddress = fallbackParts.join(", ");
          console.log(`Google Geocoding failed with house number: "${fullAddress}". Trying fallback street only with Google: "${fallbackAddress}"`);
          pos = await tryGoogleGeocoding(fallbackAddress);
        }

        // 3. Dual fallback to Nominatim (with house number)
        if (!pos) {
          console.log(`Google Geocoding returned no results. Trying Nominatim with full address: "${fullAddress}"`);
          pos = await tryNominatimGeocoding(fullAddress);
        }

        // 4. Dual fallback to Nominatim (street only)
        if (!pos && normNumar) {
          const fallbackParts = [normStrada];
          if (oras && oras.trim() !== '') {
            fallbackParts.push(oras.trim());
          } else {
            fallbackParts.push("Bucuresti");
          }
          fallbackParts.push("Romania");
          const fallbackAddress = fallbackParts.join(", ");
          console.log(`Nominatim failed with house number. Trying fallback street only with Nominatim: "${fallbackAddress}"`);
          pos = await tryNominatimGeocoding(fallbackAddress);
        }

        if (pos) {
          console.log(`Geocoding succeeded! Moving camera to: lat=${pos.lat}, lng=${pos.lng}`);
          // Update ref so reverse geocoding doesn't trip on this center
          lastCenterRef.current = pos;
          onLocationFound(pos);
          setCenterForPOI(pos);
          map.panTo(pos);
          map.setZoom(16);
        } else {
          console.warn(`Geocoding system was unable to find address: "${fullAddress}"`);
        }
      };

      runGeocoding();
    }, 800);

    return () => clearTimeout(delayDebounceFn);
  }, [strada, numar, oras, map]);

  // Reverse Geocoding: user drags map -> lookup details and update street name / house number
  React.useEffect(() => {
    if (!map) return;

    const listener = map.addListener('idle', () => {
      const center = map.getCenter();
      if (!center) return;

      const lat = center.lat();
      const lng = center.lng();

      // Check if camera is extremely close to the last forward geocoding center to avoid loop
      if (lastCenterRef.current) {
        const dLat = Math.abs(lastCenterRef.current.lat - lat);
        const dLng = Math.abs(lastCenterRef.current.lng - lng);
        if (dLat < 0.0001 && dLng < 0.0001) {
          return; // Avoid triggering reverse mapping on visual jumps
        }
      }

      // Update refs
      const pos = { lat, lng };
      lastCenterRef.current = pos;
      onLocationFound(pos);
      setCenterForPOI(pos);

      const runReverseGeocoding = async () => {
         const tryGoogleReverseGeocoding = (): Promise<{ strada: string, numar: string } | null> => {
          return new Promise((resolve) => {
            // Bypassing Google Reverse Geocoding to prevent "Geocoding Service: This API is not activated" errors
            resolve(null);
          });
        };

        const tryNominatimReverseGeocoding = async () => {
          try {
            const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
            const res = await fetch(url, {
              headers: {
                'Accept': 'application/json',
                'User-Agent': 'brokr-CRM-Real-Estate-Extract'
              }
            });
            if (!res.ok) return null;
            const resData = await res.json();
            if (resData && resData.address) {
              const street = resData.address.road || resData.address.street || resData.address.pedestrian || "";
              const number = resData.address.house_number || "";
              if (street) {
                return { strada: street, numar: number };
              }
            }
          } catch (e) {
            console.error("Nominatim reverse geocoding error:", e);
          }
          return null;
        };

        // 1. Try Google Reverse Geocoding first
        let found = await tryGoogleReverseGeocoding();

        // 2. Fall back to Nominatim Reverse Geocoding
        if (!found) {
          console.log("Google Reverse Geocoding failed, trying Nominatim...");
          found = await tryNominatimReverseGeocoding();
        }

        if (found) {
          lastReverseGeocodedRef.current = { strada: found.strada, numar: found.numar };
          onUpdate?.('crmData.detaliiGenerale.localizare.strada', found.strada);
          onUpdate?.('crmData.detaliiGenerale.localizare.numar', found.numar);
        }
      };

      runReverseGeocoding();
    });

    return () => {
      listener.remove();
    };
  }, [map, onUpdate, onLocationFound]);

  // Points of Interest Fetching: based on stabilized coordinates, fetch landmarks & nearby attractions within 2km range with priority
  React.useEffect(() => {
    if (!centerForPOI) return;
    const { lat, lng } = centerForPOI;

    if (lastFetchedPOICoordsRef.current) {
      const d = calculateDistance(
        lastFetchedPOICoordsRef.current.lat,
        lastFetchedPOICoordsRef.current.lng,
        lat,
        lng
      );
      if (d < 50) {
        return; // Position didn't change significantly, skip query triggers
      }
    }

    const delayTimer = setTimeout(async () => {
      lastFetchedPOICoordsRef.current = { lat, lng };

      const query = buildOverpassQuery(lat, lng);
      const endpoints = [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
        "https://overpass.nchc.org.tw/api/interpreter"
      ];

      let elements: any[] = [];
      for (const endpoint of endpoints) {
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            body: `data=${encodeURIComponent(query)}`,
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
            }
          });
          if (response.ok) {
            const data = await response.json();
            if (data && data.elements) {
              elements = data.elements;
              break; // Stop loop once successfully fetched
            }
          }
        } catch (e) {
          console.warn(`Overpass fetch failed on endpoint "${endpoint}":`, e);
        }
      }

      if (elements && elements.length > 0) {
        const pois = processOSMResults(elements, lat, lng);
        if (pois && pois.length > 0) {
          onUpdate?.('crmData.detaliiGenerale.localizare.puncteInteres', pois);
        }
      }
    }, 1200); // 1.2s debounce buffer

    return () => clearTimeout(delayTimer);
  }, [centerForPOI, onUpdate]);

  return null;
};

export const DetaliiGeneraleSection = ({ data, onUpdate, categoria }: { data: any, onUpdate?: (path: string, val: any) => void, categoria?: string }) => {
  const safeData = data || { localizare: {}, detalii: {} };
  const isSpatiuComercial = normalizeForMatch(categoria || "").includes("comercial") || 
                           normalizeForMatch(categoria || "").includes("industrial") || 
                           normalizeForMatch(categoria || "").includes("depozitare") || 
                           normalizeForMatch(categoria || "").includes("hale");

  const [markerPosition, setMarkerPosition] = React.useState(DEFAULT_CENTER);

  return (
    <div className="space-y-4">
      <SectionHeader>Detalii Generale</SectionHeader>
      <div className="grid grid-cols-1 gap-4">
        <div className="space-y-4">
          <FormGrid cols={3}>
            <div><FormLabel>Stadiu</FormLabel><FormSelect value={safeData.stadiu || STADIU_OPTIONS[0]} options={STADIU_OPTIONS} placeholder="Activ - Hot" onChange={(val) => onUpdate?.('crmData.detaliiGenerale.stadiu', val)} /></div>
            <div><FormLabel>Tranzacție</FormLabel><FormSelect value={safeData.tranzactie} options={TRANZACTIE_OPTIONS} placeholder="" showEmpty={false} onChange={(val) => onUpdate?.('crmData.detaliiGenerale.tranzactie', val)} /></div>
            <div><FormLabel>Categoria</FormLabel><FormSelect value={safeData.categoria} options={CATEGORIA_OPTIONS} placeholder="" showEmpty={false} onChange={(val) => onUpdate?.('crmData.detaliiGenerale.categoria', val)} /></div>
          </FormGrid>
          <FormGrid cols={3}>
            <div><FormLabel>Proprietar</FormLabel><FormInput value={safeData.proprietar} placeholder="" onChange={(val) => onUpdate?.('crmData.detaliiGenerale.proprietar', val)} /></div>
            <div><FormLabel>Contacte Adiționale</FormLabel><FormInput value={safeData.contacteAditionale} onChange={(val) => onUpdate?.('crmData.detaliiGenerale.contacteAditionale', val)} /></div>
            <div><FormLabel>Ansamblu Rezidențial</FormLabel><FormInput value={safeData.ansambluRezidential || ""} onChange={(val) => onUpdate?.('crmData.detaliiGenerale.ansambluRezidential', val)} /></div>
          </FormGrid>
        </div>
      </div>
      
      <FormDivider />
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="flex-1 space-y-4">
          <SectionHeader>Localizare</SectionHeader>
          <div>
            <FormLabel>Oraș</FormLabel>
            <FormSelect value={safeData.localizare?.oras} options={ORAS_OPTIONS} placeholder="Selecteaza Oras" onChange={(val) => onUpdate?.('crmData.detaliiGenerale.localizare.oras', val)} />
          </div>
          <div>
            <FormLabel>Zonă</FormLabel>
            <EditableMultiSelect 
              label="Zonă" 
              options={ZONA_OPTIONS} 
              initialSelected={safeData.localizare?.zona || EMPTY_ARRAY} 
              onChange={(val) => onUpdate?.('crmData.detaliiGenerale.localizare.zona', val)}
            />
          </div>
          
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <FormLabel>Stradă</FormLabel>
              <FormInput 
                value={safeData.localizare?.strada} 
                onChange={(val) => onUpdate?.('crmData.detaliiGenerale.localizare.strada', val)} 
              />
            </div>
            <div>
              <FormLabel>Număr</FormLabel>
              <FormInput 
                value={safeData.localizare?.numar} 
                onChange={(val) => onUpdate?.('crmData.detaliiGenerale.localizare.numar', val)} 
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <FormLabel>Bloc</FormLabel>
              <FormInput value={safeData.localizare?.bloc} onChange={(val) => onUpdate?.('crmData.detaliiGenerale.localizare.bloc', val)} />
            </div>
            <div>
              <FormLabel>Scară</FormLabel>
              <FormInput value={safeData.localizare?.scara} onChange={(val) => onUpdate?.('crmData.detaliiGenerale.localizare.scara', val)} />
            </div>
            <div>
              <FormLabel>{isSpatiuComercial ? "Unitate/Ap" : "Apartament"}</FormLabel>
              <FormInput value={safeData.localizare?.apartament} onChange={(val) => onUpdate?.('crmData.detaliiGenerale.localizare.apartament', val)} />
            </div>
          </div>
        </div>

        <div className="lg:w-1/2 aspect-square lg:aspect-auto h-[400px] lg:h-auto min-h-[300px]">
          {!hasValidKey ? (
            <div className="w-full h-full bg-white rounded-[16px] border border-gray-100 p-5 flex flex-col items-center justify-center text-center shadow-soft">
              <h4 className="font-title text-[15px] font-semibold text-[--color-text-main] mb-3">Google Maps API Key Required</h4>
              <p className="text-[12px] text-[--color-text-secondary] mb-6">
                Please add <code>GOOGLE_MAPS_PLATFORM_KEY</code> to your secrets to enable the map.
              </p>
              <a 
                href="https://console.cloud.google.com/google/maps-apis/start" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-[13px] text-[--color-accent] font-semibold hover:underline"
              >
                Get an API Key
              </a>
            </div>
          ) : (
            <div className="relative w-full h-full overflow-hidden rounded-[16px] border border-gray-100 shadow-soft">
              <APIProvider apiKey={API_KEY} version="weekly">
                <Map
                  {...({
                     defaultCenter: DEFAULT_CENTER,
                     defaultZoom: 13,
                     mapId: "DEMO_MAP_ID",
                     disableDefaultUI: true,
                     zoomControl: true,
                     gestureHandling: 'greedy',
                     internalUsageAttributionIds: ['gmp_mcp_codeassist_v1_aistudio'],
                     style: { width: '100%', height: '100%' }
                  } as any)}
                >
                  <MapController 
                    strada={safeData.localizare?.strada} 
                    numar={safeData.localizare?.numar} 
                    oras={safeData.localizare?.oras} 
                    onLocationFound={setMarkerPosition} 
                    onUpdate={onUpdate}
                  />
                </Map>
              </APIProvider>

              {/* Precise visual pinpoint target in the exact center of the map container, non-interactive */}
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="flex flex-col items-center justify-center -translate-y-5">
                  {/* Pin head and body */}
                  <div className="w-9 h-9 rounded-full bg-red-500 border-2 border-white shadow-lg flex items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-white shadow-inner" />
                  </div>
                  {/* Pin tip stick */}
                  <div className="w-2 h-3 bg-red-500 shadow-sm" />
                  {/* Shadow on map surface */}
                  <div className="w-4 h-1 bg-black/30 rounded-full blur-[1px] translate-y-1 scale-x-125" />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <FormDivider />
      <div className="grid grid-cols-2 gap-4">
        <div>
          <FormLabel>Puncte de Interes</FormLabel>
          <FormInput 
            value={(safeData.localizare?.puncteInteres || EMPTY_ARRAY).join(', ')} 
            onChange={(val) => onUpdate?.('crmData.detaliiGenerale.localizare.puncteInteres', val.split(',').map(s => s.trim()).filter(Boolean))}
          />
        </div>
        <div>
          <FormLabel>Împrejurimi</FormLabel>
          <EditableMultiSelect 
            label="Împrejurimi" 
            options={IMPREJURIMI_OPTIONS} 
            initialSelected={safeData.localizare?.imprejurimi || EMPTY_ARRAY} 
            onChange={(val) => onUpdate?.('crmData.detaliiGenerale.localizare.imprejurimi', val)}
          />
        </div>
      </div>
      <FormDivider />
      <SectionHeader>Memo Privat</SectionHeader>
      <EditableTextArea 
        initialValue={safeData.memoPrivat || ""} 
        onUpdate={(val) => onUpdate?.('crmData.detaliiGenerale.memoPrivat', val)}
      />
    </div>
  );
};

const EditableTextArea = ({ initialValue, height = "h-32", onUpdate }: { initialValue?: string, height?: string, onUpdate?: (val: string) => void }) => {
  const [value, setValue] = React.useState(initialValue || "");
  React.useEffect(() => setValue(initialValue || ""), [initialValue]);
  
  return (
    <textarea 
      value={value}
      onChange={(e) => {
        setValue(e.target.value);
        onUpdate?.(e.target.value);
      }}
      className={`input-base w-full ${height} p-4 font-normal resize-none`}
    />
  );
};

export const CaracteristiciSection = ({ data, onUpdate, categoria }: { data: any, onUpdate?: (path: string, val: any) => void, categoria?: string }) => {
  const safeData = data || { detalii: {}, alteDetalii: {}, suprafete: {}, energetica: {} };
  const isSpatiuComercial = normalizeForMatch(categoria || "").includes("comercial") || 
                           normalizeForMatch(categoria || "").includes("industrial") || 
                           normalizeForMatch(categoria || "").includes("depozitare") || 
                           normalizeForMatch(categoria || "").includes("hale");

  const [utila, setUtila] = React.useState(safeData.suprafete?.utila || "");
  const [balcoane, setBalcoane] = React.useState(safeData.suprafete?.balcoane || "");
  const [terase, setTerase] = React.useState(safeData.suprafete?.terase || "");
  const [construita, setConstruita] = React.useState(safeData.suprafete?.construita || "");
  const [utilaTotala, setUtilaTotala] = React.useState(safeData.suprafete?.utilaTotala || "");

  React.useEffect(() => {
    const u = safeData.suprafete?.utila || "";
    const b = safeData.suprafete?.balcoane || "";
    const t = safeData.suprafete?.terase || "";
    
    setUtila(u);
    setBalcoane(b);
    setTerase(t);

    const uVal = parseFloat(u) || 0;
    const bVal = parseFloat(b) || 0;
    const tVal = parseFloat(t) || 0;

    const normCat = (categoria || "").toLowerCase();
    const isApartmentOrVilla = normCat.includes("apartament") || normCat.includes("casa") || normCat.includes("vila") || normCat.includes("vile");
    const multiplier = isApartmentOrVilla ? 1.2 : 1.1;

    const calculatedConstruita = uVal > 0 ? (uVal * multiplier).toFixed(2) : "";
    const calculatedUtilaTotala = (uVal > 0 || bVal > 0 || tVal > 0) ? (uVal + bVal + tVal).toFixed(2) : "";

    setConstruita(calculatedConstruita);
    setUtilaTotala(calculatedUtilaTotala);

    if (calculatedConstruita && safeData.suprafete?.construita !== calculatedConstruita) {
      onUpdate?.('crmData.caracteristici.suprafete.construita', calculatedConstruita);
    }
    if (calculatedUtilaTotala && safeData.suprafete?.utilaTotala !== calculatedUtilaTotala) {
      onUpdate?.('crmData.caracteristici.suprafete.utilaTotala', calculatedUtilaTotala);
    }
  }, [safeData.suprafete, categoria]);

  const recalculateAndSave = (nextUtila: string, nextBalcoane: string, nextTerase: string) => {
    const uVal = parseFloat(nextUtila) || 0;
    const bVal = parseFloat(nextBalcoane) || 0;
    const tVal = parseFloat(nextTerase) || 0;

    const normCat = (categoria || "").toLowerCase();
    const isApartmentOrVilla = normCat.includes("apartament") || normCat.includes("casa") || normCat.includes("vila") || normCat.includes("vile");
    const multiplier = isApartmentOrVilla ? 1.2 : 1.1;

    const calculatedConstruita = uVal > 0 ? (uVal * multiplier).toFixed(2) : "";
    const calculatedUtilaTotala = (uVal > 0 || bVal > 0 || tVal > 0) ? (uVal + bVal + tVal).toFixed(2) : "";

    setConstruita(calculatedConstruita);
    setUtilaTotala(calculatedUtilaTotala);

    onUpdate?.('crmData.caracteristici.suprafete.construita', calculatedConstruita);
    onUpdate?.('crmData.caracteristici.suprafete.utilaTotala', calculatedUtilaTotala);
  };

  const handleUtilaChange = (val: string) => {
    setUtila(val);
    onUpdate?.('crmData.caracteristici.suprafete.utila', val);
    recalculateAndSave(val, balcoane, terase);
  };

  const handleBalcoaneChange = (val: string) => {
    setBalcoane(val);
    onUpdate?.('crmData.caracteristici.suprafete.balcoane', val);
    recalculateAndSave(utila, val, terase);
  };

  const handleTeraseChange = (val: string) => {
    setTerase(val);
    onUpdate?.('crmData.caracteristici.suprafete.terase', val);
    recalculateAndSave(utila, balcoane, val);
  };

  if (isSpatiuComercial) {
    return (
      <div className="space-y-4">
        {/* DETALII SECTION */}
        <div className="space-y-4">
          <SectionHeader>Detalii</SectionHeader>
          <FormGrid cols={5}>
            <div><FormLabel>Încăperi</FormLabel><FormInput value={safeData.detalii?.camere} onChange={(val) => onUpdate?.('crmData.caracteristici.detalii.camere', val)} /></div>
            <div><FormLabel>Compartimentare</FormLabel><FormSelect value={safeData.detalii?.compartimentare} options={COMPARTIMENTARE_OPTIONS} onChange={(val) => onUpdate?.('crmData.caracteristici.detalii.compartimentare', val)} /></div>
            <div><FormLabel>Etaj</FormLabel><FormSelect value={safeData.detalii?.etaj} options={ETAJ_OPTIONS} onChange={(val) => onUpdate?.('crmData.caracteristici.detalii.etaj', val)} /></div>
            <div><FormLabel>Băi</FormLabel><FormInput value={safeData.detalii?.bai} onChange={(val) => onUpdate?.('crmData.caracteristici.detalii.bai', val)} /></div>
            <div><FormLabel>Terase</FormLabel><FormInput value={safeData.detalii?.terase} onChange={(val) => onUpdate?.('crmData.caracteristici.detalii.terase', val)} /></div>
          </FormGrid>
          <FormGrid cols={6}>
            <div><FormLabel>Parcări</FormLabel><FormInput value={safeData.detalii?.parcari} onChange={(val) => onUpdate?.('crmData.caracteristici.detalii.parcari', val)} /></div>
            <div><FormLabel>Garaje</FormLabel><FormInput value={safeData.detalii?.garaje} onChange={(val) => onUpdate?.('crmData.caracteristici.detalii.garaje', val)} /></div>
            <div className="col-span-2 pt-8">
               <FormCheckbox 
                label="Cheia in agentie" 
                checked={isChecked(safeData.detalii?.checkList, 'Cheia in agentie')} 
                onChange={(val) => {
                  const next = toggleInList(safeData.detalii?.checkList, 'Cheia in agentie', val);
                  onUpdate?.('crmData.caracteristici.detalii.checkList', next);
                }}
              />
            </div>
          </FormGrid>
        </div>

        <FormDivider />

        {/* SUPRAFETE SECTION */}
        <div className="space-y-4">
          <SectionHeader>Suprafețe</SectionHeader>
          <FormGrid cols={6}>
            <div><FormLabel>Utilă</FormLabel><FormInput value={utila} unit="m2" onChange={handleUtilaChange} /></div>
            <div><FormLabel>Construită</FormLabel><FormInput value={construita} unit="m2" onChange={(val) => { setConstruita(val); onUpdate?.('crmData.caracteristici.suprafete.construita', val); }} /></div>
            <div><FormLabel>Utilă Totală</FormLabel><FormInput value={utilaTotala} unit="m2" onChange={(val) => { setUtilaTotala(val); onUpdate?.('crmData.caracteristici.suprafete.utilaTotala', val); }} /></div>
            <div><FormLabel>Curte</FormLabel><FormInput value={safeData.suprafete?.gradina} unit="m2" onChange={(val) => onUpdate?.('crmData.caracteristici.suprafete.gradina', val)} /></div>
            <div><FormLabel>Vitrină</FormLabel><FormInput value={safeData.suprafete?.vitrina} unit="m" onChange={(val) => onUpdate?.('crmData.caracteristici.suprafete.vitrina', val)} /></div>
            <div><FormLabel>Front Stradal</FormLabel><FormInput value={safeData.suprafete?.frontStradal} unit="m" onChange={(val) => onUpdate?.('crmData.caracteristici.suprafete.frontStradal', val)} /></div>
          </FormGrid>
        </div>

        <FormDivider />

        {/* CLADIRE SECTION */}
        <div className="space-y-4">
          <SectionHeader>Clădire</SectionHeader>
          <FormGrid cols={6}>
            <div><FormLabel>Stadiu Construcție</FormLabel><FormSelect value={safeData.alteDetalii?.stadiuConstructie || "Finalizata"} options={STADIU_CONSTRUCTIE_OPTIONS} onChange={(val) => onUpdate?.('crmData.caracteristici.alteDetalii.stadiuConstructie', val)} /></div>
            <div><FormLabel>Tip</FormLabel><FormSelect value={safeData.alteDetalii?.tipImobil} options={TIP_SPATIU_COMERCIAL_OPTIONS} onChange={(val) => onUpdate?.('crmData.caracteristici.alteDetalii.tipImobil', val)} /></div>
            <div><FormLabel>Structură</FormLabel><FormSelect value={safeData.alteDetalii?.structura} options={STRUCTURA_OPTIONS} onChange={(val) => onUpdate?.('crmData.caracteristici.alteDetalii.structura', val)} /></div>
            <div><FormLabel>Risc Seismic</FormLabel><FormSelect value={safeData.alteDetalii?.riscSeismic || "-"} options={RISC_SEISMIC_OPTIONS} onChange={(val) => onUpdate?.('crmData.caracteristici.alteDetalii.riscSeismic', val)} /></div>
            <div><FormLabel>An Construcție</FormLabel><FormInput value={safeData.alteDetalii?.anConstructie} onChange={(val) => onUpdate?.('crmData.caracteristici.alteDetalii.anConstructie', val)} /></div>
            <div><FormLabel>Anul Renovării</FormLabel><FormInput value={safeData.alteDetalii?.anRenovare} onChange={(val) => onUpdate?.('crmData.caracteristici.alteDetalii.anRenovare', val)} /></div>
          </FormGrid>

          <div className="mt-4">
            <FormLabel>Înălțime</FormLabel>
            <div className="flex flex-wrap items-center gap-4 mt-4">
              <div className="flex items-center gap-2">
                <FormCheckbox 
                  label="S +" 
                  checked={isChecked(safeData.detalii?.checkList, 'S +')} 
                  onChange={(val) => {
                    const next = toggleInList(safeData.detalii?.checkList, 'S +', val);
                    onUpdate?.('crmData.caracteristici.detalii.checkList', next);
                  }}
                />
              </div>
              <div className="flex items-center gap-2">
                <FormCheckbox 
                  label="D +" 
                  checked={isChecked(safeData.detalii?.checkList, 'D +')} 
                  onChange={(val) => {
                    const next = toggleInList(safeData.detalii?.checkList, 'D +', val);
                    onUpdate?.('crmData.caracteristici.detalii.checkList', next);
                  }}
                />
              </div>
              <div className="flex items-center gap-2">
                <FormCheckbox 
                  label="P +" 
                  checked={isChecked(safeData.detalii?.checkList, 'P +')} 
                  onChange={(val) => {
                    const next = toggleInList(safeData.detalii?.checkList, 'P +', val);
                    onUpdate?.('crmData.caracteristici.detalii.checkList', next);
                  }}
                />
              </div>
              <div className="flex items-center gap-3">
                <div className="w-16"><FormInput value={safeData.alteDetalii?.niveluriConstructie?.split('+')?.[1]?.trim() || ""} onChange={(val) => onUpdate?.('crmData.caracteristici.alteDetalii.niveluriConstructie', val)} /></div>
                <span className="text-[13px] text-[#6a7282] font-normal">Etaje +</span>
              </div>
              <div className="flex items-center gap-2">
                <FormCheckbox 
                  label="M" 
                  checked={isChecked(safeData.detalii?.checkList, 'M')} 
                  onChange={(val) => {
                    const next = toggleInList(safeData.detalii?.checkList, 'M', val);
                    onUpdate?.('crmData.caracteristici.detalii.checkList', next);
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Default Apartment View
  return (
    <div className="space-y-4">
      <SectionHeader>Detalii</SectionHeader>
      <FormGrid cols={4}>
        <div><FormLabel>Tip Apartament</FormLabel><FormSelect value={safeData.detalii?.tipApartament} options={TIP_APARTAMENT_OPTIONS} onChange={(val) => onUpdate?.('crmData.caracteristici.detalii.tipApartament', val)} /></div>
        <div><FormLabel>Compartimentare</FormLabel><FormSelect value={safeData.detalii?.compartimentare} options={COMPARTIMENTARE_OPTIONS} onChange={(val) => onUpdate?.('crmData.caracteristici.detalii.compartimentare', val)} /></div>
        <div><FormLabel>Confort</FormLabel><FormSelect value={safeData.detalii?.confort} options={CONFORT_OPTIONS} onChange={(val) => onUpdate?.('crmData.caracteristici.detalii.confort', val)} /></div>
        <div><FormLabel>Destinație</FormLabel><FormSelect value={safeData.detalii?.destinatie} options={DESTINATIE_OPTIONS} onChange={(val) => onUpdate?.('crmData.caracteristici.detalii.destinatie', val)} /></div>
      </FormGrid>
      <FormGrid cols={6}>
        <div><FormLabel>Camere</FormLabel><FormInput value={safeData.detalii?.camere} onChange={(val) => onUpdate?.('crmData.caracteristici.detalii.camere', val)} /></div>
        <div><FormLabel>Dormitoare</FormLabel><FormInput value={safeData.detalii?.dormitoare} onChange={(val) => onUpdate?.('crmData.caracteristici.detalii.dormitoare', val)} /></div>
        <div><FormLabel>Bucătării</FormLabel><FormInput value={safeData.detalii?.bucatarii} onChange={(val) => onUpdate?.('crmData.caracteristici.detalii.bucatarii', val)} /></div>
        <div><FormLabel>Băi</FormLabel><FormInput value={safeData.detalii?.bai} onChange={(val) => onUpdate?.('crmData.caracteristici.detalii.bai', val)} /></div>
        <div><FormLabel>Balcoane</FormLabel><FormInput value={safeData.detalii?.balcoane} onChange={(val) => onUpdate?.('crmData.caracteristici.detalii.balcoane', val)} /></div>
        <div><FormLabel>Terase</FormLabel><FormInput value={safeData.detalii?.terase} onChange={(val) => onUpdate?.('crmData.caracteristici.detalii.terase', val)} /></div>
      </FormGrid>
      <FormGrid cols={6}>
        <div><FormLabel>Etaj</FormLabel><FormSelect value={safeData.detalii?.etaj} options={ETAJ_OPTIONS} onChange={(val) => onUpdate?.('crmData.caracteristici.detalii.etaj', val)} /></div>
        <div><FormLabel>Orientare</FormLabel><FormSelect value={safeData.detalii?.orientare} options={ORIENTARE_OPTIONS} onChange={(val) => onUpdate?.('crmData.caracteristici.detalii.orientare', val)} /></div>
        <div><FormLabel>An Construcție</FormLabel><FormInput value={safeData.alteDetalii?.anConstructie} onChange={(val) => onUpdate?.('crmData.caracteristici.alteDetalii.anConstructie', val)} /></div>
        <div><FormLabel>Anul Renovării</FormLabel><FormInput value={safeData.alteDetalii?.anRenovare} onChange={(val) => onUpdate?.('crmData.caracteristici.alteDetalii.anRenovare', val)} /></div>
        <div><FormLabel>Parcări</FormLabel><FormInput value={safeData.detalii?.parcari} onChange={(val) => onUpdate?.('crmData.caracteristici.detalii.parcari', val)} /></div>
        <div><FormLabel>Garaje</FormLabel><FormInput value={safeData.detalii?.garaje} onChange={(val) => onUpdate?.('crmData.caracteristici.detalii.garaje', val)} /></div>
      </FormGrid>
      <div className="flex flex-wrap gap-4 py-2">
        {['Geam la baie', 'Bucatarie deschisa', 'Pet friendly', 'Cheia in agentie'].map(label => (
          <FormCheckbox 
            key={label} 
            label={label} 
            checked={isChecked(safeData.detalii?.checkList, label)} 
            onChange={(val) => {
              const next = toggleInList(safeData.detalii?.checkList, label, val);
              onUpdate?.('crmData.caracteristici.detalii.checkList', next);
            }}
          />
        ))}
      </div>
      <FormDivider />
      <SectionHeader>Suprafețe</SectionHeader>
      <FormGrid cols={6}>
        <div><FormLabel>Utilă</FormLabel><FormInput value={utila} unit="m2" onChange={handleUtilaChange} /></div>
        <div><FormLabel>Construită</FormLabel><FormInput value={construita} unit="m2" onChange={(val) => { setConstruita(val); onUpdate?.('crmData.caracteristici.suprafete.construita', val); }} /></div>
        <div><FormLabel>Utilă Totală</FormLabel><FormInput value={utilaTotala} unit="m2" onChange={(val) => { setUtilaTotala(val); onUpdate?.('crmData.caracteristici.suprafete.utilaTotala', val); }} /></div>
        <div><FormLabel>Balcoane</FormLabel><FormInput value={balcoane} unit="m2" onChange={handleBalcoaneChange} /></div>
        <div><FormLabel>Terase</FormLabel><FormInput value={terase} unit="m2" onChange={handleTeraseChange} /></div>
        <div><FormLabel>Suprafață Grădină</FormLabel><FormInput value={safeData.suprafete?.gradina} unit="m2" onChange={(val) => onUpdate?.('crmData.caracteristici.suprafete.gradina', val)} /></div>
      </FormGrid>
      <FormGrid cols={3}>
         <div><FormLabel>Teren Liber</FormLabel><FormInput value={safeData.suprafete?.terenLiber} unit="m" onChange={(val) => onUpdate?.('crmData.caracteristici.suprafete.terenLiber', val)} /></div>
         <div><FormLabel>Front Stradal</FormLabel><FormInput value={safeData.suprafete?.frontStradal} unit="m" onChange={(val) => onUpdate?.('crmData.caracteristici.suprafete.frontStradal', val)} /></div>
         <div><FormLabel>Nr. Terase</FormLabel><FormInput value={safeData.suprafete?.numarTerase} onChange={(val) => onUpdate?.('crmData.caracteristici.suprafete.numarTerase', val)} /></div>
      </FormGrid>
      <FormGrid cols={3}>
         <div><FormLabel>Nr. Balcoane</FormLabel><FormInput value={safeData.suprafete?.numarBalcoane} onChange={(val) => onUpdate?.('crmData.caracteristici.suprafete.numarBalcoane', val)} /></div>
         <div><FormLabel>Numar Fronturi</FormLabel><FormInput value={safeData.suprafete?.numarFronturi} onChange={(val) => onUpdate?.('crmData.caracteristici.suprafete.numarFronturi', val)} /></div>
      </FormGrid>
      <FormDivider />
      <SectionHeader>Clădire</SectionHeader>
      <div className="space-y-4 mb-4">
        <FormGrid cols={4}>
          <div><FormLabel>Stadiu Construcție</FormLabel><FormSelect value={safeData.alteDetalii?.stadiuConstructie || "Finalizata"} options={STADIU_CONSTRUCTIE_OPTIONS} onChange={(val) => onUpdate?.('crmData.caracteristici.alteDetalii.stadiuConstructie', val)} /></div>
          <div><FormLabel>Tip</FormLabel><FormSelect value={safeData.alteDetalii?.tipImobil || "Bloc Mixt"} options={TIP_IMOBIL_OPTIONS} onChange={(val) => onUpdate?.('crmData.caracteristici.alteDetalii.tipImobil', val)} /></div>
          <div><FormLabel>Structură</FormLabel><FormSelect value={safeData.alteDetalii?.structura} options={STRUCTURA_OPTIONS} onChange={(val) => onUpdate?.('crmData.caracteristici.alteDetalii.structura', val)} /></div>
          <div><FormLabel>Risc Seismic</FormLabel><FormSelect value={safeData.alteDetalii?.riscSeismic || ""} options={RISC_SEISMIC_OPTIONS} onChange={(val) => onUpdate?.('crmData.caracteristici.alteDetalii.riscSeismic', val)} /></div>
        </FormGrid>

        <div className="mt-4">
          <FormLabel>Înălțime</FormLabel>
          <div className="flex flex-wrap items-center gap-4 mt-4">
            <div className="flex items-center gap-2">
              <FormCheckbox 
                label="S +" 
                checked={isChecked(safeData.detalii?.checkList, 'S +')} 
                onChange={(val) => {
                  const next = toggleInList(safeData.detalii?.checkList, 'S +', val);
                  onUpdate?.('crmData.caracteristici.detalii.checkList', next);
                }}
              />
            </div>
            <div className="flex items-center gap-2">
              <FormCheckbox 
                label="D +" 
                checked={isChecked(safeData.detalii?.checkList, 'D +')} 
                onChange={(val) => {
                  const next = toggleInList(safeData.detalii?.checkList, 'D +', val);
                  onUpdate?.('crmData.caracteristici.detalii.checkList', next);
                }}
              />
            </div>
            <div className="flex items-center gap-2">
              <FormCheckbox 
                label="P +" 
                checked={isChecked(safeData.detalii?.checkList, 'P +')} 
                onChange={(val) => {
                  const next = toggleInList(safeData.detalii?.checkList, 'P +', val);
                  onUpdate?.('crmData.caracteristici.detalii.checkList', next);
                }}
              />
            </div>
            <div className="flex items-center gap-3">
              <div className="w-16"><FormInput value={safeData.alteDetalii?.niveluriConstructie?.split('+')?.[1]?.trim() || safeData.alteDetalii?.niveluriConstructie || ""} onChange={(val) => onUpdate?.('crmData.caracteristici.alteDetalii.niveluriConstructie', val)} /></div>
              <span className="text-[13px] text-[#6a7282] font-normal">Etaje +</span>
            </div>
          </div>
        </div>
      </div>
      <FormDivider />
      <SectionHeader>Performanță Energetică</SectionHeader>
      <FormGrid cols={4}>
         <div><FormLabel>Clasǎ Energetică</FormLabel><FormSelect value={safeData.energetica?.clasa || ""} options={CLASA_ENERGETICA_OPTIONS} onChange={(val) => onUpdate?.('crmData.caracteristici.energetica.clasa', val)} /></div>
      </FormGrid>
      <FormGrid cols={3} className="mt-4">
         <div><FormLabel>Consum Anual Specific</FormLabel><FormInput value={safeData.energetica?.consumAnual} unit="kWh/m2an" onChange={(val) => onUpdate?.('crmData.caracteristici.energetica.consumAnual', val)} /></div>
         <div><FormLabel>Indice de Emisii Echivalent CO2</FormLabel><FormInput value={safeData.energetica?.emisiiCO2} unit="kgco2/m2an" onChange={(val) => onUpdate?.('crmData.caracteristici.energetica.emisiiCO2', val)} /></div>
         <div><FormLabel>Consum Specific din Surse Regenerabile</FormLabel><FormInput value={safeData.energetica?.consumRegenerabile} unit="kWh/m2an" onChange={(val) => onUpdate?.('crmData.caracteristici.energetica.consumRegenerabile', val)} /></div>
      </FormGrid>
    </div>
  );
};

export const UtilitatiSection = ({ data, onUpdate, categoria }: { data: any, onUpdate?: (path: string, val: any) => void, categoria?: string }) => {
  const safeData = data || { general: [], sistemIncalzire: [], climatizare: [], finisaje: {}, dotari: {}, aditionale: {} };
  const normalizedCategoria = normalizeForMatch(categoria || "");
  const isSpatiuComercial = normalizedCategoria.includes("comercial") || 
                           normalizedCategoria.includes("industrial") || 
                           normalizedCategoria.includes("depozitare") || 
                           normalizedCategoria.includes("hale") ||
                           normalizedCategoria.includes("birou");
  
  const isBirou = normalizedCategoria.includes("birou");

  if (isSpatiuComercial) {
    return (
      <div className="space-y-4">
        <SectionHeader>Utilități</SectionHeader>
        <FormGrid cols={3}>
           <div className="space-y-2">
              <FormLabel>General</FormLabel>
              {[
                'Curent electric', 'Apa', 'Canalizare', 'Gaz', 'Put', 'Fosa septica', 
                'Curent trifazic', 'CATV', 'Telefon', 
                'Utilitati in zona', 'Sistem irigatie'
              ].map(l => (
                <FormCheckbox 
                  key={l} 
                  label={l} 
                  checked={isChecked(safeData.general, l)} 
                  onChange={(val) => {
                    const next = toggleInList(safeData.general, l, val);
                    onUpdate?.('crmData.utilitati.general', next);
                  }}
                />
              ))}
           </div>
           <div className="space-y-2">
              <FormLabel>Sistem Încălzire</FormLabel>
              {[
                'Termoficare', 'Centrala proprie', 'Centrala imobil', 'Convectoare', 
                'Soba teracota', 'Centrala pe lemne', 'Incalzire pardoseala', 
                'Calorifere', 'Semineu', 'Pompa de caldura'
              ].map(l => (
                <FormCheckbox 
                  key={l} 
                  label={l} 
                  checked={isChecked(safeData.sistemIncalzire, l)} 
                  onChange={(val) => {
                    const next = toggleInList(safeData.sistemIncalzire, l, val);
                    onUpdate?.('crmData.utilitati.sistemIncalzire', next);
                  }}
                />
              ))}
           </div>
           <div className="space-y-2">
              <FormLabel>Climatizare</FormLabel>
              {[
                'Aer conditionat', 'Ventiloconvectoare', 'Sistem climatizare in 2 tevi', 
                'Sistem de climatizare in 4 tevi', 'Control individual AC', 
                'Aport de aer proaspat', 'Centrala de tratare a aerului'
              ].map(l => (
                <FormCheckbox 
                  key={l} 
                  label={l} 
                  checked={isChecked(safeData.climatizare, l)} 
                  onChange={(val) => {
                    const next = toggleInList(safeData.climatizare, l, val);
                    onUpdate?.('crmData.utilitati.climatizare', next);
                  }}
                />
              ))}
           </div>
        </FormGrid>

        <FormDivider />

        <SectionHeader>Finisaje</SectionHeader>
        <FormGrid cols={4}>
            <div className="space-y-2">
              <FormLabel>Stare</FormLabel>
              {['Finisat', 'Semifinisat', 'Ultrafinisat', 'Buna', 'Necesita renovare', 'Renovat'].map(l => (
                <FormRadio 
                  key={l}
                  label={l}
                  checked={normalizeForMatch(safeData.finisaje?.stare || '').includes(normalizeForMatch(l))}
                  onChange={(val) => {
                    const next = val ? l : "";
                    onUpdate?.('crmData.utilitati.finisaje.stare', next);
                  }}
                />
              ))}
           </div>
           <div className="space-y-2">
              <FormLabel>Izolații</FormLabel>
              {['Exterior', 'Interior', 'Bloc izolat termic'].map(l => (
                <FormCheckbox 
                  key={l} 
                  label={l} 
                  checked={isChecked(safeData.finisaje?.izolatii, l)} 
                  onChange={(val) => {
                    const next = toggleInList(safeData.finisaje?.izolatii, l, val);
                    onUpdate?.('crmData.utilitati.finisaje.izolatii', next);
                  }}
                />
              ))}
           </div>
           <div className="space-y-2">
              <FormLabel>Pereți</FormLabel>
              {['Vopsea lavabila', 'Var', 'Faianta', 'Lambriu', 'Tapet', 'Marmura', 'Huma', 'Vinarom', 'Stucco veneziano'].map(l => (
                <FormCheckbox 
                  key={l} 
                  label={l} 
                  checked={isChecked(safeData.finisaje?.pereti, l)} 
                  onChange={(val) => {
                    const next = toggleInList(safeData.finisaje?.pereti, l, val);
                    onUpdate?.('crmData.utilitati.finisaje.pereti', next);
                  }}
                />
              ))}
           </div>
           <div className="space-y-2">
              <FormLabel>Podele</FormLabel>
              {['Parchet', 'Gresie', 'Marmura', 'Mocheta', 'Dusumea', 'Linoleum', 'Nefinisat', 'Pardoseala flotanta'].map(l => (
                <FormCheckbox 
                  key={l} 
                  label={l} 
                  checked={isChecked(safeData.finisaje?.podele, l)} 
                  onChange={(val) => {
                    const next = toggleInList(safeData.finisaje?.podele, l, val);
                    onUpdate?.('crmData.utilitati.finisaje.podele', next);
                  }}
                />
              ))}
           </div>
        </FormGrid>

        <FormGrid cols={4} className="mt-4">
            <div className="space-y-2">
              <FormLabel>Ferestre</FormLabel>
              {['PVC', 'Lemn', 'Aluminiu', 'Termopan'].map(l => (
                <FormCheckbox 
                  key={l} 
                  label={l} 
                  checked={isChecked(safeData.finisaje?.ferestre, l)} 
                  onChange={(val) => {
                    const next = toggleInList(safeData.finisaje?.ferestre, l, val);
                    onUpdate?.('crmData.utilitati.finisaje.ferestre', next);
                  }}
                />
              ))}
           </div>
           <div className="col-span-2 space-y-2">
              <FormLabel>Iluminat</FormLabel>
              {['Lampi', 'Spoturi', 'Aplice', 'Exterior cladire', 'Lumina naturala', 'Iluminat interior sistem LED', 'Iluminat interior fluorescent'].map(l => (
                <FormCheckbox 
                  key={l} 
                  label={l} 
                  checked={isChecked(safeData.finisaje?.iluminat, l)} 
                  onChange={(val) => {
                    const next = toggleInList(safeData.finisaje?.iluminat, l, val);
                    onUpdate?.('crmData.utilitati.finisaje.iluminat', next);
                  }}
                />
              ))}
           </div>
        </FormGrid>

        {isBirou && (
          <>
            <FormDivider />
            <SectionHeader>Dotări</SectionHeader>
            <FormGrid cols={4}>
              <div className="space-y-2">
                <FormLabel>Mobilat</FormLabel>
                {['Complet', 'Partial', 'Nemobilat', 'Lux', 'Modern'].map(l => (
                  <FormRadio 
                    key={l}
                    label={l}
                    checked={normalizeForMatch(safeData.dotari?.mobilat || '').includes(normalizeForMatch(l))}
                    onChange={(val) => {
                      const next = val ? l : "";
                      onUpdate?.('crmData.utilitati.dotari.mobilat', next);
                    }}
                  />
                ))}
              </div>
              <div className="space-y-2">
                <FormLabel>Contorizare</FormLabel>
                {['Apometre', 'Contor caldura', 'Contor gaz', 'Contor curent electric', 'Contorizare separata'].map(l => (
                  <FormCheckbox 
                    key={l} 
                    label={l} 
                    checked={isChecked(safeData.dotari?.contorizare, l)} 
                    onChange={(val) => {
                      const next = toggleInList(safeData.dotari?.contorizare, l, val);
                      onUpdate?.('crmData.utilitati.dotari.contorizare', next);
                    }}
                  />
                ))}
              </div>
              <div className="space-y-2">
                <FormLabel>Imobil</FormLabel>
                {[
                  'Interfon', 'Videointerfon', 'Supraveghere video', 'Lift', 
                  'Lift cu destinatie programata', 'Receptie', 'Curte', 'Curte comuna', 
                  'Fatada tip Cortina de sticla', 'Fatada ventilata', 'BMS', 
                  'Acces securizat parcare', 'Semaforizare parcare', 'Statii incarcare auto electrice', 
                  'Acces pentru persoane cu disabilitati', 'Sprinklere', 'Hidranti interior', 
                  'Hidranti exterior', 'Detectoare fum/temperatura', 'Sistem detectie incendiu'
                ].map(l => (
                  <FormCheckbox 
                    key={l} 
                    label={l} 
                    checked={isChecked(safeData.dotari?.imobil, l)} 
                    onChange={(val) => {
                      const next = toggleInList(safeData.dotari?.imobil, l, val);
                      onUpdate?.('crmData.utilitati.dotari.imobil', next);
                    }}
                  />
                ))}
              </div>
              <div className="space-y-2">
                <FormLabel>Spații</FormLabel>
                {[
                  'Pivnita', 'Crama', 'Spatiu depozitare', 'Anexe', 'Dependinte', 
                  'Parcare proprie', 'Parcare acoperita', 'Spatiu verde amenajat'
                ].map(l => (
                  <FormCheckbox 
                    key={l} 
                    label={l} 
                    checked={isChecked(safeData.dotari?.spatii, l)} 
                    onChange={(val) => {
                      const next = toggleInList(safeData.dotari?.spatii, l, val);
                      onUpdate?.('crmData.utilitati.dotari.spatii', next);
                    }}
                  />
                ))}
              </div>
            </FormGrid>

            <FormDivider />
            <SectionHeader>Adiționale</SectionHeader>
            <FormGrid cols={4}>
              <div className="space-y-2">
                <FormLabel>Sistem Electric</FormLabel>
                {['Control electric individual', 'Generator', 'Sursa UPS'].map(l => (
                  <FormCheckbox 
                    key={l} 
                    label={l} 
                    checked={isChecked(safeData.aditionale?.sistemElectric, l)} 
                    onChange={(val) => {
                      const next = toggleInList(safeData.aditionale?.sistemElectric, l, val);
                      onUpdate?.('crmData.utilitati.aditionale.sistemElectric', next);
                    }}
                  />
                ))}
              </div>
              <div className="col-span-2 space-y-2">
                <FormLabel>Servicii</FormLabel>
                {[
                  'Administrare', 'Curatenie', 'Paza', 'Supraveghere video', 
                  'Ingrijire spatii verzi', 'Curatenie parcare'
                ].map(l => (
                  <FormCheckbox 
                    key={l} 
                    label={l} 
                    checked={isChecked(safeData.aditionale?.servicii, l)} 
                    onChange={(val) => {
                      const next = toggleInList(safeData.aditionale?.servicii, l, val);
                      onUpdate?.('crmData.utilitati.aditionale.servicii', next);
                    }}
                  />
                ))}
              </div>
            </FormGrid>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SectionHeader>Utilități</SectionHeader>
      <FormGrid cols={3}>
          <div className="space-y-2">
            <FormLabel>General</FormLabel>
            {['Curent electric', 'Apa', 'Canalizare', 'Gaz', 'Put', 'Fosa septica', 'Curent trifazic', 'CATV', 'Telefon'].map(l => (
              <FormCheckbox 
                key={l} 
                label={l} 
                checked={isChecked(safeData.general, l)} 
                onChange={(val) => {
                  const next = toggleInList(safeData.general, l, val);
                  onUpdate?.('crmData.utilitati.general', next);
                }}
              />
            ))}
         </div>
         <div className="space-y-2">
            <FormLabel>Sistem Încălzire</FormLabel>
            {['Termoficare', 'Centrala proprie', 'Centrala imobil', 'Convectoare', 'Soba teracota', 'Centrala pe lemne', 'Incalzire pardoseala', 'Calorifere', 'Semineu', 'Pompa de caldura'].map(l => (
              <FormCheckbox 
                key={l} 
                label={l} 
                checked={isChecked(safeData.sistemIncalzire, l)} 
                onChange={(val) => {
                  const next = toggleInList(safeData.sistemIncalzire, l, val);
                  onUpdate?.('crmData.utilitati.sistemIncalzire', next);
                }}
              />
            ))}
         </div>
         <div className="space-y-2">
            <FormLabel>Climatizare</FormLabel>
            {['Aer conditionat', 'Ventiloconvectoare', 'Aeroterme'].map(l => (
              <FormCheckbox 
                key={l} 
                label={l} 
                checked={isChecked(safeData.climatizare, l)} 
                onChange={(val) => {
                  const next = toggleInList(safeData.climatizare, l, val);
                  onUpdate?.('crmData.utilitati.climatizare', next);
                }}
              />
            ))}
         </div>
      </FormGrid>
      <FormDivider />
      <SectionHeader>Finisaje</SectionHeader>
      <FormGrid cols={4}>
          <div className="space-y-2">
            <FormLabel>Stare</FormLabel>
            {['Finisat', 'Semifinisat', 'Ultrafinisat', 'Buna', 'Necesita renovare', 'Renovat'].map(l => (
              <FormCheckbox 
                key={l} 
                label={l} 
                checked={isChecked(safeData.finisaje?.stare, l)} 
                onChange={(val) => {
                  const next = toggleInList(safeData.finisaje?.stare, l, val);
                  onUpdate?.('crmData.utilitati.finisaje.stare', next);
                }}
              />
            ))}
         </div>
         <div className="space-y-2">
            <FormLabel>Izolații</FormLabel>
            {['Exterior', 'Interior', 'Bloc izolat termic'].map(l => (
              <FormCheckbox 
                key={l} 
                label={l} 
                checked={isChecked(safeData.finisaje?.izolatii, l)} 
                onChange={(val) => {
                  const next = toggleInList(safeData.finisaje?.izolatii, l, val);
                  onUpdate?.('crmData.utilitati.finisaje.izolatii', next);
                }}
              />
            ))}
         </div>
         <div className="space-y-2">
            <FormLabel>Pereți</FormLabel>
            {['Vopsea lavabila', 'Var', 'Faianta', 'Lambriu', 'Tapet', 'Marmura', 'Huma', 'Vinarom', 'Stucco veneziano'].map(l => (
              <FormCheckbox 
                key={l} 
                label={l} 
                checked={isChecked(safeData.finisaje?.pereti, l)} 
                onChange={(val) => {
                  const next = toggleInList(safeData.finisaje?.pereti, l, val);
                  onUpdate?.('crmData.utilitati.finisaje.pereti', next);
                }}
              />
            ))}
         </div>
         <div className="space-y-2">
            <FormLabel>Podele</FormLabel>
            {['Parchet', 'Gresie', 'Marmura', 'Mocheta', 'Dusumea', 'Linoleum', 'Nefinisat', 'Pardoseala flotanta'].map(l => (
              <FormCheckbox 
                key={l} 
                label={l} 
                checked={isChecked(safeData.finisaje?.podele, l)} 
                onChange={(val) => {
                  const next = toggleInList(safeData.finisaje?.podele, l, val);
                  onUpdate?.('crmData.utilitati.finisaje.podele', next);
                }}
              />
            ))}
         </div>
      </FormGrid>

      <FormGrid cols={4} className="mt-4">
          <div className="space-y-2">
            <FormLabel>Ferestre</FormLabel>
            {['PVC', 'Lemn', 'Aluminiu', 'Termopan'].map(l => (
              <FormCheckbox 
                key={l} 
                label={l} 
                checked={isChecked(safeData.finisaje?.ferestre, l)} 
                onChange={(val) => {
                  const next = toggleInList(safeData.finisaje?.ferestre, l, val);
                  onUpdate?.('crmData.utilitati.finisaje.ferestre', next);
                }}
              />
            ))}
         </div>
         <div className="space-y-2">
            <FormLabel>Jaluzele</FormLabel>
            {['Verticale', 'Orizontale'].map(l => (
              <FormCheckbox 
                key={l} 
                label={l} 
                checked={isChecked(safeData.finisaje?.jaluzele, l)} 
                onChange={(val) => {
                  const next = toggleInList(safeData.finisaje?.jaluzele, l, val);
                  onUpdate?.('crmData.utilitati.finisaje.jaluzele', next);
                }}
              />
            ))}
         </div>
         <div className="space-y-2">
            <FormLabel>Rulouri</FormLabel>
            {['Aluminiu', 'Lemn', 'PVC'].map(l => (
              <FormCheckbox 
                key={l} 
                label={l} 
                checked={isChecked(safeData.finisaje?.rulouri, l)} 
                onChange={(val) => {
                  const next = toggleInList(safeData.finisaje?.rulouri, l, val);
                  onUpdate?.('crmData.utilitati.finisaje.rulouri', next);
                }}
              />
            ))}
         </div>
         <div className="space-y-2">
            <FormLabel>Ușă Intrare</FormLabel>
            {['Metal', 'Lemn', 'PVC', 'Pal'].map(l => (
              <FormCheckbox 
                key={l} 
                label={l} 
                checked={isChecked(safeData.finisaje?.usaIntrare, l)} 
                onChange={(val) => {
                  const next = toggleInList(safeData.finisaje?.usaIntrare, l, val);
                  onUpdate?.('crmData.utilitati.finisaje.usaIntrare', next);
                }}
              />
            ))}
         </div>
      </FormGrid>

      <FormGrid cols={4} className="mt-4">
         <div className="space-y-2">
            <FormLabel>Uși Interior</FormLabel>
            {['Celulare', 'Lemn', 'Panel', 'PVC', 'Sticla', 'Metal'].map(l => (
              <FormCheckbox 
                key={l} 
                label={l} 
                checked={isChecked(safeData.finisaje?.usiInterior, l)} 
                onChange={(val) => {
                  const next = toggleInList(safeData.finisaje?.usiInterior, l, val);
                  onUpdate?.('crmData.utilitati.finisaje.usiInterior', next);
                }}
              />
            ))}
         </div>
      </FormGrid>
      <FormDivider />
      <SectionHeader>Dotări</SectionHeader>
      <FormGrid cols={4}>
          <div className="space-y-2">
            <FormLabel>Mobilat</FormLabel>
            <div className="flex flex-col gap-1">
              {['Complet', 'Partial', 'Nemobilat', 'Lux', 'Modern'].map(l => (
                <FormRadio 
                  key={l}
                  label={l}
                  checked={normalizeForMatch(safeData.dotari?.mobilat || '').includes(normalizeForMatch(l))}
                  onChange={(val) => {
                    const next = val ? l : "";
                    onUpdate?.('crmData.utilitati.dotari.mobilat', next);
                  }}
                />
              ))}
            </div>
         </div>
         <div className="space-y-2">
            <FormLabel>Spații Adiționale</FormLabel>
            {['Terasa', 'Wc serviciu', 'Boxa la subsol', 'Debara', 'Pivnita', 'Dressing'].map(l => (
              <FormCheckbox 
                key={l} 
                label={l} 
                checked={isChecked(safeData.dotari?.spatiiAditionale, l)} 
                onChange={(val) => {
                  const next = toggleInList(safeData.dotari?.spatiiAditionale, l, val);
                  onUpdate?.('crmData.utilitati.dotari.spatiiAditionale', next);
                }}
              />
            ))}
         </div>
         <div className="space-y-2">
            <FormLabel>Bucătărie</FormLabel>
            {['Mobilata', 'Partial mobilata', 'Utilata', 'Partial utilata', 'Nemobilata', 'Neutilata'].map(l => (
              <FormCheckbox 
                key={l} 
                label={l} 
                checked={isChecked(safeData.dotari?.bucatarie, l)} 
                onChange={(val) => {
                  const next = toggleInList(safeData.dotari?.bucatarie, l, val);
                  onUpdate?.('crmData.utilitati.dotari.bucatarie', next);
                }}
              />
            ))}
         </div>
         <div className="space-y-2">
            <FormLabel>Contorizare</FormLabel>
            {['Apometre', 'Contor caldura', 'Contor gaz', 'Contor curent electric', 'Contorizare separata'].map(l => (
              <FormCheckbox 
                key={l} 
                label={l} 
                checked={isChecked(safeData.dotari?.contorizare, l)} 
                onChange={(val) => {
                  const next = toggleInList(safeData.dotari?.contorizare, l, val);
                  onUpdate?.('crmData.utilitati.dotari.contorizare', next);
                }}
              />
            ))}
         </div>
      </FormGrid>

      <FormGrid cols={4} className="mt-4">
          <div className="space-y-2">
            <FormLabel>Electrocasnice</FormLabel>
            {['Masina de spalat rufe', 'Frigider', 'Aragaz', 'Masina de spalat vase', 'TV', 'Cafetiera', 'Cuptor microunde', 'Hota', 'Plita electrica'].map(l => (
              <FormCheckbox 
                key={l} 
                label={l} 
                checked={isChecked(safeData.dotari?.electrocasnice, l)} 
                onChange={(val) => {
                  const next = toggleInList(safeData.dotari?.electrocasnice, l, val);
                  onUpdate?.('crmData.utilitati.dotari.electrocasnice', next);
                }}
              />
            ))}
         </div>
         <div className="space-y-2">
            <FormLabel>Imobil</FormLabel>
            {['Interfon', 'Videointerfon', 'Supraveghere video', 'Lift', 'Spatii agrement', 'Sauna', 'SPA', 'Acoperis', 'Curte', 'Curte comuna', 'Gradina', 'Piscina interioara', 'Piscina exterioara', 'Uscatorie', 'Receptie', 'Jacuzzi', 'Semineu', 'Senzor de fum', 'Sistem de alarma', 'Telecomanda poarta acces auto'].map(l => (
              <FormCheckbox 
                key={l} 
                label={l} 
                checked={isChecked(safeData.dotari?.imobil, l)} 
                onChange={(val) => {
                  const next = toggleInList(safeData.dotari?.imobil, l, val);
                  onUpdate?.('crmData.utilitati.dotari.imobil', next);
                }}
              />
            ))}
         </div>
         <div className="space-y-2">
            <FormLabel>Amenajare Străzi</FormLabel>
            {['Asfaltate', 'Pietruite', 'Neamenajate', 'Betonate', 'Iluminat stradal', 'Mijloace de transport in comun', 'De pamant'].map(l => (
              <FormCheckbox 
                key={l} 
                label={l} 
                checked={isChecked(safeData.dotari?.amenajareStrazi, l)} 
                onChange={(val) => {
                  const next = toggleInList(safeData.dotari?.amenajareStrazi, l, val);
                  onUpdate?.('crmData.utilitati.dotari.amenajareStrazi', next);
                }}
              />
            ))}
         </div>
         <div className="space-y-2">
            <FormLabel>Priveliște</FormLabel>
            {['Panoramica', 'Spre lac', 'Spre mare', 'Spre munte', 'Spre oras', 'Spre padure'].map(l => (
              <FormCheckbox 
                key={l} 
                label={l} 
                checked={isChecked(safeData.dotari?.priveliste, l)} 
                onChange={(val) => {
                  const next = toggleInList(safeData.dotari?.priveliste, l, val);
                  onUpdate?.('crmData.utilitati.dotari.priveliste', next);
                }}
              />
            ))}
         </div>
      </FormGrid>
    </div>
  );
};

export const PretSection = ({ data, tranzactie, onUpdate }: { data: any, tranzactie?: string, onUpdate?: (path: string, val: any) => void }) => {
  const safeData = data || { detalii: {}, comisioane: {}, contract: {} };
  const isVanzare = String(tranzactie || "").toLowerCase().includes('vanzare');
  const [currentPret, setCurrentPret] = React.useState(safeData.detalii?.pret || "");
  
  React.useEffect(() => {
    setCurrentPret(safeData.detalii?.pret || "");
  }, [safeData.detalii?.pret]);

  const getHalfPrice = (pret: string) => {
    if (!pret) return "";
    const numericPrice = parseFloat(pret.replace(/[^0-9.]/g, ''));
    if (isNaN(numericPrice)) return "";
    return Math.round(numericPrice * 0.5).toString();
  };

  const calculatedCommission = !isVanzare ? getHalfPrice(currentPret) : "";

  return (
    <div className="space-y-4">
      <SectionHeader>Detalii Preț</SectionHeader>
      <div className="grid grid-cols-4 gap-4 items-start">
         <div>
           <FormLabel>Preț</FormLabel>
           <FormInput 
             value={currentPret} 
             onChange={(val) => {
               setCurrentPret(val);
               onUpdate?.('crmData.pret.detalii.pret', val);
             }} 
           />
         </div>
         <div>
           <FormLabel>Monedă</FormLabel>
           <div className="flex items-center gap-4">
             <div className="flex-1">
               <FormSelect value={safeData.detalii?.moneda} onChange={(val) => onUpdate?.('crmData.pret.detalii.moneda', val)} />
             </div>
             <div className="h-[48px] flex items-center shrink-0">
               <FormCheckbox 
                label="+ TVA" 
                checked={safeData.detalii?.tvaIncluded} 
                onChange={(val) => onUpdate?.('crmData.pret.detalii.tvaIncluded', val)}
               />
             </div>
           </div>
         </div>
         <div>
           <FormLabel>Preț/m²</FormLabel>
           <FormInput value={safeData.detalii?.pretMp} onChange={(val) => onUpdate?.('crmData.pret.detalii.pretMp', val)} />
         </div>
         <div>
           <FormLabel>Ultim Preț (Opțional)</FormLabel>
           <FormInput value={safeData.detalii?.ultimPret} onChange={(val) => onUpdate?.('crmData.pret.detalii.ultimPret', val)} />
         </div>
      </div>
  
      <div className="flex items-center gap-4">
         <div className="flex gap-4">
            {['Pret negociabil', 'Pret la cerere', 'Regim hotelier', 'Afiseaza pret/m²'].map(l => (
              <FormCheckbox 
                key={l} 
                label={l} 
                checked={isChecked(safeData.detalii?.checkList, l.replace('²', '2'))} 
                onChange={(val) => {
                  const next = toggleInList(safeData.detalii?.checkList, l.replace('²', '2'), val);
                  onUpdate?.('crmData.pret.detalii.checkList', next);
                }}
              />
            ))}
         </div>
         <div className="flex-1 flex justify-end">
            <button className="h-10 px-6 bg-white border border-[--color-border] rounded-full text-[12px] font-semibold text-[--color-text-main] hover:bg-gray-50 transition-colors shadow-none">
              Vezi istoric pret
            </button>
         </div>
      </div>
  
      <FormGrid cols={4}>
         <div><FormLabel>Avans</FormLabel><FormInput value={safeData.detalii?.avans || currentPret} onChange={(val) => onUpdate?.('crmData.pret.detalii.avans', val)} /></div>
         <div><FormLabel>Garanție</FormLabel><FormInput value={safeData.detalii?.garantie} onChange={(val) => onUpdate?.('crmData.pret.detalii.garantie', val)} /></div>
         <div><FormLabel>Plată Acceptată</FormLabel><FormSelect value={safeData.detalii?.plataAcceptata} onChange={(val) => onUpdate?.('crmData.pret.detalii.plataAcceptata', val)} /></div>
      </FormGrid>
  
      <FormGrid cols={4}>
         <div><FormLabel>Preț Garaj</FormLabel><FormInput value={safeData.detalii?.pretGaraj} onChange={(val) => onUpdate?.('crmData.pret.detalii.pretGaraj', val)} /></div>
         <div><FormLabel>Preț Parcare</FormLabel><FormInput value={safeData.detalii?.pretParcare} onChange={(val) => onUpdate?.('crmData.pret.detalii.pretParcare', val)} /></div>
      </FormGrid>
  
      <div>
         <FormLabel>Note Private Preț</FormLabel>
         <EditableTextArea 
            initialValue={safeData.detalii?.notePrivate || ""} 
            height="h-24" 
            onUpdate={(val) => onUpdate?.('crmData.pret.detalii.notePrivate', val)}
         />
      </div>
      
      <FormDivider />
      <SectionHeader>Comisioane</SectionHeader>
      <FormGrid cols={4}>
         <div>
           <FormLabel>{isVanzare ? "Comision Cumpărător (%)" : "Comision Chiriaș (%)"}</FormLabel>
           <FormInput value={safeData.comisioane?.comisionCumparatorProcent || "50%"} onChange={(val) => onUpdate?.('crmData.pret.comisioane.comisionCumparatorProcent', val)} />
         </div>
         <div>
           <FormLabel>{isVanzare ? "Valoare Comision Cumpărător" : "Valoare Comision Chiriaș"}</FormLabel>
           <FormInput value={!isVanzare ? (calculatedCommission || safeData.comisioane?.comisionCumparatorValoare) : safeData.comisioane?.comisionCumparatorValoare} onChange={(val) => onUpdate?.('crmData.pret.comisioane.comisionCumparatorValoare', val)} />
         </div>
         <div>
           <FormLabel>Comision Proprietar (%)</FormLabel>
           <FormInput value={safeData.comisioane?.comisionProprietarProcent || "50%"} onChange={(val) => onUpdate?.('crmData.pret.comisioane.comisionProprietarProcent', val)} />
         </div>
         <div>
           <FormLabel>Valoare Comision Proprietar</FormLabel>
           <FormInput value={!isVanzare ? (calculatedCommission || safeData.comisioane?.comisionProprietarValoare) : safeData.comisioane?.comisionProprietarValoare} onChange={(val) => onUpdate?.('crmData.pret.comisioane.comisionProprietarValoare', val)} />
         </div>
      </FormGrid>
      <div className="mb-4">
        <FormCheckbox 
          label="Colaborare" 
          checked={safeData.comisioane?.colaborare} 
          onChange={(val) => onUpdate?.('crmData.pret.comisioane.colaborare', val)}
        />
      </div>
      <FormDivider />
      <SectionHeader>Contract</SectionHeader>
      <FormGrid cols={3}>
         <div><FormLabel>Tip Contract</FormLabel><FormSelect value={safeData.contract?.tip} options={['Intermediere', 'Exclusivitate', 'Reprezentare Exclusiva']} onChange={(val) => onUpdate?.('crmData.pret.contract.tip', val)} /></div>
         <div><FormLabel>Contract Semnat</FormLabel><FormSelect value={safeData.contract?.semnat} options={['Da', 'Nu', 'In curs']} onChange={(val) => onUpdate?.('crmData.pret.contract.semnat', val)} /></div>
         <div><FormLabel>Nr. Contract</FormLabel><FormInput value={safeData.contract?.nr} onChange={(val) => onUpdate?.('crmData.pret.contract.nr', val)} /></div>
      </FormGrid>
      <FormGrid cols={2}>
         <div><FormLabel>Data Semnare</FormLabel><FormInput value={safeData.contract?.dataSemnare} type="date" onChange={(val) => onUpdate?.('crmData.pret.contract.dataSemnare', val)} /></div>
         <div><FormLabel>Data Expirare</FormLabel><FormInput value={safeData.contract?.dataExpirare} type="date" onChange={(val) => onUpdate?.('crmData.pret.contract.dataExpirare', val)} /></div>
      </FormGrid>
    </div>
  );
};

export const DescriereSection = ({ 
  data, 
  onUpdate, 
  fullCRMData, 
  propertyId 
}: { 
  data: any, 
  onUpdate?: (path: string, val: any) => void, 
  fullCRMData?: any, 
  propertyId?: string 
}) => {
  const safeData = data || {};
  const [isAiGenerating, setIsAiGenerating] = useState(false);

  const handleGenerateWithAI = async () => {
    setIsAiGenerating(true);
    try {
      const category = fullCRMData?.detaliiGenerale?.categoria || "Apartament";
      const transactionType = fullCRMData?.detaliiGenerale?.tranzactie || "Vânzare";
      const zoneVal = fullCRMData?.detaliiGenerale?.localizare?.zona;
      const zone = Array.isArray(zoneVal) ? zoneVal[0] : (zoneVal || "București");
      const price = fullCRMData?.pret?.detalii?.pret || "";
      
      const res = await generateAIText({
        category,
        transactionType,
        zone,
        price,
        specs: fullCRMData?.caracteristici || {},
        originalTitle: safeData.titlu || "",
        originalDescription: safeData.continut || "",
        propertyId: propertyId || ""
      });

      if (res.title) {
        onUpdate?.('crmData.descriere.titlu', res.title);
      }
      if (res.description) {
        onUpdate?.('crmData.descriere.continut', res.description);
      }
      toast.success("Titlul și descrierea au fost generate cu succes prin AI!");
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Eroare la generarea textului cu AI");
    } finally {
      setIsAiGenerating(false);
    }
  };
  
  const generateTemplateTitle = () => {
    if (!fullCRMData) return;
    
    const tip = fullCRMData.detaliiGenerale?.categoria || "Proprietate";
    const camereVal = fullCRMData.caracteristici?.detalii?.camere;
    const suprafataVal = fullCRMData.caracteristici?.suprafete?.utila;
    const info = camereVal ? `${camereVal} camere` : (suprafataVal ? `${suprafataVal} mp` : "");
    
    const zonaVal = fullCRMData.detaliiGenerale?.localizare?.zona;
    const zona = Array.isArray(zonaVal) ? zonaVal[0] : (zonaVal || "");
    const punctInteresArray = fullCRMData.detaliiGenerale?.localizare?.puncteInteres;
    const punctInteres = Array.isArray(punctInteresArray) ? punctInteresArray[0] : (punctInteresArray || "");
    
    // Find a strong point
    const strongPointArray = fullCRMData.caracteristici?.detalii?.checkList;
    const strongPoint = Array.isArray(strongPointArray) ? strongPointArray[0] : (strongPointArray || "");
    
    // Dotari
    const dotariArray = fullCRMData.utilitati?.dotari?.imobil;
    const dotari = Array.isArray(dotariArray) ? dotariArray[0] : (dotariArray || "");
    
    // Parcare
    const parcareVal = fullCRMData.caracteristici?.detalii?.parcari;
    const parcare = parcareVal && parcareVal !== "0" ? "Parcare" : "";

    const parts = [
      `${tip}${info ? ' ' + info : ''}`,
      zona,
      punctInteres,
      strongPoint,
      dotari,
      parcare
    ].filter(Boolean);

    let title = parts.join(" | ");
    
    // Trim to 70 chars if needed
    if (title.length > 70) {
      // Try removing parts from the end or middle
      title = parts.slice(0, 5).join(" | ");
      if (title.length > 70) {
        title = parts.slice(0, 4).join(" | ");
      }
      if (title.length > 70) {
        title = title.substring(0, 67) + "...";
      }
    }

    onUpdate?.('crmData.descriere.titlu', title);
  };

  const generateTemplateDescriere = () => {
    if (!fullCRMData) return;

    const tip = fullCRMData.detaliiGenerale?.categoria || "Apartament";
    const normalizedTip = String(tip || "").trim().toLowerCase();
    
    // Clean values
    const camereVal = fullCRMData.caracteristici?.detalii?.camere || "";
    const baiVal = fullCRMData.caracteristici?.detalii?.bai || "";
    const etajVal = fullCRMData.caracteristici?.detalii?.etaj || "";
    const anVal = fullCRMData.caracteristici?.alteDetalii?.anConstructie || "";
    const suprafataVal = fullCRMData.caracteristici?.suprafete?.utila || "";
    const suprafataTotalaVal = fullCRMData.caracteristici?.suprafete?.utilaTotala || "";
    const compartimentare = fullCRMData.caracteristici?.detalii?.compartimentare || "";

    const zonaVal = fullCRMData.detaliiGenerale?.localizare?.zona;
    const zona = Array.isArray(zonaVal) ? zonaVal[0] : (zonaVal || "");
    
    const getArray = (val: any): string[] => {
      if (Array.isArray(val)) return val;
      if (typeof val === 'string' && val) return [val];
      return [];
    };

    const puncteInteres = getArray(fullCRMData.detaliiGenerale?.localizare?.puncteInteres);
    const incalzire = getArray(fullCRMData.utilitati?.sistemIncalzire);
    const climatizare = getArray(fullCRMData.utilitati?.climatizare);
    const checkList = getArray(fullCRMData.caracteristici?.detalii?.checkList);
    const dotariImobil = getArray(fullCRMData.utilitati?.dotari?.imobil);
    const electrocasnice = getArray(fullCRMData.utilitati?.dotari?.electrocasnice);
    const mobilat = fullCRMData.utilitati?.dotari?.mobilat || "";

    let descTxt = "";
    const isCommercial = normalizedTip.includes("comercial") || 
                         normalizedTip.includes("birou") || 
                         normalizedTip.includes("industrial") || 
                         normalizedTip.includes("depozitare") || 
                         normalizedTip.includes("hale") || 
                         normalizedTip === "hala";

    if (isCommercial) {
      // Commercial template structure
      const lines: string[] = [];
      lines.push("Descriere");
      descTxt = `Spațiu de tip ${tip.toLowerCase() === "hale" ? "hală" : tip.toLowerCase().replace("spatii ", "spațiu ")}`;
      if (zona) descTxt += ` situat în zona ${zona}`;
      if (suprafataVal) descTxt += `, cu o suprafață utilă de ${suprafataVal} mp`;
      descTxt += `. Proprietatea este pretabilă pentru diverse activități comerciale, de birou sau industriale, beneficiind de vizibilitate excelentă și acces facil.`;
      lines.push(descTxt);
      lines.push("");

      lines.push("Detalii Principale");
      if (suprafataVal) lines.push(`• suprafață utilă: ${suprafataVal} mp`);
      if (etajVal) lines.push(`• etaj: ${etajVal}`);
      if (anVal) lines.push(`• an construcție: ${anVal}`);
      lines.push("");

      lines.push("Compartimentare");
      lines.push(compartimentare ? `Spațiul are compartimentare de tip ${compartimentare.toLowerCase()}.` : "Compartimentarea flexibilă permite adaptarea facilă la nevoile business-ului dvs.");
      lines.push("");

      lines.push("Locație");
      if (puncteInteres.length > 0) {
        puncteInteres.forEach(pt => lines.push(`• ${pt}`));
      } else {
        lines.push("• Zonă cu trafic auto și pietonal intens, acces facil la rețele de transport în comun");
      }
      lines.push("");

      lines.push("Detalii Importante");
      if (incalzire.length > 0) lines.push(`• sistem de încălzire: ${incalzire.join(", ")}`);
      if (climatizare.length > 0) lines.push(`• sistem climatizare: ${climatizare.join(", ")}`);
      if (dotariImobil.length > 0) lines.push(`• dotări clădire: ${dotariImobil.join(", ")}`);
      if (checkList.length > 0) lines.push(`• facilități suplimentare: ${checkList.join(", ")}`);
      if (lines[lines.length - 1] === "Detalii Importante") {
        lines.push("• Toate utilitățile contorizate individual");
      }
      lines.push("");

      lines.push("Contact");
      lines.push("Echipa CautLocuinta.ro");
      lines.push("Pentru mai multe detalii sau programarea unei vizionări, mă puteți contacta.");

      onUpdate?.('crmData.descriere.continut', lines.join("\n"));
    } else {
      // Apartments/Residential Template Structure
      const lines: string[] = [];
      
      lines.push("Descriere");
      const tipLabel = (tip === "Apartamente" || tip === "Apartament" || tip === "Apatament") ? "Apartament" : (tip === "Case / Vile" || tip === "Casa/Vila" ? "Casă/Vilă" : "Proprietate");
      descTxt = `${tipLabel}`;
      if (camereVal) descTxt += ` de ${camereVal} camere`;
      if (zona) descTxt += ` situat în zona ${zona}`;
      if (suprafataVal) descTxt += `, cu o suprafață utilă de ${suprafataVal} mp`;
      descTxt += `. Locuința oferă un nivel ridicat de confort, fiind excelent compartimentată și dotată cu tot ce este necesar pentru o mutare rapidă.`;
      lines.push(descTxt);
      lines.push("");

      lines.push("Detalii Principale");
      if (suprafataVal) lines.push(`• suprafață utilă: ${suprafataVal} mp`);
      if (suprafataTotalaVal) lines.push(`• suprafață totală: ${suprafataTotalaVal} mp`);
      if (camereVal) lines.push(`• număr camere: ${camereVal}`);
      if (baiVal) lines.push(`• număr băi: ${baiVal}`);
      if (etajVal) lines.push(`• etaj: ${etajVal}`);
      if (anVal) lines.push(`• an construcție: ${anVal}`);
      lines.push("");

      lines.push("Compartimentare");
      const compPart = compartimentare ? ` ${compartimentare.toLowerCase()}` : " decomandată";
      lines.push(`Locuința are o compartimentare tip${compPart}, fiind concepută pentru a asigura un spațiu aerisit, luminos și foarte bine organizat.`);
      lines.push("");

      lines.push("Locație");
      if (puncteInteres.length > 0) {
        puncteInteres.forEach(pt => lines.push(`• ${pt}`));
      } else {
        lines.push("• Puncte de interes comerciale, educaționale și parcuri în imediata apropiere");
        lines.push("• Acces rapid la stațiile de transport în comun");
      }
      lines.push("");

      lines.push("Detalii Importante");
      if (mobilat) lines.push(`• mobilat: ${mobilat}`);
      if (incalzire.length > 0) lines.push(`• încălzire: ${incalzire.join(", ")}`);
      if (climatizare.length > 0) lines.push(`• aer condiționat: ${climatizare.join(", ")}`);
      if (dotariImobil.length > 0) lines.push(`• dotări imobil: ${dotariImobil.join(", ")}`);
      if (checkList.length > 0) lines.push(`• facilități: ${checkList.join(", ")}`);
      if (electrocasnice.length > 0) lines.push(`• electrocasnice: ${electrocasnice.join(", ")}`);
      if (lines[lines.length - 1] === "Detalii Importante") {
        lines.push("• Finisaje moderne și materiale premium de construcție");
      }
      lines.push("");

      lines.push("Contact");
      lines.push("Echipa CautLocuinta.ro");
      lines.push("Pentru mai multe detalii sau programarea unei vizionări, mă puteți contacta.");

      onUpdate?.('crmData.descriere.continut', lines.join("\n"));
    }
  };

  return (
    <div className="space-y-4">
      {/* On-demand AI Title & Description Generator */}
      <div className="bg-amber-50/60 border border-amber-200/80 rounded-lg p-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
            <Sparkles size={16} />
          </div>
          <div>
            <h4 className="font-title text-xs font-semibold text-gray-900">Generare Text Marketing cu AI (La cerere)</h4>
            <p className="text-[11px] text-gray-500">
              Apasă doar dacă dorești să generezi automat un titlu sub 70 caractere și descrierea conform regulilor oficiale.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleGenerateWithAI}
          disabled={isAiGenerating}
          className="px-4 py-2 bg-[#051D35] hover:bg-[#0a2b4a] text-white text-xs font-medium rounded-md transition-all flex items-center gap-2 shrink-0 disabled:opacity-50 shadow-xs cursor-pointer"
        >
          {isAiGenerating ? (
            <>
              <Loader2 size={13} className="animate-spin text-amber-400" />
              <span>Se generează...</span>
            </>
          ) : (
            <>
              <Sparkles size={13} className="text-amber-400 fill-amber-400" />
              <span>Generează cu AI</span>
            </>
          )}
        </button>
      </div>

      <div className="mb-4">
         <div className="flex items-center justify-between mb-3">
           <SectionHeader>Titlu</SectionHeader>
           <button 
             onClick={generateTemplateTitle}
             className="text-[11px] font-semibold text-[--color-accent] hover:bg-[--color-accent]/10 px-3 py-1 rounded-full transition-colors border border-[--color-accent]/20 flex items-center gap-2"
           >
             <Zap size={12} fill="currentColor" />
             Construiește Titlu (Template)
           </button>
         </div>
         <FormInputWithCounter value={safeData.titlu} limit={70} onChange={(val) => onUpdate?.('crmData.descriere.titlu', val)} />
      </div>
      <FormDivider />
      <div className="mb-4">
         <div className="flex items-center justify-between mb-3">
           <SectionHeader>Descriere</SectionHeader>
           <button 
             type="button"
             onClick={generateTemplateDescriere}
             className="text-[11px] font-semibold text-[--color-accent] hover:bg-[--color-accent]/10 px-3 py-1 rounded-full transition-colors border border-[--color-accent]/20 flex items-center gap-2"
           >
             <Zap size={12} fill="currentColor" />
             Construiește Descriere (Template)
           </button>
         </div>
         <EditableTextArea 
          initialValue={safeData.continut || ""} 
          height="h-80"
          onUpdate={(val) => onUpdate?.('crmData.descriere.continut', val)}
         />
      </div>
      <FormDivider />
      <FormGrid cols={2}>
         <div><FormLabel>Disponibilitate</FormLabel><FormInput value={safeData.disponibilitate} onChange={(val) => onUpdate?.('crmData.descriere.disponibilitate', val)} /></div>
      </FormGrid>
      <FormGrid cols={2}>
         <div><FormLabel>Video (Link Youtube)</FormLabel><FormInput value={safeData.video} onChange={(val) => onUpdate?.('crmData.descriere.video', val)} /></div>
         <div><FormLabel>Tur Virtual</FormLabel><FormInput value={safeData.turVirtual} onChange={(val) => onUpdate?.('crmData.descriere.turVirtual', val)} /></div>
      </FormGrid>
    </div>
  );
};

export const ImaginiSection = ({ data, onUpdate, fullCRMData, propertyId }: { data: CRMData['imagini'], onUpdate?: (path: string, val: any) => void, fullCRMData?: CRMData, propertyId?: string }) => {
  const [generatedPromoUrl, setGeneratedPromoUrl] = React.useState<string>("");

  if (!data || typeof data !== 'object') {
    return (
      <div className="p-16 border-2 border-dashed border-gray-100 rounded-3xl text-center flex flex-col items-center justify-center gap-4 bg-gray-50/30">
        <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center text-gray-300">
          <Zap size={32} />
        </div>
        <div>
          <p className="text-[14px] font-semibold text-gray-400 uppercase tracking-widest">Nicio imagine detectată</p>
          <p className="text-[12px] text-gray-400 mt-1">Extracția nu a identificat imagini pentru această proprietate.</p>
        </div>
      </div>
    );
  }

  const downloadAllInCategory = async (images: { original: string }[], category: string) => {
    for (let i = 0; i < images.length; i++) {
      try {
        const url = images[i].original;
        const response = await fetch(url);
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `${category}-${i + 1}.png`;
        a.click();
        window.URL.revokeObjectURL(blobUrl);
        await new Promise(r => setTimeout(r, 200));
      } catch (e) { console.error(e); }
    }
  };

  const categoriesOrder = ['living', 'bucatarie', 'camera', 'baie', 'alteSpatii'] as const;
  const safeData = data as any;
  
  // Detalii Promo construite automat
  let promoPhone = "0742 290 816";
  const promoCaracteristici: string[] = [];
  const promoAvantaje: string[] = [];
  let catVal = "";
  let resolvedAdv: string[] = [];
  let resolvedDot: string[] = [];
  let resolvedLoc: string[] = [];
  let dynamicTitle = "Pe scurt despre această proprietate:";

  if (fullCRMData) {
    // 1. Phone extraction - always use the mandated "0742 290 816" for embedded promo text
    promoPhone = "0742 290 816";

    // Determine category based on the actual CRM field
    catVal = String(fullCRMData.detaliiGenerale?.categoria || "").toLowerCase();
    
    // Check in description text with diacritics normalized (insensitive)
    const textBody = `${fullCRMData.descriere?.continut || ""} ${fullCRMData.descriere?.titlu || ""}`.toLowerCase();
    const lowerText = textBody.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    // Compute dynamic title based on the category and specifications with proper Romanian diacritics
    if (catVal.includes("apartament")) {
      dynamicTitle = "Pe scurt despre acest apartament:";
    } else if (catVal.includes("birou") || catVal.includes("birouri")) {
      dynamicTitle = "Pe scurt despre acest spațiu de birouri:";
    } else if (catVal.includes("comercial") || catVal.includes("comerciale")) {
      dynamicTitle = "Pe scurt despre acest spațiu comercial:";
    } else if (catVal.includes("industrial") || catVal.includes("industriale")) {
      dynamicTitle = "Pe scurt despre acest spațiu industrial:";
    } else if (catVal.includes("depozitare") || catVal.includes("depozit")) {
      dynamicTitle = "Pe scurt despre acest spațiu de depozitare:";
    } else if (catVal.includes("hale") || catVal.includes("hala")) {
      dynamicTitle = "Pe scurt despre această hală:";
    } else if (catVal.includes("teren") || catVal.includes("terenuri")) {
      dynamicTitle = "Pe scurt despre acest teren:";
    } else if (catVal.includes("casa") || catVal.includes("vila") || catVal.includes("case") || catVal.includes("vile")) {
      const tipCasaLower = String(fullCRMData.caracteristici?.detalii?.tipCasa || "").toLowerCase();
      const confortLower = String(fullCRMData.caracteristici?.detalii?.confort || "").toLowerCase();
      const isLuxuryOrVilla = 
        confortLower.includes("lux") || 
        tipCasaLower.includes("vila") || 
        tipCasaLower.includes("vilă") || 
        textBody.includes("luxury") || 
        textBody.includes("lux") || 
        textBody.includes("vila") || 
        textBody.includes("vilă");
        
      if (isLuxuryOrVilla) {
        dynamicTitle = "Pe scurt despre această vilă:";
      } else {
        dynamicTitle = "Pe scurt despre această casă:";
      }
    }

    const hasKeywords = (words: string[]) => {
      return words.some(w => lowerText.includes(w));
    };

    // Shared parsed variables
    const zonaVal = fullCRMData.detaliiGenerale?.localizare?.zona;
    const zonaStr = Array.isArray(zonaVal) ? zonaVal[0] : (zonaVal || "");
    const orasStr = fullCRMData.detaliiGenerale?.localizare?.oras || "";
    const sUtila = fullCRMData.caracteristici?.suprafete?.utila;
    const sTeren = fullCRMData.caracteristici?.suprafete?.teren;
    const sBalcoane = fullCRMData.caracteristici?.suprafete?.balcoane;
    const sTerase = fullCRMData.caracteristici?.suprafete?.terase;
    const sComp = fullCRMData.caracteristici?.detalii?.compartimentare;
    const sAn = fullCRMData.caracteristici?.alteDetalii?.anConstructie;
    const sEtaj = fullCRMData.caracteristici?.detalii?.etaj;
    const sOrientare = fullCRMData.caracteristici?.detalii?.orientare;
    const sCamere = fullCRMData.caracteristici?.detalii?.camere;
    const sInaltime = fullCRMData.caracteristici?.alteDetalii?.inaltime;
    const sStare = fullCRMData.utilitati?.finisaje?.stare?.[0];
    const sParcari = fullCRMData.caracteristici?.detalii?.parcari;
    const sIncalzireLeft = fullCRMData.utilitati?.sistemIncalzire?.[0] || "";

    if (catVal.includes("apartament")) {
      // ==========================================
      // 1. APARTMENTS
      // ==========================================

      // --- Numerical & Shield Characteristics (Prepend first for high impact) ---
      if (sUtila && Number(sUtila) > 0) {
        promoCaracteristici.push(`Suprafață utilă: ${sUtila} mp`);
      }
      if (sBalcoane && Number(sBalcoane) > 0) {
        promoCaracteristici.push(`Suprafață balcon: ${sBalcoane} mp`);
      } else if (sTerase && Number(sTerase) > 0) {
        promoCaracteristici.push(`Suprafață terasă: ${sTerase} mp`);
      }
      if (sCamere) {
        promoCaracteristici.push(`Compartimentat în ${sCamere} camere`);
      }
      if (hasKeywords(["izolat", "izolatie", "anvelopat", "vata minerala", "clasa energetica a", "centrala bloc", "geamuri tripan"])) {
        promoCaracteristici.push("Clădire cu scut termic superior (izolație termică)");
      } else {
        promoCaracteristici.push("Scut termic excelent: eficient energetic");
      }
      if (sEtaj && promoCaracteristici.length < 5) {
        promoCaracteristici.push(`Poziționat confortabil: etaj ${sEtaj}`);
      }

      // --- Fallback Selector Matches (Up to 5 total items) ---
      // 1. Location / neighborhood
      if (zonaStr && promoCaracteristici.length < 5) {
        promoCaracteristici.push(`Locație excelentă în zona ${zonaStr}`);
      }
      // 2. Metro proximity
      if (promoCaracteristici.length < 5) {
        const isMetro = hasKeywords(["metrou", "metro", "statie de metrou", "m1", "m2", "m3", "m4", "minute metrou"]) || 
                        (fullCRMData.detaliiGenerale?.localizare?.imprejurimi && fullCRMData.detaliiGenerale.localizare.imprejurimi.includes("Metrou"));
        if (isMetro) {
          promoCaracteristici.push("Acces rapid și conexiune facilă la metrou");
        }
      }
      // 3. Building age and seismic safety
      if (promoCaracteristici.length < 5) {
        if (sAn) {
          promoCaracteristici.push(`Construcție trainică finalizată în ${sAn}`);
        } else if (hasKeywords(["bloc nou", "constructie noua", "fara risc", "seismic", "clasa de risc"])) {
          promoCaracteristici.push("Clădire nouă sigură fără risc seismic");
        }
      }
      // 4. Efficient layout / decomandat
      if (promoCaracteristici.length < 5) {
        if (sComp && sComp.toLowerCase() === "decomandat") {
          promoCaracteristici.push("Compartimentare decomandată ideal distribuită");
        } else if (sComp) {
          promoCaracteristici.push(`Compartimentare de tip ${sComp.toLowerCase()}`);
        } else if (hasKeywords(["decomandat", "decomandata", "compartimentare eficienta", "compartimentat ergonomic"])) {
          promoCaracteristici.push("Compartimentare deosebit de bine organizată");
        }
      }
      // 5. Price-to-value ratio
      if (promoCaracteristici.length < 5) {
        if (hasKeywords(["calitate/pret", "investitie", "excelent raport", "raport excelent", "pret avantajos", "pret de exceptie", "pret atractiv", "chirie competitiva"])) {
          promoCaracteristici.push("Raport optim între calitate și preț pe piață");
        }
      }
      // 6. Parking availability
      if (promoCaracteristici.length < 5) {
        if (sParcari && Number(sParcari) > 0) {
          promoCaracteristici.push("Locuri de parcare disponibile în incintă");
        } else if (hasKeywords(["parcare", "loc parcare", "locuri parcare", "loc de parcare", "garaj"])) {
          promoCaracteristici.push("Loc de parcare asigurat pentru viitorul locatar");
        }
      }
      // 7. Building quality and insulation
      if (promoCaracteristici.length < 5) {
        if (hasKeywords(["izolat termic", "anvelopat", "reabilitat", "vata minerala", "clasa energetica a", "centrala bloc"])) {
          promoCaracteristici.push("Bloc complet izolat termic de clasă energetică superioară");
        }
      }
      // 8. Natural light and orientation
      if (promoCaracteristici.length < 5) {
        if (sOrientare) {
          promoCaracteristici.push(`Orientare luminoasă spre ${sOrientare}`);
        } else if (hasKeywords(["luminos", "lumina naturala", "orientare sud", "sud-est", "sud-west", "foarte luminos"])) {
          promoCaracteristici.push("Lumină naturală abundentă pe tot parcursul zilei");
        }
      }
      // 9. Nearby infrastructure and services
      if (promoCaracteristici.length < 5) {
        if (hasKeywords(["supermarket", "magazin", "scoala", "gradinita", "parc", "farmacie", "mall", "autobuz", "tramvai", "baza comerciala", "gradinite"])) {
          promoCaracteristici.push("Infrastructură completă și facilități diverse în jur");
        }
      }
      // 10. Renovation quality / move-in readiness
      if (promoCaracteristici.length < 5) {
        if (hasKeywords(["renovat", "stare perfecta", "lux", "proaspat zugravit", "mutare imediata", "gata de mutare", "finisaje impecabile"])) {
          promoCaracteristici.push("Renovat integral și pregătit pentru mutare imediată");
        }
      }

      // --- Advantages (Top 10) ---
      // 1. Shorter commute
      if (hasKeywords(["naveta", "timp redus", "acces rapid centru", "conectat facil", "aproape de centru", "apropiere birouri", "zona office", "minute de centru"])) {
        promoAvantaje.push("Navetă scurtă și timp redus considerabil în trafic");
      }
      // 2. Better lifestyle and comfort
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["confort", "confortabil", "stil de viata", "premium", "zona linistita si curata", "relaxare", "high class"])) {
          promoAvantaje.push("Nivel ridicat de confort pentru un stil de viață select");
        }
      }
      // 3. Lower maintenance costs
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["facturi", "intretinere mica", "cheltuieli mici", "cheltuieli minime", "centrala proprie", "eficient energetic", "clasa a", "facturi reduse"])) {
          promoAvantaje.push("Cheltuieli lunare optimizate și întreținere redusă");
        }
      }
      // 4. Safety and security
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["paza", "supraveghere", "securizat", "video", "interfon", "cartier sigur", "bariera", "alarm", "pazit"])) {
          promoAvantaje.push("Siguranță sporită cu supraveghere integrată");
        }
      }
      // 5. Modern living experience
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["modern", "nou", "design", "tehnologie", "smart", "utilat ultramodern", "contemporan"])) {
          promoAvantaje.push("Experiență imobiliară adaptată tehnologiilor actuale");
        }
      }
      // 6. Prestige and image
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["prestigiu", "select", "lux", "premium", "deosebit", "reprezentativ", "zona de top", "premium area", "exclusiv"])) {
          promoAvantaje.push("Amplasare prestigioasă într-o zonă reputată");
        }
      }
      // 7. Good resale and investment potential
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["investitie", "potential", "chirie", "randament", "randament investitional", "sigur", "apreciere in timp"])) {
          promoAvantaje.push("Investiție sigură cu randament excelent pe termen lung");
        }
      }
      // 8. Access to parks and green spaces
      if (promoAvantaje.length < 5) {
        const isGreen = hasKeywords(["parc", "zona verde", "verdeata", "copaci", "gradina", "padure", "green", "parcul"]) || 
                        (fullCRMData.utilitati?.dotari?.imobil && fullCRMData.utilitati.dotari.imobil.includes("Zone verzi"));
        if (isGreen) {
          promoAvantaje.push("Acces imediat la parcuri și zone verzi de relaxare");
        }
      }
      // 9. Remote work compatibility
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["birou", "work from home", "remote", "lucru de acasa", "internet mare viteza", "spatiu birou", "conexiune rapida"])) {
          promoAvantaje.push("Mediu propice și spațiu compatibil pentru lucrul de acasă");
        }
      }
      // 10. Ready-to-move convenience
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["gata de mutare", "mutare imediata", "complet mobilat", "complet utilat", "cheie in mana", "complet echipat", "muti direct"])) {
          promoAvantaje.push("Mutare rapidă fără efort adițional de mobilare");
        }
      }

    } else if (catVal.includes("casa") || catVal.includes("vila") || catVal.includes("case")) {
      // ==========================================
      // 2. VILLAS / HOUSES
      // ==========================================

      // --- Numerical & Shield Characteristics (Prepend first for high impact) ---
      if (sUtila && Number(sUtila) > 0) {
        promoCaracteristici.push(`Suprafață interior: ${sUtila} mp`);
      }
      if (sTeren && Number(sTeren) > 0) {
        promoCaracteristici.push(`Curte și teren privat: ${sTeren} mp`);
      }
      if (sCamere) {
        promoCaracteristici.push(`Compartimentat în ${sCamere} camere`);
      }
      if (hasKeywords(["izolat", "izolatie", "anvelopat", "vata minerala", "pompa de caldura", "fotovoltaice", "clasa a", "tripan"])) {
        promoCaracteristici.push("Casă cu scut termic superior (izolație premium)");
      } else {
        promoCaracteristici.push("Eficiență termică mărită (scut termic)");
      }
      if (sParcari && Number(sParcari) > 0 && promoCaracteristici.length < 5) {
        promoCaracteristici.push(`Locuri de parcare asigurate: ${sParcari}`);
      }

      // --- Fallback Keyword-Based Items (Only pushes if we have less than 5 items) ---
      // 1. Location and commute to Bucharest
      if (orasStr && promoCaracteristici.length < 5) {
        if (orasStr === "Bucuresti") {
          promoCaracteristici.push(`Locație în zona rezidențială București ${zonaStr || ''}`);
        } else {
          promoCaracteristici.push(`Locație rezidențială deosebită în ${orasStr}`);
        }
      } else if (hasKeywords(["acces rapid", "ilfov", "otopeni", "corbeanca", "tunari", "pipera", "voluntari", "dn1", "autostrada", "centura"]) && promoCaracteristici.length < 5) {
        promoCaracteristici.push("Acces rutier rapid și facil spre arterele majore");
      }
      // 2. Land size / yard size fallback
      if (promoCaracteristici.length < 5) {
        if (hasKeywords(["curte", "gradina", "mp curte", "teren spatios", "curte proprie"])) {
          promoCaracteristici.push("Teren privat spațios cu o curte proprie excelentă");
        }
      }
      // 3. Construction quality
      if (promoCaracteristici.length < 5) {
        if (hasKeywords(["bca", "porotherm", "caramida", "beton b350", "structura solida", "calitate constructie", "structura beton", "materiale premium", "izolatie vata"])) {
          promoCaracteristici.push("Materiale de zidărie din cărămidă și structură solidă din beton");
        }
      }
      // 4. Utilities availability (gas, sewage, water)
      if (promoCaracteristici.length < 5) {
        if (hasKeywords(["gaz", "canalizare", "apa curenta", "fosa septica", "put proprie", "gaze", "toate utilitatile", "retea apa"])) {
          promoCaracteristici.push("Branșamente de utilități complet finalizate în rețea");
        }
      }
      // 5. Neighborhood quality
      if (promoCaracteristici.length < 5) {
        if (hasKeywords(["cartier rezidential", "vecini selecti", "vecini de calitate", "zona linistita", "comunitate", "constructii noi", "case noi"])) {
          promoCaracteristici.push("Amplasare liniștită într-o comunitate discretă");
        }
      }
      // 6. Privacy level
      if (promoCaracteristici.length < 5) {
        if (hasKeywords(["intimitate", "fara vecini directi", "zona ferita", "curte intima", "gard inalt", "discretie", "intimitate sporita"])) {
          promoCaracteristici.push("Grad excepțional de intimitate și liniște cotidiană");
        }
      }
      // 7. Parking and garage capacity fallback
      if (promoCaracteristici.length < 5) {
        if (hasKeywords(["garaj", "parcare curte", "locuri parcare", "parcare proprie", "multiple masini"])) {
          promoCaracteristici.push("Locuri sigure de parcare în curtea interioară");
        }
      }
      // 8. Interior usable area
      if (promoCaracteristici.length < 5) {
        if (sUtila && Number(sUtila) > 0) {
          promoCaracteristici.push(`Suprafață interior utilă de ${sUtila} mp`);
        }
      }
      // 9. Road access and infrastructure
      if (promoCaracteristici.length < 5) {
        if (hasKeywords(["drum asfaltat", "asfaltata", "acces facil", "drum privat", "latime drum", "iluminat stradal"])) {
          promoCaracteristici.push("Cale accesibilă asfaltată și lățime confortabilă");
        }
      }
      // 10. Energy efficiency and insulation
      if (promoCaracteristici.length < 5) {
        if (hasKeywords(["pompa de caldura", "fotovoltaice", "tripan", "clasa energetica a", "izolat", "izolatie termica"])) {
          promoCaracteristici.push("Eficiență termică mărită de clasă superioară");
        }
      }

      // --- Advantages (Top 10) ---
      // 1. More space and privacy
      if (hasKeywords(["spatios", "libertate", "intimitate", "fara vecini comuni", "camere generoase", "aerisit"])) {
        promoAvantaje.push("Extrem de mult spațiu disponibil într-o atmosferă intimă");
      }
      // 2. Quiet environment
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["liniste", "zona linistita", "aer curat", "calm", "natura", "ferit de zgomot", "zgomot urban", "relaxare"])) {
          promoAvantaje.push("Oază caldă de liniște cu aer curat fără zgomot urban");
        }
      }
      // 3. Yard and outdoor living
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["terasa", "gratar", "piscina", "loc de joaca", "gradina amenajata", "foisor", "barbeque", "curte libera"])) {
          promoAvantaje.push("Grădină liberă ideală pentru petrecerea timpului afară");
        }
      }
      // 4. Better family lifestyle
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["familie", "copii", "animale", "family lifestyle", "crestere copii", "liniste familie"])) {
          promoAvantaje.push("Mediu ideal adaptat pentru nevoile unei familii active");
        }
      }
      // 5. Safer environment for children
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["siguranta copii", "complex inchis", "fara trafic intens", "curte securizata", "siguranta"])) {
          promoAvantaje.push("Curte securizată ce aduce liniște deplină pentru copii");
        }
      }
      // 6. Prestige and exclusivity
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["lux", "premium", "exclusivist", "vile exclusiviste", "proiect unic", "arhitectura deosebita"])) {
          promoAvantaje.push("O adresă unică și o prezență arhitecturală deosebită");
        }
      }
      // 7. Flexibility for remote work
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["birou", "work from home", "remote", "lucru de acasa", "mansarda locuibila", "bioru individual"])) {
          promoAvantaje.push("Camere potrivite pentru configurarea unui workspace profesionist");
        }
      }
      // 8. Multiple parking spaces
      if (promoAvantaje.length < 5) {
        if (sParcari && Number(sParcari) > 1) {
          promoAvantaje.push("Spațiu auto suficient pentru membrii familiei și musafiri");
        }
      }
      // 9. Better long-term living comfort
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["incalzire pardoseala", "climatizare", "confort sporit", "pe viata", "incalzire in pardoseala"])) {
          promoAvantaje.push("Instalație de încălzire în pardoseală pentru confort crescut");
        }
      }
      // 10. Potential property appreciation
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["investitie", "potential", "zona in plina dezvoltare", "apreciere", "potential de appreciation"])) {
          promoAvantaje.push("Zonă cu cerere ridicată și potențial crescut de valorizare");
        }
      }

    } else if (catVal.includes("birouri") || catVal.includes("comerciale") || catVal.includes("comercial") || catVal.includes("retail") || catVal.includes("showroom")) {
      // ==========================================
      // 3. COMMERCIAL SPACES
      // ==========================================

      // --- Characteristics (Top 10) ---
      // 1. Visibility and street exposure
      if (hasKeywords(["vizibilitate", "stradal", "front stradal", "expunere direct", "fatada", "promovare", "expunere stradala"])) {
        promoCaracteristici.push("Vizibilitate deosebită cu expunere direct stradală");
      }
      // 2. Pedestrian traffic
      if (promoCaracteristici.length < 5) {
        if (hasKeywords(["trafic pietonal", "intens circulat", "pietoni", "vad pietonal", "vad comercial", "vad format"])) {
          promoCaracteristici.push("Vad comercial pietonal asigurat de un flux continuu");
        }
      }
      // 3. Car traffic and accessibility
      if (promoCaracteristici.length < 5) {
        if (hasKeywords(["trafic auto", "artera principala", "parcare clienti", "intersectie", "intersectie mare", "bd principal"])) {
          promoCaracteristici.push("Acces rapid de pe o arteră principală de transport");
        }
      }
      // 4. Location quality
      if (promoCaracteristici.length < 5) {
        if (zonaStr) {
          promoCaracteristici.push(`Amplasare ideală în zona comercială ${zonaStr}`);
        } else if (hasKeywords(["amplasare centrala", "centru", "zona ultra-centrala", "vad excelent", "pozitie premium"])) {
          promoCaracteristici.push("Zonă excelentă de mare atractivitate economică");
        }
      }
      // 5. Storefront and window visibility
      if (promoCaracteristici.length < 5) {
        if (hasKeywords(["vitrina", "front vitrat", "geamuri mari", "vitrina generoasa", "latime vitrina", "storefront"])) {
          promoCaracteristici.push("Vitrină mare luminoasă ce asigură expunere maximă");
        }
      }
      // 6. Usable open space layout
      if (promoCaracteristici.length < 5) {
        if (sComp && sComp.toLowerCase() === "open space") {
          promoCaracteristici.push("Suprafață deschisă cu adaptabilitate maximă");
        } else if (hasKeywords(["open space", "compartimentare flexibila", "structura de stalpi", "fara stalpi", "recompartimentare"])) {
          promoCaracteristici.push("Structură independentă ce permite recompartimentări rapide");
        }
      }
      // 7. Parking availability
      if (promoCaracteristici.length < 5) {
        if (hasKeywords(["parcare clienti", "parcare proprie", "locuri in fata", "parcare subterana", "multiple parcari"])) {
          promoCaracteristici.push("Locuri dedicate pentru staționarea clienților");
        }
      }
      // 8. Utility capacity and infrastructure
      if (promoCaracteristici.length < 5) {
        if (hasKeywords(["curent trifazic", "putere mare", "gaze", "ventilatie", "hvac", "sistem climatizare industrial", "trifazat"])) {
          promoCaracteristici.push("Sistem de utilități puternic inclusiv curent trifazic");
        }
      }
      // 9. Rent-to-sales potential
      if (promoCaracteristici.length < 5) {
        if (hasKeywords(["rentabilitate mare", "chirie competitiva", "amortizare rapida", "vad excelent", "oportunitate comerciala"])) {
          promoCaracteristici.push("Raport economic excelent pentru desfășurarea activității");
        }
      }
      // 10. Nearby anchor businesses
      if (promoCaracteristici.length < 5) {
        if (hasKeywords(["mega image", "banc", "farmacie", "langa", "ancore comerciale", "branduri cunoscute"])) {
          promoCaracteristici.push("Punct comercial cu flux ridicat datorat retailerilor din jur");
        }
      }

      // --- Advantages (Top 10) ---
      // 1. Higher customer exposure
      if (hasKeywords(["branding", "vizibilitate", "brand awareness", "atragere clienti", "atrage priviri", "vad bun"])) {
        promoAvantaje.push("Oportunități sporite de promovare a mărcii");
      }
      // 2. Increased sales potential
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["vanzari", "profit", "profitabil", "vad format", "baza clienti"])) {
          promoAvantaje.push("Vad optim ce ridică natural volumul vânzărilor");
        }
      }
      // 3. Easier brand visibility
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["firma luminoasa", "caseta luminoasa", "vizibil de la distanta", "panou publicitar"])) {
          promoAvantaje.push("Posibilitate facilă de amplasare a semnalisticii luminoase");
        }
      }
      // 4. Better accessibility for clients
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["transport", "metrou in fata", "parcare clienti", "acces facil cli"])) {
          promoAvantaje.push("Conexiune perfectă cu stațiile de transport public");
        }
      }
      // 5. Strong business positioning
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["sediu reprezentativ", "imagine corporativa", "cladire cladire reprezentativa", "lider de piata"])) {
          promoAvantaje.push("Sediu potrivit pentru consolidarea poziției în business");
        }
      }
      // 6. Long-term commercial value
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["investitie stabila", "valoare in timp", "zona de viitor", "rezistent la recesiune"])) {
          promoAvantaje.push("Stabilitate ridicată a valorii spațiului în piață");
        }
      }
      // 7. Easier staff access
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["acces personal", "acces angajati", "aproape de metrou", "angajati facil"])) {
          promoAvantaje.push("Acces simplu și comod pentru colectivul de angajați");
        }
      }
      // 8. Lower operational friction
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["gata de functionare", "autorizat", "avize", "isus", "fara reparatii", "renovat complet"])) {
          promoAvantaje.push("Spațiu gata de predare fără reparații necesare");
        }
      }
      // 9. Expansion potential
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["posibilitate extindere", "etaje superioare", "lot alaturat", "spatii modulabile"])) {
          promoAvantaje.push("Structură adaptabilă în cazul unei expansiuni viitoare");
        }
      }
      // 10. Higher profitability potential
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["profitabilitate", "randament maxim", "profit garantat", "profitabilitate sporita"])) {
          promoAvantaje.push("Randament comercial maximizat grație poziției favorabile");
        }
      }

    } else if (catVal.includes("depozitare") || catVal.includes("depozit") || catVal.includes("hale") || catVal.includes("hala")) {
      // ==========================================
      // 4. DEPOSITS / WAREHOUSES
      // ==========================================

      // --- Characteristics (Top 10) ---
      // 1. Access to highways and ring roads
      if (hasKeywords(["centura", "autostrada", "a1", "a2", "a3", "drum rapid", "ring road", "centura capitalei"])) {
        promoCaracteristici.push("Acces logistic direct spre arterele rutiere centură");
      }
      // 2. Ceiling height
      if (promoCaracteristici.length < 5) {
        if (sInaltime) {
          promoCaracteristici.push(`Înălțime utilă a tavanului de ${sInaltime}`);
        } else if (hasKeywords(["inaltime utila", "inaltime 6m", "inaltime 8m", "inaltime 10m", "inaltime h=", "h peste 6"])) {
          promoCaracteristici.push("Înălțime crescută ideală pentru depozitare înaltă");
        }
      }
      // 3. Loading docks and access ramps
      if (promoCaracteristici.length < 5) {
        if (hasKeywords(["rampa", "rampe de incarcare", "dock", "docks", "rampa hidraulica", "usi sectionale"])) {
          promoCaracteristici.push("Rampe performante pentru descărcare și uși secționale");
        }
      }
      // 4. Truck accessibility
      if (promoCaracteristici.length < 5) {
        if (hasKeywords(["tir", "acces tir", "camioane", "vehicule grele", "truck access", "manevra tir"])) {
          promoCaracteristici.push("Intrare de mare tonaj și platformă solidă de manevră");
        }
      }
      // 5. Usable storage area
      if (promoCaracteristici.length < 5) {
        if (sUtila && Number(sUtila) > 0) {
          promoCaracteristici.push(`Capacitate utilă vastă de ${sUtila} mp`);
        }
      }
      // 6. Security systems
      if (promoCaracteristici.length < 5) {
        if (hasKeywords(["paza", "supraveghere 24/7", "sisteme de securitate", "bariera", "senzori efractie", "sprinklere", "hidranti"])) {
          promoCaracteristici.push("Elemente moderne de securitate și hidranți PSI");
        }
      }
      // 7. Industrial utilities capacity
      if (promoCaracteristici.length < 5) {
        if (hasKeywords(["curent trifazic", "putere absorbita", "gaze", "apa curenta de mare debit", "post trafo", "trifazat"])) {
          promoCaracteristici.push("Debit logistic util cu posibilitate de curent trifazat");
        }
      }
      // 8. Yard and maneuvering space
      if (promoCaracteristici.length < 5) {
        if (hasKeywords(["platforma betonata", "curte manevra", "loc intors", "curte", "yard", "parcare tir"])) {
          promoCaracteristici.push("Suprafață betonată largă pentru întoarcerea camioanelor");
        }
      }
      // 9. Construction quality
      if (promoCaracteristici.length < 5) {
        if (hasKeywords(["panouri sandwich", "structura metalica zinguita", "pereti panouri", "pardoseala elicopterizata"])) {
          promoCaracteristici.push("Izolare completă cu panouri sandwich moderne");
        }
      }
      // 10. Operational costs
      if (promoCaracteristici.length < 5) {
        if (hasKeywords(["eficientizata", "costuri reduse", "intretinere ieftina", "cladire verde", "izolatie termica buna"])) {
          promoCaracteristici.push("Concept optimizat pentru cheltuieli logistice minime");
        }
      }

      // --- Advantages (Top 10) ---
      // 1. Faster logistics operations
      if (hasKeywords(["logistica", "timp optim", "livrari rapide", "operatiuni rapide", "flux operativ", "distributie eficienta"])) {
        promoAvantaje.push("Flux crescut de logistică cu rulaj operativ ridicat");
      }
      // 2. Lower transport costs
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["economie transport", "aproape de clienti", "hub logistic", "reduceri transport", "pozitie centrata"])) {
          promoAvantaje.push("Optimizare logistică remarcabilă a rețelei de transport");
        }
      }
      // 3. Easier loading and unloading
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["rampe rapide", "incarcare usoara", "cozi rampe", "stivuitoare", "fast loading"])) {
          promoAvantaje.push("Operațiuni simple de descărcare grație rampelor rapide");
        }
      }
      // 4. Better operational efficiency
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["optimizare", "eficienta sporita", "productivitate", "automatizare"])) {
          promoAvantaje.push("Productivitate ridicată a personalului");
        }
      }
      // 5. Scalability for business growth
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["extindere", "depozitarea pe inaltime", "scala", "modulare"])) {
          promoAvantaje.push("Posibilitate excelentă de configurare modulară a rafturilor");
        }
      }
      // 6. Safer goods storage
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["conditii optime", "temperatura controlata", "fara infiltrati", "umiditate", "securitate deplina"])) {
          promoAvantaje.push("Condiții optime garantate de temperatură și depozitare");
        }
      }
      // 7. Better access for suppliers
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["furnizori", "curieri", "acces furnizori", "punct receptie"])) {
          promoAvantaje.push("Acces optimizat pentru camioanele furnizorilor externi");
        }
      }
      // 8. Reduced downtime
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["timp inactivitate", "blocaje curte", "downtime"])) {
          promoAvantaje.push("Fluență totală ce evită timpii morți la descărcare");
        }
      }
      // 9. Improved inventory management
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["paletizare", "sortari facile", "rafturi organizate", "inventory", "FIFO", "LIFO"])) {
          promoAvantaje.push("Sistem constructiv ideal pentru o gestiune exactă a mărfii");
        }
      }
      // 10. Long-term operational flexibility
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["destinatie multipla", "flexibilitat exploatare", "spatiu polivalent", "multiactivitate"])) {
          promoAvantaje.push("Utilizare deosebit de versatilă potrivită multor segmente");
        }
      }

    } else if (catVal.includes("industriale") || catVal.includes("industrial")) {
      // ==========================================
      // 5. INDUSTRIAL SPACES
      // ==========================================

      // --- Characteristics (Top 10) ---
      // 1. Strategic industrial location
      if (hasKeywords(["parc industrial", "zona industriala", "strategic", "hub industrial"])) {
        promoCaracteristici.push("Poziționare strategică într-un areal complet industrializat");
      }
      // 2. Power supply capacity
      if (promoCaracteristici.length < 5) {
        if (hasKeywords(["putere mare", "curent trifazic", "trafo", "punct transformare", "capacitate electrica", "consum industrial", "trifazat"])) {
          promoCaracteristici.push("Putere electrică instalată remarcabilă și transformator util");
        }
      }
      // 3. Ceiling height and open span
      if (promoCaracteristici.length < 5) {
        if (sInaltime) {
          promoCaracteristici.push(`Span cu deschidere mare și înălțime de ${sInaltime}`);
        } else if (hasKeywords(["deschidere mare", "span liber", "fara stalpi", "h7", "h8", "h9", "h10", "deschidere libera"])) {
          promoCaracteristici.push("Deschidere largă fără obstacole sau stâlpi structurali");
        }
      }
      // 4. Truck and TIR access
      if (promoCaracteristici.length < 5) {
        if (hasKeywords(["tir", "acces tir", "platforma manevra", "usi sectionale", "halls drive-in", "autocamioane"])) {
          promoCaracteristici.push("Căi cu acces facil TIR și porți de gabarit ridicat");
        }
      }
      // 5. Heavy equipment compatibility
      if (promoCaracteristici.length < 5) {
        if (hasKeywords(["pod rulant", "retea gaze", "aer comprimat", "ancore", "vibratii", "grele", "heavy equipment"])) {
          promoCaracteristici.push("Posibilitate practică de montare pod rulant sau utilaje grele");
        }
      }
      // 6. Industrial zoning and permits
      if (promoCaracteristici.length < 5) {
        if (hasKeywords(["puz", "permis", "avize", "autorizatie", "isus", "fara restrictii", "functional industrial"])) {
          promoCaracteristici.push("Zonă cu destinație aprobată pentru producție industrială");
        }
      }
      // 7. Floor resistance capacity
      if (promoCaracteristici.length < 5) {
        if (hasKeywords(["rezistenta pardoseala", "t/mp", "tone pe metru patrat", "pardoseala betonata", "armat", "sarcina mare"])) {
          promoCaracteristici.push("Pardoseală industrială elicopterizată portantă deosebit de solidă");
        }
      }
      // 8. Workforce accessibility
      if (promoCaracteristici.length < 5) {
        if (hasKeywords(["acces personal", "naveta angajati", "forta de munca", "recrutare", "proximitate transport"])) {
          promoCaracteristici.push("Zonă propice cu acces facil la comunitățile de personal");
        }
      }
      // 9. Utilities infrastructure
      if (promoCaracteristici.length < 5) {
        if (hasKeywords(["gaze naturale", "canalizare industriala", "epurare", "retea apa mare debit", "apa industriala"])) {
          promoCaracteristici.push("Branșamente de mare capacitate instalate cu succes");
        }
      }
      // 10. Expansion possibilities
      if (promoCaracteristici.length < 5) {
        if (hasKeywords(["posibilitate extindere", "teren liber", "lot alaturat", "rezerva teren"])) {
          promoCaracteristici.push("Teren liber adiacent gata pentru posibile extinderi");
        }
      }

      // --- Advantages (Top 10) ---
      // 1. Operational efficiency
      if (hasKeywords(["operatiuni", "flux continuu", "eficientizat", "optimizare productie", "productivitate"])) {
        promoAvantaje.push("Ușurință totală în optimizarea proceselor zilnice");
      }
      // 2. Better logistics flow
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["flux logistic", "tranzit material", "stocare rapida", "incarcari directe"])) {
          promoAvantaje.push("Organizare superioară a proceselor interne");
        }
      }
      // 3. Reduced production costs
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["costuri reduse", "consum redus", "eficient energetic", "economii productie"])) {
          promoAvantaje.push("Costuri optimizate consistent");
        }
      }
      // 4. Scalability and expansion
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["scalabilitate", "afacere industriala", "dezvoltare", "mărire linii"])) {
          promoAvantaje.push("Flexibilitate mare la modificări dinamice în producție");
        }
      }
      // 5. Easier transport access
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["autostrada", "centura", "cale ferata", "coridor", "drum fast"])) {
          promoAvantaje.push("Conexiuni facile cu toate rutele de transit ale țării");
        }
      }
      // 6. Improved production capacity
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["crestere capacitate", "linie fabricatie", "asamblare intensiva", "productie crescuta"])) {
          promoAvantaje.push("Structură ideală adaptată utilajelor de mare tonaj");
        }
      }
      // 7. Long-term business stability
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["stabilitate", "siguranta utilaje", "investitie sigura", "proprietari"])) {
          promoAvantaje.push("Siguranță maximă și durabilitate deplină în activitate");
        }
      }
      // 8. Better workforce accessibility
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["recrutare facila", "bazin forta de munca", "apropiere localitate", "muncitori"])) {
          promoAvantaje.push("Bazin propice pentru atragerea forței de muncă în zonă");
        }
      }
      // 9. Higher industrial productivity
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["utilitare moderne", "productivitate maxima", "fara timpi morti"])) {
          promoAvantaje.push("Nivel ridicat de operare ce evită blocajele logistice");
        }
      }
      // 10. Strong long-term investment value
      if (promoAvantaje.length < 5) {
        if (hasKeywords(["investitie de top", "apreciere valoare", "valoare asamblare", "randament exceptional"])) {
          promoAvantaje.push("Activ imobiliar cu remarcabilă rezistență și valoare durabilă");
        }
      }
    }

    // --- Fill up with actual generic extracted parameters if we didn't reach 5 specific items ---
    const genericCharacteristics = [
      sUtila ? `${sUtila} mp utili` : "",
      sComp ? `Compartimentare practică tip ${sComp.toLowerCase()}` : "",
      sCamere ? `${sCamere} camere spațioase` : "",
      sEtaj ? `Amplasare confortabilă la etajul ${sEtaj}` : "",
      sAn ? `Construcție finalizată în anul ${sAn}` : "",
      sStare ? `Proprietate aflată în stare ${sStare.toLowerCase()}` : ""
    ].filter(Boolean);

    const genericAdvantages = [
      orasStr ? `Situat la o adresă convenabilă în ${orasStr}` : "",
      sIncalzireLeft ? `Confort termic optim prin ${sIncalzireLeft.toLowerCase()}` : "",
      fullCRMData.utilitati?.climatizare?.includes("Aer conditionat") ? "Sistem cu aer condiționat instalat" : "",
      fullCRMData.utilitati?.dotari?.imobil?.includes("Lift") ? "Clădire prevăzută cu lift modern" : "",
      fullCRMData.utilitati?.dotari?.imobil?.includes("Supraveghere video") ? "Sistem de supraveghere video activ" : "",
      sParcari ? "Locuri de parcare asigurate" : ""
    ].filter(Boolean);

    genericCharacteristics.forEach(gc => {
      if (promoCaracteristici.length < 5 && !promoCaracteristici.includes(gc)) {
        promoCaracteristici.push(gc);
      }
    });

    genericAdvantages.forEach(ga => {
      if (promoAvantaje.length < 5 && !promoAvantaje.includes(ga)) {
        promoAvantaje.push(ga);
      }
    });

    // Ensure stable design-compliant fallbacks if empty or not fully populated
    if (promoCaracteristici.length === 0) {
      const isCommercialOrInd = catVal.includes("depozitare") || catVal.includes("hale") || catVal.includes("industrial") || catVal.includes("birouri");
      if (isCommercialOrInd) {
        promoCaracteristici.push(
          "Suprafață configurabilă pentru diverse activități comerciale",
          "Amplasare ideală având o vizibilitate crescută",
          "Plan modular adaptabil businessului dumneavoastră",
          "Eficiență termică optimă pentru funcționare facilă",
          "Acces auto generos pentru livrări sau vizitatori"
        );
      } else {
        promoCaracteristici.push(
          "Design extrem de calitativ și modern",
          "Finisaje deosebite cu atmosferă curată",
          "Compartimentare bine gândită cu spații utile",
          "Lumină naturală intensă pe tot parcursul zilei",
          "Zonă liniștită și sigur conectată cu principalele puncte"
        );
      }
    }
    if (promoAvantaje.length === 0) {
      const isCommercialOrInd = catVal.includes("depozitare") || catVal.includes("hale") || catVal.includes("industrial") || catVal.includes("birouri");
      if (isCommercialOrInd) {
        promoAvantaje.push(
          "Poziționare strategică cu facilități logistice lăudabile",
          "Intrare comodă pentru autovehicule și camioane",
          "Sistem de securitate activ în incintă",
          "Cheltuieli de funcționare optimizate echilibrat",
          "Destinație polivalentă potrivită multor ramuri economice"
        );
      } else {
        promoAvantaje.push(
          "Confort locativ suprem pentru viitorii proprietari",
          "Conexiuni facile cu rețeaua de transport stradal",
          "Vecinătate de încredere sigură și discretă",
          "Atmosferă excelentă perfectă pentru relaxare",
          "Randament excelent al achiziției imobiliare în timp"
        );
      }
    }

    // Parse standard Sections from descriptive content ('descriere.continut')
    const parseDescriptionSections = (descriptionText: string) => {
      const lines = descriptionText ? descriptionText.split("\n") : [];
      
      const avantajeList: string[] = [];
      const dotariList: string[] = [];
      const locatieList: string[] = [];
      
      let currentSection: "none" | "avantaje" | "dotari" | "locatie" = "none";
      
      for (let line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        
        // A line is treated as a bullet if it starts with standard bullet characters: '-', '*', '•'
        const isBullet = trimmed.startsWith("-") || trimmed.startsWith("*") || trimmed.startsWith("•");
        
        const plainText = trimmed.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        
        // Check for section breaks or headers ONLY on lines that are NOT bullet points
        if (!isBullet) {
          if (plainText.includes("avantaje principale") || plainText.includes("puncte cheie")) {
            currentSection = "avantaje";
            continue;
          }
          if (plainText.includes("dotari") || plainText.includes("spatiul") || plainText.includes("dotări")) {
            currentSection = "dotari";
            continue;
          }
          if (plainText.includes("locatie") || plainText.includes("locație")) {
            currentSection = "locatie";
            continue;
          }
          
          // Check for endings/dividers to prevent section leaks
          if (trimmed.includes("━━━━━━━━━━━━━━━━━━") || 
              trimmed.startsWith("💰") || 
              trimmed.startsWith("🤝") || 
              trimmed.startsWith("📞") ||
              plainText.includes("suport") || 
              plainText.includes("conditii") || 
              plainText.includes("chirie") ||
              plainText.includes("vanzare") ||
              plainText.includes("vânzare") ||
              plainText.includes("inchiriere")) {
            currentSection = "none";
            continue;
          }
        }
        
        // Parse bullets
        if (isBullet) {
          let bulletText = "";
          if (trimmed.startsWith("-")) {
            bulletText = trimmed.substring(1).trim();
          } else if (trimmed.startsWith("*")) {
            bulletText = trimmed.substring(1).trim();
          } else if (trimmed.startsWith("•")) {
            bulletText = trimmed.substring(1).trim();
          }
          
          if (bulletText) {
            if (currentSection === "avantaje") {
              avantajeList.push(bulletText);
            } else if (currentSection === "dotari") {
              dotariList.push(bulletText);
            } else if (currentSection === "locatie") {
              locatieList.push(bulletText);
            }
          }
        }
      }
      
      return { avantajeList, dotariList, locatieList };
    };

    const parsedData = parseDescriptionSections(fullCRMData?.descriere?.continut || "");

    // 1. Resolved Advantages
    resolvedAdv = parsedData.avantajeList.slice(0, 5);
    if (resolvedAdv.length === 0) {
      resolvedAdv = promoAvantaje.slice(0, 5);
    }

    // 2. Resolved Dotari (Amenities/Characteristics - prioritizing parsed bullets then numerical data)
    const numCharacteristics: string[] = [];
    if (sUtila) numCharacteristics.push(`${sUtila} mp utili`);
    if (sCamere) numCharacteristics.push(`${sCamere} camere`);
    if (sEtaj) numCharacteristics.push(`etaj ${sEtaj}`);
    if (sBalcoane && Number(sBalcoane) > 0) numCharacteristics.push(`balcon: ${sBalcoane} mp`);
    if (sTerase && Number(sTerase) > 0) numCharacteristics.push(`terasă: ${sTerase} mp`);
    if (sAn) numCharacteristics.push(`an constructie: ${sAn}`);

    resolvedDot = parsedData.dotariList.slice(0, 5);
    if (resolvedDot.length === 0) {
      resolvedDot = [...numCharacteristics, ...promoCaracteristici].filter(Boolean).slice(0, 5);
    }

    // 3. Resolved Locatie
    const genericLocProps: string[] = [];
    if (zonaStr) genericLocProps.push(`Zona ${zonaStr}`);
    if (orasStr) genericLocProps.push(`Orasul ${orasStr}`);
    if (hasKeywords(["metrou", "statia de metrou", "m-"])) genericLocProps.push("Acces rapid la stația de metrou");
    if (hasKeywords(["parc", "gradina publica", "verde"])) genericLocProps.push("Aproape de parc și zone verzi");
    if (hasKeywords(["transport", "stb", "autobuz", "tramvai"])) genericLocProps.push("Conexiuni excelente transport");
    if (hasKeywords(["mall", "hypermarket", "mega image", "lidl"])) genericLocProps.push("Facilități comerciale în apropiere");

    resolvedLoc = parsedData.locatieList.slice(0, 5);
    if (resolvedLoc.length === 0) {
      resolvedLoc = genericLocProps.slice(0, 5);
    }
    if (resolvedLoc.length === 0) {
      resolvedLoc = [
        "Acces rapid la transportul public",
        "Conexiune excelentă cu zonele de interes",
        "Amplasare convenabilă",
        "Infrastructură de încredere",
        "Vecinătate sigură"
      ];
    }
  }

  // Double safety fallbacks for empty fullCRMData state
  if (resolvedAdv.length === 0) {
    resolvedAdv = [
      "Confort deosebit în viața de zi cu zi",
      "Amplasament convenabil de interes sporit",
      "Zonă rezidențială liniștită și sigură",
      "Orientare excelentă cu lumină din plin",
      "Investiție imobiliară sigură cu randament bun"
    ];
  }
  if (resolvedDot.length === 0) {
    resolvedDot = [
      "Finisaje de calitate superioară",
      "Centrală termică proprie instalată",
      "Compartimentare optimizată inteligent",
      "Spații de depozitare suficiente",
      "Ferestre mari cu eficiență termică"
    ];
  }
  if (resolvedLoc.length === 0) {
    resolvedLoc = [
      "Acces rapid către stații de transport public",
      "Proximitate de școli, parcuri și zone comerciale",
      "Zonă deschisă ușor accesibilă auto",
      "Aproape de supermarket-uri și farmacii",
      "Cartier liniștit cu infrastructură urbană modernă"
    ];
  }


  // Find the most appropriate candidate photo for the background based on specified priorities:
  // 1. Priority 1: Garden, terrace, house/villa overview, shop (detected by keywords)
  // 2. Priority 2: Living room or main hall (living)
  // 3. Priority 3: Kitchen (bucatarie)
  // 4. Priority 4: Bedroom (camera)
  // 5. Priority 5: Other spaces (alteSpatii)
  let firstImage = "";
  
  const isLogoOrTextUrl = (url?: string): boolean => {
    if (!url) return false;
    const lower = url.toLowerCase();
    // Exempt known real estate property photo CDNs from watermark/promo keyword filtering
    if (
      lower.includes("roamcdn.net") || 
      lower.includes("apollo.olxcdn.com") || 
      lower.includes("olxcdn.com") || 
      lower.includes("akamaized.net") ||
      lower.includes("pstatic.ro") ||
      lower.includes("pcdnh")
    ) {
      return false;
    }
    // Exclude watermarks, logos, plans, schematics, banners, text and templates
    return lower.includes("logo") || 
           lower.includes("watermark") || 
           lower.includes("banner") || 
           lower.includes("avatar") || 
           lower.includes("placeholder") || 
           lower.includes("icon") ||
           lower.includes("schita") || 
           lower.includes("plan") || 
           lower.includes("schiță") ||
           lower.includes("text") ||
           lower.includes("sigla") ||
           lower.includes("siglă") ||
           lower.includes("promo") ||
           lower.includes("grafic") ||
           lower.includes("desen") ||
           lower.includes("document") ||
           lower.includes("pdf") ||
           lower.includes(".gif") ||
           lower.includes("brand") ||
           lower.includes("afis") ||
           lower.includes("afiș") ||
           lower.includes("anunt") ||
           lower.includes("anunț") ||
           lower.includes("titlu") ||
           lower.includes("title");
  };

  const isPriority1Keyword = (url: string): boolean => {
    const lower = url.toLowerCase();
    const keywords = [
      "gradina", "garden", "terasa", "terace", "terrace", 
      "curte", "yard", "exterior", "ansamblu", "vila", "villa", 
      "casa", "house", "magazin", "shop", "store", "front", 
      "fatada", "facade", "cladire", "building", "spatiu", "space", 
      "street", "drone", "drona", "overview", "panoramica", "vedere", 
      "outdoor", "outdoors", "fațadă", "clădire", "spațiu", "fațada"
    ];
    return keywords.some(keyword => lower.includes(keyword));
  };

  const cleanByCat: Record<string, string[]> = {
    living: [],
    bucatarie: [],
    camera: [],
    baie: [],
    alteSpatii: []
  };

  const categoriesExtractList = ['living', 'bucatarie', 'camera', 'baie', 'alteSpatii'] as const;
  for (const cat of categoriesExtractList) {
    const list = safeData[cat] || [];
    for (const img of list) {
      if (img?.original && !isLogoOrTextUrl(img.original)) {
        cleanByCat[cat].push(img.original);
      }
    }
  }

  // Phase 1: Search for any Priority 1 Keyword matched image (preferring alteSpatii first, then looking everywhere else)
  if (!firstImage) {
    for (const imgUrl of cleanByCat.alteSpatii) {
      if (isPriority1Keyword(imgUrl)) {
        firstImage = imgUrl;
        break;
      }
    }
  }

  if (!firstImage) {
    for (const cat of ['living', 'bucatarie', 'camera', 'baie'] as const) {
      for (const imgUrl of cleanByCat[cat]) {
        if (isPriority1Keyword(imgUrl)) {
          firstImage = imgUrl;
          break;
        }
      }
      if (firstImage) break;
    }
  }

  // Phase 2: Priority #2 - Living Room or Main Hall (living)
  if (!firstImage && cleanByCat.living.length > 0) {
    firstImage = cleanByCat.living[0];
  }

  // Phase 3: Priority #3 - Kitchen (bucatarie)
  if (!firstImage && cleanByCat.bucatarie.length > 0) {
    firstImage = cleanByCat.bucatarie[0];
  }

  // Phase 4: Priority #4 - Bedroom (camera)
  if (!firstImage && cleanByCat.camera.length > 0) {
    firstImage = cleanByCat.camera[0];
  }

  // Phase 5: Priority #5 - Other spaces (alteSpatii)
  if (!firstImage && cleanByCat.alteSpatii.length > 0) {
    firstImage = cleanByCat.alteSpatii[0];
  }

  // Phase 6: Final Fallback - Bathroom (baie)
  if (!firstImage && cleanByCat.baie.length > 0) {
    firstImage = cleanByCat.baie[0];
  }

  // Phase 7: Absolute raw fallback if everything else is empty
  if (!firstImage) {
    for (const cat of categoriesExtractList) {
      const list = safeData[cat] || [];
      for (const img of list) {
        if (img?.original) {
          firstImage = img.original;
          break;
        }
      }
      if (firstImage) break;
    }
  }

  // Set default fallback empty string
  if (!firstImage) {
    firstImage = "";
  }

  const categoryTitles: Record<string, string> = {
    living: 'Living',
    bucatarie: 'Bucătărie',
    camera: 'Dormitor / Cameră',
    baie: 'Baie',
    alteSpatii: 'Alte Spații / Inbox Fotografii'
  };

  const categoriesConfig: { id: 'living' | 'bucatarie' | 'camera' | 'baie' | 'alteSpatii'; label: string; icon: string }[] = [
    { id: 'living', label: 'Living', icon: '🛋️' },
    { id: 'bucatarie', label: 'Bucătărie', icon: '🍳' },
    { id: 'camera', label: 'Dormitor / Cameră', icon: '🛏️' },
    { id: 'baie', label: 'Baie', icon: '🚿' },
    { id: 'alteSpatii', label: 'Alte Spații / Inbox Fotografii', icon: '📁' },
  ];

  const handleMoveImage = (imageUrl: string, fromCat: string, toCat: string) => {
    if (fromCat === toCat) return;
    const currentImagini: Record<string, { original: string }[]> = {
      living: [...(safeData.living || [])],
      bucatarie: [...(safeData.bucatarie || [])],
      camera: [...(safeData.camera || [])],
      baie: [...(safeData.baie || [])],
      alteSpatii: [...(safeData.alteSpatii || [])]
    };

    const fromArr = currentImagini[fromCat] || [];
    const idx = fromArr.findIndex(i => i.original === imageUrl);
    if (idx === -1) return;

    const [item] = fromArr.splice(idx, 1);
    (currentImagini[toCat] ||= []).push(item);

    onUpdate?.('crmData.imagini', currentImagini);
    toast.success(`Imagine mutată în ${categoryTitles[toCat] || toCat}`);
  };

  return (
    <div className="space-y-4">
      {/* Information Header */}
      <div className="bg-blue-50/60 border border-blue-200/80 rounded-lg p-3 flex items-center justify-between gap-4 text-xs text-blue-900">
        <div className="flex items-center gap-2">
          <ArrowRightLeft size={16} className="text-blue-600 shrink-0" />
          <span>
            Clasificare manuală: fotografiile extrase sunt în <strong>Alte Spații / Inbox Fotografii</strong>. Poți selecta slotul dorit (Living, Bucătărie, Dormitor, Baie) din bara de control a fiecărei fotografii.
          </span>
        </div>
      </div>

      {categoriesConfig.map((cat) => {
        const images = safeData[cat.id] || [];
        
        return (
          <div key={cat.id} className="p-4 bg-gray-50/50 rounded-xl border border-gray-200/80 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-base">{cat.icon}</span>
                <h4 className="font-title text-xs font-semibold text-gray-900 uppercase tracking-wider">
                  {cat.label}
                </h4>
                <span className="text-[11px] font-sans px-2 py-1 rounded-full bg-white border border-gray-200 text-gray-600 font-normal">
                  {images.length} {images.length === 1 ? 'poză' : 'poze'}
                </span>
              </div>
              
              {images.length > 0 && (
                <button 
                  onClick={() => downloadAllInCategory(images, cat.id)}
                  className="flex items-center gap-2 h-8 text-[11px] font-semibold text-gray-700 bg-white border border-gray-200 hover:bg-gray-100 px-3 rounded-md transition-colors shadow-2xs"
                >
                  <Download size={13} />
                  DESCARCĂ TOT ({images.length})
                </button>
              )}
            </div>
            
            {images.length === 0 ? (
              <div className="py-5 px-4 border border-dashed border-gray-300 rounded-lg text-center bg-white/60">
                <p className="text-xs font-medium text-gray-500">Slot gol: {cat.label}</p>
                <p className="text-[11px] text-gray-400 mt-1">
                  Folosește selectorul „Slot” de pe o fotografie din alte secțiuni pentru a o muta aici.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {images.map((imageData: { original: string }, idx: number) => (
                  <ImageCard 
                    key={idx} 
                    imageData={imageData} 
                    category={cat.id}
                    onMoveCategory={(targetCat) => handleMoveImage(imageData.original, cat.id, targetCat)}
                    onClick={() => {
                      const proxied = getCleanDisplayImageUrl(imageData.original);
                      window.open(proxied, '_blank');
                    }}
                    noHoverEffect
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Sectiunea Promo ca ultima sectiune sub imagini */}
      {firstImage && (
        <div className="border-t border-[--color-border] pt-8 mt-8">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-title text-[14px] font-semibold text-[--color-text-main] uppercase tracking-wider flex items-center gap-2">
              PROMO LANDING CARD
            </h4>
            <button 
              onClick={() => {
                 const a = document.createElement('a');
                 a.href = generatedPromoUrl || firstImage;
                 a.download = `promo-img.png`;
                 a.click();
              }}
              className="flex items-center gap-2 h-10 text-[12px] font-semibold text-[--color-text-main] border border-[--color-border] hover:bg-gray-50 px-5 rounded-full transition-colors shadow-none"
            >
              <Download size={14} />
              DESCARCĂ IMAGINE PROMO
            </button>
          </div>
          
          <div className="w-full">
            <PromoCard 
              bgImage={firstImage} 
              avantaje={resolvedAdv}
              dotari={resolvedDot}
              locatie={resolvedLoc}
              phone={promoPhone}
              propertyId={propertyId}
              titleText={dynamicTitle}
              onGenerated={setGeneratedPromoUrl}
              onClick={() => {
                const a = document.createElement('a');
                a.href = generatedPromoUrl || firstImage;
                a.download = 'promo-img.png';
                a.click();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
