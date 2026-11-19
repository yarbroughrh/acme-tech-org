# Beacon — Portfolio Health

Beacon gives ACME Enterprise Technology's Portfolio Management Office and leadership **one trusted, current
view of project health**, people allocation, deliverables and budget. Health is **calculated from data by
transparent, configurable rules** (never chosen by the project manager), and every status explains itself,
for example: *"Amber. Budget: spend is 14% ahead of plan. Milestones: 'UAT sign-off' is due in 3 days and 40% complete."*

**Live:** https://d1u6z5us0d06jy.cloudfront.net

## Demo accounts

Demo data only. The passwords satisfy the policy (12+ characters, upper, lower, digit, symbol).

| Role | Email | Password | Lands on |
|---|---|---|---|
| Admin | admin@acme.example | `Beacon!Admin2026` | Your next actions (accounts), Users |
| Portfolio Manager (PMO) | pmo@acme.example | `Beacon!Pmo2026` | Your next actions + portfolio overview |
| Project Manager | pm@acme.example | `Beacon!Pm2026x` | Your next actions (approvals, updates, milestones) |
| PM Analyst | analyst1@acme.example | `Beacon!Analyst2026` | Your next actions (rework, pending proposals) |
| PM Analyst | analyst2@acme.example | `Beacon!Analyst2027` | Your next actions |
| Executive | exec@acme.example | `Beacon!Exec2026` | Off-track queue, then the dashboard |

Five failed sign-ins lock an account for 15 minutes; the Admin can unlock it.

**Demo story in the data:** *Customer Portal Rebuild* (the PM reports Green, but the data says Red, so it shows
Status mismatch), *Data Lake Modernisation* (spending ahead of delivery), *Payments Gateway Upgrade* (two late
milestones), *Branch Network Refresh* (no status update for 12 days and two weeks of spend missing), Priya Raman
(58 h/week, Amber) and Marcus Webb (64 h/week, Red). Jordan Lee (PM) has PM Analyst proposals waiting; one
account is locked for the Admin to unlock.

## Architecture

```mermaid
graph LR
  B[Browser: React 19 + MUI, HashRouter] -->|HTTPS| CF[CloudFront]
  CF -->|static| S3[(S3 bucket)]
  CF -->|/api/auth*| A[λ auth]
  CF -->|/api/users*| U[λ users]
  CF -->|/api/projects*| P[λ projects]
  CF -->|/api/change-requests*| C[λ change-requests]
  CF -->|/api/people*| PE[λ people]
  CF -->|/api/portfolio*| PF[λ portfolio]
  CF -->|/api/me*| ME[λ me: your next actions]
  A & U & P & C & PE & PF & ME -->|psycopg3, TLS| DB[(Aurora PostgreSQL 17)]
  OPS[Operator] -.->|aws lambda invoke: seed| U
```

- **Backend:** Python 3.13 Lambdas, one per domain. Each is layered handler → service → repository, on a shared
  library (`backend/_shared/beacon`) covering the DB connection, router, auth, RBAC, validation, audit,
  idempotency, the health engine, migrations and the seed. The library is synced into each service and
  committed (see docs/DECISIONS.md ADR-002).
- **Security:** PBKDF2-SHA256 (600k iterations) passwords, 30-minute JWT sessions renewed while active,
  lockout, a role × action permission map enforced on every request, and ownership checks in services.
- **Data:** versioned migrations run automatically on Lambda cold start; an idempotent seed runs by direct IAM invoke.

## Run, test, deploy

```sh
source ~/.bashrc
./bin/start-dev.sh                              # local: Postgres, LocalStack, Lambdas, proxy :3001, UI :3000

python3.13 -m venv .venv && .venv/bin/pip install -r backend/requirements-dev.txt
(cd backend && ../.venv/bin/pytest --cov=_shared/beacon --cov=auth --cov=users --cov=projects --cov=change-requests --cov=me --cov=people --cov=portfolio)
(cd frontend && npm test && npm run lint)

./bin/deploy.sh aws                             # sync shared lib, deploy backend, then frontend
source ENVIRONMENT.config && aws lambda invoke --function-name coding-workshop-users-e2540683 \
  --cli-binary-format raw-in-base64-out --cli-read-timeout 300 --payload '{"action":"seed"}' /tmp/seed.json
./scripts/smoke.sh https://d1u6z5us0d06jy.cloudfront.net    # signs in as every role, checks access control
```

## Documentation

- **[docs/DESIGN.md](docs/DESIGN.md): the design as built (roles, architecture, data model, health engine, flows, API, security)**
- [docs/PLAN.md](docs/PLAN.md): the original delivery plan
- [docs/DECISIONS.md](docs/DECISIONS.md): ADRs and every business rule (CONFIRMED / ASSUMPTION)
- [docs/PROGRESS.md](docs/PROGRESS.md): what's live, risks, click-through checklist
- [docs/TESTING.md](docs/TESTING.md): what is tested, results, known gaps
- [docs/PRODUCTION-READINESS.md](docs/PRODUCTION-READINESS.md): the path to production
- [docs/AI-USAGE.md](docs/AI-USAGE.md): how AI was directed
- [CLAUDE.md](CLAUDE.md): commands and gotchas for engineers
- Workshop guides: [docs/README.md](docs/README.md)

## License

MIT-0. See [LICENSE](LICENSE).
