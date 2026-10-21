from fastapi import APIRouter

from app.api.v1 import (
    auth,
    birds,
    dashboard,
    farmers,
    flocks,
    lifecycle,
    media,
    owners,
    search,
    sheds,
)
from app.core.config import get_settings

# Vaccination / dose / notification / compliance routers stay unmounted in local/production.
# Models and tables remain for migration integrity and a future rebuild.
# Test environment remounts them so legacy pytest coverage of those tables still runs.

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(owners.router, prefix="/owners", tags=["owners"])
api_router.include_router(search.router, prefix="/search", tags=["search"])
api_router.include_router(sheds.router, prefix="/sheds", tags=["sheds"])
api_router.include_router(farmers.router, prefix="/farmers", tags=["farmers"])
api_router.include_router(flocks.router, prefix="/flocks", tags=["flocks"])
api_router.include_router(birds.router, prefix="/birds", tags=["birds"])
api_router.include_router(lifecycle.router, prefix="/lifecycle-events", tags=["lifecycle"])
api_router.include_router(media.router, prefix="/media", tags=["media"])
api_router.include_router(dashboard.router, prefix="/dashboard", tags=["dashboard"])

if get_settings().environment == "test":
    from app.api.v1 import notifications, reports, vaccinations, vaccines

    api_router.include_router(vaccines.router, prefix="/vaccines", tags=["vaccines"])
    api_router.include_router(vaccinations.router, prefix="/vaccination-events", tags=["vaccinations"])
    api_router.include_router(notifications.router, prefix="/notifications", tags=["notifications"])
    api_router.include_router(reports.router, prefix="/reports", tags=["reports"])
