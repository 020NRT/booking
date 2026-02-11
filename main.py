from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, EmailStr, validator
from typing import List, Optional, Dict
import hashlib
import random
import string
import re
from datetime import datetime
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import os

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static"), name="static")

EMAIL_SENDER = os.getenv("EMAIL_SENDER", "t.nurtore09@gmail.com")
EMAIL_PASSWORD = os.getenv("EMAIL_PASSWORD", "hmpi ddxd jset bofc")


class UserCreate(BaseModel):
    name: str
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    password: str

    @validator('phone')
    def validate_phone(cls, v):
        if v is None:
            return None
        phone = re.sub(r'[\s\-\(\)]', '', v)
        if not re.match(r'^\+7\d{10}$', phone):
            raise ValueError('Телефон должен быть в формате +7 XXX XXX XX XX')
        return phone

    @validator('email')
    def validate_email_or_phone(cls, v, values):
        if not v and not values.get('phone'):
            raise ValueError('Необходимо указать email или телефон')
        return v

    @validator('password')
    def validate_password(cls, v):
        if len(v) < 8:
            raise ValueError('Пароль должен содержать минимум 8 символов')
        if ' ' in v:
            raise ValueError('Пароль не должен содержать пробелы')
        if not re.search(r'[a-zA-Z]', v):
            raise ValueError('Пароль должен содержать хотя бы одну букву')
        if not re.search(r'[0-9]', v):
            raise ValueError('Пароль должен содержать хотя бы одну цифру')
        return v


class UserLogin(BaseModel):
    identifier: str
    password: str


class User(BaseModel):
    id: int
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    favorites: List[int] = []


class MenuItem(BaseModel):
    id: int
    name: str
    category: str
    price: int
    description: str
    image_url: str


class Branch(BaseModel):
    id: int
    address: str
    district: str


class Restaurant(BaseModel):
    id: int
    name: str
    description: str
    branches: List[Branch]
    cuisine: List[str]
    schedule: str
    capacity: int
    image_url: str
    floors: int = 1
    menu: List[MenuItem] = []
    has_vip_cabins: bool = False


class Booking(BaseModel):
    id: int
    user_id: int
    restaurant_id: int
    branch_id: int
    date: str
    time: str
    guests: int
    comment: str
    floor: int
    tables: List[str]
    is_vip: bool = False
    discount: float = 0.0
    total_price: int = 0
    menu_items: List[int] = []
    menu_quantities: Dict[str, int] = {}


class BookingCreate(BaseModel):
    user_id: int
    restaurant_id: int
    branch_id: int
    date: str
    time: str
    guests: int
    comment: str
    floor: int
    tables: List[str]
    is_vip: bool = False
    menu_items: List[int] = []
    menu_quantities: Dict[str, int] = {}


class FavoriteToggle(BaseModel):
    user_id: int
    restaurant_id: int


users_db: dict = {}
users: List[User] = []
verification_codes: dict = {}

menu_zevra = [
    MenuItem(id=1, name="Капучино", category="Напитки", price=1200,
             description="Классический итальянский кофе с молочной пеной",
             image_url="https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=400"),
    MenuItem(id=2, name="Латте", category="Напитки", price=1300, description="Нежный кофе с молоком",
             image_url="https://images.unsplash.com/photo-1561882468-9110e03e0f78?w=400"),
    MenuItem(id=3, name="Американо", category="Напитки", price=900, description="Крепкий эспрессо с водой",
             image_url="https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=400"),
    MenuItem(id=4, name="Круассан с шоколадом", category="Выпечка", price=1500,
             description="Свежий французский круассан",
             image_url="https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=400"),
    MenuItem(id=5, name="Чизкейк Нью-Йорк", category="Десерты", price=2500,
             description="Классический американский чизкейк",
             image_url="https://images.unsplash.com/photo-1533134242820-b6f7a4ff6adb?w=400"),
    MenuItem(id=6, name="Панини с ветчиной", category="Закуски", price=2800,
             description="Горячий сэндвич с сыром и ветчиной",
             image_url="https://images.unsplash.com/photo-1509722747041-616f39b57569?w=400"),
]

menu_coffeebum = [
    MenuItem(id=7, name="Стейк Рибай", category="Основные блюда", price=8900,
             description="Мраморная говядина 300г с овощами гриль",
             image_url="https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=400"),
    MenuItem(id=8, name="Паста Карбонара", category="Основные блюда", price=3500,
             description="Классическая итальянская паста с беконом",
             image_url="https://images.unsplash.com/photo-1612874742237-6526221588e3?w=400"),
    MenuItem(id=9, name="Салат Цезарь", category="Салаты", price=2900, description="С курицей, пармезаном и соусом",
             image_url="https://images.unsplash.com/photo-1546793665-c74683f339c1?w=400"),
    MenuItem(id=10, name="Ризотто с грибами", category="Основные блюда", price=4200,
             description="Кремовое ризотто с белыми грибами",
             image_url="https://images.unsplash.com/photo-1476124369491-c4e285d8e1c2?w=400"),
    MenuItem(id=11, name="Тирамису", category="Десерты", price=2200, description="Итальянский десерт с маскарпоне",
             image_url="https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?w=400"),
    MenuItem(id=12, name="Брускетта", category="Закуски", price=1800,
             description="Хрустящий хлеб с томатами и базиликом",
             image_url="https://images.unsplash.com/photo-1572695157366-5e585ab2b69f?w=400"),
]

menu_okadzaka = [
    MenuItem(id=13, name="Филадельфия", category="Роллы", price=3200, description="Лосось, сыр филадельфия, огурец",
             image_url="https://images.unsplash.com/photo-1579584425555-c3ce17fd4351?w=400"),
    MenuItem(id=14, name="Калифорния", category="Роллы", price=2800, description="Краб, авокадо, огурец, икра тобико",
             image_url="https://images.unsplash.com/photo-1617196034796-73dfa7b1fd56?w=400"),
    MenuItem(id=15, name="Сашими сет", category="Сашими", price=6500, description="Ассорти из свежей рыбы",
             image_url="https://images.unsplash.com/photo-1580822184713-fc5400e7fe10?w=400"),
    MenuItem(id=16, name="Рамен", category="Супы", price=3800, description="Японский суп с лапшой и свининой",
             image_url="https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=400"),
    MenuItem(id=17, name="Темпура", category="Закуски", price=3200, description="Креветки и овощи в кляре",
             image_url="https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?w=400"),
    MenuItem(id=18, name="Мочи", category="Десерты", price=1500, description="Японские рисовые пирожные",
             image_url="https://images.unsplash.com/photo-1563805042-7684c019e1cb?w=400"),
]

restaurants: List[Restaurant] = [
    Restaurant(
        id=1,
        name="Zevra Coffee",
        description="Уютная кофейня с панорамными окнами и авторским кофе.",
        branches=[
            Branch(id=1, address="Мангілік Ел, 35", district="Expo"),
            Branch(id=2, address="Сығанақ, 77", district="Expo"),
        ],
        cuisine=["Кафе", "Европейская"],
        schedule="09:00-23:00",
        capacity=40,
        image_url="https://images.unsplash.com/photo-1445116572660-236099ec97a0?w=800&h=600&fit=crop",
        floors=2,
        menu=menu_zevra,
        has_vip_cabins=False
    ),
    Restaurant(
        id=2,
        name="Coffee Bum",
        description="Современный ресторан с европейской кухней и изысканным интерьером.",
        branches=[
            Branch(id=1, address="Кабанбай батыр, 10", district="Keruen"),
            Branch(id=2, address="Ақмешіт, 38", district="Keruen"),
        ],
        cuisine=["Европейская", "Итальянская"],
        schedule="10:00-22:00",
        capacity=50,
        image_url="https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800&h=600&fit=crop",
        floors=2,
        menu=menu_coffeebum,
        has_vip_cabins=True
    ),
    Restaurant(
        id=3,
        name="Okadzaka",
        description="Аутентичная японская кухня от шеф-повара из Токио.",
        branches=[
            Branch(id=1, address="Мангілік Ел, 55", district="Expo"),
            Branch(id=2, address="Керуен молл, 1 этаж", district="Keruen"),
            Branch(id=3, address="Думан, 12", district="Keruen City"),
        ],
        cuisine=["Японская", "Азиатская"],
        schedule="11:00-23:00",
        capacity=35,
        image_url="https://images.unsplash.com/photo-1579584425555-c3ce17fd4351?w=800&h=600&fit=crop",
        floors=1,
        menu=menu_okadzaka,
        has_vip_cabins=True
    ),
]

bookings: List[Booking] = []
next_user_id = 1
next_booking_id = 1


def format_phone(phone: str) -> str:
    phone = re.sub(r'[\s\-\(\)]', '', phone)
    if not phone.startswith('+'):
        phone = '+' + phone
    if phone.startswith('+8'):
        phone = '+7' + phone[2:]
    return phone


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


def generate_code() -> str:
    return ''.join(random.choices(string.digits, k=6))


def send_email(to_email: str, subject: str, body: str):
    try:
        msg = MIMEMultipart('alternative')
        msg['Subject'] = subject
        msg['From'] = EMAIL_SENDER
        msg['To'] = to_email

        html_body = body.replace('\n', '<br>')
        part_plain = MIMEText(body, 'plain', 'utf-8')
        part_html = MIMEText(
            f"<html><body style='font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px'>{html_body}</body></html>",
            'html', 'utf-8')

        msg.attach(part_plain)
        msg.attach(part_html)

        with smtplib.SMTP_SSL('smtp.gmail.com', 465) as server:
            server.login(EMAIL_SENDER, EMAIL_PASSWORD)
            server.sendmail(EMAIL_SENDER, to_email, msg.as_string())

        print(f"✅ Email sent to {to_email}")
        return True
    except Exception as e:
        print(f"❌ Email error: {e}")
        print(f"\n{'=' * 50}")
        print(f"📧 EMAIL TO: {to_email}")
        print(f"SUBJECT: {subject}")
        print(f"BODY:\n{body}")
        print(f"{'=' * 50}\n")
        return False


@app.get("/")
def get_home():
    return FileResponse("static/index.html")


@app.post("/register")
def register_user(user: UserCreate):
    formatted_phone = format_phone(user.phone) if user.phone else None

    if user.email and user.email in users_db:
        raise HTTPException(status_code=400, detail="Email уже зарегистрирован")

    if formatted_phone and formatted_phone in users_db:
        raise HTTPException(status_code=400, detail="Телефон уже зарегистрирован")

    password_hash = hash_password(user.password)

    global next_user_id
    new_user = User(
        id=next_user_id,
        name=user.name,
        phone=formatted_phone,
        email=user.email,
        favorites=[]
    )

    user_data = {
        "password_hash": password_hash,
        "user": new_user
    }

    if user.email:
        users_db[user.email] = user_data
    if formatted_phone:
        users_db[formatted_phone] = user_data

    users.append(new_user)
    next_user_id += 1

    if user.email:
        code = generate_code()
        verification_codes[user.email] = code
        send_email(
            user.email,
            "Добро пожаловать в Reserve!",
            f"Здравствуйте, {user.name}!\n\nВаш код подтверждения: {code}\n\nВаш логин: {user.email or formatted_phone}\n\nСпасибо за регистрацию в Reserve!"
        )

    return new_user


@app.post("/login")
def login_user(credentials: UserLogin):
    identifier = credentials.identifier.strip()
    if identifier.startswith('+') or identifier.startswith('7') or identifier.startswith('8'):
        identifier = format_phone(identifier)

    user_data = users_db.get(identifier)

    if not user_data:
        raise HTTPException(status_code=401, detail="Пользователь не найден")

    if user_data["password_hash"] != hash_password(credentials.password):
        raise HTTPException(status_code=401, detail="Неверный пароль")

    return user_data["user"]


@app.get("/restaurants", response_model=List[Restaurant])
def get_restaurants():
    return restaurants


@app.get("/restaurants/{restaurant_id}", response_model=Restaurant)
def get_restaurant(restaurant_id: int):
    for r in restaurants:
        if r.id == restaurant_id:
            return r
    raise HTTPException(status_code=404, detail="Ресторан не найден")


@app.post("/favorites/toggle")
def toggle_favorite(data: FavoriteToggle):
    user = next((u for u in users if u.id == data.user_id), None)
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    if data.restaurant_id in user.favorites:
        user.favorites.remove(data.restaurant_id)
        added = False
    else:
        user.favorites.append(data.restaurant_id)
        added = True

    for key, val in users_db.items():
        if val["user"].id == data.user_id:
            val["user"].favorites = user.favorites

    return {"added": added, "favorites": user.favorites}


@app.get("/favorites/{user_id}")
def get_favorites(user_id: int):
    user = next((u for u in users if u.id == user_id), None)
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    return {"favorites": user.favorites}


@app.post("/bookings", response_model=Booking)
def create_booking(b: BookingCreate):
    global bookings, next_booking_id

    total_price = 0
    restaurant = next((r for r in restaurants if r.id == b.restaurant_id), None)
    branch = None
    if restaurant:
        branch = next((br for br in restaurant.branches if br.id == b.branch_id), None)
        if b.menu_items:
            for item_id in b.menu_items:
                menu_item = next((m for m in restaurant.menu if m.id == item_id), None)
                if menu_item:
                    qty = b.menu_quantities.get(str(item_id), 1)
                    total_price += menu_item.price * qty

    booking = Booking(
        id=next_booking_id,
        user_id=b.user_id,
        restaurant_id=b.restaurant_id,
        branch_id=b.branch_id,
        date=b.date,
        time=b.time,
        guests=b.guests,
        comment=b.comment,
        floor=b.floor,
        tables=b.tables,
        is_vip=b.is_vip,
        discount=0,
        total_price=total_price,
        menu_items=b.menu_items,
        menu_quantities=b.menu_quantities
    )

    bookings.append(booking)
    next_booking_id += 1

    user = next((u for u in users if u.id == b.user_id), None)
    if user and user.email:
        tables_str = ', '.join([f"№{t.split('-')[1]}" for t in b.tables])
        branch_address = branch.address if branch else 'N/A'
        branch_district = branch.district if branch else ''

        menu_lines = ""
        if b.menu_items and restaurant:
            menu_lines = "\n\nПредзаказ:\n"
            for item_id in b.menu_items:
                menu_item = next((m for m in restaurant.menu if m.id == item_id), None)
                if menu_item:
                    qty = b.menu_quantities.get(str(item_id), 1)
                    menu_lines += f"  • {menu_item.name} x{qty} — {menu_item.price * qty:,} ₸\n"

        email_body = f"""Здравствуйте, {user.name}!

Ваше бронирование подтверждено ✓

Ресторан: {restaurant.name if restaurant else 'N/A'}
Адрес: {branch_address} ({branch_district})
Дата: {b.date}
Время: {b.time}
Этаж: {b.floor}-й
Столики: {tables_str}
Количество гостей: {b.guests}
{'⭐ VIP столик' if b.is_vip else ''}
{menu_lines}
{'💰 Итого: ' + f'{total_price:,} ₸' if total_price > 0 else ''}

Ждём вас!
С уважением,
Reserve"""

        send_email(user.email, "Reservation Confirmation", email_body)

    return booking


@app.get("/bookings", response_model=List[Booking])
def list_bookings():
    return bookings


@app.delete("/bookings/{booking_id}")
def delete_booking(booking_id: int, user_id: int):
    global bookings

    booking_index = None
    booking = None
    for i, b in enumerate(bookings):
        if b.id == booking_id:
            booking_index = i
            booking = b
            break

    if booking is None:
        raise HTTPException(status_code=404, detail="Бронирование не найдено")

    if booking.user_id != user_id:
        raise HTTPException(status_code=403, detail="Это бронирование принадлежит другому пользователю")

    booking_datetime_str = f"{booking.date} {booking.time}"
    try:
        booking_datetime = datetime.strptime(booking_datetime_str, "%Y-%m-%d %H:%M")
        current_datetime = datetime.now()

        if booking_datetime <= current_datetime:
            raise HTTPException(
                status_code=400,
                detail="Невозможно удалить прошедшее бронирование"
            )
    except ValueError:
        pass

    deleted_booking = bookings.pop(booking_index)

    user = next((u for u in users if u.id == user_id), None)
    if user and user.email:
        restaurant = next((r for r in restaurants if r.id == deleted_booking.restaurant_id), None)
        branch = None
        if restaurant:
            branch = next((br for br in restaurant.branches if br.id == deleted_booking.branch_id), None)

        tables_str = ', '.join([f"№{t.split('-')[1]}" for t in deleted_booking.tables])
        branch_address = branch.address if branch else 'N/A'
        branch_district = branch.district if branch else ''

        email_body = f"""Здравствуйте, {user.name}!

Ваше бронирование отменено ✗

Детали отменённого бронирования:
Ресторан: {restaurant.name if restaurant else 'N/A'}
Адрес: {branch_address} ({branch_district})
Дата: {deleted_booking.date}
Время: {deleted_booking.time}
Этаж: {deleted_booking.floor}-й
Столики: {tables_str}
Количество гостей: {deleted_booking.guests}
{'⭐ VIP столик' if deleted_booking.is_vip else ''}

Бронирование успешно удалено из вашей истории.

С уважением,
Reserve"""

        send_email(user.email, "Reservation Cancelled", email_body)

    return {
        "message": "Бронирование успешно удалено",
        "deleted_booking": deleted_booking
    }


@app.get("/bookings/user/{user_id}")
def get_user_bookings(user_id: int):
    user_bookings = [b for b in bookings if b.user_id == user_id]

    enhanced_bookings = []
    for booking in user_bookings:
        restaurant = next((r for r in restaurants if r.id == booking.restaurant_id), None)
        branch = None
        if restaurant:
            branch = next((br for br in restaurant.branches if br.id == booking.branch_id), None)

        can_delete = True
        booking_datetime_str = f"{booking.date} {booking.time}"
        try:
            booking_datetime = datetime.strptime(booking_datetime_str, "%Y-%m-%d %H:%M")
            current_datetime = datetime.now()
            can_delete = booking_datetime > current_datetime
        except ValueError:
            pass

        enhanced_booking = booking.dict()
        enhanced_booking.update({
            "restaurant_name": restaurant.name if restaurant else "Unknown",
            "branch_address": branch.address if branch else "Unknown",
            "branch_district": branch.district if branch else "Unknown",
            "can_delete": can_delete
        })
        enhanced_bookings.append(enhanced_booking)

    enhanced_bookings.sort(
        key=lambda x: datetime.strptime(f"{x['date']} {x['time']}", "%Y-%m-%d %H:%M")
        if 'date' in x and 'time' in x else datetime.min,
        reverse=True
    )

    return enhanced_bookings


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
