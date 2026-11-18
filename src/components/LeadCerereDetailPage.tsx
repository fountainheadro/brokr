import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  User,
  MapPin,
  Tag,
  Users,
  Plus,
  MessageCircle,
  Trash2,
  Building2,
  Check,
  Copy,
  Loader2,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  Pencil,
  Image as ImageIcon,
  ArrowLeft,
  ArrowRight,
  Upload,
  X,
  Link as LinkIcon,
  Star
} from "lucide-react";
import { toast } from "react-hot-toast";
import { contactsService, Contact, ContactType } from "../services/contactsService";
import { Lead, leadsService, isCerereLead } from "../services/leadsService";
import { CATEGORIA_OPTIONS, ZONA_OPTIONS } from "../constants";
import { getCleanDisplayImageUrl, getThumbnailImageUrl } from "../utils/imageUtils";
import { getApiAuthHeaders } from "../lib/apiAuth";
import { InlineDetailField } from "./InlineDetailField";

export const MOBILARE_OPTIONS = ["Fără", "Parțială", "Completă"] as const;
export const PARCARE_OPTIONS = ["Fără", "1 loc", "2 locuri", "3 locuri", "4 locuri", "5 locuri"] as const;
export const SURSA_INCALZIRE_OPTIONS = ["Centrală proprie", "Centrală imobil", "Termoficare"] as const;
export const MOD_INCALZIRE_OPTIONS = ["Calorifere", "În pardoseală"] as const;

const formatWhatsAppLink = (phone: string) => {
  const cleanPhone = phone.replace(/\D/g, "");
  const finalPhone = cleanPhone.startsWith("0") ? `40${cleanPhone.substring(1)}` : cleanPhone;
  return `https://wa.me/${finalPhone}`;
};

const normalizeOption = (value: string | undefined, allowed: readonly string[]): string => {
  if (!value) return "";
  return allowed.includes(value) ? value : "";
};

const deriveInitialMobilare = (lead: Lead): string => {
  if (lead.mobilare && MOBILARE_OPTIONS.includes(lead.mobilare as any)) return lead.mobilare;
  const raw = String(lead.extractedData?.crmData?.utilitati?.dotari?.mobilat || "").toLowerCase();
  if (!raw) return "";
  if (raw.includes("complet") || raw.includes("lux") || raw.includes("modern")) return "Completă";
  if (raw.includes("partial") || raw.includes("parțial")) return "Parțială";
  if (raw.includes("nemobilat") || raw.includes("fara") || raw.includes("fără")) return "Fără";
  return "";
};

const deriveInitialParcare = (lead: Lead): string => {
  if (lead.parcare && PARCARE_OPTIONS.includes(lead.parcare as any)) return lead.parcare;
  const count = lead.extractedData?.crmData?.caracteristici?.detalii?.parcari;
  if (count === undefined || count === null || count === "") return "";
  const num = Number(count);
  if (num === 0) return "Fără";
  if (num === 1) return "1 loc";
  if (num >= 2 && num <= 5) return `${num} locuri`;
  return "";
};

const deriveInitialSursaIncalzire = (lead: Lead): string => {
  if (lead.sursaIncalzire && SURSA_INCALZIRE_OPTIONS.includes(lead.sursaIncalzire as any)) return lead.sursaIncalzire;
  const list = lead.extractedData?.crmData?.utilitati?.sistemIncalzire;
  if (Array.isArray(list)) {
    const joined = list.join(" ").toLowerCase();
    if (joined.includes("centrala proprie") || joined.includes("centrală proprie")) return "Centrală proprie";
    if (joined.includes("centrala imobil") || joined.includes("centrală imobil")) return "Centrală imobil";
    if (joined.includes("termoficare")) return "Termoficare";
  }
  return "";
};

const deriveInitialModIncalzire = (lead: Lead): string => {
  if (lead.modIncalzire && MOD_INCALZIRE_OPTIONS.includes(lead.modIncalzire as any)) return lead.modIncalzire;
  const list = lead.extractedData?.crmData?.utilitati?.sistemIncalzire;
  if (Array.isArray(list)) {
    const joined = list.join(" ").toLowerCase();
    if (joined.includes("pardoseal")) return "În pardoseală";
    if (joined.includes("calorifer")) return "Calorifere";
  }
  return "";
};

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
    const norm = getCleanDisplayImageUrl(trimmed) || trimmed;
    if (!seen.has(norm)) {
      seen.add(norm);
      result.push(norm);
    }
  };

  if (Array.isArray(lead.images)) {
    if (lead.coverImage) {
      pushUnique(lead.coverImage);
    }
    lead.images.forEach((img) => pushUnique(img));
    return result;
  }

  if (lead.coverImage) {
    pushUnique(lead.coverImage);
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

interface ContactDraft {
  firstName: string;
  lastName: string;
  phone: string;
  type: ContactType;
}

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
}

export const LeadCerereDetailPage: React.FC<LeadCerereDetailPageProps> = ({
  lead,
  contacts,
  onBack,
  onUpdateLead,
  onContactClick,
  onAddContactClick,
  onDeleteLead,
  onMarkAsLost,
  onReactivateLead,
}) => {
  const [copiedPhone, setCopiedPhone] = useState(false);

  // Per-section edit & saving states
  const [editingPropertyInfo, setEditingPropertyInfo] = useState(false);
  const [savingPropertyInfo, setSavingPropertyInfo] = useState(false);

  const [editingCharacteristics, setEditingCharacteristics] = useState(false);
  const [savingCharacteristics, setSavingCharacteristics] = useState(false);

  const [editingOwner, setEditingOwner] = useState(false);
  const [savingOwner, setSavingOwner] = useState(false);

  const [editingInterestedContacts, setEditingInterestedContacts] = useState(false);
  const [savingInterestedContacts, setSavingInterestedContacts] = useState(false);

  const [editingPhotos, setEditingPhotos] = useState(false);
  const [savingPhotos, setSavingPhotos] = useState(false);
  const [photosDraft, setPhotosDraft] = useState<string[]>(() => deriveInitialPhotos(lead));
  const [photoUrlInput, setPhotoUrlInput] = useState("");
  const [draggedPhotoIdx, setDraggedPhotoIdx] = useState<number | null>(null);
  const [dropPhotoIdx, setDropPhotoIdx] = useState<number | null>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Drafts for Section 1: Informații Imobil
  const initialRooms = lead.extractedData?.crmData?.caracteristici?.detalii?.camere;
  const initialSuprafata = lead.extractedData?.crmData?.caracteristici?.suprafete?.utila;

  const [priceDraft, setPriceDraft] = useState<string>(lead.price || "");
  const [transactionDraft, setTransactionDraft] = useState<"Vânzare" | "Închiriere">(
    lead.transactionType || "Vânzare"
  );
  const [categoriaDraft, setCategoriaDraft] = useState<string>(lead.categoria || "Apartament");
  const [camereDraft, setCamereDraft] = useState<string>(
    initialRooms !== undefined && initialRooms !== null ? String(initialRooms) : ""
  );
  const [suprafataDraft, setSuprafataDraft] = useState<string>(
    initialSuprafata !== undefined && initialSuprafata !== null ? String(initialSuprafata) : ""
  );
  const [zoneDraft, setZoneDraft] = useState<string>(lead.zone || "");
  const [notesDraft, setNotesDraft] = useState<string>(lead.notes || "");

  // Drafts for Section 2: Caracteristici Suplimentare
  const [mobilare, setMobilare] = useState<string>(() => deriveInitialMobilare(lead));
  const [parcare, setParcare] = useState<string>(() => deriveInitialParcare(lead));
  const [sursaIncalzire, setSursaIncalzire] = useState<string>(() => deriveInitialSursaIncalzire(lead));
  const [modIncalzire, setModIncalzire] = useState<string>(() => deriveInitialModIncalzire(lead));

  // Drafts for Section 3 & 4: Proprietar & Contacte Interesate
  const [ownerNameDraft, setOwnerNameDraft] = useState<string>(
    lead.ownerName && lead.ownerName !== "Nespecificat" ? lead.ownerName : ""
  );
  const [ownerPhoneDraft, setOwnerPhoneDraft] = useState<string>(
    lead.ownerPhone && lead.ownerPhone !== "Nespecificat" ? lead.ownerPhone : ""
  );
  const [ownerContactDrafts, setOwnerContactDrafts] = useState<Record<string, ContactDraft>>({});
  const [interestedContactDrafts, setInterestedContactDrafts] = useState<Record<string, ContactDraft>>({});

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isCerere = isCerereLead(lead);
  const renterBuyerContacts = contacts.filter(c => c.type === "Renter" || c.type === "Buyer");
  const ownerContacts = contacts.filter(c => c.type === "Owner");

  // Reset edit states when navigating to a different lead/cerere
  useEffect(() => {
    setEditingPropertyInfo(false);
    setEditingCharacteristics(false);
    setEditingOwner(false);
    setEditingInterestedContacts(false);
    setEditingPhotos(false);
    setPhotoUrlInput("");
    setDraggedPhotoIdx(null);
    setDropPhotoIdx(null);
    setLightboxIdx(null);
    setConfirmDelete(false);
  }, [lead.id]);

  // Keep drafts synchronized with incoming props when their card is NOT actively being edited
  useEffect(() => {
    if (!editingPropertyInfo) {
      const nextRooms = lead.extractedData?.crmData?.caracteristici?.detalii?.camere;
      const nextSuprafata = lead.extractedData?.crmData?.caracteristici?.suprafete?.utila;
      setPriceDraft(lead.price || "");
      setTransactionDraft(lead.transactionType || "Vânzare");
      setCategoriaDraft(lead.categoria || "Apartament");
      setCamereDraft(nextRooms !== undefined && nextRooms !== null ? String(nextRooms) : "");
      setSuprafataDraft(nextSuprafata !== undefined && nextSuprafata !== null ? String(nextSuprafata) : "");
      setZoneDraft(lead.zone || "");
      setNotesDraft(lead.notes || "");
    }
  }, [
    editingPropertyInfo,
    lead.id,
    lead.price,
    lead.transactionType,
    lead.categoria,
    lead.zone,
    lead.notes,
    lead.extractedData?.crmData?.caracteristici?.detalii?.camere,
    lead.extractedData?.crmData?.caracteristici?.suprafete?.utila,
  ]);

  useEffect(() => {
    if (!editingCharacteristics) {
      setMobilare(deriveInitialMobilare(lead));
      setParcare(deriveInitialParcare(lead));
      setSursaIncalzire(deriveInitialSursaIncalzire(lead));
      setModIncalzire(deriveInitialModIncalzire(lead));
    }
  }, [editingCharacteristics, lead.id, lead.mobilare, lead.parcare, lead.sursaIncalzire, lead.modIncalzire]);

  useEffect(() => {
    if (!editingOwner) {
      setOwnerNameDraft(lead.ownerName && lead.ownerName !== "Nespecificat" ? lead.ownerName : "");
      setOwnerPhoneDraft(lead.ownerPhone && lead.ownerPhone !== "Nespecificat" ? lead.ownerPhone : "");
      const map: Record<string, ContactDraft> = {};
      ownerContacts.forEach((c) => {
        if (c.id) {
          map[c.id] = {
            firstName: c.firstName || "",
            lastName: c.lastName || "",
            phone: c.phone || "",
            type: c.type || "Owner",
          };
        }
      });
      setOwnerContactDrafts(map);
    }
  }, [editingOwner, lead.id, lead.ownerName, lead.ownerPhone, contacts]);

  useEffect(() => {
    if (!editingInterestedContacts) {
      const map: Record<string, ContactDraft> = {};
      renterBuyerContacts.forEach((c) => {
        if (c.id) {
          map[c.id] = {
            firstName: c.firstName || "",
            lastName: c.lastName || "",
            phone: c.phone || "",
            type: c.type === "Buyer" ? "Buyer" : "Renter",
          };
        }
      });
      setInterestedContactDrafts(map);
    }
  }, [editingInterestedContacts, lead.id, contacts]);

  useEffect(() => {
    if (!editingPhotos) {
      setPhotosDraft(deriveInitialPhotos(lead));
    }
  }, [editingPhotos, lead]);

  const handleSavePropertyInfo = async () => {
    if (!lead.id) return;

    const cleanPrice = priceDraft.trim() || "Preț la cerere";
    const cleanZone = zoneDraft.trim() || "București";
    const cleanCamere = camereDraft.trim();
    const cleanSuprafata = suprafataDraft.trim();
    const cleanNotes = notesDraft;

    const currentCrm = lead.extractedData?.crmData;
    const shouldBuildExtracted = Boolean(lead.extractedData || cleanCamere || cleanSuprafata);
    const nextExtractedData = shouldBuildExtracted
      ? {
          ...(lead.extractedData || {}),
          crmData: {
            ...(currentCrm || {}),
            ...(currentCrm?.detaliiGenerale
              ? {
                  detaliiGenerale: {
                    ...currentCrm.detaliiGenerale,
                    tranzactie: transactionDraft,
                    categoria: categoriaDraft,
                  },
                }
              : {}),
            caracteristici: {
              ...(currentCrm?.caracteristici || {}),
              detalii: {
                ...(currentCrm?.caracteristici?.detalii || {}),
                camere: cleanCamere,
              },
              suprafete: {
                ...(currentCrm?.caracteristici?.suprafete || {}),
                utila: cleanSuprafata,
              },
            },
            ...(currentCrm?.pret
              ? {
                  pret: {
                    ...currentCrm.pret,
                    detalii: {
                      ...(currentCrm.pret.detalii || {}),
                      pret: cleanPrice,
                    },
                  },
                }
              : {}),
          },
        }
      : undefined;

    const payload: Partial<Lead> = {
      price: cleanPrice,
      transactionType: transactionDraft,
      categoria: categoriaDraft,
      zone: cleanZone,
      notes: cleanNotes,
      ...(nextExtractedData !== undefined ? { extractedData: nextExtractedData as any } : {}),
    };

    setSavingPropertyInfo(true);
    try {
      await leadsService.updateLeadData(lead.id, payload);
      onUpdateLead(payload);
      setEditingPropertyInfo(false);
      toast.success("Informațiile imobilului au fost salvate!");
    } catch (err) {
      console.error("[LeadCerereDetailPage] Failed to save property info:", err);
      toast.error("Eroare la salvarea informațiilor imobilului. Încercați din nou.");
    } finally {
      setSavingPropertyInfo(false);
    }
  };

  const handleSaveCharacteristics = async () => {
    if (!lead.id) return;

    const payload: Partial<Lead> = {
      mobilare: normalizeOption(mobilare, MOBILARE_OPTIONS),
      parcare: normalizeOption(parcare, PARCARE_OPTIONS),
      sursaIncalzire: normalizeOption(sursaIncalzire, SURSA_INCALZIRE_OPTIONS),
      modIncalzire: normalizeOption(modIncalzire, MOD_INCALZIRE_OPTIONS),
    };

    setSavingCharacteristics(true);
    try {
      await leadsService.updateLeadData(lead.id, payload);
      onUpdateLead(payload);
      setEditingCharacteristics(false);
      toast.success("Caracteristicile suplimentare au fost salvate!");
    } catch (err) {
      console.error("[LeadCerereDetailPage] Failed to save additional fields:", err);
      toast.error("Eroare la salvarea detaliilor. Încercați din nou.");
    } finally {
      setSavingCharacteristics(false);
    }
  };

  const handleSaveOwner = async () => {
    if (!lead.id) return;

    const payload: Partial<Lead> = {
      ownerName: ownerNameDraft.trim() || "Nespecificat",
      ownerPhone: ownerPhoneDraft.trim() || "Nespecificat",
    };

    setSavingOwner(true);
    try {
      await leadsService.updateLeadData(lead.id, payload);
      onUpdateLead(payload);

      for (const contact of ownerContacts) {
        if (!contact.id) continue;
        const draft = ownerContactDrafts[contact.id];
        if (!draft) continue;
        const nextFirst = draft.firstName.trim();
        const nextLast = draft.lastName.trim();
        const nextPhone = draft.phone.trim();
        if (
          nextFirst !== (contact.firstName || "") ||
          nextLast !== (contact.lastName || "") ||
          nextPhone !== (contact.phone || "")
        ) {
          await contactsService.updateContact(contact.id, {
            firstName: nextFirst,
            lastName: nextLast,
            phone: nextPhone,
          });
        }
      }

      setEditingOwner(false);
      toast.success("Datele proprietarului au fost salvate!");
    } catch (err) {
      console.error("[LeadCerereDetailPage] Failed to save owner details:", err);
      toast.error("Eroare la salvarea datelor proprietarului. Încercați din nou.");
    } finally {
      setSavingOwner(false);
    }
  };

  const handleSaveInterestedContacts = async () => {
    setSavingInterestedContacts(true);
    try {
      for (const contact of renterBuyerContacts) {
        if (!contact.id) continue;
        const draft = interestedContactDrafts[contact.id];
        if (!draft) continue;
        const nextFirst = draft.firstName.trim();
        const nextLast = draft.lastName.trim();
        const nextPhone = draft.phone.trim();
        const nextType: ContactType = draft.type === "Buyer" ? "Buyer" : "Renter";
        if (
          nextFirst !== (contact.firstName || "") ||
          nextLast !== (contact.lastName || "") ||
          nextPhone !== (contact.phone || "") ||
          nextType !== contact.type
        ) {
          await contactsService.updateContact(contact.id, {
            firstName: nextFirst,
            lastName: nextLast,
            phone: nextPhone,
            type: nextType,
          });
        }
      }

      setEditingInterestedContacts(false);
      toast.success("Contactele interesate au fost salvate!");
    } catch (err) {
      console.error("[LeadCerereDetailPage] Failed to save interested contacts:", err);
      toast.error("Eroare la salvarea contactelor interesate. Încercați din nou.");
    } finally {
      setSavingInterestedContacts(false);
    }
  };

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
      for (let i = 0; i < photosDraft.length; i++) {
        const photo = photosDraft[i];
        if (photo.startsWith("data:")) {
          const authHeaders = await getApiAuthHeaders({ "Content-Type": "application/json" });
          const res = await fetch("/api/upload-photo", {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({
              dataUrl: photo,
              propertyId: lead.propertyId || lead.id,
              fileName: `lead_${lead.id}_${Date.now()}_${i}.jpg`,
            }),
          });
          if (!res.ok) {
            const errJson = await res.json().catch(() => ({}));
            throw new Error(errJson?.error || "Eroare la încărcarea fotografiei pe server.");
          }
          const uploadData = await res.json();
          if (uploadData?.url) {
            finalPhotos.push(uploadData.url);
          }
        } else {
          const clean = getCleanDisplayImageUrl(photo) || photo;
          if (clean && !finalPhotos.includes(clean)) {
            finalPhotos.push(clean);
          }
        }
      }

      const nextCover = finalPhotos[0] || "";
      const existingCrm = lead.extractedData?.crmData;

      let nextExtractedData = lead.extractedData;
      if (existingCrm) {
        const prevImagini = (existingCrm.imagini || {}) as Record<string, unknown>;
        const finalSet = new Set(finalPhotos);
        const filterCategory = (arr: unknown): Array<{ original: string } | string> => {
          if (!Array.isArray(arr)) return [];
          return arr.filter((item) => {
            const u = extractImageUrl(item);
            const clean = getCleanDisplayImageUrl(u) || u;
            return Boolean(clean && finalSet.has(clean));
          });
        };

        const updatedImagini: Record<string, Array<{ original: string } | string>> = {
          living: filterCategory(prevImagini.living),
          camera: filterCategory(prevImagini.camera),
          bucatarie: filterCategory(prevImagini.bucatarie),
          baie: filterCategory(prevImagini.baie),
          alteSpatii: filterCategory(prevImagini.alteSpatii),
        };

        const presentSet = new Set<string>();
        (["living", "camera", "bucatarie", "baie", "alteSpatii"] as const).forEach((cat) => {
          updatedImagini[cat].forEach((item) => {
            const u = extractImageUrl(item);
            const clean = getCleanDisplayImageUrl(u) || u;
            if (clean) presentSet.add(clean);
          });
        });

        finalPhotos.forEach((imgUrl) => {
          if (!presentSet.has(imgUrl)) {
            updatedImagini.alteSpatii.push({ original: imgUrl });
            presentSet.add(imgUrl);
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

      await leadsService.updateLeadData(lead.id, payload);
      setPhotosDraft(finalPhotos);
      onUpdateLead(payload);
      setEditingPhotos(false);
      toast.success("Fotografiile au fost salvate!");
    } catch (err: any) {
      console.error("[LeadCerereDetailPage] Failed to save photos:", err);
      toast.error(err?.message || "Eroare la salvarea fotografiilor. Încercați din nou.");
    } finally {
      setSavingPhotos(false);
    }
  };

  const handleCopyPhone = async (phone: string) => {
    try {
      await navigator.clipboard.writeText(phone);
      setCopiedPhone(true);
      setTimeout(() => setCopiedPhone(false), 2000);
      toast.success("Numărul de telefon a fost copiat!");
    } catch {
      toast.error("Nu s-a putut copia numărul.");
    }
  };

  const rooms = lead.extractedData?.crmData?.caracteristici?.detalii?.camere;
  const suprafata = lead.extractedData?.crmData?.caracteristici?.suprafete?.utila;

  const savedPhotos = useMemo(() => deriveInitialPhotos(lead), [lead]);
  const activePhotos = editingPhotos ? photosDraft : savedPhotos;
  const displayImage = lead.coverImage || savedPhotos[0] || null;

  const categoryChoices = CATEGORIA_OPTIONS.includes(categoriaDraft)
    ? CATEGORIA_OPTIONS
    : categoriaDraft
      ? [categoriaDraft, ...CATEGORIA_OPTIONS]
      : CATEGORIA_OPTIONS;

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 custom-scrollbar">
      <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4 text-xs">
        {/* Section 1: Informații Imobil */}
        <div className="p-4 sm:p-5 bg-white border border-gray-200 rounded-xl space-y-4 shadow-2xs">
          <div className="flex items-center justify-between pb-3 border-b border-gray-100">
            <span className="font-title text-[12px] font-semibold text-[#051D35] flex items-center gap-2">
              <Tag size={12} className="text-[#BE9662]" />
              <span className="font-title font-semibold">Informații Imobil</span>
            </span>

            <SectionEditButton
              isEditing={editingPropertyInfo}
              isSaving={savingPropertyInfo}
              onStartEdit={() => {
                setPriceDraft(lead.price || "");
                setTransactionDraft(lead.transactionType || "Vânzare");
                setCategoriaDraft(lead.categoria || "Apartament");
                setCamereDraft(rooms !== undefined && rooms !== null ? String(rooms) : "");
                setSuprafataDraft(suprafata !== undefined && suprafata !== null ? String(suprafata) : "");
                setZoneDraft(lead.zone || "");
                setNotesDraft(lead.notes || "");
                setEditingPropertyInfo(true);
              }}
              onSave={() => void handleSavePropertyInfo()}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-start">
            <div className={`sm:col-span-8 grid grid-cols-2 text-xs ${editingPropertyInfo ? "gap-[16px]" : "gap-4"}`}>
              <InlineDetailField
                label="Preț cerut"
                value={lead.price || "Preț la cerere"}
                editValue={priceDraft}
                isEditing={editingPropertyInfo}
                onChange={setPriceDraft}
                placeholder="Ex: 120.000 €"
                valueClassName="text-[12px] font-normal text-[#051D35] tabular-nums"
                className="col-span-2"
              />

              <InlineDetailField
                label="Tranzacție"
                value={lead.transactionType || "Vânzare"}
                editValue={transactionDraft}
                isEditing={editingPropertyInfo}
                onChange={(val) => setTransactionDraft(val as "Vânzare" | "Închiriere")}
                options={["Vânzare", "Închiriere"]}
                valueClassName="font-normal text-gray-800"
              />

              <InlineDetailField
                label="Categorie"
                value={lead.categoria || "Apartament"}
                editValue={categoriaDraft}
                isEditing={editingPropertyInfo}
                onChange={setCategoriaDraft}
                options={categoryChoices}
                valueClassName="font-normal text-gray-800"
              />

              <InlineDetailField
                label="Camere"
                value={rooms ? `${rooms} camere` : "-"}
                editValue={camereDraft}
                isEditing={editingPropertyInfo}
                onChange={setCamereDraft}
                placeholder="Ex: 2"
                valueClassName="font-normal text-gray-800 tabular-nums"
              />

              <InlineDetailField
                label="Suprafață utilă"
                value={suprafata ? `${suprafata} mp` : "-"}
                editValue={suprafataDraft}
                isEditing={editingPropertyInfo}
                onChange={setSuprafataDraft}
                placeholder="Ex: 65"
                valueClassName="font-normal text-gray-800 tabular-nums"
              />

              <InlineDetailField
                label="Zonă"
                value={lead.zone || "București"}
                editValue={zoneDraft}
                isEditing={editingPropertyInfo}
                onChange={setZoneDraft}
                placeholder="Ex: Titan, București"
                datalistId="lead-cerere-zona-options"
                datalistOptions={ZONA_OPTIONS}
                valueClassName="font-normal text-gray-800"
                className="col-span-2"
              />
            </div>

            {/* Thumbnail */}
            <div className="sm:col-span-4">
              <div className="w-full h-36 sm:h-44 rounded-lg overflow-hidden bg-gray-100 border border-gray-200 flex items-center justify-center shadow-2xs">
                {displayImage ? (
                  <img
                    src={getThumbnailImageUrl(displayImage, 560)}
                    alt={lead.title}
                    decoding="async"
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center text-gray-300">
                    <Building2 size={24} className="text-gray-300 mb-1" />
                    <span className="text-[10px] font-semibold uppercase text-gray-400">Fără imagine</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className={`border-t border-gray-100 ${editingPropertyInfo ? "pt-[16px]" : "pt-4"}`}>
            <InlineDetailField
              label="Note"
              value={lead.notes || ""}
              editValue={notesDraft}
              isEditing={editingPropertyInfo}
              onChange={setNotesDraft}
              placeholder="Adaugă note sau cerințe..."
              emptyText="Fără note adăugate"
              multiline
              rows={1}
              autoHeightMaxRows={10}
              valueClassName="text-gray-700 font-normal"
            />
          </div>
        </div>

        {/* Section 2: Caracteristici Suplimentare (Two Fields Per Row) */}
        <div className="p-4 sm:p-5 bg-white border border-gray-200 rounded-xl space-y-4 shadow-2xs">
          <div className="flex items-center justify-between pb-3 border-b border-gray-100">
            <span className="font-title text-[12px] font-semibold text-[#051D35] flex items-center gap-2">
              <SlidersHorizontal size={13} className="text-[#BE9662]" />
              <span className="font-title font-semibold">Caracteristici Suplimentare</span>
            </span>

            <SectionEditButton
              isEditing={editingCharacteristics}
              isSaving={savingCharacteristics}
              onStartEdit={() => {
                setMobilare(deriveInitialMobilare(lead));
                setParcare(deriveInitialParcare(lead));
                setSursaIncalzire(deriveInitialSursaIncalzire(lead));
                setModIncalzire(deriveInitialModIncalzire(lead));
                setEditingCharacteristics(true);
              }}
              onSave={() => void handleSaveCharacteristics()}
            />
          </div>

          <div className={`grid grid-cols-1 sm:grid-cols-2 ${editingCharacteristics ? "gap-[16px]" : "gap-4"}`}>
            <InlineDetailField
              label="Mobilare"
              value={mobilare || "-"}
              editValue={mobilare}
              isEditing={editingCharacteristics}
              onChange={(val) => setMobilare(normalizeOption(val, MOBILARE_OPTIONS))}
              options={MOBILARE_OPTIONS}
              emptyOptionLabel="Selectează..."
              valueClassName="font-normal text-gray-800"
            />

            <InlineDetailField
              label="Parcare"
              value={parcare || "-"}
              editValue={parcare}
              isEditing={editingCharacteristics}
              onChange={(val) => setParcare(normalizeOption(val, PARCARE_OPTIONS))}
              options={PARCARE_OPTIONS}
              emptyOptionLabel="Selectează..."
              valueClassName="font-normal text-gray-800"
            />

            <InlineDetailField
              label="Sursă încălzire"
              value={sursaIncalzire || "-"}
              editValue={sursaIncalzire}
              isEditing={editingCharacteristics}
              onChange={(val) => setSursaIncalzire(normalizeOption(val, SURSA_INCALZIRE_OPTIONS))}
              options={SURSA_INCALZIRE_OPTIONS}
              emptyOptionLabel="Selectează..."
              valueClassName="font-normal text-gray-800"
            />

            <InlineDetailField
              label="Mod încălzire"
              value={modIncalzire || "-"}
              editValue={modIncalzire}
              isEditing={editingCharacteristics}
              onChange={(val) => setModIncalzire(normalizeOption(val, MOD_INCALZIRE_OPTIONS))}
              options={MOD_INCALZIRE_OPTIONS}
              emptyOptionLabel="Selectează..."
              valueClassName="font-normal text-gray-800"
            />
          </div>
        </div>

        {/* Split Sections: Proprietar & Contacte Interesate */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Section 3: Proprietar */}
          <div className="p-4 sm:p-5 bg-white border border-gray-200 rounded-xl space-y-4 flex flex-col justify-between shadow-2xs">
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-gray-100 gap-2">
                <span className="font-title text-[12px] font-semibold text-[#051D35] flex items-center gap-2">
                  <User size={13} className="text-[#051D35]" />
                  <span className="font-title font-semibold">Proprietar</span>
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onAddContactClick}
                    className="h-8 px-2 text-[11px] font-medium text-[#051D35] hover:bg-gray-100 rounded-md transition-colors flex items-center gap-1 cursor-pointer"
                    title="Adaugă contact"
                  >
                    <Plus size={12} className="text-[#BE9662]" />
                    <span>Adaugă</span>
                  </button>
                  <SectionEditButton
                    isEditing={editingOwner}
                    isSaving={savingOwner}
                    onStartEdit={() => {
                      setOwnerNameDraft(
                        lead.ownerName && lead.ownerName !== "Nespecificat" ? lead.ownerName : ""
                      );
                      setOwnerPhoneDraft(
                        lead.ownerPhone && lead.ownerPhone !== "Nespecificat" ? lead.ownerPhone : ""
                      );
                      const map: Record<string, ContactDraft> = {};
                      ownerContacts.forEach((c) => {
                        if (c.id) {
                          map[c.id] = {
                            firstName: c.firstName || "",
                            lastName: c.lastName || "",
                            phone: c.phone || "",
                            type: c.type || "Owner",
                          };
                        }
                      });
                      setOwnerContactDrafts(map);
                      setEditingOwner(true);
                    }}
                    onSave={() => void handleSaveOwner()}
                  />
                </div>
              </div>

              {/* Primary Owner Fields (Clean label-above / info-below, zero container box in view mode) */}
              <div className={editingOwner ? "space-y-[16px]" : "space-y-4"}>
                <InlineDetailField
                  label="Nume proprietar"
                  labelSuffix={
                    <span className="text-[10px] font-semibold text-[#BE9662]">· Principal</span>
                  }
                  value={lead.ownerName && lead.ownerName !== "Nespecificat" ? lead.ownerName : "-"}
                  editValue={ownerNameDraft}
                  isEditing={editingOwner}
                  onChange={setOwnerNameDraft}
                  placeholder="Nume proprietar"
                  emptyText="Nespecificat"
                  valueClassName="font-normal text-gray-900"
                />

                <InlineDetailField
                  label="Telefon proprietar"
                  type="tel"
                  value={lead.ownerPhone && lead.ownerPhone !== "Nespecificat" ? lead.ownerPhone : "-"}
                  editValue={ownerPhoneDraft}
                  isEditing={editingOwner}
                  onChange={setOwnerPhoneDraft}
                  placeholder="Ex: 0722 000 000"
                  emptyText="Telefon nespecificat"
                  valueClassName="font-normal text-gray-800 tabular-nums"
                  viewActions={
                    lead.ownerPhone && lead.ownerPhone !== "Nespecificat" ? (
                      <>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleCopyPhone(lead.ownerPhone);
                          }}
                          className="flex items-center justify-center w-6 h-6 rounded-md bg-white border border-gray-200 text-gray-400 hover:text-[#051D35] transition-colors cursor-pointer"
                          title="Copiază telefon"
                        >
                          {copiedPhone ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
                        </button>
                        <a
                          href={formatWhatsAppLink(lead.ownerPhone)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="h-6 px-2 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[10px] font-semibold flex items-center gap-1 border border-emerald-200 transition-colors"
                          title="WhatsApp"
                        >
                          <MessageCircle size={10} />
                          <span>WA</span>
                        </a>
                      </>
                    ) : undefined
                  }
                />
              </div>

              {/* Additional Owner Contacts */}
              {ownerContacts.length > 0 && (
                <div className="pt-4 border-t border-gray-100 space-y-2">
                  <span className="text-[12px] font-semibold text-[#051D35] block">
                    Alte Contacte Proprietar ({ownerContacts.length})
                  </span>
                  <div className="divide-y divide-gray-100">
                    {ownerContacts.map((contact, idx) => {
                      const draft = contact.id ? ownerContactDrafts[contact.id] : undefined;
                      const isRowEditing = Boolean(editingOwner && contact.id && draft);

                      return (
                        <div
                          key={contact.id || idx}
                          onClick={() => {
                            if (!editingOwner) onContactClick(contact);
                          }}
                          className={`py-3 grid grid-cols-2 ${editingOwner ? "gap-[16px]" : "gap-4"} ${
                            !editingOwner ? "cursor-pointer hover:bg-gray-50/50 -mx-2 px-2 rounded-md transition-colors" : ""
                          }`}
                        >
                          <InlineDetailField
                            label="Prenume"
                            value={contact.firstName || "-"}
                            editValue={draft?.firstName}
                            isEditing={isRowEditing}
                            onChange={(val) =>
                              contact.id &&
                              draft &&
                              setOwnerContactDrafts((prev) => ({
                                ...prev,
                                [contact.id!]: { ...draft, firstName: val },
                              }))
                            }
                            placeholder="Prenume"
                            valueClassName="font-normal text-gray-800"
                          />
                          <InlineDetailField
                            label="Nume"
                            value={contact.lastName || "-"}
                            editValue={draft?.lastName}
                            isEditing={isRowEditing}
                            onChange={(val) =>
                              contact.id &&
                              draft &&
                              setOwnerContactDrafts((prev) => ({
                                ...prev,
                                [contact.id!]: { ...draft, lastName: val },
                              }))
                            }
                            placeholder="Nume"
                            valueClassName="font-normal text-gray-800"
                          />
                          <InlineDetailField
                            label="Telefon"
                            type="tel"
                            value={contact.phone || "-"}
                            editValue={draft?.phone}
                            isEditing={isRowEditing}
                            onChange={(val) =>
                              contact.id &&
                              draft &&
                              setOwnerContactDrafts((prev) => ({
                                ...prev,
                                [contact.id!]: { ...draft, phone: val },
                              }))
                            }
                            placeholder="Telefon"
                            valueClassName="text-gray-700 font-normal tabular-nums"
                            className="col-span-2"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Section 4: Contacte Interesate */}
          <div className="p-4 sm:p-5 bg-white border border-gray-200 rounded-xl space-y-4 flex flex-col justify-between shadow-2xs">
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-gray-100 gap-2">
                <span className="font-title text-[12px] font-semibold text-[#051D35] flex items-center gap-2">
                  <Users size={13} className="text-[#BE9662]" />
                  <span className="font-title font-semibold">Contacte Interesate ({renterBuyerContacts.length})</span>
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onAddContactClick}
                    className="h-8 px-2 text-[11px] font-medium text-[#051D35] hover:bg-gray-100 rounded-md transition-colors flex items-center gap-1 cursor-pointer"
                    title="Adaugă client"
                  >
                    <Plus size={12} className="text-[#BE9662]" />
                    <span>Adaugă</span>
                  </button>
                  <SectionEditButton
                    isEditing={editingInterestedContacts}
                    isSaving={savingInterestedContacts}
                    onStartEdit={() => {
                      const map: Record<string, ContactDraft> = {};
                      renterBuyerContacts.forEach((c) => {
                        if (c.id) {
                          map[c.id] = {
                            firstName: c.firstName || "",
                            lastName: c.lastName || "",
                            phone: c.phone || "",
                            type: c.type === "Buyer" ? "Buyer" : "Renter",
                          };
                        }
                      });
                      setInterestedContactDrafts(map);
                      setEditingInterestedContacts(true);
                    }}
                    onSave={() => void handleSaveInterestedContacts()}
                  />
                </div>
              </div>

              {renterBuyerContacts.length > 0 ? (
                <div className="divide-y divide-gray-100 max-h-72 overflow-y-auto pr-1 custom-scrollbar">
                  {renterBuyerContacts.map((contact, idx) => {
                    const draft = contact.id ? interestedContactDrafts[contact.id] : undefined;
                    const isRowEditing = Boolean(editingInterestedContacts && contact.id && draft);
                    const typeLabel = contact.type === "Buyer" ? "Cumpărător" : "Chiriaș";

                    return (
                      <div
                        key={contact.id || idx}
                        onClick={() => {
                          if (!editingInterestedContacts) onContactClick(contact);
                        }}
                        className={`py-3 first:pt-0 last:pb-0 grid grid-cols-2 ${editingInterestedContacts ? "gap-[16px]" : "gap-4"} group ${
                          !editingInterestedContacts
                            ? "cursor-pointer hover:bg-gray-50/50 -mx-2 px-2 rounded-md transition-colors"
                            : ""
                        }`}
                      >
                        <InlineDetailField
                          label="Prenume"
                          value={contact.firstName || "-"}
                          editValue={draft?.firstName}
                          isEditing={isRowEditing}
                          onChange={(val) =>
                            contact.id &&
                            draft &&
                            setInterestedContactDrafts((prev) => ({
                              ...prev,
                              [contact.id!]: { ...draft, firstName: val },
                            }))
                          }
                          placeholder="Prenume"
                          valueClassName="font-normal text-gray-900"
                        />

                        <InlineDetailField
                          label="Nume"
                          value={contact.lastName || "-"}
                          editValue={draft?.lastName}
                          isEditing={isRowEditing}
                          onChange={(val) =>
                            contact.id &&
                            draft &&
                            setInterestedContactDrafts((prev) => ({
                              ...prev,
                              [contact.id!]: { ...draft, lastName: val },
                            }))
                          }
                          placeholder="Nume"
                          valueClassName="font-normal text-gray-900"
                        />

                        <InlineDetailField
                          label="Tip"
                          value={typeLabel}
                          editValue={draft?.type === "Buyer" ? "Cumpărător" : "Chiriaș"}
                          isEditing={isRowEditing}
                          onChange={(val) =>
                            contact.id &&
                            draft &&
                            setInterestedContactDrafts((prev) => ({
                              ...prev,
                              [contact.id!]: {
                                ...draft,
                                type: val === "Cumpărător" ? "Buyer" : "Renter",
                              },
                            }))
                          }
                          options={["Cumpărător", "Chiriaș"]}
                          valueClassName={
                            contact.type === "Buyer"
                              ? "font-normal text-blue-700"
                              : "font-normal text-emerald-700"
                          }
                        />

                        <InlineDetailField
                          label="Telefon"
                          type="tel"
                          value={contact.phone || "-"}
                          editValue={draft?.phone}
                          isEditing={isRowEditing}
                          onChange={(val) =>
                            contact.id &&
                            draft &&
                            setInterestedContactDrafts((prev) => ({
                              ...prev,
                              [contact.id!]: { ...draft, phone: val },
                            }))
                          }
                          placeholder="Telefon"
                          valueClassName="text-gray-700 font-normal tabular-nums"
                          viewActions={
                            contact.id ? (
                              <button
                                type="button"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  try {
                                    await contactsService.deleteContact(contact.id!);
                                    toast.success("Contact șters");
                                  } catch {
                                    toast.error("Eroare la ștergere");
                                  }
                                }}
                                className="p-1 text-gray-400 hover:text-red-600 rounded transition-colors cursor-pointer"
                                title="Șterge contact"
                              >
                                <Trash2 size={12} />
                              </button>
                            ) : undefined
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-2 flex flex-col items-center justify-center py-6 text-center rounded border border-dashed border-gray-200">
                  <Users size={20} className="text-gray-300 mb-1" />
                  <p className="text-[11px] text-gray-400">Niciun contact alocat</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Section 5: Fotografii */}
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

        {/* Footer Status & Actions */}
        <div className="px-4 py-3 bg-white border border-gray-200 rounded-xl flex flex-wrap items-center justify-between gap-2 shadow-2xs">
          <span className="text-[11px] text-gray-400 font-semibold">
            Status: <span className="text-gray-700 font-normal">{lead.status}</span>
          </span>

          <div className="flex items-center gap-2 flex-wrap">
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
                Reactivează ca Nou
              </button>
            )}

            {onDeleteLead && lead.id && (
              !confirmDelete ? (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="h-8 px-3 rounded-md border border-gray-200 bg-white hover:bg-red-50 hover:border-red-200 text-gray-600 hover:text-red-700 text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1"
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

            <button
              type="button"
              onClick={onBack}
              className="h-8 px-3 border border-gray-200 text-gray-700 hover:text-gray-900 hover:bg-gray-50 rounded-md transition-colors cursor-pointer text-xs font-medium flex items-center gap-1"
            >
              <ChevronLeft size={13} />
              <span>Înapoi la listă</span>
            </button>
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
