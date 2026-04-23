// src/services/order.client.ts
// HTTP client for inter-service communication with order-service.
// Instruments calls with Prometheus metrics and structured logging.
//
// Endpoints consumed:
//   GET   /orders/:id        — validate order exists and belongs to user
//   PATCH /orders/:id/status — update order status after payment confirmation

import { env } from "../config/env";
import logger from "../observability/logger";
import {
  orderServiceRequestsTotal,
  orderServiceRequestDurationSeconds,
} from "../observability/metrics";

const BASE_URL = env.ORDER_SERVICE_URL;

async function fetchWithMetrics(
  method: string,
  path: string,
  options?: RequestInit
): Promise<Response> {
  const url   = `${BASE_URL}${path}`;
  const start = performance.now();

  try {
    const res = await fetch(url, {
      ...options,
      method,
      headers: {
        "Content-Type": "application/json",
        ...(options?.headers ?? {}),
      },
    });

    const durationSec = (performance.now() - start) / 1000;
    const statusCode  = String(res.status);
    const status      = res.ok ? "success" : "failure";

    orderServiceRequestsTotal.inc({ method, status, status_code: statusCode });
    orderServiceRequestDurationSeconds.observe({ method }, durationSec);

    logger.info("order_service_call", {
      method,
      url,
      status_code: res.status,
      duration_ms: Math.round(durationSec * 1000),
    });

    return res;
  } catch (err) {
    const durationSec = (performance.now() - start) / 1000;
    orderServiceRequestsTotal.inc({ method, status: "failure", status_code: "0" });
    orderServiceRequestDurationSeconds.observe({ method }, durationSec);

    logger.error("order_service_call_failed", {
      method,
      url,
      error: (err as Error).message,
      duration_ms: Math.round(durationSec * 1000),
    });

    throw new OrderServiceUnavailableError(
      "Order service is temporarily unavailable. Please try again."
    );
  }
}

export interface OrderData {
  id:          string;
  user_id:     string;
  total_price: number;
  status:      string;
}

export const OrderClient = {
  /**
   * getOrder
   * Fetches order details from order-service.
   * Validates that the order exists.
   */
  async getOrder(orderId: string, authToken?: string): Promise<OrderData> {
    const headers: Record<string, string> = {};
    if (authToken) {
      headers["Authorization"] = `Bearer ${authToken}`;
    }

    const res = await fetchWithMetrics("GET", `/orders/${orderId}`, { headers });

    if (res.status === 404) {
      throw new OrderNotFoundError(`Order ${orderId} not found`);
    }

    if (!res.ok) {
      const body = await res.text();
      throw new OrderServiceError(`Order service returned ${res.status}: ${body}`);
    }

    const json = await res.json() as any;
    // order-service wraps in { success: true, data: ... }
    const order = json.data ?? json;

    return {
      id:          order.id,
      user_id:     order.user_id,
      total_price: parseFloat(order.total_price),
      status:      order.status,
    };
  },

  /**
   * updateOrderStatus
   * Notifies order-service to update the order status after payment.
   * Uses internal service-to-service secret (not JWT) for /internal-status endpoint.
   */
  async updateOrderStatus(
    orderId: string,
    status: string,
    _authToken?: string // kept for signature compatibility, not used anymore
  ): Promise<void> {
    // Use internal /internal-status endpoint with x-internal-secret header
    const headers: Record<string, string> = {
      "x-internal-secret": env.INTERNAL_SERVICE_SECRET,
    };

    const res = await fetchWithMetrics("PATCH", `/orders/${orderId}/internal-status`, {
      headers,
      body: JSON.stringify({ status }),
    });

    if (!res.ok) {
      const body = await res.text();
      logger.warn("order_status_update_failed", {
        order_id:    orderId,
        status,
        http_status: res.status,
        response:    body,
      });
      // Non-critical — payment was already confirmed; log but don't throw
    } else {
      logger.info("order_status_updated", { order_id: orderId, status });
    }
  },
};

// ── Custom Errors ─────────────────────────────────────────────────────────────

export class OrderNotFoundError extends Error {
  constructor(m: string) { super(m); this.name = "OrderNotFoundError"; }
}
export class OrderServiceUnavailableError extends Error {
  constructor(m: string) { super(m); this.name = "OrderServiceUnavailableError"; }
}
export class OrderServiceError extends Error {
  constructor(m: string) { super(m); this.name = "OrderServiceError"; }
}
