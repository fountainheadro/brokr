import { Router, Request, Response } from "express";
import crypto from "crypto";
import { requireTenantContext } from "../middleware/mw_tenant-context";
import { CloudStorageService } from "../../src/core/storage/svc_cloud-storage";
import { StorageMetadataRepository } from "../../src/core/storage/repo_storage-metadata";
import { createErrorResponse, createSuccessResponse } from "../../src/core/api/api_response";
import {
  createThumbnail,
  parseThumbnailWidth,
  shouldServeWebp,
} from "../utils/img_thumbnail";

export const storageRouter = Router();

/**
 * GET /api/storage/media/:tenantId/:entityType/:entityId/:fileName
 * Serves strictly PUBLIC property listing images across instances.
 * Private documents under /documents or visibility !== "public_listing" are ALWAYS rejected (403).
 */
storageRouter.get(
  [
    "/media/tenants/:tenantId/:entityType/:entityId/:fileName",
    "/media/:tenantId/:entityType/:entityId/:fileName",
  ],
  async (req: Request, res: Response) => {
    try {
      const { tenantId, entityType, entityId, fileName } = req.params;
      if (entityType !== "properties") {
        res
          .status(403)
          .json(
            createErrorResponse(
              "FORBIDDEN",
              "Doar imaginile publice ale proprietăților pot fi accesate prin această rută."
            )
          );
        return;
      }

      const objectKey = CloudStorageService.buildTenantObjectKey({
        tenantId,
        entityType: "properties",
        entityId,
        fileName,
      });

      const { buffer, metadata } = await CloudStorageService.downloadObject({
        objectKey,
        allowPublicListing: true,
      });

      const targetWidth = parseThumbnailWidth(req.query.w);
      if (targetWidth && metadata.mimeType.startsWith("image/") && !metadata.mimeType.includes("svg")) {
        const preferWebp = shouldServeWebp(req.headers.accept, req.query.format);
        const thumb = await createThumbnail({
          buffer,
          mimeType: metadata.mimeType,
          targetWidth,
          preferWebp,
          cacheKey: `storage::${objectKey}`,
        });
        res.setHeader("Content-Type", thumb.mimeType);
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Vary", "Accept");
        res.setHeader("Cache-Control", "public, max-age=86400");
        res.send(thumb.data);
        return;
      }

      res.setHeader("Content-Type", metadata.mimeType);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(buffer);
    } catch (err: any) {
      const status = err?.statusCode || 404;
      res
        .status(status)
        .json(createErrorResponse(err?.code || "NOT_FOUND", err?.message || "Fișier negăsit."));
    }
  }
);

/**
 * GET /api/storage/signed
 * Serves files via expiring HMAC-SHA256 signed download token bound strictly to (tenantId, objectKey).
 */
storageRouter.get("/signed", async (req: Request, res: Response) => {
  try {
    const objectKey = String(req.query.key || "");
    const tenantId = String(req.query.tenantId || "");
    const exp = Number(req.query.exp || "0");
    const signature = String(req.query.sig || "");

    CloudStorageService.verifySignedDownloadParams({
      objectKey,
      tenantId,
      exp,
      signature,
    });

    const { buffer, metadata } = await CloudStorageService.downloadObject({
      objectKey,
      tenantId,
    });

    res.setHeader("Content-Type", metadata.mimeType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Cache-Control",
      metadata.visibility === "private" ? "private, no-store" : "public, max-age=3600"
    );
    res.send(buffer);
  } catch (err: any) {
    const status = err?.statusCode || 403;
    res
      .status(status)
      .json(createErrorResponse(err?.code || "FORBIDDEN", err?.message || "Acces interzis."));
  }
});

/**
 * POST /api/storage/documents/upload
 * Tenant-authenticated private document upload.
 * Derives tenantId STRICTLY from server-verified req.tenantContext.tenantId.
 * Rejects any attempt by the client to specify a different tenantId (403).
 */
storageRouter.post(
  "/documents/upload",
  ...requireTenantContext,
  async (req: Request, res: Response) => {
    try {
      const ctx = req.tenantContext!;
      const requestedTenantId =
        typeof req.body?.tenantId === "string" ? req.body.tenantId.trim() : "";

      if (requestedTenantId && requestedTenantId !== ctx.tenantId) {
        res
          .status(403)
          .json(
            createErrorResponse(
              "FORBIDDEN",
              "Nu puteți încărca documente în spațiul altei agenții."
            )
          );
        return;
      }

      const raw = req.body?.dataUrl || req.body?.base64;
      const fileName = String(req.body?.fileName || `doc_${Date.now()}.pdf`);
      const documentId = String(
        req.body?.documentId || req.body?.entityId || `doc_${crypto.randomUUID().slice(0, 8)}`
      );
      const declaredMimeType =
        typeof req.body?.mimeType === "string" ? req.body.mimeType : undefined;

      if (!raw || typeof raw !== "string") {
        res
          .status(400)
          .json(createErrorResponse("VALIDATION_ERROR", "Lipsește conținutul fișierului."));
        return;
      }

      let base64Data = raw;
      const matches = raw.match(/^data:([^;]+);base64,(.+)$/);
      if (matches) {
        base64Data = matches[2];
      }

      const buffer = Buffer.from(base64Data, "base64");
      const meta = await CloudStorageService.uploadObject({
        tenantId: ctx.tenantId,
        entityType: "documents",
        entityId: documentId,
        fileName,
        buffer,
        declaredMimeType: declaredMimeType || (matches ? matches[1] : undefined),
        visibility: "private",
        uploadedByUserId: ctx.userId,
        isImageOnly: false,
      });

      const signed = CloudStorageService.generateSignedDownloadUrl({
        tenantId: ctx.tenantId,
        objectKey: meta.objectKey,
        ttlSeconds: 300,
      });

      res.status(201).json(
        createSuccessResponse({
          metadata: meta,
          downloadUrl: `/api/storage/documents/download?key=${encodeURIComponent(meta.objectKey)}`,
          signedUrl: signed.url,
          expiresAt: signed.expiresAt,
        })
      );
    } catch (err: any) {
      const status = err?.statusCode || 400;
      res
        .status(status)
        .json(createErrorResponse(err?.code || "VALIDATION_ERROR", err?.message || "Upload eșuat."));
    }
  }
);

/**
 * GET /api/storage/documents/list
 * Lists stored objects strictly owned by the authenticated tenant.
 */
storageRouter.get(
  "/documents/list",
  ...requireTenantContext,
  (req: Request, res: Response) => {
    const ctx = req.tenantContext!;
    const items = StorageMetadataRepository.listByTenant(ctx.tenantId);
    res.json(createSuccessResponse(items));
  }
);

/**
 * GET /api/storage/documents/download?key=...
 * Downloads a tenant-owned file strictly within verified TenantContext.
 */
storageRouter.get(
  "/documents/download",
  ...requireTenantContext,
  async (req: Request, res: Response) => {
    try {
      const ctx = req.tenantContext!;
      const objectKey = String(req.query.key || "");
      const { buffer, metadata } = await CloudStorageService.downloadObject({
        objectKey,
        tenantId: ctx.tenantId,
      });

      res.setHeader("Content-Type", metadata.mimeType);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, no-store");
      res.send(buffer);
    } catch (err: any) {
      const status = err?.statusCode || 404;
      res
        .status(status)
        .json(createErrorResponse(err?.code || "FORBIDDEN", err?.message || "Acces interzis."));
    }
  }
);

/**
 * POST /api/storage/documents/signed-url
 * Generates an expiring signed URL strictly for objects belonging to req.tenantContext.tenantId.
 */
storageRouter.post(
  "/documents/signed-url",
  ...requireTenantContext,
  (req: Request, res: Response) => {
    try {
      const ctx = req.tenantContext!;
      const objectKey = String(req.body?.objectKey || "");
      const ttlSeconds =
        typeof req.body?.ttlSeconds === "number" ? req.body.ttlSeconds : 300;
      const signed = CloudStorageService.generateSignedDownloadUrl({
        tenantId: ctx.tenantId,
        objectKey,
        ttlSeconds,
      });
      res.json(createSuccessResponse(signed));
    } catch (err: any) {
      const status = err?.statusCode || 403;
      res
        .status(status)
        .json(createErrorResponse(err?.code || "FORBIDDEN", err?.message || "Acces interzis."));
    }
  }
);

/**
 * DELETE /api/storage/documents?key=...
 * Deletes an object strictly owned by req.tenantContext.tenantId.
 */
storageRouter.delete(
  "/documents",
  ...requireTenantContext,
  async (req: Request, res: Response) => {
    try {
      const ctx = req.tenantContext!;
      const objectKey = String(req.query.key || req.body?.objectKey || "");
      await CloudStorageService.deleteObject({
        tenantId: ctx.tenantId,
        objectKey,
      });
      res.json(createSuccessResponse({ deleted: true, objectKey }));
    } catch (err: any) {
      const status = err?.statusCode || 403;
      res
        .status(status)
        .json(createErrorResponse(err?.code || "FORBIDDEN", err?.message || "Ștergere interzisă."));
    }
  }
);
