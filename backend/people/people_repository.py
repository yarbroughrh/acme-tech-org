"""SQL for the people view: current weekly load per person across all projects."""

from datetime import date
from typing import Any

from psycopg import Connection

from beacon.db import fetch_all

SORTS = {"name": "lower(pe.full_name)", "total_hours": "load.total_hours"}


def list_people(conn: Connection, today: date, q: str | None, department_id: str | None, load: str | None,
                standard: float, severe: float, limit: int, offset: int, order_by: str) -> tuple[list[dict], int]:
    """One page of people with current total hours (allocations overlapping today) and their allocations."""
    where, params = ["pe.is_active"], [today, today]
    if q:
        where.append("(lower(pe.full_name) LIKE %s OR lower(coalesce(pe.job_title, '')) LIKE %s)")
        params += [f"%{q.lower()}%"] * 2
    if department_id:
        where.append("pe.department_id = %s")
        params.append(department_id)
    if load == "SEVERE":
        where.append("load.total_hours > %s")
        params.append(severe)
    elif load == "OVER":
        where.append("load.total_hours > %s")
        params.append(standard)
    elif load == "UNDER":
        where.append("load.total_hours < %s")
        params.append(standard)
    rows = fetch_all(conn, f"""
        SELECT pe.id, pe.full_name, pe.job_title, json_build_object('id', d.id, 'name', d.name) AS department,
               load.total_hours, load.allocations, count(*) OVER () AS total
        FROM people pe JOIN departments d ON d.id = pe.department_id
        CROSS JOIN LATERAL (
            SELECT COALESCE(sum(a.hours_per_week), 0) AS total_hours,
                   COALESCE(json_agg(json_build_object('project', json_build_object('id', p.id, 'name', p.name),
                                                       'hours_per_week', a.hours_per_week) ORDER BY p.name)
                            FILTER (WHERE a.id IS NOT NULL), '[]') AS allocations
            FROM allocations a JOIN projects p ON p.id = a.project_id
            WHERE a.person_id = pe.id AND a.archived_at IS NULL AND a.start_date <= %s AND a.end_date >= %s) load
        WHERE {' AND '.join(where)}
        ORDER BY {order_by}, pe.id LIMIT %s OFFSET %s""", params + [limit, offset])
    total = rows[0]["total"] if rows else 0
    for row in rows:
        row.pop("total", None)
    return rows, total
