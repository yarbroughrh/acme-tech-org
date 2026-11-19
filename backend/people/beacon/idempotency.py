"""Idempotent creates: a repeated request with the same ``Idempotency-Key`` returns the original result.

Keys are scoped per user. The stored response is written in the same transaction as the create,
so a retry after a timeout never creates a duplicate. Reusing a key for a DIFFERENT request is a
409. Two simultaneous first attempts collide on the primary key; one rolls back with a 409.
"""

import hashlib
import json
from typing import Any, Callable

from psycopg import Connection

from beacon.db import fetch_one
from beacon.errors import Conflict, ValidationError, field_error
from beacon.http import Request, json_default


def run(conn: Connection, req: Request, create: Callable[[], tuple[int, Any]]) -> tuple[int, Any]:
    """Execute ``create`` at most once per (user, Idempotency-Key)."""
    key = (req.headers.get("idempotency-key") or "").strip()
    if not key:
        return create()
    if len(key) > 200:
        raise ValidationError("Invalid Idempotency-Key.", [field_error("Idempotency-Key", "Must be at most 200 characters.")])
    route = f"{req.method} {req.path}"
    request_hash = hashlib.sha256(f"{route}\n{req.body_raw or ''}".encode()).hexdigest()
    previous = fetch_one(conn, "SELECT route, request_hash, status_code, response FROM idempotency_keys "
                               "WHERE user_id = %s AND key = %s", (req.user.user_id, key))
    if previous:
        if previous["request_hash"] != request_hash:
            raise Conflict("This Idempotency-Key was already used for a different request.",
                           [field_error("Idempotency-Key", "Use a new key for a new request.")])
        return previous["status_code"], previous["response"]
    status, body = create()
    if 200 <= status < 300:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO idempotency_keys (user_id, key, route, request_hash, status_code, response) "
                        "VALUES (%s, %s, %s, %s, %s, %s::jsonb)",
                        (req.user.user_id, key, route, request_hash, status, json.dumps(body, default=json_default)))
    return status, body
