"""Milestones and tasks: direct edits by the Portfolio Manager and the project's own PM (CONFIRMED).

PM Analysts get 403 here; they propose changes through change requests instead (CONFIRMED).
Every change recalculates health in the same transaction.
"""

from datetime import date
from typing import Any

from psycopg import Connection

from beacon import health_store, plan
from beacon import project_access as access
from beacon.auth import Principal
from beacon.health import DEFAULT_RULES, milestone_states
from beacon.validation import Fields


def _editable_project(conn: Connection, principal: Principal, project_id: str) -> dict:
    project = access.load_project(conn, project_id, for_update=True)
    access.authorize(conn, principal, "plan.edit", project, "You can only change milestones and tasks on your own projects.")
    access.ensure_not_archived(project)
    return project


def _readable_project(conn: Connection, principal: Principal, project_id: str) -> dict:
    project = access.load_project(conn, project_id)
    access.authorize(conn, principal, "project.read", project, "You can only view projects you are assigned to.")
    return project


def _decorate(conn: Connection, milestones: list[dict], project_id: str) -> list[dict]:
    """Add completion %, late and at-risk flags using the same engine helpers as health."""
    tasks = plan.list_tasks(conn, project_id)
    rules = {**DEFAULT_RULES, **health_store.load_rules(conn)}
    states = {s["id"]: s for s in milestone_states(milestones, tasks, rules, date.today())}
    for m in milestones:
        state = states[m["id"]]
        m["completion_pct"] = round(state["completion"], 1)
        m["is_late"], m["is_at_risk"] = state["is_late"], state["is_at_risk"]
        m.pop("updated_by", None)
    return milestones


def list_milestones(conn: Connection, principal: Principal, project_id: str) -> tuple[int, dict]:
    """Milestones with completion and risk state."""
    _readable_project(conn, principal, project_id)
    return 200, {"items": _decorate(conn, plan.list_milestones(conn, project_id), project_id)}


def create_milestone(conn: Connection, principal: Principal, project_id: str, body: dict) -> tuple[int, dict]:
    """Add a milestone."""
    project = _editable_project(conn, principal, project_id)
    values = plan.validate_milestone(conn, project, body, partial=False)
    milestone = plan.create_milestone(conn, principal.user_id, project, values)
    health_store.recalculate(conn, [project_id])
    return 201, {"milestone": _decorate(conn, [milestone], project_id)[0]}


def update_milestone(conn: Connection, principal: Principal, project_id: str, milestone_id: str, body: dict) -> tuple[int, dict]:
    """Edit a milestone (optimistic concurrency on ``version``)."""
    project = _editable_project(conn, principal, project_id)
    before = plan.get_milestone(conn, project_id, milestone_id, for_update=True)
    version = Fields(body).integer("version", required=True, min_value=1)
    plan.require_version(conn, "milestones", before, version, "milestone")
    changes = plan.validate_milestone(conn, project, {k: v for k, v in body.items() if k != "version"}, partial=True)
    after = plan.update_milestone(conn, principal.user_id, project, before, changes)
    health_store.recalculate(conn, [project_id])
    return 200, {"milestone": _decorate(conn, [after], project_id)[0]}


def delete_milestone(conn: Connection, principal: Principal, project_id: str, milestone_id: str) -> tuple[int, Any]:
    """Soft-delete a milestone and its tasks."""
    project = _editable_project(conn, principal, project_id)
    before = plan.get_milestone(conn, project_id, milestone_id, for_update=True)
    plan.delete_milestone(conn, principal.user_id, project, before)
    health_store.recalculate(conn, [project_id])
    return 204, None


def list_tasks(conn: Connection, principal: Principal, project_id: str, query: dict[str, str]) -> tuple[int, dict]:
    """Tasks, optionally filtered by milestone."""
    _readable_project(conn, principal, project_id)
    milestone_id = Fields(query).uuid("milestone_id")
    items = plan.list_tasks(conn, project_id, milestone_id)
    for t in items:
        t.pop("updated_by", None)
    return 200, {"items": items}


def create_task(conn: Connection, principal: Principal, project_id: str, body: dict) -> tuple[int, dict]:
    """Add a task to one of the project's milestones."""
    project = _editable_project(conn, principal, project_id)
    values = plan.validate_task(conn, project, body, partial=False)
    task = plan.create_task(conn, principal.user_id, project, values)
    health_store.recalculate(conn, [project_id])
    task.pop("updated_by", None)
    return 201, {"task": task}


def update_task(conn: Connection, principal: Principal, project_id: str, task_id: str, body: dict) -> tuple[int, dict]:
    """Edit a task (optimistic concurrency on ``version``)."""
    project = _editable_project(conn, principal, project_id)
    before = plan.get_task(conn, project_id, task_id, for_update=True)
    version = Fields(body).integer("version", required=True, min_value=1)
    plan.require_version(conn, "tasks", before, version, "task")
    changes = plan.validate_task(conn, project, {k: v for k, v in body.items() if k != "version"}, partial=True)
    after = plan.update_task(conn, principal.user_id, project, before, changes)
    health_store.recalculate(conn, [project_id])
    after.pop("updated_by", None)
    return 200, {"task": after}


def delete_task(conn: Connection, principal: Principal, project_id: str, task_id: str) -> tuple[int, Any]:
    """Soft-delete a task."""
    project = _editable_project(conn, principal, project_id)
    before = plan.get_task(conn, project_id, task_id, for_update=True)
    plan.delete_task(conn, principal.user_id, project, before)
    health_store.recalculate(conn, [project_id])
    return 204, None
