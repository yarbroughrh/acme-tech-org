# Beacon — Progress

_Last updated: 2026-11-19, after Slice 1 and the first four stakeholder confirmations._

## Done
- **Phase 0**: reconnaissance; findings and gotchas in CLAUDE.md.
- **Lead's decisions applied**: proxy forwards auth headers (ADR-010); shared library synced and committed with a
  drift test (ADR-002); Phase 0 smoke service deleted; Vitest and a committed lockfile (ADR-009).
- **Slice 1, deployed to AWS and smoke-tested** (https://d1u6z5us0d06jy.cloudfront.net):
  - schema (FKs, CHECKs, indexes, pg_trgm search), health rules table, versioned migrations on cold start
  - idempotent story seed via IAM-only invoke: 120 projects, 150 people, 20 users, 525 milestones, 1174 tasks
  - auth: sign-in, generic errors, 5/15 lockout, 30-min JWT with renewal, forced temp-password change,
    session revocation (token epoch)
  - RBAC: one declarative map; Admin user management (list/create/update/reset/unlock, 409 on stale version)
  - read-only portfolio: server-side search, filters, sort, pagination; detail; lookups
  - frontend: MUI shell (drawer on mobile), sign-in, change password, users, portfolio (cards on mobile), detail
  - tests: backend 115 pytest (94% coverage); frontend 78 Vitest; `scripts/smoke.sh` 26/26 on AWS
- **Confirmed rules applied** (2026-11-19): overall = worst; weekly updates / 7-day overdue (rule flagged confirmed,
  migration 0003); spend recorded by the PMO only (RBAC map, UI capability map, seed attribution, tests);
  executive home order (plan for slice 5).

## In progress
- Waiting for the lead's review of the auth-memory Terraform diff (ADR-005), then apply it.

## Next
- Slice 2: PMO create/assign/archive/cancel (cascade), PM milestones, tasks, weekly updates, audit log viewer,
  idempotency keys on creates, 409 conflicts in the UI.
- README.md (live URL, demo accounts, architecture), docs/TESTING.md.

## Risks / blockers
- Local env not yet started: `start-dev.sh` needs sudo, so the lead runs it in their own terminal. After that,
  check the psycopg wheel built by pip 3.14 (gotcha 7).
- No GitHub credentials on the VDI: the lead pushes with `! git push -u origin main`.
- The UI was verified by automated tests and a deployed-bundle check, not yet by a person clicking through in a browser.
- Sign-in takes ~4 s until the auth memory change is applied.
