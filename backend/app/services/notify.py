"""E-mail notifications. Without SMTP settings, messages are written to the log.

SMS / WhatsApp channels are planned for stage 3 and plug in next to send_email.
"""

import logging
import smtplib
from concurrent.futures import ThreadPoolExecutor
from email.message import EmailMessage
from html import escape
from zoneinfo import ZoneInfo

from ..config import get_settings
from ..models import Booking

log = logging.getLogger(__name__)
_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="mail")


def _send(to: str, subject: str, text: str) -> None:
    s = get_settings()
    if not s.smtp_host:
        log.info("E-mail (SMTP not configured) to=%s subject=%s\n%s", to, subject, text)
        return
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = s.smtp_from
    msg["To"] = to
    msg.set_content(text)
    msg.add_alternative(f"<div style='font-family:sans-serif;line-height:1.5'>{escape(text).replace(chr(10), '<br>')}</div>", subtype="html")
    try:
        with smtplib.SMTP_SSL(s.smtp_host, s.smtp_port, timeout=15) as smtp:
            if s.smtp_user:
                smtp.login(s.smtp_user, s.smtp_password)
            smtp.send_message(msg)
    except Exception:
        log.exception("Failed to send e-mail to %s", to)


def send_email(to: str, subject: str, text: str) -> None:
    if to:
        _pool.submit(_send, to, subject, text)


def format_kzt(amount: int) -> str:
    return f"{amount:,}".replace(",", " ") + " ₸"


def _details(b: Booking) -> str:
    local = b.starts_at.astimezone(ZoneInfo(b.restaurant.timezone))
    return (
        f"Ресторан: {b.restaurant.name}\n"
        f"Адрес: {b.restaurant.address}\n"
        f"Дата и время: {local:%d.%m.%Y %H:%M}\n"
        f"Столик: №{b.table.number} ({b.table.hall.name})\n"
        f"Гостей: {b.guests}\n"
        f"Номер брони: {b.code}"
    )


def booking_confirmed(b: Booking, checkin_url: str) -> None:
    send_email(
        b.contact_email,
        f"Reserve: бронь {b.code} подтверждена",
        f"Здравствуйте, {b.contact_name}!\n\nВаше бронирование подтверждено.\n\n{_details(b)}\n"
        f"Депозит: {format_kzt(b.deposit_amount)}\n\nQR-код для ресторана: {checkin_url}\n\nReserve",
    )


def booking_cancelled(b: Booking) -> None:
    send_email(
        b.contact_email,
        f"Reserve: бронь {b.code} отменена",
        f"Здравствуйте, {b.contact_name}!\n\nБронирование отменено.\n\n{_details(b)}\n"
        f"Причина: {b.cancel_reason or '—'}\n\nReserve",
    )


def restaurant_new_booking(b: Booking, admin_emails: list[str]) -> None:
    for email in admin_emails:
        send_email(email, f"Reserve: новая бронь {b.code}", f"Новое бронирование.\n\n{_details(b)}\n"
                   f"Клиент: {b.contact_name}, {b.contact_phone}\nКомментарий: {b.comment or '—'}")
