"""Safe image uploads: decoded with Pillow, re-encoded, stored under a random name.

Re-encoding strips EXIF (incl. GPS) and any payload hidden in the original file;
the client-supplied filename and content type are never trusted.
"""

import secrets
from io import BytesIO

from fastapi import HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

from ..config import get_settings

ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}
MAX_SIDE = 2400
Image.MAX_IMAGE_PIXELS = 40_000_000  # decompression-bomb guard


async def save_image(file: UploadFile, folder: str) -> str:
    s = get_settings()
    limit = s.max_upload_mb * 1024 * 1024
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, f"Файл больше {s.max_upload_mb} МБ")
    try:
        img = Image.open(BytesIO(data))
        if img.format not in ALLOWED_FORMATS:
            raise HTTPException(415, "Допустимы только JPEG, PNG и WEBP")
        img.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise HTTPException(415, "Файл не является изображением")

    img = ImageOps.exif_transpose(img)
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA" if "transparency" in img.info else "RGB")
    img.thumbnail((MAX_SIDE, MAX_SIDE))

    target = s.media_dir / folder
    target.mkdir(parents=True, exist_ok=True)
    name = f"{secrets.token_hex(12)}.webp"
    img.save(target / name, "WEBP", quality=82, method=4)
    return f"/media/{folder}/{name}"
