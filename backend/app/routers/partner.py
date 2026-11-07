"""Restaurant Admin panel API: /partner/restaurants/{restaurant_id}/...

Every route depends on ManagedRestaurant, which lets a restaurant admin reach
only the restaurant assigned to them (super admins reach any).
"""

import uuid
from datetime import date, datetime, timedelta

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from sqlalchemy import Date, cast, delete, func, or_, select
from sqlalchemy.orm import selectinload

from ..deps import DB, CurrentUser, ManagedRestaurant
from ..models import (
    ACTIVE_BOOKING_STATUSES,
    Booking,
    BookingStatus,
    Hall,
    MenuCategory,
    MenuItem,
    Payment,
    PaymentStatus,
    Photo,
    Restaurant,
    Role,
    Table,
    WorkingHours,
)
from ..schemas import (
    BookingOut,
    HallIn,
    HallLayoutIn,
    HallOut,
    MenuCategoryIn,
    MenuCategoryOut,
    MenuItemIn,
    MenuItemOut,
    MenuItemPatch,
    Paginated,
    PhotoIn,
    PhotoOut,
    RestaurantCard,
    RestaurantDetail,
    RestaurantUpdate,
    StatusChange,
    UploadOut,
    WorkingHoursIO,
)
from ..services import booking as svc
from ..services import notify, payments
from ..services.media import save_image

router = APIRouter(prefix="/partner", tags=["restaurant admin"])
R = "/restaurants/{restaurant_id}"


@router.get("/restaurants", response_model=list[RestaurantCard])
def my_restaurants(user: CurrentUser, db: DB):
    if user.role == Role.super_admin:
        return db.scalars(select(Restaurant).order_by(Restaurant.name)).all()
    if user.role == Role.restaurant_admin and user.restaurant_id:
        return [db.get(Restaurant, user.restaurant_id)]
    raise HTTPException(403, "Нет доступа к панели ресторана")


# ---------- profile & settings ----------


@router.get(R, response_model=RestaurantDetail)
def get_profile(r: ManagedRestaurant):
    return r


@router.patch(R, response_model=RestaurantDetail)
def update_profile(data: RestaurantUpdate, r: ManagedRestaurant, db: DB):
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(r, k, v)
    db.commit()
    return r


@router.put(R + "/hours", response_model=list[WorkingHoursIO])
def set_hours(data: list[WorkingHoursIO], r: ManagedRestaurant, db: DB):
    if sorted(h.weekday for h in data) != list(range(7)):
        raise HTTPException(422, "Нужно указать график на все 7 дней недели")
    db.execute(delete(WorkingHours).where(WorkingHours.restaurant_id == r.id))
    for h in data:
        db.add(WorkingHours(restaurant_id=r.id, **h.model_dump()))
    db.commit()
    db.refresh(r)
    return r.hours


# ---------- dashboard ----------


@router.get(R + "/stats")
def stats(r: ManagedRestaurant, db: DB, days: int = Query(30, ge=7, le=365)):
    return restaurant_stats(db, r, days)


def restaurant_stats(db: DB, r: Restaurant, days: int) -> dict:
    tz = svc.restaurant_tz(r)
    today = svc.local_today(r)
    local_day = cast(func.timezone(r.timezone, Booking.starts_at), Date)
    base = select(func.count()).select_from(Booking).where(Booking.restaurant_id == r.id)

    def count(*conds):
        return db.scalar(base.where(*conds)) or 0

    visitors = db.scalar(
        select(func.coalesce(func.sum(Booking.guests), 0)).where(
            Booking.restaurant_id == r.id, Booking.status.in_([BookingStatus.checked_in, BookingStatus.completed])
        )
    )
    deposits = db.scalar(
        select(func.coalesce(func.sum(Payment.amount), 0)).join(Booking, Booking.id == Payment.booking_id)
        .where(Booking.restaurant_id == r.id, Payment.status == PaymentStatus.succeeded)
    )
    start = today - timedelta(days=days - 1)
    rows = db.execute(
        select(local_day.label("d"), Booking.status, func.count(), func.sum(Booking.guests))
        .where(Booking.restaurant_id == r.id, local_day >= start, local_day <= today + timedelta(days=7))
        .group_by("d", Booking.status)
    ).all()
    series: dict[date, dict] = {}
    d = start
    while d <= today + timedelta(days=7):
        series[d] = {"date": d.isoformat(), "bookings": 0, "guests": 0, "cancelled": 0}
        d += timedelta(days=1)
    for day, status, n, guests in rows:
        if day in series:
            if status in (BookingStatus.cancelled, BookingStatus.payment_failed):
                series[day]["cancelled"] += n
            else:
                series[day]["bookings"] += n
                series[day]["guests"] += guests or 0
    by_status = dict(
        db.execute(select(Booking.status, func.count()).where(Booking.restaurant_id == r.id).group_by(Booking.status)).all()
    )
    now = datetime.now(tz)
    return {
        "total_bookings": count(),
        "today_bookings": count(local_day == today, Booking.status.notin_([BookingStatus.payment_failed])),
        "active_bookings": count(Booking.status.in_([BookingStatus.confirmed, BookingStatus.checked_in]),
                                 Booking.ends_at >= now),
        "cancelled_bookings": count(Booking.status == BookingStatus.cancelled),
        "visitors": visitors,
        "deposits_total": deposits,
        "by_status": {k.value: v for k, v in by_status.items()},
        "series": list(series.values()),
    }


# ---------- bookings ----------


@router.get(R + "/bookings", response_model=Paginated[BookingOut])
def list_bookings(
    r: ManagedRestaurant, db: DB,
    date_from: date | None = None, date_to: date | None = None,
    time_from: str | None = Query(None, pattern=r"^\d{2}:\d{2}$"),
    time_to: str | None = Query(None, pattern=r"^\d{2}:\d{2}$"),
    status: list[BookingStatus] | None = Query(None),
    q: str | None = Query(None, max_length=80),
    page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200),
):
    return filter_bookings(db, [r.id], date_from, date_to, time_from, time_to, status, q, page, page_size, r.timezone)


def filter_bookings(db, restaurant_ids, date_from, date_to, time_from, time_to, status, q, page, page_size,
                    tz="Asia/Almaty"):
    local = func.timezone(tz, Booking.starts_at)
    stmt = svc.booking_query()
    if restaurant_ids is not None:
        stmt = stmt.where(Booking.restaurant_id.in_(restaurant_ids))
    if date_from:
        stmt = stmt.where(cast(local, Date) >= date_from)
    if date_to:
        stmt = stmt.where(cast(local, Date) <= date_to)
    if time_from:
        stmt = stmt.where(func.to_char(local, "HH24:MI") >= time_from)
    if time_to:
        stmt = stmt.where(func.to_char(local, "HH24:MI") <= time_to)
    if status:
        stmt = stmt.where(Booking.status.in_(status))
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Booking.code.ilike(like), Booking.contact_name.ilike(like), Booking.contact_phone.ilike(like)))
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery()))
    rows = db.scalars(stmt.order_by(Booking.starts_at.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return {"items": [svc.to_out(b) for b in rows], "total": total, "page": page, "page_size": page_size}


@router.patch(R + "/bookings/{booking_id}/status", response_model=BookingOut)
def set_booking_status(booking_id: int, data: StatusChange, r: ManagedRestaurant, db: DB):
    b = svc.load_booking(db, booking_id)
    if b is None or b.restaurant_id != r.id:
        raise HTTPException(404, "Бронирование не найдено")
    was_active = b.status in (BookingStatus.confirmed, BookingStatus.pending_payment)
    try:
        svc.change_status_by_staff(db, b, data.status, data.reason)
    except svc.BookingError as e:
        raise HTTPException(e.status_code, detail={"code": e.code, "message": e.message})
    if data.status == BookingStatus.cancelled:
        payments.process_refunds(db)
        if was_active:
            notify.booking_cancelled(b)
    return svc.to_out(svc.load_booking(db, booking_id))


# ---------- halls & floor-plan editor ----------


def _hall_out(h: Hall) -> HallOut:
    tables = sorted((t for t in h.tables if not t.is_deleted), key=lambda t: svc._num_key(t.number))
    return HallOut(id=h.id, name=h.name, width=h.width, height=h.height, sort_order=h.sort_order, decor=h.decor or [],
                   tables=tables)


def _get_hall(db: DB, r: Restaurant, hall_id: int) -> Hall:
    h = db.scalar(select(Hall).where(Hall.id == hall_id, Hall.restaurant_id == r.id).options(selectinload(Hall.tables)))
    if h is None:
        raise HTTPException(404, "Зал не найден")
    return h


@router.get(R + "/halls", response_model=list[HallOut])
def list_halls(r: ManagedRestaurant, db: DB):
    halls = db.scalars(
        select(Hall).where(Hall.restaurant_id == r.id).order_by(Hall.sort_order, Hall.id).options(selectinload(Hall.tables))
    ).all()
    return [_hall_out(h) for h in halls]


@router.post(R + "/halls", response_model=HallOut, status_code=201)
def create_hall(data: HallIn, r: ManagedRestaurant, db: DB):
    h = Hall(restaurant_id=r.id, decor=[], **data.model_dump())
    db.add(h)
    db.commit()
    return _hall_out(_get_hall(db, r, h.id))


def _future_active_tables(db: DB, table_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not table_ids:
        return {}
    return dict(db.execute(
        select(Booking.table_id, func.count()).where(
            Booking.table_id.in_(table_ids), Booking.status.in_(ACTIVE_BOOKING_STATUSES),
            Booking.ends_at > svc.now_utc(),
        ).group_by(Booking.table_id)
    ).all())


@router.delete(R + "/halls/{hall_id}", status_code=204)
def delete_hall(hall_id: int, r: ManagedRestaurant, db: DB):
    h = _get_hall(db, r, hall_id)
    ids = [t.id for t in h.tables]
    if _future_active_tables(db, ids):
        raise HTTPException(409, "В зале есть столики с будущими бронями. Сначала отмените или перенесите их.")
    if ids and db.scalar(select(func.count()).select_from(Booking).where(Booking.table_id.in_(ids))):
        raise HTTPException(409, "У столиков этого зала есть история бронирований. Скройте столики вместо удаления зала.")
    db.delete(h)
    db.commit()


@router.put(R + "/halls/{hall_id}/layout", response_model=HallOut)
def save_layout(hall_id: int, data: HallLayoutIn, r: ManagedRestaurant, db: DB):
    """Save the whole hall in one transaction.

    Tables with an `id` that exists in this hall are updated in place; tables
    without an id are inserted as NEW rows; tables missing from the payload are
    removed. Adding a table therefore can never replace another one.
    """
    h = _get_hall(db, r, hall_id)
    existing = {t.id: t for t in h.tables if not t.is_deleted}

    numbers = [t.number for t in data.tables]
    dupes = sorted({n for n in numbers if numbers.count(n) > 1})
    if dupes:
        raise HTTPException(422, f"Номера столиков повторяются: {', '.join(dupes)}")
    other = set(db.scalars(select(Table.number).where(
        Table.restaurant_id == r.id, Table.hall_id != h.id, Table.is_deleted.is_(False))).all())
    clash = sorted(set(numbers) & other)
    if clash:
        raise HTTPException(422, f"Номера уже используются в другом зале: {', '.join(clash)}")

    incoming_ids = {t.id for t in data.tables if t.id is not None}
    unknown = incoming_ids - existing.keys()
    if unknown:
        raise HTTPException(422, "Передан столик, которого нет в этом зале. Обновите страницу.")

    removed = [tid for tid in existing if tid not in incoming_ids]
    busy = _future_active_tables(db, removed)
    if busy:
        nums = ", ".join(sorted(existing[t].number for t in busy))
        raise HTTPException(409, f"Нельзя удалить столики с будущими бронями: {nums}. Сделайте их недоступными.")
    for tid in removed:
        t = existing[tid]
        has_history = db.scalar(select(func.count()).select_from(Booking).where(Booking.table_id == tid))
        if has_history:
            t.is_deleted = True
            t.is_active = False
        else:
            db.delete(t)

    for t_in in data.tables:
        fields = t_in.model_dump(exclude={"id"})
        if fields["min_guests"] > fields["seats"]:
            fields["min_guests"] = 1
        if t_in.id is not None:
            for k, v in fields.items():
                setattr(existing[t_in.id], k, v)
        else:
            db.add(Table(restaurant_id=r.id, hall_id=h.id, **fields))

    if data.name is not None:
        h.name = data.name
    if data.width is not None:
        h.width = data.width
    if data.height is not None:
        h.height = data.height
    h.decor = [d.model_dump() for d in data.decor]
    db.commit()
    db.expire_all()
    return _hall_out(_get_hall(db, r, h.id))


# ---------- menu ----------


@router.get(R + "/menu", response_model=list[MenuCategoryOut])
def get_menu(r: ManagedRestaurant, db: DB):
    return db.scalars(
        select(MenuCategory).where(MenuCategory.restaurant_id == r.id).order_by(MenuCategory.sort_order, MenuCategory.id)
        .options(selectinload(MenuCategory.items))
    ).all()


def _category(db: DB, r: Restaurant, cid: int) -> MenuCategory:
    c = db.get(MenuCategory, cid)
    if c is None or c.restaurant_id != r.id:
        raise HTTPException(404, "Категория не найдена")
    return c


def _item(db: DB, r: Restaurant, iid: int) -> MenuItem:
    i = db.get(MenuItem, iid)
    if i is None or i.restaurant_id != r.id:
        raise HTTPException(404, "Блюдо не найдено")
    return i


@router.post(R + "/menu/categories", response_model=MenuCategoryOut, status_code=201)
def create_category(data: MenuCategoryIn, r: ManagedRestaurant, db: DB):
    c = MenuCategory(restaurant_id=r.id, **data.model_dump())
    db.add(c)
    db.commit()
    return MenuCategoryOut(id=c.id, name=c.name, sort_order=c.sort_order, items=[])


@router.patch(R + "/menu/categories/{cid}", response_model=MenuCategoryOut)
def update_category(cid: int, data: MenuCategoryIn, r: ManagedRestaurant, db: DB):
    c = _category(db, r, cid)
    c.name, c.sort_order = data.name, data.sort_order
    db.commit()
    return c


@router.delete(R + "/menu/categories/{cid}", status_code=204)
def delete_category(cid: int, r: ManagedRestaurant, db: DB):
    db.delete(_category(db, r, cid))
    db.commit()


@router.post(R + "/menu/items", response_model=MenuItemOut, status_code=201)
def create_item(data: MenuItemIn, r: ManagedRestaurant, db: DB):
    _category(db, r, data.category_id)
    i = MenuItem(restaurant_id=r.id, **data.model_dump())
    db.add(i)
    db.commit()
    return i


@router.patch(R + "/menu/items/{iid}", response_model=MenuItemOut)
def update_item(iid: int, data: MenuItemPatch, r: ManagedRestaurant, db: DB):
    i = _item(db, r, iid)
    fields = data.model_dump(exclude_unset=True)
    if "category_id" in fields:
        _category(db, r, fields["category_id"])
    for k, v in fields.items():
        setattr(i, k, v)
    db.commit()
    return i


@router.delete(R + "/menu/items/{iid}", status_code=204)
def delete_item(iid: int, r: ManagedRestaurant, db: DB):
    db.delete(_item(db, r, iid))
    db.commit()


# ---------- photos & uploads ----------


@router.post(R + "/uploads", response_model=UploadOut, status_code=201)
async def upload(r: ManagedRestaurant, file: UploadFile = File(...)):
    return UploadOut(url=await save_image(file, f"r{r.id}"))


@router.get(R + "/photos", response_model=list[PhotoOut])
def list_photos(r: ManagedRestaurant):
    return r.photos


@router.post(R + "/photos", response_model=PhotoOut, status_code=201)
def add_photo(data: PhotoIn, r: ManagedRestaurant, db: DB):
    p = Photo(restaurant_id=r.id, **data.model_dump())
    db.add(p)
    db.commit()
    return p


@router.delete(R + "/photos/{pid}", status_code=204)
def delete_photo(pid: int, r: ManagedRestaurant, db: DB):
    p = db.get(Photo, pid)
    if p is None or p.restaurant_id != r.id:
        raise HTTPException(404, "Фото не найдено")
    db.delete(p)
    db.commit()


@router.put(R + "/photos/order", response_model=list[PhotoOut])
def reorder_photos(ids: list[int], r: ManagedRestaurant, db: DB):
    by_id = {p.id: p for p in r.photos}
    for n, pid in enumerate(ids):
        if pid in by_id:
            by_id[pid].sort_order = n
    db.commit()
    db.refresh(r)
    return r.photos
