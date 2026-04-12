from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    gemini_api_key: str
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_expire_hours: int = 8
    resend_api_key: str = ""
    staff_email: str = ""
    backend_url: str = "http://backend:8000"
    max_concurrent_requests: int = 3
    csv_data_path: str = "./data/sample.csv"
    budget_doc_path: str = "./data/budget_rules.pdf"
    database_url: str = "./ai_demo.db"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
