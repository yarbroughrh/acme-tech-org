"""Versioned, idempotent schema migrations.

SQL files in ``beacon/migrations`` named ``NNNN_description.sql`` are applied in order, each in
its own transaction, and recorded in ``schema_migrations``. A Postgres advisory lock serialises
concurrent cold starts. Applied migrations are never edited; add a new file instead.
"""

import logging
from pathlib import Path

from psycopg import Connection

from beacon import db

logger = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).parent / "migrations"
_ADVISORY_LOCK_ID = 7_420_001  # arbitrary, unique to Beacon migrations
_migrated = False


def list_migrations() -> list[tuple[str, str]]:
    """Return ``(version, sql)`` pairs sorted by version."""
    files = sorted(MIGRATIONS_DIR.glob("[0-9][0-9][0-9][0-9]_*.sql"))
    return [(f.stem, f.read_text(encoding="utf-8")) for f in files]


def apply_migrations(conn: Connection) -> list[str]:
    """Apply pending migrations under an advisory lock and return the versions applied."""
    applied: list[str] = []
    with conn.cursor() as cur:
        cur.execute("SELECT pg_advisory_lock(%s)", (_ADVISORY_LOCK_ID,))
        try:
            cur.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations ("
                " version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
            )
            cur.execute("SELECT version FROM schema_migrations")
            done = {row["version"] for row in cur.fetchall()}
            for version, sql in list_migrations():
                if version in done:
                    continue
                with conn.transaction():
                    cur.execute(sql)
                    cur.execute("INSERT INTO schema_migrations (version) VALUES (%s)", (version,))
                applied.append(version)
                logger.info("migration applied", extra={"fields": {"migration": version}})
        finally:
            cur.execute("SELECT pg_advisory_unlock(%s)", (_ADVISORY_LOCK_ID,))
    return applied


def ensure_migrated() -> None:
    """Run pending migrations once per Lambda container (cheap no-op afterwards)."""
    global _migrated
    if _migrated:
        return
    apply_migrations(db.get_connection())
    _migrated = True


def reset_flag() -> None:
    """Forget that migrations ran (tests only)."""
    global _migrated
    _migrated = False
