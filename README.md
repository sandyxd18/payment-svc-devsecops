# 💳 Payment Service

Production-ready payment microservice with dynamic QR simulation, built with **Bun**, **Express**, **PostgreSQL**, and **Prisma** — fully instrumented with metrics, logs, and distributed tracing via the Grafana observability stack.

> ⚠️ **DISCLAIMER:** This is a **SIMULATED** payment system. No real banking, QRIS, or financial transactions occur.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Bun |
| Framework | Express.js |
| Database | PostgreSQL + Prisma |
| Auth | JWT (shared secret with auth-service) |
| QR Generation | qrcode (PNG base64) |
| Inter-service | REST → order-service (validates orders) |
| Validation | Zod |
| Metrics | prom-client → Prometheus |
| Logs | Winston (JSON) → Alloy → Loki |
| Traces | OpenTelemetry → Alloy → Tempo |
| Visualization | Grafana |

---

## Project Structure

```
payment-service/
├── prisma/
│   └── schema.prisma              # payments table schema
├── src/
│   ├── config/
│   │   └── env.ts                 # Env var validation & typed access
│   ├── controllers/
│   │   └── payment.controller.ts  # HTTP layer — parse, validate, respond
│   ├── db/
│   │   └── prisma.ts              # Prisma client singleton
│   ├── middleware/
│   │   ├── auth.ts                # authenticateJWT + authorizeRole
│   │   ├── errorHandler.ts        # Global error handler
│   │   └── requestLogger.ts       # HTTP metrics + structured log
│   ├── observability/
│   │   ├── logger.ts              # Winston JSON logger (injects trace_id/span_id)
│   │   ├── metrics.ts             # prom-client registry + metric definitions
│   │   └── tracing.ts             # OpenTelemetry SDK (MUST be first import)
│   ├── routes/
│   │   └── payment.routes.ts      # Route definitions
│   ├── services/
│   │   ├── order.client.ts        # HTTP client → order-service
│   │   └── payment.service.ts     # Business logic (QR, payment lifecycle)
│   ├── utils/
│   │   ├── qr.ts                  # QR payload builder + image generator
│   │   ├── response.ts            # Standardized API response helpers
│   │   └── validators.ts          # Zod schemas
│   ├── app.ts                     # Express factory + /metrics endpoint
│   └── server.ts                  # Entry point (tracing imported first)
├── .dockerignore
├── .env.example
├── Dockerfile                     # Multi-stage production image
├── entrypoint.sh                  # DB schema sync → start server
└── package.json
```

---

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) >= 1.0
- PostgreSQL >= 14
- order-service running at `ORDER_SERVICE_URL`

### 1. Install

```bash
cd payment-service
bun install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

```env
DATABASE_URL="postgresql://postgres:yourpassword@localhost:5435/payment_db"
JWT_SECRET="same-secret-as-auth-service"
ORDER_SERVICE_URL="http://order-service:8000"
PORT=8000
NODE_ENV="production"
QR_EXPIRY_MINUTES=15

# Observability
SERVICE_NAME="payment-service"
SERVICE_VERSION="1.0.0"
OTEL_EXPORTER_OTLP_ENDPOINT="http://alloy:4317"
LOKI_HOST="http://loki:3100"
```

### 3. Setup Database

```bash
bun run db:generate
bun run db:push
```

### 4. Start

```bash
bun run dev     # hot reload
bun run start   # production
```

---

## API Reference

### Endpoint Summary

| Method | Endpoint | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/health` | — | — | Health check |
| GET | `/metrics` | — | — | Prometheus metrics scrape |
| POST | `/payments/qr` | ✅ JWT | any | Generate payment QR code |
| POST | `/payments/confirm` | ✅ JWT | any | Simulate payment confirmation |
| GET | `/payments` | ✅ JWT | admin | List all payments (paginated) |
| GET | `/payments/:id` | ✅ JWT | any | Check payment status |

---

### POST /payments/qr

Generate a dynamic QR code for an order payment. Validates order existence via order-service and checks ownership.

**Headers:** `Authorization: Bearer <token>`

**Request:**
```json
{
  "order_id": "order-uuid",
  "amount": 71980
}
```

**201 Created:**
```json
{
  "success": true,
  "message": "Payment QR generated successfully",
  "data": {
    "payment_id": "payment-uuid",
    "order_id": "order-uuid",
    "amount": 71980,
    "qr_image": "data:image/png;base64,iVBOR...",
    "expires_at": "2025-01-01T00:15:00.000Z",
    "status": "PENDING"
  }
}
```

**400 Bad Request (validation):**
```json
{ "success": false, "error": "Validation failed" }
```

**403 Forbidden (not order owner):**
```json
{ "success": false, "error": "You can only create payment for your own orders" }
```

**503 Service Unavailable (order-service down):**
```json
{ "success": false, "error": "Order service is temporarily unavailable" }
```

> **Idempotency:** If a PENDING payment already exists for the order and hasn't expired, the existing QR is returned instead of creating a duplicate.

---

### POST /payments/confirm

Simulate payment callback — confirms a pending payment and notifies order-service.

**Headers:** `Authorization: Bearer <token>`

**Request:**
```json
{
  "payment_id": "payment-uuid"
}
```

**200 OK:**
```json
{
  "success": true,
  "message": "Payment confirmed successfully",
  "data": {
    "payment_id": "payment-uuid",
    "order_id": "order-uuid",
    "status": "PAID",
    "message": "Payment confirmed successfully"
  }
}
```

**404 Not Found:**
```json
{ "success": false, "error": "Payment not found" }
```

**410 Gone (expired):**
```json
{ "success": false, "error": "Payment QR has expired. Please generate a new one." }
```

> **Idempotency:** Confirming an already-paid payment returns success without re-processing.

---

### GET /payments/:id

Get payment status. Auto-expires stale PENDING payments.

**Headers:** `Authorization: Bearer <token>`

**200 OK:**
```json
{
  "success": true,
  "data": {
    "payment_id": "payment-uuid",
    "order_id": "order-uuid",
    "amount": 71980,
    "status": "PENDING",
    "expires_at": "2025-01-01T00:15:00.000Z",
    "created_at": "2025-01-01T00:00:00.000Z"
  }
}
```

---

### GET /payments

List all payments (admin only) with pagination.

**Headers:** `Authorization: Bearer <admin-token>`

**Query params:** `page` (default: 1), `limit` (default: 20, max: 100)

```
GET /payments?page=1&limit=10
```

**200 OK:**
```json
{
  "success": true,
  "data": {
    "payments": [
      {
        "payment_id": "uuid",
        "order_id": "uuid",
        "amount": 71980,
        "status": "PAID",
        "expires_at": "2025-01-01T00:15:00.000Z",
        "created_at": "2025-01-01T00:00:00.000Z"
      }
    ],
    "pagination": {
      "total": 1,
      "page": 1,
      "limit": 10,
      "total_pages": 1
    }
  }
}
```

---

## Payment Flow

```
User                    Payment Service              Order Service
 │                           │                            │
 │  POST /payments/qr        │                            │
 │  {order_id, amount}       │                            │
 │──────────────────────────►│                            │
 │                           │  GET /orders/:id           │
 │                           │───────────────────────────►│
 │                           │  ◄── order data ───────────│
 │                           │                            │
 │                           │  [validate ownership]      │
 │                           │  [generate QR payload]     │
 │                           │  [save PENDING payment]    │
 │                           │                            │
 │  ◄── qr_image + expiry ──│                            │
 │                           │                            │
 │  POST /payments/confirm   │                            │
 │  {payment_id}             │                            │
 │──────────────────────────►│                            │
 │                           │  [check not expired]       │
 │                           │  [update status → PAID]    │
 │                           │                            │
 │                           │  PATCH /orders/:id/status  │
 │                           │  {status: "PAID"}          │
 │                           │───────────────────────────►│
 │                           │                            │
 │  ◄── payment confirmed ──│                            │
```

---

## Payment Status Lifecycle

```
PENDING ──► PAID      (via POST /payments/confirm)
PENDING ──► EXPIRED   (auto — when QR expiry time passes)
```

- QR codes expire after `QR_EXPIRY_MINUTES` (default: 15 minutes)
- Background task periodically auto-expires stale payments
- Expired payments cannot be confirmed (returns `410 Gone`)

---

## Example API Usage (curl)

```bash
BASE=http://localhost:3003

# 1. Login to get JWT token (via auth-service)
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Admin@1234!"}' \
  | jq -r '.data.token')

# 2. Generate payment QR
curl -X POST $BASE/payments/qr \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "order_id": "<order-uuid>",
    "amount": 71980
  }'

# 3. Confirm payment
curl -X POST $BASE/payments/confirm \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"payment_id": "<payment-uuid>"}'

# 4. Check payment status
curl -H "Authorization: Bearer $TOKEN" \
  $BASE/payments/<payment-uuid>

# 5. List all payments (admin)
curl -H "Authorization: Bearer $TOKEN" \
  "$BASE/payments?page=1&limit=10"

# Health check
curl $BASE/health
```

---

## 📊 Observability

### Architecture

```
┌──────────────────────────────────────────────────────────┐
│                 payment-service :3003                      │
│                                                            │
│  /metrics  ──────────────────────────► Prometheus          │
│  stdout (JSON logs) ─────► Alloy ───► Loki                │
│  OTLP traces (gRPC) ─────► Alloy ───► Tempo               │
└──────────────────────────────────────────────────────────┘
                                             │
                                             ▼
                                         Grafana :8000
                              (metrics + logs + traces correlated)
```

### Signal Pipeline

| Signal | Produced by | Collector | Storage |
|---|---|---|---|
| **Metrics** | `prom-client` → `/metrics` | Prometheus scrape | Prometheus TSDB |
| **Logs** | `Winston` JSON → stdout | Alloy Docker scrape | Loki |
| **Traces** | `OpenTelemetry` → OTLP/gRPC | Alloy OTLP receiver | Tempo |

### Prometheus Metrics

| Metric | Type | Labels | Description |
|---|---|---|---|
| `http_requests_total` | Counter | `method`, `route`, `status_code` | Total HTTP requests |
| `http_request_duration_seconds` | Histogram | `method`, `route`, `status_code` | Request latency |
| `http_requests_in_flight` | Gauge | `method`, `route` | Active requests |
| `payment_requests_total` | Counter | `operation`, `status` | Payment operations (create_qr/confirm/check) |
| `payment_success_total` | Counter | — | Successful payment confirmations |
| `payment_failure_total` | Counter | `reason` | Failed payments (expired/not_found/etc.) |
| `request_duration_seconds` | Histogram | `operation` | Payment operation latency |
| `payment_amount_rupiah` | Histogram | — | Payment amount distribution (IDR) |
| `order_service_requests_total` | Counter | `method`, `status`, `status_code` | Outgoing calls to order-service |
| `order_service_request_duration_seconds` | Histogram | `method` | Order-service call latency |

---

## Scripts

| Command | Description |
|---|---|
| `bun run dev` | Start with hot reload |
| `bun run start` | Start production |
| `bun run db:generate` | Generate Prisma client |
| `bun run db:push` | Sync schema to DB |
| `bun run db:migrate` | Create migration files (dev) |
| `bun run db:migrate:prod` | Run existing migrations (prod) |
| `bun run db:studio` | Open Prisma Studio |

---

## Security Notes

- JWT validated locally using shared `JWT_SECRET` — no runtime call to auth-service
- Ownership check — users can only create payments for their own orders
- Input validated with Zod before any DB or service call
- Prisma ORM prevents SQL injection
- QR payload uses base64-encoded JSON — no executable content
- Expired payments cannot be confirmed (prevents replay attacks)
- Idempotent operations — duplicate requests return existing data safely
- Non-root container user (UID 1001) in Docker
- `x-powered-by` header disabled
