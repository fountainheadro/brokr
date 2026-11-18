import {
  Firestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  limit as firestoreLimit,
  serverTimestamp,
  DocumentData,
  QueryConstraint,
} from "firebase/firestore";
import { AppError, NotFoundError } from "../errors/app_error";

export interface TenantScopedEntity {
  id: string;
  tenantId: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  createdBy?: string | null;
  updatedBy?: string | null;
  deletedAt?: unknown | null;
  // Legacy read-compatibility aliases
  tenant_id?: string;
  created_at?: unknown;
  updated_at?: unknown;
  created_by?: string | null;
  updated_by?: string | null;
  deleted_at?: unknown | null;
  [key: string]: unknown;
}

export interface ListOptions {
  limit?: number;
  offset?: number;
  includeDeleted?: boolean;
  constraints?: QueryConstraint[];
}

function normalizeRepoEntity<T extends TenantScopedEntity>(raw: Record<string, any>): T {
  const out: Record<string, any> = { ...raw };
  if (out.tenantId === undefined && out.tenant_id !== undefined) out.tenantId = out.tenant_id;
  if (out.createdAt === undefined && out.created_at !== undefined) out.createdAt = out.created_at;
  if (out.updatedAt === undefined && out.updated_at !== undefined) out.updatedAt = out.updated_at;
  if (out.createdBy === undefined && out.created_by !== undefined) out.createdBy = out.created_by;
  if (out.updatedBy === undefined && out.updated_by !== undefined) out.updatedBy = out.updated_by;
  if (out.deletedAt === undefined && out.deleted_at !== undefined) out.deletedAt = out.deleted_at;
  return out as T;
}

/**
 * TenantScopedRepository: Centralized database repository.
 * Guarantees all read/write operations strictly bind to the authenticated tenant.
 *
 * Firestore structure:
 * /tenants/{tenantId}/{collectionName}/{id}
 */
export class TenantScopedRepository<T extends TenantScopedEntity> {
  // In-memory backing store for local testing or mock environments
  private static inMemoryStore = new Map<string, TenantScopedEntity>();

  constructor(
    protected readonly firestore: Firestore | null,
    protected readonly collectionName: string
  ) {}

  public static clearInMemoryStore(): void {
    this.inMemoryStore.clear();
  }

  public static getInMemoryStorageKey(tenantId: string, collectionName: string, id: string): string {
    return `${tenantId}::${collectionName}::${id}`;
  }

  protected validateTenantId(tenantId: string): void {
    if (!tenantId || typeof tenantId !== "string" || tenantId.trim() === "") {
      throw new AppError({
        message: "Operațiune de bază de date eșuată: Lipsă tenantId valid.",
        code: "UNAUTHORIZED",
        statusCode: 401,
      });
    }
  }

  protected getCollectionRef(tenantId: string) {
    this.validateTenantId(tenantId);
    if (!this.firestore) {
      throw new AppError({
        message: "Firestore instance not available.",
        code: "INTERNAL_ERROR",
        statusCode: 500,
      });
    }
    // Subcollection partitioning: /tenants/{tenantId}/{collectionName}
    return collection(this.firestore, "tenants", tenantId, this.collectionName);
  }

  /**
   * Retrieves a document by its ID scoped to the verified tenant.
   * If a document belongs to another tenant, it will return null (isolation).
   */
  public async findById(tenantId: string, id: string): Promise<T | null> {
    this.validateTenantId(tenantId);

    // If no live Firestore instance, use in-memory store (e.g. during test suites)
    if (!this.firestore) {
      const key = TenantScopedRepository.getInMemoryStorageKey(tenantId, this.collectionName, id);
      const entity = TenantScopedRepository.inMemoryStore.get(key);
      if (!entity) return null;
      const deletedMarker = entity.deletedAt ?? entity.deleted_at;
      if (deletedMarker && deletedMarker !== null) {
        return null;
      }
      return normalizeRepoEntity<T>({ ...entity });
    }

    const docRef = doc(this.getCollectionRef(tenantId), id);
    const snapshot = await getDoc(docRef);
    if (!snapshot.exists()) return null;
    const data = snapshot.data();
    const deletedMarker = data.deletedAt ?? data.deleted_at;
    if (deletedMarker && deletedMarker !== null) return null;
    return normalizeRepoEntity<T>({ id: snapshot.id, ...data });
  }

  /**
   * Verifies if a document exists and is strictly owned by the specified tenant.
   */
  public async verifyOwnership(tenantId: string, id: string): Promise<boolean> {
    const doc = await this.findById(tenantId, id);
    return doc !== null && (doc.tenantId ?? doc.tenant_id) === tenantId;
  }

  public static readonly DEFAULT_LIST_LIMIT = 200;
  public static readonly MAX_LIST_LIMIT = 500;

  /**
   * Lists documents in the tenant collection with bounded pagination and filters.
   */
  public async list(
    tenantId: string,
    options: ListOptions = {}
  ): Promise<{ items: T[]; total: number }> {
    this.validateTenantId(tenantId);
    const effectiveLimit = Math.min(
      TenantScopedRepository.MAX_LIST_LIMIT,
      Math.max(1, options.limit ?? TenantScopedRepository.DEFAULT_LIST_LIMIT)
    );

    if (!this.firestore) {
      const prefix = `${tenantId}::${this.collectionName}::`;
      let items: T[] = [];
      for (const [k, v] of TenantScopedRepository.inMemoryStore.entries()) {
        if (k.startsWith(prefix)) {
          const deletedMarker = v.deletedAt ?? v.deleted_at;
          if (!options.includeDeleted && deletedMarker) {
            continue;
          }
          items.push(normalizeRepoEntity<T>({ ...v }));
        }
      }
      const total = items.length;
      if (options.offset) {
        items = items.slice(options.offset);
      }
      items = items.slice(0, effectiveLimit);
      return { items, total };
    }

    const colRef = this.getCollectionRef(tenantId);
    const queryConstraints: QueryConstraint[] = [...(options.constraints || [])];
    queryConstraints.push(firestoreLimit(effectiveLimit));

    const q = query(colRef, ...queryConstraints);
    const snapshot = await getDocs(q);
    const items = snapshot.docs
      .map((d) => normalizeRepoEntity<T>({ id: d.id, ...d.data() }))
      .filter((i) => options.includeDeleted || !(i.deletedAt ?? i.deleted_at));

    return { items, total: items.length };
  }

  /**
   * Creates a new document strictly bound to the verified tenant.
   * Overriding tenantId / tenant_id in the payload is prevented.
   */
  public async create(
    tenantId: string,
    id: string,
    data: Omit<T, "id" | "tenantId" | "createdAt" | "updatedAt">,
    userId?: string
  ): Promise<T> {
    this.validateTenantId(tenantId);

    const sanitized: DocumentData = { ...data };
    delete sanitized.tenant_id;
    delete sanitized.created_at;
    delete sanitized.updated_at;
    delete sanitized.deleted_at;

    const now = new Date().toISOString();
    const payload: DocumentData = {
      ...sanitized,
      id,
      tenantId, // Enforced server-side
      createdBy: userId || null,
      createdAt: this.firestore ? serverTimestamp() : now,
      updatedAt: this.firestore ? serverTimestamp() : now,
      deletedAt: null,
    };

    if (!this.firestore) {
      const key = TenantScopedRepository.getInMemoryStorageKey(tenantId, this.collectionName, id);
      TenantScopedRepository.inMemoryStore.set(key, { ...payload } as T);
      return payload as T;
    }

    const docRef = doc(this.getCollectionRef(tenantId), id);
    await setDoc(docRef, payload);
    return payload as T;
  }

  /**
   * Updates an existing document. Prevents tampering with tenantId, id, or createdAt.
   */
  public async update(
    tenantId: string,
    id: string,
    data: Partial<T>,
    userId?: string
  ): Promise<void> {
    this.validateTenantId(tenantId);

    const existing = await this.findById(tenantId, id);
    if (!existing) {
      throw new NotFoundError(this.collectionName, id);
    }

    const payload: DocumentData = {
      ...data,
      updatedBy: userId || null,
      updatedAt: this.firestore ? serverTimestamp() : new Date().toISOString(),
    };

    // Immutable fields safeguard: cannot reassign document to another tenant
    delete payload.tenantId;
    delete payload.tenant_id;
    delete payload.id;
    delete payload.createdAt;
    delete payload.created_at;

    if (!this.firestore) {
      const key = TenantScopedRepository.getInMemoryStorageKey(tenantId, this.collectionName, id);
      TenantScopedRepository.inMemoryStore.set(key, { ...existing, ...payload });
      return;
    }

    const docRef = doc(this.getCollectionRef(tenantId), id);
    await updateDoc(docRef, payload);
  }

  /**
   * Deletes a document. Supports soft-delete or permanent deletion.
   */
  public async delete(
    tenantId: string,
    id: string,
    userId?: string,
    softDelete = true
  ): Promise<void> {
    this.validateTenantId(tenantId);

    const existing = await this.findById(tenantId, id);
    if (!existing) {
      throw new NotFoundError(this.collectionName, id);
    }

    if (softDelete) {
      await this.update(
        tenantId,
        id,
        {
          deletedAt: this.firestore ? serverTimestamp() : new Date().toISOString(),
          updatedBy: userId || null,
        } as unknown as Partial<T>,
        userId
      );
      return;
    }

    if (!this.firestore) {
      const key = TenantScopedRepository.getInMemoryStorageKey(tenantId, this.collectionName, id);
      TenantScopedRepository.inMemoryStore.delete(key);
      return;
    }

    const docRef = doc(this.getCollectionRef(tenantId), id);
    await deleteDoc(docRef);
  }
}
