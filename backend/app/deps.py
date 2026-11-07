from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .db import get_db
from .models import Restaurant, Role, User
from .security import decode_access_token

DB = Annotated[Session, Depends(get_db)]

_bearer = HTTPBearer(auto_error=False)


def _user_from_token(creds: HTTPAuthorizationCredentials | None, db: Session) -> User | None:
    if creds is None:
        return None
    try:
        payload = decode_access_token(creds.credentials)
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Недействительный токен")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Пользователь не найден")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Аккаунт заблокирован")
    return user


def get_optional_user(
    db: DB, creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]
) -> User | None:
    return _user_from_token(creds, db)


def get_current_user(
    db: DB, creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]
) -> User:
    user = _user_from_token(creds, db)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Требуется вход")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]


def require_super_admin(user: CurrentUser) -> User:
    if user.role != Role.super_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Доступ только для администратора Reserve")
    return user


SuperAdmin = Annotated[User, Depends(require_super_admin)]


def can_manage_restaurant(user: User, restaurant_id: int) -> bool:
    if user.role == Role.super_admin:
        return True
    return user.role == Role.restaurant_admin and user.restaurant_id == restaurant_id


def get_managed_restaurant(restaurant_id: int, user: CurrentUser, db: DB) -> Restaurant:
    """Path dependency for /partner/restaurants/{restaurant_id}/...

    Restaurant admins may only reach their own restaurant; super admins reach all.
    """
    if not can_manage_restaurant(user, restaurant_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Нет доступа к этому ресторану")
    restaurant = db.get(Restaurant, restaurant_id)
    if restaurant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ресторан не найден")
    return restaurant


ManagedRestaurant = Annotated[Restaurant, Depends(get_managed_restaurant)]
