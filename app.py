from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from typing import List
import qrcode
import io
import base64

app = FastAPI()

# --- CORS ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Модели ---
class User(BaseModel):
    id: int
    name: str
    phone: str
    favorites: List[int] = []

class Restaurant(BaseModel):
    id: int
    name: str
    description: str
    address: str
    schedule: str
    capacity: int
    image_url: str

class Booking(BaseModel):
    id: int
    user_id: int
    restaurant_id: int
    date: str
    time: str
    guests: int
    comment: str
    qr_code: str = None  # base64

class BookingCreate(BaseModel):
    user_id: int
    restaurant_id: int
    date: str
    time: str
    guests: int
    comment: str

class UserCreate(BaseModel):
    name: str
    phone: str

# --- "Базы данных" ---
users: List[User] = []
restaurants: List[Restaurant] = [
    Restaurant(id=1, name="Кофейня Aroma", description="Уютная кофейня в центре города.", address="ул. Абая, 10", schedule="09:00-23:00", capacity=30, image_url="https://via.placeholder.com/400x250"),
    Restaurant(id=2, name="Restaurant Luna", description="Современный ресторан с европейской кухней.", address="ул. Достык, 5", schedule="10:00-22:00", capacity=50, image_url="https://via.placeholder.com/400x250"),
]
bookings: List[Booking] = []

next_user_id = 1
next_booking_id = 1

# --- HTML ---
html_content = """
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Онлайн-бронирование</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root {
    --bg:#f5f7fa; --card:#ffffff; --primary:#1f2937; --accent:#3b82f6; --accent-dark:#2563eb;
    --muted:#6b7280; --success:#16a34a; --shadow:rgba(0,0,0,0.08);
}
*{box-sizing:border-box;font-family:'Inter',sans-serif;margin:0;padding:0;}
body{background:var(--bg);color:var(--primary);}
header{background:var(--card);box-shadow:0 4px 20px var(--shadow);padding:20px;position:fixed;width:100%;top:0;z-index:10;display:flex;flex-direction:column;align-items:center;}
header h1{font-size:26px;font-weight:600;color:var(--primary);}
nav{display:flex;justify-content:center;gap:12px;margin-top:12px;flex-wrap:wrap;}
nav button{padding:10px 18px;border-radius:14px;border:none;background:#e5e7eb;cursor:pointer;transition:.3s;font-weight:500;}
nav button.active,nav button:hover{background:var(--accent);color:#fff;}
.container{max-width:1100px;margin:160px auto 24px;padding:0 16px;}
.section{display:none;animation:fadeIn .3s ease;}
.section.active{display:block;}
.card{background:var(--card);border-radius:20px;padding:24px;box-shadow:0 10px 30px var(--shadow);margin-bottom:24px;transition:transform .3s ease,box-shadow .3s ease;}
.card:hover{transform:translateY(-5px);box-shadow:0 14px 36px var(--shadow);}
.card img{width:100%;border-radius:16px;object-fit:cover;margin-bottom:16px;}
.card h2,.card h3{margin:8px 0;}
.meta{font-size:14px;color:var(--muted);margin-bottom:12px;}
input,select,textarea{width:100%;margin:6px 0 16px;padding:14px;border-radius:14px;border:1px solid #e5e7eb;font-size:15px;background:#fff;transition:.2s;}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(59,130,246,0.2);}
button.submit{padding:14px 20px;border-radius:14px;border:none;font-size:16px;font-weight:600;cursor:pointer;background:var(--accent);color:#fff;transition:.3s;width:100%;}
button.submit:hover{background:var(--accent-dark);}
button.secondary{background:#e5e7eb;color:var(--primary);margin-top:8px;width:100%;}
.filters{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:20px;}
.filters select,.filters input{flex:1;min-width:140px;}
.confirmation{text-align:center;padding:40px 20px;}
.confirmation h2{font-size:26px;color:var(--success);margin-bottom:16px;}
.confirmation .details{background:#f3f4f6;padding:18px;border-radius:14px;margin:16px 0;text-align:left;box-shadow:0 6px 18px var(--shadow);}
.confirmation .details p{margin:8px 0;}
.confirmation img{margin-top:16px;border-radius:12px;max-width:200px;}
.restaurant-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:24px;}
.heart{float:right;font-size:22px;cursor:pointer;color:var(--muted);}
.heart.active{color:red;}
@keyframes fadeIn{from{opacity:0;}to{opacity:1;}}
@media(max-width:700px){header h1{font-size:22px;}.card{padding:20px;}.filters{flex-direction:column;}}
</style>
</head>
<body>

<header>
<h1>🍽 Онлайн-бронирование</h1>
<nav id="tabs" style="display:none;">
<button onclick="showTab('home')" class="active">Главная</button>
<button onclick="showTab('history')">История</button>
<button onclick="showTab('favorites')">Избранное</button>
<button onclick="showTab('profile')">Профиль</button>
</nav>
</header>

<div class="container">

<div id="welcome" class="section active">
    <div class="card">
        <h2>Добро пожаловать!</h2>
        <p>Бронируйте столики в ресторанах и кафе онлайн.</p>
        <button class="submit" onclick="show('register')">Начать</button>
    </div>
</div>

<div id="register" class="section">
    <div class="card">
        <h2>Регистрация</h2>
        <input id="name" placeholder="Ваше имя">
        <input id="phone" placeholder="Телефон">
        <button class="submit" onclick="register()">Зарегистрироваться</button>
    </div>
</div>

<div id="home" class="section">
    <div class="filters">
        <input id="search" placeholder="Поиск ресторана">
        <select id="filter-district">
            <option>Все районы</option>
            <option>Центр</option>
            <option>Медеу</option>
        </select>
        <select id="filter-cuisine">
            <option>Все кухни</option>
            <option>Кафе</option>
            <option>Европейская</option>
        </select>
        <select id="filter-open">
            <option>Все</option>
            <option>Открыто сейчас</option>
        </select>
    </div>
    <div class="restaurant-list" id="restaurant-list"></div>
</div>

<div id="booking" class="section">
    <div class="card">
        <h2>Бронирование</h2>
        <label>Дата</label>
        <input type="date" id="booking-date">
        <label>Время</label>
        <select id="booking-time"></select>
        <label>Количество гостей</label>
        <select id="booking-guests">
            <option>1</option><option>2</option><option>3</option><option>4</option><option>5+</option>
        </select>
        <label>Комментарий</label>
        <textarea id="booking-comment" placeholder="Например: у окна"></textarea>
        <button class="submit" onclick="confirmBooking()">Подтвердить</button>
        <button class="secondary" onclick="show('home')">Назад</button>
    </div>
</div>

<div id="confirmation" class="section">
    <div class="card confirmation">
        <h2>✅ Бронь принята!</h2>
        <div class="details">
            <p><strong>Ресторан:</strong> <span id="conf-rest"></span></p>
            <p><strong>Дата:</strong> <span id="conf-date"></span></p>
            <p><strong>Время:</strong> <span id="conf-time"></span></p>
            <p><strong>Гостей:</strong> <span id="conf-guests"></span></p>
            <p><strong>Комментарий:</strong> <span id="conf-comment"></span></p>
        </div>
        <img id="conf-qr" src="">
        <button class="submit" onclick="show('home')">На главную</button>
    </div>
</div>

<div id="history" class="section">
    <div class="card">
        <h2>История бронирований</h2>
        <div id="history-list"></div>
    </div>
</div>

<div id="favorites" class="section">
    <div class="card">
        <h2>Избранное</h2>
        <div id="favorites-list"></div>
    </div>
</div>

<div id="profile" class="section">
    <div class="card">
        <h2>Профиль</h2>
        <p id="profile-info"></p>
    </div>
</div>
</div>

<script>
let currentUser = null;
let currentRestaurant = null;

function showTab(tab){
    document.querySelectorAll('#tabs button').forEach(b=>b.classList.remove('active'));
    document.querySelector(`#tabs button[onclick="showTab('${tab}')"]`).classList.add('active');
    show(tab);
}

function show(id){
    document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    if(id==='history') loadHistory();
    if(id==='favorites') loadFavorites();
    if(id==='profile') loadProfile();
}

function register(){
    const name = document.getElementById('name').value;
    const phone = document.getElementById('phone').value;
    if(!name||!phone){ alert("Заполните все поля"); return; }
    fetch("/users",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({name, phone})
    }).then(res=>res.json()).then(data=>{
        currentUser = data;
        document.getElementById('tabs').style.display = "flex";
        loadRestaurants();
        show('home');
    });
}

async function loadRestaurants(){
    const res = await fetch("/restaurants");
    const data = await res.json();
    const list = document.getElementById('restaurant-list');
    list.innerHTML = "";
    data.forEach(r=>{
        const card = document.createElement('div');
        card.className="card";
        const heartClass = currentUser && currentUser.favorites.includes(r.id) ? "heart active" : "heart";
        card.innerHTML=`
            <span class="${heartClass}" onclick="toggleFavorite(${r.id}, this)">&#10084;</span>
            <img src="${r.image_url}">
            <h3>${r.name}</h3>
            <p class="meta">${r.address}</p>
            <button onclick="openRestaurant(${r.id})">Открыть</button>
        `;
        list.appendChild(card);
    });
}

function toggleFavorite(id, el){
    if(currentUser.favorites.includes(id)){
        currentUser.favorites = currentUser.favorites.filter(f=>f!==id);
        el.classList.remove("active");
    } else {
        currentUser.favorites.push(id);
        el.classList.add("active");
    }
    loadFavorites();
}

function loadFavorites(){
    const list = document.getElementById('favorites-list');
    list.innerHTML="";
    fetch("/restaurants").then(res=>res.json()).then(data=>{
        data.filter(r=>currentUser.favorites.includes(r.id)).forEach(r=>{
            const card=document.createElement('div');
            card.className="card";
            card.innerHTML=`<img src="${r.image_url}"><h3>${r.name}</h3><p>${r.address}</p>`;
            list.appendChild(card);
        });
    });
}

async function openRestaurant(id){
    const res = await fetch(`/restaurants/${id}`);
    const r = await res.json();
    currentRestaurant = r;
    document.getElementById('conf-rest').textContent = r.name;
    show('booking');
}

// --- Дата и время ---
const dateInput = document.getElementById('booking-date');
const today = new Date().toISOString().split('T')[0];
dateInput.min = today;

dateInput.addEventListener('input', () => {
    const value = dateInput.value;
    if (value.length >= 4) {
        const year = parseInt(value.split('-')[0]);
        if (year > 2026) {
            dateInput.value = '2026' + value.slice(4);
        }
    }
});

const timeSelect = document.getElementById('booking-time');
function populateTimes(){
    for(let h=9;h<=22;h++){ ["00","30"].forEach(min=>{
        if(h===22&&min==="30") return;
        const option=document.createElement("option");
        option.value=`${h.toString().padStart(2,'0')}:${min}`;
        option.textContent=`${h.toString().padStart(2,'0')}:${min}`;
        timeSelect.appendChild(option);
    }); }
}
populateTimes();

function confirmBooking(){
    const bookingData = {
        user_id: currentUser.id,
        restaurant_id: currentRestaurant.id,
        date: dateInput.value,
        time: timeSelect.value,
        guests: parseInt(document.getElementById('booking-guests').value),
        comment: document.getElementById('booking-comment').value || "-"
    };
    fetch("/bookings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(bookingData)})
    .then(res=>res.json())
    .then(data=>{
        document.getElementById('conf-date').textContent = data.date;
        document.getElementById('conf-time').textContent = data.time;
        document.getElementById('conf-guests').textContent = data.guests;
        document.getElementById('conf-comment').textContent = data.comment;
        document.getElementById('conf-qr').src = "data:image/png;base64," + data.qr_code;
        show('confirmation');
    });
}

function loadHistory(){
    fetch("/bookings").then(res=>res.json()).then(data=>{
        const list=document.getElementById('history-list');
        list.innerHTML="";
        data.filter(b=>b.user_id===currentUser.id).forEach(b=>{
            const item=document.createElement('p');
            const restaurant = restaurants.find(r=>r.id===b.restaurant_id);
            const name = restaurant ? restaurant.name : `ID ${b.restaurant_id}`;
            item.textContent=`${b.date} ${b.time} - ${name}, гостей: ${b.guests}`;
            list.appendChild(item);
        });
    });
}

function loadProfile(){
    document.getElementById('profile-info').textContent=`Имя: ${currentUser.name}, Телефон: ${currentUser.phone}`;
}

</script>
</body>
</html>
"""

# --- Endpoints ---
@app.get("/", response_class=HTMLResponse)
def get_home():
    return HTMLResponse(content=html_content, status_code=200)

@app.post("/users", response_model=User)
def create_user(u: UserCreate):
    global next_user_id
    user = User(id=next_user_id, name=u.name, phone=u.phone, favorites=[])
    users.append(user)
    next_user_id += 1
    return user

@app.get("/restaurants", response_model=List[Restaurant])
def get_restaurants():
    return restaurants

@app.get("/restaurants/{restaurant_id}", response_model=Restaurant)
def get_restaurant(restaurant_id: int):
    for r in restaurants:
        if r.id == restaurant_id:
            return r
    raise HTTPException(status_code=404, detail="Ресторан не найден")

@app.post("/bookings", response_model=Booking)
def create_booking(b: BookingCreate):
    global bookings, next_booking_id
    booking = Booking(id=next_booking_id, user_id=b.user_id, restaurant_id=b.restaurant_id,
                      date=b.date, time=b.time, guests=b.guests, comment=b.comment)

    # --- Генерация QR-кода ---
    qr = qrcode.QRCode(box_size=6, border=2)
    qr.add_data(f"Бронь #{next_booking_id} | Ресторан ID {b.restaurant_id} | {b.date} {b.time} | Гости: {b.guests}")
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)  # перемещаем указатель в начало буфера
    qr_base64 = base64.b64encode(buf.getvalue()).decode("utf-8")  # берём данные и кодируем
    booking.qr_code = qr_base64  # сохраняем в объект


