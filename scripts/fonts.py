#!/usr/bin/env python3
"""Self-hosted Google Fonts for the site: install, find unused ones, prune, check.

Fonts live in assets/fonts/<slug>/ and are listed in _data/fonts.yml, from which
assets/theme.css builds the @font-face rules. A font is "used" when a text
place in _data/text_places.yml has it as its default or _config.yml's
text_styles chooses it. Anything else is removed by `prune` and reported by
`check` (which `make test`, and so CI, runs).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import shutil
import sys
import time
from urllib.parse import quote_plus
from urllib.request import Request, urlopen

import yaml


ROOT = Path(__file__).resolve().parent.parent
FONTS_DIRECTORY = Path("assets") / "fonts"
FONTS_DATA = Path("_data") / "fonts.yml"
PLACES_DATA = Path("_data") / "text_places.yml"
CATALOG_URL = "https://fonts.google.com/metadata/fonts"
CSS_URL = "https://fonts.googleapis.com/css2?family={family}&display=swap"
# Google serves WOFF2 split by script only to modern browsers.
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
)
CATALOG_MAX_AGE = 7 * 24 * 3600
KEEP_SUBSETS = ("latin", "latin-ext")
FALLBACKS = {
    "Serif": "serif",
    "Sans Serif": "sans-serif",
    "Display": "sans-serif",
    "Handwriting": "cursive",
    "Monospace": "monospace",
}
FAMILY_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9 ]{0,79}")
FACE_BLOCK = re.compile(r"/\*\s*(?P<subset>[\w-]+)\s*\*/\s*@font-face\s*{(?P<body>[^}]*)}")
TIMEOUT = 30


class FontError(Exception):
    """A font problem explained in words the site owner understands."""


def slugify(family: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", family.lower()).strip("-")


def fetch(url: str) -> bytes:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=TIMEOUT) as response:  # noqa: S310 - fixed Google hosts
        return response.read()


# ---------------------------------------------------------------------------
# Data files
# ---------------------------------------------------------------------------
def load_fonts(root: Path = ROOT) -> list[dict]:
    path = root / FONTS_DATA
    if not path.is_file():
        return []
    return yaml.safe_load(path.read_text(encoding="utf-8")) or []


def save_fonts(root: Path, fonts: list[dict]) -> None:
    path = root / FONTS_DATA
    path.parent.mkdir(parents=True, exist_ok=True)
    fonts = sorted(fonts, key=lambda font: font["family"].lower())
    header = "# Managed by the site builder (scripts/fonts.py). Do not edit by hand.\n"
    path.write_text(header + yaml.safe_dump(fonts, allow_unicode=True, sort_keys=False, width=1000), encoding="utf-8")


def load_places(root: Path = ROOT) -> list[dict]:
    path = root / PLACES_DATA
    return (yaml.safe_load(path.read_text(encoding="utf-8")) or []) if path.is_file() else []


def load_text_styles(root: Path = ROOT) -> dict:
    config = yaml.safe_load((root / "_config.yml").read_text(encoding="utf-8")) or {}
    styles = config.get("text_styles") or {}
    return styles if isinstance(styles, dict) else {}


def used_families(places: list[dict], text_styles: dict) -> set[str]:
    """Fonts the site shows: each place's chosen font, or its default."""
    used = set()
    for place in places:
        chosen = (text_styles.get(place["id"]) or {}).get("font")
        family = chosen or place.get("font")
        if family:
            used.add(family)
    return used


# ---------------------------------------------------------------------------
# Google Fonts
# ---------------------------------------------------------------------------
def catalog(cache_file: Path) -> list[dict]:
    """All Google Fonts families as [{family, category}], cached for a week."""
    if cache_file.is_file() and time.time() - cache_file.stat().st_mtime < CATALOG_MAX_AGE:
        return json.loads(cache_file.read_text(encoding="utf-8"))
    try:
        raw = fetch(CATALOG_URL).decode("utf-8")
    except OSError as error:
        if cache_file.is_file():
            return json.loads(cache_file.read_text(encoding="utf-8"))
        raise FontError("Не удалось загрузить список шрифтов Google — проверьте интернет.") from error
    data = json.loads(raw.lstrip(")]}'\n"))
    families = [
        {"family": item["family"], "category": item.get("category", ""), "fonts": sorted(item.get("fonts", {}))}
        for item in data["familyMetadataList"]
    ]
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(json.dumps(families), encoding="utf-8")
    return families


def css_family_query(family: str, available: list[str]) -> str:
    """The css2 `family=` value asking for the regular face, or the closest one there is."""
    name = quote_plus(family)
    if not available or "400" in available:
        return name
    upright = [weight for weight in available if weight.isdigit()]
    if upright:
        return f"{name}:wght@{upright[0]}"
    return f"{name}:ital,wght@1,{available[0].rstrip('i')}"


def parse_font_css(css: str) -> list[dict]:
    """[{subset, url, weight, style, unicode_range}] from a css2 response."""
    faces = []
    for match in FACE_BLOCK.finditer(css):
        body = match.group("body")
        url = re.search(r"url\((https://fonts\.gstatic\.com/[^)]+\.woff2)\)", body)
        weight = re.search(r"font-weight:\s*(\d+)", body)
        style = re.search(r"font-style:\s*(\w+)", body)
        unicode_range = re.search(r"unicode-range:\s*([^;]+);", body)
        if not url:
            continue
        faces.append({
            "subset": match.group("subset"),
            "url": url.group(1),
            "weight": int(weight.group(1)) if weight else 400,
            "style": style.group(1) if style else "normal",
            "unicode_range": unicode_range.group(1).strip() if unicode_range else "",
        })
    wanted = [face for face in faces if face["subset"] in KEEP_SUBSETS]
    return wanted or faces


def install(root: Path, family: str, families: list[dict]) -> dict:
    """Download a Google font into assets/fonts/<slug>/ and list it in _data/fonts.yml."""
    info = next((item for item in families if item["family"] == family), None)
    if not FAMILY_NAME.fullmatch(family or "") or info is None:
        raise FontError(f"Шрифта «{family}» нет в Google Fonts. Выберите название из списка.")
    fonts = load_fonts(root)
    existing = next((font for font in fonts if font["family"] == family), None)
    if existing and all((root / FONTS_DIRECTORY / existing["slug"] / face["file"]).is_file()
                        for face in existing["faces"]):
        return existing
    try:
        css = fetch(CSS_URL.format(family=css_family_query(family, info.get("fonts", [])))).decode("utf-8")
        faces = parse_font_css(css)
        if not faces:
            raise FontError(f"Google не отдал файлы шрифта «{family}».")
        slug = slugify(family)
        directory = root / FONTS_DIRECTORY / slug
        directory.mkdir(parents=True, exist_ok=True)
        entry_faces = []
        for face in faces:
            filename = f"{slug}-{face['weight']}{'-italic' if face['style'] == 'italic' else ''}-{face['subset']}.woff2"
            (directory / filename).write_bytes(fetch(face["url"]))
            entry_faces.append({
                "file": filename,
                "weight": face["weight"],
                "style": face["style"],
                "unicode_range": face["unicode_range"],
            })
    except OSError as error:
        raise FontError(f"Не удалось скачать шрифт «{family}» — проверьте интернет.") from error
    entry = {
        "family": family,
        "slug": slug,
        "fallback": FALLBACKS.get(info.get("category", ""), "sans-serif"),
        "faces": entry_faces,
    }
    save_fonts(root, [font for font in fonts if font["family"] != family] + [entry])
    return entry


# ---------------------------------------------------------------------------
# Keeping only what is used
# ---------------------------------------------------------------------------
def prune(root: Path = ROOT, text_styles: dict | None = None) -> list[str]:
    """Remove fonts no text place uses, and stray files. Returns removed family/file names."""
    styles = load_text_styles(root) if text_styles is None else text_styles
    used = used_families(load_places(root), styles)
    fonts = load_fonts(root)
    kept = [font for font in fonts if font["family"] in used]
    removed = [font["family"] for font in fonts if font["family"] not in used]
    if removed:
        save_fonts(root, kept)
    directory = root / FONTS_DIRECTORY
    keep_slugs = {font["slug"]: {face["file"] for face in font["faces"]} for font in kept}
    for path in sorted(directory.iterdir()) if directory.is_dir() else []:
        if path.is_dir() and path.name in keep_slugs:
            for file in path.iterdir():
                if file.name not in keep_slugs[path.name]:
                    file.unlink()
                    removed.append(f"{path.name}/{file.name}")
        elif path.name != ".gitkeep":
            if path.is_dir():
                shutil.rmtree(path)
            else:
                path.unlink()
            if path.name not in removed:
                removed.append(path.name)
    return removed


def check(root: Path = ROOT) -> list[str]:
    """Problems with the installed fonts; empty when every font is used and present."""
    problems = []
    fonts = load_fonts(root)
    places = load_places(root)
    styles = load_text_styles(root)
    installed = {font["family"] for font in fonts}
    used = used_families(places, styles)
    place_ids = {place["id"] for place in places}
    for place_id in styles:
        if place_id not in place_ids:
            problems.append(f"text_styles.{place_id}: no such text place in {PLACES_DATA}.")
    for family in sorted(used - installed):
        problems.append(f"Font {family!r} is used but not installed (python -m scripts.fonts install {family!r}).")
    for family in sorted(installed - used):
        problems.append(f"Font {family!r} is installed but unused (python -m scripts.fonts prune).")
    directory = root / FONTS_DIRECTORY
    listed = {font["slug"]: font for font in fonts}
    for font in fonts:
        for face in font["faces"]:
            if not (directory / font["slug"] / face["file"]).is_file():
                problems.append(f"Font file missing: {FONTS_DIRECTORY / font['slug'] / face['file']}.")
    for path in sorted(directory.iterdir()) if directory.is_dir() else []:
        if path.name == ".gitkeep":
            continue
        if not path.is_dir() or path.name not in listed:
            problems.append(f"{FONTS_DIRECTORY / path.name} is not listed in {FONTS_DATA} (python -m scripts.fonts prune).")
            continue
        files = {face["file"] for face in listed[path.name]["faces"]}
        problems.extend(
            f"{FONTS_DIRECTORY / path.name / file.name} is not listed in {FONTS_DATA}."
            for file in sorted(path.iterdir()) if file.name not in files
        )
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description="Manage the site's self-hosted Google Fonts.")
    parser.add_argument("command", choices=("check", "prune", "install"))
    parser.add_argument("family", nargs="?")
    arguments = parser.parse_args()
    if arguments.command == "install":
        if not arguments.family:
            parser.error("install needs a font family name")
        families = catalog(ROOT / ".builder-cache" / "google-fonts.json")
        print(json.dumps(install(ROOT, arguments.family, families), indent=2))
        return 0
    if arguments.command == "prune":
        removed = prune(ROOT)
        print(f"Removed: {', '.join(removed)}" if removed else "No unused fonts.")
        return 0
    problems = check(ROOT)
    for problem in problems:
        print(f"ERROR: {problem}", file=sys.stderr)
    if not problems:
        print(f"Fonts OK: {', '.join(font['family'] for font in load_fonts(ROOT)) or 'none'}.")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
