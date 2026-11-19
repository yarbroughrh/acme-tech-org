# CLAUDE.md — Beacon

Beacon is ACME Enterprise Technology's portfolio health platform: one trusted view of project health,
people allocation, deliverables and budget. Health is **calculated** from data by configurable rules and
always explains itself; nobody can override it.

Read `docs/PROGRESS.md` first (what's done / next), then `docs/PLAN.md` and `docs/DECISIONS.md`.

## Environment facts (verified in Phase 0, 2026-11-19)

| Item | Value |
|---|---|
| AWS region / participant | `us-east-2` / `e2540683` |
| Live URL (UI + API) | https://d1u6z5us0d06jy.cloudfront.net (CloudFront `E3HO6NXS9YD2B5`) |
| API base (cloud) | `https://d1u6z5us0d06jy.cloudfront.net/api/{service}` |
| Aurora | `coding-workshop-rds-e2540683`, PostgreSQL **17.7**, db `codingworkshop`, Serverless v2 min 0 ACU, **auto-pause after 300 s** |
| Local Postgres | **18.7** on `localhost:5432`, user `postgres` / `postgres123`, db `postgres` (Lambdas reach it at `172.17.0.1`) |
| Lambda | `python3.13`, x86_64, **128 MB (fixed in Terraform)**, timeout 300 s; but CloudFront origin timeout is ~30 s |
| Host Python | `python3` = 3.13 ✔, but bare `pip` = **Python 3.14** ✘ |
| Node / npm | 22 / 10 |
| Git remotes | `origin` = github.com/yarbroughrh/acme-tech-org, `upstream` = citi/coding-workshop-participant. No GitHub creds on VDI; the user pushes via `! git push`. |

## Commands

```sh
source ~/.bashrc                       # always first: AWS_REGION, EVENT_ID, PARTICIPANT_ID, LOCALSTACK_AUTH_TOKEN

# Local (needs sudo once to rebind Postgres to 0.0.0.0, so the USER runs it in their own terminal)
./bin/start-dev.sh                     # Postgres+Mongo+LocalStack+deploy Lambdas+proxy :3001+vite :3000 (foreground)
curl http://localhost:3001/api/<service>          # local API via CORS proxy

# Shared library: edit ONLY backend/_shared/beacon, then sync + commit the copies (ADR-002)
./bin/sync-shared.sh                   # copy into backend/<svc>/beacon
./bin/sync-shared.sh --check           # exit 1 on drift (also enforced by backend/tests/test_shared_sync.py)

# Cloud: backend first, then frontend
./bin/deploy.sh aws                    # sync + deploy-backend + deploy-frontend (preferred)
./bin/deploy.sh aws --backend-only     # or --frontend-only
./bin/deploy-backend.sh aws            # unchanged workshop script; works on its own (copies are committed)
./bin/deploy-frontend.sh aws           # vite build, s3 sync, CloudFront invalidation

# Seed demo data (idempotent; IAM-only direct invoke; migrations run automatically on cold start)
source ENVIRONMENT.config && aws lambda invoke --function-name coding-workshop-users-e2540683 \
  --cli-binary-format raw-in-base64-out --cli-read-timeout 300 --payload '{"action":"seed"}' /tmp/seed.json && cat /tmp/seed.json
# local: same with AWS_ENDPOINT_URL=http://localhost.localstack.cloud:4566 and test creds

# Smoke test (every role, RBAC, search) against cloud or local
./scripts/smoke.sh https://d1u6z5us0d06jy.cloudfront.net
./scripts/smoke.sh http://localhost:3001

# Direct (IAM-only) Lambda invoke, used for seeding; works from the VDI
source ENVIRONMENT.config && aws lambda invoke --function-name coding-workshop-<service>-e2540683 \
  --cli-binary-format raw-in-base64-out --payload '{"action":"..."}' out.json

# Logs
aws logs tail /aws/lambda/coding-workshop-<service>-e2540683 --follow --format short           # cloud (after: source ENVIRONMENT.config)
AWS_ENDPOINT_URL=http://localhost.localstack.cloud:4566 aws logs tail /aws/lambda/coding-workshop-<service>-e2540683 --follow   # local
tail -f /tmp/proxy-server.log /tmp/backend-deploy.log                                            # local proxy / deploy

# Tests
python3.13 -m venv .venv && .venv/bin/pip install -r backend/requirements-dev.txt   # once
cd backend && ../.venv/bin/pytest --cov=_shared/beacon --cov=auth --cov=users --cov=projects --cov-report=term-missing
#   integration tests DROP and recreate local database `beacon_test` (never touches `postgres` or Aurora)
cd frontend && npm test && npm run lint && npm run coverage
```

## Folder structure

```
backend/<service>/          one Lambda per folder (function.py, handler `function.handler`, requirements.txt)
backend/_examples/          reference examples, NOT deployed (underscore prefix)
backend/_shared/beacon/     canonical shared library (db, http router, auth, rbac, validation, audit, migrations, seed)
backend/<svc>/beacon/       COMMITTED synced copy; never edit directly (drift test fails)
backend/<svc>/              function.py (routes) → <svc>_service.py (rules) → <svc>_repository.py (SQL)
backend/tests/              pytest: unit + integration (real handlers, local Postgres)
scripts/smoke.sh            curl smoke test for any base URL
bin/                        workshop scripts (do not modify without asking the lead)
infra/                      Terraform (do not modify without asking the lead)
frontend/src/               api/ (one client) · auth/ (context, guards, roles.js = roles/home/nav/capabilities) ·
                            components/ · pages/ · utils/ · tests next to code (*.test.jsx, Vitest + RTL)
docs/                       PLAN, DECISIONS, PROGRESS, TESTING, ...
```

## Conventions

- Follow `backend/_examples/python-service`: `function.py` with `handler(event, context)`, module-level
  pooled psycopg3 connection, config from env vars (`IS_LOCAL`, `POSTGRES_*`), `logging` at INFO.
- Python: PEP 8, snake_case, type hints and docstrings on public functions (.github/instructions).
- React: camelCase / PascalCase, PropTypes, JSDoc (.github/instructions).
- Layering: handler (HTTP, auth, validation) → service (rules, ownership) → repository (parameterised SQL).
- Error shape: `{"error": {"code": "...", "message": "...", "details": [...]}}`.
- Every business threshold is configurable; unconfirmed rules are marked `ASSUMPTION` in code and docs/DECISIONS.md.
- Conventional commits; never commit `ENVIRONMENT.config`, `.env*`, or credentials. Push only when asked.
- Ask the lead before changing `infra/`, IAM, `bin/` scripts, or anything destructive (destroy, DB reset, force-push).

## Gotchas (all verified unless marked)

1. **Service discovery** is by `backend/*/requirements.txt` (infra/locals.tf), not `function.py` as
   backend/README.md says. Any non-`_` folder with a requirements.txt becomes a Lambda and a CloudFront
   route `/api/<folder>*`. Folder name = service name = URL segment.
2. **The unchanged repo deploys zero Lambdas** (examples are under `_examples/`).
3. **Path differs by environment.** Cloud: Lambda `rawPath` is the full `/api/<svc>/123/sub`. Local
   proxy strips the prefix: `/123/sub`. The router must accept both. Nested resources
   (`/api/projects/{id}/milestones`) go to the parent service's Lambda.
4. **The CloudFront pattern `/api/<svc>*` is a prefix match:** `/api/projectsX` also hits `projects`.
5. **The local proxy drops headers.** `bin/proxy-server.js` forwards only accept, content-type,
   user-agent and host, so **`Authorization` and `Idempotency-Key` never reach local Lambdas.** In the
   cloud both are forwarded (verified). The fix needs the lead's approval (bin/ change).
6. **Packaging** zips only the service folder. Terraform runs `python3.13 -m pip install -r
   requirements.txt` in a *temp copy* (so relative local-path requirements break), and follows symlinks.
   Code outside the folder is not included, which is why the shared library needs a sync step (ADR-002).
7. `start-dev.sh` runs bare **`pip` (Python 3.14)** `--target` into each service folder for hot-reload,
   so native wheels (psycopg-binary) may be cp314 and fail under the python3.13 Lambda. Unverified until
   start-dev runs. Those installed packages also land in `backend/<svc>/` and must be gitignored.
8. **No DB access from the VDI.** The Aurora SG only allows itself, and the VDI reaches only 389/443.
   Migrations and seeding must run inside a Lambda.
9. **Aurora auto-pauses** after 5 min idle. The first query after a pause plus a Lambda cold start took
   **15.8 s**. CloudFront gives up at ~30 s (504). Keep connect retries bounded (<20 s).
10. **PBKDF2-SHA256 at 600k iterations takes 4.0 s on 128 MB Lambda** (CPU scales with memory). Only hash
    on sign-in / reset; seed only the demo accounts as users.
11. **The Lambda has no internet egress.** Bedrock and pypi are unreachable; Secrets Manager is reachable
    (VPC endpoint).
12. **SPA deep links return 403 in the cloud.** S3+OAC returns 403 for missing keys, and CloudFront maps
    only 404 to index.html. Use `HashRouter` (no infra change).
13. The example `PG_CONFIG` lacks `sslmode=require`; the docs require it in the cloud (IS_LOCAL=false).
14. `frontend/eslint.config.js` imports `eslint-plugin-react-hooks`/`-react-refresh`, which are not
    installed, so `npm run lint` fails as shipped. MUI, react-router and test libs are also absent.
15. `.gitignore` ignores `package-lock.json`, `*.config`, and any folder named `lib/`, `build/`,
    `assets`, `logs`, `tmp`, `coverage`, `dist`. Don't name source folders like that.
16. Local and AWS share `infra/.terraform`. Every script runs `terraform init -reconfigure`, so **never
    run a local and an AWS deploy at the same time.**
17. `generate-env.sh` picks "local" whenever LocalStack is running. That's fine for deploy-frontend
    (exported VITE_* env vars override .env.local), but don't rely on `.env.local` for cloud builds.
18. `deploy-*.sh aws` call `setup-participant.sh`, which refreshes the STS creds in `ENVIRONMENT.config`
    (gitignored, holds live credentials; never print or commit it).
19. ~~Phase 0 smoke copy `backend/python-service`~~: deleted; its Lambda was destroyed in the slice 1 deploy.
20. **Add a service** = new `backend/<svc>/` with `requirements.txt` (psycopg + PyJWT), `function.py`, then
    `./bin/sync-shared.sh`, add it to `SERVICES` in backend/tests/conftest.py and to `.coveragerc` omit.
    Name service-local modules `<svc>_service.py` / `<svc>_repository.py`: unique names avoid import clashes in
    tests, and `.gitignore` whitelists exactly those names (other files in service folders are ignored as pip output).
21. Routes: register static paths (`/lookups`) BEFORE `/{id}`; params ending in `id` must be UUIDs (else 404).
22. A handler that must persist state AND return an error (e.g. failed sign-in counter) returns
    `error_result(...)` instead of raising, because raising rolls back the request transaction.
23. **Applied migrations are immutable**: add `NNNN_*.sql`; never edit 0001–0003 (the cloud DB has them).
24. Seed is versioned (`seed_config.SEED_VERSION`); changing seed code does NOT reseed an existing DB.
25. Cold seed on Aurora takes ~40 s (resume + 5 PBKDF2 hashes at 128 MB): use `--cli-read-timeout 300`.
26. MUI 9 icons: only `*Outlined` names exist (no `*Outline`).
27. eslint-plugin-react-hooks v7 forbids synchronous setState in effects; use `utils/useApiQuery.js`.
28. Frontend `roles.js` CAPABILITIES mirrors `beacon/rbac.py` for hiding UI only; keep them in step
    (e.g. `spend.record` = PMO only, CONFIRMED).
