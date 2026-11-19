"""Project rules: portfolio list, detail, create, update, archive, cancel, team, audit.

- Only the Portfolio Manager creates projects, sets baselines, assigns PMs, archives and cancels
  (CONFIRMED). PMs edit their own projects but not baseline dates or approved budget (ASSUMPTION R5).
- PM Analysts see only projects they are assigned to (CONFIRMED) and never edit directly.
- Health is recalculated in the same transaction as any change to its inputs.
"""

import uuid
from decimal import Decimal
from typing import Any

from psycopg import Connection

import projects_repository as repo
from beacon import audit, health_store, rbac
from beacon import project_access as access
from beacon.auth import Principal
from beacon.errors import Conflict, Forbidden, NotFound, ValidationError, field_error
from beacon.http import page_params, paged
from beacon.plan import require_version
from beacon.validation import Fields

LIFECYCLE = ("PROPOSED", "ACTIVE", "ON_HOLD", "CLOSED", "CANCELLED")
PRIORITY = ("LOW", "MEDIUM", "HIGH")
HEALTH = ("GREEN", "AMBER", "RED", "NONE")
BASELINE_FIELDS = ("planned_start", "planned_end", "approved_budget")


def _multi(query: dict[str, str], name: str, allowed: tuple[str, ...] | None, errors: list) -> list[str] | None:
    """Parse a comma-separated filter, validating each value."""
    raw = (query.get(name) or "").strip()
    if not raw:
        return None
    values = [v.strip() for v in raw.split(",") if v.strip()]
    for value in values:
        if allowed is not None and value not in allowed:
            errors.append(field_error(name, f"{name} must be one of: {', '.join(allowed)}."))
            return None
        if allowed is None:
            try:
                uuid.UUID(value)
            except ValueError:
                errors.append(field_error(name, f"{name} contains an invalid id."))
                return None
    return values


def list_projects(conn: Connection, principal: Principal, query: dict[str, str]) -> tuple[int, dict]:
    """Server-side search, filter, sort and pagination over the portfolio."""
    rbac.require(principal, "project.read")  # analysts (OWN) are limited to assigned projects below
    limit, offset, order_by = page_params(query, repo.SORTS, "name")
    errors: list = []
    mine = query.get("mine") == "true"
    filters = {
        "q": (query.get("q") or "").strip()[:120] or None,
        "department_id": _multi(query, "department_id", None, errors),
        "pm_user_id": _multi(query, "pm_user_id", None, errors),
        "lifecycle_status": _multi(query, "lifecycle_status", LIFECYCLE, errors),
        "priority": _multi(query, "priority", PRIORITY, errors),
        "health": _multi(query, "health", HEALTH, errors),
        "include_archived": query.get("include_archived") == "true",
        # Analysts only ever see assigned projects; "mine" narrows PMs to projects they manage.
        "assigned_to": principal.user_id if principal.role == rbac.ANALYST else None,
        "managed_by": principal.user_id if (mine and principal.role == rbac.PM) else None,
    }
    if errors:
        raise ValidationError("Invalid query parameters.", errors)
    health_store.refresh_stale(conn)
    items, total = repo.list_projects(conn, filters, limit, offset, order_by)
    return 200, paged(items, total, query)


def detail(conn: Connection, principal: Principal, project_id: Any) -> dict:
    """Project detail with health and ownership-aware permissions."""
    project = repo.get_project(conn, project_id)
    if project is None:
        raise NotFound("Project not found.")
    project["permissions"] = access.permissions(conn, principal, project)
    project.pop("updated_by", None)
    return project


def get_project(conn: Connection, principal: Principal, project_id: str) -> tuple[int, dict]:
    """One project's details."""
    project = access.load_project(conn, project_id)
    access.authorize(conn, principal, "project.read", project, "You can only view projects you are assigned to.")
    health_store.refresh_stale(conn, project_ids=[project_id])
    return 200, {"project": detail(conn, principal, project_id)}


def lookups(conn: Connection, principal: Principal) -> tuple[int, dict]:
    """Departments, project managers and analysts for filters and forms."""
    rbac.require(principal, "project.read")
    return 200, repo.lookups(conn)


def _validate(conn: Connection, body: dict, partial: bool, current: dict | None = None) -> dict[str, Any]:
    fields = Fields(body, partial=partial)
    values = {
        "name": fields.string("name", required=True, min_len=3, max_len=120),
        "department_id": fields.uuid("department_id", required=True),
        "pm_user_id": fields.uuid("pm_user_id", required=True),
        "planned_start": fields.date("planned_start", required=True),
        "planned_end": fields.date("planned_end", required=True),
        "approved_budget": fields.decimal("approved_budget", required=True, gt=Decimal(0), le=Decimal("999999999999")),
        "lifecycle_status": fields.choice("lifecycle_status", LIFECYCLE, required=True),
        "priority": fields.choice("priority", PRIORITY),
        "description": fields.string("description", max_len=4000),
        "sponsor": fields.string("sponsor", max_len=120),
        "actual_start": fields.date("actual_start"),
    }
    present = {k: v for k, v in values.items() if k in fields.present}
    merged = {**(current or {}), **present}
    if merged.get("planned_start") and merged.get("planned_end") and merged["planned_end"] <= merged["planned_start"]:
        fields.add_error("planned_end", "Planned end must be after the planned start.")
    if present.get("name") and repo.name_taken(conn, present["name"], (current or {}).get("id")):
        fields.add_error("name", "Another project already uses this name.")
    if present.get("department_id") and not repo.department_exists(conn, present["department_id"]):
        fields.add_error("department_id", "Department does not exist.")
    if present.get("pm_user_id") and not repo.is_active_pm(conn, present["pm_user_id"]):
        fields.add_error("pm_user_id", "Project manager must be an active user with the Project Manager role.")
    fields.raise_if_errors()
    if not partial and "priority" not in present:
        present["priority"] = "MEDIUM"
    return present


def create_project(conn: Connection, principal: Principal, body: dict) -> tuple[int, dict]:
    """Portfolio Manager creates a project and assigns its PM."""
    rbac.require(principal, "project.create")
    values = _validate(conn, body, partial=False)
    project_id = repo.insert_project(conn, principal.user_id, values)
    audit.record(conn, principal.user_id, "project", project_id, "CREATED", after=values, project_id=project_id)
    health_store.recalculate(conn, [project_id])
    return 201, {"project": detail(conn, principal, project_id)}


def update_project(conn: Connection, principal: Principal, project_id: str, body: dict) -> tuple[int, dict]:
    """Edit details; baselines and PM assignment are Portfolio Manager only."""
    current = access.load_project(conn, project_id, for_update=True)
    access.authorize(conn, principal, "project.edit", current)
    access.ensure_not_archived(current)
    version = Fields(body).integer("version", required=True, min_value=1)
    if version is None:
        raise ValidationError("Please correct the highlighted fields.", [field_error("version", "Version is required.")])
    changes = _validate(conn, {k: v for k, v in body.items() if k != "version"}, partial=True, current=current)
    changes = {k: v for k, v in changes.items() if v != current.get(k)}
    if any(f in changes for f in BASELINE_FIELDS) and rbac.scope_for(principal, "project.set_baseline") is None:
        raise Forbidden("Only the Portfolio Manager can change baseline dates and the approved budget.")
    if "pm_user_id" in changes and rbac.scope_for(principal, "project.assign_pm") is None:
        raise Forbidden("Only the Portfolio Manager can assign the project manager.")
    if "department_id" in changes and rbac.scope_for(principal, "project.set_baseline") is None:
        raise Forbidden("Only the Portfolio Manager can move a project to another department.")
    if changes.get("lifecycle_status") == "CANCELLED":
        raise ValidationError("Use Cancel project to cancel.", [field_error("lifecycle_status", "Use the cancel action.")])
    full = repo.get_project(conn, project_id)
    require_version(conn, "projects", full, version, "project")
    if changes:
        repo.update_project(conn, principal.user_id, project_id, changes)
        audit.record(conn, principal.user_id, "project", project_id, "UPDATED",
                     before={k: current.get(k) for k in changes}, after=changes, project_id=project_id)
        health_store.recalculate(conn, [project_id])
    return 200, {"project": detail(conn, principal, project_id)}


def archive_project(conn: Connection, principal: Principal, project_id: str, body: dict) -> tuple[int, dict]:
    """Archive a project and cascade to milestones, tasks and allocations (nothing is deleted)."""
    rbac.require(principal, "project.archive")
    current = access.load_project(conn, project_id, for_update=True)
    access.ensure_not_archived(current)
    version = Fields(body).integer("version", required=True, min_value=1)
    require_version(conn, "projects", repo.get_project(conn, project_id), version, "project")
    counts = repo.archive_cascade(conn, principal.user_id, project_id)
    audit.record(conn, principal.user_id, "project", project_id, "ARCHIVED", after={"archived": True, **counts},
                 project_id=project_id)
    return 200, {"project": detail(conn, principal, project_id)}


def cancel_project(conn: Connection, principal: Principal, project_id: str, body: dict) -> tuple[int, dict]:
    """Cancel a project (lifecycle CANCELLED); open proposals are closed."""
    rbac.require(principal, "project.archive")
    current = access.load_project(conn, project_id, for_update=True)
    access.ensure_not_archived(current)
    fields = Fields(body)
    version = fields.integer("version", required=True, min_value=1)
    reason = fields.string("reason", max_len=1000)
    fields.raise_if_errors()
    if current["lifecycle_status"] == "CANCELLED":
        raise Conflict("This project is already cancelled.")
    require_version(conn, "projects", repo.get_project(conn, project_id), version, "project")
    repo.update_project(conn, principal.user_id, project_id, {"lifecycle_status": "CANCELLED"})
    rejected = repo.reject_pending(conn, principal.user_id, project_id, "Project cancelled.")
    audit.record(conn, principal.user_id, "project", project_id, "CANCELLED",
                 before={"lifecycle_status": current["lifecycle_status"]},
                 after={"lifecycle_status": "CANCELLED", "reason": reason, "change_requests_rejected": rejected},
                 project_id=project_id)
    health_store.recalculate(conn, [project_id])
    return 200, {"project": detail(conn, principal, project_id)}


def team(conn: Connection, principal: Principal, project_id: str) -> tuple[int, dict]:
    """People allocated to the project."""
    project = access.load_project(conn, project_id)
    access.authorize(conn, principal, "project.read", project)
    return 200, {"items": repo.team(conn, project_id)}


def audit_trail(conn: Connection, principal: Principal, project_id: str, query: dict[str, str]) -> tuple[int, dict]:
    """The project's audit log (Admin, PMO, and the project's own PM)."""
    project = access.load_project(conn, project_id)
    access.authorize(conn, principal, "audit.read", project, "You can only view the audit log of your own projects.")
    limit, offset, _ = page_params(query, {"at": "a.at"}, "-at")
    items, total = repo.audit_page(conn, project_id, limit, offset)
    return 200, paged(items, total, query)
