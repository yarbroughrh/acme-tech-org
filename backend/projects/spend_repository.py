"""SQL for weekly spend entries (one live entry per project, week and category)."""

from typing import Any

from psycopg import Connection

from beacon.db import execute, fetch_all, fetch_one

_SELECT = """
    SELECT s.id, s.project_id, s.week_starting, s.category, s.amount, s.note, s.version, s.updated_at,
           CASE WHEN u.id IS NULL THEN NULL ELSE json_build_object('id', u.id, 'display_name', u.display_name) END AS updated_by
    FROM spend_entries s LEFT JOIN users u ON u.id = s.updated_by
"""


def list_for_project(conn: Connection, project_id: Any) -> list[dict]:
    """Live weekly entries, newest week first."""
    return fetch_all(conn, _SELECT + " WHERE s.project_id = %s AND s.deleted_at IS NULL ORDER BY s.week_starting DESC, s.category",
                     (project_id,))


def find_live(conn: Connection, project_id: Any, week_starting: Any, category: str) -> dict | None:
    """The live entry for this project, week and category (row-locked), if any."""
    row = fetch_one(conn, "SELECT id FROM spend_entries WHERE project_id = %s AND week_starting = %s AND category = %s "
                          "AND deleted_at IS NULL FOR UPDATE", (project_id, week_starting, category))
    return get(conn, row["id"]) if row else None


def get(conn: Connection, entry_id: Any) -> dict | None:
    """One entry."""
    return fetch_one(conn, _SELECT + " WHERE s.id = %s", (entry_id,))


def insert(conn: Connection, actor_id: str, project_id: Any, values: dict) -> Any:
    """Create an entry; returns its id."""
    return fetch_one(conn, "INSERT INTO spend_entries (project_id, week_starting, category, amount, note, created_by, updated_by) "
                           "VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
                     (project_id, values["week_starting"], values["category"], values["amount"], values.get("note"),
                      actor_id, actor_id))["id"]


def update(conn: Connection, actor_id: str, entry_id: Any, amount: Any, note: str | None) -> None:
    """Replace amount and note on an existing entry."""
    execute(conn, "UPDATE spend_entries SET amount = %s, note = %s, version = version + 1, updated_at = now(), updated_by = %s "
                  "WHERE id = %s", (amount, note, actor_id, entry_id))


def totals(conn: Connection, project_id: Any) -> dict:
    """Approved budget and the health engine's stored spend/planned-to-date metrics."""
    return fetch_one(conn, "SELECT approved_budget, (health_detail -> 'metrics' ->> 'spend_to_date')::numeric AS spend_to_date, "
                           "(health_detail -> 'metrics' ->> 'planned_spend_to_date')::numeric AS planned_to_date "
                           "FROM projects WHERE id = %s", (project_id,))
