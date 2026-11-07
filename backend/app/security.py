import secrets
import string
from datetime import UTC, datetime, timedelta

import bcrypt
import jwt

from .config import get_settings

JWT_ALG = "HS256"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False


# Pre-computed so a login for an unknown user takes as long as a wrong password.
DUMMY_HASH = hash_password(secrets.token_urlsafe(16))


def create_access_token(user_id: int, role: str) -> str:
    s = get_settings()
    now = datetime.now(UTC)
    payload = {"sub": str(user_id), "role": role, "iat": now, "exp": now + timedelta(hours=s.jwt_expire_hours)}
    return jwt.encode(payload, s.jwt_secret, algorithm=JWT_ALG)


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, get_settings().jwt_secret, algorithms=[JWT_ALG])


_CODE_ALPHABET = "".join(c for c in string.ascii_uppercase + string.digits if c not in "0O1IL")


def booking_code() -> str:
    return "R" + "".join(secrets.choice(_CODE_ALPHABET) for _ in range(7))


def qr_token() -> str:
    return secrets.token_urlsafe(32)
