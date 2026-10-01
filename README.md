# Seat Reservation at Scale — Paytm Money Backend Engineering Assignment

A production-grade, highly concurrent backend service built with **NestJS**, **Prisma ORM**, and **PostgreSQL** that sells assigned seats for an event and handles high-load on-sale stampedes with zero double-selling and zero 5xx server errors.

---

## 🚀 Live URL
* **Deployed Service:** [YOUR_RAILWAY_URL_HERE](seat-reservation-api-production.up.railway.app)
* **Metrics Endpoint:** `/metrics` (Prometheus format)
* **Health Check:** `/shows/{id}`

---

## 🛠️ Architecture & Correctness Guarantees
1. **Atomic Locking:** Uses PostgreSQL row-level locks (`SELECT ... FOR UPDATE`) inside a serializable/read-committed transaction to guarantee that a hot seat (e.g., `A12`) is never double-booked.
2. **Deadlock Prevention:** Multi-seat reservation requests sort requested seat identifiers alphabetically/numerically before acquiring locks to eliminate circular wait conditions.
3. **Idempotency:** Enforced via a unique database constraint on the `idempotency_key` column, ensuring retries return the original reservation payload and conflicting bodies fail with a clean `409 Conflict`.
4. **Reconciliation Invariant:** Maintains the strict inventory rule at all times:
   $$\text{available} + \text{held} + \text{confirmed} = \text{total\_seats}$$

---

## 📦 Local Development & Running

### 1. Prerequisites
* Node.js (v18+)
* PostgreSQL Database (Local or Cloud like Neon/Supabase)

### 2. Environment Setup
Create a `.env` file in the root directory:
```env
DATABASE_URL="postgresql://user:password@host:5432/dbname?sslmode=require"
PORT=3000