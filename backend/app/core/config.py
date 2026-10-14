from functools import lru_cache
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _with_driver(url: str, driver: str) -> str:
    """Normalize a Postgres URL (e.g. Neon's `postgresql://...?sslmode=require`) for a SQLAlchemy driver."""
    parts = urlsplit(url)
    if not parts.scheme.startswith("postgres"):
        return url
    query = dict(parse_qsl(parts.query))
    query.pop("channel_binding", None)  # not understood by asyncpg/psycopg2 URL parsing
    if driver == "asyncpg" and "sslmode" in query:
        query["ssl"] = query.pop("sslmode")
    elif driver == "psycopg2" and "ssl" in query:
        query["sslmode"] = query.pop("ssl")
    return urlunsplit(parts._replace(scheme=f"postgresql+{driver}", query=urlencode(query)))


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Poultry Vaccine Tracker"
    environment: str = "local"  # local | test | production
    debug: bool = True
    api_v1_prefix: str = "/api/v1"

    database_url: str = "postgresql+asyncpg://poultry:poultry@localhost:5433/poultry_tracker"
    # Sync URL for Alembic
    database_url_sync: str = "postgresql+psycopg2://poultry:poultry@localhost:5433/poultry_tracker"
    # App role URL (no BYPASSRLS) — used at runtime when set
    app_database_url: str | None = None

    jwt_secret: str = "change-me-local-only-not-for-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 14

    cors_origins: str = "*"

    cloudinary_cloud_name: str | None = None
    cloudinary_api_key: str | None = None
    cloudinary_api_secret: str | None = None
    media_enabled: bool = False

    @model_validator(mode="after")
    def _normalize_database_urls(self) -> "Settings":
        # Hosted Postgres (Neon/Render) provides one plain URL; derive the sync URL from it unless set explicitly.
        if "database_url_sync" not in self.model_fields_set:
            self.database_url_sync = _with_driver(self.database_url, "psycopg2")
        else:
            self.database_url_sync = _with_driver(self.database_url_sync, "psycopg2")
        self.database_url = _with_driver(self.database_url, "asyncpg")
        if self.app_database_url:
            self.app_database_url = _with_driver(self.app_database_url, "asyncpg")
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def runtime_database_url(self) -> str:
        return self.app_database_url or self.database_url


@lru_cache
def get_settings() -> Settings:
    return Settings()
