"""Sign-in, session renewal and password change rules.

- Generic sign-in errors never reveal whether an email exists (CONFIRMED).
- 5 failed sign-ins lock the account for 15 minutes (ASSUMPTION S2; values in beacon.config).
- Locked, inactive and password-less accounts fail with the same generic message and timing.
"""

from datetime import datetime, timedelta, timezone
from typing import Any

from psycopg import Connection

import auth_repository as repo
from beacon import audit, auth, config
from beacon.auth import Principal
from beacon.errors import Unauthenticated, ValidationError, field_error
from beacon.http import error_result
from beacon.validation import Fields

GENERIC_SIGN_IN_ERROR = ("Sign-in failed. Check your email and password and try again. "
                         f"After {config.LOCKOUT_MAX_FAILED_ATTEMPTS} failed attempts, sign-in is paused "
                         f"for {config.LOCKOUT_MINUTES} minutes.")


def login(conn: Connection, body: dict[str, Any], now: datetime | None = None) -> tuple[int, dict]:
    """Authenticate with email and password; return a session or a generic 401."""
    now = now or datetime.now(timezone.utc)
    fields = Fields(body)
    email = fields.string("email", required=True, max_len=254)
    password = fields.string("password", required=True, max_len=config.PASSWORD_MAX_LENGTH)
    fields.raise_if_errors()
    user = repo.get_by_email(conn, email)
    locked = bool(user and user["locked_until"] and user["locked_until"] > now)
    # Always pay the hashing cost so response time does not reveal which case applied.
    password_ok = auth.verify_password(password, None if (user is None or locked) else user["password_hash"])
    if user is None or locked or not password_ok or not user["is_active"]:
        if user is not None and not locked:
            attempts = user["failed_attempts"] + 1
            lock_until = None
            if attempts >= config.LOCKOUT_MAX_FAILED_ATTEMPTS:
                lock_until, attempts = now + timedelta(minutes=config.LOCKOUT_MINUTES), 0
                audit.record(conn, user["id"], "user", user["id"], "LOCKED_OUT",
                             after={"locked_until": lock_until})
            repo.record_failure(conn, user["id"], attempts, lock_until)
        return error_result(Unauthenticated(GENERIC_SIGN_IN_ERROR, code="SIGN_IN_FAILED"))
    repo.record_success(conn, user["id"])
    audit.record(conn, user["id"], "user", user["id"], "SIGNED_IN")
    return 200, auth.issue_token(conn, user, now)


def refresh(conn: Connection, principal: Principal) -> tuple[int, dict]:
    """Issue a fresh 30-minute token for an authenticated, still-valid session (sliding expiry)."""
    user = repo.get_by_id(conn, principal.user_id)
    return 200, auth.issue_token(conn, user)


def me(conn: Connection, principal: Principal) -> tuple[int, dict]:
    """Return the caller's own profile."""
    user = repo.get_by_id(conn, principal.user_id)
    return 200, {"user": {**auth.public_user(user), "person_id": principal.person_id}}


def change_password(conn: Connection, principal: Principal, body: dict[str, Any]) -> tuple[int, dict]:
    """Change the caller's password (required after an Admin reset). Revokes other sessions."""
    fields = Fields(body)
    current = fields.string("current_password", required=True, max_len=config.PASSWORD_MAX_LENGTH)
    new = body.get("new_password")
    fields.raise_if_errors()
    problems = auth.password_policy_errors(new)
    if problems:
        raise ValidationError("The new password does not meet the password policy.",
                              [field_error("new_password", p) for p in problems])
    user = repo.get_by_id(conn, principal.user_id)
    if not auth.verify_password(current, user["password_hash"]):
        raise ValidationError("Please correct the highlighted fields.",
                              [field_error("current_password", "Current password is incorrect.")])
    if current == new:
        raise ValidationError("Please correct the highlighted fields.",
                              [field_error("new_password", "New password must be different from the current one.")])
    updated = repo.set_password(conn, principal.user_id, auth.hash_password(new))
    audit.record(conn, principal.user_id, "user", principal.user_id, "PASSWORD_CHANGED")
    return 200, auth.issue_token(conn, updated)
