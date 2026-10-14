from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


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

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def runtime_database_url(self) -> str:
        return self.app_database_url or self.database_url


@lru_cache
def get_settings() -> Settings:
    return Settings()
