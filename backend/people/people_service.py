"""People view: who is over- or under-allocated, and by how much (CONFIRMED).

Load = weekly hours across all current allocations. Standard capacity 40 h (CONFIRMED): above it
is Over-allocated (Amber), above 60 h Severely over-allocated (Red); below 40 shows available capacity.
Visible to PMO, PMs and Executives; the Admin has no access (lead decision).
"""

from datetime import date
from typing import Any

from psycopg import Connection

import people_repository as repo
from beacon import health_store, rbac
from beacon.auth import Principal
from beacon.errors import ValidationError, field_error
from beacon.http import page_params, paged
from beacon.validation import Fields

LOADS = ("UNDER", "OVER", "SEVERE")


def _status(total: float, standard: float, severe: float) -> str:
    if total > severe:
        return "SEVERE"
    if total > standard:
        return "OVER"
    return "OK" if total == standard else "UNDER"


def list_people(conn: Connection, principal: Principal, query: dict[str, str]) -> tuple[int, dict]:
    """Searchable, filterable, paginated people list with load."""
    rbac.require(principal, "people.read")
    limit, offset, order_by = page_params(query, repo.SORTS, "name")
    load = query.get("load") or None
    if load and load not in LOADS:
        raise ValidationError("Invalid query parameters.", [field_error("load", f"load must be one of: {', '.join(LOADS)}.")])
    department_id = Fields(query).uuid("department_id")
    rules = {"allocation_standard_hours": 40.0, "allocation_severe_hours": 60.0, **health_store.load_rules(conn)}
    standard, severe = rules["allocation_standard_hours"], rules["allocation_severe_hours"]
    items, total = repo.list_people(conn, date.today(), (query.get("q") or "").strip()[:120] or None, department_id,
                                    load, standard, severe, limit, offset, order_by)
    for item in items:
        hours = float(item["total_hours"])
        item["total_hours"] = hours
        item["available_hours"] = max(standard - hours, 0)
        item["load_status"] = _status(hours, standard, severe)
    return 200, paged(items, total, query)
