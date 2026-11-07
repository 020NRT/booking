"""Booking rules: time slots, availability, holds and status transitions.

Double booking is prevented in three layers:
1. availability() hides occupied tables (UX only, never trusted);
2. create_booking() re-validates everything on the server;
3. the `no_overlapping_bookings` EXCLUDE constraint in PostgreSQL rejects any
   overlapping active booking atomically, even under concurrent requests.
"""

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from psycopg import errors as pg_errors
from sqlalchemy import and_, func, select, text, update
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import Session, selectinload

from ..config import get_settings
from ..models import (
    ACTIVE_BOOKING_STATUSES,
    Booking,
    BookingStatus,
    Hall,
    Payment,
    PaymentStatus,
    Restaurant,
    RestaurantStatus,
    Role,
    Table,
    User,
)
from ..schemas import BookingCreate, BookingOut, MyBookingOut
from ..security import booking_code, qr_token

log = logging.getLogger(__name__)

MAX_PENDING_HOLDS_PER_USER = 3


class BookingError(Exception):
    def __init__(self, message: str, status_code: int = 400, code: str = "booking_error"):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code


def now_utc() -> datetime:
    return datetime.now(UTC)


def restaurant_tz(r: Restaurant) -> ZoneInfo:
    return ZoneInfo(r.timezone or "Asia/Almaty")


def local_today(r: Restaurant) -> date:
    return now_utc().astimezone(restaurant_tz(r)).date()


@dataclass
class DayWindow:
    opens_at: datetime
    closes_at: datetime


def day_window(r: Restaurant, d: date) -> DayWindow | None:
    """Opening window for a business day, or None when closed."""
    wh = next((h for h in r.hours if h.weekday == d.weekday()), None)
    if wh is None or wh.is_closed:
        return None
    tz = restaurant_tz(r)
    opens = datetime.combine(d, wh.open_time, tz)
    closes = datetime.combine(d, wh.close_time, tz)
    if closes <= opens:  # closes after midnight
        closes += timedelta(days=1)
    return DayWindow(opens, closes)


def slot_starts(r: Restaurant, d: date, *, now: datetime | None = None) -> list[datetime]:
    """Bookable start times for a day, already filtered by lead time and horizon."""
    now = now or now_utc()
    today = local_today(r)
    if d < today or d > today + timedelta(days=r.max_days_ahead):
        return []
    window = day_window(r, d)
    if window is None:
        return []
    duration = timedelta(minutes=r.booking_duration_min)
    step = timedelta(minutes=r.slot_step_min)
    earliest = now + timedelta(minutes=r.min_lead_min)
    # The last seating starts at least `duration` before closing, but never
    # later than 60 minutes before closing for short durations.
    last_start = window.closes_at - min(duration, timedelta(minutes=60))
    result = []
    t = window.opens_at
    while t <= last_start:
        if t >= earliest:
            result.append(t)
        t += step
    return result


def resolve_slot(r: Restaurant, d: date, hhmm: str) -> tuple[datetime, datetime]:
    try:
        wanted = time.fromisoformat(hhmm)
    except ValueError:
        raise BookingError("Некорректное время")
    for start in slot_starts(r, d):
        if start.timetz().replace(tzinfo=None) == wanted:
            return start, start + timedelta(minutes=r.booking_duration_min)
    raise BookingError("Это время недоступно для бронирования", code="slot_unavailable")


def expire_stale_holds(db: Session, *, table_id: uuid.UUID | None = None) -> int:
    """Release tables whose payment window has run out."""
    now = now_utc()
    cond = and_(Booking.status == BookingStatus.pending_payment, Booking.hold_expires_at < now)
    if table_id is not None:
        cond = and_(cond, Booking.table_id == table_id)
    expired_ids = db.scalars(
        update(Booking)
        .where(cond)
        .values(status=BookingStatus.payment_failed, cancelled_at=now, cancel_reason="Время оплаты истекло")
        .returning(Booking.id)
    ).all()
    if expired_ids:
        db.execute(
            update(Payment)
            .where(Payment.booking_id.in_(expired_ids), Payment.status == PaymentStatus.pending)
            .values(status=PaymentStatus.failed, failure_reason="Время оплаты истекло")
        )
        log.info("Expired %d unpaid booking hold(s): %s", len(expired_ids), expired_ids)
    return len(expired_ids)


def _active_overlaps(db: Session, table_ids: list[uuid.UUID], starts: datetime, ends: datetime) -> set[uuid.UUID]:
    now = now_utc()
    rows = db.scalars(
        select(Booking.table_id).where(
            Booking.table_id.in_(table_ids),
            Booking.status.in_(ACTIVE_BOOKING_STATUSES),
            Booking.starts_at < ends,
            Booking.ends_at > starts,
            # An expired hold no longer blocks, even before the sweeper runs.
            ~and_(Booking.status == BookingStatus.pending_payment, Booking.hold_expires_at < now),
        )
    ).all()
    return set(rows)


def availability(db: Session, r: Restaurant, d: date, hhmm: str, guests: int):
    starts, ends = resolve_slot(r, d, hhmm)
    halls = db.scalars(
        select(Hall).where(Hall.restaurant_id == r.id).order_by(Hall.sort_order, Hall.id)
    ).all()
    tables = db.scalars(
        select(Table).where(Table.restaurant_id == r.id, Table.is_deleted.is_(False))
    ).all()
    busy = _active_overlaps(db, [t.id for t in tables], starts, ends) if tables else set()
    out = []
    for h in halls:
        items = []
        for t in sorted((t for t in tables if t.hall_id == h.id), key=lambda t: _num_key(t.number)):
            if not t.is_active:
                state, reason = "unavailable", "Столик временно недоступен"
            elif t.id in busy:
                state, reason = "booked", "Занят на это время"
            elif guests > t.seats:
                state, reason = "unavailable", f"Максимум {t.seats} гостей"
            elif guests < t.min_guests:
                state, reason = "unavailable", f"Минимум {t.min_guests} гостей"
            else:
                state, reason = "free", ""
            items.append({**_table_dict(t), "state": state, "reason": reason})
        out.append({"id": h.id, "name": h.name, "width": h.width, "height": h.height, "decor": h.decor, "tables": items})
    return {"date": d, "time": hhmm, "guests": guests, "starts_at": starts, "ends_at": ends, "halls": out}


def _num_key(n: str):
    return (0, int(n), "") if n.isdigit() else (1, 0, n)


def _table_dict(t: Table) -> dict:
    return {
        "id": t.id, "hall_id": t.hall_id, "number": t.number, "shape": t.shape, "x": t.x, "y": t.y,
        "width": t.width, "height": t.height, "rotation": t.rotation, "seats": t.seats,
        "min_guests": t.min_guests, "is_vip": t.is_vip, "is_active": t.is_active,
    }


def _is_exclusion_violation(e: DBAPIError) -> bool:
    # A deadlock between two inserts of the same table is also a lost race.
    return isinstance(e.orig, (pg_errors.ExclusionViolation, pg_errors.DeadlockDetected))


def lock_table(db: Session, table_id: uuid.UUID) -> None:
    """Serialize writes for one table until the transaction ends.

    Concurrent inserts checked by the same EXCLUDE constraint can deadlock in
    PostgreSQL; taking this advisory lock first makes competing requests queue
    up instead, so the loser gets a clean 409. The constraint remains the
    final guarantee.
    """
    db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:k, 0))"), {"k": f"table:{table_id}"})


def create_booking(db: Session, user: User, data: BookingCreate) -> Booking:
    """Create a booking. Commits. Raises BookingError on any rule violation."""
    s = get_settings()
    r = db.get(Restaurant, data.restaurant_id)
    if r is None or r.status != RestaurantStatus.active:
        raise BookingError("Ресторан недоступен для бронирования", 404)
    table = db.get(Table, data.table_id)
    if table is None or table.restaurant_id != r.id or table.is_deleted:
        raise BookingError("Столик не найден", 404)
    if not table.is_active:
        raise BookingError("Столик временно недоступен", code="table_unavailable")
    if data.guests > table.seats:
        raise BookingError(f"За этим столиком максимум {table.seats} гостей", code="too_many_guests")
    if data.guests < table.min_guests:
        raise BookingError(f"Этот столик бронируется от {table.min_guests} гостей", code="too_few_guests")

    starts, ends = resolve_slot(r, data.date, data.time)

    pending = db.scalar(
        select(func.count()).select_from(Booking).where(
            Booking.user_id == user.id,
            Booking.status == BookingStatus.pending_payment,
            Booking.hold_expires_at > now_utc(),
        )
    )
    if pending >= MAX_PENDING_HOLDS_PER_USER:
        raise BookingError("Слишком много неоплаченных броней. Оплатите или отмените их.", 429, "too_many_holds")

    lock_table(db, table.id)
    # Free this table from expired holds first so they don't trip the constraint.
    expire_stale_holds(db, table_id=table.id)

    needs_payment = r.deposit_amount > 0
    now = now_utc()
    booking = Booking(
        code=booking_code(),
        qr_token=qr_token(),
        user_id=user.id,
        restaurant_id=r.id,
        table_id=table.id,
        starts_at=starts,
        ends_at=ends,
        guests=data.guests,
        contact_name=data.contact_name,
        contact_phone=data.contact_phone,
        contact_email=data.contact_email or (user.email or ""),
        comment=data.comment,
        deposit_amount=r.deposit_amount,
        status=BookingStatus.pending_payment if needs_payment else BookingStatus.confirmed,
        hold_expires_at=now + timedelta(minutes=s.payment_hold_minutes) if needs_payment else None,
        confirmed_at=None if needs_payment else now,
    )
    db.add(booking)
    try:
        db.flush()
    except DBAPIError as e:
        db.rollback()
        if _is_exclusion_violation(e):
            raise BookingError(
                "Этот столик только что забронировали на это время. Выберите другой столик или время.",
                409,
                "table_taken",
            )
        raise
    db.commit()
    return booking


# ---------- status transitions ----------

STAFF_TRANSITIONS: dict[BookingStatus, set[BookingStatus]] = {
    BookingStatus.pending_payment: {BookingStatus.confirmed, BookingStatus.cancelled},
    BookingStatus.confirmed: {
        BookingStatus.checked_in,
        BookingStatus.cancelled,
        BookingStatus.no_show,
        BookingStatus.completed,
    },
    BookingStatus.checked_in: {BookingStatus.completed},
}


def customer_can_cancel(b: Booking, r: Restaurant) -> bool:
    if b.status not in (BookingStatus.pending_payment, BookingStatus.confirmed):
        return False
    if b.status == BookingStatus.pending_payment:
        return True
    return b.starts_at - now_utc() >= timedelta(hours=r.cancel_deadline_hours)


def _mark_refunds(db: Session, b: Booking) -> None:
    for p in b.payments:
        if p.status == PaymentStatus.succeeded:
            p.status = PaymentStatus.refund_pending
        elif p.status == PaymentStatus.pending:
            p.status = PaymentStatus.failed
            p.failure_reason = "Бронирование отменено"


def cancel_by_customer(db: Session, b: Booking, user: User, reason: str) -> Booking:
    if b.user_id != user.id:
        raise BookingError("Бронирование не найдено", 404)
    if not customer_can_cancel(b, b.restaurant):
        raise BookingError(
            f"Отмена возможна не позднее чем за {b.restaurant.cancel_deadline_hours} ч. до визита",
            code="cancel_deadline",
        )
    b.status = BookingStatus.cancelled
    b.cancelled_at = now_utc()
    b.cancel_reason = reason or "Отменено клиентом"
    b.hold_expires_at = None
    _mark_refunds(db, b)
    db.commit()
    return b


def change_status_by_staff(db: Session, b: Booking, new: BookingStatus, reason: str = "") -> Booking:
    allowed = STAFF_TRANSITIONS.get(b.status, set())
    if new not in allowed:
        raise BookingError(f"Нельзя перевести бронь из статуса «{b.status.value}» в «{new.value}»", 409, "bad_transition")
    if new == BookingStatus.confirmed and b.status == BookingStatus.pending_payment:
        if b.hold_expires_at and b.hold_expires_at < now_utc():
            raise BookingError("Время удержания брони истекло", 409, "hold_expired")
    if new == BookingStatus.checked_in and b.starts_at - now_utc() > timedelta(hours=2):
        raise BookingError("Отметить приход можно не раньше чем за 2 часа до начала брони", 409, "too_early")
    now = now_utc()
    b.status = new
    if new == BookingStatus.confirmed:
        b.confirmed_at = now
        b.hold_expires_at = None
    elif new == BookingStatus.checked_in:
        b.checked_in_at = now
    elif new == BookingStatus.cancelled:
        b.cancelled_at = now
        b.cancel_reason = reason or "Отменено рестораном"
        b.hold_expires_at = None
        _mark_refunds(db, b)
    db.commit()
    return b


def run_periodic(db: Session) -> None:
    """Called every minute by the scheduler."""
    expire_stale_holds(db)
    # Bookings whose guests checked in are completed once their time slot ends.
    db.execute(
        update(Booking)
        .where(Booking.status == BookingStatus.checked_in, Booking.ends_at < now_utc())
        .values(status=BookingStatus.completed)
    )
    db.commit()


# ---------- serialization ----------


def load_booking(db: Session, booking_id: int) -> Booking | None:
    return db.scalar(
        select(Booking)
        .where(Booking.id == booking_id)
        .options(
            selectinload(Booking.restaurant),
            selectinload(Booking.table).selectinload(Table.hall),
            selectinload(Booking.payments),
        )
    )


def booking_query():
    return select(Booking).options(
        selectinload(Booking.restaurant),
        selectinload(Booking.table).selectinload(Table.hall),
    )


def to_out(b: Booking, *, for_owner: bool = False) -> BookingOut | MyBookingOut:
    data = dict(
        id=b.id, code=b.code, restaurant_id=b.restaurant_id, restaurant_name=b.restaurant.name,
        restaurant_slug=b.restaurant.slug, restaurant_address=b.restaurant.address, table_id=b.table_id,
        table_number=b.table.number, hall_name=b.table.hall.name, starts_at=b.starts_at, ends_at=b.ends_at,
        guests=b.guests, contact_name=b.contact_name, contact_phone=b.contact_phone,
        contact_email=b.contact_email, comment=b.comment, deposit_amount=b.deposit_amount, status=b.status,
        hold_expires_at=b.hold_expires_at, checked_in_at=b.checked_in_at, cancelled_at=b.cancelled_at,
        cancel_reason=b.cancel_reason, created_at=b.created_at,
        can_cancel=customer_can_cancel(b, b.restaurant),
    )
    if for_owner:
        show_qr = b.status in (BookingStatus.confirmed, BookingStatus.checked_in)
        return MyBookingOut(**data, qr_url=checkin_url(b) if show_qr else None)
    return BookingOut(**data)


def checkin_url(b: Booking) -> str:
    return f"{get_settings().public_base_url.rstrip('/')}/check/{b.qr_token}"


def user_is_staff_for(user: User, restaurant_id: int) -> bool:
    return user.role == Role.super_admin or (
        user.role == Role.restaurant_admin and user.restaurant_id == restaurant_id
    )
