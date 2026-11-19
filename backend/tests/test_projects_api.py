"""Portfolio list/detail/lookups: RBAC, search, filters, sorting, pagination (integration)."""

import uuid

import pytest


@pytest.mark.parametrize("key, expected", [("admin", 403), ("pmo", 200), ("pm", 200), ("exec", 200), ("analyst1", 200)])
def test_portfolio_access_matrix(api, key, expected):
    assert api.call("GET", "/api/projects", token=api.token(key))[0] == expected


def test_portfolio_requires_auth(api):
    assert api.call("GET", "/api/projects")[0] == 401
    assert api.call("GET", "/api/projects/lookups")[0] == 401


def _live_projects(database) -> int:
    return database.execute("SELECT count(*) AS n FROM projects WHERE archived_at IS NULL").fetchone()["n"]


def test_pagination_and_total(api, database):
    status, body = api.call("GET", "/api/projects", token=api.token("exec"), query={"page": "2", "page_size": "50"})
    # other tests add projects to the shared database, so compare with the database, not a constant
    assert status == 200 and body["total"] == _live_projects(database) >= 120 and len(body["items"]) == 50 and body["page"] == 2
    item = body["items"][0]
    assert set(item) >= {"id", "name", "department", "pm", "planned_end", "approved_budget", "lifecycle_status",
                         "priority", "health_overall", "health_reasons", "flags", "version"}


def test_search_by_project_name_and_pm(api):
    token = api.token("exec")
    _, body = api.call("GET", "/api/projects", token=token, query={"q": "customer portal rebuild"})
    assert [p["name"] for p in body["items"]] == ["Customer Portal Rebuild"]
    _, body = api.call("GET", "/api/projects", token=token, query={"q": "Jordan", "page_size": "100"})
    assert body["total"] >= 4 and all(p["pm"]["display_name"] == "Jordan Lee" for p in body["items"])


def test_filters_combine(api, database):
    token = api.token("pmo")
    _, body = api.call("GET", "/api/projects", token=token, query={"lifecycle_status": "ON_HOLD,CLOSED", "page_size": "100"})
    assert body["total"] >= 6 and {p["lifecycle_status"] for p in body["items"]} <= {"ON_HOLD", "CLOSED"}
    _, lookups = api.call("GET", "/api/projects/lookups", token=token)
    dept = lookups["departments"][0]["id"]
    _, body = api.call("GET", "/api/projects", token=token, query={"department_id": dept, "priority": "HIGH", "page_size": "100"})
    assert all(p["department"]["id"] == dept and p["priority"] == "HIGH" for p in body["items"])
    _, active = api.call("GET", "/api/projects", token=token, query={"lifecycle_status": "ACTIVE", "page_size": "1"})
    _, no_health = api.call("GET", "/api/projects", token=token, query={"health": "NONE", "page_size": "100"})
    # health is calculated for Active projects only; every other project has none
    assert no_health["total"] == _live_projects(database) - active["total"]
    assert all(p["lifecycle_status"] != "ACTIVE" for p in no_health["items"])
    _, red = api.call("GET", "/api/projects", token=token, query={"health": "RED", "page_size": "100"})
    assert all(p["health_overall"] == "RED" and p["health_reasons"] for p in red["items"])


@pytest.mark.parametrize("query", [{"lifecycle_status": "DONE"}, {"department_id": "x"}, {"sort": "id;drop"}, {"page_size": "0"}])
def test_invalid_filters_are_400(api, query):
    status, body = api.call("GET", "/api/projects", token=api.token("pmo"), query=query)
    assert status == 400 and body["error"]["code"] == "VALIDATION_ERROR"


def test_sorting(api):
    _, body = api.call("GET", "/api/projects", token=api.token("exec"), query={"sort": "-approved_budget", "page_size": "10"})
    budgets = [p["approved_budget"] for p in body["items"]]
    assert budgets == sorted(budgets, reverse=True)


def test_detail_and_404(api):
    token = api.token("exec")
    _, body = api.call("GET", "/api/projects", token=token, query={"q": "Data Lake"})
    project_id = body["items"][0]["id"]
    status, body = api.call("GET", f"/api/projects/{project_id}", token=token)
    assert status == 200 and body["project"]["name"] == "Data Lake Modernisation" and "description" in body["project"]
    assert api.call("GET", f"/api/projects/{uuid.uuid4()}", token=token)[0] == 404
    # PM Analysts only see projects they are assigned to (Data Lake is assigned to analyst1, not analyst2)
    assert api.call("GET", f"/api/projects/{project_id}", token=api.token("analyst1"))[0] == 200
    assert api.call("GET", f"/api/projects/{project_id}", token=api.token("analyst2"))[0] == 403


def test_lookups(api):
    status, body = api.call("GET", "/api/projects/lookups", token=api.token("pm"))
    assert status == 200 and len(body["departments"]) == 8 and len(body["project_managers"]) >= 16
    assert {a["display_name"] for a in body["analysts"]} == {"Sam Okafor", "Riley Chen"}


def test_unknown_route_404_with_error_shape(api):
    status, body = api.call("DELETE", "/api/projects", token=api.token("pmo"))
    assert status == 404 and set(body["error"]) == {"code", "message", "details"}


def test_analyst_portfolio_is_limited_to_assigned_projects(api, database):
    status, body = api.call("GET", "/api/projects", token=api.token("analyst1"), query={"page_size": "100"})
    assert status == 200
    names = {p["name"] for p in body["items"]}
    assert {"Customer Portal Rebuild", "Data Lake Modernisation", "HR Self-Service Portal"} <= names
    assert "Payments Gateway Upgrade" not in names and "Branch Network Refresh" not in names
    assigned = {r["name"] for r in database.execute(
        "SELECT p.name FROM projects p JOIN project_analysts pa ON pa.project_id = p.id JOIN users u ON u.id = pa.user_id "
        "WHERE u.email = 'analyst1@acme.example' AND pa.removed_at IS NULL AND p.archived_at IS NULL").fetchall()}
    assert names == assigned


def test_pm_mine_filter(api):
    _, body = api.call("GET", "/api/projects", token=api.token("pm"), query={"mine": "true", "page_size": "100"})
    assert body["total"] >= 4 and all(p["pm"]["display_name"] == "Jordan Lee" for p in body["items"])


@pytest.mark.parametrize("path", ["/api/projects", "/api/projects/lookups"])
def test_admin_has_no_access_to_project_data(api, path):
    """Lead decision (ASSUMPTION R1): the Admin manages users and access, not projects."""
    status, body = api.call("GET", path, token=api.token("admin"))
    assert status == 403 and body["error"]["code"] == "FORBIDDEN"


def test_admin_cannot_read_a_project_or_its_children(api, database):
    pid = database.execute("SELECT id FROM projects WHERE name = 'Customer Portal Rebuild'").fetchone()["id"]
    for suffix in ("", "/milestones", "/tasks", "/status-updates", "/team", "/audit"):
        assert api.call("GET", f"/api/projects/{pid}{suffix}", token=api.token("admin"))[0] == 403, suffix


def test_departments_are_the_business_departments(api):
    _, body = api.call("GET", "/api/projects/lookups", token=api.token("pmo"))
    assert sorted(d["name"] for d in body["departments"]) == sorted([
        "Finance", "Human Resources", "Operations", "Sales", "Marketing", "Legal and Compliance",
        "Customer Service", "Supply Chain"])


def test_default_sort_is_needs_attention(api, database):
    """Red before Amber before Green before non-Active; flagged before plain within a colour; then priority, budget."""
    _, body = api.call("GET", "/api/projects", token=api.token("pmo"), query={"page_size": "100"})
    _, page2 = api.call("GET", "/api/projects", token=api.token("pmo"), query={"page_size": "100", "page": "2"})
    rows = body["items"] + page2["items"]
    rank = {"RED": 0, "AMBER": 1, "GREEN": 2, None: 3}
    flagged = lambda p: 0 if set(p["flags"]) & {"STATUS_MISMATCH", "UPDATE_OVERDUE"} else 1  # noqa: E731
    prio = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}
    keys = [(rank[p["health_overall"]], flagged(p), prio[p["priority"]], -p["approved_budget"]) for p in rows]
    assert keys == sorted(keys)  # whole list in "needs attention" order across pages
    assert rows[0]["health_overall"] == "RED"
    reds = [p for p in rows if p["health_overall"] == "RED"]
    first_plain = next(i for i, p in enumerate(reds) if not flagged(p) == 0)
    assert all(flagged(p) == 0 for p in reds[:first_plain])  # Red with mismatch before plain Red
    explicit = api.call("GET", "/api/projects", token=api.token("pmo"), query={"page_size": "100", "sort": "attention"})[1]
    assert [p["id"] for p in explicit["items"]] == [p["id"] for p in body["items"]]


def test_attention_sort_high_priority_before_low_within_same_health(api, database):
    """Two otherwise identical Green, unflagged projects: High priority comes before Low."""
    pmo = api.token("pmo")
    _, lk = api.call("GET", "/api/projects/lookups", token=pmo)
    ids = {}
    for prio in ("LOW", "HIGH"):
        _, created = api.call("POST", "/api/projects", {
            "name": f"Sort {prio} {uuid.uuid4().hex[:6]}", "department_id": lk["departments"][0]["id"],
            "pm_user_id": lk["project_managers"][0]["id"], "planned_start": "2030-01-01", "planned_end": "2030-06-01",
            "approved_budget": 1000, "lifecycle_status": "PROPOSED", "priority": prio}, token=pmo)
        ids[prio] = created["project"]["id"]
    _, body = api.call("GET", "/api/projects", token=pmo, query={"q": "Sort ", "page_size": "100"})
    order = [p["id"] for p in body["items"]]
    assert order.index(ids["HIGH"]) < order.index(ids["LOW"])
