import React from "react";
import { Link } from "react-router-dom";
import { Building, ShieldCheck, ArrowLeft, ArrowRight, Settings, Users, Palette, Info, Bot, CreditCard } from "lucide-react";
import { useTenantContext } from "../../core/tenancy/ctx_tenant";
import { CmpAgencyAdminLayout } from "../../ui/agency/cmp_agency-admin-layout";

export const PgAgencyAdminBoundary: React.FC = () => {
  const { tenant, tenantContext } = useTenantContext();

  return (
    <CmpAgencyAdminLayout title="Panou Administrare Agenție">
      <div className="max-w-5xl mx-auto space-y-4">
        {/* Architectural Separation Notice */}
        <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-2xs space-y-4">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 flex items-center justify-center shrink-0">
              <ShieldCheck size={20} />
            </div>
            <div>
              <h2 className="font-title text-sm font-semibold text-gray-900">
                Spațiul Arhitectural: Administrare Agenție (Agency Administration)
              </h2>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                Acesta este spațiul dedicat proprietarului sau administratorului acestei agenții imobiliare specifice.
                Este complet separat atât de CRM-ul zilnic al brokerilor, cât și de panoul global Super Admin de
                platformă.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 text-xs">
            <div className="p-4 bg-gray-50 border border-gray-200 rounded-md">
              <h3 className="font-title font-semibold text-gray-900 block mb-1">1. Agency CRM (Zilnic)</h3>
              <p className="text-gray-600 text-[11px] leading-relaxed">
                Folosit de brokeri și asistenți pentru prospectare, lead-uri, cereri, proprietăți, contracte și
                extracție AI.
              </p>
              <Link to="/" className="text-indigo-600 hover:text-indigo-800 font-semibold text-[11px] mt-2 inline-flex items-center gap-1">
                <span>Deschide CRM</span>
                <ArrowRight size={11} />
              </Link>
            </div>

            <div className="p-4 bg-indigo-50/70 border border-indigo-200 rounded-md">
              <h3 className="font-title font-semibold text-indigo-950 block mb-1">2. Agency Admin (Curent)</h3>
              <p className="text-indigo-900 text-[11px] leading-relaxed">
                Spațiul proprietarului agenției pentru gestiunea echipei proprii, personalizarea brandului și cotele
                alocate.
              </p>
              <span className="text-[10px] text-indigo-600 font-semibold mt-2 block">
                Faza 5: Personalizare & Setări Agenție
              </span>
            </div>

            <div className="p-4 bg-gray-50 border border-gray-200 rounded-md">
              <h3 className="font-title font-semibold text-gray-900 block mb-1">3. Platform Super Admin</h3>
              <p className="text-gray-600 text-[11px] leading-relaxed">
                Spațiul global al proprietarului SaaS pentru toate agențiile, infrastructură, domenii și audit.
              </p>
              <Link to="/platform" className="text-indigo-600 hover:text-indigo-800 font-semibold text-[11px] mt-2 inline-flex items-center gap-1">
                <span>Panou Super Admin</span>
                <ArrowRight size={11} />
              </Link>
            </div>
          </div>
        </div>

        {/* Agency Summary Block */}
        <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-2xs space-y-4 text-xs">
          <h3 className="font-title text-xs font-semibold text-gray-900 uppercase tracking-wider">
            Informații Agenție Curentă
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-gray-500 font-semibold block text-[11px]">Nume Agenție:</span>
              <span className="font-normal text-gray-900">{tenant?.name}</span>
            </div>
            <div>
              <span className="text-gray-500 font-semibold block text-[11px]">Identificator Tenant:</span>
              <span className="font-sans font-normal text-gray-900">{tenant?.id}</span>
            </div>
            <div>
              <span className="text-gray-500 font-semibold block text-[11px]">Subdomeniu Alocat:</span>
              <span className="font-sans font-normal text-indigo-600">{tenant?.subdomain}.[subdomeniu]</span>
            </div>
            <div>
              <span className="text-gray-500 font-semibold block text-[11px]">Status Abonament:</span>
              <span className="font-normal text-emerald-700 capitalize">{tenant?.status}</span>
            </div>
          </div>

          <div className="pt-3 border-t border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <span className="text-gray-500 text-[11px]">
              Gestiune pachet comercial, cote resurse și configurare asistent AI dedicat agenției.
            </span>
            <div className="flex items-center gap-4">
              <Link
                to="/agency/admin/subscription"
                className="inline-flex items-center gap-1 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded font-semibold text-xs transition-colors"
              >
                <span>Abonament & Cote</span>
                <ArrowRight size={13} />
              </Link>
              <Link
                to="/agency/admin/ai-config"
                className="inline-flex items-center gap-1 px-3 py-2 bg-[#051D35] hover:bg-[#051D35]/90 text-white rounded font-semibold text-xs shadow-2xs transition-colors"
              >
                <span>Asistent AI Agenție</span>
                <ArrowRight size={13} />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </CmpAgencyAdminLayout>
  );
};
