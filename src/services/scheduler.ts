// src/services/scheduler.ts
// Background task scheduler for auto-expiring stale payments.
// Runs every 60 seconds to mark PENDING payments past their expiry as EXPIRED.

import { PaymentService } from "./payment.service";
import logger from "../observability/logger";

let intervalId: ReturnType<typeof setInterval> | null = null;

const INTERVAL_MS = 60_000; // 1 minute

export function startExpiryScheduler(): void {
  logger.info("scheduler_started", {
    message:  "Payment expiry scheduler started",
    interval: `${INTERVAL_MS / 1000}s`,
  });

  // Run immediately on startup
  runExpiryCheck();

  // Then run periodically
  intervalId = setInterval(runExpiryCheck, INTERVAL_MS);
}

export function stopExpiryScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info("scheduler_stopped", { message: "Payment expiry scheduler stopped" });
  }
}

async function runExpiryCheck(): Promise<void> {
  try {
    const count = await PaymentService.expireStalePayments();
    if (count > 0) {
      logger.info("expiry_check_completed", { expired_count: count });
    }
  } catch (err) {
    logger.error("expiry_check_failed", {
      error: (err as Error).message,
      stack: (err as Error).stack,
    });
  }
}
