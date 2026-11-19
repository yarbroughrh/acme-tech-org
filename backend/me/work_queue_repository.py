"""Aggregate queries behind "Your next actions" (a fixed number per role; no N+1).

Health colours and flags are read from the stored health-engine result; milestone lateness is
evaluated with the engine's own ``milestone_states`` on rows loaded in bulk here.
"""

from datetime import date
from typing import Any

from psycopg import Connection

from beacon.db import fetch_all, fetch_one

PROJECT_COLUMNS = ("p.id, p.name, p.priority, p.approved_budget, p.lifecycle_status, p.planned_start, p.planned_end, "
                   "p.actual_start, p.health_overall, p.health_flags, p.health_detail -> 'reasons' AS reasons")


def projects_in_scope(conn: Connection, managed_by: str | None = None, assigned_to: str | None = None) -> list[dict]:
    """Non-archived projects in the caller's scope, with the latest status update and latest snapshot time."""
    where, params = ["p.archived_at IS NULL"], []
    if managed_by:
        where.append("p.pm_user_id = %s")
        params.append(managed_by)
    if assigned_to:
        where.append("EXISTS (SELECT 1 FROM project_analysts pa WHERE pa.project_id = p.id AND pa.user_id = %s "
                     "AND pa.removed_at IS NULL)")
        params.append(assigned_to)
    return fetch_all(conn, f"""
        SELECT {PROJECT_COLUMNS}, su.last_update, hs.changed_at AS health_changed_at
        FROM projects p
        LEFT JOIN LATERAL (SELECT max(created_at) AS last_update FROM status_updates s WHERE s.project_id = p.id) su ON true
        LEFT JOIN LATERAL (SELECT max(taken_at) AS changed_at FROM health_snapshots h WHERE h.project_id = p.id) hs ON true
        WHERE {' AND '.join(where)}""", params)


def milestones_and_tasks(conn: Connection, project_ids: list) -> tuple[list[dict], list[dict]]:
    """Open milestones and their live tasks for the given projects (two queries)."""
    if not project_ids:
        return [], []
    ids = [str(i) for i in project_ids]
    milestones = fetch_all(conn, "SELECT id, project_id, name, due_date, status, percent_complete FROM milestones "
                                 "WHERE project_id = ANY(%s::uuid[]) AND deleted_at IS NULL AND archived_at IS NULL "
                                 "AND status <> 'COMPLETE'", (ids,))
    tasks = fetch_all(conn, "SELECT t.id, t.project_id, t.milestone_id, t.title, t.status, t.due_date, t.assignee_person_id "
                            "FROM tasks t WHERE t.project_id = ANY(%s::uuid[]) AND t.deleted_at IS NULL "
                            "AND t.archived_at IS NULL", (ids,))
    return milestones, tasks


def pending_approvals(conn: Connection, pm_user_id: str) -> list[dict]:
    """Pending change requests on the PM's projects."""
    return fetch_all(conn, "SELECT cr.id, cr.created_at, cr.entity_type, p.id AS project_id, p.name AS project_name, "
                           "p.priority, p.approved_budget, u.display_name AS proposer, COALESCE(m.name, t.title) AS entity_name "
                           "FROM change_requests cr JOIN projects p ON p.id = cr.project_id "
                           "JOIN users u ON u.id = cr.proposer_user_id "
                           "LEFT JOIN milestones m ON cr.entity_type = 'MILESTONE' AND m.id = cr.entity_id "
                           "LEFT JOIN tasks t ON cr.entity_type = 'TASK' AND t.id = cr.entity_id "
                           "WHERE cr.status = 'PENDING' AND p.pm_user_id = %s AND p.archived_at IS NULL", (pm_user_id,))


def people_loads(conn: Connection, today: date, threshold: float, project_ids: list | None = None) -> list[dict]:
    """People whose current weekly total across all projects exceeds ``threshold``.

    With ``project_ids``, only people allocated to at least one of those projects are returned.
    """
    params: list[Any] = [today, today]
    scope = ""
    if project_ids is not None:
        scope = "AND a.person_id IN (SELECT person_id FROM allocations WHERE project_id = ANY(%s::uuid[]) AND archived_at IS NULL)"
        params.append([str(i) for i in project_ids])
    params.append(threshold)
    return fetch_all(conn, f"""
        SELECT pe.id, pe.full_name, sum(a.hours_per_week) AS total_hours, max(a.created_at) AS since
        FROM allocations a JOIN people pe ON pe.id = a.person_id
        WHERE a.archived_at IS NULL AND a.start_date <= %s AND a.end_date >= %s {scope}
        GROUP BY pe.id, pe.full_name HAVING sum(a.hours_per_week) > %s""", params)


def last_spend_weeks(conn: Connection, project_ids: list) -> dict:
    """Latest recorded spend week per project."""
    if not project_ids:
        return {}
    rows = fetch_all(conn, "SELECT project_id, max(week_starting) AS last_week FROM spend_entries "
                           "WHERE project_id = ANY(%s::uuid[]) AND deleted_at IS NULL GROUP BY project_id",
                     ([str(i) for i in project_ids],))
    return {r["project_id"]: r["last_week"] for r in rows}


def projects_without_allocations(conn: Connection, today: date) -> list[dict]:
    """Active projects with no current allocation."""
    return fetch_all(conn, f"SELECT {PROJECT_COLUMNS}, p.updated_at FROM projects p WHERE p.archived_at IS NULL "
                           "AND p.lifecycle_status = 'ACTIVE' AND NOT EXISTS (SELECT 1 FROM allocations a WHERE "
                           "a.project_id = p.id AND a.archived_at IS NULL AND a.end_date >= %s)", (today,))


def recent_turned_red(conn: Connection, since_days: int = 7) -> set:
    """Projects whose latest snapshot is Red and whose previous snapshot (within the window) was not Red."""
    rows = fetch_all(conn, """
        SELECT project_id FROM (
            SELECT project_id, overall, taken_at,
                   lag(overall) OVER (PARTITION BY project_id ORDER BY taken_at, id) AS previous,
                   row_number() OVER (PARTITION BY project_id ORDER BY taken_at DESC, id DESC) AS rn
            FROM health_snapshots WHERE taken_at > now() - make_interval(days => %s + 30)) s
        WHERE rn = 1 AND overall = 'RED' AND previous IS NOT NULL AND previous <> 'RED'
          AND EXISTS (SELECT 1 FROM health_snapshots h WHERE h.project_id = s.project_id AND h.overall <> 'RED'
                      AND h.taken_at > now() - make_interval(days => %s))""", (since_days, since_days))
    return {r["project_id"] for r in rows}


def own_proposals(conn: Connection, user_id: str) -> list[dict]:
    """The analyst's rejected and pending proposals (rejected ones decided in the last 30 days)."""
    return fetch_all(conn, "SELECT cr.id, cr.status, cr.reason, cr.created_at, cr.decided_at, cr.entity_type, "
                           "p.id AS project_id, p.name AS project_name, p.priority, p.approved_budget, "
                           "COALESCE(m.name, t.title) AS entity_name FROM change_requests cr "
                           "JOIN projects p ON p.id = cr.project_id "
                           "LEFT JOIN milestones m ON cr.entity_type = 'MILESTONE' AND m.id = cr.entity_id "
                           "LEFT JOIN tasks t ON cr.entity_type = 'TASK' AND t.id = cr.entity_id "
                           "WHERE cr.proposer_user_id = %s AND (cr.status = 'PENDING' OR "
                           "(cr.status = 'REJECTED' AND cr.decided_at > now() - interval '30 days'))", (user_id,))


def admin_accounts(conn: Connection) -> dict[str, list[dict]]:
    """Locked accounts, accounts on a temporary password, and role changes in the last 7 days."""
    return {
        "locked": fetch_all(conn, "SELECT id, email, display_name, locked_until FROM users WHERE locked_until > now()"),
        "temporary": fetch_all(conn, "SELECT id, email, display_name, updated_at FROM users WHERE must_change_password "
                                     "AND is_active"),
        "role_changes": fetch_all(conn, "SELECT a.at, a.before, a.after, u.id, u.email, u.display_name FROM audit_log a "
                                        "JOIN users u ON u.id = a.entity_id WHERE a.entity_type = 'user' "
                                        "AND a.action = 'UPDATED' AND a.after ? 'role' AND a.at > now() - interval '7 days'"),
    }


def previous_login(conn: Connection, user_id: str) -> Any:
    """When the user signed in before the current session (for "New" chips)."""
    row = fetch_one(conn, "SELECT previous_login_at FROM users WHERE id = %s", (user_id,))
    return row["previous_login_at"] if row else None
