"""Allocations (CONFIRMED rules): 40 h Amber warning, 60 h Red warning but saved, 0.5-168 input check,
Closed/Cancelled/archived rejected, On hold allowed with a warning; and the people view."""

import uuid
from datetime import date, timedelta

import pytest

TODAY = date.today()


@pytest.fixture
def project(api):
    """A fresh Active project managed by the demo PM."""
    _, lk = api.call("GET", "/api/projects/lookups", token=api.token("pmo"))
    pm_id = next(p["id"] for p in lk["project_managers"] if p["display_name"] == "Jordan Lee")
    status, body = api.call("POST", "/api/projects", {
        "name": f"Alloc Test {uuid.uuid4().hex[:8]}", "department_id": lk["departments"][0]["id"], "pm_user_id": pm_id,
        "planned_start": (TODAY - timedelta(days=10)).isoformat(), "planned_end": (TODAY + timedelta(days=100)).isoformat(),
        "approved_budget": 100000, "lifecycle_status": "ACTIVE"}, token=api.token("pmo"))
    assert status == 201
    return body["project"]


@pytest.fixture
def person(database):
    """A fresh person with no allocations."""
    pid = database.execute("INSERT INTO people (full_name, email, department_id) SELECT %s, %s, "
                           "(SELECT id FROM departments ORDER BY name LIMIT 1) RETURNING id",
                           ("Test Person", f"p{uuid.uuid4().hex[:8]}@acme.example")).fetchone()["id"]
    return str(pid)


def _allocate(api, project, person, hours, key="pm", start=None, end=None):
    return api.call("POST", f"/api/projects/{project['id']}/allocations", {
        "person_id": person, "hours_per_week": hours,
        "start_date": start or project["planned_start"], "end_date": end or project["planned_end"]}, token=api.token(key))


@pytest.mark.parametrize("hours, load, codes", [
    (39.5, "UNDER", []),
    (40, "OK", []),                                   # exactly 40: no warning
    (40.5, "OVER", ["OVER_ALLOCATED"]),               # just above 40: Amber
    (60, "OVER", ["OVER_ALLOCATED"]),                 # exactly 60: still Amber
    (61, "SEVERE", ["SEVERELY_OVER_ALLOCATED"]),      # above 60: saved with a Red warning (no hard block)
])
def test_40_and_60_hour_warnings(api, project, person, hours, load, codes):
    status, body = _allocate(api, project, person, hours)
    assert status == 201  # always saved
    assert body["allocation"]["load_status"] == load
    assert [w["code"] for w in body["warnings"]] == codes
    if codes == ["SEVERELY_OVER_ALLOCATED"]:
        assert body["warnings"][0]["severity"] == "RED" and body["warnings"][0]["message"].startswith("Saved.")


def test_totals_add_up_across_projects(api, project, person):
    _allocate(api, project, person, 30)
    status, body = _allocate(api, project, person, 31)  # 61 in total across two allocations
    assert status == 201 and body["allocation"]["person_total_hours"] == 61
    assert body["warnings"][0]["code"] == "SEVERELY_OVER_ALLOCATED"
    _, listing = api.call("GET", f"/api/projects/{project['id']}/allocations", token=api.token("exec"))
    assert {a["load_status"] for a in listing["items"]} == {"SEVERE"}


@pytest.mark.parametrize("hours, ok", [(0.4, False), (0.5, True), (168, True), (168.5, False)])
def test_input_check_half_hour_to_168(api, project, person, hours, ok):
    status, body = _allocate(api, project, person, hours)
    assert (status == 201) is ok
    if not ok:
        assert body["error"]["details"][0]["field"] == "hours_per_week"


def test_dates_validated(api, project, person):
    status, body = _allocate(api, project, person, 10, start=(TODAY + timedelta(days=50)).isoformat(),
                             end=(TODAY + timedelta(days=20)).isoformat())
    assert status == 400 and "end_date" in {d["field"] for d in body["error"]["details"]}
    status, body = _allocate(api, project, person, 10, end=(TODAY + timedelta(days=500)).isoformat())
    assert status == 400


@pytest.mark.parametrize("lifecycle", ["CLOSED"])
def test_closed_cancelled_archived_rejected_on_hold_warned(api, project, person, lifecycle):
    pmo = api.token("pmo")
    _, p = api.call("PUT", f"/api/projects/{project['id']}", {"lifecycle_status": "ON_HOLD", "version": project["version"]}, token=pmo)
    status, body = _allocate(api, project, person, 10)
    assert status == 201 and [w["code"] for w in body["warnings"]] == ["PROJECT_ON_HOLD"]
    _, p = api.call("PUT", f"/api/projects/{project['id']}", {"lifecycle_status": lifecycle, "version": p["project"]["version"]}, token=pmo)
    assert _allocate(api, project, person, 10)[0] == 409
    _, p = api.call("POST", f"/api/projects/{project['id']}/cancel", {"version": p["project"]["version"]}, token=pmo)
    assert _allocate(api, project, person, 10)[0] == 409
    api.call("POST", f"/api/projects/{project['id']}/archive", {"version": p["project"]["version"]}, token=pmo)
    assert _allocate(api, project, person, 10)[0] == 409


@pytest.mark.parametrize("key, expected", [("pmo", 201), ("pm", 201), ("exec", 403), ("analyst1", 403), ("admin", 403)])
def test_allocation_access_matrix(api, project, person, key, expected):
    assert _allocate(api, project, person, 8, key=key)[0] == expected


def test_pm_cannot_allocate_on_another_pms_project(api, person, database):
    other = database.execute("SELECT p.id, p.planned_start, p.planned_end FROM projects p JOIN users u ON u.id = p.pm_user_id "
                             "WHERE u.email <> 'pm@acme.example' AND p.lifecycle_status = 'ACTIVE' AND p.archived_at IS NULL "
                             "LIMIT 1").fetchone()
    project = {"id": str(other["id"]), "planned_start": other["planned_start"].isoformat(),
               "planned_end": other["planned_end"].isoformat()}
    assert _allocate(api, project, person, 8)[0] == 403


def test_update_with_version_and_archive(api, project, person, database):
    _, body = _allocate(api, project, person, 20)
    alloc = body["allocation"]
    status, body = api.call("PUT", f"/api/projects/{project['id']}/allocations/{alloc['id']}",
                            {"hours_per_week": 45, "version": alloc["version"]}, token=api.token("pm"))
    assert status == 200 and body["warnings"][0]["code"] == "OVER_ALLOCATED"
    assert api.call("PUT", f"/api/projects/{project['id']}/allocations/{alloc['id']}",
                    {"hours_per_week": 10, "version": alloc["version"]}, token=api.token("pm"))[0] == 409
    assert api.call("DELETE", f"/api/projects/{project['id']}/allocations/{alloc['id']}", token=api.token("pm"))[0] == 204
    assert database.execute("SELECT archived_at IS NOT NULL AS a FROM allocations WHERE id = %s", (alloc["id"],)).fetchone()["a"]
    actions = {r["action"] for r in database.execute("SELECT action FROM audit_log WHERE entity_id = %s", (alloc["id"],)).fetchall()}
    assert actions == {"CREATED", "UPDATED", "ARCHIVED"}


# --- People view -------------------------------------------------------------------------------
@pytest.mark.parametrize("key, expected", [("pmo", 200), ("pm", 200), ("exec", 200), ("admin", 403), ("analyst1", 403)])
def test_people_access(api, key, expected):
    assert api.call("GET", "/api/people", token=api.token(key))[0] == expected


def test_people_load_filters(api):
    pmo = api.token("pmo")
    _, severe = api.call("GET", "/api/people", token=pmo, query={"load": "SEVERE", "page_size": "100"})
    assert "Marcus Webb" in {p["full_name"] for p in severe["items"]}
    assert all(p["total_hours"] > 60 and p["load_status"] == "SEVERE" for p in severe["items"])
    _, over = api.call("GET", "/api/people", token=pmo, query={"load": "OVER", "page_size": "100"})
    assert "Priya Raman" in {p["full_name"] for p in over["items"]} and all(p["total_hours"] > 40 for p in over["items"])
    _, under = api.call("GET", "/api/people", token=pmo, query={"load": "UNDER", "page_size": "5"})
    assert under["total"] > 10 and all(p["available_hours"] > 0 for p in under["items"])
    assert api.call("GET", "/api/people", token=pmo, query={"load": "LOTS"})[0] == 400


def test_people_search_and_sort(api):
    _, body = api.call("GET", "/api/people", token=api.token("exec"), query={"q": "priya"})
    assert body["items"][0]["full_name"] == "Priya Raman" and body["items"][0]["allocations"]
    _, body = api.call("GET", "/api/people", token=api.token("exec"), query={"sort": "-total_hours", "page_size": "5"})
    hours = [p["total_hours"] for p in body["items"]]
    assert hours == sorted(hours, reverse=True)  # other tests add people, so no fixed name at the top
