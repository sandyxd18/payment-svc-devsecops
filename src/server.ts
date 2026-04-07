// src/server.ts
// IMPORTANT: tracing MUST be the very first import so OTel patches
// Express, Prisma, and fetch before any of them are loaded.

import "./observability/tracing";
import "./config/env";
import { env } from "./config/env";
import { createApp } from "./app";
import prisma from "./db/prisma";
import logger from "./observability/logger";
import { startExpiryScheduler, stopExpiryScheduler } from "./services/scheduler";

const app = createApp();

async function startServer() {
  try {
    await prisma.$connect();
    logger.info("db_connected", { message: "Connected to PostgreSQL via Prisma" });

    // Start background payment expiry scheduler
    startExpiryScheduler();

    app.listen(env.PORT, () => {
      logger.info("server_started", {
        message:       "Payment service started",
        port:          env.PORT,
        env:           env.NODE_ENV,
        health:        `http://localhost:${env.PORT}/health`,
        metrics:       `http://localhost:${env.PORT}/metrics`,
        order_service: env.ORDER_SERVICE_URL,
        disclaimer:    "⚠️ SIMULATED payment system — NOT for production financial use",
      });
    });
  } catch (err) {
    logger.error("server_start_failed", { error: (err as Error).message });
    await prisma.$disconnect();
    process.exit(1);
  }
}

async function shutdown(signal: string) {
  logger.info("server_shutdown", { signal });
  stopExpiryScheduler();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

startServer();
