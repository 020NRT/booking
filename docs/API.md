# Reserve API

Базовый путь: `/api`. Формат: JSON. Авторизация: заголовок `Authorization: Bearer <token>` (токен из `/api/auth/login` или `/api/auth/register`).

Интерактивная документация со схемами запросов и ответов: **`/api/docs`** (Swagger) и `/api/redoc`. Этот файл сгенерирован из OpenAPI-схемы.

Ошибки: `{"detail": "текст"}` или `{"detail": {"code": "...", "message": "текст для пользователя"}}`. Основные коды: 401 — нужен вход, 403 — нет прав, 404, 409 — конфликт (например `table_taken` — столик заняли), 422 — ошибка валидации, 429 — слишком много попыток.


## auth

Доступ: —

| Метод | Путь | Описание |
|---|---|---|
| POST | `/api/auth/register` | Register |
| POST | `/api/auth/login` | Login |
| GET | `/api/auth/me` | Me |
| PATCH | `/api/auth/me` | Update Me |
| POST | `/api/auth/me/password` | Change Password |

## catalog

Доступ: публичный (избранное — Customer)

| Метод | Путь | Описание |
|---|---|---|
| GET | `/api/restaurants` | List Restaurants |
| GET | `/api/categories` | Categories |
| GET | `/api/restaurants/{key}` | Get Restaurant |
| GET | `/api/restaurants/{key}/menu` | Get Menu |
| GET | `/api/restaurants/{key}/reviews` | Get Reviews |
| POST | `/api/restaurants/{key}/reviews` | Post Review |
| GET | `/api/restaurants/{key}/slots` | Get Slots |
| GET | `/api/restaurants/{key}/availability` | Get Availability |
| GET | `/api/me/favorites` | My Favorites |
| PUT | `/api/me/favorites/{restaurant_id}` | Add Favorite |
| DELETE | `/api/me/favorites/{restaurant_id}` | Remove Favorite |

## bookings

Доступ: авторизованный пользователь; webhook — провайдер (подпись)

| Метод | Путь | Описание |
|---|---|---|
| POST | `/api/bookings` | Create Booking |
| GET | `/api/me/bookings` | My Bookings |
| GET | `/api/bookings/{booking_id}` | Get Booking |
| POST | `/api/bookings/{booking_id}/cancel` | Cancel Booking |
| POST | `/api/bookings/{booking_id}/pay` | Pay Booking |
| GET | `/api/payments/{payment_id}` | Get Payment |
| POST | `/api/payments/webhook/{provider}` | Payment Webhook — Server-to-server notification from the payment provider (the only way a booking gets paid). |
| POST | `/api/payments/mock/{payment_id}/simulate` | Simulate Mock Payment — Test checkout for the `mock` provider: builds a signed notification exactly |

## check-in

Доступ: сотрудник ресторана / Super Admin

| Метод | Путь | Описание |
|---|---|---|
| GET | `/api/checkin/{token}` | Check |
| POST | `/api/checkin/{token}` | Check In |

## restaurant admin

Доступ: Restaurant Admin своего ресторана или Super Admin

| Метод | Путь | Описание |
|---|---|---|
| GET | `/api/partner/restaurants` | My Restaurants |
| GET | `/api/partner/restaurants/{restaurant_id}` | Get Profile |
| PATCH | `/api/partner/restaurants/{restaurant_id}` | Update Profile |
| PUT | `/api/partner/restaurants/{restaurant_id}/hours` | Set Hours |
| GET | `/api/partner/restaurants/{restaurant_id}/stats` | Stats |
| GET | `/api/partner/restaurants/{restaurant_id}/bookings` | List Bookings |
| PATCH | `/api/partner/restaurants/{restaurant_id}/bookings/{booking_id}/status` | Set Booking Status |
| GET | `/api/partner/restaurants/{restaurant_id}/halls` | List Halls |
| POST | `/api/partner/restaurants/{restaurant_id}/halls` | Create Hall |
| DELETE | `/api/partner/restaurants/{restaurant_id}/halls/{hall_id}` | Delete Hall |
| PUT | `/api/partner/restaurants/{restaurant_id}/halls/{hall_id}/layout` | Save Layout — Save the whole hall in one transaction. |
| GET | `/api/partner/restaurants/{restaurant_id}/menu` | Get Menu |
| POST | `/api/partner/restaurants/{restaurant_id}/menu/categories` | Create Category |
| PATCH | `/api/partner/restaurants/{restaurant_id}/menu/categories/{cid}` | Update Category |
| DELETE | `/api/partner/restaurants/{restaurant_id}/menu/categories/{cid}` | Delete Category |
| POST | `/api/partner/restaurants/{restaurant_id}/menu/items` | Create Item |
| PATCH | `/api/partner/restaurants/{restaurant_id}/menu/items/{iid}` | Update Item |
| DELETE | `/api/partner/restaurants/{restaurant_id}/menu/items/{iid}` | Delete Item |
| POST | `/api/partner/restaurants/{restaurant_id}/uploads` | Upload |
| GET | `/api/partner/restaurants/{restaurant_id}/photos` | List Photos |
| POST | `/api/partner/restaurants/{restaurant_id}/photos` | Add Photo |
| DELETE | `/api/partner/restaurants/{restaurant_id}/photos/{pid}` | Delete Photo |
| PUT | `/api/partner/restaurants/{restaurant_id}/photos/order` | Reorder Photos |

## super admin

Доступ: Super Admin

| Метод | Путь | Описание |
|---|---|---|
| GET | `/api/admin/stats` | Platform Stats |
| GET | `/api/admin/finance` | Finance |
| GET | `/api/admin/restaurants` | List Restaurants |
| POST | `/api/admin/restaurants` | Create Restaurant |
| GET | `/api/admin/restaurants/{rid}` | Get Restaurant |
| PATCH | `/api/admin/restaurants/{rid}` | Update Restaurant |
| DELETE | `/api/admin/restaurants/{rid}` | Delete Restaurant — Hard delete only when there are no bookings; otherwise deactivate. |
| GET | `/api/admin/users` | List Users |
| POST | `/api/admin/users` | Create User |
| GET | `/api/admin/users/{uid}` | Get User |
| PATCH | `/api/admin/users/{uid}` | Update User |
| GET | `/api/admin/bookings` | All Bookings |

## system

Доступ: —

| Метод | Путь | Описание |
|---|---|---|
| GET | `/api/health` | Health |
