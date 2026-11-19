"""Projects service: the portfolio and everything nested under a project.

Routes (cloud ``/api/projects/...``; local proxy strips ``/api/projects``). Static paths are
registered before ``/{id}``. Creates honour ``Idempotency-Key``; updates require ``version``.

    GET  /lookups                               departments, PMs, analysts
    GET  /                                      portfolio list (search, filters, sort, pagination, mine)
    POST /                                      create (PMO)
    GET  /{id}  PUT /{id}                       detail (+health, permissions) / edit
    POST /{id}/archive  POST /{id}/cancel       PMO
    GET  /{id}/team                             allocated people
    GET  /{id}/audit                            audit trail
    GET|POST /{id}/milestones   PUT|DELETE /{id}/milestones/{milestone_id}
    GET|POST /{id}/tasks        PUT|DELETE /{id}/tasks/{task_id}
    GET|POST /{id}/allocations  PUT|DELETE /{id}/allocations/{allocation_id}   (warnings, no hard block)
    GET|POST /{id}/status-updates
    GET|POST /{id}/analysts     DELETE /{id}/analysts/{user_id}
    POST /{id}/change-requests                  PM Analyst proposal
"""

import allocations_service
import collaboration_service as collab
import plan_service
import projects_service
from beacon import idempotency, logs
from beacon.http import Request, Router

logs.configure()
router = Router("projects")


@router.route("GET", "/lookups")
def lookups(req: Request, conn) -> tuple:
    """Reference data."""
    return projects_service.lookups(conn, req.user)


@router.route("GET", "/")
def list_projects(req: Request, conn) -> tuple:
    """Portfolio list."""
    return projects_service.list_projects(conn, req.user, req.query)


@router.route("POST", "/")
def create_project(req: Request, conn) -> tuple:
    """Create a project."""
    return idempotency.run(conn, req, lambda: projects_service.create_project(conn, req.user, req.json()))


@router.route("GET", "/{id}")
def get_project(req: Request, conn) -> tuple:
    """Project detail."""
    return projects_service.get_project(conn, req.user, req.params["id"])


@router.route("PUT", "/{id}")
def update_project(req: Request, conn) -> tuple:
    """Edit a project."""
    return projects_service.update_project(conn, req.user, req.params["id"], req.json())


@router.route("POST", "/{id}/archive")
def archive_project(req: Request, conn) -> tuple:
    """Archive a project."""
    return projects_service.archive_project(conn, req.user, req.params["id"], req.json())


@router.route("POST", "/{id}/cancel")
def cancel_project(req: Request, conn) -> tuple:
    """Cancel a project."""
    return projects_service.cancel_project(conn, req.user, req.params["id"], req.json())


@router.route("GET", "/{id}/team")
def team(req: Request, conn) -> tuple:
    """Allocated people."""
    return projects_service.team(conn, req.user, req.params["id"])


@router.route("GET", "/{id}/audit")
def audit_trail(req: Request, conn) -> tuple:
    """Audit trail."""
    return projects_service.audit_trail(conn, req.user, req.params["id"], req.query)


@router.route("GET", "/{id}/milestones")
def list_milestones(req: Request, conn) -> tuple:
    """Milestones."""
    return plan_service.list_milestones(conn, req.user, req.params["id"])


@router.route("POST", "/{id}/milestones")
def create_milestone(req: Request, conn) -> tuple:
    """Add a milestone."""
    return idempotency.run(conn, req, lambda: plan_service.create_milestone(conn, req.user, req.params["id"], req.json()))


@router.route("PUT", "/{id}/milestones/{milestone_id}")
def update_milestone(req: Request, conn) -> tuple:
    """Edit a milestone."""
    return plan_service.update_milestone(conn, req.user, req.params["id"], req.params["milestone_id"], req.json())


@router.route("DELETE", "/{id}/milestones/{milestone_id}")
def delete_milestone(req: Request, conn) -> tuple:
    """Soft-delete a milestone."""
    return plan_service.delete_milestone(conn, req.user, req.params["id"], req.params["milestone_id"])


@router.route("GET", "/{id}/tasks")
def list_tasks(req: Request, conn) -> tuple:
    """Tasks."""
    return plan_service.list_tasks(conn, req.user, req.params["id"], req.query)


@router.route("POST", "/{id}/tasks")
def create_task(req: Request, conn) -> tuple:
    """Add a task."""
    return idempotency.run(conn, req, lambda: plan_service.create_task(conn, req.user, req.params["id"], req.json()))


@router.route("PUT", "/{id}/tasks/{task_id}")
def update_task(req: Request, conn) -> tuple:
    """Edit a task."""
    return plan_service.update_task(conn, req.user, req.params["id"], req.params["task_id"], req.json())


@router.route("DELETE", "/{id}/tasks/{task_id}")
def delete_task(req: Request, conn) -> tuple:
    """Soft-delete a task."""
    return plan_service.delete_task(conn, req.user, req.params["id"], req.params["task_id"])


@router.route("GET", "/{id}/allocations")
def list_allocations(req: Request, conn) -> tuple:
    """Allocations with load."""
    return allocations_service.list_allocations(conn, req.user, req.params["id"])


@router.route("POST", "/{id}/allocations")
def create_allocation(req: Request, conn) -> tuple:
    """Allocate a person (warnings, no hard block)."""
    return idempotency.run(conn, req, lambda: allocations_service.create_allocation(conn, req.user, req.params["id"], req.json()))


@router.route("PUT", "/{id}/allocations/{allocation_id}")
def update_allocation(req: Request, conn) -> tuple:
    """Change an allocation."""
    return allocations_service.update_allocation(conn, req.user, req.params["id"], req.params["allocation_id"], req.json())


@router.route("DELETE", "/{id}/allocations/{allocation_id}")
def remove_allocation(req: Request, conn) -> tuple:
    """Archive an allocation."""
    return allocations_service.remove_allocation(conn, req.user, req.params["id"], req.params["allocation_id"])


@router.route("GET", "/{id}/status-updates")
def list_status_updates(req: Request, conn) -> tuple:
    """Status updates."""
    return collab.list_status_updates(conn, req.user, req.params["id"])


@router.route("POST", "/{id}/status-updates")
def submit_status_update(req: Request, conn) -> tuple:
    """Submit the weekly status update."""
    return idempotency.run(conn, req, lambda: collab.submit_status_update(conn, req.user, req.params["id"], req.json()))


@router.route("GET", "/{id}/analysts")
def list_analysts(req: Request, conn) -> tuple:
    """Assigned analysts."""
    return collab.list_analysts(conn, req.user, req.params["id"])


@router.route("POST", "/{id}/analysts")
def assign_analyst(req: Request, conn) -> tuple:
    """Assign an analyst."""
    return idempotency.run(conn, req, lambda: collab.assign_analyst(conn, req.user, req.params["id"], req.json()))


@router.route("DELETE", "/{id}/analysts/{user_id}")
def remove_analyst(req: Request, conn) -> tuple:
    """Remove an analyst."""
    return collab.remove_analyst(conn, req.user, req.params["id"], req.params["user_id"])


@router.route("POST", "/{id}/change-requests")
def propose_change(req: Request, conn) -> tuple:
    """PM Analyst proposes a change."""
    return idempotency.run(conn, req, lambda: collab.propose_change(conn, req.user, req.params["id"], req.json()))


def handler(event: dict | None = None, context: object = None) -> dict:
    """Lambda entry point."""
    return router.handle(event or {}, context)
