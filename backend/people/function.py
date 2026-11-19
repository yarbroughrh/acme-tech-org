"""People service: the people view (load across projects).

Routes (cloud ``/api/people...``; local proxy strips ``/api/people``):
    GET /     ?q=&department_id=&load=UNDER|OVER|SEVERE&page&page_size&sort=name|-total_hours
"""

import people_service
from beacon import logs
from beacon.http import Request, Router

logs.configure()
router = Router("people")


@router.route("GET", "/")
def list_people(req: Request, conn) -> tuple:
    """People with current load."""
    return people_service.list_people(conn, req.user, req.query)


def handler(event: dict | None = None, context: object = None) -> dict:
    """Lambda entry point."""
    return router.handle(event or {}, context)
