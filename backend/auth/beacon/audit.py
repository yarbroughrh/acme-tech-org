"""Audit log: who changed what, when, with before/after values (CONFIRMED).

Written in the same transaction as the change. Secrets are never recorded.
"""

import json
from typing import Any

from psycopg import Connection

from beacon import logs
from beacon.http import json_default

_REDACT = {"password_hash", "password", "token", "temporary_password"}


def _clean(record: dict[str, Any] | None) -> str | None:
    if record is None:
        return None
    return json.dumps({k: v for k, v in record.items() if k not in _REDACT}, default=json_default)


def record(conn: Connection, actor_id: str | None, entity_type: str, entity_id: Any, action: str,
           before: dict | None = None, after: dict | None = None, project_id: Any = None) -> None:
    """Insert one audit row (only changed fields are kept when both before and after are given)."""
    if before is not None and after is not None:
        changed = {k for k in set(before) | set(after) if before.get(k) != after.get(k)}
        before = {k: before.get(k) for k in changed}
        after = {k: after.get(k) for k in changed}
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO audit_log (actor_user_id, entity_type, entity_id, project_id, action, before, after, request_id) "
            "VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s)",
            (actor_id, entity_type, entity_id, project_id, action, _clean(before), _clean(after),
             logs.request_context.get().get("request_id")),
        )
