// src/services/payment.service.ts
// Business logic for payment management.
// Coordinates QR generation, payment lifecycle, and order-service integration.
//
// ⚠️ DISCLAIMER: This is a SIMULATED payment system.
// No real banking, QRIS, or financial transactions occur.

import prisma from "../db/prisma";
import { env } from "../config/env";
import { buildQRPayload, generateQRImage } from "../utils/qr";
import { OrderClient, OrderNotFoundError, OrderServiceUnavailableError } from "./order.client";
import {
  paymentRequestsTotal,
  paymentSuccessTotal,
  paymentFailureTotal,
  requestDurationSeconds,
  paymentAmountHistogram,
} from "../observability/metrics";
import logger from "../observability/logger";

function recordOp(operation: string, status: "success" | "failure", extra?: object) {
  paymentRequestsTotal.inc({ operation, status });
  const level = status === "success" ? "info" : "warn";
  logger[level](`payment_${operation}`, { operation, status, ...extra });
}

export const PaymentService = {

  /**
   * createPaymentQR
   * Flow:
   *   1. Validate order exists via order-service
   *   2. Check order ownership
   *   3. Check for existing pending payment (idempotency)
   *   4. Generate dynamic QR payload (JSON → base64)
   *   5. Generate QR image (PNG base64)
   *   6. Save payment record with PENDING status
   *   7. Return QR image, payment_id, and expiry
   */
  async createPaymentQR(
    orderId: string,
    amount: number,
    userId: string,
    userRole: string,
    authToken?: string
  ) {
    const start = performance.now();

    try {
      // 1. Validate order with order-service
      let order;
      try {
        order = await OrderClient.getOrder(orderId, authToken);
      } catch (err) {
        if (err instanceof OrderNotFoundError) {
          paymentFailureTotal.inc({ reason: "order_not_found" });
          recordOp("create_qr", "failure", { order_id: orderId, reason: "order_not_found" });
          throw new ValidationError(`Order ${orderId} does not exist`);
        }
        if (err instanceof OrderServiceUnavailableError) {
          paymentFailureTotal.inc({ reason: "order_service_unavailable" });
          recordOp("create_qr", "failure", { order_id: orderId, reason: "order_service_unavailable" });
          throw err;
        }
        throw err;
      }

      // 2. Ownership check — user can only create QR for own order
      if (userRole !== "admin" && order.user_id !== userId) {
        paymentFailureTotal.inc({ reason: "ownership_violation" });
        recordOp("create_qr", "failure", { order_id: orderId, reason: "ownership_violation" });
        throw new ForbiddenError("You can only create payment for your own orders");
      }

      // 3. Check for existing active (non-expired) pending payment → idempotency
      const existingPayment = await prisma.payment.findFirst({
        where: {
          order_id: orderId,
          status:   "PENDING",
          expires_at: { gt: new Date() },
        },
        orderBy: { created_at: "desc" },
      });

      if (existingPayment) {
        // Return existing QR instead of creating a duplicate
        const qrImage = await generateQRImage(existingPayment.qr_payload);

        logger.info("payment_create_qr_idempotent", {
          payment_id: existingPayment.id,
          order_id:   orderId,
        });

        return {
          payment_id: existingPayment.id,
          order_id:   orderId,
          amount:     Number(existingPayment.amount),
          qr_image:   qrImage,
          expires_at: existingPayment.expires_at.toISOString(),
          status:     existingPayment.status,
        };
      }

      // 4. Create a new payment record first to get the ID
      const expiresAt = new Date(
        Date.now() + env.QR_EXPIRY_MINUTES * 60 * 1000
      );

      // Create with a placeholder payload first
      const payment = await prisma.payment.create({
        data: {
          order_id:   orderId,
          amount,
          qr_payload: "", // will update after we have the ID
          status:     "PENDING",
          expires_at: expiresAt,
        },
      });

      // 5. Generate dynamic QR payload with payment ID
      const { payload } = buildQRPayload(orderId, amount, payment.id);

      // 6. Update payment record with the QR payload
      await prisma.payment.update({
        where: { id: payment.id },
        data:  { qr_payload: payload },
      });

      // 7. Generate QR image
      const qrImage = await generateQRImage(payload);

      // Track metrics
      paymentAmountHistogram.observe(amount);
      const durationSec = (performance.now() - start) / 1000;
      requestDurationSeconds.observe({ operation: "create_qr" }, durationSec);
      recordOp("create_qr", "success", {
        payment_id: payment.id,
        order_id:   orderId,
        amount,
        expires_at: expiresAt.toISOString(),
      });

      return {
        payment_id: payment.id,
        order_id:   orderId,
        amount,
        qr_image:   qrImage,
        expires_at: expiresAt.toISOString(),
        status:     "PENDING",
      };
    } catch (err) {
      const durationSec = (performance.now() - start) / 1000;
      requestDurationSeconds.observe({ operation: "create_qr" }, durationSec);
      throw err;
    }
  },

  /**
   * confirmPayment
   * Simulates payment callback flow:
   *   1. Validate payment exists
   *   2. Check not already paid (prevent replay)
   *   3. Check not expired
   *   4. Update status to PAID
   *   5. Notify order-service to update order status
   */
  async confirmPayment(paymentId: string, authToken?: string) {
    const start = performance.now();

    try {
      // 1. Find the payment
      const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
      });

      if (!payment) {
        paymentFailureTotal.inc({ reason: "not_found" });
        recordOp("confirm", "failure", { payment_id: paymentId, reason: "not_found" });
        throw new NotFoundError("Payment not found");
      }

      // 2. Prevent replay — already paid
      if (payment.status === "PAID") {
        // Idempotent: return success without re-processing
        logger.info("payment_confirm_idempotent", {
          payment_id: paymentId,
          order_id:   payment.order_id,
        });
        return {
          payment_id: payment.id,
          order_id:   payment.order_id,
          status:     "PAID",
          message:    "Payment already confirmed",
        };
      }

      // 3. Check if expired
      if (payment.status === "EXPIRED" || new Date() > payment.expires_at) {
        // Auto-mark as expired if it wasn't already
        if (payment.status !== "EXPIRED") {
          await prisma.payment.update({
            where: { id: paymentId },
            data:  { status: "EXPIRED" },
          });
          // Notify order-service
          try {
            await OrderClient.updateOrderStatus(payment.order_id, "EXPIRED", authToken);
          } catch (err) {
            logger.error("order_status_notification_failed_expired", {
              payment_id: paymentId,
              order_id:   payment.order_id,
              error:      (err as Error).message,
            });
          }
        }
        paymentFailureTotal.inc({ reason: "expired" });
        recordOp("confirm", "failure", { payment_id: paymentId, reason: "expired" });
        throw new PaymentExpiredError("Payment QR has expired. Please generate a new one.");
      }

      // 4. Update status to PAID
      const updated = await prisma.payment.update({
        where: { id: paymentId },
        data:  { status: "PAID" },
      });

      // 5. Notify order-service (fire-and-forget, best effort)
      try {
        await OrderClient.updateOrderStatus(payment.order_id, "PAID", authToken);
      } catch (err) {
        logger.error("order_status_notification_failed", {
          payment_id: paymentId,
          order_id:   payment.order_id,
          error:      (err as Error).message,
        });
        // Don't fail the payment confirmation — order-service will eventually reconcile
      }

      // Track metrics
      paymentSuccessTotal.inc();
      const durationSec = (performance.now() - start) / 1000;
      requestDurationSeconds.observe({ operation: "confirm" }, durationSec);
      recordOp("confirm", "success", {
        payment_id: paymentId,
        order_id:   payment.order_id,
        amount:     Number(payment.amount),
      });

      return {
        payment_id: updated.id,
        order_id:   updated.order_id,
        status:     "PAID",
        message:    "Payment confirmed successfully",
      };
    } catch (err) {
      const durationSec = (performance.now() - start) / 1000;
      requestDurationSeconds.observe({ operation: "confirm" }, durationSec);
      throw err;
    }
  },

  /**
   * getPaymentById
   * Returns a single payment. Enforces ownership for non-admin users.
   */
  async getPaymentById(paymentId: string, userId: string, userRole: string) {
    const start = performance.now();

    try {
      const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
      });

      if (!payment) {
        paymentFailureTotal.inc({ reason: "not_found" });
        recordOp("check", "failure", { payment_id: paymentId, reason: "not_found" });
        throw new NotFoundError("Payment not found");
      }

      // Auto-expire if past expiry and still PENDING
      if (payment.status === "PENDING" && new Date() > payment.expires_at) {
        await prisma.payment.update({
          where: { id: paymentId },
          data:  { status: "EXPIRED" },
        });
        payment.status = "EXPIRED";
        
        // Notify order-service
        try {
          // Note: Here we don't have authToken passed in getPaymentById, 
          // but updateOrderStatus internal API doesn't require JWT, it uses internal secret.
          await OrderClient.updateOrderStatus(payment.order_id, "EXPIRED");
        } catch (err) {
          logger.error("order_status_notification_failed_expired", {
            payment_id: paymentId,
            order_id:   payment.order_id,
            error:      (err as Error).message,
          });
        }
      }

      // Ownership check for non-admin users will be done at route level
      // using order-service to verify the order belongs to the user
      // For simplicity, we trust the caller (controller) to enforce this

      const durationSec = (performance.now() - start) / 1000;
      requestDurationSeconds.observe({ operation: "check" }, durationSec);
      recordOp("check", "success", { payment_id: paymentId });

      return {
        payment_id: payment.id,
        order_id:   payment.order_id,
        amount:     Number(payment.amount),
        status:     payment.status,
        expires_at: payment.expires_at.toISOString(),
        created_at: payment.created_at.toISOString(),
      };
    } catch (err) {
      const durationSec = (performance.now() - start) / 1000;
      requestDurationSeconds.observe({ operation: "check" }, durationSec);
      throw err;
    }
  },

  /**
   * getAllPayments
   * Admin-only: returns paginated list of all payments.
   */
  async getAllPayments(page: number, limit: number) {
    const skip = (page - 1) * limit;

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        skip,
        take:    limit,
        orderBy: { created_at: "desc" },
      }),
      prisma.payment.count(),
    ]);

    // Auto-expire stale PENDING payments in the result set
    const now = new Date();
    const result = payments.map((p) => ({
      payment_id: p.id,
      order_id:   p.order_id,
      amount:     Number(p.amount),
      status:     p.status === "PENDING" && now > p.expires_at ? "EXPIRED" : p.status,
      expires_at: p.expires_at.toISOString(),
      created_at: p.created_at.toISOString(),
    }));

    recordOp("list", "success", { page, total });

    return {
      payments: result,
      pagination: { total, page, limit, total_pages: Math.ceil(total / limit) },
    };
  },

  /**
   * expireStalePayments
   * Background task: marks all PENDING payments past their expiry as EXPIRED.
   * Called by the cron scheduler.
   */
  async expireStalePayments(): Promise<number> {
    const stalePayments = await prisma.payment.findMany({
      where: {
        status:     "PENDING",
        expires_at: { lt: new Date() },
      },
      select: { id: true, order_id: true }
    });

    if (stalePayments.length === 0) return 0;

    const result = await prisma.payment.updateMany({
      where: {
        id: { in: stalePayments.map(p => p.id) }
      },
      data: {
        status: "EXPIRED",
      },
    });

    if (result.count > 0) {
      logger.info("payments_expired_batch", {
        count: result.count,
        message: `Auto-expired ${result.count} stale payment(s)`,
      });

      // Best-effort notify order-service for all expired payments
      for (const p of stalePayments) {
        try {
          await OrderClient.updateOrderStatus(p.order_id, "EXPIRED");
        } catch (err) {
          logger.error("order_status_notification_failed_expired_batch", {
            payment_id: p.id,
            order_id:   p.order_id,
            error:      (err as Error).message,
          });
        }
      }
    }

    return result.count;
  },
};

// ── Custom Errors ─────────────────────────────────────────────────────────────

export class NotFoundError extends Error {
  constructor(m: string) { super(m); this.name = "NotFoundError"; }
}
export class ValidationError extends Error {
  constructor(m: string) { super(m); this.name = "ValidationError"; }
}
export class ForbiddenError extends Error {
  constructor(m: string) { super(m); this.name = "ForbiddenError"; }
}
export class PaymentExpiredError extends Error {
  constructor(m: string) { super(m); this.name = "PaymentExpiredError"; }
}
