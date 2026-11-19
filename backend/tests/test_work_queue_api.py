"""GET /api/me/work-queue per role: the right items appear, nothing leaks, shape and limits hold."""

import pytest


@pytest.fixture(autouse=True, scope="module")
def _only_seeded_projects(database):
    """Other test modules create sandbox projects for the demo PM; archive them so queues reflect the seed story."""
    seeded = "(SELECT max(applied_at) FROM seed_runs)"
    database.execute(f"UPDATE projects SET archived_at = now() WHERE archived_at IS NULL AND created_at > {seeded}")
    database.execute(f"UPDATE allocations SET archived_at = now() WHERE archived_at IS NULL AND person_id IN "
                     f"(SELECT id FROM people WHERE created_at > {seeded})")


def _queue(api, key):
    status, body = api.call("GET", "/api/me/work-queue", token=api.token(key))
    assert status == 200, body
    return body


def _types(body):
    return {i["type"] for i in body["items"]}


def test_requires_auth(api):
    assert api.call("GET", "/api/me/work-queue")[0] == 401


@pytest.mark.parametrize("key", ["admin", "pmo", "pm", "analyst1", "exec"])
def test_shape_counts_and_limit(api, key):
    body = _queue(api, key)
    assert len(body["items"]) <= 50
    assert body["counts"]["total"] == body["counts"]["critical"] + body["counts"]["high"] + body["counts"]["due_soon"]
    for item in body["items"]:
        assert item["severity"] in ("critical", "high", "due_soon")
        assert item["title"] and item["reason"] and item["action"]["label"] and item["action"]["route"].startswith("/")
        assert isinstance(item["score"], int) and isinstance(item["is_new"], bool)
        assert "budget" not in item and "priority" not in item and "event_at" not in item
    scores = [i["score"] for i in body["items"]]
    assert scores == sorted(scores, reverse=True)


def test_pm_sees_approval_overdue_update_late_milestone_and_over_allocation(api, database):
    body = _queue(api, "pm")
    types = _types(body)
    assert {"APPROVAL_WAITING", "UPDATE_OVERDUE", "MILESTONE_LATE", "PROJECT_RED", "STATUS_MISMATCH"} <= types
    assert types & {"PERSON_OVER_ALLOCATED", "PERSON_SEVERELY_OVER_ALLOCATED"}
    approval = next(i for i in body["items"] if i["type"] == "APPROVAL_WAITING")
    assert approval["approval"]["change_request_id"] and approval["action"]["route"] == "/approvals"
    own = {r["id"] for r in database.execute(
        "SELECT p.id FROM projects p JOIN users u ON u.id = p.pm_user_id WHERE u.email = 'pm@acme.example'").fetchall()}
    leaked = [i for i in body["items"] if i["project"] and i["project"]["id"] not in {str(x) for x in own}]
    assert not leaked, leaked  # only the PM's own projects


def test_pm_update_overdue_reason(api):
    item = next(i for i in _queue(api, "pm")["items"] if i["type"] == "UPDATE_OVERDUE"
                and i["project"]["name"] == "Branch Network Refresh")
    assert item["days_overdue"] >= 5 and "No status update for" in item["reason"]
    assert item["action"]["route"].endswith("?tab=status")


def test_pmo_sees_mismatch_severe_person_and_missing_spend(api):
    body = _queue(api, "pmo")
    assert {"STATUS_MISMATCH", "PERSON_SEVERELY_OVER_ALLOCATED", "SPEND_MISSING", "PROJECT_RED"} <= _types(body)
    severe = next(i for i in body["items"] if i["type"] == "PERSON_SEVERELY_OVER_ALLOCATED")
    assert severe["severity"] == "critical" and "Marcus Webb" in severe["title"]
    assert not any(i["type"] == "PERSON_OVER_ALLOCATED" for i in body["items"])  # PMO only sees > 60 h


def test_spend_missing_one_week_high_two_weeks_critical(api):
    items = {i["project"]["name"]: i for i in _queue(api, "pmo")["items"] if i["type"] == "SPEND_MISSING"}
    assert items["HR Self-Service Portal"]["severity"] == "high"        # 1 week missing
    assert items["Branch Network Refresh"]["severity"] == "critical"    # 2 weeks missing
    assert items["Branch Network Refresh"]["action"]["route"].endswith("?tab=budget")


def test_exec_sees_off_track_and_turned_red(api):
    body = _queue(api, "exec")
    assert _types(body) <= {"PROJECT_RED", "TURNED_RED", "STATUS_MISMATCH"}
    red = [i for i in body["items"] if i["type"] in ("PROJECT_RED", "TURNED_RED")]
    assert len(red) >= 2
    turned = next(i for i in body["items"] if i["type"] == "TURNED_RED")
    assert turned["project"]["name"] == "Payments Gateway Upgrade" and "turned Red" in turned["title"]


def test_analyst_sees_rejected_proposal_and_only_assigned_projects(api, database):
    body = _queue(api, "analyst1")
    assert "PROPOSAL_REJECTED" in _types(body)
    rejected = next(i for i in body["items"] if i["type"] == "PROPOSAL_REJECTED")
    assert rejected["reason"].startswith("Rejected: ") and rejected["action"]["route"] == "/my-proposals?status=REJECTED"
    assigned = {str(r["project_id"]) for r in database.execute(
        "SELECT pa.project_id FROM project_analysts pa JOIN users u ON u.id = pa.user_id "
        "WHERE u.email = 'analyst1@acme.example' AND pa.removed_at IS NULL").fetchall()}
    proposal_projects = {str(r["project_id"]) for r in database.execute(
        "SELECT cr.project_id FROM change_requests cr JOIN users u ON u.id = cr.proposer_user_id "
        "WHERE u.email = 'analyst1@acme.example'").fetchall()}
    for item in body["items"]:
        if item["project"]:
            assert item["project"]["id"] in assigned | proposal_projects


def test_admin_gets_only_account_items(api):
    body = _queue(api, "admin")
    assert _types(body) <= {"ACCOUNT_LOCKED", "TEMP_PASSWORD", "ROLE_CHANGED"}
    assert "ACCOUNT_LOCKED" in _types(body) and "ROLE_CHANGED" in _types(body)
    assert all(i["project"] is None for i in body["items"])


def test_non_active_projects_never_carry_health_items(api, database):
    inactive = {str(r["id"]) for r in database.execute("SELECT id FROM projects WHERE lifecycle_status <> 'ACTIVE'").fetchall()}
    for key in ("pmo", "exec", "pm"):
        for item in _queue(api, key)["items"]:
            if item["type"] in ("PROJECT_RED", "TURNED_RED", "STATUS_MISMATCH", "UPDATE_OVERDUE", "MILESTONE_LATE"):
                assert item["project"]["id"] not in inactive


def test_is_new_after_a_second_sign_in(api, database):
    api.token("pm")  # sign in first: signing in is what moves previous_login_at
    database.execute("UPDATE users SET previous_login_at = now() - interval '1 day', last_login_at = now() "
                     "WHERE email = 'pm@acme.example'")
    body = _queue(api, "pm")
    assert body["last_sign_in_at"] is not None
    new = [i for i in body["items"] if i["is_new"]]
    assert any(i["type"] == "APPROVAL_WAITING" for i in new)  # proposals seeded today are newer than yesterday's sign-in
    database.execute("UPDATE users SET previous_login_at = now() + interval '1 day' WHERE email = 'pm@acme.example'")
    assert not any(i["is_new"] for i in _queue(api, "pm")["items"])
