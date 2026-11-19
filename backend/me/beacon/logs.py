"""Structured JSON logging carrying request ID, user ID and route.

Never log passwords, tokens or request bodies.
"""

import json
import logging
from contextvars import ContextVar
from datetime import datetime, timezone

request_context: ContextVar[dict] = ContextVar("request_context", default={})


class JsonFormatter(logging.Formatter):
    """Format log records as single-line JSON with the current request context."""

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            **request_context.get(),
        }
        extra = getattr(record, "fields", None)
        if isinstance(extra, dict):
            payload.update(extra)
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure() -> None:
    """Install the JSON formatter on the root logger (idempotent; Lambda pre-installs a handler)."""
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    if not root.handlers:
        root.addHandler(logging.StreamHandler())
    for handler in root.handlers:
        handler.setFormatter(JsonFormatter())


def set_context(**fields: object) -> None:
    """Merge fields (request_id, user_id, route, ...) into the logging context."""
    request_context.set({**request_context.get(), **{k: v for k, v in fields.items() if v is not None}})


def clear_context() -> None:
    """Reset the logging context at the start of a request."""
    request_context.set({})
