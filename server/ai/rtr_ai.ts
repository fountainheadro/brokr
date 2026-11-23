import { Router, Request, Response } from "express";
import { requireTenantContext } from "../middleware/mw_tenant-context";
import { requireRole } from "../middleware/mw_authorization";
import { requireModule, requireQuota } from "../middleware/mw_entitlement";
import { AiOrchestrator } from "../../src/core/ai/agt_ai-orchestrator";
import { AiConversationService } from "../../src/core/ai/svc_ai-conversation";
import { AiConfigService } from "../../src/core/ai/svc_ai-config";
import { AiInstructionService } from "../../src/core/ai/svc_ai-instruction";
import { createSuccessResponse, createErrorResponse } from "../../src/core/api/api_response";
import { AppError } from "../../src/core/errors/app_error";

export const aiRouter = Router();

// Protect all AI routes with verified tenant context
aiRouter.use(requireTenantContext);

/**
 * POST /api/tenant/ai/chat
 * Multi-tenant interactive chat with AI assistant, tool calling and quota reservation.
 */
aiRouter.post("/chat", requireModule("mod_ai_extraction"), async (req: Request, res: Response) => {
  try {
    const tenantContext = req.tenantContext!;
    const { prompt, conversationId, temperature } = req.body;

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      res.status(400).json(createErrorResponse("VALIDATION_ERROR", "Mesajul (prompt) este obligatoriu."));
      return;
    }

    const result = await AiOrchestrator.execute({
      tenantId: tenantContext.tenantId,
      userId: tenantContext.userId,
      userRole: tenantContext.role,
      conversationId,
      prompt: prompt.trim(),
      operationType: "chat",
      temperature,
    });

    res.json(createSuccessResponse(result));
  } catch (err: any) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json(createErrorResponse(err.code, err.message, err.details));
      return;
    }
    res.status(500).json(createErrorResponse("INTERNAL_ERROR", err?.message || "Eroare la procesarea cererii AI."));
  }
});

/**
 * GET /api/tenant/ai/conversations
 * Lists AI conversations strictly scoped to the authenticated tenant and user.
 */
aiRouter.get("/conversations", async (req: Request, res: Response) => {
  try {
    const tenantContext = req.tenantContext!;
    const conversations = await AiConversationService.listConversationsAsync(
      tenantContext.tenantId,
      tenantContext.userId
    );
    res.json(createSuccessResponse(conversations));
  } catch (err: any) {
    res.status(500).json(createErrorResponse("INTERNAL_ERROR", "Eroare la obținerea conversațiilor."));
  }
});

/**
 * POST /api/tenant/ai/conversations
 * Creates a new conversation for the user durably in Cloud Firestore.
 */
aiRouter.post("/conversations", async (req: Request, res: Response) => {
  try {
    const tenantContext = req.tenantContext!;
    const title = req.body.title || "Conversație nouă";
    const conv = await AiConversationService.createConversationAsync(
      tenantContext.tenantId,
      tenantContext.userId,
      title
    );
    res.status(201).json(createSuccessResponse(conv));
  } catch (err: any) {
    res.status(500).json(createErrorResponse("INTERNAL_ERROR", "Eroare la crearea conversației."));
  }
});

/**
 * GET /api/tenant/ai/conversations/:id
 * Retrieves conversation history with tenant isolation enforcement.
 */
aiRouter.get("/conversations/:id", async (req: Request, res: Response) => {
  try {
    const tenantContext = req.tenantContext!;
    const isOwnerOrAdmin = tenantContext.role === "agency_owner" || tenantContext.role === "agency_admin";
    const conv = await AiConversationService.getConversationAsync(
      tenantContext.tenantId,
      tenantContext.userId,
      req.params.id,
      isOwnerOrAdmin
    );
    res.json(createSuccessResponse(conv));
  } catch (err: any) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json(createErrorResponse(err.code, err.message));
      return;
    }
    res.status(500).json(createErrorResponse("INTERNAL_ERROR", "Eroare la încărcarea conversației."));
  }
});

/**
 * DELETE /api/tenant/ai/conversations/:id
 * Deletes a conversation permanently from Cloud Firestore.
 */
aiRouter.delete("/conversations/:id", async (req: Request, res: Response) => {
  try {
    const tenantContext = req.tenantContext!;
    await AiConversationService.deleteConversationAsync(
      tenantContext.tenantId,
      tenantContext.userId,
      req.params.id
    );
    res.json(createSuccessResponse({ deleted: true }));
  } catch (err: any) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json(createErrorResponse(err.code, err.message));
      return;
    }
    res.status(500).json(createErrorResponse("INTERNAL_ERROR", "Eroare la ștergerea conversației."));
  }
});

/**
 * GET /api/tenant/ai/config
 * Retrieves agency-specific AI preferences hydrated from Cloud Firestore.
 */
aiRouter.get("/config", async (req: Request, res: Response) => {
  try {
    const tenantContext = req.tenantContext!;
    const config = await AiConfigService.getTenantConfigAsync(tenantContext.tenantId);
    res.json(createSuccessResponse(config));
  } catch (err: any) {
    res.status(500).json(createErrorResponse("INTERNAL_ERROR", "Eroare la încărcarea configurației AI."));
  }
});

/**
 * PUT /api/tenant/ai/config
 * Updates agency-specific AI preferences durably in Cloud Firestore (agency_owner or agency_admin only).
 */
aiRouter.put("/config", requireRole(["agency_owner", "agency_admin"]), async (req: Request, res: Response) => {
  try {
    const tenantContext = req.tenantContext!;
    const updated = await AiConfigService.updateTenantConfigAsync(
      tenantContext.tenantId,
      req.body,
      tenantContext.userEmail
    );
    res.json(createSuccessResponse(updated));
  } catch (err: any) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json(createErrorResponse(err.code, err.message));
      return;
    }
    res.status(500).json(createErrorResponse("INTERNAL_ERROR", "Eroare la salvarea configurației AI."));
  }
});

/**
 * GET /api/tenant/ai/instructions
 * Retrieves versioned AI instructions available to this agency hydrated from Cloud Firestore.
 */
aiRouter.get("/instructions", async (req: Request, res: Response) => {
  try {
    const tenantContext = req.tenantContext!;
    const instructions = await AiInstructionService.listInstructionsAsync(tenantContext.tenantId);
    res.json(createSuccessResponse(instructions));
  } catch (err: any) {
    res.status(500).json(createErrorResponse("INTERNAL_ERROR", "Eroare la încărcarea instrucțiunilor."));
  }
});

/**
 * POST /api/tenant/ai/instructions
 * Creates or updates an agency custom instruction durably in Cloud Firestore (agency_owner or agency_admin only).
 */
aiRouter.post("/instructions", requireRole(["agency_owner", "agency_admin"]), async (req: Request, res: Response) => {
  try {
    const tenantContext = req.tenantContext!;
    const { id, category, name, content } = req.body;
    const saved = await AiInstructionService.saveInstructionAsync(
      {
        id,
        tenantId: tenantContext.tenantId,
        category,
        name,
        content,
      },
      tenantContext.userEmail
    );
    res.json(createSuccessResponse(saved));
  } catch (err: any) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json(createErrorResponse(err.code, err.message));
      return;
    }
    res.status(500).json(createErrorResponse("INTERNAL_ERROR", "Eroare la salvarea instrucțiunii."));
  }
});
