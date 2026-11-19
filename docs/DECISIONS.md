# Beacon — Decisions

Part A: Architecture Decision Records (technical; owned by engineering).
Part B: Business rules register: every ASSUMPTION awaiting stakeholder confirmation.
Status: **Accepted** = in force · **Proposed** = needs the lead's approval (touches infra / bin / IAM).

---

## Part A: ADRs

### ADR-001 Service decomposition: five domain Lambdas, nested resources under their parent
- **Context:** Terraform creates one Lambda per `backend/<folder>` and a CloudFront route `/api/<folder>*` (prefix
  match). Nested paths such as `/api/projects/{id}/milestones` reach the `projects` Lambda. Every service adds a cold
  start, and the first request after Aurora's auto-pause took 15.8 s.
- **Decision:** five services by domain: `auth`, `users`, `projects` (incl. milestones, tasks, allocations,
  spend, status updates, health, project audit), `people`, `portfolio` (dashboard, attention queue, global audit,
  health rules, lookups).
- **Alternatives:** one Lambda per resource (≈10 cold starts, more sharing friction); one monolithic Lambda
  (simplest, but ignores the workshop's service model and makes RBAC and ownership less legible per domain).
- **Consequences:** most traffic hits `projects`. The router must normalise the cloud path (`/api/projects/1/x`)
  and the local path (`/1/x`, proxy strips the prefix).

### ADR-002 Sharing code: canonical `backend/_shared/beacon`, synced into each service (Proposed)
- **Context:** the Lambda packager zips only the service folder. It copies `requirements.txt` to a temp dir before
  `pip install`, so relative local-path requirements break. LocalStack hot-reload mounts the service folder, so
  symlinks to outside it would not resolve in the container (inferred; cloud packaging does follow symlinks).
- **Decision:** the single source of truth is `backend/_shared/beacon/` (underscore → never deployed itself).
  A new `bin/sync-shared.sh` copies it into `backend/<svc>/beacon/` (gitignored), and `bin/deploy.sh`
  runs sync and then the unchanged workshop scripts. Tests import the canonical copy. A test fails if any synced
  copy drifts.
- **Alternatives:** committed vendored copies plus a drift test (looks like copy-paste); a published wheel (no index
  reachable); a single Lambda (see ADR-001).
- **Consequences:** one extra step before deploy and start-dev, wrapped in one script. **Needs approval: new files in `bin/`.**

### ADR-003 Migrations on cold start; seeding by direct IAM invoke
- **Context:** the VDI cannot reach Aurora (SG self-reference only), so all DB work must run inside a Lambda.
  Direct `aws lambda invoke` works from the VDI.
- **Decision:** numbered SQL migrations in the shared library, applied on cold start under `pg_advisory_lock`,
  recorded in `schema_migrations` (idempotent and ordered). Seeding runs from a non-HTTP event
  `{"action":"seed"}` on the `users` Lambda. It is invocable only with IAM credentials, never through CloudFront,
  and is idempotent (keyed on a `seed_version` row).
- **Alternatives:** an Admin-only HTTP seed endpoint (adds attack surface to production code); Alembic (more deps,
  and needs a runner anyway).
- **Consequences:** the first request after deploying a new migration pays its cost once. The seed never wipes data.

### ADR-004 Authentication: HS256 JWT, 30-minute sliding sessions, revocation epoch
- **Context:** sessions expire after 30 min (confirmed). The Lambdas have no internet. Secrets Manager is reachable
  via a VPC endpoint, but the Lambda IAM role and secret would be Terraform/IAM changes.
- **Decision:** PyJWT (pure Python, HS256). Access token TTL 30 min; `POST /api/auth/refresh` with a still-valid
  token issues a fresh one (sliding). Each token carries the user's `token_epoch`, checked on every request (one
  indexed lookup), so a role change, password reset or deactivation revokes sessions immediately. The signing key is
  generated on first migration and stored in an `app_secret` table.
- **Alternatives:** separate refresh tokens (more moving parts); Secrets Manager (correct for production; needs
  IAM, so recorded in PRODUCTION-READINESS); Cognito (out of scope for a standalone build).
- **Consequences:** the key lives in the DB. Acceptable for the workshop and documented as a production gap.

### ADR-005 Password hashing: PBKDF2-HMAC-SHA256, 600,000 iterations, stdlib
- **Context:** OWASP recommends 600k iterations for PBKDF2-SHA256. Measured **4.0 s** on the 128 MB Lambda.
- **Decision:** `hashlib.pbkdf2_hmac` with a 16-byte random salt, 600k iterations, stored as
  `pbkdf2_sha256$600000$salt$hash` so the cost can be raised later; constant-time compare. Only demo accounts are
  users (people ≠ users), so seeding hashes ~6 passwords.
- **Alternatives:** lower iterations (violates the brief); argon2/bcrypt (native extensions).
- **Consequences:** sign-in takes about 4 s. **Proposed mitigation:** raise `memory_size` for `auth` (Terraform change → ask).

### ADR-006 Database access: psycopg3, pooled per container, bounded retry, sslmode
- **Decision:** follow the example: a module-level connection, reconnect on failure. Add `sslmode=require` when
  `IS_LOCAL != "true"`, and a connect retry bounded to about 20 s to absorb Aurora resume within CloudFront's 30 s.
  Parameterised SQL only; one transaction per request, so audit, snapshot and idempotency rows commit atomically
  with the change.
- **Consequences:** 500 concurrent users means up to N warm containers × 1 connection. That is fine for Aurora at
  these ACUs; RDS Proxy is noted for production.

### ADR-007 Health engine: pure function; stored current health; lazy daily recompute
- **Decision:** `evaluate_health(...)` has no I/O and takes `today` and `rules` as arguments. Current health is
  stored on `projects` (for server-side filtering and pagination), recomputed in the same transaction as any input
  change, and lazily recomputed on read when `health_as_of < today`, because time alone changes elapsed%. A snapshot
  is written only when the result differs from the latest one.
- **Alternatives:** compute on every read (can't filter or paginate in SQL); a nightly job (needs EventBridge, i.e. infra).

### ADR-008 Concurrency, idempotency, soft delete, audit
- **Decision:** a `version` int on every mutable row; updates use `WHERE id=$1 AND version=$2`, and zero rows means
  409 with `details` naming who changed it and when. Creates honour `Idempotency-Key`, stored per user with a
  request hash: the same key and body replays the stored response, the same key with a different body returns 409.
  No hard deletes (`deleted`/`archived` flags; archive cascades). Audit rows hold JSON before/after in the same
  transaction.

### ADR-009 Frontend stack
- **Decision:** add `@mui/material` + `@emotion/*` + `@mui/icons-material`, `react-router-dom` with **HashRouter**
  (S3+OAC returns 403 on deep links and CloudFront maps only 404; this avoids an infra change), and **Vitest** + React
  Testing Library + jsdom (Jest-compatible API, native to Vite; the docs name Jest). Install the missing ESLint
  plugins so `npm run lint` works. Un-ignore `frontend/package-lock.json` for reproducible builds.
- **Consequences:** URLs look like `/#/projects/42`. One `api/client.js` owns tokens, renewal, 401 redirect and
  error mapping.

### ADR-010 Local development proxy forwards auth headers (Proposed)
- **Context:** `bin/proxy-server.js` forwards only accept, content-type, user-agent and host, so `Authorization` and
  `Idempotency-Key` are dropped locally. CloudFront forwards both (verified).
- **Decision:** add `authorization` and `idempotency-key` to the forwarded headers (2 lines). **Needs approval (bin/).**
- **Alternative:** a token in the query string (leaks into logs; rejected).

### ADR-011 Testing approach
- **Decision:** pytest + pytest-cov in a `python3.13` venv (`backend/requirements-dev.txt`). Pure unit tests for
  the health engine, allocation rules, validation and RBAC. Integration tests run handlers against local Postgres
  (`postgres/postgres123@localhost`) with a throwaway schema per run. Frontend uses Vitest + RTL.
  `scripts/smoke.sh BASE_URL` signs in per role against local or cloud.
- **Note:** local PG is 18.7 and Aurora is 17.7, so we avoid PG18-only features.

---

## Part B: Business rules register (ASSUMPTIONs to confirm)

Every threshold lives in `health_rules` / `beacon/config.py`, and code comments mark each one `ASSUMPTION`.

| # | Rule | Value | Status | Rationale |
|---|---|---|---|---|
| R1 | Admin sees project data read-only | read-only | ASSUMPTION | Admin needs context to support users; no write access |
| R2 | PM sees all projects, edits own | all/own | ASSUMPTION | Transparency across the portfolio |
| R3 | Team member sees own assigned tasks only | own | ASSUMPTION | Least privilege |
| R4 | Team member and PM can update status of tasks assigned to them | yes | ASSUMPTION | Keeps progress data current at source |
| R5 | PM cannot change baseline dates or approved budget | PMO only | ASSUMPTION | Stops goalposts moving |
| R6 | Spend recorded by PMO and PM (own) | | ASSUMPTION | No finance integration |
| R7 | PMO edits health thresholds | | ASSUMPTION | Rule owner = PMO |
| H1 | Health only for Active projects | | ASSUMPTION | Others show lifecycle status |
| H2 | Schedule Amber: lag > 10 pts, or late start > 7 days | 10 / 7 | ASSUMPTION | |
| H3 | Schedule Red: lag > 25 pts, or past planned end and not complete | 25 | ASSUMPTION | |
| H4 | Budget Amber: actual > planned-to-date by > 10%, or %spent − progress% > 15 pts | 10% / 15 | ASSUMPTION | |
| H5 | Budget Red: actual > planned-to-date by > 20%, or > approved budget | 20% | ASSUMPTION | |
| H6 | Milestone at risk: due within 7 days and < 75% complete | 7 / 75% | ASSUMPTION | |
| H7 | Milestones Amber: any at risk or 1 late; Red: ≥ 2 late or any > 14 days late | 2 / 14 | ASSUMPTION | |
| H8 | Overall = worst dimension | | ASSUMPTION | Stakeholder said "balance"; worst is safest |
| H9 | Mismatch flag when PM-reported status is better than calculated | | ASSUMPTION | |
| H10 | Update overdue after 7 days; colour unchanged | 7 | ASSUMPTION | |
| A1 | Standard capacity 40 h/week | 40 | ASSUMPTION | |
| A2 | > 60 h/week rejected | 60 | ASSUMPTION | Stakeholder named 60 |
| A3 | Tasks only assignable to people allocated to the project | | ASSUMPTION | |
| S1 | 30-min tokens renewed while active; warn 1 min before expiry | | ASSUMPTION | 30-min expiry itself CONFIRMED |
| S2 | Lockout 15 min after 5 failed sign-ins | 5 / 15 | ASSUMPTION | |
| S3 | Reset issues a temporary password; change forced at next sign-in | | ASSUMPTION | |
| C1 | Stale version → 409, UI names who changed it | | ASSUMPTION | |
| D1 | Dashboard contents and 60 s auto-refresh | 60 s | ASSUMPTION | |
| D2 | No offline mode | | ASSUMPTION | |

### Required-field justifications (lead's decisions, section 4 of the brief)
- **Project:** name (unique, 3–120) = the identity people search by; department = health-by-department reporting;
  PM = ownership and RBAC; planned start/end = the schedule and budget baselines; approved budget > 0 = budget
  baseline; lifecycle status = decides whether health applies.
- **Milestone:** name; due date within the project = at-risk/late rules; status = completion.
- **Task:** title; milestone = rolls up into milestone completion; status = progress %.
- **Allocation:** person, project, hours (0.5–60), dates within the project = the capacity rules.
- **Spend:** date (not future, within the project), amount > 0, category = budget dimension and burn reporting.
- **Implementation addition:** optional `actual_start` on project (needed for the late-start rule, H2).
