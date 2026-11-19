"""Loads approved project data, runs the pure health engine, stores the result and snapshots.

- Called in the same transaction as any change to a health input (ADR-007).
- Stored health is refreshed lazily when ``health_as_of < today``, because time alone moves elapsed %.
- A snapshot is written only when the result differs from the latest snapshot (history for trends).
- Derived health columns never bump ``projects.version``, so recalculation cannot cause false 409s.
"""

import json
from datetime import date
from typing import Any, Iterable

from psycopg import Connection

from beacon.db import fetch_all
from beacon.health import evaluate_health
from beacon.http import json_default


def load_rules(conn: Connection) -> dict[str, float]:
    """All health rule thresholds from the ``health_rules`` table."""
    return {r["key"]: float(r["value"]) for r in fetch_all(conn, "SELECT key, value FROM health_rules")}


def _group(rows: Iterable[dict], key: str = "project_id") -> dict[Any, list[dict]]:
    grouped: dict[Any, list[dict]] = {}
    for row in rows:
        grouped.setdefault(row[key], []).append(row)
    return grouped


def recalculate(conn: Connection, project_ids: list, today: date | None = None) -> dict[str, dict]:
    """Recalculate and store health for ``project_ids`` (batched: a fixed number of queries)."""
    if not project_ids:
        return {}
    today = today or date.today()
    ids = [str(i) for i in project_ids]
    projects = fetch_all(conn, "SELECT id, lifecycle_status, planned_start, planned_end, actual_start, approved_budget "
                               "FROM projects WHERE id = ANY(%s::uuid[])", (ids,))
    milestones = _group(fetch_all(conn, "SELECT id, project_id, name, due_date, status, percent_complete FROM milestones "
                                        "WHERE project_id = ANY(%s::uuid[]) AND deleted_at IS NULL AND archived_at IS NULL", (ids,)))
    tasks = _group(fetch_all(conn, "SELECT project_id, milestone_id, status FROM tasks WHERE project_id = ANY(%s::uuid[]) "
                                   "AND deleted_at IS NULL AND archived_at IS NULL", (ids,)))
    spend = _group(fetch_all(conn, "SELECT project_id, spent_on, amount FROM spend_entries WHERE project_id = ANY(%s::uuid[]) "
                                   "AND deleted_at IS NULL AND spent_on <= %s", (ids, today)))
    latest_updates = _group(fetch_all(conn, "SELECT DISTINCT ON (project_id) project_id, reported_status, created_at "
                                            "FROM status_updates WHERE project_id = ANY(%s::uuid[]) "
                                            "ORDER BY project_id, created_at DESC", (ids,)))
    latest_snapshots = {r["project_id"]: r for r in fetch_all(
        conn, "SELECT DISTINCT ON (project_id) project_id, overall, dimensions, reasons, flags FROM health_snapshots "
              "WHERE project_id = ANY(%s::uuid[]) ORDER BY project_id, taken_at DESC, id DESC", (ids,))}
    rules = load_rules(conn)
    results: dict[str, dict] = {}
    with conn.cursor() as cur:
        for project in projects:
            pid = project["id"]
            result = evaluate_health(project, milestones.get(pid, []), tasks.get(pid, []), spend.get(pid, []),
                                     latest_updates.get(pid, []), rules, today)
            results[str(pid)] = result
            cur.execute("UPDATE projects SET health_overall = %s, health_detail = %s::jsonb, health_flags = %s, "
                        "health_as_of = %s WHERE id = %s",
                        (result["overall"], json.dumps(result, default=json_default), result["flags"], today, pid))
            dims = {k: v["status"] for k, v in result["dimensions"].items()}
            previous = latest_snapshots.get(pid)
            if previous is None or (previous["overall"], previous["dimensions"], previous["reasons"], list(previous["flags"])) \
                    != (result["overall"], dims, result["reasons"], result["flags"]):
                cur.execute("INSERT INTO health_snapshots (project_id, overall, dimensions, reasons, flags) "
                            "VALUES (%s, %s, %s::jsonb, %s::jsonb, %s)",
                            (pid, result["overall"], json.dumps(dims), json.dumps(result["reasons"]), result["flags"]))
    return results


def refresh_stale(conn: Connection, today: date | None = None, project_ids: list | None = None) -> int:
    """Recalculate projects whose stored health is missing or from an earlier day. Returns the count."""
    today = today or date.today()
    sql = "SELECT id FROM projects WHERE archived_at IS NULL AND (health_as_of IS NULL OR health_as_of < %s)"
    params: list = [today]
    if project_ids is not None:
        sql += " AND id = ANY(%s::uuid[])"
        params.append([str(i) for i in project_ids])
    stale = [r["id"] for r in fetch_all(conn, sql + " FOR UPDATE SKIP LOCKED", params)]
    recalculate(conn, stale, today)
    return len(stale)
