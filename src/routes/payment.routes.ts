// src/routes/payment.routes.ts

import { Router } from "express";
import { PaymentController } from "../controllers/payment.controller";
import { authenticateJWT, authorizeRole } from "../middleware/auth";

const router = Router();

// ── All payment routes require authentication ─────────────────────────────────

/**
 * POST /payments/qr
 * Generate a payment QR code — any authenticated user (for own orders)
 */
router.post("/qr", authenticateJWT, PaymentController.createQR);

/**
 * POST /payments/confirm
 * Simulate payment callback — any authenticated user
 */
router.post("/confirm", authenticateJWT, PaymentController.confirmPayment);

/**
 * GET /payments
 * List all payments — admin only
 */
router.get("/", authenticateJWT, authorizeRole("admin"), PaymentController.listPayments);

/**
 * GET /payments/:id
 * Check payment status — any authenticated user
 */
router.get("/:id", authenticateJWT, PaymentController.getPayment);

export default router;
