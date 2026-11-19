"""Me service: the signed-in user's own views.

CloudFront routes ``/api/<first segment>*`` to a Lambda of that name, so ``/api/me/...`` needs this
service (ADR-015). Routes (cloud ``/api/me/...``; local proxy strips ``/api/me``):
    GET /work-queue     "Your next actions" for the caller's role, ranked (max 50 + counts)
"""

import work_queue_service
from beacon import logs
from beacon.http import Request, Router

logs.configure()
router = Router("me")


@router.route("GET", "/work-queue")
def work_queue(req: Request, conn) -> tuple:
    """The caller's ranked work queue."""
    return work_queue_service.work_queue(conn, req.user, req.query)


def handler(event: dict | None = None, context: object = None) -> dict:
    """Lambda entry point."""
    return router.handle(event or {}, context)
