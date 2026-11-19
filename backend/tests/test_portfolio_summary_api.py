"""Executive dashboard summary: Active-only health by department, people bands, budget against plan."""

import pytest


@pytest.mark.parametrize("key, expected", [("exec", 200), ("pmo", 200), ("pm", 200), ("admin", 403), ("analyst1", 403)])
def test_summary_access(api, key, expected):
    assert api.call("GET", "/api/portfolio/summary", token=api.token(key))[0] == expected


def test_health_counts_are_active_only_and_match_the_portfolio(api, database):
    status, body = api.call("GET", "/api/portfolio/summary", token=api.token("exec"))
    assert status == 200
    db = {r["h"]: r["n"] for r in database.execute(
        "SELECT health_overall AS h, count(*) AS n FROM projects WHERE archived_at IS NULL AND lifecycle_status = 'ACTIVE' "
        "GROUP BY 1").fetchall()}
    assert body["health_counts"] == {"RED": db.get("RED", 0), "AMBER": db.get("AMBER", 0), "GREEN": db.get("GREEN", 0)}
    assert sum(d["red"] + d["amber"] + d["green"] for d in body["health_by_department"]) == sum(body["health_counts"].values())
    excluded = database.execute("SELECT count(*) AS n FROM projects WHERE archived_at IS NULL "
                                "AND lifecycle_status <> 'ACTIVE'").fetchone()["n"]
    assert body["excluded_projects"] == excluded > 0


def test_people_bands(api, database):
    _, body = api.call("GET", "/api/portfolio/summary", token=api.token("pmo"))
    people = body["people"]
    active = database.execute("SELECT count(*) AS n FROM people WHERE is_active").fetchone()["n"]
    assert people["severe"] + people["over"] + people["at_or_under"] == active
    assert people["severe"] >= 1 and people["over"] >= 1  # Marcus Webb (64 h), Priya Raman (58 h)


def test_budget_against_plan_uses_engine_metrics(api, database):
    _, body = api.call("GET", "/api/portfolio/summary", token=api.token("exec"))
    row = database.execute("SELECT sum(approved_budget) AS a, sum((health_detail->'metrics'->>'spend_to_date')::numeric) AS s, "
                           "sum((health_detail->'metrics'->>'planned_spend_to_date')::numeric) AS p FROM projects "
                           "WHERE archived_at IS NULL AND lifecycle_status = 'ACTIVE'").fetchone()
    totals = body["totals"]
    assert abs(totals["approved"] - float(row["a"])) < 1 and abs(totals["actual_to_date"] - float(row["s"])) < 1
    assert abs(totals["planned_to_date"] - float(row["p"])) < 1
    expected = round((totals["actual_to_date"] - totals["planned_to_date"]) / totals["planned_to_date"] * 100, 1)
    assert totals["variance_pct"] == expected
    assert all(set(r) == {"department", "approved", "planned_to_date", "actual_to_date", "variance_pct"}
               for r in body["budget_by_department"])


def test_department_filter(api):
    _, lk = api.call("GET", "/api/projects/lookups", token=api.token("exec"))
    dept = lk["departments"][0]
    status, body = api.call("GET", "/api/portfolio/summary", token=api.token("exec"), query={"department_id": dept["id"]})
    assert status == 200 and all(d["department"]["id"] == dept["id"] for d in body["health_by_department"])
    assert api.call("GET", "/api/portfolio/summary", token=api.token("exec"), query={"department_id": "x"})[0] == 400
