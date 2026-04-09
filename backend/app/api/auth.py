from pydantic import BaseModel
from fastapi import APIRouter, HTTPException, status
import aiosqlite

from app.core.security import verify_password, create_access_token
from app.core.config import get_settings

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest) -> TokenResponse:
    settings = get_settings()
    async with aiosqlite.connect(settings.database_url) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT password FROM users WHERE username = ?", (body.username,)
        ) as cursor:
            row = await cursor.fetchone()

    # Use a consistent-time failure to avoid username enumeration
    if row is None or not verify_password(body.password, row["password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    token = create_access_token(subject=body.username)
    return TokenResponse(access_token=token)
