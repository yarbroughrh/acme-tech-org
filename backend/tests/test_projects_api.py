"""Portfolio list/detail/lookups: RBAC, search, filters, sorting, pagination (integration)."""

import uuid

import pytest


@pytest.mark.parametrize("key, expected", [("admin", 200), ("pmo", 200), ("pm", 200), ("exec", 200), ("member", 403)])
def test_portfolio_access_matrix(api, key, expected):
    assert api.call("GET", "/api/projects", token=api.token(key))[0] == expected


def test_portfolio_requires_auth(api):
    assert api.call("GET", "/api/projects")[0] == 401
    assert api.call("GET", "/api/projects/lookups")[0] == 401


def test_pagination_and_total(api):
    status, body = api.call("GET", "/api/projects", token=api.token("exec"), query={"page": "2", "page_size": "50"})
    assert status == 200 and body["total"] == 120 and len(body["items"]) == 50 and body["page"] == 2
    item = body["items"][0]
    assert set(item) >= {"id", "name", "department", "pm", "planned_end", "approved_budget", "lifecycle_status",
                         "priority", "health_overall", "health_reasons", "flags", "version"}


def test_search_by_project_name_and_pm(api):
    token = api.token("exec")
    _, body = api.call("GET", "/api/projects", token=token, query={"q": "customer portal rebuild"})
    assert [p["name"] for p in body["items"]] == ["Customer Portal Rebuild"]
    _, body = api.call("GET", "/api/projects", token=token, query={"q": "Jordan", "page_size": "100"})
    assert body["total"] >= 4 and all(p["pm"]["display_name"] == "Jordan Lee" for p in body["items"])


def test_filters_combine(api):
    token = api.token("pmo")
    _, body = api.call("GET", "/api/projects", token=token, query={"lifecycle_status": "ON_HOLD,CLOSED", "page_size": "100"})
    assert body["total"] >= 6 and {p["lifecycle_status"] for p in body["items"]} <= {"ON_HOLD", "CLOSED"}
    _, lookups = api.call("GET", "/api/projects/lookups", token=token)
    dept = lookups["departments"][0]["id"]
    _, body = api.call("GET", "/api/projects", token=token, query={"department_id": dept, "priority": "HIGH", "page_size": "100"})
    assert all(p["department"]["id"] == dept and p["priority"] == "HIGH" for p in body["items"])
    _, body = api.call("GET", "/api/projects", token=token, query={"health": "NONE", "page_size": "1"})
    assert body["total"] == 120  # health is calculated from slice 3


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
    assert api.call("GET", f"/api/projects/{project_id}", token=api.token("member"))[0] == 403


def test_lookups(api):
    status, body = api.call("GET", "/api/projects/lookups", token=api.token("pm"))
    assert status == 200 and len(body["departments"]) == 7 and len(body["project_managers"]) == 16


def test_unknown_route_404_with_error_shape(api):
    status, body = api.call("DELETE", "/api/projects", token=api.token("pmo"))
    assert status == 404 and set(body["error"]) == {"code", "message", "details"}
