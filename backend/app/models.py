"""Database schema.

Double-booking protection lives in the database itself: `bookings` carries a
PostgreSQL EXCLUDE constraint (see `no_overlapping_bookings`) so two active
bookings of the same table can never overlap in time, no matter how many
requests race each other.
"""

import enum
import uuid
from datetime import datetime, time

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    Time,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class Role(str, enum.Enum):
    customer = "customer"
    restaurant_admin = "restaurant_admin"
    super_admin = "super_admin"


class RestaurantStatus(str, enum.Enum):
    active = "active"
    hidden = "hidden"  # visible to admins only, e.g. while being set up
    inactive = "inactive"  # deactivated by the platform


class TableShape(str, enum.Enum):
    round = "round"
    rect = "rect"


class BookingStatus(str, enum.Enum):
    pending_payment = "pending_payment"
    confirmed = "confirmed"
    cancelled = "cancelled"
    checked_in = "checked_in"
    completed = "completed"
    no_show = "no_show"
    payment_failed = "payment_failed"


# Statuses that occupy a table. Must match the WHERE clause of the
# exclusion constraint in the initial migration.
ACTIVE_BOOKING_STATUSES = (
    BookingStatus.pending_payment,
    BookingStatus.confirmed,
    BookingStatus.checked_in,
)


class PaymentStatus(str, enum.Enum):
    pending = "pending"
    succeeded = "succeeded"
    failed = "failed"
    refund_pending = "refund_pending"
    refunded = "refunded"


def _enum(e: type[enum.Enum], name: str) -> Enum:
    return Enum(e, name=name, values_callable=lambda x: [m.value for m in x])


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str | None] = mapped_column(String(254), unique=True)
    phone: Mapped[str | None] = mapped_column(String(20), unique=True)
    password_hash: Mapped[str] = mapped_column(String(100))
    role: Mapped[Role] = mapped_column(_enum(Role, "user_role"), default=Role.customer)
    # Restaurant a restaurant_admin manages. NULL for everyone else.
    restaurant_id: Mapped[int | None] = mapped_column(ForeignKey("restaurants.id", ondelete="SET NULL"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    language: Mapped[str] = mapped_column(String(5), default="ru")

    restaurant: Mapped["Restaurant | None"] = relationship(foreign_keys=[restaurant_id])

    __table_args__ = (CheckConstraint("email IS NOT NULL OR phone IS NOT NULL", name="user_has_contact"),)


class Restaurant(TimestampMixin, Base):
    __tablename__ = "restaurants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    cuisine: Mapped[list[str]] = mapped_column(JSONB, default=list)
    address: Mapped[str] = mapped_column(String(255), default="")
    district: Mapped[str] = mapped_column(String(80), default="")
    city: Mapped[str] = mapped_column(String(80), default="Астана")
    phone: Mapped[str] = mapped_column(String(40), default="")
    instagram: Mapped[str] = mapped_column(String(120), default="")
    logo_url: Mapped[str] = mapped_column(String(500), default="")
    cover_url: Mapped[str] = mapped_column(String(500), default="")
    average_check: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[RestaurantStatus] = mapped_column(
        _enum(RestaurantStatus, "restaurant_status"), default=RestaurantStatus.active
    )
    is_featured: Mapped[bool] = mapped_column(Boolean, default=False)
    timezone: Mapped[str] = mapped_column(String(40), default="Asia/Almaty")

    # Booking rules
    deposit_amount: Mapped[int] = mapped_column(Integer, default=5000)
    booking_duration_min: Mapped[int] = mapped_column(Integer, default=120)
    slot_step_min: Mapped[int] = mapped_column(Integer, default=30)
    min_lead_min: Mapped[int] = mapped_column(Integer, default=30)
    max_days_ahead: Mapped[int] = mapped_column(Integer, default=30)
    cancel_deadline_hours: Mapped[int] = mapped_column(Integer, default=3)

    rating_avg: Mapped[float] = mapped_column(Float, default=0)
    rating_count: Mapped[int] = mapped_column(Integer, default=0)

    hours: Mapped[list["WorkingHours"]] = relationship(
        back_populates="restaurant", cascade="all, delete-orphan", order_by="WorkingHours.weekday"
    )
    halls: Mapped[list["Hall"]] = relationship(
        back_populates="restaurant", cascade="all, delete-orphan", order_by="Hall.sort_order"
    )
    photos: Mapped[list["Photo"]] = relationship(
        back_populates="restaurant", cascade="all, delete-orphan", order_by="Photo.sort_order"
    )
    menu_categories: Mapped[list["MenuCategory"]] = relationship(
        back_populates="restaurant", cascade="all, delete-orphan", order_by="MenuCategory.sort_order"
    )
    admins: Mapped[list[User]] = relationship(foreign_keys=[User.restaurant_id], viewonly=True)


class WorkingHours(Base):
    __tablename__ = "working_hours"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    restaurant_id: Mapped[int] = mapped_column(ForeignKey("restaurants.id", ondelete="CASCADE"))
    weekday: Mapped[int] = mapped_column(Integer)  # 0 = Monday
    is_closed: Mapped[bool] = mapped_column(Boolean, default=False)
    open_time: Mapped[time] = mapped_column(Time, default=time(10, 0))
    # close_time <= open_time means "closes after midnight"
    close_time: Mapped[time] = mapped_column(Time, default=time(23, 0))

    restaurant: Mapped[Restaurant] = relationship(back_populates="hours")

    __table_args__ = (
        UniqueConstraint("restaurant_id", "weekday"),
        CheckConstraint("weekday BETWEEN 0 AND 6", name="weekday_range"),
    )


class Hall(Base):
    """A room / floor of a restaurant with its own floor plan."""

    __tablename__ = "halls"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    restaurant_id: Mapped[int] = mapped_column(ForeignKey("restaurants.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(80))
    width: Mapped[int] = mapped_column(Integer, default=1000)
    height: Mapped[int] = mapped_column(Integer, default=700)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    # Non-bookable decor drawn on the plan: walls, windows, bar, entrance...
    # [{"id": "...", "kind": "bar", "x": 0, "y": 0, "width": 200, "height": 40, "rotation": 0, "label": ""}]
    decor: Mapped[list[dict]] = mapped_column(JSONB, default=list)

    restaurant: Mapped[Restaurant] = relationship(back_populates="halls")
    tables: Mapped[list["Table"]] = relationship(back_populates="hall", order_by="Table.number")


class Table(Base):
    __tablename__ = "tables"

    # Each table is its own row with a stable UUID, so saving a layout can
    # never overwrite one table with another.
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    restaurant_id: Mapped[int] = mapped_column(ForeignKey("restaurants.id", ondelete="CASCADE"), index=True)
    hall_id: Mapped[int] = mapped_column(ForeignKey("halls.id", ondelete="CASCADE"), index=True)
    number: Mapped[str] = mapped_column(String(10))
    shape: Mapped[TableShape] = mapped_column(_enum(TableShape, "table_shape"), default=TableShape.rect)
    x: Mapped[float] = mapped_column(Float, default=0)
    y: Mapped[float] = mapped_column(Float, default=0)
    width: Mapped[float] = mapped_column(Float, default=80)
    height: Mapped[float] = mapped_column(Float, default=80)
    rotation: Mapped[float] = mapped_column(Float, default=0)
    seats: Mapped[int] = mapped_column(Integer, default=4)
    min_guests: Mapped[int] = mapped_column(Integer, default=1)
    is_vip: Mapped[bool] = mapped_column(Boolean, default=False)
    # Bookable by customers. False = shown as "unavailable" on the plan.
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Soft delete: keeps history of past bookings intact.
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)

    hall: Mapped[Hall] = relationship(back_populates="tables")

    __table_args__ = (
        CheckConstraint("seats BETWEEN 1 AND 50", name="seats_range"),
        CheckConstraint("width > 0 AND height > 0", name="size_positive"),
    )


class Photo(Base):
    __tablename__ = "photos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    restaurant_id: Mapped[int] = mapped_column(ForeignKey("restaurants.id", ondelete="CASCADE"))
    url: Mapped[str] = mapped_column(String(500))
    caption: Mapped[str] = mapped_column(String(200), default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    restaurant: Mapped[Restaurant] = relationship(back_populates="photos")


class MenuCategory(Base):
    __tablename__ = "menu_categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    restaurant_id: Mapped[int] = mapped_column(ForeignKey("restaurants.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(80))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    restaurant: Mapped[Restaurant] = relationship(back_populates="menu_categories")
    items: Mapped[list["MenuItem"]] = relationship(
        back_populates="category", cascade="all, delete-orphan", order_by="MenuItem.sort_order"
    )


class MenuItem(Base):
    __tablename__ = "menu_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    restaurant_id: Mapped[int] = mapped_column(ForeignKey("restaurants.id", ondelete="CASCADE"), index=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("menu_categories.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    price: Mapped[int] = mapped_column(Integer)
    image_url: Mapped[str] = mapped_column(String(500), default="")
    is_hidden: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    category: Mapped[MenuCategory] = relationship(back_populates="items")

    __table_args__ = (CheckConstraint("price >= 0", name="price_non_negative"),)


class Review(Base):
    __tablename__ = "reviews"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    restaurant_id: Mapped[int] = mapped_column(ForeignKey("restaurants.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    rating: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped[User] = relationship()

    __table_args__ = (
        UniqueConstraint("restaurant_id", "user_id"),
        CheckConstraint("rating BETWEEN 1 AND 5", name="rating_range"),
    )


class Favorite(Base):
    __tablename__ = "favorites"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    restaurant_id: Mapped[int] = mapped_column(ForeignKey("restaurants.id", ondelete="CASCADE"), primary_key=True)


class Booking(TimestampMixin, Base):
    __tablename__ = "bookings"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    # Human-friendly number shown to customers and staff, e.g. "R7KQ2M9X".
    code: Mapped[str] = mapped_column(String(12), unique=True)
    # Unguessable secret encoded in the QR code. Never exposed in lists.
    qr_token: Mapped[str] = mapped_column(String(64), unique=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    restaurant_id: Mapped[int] = mapped_column(ForeignKey("restaurants.id", ondelete="CASCADE"), index=True)
    table_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tables.id", ondelete="RESTRICT"))
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    guests: Mapped[int] = mapped_column(Integer)
    contact_name: Mapped[str] = mapped_column(String(120))
    contact_phone: Mapped[str] = mapped_column(String(20))
    contact_email: Mapped[str] = mapped_column(String(254), default="")
    comment: Mapped[str] = mapped_column(Text, default="")
    deposit_amount: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[BookingStatus] = mapped_column(_enum(BookingStatus, "booking_status"), index=True)
    hold_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    checked_in_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancel_reason: Mapped[str] = mapped_column(String(255), default="")
    reminder_sent: Mapped[bool] = mapped_column(Boolean, default=False)

    user: Mapped[User | None] = relationship()
    restaurant: Mapped[Restaurant] = relationship()
    table: Mapped[Table] = relationship()
    payments: Mapped[list["Payment"]] = relationship(back_populates="booking", order_by="Payment.id")

    __table_args__ = (
        CheckConstraint("ends_at > starts_at", name="booking_time_order"),
        CheckConstraint("guests > 0", name="guests_positive"),
        # The EXCLUDE constraint is created in the migration (needs btree_gist):
        # EXCLUDE USING gist (table_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
        #   WHERE (status IN ('pending_payment', 'confirmed', 'checked_in'))
    )


class Payment(TimestampMixin, Base):
    __tablename__ = "payments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    booking_id: Mapped[int] = mapped_column(ForeignKey("bookings.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(30))
    # Id assigned by the provider; unique so a repeated notification is a no-op.
    provider_payment_id: Mapped[str | None] = mapped_column(String(120), unique=True)
    amount: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(3), default="KZT")
    status: Mapped[PaymentStatus] = mapped_column(_enum(PaymentStatus, "payment_status"), default=PaymentStatus.pending)
    failure_reason: Mapped[str] = mapped_column(String(255), default="")
    raw_notification: Mapped[dict | None] = mapped_column(JSONB)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    refunded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    booking: Mapped[Booking] = relationship(back_populates="payments")


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(60))
    entity: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[str] = mapped_column(String(64))
    details: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
