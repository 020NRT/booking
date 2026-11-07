"""QR check-in. The QR encodes /check/{qr_token}; the token is 256 bits of
randomness, and both reading and changing the booking require a logged-in
staff member of that very restaurant, so a leaked or forged QR is useless."""

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from ..deps import DB, CurrentUser
from ..models import Booking, BookingStatus
from ..schemas import BookingOut
from ..services import booking as svc

router = APIRouter(prefix="/checkin", tags=["check-in"])


def _staff_booking(token: str, db: DB, user) -> Booking:
    if len(token) > 64:
        raise HTTPException(404, "Бронирование не найдено")
    booking_id = db.scalar(select(Booking.id).where(Booking.qr_token == token))
    b = svc.load_booking(db, booking_id) if booking_id else None
    if b is None:
        raise HTTPException(404, "Бронирование не найдено")
    if not svc.user_is_staff_for(user, b.restaurant_id):
        raise HTTPException(403, "Проверить бронь может только сотрудник этого ресторана")
    return b


@router.get("/{token}", response_model=BookingOut)
def check(token: str, db: DB, user: CurrentUser):
    return svc.to_out(_staff_booking(token, db, user))


@router.post("/{token}", response_model=BookingOut)
def check_in(token: str, db: DB, user: CurrentUser):
    b = _staff_booking(token, db, user)
    if b.status == BookingStatus.checked_in:
        return svc.to_out(b)
    try:
        svc.change_status_by_staff(db, b, BookingStatus.checked_in)
    except svc.BookingError as e:
        raise HTTPException(e.status_code, detail={"code": e.code, "message": e.message})
    return svc.to_out(svc.load_booking(db, b.id))
