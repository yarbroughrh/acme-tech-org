"""Portfolio service: executive dashboard figures.

Routes (cloud ``/api/portfolio/...``; local proxy strips ``/api/portfolio``):
    GET /summary   ?department_id=   health by department (Active only), people load bands,
                                     budget against plan by department (PMO, PM, Executive)
"""

import portfolio_service
from beacon import logs
from beacon.http import Request, Router

logs.configure()
router = Router("portfolio")


@router.route("GET", "/summary")
def summary(req: Request, conn) -> tuple:
    """Dashboard summary."""
    return portfolio_service.summary(conn, req.user, req.query)


def handler(event: dict | None = None, context: object = None) -> dict:
    """Lambda entry point."""
    return router.handle(event or {}, context)
