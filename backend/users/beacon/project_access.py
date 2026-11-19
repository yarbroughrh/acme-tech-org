"""Project loading and ownership checks shared by the projects and change-requests services.

"Own project" means: for a Project Manager, a project they manage; for a PM Analyst, a project
they are currently assigned to (CONFIRMED). Other roles have no ownership; their access is
ALL-or-nothing per the RBAC map.
"""

from typing import Any

from psycopg import Connection

from beacon import rbac
from beacon.auth import Principal
from beacon.db import fetch_one
from beacon.errors import Conflict, NotFound

PROJECT_COLUMNS = ("id, name, pm_user_id, department_id, planned_start, planned_end, actual_start, approved_budget, "
                   "lifecycle_status, priority, description, sponsor, archived_at, version")


def load_project(conn: Connection, project_id: str, for_update: bool = False) -> dict[str, Any]:
    """Fetch a project or raise 404."""
    row = fetch_one(conn, f"SELECT {PROJECT_COLUMNS} FROM projects WHERE id = %s{' FOR UPDATE' if for_update else ''}",
                    (project_id,))
    if row is None:
        raise NotFound("Project not found.")
    return row


def is_assigned_analyst(conn: Connection, project_id: Any, user_id: str) -> bool:
    """True if the user is currently assigned to the project as a PM Analyst."""
    return fetch_one(conn, "SELECT 1 AS x FROM project_analysts WHERE project_id = %s AND user_id = %s "
                           "AND removed_at IS NULL", (project_id, user_id)) is not None


def is_owner(conn: Connection, principal: Principal, project: dict) -> bool:
    """Ownership per role (PM manages it; analyst is assigned to it)."""
    if principal.role == rbac.PM:
        return str(project["pm_user_id"]) == principal.user_id
    if principal.role == rbac.ANALYST:
        return is_assigned_analyst(conn, project["id"], principal.user_id)
    return False


def authorize(conn: Connection, principal: Principal, action: str, project: dict, message: str | None = None) -> None:
    """403 unless the caller may perform ``action`` on this project (role, then ownership)."""
    scope = rbac.require(principal, action)
    if scope == rbac.OWN:
        rbac.require_owner(scope, is_owner(conn, principal, project),
                           message or "You can only do this on projects you manage or are assigned to.")


def ensure_not_archived(project: dict) -> None:
    """Archived projects are read-only (409)."""
    if project.get("archived_at"):
        raise Conflict("This project is archived and can no longer be changed.")


def permissions(conn: Connection, principal: Principal, project: dict) -> dict[str, bool]:
    """Ownership-aware permission hints for the UI (the API still enforces each one)."""
    owner = is_owner(conn, principal, project)
    writable = not project.get("archived_at")

    def ok(action: str) -> bool:
        return rbac.allowed(principal, action, owner)

    return {
        "can_edit": writable and ok("project.edit"),
        "can_edit_baseline": writable and ok("project.set_baseline"),
        "can_archive": writable and ok("project.archive"),
        "can_edit_plan": writable and ok("plan.edit"),
        "can_submit_status": writable and ok("status_update.submit"),
        "can_propose": writable and ok("change_request.propose"),
        "can_assign_analysts": writable and ok("analyst.assign"),
        "can_view_audit": ok("audit.read"),
        "can_record_spend": writable and ok("spend.record"),
    }
