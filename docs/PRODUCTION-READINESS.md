# Beacon — Production Readiness

What a real ACME team would do to take Beacon from this one-day MVP to production. Each section says where we
are today and what we would change, roughly in priority order.

## 1. Identity and single sign-on
- **Today:** local accounts, PBKDF2-SHA256 at 600k iterations, 30-minute HS256 JWTs renewed while active, lockout
  after 5 failures, revocation via a per-user token epoch. Demo accounts with documented passwords.
- **Production:**
  - Replace local passwords with ACME's IdP (OIDC/SAML via Entra ID or Okta), using MFA and conditional access.
  - Map IdP groups to Beacon roles. The role × action map (`beacon/rbac.py`) stays the single authority.
  - Remove the demo accounts and the seed action from production builds.
  - Keep the token epoch so access is revoked immediately on role change.

## 2. Secrets management
- **Today:** Aurora credentials arrive as Lambda environment variables from Terraform. The JWT signing key lives in an
  `app_secret` table (ADR-004).
- **Production:**
  - Move the DB credentials and the signing key to AWS Secrets Manager. It is already reachable from the Lambda
    VPC; this needs an IAM grant.
  - Rotate secrets automatically, and use RS256/ES256 with key IDs so keys can rotate without logging everyone out.
  - Use IAM database authentication or RDS Proxy.
  - Never put secrets in `ENVIRONMENT.config` or shell profiles on shared machines.

## 3. CI/CD and environments
- **Today:** manual deploys with the workshop scripts from one VDI. Tests run locally. The GitHub workflows only run
  security scanners.
- **Production:**
  - Separate AWS accounts for dev, test, staging and prod, with remote Terraform state per environment.
  - One pipeline per push:
    - lint and type-check;
    - `pytest` against a Postgres service container;
    - Vitest;
    - Bandit, `npm audit` and Checkov, which must pass;
    - build once and promote the same artefact through the environments;
    - run `scripts/smoke.sh` after every deploy, with automatic rollback (Lambda aliases with weighted traffic).
  - Migrations run as an explicit pipeline step rather than on cold start, with expand/contract changes so old and
    new code can run side by side.
  - Branch protection, required reviews and signed commits.

## 4. Observability and alerting
- **Today:** structured JSON logs with request id, user id, role, route, status and duration, in CloudWatch, with
  7-day retention. No dashboards or alarms.
- **Production:**
  - CloudWatch metrics and alarms on 5xx rate, p95 latency, throttles, DLQ depth, Aurora CPU/ACU and connection
    count; route them to on-call.
  - X-Ray or OpenTelemetry tracing across CloudFront, Lambda and Aurora.
  - Log retention of 90+ days in a central account.
  - A synthetic canary running the smoke path every 5 minutes.
  - Business monitors: the share of Active projects with overdue updates, and failed sign-in spikes as a possible
    credential-stuffing signal.

## 5. Backup and disaster recovery
- **Today:** Aurora automated backups (7 days), `skip_final_snapshot = true`, a single region.
- **Production:**
  - PITR at 35 days, final snapshots on, deletion protection, and cross-region snapshot copy (or Aurora Global
    Database if the RTO needs it).
  - Agree the RPO and RTO with the PMO (suggested: RPO 15 min, RTO 4 h), and run restore drills quarterly.
  - The audit log is append-only today. In production, also stream it to S3 with Object Lock (WORM) for tamper
    evidence.

## 6. Performance at 500+ concurrent users
- **Today:**
  - Server-side pagination, search and filters everywhere, with an index on every filter and join column and
    `pg_trgm` for search.
  - Batched health recalculation; one pooled connection per warm Lambda; payloads capped at 100 rows (the work
    queue at 50).
  - Sign-in takes about 0.4 s now that the auth Lambda has one vCPU.
- **Production:**
  - Load-test the main reads (portfolio list, project detail, work queue, dashboard) with Artillery at 500 virtual
    users (the stretch goal, not run).
  - Put RDS Proxy in front of Aurora to cap connections as Lambda concurrency grows.
  - Set Aurora min ACU > 0 in business hours to avoid the ~15 s resume after auto-pause.
  - Use provisioned concurrency on hot Lambdas.
  - Move the lazy daily health refresh, which currently runs on a GET, to a scheduled nightly job (EventBridge).
  - Cache the dashboard summary for 60 s.

## 7. Security review
- **Done:**
  - Authentication on every endpoint except sign-in, and server-side RBAC plus ownership checks on every request
    (with an access-control test matrix).
  - Parameterised SQL, whitelisted sort and update columns, and generic sign-in errors.
  - Lockout, no secrets in logs or audit rows, and TLS to the database in the cloud.
  - Idempotent creates and optimistic concurrency.
- **To do before production:**
  - A threat model and pen test.
  - Security headers via a CloudFront response-headers policy (CSP, HSTS, X-Frame-Options).
  - AWS WAF with rate limiting on `/api/auth/login`.
  - Restrict the Lambda Function URLs so they're reachable only through CloudFront (OAC for Lambda). Today they are
    public with auth type NONE, so the app's own authentication is the only gate.
  - Dependency pinning with Dependabot and SAST in CI.
  - A data classification of project and people data, and PII retention rules for people records.

## 8. Migrating today's spreadsheets
1. **Inventory:** collect the current decks, trackers and status emails per department, and agree the field mapping to
   Beacon's model (project, milestones, tasks, allocations, weekly spend, status updates).
2. **Templates:** provide CSV templates per entity, plus a validation-only import endpoint that reuses the same
   validators as the API (`beacon.validation`, `beacon.plan`) and reports row-level errors without writing.
3. **Dry runs** per department with PMs fixing their own data; then a cut-over weekend: import, recalculate
   health, and have each PM confirm their projects in Beacon.
4. **Run in parallel** for one steering-committee cycle (decks and Beacon side by side), then retire the spreadsheets;
   the steering pack comes from Beacon only.
5. **Imported history** (old status, spend) is loaded as audit-tagged records with the source file, so numbers can
   always be traced back.

## 9. Operations and support
- Runbooks for: unlock or reset a user, rebaseline requests, reprocessing health, restoring from backup.
- An admin screen for health thresholds, with history (the API exists; the screen is a stretch goal).
- A data owner per department, and a change process for the rules (the PMO owns `health_rules`).
