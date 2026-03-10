"""
Application configuration using pydantic-settings.

Loads from environment variables / .env file.
"""

from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Cognito
    cognito_user_pool_id: str = ""
    cognito_app_client_id: str = ""
    cognito_region: str = "us-east-1"
    cognito_domain: str = ""

    # SES (invitation emails)
    ses_region: str = "eu-west-1"
    ses_sender_email: str = "noreply@onestat.ai"

    # App
    app_url: str = "http://localhost:3001"  # Frontend URL shown in invite emails

    # Derived
    @property
    def cognito_issuer(self) -> str:
        return f"https://cognito-idp.{self.cognito_region}.amazonaws.com/{self.cognito_user_pool_id}"

    @property
    def cognito_jwks_url(self) -> str:
        return f"{self.cognito_issuer}/.well-known/jwks.json"

    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
