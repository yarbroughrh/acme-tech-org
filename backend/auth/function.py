"""Auth service: sign-in, session renewal, current user, password change.

Routes (cloud path ``/api/auth/...``; local proxy strips ``/api/auth``):
    POST /login              public
    POST /refresh            renew a valid 30-minute session
    GET  /me                 current user
    POST /change-password    change own password (allowed while a change is pending)
"""

import auth_service
from beacon import logs
from beacon.http import Request, Router

logs.configure()
router = Router("auth")


@router.route("POST", "/login", public=True)
def login(req: Request, conn) -> tuple[int, dict]:
    """Sign in with email and password."""
    return auth_service.login(conn, req.json())


@router.route("POST", "/refresh", allow_pending_password=True)
def refresh(req: Request, conn) -> tuple[int, dict]:
    """Renew the session."""
    return auth_service.refresh(conn, req.user)


@router.route("GET", "/me", allow_pending_password=True)
def me(req: Request, conn) -> tuple[int, dict]:
    """Return the signed-in user."""
    return auth_service.me(conn, req.user)


@router.route("POST", "/change-password", allow_pending_password=True)
def change_password(req: Request, conn) -> tuple[int, dict]:
    """Change the signed-in user's password."""
    return auth_service.change_password(conn, req.user, req.json())


def handler(event: dict | None = None, context: object = None) -> dict:
    """Lambda entry point."""
    return router.handle(event or {}, context)
