import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import axios from "axios";
import { detectImageMagicBytes } from "../../../server/security/sec_image-validator";
import { AppError, ForbiddenError, NotFoundError } from "../errors/app_error";
import { GcpAuthService } from "../gcp/svc_gcp-auth";
import { logger } from "../logger/logger";
import { StorageMetadataRepository } from "./repo_storage-metadata";
import {
  StorageBackendKind,
  StorageEntityType,
  StorageObjectMetadata,
  StorageVisibility,
  UploadStorageObjectInput,
} from "./typ_storage-config";

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15 MB
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024; // 25 MB

const FORBIDDEN_EXTENSIONS = new Set([
  ".html",
  ".htm",
  ".svg",
  ".js",
  ".mjs",
  ".cjs",
  ".exe",
  ".bat",
  ".cmd",
  ".sh",
  ".php",
  ".jsp",
  ".asp",
  ".aspx",
  ".dll",
]);

export const GCS_STORAGE_SCOPE = "https://www.googleapis.com/auth/devstorage.read_write";

/**
 * Validates and uploads/downloads/deletes tenant-scoped files using Google Cloud Storage JSON v1 API
 * (via Application Default Credentials / Service Account / GCP Metadata / GCS Emulator) with strict tenant path isolation
 * and isolated local disk fallback when no live GCS credentials or emulator are configured.
 */
export class CloudStorageService {
  private static ephemeralSigningSecret = crypto.randomBytes(32).toString("hex");

  public static clearTokenCache(): void {
    GcpAuthService.clearTokenCache();
  }

  public static getBucketName(): string {
    const envBucket = process.env.GCS_BUCKET_NAME?.trim();
    if (envBucket) return envBucket;

    try {
      const cfgPath = path.resolve(process.cwd(), "firebase-applet-config.json");
      if (fs.existsSync(cfgPath)) {
        const parsed = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
        if (parsed?.storageBucket && typeof parsed.storageBucket === "string") {
          return parsed.storageBucket.trim();
        }
      }
    } catch {
      // Ignore config read failures
    }

    return "brokr-42038.firebasestorage.app";
  }

  public static getLocalStorageRoot(): string {
    const configured = process.env.STORAGE_LOCAL_ROOT?.trim();
    if (configured) return path.resolve(configured);
    if (process.env.NODE_ENV === "test") {
      return path.join(os.tmpdir(), `brokr-storage-test-${process.pid}`);
    }
    return path.resolve(process.cwd(), ".data", "storage-objects");
  }

  public static isMetadataAuthEnabled(): boolean {
    return GcpAuthService.isMetadataAuthEnabled();
  }

  public static getEmulatorHost(): string | null {
    const raw =
      process.env.GCS_EMULATOR_HOST?.trim() ||
      process.env.STORAGE_EMULATOR_HOST?.trim();
    if (!raw) return null;
    return raw.replace(/\/+$/, "");
  }

  public static getActiveBackendKind(): StorageBackendKind {
    if (this.getEmulatorHost()) return "gcs_emulator";
    if (GcpAuthService.isAnyServerAuthConfigured()) {
      return "gcs";
    }
    return "local_isolated";
  }

  public static async getStorageAccessToken(options?: {
    throwOnError?: boolean;
  }): Promise<string | null> {
    if (this.getEmulatorHost()) {
      return "emulator-token";
    }
    return GcpAuthService.getAccessToken(GCS_STORAGE_SCOPE, {
      throwOnError: options?.throwOnError,
    });
  }

  /**
   * Sanitizes and strictly rejects path traversal, hidden control chars, slashes, or encoded dot segments.
   */
  public static sanitizePathSegment(raw: string, label: string): string {
    const decoded = (() => {
      try {
        return decodeURIComponent(raw || "");
      } catch {
        return raw || "";
      }
    })();

    if (
      !raw ||
      typeof raw !== "string" ||
      raw.includes("\0") ||
      decoded.includes("\0") ||
      raw.includes("..") ||
      decoded.includes("..") ||
      raw.includes("/") ||
      raw.includes("\\") ||
      decoded.includes("/") ||
      decoded.includes("\\")
    ) {
      throw new AppError({
        message: `Segment de cale invalid sau nesigur pentru ${label}.`,
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    }

    const cleaned = raw.trim().replace(/[^A-Za-z0-9._-]/g, "_");
    if (!cleaned || cleaned === "." || cleaned === "..") {
      throw new AppError({
        message: `Nume invalid pentru ${label}.`,
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    }
    return cleaned;
  }

  /**
   * Builds canonical tenant-scoped object path:
   * tenants/{tenantId}/{entityType}/{entityId}/{fileName}
   */
  public static buildTenantObjectKey(params: {
    tenantId: string;
    entityType: StorageEntityType;
    entityId: string;
    fileName: string;
  }): string {
    const safeTenant = this.sanitizePathSegment(params.tenantId, "tenantId");
    const safeEntityId = this.sanitizePathSegment(params.entityId, "entityId");
    const safeFileName = this.sanitizePathSegment(params.fileName, "fileName");

    const ext = path.extname(safeFileName).toLowerCase();
    if (ext && FORBIDDEN_EXTENSIONS.has(ext)) {
      throw new AppError({
        message: `Extensia de fișier "${ext}" nu este permisă din motive de securitate.`,
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    }

    return `tenants/${safeTenant}/${params.entityType}/${safeEntityId}/${safeFileName}`;
  }

  /**
   * Enforces strict tenant ownership over any requested objectKey.
   * Rejects path traversal (400) and cross-tenant object paths (403).
   */
  public static assertObjectKeyBelongsToTenant(
    verifiedTenantId: string,
    objectKey: string
  ): void {
    const raw = String(objectKey || "");
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      // Keep raw
    }

    if (
      !raw ||
      raw.includes("\0") ||
      decoded.includes("\0") ||
      raw.includes("..") ||
      decoded.includes("..") ||
      raw.includes("\\") ||
      decoded.includes("\\") ||
      raw.startsWith("/")
    ) {
      throw new AppError({
        message: "Cheie de stocare invalidă (tentativă de path traversal respinsă).",
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    }

    const expectedPrefix = `tenants/${verifiedTenantId}/`;
    if (!raw.startsWith(expectedPrefix)) {
      throw new ForbiddenError(
        "Acces interzis: fișierul solicitat nu aparține agenției curente."
      );
    }

    const parts = raw.split("/");
    if (parts.length !== 5) {
      throw new AppError({
        message: "Structură cale obiect invalidă.",
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    }

    const existingMeta = StorageMetadataRepository.getByObjectKey(raw);
    if (existingMeta && existingMeta.tenantId !== verifiedTenantId) {
      throw new ForbiddenError(
        "Acces interzis: proprietatea obiectului nu corespunde tenantului autentificat."
      );
    }
  }

  /**
   * Inspects file magic bytes and enforces MIME allowlists + size limits.
   */
  public static validateFilePayload(params: {
    buffer: Buffer;
    fileName: string;
    declaredMimeType?: string;
    isImageOnly?: boolean;
  }): { mimeType: string; ext: string } {
    const { buffer, fileName, declaredMimeType, isImageOnly } = params;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new AppError({
        message: "Fișierul încărcat este gol sau invalid.",
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    }

    const maxBytes = isImageOnly ? MAX_IMAGE_BYTES : MAX_DOCUMENT_BYTES;
    if (buffer.length > maxBytes) {
      throw new AppError({
        message: `Dimensiunea fișierului depășește limita maximă permisă (${Math.round(maxBytes / (1024 * 1024))}MB).`,
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    }

    // 1. Check raster image magic bytes first
    const imgDetected = detectImageMagicBytes(buffer);
    if (imgDetected) {
      return { mimeType: imgDetected.mime, ext: imgDetected.ext };
    }

    if (isImageOnly) {
      throw new AppError({
        message: "Format de imagine nesuportat sau invalid.",
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    }

    // Reject disguised SVG / HTML / script payloads
    const headSample = buffer.subarray(0, 512).toString("utf8").trimStart().toLowerCase();
    if (
      headSample.startsWith("<svg") ||
      headSample.startsWith("<!doctype html") ||
      headSample.startsWith("<html") ||
      headSample.includes("<script")
    ) {
      throw new AppError({
        message: "Fișierele HTML, SVG sau script nu sunt permise la încărcare.",
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    }

    // Reject Windows PE executables ("MZ") or ELF binaries
    if (
      (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) ||
      (buffer.length >= 4 &&
        buffer[0] === 0x7f &&
        buffer[1] === 0x45 &&
        buffer[2] === 0x4c &&
        buffer[3] === 0x46)
    ) {
      throw new AppError({
        message: "Fișierele executabile nu sunt permise.",
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    }

    // 2. PDF: "%PDF-"
    if (buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
      return { mimeType: "application/pdf", ext: "pdf" };
    }

    // 3. Office OpenXML ZIP (docx / xlsx)
    if (
      buffer.length >= 4 &&
      buffer[0] === 0x50 &&
      buffer[1] === 0x4b &&
      buffer[2] === 0x03 &&
      buffer[3] === 0x04
    ) {
      const ext = path.extname(fileName).toLowerCase().replace(".", "");
      if (ext === "xlsx") {
        return {
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          ext: "xlsx",
        };
      }
      return {
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ext: "docx",
      };
    }

    // 4. Plain text / CSV only if extension & declared MIME match safe text types
    const ext = path.extname(fileName).toLowerCase();
    if (
      (ext === ".txt" || ext === ".csv") &&
      (!declaredMimeType ||
        declaredMimeType === "text/plain" ||
        declaredMimeType === "text/csv")
    ) {
      return {
        mimeType: ext === ".csv" ? "text/csv" : "text/plain",
        ext: ext.slice(1),
      };
    }

    throw new AppError({
      message: "Tip de document nesuportat. Formate permise: PDF, DOCX, XLSX, TXT, CSV, JPG, PNG, WEBP.",
      code: "VALIDATION_ERROR",
      statusCode: 400,
    });
  }

  private static getSigningSecret(): string {
    return (
      process.env.STORAGE_SIGNING_SECRET?.trim() ||
      process.env.SESSION_SECRET?.trim() ||
      this.ephemeralSigningSecret
    );
  }

  /**
   * Generates a tamper-proof expiring HMAC-SHA256 download URL scoped strictly to (tenantId, objectKey).
   */
  public static generateSignedDownloadUrl(params: {
    tenantId: string;
    objectKey: string;
    ttlSeconds?: number;
    basePath?: string;
  }): { url: string; expiresAt: string; signature: string } {
    this.assertObjectKeyBelongsToTenant(params.tenantId, params.objectKey);
    const ttl = Math.min(3600, Math.max(30, params.ttlSeconds ?? 300));
    const exp = Math.floor(Date.now() / 1000) + ttl;
    const payload = `${params.tenantId}::${params.objectKey}::${exp}`;
    const signature = crypto
      .createHmac("sha256", this.getSigningSecret())
      .update(payload)
      .digest("hex");

    const base = params.basePath || "/api/storage/signed";
    const qs = new URLSearchParams({
      key: params.objectKey,
      tenantId: params.tenantId,
      exp: String(exp),
      sig: signature,
    });

    return {
      url: `${base}?${qs.toString()}`,
      expiresAt: new Date(exp * 1000).toISOString(),
      signature,
    };
  }

  public static verifySignedDownloadParams(params: {
    objectKey: string;
    tenantId: string;
    exp: number;
    signature: string;
  }): void {
    const nowSec = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(params.exp) || params.exp < nowSec) {
      throw new ForbiddenError("Linkul de descărcare semnat a expirat.");
    }
    this.assertObjectKeyBelongsToTenant(params.tenantId, params.objectKey);
    const payload = `${params.tenantId}::${params.objectKey}::${params.exp}`;
    const expected = crypto
      .createHmac("sha256", this.getSigningSecret())
      .update(payload)
      .digest("hex");

    const sigBuf = Buffer.from(params.signature || "", "utf8");
    const expBuf = Buffer.from(expected, "utf8");
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      throw new ForbiddenError("Semnătură link descărcare invalidă.");
    }
  }

  private static getUploadBaseEndpoint(): string {
    const emulator = this.getEmulatorHost();
    if (emulator) return `${emulator}/upload/storage/v1`;
    return "https://storage.googleapis.com/upload/storage/v1";
  }

  private static getJsonBaseEndpoint(): string {
    const emulator = this.getEmulatorHost();
    if (emulator) return `${emulator}/storage/v1`;
    return "https://storage.googleapis.com/storage/v1";
  }

  /**
   * Uploads an object into tenant-isolated cloud storage (or GCS emulator / isolated local store).
   */
  public static async uploadObject(
    input: UploadStorageObjectInput
  ): Promise<StorageObjectMetadata> {
    const { mimeType } = this.validateFilePayload({
      buffer: input.buffer,
      fileName: input.fileName,
      declaredMimeType: input.declaredMimeType,
      isImageOnly: input.isImageOnly,
    });

    const objectKey = this.buildTenantObjectKey({
      tenantId: input.tenantId,
      entityType: input.entityType,
      entityId: input.entityId,
      fileName: input.fileName,
    });

    const visibility: StorageVisibility =
      input.visibility ||
      (input.entityType === "properties" ? "public_listing" : "private");

    // Private documents MUST NEVER be stored under public_listing visibility
    if (input.entityType === "documents" && visibility !== "private") {
      throw new AppError({
        message: "Documentele agenției pot fi stocate exclusiv cu vizibilitate privată.",
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    }

    const bucketName = this.getBucketName();
    const backend = this.getActiveBackendKind();
    const sha256 = crypto.createHash("sha256").update(input.buffer).digest("hex");

    if (backend === "gcs" || backend === "gcs_emulator") {
      const token = await this.getStorageAccessToken();
      if (!token) {
        throw new AppError({
          message: "Nu s-a putut obține tokenul OAuth2 pentru Cloud Storage.",
          code: "INTERNAL_ERROR",
          statusCode: 500,
        });
      }

      const uploadUrl = `${this.getUploadBaseEndpoint()}/b/${encodeURIComponent(
        bucketName
      )}/o?uploadType=media&name=${encodeURIComponent(objectKey)}`;

      try {
        await axios.post(uploadUrl, input.buffer, {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": mimeType,
            "Content-Length": String(input.buffer.length),
            ...(backend === "gcs" ? GcpAuthService.getQuotaProjectHeaders() : {}),
          },
          maxBodyLength: Infinity,
          timeout: 20_000,
        });
      } catch (err: unknown) {
        const safeErr = GcpAuthService.sanitizeGcpHttpError(err, "Cloud Storage", "uploadObject");
        logger.error("Eroare la încărcarea fișierului în Cloud Storage", safeErr, {
          module: "cloud-storage",
          tenantId: input.tenantId,
          statusCode: safeErr.statusCode,
        });
        throw safeErr;
      }
    } else {
      const localRoot = this.getLocalStorageRoot();
      const targetPath = path.resolve(localRoot, objectKey);
      if (!targetPath.startsWith(localRoot + path.sep)) {
        throw new AppError({
          message: "Cale țintă de stocare invalidă.",
          code: "VALIDATION_ERROR",
          statusCode: 400,
        });
      }
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmpPath, input.buffer);
      fs.renameSync(tmpPath, targetPath);
    }

    const now = new Date().toISOString();
    const publicUrl =
      visibility === "public_listing"
        ? `/api/storage/media/${objectKey}`
        : undefined;

    const meta: StorageObjectMetadata = {
      objectKey,
      tenantId: input.tenantId,
      entityType: input.entityType,
      entityId: input.entityId,
      fileName: path.basename(objectKey),
      originalFileName: input.fileName,
      mimeType,
      sizeBytes: input.buffer.length,
      sha256,
      visibility,
      uploadedByUserId: input.uploadedByUserId,
      bucketName,
      backend,
      publicUrl,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    StorageMetadataRepository.saveObject(meta);
    return meta;
  }

  /**
   * Downloads an object verifying strict tenant ownership (unless explicitly served
   * via public_listing route where visibility is strictly "public_listing").
   */
  public static async downloadObject(params: {
    objectKey: string;
    tenantId?: string;
    allowPublicListing?: boolean;
  }): Promise<{ buffer: Buffer; metadata: StorageObjectMetadata }> {
    const meta = StorageMetadataRepository.getByObjectKey(params.objectKey);

    if (params.tenantId) {
      this.assertObjectKeyBelongsToTenant(params.tenantId, params.objectKey);
      if (!meta) {
        throw new NotFoundError("Fișier stocat", params.objectKey);
      }
    } else if (params.allowPublicListing) {
      if (!meta) {
        throw new NotFoundError("Fișier stocat", params.objectKey);
      }
      if (
        meta.visibility !== "public_listing" ||
        meta.entityType !== "properties"
      ) {
        throw new ForbiddenError(
          "Fișierul solicitat este privat și necesită autentificare în cadrul agenției."
        );
      }
    } else {
      throw new ForbiddenError("Contextul de tenant lipsește pentru accesarea fișierului.");
    }

    const backend = meta.backend || this.getActiveBackendKind();
    let buffer: Buffer;

    if (backend === "gcs" || backend === "gcs_emulator") {
      const token = await this.getStorageAccessToken();
      if (!token) {
        throw new AppError({
          message: "Credențialele Cloud Storage nu sunt disponibile.",
          code: "INTERNAL_ERROR",
          statusCode: 500,
        });
      }
      const dlUrl = `${this.getJsonBaseEndpoint()}/b/${encodeURIComponent(
        meta.bucketName
      )}/o/${encodeURIComponent(meta.objectKey)}?alt=media`;
      try {
        const res = await axios.get(dlUrl, {
          headers: {
            Authorization: `Bearer ${token}`,
            ...(backend === "gcs" ? GcpAuthService.getQuotaProjectHeaders() : {}),
          },
          responseType: "arraybuffer",
          timeout: 20_000,
        });
        buffer = Buffer.from(res.data);
      } catch (err: any) {
        if (err?.response?.status === 404) {
          throw new NotFoundError("Fișier Cloud Storage", params.objectKey);
        }
        const safeErr = GcpAuthService.sanitizeGcpHttpError(err, "Cloud Storage", "downloadObject");
        logger.error("Eroare la descărcarea fișierului din Cloud Storage", safeErr, {
          module: "cloud-storage",
          tenantId: params.tenantId,
          statusCode: safeErr.statusCode,
        });
        throw safeErr;
      }
    } else {
      const localRoot = this.getLocalStorageRoot();
      const targetPath = path.resolve(localRoot, meta.objectKey);
      if (!targetPath.startsWith(localRoot + path.sep) || !fs.existsSync(targetPath)) {
        throw new NotFoundError("Fișier stocat local", params.objectKey);
      }
      buffer = fs.readFileSync(targetPath);
    }

    return { buffer, metadata: meta };
  }

  /**
   * Deletes an object strictly within the authenticated tenant boundary.
   */
  public static async deleteObject(params: {
    tenantId: string;
    objectKey: string;
  }): Promise<void> {
    this.assertObjectKeyBelongsToTenant(params.tenantId, params.objectKey);
    const meta = StorageMetadataRepository.getByObjectKeyForTenant(
      params.tenantId,
      params.objectKey
    );
    if (!meta) {
      throw new NotFoundError("Fișier stocat", params.objectKey);
    }

    const backend = meta.backend || this.getActiveBackendKind();
    if (backend === "gcs" || backend === "gcs_emulator") {
      const token = await this.getStorageAccessToken();
      if (token) {
        const delUrl = `${this.getJsonBaseEndpoint()}/b/${encodeURIComponent(
          meta.bucketName
        )}/o/${encodeURIComponent(meta.objectKey)}`;
        try {
          await axios.delete(delUrl, {
            headers: {
              Authorization: `Bearer ${token}`,
              ...(backend === "gcs" ? GcpAuthService.getQuotaProjectHeaders() : {}),
            },
            timeout: 10_000,
          });
        } catch (err: any) {
          if (err?.response?.status !== 404) {
            const safeErr = GcpAuthService.sanitizeGcpHttpError(err, "Cloud Storage", "deleteObject");
            logger.error("Eroare la ștergerea fișierului din Cloud Storage", safeErr, {
              module: "cloud-storage",
              tenantId: params.tenantId,
              statusCode: safeErr.statusCode,
            });
            throw safeErr;
          }
        }
      }
    } else {
      const localRoot = this.getLocalStorageRoot();
      const targetPath = path.resolve(localRoot, meta.objectKey);
      if (targetPath.startsWith(localRoot + path.sep) && fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
      }
    }

    StorageMetadataRepository.markDeleted(params.tenantId, params.objectKey);
  }
}
