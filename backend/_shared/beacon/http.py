"""Minimal HTTP router for Lambda Function URL events (payload format 2.0).

Path normalisation: in the cloud CloudFront forwards the full path (``/api/projects/1/x``);
locally ``bin/proxy-server.js`` strips ``/api/<service>`` (``/1/x``). Both reach the same route.

Request lifecycle: migrate (once per container) → match route → authenticate (unless public)
→ handler inside ONE database transaction → JSON response. ApiErrors become the standard error
shape; anything else becomes a generic 500 (details are logged, never returned).
"""

import base64
import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Callable

from psycopg import Connection, errors as pg_errors

from beacon import auth, config, db, logs, migrations
from beacon.errors import ApiError, Conflict, NotFound, ValidationError

logger = logging.getLogger("beacon.http")

Handler = Callable[["Request", Connection], tuple[int, Any]]


@dataclass
class Request:
    """A parsed HTTP request."""

    method: str
    path: str
    params: dict[str, str]
    query: dict[str, str]
    headers: dict[str, str]
    body_raw: str | None
    request_id: str
    principal: auth.Principal | None = None
    route: str = ""
    _json: Any = field(default=None, repr=False)

    def json(self) -> dict[str, Any]:
        """Return the JSON object body, raising a 400 if it is missing or malformed."""
        if self._json is None:
            if not self.body_raw:
                raise ValidationError("Request body is required.")
            try:
                parsed = json.loads(self.body_raw)
            except (ValueError, TypeError) as exc:
                raise ValidationError("Request body must be valid JSON.") from exc
            if not isinstance(parsed, dict):
                raise ValidationError("Request body must be a JSON object.")
            self._json = parsed
        return self._json

    @property
    def user(self) -> auth.Principal:
        """The authenticated principal (routes are authenticated unless marked public)."""
        assert self.principal is not None  # nosec B101 - router guarantees this
        return self.principal


@dataclass
class _Route:
    method: str
    pattern: str
    segments: list[str]
    handler: Handler
    public: bool
    allow_pending_password: bool


def json_default(value: Any) -> Any:
    """Serialise dates, decimals and UUIDs for JSON responses."""
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, uuid.UUID):
        return str(value)
    raise TypeError(f"Not JSON serialisable: {type(value).__name__}")


def _response(status: int, body: Any, request_id: str) -> dict[str, Any]:
    headers = {"Content-Type": "application/json", "Cache-Control": "no-store", "X-Request-Id": request_id}
    if status == 204:
        return {"statusCode": 204, "headers": headers, "body": ""}
    return {"statusCode": status, "headers": headers, "body": json.dumps(body, default=json_default)}


def _is_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
        return True
    except ValueError:
        return False


class Router:
    """Route table for one service. Register static paths before parameterised ones."""

    def __init__(self, service: str):
        self.service = service
        self.routes: list[_Route] = []

    def route(self, method: str, pattern: str, *, public: bool = False,
              allow_pending_password: bool = False) -> Callable[[Handler], Handler]:
        """Decorator registering ``handler`` for ``method`` and ``pattern`` (e.g. ``/{id}/unlock``)."""

        def register(handler: Handler) -> Handler:
            segments = [s for s in pattern.split("/") if s]
            self.routes.append(_Route(method.upper(), pattern, segments, handler, public, allow_pending_password))
            return handler

        return register

    def normalise_path(self, raw_path: str) -> str:
        """Strip an optional ``/api/<service>`` prefix and trailing slashes."""
        path = raw_path or "/"
        prefix = f"/api/{self.service}"
        if path == prefix or path.startswith(prefix + "/"):
            path = path[len(prefix):]
        path = "/" + "/".join(s for s in path.split("/") if s)
        return path

    def match(self, method: str, path: str) -> tuple[_Route, dict[str, str]]:
        """Find the route for ``method`` and ``path``; raise NotFound otherwise."""
        parts = [s for s in path.split("/") if s]
        for route in self.routes:
            if route.method != method or len(route.segments) != len(parts):
                continue
            params: dict[str, str] = {}
            for seg, part in zip(route.segments, parts):
                if seg.startswith("{") and seg.endswith("}"):
                    name = seg[1:-1]
                    if name.endswith("id") and not _is_uuid(part):
                        break
                    params[name] = part
                elif seg != part:
                    break
            else:
                return route, params
        raise NotFound("The requested resource was not found.", code="NOT_FOUND")

    def handle(self, event: dict, context: Any) -> dict[str, Any]:
        """Lambda entry point for HTTP events."""
        started = time.perf_counter()
        logs.clear_context()
        request_id = getattr(context, "aws_request_id", None) or str(uuid.uuid4())
        http = (event.get("requestContext") or {}).get("http") or {}
        method = (http.get("method") or "GET").upper()
        path = self.normalise_path(event.get("rawPath") or http.get("path") or "/")
        logs.set_context(request_id=request_id, service=self.service, method=method, path=path)
        headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
        body = event.get("body")
        if body and event.get("isBase64Encoded"):
            body = base64.b64decode(body).decode("utf-8", errors="replace")
        status = 500
        try:
            route, params = self.match(method, path)
            logs.set_context(route=f"{method} {route.pattern}")
            req = Request(method=method, path=path, params=params,
                          query=dict(event.get("queryStringParameters") or {}),
                          headers=headers, body_raw=body, request_id=request_id, route=route.pattern)
            migrations.ensure_migrated()
            with db.transaction() as conn:
                if not route.public:
                    req.principal = auth.authenticate(conn, headers, route.allow_pending_password)
                    logs.set_context(user_id=req.principal.user_id, role=req.principal.role)
                status, payload = route.handler(req, conn)
            return _response(status, payload, request_id)
        except ApiError as err:
            status = err.status
            return _response(err.status, err.to_body(), request_id)
        except pg_errors.UniqueViolation:
            status = 409
            return _response(409, Conflict("That value is already in use.").to_body(), request_id)
        except pg_errors.IntegrityError:
            # CHECK / FK / NOT NULL constraints are the database's backstop behind API validation.
            status = 400
            return _response(400, ValidationError("The request breaks a data rule. Check the values and try again.").to_body(), request_id)
        except Exception:  # pylint: disable=broad-except
            logger.exception("unhandled error")
            status = 500
            return _response(500, {"error": {"code": "INTERNAL", "message": "Something went wrong on our side. Please try again.", "details": []}}, request_id)
        finally:
            logger.info("request", extra={"fields": {"status": status, "duration_ms": round((time.perf_counter() - started) * 1000)}})


def error_result(err: ApiError) -> tuple[int, dict[str, Any]]:
    """Return an error as a handler result so the transaction still commits (e.g. failed sign-in counters)."""
    return err.status, err.to_body()


def page_params(query: dict[str, str], sorts: dict[str, str], default_sort: str) -> tuple[int, int, str]:
    """Parse ``page``, ``page_size`` and whitelisted ``sort`` into (limit, offset, ORDER BY sql).

    ``sorts`` maps the public sort key to a trusted SQL expression; a leading ``-`` means descending.
    """
    errors = []
    try:
        page = int(query.get("page", "1"))
        if page < 1:
            raise ValueError
    except ValueError:
        errors.append({"field": "page", "message": "page must be a positive integer."})
        page = 1
    try:
        size = int(query.get("page_size", str(config.DEFAULT_PAGE_SIZE)))
        if not 1 <= size <= config.MAX_PAGE_SIZE:
            raise ValueError
    except ValueError:
        errors.append({"field": "page_size", "message": f"page_size must be between 1 and {config.MAX_PAGE_SIZE}."})
        size = config.DEFAULT_PAGE_SIZE
    sort = query.get("sort") or default_sort
    key = sort.lstrip("-")
    if key not in sorts:
        errors.append({"field": "sort", "message": f"sort must be one of: {', '.join(sorted(sorts))} (prefix - for descending)."})
        key, sort = default_sort.lstrip("-"), default_sort
    if errors:
        raise ValidationError("Invalid query parameters.", errors)
    direction = "DESC" if sort.startswith("-") else "ASC"
    return size, (page - 1) * size, f"{sorts[key]} {direction}"


def paged(items: list, total: int, query: dict[str, str]) -> dict[str, Any]:
    """Build the standard paginated response body."""
    return {
        "items": items,
        "page": int(query.get("page", "1")),
        "page_size": int(query.get("page_size", str(config.DEFAULT_PAGE_SIZE))),
        "total": total,
    }
