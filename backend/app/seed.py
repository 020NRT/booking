"""Initial data.

    python -m app.seed --superadmin   # create/update the Super Admin from .env
    python -m app.seed --demo         # load the 3 restaurants from the legacy prototype

Both are idempotent. Demo restaurants keep the names, menus and floor plans of
the original prototype (legacy/main.py, legacy/index.html) so nothing that
already existed is lost.
"""

import argparse
import secrets
import sys
from datetime import time

from sqlalchemy import select

from .config import BACKEND_DIR, get_settings
from .db import SessionLocal
from .models import Hall, MenuCategory, MenuItem, Photo, Restaurant, Role, Table, TableShape, User, WorkingHours
from .security import hash_password

U = "https://images.unsplash.com/"
CREDENTIALS_FILE = BACKEND_DIR / "demo-credentials.txt"

# Floor plans copied from legacy/index.html (floorPlans), per restaurant and floor.
# type: square | rectangle | round; legacy size rule: <=4 seats 80px, <=6 100px, else 120px.
LEGACY_PLANS = {
    1: {1: [(1, 50, 50, 4, "square"), (2, 200, 50, 4, "square"), (3, 350, 50, 6, "rectangle"), (4, 50, 200, 4, "square"),
            (5, 200, 200, 4, "square"), (6, 350, 200, 6, "rectangle"), (7, 50, 350, 8, "rectangle"),
            (8, 250, 350, 10, "rectangle"), (9, 500, 50, 4, "round", True), (10, 500, 200, 6, "round", True)],
        2: [(1, 60, 60, 4, "square"), (2, 220, 60, 4, "square"), (3, 380, 60, 6, "rectangle"), (4, 60, 220, 4, "square"),
            (5, 220, 220, 8, "rectangle"), (6, 60, 380, 6, "rectangle"), (7, 280, 380, 10, "rectangle"),
            (8, 520, 100, 6, "round", True), (9, 520, 280, 4, "round"), (10, 520, 420, 4, "round")]},
    2: {1: [(1, 40, 40, 4, "square"), (2, 180, 40, 6, "rectangle"), (3, 360, 40, 4, "square"), (4, 500, 40, 6, "rectangle"),
            (5, 40, 200, 8, "rectangle"), (6, 300, 200, 10, "rectangle"), (7, 40, 380, 4, "square"), (8, 180, 380, 4, "square"),
            (9, 320, 380, 6, "round", True), (10, 520, 300, 8, "round", True)],
        2: [(1, 50, 50, 4, "square"), (2, 200, 50, 4, "square"), (3, 350, 50, 6, "rectangle"), (4, 500, 50, 4, "square"),
            (5, 50, 220, 10, "rectangle"), (6, 350, 220, 8, "rectangle"), (7, 50, 400, 6, "rectangle"),
            (8, 280, 400, 4, "square"), (9, 450, 400, 6, "round", True), (10, 620, 220, 4, "round")]},
    3: {1: [(1, 60, 60, 4, "square"), (2, 220, 60, 4, "square"), (3, 380, 60, 6, "rectangle"), (4, 60, 240, 8, "rectangle"),
            (5, 320, 240, 10, "rectangle"), (6, 60, 420, 4, "square"), (7, 220, 420, 6, "rectangle"),
            (8, 540, 100, 6, "round", True), (9, 540, 280, 8, "round", True), (10, 540, 440, 4, "round")]},
}

DEMO = [
    dict(
        slug="zevra-coffee", name="Zevra Coffee", district="Expo", address="Мангілік Ел, 35",
        description="Уютная кофейня с панорамными окнами и авторским кофе.",
        cuisine=["Кафе", "Европейская"], hours=(time(9), time(23)), average_check=4000, is_featured=True,
        cover=U + "photo-1445116572660-236099ec97a0?w=1600&q=80",
        photos=["photo-1501339847302-ac426a4a7cbb", "photo-1554118811-1e0d58224f24", "photo-1453614512568-c4024d13c247"],
        menu={
            "Напитки": [("Капучино", 1200, "Классический итальянский кофе с молочной пеной", "photo-1572442388796-11668a67e53d"),
                        ("Латте", 1300, "Нежный кофе с молоком", "photo-1561882468-9110e03e0f78"),
                        ("Американо", 900, "Крепкий эспрессо с водой", "photo-1514432324607-a09d9b4aefdd")],
            "Выпечка": [("Круассан с шоколадом", 1500, "Свежий французский круассан", "photo-1555507036-ab1f4038808a")],
            "Десерты": [("Чизкейк Нью-Йорк", 2500, "Классический американский чизкейк", "photo-1533134242820-b6f7a4ff6adb")],
            "Закуски": [("Панини с ветчиной", 2800, "Горячий сэндвич с сыром и ветчиной", "photo-1509722747041-616f39b57569")],
        },
    ),
    dict(
        slug="coffee-bum", name="Coffee Bum", district="Keruen", address="Кабанбай батыр, 10",
        description="Современный ресторан с европейской кухней и изысканным интерьером.",
        cuisine=["Европейская", "Итальянская"], hours=(time(10), time(22)), average_check=9000, is_featured=True,
        cover=U + "photo-1517248135467-4c7edcad34c4?w=1600&q=80",
        photos=["photo-1414235077428-338989a2e8c0", "photo-1559339352-11d035aa65de", "photo-1550966871-3ed3cdb5ed0c"],
        menu={
            "Основные блюда": [("Стейк Рибай", 8900, "Мраморная говядина 300 г с овощами гриль", "photo-1546833999-b9f581a1996d"),
                               ("Паста Карбонара", 3500, "Классическая итальянская паста с беконом", "photo-1612874742237-6526221588e3"),
                               ("Ризотто с грибами", 4200, "Кремовое ризотто с белыми грибами", "photo-1476124369491-c4e285d8e1c2")],
            "Салаты": [("Салат Цезарь", 2900, "С курицей, пармезаном и соусом", "photo-1546793665-c74683f339c1")],
            "Закуски": [("Брускетта", 1800, "Хрустящий хлеб с томатами и базиликом", "photo-1572695157366-5e585ab2b69f")],
            "Десерты": [("Тирамису", 2200, "Итальянский десерт с маскарпоне", "photo-1571877227200-a0d98ea607e9")],
        },
    ),
    dict(
        slug="okadzaka", name="Okadzaka", district="Expo", address="Мангілік Ел, 55",
        description="Аутентичная японская кухня от шеф-повара из Токио.",
        cuisine=["Японская", "Азиатская"], hours=(time(11), time(23)), average_check=8000, is_featured=False,
        cover=U + "photo-1579584425555-c3ce17fd4351?w=1600&q=80",
        photos=["photo-1552566626-52f8b828add9", "photo-1540914124281-342587941389", "photo-1611143669185-af224c5e3252"],
        menu={
            "Роллы": [("Филадельфия", 3200, "Лосось, сыр филадельфия, огурец", "photo-1579584425555-c3ce17fd4351"),
                      ("Калифорния", 2800, "Краб, авокадо, огурец, икра тобико", "photo-1617196034796-73dfa7b1fd56")],
            "Сашими": [("Сашими сет", 6500, "Ассорти из свежей рыбы", "photo-1580822184713-fc5400e7fe10")],
            "Супы": [("Рамен", 3800, "Японский суп с лапшой и свининой", "photo-1569718212165-3a8278d5f624")],
            "Закуски": [("Темпура", 3200, "Креветки и овощи в кляре", "photo-1534422298391-e4f8c172dddb")],
            "Десерты": [("Мочи", 1500, "Японские рисовые пирожные", "photo-1563805042-7684c019e1cb")],
        },
    ),
]


def _table(rid: int, hall_id: int, spec) -> Table:
    num, x, y, seats, kind, *vip = spec
    size = 80 if seats <= 4 else 100 if seats <= 6 else 120
    shape = TableShape.round if kind == "round" else TableShape.rect
    h = size * 0.6 if kind == "rectangle" else size
    # Legacy coordinates were for a ~700x520 box; scale into a 1000x700 hall.
    return Table(restaurant_id=rid, hall_id=hall_id, number=str(num), shape=shape, x=x * 1.25 + 30, y=y * 1.15 + 40,
                 width=size * (1.3 if kind == "rectangle" else 1), height=h, seats=seats, is_vip=bool(vip))


def _decor(floor: int) -> list[dict]:
    items = [
        {"id": "door", "kind": "door", "x": 440, "y": 680, "width": 120, "height": 16, "rotation": 0, "label": "Вход"},
        {"id": "wall-top", "kind": "wall", "x": 0, "y": 0, "width": 1000, "height": 10, "rotation": 0, "label": ""},
    ]
    if floor == 1:
        items += [
            {"id": "window", "kind": "window", "x": 760, "y": 0, "width": 200, "height": 12, "rotation": 0, "label": "Окно"},
            {"id": "bar", "kind": "bar", "x": 870, "y": 420, "width": 110, "height": 240, "rotation": 0, "label": "Бар"},
        ]
    return items


def seed_superadmin(db) -> None:
    s = get_settings()
    if not s.superadmin_password:
        sys.exit("SUPERADMIN_PASSWORD is empty in .env")
    u = db.scalar(select(User).where(User.email == s.superadmin_email.lower()))
    if u is None:
        u = User(name="Reserve Admin", email=s.superadmin_email.lower(), password_hash="")
        db.add(u)
    u.role, u.restaurant_id, u.is_active = Role.super_admin, None, True
    u.password_hash = hash_password(s.superadmin_password)
    db.commit()
    print(f"Super Admin ready: {u.email}")


def seed_demo(db) -> None:
    created_admins = []
    for idx, d in enumerate(DEMO, start=1):
        if db.scalar(select(Restaurant.id).where(Restaurant.slug == d["slug"])):
            print(f"skip {d['slug']} (exists)")
            continue
        r = Restaurant(
            slug=d["slug"], name=d["name"], description=d["description"], cuisine=d["cuisine"], address=d["address"],
            district=d["district"], phone="+7 717 200 00 0" + str(idx), cover_url=d["cover"],
            average_check=d["average_check"], is_featured=d["is_featured"],
            deposit_amount=get_settings().default_deposit_kzt,
        )
        o, c = d["hours"]
        r.hours = [WorkingHours(weekday=w, open_time=o, close_time=c) for w in range(7)]
        r.photos = [Photo(url=f"{U}{p}?w=1400&q=80", sort_order=n) for n, p in enumerate(d["photos"])]
        db.add(r)
        db.flush()
        for n, (cat, items) in enumerate(d["menu"].items()):
            mc = MenuCategory(restaurant_id=r.id, name=cat, sort_order=n)
            mc.items = [MenuItem(restaurant_id=r.id, name=a, price=p, description=desc, image_url=f"{U}{img}?w=600&q=80",
                                 sort_order=k) for k, (a, p, desc, img) in enumerate(items)]
            db.add(mc)
        for floor, specs in LEGACY_PLANS[idx].items():
            hall = Hall(restaurant_id=r.id, name=f"{floor}-й этаж", width=1000, height=700, sort_order=floor,
                        decor=_decor(floor))
            db.add(hall)
            db.flush()
            for spec in specs:
                t = _table(r.id, hall.id, spec)
                t.number = f"{floor}{int(t.number):02d}" if len(LEGACY_PLANS[idx]) > 1 else t.number
                db.add(t)
        email = f"{d['slug']}@reserve.kz"
        if not db.scalar(select(User.id).where(User.email == email)):
            pw = secrets.token_urlsafe(9)
            db.add(User(name=f"Администратор {d['name']}", email=email, password_hash=hash_password(pw),
                        role=Role.restaurant_admin, restaurant_id=r.id))
            created_admins.append((email, pw))
        print(f"created {d['slug']}")
    db.commit()
    if created_admins:
        # Demo passwords go to a git-ignored file, not to the console/logs.
        with open(CREDENTIALS_FILE, "a") as f:
            for email, pw in created_admins:
                f.write(f"restaurant_admin {email} {pw}\n")
        print(f"Demo restaurant admin logins written to {CREDENTIALS_FILE}")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--superadmin", action="store_true")
    p.add_argument("--demo", action="store_true")
    args = p.parse_args()
    if not (args.superadmin or args.demo):
        p.print_help()
        return
    with SessionLocal() as db:
        if args.superadmin:
            seed_superadmin(db)
        if args.demo:
            seed_demo(db)


if __name__ == "__main__":
    main()
