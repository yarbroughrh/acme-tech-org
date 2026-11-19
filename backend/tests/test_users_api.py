"""Admin user management: RBAC, validation, conflicts, audit (integration)."""

import uuid

import pytest


def _email() -> str:
    return f"n{uuid.uuid4().hex[:10]}@acme.example"


@pytest.mark.parametrize("key, expected", [("admin", 200), ("pmo", 403), ("pm", 403), ("member", 403), ("exec", 403)])
def test_user_list_access_matrix(api, key, expected):
    assert api.call("GET", "/api/users", token=api.token(key))[0] == expected


def test_user_list_requires_auth(api):
    assert api.call("GET", "/api/users")[0] == 401


def test_list_search_filter_paginate(api):
    status, body = api.call("GET", "/api/users", token=api.token("admin"), query={"role": "PM", "page_size": "5"})
    assert status == 200 and len(body["items"]) == 5 and body["total"] >= 16
    assert all(u["role"] == "PM" for u in body["items"])
    status, body = api.call("GET", "/api/users", token=api.token("admin"), query={"q": "jordan"})
    assert [u["email"] for u in body["items"]] == ["pm@acme.example"]
    assert api.call("GET", "/api/users", token=api.token("admin"), query={"role": "KING"})[0] == 400


def test_create_user_returns_one_time_temporary_password(api, database):
    email = _email()
    status, body = api.call("POST", "/api/users", {"email": email, "display_name": "New Person", "role": "EXEC"},
                            token=api.token("admin"))
    assert status == 201 and body["user"]["must_change_password"] is True
    assert api.login(email, body["temporary_password"])[0] == 200
    row = database.execute("SELECT password_hash FROM users WHERE email = %s", (email,)).fetchone()
    assert body["temporary_password"] not in row["password_hash"]
    audit = database.execute("SELECT after FROM audit_log WHERE entity_id = %s AND action = 'CREATED'",
                             (body["user"]["id"],)).fetchone()
    assert audit and "temporary_password" not in str(audit) and "password_hash" not in str(audit)


def test_create_user_validation_and_duplicate(api):
    status, body = api.call("POST", "/api/users", {"email": "bad", "role": "KING"}, token=api.token("admin"))
    assert status == 400 and {d["field"] for d in body["error"]["details"]} == {"email", "display_name", "role"}
    status, body = api.call("POST", "/api/users", {"email": "PMO@acme.example", "display_name": "Dup", "role": "PM"},
                            token=api.token("admin"))
    assert status == 409


@pytest.mark.parametrize("key", ["pmo", "pm", "member", "exec"])
def test_non_admin_cannot_create_users_privilege_escalation(api, key):
    status, _ = api.call("POST", "/api/users", {"email": _email(), "display_name": "X", "role": "ADMIN"},
                         token=api.token(key))
    assert status == 403


def test_update_with_stale_version_is_409_naming_who(api):
    admin = api.token("admin")
    _, created = api.call("POST", "/api/users", {"email": _email(), "display_name": "V1", "role": "EXEC"}, token=admin)
    user = created["user"]
    status, body = api.call("PUT", f"/api/users/{user['id']}", {"display_name": "V2", "version": user["version"]}, token=admin)
    assert status == 200 and body["user"]["version"] == user["version"] + 1
    status, body = api.call("PUT", f"/api/users/{user['id']}", {"display_name": "V3", "version": user["version"]}, token=admin)
    assert status == 409 and "Avery Admin" in body["error"]["details"][0]["message"]


def test_admin_cannot_demote_or_deactivate_self(api, database):
    me = database.execute("SELECT id, version FROM users WHERE email = 'admin@acme.example'").fetchone()
    for change in ({"role": "EXEC"}, {"is_active": False}):
        status, _ = api.call("PUT", f"/api/users/{me['id']}", {**change, "version": me["version"]}, token=api.token("admin"))
        assert status == 400


def test_reset_password_forces_change(api):
    admin = api.token("admin")
    email = _email()
    _, created = api.call("POST", "/api/users", {"email": email, "display_name": "R", "role": "EXEC"}, token=admin)
    status, body = api.call("POST", f"/api/users/{created['user']['id']}/reset-password", token=admin)
    assert status == 200 and body["user"]["must_change_password"] is True
    assert api.login(email, created["temporary_password"])[0] == 401
    assert api.login(email, body["temporary_password"])[0] == 200


def test_unknown_user_and_bad_id(api):
    admin = api.token("admin")
    assert api.call("GET", f"/api/users/{uuid.uuid4()}", token=admin)[0] == 404
    assert api.call("GET", "/api/users/not-a-uuid", token=admin)[0] == 404
    assert api.call("POST", f"/api/users/{uuid.uuid4()}/unlock", token=admin)[0] == 404


def test_local_style_path_works(api):
    status, _ = api.call("GET", "/api/users", token=api.token("admin"), cloud=False)
    assert status == 200
