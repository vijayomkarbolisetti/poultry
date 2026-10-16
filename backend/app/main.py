import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from sqlalchemy import text

from app.api.v1 import api_router
from app.core.config import get_settings
from app.core.database import engine

settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Ping Neon every 4 minutes so the free database does not sleep between taps."""
    stop = asyncio.Event()

    async def keep_database_warm() -> None:
        while not stop.is_set():
            try:
                async with engine.connect() as conn:
                    await conn.execute(text("SELECT 1"))
            except Exception:
                pass
            try:
                await asyncio.wait_for(stop.wait(), timeout=240)
            except TimeoutError:
                pass

    task = asyncio.create_task(keep_database_warm())
    try:
        yield
    finally:
        stop.set()
        task.cancel()


app = FastAPI(title=settings.app_name, debug=settings.debug, lifespan=lifespan)
_origins = settings.cors_origin_list
app.add_middleware(GZipMiddleware, minimum_size=500)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins if _origins != ["*"] else ["*"],
    allow_credentials=_origins != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(api_router, prefix=settings.api_v1_prefix)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "environment": settings.environment}
