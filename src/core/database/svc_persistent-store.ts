import fs from "fs";
import os from "os";
import path from "path";
import axios from "axios";
import { AppError } from "../errors/app_error";
import { GcpAuthMethod, GcpAuthService } from "../gcp/svc_gcp-auth";
import { logger } from "../logger/logger";

export const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";

interface PersistentStoreData {
  collections: Record<string, Record<string, any>>;
}

export class PersistentStoreService {
  private static cache: PersistentStoreData | null = null;
  private static cachedStorePath: string | null = null;
  private static mutexChains = new Map<string, Promise<unknown>>();
  private static fbConfigCache: { projectId: string; databaseId: string } | null = null;
  private static testDefaultPath: string | null = null;
  private static testFirestoreOrigin: string | null = null;
  private static lastRemoteError: { message: string; statusCode: number; at: string } | null = null;

  public static setTestFirestoreOrigin(origin: string | null): void {
    this.testFirestoreOrigin = origin ? origin.replace(/\/+$/, "") : null;
  }

  public static clearOauthCache(): void {
    GcpAuthService.clearTokenCache();
  }

  public static clearFirebaseTargetCache(): void {
    this.fbConfigCache = null;
  }

  public static getLastRemoteError(): { message: string; statusCode: number; at: string } | null {
    return this.lastRemoteError;
  }

  public static clearLastRemoteError(): void {
    this.lastRemoteError = null;
  }

  private static getFirestoreOrigin(): string {
    return this.testFirestoreOrigin || "https://firestore.googleapis.com";
  }

  public static getStoreFilePath(): string {
    const configured = process.env.PERSISTENT_STORE_PATH?.trim();
    if (configured) {
      return path.resolve(configured);
    }
    if (process.env.NODE_ENV === "test") {
      if (!this.testDefaultPath) {
        this.testDefaultPath = path.join(os.tmpdir(), `brokr-test-store-${process.pid}.json`);
      }
      return this.testDefaultPath;
    }
    return path.resolve(process.cwd(), ".data", "brokr-persistent-store.json");
  }

  public static getFirebaseTarget(): { projectId: string; databaseId: string } {
    if (this.fbConfigCache) return this.fbConfigCache;

    let projectId =
      process.env.FIREBASE_PROJECT_ID ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      "brokr-42038";
    let databaseId = process.env.FIRESTORE_DATABASE_ID || "(default)";

    try {
      const cfgPath = path.resolve(process.cwd(), "firebase-applet-config.json");
      if (fs.existsSync(cfgPath)) {
        const parsed = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
        if (parsed?.projectId) projectId = parsed.projectId;
        if (parsed?.firestoreDatabaseId) databaseId = parsed.firestoreDatabaseId;
      }
    } catch {
      // Fallback to env defaults
    }

    this.fbConfigCache = { projectId, databaseId };
    return this.fbConfigCache;
  }

  public static isMetadataAuthEnabled(): boolean {
    return GcpAuthService.isMetadataAuthEnabled();
  }

  public static getAuthMethodInfo(): {
    method: GcpAuthMethod;
    principalEmail: string | null;
  } {
    const info = GcpAuthService.getAuthMethodInfo();
    return { method: info.method, principalEmail: info.principalEmail };
  }

  public static isRemoteFirestoreConfigured(): boolean {
    return GcpAuthService.isAnyServerAuthConfigured();
  }

  public static async getGoogleAccessToken(options?: {
    throwOnError?: boolean;
  }): Promise<string | null> {
    return GcpAuthService.getAccessToken(FIRESTORE_SCOPE, {
      throwOnError: options?.throwOnError,
    });
  }

  private static async requireGoogleAccessToken(operation: string): Promise<string> {
    const token = await this.getGoogleAccessToken({ throwOnError: true });
    if (!token) {
      throw new AppError({
        message: `Firestore (${operation}): nu s-a putut obține tokenul OAuth2 prin ADC.`,
        code: "UNAUTHORIZED",
        statusCode: 401,
      });
    }
    return token;
  }

  private static buildFirestoreHeaders(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      ...GcpAuthService.getQuotaProjectHeaders(),
    };
  }

  private static recordRemoteFailure(err: unknown, operation: string, targetPath: string): AppError {
    const appErr = GcpAuthService.sanitizeGcpHttpError(err, "Firestore", operation);
    this.lastRemoteError = {
      message: appErr.message,
      statusCode: appErr.statusCode,
      at: new Date().toISOString(),
    };
    logger.error(`Eroare Firestore la ${operation} (${targetPath})`, appErr, {
      module: "persistent-store",
      action: operation,
      statusCode: appErr.statusCode,
    });
    return appErr;
  }

  private static loadStore(): PersistentStoreData {
    const targetPath = this.getStoreFilePath();
    if (this.cache && this.cachedStorePath === targetPath) {
      return this.cache;
    }

    let loaded: PersistentStoreData = { collections: {} };
    try {
      if (fs.existsSync(targetPath)) {
        const raw = fs.readFileSync(targetPath, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.collections) {
          loaded = { collections: parsed.collections };
        }
      }
    } catch {
      loaded = { collections: {} };
    }

    this.cache = loaded;
    this.cachedStorePath = targetPath;
    return loaded;
  }

  private static flushStore(data: PersistentStoreData): void {
    const targetPath = this.getStoreFilePath();
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmpPath, targetPath);
  }

  public static clearMemoryCache(): void {
    this.cache = null;
    this.cachedStorePath = null;
  }

  public static async withKeyMutex<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.mutexChains.get(key) || Promise.resolve();
    const next = previous.then(fn, fn);
    this.mutexChains.set(key, next.catch(() => undefined));
    try {
      return await next;
    } finally {
      if (this.mutexChains.get(key) === next) {
        this.mutexChains.delete(key);
      }
    }
  }

  public static getAll<T = any>(collectionName: string): Record<string, T> {
    const store = this.loadStore();
    const col = store.collections[collectionName] || {};
    const copy: Record<string, T> = {};
    for (const [k, v] of Object.entries(col)) {
      copy[k] = structuredClone(v) as T;
    }
    return copy;
  }

  public static get<T = any>(collectionName: string, id: string): T | null {
    const store = this.loadStore();
    const col = store.collections[collectionName];
    if (!col || !(id in col)) return null;
    return structuredClone(col[id]) as T;
  }

  /**
   * Seeds default records when a collection is empty.
   * In production without server-side Firestore ADC configured, populates ONLY the
   * in-memory cache (never writes to local disk) so read-only endpoints do not crash
   * while real mutations via set()/setAsync() remain strictly protected.
   */
  public static seedIfEmpty<T = any>(
    collectionName: string,
    entries: Array<{ id: string; value: T }>
  ): Record<string, T> {
    const existing = this.getAll<T>(collectionName);
    if (Object.keys(existing).length > 0) {
      return existing;
    }

    const isProd = process.env.NODE_ENV === "production";
    const canPersist = !isProd || this.isRemoteFirestoreConfigured();
    const store = this.loadStore();
    if (!store.collections[collectionName]) {
      store.collections[collectionName] = {};
    }

    for (const entry of entries) {
      const cloned = structuredClone(entry.value);
      if (canPersist) {
        this.set(collectionName, entry.id, cloned);
      } else {
        store.collections[collectionName][entry.id] = cloned;
      }
      existing[entry.id] = structuredClone(cloned);
    }

    return existing;
  }

  /**
   * Seeds a single default document when missing.
   * Uses in-memory read-only cache fallback in production if Firestore server ADC is absent.
   */
  public static seedDocumentIfMissing<T = any>(
    collectionName: string,
    id: string,
    value: T
  ): T {
    const existing = this.get<T>(collectionName, id);
    if (existing !== null) {
      return existing;
    }

    const cloned = structuredClone(value);
    const isProd = process.env.NODE_ENV === "production";
    const canPersist = !isProd || this.isRemoteFirestoreConfigured();

    if (canPersist) {
      return this.set(collectionName, id, cloned);
    }

    const store = this.loadStore();
    if (!store.collections[collectionName]) {
      store.collections[collectionName] = {};
    }
    store.collections[collectionName][id] = cloned;
    return structuredClone(cloned);
  }

  public static set<T = any>(collectionName: string, id: string, value: T): T {
    const isProd = process.env.NODE_ENV === "production";
    const remoteConfigured = this.isRemoteFirestoreConfigured();

    if (isProd && !remoteConfigured) {
      throw new AppError({
        message:
          "Persistența locală este dezactivată în producție: lipsesc credențialele Firestore ADC.",
        code: "INTERNAL_ERROR",
        statusCode: 503,
      });
    }

    const cloned = structuredClone(value);

    if (remoteConfigured && !/^__.*__$/.test(id)) {
      void this.remoteSet(collectionName, id, cloned as Record<string, any>).catch((err) => {
        this.recordRemoteFailure(err, "remote_set", `${collectionName}/${id}`);
      });
    }

    if (!isProd) {
      const store = this.loadStore();
      if (!store.collections[collectionName]) {
        store.collections[collectionName] = {};
      }
      store.collections[collectionName][id] = cloned;
      this.flushStore(store);
    } else {
      const store = this.loadStore();
      if (!store.collections[collectionName]) {
        store.collections[collectionName] = {};
      }
      store.collections[collectionName][id] = cloned;
    }
    return cloned;
  }

  public static delete(collectionName: string, id: string): boolean {
    const isProd = process.env.NODE_ENV === "production";
    const remoteConfigured = this.isRemoteFirestoreConfigured();

    if (isProd && !remoteConfigured) {
      throw new AppError({
        message:
          "Persistența locală este dezactivată în producție: lipsesc credențialele Firestore ADC.",
        code: "INTERNAL_ERROR",
        statusCode: 503,
      });
    }

    if (remoteConfigured && !/^__.*__$/.test(id)) {
      void this.remoteDelete(collectionName, id).catch((err) => {
        this.recordRemoteFailure(err, "remote_delete", `${collectionName}/${id}`);
      });
    }

    const store = this.loadStore();
    const col = store.collections[collectionName];
    if (!col || !(id in col)) {
      return isProd && remoteConfigured ? true : false;
    }
    delete col[id];
    if (!isProd) {
      this.flushStore(store);
    }
    return true;
  }

  public static async setAsync<T extends Record<string, any>>(
    collectionName: string,
    id: string,
    value: T
  ): Promise<T> {
    const isProd = process.env.NODE_ENV === "production";
    const cloned = structuredClone(value);

    if (isProd || this.isRemoteFirestoreConfigured() || this.testFirestoreOrigin) {
      await this.remoteSet(collectionName, id, cloned);
      const store = this.loadStore();
      if (!store.collections[collectionName]) {
        store.collections[collectionName] = {};
      }
      store.collections[collectionName][id] = cloned;
      if (!isProd) {
        this.flushStore(store);
      }
      return cloned;
    }

    return this.set(collectionName, id, cloned);
  }

  public static async deleteAsync(collectionName: string, id: string): Promise<boolean> {
    const isProd = process.env.NODE_ENV === "production";

    if (isProd || this.isRemoteFirestoreConfigured() || this.testFirestoreOrigin) {
      await this.remoteDelete(collectionName, id);
      const store = this.loadStore();
      const col = store.collections[collectionName];
      if (col && id in col) {
        delete col[id];
        if (!isProd) {
          this.flushStore(store);
        }
      }
      return true;
    }

    return this.delete(collectionName, id);
  }

  public static clearCollection(collectionName: string): void {
    const store = this.loadStore();
    store.collections[collectionName] = {};
    if (process.env.NODE_ENV !== "production") {
      this.flushStore(store);
    }
  }

  public static clearAll(): void {
    const empty: PersistentStoreData = { collections: {} };
    this.cache = empty;
    this.cachedStorePath = this.getStoreFilePath();
    this.lastRemoteError = null;
    if (process.env.NODE_ENV !== "production") {
      this.flushStore(empty);
    }
  }

  public static toFirestoreValue(val: any): any {
    if (val === null || val === undefined) return { nullValue: null };
    if (typeof val === "boolean") return { booleanValue: val };
    if (typeof val === "number") {
      return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
    }
    if (typeof val === "string") return { stringValue: val };
    if (Array.isArray(val)) {
      return { arrayValue: { values: val.map((item) => this.toFirestoreValue(item)) } };
    }
    if (typeof val === "object") {
      const fields: Record<string, any> = {};
      for (const [k, v] of Object.entries(val)) {
        if (v !== undefined) {
          fields[k] = this.toFirestoreValue(v);
        }
      }
      return { mapValue: { fields } };
    }
    return { stringValue: String(val) };
  }

  public static fromFirestoreValue(fieldObj: any): any {
    if (!fieldObj || typeof fieldObj !== "object") return fieldObj;
    if ("stringValue" in fieldObj) return fieldObj.stringValue;
    if ("integerValue" in fieldObj) return Number(fieldObj.integerValue);
    if ("doubleValue" in fieldObj) return Number(fieldObj.doubleValue);
    if ("booleanValue" in fieldObj) return fieldObj.booleanValue;
    if ("timestampValue" in fieldObj) return fieldObj.timestampValue;
    if ("nullValue" in fieldObj) return null;
    if ("mapValue" in fieldObj) {
      const out: Record<string, any> = {};
      const fields = fieldObj.mapValue.fields || {};
      for (const k of Object.keys(fields)) {
        out[k] = this.fromFirestoreValue(fields[k]);
      }
      return out;
    }
    if ("arrayValue" in fieldObj) {
      const values = fieldObj.arrayValue.values || [];
      return values.map((v: any) => this.fromFirestoreValue(v));
    }
    return fieldObj;
  }

  public static encodeDocumentFields(data: Record<string, any>): Record<string, any> {
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined) {
        fields[k] = this.toFirestoreValue(v);
      }
    }
    return fields;
  }

  public static decodeDocument<T = Record<string, any>>(docObj: any): T {
    const nameParts = String(docObj?.name || "").split("/");
    const docId = nameParts[nameParts.length - 1] || "";
    const parsed: Record<string, any> = docId ? { id: docId } : {};
    const fields = docObj?.fields || {};
    for (const k of Object.keys(fields)) {
      parsed[k] = this.fromFirestoreValue(fields[k]);
    }
    return parsed as T;
  }

  private static encodeDocumentPath(relativeDocPath: string): string {
    return relativeDocPath
      .split("/")
      .filter(Boolean)
      .map((seg) => encodeURIComponent(seg))
      .join("/");
  }

  public static async remoteGetAtPath<T = Record<string, any>>(
    relativeDocPath: string
  ): Promise<T | null> {
    const token = await this.requireGoogleAccessToken("remote_get");
    const { projectId, databaseId } = this.getFirebaseTarget();
    const encodedPath = this.encodeDocumentPath(relativeDocPath);
    const url = `${this.getFirestoreOrigin()}/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents/${encodedPath}`;
    try {
      const res = await axios.get(url, {
        headers: this.buildFirestoreHeaders(token),
        timeout: 8000,
      });
      return this.decodeDocument<T>(res.data);
    } catch (err: any) {
      if (err?.response?.status === 404) return null;
      throw this.recordRemoteFailure(err, "remote_get", relativeDocPath);
    }
  }

  public static async remoteListEntriesAtPath<T = Record<string, any>>(
    relativeCollectionPath: string,
    pageSize = 300
  ): Promise<Array<{ docId: string; data: T }>> {
    const token = await this.requireGoogleAccessToken("remote_list");
    const { projectId, databaseId } = this.getFirebaseTarget();
    const encodedPath = this.encodeDocumentPath(relativeCollectionPath);
    const items: Array<{ docId: string; data: T }> = [];
    let pageToken: string | undefined;

    for (let page = 0; page < 20; page++) {
      const params = new URLSearchParams({ pageSize: String(pageSize) });
      if (pageToken) params.set("pageToken", pageToken);

      const url = `${this.getFirestoreOrigin()}/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents/${encodedPath}?${params.toString()}`;
      try {
        const res = await axios.get(url, {
          headers: this.buildFirestoreHeaders(token),
          timeout: 12000,
        });
        const docs = Array.isArray(res.data?.documents) ? res.data.documents : [];
        for (const docItem of docs) {
          const nameParts = String(docItem?.name || "").split("/");
          const rawSeg = nameParts[nameParts.length - 1] || "";
          let docId = rawSeg;
          try {
            docId = decodeURIComponent(rawSeg);
          } catch {
            docId = rawSeg;
          }
          items.push({ docId, data: this.decodeDocument<T>(docItem) });
        }
        pageToken = res.data?.nextPageToken || undefined;
        if (!pageToken) break;
      } catch (err: any) {
        if (err?.response?.status === 404) return [];
        throw this.recordRemoteFailure(err, "remote_list", relativeCollectionPath);
      }
    }

    return items;
  }

  public static async remoteListAtPath<T = Record<string, any>>(
    relativeCollectionPath: string,
    pageSize = 300
  ): Promise<T[]> {
    const entries = await this.remoteListEntriesAtPath<T>(relativeCollectionPath, pageSize);
    return entries.map((e) => e.data);
  }

  public static async remoteSetAtPath(
    relativeDocPath: string,
    data: Record<string, any>
  ): Promise<void> {
    const token = await this.requireGoogleAccessToken("remote_set");
    const { projectId, databaseId } = this.getFirebaseTarget();
    const encodedPath = this.encodeDocumentPath(relativeDocPath);
    const url = `${this.getFirestoreOrigin()}/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents/${encodedPath}`;
    try {
      await axios.patch(
        url,
        { fields: this.encodeDocumentFields(data) },
        {
          headers: this.buildFirestoreHeaders(token),
          timeout: 8000,
        }
      );
      this.lastRemoteError = null;
    } catch (err: any) {
      throw this.recordRemoteFailure(err, "remote_set", relativeDocPath);
    }
  }

  public static async remoteDeleteAtPath(relativeDocPath: string): Promise<void> {
    const token = await this.requireGoogleAccessToken("remote_delete");
    const { projectId, databaseId } = this.getFirebaseTarget();
    const encodedPath = this.encodeDocumentPath(relativeDocPath);
    const url = `${this.getFirestoreOrigin()}/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents/${encodedPath}`;
    try {
      await axios.delete(url, {
        headers: this.buildFirestoreHeaders(token),
        timeout: 8000,
      });
      this.lastRemoteError = null;
    } catch (err: any) {
      if (err?.response?.status === 404) return;
      throw this.recordRemoteFailure(err, "remote_delete", relativeDocPath);
    }
  }

  public static async remoteCommitWrites(
    writes: Array<Record<string, any>>,
    operation = "remote_commit"
  ): Promise<void> {
    if (writes.length === 0) return;
    const token = await this.requireGoogleAccessToken(operation);
    const { projectId, databaseId } = this.getFirebaseTarget();
    const commitUrl = `${this.getFirestoreOrigin()}/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents:commit`;
    try {
      await axios.post(
        commitUrl,
        { writes },
        {
          headers: this.buildFirestoreHeaders(token),
          timeout: 12000,
        }
      );
      this.lastRemoteError = null;
    } catch (err: any) {
      throw this.recordRemoteFailure(err, operation, ":commit");
    }
  }

  public static async remoteGet<T = any>(collectionName: string, id: string): Promise<T | null> {
    if (
      process.env.NODE_ENV !== "production" &&
      !this.isRemoteFirestoreConfigured() &&
      !this.testFirestoreOrigin
    ) {
      return this.get<T>(collectionName, id);
    }
    return this.remoteGetAtPath<T>(`${collectionName}/${id}`);
  }

  public static async remoteSet(
    collectionName: string,
    id: string,
    data: Record<string, any>
  ): Promise<void> {
    return this.remoteSetAtPath(`${collectionName}/${id}`, data);
  }

  public static async remoteDelete(collectionName: string, id: string): Promise<void> {
    return this.remoteDeleteAtPath(`${collectionName}/${id}`);
  }

  public static async createIfAbsentAsync<T extends Record<string, any>>(
    collectionName: string,
    id: string,
    data: T
  ): Promise<boolean> {
    const isProd = process.env.NODE_ENV === "production";
    const remoteActive = this.isRemoteFirestoreConfigured() || Boolean(this.testFirestoreOrigin);

    if (isProd && !remoteActive) {
      throw new AppError({
        message:
          "Persistența atomică locală este dezactivată în producție: lipsesc credențialele Firestore ADC.",
        code: "INTERNAL_ERROR",
        statusCode: 503,
      });
    }

    return this.withKeyMutex(`${collectionName}::${id}`, async () => {
      if (remoteActive) {
        const token = await this.requireGoogleAccessToken("create_if_absent_async");
        const { projectId, databaseId } = this.getFirebaseTarget();
        const docName = `projects/${projectId}/databases/${databaseId}/documents/${collectionName}/${id}`;
        const commitUrl = `${this.getFirestoreOrigin()}/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents:commit`;
        try {
          await axios.post(
            commitUrl,
            {
              writes: [
                {
                  update: {
                    name: docName,
                    fields: this.encodeDocumentFields(data),
                  },
                  currentDocument: { exists: false },
                },
              ],
            },
            {
              headers: this.buildFirestoreHeaders(token),
              timeout: 8000,
            }
          );
          const store = this.loadStore();
          if (!store.collections[collectionName]) store.collections[collectionName] = {};
          store.collections[collectionName][id] = structuredClone(data);
          if (!isProd) {
            this.flushStore(store);
          }
          return true;
        } catch (err: any) {
          if (err?.response?.status === 409 || err?.response?.status === 412) {
            return false;
          }
          throw this.recordRemoteFailure(err, "create_if_absent_async", `${collectionName}/${id}`);
        }
      }

      const store = this.loadStore();
      if (!store.collections[collectionName]) {
        store.collections[collectionName] = {};
      }
      if (id in store.collections[collectionName]) {
        return false;
      }
      store.collections[collectionName][id] = structuredClone(data);
      this.flushStore(store);
      return true;
    });
  }

  /**
   * Hydrates PersistentStoreService collections from Firestore at server startup
   * and (in dev/preview only) seeds any local-only records from .data/brokr-persistent-store.json
   * that do not yet exist in Firestore.
   */
  public static async hydrateFromFirestore(collections: string[]): Promise<{
    hydratedCollections: number;
    hydratedDocs: number;
    seededRemoteDocs: number;
  }> {
    if (process.env.NODE_ENV === "test" && !this.testFirestoreOrigin) {
      return { hydratedCollections: 0, hydratedDocs: 0, seededRemoteDocs: 0 };
    }
    if (!this.isRemoteFirestoreConfigured() && !this.testFirestoreOrigin) {
      return { hydratedCollections: 0, hydratedDocs: 0, seededRemoteDocs: 0 };
    }

    const isProd = process.env.NODE_ENV === "production";
    const store = isProd ? { collections: {} as Record<string, Record<string, any>> } : this.loadStore();
    if (isProd) {
      this.cache = store;
      this.cachedStorePath = this.getStoreFilePath();
    }

    let hydratedCollections = 0;
    let hydratedDocs = 0;
    let seededRemoteDocs = 0;

    for (const colName of collections) {
      try {
        const remoteEntries = await this.remoteListEntriesAtPath<Record<string, any>>(colName, 300);
        if (!store.collections[colName]) {
          store.collections[colName] = {};
        }
        const remoteIdSet = new Set<string>();
        for (const { docId, data } of remoteEntries) {
          if (!docId) continue;
          remoteIdSet.add(docId);
          store.collections[colName][docId] = data;
          hydratedDocs++;
        }
        hydratedCollections++;

        // In dev/preview, push any local records missing from Firestore so existing work is preserved
        if (!isProd) {
          for (const [localId, localVal] of Object.entries(store.collections[colName])) {
            if (/^__.*__$/.test(localId)) continue;
            if (!remoteIdSet.has(localId) && localVal && typeof localVal === "object") {
              await this.remoteSet(colName, localId, localVal as Record<string, any>);
              seededRemoteDocs++;
            }
          }
        }
      } catch (err) {
        logger.warn(`Firestore hydration skipped for ${colName}`, {
          module: "persistent-store",
          action: "hydrate_collection",
          collection: colName,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // One-time dev/preview backfill for tenant-scoped CRM collections (tenants__<tenantId>__<col>)
    if (!isProd) {
      const tenantColKeys = Object.keys(store.collections).filter((k) => k.startsWith("tenants__"));
      for (const storeKey of tenantColKeys) {
        const rest = storeKey.slice("tenants__".length);
        const sepIdx = rest.lastIndexOf("__");
        if (sepIdx <= 0) continue;
        const tenantId = rest.slice(0, sepIdx);
        const colName = rest.slice(sepIdx + 2);
        const localEntries = Object.entries(store.collections[storeKey] || {});
        if (localEntries.length === 0) continue;

        try {
          const existingRemote = await this.remoteListEntriesAtPath<Record<string, any>>(
            `tenants/${tenantId}/${colName}`,
            300
          );
          const remoteIds = new Set(existingRemote.map((e) => e.docId).filter(Boolean));
          for (const [docId, docVal] of localEntries) {
            if (!remoteIds.has(docId) && docVal && typeof docVal === "object") {
              await this.remoteSetAtPath(`tenants/${tenantId}/${colName}/${docId}`, docVal as Record<string, any>);
              seededRemoteDocs++;
            }
          }
        } catch (err) {
          logger.warn(`Firestore tenant backfill skipped for ${storeKey}`, {
            module: "persistent-store",
            action: "hydrate_tenant_backfill",
            storeKey,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (hydratedDocs > 0) {
        this.flushStore(store);
      }
    }

    return { hydratedCollections, hydratedDocs, seededRemoteDocs };
  }
}
