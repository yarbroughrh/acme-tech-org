"""PostgreSQL connection management (psycopg3), following the example service's pattern.

One module-level connection per Lambda container is reused across invocations. Each request
runs inside one transaction (``transaction()``) so the change, its audit row, health snapshot
and idempotency record commit or roll back together.
"""

import logging
import time
from contextlib import contextmanager
from typing import Any, Iterator

from psycopg import Connection, OperationalError, connect
from psycopg.rows import dict_row

from beacon import config

logger = logging.getLogger(__name__)

_CONN: Connection | None = None


def get_connection() -> Connection:
    """Return the pooled connection, (re)connecting with a bounded retry.

    Aurora Serverless v2 can be auto-paused; the first connection then waits for it to resume.
    Retries stay within ``DB_CONNECT_BUDGET_SECONDS`` so the request finishes before
    CloudFront's ~30 s origin timeout.
    """
    global _CONN
    if _CONN is not None and not _CONN.closed and not _CONN.broken:
        return _CONN
    deadline = time.monotonic() + config.DB_CONNECT_BUDGET_SECONDS
    delay = 0.5
    while True:
        try:
            _CONN = connect(config.postgres_dsn(), autocommit=True, row_factory=dict_row)
            return _CONN
        except OperationalError as exc:
            if time.monotonic() + delay >= deadline:
                logger.error("db connect failed: %s", type(exc).__name__)
                raise
            logger.warning("db connect retry in %.1fs: %s", delay, type(exc).__name__)
            time.sleep(delay)
            delay = min(delay * 2, 4.0)


def reset() -> None:
    """Close and forget the pooled connection (used after fatal errors and in tests)."""
    global _CONN
    if _CONN is not None:
        try:
            _CONN.close()
        except Exception:  # nosec B110 - best-effort close of a possibly broken connection
            pass
    _CONN = None


@contextmanager
def transaction() -> Iterator[Connection]:
    """Yield the connection inside a transaction; commit on success, roll back on error."""
    conn = get_connection()
    try:
        with conn.transaction():
            yield conn
    except OperationalError:
        reset()
        raise


def fetch_one(conn: Connection, sql: str, params: Any = None) -> dict | None:
    """Execute parameterised SQL and return the first row as a dict (or None)."""
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchone()


def fetch_all(conn: Connection, sql: str, params: Any = None) -> list[dict]:
    """Execute parameterised SQL and return all rows as dicts."""
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def execute(conn: Connection, sql: str, params: Any = None) -> int:
    """Execute parameterised SQL and return the affected row count."""
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.rowcount
