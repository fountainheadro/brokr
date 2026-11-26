import asyncHooks from "async_hooks";
import fs from "fs";
import os from "os";
import path from "path";
import axios from "axios";
import { AppError } from "../errors/app_error";
import { GcpAuthMethod, GcpAuthService } from "../gcp/svc_gcp-auth";
import { logger } from "../logger/logger";

export const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";

export interface RequestFirestoreAuth {
  bearerToken: string;
  uid: string;
  email?: string;
  emailVerified?: boolean;
}

export interface FirestoreOpEvent {
  reads?: number;
  writes?: number;
  deletes?: number;
}

interface PersistentStoreData {
  collections: Record<string, Record<string, any>>;
}

interface RequestAuthStore {
  run<T>(auth: RequestFirestoreAuth, fn: () => T): T;
  getStore(): RequestFirestoreAuth | undefined;
}

function createRequestAuthStorage(): RequestAuthStore {
  const isBrowser = typeof window !== "undefined";
  if (!isBrowser) {
    try {
      const Ctor = (asyncHooks as any)?.AsyncLocalStorage;
      if (typeof Ctor === "function") {
        return new Ctor() as RequestAuthStore;
      }
    } catch {
      // Fall back safely if bundler externalized async_hooks
    }
  }
  return {
    run<T>(_auth: RequestFirestoreAuth, fn: () => T): T {
      return fn();
    },
    getStore(): RequestFirestoreAuth | undefined {
      return undefined;
    },
  };
}

export class PersistentStoreService {
  private static cache: PersistentStoreData | null = null;
  private static cachedStorePath: string | null = null;
  private static collectionHydratedAt = new Map<string, number>();
  private static collectionHydrateFailedUntil = new Map<string, number>();
  private static requestAuthStorage: RequestAuthStore = createRequestAuthStorage();
  private static mutexChains = new Map<string, Promise<unknown>>();
  private static fbConfigCache: { projectId: string; databaseId: string } | null = null;
  private static testDefaultPath: string | null = null;
  private static testFirestoreOrigin: string | null = null;
  private static lastRemoteError: { message: string; statusCode: number; at: string } | null = null;

  public static runWithRequestAuth<T>(auth: RequestFirestoreAuth, fn: () => T): T {
    return this.requestAuthStorage.run(auth, fn);
  }

  public static getRequestAuth(): RequestFirestoreAuth | null {
    return this.requestAuthStorage.getStore() || null;
  }

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

  private static isTestMode(): boolean {
    return process.env.NODE_ENV === "test";
  }

  public static getStoreFilePath(): string {
    const configured = process.env.PERSISTENT_STORE_PATH?.trim();
    if (configured) {
      return path.resolve(configured);
    }
    if (!this.testDefaultPath) {
      this.testDefaultPath = path.join(os.tmpdir(), `brokr-test-store-${process.pid}.json`);
    }
    return this.testDefaultPath;
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

  /**
   * Returns true when live Firestore REST access is available via either:
   * 1. Server-side GCP ADC / Service Account credentials, OR
   * 2. Verified request-scoped Firebase Auth ID token (propagated via AsyncLocalStorage).
   */
  public static isRemoteFirestoreConfigured(): boolean {
    if (GcpAuthService.isAnyServerAuthConfigured()) {
      return true;
    }
    const reqAuth = this.getRequestAuth();
    return Boolean(reqAuth?.bearerToken);
  }

  /**
   * Returns true when Firestore REST calls will authenticate with a request-scoped Firebase user
   * ID token (Starter Tier / Preview container with no server-side ADC or Service Account).
   */
  public static isUsingUserScopedToken(): boolean {
    if (GcpAuthService.isAnyServerAuthConfigured()) {
      return false;
    }
    return Boolean(this.getRequestAuth()?.bearerToken);
  }

  public static async getGoogleAccessToken(options?: {
    throwOnError?: boolean;
  }): Promise<string | null> {
    return GcpAuthService.getAccessToken(FIRESTORE_SCOPE, {
      throwOnError: options?.throwOnError,
    });
  }

  private static async resolveFirestoreAuth(
    operation: string
  ): Promise<{ token: string; isUserToken: boolean }> {
    if (GcpAuthService.isAnyServerAuthConfigured()) {
      const token = await this.getGoogleAccessToken({ throwOnError: true });
      if (token) {
        return { token, isUserToken: false };
      }
    }

    const reqAuth = this.getRequestAuth();
    if (reqAuth?.bearerToken) {
      return { token: reqAuth.bearerToken, isUserToken: true };
    }

    // Preserve test-suite mock ADC behavior when testFirestoreOrigin is explicitly set
    const fallbackToken = await this.getGoogleAccessToken({ throwOnError: true });
    if (fallbackToken) {
      return { token: fallbackToken, isUserToken: false };
    }

    throw new AppError({
      message: `Firestore (${operation}): autentificare necesară pentru persistența în baza de date.`,
      code: "UNAUTHORIZED",
      statusCode: 401,
    });
  }

  private static buildFirestoreHeaders(
    token: string,
    isUserToken: boolean
  ): Record<string, string> {
    if (isUserToken) {
      // Firebase Auth user ID tokens work directly against Firestore REST without GCP quota headers
      return {
        Authorization: `Bearer ${token}`,
      };
    }
    return {
      Authorization: `Bearer ${token}`,
      ...GcpAuthService.getQuotaProjectHeaders(),
    };
  }

  private static quotaCooldownUntil = 0;
  private static lastQuotaLogAt = 0;

  private static assertNotInQuotaCooldown(operation: string): void {
    if (this.isTestMode()) return;
    if (Date.now() < this.quotaCooldownUntil) {
      throw new AppError({
        message:
          "Limita zilnică gratuită de citiri Firestore a fost atinsă (HTTP 429). Încercați din nou după resetarea cotei.",
        code: "RATE_LIMIT_EXCEEDED",
        statusCode: 429,
      });
    }
  }

  private static recordRemoteFailure(
    err: unknown,
    operation: string,
    targetPath: string,
    options?: { silentOnStatuses?: number[] }
  ): AppError {
    const appErr = GcpAuthService.sanitizeGcpHttpError(err, "Firestore", operation);
    const now = Date.now();
    const isQuota429 = appErr.statusCode === 429;
    if (isQuota429 && !this.isTestMode()) {
      this.quotaCooldownUntil = now + 30_000;
    }

    const suppress =
      Boolean(options?.silentOnStatuses?.includes(appErr.statusCode)) ||
      (isQuota429 && now - this.lastQuotaLogAt < 30_000);

    if (!suppress) {
      if (isQuota429) {
        this.lastQuotaLogAt = now;
      }
      this.lastRemoteError = {
        message: appErr.message,
        statusCode: appErr.statusCode,
        at: new Date().toISOString(),
      };
      logger.error(
        `Eroare Firestore la ${operation} (${targetPath}) [HTTP ${appErr.statusCode}]: ${appErr.message}`,
        appErr,
        {
          module: "persistent-store",
          action: operation,
          statusCode: appErr.statusCode,
        }
      );
    }
    return appErr;
  }

  private static loadStore(): PersistentStoreData {
    // Strictly in-memory read-through cache in dev & production (ZERO local file persistence).
    if (!this.isTestMode()) {
      if (!this.cache) {
        this.cache = { collections: {} };
      }
      return this.cache;
    }

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
    // Local disk persistence is permanently disabled outside automated unit tests.
    if (!this.isTestMode()) {
      return;
    }
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
    this.collectionHydratedAt.clear();
    this.collectionHydrateFailedUntil.clear();
  }

  public static async withKeyMutex<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const reqAuth = this.getRequestAuth();
    const runWithContext = () => (reqAuth ? this.runWithRequestAuth(reqAuth, fn) : fn());
    const previous = this.mutexChains.get(key) || Promise.resolve();
    const next = previous.then(runWithContext, runWithContext);
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

  public static setCacheOnly<T = any>(collectionName: string, id: string, value: T): T {
    const cloned = structuredClone(value);
    const store = this.loadStore();
    if (!store.collections[collectionName]) {
      store.collections[collectionName] = {};
    }
    store.collections[collectionName][id] = cloned;
    return cloned;
  }

  public static deleteCacheOnly(collectionName: string, id: string): void {
    const store = this.loadStore();
    const col = store.collections[collectionName];
    if (col && id in col) {
      delete col[id];
    }
  }

  /**
   * Seeds default records when a collection is empty in memory.
   * Only persists to Firestore when live remote auth is available; never writes to local disk
   * outside NODE_ENV === "test".
   */
  public static seedIfEmpty<T = any>(
    collectionName: string,
    entries: Array<{ id: string; value: T }>
  ): Record<string, T> {
    const existing = this.getAll<T>(collectionName);
    if (Object.keys(existing).length > 0) {
      return existing;
    }

    const canPersist = this.isTestMode() || this.isRemoteFirestoreConfigured();
    const store = this.loadStore();
    if (!store.collections[collectionName]) {
      store.collections[collectionName] = {};
    }

    for (const entry of entries) {
      const cloned = structuredClone(entry.value);
      if (canPersist && this.isTestMode()) {
        this.set(collectionName, entry.id, cloned);
      } else {
        store.collections[collectionName][entry.id] = cloned;
      }
      existing[entry.id] = structuredClone(cloned);
    }

    return existing;
  }

  /**
   * Seeds a single default document when missing in memory.
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
    if (this.isTestMode()) {
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
    const isTest = this.isTestMode();
    const remoteConfigured = this.isRemoteFirestoreConfigured();

    if (!isTest && !remoteConfigured) {
      throw new AppError({
        message:
          "Persistența locală este dezactivată: salvarea necesită conexiune autentificată la Cloud Firestore.",
        code: "INTERNAL_ERROR",
        statusCode: 503,
      });
    }

    const cloned = structuredClone(value);

    if (remoteConfigured && !/^__.*__$/.test(id)) {
      // Capture request-scoped auth explicitly so the background write retains credentials
      const reqAuth = this.getRequestAuth();
      const writePromise = reqAuth
        ? this.runWithRequestAuth(reqAuth, () =>
            this.remoteSet(collectionName, id, cloned as Record<string, any>)
          )
        : this.remoteSet(collectionName, id, cloned as Record<string, any>);

      void writePromise.catch((err) => {
        this.recordRemoteFailure(err, "remote_set", `${collectionName}/${id}`);
      });
    }

    const store = this.loadStore();
    if (!store.collections[collectionName]) {
      store.collections[collectionName] = {};
    }
    store.collections[collectionName][id] = cloned;
    if (isTest) {
      this.flushStore(store);
    }
    return cloned;
  }

  public static delete(collectionName: string, id: string): boolean {
    const isTest = this.isTestMode();
    const remoteConfigured = this.isRemoteFirestoreConfigured();

    if (!isTest && !remoteConfigured) {
      throw new AppError({
        message:
          "Persistența locală este dezactivată: ștergerea necesită conexiune autentificată la Cloud Firestore.",
        code: "INTERNAL_ERROR",
        statusCode: 503,
      });
    }

    if (remoteConfigured && !/^__.*__$/.test(id)) {
      const reqAuth = this.getRequestAuth();
      const delPromise = reqAuth
        ? this.runWithRequestAuth(reqAuth, () => this.remoteDelete(collectionName, id))
        : this.remoteDelete(collectionName, id);

      void delPromise.catch((err) => {
        this.recordRemoteFailure(err, "remote_delete", `${collectionName}/${id}`);
      });
    }

    const store = this.loadStore();
    const col = store.collections[collectionName];
    if (!col || !(id in col)) {
      return !isTest && remoteConfigured ? true : false;
    }
    delete col[id];
    if (isTest) {
      this.flushStore(store);
    }
    return true;
  }

  public static async setAsync<T extends Record<string, any>>(
    collectionName: string,
    id: string,
    value: T
  ): Promise<T> {
    const isTest = this.isTestMode();
    const cloned = structuredClone(value);

    if (!isTest || this.isRemoteFirestoreConfigured() || this.testFirestoreOrigin) {
      await this.remoteSet(collectionName, id, cloned);
      this.setCacheOnly(collectionName, id, cloned);
      return cloned;
    }

    return this.set(collectionName, id, cloned);
  }

  public static async deleteAsync(collectionName: string, id: string): Promise<boolean> {
    const isTest = this.isTestMode();

    if (!isTest || this.isRemoteFirestoreConfigured() || this.testFirestoreOrigin) {
      await this.remoteDelete(collectionName, id);
      this.deleteCacheOnly(collectionName, id);
      return true;
    }

    return this.delete(collectionName, id);
  }

  /**
   * Lazily hydrates a top-level Firestore collection into the in-memory read-through cache
   * using the active request's verified Firebase Auth token or server ADC.
   */
  public static async hydrateCollectionOnce<T = Record<string, any>>(
    collectionName: string,
    ttlMs = 30_000
  ): Promise<Record<string, T>> {
    if (this.isTestMode() && !this.testFirestoreOrigin) {
      return this.getAll<T>(collectionName);
    }
    if (!this.isRemoteFirestoreConfigured() && !this.testFirestoreOrigin) {
      return this.getAll<T>(collectionName);
    }

    const lastAt = this.collectionHydratedAt.get(collectionName) || 0;
    if (Date.now() - lastAt < ttlMs) {
      return this.getAll<T>(collectionName);
    }

    const failedUntil = this.collectionHydrateFailedUntil.get(collectionName) || 0;
    if (Date.now() < failedUntil) {
      return this.getAll<T>(collectionName);
    }

    return this.withKeyMutex(`hydrate::${collectionName}`, async () => {
      const refreshedAt = this.collectionHydratedAt.get(collectionName) || 0;
      if (Date.now() - refreshedAt < ttlMs) {
        return this.getAll<T>(collectionName);
      }
      const mutexFailedUntil = this.collectionHydrateFailedUntil.get(collectionName) || 0;
      if (Date.now() < mutexFailedUntil) {
        return this.getAll<T>(collectionName);
      }

      try {
        const entries = await this.remoteListEntriesAtPath<T>(collectionName, 300, 20, {
          silentOnStatuses: [403],
        });
        const store = this.loadStore();
        if (!store.collections[collectionName]) {
          store.collections[collectionName] = {};
        }
        for (const { docId, data } of entries) {
          if (docId) {
            store.collections[collectionName][docId] = data;
          }
        }
        this.collectionHydratedAt.set(collectionName, Date.now());
        this.collectionHydrateFailedUntil.delete(collectionName);
      } catch (err) {
        // Back off for 60s on failure to avoid spamming Firestore on every request
        this.collectionHydrateFailedUntil.set(collectionName, Date.now() + 60_000);
        logger.warn(`Firestore lazy hydration skipped for ${collectionName}`, {
          module: "persistent-store",
          action: "hydrate_collection_once",
          collection: collectionName,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
      return this.getAll<T>(collectionName);
    });
  }

  public static clearCollection(collectionName: string): void {
    const store = this.loadStore();
    store.collections[collectionName] = {};
    this.collectionHydratedAt.delete(collectionName);
    this.collectionHydrateFailedUntil.delete(collectionName);
    if (this.isTestMode()) {
      this.flushStore(store);
    }
  }

  public static clearAll(): void {
    const empty: PersistentStoreData = { collections: {} };
    this.cache = empty;
    this.cachedStorePath = this.isTestMode() ? this.getStoreFilePath() : null;
    this.collectionHydratedAt.clear();
    this.collectionHydrateFailedUntil.clear();
    this.lastRemoteError = null;
    if (this.isTestMode()) {
      this.flushStore(empty);
    }
  }

  public static toFirestoreValue(val: any): any {
    if (val === null || val === undefined) return { nullValue: null };
    if (typeof val === "boolean") return { booleanValue: val };
    if (typeof val === "number") {
      if (!Number.isFinite(val)) return { nullValue: null };
      return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
    }
    if (typeof val === "string") return { stringValue: val };
    if (val instanceof Date) return { stringValue: val.toISOString() };
    if (Array.isArray(val)) {
      const cleaned = val.filter((item) => item !== undefined);
      return { arrayValue: { values: cleaned.map((item) => this.toFirestoreValue(item)) } };
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
    const rawDocId = nameParts[nameParts.length - 1] || "";
    let docId = rawDocId;
    try {
      docId = decodeURIComponent(rawDocId);
    } catch {
      docId = rawDocId;
    }
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

  private static firestoreOpObserver: ((ops: FirestoreOpEvent) => void) | null = null;

  public static setFirestoreOpObserver(observer: ((ops: FirestoreOpEvent) => void) | null): void {
    this.firestoreOpObserver = observer;
  }

  private static notifyFirestoreOp(ops: FirestoreOpEvent): void {
    try {
      this.firestoreOpObserver?.(ops);
    } catch {
      // Telemetry must never break database operations
    }
  }

  public static async remoteGetAtPath<T = Record<string, any>>(
    relativeDocPath: string,
    options?: { silentOnStatuses?: number[] }
  ): Promise<T | null> {
    this.assertNotInQuotaCooldown("remote_get");
    const { token, isUserToken } = await this.resolveFirestoreAuth("remote_get");
    const { projectId, databaseId } = this.getFirebaseTarget();
    const encodedPath = this.encodeDocumentPath(relativeDocPath);
    const url = `${this.getFirestoreOrigin()}/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents/${encodedPath}`;
    try {
      const res = await axios.get(url, {
        headers: this.buildFirestoreHeaders(token, isUserToken),
        timeout: 8000,
      });
      this.notifyFirestoreOp({ reads: 1 });
      return this.decodeDocument<T>(res.data);
    } catch (err: any) {
      if (err?.response?.status === 404) {
        this.notifyFirestoreOp({ reads: 1 });
        return null;
      }
      throw this.recordRemoteFailure(err, "remote_get", relativeDocPath, options);
    }
  }

  public static async remoteListEntriesAtPath<T = Record<string, any>>(
    relativeCollectionPath: string,
    pageSize = 300,
    maxPages = 20,
    options?: { silentOnStatuses?: number[] }
  ): Promise<Array<{ docId: string; data: T }>> {
    this.assertNotInQuotaCooldown("remote_list");
    const { token, isUserToken } = await this.resolveFirestoreAuth("remote_list");
    const { projectId, databaseId } = this.getFirebaseTarget();
    const encodedPath = this.encodeDocumentPath(relativeCollectionPath);
    const items: Array<{ docId: string; data: T }> = [];
    let pageToken: string | undefined;

    for (let page = 0; page < maxPages; page++) {
      const params = new URLSearchParams({ pageSize: String(pageSize) });
      if (pageToken) params.set("pageToken", pageToken);

      const url = `${this.getFirestoreOrigin()}/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents/${encodedPath}?${params.toString()}`;
      try {
        const res = await axios.get(url, {
          headers: this.buildFirestoreHeaders(token, isUserToken),
          timeout: 12000,
        });
        const docs = Array.isArray(res.data?.documents) ? res.data.documents : [];
        this.notifyFirestoreOp({ reads: Math.max(1, docs.length) });
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
        if (err?.response?.status === 404) {
          this.notifyFirestoreOp({ reads: 1 });
          return [];
        }
        throw this.recordRemoteFailure(err, "remote_list", relativeCollectionPath, options);
      }
    }

    return items;
  }

  public static async remoteListAtPath<T = Record<string, any>>(
    relativeCollectionPath: string,
    pageSize = 300,
    maxPages = 20,
    options?: { silentOnStatuses?: number[] }
  ): Promise<T[]> {
    const entries = await this.remoteListEntriesAtPath<T>(
      relativeCollectionPath,
      pageSize,
      maxPages,
      options
    );
    return entries.map((e) => e.data);
  }

  /**
   * Executes a server-side indexed Firestore StructuredQuery (`:runQuery`) under `parentRelativePath`
   * (e.g. `"tenants/ten_brokr_default"` or `""` for root collections), preventing O(N) full scans.
   */
  public static async remoteRunQueryAtPath<T = Record<string, any>>(
    parentRelativePath: string,
    structuredQuery: Record<string, any>,
    options?: { silentOnStatuses?: number[] }
  ): Promise<Array<{ docId: string; data: T }>> {
    this.assertNotInQuotaCooldown("remote_run_query");
    const { token, isUserToken } = await this.resolveFirestoreAuth("remote_run_query");
    const { projectId, databaseId } = this.getFirebaseTarget();
    const encodedParent = parentRelativePath
      ? `/${this.encodeDocumentPath(parentRelativePath)}`
      : "";
    const url = `${this.getFirestoreOrigin()}/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents${encodedParent}:runQuery`;
    try {
      const res = await axios.post(
        url,
        { structuredQuery },
        {
          headers: this.buildFirestoreHeaders(token, isUserToken),
          timeout: 12000,
        }
      );
      const rows = Array.isArray(res.data) ? res.data : [];
      const results: Array<{ docId: string; data: T }> = [];
      for (const row of rows) {
        if (!row?.document) continue;
        const nameParts = String(row.document?.name || "").split("/");
        const rawSeg = nameParts[nameParts.length - 1] || "";
        let docId = rawSeg;
        try {
          docId = decodeURIComponent(rawSeg);
        } catch {
          docId = rawSeg;
        }
        results.push({ docId, data: this.decodeDocument<T>(row.document) });
      }
      this.lastRemoteError = null;
      this.notifyFirestoreOp({ reads: Math.max(1, results.length) });
      return results;
    } catch (err: any) {
      throw this.recordRemoteFailure(err, "remote_run_query", parentRelativePath || ":root", options);
    }
  }

  /**
   * Atomically increments an integer counter field on a Firestore document using `:commit`
   * `updateTransforms`, returning the server-computed post-increment value in a single RPC.
   */
  public static async remoteAtomicIncrement(
    relativeDocPath: string,
    fieldName: string,
    delta = 1,
    extraFields: Record<string, any> = {}
  ): Promise<number> {
    const { token, isUserToken } = await this.resolveFirestoreAuth("remote_atomic_increment");
    const { projectId, databaseId } = this.getFirebaseTarget();
    const docName = `projects/${projectId}/databases/${databaseId}/documents/${relativeDocPath}`;
    const commitUrl = `${this.getFirestoreOrigin()}/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents:commit`;

    const fieldPaths = Object.keys(extraFields).filter((k) => extraFields[k] !== undefined);
    const writeObj: Record<string, any> = {
      update: {
        name: docName,
        fields: this.encodeDocumentFields(extraFields),
      },
      updateMask: {
        fieldPaths,
      },
      updateTransforms: [
        {
          fieldPath: fieldName,
          increment: { integerValue: String(delta) },
        },
      ],
    };

    try {
      const res = await axios.post(
        commitUrl,
        { writes: [writeObj] },
        {
          headers: this.buildFirestoreHeaders(token, isUserToken),
          timeout: 8000,
        }
      );
      this.lastRemoteError = null;
      this.notifyFirestoreOp({ writes: 1 });
      const transformVal = res.data?.writeResults?.[0]?.transformResults?.[0];
      const parsed = this.fromFirestoreValue(transformVal);
      if (typeof parsed === "number" && Number.isFinite(parsed)) {
        return parsed;
      }
      // Fallback read if a test mock didn't include transformResults
      const doc = await this.remoteGetAtPath<Record<string, any>>(relativeDocPath);
      const docVal = Number(doc?.[fieldName] || 0);
      return Number.isFinite(docVal) && docVal > 0 ? docVal : delta;
    } catch (err: any) {
      throw this.recordRemoteFailure(err, "remote_atomic_increment", relativeDocPath);
    }
  }

  public static async remoteSetAtPath(
    relativeDocPath: string,
    data: Record<string, any>
  ): Promise<void> {
    const { token, isUserToken } = await this.resolveFirestoreAuth("remote_set");
    const { projectId, databaseId } = this.getFirebaseTarget();
    const encodedPath = this.encodeDocumentPath(relativeDocPath);
    const url = `${this.getFirestoreOrigin()}/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents/${encodedPath}`;
    try {
      await axios.patch(
        url,
        { fields: this.encodeDocumentFields(data) },
        {
          headers: this.buildFirestoreHeaders(token, isUserToken),
          timeout: 8000,
        }
      );
      this.lastRemoteError = null;
      this.notifyFirestoreOp({ writes: 1 });
    } catch (err: any) {
      throw this.recordRemoteFailure(err, "remote_set", relativeDocPath);
    }
  }

  public static async remoteDeleteAtPath(relativeDocPath: string): Promise<void> {
    const { token, isUserToken } = await this.resolveFirestoreAuth("remote_delete");
    const { projectId, databaseId } = this.getFirebaseTarget();
    const encodedPath = this.encodeDocumentPath(relativeDocPath);
    const url = `${this.getFirestoreOrigin()}/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents/${encodedPath}`;
    try {
      await axios.delete(url, {
        headers: this.buildFirestoreHeaders(token, isUserToken),
        timeout: 8000,
      });
      this.lastRemoteError = null;
      this.notifyFirestoreOp({ deletes: 1 });
    } catch (err: any) {
      if (err?.response?.status === 404) return;
      throw this.recordRemoteFailure(err, "remote_delete", relativeDocPath);
    }
  }

  public static async remoteCommitWrites(
    writes: Array<Record<string, any>>,
    operation = "remote_commit",
    options?: { silentOnStatuses?: number[] }
  ): Promise<void> {
    if (writes.length === 0) return;
    const { token, isUserToken } = await this.resolveFirestoreAuth(operation);
    const { projectId, databaseId } = this.getFirebaseTarget();
    const commitUrl = `${this.getFirestoreOrigin()}/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents:commit`;
    try {
      await axios.post(
        commitUrl,
        { writes },
        {
          headers: this.buildFirestoreHeaders(token, isUserToken),
          timeout: 12000,
        }
      );
      this.lastRemoteError = null;
      let writeCount = 0;
      let deleteCount = 0;
      for (const w of writes) {
        if (w && typeof w === "object" && "delete" in w) {
          deleteCount++;
        } else {
          writeCount++;
        }
      }
      this.notifyFirestoreOp({ writes: writeCount, deletes: deleteCount });
    } catch (err: any) {
      throw this.recordRemoteFailure(err, operation, ":commit", options);
    }
  }

  public static async remoteGet<T = any>(collectionName: string, id: string): Promise<T | null> {
    if (
      this.isTestMode() &&
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
    const isTest = this.isTestMode();
    const remoteActive = this.isRemoteFirestoreConfigured() || Boolean(this.testFirestoreOrigin);

    if (!isTest && !remoteActive) {
      throw new AppError({
        message:
          "Persistența locală este dezactivată: crearea atomică necesită conexiune autentificată la Cloud Firestore.",
        code: "INTERNAL_ERROR",
        statusCode: 503,
      });
    }

    return this.withKeyMutex(`${collectionName}::${id}`, async () => {
      if (remoteActive) {
        const { token, isUserToken } = await this.resolveFirestoreAuth("create_if_absent_async");
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
              headers: this.buildFirestoreHeaders(token, isUserToken),
              timeout: 8000,
            }
          );
          this.notifyFirestoreOp({ writes: 1 });
          this.setCacheOnly(collectionName, id, data);
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
   * Hydrates PersistentStoreService collections from Firestore into the in-memory read-through cache.
   * Never reads or writes local `.data/` files.
   */
  public static async hydrateFromFirestore(collections: string[]): Promise<{
    hydratedCollections: number;
    hydratedDocs: number;
    seededRemoteDocs: number;
  }> {
    if (this.isTestMode() && !this.testFirestoreOrigin) {
      return { hydratedCollections: 0, hydratedDocs: 0, seededRemoteDocs: 0 };
    }
    if (!this.isRemoteFirestoreConfigured() && !this.testFirestoreOrigin) {
      return { hydratedCollections: 0, hydratedDocs: 0, seededRemoteDocs: 0 };
    }

    const store = this.loadStore();
    let hydratedCollections = 0;
    let hydratedDocs = 0;

    for (const colName of collections) {
      try {
        const remoteEntries = await this.remoteListEntriesAtPath<Record<string, any>>(
          colName,
          300,
          20,
          { silentOnStatuses: [403] }
        );
        if (!store.collections[colName]) {
          store.collections[colName] = {};
        }
        for (const { docId, data } of remoteEntries) {
          if (!docId) continue;
          store.collections[colName][docId] = data;
          hydratedDocs++;
        }
        this.collectionHydratedAt.set(colName, Date.now());
        this.collectionHydrateFailedUntil.delete(colName);
        hydratedCollections++;
      } catch (err) {
        this.collectionHydrateFailedUntil.set(colName, Date.now() + 60_000);
        logger.warn(`Firestore hydration skipped for ${colName}`, {
          module: "persistent-store",
          action: "hydrate_collection",
          collection: colName,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { hydratedCollections, hydratedDocs, seededRemoteDocs: 0 };
  }
}
