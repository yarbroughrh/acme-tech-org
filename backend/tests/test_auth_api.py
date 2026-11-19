"""Sign-in, lockout, password change, session renewal and revocation (integration)."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from beacon import auth, seed_config

DEMO = {a["key"]: a for a in seed_config.DEMO_ACCOUNTS}
GENERIC = "Sign-in failed."


def _new_user(database, role="PMO", password="Start!Password1", must_change=False, active=True) -> str:
    email = f"u{uuid.uuid4().hex[:10]}@acme.example"
    database.execute("INSERT INTO users (email, display_name, role, password_hash, must_change_password, is_active) "
                     "VALUES (%s, 'Test User', %s, %s, %s, %s)",
                     (email, role, auth.hash_password(password), must_change, active))
    return email


@pytest.mark.parametrize("key", [a["key"] for a in seed_config.DEMO_ACCOUNTS])
def test_every_demo_account_can_sign_in(api, key):
    status, body = api.login(DEMO[key]["email"], DEMO[key]["password"])
    assert status == 200
    assert body["user"]["role"] == DEMO[key]["role"] and body["token"] and body["expires_at"]
    assert "password_hash" not in body["user"]


def test_login_is_case_insensitive_on_email(api):
    status, _ = api.login(DEMO["exec"]["email"].upper(), DEMO["exec"]["password"])
    assert status == 200


def test_wrong_password_and_unknown_email_give_identical_generic_errors(api):
    s1, b1 = api.login(DEMO["exec"]["email"], "Wrong!Password1")
    s2, b2 = api.login("nobody@acme.example", "Wrong!Password1")
    assert s1 == s2 == 401
    assert b1 == b2
    assert b1["error"]["message"].startswith(GENERIC)


def test_login_validation(api):
    status, body = api.login("", "")
    assert status == 400 and {d["field"] for d in body["error"]["details"]} == {"email", "password"}
    status, body = api.call("POST", "/api/auth/login", raw_body="{not json")
    assert status == 400 and body["error"]["code"] == "VALIDATION_ERROR"


def test_lockout_after_five_failures_then_admin_unlock(api, database):
    email = _new_user(database)
    for attempt in range(4):
        assert api.login(email, "Wrong!Password1")[0] == 401
    assert api.login(email, "Start!Password1")[0] == 200  # 4 failures: not locked; success resets counter
    for attempt in range(5):
        assert api.login(email, "Wrong!Password1")[0] == 401
    status, body = api.login(email, "Start!Password1")  # locked: even the right password fails, generically
    assert status == 401 and body["error"]["message"].startswith(GENERIC)
    user_id = database.execute("SELECT id FROM users WHERE email = %s", (email,)).fetchone()["id"]
    status, body = api.call("POST", f"/api/users/{user_id}/unlock", token=api.token("admin"))
    assert status == 200 and body["user"]["is_locked"] is False
    assert api.login(email, "Start!Password1")[0] == 200


def test_lock_expires_after_15_minutes(api, database):
    email = _new_user(database)
    database.execute("UPDATE users SET locked_until = now() - interval '1 second' WHERE email = %s", (email,))
    assert api.login(email, "Start!Password1")[0] == 200


def test_inactive_user_cannot_sign_in(api, database):
    email = _new_user(database, active=False)
    status, body = api.login(email, "Start!Password1")
    assert status == 401 and body["error"]["message"].startswith(GENERIC)


def test_missing_and_bad_tokens_are_401(api):
    assert api.call("GET", "/api/auth/me")[0] == 401
    assert api.call("GET", "/api/auth/me", token="not.a.jwt")[0] == 401
    assert api.call("GET", "/api/auth/me", headers={"authorization": "Basic abc"})[0] == 401


def test_expired_token_is_401_session_expired(api, database):
    user = database.execute("SELECT id, email, display_name, role, must_change_password, token_epoch FROM users "
                            "WHERE email = %s", (DEMO["exec"]["email"],)).fetchone()
    old = auth.issue_token(database, user, datetime.now(timezone.utc) - timedelta(minutes=31))
    status, body = api.call("GET", "/api/auth/me", token=old["token"])
    assert status == 401 and body["error"]["code"] == "SESSION_EXPIRED"


def test_refresh_issues_new_token(api):
    status, body = api.call("POST", "/api/auth/refresh", token=api.token("exec"))
    assert status == 200 and body["token"]
    assert api.call("GET", "/api/auth/me", token=body["token"])[0] == 200


def test_temporary_password_must_be_changed_first(api, database):
    email = _new_user(database, password="Temp!Password12", must_change=True)
    status, session = api.login(email, "Temp!Password12")
    assert status == 200 and session["user"]["must_change_password"] is True
    token = session["token"]
    status, body = api.call("GET", "/api/projects", token=token)
    assert status == 403 and body["error"]["code"] == "PASSWORD_CHANGE_REQUIRED"
    assert api.call("GET", "/api/auth/me", token=token)[0] == 200
    status, body = api.call("POST", "/api/auth/change-password", {"current_password": "Temp!Password12",
                                                                  "new_password": "short"}, token=token)
    assert status == 400 and body["error"]["details"][0]["field"] == "new_password"
    status, body = api.call("POST", "/api/auth/change-password", {"current_password": "Wrong!Password1",
                                                                  "new_password": "Brand!NewPass99"}, token=token)
    assert status == 400 and body["error"]["details"][0]["field"] == "current_password"
    status, body = api.call("POST", "/api/auth/change-password", {"current_password": "Temp!Password12",
                                                                  "new_password": "Temp!Password12"}, token=token)
    assert status == 400
    status, body = api.call("POST", "/api/auth/change-password", {"current_password": "Temp!Password12",
                                                                  "new_password": "Brand!NewPass99"}, token=token)
    assert status == 200 and body["user"]["must_change_password"] is False
    assert api.call("GET", "/api/auth/me", token=token)[0] == 401  # old session revoked
    assert api.call("GET", "/api/projects", token=body["token"])[0] == 200
    assert api.login(email, "Brand!NewPass99")[0] == 200


def test_sessions_revoked_when_admin_changes_role(api, database):
    email = _new_user(database, role="PMO")
    token = api.login(email, "Start!Password1")[1]["token"]
    user = database.execute("SELECT id, version FROM users WHERE email = %s", (email,)).fetchone()
    status, _ = api.call("PUT", f"/api/users/{user['id']}", {"role": "EXEC", "version": user["version"]},
                         token=api.token("admin"))
    assert status == 200
    status, body = api.call("GET", "/api/projects", token=token)
    assert status == 401 and body["error"]["code"] == "SESSION_EXPIRED"


def test_audit_records_sign_in_without_secrets(api, database):
    api.login(DEMO["pmo"]["email"], DEMO["pmo"]["password"])
    row = database.execute("SELECT before, after FROM audit_log WHERE action = 'SIGNED_IN' ORDER BY id DESC LIMIT 1").fetchone()
    assert row is not None and "password" not in str(row)
