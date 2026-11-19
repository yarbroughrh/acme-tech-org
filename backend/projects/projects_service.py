"""Project portfolio rules (slice 1: read-only list, detail and lookups).

Visibility follows ``project.read`` in beacon.rbac: Admin read-only (ASSUMPTION R1), PMO and
Executive all, PM all (ASSUMPTION R2), Team member none (ASSUMPTION R3).
"""

import uuid

from psycopg import Connection

import projects_repository as repo
from beacon import rbac
from beacon.auth import Principal
from beacon.errors import NotFound, ValidationError, field_error
from beacon.http import page_params, paged

LIFECYCLE = ("PROPOSED", "ACTIVE", "ON_HOLD", "CLOSED", "CANCELLED")
PRIORITY = ("LOW", "MEDIUM", "HIGH")
HEALTH = ("GREEN", "AMBER", "RED", "NONE")


def _multi(query: dict[str, str], name: str, allowed: tuple[str, ...] | None, errors: list) -> list[str] | None:
    """Parse a comma-separated filter, validating each value."""
    raw = (query.get(name) or "").strip()
    if not raw:
        return None
    values = [v.strip() for v in raw.split(",") if v.strip()]
    for value in values:
        if allowed is not None and value not in allowed:
            errors.append(field_error(name, f"{name} must be one of: {', '.join(allowed)}."))
            return None
        if allowed is None:
            try:
                uuid.UUID(value)
            except ValueError:
                errors.append(field_error(name, f"{name} contains an invalid id."))
                return None
    return values


def list_projects(conn: Connection, principal: Principal, query: dict[str, str]) -> tuple[int, dict]:
    """Server-side search, filter, sort and pagination over the portfolio."""
    rbac.require(principal, "project.read")
    limit, offset, order_by = page_params(query, repo.SORTS, "name")
    errors: list = []
    filters = {
        "q": (query.get("q") or "").strip()[:120] or None,
        "department_id": _multi(query, "department_id", None, errors),
        "pm_user_id": _multi(query, "pm_user_id", None, errors),
        "lifecycle_status": _multi(query, "lifecycle_status", LIFECYCLE, errors),
        "priority": _multi(query, "priority", PRIORITY, errors),
        "health": _multi(query, "health", HEALTH, errors),
        "include_archived": query.get("include_archived") == "true",
    }
    if errors:
        raise ValidationError("Invalid query parameters.", errors)
    items, total = repo.list_projects(conn, filters, limit, offset, order_by)
    return 200, paged(items, total, query)


def get_project(conn: Connection, principal: Principal, project_id: str) -> tuple[int, dict]:
    """One project's details."""
    rbac.require(principal, "project.read")
    project = repo.get_project(conn, project_id)
    if project is None:
        raise NotFound("Project not found.")
    return 200, {"project": project}


def lookups(conn: Connection, principal: Principal) -> tuple[int, dict]:
    """Departments and project managers for filters and forms."""
    rbac.require(principal, "project.read")
    return 200, repo.lookups(conn)
