import { ErrorCode } from "../errors/app_error";

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    tenantId?: string;
    timestamp: string;
  };
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    timestamp: string;
  };
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

export function createSuccessResponse<T>(
  data: T,
  meta?: { page?: number; limit?: number; total?: number; tenantId?: string }
): ApiSuccessResponse<T> {
  return {
    success: true,
    data,
    meta: {
      ...meta,
      timestamp: new Date().toISOString(),
    },
  };
}

export function createErrorResponse(
  code: ErrorCode,
  message: string,
  details?: unknown
): ApiErrorResponse {
  return {
    success: false,
    error: {
      code,
      message,
      details,
      timestamp: new Date().toISOString(),
    },
  };
}
