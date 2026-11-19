"""SQL for projects and their status updates, analysts, team and audit trail."""

from typing import Any

from psycopg import Connection

from beacon.db import execute, fetch_all, fetch_one

# "Needs attention" (default): Red, Amber, Green, then non-Active (no health); within each, projects with a
# Status mismatch or Update overdue flag first; then priority High > Medium > Low; then larger budget.
# Expressed as ONE row value so the appended ASC/DESC applies to the whole ordering.
ATTENTION_ORDER = ("ROW(CASE p.health_overall WHEN 'RED' THEN 0 WHEN 'AMBER' THEN 1 WHEN 'GREEN' THEN 2 ELSE 3 END, "
                   "CASE WHEN p.health_flags && ARRAY['STATUS_MISMATCH', 'UPDATE_OVERDUE']::text[] THEN 0 ELSE 1 END, "
                   "CASE p.priority WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END, -p.approved_budget)")

SORTS = {
    "attention": ATTENTION_ORDER,
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
EDITABLE = ("name", "description", "sponsor", "department_id", "pm_user_id", "planned_start", "planned_end",
            "actual_start", "approved_budget", "lifecycle_status", "priority")


def list_projects(conn: Connection, filters: dict[str, Any], limit: int, offset: int,
                  order_by: str) -> tuple[list[dict], int]:
    """One page of projects matching ``filters`` and the total count (single round trip)."""
    where, params = [], []
    if not filters.get("include_archived"):
        where.append("p.archived_at IS NULL")
    if filters.get("assigned_to"):
        where.append("EXISTS (SELECT 1 FROM project_analysts pa WHERE pa.project_id = p.id AND pa.user_id = %s "
                     "AND pa.removed_at IS NULL)")
        params.append(filters["assigned_to"])
    if filters.get("managed_by"):
        where.append("p.pm_user_id = %s")
        params.append(filters["managed_by"])
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


def get_project(conn: Connection, project_id: Any) -> dict | None:
    """Full project detail including the stored health result."""
    project = fetch_one(conn, f"SELECT {_LIST_COLUMNS}, p.description, p.sponsor, p.actual_start, p.pm_user_id, "
                              f"p.department_id, p.health_detail AS health, p.created_at, p.updated_at, p.updated_by, "
                              f"p.original_planned_start, p.original_planned_end, p.original_approved_budget "
                              f"{_FROM} WHERE p.id = %s", (project_id,))
    if project is not None:
        project["rebaselines"] = rebaselines(conn, project_id)
        project["is_rebaselined"] = bool(project["rebaselines"])
    return project


def rebaselines(conn: Connection, project_id: Any) -> list[dict]:
    """Rebaseline history, newest first."""
    return fetch_all(conn, "SELECT r.id, r.changed_at, r.reason, r.before, r.after, "
                           "json_build_object('id', u.id, 'display_name', u.display_name) AS changed_by "
                           "FROM project_rebaselines r JOIN users u ON u.id = r.changed_by WHERE r.project_id = %s "
                           "ORDER BY r.changed_at DESC", (project_id,))


def insert_rebaseline(conn: Connection, actor_id: str, project_id: Any, reason: str, before_json: str, after_json: str) -> None:
    """Record one rebaseline with the reason and before/after values."""
    execute(conn, "INSERT INTO project_rebaselines (project_id, changed_by, reason, before, after) "
                  "VALUES (%s, %s, %s, %s::jsonb, %s::jsonb)", (project_id, actor_id, reason, before_json, after_json))


def name_taken(conn: Connection, name: str, exclude_id: Any = None) -> bool:
    """True if another project already uses this name (case-insensitive)."""
    return fetch_one(conn, "SELECT 1 AS x FROM projects WHERE lower(name) = lower(%s) AND id IS DISTINCT FROM %s",
                     (name, exclude_id)) is not None


def department_exists(conn: Connection, department_id: str) -> bool:
    """True if the department exists."""
    return fetch_one(conn, "SELECT 1 AS x FROM departments WHERE id = %s", (department_id,)) is not None


def is_active_pm(conn: Connection, user_id: str) -> bool:
    """True if the user is an active Project Manager."""
    return fetch_one(conn, "SELECT 1 AS x FROM users WHERE id = %s AND role = 'PM' AND is_active", (user_id,)) is not None


def insert_project(conn: Connection, actor_id: str, values: dict[str, Any]) -> Any:
    """Insert a project and return its id."""
    cols = [c for c in EDITABLE if c in values]
    # The original baseline is kept forever; rebaselining only changes the current values.
    row = fetch_one(conn, f"INSERT INTO projects ({', '.join(cols)}, original_planned_start, original_planned_end, "  # nosec B608
                          f"original_approved_budget, created_by, updated_by) "
                          f"VALUES ({', '.join(['%s'] * len(cols))}, %s, %s, %s, %s, %s) RETURNING id",
                    [values[c] for c in cols] + [values["planned_start"], values["planned_end"], values["approved_budget"],
                                                 actor_id, actor_id])
    return row["id"]


def update_project(conn: Connection, actor_id: str, project_id: Any, changes: dict[str, Any]) -> None:
    """Apply whitelisted column changes and bump the version."""
    cols = [c for c in EDITABLE if c in changes]
    sets = [f"{c} = %s" for c in cols] + ["version = version + 1", "updated_at = now()", "updated_by = %s"]
    execute(conn, f"UPDATE projects SET {', '.join(sets)} WHERE id = %s",  # nosec B608 - whitelisted identifiers
            [changes[c] for c in cols] + [actor_id, project_id])


def archive_cascade(conn: Connection, actor_id: str, project_id: Any) -> dict[str, int]:
    """Archive the project and its milestones, tasks and allocations; reject pending proposals."""
    execute(conn, "UPDATE projects SET archived_at = now(), version = version + 1, updated_at = now(), updated_by = %s "
                  "WHERE id = %s", (actor_id, project_id))
    counts = {
        "milestones": execute(conn, "UPDATE milestones SET archived_at = now() WHERE project_id = %s AND archived_at IS NULL "
                                    "AND deleted_at IS NULL", (project_id,)),
        "tasks": execute(conn, "UPDATE tasks SET archived_at = now() WHERE project_id = %s AND archived_at IS NULL "
                               "AND deleted_at IS NULL", (project_id,)),
        "allocations": execute(conn, "UPDATE allocations SET archived_at = now() WHERE project_id = %s "
                                     "AND archived_at IS NULL", (project_id,)),
    }
    counts["change_requests_rejected"] = reject_pending(conn, actor_id, project_id, "Project archived.")
    return counts


def reject_pending(conn: Connection, actor_id: str, project_id: Any, reason: str) -> int:
    """Close open proposals when a project can no longer change."""
    return execute(conn, "UPDATE change_requests SET status = 'REJECTED', reason = %s, decided_by = %s, decided_at = now(), "
                         "updated_at = now() WHERE project_id = %s AND status = 'PENDING'", (reason, actor_id, project_id))


def lookups(conn: Connection) -> dict[str, list[dict]]:
    """Reference data for filters and forms."""
    return {
        "departments": fetch_all(conn, "SELECT id, name FROM departments ORDER BY name"),
        "project_managers": fetch_all(conn, "SELECT id, display_name FROM users WHERE role = 'PM' AND is_active "
                                            "ORDER BY lower(display_name)"),
        "analysts": fetch_all(conn, "SELECT id, display_name FROM users WHERE role = 'ANALYST' AND is_active "
                                    "ORDER BY lower(display_name)"),
    }


def team(conn: Connection, project_id: Any) -> list[dict]:
    """People allocated to the project (assignee choices)."""
    return fetch_all(conn, "SELECT p.id, p.full_name, sum(a.hours_per_week) AS hours_per_week FROM allocations a "
                           "JOIN people p ON p.id = a.person_id WHERE a.project_id = %s AND a.archived_at IS NULL "
                           "GROUP BY p.id, p.full_name ORDER BY p.full_name", (project_id,))


def audit_page(conn: Connection, project_id: Any, limit: int, offset: int) -> tuple[list[dict], int]:
    """The project's audit trail, newest first."""
    rows = fetch_all(conn, "SELECT a.id, a.at, a.entity_type, a.entity_id, a.action, a.before, a.after, "
                           "CASE WHEN u.id IS NULL THEN NULL ELSE json_build_object('id', u.id, 'display_name', u.display_name) END AS actor, "
                           "count(*) OVER () AS total FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id "
                           "WHERE a.project_id = %s ORDER BY a.at DESC, a.id DESC LIMIT %s OFFSET %s",
                     (project_id, limit, offset))
    total = rows[0]["total"] if rows else 0
    for row in rows:
        row.pop("total", None)
    return rows, total


def status_updates(conn: Connection, project_id: Any) -> list[dict]:
    """Status update history, newest first."""
    return fetch_all(conn, "SELECT s.id, s.reported_status, s.summary, s.created_at, "
                           "json_build_object('id', u.id, 'display_name', u.display_name) AS author "
                           "FROM status_updates s JOIN users u ON u.id = s.author_user_id WHERE s.project_id = %s "
                           "ORDER BY s.created_at DESC LIMIT 100", (project_id,))


def insert_status_update(conn: Connection, actor_id: str, project_id: Any, reported: str, summary: str) -> dict:
    """Record a weekly status update."""
    row = fetch_one(conn, "INSERT INTO status_updates (project_id, author_user_id, reported_status, summary) "
                          "VALUES (%s, %s, %s, %s) RETURNING id", (project_id, actor_id, reported, summary))
    return next(u for u in status_updates(conn, project_id) if u["id"] == row["id"])


def analysts(conn: Connection, project_id: Any) -> list[dict]:
    """Analysts currently assigned to the project."""
    return fetch_all(conn, "SELECT u.id AS user_id, u.display_name, u.email, pa.assigned_at FROM project_analysts pa "
                           "JOIN users u ON u.id = pa.user_id WHERE pa.project_id = %s AND pa.removed_at IS NULL "
                           "ORDER BY lower(u.display_name)", (project_id,))


def is_active_analyst(conn: Connection, user_id: str) -> bool:
    """True if the user is an active PM Analyst."""
    return fetch_one(conn, "SELECT 1 AS x FROM users WHERE id = %s AND role = 'ANALYST' AND is_active", (user_id,)) is not None


def assign_analyst(conn: Connection, actor_id: str, project_id: Any, user_id: str) -> None:
    """Assign an analyst (unique while active)."""
    execute(conn, "INSERT INTO project_analysts (project_id, user_id, assigned_by) VALUES (%s, %s, %s)",
            (project_id, user_id, actor_id))


def remove_analyst(conn: Connection, project_id: Any, user_id: str) -> int:
    """Soft-remove an assignment; returns rows affected."""
    return execute(conn, "UPDATE project_analysts SET removed_at = now() WHERE project_id = %s AND user_id = %s "
                         "AND removed_at IS NULL", (project_id, user_id))


def insert_change_request(conn: Connection, project_id: Any, proposer_id: str, entity_type: str, entity_id: Any,
                          base_version: int, changes_json: str, note: str | None) -> dict:
    """Store a pending proposal."""
    return fetch_one(conn, "INSERT INTO change_requests (project_id, proposer_user_id, entity_type, entity_id, base_version, "
                           "changes, note) VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s) "
                           "RETURNING id, project_id, entity_type, entity_id, base_version, changes, note, status, created_at",
                     (project_id, proposer_id, entity_type, entity_id, base_version, changes_json, note))
