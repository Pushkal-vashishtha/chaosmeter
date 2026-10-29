from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://chaos:chaos@postgres:5432/chaos"
    prometheus_url: str = "http://prometheus:9090"

    # Safety limits. Deployment configuration, not code constants.
    max_experiment_duration_seconds: int = 300
    max_blast_radius: int = 3
    require_dry_run_first: bool = True


@lru_cache
def get_settings() -> Settings:
    return Settings()