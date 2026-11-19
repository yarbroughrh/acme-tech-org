"""SQL for Admin user management (users table)."""

from typing import Any

from psycopg import Connection

from beacon.db import fetch_all, fetch_one

PUBLIC_COLUMNS = (
    "u.id, u.email, u.display_name, u.role, u.is_active, u.must_change_password, "
    "(u.locked_until IS NOT NULL AND u.locked_until > now()) AS is_locked, u.locked_until, "
    "u.last_login_at, u.version, u.created_at, u.updated_at"
)

SORTS = {"display_name": "lower(u.display_name)", "email": "lower(u.email)", "role": "u.role",
         "created_at": "u.created_at", "last_login_at": "u.last_login_at"}


def list_users(conn: Connection, q: str | None, role: str | None, limit: int, offset: int,
               order_by: str) -> tuple[list[dict], int]:
    """Return one page of users matching the search and role filter, plus the total count."""
    where, params = ["true"], []
    if q:
        where.append("(lower(u.display_name) LIKE %s OR lower(u.email) LIKE %s)")
        like = f"%{q.lower()}%"
        params += [like, like]
    if role:
        where.append("u.role = %s")
        params.append(role)
    rows = fetch_all(conn, f"SELECT {PUBLIC_COLUMNS}, count(*) OVER () AS total FROM users u "
                           f"WHERE {' AND '.join(where)} ORDER BY {order_by}, u.id LIMIT %s OFFSET %s",
                     params + [limit, offset])
    total = rows[0]["total"] if rows else _count(conn, where, params)
    for row in rows:
        row.pop("total", None)
    return rows, total


def _count(conn: Connection, where: list[str], params: list) -> int:
    return fetch_one(conn, f"SELECT count(*) AS n FROM users u WHERE {' AND '.join(where)}", params)["n"]


def get_user(conn: Connection, user_id: str, for_update: bool = False) -> dict | None:
    """Fetch one user (public columns), optionally locking the row."""
    lock = " FOR UPDATE" if for_update else ""
    return fetch_one(conn, f"SELECT {PUBLIC_COLUMNS} FROM users u WHERE u.id = %s{lock}", (user_id,))


def email_exists(conn: Connection, email: str) -> bool:
    """True when another user already has this email (case-insensitive)."""
    return fetch_one(conn, "SELECT 1 AS x FROM users WHERE lower(email) = lower(%s)", (email,)) is not None


def insert_user(conn: Connection, actor_id: str, email: str, display_name: str, role: str,
                password_hash: str) -> dict:
    """Create a user who must change the temporary password at first sign-in."""
    row = fetch_one(conn,
                    "INSERT INTO users (email, display_name, role, password_hash, must_change_password, updated_by) "
                    "VALUES (%s, %s, %s, %s, true, %s) RETURNING id", (email, display_name, role, password_hash, actor_id))
    return get_user(conn, row["id"])


def update_user(conn: Connection, actor_id: str, user_id: str, version: int, changes: dict[str, Any],
                revoke_sessions: bool) -> dict | None:
    """Apply ``changes`` if ``version`` still matches (optimistic concurrency); None if stale."""
    sets = [f"{column} = %s" for column in changes] + ["version = version + 1", "updated_at = now()", "updated_by = %s"]
    if revoke_sessions:
        sets.append("token_epoch = token_epoch + 1")
    row = fetch_one(conn, f"UPDATE users SET {', '.join(sets)} WHERE id = %s AND version = %s RETURNING id",
                    list(changes.values()) + [actor_id, user_id, version])
    return get_user(conn, row["id"]) if row else None


def last_changed_by(conn: Connection, user_id: str) -> dict | None:
    """Who last changed the user, for 409 messages."""
    return fetch_one(conn, "SELECT u.updated_at, a.display_name AS updated_by_name FROM users u "
                           "LEFT JOIN users a ON a.id = u.updated_by WHERE u.id = %s", (user_id,))


def set_temporary_password(conn: Connection, actor_id: str, user_id: str, password_hash: str) -> dict:
    """Store a temporary password, force a change at next sign-in, unlock, and revoke sessions."""
    fetch_one(conn, "UPDATE users SET password_hash = %s, must_change_password = true, failed_attempts = 0, "
                    "locked_until = NULL, token_epoch = token_epoch + 1, version = version + 1, updated_at = now(), "
                    "updated_by = %s WHERE id = %s RETURNING id", (password_hash, actor_id, user_id))
    return get_user(conn, user_id)


def unlock(conn: Connection, actor_id: str, user_id: str) -> dict:
    """Clear the lockout."""
    fetch_one(conn, "UPDATE users SET failed_attempts = 0, locked_until = NULL, version = version + 1, "
                    "updated_at = now(), updated_by = %s WHERE id = %s RETURNING id", (actor_id, user_id))
    return get_user(conn, user_id)
