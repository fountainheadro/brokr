import {
  Firestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  serverTimestamp,
  DocumentData,
  QueryConstraint,
} from "firebase/firestore";
import { AppError } from "../errors/app_error";

export interface TenantScopedEntity {
  id: string;
  tenantId: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  createdBy?: string;
  updatedBy?: string;
  deletedAt?: unknown | null;
  tenant_id?: string;
  created_at?: unknown;
  updated_at?: unknown;
  deleted_at?: unknown | null;
}

/**
 * TenantScopedRepository: Centralized database convention.
 * Guarantees all read/write operations strictly bind to the authenticated tenant.
 */
export class TenantScopedRepository<T extends TenantScopedEntity> {
  constructor(
    protected readonly firestore: Firestore,
    protected readonly collectionName: string
  ) {}

  protected getCollectionRef(tenantId: string) {
    if (!tenantId || typeof tenantId !== "string") {
      throw new AppError({
        message: "Operațiune de bază de date eșuată: Lipsă tenantId valid.",
        code: "UNAUTHORIZED",
        statusCode: 401,
      });
    }
    // Subcollection partitioning: /tenants/{tenantId}/{collectionName}
    return collection(this.firestore, "tenants", tenantId, this.collectionName);
  }

  public async findById(tenantId: string, id: string): Promise<T | null> {
    const docRef = doc(this.getCollectionRef(tenantId), id);
    const snapshot = await getDoc(docRef);
    if (!snapshot.exists()) return null;
    const raw = snapshot.data();
    return {
      id: snapshot.id,
      ...raw,
      tenantId: raw.tenantId ?? raw.tenant_id,
      createdAt: raw.createdAt ?? raw.created_at,
      updatedAt: raw.updatedAt ?? raw.updated_at,
      deletedAt: raw.deletedAt ?? raw.deleted_at,
    } as T;
  }

  public async list(tenantId: string, constraints: QueryConstraint[] = []): Promise<T[]> {
    const colRef = this.getCollectionRef(tenantId);
    const q = query(colRef, ...constraints);
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => {
      const raw = d.data();
      return {
        id: d.id,
        ...raw,
        tenantId: raw.tenantId ?? raw.tenant_id,
        createdAt: raw.createdAt ?? raw.created_at,
        updatedAt: raw.updatedAt ?? raw.updated_at,
        deletedAt: raw.deletedAt ?? raw.deleted_at,
      } as T;
    });
  }

  public async create(
    tenantId: string,
    id: string,
    data: Omit<T, "id" | "tenantId" | "createdAt" | "updatedAt">,
    userId?: string
  ): Promise<T> {
    const docRef = doc(this.getCollectionRef(tenantId), id);
    const sanitized: DocumentData = { ...data };
    delete sanitized.tenant_id;
    delete sanitized.created_at;
    delete sanitized.updated_at;
    delete sanitized.deleted_at;

    const payload: DocumentData = {
      ...sanitized,
      id,
      tenantId,
      createdBy: userId || null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      deletedAt: null,
    };
    await setDoc(docRef, payload);
    return payload as T;
  }

  public async update(tenantId: string, id: string, data: Partial<T>, userId?: string): Promise<void> {
    const docRef = doc(this.getCollectionRef(tenantId), id);
    const payload: DocumentData = {
      ...data,
      updatedBy: userId || null,
      updatedAt: serverTimestamp(),
    };
    // Ensure tenantId can never be tampered with or reassigned
    delete payload.tenantId;
    delete payload.tenant_id;
    delete payload.id;
    delete payload.createdAt;
    delete payload.created_at;

    await updateDoc(docRef, payload);
  }
}
