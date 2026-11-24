import React, { useState, useEffect, useCallback, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { Lead } from "../services/leadsService";
import { PropertyDetailView } from "../components/PropertyDetailView";
import { PublicContentShield } from "../components/PublicContentShield";
import {
  resolvePublicDisplayTitle,
  formatOpenGraphDescription,
} from "../utils/publicContentUtils";
import { Loader2, AlertCircle } from "lucide-react";

function upsertMetaTag(
  attr: "name" | "property",
  key: string,
  content: string
): void {
  const selector = `meta[${attr}="${key}"]`;
  let el = document.head.querySelector(selector) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertCanonicalLink(href: string): void {
  let el = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

function consumeInitialPublicProperty(routeId: string | undefined): Lead | null {
  if (!routeId || typeof document === "undefined") return null;
  try {
    const el = document.getElementById("__BROKR_INITIAL_PUBLIC_PROPERTY__");
    if (!el || !el.textContent) return null;
    const parsed = JSON.parse(el.textContent);
    // Always remove after reading so subsequent client-side navigations fetch fresh data
    el.remove();
    if (!parsed || !parsed.data) return null;
    const matchesRoute =
      String(parsed.routeId || "").toLowerCase() === String(routeId).toLowerCase() ||
      String(parsed.data.id || "").toLowerCase() === String(routeId).toLowerCase() ||
      String(parsed.data.propertyId || "").toLowerCase() === String(routeId).toLowerCase();
    if (!matchesRoute) return null;
    return {
      ...parsed.data,
      ownerName: "",
      ownerPhone: "",
      url: "",
    };
  } catch {
    return null;
  }
}

export const SharedProperty: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const initialHydratedRef = useRef<{ routeId: string; lead: Lead } | null>(null);
  if (initialHydratedRef.current === null && id) {
    const ssrLead = consumeInitialPublicProperty(id);
    if (ssrLead) {
      initialHydratedRef.current = { routeId: id, lead: ssrLead };
    }
  }
  const hasMatchingInitial =
    Boolean(id && initialHydratedRef.current && initialHydratedRef.current.routeId === id);

  const [lead, setLead] = useState<Lead | null>(() =>
    hasMatchingInitial ? initialHydratedRef.current!.lead : null
  );
  const [loading, setLoading] = useState<boolean>(() => !hasMatchingInitial);
  const [error, setError] = useState<string | null>(null);
  const [isInspectBlocked, setIsInspectBlocked] = useState<boolean>(false);
  const lastRefreshAtRef = useRef<number>(0);

  const refreshPublicProperty = useCallback(async () => {
    if (!id) return;
    const now = Date.now();
    if (now - lastRefreshAtRef.current < 15000) return;
    lastRefreshAtRef.current = now;
    try {
      const res = await fetch(`/api/public-property/${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      if (res.ok) {
        const serverLead = await res.json();
        setLead({
          ...serverLead,
          ownerName: "",
          ownerPhone: "",
          url: "",
        });
      }
    } catch {
      // silent background refresh failure
    }
  }, [id]);

  useEffect(() => {
    let isMounted = true;

    const loadProperty = async () => {
      if (!id) {
        setError("Identificatorul proprietății lipsește.");
        setLoading(false);
        return;
      }

      // Skip redundant network fetch when already hydrated from SSR HTML for this exact route ID
      if (initialHydratedRef.current && initialHydratedRef.current.routeId === id) {
        setLead(initialHydratedRef.current.lead);
        setLoading(false);
        setError(null);
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
      const pageTitle = resolvePublicDisplayTitle(lead, "Proprietate imobiliară");
      const pageDescription = formatOpenGraphDescription(
        lead,
        "Proprietate imobiliară prezentată de brokr."
      );
      const shareUrl = window.location.href.split("#")[0];
      const encodedId = id ? encodeURIComponent(id) : "";
      const existingSsrOgImage =
        document.head
          .querySelector('meta[property="og:image"]')
          ?.getAttribute("content")
          ?.trim() || "";
      const ogImageUrl =
        existingSsrOgImage && existingSsrOgImage.includes("/api/og-image/")
          ? existingSsrOgImage
          : encodedId
            ? `${window.location.origin}/api/og-image/${encodedId}.jpg`
            : `${window.location.origin}/og-default.jpg`;

      document.title = `${pageTitle} • brokr.`;
      upsertCanonicalLink(shareUrl);
      upsertMetaTag("name", "description", pageDescription);
      upsertMetaTag("property", "og:type", "website");
      upsertMetaTag("property", "og:locale", "ro_RO");
      upsertMetaTag("property", "og:site_name", "brokr.");
      upsertMetaTag("property", "og:url", shareUrl);
      upsertMetaTag("property", "og:title", pageTitle);
      upsertMetaTag("property", "og:description", pageDescription);
      upsertMetaTag("property", "og:image", ogImageUrl);
      if (ogImageUrl.startsWith("https://")) {
        upsertMetaTag("property", "og:image:secure_url", ogImageUrl);
      }
      upsertMetaTag("property", "og:image:type", "image/jpeg");
      upsertMetaTag("property", "og:image:width", "1200");
      upsertMetaTag("property", "og:image:height", "630");
      upsertMetaTag("property", "og:image:alt", pageTitle);
      upsertMetaTag("name", "twitter:card", "summary_large_image");
      upsertMetaTag("name", "twitter:url", shareUrl);
      upsertMetaTag("name", "twitter:title", pageTitle);
      upsertMetaTag("name", "twitter:description", pageDescription);
      upsertMetaTag("name", "twitter:image", ogImageUrl);
      upsertMetaTag("name", "twitter:image:alt", pageTitle);
    }
  }, [loading, lead, id]);

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
              onRefreshPublicProperty={refreshPublicProperty}
            />
          )}
        </>
      )}
    </div>
  );
};
