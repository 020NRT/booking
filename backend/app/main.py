import asyncio
import logging
import uuid
from contextlib import asynccontextmanager


from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import BACKEND_DIR, get_settings
from .db import SessionLocal
from .routers import admin, auth, bookings, checkin, partner, public
from .services.booking import run_periodic

settings = get_settings()
logging.basicConfig(
    level=settings.log_level,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("reserve")


async def _scheduler():
    while True:
        try:
            await asyncio.to_thread(_tick)
        except Exception:
            log.exception("Periodic task failed")
        await asyncio.sleep(60)


def _tick():
    with SessionLocal() as db:
        run_periodic(db)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.media_dir.mkdir(parents=True, exist_ok=True)
    task = asyncio.create_task(_scheduler()) if settings.run_scheduler else None
    yield
    if task:
        task.cancel()


app = FastAPI(
    title="Reserve API",
    version="1.0.0",
    description="Онлайн-бронирование столиков. Все эндпоинты под префиксом /api.",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,  # auth uses a Bearer header, not cookies
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "DENY")
    return response


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    errors = []
    for e in exc.errors():
        msg = str(e.get("msg", "")).removeprefix("Value error, ")
        loc = ".".join(str(x) for x in e.get("loc", ())[1:])
        errors.append({"field": loc, "message": msg})
    message = errors[0]["message"] if errors else "Некорректные данные"
    return JSONResponse(status_code=422, content={"detail": {"code": "validation_error", "message": message, "errors": errors}})


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    error_id = uuid.uuid4().hex[:10]
    log.exception("Unhandled error %s on %s %s", error_id, request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": {"code": "server_error", "message": f"Внутренняя ошибка сервера (код {error_id})"}},
    )


for r in (auth.router, public.router, bookings.router, checkin.router, partner.router, admin.router):
    app.include_router(r, prefix="/api")


@app.get("/api/health", tags=["system"])
def health():
    return {"ok": True}


app.mount("/media", StaticFiles(directory=settings.media_dir, check_dir=False), name="media")

# In production the built frontend (frontend/dist) can be served by this same process.
FRONTEND_DIST = BACKEND_DIR.parent / "frontend" / "dist"
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        file = (FRONTEND_DIST / path).resolve()
        if path and file.is_file() and FRONTEND_DIST in file.parents:
            return FileResponse(file)
        return FileResponse(FRONTEND_DIST / "index.html")


