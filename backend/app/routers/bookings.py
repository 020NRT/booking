import json
import secrets
import uuid

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select

from ..config import get_settings
from ..deps import DB, CurrentUser
from ..models import Booking, BookingStatus, Payment, Role, User
from ..schemas import BookingCreate, BookingCreated, BookingOut, CancelIn, MyBookingOut, PaymentOut
from ..services import booking as svc
from ..services import notify, payments

router = APIRouter(tags=["bookings"])


def _err(e: svc.BookingError) -> HTTPException:
    return HTTPException(e.status_code, detail={"code": e.code, "message": e.message})


def notify_confirmed(db: DB, booking_id: int) -> None:
    b = svc.load_booking(db, booking_id)
    if b is None or b.status != BookingStatus.confirmed:
        return
    notify.booking_confirmed(b, svc.checkin_url(b))
    admins = db.scalars(
        select(User.email).where(User.restaurant_id == b.restaurant_id, User.role == Role.restaurant_admin,
                                 User.is_active.is_(True), User.email.is_not(None))
    ).all()
    notify.restaurant_new_booking(b, list(admins))


@router.post("/bookings", response_model=BookingCreated, status_code=201)
def create_booking(data: BookingCreate, db: DB, user: CurrentUser):
    try:
        b = svc.create_booking(db, user, data)
        payment = payments.start_payment(db, b) if b.status == BookingStatus.pending_payment else None
    except svc.BookingError as e:
        raise _err(e)
    if payment is None:
        notify_confirmed(db, b.id)
    b = svc.load_booking(db, b.id)
    return BookingCreated(
        booking=svc.to_out(b, for_owner=True),
        payment_id=payment.id if payment else None,
        payment_url=payments.get_provider(payment.provider).checkout_url(payment) if payment else None,
    )


@router.get("/me/bookings", response_model=list[MyBookingOut])
def my_bookings(db: DB, user: CurrentUser):
    rows = db.scalars(svc.booking_query().where(Booking.user_id == user.id).order_by(Booking.starts_at.desc())).all()
    return [svc.to_out(b, for_owner=True) for b in rows]


@router.get("/bookings/{booking_id}", response_model=MyBookingOut)
def get_booking(booking_id: int, db: DB, user: CurrentUser):
    b = svc.load_booking(db, booking_id)
    if b is None or (b.user_id != user.id and not svc.user_is_staff_for(user, b.restaurant_id)):
        raise HTTPException(404, "Бронирование не найдено")
    return svc.to_out(b, for_owner=True)


@router.post("/bookings/{booking_id}/cancel", response_model=MyBookingOut)
def cancel_booking(booking_id: int, data: CancelIn, db: DB, user: CurrentUser):
    b = svc.load_booking(db, booking_id)
    if b is None:
        raise HTTPException(404, "Бронирование не найдено")
    was_confirmed = b.status == BookingStatus.confirmed
    try:
        svc.cancel_by_customer(db, b, user, data.reason)
    except svc.BookingError as e:
        raise _err(e)
    payments.process_refunds(db)
    if was_confirmed:
        notify.booking_cancelled(b)
    return svc.to_out(svc.load_booking(db, booking_id), for_owner=True)


@router.post("/bookings/{booking_id}/pay", response_model=dict)
def pay_booking(booking_id: int, db: DB, user: CurrentUser):
    b = svc.load_booking(db, booking_id)
    if b is None or b.user_id != user.id:
        raise HTTPException(404, "Бронирование не найдено")
    try:
        p = payments.start_payment(db, b)
    except svc.BookingError as e:
        raise _err(e)
    return {"payment_id": p.id, "payment_url": payments.get_provider(p.provider).checkout_url(p)}


# ---------- payments ----------


class PaymentView(PaymentOut):
    booking: BookingOut


@router.get("/payments/{payment_id}", response_model=PaymentView)
def get_payment(payment_id: uuid.UUID, db: DB, user: CurrentUser):
    p = db.get(Payment, payment_id)
    b = svc.load_booking(db, p.booking_id) if p else None
    if p is None or b.user_id != user.id:
        raise HTTPException(404, "Платёж не найден")
    return PaymentView(**PaymentOut.model_validate(p).model_dump(), booking=svc.to_out(b))


@router.post("/payments/webhook/{provider}", include_in_schema=True)
async def payment_webhook(provider: str, request: Request, db: DB):
    """Server-to-server notification from the payment provider (the only way a booking gets paid)."""
    try:
        prov = payments.get_provider(provider)
    except RuntimeError:
        raise HTTPException(404, "Unknown provider")
    body = await request.body()
    try:
        n = prov.parse_notification(body, {k.lower(): v for k, v in request.headers.items()})
    except (ValueError, KeyError, json.JSONDecodeError):
        raise HTTPException(400, "Invalid notification")
    p = db.get(Payment, n.payment_id)
    was_pending = p is not None and p.provider_payment_id is None
    try:
        p = payments.process_notification(db, n)
    except svc.BookingError as e:
        raise _err(e)
    if was_pending and n.success:
        notify_confirmed(db, p.booking_id)
    payments.process_refunds(db)
    return {"ok": True}


class SimulateIn(BaseModel):
    success: bool = True


@router.post("/payments/mock/{payment_id}/simulate", response_model=PaymentOut)
def simulate_mock_payment(payment_id: uuid.UUID, data: SimulateIn, db: DB, user: CurrentUser):
    """Test checkout for the `mock` provider: builds a signed notification exactly
    like a real provider would and feeds it through the same webhook logic."""
    if get_settings().payment_provider != "mock":
        raise HTTPException(404, "Not found")
    p = db.get(Payment, payment_id)
    if p is None or p.provider != "mock":
        raise HTTPException(404, "Платёж не найден")
    b = db.get(Booking, p.booking_id)
    if b.user_id != user.id:
        raise HTTPException(404, "Платёж не найден")
    body = json.dumps({
        "order_id": str(p.id),
        "transaction_id": f"mock-{secrets.token_hex(8)}",
        "status": "success" if data.success else "declined",
        "reason": "" if data.success else "Карта отклонена банком (тест)",
        "amount": p.amount,
    }).encode()
    prov = payments.get_provider("mock")
    n = prov.parse_notification(body, {"x-signature": prov.sign(body)})
    was_pending = p.provider_payment_id is None
    try:
        p = payments.process_notification(db, n)
    except svc.BookingError as e:
        raise _err(e)
    if was_pending and data.success:
        notify_confirmed(db, p.booking_id)
    payments.process_refunds(db)
    db.refresh(p)
    return p
