"""Milestone and task rules shared by direct edits (projects service) and approved change requests
(change-requests service), so both paths validate and apply changes identically.

- Due dates must fall within the project's planned dates.
- Task assignees must be allocated to the project (ASSUMPTION A3).
- Status and percent complete are kept consistent for milestones without tasks.
- Every change bumps ``version`` (optimistic concurrency) and is audited with before/after values.
- Deletes are soft (``deleted_at``); deleting a milestone soft-deletes its tasks.
"""

from datetime import date
from typing import Any

from psycopg import Connection

from beacon import audit
from beacon.db import fetch_all, fetch_one
from beacon.errors import Conflict, NotFound, ValidationError, field_error
from beacon.validation import Fields

MILESTONE_STATUSES = ("NOT_STARTED", "IN_PROGRESS", "COMPLETE")
TASK_STATUSES = ("TODO", "IN_PROGRESS", "DONE")
# Fields a PM Analyst may propose (CONFIRMED: status, percent complete, notes, due dates)
PROPOSABLE = {"MILESTONE": ("status", "percent_complete", "due_date", "notes"),
              "TASK": ("status", "due_date", "notes")}

MILESTONE_SELECT = """
    SELECT m.id, m.project_id, m.name, m.description, m.notes, m.due_date, m.status, m.percent_complete,
           m.owner_person_id, m.version, m.updated_at, m.updated_by,
           CASE WHEN o.id IS NULL THEN NULL ELSE json_build_object('id', o.id, 'full_name', o.full_name) END AS owner,
           (SELECT count(*) FROM tasks t WHERE t.milestone_id = m.id AND t.deleted_at IS NULL AND t.archived_at IS NULL) AS task_count,
           (SELECT count(*) FROM tasks t WHERE t.milestone_id = m.id AND t.deleted_at IS NULL AND t.archived_at IS NULL
                AND t.status = 'DONE') AS done_count
    FROM milestones m LEFT JOIN people o ON o.id = m.owner_person_id
"""
TASK_SELECT = """
    SELECT t.id, t.project_id, t.milestone_id, t.title, t.status, t.notes, t.due_date, t.assignee_person_id,
           t.version, t.updated_at, t.updated_by,
           CASE WHEN a.id IS NULL THEN NULL ELSE json_build_object('id', a.id, 'full_name', a.full_name) END AS assignee
    FROM tasks t LEFT JOIN people a ON a.id = t.assignee_person_id
"""


def get_milestone(conn: Connection, project_id: Any, milestone_id: Any, for_update: bool = False) -> dict:
    """A live milestone of the project, or 404."""
    if for_update:
        fetch_one(conn, "SELECT id FROM milestones WHERE id = %s FOR UPDATE", (milestone_id,))
    row = fetch_one(conn, MILESTONE_SELECT + " WHERE m.id = %s AND m.project_id = %s AND m.deleted_at IS NULL "
                                             "AND m.archived_at IS NULL", (milestone_id, project_id))
    if row is None:
        raise NotFound("Milestone not found.")
    return row


def get_task(conn: Connection, project_id: Any, task_id: Any, for_update: bool = False) -> dict:
    """A live task of the project, or 404."""
    if for_update:
        fetch_one(conn, "SELECT id FROM tasks WHERE id = %s FOR UPDATE", (task_id,))
    row = fetch_one(conn, TASK_SELECT + " WHERE t.id = %s AND t.project_id = %s AND t.deleted_at IS NULL "
                                        "AND t.archived_at IS NULL", (task_id, project_id))
    if row is None:
        raise NotFound("Task not found.")
    return row


def list_milestones(conn: Connection, project_id: Any) -> list[dict]:
    """Live milestones ordered by due date."""
    return fetch_all(conn, MILESTONE_SELECT + " WHERE m.project_id = %s AND m.deleted_at IS NULL AND m.archived_at IS NULL "
                                              "ORDER BY m.due_date, m.name", (project_id,))


def list_tasks(conn: Connection, project_id: Any, milestone_id: str | None = None) -> list[dict]:
    """Live tasks, optionally for one milestone."""
    sql = TASK_SELECT + " WHERE t.project_id = %s AND t.deleted_at IS NULL AND t.archived_at IS NULL"
    params: list = [project_id]
    if milestone_id:
        sql += " AND t.milestone_id = %s"
        params.append(milestone_id)
    return fetch_all(conn, sql + " ORDER BY t.due_date NULLS LAST, t.title", params)


def _check_within_project(fields: Fields, name: str, value: date | None, project: dict) -> None:
    if value is not None and not project["planned_start"] <= value <= project["planned_end"]:
        fields.add_error(name, f"Must be within the project's dates ({project['planned_start']} to {project['planned_end']}).")


def validate_milestone(conn: Connection, project: dict, body: dict, partial: bool,
                       allowed: tuple[str, ...] | None = None) -> dict[str, Any]:
    """Validate milestone fields; returns only the fields present. ``allowed`` limits proposable fields."""
    if allowed is not None:
        extra = sorted(set(body) - set(allowed))
        if extra:
            raise ValidationError("Some fields can't be proposed.", [field_error(f, "This field can't be proposed.") for f in extra])
    fields = Fields(body, partial=partial)
    values = {
        "name": fields.string("name", required=True, max_len=160),
        "due_date": fields.date("due_date", required=True),
        "status": fields.choice("status", MILESTONE_STATUSES, required=True),
        "owner_person_id": fields.uuid("owner_person_id"),
        "description": fields.string("description", max_len=4000),
        "notes": fields.string("notes", max_len=2000),
        "percent_complete": fields.integer("percent_complete", min_value=0, max_value=100),
    }
    _check_within_project(fields, "due_date", values["due_date"], project)
    if values["owner_person_id"] and not fetch_one(conn, "SELECT 1 AS x FROM people WHERE id = %s AND is_active",
                                                   (values["owner_person_id"],)):
        fields.add_error("owner_person_id", "Owner must be an existing person.")
    fields.raise_if_errors()
    return {k: v for k, v in values.items() if k in fields.present}


def validate_task(conn: Connection, project: dict, body: dict, partial: bool,
                  allowed: tuple[str, ...] | None = None) -> dict[str, Any]:
    """Validate task fields; returns only the fields present."""
    if allowed is not None:
        extra = sorted(set(body) - set(allowed))
        if extra:
            raise ValidationError("Some fields can't be proposed.", [field_error(f, "This field can't be proposed.") for f in extra])
    fields = Fields(body, partial=partial)
    values = {
        "title": fields.string("title", required=True, max_len=200),
        "milestone_id": fields.uuid("milestone_id", required=True),
        "status": fields.choice("status", TASK_STATUSES, required=True),
        "assignee_person_id": fields.uuid("assignee_person_id"),
        "due_date": fields.date("due_date"),
        "notes": fields.string("notes", max_len=2000),
    }
    _check_within_project(fields, "due_date", values["due_date"], project)
    if values["milestone_id"] and not fetch_one(conn, "SELECT 1 AS x FROM milestones WHERE id = %s AND project_id = %s "
                                                      "AND deleted_at IS NULL AND archived_at IS NULL",
                                                (values["milestone_id"], project["id"])):
        fields.add_error("milestone_id", "Milestone must belong to this project.")
    if values["assignee_person_id"] and not fetch_one(
            conn, "SELECT 1 AS x FROM allocations WHERE project_id = %s AND person_id = %s AND archived_at IS NULL",
            (project["id"], values["assignee_person_id"])):
        fields.add_error("assignee_person_id", "Assignee must be allocated to this project.")  # ASSUMPTION A3
    fields.raise_if_errors()
    return {k: v for k, v in values.items() if k in fields.present}


def normalise_milestone(changes: dict[str, Any], current: dict | None, has_tasks: bool) -> dict[str, Any]:
    """Keep status and percent complete consistent for milestones without tasks."""
    if has_tasks:
        return changes
    merged = {**(current or {}), **changes}
    if changes.get("status") == "COMPLETE" and "percent_complete" not in changes:
        changes["percent_complete"] = 100
    elif changes.get("percent_complete") == 100 and "status" not in changes:
        changes["status"] = "COMPLETE"
    elif "percent_complete" in changes and merged.get("status") == "NOT_STARTED" and (changes["percent_complete"] or 0) > 0:
        changes["status"] = "IN_PROGRESS"
    return changes


def create_milestone(conn: Connection, actor_id: str, project: dict, values: dict) -> dict:
    """Insert a milestone and audit it."""
    values = normalise_milestone(dict(values), None, has_tasks=False)
    cols = list(values) + ["project_id", "updated_by"]
    row = fetch_one(conn, f"INSERT INTO milestones ({', '.join(cols)}) VALUES ({', '.join(['%s'] * len(cols))}) RETURNING id",
                    list(values.values()) + [project["id"], actor_id])
    created = get_milestone(conn, project["id"], row["id"])
    audit.record(conn, actor_id, "milestone", created["id"], "CREATED", after=_auditable(created), project_id=project["id"])
    return created


def update_milestone(conn: Connection, actor_id: str, project: dict, before: dict, changes: dict,
                     action: str = "UPDATED") -> dict:
    """Apply changes to a milestone (caller has checked the version) and audit before/after."""
    changes = normalise_milestone(dict(changes), before, has_tasks=before["task_count"] > 0)
    _update(conn, "milestones", before["id"], changes, actor_id)
    after = get_milestone(conn, project["id"], before["id"])
    audit.record(conn, actor_id, "milestone", before["id"], action, before=_auditable(before), after=_auditable(after),
                 project_id=project["id"])
    return after


def delete_milestone(conn: Connection, actor_id: str, project: dict, before: dict) -> None:
    """Soft-delete a milestone and its tasks."""
    conn.execute("UPDATE milestones SET deleted_at = now(), version = version + 1, updated_by = %s WHERE id = %s",
                 (actor_id, before["id"]))
    conn.execute("UPDATE tasks SET deleted_at = now(), version = version + 1, updated_by = %s "
                 "WHERE milestone_id = %s AND deleted_at IS NULL", (actor_id, before["id"]))
    audit.record(conn, actor_id, "milestone", before["id"], "DELETED", before=_auditable(before), project_id=project["id"])


def create_task(conn: Connection, actor_id: str, project: dict, values: dict) -> dict:
    """Insert a task and audit it."""
    cols = list(values) + ["project_id", "updated_by"]
    row = fetch_one(conn, f"INSERT INTO tasks ({', '.join(cols)}) VALUES ({', '.join(['%s'] * len(cols))}) RETURNING id",
                    list(values.values()) + [project["id"], actor_id])
    created = get_task(conn, project["id"], row["id"])
    audit.record(conn, actor_id, "task", created["id"], "CREATED", after=_auditable(created), project_id=project["id"])
    return created


def update_task(conn: Connection, actor_id: str, project: dict, before: dict, changes: dict,
                action: str = "UPDATED") -> dict:
    """Apply changes to a task (caller has checked the version) and audit before/after."""
    _update(conn, "tasks", before["id"], changes, actor_id)
    after = get_task(conn, project["id"], before["id"])
    audit.record(conn, actor_id, "task", before["id"], action, before=_auditable(before), after=_auditable(after),
                 project_id=project["id"])
    return after


def delete_task(conn: Connection, actor_id: str, project: dict, before: dict) -> None:
    """Soft-delete a task."""
    conn.execute("UPDATE tasks SET deleted_at = now(), version = version + 1, updated_by = %s WHERE id = %s",
                 (actor_id, before["id"]))
    audit.record(conn, actor_id, "task", before["id"], "DELETED", before=_auditable(before), project_id=project["id"])


def require_version(conn: Connection, table: str, record: dict, version: int | None, noun: str) -> None:
    """409 naming who changed the record when the client's version is stale."""
    if version is not None and version == record["version"]:
        return
    who = fetch_one(conn, "SELECT display_name FROM users WHERE id = %s", (record.get("updated_by"),)) if record.get("updated_by") else None
    when = record.get("updated_at")
    raise Conflict(f"This {noun} was changed by someone else. Reload and try again.",
                   [field_error("version", f"Changed by {who['display_name'] if who else 'someone else'}"
                                           f" at {when.isoformat() if when else 'an unknown time'}.")])


def _update(conn: Connection, table: str, record_id: Any, changes: dict, actor_id: str) -> None:
    allowed = {"milestones": {"name", "due_date", "status", "owner_person_id", "description", "notes", "percent_complete"},
               "tasks": {"title", "milestone_id", "status", "assignee_person_id", "due_date", "notes"}}[table]
    columns = [c for c in changes if c in allowed]  # whitelist: column names are never taken from input
    sets = [f"{c} = %s" for c in columns] + ["version = version + 1", "updated_at = now()", "updated_by = %s"]
    conn.execute(f"UPDATE {table} SET {', '.join(sets)} WHERE id = %s",  # nosec B608 - whitelisted identifiers
                 [changes[c] for c in columns] + [actor_id, record_id])


def _auditable(record: dict) -> dict:
    return {k: v for k, v in record.items() if k not in ("updated_at", "updated_by", "task_count", "done_count", "owner", "assignee")}
