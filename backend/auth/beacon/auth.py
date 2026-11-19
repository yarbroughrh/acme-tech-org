"""Authentication: password hashing and policy, JWT access tokens, request authentication.

- Passwords: salted PBKDF2-HMAC-SHA256, 600k iterations (OWASP); policy CONFIRMED.
- Tokens: HS256 JWT, 30-minute expiry, renewable while valid (ASSUMPTION S1). Each token carries
  the user's ``token_epoch``; bumping it (role change, reset, deactivation) revokes all sessions.
- The user's role is re-read from the database on every request, never trusted from the token.
"""

import base64
import hashlib
import hmac
import secrets
import string
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from psycopg import Connection

from beacon import config
from beacon.errors import Forbidden, Unauthenticated

_HASH_SCHEME = "pbkdf2_sha256"
_SYMBOLS = set(string.punctuation)
_signing_key: str | None = None


# --- Passwords -------------------------------------------------------------------------------

def password_policy_errors(password: Any) -> list[str]:
    """Return human-readable reasons the password fails the policy (empty list = valid)."""
    if not isinstance(password, str):
        return ["Password is required."]
    problems = []
    if len(password) < config.PASSWORD_MIN_LENGTH:
        problems.append(f"Password must be at least {config.PASSWORD_MIN_LENGTH} characters.")
    if len(password) > config.PASSWORD_MAX_LENGTH:
        problems.append(f"Password must be at most {config.PASSWORD_MAX_LENGTH} characters.")
    if not any(c.isupper() for c in password):
        problems.append("Password must contain an upper-case letter.")
    if not any(c.islower() for c in password):
        problems.append("Password must contain a lower-case letter.")
    if not any(c.isdigit() for c in password):
        problems.append("Password must contain a digit.")
    if not any(c in _SYMBOLS for c in password):
        problems.append("Password must contain a symbol.")
    return problems


def hash_password(password: str, iterations: int = config.PBKDF2_ITERATIONS) -> str:
    """Hash a password as ``pbkdf2_sha256$<iterations>$<salt b64>$<hash b64>``."""
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return "$".join([_HASH_SCHEME, str(iterations),
                     base64.b64encode(salt).decode(), base64.b64encode(digest).decode()])


_DUMMY_HASH = None


def verify_password(password: str, stored: str | None) -> bool:
    """Constant-time password check. A missing hash still costs a full hash (no user-existence timing leak)."""
    global _DUMMY_HASH
    if not stored:
        if _DUMMY_HASH is None:
            _DUMMY_HASH = hash_password(secrets.token_urlsafe(16))
        stored = _DUMMY_HASH
        result_if_match = False
    else:
        result_if_match = True
    try:
        scheme, iterations, salt_b64, hash_b64 = stored.split("$")
        if scheme != _HASH_SCHEME:
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), base64.b64decode(salt_b64), int(iterations))
        return hmac.compare_digest(digest, base64.b64decode(hash_b64)) and result_if_match
    except (ValueError, TypeError):
        return False


def generate_temporary_password() -> str:
    """Generate a random 16-character password that satisfies the policy."""
    alphabet = string.ascii_letters + string.digits + "!#$%&*+-=?@^_"
    while True:
        candidate = "".join(secrets.choice(alphabet) for _ in range(16))
        if not password_policy_errors(candidate):
            return candidate


# --- Tokens ----------------------------------------------------------------------------------

def signing_key(conn: Connection) -> str:
    """Return the JWT signing key, creating it on first use (stored in ``app_secret``; ADR-004)."""
    global _signing_key
    if _signing_key is None:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO app_secret (name, value) VALUES ('jwt_signing_key', %s) "
                        "ON CONFLICT (name) DO NOTHING", (secrets.token_urlsafe(64),))
            cur.execute("SELECT value FROM app_secret WHERE name = 'jwt_signing_key'")
            _signing_key = cur.fetchone()["value"]
    return _signing_key


def reset_signing_key_cache() -> None:
    """Forget the cached key (tests only)."""
    global _signing_key
    _signing_key = None


def issue_token(conn: Connection, user: dict, now: datetime | None = None) -> dict[str, Any]:
    """Issue an access token for ``user`` and return the session response body."""
    now = now or datetime.now(timezone.utc)
    expires = now + timedelta(seconds=config.ACCESS_TOKEN_TTL_SECONDS)
    claims = {
        "sub": str(user["id"]), "role": user["role"], "epoch": user["token_epoch"],
        "iss": config.JWT_ISSUER, "iat": int(now.timestamp()), "exp": int(expires.timestamp()),
    }
    token = jwt.encode(claims, signing_key(conn), algorithm=config.JWT_ALGORITHM)
    return {"token": token, "expires_at": expires.isoformat(timespec="seconds"), "user": public_user(user)}


def public_user(user: dict) -> dict[str, Any]:
    """The user fields safe to return to the client about themselves."""
    return {"id": user["id"], "email": user["email"], "display_name": user["display_name"],
            "role": user["role"], "must_change_password": user["must_change_password"]}


@dataclass(frozen=True)
class Principal:
    """The authenticated caller."""

    user_id: str
    role: str
    email: str
    display_name: str
    must_change_password: bool
    person_id: str | None


def authenticate(conn: Connection, headers: dict[str, str], allow_pending_password: bool = False) -> Principal:
    """Authenticate a request from its ``Authorization: Bearer`` header.

    Raises Unauthenticated (401) for missing/invalid/expired/revoked tokens and Forbidden (403,
    PASSWORD_CHANGE_REQUIRED) when the user must change a temporary password first.
    """
    header = headers.get("authorization") or ""
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise Unauthenticated("Sign in to continue.")
    try:
        claims = jwt.decode(token.strip(), signing_key(conn), algorithms=[config.JWT_ALGORITHM],
                            issuer=config.JWT_ISSUER, options={"require": ["exp", "iat", "sub"]})
    except jwt.ExpiredSignatureError as exc:
        raise Unauthenticated("Your session has expired. Please sign in again.", code="SESSION_EXPIRED") from exc
    except jwt.InvalidTokenError as exc:
        raise Unauthenticated("Sign in to continue.") from exc
    with conn.cursor() as cur:
        cur.execute(
            "SELECT u.id, u.role, u.email, u.display_name, u.must_change_password, u.is_active, "
            "u.token_epoch, p.id AS person_id FROM users u LEFT JOIN people p ON p.user_id = u.id "
            "WHERE u.id = %s", (claims["sub"],))
        user = cur.fetchone()
    if not user or not user["is_active"] or user["token_epoch"] != claims.get("epoch"):
        raise Unauthenticated("Your session is no longer valid. Please sign in again.", code="SESSION_EXPIRED")
    if user["must_change_password"] and not allow_pending_password:
        raise Forbidden("You must change your temporary password before continuing.", code="PASSWORD_CHANGE_REQUIRED")
    return Principal(user_id=str(user["id"]), role=user["role"], email=user["email"],
                     display_name=user["display_name"], must_change_password=user["must_change_password"],
                     person_id=str(user["person_id"]) if user["person_id"] else None)
