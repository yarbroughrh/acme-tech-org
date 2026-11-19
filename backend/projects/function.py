"""Projects service: the portfolio and everything nested under a project.

Routes (cloud ``/api/projects/...``; local proxy strips ``/api/projects``). Static paths are
registered before ``/{id}`` so ``/lookups`` is never mistaken for an id:
    GET /lookups      departments and project managers
    GET /             portfolio list (q, department_id, pm_user_id, lifecycle_status, priority,
                      health, include_archived, page, page_size, sort)
    GET /{id}         project detail
"""

import projects_service
from beacon import logs
from beacon.http import Request, Router

logs.configure()
router = Router("projects")


@router.route("GET", "/lookups")
def lookups(req: Request, conn) -> tuple[int, dict]:
    """Reference data for filters."""
    return projects_service.lookups(conn, req.user)


@router.route("GET", "/")
def list_projects(req: Request, conn) -> tuple[int, dict]:
    """Portfolio list."""
    return projects_service.list_projects(conn, req.user, req.query)


@router.route("GET", "/{id}")
def get_project(req: Request, conn) -> tuple[int, dict]:
    """Project detail."""
    return projects_service.get_project(conn, req.user, req.params["id"])


def handler(event: dict | None = None, context: object = None) -> dict:
    """Lambda entry point."""
    return router.handle(event or {}, context)
