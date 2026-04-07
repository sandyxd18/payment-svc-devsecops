// src/controllers/payment.controller.ts
// HTTP request handlers for payment endpoints.
// Delegates business logic to PaymentService.

import type { Request, Response, NextFunction } from "express";
import { PaymentService, NotFoundError, ValidationError, ForbiddenError, PaymentExpiredError } from "../services/payment.service";
import { OrderServiceUnavailableError } from "../services/order.client";
import { createPaymentQRSchema, confirmPaymentSchema, paginationSchema } from "../utils/validators";
import { sendSuccess, sendError } from "../utils/response";
import logger from "../observability/logger";

export const PaymentController = {

  /**
   * POST /payments/qr
   * Create a payment QR code for an order.
   */
  async createQR(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = createPaymentQRSchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(res, "Validation failed", 400, parsed.error.flatten());
        return;
      }

      const { order_id, amount } = parsed.data;
      const authToken = req.headers.authorization?.split(" ")[1];

      const result = await PaymentService.createPaymentQR(
        order_id,
        amount,
        req.user!.sub,
        req.user!.role,
        authToken
      );

      logger.info("payment_qr_created", {
        payment_id: result.payment_id,
        order_id,
        user_id: req.user!.sub,
      });

      sendSuccess(res, result, "Payment QR generated successfully", 201);
    } catch (err) {
      handleServiceError(err, res, next);
    }
  },

  /**
   * POST /payments/confirm
   * Simulate payment callback — confirm payment.
   */
  async confirmPayment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = confirmPaymentSchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(res, "Validation failed", 400, parsed.error.flatten());
        return;
      }

      const { payment_id } = parsed.data;
      const authToken = req.headers.authorization?.split(" ")[1];

      const result = await PaymentService.confirmPayment(payment_id, authToken);

      logger.info("payment_confirmed", {
        payment_id,
        order_id: result.order_id,
        user_id:  req.user!.sub,
      });

      sendSuccess(res, result, "Payment confirmed successfully");
    } catch (err) {
      handleServiceError(err, res, next);
    }
  },

  /**
   * GET /payments/:id
   * Check payment status.
   */
  async getPayment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const paymentId = req.params.id;

      if (!paymentId) {
        sendError(res, "Payment ID is required", 400);
        return;
      }

      const result = await PaymentService.getPaymentById(
        paymentId,
        req.user!.sub,
        req.user!.role
      );

      sendSuccess(res, result);
    } catch (err) {
      handleServiceError(err, res, next);
    }
  },

  /**
   * GET /payments
   * List all payments — admin only.
   */
  async listPayments(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = paginationSchema.safeParse(req.query);
      if (!parsed.success) {
        sendError(res, "Invalid pagination parameters", 400, parsed.error.flatten());
        return;
      }

      const { page, limit } = parsed.data;
      const result = await PaymentService.getAllPayments(page, limit);

      sendSuccess(res, result);
    } catch (err) {
      handleServiceError(err, res, next);
    }
  },
};

// ── Error mapping ─────────────────────────────────────────────────────────────

function handleServiceError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof ValidationError) {
    sendError(res, err.message, 400);
  } else if (err instanceof NotFoundError) {
    sendError(res, err.message, 404);
  } else if (err instanceof ForbiddenError) {
    sendError(res, err.message, 403);
  } else if (err instanceof PaymentExpiredError) {
    sendError(res, err.message, 410);  // 410 Gone
  } else if (err instanceof OrderServiceUnavailableError) {
    sendError(res, err.message, 503);
  } else {
    next(err);
  }
}
