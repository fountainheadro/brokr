import type http from "node:http";
import type express from "express";
import { validateProductionEnvironment } from "../env/svc_production-config";
import { logger } from "../logger/logger";

export interface HealthProbeStatus {
  status: "ok" | "starting" | "draining" | "not_ready";
  service: string;
  uptimeSeconds: number;
  timestamp: string;
  checks?: {
    ready: boolean;
    draining: boolean;
    configValid: boolean;
    firebaseProjectConfigured: boolean;
    storageSigningSecretConfigured: boolean;
  };
}

export class ServerLifecycleController {
  private readonly startedAtMs = Date.now();
  private ready = false;
  private draining = false;
  private shutdownReason: string | null = null;
  private readonly serviceName: string;

  constructor(serviceName = "brokr-core-api") {
    this.serviceName = serviceName;
  }

  public markReady(): void {
    if (!this.draining) {
      this.ready = true;
    }
  }

  public markDraining(reason = "SIGTERM"): void {
    this.draining = true;
    this.ready = false;
    this.shutdownReason = reason;
  }

  public isReady(): boolean {
    return this.ready && !this.draining;
  }

  public isDraining(): boolean {
    return this.draining;
  }

  public getShutdownReason(): string | null {
    return this.shutdownReason;
  }

  public getUptimeSeconds(): number {
    return Math.max(0, Math.floor((Date.now() - this.startedAtMs) / 1000));
  }

  /**
   * Liveness probe payload (/api/healthz):
   * Returns HTTP 200 while the Node.js event loop is alive and not shutting down;
   * returns HTTP 503 during graceful drain so Cloud Run stops routing new traffic.
   * Never exposes secrets, env values, or internal stack traces.
   */
  public getLiveness(): { httpStatus: number; body: HealthProbeStatus } {
    if (this.draining) {
      return {
        httpStatus: 503,
        body: {
          status: "draining",
          service: this.serviceName,
          uptimeSeconds: this.getUptimeSeconds(),
          timestamp: new Date().toISOString(),
        },
      };
    }

    return {
      httpStatus: 200,
      body: {
        status: "ok",
        service: this.serviceName,
        uptimeSeconds: this.getUptimeSeconds(),
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Readiness probe payload (/api/readyz):
   * Verifies startup hydration completed, container is not draining, and required
   * runtime configuration is valid. Strictly returns boolean check flags only.
   */
  public getReadiness(
    env: Record<string, string | undefined> = process.env
  ): { httpStatus: number; body: HealthProbeStatus } {
    const report = validateProductionEnvironment(env);
    const checks = {
      ready: this.ready,
      draining: this.draining,
      configValid: report.valid,
      firebaseProjectConfigured: report.checks.firebaseProjectConfigured,
      storageSigningSecretConfigured: report.checks.storageSigningSecretConfigured,
    };

    if (this.draining) {
      return {
        httpStatus: 503,
        body: {
          status: "draining",
          service: this.serviceName,
          uptimeSeconds: this.getUptimeSeconds(),
          timestamp: new Date().toISOString(),
          checks,
        },
      };
    }

    if (!this.ready) {
      return {
        httpStatus: 503,
        body: {
          status: "starting",
          service: this.serviceName,
          uptimeSeconds: this.getUptimeSeconds(),
          timestamp: new Date().toISOString(),
          checks,
        },
      };
    }

    if (!report.valid) {
      return {
        httpStatus: 503,
        body: {
          status: "not_ready",
          service: this.serviceName,
          uptimeSeconds: this.getUptimeSeconds(),
          timestamp: new Date().toISOString(),
          checks,
        },
      };
    }

    return {
      httpStatus: 200,
      body: {
        status: "ok",
        service: this.serviceName,
        uptimeSeconds: this.getUptimeSeconds(),
        timestamp: new Date().toISOString(),
        checks,
      },
    };
  }
}

export function registerHealthRoutes(
  app: express.Express,
  lifecycle: ServerLifecycleController,
  envProvider: () => Record<string, string | undefined> = () => process.env
): void {
  // Backward-compatible simple health endpoint
  app.get("/api/health", (_req, res) => {
    const liveness = lifecycle.getLiveness();
    res.setHeader("Cache-Control", "no-store");
    res.status(liveness.httpStatus).json({
      status: liveness.body.status,
      timestamp: liveness.body.timestamp,
    });
  });

  // Cloud Run / container liveness probe
  app.get("/api/healthz", (_req, res) => {
    const liveness = lifecycle.getLiveness();
    res.setHeader("Cache-Control", "no-store");
    res.status(liveness.httpStatus).json(liveness.body);
  });

  // Cloud Run / load balancer readiness probe
  app.get("/api/readyz", (_req, res) => {
    const readiness = lifecycle.getReadiness(envProvider());
    res.setHeader("Cache-Control", "no-store");
    res.status(readiness.httpStatus).json(readiness.body);
  });
}

export interface GracefulShutdownOptions {
  server: http.Server;
  lifecycle: ServerLifecycleController;
  cleanupTasks?: Array<{ name: string; run: () => void | Promise<void> }>;
  timeoutMs?: number;
  onExit?: (exitCode: number) => void;
  bindProcessSignals?: boolean;
}

export function attachGracefulShutdown(options: GracefulShutdownOptions): {
  triggerShutdown: (signal: string) => Promise<number>;
  detachSignals: () => void;
} {
  const {
    server,
    lifecycle,
    cleanupTasks = [],
    timeoutMs = Math.max(1000, Number(process.env.SHUTDOWN_TIMEOUT_MS) || 10_000),
    onExit = (code) => process.exit(code),
    bindProcessSignals = true,
  } = options;

  let shutdownPromise: Promise<number> | null = null;

  const onRequest = (_req: http.IncomingMessage, res: http.ServerResponse) => {
    if (lifecycle.isDraining() && !res.headersSent) {
      res.setHeader("Connection", "close");
    }
    res.on("finish", () => {
      if (lifecycle.isDraining() && typeof server.closeIdleConnections === "function") {
        server.closeIdleConnections();
      }
    });
  };
  server.on("request", onRequest);

  const triggerShutdown = (signal: string): Promise<number> => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    lifecycle.markDraining(signal);
    logger.info(`Received ${signal}; starting graceful shutdown`, {
      module: "server-lifecycle",
      action: "graceful_shutdown_start",
      signal,
      timeoutMs,
    });

    shutdownPromise = new Promise<number>((resolve) => {
      let settled = false;
      const finish = (code: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(forceTimer);
        server.off("request", onRequest);
        resolve(code);
        onExit(code);
      };

      const forceTimer = setTimeout(() => {
        logger.warn(`Graceful shutdown exceeded ${timeoutMs}ms timeout; forcing exit`, {
          module: "server-lifecycle",
          action: "graceful_shutdown_timeout",
          signal,
        });
        if (typeof server.closeAllConnections === "function") {
          server.closeAllConnections();
        }
        finish(1);
      }, timeoutMs);
      if (typeof forceTimer.unref === "function") {
        forceTimer.unref();
      }

      const runCleanup = async (serverCloseErr?: Error) => {
        let hadError = Boolean(serverCloseErr);
        if (serverCloseErr) {
          logger.error("HTTP server close returned an error during shutdown", serverCloseErr, {
            module: "server-lifecycle",
            action: "http_close_error",
          });
        }

        for (const task of cleanupTasks) {
          try {
            await task.run();
          } catch (err) {
            hadError = true;
            logger.error(`Cleanup task '${task.name}' failed during shutdown`, err, {
              module: "server-lifecycle",
              action: "cleanup_task_error",
            });
          }
        }

        logger.info("Graceful shutdown completed", {
          module: "server-lifecycle",
          action: "graceful_shutdown_complete",
          signal,
          exitCode: hadError ? 1 : 0,
        });
        finish(hadError ? 1 : 0);
      };

      if (server.listening) {
        server.close((err) => {
          void runCleanup(err);
        });
        if (typeof server.closeIdleConnections === "function") {
          server.closeIdleConnections();
        }
      } else {
        void runCleanup();
      }
    });

    return shutdownPromise;
  };

  const onSigTerm = () => {
    void triggerShutdown("SIGTERM");
  };
  const onSigInt = () => {
    void triggerShutdown("SIGINT");
  };

  if (bindProcessSignals) {
    process.on("SIGTERM", onSigTerm);
    process.on("SIGINT", onSigInt);
  }

  const detachSignals = () => {
    server.off("request", onRequest);
    if (bindProcessSignals) {
      process.off("SIGTERM", onSigTerm);
      process.off("SIGINT", onSigInt);
    }
  };

  return { triggerShutdown, detachSignals };
}
