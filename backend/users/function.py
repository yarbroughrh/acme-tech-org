"""Users service: Admin user management, plus the IAM-only seed action.

Routes (cloud ``/api/users/...``; local proxy strips ``/api/users``):
    GET  /                        list (q, role, page, page_size, sort)
    POST /                        create (returns a one-time temporary password)
    GET  /audit                   user and access changes (Admin)
    GET  /{id}                    one user
    PUT  /{id}                    update display_name / role / is_active (requires version)
    POST /{id}/reset-password     issue a temporary password
    POST /{id}/unlock             clear a lockout

Non-HTTP event ``{"action": "seed"}`` (direct ``aws lambda invoke`` only; never reachable through
CloudFront because Function URL events always carry ``requestContext``) seeds demo data (ADR-003).
"""

import logging

import users_service
from beacon import db, logs, migrations, seed
from beacon.http import Request, Router

logs.configure()
logger = logging.getLogger(__name__)
router = Router("users")


@router.route("GET", "/")
def list_users(req: Request, conn) -> tuple[int, dict]:
    """List users."""
    return users_service.list_users(conn, req.user, req.query)


@router.route("POST", "/")
def create_user(req: Request, conn) -> tuple[int, dict]:
    """Create a user."""
    return users_service.create_user(conn, req.user, req.json())


@router.route("GET", "/audit")
def access_audit(req: Request, conn) -> tuple[int, dict]:
    """User and access audit (Admin only)."""
    return users_service.access_audit(conn, req.user, req.query)


@router.route("GET", "/{id}")
def get_user(req: Request, conn) -> tuple[int, dict]:
    """Get one user."""
    return users_service.get_user(conn, req.user, req.params["id"])


@router.route("PUT", "/{id}")
def update_user(req: Request, conn) -> tuple[int, dict]:
    """Update a user."""
    return users_service.update_user(conn, req.user, req.params["id"], req.json())


@router.route("POST", "/{id}/reset-password")
def reset_password(req: Request, conn) -> tuple[int, dict]:
    """Reset a user's password."""
    return users_service.reset_password(conn, req.user, req.params["id"])


@router.route("POST", "/{id}/unlock")
def unlock(req: Request, conn) -> tuple[int, dict]:
    """Unlock a user."""
    return users_service.unlock(conn, req.user, req.params["id"])


def handler(event: dict | None = None, context: object = None) -> dict:
    """Lambda entry point: HTTP events go to the router; the seed action is IAM-invoke only."""
    event = event or {}
    if "requestContext" not in event and event.get("action") == "seed":
        migrations.ensure_migrated()
        result = seed.run_seed(db.get_connection())
        logger.info("seed result", extra={"fields": {"seed": result.get("status")}})
        return result
    return router.handle(event, context)
