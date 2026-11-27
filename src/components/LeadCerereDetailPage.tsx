import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Trash2,
  Check,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Image as ImageIcon,
  ArrowLeft,
  ArrowRight,
  Upload,
  X,
  Link as LinkIcon,
  Star,
  Bookmark,
  Wand2,
  ClipboardList
} from "lucide-react";
import { toast } from "react-hot-toast";
import { Contact } from "../services/contactsService";
import { Lead, leadsService, isCerereLead, isUnprocessedLead, getLeadRole } from "../services/leadsService";
import { publishPublicShareSnapshot } from "../services/publicShareService";
import { useTenantContext } from "../core/tenancy/ctx_tenant";
import { getCleanDisplayImageUrl, getThumbnailImageUrl } from "../utils/imageUtils";
import { getImageIdentityKey, normalizeStoredImageUrl } from "../utils/publicContentUtils";
import { regeneratePropertyImages } from "../utils/regeneratePropertyImages";
import { getApiAuthHeaders } from "../lib/apiAuth";
import { CriteriaDetailSections } from "./CriteriaDetailSections";

export const MOBILARE_OPTIONS = ["Fără", "Parțială", "Completă"] as const;
export const PARCARE_OPTIONS = ["Fără", "1 loc", "2 locuri", "3 locuri", "4 locuri", "5 locuri"] as const;
export const SURSA_INCALZIRE_OPTIONS = ["Centrală proprie", "Centrală imobil", "Termoficare"] as const;
export const MOD_INCALZIRE_OPTIONS = ["Calorifere", "În pardoseală"] as const;



const extractImageUrl = (item: unknown): string => {
  if (typeof item === "string") return item.trim();
  if (item && typeof item === "object" && "original" in item && typeof (item as any).original === "string") {
    return (item as any).original.trim();
  }
  return "";
};

const deriveInitialPhotos = (lead: Lead): string[] => {
  const result: string[] = [];
  const seen = new Set<string>();

  const pushUnique = (raw: string | undefined | null) => {
    if (!raw || typeof raw !== "string") return;
    const trimmed = raw.trim();
    if (!trimmed) return;
    const identity = getImageIdentityKey(trimmed) || trimmed;
    if (seen.has(identity)) return;
    const norm = getCleanDisplayImageUrl(trimmed) || trimmed;
    if (norm) {
      seen.add(identity);
      result.push(norm);
    }
  };

  const coverStr = typeof lead.coverImage === "string" ? lead.coverImage.trim() : "";

  if (Array.isArray(lead.images)) {
    if (lead.images.length === 0 && !coverStr) {
      return [];
    }
    const explicitIds = new Set(
      lead.images.map((img) => getImageIdentityKey(img)).filter(Boolean)
    );
    if (coverStr && !explicitIds.has(getImageIdentityKey(coverStr))) {
      pushUnique(coverStr);
    }
    lead.images.forEach((img) => pushUnique(img));
    return result;
  }

  if (coverStr) {
    pushUnique(coverStr);
  }

  const crmImagini = lead.extractedData?.crmData?.imagini;
  if (crmImagini && typeof crmImagini === "object") {
    const categories = ["living", "camera", "bucatarie", "baie", "alteSpatii"] as const;
    categories.forEach((cat) => {
      const list = crmImagini[cat];
      if (Array.isArray(list)) {
        list.forEach((item) => pushUnique(extractImageUrl(item)));
      }
    });
  }

  return result;
};



interface SectionEditButtonProps {
  isEditing: boolean;
  isSaving: boolean;
  onStartEdit: () => void;
  onSave: () => void;
}

const SectionEditButton: React.FC<SectionEditButtonProps> = ({
  isEditing,
  isSaving,
  onStartEdit,
  onSave,
}) => {
  if (isEditing) {
    return (
      <button
        type="button"
        disabled={isSaving}
        onClick={onSave}
        className="h-8 px-3 rounded-md bg-[#051D35] hover:bg-[#0a2b4a] text-white text-[11px] font-semibold flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer shadow-2xs shrink-0"
      >
        {isSaving ? (
          <Loader2 size={12} className="animate-spin text-[#BE9662]" />
        ) : (
          <Check size={12} className="text-[#BE9662]" />
        )}
        <span>{isSaving ? "Se salvează..." : "Salvează"}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onStartEdit}
      className="h-8 px-3 rounded-md border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 hover:text-[#051D35] text-[11px] font-semibold flex items-center gap-2 transition-colors cursor-pointer shadow-2xs shrink-0"
    >
      <Pencil size={11} className="text-[#BE9662]" />
      <span>Modifică</span>
    </button>
  );
};

interface LeadCerereDetailPageProps {
  lead: Lead;
  contacts: Contact[];
  onBack: () => void;
  onUpdateLead: (updatedData: Partial<Lead>) => void;
  onContactClick: (contact: Contact) => void;
  onAddContactClick: () => void;
  onDeleteLead?: (leadId: string) => Promise<void>;
  onMarkAsLost?: (leadId: string) => Promise<void>;
  onReactivateLead?: (leadId: string) => Promise<void>;
  onAddToMyList?: (leadId: string) => Promise<void>;
  onConvertToCerere?: (leadId: string) => Promise<void>;
}

export const LeadCerereDetailPage: React.FC<LeadCerereDetailPageProps> = ({
  lead,
  onBack,
  onUpdateLead,
  onDeleteLead,
  onMarkAsLost,
  onReactivateLead,
  onAddToMyList,
  onConvertToCerere,
}) => {
  const { tenant } = useTenantContext();
  const [addingToMyList, setAddingToMyList] = useState(false);
  const [convertingToCerere, setConvertingToCerere] = useState(false);

  const [editingPhotos, setEditingPhotos] = useState(false);
  const [savingPhotos, setSavingPhotos] = useState(false);
  const [regeneratingImages, setRegeneratingImages] = useState(false);
  const [photosDraft, setPhotosDraft] = useState<string[]>(() => deriveInitialPhotos(lead));
  const [photoUrlInput, setPhotoUrlInput] = useState("");
  const [draggedPhotoIdx, setDraggedPhotoIdx] = useState<number | null>(null);
  const [dropPhotoIdx, setDropPhotoIdx] = useState<number | null>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isCerere = isCerereLead(lead);
  const isUnprocessed = isUnprocessedLead(lead);
  const leadRole = getLeadRole(lead);
  const isPropertyLead = leadRole === "Proprietar";
  const criteriaMode: "lead" | "cerere" | "property" = isPropertyLead
    ? "property"
    : isCerere
      ? "cerere"
      : "lead";
  const criteriaRole: "Chirias" | "Cumparator" = isPropertyLead
    ? lead.transactionType === "Închiriere"
      ? "Chirias"
      : "Cumparator"
    : leadRole === "Cumparator"
      ? "Cumparator"
      : "Chirias";

  // Reset edit states when navigating to a different lead/cerere
  useEffect(() => {
    setEditingPhotos(false);
    setPhotoUrlInput("");
    setDraggedPhotoIdx(null);
    setDropPhotoIdx(null);
    setLightboxIdx(null);
    setConfirmDelete(false);
  }, [lead.id]);

  useEffect(() => {
    if (!editingPhotos) {
      setPhotosDraft(deriveInitialPhotos(lead));
    }
  }, [editingPhotos, lead]);

  const handleAddPhotoFiles = (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      toast.error("Selectați fișiere imagine valide (JPG, PNG, WEBP).");
      return;
    }

    const loaded: string[] = [];
    let processed = 0;

    imageFiles.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (typeof ev.target?.result === "string") {
          loaded.push(ev.target.result);
        }
        processed++;
        if (processed === imageFiles.length && loaded.length > 0) {
          setPhotosDraft((prev) => [...prev, ...loaded]);
          toast.success(
            loaded.length === 1
              ? "1 fotografie adăugată. Apăsați Salvează pentru a confirma."
              : `${loaded.length} fotografii adăugate. Apăsați Salvează pentru a confirma.`
          );
        }
      };
      reader.onerror = () => {
        processed++;
        toast.error(`Nu s-a putut citi fișierul ${file.name}.`);
      };
      reader.readAsDataURL(file);
    });
  };

  const handleAddPhotoUrl = () => {
    const raw = photoUrlInput.trim();
    if (!raw) return;
    if (!/^https?:\/\//i.test(raw) && !raw.startsWith("/api/") && !raw.startsWith("data:image/")) {
      toast.error("Introduceți un URL de imagine valid (http:// sau https://).");
      return;
    }
    const clean = getCleanDisplayImageUrl(raw) || raw;
    if (photosDraft.includes(clean)) {
      toast("Această fotografie este deja în listă.");
      return;
    }
    setPhotosDraft((prev) => [...prev, clean]);
    setPhotoUrlInput("");
  };

  const handleMovePhoto = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0) return;
    setPhotosDraft((prev) => {
      if (fromIdx >= prev.length || toIdx >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  };

  const handleDeletePhoto = (idx: number) => {
    setPhotosDraft((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSavePhotos = async () => {
    if (!lead.id) return;

    setSavingPhotos(true);
    try {
      const finalPhotos: string[] = [];
      const seenIds = new Set<string>();

      for (let i = 0; i < photosDraft.length; i++) {
        const photo = photosDraft[i];
        if (!photo || typeof photo !== "string") continue;

        if (photo.startsWith("data:")) {
          const authHeaders = await getApiAuthHeaders({ "Content-Type": "application/json" });
          const res = await fetch("/api/upload-photo", {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({
              dataUrl: photo,
              propertyId: lead.propertyId || lead.id,
              fileName: `lead_${lead.propertyId || lead.id}_${Date.now()}_${i}.jpg`,
            }),
          });
          if (!res.ok) {
            const errJson = await res.json().catch(() => ({}));
            throw new Error(errJson?.error || "Eroare la încărcarea fotografiei pe server.");
          }
          const uploadData = await res.json();
          const uploadedUrl = typeof uploadData?.url === "string" ? uploadData.url.trim() : "";
          if (uploadedUrl) {
            const idKey = getImageIdentityKey(uploadedUrl) || uploadedUrl;
            if (!seenIds.has(idKey)) {
              seenIds.add(idKey);
              finalPhotos.push(uploadedUrl);
            }
          }
        } else {
          const canonicalUrl = normalizeStoredImageUrl(photo);
          if (!canonicalUrl || canonicalUrl.startsWith("blob:")) continue;
          const idKey = getImageIdentityKey(canonicalUrl) || canonicalUrl;
          if (!seenIds.has(idKey)) {
            seenIds.add(idKey);
            finalPhotos.push(canonicalUrl);
          }
        }
      }

      const nextCover = finalPhotos[0] || "";
      const existingCrm = lead.extractedData?.crmData;

      let nextExtractedData = lead.extractedData;
      if (existingCrm) {
        const prevImagini = (existingCrm.imagini || {}) as Record<string, unknown>;
        const finalIdSet = new Set(finalPhotos.map((u) => getImageIdentityKey(u) || u));
        const filterCategory = (arr: unknown): Array<{ original: string }> => {
          if (!Array.isArray(arr)) return [];
          const out: Array<{ original: string }> = [];
          const localSeen = new Set<string>();
          for (const item of arr) {
            const u = normalizeStoredImageUrl(extractImageUrl(item));
            const idKey = getImageIdentityKey(u) || u;
            if (!u || !finalIdSet.has(idKey) || localSeen.has(idKey)) continue;
            localSeen.add(idKey);
            out.push({ original: u });
          }
          return out;
        };

        const updatedImagini: Record<string, Array<{ original: string }>> = {
          living: filterCategory(prevImagini.living),
          camera: filterCategory(prevImagini.camera),
          bucatarie: filterCategory(prevImagini.bucatarie),
          baie: filterCategory(prevImagini.baie),
          alteSpatii: filterCategory(prevImagini.alteSpatii),
        };

        const presentIds = new Set<string>();
        (["living", "camera", "bucatarie", "baie", "alteSpatii"] as const).forEach((cat) => {
          updatedImagini[cat].forEach((item) => {
            const idKey = getImageIdentityKey(item.original) || item.original;
            if (idKey) presentIds.add(idKey);
          });
        });

        finalPhotos.forEach((imgUrl) => {
          const idKey = getImageIdentityKey(imgUrl) || imgUrl;
          if (!presentIds.has(idKey)) {
            updatedImagini.alteSpatii.push({ original: imgUrl });
            presentIds.add(idKey);
          }
        });

        nextExtractedData = {
          ...lead.extractedData,
          crmData: {
            ...existingCrm,
            imagini: updatedImagini as any,
          },
        };
      }

      const payload: Partial<Lead> = {
        coverImage: nextCover,
        images: finalPhotos,
        ...(nextExtractedData ? { extractedData: nextExtractedData } : {}),
      };

      const persisted = await leadsService.updateLeadData(lead.id, payload);
      const mergedPatch: Partial<Lead> = {
        ...payload,
        ...(persisted?.propertyId ? { propertyId: persisted.propertyId } : {}),
        ...(persisted?.sourcePropertyId ? { sourcePropertyId: persisted.sourcePropertyId } : {}),
        ...(persisted?.isSharedLead === false ? { isSharedLead: false } : {}),
        ...(persisted?.updatedAt ? { updatedAt: persisted.updatedAt } : {}),
      };

      // Ensure any locally uploaded /api/storage/media/ photos are replicated to shared Firestore
      // so external share pages on other domains/instances load them immediately.
      const storageMediaUrls = finalPhotos.filter((u) => u.includes("/api/storage/media/"));
      if (storageMediaUrls.length > 0) {
        try {
          const syncHeaders = await getApiAuthHeaders({ "Content-Type": "application/json" });
          await fetch("/api/storage/sync-public-media", {
            method: "POST",
            headers: syncHeaders,
            body: JSON.stringify({ urls: storageMediaUrls }),
          });
        } catch {
          // Non-fatal; fresh uploads already sync inside /api/upload-photo
        }
      }

      // Immediately sync the public share snapshot so external share links reflect
      // shuffled order, deletions, and newly uploaded photos right away.
      await publishPublicShareSnapshot(
        {
          ...lead,
          ...(persisted || {}),
          ...mergedPatch,
          isSummary: false,
        },
        { tenantId: (persisted as any)?.tenantId || tenant?.id, force: true }
      );

      setPhotosDraft(finalPhotos.map((u) => getCleanDisplayImageUrl(u) || u));
      onUpdateLead(mergedPatch);
      setEditingPhotos(false);
      toast.success("Fotografiile au fost salvate!");
    } catch (err: any) {
      console.error("[LeadCerereDetailPage] Failed to save photos:", err);
      toast.error(err?.message || "Eroare la salvarea fotografiilor. Încercați din nou.");
    } finally {
      setSavingPhotos(false);
    }
  };

  const savedPhotos = useMemo(() => deriveInitialPhotos(lead), [lead]);
  const activePhotos = editingPhotos ? photosDraft : savedPhotos;

  const handleRegenerateImages = async () => {
    if (!lead.id || regeneratingImages) return;
    if (activePhotos.length === 0) {
      toast.error("Nu există fotografii disponibile pentru regenerare.");
      return;
    }
    setRegeneratingImages(true);
    const loadingToastId = toast.loading(
      `Se regenerează ${activePhotos.length} ${activePhotos.length === 1 ? "fotografie" : "fotografii"} (ascundere watermark)...`
    );
    try {
      const result = await regeneratePropertyImages({
        lead,
        currentImages: activePhotos,
        tenantId: tenant?.id,
        onUpdateLead,
      });
      setPhotosDraft(result.images);
      toast.dismiss(loadingToastId);
      if (result.inpaintedCount > 0) {
        toast.success(
          `Au fost procesate ${result.processedCount}/${result.totalCount} fotografii și curățate ${result.inpaintedCount} watermark-uri.`,
          { duration: 5000 }
        );
      } else {
        toast.success(
          `Toate cele ${result.processedCount}/${result.totalCount} fotografii au fost regenerate și reîmprospătate.`,
          { duration: 4000 }
        );
      }
    } catch (err: any) {
      toast.dismiss(loadingToastId);
      console.error("[LeadCerereDetailPage] Failed to regenerate images:", err);
      toast.error(err?.message || "Eroare la regenerarea imaginilor.");
    } finally {
      setRegeneratingImages(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 custom-scrollbar">
      <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4 text-xs">
        {/* Exact 4 Accordion Sections & Fields */}
        <CriteriaDetailSections
          lead={lead}
          role={criteriaRole}
          mode={criteriaMode}
          onUpdateLead={onUpdateLead}
        />

        {/* Last Section (Proprietate lead only): Fotografii */}
        {isPropertyLead && (
        <div className="p-4 sm:p-5 bg-white border border-gray-200 rounded-xl space-y-4 shadow-2xs">
          <div className="flex items-center justify-between pb-3 border-b border-gray-100 gap-2">
            <span className="font-title text-[12px] font-semibold text-[#051D35] flex items-center gap-2">
              <ImageIcon size={13} className="text-[#BE9662]" />
              <span className="font-title font-semibold">Fotografii ({activePhotos.length})</span>
            </span>

            <SectionEditButton
              isEditing={editingPhotos}
              isSaving={savingPhotos}
              onStartEdit={() => {
                setPhotosDraft(savedPhotos);
                setPhotoUrlInput("");
                setEditingPhotos(true);
              }}
              onSave={() => void handleSavePhotos()}
            />
          </div>

          {editingPhotos && (
            <div className="space-y-3">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDraggingFiles(true);
                }}
                onDragLeave={() => setIsDraggingFiles(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDraggingFiles(false);
                  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    handleAddPhotoFiles(e.dataTransfer.files);
                  }
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`p-3 rounded-lg border border-dashed transition-colors cursor-pointer flex flex-col sm:flex-row items-center justify-between gap-2 ${
                  isDraggingFiles
                    ? "border-[#BE9662] bg-amber-50/40"
                    : "border-gray-300 bg-gray-50/70 hover:border-[#BE9662] hover:bg-amber-50/20"
                }`}
              >
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <Upload size={14} className="text-[#BE9662] shrink-0" />
                  <span>Trage fotografii aici sau selectează din dispozitiv (JPG, PNG, WEBP)</span>
                </div>
                <span className="h-8 px-3 rounded-md bg-white border border-gray-200 text-[11px] font-semibold text-[#051D35] flex items-center gap-1 shrink-0 shadow-2xs">
                  <Plus size={12} className="text-[#BE9662]" />
                  <span>Adaugă fotografii</span>
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      handleAddPhotoFiles(e.target.files);
                      e.target.value = "";
                    }
                  }}
                />
              </div>

              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <LinkIcon size={12} className="text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={photoUrlInput}
                    onChange={(e) => setPhotoUrlInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddPhotoUrl();
                      }
                    }}
                    placeholder="Sau lipește URL imagine (https://...)"
                    className="w-full h-8 pl-8 pr-3 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-[#BE9662] focus:ring-1 focus:ring-[#BE9662] bg-white font-normal"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleAddPhotoUrl}
                  className="h-8 px-3 rounded-md border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-[#051D35] transition-colors cursor-pointer shrink-0"
                >
                  Adaugă URL
                </button>
              </div>
            </div>
          )}

          {activePhotos.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {activePhotos.map((photoUrl, idx) => {
                const displaySrc = getThumbnailImageUrl(photoUrl, 560) || photoUrl;
                const isDragged = editingPhotos && draggedPhotoIdx === idx;
                const isDropTarget = editingPhotos && dropPhotoIdx === idx && draggedPhotoIdx !== idx;

                return (
                  <div
                    key={`${photoUrl.slice(0, 48)}_${idx}`}
                    draggable={editingPhotos}
                    onDragStart={() => {
                      if (!editingPhotos) return;
                      setDraggedPhotoIdx(idx);
                    }}
                    onDragOver={(e) => {
                      if (!editingPhotos || draggedPhotoIdx === null) return;
                      e.preventDefault();
                      setDropPhotoIdx(idx);
                    }}
                    onDragLeave={() => {
                      if (dropPhotoIdx === idx) setDropPhotoIdx(null);
                    }}
                    onDrop={(e) => {
                      if (!editingPhotos) return;
                      e.preventDefault();
                      if (draggedPhotoIdx !== null && draggedPhotoIdx !== idx) {
                        handleMovePhoto(draggedPhotoIdx, idx);
                      }
                      setDraggedPhotoIdx(null);
                      setDropPhotoIdx(null);
                    }}
                    onDragEnd={() => {
                      setDraggedPhotoIdx(null);
                      setDropPhotoIdx(null);
                    }}
                    className={`group relative rounded-lg overflow-hidden border bg-gray-100 transition-all ${
                      isDropTarget
                        ? "border-[#BE9662] ring-2 ring-[#BE9662]/40 scale-[0.98]"
                        : "border-gray-200"
                    } ${isDragged ? "opacity-50" : ""} ${editingPhotos ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
                    onClick={() => {
                      if (!editingPhotos) {
                        setLightboxIdx(idx);
                      }
                    }}
                  >
                    <div className="aspect-[4/3] w-full bg-gray-100 overflow-hidden">
                      <img
                        src={displaySrc}
                        alt={`${lead.title} - foto ${idx + 1}`}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                        referrerPolicy="no-referrer"
                      />
                    </div>

                    {/* Index / Cover badge */}
                    <span
                      className={`absolute top-2 left-2 text-[10px] font-normal px-2 py-1 rounded shadow-2xs leading-none ${
                        idx === 0
                          ? "bg-[#051D35]/90 text-white border border-[#BE9662]/50"
                          : "bg-black/60 text-white"
                      }`}
                    >
                      {idx === 0 ? "#1 Principală" : `#${idx + 1}`}
                    </span>

                    {editingPhotos && (
                      <>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeletePhoto(idx);
                          }}
                          className="absolute top-2 right-2 h-6 w-6 rounded-md bg-white/95 hover:bg-red-600 text-gray-700 hover:text-white border border-gray-200 hover:border-red-600 flex items-center justify-center shadow-2xs transition-colors cursor-pointer"
                          title="Șterge fotografia"
                        >
                          <Trash2 size={12} />
                        </button>

                        <div className="p-2 bg-white border-t border-gray-200 flex items-center justify-between gap-1">
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMovePhoto(idx, idx - 1);
                            }}
                            className="h-6 w-6 rounded border border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-700 disabled:opacity-35 disabled:cursor-not-allowed flex items-center justify-center cursor-pointer"
                            title="Mută la stânga"
                          >
                            <ArrowLeft size={11} />
                          </button>

                          {idx > 0 ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleMovePhoto(idx, 0);
                              }}
                              className="h-6 px-2 rounded border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-800 text-[10px] font-semibold flex items-center gap-1 cursor-pointer"
                              title="Setează ca fotografie principală"
                            >
                              <Star size={10} />
                              <span>Copertă</span>
                            </button>
                          ) : (
                            <span className="text-[10px] font-semibold text-[#051D35] px-1">Copertă</span>
                          )}

                          <button
                            type="button"
                            disabled={idx === activePhotos.length - 1}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMovePhoto(idx, idx + 1);
                            }}
                            className="h-6 w-6 rounded border border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-700 disabled:opacity-35 disabled:cursor-not-allowed flex items-center justify-center cursor-pointer"
                            title="Mută la dreapta"
                          >
                            <ArrowRight size={11} />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-8 flex flex-col items-center justify-center text-center bg-gray-50 rounded-lg border border-dashed border-gray-200">
              <ImageIcon size={24} className="text-gray-300 mb-2" />
              <p className="text-xs font-semibold text-gray-500">Nicio fotografie atașată</p>
              {!editingPhotos && (
                <p className="text-[11px] text-gray-400 mt-1 font-normal">
                  Apasă „Modifică” pentru a adăuga sau ordona fotografii
                </p>
              )}
            </div>
          )}
        </div>
        )}

        {/* Footer Actions */}
        <div className="px-4 py-3 bg-white border border-gray-200 rounded-xl flex flex-wrap items-center justify-end gap-2 shadow-2xs">
          <div className="flex items-center gap-2 flex-wrap">
            {isPropertyLead && activePhotos.length > 0 && lead.id && (
              <button
                type="button"
                disabled={regeneratingImages || editingPhotos}
                onClick={() => void handleRegenerateImages()}
                className="h-8 px-3 rounded-md border border-[#051D35]/20 bg-[#051D35]/5 hover:bg-[#051D35] text-[#051D35] hover:text-white text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {regeneratingImages ? (
                  <Loader2 size={12} className="animate-spin text-[#BE9662]" />
                ) : (
                  <Wand2 size={12} className="text-[#BE9662]" />
                )}
                <span>
                  {regeneratingImages ? "Se regenerează..." : "Regenerează imagini (ascunde watermark)"}
                </span>
              </button>
            )}

            {isUnprocessed && onAddToMyList && lead.id && (
              <button
                type="button"
                disabled={addingToMyList}
                onClick={async () => {
                  setAddingToMyList(true);
                  try {
                    await onAddToMyList(lead.id!);
                    onBack();
                  } finally {
                    setAddingToMyList(false);
                  }
                }}
                className="h-8 px-3 rounded-md bg-[#051D35] hover:bg-[#0a2b4a] text-white text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-60"
              >
                {addingToMyList ? (
                  <Loader2 size={12} className="animate-spin text-[#BE9662]" />
                ) : (
                  <Bookmark size={12} className="text-[#BE9662]" />
                )}
                <span>{addingToMyList ? "Se procesează..." : "Procesează"}</span>
              </button>
            )}

            {!isCerere && onConvertToCerere && lead.id && (
              <button
                type="button"
                disabled={convertingToCerere}
                onClick={async () => {
                  setConvertingToCerere(true);
                  try {
                    await onConvertToCerere(lead.id!);
                    onBack();
                  } finally {
                    setConvertingToCerere(false);
                  }
                }}
                className="h-8 px-3 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-60 shadow-2xs"
              >
                {convertingToCerere ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <ClipboardList size={12} />
                )}
                <span>{convertingToCerere ? "Se transformă..." : "Transformă în Cerere"}</span>
              </button>
            )}

            {!isCerere && lead.status !== "Pierdute" && onMarkAsLost && lead.id && (
              <button
                type="button"
                onClick={async () => {
                  await onMarkAsLost(lead.id!);
                  onBack();
                }}
                className="h-8 px-3 rounded-md border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs font-semibold transition-colors cursor-pointer"
              >
                Marchează Pierdut
              </button>
            )}

            {!isCerere && lead.status === "Pierdute" && onReactivateLead && lead.id && (
              <button
                type="button"
                onClick={async () => {
                  await onReactivateLead(lead.id!);
                  onBack();
                }}
                className="h-8 px-3 rounded-md border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-semibold transition-colors cursor-pointer"
              >
                Reactivează în Procesate
              </button>
            )}

            {onDeleteLead && lead.id && (
              !confirmDelete ? (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="h-8 px-3 rounded-md bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 shadow-2xs"
                >
                  <Trash2 size={12} />
                  <span>Șterge</span>
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={async () => {
                      setDeleting(true);
                      try {
                        await onDeleteLead(lead.id!);
                        toast.success("Înregistrare ștearsă!");
                        onBack();
                      } finally {
                        setDeleting(false);
                      }
                    }}
                    className="h-8 px-3 rounded-md bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition-colors cursor-pointer"
                  >
                    {deleting ? "Se șterge..." : "Confirmă ștergerea"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="h-8 px-3 rounded-md border border-gray-200 bg-white text-gray-600 text-xs font-semibold hover:bg-gray-50 cursor-pointer"
                  >
                    Anulează
                  </button>
                </div>
              )
            )}
          </div>
        </div>
      </div>

      {/* Lightbox Viewer */}
      {lightboxIdx !== null && activePhotos[lightboxIdx] && (
        <div
          onClick={() => setLightboxIdx(null)}
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setLightboxIdx(null);
            }}
            className="absolute top-4 right-4 h-9 w-9 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center cursor-pointer transition-colors"
            title="Închide"
          >
            <X size={18} />
          </button>

          {activePhotos.length > 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIdx((prev) =>
                  prev === null ? 0 : (prev - 1 + activePhotos.length) % activePhotos.length
                );
              }}
              className="absolute left-4 h-10 w-10 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center cursor-pointer transition-colors"
              title="Anterioara"
            >
              <ChevronLeft size={20} />
            </button>
          )}

          <div
            onClick={(e) => e.stopPropagation()}
            className="max-w-4xl max-h-[85vh] flex flex-col items-center gap-2"
          >
            <img
              src={getThumbnailImageUrl(activePhotos[lightboxIdx], 1600) || activePhotos[lightboxIdx]}
              alt={`${lead.title} - foto ${lightboxIdx + 1}`}
              decoding="async"
              className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-2xl"
              referrerPolicy="no-referrer"
            />
            <span className="text-xs font-medium text-white/80 tabular-nums">
              {lightboxIdx + 1} / {activePhotos.length}
            </span>
          </div>

          {activePhotos.length > 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIdx((prev) =>
                  prev === null ? 0 : (prev + 1) % activePhotos.length
                );
              }}
              className="absolute right-4 h-10 w-10 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center cursor-pointer transition-colors"
              title="Următoarea"
            >
              <ChevronRight size={20} />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
