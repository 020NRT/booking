from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    database_url: str = "postgresql+psycopg://reserve@localhost:5432/reserve"
    test_database_url: str = "postgresql+psycopg://reserve@localhost:5432/reserve_test"

    jwt_secret: str = "dev-only-secret-change-me"
    jwt_expire_hours: int = 72

    public_base_url: str = "http://localhost:5173"
    cors_origins: str = "http://localhost:5173"

    superadmin_email: str = "admin@reserve.kz"
    superadmin_password: str = ""

    default_deposit_kzt: int = 5000
    payment_hold_minutes: int = 10
    platform_commission_percent: float = 10.0

    payment_provider: str = "mock"
    payment_webhook_secret: str = "dev-webhook-secret"

    media_dir: Path = BACKEND_DIR / "media"
    max_upload_mb: int = 8

    smtp_host: str = ""
    smtp_port: int = 465
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "Reserve <no-reply@reserve.kz>"

    run_scheduler: bool = True
    log_level: str = "INFO"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
