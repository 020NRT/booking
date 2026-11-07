# Reserve API

API для бронирования столиков в ресторанах и кофейнях с поддержкой регистрации, логина, избранного и email-уведомлений.

## Функции
- Регистрация и вход пользователя  
- Список ресторанов и филиалов  
- Меню с категориями и изображениями  
- Бронирование столиков, включая VIP и предзаказ блюд  
- Управление избранным (`favorites`)  
- Email-уведомления о подтверждении или отмене бронирования  
- Валидация данных (email, телефон, пароль)  

## Установка
1. Перейти в папку проекта:
```bash
cd "Final project/backend"
Создать виртуальное окружение:

python3 -m venv venv
source venv/bin/activate  # Mac/Linux
venv\Scripts\activate     # Windows
Установить зависимости:

pip install -r requirements.txt
Настройка переменных окружения
Создайте .env файл или экспортируйте переменные:

export EMAIL_SENDER="your_email@gmail.com"
export EMAIL_PASSWORD="your_app_password"
Используется для отправки уведомлений о бронировании. Gmail требует создание App Password для SMTP.

Запуск
uvicorn main:app --reload --host 0.0.0.0 --port 8000
Сайт будет доступен по адресу:

http://127.0.0.1:8000
Статическая страница:

http://127.0.0.1:8000/static/index.html
Структура проекта
Final project/
└─ backend/
   ├─ main.py           # Основной код API
   ├─ requirements.txt  # Список зависимостей
   └─ static/
       └─ index.html    # Статическая страница
Эндпоинты
Пользователи
POST /register — регистрация пользователя

POST /login — вход пользователя

Рестораны
GET /restaurants — список ресторанов

GET /restaurants/{restaurant_id} — информация о конкретном ресторане

Избранное
POST /favorites/toggle — добавить/удалить ресторан из избранного

GET /favorites/{user_id} — получить избранное пользователя

Бронирования
POST /bookings — создать бронирование

GET /bookings — список всех бронирований

GET /bookings/user/{user_id} — бронирования конкретного пользователя

DELETE /bookings/{booking_id}?user_id={user_id} — удалить бронирование

Примечания
Пароли хранятся в виде SHA256 хэша

Телефоны должны быть в формате +7XXXXXXXXXX

Email или телефон обязателен при регистрации

Предзаказ блюд учитывается в total_price бронирования

Email-уведомления отправляются через SMTP Gmail
