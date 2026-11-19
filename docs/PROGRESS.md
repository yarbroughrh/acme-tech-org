# Beacon — Progress

_Last updated: 2026-11-19, end of Phase 0._

## Done
- Phase 0 reconnaissance: docs, example service, scripts, Terraform read; findings in CLAUDE.md (gotchas 1–19).
- AWS: infra already provisioned (Aurora 17.7, CloudFront `E3HO6NXS9YD2B5`, S3). Smoke copy of the example service
  deployed: CloudFront → Lambda → Aurora verified. Unchanged frontend deployed:
  https://d1u6z5us0d06jy.cloudfront.net
- Verified in cloud: full path and `Authorization`/`Idempotency-Key` headers reach the Lambda; direct invoke
  works; PBKDF2 600k = 4.0 s; Secrets Manager reachable, Bedrock/internet not.
- Docs: CLAUDE.md, docs/PLAN.md, docs/DECISIONS.md, docs/PROGRESS.md.
- Git: `origin` → yarbroughrh/acme-tech-org, `upstream` → citi. Push blocked: no GitHub creds on the VDI.

## In progress
- Waiting for the lead's approval of PLAN.md and Proposed ADR-002 (sync script), ADR-005 (auth memory) and ADR-010 (proxy headers).

## Next
- Slice 0/1 per PLAN.md §7.

## Risks / blockers
- Local env: `start-dev.sh` needs sudo (Postgres rebind), so the lead runs it once in their own terminal.
- The local proxy drops auth headers (ADR-010).
- psycopg wheel built for pip 3.14 under local hot-reload (unverified).
- `backend/python-service/` is an uncommitted smoke copy; remove before slice 1 deploy.
