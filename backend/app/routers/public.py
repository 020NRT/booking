from datetime import date

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import exists, func, or_, select
from sqlalchemy.orm import selectinload

from ..deps import DB, CurrentUser, OptionalUser
from ..models import Booking, BookingStatus, Favorite, MenuCategory, Restaurant, RestaurantStatus, Review
from ..schemas import (
    AvailabilityOut,
    MenuCategoryOut,
    RestaurantCard,
    RestaurantDetail,
    ReviewIn,
    ReviewOut,
    SlotsOut,
)
from ..services import booking as svc

router = APIRouter(tags=["catalog"])


def _visible(db: DB, key: str, user=None) -> Restaurant:
    cond = Restaurant.id == int(key) if key.isdigit() else Restaurant.slug == key
    r = db.scalar(select(Restaurant).where(cond).options(selectinload(Restaurant.hours), selectinload(Restaurant.photos)))
    if r is None:
        raise HTTPException(404, "Ресторан не найден")
    if r.status != RestaurantStatus.active and not (user and svc.user_is_staff_for(user, r.id)):
        raise HTTPException(404, "Ресторан не найден")
    return r


@router.get("/restaurants", response_model=list[RestaurantCard])
def list_restaurants(
    db: DB,
    q: str | None = Query(None, max_length=80),
    cuisine: str | None = Query(None, max_length=40),
    district: str | None = Query(None, max_length=80),
    featured: bool | None = None,
    sort: str = Query("popular", pattern="^(popular|rating|name)$"),
):
    stmt = select(Restaurant).where(Restaurant.status == RestaurantStatus.active)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Restaurant.name.ilike(like), Restaurant.description.ilike(like), Restaurant.address.ilike(like)))
    if cuisine:
        stmt = stmt.where(Restaurant.cuisine.contains([cuisine]))
    if district:
        stmt = stmt.where(Restaurant.district == district)
    if featured is not None:
        stmt = stmt.where(Restaurant.is_featured.is_(featured))
    if sort == "rating":
        stmt = stmt.order_by(Restaurant.rating_avg.desc(), Restaurant.rating_count.desc())
    elif sort == "name":
        stmt = stmt.order_by(Restaurant.name)
    else:
        bookings = (
            select(func.count()).where(Booking.restaurant_id == Restaurant.id).correlate(Restaurant).scalar_subquery()
        )
        stmt = stmt.order_by(Restaurant.is_featured.desc(), bookings.desc(), Restaurant.rating_avg.desc())
    return db.scalars(stmt.limit(200)).all()


@router.get("/categories", response_model=dict)
def categories(db: DB):
    cuisines = db.scalars(
        select(func.jsonb_array_elements_text(Restaurant.cuisine)).where(Restaurant.status == RestaurantStatus.active)
    ).all()
    districts = db.scalars(
        select(Restaurant.district).where(Restaurant.status == RestaurantStatus.active, Restaurant.district != "")
    ).all()
    return {"cuisines": sorted(set(cuisines)), "districts": sorted(set(districts))}


@router.get("/restaurants/{key}", response_model=RestaurantDetail)
def get_restaurant(key: str, db: DB, user: OptionalUser):
    return _visible(db, key, user)


@router.get("/restaurants/{key}/menu", response_model=list[MenuCategoryOut])
def get_menu(key: str, db: DB, user: OptionalUser):
    r = _visible(db, key, user)
    cats = db.scalars(
        select(MenuCategory).where(MenuCategory.restaurant_id == r.id).order_by(MenuCategory.sort_order, MenuCategory.id)
        .options(selectinload(MenuCategory.items))
    ).all()
    out = []
    for c in cats:
        items = [i for i in c.items if not i.is_hidden]
        if items:
            out.append(MenuCategoryOut(id=c.id, name=c.name, sort_order=c.sort_order, items=items))
    return out


@router.get("/restaurants/{key}/reviews", response_model=list[ReviewOut])
def get_reviews(key: str, db: DB, user: OptionalUser):
    r = _visible(db, key, user)
    rows = db.scalars(
        select(Review).where(Review.restaurant_id == r.id).order_by(Review.created_at.desc()).limit(100)
        .options(selectinload(Review.user))
    ).all()
    return [ReviewOut(id=x.id, rating=x.rating, text=x.text, created_at=x.created_at,
                      author=(x.user.name.split()[0] if x.user else "Гость")) for x in rows]


@router.post("/restaurants/{key}/reviews", response_model=ReviewOut, status_code=201)
def post_review(key: str, data: ReviewIn, db: DB, user: CurrentUser):
    r = _visible(db, key, user)
    visited = db.scalar(select(exists().where(
        Booking.restaurant_id == r.id, Booking.user_id == user.id,
        Booking.status.in_([BookingStatus.checked_in, BookingStatus.completed]),
    )))
    if not visited:
        raise HTTPException(403, "Оставить отзыв можно после посещения ресторана по брони Reserve")
    review = db.scalar(select(Review).where(Review.restaurant_id == r.id, Review.user_id == user.id))
    if review is None:
        review = Review(restaurant_id=r.id, user_id=user.id)
        db.add(review)
    review.rating, review.text = data.rating, data.text
    db.flush()
    avg, cnt = db.execute(select(func.avg(Review.rating), func.count()).where(Review.restaurant_id == r.id)).one()
    r.rating_avg, r.rating_count = round(float(avg), 2), cnt
    db.commit()
    return ReviewOut(id=review.id, rating=review.rating, text=review.text, created_at=review.created_at,
                     author=user.name.split()[0])


@router.get("/restaurants/{key}/slots", response_model=SlotsOut)
def get_slots(key: str, db: DB, user: OptionalUser, date_: date = Query(alias="date")):
    r = _visible(db, key, user)
    starts = svc.slot_starts(r, date_)
    return SlotsOut(date=date_, is_closed=svc.day_window(r, date_) is None, slots=[s.strftime("%H:%M") for s in starts])


@router.get("/restaurants/{key}/availability", response_model=AvailabilityOut)
def get_availability(
    key: str, db: DB, user: OptionalUser,
    date_: date = Query(alias="date"),
    time: str = Query(pattern=r"^\d{2}:\d{2}$"),
    guests: int = Query(2, ge=1, le=50),
):
    r = _visible(db, key, user)
    try:
        return svc.availability(db, r, date_, time, guests)
    except svc.BookingError as e:
        raise HTTPException(e.status_code, e.message)


# ---------- favorites ----------


@router.get("/me/favorites", response_model=list[RestaurantCard])
def my_favorites(db: DB, user: CurrentUser):
    return db.scalars(
        select(Restaurant).join(Favorite, Favorite.restaurant_id == Restaurant.id)
        .where(Favorite.user_id == user.id, Restaurant.status == RestaurantStatus.active)
    ).all()


@router.put("/me/favorites/{restaurant_id}", status_code=204)
def add_favorite(restaurant_id: int, db: DB, user: CurrentUser):
    if db.get(Restaurant, restaurant_id) is None:
        raise HTTPException(404, "Ресторан не найден")
    if db.get(Favorite, (user.id, restaurant_id)) is None:
        db.add(Favorite(user_id=user.id, restaurant_id=restaurant_id))
        db.commit()


@router.delete("/me/favorites/{restaurant_id}", status_code=204)
def remove_favorite(restaurant_id: int, db: DB, user: CurrentUser):
    fav = db.get(Favorite, (user.id, restaurant_id))
    if fav:
        db.delete(fav)
        db.commit()

