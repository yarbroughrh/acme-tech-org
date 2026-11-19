"""Central configuration: environment settings and security/business constants.

Business thresholds for health live in the ``health_rules`` table (seeded by migration).
Everything here that the stakeholder has not confirmed is marked ASSUMPTION and listed in
docs/DECISIONS.md.
"""

import os

# --- Environment (injected by Terraform; see docs/full-stack.md) ---------------------------
IS_LOCAL: bool = os.getenv("IS_LOCAL", "false") == "true"


def postgres_dsn() -> str:
    """Build the libpq connection string from injected environment variables.

    Cloud connections (IS_LOCAL=false) require TLS (``sslmode=require``).
    """
    parts = {
        "host": os.getenv("POSTGRES_HOST", "localhost"),
        "port": os.getenv("POSTGRES_PORT", "5432"),
        "user": os.getenv("POSTGRES_USER", "postgres"),
        "password": os.getenv("POSTGRES_PASS", "postgres"),
        "dbname": os.getenv("POSTGRES_NAME", "postgres"),
        "connect_timeout": "10",
        "application_name": "beacon",
    }
    if os.getenv("IS_LOCAL", "false") != "true":
        parts["sslmode"] = "require"
    return " ".join(f"{k}={_quote(v)}" for k, v in parts.items())


def _quote(value: str) -> str:
    """Quote a libpq keyword value (handles spaces, quotes and backslashes)."""
    escaped = str(value).replace("\\", "\\\\").replace("'", "\\'")
    return f"'{escaped}'"


# Total time budget for connecting (Aurora Serverless v2 resumes from auto-pause in ~15 s;
# CloudFront gives up at ~30 s, so stay well below).
DB_CONNECT_BUDGET_SECONDS: float = 20.0

# --- Sessions (30-minute expiry CONFIRMED; sliding renewal ASSUMPTION S1) -------------------
ACCESS_TOKEN_TTL_SECONDS: int = 30 * 60
JWT_ALGORITHM: str = "HS256"
JWT_ISSUER: str = "beacon"

# --- Passwords (policy CONFIRMED; lockout values ASSUMPTION S2) -----------------------------
PASSWORD_MIN_LENGTH: int = 12
PASSWORD_MAX_LENGTH: int = 128
PBKDF2_ITERATIONS: int = 600_000  # OWASP Password Storage Cheat Sheet, PBKDF2-HMAC-SHA256
LOCKOUT_MAX_FAILED_ATTEMPTS: int = 5  # ASSUMPTION S2
LOCKOUT_MINUTES: int = 15  # ASSUMPTION S2

# --- Pagination ----------------------------------------------------------------------------
DEFAULT_PAGE_SIZE: int = 20
MAX_PAGE_SIZE: int = 100
