"""SQL for projects (portfolio list, detail, lookups)."""

from typing import Any

from psycopg import Connection

from beacon.db import fetch_all, fetch_one

SORTS = {
    "name": "lower(p.name)",
    "planned_end": "p.planned_end",
    "approved_budget": "p.approved_budget",
    "health": "CASE p.health_overall WHEN 'RED' THEN 0 WHEN 'AMBER' THEN 1 WHEN 'GREEN' THEN 2 ELSE 3 END",
    "priority": "CASE p.priority WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END",
}

_LIST_COLUMNS = """
    p.id, p.name, p.planned_start, p.planned_end, p.approved_budget, p.lifecycle_status, p.priority,
    p.health_overall, COALESCE(p.health_detail -> 'reasons', '[]'::jsonb) AS health_reasons,
    p.health_flags AS flags, p.archived_at, p.version,
    json_build_object('id', d.id, 'name', d.name) AS department,
    json_build_object('id', u.id, 'display_name', u.display_name) AS pm
"""
_FROM = "FROM projects p JOIN departments d ON d.id = p.department_id JOIN users u ON u.id = p.pm_user_id"


def list_projects(conn: Connection, filters: dict[str, Any], limit: int, offset: int,
                  order_by: str) -> tuple[list[dict], int]:
    """One page of projects matching ``filters`` and the total count (single round trip)."""
    where, params = [], []
    if not filters.get("include_archived"):
        where.append("p.archived_at IS NULL")
    if filters.get("q"):
        where.append("(lower(p.name) LIKE %s OR lower(u.display_name) LIKE %s)")
        like = f"%{filters['q'].lower()}%"
        params += [like, like]
    for key, column in (("department_id", "p.department_id"), ("pm_user_id", "p.pm_user_id"),
                        ("priority", "p.priority"), ("lifecycle_status", "p.lifecycle_status")):
        values = filters.get(key)
        if values:
            where.append(f"{column} = ANY(%s)")
            params.append(values)
    health = filters.get("health")
    if health:
        clauses = []
        named = [h for h in health if h != "NONE"]
        if named:
            clauses.append("p.health_overall = ANY(%s)")
            params.append(named)
        if "NONE" in health:
            clauses.append("p.health_overall IS NULL")
        where.append("(" + " OR ".join(clauses) + ")")
    sql_where = ("WHERE " + " AND ".join(where)) if where else ""
    rows = fetch_all(conn, f"SELECT {_LIST_COLUMNS}, count(*) OVER () AS total {_FROM} {sql_where} "
                           f"ORDER BY {order_by}, p.id LIMIT %s OFFSET %s", params + [limit, offset])
    if rows:
        total = rows[0]["total"]
    else:
        total = fetch_one(conn, f"SELECT count(*) AS n {_FROM} {sql_where}", params)["n"]
    for row in rows:
        row.pop("total", None)
    return rows, total


def get_project(conn: Connection, project_id: str) -> dict | None:
    """Full project detail."""
    return fetch_one(conn, f"SELECT {_LIST_COLUMNS}, p.description, p.sponsor, p.actual_start, p.pm_user_id, "
                           f"p.created_at, p.updated_at {_FROM} WHERE p.id = %s", (project_id,))


def lookups(conn: Connection) -> dict[str, list[dict]]:
    """Reference data for filters and forms."""
    return {
        "departments": fetch_all(conn, "SELECT id, name FROM departments ORDER BY name"),
        "project_managers": fetch_all(conn, "SELECT id, display_name FROM users WHERE role = 'PM' AND is_active "
                                            "ORDER BY lower(display_name)"),
    }
