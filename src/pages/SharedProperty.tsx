import React, { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { Lead } from "../services/leadsService";
import { PropertyDetailView } from "../components/PropertyDetailView";
import { PublicContentShield } from "../components/PublicContentShield";
import { Loader2, AlertCircle } from "lucide-react";

export const SharedProperty: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isInspectBlocked, setIsInspectBlocked] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;

    const loadProperty = async () => {
      if (!id) {
        setError("Identificatorul proprietății lipsește.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        // Always load exclusively from the hardened, tokenized public endpoint
        // so private source URLs, exact addresses, owner PII, and raw image URLs never enter the browser.
        const res = await fetch(`/api/public-property/${encodeURIComponent(id)}`, {
          cache: "no-store",
        });
        if (res.ok) {
          const serverLead = await res.json();
          if (isMounted) {
            const sanitizedLead: Lead = {
              ...serverLead,
              ownerName: "",
              ownerPhone: "",
              url: "",
            };
            setLead(sanitizedLead);
            setLoading(false);
            return;
          }
        }

        if (isMounted) {
          setError("Proprietatea nu a fost găsită sau a expirat.");
          setLoading(false);
        }
      } catch (err: any) {
        console.error("[SharedProperty] Failed to load public property:", err);
        if (isMounted) {
          setError("Nu s-au putut încărca datele proprietății.");
          setLoading(false);
        }
      }
    };

    loadProperty();

    return () => {
      isMounted = false;
    };
  }, [id]);

  useEffect(() => {
    // Enable full document and root scrolling + anti-indexing on the public share page
    document.documentElement.classList.add("public-share-active");
    document.body.classList.add("public-share-active");

    const robotsMeta = document.createElement("meta");
    robotsMeta.name = "robots";
    robotsMeta.content = "noindex, noarchive, noimageindex, nosnippet";
    document.head.appendChild(robotsMeta);

    const rootEl = document.getElementById("root");
    if (rootEl) {
      rootEl.style.overflow = "visible";
      rootEl.style.height = "auto";
      rootEl.style.minHeight = "100vh";
    }

    return () => {
      document.documentElement.classList.remove("public-share-active");
      document.body.classList.remove("public-share-active");
      if (robotsMeta.parentNode) {
        robotsMeta.parentNode.removeChild(robotsMeta);
      }
      if (rootEl) {
        rootEl.style.overflow = "";
        rootEl.style.height = "";
        rootEl.style.minHeight = "";
      }
    };
  }, []);

  useEffect(() => {
    if (loading) {
      document.title = "Loading page...";
    } else if (lead) {
      const pageTitle = lead.title || lead.extractedData?.crmData?.descriere?.titlu || "Proprietate imobiliară";
      document.title = `${pageTitle} • brokr.`;
    }
  }, [loading, lead]);

  const blockContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      id="shared-property-container"
      className="w-full min-h-screen bg-transparent flex flex-col"
      onContextMenu={blockContextMenu}
    >
      <PublicContentShield onLockChange={setIsInspectBlocked} />

      {!isInspectBlocked && (
        <>
          {loading ? (
            <div className="fixed inset-0 overflow-y-auto bg-gray-50 flex flex-col items-center justify-center p-6 text-center">
              <Loader2 className="w-9 h-9 text-[#BE9662] animate-spin mb-3" />
              <h2 className="font-title text-sm font-semibold text-gray-800">Se încarcă proprietatea...</h2>
              <p className="text-[11px] text-gray-400 mt-1 uppercase tracking-wider">brokr. crm</p>
            </div>
          ) : error || !lead ? (
            <div className="fixed inset-0 overflow-y-auto bg-gray-50 flex flex-col items-center justify-center p-6 text-center">
              <div className="w-14 h-14 rounded-2xl bg-red-50 text-red-500 flex items-center justify-center mb-3 border border-red-100">
                <AlertCircle size={28} />
              </div>
              <h2 className="font-title text-base font-semibold text-gray-900 mb-1">Proprietatea nu este disponibilă</h2>
              <p className="text-xs text-gray-500 max-w-md mb-5 leading-relaxed">
                {error || "Proprietatea căutată nu a fost găsită sau linkul a expirat."}
              </p>
              <Link
                to="/"
                className="px-5 py-2 rounded-lg bg-[#051D35] text-white text-xs font-semibold hover:bg-[#0a2b4a] transition-all shadow-xs"
              >
                Mergi la pagina principală
              </Link>
            </div>
          ) : (
            /* Strict Public Presentation: isPublicShared=true ensures NO owner details ever leak */
            <PropertyDetailView
              lead={lead}
              isPublicShared={true}
              showTopNavbar={true}
            />
          )}
        </>
      )}
    </div>
  );
};
