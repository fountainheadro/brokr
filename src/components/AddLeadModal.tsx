import React, { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  X,
  Globe,
  Loader2,
  Building2,
  Plus,
  Bookmark,
  Code2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  FileEdit,
} from "lucide-react";
import { leadsService } from "../services/leadsService";
import { notificationsService } from "../services/notificationsService";
import toast from "react-hot-toast";
import {
  PropertyCriteriaAccordionForm,
  createInitialPropertyCriteriaState,
  buildLeadPayloadFromCriteria,
  type PropertyCriteriaFormState,
} from "./PropertyCriteriaAccordionForm";
import {
  importPropertyFromCrawl,
  buildImportBookmarkletCode,
  CrawlBlockedError,
} from "../utils/importPropertyFromCrawl";

interface AddLeadModalProps {
  isOpen: boolean;
  onClose: () => void;
  propertyOnly?: boolean;
}

export const AddLeadModal: React.FC<AddLeadModalProps> = ({
  isOpen,
  onClose,
  propertyOnly = false,
}) => {
  const [url, setUrl] = useState("");
  const [pastedHtml, setPastedHtml] = useState("");
  const [showHtmlFallback, setShowHtmlFallback] = useState(false);
  const [wasBlocked, setWasBlocked] = useState(false);
  const [leadRole, setLeadRole] = useState<"Proprietar" | "Chirias" | "Cumparator">("Proprietar");
  const [propertyInputMode, setPropertyInputMode] = useState<"url" | "manual">("url");
  const [manualPropertyTx, setManualPropertyTx] = useState<"Închiriere" | "Vânzare">("Închiriere");
  const [formState, setFormState] = useState<PropertyCriteriaFormState>(() =>
    createInitialPropertyCriteriaState()
  );
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const bookmarkletRef = useRef<HTMLAnchorElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const bookmarkletCode = useMemo(() => {
    const origin =
      typeof window !== "undefined" ? window.location.origin : "https://agency.highline.ro";
    return buildImportBookmarkletCode(origin);
  }, []);

  useEffect(() => {
    if (bookmarkletRef.current) {
      bookmarkletRef.current.setAttribute("href", bookmarkletCode);
    }
  }, [bookmarkletCode, isOpen, leadRole, propertyInputMode]);

  useEffect(() => {
    if (isOpen && propertyOnly && leadRole !== "Proprietar") {
      setLeadRole("Proprietar");
    }
  }, [isOpen, propertyOnly, leadRole]);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isOpen, leadRole, propertyInputMode]);

  const effectiveLeadRole = propertyOnly ? "Proprietar" : leadRole;
  const isManualProperty = effectiveLeadRole === "Proprietar" && propertyInputMode === "manual";
  const manualAccordionRole: "Chirias" | "Cumparator" =
    manualPropertyTx === "Închiriere" ? "Chirias" : "Cumparator";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (effectiveLeadRole === "Proprietar" && propertyInputMode === "url") {
      if (!url.trim()) return;

      setLoading(true);
      setStatus(pastedHtml.trim() ? "Procesare pagină capturată..." : "Accesare URL...");
      try {
        await importPropertyFromCrawl({
          url: url.trim(),
          html: pastedHtml.trim() || undefined,
          onStatus: setStatus,
        });

        setUrl("");
        setPastedHtml("");
        setWasBlocked(false);
        setShowHtmlFallback(false);
        onClose();
        toast.success("Proprietatea a fost adăugată cu succes!");
      } catch (error: any) {
        console.warn("[AddLeadModal] Add lead error:", error?.message || error);
        setStatus("Eroare la adăugare");
        const isAbort = error?.name === "AbortError";
        const isFetchError = error instanceof TypeError || error?.message?.includes("fetch");
        if (error instanceof CrawlBlockedError) {
          setWasBlocked(true);
          setShowHtmlFallback(true);
          toast.error(
            "Site-ul a blocat accesul automat (403). Folosește butonul din bara de marcaje sau lipește sursa paginii mai jos."
          );
        } else if (isAbort) {
          toast.error(
            "Conectarea la site-ul extern a durat prea mult. Verificați link-ul și reîncercați."
          );
        } else if (isFetchError) {
          toast.error(
            "Nu s-a putut accesa link-ul extern sau conexiunea a fost întreruptă. Verificați link-ul și reîncercați."
          );
        } else if (error?.message?.includes("HTML instead of JSON")) {
          toast.error(
            "Serviciul de scanare este momentan indisponibil. Reîncercați în câteva secunde."
          );
        } else {
          toast.error(
            `Eroare la adăugarea proprietății: ${error?.message || "Eroare necunoscută"}`
          );
        }
      } finally {
        setLoading(false);
        setStatus("");
      }
      return;
    }

    if (!formState.clientName.trim() || !formState.clientPhone.trim()) {
      toast.error(
        isManualProperty
          ? "Numele proprietarului și telefonul sunt obligatorii."
          : "Numele clientului și telefonul sunt obligatorii."
      );
      return;
    }

    setLoading(true);
    try {
      if (isManualProperty) {
        const payload = buildLeadPayloadFromCriteria({
          state: formState,
          role: manualAccordionRole,
          mode: "property",
          status: propertyOnly ? "Noua" : "ListaMea",
        });

        await leadsService.addLead(payload);

        await notificationsService.addNotification({
          title: "Proprietate Nouă Adăugată Manual",
          message: `${payload.title} (${payload.price}) a fost înregistrată.`,
          type: "lead",
        });

        toast.success("Proprietatea a fost adăugată cu succes!");
      } else {
        const activeRole: "Chirias" | "Cumparator" =
          effectiveLeadRole === "Cumparator" ? "Cumparator" : "Chirias";
        const payload = buildLeadPayloadFromCriteria({
          state: formState,
          role: activeRole,
          mode: "lead",
          status: "ListaMea",
        });

        await leadsService.addLead(payload);

        await notificationsService.addNotification({
          title:
            activeRole === "Chirias"
              ? "Chiriaș Nou Înregistrat"
              : "Cumpărător Nou Înregistrat",
          message: `${formState.clientName.trim()} caută ${payload.categoria} (${payload.transactionType === "Vânzare" ? "cumpărare" : "închiriere"}) în ${payload.zone}.`,
          type: "lead",
        });

        toast.success("Înregistrarea a fost salvată cu succes!");
      }

      setFormState(createInitialPropertyCriteriaState());
      onClose();
    } catch (err: any) {
      console.error("Eroare la salvare:", err);
      toast.error("Eroare la salvare. Încercați din nou.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[300]">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/30 backdrop-blur-xs"
          />

          {/* Right Drawer */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", ease: "easeInOut", duration: 0.25 }}
            className="fixed inset-y-0 right-0 w-[calc(100vw-48px)] md:w-full md:max-w-[460px] bg-white shadow-2xl z-[301] flex flex-col border-l border-gray-200"
          >
            {/* Header */}
            <div className="h-12 px-5 border-b border-gray-100 flex items-center justify-between shrink-0 bg-white">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-7 h-7 rounded-md bg-[#051D35]/5 border border-[#051D35]/15 flex items-center justify-center text-[#051D35] shrink-0">
                  <Building2 size={14} />
                </span>
                <h3 className="text-[13px] font-semibold text-[#051D35] truncate">
                  {propertyOnly
                    ? "Adaugă Proprietate"
                    : effectiveLeadRole === "Proprietar"
                      ? "Adaugă Imobil / Proprietar"
                      : effectiveLeadRole === "Chirias"
                        ? "Adaugă Chiriaș Nou"
                        : "Adaugă Cumpărător Nou"}
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors cursor-pointer shrink-0"
                title="Închide meniul"
              >
                <X size={16} />
              </button>
            </div>

            {/* Horizontal Tabs right under the header (hidden on Proprietăți page) */}
            {!propertyOnly && (
              <div className="h-10 border-b border-gray-200 bg-white flex items-stretch shrink-0 overflow-x-auto no-scrollbar">
                <div className="flex items-stretch h-full divide-x divide-gray-100 border-r border-gray-100 font-sans">
                  {(
                    [
                      { id: "Proprietar", label: "Proprietate" },
                      { id: "Chirias", label: "Chiriaș" },
                      { id: "Cumparator", label: "Cumpărător" },
                    ] as const
                  ).map((tab) => {
                    const isActive = effectiveLeadRole === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        disabled={loading}
                        onClick={() => setLeadRole(tab.id)}
                        className={`h-full px-4 rounded-none bg-transparent flex items-center justify-center whitespace-nowrap transition-colors cursor-pointer select-none font-sans text-[13px] border-b-4 disabled:opacity-60 ${
                          isActive
                            ? "text-gray-900 font-semibold border-b-[#BE9662]"
                            : "text-gray-600 font-medium hover:text-gray-900 border-b-transparent"
                        }`}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Form wrapping scrollable body + pinned footer */}
            <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
              {/* Scrollable Body */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs custom-scrollbar">
                <fieldset disabled={loading} className="border-0 p-0 m-0 min-w-0 space-y-4">
                  {effectiveLeadRole === "Proprietar" ? (
                    <>
                      {/* Mode switcher: URL crawl vs Manual entry */}
                      <div className="grid grid-cols-2 gap-1 bg-gray-100 p-1 rounded-lg">
                        <button
                          type="button"
                          disabled={loading}
                          onClick={() => setPropertyInputMode("url")}
                          className={`h-7 px-2 text-[11px] font-semibold rounded-md transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60 ${
                            propertyInputMode === "url"
                              ? "bg-white text-[#051D35] shadow-xs"
                              : "text-gray-600 hover:text-[#051D35]"
                          }`}
                        >
                          <Globe size={12} />
                          <span>Import din URL</span>
                        </button>
                        <button
                          type="button"
                          disabled={loading}
                          onClick={() => setPropertyInputMode("manual")}
                          className={`h-7 px-2 text-[11px] font-semibold rounded-md transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60 ${
                            propertyInputMode === "manual"
                              ? "bg-white text-[#051D35] shadow-xs"
                              : "text-gray-600 hover:text-[#051D35]"
                          }`}
                        >
                          <FileEdit size={12} />
                          <span>Introducere manuală</span>
                        </button>
                      </div>

                      {propertyInputMode === "url" ? (
                        <>
                          <div>
                            <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                              Link Anunț Imobiliar *
                            </label>
                            <div className="relative">
                              <Globe
                                size={14}
                                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                              />
                              <input
                                ref={inputRef}
                                type="url"
                                required
                                placeholder="https://www.storia.ro/... sau olx.ro, imobiliare.ro"
                                value={url}
                                onChange={(e) => {
                                  setUrl(e.target.value);
                                  if (wasBlocked) setWasBlocked(false);
                                }}
                                className="w-full h-8 pl-8 pr-3 text-xs font-normal border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662]"
                              />
                            </div>
                            <p className="text-[11px] text-gray-400 font-normal mt-2 leading-relaxed">
                              Crawlerul va extrage automat detaliile, imaginile, prețul, categoria și contactul.
                            </p>
                          </div>

                          {/* 1-Click Browser Bookmarklet + Paste HTML fallback */}
                          <div
                            className={`rounded-lg border p-3.5 space-y-2.5 transition-colors ${
                              wasBlocked
                                ? "bg-amber-50/80 border-amber-300"
                                : "bg-gray-50/90 border-gray-200"
                            }`}
                          >
                            <div className="flex items-start gap-2">
                              {wasBlocked ? (
                                <AlertTriangle
                                  size={14}
                                  className="text-amber-600 shrink-0 mt-0.5"
                                />
                              ) : (
                                <Bookmark
                                  size={14}
                                  className="text-[#051D35] shrink-0 mt-0.5"
                                />
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="text-[11px] font-semibold text-[#051D35]">
                                  {wasBlocked
                                    ? "Site-ul a blocat serverul (HTTP 403) — Importă direct din browser"
                                    : "Import rapid 1-Click din browser (Anti-blocare OLX)"}
                                </p>
                                <p className="text-[11px] text-gray-600 leading-relaxed mt-0.5">
                                  Trage butonul de mai jos în bara de marcaje Chrome (o singură dată). Apoi apasă-l direct când ești pe orice anunț OLX, Storia sau Imobiliare.ro:
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <a
                                ref={bookmarkletRef}
                                draggable
                                onClick={(e) => {
                                  e.preventDefault();
                                  toast(
                                    "Trage acest buton în bara de marcaje (Bookmarks Bar) din Chrome, apoi apasă-l pe un anunț OLX/Storia.",
                                    { icon: "📌" }
                                  );
                                }}
                                className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md bg-[#051D35] hover:bg-[#0a2b4a] text-white text-[11px] font-semibold cursor-grab active:cursor-grabbing shadow-2xs select-none"
                                title="Trage în bara de marcaje Chrome"
                              >
                                <Bookmark size={12} className="text-[#BE9662]" />
                                <span>Importă în CRM</span>
                              </a>
                              <span className="text-[10px] text-gray-500">
                                ← Trage în bara de marcaje (Ctrl+Shift+B)
                              </span>
                            </div>

                            <div className="pt-1 border-t border-gray-200/80">
                              <button
                                type="button"
                                onClick={() => setShowHtmlFallback((v) => !v)}
                                className="w-full flex items-center justify-between text-[11px] font-medium text-gray-600 hover:text-[#051D35] py-1 cursor-pointer"
                              >
                                <span className="flex items-center gap-1.5">
                                  <Code2 size={12} />
                                  <span>
                                    Sau lipește sursa paginii (Ctrl+U → Ctrl+A → Ctrl+C)
                                  </span>
                                </span>
                                {showHtmlFallback ? (
                                  <ChevronUp size={13} />
                                ) : (
                                  <ChevronDown size={13} />
                                )}
                              </button>

                              {showHtmlFallback && (
                                <div className="mt-1.5 space-y-1">
                                  <textarea
                                    rows={3}
                                    value={pastedHtml}
                                    onChange={(e) => setPastedHtml(e.target.value)}
                                    placeholder="Deschide anunțul OLX în browser, apasă Ctrl+U, apoi Ctrl+A, Ctrl+C și lipește aici..."
                                    className="w-full px-2.5 py-2 text-[11px] font-mono bg-white border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] resize-none"
                                  />
                                  {pastedHtml.trim().length > 0 && (
                                    <p className="text-[10px] text-emerald-700 font-medium">
                                      Sursă HTML pregătită ({Math.round(pastedHtml.length / 1024)} KB) — apasă „Adaugă Proprietate”.
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>

                          {loading && status && (
                            <div className="flex items-center gap-2 px-3 py-2 bg-[#BE9662]/10 border border-[#BE9662]/20 rounded-lg text-xs text-[#051D35]">
                              <Loader2
                                size={14}
                                className="animate-spin text-[#BE9662] shrink-0"
                              />
                              <span className="font-normal">{status}</span>
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          {/* Tip tranzacție selector for manual property insertion */}
                          <div>
                            <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                              Tip tranzacție
                            </label>
                            <div className="grid grid-cols-2 gap-1 bg-gray-100 p-1 rounded-lg">
                              {(["Închiriere", "Vânzare"] as const).map((tx) => {
                                const isActive = manualPropertyTx === tx;
                                return (
                                  <button
                                    key={tx}
                                    type="button"
                                    disabled={loading}
                                    onClick={() => setManualPropertyTx(tx)}
                                    className={`h-7 px-2 text-[11px] font-semibold rounded-md transition-all cursor-pointer disabled:opacity-60 ${
                                      isActive
                                        ? "bg-[#051D35] text-white shadow-xs"
                                        : "text-gray-600 hover:text-[#051D35] hover:bg-white/70"
                                    }`}
                                  >
                                    {tx}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          <PropertyCriteriaAccordionForm
                            role={manualAccordionRole}
                            mode="property"
                            state={formState}
                            onChange={setFormState}
                            disabled={loading}
                            firstInputRef={inputRef}
                          />
                        </>
                      )}
                    </>
                  ) : (
                    <PropertyCriteriaAccordionForm
                      role={effectiveLeadRole === "Cumparator" ? "Cumparator" : "Chirias"}
                      mode="lead"
                      state={formState}
                      onChange={setFormState}
                      disabled={loading}
                      firstInputRef={inputRef}
                    />
                  )}
                </fieldset>
              </div>

              {/* Footer pinned at base */}
              <div className="p-4 border-t border-gray-200 bg-gray-50/80 shrink-0 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={loading}
                  className="h-8 px-3 text-[12px] font-normal text-gray-600 hover:text-[#051D35] bg-white border border-gray-200 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-50 cursor-pointer"
                >
                  Anulează
                </button>
                <button
                  type="submit"
                  disabled={
                    loading ||
                    (effectiveLeadRole === "Proprietar" &&
                      propertyInputMode === "url" &&
                      !url.trim())
                  }
                  className="h-8 px-4 text-[12px] font-semibold bg-[#051D35] hover:bg-[#0a2b4a] text-white rounded-md transition-colors flex items-center gap-2 disabled:opacity-50 cursor-pointer shadow-xs"
                >
                  {loading ? (
                    <>
                      <Loader2 size={13} className="animate-spin text-[#BE9662]" />
                      <span>Se procesează...</span>
                    </>
                  ) : (
                    <>
                      <Plus size={14} className="text-[#BE9662]" />
                      <span>
                        {propertyOnly || isManualProperty
                          ? "Adaugă Proprietate"
                          : effectiveLeadRole === "Proprietar"
                            ? "Adaugă Proprietar"
                            : effectiveLeadRole === "Chirias"
                              ? "Adaugă Chiriaș"
                              : "Adaugă Cumpărător"}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
