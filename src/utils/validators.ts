// src/utils/validators.ts

import { z } from "zod";

export const createPaymentQRSchema = z.object({
  order_id: z
    .string()
    .min(1, "order_id is required")
    .max(255, "order_id is too long"),
  amount: z
    .number()
    .positive("amount must be a positive number")
    .max(999_999_999_99, "amount exceeds maximum allowed value"),
});

export const confirmPaymentSchema = z.object({
  payment_id: z
    .string()
    .uuid("payment_id must be a valid UUID"),
});

export const paginationSchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreatePaymentQRInput = z.infer<typeof createPaymentQRSchema>;
export type ConfirmPaymentInput  = z.infer<typeof confirmPaymentSchema>;
