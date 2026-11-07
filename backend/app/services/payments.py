"""Deposit payments.

A booking is confirmed ONLY from a verified server-to-server notification
(`process_notification`), never from the browser redirect. Stage 1 ships the
`mock` provider so the full flow can be tested without real money; a real
Kazakhstan provider is added in stage 2 by implementing `PaymentProvider`.
"""

import hashlib
import hmac
import json
import logging
import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Booking, BookingStatus, Payment, PaymentStatus
from .booking import BookingError, lock_table, now_utc

log = logging.getLogger(__name__)


@dataclass
class Notification:
    payment_id: uuid.UUID
    provider_payment_id: str
    success: bool
    reason: str
    raw: dict


class PaymentProvider:
    name: str

    def checkout_url(self, payment: Payment) -> str:
        raise NotImplementedError

    def parse_notification(self, body: bytes, headers: dict[str, str]) -> Notification:
        """Verify the signature and parse. Raise ValueError if not authentic."""
        raise NotImplementedError

    def refund(self, payment: Payment) -> bool:
        raise NotImplementedError


class MockProvider(PaymentProvider):
    """Test provider: a fake checkout page in our own frontend + HMAC-signed webhook."""

    name = "mock"

    def checkout_url(self, payment: Payment) -> str:
        return f"{get_settings().public_base_url.rstrip('/')}/pay/{payment.id}"

    @staticmethod
    def sign(body: bytes) -> str:
        return hmac.new(get_settings().payment_webhook_secret.encode(), body, hashlib.sha256).hexdigest()

    def parse_notification(self, body: bytes, headers: dict[str, str]) -> Notification:
        signature = headers.get("x-signature", "")
        if not hmac.compare_digest(signature, self.sign(body)):
            raise ValueError("bad signature")
        data = json.loads(body)
        return Notification(
            payment_id=uuid.UUID(data["order_id"]),
            provider_payment_id=str(data["transaction_id"]),
            success=data["status"] == "success",
            reason=str(data.get("reason", "")),
            raw=data,
        )

    def refund(self, payment: Payment) -> bool:
        return True


PROVIDERS: dict[str, PaymentProvider] = {"mock": MockProvider()}


def get_provider(name: str | None = None) -> PaymentProvider:
    name = name or get_settings().payment_provider
    try:
        return PROVIDERS[name]
    except KeyError:
        raise RuntimeError(f"Unknown payment provider {name!r}")


def start_payment(db: Session, booking: Booking) -> Payment:
    if booking.status != BookingStatus.pending_payment:
        raise BookingError("Бронь не ожидает оплаты", 409, "not_pending")
    if booking.hold_expires_at and booking.hold_expires_at < now_utc():
        raise BookingError("Время оплаты истекло, создайте бронь заново", 409, "hold_expired")
    # Reuse an open payment so a double click never creates two charges.
    existing = db.scalar(
        select(Payment).where(Payment.booking_id == booking.id, Payment.status == PaymentStatus.pending)
    )
    if existing:
        return existing
    provider = get_provider()
    p = Payment(booking_id=booking.id, provider=provider.name, amount=booking.deposit_amount)
    db.add(p)
    db.commit()
    return p


def process_notification(db: Session, n: Notification) -> Payment:
    """Apply a verified provider notification. Idempotent. Commits."""
    p = db.scalar(select(Payment).where(Payment.id == n.payment_id).with_for_update())
    if p is None:
        raise BookingError("Платёж не найден", 404)
    # A payment we expired locally (hold timed out, provider never answered) can
    # still be charged by the provider afterwards; that money must not be lost.
    expired_locally = p.status == PaymentStatus.failed and p.provider_payment_id is None
    if p.status != PaymentStatus.pending and not expired_locally:
        log.info("Duplicate notification for payment %s (status %s) ignored", p.id, p.status.value)
        return p
    b = db.scalar(select(Booking).where(Booking.id == p.booking_id).with_for_update())
    p.raw_notification = n.raw
    p.provider_payment_id = n.provider_payment_id

    if not n.success:
        p.status = PaymentStatus.failed
        p.failure_reason = n.reason or "Платёж отклонён"
        if b.status == BookingStatus.pending_payment:
            b.status = BookingStatus.payment_failed
            b.cancelled_at = now_utc()
            b.cancel_reason = p.failure_reason
            b.hold_expires_at = None
        db.commit()
        return p

    p.status = PaymentStatus.succeeded
    p.paid_at = now_utc()
    if b.status == BookingStatus.pending_payment:
        b.status = BookingStatus.confirmed
        b.confirmed_at = now_utc()
        b.hold_expires_at = None
    elif b.status == BookingStatus.payment_failed:
        # Money arrived after the hold expired: take the table back if it is
        # still free, otherwise the deposit must be returned.
        lock_table(db, b.table_id)
        try:
            with db.begin_nested():
                b.status = BookingStatus.confirmed
                b.confirmed_at = now_utc()
                b.cancelled_at = None
                b.cancel_reason = ""
                db.flush()
        except IntegrityError:
            b.status = BookingStatus.payment_failed
            p.status = PaymentStatus.refund_pending
            p.failure_reason = "Столик занят после истечения времени оплаты"
    else:
        # Booking cancelled meanwhile -> refund.
        p.status = PaymentStatus.refund_pending
    try:
        db.commit()
    except IntegrityError:
        # provider_payment_id already used by another payment: replay attack or provider bug.
        db.rollback()
        raise BookingError("Транзакция уже обработана", 409, "duplicate_transaction")
    return p


def process_refunds(db: Session) -> int:
    """Send pending refunds to the provider. Stage 2 will make this asynchronous."""
    done = 0
    for p in db.scalars(select(Payment).where(Payment.status == PaymentStatus.refund_pending)).all():
        if get_provider(p.provider).refund(p):
            p.status = PaymentStatus.refunded
            p.refunded_at = now_utc()
            done += 1
    db.commit()
    return done
