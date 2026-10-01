# Take-Home Exercise Write-Up: Seat Reservation at Scale
**Backend Engineering · Paytm Money**

---

## 1. The Atomic Decision & Concurrency Control
* **Exact Mechanism:** The core atomic decision is executed inside a PostgreSQL database transaction using row-level locking via `SELECT ... FOR UPDATE` combined with a raw SQL query (`$queryRaw`). 
* **Race-Free Guarantee:** When hundreds of users simultaneously attempt to reserve the same hot seat (e.g., `A12`), PostgreSQL serializes access at the row level. Only the first transaction acquires the lock; the remaining transactions block until the first commits or rolls back, at which point they read the updated status (`confirmed`) and cleanly fail with a `409 Conflict` rather than a 5xx error.
* **Deadlock Avoidance (Multi-Seat Requests):** To prevent deadlocks when users request multi-seat blocks (e.g., User A wants `[A1, A2]` and User B wants `[A2, A3]`), all requested seat identifiers are **sorted alphabetically/numerically** before executing the lock query. Locking rows in a strict, deterministic global order eliminates circular wait conditions.

## 2. Idempotency & Exactly-Once Enforcement
* **Storage & Enforcement:** Idempotency keys are stored in a dedicated `Reservation` table with a **unique database constraint** on the `idempotency_key` column. 
* **Request Flow:** When a request arrives, the service first checks or attempts an insertion tied to this key. If a duplicate key is submitted with the **exact same body payload** (same seats), it gracefully returns the original reservation record (201 equivalent). If the same key is reused with a **different body payload** (different seats), it rejects it with a `409 Conflict` to prevent request tampering or client-side bugs.

## 3. Holds & Expiry Model
* **Model Chosen:** For this implementation, we opted for an immediate-confirmation model combined with per-user limits (capped at 4 seats per show) to tightly control inventory. 
* **State Reconciliation:** The system maintains an invariant queryable via `GET /shows/{id}` where `available + held + confirmed == total_seats` holds true at every microsecond, verified during and after high-concurrency bursts.

## 4. Consistency vs. Availability Under a Partition
* **CP over AP:** Under a network partition or heavy traffic spike, this system chooses **Consistency (CP)** from the CAP theorem. 
* **Rationale:** In financial and ticketing domains, over-selling an asset (double-booking a seat) is a fatal business error. It is vastly preferable for the system to temporarily reject requests or return a `409 Conflict` than to compromise inventory accuracy and sell the same physical seat to two different customers.

## 5. Observability & 2:00 AM Paging
* **Metrics Exposed:** Prometheus-style metrics are exposed via `@willsoto/nestjs-prometheus` at the `/metrics` endpoint, tracking:
  * Reservation counters (`reservations_confirmed_total`, `reservations_declined_total` labeled by reason).
  * Inventory gauges (`seats_available`, `seats_confirmed`).
* **2:00 AM Paging Alerts:** If I were paged at 2 AM, the critical alerts configured would be:
  1. **Spike in 5xx errors:** Indicates database connection drops or unhandled connection pool exhaustion.
  2. **Reconciliation Invariant Breach:** If `available + held + confirmed != total_seats`, indicating data corruption or unhandled race conditions.
  3. **Database Latency / Connection Pool Saturation:** High query wait times during hot-seat on-sale events.

## 6. AI Usage: Directed vs. Decided
* **What AI Did (Directed):** AI tools were used as a force multiplier to rapidly scaffold project boilerplate, format Prometheus metrics setup, write the Dockerfile, and generate the concurrency load-testing script (`burst.js`).
* **What I Did (Decided):** All architectural decisions—such as opting for PostgreSQL row locks (`FOR UPDATE`) over distributed Redis locks, implementing deterministic sorting to prevent deadlocks, defining the idempotency validation rules, and enforcing strict CP guarantees—were human-decided and thoroughly tested.

## 7. What I'd Do Next (If Given More Time)
1. **Explicit Time-Boxed Holds:** Implement a background worker (using Redis BullMQ or cron) to auto-expire uncompleted "held" seats back to `available` after 10 minutes.
2. **Read Replicas & Caching:** Offload `GET /shows/{id}` read traffic to database read replicas to keep the primary transactional database entirely free for write locks during on-sale stampedes.
3. **Distributed Rate Limiting:** Add token-bucket rate limiting at the API gateway layer to mitigate bot-driven DDoS attacks during high-profile ticket launches.