"""Project health engine: a PURE function (no I/O). Health is calculated, never chosen.

``evaluate_health(project, milestones, tasks, spend_entries, status_updates, rules, today)`` returns
``{overall, dimensions, reasons, flags, metrics}``. Callers pass APPROVED data only. Pending change
requests live in their own table and never reach this function (CONFIRMED).

Rules (thresholds come from the ``health_rules`` table; "more than" is strict ``>``). All CONFIRMED by the
stakeholder on 2026-11-19 unless marked ASSUMPTION:
- Only Active projects get a health colour; Proposed, On hold, Closed and Cancelled show their lifecycle
  status and are excluded from health counts.
- Schedule: elapsed % = days since planned start ÷ planned duration (current baseline); progress % =
  average milestone completion (share of tasks done, or the PM's percentage when a milestone has no
  tasks). Amber: progress trails elapsed by > 10 pts. Red: > 25 pts, or past the planned end and not
  complete. ASSUMPTION: Amber if the actual start is > 7 days after the planned start; Amber if there
  are no milestones.
- Budget: planned spend to date = approved budget × elapsed %; actual = all weekly entries up to the
  current week. Amber: actual > planned by > 10%. Red: > 20%, or over the approved budget.
  ASSUMPTION: Amber when % of budget spent exceeds progress % by > 15 pts (spending ahead of delivery).
- Milestones: at risk = due within 7 days and < 75% complete; late = past due and not complete.
  Amber: any at risk, or one late. Red: two or more late, or any more than 14 days late.
- Overall = the worst of the three.
- Flags (never change the colour): STATUS_MISMATCH when the PM's latest reported status is better than
  calculated; UPDATE_OVERDUE when there has been no status update for more than 7 days.
"""

from datetime import date
from decimal import Decimal
from typing import Any, Iterable

GREEN, AMBER, RED = "GREEN", "AMBER", "RED"
SEVERITY = {GREEN: 0, AMBER: 1, RED: 2}
LABEL = {GREEN: "Green", AMBER: "Amber", RED: "Red"}
LIFECYCLE_LABEL = {"PROPOSED": "Proposed", "ACTIVE": "Active", "ON_HOLD": "On hold", "CLOSED": "Closed",
                   "CANCELLED": "Cancelled"}
STATUS_MISMATCH, UPDATE_OVERDUE = "STATUS_MISMATCH", "UPDATE_OVERDUE"

DEFAULT_RULES: dict[str, float] = {
    "schedule_amber_lag_pts": 10, "schedule_red_lag_pts": 25, "schedule_late_start_days": 7,
    "budget_amber_overspend_pct": 10, "budget_red_overspend_pct": 20, "budget_ahead_of_delivery_pts": 15,
    "milestone_at_risk_window_days": 7, "milestone_at_risk_min_complete_pct": 75,
    "milestone_amber_late_count": 1, "milestone_red_late_count": 2, "milestone_red_days_late": 14,
    "status_update_overdue_days": 7,
}


def _active(rows: Iterable[dict]) -> list[dict]:
    return [r for r in rows if not r.get("deleted_at") and not r.get("archived_at")]


def _worst(*statuses: str) -> str:
    return max(statuses, key=lambda s: SEVERITY[s])


def _pct(value: float) -> str:
    return f"{value:.0f}%"


def _money(value: float) -> str:
    return f"${value:,.0f}"


def milestone_completion(milestone: dict, tasks: list[dict]) -> float:
    """Completion 0–100: share of DONE tasks, else the PM's percentage, else 100 if Complete."""
    own = [t for t in tasks if t["milestone_id"] == milestone["id"]]
    if own:
        return 100.0 * sum(1 for t in own if t["status"] == "DONE") / len(own)
    if milestone.get("percent_complete") is not None:
        return float(milestone["percent_complete"])
    return 100.0 if milestone["status"] == "COMPLETE" else 0.0


def milestone_states(milestones: list[dict], tasks: list[dict], rules: dict, today: date) -> list[dict]:
    """Per-milestone completion, late / at-risk state (used by the engine and the milestones API)."""
    window = rules["milestone_at_risk_window_days"]
    min_pct = rules["milestone_at_risk_min_complete_pct"]
    states = []
    for m in milestones:
        completion = milestone_completion(m, tasks)
        days_to_due = (m["due_date"] - today).days
        late = days_to_due < 0 and completion < 100
        at_risk = (not late) and 0 <= days_to_due <= window and completion < min_pct
        states.append({"id": m["id"], "name": m["name"], "completion": completion, "days_to_due": days_to_due,
                       "is_late": late, "is_at_risk": at_risk})
    return states


def evaluate_health(project: dict, milestones: list[dict], tasks: list[dict], spend_entries: list[dict],
                    status_updates: list[dict], rules: dict[str, float] | None, today: date) -> dict[str, Any]:
    """Calculate health for one project. Pure and deterministic for a given ``today``."""
    r = {**DEFAULT_RULES, **{k: float(v) for k, v in (rules or {}).items()}}
    if project["lifecycle_status"] != "ACTIVE":
        label = LIFECYCLE_LABEL.get(project["lifecycle_status"], project["lifecycle_status"])
        return {"overall": None, "dimensions": {}, "flags": [], "metrics": {},
                "reasons": [f"{label}: health is calculated for Active projects only."]}

    milestones, tasks = _active(milestones), _active(tasks)
    # Actual spend to date = all weekly entries up to and including the current week (CONFIRMED)
    spend_entries = [s for s in _active(spend_entries) if s["week_starting"] <= today]

    start, end = project["planned_start"], project["planned_end"]
    duration = max((end - start).days, 1)
    elapsed = min(max((today - start).days / duration, 0.0), 1.0)
    states = milestone_states(milestones, tasks, r, today)
    progress = (sum(s["completion"] for s in states) / len(states) / 100.0) if states else 0.0
    budget = float(project["approved_budget"])
    actual = float(sum(Decimal(str(s["amount"])) for s in spend_entries))
    planned_to_date = budget * elapsed
    spent_pct = 100.0 * actual / budget if budget else 0.0

    schedule = _schedule(project, elapsed, progress, states, r, today)
    budget_dim = _budget(actual, planned_to_date, budget, spent_pct, progress, r)
    milestone_dim = _milestones(states, r)
    dimensions = {"schedule": schedule, "budget": budget_dim, "milestones": milestone_dim}
    overall = _worst(schedule["status"], budget_dim["status"], milestone_dim["status"])

    reasons = [reason for dim in dimensions.values() for reason in dim["reasons"]]
    if not reasons:
        reasons = ["Schedule, budget and milestones are all within thresholds."]
    flags = _flags(project, status_updates, overall, r, today)
    metrics = {
        "elapsed_pct": round(elapsed * 100, 1), "progress_pct": round(progress * 100, 1),
        "spend_to_date": round(actual, 2), "planned_spend_to_date": round(planned_to_date, 2),
        "budget_spent_pct": round(spent_pct, 1),
    }
    return {"overall": overall, "dimensions": dimensions, "reasons": reasons, "flags": flags, "metrics": metrics}


def summary_text(result: dict[str, Any]) -> str:
    """One-line explanation, e.g. "Amber. Budget: spend is 14% ahead of plan ..."."""
    if result["overall"] is None:
        return " ".join(result["reasons"])
    return f"{LABEL[result['overall']]}. " + " ".join(result["reasons"])


def _schedule(project: dict, elapsed: float, progress: float, states: list[dict], r: dict, today: date) -> dict:
    lag_pts = round((elapsed - progress) * 100, 6)  # rounding keeps 'exactly at' boundaries exact
    status, reasons = GREEN, []
    summary = f"Progress {_pct(progress * 100)} vs {_pct(elapsed * 100)} of time elapsed."
    if not states:  # a plan with no milestones cannot be shown as on track (ASSUMPTION)
        status = AMBER
        reasons.append("Schedule: no milestones are planned, so progress cannot be measured.")
    if today > project["planned_end"] and progress < 1.0:
        status = RED
        reasons.append(f"Schedule: the planned end date ({project['planned_end'].isoformat()}) has passed "
                       f"and the project is {_pct(progress * 100)} complete.")
    if lag_pts > r["schedule_red_lag_pts"]:
        status = RED
        reasons.append(f"Schedule: progress is {lag_pts:.0f} points behind time elapsed "
                       f"({_pct(progress * 100)} vs {_pct(elapsed * 100)}).")
    elif lag_pts > r["schedule_amber_lag_pts"]:
        status = _worst(status, AMBER)
        reasons.append(f"Schedule: progress is {lag_pts:.0f} points behind time elapsed "
                       f"({_pct(progress * 100)} vs {_pct(elapsed * 100)}).")
    actual_start = project.get("actual_start")
    if actual_start and (actual_start - project["planned_start"]).days > r["schedule_late_start_days"]:
        status = _worst(status, AMBER)
        reasons.append(f"Schedule: started {(actual_start - project['planned_start']).days} days after the planned start.")
    return {"status": status, "summary": summary, "reasons": reasons}


def _budget(actual: float, planned: float, budget: float, spent_pct: float, progress: float, r: dict) -> dict:
    status, reasons = GREEN, []
    summary = f"{_money(actual)} spent vs {_money(planned)} planned to date ({_pct(spent_pct)} of {_money(budget)})."
    if actual > budget:
        status = RED
        reasons.append(f"Budget: spend of {_money(actual)} exceeds the approved budget of {_money(budget)}.")
    if planned > 0:
        over_pct = round((actual - planned) / planned * 100, 6)
        if over_pct > r["budget_red_overspend_pct"]:
            status = RED
            reasons.append(f"Budget: spend is {over_pct:.0f}% ahead of plan ({_money(actual)} vs {_money(planned)} planned to date).")
        elif over_pct > r["budget_amber_overspend_pct"]:
            status = _worst(status, AMBER)
            reasons.append(f"Budget: spend is {over_pct:.0f}% ahead of plan ({_money(actual)} vs {_money(planned)} planned to date).")
    elif actual > 0:
        status = _worst(status, AMBER)
        reasons.append(f"Budget: {_money(actual)} was spent before the planned start.")
    ahead_pts = round(spent_pct - progress * 100, 6)
    if ahead_pts > r["budget_ahead_of_delivery_pts"]:
        status = _worst(status, AMBER)
        reasons.append(f"Budget: {_pct(spent_pct)} of the budget is spent but progress is {_pct(progress * 100)} "
                       f"(spending {ahead_pts:.0f} points ahead of delivery).")
    return {"status": status, "summary": summary, "reasons": reasons}


def _milestones(states: list[dict], r: dict) -> dict:
    late = [s for s in states if s["is_late"]]
    at_risk = [s for s in states if s["is_at_risk"]]
    status, reasons = GREEN, []
    for s in late:
        reasons.append(f"Milestones: '{s['name']}' is {-s['days_to_due']} days late ({_pct(s['completion'])} complete).")
    for s in at_risk:
        due = "today" if s["days_to_due"] == 0 else f"in {s['days_to_due']} day{'s' if s['days_to_due'] != 1 else ''}"
        reasons.append(f"Milestones: '{s['name']}' is due {due} and {_pct(s['completion'])} complete.")
    if len(late) >= r["milestone_red_late_count"] or any(-s["days_to_due"] > r["milestone_red_days_late"] for s in late):
        status = RED
    elif at_risk or len(late) >= r["milestone_amber_late_count"]:
        status = AMBER
    summary = f"{len(late)} late, {len(at_risk)} at risk, of {len(states)} milestones."
    return {"status": status, "summary": summary, "reasons": reasons}


def _flags(project: dict, status_updates: list[dict], overall: str, r: dict, today: date) -> list[str]:
    flags = []
    latest = max(status_updates, key=lambda u: u["created_at"]) if status_updates else None
    if latest and SEVERITY[latest["reported_status"]] < SEVERITY[overall]:
        flags.append(STATUS_MISMATCH)
    if latest:
        last = latest["created_at"]
        last_date = last.date() if hasattr(last, "hour") else last
    else:
        last_date = project.get("actual_start") or project["planned_start"]
    if (today - last_date).days > r["status_update_overdue_days"]:
        flags.append(UPDATE_OVERDUE)
    return flags
