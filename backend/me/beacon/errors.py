"""API error types and the single JSON error shape.

Every error response is ``{"error": {"code": str, "message": str, "details": list}}``.
"""

from typing import Any


class ApiError(Exception):
    """Base class for errors that map to an HTTP response."""

    status: int = 500
    code: str = "INTERNAL"

    def __init__(self, message: str, details: list[dict[str, Any]] | None = None, code: str | None = None):
        super().__init__(message)
        self.message = message
        self.details = details or []
        if code:
            self.code = code

    def to_body(self) -> dict[str, Any]:
        """Return the JSON error body."""
        return {"error": {"code": self.code, "message": self.message, "details": self.details}}


class ValidationError(ApiError):
    """400: malformed request or field validation failure."""

    status = 400
    code = "VALIDATION_ERROR"


class Unauthenticated(ApiError):
    """401: missing, invalid or expired credentials."""

    status = 401
    code = "UNAUTHENTICATED"


class Forbidden(ApiError):
    """403: authenticated but not allowed."""

    status = 403
    code = "FORBIDDEN"


class NotFound(ApiError):
    """404: resource or route not found."""

    status = 404
    code = "NOT_FOUND"


class Conflict(ApiError):
    """409: stale version, duplicate value or idempotency key reuse."""

    status = 409
    code = "CONFLICT"


def field_error(field: str, message: str) -> dict[str, str]:
    """Build one validation detail entry."""
    return {"field": field, "message": message}
