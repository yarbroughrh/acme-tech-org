"""SQL for listing and deciding change requests."""

from typing import Any

from psycopg import Connection

from beacon.db import execute, fetch_all, fetch_one

_SELECT = """
    SELECT cr.id, cr.project_id, cr.entity_type, cr.entity_id, cr.base_version, cr.changes, cr.note, cr.status,
           cr.reason, cr.decided_at, cr.created_at, cr.proposer_user_id,
           json_build_object('id', p.id, 'name', p.name) AS project, p.pm_user_id,
           json_build_object('id', pu.id, 'display_name', pu.display_name) AS proposer,
           CASE WHEN du.id IS NULL THEN NULL ELSE json_build_object('id', du.id, 'display_name', du.display_name) END AS decided_by,
           COALESCE(m.name, t.title) AS entity_name,
           CASE cr.entity_type WHEN 'MILESTONE' THEN to_jsonb(m) ELSE to_jsonb(t) END AS entity
    FROM change_requests cr
    JOIN projects p ON p.id = cr.project_id
    JOIN users pu ON pu.id = cr.proposer_user_id
    LEFT JOIN users du ON du.id = cr.decided_by
    LEFT JOIN milestones m ON cr.entity_type = 'MILESTONE' AND m.id = cr.entity_id
    LEFT JOIN tasks t ON cr.entity_type = 'TASK' AND t.id = cr.entity_id
"""


def list_requests(conn: Connection, where: list[str], params: list, order: str, limit: int,
                  offset: int) -> tuple[list[dict], int]:
    """A page of change requests with project, proposer, decider and the target entity."""
    sql_where = ("WHERE " + " AND ".join(where)) if where else ""
    rows = fetch_all(conn, f"SELECT * , count(*) OVER () AS total FROM ({_SELECT} {sql_where}) q "
                           f"ORDER BY {order}, id LIMIT %s OFFSET %s", params + [limit, offset])
    total = rows[0]["total"] if rows else 0
    for row in rows:
        row.pop("total", None)
    return rows, total


def get_request(conn: Connection, request_id: Any, for_update: bool = False) -> dict | None:
    """One change request (row-locked for decisions)."""
    if for_update:
        fetch_one(conn, "SELECT id FROM change_requests WHERE id = %s FOR UPDATE", (request_id,))
    return fetch_one(conn, _SELECT + " WHERE cr.id = %s", (request_id,))


def decide(conn: Connection, request_id: Any, status: str, actor_id: str, reason: str | None) -> None:
    """Record the PM's decision."""
    execute(conn, "UPDATE change_requests SET status = %s, decided_by = %s, decided_at = now(), reason = %s, "
                  "updated_at = now() WHERE id = %s AND status = 'PENDING'", (status, actor_id, reason, request_id))
