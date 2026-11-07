"""The acceptance scenarios from section 12 of the specification."""

import json
import threading
from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select, update

from app.db import SessionLocal
from app.main import app
from app.models import Booking, BookingStatus, Payment, PaymentStatus, Role, User
from app.services.booking import now_utc
from app.services.payments import MockProvider

from .conftest import booking_payload, login, make_restaurant, make_user, table_ids, tomorrow


def pay(client, headers, payment_id, success=True):
    r = client.post(f"/api/payments/mock/{payment_id}/simulate", json={"success": success}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


# 1. register + login; self-registration can never grant an admin role
def test_register_login_and_role_cannot_be_injected(client):
    r = client.post("/api/auth/register", json={
        "name": "Ерлан", "email": "Erlan@Mail.kz", "password": "Qwerty123", "role": "super_admin",
        "restaurant_id": 1,
    })
    assert r.status_code == 201, r.text
    assert r.json()["user"]["role"] == "customer"
    assert r.json()["user"]["restaurant_id"] is None
    r = client.post("/api/auth/login", json={"identifier": "erlan@mail.kz", "password": "Qwerty123"})
    assert r.status_code == 200
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {r.json()['access_token']}"})
    assert me.json()["email"] == "erlan@mail.kz"
    assert client.post("/api/auth/login", json={"identifier": "erlan@mail.kz", "password": "wrong1234"}).status_code == 401
    # duplicate
    assert client.post("/api/auth/register", json={"name": "X", "email": "erlan@mail.kz", "password": "Qwerty123"}).status_code == 409


def test_phone_registration_and_login(client):
    r = client.post("/api/auth/register", json={"name": "Дана", "phone": "8 (701) 555-44-33", "password": "Qwerty123"})
    assert r.status_code == 201
    assert r.json()["user"]["phone"] == "+77015554433"
    assert client.post("/api/auth/login", json={"identifier": "+7 701 555 44 33", "password": "Qwerty123"}).status_code == 200


# 2. customers cannot reach admin panels
def test_customer_cannot_access_admin(client):
    r = make_restaurant()
    u = make_user()
    h = login(client, u.email)
    assert client.get("/api/admin/stats", headers=h).status_code == 403
    assert client.get("/api/admin/users", headers=h).status_code == 403
    assert client.get(f"/api/partner/restaurants/{r.id}/bookings", headers=h).status_code == 403
    assert client.get("/api/admin/stats").status_code == 401


# 3. restaurant admin sees only their restaurant
def test_restaurant_admin_is_scoped(client):
    a, b = make_restaurant("A"), make_restaurant("B")
    admin = make_user(Role.restaurant_admin, restaurant_id=a.id)
    h = login(client, admin.email)
    assert client.get(f"/api/partner/restaurants/{a.id}/stats", headers=h).status_code == 200
    for path in ("", "/stats", "/bookings", "/halls", "/menu"):
        assert client.get(f"/api/partner/restaurants/{b.id}{path}", headers=h).status_code == 403
    assert client.patch(f"/api/partner/restaurants/{b.id}", json={"deposit_amount": 0}, headers=h).status_code == 403
    assert [x["id"] for x in client.get("/api/partner/restaurants", headers=h).json()] == [a.id]
    assert client.get("/api/admin/restaurants", headers=h).status_code == 403


# 4. super admin has access everywhere
def test_super_admin_access(client):
    a = make_restaurant("A")
    sa = make_user(Role.super_admin)
    h = login(client, sa.email)
    assert client.get(f"/api/partner/restaurants/{a.id}/stats", headers=h).status_code == 200
    for path in ("/stats", "/finance", "/users", "/bookings", "/restaurants"):
        assert client.get(f"/api/admin{path}", headers=h).status_code == 200
    # create a restaurant and a restaurant admin for it
    r = client.post("/api/admin/restaurants", json={"name": "Новый Ресторан"}, headers=h)
    assert r.status_code == 201 and r.json()["deposit_amount"] == 5000
    rid = r.json()["id"]
    u = client.post("/api/admin/users", json={"name": "Менеджер", "email": "m@new.kz", "password": "Manager123",
                                              "role": "restaurant_admin", "restaurant_id": rid}, headers=h)
    assert u.status_code == 201
    mh = login_pw(client, "m@new.kz", "Manager123")
    assert client.get(f"/api/partner/restaurants/{rid}", headers=mh).status_code == 200
    # block -> cannot use the token any more
    assert client.patch(f"/api/admin/users/{u.json()['id']}", json={"is_active": False}, headers=h).status_code == 200
    assert client.get(f"/api/partner/restaurants/{rid}", headers=mh).status_code == 403


def login_pw(client, email, pw):
    r = client.post("/api/auth/login", json={"identifier": email, "password": pw})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# 5-9. full flow: choose table -> hold -> pay -> confirmed -> QR -> check-in
def test_full_booking_flow_with_payment_and_qr_checkin(client):
    r = make_restaurant()
    t1, t2 = table_ids(r.id)
    cust = make_user()
    h = login(client, cust.email)
    day = tomorrow(r)

    slots = client.get(f"/api/restaurants/{r.id}/slots", params={"date": day}).json()
    assert "19:00" in slots["slots"]
    av = client.get(f"/api/restaurants/{r.id}/availability", params={"date": day, "time": "19:00", "guests": 2}).json()
    assert {t["state"] for t in av["halls"][0]["tables"]} == {"free"}

    res = client.post("/api/bookings", json=booking_payload(r, t1, day), headers=h)
    assert res.status_code == 201, res.text
    body = res.json()
    bid = body["booking"]["id"]
    assert body["booking"]["status"] == "pending_payment"
    assert body["booking"]["deposit_amount"] == 5000
    assert body["booking"]["qr_url"] is None  # no QR before payment

    # the table is held during payment
    av = client.get(f"/api/restaurants/{r.id}/availability", params={"date": day, "time": "19:00", "guests": 2}).json()
    states = {t["id"]: t["state"] for t in av["halls"][0]["tables"]}
    assert states[t1] == "booked" and states[t2] == "free"

    pay(client, h, body["payment_id"])
    b = client.get(f"/api/bookings/{bid}", headers=h).json()
    assert b["status"] == "confirmed"
    qr = b["qr_url"]
    assert qr and "/check/" in qr
    token = qr.rsplit("/", 1)[1]

    # QR page: strangers and other restaurants' staff cannot read or change it
    assert client.get(f"/api/checkin/{token}").status_code == 401
    assert client.get(f"/api/checkin/{token}", headers=h).status_code == 403
    other = make_restaurant("Other")
    oh = login(client, make_user(Role.restaurant_admin, restaurant_id=other.id).email)
    assert client.post(f"/api/checkin/{token}", headers=oh).status_code == 403
    assert client.get("/api/checkin/forged-token", headers=oh).status_code == 404

    staff = login(client, make_user(Role.restaurant_admin, restaurant_id=r.id).email)
    info = client.get(f"/api/checkin/{token}", headers=staff).json()
    assert info["code"] == b["code"] and info["table_number"] == "1" and info["guests"] == 2
    # check-in is only allowed close to the booking time; move the booking to now
    with SessionLocal() as db:
        db.execute(update(Booking).where(Booking.id == bid).values(
            starts_at=now_utc() + timedelta(minutes=10), ends_at=now_utc() + timedelta(minutes=130)))
        db.commit()
    done = client.post(f"/api/checkin/{token}", headers=staff)
    assert done.status_code == 200 and done.json()["status"] == "checked_in"


def test_failed_payment_releases_table(client):
    r = make_restaurant()
    t1, _ = table_ids(r.id)
    h = login(client, make_user().email)
    day = tomorrow(r)
    body = client.post("/api/bookings", json=booking_payload(r, t1, day), headers=h).json()
    pay(client, h, body["payment_id"], success=False)
    b = client.get(f"/api/bookings/{body['booking']['id']}", headers=h).json()
    assert b["status"] == "payment_failed"
    # table is free again
    h2 = login(client, make_user().email)
    assert client.post("/api/bookings", json=booking_payload(r, t1, day), headers=h2).status_code == 201


def test_webhook_signature_and_idempotency(client):
    r = make_restaurant()
    t1, _ = table_ids(r.id)
    h = login(client, make_user().email)
    body = client.post("/api/bookings", json=booking_payload(r, t1, tomorrow(r)), headers=h).json()
    payload = json.dumps({"order_id": body["payment_id"], "transaction_id": "tx-1", "status": "success"}).encode()
    bad = client.post("/api/payments/webhook/mock", content=payload, headers={"X-Signature": "forged"})
    assert bad.status_code == 400
    sig = MockProvider.sign(payload)
    for _ in range(3):  # provider retries must not double-process
        assert client.post("/api/payments/webhook/mock", content=payload, headers={"X-Signature": sig}).status_code == 200
    with SessionLocal() as db:
        pays = db.scalars(select(Payment)).all()
        assert len(pays) == 1 and pays[0].status == PaymentStatus.succeeded
    # a second /pay call on a confirmed booking does not create a new charge
    assert client.post(f"/api/bookings/{body['booking']['id']}/pay", headers=h).status_code == 409


def test_expired_hold_frees_table(client):
    r = make_restaurant()
    t1, _ = table_ids(r.id)
    day = tomorrow(r)
    h1 = login(client, make_user().email)
    first = client.post("/api/bookings", json=booking_payload(r, t1, day), headers=h1).json()
    with SessionLocal() as db:
        db.execute(update(Booking).values(hold_expires_at=now_utc() - timedelta(seconds=1)))
        db.commit()
    h2 = login(client, make_user().email)
    second = client.post("/api/bookings", json=booking_payload(r, t1, day), headers=h2)
    assert second.status_code == 201
    with SessionLocal() as db:
        assert db.get(Booking, first["booking"]["id"]).status == BookingStatus.payment_failed
    # late payment for the expired hold -> table already taken -> refund
    pay(client, h1, first["payment_id"])
    with SessionLocal() as db:
        p = db.get(Payment, __import__("uuid").UUID(first["payment_id"]))
        assert p.status == PaymentStatus.refunded
        assert db.get(Booking, first["booking"]["id"]).status == BookingStatus.payment_failed


# 13. no two overlapping bookings of one table
def test_overlapping_bookings_rejected(client):
    r = make_restaurant()
    t1, t2 = table_ids(r.id)
    day = tomorrow(r)
    h1, h2 = login(client, make_user().email), login(client, make_user().email)
    assert client.post("/api/bookings", json=booking_payload(r, t1, day, "19:00"), headers=h1).status_code == 201
    # 20:00 overlaps 19:00-21:00
    clash = client.post("/api/bookings", json=booking_payload(r, t1, day, "20:00"), headers=h2)
    assert clash.status_code == 409 and clash.json()["detail"]["code"] == "table_taken"
    # adjacent slot and other tables are fine
    assert client.post("/api/bookings", json=booking_payload(r, t1, day, "21:00"), headers=h2).status_code == 201
    assert client.post("/api/bookings", json=booking_payload(r, t2, day, "20:00"), headers=h2).status_code == 201


def test_concurrent_requests_only_one_wins():
    r = make_restaurant()
    t1, _ = table_ids(r.id)
    day = tomorrow(r)
    users = [make_user() for _ in range(16)]
    results = []
    barrier = threading.Barrier(len(users))

    def attempt(u):
        try:
            c = TestClient(app, raise_server_exceptions=False)
            h = login(c, u.email)
            barrier.wait()
            res = c.post("/api/bookings", json=booking_payload(r, t1, day), headers=h)
            results.append(res.status_code if res.status_code in (201, 409) else (res.status_code, res.text))
        except Exception as e:  # surface thread failures in the assertion
            results.append(repr(e))

    threads = [threading.Thread(target=attempt, args=(u,)) for u in users]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(results) == [201] + [409] * (len(users) - 1), results
    with SessionLocal() as db:
        assert len(db.scalars(select(Booking)).all()) == 1


def test_server_validates_capacity_and_slot(client):
    r = make_restaurant()
    t1, _ = table_ids(r.id)
    h = login(client, make_user().email)
    day = tomorrow(r)
    assert client.post("/api/bookings", json=booking_payload(r, t1, day, guests=9), headers=h).status_code == 400
    assert client.post("/api/bookings", json=booking_payload(r, t1, day, at="19:10"), headers=h).status_code == 400
    assert client.post("/api/bookings", json=booking_payload(r, t1, "2020-01-01"), headers=h).status_code == 400
    assert client.post("/api/bookings", json=booking_payload(r, t1, day)).status_code == 401


def test_customer_cancel_rules(client):
    r = make_restaurant(deposit=0)  # no deposit -> confirmed immediately
    t1, _ = table_ids(r.id)
    h = login(client, make_user().email)
    b = client.post("/api/bookings", json=booking_payload(r, t1, tomorrow(r)), headers=h).json()["booking"]
    assert b["status"] == "confirmed"
    other = login(client, make_user().email)
    assert client.post(f"/api/bookings/{b['id']}/cancel", json={}, headers=other).status_code == 404
    assert client.post(f"/api/bookings/{b['id']}/cancel", json={}, headers=h).json()["status"] == "cancelled"
    # deadline: within cancel_deadline_hours a confirmed booking cannot be cancelled by the client
    b2 = client.post("/api/bookings", json=booking_payload(r, t1, tomorrow(r)), headers=h).json()["booking"]
    with SessionLocal() as db:
        db.execute(update(Booking).where(Booking.id == b2["id"]).values(
            starts_at=now_utc() + timedelta(hours=1), ends_at=now_utc() + timedelta(hours=3)))
        db.commit()
    assert client.post(f"/api/bookings/{b2['id']}/cancel", json={}, headers=h).status_code == 400


# 10-12. floor-plan editor: adding a table never removes others; persists
def test_layout_editor_adds_without_replacing(client):
    r = make_restaurant(tables=0)
    h = login(client, make_user(Role.restaurant_admin, restaurant_id=r.id).email)
    hall = client.get(f"/api/partner/restaurants/{r.id}/halls", headers=h).json()[0]
    url = f"/api/partner/restaurants/{r.id}/halls/{hall['id']}/layout"

    first = client.put(url, json={"tables": [{"number": "1", "shape": "round", "x": 10, "y": 10, "seats": 2}]}, headers=h)
    assert first.status_code == 200
    t1 = first.json()["tables"][0]
    second = client.put(url, json={"tables": [
        {**t1},
        {"number": "2", "shape": "rect", "x": 200, "y": 50, "width": 140, "height": 80, "rotation": 45, "seats": 6},
    ]}, headers=h)
    assert second.status_code == 200
    tables = second.json()["tables"]
    assert len(tables) == 2 and len({t["id"] for t in tables}) == 2
    assert next(t for t in tables if t["number"] == "1")["id"] == t1["id"]

    # move table 1, change its seats, then "reload"
    moved = {**t1, "x": 333, "y": 444, "seats": 4}
    client.put(url, json={"tables": [moved, next(t for t in tables if t["number"] == "2")]}, headers=h)
    reloaded = client.get(f"/api/partner/restaurants/{r.id}/halls", headers=h).json()[0]["tables"]
    t = next(t for t in reloaded if t["number"] == "1")
    assert (t["x"], t["y"], t["seats"]) == (333, 444, 4)
    t2 = next(t for t in reloaded if t["number"] == "2")
    assert t2["rotation"] == 45 and t2["width"] == 140

    # client side sees the new layout immediately
    av = client.get(f"/api/restaurants/{r.id}/availability", params={"date": tomorrow(r), "time": "19:00", "guests": 2}).json()
    assert {x["number"] for x in av["halls"][0]["tables"]} == {"1", "2"}

    # duplicate numbers rejected
    dup = client.put(url, json={"tables": [moved, {**moved, "id": None}]}, headers=h)
    assert dup.status_code == 422


def test_layout_cannot_delete_table_with_future_booking(client):
    r = make_restaurant(deposit=0)
    t1, t2 = table_ids(r.id)
    ch = login(client, make_user().email)
    assert client.post("/api/bookings", json=booking_payload(r, t1, tomorrow(r)), headers=ch).status_code == 201
    h = login(client, make_user(Role.restaurant_admin, restaurant_id=r.id).email)
    hall = client.get(f"/api/partner/restaurants/{r.id}/halls", headers=h).json()[0]
    keep = [t for t in hall["tables"] if t["id"] == t2]
    res = client.put(f"/api/partner/restaurants/{r.id}/halls/{hall['id']}/layout", json={"tables": keep}, headers=h)
    assert res.status_code == 409


# 14. statistics come from real data
def test_stats_reflect_real_bookings(client):
    r = make_restaurant()
    t1, t2 = table_ids(r.id)
    ch = login(client, make_user().email)
    day = tomorrow(r)
    b1 = client.post("/api/bookings", json=booking_payload(r, t1, day), headers=ch).json()
    pay(client, ch, b1["payment_id"])
    b2 = client.post("/api/bookings", json=booking_payload(r, t2, day, guests=3), headers=ch).json()
    pay(client, ch, b2["payment_id"])
    client.post(f"/api/bookings/{b2['booking']['id']}/cancel", json={}, headers=ch)

    h = login(client, make_user(Role.restaurant_admin, restaurant_id=r.id).email)
    s = client.get(f"/api/partner/restaurants/{r.id}/stats", headers=h).json()
    assert s["total_bookings"] == 2
    assert s["active_bookings"] == 1
    assert s["cancelled_bookings"] == 1
    assert s["deposits_total"] == 5000  # the cancelled one was refunded

    sa = login(client, make_user(Role.super_admin).email)
    f = client.get("/api/admin/finance", headers=sa).json()
    assert f["deposits_total"] == 5000 and f["successful_payments"] == 1 and f["refunds"] == 1
    st = client.get("/api/admin/stats", headers=sa).json()
    assert st["bookings_total"] == 2 and st["bookings_cancelled"] == 1

    lst = client.get(f"/api/partner/restaurants/{r.id}/bookings", params={"status": "cancelled"}, headers=h).json()
    assert lst["total"] == 1 and lst["items"][0]["guests"] == 3


def test_staff_status_transitions(client):
    r = make_restaurant(deposit=0)
    t1, _ = table_ids(r.id)
    ch = login(client, make_user().email)
    b = client.post("/api/bookings", json=booking_payload(r, t1, tomorrow(r)), headers=ch).json()["booking"]
    h = login(client, make_user(Role.restaurant_admin, restaurant_id=r.id).email)
    url = f"/api/partner/restaurants/{r.id}/bookings/{b['id']}/status"
    assert client.patch(url, json={"status": "no_show"}, headers=h).status_code == 200
    assert client.patch(url, json={"status": "confirmed"}, headers=h).status_code == 409


def test_menu_and_hidden_items(client):
    r = make_restaurant()
    h = login(client, make_user(Role.restaurant_admin, restaurant_id=r.id).email)
    base = f"/api/partner/restaurants/{r.id}/menu"
    cat = client.post(f"{base}/categories", json={"name": "Супы"}, headers=h).json()
    a = client.post(f"{base}/items", json={"category_id": cat["id"], "name": "Борщ", "price": 2500}, headers=h).json()
    client.post(f"{base}/items", json={"category_id": cat["id"], "name": "Солянка", "price": 2700}, headers=h)
    client.patch(f"{base}/items/{a['id']}", json={"is_hidden": True}, headers=h)
    public = client.get(f"/api/restaurants/{r.id}/menu").json()
    assert [i["name"] for i in public[0]["items"]] == ["Солянка"]
    # XSS payloads are stored as plain text (the frontend renders text, never HTML)
    x = client.post(f"{base}/items", json={"category_id": cat["id"], "name": "<img src=x onerror=alert(1)>", "price": 1}, headers=h)
    assert x.status_code == 201 and x.json()["name"].startswith("<img")


def test_upload_rejects_non_images(client):
    r = make_restaurant()
    h = login(client, make_user(Role.restaurant_admin, restaurant_id=r.id).email)
    bad = client.post(f"/api/partner/restaurants/{r.id}/uploads", files={"file": ("x.jpg", b"<?php echo 1; ?>", "image/jpeg")}, headers=h)
    assert bad.status_code == 415
    from io import BytesIO

    from PIL import Image
    buf = BytesIO()
    Image.new("RGB", (40, 30), "red").save(buf, "PNG")
    ok = client.post(f"/api/partner/restaurants/{r.id}/uploads", files={"file": ("a.png", buf.getvalue(), "image/png")}, headers=h)
    assert ok.status_code == 201 and ok.json()["url"].endswith(".webp")


def test_sql_injection_in_search_is_harmless(client):
    make_restaurant("Safe")
    r = client.get("/api/restaurants", params={"q": "'; DROP TABLE users; --"})
    assert r.status_code == 200 and r.json() == []
    with SessionLocal() as db:
        db.scalars(select(User)).all()  # table still exists
