"""rank_work_items: severity ordering, overdue-days cap, priority bonus, tie-breaks (table-driven)."""

from datetime import date, timedelta

import pytest

from work_queue_ranking import rank_work_items, score

TODAY = date(2026, 11, 19)


def item(title, severity="high", days_overdue=0, waiting_days=None, priority=None, budget=0, due_date=None):
    return {"title": title, "severity": severity, "days_overdue": days_overdue, "waiting_days": waiting_days,
            "priority": priority, "budget": budget, "due_date": due_date}


@pytest.mark.parametrize("it, expected", [
    (item("c", "critical"), 100),
    (item("h", "high"), 60),
    (item("d", "due_soon"), 30),
    (item("overdue 9", "high", days_overdue=9), 69),
    (item("overdue 30", "high", days_overdue=30), 90),      # exactly at the cap
    (item("overdue 31", "high", days_overdue=31), 90),      # capped
    (item("overdue 400", "critical", days_overdue=400), 130),
    (item("waiting 3", "due_soon", waiting_days=3), 33),
    (item("high prio", "high", priority="HIGH"), 75),
    (item("medium prio", "high", priority="MEDIUM"), 65),
    (item("low prio", "high", priority="LOW"), 60),
    (item("negative days ignored", "high", days_overdue=-5), 60),
    (item("max of overdue/waiting", "high", days_overdue=2, waiting_days=5), 65),
])
def test_score_table(it, expected):
    assert score(it) == expected


def test_severity_orders_before_days():
    ranked = rank_work_items([item("due soon, 29 days", "due_soon", waiting_days=29),
                              item("high, fresh", "high"), item("critical, fresh", "critical")], TODAY)
    assert [i["title"] for i in ranked] == ["critical, fresh", "high, fresh", "due soon, 29 days"]


def test_long_waiting_item_can_overtake_a_fresh_higher_severity_one():
    """Property of the specified rule: severities overlap once waiting days and priority are added
    (due_soon max 30+30+15 = 75 > high base 60). A month-old High-priority approval outranks a fresh High item."""
    ranked = rank_work_items([item("high, fresh", "high"),
                              item("approval waiting 30 days", "due_soon", waiting_days=30, priority="HIGH")], TODAY)
    assert [i["title"] for i in ranked] == ["approval waiting 30 days", "high, fresh"]


def test_days_can_lift_high_above_fresh_critical_only_within_cap():
    ranked = rank_work_items([item("critical", "critical"), item("high 99 days", "high", days_overdue=99)], TODAY)
    assert [i["title"] for i in ranked] == ["critical", "high 99 days"]  # 90 < 100: the cap keeps severity meaningful


def test_priority_bonus_breaks_otherwise_equal_items():
    ranked = rank_work_items([item("low", "high"), item("high", "high", priority="HIGH"), item("med", "high", priority="MEDIUM")], TODAY)
    assert [i["title"] for i in ranked] == ["high", "med", "low"]


def test_ties_larger_budget_first_then_earlier_due_date():
    ranked = rank_work_items([
        item("small budget", "critical", budget=100_000, due_date=TODAY),
        item("big budget, later", "critical", budget=5_000_000, due_date=TODAY + timedelta(days=9)),
        item("big budget, sooner", "critical", budget=5_000_000, due_date=TODAY + timedelta(days=1)),
        item("big budget, no date", "critical", budget=5_000_000),
    ], TODAY)
    assert [i["title"] for i in ranked] == ["big budget, sooner", "big budget, later", "big budget, no date", "small budget"]


def test_scores_are_attached_and_input_items_are_kept():
    items = [item("a", "critical"), item("b", "due_soon")]
    ranked = rank_work_items(items, TODAY)
    assert len(ranked) == 2 and all("score" in i for i in ranked)
