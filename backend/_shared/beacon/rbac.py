"""Role-based access control: ONE declarative role × action map, checked in one place.

Each action maps roles to a scope: ``ALL`` (any record) or ``OWN`` (only records the caller owns;
the ownership check itself lives in the service layer via ``require_owner``). A role missing from
an action is denied (403). There is deliberately no action for overriding calculated health.
Entries marked ASSUMPTION are listed in docs/DECISIONS.md (Part B).
"""

from beacon.errors import Forbidden
from beacon.auth import Principal

ADMIN, PMO, PM, MEMBER, EXEC = "ADMIN", "PMO", "PM", "MEMBER", "EXEC"
ROLES = (ADMIN, PMO, PM, MEMBER, EXEC)
ALL, OWN = "all", "own"

PERMISSIONS: dict[str, dict[str, str]] = {
    # Users and access: Admin only (CONFIRMED)
    "users.manage": {ADMIN: ALL},
    # Viewing: Admin read-only (ASSUMPTION R1); PM sees all (ASSUMPTION R2); Member excluded (ASSUMPTION R3)
    "project.read": {ADMIN: ALL, PMO: ALL, PM: ALL, EXEC: ALL},
    "people.read": {ADMIN: ALL, PMO: ALL, PM: ALL, EXEC: ALL},
    "portfolio.read": {ADMIN: ALL, PMO: ALL, PM: ALL, EXEC: ALL},
    # Portfolio Manager controls the portfolio (CONFIRMED)
    "project.create": {PMO: ALL},
    "project.set_baseline": {PMO: ALL},  # baseline dates + approved budget (ASSUMPTION R5)
    "project.assign_pm": {PMO: ALL},
    "project.archive": {PMO: ALL},
    # Project self-service: PMO any, PM own (CONFIRMED)
    "project.edit": {PMO: ALL, PM: OWN},
    "plan.edit": {PMO: ALL, PM: OWN},  # milestones and tasks
    "allocation.edit": {PMO: ALL, PM: OWN},
    "spend.record": {PMO: ALL},  # Only the Portfolio Manager records actual spend (CONFIRMED R6)
    "status_update.submit": {PM: OWN},
    # Task status by assignee (ASSUMPTION R4)
    "task.update_own_status": {PM: OWN, MEMBER: OWN},
    "tasks.read_own": {PM: OWN, MEMBER: OWN},
    # Rules (ASSUMPTION R7)
    "health_rules.read": {ADMIN: ALL, PMO: ALL, PM: ALL, EXEC: ALL},
    "health_rules.edit": {PMO: ALL},
    # Audit log
    "audit.read": {ADMIN: ALL, PMO: ALL, PM: OWN},
}


def scope_for(principal: Principal, action: str) -> str | None:
    """Return the caller's scope for ``action`` (``ALL``/``OWN``) or None if not permitted."""
    if action not in PERMISSIONS:
        raise KeyError(f"Unknown action: {action}")
    return PERMISSIONS[action].get(principal.role)


def require(principal: Principal, action: str) -> str:
    """Raise 403 unless the caller may perform ``action``; return the scope."""
    scope = scope_for(principal, action)
    if scope is None:
        raise Forbidden("You don't have permission to do that.")
    return scope


def require_owner(scope: str, is_owner: bool) -> None:
    """Raise 403 when the scope is ``OWN`` and the caller does not own the record."""
    if scope == OWN and not is_owner:
        raise Forbidden("You can only change your own projects.")
