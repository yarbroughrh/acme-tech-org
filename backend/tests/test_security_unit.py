"""Password policy, hashing, tokens and RBAC map: pure unit tests."""

from datetime import datetime, timedelta, timezone

import jwt
import pytest

from beacon import auth, config, rbac
from beacon.auth import Principal
from beacon.errors import Forbidden


@pytest.mark.parametrize("password, ok", [
    ("Abcdefghij1!", True),          # exactly 12
    ("Abcdefghi1!", False),          # 11: too short
    ("abcdefghij1!", False),         # no upper
    ("ABCDEFGHIJ1!", False),         # no lower
    ("Abcdefghijk!", False),         # no digit
    ("Abcdefghijk1", False),         # no symbol
    ("A1!" + "a" * 125, True),       # 128: max
    ("A1!" + "a" * 126, False),      # 129: too long
])
def test_password_policy_boundaries(password, ok):
    assert (auth.password_policy_errors(password) == []) is ok


def test_password_policy_rejects_non_string():
    assert auth.password_policy_errors(None) == ["Password is required."]


def test_hash_is_salted_pbkdf2_at_owasp_iterations():
    first, second = auth.hash_password("Abcdefghij1!"), auth.hash_password("Abcdefghij1!")
    assert first != second  # random salt
    scheme, iterations, _, _ = first.split("$")
    assert scheme == "pbkdf2_sha256" and int(iterations) == 600_000 == config.PBKDF2_ITERATIONS
    assert auth.verify_password("Abcdefghij1!", first)
    assert not auth.verify_password("Abcdefghij1?", first)


def test_verify_rejects_missing_or_malformed_hash():
    assert not auth.verify_password("anything", None)
    assert not auth.verify_password("anything", "not-a-hash")
    assert not auth.verify_password("anything", "md5$1$abc$def")


def test_temporary_password_meets_policy():
    for _ in range(20):
        assert auth.password_policy_errors(auth.generate_temporary_password()) == []


def _principal(role: str) -> Principal:
    return Principal("u1", role, "x@acme.example", "X", False, None)


def test_rbac_every_action_names_only_known_roles():
    for action, grants in rbac.PERMISSIONS.items():
        assert set(grants) <= set(rbac.ROLES), action
        assert set(grants.values()) <= {rbac.ALL, rbac.OWN}, action


def test_rbac_has_no_health_override_action():
    assert not any("override" in action for action in rbac.PERMISSIONS)


@pytest.mark.parametrize("role, action, expected", [
    ("ADMIN", "users.manage", rbac.ALL),
    ("PMO", "users.manage", None),
    ("ADMIN", "project.edit", None),       # Admin has no control over project data (CONFIRMED)
    ("ADMIN", "project.read", rbac.ALL),   # read-only (ASSUMPTION R1)
    ("EXEC", "project.edit", None),        # Executive read-only
    ("PM", "project.edit", rbac.OWN),
    ("PM", "project.create", None),
    ("PM", "project.set_baseline", None),  # ASSUMPTION R5
    ("PMO", "project.create", rbac.ALL),
    # PM Analyst (CONFIRMED): sees assigned projects, proposes, never edits directly
    ("ANALYST", "project.read", rbac.OWN),
    ("ANALYST", "change_request.propose", rbac.OWN),
    ("ANALYST", "plan.edit", None),
    ("ANALYST", "project.edit", None),
    ("ANALYST", "status_update.submit", None),
    ("ANALYST", "change_request.decide", None),
    ("PM", "change_request.decide", rbac.OWN),
    ("PMO", "change_request.decide", None),   # only the project's own PM decides
    ("PM", "change_request.propose", None),
    ("PM", "analyst.assign", rbac.OWN),
    ("PMO", "status_update.submit", None),
    # Only the Portfolio Manager records actual spend (CONFIRMED)
    ("PMO", "spend.record", rbac.ALL),
    ("PM", "spend.record", None),
    ("ADMIN", "spend.record", None),
    ("EXEC", "spend.record", None),
    ("ANALYST", "spend.record", None),
])
def test_rbac_matrix(role, action, expected):
    assert rbac.scope_for(_principal(role), action) == expected


def test_rbac_allowed_combines_scope_and_ownership():
    assert rbac.allowed(_principal("PM"), "plan.edit", is_owner=True)
    assert not rbac.allowed(_principal("PM"), "plan.edit", is_owner=False)
    assert rbac.allowed(_principal("PMO"), "plan.edit", is_owner=False)
    assert not rbac.allowed(_principal("EXEC"), "plan.edit", is_owner=True)


def test_rbac_require_raises_403_and_owner_check():
    with pytest.raises(Forbidden):
        rbac.require(_principal("EXEC"), "project.edit")
    assert rbac.require(_principal("PM"), "project.edit") == rbac.OWN
    with pytest.raises(Forbidden):
        rbac.require_owner(rbac.OWN, is_owner=False)
    rbac.require_owner(rbac.OWN, is_owner=True)
    rbac.require_owner(rbac.ALL, is_owner=False)


def test_unknown_action_is_a_programming_error():
    with pytest.raises(KeyError):
        rbac.scope_for(_principal("PMO"), "nope")


def test_token_expiry_is_30_minutes():
    assert config.ACCESS_TOKEN_TTL_SECONDS == 1800


def test_issued_token_claims(database):
    user = {"id": "00000000-0000-0000-0000-000000000001", "role": "PMO", "token_epoch": 3,
            "email": "a@acme.example", "display_name": "A", "must_change_password": False}
    now = datetime.now(timezone.utc)
    session = auth.issue_token(database, user, now)
    claims = jwt.decode(session["token"], auth.signing_key(database), algorithms=["HS256"], issuer="beacon")
    assert claims["exp"] - claims["iat"] == 1800 and claims["epoch"] == 3 and claims["role"] == "PMO"
    assert datetime.fromisoformat(session["expires_at"]) - now <= timedelta(seconds=1800)
