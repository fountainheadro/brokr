import React, { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { leadsService, Lead } from "../services/leadsService";
import { Loader2, AlertCircle, MapPin, Euro, Home, Calendar, ShieldCheck, Check, Share2, Printer, Bookmark, ExternalLink } from "lucide-react";
import toast from "react-hot-toast";

export const SharedProperty: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isFavorite, setIsFavorite] = useState<boolean>(false);

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
        const docLead = await leadsService.getLead(id);
        if (docLead && isMounted) {
          const sanitizedLead: Lead = {
            ...docLead,
            ownerName: "",
            ownerPhone: ""
          };
          setLead(sanitizedLead);
          setLoading(false);
          return;
        }

        const res = await fetch(`/api/public-property/${encodeURIComponent(id)}`);
        if (res.ok) {
          const serverLead = await res.json();
          if (isMounted) {
            const sanitizedLead: Lead = {
              ...serverLead,
              ownerName: "",
              ownerPhone: ""
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
        console.warn("[SharedProperty] Client fetch error, trying server fallback:", err);
        try {
          const res = await fetch(`/api/public-property/${encodeURIComponent(id)}`);
          if (res.ok) {
            const serverLead = await res.json();
            if (isMounted) {
              const sanitizedLead: Lead = {
                ...serverLead,
                ownerName: "",
                ownerPhone: ""
              };
              setLead(sanitizedLead);
              setLoading(false);
              return;
            }
          }
        } catch (serverErr) {
          console.error("[SharedProperty] Server fallback also failed:", serverErr);
        }

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
    const originalHtmlOverflow = document.documentElement.style.overflow;
    const originalBodyOverflow = document.body.style.overflow;
    const rootEl = document.getElementById("root");
    const originalRootOverflow = rootEl?.style.overflow || "";

    document.documentElement.style.overflow = "auto";
    document.body.style.overflow = "auto";
    if (rootEl) {
      rootEl.style.overflow = "visible";
    }

    return () => {
      document.documentElement.style.overflow = originalHtmlOverflow;
      document.body.style.overflow = originalBodyOverflow;
      if (rootEl) {
        rootEl.style.overflow = originalRootOverflow;
      }
    };
  }, []);

  useEffect(() => {
    if (lead) {
      const pageTitle = lead.title || lead.extractedData?.crmData?.descriere?.titlu || "Proprietate imobiliară";
      document.title = `${pageTitle} • brokr.`;
    }
  }, [lead]);

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: lead?.title || "Proprietate Imobiliară",
          text: "Vezi această proprietate prezentată de brokr.",
          url: window.location.href,
        });
        return;
      } catch (err) {}
    }
    navigator.clipboard.writeText(window.location.href);
    toast.success("Linkul public a fost copiat în clipboard!");
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6 text-center">
        <Loader2 className="w-9 h-9 text-[#BE9662] animate-spin mb-3" />
        <h2 className="text-sm font-semibold text-gray-800">Se încarcă proprietatea...</h2>
        <p className="text-[11px] text-gray-400 mt-1 uppercase tracking-wider font-mono">brokr. presentation</p>
      </div>
    );
  }

  if (error || !lead) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-14 h-14 rounded-2xl bg-red-50 text-red-500 flex items-center justify-center mb-3 border border-red-100">
          <AlertCircle size={28} />
        </div>
        <h2 className="text-base font-bold text-gray-900 mb-1">Proprietatea nu este disponibilă</h2>
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
    );
  }

  // Gather all images
  const allImages: string[] = [];
  if (lead.coverImage) allImages.push(lead.coverImage);
  if (Array.isArray(lead.images)) {
    lead.images.forEach(img => {
      if (img && !allImages.includes(img)) allImages.push(img);
    });
  }
  if (lead.extractedData?.crmData?.imagini) {
    const im = lead.extractedData.crmData.imagini;
    const cats = ["living", "camera", "bucatarie", "baie", "alteSpatii"] as const;
    cats.forEach(cat => {
      const list = im[cat];
      if (Array.isArray(list)) {
        list.forEach(item => {
          const url = typeof item === "string" ? item : item?.original;
          if (url && !allImages.includes(url)) allImages.push(url);
        });
      }
    });
  }

  const crmDesc = lead.extractedData?.crmData?.descriere?.continut || lead.notes || lead.title;
  const title = lead.title || lead.extractedData?.crmData?.descriere?.titlu || "Proprietate imobiliară";

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-gray-900 flex flex-col font-sans">
      {/* Top Navbar */}
      <header className="sticky top-0 z-50 h-[60px] bg-white border-b border-gray-200 px-6 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-3">
          <span className="font-extrabold text-lg tracking-tight text-[#051D35] font-sans flex items-center">
            brokr<span className="text-[#BE9662]">.</span>
          </span>
          <span className="text-xs px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">
            Prezentare Publică
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsFavorite(!isFavorite)}
            className={`p-2 rounded-lg border transition-colors ${isFavorite ? "bg-amber-50 border-amber-200 text-[#BE9662]" : "border-gray-200 hover:bg-gray-50 text-gray-600"}`}
            title="Salvează ca favorit"
          >
            <Bookmark size={16} className={isFavorite ? "fill-[#BE9662]" : ""} />
          </button>
          <button
            onClick={handlePrint}
            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition-colors"
            title="Tipărește oferta"
          >
            <Printer size={16} />
          </button>
          <button
            onClick={handleShare}
            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition-colors"
            title="Distribuie"
          >
            <Share2 size={16} />
          </button>
          {lead.url && (
            <a
              href={lead.url}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-[#051D35] text-white rounded-lg text-xs font-semibold hover:bg-[#0a2b4a] transition-colors"
            >
              <span>Anunț Original</span>
              <ExternalLink size={13} />
            </a>
          )}
        </div>
      </header>

      {/* Main Content Container */}
      <main className="max-w-6xl mx-auto w-full p-6 space-y-8 flex-1">
        {/* Title & Price Header Card */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6 md:p-8 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-3 py-1 rounded-full bg-[#051D35]/5 text-[#051D35] text-xs font-semibold uppercase tracking-wider">
                {lead.transactionType || "Închiriere"}
              </span>
              {lead.categoria && (
                <span className="px-3 py-1 rounded-full bg-gray-100 text-gray-700 text-xs font-semibold">
                  {lead.categoria}
                </span>
              )}
              {lead.zone && (
                <span className="flex items-center gap-1 text-xs font-medium text-gray-500">
                  <MapPin size={13} className="text-[#BE9662]" />
                  {lead.zone}
                </span>
              )}
            </div>
            <h1 className="text-xl md:text-2xl font-bold text-gray-900 leading-tight">
              {title}
            </h1>
          </div>
          <div className="flex flex-col md:items-end justify-center shrink-0 border-t md:border-t-0 pt-4 md:pt-0 border-gray-100">
            <span className="text-2xl md:text-3xl font-extrabold text-[#051D35] font-mono">
              {lead.price || "La cerere"}
            </span>
            <span className="text-xs text-gray-400 font-medium mt-0.5">Preț actualizat</span>
          </div>
        </div>

        {/* Photo Gallery Grid */}
        {allImages.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider font-mono">Galerie Foto ({allImages.length})</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Main big cover photo */}
              <div 
                className="md:col-span-2 h-[350px] md:h-[450px] rounded-2xl overflow-hidden border border-gray-200 bg-gray-100 cursor-pointer group relative shadow-xs"
                onClick={() => setSelectedImage(allImages[0])}
              >
                <img 
                  src={allImages[0]} 
                  alt={title} 
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
                  <span className="text-white text-xs font-semibold bg-black/60 px-3 py-1 rounded-md backdrop-blur-xs">Click pentru mărire</span>
                </div>
              </div>

              {/* Side grid thumbnails */}
              <div className="grid grid-cols-2 md:grid-cols-1 gap-3 h-[350px] md:h-[450px] overflow-y-auto pr-1">
                {allImages.slice(1, 5).map((img, idx) => (
                  <div 
                    key={idx}
                    className="h-[165px] md:h-[105px] rounded-xl overflow-hidden border border-gray-200 bg-gray-100 cursor-pointer group relative shadow-xs shrink-0"
                    onClick={() => setSelectedImage(img)}
                  >
                    <img 
                      src={img} 
                      alt={`Foto ${idx + 2}`} 
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Remaining photos row if more than 5 */}
            {allImages.length > 5 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 pt-2">
                {allImages.slice(5).map((img, idx) => (
                  <div 
                    key={idx + 5}
                    className="h-24 rounded-xl overflow-hidden border border-gray-200 bg-gray-100 cursor-pointer group relative shadow-xs"
                    onClick={() => setSelectedImage(img)}
                  >
                    <img 
                      src={img} 
                      alt={`Foto ${idx + 6}`} 
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Description & Details Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column: Description */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-2xl border border-gray-200 p-6 md:p-8 shadow-xs space-y-4">
              <h3 className="text-base font-bold text-gray-900 border-b border-gray-100 pb-3">Descriere Proprietate</h3>
              <div className="prose prose-sm max-w-none text-gray-700 leading-relaxed whitespace-pre-line font-sans text-sm">
                {crmDesc}
              </div>
            </div>
          </div>

          {/* Right Column: Quick Info Card & Agency CTA */}
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-xs space-y-4">
              <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider font-mono border-b border-gray-100 pb-3">Detalii Cheie</h3>
              <div className="space-y-3 text-xs">
                <div className="flex justify-between py-2 border-b border-gray-50">
                  <span className="text-gray-500 font-medium">Tip Tranzacție</span>
                  <span className="font-semibold text-gray-900">{lead.transactionType || "Închiriere"}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-gray-50">
                  <span className="text-gray-500 font-medium">Categorie</span>
                  <span className="font-semibold text-gray-900">{lead.categoria || "Apartament"}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-gray-50">
                  <span className="text-gray-500 font-medium">Zonă / Oras</span>
                  <span className="font-semibold text-gray-900">{lead.zone || "București"}</span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-gray-500 font-medium">ID Ofertă</span>
                  <span className="font-semibold text-gray-900 font-mono">#{lead.propertyId || lead.id?.substring(0, 6)}</span>
                </div>
              </div>
            </div>

            {/* Agency Contact Card */}
            <div className="bg-gradient-to-br from-[#051D35] to-[#0a2b4a] rounded-2xl p-6 text-white shadow-md space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-[#BE9662] font-bold text-lg">
                  b
                </div>
                <div>
                  <h4 className="font-bold text-sm">brokr. crm</h4>
                  <p className="text-[11px] text-gray-300">Asistență imobiliară profesională</p>
                </div>
              </div>
              <p className="text-xs text-gray-200 leading-relaxed">
                Pentru vizionare rapidă, detalii suplimentare sau întrebări despre această proprietate, contactează agentul sau agenția.
              </p>
              <div className="pt-2">
                <a
                  href="tel:+40700000000"
                  className="w-full py-2.5 rounded-xl bg-[#BE9662] hover:bg-[#a88252] text-white font-semibold text-xs transition-colors flex items-center justify-center gap-2 shadow-xs cursor-pointer"
                >
                  <span>Contactează Agenția</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Image Lightbox Modal */}
      {selectedImage && (
        <div 
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm"
          onClick={() => setSelectedImage(null)}
        >
          <div className="relative max-w-5xl max-h-[90vh] w-full h-full flex items-center justify-center">
            <img 
              src={selectedImage} 
              alt="Mărire" 
              className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl" 
            />
            <button 
              onClick={() => setSelectedImage(null)}
              className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/20 hover:bg-white/40 text-white flex items-center justify-center font-bold text-lg transition-colors cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 py-6 px-6 text-center text-xs text-gray-400 mt-12">
        <p>© {new Date().getFullYear()} brokr. Toate drepturile rezervate. Platformă imobiliară profesională.</p>
      </footer>
    </div>
  );
};
