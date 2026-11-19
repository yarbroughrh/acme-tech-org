# Beacon — Decisions

Part A: Architecture Decision Records (technical; owned by engineering).
Part B: Business rules register: every ASSUMPTION awaiting stakeholder confirmation.
Status: **Accepted** = in force · **Proposed** = needs the lead's approval (touches infra / bin / IAM).
Business-rule status: **CONFIRMED** = by the Head of the PMO · **ASSUMPTION** = lead's decision, to confirm.

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

### ADR-002 Sharing code: canonical `backend/_shared/beacon`, synced and committed into each service (Accepted)
- **Context:** the Lambda packager zips only the service folder. It copies `requirements.txt` to a temp dir before
  `pip install`, so relative local-path requirements break. LocalStack hot-reload mounts the service folder, so
  symlinks to outside it would not resolve in the container (inferred; cloud packaging does follow symlinks).
- **Decision (approved by the lead with one change):** the single source of truth is `backend/_shared/beacon/`
  (underscore → never deployed itself). `bin/sync-shared.sh` copies it into `backend/<svc>/beacon/`, and those
  copies are **committed**, so the unchanged `./bin/deploy-backend.sh` always works on its own.
  `backend/tests/test_shared_sync.py` (and `./bin/sync-shared.sh --check`) fails if any copy differs from the source.
  `bin/deploy.sh` = sync → `deploy-backend.sh` → `deploy-frontend.sh`. Tests and coverage use the canonical copy
  (`backend/.coveragerc` omits the byte-identical copies).
- **Alternatives:** committed vendored copies plus a drift test (looks like copy-paste); a published wheel (no index
  reachable); a single Lambda (see ADR-001).
- **Consequences:** never edit `backend/<svc>/beacon/` directly; edit the source, run `./bin/sync-shared.sh`, commit
  both. Forgetting to sync fails the test suite instead of shipping stale code.

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
- **Consequences:** sign-in takes about 4 s at 128 MB.
- **Follow-up (approved by the lead; diff shown before applying):** raise memory for the **auth Lambda only** to
  1769 MB (one full vCPU). Reason: Lambda allocates CPU in proportion to memory, so this cuts sign-in to well under
  a second **while keeping strong password hashing** (600k iterations) rather than weakening it. **Status: diff
  prepared, NOT yet applied; waiting for the lead to review it.** The change is a
  `lambda_memory_overrides = { auth = 1769 }` map in `infra/locals.tf` and `memory_size = try(each.value.memory_size, 128)`
  in `infra/lambda.tf`; every other function stays at 128 MB. Password hashing in the `users` service
  (create/reset, Admin-only and rare) and the seed stay at 128 MB.

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
  Testing Library + jsdom. Install the missing ESLint plugins so `npm run lint` works. Un-ignore
  `frontend/package-lock.json` for reproducible builds (accepted).
- **Jest vs Vitest (accepted by the lead):** docs/full-stack.md names Jest + React Testing Library. Vitest implements
  the same API (`describe`/`it`/`expect`, `vi.fn` ≈ `jest.fn`, the same `@testing-library/jest-dom` matchers) and reuses
  the Vite config and transforms the app is already built with, so there is no second Babel/JSX pipeline to maintain.
  The tests are standard RTL tests that would port to Jest with only `vi` → `jest` renames.
- **Consequences:** URLs look like `/#/projects/42`. One `api/client.js` owns tokens, renewal, 401 redirect and
  error mapping.

### ADR-010 Local development proxy forwards auth headers (Accepted)
- **Context:** `bin/proxy-server.js` forwards only accept, content-type, user-agent and host, so `Authorization` and
  `Idempotency-Key` are dropped locally. CloudFront forwards both (verified).
- **Decision (approved):** `bin/proxy-server.js` now also forwards `authorization` and `idempotency-key`.
- **Alternative:** a token in the query string (leaks into logs; rejected).

### ADR-011 Testing approach
- **Decision:** pytest + pytest-cov in a `python3.13` venv (`backend/requirements-dev.txt`). Pure unit tests for
  the health engine, allocation rules, validation and RBAC. Integration tests run handlers against local Postgres
  (`postgres/postgres123@localhost`) with a throwaway schema per run. Frontend uses Vitest + RTL.
  `scripts/smoke.sh BASE_URL` signs in per role against local or cloud.
- **Note:** local PG is 18.7 and Aurora is 17.7, so we avoid PG18-only features.


### ADR-012 PM Analyst change requests: proposals stored apart from approved data
- **Context (CONFIRMED by the stakeholder):** PM Analysts propose changes to milestones and tasks; nothing takes
  effect until the project's PM approves; health and reports use approved data only.
- **Decision:** a `change_requests` table (project, proposer, entity type/id, `changes` JSON, `base_version`,
  status PENDING/APPROVED/REJECTED, decided_by, reason, timestamps; a CHECK requires a reason on rejection).
  Proposals never touch `milestones`/`tasks`, so the health engine cannot see them. Approval runs in ONE
  transaction: lock the request and the target row → refuse with **409** if the target's `version` differs from
  `base_version` (or it was deleted) → re-validate with the same `beacon.plan` rules as a direct edit → apply →
  audit (`UPDATED_BY_APPROVAL` with before/after, plus `APPROVED`) → recalculate health. Only the project's own PM
  decides (not the PMO). Archiving or cancelling a project rejects its open proposals with a reason.
- **Routing:** creation lives under the project (`POST /api/projects/{id}/change-requests`, projects service);
  the queue and decisions are a separate `change-requests` service, because CloudFront routes `/api/<first segment>*`
  to a Lambda of that name. Shared rules live in `beacon.plan` and `beacon.project_access`.
- **Alternatives:** draft columns on milestones/tasks (pending values would leak into queries and health); a
  generic "pending edits" log applied in batch (harder to show per-item diffs and to detect staleness).
- **Consequences:** a stale proposal must be rejected and re-proposed. This is deliberate: the PM never approves a
  change against data they haven't seen.

### ADR-013 Health engine pulled forward into Slice 2
- **Context:** approval must recalculate health, and a stub would make that requirement untestable.
- **Decision:** the pure engine (`beacon.health`), its store (`beacon.health_store`: batched load, stored
  current health, a snapshot only when the result changes, lazy refresh when `health_as_of < today`) and its
  table-driven tests shipped in Slice 2. Slice 3 is reduced to the remaining UI work (trends come later).
- **Consequences:** derived health columns never bump `projects.version`, so recalculation cannot cause false 409s.

### ADR-014 Versioned, additive seed
- **Decision:** `seed_runs` records applied seed versions (`v1` base portfolio, `v2` PM Analysts and demo proposals).
  Each version runs once, in order, in one transaction under an advisory lock, and never deletes data. `v2`
  upgrades a database seeded before the role change (the legacy `member@` demo account becomes `analyst1@`).

---

## Part B: Business rules register (ASSUMPTIONs to confirm)

Every threshold lives in `health_rules` / `beacon/config.py`, and code comments mark each one `ASSUMPTION`.

| # | Rule | Value | Status | Rationale |
|---|---|---|---|---|
| R1 | Admin sees project data read-only | read-only | ASSUMPTION | Admin needs context to support users; no write access |
| R2 | PM sees all projects, edits own (still open) | all/own | ASSUMPTION | Transparency across the portfolio |
| R3 | **"Team member" replaced by PM Analyst**: works on assigned projects, proposes changes to milestones and tasks (status, % complete, notes, due dates); nothing applies until the project's PM approves; a rejection needs a reason; health uses approved data only | | **CONFIRMED** | Stakeholder, 2026-11-19 (ADR-012) |
| R4 | ~~Task status by assignee~~: superseded by R3 (analysts propose; PMs edit directly) | | superseded | |
| R5 | PM cannot change baseline dates or approved budget | PMO only | ASSUMPTION | Stops goalposts moving |
| R6 | **Only the Portfolio Manager records actual spend**; PMs get 403 on spend endpoints and no spend editing in the UI | PMO only | **CONFIRMED** | Stakeholder, 2026-11-19 |
| R7 | PMO edits health thresholds | | ASSUMPTION | Rule owner = PMO |
| H1 | Health only for Active projects | | ASSUMPTION | Others show lifecycle status |
| H2 | Schedule Amber: lag > 10 pts, or late start > 7 days (exact thresholds still open) | 10 / 7 | ASSUMPTION | |
| H3 | Schedule Red: lag > 25 pts, or past planned end and not complete | 25 | ASSUMPTION | |
| H4 | Budget Amber: actual > planned-to-date by > 10%, or %spent − progress% > 15 pts | 10% / 15 | ASSUMPTION | |
| H5 | Budget Red: actual > planned-to-date by > 20%, or > approved budget | 20% | ASSUMPTION | |
| H6 | Milestone at risk: due within 7 days and < 75% complete | 7 / 75% | ASSUMPTION | |
| H7 | Milestones Amber: any at risk or 1 late; Red: ≥ 2 late or any > 14 days late | 2 / 14 | ASSUMPTION | |
| H8 | **Overall = worst of schedule, budget and milestones** | | **CONFIRMED** | Stakeholder, 2026-11-19 |
| H9 | Mismatch flag when PM-reported status is better than calculated | | ASSUMPTION | |
| H10 | **PMs update at least weekly; no status update in 7 days raises "Update overdue"** (colour unchanged) | 7 | **CONFIRMED** | Stakeholder, 2026-11-19; `health_rules.confirmed = true` (migration 0003) |
| A1 | Standard capacity 40 h/week | 40 | ASSUMPTION | |
| A2 | > 60 h/week rejected (hard limit still open) | 60 | ASSUMPTION | Stakeholder named 60 |
| A3 | Tasks only assignable to people allocated to the project | | ASSUMPTION | |
| A4 | The project's PM assigns PM Analysts to their own projects (and the PMO to any) | | ASSUMPTION | Stakeholder left open; default per lead |
| A5 | Proposals on an archived/cancelled project are auto-rejected with the reason | | ASSUMPTION | Archived projects are read-only |
| A6 | An Active project with no milestones shows Schedule Amber ("no milestones planned") | | ASSUMPTION | A plan without milestones cannot be shown as on track |
| A7 | "No update for 7 days" = flag after more than 7 full days (8+), so a weekly cadence on the same weekday is not flagged | | ASSUMPTION | Boundary interpretation of a CONFIRMED rule |
| S1 | 30-min tokens renewed while active; warn 1 min before expiry | | ASSUMPTION | 30-min expiry itself CONFIRMED |
| S2 | Lockout 15 min after 5 failed sign-ins | 5 / 15 | ASSUMPTION | |
| S3 | Reset issues a temporary password; change forced at next sign-in | | ASSUMPTION | |
| C1 | Stale version → 409, UI names who changed it | | ASSUMPTION | |
| D1 | **Executive home opens with the "Needs attention" queue and Red projects at the top, then health by department and the other charts** | | **CONFIRMED** | Stakeholder, 2026-11-19 |
| D1b | Auto-refresh every 60 s | 60 s | ASSUMPTION | |
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

### Open questions, ranked (after the 2026-11-19 confirmations)

Ranked by how much the answer changes what we build or how much users will trust it.
**Top 5 to take to the stakeholder now:**

1. **Exact health thresholds** (H2–H7: 10/25 pts lag, 7-day late start, 10%/20% overspend, 15-pt spend-ahead,
   7-day/75% at-risk, 1/2 late and 14 days late). These drive every colour on screen; a wrong value makes the
   whole view look untrustworthy.
2. **60 h/week: hard reject or warning?** (A2) This changes API behaviour (400 vs. saved with a warning).
3. **Can PMs see all projects, or only their own?** (R2) This is data exposure, and it changes the RBAC scope and the PM home page.
4. **Team member role** (R3, R4): do "people assigned things by the PM" sign in, and can they update their own task status?
   This decides whether a whole persona and home page ship.
5. **Who can re-baseline dates and budget?** (R5) If PMs could, they could move the goalposts the health rules measure against.

**Remaining (ranked):**
6. Late start needs an actual start date: who records it, and is "no actual start after planned start + 7 days" Amber? (H2)
7. Health only for Active projects; what do On hold projects show? (H1)
8. Mismatch flag: only when the PM reports *better* than calculated, or on any difference? (H9)
9. Tasks assignable only to people allocated to the project? (A3)
10. Standard 40 h for everyone, including part-timers? (A1)
11. Session: sliding 30 min with a 1-minute warning, or a hard 30 min? (S1)
12. Lockout 5 attempts / 15 minutes? (S2)
13. Temporary password with a forced change at next sign-in? (S3)
14. Admin read-only access to project data? (R1)
15. 409 "changed by X, reload": acceptable UX? (C1)
16. Auto-refresh every 60 s; no offline mode? (D1b, D2)
17. PMO edits health thresholds? (R7)

Resolved on 2026-11-19: overall = worst dimension (H8), weekly updates / 7-day overdue (H10), spend recorded by the
PMO only (R6), executive home order (D1).
