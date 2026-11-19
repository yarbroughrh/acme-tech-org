# Beacon — Testing

What is tested, why, how to run it, and the known gaps. Final counts are in the last section.

## How to run

```sh
# Backend (Python 3.13 venv; integration tests use local Postgres at localhost:5432, postgres/postgres123)
python3.13 -m venv .venv && .venv/bin/pip install -r backend/requirements-dev.txt
cd backend && ../.venv/bin/pytest --cov=_shared/beacon --cov=auth --cov=users --cov=projects \
    --cov=change-requests --cov=me --cov=people --cov=portfolio --cov-report=term-missing
#   The suite DROPS and recreates the local database `beacon_test`, then migrates and seeds it exactly as in the
#   cloud. It never touches `postgres` or Aurora.

# Frontend
cd frontend && npm test && npm run lint && npm run coverage

# End to end against any deployment (signs in as every role; RBAC, critical paths)
./scripts/smoke.sh https://d1u6z5us0d06jy.cloudfront.net
./scripts/smoke.sh http://localhost:3001
```

## What is tested, in the lead's priority order

| # | Area | Where | How |
|---|---|---|---|
| 1 | **Health engine**: every rule, at / just below / just above each threshold, how dimensions combine, excluded lifecycle states, mismatch and overdue flags, configurable rules | `backend/tests/test_health_engine.py` (43 cases) | Pure function, table-driven, fixed `today` |
| 2 | **Allocation rules**: 40 / 40.5 / 60 / 61 h, totals across projects, 0.4 / 0.5 / 168 / 168.5 input check, Closed / Cancelled / archived rejected, On hold warned | `test_allocations_api.py` | Integration through the real Lambda handlers |
| 3 | **Access-control matrix**: every role on key endpoints (200/201/401/403), PM on another PM's project, Admin on project data, Executive writes, analyst direct edits, PMO-only lifecycle, rebaseline, spend and archive | `test_security_unit.py` (role × action map), `test_*_api.py`, `scripts/smoke.sh` (deployed) | Unit, integration, and the deployed API |
| 4 | **Validation, idempotency, 409, archive cascade, audit** | `test_project_writes_api.py`, `test_users_api.py`, `test_change_requests_api.py` | Integration |
| 5 | **Security**: password policy boundaries, PBKDF2 at 600k, lockout after 5 and expiry after 15 min, 30-min token, expired/tampered/revoked tokens, generic sign-in errors, forced change of temporary password | `test_security_unit.py`, `test_auth_api.py` | Unit and integration |
| 6 | **Change-request workflow**: nothing applies until approved, approval applies + audits + recalculates health, rejection needs a reason, only the owning PM decides, 409 on stale proposals | `test_change_requests_api.py` | Integration |
| 7 | **"Your next actions"**: ranking (severity order, 30-day cap, priority bonus, tie-breaks), per-role items, no leakage, Admin gets no project items, "New" | `test_work_queue_ranking.py`, `test_work_queue_api.py` | Pure function plus integration |
| 8 | **Dashboard**: Active-only counts, people bands, budget against plan cross-checked against the DB | `test_portfolio_summary_api.py` | Integration |
| 9 | **Migrations and seed**: idempotent re-runs, the story data, legacy upgrades (v2 member to analyst, v3 monthly to weekly spend) | `test_seed_and_migrations.py` | Integration |
| 10 | **Shared-library drift**: every committed copy equals the source | `test_shared_sync.py` | File comparison |
| 11 | **Frontend**: health badge (colour + icon + text), portfolio filters, sort and "All", project form validation, approvals (incl. mobile cards), proposals, Team tab warnings, People filters, roles and navigation, the API client (token, renewal, 401, retry) | `frontend/src/**/*.test.js(x)` | Vitest + React Testing Library with mocked API |
| 12 | **Smoke**: every role signs in; RBAC; search; change requests; decisions; allocations; work queues; JSON 404 | `scripts/smoke.sh` | curl against the deployed CloudFront URL |

Why this split: the business rules (health, allocation, access) are where a wrong answer destroys trust, so they
get table-driven boundary tests. Persistence and HTTP contracts are tested through the real handlers against a
real Postgres. The deployed system is smoke-tested after every deploy, because CloudFront and Lambda behaviour
differs from local (one defect, API 404s masked as 200, was only visible in the cloud).

## Known gaps (honest)
- **No browser end-to-end tests** (Cypress/Playwright). The UI is covered by component tests with mocked APIs, the
  API by integration tests, and the deployed system by `scripts/smoke.sh`. A manual click-through checklist (desktop
  and 375 px) is in docs/PROGRESS.md.
- **No load test** at 500 users (stretch goal).
- **The local LocalStack environment was never run** (`start-dev.sh` needs sudo on the VDI). Local tests use
  Postgres directly; the cloud is verified by smoke tests.
- **No test inspects log output** for secrets. Logs never include bodies or headers by construction, and the audit
  log redaction is tested.
- **The health boundary tests use** 55,000 / 55,001 for "exactly 10% / just above". There is no literal 10.01% case,
  and no "just below" case for every threshold.
- **Frontend coverage** is lower on the larger page components than on utilities and the API client.

## Results (final run, 2026-11-19 14:15, commit 4fb50a5)

| Suite | Result | Coverage |
|---|---|---|
| Backend pytest | **348 passed, 0 failed, 0 skipped** | **97%** overall. CRUD/services: projects 98%, plan 100%, collaboration 100%, allocations 97%, spend 100%, users 99%, change requests 99%, work queue 95%, people 100%, portfolio 100%. Error handling: errors 100%, http 92%, validation 93%. Health engine 99%. |
| Frontend Vitest | **195 passed, 0 failed** (26 files) | statements 88.7%, branches 82.5%, functions 81.7%, lines 90.4% |
| Smoke (deployed CloudFront URL) | **58 passed, 0 failed** | Every role signs in; RBAC on projects, users, people, dashboard, spend, change requests, allocations; work queue per role; JSON 404 |
| Live write checks (deployed) | Pass | Spend: Tuesday rejected, first save 201, same week and category 200 (updated), one entry; the test project was then archived |

Lint (ESLint) clean; `npm run build` succeeds; `./bin/sync-shared.sh --check` reports no drift.
