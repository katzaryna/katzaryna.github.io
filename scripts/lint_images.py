from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent.parent
IMAGE_DIRECTORIES = (ROOT / "assets" / "images", ROOT / "projects")
IMAGE_FORMATS = {".gif", ".png", ".webp"}


def main() -> int:
    images = sorted(
        image
        for directory in IMAGE_DIRECTORIES
        for image in directory.rglob("*")
        if image.is_file() and image.suffix.lower() in IMAGE_FORMATS
    )
    for image_path in images:
        with Image.open(image_path) as image:
            image.verify()

    print(f"Validated {len(images)} image files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
