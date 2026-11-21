from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = "development"
    mongo_uri: str = "mongodb://localhost:27017"
    mongo_db: str = "nestguard"

    # No defaults on purpose: the app refuses to start without real secrets.
    jwt_secret: str
    service_key: str
    template_encryption_key: str  # 64 hex chars = 32 bytes (AES-256)

    jwt_expires_hours: int = 168
    client_url: str = "http://localhost:5000"
    extra_origins: str = ""  # comma separated
    enabled_modules: str = "auth,students,biometric,access,gates,alerts,realtime"
    arm_timeout_s: int = 60
    bcrypt_rounds: int = 12
    enable_simulate: bool = False  # only honoured when env == "development"
    login_rate_limit: int = 30
    login_rate_window_s: int = 900

    @field_validator("jwt_secret", "service_key")
    @classmethod
    def _min_len(cls, v: str) -> str:
        if len(v) < 32:
            raise ValueError("must be at least 32 characters")
        return v

    @field_validator("template_encryption_key")
    @classmethod
    def _hex_key(cls, v: str) -> str:
        try:
            if len(bytes.fromhex(v)) != 32:
                raise ValueError
        except ValueError:
            raise ValueError("must be 64 hex characters (32 bytes)") from None
        return v

    @property
    def origins(self) -> list[str]:
        extra = [o.strip() for o in self.extra_origins.split(",") if o.strip()]
        return [self.client_url, *extra]

    @property
    def modules(self) -> list[str]:
        return [m.strip() for m in self.enabled_modules.split(",") if m.strip()]

    @property
    def is_prod(self) -> bool:
        return self.env == "production"

    @property
    def simulate_allowed(self) -> bool:
        return self.env == "development" and self.enable_simulate


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
