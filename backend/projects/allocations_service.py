"""Allocation rules (CONFIRMED by the stakeholder, 2026-11-19):

- Hours per week per person per project, with start and end dates within the project's dates.
- No hard block on load: above 40 h/week across all projects → Amber "Over-allocated" warning;
  above 60 h/week → saved with a Red "Severely over-allocated" warning (and the person appears in
  Needs attention). Input is limited to 0.5–168 h per allocation (data validation only).
- Closed, Cancelled and archived projects are rejected (409); On hold is allowed with a warning.
- PMO allocates on any project, PMs on their own (RBAC ``allocation.edit``).
"""

from decimal import Decimal
from typing import Any

from psycopg import Connection

import allocations_repository as repo
from beacon import audit, health_store
from beacon import project_access as access
from beacon.auth import Principal
from beacon.errors import Conflict, NotFound
from beacon.plan import require_version
from beacon.validation import Fields

CLOSED_STATES = ("CLOSED", "CANCELLED")


def load_status(total: float, rules: dict) -> str:
    """UNDER (< 40), OK (= 40), OVER (> 40), SEVERE (> 60), using the configured thresholds."""
    standard, severe = rules.get("allocation_standard_hours", 40.0), rules.get("allocation_severe_hours", 60.0)
    if total > severe:
        return "SEVERE"
    if total > standard:
        return "OVER"
    return "OK" if total == standard else "UNDER"


def _rules(conn: Connection) -> dict:
    return {"allocation_standard_hours": 40.0, "allocation_severe_hours": 60.0, **health_store.load_rules(conn)}


def _warnings(total: float, project: dict, rules: dict, person: str) -> list[dict]:
    warnings = []
    status = load_status(total, rules)
    if status == "SEVERE":
        warnings.append({"code": "SEVERELY_OVER_ALLOCATED", "severity": "RED",
                         "message": f"Saved. {person} is now severely over-allocated: {total:g} h/week across projects "
                                    f"(over {rules['allocation_severe_hours']:g} h)."})
    elif status == "OVER":
        warnings.append({"code": "OVER_ALLOCATED", "severity": "AMBER",
                         "message": f"Saved. {person} is over-allocated: {total:g} h/week across projects "
                                    f"(over {rules['allocation_standard_hours']:g} h)."})
    if project["lifecycle_status"] == "ON_HOLD":
        warnings.append({"code": "PROJECT_ON_HOLD", "severity": "INFO",
                         "message": "This project is on hold; the allocation was saved."})
    return warnings


def _decorate(conn: Connection, allocation: dict, rules: dict) -> dict:
    total = repo.person_total(conn, allocation["person_id"], allocation["start_date"], allocation["end_date"])
    allocation["person_total_hours"] = total
    allocation["load_status"] = load_status(total, rules)
    allocation.pop("updated_by", None)
    return allocation


def _writable_project(conn: Connection, principal: Principal, project_id: str) -> dict:
    project = access.load_project(conn, project_id, for_update=True)
    access.authorize(conn, principal, "allocation.edit", project, "You can only allocate people to your own projects.")
    if project.get("archived_at") or project["lifecycle_status"] in CLOSED_STATES:
        raise Conflict("People can't be allocated to a Closed, Cancelled or archived project.")
    return project


def _validate(fields: Fields, project: dict, current: dict | None) -> dict[str, Any]:
    values = {
        "hours_per_week": fields.decimal("hours_per_week", required=True, ge=Decimal("0.5"), le=Decimal("168")),
        "start_date": fields.date("start_date", required=True),
        "end_date": fields.date("end_date", required=True),
    }
    merged = {**(current or {}), **{k: v for k, v in values.items() if v is not None}}
    for name in ("start_date", "end_date"):
        value = values[name]
        if value is not None and not project["planned_start"] <= value <= project["planned_end"]:
            fields.add_error(name, f"Must be within the project's dates ({project['planned_start']} to {project['planned_end']}).")
    if merged.get("start_date") and merged.get("end_date") and merged["end_date"] < merged["start_date"]:
        fields.add_error("end_date", "End date must be on or after the start date.")
    return {k: v for k, v in values.items() if k in fields.present}


def list_allocations(conn: Connection, principal: Principal, project_id: str) -> tuple[int, dict]:
    """Allocations on the project with each person's total load."""
    project = access.load_project(conn, project_id)
    access.authorize(conn, principal, "project.read", project)
    rules = _rules(conn)
    return 200, {"items": [_decorate(conn, a, rules) for a in repo.list_for_project(conn, project_id)]}


def create_allocation(conn: Connection, principal: Principal, project_id: str, body: dict) -> tuple[int, dict]:
    """Allocate a person; always saves (no hard block), returning load warnings."""
    project = _writable_project(conn, principal, project_id)
    fields = Fields(body)
    person_id = fields.uuid("person_id", required=True)
    values = _validate(fields, project, None)
    if person_id and not repo.person_exists(conn, person_id):
        fields.add_error("person_id", "Person must exist.")
    fields.raise_if_errors()
    allocation_id = repo.insert(conn, principal.user_id, project_id, {**values, "person_id": person_id})
    allocation = repo.get(conn, project_id, allocation_id)
    audit.record(conn, principal.user_id, "allocation", allocation_id, "CREATED",
                 after={"person_id": person_id, **values}, project_id=project_id)
    rules = _rules(conn)
    allocation = _decorate(conn, allocation, rules)
    return 201, {"allocation": allocation,
                 "warnings": _warnings(allocation["person_total_hours"], project, rules, allocation["person"]["full_name"])}


def update_allocation(conn: Connection, principal: Principal, project_id: str, allocation_id: str,
                      body: dict) -> tuple[int, dict]:
    """Change hours or dates (optimistic concurrency on ``version``)."""
    project = _writable_project(conn, principal, project_id)
    before = repo.get(conn, project_id, allocation_id, for_update=True)
    if before is None:
        raise NotFound("Allocation not found.")
    fields = Fields(body, partial=True)
    version = fields.integer("version", required=True, min_value=1)
    changes = _validate(fields, project, before)
    fields.raise_if_errors()
    require_version(conn, "allocations", before, version, "allocation")
    repo.update(conn, principal.user_id, allocation_id, changes)
    audit.record(conn, principal.user_id, "allocation", allocation_id, "UPDATED",
                 before={k: before[k] for k in changes}, after=changes, project_id=project_id)
    rules = _rules(conn)
    after = _decorate(conn, repo.get(conn, project_id, allocation_id), rules)
    return 200, {"allocation": after,
                 "warnings": _warnings(after["person_total_hours"], project, rules, after["person"]["full_name"])}


def remove_allocation(conn: Connection, principal: Principal, project_id: str, allocation_id: str) -> tuple[int, Any]:
    """Archive an allocation."""
    project = access.load_project(conn, project_id, for_update=True)
    access.authorize(conn, principal, "allocation.edit", project, "You can only change allocations on your own projects.")
    before = repo.get(conn, project_id, allocation_id, for_update=True)
    if before is None:
        raise NotFound("Allocation not found.")
    repo.archive(conn, principal.user_id, allocation_id)
    audit.record(conn, principal.user_id, "allocation", allocation_id, "ARCHIVED",
                 before={"hours_per_week": before["hours_per_week"]}, project_id=project_id)
    return 204, None
