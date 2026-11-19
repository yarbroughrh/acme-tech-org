"""SQL for allocations (hours per week, per person, per project, with dates)."""

from datetime import date
from typing import Any

from psycopg import Connection

from beacon.db import execute, fetch_all, fetch_one

_SELECT = """
    SELECT a.id, a.project_id, a.person_id, a.hours_per_week, a.start_date, a.end_date, a.version, a.updated_at, a.updated_by,
           json_build_object('id', pe.id, 'full_name', pe.full_name) AS person
    FROM allocations a JOIN people pe ON pe.id = a.person_id
"""


def list_for_project(conn: Connection, project_id: Any) -> list[dict]:
    """Live allocations on the project."""
    return fetch_all(conn, _SELECT + " WHERE a.project_id = %s AND a.archived_at IS NULL ORDER BY pe.full_name, a.start_date",
                     (project_id,))


def get(conn: Connection, project_id: Any, allocation_id: Any, for_update: bool = False) -> dict | None:
    """One live allocation of the project."""
    if for_update:
        fetch_one(conn, "SELECT id FROM allocations WHERE id = %s FOR UPDATE", (allocation_id,))
    return fetch_one(conn, _SELECT + " WHERE a.id = %s AND a.project_id = %s AND a.archived_at IS NULL",
                     (allocation_id, project_id))


def person_exists(conn: Connection, person_id: str) -> bool:
    """True if the person exists and is active."""
    return fetch_one(conn, "SELECT 1 AS x FROM people WHERE id = %s AND is_active", (person_id,)) is not None


def person_total(conn: Connection, person_id: Any, start: date, end: date) -> float:
    """The person's weekly hours across all live allocations overlapping [start, end].

    Conservative: allocations that overlap the window are summed even if they don't overlap each
    other (ASSUMPTION A8, documented); it never under-reports load.
    """
    row = fetch_one(conn, "SELECT COALESCE(sum(hours_per_week), 0) AS total FROM allocations WHERE person_id = %s "
                          "AND archived_at IS NULL AND start_date <= %s AND end_date >= %s", (person_id, end, start))
    return float(row["total"])


def insert(conn: Connection, actor_id: str, project_id: Any, values: dict) -> Any:
    """Create an allocation; returns its id."""
    return fetch_one(conn, "INSERT INTO allocations (person_id, project_id, hours_per_week, start_date, end_date, updated_by) "
                           "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
                     (values["person_id"], project_id, values["hours_per_week"], values["start_date"], values["end_date"],
                      actor_id))["id"]


def update(conn: Connection, actor_id: str, allocation_id: Any, changes: dict) -> None:
    """Apply whitelisted changes and bump the version."""
    cols = [c for c in ("hours_per_week", "start_date", "end_date") if c in changes]
    sets = [f"{c} = %s" for c in cols] + ["version = version + 1", "updated_at = now()", "updated_by = %s"]
    execute(conn, f"UPDATE allocations SET {', '.join(sets)} WHERE id = %s",  # nosec B608 - whitelisted identifiers
            [changes[c] for c in cols] + [actor_id, allocation_id])


def archive(conn: Connection, actor_id: str, allocation_id: Any) -> None:
    """Soft-remove an allocation (nothing is hard-deleted)."""
    execute(conn, "UPDATE allocations SET archived_at = now(), version = version + 1, updated_at = now(), updated_by = %s "
                  "WHERE id = %s", (actor_id, allocation_id))
