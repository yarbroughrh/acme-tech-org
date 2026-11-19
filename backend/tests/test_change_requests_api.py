"""PM Analyst change-request workflow (CONFIRMED by the stakeholder), end to end through the handlers.

Each test builds its own sandbox: a project created by the PMO, managed by the demo PM (Jordan Lee),
with one milestone and one task, and analyst1 assigned.
"""

import uuid
from datetime import date, timedelta

import pytest


@pytest.fixture
def sandbox(api):
    """A fresh Active project with a milestone, a task and analyst1 assigned. Returns ids."""
    today = date.today()
    _, lookups = api.call("GET", "/api/projects/lookups", token=api.token("pmo"))
    pm_id = next(p["id"] for p in lookups["project_managers"] if p["display_name"] == "Jordan Lee")
    analyst1 = next(a["id"] for a in lookups["analysts"] if a["display_name"] == "Sam Okafor")
    status, body = api.call("POST", "/api/projects", {
        "name": f"CR Sandbox {uuid.uuid4().hex[:8]}", "department_id": lookups["departments"][0]["id"],
        "pm_user_id": pm_id, "planned_start": (today - timedelta(days=30)).isoformat(),
        "planned_end": (today + timedelta(days=70)).isoformat(), "approved_budget": 100000,
        "lifecycle_status": "ACTIVE", "actual_start": (today - timedelta(days=30)).isoformat()}, token=api.token("pmo"))
    assert status == 201, body
    pid = body["project"]["id"]
    pm = api.token("pm")
    status, body = api.call("POST", f"/api/projects/{pid}/milestones", {
        "name": "Build", "due_date": (today + timedelta(days=40)).isoformat(), "status": "IN_PROGRESS",
        "percent_complete": 20}, token=pm)
    assert status == 201, body
    milestone = body["milestone"]
    status, body = api.call("POST", f"/api/projects/{pid}/tasks", {
        "title": "Write API", "milestone_id": milestone["id"], "status": "TODO"}, token=pm)
    assert status == 201, body
    task = body["task"]
    assert api.call("POST", f"/api/projects/{pid}/analysts", {"user_id": analyst1}, token=pm)[0] == 201
    return {"project_id": pid, "milestone": milestone, "task": task}


def _propose(api, sandbox, changes, entity="MILESTONE", key="analyst1", note=None):
    entity_id = sandbox["milestone"]["id"] if entity == "MILESTONE" else sandbox["task"]["id"]
    return api.call("POST", f"/api/projects/{sandbox['project_id']}/change-requests",
                    {"entity_type": entity, "entity_id": entity_id, "changes": changes, "note": note}, token=api.token(key))


def _milestone(api, sandbox):
    _, body = api.call("GET", f"/api/projects/{sandbox['project_id']}/milestones", token=api.token("pm"))
    return next(m for m in body["items"] if m["id"] == sandbox["milestone"]["id"])


def _health(api, sandbox):
    _, body = api.call("GET", f"/api/projects/{sandbox['project_id']}", token=api.token("pmo"))
    return body["project"]["health"]


def test_proposal_changes_nothing_until_approved(api, sandbox, database):
    health_before = _health(api, sandbox)
    snapshots_before = database.execute("SELECT count(*) AS n FROM health_snapshots WHERE project_id = %s",
                                        (sandbox["project_id"],)).fetchone()["n"]
    status, body = _propose(api, sandbox, {"percent_complete": 90, "notes": "Ahead of plan"}, note="Sprint 4 done")
    assert status == 201 and body["change_request"]["status"] == "PENDING"
    milestone = _milestone(api, sandbox)
    assert milestone["percent_complete"] == 20 and milestone["notes"] is None and milestone["version"] == sandbox["milestone"]["version"]
    assert _health(api, sandbox) == health_before  # pending proposals never affect health
    assert database.execute("SELECT count(*) AS n FROM health_snapshots WHERE project_id = %s",
                            (sandbox["project_id"],)).fetchone()["n"] == snapshots_before


def test_approval_applies_audits_and_recalculates_health(api, sandbox, database):
    progress_before = _health(api, sandbox)["metrics"]["progress_pct"]
    _, body = _propose(api, sandbox, {"percent_complete": 90})
    cr_id = body["change_request"]["id"]
    _, queue = api.call("GET", "/api/change-requests", token=api.token("pm"), query={"view": "approvals", "status": "PENDING"})
    item = next(i for i in queue["items"] if i["id"] == cr_id)
    assert item["current"] == {"percent_complete": 20} and item["changes"] == {"percent_complete": 90}
    assert item["proposer"]["display_name"] == "Sam Okafor" and item["entity_name"] == "Build"
    status, body = api.call("POST", f"/api/change-requests/{cr_id}/approve", token=api.token("pm"))
    assert status == 200 and body["change_request"]["status"] == "APPROVED"
    assert body["change_request"]["decided_by"]["display_name"] == "Jordan Lee"
    milestone = _milestone(api, sandbox)
    assert milestone["percent_complete"] == 90 and milestone["version"] == sandbox["milestone"]["version"] + 1
    # This milestone has a task, so completion comes from tasks (percent is only used without tasks):
    # approving the task as Done must move progress from 0% to 100% via recalculated health.
    assert progress_before == 0.0
    _, body = _propose(api, sandbox, {"status": "DONE"}, entity="TASK")
    assert api.call("POST", f"/api/change-requests/{body['change_request']['id']}/approve", token=api.token("pm"))[0] == 200
    assert _health(api, sandbox)["metrics"]["progress_pct"] == 100.0
    actions = [r["action"] for r in database.execute(
        "SELECT action FROM audit_log WHERE project_id = %s ORDER BY id", (sandbox["project_id"],)).fetchall()]
    assert "PROPOSED" in actions and "UPDATED_BY_APPROVAL" in actions and actions[-1] == "APPROVED"
    assert actions.index("UPDATED_BY_APPROVAL") > actions.index("PROPOSED")
    applied = database.execute("SELECT actor_user_id, before, after FROM audit_log WHERE entity_id = %s "
                               "AND action = 'UPDATED_BY_APPROVAL'", (sandbox["milestone"]["id"],)).fetchone()
    assert applied["before"]["percent_complete"] == 20 and applied["after"]["percent_complete"] == 90


def test_rejection_requires_reason_and_applies_nothing(api, sandbox):
    _, body = _propose(api, sandbox, {"status": "IN_PROGRESS", "notes": "Started"}, entity="TASK")
    cr_id = body["change_request"]["id"]
    for payload in (None, {}, {"reason": "   "}):
        status, err = api.call("POST", f"/api/change-requests/{cr_id}/reject", payload, token=api.token("pm"))
        assert status == 400 and err["error"]["details"][0]["field"] == "reason"
    status, body = api.call("POST", f"/api/change-requests/{cr_id}/reject", {"reason": "Not started yet."}, token=api.token("pm"))
    assert status == 200 and body["change_request"]["status"] == "REJECTED" and body["change_request"]["reason"] == "Not started yet."
    _, tasks = api.call("GET", f"/api/projects/{sandbox['project_id']}/tasks", token=api.token("pm"))
    assert tasks["items"][0]["status"] == "TODO"
    _, mine = api.call("GET", "/api/change-requests", token=api.token("analyst1"), query={"view": "mine", "status": "REJECTED"})
    assert any(i["id"] == cr_id and i["reason"] == "Not started yet." for i in mine["items"])


@pytest.mark.parametrize("key", ["pmo", "admin", "exec", "analyst1", "analyst2"])
def test_only_the_projects_pm_can_decide(api, sandbox, key):
    _, body = _propose(api, sandbox, {"percent_complete": 50})
    cr_id = body["change_request"]["id"]
    assert api.call("POST", f"/api/change-requests/{cr_id}/approve", token=api.token(key))[0] == 403
    assert api.call("POST", f"/api/change-requests/{cr_id}/reject", {"reason": "x"}, token=api.token(key))[0] == 403


def test_another_pm_cannot_decide(api, sandbox, database):
    from beacon import auth
    email = f"otherpm{uuid.uuid4().hex[:6]}@acme.example"
    database.execute("INSERT INTO users (email, display_name, role, password_hash, must_change_password) "
                     "VALUES (%s, 'Other PM', 'PM', %s, false)", (email, auth.hash_password("Other!PmPass123")))
    token = api.login(email, "Other!PmPass123")[1]["token"]
    _, body = _propose(api, sandbox, {"percent_complete": 50})
    status, err = api.call("POST", f"/api/change-requests/{body['change_request']['id']}/approve", token=token)
    assert status == 403 and "this project's Project Manager" in err["error"]["message"]
    _, queue = api.call("GET", "/api/change-requests", token=token, query={"view": "approvals"})
    assert queue["total"] == 0  # PMs only see approvals for their own projects


def test_stale_proposal_returns_409_and_applies_nothing(api, sandbox):
    _, body = _propose(api, sandbox, {"percent_complete": 70})
    cr_id = body["change_request"]["id"]
    # The PM edits the milestone directly after the proposal was made
    status, _ = api.call("PUT", f"/api/projects/{sandbox['project_id']}/milestones/{sandbox['milestone']['id']}",
                         {"percent_complete": 30, "version": sandbox["milestone"]["version"]}, token=api.token("pm"))
    assert status == 200
    status, err = api.call("POST", f"/api/change-requests/{cr_id}/approve", token=api.token("pm"))
    assert status == 409 and "changed since this proposal" in err["error"]["message"]
    assert _milestone(api, sandbox)["percent_complete"] == 30
    _, queue = api.call("GET", "/api/change-requests", token=api.token("pm"), query={"view": "approvals", "status": "PENDING"})
    assert any(i["id"] == cr_id for i in queue["items"])  # still pending; the PM can reject it


def test_already_decided_is_409(api, sandbox):
    _, body = _propose(api, sandbox, {"percent_complete": 60})
    cr_id = body["change_request"]["id"]
    assert api.call("POST", f"/api/change-requests/{cr_id}/approve", token=api.token("pm"))[0] == 200
    assert api.call("POST", f"/api/change-requests/{cr_id}/approve", token=api.token("pm"))[0] == 409
    assert api.call("POST", f"/api/change-requests/{cr_id}/reject", {"reason": "x"}, token=api.token("pm"))[0] == 409


def test_deleted_target_cannot_be_approved(api, sandbox):
    _, body = _propose(api, sandbox, {"status": "DONE"}, entity="TASK")
    assert api.call("DELETE", f"/api/projects/{sandbox['project_id']}/tasks/{sandbox['task']['id']}", token=api.token("pm"))[0] == 204
    assert api.call("POST", f"/api/change-requests/{body['change_request']['id']}/approve", token=api.token("pm"))[0] == 409


@pytest.mark.parametrize("changes, field", [
    ({"name": "Renamed"}, "name"),                        # not proposable
    ({"percent_complete": 101}, "percent_complete"),
    ({"due_date": "2099-01-01"}, "due_date"),             # outside project dates
    ({"status": "DONE"}, "status"),                       # not a milestone status
])
def test_proposal_validation(api, sandbox, changes, field):
    status, err = _propose(api, sandbox, changes)
    assert status == 400 and field in {d["field"] for d in err["error"]["details"]}


def test_proposal_must_change_something(api, sandbox):
    status, err = _propose(api, sandbox, {"percent_complete": 20})
    assert status == 400 and "Nothing would change" in err["error"]["message"]
    assert _propose(api, sandbox, {})[0] == 400


@pytest.mark.parametrize("key, expected", [("analyst2", 403), ("pm", 403), ("pmo", 403), ("exec", 403), ("admin", 403)])
def test_only_assigned_analysts_can_propose(api, sandbox, key, expected):
    assert _propose(api, sandbox, {"percent_complete": 55}, key=key)[0] == expected


def test_removed_analyst_can_no_longer_propose(api, sandbox, database):
    analyst = database.execute("SELECT id FROM users WHERE email = 'analyst1@acme.example'").fetchone()["id"]
    assert api.call("DELETE", f"/api/projects/{sandbox['project_id']}/analysts/{analyst}", token=api.token("pm"))[0] == 204
    assert _propose(api, sandbox, {"percent_complete": 55})[0] == 403


@pytest.mark.parametrize("method, path, body", [
    ("POST", "/milestones", {"name": "X", "due_date": None, "status": "NOT_STARTED"}),
    ("PUT", "/milestones/{mid}", {"percent_complete": 99, "version": 1}),
    ("DELETE", "/milestones/{mid}", None),
    ("POST", "/tasks", {"title": "X", "milestone_id": "{mid}", "status": "TODO"}),
    ("PUT", "/tasks/{tid}", {"status": "DONE", "version": 1}),
    ("DELETE", "/tasks/{tid}", None),
    ("PUT", "", {"name": "Analyst rename", "version": 1}),
    ("POST", "/status-updates", {"reported_status": "GREEN", "summary": "x"}),
    ("POST", "/analysts", {"user_id": str(uuid.uuid4())}),
    ("POST", "/archive", {"version": 1}),
])
def test_analyst_direct_edits_are_403(api, sandbox, method, path, body):
    mid, tid = sandbox["milestone"]["id"], sandbox["task"]["id"]
    path = path.replace("{mid}", mid).replace("{tid}", tid)
    if body:
        body = {k: (v.replace("{mid}", mid) if isinstance(v, str) else v) for k, v in body.items()}
    status, _ = api.call(method, f"/api/projects/{sandbox['project_id']}{path}", body, token=api.token("analyst1"))
    assert status == 403


def test_list_views_and_validation(api, sandbox):
    _propose(api, sandbox, {"percent_complete": 45})
    assert api.call("GET", "/api/change-requests", token=api.token("analyst1"), query={"view": "approvals"})[0] == 403
    assert api.call("GET", "/api/change-requests", token=api.token("exec"))[0] == 403
    assert api.call("GET", "/api/change-requests", token=api.token("pm"), query={"status": "MAYBE"})[0] == 400
    status, body = api.call("GET", "/api/change-requests", token=api.token("pmo"), query={"status": "PENDING"})
    assert status == 200 and body["total"] >= 1
    status, body = api.call("GET", "/api/change-requests", token=api.token("analyst1"))  # defaults to view=mine
    assert status == 200 and all(i["proposer"]["display_name"] == "Sam Okafor" for i in body["items"])
    assert api.call("POST", f"/api/change-requests/{uuid.uuid4()}/approve", token=api.token("pm"))[0] == 404


def test_archiving_rejects_pending_proposals(api, sandbox):
    _, body = _propose(api, sandbox, {"percent_complete": 65})
    _, project = api.call("GET", f"/api/projects/{sandbox['project_id']}", token=api.token("pmo"))
    status, _ = api.call("POST", f"/api/projects/{sandbox['project_id']}/archive",
                         {"version": project["project"]["version"]}, token=api.token("pmo"))
    assert status == 200
    _, mine = api.call("GET", "/api/change-requests", token=api.token("analyst1"), query={"status": "REJECTED", "page_size": "100"})
    assert any(i["id"] == body["change_request"]["id"] and i["reason"] == "Project archived." for i in mine["items"])
