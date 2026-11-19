"""Health engine: table-driven tests for every rule, with boundaries (at / just below / just above).

Baseline: an Active project 50 days into a 100-day plan (elapsed exactly 50%), one milestone due at
the end and 50% complete, $50,000 spent of $100,000 (exactly on plan), PM updated yesterday.
Everything is Green; each case changes one input.
"""

from datetime import date, datetime, timedelta, timezone

import pytest

from beacon.health import AMBER, GREEN, RED, STATUS_MISMATCH, UPDATE_OVERDUE, evaluate_health, summary_text

TODAY = date(2026, 11, 19)
START, END = TODAY - timedelta(days=50), TODAY + timedelta(days=50)


def project(**over):
    return {"lifecycle_status": "ACTIVE", "planned_start": START, "planned_end": END, "actual_start": START,
            "approved_budget": 100000, **over}


def milestone(mid="m1", name="Go-live", due=END, pct=50, status="IN_PROGRESS", **over):
    return {"id": mid, "name": name, "due_date": due, "percent_complete": pct, "status": status, **over}


def spend(amount, on=TODAY - timedelta(days=1), **over):
    return {"week_starting": on, "amount": amount, **over}


def update(days_ago=1, reported="GREEN"):
    return {"reported_status": reported, "created_at": datetime.combine(TODAY - timedelta(days=days_ago),
                                                                         datetime.min.time(), tzinfo=timezone.utc)}


def run(p=None, ms=None, tasks=None, sp=None, ups=None, rules=None, today=TODAY):
    return evaluate_health(p or project(), [milestone()] if ms is None else ms, tasks or [],
                           [spend(50000)] if sp is None else sp, [update()] if ups is None else ups, rules, today)


def test_baseline_is_green_and_explains_itself():
    result = run()
    assert result["overall"] == GREEN
    assert {d["status"] for d in result["dimensions"].values()} == {GREEN}
    assert result["flags"] == []
    assert result["reasons"] == ["Schedule, budget and milestones are all within thresholds."]
    assert result["metrics"] == {"elapsed_pct": 50.0, "progress_pct": 50.0, "spend_to_date": 50000.0,
                                 "planned_spend_to_date": 50000.0, "budget_spent_pct": 50.0}


# --- Schedule ---------------------------------------------------------------------------------
@pytest.mark.parametrize("progress, expected", [
    (40, GREEN),   # lag exactly 10 pts
    (39, AMBER),   # lag 11
    (25, AMBER),   # lag exactly 25
    (24, RED),     # lag 26
])
def test_schedule_lag_boundaries(progress, expected):
    # spend kept proportional to progress so budget stays Green
    result = run(ms=[milestone(pct=progress)], sp=[spend(progress * 1000)])
    assert result["dimensions"]["schedule"]["status"] == expected


@pytest.mark.parametrize("late_days, expected", [(7, GREEN), (8, AMBER)])
def test_schedule_late_start_boundary(late_days, expected):
    result = run(p=project(actual_start=START + timedelta(days=late_days)))
    assert result["dimensions"]["schedule"]["status"] == expected


def test_schedule_red_when_end_passed_and_not_complete():
    p = project(planned_start=TODAY - timedelta(days=100), actual_start=TODAY - timedelta(days=100),
                planned_end=TODAY - timedelta(days=1))
    result = run(p=p, ms=[milestone(due=TODAY - timedelta(days=1), pct=100, status="COMPLETE"),
                          milestone("m2", "Hypercare", due=TODAY - timedelta(days=1), pct=98)],
                 sp=[spend(99000)])
    assert result["dimensions"]["schedule"]["status"] == RED
    assert any("planned end date" in r for r in result["reasons"])


def test_schedule_green_when_end_passed_but_complete():
    p = project(planned_start=TODAY - timedelta(days=100), actual_start=TODAY - timedelta(days=100),
                planned_end=TODAY - timedelta(days=1))
    result = run(p=p, ms=[milestone(due=TODAY - timedelta(days=1), pct=100, status="COMPLETE")], sp=[spend(100000)])
    assert result["dimensions"]["schedule"]["status"] == GREEN


def test_no_milestones_is_amber_with_reason():
    result = run(ms=[], sp=[spend(1)])
    assert result["dimensions"]["schedule"]["status"] in (AMBER, RED)
    assert any("no milestones" in r for r in result["reasons"])


# --- Budget -----------------------------------------------------------------------------------
@pytest.mark.parametrize("actual, expected", [
    (55000, GREEN),   # exactly 10% over plan to date
    (55001, AMBER),
    (60000, AMBER),   # exactly 20%
    (60001, RED),
])
def test_budget_overspend_boundaries(actual, expected):
    result = run(ms=[milestone(pct=60)], sp=[spend(actual)])  # progress 60 keeps spend-ahead-of-delivery Green
    assert result["dimensions"]["budget"]["status"] == expected


def test_budget_red_when_actual_exceeds_approved_budget():
    p = project(planned_start=TODAY - timedelta(days=100), actual_start=TODAY - timedelta(days=100),
                planned_end=TODAY + timedelta(days=1))
    result = run(p=p, ms=[milestone(pct=100, status="COMPLETE", due=TODAY + timedelta(days=1))], sp=[spend(100001)])
    assert result["dimensions"]["budget"]["status"] == RED
    assert any("exceeds the approved budget" in r for r in result["reasons"])


@pytest.mark.parametrize("actual, expected", [(45000, GREEN), (45001, AMBER)])
def test_budget_spending_ahead_of_delivery_boundary(actual, expected):
    # progress 30%: 45% spent is exactly 15 pts ahead; above that is Amber
    result = run(ms=[milestone(pct=30)], sp=[spend(actual)])
    assert result["dimensions"]["budget"]["status"] == expected


def test_budget_spend_before_planned_start_is_amber():
    p = project(planned_start=TODAY + timedelta(days=1), planned_end=TODAY + timedelta(days=101), actual_start=None)
    result = run(p=p, ms=[milestone(due=TODAY + timedelta(days=101), pct=0)], sp=[spend(10)], ups=[update(0)])
    assert result["dimensions"]["budget"]["status"] == AMBER


def test_future_and_deleted_spend_ignored():
    sp = [spend(50000), spend(999999, on=TODAY + timedelta(days=1)),
          spend(999999, deleted_at=datetime.now(timezone.utc))]
    assert run(sp=sp)["dimensions"]["budget"]["status"] == GREEN


# --- Milestones -------------------------------------------------------------------------------
@pytest.mark.parametrize("due_in, pct, expected", [
    (7, 74, AMBER),   # due within 7 days and under 75%: at risk
    (7, 75, GREEN),   # exactly 75%: not at risk
    (8, 0, GREEN),    # outside the window
    (0, 74, AMBER),   # due today
])
def test_milestone_at_risk_boundaries(due_in, pct, expected):
    ms = [milestone(), milestone("m2", "UAT sign-off", due=TODAY + timedelta(days=due_in), pct=pct)]
    result = run(ms=ms, sp=[spend(1)])
    assert result["dimensions"]["milestones"]["status"] == expected


@pytest.mark.parametrize("late, expected", [
    ([1], AMBER),        # one late
    ([1, 2], RED),       # two late
    ([14], AMBER),       # exactly 14 days late
    ([15], RED),         # more than 14 days late
])
def test_late_milestone_rules(late, expected):
    ms = [milestone()] + [milestone(f"l{d}", f"Late {d}", due=TODAY - timedelta(days=d), pct=60) for d in late]
    result = run(ms=ms, sp=[spend(1)])
    assert result["dimensions"]["milestones"]["status"] == expected


def test_complete_milestone_past_due_is_not_late():
    ms = [milestone(), milestone("m2", "Done", due=TODAY - timedelta(days=30), pct=100, status="COMPLETE")]
    assert run(ms=ms, sp=[spend(75000)])["dimensions"]["milestones"]["status"] == GREEN


def test_completion_from_tasks_overrides_percent_and_ignores_deleted():
    ms = [milestone(pct=0, due=TODAY + timedelta(days=3))]
    tasks = [{"milestone_id": "m1", "status": "DONE"}] * 3 + [{"milestone_id": "m1", "status": "TODO"},
             {"milestone_id": "m1", "status": "TODO", "deleted_at": datetime.now(timezone.utc)}]
    result = run(ms=ms, tasks=tasks, sp=[spend(75000)])
    assert result["metrics"]["progress_pct"] == 75.0
    assert result["dimensions"]["milestones"]["status"] == GREEN  # 75% is not at risk


def test_deleted_or_archived_milestones_ignored():
    ms = [milestone(), milestone("x", "Old", due=TODAY - timedelta(days=30), pct=0, deleted_at=datetime.now(timezone.utc)),
          milestone("y", "Arch", due=TODAY - timedelta(days=30), pct=0, archived_at=datetime.now(timezone.utc))]
    assert run(ms=ms)["overall"] == GREEN


# --- Combination, lifecycle, flags --------------------------------------------------------------
def test_overall_is_worst_dimension_and_reasons_name_each():
    ms = [milestone(pct=39), milestone("m2", "UAT sign-off", due=TODAY + timedelta(days=3), pct=40)]
    result = run(ms=ms, sp=[spend(70000)])
    assert result["dimensions"]["schedule"]["status"] == AMBER
    assert result["dimensions"]["budget"]["status"] == RED
    assert result["overall"] == RED
    text = summary_text(result)
    assert text.startswith("Red. ")
    assert "Budget: spend is 40% ahead of plan" in text
    assert "Milestones: 'UAT sign-off' is due in 3 days and 40% complete." in text


@pytest.mark.parametrize("lifecycle", ["PROPOSED", "ON_HOLD", "CLOSED", "CANCELLED"])
def test_only_active_projects_get_health(lifecycle):
    result = run(p=project(lifecycle_status=lifecycle), ms=[milestone(due=TODAY - timedelta(days=40), pct=0)])
    assert result["overall"] is None and result["flags"] == []
    assert "Active projects only" in result["reasons"][0]


@pytest.mark.parametrize("reported, expected_flag", [("GREEN", True), ("AMBER", False), ("RED", False)])
def test_status_mismatch_only_when_pm_reports_better(reported, expected_flag):
    ms = [milestone(pct=39)]  # Amber schedule
    result = run(ms=ms, sp=[spend(39000)], ups=[update(1, reported)])
    assert result["overall"] == AMBER
    assert (STATUS_MISMATCH in result["flags"]) is expected_flag


def test_mismatch_uses_latest_update():
    ups = [update(10, "RED"), update(1, "GREEN")]
    assert STATUS_MISMATCH in run(ms=[milestone(pct=39)], sp=[spend(39000)], ups=ups)["flags"]


@pytest.mark.parametrize("days_ago, overdue", [(7, False), (8, True)])
def test_update_overdue_boundary_and_colour_unchanged(days_ago, overdue):
    result = run(ups=[update(days_ago)])
    assert (UPDATE_OVERDUE in result["flags"]) is overdue
    assert result["overall"] == GREEN


def test_update_overdue_counts_from_start_when_no_updates():
    assert UPDATE_OVERDUE in run(ups=[])["flags"]
    fresh = project(planned_start=TODAY - timedelta(days=3), actual_start=TODAY - timedelta(days=3))
    assert UPDATE_OVERDUE not in run(p=fresh, ms=[milestone(pct=3)], sp=[spend(1)], ups=[])["flags"]


def test_rules_are_configurable():
    strict = {"schedule_amber_lag_pts": 5}
    assert run(ms=[milestone(pct=44)], sp=[spend(44000)], rules=strict)["dimensions"]["schedule"]["status"] == AMBER
    assert run(ms=[milestone(pct=44)], sp=[spend(44000)])["dimensions"]["schedule"]["status"] == GREEN
