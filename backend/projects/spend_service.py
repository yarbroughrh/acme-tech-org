"""Weekly spend (CONFIRMED by the stakeholder, 2026-11-19).

- Recorded WEEKLY by the Portfolio Manager only (RBAC ``spend.record``; PMs get 403).
- week_starting must be a Monday (other days rejected with a clear message), not a future week, and within
  the project's planned dates (the week containing the planned start is allowed).
- One entry per project, week and category: saving the same combination again UPDATES the existing entry
  (returns 200, created=false); every create/update is audited with before/after values.
- Budget health recalculates in the same transaction (actual to date = sum of weekly entries to date).
"""

from datetime import date, timedelta
from decimal import Decimal

from psycopg import Connection

import spend_repository as repo
from beacon import audit, health_store
from beacon import project_access as access
from beacon.auth import Principal
from beacon.validation import Fields

CATEGORIES = ("LABOUR", "CONTRACTORS_VENDORS", "SOFTWARE_LICENCES", "HARDWARE_INFRA", "OTHER")


def _monday(day: date) -> date:
    return day - timedelta(days=day.weekday())


def list_spend(conn: Connection, principal: Principal, project_id: str) -> tuple[int, dict]:
    """Weekly entries and totals (anyone who can view the project)."""
    project = access.load_project(conn, project_id)
    access.authorize(conn, principal, "project.read", project)
    health_store.refresh_stale(conn, project_ids=[project_id])
    t = repo.totals(conn, project_id)
    return 200, {"items": repo.list_for_project(conn, project_id),
                 "totals": {"approved_budget": t["approved_budget"], "spend_to_date": t["spend_to_date"] or 0,
                            "planned_to_date": t["planned_to_date"] or 0}}


def save_spend(conn: Connection, principal: Principal, project_id: str, body: dict, today: date | None = None) -> tuple[int, dict]:
    """Record (or update) the weekly entry for a project, week and category."""
    today = today or date.today()
    project = access.load_project(conn, project_id, for_update=True)
    access.authorize(conn, principal, "spend.record", project, "Only the Portfolio Manager records actual spend.")
    access.ensure_not_archived(project)
    fields = Fields(body)
    week = fields.date("week_starting", required=True)
    category = fields.choice("category", CATEGORIES, required=True)
    amount = fields.decimal("amount", required=True, gt=Decimal(0), le=Decimal("999999999999"))
    note = fields.string("note", max_len=500)
    if week is not None:
        if week.weekday() != 0:
            fields.add_error("week_starting", "Week starting must be a Monday.")
        elif week > _monday(today):
            fields.add_error("week_starting", "Week starting can't be in the future.")
        elif week < _monday(project["planned_start"]) or week > project["planned_end"]:
            fields.add_error("week_starting", f"Must be within the project's dates ({project['planned_start']} to "
                                              f"{project['planned_end']}).")
    fields.raise_if_errors()
    existing = repo.find_live(conn, project_id, week, category)
    if existing:
        repo.update(conn, principal.user_id, existing["id"], amount, note)
        audit.record(conn, principal.user_id, "spend_entry", existing["id"], "UPDATED",
                     before={"amount": existing["amount"], "note": existing["note"]}, after={"amount": amount, "note": note},
                     project_id=project_id)
        entry_id, status, created = existing["id"], 200, False
    else:
        entry_id = repo.insert(conn, principal.user_id, project_id,
                               {"week_starting": week, "category": category, "amount": amount, "note": note})
        audit.record(conn, principal.user_id, "spend_entry", entry_id, "CREATED",
                     after={"week_starting": week, "category": category, "amount": amount, "note": note}, project_id=project_id)
        status, created = 201, True
    health_store.recalculate(conn, [project_id], today)
    return status, {"entry": repo.get(conn, entry_id), "created": created}


