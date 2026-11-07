import re
import uuid
from datetime import date, datetime, time
from typing import Annotated

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints, field_validator, model_validator

from .models import BookingStatus, PaymentStatus, RestaurantStatus, Role, TableShape

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)]
LongText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=5000)]


def normalize_phone(value: str) -> str:
    """Kazakhstan numbers only: returns +7XXXXXXXXXX (legacy rule kept)."""
    phone = re.sub(r"[\s\-()]", "", value)
    if phone.startswith("8") and len(phone) == 11:
        phone = "+7" + phone[1:]
    elif phone.startswith("7") and len(phone) == 11:
        phone = "+" + phone
    if not re.fullmatch(r"\+7\d{10}", phone):
        raise ValueError("Телефон должен быть в формате +7 XXX XXX XX XX")
    return phone


def validate_password(v: str) -> str:
    if len(v) < 8:
        raise ValueError("Пароль должен содержать минимум 8 символов")
    if len(v) > 128:
        raise ValueError("Пароль слишком длинный")
    if " " in v:
        raise ValueError("Пароль не должен содержать пробелы")
    if not re.search(r"[A-Za-zА-Яа-я]", v) or not re.search(r"\d", v):
        raise ValueError("Пароль должен содержать буквы и цифры")
    return v


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- auth / users ----------


class RegisterIn(BaseModel):
    # No `role` field on purpose: public registration always creates a customer.
    model_config = ConfigDict(extra="ignore")

    name: Name
    email: EmailStr | None = None
    phone: str | None = None
    password: str

    @field_validator("phone")
    @classmethod
    def _v_phone(cls, v):
        return normalize_phone(v) if v else None
    @field_validator("password")
    @classmethod
    def _v_password(cls, v):
        return validate_password(v)

    @model_validator(mode="after")
    def need_contact(self):
        if not self.email and not self.phone:
            raise ValueError("Необходимо указать email или телефон")
        if self.email:
            self.email = self.email.lower()
        return self


class LoginIn(BaseModel):
    identifier: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=254)]
    password: Annotated[str, StringConstraints(max_length=128)]


class UserOut(ORM):
    id: int
    name: str
    email: str | None
    phone: str | None
    role: Role
    restaurant_id: int | None
    is_active: bool
    language: str
    created_at: datetime


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class ProfileUpdate(BaseModel):
    name: Name | None = None
    email: EmailStr | None = None
    phone: str | None = None
    language: Annotated[str, StringConstraints(pattern=r"^(ru|kk|en)$")] | None = None

    @field_validator("phone")
    @classmethod
    def _v_phone(cls, v):
        return normalize_phone(v) if v else None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def _v_new_password(cls, v):
        return validate_password(v)


# ---------- restaurants ----------


class WorkingHoursIO(ORM):
    weekday: int = Field(ge=0, le=6)
    is_closed: bool = False
    open_time: time = time(10, 0)
    close_time: time = time(23, 0)


class PhotoOut(ORM):
    id: int
    url: str
    caption: str
    sort_order: int


class MenuItemOut(ORM):
    id: int
    category_id: int
    name: str
    description: str
    price: int
    image_url: str
    is_hidden: bool
    sort_order: int


class MenuCategoryOut(ORM):
    id: int
    name: str
    sort_order: int
    items: list[MenuItemOut] = []


class RestaurantCard(ORM):
    id: int
    slug: str
    name: str
    description: str
    cuisine: list[str]
    address: str
    district: str
    cover_url: str
    logo_url: str
    average_check: int | None
    rating_avg: float
    rating_count: int
    is_featured: bool
    deposit_amount: int
    status: RestaurantStatus


class RestaurantDetail(RestaurantCard):
    city: str
    phone: str
    instagram: str
    timezone: str
    booking_duration_min: int
    slot_step_min: int
    cancel_deadline_hours: int
    max_days_ahead: int
    hours: list[WorkingHoursIO]
    photos: list[PhotoOut]


class RestaurantUpdate(BaseModel):
    """Fields a restaurant admin may edit on their own restaurant."""

    name: Name | None = None
    description: LongText | None = None
    cuisine: list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]] | None = (
        Field(default=None, max_length=10)
    )
    address: ShortText | None = None
    district: Annotated[str, StringConstraints(strip_whitespace=True, max_length=80)] | None = None
    phone: Annotated[str, StringConstraints(strip_whitespace=True, max_length=40)] | None = None
    instagram: Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)] | None = None
    logo_url: Annotated[str, StringConstraints(max_length=500)] | None = None
    cover_url: Annotated[str, StringConstraints(max_length=500)] | None = None
    average_check: int | None = Field(default=None, ge=0, le=10_000_000)
    deposit_amount: int | None = Field(default=None, ge=0, le=1_000_000)
    booking_duration_min: int | None = Field(default=None, ge=30, le=720)
    slot_step_min: int | None = Field(default=None, ge=15, le=120)
    min_lead_min: int | None = Field(default=None, ge=0, le=2880)
    max_days_ahead: int | None = Field(default=None, ge=1, le=365)
    cancel_deadline_hours: int | None = Field(default=None, ge=0, le=168)


class RestaurantAdminUpdate(RestaurantUpdate):
    """Extra fields only the platform (super admin) may change."""

    slug: Annotated[str, StringConstraints(pattern=r"^[a-z0-9-]{2,80}$")] | None = None
    status: RestaurantStatus | None = None
    is_featured: bool | None = None
    city: Annotated[str, StringConstraints(strip_whitespace=True, max_length=80)] | None = None


class RestaurantCreate(RestaurantAdminUpdate):
    name: Name


class ReviewIn(BaseModel):
    rating: int = Field(ge=1, le=5)
    text: Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)] = ""


class ReviewOut(ORM):
    id: int
    rating: int
    text: str
    created_at: datetime
    author: str


# ---------- floor plan ----------


class DecorItem(BaseModel):
    id: Annotated[str, StringConstraints(max_length=40)]
    kind: Annotated[str, StringConstraints(pattern=r"^(wall|window|door|bar|kitchen|stage|plant|label|zone)$")]
    x: float
    y: float
    width: float = Field(gt=0, le=5000)
    height: float = Field(gt=0, le=5000)
    rotation: float = 0
    label: Annotated[str, StringConstraints(max_length=40)] = ""


class TableBase(BaseModel):
    number: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=10)]
    shape: TableShape = TableShape.rect
    x: float = Field(ge=-100, le=5000)
    y: float = Field(ge=-100, le=5000)
    width: float = Field(default=80, ge=20, le=600)
    height: float = Field(default=80, ge=20, le=600)
    rotation: float = Field(default=0, ge=-360, le=360)
    seats: int = Field(default=4, ge=1, le=50)
    min_guests: int = Field(default=1, ge=1, le=50)
    is_vip: bool = False
    is_active: bool = True


class TableIn(TableBase):
    # Existing tables send their UUID; new tables omit it (or send null).
    id: uuid.UUID | None = None


class TableOut(TableBase, ORM):
    id: uuid.UUID
    hall_id: int


class HallIn(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    width: int = Field(default=1000, ge=300, le=5000)
    height: int = Field(default=700, ge=300, le=5000)
    sort_order: int = 0


class HallLayoutIn(BaseModel):
    """Full layout of one hall, saved atomically by the floor-plan editor."""

    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)] | None = None
    width: int | None = Field(default=None, ge=300, le=5000)
    height: int | None = Field(default=None, ge=300, le=5000)
    decor: list[DecorItem] = Field(default_factory=list, max_length=300)
    tables: list[TableIn] = Field(max_length=300)


class HallOut(ORM):
    id: int
    name: str
    width: int
    height: int
    sort_order: int
    decor: list[dict]
    tables: list[TableOut]


class TableAvailability(TableOut):
    # free | booked | unavailable
    state: str
    reason: str = ""


class HallAvailability(BaseModel):
    id: int
    name: str
    width: int
    height: int
    decor: list[dict]
    tables: list[TableAvailability]


class AvailabilityOut(BaseModel):
    date: date
    time: str
    guests: int
    starts_at: datetime
    ends_at: datetime
    halls: list[HallAvailability]


class SlotsOut(BaseModel):
    date: date
    is_closed: bool
    slots: list[str]


# ---------- bookings ----------


class BookingCreate(BaseModel):
    restaurant_id: int
    table_id: uuid.UUID
    date: date
    time: Annotated[str, StringConstraints(pattern=r"^\d{2}:\d{2}$")]
    guests: int = Field(ge=1, le=50)
    contact_name: Name
    contact_phone: str
    contact_email: EmailStr | None = None
    comment: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] = ""

    @field_validator("contact_phone")
    @classmethod
    def _v_contact_phone(cls, v):
        return normalize_phone(v)


class PaymentOut(ORM):
    id: uuid.UUID
    provider: str
    amount: int
    currency: str
    status: PaymentStatus
    failure_reason: str
    paid_at: datetime | None
    created_at: datetime


class BookingOut(ORM):
    id: int
    code: str
    restaurant_id: int
    restaurant_name: str
    restaurant_slug: str
    restaurant_address: str
    table_id: uuid.UUID
    table_number: str
    hall_name: str
    starts_at: datetime
    ends_at: datetime
    guests: int
    contact_name: str
    contact_phone: str
    contact_email: str
    comment: str
    deposit_amount: int
    status: BookingStatus
    hold_expires_at: datetime | None
    checked_in_at: datetime | None
    cancelled_at: datetime | None
    cancel_reason: str
    created_at: datetime
    can_cancel: bool = False


class MyBookingOut(BookingOut):
    # Only the owner (and staff) ever see the QR secret.
    qr_url: str | None = None


class BookingCreated(BaseModel):
    booking: MyBookingOut
    payment_id: uuid.UUID | None
    payment_url: str | None


class StatusChange(BaseModel):
    status: BookingStatus
    reason: Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)] = ""


class CancelIn(BaseModel):
    reason: Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)] = ""


# ---------- menu ----------


class MenuCategoryIn(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    sort_order: int = 0


class MenuItemIn(BaseModel):
    category_id: int
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)] = ""
    price: int = Field(ge=0, le=10_000_000)
    image_url: Annotated[str, StringConstraints(max_length=500)] = ""
    is_hidden: bool = False
    sort_order: int = 0


class MenuItemPatch(BaseModel):
    category_id: int | None = None
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)] | None = None
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)] | None = None
    price: int | None = Field(default=None, ge=0, le=10_000_000)
    image_url: Annotated[str, StringConstraints(max_length=500)] | None = None
    is_hidden: bool | None = None
    sort_order: int | None = None


class PhotoIn(BaseModel):
    url: Annotated[str, StringConstraints(min_length=1, max_length=500)]
    caption: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] = ""
    sort_order: int = 0


class UploadOut(BaseModel):
    url: str


# ---------- admin ----------


class AdminUserCreate(BaseModel):
    name: Name
    email: EmailStr
    phone: str | None = None
    password: str
    role: Role = Role.restaurant_admin
    restaurant_id: int | None = None

    @field_validator("phone")
    @classmethod
    def _v_phone(cls, v):
        return normalize_phone(v) if v else None
    @field_validator("password")
    @classmethod
    def _v_password(cls, v):
        return validate_password(v)


class AdminUserPatch(BaseModel):
    name: Name | None = None
    role: Role | None = None
    restaurant_id: int | None = None
    is_active: bool | None = None
    password: str | None = None

    @field_validator("password")
    @classmethod
    def _pw(cls, v):
        return validate_password(v) if v else v


class AdminUserOut(UserOut):
    restaurant_name: str | None = None
    bookings_count: int = 0


class Paginated[T](BaseModel):
    items: list[T]
    total: int
    page: int
    page_size: int
