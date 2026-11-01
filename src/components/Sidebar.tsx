import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { 
  Building2, 
  ClipboardList, 
  Inbox, 
  PanelLeftClose, 
  Users,
  UserCheck
} from "lucide-react";
import { Lead, isCerereLead } from "../services/leadsService";
import { Contact } from "../services/contactsService";
import { PersonalMember } from "../services/personalService";
import { getCurrentVersion } from "../utils/versionService";

export type NavSubItem = 'Lead-uri' | 'Cereri' | 'Imobile' | 'Proprietăți' | 'Contacte' | 'Clienți' | 'Personal';
export type NavTransactionType = 'Închiriere' | 'Vânzare';

interface SidebarProps {
  activeType?: NavTransactionType | 'Toate';
  activeSubItem?: NavSubItem;
  onSelectItem?: (subItem: NavSubItem) => void;
  onSelectNav?: (type: any, subItem: NavSubItem) => void;
  leads?: Lead[];
  contacts?: Contact[];
  personal?: PersonalMember[];
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeSubItem,
  onSelectItem,
  onSelectNav,
  leads = [],
  contacts = [],
  personal = [],
  isCollapsed: controlledCollapsed,
  onToggleCollapse: controlledToggle
}) => {
  const navigate = useNavigate();
  const location = useLocation();

  // Collapsed state: support controlled or local persistence
  const [internalCollapsed, setInternalCollapsed] = useState(() => {
    return localStorage.getItem('brokr_sidebar_collapsed') === 'true';
  });

  const isCollapsed = controlledCollapsed !== undefined ? controlledCollapsed : internalCollapsed;

  const handleToggleCollapse = () => {
    if (controlledToggle) {
      controlledToggle();
    } else {
      const next = !internalCollapsed;
      setInternalCollapsed(next);
      localStorage.setItem('brokr_sidebar_collapsed', String(next));
    }
  };

  const handleItemClick = (subItem: NavSubItem) => {
    if (location.pathname !== '/') {
      navigate('/');
    }
    const normalizedItem = subItem === 'Proprietăți' ? 'Imobile' : (subItem === 'Clienți' ? 'Contacte' : subItem);
    if (onSelectItem) {
      onSelectItem(normalizedItem);
    } else if (onSelectNav) {
      onSelectNav(undefined, normalizedItem);
    }
  };

  // Compute live item counts based on leads, contacts, and personal
  const counts = React.useMemo(() => {
    const isCerere = (l: Lead) => isCerereLead(l);
    const isLeadItem = (l: Lead) => !isCerere(l) && l.status !== 'Sterse' && (l.status === 'Noi' || l.status === 'Pierdute' || l.status === 'Nevalidata' || l.status === 'Calificata');
    const isPropItem = (l: Lead) => !isCerere(l) && l.status !== 'Nevalidata' && l.status !== 'Calificata' && l.status !== 'Noi' && l.status !== 'Pierdute' && l.status !== 'Sterse';

    return {
      leads: leads.filter(isLeadItem).length,
      cereri: leads.filter(isCerere).length,
      proprietati: leads.filter(isPropItem).length,
      clienti: contacts.length,
      personal: personal.length
    };
  }, [leads, contacts, personal]);

  const isImobileActive = activeSubItem === 'Imobile' || activeSubItem === 'Proprietăți';
  const isContacteActive = activeSubItem === 'Contacte' || activeSubItem === 'Clienți';
  const versionInfo = getCurrentVersion();

  return (
    <aside 
      className={`shrink-0 h-full bg-white border-r border-gray-200 flex flex-col select-none transition-[width] duration-200 ease-in-out relative z-30 ${
        isCollapsed ? 'w-[56px]' : 'w-[230px]'
      }`}
    >
      {/* Top Header Box (Height matches the main top header: exact h-[50px]) */}
      <div className="h-[50px] shrink-0 border-b border-gray-200 bg-white flex items-center justify-between px-3.5">
        {!isCollapsed ? (
          <>
            <div 
              onClick={() => navigate('/')}
              className="flex items-center cursor-pointer select-none group"
              title="Acasă - brokr"
            >
              <span className="text-[22px] font-bold tracking-tight text-[#051D35] font-sans leading-none flex items-center">
                brokr<span className="text-[#BE9662]">.</span>
              </span>
            </div>

            <button 
              type="button"
              onClick={handleToggleCollapse}
              className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors cursor-pointer focus:outline-none"
              title="Restrânge meniul"
            >
              <PanelLeftClose size={15} />
            </button>
          </>
        ) : (
          <div className="w-full flex items-center justify-center">
            {/* Collapsed logo: smaller version on white background without color switching */}
            <button 
              type="button"
              onClick={handleToggleCollapse}
              className="w-9 h-9 rounded-md flex items-center justify-center bg-white hover:bg-gray-100 transition-all cursor-pointer focus:outline-none"
              title="Extinde meniul (brokr)"
            >
              <span className="text-[20px] font-bold tracking-tight text-[#051D35] font-sans leading-none">
                b<span className="text-[#BE9662]">.</span>
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Main navigation container: Lead-uri, Cereri, Imobile, Contacte, Personal */}
      <div className="flex-1 overflow-y-auto no-scrollbar p-0 divide-y divide-gray-100 font-sans">
        {!isCollapsed ? (
          <>
            {/* Lead-uri */}
            <button
              type="button"
              onClick={() => handleItemClick('Lead-uri')}
              className={`w-full h-[50px] px-5 rounded-none flex items-center justify-between transition-colors cursor-pointer select-none text-left font-sans ${
                activeSubItem === 'Lead-uri' && location.pathname !== '/calendar'
                  ? 'bg-gray-100 text-gray-900 font-semibold border-l-4 border-l-[#BE9662]'
                  : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900 border-l-4 border-l-transparent'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <Inbox size={18} className={activeSubItem === 'Lead-uri' && location.pathname !== '/calendar' ? 'text-[#BE9662]' : 'text-gray-500'} />
                <span className="text-[13px] font-sans font-medium truncate">Lead-uri</span>
              </div>
              {counts.leads > 0 && (
                <span className={`text-[11px] font-mono px-2 py-0.5 rounded font-semibold ${
                  activeSubItem === 'Lead-uri' && location.pathname !== '/calendar' ? 'bg-white border border-gray-200 text-[#051D35]' : 'bg-gray-100 text-gray-600'
                }`}>
                  {counts.leads}
                </span>
              )}
            </button>

            {/* Cereri */}
            <button
              type="button"
              onClick={() => handleItemClick('Cereri')}
              className={`w-full h-[50px] px-5 rounded-none flex items-center justify-between transition-colors cursor-pointer select-none text-left font-sans ${
                activeSubItem === 'Cereri' && location.pathname !== '/calendar'
                  ? 'bg-gray-100 text-gray-900 font-semibold border-l-4 border-l-[#BE9662]'
                  : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900 border-l-4 border-l-transparent'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <ClipboardList size={18} className={activeSubItem === 'Cereri' && location.pathname !== '/calendar' ? 'text-[#BE9662]' : 'text-gray-500'} />
                <span className="text-[13px] font-sans font-medium truncate">Cereri</span>
              </div>
              {counts.cereri > 0 && (
                <span className={`text-[11px] font-mono px-2 py-0.5 rounded font-semibold ${
                  activeSubItem === 'Cereri' && location.pathname !== '/calendar' ? 'bg-white border border-gray-200 text-[#051D35]' : 'bg-gray-100 text-gray-600'
                }`}>
                  {counts.cereri}
                </span>
              )}
            </button>

            {/* Imobile */}
            <button
              type="button"
              onClick={() => handleItemClick('Imobile')}
              className={`w-full h-[50px] px-5 rounded-none flex items-center justify-between transition-colors cursor-pointer select-none text-left font-sans ${
                isImobileActive && location.pathname !== '/calendar'
                  ? 'bg-gray-100 text-gray-900 font-semibold border-l-4 border-l-[#BE9662]'
                  : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900 border-l-4 border-l-transparent'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <Building2 size={18} className={isImobileActive && location.pathname !== '/calendar' ? 'text-[#BE9662]' : 'text-gray-500'} />
                <span className="text-[13px] font-sans font-medium truncate">Imobile</span>
              </div>
              {counts.proprietati > 0 && (
                <span className={`text-[11px] font-mono px-2 py-0.5 rounded font-semibold ${
                  isImobileActive && location.pathname !== '/calendar' ? 'bg-white border border-gray-200 text-[#051D35]' : 'bg-gray-100 text-gray-600'
                }`}>
                  {counts.proprietati}
                </span>
              )}
            </button>

            {/* Contacte */}
            <button
              type="button"
              onClick={() => handleItemClick('Contacte')}
              className={`w-full h-[50px] px-5 rounded-none flex items-center justify-between transition-colors cursor-pointer select-none text-left font-sans ${
                isContacteActive && location.pathname !== '/calendar'
                  ? 'bg-gray-100 text-gray-900 font-semibold border-l-4 border-l-[#BE9662]'
                  : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900 border-l-4 border-l-transparent'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <Users size={18} className={isContacteActive && location.pathname !== '/calendar' ? 'text-[#BE9662]' : 'text-gray-500'} />
                <span className="text-[13px] font-sans font-medium truncate">Contacte</span>
              </div>
              {counts.clienti > 0 && (
                <span className={`text-[11px] font-mono px-2 py-0.5 rounded font-semibold ${
                  isContacteActive && location.pathname !== '/calendar' ? 'bg-white border border-gray-200 text-[#051D35]' : 'bg-gray-100 text-gray-600'
                }`}>
                  {counts.clienti}
                </span>
              )}
            </button>

            {/* Personal */}
            <button
              type="button"
              onClick={() => handleItemClick('Personal')}
              className={`w-full h-[50px] px-5 rounded-none flex items-center justify-between transition-colors cursor-pointer select-none text-left font-sans ${
                activeSubItem === 'Personal' && location.pathname !== '/calendar'
                  ? 'bg-gray-100 text-gray-900 font-semibold border-l-4 border-l-[#BE9662]'
                  : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900 border-l-4 border-l-transparent'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <UserCheck size={18} className={activeSubItem === 'Personal' && location.pathname !== '/calendar' ? 'text-[#BE9662]' : 'text-gray-500'} />
                <span className="text-[13px] font-sans font-medium truncate">Personal</span>
              </div>
              {counts.personal > 0 && (
                <span className={`text-[11px] font-mono px-2 py-0.5 rounded font-semibold ${
                  activeSubItem === 'Personal' && location.pathname !== '/calendar' ? 'bg-white border border-gray-200 text-[#051D35]' : 'bg-gray-100 text-gray-600'
                }`}>
                  {counts.personal}
                </span>
              )}
            </button>
          </>
        ) : (
          /* Collapsed View: 64px full-width icon buttons with border-b */
          <div className="flex flex-col w-full divide-y divide-gray-100 font-sans">
            <button
              type="button"
              onClick={() => handleItemClick('Lead-uri')}
              className={`w-full h-[50px] flex items-center justify-center transition-colors cursor-pointer select-none ${
                activeSubItem === 'Lead-uri' && location.pathname !== '/calendar'
                  ? 'bg-gray-100 text-[#051D35] border-l-4 border-l-[#BE9662]'
                  : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900 border-l-4 border-l-transparent'
              }`}
              title={`Lead-uri (${counts.leads})`}
            >
              <Inbox size={18} />
            </button>
            <button
              type="button"
              onClick={() => handleItemClick('Cereri')}
              className={`w-full h-[50px] flex items-center justify-center transition-colors cursor-pointer select-none ${
                activeSubItem === 'Cereri' && location.pathname !== '/calendar'
                  ? 'bg-gray-100 text-[#051D35] border-l-4 border-l-[#BE9662]'
                  : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900 border-l-4 border-l-transparent'
              }`}
              title={`Cereri (${counts.cereri})`}
            >
              <ClipboardList size={18} />
            </button>
            <button
              type="button"
              onClick={() => handleItemClick('Imobile')}
              className={`w-full h-[50px] flex items-center justify-center transition-colors cursor-pointer select-none ${
                isImobileActive && location.pathname !== '/calendar'
                  ? 'bg-gray-100 text-[#051D35] border-l-4 border-l-[#BE9662]'
                  : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900 border-l-4 border-l-transparent'
              }`}
              title={`Imobile (${counts.proprietati})`}
            >
              <Building2 size={18} />
            </button>
            <button
              type="button"
              onClick={() => handleItemClick('Contacte')}
              className={`w-full h-[50px] flex items-center justify-center transition-colors cursor-pointer select-none ${
                isContacteActive && location.pathname !== '/calendar'
                  ? 'bg-gray-100 text-[#051D35] border-l-4 border-l-[#BE9662]'
                  : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900 border-l-4 border-l-transparent'
              }`}
              title={`Contacte (${counts.clienti})`}
            >
              <Users size={18} />
            </button>
            <button
              type="button"
              onClick={() => handleItemClick('Personal')}
              className={`w-full h-[50px] flex items-center justify-center transition-colors cursor-pointer select-none ${
                activeSubItem === 'Personal' && location.pathname !== '/calendar'
                  ? 'bg-gray-100 text-[#051D35] border-l-4 border-l-[#BE9662]'
                  : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900 border-l-4 border-l-transparent'
              }`}
              title={`Personal (${counts.personal})`}
            >
              <UserCheck size={18} />
            </button>
          </div>
        )}
      </div>

      {/* Bottom Footer: Automated Version & Update Info (replaces collapse button) */}
      <div className="shrink-0 border-t border-gray-200 bg-gray-50/80 select-none">
        {!isCollapsed ? (
          <div className="h-[48px] px-5 flex items-center justify-between gap-2 font-sans">
            <span className="text-[12px] font-sans font-semibold text-gray-800 tracking-tight shrink-0">
              {versionInfo.versionCode} / 145
            </span>
            <span className="text-[11px] text-gray-500 font-sans truncate">
              {versionInfo.dateFormatted}
            </span>
          </div>
        ) : (
          <div 
            className="h-[48px] px-1 flex flex-col items-center justify-center cursor-default font-sans text-center"
            title={`${versionInfo.versionCode} / 145 ${versionInfo.dateFormatted}`}
          >
            <span className="text-[10px] font-sans font-bold text-gray-700 leading-tight">
              v{versionInfo.major}.{versionInfo.minor}
            </span>
            <span className="text-[9px] font-sans text-gray-400 leading-tight mt-0.5">
              /145
            </span>
          </div>
        )}
      </div>
    </aside>
  );
};
