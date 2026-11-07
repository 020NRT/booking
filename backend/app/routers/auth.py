import time
from collections import defaultdict, deque

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError

from ..deps import DB, CurrentUser
from ..models import Role, User
from ..schemas import LoginIn, PasswordChange, ProfileUpdate, RegisterIn, TokenOut, UserOut, normalize_phone
from ..security import DUMMY_HASH, create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])

# Simple per-process brute-force guard: 10 failed logins per 10 minutes per IP.
_failed: dict[str, deque] = defaultdict(deque)
FAIL_WINDOW, FAIL_LIMIT = 600, 10


def _check_rate(key: str) -> None:
    q = _failed[key]
    now = time.monotonic()
    while q and now - q[0] > FAIL_WINDOW:
        q.popleft()
    if len(q) >= FAIL_LIMIT:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Слишком много попыток входа. Попробуйте позже.")


def _token(user: User) -> TokenOut:
    return TokenOut(access_token=create_access_token(user.id, user.role.value), user=UserOut.model_validate(user))


@router.post("/register", response_model=TokenOut, status_code=201)
def register(data: RegisterIn, db: DB):
    conds = []
    if data.email:
        conds.append(User.email == data.email)
    if data.phone:
        conds.append(User.phone == data.phone)
    if db.scalar(select(User.id).where(or_(*conds))):
        raise HTTPException(409, "Пользователь с таким email или телефоном уже существует")
    # Role is hard-coded: nobody can self-register as an admin.
    user = User(
        name=data.name, email=data.email, phone=data.phone,
        password_hash=hash_password(data.password), role=Role.customer,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Пользователь с таким email или телефоном уже существует")
    return _token(user)


@router.post("/login", response_model=TokenOut)
def login(data: LoginIn, db: DB, request: Request):
    key = request.client.host if request.client else "?"
    _check_rate(key)
    ident = data.identifier.strip()
    if "@" in ident:
        user = db.scalar(select(User).where(User.email == ident.lower()))
    else:
        try:
            user = db.scalar(select(User).where(User.phone == normalize_phone(ident)))
        except ValueError:
            user = None
    if user is None:
        verify_password(data.password, DUMMY_HASH)
    if user is None or not verify_password(data.password, user.password_hash):
        _failed[key].append(time.monotonic())
        raise HTTPException(401, "Неверный логин или пароль")
    if not user.is_active:
        raise HTTPException(403, "Аккаунт заблокирован. Обратитесь в поддержку Reserve.")
    _failed.pop(key, None)
    return _token(user)


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser):
    return user


@router.patch("/me", response_model=UserOut)
def update_me(data: ProfileUpdate, user: CurrentUser, db: DB):
    fields = data.model_dump(exclude_unset=True)
    if "email" in fields and fields["email"]:
        fields["email"] = fields["email"].lower()
    for k, v in fields.items():
        setattr(user, k, v)
    if not user.email and not user.phone:
        raise HTTPException(422, "Нужен email или телефон")
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Этот email или телефон уже используется")
    return user


@router.post("/me/password", status_code=204)
def change_password(data: PasswordChange, user: CurrentUser, db: DB):
    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(400, "Текущий пароль указан неверно")
    user.password_hash = hash_password(data.new_password)
    db.commit()
