import React, { useState, useEffect, useRef, useMemo } from "react";
import { 
  Plus, 
  Bell, 
  Calendar, 
  ChevronDown, 
  Building2, 
  ClipboardList, 
  Search, 
  X, 
  Users, 
  UserCheck, 
  Inbox, 
  FileText, 
  Compass, 
  UserPlus 
} from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { leadsService, Lead, isCerereLead } from "../services/leadsService";
import { contactsService, Contact } from "../services/contactsService";
import { personalService, PersonalMember } from "../services/personalService";
import { documentService, DocumentItem } from "../services/documentService";
import { activityService, Activity } from "../services/activityService";
import { tourService, Tour } from "../services/tourService";
import { AICallModal } from "./AICall";
import { ProfileDrawer } from "./ProfileDrawer";
import { ProfileModal } from "./ProfileModal";
import { StatsModal } from "./StatsModal";
import { auth } from "../lib/firebase";
import { onAuthStateChanged } from "firebase/auth";

interface HeaderProps {
  onAddClick?: () => void;
  onAddLeadClick?: () => void;
  onAddCerereClick?: () => void;
  onAddContactClick?: () => void;
  onAddClientClick?: () => void;
  onAddPersonalClick?: () => void;
  onAddStaffClick?: () => void;
  onAddDocumentClick?: () => void;
  onAddTourClick?: () => void;
  onAddActivityClick?: () => void;
  onCalendarClick?: () => void;
  onNotificationsClick: () => void;
  onExtractionRulesClick?: () => void;
  onSelectLead?: (lead: Lead) => void;
  onSelectContact?: (contact: Contact) => void;
  onSelectPersonal?: (member: PersonalMember) => void;
  onSelectDocument?: (doc: DocumentItem) => void;
  onSelectTour?: (tour: Tour) => void;
  onSelectActivity?: (activity: Activity) => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
}

export const Header: React.FC<HeaderProps> = ({ 
  onAddClick, 
  onAddLeadClick,
  onAddCerereClick,
  onAddContactClick,
  onAddClientClick,
  onAddPersonalClick,
  onAddStaffClick,
  onAddDocumentClick,
  onAddTourClick,
  onAddActivityClick,
  onCalendarClick,
  onNotificationsClick,
  onSelectLead,
  onSelectContact,
  onSelectPersonal,
  onSelectDocument,
  onSelectTour,
  onSelectActivity,
  searchQuery = "",
  onSearchChange
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const isCalendar = location.pathname === '/calendar';

  // User Profile state
  const [currentUser, setCurrentUser] = useState<any>(auth.currentUser);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setCurrentUser(u);
    });
    return () => unsub();
  }, []);

  const userName = currentUser?.displayName || (currentUser?.email ? currentUser.email.split('@')[0] : 'Alexandru Radu');
  const userRole = 'Broker Principal';
  const userPhoto = currentUser?.photoURL;

  // Profile Drawer and Modals state
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isProfileDrawerOpen, setIsProfileDrawerOpen] = useState(false);
  const [isStatsModalOpen, setIsStatsModalOpen] = useState(false);

  // Search state
  const [localQuery, setLocalQuery] = useState(searchQuery);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  const [allLeads, setAllLeads] = useState<Lead[]>([]);
  const [allContacts, setAllContacts] = useState<Contact[]>([]);
  const [allPersonal, setAllPersonal] = useState<PersonalMember[]>([]);
  const [allDocuments, setAllDocuments] = useState<DocumentItem[]>([]);
  const [allActivities, setAllActivities] = useState<Activity[]>([]);

  // Subscribe to live data for the search engine across all entity types
  useEffect(() => {
    const unsubLeads = leadsService.subscribeToLeads((leads) => setAllLeads(leads));
    const unsubContacts = contactsService.subscribeToContacts((contacts) => setAllContacts(contacts));
    const unsubPersonal = personalService.subscribeToPersonal((members) => setAllPersonal(members));
    const unsubDocs = documentService.subscribeToDocuments((docs) => setAllDocuments(docs));
    const unsubActivities = activityService.subscribeToAllActivities((activities) => setAllActivities(activities));

    return () => {
      unsubLeads();
      unsubContacts();
      unsubPersonal();
      unsubDocs();
      unsubActivities();
    };
  }, []);

  // Sync external searchQuery with localQuery
  useEffect(() => {
    setLocalQuery(searchQuery);
  }, [searchQuery]);

  const handleQueryChange = (val: string) => {
    setLocalQuery(val);
    if (onSearchChange) {
      onSearchChange(val);
    }
    setIsSearchOpen(val.trim().length > 0);
  };

  // Click-outside listener for dropdowns
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (searchContainerRef.current && !searchContainerRef.current.contains(target)) {
        setIsSearchOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Compute search results categorized into: Lead-uri, Cereri, Imobile, Clienți, Personal, Documente, Vizionări
  const { 
    matchedProperties = [], 
    matchedLeads = [],
    matchedCereri = [], 
    matchedContacts = [], 
    matchedPersonal = [], 
    matchedDocuments = [], 
    matchedActivities = [], 
    totalResults = 0 
  } = useMemo(() => {
    const q = localQuery.toLowerCase().trim();
    if (!q) {
      return { 
        matchedProperties: [], 
        matchedLeads: [],
        matchedCereri: [], 
        matchedContacts: [], 
        matchedPersonal: [], 
        matchedDocuments: [], 
        matchedActivities: [], 
        totalResults: 0 
      };
    }

    const CERERI_STATUS_ORDER: Record<string, number> = {
      'Noua': 1, 'Calificare': 2, 'Matching': 3, 'Vizionare': 4, 'Ofertare': 5, 'Antecontract': 6, 'Contract': 7
    };

    const LEADS_STATUS_ORDER: Record<string, number> = {
      'Noi': 1, 'Pierdute': 2, 'Nevalidata': 3, 'Calificata': 4
    };

    const PROPRIETATI_STATUS_ORDER: Record<string, number> = {
      'Noua': 1, 'Prospectare': 2, 'Colaborare': 3, 'Vizionare': 4, 'Ofertare': 5, 'Antecontract': 6, 'Contract': 7,
      'Activa': 8, 'InNegociere': 9, 'Finalizata': 10, 'Arhiva': 11, 'Sterse': 12
    };

    // 1. Cereri: All client requests (#R...), sorted by status tab order
    const cereri = allLeads.filter(l => {
      const isCerere = isCerereLead(l);
      if (!isCerere) return false;

      const titleMatch = (l.title || "").toLowerCase().includes(q);
      const nameMatch = (l.ownerName || "").toLowerCase().includes(q);
      const phoneMatch = (l.ownerPhone || "").toLowerCase().includes(q);
      const zoneMatch = (l.zone || "").toLowerCase().includes(q);
      const priceMatch = (l.price || "").toLowerCase().includes(q);
      const notesMatch = (l.notes || "").toLowerCase().includes(q);
      const idMatch = (l.propertyId || "").toLowerCase().includes(q);
      return titleMatch || nameMatch || phoneMatch || zoneMatch || priceMatch || notesMatch || idMatch;
    }).sort((a, b) => {
      const ordA = CERERI_STATUS_ORDER[a.status] || 99;
      const ordB = CERERI_STATUS_ORDER[b.status] || 99;
      return ordA - ordB;
    }).slice(0, 5);

    // 2. Lead-uri: Items in status Noi / Pierdute / Nevalidata / Calificata, sorted by status order
    const leadsList = allLeads.filter(l => {
      if (isCerereLead(l)) return false;
      const isLead = l.status === 'Noi' || l.status === 'Pierdute' || l.status === 'Nevalidata' || l.status === 'Calificata';
      if (!isLead) return false;

      const titleMatch = (l.title || "").toLowerCase().includes(q);
      const zoneMatch = (l.zone || "").toLowerCase().includes(q);
      const priceMatch = (l.price || "").toLowerCase().includes(q);
      const nameMatch = (l.ownerName || "").toLowerCase().includes(q);
      const phoneMatch = (l.ownerPhone || "").toLowerCase().includes(q);
      const idMatch = (l.propertyId || l.id || "").toLowerCase().includes(q);
      const catMatch = (l.categoria || "").toLowerCase().includes(q);
      return titleMatch || zoneMatch || priceMatch || nameMatch || phoneMatch || idMatch || catMatch;
    }).sort((a, b) => {
      const ordA = LEADS_STATUS_ORDER[a.status] || 99;
      const ordB = LEADS_STATUS_ORDER[b.status] || 99;
      return ordA - ordB;
    }).slice(0, 5);

    // 3. Imobile: Portofoliu imobile (Noua, Prospectare, Colaborare, etc.), sorted by status tab order
    const properties = allLeads.filter(l => {
      if (isCerereLead(l)) return false;
      const isLead = l.status === 'Noi' || l.status === 'Pierdute' || l.status === 'Nevalidata' || l.status === 'Calificata';
      if (isLead) return false;

      const titleMatch = (l.title || "").toLowerCase().includes(q);
      const zoneMatch = (l.zone || "").toLowerCase().includes(q);
      const priceMatch = (l.price || "").toLowerCase().includes(q);
      const nameMatch = (l.ownerName || "").toLowerCase().includes(q);
      const phoneMatch = (l.ownerPhone || "").toLowerCase().includes(q);
      const idMatch = (l.propertyId || l.id || "").toLowerCase().includes(q);
      const catMatch = (l.categoria || "").toLowerCase().includes(q);
      return titleMatch || zoneMatch || priceMatch || nameMatch || phoneMatch || idMatch || catMatch;
    }).sort((a, b) => {
      const ordA = PROPRIETATI_STATUS_ORDER[a.status] || 99;
      const ordB = PROPRIETATI_STATUS_ORDER[b.status] || 99;
      return ordA - ordB;
    }).slice(0, 5);

    // 4. Clienți: Contacts list (#C...)
    const contacts = allContacts.filter(c => {
      const fullName = `${c.firstName || ""} ${c.lastName || ""}`.toLowerCase();
      const nameMatch = fullName.includes(q);
      const phoneMatch = (c.phone || "").toLowerCase().includes(q);
      const typeMatch = (c.type || "").toLowerCase().includes(q);
      const propIdMatch = (c.propertyId || "").toLowerCase().includes(q);
      const contactIdMatch = (c.contactId || "").toLowerCase().includes(q);
      return nameMatch || phoneMatch || typeMatch || propIdMatch || contactIdMatch;
    }).slice(0, 5);

    // 5. Personal: Staff list (#S...)
    const personal = allPersonal.filter(p => {
      const nameMatch = (p.name || "").toLowerCase().includes(q);
      const roleMatch = (p.role || "").toLowerCase().includes(q);
      const phoneMatch = (p.phone || "").toLowerCase().includes(q);
      const emailMatch = (p.email || "").toLowerCase().includes(q);
      const zoneMatch = (p.zone || "").toLowerCase().includes(q);
      const idMatch = (p.personalId || "").toLowerCase().includes(q);
      return nameMatch || roleMatch || phoneMatch || emailMatch || zoneMatch || idMatch;
    }).slice(0, 5);

    // 6. Documente: Documents list (#D...)
    const documents = allDocuments.filter(d => {
      const titleMatch = (d.title || "").toLowerCase().includes(q);
      const typeMatch = (d.type || "").toLowerCase().includes(q);
      const propMatch = (d.propertyId || "").toLowerCase().includes(q);
      const clientMatch = (d.clientId || "").toLowerCase().includes(q);
      const idMatch = (d.documentId || "").toLowerCase().includes(q);
      return titleMatch || typeMatch || propMatch || clientMatch || idMatch;
    }).slice(0, 4);

    // 7. Activități / Activities (#A...)
    const activities = allActivities.filter(a => {
      const nameMatch = (a.clientName || "").toLowerCase().includes(q);
      const propMatch = (a.propertyId || "").toLowerCase().includes(q);
      const dateMatch = (a.date || "").toLowerCase().includes(q);
      const staffMatch = (a.staffName || "").toLowerCase().includes(q);
      const typeMatch = (a.type || "").toLowerCase().includes(q);
      const idMatch = ((a.activityId || (a as any).tourId) || "").toLowerCase().includes(q);
      return nameMatch || propMatch || dateMatch || staffMatch || typeMatch || idMatch;
    }).slice(0, 4);

    return {
      matchedProperties: properties,
      matchedLeads: leadsList,
      matchedCereri: cereri,
      matchedContacts: contacts,
      matchedPersonal: personal,
      matchedDocuments: documents,
      matchedActivities: activities,
      totalResults: properties.length + leadsList.length + cereri.length + contacts.length + personal.length + documents.length + activities.length
    };
  }, [allLeads, allContacts, allPersonal, allDocuments, allActivities, localQuery]);

  const handleSelectProperty = (lead: Lead) => {
    setIsSearchOpen(false);
    if (location.pathname !== '/') navigate('/');
    onSelectLead?.(lead);
  };

  const handleSelectContact = (contact: Contact) => {
    setIsSearchOpen(false);
    if (location.pathname !== '/') navigate('/');
    onSelectContact?.(contact);
  };

  const handleSelectPersonal = (member: PersonalMember) => {
    setIsSearchOpen(false);
    if (location.pathname !== '/') navigate('/');
    onSelectPersonal?.(member);
  };

  const handleSelectDocument = (doc: DocumentItem) => {
    setIsSearchOpen(false);
    if (location.pathname !== '/') navigate('/');
    onSelectDocument?.(doc);
  };

  const handleSelectActivity = (activity: Activity) => {
    setIsSearchOpen(false);
    navigate('/calendar');
    if (onSelectActivity) {
      onSelectActivity(activity);
    } else if (onSelectTour) {
      onSelectTour(activity as any);
    }
  };

  const handleAddClientAction = onAddClientClick || onAddContactClick;
  const handleAddStaffAction = onAddStaffClick || onAddPersonalClick;
  const handleAddActivityAction = onAddActivityClick || onAddTourClick;

  return (
    <header className="shrink-0 bg-white border-b border-gray-200 shadow-none relative z-[100] h-[50px]">
      <div className="h-full flex justify-between items-stretch">
        {/* Center section: Global Search Bar */}
        <div className="group flex-1 h-full min-w-0 relative flex items-center bg-white hover:bg-gray-50/60 focus-within:bg-gray-50 transition-colors" ref={searchContainerRef}>
          <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-gray-400 group-focus-within:text-gray-700 group-hover:text-gray-500 transition-colors">
            <Search size={15} className="shrink-0 block" />
          </div>
          <input
            type="text"
            value={localQuery}
            onChange={(e) => handleQueryChange(e.target.value)}
            onFocus={() => {
              if (localQuery.trim().length > 0) {
                setIsSearchOpen(true);
              }
            }}
            placeholder="Caută imobile, cereri, contacte, personal, documente sau vizionări..."
            className="w-full h-full pl-11 pr-10 text-xs leading-[50px] text-gray-900 placeholder:text-gray-400 bg-transparent border-0 focus:outline-none focus:ring-0 font-sans cursor-text"
          />
          {localQuery && (
            <div className="absolute inset-y-0 right-3.5 flex items-center">
              <button
                type="button"
                onClick={() => handleQueryChange("")}
                className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors focus:outline-none cursor-pointer flex items-center justify-center"
                title="Șterge căutarea"
              >
                <X size={14} className="shrink-0 block" />
              </button>
            </div>
          )}

          {/* Instant Search Results Dropdown */}
          {isSearchOpen && localQuery.trim().length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-0 bg-white border border-gray-200 border-t-0 shadow-2xl z-[250] max-h-[480px] overflow-y-auto divide-y divide-gray-100">
              {totalResults === 0 ? (
                <div className="py-8 px-4 text-center text-xs text-gray-500">
                  Niciun rezultat găsit pentru <span className="font-semibold text-gray-800">"{localQuery}"</span>
                </div>
              ) : (
                <>
                  {/* 1. Imobile (#P... / #L...) */}
                  {matchedProperties.length > 0 && (
                    <div>
                      <div className="px-4 py-1.5 bg-gray-50/90 text-[10px] font-bold uppercase tracking-wider text-gray-500 border-b border-gray-100 flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          <Building2 size={12} className="text-gray-400" />
                          Imobile ({matchedProperties.length})
                        </span>
                      </div>
                      <div className="divide-y divide-gray-50">
                        {matchedProperties.map((lead) => (
                          <div
                            key={lead.id}
                            onClick={() => handleSelectProperty(lead)}
                            className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-gray-50/80 transition-colors cursor-pointer text-left select-none"
                          >
                            <div className="flex items-center gap-2.5 min-w-0 pr-3">
                              <div className="w-7 h-7 rounded-md bg-[#BE9662]/10 border border-[#BE9662]/20 text-[#BE9662] flex items-center justify-center shrink-0">
                                <Building2 size={14} />
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs font-semibold text-gray-900 truncate flex items-center gap-1.5">
                                  <span className="truncate">{lead.title || "Proprietate fără titlu"}</span>
                                  {lead.propertyId && (
                                    <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-gray-100 text-gray-700 border border-gray-200 shrink-0">
                                      #{lead.propertyId}
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-gray-500 truncate flex items-center gap-2 mt-0.5">
                                  <span>{lead.zone || "Zonă nespecificată"}</span>
                                  <span>•</span>
                                  <span className="font-mono font-medium text-gray-700">{lead.price}</span>
                                </div>
                              </div>
                            </div>
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded border border-gray-200 bg-gray-50 text-gray-600 shrink-0">
                              {lead.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 2. Cereri (#R...) */}
                  {matchedCereri.length > 0 && (
                    <div>
                      <div className="px-4 py-1.5 bg-amber-50/50 text-[10px] font-bold uppercase tracking-wider text-amber-800 border-b border-amber-100/60 flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          <ClipboardList size={12} className="text-amber-600" />
                          Cereri ({matchedCereri.length})
                        </span>
                      </div>
                      <div className="divide-y divide-gray-50">
                        {matchedCereri.map((cerere) => (
                          <div
                            key={cerere.id}
                            onClick={() => handleSelectProperty(cerere)}
                            className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-amber-50/30 transition-colors cursor-pointer text-left select-none"
                          >
                            <div className="flex items-center gap-2.5 min-w-0 pr-3">
                              <div className="w-7 h-7 rounded-md bg-amber-100/60 border border-amber-200 text-amber-700 flex items-center justify-center shrink-0">
                                <ClipboardList size={14} />
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs font-semibold text-gray-900 truncate flex items-center gap-1.5">
                                  <span className="truncate">{cerere.title || "Cerere fără titlu"}</span>
                                  {cerere.propertyId && (
                                    <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-amber-100 text-amber-800 border border-amber-200 shrink-0">
                                      #{cerere.propertyId}
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-gray-500 truncate flex items-center gap-2 mt-0.5">
                                  <span>Client: {cerere.ownerName || "Nespecificat"}</span>
                                  <span>•</span>
                                  <span>Buget: {cerere.price}</span>
                                </div>
                              </div>
                            </div>
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-700 shrink-0">
                              {cerere.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 3. Lead-uri (#L...) */}
                  {matchedLeads.length > 0 && (
                    <div>
                      <div className="px-4 py-1.5 bg-emerald-50/50 text-[10px] font-bold uppercase tracking-wider text-emerald-800 border-b border-emerald-100/60 flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          <Inbox size={12} className="text-emerald-600" />
                          Lead-uri ({matchedLeads.length})
                        </span>
                      </div>
                      <div className="divide-y divide-gray-50">
                        {matchedLeads.map((lead) => (
                          <div
                            key={lead.id}
                            onClick={() => handleSelectProperty(lead)}
                            className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-emerald-50/30 transition-colors cursor-pointer text-left select-none"
                          >
                            <div className="flex items-center gap-2.5 min-w-0 pr-3">
                              <div className="w-7 h-7 rounded-md bg-emerald-100/60 border border-emerald-200 text-emerald-700 flex items-center justify-center shrink-0">
                                <Inbox size={14} />
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs font-semibold text-gray-900 truncate flex items-center gap-1.5">
                                  <span className="truncate">{lead.title || "Lead fără titlu"}</span>
                                  {lead.propertyId && (
                                    <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-emerald-100 text-emerald-800 border border-emerald-200 shrink-0">
                                      #{lead.propertyId}
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-gray-500 truncate flex items-center gap-2 mt-0.5">
                                  <span>{lead.zone || "Zonă nespecificată"}</span>
                                  <span>•</span>
                                  <span>{lead.price}</span>
                                </div>
                              </div>
                            </div>
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-700 shrink-0">
                              {lead.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 3. Contacte (#C...) */}
                  {matchedContacts.length > 0 && (
                    <div>
                      <div className="px-4 py-1.5 bg-emerald-50/40 text-[10px] font-bold uppercase tracking-wider text-emerald-800 border-b border-emerald-100/60 flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          <Users size={12} className="text-emerald-600" />
                          Contacte ({matchedContacts.length})
                        </span>
                      </div>
                      <div className="divide-y divide-gray-50">
                        {matchedContacts.map((contact, idx) => (
                          <div
                            key={contact.id || idx}
                            onClick={() => handleSelectContact(contact)}
                            className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-emerald-50/30 transition-colors cursor-pointer text-left select-none"
                          >
                            <div className="flex items-center gap-2.5 min-w-0 pr-3">
                              <div className="w-7 h-7 rounded-md bg-emerald-50 border border-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                                <Users size={14} />
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs font-semibold text-gray-900 truncate flex items-center gap-1.5">
                                  <span className="truncate">{contact.firstName} {contact.lastName}</span>
                                  {contact.contactId && (
                                    <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-emerald-100 text-emerald-800 border border-emerald-200 shrink-0">
                                      #{contact.contactId}
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-gray-500 truncate flex items-center gap-2 mt-0.5">
                                  <span className="font-mono">{contact.phone}</span>
                                </div>
                              </div>
                            </div>
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-700 shrink-0">
                              {contact.type}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 4. Personal (#S...) */}
                  {matchedPersonal.length > 0 && (
                    <div>
                      <div className="px-4 py-1.5 bg-[#BE9662]/10 text-[10px] font-bold uppercase tracking-wider text-[#051D35] border-b border-[#BE9662]/20 flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          <UserCheck size={12} className="text-[#BE9662]" />
                          Personal & Echipă ({matchedPersonal.length})
                        </span>
                      </div>
                      <div className="divide-y divide-gray-50">
                        {matchedPersonal.map((member, idx) => (
                          <div
                            key={member.id || idx}
                            onClick={() => handleSelectPersonal(member)}
                            className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-[#BE9662]/5 transition-colors cursor-pointer text-left select-none"
                          >
                            <div className="flex items-center gap-2.5 min-w-0 pr-3">
                              <div className="w-7 h-7 rounded-md bg-[#BE9662]/15 border border-[#BE9662]/30 text-[#BE9662] flex items-center justify-center shrink-0">
                                <UserCheck size={14} />
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs font-semibold text-gray-900 truncate flex items-center gap-1.5">
                                  <span className="truncate">{member.name}</span>
                                  {member.personalId && (
                                    <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-[#BE9662]/15 text-[#051D35] border border-[#BE9662]/30 shrink-0">
                                      #{member.personalId}
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-gray-500 truncate flex items-center gap-2 mt-0.5">
                                  <span className="font-medium text-gray-700">{member.role}</span>
                                  <span>•</span>
                                  <span className="font-mono">{member.phone}</span>
                                </div>
                              </div>
                            </div>
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-700 shrink-0">
                              {member.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 5. Documente (#D...) */}
                  {matchedDocuments.length > 0 && (
                    <div>
                      <div className="px-4 py-1.5 bg-blue-50/50 text-[10px] font-bold uppercase tracking-wider text-blue-800 border-b border-blue-100/60 flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          <FileText size={12} className="text-blue-600" />
                          Documente ({matchedDocuments.length})
                        </span>
                      </div>
                      <div className="divide-y divide-gray-50">
                        {matchedDocuments.map((doc, idx) => (
                          <div
                            key={doc.id || idx}
                            onClick={() => handleSelectDocument(doc)}
                            className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-blue-50/30 transition-colors cursor-pointer text-left select-none"
                          >
                            <div className="flex items-center gap-2.5 min-w-0 pr-3">
                              <div className="w-7 h-7 rounded-md bg-blue-100/60 border border-blue-200 text-blue-700 flex items-center justify-center shrink-0">
                                <FileText size={14} />
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs font-semibold text-gray-900 truncate flex items-center gap-1.5">
                                  <span className="truncate">{doc.title}</span>
                                  {doc.documentId && (
                                    <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-blue-100 text-blue-800 border border-blue-200 shrink-0">
                                      #{doc.documentId}
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-gray-500 truncate flex items-center gap-2 mt-0.5">
                                  <span className="font-medium text-gray-700">{doc.type}</span>
                                  {doc.propertyId && (
                                    <>
                                      <span>•</span>
                                      <span>Proprietate: #{doc.propertyId}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded border border-blue-200 bg-blue-50 text-blue-700 shrink-0">
                              Document
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 6. Activități (#A...) */}
                  {matchedActivities.length > 0 && (
                    <div>
                      <div className="px-4 py-1.5 bg-[#051D35]/5 text-[10px] font-bold uppercase tracking-wider text-[#051D35] border-b border-gray-100 flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          <Compass size={12} className="text-[#BE9662]" />
                          Activități ({matchedActivities.length})
                        </span>
                      </div>
                      <div className="divide-y divide-gray-50">
                        {matchedActivities.map((act, idx) => {
                          const displayId = act.activityId || (act as any).tourId;
                          return (
                            <div
                              key={act.id || idx}
                              onClick={() => handleSelectActivity(act)}
                              className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-[#051D35]/5 transition-colors cursor-pointer text-left select-none"
                            >
                              <div className="flex items-center gap-2.5 min-w-0 pr-3">
                                <div className="w-7 h-7 rounded-md bg-[#BE9662]/15 border border-[#BE9662]/30 text-[#BE9662] flex items-center justify-center shrink-0">
                                  <Compass size={14} />
                                </div>
                                <div className="min-w-0">
                                  <div className="text-xs font-semibold text-gray-900 truncate flex items-center gap-1.5">
                                    <span className="truncate">{act.clientName}</span>
                                    {displayId && (
                                      <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-[#BE9662]/15 text-[#051D35] border border-[#BE9662]/30 shrink-0">
                                        #{displayId}
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-gray-500 truncate flex items-center gap-2 mt-0.5">
                                    <span>{act.date} {act.hour}</span>
                                    {act.propertyId && (
                                      <>
                                        <span>•</span>
                                        <span>Prop: #{act.propertyId}</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded border border-[#BE9662]/30 bg-[#BE9662]/10 text-[#051D35] shrink-0">
                                {act.type || "Activitate"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
   
        {/* Right actions */}
        <div className="flex items-stretch h-full shrink-0">
          {/* Calendar */}
          <button 
            type="button"
            onClick={onCalendarClick || (() => navigate('/calendar'))}
            className={`h-full w-[50px] aspect-square flex items-center justify-center border-l border-gray-200 transition-colors cursor-pointer select-none focus:outline-none shrink-0 ${
              isCalendar 
                ? 'bg-gray-100 text-gray-900 font-semibold' 
                : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900'
            }`}
            title="Calendar Activități"
          >
            <Calendar size={16} className="shrink-0 block" />
          </button>

          {/* Alerte */}
          <button 
            type="button"
            onClick={onNotificationsClick}
            className="h-full w-[50px] aspect-square flex items-center justify-center border-l border-gray-200 hover:bg-gray-50 text-gray-600 hover:text-[#051D35] transition-colors relative cursor-pointer select-none shrink-0 focus:outline-none"
            title="Alerte și Notificări"
          >
            <div className="w-2 h-2 bg-[#BE9662] rounded-full absolute top-[13px] right-[13px] border border-white" />
            <Bell size={16} className="shrink-0 block" />
          </button>
  
          {/* User Profile Split Button */}
          <div className="h-full flex items-stretch border-l border-gray-200 shrink-0 select-none">
            {/* Main Button: Avatar + Name + Role -> Opens Profile Modal */}
            <button
              type="button"
              onClick={() => setIsProfileModalOpen(true)}
              className="h-full px-3.5 flex items-center gap-2.5 hover:bg-gray-50 transition-colors text-left focus:outline-none cursor-pointer group"
              title="Deschide Profilul Meu"
            >
              {/* Profile Picture */}
              <div className="w-8 h-8 rounded-lg bg-[#051D35]/5 border border-[#051D35]/15 group-hover:border-[#BE9662]/40 flex items-center justify-center overflow-hidden shrink-0 shadow-2xs transition-colors">
                {userPhoto ? (
                  <img 
                    src={userPhoto} 
                    alt={userName} 
                    className="w-full h-full object-cover" 
                  />
                ) : (
                  <span className="text-xs font-bold text-[#051D35]">
                    {userName.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>

              {/* Name & Role (matching style from Clients header: title + description under it) */}
              <div className="flex flex-col justify-center min-w-0">
                <span className="text-[13px] font-semibold tracking-tight text-gray-900 group-hover:text-[#051D35] leading-tight truncate max-w-[130px]">
                  {userName}
                </span>
                <span className="text-[10px] text-gray-500 font-medium leading-tight truncate mt-0.5">
                  {userRole}
                </span>
              </div>
            </button>

            {/* Split Divider */}
            <div className="w-px h-6 bg-gray-200 self-center" />

            {/* Split Trigger Button (Chevron) -> Opens Drawer with Profile, My Stats, Log out */}
            <button
              type="button"
              onClick={() => setIsProfileDrawerOpen(true)}
              className="h-full px-2.5 flex items-center justify-center hover:bg-gray-50 text-gray-500 hover:text-gray-900 transition-colors focus:outline-none cursor-pointer"
              title="Meniu profil & statistici"
            >
              <ChevronDown size={14} className="shrink-0 transition-transform duration-200" />
            </button>
          </div>
        </div>
      </div>
      <AICallModal />
      <ProfileDrawer 
        isOpen={isProfileDrawerOpen}
        onClose={() => setIsProfileDrawerOpen(false)}
        onOpenProfile={() => setIsProfileModalOpen(true)}
        onOpenStats={() => setIsStatsModalOpen(true)}
      />
      <ProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        onOpenStats={() => setIsStatsModalOpen(true)}
      />
      <StatsModal
        isOpen={isStatsModalOpen}
        onClose={() => setIsStatsModalOpen(false)}
        onOpenProfile={() => setIsProfileModalOpen(true)}
      />
    </header>
  );
};
