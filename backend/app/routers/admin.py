"""Super Admin API: /admin/... (role super_admin only, enforced per route)."""

import re
from datetime import date, time

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError

from ..config import get_settings
from ..deps import DB, SuperAdmin
from ..models import (
    Booking,
    BookingStatus,
    Payment,
    PaymentStatus,
    Restaurant,
    RestaurantStatus,
    Role,
    User,
    WorkingHours,
)
from ..schemas import (
    AdminUserCreate,
    AdminUserOut,
    AdminUserPatch,
    BookingOut,
    Paginated,
    RestaurantAdminUpdate,
    RestaurantCard,
    RestaurantCreate,
    RestaurantDetail,
)
from ..security import hash_password
from ..services import booking as svc
from .partner import filter_bookings

router = APIRouter(prefix="/admin", tags=["super admin"])


# ---------- dashboard & finance ----------


@router.get("/stats")
def platform_stats(_: SuperAdmin, db: DB):
    def count(model, *conds):
        return db.scalar(select(func.count()).select_from(model).where(*conds)) or 0

    by_status = dict(db.execute(select(Booking.status, func.count()).group_by(Booking.status)).all())
    return {
        "restaurants": count(Restaurant),
        "restaurants_active": count(Restaurant, Restaurant.status == RestaurantStatus.active),
        "customers": count(User, User.role == Role.customer),
        "restaurant_admins": count(User, User.role == Role.restaurant_admin),
        "bookings_total": count(Booking),
        "bookings_active": count(
            Booking, Booking.status.in_([BookingStatus.confirmed, BookingStatus.checked_in]),
            Booking.ends_at >= svc.now_utc(),
        ),
        "bookings_cancelled": by_status.get(BookingStatus.cancelled, 0),
        "by_status": {k.value: v for k, v in by_status.items()},
        "series": _daily_series(db),
    }


def _daily_series(db: DB, days: int = 30) -> list[dict]:
    local_day = func.date(func.timezone("Asia/Almaty", Booking.created_at))
    rows = db.execute(
        select(local_day, func.count()).where(Booking.created_at >= func.now() - func.make_interval(0, 0, 0, days))
        .group_by(local_day).order_by(local_day)
    ).all()
    return [{"date": d.isoformat(), "bookings": n} for d, n in rows]


@router.get("/finance")
def finance(_: SuperAdmin, db: DB):
    pct = get_settings().platform_commission_percent
    paid = Payment.status.in_([PaymentStatus.succeeded])
    refunded = Payment.status.in_([PaymentStatus.refunded, PaymentStatus.refund_pending])
    rows = db.execute(
        select(
            Restaurant.id, Restaurant.name,
            func.coalesce(func.sum(Payment.amount).filter(paid), 0),
            func.count(Payment.id).filter(paid),
            func.count(Payment.id).filter(refunded),
            func.coalesce(func.sum(Payment.amount).filter(refunded), 0),
        )
        .select_from(Restaurant)
        .outerjoin(Booking, Booking.restaurant_id == Restaurant.id)
        .outerjoin(Payment, Payment.booking_id == Booking.id)
        .group_by(Restaurant.id, Restaurant.name).order_by(Restaurant.name)
    ).all()
    per = [
        {"restaurant_id": rid, "restaurant": name, "deposits": dep, "payments": n, "refunds": rn,
         "refunded_amount": ra, "commission": round(dep * pct / 100), "net": dep - round(dep * pct / 100)}
        for rid, name, dep, n, rn, ra in rows
    ]
    total = sum(x["deposits"] for x in per)
    return {
        "commission_percent": pct,
        "deposits_total": total,
        "successful_payments": sum(x["payments"] for x in per),
        "refunds": sum(x["refunds"] for x in per),
        "refunded_amount": sum(x["refunded_amount"] for x in per),
        "failed_payments": db.scalar(select(func.count()).select_from(Payment).where(Payment.status == PaymentStatus.failed)),
        "commission_total": sum(x["commission"] for x in per),
        "per_restaurant": per,
    }


# ---------- restaurants ----------


def _slugify(name: str) -> str:
    table = str.maketrans({
        "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh", "з": "z", "и": "i",
        "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t",
        "у": "u", "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch", "ъ": "", "ы": "y", "ь": "",
        "э": "e", "ю": "yu", "я": "ya", "ә": "a", "ғ": "g", "қ": "k", "ң": "n", "ө": "o", "ұ": "u", "ү": "u",
        "һ": "h", "і": "i",
    })
    s = re.sub(r"[^a-z0-9]+", "-", name.lower().translate(table)).strip("-")
    return s[:60] or "restaurant"


@router.get("/restaurants", response_model=list[RestaurantCard])
def list_restaurants(_: SuperAdmin, db: DB, q: str | None = Query(None, max_length=80),
                     status: RestaurantStatus | None = None):
    stmt = select(Restaurant).order_by(Restaurant.name)
    if q:
        stmt = stmt.where(Restaurant.name.ilike(f"%{q}%"))
    if status:
        stmt = stmt.where(Restaurant.status == status)
    return db.scalars(stmt).all()


@router.post("/restaurants", response_model=RestaurantDetail, status_code=201)
def create_restaurant(data: RestaurantCreate, _: SuperAdmin, db: DB):
    fields = data.model_dump(exclude_unset=True)
    slug = fields.pop("slug", None) or _slugify(data.name)
    base, n = slug, 2
    while db.scalar(select(Restaurant.id).where(Restaurant.slug == slug)):
        slug, n = f"{base}-{n}", n + 1
    fields.setdefault("deposit_amount", get_settings().default_deposit_kzt)
    r = Restaurant(slug=slug, **fields)
    r.hours = [WorkingHours(weekday=d, open_time=time(10), close_time=time(23)) for d in range(7)]
    db.add(r)
    db.commit()
    return r


@router.get("/restaurants/{rid}", response_model=RestaurantDetail)
def get_restaurant(rid: int, _: SuperAdmin, db: DB):
    r = db.get(Restaurant, rid)
    if r is None:
        raise HTTPException(404, "Ресторан не найден")
    return r


@router.patch("/restaurants/{rid}", response_model=RestaurantDetail)
def update_restaurant(rid: int, data: RestaurantAdminUpdate, _: SuperAdmin, db: DB):
    r = get_restaurant(rid, _, db)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(r, k, v)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Такой адрес (slug) уже занят")
    return r


@router.delete("/restaurants/{rid}", status_code=204)
def delete_restaurant(rid: int, _: SuperAdmin, db: DB):
    """Hard delete only when there are no bookings; otherwise deactivate."""
    r = get_restaurant(rid, _, db)
    if db.scalar(select(func.count()).select_from(Booking).where(Booking.restaurant_id == rid)):
        raise HTTPException(409, "У ресторана есть бронирования — его можно только деактивировать (статус inactive).")
    db.delete(r)
    db.commit()


# ---------- users ----------


def _user_out(db: DB, u: User) -> AdminUserOut:
    out = AdminUserOut.model_validate(u)
    out.restaurant_name = u.restaurant.name if u.restaurant else None
    out.bookings_count = db.scalar(select(func.count()).select_from(Booking).where(Booking.user_id == u.id)) or 0
    return out


@router.get("/users", response_model=Paginated[AdminUserOut])
def list_users(
    _: SuperAdmin, db: DB, role: Role | None = None, q: str | None = Query(None, max_length=80),
    is_active: bool | None = None, page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200),
):
    stmt = select(User)
    if role:
        stmt = stmt.where(User.role == role)
    if is_active is not None:
        stmt = stmt.where(User.is_active.is_(is_active))
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(User.name.ilike(like), User.email.ilike(like), User.phone.ilike(like)))
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = db.scalars(stmt.order_by(User.created_at.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return {"items": [_user_out(db, u) for u in rows], "total": total, "page": page, "page_size": page_size}


@router.post("/users", response_model=AdminUserOut, status_code=201)
def create_user(data: AdminUserCreate, admin: SuperAdmin, db: DB):
    _check_assignment(db, data.role, data.restaurant_id)
    u = User(
        name=data.name, email=data.email.lower(), phone=data.phone, password_hash=hash_password(data.password),
        role=data.role, restaurant_id=data.restaurant_id if data.role == Role.restaurant_admin else None,
    )
    db.add(u)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Пользователь с таким email или телефоном уже существует")
    return _user_out(db, u)


def _check_assignment(db: DB, role: Role, restaurant_id: int | None) -> None:
    if role == Role.restaurant_admin:
        if restaurant_id is None or db.get(Restaurant, restaurant_id) is None:
            raise HTTPException(422, "Для администратора ресторана нужно выбрать ресторан")


@router.get("/users/{uid}", response_model=dict)
def get_user(uid: int, _: SuperAdmin, db: DB):
    u = db.get(User, uid)
    if u is None:
        raise HTTPException(404, "Пользователь не найден")
    rows = db.scalars(svc.booking_query().where(Booking.user_id == uid).order_by(Booking.starts_at.desc()).limit(200)).all()
    return {"user": _user_out(db, u), "bookings": [svc.to_out(b) for b in rows]}


@router.patch("/users/{uid}", response_model=AdminUserOut)
def update_user(uid: int, data: AdminUserPatch, admin: SuperAdmin, db: DB):
    u = db.get(User, uid)
    if u is None:
        raise HTTPException(404, "Пользователь не найден")
    fields = data.model_dump(exclude_unset=True)
    if u.id == admin.id and (fields.get("is_active") is False or fields.get("role", Role.super_admin) != Role.super_admin):
        raise HTTPException(400, "Нельзя заблокировать или понизить собственный аккаунт")
    role = fields.get("role", u.role)
    rid = fields.get("restaurant_id", u.restaurant_id)
    _check_assignment(db, role, rid)
    if "password" in fields:
        pw = fields.pop("password")
        if pw:
            u.password_hash = hash_password(pw)
    for k, v in fields.items():
        setattr(u, k, v)
    if u.role != Role.restaurant_admin:
        u.restaurant_id = None
    db.commit()
    return _user_out(db, u)


# ---------- bookings ----------


@router.get("/bookings", response_model=Paginated[BookingOut])
def all_bookings(
    _: SuperAdmin, db: DB,
    restaurant_id: int | None = None, date_from: date | None = None, date_to: date | None = None,
    status: list[BookingStatus] | None = Query(None), q: str | None = Query(None, max_length=80),
    page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200),
):
    ids = [restaurant_id] if restaurant_id else None
    return filter_bookings(db, ids, date_from, date_to, None, None, status, q, page, page_size)

