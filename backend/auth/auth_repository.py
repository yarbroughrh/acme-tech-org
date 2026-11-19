"""SQL for sign-in, session renewal and password changes (users table)."""

from datetime import datetime

from psycopg import Connection

from beacon.db import execute, fetch_one

_USER_COLUMNS = ("id, email, display_name, role, password_hash, must_change_password, is_active, "
                 "failed_attempts, locked_until, token_epoch")


def get_by_email(conn: Connection, email: str) -> dict | None:
    """Fetch a user by case-insensitive email, locking the row for the sign-in update."""
    return fetch_one(conn, f"SELECT {_USER_COLUMNS} FROM users WHERE lower(email) = lower(%s) FOR UPDATE", (email,))


def get_by_id(conn: Connection, user_id: str) -> dict | None:
    """Fetch a user by id."""
    return fetch_one(conn, f"SELECT {_USER_COLUMNS} FROM users WHERE id = %s FOR UPDATE", (user_id,))


def record_failure(conn: Connection, user_id: str, failed_attempts: int, locked_until: datetime | None) -> None:
    """Store the failed-attempt counter and optional lock expiry."""
    execute(conn, "UPDATE users SET failed_attempts = %s, locked_until = %s WHERE id = %s",
            (failed_attempts, locked_until, user_id))


def record_success(conn: Connection, user_id: str) -> None:
    """Reset the failure counter and stamp the last sign-in."""
    execute(conn, "UPDATE users SET failed_attempts = 0, locked_until = NULL, previous_login_at = last_login_at, "
                  "last_login_at = now() WHERE id = %s", (user_id,))


def set_password(conn: Connection, user_id: str, password_hash: str) -> dict:
    """Store a new password, clear the change requirement and revoke other sessions."""
    return fetch_one(conn,
                     "UPDATE users SET password_hash = %s, must_change_password = false, token_epoch = token_epoch + 1, "
                     "version = version + 1, updated_at = now(), updated_by = id WHERE id = %s "
                     f"RETURNING {_USER_COLUMNS}", (password_hash, user_id))
