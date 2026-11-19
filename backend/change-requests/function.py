"""Change-requests service: the approval queue for PM Analyst proposals.

Proposals are CREATED under the project (``POST /api/projects/{id}/change-requests``, projects
service). This service lists and decides them. Routes (cloud ``/api/change-requests/...``):
    GET  /                    ?view=approvals|mine&status=PENDING|APPROVED|REJECTED&page&page_size
    POST /{id}/approve        the project's PM only; 409 if the record changed since the proposal
    POST /{id}/reject         the project's PM only; body {"reason": "..."} required
"""

import change_requests_service as service
from beacon import logs
from beacon.http import Request, Router

logs.configure()
router = Router("change-requests")


@router.route("GET", "/")
def list_requests(req: Request, conn) -> tuple:
    """Approval queue or own proposals."""
    return service.list_requests(conn, req.user, req.query)


@router.route("POST", "/{id}/approve")
def approve(req: Request, conn) -> tuple:
    """Approve and apply."""
    return service.approve(conn, req.user, req.params["id"])


@router.route("POST", "/{id}/reject")
def reject(req: Request, conn) -> tuple:
    """Reject with a reason."""
    return service.reject(conn, req.user, req.params["id"], req.json() if req.body_raw else {})


def handler(event: dict | None = None, context: object = None) -> dict:
    """Lambda entry point."""
    return router.handle(event or {}, context)
