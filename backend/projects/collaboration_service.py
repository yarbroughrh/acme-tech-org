"""Weekly status updates, analyst assignments and change-request proposals.

- PMs submit at least weekly status updates on their own projects (CONFIRMED). The reported status
  never changes health; it can only raise the Status mismatch flag.
- The project's PM (and the PMO) assign PM Analysts to the project (ASSUMPTION A4).
- PM Analysts propose changes to milestones and tasks on assigned projects (CONFIRMED). Proposals
  are stored as PENDING and change nothing until the PM approves them.
"""

import json
from typing import Any

from psycopg import Connection

import projects_repository as repo
from beacon import audit, health_store, plan
from beacon import project_access as access
from beacon.auth import Principal
from beacon.errors import Conflict, NotFound, ValidationError, field_error
from beacon.http import json_default
from beacon.validation import Fields
from projects_service import detail


def list_status_updates(conn: Connection, principal: Principal, project_id: str) -> tuple[int, dict]:
    """Status update history."""
    project = access.load_project(conn, project_id)
    access.authorize(conn, principal, "project.read", project)
    return 200, {"items": repo.status_updates(conn, project_id)}


def submit_status_update(conn: Connection, principal: Principal, project_id: str, body: dict) -> tuple[int, dict]:
    """The project's PM records the status they believe the project is in, with a summary."""
    project = access.load_project(conn, project_id, for_update=True)
    access.authorize(conn, principal, "status_update.submit", project, "Only this project's PM can submit its status update.")
    access.ensure_not_archived(project)
    fields = Fields(body)
    reported = fields.choice("reported_status", ("GREEN", "AMBER", "RED"), required=True)
    summary = fields.string("summary", required=True, max_len=4000)
    fields.raise_if_errors()
    update = repo.insert_status_update(conn, principal.user_id, project_id, reported, summary)
    audit.record(conn, principal.user_id, "status_update", update["id"], "CREATED",
                 after={"reported_status": reported, "summary": summary}, project_id=project_id)
    health_store.recalculate(conn, [project_id])
    return 201, {"status_update": update, "project": detail(conn, principal, project_id)}


def list_analysts(conn: Connection, principal: Principal, project_id: str) -> tuple[int, dict]:
    """Analysts assigned to the project."""
    project = access.load_project(conn, project_id)
    access.authorize(conn, principal, "project.read", project)
    return 200, {"items": repo.analysts(conn, project_id)}


def assign_analyst(conn: Connection, principal: Principal, project_id: str, body: dict) -> tuple[int, dict]:
    """Assign a PM Analyst to the project."""
    project = access.load_project(conn, project_id, for_update=True)
    access.authorize(conn, principal, "analyst.assign", project, "You can only assign analysts to your own projects.")
    access.ensure_not_archived(project)
    fields = Fields(body)
    user_id = fields.uuid("user_id", required=True)
    fields.raise_if_errors()
    if not repo.is_active_analyst(conn, user_id):
        raise ValidationError("Please correct the highlighted fields.", [field_error("user_id", "Must be an active PM Analyst.")])
    if access.is_assigned_analyst(conn, project_id, user_id):
        raise Conflict("This analyst is already assigned to the project.")
    repo.assign_analyst(conn, principal.user_id, project_id, user_id)
    audit.record(conn, principal.user_id, "project_analyst", user_id, "ASSIGNED", after={"user_id": user_id},
                 project_id=project_id)
    analyst = next(a for a in repo.analysts(conn, project_id) if str(a["user_id"]) == user_id)
    return 201, {"analyst": analyst}


def remove_analyst(conn: Connection, principal: Principal, project_id: str, user_id: str) -> tuple[int, Any]:
    """Remove an analyst from the project (history kept)."""
    project = access.load_project(conn, project_id, for_update=True)
    access.authorize(conn, principal, "analyst.assign", project, "You can only change analysts on your own projects.")
    if repo.remove_analyst(conn, project_id, user_id) == 0:
        raise NotFound("That analyst is not assigned to this project.")
    audit.record(conn, principal.user_id, "project_analyst", user_id, "REMOVED", before={"user_id": user_id},
                 project_id=project_id)
    return 204, None


def propose_change(conn: Connection, principal: Principal, project_id: str, body: dict) -> tuple[int, dict]:
    """A PM Analyst proposes changes to a milestone or task. Nothing is applied until approved."""
    project = access.load_project(conn, project_id)
    access.authorize(conn, principal, "change_request.propose", project,
                     "You can only propose changes on projects you are assigned to.")
    access.ensure_not_archived(project)
    fields = Fields(body)
    entity_type = fields.choice("entity_type", tuple(plan.PROPOSABLE), required=True)
    entity_id = fields.uuid("entity_id", required=True)
    note = fields.string("note", max_len=1000)
    changes = body.get("changes")
    if not isinstance(changes, dict) or not changes:
        fields.add_error("changes", "Propose at least one change.")
    fields.raise_if_errors()
    allowed = plan.PROPOSABLE[entity_type]
    if entity_type == "MILESTONE":
        entity = plan.get_milestone(conn, project_id, entity_id)
        values = plan.validate_milestone(conn, project, changes, partial=True, allowed=allowed)
    else:
        entity = plan.get_task(conn, project_id, entity_id)
        values = plan.validate_task(conn, project, changes, partial=True, allowed=allowed)
    effective = {k: v for k, v in values.items() if v != entity.get(k)}
    if not effective:
        raise ValidationError("Nothing would change: the proposed values match the current ones.",
                              [field_error("changes", "Change at least one value.")])
    request = repo.insert_change_request(conn, project_id, principal.user_id, entity_type, entity_id, entity["version"],
                                         json.dumps(effective, default=json_default), note)
    audit.record(conn, principal.user_id, "change_request", request["id"], "PROPOSED",
                 after={"entity_type": entity_type, "entity_id": entity_id, "changes": effective}, project_id=project_id)
    return 201, {"change_request": request}
