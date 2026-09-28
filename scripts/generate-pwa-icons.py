from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
ICON_DIR = ROOT / "public" / "icons"


def make_icon(size: int) -> Image.Image:
    scale = size / 512
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gradient = Image.new("RGBA", (size, size))
    pixels = gradient.load()
    for y in range(size):
        ratio = y / max(1, size - 1)
        color = tuple(round(start + (end - start) * ratio) for start, end in zip((129, 140, 248), (67, 56, 202)))
        for x in range(size):
            pixels[x, y] = (*color, 255)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=round(112 * scale), fill=255)
    image.paste(gradient, mask=mask)
    draw = ImageDraw.Draw(image)
    box = lambda values: tuple(round(value * scale) for value in values)
    draw.ellipse(box((302, 66, 448, 212)), fill="#fef3c7")
    draw.ellipse(box((333, 39, 479, 185)), fill="#6366f1")
    draw.rounded_rectangle(box((128, 208, 354, 430)), radius=round(72 * scale), fill="white")
    draw.rectangle(box((128, 208, 354, 305)), fill="white")
    draw.arc(box((326, 238, 452, 364)), start=270, end=90, fill="white", width=max(1, round(34 * scale)))
    for x in (185, 248, 311):
        draw.arc(box((x - 20, 84, x + 20, 170)), start=70, end=285, fill="#e0e7ff", width=max(1, round(14 * scale)))
    draw.line(box((105, 437, 403, 437)), fill="#c7d2fe", width=max(1, round(22 * scale)))
    return image


ICON_DIR.mkdir(parents=True, exist_ok=True)
for name, size in (("icon-192.png", 192), ("icon-512.png", 512), ("apple-touch-icon.png", 180)):
    make_icon(size).save(ICON_DIR / name, optimize=True)
