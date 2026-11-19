"""Shared test fixtures.

- Unit tests import the canonical shared library (backend/_shared/beacon).
- Integration tests call each service's real Lambda ``handler`` with Function URL events against
  a throwaway local database ``beacon_test`` (dropped and recreated per session), migrated and
  seeded exactly as in the cloud.
"""

import importlib.util
import json
import os
import sys
from datetime import date
from pathlib import Path
from types import ModuleType

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND / "_shared"))  # canonical beacon first
SERVICES = ("auth", "users", "projects", "change-requests", "me", "people")
for _svc in SERVICES:
    sys.path.append(str(BACKEND / _svc))  # service-local modules (auth_service, ...)

TEST_DB = "beacon_test"
os.environ.update({
    "IS_LOCAL": "true", "POSTGRES_HOST": os.getenv("TEST_POSTGRES_HOST", "localhost"),
    "POSTGRES_PORT": "5432", "POSTGRES_USER": "postgres",
    "POSTGRES_PASS": os.getenv("TEST_POSTGRES_PASS", "postgres123"), "POSTGRES_NAME": TEST_DB,
})

from beacon import auth, db, migrations, seed  # noqa: E402
from beacon import seed_config  # noqa: E402

DEMO = {a["key"]: a for a in seed_config.DEMO_ACCOUNTS}
SEED_TODAY = date.today()


def load_service(name: str) -> ModuleType:
    """Import ``backend/<name>/function.py`` under a unique module name."""
    module_name = f"{name}_function"
    if module_name in sys.modules:
        return sys.modules[module_name]
    spec = importlib.util.spec_from_file_location(module_name, BACKEND / name / "function.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def _recreate_database() -> None:
    from psycopg import connect, sql

    admin_dsn = (f"host={os.environ['POSTGRES_HOST']} port=5432 user=postgres "
                 f"password={os.environ['POSTGRES_PASS']} dbname=postgres")
    with connect(admin_dsn, autocommit=True) as conn:
        conn.execute(sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(TEST_DB)))
        conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(TEST_DB)))


@pytest.fixture(scope="session")
def database():
    """A freshly migrated and seeded test database (once per session)."""
    _recreate_database()
    db.reset()
    migrations.reset_flag()
    auth.reset_signing_key_cache()
    migrations.ensure_migrated()
    result = seed.run_seed(db.get_connection(), SEED_TODAY)
    assert result["status"] == "applied"
    yield db.get_connection()
    db.reset()


class Api:
    """Calls service handlers with Lambda Function URL events (cloud-style paths by default)."""

    def call(self, method: str, path: str, body=None, token: str | None = None, query: dict | None = None,
             headers: dict | None = None, raw_body: str | None = None, cloud: bool = True) -> tuple[int, dict]:
        service = path.strip("/").split("/")[1]  # /api/<service>/...
        raw_path = path if cloud else (path[len(f"/api/{service}"):] or "/")
        hdrs = {"content-type": "application/json", **(headers or {})}
        if token:
            hdrs["authorization"] = f"Bearer {token}"
        event = {
            "rawPath": raw_path, "headers": hdrs, "queryStringParameters": query,
            "requestContext": {"http": {"method": method, "path": raw_path}},
            "body": raw_body if raw_body is not None else (json.dumps(body) if body is not None else None),
            "isBase64Encoded": False,
        }
        response = load_service(service).handler(event, None)
        payload = json.loads(response["body"]) if response["body"] else None
        return response["statusCode"], payload

    def login(self, email: str, password: str) -> tuple[int, dict]:
        """Sign in and return (status, body)."""
        return self.call("POST", "/api/auth/login", {"email": email, "password": password})

    def token(self, key: str) -> str:
        """Session token for a demo account (cached per session)."""
        if key not in _TOKENS:
            status, body = self.login(DEMO[key]["email"], DEMO[key]["password"])
            assert status == 200, body
            _TOKENS[key] = body["token"]
        return _TOKENS[key]


_TOKENS: dict[str, str] = {}


@pytest.fixture(scope="session")
def api(database) -> Api:
    """API client bound to the seeded test database."""
    return Api()
