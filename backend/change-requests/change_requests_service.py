"""Change-request decisions (CONFIRMED by the stakeholder).

- Only the project's own Project Manager approves or rejects; a rejection needs a reason.
- Approval re-checks the target record: if it changed since the proposal (version differs) or no
  longer exists, the approval is refused with 409 and nothing is applied.
- Approval applies the change with the same validation as a direct edit, writes the audit log
  and recalculates health, all in ONE transaction. Pending proposals never affect health.
"""

from datetime import date
from typing import Any

from psycopg import Connection

import change_requests_repository as repo
from beacon import audit, health_store, plan, rbac
from beacon import project_access as access
from beacon.auth import Principal
from beacon.errors import Conflict, Forbidden, NotFound, ValidationError, field_error
from beacon.http import page_params, paged
from beacon.validation import Fields

STATUSES = ("PENDING", "APPROVED", "REJECTED")


def _present(row: dict) -> dict[str, Any]:
    """Public shape: adds the current values of the proposed fields for side-by-side display."""
    entity = row.pop("entity") or {}
    row["current"] = {k: entity.get(k) for k in row["changes"]}
    for key in ("pm_user_id", "proposer_user_id", "base_version"):
        row.pop(key, None)
    return row


def list_requests(conn: Connection, principal: Principal, query: dict[str, str]) -> tuple[int, dict]:
    """``view=approvals`` (PM: their projects; PMO: all) or ``view=mine`` (the analyst's own)."""
    scope = rbac.require(principal, "change_request.read")
    default_view = "mine" if principal.role == rbac.ANALYST else "approvals"
    view = query.get("view") or default_view
    status = query.get("status") or None
    errors = []
    if view not in ("approvals", "mine"):
        errors.append(field_error("view", "view must be approvals or mine."))
    if status and status not in STATUSES:
        errors.append(field_error("status", f"status must be one of: {', '.join(STATUSES)}."))
    if errors:
        raise ValidationError("Invalid query parameters.", errors)
    limit, offset, _ = page_params(query, {"created_at": "created_at"}, "created_at")
    where, params = [], []
    if view == "mine":
        where.append("cr.proposer_user_id = %s")
        params.append(principal.user_id)
    else:
        if principal.role == rbac.ANALYST:
            raise Forbidden("Only Project Managers review approvals.")
        if scope == rbac.OWN:
            where.append("p.pm_user_id = %s")
            params.append(principal.user_id)
    if status:
        where.append("cr.status = %s")
        params.append(status)
    # Approvals: oldest first (first come, first decided). My proposals: newest first.
    order = "created_at ASC" if view == "approvals" else "created_at DESC"
    items, total = repo.list_requests(conn, where, params, order, limit, offset)
    return 200, paged([_present(i) for i in items], total, query)


def _decidable(conn: Connection, principal: Principal, request_id: str) -> tuple[dict, dict]:
    rbac.require(principal, "change_request.decide")
    request = repo.get_request(conn, request_id, for_update=True)
    if request is None:
        raise NotFound("Change request not found.")
    project = access.load_project(conn, request["project_id"], for_update=True)
    if str(project["pm_user_id"]) != principal.user_id:
        raise Forbidden("Only this project's Project Manager can approve or reject its change requests.")
    if request["status"] != "PENDING":
        raise Conflict(f"This change request was already {request['status'].lower()}.")
    access.ensure_not_archived(project)
    return request, project


def approve(conn: Connection, principal: Principal, request_id: str) -> tuple[int, dict]:
    """Apply the proposal if the record is unchanged since it was proposed; audit; recalculate health."""
    request, project = _decidable(conn, principal, request_id)
    entity_type, changes = request["entity_type"], dict(request["changes"])
    try:
        if entity_type == "MILESTONE":
            before = plan.get_milestone(conn, project["id"], request["entity_id"], for_update=True)
        else:
            before = plan.get_task(conn, project["id"], request["entity_id"], for_update=True)
    except NotFound as exc:
        raise Conflict("The record in this proposal no longer exists. Reject it instead.") from exc
    if before["version"] != request["base_version"]:
        raise Conflict("The record has changed since this proposal was made, so it can't be approved as is. "
                       "Reject it and ask the analyst to propose again.",
                       [field_error("version", f"Proposed against version {request['base_version']}; "
                                               f"current version is {before['version']}.")])
    allowed = plan.PROPOSABLE[entity_type]
    if entity_type == "MILESTONE":
        values = plan.validate_milestone(conn, project, changes, partial=True, allowed=allowed)
        plan.update_milestone(conn, principal.user_id, project, before, values, action="UPDATED_BY_APPROVAL")
    else:
        values = plan.validate_task(conn, project, changes, partial=True, allowed=allowed)
        plan.update_task(conn, principal.user_id, project, before, values, action="UPDATED_BY_APPROVAL")
    repo.decide(conn, request_id, "APPROVED", principal.user_id, None)
    audit.record(conn, principal.user_id, "change_request", request_id, "APPROVED",
                 before={"status": "PENDING"},
                 after={"status": "APPROVED", "proposer": request["proposer"]["display_name"],
                        "entity_type": entity_type, "entity_id": str(request["entity_id"]), "changes": changes},
                 project_id=project["id"])
    health_store.recalculate(conn, [project["id"]], date.today())
    return 200, {"change_request": _present(repo.get_request(conn, request_id))}


def reject(conn: Connection, principal: Principal, request_id: str, body: dict) -> tuple[int, dict]:
    """Reject with a mandatory reason. Nothing is applied."""
    request, project = _decidable(conn, principal, request_id)  # authorise before validating the body
    fields = Fields(body)
    reason = fields.string("reason", required=True, max_len=1000)
    fields.raise_if_errors("A reason is required to reject a change request.")
    repo.decide(conn, request_id, "REJECTED", principal.user_id, reason)
    audit.record(conn, principal.user_id, "change_request", request_id, "REJECTED",
                 before={"status": "PENDING"}, after={"status": "REJECTED", "reason": reason},
                 project_id=project["id"])
    return 200, {"change_request": _present(repo.get_request(conn, request_id))}
