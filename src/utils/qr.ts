// src/utils/qr.ts
// Dynamic QR code generation for simulated QRIS payments.
//
// ⚠️ DISCLAIMER: This is NOT a real payment system.
// No real banking or QRIS integration. QR code is a simulation
// for demo, learning, and academic use only.

import QRCode from "qrcode";

export interface QRPayload {
  merchant:   string;
  order_id:   string;
  amount:     number;
  currency:   string;
  timestamp:  string;
  payment_id: string;
}

/**
 * Build a QRIS-like payload (simulation).
 * Encodes the payload as JSON → base64.
 */
export function buildQRPayload(
  orderId:   string,
  amount:    number,
  paymentId: string
): { payload: string; raw: QRPayload } {
  const raw: QRPayload = {
    merchant:   "BookStore Demo",
    order_id:   orderId,
    amount,
    currency:   "IDR",
    timestamp:  new Date().toISOString(),
    payment_id: paymentId,
  };

  // Encode as base64 — this is the "scannable" content
  const payload = Buffer.from(JSON.stringify(raw)).toString("base64");
  return { payload, raw };
}

/**
 * Generate a QR code image as a base64-encoded PNG data URI.
 */
export async function generateQRImage(payload: string): Promise<string> {
  const dataUrl = await QRCode.toDataURL(payload, {
    errorCorrectionLevel: "M",
    type:   "image/png",
    width:  400,
    margin: 2,
    color: {
      dark:  "#000000",
      light: "#FFFFFF",
    },
  });

  return dataUrl;
}

/**
 * Generate a QR code image as SVG string.
 */
export async function generateQRImageSVG(payload: string): Promise<string> {
  return QRCode.toString(payload, {
    type:                 "svg",
    errorCorrectionLevel: "M",
    width:                400,
    margin:               2,
  });
}
