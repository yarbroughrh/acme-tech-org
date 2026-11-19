"""Aggregate queries for the executive dashboard (Active projects only for health)."""

from datetime import date
from typing import Any

from psycopg import Connection

from beacon.db import fetch_all, fetch_one


def health_by_department(conn: Connection, department_id: str | None) -> list[dict]:
    """Active projects per department by calculated health, plus money from the stored engine metrics."""
    where, params = ["p.archived_at IS NULL", "p.lifecycle_status = 'ACTIVE'"], []
    if department_id:
        where.append("p.department_id = %s")
        params.append(department_id)
    return fetch_all(conn, f"""
        SELECT d.id, d.name,
               count(*) FILTER (WHERE p.health_overall = 'RED') AS red,
               count(*) FILTER (WHERE p.health_overall = 'AMBER') AS amber,
               count(*) FILTER (WHERE p.health_overall = 'GREEN') AS green,
               count(*) AS active,
               COALESCE(sum(p.approved_budget), 0) AS approved,
               COALESCE(sum((p.health_detail -> 'metrics' ->> 'planned_spend_to_date')::numeric), 0) AS planned_to_date,
               COALESCE(sum((p.health_detail -> 'metrics' ->> 'spend_to_date')::numeric), 0) AS actual_to_date
        FROM projects p JOIN departments d ON d.id = p.department_id
        WHERE {' AND '.join(where)} GROUP BY d.id, d.name ORDER BY d.name""", params)


def excluded_count(conn: Connection, department_id: str | None) -> int:
    """Non-archived projects that are not Active (no health colour; excluded from the counts)."""
    sql = "SELECT count(*) AS n FROM projects WHERE archived_at IS NULL AND lifecycle_status <> 'ACTIVE'"
    params: list[Any] = []
    if department_id:
        sql += " AND department_id = %s"
        params.append(department_id)
    return fetch_one(conn, sql, params)["n"]


def people_load(conn: Connection, today: date, standard: float, severe: float, department_id: str | None) -> dict:
    """Active people by current weekly load: over the severe line, over standard, at or under standard."""
    dept_sql, dept_params = ("AND pe.department_id = %s", [department_id]) if department_id else ("", [])
    return fetch_one(conn, f"""
        SELECT count(*) FILTER (WHERE total > %s) AS severe,
               count(*) FILTER (WHERE total > %s AND total <= %s) AS over,
               count(*) FILTER (WHERE total <= %s) AS at_or_under
        FROM (SELECT pe.id, COALESCE(sum(a.hours_per_week), 0) AS total FROM people pe
              LEFT JOIN allocations a ON a.person_id = pe.id AND a.archived_at IS NULL
                   AND a.start_date <= %s AND a.end_date >= %s
              WHERE pe.is_active {dept_sql} GROUP BY pe.id) loads""",
                     [severe, standard, severe, standard, today, today] + dept_params)
