"""Admin user management rules (Admin only, CONFIRMED).

- Creating a user or resetting a password issues a temporary password that must be changed at
  next sign-in (ASSUMPTION S3). It is returned once and never stored in plain text or logged.
- Role changes, deactivation and resets revoke the user's existing sessions immediately.
- An Admin cannot change their own role or deactivate themselves (prevents locking everyone out).
"""

from typing import Any

from psycopg import Connection

import users_repository as repo
from beacon import audit, auth, rbac
from beacon.auth import Principal
from beacon.errors import Conflict, NotFound, ValidationError, field_error
from beacon.http import page_params, paged
from beacon.validation import Fields


def list_users(conn: Connection, principal: Principal, query: dict[str, str]) -> tuple[int, dict]:
    """Paginated, searchable user list."""
    rbac.require(principal, "users.manage")
    limit, offset, order_by = page_params(query, repo.SORTS, "display_name")
    role = query.get("role") or None
    if role and role not in rbac.ROLES:
        raise ValidationError("Invalid query parameters.", [field_error("role", f"role must be one of: {', '.join(rbac.ROLES)}.")])
    items, total = repo.list_users(conn, (query.get("q") or "").strip() or None, role, limit, offset, order_by)
    return 200, paged(items, total, query)


def get_user(conn: Connection, principal: Principal, user_id: str) -> tuple[int, dict]:
    """One user."""
    rbac.require(principal, "users.manage")
    return 200, {"user": _existing(conn, user_id)}


def create_user(conn: Connection, principal: Principal, body: dict[str, Any]) -> tuple[int, dict]:
    """Create a user with a temporary password."""
    rbac.require(principal, "users.manage")
    fields = Fields(body)
    email = fields.email("email", required=True)
    display_name = fields.string("display_name", required=True, max_len=120)
    role = fields.choice("role", rbac.ROLES, required=True)
    fields.raise_if_errors()
    if repo.email_exists(conn, email):
        raise Conflict("A user with this email already exists.", [field_error("email", "Email is already in use.")])
    temporary = auth.generate_temporary_password()
    user = repo.insert_user(conn, principal.user_id, email, display_name, role, auth.hash_password(temporary))
    audit.record(conn, principal.user_id, "user", user["id"], "CREATED", after=user)
    return 201, {"user": user, "temporary_password": temporary}


def update_user(conn: Connection, principal: Principal, user_id: str, body: dict[str, Any]) -> tuple[int, dict]:
    """Change display name, role or active flag, with optimistic concurrency."""
    rbac.require(principal, "users.manage")
    before = _existing(conn, user_id, for_update=True)
    fields = Fields(body, partial=True)
    version = fields.integer("version", required=True, min_value=1)
    changes = {k: v for k, v in {
        "display_name": fields.string("display_name", max_len=120),
        "role": fields.choice("role", rbac.ROLES),
        "is_active": fields.boolean("is_active"),
    }.items() if v is not None}
    fields.raise_if_errors()
    if user_id == principal.user_id and (("role" in changes and changes["role"] != before["role"])
                                         or changes.get("is_active") is False):
        raise ValidationError("You can't change your own role or deactivate your own account.",
                              [field_error("role", "Ask another Admin to make this change.")])
    if version != before["version"]:
        raise _stale(conn, user_id)
    revoke = ("role" in changes and changes["role"] != before["role"]) or changes.get("is_active") is False
    after = repo.update_user(conn, principal.user_id, user_id, version, changes, revoke)
    if after is None:
        raise _stale(conn, user_id)
    audit.record(conn, principal.user_id, "user", user_id, "UPDATED", before=before, after=after)
    return 200, {"user": after}


def reset_password(conn: Connection, principal: Principal, user_id: str) -> tuple[int, dict]:
    """Issue a temporary password (also unlocks the account)."""
    rbac.require(principal, "users.manage")
    _existing(conn, user_id, for_update=True)
    temporary = auth.generate_temporary_password()
    user = repo.set_temporary_password(conn, principal.user_id, user_id, auth.hash_password(temporary))
    audit.record(conn, principal.user_id, "user", user_id, "PASSWORD_RESET")
    return 200, {"user": user, "temporary_password": temporary}


def unlock(conn: Connection, principal: Principal, user_id: str) -> tuple[int, dict]:
    """Clear a lockout."""
    rbac.require(principal, "users.manage")
    _existing(conn, user_id, for_update=True)
    user = repo.unlock(conn, principal.user_id, user_id)
    audit.record(conn, principal.user_id, "user", user_id, "UNLOCKED")
    return 200, {"user": user}


def _existing(conn: Connection, user_id: str, for_update: bool = False) -> dict:
    user = repo.get_user(conn, user_id, for_update)
    if user is None:
        raise NotFound("User not found.")
    return user


def _stale(conn: Connection, user_id: str) -> Conflict:
    info = repo.last_changed_by(conn, user_id) or {}
    who = info.get("updated_by_name") or "someone else"
    when = info.get("updated_at")
    return Conflict("This user was changed by someone else. Reload and try again.",
                    [field_error("version", f"Changed by {who} at {when.isoformat() if when else 'an unknown time'}.")])


def access_audit(conn: Connection, principal: Principal, query: dict[str, str]) -> tuple[int, dict]:
    """Admin view of user and access changes: sign-ins, lockouts, creations, role changes, resets."""
    rbac.require(principal, "audit.access_read")
    limit, offset, _ = page_params(query, {"at": "a.at"}, "-at")
    items, total = repo.access_audit(conn, limit, offset)
    return 200, paged(items, total, query)
