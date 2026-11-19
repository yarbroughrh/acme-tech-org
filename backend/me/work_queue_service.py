""""Your next actions": what needs the signed-in user's attention, ranked, each with one action.

Sources per role (scope comes from the RBAC map and ownership rules):
- PM (own projects): Red; status mismatch; update overdue / due within 2 days; milestones late or
  at risk; change requests waiting; people on their projects over 40 h.
- PM Analyst: own rejected proposals (rework); milestones late/at risk on assigned projects; own
  tasks late or due this week; own pending proposals (informational).
- PMO: Red; status mismatch; people over 60 h; no update for 14+ days; Active projects missing last
  week's spend (1 week High, 2+ Critical); Proposed past planned start; Active with no allocations.
- Executive: Red projects (turned Red in the last 7 days called out); status mismatch.
- Admin: locked accounts; temporary passwords; role changes in the last 7 days.
Health colours/flags are read from the stored health-engine result (never recalculated here) and
only Active projects carry health items.
"""

from datetime import date, datetime, timedelta, timezone
from typing import Any

from psycopg import Connection

import work_queue_repository as repo
from beacon import health_store, rbac
from beacon.auth import Principal
from beacon.health import DEFAULT_RULES, milestone_states
from work_queue_ranking import rank_work_items

MAX_ITEMS = 50
CRITICAL_UPDATE_DAYS = 14  # "no update for 14+ days" is critical (ASSUMPTION: read as days since the last update)
CRITICAL_LATE_DAYS = 14    # "milestone 14+ days late" is critical


def _monday(day: date) -> date:
    return day - timedelta(days=day.weekday())


def _day(value: Any) -> date | None:
    if value is None:
        return None
    return value.date() if isinstance(value, datetime) else value


def _item(type_: str, severity: str, title: str, reason: str, label: str, route: str, *, entity: Any,
          project: dict | None = None, due_date: date | None = None, waiting_since: Any = None, days_overdue: int = 0,
          waiting_days: int | None = None, due_in_days: int | None = None, event_at: Any = None,
          approval: dict | None = None) -> dict[str, Any]:
    return {
        "id": f"{type_}:{entity}", "type": type_, "severity": severity, "title": title, "reason": reason,
        "project": {"id": project["id"], "name": project["name"]} if project else None,
        "due_date": due_date, "waiting_since": waiting_since, "days_overdue": max(days_overdue, 0),
        "waiting_days": waiting_days, "due_in_days": due_in_days, "action": {"label": label, "route": route},
        "approval": approval, "priority": project.get("priority") if project else None,
        "budget": project.get("approved_budget") if project else None, "event_at": event_at,
    }


def _first_reason(project: dict) -> str:
    reasons = project.get("reasons") or []
    return reasons[0] if reasons else "Calculated health is Red."


def _health_items(projects: list[dict], role: str, today: date, turned_red: set) -> list[dict]:
    items = []
    for p in projects:
        if p["lifecycle_status"] != "ACTIVE":
            continue  # health colours apply to Active projects only (CONFIRMED)
        route = f"/portfolio/{p['id']}?tab=overview"
        if p["health_overall"] == "RED":
            recent = p["id"] in turned_red
            items.append(_item("TURNED_RED" if recent else "PROJECT_RED", "critical",
                               f"{p['name']} {'turned Red this week' if recent else 'is Red'}", _first_reason(p),
                               "Open health", route, entity=p["id"], project=p, event_at=p["health_changed_at"]))
        if "STATUS_MISMATCH" in (p["health_flags"] or []):
            calculated = (p["health_overall"] or "").title()
            items.append(_item("STATUS_MISMATCH", "critical", f"Status mismatch on {p['name']}",
                               f"The PM's latest update is rosier than the data, which says {calculated}.",
                               "Update status" if role == rbac.PM else "Review project",
                               f"/portfolio/{p['id']}?tab={'status' if role == rbac.PM else 'overview'}",
                               entity=p["id"], project=p, event_at=p["last_update"]))
    return items


def _update_items(projects: list[dict], today: date, pm_view: bool) -> list[dict]:
    items = []
    for p in projects:
        if p["lifecycle_status"] != "ACTIVE":
            continue
        last = _day(p["last_update"]) or p["actual_start"] or p["planned_start"]
        since = (today - last).days
        route = f"/portfolio/{p['id']}?tab=status"
        if "UPDATE_OVERDUE" in (p["health_flags"] or []):
            if since >= CRITICAL_UPDATE_DAYS:
                items.append(_item("UPDATE_OVERDUE", "critical", f"Weekly update overdue: {p['name']}",
                                   f"No status update for {since} days.", "Submit update" if pm_view else "Chase PM",
                                   route, entity=p["id"], project=p, days_overdue=since - 7, event_at=last + timedelta(days=8)))
            elif pm_view:
                items.append(_item("UPDATE_OVERDUE", "high", f"Weekly update overdue: {p['name']}",
                                   f"No status update for {since} days; updates are due weekly.", "Submit update", route,
                                   entity=p["id"], project=p, days_overdue=since - 7, event_at=last + timedelta(days=8)))
        elif pm_view and 5 <= since <= 7:
            items.append(_item("UPDATE_DUE_SOON", "due_soon", f"Weekly update due: {p['name']}",
                               f"Last update was {since} days ago.", "Submit update", route, entity=p["id"], project=p,
                               due_date=last + timedelta(days=7), due_in_days=7 - since, event_at=last + timedelta(days=5)))
    return items


def _milestone_items(conn: Connection, projects: list[dict], today: date, person_id: str | None = None) -> list[dict]:
    active = {p["id"]: p for p in projects if p["lifecycle_status"] == "ACTIVE"}
    milestones, tasks = repo.milestones_and_tasks(conn, list(active))
    rules = {**DEFAULT_RULES, **health_store.load_rules(conn)}
    items = []
    by_id = {m["id"]: m for m in milestones}
    for state in milestone_states(milestones, tasks, rules, today):  # the engine's own rules
        m = by_id[state["id"]]
        p = active[m["project_id"]]
        route = f"/portfolio/{p['id']}?tab=plan"
        if state["is_late"]:
            late = -state["days_to_due"]
            items.append(_item("MILESTONE_LATE", "critical" if late >= CRITICAL_LATE_DAYS else "high",
                               f"Milestone late: {m['name']}", f"{late} days late and {state['completion']:.0f}% complete.",
                               "Open plan", route, entity=m["id"], project=p, due_date=m["due_date"], days_overdue=late,
                               event_at=m["due_date"] + timedelta(days=1)))
        elif state["is_at_risk"]:
            items.append(_item("MILESTONE_AT_RISK", "due_soon", f"Milestone at risk: {m['name']}",
                               f"Due in {state['days_to_due']} days and {state['completion']:.0f}% complete.",
                               "Open plan", route, entity=m["id"], project=p, due_date=m["due_date"],
                               due_in_days=state["days_to_due"], event_at=m["due_date"] - timedelta(days=7)))
    if person_id:  # the analyst's own tasks
        week_end = _monday(today) + timedelta(days=6)
        for t in tasks:
            if str(t["assignee_person_id"]) != person_id or t["status"] == "DONE" or not t["due_date"]:
                continue
            p = active[t["project_id"]]
            route = f"/portfolio/{p['id']}?tab=plan"
            if t["due_date"] < today:
                late = (today - t["due_date"]).days
                items.append(_item("TASK_LATE", "high", f"Task late: {t['title']}", f"Your task is {late} days late.",
                                   "Propose update", route, entity=t["id"], project=p, due_date=t["due_date"],
                                   days_overdue=late, event_at=t["due_date"] + timedelta(days=1)))
            elif t["due_date"] <= week_end:
                items.append(_item("TASK_DUE_SOON", "due_soon", f"Task due this week: {t['title']}",
                                   f"Due {t['due_date'].isoformat()}.", "Propose update", route, entity=t["id"], project=p,
                                   due_date=t["due_date"], due_in_days=(t["due_date"] - today).days,
                                   event_at=_monday(today)))
    return items


def _people_items(conn: Connection, today: date, threshold: float, project_ids: list | None, severe_only: bool,
                  rules: dict) -> list[dict]:
    items = []
    severe = rules["allocation_severe_hours"]
    for person in repo.people_loads(conn, today, threshold, project_ids):
        hours = float(person["total_hours"])
        if hours > severe:
            items.append(_item("PERSON_SEVERELY_OVER_ALLOCATED", "critical", f"{person['full_name']} is severely over-allocated",
                               f"Allocated {hours:g} h/week across projects ({hours - 40:g} h over capacity).",
                               "Review allocations", "/people?load=SEVERE", entity=person["id"], event_at=person["since"]))
        elif not severe_only:
            items.append(_item("PERSON_OVER_ALLOCATED", "high", f"{person['full_name']} is over-allocated",
                               f"Allocated {hours:g} h/week across projects ({hours - 40:g} h over 40).",
                               "Review allocations", "/people?load=OVER", entity=person["id"], event_at=person["since"]))
    return items


def _pmo_portfolio_items(conn: Connection, projects: list[dict], today: date) -> list[dict]:
    items = []
    active = [p for p in projects if p["lifecycle_status"] == "ACTIVE"]
    last_weeks = repo.last_spend_weeks(conn, [p["id"] for p in active])
    previous_week = _monday(today) - timedelta(days=7)
    for p in active:
        start = p["actual_start"] or p["planned_start"]
        first_week = _monday(start)
        end_week = min(previous_week, _monday(p["planned_end"]))
        if first_week > end_week:
            continue
        covered = last_weeks.get(p["id"]) or first_week - timedelta(days=7)
        missing = (end_week - covered).days // 7
        if missing >= 1:  # CONFIRMED: 1 week missing = High, 2+ = Critical
            items.append(_item("SPEND_MISSING", "critical" if missing >= 2 else "high",
                               f"Spend not recorded: {p['name']}",
                               f"No spend recorded for {'the last ' + str(missing) + ' weeks' if missing > 1 else 'last week'} "
                               f"(week of {end_week.isoformat()}).", "Record spend", f"/portfolio/{p['id']}?tab=budget",
                               entity=p["id"], project=p, days_overdue=(today - (covered + timedelta(days=14))).days,
                               due_date=covered + timedelta(days=7), event_at=covered + timedelta(days=14)))
    for p in projects:
        if p["lifecycle_status"] == "PROPOSED" and p["planned_start"] < today:
            late = (today - p["planned_start"]).days
            items.append(_item("PROPOSED_PAST_START", "high", f"Still Proposed after planned start: {p['name']}",
                               f"Planned to start {late} days ago; decide whether to activate, move or cancel it.",
                               "Review project", f"/portfolio/{p['id']}?tab=overview", entity=p["id"], project=p,
                               due_date=p["planned_start"], days_overdue=late, event_at=p["planned_start"]))
    for p in repo.projects_without_allocations(conn, today):
        items.append(_item("NO_ALLOCATIONS", "high", f"No one allocated: {p['name']}",
                           "This Active project has no current allocations, so delivery capacity is unknown.",
                           "Allocate people", f"/portfolio/{p['id']}?tab=team", entity=p["id"], project=p,
                           event_at=p["updated_at"]))
    return items


def _approval_items(conn: Connection, principal: Principal, now: datetime) -> list[dict]:
    items = []
    for cr in repo.pending_approvals(conn, principal.user_id):
        waiting = (now - cr["created_at"]).days
        project = {"id": cr["project_id"], "name": cr["project_name"], "priority": cr["priority"],
                   "approved_budget": cr["approved_budget"]}
        items.append(_item("APPROVAL_WAITING", "high" if waiting >= 2 else "due_soon",
                           f"Approve {cr['entity_type'].lower()} change from {cr['proposer']}",
                           f"Proposed change to '{cr['entity_name']}' is waiting for your decision.", "Review", "/approvals",
                           entity=cr["id"], project=project, waiting_since=cr["created_at"], waiting_days=waiting,
                           event_at=cr["created_at"], approval={"change_request_id": cr["id"]}))
    return items


def _analyst_proposal_items(conn: Connection, principal: Principal, now: datetime) -> list[dict]:
    items = []
    for cr in repo.own_proposals(conn, principal.user_id):
        project = {"id": cr["project_id"], "name": cr["project_name"], "priority": cr["priority"],
                   "approved_budget": cr["approved_budget"]}
        if cr["status"] == "REJECTED":
            items.append(_item("PROPOSAL_REJECTED", "high", f"Rework needed: {cr['entity_name']}",
                               f"Rejected: {cr['reason']}", "See feedback", "/my-proposals?status=REJECTED", entity=cr["id"],
                               project=project, waiting_since=cr["decided_at"], waiting_days=(now - cr["decided_at"]).days,
                               event_at=cr["decided_at"]))
        else:
            items.append(_item("PROPOSAL_PENDING", "due_soon", f"Waiting for approval: {cr['entity_name']}",
                               "Your proposal is with the project manager; nothing changes until it is approved.",
                               "View proposal", "/my-proposals?status=PENDING", entity=cr["id"], project=project,
                               waiting_since=cr["created_at"], waiting_days=(now - cr["created_at"]).days,
                               event_at=cr["created_at"]))
    return items


def _admin_items(conn: Connection, now: datetime) -> list[dict]:
    data, items = repo.admin_accounts(conn), []
    for u in data["locked"]:
        items.append(_item("ACCOUNT_LOCKED", "high", f"Account locked: {u['display_name']}",
                           f"{u['email']} is locked after repeated failed sign-ins.", "Unlock",
                           f"/users?q={u['email']}", entity=u["id"], event_at=u["locked_until"] - timedelta(minutes=15)))
    for u in data["temporary"]:
        items.append(_item("TEMP_PASSWORD", "due_soon", f"Temporary password: {u['display_name']}",
                           f"{u['email']} has not yet set their own password.", "Open user", f"/users?q={u['email']}",
                           entity=u["id"], waiting_since=u["updated_at"], waiting_days=(now - u["updated_at"]).days,
                           event_at=u["updated_at"]))
    for change in data["role_changes"]:
        before, after = (change["before"] or {}).get("role"), (change["after"] or {}).get("role")
        items.append(_item("ROLE_CHANGED", "due_soon", f"Role changed: {change['display_name']}",
                           f"Changed from {before or 'unknown'} to {after} on {change['at'].date().isoformat()}.",
                           "Review access", "/access-audit", entity=f"{change['id']}:{change['at'].isoformat()}",
                           event_at=change["at"]))
    return items


def work_queue(conn: Connection, principal: Principal, query: dict[str, str], today: date | None = None,
               now: datetime | None = None) -> tuple[int, dict]:
    """Build, rank and return the caller's queue (max 50 items, plus counts by severity)."""
    scope = rbac.require(principal, "work_queue.read")
    today = today or date.today()
    now = now or datetime.now(timezone.utc)
    role = principal.role
    items: list[dict] = []
    rules = {**DEFAULT_RULES, "allocation_severe_hours": 60.0, "allocation_standard_hours": 40.0,
             **health_store.load_rules(conn)}
    if role != rbac.ADMIN:
        health_store.refresh_stale(conn, today)
    if role == rbac.PM and scope == rbac.OWN:
        projects = repo.projects_in_scope(conn, managed_by=principal.user_id)
        items += _health_items(projects, role, today, set())
        items += _update_items(projects, today, pm_view=True)
        items += _milestone_items(conn, projects, today)
        items += _approval_items(conn, principal, now)
        items += _people_items(conn, today, rules["allocation_standard_hours"], [p["id"] for p in projects], False, rules)
    elif role == rbac.ANALYST:
        projects = repo.projects_in_scope(conn, assigned_to=principal.user_id)
        items += _analyst_proposal_items(conn, principal, now)
        items += _milestone_items(conn, projects, today, person_id=principal.person_id)
    elif role == rbac.PMO:
        projects = repo.projects_in_scope(conn)
        items += _health_items(projects, role, today, set())
        items += _update_items(projects, today, pm_view=False)
        items += _people_items(conn, today, rules["allocation_severe_hours"], None, True, rules)
        items += _pmo_portfolio_items(conn, projects, today)
    elif role == rbac.EXEC:
        projects = repo.projects_in_scope(conn)
        items += _health_items(projects, role, today, repo.recent_turned_red(conn))
    elif role == rbac.ADMIN:
        items += _admin_items(conn, now)
    ranked = rank_work_items(items, today)
    previous = repo.previous_login(conn, principal.user_id)
    counts = {"critical": 0, "high": 0, "due_soon": 0, "total": len(ranked)}
    for item in ranked:
        counts[item["severity"]] += 1
        event = item.pop("event_at")
        if previous is not None and event is not None:
            event_dt = event if isinstance(event, datetime) else datetime.combine(event, datetime.min.time(), tzinfo=timezone.utc)
            item["is_new"] = event_dt > previous
        else:
            item["is_new"] = False
        item.pop("priority", None)
        item.pop("budget", None)
    return 200, {"items": ranked[:MAX_ITEMS], "counts": counts, "last_sign_in_at": previous}
