"""Executive dashboard summary (the minimum the brief requires; lead decision on scope).

- Health counts by department use calculated health of ACTIVE projects only (CONFIRMED); other
  lifecycle states are reported as an excluded count.
- People allocation bands use the configured thresholds (CONFIRMED: > 60 severe, > 40 over).
- Budget against plan per department sums the health engine's own stored metrics (approved budget,
  planned spend to date = budget × elapsed %, actual = weekly spend to date), so the dashboard can
  never disagree with project pages. Variance % = (actual − planned) ÷ planned × 100.
"""

from datetime import date
from typing import Any

from psycopg import Connection

import portfolio_repository as repo
from beacon import health_store, rbac
from beacon.auth import Principal
from beacon.validation import Fields


def _variance(actual: float, planned: float) -> float | None:
    return round((actual - planned) / planned * 100, 1) if planned else None


def summary(conn: Connection, principal: Principal, query: dict[str, str]) -> tuple[int, dict[str, Any]]:
    """Dashboard figures, optionally for one department."""
    rbac.require(principal, "portfolio.read")
    fields = Fields(query)
    department_id = fields.uuid("department_id")
    fields.raise_if_errors("Invalid query parameters.")
    health_store.refresh_stale(conn)
    rules = {"allocation_standard_hours": 40.0, "allocation_severe_hours": 60.0, **health_store.load_rules(conn)}
    rows = repo.health_by_department(conn, department_id)
    by_department, budget_rows = [], []
    totals = {"approved": 0.0, "planned_to_date": 0.0, "actual_to_date": 0.0}
    counts = {"RED": 0, "AMBER": 0, "GREEN": 0}
    for r in rows:
        dept = {"id": r["id"], "name": r["name"]}
        by_department.append({"department": dept, "red": r["red"], "amber": r["amber"], "green": r["green"], "active": r["active"]})
        counts["RED"] += r["red"]
        counts["AMBER"] += r["amber"]
        counts["GREEN"] += r["green"]
        approved, planned, actual = float(r["approved"]), float(r["planned_to_date"]), float(r["actual_to_date"])
        budget_rows.append({"department": dept, "approved": round(approved, 2), "planned_to_date": round(planned, 2),
                            "actual_to_date": round(actual, 2), "variance_pct": _variance(actual, planned)})
        totals["approved"] += approved
        totals["planned_to_date"] += planned
        totals["actual_to_date"] += actual
    totals = {k: round(v, 2) for k, v in totals.items()}
    totals["variance_pct"] = _variance(totals["actual_to_date"], totals["planned_to_date"])
    return 200, {
        "health_counts": counts,
        "health_by_department": by_department,
        "excluded_projects": repo.excluded_count(conn, department_id),
        "people": repo.people_load(conn, date.today(), rules["allocation_standard_hours"], rules["allocation_severe_hours"],
                                   department_id),
        "budget_by_department": budget_rows,
        "totals": totals,
    }
