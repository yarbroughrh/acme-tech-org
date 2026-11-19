"""Weekly spend (CONFIRMED): Monday-only, PMO only, upsert on project + week + category, audited, health recalculated."""

import uuid
from datetime import date, timedelta

import pytest

TODAY = date.today()
THIS_MONDAY = TODAY - timedelta(days=TODAY.weekday())
LAST_MONDAY = THIS_MONDAY - timedelta(days=7)


@pytest.fixture
def project(api):
    _, lk = api.call("GET", "/api/projects/lookups", token=api.token("pmo"))
    pm_id = next(p["id"] for p in lk["project_managers"] if p["display_name"] == "Jordan Lee")
    status, body = api.call("POST", "/api/projects", {
        "name": f"Spend Test {uuid.uuid4().hex[:8]}", "department_id": lk["departments"][0]["id"], "pm_user_id": pm_id,
        "planned_start": (TODAY - timedelta(days=60)).isoformat(), "planned_end": (TODAY + timedelta(days=60)).isoformat(),
        "approved_budget": 120000, "lifecycle_status": "ACTIVE"}, token=api.token("pmo"))
    assert status == 201
    return body["project"]


def _save(api, project, week, amount, category="LABOUR", key="pmo", note=None):
    return api.call("POST", f"/api/projects/{project['id']}/spend",
                    {"week_starting": week.isoformat(), "category": category, "amount": amount, "note": note}, token=api.token(key))


@pytest.mark.parametrize("offset", [1, 2, 3, 4, 5, 6])  # Tuesday..Sunday
def test_only_mondays_accepted(api, project, offset):
    status, body = _save(api, project, LAST_MONDAY + timedelta(days=offset), 100)
    assert status == 400 and body["error"]["details"][0] == {"field": "week_starting", "message": "Week starting must be a Monday."}


def test_monday_accepted_future_and_outside_rejected(api, project):
    assert _save(api, project, LAST_MONDAY, 100)[0] == 201
    assert _save(api, project, THIS_MONDAY, 100)[0] == 201  # current week allowed
    status, body = _save(api, project, THIS_MONDAY + timedelta(days=7), 100)
    assert status == 400 and "future" in body["error"]["details"][0]["message"]
    assert _save(api, project, LAST_MONDAY - timedelta(days=7 * 20), 100)[0] == 400  # before the project


def test_same_week_and_category_updates_and_is_audited(api, project, database):
    status, first = _save(api, project, LAST_MONDAY, 1000, note="Sprint 5")
    assert status == 201 and first["created"] is True
    status, second = _save(api, project, LAST_MONDAY, 1500, note="Corrected")
    assert status == 200 and second["created"] is False and second["entry"]["id"] == first["entry"]["id"]
    assert second["entry"]["amount"] == 1500 and second["entry"]["updated_by"]["display_name"] == "Morgan Patel"
    status, other = _save(api, project, LAST_MONDAY, 200, category="SOFTWARE_LICENCES")
    assert status == 201 and other["entry"]["id"] != first["entry"]["id"]  # different category = new entry
    live = database.execute("SELECT count(*) AS n FROM spend_entries WHERE project_id = %s AND deleted_at IS NULL",
                            (project["id"],)).fetchone()["n"]
    assert live == 2
    audit = database.execute("SELECT action, before, after FROM audit_log WHERE entity_id = %s ORDER BY id",
                             (first["entry"]["id"],)).fetchall()
    assert [a["action"] for a in audit] == ["CREATED", "UPDATED"]
    assert audit[1]["before"]["amount"] == 1000 and audit[1]["after"]["amount"] == 1500


def test_cumulative_sum_drives_budget_health(api, project):
    _save(api, project, LAST_MONDAY - timedelta(days=7), 20000)
    _save(api, project, LAST_MONDAY, 25000)
    _save(api, project, LAST_MONDAY, 5000, category="CONTRACTORS_VENDORS")
    status, body = api.call("GET", f"/api/projects/{project['id']}/spend", token=api.token("pm"))
    assert status == 200 and body["totals"]["spend_to_date"] == 50000
    assert [i["week_starting"] for i in body["items"]] == sorted([i["week_starting"] for i in body["items"]], reverse=True)
    _, detail = api.call("GET", f"/api/projects/{project['id']}", token=api.token("pmo"))
    metrics = detail["project"]["health"]["metrics"]
    assert metrics["spend_to_date"] == 50000  # health recalculated from the weekly entries
    # 60 of 120 days elapsed: planned to date = 120,000 x 50% = 60,000; actual 50,000 is under plan, but with no
    # milestones progress is 0%, so 41.7% of budget spent is "spending ahead of delivery" (> 15 pts) -> Amber.
    assert metrics["planned_spend_to_date"] == 60000 and metrics["budget_spent_pct"] == 41.7
    budget = detail["project"]["health"]["dimensions"]["budget"]
    assert budget["status"] == "AMBER" and any("ahead of delivery" in r for r in budget["reasons"])


@pytest.mark.parametrize("key, expected", [("pmo", 201), ("pm", 403), ("exec", 403), ("analyst1", 403), ("admin", 403)])
def test_only_pmo_records_spend(api, project, key, expected):
    assert _save(api, project, LAST_MONDAY, 10, key=key)[0] == expected


@pytest.mark.parametrize("payload, field", [
    ({"week_starting": None, "category": "LABOUR", "amount": 1}, "week_starting"),
    ({"category": "TRAVEL", "amount": 1}, "category"),
    ({"category": "LABOUR", "amount": 0}, "amount"),
    ({"category": "LABOUR", "amount": -5}, "amount"),
])
def test_validation(api, project, payload, field):
    body = {"week_starting": LAST_MONDAY.isoformat(), **payload}
    status, err = api.call("POST", f"/api/projects/{project['id']}/spend", body, token=api.token("pmo"))
    assert status == 400 and field in {d["field"] for d in err["error"]["details"]}
