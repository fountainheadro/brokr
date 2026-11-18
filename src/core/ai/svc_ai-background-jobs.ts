import { ForbiddenError, NotFoundError } from "../errors/app_error";
import { PersistentStoreService } from "../database/svc_persistent-store";
import { logger } from "../logger/logger";

export interface AiBackgroundJobRecord {
  id: string; // e.g. "job_ai_123"
  tenantId: string;
  userId: string;
  operationType: "bulk_property_extraction" | "batch_description_generation" | "document_analysis";
  status: "pending" | "processing" | "completed" | "failed";
  progressPercent: number;
  totalItems: number;
  processedItems: number;
  payload: Record<string, any>;
  result?: Record<string, any>;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

const COL_AI_JOBS = "ai_jobs";

export class AiBackgroundJobService {
  public static createJob(
    tenantId: string,
    userId: string,
    operationType: AiBackgroundJobRecord["operationType"],
    totalItems: number,
    payload: Record<string, any>
  ): AiBackgroundJobRecord {
    const id = `job_ai_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();

    const job: AiBackgroundJobRecord = {
      id,
      tenantId,
      userId,
      operationType,
      status: "pending",
      progressPercent: 0,
      totalItems,
      processedItems: 0,
      payload,
      createdAt: now,
      updatedAt: now,
    };

    PersistentStoreService.set(COL_AI_JOBS, id, job);
    return job;
  }

  public static getJob(tenantId: string, jobId: string): AiBackgroundJobRecord {
    const job = PersistentStoreService.get<AiBackgroundJobRecord>(COL_AI_JOBS, jobId);
    if (!job) {
      throw new NotFoundError("Jobul AI", jobId);
    }

    // Strict tenant isolation: cannot inspect another agency's background jobs
    if (job.tenantId !== tenantId) {
      throw new ForbiddenError("Acces interzis: Acest job AI aparține altei agenții imobiliare.");
    }

    return job;
  }

  public static updateProgress(
    jobId: string,
    processedItems: number,
    status: AiBackgroundJobRecord["status"],
    result?: Record<string, any>,
    error?: string
  ): AiBackgroundJobRecord {
    const job = PersistentStoreService.get<AiBackgroundJobRecord>(COL_AI_JOBS, jobId);
    if (!job) {
      throw new NotFoundError("Jobul AI", jobId);
    }

    job.processedItems = processedItems;
    job.progressPercent =
      job.totalItems > 0 ? Math.min(100, Math.round((processedItems / job.totalItems) * 100)) : 100;
    job.status = status;
    if (result) job.result = result;
    if (error) job.error = error;
    job.updatedAt = new Date().toISOString();

    if (status === "failed") {
      logger.recordMetric("ai_job_failure");
    }

    PersistentStoreService.set(COL_AI_JOBS, jobId, job);
    return job;
  }

  public static listJobs(tenantId: string): AiBackgroundJobRecord[] {
    const all = PersistentStoreService.getAll<AiBackgroundJobRecord>(COL_AI_JOBS);
    return Object.values(all)
      .filter((j) => j.tenantId === tenantId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
}
