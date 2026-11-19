"""Project writes: access matrix, validation, idempotency, 409 conflicts, archive cascade, audit (integration)."""

import uuid
from datetime import date, timedelta

import pytest

TODAY = date.today()


def _lookups(api):
    return api.call("GET", "/api/projects/lookups", token=api.token("pmo"))[1]


def _payload(api, **over):
    lk = _lookups(api)
    pm_id = next(p["id"] for p in lk["project_managers"] if p["display_name"] == "Jordan Lee")
    return {"name": f"Write Test {uuid.uuid4().hex[:8]}", "department_id": lk["departments"][1]["id"], "pm_user_id": pm_id,
            "planned_start": (TODAY - timedelta(days=10)).isoformat(), "planned_end": (TODAY + timedelta(days=90)).isoformat(),
            "approved_budget": 250000, "lifecycle_status": "ACTIVE", **over}


@pytest.fixture
def project(api):
    status, body = api.call("POST", "/api/projects", _payload(api), token=api.token("pmo"))
    assert status == 201, body
    return body["project"]


@pytest.fixture
def other_pm_project(api):
    """A project managed by a different PM than the demo PM."""
    lk = _lookups(api)
    other = next(p["id"] for p in lk["project_managers"] if p["display_name"] != "Jordan Lee")
    status, body = api.call("POST", "/api/projects", _payload(api, pm_user_id=other), token=api.token("pmo"))
    assert status == 201
    return body["project"]


@pytest.mark.parametrize("key, expected", [("pmo", 201), ("pm", 403), ("admin", 403), ("exec", 403), ("analyst1", 403)])
def test_create_project_access(api, key, expected):
    assert api.call("POST", "/api/projects", _payload(api), token=api.token(key))[0] == expected


def test_create_project_validation(api):
    status, body = api.call("POST", "/api/projects", {"name": "ab", "approved_budget": 0,
                                                      "planned_start": "2026-01-10", "planned_end": "2026-01-01",
                                                      "lifecycle_status": "DONE", "pm_user_id": str(uuid.uuid4()),
                                                      "department_id": str(uuid.uuid4())}, token=api.token("pmo"))
    fields = {d["field"] for d in body["error"]["details"]}
    assert status == 400 and {"name", "approved_budget", "lifecycle_status"} <= fields
    exec_id = api.call("GET", "/api/auth/me", token=api.token("exec"))[1]["user"]["id"]
    status, body = api.call("POST", "/api/projects", _payload(api, pm_user_id=exec_id, planned_end=(TODAY - timedelta(days=20)).isoformat()),
                            token=api.token("pmo"))
    assert status == 400 and {"pm_user_id", "planned_end"} <= {d["field"] for d in body["error"]["details"]}


def test_duplicate_project_name_rejected(api, project):
    status, body = api.call("POST", "/api/projects", _payload(api, name=project["name"].upper()), token=api.token("pmo"))
    assert status == 400 and body["error"]["details"][0]["field"] == "name"


def test_create_is_idempotent(api, database):
    payload = _payload(api)
    headers = {"idempotency-key": f"k-{uuid.uuid4()}"}
    first = api.call("POST", "/api/projects", payload, token=api.token("pmo"), headers=headers)
    second = api.call("POST", "/api/projects", payload, token=api.token("pmo"), headers=headers)
    assert first[0] == second[0] == 201 and first[1]["project"]["id"] == second[1]["project"]["id"]
    assert database.execute("SELECT count(*) AS n FROM projects WHERE name = %s", (payload["name"],)).fetchone()["n"] == 1
    status, body = api.call("POST", "/api/projects", _payload(api), token=api.token("pmo"), headers=headers)
    assert status == 409  # same key, different request


def test_new_active_project_gets_calculated_health(api, project):
    assert project["health"]["overall"] in ("GREEN", "AMBER", "RED")
    assert any("no milestones" in r for r in project["health"]["reasons"])
    assert project["permissions"]["can_archive"] is True


def test_permissions_reflect_ownership(api, project, other_pm_project):
    _, own = api.call("GET", f"/api/projects/{project['id']}", token=api.token("pm"))
    _, other = api.call("GET", f"/api/projects/{other_pm_project['id']}", token=api.token("pm"))
    assert own["project"]["permissions"]["can_edit_plan"] and own["project"]["permissions"]["can_submit_status"]
    assert not own["project"]["permissions"]["can_edit_baseline"] and not own["project"]["permissions"]["can_record_spend"]
    assert not other["project"]["permissions"]["can_edit_plan"]
    _, ex = api.call("GET", f"/api/projects/{project['id']}", token=api.token("exec"))
    assert not any(ex["project"]["permissions"][k] for k in ex["project"]["permissions"] if k != "can_view_audit")


def test_pm_edits_own_project_but_not_baselines(api, project, other_pm_project):
    pm = api.token("pm")
    status, body = api.call("PUT", f"/api/projects/{project['id']}", {"description": "Updated", "version": project["version"]}, token=pm)
    assert status == 200 and body["project"]["description"] == "Updated" and body["project"]["version"] == project["version"] + 1
    for change in ({"approved_budget": 1}, {"planned_end": (TODAY + timedelta(days=200)).isoformat()}):
        status, err = api.call("PUT", f"/api/projects/{project['id']}", {**change, "version": body["project"]["version"]}, token=pm)
        assert status == 403 and "baseline" in err["error"]["message"]
    status, _ = api.call("PUT", f"/api/projects/{other_pm_project['id']}", {"description": "x", "version": other_pm_project["version"]}, token=pm)
    assert status == 403


@pytest.mark.parametrize("key, expected", [("admin", 403), ("exec", 403), ("analyst1", 403), ("pmo", 200)])
def test_project_edit_access_matrix(api, project, key, expected):
    status, _ = api.call("PUT", f"/api/projects/{project['id']}", {"sponsor": "CFO", "version": project["version"]}, token=api.token(key))
    assert status == expected


def test_pmo_changes_baseline_and_stale_version_is_409(api, project):
    pmo = api.token("pmo")
    status, body = api.call("PUT", f"/api/projects/{project['id']}", {"approved_budget": 300000, "version": project["version"]}, token=pmo)
    assert status == 200 and body["project"]["approved_budget"] == 300000
    status, err = api.call("PUT", f"/api/projects/{project['id']}", {"sponsor": "X", "version": project["version"]}, token=pmo)
    assert status == 409 and "Morgan Patel" in err["error"]["details"][0]["message"]


def test_cancel_via_update_is_refused_and_cancel_action_works(api, project):
    pmo = api.token("pmo")
    assert api.call("PUT", f"/api/projects/{project['id']}", {"lifecycle_status": "CANCELLED", "version": project["version"]}, token=pmo)[0] == 400
    assert api.call("POST", f"/api/projects/{project['id']}/cancel", {"version": project["version"]}, token=api.token("pm"))[0] == 403
    status, body = api.call("POST", f"/api/projects/{project['id']}/cancel", {"version": project["version"], "reason": "Descoped"}, token=pmo)
    assert status == 200 and body["project"]["lifecycle_status"] == "CANCELLED" and body["project"]["health_overall"] is None
    assert api.call("POST", f"/api/projects/{project['id']}/cancel", {"version": body["project"]["version"]}, token=pmo)[0] == 409


def test_archive_cascades_and_makes_read_only(api, project, database):
    pm, pmo = api.token("pm"), api.token("pmo")
    _, m = api.call("POST", f"/api/projects/{project['id']}/milestones",
                    {"name": "M", "due_date": (TODAY + timedelta(days=30)).isoformat(), "status": "NOT_STARTED"}, token=pm)
    api.call("POST", f"/api/projects/{project['id']}/tasks", {"title": "T", "milestone_id": m["milestone"]["id"], "status": "TODO"}, token=pm)
    _, current = api.call("GET", f"/api/projects/{project['id']}", token=pmo)
    assert api.call("POST", f"/api/projects/{project['id']}/archive", {"version": current["project"]["version"]}, token=pm)[0] == 403
    status, body = api.call("POST", f"/api/projects/{project['id']}/archive", {"version": current["project"]["version"]}, token=pmo)
    assert status == 200 and body["project"]["archived_at"] and not body["project"]["permissions"]["can_edit"]
    counts = database.execute("SELECT (SELECT count(*) FROM milestones WHERE project_id = %(p)s AND archived_at IS NULL) AS m, "
                              "(SELECT count(*) FROM tasks WHERE project_id = %(p)s AND archived_at IS NULL) AS t, "
                              "(SELECT count(*) FROM milestones WHERE project_id = %(p)s) AS kept",
                              {"p": project["id"]}).fetchone()
    assert counts["m"] == 0 and counts["t"] == 0 and counts["kept"] == 1  # archived, not deleted
    status, _ = api.call("POST", f"/api/projects/{project['id']}/milestones",
                         {"name": "N", "due_date": (TODAY + timedelta(days=30)).isoformat(), "status": "NOT_STARTED"}, token=pm)
    assert status == 409
    _, listing = api.call("GET", "/api/projects", token=pmo, query={"q": project["name"]})
    assert listing["total"] == 0
    _, listing = api.call("GET", "/api/projects", token=pmo, query={"q": project["name"], "include_archived": "true"})
    assert listing["total"] == 1


def test_milestone_and_task_crud_with_validation_and_audit(api, project, database):
    pm, pid = api.token("pm"), project["id"]
    status, err = api.call("POST", f"/api/projects/{pid}/milestones",
                           {"name": "", "due_date": (TODAY + timedelta(days=400)).isoformat(), "status": "NOPE"}, token=pm)
    assert status == 400 and {d["field"] for d in err["error"]["details"]} == {"name", "due_date", "status"}
    status, body = api.call("POST", f"/api/projects/{pid}/milestones",
                            {"name": "Design", "due_date": (TODAY + timedelta(days=20)).isoformat(), "status": "NOT_STARTED"}, token=pm)
    assert status == 201
    milestone = body["milestone"]
    assert milestone["completion_pct"] == 0 and milestone["is_late"] is False
    status, body = api.call("PUT", f"/api/projects/{pid}/milestones/{milestone['id']}",
                            {"percent_complete": 100, "version": milestone["version"]}, token=pm)
    assert status == 200 and body["milestone"]["status"] == "COMPLETE"  # kept consistent
    status, err = api.call("POST", f"/api/projects/{pid}/tasks", {"title": "T", "milestone_id": str(uuid.uuid4()), "status": "TODO",
                                                                 "assignee_person_id": str(uuid.uuid4())}, token=pm)
    assert status == 400 and {"milestone_id", "assignee_person_id"} <= {d["field"] for d in err["error"]["details"]}
    status, body = api.call("POST", f"/api/projects/{pid}/tasks", {"title": "Spec", "milestone_id": milestone["id"], "status": "TODO"}, token=pm)
    task = body["task"]
    status, body = api.call("PUT", f"/api/projects/{pid}/tasks/{task['id']}", {"status": "DONE", "version": task["version"]}, token=pm)
    assert status == 200 and body["task"]["status"] == "DONE"
    assert api.call("PUT", f"/api/projects/{pid}/tasks/{task['id']}", {"status": "TODO", "version": task["version"]}, token=pm)[0] == 409
    assert api.call("DELETE", f"/api/projects/{pid}/milestones/{milestone['id']}", token=pm)[0] == 204
    _, tasks = api.call("GET", f"/api/projects/{pid}/tasks", token=pm)
    assert tasks["items"] == []  # soft-deleted with its milestone
    assert database.execute("SELECT count(*) AS n FROM tasks WHERE id = %s", (task["id"],)).fetchone()["n"] == 1
    _, trail = api.call("GET", f"/api/projects/{pid}/audit", token=pm, query={"page_size": "50"})
    actions = {(a["entity_type"], a["action"]) for a in trail["items"]}
    assert {("milestone", "CREATED"), ("milestone", "UPDATED"), ("task", "UPDATED"), ("milestone", "DELETED")} <= actions
    assert all(a["actor"]["display_name"] for a in trail["items"] if a["action"] != "SEED")


def test_milestone_not_found_cases(api, project):
    pm = api.token("pm")
    assert api.call("PUT", f"/api/projects/{project['id']}/milestones/{uuid.uuid4()}", {"version": 1}, token=pm)[0] == 404
    assert api.call("DELETE", f"/api/projects/{project['id']}/tasks/{uuid.uuid4()}", token=pm)[0] == 404


def test_status_update_drives_flags_not_colour(api, project):
    pm, pid = api.token("pm"), project["id"]
    assert api.call("POST", f"/api/projects/{pid}/status-updates", {"reported_status": "GREEN"}, token=pm)[0] == 400
    assert api.call("POST", f"/api/projects/{pid}/status-updates", {"reported_status": "GREEN", "summary": "x"},
                    token=api.token("pmo"))[0] == 403
    status, body = api.call("POST", f"/api/projects/{pid}/status-updates", {"reported_status": "GREEN", "summary": "All good"}, token=pm)
    assert status == 201 and body["status_update"]["author"]["display_name"] == "Jordan Lee"
    calculated = body["project"]["health_overall"]
    assert calculated != "GREEN" and "STATUS_MISMATCH" in body["project"]["flags"]  # no milestones → not Green
    _, history = api.call("GET", f"/api/projects/{pid}/status-updates", token=api.token("exec"))
    assert history["items"][0]["summary"] == "All good"


def test_analyst_assignment_rules(api, project, other_pm_project):
    pm = api.token("pm")
    analysts = _lookups(api)["analysts"]
    exec_id = api.call("GET", "/api/auth/me", token=api.token("exec"))[1]["user"]["id"]
    assert api.call("POST", f"/api/projects/{project['id']}/analysts", {"user_id": exec_id}, token=pm)[0] == 400
    assert api.call("POST", f"/api/projects/{project['id']}/analysts", {"user_id": analysts[0]["id"]}, token=pm)[0] == 201
    assert api.call("POST", f"/api/projects/{project['id']}/analysts", {"user_id": analysts[0]["id"]}, token=pm)[0] == 409
    assert api.call("POST", f"/api/projects/{other_pm_project['id']}/analysts", {"user_id": analysts[0]["id"]}, token=pm)[0] == 403
    _, listing = api.call("GET", f"/api/projects/{project['id']}/analysts", token=api.token("exec"))
    assert [a["user_id"] for a in listing["items"]] == [analysts[0]["id"]]
    assert api.call("DELETE", f"/api/projects/{project['id']}/analysts/{analysts[1]['id']}", token=pm)[0] == 404


@pytest.mark.parametrize("key, expected", [("admin", 200), ("pmo", 200), ("pm", 200), ("exec", 403), ("analyst1", 403)])
def test_audit_access_matrix(api, project, key, expected):
    assert api.call("GET", f"/api/projects/{project['id']}/audit", token=api.token(key))[0] == expected


def test_pm_cannot_read_audit_of_other_projects(api, other_pm_project):
    assert api.call("GET", f"/api/projects/{other_pm_project['id']}/audit", token=api.token("pm"))[0] == 403


def test_team_lists_allocated_people(api, database):
    pid = database.execute("SELECT id FROM projects WHERE name = 'Customer Portal Rebuild'").fetchone()["id"]
    status, body = api.call("GET", f"/api/projects/{pid}/team", token=api.token("pm"))
    assert status == 200 and any(p["full_name"] == "Priya Raman" for p in body["items"])
