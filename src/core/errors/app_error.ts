export type ErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "TENANT_NOT_FOUND"
  | "TENANT_SUSPENDED"
  | "MEMBERSHIP_INACTIVE"
  | "AUTH_REVOKED"
  | "AUTH_TENANT_MISMATCH"
  | "AUTH_BACKEND_UNAVAILABLE"
  | "CONFIGURATION_ERROR"
  | "QUOTA_EXCEEDED"
  | "MODULE_DISABLED"
  | "RATE_LIMIT_EXCEEDED"
  | "CONFLICT"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: unknown;
  public readonly tenantId?: string;

  constructor(params: {
    message: string;
    code: ErrorCode;
    statusCode?: number;
    details?: unknown;
    tenantId?: string;
  }) {
    super(params.message);
    this.name = "AppError";
    this.code = params.code;
    this.statusCode = params.statusCode || 500;
    this.details = params.details;
    this.tenantId = params.tenantId;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super({ message, code: "VALIDATION_ERROR", statusCode: 400, details });
    this.name = "ValidationError";
  }
}

export class NotFoundError extends AppError {
  constructor(entityName: string, id?: string) {
    super({
      message: `${entityName}${id ? ` #${id}` : ""} nu a fost găsit.`,
      code: "NOT_FOUND",
      statusCode: 404,
    });
    this.name = "NotFoundError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Autentificare necesară.") {
    super({ message, code: "UNAUTHORIZED", statusCode: 401 });
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Acces interzis pentru această resursă.") {
    super({ message, code: "FORBIDDEN", statusCode: 403 });
    this.name = "ForbiddenError";
  }
}

export class TenantError extends AppError {
  constructor(message: string, code: "TENANT_NOT_FOUND" | "TENANT_SUSPENDED", tenantId?: string) {
    super({ message, code, statusCode: code === "TENANT_NOT_FOUND" ? 404 : 403, tenantId });
    this.name = "TenantError";
  }
}

export class QuotaExceededError extends AppError {
  constructor(message: string, details?: { current: number; max: number; metric: string }, tenantId?: string) {
    super({ message, code: "QUOTA_EXCEEDED", statusCode: 429, details, tenantId });
    this.name = "QuotaExceededError";
  }
}
