import { Request, Response, NextFunction } from "express";
import { logger } from "../../src/core/logger/logger";

/**
 * Records API request latency and unexpected 5xx operational errors
 * without logging credentials or sensitive headers.
 */
export function mwObservability(req: Request, res: Response, next: NextFunction): void {
  if (!req.originalUrl.startsWith("/api")) {
    next();
    return;
  }

  const startMs = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - startMs;
    logger.recordRequestLatency(durationMs);

    if (res.statusCode >= 500) {
      logger.recordMetric("api_error");
      logger.error("API server error response", undefined, {
        module: "http-observability",
        tenantId: req.tenantContext?.tenantId,
        userId: req.authUser?.uid,
        meta: {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          durationMs,
        },
      });
    } else if (process.env.NODE_ENV === "production") {
      logger.info("API request completed", {
        module: "http-observability",
        tenantId: req.tenantContext?.tenantId,
        userId: req.authUser?.uid,
        meta: {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          durationMs,
        },
      });
    }
  });

  next();
}
