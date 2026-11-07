"""Tests run against a real PostgreSQL database (TEST_DATABASE_URL), because the
double-booking guarantee relies on a PostgreSQL EXCLUDE constraint."""

import os
from datetime import time, timedelta

import pytest

from app.config import get_settings

os.environ["DATABASE_URL"] = get_settings().test_database_url
os.environ["RUN_SCHEDULER"] = "false"
os.environ["PAYMENT_PROVIDER"] = "mock"
get_settings.cache_clear()

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.config import BACKEND_DIR  # noqa: E402
from app.db import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Hall, Restaurant, Role, Table, TableShape, User, WorkingHours  # noqa: E402
from app.security import hash_password  # noqa: E402
from app.services.booking import local_today  # noqa: E402

PASSWORD = "Secret123"


@pytest.fixture(scope="session", autouse=True)
def _schema():
    assert "test" in str(engine.url.database), "refusing to run tests on a non-test database"
    with engine.begin() as c:
        c.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"))
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.attributes["database_url"] = get_settings().database_url
    command.upgrade(cfg, "head")
    yield


@pytest.fixture(autouse=True)
def _clean():
    yield
    with engine.begin() as c:
        c.execute(text(
            "TRUNCATE payments, bookings, reviews, favorites, tables, halls, menu_items, menu_categories, photos, "
            "working_hours, audit_log, users, restaurants RESTART IDENTITY CASCADE"
        ))


@pytest.fixture
def client():
    return TestClient(app)


def make_user(role=Role.customer, email=None, restaurant_id=None, name="Тест"):
    with SessionLocal() as db:
        u = User(name=name, email=email or f"{role.value}{os.urandom(3).hex()}@t.kz", password_hash=hash_password(PASSWORD),
                 role=role, restaurant_id=restaurant_id)
        db.add(u)
        db.commit()
        return u


def login(client, email) -> dict:
    r = client.post("/api/auth/login", json={"identifier": email, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def make_restaurant(name="Test Place", deposit=5000, tables=2):
    with SessionLocal() as db:
        r = Restaurant(slug=name.lower().replace(" ", "-"), name=name, deposit_amount=deposit, min_lead_min=0,
                       booking_duration_min=120, slot_step_min=30)
        # Open around the clock so tests never depend on the time of day.
        r.hours = [WorkingHours(weekday=d, open_time=time(0, 0), close_time=time(0, 0)) for d in range(7)]
        db.add(r)
        db.flush()
        h = Hall(restaurant_id=r.id, name="Зал", decor=[])
        db.add(h)
        db.flush()
        for n in range(1, tables + 1):
            db.add(Table(restaurant_id=r.id, hall_id=h.id, number=str(n), shape=TableShape.round, x=100 * n, y=100, seats=4))
        db.commit()
        db.refresh(r)
        return r


def tomorrow(r) -> str:
    with SessionLocal() as db:
        return (local_today(db.get(Restaurant, r.id)) + timedelta(days=1)).isoformat()


def table_ids(restaurant_id) -> list:
    with SessionLocal() as db:
        from sqlalchemy import select
        return [str(t) for t in db.scalars(select(Table.id).where(Table.restaurant_id == restaurant_id).order_by(Table.number))]


def booking_payload(r, table_id, day, at="19:00", guests=2):
    return {"restaurant_id": r.id, "table_id": table_id, "date": day, "time": at, "guests": guests,
            "contact_name": "Айгерим", "contact_phone": "+7 701 111 22 33"}
